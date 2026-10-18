import { describe, expect, it } from "vitest";
import {
  QueueEngine,
  type DownloadRecord,
  type EnginePorts,
} from "../src/background/engine";
import type { AppState } from "../src/shared/types";

function fixture(seed?: AppState) {
  let now = 1_800_000_000_000;
  let state: AppState | undefined = seed;
  let failStorage = false;
  let writes = 0;
  let activeAlarm: number | undefined;
  let tabMissing = false;
  let strictDates = false;
  const created: string[] = [];
  const actions: unknown[] = [];
  const alarms: number[] = [];
  const notifications: string[] = [];
  let sendReply: unknown = { ok: true };
  let sendUnavailable = false;
  const downloads: DownloadRecord[] = [];
  const ports: EnginePorts = {
    storage: {
      async get() {
        return state;
      },
      async set(v) {
        if (failStorage) throw new Error("storage denied");
        writes++;
        state = v["queuecat.state.v1"] as AppState;
      },
    },
    tabs: {
      async create(url) {
        created.push(url);
        return { id: created.length };
      },
      async get(id) {
        if (tabMissing) throw new Error("tab closed");
        const item = state?.items.find((x) => x.tabId === id);
        return { id, url: item?.sourceUrl };
      },
      async update() {},
      async send(_id, m) {
        actions.push(m);
        if (sendUnavailable) throw new Error("no receiving content script");
        return sendReply;
      },
    },
    downloads: {
      async download(options) {
        downloads.push({
          id: 77,
          url: options.url,
          state: "in_progress",
          bytesReceived: 0,
          totalBytes: -1,
          paused: false,
          canResume: true,
          danger: "safe",
          byExtensionId: "test",
          startTime: new Date(now).toISOString(),
        });
        return 77;
      },
      async search(q) {
        return downloads.filter(
          (d) =>
            (q.id === undefined || d.id === q.id) &&
            (q.state === undefined || d.state === q.state) &&
            (q.startedAfter === undefined ||
              (strictDates
                ? Date.parse(d.startTime || "") > Date.parse(q.startedAfter)
                : Date.parse(d.startTime || "") >=
                  Date.parse(q.startedAfter))) &&
            (q.startedBefore === undefined ||
              (strictDates
                ? Date.parse(d.startTime || "") < Date.parse(q.startedBefore)
                : Date.parse(d.startTime || "") <=
                  Date.parse(q.startedBefore))),
        );
      },
      async pause() {},
      async resume() {},
      async cancel() {},
      async show() {},
    },
    alarms: {
      create(_name, info) {
        activeAlarm = info.when;
        alarms.push(info.when || 0);
      },
      clear() {
        activeAlarm = undefined;
      },
    },
    async notify(_title, _message, id) {
      notifications.push(id || "random");
    },
    async setBadge() {},
    getUrl(path) {
      return `chrome-extension://test/${path}`;
    },
    now: () => now,
    extensionId: "test",
  };
  const engine = new QueueEngine(ports);
  return {
    engine,
    ports,
    created,
    actions,
    alarms,
    downloads,
    notifications,
    strictDates() {
      strictDates = true;
    },
    setSendReply(v: unknown) {
      sendReply = v;
    },
    setSendUnavailable(v: boolean) {
      sendUnavailable = v;
    },
    setTabMissing(v: boolean) {
      tabMissing = v;
    },
    setNow(v: number) {
      now = v;
    },
    failStorage(v: boolean) {
      failStorage = v;
    },
    get activeAlarm() {
      return activeAlarm;
    },
    get writes() {
      return writes;
    },
    get state() {
      return state;
    },
  };
}

const url1 = "https://katfile.biz/ntrr1zdzt6i0/file.rar.html";
const url2 = "https://katfile.com/abcdefghijkl/second.rar.html";

