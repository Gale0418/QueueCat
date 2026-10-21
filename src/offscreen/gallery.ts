import {
  fetchGalleryWebp,
  isExtensionBlobUrl,
  isSafeGalleryImageUrl,
} from "../background/gallery-transport";
import { createArchiveManager, createOpfsArchiveStorage } from "./archive";

const MESSAGE_TYPE = "QC_GALLERY_TRANSPORT";
const ARCHIVE_MESSAGE_TYPE = "QC_GALLERY_ARCHIVE";
const MAX_BLOBS = 2;
const owned = new Set<string>();
const blobBySource = new Map<string, string>();
const inFlightBySource = new Map<string, Promise<string>>();
const abortBySource = new Map<string, AbortController>();

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
type TransportMessage =
  PrepareMessage | ReleaseMessage | CancelMessage | StatusMessage;
const claimsBySource = new Map<string, Set<string>>();
const sourceByRequestId = new Map<string, string>();
const archive = createArchiveManager(createOpfsArchiveStorage());

function isIdle(): boolean {
  return (
    owned.size === 0 &&
    inFlightBySource.size === 0 &&
    claimsBySource.size === 0 &&
    archive.idle
  );
}

function notifyBackgroundIfIdle(): void {
  if (isIdle())
    void chrome.runtime
      .sendMessage({ type: MESSAGE_TYPE, action: "idle" })
      .catch(() => undefined);
}

function clearClaim(source: string, requestId: string): void {
  if (sourceByRequestId.get(requestId) === source)
    sourceByRequestId.delete(requestId);
  const claims = claimsBySource.get(source);
  claims?.delete(requestId);
  if (claims?.size) return;
  clearSource(source);
}

function clearSource(source: string): void {
  for (const id of claimsBySource.get(source) ?? [])
    sourceByRequestId.delete(id);
  claimsBySource.delete(source);
  const blobUrl = blobBySource.get(source);
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    owned.delete(blobUrl);
  }
  blobBySource.delete(source);
  abortBySource.get(source)?.abort();
  abortBySource.delete(source);
}

function recycleOtherSources(retainedSource: string): void {
  const sources = new Set([
    ...claimsBySource.keys(),
    ...blobBySource.keys(),
    ...inFlightBySource.keys(),
  ]);
  for (const source of sources) {
    if (source !== retainedSource) clearSource(source);
  }
}

function addClaim(source: string, requestId: string): void {
  const claims = claimsBySource.get(source) ?? new Set<string>();
  claims.add(requestId);
  claimsBySource.set(source, claims);
  sourceByRequestId.set(requestId, source);
}

function trustedBackground(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.url === undefined || sender.url === "") return true;
  return sender.url === chrome.runtime.getURL("background.js");
}

