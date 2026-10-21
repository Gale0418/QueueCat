const MESSAGE_TYPE = "QC_GALLERY_TRANSPORT" as const;
const ARCHIVE_MESSAGE_TYPE = "QC_GALLERY_ARCHIVE" as const;
const REQUEST_TIMEOUT_MS = 65_000;
const CLEANUP_TIMEOUT_MS = 5_000;
const ARCHIVE_STAGE_TIMEOUT_MS = 65_000;
const ARCHIVE_PACK_TIMEOUT_MS = 300_000;
export const GALLERY_FETCH_TIMEOUT_MS = 60_000;
const REFERER_RULE_ID = 42_017;

const IMAGE_URL_PATTERN =
  /^https:\/\/w[12]\.gold-usergeneratedcontent\.net\/\d{1,16}\/\d{1,4}\/[0-9a-f]{64}\.webp$/;

export const MAX_GALLERY_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_WEBP_CHUNKS = 4_096;

export function isSafeGalleryImageUrl(value: unknown): value is string {
  return typeof value === "string" && IMAGE_URL_PATTERN.test(value);
}

function urlOrigin(value: string): string {
  const parsed = new URL(value);
  return `${parsed.protocol}//${parsed.host}`;
}

export function isExtensionBlobUrl(
  value: unknown,
  extensionOrigin: string,
): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    const normalizedOrigin = urlOrigin(extensionOrigin);
    const prefix = `blob:${normalizedOrigin}/`;
    const token = value.startsWith(prefix) ? value.slice(prefix.length) : "";
    return (
      parsed.protocol === "blob:" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        token,
      )
    );
  } catch {
    return false;
  }
}

export async function readWebpResponse(
  response: Response,
  maxBytes = MAX_GALLERY_IMAGE_BYTES,
): Promise<Blob> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`gallery_http_${response.status}`);
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "image/webp") {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("gallery_invalid_content_type");
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("gallery_image_too_large");
  }
  if (!response.body) throw new Error("gallery_empty_response");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("gallery_image_too_large");
      if (chunks.length < MAX_WEBP_CHUNKS) {
        chunks.push(value);
      } else {
        const combined = new Uint8Array(size);
        let combinedOffset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, combinedOffset);
          combinedOffset += chunk.byteLength;
        }
        combined.set(value, combinedOffset);
        chunks.splice(0, chunks.length, combined);
      }
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }

  if (size < 12) throw new Error("gallery_invalid_webp");
  const prefix = new Uint8Array(12);
  let offset = 0;
  for (const chunk of chunks) {
    const count = Math.min(chunk.byteLength, 12 - offset);
    prefix.set(chunk.subarray(0, count), offset);
    offset += count;
    if (offset === 12) break;
  }
  if (
    prefix[0] !== 0x52 ||
    prefix[1] !== 0x49 ||
    prefix[2] !== 0x46 ||
    prefix[3] !== 0x46 ||
    prefix[8] !== 0x57 ||
    prefix[9] !== 0x45 ||
    prefix[10] !== 0x42 ||
    prefix[11] !== 0x50
  )
    throw new Error("gallery_invalid_webp");

  return new Blob(
    chunks.map(
      (chunk) =>
        chunk.buffer.slice(
          chunk.byteOffset,
          chunk.byteOffset + chunk.byteLength,
        ) as ArrayBuffer,
    ),
    { type: "image/webp" },
  );
}

export async function fetchGalleryWebp(
  url: string,
  fetcher: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
  timeoutMs = GALLERY_FETCH_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!isSafeGalleryImageUrl(url)) throw new Error("gallery_invalid_image_url");
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const externalCancellation = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => {
          controller.abort();
          reject(new Error("gallery_request_cancelled"));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      })
    : undefined;
  try {
    const operations: Array<Promise<Blob>> = [
      (async () => {
        const response = await fetcher(url, {
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
        return readWebpResponse(response);
      })(),
      new Promise<Blob>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("gallery_fetch_timeout"));
        }, timeoutMs);
      }),
    ];
    if (externalCancellation) operations.push(externalCancellation);
    return await Promise.race(operations);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

