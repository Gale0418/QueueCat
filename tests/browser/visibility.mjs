import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "playwright-module": { type: "string" },
    "browser-cache": { type: "string" },
    label: { type: "string", default: "after" },
  },
});
if (values["browser-cache"])
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(values["browser-cache"]);

const { chromium } = await import(
  values["playwright-module"]
    ? pathToFileURL(resolve(values["playwright-module"])).href
    : "playwright"
);

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const label = values.label;
assert.match(label, /^[a-z0-9-]+$/i);
const pageUrl = "https://katfile.biz/ntrr1zdzt6i0/66-RJ01681172.rar.html";
const cases = {
  rendered: `<form><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"><button id="fbtn1">SLOW SPEED DOWNLOAD</button></form>`,
  contentVisibilityHidden: `<form style="content-visibility:hidden"><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"><button id="fbtn1">SLOW SPEED DOWNLOAD</button></form>`,
  closedDetailsChild: `<form><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"><details><summary>Details</summary><button id="fbtn1">SLOW SPEED DOWNLOAD</button></details></form>`,
  closedDetailsSummary: `<form><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"><details><summary><button id="fbtn1">SLOW SPEED DOWNLOAD</button></summary><p>More</p></details></form>`,
  openDetailsChild: `<form><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"><details open><summary>Details</summary><button id="fbtn1">SLOW SPEED DOWNLOAD</button></details></form>`,
};

const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["src/content/katfile.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "KatfileAdapter",
  platform: "browser",
  target: "chrome120",
});
const browser = await chromium.launch({
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = {};
  for (const [name, html] of Object.entries(cases)) {
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
    const measured = await page.evaluate(
      ({ pageUrl }) => {
        const button = document.querySelector("button");
        let clicks = 0;
        button?.addEventListener("click", (event) => {
          event.preventDefault();
          clicks++;
        });
        const style = button ? getComputedStyle(button) : null;
        const rendered =
          button?.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) ?? false;
        const observation = window.KatfileAdapter.inspectPage(
          document,
          pageUrl,
        );
        const action = window.KatfileAdapter.performFreeAction(
          document,
          pageUrl,
        );
        return {
          rendered,
          computedContentVisibility: style?.contentVisibility ?? null,
          kind: observation.kind,
          step: observation.step ?? null,
          actionOk: action.ok,
          clicks,
        };
      },
      { pageUrl },
    );
    results[name] = measured;
  }
  assert.equal(results.rendered.kind, "free");
  assert.equal(results.rendered.clicks, 1);
  for (const name of ["contentVisibilityHidden", "closedDetailsChild"]) {
    assert.equal(results[name].rendered, false, `${name} should not render`);
    assert.equal(results[name].kind, "unknown", `${name} should be rejected`);
    assert.equal(results[name].actionOk, false, `${name} action should fail`);
    assert.equal(results[name].clicks, 0, `${name} must not click`);
  }
  for (const name of ["closedDetailsSummary", "openDetailsChild"]) {
    assert.equal(results[name].rendered, true, `${name} should render`);
    assert.equal(results[name].kind, "free", `${name} should stay usable`);
    assert.equal(results[name].actionOk, true, `${name} action should work`);
    assert.equal(results[name].clicks, 1, `${name} should click once`);
  }
  const evidence = {
    runLabel: label,
    chromiumVersion: browser.version(),
    headless: true,
    browserOwned: true,
    source: "current workspace src/content/katfile.ts",
    results,
  };
  await writeFile(
    resolve(root, `artifacts/visibility-${label}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await browser.close();
}
