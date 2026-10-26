import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { publishExtension } from "../scripts/publish-extension.mjs";

const directories = [];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const cwd = await mkdtemp(resolve(tmpdir(), "queuecat-publish-test-"));
  directories.push(cwd);
  await mkdir(resolve(cwd, "artifacts/unpacked/entries"), { recursive: true });
  await writeFile(
    resolve(cwd, "artifacts/unpacked/entries/popup.html"),
    '<img src="../assets/popup.png">',
  );
  await writeFile(
    resolve(cwd, "artifacts/unpacked/entries/manager.html"),
    '<img src="../assets/manager.png">',
  );
  const generated = {
    "manifest.json": '{"version":"old"}',
    "background.js": "old background",
    "content.js": "old content",
  };
  const next = {
    "manifest.json": '{"version":"new"}',
    "background.js": "new background",
    "content.js": "new content",
  };
  for (const [file, contents] of Object.entries(next)) {
    await writeFile(resolve(cwd, "artifacts/unpacked", file), contents);
  }
  for (const [file, contents] of Object.entries(generated)) {
    await writeFile(resolve(cwd, file), contents);
  }
  const oldReceipt = Object.fromEntries(
    Object.entries(generated).map(([file, contents]) => [
      file,
      digest(contents),
    ]),
  );
  await writeFile(
    resolve(cwd, "artifacts/root-install-manifest.json"),
    JSON.stringify(oldReceipt),
  );
  return { cwd, generated, oldReceipt };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("publishExtension", () => {
  it("restores every root file and the receipt after a later copy fails", async () => {
    const { cwd, generated, oldReceipt } = await fixture();
    const failingIO = {
      copyFile,
      mkdir,
      mkdtemp,
      readFile,
      readdir,
      rm,
      rmdir,
      unlink,
      writeFile: async (path, ...args) => {
        if (path === resolve(cwd, "manifest.json")) {
          expect(await readFile(resolve(cwd, "background.js"), "utf8")).toBe(
            "new background",
          );
          throw new Error("injected later publish failure");
        }
        return writeFile(path, ...args);
      },
    };

    await expect(publishExtension({ cwd, io: failingIO })).rejects.toThrow(
      "injected later publish failure",
    );
    for (const [file, contents] of Object.entries(generated)) {
      expect(await readFile(resolve(cwd, file), "utf8")).toBe(contents);
    }
    expect(
      JSON.parse(
        await readFile(
          resolve(cwd, "artifacts/root-install-manifest.json"),
          "utf8",
        ),
      ),
    ).toEqual(oldReceipt);
  });

  it("retains backups and reports their path when rollback is incomplete", async () => {
    const { cwd } = await fixture();
    const failingIO = {
      copyFile: async () => {
        throw new Error("injected rollback failure");
      },
      mkdir,
      mkdtemp,
      readFile,
      readdir,
      rm,
      rmdir,
      unlink,
      writeFile: async (path, ...args) => {
        if (path === resolve(cwd, "manifest.json")) {
          throw new Error("injected publish failure");
        }
        return writeFile(path, ...args);
      },
    };

    let publishError;
    try {
      await publishExtension({ cwd, io: failingIO });
    } catch (error) {
      publishError = error;
    }
    expect(publishError).toBeInstanceOf(AggregateError);
    const match = publishError.message.match(/Backups retained at: (.+)$/);
    expect(match).not.toBeNull();
    expect(await readdir(match[1])).toContain("receipt.previous");
    expect(await readdir(match[1])).toContain("original-0");
  });

  it("normalizes staged pages before verify-dist and removes entries", async () => {
    const cwd = await mkdtemp(
      resolve(tmpdir(), "queuecat-publish-verify-test-"),
    );
    directories.push(cwd);
    const staging = resolve(cwd, "artifacts/unpacked");
    await mkdir(resolve(staging, "entries"), { recursive: true });
    const iconSizes = ["16", "32", "48", "128"];
    const icons = Object.fromEntries(
      iconSizes.map((size) => [size, `icons/icon-${size}.png`]),
    );
    const sourceManifest = JSON.parse(
      await readFile(
        new URL("../public/manifest.json", import.meta.url),
        "utf8",
      ),
    );
    const manifest = {
      manifest_version: 3,
      version: "1.2.3",
      permissions: [
        "storage",
        "downloads",
        "alarms",
        "notifications",
        "nativeMessaging",
        "offscreen",
        "declarativeNetRequestWithHostAccess",
      ],
      host_permissions: sourceManifest.host_permissions,
      content_scripts: sourceManifest.content_scripts,
      icons,
    };
    await writeFile(
      resolve(staging, "manifest.json"),
      JSON.stringify(manifest),
    );
    await writeFile(resolve(staging, "background.js"), "// background");
    await writeFile(resolve(staging, "content.js"), "// standalone content");
    await writeFile(
      resolve(staging, "gallery-offscreen.html"),
      "<!doctype html><script src='gallery-offscreen.js'></script>",
    );
    await writeFile(
      resolve(staging, "gallery-offscreen.js"),
      "// offscreen blob bridge",
    );
    await writeFile(
      resolve(staging, "entries/popup.html"),
      '<img src="../assets/cat-happy-v3.png">',
    );
    await writeFile(
      resolve(staging, "entries/manager.html"),
      "<main>Manager</main>",
    );

    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    await mkdir(resolve(staging, "assets"), { recursive: true });
    await writeFile(
      resolve(staging, "assets/zip-license.txt"),
      "BSD-3-Clause test license",
    );
    await mkdir(resolve(staging, "icons"), { recursive: true });
    for (const state of ["sleep", "work", "verify", "confused", "happy"]) {
      await writeFile(resolve(staging, `assets/cat-${state}-v3.png`), png);
    }
    for (const icon of Object.values(icons)) {
      await writeFile(resolve(staging, icon), png);
    }

    await publishExtension({ cwd });

    await expect(readdir(resolve(staging, "entries"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(resolve(staging, "popup.html"), "utf8")).toContain(
      "./assets/cat-happy-v3.png",
    );
    const verifyScript = fileURLToPath(
      new URL("../scripts/verify-dist.mjs", import.meta.url),
    );
    execFileSync(process.execPath, [verifyScript], { cwd, stdio: "pipe" });
  }, 30_000);
});
