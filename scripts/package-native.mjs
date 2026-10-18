import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  compressArchive,
  validateArchive,
  publishFiles,
  PackagePublishRollbackError,
} from "./package.mjs";

// Pinned, unmodified upstream files. No system installer is executed.
const release = "https://github.com/ip7z/7zip/releases/download/26.04/";
const downloads = {
  "7zr.exe": "256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282",
  "7z2604-x64.exe":
    "d54bf805f9f3704d1e8db2fa3498ae7ef2df0312b40b558e7c71c734430a665d",
  "7z2604-src.tar.xz":
    "9691944c0fe0d01bb49373a704fb983fd33bc98b1738695179dfbf99ac1734f6",
};
if (process.platform !== "win32" || process.arch !== "x64")
  throw Error("Native package currently targets Windows x64.");
const root = process.cwd(),
  cache = path.join(root, "artifacts/extraction-engine");
await fs.mkdir(cache, { recursive: true });
for (const [name, expected] of Object.entries(downloads)) {
  const file = path.join(cache, name);
  let data;
  try {
    data = await fs.readFile(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(release + name);
    if (!response.ok)
      throw Error(`Official engine download failed: ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(data).digest("hex") !== expected)
    throw Error(`Engine hash mismatch: ${name}`);
  await fs.writeFile(file, data);
}
const work = await fs.mkdtemp(path.join(root, "artifacts/native-package-"));
let preserveWork = false;
try {
  const unpacked = path.join(work, "upstream"),
    stage = path.join(work, "bundle");
  execFileSync(
    path.join(cache, "7zr.exe"),
    ["x", path.join(cache, "7z2604-x64.exe"), `-o${unpacked}`, "-y"],
    { windowsHide: true, stdio: "ignore" },
  );
  execFileSync(
    "cargo",
    ["build", "--release", "--locked", "--manifest-path", "native/Cargo.toml"],
    {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        RUSTFLAGS:
          `${process.env.RUSTFLAGS || ""} -C target-feature=+crt-static`.trim(),
      },
    },
  );
  await fs.mkdir(path.join(stage, "engine"), { recursive: true });
  for (const file of ["7z.exe", "7z.dll", "License.txt"])
    await fs.copyFile(
      path.join(unpacked, file),
      path.join(stage, "engine", file),
    );
  // Ship corresponding upstream source and notices along with unmodified binaries.
  await fs.copyFile(
    path.join(cache, "7z2604-src.tar.xz"),
    path.join(stage, "engine/7z2604-src.tar.xz"),
  );
  await fs.writeFile(
    path.join(stage, "engine/SOURCE.json"),
    JSON.stringify(
      { version: "26.04", release, downloads, modified: false },
      null,
      2,
    ),
  );
  await fs.copyFile(
    path.join(root, "native/target/release/queuecat-native-helper.exe"),
    path.join(stage, "queuecat-native-helper.exe"),
  );
  for (const name of [
    "install-native-helper.ps1",
    "uninstall-native-helper.ps1",
  ])
    await fs.copyFile(path.join(root, "scripts", name), path.join(stage, name));
  await fs.copyFile(
    path.join(root, "native/README.md"),
    path.join(stage, "README.md"),
  );
  await fs.writeFile(
    path.join(stage, "Install-QueueCat.ps1"),
    `$ErrorActionPreference = 'Stop'\n$extensionId = Read-Host 'Extension ID'\n& (Join-Path $PSScriptRoot 'install-native-helper.ps1') -ExtensionId $extensionId -HelperExePath (Join-Path $PSScriptRoot 'queuecat-native-helper.exe')\n`,
  );
  await fs.writeFile(
    path.join(stage, "Install-QueueCat.cmd"),
    '@echo off\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-QueueCat.ps1"\r\npause\r\n',
  );
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--manifest-path",
        "native/Cargo.toml",
        "--format-version",
        "1",
        "--locked",
      ],
      { cwd: root, encoding: "utf8", windowsHide: true },
    ),
  );
  const notices = [];
  for (const pkg of metadata.packages.filter((p) => p.source)) {
    const source = path.dirname(pkg.manifest_path);
    const destination = path.join(
      stage,
      "THIRD-PARTY",
      `${pkg.name}-${pkg.version}`,
    );
    await fs.mkdir(destination, { recursive: true });
    const files = (await fs.readdir(source)).filter((name) =>
      /^(LICENSE|COPYING|NOTICE)/i.test(name),
    );
    if (!files.length) throw Error(`Missing dependency notice: ${pkg.name}`);
    for (const file of files)
      if ((await fs.stat(path.join(source, file))).isFile())
        await fs.copyFile(
          path.join(source, file),
          path.join(destination, file),
        );
    notices.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      repository: pkg.repository,
    });
  }
  await fs.writeFile(
    path.join(stage, "THIRD-PARTY/dependencies.json"),
    JSON.stringify(notices, null, 2),
  );
  const name = "QueueCat-Helper-0.1.0-windows-x64.zip",
    archive = path.join(work, name);
  compressArchive(stage, archive);
  await validateArchive(archive, work);
  const bytes = await fs.readFile(archive),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const dist = path.join(root, "dist");
  await fs.mkdir(dist, { recursive: true });
  const updates = [
    [archive, path.join(dist, name)],
    [path.join(work, "checksum"), path.join(dist, name + ".sha256")],
  ];
  await fs.writeFile(updates[1][0], `${sha256}  ${name}\n`);
  try {
    await publishFiles(
      updates.map(([source, destination]) => ({ source, destination })),
      work,
      fs,
    );
  } catch (error) {
    if (error instanceof PackagePublishRollbackError) preserveWork = true;
    throw error;
  }
  await fs.writeFile(
    path.join(root, "artifacts/native-package-report.json"),
    JSON.stringify(
      {
        name,
        bytes: bytes.length,
        sha256,
        engine: "7-Zip 26.04",
        systemInstalled: false,
        registered: false,
        staticCrt: true,
        dependencyNotices: notices.length,
      },
      null,
      2,
    ),
  );
  console.log(
    `Packaged ${name} (${bytes.length} bytes). No native host registered.`,
  );
} finally {
  // This exact temporary path was freshly created underneath artifacts.
  if (
    path.dirname(work) !== path.join(root, "artifacts") ||
    !path.basename(work).startsWith("native-package-")
  )
    throw Error("Invalid native package cleanup path");
  if (preserveWork)
    console.error(`Native package recovery backups retained: ${work}`);
  else await fs.rm(work, { recursive: true, force: true });
}
