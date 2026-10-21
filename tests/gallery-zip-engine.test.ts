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
  type QueueItem,
} from "../src/shared/types";

const image = (seed: string): GalleryImage => ({
  hash: seed.repeat(64 / seed.length),
  name: `${seed}.jpg`,
});
const manifests: Record<string, GalleryManifest> = {
  "123": { id: "123", title: "Manga/Title:*", images: [image("a1"), image("b2")] },
  "456": { id: "456", title: "Second Book", images: [image("c3"), image("d4")] },
};
const imageUrl = (value: GalleryImage) =>
  `https://w1.gold-usergeneratedcontent.net/1792544401/${Number.parseInt(`${value.hash.at(-1)}${value.hash.slice(-3, -1)}`, 16)}/${value.hash}.webp`;
const blob = () => `blob:chrome-extension://queuecat-test/${crypto.randomUUID()}`;

function fixture(seed?: AppState, hooks: {
  load?: (id: string) => Promise<GalleryManifest>;
  beforeSave?: (state: AppState) => Promise<void>;
  stage?: (index: number) => Promise<{ staged: number; bytes: number }>;
  pack?: () => Promise<{ url: string; bytes: number }>;
  downloads?: DownloadRecord[];
} = {}) {
  let now = 1_800_000_000_000;
  let state = seed;
  const records = hooks.downloads || [];
  const downloadCalls: Array<{ url: string; filename?: string }> = [];
  const stageCalls: Array<{ key: string; index: number; hash: string }> = [];
  let packs = 0;
  const cleaned: string[] = [];
  let nextId = 10;
  const ports: EnginePorts = {
    storage: {
      async get() { return state; },
      async set(value) {
        const next = value["queuecat.state.v1"] as AppState;
        await hooks.beforeSave?.(next);
        state = next;
      },
    },
    tabs: {
      async create() { return { id: 1 }; },
      async get(id) { return { id }; },
      async update() {},
      async send() {},
    },
    downloads: {
      async download(options) {
        downloadCalls.push(options);
        const id = nextId++;
        records.push({
          id,
          url: options.url,
          filename: options.filename,
          state: "in_progress",
          bytesReceived: 0,
          totalBytes: 200,
          paused: false,
          canResume: true,
          byExtensionId: "queuecat-test",
          startTime: new Date(now).toISOString(),
        });
        return id;
      },
      async search(query) {
        return records.filter((record) => {
          const started = Date.parse(record.startTime || "");
          return (query.id === undefined || record.id === query.id) &&
            (query.startedAfter === undefined || started > Date.parse(query.startedAfter)) &&
            (query.startedBefore === undefined || started < Date.parse(query.startedBefore));
        });
      },
      async pause() {}, async resume() {}, async cancel() {}, async show() {},
    },
    gallery: {
      async load(id) {
        return hooks.load ? hooks.load(id) : structuredClone(manifests[id]);
      },
      async imageUrl(value) { return imageUrl(value); },
      archive: {
        async stagePage(input) {
          stageCalls.push({ key: input.key, index: input.index, hash: input.hash });
          return hooks.stage ? hooks.stage(input.index) : { staged: input.index + 1, bytes: (input.index + 1) * 100 };
        },
        async pack() {
          packs++;
          return hooks.pack ? hooks.pack() : { url: blob(), bytes: 200 };
        },
        async cleanup(key) {
          cleaned.push(key);
          throw new Error("cleanup failure is best effort");
        },
      },
    },
    alarms: { async get() { return undefined; }, create() {}, clear() {} },
    async notify() {}, async setBadge() {},
    getUrl(path) { return `chrome-extension://queuecat-test/${path}`; },
    now: () => now,
    extensionId: "queuecat-test",
  };
  const engine = new QueueEngine(ports);
  return {
    engine, ports, records, downloadCalls, stageCalls, cleaned,
    get packs() { return packs; },
    get state() { return state; },
    setNow(value: number) { now = value; },
  };
}