describe("手動開始下載後的明確核對", () => {
  async function blocked() {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1, url2] });
    await f.engine.command({ kind: "start" });
    await f.engine.onTabRemoved(f.state!.items[0].tabId!);
    f.downloads.push({
      id: 90,
      url: "https://s5027.katfile.biz:183/d/fixture-only/file.rar",
      filename: "C:/Downloads/file.rar",
      startTime: new Date(f.ports.now() + 1).toISOString(),
      state: "in_progress",
      bytesReceived: 500,
      totalBytes: 1200,
      paused: false,
      canResume: true,
      danger: "safe",
    });
    return f;
  }
  it("includes a manual candidate starting in the same millisecond as queue creation", async () => {
    const f = await blocked();
    f.strictDates();
    f.downloads[0].startTime = new Date(
      f.state!.items[0].createdAt,
    ).toISOString();
    const result = await f.engine.handleRequest({
      type: "QC_FIND_DOWNLOADS",
      id: f.state!.items[0].id,
    });
    expect(result.downloads?.map((d) => d.id)).toEqual([90]);
    expect(f.state!.items[0].downloadId).toBeUndefined();
  });
  it("只列候選不會認領，明確確認後追蹤原ID且不發起新下載", async () => {
    const f = await blocked();
    const id = f.state!.items[0].id;
    const found = await f.engine.handleRequest({
      type: "QC_FIND_DOWNLOADS",
      id,
    });
    expect(found.downloads?.map((d) => d.id)).toEqual([90]);
    expect(f.state!.items[0].status).toBe("blocked");
    await f.engine.command({ kind: "adopt-download", id, downloadId: 90 });
    expect(f.state!.items[0]).toMatchObject({
      status: "downloading",
      downloadId: 90,
      bytesReceived: 500,
    });
    expect(f.downloads).toHaveLength(1);
    expect(f.created).toHaveLength(1);
    f.downloads[0].bytesReceived = 800;
    await f.engine.onDownloadChanged({ id: 90 });
    expect(f.state!.items[0].bytesReceived).toBe(800);
    expect(f.state!.items[1].status).toBe("queued");
  });
  it("同檔名的其他網站、廣告referrer、過早下載及不同檔名都不列入", async () => {
    const f = await blocked();
    const d = f.downloads[0];
    f.downloads.push(
      { ...d, id: 91, url: "https://example.com/file.rar", referrer: url1 },
      { ...d, id: 92, startTime: new Date(f.ports.now() - 1).toISOString() },
      { ...d, id: 93, filename: "C:/Downloads/other.rar" },
    );
    const result = await f.engine.handleRequest({
      type: "QC_FIND_DOWNLOADS",
      id: f.state!.items[0].id,
    });
    expect(result.downloads?.map((d) => d.id)).toEqual([90]);
  });
  it("多候選仍維持待處理，確認前已中斷的候選不能被綁定", async () => {
    const f = await blocked();
    const id = f.state!.items[0].id;
    f.downloads.push({ ...f.downloads[0], id: 91 });
    const result = await f.engine.handleRequest({
      type: "QC_FIND_DOWNLOADS",
      id,
    });
    expect(result.downloads).toHaveLength(2);
    expect(f.state!.items[0].downloadId).toBeUndefined();
    f.downloads[0].state = "interrupted";
    await expect(
      f.engine.command({ kind: "adopt-download", id, downloadId: 90 }),
    ).rejects.toThrow("重新檢查");
    expect(f.state!.items[0].status).toBe("blocked");
  });
  it("別的佇列項目已綁定的downloadId不能再認領", async () => {
    const f = await blocked();
    f.state!.items[1].downloadId = 90;
    const reopened = new QueueEngine(f.ports);
    const result = await reopened.handleRequest({
      type: "QC_FIND_DOWNLOADS",
      id: f.state!.items[0].id,
    });
    expect(result.downloads).toEqual([]);
  });
  it("原本API交接結果未知時維持既有核對，不走手動認領捷徑", async () => {
    const f = await blocked();
    f.state!.items[0].action = {
      id: "unknown",
      kind: "download",
      at: f.ports.now(),
      expectedUrl: f.downloads[0].url,
    };
    const reopened = new QueueEngine(f.ports);
    const result = await reopened.handleRequest({
      type: "QC_FIND_DOWNLOADS",
      id: f.state!.items[0].id,
    });
    expect(result.ok).toBe(false);
    expect(f.downloads).toHaveLength(1);
  });
});

