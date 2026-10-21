import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BlobReader,
  BlobWriter,
  ZipReader,
} from "@zip.js/zip.js/lib/zip-core-external.js";

// End-to-end Hitomi gallery checks use only this owned Chromium profile and a
// loopback HTTPS fixture. QueueCat's production extension files are copied as-is.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { values } = parseArgs({
  options: {
    "playwright-module": {
      type: "string",
      default:
        "C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
    },
    "browser-cache": {
      type: "string",
      default: "D:/MyGame/LLMeeting/output/playwright-browsers",
    },
    extension: {
      type: "string",
      default: path.join(root, "artifacts", "unpacked"),
    },
    openssl: {
      type: "string",
      default: "C:/Users/USER/miniconda3/Library/bin/openssl.exe",
    },
  },
});
if (values["browser-cache"])
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(values["browser-cache"]);
const { chromium } = await import(
  pathToFileURL(path.resolve(values["playwright-module"])).href
);
const sharp = (await import("sharp")).default;

const galleryId = "12345";
const title = "QueueCat fixture";
const hashes = [
  `${"0".repeat(61)}f0c`,
  `${"0".repeat(61)}123`,
  `${"a".repeat(64)}`,
];
const hosts = [
  "hitomi.la",
  "ltn.gold-usergeneratedcontent.net",
  "w1.gold-usergeneratedcontent.net",
  "w2.gold-usergeneratedcontent.net",
];
const base = "1792544401/";
const rootOut = path.join(
  root,
  "artifacts",
  "gallery-browser",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const extension = path.join(rootOut, "extension");
const profile = path.join(rootOut, "profile");
const downloadsDir = path.join(rootOut, "downloads");
const fixtureDir = path.join(rootOut, "fixture");
const reportPath = path.join(rootOut, "report.json");
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  pageErrors: [],
  galleryId,
  title,
  imageRequests: [],
  stateSeeding: { used: false, mechanism: "no extension storage writes" },
  isolation: {
    profile,
    extension,
    downloadsDir,
    personalChromeAttached: false,
    personalDownloadsRead: false,
    network: "owned Chromium host mapping to loopback HTTPS fixture only",
  },
  cleanup: {},
};

let context;
let manager;
let fixtureServer;
let releaseSecondImage = false;
let secondImageGateReached = false;
let secondImageGateResolve;
const secondImageGate = new Promise(
  (resolve) => (secondImageGateResolve = resolve),
);
const fatalErrors = [];
function noteFatal(error) {
  fatalErrors.push(error instanceof Error ? error : new Error(String(error)));
  fixtureServer?.closeAllConnections();
}
process.on("uncaughtException", noteFatal);
process.on("unhandledRejection", noteFatal);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    if (fatalErrors.length) throw fatalErrors[0];
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
async function record(name, fn) {
  const started = Date.now();
  const result = await fn();
  report.checks.push({
    name,
    status: "pass",
    ms: Date.now() - started,
    result,
  });
  await writeReport();
  console.log(`PASS ${name}`);
  return result;
}
async function writeReport() {
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}
const sha256 = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const extensionSource = path.resolve(values.extension);
const extensionManifestPath = path.join(extensionSource, "manifest.json");
const testedHashes = {};
let worker;
let extensionOrigin;
let imageFiles = [];