async function fetchImage(url: string, signal: AbortSignal): Promise<Blob> {
  return fetchGalleryWebp(url, fetch, undefined, signal);
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    const messageType = (message as { type?: unknown }).type;
    if (messageType !== MESSAGE_TYPE && messageType !== ARCHIVE_MESSAGE_TYPE)
      return false;
    if (!trustedBackground(sender)) {
      sendResponse({ ok: false, error: "gallery_untrusted_sender" });
      return false;
    }

    if (messageType === ARCHIVE_MESSAGE_TYPE) {
      const request = message as {
        action?: unknown;
        input?: unknown;
        key?: unknown;
      };
      if (
        request.action === "stagePage" &&
        request.input &&
        typeof request.input === "object"
      ) {
        void archive
          .stagePage(request.input as Parameters<typeof archive.stagePage>[0])
          .then(
            (value) => sendResponse({ ok: true, ...value }),
            (error: unknown) => {
              console.error("QueueCat archive staging failed", error);
              sendResponse({
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "gallery_archive_failed",
              });
            },
          )
          .finally(notifyBackgroundIfIdle);
        return true;
      }
      if (
        request.action === "pack" &&
        request.input &&
        typeof request.input === "object"
      ) {
        void archive
          .pack(request.input as Parameters<typeof archive.pack>[0])
          .then(
            (value) => sendResponse({ ok: true, ...value }),
            (error: unknown) =>
              sendResponse({
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "gallery_archive_failed",
              }),
          )
          .finally(notifyBackgroundIfIdle);
        return true;
      }
      if (request.action === "cleanup" && typeof request.key === "string") {
        void archive.cleanup(request.key).then(
          () => {
            sendResponse({ ok: true, idle: isIdle() });
            notifyBackgroundIfIdle();
          },
          (error: unknown) =>
            sendResponse({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "gallery_archive_failed",
            }),
        );
        return true;
      }
      sendResponse({ ok: false, error: "gallery_archive_failed" });
      return false;
    }

    const request = message as TransportMessage;
    if (
      typeof request.requestId !== "string" ||
      request.requestId.length > 100
    ) {
      sendResponse({ ok: false, error: "gallery_invalid_request" });
      return false;
    }

    if (request.action === "status") {
      sendResponse({ ok: true, idle: isIdle() });
      return false;
    }

    if (request.action === "prepare") {
      if (!isSafeGalleryImageUrl(request.url)) {
        sendResponse({ ok: false, error: "gallery_invalid_image_url" });
        return false;
      }
      const requestSource = sourceByRequestId.get(request.requestId);
      if (requestSource && requestSource !== request.url) {
        sendResponse({ ok: false, error: "gallery_request_id_conflict" });
        return false;
      }
      recycleOtherSources(request.url);
      const existingBlob = blobBySource.get(request.url);
      if (existingBlob) {
        addClaim(request.url, request.requestId);
        sendResponse({ ok: true, blobUrl: existingBlob });
        return false;
      }

      let fetchPromise = inFlightBySource.get(request.url);
      if (!fetchPromise && owned.size + inFlightBySource.size >= MAX_BLOBS) {
        sendResponse({ ok: false, error: "gallery_blob_capacity_reached" });
        return false;
      }
      addClaim(request.url, request.requestId);
      if (!fetchPromise) {
        const controller = new AbortController();
        abortBySource.set(request.url, controller);
        let createdPromise: Promise<string>;
        createdPromise = fetchImage(request.url, controller.signal)
          .then((blob) => {
            if (!claimsBySource.get(request.url)?.size)
              throw new Error("gallery_request_cancelled");
            const blobUrl = URL.createObjectURL(blob);
            owned.add(blobUrl);
            blobBySource.set(request.url, blobUrl);
            return blobUrl;
          })
          .finally(() => {
            if (abortBySource.get(request.url) === controller)
              abortBySource.delete(request.url);
            if (inFlightBySource.get(request.url) === createdPromise)
              inFlightBySource.delete(request.url);
          });
        fetchPromise = createdPromise;
        inFlightBySource.set(request.url, fetchPromise);
      }
      const sharedPromise = fetchPromise;
      void (async () => {
        try {
          const blobUrl = await sharedPromise;
          if (inFlightBySource.get(request.url) === sharedPromise)
            inFlightBySource.delete(request.url);
          sendResponse({ ok: true, blobUrl });
        } catch (error: unknown) {
          if (inFlightBySource.get(request.url) === sharedPromise)
            inFlightBySource.delete(request.url);
          clearClaim(request.url, request.requestId);
          sendResponse({
            ok: false,
            error:
              error instanceof Error ? error.message : "gallery_fetch_failed",
            idle: isIdle(),
          });
          notifyBackgroundIfIdle();
        }
      })();
      return true;
    }

    if (request.action === "cancel") {
      if (
        !isSafeGalleryImageUrl(request.url) ||
        sourceByRequestId.get(request.requestId) !== request.url
      ) {
        sendResponse({ ok: true, idle: isIdle() });
        return false;
      }
      clearClaim(request.url, request.requestId);
      sendResponse({ ok: true, idle: isIdle() });
      notifyBackgroundIfIdle();
      return false;
    }

    if (request.action === "release") {
      if (
        !isExtensionBlobUrl(request.blobUrl, chrome.runtime.getURL("/")) ||
        !owned.has(request.blobUrl)
      ) {
        sendResponse({
          ok: true,
          idle: isIdle(),
        });
        return false;
      }
      for (const [source, blobUrl] of blobBySource) {
        if (blobUrl === request.blobUrl) {
          clearSource(source);
          break;
        }
      }
      sendResponse({ ok: true, idle: isIdle() });
      notifyBackgroundIfIdle();
      return false;
    }

    sendResponse({ ok: false, error: "gallery_invalid_action" });
    return false;
  },
);
