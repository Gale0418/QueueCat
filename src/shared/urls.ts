export const KATFILE_HOSTS = ["katfile.com", "katfile.biz"];
export function isKatfileHost(hostname: string): boolean {
  return KATFILE_HOSTS.some(
    (host) => hostname === host || hostname.endsWith("." + host),
  );
}
export function normalizeSource(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !KATFILE_HOSTS.includes(url.hostname.replace(/^www\./, "")) ||
      url.username ||
      url.password
    )
      return null;
    // XFileSharing 的檔案識別碼；只收檔案頁，不收登入、首頁或任意管理網址。
    if (!/^\/[a-z0-9]{12}(?:\/[^\s]*)?\/?$/i.test(url.pathname)) return null;
    url.protocol = "https:";
    url.hostname = url.hostname.replace(/^www\./, "");
    url.hash = "";
    url.port = "";
    return url.href;
  } catch {
    return null;
  }
}
export function sourceKey(raw: string): string {
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
