import {
  parseGallerySource,
  type GallerySource,
} from "../shared/gallery-sources";
import type { EhentaiReaderTab } from "../shared/types";
import { gallerySiteError, type GalleryHttp } from "./gallery-site-http";

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const REOPEN_TIMEOUT_MS = 30_000;
const REOPEN_POLL_MS = 200;
const REQUEST_INTERVAL_MS = 400;
let nextEhentaiRequestAt = 0;

type TabCheckResult = { ok: true } | { ok: false };
type TabFetchResult =
  | { ok: true; status: number; text: string }
  | { ok: false; kind: "page" | "request" | "timeout" | "response-too-large" };

function fail(code = "gallery_reader_tab_required"): never {
  throw gallerySiteError(code);
}

async function waitForEhentaiPace(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) fail();
  const now = Date.now();
  const scheduledAt = Math.max(now, nextEhentaiRequestAt);
  nextEhentaiRequestAt = scheduledAt + REQUEST_INTERVAL_MS;
  const delay = scheduledAt - now;
  if (delay > 0) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delay);
      const onAbort = () => {
        clearTimeout(timer);
        cleanup();
        reject(gallerySiteError("gallery_reader_tab_required"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
  if (signal?.aborted) fail();
}

function canonicalSource(sourceUrl: string): GallerySource | undefined {
  const parsed = parseGallerySource(sourceUrl);
  if (!parsed || parsed.site !== "ehentai" || parsed.url !== sourceUrl) {
    return undefined;
  }
  return parsed;
}

/** Runs in the isolated world of the main frame and only reads visible-page metadata. */
function checkEhentaiGalleryDocument(
  expectedOrigin: string,
  expectedPath: string,
): TabCheckResult {
  const allowedSearch = /^(?:\?p=[1-9]\d{0,3})?$/.test(location.search);
  if (
    location.origin !== expectedOrigin ||
    location.pathname !== expectedPath ||
    !allowedSearch ||
    location.hash !== ""
  ) {
    return { ok: false };
  }
  const title = document.querySelector<HTMLElement>("#gn")?.textContent?.trim();
  const range = document.querySelector<HTMLElement>(".gpc")?.textContent ?? "";
  const listing = document.querySelector<HTMLElement>("#gdt");
  if (
    !title ||
    !/\bShowing\s+[\d,]+\s*-\s*[\d,]+\s+of\s+[\d,]+\s+images?\b/i.test(range) ||
    !listing?.querySelector(
      'a[href^="/s/"], a[href^="https://e-hentai.org/s/"]',
    )
  ) {
    return { ok: false };
  }
  return { ok: true };
}

function allowedReaderRequest(
  source: GallerySource,
  raw: string,
): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "e-hentai.org" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    return undefined;
  }
  const gallery = /^\/g\/([1-9]\d{0,9})\/([a-f\d]{10})\/$/i.exec(url.pathname);
  if (gallery) {
    const pageOffset = /^(?:\?p=([1-9]\d{0,3}))?$/.exec(url.search);
    if (
      gallery[1] === source.id &&
      gallery[2].toLowerCase() ===
        source.url.match(/\/g\/\d+\/([a-f\d]{10})\//i)?.[1].toLowerCase() &&
      pageOffset
    ) {
      return url;
    }
    return undefined;
  }
  const reader = /^\/s\/[a-f\d]{10}\/([1-9]\d{0,9})-([1-9]\d{0,4})$/i.exec(
    url.pathname,
  );
  if (
    reader &&
    reader[1] === source.id &&
    Number(reader[2]) <= 2_000 &&
    /^(?:\?nl=\d{1,10}-\d{1,10})?$/.test(url.search)
  ) {
    return url;
  }
  return undefined;
}

/** Runs in the bound document's isolated world, using same-origin fetch only. */
async function fetchEhentaiDocument(
  rawUrl: string,
  sourceId: string,
  sourceToken: string,
  maxBytes: number,
): Promise<TabFetchResult> {
  const url = new URL(rawUrl);
  const gallery = /^\/g\/([1-9]\d{0,9})\/([a-f\d]{10})\/$/i.exec(url.pathname);
  const reader = /^\/s\/[a-f\d]{10}\/([1-9]\d{0,9})-([1-9]\d{0,4})$/i.exec(
    url.pathname,
  );
  const allowedQuery = gallery
    ? /^(?:\?p=[1-9]\d{0,3})?$/.test(url.search)
    : /^(?:\?nl=\d{1,10}-\d{1,10})?$/.test(url.search);
  if (
    location.origin !== "https://e-hentai.org" ||
    location.pathname !== `/g/${sourceId}/${sourceToken}/` ||
    !/^(?:\?p=[1-9]\d{0,3})?$/.test(location.search) ||
    location.hash !== "" ||
    !allowedQuery ||
    (gallery &&
      (gallery[1] !== sourceId || gallery[2].toLowerCase() !== sourceToken)) ||
    (reader && (reader[1] !== sourceId || Number(reader[2]) > 2_000)) ||
    (!gallery && !reader)
  ) {
    return { ok: false, kind: "page" };
  }

  if (gallery && url.search === location.search) {
    const title = document.querySelector("#gn");
    const range = document.querySelector(".gpc");
    const thumbnails = document.querySelector("#gdt");
    if (title && range && thumbnails?.querySelector("a[href]")) {
      const text = title.outerHTML + range.outerHTML + thumbnails.outerHTML;
      if (new TextEncoder().encode(text).byteLength > maxBytes)
        return { ok: false, kind: "response-too-large" };
      return { ok: true, status: 200, text };
    }
  }

  try {
    const response = await fetch(url.href, {
      method: "GET",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: true, status: response.status, text: "" };
    }
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength &&
      /^\d+$/.test(declaredLength) &&
      Number(declaredLength) > maxBytes
    ) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, kind: "response-too-large" };
    }
    if (!response.body) return { ok: true, status: response.status, text: "" };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const part = await reader.read();
        if (part.done)
          return {
            ok: true,
            status: response.status,
            text: text + decoder.decode(),
          };
        bytes += part.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, kind: "response-too-large" };
        }
        text += decoder.decode(part.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  } catch {
    return { ok: false, kind: "request" };
  }
}

