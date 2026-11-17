import { describe, expect, it, vi } from "vitest";
import {
  QueueEngine,
  type DownloadRecord,
  type EnginePorts,
} from "../src/background/engine";
import { initialState, type GalleryManifest } from "../src/shared/types";

const firstUrl = "https://e-hentai.org/g/42/0123456789/";
const secondUrl = "https://e-hentai.org/g/43/1123456789/";
const firstArchive = "https://e-hentai.org/archiver.php?gid=42&token=0123456789";
const secondArchive = "https://e-hentai.org/archiver.php?gid=43&token=1123456789";

function fixture() {
  let now = 1_800_000_000_000;
  let state = initialState();
  let nextTabId = 1;
  let downloadCalls = 0;
  const tabs = new Map<number, string>();
  const created: string[] = [];
  const downloads: DownloadRecord[] = [];
  const notifications: string[] = [];
  const ports: EnginePorts = {
    storage: {
      async get() {
        return state;
      },
      async set(value) {
        state = value["queuecat.state.v1"] as typeof state;
      },
    },
    tabs: {
      async create(url) {
        const id = nextTabId++;
        tabs.set(id, url);
        created.push(url);
        return { id };
      },
      async get(id) {
        return { id, url: tabs.get(id) };
      },
      async update(id, props) {
        if (props.url) tabs.set(id, props.url);
      },
      async send() {},
    },
    downloads: {
      async download() {
        downloadCalls++;
        return 900;
      },
      async search(query) {
        return downloads.filter((record) =>
          (query.id === undefined || record.id === query.id) &&
          (query.state === undefined || record.state === query.state) &&
          (query.startedAfter === undefined ||
            Date.parse(record.startTime || "") > Date.parse(query.startedAfter)) &&
          (query.startedBefore === undefined ||
            Date.parse(record.startTime || "") < Date.parse(query.startedBefore)),
        );
      },
      async pause() {},
      async resume() {},
      async cancel() {},
      async show() {},
    },
    alarms: {
      async get() {
        return undefined;
      },
      create() {},
      clear() {},
    },
    async notify(_title, _message, id) {
      if (id) notifications.push(id);
    },
    async setBadge() {},
    getUrl(path) {
      return `chrome-extension://test/${path}`;
    },
    now: () => now,
    extensionId: "test-extension",
  };
  return {
    engine: new QueueEngine(ports),
    ports,
    created,
    downloads,
    notifications,
    get state() {
      return state;
    },
    get downloadCalls() {
      return downloadCalls;
    },
    setNow(value: number) {
      now = value;
    },
  };
}

function archiveDownload(
  id: number,
  url: string,
  referrer: string,
  startTime: number,
  overrides: Partial<DownloadRecord> = {},
): DownloadRecord {
  return {
    id,
    url,
    referrer,
    filename: "C:/Downloads/same-title.zip",
    mime: "application/zip",
    state: "in_progress",
    bytesReceived: 128,
    totalBytes: 1024,
    paused: false,
    canResume: true,
    startTime: new Date(startTime).toISOString(),
    ...overrides,
  };
}

