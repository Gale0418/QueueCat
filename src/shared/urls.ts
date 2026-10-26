// 接受 katfile.<任意單一網域尾碼>；不宣稱該網域由 Katfile 擁有。
const KATFILE_DOMAIN = /^katfile\.[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i;
export function isKatfileSourceHost(hostname: string): boolean {
  return KATFILE_DOMAIN.test(hostname.replace(/^www\./i, ""));
}
export function isKatfileHost(hostname: string): boolean {
  // 最終下載網址可位於同類網域的 CDN 子網域。
  return KATFILE_DOMAIN.test(hostname.split(".").slice(-2).join("."));
}
export function hitomiGalleryId(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["hitomi.la", "www.hitomi.la"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return undefined;
    const match =
      /^\/(?:reader|galleries)\/([1-9]\d{0,9})\.html$/.exec(url.pathname) ||
      /^\/(?:doujinshi|manga|cg|gamecg|artistcg|anime|imageset)\/[^/]+-([1-9]\d{0,9})\.html$/.exec(
        url.pathname,
      );
    return match?.[1];
  } catch {
    return undefined;
  }
}
export function normalizeSource(raw: string): string | null {
  const galleryId = hitomiGalleryId(raw);
  if (galleryId) return `https://hitomi.la/galleries/${galleryId}.html`;
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !isKatfileSourceHost(url.hostname) ||
      url.username ||
      url.password
    )
      return null;
    // XFileSharing 的檔案識別碼；只收檔案頁，不收登入、首頁或任意管理網址。
    if (!/^\/[a-z0-9]{12}(?:\/[^\s]*)?\/?$/i.test(url.pathname)) return null;
    url.protocol = "https:";
    url.hostname = url.hostname.replace(/^www\./, "");
    if (url.hostname === "katfile.cloud") url.hostname = "katfile.co";
    url.hash = "";
    url.port = "";
    return url.href;
  } catch {
    return null;
  }
}
/** 只遷移已知舊來源網域，不改寫 CDN 下載連結或其他站點。 */
export function migrateLegacyKatfileSource(raw: string): string {
  try {
    if (!["katfile.cloud", "www.katfile.cloud"].includes(new URL(raw).hostname))
      return raw;
    return normalizeSource(raw) ?? raw;
  } catch {
    return raw;
  }
}
export function sourceKey(raw: string): string {
  const galleryId = hitomiGalleryId(raw);
  if (galleryId) return `hitomi:${galleryId}`;
  try {
    const url = new URL(raw);
    return (url.pathname.split("/")[1] || "").toLowerCase();
  } catch {
    return `invalid:${String(raw)}`;
  }
}
export interface UrlPreview {
  url: string;
  normalized?: string;
  status: "valid" | "duplicate" | "unsupported";
}
export function previewUrls(
  text: string,
  existing: string[] = [],
): UrlPreview[] {
  const seen = new Set(existing.map(sourceKey));
  return text.split(/\r?\n/).flatMap((line) => {
    const parts =
      line.match(/https?:\/\/[^\s<>"「」]+/gi) ??
      (line.trim() ? [line.trim()] : []);
    return parts.map((part) => {
      const url = part.replace(/[),，。；;\]）]+$/, "");
      const normalized = normalizeSource(url);
      if (!normalized) return { url, status: "unsupported" as const };
      const key = sourceKey(normalized);
      const status = seen.has(key)
        ? ("duplicate" as const)
        : ("valid" as const);
      seen.add(key);
      return { url, normalized, status };
    });
  });
}
