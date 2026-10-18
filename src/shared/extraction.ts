import type { ExtractionGroup, QueueItem } from "./types";

/** Group only explicitly selected links, never neighboring files on disk. */
export function planExtractions(
  items: QueueItem[],
  filename?: (item: QueueItem) => string,
): ExtractionGroup[] {
  const groups = new Map<
    string,
    { ids: string[]; parts: number[]; first: number }
  >();
  for (const item of items) {
    let name: string;
    try {
      name = filename
        ? filename(item)
        : decodeURIComponent(
            new URL(item.sourceUrl).pathname.split("/").pop() || "",
          ).replace(/\.html?$/i, "");
    } catch {
      throw new Error("invalid_archive");
    }
    const part = /^(.*)\.part(\d+)\.rar$/i.exec(name);
    const split = /^(.*\.(?:7z|zip))\.(\d{3})$/i.exec(name);
    const legacy = /^(.*)\.r(\d{2})$/i.exec(name);
    let key: string,
      index: number,
      first = 1;
    if (part) {
      key = `${part[1]}.part.rar`;
      index = Number(part[2]);
    } else if (split) {
      key = `split:${split[1]}`;
      index = Number(split[2]);
    } else if (legacy) {
      key = `${legacy[1]}.rar`;
      index = Number(legacy[2]) + 1;
      first = 0;
    } else if (/\.(rar|zip|7z)$/i.test(name)) {
      key = name;
      index = 0;
      first = 0;
    } else throw new Error("invalid_archive");
    if (!Number.isSafeInteger(index) || index < first || index > 10000)
      throw new Error("missing_volumes");
    const group = groups.get(key.toLowerCase()) || {
      ids: [],
      parts: [],
      first,
    };
    group.first = Math.min(group.first, first);
    group.ids.push(item.id);
    group.parts.push(index);
    groups.set(key.toLowerCase(), group);
  }
  return [...groups.values()].map((g) => {
    const sorted = [...g.parts].sort((a, b) => a - b);
    if (sorted.some((part, i) => part !== g.first + i))
      throw new Error("missing_volumes");
    return { id: crypto.randomUUID(), itemIds: g.ids, status: "waiting" };
  });
}

export interface NativeReply {
  ok: boolean;
  status?: "queued" | "extracting" | "complete" | "failed";
  outputDir?: string;
  errorCode?: string;
  sevenZipAvailable?: boolean;
}
export type NativeRequest =
  | { op: "ping" }
  | { op: "store-secret"; id: string; password: string }
  | { op: "forget-secret"; id: string }
  | { op: "start"; id: string; secretId: string; paths: string[] }
  | { op: "status"; id: string };

export function extractionError(code?: string): string {
  if (code === "secret-expired" || code === "secret-not-found")
    return "password_expired";
  if (code === "seven-zip-unavailable") return "engine_unavailable";
  if (/volume/.test(code || "")) return "missing_volumes";
  if (/unsafe|links-not-allowed/.test(code || "")) return "unsafe_archive";
  if (/source-|invalid-path|different-parent|duplicate-path/.test(code || ""))
    return "source_unavailable";
  if (code === "job-not-found") return "unknown_job";
  if (
    /preflight|archive-test-failed|seven-zip-failed|extract-failed/.test(
      code || "",
    )
  )
    return "password_or_corrupt";
  if (code === "unsupported-archive") return "invalid_archive";
  return "extraction_failed";
}
