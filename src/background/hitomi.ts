// Public technical references reviewed (data shape only; responses are never executed):
// https://ltn.gold-usergeneratedcontent.net/gg.js
// https://ltn.gold-usergeneratedcontent.net/common.js
// https://ltn.gold-usergeneratedcontent.net/reader.js
// Snapshot SHA-256: gg.js 31cf5fad6effa191d06e9effdf80252657dbd018bcbfaf6b2742075c405cbaec
// Snapshot SHA-256: common.js 9cdb39101b3658f838ec8df4e7c3c355dc99d01791d32efe9098cea6d7e15788
import type { GalleryImage, GalleryManifest } from "../shared/types";

const METADATA_ORIGIN = "https://ltn.gold-usergeneratedcontent.net";
const METADATA_URL = (id: string) => `${METADATA_ORIGIN}/galleries/${id}.js`;
const GG_URL = `${METADATA_ORIGIN}/gg.js`;
const REQUEST_TIMEOUT_MS = 20_000;
const METADATA_MAX_BYTES = 2 * 1024 * 1024;
const GG_MAX_BYTES = 96 * 1024;
const MAX_IMAGES = 2_000;
const MAX_TITLE_LENGTH = 300;
const MAX_NAME_LENGTH = 512;
const GG_CACHE_MS = 20 * 60 * 1_000;

export type HitomiClientErrorCode =
  | "gallery_invalid_metadata"
  | "gallery_request_failed"
  | "gallery_unavailable"
  | "gallery_invalid_routing";

export class HitomiClientError extends Error {
  readonly code: HitomiClientErrorCode;

  constructor(code: HitomiClientErrorCode, message: string) {
    super(message);
    this.name = "HitomiClientError";
    this.code = code;
  }
}

interface RoutingData {
  readonly caseIds: ReadonlySet<number>;
  readonly defaultShard: 0 | 1;
  readonly caseShard: 0 | 1;
  readonly base: string;
}

interface CachedRouting {
  readonly expiresAt: number;
  readonly value: RoutingData;
}

function invalidMetadata(message: string): never {
  throw new HitomiClientError("gallery_invalid_metadata", message);
}

function invalidRouting(message: string): never {
  throw new HitomiClientError("gallery_invalid_routing", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedGalleryId(id: string): string {
  if (!/^[1-9]\d{0,9}$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new HitomiClientError(
      "gallery_invalid_metadata",
      "Gallery id must be a positive safe integer.",
    );
  }
  return id;
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string")
    return invalidMetadata("Gallery title is missing.");
  const title = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return invalidMetadata("Gallery title is empty or too long.");
  }
  return title;
}

function parseMetadata(source: string, requestedId: string): GalleryManifest {
  // Official gallery scripts expose a JSON assignment. Parse only the JSON payload;
  // never evaluate the returned script.
  const match =
    /^\s*(?:var|let|const)\s+galleryinfo\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(
      source,
    );
  if (!match)
    return invalidMetadata(
      "Gallery response is not a galleryinfo JSON assignment.",
    );

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return invalidMetadata("Gallery response contains invalid JSON.");
  }
  if (!isRecord(raw))
    return invalidMetadata("Gallery metadata must be an object.");

  const responseId =
    typeof raw.id === "number" && Number.isSafeInteger(raw.id)
      ? String(raw.id)
      : typeof raw.id === "string" && /^[1-9]\d{0,9}$/.test(raw.id)
        ? raw.id
        : "";
  if (responseId !== requestedId)
    return invalidMetadata(
      "Gallery id is missing or does not match the request.",
    );

  const title = cleanTitle(raw.title);
  if (
    !Array.isArray(raw.files) ||
    raw.files.length < 1 ||
    raw.files.length > MAX_IMAGES
  ) {
    return invalidMetadata(
      `Gallery files must contain 1 to ${MAX_IMAGES} images.`,
    );
  }

  const seenHashes = new Set<string>();
  const images: GalleryImage[] = raw.files.map((file: unknown) => {
    if (!isRecord(file))
      return invalidMetadata("Gallery file entry must be an object.");
    if (typeof file.hash !== "string" || !/^[0-9a-f]{64}$/i.test(file.hash)) {
      return invalidMetadata(
        "Gallery file hash must be 64 hexadecimal characters.",
      );
    }
    const hash = file.hash.toLowerCase();
    if (seenHashes.has(hash))
      return invalidMetadata("Gallery contains a duplicate image hash.");
    seenHashes.add(hash);
    if (
      typeof file.name !== "string" ||
      !file.name.trim() ||
      file.name.length > MAX_NAME_LENGTH ||
      /[\0\r\n]/.test(file.name)
    ) {
      return invalidMetadata(
        "Gallery file name is empty, too long, or contains a forbidden control character.",
      );
    }
    // Name is retained only as metadata. It is never interpolated into a URL or path.
    return { hash, name: file.name };
  });

  return { id: requestedId, title, images };
}