async function waitFor(check: () => boolean, message: string) {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function deferredSave(predicate: (state: AppState) => boolean) {
  let release!: () => void;
  let notifyEntered!: () => void;
  let used = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
  return {
    entered,
    release,
    async beforeSave(state: AppState) {
      if (used || !predicate(state)) return;
      used = true;
      notifyEntered();
      await gate;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function fingerprint(itemId: string, id: string) {
  const manifest = manifests[id];
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ id, title: manifest.title, images: manifest.images })),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function savedZipIntent(options: { archiveFingerprint?: string; url?: string } = {}) {
  const itemId = "zip-item";
  const gallery = manifests["123"];
  const fp = await fingerprint(itemId, "123");
  const zipUrl = options.url || blob();
  const state = initialState();
  state.running = true;
  state.activeId = itemId;
  state.items = [{
    id: itemId,
    sourceUrl: "https://hitomi.la/galleries/123.html",
    title: gallery.title,
    status: "handoff",
    createdAt: 1,
    updatedAt: 1,
    gallery: {
      id: "123", title: gallery.title, images: gallery.images, total: 2,
      completed: 0, output: "zip",
      archive: { key: itemId, fingerprint: fp, staged: 2, bytes: 200, phase: "ready", zipBytes: 200, filename: "QueueCat/123-Manga_Title_.zip" },
    },
    action: {
      id: "action", kind: "download", at: 1_800_000_000_000,
      expectedUrl: zipUrl, archiveFingerprint: options.archiveFingerprint || fp,
    },
    events: [],
  }];
  return state;
}

describe("gallery ZIP engine", () => {
  it("honors a pause requested while the manifest load is pending", async () => {
    let releaseManifest!: (value: GalleryManifest) => void;
    let manifestStarted!: () => void;
    const started = new Promise<void>((resolve) => { manifestStarted = resolve; });
    const f = fixture(undefined, {
      load: () => new Promise((resolve) => {
        releaseManifest = resolve;
        manifestStarted();
      }),
    });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    const start = f.engine.command({ kind: "start" });
    await started;
    const pause = f.engine.command({ kind: "pause" });
    releaseManifest(structuredClone(manifests["123"]));
    await Promise.all([start, pause]);
    expect(f.state?.running).toBe(false);
    expect(f.state?.activeId).toBeUndefined();
    expect(f.state?.items[0].status).toBe("queued");
    expect(f.state?.items[0].gallery?.images).toHaveLength(2);
    expect(f.stageCalls).toHaveLength(0);
    expect(f.packs).toBe(0);
    expect(f.downloadCalls).toHaveLength(0);
  });

  it("does not stage the next page when pause arrives during receipt persistence", async () => {
    const barrier = deferredSave((state) =>
      state.items[0]?.status === "queued" &&
      state.items[0]?.gallery?.archive?.staged === 1,
    );
    const f = fixture(undefined, { beforeSave: barrier.beforeSave });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    const start = f.engine.command({ kind: "start" });
    await start;
    await barrier.entered;
    const pause = f.engine.command({ kind: "pause" });
    barrier.release();
    await pause;
    expect(f.stageCalls.map((call) => call.index)).toEqual([0]);
    expect(f.state?.items[0].gallery?.archive?.staged).toBe(1);
    expect(f.state?.items[0].status).toBe("queued");
    expect(f.state?.activeId).toBeUndefined();
    expect(f.downloadCalls).toHaveLength(0);
  });

  it("preserves packed readiness but does not hand off when pause lands during pack save", async () => {
    const barrier = deferredSave((state) =>
      state.items[0]?.gallery?.archive?.phase === "ready" &&
      state.items[0]?.action === undefined,
    );
    const f = fixture(undefined, { beforeSave: barrier.beforeSave });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    const start = f.engine.command({ kind: "start" });
    await start;
    await barrier.entered;
    const pause = f.engine.command({ kind: "pause" });
    barrier.release();
    await pause;
    expect(f.packs).toBe(1);
    expect(f.state?.items[0].gallery?.archive?.phase).toBe("ready");
    expect(f.state?.items[0].status).toBe("queued");
    expect(f.state?.items[0].action).toBeUndefined();
    expect(f.downloadCalls).toHaveLength(0);
  });

  it("clears an unsent ZIP intent when pause lands during handoff persistence", async () => {
    const barrier = deferredSave((state) =>
      state.items[0]?.status === "handoff" &&
      state.items[0]?.action?.kind === "download",
    );
    const f = fixture(undefined, { beforeSave: barrier.beforeSave });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    const start = f.engine.command({ kind: "start" });
    await start;
    await barrier.entered;
    const pause = f.engine.command({ kind: "pause" });
    barrier.release();
    await pause;
    expect(f.state?.items[0].status).toBe("queued");
    expect(f.state?.items[0].action).toBeUndefined();
    expect(f.state?.items[0].gallery?.archive?.phase).toBe("ready");
    expect(f.downloadCalls).toHaveLength(0);
  });

  it("continues after a staged page returns after an applied pause then start", async () => {
    const gate = deferred<{ staged: number; bytes: number }>();
    const entered = deferred<void>();
    let deferFirstPage = true;
    const f = fixture(undefined, {
      stage: (index) => {
        if (index === 0 && deferFirstPage) {
          deferFirstPage = false;
          entered.resolve();
          return gate.promise;
        }
        return Promise.resolve({ staged: index + 1, bytes: (index + 1) * 100 });
      },
    });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    await f.engine.handleRequest({ type: "QC_COMMAND", command: { kind: "start" } });
    await entered.promise;
    await f.engine.handleRequest({ type: "QC_COMMAND", command: { kind: "pause" } });
    await f.engine.handleRequest({ type: "QC_COMMAND", command: { kind: "start" } });
    gate.resolve({ staged: 1, bytes: 100 });
    await waitFor(() => f.downloadCalls.length === 1, "handoff after stage callback");
    expect(f.state?.running).toBe(true);
    expect(f.state?.items[0].status).toBe("downloading");
    expect(f.stageCalls.map((call) => call.index)).toEqual([0, 1]);
  });

  it("hands off a packed ZIP when pack returns after an applied pause then start", async () => {
    const gate = deferred<{ url: string; bytes: number }>();
    const entered = deferred<void>();
    const f = fixture(undefined, {
      pack: () => { entered.resolve(); return gate.promise; },
    });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    await f.engine.command({ kind: "start" });
    await entered.promise;
    await f.engine.command({ kind: "pause" });
    await f.engine.command({ kind: "start" });
    gate.resolve({ url: blob(), bytes: 200 });
    await waitFor(() => f.downloadCalls.length === 1, "handoff after pack callback");
    expect(f.state?.running).toBe(true);
    expect(f.state?.items[0].gallery?.archive?.phase).toBe("ready");
    expect(f.state?.items[0].status).toBe("downloading");
  });

  it("continues the queue when an archive error returns after pause then start", async () => {
    const gate = deferred<{ staged: number; bytes: number }>();
    const entered = deferred<void>();
    let deferFirstPage = true;
    const f = fixture(undefined, {
      stage: (index) => {
        if (index === 0 && deferFirstPage) {
          deferFirstPage = false;
          entered.resolve();
          return gate.promise;
        }
        return Promise.resolve({ staged: index + 1, bytes: (index + 1) * 100 });
      },
    });
    await f.engine.command({ kind: "add", urls: [
      "https://hitomi.la/galleries/123.html", "https://hitomi.la/galleries/456.html",
    ] });
    await f.engine.command({ kind: "start" });
    await entered.promise;
    await f.engine.command({ kind: "pause" });
    await f.engine.command({ kind: "start" });
    gate.reject(new Error("gallery_archive_failed"));
    await waitFor(() => f.state?.items[0].status === "failed", "failed first gallery");
    await waitFor(() => f.downloadCalls.length === 1, "second gallery ZIP handoff");
    expect(f.state?.running).toBe(true);
    expect(f.state?.items[1].status).toBe("downloading");
    expect(f.downloadCalls).toHaveLength(1);
  });

  it("downloads two galleries as exactly one ZIP each and completes only after Chrome completes", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [
      "https://hitomi.la/galleries/123.html", "https://hitomi.la/galleries/456.html",
    ] });
    expect(f.state?.items.map((item) => item.gallery?.output)).toEqual(["zip", "zip"]);
    await f.engine.command({ kind: "start" });
    await waitFor(() => f.downloadCalls.length === 1, "first zip handoff");
    let first = f.state!.items[0];
    expect(first.gallery?.archive?.staged).toBe(2);
    expect(first.gallery?.completed).toBe(0);
    expect(first.status).toBe("downloading");
    expect(f.downloadCalls[0].filename).toBe("QueueCat/123-Manga_Title__.zip");
    f.records[0].state = "complete";
    await f.engine.onDownloadChanged({ id: f.records[0].id, state: { current: "complete" } });
    await waitFor(() => f.downloadCalls.length === 2, "second zip handoff");
    first = f.state!.items[0];
    expect(first.status).toBe("complete");
    expect(first.gallery?.completed).toBe(2);
    expect(first.gallery?.images).toBeUndefined();
    expect(f.records.length).toBe(2);
    f.records[1].state = "complete";
    await f.engine.onDownloadChanged({ id: f.records[1].id, state: { current: "complete" } });
    expect(f.state!.items.every((item) => item.status === "complete")).toBe(true);
    expect(f.downloadCalls).toHaveLength(2);
    expect(f.cleaned).toHaveLength(2);
  });

  it("commits an in-flight page after pause without staging again or handing off", async () => {
    let releaseStage!: (value: { staged: number; bytes: number }) => void;
    let stageStarted!: () => void;
    const started = new Promise<void>((resolve) => { stageStarted = resolve; });
    const f = fixture(undefined, {
      stage: () => new Promise((resolve) => { releaseStage = resolve; stageStarted(); }),
    });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    await f.engine.command({ kind: "start" });
    await started;
    const paused = await f.engine.command({ kind: "pause" });
    expect(paused.running).toBe(false);
    releaseStage({ staged: 1, bytes: 100 });
    await waitFor(() => f.state?.items[0].gallery?.archive?.staged === 1 && f.state?.activeId === undefined, "paused receipt commit");
    expect(f.downloadCalls).toHaveLength(0);
    expect(f.packs).toBe(0);
    expect(f.state!.items[0].status).toBe("queued");
  });

  it("recovers a saved ZIP action by exact URL without packing or sending another download", async () => {
    const intent = await savedZipIntent();
    const action = intent.items[0].action!;
    const record: DownloadRecord = {
      id: 77, url: action.expectedUrl!, state: "in_progress", bytesReceived: 10,
      totalBytes: 200, paused: false, canResume: true, byExtensionId: "queuecat-test",
      startTime: new Date(action.at).toISOString(),
    };
    const f = fixture(intent, { downloads: [record] });
    await f.engine.onStartup();
    expect(f.packs).toBe(0);
    expect(f.downloadCalls).toHaveLength(0);
    expect(f.state!.items[0].downloadId).toBe(77);
    expect(f.state!.items[0].status).toBe("downloading");
  });

  it("adopts a stage receipt one page ahead, bounded by the current stage", async () => {
    const f = fixture(undefined, { stage: async (index) => ({ staged: index + 1, bytes: 321 }) });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    await f.engine.command({ kind: "start" });
    await waitFor(() => f.downloadCalls.length === 1, "zip after receipt reconciliation");
    expect(f.state!.items[0].gallery?.archive?.staged).toBe(2);
    expect(f.stageCalls.map((call) => call.index)).toEqual([0, 1]);
  });

  it("rejects a receipt jump beyond one unpersisted page", async () => {
    const f = fixture(undefined, {
      stage: async () => ({ staged: 2, bytes: 200 }),
    });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    await f.engine.command({ kind: "start" });
    await waitFor(() => f.state?.items[0].status === "failed", "invalid receipt jump");
    expect(f.state!.items[0].reason).toBe("gallery_archive_failed");
    expect(f.state!.items[0].gallery?.archive?.staged).toBe(0);
    expect(f.packs).toBe(0);
  });

  it("normalizes archive error messages from the port", async () => {
    const cases = [
      ["gallery_archive_stage_missing", "gallery_archive_missing"],
      ["gallery_archive_receipt_mismatch", "gallery_archive_missing"],
      ["gallery_archive_receipt_invalid", "gallery_archive_missing"],
      ["gallery_archive_quota", "gallery_archive_limit"],
      ["network connection lost", "gallery_request_failed"],
    ];
    for (const [message, reason] of cases) {
      const f = fixture(undefined, {
        stage: async () => { throw new Error(message); },
      });
      await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
      await f.engine.command({ kind: "start" });
      await waitFor(() => f.state?.items[0].status === "failed", `archive error ${message}`);
      expect(f.state!.items[0].reason).toBe(reason);
      expect(f.state!.items[0].gallery?.archive?.staged).toBe(0);
    }
    const packFailure = fixture(undefined, {
      pack: async () => { throw new Error("gallery_archive_failed"); },
    });
    await packFailure.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    await packFailure.engine.command({ kind: "start" });
    await waitFor(() => packFailure.state?.items[0].status === "failed", "pack error mapping");
    expect(packFailure.state!.items[0].reason).toBe("gallery_archive_failed");
    expect(packFailure.state!.items[0].gallery?.archive?.staged).toBe(2);
  });

  it("retains staged progress on archive failure and retries from that index", async () => {
    let failed = false;
    const f = fixture(undefined, {
      stage: async (index) => {
        if (index === 1 && !failed) { failed = true; throw new Error("gallery_archive_quota"); }
        return { staged: index + 1, bytes: (index + 1) * 100 };
      },
    });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    await f.engine.command({ kind: "start" });
    await waitFor(() => f.state?.items[0].status === "failed", "archive stage failure");
    expect(f.state!.items[0].gallery?.archive?.staged).toBe(1);
    expect(f.state!.items[0].reason).toBe("gallery_archive_limit");
    await f.engine.command({ kind: "retry", id: f.state!.items[0].id });
    await f.engine.command({ kind: "start" });
    await waitFor(() => f.downloadCalls.length === 1, "retry from retained stage");
    expect(f.stageCalls.map((call) => call.index)).toEqual([0, 1, 1]);
  });

  it("cleans and restarts from page zero after an explicit missing-archive retry", async () => {
    let missingOnce = true;
    const f = fixture(undefined, {
      stage: async (index) => {
        if (index === 1 && missingOnce) {
          missingOnce = false;
          throw new Error("gallery_archive_stage_missing");
        }
        return { staged: index + 1, bytes: (index + 1) * 100 };
      },
    });
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    await f.engine.command({ kind: "start" });
    await waitFor(() => f.state?.items[0].status === "failed", "missing staged page");
    const itemId = f.state!.items[0].id;
    expect(f.state!.items[0].reason).toBe("gallery_archive_missing");
    expect(f.state!.items[0].gallery?.archive?.staged).toBe(1);

    await f.engine.command({ kind: "retry", id: itemId });
    expect(f.cleaned).toEqual([itemId]);
    expect(f.state!.items[0].gallery?.archive).toBeUndefined();
    await f.engine.command({ kind: "start" });
    await waitFor(() => f.downloadCalls.length === 1, "archive rebuilt from first page");
    expect(f.stageCalls.map((call) => call.index)).toEqual([0, 1, 0, 1]);
  });

  it("rejects a mismatched fingerprint and a foreign Blob URL", async () => {
    const mismatch = await savedZipIntent({ archiveFingerprint: "b".repeat(64) });
    const f1 = fixture(mismatch);
    await f1.engine.onStartup();
    expect(f1.state!.items[0].status).toBe("blocked");
    expect(f1.downloadCalls).toHaveLength(0);
    const foreign = await savedZipIntent({ url: "blob:https://example.com/00000000-0000-4000-8000-000000000000" });
    const f2 = fixture(foreign);
    await f2.engine.onStartup();
    expect(f2.state!.items[0].status).toBe("blocked");
    expect(f2.downloadCalls).toHaveLength(0);
  });

  it("does not repeat a completed ZIP download when private cleanup fails", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: ["https://hitomi.la/galleries/123.html"] });
    await f.engine.command({ kind: "start" });
    await waitFor(() => f.downloadCalls.length === 1, "zip handoff");
    f.records[0].state = "complete";
    await f.engine.onDownloadChanged({ id: f.records[0].id, state: { current: "complete" } });
    expect(f.state!.items[0].status).toBe("complete");
    await f.engine.onStartup();
    expect(f.downloadCalls).toHaveLength(1);
    expect(f.cleaned).toEqual([f.state!.items[0].id]);
  });
});
