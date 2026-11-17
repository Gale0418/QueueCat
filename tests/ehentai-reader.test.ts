import { describe, expect, it } from "vitest";
import type { GallerySource } from "../src/shared/gallery-sources";
import type { GalleryHttp } from "../src/background/gallery-site-http";
import {
  isEhentaiReaderPage,
  loadEhentaiReader,
  resolveEhentaiReaderImage,
  resolveEhentaiReaderRoute,
} from "../src/background/ehentai-reader";

const source: GallerySource = {
  site: "ehentai",
  id: "3810755",
  url: "https://e-hentai.org/g/3810755/44e695d62c/",
};
const thirdPage = "https://e-hentai.org/s/c4d3d9f8c9/3810755-3";

function listing(start: number, end: number, total = end): string {
  const entries = Array.from({ length: end - start + 1 }, (_, index) => {
    const number = start + index;
    const key =
      number === 3 ? "c4d3d9f8c9" : number.toString(16).padStart(10, "0");
    const name =
      number === 1
        ? "top.jpg"
        : number === 2
          ? "122549.jpg"
          : number === 3
            ? "ev01_01.png"
            : `scan_${number}.png`;
    return `<a href="https://e-hentai.org/s/${key}/3810755-${number}"><div title="Page ${number}: ${name}"></div></a>`;
  }).join("");
  return `<h1 id="gn">Synthetic gallery</h1><p class="gpc">Showing ${start} - ${end} of ${total.toLocaleString("en-US")} images</p><div id="gdt">${entries}</div>`;
}

function httpFixture(responses: Record<string, string>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const http: GalleryHttp = {
    async text(url, init) {
      calls.push({ url, init });
      const response = responses[url];
      if (response === undefined) throw new Error(`No HTML fixture for ${url}`);
      return response;
    },
    async json() {
      throw new Error("JSON is not used by the E-Hentai reader");
    },
  };
  return { http, calls };
}

