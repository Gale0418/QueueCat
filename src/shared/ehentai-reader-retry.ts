import { parseGallerySource } from "./gallery-sources";
import type { QueueItem } from "./types";

const READER_TAB_RETRY_REASONS = new Set([
  "gallery_unavailable",
  "gallery_access_required",
  "gallery_content_warning",
  "gallery_invalid_metadata",
  "gallery_reader_tab_required",
  "gallery_reader_tab_unavailable",
]);

export function canRetryEhentaiReaderInTab(item: QueueItem): boolean {
  if (
    !item.gallery ||
    item.ehArchive ||
    item.downloadId !== undefined ||
    item.action ||
    (item.status !== "failed" && item.status !== "blocked") ||
    !READER_TAB_RETRY_REASONS.has(item.reason || "")
  ) return false;

  const source = parseGallerySource(item.sourceUrl);
  return source?.site === "ehentai" && source.id === item.gallery.id;
}
