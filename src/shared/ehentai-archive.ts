import { parseGallerySource } from "./gallery-sources";

export interface EhentaiArchiveRecord {
  url: string;
  finalUrl?: string;
  referrer?: string;
  filename?: string;
  mime?: string;
}

interface ArchiveIdentity {
  gid: string;
  token: string;
}

const EHENTAI_ORIGIN = "https://e-hentai.org";
const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
]);

function parseHttpsUrl(raw: string | undefined): URL | undefined {
  if (typeof raw !== "string" || raw.length > 4096) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function isEhentaiHost(url: URL | undefined): boolean {
  return url?.origin === EHENTAI_ORIGIN;
}

function isEhentaiImpersonation(url: URL | undefined): boolean {
  if (!url || isEhentaiHost(url)) return false;
  const host = url.hostname;
  return host.startsWith("e-hentai.org.") || host.endsWith(".e-hentai.org");
}

function isSafeHttpsDestination(url: URL | undefined): url is URL {
  if (!url || url.hostname.includes(":") || !url.hostname.includes(".")) return false;
  if (
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|localdomain)$/.test(url.hostname)
  ) {
    return false;
  }
  return true;
}

function archiveIdentity(raw: string | undefined): ArchiveIdentity | undefined {
  const url = parseHttpsUrl(raw);
  if (!url || !isEhentaiHost(url) || url.pathname !== "/archiver.php") return undefined;

  const gids = url.searchParams.getAll("gid");
  const tokens = url.searchParams.getAll("token");
  if (
    gids.length !== 1 ||
    tokens.length !== 1 ||
    !/^[1-9]\d{0,9}$/.test(gids[0]) ||
    !/^[a-f0-9]{10}$/.test(tokens[0])
  ) return undefined;

  return { gid: gids[0], token: tokens[0] };
}

function isOfficialArchiverEndpoint(raw: string | undefined): boolean {
  const url = parseHttpsUrl(raw);
  return !!url && isEhentaiHost(url) && url.pathname === "/archiver.php";
}

function hasZipFeature(record: EhentaiArchiveRecord): boolean {
  const filename = record.filename?.trim();
  const url = parseHttpsUrl(record.url);
  const finalUrl = parseHttpsUrl(record.finalUrl);
  const zipName = /\.zip$/i.test(filename || "") ||
    [url?.pathname, finalUrl?.pathname].some((path) => !!path && /\.zip$/i.test(path));
  const mime = record.mime?.split(";", 1)[0].trim().toLowerCase();
  if (mime && ZIP_MIME_TYPES.has(mime)) return true;
  if (mime && mime !== "application/octet-stream") return false;
  return zipName;
}

function isOriginOnlyEhentaiReferrer(raw: string | undefined): boolean {
  const url = parseHttpsUrl(raw);
  return !!url && isEhentaiHost(url) && url.pathname === "/" && !url.search && !url.hash;
}

/** Convert a supported E-Hentai single-gallery URL to its archive page URL. */
export function ehentaiArchiveUrl(sourceUrl: string): string | undefined {
  const source = parseGallerySource(sourceUrl);
  if (source?.site !== "ehentai") return undefined;
  const token = new URL(source.url).pathname.split("/")[3];
  return `${EHENTAI_ORIGIN}/archiver.php?gid=${encodeURIComponent(source.id)}&token=${encodeURIComponent(token)}`;
}

/** Check that a tab is the exact official archive page for a gallery. */
export function isEhentaiArchivePage(sourceUrl: string, raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const expectedUrl = ehentaiArchiveUrl(sourceUrl);
  if (!expectedUrl) return false;
  const expected = archiveIdentity(expectedUrl)!;
  const actual = archiveIdentity(raw);
  return actual?.gid === expected.gid && actual.token === expected.token;
}

/** Match a ZIP download to the exact official E-Hentai gallery archive identity. */
export function isEhentaiArchiveDownload(
  sourceUrl: string,
  record: EhentaiArchiveRecord,
): boolean {
  const expectedUrl = ehentaiArchiveUrl(sourceUrl);
  if (!expectedUrl || !hasZipFeature(record)) return false;
  const expected = archiveIdentity(expectedUrl)!;
  const candidates = [record.url, record.finalUrl, record.referrer];
  if (candidates.some((candidate) => isOfficialArchiverEndpoint(candidate) && !archiveIdentity(candidate))) {
    return false;
  }
  const identities = candidates.map(archiveIdentity).filter(
    (identity): identity is ArchiveIdentity => identity !== undefined,
  );
  if (!identities.some((identity) => identity.gid === expected.gid && identity.token === expected.token)) {
    return false;
  }
  if (identities.some((identity) => identity.gid !== expected.gid || identity.token !== expected.token)) {
    return false;
  }

  const url = parseHttpsUrl(record.url);
  const finalUrl = parseHttpsUrl(record.finalUrl);
  if (!isSafeHttpsDestination(url)) return false;
  if (record.finalUrl && !isSafeHttpsDestination(finalUrl)) return false;
  if (isEhentaiImpersonation(url) || isEhentaiImpersonation(finalUrl)) return false;

  // A full exact archiver referrer is evidence of a browser-started official download,
  // including when E-Hentai redirects it to an HTTPS CDN.
  const hasExactReferrer = identities.some(
    (identity) => identity.gid === expected.gid && identity.token === expected.token,
  ) && archiveIdentity(record.referrer) !== undefined;
  if (hasExactReferrer) return true;
  return [url, finalUrl].some(isEhentaiHost);
}

/** Identify a user-selected ZIP with a direct, origin-only E-Hentai referrer. */
export function isEhentaiArchiveCandidate(
  record: EhentaiArchiveRecord,
  sourceUrl?: string,
): boolean {
  if (!hasZipFeature(record)) return false;
  const url = parseHttpsUrl(record.url);
  const finalUrl = parseHttpsUrl(record.finalUrl);
  const destinations = [url, finalUrl];
  if (!isSafeHttpsDestination(url)) return false;
  if (record.finalUrl && !isSafeHttpsDestination(finalUrl)) return false;
  if (isEhentaiImpersonation(url) || isEhentaiImpersonation(finalUrl)) return false;
  const candidates = [record.url, record.finalUrl, record.referrer];
  if (candidates.some((candidate) => isOfficialArchiverEndpoint(candidate) && !archiveIdentity(candidate))) {
    return false;
  }
  const identities = candidates.map(archiveIdentity).filter(
    (identity): identity is ArchiveIdentity => identity !== undefined,
  );
  if (sourceUrl) {
    const expectedUrl = ehentaiArchiveUrl(sourceUrl);
    if (!expectedUrl) return false;
    const expected = archiveIdentity(expectedUrl)!;
    if (identities.some((identity) => identity.gid !== expected.gid || identity.token !== expected.token)) {
      return false;
    }
  }
  if (identities.length > 0) {
    return destinations.some((destination) =>
      isEhentaiHost(destination) || isSafeHttpsDestination(destination),
    );
  }
  if (record.referrer === undefined && destinations.some(isEhentaiHost)) return true;
  if (!isOriginOnlyEhentaiReferrer(record.referrer)) return false;
  return [url, finalUrl].some((destination) =>
    isEhentaiHost(destination) ||
    isSafeHttpsDestination(destination),
  );
}
