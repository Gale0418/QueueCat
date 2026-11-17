import type { GallerySource } from "../shared/gallery-sources";
import {
  attribute,
  elementText,
  gallerySiteError,
  htmlElements,
  type GalleryHttp,
  type GallerySiteAdapter,
} from "./gallery-site-http";

const MAX_PAGES = 2_000;

type HtmlElement = ReturnType<typeof htmlElements>[number];

function fail(code = "gallery_invalid_metadata"): never {
  throw gallerySiteError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanTitle(value: unknown): string {
  const title = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (!title || title.length > 300) return fail();
  return title;
}

function pageCount(value: unknown): number {
  const count = typeof value === "number" ? value : typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PAGES) return fail();
  return count;
}

function sourceUrl(source: GallerySource, origin: string, path: RegExp): URL {
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return fail();
  }
  if (source.id === "" || url.origin !== origin || !path.test(url.pathname) || url.username || url.password || url.port) return fail();
  return url;
}

function hasClass(el: HtmlElement, name: string): boolean {
  return (attribute(el, "class") || "").split(/\s+/).includes(name);
}

function findId(elements: HtmlElement[], id: string): HtmlElement | undefined {
  return elements.find((el) => attribute(el, "id") === id);
}

function inputValue(elements: HtmlElement[], id: string): string | undefined {
  const el = findId(elements, id);
  return el?.tagName === "input" ? attribute(el, "value") : undefined;
}

function safeGet(): RequestInit {
  return { method: "GET", credentials: "omit", redirect: "error", cache: "no-store" };
}

function foxImageHost(uniqueId: number): string {
  // The public reader.min.js selects i3 for new galleries; older galleries use
  // i/i2 interchangeably. Pick i deterministically instead of randomizing hosts.
  return uniqueId > 140_236 ? "i3.hentaifox.com" : "i.hentaifox.com";
}

function parseFoxPageMap(html: string, expectedCount: number): Map<number, string> {
  const script = htmlElements(html)
    .filter((el) => el.tagName === "script")
    .map(elementText)
    .find((text) => /\bvar\s+g_th\s*=/.test(text));
  if (!script) return fail();
  // reader.min.js assigns g_th via $.parseJSON(<JSON string>). Parse only the
  // embedded JSON literal; never execute the page's script.
  const match = /\bvar\s+g_th\s*=\s*\$\.parseJSON\(\s*(['"])(\{[\s\S]*?\})\1\s*\)\s*;/.exec(script);
  if (!match) return fail();
  let value: unknown;
  try {
    value = JSON.parse(match[2]) as unknown;
  } catch {
    return fail();
  }
  if (!isRecord(value)) return fail();
  const pages = new Map<number, string>();
  for (const [key, detail] of Object.entries(value)) {
    if (!/^[1-9]\d{0,4}$/.test(key) || typeof detail !== "string") return fail();
    const number = Number(key);
    const extensionCode = detail.split(",", 1)[0];
    const extension: Record<string, string> = { j: "jpg", p: "png", b: "bmp", g: "gif", w: "webp" };
    if (!extension[extensionCode]) return fail();
    if (extensionCode === "b") return fail("gallery_unsupported_media");
    pages.set(number, extension[extensionCode]);
  }
  if (pages.size !== expectedCount || Array.from({ length: expectedCount }, (_, index) => index + 1).some((number) => !pages.has(number))) return fail();
  return pages;
}

function foxImageUrl(raw: string, uniqueId: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return fail(); }
  if (url.protocol !== "https:" || url.hostname !== foxImageHost(Number(uniqueId)) || !/^\/\d{1,4}\/\d{1,12}\/\d{1,5}\.(?:jpe?g|png|bmp|gif|webp)$/i.test(url.pathname) || url.username || url.password || url.port || url.search || url.hash) return fail();
  return url.href;
}

const hentaifox: GallerySiteAdapter = {
  async load(source, http) {
    const detailUrl = sourceUrl(source, "https://hentaifox.com", new RegExp(`^/gallery/${source.id}/?$`));
    const detail = await http.text(detailUrl.href, safeGet());
    const detailElements = htmlElements(detail);
    if (inputValue(detailElements, "gallery_id") !== source.id) return fail();
    const title = cleanTitle(inputValue(detailElements, "gallery_title"));
    const readerLink = detailElements.find((el) => el.tagName === "a" && hasClass(el, "g_button"));
    const rawReader = readerLink && attribute(readerLink, "href");
    if (!rawReader) return fail();
    let readerUrl: URL;
    try { readerUrl = new URL(rawReader, detailUrl.href); } catch { return fail(); }
    if (readerUrl.origin !== "https://hentaifox.com" || readerUrl.username || readerUrl.password || readerUrl.port || readerUrl.hash || readerUrl.pathname !== `/g/${source.id}/1/`) return fail();

    // The public reader page supplies the complete ordered g_th map and the
    // directory/media IDs used by reader.min.js to construct each image URL.
    const reader = await http.text(readerUrl.href, safeGet());
    const readerElements = htmlElements(reader);
    const uniqueId = inputValue(readerElements, "unique_id");
    const imageDir = inputValue(readerElements, "image_dir");
    const galleryId = inputValue(readerElements, "gallery_id");
    if (uniqueId !== source.id || !imageDir || !/^\d{1,4}$/.test(imageDir) || !galleryId || !/^[1-9]\d{0,11}$/.test(galleryId)) return fail();
    const count = pageCount(inputValue(readerElements, "pages"));
    const pageMap = parseFoxPageMap(reader, count);
    const host = foxImageHost(Number(uniqueId));
    const pages = [...pageMap.entries()].sort(([a], [b]) => a - b).map(([number, extension]) => {
      const url = `https://${host}/${imageDir}/${galleryId}/${number}.${extension}`;
      return foxImageUrl(url, uniqueId);
    });
    return { title, pages };
  },
};

export const mangaAdapters: Record<"hentaifox", GallerySiteAdapter> = {
  hentaifox,
};