type PrepareMessage = {
  type: typeof MESSAGE_TYPE;
  action: "prepare";
  requestId: string;
  url: string;
};
type ReleaseMessage = {
  type: typeof MESSAGE_TYPE;
  action: "release";
  requestId: string;
  blobUrl: string;
};
type CancelMessage = {
  type: typeof MESSAGE_TYPE;
  action: "cancel";
  requestId: string;
  url: string;
};
type StatusMessage = {
  type: typeof MESSAGE_TYPE;
  action: "status";
  requestId: string;
};
type IdleNotice = { type: typeof MESSAGE_TYPE; action: "idle" };
type OffscreenReply =
  | { ok: true; blobUrl?: string; idle?: boolean }
  | { ok: false; error: string; idle?: boolean };

export interface GalleryTransport {
  prepare(url: string): Promise<string>;
  release(blobUrl: string): Promise<void>;
  archive: {
    stagePage(input: {
      key: string;
      fingerprint: string;
      total: number;
      index: number;
      hash: string;
      url: string;
    }): Promise<{ staged: number; bytes: number }>;
    pack(input: {
      key: string;
      fingerprint: string;
      total: number;
      hashes: string[];
    }): Promise<{ url: string; bytes: number }>;
    cleanup(key: string): Promise<void>;
  };
}

