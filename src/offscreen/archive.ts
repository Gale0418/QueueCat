import { BlobReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import {
  fetchGalleryWebp,
  isSafeGalleryImageUrl,
  MAX_GALLERY_IMAGE_BYTES,
} from "../background/gallery-transport";

export const MAX_GALLERY_PAGES = 2_000;
export const MAX_GALLERY_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const ROOT = "queuecat-archives";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;

export interface ArchiveStageInput {
  key: string;
  fingerprint: string;
  total: number;
  index: number;
  hash: string;
  url: string;
}
export interface ArchivePackInput {
  key: string;
  fingerprint: string;
  total: number;
  hashes: string[];
}
export interface ArchiveFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<WritableStream<Uint8Array>>;
}
export interface ArchiveDirectoryHandle {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ArchiveDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ArchiveFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}
export type ArchiveStorage = {
  getDirectory(): Promise<ArchiveDirectoryHandle>;
};
type ReceiptEntry = {
  index: number;
  size: number;
  contentSHA: string;
  sourceHash: string;
};
type Receipt = {
  version: 1;
  fingerprint: string;
  total: number;
  entries: ReceiptEntry[];
  ready?: { size: number; hashes: string[] };
};

function fail(code: string): never {
  throw new Error(code);
}
async function isWebp(blob: Blob): Promise<boolean> {
  if (blob.size < 12 || blob.type.toLowerCase() !== "image/webp") return false;
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}
function validateIdentity(
  key: string,
  fingerprint: string,
  total: number,
): void {
  if (
    !UUID.test(key) ||
    !HASH.test(fingerprint) ||
    !Number.isInteger(total) ||
    total < 1 ||
    total > MAX_GALLERY_PAGES
  )
    fail("gallery_archive_limit");
}
async function digest(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function loadReceipt(
  dir: ArchiveDirectoryHandle,
  fingerprint: string,
  total: number,
): Promise<Receipt> {
  try {
    const file = await (await dir.getFileHandle("receipt.json")).getFile();
    if (file.size === 0) return { version: 1, fingerprint, total, entries: [] };
    const receipt = JSON.parse(await file.text()) as Receipt;
    const stagedBytes = Array.isArray(receipt.entries)
      ? receipt.entries.reduce(
          (sum, entry) =>
            sum + (Number.isSafeInteger(entry?.size) ? entry.size : 0),
          0,
        )
      : 0;
    if (
      receipt.version !== 1 ||
      receipt.fingerprint !== fingerprint ||
      receipt.total !== total ||
      !Array.isArray(receipt.entries) ||
      receipt.entries.length > total ||
      stagedBytes > MAX_GALLERY_ARCHIVE_BYTES ||
      (receipt.ready !== undefined &&
        (!receipt.ready ||
          !Number.isSafeInteger(receipt.ready.size) ||
          receipt.ready.size < 1 ||
          receipt.ready.size > MAX_GALLERY_ARCHIVE_BYTES ||
          !Array.isArray(receipt.ready.hashes) ||
          receipt.ready.hashes.length !== total ||
          receipt.ready.hashes.some((hash) => !HASH.test(hash)))) ||
      receipt.entries.some(
        (entry, index) =>
          entry.index !== index ||
          !Number.isInteger(entry.size) ||
          entry.size < 1 ||
          entry.size > MAX_GALLERY_IMAGE_BYTES ||
          !HASH.test(entry.contentSHA) ||
          !HASH.test(entry.sourceHash),
      )
    )
      fail("gallery_archive_receipt_mismatch");
    return receipt;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("gallery_archive_"))
      throw error;
    if (error instanceof DOMException && error.name === "NotFoundError")
      return { version: 1, fingerprint, total, entries: [] };
    fail("gallery_archive_receipt_invalid");
  }
}
async function readVerifiedPage(
  dir: ArchiveDirectoryHandle,
  index: number,
  entry: ReceiptEntry,
): Promise<File> {
  try {
    const file = await (
      await dir.getFileHandle(`page-${index}.webp`)
    ).getFile();
    if (file.size !== entry.size || (await digest(file)) !== entry.contentSHA)
      fail("gallery_archive_receipt_mismatch");
    return file;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("gallery_archive_"))
      throw error;
    fail("gallery_archive_receipt_mismatch");
  }
}
async function writeBlob(file: ArchiveFileHandle, blob: Blob): Promise<void> {
  const writer = await file.createWritable();
  const stream = blob.stream().pipeTo(writer);
  await stream;
}
async function persistReceipt(
  dir: ArchiveDirectoryHandle,
  receipt: Receipt,
): Promise<void> {
  try {
    const file = await dir.getFileHandle("receipt.json", { create: true });
    await writeBlob(
      file,
      new Blob([JSON.stringify(receipt)], { type: "application/json" }),
    );
  } catch {
    fail("gallery_archive_quota");
  }
}

