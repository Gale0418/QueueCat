import { describe, expect, it } from "vitest";
import {
  QueueEngine,
  type DownloadRecord,
  type EnginePorts,
} from "../src/background/engine";
import {
  initialState,
  type AppState,
  type GalleryImage,
  type GalleryManifest,
} from "../src/shared/types";

const source = "https://hitomi.la/galleries/123.html";
const baseManifest: GalleryManifest = {
  id: "123",
  title: "Manga/Title:*",
  images: [
    { hash: "a1b2c3d4".repeat(8), name: "first.jpg" },
    { hash: "b2c3d4e5".repeat(8), name: "second.png" },
  ],
};
const imageUrlFor = (image: GalleryImage) =>
  `https://w1.gold-usergeneratedcontent.net/1792544401/${Number.parseInt(`${image.hash.at(-1)}${image.hash.slice(-3, -1)}`, 16)}/${image.hash}.webp`;

function fixture(seed?: AppState) {
  let now = 1_800_000_000_000;
  let state = seed;
  let manifest = structuredClone(baseManifest);
  let imageUrl = imageUrlFor;
  const downloads: DownloadRecord[] = [];
  const options: Array<{ url: string; filename?: string }> = [];
  const shown: number[] = [];
  const canceled: number[] = [];
  const openedTabs: string[] = [];
  let nextId = 100;
  let manifestLoads = 0;
  let writes = 0;
  const ports: EnginePorts = {
    storage: {
      async get() {
        return state;
      },
      async set(value) {
        writes++;
        state = value["queuecat.state.v1"] as AppState;
      },
    },
    tabs: {
      async create(url) {
        openedTabs.push(url);
        return { id: 1 };
      },
      async get(id) {
        return { id };
      },
      async update() {},
      async send() {
        return { ok: true };
      },
    },
    downloads: {
      async download(value) {
        options.push(value);
        const id = nextId++;
        downloads.push({
          id,
          url: value.url,
          filename: value.filename,
          state: "in_progress",
          bytesReceived: 0,
          totalBytes: 100,
          paused: false,
          canResume: true,
          byExtensionId: "queuecat-test",
          startTime: new Date(now).toISOString(),
        });
        return id;
      },
      async search(query) {
        return downloads.filter((download) => {
          const started = Date.parse(download.startTime || "");
          return (
            (query.id === undefined || download.id === query.id) &&
            (query.state === undefined || download.state === query.state) &&
            (query.startedAfter === undefined ||
              started > Date.parse(query.startedAfter)) &&
            (query.startedBefore === undefined ||
              started < Date.parse(query.startedBefore))
          );
        });
      },
      async pause() {},
      async resume() {},
      async cancel(id) {
        canceled.push(id);
      },
      async show(id) {
        shown.push(id);
      },
    },
    gallery: {
      async load(id) {
        manifestLoads++;
        if (id !== manifest.id) throw new Error("gallery not found");
        return structuredClone(manifest);
      },
      async imageUrl(image) {
        return imageUrl(image);
      },
    },
    alarms: {
      async get() {
        return undefined;
      },
      create() {},
      clear() {},
    },
    async notify() {},
    async setBadge() {},
    getUrl(path) {
      return `chrome-extension://queuecat-test/${path}`;
    },
    now: () => now,
    extensionId: "queuecat-test",
  };
  const engine = new QueueEngine(ports);
  return {
    engine,
    ports,
    downloads,
    options,
    shown,
    canceled,
    openedTabs,
    setManifest(value: GalleryManifest) {
      manifest = structuredClone(value);
    },
    setImageUrl(fn: (image: GalleryImage) => string) {
      imageUrl = fn;
    },
    setNow(value: number) {
      now = value;
    },
    get manifestLoads() {
      return manifestLoads;
    },
    get writes() {
      return writes;
    },
    get state() {
      return state;
    },
  };
}

async function addAndStart(f: ReturnType<typeof fixture>) {
  await f.engine.command({ kind: "add", urls: [source] });
  await f.engine.command({ kind: "start" });
}

async function complete(f: ReturnType<typeof fixture>, index: number) {
  const download = f.downloads[index];
  download.state = "complete";
  download.bytesReceived = download.totalBytes;
  await f.engine.onDownloadChanged({
    id: download.id,
    state: { current: "complete" },
  });
}