describe("E-Hentai 官方 ZIP 佇列整合", () => {
  it("逐本開官方頁，等使用者下載後才接續下一本並保留標題", async () => {
    const f = fixture();
    await f.engine.command({
      kind: "add",
      urls: [firstUrl, secondUrl],
      titles: { [firstUrl]: "第一本標題", [secondUrl]: "第二本標題" },
    });
    await f.engine.command({ kind: "start" });

    const [first, second] = f.state.items;
    expect(first.ehArchive?.openedAt).toBe(f.ports.now());
    expect(first.status).toBe("verification");
    expect(second.status).toBe("queued");
    expect(f.created).toEqual([firstArchive]);
    expect(f.downloadCalls).toBe(0);
    expect(f.downloads).toEqual([]);

    const download = archiveDownload(501, firstArchive, firstArchive, f.ports.now() + 1);
    f.downloads.push(download);
    await f.engine.onDownloadCreated(download);
    expect(f.state.items[0]).toMatchObject({
      title: "第一本標題",
      status: "downloading",
      downloadId: 501,
    });
    expect(f.downloadCalls).toBe(0);

    download.state = "complete";
    await f.engine.onDownloadChanged({ id: download.id, state: { current: "complete" } });
    expect(f.state.items[0].status).toBe("complete");
    expect(f.state.items[1]).toMatchObject({
      title: "第二本標題",
      status: "verification",
      ehArchive: { openedAt: f.ports.now() },
    });
    expect(f.created).toEqual([firstArchive, secondArchive]);
    expect(f.downloadCalls).toBe(0);
  });

  it("不認錯本或早於開頁時間的下載，精確重複下載則維持未認領", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [firstUrl] });
    await f.engine.command({ kind: "start" });
    const openedAt = f.state.items[0].ehArchive!.openedAt!;
    f.setNow(openedAt + 1_000);

    const tooEarly = archiveDownload(510, firstArchive, firstArchive, openedAt - 10);
    const wrongBook = archiveDownload(511, secondArchive, secondArchive, openedAt + 1);
    f.downloads.push(tooEarly, wrongBook);
    await f.engine.onDownloadCreated(wrongBook);
    expect(f.state.items[0].downloadId).toBeUndefined();
    expect(f.state.items[0].status).toBe("verification");

    const exactOne = archiveDownload(512, firstArchive, firstArchive, openedAt + 2);
    const exactTwo = archiveDownload(513, firstArchive, firstArchive, openedAt + 3);
    f.downloads.push(exactOne, exactTwo);
    await f.engine.onDownloadCreated(exactTwo);
    expect(f.state.items[0].downloadId).toBeUndefined();
    expect(f.state.items[0].status).toBe("blocked");
    expect(f.state.items[0].reason).toMatch(/多筆/);
  });

  it("人工清單接受 origin-only 官方 referrer 的 hath ZIP，並排除帶錯本 identity 的同名檔", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [firstUrl] });
    await f.engine.command({ kind: "start" });
    const openedAt = f.state.items[0].ehArchive!.openedAt!;
    f.setNow(openedAt + 500);
    f.downloads.push(
      archiveDownload(
        520,
        "https://a1.hath.network/archive/same-title.zip",
        "https://e-hentai.org/",
        openedAt + 1,
      ),
      archiveDownload(
        521,
        "https://e-hentai.org/archiver.php?gid=43&token=1123456789",
        "https://e-hentai.org/archiver.php?gid=43&token=1123456789",
        openedAt + 2,
      ),
    );

    const found = await f.engine.handleRequest({ type: "QC_FIND_DOWNLOADS", id: f.state.items[0].id });
    expect(found.downloads?.map((record) => record.id)).toEqual([520]);
    expect(f.state.items[0].downloadId).toBeUndefined();
    await f.engine.command({ kind: "adopt-download", id: f.state.items[0].id, downloadId: 520 });
    expect(f.state.items[0]).toMatchObject({
      title: "E-Hentai #42",
      status: "downloading",
      downloadId: 520,
    });
    expect(f.downloadCalls).toBe(0);
  });

  it("paused worker 恢復與再次開始都沿用已開頁，不重開或自動下載", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [firstUrl] });
    await f.engine.command({ kind: "start" });
    const openedAt = f.state.items[0].ehArchive!.openedAt;
    await f.engine.command({ kind: "pause" });

    const restored = new QueueEngine(f.ports);
    await restored.onStartup();
    await restored.command({ kind: "start" });
    expect(f.created).toEqual([firstArchive]);
    expect(f.state.items[0].ehArchive?.openedAt).toBe(openedAt);
    expect(f.state.items[0].downloadId).toBeUndefined();
    expect(f.downloads).toEqual([]);
    expect(f.downloadCalls).toBe(0);
  });
});

