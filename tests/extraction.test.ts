import { describe, expect, it } from "vitest";
import { QueueEngine, type EnginePorts } from "../src/background/engine";
import {
  initialState,
  type AppState,
  type QueueItem,
} from "../src/shared/types";
import {
  extractionError,
  planExtractions,
  type NativeRequest,
  type NativeReply,
} from "../src/shared/extraction";

it("maps missing or expired native passwords to re-entry rather than corrupt archives", () => {
  expect(extractionError("secret-expired")).toBe("password_expired");
  expect(extractionError("secret-not-found")).toBe("password_expired");
});

const item = (title: string, n: number): QueueItem => ({
  id: `item${n}`,
  sourceUrl: `https://katfile.biz/${String(n).padStart(12, "0")}/${title}.html`,
  title,
  status: "queued",
  createdAt: 1,
  updatedAt: 1,
  events: [],
});
function fixture(seed = initialState()) {
  let state = structuredClone(seed),
    starts = 0,
    unavailable = false,
    loseStart = false;
  const requests: NativeRequest[] = [],
    alarms: number[] = [];
  const jobs = new Map<string, NativeReply>();
  const ports: EnginePorts = {
    storage: {
      async get() {
        return structuredClone(state);
      },
      async set(value) {
        state = structuredClone(value["queuecat.state.v1"] as AppState);
      },
    },
    tabs: {
      async create() {
        return { id: 1 };
      },
      async get() {
        return { id: 1, url: state.items[0]?.sourceUrl };
      },
      async update() {},
      async send() {
        return { ok: true };
      },
    },
    downloads: {
      async download() {
        throw Error("unexpected download");
      },
      async search(query) {
        return state.items
          .filter((i) => i.downloadId === query.id)
          .map((i) => ({
            id: i.downloadId!,
            filename: `C:\\Temp\\QueueCat\\${i.title}`,
            url: i.sourceUrl,
            state: "complete" as const,
            bytesReceived: 10,
            totalBytes: 10,
            paused: false,
            canResume: false,
            danger: "safe",
          }));
      },
      async pause() {},
      async resume() {},
      async cancel() {},
      async show() {},
    },
    alarms: {
      create(_name, info) {
        alarms.push(info.when!);
      },
      clear() {},
    },
    async notify() {},
    async setBadge() {},
    getUrl: (p) => p,
    now: () => 1000,
    extensionId: "test",
    native: {
      async request(message) {
        requests.push(message);
        if (unavailable) throw Error("not installed");
        if (message.op === "ping") return { ok: true, sevenZipAvailable: true };
        if (message.op === "status")
          return (
            jobs.get(message.id) || { ok: false, errorCode: "job-not-found" }
          );
        if (message.op === "start") {
          starts++;
          jobs.set(message.id, { ok: true, status: "extracting" });
          if (loseStart) {
            loseStart = false;
            throw Error("lost reply");
          }
          return jobs.get(message.id)!;
        }
        return { ok: true };
      },
    },
  };
  return {
    ports,
    requests,
    jobs,
    alarms,
    get state() {
      return state;
    },
    get starts() {
      return starts;
    },
    unavailable() {
      unavailable = true;
    },
    loseStart() {
      loseStart = true;
    },
  };
}

describe("explicit archive groups", () => {
  it("groups contiguous RAR/7z parts and independent archives without mixing families", () => {
    const groups = planExtractions([
      item("a.part02.rar", 2),
      item("b.zip", 4),
      item("a.part01.rar", 1),
      item("c.7z.001", 5),
      item("c.7z.002", 6),
    ]);
    expect(groups.map((g) => g.itemIds.length)).toEqual([2, 1, 2]);
  });
  it.each(
    [
      ["a.part2.rar"],
      ["a.part1.rar", "a.part3.rar"],
      ["a.7z.002"],
      ["a.exe"],
    ].map((names) => ({ names })),
  )("rejects missing/unsupported set $names", ({ names }) => {
    expect(() => planExtractions(names.map(item))).toThrow();
  });
});