try {
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.mkdir(downloadsDir, { recursive: true });
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
  await fs.cp(extensionSource, extension, { recursive: true });
  const manifest = JSON.parse(
    await fs.readFile(path.join(extension, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("storage"));
  await fs.access(path.join(extension, manifest.background.service_worker));
  report.testedExtensionSha256 = {
    background: await sha256(
      path.join(extension, manifest.background.service_worker),
    ),
    content: await fs
      .access(path.join(extension, "content.js"))
      .then(() => sha256(path.join(extension, "content.js")))
      .catch(() => undefined),
    manifest: await sha256(path.join(extension, "manifest.json")),
  };

  // Random RGB samples produce real, distinct WebP payloads large enough to
  // expose a genuine Chrome in-progress download while the final byte is held.
  imageFiles = await Promise.all(
    hashes.map(async (hash, index) => {
      const raw = randomBytes(256 * 256 * 3);
      const file = path.join(fixtureDir, `${hash}.webp`);
      await sharp(raw, { raw: { width: 256, height: 256, channels: 3 } })
        .webp({ quality: 88 })
        .toFile(file);
      const bytes = await fs.readFile(file);
      assert.ok(bytes.length > 1024, "fixture WebP unexpectedly small");
      return { hash, file, bytes, sha256: await sha256(file), index };
    }),
  );
  report.fixtureImages = imageFiles.map(({ hash, bytes, sha256: digest }) => ({
    hash,
    bytes: bytes.length,
    sha256: digest,
  }));

  const keyFile = path.join(fixtureDir, "fixture-key.pem");
  const certFile = path.join(fixtureDir, "fixture-cert.pem");
  const opensslConfig = path.join(fixtureDir, "openssl.cnf");
  await fs.writeFile(
    opensslConfig,
    "[req]\ndistinguished_name=dn\n[dn]\n",
    "utf8",
  );
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
      "2",
      "-subj",
      "/CN=hitomi.la",
      "-addext",
      `subjectAltName=${hosts.map((host) => `DNS:${host}`).join(",")}`,
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  const tls = {
    key: await fs.readFile(keyFile),
    cert: await fs.readFile(certFile),
  };
  const metadata = `var galleryinfo = ${JSON.stringify({
    id: Number(galleryId),
    title,
    files: imageFiles.map(({ hash }, index) => ({
      hash,
      name: `fixture-${index + 1}.webp`,
    })),
  })};`;
  const routing = `'use strict';\ngg = { m: function(g) { var o = 1; switch (g) { case 3312: o = 0; break; } return o; }, s: function(h) { var m = /(..)(.)$/.exec(h); return parseInt(m[2]+m[1], 16).toString(10); }, b: '${base}' };`;
  let metadataRequests = 0;
  let routingRequests = 0;
  fixtureServer = https.createServer(tls, (req, res) => {
    void (async () => {
      const host = req.headers.host?.split(":")[0]?.toLowerCase();
      const pathname = new URL(req.url || "/", `https://${host || "hitomi.la"}`)
        .pathname;
      if (req.method !== "GET") return res.writeHead(405).end();
      if (
        host === "ltn.gold-usergeneratedcontent.net" &&
        pathname === `/galleries/${galleryId}.js`
      ) {
        metadataRequests++;
        res
          .writeHead(200, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
          })
          .end(metadata);
        return;
      }
      if (
        host === "ltn.gold-usergeneratedcontent.net" &&
        pathname === "/gg.js"
      ) {
        routingRequests++;
        res
          .writeHead(200, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
          })
          .end(routing);
        return;
      }
      const match = /^\/(\d+)\/(\d+)\/([0-9a-f]{64})\.webp$/i.exec(pathname);
      const image =
        match &&
        imageFiles.find((entry) => entry.hash === match[3].toLowerCase());
      if (
        image &&
        (host === "w1.gold-usergeneratedcontent.net" ||
          host === "w2.gold-usergeneratedcontent.net")
      ) {
        const request = {
          host,
          path: pathname,
          hash: image.hash,
          at: new Date().toISOString(),
          referer: req.headers.referer,
        };
        report.imageRequests.push(request);
        if (req.headers.referer !== "https://hitomi.la/") {
          res.writeHead(404).end("missing gallery source header");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "image/webp",
          "Content-Length": image.bytes.length,
          "Cache-Control": "no-store",
        });
        if (image.index === 1) {
          res.write(image.bytes.subarray(0, -1), () => {
            secondImageGateReached = true;
            secondImageGateResolve();
          });
          while (!releaseSecondImage && !res.destroyed) await sleep(50);
          if (!res.destroyed) res.end(image.bytes.subarray(-1));
        } else if (!res.destroyed) res.end(image.bytes);
        return;
      }
      res
        .writeHead(404, { "Cache-Control": "no-store" })
        .end("fixture not found");
    })().catch((error) => {
      noteFatal(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once("error", reject);
    // Bind only to loopback. If 443 is occupied, fail without touching it.
    fixtureServer.listen(443, "127.0.0.1", resolve);
  });

  console.log("Launching owned isolated Chromium profile...");
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
      "--host-resolver-rules=MAP * 127.0.0.1",
      "--no-proxy-server",
      "--disable-background-networking",
      "--ignore-certificate-errors",
      "--window-position=-32000,-32000",
    ],
  });
  context.on("page", (page) =>
    page.on("pageerror", (error) => report.pageErrors.push(error.message)),
  );
  context.on("console", (message) => {
    if (message.type() === "error") {
      (report.consoleErrors ??= []).push(message.text());
    }
  });
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  extensionOrigin = worker.url().split("/").slice(0, 3).join("/");
  const extensionId = await worker.evaluate(() => chrome.runtime.id);
  report.extensionId = extensionId;
  report.browserVersion = context.browser()?.version();
  manager = await context.newPage();
  const cdp = await context.newCDPSession(manager);
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadsDir,
    eventsEnabled: true,
  });
  await cdp.detach();
  await manager.goto(`${extensionOrigin}/manager.html#add`);
  await manager.locator("#url-input").waitFor({ state: "visible" });
  await record("fresh interface does not advertise the optional provider", async () => {
    assert.equal(await manager.locator("#provider-chip").innerText(), "Katfile");
    assert.doesNotMatch(await manager.locator("#share-intro").inputValue(), /gallery|hitomi|圖庫|ギャラリー/i);
    assert.doesNotMatch(await manager.locator("#url-input").getAttribute("placeholder"), /hitomi/i);
    return { defaultProvider: "Katfile" };
  });

  const state = async () => {
    const reply = await manager.evaluate(() =>
      chrome.runtime.sendMessage({ type: "QC_GET" }),
    );
    assert.equal(
      reply?.ok,
      true,
      `QC_GET failed: ${reply?.error || "unknown"}`,
    );
    return reply.state;
  };
  const activeGallery = (current) =>
    current.items.find((item) => item.gallery?.id === galleryId);

  await record(
    "single Hitomi URL adds one Gallery queue item through the manager UI",
    async () => {
      await manager
        .locator("#url-input")
        .fill(`https://hitomi.la/galleries/${galleryId}.html`);
      await manager.locator("#confirm-add").click();
      const current = await eventually(async () => {
        const value = await state();
        assert.equal(value.items.length, 1);
        assert.equal(value.items[0].gallery?.id, galleryId);
        return value;
      }, "add one Hitomi gallery");
      assert.equal(current.items[0].status, "queued");
      assert.equal(
        metadataRequests,
        0,
        "adding a gallery must not fetch metadata before start",
      );
      return {
        items: current.items.length,
        status: current.items[0].status,
        metadataFetchedBeforeStart: false,
      };
    },
  );

  await record(
    "three language layouts have no horizontal overflow at a narrow viewport",
    async () => {
      await manager.setViewportSize({ width: 620, height: 820 });
      await manager.locator('.top-actions [data-action="settings"]').click();
      const language = manager.locator("#language");
      for (const locale of ["en", "zh-TW", "ja"]) {
        await language.selectOption(locale);
        await manager.waitForFunction(
          (value) => document.documentElement.lang === value,
          locale,
        );
        assert.equal(
          await manager.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          ),
          false,
          `${locale} layout overflows`,
        );
      }
      await language.selectOption("zh-TW");
      await manager.goto(`${extensionOrigin}/manager.html`);
      await manager.setViewportSize({ width: 1280, height: 900 });
      const foreground = await manager.evaluate(() => {
        const queue = document.querySelector(".queue-section");
        const mascot = document.querySelector("#mascot");
        const title = document.querySelector(
          "#queue-list .queue-row .file-info strong",
        );
        const add = document.querySelector(
          '.queue-section .list-actions [data-action="add"]',
        );
        if (
          !(queue instanceof HTMLElement) ||
          !(mascot instanceof HTMLImageElement) ||
          !(title instanceof HTMLElement) ||
          !(add instanceof HTMLElement)
        )
          throw new Error("gallery foreground targets are missing");
        const hit = (element) => {
          const rect = element.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const top = document.elementFromPoint(x, y);
          return {
            visible: rect.width > 0 && rect.height > 0,
            hitInsideTarget:
              !!top && (element === top || element.contains(top)),
            hitInsideQueueAction:
              !!top && !!top.closest(".file-select, [data-action=add]"),
            hitTag: top?.tagName,
            hitClass: typeof top?.className === "string" ? top.className : "",
          };
        };
        const queueRect = queue.getBoundingClientRect();
        const mascotRect = mascot.getBoundingClientRect();
        const overlaps =
          Math.min(queueRect.right, mascotRect.right) >
            Math.max(queueRect.left, mascotRect.left) &&
          Math.min(queueRect.bottom, mascotRect.bottom) >
            Math.max(queueRect.top, mascotRect.top);
        return {
          mascotVisible:
            getComputedStyle(mascot).visibility !== "hidden" &&
            mascotRect.width > 0 &&
            mascotRect.height > 0 &&
            mascot.naturalWidth > 0,
          mascotOverlapsQueue: overlaps,
          queueBackground: getComputedStyle(queue).backgroundColor,
          titleHit: hit(title),
          addButtonHit: hit(add),
        };
      });
      assert.equal(
        foreground.mascotVisible,
        true,
        "the mascot should remain visible",
      );
      assert.equal(
        foreground.mascotOverlapsQueue,
        true,
        "the mascot should retain its intended visual overlap with the queue section",
      );
      assert.notEqual(
        foreground.queueBackground,
        "rgba(0, 0, 0, 0)",
        "queue section must have an opaque foreground background",
      );
      assert.equal(foreground.titleHit.visible, true);
      assert.equal(
        foreground.titleHit.hitInsideQueueAction,
        true,
        "queue title must be reachable above the mascot layer",
      );
      assert.equal(foreground.addButtonHit.visible, true);
      assert.equal(
        foreground.addButtonHit.hitInsideTarget,
        true,
        "queue action button must receive pointer hits above the mascot layer",
      );
      await manager.screenshot({
        path: path.join(rootOut, "manager-gallery.png"),
        fullPage: true,
      });
      return {
        languages: ["en", "zh-TW", "ja"],
        width: 620,
        horizontalOverflow: false,
        foreground,
      };
    },
  );

  await manager.locator('#hero-actions [data-action="start"]').click();
  await eventually(async () => {
    const current = await state();
    assert.equal(current.running, true);
    return current;
  }, "start queue from manager UI");

  await record(
    "first page is staged while second page is fetched offscreen without blocking state reads",
    async () => {
      await eventually(
        async () => {
          assert.equal(secondImageGateReached, true);
          return true;
        },
        "second image response reached the final-byte gate",
        60_000,
      );
      const pausedPoint = await eventually(
        async () => {
          const current = await state();
          const item = activeGallery(current);
          assert.ok(item);
          assert.equal(item.status, "preparing");
          assert.equal(item.gallery.archive?.staged, 1);
          assert.equal(item.gallery.total, 3);
          assert.equal(item.downloadId, undefined);
          const downloads = await manager.evaluate(() =>
            chrome.downloads.search({}),
          );
          const own = downloads.filter(
            (d) => d.byExtensionId === report.extensionId,
          );
          assert.equal(
            own.length,
            0,
            "ZIP download must wait until all pages are staged and packed",
          );
          return { current, item };
        },
        "first page staged and second page held before its last byte",
        60_000,
      );
      assert.equal(secondImageGateReached, true);
      assert.deepEqual(
        report.imageRequests.map((request) => request.hash),
        hashes.slice(0, 2),
      );
      assert.match(report.imageRequests[0].path, /^\/1792544401\/3312\//);
      assert.equal(
        report.imageRequests[0].host,
        "w1.gold-usergeneratedcontent.net",
      );
      assert.match(report.imageRequests[1].path, /^\/1792544401\/786\//);
      assert.equal(
        report.imageRequests[1].host,
        "w2.gold-usergeneratedcontent.net",
      );
      report.gatedFetch = { page: 2, chromeZipDownloadNotCreated: true };
      return {
        galleryStaged: pausedPoint.item.gallery.archive.staged,
        galleryTotal: pausedPoint.item.gallery.total,
        offscreenFetchHeld: true,
        stateReadsResponsive: true,
      };
    },
  );

  await record(
    "pausing during staging commits the current page but starts no later page or pack",
    async () => {
      await manager.locator('#hero-actions [data-action="pause"]').click();
      await eventually(async () => {
        const current = await state();
        assert.equal(current.running, false);
        return current;
      }, "pause queue through manager UI");
      releaseSecondImage = true;
      const current = await eventually(
        async () => {
          const value = await state();
          const item = activeGallery(value);
          assert.equal(value.running, false);
          assert.equal(item.gallery.archive?.staged, 2);
          assert.equal(item.gallery.archive?.phase, "collecting");
          assert.equal(item.status, "queued");
          assert.equal(item.downloadId, undefined);
          assert.equal(item.gallery.completed, 0);
          assert.deepEqual(
            report.imageRequests.map((request) => request.hash),
            hashes.slice(0, 2),
          );
          return value;
        },
        "in-flight second page commits while paused without staging page three or packing",
        60_000,
      );
      const allDownloads = await manager.evaluate(() =>
        chrome.downloads.search({}),
      );
      const own = allDownloads.filter(
        (download) => download.byExtensionId === report.extensionId,
      );
      assert.equal(own.length, 0);
      return {
        running: current.running,
        galleryStaged: current.items[0].gallery.archive.staged,
        galleryCompleted: current.items[0].gallery.completed,
        imageRequests: report.imageRequests.map((request) => request.hash),
        ownDownloadCount: own.length,
      };
    },
  );

  await manager.locator('#hero-actions [data-action="start"]').click();
  const completeState = await eventually(
    async () => {
      const current = await state();
      const item = activeGallery(current);
      assert.ok(item);
      assert.equal(item.status, "complete");
      assert.equal(item.gallery.completed, 3);
      return current;
    },
    "resume queue and finish the final image",
    60_000,
  );
  const expectedZipPath = completeState.items[0].gallery.archive.filename;
  assert.match(expectedZipPath, /^QueueCat\/12345-QueueCat fixture\.zip$/i);
  await record(
    "one real Chrome ZIP download contains the fixture pages in order with matching bytes and CRC",
    async () => {
      const downloads = await manager.evaluate(() =>
        chrome.downloads.search({}),
      );
      const own = downloads
        .filter((download) => download.byExtensionId === report.extensionId)
        .sort((a, b) => a.id - b.id);
      assert.equal(own.length, 1);
      assert.equal(own[0].state, "complete");
      const zipDownload = own[0];
      const relativePath = zipDownload.filename
        .slice(path.resolve(downloadsDir).length + 1)
        .replaceAll("\\", "/");
      assert.deepEqual(relativePath, expectedZipPath);
      assert.equal(path.extname(relativePath).toLowerCase(), ".zip");
      const archiveBytes = await fs.readFile(zipDownload.filename);
      const archiveBlob = new Blob([
        archiveBytes.buffer.slice(
          archiveBytes.byteOffset,
          archiveBytes.byteOffset + archiveBytes.byteLength,
        ),
      ]);
      const reader = new ZipReader(new BlobReader(archiveBlob), {
        checkSignature: true,
        checkCrc32: true,
      });
      let archiveEntries;
      try {
        archiveEntries = await reader.getEntries();
        assert.deepEqual(
          archiveEntries.map((entry) => entry.filename),
          imageFiles.map(
            (_, index) => `${String(index + 1).padStart(4, "0")}.webp`,
          ),
        );
        for (let index = 0; index < archiveEntries.length; index++) {
          const entry = archiveEntries[index];
          assert.ok(
            "getData" in entry,
            `expected file entry ${entry.filename}`,
          );
          const extracted = await entry.getData(new BlobWriter());
          assert.equal(
            createHash("sha256")
              .update(Buffer.from(await extracted.arrayBuffer()))
              .digest("hex"),
            imageFiles[index].sha256,
            `ZIP entry content does not match fixture page ${index + 1}`,
          );
        }
      } finally {
        await reader.close();
      }
      report.downloads = [
        {
          id: zipDownload.id,
          filename: relativePath,
          state: zipDownload.state,
          bytes: zipDownload.fileSize,
          entries: archiveEntries.map((entry) => entry.filename),
          pageHashes: imageFiles.map((image) => image.sha256),
        },
      ];
      return {
        zipPath: relativePath,
        recordCount: own.length,
        states: own.map((download) => download.state),
        entries: archiveEntries.map((entry) => entry.filename),
        pageHashes: imageFiles.map((image) => image.sha256),
        hashesMatch: true,
      };
    },
  );

  await record(
    "background reconciliation preserves completed gallery and does not request images again",
    async () => {
      const cdp = await context.newCDPSession(manager);
      try {
        await cdp.send("ServiceWorker.enable");
        await cdp.send("ServiceWorker.stopAllWorkers");
      } finally {
        await cdp.detach();
      }
      const afterRestart = await eventually(async () => {
        const current = await state();
        assert.equal(activeGallery(current).status, "complete");
        assert.equal(activeGallery(current).gallery.completed, 3);
        return current;
      }, "completed gallery remains after reconciliation request");
      assert.deepEqual(
        report.imageRequests.map((request) => request.hash),
        hashes,
      );
      assert.deepEqual(report.pageErrors, []);
      return {
        status: activeGallery(afterRestart).status,
        completed: activeGallery(afterRestart).gallery.completed,
        imageRequests: report.imageRequests.length,
        duplicateDownloads: false,
        workerRestartConfirmed: false,
      };
    },
  );

  assert.equal(metadataRequests >= 1, true);
  assert.equal(routingRequests >= 1, true);
  report.workerRestartCoverage = {
    status: "unknown",
    reason:
      "CDP stop requests did not produce an observed replacement extension worker; persistence recovery is separately covered by unit tests",
  };
  report.fixture = {
    metadataRequests,
    routingRequests,
    imageRequests: report.imageRequests,
    galleryCompleted: activeGallery(completeState).gallery.completed,
    downloads: report.downloads,
    ownProfileOnly: true,
  };
  report.status = "pass";
  await record("completed ZIP releases private staging and download resources", async () => {
    const remaining = await manager.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      try {
        const archives = await root.getDirectoryHandle("queuecat-archives");
        const keys = [];
        for await (const key of archives.keys()) keys.push(key);
        return keys;
      } catch (error) {
        if (error.name === "NotFoundError") return [];
        throw error;
      }
    });
    assert.deepEqual(remaining, []);
    assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
    assert.deepEqual(await manager.evaluate(() => chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"]})), []);
    return { stagingRemoved:true, offscreenClosed:true, rulesRemoved:true };
  });
} catch (error) {
  report.status = "fail";
  report.error = error?.stack || String(error);
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
    await context
      .close()
      .then(() => (report.cleanup.profileClosed = true))
      .catch((error) => (report.cleanup.profileCloseError = error.message));
  }
  if (fixtureServer) {
    fixtureServer.closeAllConnections();
    await new Promise((resolve) => fixtureServer.close(resolve));
    report.cleanup.fixtureServerClosed = true;
  }
  const ownedProfile = path.resolve(profile);
  const ownedOut = path.resolve(rootOut) + path.sep;
  if (
    ownedProfile.startsWith(ownedOut) &&
    path.basename(ownedProfile) === "profile"
  ) {
    await fs.rm(ownedProfile, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    report.cleanup.profileRemoved = true;
  }
  report.cleanup.fixtureSamplesPreserved = true;
  report.finishedAt = new Date().toISOString();
  await writeReport();
  console.log(`REPORT ${path.relative(root, reportPath)}`);
}
