import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

// Native extraction acceptance runs only in its own Chromium profile and files.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    "helper-exe": { type: "string", multiple: false },
    "seven-zip": { type: "string", multiple: false },
    "playwright-module": { type: "string", multiple: false },
    "browser-cache": { type: "string", multiple: false },
    "metadata-only": { type: "boolean", default: false },
  },
});
const required = ["helper-exe", "seven-zip", "playwright-module", "browser-cache"];
for (const name of required)
  if (!values[name]) throw new Error(`Missing --${name}`);

const helperExe = path.resolve(values["helper-exe"]);
const sevenZip = path.resolve(values["seven-zip"]);
for (const [name, file] of [["helper exe", helperExe], ["7-Zip", sevenZip]])
  if (!(await fs.stat(file)).isFile()) throw new Error(`${name} not found: ${file}`);
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(values["browser-cache"]);
const { chromium } = await import(
  pathToFileURL(path.resolve(values["playwright-module"])).href
);

const out = path.join(
  root,
  "artifacts",
  "extraction-browser",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const extension = path.join(out, "extension");
const profile = path.join(out, "profile");
const downloadsDir = path.join(out, "test-downloads");
const metadataProfile = path.join(out, "metadata-profile");
const metadataDownloads = path.join(out, "metadata-downloads");
const fixtureDir = path.join(out, "fixture");
const helperHome = path.join(out, "helper-state");
const hostManifest = path.join(out, "native-host.json");
const registryKey =
  "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.queuecat.helper";
const registryPath =
  "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.queuecat.helper";
const storageKey = "queuecat.state.v1";
const password = `queuecat-fixture-${randomUUID()}`;
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  pageErrors: [],
  fixtureDownloads: [],
  nativeJob: undefined,
  queueGrouping: undefined,
  fatalError: undefined,
  cleanup: {},
  isolation: {
    profile,
    extension,
    downloadsDir,
    helperHome,
    personalChromeAttached: false,
    network: "loopback fixture only",
    katfile: false,
    personalDownloads: false,
    credentialsCopied: false,
  },
};
await fs.mkdir(out, { recursive: true });
await fs.mkdir(downloadsDir, { recursive: true });
await fs.mkdir(fixtureDir, { recursive: true });
await fs.mkdir(helperHome, { recursive: true });
await fs.mkdir(path.join(profile, "Default"), { recursive: true });
await fs.writeFile(
  path.join(profile, "Default", "Preferences"),
  JSON.stringify({
    download: {
      default_directory: downloadsDir,
      prompt_for_download: false,
      directory_upgrade: true,
    },
  }),
  "utf8",
);
await fs.cp(path.join(root, "artifacts", "unpacked"), extension, {
  recursive: true,
});
await fs.writeFile(
  path.join(helperHome, "config.json"),
  JSON.stringify({ sevenZipPath: sevenZip }),
  "utf8",
);
process.env.QUEUECAT_HELPER_HOME = helperHome;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    if (fatalError) throw fatalError;
    try {
      return await check();
    } catch (error) {
      last = error;
      await sleep(200);
    }
  }
  throw new Error(`${label}: ${last?.message || "timed out"}`);
}
async function record(name, fn) {
  const start = Date.now();
  report.currentCheck = name;
  await writeReport();
  const result = await fn();
  report.checks.push({ name, status: "pass", ms: Date.now() - start, result });
  await writeReport();
  console.log(`PASS ${name}`);
  return result;
}
async function writeReport() {
  const serialized = JSON.stringify(report, null, 2);
  if (serialized.includes(password))
    throw new Error("Refusing to save a report containing the fixture password");
  await fs.writeFile(path.join(out, "report.json"), serialized);
}
const sha256 = async (file) =>
  createHash("sha256").update(await fs.readFile(file)).digest("hex");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function matchingOutputFolders(entries, baseName) {
  const collision = new RegExp(`^${escapeRegExp(baseName)} \\(\\d+\\)$`);
  return entries
    .filter((entry) => entry.isDirectory() && (entry.name === baseName || collision.test(entry.name)))
    .map((entry) => entry.name)
    .sort();
}
const syntheticOutputNames = matchingOutputFolders(
  [
    { name: "fixture.7z (extracted)", isDirectory: () => true },
    { name: "fixture.7z (extracted) (1)", isDirectory: () => true },
    { name: "fixture.7z.001", isDirectory: () => false },
    { name: "fixture.7z.002", isDirectory: () => false },
  ],
  "fixture.7z (extracted)",
);
assert.deepEqual(syntheticOutputNames, ["fixture.7z (extracted)", "fixture.7z (extracted) (1)"]);