async function injectDocumentCheck(
  tabId: number,
  source: GallerySource,
): Promise<EhentaiReaderTab | undefined> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: checkEhentaiGalleryDocument,
      args: ["https://e-hentai.org", new URL(source.url).pathname],
      world: "ISOLATED",
    });
    if (
      (injection?.result as TabCheckResult | undefined)?.ok !== true ||
      typeof injection.documentId !== "string" ||
      !injection.documentId
    ) {
      return undefined;
    }
    return { tabId, documentId: injection.documentId };
  } catch {
    return undefined;
  }
}

async function findExistingTab(source: GallerySource): Promise<{
  found: boolean;
  value?: EhentaiReaderTab;
}> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ url: "https://e-hentai.org/g/*" });
  } catch {
    return { found: false };
  }
  const galleryPath = new URL(source.url).pathname;
  const matching = tabs.filter((candidate) => {
    if (!candidate.url) return false;
    try {
      const url = new URL(candidate.url);
      return (
        url.origin === "https://e-hentai.org" &&
        url.pathname === galleryPath &&
        /^(?:\?p=[1-9]\d{0,3})?$/.test(url.search) &&
        !url.hash
      );
    } catch {
      return false;
    }
  });
  if (!matching.length) return { found: false };
  for (const tab of matching) {
    if (typeof tab.id !== "number") continue;
    const value = await injectDocumentCheck(tab.id, source);
    if (value) return { found: true, value };
  }
  return { found: true };
}

async function reopenGalleryTab(
  source: GallerySource,
): Promise<EhentaiReaderTab | undefined> {
  let tabId: number;
  try {
    const tab = await chrome.tabs.create({ url: source.url, active: false });
    if (typeof tab.id !== "number") return undefined;
    tabId = tab.id;
  } catch {
    return undefined;
  }

  const deadline = Date.now() + REOPEN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return undefined;
    }
    const expectedPath = new URL(source.url).pathname;
    const currentUrl =
      tab.pendingUrl || (tab.url === "about:blank" ? undefined : tab.url);
    if (currentUrl) {
      try {
        const current = new URL(currentUrl);
        if (
          current.origin !== "https://e-hentai.org" ||
          current.pathname !== expectedPath ||
          current.search !== "" ||
          current.hash
        )
          return undefined;
      } catch {
        return undefined;
      }
    }
    if (tab.status === "complete" && tab.url === source.url)
      return injectDocumentCheck(tabId, source);
    await new Promise((resolve) => setTimeout(resolve, REOPEN_POLL_MS));
  }
  return undefined;
}

