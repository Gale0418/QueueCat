// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  normalizeEhentaiImportEntries,
  readVisibleEhentaiWorks,
} from "../src/ui/ehentai-import";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("extracts only visible works from the current E-Hentai tag listing", () => {
  vi.stubGlobal("location", new URL("https://e-hentai.org/tag/artist%3Atest"));
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      return (this.closest('tr[style*="display:none"]') ? [] : [{}]) as unknown as DOMRectList;
    },
  );
  document.body.innerHTML = `
    <table class="itg">
      <tr><td><a href="https://e-hentai.org/g/42/0123456789/"><div class="glink">作品 標題</div></a></td></tr>
      <tr style="display:none"><td><a href="https://e-hentai.org/g/43/0123456789/"><div class="glink">隱藏作品</div></a></td></tr>
      <tr><td><a href="https://e-hentai.org/g/44/0123456789/"><div class="glink">其他作品</div></a></td></tr>
    </table>`;

  expect(readVisibleEhentaiWorks()).toEqual([
    {
      url: "https://e-hentai.org/g/42/0123456789/",
      title: "作品 標題",
    },
    {
      url: "https://e-hentai.org/g/44/0123456789/",
      title: "其他作品",
    },
  ]);
});

it("rejects injection on a different host or a non-tag path", () => {
  document.body.innerHTML = `<table class="itg"><tr><td><a href="https://e-hentai.org/g/42/0123456789/"><div class="glink">作品</div></a></td></tr></table>`;
  vi.stubGlobal("location", new URL("https://exhentai.org/tag/example"));
  expect(readVisibleEhentaiWorks()).toEqual([]);

  vi.stubGlobal("location", new URL("https://e-hentai.org/g/42/0123456789/"));
  expect(readVisibleEhentaiWorks()).toEqual([]);
});

it("canonicalizes entries and deduplicates by E-Hentai gallery ID", () => {
  expect(
    normalizeEhentaiImportEntries(
      [
        {
          url: "https://e-hentai.org/g/42/0123456789/?p=2",
          title: "  Original   title ",
        },
        {
          url: "https://e-hentai.org/g/42/abcdef0123/",
          title: "same gallery, different token",
        },
        {
          url: "https://nhentai.net/g/42/",
          title: "wrong source",
        },
        {
          url: "https://e-hentai.org/g/43/0123456789/",
          title: "Another title",
        },
      ],
      ["https://e-hentai.org/g/44/0123456789/"],
    ),
  ).toEqual([
    {
      url: "https://e-hentai.org/g/42/0123456789/",
      title: "Original title",
    },
    {
      url: "https://e-hentai.org/g/43/0123456789/",
      title: "Another title",
    },
  ]);
});