describe("QueueEngine", () => {
  it("external creation preserves the earlier countdown alarm and respects pause", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: { kind: "waiting", pageUrl: url1, waitSeconds: 5 },
      },
      item.tabId!,
    );
    const deadline = f.activeAlarm;
    const external: DownloadRecord = {
      id: 92,
      url: "https://cdn.katfile.biz/external.zip",
      state: "in_progress",
      bytesReceived: 0,
      totalBytes: 100,
      paused: false,
      canResume: true,
    };
    f.downloads.push(external);
    await f.engine.onDownloadCreated(external);
    expect(f.activeAlarm).toBe(deadline);
    expect(deadline).toBe(f.ports.now() + 5000);
    await f.engine.command({ kind: "pause" });
    await f.engine.onDownloadCreated(external);
    expect(f.activeAlarm).toBeUndefined();
  });
  it("repairs missing optional settings and event arrays without dropping a task", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    const damaged = structuredClone(f.state!) as unknown as Record<
      string,
      unknown
    >;
    delete damaged.settings;
    delete (damaged.items as Array<Record<string, unknown>>)[0].events;
    const restored = fixture(damaged as unknown as AppState);
    await restored.engine.command({ kind: "start" });
    expect(restored.state!.settings.theme).toBe("system");
    expect(restored.state!.items).toHaveLength(1);
    expect(restored.state!.items[0].events.length).toBeGreaterThan(0);
  });
  it("conservatively blocks an interrupted tab-creation transaction on startup", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    const seed = structuredClone(f.state!);
    seed.running = true;
    seed.activeId = seed.items[0].id;
    seed.items[0].status = "preparing";
    const restored = fixture(seed);
    await restored.engine.onStartup();
    expect(restored.state!.items[0].status).toBe("blocked");
    expect(restored.created).toHaveLength(0);
  });
  it("does not poll a blocked item after its work tab closes", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    expect(f.activeAlarm).toBeDefined();
    await f.engine.onTabRemoved(f.state!.items[0].tabId!);
    expect(f.activeAlarm).toBeUndefined();
    await f.engine.onAlarm();
    expect(f.activeAlarm).toBeUndefined();
  });
  it("discovers an unrecorded resumable external download at startup", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    f.state!.running = true;
    f.downloads.push({
      id: 91,
      url: "https://cdn.katfile.biz/external.zip",
      state: "interrupted",
      bytesReceived: 50,
      totalBytes: 100,
      paused: false,
      canResume: true,
    });
    const reopened = new QueueEngine(f.ports);
    await reopened.onStartup();
    expect(f.created).toHaveLength(0);
    expect(f.state!.externalDownloadId).toBe(91);
    f.downloads[0].canResume = false;
    await reopened.onDownloadChanged({ id: 91, canResume: { current: false } });
    expect(f.created).toHaveLength(1);
  });
  it("keeps waiting for a known resumable external transfer after alarm and startup", async () => {
    const f = fixture();
    f.downloads.push({
      id: 90,
      url: "https://cdn.katfile.biz/external.zip",
      state: "in_progress",
      bytesReceived: 50,
      totalBytes: 100,
      paused: false,
      canResume: true,
    });
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    expect(f.state!.externalDownloadId).toBe(90);
    f.downloads[0].state = "interrupted";
    await f.engine.onDownloadChanged({
      id: 90,
      state: { current: "interrupted" },
      canResume: { current: true },
    });
    await f.engine.onAlarm();
    expect(f.created).toHaveLength(0);
    expect(f.state!.externalDownloadId).toBe(90);
    const reopened = new QueueEngine(f.ports);
    await reopened.onStartup();
    expect(f.created).toHaveLength(0);
    expect(f.state!.externalDownloadId).toBe(90);
    f.downloads[0].canResume = false;
    await reopened.onDownloadChanged({ id: 90, canResume: { current: false } });
    expect(f.created).toHaveLength(1);
  });
  it("待執行排序可跨過清單中的完成紀錄", async () => {
    const f = fixture();
    await f.engine.command({
      kind: "add",
      urls: [url1, url2, "https://katfile.biz/mnopqrstuvwx/third.rar"],
    });
    const seed = structuredClone(f.state!);
    seed.items[1].status = "complete";
    const restored = fixture(seed);
    await restored.engine.command({
      kind: "move",
      id: seed.items[2].id,
      direction: -1,
    });
    expect(
      restored
        .state!.items.filter((i) => i.status === "queued")
        .map((i) => i.id),
    ).toEqual([seed.items[2].id, seed.items[0].id]);
  });
  it("下載完成後仍保留下一筆喚醒，重新啟動 worker 也不會清掉", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1, url2] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "ready",
          pageUrl: item.sourceUrl,
          finalUrl: "https://s1.katfile.biz/file.rar",
        },
      },
      item.tabId,
    );
    f.downloads[0].state = "complete";
    await f.engine.onDownloadChanged({
      id: 77,
      state: { current: "complete" },
    });
    expect(f.state!.activeId).toBeUndefined();
    expect(f.activeAlarm).toBeGreaterThan(f.ports.now());
    await f.engine.onStartup();
    expect(f.activeAlarm).toBeGreaterThan(f.ports.now());
    f.setNow(f.state!.hostNotBefore! + 1);
    await f.engine.onAlarm();
    expect(f.created).toHaveLength(2);
  });

  it("外部下載結束後仍讀網站冷卻；120分鐘政策不等於直接放行", async () => {
    const f = fixture();
    f.downloads.push({
      id: 12,
      url: "https://katfile.biz/file",
      state: "in_progress",
      bytesReceived: 1,
      totalBytes: 2,
      paused: false,
      canResume: false,
    });
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    await f.engine.onStartup();
    expect(f.activeAlarm).toBeGreaterThan(f.ports.now());
    expect(f.created).toHaveLength(0);
    f.downloads[0].state = "complete";
    await f.engine.onDownloadChanged({
      id: 12,
      state: { current: "complete" },
    });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "waiting",
          pageUrl: item.sourceUrl,
          waitSeconds: 7200,
          title: "file.rar",
          reason: "網站顯示尚需等待120分鐘",
        },
      },
      item.tabId,
    );
    expect(f.state!.items[0].waitUntil).toBe(f.ports.now() + 7200000);
    expect(f.state!.items[0].title).toBe("file.rar");
    expect(
      f.actions.filter(
        (a) => (a as { type: string }).type === "QC_PAGE_ACTION",
      ),
    ).toHaveLength(0);
  });

  it("網站等待時間無法辨識時不能猜一秒後再點", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: { kind: "waiting", pageUrl: item.sourceUrl },
      },
      item.tabId,
    );
    expect(f.state!.items[0].status).toBe("blocked");
    expect(f.actions).toHaveLength(0);
  });
  it("serializes free downloads and retains the active item while paused", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1, url2] });
    await f.engine.command({ kind: "start" });
    expect(f.created).toHaveLength(1);
    await f.engine.command({ kind: "pause" });
    const s = await f.engine.getState();
    expect(s.activeId).toBe(s.items[0].id);
    expect(s.items[1].status).toBe("queued");
    expect(s.running).toBe(false);
  });

  it("continues after a definitive failure while preserving the host cooldown", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1, url2] });
    await f.engine.command({ kind: "start" });
    const s = f.state!;
    const active = s.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "failed",
          pageUrl: active.sourceUrl,
          reason: "fixture fail",
        },
      },
      active.tabId,
    );
    expect(f.state!.items[0].status).toBe("failed");
    expect(f.state!.activeId).toBeUndefined();
    expect(f.state!.hostNotBefore).toBeGreaterThan(f.ports.now());
    f.setNow(f.state!.hostNotBefore! + 1);
    await f.engine.onAlarm();
    expect(f.created).toHaveLength(2);
    expect(f.state!.activeId).toBe(f.state!.items[1].id);
  });

  it("rejects page observations from another tab or another file", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const s = f.state!;
    const item = s.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: { kind: "free", pageUrl: item.sourceUrl },
      },
      999,
    );
    await f.engine.handleRequest(
      { type: "QC_PAGE", observation: { kind: "free", pageUrl: url2 } },
      item.tabId,
    );
    expect(f.actions).toHaveLength(0);
    expect(f.state!.items[0].action).toBeUndefined();
  });

  it("persists the action before notifying a page and never sends it twice", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: { kind: "free", pageUrl: item.sourceUrl },
      },
      item.tabId,
    );
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: { kind: "free", pageUrl: item.sourceUrl },
      },
      item.tabId,
    );
    expect(f.state!.items[0].action?.kind).toBe("free");
    expect(f.actions).toHaveLength(1);
  });

  it("blocks a rejected page action, deduplicates the same step, and permits a distinct next step", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "free",
          pageUrl: item.sourceUrl,
          step: "download1",
        },
      },
      item.tabId,
    );
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "free",
          pageUrl: item.sourceUrl,
          step: "download1",
        },
      },
      item.tabId,
    );
    expect(
      f.actions.filter(
        (m) => (m as { type: string }).type === "QC_PAGE_ACTION",
      ),
    ).toHaveLength(1);
    expect(f.state!.items[0].status).toBe("preparing");
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "free",
          pageUrl: item.sourceUrl,
          step: "download2",
        },
      },
      item.tabId,
    );
    expect(
      f.actions.filter(
        (m) => (m as { type: string }).type === "QC_PAGE_ACTION",
      ),
    ).toHaveLength(2);
    expect(f.state!.items[0].action?.step).toBe("download2");

    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "free",
          pageUrl: item.sourceUrl,
          step: "download1",
        },
      },
      item.tabId,
    );
    expect(
      f.actions.filter(
        (m) => (m as { type: string }).type === "QC_PAGE_ACTION",
      ),
    ).toHaveLength(2);

    const rejected = fixture();
    await rejected.engine.command({ kind: "add", urls: [url1] });
    await rejected.engine.command({ kind: "start" });
    const rejectedItem = rejected.state!.items[0];
    rejected.setSendReply({ ok: false, error: "按鈕已停用" });
    await rejected.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "free",
          pageUrl: rejectedItem.sourceUrl,
          step: "download1",
        },
      },
      rejectedItem.tabId,
    );
    expect(rejected.state!.items[0].status).toBe("blocked");
    expect(rejected.state!.items[0].reason).toContain("按鈕已停用");
  });

  it("blocks a sent free step after 30 seconds without resending it", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "free",
          pageUrl: item.sourceUrl,
          step: "download1",
        },
      },
      item.tabId,
    );
    f.setNow(f.ports.now() + 30_001);
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "free",
          pageUrl: item.sourceUrl,
          step: "download1",
        },
      },
      item.tabId,
    );
    expect(f.state!.items[0].status).toBe("blocked");
    expect(
      f.actions.filter(
        (m) => (m as { type: string }).type === "QC_PAGE_ACTION",
      ),
    ).toHaveLength(1);
  });

  it("does not send a free action when persisting its action record fails", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    f.failStorage(true);
    const result = await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: { kind: "free", pageUrl: item.sourceUrl },
      },
      item.tabId,
    );
    expect(result.ok).toBe(false);
    expect(
      f.actions.filter(
        (m) => (m as { type: string }).type === "QC_PAGE_ACTION",
      ),
    ).toHaveLength(0);
  });

  it.each([0, 60_000])(
    "recovers inclusive handoff boundary %i through strict Chrome date filters",
    async (offset) => {
      const f = fixture();
      f.strictDates();
      await f.engine.command({ kind: "add", urls: [url1] });
      await f.engine.command({ kind: "start" });
      const item = f.state!.items[0];
      await f.engine.handleRequest(
        {
          type: "QC_PAGE",
          observation: {
            kind: "ready",
            pageUrl: item.sourceUrl,
            finalUrl: "https://katfile.com/get/abc",
          },
        },
        item.tabId,
      );
      f.downloads[0].startTime = new Date(f.ports.now() + offset).toISOString();
      f.state!.items[0].downloadId = undefined;
      f.state!.items[0].status = "handoff";
      const reopened = new QueueEngine(f.ports);
      await reopened.onStartup();
      expect(f.state!.items[0]).toMatchObject({
        status: "downloading",
        downloadId: 77,
      });
      expect(f.downloads).toHaveLength(1);
    },
  );

  it("blocks an uncertain handoff and does not issue a second download after restart", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    const ready = {
      type: "QC_PAGE" as const,
      observation: {
        kind: "ready" as const,
        pageUrl: item.sourceUrl,
        finalUrl: "https://katfile.com/get/abc",
      },
    };
    await f.engine.handleRequest(ready, item.tabId);
    expect(f.state!.items[0].status).toBe("downloading");
    // Simulate a persisted handoff whose Chrome API result was lost.
    f.downloads.splice(0);
    f.state!.items[0].downloadId = undefined;
    f.state!.items[0].status = "handoff";
    const reopened = new QueueEngine(f.ports);
    await reopened.onStartup();
    expect(f.state!.items[0].status).toBe("blocked");
    expect(f.state!.items[0].reason).toMatch(/不會|交接结果未知|交接結果未知/);
    const retry = await reopened.handleRequest({
      type: "QC_COMMAND",
      command: { kind: "retry", id: item.id },
    });
    expect(retry.ok).toBe(false);
    expect(f.state!.items[0].status).toBe("blocked");
    expect(f.downloads).toHaveLength(0);
  });

  it("accepts Chrome safe and accepted danger states and samples progress on QC_GET", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "ready",
          pageUrl: item.sourceUrl,
          finalUrl: "https://katfile.com/get/file",
        },
      },
      item.tabId,
    );
    f.downloads[0].bytesReceived = 128;
    const first = await f.engine.handleRequest({ type: "QC_GET" });
    expect(first.state!.items[0]).toMatchObject({
      status: "downloading",
      bytesReceived: 128,
    });
    expect(f.state!.items[0].status).toBe("downloading");
    f.downloads[0].danger = "accepted";
    await f.engine.handleRequest({ type: "QC_GET" });
    expect(f.state!.items[0].status).toBe("downloading");
  });

  it("records completion once, emits one cycle notification, and does not extend the host gap on duplicate events", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "ready",
          pageUrl: item.sourceUrl,
          finalUrl: "https://katfile.com/get/file",
        },
      },
      item.tabId,
    );
    f.setNow(f.ports.now() + 10_000);
    f.downloads[0].state = "complete";
    await f.engine.handleRequest({ type: "QC_GET" });
    const firstGap = f.state!.hostNotBefore;
    const completionEvents = f.state!.items[0].events.filter(
      (e) => e.message === "下載完成",
    ).length;
    await f.engine.onDownloadChanged({
      id: 77,
      state: { current: "complete" },
    });
    expect(
      f.state!.items[0].events.filter((e) => e.message === "下載完成"),
    ).toHaveLength(completionEvents);
    expect(f.state!.hostNotBefore).toBe(firstGap);
    expect(f.state!.running).toBe(false);
    expect(f.state!.cycleNotifiedAt).toBeDefined();
    expect(
      f.notifications.filter((id) => id.startsWith("queuecat-cycle-")),
    ).toHaveLength(1);
  });

  it("does not perform waiting-page inspection or advancement while paused", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "waiting",
          pageUrl: item.sourceUrl,
          waitSeconds: 2,
        },
      },
      item.tabId,
    );
    await f.engine.command({ kind: "pause" });
    const before = f.actions.length;
    f.setNow(f.ports.now() + 3_000);
    await f.engine.onAlarm();
    expect(f.state!.items[0].status).toBe("waiting");
    expect(f.actions).toHaveLength(before);
  });

  it.each(["future", "expired", "missing"] as const)(
    "recovers a %s wait without mistaking a dormant content script for a missing tab",
    async (mode) => {
      const f = fixture();
      await f.engine.command({ kind: "add", urls: [url1] });
      await f.engine.command({ kind: "start" });
      const item = f.state!.items[0];
      await f.engine.handleRequest(
        {
          type: "QC_PAGE",
          observation: {
            kind: "waiting",
            pageUrl: item.sourceUrl,
            waitSeconds: 120,
          },
        },
        item.tabId,
      );
      const deadline = f.state!.items[0].waitUntil;
      const restarted = new QueueEngine(f.ports);
      f.setSendUnavailable(true);
      f.setTabMissing(mode === "missing");
      if (mode === "expired") f.setNow(f.ports.now() + 121_000);
      const before = f.actions.length;
      await restarted.onStartup();
      expect(f.downloads).toHaveLength(0);
      if (mode === "future") {
        expect(f.state!.items[0].status).toBe("waiting");
        expect(f.state!.items[0].waitUntil).toBe(deadline);
        expect(f.activeAlarm).toBeDefined();
        expect(f.actions).toHaveLength(before);
        f.setNow(f.ports.now() + 121_000);
        await restarted.onAlarm();
        expect(f.state!.items[0].status).toBe("blocked");
      } else expect(f.state!.items[0].status).toBe("blocked");
    },
  );

  it("rechecks for external Katfile downloads just before handoff and continues after completion", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    f.downloads.push({
      id: 90,
      url: "https://katfile.biz/other",
      state: "in_progress",
      bytesReceived: 1,
      totalBytes: 10,
      paused: false,
      canResume: true,
    });
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "ready",
          pageUrl: item.sourceUrl,
          finalUrl: "https://katfile.com/get/file",
        },
      },
      item.tabId,
    );
    expect(f.state!.items[0].status).toBe("preparing");
    expect(f.state!.externalDownloadId).toBe(90);
    expect(f.downloads.filter((d) => d.byExtensionId === "test")).toHaveLength(
      0,
    );
    f.downloads.find((d) => d.id === 90)!.state = "complete";
    await f.engine.onDownloadChanged({
      id: 90,
      state: { current: "complete" },
    });
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "ready",
          pageUrl: item.sourceUrl,
          finalUrl: "https://katfile.com/get/file",
        },
      },
      item.tabId,
    );
    expect(f.downloads.filter((d) => d.byExtensionId === "test")).toHaveLength(
      1,
    );
  });

  it("keeps an unknown saved download ID blocked instead of retrying a missing record", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "ready",
          pageUrl: item.sourceUrl,
          finalUrl: "https://katfile.com/get/file",
        },
      },
      item.tabId,
    );
    const openedTabs = f.created.length;
    f.downloads.splice(0);
    await f.engine.onAlarm();
    expect(f.state!.items[0].status).toBe("blocked");
    const retry = await f.engine.handleRequest({
      type: "QC_COMMAND",
      command: { kind: "retry", id: item.id },
    });
    expect(retry.ok).toBe(false);
    expect(f.state!.items[0]).toMatchObject({
      status: "blocked",
      downloadId: 77,
    });
    expect(f.downloads).toHaveLength(0);
    expect(f.created).toHaveLength(openedTabs);
  });

  it("rejects retry while Chrome retains a resumable interrupted download", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: {
          kind: "ready",
          pageUrl: item.sourceUrl,
          finalUrl: "https://katfile.com/get/file",
        },
      },
      item.tabId,
    );
    f.downloads[0].state = "interrupted";
    f.downloads[0].canResume = true;
    await f.engine.onDownloadChanged({
      id: 77,
      state: { current: "interrupted" },
      canResume: { current: true },
    });
    const retry = await f.engine.handleRequest({
      type: "QC_COMMAND",
      command: { kind: "retry", id: item.id },
    });
    expect(retry.ok).toBe(false);
    expect(f.state!.items[0]).toMatchObject({
      status: "blocked",
      downloadId: 77,
    });
    expect(f.downloads.filter((d) => d.byExtensionId === "test")).toHaveLength(
      1,
    );
  });

  it("blocks only preparing tabs when their source tab closes", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.onTabRemoved(item.tabId!);
    expect(f.state!.items[0].status).toBe("blocked");
  });

  it("gives an unknown page a persisted 15 second grace period, then blocks it", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const item = f.state!.items[0];
    await f.engine.handleRequest(
      {
        type: "QC_PAGE",
        observation: { kind: "unknown", pageUrl: item.sourceUrl },
      },
      item.tabId,
    );
    expect(f.state!.items[0].status).toBe("preparing");
    const reopened = new QueueEngine(f.ports);
    f.setNow(f.ports.now() + 15_001);
    await reopened.onAlarm();
    expect(f.state!.items[0].status).toBe("blocked");
  });

  it("does not open a source tab if state persistence fails", async () => {
    const f = fixture();
    await f.engine.command({ kind: "add", urls: [url1] });
    f.failStorage(true);
    const result = await f.engine.handleRequest({
      type: "QC_COMMAND",
      command: { kind: "start" },
    });
    expect(result.ok).toBe(false);
    expect(f.created).toHaveLength(0);
  });

  it("waits for an unrelated Katfile download, then continues when it ends", async () => {
    const f = fixture();
    f.downloads.push({
      id: 12,
      url: "https://katfile.biz/other",
      finalUrl: "https://cdn.example/file",
      state: "in_progress",
      bytesReceived: 10,
      totalBytes: 20,
      paused: false,
      canResume: false,
    });
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    expect(f.created).toHaveLength(0);
    expect(f.state!.externalWaitReason).toBe(
      "Chrome 正在下載其他 Katfile 檔案，完成後繼續",
    );
    f.downloads[0].state = "complete";
    await f.engine.onDownloadChanged({
      id: 12,
      state: { current: "complete" },
    });
    expect(f.created).toHaveLength(1);
    expect(f.state!.externalDownloadId).toBeUndefined();
  });

  it("does not rewrite storage for repeated observation of the same external Katfile download", async () => {
    const f = fixture();
    f.downloads.push({
      id: 12,
      url: "https://katfile.biz/other",
      state: "in_progress",
      bytesReceived: 10,
      totalBytes: 20,
      paused: false,
      canResume: false,
    });
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    const writes = f.writes;
    await f.engine.onAlarm();
    await f.engine.onAlarm();
    expect(f.writes).toBe(writes);
    expect(f.state!.externalDownloadId).toBe(12);
  });

  it("does not block the queue for non-Katfile downloads", async () => {
    const f = fixture();
    f.downloads.push({
      id: 15,
      url: "https://example.org/file",
      state: "in_progress",
      bytesReceived: 0,
      totalBytes: 20,
      paused: false,
      canResume: true,
    });
    await f.engine.command({ kind: "add", urls: [url1] });
    await f.engine.command({ kind: "start" });
    expect(f.created).toHaveLength(1);
    expect(f.state!.externalWaitReason).toBeUndefined();
  });
});
