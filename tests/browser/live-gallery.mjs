import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip.js/zip.js";

// Explicit opt-in only: this runner contacts the live site and downloads files.
// It never attaches to an existing Chrome profile or opens image previews.
const { values } = parseArgs({
  options: {
    ids: { type: "string" },
    "playwright-module": {
      type: "string",
    },
    "browser-cache": {
      type: "string",
    },
  },
});
assert.match(
  values.ids || "",
  /^[1-9]\d{0,9},[1-9]\d{0,9}$/,
  "Pass exactly two opt-in gallery IDs with --ids ID,ID",
);
const ids = values.ids.split(",");
assert.equal(new Set(ids).size, ids.length, "Use distinct gallery IDs");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
if (values["browser-cache"])
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(values["browser-cache"]);
const { chromium } = await import(
  values["playwright-module"]
    ? pathToFileURL(path.resolve(values["playwright-module"])).href
    : "playwright"
);
const out = path.join(
  root,
  "artifacts",
  "gallery-live",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const profile = path.join(out, "profile"),
  extension = path.join(out, "extension"),
  downloads = path.join(out, "downloads");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  ids,
  checks: [],
  transitions: [],
  build: {},
  downloads: [],
  cleanup: {},
  isolation: {
    profile,
    downloads,
    personalChromeAttached: false,
    personalDownloadsRead: false,
    network: "live site; no request interception, proxy or certificate bypass",
  },
};
let context, manager;
const save = () =>
  fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
