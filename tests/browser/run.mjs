import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

// Only launches a new owned profile. Never attaches to a running browser.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { values } = parseArgs({
  options: {
    "playwright-module": { type: "string" },
    "browser-cache": { type: "string" },
    openssl: { type: "string", default: "openssl" },
    "recovery-only": { type: "boolean", default: false },
  },
});
if (values["browser-cache"])
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(values["browser-cache"]);
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";
const { chromium } = await import(
  values["playwright-module"]
    ? pathToFileURL(path.resolve(values["playwright-module"])).href
    : "playwright"
);
const out = path.join(
  root,
  "artifacts/browser-acceptance",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await fs.mkdir(out, { recursive: true });
const extension = path.join(out, "extension"),
  profile = path.join(out, "profile");
await fs.cp(path.join(root, "artifacts/unpacked"), extension, {
  recursive: true,
});
const manifest = JSON.parse(
  await fs.readFile(path.join(extension, "manifest.json"), "utf8"),
);
manifest.name = "QueueCat — isolated acceptance";
await fs.writeFile(
  path.join(extension, "manifest.json"),
  JSON.stringify(manifest),
);
await fs.writeFile(
  path.join(extension, "acceptance.html"),
  '<!doctype html><title>QueueCat isolated test control</title><button id="popup">Open popup</button><script src="acceptance.js"></script>',
);
await fs.writeFile(
  path.join(extension, "acceptance.js"),
  'document.querySelector("#popup").addEventListener("click",()=>chrome.action.openPopup().catch(error=>document.body.dataset.popupError=error.message));',
);
const keyFile = path.join(out, "fixture-key.pem"),
  certFile = path.join(out, "fixture-cert.pem");
const opensslConfig = path.join(out, "fixture-openssl.cnf");
await fs.writeFile(opensslConfig, "[req]\ndistinguished_name=dn\n[dn]\n");
execFileSync(
  values.openssl,
  [
    "req",
    "-config",
    opensslConfig,
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=cdn.katfile.biz",
    "-keyout",
    keyFile,
    "-out",
    certFile,
  ],
  { stdio: "ignore", windowsHide: true },
);
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  pageErrors: [],
  blockedNetwork: [],
  isolation: {
    profile,
    extension,
    personalChromeAttached: false,
    productionWorker: true,
    website: "Playwright synthetic Katfile responses",
    downloads: "loopback HTTPS fixture only",
    dns: "all hostnames mapped to 127.0.0.1 in this process",
    credentialsCopied: false,
  },
  limitations: [
    "Synthetic verification is not real CAPTCHA",
    "Popup document checks do not imply native toolbar popup coverage",
    "No live Katfile or personal Chrome operation",
  ],
  requests: [],
};
const gates = new Map(),
  streams = new Set();
