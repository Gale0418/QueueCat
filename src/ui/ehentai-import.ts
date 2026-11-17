import { normalizeSource, sourceKey } from "../shared/urls";
import { parseGallerySource } from "../shared/gallery-sources";

export const EHENTAI_IMPORT_LIMIT = 50;

export interface EhentaiImportCandidate {
  url: string;
  title: string;
}

export interface EhentaiPageEntry {
  url: string;
  title: string;
}

/** This function is serialized by chrome.scripting.executeScript into the tab. */
export function readVisibleEhentaiWorks(): EhentaiPageEntry[] {
  if (
    location.origin !== "https://e-hentai.org" ||
    !location.pathname.startsWith("/tag/")
  )
    return [];
  const table = document.querySelector<HTMLElement>(".itg");
  if (!table) return [];

  const isVisible = (element: Element): boolean => {
    const style = getComputedStyle(element);
    return (
      element.getClientRects().length > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };

  const entries: EhentaiPageEntry[] = [];
  const seen = new Set<string>();
  for (const titleNode of table.querySelectorAll<HTMLElement>(".glink")) {
    if (!isVisible(titleNode)) continue;
    const title = titleNode.textContent
      ?.replace(/\s+/gu, " ")
      .trim();
    if (!title) continue;
    const row = titleNode.closest("tr");
    const candidates = [
      titleNode.closest<HTMLAnchorElement>("a[href]"),
      ...(row ? [...row.querySelectorAll<HTMLAnchorElement>("a[href]")] : []),
    ].filter((anchor): anchor is HTMLAnchorElement => !!anchor);
    const link = candidates.find(
      (anchor) => {
        if (!isVisible(anchor)) return false;
        try {
          const url = new URL(anchor.href, location.href);
          return (
            url.origin === location.origin &&
            /^\/g\/[1-9]\d{0,9}\/[a-f0-9]{10}\/?$/i.test(url.pathname)
          );
        } catch {
          return false;
        }
      },
    );
    if (!link || seen.has(link.href)) continue;
    seen.add(link.href);
    entries.push({ url: link.href, title });
    if (entries.length >= 50) break;
  }
  return entries;
}

export function normalizeEhentaiImportEntries(
  entries: readonly unknown[],
  existingUrls: readonly string[] = [],
  limit = EHENTAI_IMPORT_LIMIT,
): EhentaiImportCandidate[] {
  const seen = new Set(existingUrls.map(sourceKey));
  const result: EhentaiImportCandidate[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as { url?: unknown; title?: unknown };
    if (typeof value.url !== "string" || typeof value.title !== "string")
      continue;
    const source = parseGallerySource(value.url);
    const url = normalizeSource(value.url);
    const title = value.title.replace(/\s+/gu, " ").trim();
    if (!source || source.site !== "ehentai" || !url || !title) continue;
    const key = sourceKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ url, title });
    if (result.length >= limit) break;
  }
  return result;
}
