import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "./",
  test: { include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"] },
  build: {
    outDir: "artifacts/unpacked",
    emptyOutDir: true,
    rollupOptions: {
      input: { manager: "entries/manager.html", popup: "entries/popup.html" },
    },
  },
});
