import {
  isGalleryMediaUrl,
  type GallerySource,
} from "../shared/gallery-sources";
import type { GalleryImageRoute } from "../shared/types";
import {
  attribute,
  elementText,
  gallerySiteError,
  htmlElements,
  type GalleryHttp,
} from "./gallery-site-http";

const MAX_PAGES = 2_000;
const MAX_TITLE_LENGTH = 300;
const ID_PATTERN = /^[1-9]\d{0,9}$/;
const PAGE_URL_PATTERN = /^\/s\/([a-f\d]{10})\/([1-9]\d{0,9})-([1-9]\d{0,4})$/i;
const GALLERY_URL_PATTERN = /^\/g\/([1-9]\d{0,9})\/([a-f\d]{10})\/?$/i;

type HtmlElement = ReturnType<typeof htmlElements>[number];

function fail(code = "gallery_invalid_metadata"): never {
  throw gallerySiteError(code);
}

function hasClass(element: HtmlElement, name: string): boolean {
  return (attribute(element, "class") || "").split(/\s+/).includes(name);
}

function descendants(root: HtmlElement): HtmlElement[] {
  const found: HtmlElement[] = [];
  const pending = [...root.childNodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (!("tagName" in node)) continue;
    found.push(node);
    const children = node.childNodes;
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push(children[index]);
    }
  }
  return found;
}

function checkSource(source: GallerySource): URL {
  if (source?.site !== "ehentai" || !ID_PATTERN.test(source.id)) return fail();
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return fail();
  }
  const match = GALLERY_URL_PATTERN.exec(url.pathname);
  if (
    url.origin !== "https://e-hentai.org" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !match ||
    match[1] !== source.id
  )
    return fail();
  return url;
}

