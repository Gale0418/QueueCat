import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function compressArchive(staging, output) {
  if (process.platform === "win32") {
    execFileSync("tar.exe", ["-a", "-c", "-f", output, "-C", staging, "."], {
      stdio: "inherit",
    });
  } else {
    // The package step needs the standard zip command on macOS/Linux.
    execFileSync("zip", ["-q", "-r", output, "."], {
      cwd: staging,
      stdio: "inherit",
    });
  }
}

export async function validateArchive(archive, temporaryDirectory) {
  if (process.platform === "win32") {
    const extracted = resolve(temporaryDirectory, "verify-archive");
    await mkdir(extracted, { recursive: true });
    // Extraction forces tar to decompress every member and verify each ZIP CRC.
    execFileSync("tar.exe", ["-x", "-f", archive, "-C", extracted], {
      stdio: "inherit",
    });
  } else {
    // unzip -t reads each member and checks its compressed data and CRC.
    execFileSync("unzip", ["-t", archive], { stdio: "inherit" });
  }
}

class PackagePublishRollbackError extends AggregateError {
  constructor(errors, temporaryDirectory) {
    super(
      errors,
      `Package publish rollback was incomplete. Backups retained at: ${temporaryDirectory}`,
    );
    this.name = "PackagePublishRollbackError";
  }
}

async function publishFiles(stagedFiles, temporaryDirectory, fileOps) {
  const backups = [];
  const published = [];

  try {
    for (const { source, destination } of stagedFiles) {
      try {
        const backup = resolve(
          temporaryDirectory,
          `${basename(destination)}.previous`,
        );
        await fileOps.rename(destination, backup);
        backups.push({ backup, destination });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      await fileOps.rename(source, destination);
      published.push(destination);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const destination of published.reverse()) {
      try {
        await fileOps.rm(destination, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const { backup, destination } of backups.reverse()) {
      try {
        await fileOps.rename(backup, destination);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      throw new PackagePublishRollbackError(
        [error, ...rollbackErrors],
        temporaryDirectory,
      );
    }
    throw error;
  }
}

export async function packageRelease({
  cwd = process.cwd(),
  compress = compressArchive,
  fileOps = { rename, rm },
} = {}) {
  const staging = resolve(cwd, "artifacts/unpacked");
  const manifest = JSON.parse(
    await readFile(resolve(staging, "manifest.json"), "utf8"),
  );
  const dist = resolve(cwd, "dist");
  await mkdir(dist, { recursive: true });
  for (const file of await readdir(dist)) {
    assert.match(
      file,
      /\.(?:zip|sha256)$/,
      `dist is reserved for release packages: ${file}`,
    );
  }

  const name = `QueueCat-${manifest.version}.zip`;
  const output = resolve(dist, name);
  const checksum = resolve(dist, `${name}.sha256`);
  const temporaryDirectory = await mkdtemp(resolve(cwd, ".package-"));
  let preserveTemporaryDirectory = false;
  try {
    const stagedArchive = resolve(temporaryDirectory, name);
    const stagedChecksum = resolve(temporaryDirectory, `${name}.sha256`);
    await compress(staging, stagedArchive);

    const bytes = await readFile(stagedArchive);
    assert.equal(
      bytes.subarray(0, 2).toString(),
      "PK",
      "Expected a ZIP archive",
    );
    await validateArchive(stagedArchive, temporaryDirectory);
    const digest = createHash("sha256").update(bytes).digest("hex");
    await writeFile(stagedChecksum, `${digest}  ${name}\n`);

    await publishFiles(
      [
        { source: stagedArchive, destination: output },
        { source: stagedChecksum, destination: checksum },
      ],
      temporaryDirectory,
      fileOps,
    );
    console.log(`Packaged dist/${name} (${bytes.length} bytes).`);
  } catch (error) {
    if (error instanceof PackagePublishRollbackError) {
      preserveTemporaryDirectory = true;
    }
    throw error;
  } finally {
    const absoluteTemporaryDirectory = resolve(temporaryDirectory);
    const temporaryRelativeToCwd = relative(
      resolve(cwd),
      absoluteTemporaryDirectory,
    );
    assert.equal(dirname(absoluteTemporaryDirectory), resolve(cwd));
    assert.ok(basename(absoluteTemporaryDirectory).startsWith(".package-"));
    assert.ok(
      temporaryRelativeToCwd.startsWith(".package-") &&
        !temporaryRelativeToCwd.startsWith(".."),
      "Package temporary directory must remain inside the project",
    );
    if (preserveTemporaryDirectory) {
      console.error(
        `Package recovery backups retained at ${absoluteTemporaryDirectory}`,
      );
    } else {
      await fileOps.rm(absoluteTemporaryDirectory, {
        recursive: true,
        force: true,
      });
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await packageRelease();
}
