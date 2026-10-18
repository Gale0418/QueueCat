import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compressArchive, packageRelease } from "../scripts/package.mjs";

const directories = [];

async function createFixture() {
  const cwd = await mkdtemp(resolve(tmpdir(), "queuecat-package-test-"));
  directories.push(cwd);
  await mkdir(resolve(cwd, "artifacts/unpacked"), { recursive: true });
  await mkdir(resolve(cwd, "dist"), { recursive: true });
  await writeFile(
    resolve(cwd, "artifacts/unpacked/manifest.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  return cwd;
}

async function seedPreviousRelease(cwd) {
  const archive = Buffer.from("PKexisting release");
  const name = "QueueCat-1.2.3.zip";
  const checksum = `${createHash("sha256").update(archive).digest("hex")}  ${name}\n`;
  await writeFile(resolve(cwd, "dist", name), archive);
  await writeFile(resolve(cwd, "dist", `${name}.sha256`), checksum);
  return { archive, checksum };
}

async function expectPreviousRelease(cwd, previous) {
  expect(await readFile(resolve(cwd, "dist/QueueCat-1.2.3.zip"))).toEqual(
    previous.archive,
  );
  expect(
    await readFile(resolve(cwd, "dist/QueueCat-1.2.3.zip.sha256"), "utf8"),
  ).toBe(previous.checksum);
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("packageRelease", () => {
  it("preserves an existing release when the compressor fails", async () => {
    const cwd = await createFixture();
    const previous = await seedPreviousRelease(cwd);

    await expect(
      packageRelease({
        cwd,
        compress: async () => {
          throw new Error("injected compressor failure");
        },
      }),
    ).rejects.toThrow("injected compressor failure");

    await expectPreviousRelease(cwd, previous);
  });

  it("preserves an existing release when the compressor produces a non-ZIP", async () => {
    const cwd = await createFixture();
    const previous = await seedPreviousRelease(cwd);

    await expect(
      packageRelease({
        cwd,
        compress: async (_staging, output) => {
          await writeFile(output, "not a zip");
        },
      }),
    ).rejects.toThrow("Expected a ZIP archive");

    await expectPreviousRelease(cwd, previous);
  });

  it("preserves an existing release when PK-prefixed output is not a readable ZIP", async () => {
    const cwd = await createFixture();
    const previous = await seedPreviousRelease(cwd);

    await expect(
      packageRelease({
        cwd,
        compress: async (_staging, output) => {
          await writeFile(output, "PK\u0003\u0004not a real zip archive");
        },
      }),
    ).rejects.toThrow();

    await expectPreviousRelease(cwd, previous);
  });

  it("retains backups and reports their path when package rollback fails", async () => {
    const cwd = await createFixture();
    await seedPreviousRelease(cwd);
    const checksum = resolve(cwd, "dist/QueueCat-1.2.3.zip.sha256");
    const fileOps = {
      rename: async (source, destination) => {
        if (
          source.startsWith(resolve(cwd, ".package-")) &&
          destination === checksum
        ) {
          throw new Error("injected publish failure");
        }
        if (source.endsWith(".previous")) {
          throw new Error("injected rollback rename failure");
        }
        return rename(source, destination);
      },
      rm,
    };

    let publishError;
    try {
      await packageRelease({ cwd, fileOps, compress: compressArchive });
    } catch (error) {
      publishError = error;
    }
    expect(publishError).toBeInstanceOf(AggregateError);
    const match = publishError.message.match(/Backups retained at: (.+)$/);
    expect(match).not.toBeNull();
    const backups = await readdir(match[1]);
    expect(backups).toContain("QueueCat-1.2.3.zip.previous");
    expect(backups).toContain("QueueCat-1.2.3.zip.sha256.previous");
  });

  it("publishes a verified archive and matching checksum", async () => {
    const cwd = await createFixture();
    await packageRelease({ cwd, compress: compressArchive });
    const archive = await readFile(resolve(cwd, "dist/QueueCat-1.2.3.zip"));

    expect(await readFile(resolve(cwd, "dist/QueueCat-1.2.3.zip"))).toEqual(
      archive,
    );
    expect(
      await readFile(resolve(cwd, "dist/QueueCat-1.2.3.zip.sha256"), "utf8"),
    ).toBe(
      `${createHash("sha256").update(archive).digest("hex")}  QueueCat-1.2.3.zip\n`,
    );
  });
});