describe("E-Hentai 訪客閱讀頁", () => {
  it("依合法 ?p 分頁收齊連續頁碼與原始檔名", async () => {
    const firstUrl = source.url;
    const secondUrl = `${source.url}?p=1`;
    const { http, calls } = httpFixture({
      [firstUrl]: listing(1, 20, 21),
      [secondUrl]: listing(21, 21, 21),
    });
    const result = await loadEhentaiReader(source, http);
    expect(result.title).toBe("Synthetic gallery");
    expect(result.pages).toHaveLength(21);
    expect(result.pages.slice(0, 3)).toEqual([
      { url: "https://e-hentai.org/s/0000000001/3810755-1", name: "top.jpg" },
      {
        url: "https://e-hentai.org/s/0000000002/3810755-2",
        name: "122549.jpg",
      },
      { url: thirdPage, name: "ev01_01.png" },
    ]);
    expect(calls.map(({ url }) => url)).toEqual([firstUrl, secondUrl]);
    expect(
      calls.every(
        ({ init }) => init?.credentials === "omit" && init.redirect === "error",
      ),
    ).toBe(true);
  });

  it("解析匿名讀圖當下 #img src（含 8443 port），不呼叫 fullimg", async () => {
    const imageUrl =
      "https://ztpnnkq.uffrxbpwqjto.hath.network:8443/h/opaque-1/opaque-2/ev01_01.webp";
    const { http, calls } = httpFixture({
      [thirdPage]: `<div id="i1"><div id="i2"><div><span>3</span> / <span>1408</span></div><div>ev01_01.png :: 1280 x 1447 :: 136.2 KiB</div></div><div id="i3"><img id="img" src="${imageUrl}"></div></div>`,
    });
    expect(isEhentaiReaderPage(source, thirdPage)).toBe(true);
    await expect(
      resolveEhentaiReaderImage(source, thirdPage, http),
    ).resolves.toBe(imageUrl);
    expect(calls.map(({ url }) => url)).toEqual([thirdPage]);
  });

  it("僅接受來源相同 gid 的讀圖頁與有效頁序", () => {
    for (const invalid of [
      undefined,
      "https://e-hentai.org/s/c4d3d9f8c9/42-3",
      "https://e-hentai.org/s/c4d3d9f8c9/3810755-3?x=1",
      "https://e-hentai.org/s/c4d3d9f8c9/3810755-0",
      "https://e-hentai.org/s/c4d3d9f8c9/3810755-3/",
      "https://attacker.invalid/s/c4d3d9f8c9/3810755-3",
    ])
      expect(isEhentaiReaderPage(source, invalid)).toBe(false);
  });

  it("讀取同一頁的公開重載連結，接受站方 /om/ 圖片", async () => {
    const peer = "https://a.b.hath.network/h/a/b/ev01_01.webp";
    const origin = "https://a.hath.network/om/12345678/a-b/c-d/800/e1f2/ev01_01.webp";
    const html = (page: number, image: string, button = "") =>
      `<div id="i1"><div id="i2">${page} / 1408</div><img id="img" src="${image}">${button}</div>`;
    const button = `<a id="loadfail" href="#" onclick="return nl('12345-498456')">Reload</a>`;
    const reloadUrl = `${thirdPage}?nl=12345-498456`;
    const fixture = httpFixture({
      [thirdPage]: html(3, peer, button),
      [reloadUrl]: html(3, origin),
    });
    const route = await resolveEhentaiReaderRoute(source, thirdPage, fixture.http);
    expect(route.url).toBe(peer);
    expect(fixture.calls.map(({ url }) => url)).toEqual([thirdPage]);
    await expect(route.retry?.()).resolves.toBe(origin);
    expect(fixture.calls.map(({ url }) => url)).toEqual([thirdPage, reloadUrl]);
    expect(fixture.calls[1].init?.credentials).toBe("omit");

    const wrongPage = httpFixture({
      [thirdPage]: html(3, peer, button),
      [reloadUrl]: html(4, origin),
    });
    const rejected = await resolveEhentaiReaderRoute(source, thirdPage, wrongPage.http);
    await expect(rejected.retry?.()).rejects.toMatchObject({ code: "gallery_invalid_metadata" });
  });

  it("拒絕未收齊頁面、跨畫廊頁面及來源不一致", async () => {
    const incompleteListing = listing(1, 20, 21).replace(
      /<a href="[^"]+"><div title="Page 20:[\s\S]*?<\/a>/,
      "",
    );
    const partial = httpFixture({ [source.url]: incompleteListing });
    await expect(loadEhentaiReader(source, partial.http)).rejects.toMatchObject(
      { code: "gallery_invalid_metadata" },
    );

    const wrongGallery = listing(1, 1, 1).replace("3810755-1", "42-1");
    const mismatch = httpFixture({ [source.url]: wrongGallery });
    await expect(
      loadEhentaiReader(source, mismatch.http),
    ).rejects.toMatchObject({ code: "gallery_invalid_metadata" });
  });

  it("將匿名 HTTP 200 的 quota/block 頁歸類為可恢復狀態", async () => {
    const limited = httpFixture({
      [source.url]: "<html><body>509 Bandwidth Limit Exceeded</body></html>",
    });
    await expect(loadEhentaiReader(source, limited.http)).rejects.toMatchObject(
      { code: "gallery_rate_limited" },
    );
    const blocked = httpFixture({
      [thirdPage]: "<html><body>Please log in to view this page</body></html>",
    });
    await expect(
      resolveEhentaiReaderImage(source, thirdPage, blocked.http),
    ).rejects.toMatchObject({ code: "gallery_access_required" });
    const placeholder = httpFixture({
      [thirdPage]: '<div id="i1">Error loading image: Could not get dispatch for image</div>',
    });
    await expect(
      resolveEhentaiReaderImage(source, thirdPage, placeholder.http),
    ).rejects.toMatchObject({ code: "gallery_rate_limited" });
  });

  it("辨識站方內容警告並停下，不開啟警告頁的任何連結", async () => {
    const warning = `<div><h1>Content Warning</h1><p>This gallery has been flagged as <strong>Offensive For Everyone</strong>.</p>
      <a href="${source.url}?nw=session">View Gallery</a>
      <a href="${source.url}?nw=always">Never Warn Me Again</a></div>`;
    const fixture = httpFixture({ [source.url]: warning, [thirdPage]: warning });
    await expect(loadEhentaiReader(source, fixture.http)).rejects.toMatchObject({
      code: "gallery_content_warning",
    });
    await expect(resolveEhentaiReaderImage(source, thirdPage, fixture.http)).rejects.toMatchObject({
      code: "gallery_content_warning",
    });
    expect(fixture.calls.map(({ url }) => url)).toEqual([source.url, thirdPage]);
  });

  it("拒絕不安全 reader src 與沒有圖像的占位頁", async () => {
    for (const src of [
      "http://image.hath.network/h/a/b/page.webp",
      "https://attacker.invalid/h/a/b/page.webp",
      "https://a.b.hath.network/h/a/b/page.webp?x=1",
    ]) {
      const fixture = httpFixture({
        [thirdPage]: `<div id="i1"><div id="i2"><span>3</span> / <span>1408</span></div><div id="i3"><img id="img" src="${src}"></div></div>`,
      });
      await expect(
        resolveEhentaiReaderImage(source, thirdPage, fixture.http),
      ).rejects.toMatchObject({ code: "gallery_invalid_metadata" });
    }
  });
});
