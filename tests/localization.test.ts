// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { copyEntries } from "../src/shared/copy";
import { setMessageLanguage, translateMessage } from "../src/shared/messages";
import { translateInterface } from "../src/ui/localization";
import { getLocale } from "../src/shared/locales";

afterEach(() => setMessageLanguage("system"));

it("keeps every authored locale complete and preserves all template placeholders", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(p\d+)\}/g)].map((match) => match[1]).sort();
  expect(copyEntries.length).toBeGreaterThan(180);
  for (const entry of copyEntries) {
    for (const field of ["en", "zhTW", "ja"] as const) {
      expect(entry[field].trim(), `${entry.id}.${field}`).not.toBe("");
      expect(placeholders(entry[field]), `${entry.id}.${field}`).toEqual(
        placeholders(entry.source),
      );
    }
  }
  setMessageLanguage("en");
  expect(translateMessage("加入 1 個下載")).toBe(
    getLocale("en").confirmAddWithCount(1),
  );
  expect(translateMessage("加入 2 個下載")).toBe(
    getLocale("en").confirmAddWithCount(2),
  );
});

it("translates owned nodes and labels while preserving raw filenames, links, form values and focus", () => {
  document.body.innerHTML =
    '<main><h2>下載佇列</h2><button aria-label="往前移">往前移</button><strong data-raw title="下載佇列">下載佇列</strong><a data-raw href="https://katfile.biz/abcdefghijkl/下載佇列.zip.html">下載佇列</a><textarea id="input">下載佇列</textarea><details open><summary>更順手的小技巧</summary></details></main>';
  const main = document.querySelector("main")!;
  const input = document.querySelector<HTMLTextAreaElement>("#input")!;
  input.value = "https://katfile.biz/abcdefghijkl/私人檔名.zip.html";
  input.focus();
  for (const locale of ["en", "ja", "zh-TW", "en"] as const) {
    setMessageLanguage(locale);
    translateInterface(main);
    expect(main.querySelector("h2")!.textContent).toBe(
      getLocale(locale).navQueue,
    );
    expect(main.querySelector("button")!.getAttribute("aria-label")).toBe(
      getLocale(locale).actionMoveUpAria,
    );
    expect(main.querySelector("strong")!.textContent).toBe("下載佇列");
    expect(main.querySelector("strong")!.title).toBe("下載佇列");
    expect(main.querySelector("a")!.textContent).toBe("下載佇列");
    expect(input.value).toContain("私人檔名");
    expect(document.activeElement).toBe(input);
    expect(main.querySelector("details")!.open).toBe(true);
  }
});
