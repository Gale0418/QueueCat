import type { QueueItem } from "../shared/types";
import { galleryCopy } from "../shared/gallery-copy";
import { translateGalleryMessage } from "../shared/gallery-messages";

export function galleryMessage(item: QueueItem, raw = item.reason): string {
  if (!item.gallery) return raw || "";
  if (raw) return translateGalleryMessage(raw);
  if (item.gallery.output === "zip") {
    if (item.status === "complete") return galleryCopy("zipComplete");
    if (item.status === "downloading") return galleryCopy("zipSaving");
    if (item.status === "handoff" || item.gallery.archive?.phase === "ready")
      return galleryCopy("zipReady");
    if (item.gallery.archive?.phase === "packing")
      return galleryCopy("packing");
    if (item.status === "preparing") return galleryCopy("collecting");
  }
  if (item.status === "preparing") return galleryCopy("reading");
  if (item.status === "complete") return galleryCopy("complete");
  if (item.status === "failed") return galleryCopy("failed");
  return "";
}

export function galleryPageProgress(item: QueueItem): string {
  const gallery = item.gallery;
  if (!gallery) return "";
  const total = gallery.total ?? gallery.images?.length;
  const zip = gallery.output === "zip" && item.status !== "complete";
  const done = Math.max(
    0,
    (zip ? gallery.archive?.staged : gallery.completed) || 0,
  );
  return total !== undefined && total > 0
    ? galleryCopy(zip ? "stagedProgress" : "progress")
        .replace("{done}", String(done))
        .replace("{total}", String(total))
    : galleryCopy("unknownProgress").replace("{done}", String(done));
}

export function galleryPercent(item: QueueItem): number | undefined {
  if (item.gallery?.output === "zip") {
    if (item.status === "complete") return 100;
    // Collection and packaging are separate phases, not a fabricated overall %.
    if (
      item.status !== "downloading" ||
      !item.totalBytes ||
      item.totalBytes <= 0
    )
      return undefined;
    return Math.max(
      0,
      Math.min(100, ((item.bytesReceived || 0) / item.totalBytes) * 100),
    );
  }
  const total = item.gallery?.total ?? item.gallery?.images?.length;
  if (!total || total < 1) return undefined;
  return Math.max(
    0,
    Math.min(100, ((item.gallery?.completed || 0) / total) * 100),
  );
}
