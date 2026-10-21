import {
  BlobReader,
  BlobWriter,
  ZipReader,
} from "@zip.js/zip.js/lib/zip-core-external.js";
import { describe, expect, it, vi } from "vitest";
import {
  createArchiveManager,
  MAX_GALLERY_ARCHIVE_BYTES,
  type ArchiveDirectoryHandle,
  type ArchiveFileHandle,
  type ArchiveStorage,
} from "../src/offscreen/archive";

class MemoryDirectory implements ArchiveDirectoryHandle {
  dirs = new Map<string, MemoryDirectory>();
  files = new Map<string, Uint8Array>();
  failClose = new Set<string>();
  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ArchiveDirectoryHandle> {
    let dir = this.dirs.get(name);
    if (!dir && options?.create) {
      dir = new MemoryDirectory();
      this.dirs.set(name, dir);
    }
    if (!dir) throw new DOMException("missing", "NotFoundError");
    return dir;
  }
  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ArchiveFileHandle> {
    if (!this.files.has(name) && !options?.create)
      throw new DOMException("missing", "NotFoundError");
    if (!this.files.has(name)) this.files.set(name, new Uint8Array());
    return {
      getFile: async () =>
        new File([this.files.get(name)!.slice().buffer as ArrayBuffer], name),
      createWritable: async () => {
        const chunks: Uint8Array[] = [];
        return new WritableStream<Uint8Array>({
          write: (chunk) => {
            chunks.push(chunk.slice());
          },
          close: () => {
            if (this.failClose.delete(name))
              throw new DOMException("quota", "QuotaExceededError");
            const length = chunks.reduce((n, chunk) => n + chunk.length, 0);
            const content = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) {
              content.set(chunk, offset);
              offset += chunk.length;
            }
            this.files.set(name, content);
          },
        });
      },
    };
  }
  async removeEntry(name: string): Promise<void> {
    if (this.files.delete(name)) return;
    if (this.dirs.delete(name)) return;
    throw new DOMException("missing", "NotFoundError");
  }
}

const key = "11111111-1111-4111-8111-111111111111";
const fingerprint = "f".repeat(64);
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const urlA = `https://w1.gold-usergeneratedcontent.net/1/1/${hashA}.webp`;
const urlB = `https://w1.gold-usergeneratedcontent.net/1/1/${hashB}.webp`;
function webp(marker: number): Blob {
  return new Blob(
    [
      new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46,
        marker,
        0,
        0,
        0,
        0x57,
        0x45,
        0x42,
        0x50,
      ]).buffer as ArrayBuffer,
    ],
    { type: "image/webp" },
  );
}
function setup(
  fetcher = vi.fn(async (url: string) => webp(url === urlA ? 1 : 2)),
) {
  const root = new MemoryDirectory();
  const manager = createArchiveManager(
    { getDirectory: async () => root } as ArchiveStorage,
    fetcher,
  );
  return { root, manager, fetcher };
}