function registryKeyExists() {
  try {
    execFileSync("reg.exe", ["query", registryKey], {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

let context;
let manager;
let httpServer;
let createdRegistryKey = false;
let extensionOrigin;
let fixtureVolumes = [];
let downloadIds = [];
let helperJobId;
let fatalError;
const noteFatal = (error) => {
  if (fatalError) return;
  fatalError = error instanceof Error ? error : new Error(String(error));
  report.fatalError = (fatalError.stack || fatalError.message).replaceAll(password, "[REDACTED]");
  process.exitCode = 1;
  httpServer?.closeAllConnections();
};
process.on("uncaughtException", noteFatal);
process.on("unhandledRejection", noteFatal);
try {
  const payloadPath = path.join(fixtureDir, "fixture-payload.bin");
  const payload = randomBytes(1_350_000);
  await fs.writeFile(payloadPath, payload);
  const archivePath = path.join(fixtureDir, "fixture.7z");
  execFileSync(
    sevenZip,
    ["a", "-t7z", `-p${password}`, "-mhe=on", "-v1m", archivePath, payloadPath],
    { stdio: "ignore", windowsHide: true },
  );
  fixtureVolumes = [
    path.join(fixtureDir, "fixture.7z.001"),
    path.join(fixtureDir, "fixture.7z.002"),
  ];
  for (const file of fixtureVolumes)
    if (!(await fs.stat(file).catch(() => undefined))?.isFile())
      throw new Error(`Expected split-volume fixture was not created: ${path.basename(file)}`);

  const hashesBefore = await Promise.all(fixtureVolumes.map(sha256));
  const outputSentinelDir = path.join(downloadsDir, "fixture (extracted)");
  await fs.mkdir(outputSentinelDir, { recursive: true });
  const sentinel = path.join(outputSentinelDir, "keep.txt");
  await fs.writeFile(sentinel, "preserve-existing-output\n", "utf8");

  const byName = new Map(fixtureVolumes.map((file) => [path.basename(file), file]));
  httpServer = http.createServer((req, res) => {
    void (async () => {
    const name = new URL(req.url || "/", "http://127.0.0.1").pathname.slice(1);
    const fixture = byName.get(name);
    if (!fixture || req.method !== "GET") {
      res.writeHead(404).end();
      return;
    }
    const stat = await fs.stat(fixture);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    });
    const source = createReadStream(fixture);
    source.on("error", (error) => {
      noteFatal(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    source.pipe(res);
    })().catch((error) => {
      noteFatal(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  httpServer.on("error", noteFatal);
  const port = httpServer.address().port;

  // Verify Chrome's actual saved filename before the extension/native-host flow.
  await fs.mkdir(metadataDownloads, { recursive: true });
  const metadataContext = await chromium.launchPersistentContext(metadataProfile, {
    channel: "chromium",
    headless: false,
    acceptDownloads: false,
    locale: "zh-TW",
    args: ["--no-proxy-server", "--disable-background-networking", "--window-position=-32000,-32000"],
  });
  try {
    const metadataPage = await metadataContext.newPage();
    const cdp = await metadataContext.newCDPSession(metadataPage);
    const began = new Promise((resolve) => cdp.once("Browser.downloadWillBegin", resolve));
    const completed = new Promise((resolve) => {
      cdp.on("Browser.downloadProgress", (event) => {
        if (event.state === "completed") resolve(event);
      });
    });
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: metadataDownloads,
      eventsEnabled: true,
    });
    await metadataPage.goto(`http://127.0.0.1:${port}/fixture.7z.001`).catch((error) => {
      if (!String(error.message).includes("Download is starting")) throw error;
    });
    const begin = await Promise.race([
      began,
      sleep(15_000).then(() => { throw new Error("Chrome did not report fixture download start"); }),
    ]);
    const done = await Promise.race([
      completed,
      sleep(15_000).then(() => { throw new Error("Chrome did not report fixture download completion"); }),
    ]);
    assert.equal(begin.suggestedFilename, "fixture.7z.001");
    assert.equal(done.guid, begin.guid);
    await eventually(async () => {
      const saved = await fs.readdir(metadataDownloads);
      assert.ok(saved.includes("fixture.7z.001"), `unexpected Chrome filename: ${saved.join(", ")}`);
      return saved;
    }, "isolated Chrome download filename metadata");
    report.checks.push({ name: "bare isolated Chrome preserves archive filename via CDP", status: "pass", result: { suggestedFilename: begin.suggestedFilename, savedFilename: "fixture.7z.001" } });
    await cdp.detach();
  } finally {
    await metadataContext.close();
    report.cleanup.metadataProfileClosed = true;
  }

  if (values["metadata-only"]) {
    if (fatalError) throw fatalError;
    report.status = "pass";
  } else {

  const manifest = JSON.parse(await fs.readFile(path.join(extension, "manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("nativeMessaging"), "extension must declare nativeMessaging");
  const workerBackground = path.join(extension, manifest.background.service_worker);
  await fs.access(workerBackground);

  console.log("Launching the owned isolated Chromium profile...");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    acceptDownloads: true,
    downloadsPath: downloadsDir,
    locale: "zh-TW",
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      `--host-resolver-rules=MAP * 127.0.0.1`,
      "--no-proxy-server",
      "--disable-background-networking",
      "--window-position=-32000,-32000",
    ],
  });
  context.on("page", (page) => page.on("pageerror", (error) => report.pageErrors.push(error.message)));
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  extensionOrigin = worker.url().split("/").slice(0, 3).join("/");
  const extensionId = await worker.evaluate(() => chrome.runtime.id);
  assert.match(extensionId, /^[a-p]{32}$/);
  report.extensionId = extensionId;
  report.browserVersion = context.browser()?.version();

  if (registryKeyExists())
    throw new Error(`${registryPath} already exists; refusing to replace a native host registration`);
  await fs.writeFile(
    hostManifest,
    JSON.stringify({
      name: "com.queuecat.helper",
      description: "QueueCat isolated extraction test helper",
      path: helperExe,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    }, null, 2),
    "utf8",
  );
  // Recheck immediately before creating the single Chrome HKCU key.
  if (registryKeyExists())
    throw new Error(`${registryKey} already exists; refusing to replace a native host registration`);
  execFileSync("reg.exe", ["add", registryKey, "/ve", "/t", "REG_SZ", "/d", hostManifest], {
    stdio: "ignore",
    windowsHide: true,
  });
  createdRegistryKey = true;

  manager = await context.newPage();
  const downloadCdp = await context.newCDPSession(manager);
  await downloadCdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadsDir,
    eventsEnabled: true,
  });
  await downloadCdp.detach();
  await manager.goto(`${extensionOrigin}/manager.html`);
  await manager.locator("#url-input").waitFor({ state: "visible" });
  const nativeCall = (command) =>
    manager.evaluate(
      (command) => chrome.runtime.sendMessage({ type: "QC_COMMAND", command }),
      command,
    );
  const state = async () =>
    (await manager.evaluate(() => chrome.runtime.sendMessage({ type: "QC_GET" }))).state;
  const stopWorker = async () => {
    const cdp = await context.newCDPSession(manager);
    try {
      await cdp.send("ServiceWorker.enable");
      await cdp.send("ServiceWorker.stopAllWorkers");
    } finally {
      await cdp.detach();
    }
  };
  const seedState = async (value) => {
    await stopWorker();
    await manager.evaluate(
      ({ key, value }) => chrome.storage.local.set({ [key]: value }),
      { key: storageKey, value },
    );
    await stopWorker();
  };

  await record("native helper check succeeds using the test-only HKCU registration", async () => {
    const reply = await nativeCall({ kind: "check-helper" });
    assert.equal(reply.ok, true);
    assert.equal(reply.state.nativeHelper?.available, true);
    assert.equal(reply.state.nativeHelper?.engineAvailable, true);
    return { available: true, engineAvailable: true, registrationOwned: true };
  });

  await record("manager translations keep extraction controls usable without horizontal overflow", async () => {
    await manager.setViewportSize({ width: 620, height: 820 });
    const language = manager.locator("#language");
    await manager.locator(".top-actions [data-action=\"settings\"]").click();
    await language.selectOption("en");
    await manager.waitForFunction(() => document.documentElement.lang === "en");
    assert.equal(await manager.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    await language.selectOption("zh-TW");
    await manager.waitForFunction(() => document.documentElement.lang === "zh-TW");
    assert.equal(await manager.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    await language.selectOption("ja");
    await manager.waitForFunction(() => document.documentElement.lang === "ja");
    assert.equal(await manager.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    await language.selectOption("zh-TW");
    await manager.waitForFunction(() => document.documentElement.lang === "zh-TW");
    await manager.goto(`${extensionOrigin}/manager.html#add`);
    await manager.locator("#add-panel").waitFor({ state: "visible" });
    const toggle = manager.locator("#extract-after-download");
    await toggle.check();
    const passwordInput = manager.locator("#batch-password");
    await passwordInput.focus();
    assert.equal(await passwordInput.evaluate((element) => document.activeElement === element), true);
    await manager.screenshot({ path: path.join(out, "manager-extraction-zh-TW.png"), fullPage: true });
    return { languages: ["en", "zh-TW", "ja"], horizontalOverflow: false, passwordFieldFocusable: true };
  });

  const urls = [
    "https://katfile.biz/abcdefghijk1/fixture.7z.001.html",
    "https://katfile.biz/abcdefghijk2/fixture.7z.002.html",
  ];
  await manager.locator("#url-input").fill(urls.join("\n"));
  await manager.locator("#extract-after-download").check();
  await manager.locator("#batch-password").fill(password);
  const added = await manager.locator("#confirm-add").click().then(() => eventually(async () => {
    const current = await state();
    assert.equal(current.items.length, 2);
    assert.equal(current.extractions?.length, 1);
    return current;
  }, "QueueCat add URLs with extraction"));
  assert.ok(!JSON.stringify(added).includes(password), "password leaked into returned state");
  assert.ok(!JSON.stringify(await manager.evaluate(() => chrome.storage.local.get(null))).includes(password), "password leaked into extension storage");
  const itemIds = added.extractions[0].itemIds;
  const groupId = added.extractions[0].id;
  assert.equal(added.extractions[0].status, "waiting");
  assert.ok(added.extractions[0].secretId);
  report.queueGrouping = {
    itemCount: added.items.length,
    extractionCount: added.extractions.length,
    unresolved: added.extractions[0].itemIds.length,
    sourceNames: ["fixture.7z.001", "fixture.7z.002"],
    status: added.extractions[0].status,
  };
  await manager.locator("#batch-password").waitFor({ state: "hidden" });
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 580 });
  await popup.goto(`${extensionOrigin}/popup.html`);
  await popup.locator("#status-title").waitFor();
  await popup.screenshot({ path: path.join(out, "popup-extraction-queue.png"), fullPage: true });
  await popup.close();

  async function downloadPart(index) {
    const filename = path.basename(fixtureVolumes[index]);
    const id = await manager.evaluate(
      (url) => chrome.downloads.download({ url }),
      `http://127.0.0.1:${port}/${filename}`,
    );
    const result = await eventually(async () => {
      const [download] = await manager.evaluate((id) => chrome.downloads.search({ id }), id);
      assert.ok(download, `Chrome download ${id} missing`);
      assert.equal(download.state, "complete");
      assert.ok(download.filename.startsWith(downloadsDir), "download escaped isolated test directory");
      return download;
    }, `${filename} download`, 30_000);
    downloadIds[index] = id;
    const metadata = { id, filename: path.basename(result.filename), state: result.state, bytes: result.fileSize };
    report.fixtureDownloads[index] = metadata;
    return metadata;
  }

  const firstDownload = await downloadPart(0);
  await record("one completed Chrome volume remains queued until every selected volume completes", async () => {
    const partial = structuredClone(await state());
    partial.running = false;
    partial.activeId = undefined;
    partial.items = partial.items.map((item, index) => ({
      ...item,
      status: index === 0 ? "complete" : "queued",
      ...(index === 0
        ? { downloadId: firstDownload.id, title: "fixture.7z.001" }
        : { title: "fixture.7z.002" }),
    }));
    partial.extractions = partial.extractions.map((group) => ({
      ...group,
      status: "waiting",
      jobId: undefined,
    }));
    await seedState(partial);
    const stillWaiting = await state();
    assert.equal(stillWaiting.extractions[0].status, "waiting");
    assert.equal(await fs.stat(sentinel).then(() => true), true);
    assert.deepEqual(
      (await fs.readdir(downloadsDir)).filter((name) => name.startsWith("fixture (extracted)")),
      ["fixture (extracted)"],
    );
    assert.ok(!stillWaiting.extractions[0].jobId);
    return { completedVolumes: 1, selectedVolumes: 2, status: "waiting", extractionStarted: false };
  });

  const secondDownload = await downloadPart(1);
  const ready = structuredClone(await state());
  ready.running = false;
  ready.activeId = undefined;
  ready.items = ready.items.map((item, index) => ({
    ...item,
    title: `fixture.7z.00${index + 1}`,
    status: "complete",
    downloadId: downloadIds[index],
  }));
  ready.extractions = ready.extractions.map((group) => ({ ...group, status: "waiting", jobId: undefined }));
  await seedState(ready);

  const extracted = await eventually(async () => {
    const current = await state();
    helperJobId = current.extractions?.[0]?.jobId;
    assert.equal(current.extractions?.[0]?.status, "complete");
    assert.ok(current.extractions[0].outputDir);
    return current;
  }, "encrypted split archive extraction", 60_000);
  helperJobId = extracted.extractions[0].jobId;
  const outputDir = path.resolve(extracted.extractions[0].outputDir);
  assert.ok(outputDir.startsWith(path.resolve(downloadsDir) + path.sep), "output escaped isolated downloads folder");
  assert.notEqual(outputDir, outputSentinelDir, "existing output folder was overwritten");
  assert.equal(await sha256(path.join(outputDir, "fixture-payload.bin")), await sha256(payloadPath));
  assert.equal(await fs.readFile(sentinel, "utf8"), "preserve-existing-output\n");
  const downloadedPaths = [];
  for (const id of downloadIds) {
    const [download] = await manager.evaluate((id) => chrome.downloads.search({ id }), id);
    downloadedPaths.push(download.filename);
  }
  assert.deepEqual(await Promise.all(downloadedPaths.map(sha256)), hashesBefore);
  assert.ok(!JSON.stringify(await state()).includes(password), "password leaked into persisted app state");
  const outputFolderName = path.basename(outputDir);
  const outputFoldersBeforeRestart = matchingOutputFolders(
    await fs.readdir(downloadsDir, { withFileTypes: true }),
    outputFolderName,
  );
  assert.deepEqual(outputFoldersBeforeRestart, [outputFolderName]);
  report.idempotency = {
    predicateFixture: syntheticOutputNames,
    outputFolderName,
    matchingDirectoriesBeforeRestart: outputFoldersBeforeRestart,
  };

  await record("worker restart preserves the completed job and does not extract twice", async () => {
    await stopWorker();
    const afterRestart = await state();
    assert.equal(afterRestart.extractions?.[0]?.id, groupId);
    assert.equal(afterRestart.extractions?.[0]?.status, "complete");
    assert.equal(path.resolve(afterRestart.extractions[0].outputDir), outputDir);
    const outputFoldersAfterRestart = matchingOutputFolders(
      await fs.readdir(downloadsDir, { withFileTypes: true }),
      outputFolderName,
    );
    assert.deepEqual(outputFoldersAfterRestart, [outputFolderName]);
    assert.equal(await sha256(path.join(outputDir, "fixture-payload.bin")), await sha256(payloadPath));
    assert.equal(await fs.readFile(sentinel, "utf8"), "preserve-existing-output\n");
    report.idempotency.matchingDirectoriesAfterRestart = outputFoldersAfterRestart;
    assert.ok(!JSON.stringify(afterRestart).includes(password));
    assert.ok(!JSON.stringify(await manager.evaluate(() => chrome.storage.local.get(null))).includes(password));
    assert.deepEqual(report.pageErrors, []);
    return { status: "complete", outputDir: outputFolderName, extractedFolderCount: outputFoldersAfterRestart.length, passwordPersisted: false };
  });

  if (fatalError) throw fatalError;
  report.status = "pass";
  report.fixture = {
    archive: "encrypted split 7z generated locally",
    volumeCount: fixtureVolumes.length,
    volumeBytes: await Promise.all(fixtureVolumes.map(async (file) => (await fs.stat(file)).size)),
    payloadBytes: payload.length,
    downloadIds,
    outputFolder: path.basename(outputDir),
    sourcesRetained: true,
    existingOutputPreserved: true,
  };
  }
} catch (error) {
  report.status = "fail";
  report.error = (error.stack || String(error)).replaceAll(password, "[REDACTED]");
  if (context && manager && !manager.isClosed()) {
    report.failureState = await manager
      .evaluate(() => chrome.runtime.sendMessage({ type: "QC_GET" }))
      .then((reply) => reply?.state)
      .catch(() => undefined);
  }
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (context) {
    await context.close().then(() => (report.cleanup.profileClosed = true)).catch((error) => (report.cleanup.profileCloseError = error.message));
  }
  if (httpServer) {
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
    report.cleanup.fixtureServerClosed = true;
  }
  if (createdRegistryKey) {
    try {
      const value = execFileSync("reg.exe", ["query", registryKey, "/ve"], { encoding: "utf8", windowsHide: true });
      if (value.toLowerCase().includes(hostManifest.toLowerCase())) {
        execFileSync("reg.exe", ["delete", registryKey, "/f"], { stdio: "ignore", windowsHide: true });
        report.cleanup.registryRemoved = true;
      } else {
        report.cleanup.registryRemoved = false;
        report.cleanup.registryRemovalSkipped = "registration no longer points at this run's manifest";
      }
    } catch (error) {
      report.cleanup.registryRemovalError = error.message;
    }
  }
  const ownedProfile = path.resolve(profile);
  const ownedOut = path.resolve(out) + path.sep;
  if (ownedProfile.startsWith(ownedOut) && path.basename(ownedProfile) === "profile") {
    await fs.rm(ownedProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    report.cleanup.profileRemoved = true;
  }
  const ownedMetadataProfile = path.resolve(metadataProfile);
  if (ownedMetadataProfile.startsWith(ownedOut) && path.basename(ownedMetadataProfile) === "metadata-profile") {
    await fs.rm(ownedMetadataProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    report.cleanup.metadataProfileRemoved = true;
  }
  const ownedHelperHome = path.resolve(helperHome);
  if (ownedHelperHome.startsWith(ownedOut) && path.basename(ownedHelperHome) === "helper-state") {
    if (helperJobId) {
      const nativeJob = await fs
        .readFile(path.join(helperHome, "jobs", `${helperJobId}.json`), "utf8")
        .then(JSON.parse)
        .catch(() => undefined);
      if (nativeJob) {
        report.nativeJob = {
          status: nativeJob.status,
          errorCode: nativeJob.errorCode,
          sourceCount: nativeJob.paths?.length,
          sourceNames: nativeJob.paths?.map((sourcePath) => path.basename(sourcePath)),
          outputFolder: nativeJob.outputDir ? path.basename(nativeJob.outputDir) : undefined,
        };
      }
    }
    let workerExited = true;
    if (helperJobId) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const job = await fs
          .readFile(path.join(helperHome, "jobs", `${helperJobId}.json`), "utf8")
          .then(JSON.parse)
          .catch(() => undefined);
        const pid = job?.workerPid;
        if (!pid) break;
        try {
          process.kill(pid, 0);
          workerExited = false;
        } catch {
          workerExited = true;
          break;
        }
        await sleep(200);
      }
      if (!workerExited) {
        const job = await fs
          .readFile(path.join(helperHome, "jobs", `${helperJobId}.json`), "utf8")
          .then(JSON.parse)
          .catch(() => undefined);
        workerExited = !job?.workerPid;
      }
    }
    report.cleanup.helperWorkerExited = workerExited;
    if (workerExited) {
      await fs.rm(ownedHelperHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      report.cleanup.helperStateRemoved = true;
    } else {
      report.cleanup.helperStateRemoved = false;
      report.cleanup.helperStatePreservedForLiveWorker = true;
    }
  }
  report.finishedAt = new Date().toISOString();
  await writeReport();
  console.log(`REPORT ${path.relative(root, path.join(out, "report.json"))}`);
}