it("stores the password only through native DPAPI RPC, never in queue state/events", async () => {
  const f = fixture(),
    engine = new QueueEngine(f.ports),
    source = item("protected.zip", 1);
  await engine.command({
    kind: "add",
    urls: [source.sourceUrl],
    extraction: { password: "private-test-password" },
  });
  expect(
    f.requests.some(
      (r) => r.op === "store-secret" && r.password === "private-test-password",
    ),
  ).toBe(true);
  expect(JSON.stringify(f.state)).not.toContain("private-test-password");
  expect(f.state.running).toBe(false);
  expect(f.state.extractions?.[0].status).toBe("waiting");
});

it("leaves ordinary downloads usable when no helper is installed", async () => {
  const f = fixture(),
    engine = new QueueEngine(f.ports),
    source = item("archive.rar", 1);
  f.unavailable();
  await expect(
    engine.command({
      kind: "add",
      urls: [source.sourceUrl],
      extraction: { password: "x" },
    }),
  ).rejects.toThrow("helper_unavailable");
  expect(f.state.items).toHaveLength(0);
  await engine.command({ kind: "add", urls: [source.sourceUrl] });
  expect(f.state.items).toHaveLength(1);
  expect(f.state.extractions).toBeUndefined();
});

it("waits for every tracked volume and starts/polls extraction even with the queue paused", async () => {
  const seed = initialState();
  seed.items = [item("book.part1.rar", 1), item("book.part2.rar", 2)];
  seed.items[0].status = "complete";
  seed.items[0].downloadId = 1;
  seed.extractions = planExtractions(seed.items);
  const pending = fixture(seed);
  await new QueueEngine(pending.ports).onAlarm();
  expect(pending.starts).toBe(0);
  seed.items[1].status = "complete";
  seed.items[1].downloadId = 2;
  const f = fixture(seed),
    engine = new QueueEngine(f.ports);
  await engine.onStartup();
  expect(f.starts).toBe(1);
  expect(f.alarms.length).toBeGreaterThan(0);
  await engine.command({ kind: "clear-complete" });
  expect(f.state.items).toHaveLength(2);
  const id = f.state.extractions![0].jobId!;
  f.jobs.set(id, {
    ok: true,
    status: "complete",
    outputDir: "C:\\Temp\\QueueCat\\book",
  });
  await engine.onAlarm();
  expect(f.state.extractions![0].status).toBe("complete");
  expect(f.starts).toBe(1);
  await engine.command({ kind: "clear-complete" });
  expect(f.state.items).toHaveLength(0);
});

it("reconciles an ambiguous native start with its saved ID instead of launching twice", async () => {
  const seed = initialState();
  const source = item("protected.zip", 1);
  source.status = "complete";
  source.downloadId = 1;
  seed.items = [source];
  seed.extractions = planExtractions(seed.items);
  const f = fixture(seed);
  f.loseStart();
  await new QueueEngine(f.ports).onStartup();
  expect(f.state.extractions![0].status).toBe("queued");
  expect(f.starts).toBe(1);
  await new QueueEngine(f.ports).onAlarm();
  expect(f.state.extractions![0].status).toBe("extracting");
  expect(f.starts).toBe(1);
  expect(
    f.requests
      .filter((r) => r.op === "status")
      .map((r) => r.id)
      .every((id) => id === f.state.extractions![0].jobId),
  ).toBe(true);
});

it("resolves file-id-only links using Chrome filenames without storing the batch password", async () => {
  const f = fixture(),
    engine = new QueueEngine(f.ports);
  const source = item("protected.zip", 1);
  source.sourceUrl = "https://katfile.biz/000000000001";
  await engine.command({
    kind: "add",
    urls: [source.sourceUrl],
    extraction: { password: "id-only-secret" },
  });
  expect(f.state.extractions![0].unresolved).toBe(true);
  // Simulate a persisted completed download before constructing a fresh worker.
  const seed = structuredClone(f.state);
  seed.items[0].status = "complete";
  seed.items[0].title = "protected.zip";
  seed.items[0].downloadId = 1;
  const recovered = fixture(seed);
  await new QueueEngine(recovered.ports).onStartup();
  expect(recovered.state.extractions![0].unresolved).toBeUndefined();
  expect(recovered.starts).toBe(1);
  expect(JSON.stringify(recovered.state)).not.toContain("id-only-secret");
});

