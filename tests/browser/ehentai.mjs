import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BlobReader, BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-external.js";

// E-Hentai archive acceptance uses only this owned Chromium profile and an
// HTTPS loopback fixture. It never attaches to personal Chrome or contacts E-Hentai.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    "playwright-module": { type: "string" },
    "browser-cache": { type: "string" },
    extension: { type: "string", default: path.join(root, "artifacts", "unpacked") },
    openssl: { type: "string", default: "openssl" },
  },
});
if (values["browser-cache"]) process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(values["browser-cache"]);
const { chromium } = await import(values["playwright-module"] ? pathToFileURL(path.resolve(values["playwright-module"])).href : "playwright");

const works = [
  { gid: "640001", token: "a1b2c3d4e5", title: "E-Hentai Original ZIP Fixture" },
  { gid: "640002", token: "f6e7d8c9b0", title: "E-Hentai Next ZIP Fixture" },
];
const readerWork = { gid: "640003", token: "0123abc456", title: "E-Hentai Reader ZIP Fixture" };
const optInWork = { gid: "640006", token: "6789abcdef", title: "E-Hentai Existing Tab Fixture" };
const warningWork = { gid: "640004", token: "fedcba9876", title: "E-Hentai AIR Warning Fixture" };
const afterWarningWork = { gid: "640005", token: "56789abcde", title: "E-Hentai After Warning Fixture" };
const readerPages = [
  { hash: "abcdef1234", name: "ev01_01.png", mime: "image/webp", servedName: "ev01_01.webp", bytes: Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==", "base64") },
  { hash: "123456789a", name: "ev01_02.png", mime: "image/png", servedName: "ev01_02.png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64") },
];
const readerRetry = { nl: "12345-498456", host: "reader.hath.network", path: "/om/12345678/a-b/c-d/800/a-b-c/ev01_02.png" };
const wrong = { gid: "649999", token: "0123456789", title: works[0].title };
const out = path.join(root, "artifacts", "ehentai-browser", new Date().toISOString().replace(/[:.]/g, "-"));
const extension = path.join(out, "extension");
const profile = path.join(out, "profile");
const downloadsDir = path.join(out, "downloads");
const fixtureDir = path.join(out, "fixture");
const reportPath = path.join(out, "report.json");
const report = {
  startedAt: new Date().toISOString(), status: "running", checks: [], pageErrors: [],
  isolation: { profile, extension, downloadsDir, personalChromeAttached: false, personalDownloadsRead: false, network: "owned Chromium host mapping to loopback HTTPS fixture only" },
  limitations: ["popup.html is opened in an isolated extension tab, not through the native toolbar; only chrome.tabs.query(active, lastFocusedWindow) is shimmed to resolve the loopback tag fixture tab. The popup still performs real chrome.scripting.executeScript injection and all background/download/reconciliation behavior uses the built extension."],
  cleanup: {},
};
let context, server;
const fatalErrors = [];
function noteFatal(error) { fatalErrors.push(error instanceof Error ? error : new Error(String(error))); server?.closeAllConnections(); }
process.on("uncaughtException", noteFatal);
process.on("unhandledRejection", noteFatal);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    if (fatalErrors.length) throw fatalErrors[0];
    try { return await check(); } catch (error) { if (error?.fatalCheck) throw error; last = error; await sleep(200); }
  }
  throw new Error(`${label}: ${last?.message || "timed out"}`);
}
async function writeReport() { await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8"); }
async function record(name, fn) {
  const result = await fn();
  report.checks.push({ name, status: "pass", result });
  await writeReport();
  console.log(`PASS ${name}`);
  return result;
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function archiveUrl(work) { return `https://e-hentai.org/archiver.php?gid=${work.gid}&token=${work.token}`; }
function titleFor(work) { return `${work.title}.zip`; }
function gidForItem(item) {
  const match = /^https:\/\/e-hentai\.org\/g\/(\d+)\/[a-f0-9]{10}\/$/i.exec(item?.sourceUrl || "");
  assert.ok(match, `invalid E-Hentai source URL: ${item?.sourceUrl || "missing"}`);
  return match[1];
}

try {
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.mkdir(downloadsDir, { recursive: true });
  await fs.mkdir(path.join(profile, "Default"), { recursive: true });
  await fs.writeFile(path.join(profile, "Default", "Preferences"), JSON.stringify({ download: { default_directory: downloadsDir, prompt_for_download: false, directory_upgrade: true } }), "utf8");
  const extensionSource = path.resolve(values.extension);
  await fs.cp(extensionSource, extension, { recursive: true });
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("scripting"), "E-Hentai import uses scripting injection");
  assert.ok(manifest.host_permissions?.includes("https://e-hentai.org/*"), "E-Hentai import needs its exact site host grant");

  const keyFile = path.join(fixtureDir, "fixture-key.pem");
  const certFile = path.join(fixtureDir, "fixture-cert.pem");
  const opensslConfig = path.join(fixtureDir, "openssl.cnf");
  await fs.writeFile(opensslConfig, "[req]\ndistinguished_name=dn\n[dn]\n", "utf8");
  execFileSync(values.openssl, ["req", "-config", opensslConfig, "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=e-hentai.org", "-addext", "subjectAltName=DNS:e-hentai.org,DNS:test.reader.hath.network,DNS:reader.hath.network", "-keyout", keyFile, "-out", certFile], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

  const fixtures = new Map();
  for (const [index, work] of works.entries()) {
    const files = [
      { name: "01_ev0123.png", bytes: Buffer.concat([Buffer.from("PNG fixture 01\n"), randomBytes(1024 + index)]) },
      { name: "02_ev0456.jpg", bytes: Buffer.concat([Buffer.from("JPEG fixture 02\n"), randomBytes(777 + index)]) },
    ];
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    for (const file of files) await writer.add(file.name, new Uint8ArrayReader(file.bytes));
    const blob = await writer.close();
    const zip = Buffer.from(await blob.arrayBuffer());
    fixtures.set(work.gid, { work, files, zip, digest: sha256(zip) });
  }
  report.fixtureArchives = [...fixtures.values()].map(({ work, files, zip, digest }) => ({ gid: work.gid, token: work.token, zipBytes: zip.length, sha256: digest, entries: files.map((file) => file.name) }));
  const tls = { key: await fs.readFile(keyFile), cert: await fs.readFile(certFile) };
  const tagPath = "/tag/group:lump+of+sugar";
  const listing = `<!doctype html><meta charset="utf-8"><title>E-Hentai tag fixture</title><table class="itg"><tbody>${works.map((work) => `<tr><td><a class="glink" href="/g/${work.gid}/${work.token}/">${work.title}</a></td></tr>`).join("")}</tbody></table>`;
  const archiverHtml = (work) => `<!doctype html><meta charset="utf-8"><title>Archiver ${work.gid}</title><h1>${work.title}</h1><a id="original-zip" href="/archive/${work.gid}.zip"${work.gid === works[1].gid ? ' referrerpolicy="origin"' : ""}>Original ZIP</a>`;
  const requests = [];
  let holdFirstReaderImage;
  const readerGalleryHtml = `<!doctype html><meta charset="utf-8"><div id="gn">${readerWork.title}</div><table id="gdd"><tr><td>Length:</td><td>2 pages</td></tr></table><p class="gpc">Showing 1 - 2 of 2 images</p><div id="gdt">${readerPages.map((page, index) => `<div class="gdtm"><a href="/s/${page.hash}/${readerWork.gid}-${index + 1}"><div title="Page ${index + 1}: ${page.name}"></div></a></div>`).join("")}</div>`;
  const optInGalleryHtml = `<!doctype html><meta charset="utf-8"><div id="gn">${optInWork.title}</div><table id="gdd"><tr><td>Length:</td><td>2 pages</td></tr></table><p class="gpc">Showing 1 - 2 of 2 images</p><div id="gdt">${readerPages.map((page, index) => `<div class="gdtm"><a href="/s/${page.hash}/${optInWork.gid}-${index + 1}"><div title="Page ${index + 1}: ${page.name}"></div></a></div>`).join("")}</div>`;
  const warningGalleryHtml = `<!doctype html><meta charset="utf-8"><h1>Content Warning</h1><p>This gallery has been flagged as <strong>Offensive For Everyone</strong> by E-Hentai. Please confirm you wish to view it.</p><a href="/g/${warningWork.gid}/${warningWork.token}/?nw=session">View Gallery</a>`;
  const readerPageHtml = (page, index, reloaded = false) => `<!doctype html><meta charset="utf-8"><div id="i1"><div id="i2">${index + 1} / 2 ${page.name} :: 1280 x 1447 :: 136.2 KiB</div><img id="img" src="https://${reloaded ? readerRetry.host : "test.reader.hath.network"}/${reloaded ? readerRetry.path.slice(1) : `h/${page.hash}/reader/${page.servedName}`}">${index === 1 ? `<a id="loadfail" href="#" onclick="return nl('${readerRetry.nl}')">Load failed? Click here to reload this page</a>` : ""}</div>`;
  server = https.createServer(tls, (req, res) => {
    void (async () => {
      const host = req.headers.host?.split(":")[0]?.toLowerCase();
      const url = new URL(req.url || "/", `https://${host || "e-hentai.org"}`);
      if (!(["e-hentai.org", "test.reader.hath.network", "reader.hath.network"].includes(host)) || req.method !== "GET") return res.writeHead(404).end("fixture not found");
      if (host === "test.reader.hath.network") {
        const page = readerPages.find((entry) => url.pathname === `/h/${entry.hash}/reader/${entry.servedName}`);
        if (!page) return res.writeHead(404).end("fixture not found");
        const status = page === readerPages[1] ? 503 : 200;
        requests.push({ host, path: url.pathname, status, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, at: new Date().toISOString() });
        if (page === readerPages[0] && holdFirstReaderImage) {
          const hold = holdFirstReaderImage;
          holdFirstReaderImage = undefined;
          await hold;
        }
        const body = status === 503 ? Buffer.from("fixture H@H unavailable") : page.bytes;
        return res.writeHead(status, { "Content-Type": status === 503 ? "text/plain" : page.mime, "Content-Length": body.length, "Cache-Control": "no-store" }).end(body);
      }
      if (host === "reader.hath.network") {
        if (url.pathname !== readerRetry.path) return res.writeHead(404).end("unknown alternate H@H path");
        requests.push({ host, path: url.pathname, status: 200, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, at: new Date().toISOString() });
        return res.writeHead(200, { "Content-Type": readerPages[1].mime, "Content-Length": readerPages[1].bytes.length, "Cache-Control": "no-store" }).end(readerPages[1].bytes);
      }
      if (url.pathname === tagPath) return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(listing);
      if (url.pathname === `/g/${optInWork.gid}/${optInWork.token}/`) {
        const cookie = req.headers.cookie || null;
        const status = cookie?.split(/;\s*/).includes("qcTestView=1") ? 200 : 404;
        requests.push({ host, path: url.pathname, search: url.search, gid: optInWork.gid, status, cookie, mode: req.headers["sec-fetch-mode"] || null, authorization: req.headers.authorization || null, at: new Date().toISOString() });
        return res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(status === 200 ? optInGalleryHtml : "gallery unavailable to guest");
      }
      if (url.pathname === `/g/${readerWork.gid}/${readerWork.token}/`) {
        requests.push({ host, path: url.pathname, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, at: new Date().toISOString() });
        return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(readerGalleryHtml);
      }
      if (url.pathname === `/g/${warningWork.gid}/${warningWork.token}/`) {
        requests.push({ host, path: url.pathname, search: url.search, gid: warningWork.gid, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, at: new Date().toISOString() });
        return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(warningGalleryHtml);
      }
      const readerMatch = /^\/s\/([a-f0-9]{10})\/(\d+)-(\d+)$/.exec(url.pathname);
      if (readerMatch && [readerWork.gid, optInWork.gid].includes(readerMatch[2])) {
        const index = Number(readerMatch[3]) - 1;
        const page = readerPages[index];
        if (!page || page.hash !== readerMatch[1]) return res.writeHead(404).end("unknown reader page");
        const optIn = readerMatch[2] === optInWork.gid;
        const cookie = req.headers.cookie || null;
        const status = !optIn || cookie?.split(/;\s*/).includes("qcTestView=1") ? 200 : 404;
        const reloaded = index === 1 && url.searchParams.get("nl") === readerRetry.nl;
        requests.push({ host, path: url.pathname, search: url.search, gid: readerMatch[2], page: index + 1, reloaded, status, cookie, authorization: req.headers.authorization || null, at: new Date().toISOString() });
        return res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(status === 200 ? readerPageHtml(page, index, reloaded) : "page unavailable to guest");
      }
      if (url.pathname === "/archiver.php") {
        requests.push({ host, path: url.pathname, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, at: new Date().toISOString() });
        const work = [...works, wrong, afterWarningWork].find((entry) => entry.gid === url.searchParams.get("gid") && entry.token === url.searchParams.get("token"));
        if (!work) return res.writeHead(404).end("unknown archive token");
        return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(archiverHtml(work));
      }
      if (url.pathname.startsWith("/fullimg.php")) requests.push({ host, path: url.pathname, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, at: new Date().toISOString() });
      const match = /^\/archive\/(\d+)\.zip$/.exec(url.pathname);
      if (readerMatch?.[2] === warningWork.gid || match?.[1] === warningWork.gid) {
        requests.push({ host, path: url.pathname, gid: warningWork.gid, search: url.search });
      }
      const fixture = match && (fixtures.get(match[1]) || (match[1] === wrong.gid ? fixtures.get(works[0].gid) : undefined));
      if (fixture) {
        const request = { gid: match[1], referer: req.headers.referer || null, at: new Date().toISOString() };
        requests.push(request);
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": fixture.zip.length, "Content-Disposition": `attachment; filename="${titleFor(fixture.work)}"`, "Cache-Control": "no-store" });
        return res.end(fixture.zip);
      }
      res.writeHead(404, { "Cache-Control": "no-store" }).end("fixture not found");
    })().catch((error) => { noteFatal(error); if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // The production URLs intentionally omit a port, so the fixture owns loopback 443.
    server.listen(443, "127.0.0.1", resolve);
  });

  console.log("Launching owned isolated Chromium profile...");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: false, acceptDownloads: true, downloadsPath: downloadsDir,
    locale: "zh-TW", viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * 127.0.0.1", "--no-proxy-server", "--disable-background-networking", "--ignore-certificate-errors", "--window-position=-32000,-32000"],
  });
  context.on("page", (page) => page.on("pageerror", (error) => report.pageErrors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 20_000 });
  const extensionOrigin = worker.url().split("/").slice(0, 3).join("/");
  report.extensionId = await worker.evaluate(() => chrome.runtime.id);
  report.browserVersion = context.browser()?.version();
  const manager = await context.newPage();
  await manager.goto(`${extensionOrigin}/manager.html`);
  const cdp = await context.newCDPSession(manager);
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsDir, eventsEnabled: true });
  await cdp.detach();
  const state = async () => {
    const reply = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "QC_GET" }));
    assert.equal(reply?.ok, true, `QC_GET failed: ${reply?.error || "unknown"}`);
    return reply.state;
  };
  const command = async (value) => manager.evaluate((command) => chrome.runtime.sendMessage({ type: "QC_COMMAND", command }), value);

  const listingPage = await context.newPage();
  await listingPage.goto(`https://e-hentai.org${tagPath}`);
  await record("loopback tag page exposes the contract .itg .glink gallery anchors", async () => {
    const anchors = await listingPage.locator(".itg a.glink").evaluateAll((nodes) => nodes.map((node) => ({ href: node.getAttribute("href"), title: node.textContent.trim() })));
    assert.deepEqual(anchors, works.map((work) => ({ href: `/g/${work.gid}/${work.token}/`, title: work.title })));
    return { tagUrl: `https://e-hentai.org${tagPath}`, anchors };
  });

  const listingTabId = await manager.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://e-hentai.org/tag/*" });
    return tab?.id;
  });
  assert.ok(Number.isInteger(listingTabId), "fixture tag tab is not visible to the isolated extension");
  const popup = await context.newPage();
  await popup.addInitScript(({ tabId, tabUrl }) => {
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    Object.defineProperty(chrome.tabs, "query", {
      configurable: true,
      writable: true,
      value: (query, callback) => {
        if (query?.active && query?.lastFocusedWindow) {
          const tabs = [{ id: tabId, url: tabUrl }];
          if (typeof callback === "function") {
            queueMicrotask(() => callback(tabs));
            return;
          }
          return Promise.resolve(tabs);
        }
        return originalQuery(query, callback);
      },
    });
  }, { tabId: listingTabId, tabUrl: `https://e-hentai.org${tagPath}` });
  await popup.goto(`${extensionOrigin}/popup.html`);
  await popup.locator('[data-action="import-ehentai"]').waitFor({ state: "visible" });
  await record("popup reads the active tag page and adds selected works through QC_COMMAND add", async () => {
    await popup.locator('[data-action="import-ehentai"]').click();
    await popup.locator("#ehentai-import-panel").waitFor({ state: "visible" });
    await popup.locator('input[name="ehentai-import-mode"][value="archive"]').check();
    const choices = popup.locator('#ehentai-import-list input[name="ehentai-work"]');
    await eventually(async () => { assert.equal(await choices.count(), works.length); return true; }, "extract .glink works from active tab");
    const titles = await popup.locator("#ehentai-import-list label").allTextContents();
    assert.equal(titles.length, works.length);
    for (const [index, work] of works.entries()) assert.ok(titles[index].includes(work.title), `missing .glink title for gid ${work.gid}`);
    for (const checkbox of await choices.all()) {
      await checkbox.uncheck();
      await checkbox.check();
    }
    assert.equal(await popup.locator('#ehentai-import-list input[name="ehentai-work"]:checked').count(), works.length);
    await popup.locator("#ehentai-import-confirm").click();
    const current = await eventually(async () => {
      const value = await state();
      assert.equal(value.items.length, works.length);
      return value;
    }, "E-Hentai works added to queue");
    assert.deepEqual(current.items.map((item) => item.sourceUrl), works.map((work) => `https://e-hentai.org/g/${work.gid}/${work.token}/`));
    assert.ok(current.items.every((item) => !item.gallery), "E-Hentai queue entries should use the dedicated ehArchive workflow");
    assert.ok(current.items.every((item) => item.ehArchive), "E-Hentai queue entries should carry ehArchive state");
    assert.deepEqual(current.items.map(gidForItem), works.map((work) => work.gid));
    assert.deepEqual(current.items.map((item) => item.title), works.map((work) => work.title), "E-Hentai .glink titles should be preserved in queue items");
    return { selectedTitles: titles, explicitlySelected: works.length, items: current.items.map((item) => ({ id: item.id, sourceUrl: item.sourceUrl, gid: gidForItem(item), title: item.title })) };
  });

  const added = await state();
  const itemIds = added.items.map((item) => item.id);
  assert.equal(added.running, false);
  await command({ kind: "start" });
  const firstArchive = await eventually(async () => {
    const current = await state();
    const item = current.items.find((entry) => entry.id === itemIds[0]);
    assert.ok(item);
    assert.equal(item.status, "verification");
    assert.equal(current.activeId, itemIds[0]);
    assert.ok(item.ehArchive?.openedAt);
    const page = context.pages().find((entry) => entry.url() === archiveUrl(works[0]));
    if (!page) throw new Error("first archiver page has not opened");
    return { item, page };
  }, "first E-Hentai archiver page", 60_000);
  await record("start opens the official URL for the active gid and token and waits for a user download", async () => {
    assert.equal(firstArchive.page.url(), archiveUrl(works[0]));
    assert.equal(await firstArchive.page.locator("#original-zip").innerText(), "Original ZIP");
    assert.equal((await state()).items[0].downloadId, undefined);
    return { url: firstArchive.page.url(), status: firstArchive.item.status, openedAt: firstArchive.item.ehArchive.openedAt, downloadStartedAutomatically: false };
  });

  // Same filename, wrong gid/token and wrong referrer: it must not satisfy the
  // active item. This page is fixture-only and never part of the queue.
  const mismatchPage = await context.newPage();
  await mismatchPage.goto(archiveUrl(wrong));
  await mismatchPage.locator("#original-zip").click();
  const wrongDownload = await eventually(async () => {
    const downloads = await manager.evaluate(() => chrome.downloads.search({}));
    const candidate = downloads.find((entry) => entry.filename?.endsWith(titleFor(works[0])));
    if (!candidate) throw new Error("wrong-token fixture download is not visible yet");
    assert.equal(candidate.state, "complete");
    return candidate;
  }, "wrong-token same-name ZIP download");
  await record("same-name ZIP from a different archiver gid and token is not adopted", async () => {
    const current = await state();
    assert.equal(current.activeId, itemIds[0]);
    assert.equal(current.items[0].status, "verification");
    assert.equal(current.items[0].downloadId, undefined);
    return { chromeDownloadId: wrongDownload.id, filename: path.basename(wrongDownload.filename), queueDownloadId: current.items[0].downloadId, request: requests.at(-1) };
  });

  await firstArchive.page.bringToFront();
  await firstArchive.page.locator("#original-zip").click();
  const firstComplete = await eventually(async () => {
    const current = await state();
    const item = current.items.find((entry) => entry.id === itemIds[0]);
    assert.equal(item.status, "complete");
    assert.ok(Number.isInteger(item.downloadId));
    return { current, item };
  }, "matching Original ZIP completes first queue item", 90_000);
  await record("correct Original ZIP is adopted by its gid and token, with exact ZIP bytes and entry names", async () => {
    const download = await manager.evaluate((id) => chrome.downloads.search({ id }).then((rows) => rows[0]), firstComplete.item.downloadId);
    assert.ok(download, "queue downloadId is absent from Chrome downloads");
    assert.equal(download.state, "complete");
    assert.ok(Date.parse(download.startTime) >= firstComplete.item.ehArchive.openedAt);
    assert.ok(path.resolve(download.filename).startsWith(path.resolve(downloadsDir) + path.sep));
    const expected = fixtures.get(works[0].gid);
    const matchingRequest = requests.find((request) => request.gid === works[0].gid);
    assert.ok(matchingRequest, "correct gid ZIP did not reach the loopback fixture");
    assert.equal(matchingRequest.referer, archiveUrl(works[0]));
    const actualBytes = await fs.readFile(download.filename);
    assert.equal(sha256(actualBytes), expected.digest);
    const blob = new Blob([actualBytes.buffer.slice(actualBytes.byteOffset, actualBytes.byteOffset + actualBytes.byteLength)]);
    const reader = new ZipReader(new BlobReader(blob), { checkSignature: true, checkCrc32: true });
    let entries;
    try {
      entries = await reader.getEntries();
      assert.deepEqual(entries.map((entry) => entry.filename), expected.files.map((file) => file.name));
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        assert.ok("getData" in entry);
        const data = Buffer.from(await (await entry.getData(new BlobWriter())).arrayBuffer());
        assert.deepEqual(data, expected.files[index].bytes);
      }
    } finally { await reader.close(); }
    return { downloadId: download.id, startTime: download.startTime, openedAt: firstComplete.item.ehArchive.openedAt, filename: path.basename(download.filename), bytes: actualBytes.length, zipSha256: sha256(actualBytes), entries: entries.map((entry) => entry.filename), byteEquality: true };
  });

  const secondArchive = await eventually(async () => {
    const current = await state();
    assert.equal(current.activeId, itemIds[1]);
    const item = current.items.find((entry) => entry.id === itemIds[1]);
    assert.equal(item.status, "verification");
    assert.ok(item.ehArchive?.openedAt);
    const page = context.pages().find((entry) => entry.url() === archiveUrl(works[1]));
    if (!page) throw new Error("next archiver page has not opened");
    return { item, page };
  }, "next E-Hentai queue item after first download", 60_000);
  await record("queue advances in order and opens the next gid/token only after the first ZIP completes", async () => {
    assert.equal(firstComplete.item.status, "complete");
    assert.equal(secondArchive.page.url(), archiveUrl(works[1]));
    assert.equal(gidForItem(secondArchive.item), works[1].gid);
    return { completedFirst: gidForItem(firstComplete.item), activeNext: gidForItem(secondArchive.item), nextUrl: secondArchive.page.url(), secondDownloadStarted: false };
  });
  await secondArchive.page.locator("#original-zip").click();
  const secondUnmatched = await eventually(async () => {
    const current = await state();
    const item = current.items.find((entry) => entry.id === itemIds[1]);
    assert.equal(current.activeId, itemIds[1]);
    assert.ok(["verification", "blocked"].includes(item.status));
    assert.equal(item.downloadId, undefined);
    const downloads = await manager.evaluate(() => chrome.downloads.search({}));
    const candidate = downloads.find((entry) => entry.filename?.endsWith(titleFor(works[1])));
    assert.ok(candidate, "second Original ZIP is absent from Chrome downloads");
    assert.equal(candidate.state, "complete");
    return { item, candidate };
  }, "origin-only referrer ZIP remains unmatched until user confirmation", 90_000);
  await record("origin-only referrer is not adopted automatically and waits for explicit reconciliation", async () => {
    const request = requests.find((entry) => entry.gid === works[1].gid);
    assert.ok(request, "second gid ZIP did not reach the fixture");
    assert.equal(request.referer, "https://e-hentai.org/");
    assert.equal(secondUnmatched.item.downloadId, undefined);
    assert.equal(secondUnmatched.item.status, "verification");
    return { referrer: request.referer, chromeDownloadId: secondUnmatched.candidate.id, queueDownloadId: secondUnmatched.item.downloadId, status: secondUnmatched.item.status };
  });

  await manager.locator('#current [data-action="reconcile"]').click();
  await manager.locator("#reconcile-panel").waitFor({ state: "visible" });
  await manager.locator('#reconcile-panel [data-action="find-downloads"]').click();
  const adopted = await record("manager lists the origin-only ZIP and explicitly adopts the selected Chrome download", async () => {
    const candidateId = secondUnmatched.candidate.id;
    const choice = manager.locator(`#reconcile-panel [data-action="adopt-download"][data-download="${candidateId}"]`);
    await eventually(async () => { assert.equal(await choice.count(), 1); return true; }, "manual candidate appears in reconciliation panel");
    const eligible = await manager.evaluate((id) => chrome.downloads.search({ id }).then((rows) => rows[0]), candidateId);
    assert.ok(eligible);
    assert.equal(path.basename(eligible.filename), titleFor(works[1]));
    assert.ok(Date.parse(eligible.startTime) >= secondUnmatched.item.ehArchive.openedAt);
    assert.equal(eligible.state, "complete");
    await choice.click();
    const linked = await eventually(async () => {
      const current = await state();
      const item = current.items.find((entry) => entry.id === itemIds[1]);
      assert.equal(item.downloadId, candidateId);
      return { current, item };
    }, "explicitly adopted download is linked to second queue item");
    return { selectedDownloadId: candidateId, startedAt: eligible.startTime, openedAt: linked.item.ehArchive.openedAt, statusAfterAdoption: linked.item.status, explicitConfirmation: true };
  });

  const finalState = await eventually(async () => {
    const current = await state();
    assert.deepEqual(current.items.map((item) => item.status), ["complete", "complete"]);
    return current;
  }, "manually adopted second Original ZIP completes queue", 90_000);
  const secondDownloadId = finalState.items[1].downloadId;
  const secondDownload = await manager.evaluate((id) => chrome.downloads.search({ id }).then((rows) => rows[0]), secondDownloadId);
  assert.ok(secondDownload);
  assert.equal(sha256(await fs.readFile(secondDownload.filename)), fixtures.get(works[1].gid).digest);
  assert.equal(adopted.selectedDownloadId, secondDownloadId);

  const readerGalleryUrl = `https://e-hentai.org/g/${readerWork.gid}/${readerWork.token}/`;
  const readerRequestOffset = requests.length;
  await manager.locator('[data-action="add"]:visible').first().click();
  const urlInput = manager.locator("#url-input");
  const modeReader = manager.locator('input[name="ehentai-add-mode-choice"][value="reader"]');
  const modeArchive = manager.locator('input[name="ehentai-add-mode-choice"][value="archive"]');
  const confirmAdd = manager.locator("#confirm-add");
  await urlInput.fill(`https://e-hentai.org/g/${works[0].gid}/${works[0].token}/`);
  assert.equal(await modeReader.isChecked(), true, "new E-Hentai batches default to reader");
  assert.equal(await confirmAdd.isEnabled(), true, "a different mode is not a duplicate");
  await modeArchive.check();
  assert.equal(await confirmAdd.isEnabled(), false, "a duplicate in the same mode is disabled");
  await modeReader.check();
  await urlInput.fill(readerGalleryUrl);
  await confirmAdd.click();
  const readerItem = await eventually(async () => {
    const current = await state();
    const item = current.items.find((entry) => entry.sourceUrl === readerGalleryUrl);
    assert.ok(item, "reader-mode E-Hentai item was not queued");
    assert.ok(item.gallery, "reader mode should use the normal gallery ZIP workflow");
    assert.equal(item.ehArchive, undefined, "reader mode must not enter the official archiver workflow");
    return item;
  }, "reader-mode E-Hentai gallery queued");
  await record("manager defaults to reader ZIP and detects duplicates per mode", async () => ({ sourceUrl: readerItem.sourceUrl, galleryId: readerItem.gallery.id, ehArchive: false }));
  await command({ kind: "start" });
  const packedReaderItem = await eventually(async () => {
    const current = await state();
    const item = current.items.find((entry) => entry.id === readerItem.id);
    assert.ok(item);
    if (item.status !== "complete") {
      if (["failed", "blocked"].includes(item.status)) {
        report.readerRequests = requests.slice(readerRequestOffset);
        throw Object.assign(new Error(`reader gallery ended ${item.status}: ${item.reason || ""}`), { fatalCheck: true });
      }
      throw new Error(`reader gallery is ${item.status} (${item.gallery.completed}/${item.gallery.total || "?"})`);
    }
    return item;
  }, "reader gallery packed and Chrome download completed", 120_000);
  await record("Chrome downloaded the reader-built ZIP with MIME-derived extensions and original basenames", async () => {
    const downloadId = packedReaderItem.gallery.lastDownloadId;
    assert.ok(Number.isInteger(downloadId), "reader ZIP has no completed Chrome download ID");
    assert.equal(packedReaderItem.title, readerWork.title);
    assert.equal(packedReaderItem.gallery.completed, readerPages.length);
    assert.equal(packedReaderItem.gallery.archive?.staged, readerPages.length);
    const download = await manager.evaluate((id) => chrome.downloads.search({ id }).then((rows) => rows[0]), downloadId);
    assert.ok(download, "reader ZIP is absent from Chrome downloads");
    assert.equal(download.state, "complete");
    assert.ok(path.resolve(download.filename).startsWith(path.resolve(downloadsDir) + path.sep));
    assert.equal(path.relative(downloadsDir, download.filename).split(path.sep).join("/"), `QueueCat/E-Hentai-${readerWork.gid}-${readerWork.title}.zip`);
    const actualBytes = await fs.readFile(download.filename);
    const zipReader = new ZipReader(new BlobReader(new Blob([actualBytes.buffer.slice(actualBytes.byteOffset, actualBytes.byteOffset + actualBytes.byteLength)])), { checkSignature: true, checkCrc32: true });
    let entries;
    try {
      entries = await zipReader.getEntries();
      assert.deepEqual(entries.map((entry) => entry.filename), readerPages.map((page) => page.servedName));
      for (let index = 0; index < entries.length; index++) {
        assert.ok("getData" in entries[index]);
        const data = Buffer.from(await (await entries[index].getData(new BlobWriter())).arrayBuffer());
        assert.deepEqual(data, readerPages[index].bytes, `wrong reader image bytes for ${readerPages[index].servedName}`);
      }
    } finally { await zipReader.close(); }
    const readerRequests = requests.slice(readerRequestOffset);
    assert.ok(readerRequests.some((request) => request.path === `/g/${readerWork.gid}/${readerWork.token}/`), "reader gallery metadata was not requested");
    assert.ok(readerRequests.some((request) => request.path === `/s/${readerPages[0].hash}/${readerWork.gid}-1`), "first reader page was not requested");
    assert.ok(readerRequests.some((request) => request.path === `/s/${readerPages[1].hash}/${readerWork.gid}-2`), "second reader page was not requested");
    const secondPageRequests = readerRequests.filter((request) => request.path === `/s/${readerPages[1].hash}/${readerWork.gid}-2`);
    assert.equal(secondPageRequests.length, 2, "page 2 should be parsed once initially and once with nl");
    assert.deepEqual(secondPageRequests.map((request) => ({ search: request.search, page: request.page, reloaded: request.reloaded })), [
      { search: "", page: 2, reloaded: false },
      { search: `?nl=${readerRetry.nl}`, page: 2, reloaded: true },
    ]);
    const initialSecondImageRequests = readerRequests.filter((request) => request.host === "test.reader.hath.network" && request.path === `/h/${readerPages[1].hash}/reader/${readerPages[1].servedName}`);
    assert.equal(initialSecondImageRequests.length, 1, "the initial page 2 H@H URL must fail once without retrying");
    assert.equal(initialSecondImageRequests[0].status, 503);
    const firstImageRequests = readerRequests.filter((request) => request.host === "test.reader.hath.network" && request.path === `/h/${readerPages[0].hash}/reader/${readerPages[0].servedName}`);
    assert.equal(firstImageRequests.length, 1, "page 1 should be fetched once");
    assert.equal(firstImageRequests[0].status, 200);
    const alternateImageRequests = readerRequests.filter((request) => request.host === readerRetry.host && request.path === readerRetry.path);
    assert.equal(alternateImageRequests.length, 1, "reloaded page 2 should fetch its alternate H@H URL once");
    assert.equal(alternateImageRequests[0].status, 200);
    assert.notEqual(initialSecondImageRequests[0].host + initialSecondImageRequests[0].path, alternateImageRequests[0].host + alternateImageRequests[0].path, "nl reload must provide a different image URL");
    assert.equal(readerRequests.filter((request) => request.host === "test.reader.hath.network" || request.host === readerRetry.host).length, 3, "reader H@H requests should be page 1, failing page 2, then alternate page 2");
    assert.ok(readerRequests.every((request) => request.cookie === null && request.authorization === null), "reader fetches must omit request credentials");
    assert.ok(!readerRequests.some((request) => request.path === "/archiver.php" || request.path?.startsWith("/fullimg.php")), "reader workflow unexpectedly touched archiver/fullimg");
    return { downloadId: download.id, filename: path.basename(download.filename), bytes: actualBytes.length, entries: entries.map((entry) => entry.filename), credentialHeadersAbsent: true, officialArchiveTouched: false };
  });

  const addQueueItem = async (url, mode) => {
    await manager.locator('[data-action="add"]:visible').first().click();
    const input = manager.locator("#url-input");
    const modeChoice = manager.locator(`input[name="ehentai-add-mode-choice"][value="${mode}"]`);
    await input.fill(url);
    await modeChoice.check();
    assert.equal(await manager.locator("#confirm-add").isEnabled(), true, `manager should allow re-adding ${url}`);
    await manager.locator("#confirm-add").click();
  };
  const optInUrl = `https://e-hentai.org/g/${optInWork.gid}/${optInWork.token}/`;
  const optInRequestOffset = requests.length;
  await command({ kind: "add", urls: [optInUrl], ehentaiMode: "reader" });
  const optInItem = await eventually(async () => {
    const current = await state();
    const item = current.items.find((entry) => entry.sourceUrl === optInUrl);
    assert.ok(item, "opt-in reader item was not queued");
    assert.ok(item.gallery);
    return item;
  }, "opt-in reader item queued");
  const originalOptInItemId = optInItem.id;
  await command({ kind: "start" });
  const anonymousFailure = await eventually(async () => {
    const current = await state();
    const item = current.items.find((entry) => entry.sourceUrl === optInUrl);
    assert.ok(item);
    if (item.status !== "failed") throw new Error(`anonymous request is ${item.status}`);
    return item;
  }, "anonymous E-Hentai reader request is refused");
  assert.equal(anonymousFailure.reason, "gallery_unavailable");
  const anonymousGalleryRequests = requests.slice(optInRequestOffset).filter((request) => request.gid === optInWork.gid);
  assert.deepEqual(anonymousGalleryRequests.map(({ status, cookie }) => [status, cookie]), [[404, null]]);

  await context.addCookies([{
    name: "qcTestView",
    value: "1",
    url: "https://e-hentai.org/",
    secure: true,
    sameSite: "Lax",
  }]);
  const consentTab = await context.newPage();
  await consentTab.goto(optInUrl);
  await consentTab.locator("#gdt a").first().waitFor({ state: "attached" });
  assert.equal(await consentTab.locator("#gn").innerText(), optInWork.title);
  await addQueueItem(optInUrl, "reader");
  const requeuedOptInItem = await eventually(async () => {
    const current = await state();
    const sameItem = current.items.find((entry) => entry.id === originalOptInItemId);
    assert.ok(sameItem);
    assert.equal(sameItem.status, "queued");
    assert.equal(sameItem.gallery?.allowReaderTab, true);
    return sameItem;
  }, "manager re-paste requeues the original failed item with browser fallback");
  assert.equal(requeuedOptInItem.id, originalOptInItemId);
  const reopenedOptInTab = consentTab;
  await command({ kind: "start" });
  const optedInReader = await eventually(async () => {
    const current = await state();
    const sameItem = current.items.find((entry) => entry.id === originalOptInItemId);
    assert.ok(sameItem);
    if (sameItem.status !== "complete") {
      if (["failed", "blocked"].includes(sameItem.status))
        throw Object.assign(new Error(`opt-in reader ended ${sameItem.status}: ${sameItem.reason || ""}`), { fatalCheck: true });
      throw new Error(`opt-in reader is ${sameItem.status} (${sameItem.gallery?.completed || 0}/${sameItem.gallery?.total || "?"})`);
    }
    return sameItem;
  }, "manager re-paste reuses the opted-in E-Hentai tab and completes ZIP", 120_000);
  await record("manager re-pasting a failed E-Hentai URL requeues the same item using its open tab", async () => {
    assert.equal(reopenedOptInTab.url(), optInUrl);
    assert.equal(optedInReader.id, originalOptInItemId, "opt-in should reuse the original failed queue item");
    assert.equal((await state()).items.filter((entry) => entry.sourceUrl === optInUrl).length, 1, "opt-in must not create a duplicate queue item");
    assert.equal(optedInReader.title, optInWork.title);
    assert.equal(optedInReader.gallery?.completed, readerPages.length);
    assert.equal(optedInReader.gallery?.archive?.staged, readerPages.length);
    const downloadId = optedInReader.gallery?.lastDownloadId;
    assert.ok(Number.isInteger(downloadId), "opt-in reader ZIP has no completed Chrome download ID");
    const download = await manager.evaluate((id) => chrome.downloads.search({ id }).then((rows) => rows[0]), downloadId);
    assert.ok(download);
    assert.equal(download.state, "complete");
    const actualBytes = await fs.readFile(download.filename);
    const zipReader = new ZipReader(new BlobReader(new Blob([actualBytes.buffer.slice(actualBytes.byteOffset, actualBytes.byteOffset + actualBytes.byteLength)])), { checkSignature: true, checkCrc32: true });
    try {
      const entries = await zipReader.getEntries();
      assert.deepEqual(entries.map((entry) => entry.filename), readerPages.map((page) => page.servedName));
      for (let index = 0; index < entries.length; index++) {
        const data = Buffer.from(await (await entries[index].getData(new BlobWriter())).arrayBuffer());
        assert.deepEqual(data, readerPages[index].bytes, `wrong opt-in reader bytes for ${readerPages[index].servedName}`);
      }
    } finally { await zipReader.close(); }

    const optInRequests = requests.slice(optInRequestOffset);
    const galleryMetadataRequests = optInRequests.filter((request) => request.path === new URL(optInUrl).pathname);
    assert.deepEqual([galleryMetadataRequests[0]?.status, galleryMetadataRequests[0]?.cookie], [404, null]);
    assert.ok(galleryMetadataRequests.length >= 2, "the consented E-Hentai gallery tab did not request the original gallery URL");
    assert.ok(galleryMetadataRequests.slice(1).every((request) => request.status === 200 && request.cookie === "qcTestView=1"), "post-consent gallery requests must use the opted-in tab cookie");
    assert.ok(galleryMetadataRequests.slice(1).every((request) => request.mode === "navigate"),
      "the reader should reuse an already displayed gallery index");
    const pageMetadataRequests = optInRequests.filter((request) => request.path?.startsWith("/s/"));
    assert.ok(pageMetadataRequests.length >= readerPages.length, "reader page metadata was not loaded from the opted-in tab");
    assert.ok(pageMetadataRequests.every((request) => request.gid === optInWork.gid && request.status === 200 && request.cookie === "qcTestView=1"), "same-origin reader page metadata must use the opted-in tab cookie");
    const mediaRequests = optInRequests.filter((request) => request.host === "test.reader.hath.network" || request.host === readerRetry.host);
    assert.equal(mediaRequests.length, 3, "reader media requests should include page 1, its recoverable page 2 failure, and page 2 retry");
    assert.ok(mediaRequests.every((request) => request.cookie === null), "H@H media requests must omit the E-Hentai tab cookie");
    return {
      itemId: optedInReader.id,
      status: optedInReader.status,
      sourceUrl: optedInReader.sourceUrl,
      downloadId: download.id,
      zipBytes: actualBytes.length,
      entries: readerPages.map((page) => page.servedName),
      anonymousThenOptedInGalleryCookies: galleryMetadataRequests.map((request) => request.cookie),
      pageMetadataRequestCount: pageMetadataRequests.length,
      mediaCredentialsOmitted: true,
      consentedTabReused: true,
    };
  });

  await command({ kind: "clear-complete" });
  assert.equal((await state()).items.some((entry) => entry.sourceUrl === optInUrl), false);
  const pastedFallbackRequestOffset = requests.length;
  await addQueueItem(optInUrl, "reader");
  const pastedFallbackItem = await eventually(async () => {
    const current = await state();
    const item = current.items.find((entry) => entry.sourceUrl === optInUrl);
    assert.ok(item, "manager-pasted E-Hentai reader item was not queued");
    assert.equal(item.gallery?.allowReaderTab, true, "manager paste should enable same-gallery tab fallback");
    return item;
  }, "manager paste enables reader tab fallback");
  let releaseFirstImage;
  holdFirstReaderImage = new Promise((resolve) => { releaseFirstImage = resolve; });
  try {
    await command({ kind: "start" });
    await eventually(async () => {
      assert.ok(requests.slice(pastedFallbackRequestOffset).some(
        (request) => request.host === "test.reader.hath.network" && request.status === 200,
      ));
    }, "wait for the first image before closing the bound tab", 15_000);
    await reopenedOptInTab.close();
  } finally {
    holdFirstReaderImage = undefined;
    releaseFirstImage();
  }
  const pastedFallbackComplete = await eventually(async () => {
    const current = await state();
    const item = current.items.find((entry) => entry.id === pastedFallbackItem.id);
    assert.ok(item);
    if (item.status !== "complete") {
      if (["failed", "blocked"].includes(item.status))
        throw Object.assign(new Error(`pasted reader fallback ended ${item.status}: ${item.reason || ""}`), { fatalCheck: true });
      throw new Error(`pasted reader fallback is ${item.status}`);
    }
    return item;
  }, "manager-pasted reader falls back to an open opted-in tab", 120_000);
  await record("manager-pasted reader automatically uses the same gallery tab and recovers when it closes mid-download", async () => {
    assert.equal(pastedFallbackComplete.id, pastedFallbackItem.id);
    assert.equal(pastedFallbackComplete.gallery?.readerTab, true);
    assert.equal(pastedFallbackComplete.gallery?.completed, readerPages.length);
    assert.equal((await state()).items.filter((entry) => entry.sourceUrl === optInUrl).length, 1);
    const pastedRequests = requests.slice(pastedFallbackRequestOffset);
    const galleryRequests = pastedRequests.filter((request) => request.path === new URL(optInUrl).pathname);
    assert.deepEqual([galleryRequests[0]?.status, galleryRequests[0]?.cookie], [404, null]);
    assert.ok(galleryRequests.length >= 2);
    assert.ok(galleryRequests.slice(1).every((request) => request.status === 200 && request.cookie === "qcTestView=1"));
    assert.ok(galleryRequests.slice(1).every((request) => request.mode === "navigate"));
    const pageRequests = pastedRequests.filter((request) => request.path?.startsWith("/s/"));
    assert.ok(pageRequests.length >= readerPages.length);
    assert.ok(pageRequests.every((request) => request.gid === optInWork.gid && request.status === 200 && request.cookie === "qcTestView=1"));
    const mediaRequests = pastedRequests.filter((request) => request.host === "test.reader.hath.network" || request.host === readerRetry.host);
    assert.equal(mediaRequests.length, 3);
    assert.ok(mediaRequests.every((request) => request.cookie === null));
    assert.ok(context.pages().some((page) => page.url() === optInUrl && page !== reopenedOptInTab),
      "the same gallery should have reopened after the previous tab closed");
    return {
      itemId: pastedFallbackComplete.id,
      status: pastedFallbackComplete.status,
      automaticTabFallback: true,
      galleryCookies: galleryRequests.map((request) => request.cookie),
      pageMetadataRequestCount: pageRequests.length,
      mediaCredentialsOmitted: true,
    };
  });
  const warningUrl = `https://e-hentai.org/g/${warningWork.gid}/${warningWork.token}/`;
  const afterWarningUrl = `https://e-hentai.org/g/${afterWarningWork.gid}/${afterWarningWork.token}/`;
  const warningRequestOffset = requests.length;
  const strictGuestWarning = await command({ kind: "add", urls: [warningUrl], ehentaiMode: "reader" });
  assert.equal(strictGuestWarning?.ok, true, "guest-only import fixture should be queued");
  await addQueueItem(afterWarningUrl, "archive");
  const warningIds = await eventually(async () => {
    const current = await state();
    const warningItem = current.items.find((entry) => entry.sourceUrl === warningUrl);
    const nextItem = current.items.find((entry) => entry.sourceUrl === afterWarningUrl);
    assert.ok(warningItem && nextItem, "AIR warning and following queue item were not added");
    return { warningId: warningItem.id, nextId: nextItem.id };
  }, "AIR warning and following item queued");
  await command({ kind: "start" });
  const warningRecovery = await eventually(async () => {
    const current = await state();
    const warningItem = current.items.find((entry) => entry.id === warningIds.warningId);
    const nextItem = current.items.find((entry) => entry.id === warningIds.nextId);
    assert.ok(warningItem && nextItem);
    assert.equal(warningItem.status, "blocked");
    assert.equal(warningItem.reason, "gallery_content_warning");
    assert.equal(warningItem.gallery?.completed, 0);
    assert.equal(warningItem.downloadId, undefined);
    assert.equal(current.activeId, warningIds.nextId, "blocked AIR warning should release activeId to the next item");
    assert.equal(nextItem.status, "verification", "queue should advance to the following official archive item");
    assert.ok(nextItem.ehArchive?.openedAt);
    const nextPage = context.pages().find((entry) => entry.url() === archiveUrl(afterWarningWork));
    if (!nextPage) throw new Error("following queue item archiver page has not opened");
    return { current, warningItem, nextItem };
  }, "AIR warning blocks safely and queue advances", 60_000);
  await record("AIR content warning is blocked without consent and releases the queue to the next item", async () => {
    const warningRequests = requests.slice(warningRequestOffset).filter((request) => request.gid === warningWork.gid);
    assert.deepEqual(
      warningRequests.map(({ path, search }) => [path, search]),
      [[new URL(warningUrl).pathname, ""]],
      "only the canonical warning page may be requested",
    );
    assert.ok(!requests.slice(warningRequestOffset).some((request) =>
      request.path?.startsWith("/s/") ||
      request.host === "test.reader.hath.network" ||
      request.host === "reader.hath.network"
    ), "warning item unexpectedly requested an image or ZIP");
    assert.equal(warningRecovery.warningItem.gallery?.archive, undefined);
    assert.equal(warningRecovery.warningItem.gallery?.total, undefined);
    await manager.locator('[data-filter="attention"]:visible').first().click();
    await manager.locator(`[data-select="${warningIds.warningId}"]`).click({ timeout: 5_000 });
    const sourceLink = manager.locator("#details a.text-button").first();
    await sourceLink.waitFor({ state: "visible" });
    assert.equal(await sourceLink.getAttribute("href"), warningUrl, "details should link to the canonical warning page");
    const explanation = await manager.locator("#details .reason").innerText();
    assert.match(explanation, /不會自動同意/, "details should explain the warning is not accepted automatically");
    return {
      status: warningRecovery.warningItem.status,
      reason: warningRecovery.warningItem.reason,
      activeNextGid: warningRecovery.nextItem.sourceUrl,
      warningRequests,
      imageOrZipRequests: 0,
      sourceHref: await sourceLink.getAttribute("href"),
      explanation,
    };
  });
  assert.deepEqual(report.pageErrors, []);
  report.downloads = [wrongDownload, ...(await Promise.all(finalState.items.map((item) => manager.evaluate((id) => chrome.downloads.search({ id }).then((rows) => rows[0]), item.downloadId))))].map((download) => ({ id: download.id, filename: path.basename(download.filename), state: download.state, bytes: download.fileSize }));
  report.fixture = { requests, queueOrder: finalState.items.map(gidForItem), wrongTokenDownloadId: wrongDownload.id, correctDownloadIds: finalState.items.map((item) => item.downloadId), secondDownloadManuallyAdopted: true, allArchiveDigestsMatch: true };
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.error = error?.stack || String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (context) await context.close().then(() => report.cleanup.profileClosed = true).catch((error) => report.cleanup.profileCloseError = error.message);
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    report.cleanup.fixtureServerClosed = true;
  }
  const ownedProfile = path.resolve(profile);
  const ownedOut = path.resolve(out) + path.sep;
  if (ownedProfile.startsWith(ownedOut) && path.basename(ownedProfile) === "profile") {
    await fs.rm(ownedProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    report.cleanup.profileRemoved = true;
  }
  report.finishedAt = new Date().toISOString();
  await writeReport();
  console.log(`REPORT ${path.relative(root, reportPath)}`);
}