async function readBoundedText(
  response: Response,
  limit: number,
  code: HitomiClientErrorCode,
): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new HitomiClientError(code, "Response exceeds the allowed size.");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => undefined);
        throw new HitomiClientError(code, "Response exceeds the allowed size.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchText(
  fetcher: typeof fetch,
  url: string,
  limit: number,
  errorCode: HitomiClientErrorCode,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new HitomiClientError(
          "gallery_request_failed",
          "Gallery request timed out.",
        ),
      );
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    const request = (async () => {
      const response = await fetcher(url, {
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const isMetadataEndpoint = url.startsWith(
          `${METADATA_ORIGIN}/galleries/`,
        );
        const code =
          response.status === 404 && isMetadataEndpoint
            ? "gallery_unavailable"
            : "gallery_request_failed";
        throw new HitomiClientError(
          code,
          `Gallery endpoint returned HTTP ${response.status}.`,
        );
      }
      return readBoundedText(response, limit, errorCode);
    })();
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (error instanceof HitomiClientError) throw error;
    throw new HitomiClientError(
      "gallery_request_failed",
      timedOut ? "Gallery request timed out." : "Gallery request failed.",
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parseRouting(source: string): RoutingData {
  // A purpose-built parser for the published m/s/b data shape. Any extra executable
  // syntax or a changed routing algorithm is rejected rather than interpreted.
  const pattern =
    /^\s*['"]use strict['"]\s*;\s*gg\s*=\s*\{\s*m\s*:\s*function\s*\(\s*g\s*\)\s*\{\s*var\s+o\s*=\s*([01])\s*;\s*switch\s*\(\s*g\s*\)\s*\{\s*((?:case\s+\d+\s*:\s*)+)o\s*=\s*([01])\s*;\s*break\s*;\s*\}\s*return\s+o\s*;\s*\}\s*,\s*s\s*:\s*function\s*\(\s*h\s*\)\s*\{\s*var\s+m\s*=\s*\/\(\.\.\)\(\.\)\$\/\.exec\(\s*h\s*\)\s*;\s*return\s+parseInt\(\s*m\[2\]\s*\+\s*m\[1\]\s*,\s*16\s*\)\.toString\(\s*10\s*\)\s*;\s*\}\s*,\s*b\s*:\s*['"]([1-9]\d{0,15}\/)["']\s*\}\s*;?\s*$/;
  const match = pattern.exec(source);
  if (!match) {
    return invalidRouting(
      "GG routing response does not match the supported data format.",
    );
  }

  const caseIds = new Set<number>();
  const cases = match[2].matchAll(/case\s+(\d+)\s*:/g);
  for (const entry of cases) {
    const id = Number(entry[1]);
    if (!Number.isSafeInteger(id) || id > 4_095 || caseIds.has(id)) {
      return invalidRouting("GG routing case list is invalid.");
    }
    caseIds.add(id);
  }
  if (caseIds.size === 0)
    return invalidRouting("GG routing case list is empty.");
  return {
    caseIds,
    defaultShard: Number(match[1]) as 0 | 1,
    caseShard: Number(match[3]) as 0 | 1,
    base: match[4],
  };
}

function shardNumber(hash: string): number {
  return Number.parseInt(`${hash.at(-1)}${hash.slice(-3, -1)}`, 16);
}

export function createHitomiClient(fetcher: typeof fetch = fetch): {
  load(id: string): Promise<GalleryManifest>;
  imageUrl(image: GalleryImage): Promise<string>;
} {
  let cachedRouting: CachedRouting | undefined;

  async function routing(): Promise<RoutingData> {
    const now = Date.now();
    if (cachedRouting && cachedRouting.expiresAt > now)
      return cachedRouting.value;
    const source = await fetchText(
      fetcher,
      GG_URL,
      GG_MAX_BYTES,
      "gallery_invalid_routing",
    );
    const value = parseRouting(source);
    cachedRouting = { value, expiresAt: now + GG_CACHE_MS };
    return value;
  }

  return {
    async load(id: string): Promise<GalleryManifest> {
      cachedRouting = undefined;
      const normalizedId = normalizedGalleryId(id);
      const source = await fetchText(
        fetcher,
        METADATA_URL(normalizedId),
        METADATA_MAX_BYTES,
        "gallery_invalid_metadata",
      );
      return parseMetadata(source, normalizedId);
    },

    async imageUrl(image: GalleryImage): Promise<string> {
      if (
        !image ||
        typeof image.hash !== "string" ||
        !/^[0-9a-f]{64}$/i.test(image.hash)
      ) {
        throw new HitomiClientError(
          "gallery_invalid_metadata",
          "Image hash must be 64 hexadecimal characters.",
        );
      }
      const hash = image.hash.toLowerCase();
      const gg = await routing();
      const m = gg.caseIds.has(shardNumber(hash))
        ? gg.caseShard
        : gg.defaultShard;
      const shard = 1 + m;
      return `https://w${shard}.gold-usergeneratedcontent.net/${gg.base}${shardNumber(hash)}/${hash}.webp`;
    },
  };
}