export function createArchiveManager(
  storage: ArchiveStorage,
  fetcher: (url: string) => Promise<Blob> = (url) => fetchGalleryWebp(url),
) {
  const inFlight = new Map<string, Promise<unknown>>();
  const tails = new Map<string, Promise<void>>();
  const urls = new Map<string, string>();
  const active = new Set<string>();
  const root = async () =>
    (await storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
  const itemDir = async (key: string, create = true) =>
    (await root()).getDirectoryHandle(key, { create });
  const exclusive = <T>(
    key: string,
    dedupeKey: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const prior = inFlight.get(dedupeKey);
    if (prior) return prior as Promise<T>;
    active.add(dedupeKey);
    const before = tails.get(key) ?? Promise.resolve();
    const result = before.then(operation).finally(() => {
      active.delete(dedupeKey);
      if (inFlight.get(dedupeKey) === result) inFlight.delete(dedupeKey);
    });
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.finally(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    inFlight.set(dedupeKey, result);
    return result;
  };
  return {
    get idle(): boolean {
      return active.size === 0 && urls.size === 0;
    },
    stagePage(
      input: ArchiveStageInput,
    ): Promise<{ staged: number; bytes: number }> {
      return exclusive(
        input.key,
        `${input.key}:stage:${JSON.stringify(input)}`,
        async () => {
          validateIdentity(input.key, input.fingerprint, input.total);
          if (
            !Number.isInteger(input.index) ||
            input.index < 0 ||
            input.index >= input.total ||
            !HASH.test(input.hash) ||
            !isSafeGalleryImageUrl(input.url) ||
            !input.url.endsWith(`/${input.hash.toLowerCase()}.webp`)
          )
            fail("gallery_archive_limit");
          let dir: ArchiveDirectoryHandle;
          try {
            dir = await itemDir(input.key);
          } catch {
            fail("gallery_archive_quota");
          }
          const receipt = await loadReceipt(
            dir!,
            input.fingerprint,
            input.total,
          );
          const sourceHash = input.hash.toLowerCase();
          if (input.index < receipt.entries.length) {
            const prior = receipt.entries[input.index];
            if (prior.sourceHash !== sourceHash)
              fail("gallery_archive_receipt_mismatch");
            try {
              const page = await (
                await dir!.getFileHandle(`page-${input.index}.webp`)
              ).getFile();
              if (
                page.size !== prior.size ||
                (await digest(page)) !== prior.contentSHA
              )
                fail("gallery_archive_receipt_mismatch");
              return {
                staged: receipt.entries.length,
                bytes: receipt.entries.reduce((n, e) => n + e.size, 0),
              };
            } catch (error) {
              if (
                error instanceof Error &&
                error.message.startsWith("gallery_archive_")
              )
                throw error;
              fail("gallery_archive_receipt_mismatch");
            }
          }
          if (input.index !== receipt.entries.length)
            fail("gallery_archive_stage_missing");
          const blob = await fetcher(input.url);
          if (blob.size > MAX_GALLERY_IMAGE_BYTES || !(await isWebp(blob)))
            fail("gallery_archive_failed");
          const stagedBytes = receipt.entries.reduce(
            (n, entry) => n + entry.size,
            0,
          );
          if (stagedBytes + blob.size > MAX_GALLERY_ARCHIVE_BYTES)
            fail("gallery_archive_limit");
          const contentSHA = await digest(blob);
          try {
            await writeBlob(
              await dir!.getFileHandle(`page-${input.index}.webp`, {
                create: true,
              }),
              blob,
            );
          } catch {
            fail("gallery_archive_quota");
          }
          receipt.entries.push({
            index: input.index,
            size: blob.size,
            contentSHA,
            sourceHash,
          });
          await persistReceipt(dir!, receipt);
          return {
            staged: receipt.entries.length,
            bytes: receipt.entries.reduce((n, e) => n + e.size, 0),
          };
        },
      );
    },
    pack(input: ArchivePackInput): Promise<{ url: string; bytes: number }> {
      return exclusive(
        input.key,
        `${input.key}:pack:${JSON.stringify(input)}`,
        async () => {
          validateIdentity(input.key, input.fingerprint, input.total);
          if (
            !Array.isArray(input.hashes) ||
            input.hashes.length !== input.total ||
            input.hashes.some((hash) => !HASH.test(hash))
          )
            fail("gallery_archive_limit");
          const dir = await itemDir(input.key, false).catch(() =>
            fail("gallery_archive_stage_missing"),
          );
          const receipt = await loadReceipt(
            dir,
            input.fingerprint,
            input.total,
          );
          if (receipt.entries.length !== input.total)
            fail("gallery_archive_stage_missing");
          const normalizedHashes = input.hashes.map((hash) =>
            hash.toLowerCase(),
          );
          let bytes = 0;
          for (let i = 0; i < input.total; i++) {
            const entry = receipt.entries[i];
            if (entry.sourceHash !== normalizedHashes[i])
              fail("gallery_archive_receipt_mismatch");
            const file = await readVerifiedPage(dir, i, entry);
            bytes += file.size;
          }
          if (
            receipt.ready &&
            receipt.ready.hashes.join() === normalizedHashes.join()
          ) {
            const existingUrl = urls.get(input.key);
            if (existingUrl)
              return { url: existingUrl, bytes: receipt.ready.size };
          }
          if (bytes > MAX_GALLERY_ARCHIVE_BYTES) fail("gallery_archive_limit");
          const outHandle = await dir.getFileHandle("gallery.zip.part", {
            create: true,
          });
          const writable = await outHandle.createWritable();
          const writer = new ZipWriter(writable, {
            level: 0,
            useWebWorkers: false,
            zip64: false,
            bufferedWrite: false,
          });
          try {
            for (let i = 0; i < input.total; i++) {
              const page = await readVerifiedPage(dir, i, receipt.entries[i]);
              await writer.add(
                `${String(i + 1).padStart(4, "0")}.webp`,
                new BlobReader(page),
                { level: 0, useWebWorkers: false, compressionMethod: 0 },
              );
            }
            await writer.close();
          } catch (error) {
            await writable.abort(error).catch(() => undefined);
            await dir.removeEntry("gallery.zip.part").catch(() => undefined);
            throw error instanceof Error &&
              error.message.startsWith("gallery_archive_")
              ? error
              : new Error("gallery_archive_failed");
          }
          const part = await outHandle.getFile();
          if (part.size > MAX_GALLERY_ARCHIVE_BYTES) {
            await dir.removeEntry("gallery.zip.part").catch(() => undefined);
            fail("gallery_archive_limit");
          }
          try {
            await writeBlob(
              await dir.getFileHandle("gallery.zip", { create: true }),
              part,
            );
            await dir.removeEntry("gallery.zip.part");
            receipt.ready = { size: part.size, hashes: normalizedHashes };
            await persistReceipt(dir, receipt);
          } catch {
            fail("gallery_archive_quota");
          }
          const completed = await (
            await dir.getFileHandle("gallery.zip")
          ).getFile();
          const url = URL.createObjectURL(
            new Blob([completed], { type: "application/zip" }),
          );
          urls.set(input.key, url);
          return { url, bytes: completed.size };
        },
      );
    },
    async cleanup(key: string): Promise<void> {
      if (!UUID.test(key)) return;
      const cleanupJob = `${key}:cleanup`;
      active.add(cleanupJob);
      const previous = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const cleanupTail = previous.then(() => gate);
      tails.set(key, cleanupTail);
      await previous;
      const url = urls.get(key);
      if (url) {
        URL.revokeObjectURL(url);
        urls.delete(key);
      }
      try {
        await (await root()).removeEntry(key, { recursive: true });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError"))
          fail("gallery_archive_failed");
      } finally {
        release();
        if (tails.get(key) === cleanupTail) tails.delete(key);
        active.delete(cleanupJob);
      }
    },
  };
}

export function createOpfsArchiveStorage(): ArchiveStorage {
  return {
    getDirectory: () =>
      navigator.storage.getDirectory() as Promise<ArchiveDirectoryHandle>,
  };
}
