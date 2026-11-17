import { describe, expect, it } from "vitest";
import type { GallerySource } from "../src/shared/gallery-sources";
import type { GalleryHttp } from "../src/background/gallery-site-http";
import { mangaAdapters } from "../src/background/manga-sites";

function httpFixture(responses: Record<string, string | unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const http: GalleryHttp = {
    async text(url, init) {
      calls.push({ url, init });
      const value = responses[url];
      if (typeof value !== "string") throw new Error(`No HTML fixture for ${url}`);
      return value;
    },
    async json(url, init) {
      calls.push({ url, init });
      const value = responses[url];
      if (value === undefined) throw new Error(`No JSON fixture for ${url}`);
      return typeof value === "string" ? JSON.parse(value) as unknown : value;
    },
  };
  return { http, calls };
}

function foxDetail(id: string): string {
  return `<input id="gallery_id" value="${id}"><input id="gallery_title" value="Synthetic Fox"><a class="g_button" href="/g/${id}/1/">reader</a>`;
}

function foxReader({
  id,
  imageDir = "005",
  galleryId = "12345",
  pages,
  map,
}: {
  id: string;
  imageDir?: string;
  galleryId?: string;
  pages: number;
  map: Record<string, string>;
}): string {
  const json = JSON.stringify(map);
  return `<input id="unique_id" value="${id}"><input id="image_dir" value="${imageDir}"><input id="gallery_id" value="${galleryId}"><input id="pages" value="${pages}"><script>var g_th = $.parseJSON('${json}');</script>`;
}

const foxSource: GallerySource = {
  site: "hentaifox",
  id: "177246",
  url: "https://hentaifox.com/gallery/177246/",
};
const foxReaderUrl = "https://hentaifox.com/g/177246/1/";

describe("HentaiFox resolver", () => {
  it("parses one reader map into ordered direct media URLs without requesting images", async () => {
    const { http, calls } = httpFixture({
      [foxSource.url]: foxDetail("177246"),
      [foxReaderUrl]: foxReader({
        id: "177246",
        pages: 3,
        map: { "1": "w,1133,1611", "2": "p,1133,1611", "3": "j,1280,1807" },
      }),
    });
    await expect(mangaAdapters.hentaifox.load(foxSource, http)).resolves.toEqual({
      title: "Synthetic Fox",
      pages: [
        "https://i3.hentaifox.com/005/12345/1.webp",
        "https://i3.hentaifox.com/005/12345/2.png",
        "https://i3.hentaifox.com/005/12345/3.jpg",
      ],
    });
    expect(calls.map((call) => call.url)).toEqual([foxSource.url, foxReaderUrl]);
    expect(calls.every((call) => call.init?.credentials === "omit" && call.init.redirect === "error")).toBe(true);
  });

  it("selects the legacy deterministic host and rejects a partial or malformed page map", async () => {
    const legacySource: GallerySource = { ...foxSource, id: "100000", url: "https://hentaifox.com/gallery/100000/" };
    const legacyReader = "https://hentaifox.com/g/100000/1/";
    const legacy = httpFixture({
      [legacySource.url]: foxDetail("100000"),
      [legacyReader]: foxReader({ id: "100000", pages: 1, map: { "1": "g,600,800" } }),
    });
    await expect(mangaAdapters.hentaifox.load(legacySource, legacy.http)).resolves.toMatchObject({
      pages: ["https://i.hentaifox.com/005/12345/1.gif"],
    });

    const partial = httpFixture({
      [foxSource.url]: foxDetail("177246"),
      [foxReaderUrl]: foxReader({ id: "177246", pages: 2, map: { "1": "j,600,800" } }),
    });
    await expect(mangaAdapters.hentaifox.load(foxSource, partial.http)).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
    const malformed = httpFixture({
      [foxSource.url]: foxDetail("177246"),
      [foxReaderUrl]: `<input id="unique_id" value="177246"><input id="image_dir" value="005"><input id="gallery_id" value="12345"><input id="pages" value="1"><script>var g_th = window.payload;</script>`,
    });
    await expect(mangaAdapters.hentaifox.load(foxSource, malformed.http)).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
  });

  it("rejects source ID mismatch, unsafe paths, and unsupported BMP pages", async () => {
    const wrongId = httpFixture({
      [foxSource.url]: foxDetail("42"),
    });
    await expect(mangaAdapters.hentaifox.load(foxSource, wrongId.http)).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
    const unsafePath = httpFixture({
      [foxSource.url]: foxDetail("177246"),
      [foxReaderUrl]: foxReader({ id: "177246", imageDir: "../x", pages: 1, map: { "1": "j,600,800" } }),
    });
    await expect(mangaAdapters.hentaifox.load(foxSource, unsafePath.http)).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
    const bmp = httpFixture({
      [foxSource.url]: foxDetail("177246"),
      [foxReaderUrl]: foxReader({ id: "177246", pages: 1, map: { "1": "b,600,800" } }),
    });
    await expect(mangaAdapters.hentaifox.load(foxSource, bmp.http)).rejects.toMatchObject({
      code: "gallery_unsupported_media",
    });
  });
});