function pageRange(elements: HtmlElement[]): {
  start: number;
  end: number;
  total: number;
} {
  const info = elements.find((element) => hasClass(element, "gpc"));
  const match =
    info &&
    /\bShowing\s+([\d,]+)\s*-\s*([\d,]+)\s+of\s+([\d,]+)\s+images?\b/i.exec(
      elementText(info),
    );
  const number = (value: string | undefined) =>
    value ? Number(value.replace(/,/g, "")) : NaN;
  const start = number(match?.[1]);
  const end = number(match?.[2]);
  const total = number(match?.[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 1 ||
    end < start ||
    end > total ||
    total < 1 ||
    total > MAX_PAGES
  )
    return fail();
  return { start, end, total };
}

function unexpectedResponse(html: string): never {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (
    /\bcontent warning\b/.test(text) &&
    /\bthis gallery has been flagged as offensive for everyone\b/.test(text)
  ) {
    return fail("gallery_content_warning");
  }
  if (
    /\b(?:bandwidth (?:limit )?exceeded|could not get dispatch for image|quota exceeded|exceeded your image viewing limits|daily limit exceeded|too many requests|rate limited|opening pages too fast|temporarily banned for excessive pageloads)\b/.test(
      text,
    )
  ) {
    return fail("gallery_rate_limited");
  }
  if (
    /\b(?:please log in|login required|sign in to view|access denied)\b/.test(
      text,
    )
  ) {
    return fail("gallery_access_required");
  }
  return fail();
}

function listingData(
  elements: HtmlElement[],
  container: HtmlElement,
  source: GallerySource,
  expectedStart: number,
  expectedEnd: number,
): {
  title: string;
  entries: Array<{ url: string; name: string }>;
} {
  const titleElement = elements.find(
    (element) => attribute(element, "id") === "gn",
  );
  const title = titleElement
    ? elementText(titleElement)
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
    : "";
  if (!title || title.length > MAX_TITLE_LENGTH) return fail();
  const entries: Array<{ url: string; name: string }> = [];
  for (const anchor of descendants(container).filter(
    (element) => element.tagName === "a",
  )) {
    const rawHref = attribute(anchor, "href");
    const tile = descendants(anchor).find(
      (element) => element.tagName === "div" && attribute(element, "title"),
    );
    const label = tile && attribute(tile, "title");
    const match = label && /^Page\s+(\d+):\s*(.+)$/.exec(label);
    if (!rawHref || !match) return fail();
    let url: URL;
    try {
      url = new URL(rawHref, source.url);
    } catch {
      return fail();
    }
    const pageMatch = PAGE_URL_PATTERN.exec(url.pathname);
    const number = Number(match[1]);
    const name = match[2].trim();
    if (
      url.origin !== "https://e-hentai.org" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !pageMatch ||
      pageMatch[2] !== source.id ||
      name.length < 1 ||
      name.length > 512 ||
      /[\u0000-\u001f\u007f/\\]/.test(name) ||
      number !== expectedStart + entries.length ||
      number > expectedEnd ||
      Number(pageMatch[3]) !== number
    )
      return fail();
    entries.push({ url: url.href, name });
  }
  if (entries.length !== expectedEnd - expectedStart + 1) return fail();
  return { title, entries };
}

function listingUrl(source: URL, offset: number): string {
  const url = new URL(source.href);
  if (offset > 0) url.searchParams.set("p", String(offset));
  return url.href;
}

export async function loadEhentaiReader(
  source: GallerySource,
  http: GalleryHttp,
): Promise<{ title: string; pages: { url: string; name: string }[] }> {
  const parsed = checkSource(source);
  const firstHtml = await http.text(listingUrl(parsed, 0), {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  const firstElements = htmlElements(firstHtml);
  if (!firstElements.some((element) => attribute(element, "id") === "gdt"))
    return unexpectedResponse(firstHtml);
  const firstRange = pageRange(firstElements);
  if (firstRange.start !== 1) return fail();
  const listingPageSize = firstRange.end - firstRange.start + 1;
  const listingPages = Math.ceil(firstRange.total / listingPageSize);
  const pages: Array<{ url: string; name: string }> = [];
  let title = "";
  for (let pageIndex = 0; pageIndex < listingPages; pageIndex++) {
    const html =
      pageIndex === 0
        ? firstHtml
        : await http.text(listingUrl(parsed, pageIndex), {
            method: "GET",
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
          });
    const start = pageIndex * listingPageSize + 1;
    const end = Math.min(firstRange.total, start + listingPageSize - 1);
    const elements = pageIndex === 0 ? firstElements : htmlElements(html);
    const container = elements.find((element) => attribute(element, "id") === "gdt");
    if (!container) return unexpectedResponse(html);
    const range = pageIndex === 0 ? firstRange : pageRange(elements);
    if (
      range.start !== start ||
      range.end !== end ||
      range.total !== firstRange.total
    )
      return fail();
    const listing = listingData(elements, container, source, start, end);
    if (!title) title = listing.title;
    else if (listing.title !== title) return fail();
    pages.push(...listing.entries);
  }
  if (pages.length !== firstRange.total) return fail();
  return { title, pages };
}

export function isEhentaiReaderPage(
  source: GallerySource,
  pageUrl: unknown,
): pageUrl is string {
  try {
    checkSource(source);
    if (typeof pageUrl !== "string") return false;
    const url = new URL(pageUrl);
    const match = PAGE_URL_PATTERN.exec(url.pathname);
    return (
      url.origin === "https://e-hentai.org" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      match !== null &&
      match[2] === source.id &&
      Number(match[3]) <= MAX_PAGES
    );
  } catch {
    return false;
  }
}

function parseReaderRoute(html: string, page: string): { url: string; reloadKey?: string } {
  const elements = htmlElements(html);
  const main = elements.find((element) => attribute(element, "id") === "i1");
  const image = elements.find(
    (element) => element.tagName === "img" && attribute(element, "id") === "img",
  );
  const url = image && attribute(image, "src");
  const pageInfo = elements.find(
    (element) => attribute(element, "id") === "i2",
  );
  const body = pageInfo ? elementText(pageInfo).trim() : "";
  if (!main || !url || !isGalleryMediaUrl("ehentai", url))
    return unexpectedResponse(html);
  if (
    !pageInfo ||
    !new RegExp(`^${page}\\s*\\/\\s*\\d+`).test(body)
  )
    return fail();
  const reload = elements.find(
    (element) => element.tagName === "a" && attribute(element, "id") === "loadfail",
  );
  const reloadKey = reload && /^return nl\('(\d{1,10}-\d{1,10})'\);?$/.exec(
    attribute(reload, "onclick") || "",
  )?.[1];
  return { url: new URL(url).href, reloadKey };
}

export async function resolveEhentaiReaderRoute(
  source: GallerySource,
  pageUrl: string,
  http: GalleryHttp,
): Promise<GalleryImageRoute> {
  if (!isEhentaiReaderPage(source, pageUrl)) return fail();
  const page = PAGE_URL_PATTERN.exec(new URL(pageUrl).pathname)![3];
  const read = async (url: string) => parseReaderRoute(await http.text(url, {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  }), page);
  const route = await read(pageUrl);
  if (!route.reloadKey) return { url: route.url };
  const reloadUrl = new URL(pageUrl);
  reloadUrl.searchParams.set("nl", route.reloadKey);
  return {
    url: route.url,
    retry: async () => {
      const alternate = await read(reloadUrl.href);
      return alternate.url === route.url ? undefined : alternate.url;
    },
  };
}

export async function resolveEhentaiReaderImage(
  source: GallerySource,
  pageUrl: string,
  http: GalleryHttp,
): Promise<string> {
  return (await resolveEhentaiReaderRoute(source, pageUrl, http)).url;
}