try {
  await fs.mkdir(path.join(profile, "Default"), { recursive: true });
  await fs.mkdir(downloads, { recursive: true });
  await fs.mkdir(extension, { recursive: true });
  await fs.writeFile(
    path.join(profile, "Default", "Preferences"),
    JSON.stringify({
      download: {
        default_directory: downloads,
        prompt_for_download: false,
        directory_upgrade: true,
      },
    }),
  );
  const entries = JSON.parse(
    await fs.readFile(path.join(root, "artifacts/build-manifest.json"), "utf8"),
  ).entries;
  for (const [file, expected] of Object.entries(entries)) {
    assert.ok(!file.includes("..") && !path.isAbsolute(file));
    const bytes = await fs.readFile(path.join(root, file));
    assert.equal(digest(bytes), expected.sha256, `Build drift: ${file}`);
    const destination = path.join(extension, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
    report.build[file] = digest(await fs.readFile(destination));
  }
  await build({
    entryPoints: [path.join(root, "src/background/hitomi.ts")],
    outfile: path.join(out, "metadata-client.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const { createHitomiClient } = await import(
    pathToFileURL(path.join(out, "metadata-client.mjs")).href
  );
  const client = createHitomiClient();
  const expectedBooks = new Map();
  for (const id of ids) expectedBooks.set(id, await client.load(id));
  report.expectedPages = Object.fromEntries(
    [...expectedBooks].map(([id, book]) => [id, book.images.length]),
  );
  for (const [id, book] of expectedBooks)
    assert.equal(book.images.length, 12, `Gallery ${id} must have exactly 12 pages`);
  await save();
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    acceptDownloads: true,
    downloadsPath: downloads,
    locale: "zh-TW",
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--disable-background-networking",
      "--window-position=-32000,-32000",
    ],
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 60000 }));
  const origin = worker.url().split("/").slice(0, 3).join("/");
  report.extensionId = await worker.evaluate(() => chrome.runtime.id);
  manager = await context.newPage();
  const cdp = await context.newCDPSession(manager);
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
    eventsEnabled: true,
  });
  await cdp.detach();
  await manager.goto(origin + "/manager.html#add");
  await manager
    .locator("#url-input")
    .fill(
      ids.map((id) => `https://hitomi.la/galleries/${id}.html#1`).join("\n"),
    );
  await manager.locator("#confirm-add").click();
  const state = async () => {
    const result = await manager.evaluate(() =>
      chrome.runtime.sendMessage({ type: "QC_GET" }),
    );
    assert.equal(result.ok, true);
    return result.state;
  };
  let current;
  for (let n = 0; n < 30; n++) {
    current = await state();
    if (current.items.length === ids.length) break;
    await sleep(200);
  }
  assert.deepEqual(
    current.items.map((item) => item.gallery.id),
    ids,
  );
  assert.ok(current.items.every((item) => item.status === "queued"));
  report.checks.push({
    name: "distinct galleries added in order without auto-start",
    pass: true,
  });
  const started = await manager.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "QC_COMMAND",
      command: { kind: "start" },
    }),
  );
  assert.equal(started.ok, true);
  const deadline = Date.now() + 10 * 60 * 1000;
  let previous = "";
  while (Date.now() < deadline) {
    current = await state();
    const progress = current.items.map((item) => ({
      id: item.gallery.id,
      status: item.status,
      completed: item.gallery.completed,
      total: item.gallery.total,
      archiveStaged: item.gallery.archive?.staged,
      archivePhase: item.gallery.archive?.phase,
      reason: item.reason,
    }));
    const key = JSON.stringify(progress);
    if (key !== previous) {
      previous = key;
      report.transitions.push({
        at: new Date().toISOString(),
        items: progress,
      });
      console.log(key);
    }
    report.latest = progress;
    const records = await manager.evaluate(() => chrome.downloads.search({}));
    assert.ok(
      records.filter(
        (d) =>
          d.byExtensionId === report.extensionId && d.state === "in_progress",
      ).length <= 1,
    );
    for (let n = 1; n < progress.length; n++)
      if (
        progress[n].completed > 0 ||
        current.items[n].downloadId !== undefined
      )
        assert.equal(
          progress[n - 1].status,
          "complete",
          "Next gallery began before previous completed",
        );
    await save();
    if (progress.some((item) => ["blocked", "failed"].includes(item.status)))
      throw new Error("Live queue blocked/failed; no automatic resend");
    if (progress.every((item) => item.status === "complete")) break;
    await sleep(1000);
  }
  assert.ok(
    current.items.every((item) => item.status === "complete"),
    "Live galleries did not all complete before deadline",
  );
  const records = await manager.evaluate(() => chrome.downloads.search({}));
  const own = records
    .filter((d) => d.byExtensionId === report.extensionId)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  report.chromeDownloads = own;
  assert.equal(own.length, ids.length, "Expected exactly one Chrome ZIP per gallery");
  const safeTitle = (title) =>
    Array.from(
      title
        .normalize("NFC")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/[. ]+$/g, "")
        .replace(/^\.+/g, "")
        .trim(),
    )
      .slice(0, 80)
      .join("")
      .replace(/[. ]+$/g, "") || "Gallery";
  for (let bookIndex = 0; bookIndex < current.items.length; bookIndex++) {
    const item = current.items[bookIndex];
    const d = own[bookIndex];
    const expected = expectedBooks.get(item.gallery.id);
    assert.equal(item.gallery.id, ids[bookIndex]);
    assert.equal(d.state, "complete");
    assert.equal(item.gallery.completed, expected.images.length);
    assert.equal(item.gallery.archive?.staged, expected.images.length);
    const zipPath = path.resolve(d.filename);
    assert.ok(zipPath.startsWith(path.resolve(downloads) + path.sep));
    assert.equal(
      path.relative(downloads, zipPath).split(path.sep).join("/"),
      `QueueCat/${item.gallery.id}-${safeTitle(expected.title)}.zip`,
    );
    const zipBytes = await fs.readFile(zipPath);
    const reader = new ZipReader(
      new Uint8ArrayReader(new Uint8Array(zipBytes)),
      { checkSignature: true },
    );
    try {
      const entries = await reader.getEntries();
      assert.equal(entries.length, 12, `Gallery ${item.gallery.id} ZIP entry count`);
      assert.ok(entries.every((entry) => !entry.directory));
      assert.deepEqual(
        entries.map((entry) => entry.filename),
        Array.from(
          { length: 12 },
          (_, n) => `${String(n + 1).padStart(4, "0")}.webp`,
        ),
        `Gallery ${item.gallery.id} ZIP order`,
      );
      for (let n = 0; n < entries.length; n++) {
        const bytes = await entries[n].getData(new Uint8ArrayWriter());
        assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), "RIFF");
        assert.equal(Buffer.from(bytes.subarray(8, 12)).toString(), "WEBP");
        const source = expected.images[n];
        const response = await fetch(await client.imageUrl(source), {
          headers: { Referer: "https://hitomi.la/" },
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type") || "", /^image\/webp/);
        assert.ok(
          Number(response.headers.get("content-length")) <= 32 * 1024 * 1024,
        );
        const independent = new Uint8Array(await response.arrayBuffer());
        assert.ok(independent.length <= 32 * 1024 * 1024);
        const pageDigest = digest(bytes);
        const independentDigest = digest(independent);
        assert.equal(
          pageDigest,
          independentDigest,
          `Wrong content at gallery ${item.gallery.id}, page ${n + 1}`,
        );
        // Metadata hashes identify original assets; the served WebP rendition
        // has its own byte digest. Compare against an independent WebP fetch.
        report.downloads.push({
          galleryId: item.gallery.id,
          page: n + 1,
          sourceHash: source.hash,
          filename: path.relative(downloads, zipPath),
          bytes: bytes.length,
          sha256: pageDigest,
          independentSha256: independentDigest,
          zipBytes: zipBytes.length,
        });
        console.log(`VERIFIED ${item.gallery.id} page ${n + 1}/12`);
      }
    } finally {
      await reader.close();
    }
  }
  for (let n = 1; n < own.length; n++)
    assert.ok(
      Date.parse(own[n].startTime) >= Date.parse(own[n - 1].endTime),
      "Chrome ZIP downloads overlapped or started out of order",
    );
  report.offscreenContexts = await manager.evaluate(() =>
    chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }),
  );
  assert.equal(
    report.offscreenContexts.length,
    0,
    "Idle offscreen document was not reclaimed",
  );
  report.sessionRules = await worker.evaluate(() =>
    chrome.declarativeNetRequest.getSessionRules(),
  );
  assert.equal(
    report.sessionRules.length,
    0,
    "Temporary image header rule was not removed",
  );
  report.checks.push(
    {
      name: "each ZIP has 12 ordered pages matching independently fetched source bytes",
      pass: true,
      count: report.downloads.length,
    },
    {
      name: "strictly serial Chrome timestamps and no idle offscreen/header rules",
      pass: true,
    },
  );
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  if (manager && !manager.isClosed())
    await manager
      .evaluate(() =>
        chrome.runtime.sendMessage({
          type: "QC_COMMAND",
          command: { kind: "pause" },
        }),
      )
      .catch(() => {});
  if (context)
    await context
      .close()
      .then(() => (report.cleanup.contextClosed = true))
      .catch((e) => (report.cleanup.closeError = e.message));
  const target = path.resolve(profile);
  assert.ok(
    target.startsWith(path.resolve(out) + path.sep) &&
      path.basename(target) === "profile",
  );
  await fs
    .rm(target, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 200,
    })
    .then(() => (report.cleanup.profileRemoved = true))
    .catch((e) => (report.cleanup.profileError = e.message));
  if (report.cleanup.closeError || report.cleanup.profileError) {
    report.status = "fail";
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(`REPORT ${path.join(out, "report.json")}`);
}