describe("E-Hentai 訪客閱讀圖", () => {
  it.each(["retry", "paste"] as const)(
    "用 %s 把舊的訪客失敗紀錄切到作品分頁，沿用原項目",
    async (entry) => {
      const f = fixture();
      const load = vi.fn(async (_id: string, _url?: string, _signal?: AbortSignal, useTab?: true) => {
        const code = useTab ? "gallery_reader_tab_required" : "gallery_unavailable";
        throw Object.assign(new Error(code), { code });
      });
      f.ports.gallery = { load, imageUrl: vi.fn(), ehentaiImageRoute: vi.fn() };
      const initial = await f.engine.command({
        kind: "add", urls: [firstUrl], ehentaiMode: "reader",
      });
      const id = initial.items[0].id;
      await f.engine.command({ kind: "start" });
      await vi.waitFor(() => {
        expect(f.state.items[0].reason).toBe("gallery_unavailable");
        expect(f.state.running).toBe(false);
      });
      const requeued = await f.engine.command(entry === "retry"
        ? { kind: "retry", id }
        : { kind: "add", urls: [firstUrl, firstUrl], ehentaiMode: "reader", ehentaiBrowserFallback: true });
      expect(requeued.items).toHaveLength(1);
      expect(requeued.items[0]).toMatchObject({
        id, status: "queued", gallery: { readerTab: true, allowReaderTab: true },
      });
      await f.engine.command({ kind: "start" });
      await vi.waitFor(() => expect(f.state.items[0].reason).toBe("gallery_reader_tab_required"));
      expect(load.mock.calls.map(([, , , useTab]) => useTab)).toEqual([undefined, true]);
    },
  );

  it("直接貼上的圖庫遇到訪客 404 時，同一項目可以用作品分頁接續", async () => {
    const f = fixture();
    const image = {
      hash: "a".repeat(64),
      name: "ev01_01.png",
      source: "https://e-hentai.org/s/aaaaaaaaaa/42-1",
    };
    const load = vi.fn(async (_id: string, _url?: string, _signal?: AbortSignal, useTab?: true) => {
      if (!useTab)
        throw Object.assign(new Error("gallery_unavailable"), { code: "gallery_unavailable" });
      return { id: "42", title: "作品分頁", images: [image] };
    });
    const route = vi.fn(async () => ({ url: "https://test.reader.hath.network/h/a/b/ev01.webp" }));
    const pack = vi.fn(() => new Promise<never>(() => {}));
    f.ports.gallery = {
      load,
      imageUrl: vi.fn(),
      ehentaiImageRoute: route,
      archive: {
        stagePage: vi.fn(async () => ({ staged: 1, bytes: 123 })),
        pack,
        cleanup: vi.fn(),
      },
    };
    const state = await f.engine.command({
      kind: "add",
      urls: [firstUrl],
      ehentaiMode: "reader",
      ehentaiBrowserFallback: true,
    });
    await f.engine.command({ kind: "start" });
    await vi.waitFor(() => expect(pack).toHaveBeenCalledOnce());
    expect(f.state.items[0]).toMatchObject({
      id: state.items[0].id,
      gallery: { readerTab: true, archive: { staged: 1 } },
    });
    expect(load.mock.calls.map(([, , , useTab]) => useTab)).toEqual([undefined, true]);
    expect(route).toHaveBeenCalledWith(image, firstUrl, true);
  });

  it("內容警告只擱置該作品，其他作品繼續排隊", async () => {
    const f = fixture();
    const imageUrl = vi.fn();
    f.ports.gallery = {
      load: vi.fn(async () => {
        throw Object.assign(new Error("gallery_content_warning"), { code: "gallery_content_warning" });
      }),
      imageUrl,
    };
    await f.engine.command({ kind: "add", urls: [firstUrl], ehentaiMode: "reader" });
    await f.engine.command({ kind: "add", urls: [secondUrl] });
    await f.engine.command({ kind: "start" });
    await vi.waitFor(() => expect(f.state.items[1].status).toBe("verification"));
    expect(f.state.items[0]).toMatchObject({
      status: "blocked",
      reason: "gallery_content_warning",
      gallery: { completed: 0 },
    });
    expect(f.state.activeId).toBe(f.state.items[1].id);
    expect(imageUrl).not.toHaveBeenCalled();
    expect(f.created).toEqual([secondArchive]);
    await f.engine.command({ kind: "retry", id: f.state.items[0].id });
    expect(f.created).toEqual([secondArchive, firstUrl]);
    expect(f.state.items[0].status).toBe("blocked");
  });

  it("同一本的兩種 ZIP 能各自排隊，同模式仍去重", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [firstUrl] });
    const state = await f.engine.command({
      kind: "add",
      urls: [firstUrl, firstUrl + "?p=2"],
      ehentaiMode: "reader",
      titles: { [firstUrl]: "測試圖庫" },
    });
    expect(state.items).toHaveLength(2);
    expect(state.items[0].ehArchive).toEqual({});
    expect(state.items[1]).toMatchObject({
      sourceUrl: firstUrl,
      title: "測試圖庫",
      gallery: { id: "42", output: "zip", completed: 0 },
    });
    expect(state.items[1].ehArchive).toBeUndefined();
  });

  it("背景讀取索引時仍能讀佇列與暫停，不會開官方頁", async () => {
    const f = fixture();
    const load = vi.fn((_id: string, _url?: string, signal?: AbortSignal) =>
      new Promise<GalleryManifest>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
      }),
    );
    f.ports.gallery = { load, imageUrl: vi.fn() };
    await f.engine.command({ kind: "add", urls: [firstUrl], ehentaiMode: "reader" });
    await f.engine.command({ kind: "start" });
    const live = await f.engine.handleRequest({ type: "QC_GET" });
    expect(live.state?.items[0].status).toBe("preparing");
    expect(load).toHaveBeenCalledWith("42", firstUrl, expect.any(AbortSignal));
    await f.engine.command({ kind: "pause" });
    await vi.waitFor(() => expect(f.state.items[0].status).toBe("queued"));
    expect(f.state.running).toBe(false);
    expect(f.ports.gallery.imageUrl).not.toHaveBeenCalled();
    expect(f.created).toEqual([]);
  });

  it("H@H 限流時保留已暫存頁，手動重試從下一頁接續", async () => {
    const f = fixture();
    const manifest: GalleryManifest = {
      id: "42",
      title: "測試圖庫",
      images: ["a", "b"].map((hex, index) => ({
        hash: hex.repeat(64),
        name: `ev01_0${index + 1}.png`,
        source: `https://e-hentai.org/s/${hex.repeat(10)}/42-${index + 1}`,
      })),
    };
    const stagePage = vi.fn<NonNullable<NonNullable<EnginePorts["gallery"]>["archive"]>["stagePage"]>()
      .mockResolvedValueOnce({ staged: 1, bytes: 123 })
      .mockRejectedValueOnce(new Error("gallery_http_429"))
      .mockResolvedValueOnce({ staged: 2, bytes: 246 });
    const pack = vi.fn(() => new Promise<never>(() => {}));
    const imageUrl = "https://test.reader.hath.network/h/a/b/ev01.webp";
    const alternate = vi.fn(async () => "https://reader.hath.network/om/12345678/a-b/c-d/800/e1f2/ev01.webp");
    f.ports.gallery = {
      load: vi.fn(async () => manifest),
      imageUrl: vi.fn(),
      ehentaiImageRoute: vi.fn(async () => ({ url: imageUrl, retry: alternate })),
      archive: { stagePage, pack, cleanup: vi.fn() },
    };
    await f.engine.command({ kind: "add", urls: [firstUrl], ehentaiMode: "reader" });
    await f.engine.command({ kind: "add", urls: [secondUrl] });
    await f.engine.command({ kind: "start" });
    await vi.waitFor(() => expect(f.state.items[0].reason).toBe("gallery_rate_limited"));
    expect(f.state.running).toBe(false);
    expect(f.state.items[0].gallery?.archive).toMatchObject({ staged: 1, bytes: 123 });
    expect(f.state.items[1].status).toBe("queued");
    expect(f.created).toEqual([]);
    expect(alternate).not.toHaveBeenCalled();
    await f.engine.command({ kind: "retry", id: f.state.items[0].id });
    await f.engine.command({ kind: "start" });
    await vi.waitFor(() => expect(pack).toHaveBeenCalledOnce());
    expect(stagePage.mock.calls.map(([input]) => input.index)).toEqual([0, 1, 1]);
    expect(f.ports.gallery.archive?.cleanup).not.toHaveBeenCalled();
  });

  it("佇列尾端只自動重試已暫存圖庫一次，並持久化避免 worker 重啟重跑", async () => {
    const f = fixture();
    const manifest: GalleryManifest = {
      id: "42",
      title: "可續傳圖庫",
      images: ["a", "b"].map((hex, index) => ({
        hash: hex.repeat(64),
        name: `ev01_0${index + 1}.png`,
        source: `https://e-hentai.org/s/${hex.repeat(10)}/42-${index + 1}`,
      })),
    };
    const stagePage = vi.fn<NonNullable<NonNullable<EnginePorts["gallery"]>["archive"]>["stagePage"]>()
      .mockResolvedValueOnce({ staged: 1, bytes: 123 })
      .mockRejectedValueOnce(Object.assign(new Error("gallery_archive_failed"), { code: "gallery_archive_failed" }))
      .mockRejectedValueOnce(Object.assign(new Error("gallery_archive_failed"), { code: "gallery_archive_failed" }));
    const cleanup = vi.fn(async () => {});
    const pack = vi.fn(() => new Promise<never>(() => {}));
    f.ports.gallery = {
      load: vi.fn(async () => manifest),
      imageUrl: vi.fn(async () => "https://test.reader.hath.network/h/a/b/ev01.webp"),
      archive: { stagePage, pack, cleanup },
    };
    await f.engine.command({ kind: "add", urls: [firstUrl], ehentaiMode: "reader" });
    await f.engine.command({ kind: "add", urls: [secondUrl] });
    await f.engine.command({ kind: "start" });

    await vi.waitFor(() => expect(f.state.items[1].status).toBe("verification"));
    expect(f.state.items[0]).toMatchObject({
      status: "failed",
      reason: "gallery_archive_failed",
      gallery: { archive: { staged: 1, bytes: 123 } },
    });
    expect(f.state.items[1].status).toBe("verification");
    expect(f.state.activeId).toBe(f.state.items[1].id);
    expect(stagePage.mock.calls.map(([input]) => input.index)).toEqual([0, 1]);
    expect(f.notifications.filter((id) => id.startsWith("queuecat-cycle-"))).toEqual([]);

    const download = archiveDownload(
      530,
      secondArchive,
      secondArchive,
      f.ports.now() + 1,
    );
    f.downloads.push(download);
    await f.engine.onDownloadCreated(download);
    download.state = "complete";
    await f.engine.onDownloadChanged({
      id: download.id,
      state: { current: "complete" },
    });
    expect(f.state.items[1].status).toBe("complete");

    await vi.waitFor(() => {
      expect(stagePage.mock.calls.map(([input]) => input.index)).toEqual([
        0, 1, 1,
      ]);
      expect(f.state.items[0]).toMatchObject({
        status: "failed",
        reason: "gallery_archive_failed",
        autoRetried: true,
        gallery: { archive: { staged: 1, bytes: 123 } },
      });
      expect(f.state.running).toBe(false);
    });
    expect(f.state.items[0].gallery?.archive?.staged).toBe(1);
    expect(pack).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(f.notifications.filter((id) => id.startsWith("queuecat-cycle-"))).toHaveLength(1);

    const restarted = new QueueEngine(f.ports);
    await restarted.onStartup();
    await restarted.command({ kind: "start" });
    expect(f.notifications.filter((id) => id.startsWith("queuecat-cycle-"))).toHaveLength(1);
    expect(f.state.items[0]).toMatchObject({
      status: "failed",
      autoRetried: true,
      gallery: { archive: { staged: 1, bytes: 123 } },
    });
    expect(stagePage.mock.calls.map(([input]) => input.index)).toEqual([
      0, 1, 1,
    ]);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
