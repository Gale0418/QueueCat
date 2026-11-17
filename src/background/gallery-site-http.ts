import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import type { GallerySource } from "../shared/gallery-sources";
import type { GelbooruCredentials } from "../shared/gelbooru-session";

export interface GalleryHttp {
  text(url: string, init?: RequestInit): Promise<string>;
  json(url: string, init?: RequestInit): Promise<unknown>;
}

export interface GallerySiteAdapter {
  load(
    source: GallerySource,
    http: GalleryHttp,
  ): Promise<{ title: string; pages: string[] }>;
}

const METADATA_HOSTS = new Set([
  "e-hentai.org",
  "hentaifox.com",
  "nozomi.la",
  "j.gold-usergeneratedcontent.net",
  "danbooru.donmai.us",
  "gelbooru.com",
  "www.zerochan.net",
]);
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const EH_READER_REQUEST_INTERVAL_MS = 400;

export function gallerySiteError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export function createGalleryHttp(
  fetcher: typeof fetch = fetch,
  readGelbooruCredentials?: () => Promise<GelbooruCredentials | undefined>,
): GalleryHttp {
  let nextEhReaderRequest = 0;
  async function text(raw: string, init?: RequestInit): Promise<string> {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !METADATA_HOSTS.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw gallerySiteError("gallery_invalid_metadata");
    }
    if (url.hostname === "e-hentai.org") {
      const gallery = /^\/g\/[1-9]\d{0,9}\/[a-f0-9]{10}\/$/.test(url.pathname);
      const page = /^\/s\/[a-f0-9]{10}\/[1-9]\d{0,9}-[1-9]\d{0,3}$/.test(url.pathname);
      if (
        (init?.method !== undefined && init.method !== "GET") ||
        !(gallery && /^(?:\?p=[1-9]\d{0,3})?$/.test(url.search) ||
          page && /^(?:\?nl=\d{1,10}-\d{1,10})?$/.test(url.search))
      ) {
        throw gallerySiteError("gallery_invalid_metadata");
      }
      const now = performance.now();
      const delay = Math.max(0, nextEhReaderRequest - now);
      nextEhReaderRequest = now + delay + EH_READER_REQUEST_INTERVAL_MS;
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      init?.signal?.throwIfAborted();
    }
    if (
      url.hostname === "gelbooru.com" &&
      url.pathname === "/index.php" &&
      url.searchParams.get("page") === "dapi" &&
      url.searchParams.get("s") === "post" &&
      url.searchParams.get("q") === "index" &&
      /^[1-9]\d{0,9}$/.test(url.searchParams.get("id") || "")
    ) {
      const credentials = await readGelbooruCredentials?.();
      if (credentials) {
        url.searchParams.set("api_key", credentials.apiKey);
        url.searchParams.set("user_id", credentials.userId);
      }
    }
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetcher(url.href, {
      ...init,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404 || response.status === 410)
        throw gallerySiteError("gallery_unavailable");
      if (response.status === 401 || response.status === 403)
        throw gallerySiteError("gallery_access_required");
      if (response.status === 429 || response.status === 509)
        throw gallerySiteError("gallery_rate_limited");
      throw gallerySiteError("gallery_request_failed");
    }
    if (Number(response.headers.get("content-length")) > MAX_DOCUMENT_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw gallerySiteError("gallery_invalid_metadata");
    }
    if (!response.body) throw gallerySiteError("gallery_invalid_metadata");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let content = "";
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) return content + decoder.decode();
        bytes += part.value.byteLength;
        if (bytes > MAX_DOCUMENT_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw gallerySiteError("gallery_invalid_metadata");
        }
        content += decoder.decode(part.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  }
  return {
    text,
    async json(url, init) {
      const body = await text(url, init);
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw gallerySiteError("gallery_invalid_metadata");
      }
    },
  };
}

// parse5 builds a data-only tree. It does not run scripts or load subresources.
export function htmlElements(html: string): Html.Element[] {
  const elements: Html.Element[] = [];
  const stack: Html.Node[] = [...parse(html).childNodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if ("tagName" in node) elements.push(node);
    if ("childNodes" in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        stack.push(node.childNodes[index]);
      }
    }
  }
  return elements;
}

export function attribute(el: Html.Element, name: string): string | undefined {
  return el.attrs.find((attr) => attr.name === name)?.value;
}

export function elementText(el: Html.Element): string {
  const parts: string[] = [];
  const stack: Html.Node[] = [...el.childNodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if ("value" in node) parts.push(node.value);
    if ("childNodes" in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        stack.push(node.childNodes[index]);
      }
    }
  }
  return parts.join("");
}
