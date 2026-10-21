import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

const output = "artifacts/unpacked";
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, [
  "storage",
  "downloads",
  "alarms",
  "notifications",
  "nativeMessaging",
  "offscreen",
  "declarativeNetRequestWithHostAccess",
]);
assert.deepEqual(manifest.host_permissions, [
  "https://katfile.com/*",
  "https://katfile.biz/*",
  "https://www.katfile.com/*",
  "https://www.katfile.biz/*",
  "https://hitomi.la/*",
  "https://ltn.gold-usergeneratedcontent.net/*",
  "https://w1.gold-usergeneratedcontent.net/*",
  "https://w2.gold-usergeneratedcontent.net/*",
]);
const files = [
  "popup.html",
  "manager.html",
  "background.js",
  "content.js",
  "gallery-offscreen.html",
  "gallery-offscreen.js",
  "assets/zip-license.txt",
  ...Object.values(manifest.icons),
];
for (const file of files)
  assert.ok(
    (await readFile(`${output}/${file}`)).length > 0,
    `Missing ${file}`,
  );
const assets = {};
for (const state of ["sleep", "work", "verify", "confused", "happy"]) {
  const path = `${output}/assets/cat-${state}-v3.png`;
  const metadata = await sharp(path).metadata();
  assert.equal(metadata.hasAlpha, true, `${path} lacks transparency`);
  assert.ok(metadata.width > 0 && metadata.height > 0);
  assets[path] = {
    width: metadata.width,
    height: metadata.height,
    alpha: metadata.hasAlpha,
  };
}
const content = await readFile(`${output}/content.js`, "utf8");
assert.ok(
  !/^import\s/m.test(content),
  "Content script must be a standalone bundle",
);
const entries = {};
for (const file of (await readdir(output, { recursive: true })).filter((f) =>
  /\.(?:js|css|html|json|png|woff2|txt)$/.test(f),
)) {
  const bytes = await readFile(`${output}/${file}`);
  assert.deepEqual(
    await readFile(file),
    bytes,
    `Root install file differs: ${file}`,
  );
  entries[file] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
for (const page of ["popup.html", "manager.html"]) {
  const html = await readFile(page, "utf8");
  assert.ok(
    !html.includes("/src/") && !html.includes("../assets/"),
    `${page} is not installable`,
  );
  for (const [, path] of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) {
    assert.ok(
      (await readFile(path)).length > 0,
      `Missing page resource: ${path}`,
    );
  }
}
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/build-manifest.json",
  JSON.stringify({ version: manifest.version, assets, entries }, null, 2),
);
console.log(
  `Verified MV3 package: ${Object.keys(entries).length} files, 5 transparent static mascots.`,
);