export function createGalleryTransport(
  timeouts: { requestMs?: number; cleanupMs?: number } = {},
): GalleryTransport {
  const requestTimeoutMs = timeouts.requestMs ?? REQUEST_TIMEOUT_MS;
  const cleanupTimeoutMs = timeouts.cleanupMs ?? CLEANUP_TIMEOUT_MS;
  // One queue protects document creation, DNR lifetime, ownership, and idle close.
  let queue = Promise.resolve<unknown>(undefined);
  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const extensionOrigin = urlOrigin(chrome.runtime.getURL("/"));
  const documentUrl = chrome.runtime.getURL("gallery-offscreen.html");

  async function documentExists(): Promise<boolean> {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl],
    });
    return contexts.length > 0;
  }

  async function ensureDocument(): Promise<void> {
    if (await documentExists()) return;
    try {
      await chrome.offscreen.createDocument({
        url: "gallery-offscreen.html",
        reasons: ["BLOBS"],
        justification:
          "Fetch a validated gallery image and hold its Blob URL for Chrome downloads.",
      });
    } catch (error) {
      // Another extension context may have completed creation between the query and call.
      if (!(await documentExists())) throw error;
    }
  }

  async function messageOffscreen(
    message:
      | PrepareMessage
      | ReleaseMessage
      | CancelMessage
      | StatusMessage
      | Record<string, unknown>,
    timeoutMs = requestTimeoutMs,
  ): Promise<OffscreenReply> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        chrome.runtime.sendMessage(message) as Promise<OffscreenReply>,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("gallery_transport_timeout")),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function updateRefererRule(
    url: string,
    enabled: boolean,
  ): Promise<void> {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [REFERER_RULE_ID],
      ...(enabled
        ? {
            addRules: [
              {
                id: REFERER_RULE_ID,
                priority: 1,
                action: {
                  type: "modifyHeaders" as const,
                  requestHeaders: [
                    {
                      header: "Referer",
                      operation: "set" as const,
                      value: "https://hitomi.la/",
                    },
                  ],
                },
                condition: {
                  regexFilter: `^${url.replaceAll(".", "\\.")}$`,
                  initiatorDomains: [chrome.runtime.id],
                  requestMethods: ["get"],
                  resourceTypes: ["xmlhttprequest"],
                },
              },
            ],
          }
        : {}),
    });
  }

  async function clearRefererRule(url: string): Promise<void> {
    try {
      await updateRefererRule(url, false);
    } catch (firstError) {
      try {
        await updateRefererRule(url, false);
      } catch (secondError) {
        throw new AggregateError(
          [firstError, secondError],
          "Could not clear the gallery Referer session rule after one retry",
        );
      }
    }
  }

  async function cancelRequest(url: string, requestId: string): Promise<void> {
    if (!(await documentExists())) return;
    const result = await messageOffscreen(
      { type: MESSAGE_TYPE, action: "cancel", requestId, url },
      cleanupTimeoutMs,
    );
    if (!result.ok) throw new Error(result.error || "gallery_cancel_failed");
    if (result.idle) await chrome.offscreen.closeDocument();
  }

  async function archiveMessage<T>(
    action: "stagePage" | "pack" | "cleanup",
    data: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    await ensureDocument();
    // createDocument may resolve before a larger offscreen bundle registers
    // its listener. Probe with a side-effect-free status request; never retry
    // a staging/packing request merely because its response was ambiguous.
    const deadline = Date.now() + cleanupTimeoutMs;
    for (;;) {
      try {
        const ready = await messageOffscreen(
          {
            type: MESSAGE_TYPE,
            action: "status",
            requestId: crypto.randomUUID(),
          },
          cleanupTimeoutMs,
        );
        if (!ready?.ok) throw new Error("gallery_offscreen_not_ready");
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const result = await messageOffscreen(
      { type: ARCHIVE_MESSAGE_TYPE, action, ...data },
      timeoutMs,
    );
    if (!result.ok) throw new Error(result.error || "gallery_archive_failed");
    return result as T;
  }

  async function withArchiveSource<T>(
    url: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!isSafeGalleryImageUrl(url)) throw new Error("gallery_archive_failed");
    let result: T | undefined;
    let operationError: unknown;
    try {
      await updateRefererRule(url, true);
      result = await operation();
    } catch (error) {
      operationError = error;
    }
    let cleanupError: unknown;
    try {
      await clearRefererRule(url);
    } catch (error) {
      cleanupError = error;
    }
    if (operationError) throw operationError;
    if (cleanupError) throw cleanupError;
    return result!;
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      !message ||
      typeof message !== "object" ||
      (message as IdleNotice).type !== MESSAGE_TYPE ||
      (message as IdleNotice).action !== "idle" ||
      sender.id !== chrome.runtime.id ||
      sender.url !== documentUrl
    )
      return false;
    void runExclusive(async () => {
      if (!(await documentExists())) return;
      const result = await messageOffscreen(
        {
          type: MESSAGE_TYPE,
          action: "status",
          requestId: crypto.randomUUID(),
        },
        cleanupTimeoutMs,
      );
      if (result.ok && result.idle) await chrome.offscreen.closeDocument();
    }).catch((error) =>
      console.error("QueueCat 圖庫 offscreen 閒置回收失敗", error),
    );
    return false;
  });

  return {
    prepare(url: string): Promise<string> {
      return runExclusive(async () => {
        if (!isSafeGalleryImageUrl(url))
          throw new Error("gallery_invalid_image_url");
        await ensureDocument();
        const requestId = crypto.randomUUID();
        let blobUrl: string | undefined;
        let operationError: unknown;
        try {
          await updateRefererRule(url, true);
          const result = await messageOffscreen({
            type: MESSAGE_TYPE,
            action: "prepare",
            requestId,
            url,
          });
          if (!result.ok)
            throw new Error(result.error || "gallery_transport_failed");
          if (!isExtensionBlobUrl(result.blobUrl, extensionOrigin))
            throw new Error("gallery_invalid_blob_url");
          blobUrl = result.blobUrl;
        } catch (error) {
          operationError = error;
        }

        let ruleCleanupError: unknown;
        try {
          await clearRefererRule(url);
        } catch (error) {
          ruleCleanupError = error;
        }

        if (operationError || ruleCleanupError) {
          try {
            await cancelRequest(url, requestId);
          } catch (cleanupError) {
            console.error("QueueCat 圖庫 Blob request 清理失敗", cleanupError);
          }
          if (operationError) {
            if (ruleCleanupError)
              console.error(
                "QueueCat 圖庫 Referer 規則清理失敗",
                ruleCleanupError,
              );
            throw operationError;
          }
          throw ruleCleanupError;
        }
        return blobUrl!;
      });
    },

    release(blobUrl: string): Promise<void> {
      return runExclusive(async () => {
        if (!isExtensionBlobUrl(blobUrl, extensionOrigin)) return;
        if (!(await documentExists())) return;
        const result = await messageOffscreen(
          {
            type: MESSAGE_TYPE,
            action: "release",
            requestId: crypto.randomUUID(),
            blobUrl,
          },
          cleanupTimeoutMs,
        );
        if (!result.ok)
          throw new Error(result.error || "gallery_release_failed");
        if (result.idle) await chrome.offscreen.closeDocument();
      });
    },
    archive: {
      stagePage(input): Promise<{ staged: number; bytes: number }> {
        return runExclusive(() =>
          withArchiveSource(input.url, () =>
            archiveMessage("stagePage", { input }, ARCHIVE_STAGE_TIMEOUT_MS),
          ),
        );
      },
      pack(input): Promise<{ url: string; bytes: number }> {
        return runExclusive(() =>
          archiveMessage("pack", { input }, ARCHIVE_PACK_TIMEOUT_MS),
        );
      },
      cleanup(key): Promise<void> {
        return runExclusive(async () => {
          await archiveMessage("cleanup", { key }, cleanupTimeoutMs);
        });
      },
    },
  };
}
