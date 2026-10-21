import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
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
    openssl: { type: "string", default: "openssl" },
  },
});
const required = ["helper-exe", "seven-zip", "playwright-module", "browser-cache"];
for (const name of required)
  if (!values[name]) throw new Error(`Missing --${name}`);

const helperExe = path.resolve(values["helper-exe"]);
const sevenZip = path.resolve(values["seven-zip"]);
for (const [name, file] of [["helper exe", helperExe], ["7-Zip", sevenZip]])
  if (!(await fs.stat(file)).isFile()) throw new Error(`${name} not found: ${file}`);
const helperHash = createHash("sha256").update(await fs.readFile(helperExe)).digest("hex");
if (helperHash !== "0316baf852b8d486c9bb88c9433957dec4622f2ea1c6b69ce4d0970f77e1558c")
  throw new Error(`Unexpected helper SHA-256: ${helperHash}`);
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
const fixtureDir = path.join(out, "fixture");
const helperHome = path.join(out, "helper-state");
const hostManifest = path.join(out, "native-host.json");
const registryKey =
  "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.queuecat.helper";
const registryPath =
  "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.queuecat.helper";
const password = `queuecat-fixture-${randomUUID()}`;
const testedContentSha256 = createHash("sha256")
  .update(await fs.readFile(path.join(root, "artifacts", "unpacked", "content.js")))
  .digest("hex");
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  pageErrors: [],
  fixtureDownloads: [],
  nativeJob: undefined,
  queueGrouping: undefined,
  stateSeeding: { used: false, mechanism: "no storage writes in this runner" },
  fatalError: undefined,
  cleanup: {},
  helperSha256: helperHash,
  testedContentSha256,
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
      if (error?.fatalCheck) throw error;
      last = error;
      await sleep(200);
    }
  }
  throw new Error(`${label}: ${last?.message || "timed out"}`);
}
async function bounded(promise, label, timeout = 15_000) {
  return Promise.race([
    promise,
    sleep(timeout).then(() => { throw new Error(`${label}: timed out after ${timeout}ms`); }),
  ]);
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
let siteServer;
let downloadServer;
let createdRegistryKey = false;
let extensionOrigin;
let fixtureVolumes = [];
let downloadIds = [];
let helperJobId;
let fatalError;
let releaseSecondVolume;
const noteFatal = (error) => {
  if (fatalError) return;
  fatalError = error instanceof Error ? error : new Error(String(error));
  report.fatalError = (fatalError.stack || fatalError.message).replaceAll(password, "[REDACTED]");
  process.exitCode = 1;
  siteServer?.closeAllConnections();
  downloadServer?.closeAllConnections();
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

  const keyFile = path.join(fixtureDir, "fixture-key.pem");
  const certFile = path.join(fixtureDir, "fixture-cert.pem");
  const opensslConfig = path.join(fixtureDir, "openssl.cnf");
  await fs.writeFile(opensslConfig, "[req]\ndistinguished_name=dn\n[dn]\n", "utf8");
  execFileSync(values.openssl, [
    "req", "-config", opensslConfig, "-x509", "-newkey", "rsa:2048", "-nodes",
    "-days", "1", "-subj", "/CN=katfile.biz", "-keyout", keyFile, "-out", certFile,
  ], { stdio: "ignore", windowsHide: true });
  const tls = { key: await fs.readFile(keyFile), cert: await fs.readFile(certFile) };
  const sourceRows = new Map([
    ["abcdefghijk1", { filename: "fixture.7z.001", step: 0 }],
    ["abcdefghijk2", { filename: "fixture.7z.002", step: 0 }],
  ]);
  const cdnRequests = [];
  downloadServer = https.createServer(tls, (req, res) => {
    void (async () => {
      const name = new URL(req.url || "/", "https://cdn.katfile.biz").pathname.split("/").pop();
      const file = fixtureVolumes.find((candidate) => path.basename(candidate) === name);
      if (!file || req.method !== "GET" || req.headers.host?.split(":")[0] !== "cdn.katfile.biz") {
        res.writeHead(404).end();
        return;
      }
      cdnRequests.push({ filename: name, at: new Date().toISOString() });
      const stat = await fs.stat(file);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      });
      if (name.endsWith(".002")) {
        const bytes = await fs.readFile(file);
        res.write(bytes.subarray(0, -1));
        while (!releaseSecondVolume && !res.destroyed) await sleep(100);
        if (!res.destroyed) res.end(bytes.subarray(-1));
      } else if (!res.destroyed) {
        createReadStream(file).pipe(res);
      }
    })().catch((error) => {
      noteFatal(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve, reject) => {
    downloadServer.once("error", reject);
    downloadServer.listen(0, "127.0.0.1", resolve);
  });
  const cdnPort = downloadServer.address().port;
  await new Promise((resolve, reject) => {
    siteServer = https.createServer(tls, (req, res) => {
      const host = req.headers.host?.split(":")[0];
      const id = new URL(req.url || "/", "https://katfile.biz").pathname.split("/")[1];
      const entry = sourceRows.get(id);
      if (host !== "katfile.biz" || !entry) return res.writeHead(404).end();
      if (req.method === "POST") entry.step++;
      const href = `https://cdn.katfile.biz:${cdnPort}/download/${entry.filename}`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      if (entry.step >= 2) {
        res.end(`<!doctype html><title>Download ${entry.filename} - KatFile</title><h2>${entry.filename}</h2><a id="dlink" href="${href}">Continue free download</a>`);
      } else {
        const op = entry.step ? "download2" : "download1";
        res.end(`<!doctype html><title>Download ${entry.filename} - KatFile</title><h2>${entry.filename}</h2><form method="POST"><input name="op" value="${op}" type="hidden"><input name="id" value="${id}" type="hidden"><button>${op === "download1" ? "SLOW SPEED DOWNLOAD" : "Create download link"}</button></form>`);
      }
    });
    siteServer.once("error", reject);
    // QueueCat canonicalizes Katfile source URLs to the default HTTPS port.
    // Bind only if free; a pre-existing listener is left untouched and fails closed.
    siteServer.listen(443, "127.0.0.1", () => resolve());
  });
  report.isolation.network = "local HTTPS Katfile and CDN fixtures only; all browser hosts resolve to loopback";
  report.isolation.katfile = "synthetic page served over isolated loopback HTTPS";

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
      "--ignore-certificate-errors",
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
  report.cleanup.registryWasAbsentBeforeCreate = true;
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
    (await bounded(manager.evaluate(() => chrome.runtime.sendMessage({ type: "QC_GET" })), "QC_GET", 15_000)).state;
  const stopWorker = async () => {
    const cdp = await context.newCDPSession(manager);
    try {
      await cdp.send("ServiceWorker.enable");
      await cdp.send("ServiceWorker.stopAllWorkers");
    } finally {
      await cdp.detach();
    }
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

  await manager.locator('#hero-actions [data-action="start"]').click();
  await eventually(async () => {
    const current = await state();
    assert.equal(current.running, true);
    return current;
  }, "start actual QueueCat queue from manager UI");
  await record("one completed Chrome volume remains queued until every selected volume completes", async () => {
    const stillWaiting = await eventually(async () => {
      const current = await state();
      if (["blocked", "failed"].includes(current.items[0]?.status)) {
        const error = new Error(`Queue item entered terminal status ${current.items[0].status}: ${current.items[0].reason || "no reason recorded"}`);
        error.fatalCheck = true;
        throw error;
      }
      assert.equal(current.items[0]?.status, "complete");
      assert.equal(current.items[1]?.status, "downloading");
      assert.equal(current.extractions?.[0]?.status, "waiting");
      return current;
    }, "first real download completes while second remains in progress", 90_000);
    downloadIds = stillWaiting.items.map((item) => item.downloadId);
    assert.ok(downloadIds.every((id) => Number.isInteger(id)), "queue did not retain real Chrome download IDs");
    assert.equal(sourceRows.get("abcdefghijk1").step, 2, "first Katfile fixture did not receive both production form posts");
    assert.equal(sourceRows.get("abcdefghijk2").step, 2, "second Katfile fixture did not receive both production form posts");
    assert.equal(cdnRequests.filter((request) => request.filename === "fixture.7z.001").length, 1);
    assert.equal(cdnRequests.filter((request) => request.filename === "fixture.7z.002").length, 1);
    assert.equal(stillWaiting.extractions[0].status, "waiting");
    assert.equal(await fs.stat(sentinel).then(() => true), true);
    assert.deepEqual(
      (await fs.readdir(downloadsDir)).filter((name) => name.startsWith("fixture (extracted)")),
      ["fixture (extracted)"],
    );
    assert.ok(!stillWaiting.extractions[0].jobId);
    report.fixtureDownloads[0] = { id: downloadIds[0], filename: "fixture.7z.001", state: "complete" };
    report.fixtureDownloads[1] = { id: downloadIds[1], filename: "fixture.7z.002", state: "in_progress" };
    await manager.screenshot({ path: path.join(out, "manager-first-volume-complete-second-waiting.png"), fullPage: true });
    return { downloadIds, completedVolumes: 1, inProgressVolumes: 1, status: "waiting", extractionStarted: false };
  });

  releaseSecondVolume = true;

  const extracted = await eventually(async () => {
    const current = await state();
    helperJobId = current.extractions?.[0]?.jobId;
    assert.equal(current.items[0]?.status, "complete");
    assert.equal(current.items[1]?.status, "complete");
    assert.equal(current.extractions?.[0]?.status, "complete");
    assert.ok(current.extractions[0].outputDir);
    return current;
  }, "encrypted split archive extraction", 60_000);
  helperJobId = extracted.extractions[0].jobId;
  const outputDir = path.resolve(extracted.extractions[0].outputDir);
  assert.ok(outputDir.startsWith(path.resolve(downloadsDir) + path.sep), "output escaped isolated downloads folder");
  assert.notEqual(outputDir, outputSentinelDir, "existing output folder was overwritten");
  assert.equal(await sha256(path.join(outputDir, "fixture-payload.bin")), await sha256(payloadPath));
  const payloadHash = await sha256(payloadPath);
  const extractedPayloadHash = await sha256(path.join(outputDir, "fixture-payload.bin"));
  assert.equal(extractedPayloadHash, payloadHash);
  assert.equal(await fs.readFile(sentinel, "utf8"), "preserve-existing-output\n");
  const downloadedPaths = [];
  for (const id of downloadIds) {
    const [download] = await manager.evaluate((id) => chrome.downloads.search({ id }), id);
    assert.equal(download.state, "complete");
    assert.ok(path.resolve(download.filename).startsWith(path.resolve(downloadsDir) + path.sep), "Chrome download escaped isolated test directory");
    downloadedPaths.push(download.filename);
    report.fixtureDownloads[download.id === downloadIds[0] ? 0 : 1] = {
      id: download.id,
      filename: path.basename(download.filename),
      state: download.state,
      bytes: download.fileSize,
      byExtensionId: download.byExtensionId,
    };
  }
  assert.deepEqual(await Promise.all(downloadedPaths.map(sha256)), hashesBefore);
  assert.ok(!JSON.stringify(await state()).includes(password), "password leaked into persisted app state");
  const outputFolderName = path.basename(outputDir);
  const outputFoldersBeforeRestart = matchingOutputFolders(
    await fs.readdir(downloadsDir, { withFileTypes: true }),
    outputFolderName,
  );
  assert.deepEqual(outputFoldersBeforeRestart, [outputFolderName]);
  await manager.screenshot({ path: path.join(out, "manager-both-volumes-complete-extraction-complete.png"), fullPage: true });
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
    payloadSha256: payloadHash,
    extractedPayloadSha256: extractedPayloadHash,
    downloadIds,
    outputFolder: path.basename(outputDir),
    sourcesRetained: true,
    existingOutputPreserved: true,
    downloadsStartedBy: "production QueueCat service worker and content script after manager UI start",
    formPostsPerVolume: [sourceRows.get("abcdefghijk1").step, sourceRows.get("abcdefghijk2").step],
    stateSeeding: false,
    extractionStatus: extracted.extractions[0].status,
  };
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
  for (const [name, server] of [["siteServer", siteServer], ["downloadServer", downloadServer]]) {
    if (!server) continue;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    report.cleanup[`${name}Closed`] = true;
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