describe("ZIP 私有圖庫封裝", () => {
  it("以真實 STORE ZIP 保留頁面順序、內容與可重用結果", async () => {
    const { manager } = setup();
    const common = { key, fingerprint, total: 2 };
    await manager.stagePage({ ...common, index: 0, hash: hashA, url: urlA });
    await manager.stagePage({ ...common, index: 1, hash: hashB, url: urlB });
    const result = await manager.pack({ ...common, hashes: [hashA, hashB] });
    const response = await fetch(result.url);
    const zipBlob = await response.blob();
    expect(zipBlob.type).toBe("application/zip");
    expect(zipBlob.size).toBe(result.bytes);
    const reader = new ZipReader(new BlobReader(zipBlob), { checkCrc32: true });
    try {
      const entries = await reader.getEntries();
      expect(entries.map((entry) => entry.filename)).toEqual([
        "0001.webp",
        "0002.webp",
      ]);
      if (!("getData" in entries[0]) || !("getData" in entries[1]))
        throw new Error("expected file entries");
      expect([
        ...new Uint8Array(
          await (await entries[0].getData(new BlobWriter())).arrayBuffer(),
        ),
      ]).toEqual([...new Uint8Array(await webp(1).arrayBuffer())]);
      expect([
        ...new Uint8Array(
          await (await entries[1].getData(new BlobWriter())).arrayBuffer(),
        ),
      ]).toEqual([...new Uint8Array(await webp(2).arrayBuffer())]);
    } finally {
      await reader.close();
    }
    expect(await manager.pack({ ...common, hashes: [hashA, hashB] })).toEqual(
      result,
    );
    await manager.cleanup(key);
    expect(manager.idle).toBe(true);
  });

  it("拒絕超前索引與不一致 receipt，重送已提交頁面不會重抓", async () => {
    const { manager, fetcher } = setup();
    const common = { key, fingerprint, total: 2 };
    await expect(
      manager.stagePage({ ...common, index: 1, hash: hashB, url: urlB }),
    ).rejects.toThrow("gallery_archive_stage_missing");
    await manager.stagePage({ ...common, index: 0, hash: hashA, url: urlA });
    await manager.stagePage({ ...common, index: 0, hash: hashA, url: urlA });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(
      manager.stagePage({ ...common, index: 0, hash: hashB, url: urlB }),
    ).rejects.toThrow("gallery_archive_receipt_mismatch");
  });

  it("quota 會明確失敗，半寫 receipt 可安全重試", async () => {
    const { root, manager } = setup();
    const item = (await (
      await root.getDirectoryHandle("queuecat-archives", { create: true })
    ).getDirectoryHandle(key, { create: true })) as MemoryDirectory;
    item.failClose.add("receipt.json");
    const input = {
      key,
      fingerprint,
      total: 1,
      index: 0,
      hash: hashA,
      url: urlA,
    };
    await expect(manager.stagePage(input)).rejects.toThrow(
      "gallery_archive_quota",
    );
    await expect(manager.stagePage(input)).resolves.toMatchObject({
      staged: 1,
    });
  });

  it("stage 在跨過 2 GiB 前拒絕寫入，並拒絕超出頁數或單頁上限的 receipt", async () => {
    const { root, manager, fetcher } = setup();
    const archiveRoot = await root.getDirectoryHandle("queuecat-archives", {
      create: true,
    });
    const item = (await archiveRoot.getDirectoryHandle(key, {
      create: true,
    })) as MemoryDirectory;
    const pagesAtLimit = MAX_GALLERY_ARCHIVE_BYTES / (32 * 1024 * 1024);
    const validEntries = Array.from({ length: pagesAtLimit }, (_, index) => ({
      index,
      size: 32 * 1024 * 1024,
      contentSHA: hashA,
      sourceHash: hashA,
    }));
    item.files.set(
      "receipt.json",
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          fingerprint,
          total: 65,
          entries: validEntries,
        }),
      ),
    );
    await expect(
      manager.stagePage({
        key,
        fingerprint,
        total: 65,
        index: pagesAtLimit,
        hash: hashA,
        url: urlA,
      }),
    ).rejects.toThrow("gallery_archive_limit");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(item.files.has(`page-${pagesAtLimit}.webp`)).toBe(false);

    const otherKey = "22222222-2222-4222-8222-222222222222";
    const other = (await archiveRoot.getDirectoryHandle(otherKey, {
      create: true,
    })) as MemoryDirectory;
    other.files.set(
      "receipt.json",
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          fingerprint,
          total: 1,
          entries: [
            {
              index: 0,
              size: 32 * 1024 * 1024 + 1,
              contentSHA: hashA,
              sourceHash: hashA,
            },
            { index: 1, size: 12, contentSHA: hashB, sourceHash: hashB },
          ],
        }),
      ),
    );
    await expect(
      manager.stagePage({
        key: otherKey,
        fingerprint,
        total: 1,
        index: 0,
        hash: hashA,
        url: urlA,
      }),
    ).rejects.toThrow("gallery_archive_receipt_mismatch");
  });

  it("pack manifest mismatch 會拒絕，不會留下可下載半成品", async () => {
    const { manager, root } = setup();
    await manager.stagePage({
      key,
      fingerprint,
      total: 1,
      index: 0,
      hash: hashA,
      url: urlA,
    });
    await expect(
      manager.pack({ key, fingerprint, total: 1, hashes: [hashB] }),
    ).rejects.toThrow("gallery_archive_receipt_mismatch");
    const item = await (
      await root.getDirectoryHandle("queuecat-archives")
    ).getDirectoryHandle(key);
    await expect(item.getFileHandle("gallery.zip")).rejects.toThrow();
  });

  it("staged page 遺失時 pack 回 receipt mismatch", async () => {
    const { root, manager } = setup();
    await manager.stagePage({
      key,
      fingerprint,
      total: 1,
      index: 0,
      hash: hashA,
      url: urlA,
    });
    const archiveRoot = await root.getDirectoryHandle("queuecat-archives");
    const item = (await archiveRoot.getDirectoryHandle(key)) as MemoryDirectory;
    item.files.delete("page-0.webp");

    await expect(
      manager.pack({ key, fingerprint, total: 1, hashes: [hashA] }),
    ).rejects.toThrow("gallery_archive_receipt_mismatch");
  });
});
