import assert from "node:assert/strict";
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
import { createHash } from "node:crypto";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const owned = (file) =>
  /^(?:manifest\.json|background\.js|content\.js|gallery-offscreen\.(?:html|js)|popup\.html|manager\.html|(?:assets|icons)\/[^/]+)$/.test(
    file,
  );

function target(root, file) {
  assert.ok(owned(file), `Unexpected build output: ${file}`);
  const path = resolve(root, file);
  assert.ok(path.startsWith(root + sep), "Build target must stay in workspace");
  return path;
}

async function stagedFiles(staging, io) {
  const result = [];
  async function visit(directory) {
    for (const entry of await io.readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
    }
  }
  await visit(staging);
  return result.sort();
}

function safeTemporaryDirectory(path, root) {
  const absolute = resolve(path);
  const directoryName = basename(absolute);
  assert.ok(
    dirname(absolute) === root &&
      directoryName.startsWith(".publish-") &&
      relative(root, absolute) === directoryName,
    "Publish temporary directory must be inside the workspace",
  );
  return absolute;
}

export async function publishExtension({
  cwd = process.cwd(),
  io = {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    rmdir,
    unlink,
    writeFile,
  },
} = {}) {
  const root = resolve(cwd);
  const staging = resolve(root, "artifacts/unpacked");
  const receipt = resolve(root, "artifacts/root-install-manifest.json");

  // Keep the unpacked build layout consumable by verify-dist and packaging.
  for (const page of ["popup.html", "manager.html"]) {
    const source = resolve(staging, "entries", page);
    const html = (await io.readFile(source, "utf8")).replaceAll(
      "../assets/",
      "./assets/",
    );
    await io.writeFile(resolve(staging, page), html);
    await io.unlink(source);
  }
  await io.rmdir(resolve(staging, "entries"));

  // Build the complete next snapshot in memory before touching root files.
  const next = new Map();
  for (const source of await stagedFiles(staging, io)) {
    const file = relative(staging, source).replaceAll("\\", "/");
    const bytes = await io.readFile(source);
    target(root, file);
    next.set(file, { bytes, checksum: hash(bytes) });
  }

  let previous = {};
  try {
    previous = JSON.parse(await io.readFile(receipt, "utf8"));
    assert.ok(
      previous && typeof previous === "object" && !Array.isArray(previous),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const stale = [];
  for (const [file, checksum] of Object.entries(previous)) {
    if (next.has(file)) continue;
    const destination = target(root, file);
    try {
      const existing = await io.readFile(destination);
      assert.equal(
        hash(existing),
        checksum,
        `Modified generated file: ${file}`,
      );
      stale.push({ file, destination });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const temporaryDirectory = safeTemporaryDirectory(
    await io.mkdtemp(resolve(root, ".publish-")),
    root,
  );
  const snapshots = new Map();
  let hadReceipt = false;
  let preserveTemporaryDirectory = false;
  try {
    const destinations = [...next.keys(), ...stale.map(({ file }) => file)];
    for (const [index, file] of destinations.entries()) {
      const destination = target(root, file);
      try {
        const contents = await io.readFile(destination);
        const backup = resolve(temporaryDirectory, `original-${index}`);
        await io.writeFile(backup, contents);
        snapshots.set(destination, backup);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        snapshots.set(destination, null);
      }
    }
    try {
      const contents = await io.readFile(receipt);
      const backup = resolve(temporaryDirectory, "receipt.previous");
      await io.writeFile(backup, contents);
      hadReceipt = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      for (const [file, { bytes }] of next) {
        const destination = target(root, file);
        await io.mkdir(dirname(destination), { recursive: true });
        await io.writeFile(destination, bytes);
      }
      for (const { destination } of stale) await io.unlink(destination);
      await io.writeFile(
        receipt,
        JSON.stringify(
          Object.fromEntries(
            [...next].map(([file, value]) => [file, value.checksum]),
          ),
          null,
          2,
        ) + "\n",
      );
    } catch (error) {
      const rollbackErrors = [];
      for (const [destination, backup] of [...snapshots].reverse()) {
        try {
          if (backup === null)
            await io.unlink(destination).catch((e) => {
              if (e.code !== "ENOENT") throw e;
            });
          else {
            await io.mkdir(dirname(destination), { recursive: true });
            await io.copyFile(backup, destination);
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      try {
        if (hadReceipt)
          await io.copyFile(
            resolve(temporaryDirectory, "receipt.previous"),
            receipt,
          );
        else
          await io.unlink(receipt).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      if (rollbackErrors.length) {
        preserveTemporaryDirectory = true;
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Publish failed and rollback was incomplete. Backups retained at: ${temporaryDirectory}`,
        );
      }
      throw error;
    }
  } finally {
    const absoluteTemporaryDirectory = resolve(temporaryDirectory);
    assert.equal(dirname(absoluteTemporaryDirectory), root);
    assert.ok(basename(absoluteTemporaryDirectory).startsWith(".publish-"));
    assert.equal(
      relative(root, absoluteTemporaryDirectory),
      basename(absoluteTemporaryDirectory),
    );
    if (preserveTemporaryDirectory) {
      console.error(
        `Publish recovery backups retained at ${absoluteTemporaryDirectory}`,
      );
    } else {
      await io.rm(absoluteTemporaryDirectory, { recursive: true, force: true });
    }
  }
  console.log("Published unpacked extension at project root.");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await publishExtension();
}