const payload = Buffer.alloc(64 * 1024, 0x51);
const tls = {
  key: await fs.readFile(keyFile),
  cert: await fs.readFile(certFile),
};
const server = https.createServer(tls, (req, res) => {
  const filename = new URL(req.url, "https://localhost").pathname
    .split("/")
    .pop();
  if (
    req.headers.host?.split(":")[0] !== "cdn.katfile.biz" ||
    !/^[a-z-]+\.zip$/.test(filename || "")
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  const entry = {
    filename,
    at: Date.now(),
    endedAt: null,
    range: req.headers.range || null,
  };
  report.requests.push(entry);
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    ...(filename === "unknown-size.zip"
      ? {}
      : { "Content-Length": payload.length }),
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  streams.add(res);
  let sent = 0;
  const timer = setInterval(() => {
    const end = gates.get(filename) ? payload.length : payload.length - 1;
    if (sent < end) {
      const next = Math.min(sent + 8192, end);
      res.write(payload.subarray(sent, next));
      sent = next;
    }
    if (sent === payload.length) {
      entry.endedAt = Date.now();
      clearInterval(timer);
      res.end();
    }
  }, 40);
  res.on("close", () => {
    clearInterval(timer);
    streams.delete(res);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
let context, control, origin;
const fixtures = new Map();
// chrome.tabs.create can navigate before Playwright attaches its routing session.
// Serve source pages on loopback too, so even that first request stays isolated.
const siteServer = https.createServer(tls, (req, res) => {
  const host = req.headers.host?.split(":")[0];
  const id = new URL(req.url, "https://localhost").pathname.split("/")[1];
  req.resume();
  if (!["katfile.biz", "katfile.com"].includes(host) || !fixtures.has(id)) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (host === "katfile.com" && fixtures.get(id).kind === "redirect") {
    res.writeHead(302, { Location: source(id, fixtures.get(id).filename) });
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fixtureHtml(id, fixtures.get(id), req.method));
});
try {
  await new Promise((resolve, reject) => {
    siteServer.once("error", reject);
    siteServer.listen(443, "127.0.0.1", resolve);
  });
} catch (error) {
  await new Promise((resolve) => server.close(resolve));
  throw new Error(
    `Loopback fixture HTTPS port unavailable; no existing listener was changed: ${error.message}`,
  );
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bounded(promise, label, ms = 8000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Isolated operation timed out: ${label}`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function eventually(check, label, timeout = 12_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      return await check();
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`${label}: ${last?.message || "timeout"}`);
}
async function check(name, fn) {
  const start = Date.now();
  console.log(`RUN ${name}`);
  report.currentCheck = name;
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  const result = await fn();
  report.checks.push({ name, status: "pass", ms: Date.now() - start, result });
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(`PASS ${name}`);
  return result;
}
function source(id, filename) {
  return `https://katfile.biz/${id}/${filename}.html`;
}
function finalUrl(filename) {
  return `https://cdn.katfile.biz:${port}/download/${filename}`;
}
const form = (id, op) =>
  `<form method="POST"><input name="op" value="${op}" type="hidden"><input name="id" value="${id}" type="hidden"><button>${op === "download1" ? "SLOW SPEED DOWNLOAD" : "Create download link"}</button></form>`;
function fixtureHtml(id, f, method) {
  if (method === "POST") f.step++;
  let body;
  if (f.kind === "missing")
    body = '<div class="alert-danger">File not found</div>';
  else if (f.kind === "unknown") body = "Unknown fixture structure";
  else if (f.step >= 2 || f.kind === "ready")
    body = `<h1>您的免費下載速度受到限制</h1><a href="https://katfile.biz/?op=payments">升級 Premium</a><a id="dlink" href="${finalUrl(f.filename)}">繼續免費下載</a>`;
  else {
    body = form(id, f.step ? "download2" : "download1");
    if (f.kind === "waiting" && !f.step)
      body +=
        '<div id="delay-box">下載之間的等待時間必須不少於120分鐘，請稍後再試。<span id="kfaTimer">00:00:02</span></div><script>let n=2;const timer=setInterval(()=>{if(--n===0){document.querySelector("#delay-box").remove();clearInterval(timer)}else document.querySelector("#kfaTimer").textContent="00:00:01"},1000)</script>';
    if (f.kind === "verification" && !f.step)
      body +=
        '<div class="cf-turnstile">Synthetic verification</div><button id="manual-verify" onclick="document.querySelector(\'.cf-turnstile\').remove();this.remove()">Complete fixture verification</button>';
  }
  return `<!doctype html><title>Download ${f.filename} - KatFile</title><h2>${f.filename}</h2>${body}`;
}
async function launch() {
  console.log("Launching owned isolated Chromium profile...");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    locale: "en-US",
    headless: false,
    acceptDownloads: true,
    downloadsPath: path.join(out, "downloads"),
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--window-position=-32000,-32000",
      "--host-resolver-rules=MAP * 127.0.0.1",
      "--no-proxy-server",
      "--ignore-certificate-errors",
      "--disable-background-networking",
    ],
  });
  context.on("page", (page) =>
    page.on("pageerror", (error) => report.pageErrors.push(error.message)),
  );
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "cdn.katfile.biz" && url.port === String(port))
      return route.continue();
    const id = url.pathname.split("/")[1];
    if (
      ["katfile.biz", "katfile.com"].includes(url.hostname) &&
      fixtures.has(id)
    )
      return route.continue();
    report.blockedNetwork.push(url.origin);
    return route.abort("blockedbyclient");
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  origin = worker.url().split("/").slice(0, 3).join("/");
  control = await context.newPage();
  await control.goto(`${origin}/acceptance.html`);
  report.browserVersion = context.browser()?.version();
}
const command = (cmd) =>
  bounded(
    control.evaluate(
      (cmd) => chrome.runtime.sendMessage({ type: "QC_COMMAND", command: cmd }),
      cmd,
    ),
    `QC_COMMAND ${cmd.kind}`,
  );
const state = async () =>
  (
    await bounded(
      control.evaluate(() => chrome.runtime.sendMessage({ type: "QC_GET" })),
      "QC_GET",
    )
  ).state;
const downloads = () => control.evaluate(() => chrome.downloads.search({}));
async function expectStatus(status, index = 0, timeout = 12_000) {
  return eventually(
    async () => {
      const s = await state();
      assert.equal(s.items[index]?.status, status);
      return s;
    },
    `item ${index}: ${status}`,
    timeout,
  );
}
async function stopWorker() {
  const cdp = await bounded(
    context.newCDPSession(control),
    "attach owned lifecycle diagnostic",
  );
  await bounded(
    cdp.send("ServiceWorker.enable"),
    "enable worker lifecycle events",
  );
  await bounded(cdp.send("ServiceWorker.stopAllWorkers"), "stop owned workers");
  await bounded(cdp.detach(), "detach owned worker diagnostic");
}
async function reset() {
  if (values["recovery-only"])
    console.log("Reset: pause and remove owned fixture tabs");
  await command({ kind: "pause" });
  const tabs = await control.evaluate(() => chrome.tabs.query({}));
  for (const tab of tabs)
    if (tab.url?.startsWith("https://katfile."))
      await control.evaluate((id) => chrome.tabs.remove(id), tab.id);
  for (const d of await downloads())
    if (d.state === "in_progress")
      await control.evaluate((id) => chrome.downloads.cancel(id), d.id);
  await stopWorker();
  if (values["recovery-only"])
    console.log("Reset: worker stopped, clear isolated state");
  await control.evaluate(() =>
    chrome.storage.local.remove("queuecat.state.v1"),
  );
  await stopWorker();
  await command({
    kind: "settings",
    settings: { notifications: false, language: "zh-TW" },
  });
  if (values["recovery-only"]) console.log("Reset complete");
}
async function seed(s) {
  s.settings.language = "zh-TW";
  await stopWorker();
  await control.evaluate(
    (s) => chrome.storage.local.set({ "queuecat.state.v1": s }),
    s,
  );
  await stopWorker();
}
async function checkLocales() {
  const initial = await state();
  assert.equal(initial.settings.language, "system");
  const manager = await context.newPage();
  await manager.goto(`${origin}/manager.html`);
  await manager.waitForFunction(() => document.documentElement.lang === "en");
  assert.ok(await manager.locator("#status-title").innerText());

  // A synthetic in-progress card makes the mascot/card overlap measurable without
  // starting a download or contacting any website.
  const fixtureState = await state();
  const now = Date.now();
  const current = {
    id: "locale-visual-fixture",
    sourceUrl: "https://katfile.biz/aaaaaaaaaaaa/locale-card.zip.html",
    title: "locale-card.zip",
    status: "downloading",
    createdAt: now,
    updatedAt: now,
    bytesReceived: 1024,
    totalBytes: 4096,
    speed: 256,
    events: [],
  };
  fixtureState.items = [current];
  fixtureState.activeId = current.id;
  await seed(fixtureState);
  const translatedTitles = [];
  const desktopStatusTitles = [];
  const popupStatusTitles = [];
  for (const language of ["en", "zh-TW", "ja"]) {
    const settings = manager.locator("#settings-panel");
    await manager.goto(`${origin}/manager.html#settings`);
    await settings.waitFor({ state: "visible" });
    const languageSelect = manager.locator("select").filter({
      has: manager.locator('option[value="ja"]'),
    });
    assert.equal(await languageSelect.count(), 1);
    await languageSelect.selectOption(language);
    const expectedHtmlLanguage = language === "zh-TW" ? "zh-TW" : language;
    await manager.waitForFunction(
      (expected) => document.documentElement.lang === expected,
      expectedHtmlLanguage,
    );
    assert.equal((await state()).settings.language, language);
    await manager.reload();
    await manager.waitForFunction(
      (expected) => document.documentElement.lang === expected,
      expectedHtmlLanguage,
    );
    const persistedSelector = manager.locator("select").filter({
      has: manager.locator('option[value="ja"]'),
    });
    assert.equal(await persistedSelector.inputValue(), language);
    translatedTitles.push(
      await manager.locator("#settings-panel h2").innerText(),
    );

    await command({
      kind: "settings",
      settings: { theme: language === "ja" ? "dark" : "light" },
    });
    await manager.goto(`${origin}/manager.html`);
    await manager.waitForFunction(
      (expected) => document.documentElement.lang === expected,
      expectedHtmlLanguage,
    );
    await manager.waitForFunction(
      (expected) => document.documentElement.dataset.theme === expected,
      language === "ja" ? "dark" : "light",
    );
    await manager.locator('#current[data-status="downloading"]').waitFor();
    assert.ok(await manager.locator("#status-title").innerText());
    desktopStatusTitles.push(
      await manager.locator("#status-title").innerText(),
    );
    if (language === "en") {
      assert.equal(
        await manager
          .locator("#list-title")
          .innerText()
          .then((text) => /[\u3400-\u9fff]/.test(text)),
        false,
        "queue heading must also be localized",
      );
      assert.equal(await manager.title(), "QueueCat · Download Queue");
    }
    const managerLayout = await manager.evaluate(() => {
      const mascot = document.querySelector("#mascot");
      const card = document.querySelector("#current");
      const image = mascot.getBoundingClientRect();
      const current = card.getBoundingClientRect();
      const x1 = Math.max(image.left, current.left);
      const y1 = Math.max(image.top, current.top);
      const x2 = Math.min(image.right, current.right);
      const y2 = Math.min(image.bottom, current.bottom);
      const overlap = x2 > x1 && y2 > y1;
      const hit = overlap
        ? document.elementFromPoint((x1 + x2) / 2, (y1 + y2) / 2)
        : null;
      const imageStyle = getComputedStyle(mascot);
      return {
        width: image.width,
        pointerEvents: imageStyle.pointerEvents,
        imageZ: Number(imageStyle.zIndex),
        cardZ: Number(getComputedStyle(card).zIndex),
        overlap,
        overlapHitIsCurrent: Boolean(hit?.closest("#current")),
        horizontalOverflow:
          document.documentElement.scrollWidth >
            document.documentElement.clientWidth ||
          document.body.scrollWidth > document.body.clientWidth,
      };
    });
    assert.ok(managerLayout.width > 220, "desktop mascot should be enlarged");
    assert.equal(managerLayout.pointerEvents, "none");
    assert.ok(managerLayout.imageZ < managerLayout.cardZ);
    assert.ok(managerLayout.overlap, "mascot should overlap the current card");
    assert.ok(
      managerLayout.overlapHitIsCurrent,
      "overlap must not block card clicks",
    );
    assert.equal(managerLayout.horizontalOverflow, false);
    await manager.screenshot({
      path: path.join(out, `manager-${language}.png`),
      fullPage: true,
    });

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 580 });
    await popup.goto(`${origin}/popup.html`);
    await popup.waitForFunction(
      (expected) => document.documentElement.lang === expected,
      expectedHtmlLanguage,
    );
    await popup.locator('#current[data-status="downloading"]').waitFor();
    popupStatusTitles.push(await popup.locator("#status-title").innerText());
    const popupLayout = await popup.evaluate(() => {
      const mascot = document.querySelector("#mascot");
      const card = document.querySelector("#current");
      const image = mascot.getBoundingClientRect();
      const current = card.getBoundingClientRect();
      const x1 = Math.max(image.left, current.left);
      const y1 = Math.max(image.top, current.top);
      const x2 = Math.min(image.right, current.right);
      const y2 = Math.min(image.bottom, current.bottom);
      const hit =
        x2 > x1 && y2 > y1
          ? document.elementFromPoint((x1 + x2) / 2, (y1 + y2) / 2)
          : null;
      return {
        width: image.width,
        pointerEvents: getComputedStyle(mascot).pointerEvents,
        imageZ: Number(getComputedStyle(mascot).zIndex),
        cardZ: Number(getComputedStyle(card).zIndex),
        overlap: x2 > x1 && y2 > y1,
        overlapHitIsCurrent: Boolean(hit?.closest("#current")),
        horizontalOverflow:
          document.documentElement.scrollWidth >
            document.documentElement.clientWidth ||
          document.body.scrollWidth > document.body.clientWidth,
      };
    });
    assert.ok(popupLayout.width > 220, "popup mascot should be enlarged");
    assert.equal(popupLayout.pointerEvents, "none");
    assert.ok(popupLayout.imageZ < popupLayout.cardZ);
    assert.ok(popupLayout.overlap);
    assert.ok(popupLayout.overlapHitIsCurrent);
    assert.equal(popupLayout.horizontalOverflow, false);
    await popup.screenshot({ path: path.join(out, `popup-${language}.png`) });
    await popup.close();
  }
  assert.equal(
    new Set(translatedTitles).size,
    3,
    "settings heading should use each locale catalog",
  );
  assert.equal(
    new Set(desktopStatusTitles).size,
    3,
    "desktop status title should use each locale catalog",
  );
  assert.equal(
    new Set(popupStatusTitles).size,
    3,
    "popup status title should use each locale catalog",
  );

  const unknownState = await state();
  unknownState.items[0].totalBytes = -1;
  await seed(unknownState);
  for (const language of ["en", "ja"]) {
    await command({ kind: "settings", settings: { language } });
    await manager.goto(`${origin}/manager.html`);
    await manager.waitForFunction(
      (expected) => document.documentElement.lang === expected,
      language,
    );
    await manager.locator('#current[data-status="downloading"]').waitFor();
    assert.equal(
      await manager
        .locator("#current .transfer-meta")
        .innerText()
        .then((text) => text.includes("大小未知")),
      false,
    );
    assert.equal(
      await manager.locator("#current progress").getAttribute("value"),
      null,
      "unknown sizes must keep indeterminate progress",
    );
  }
  // System locale lists use supported-language matching and otherwise fall back.
  await manager.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "languages", {
      configurable: true,
      get: () => {
        const override = new URL(location.href).searchParams.get(
          "locale-test-languages",
        );
        return override ? override.split(",") : ["fr-FR", "de-DE"];
      },
    });
  });
  await manager.goto(
    `${origin}/manager.html?locale-test-languages=fr-FR,de-DE#settings`,
  );
  const languageSelect = manager.locator("select").filter({
    has: manager.locator('option[value="ja"]'),
  });
  await languageSelect.selectOption("system");
  await manager.waitForFunction(() => document.documentElement.lang === "en");
  assert.equal((await state()).settings.language, "system");
  for (const [systemLanguages, expected] of [
    ["zh-CN,en-US", "zh-TW"],
    ["ja-JP,en-US", "ja"],
  ]) {
    await manager.goto(
      `${origin}/manager.html?locale-test-languages=${systemLanguages}#settings`,
    );
    await languageSelect.selectOption("system");
    await manager.waitForFunction(
      (language) => document.documentElement.lang === language,
      expected,
    );
  }

  // A language change while the add form is open must keep the user's text.
  await manager.goto(`${origin}/manager.html#add`);
  const input = manager.locator("#url-input");
  await input.fill(
    "https://katfile.biz/aaaaaaaaaaaa/typed-before-locale.zip.html",
  );
  await command({ kind: "settings", settings: { language: "ja" } });
  await manager.waitForFunction(() => document.documentElement.lang === "ja");
  assert.equal(
    await input.inputValue(),
    "https://katfile.biz/aaaaaaaaaaaa/typed-before-locale.zip.html",
  );
  await command({
    kind: "settings",
    settings: { language: "zh-TW", theme: "system" },
  });
  await reset();
  await manager.close();
  return { languages: ["en", "zh-TW", "ja"], screenshots: 6 };
}
try {
  await launch();
  await check("system default and three-language UI acceptance", checkLocales);
  if (!values["recovery-only"]) {
    await command({
      kind: "settings",
      settings: { notifications: false, language: "zh-TW" },
    });
    await check("bulk URL preview and add do not start queue", async () => {
      const manager = await context.newPage();
      await manager.goto(`${origin}/manager.html`);
      await manager.locator("#url-input").waitFor({ state: "visible" });
      await manager.waitForFunction(
        () => document.activeElement?.id === "url-input",
      );
      assert.equal(await manager.locator("#current").isVisible(), false);
      await manager.screenshot({
        path: path.join(out, "onboarding-desktop.png"),
      });
      await manager
        .locator("#url-input")
        .fill(
          [
            source("aaaaaaaaaaaa", "one.zip"),
            source("aaaaaaaaaaaa", "one.zip"),
            "https://unsupported.invalid/a",
          ].join("\n"),
        );
      await manager.waitForFunction(() =>
        document.querySelector("#url-preview").textContent.includes("1 個重複"),
      );
      await manager.locator("#confirm-add").click();
      const s = await eventually(async () => {
        const s = await state();
        assert.equal(s.items.length, 1);
        return s;
      }, "bulk add");
      assert.equal(s.running, false);
      assert.equal(s.items[0].status, "queued");
      await manager.waitForFunction(
        () =>
          document.querySelector("#add-panel").hidden &&
          document.activeElement?.getAttribute("data-action") === "start",
      );
      await manager.close();
    });
    await reset();
    fixtures.set("aaaaaaaaaaaa", {
      kind: "waiting",
      filename: "one.zip",
      step: 0,
    });
    fixtures.set("bbbbbbbbbbbb", {
      kind: "verification",
      filename: "two.zip",
      step: 0,
    });
    await command({
      kind: "add",
      urls: [
        source("aaaaaaaaaaaa", "one.zip"),
        source("bbbbbbbbbbbb", "two.zip"),
      ],
    });
    await command({ kind: "start" });
    await check(
      "actual content script reads countdown, then two native POST steps",
      async () => {
        const s = await expectStatus("waiting");
        assert.ok(s.items[0].waitUntil - Date.now() < 5000);
        await expectStatus("downloading");
        assert.equal(fixtures.get("aaaaaaaaaaaa").step, 2);
      },
    );
    await check(
      "only first real Chrome download runs; popup shows live progress",
      async () => {
        const s = await state();
        assert.equal(s.items[1].status, "queued");
        const d = (await downloads()).find(
          (d) => d.id === s.items[0].downloadId,
        );
        assert.equal(d.byExtensionId, new URL(origin).hostname);
        assert.equal(d.state, "in_progress");
        assert.ok(report.requests.some((x) => x.filename === "one.zip"));
        assert.ok(!report.requests.some((x) => x.filename === "two.zip"));
        const popup = await context.newPage();
        await popup.setViewportSize({ width: 380, height: 580 });
        await popup.goto(`${origin}/popup.html`);
        await popup.locator('#current[data-status="downloading"]').waitFor();
        assert.ok(await popup.locator(".transfer-meta").innerText());
        assert.equal(
          await popup.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          ),
          false,
        );
        await popup.screenshot({
          path: path.join(out, "popup-downloading.png"),
        });
        await popup.close();
        return { downloadId: d.id, byExtensionId: d.byExtensionId };
      },
    );
    await check(
      "keyboard focus survives selection and progress updates",
      async () => {
        const manager = await context.newPage();
        await manager.goto(`${origin}/manager.html`);
        const s = await state();
        const id = s.items[0].id;
        const file = manager.locator(`[data-select="${id}"]`);
        await file.focus();
        await manager.keyboard.press("Enter");
        assert.equal(
          await manager.evaluate(() =>
            document.activeElement?.getAttribute("data-select"),
          ),
          id,
        );
        // A real UI storage event with changed bytes exercises replacement while focused.
        s.items[0].bytesReceived += 1;
        await seed(s);
        await manager.waitForFunction(
          (id) =>
            document
              .querySelector(`[data-select="${id}"]`)
              ?.getAttribute("aria-expanded") === "true",
          id,
        );
        assert.equal(
          await manager.evaluate(() =>
            document.activeElement?.getAttribute("data-select"),
          ),
          id,
        );
        const action = manager.locator('#current [data-action="downloads"]');
        await action.focus();
        await manager.waitForFunction(
          () =>
            document.activeElement?.getAttribute("data-action") === "downloads",
        );
        await manager.screenshot({
          path: path.join(out, "manager-keyboard-focus.png"),
        });
        await manager.close();
      },
    );
    await check(
      "worker termination wakes and reattaches original download ID",
      async () => {
        const before = (await state()).items[0].downloadId;
        await stopWorker();
        const s = await expectStatus("downloading");
        assert.equal(s.items[0].downloadId, before);
        assert.equal((await downloads()).length, 1);
      },
    );
    await check(
      "pause stops next item but current Chrome download completes",
      async () => {
        await command({ kind: "pause" });
        gates.set("one.zip", true);
        await expectStatus("complete");
        const s = await state();
        assert.equal(s.running, false);
        assert.equal(s.items[1].status, "queued");
        assert.equal((await downloads()).length, 1);
      },
    );
    await check(
      "fixture verification holds and resumes once user completes it",
      async () => {
        await command({ kind: "start" });
        const s = await expectStatus("verification", 1, 45_000);
        assert.equal((await downloads()).length, 1);
        assert.deepEqual(
          await control.evaluate(() => chrome.notifications.getAll()),
          {},
        );
        const tabId = s.items[1].tabId;
        await command({ kind: "focus", id: s.items[1].id });
        assert.equal(
          (await control.evaluate(() => chrome.tabs.query({ active: true })))[0]
            .id,
          tabId,
        );
        const page = context
          .pages()
          .find((p) => p.url().includes("bbbbbbbbbbbb"));
        await page.locator("#manual-verify").click();
        await expectStatus("downloading", 1);
        gates.set("two.zip", true);
        await expectStatus("complete", 1);
        assert.equal(fixtures.get("bbbbbbbbbbbb").step, 2);
        assert.equal((await downloads()).length, 2);
        assert.ok(
          report.requests.find((x) => x.filename === "two.zip").at >=
            report.requests.find((x) => x.filename === "one.zip").endedAt,
        );
      },
    );
    await check(
      "real Downloads API timestamp equality is measured",
      async () => {
        const d = (await downloads())[0];
        return control.evaluate(
          async (d) => ({
            id: d.id,
            at: d.startTime,
            exactIdFound: (await chrome.downloads.search({ id: d.id })).length,
            equalAfterIncludesId: (
              await chrome.downloads.search({ startedAfter: d.startTime })
            ).some((x) => x.id === d.id),
          }),
          d,
        );
      },
    );
    await check(
      "persisted handoff recovers a download at the exact timestamp boundary",
      async () => {
        const s = await state(),
          d = (await downloads()).find((d) => d.id === s.items[0].downloadId);
        s.items = [s.items[0]];
        s.activeId = s.items[0].id;
        s.running = false;
        s.items[0].status = "handoff";
        delete s.items[0].downloadId;
        s.items[0].action = {
          id: "fixture-exact-boundary",
          kind: "download",
          at: Date.parse(d.startTime),
          expectedUrl: d.url,
        };
        const count = (await downloads()).length;
        await seed(s);
        await expectStatus("complete");
        assert.equal((await state()).items[0].downloadId, d.id);
        assert.equal((await downloads()).length, count);
      },
    );
    await reset();
    await check(
      "existing page-started Katfile transfer prevents another download",
      async () => {
        const p = await context.newPage();
        const downloadEvent = p.waitForEvent("download");
        await p.goto(finalUrl("external.zip")).catch((error) => {
          if (
            !error.message.includes("Download is starting") &&
            !error.message.includes("ERR_ABORTED")
          )
            throw error;
        });
        await downloadEvent;
        const external = (await downloads()).find(
          (d) => d.url === finalUrl("external.zip"),
        );
        assert.ok(external);
        assert.equal(external.byExtensionId, undefined);
        fixtures.set("gggggggggggg", {
          kind: "ready",
          filename: "after-external.zip",
          step: 0,
        });
        gates.set("after-external.zip", true);
        await command({
          kind: "add",
          urls: [source("gggggggggggg", "after-external.zip")],
        });
        await command({ kind: "start" });
        const s = await state();
        assert.equal(s.externalDownloadId, external.id);
        assert.equal(s.activeId, undefined);
        assert.ok(
          !report.requests.some((x) => x.filename === "after-external.zip"),
        );
        gates.set("external.zip", true);
        await expectStatus("complete");
        assert.ok(
          report.requests.find((x) => x.filename === "after-external.zip").at >=
            report.requests.find((x) => x.filename === "external.zip").endedAt,
        );
        await p.close();
      },
    );
    await reset();
    await check(
      "missing file stays in attention and next item completes after safety gap",
      async () => {
        fixtures.set("hhhhhhhhhhhh", {
          kind: "missing",
          filename: "missing.zip",
          step: 0,
        });
        fixtures.set("iiiiiiiiiiii", {
          kind: "ready",
          filename: "after-missing.zip",
          step: 0,
        });
        gates.set("after-missing.zip", true);
        await command({
          kind: "add",
          urls: [
            source("hhhhhhhhhhhh", "missing.zip"),
            source("iiiiiiiiiiii", "after-missing.zip"),
          ],
        });
        await command({ kind: "start" });
        await expectStatus("failed");
        await expectStatus("complete", 1, 45_000);
        assert.equal((await state()).items[0].status, "failed");
        assert.ok(!report.requests.some((x) => x.filename === "missing.zip"));
      },
    );
    await reset();
    await check(
      "unknown download size shows bytes without a fabricated percentage",
      async () => {
        fixtures.set("jjjjjjjjjjjj", {
          kind: "ready",
          filename: "unknown-size.zip",
          step: 0,
        });
        await command({
          kind: "add",
          urls: [source("jjjjjjjjjjjj", "unknown-size.zip")],
        });
        await command({ kind: "start" });
        const s = await expectStatus("downloading");
        assert.ok(s.items[0].totalBytes <= 0);
        const popup = await context.newPage();
        await popup.setViewportSize({ width: 380, height: 580 });
        await popup.goto(`${origin}/popup.html`);
        await popup.locator('#current[data-status="downloading"]').waitFor();
        assert.equal(
          await popup.locator("#current progress").getAttribute("value"),
          null,
        );
        assert.ok(
          (await popup.locator(".transfer-meta").innerText()).includes(
            "大小未知",
          ),
        );
        await popup.screenshot({
          path: path.join(out, "popup-unknown-size.png"),
        });
        await popup.close();
        gates.set("unknown-size.zip", true);
        await expectStatus("complete");
      },
    );
    await reset();
    await check(
      "unknown handoff survives restart blocked without another transfer",
      async () => {
        await command({
          kind: "add",
          urls: [source("ffffffffffff", "handoff.zip")],
        });
        const s = await state();
        s.running = true;
        s.activeId = s.items[0].id;
        s.items[0].status = "handoff";
        s.items[0].action = {
          id: "fixture-missing-handoff",
          kind: "download",
          at: Date.now(),
          expectedUrl: finalUrl("handoff.zip"),
        };
        const count = (await downloads()).length;
        await seed(s);
        await expectStatus("blocked");
        const retry = await command({ kind: "retry", id: s.items[0].id });
        assert.equal(retry.ok, false);
        assert.equal((await downloads()).length, count);
        assert.ok(!report.requests.some((x) => x.filename === "handoff.zip"));
      },
    );
    await reset();
    fixtures.set("cccccccccccc", {
      kind: "unknown",
      filename: "unknown.zip",
      step: 0,
    });
    await command({
      kind: "add",
      urls: [source("cccccccccccc", "unknown.zip")],
    });
    await command({ kind: "start" });
    await check(
      "unknown page stops after grace period without starting a download",
      async () => {
        await eventually(
          async () => assert.equal((await state()).items[0].status, "blocked"),
          "unknown grace and alarm wakeup",
          35_000,
        );
        assert.ok(!report.requests.some((x) => x.filename === "unknown.zip"));
      },
    );
    await reset();
    fixtures.set("dddddddddddd", {
      kind: "verification",
      filename: "closed.zip",
      step: 0,
    });
    await command({
      kind: "add",
      urls: [source("dddddddddddd", "closed.zip")],
    });
    await command({ kind: "start" });
    await check(
      "closing owned work tab blocks and never redownloads",
      async () => {
        const s = await expectStatus("verification");
        await control.evaluate(
          (id) => chrome.tabs.remove(id),
          s.items[0].tabId,
        );
        await expectStatus("blocked");
        assert.ok(!report.requests.some((x) => x.filename === "closed.zip"));
      },
    );
    await reset();
    await command({
      kind: "add",
      urls: [source("eeeeeeeeeeee", "persist.zip")],
    });
    await check(
      "isolated full browser restart preserves paused queue and settings",
      async () => {
        await command({
          kind: "settings",
          settings: { theme: "dark", reducedMotion: true },
        });
        const before = await state();
        await context.close();
        context = undefined;
        await launch();
        const after = await state();
        assert.deepEqual(after, before);
      },
    );
  }
  await reset();
  await check(
    "same-file alias redirect completes using production content actions",
    async () => {
      fixtures.set("kkkkkkkkkkkk", {
        kind: "redirect",
        filename: "alias.zip",
        step: 0,
      });
      gates.set("alias.zip", true);
      await command({
        kind: "add",
        urls: [
          source("kkkkkkkkkkkk", "alias.zip").replace(
            "katfile.biz",
            "katfile.com",
          ),
        ],
      });
      await command({ kind: "start" });
      const s = await expectStatus("complete");
      assert.equal(fixtures.get("kkkkkkkkkkkk").step, 2);
      const tab = await control.evaluate(
        (id) => chrome.tabs.get(id),
        s.items[0].tabId,
      );
      assert.ok(tab.url.startsWith("https://katfile.biz/kkkkkkkkkkkk/"));
      assert.ok(s.items[0].sourceUrl.startsWith("https://katfile.com/"));
    },
  );
  await reset();
  report.limitations.push(
    "Discarded-tab + lifecycle diagnostic stalled the owned automation session; coverage remains unknown, no product failure inferred.",
  );
  await check(
    "popup keeps vertical scrolling without horizontal overflow",
    async () => {
      await command({
        kind: "add",
        urls: [source("mmmmmmmmmmmm", "long-filename-which-wraps.zip")],
      });
      const s = await state();
      s.running = false;
      s.activeId = s.items[0].id;
      s.items[0].status = "blocked";
      s.items[0].reason = "需要先確認目前狀態，這是隔離介面測試。";
      await seed(s);
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 380, height: 420 });
      await popup.goto(`${origin}/popup.html`);
      await popup.locator('#current[data-status="blocked"]').waitFor();
      const dimensions = await popup.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        height: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      assert.ok(dimensions.scrollHeight > dimensions.height);
      assert.ok(dimensions.scrollWidth <= dimensions.width);
      await popup.screenshot({
        path: path.join(out, "popup-vertical-scroll.png"),
      });
      await popup.close();
      return dimensions;
    },
  );
  await check(
    "narrow manager renders light and dark themes without horizontal overflow",
    async () => {
      const manager = await context.newPage();
      await manager.setViewportSize({ width: 620, height: 820 });
      await manager.goto(`${origin}/manager.html#settings`);
      for (const theme of ["light", "dark"]) {
        await manager.locator("#theme").selectOption(theme);
        await manager.waitForFunction(
          (theme) => document.documentElement.dataset.theme === theme,
          theme,
        );
        assert.equal(
          await manager.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          ),
          false,
        );
        await manager.screenshot({
          path: path.join(out, `manager-narrow-${theme}.png`),
          fullPage: true,
        });
      }
      await manager.locator("#theme").selectOption("system");
      await manager.close();
    },
  );
  await check(
    "refined popup keeps actions visible and routes uncertain handoff to recheck",
    async () => {
      const s = await state();
      const item = s.items[0];
      s.running = false;
      s.activeId = item.id;
      Object.assign(item, {
        status: "downloading",
        title: "這是一份很長的檔案名稱_旅行照片與備份資料.part01.zip",
        downloadId: undefined,
        action: undefined,
        totalBytes: 1024 ** 3,
        bytesReceived: 256 * 1024 ** 2,
      });
      await seed(s);
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 380, height: 580 });
      await popup.goto(`${origin}/popup.html`);
      await popup.locator('#current[data-status="downloading"]').waitFor();
      const footer = await popup.locator(".popup-footer").boundingBox();
      assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= 580);
      const card = await popup.locator("#current").boundingBox();
      const summary = await popup.locator("#popup-summary").boundingBox();
      assert.ok(card && summary && card.y + card.height <= summary.y);
      assert.equal(
        await popup.locator("#current progress").getAttribute("value"),
        "25",
      );
      await popup.screenshot({
        path: path.join(out, "popup-refined-progress.png"),
      });
      item.status = "blocked";
      item.action = {
        id: "fixture-only",
        kind: "download",
        at: Date.now(),
        expectedUrl: finalUrl("fixture-only.zip"),
      };
      await seed(s);
      await popup
        .locator('#hero-actions .primary[data-action="recheck"]')
        .waitFor();
      await popup.screenshot({
        path: path.join(out, "popup-refined-recheck.png"),
      });
      s.items = [];
      s.activeId = undefined;
      await seed(s);
      await popup
        .locator('#hero-actions .primary[data-action="add"]')
        .waitFor();
      assert.equal(await popup.locator("#current").isVisible(), false);
      await popup.screenshot({
        path: path.join(out, "popup-refined-empty.png"),
      });
      await popup.close();
      return { seededPresentation: true, actualDownload: false, footer };
    },
  );
  await check(
    "brand message and private-data-free introduction remain clear on desktop and narrow screens",
    async () => {
      const manager = await context.newPage();
      await manager.setViewportSize({ width: 1280, height: 900 });
      await manager.goto(`${origin}/manager.html`);
      await manager.locator("#first-promise").waitFor({ state: "visible" });
      assert.equal(
        await manager.locator("#status-title").innerText(),
        "把等待，交給貓貓。",
      );
      assert.equal(await manager.locator("#first-promise li").count(), 3);
      await manager.screenshot({
        path: path.join(out, "brand-onboarding-desktop.png"),
        fullPage: true,
      });
      const privateUrl = source("pppppppppppp", "private-download.zip");
      await manager.locator("#url-input").fill(privateUrl);
      await manager.locator("#confirm-add").click();
      await manager.locator('#hero-actions [data-action="start"]').waitFor();
      await manager.locator('[data-action="share"]').click();
      await manager.waitForFunction(
        () => document.activeElement?.id === "share-intro",
      );
      assert.ok(
        await manager.locator("#share-intro").evaluate((el) => el.readOnly),
      );
      // Exercise the browser UI without overwriting the person's system clipboard.
      await manager.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__queuecatCopiedIntroduction = text;
            },
          },
        }),
      );
      await manager.locator('[data-action="copy-intro"]').click();
      const copied = await manager.evaluate(
        () => window.__queuecatCopiedIntroduction,
      );
      assert.ok(copied.includes("本機測試版"));
      assert.ok(
        !copied.includes(privateUrl) &&
          !copied.includes("private-download.zip"),
      );
      assert.equal((await state()).running, false);
      await manager.locator("#toast").waitFor({ state: "hidden" });
      await manager.screenshot({
        path: path.join(out, "brand-share-desktop.png"),
        fullPage: true,
      });
      await manager.setViewportSize({ width: 620, height: 820 });
      await manager.locator("#theme").selectOption("dark");
      await manager.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      assert.equal(
        await manager.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
        false,
      );
      await manager.waitForTimeout(200); // Allow the authored 160ms theme transition to settle.
      const copyStyle = await manager
        .locator('[data-action="copy-intro"]')
        .evaluate((el) => ({
          color: getComputedStyle(el).color,
          background: getComputedStyle(el).backgroundColor,
          disabled: el.disabled,
        }));
      assert.equal(copyStyle.disabled, false);
      await manager.screenshot({
        path: path.join(out, "brand-share-narrow-dark.png"),
        fullPage: true,
      });
      await manager.close();
      return {
        clipboardApiSimulated: true,
        personalClipboardTouched: false,
        sourceUrlsIncluded: false,
        automaticallySent: false,
        copyStyle,
      };
    },
  );
  await reset();
  await check(
    "quick keys add and reorder with honest cat feedback and safe Escape",
    async () => {
      const manager = await context.newPage();
      await manager.goto(`${origin}/manager.html`);
      const input = manager.locator("#url-input");
      await input.waitFor({ state: "visible" });
      await input.fill("https://unsupported.invalid/not-a-katfile");
      await input.press("Control+Enter");
      assert.equal((await state()).items.length, 0);
      await input.fill(
        [
          source("qqqqqqqqqqqq", "first.zip"),
          source("rrrrrrrrrrrr", "second.zip"),
          source("ssssssssssss", "third.zip"),
        ].join("\n"),
      );
      await input.press("Control+Enter");
      const added = await eventually(async () => {
        const s = await state();
        assert.equal(s.items.length, 3);
        return s;
      }, "keyboard add");
      assert.equal(added.running, false);
      await manager.locator('#toast[data-tone="success"]').waitFor();
      assert.ok(
        (await manager.locator("#toast").innerText()).includes("貓貓收到了"),
      );
      const movedId = added.items[1].id;
      const selected = manager.locator(`[data-select="${movedId}"]`);
      await selected.focus();
      await selected.press("Alt+ArrowUp");
      await eventually(
        async () => assert.equal((await state()).items[0].id, movedId),
        "keyboard reorder",
      );
      await manager.waitForFunction(
        (id) =>
          document.activeElement?.getAttribute("data-select") === id &&
          document.querySelector("#toast")?.textContent.includes("第 1 位"),
        movedId,
      );
      await manager.screenshot({
        path: path.join(out, "playful-reorder-feedback.png"),
        fullPage: true,
      });
      await selected.evaluate((el) =>
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            altKey: true,
            repeat: true,
            bubbles: true,
          }),
        ),
      );
      assert.equal((await state()).items[0].id, movedId);
      await manager.locator('#hero-actions [data-action="add"]').click();
      await input.press("Escape");
      assert.equal(await manager.locator("#add-panel").isVisible(), false);
      assert.equal(
        await manager.evaluate(() =>
          document.activeElement?.getAttribute("data-action"),
        ),
        "add",
      );
      await manager.locator('.sidebar [data-action="settings"]').click();
      await manager.locator("#reduced-motion").check();
      await manager.waitForFunction(
        () => document.documentElement.dataset.reducedMotion === "true",
      );
      assert.equal(
        await manager
          .locator("#hero-actions button")
          .first()
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      await manager.locator("#theme").press("Escape");
      assert.equal(await manager.locator("#settings-panel").isVisible(), false);
      assert.equal(
        await manager.evaluate(() =>
          document.activeElement?.getAttribute("data-action"),
        ),
        "settings",
      );
      assert.equal((await state()).running, false);
      assert.equal(
        (await downloads()).filter((d) => d.state === "in_progress").length,
        0,
      );
      await manager.close();
      return {
        added: 3,
        reorderedTo: 1,
        downloadsStarted: 0,
        reducedMotion: true,
      };
    },
  );
  assert.deepEqual(report.pageErrors, []);
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.error = error.stack;
  if (control && !control.isClosed()) {
    report.failureState = await state().catch(() => undefined);
    report.failureTabs = await control
      .evaluate(() => chrome.tabs.query({}))
      .catch(() => []);
    report.fixturePages = await Promise.all(
      context
        .pages()
        .filter((p) => p.url().startsWith("https://katfile."))
        .map(async (p) => ({
          url: p.url(),
          body: await p
            .locator("body")
            .innerText()
            .catch(() => "unavailable"),
        })),
    );
    report.playwrightPages = context.pages().map((p) => p.url());
    const diagnostic = await bounded(
      context.newCDPSession(control),
      "attach failure diagnostic",
    );
    report.ownedTargets = (
      await diagnostic.send("Target.getTargets")
    ).targetInfos;
    await diagnostic.detach();
  }
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  if (context)
    await bounded(context.close(), "close owned isolated browser").catch(
      (error) => (report.cleanupError = error.message),
    );
  for (const stream of streams) stream.destroy();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  siteServer.closeAllConnections();
  await new Promise((resolve) => siteServer.close(resolve));
  const ownedProfile = path.resolve(profile);
  if (
    !ownedProfile.startsWith(path.resolve(out) + path.sep) ||
    path.basename(ownedProfile) !== "profile"
  )
    throw new Error("Refusing cleanup outside this owned test run");
  await fs.rm(ownedProfile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
  report.isolation.profileRemoved = true;
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(`REPORT ${path.relative(root, path.join(out, "report.json"))}`);
}
