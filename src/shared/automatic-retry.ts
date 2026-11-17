import type { QueueItem } from "./types";

const GALLERY_FAILURES = new Set([
  "gallery_request_failed",
  "gallery_invalid_metadata",
  "gallery_archive_failed",
]);
const CHROME_ERRORS = new Set([
  "NETWORK_FAILED",
  "NETWORK_TIMEOUT",
  "NETWORK_DISCONNECTED",
  "NETWORK_SERVER_DOWN",
  "SERVER_FAILED",
  "SERVER_UNREACHABLE",
]);

export function isRetryableChromeError(error?: string): boolean {
  return error !== undefined && CHROME_ERRORS.has(error);
}

// Chrome downloads remain candidates until the engine checks the saved ID.
export function isAutomaticRetryCandidate(item: QueueItem): boolean {
  if (item.status !== "failed" || item.autoRetried || item.ehArchive)
    return false;
  if (item.downloadId !== undefined) {
    return (
      item.action?.kind === "download" &&
      !!item.action.expectedUrl &&
      isRetryableChromeError(item.reason?.split("：").at(-1))
    );
  }
  if (item.action) return false;
  return item.gallery
    ? GALLERY_FAILURES.has(item.reason || "")
    : !!item.reason?.startsWith("無法開啟來源分頁：");
}
