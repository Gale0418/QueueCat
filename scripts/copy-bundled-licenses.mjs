import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dependencies = [
  { name: "parse5", version: "7.3.0" },
  { name: "entities", version: "6.0.1" },
];
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function* bundledLicenses() {
  for (const dependency of dependencies) {
    const packageRoot = resolve(projectRoot, "node_modules", dependency.name);
    const metadata = JSON.parse(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
    );
    assert.equal(
      metadata.version,
      dependency.version,
      `${dependency.name} bundled version changed; review its license entry`,
    );
    yield {
      path: `assets/${dependency.name}-${dependency.version}-LICENSE.txt`,
      bytes: await readFile(resolve(packageRoot, "LICENSE")),
    };
  }
}

export async function copyBundledLicenses({ cwd = process.cwd() } = {}) {
  const output = resolve(cwd, "artifacts/unpacked");
  await mkdir(resolve(output, "assets"), { recursive: true });
  for await (const license of bundledLicenses()) {
    await writeFile(resolve(output, license.path), license.bytes);
  }
}