export async function findEhentaiReaderTab(
  sourceUrl: string,
  reopen = false,
): Promise<EhentaiReaderTab | undefined> {
  const source = canonicalSource(sourceUrl);
  if (!source) return undefined;
  const existing = await findExistingTab(source);
  if (existing.found) return existing.value;
  return reopen ? reopenGalleryTab(source) : undefined;
}

function requestFailure(error: unknown): Error {
  if (error instanceof Error && "code" in error) return error;
  return gallerySiteError("gallery_request_failed");
}

export function createEhentaiTabHttp(
  source: GallerySource,
  tab: EhentaiReaderTab,
  signal?: AbortSignal,
): GalleryHttp {
  const parsedSource = canonicalSource(source.url);
  if (
    !parsedSource ||
    parsedSource.id !== source.id ||
    typeof tab?.tabId !== "number" ||
    !tab.documentId
  ) {
    return fail();
  }
  const canonical: GallerySource = parsedSource;
  const sourceTokenMatch = /\/g\/\d+\/([a-f\d]{10})\//i.exec(
    new URL(canonical.url).pathname,
  );
  if (!sourceTokenMatch) return fail();
  const sourceToken = sourceTokenMatch[1].toLowerCase();

  async function text(rawUrl: string, init?: RequestInit): Promise<string> {
    if (signal?.aborted || init?.signal?.aborted)
      throw gallerySiteError("gallery_reader_tab_required");
    if (init?.method !== undefined && init.method !== "GET")
      throw gallerySiteError("gallery_invalid_metadata");
    const url = allowedReaderRequest(canonical, rawUrl);
    if (!url) throw gallerySiteError("gallery_invalid_metadata");
    const requestSignal = init?.signal ?? signal;
    await waitForEhentaiPace(requestSignal);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const callerSignal = requestSignal;
    const abortPromise = new Promise<never>((_, reject) => {
      abortListener = () => {
        reject(gallerySiteError("gallery_reader_tab_required"));
      };
      callerSignal?.addEventListener("abort", abortListener, { once: true });
      if (callerSignal?.aborted) abortListener();
      timer = setTimeout(() => {
        reject(gallerySiteError("gallery_request_failed"));
      }, REQUEST_TIMEOUT_MS);
    });

    try {
      const request = chrome.scripting
        .executeScript({
          target: { tabId: tab.tabId, documentIds: [tab.documentId] },
          func: fetchEhentaiDocument,
          args: [url.href, canonical.id, sourceToken, MAX_DOCUMENT_BYTES],
          world: "ISOLATED",
        })
        .catch(() => {
          throw gallerySiteError("gallery_reader_tab_required");
        });
      const [injection] = await Promise.race([request, abortPromise]);
      const result = injection?.result as TabFetchResult | undefined;
      if (!result || !result.ok) {
        if (result?.kind === "response-too-large")
          throw gallerySiteError("gallery_invalid_metadata");
        if (result?.kind === "request" || result?.kind === "timeout")
          throw gallerySiteError("gallery_request_failed");
        throw gallerySiteError("gallery_reader_tab_required");
      }
      if ([401, 403, 404, 410].includes(result.status))
        throw gallerySiteError("gallery_reader_tab_unavailable");
      if (result.status === 429 || result.status === 509)
        throw gallerySiteError("gallery_rate_limited");
      if (result.status < 200 || result.status >= 300)
        throw gallerySiteError("gallery_request_failed");
      return result.text;
    } catch (error) {
      if (error instanceof Error && "code" in error) throw error;
      return Promise.reject(requestFailure(error));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abortListener)
        callerSignal?.removeEventListener("abort", abortListener);
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
