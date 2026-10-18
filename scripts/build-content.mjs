import { build } from "esbuild";
await build({
  entryPoints: ["src/content/index.ts"],
  bundle: true,
  outfile: "artifacts/unpacked/content.js",
  target: "chrome120",
  format: "iife",
});
await build({
  entryPoints: ["src/background/index.ts"],
  bundle: true,
  outfile: "artifacts/unpacked/background.js",
  target: "chrome120",
  format: "esm",
});