it("keeps a busy native operation pending and refuses a duplicate retry or record removal", async () => {
  const seed = initialState(),
    source = item("protected.zip", 1);
  source.status = "complete";
  source.downloadId = 1;
  seed.items = [source];
  seed.extractions = planExtractions(seed.items);
  const f = fixture(seed);
  const native = f.ports.native!.request;
  f.ports.native!.request = async (request) =>
    request.op === "start"
      ? { ok: false, errorCode: "job-busy" }
      : native(request);
  const engine = new QueueEngine(f.ports);
  await engine.onStartup();
  const group = f.state.extractions![0];
  expect(group.status).toBe("queued");
  await expect(
    engine.command({ kind: "retry-extraction", id: group.id }),
  ).rejects.toThrow();
  await expect(
    engine.command({ kind: "remove", id: source.id }),
  ).rejects.toThrow();
});

it("only retries a terminal failed extraction with a new persisted job ID, never a download", async () => {
  const seed = initialState(),
    source = item("protected.zip", 1);
  source.status = "complete";
  source.downloadId = 1;
  seed.items = [source];
  seed.extractions = planExtractions(seed.items);
  const group = seed.extractions[0];
  group.status = "failed";
  group.jobId = "failed-job";
  group.errorCode = "password_or_corrupt";
  const f = fixture(seed),
    engine = new QueueEngine(f.ports);
  await engine.command({
    kind: "retry-extraction",
    id: group.id,
    password: "corrected-secret",
  });
  expect(f.state.extractions![0].jobId).not.toBe("failed-job");
  expect(f.starts).toBe(1);
  expect(JSON.stringify(f.state)).not.toContain("corrected-secret");
  expect(f.state.items[0].status).toBe("complete");
  expect(
    f.requests.some((r) => r.op === "forget-secret" && r.id === group.id),
  ).toBe(true);
});

it("canceling one failed volume record cancels the group and leaves the other downloaded files intact", async () => {
  const seed = initialState();
  seed.items = [item("book.part1.rar", 1), item("book.part2.rar", 2)];
  seed.items.forEach((i, n) => {
    i.status = "complete";
    i.downloadId = n + 1;
  });
  seed.extractions = planExtractions(seed.items);
  seed.extractions[0].status = "failed";
  const secretId = seed.extractions[0].id,
    f = fixture(seed),
    engine = new QueueEngine(f.ports);
  await engine.command({ kind: "remove", id: seed.items[0].id });
  expect(f.state.items).toHaveLength(1);
  expect(f.state.items[0].status).toBe("complete");
  expect(f.state.extractions).toHaveLength(0);
  expect(
    f.requests.some((r) => r.op === "forget-secret" && r.id === secretId),
  ).toBe(true);
  expect(f.starts).toBe(0);
});

it("cleans completed passwords durably and backs off cleanup if the helper disappears", async () => {
  const seed = initialState(),
    source = item("protected.zip", 1);
  source.status = "complete";
  source.downloadId = 1;
  seed.items = [source];
  seed.extractions = planExtractions(seed.items);
  const f = fixture(seed),
    engine = new QueueEngine(f.ports);
  await engine.onStartup();
  f.jobs.set(f.state.extractions![0].jobId!, {
    ok: true,
    status: "complete",
    outputDir: "C:\\Temp\\QueueCat\\out",
  });
  const native = f.ports.native!.request;
  f.ports.native!.request = async (r) => {
    if (r.op === "forget-secret") throw Error("temporary disconnect");
    return native(r);
  };
  await engine.onAlarm();
  expect(f.state.extractions![0].status).toBe("complete");
  expect(f.state.pendingSecretDeletes).toEqual([seed.extractions[0].id]);
  expect(f.state.nextSecretCleanupAt).toBe(301000);
  expect(f.alarms.at(-1)).toBe(301000);
  const before = f.requests.length;
  await engine.onAlarm();
  expect(f.requests).toHaveLength(before);
  f.ports.now = () => 302000;
  f.ports.native!.request = native;
  await new QueueEngine(f.ports).onAlarm();
  expect(f.state.pendingSecretDeletes).toHaveLength(0);
});