function handoffState(at: number, expectedUrl: string): AppState {
  const state = initialState();
  state.running = true;
  state.activeId = "item-1";
  state.items = [
    {
      id: "item-1",
      sourceUrl: source,
      title: baseManifest.title,
      status: "handoff",
      createdAt: at,
      updatedAt: at,
      gallery: {
        id: "123",
        title: baseManifest.title,
        folder: "QueueCat/Hitomi-123-item1-Manga_Title__",
        images: structuredClone(baseManifest.images),
        total: 2,
        completed: 0,
      },
      action: { id: "action-1", kind: "download", at, expectedUrl },
      events: [],
    },
  ];
  return state;
}

describe("Hitomi 圖庫佇列引擎", () => {
  const blob =
    "blob:chrome-extension://queuecat-test/12345678-1234-1234-1234-123456789abc";
  it("persists the source and exact owned Blob before Chrome handoff, then releases after completion", async () => {
    const f = fixture();
    const released: string[] = [];
    f.ports.gallery!.prepare = async (url) => {
      expect(url).toBe(imageUrlFor(baseManifest.images[0]));
      expect(f.options).toHaveLength(0);
      return blob;
    };
    f.ports.gallery!.release = async (url) => {
      released.push(url);
    };
    await addAndStart(f);
    await f.engine.handleRequest({ type: "QC_GET" });
    expect(f.state?.items[0].action).toMatchObject({
      expectedUrl: blob,
      sourceImageUrl: imageUrlFor(baseManifest.images[0]),
    });
    expect(f.options[0].url).toBe(blob);
    await f.engine.command({ kind: "pause" });
    await complete(f, 0);
    expect(released).toEqual([blob]);
    expect(f.state?.items[0].gallery?.completed).toBe(1);
    expect(f.options).toHaveLength(1);
  });
  it("does not create a download when pause arrives during image preparation", async () => {
    const f = fixture();
    let ready!: () => void;
    const entered = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let finish!: (url: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const released: string[] = [];
    f.ports.gallery!.prepare = async () => {
      ready();
      return pending;
    };
    f.ports.gallery!.release = async (url) => {
      released.push(url);
    };
    await f.engine.command({ kind: "add", urls: [source] });
    const started = f.engine.command({ kind: "start" });
    await entered;
    const paused = f.engine.command({ kind: "pause" });
    await paused;
    expect(f.state?.running).toBe(false);
    expect(f.options).toHaveLength(0);
    finish(blob);
    await Promise.all([started, paused]);
    await f.engine.handleRequest({ type: "QC_GET" });
    expect(f.options).toHaveLength(0);
    expect(f.state?.running).toBe(false);
    expect(f.state?.items[0].status).toBe("queued");
    expect(released).toEqual([blob]);
  });
  it("recovers an owned Blob handoff after worker restart without sending again", async () => {
    const f = fixture();
    let prepared = 0;
    f.ports.gallery!.prepare = async () => {
      prepared++;
      return blob;
    };
    await addAndStart(f);
    await f.engine.handleRequest({ type: "QC_GET" });
    const item = f.state!.items[0];
    item.downloadId = undefined;
    item.status = "handoff";
    await new QueueEngine(f.ports).onStartup();
    expect(f.options).toHaveLength(1);
    expect(prepared).toBe(1);
    expect(f.state?.items[0].downloadId).toBe(f.downloads[0].id);
  });
  it("rejects a Blob from another extension without launching Chrome", async () => {
    const f = fixture();
    f.ports.gallery!.prepare = async () =>
      blob.replace("queuecat-test", "other-extension");
    await addAndStart(f);
    await f.engine.handleRequest({ type: "QC_GET" });
    expect(f.state?.items[0].status).toBe("blocked");
    expect(f.options).toHaveLength(0);
  });
  it.each([true, false])(
    "keeps source focus for blocked metadata and Katfile items (gallery=%s)",
    async (gallery) => {
      const seed = handoffState(
        1_800_000_000_000,
        imageUrlFor(baseManifest.images[0]),
      );
      const item = seed.items[0];
      item.status = "blocked";
      item.action = undefined;
      if (!gallery) {
        item.gallery = undefined;
        item.sourceUrl = "https://katfile.biz/abcdefghijkl/file.rar.html";
      }
      const f = fixture(seed);
      await f.engine.command({ kind: "focus", id: item.id });
      expect(f.openedTabs.at(-1)).toBe(item.sourceUrl);
    },
  );
  it("treats a canceled dangerous image as terminal instead of blocking forever", async () => {
    const f = fixture();
    await addAndStart(f);
    Object.assign(f.downloads[0], {
      state: "interrupted",
      danger: "dangerous",
      error: "USER_CANCELED",
      canResume: false,
    });
    await f.engine.onDownloadChanged({
      id: f.downloads[0].id,
      state: { current: "interrupted" },
    });
    expect(f.state?.items[0].status).toBe("failed");
    expect(f.state?.activeId).toBeUndefined();
    expect(f.options).toHaveLength(1);
  });
  it("uses one queue item and downloads images serially into a sanitized gallery folder", async () => {
    const f = fixture();
    await addAndStart(f);

    expect(f.state?.items).toHaveLength(1);
    expect(f.state?.items[0].gallery).toMatchObject({
      id: "123",
      title: baseManifest.title,
      total: 2,
      completed: 0,
    });
    expect(f.options).toHaveLength(1);
    const folder = f.state!.items[0].gallery!.folder!;
    expect(folder).toMatch(/^QueueCat\/Hitomi-123-[a-z0-9]{12}-Manga_Title__$/);
    expect(f.options[0]).toMatchObject({
      filename: `${folder}/0001.webp`,
    });

    await complete(f, 0);
    expect(f.state?.items[0].title).toBe(baseManifest.title);
    expect(f.options).toHaveLength(2);
    expect(f.options[1].filename).toBe(`${folder}/0002.webp`);
    expect(f.state?.items[0].gallery?.completed).toBe(1);

    await complete(f, 1);
    const item = f.state!.items[0];
    expect(item.status).toBe("complete");
    expect(item.title).toBe(baseManifest.title);
    expect(item.gallery).toMatchObject({ completed: 2, total: 2 });
    expect(item.gallery?.images).toBeUndefined();
    await f.engine.command({ kind: "show-file", id: item.id });
    expect(f.shown).toEqual([f.downloads[1].id]);
  });

  it("pause lets the active image finish and resumes at the first incomplete image", async () => {
    const f = fixture();
    await addAndStart(f);
    await f.engine.command({ kind: "pause" });
    await complete(f, 0);

    expect(f.state?.running).toBe(false);
    expect(f.state?.items[0].status).toBe("queued");
    expect(f.state?.items[0].gallery?.completed).toBe(1);
    expect(f.downloads).toHaveLength(1);

    const restarted = new QueueEngine(f.ports);
    await restarted.onStartup();
    expect(f.downloads).toHaveLength(1);
    await restarted.command({ kind: "start" });
    expect(f.downloads).toHaveLength(2);
    expect(f.options[1].filename).toContain("/0002.webp");
    expect(f.manifestLoads).toBe(2);
  });

  it("recovers a persisted handoff only from one matching extension download", async () => {
    const at = 1_800_000_000_000;
    const expectedUrl = imageUrlFor(baseManifest.images[0]);
    const state = handoffState(at, expectedUrl);
    const f = fixture(state);
    f.downloads.push({
      id: 77,
      url: expectedUrl,
      filename: `${state.items[0].gallery?.folder}/0001.webp`,
      state: "in_progress",
      bytesReceived: 25,
      totalBytes: 100,
      paused: false,
      canResume: true,
      byExtensionId: "queuecat-test",
      startTime: new Date(at + 10).toISOString(),
    });

    await new QueueEngine(f.ports).onStartup();
    expect(f.state?.items[0]).toMatchObject({
      status: "downloading",
      downloadId: 77,
      gallery: { completed: 0 },
    });
    expect(f.options).toHaveLength(0);
  });

  it("binds an owned onCreated event only to its exact saved gallery handoff", async () => {
    const at = 1_800_000_000_000;
    const expectedUrl = imageUrlFor(baseManifest.images[0]);
    const f = fixture(handoffState(at, expectedUrl));
    const owned: DownloadRecord = {
      id: 79,
      url: expectedUrl,
      state: "in_progress",
      bytesReceived: 10,
      totalBytes: 100,
      paused: false,
      canResume: true,
      byExtensionId: "queuecat-test",
      startTime: new Date(at + 5).toISOString(),
    };
    f.downloads.push(owned);

    await f.engine.onDownloadCreated(owned);
    expect(f.state?.items[0]).toMatchObject({
      status: "downloading",
      downloadId: 79,
      gallery: { completed: 0 },
    });
    expect(f.options).toHaveLength(0);
  });

  it("does not claim a matching Hitomi download created outside this extension", async () => {
    const at = 1_800_000_000_000;
    const expectedUrl = imageUrlFor(baseManifest.images[0]);
    const f = fixture(handoffState(at, expectedUrl));
    const external: DownloadRecord = {
      id: 78,
      url: expectedUrl,
      state: "in_progress",
      bytesReceived: 10,
      totalBytes: 100,
      paused: false,
      canResume: true,
      byExtensionId: "another-extension",
      startTime: new Date(at + 5).toISOString(),
    };
    f.downloads.push(external);

    await f.engine.onDownloadCreated(external);
    expect(f.state?.items[0]).toMatchObject({
      status: "handoff",
      gallery: { completed: 0 },
    });
    expect(f.state?.items[0].downloadId).toBeUndefined();
    expect(f.options).toHaveLength(0);
  });

  it("retries a failed page from the saved cursor without downloading the completed prefix again", async () => {
    const f = fixture();
    await addAndStart(f);
    await complete(f, 0);
    const failed = f.downloads[1];
    failed.state = "interrupted";
    failed.canResume = false;
    failed.error = "NETWORK_FAILED";
    await f.engine.onDownloadChanged({
      id: failed.id,
      state: { current: "interrupted" },
      canResume: { current: false },
    });

    expect(f.state?.items[0]).toMatchObject({
      status: "failed",
      gallery: { completed: 1 },
    });
    await f.engine.command({ kind: "retry", id: f.state!.items[0].id });
    await f.engine.command({ kind: "start" });
    expect(f.options).toHaveLength(3);
    expect(f.options[2].filename).toContain("/0002.webp");
    expect(f.state?.items[0].gallery?.completed).toBe(1);
  });

  it("blocks retry when the remote manifest changed after a completed prefix", async () => {
    const f = fixture();
    await addAndStart(f);
    await complete(f, 0);
    await f.engine.command({ kind: "pause" });
    const current = f.downloads[1];
    current.state = "interrupted";
    current.canResume = false;
    current.error = "NETWORK_FAILED";
    await f.engine.onDownloadChanged({
      id: current.id,
      state: { current: "interrupted" },
      canResume: { current: false },
    });
    f.setManifest({
      ...baseManifest,
      images: [
        { hash: "f".repeat(64), name: "changed.jpg" },
        ...baseManifest.images.slice(1),
      ],
    });
    await f.engine.command({ kind: "retry", id: f.state!.items[0].id });
    await f.engine.command({ kind: "start" });

    expect(f.state?.items[0]).toMatchObject({
      status: "blocked",
      gallery: { completed: 1, total: 2 },
    });
    expect(f.state?.items[0].reason).toMatch(/內容或標題已變更/);
    expect(f.options).toHaveLength(2);
    const oldFolder = f.state!.items[0].gallery!.folder;
    await f.engine.command({ kind: "remove", id: f.state!.items[0].id });
    expect(f.state?.activeId).toBeUndefined();
    expect(f.state?.items).toHaveLength(0);
    await addAndStart(f);
    expect(f.state!.items[0].gallery!.folder).not.toBe(oldFolder);
  });

  it("requires confirmed forget-and-pause without resending an ambiguous handoff", async () => {
    const at = 1_800_000_000_000;
    const url = imageUrlFor(baseManifest.images[0]);
    const f = fixture(handoffState(at, url));
    for (const id of [71, 72])
      f.downloads.push({
        id,
        url,
        state: "in_progress",
        bytesReceived: 0,
        totalBytes: 100,
        paused: false,
        canResume: true,
        byExtensionId: "queuecat-test",
        startTime: new Date(at + 5).toISOString(),
      });
    await f.engine.onStartup();
    expect(f.state?.items[0].status).toBe("blocked");
    await expect(
      f.engine.command({ kind: "remove", id: "item-1" }),
    ).rejects.toThrow();
    await expect(
      f.engine.command({ kind: "retry", id: "item-1" }),
    ).rejects.toThrow(/不會重新發起/);
    expect(f.options).toHaveLength(0);
    expect(f.state?.items[0].status).toBe("blocked");
    await f.engine.command({ kind: "focus", id: "item-1" });
    expect(f.openedTabs.at(-1)).toBe("chrome://downloads/");
    await f.engine.command({
      kind: "add",
      urls: ["https://katfile.biz/abcdefghijkl/file.rar.html"],
    });
    await f.engine.command({
      kind: "remove",
      id: "item-1",
      confirmUncertain: true,
    });
    expect(f.state?.running).toBe(false);
    expect(f.state?.activeId).toBeUndefined();
    expect(f.state?.items).toHaveLength(1);
    expect(f.state?.items[0].status).toBe("queued");
    expect(f.options).toHaveLength(0);
    expect(f.downloads).toHaveLength(2);
    expect(f.canceled).toHaveLength(0);
  });

  it.each([
    "gallery_unavailable",
    "gallery_invalid_metadata",
    "gallery_invalid_routing",
    "gallery_request_failed",
  ])("preserves typed metadata error %s", async (code) => {
    const f = fixture();
    f.ports.gallery!.load = async () => {
      throw Object.assign(new Error("adapter failure"), { code });
    };
    await addAndStart(f);
    expect(f.state?.items[0].reason).toBe(code);
    expect(f.downloads).toHaveLength(0);
  });

  it("rejects a persisted handoff pointing outside the image origin", async () => {
    const f = fixture(
      handoffState(1_800_000_000_000, "https://example.net/image.webp"),
    );
    await f.engine.onStartup();
    expect(f.state?.items[0].status).toBe("blocked");
    expect(f.options).toHaveLength(0);
  });

  it("queues a gallery retry behind an already active Katfile item", async () => {
    const f = fixture();
    f.setImageUrl(() => {
      throw new Error("offline");
    });
    await f.engine.command({
      kind: "add",
      urls: [source, "https://katfile.biz/abcdefghijkl/file.rar.html"],
    });
    await f.engine.command({ kind: "start" });
    const [gallery, katfile] = f.state!.items;
    expect(gallery.status).toBe("failed");
    expect(f.state?.activeId).toBe(katfile.id);
    f.setImageUrl(imageUrlFor);
    await f.engine.command({ kind: "retry", id: gallery.id });
    expect(f.state?.activeId).toBe(katfile.id);
    expect(f.state?.items[0].status).toBe("queued");
    expect(f.options).toHaveLength(0);
  });

  it("immediately advances the queue after safely removing a blocked gallery", async () => {
    const f = fixture();
    f.setImageUrl(() => "https://example.net/unsafe.webp");
    await f.engine.command({
      kind: "add",
      urls: [source, "https://katfile.biz/abcdefghijkl/file.rar.html"],
    });
    await f.engine.command({ kind: "start" });
    const [gallery, katfile] = f.state!.items;
    expect(f.state?.activeId).toBe(gallery.id);
    await f.engine.command({ kind: "remove", id: gallery.id });
    expect(f.state?.activeId).toBe(katfile.id);
    expect(f.state?.items[0].status).toBe("preparing");
  });

  it("rejects unsafe image hosts and gallery extraction before creating an item", async () => {
    const extraction = fixture();
    const before = extraction.writes;
    await expect(
      extraction.engine.command({
        kind: "add",
        urls: [source],
        extraction: { password: "secret" },
      }),
    ).rejects.toThrow("gallery_extraction_not_supported");
    expect(extraction.writes).toBe(before);
    expect(extraction.state).toBeUndefined();

    const unsafe = fixture();
    unsafe.setImageUrl((image) => `https://example.net/${image.hash}.webp`);
    await addAndStart(unsafe);
    expect(unsafe.state?.items[0].status).toBe("blocked");
    expect(unsafe.downloads).toHaveLength(0);
  });
});
