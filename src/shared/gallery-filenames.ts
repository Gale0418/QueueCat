const ARCHIVE_FILENAME_MAX_BYTES = 240;
const WEBP_EXTENSION = ".webp";
const encoder = new TextEncoder();

const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const TRAILING_DOTS_OR_WHITESPACE = /[.\s]+$/u;
const WINDOWS_RESERVED_DEVICE =
  /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i;

function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8Length(character);
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function cleanBaseName(name: string, index: number, extension: string): string {
  const safeName = name
    .replace(WINDOWS_FORBIDDEN, "_")
    .replace(TRAILING_DOTS_OR_WHITESPACE, "");
  const lastDot = safeName.lastIndexOf(".");
  let base = lastDot > 0 ? safeName.slice(0, lastDot) : safeName;

  base = base.replace(/^[.\s]+/u, "").replace(TRAILING_DOTS_OR_WHITESPACE, "");
  if (!base) base = String(index + 1).padStart(4, "0");

  if (WINDOWS_RESERVED_DEVICE.test(base)) base = `_${base}`;
  const truncated = truncateUtf8(
    base,
    ARCHIVE_FILENAME_MAX_BYTES - utf8Length(extension),
  ).replace(TRAILING_DOTS_OR_WHITESPACE, "");
  return truncated || String(index + 1).padStart(4, "0");
}

function filenameKey(filename: string): string {
  return filename.normalize("NFC").toLowerCase();
}

function withCollisionSuffix(
  base: string,
  suffix: number,
  extension: string,
): string {
  const marker = ` (${suffix})`;
  const baseBudget =
    ARCHIVE_FILENAME_MAX_BYTES - utf8Length(extension) - utf8Length(marker);
  const shortened = truncateUtf8(base, baseBudget).replace(
    TRAILING_DOTS_OR_WHITESPACE,
    "",
  );
  return `${shortened}${marker}${extension}`;
}

const IMAGE_EXTENSION = /^\.(?:webp|jpe?g|png|gif|avif)$/i;

/**
 * Build safe, flat ZIP entry names from Hitomi's original image names.
 * The caller validates that names is a non-empty array of strings.
 */
export function galleryArchiveFilenames(
  names: readonly string[],
  extensions?: readonly string[],
): string[] {
  const normalizedExtensions = names.map((_, index) => {
    const candidate = extensions?.[index] ?? WEBP_EXTENSION;
    return IMAGE_EXTENSION.test(candidate)
      ? candidate.toLowerCase()
      : WEBP_EXTENSION;
  });
  const bases = names.map((name, index) =>
    cleanBaseName(name, index, normalizedExtensions[index]),
  );
  const originals = new Set(
    bases.map((base, index) =>
      filenameKey(`${base}${normalizedExtensions[index]}`),
    ),
  );
  const claimed = new Set<string>();

  return bases.map((base, index) => {
    const extension = normalizedExtensions[index];
    const filename = `${base}${extension}`;
    const key = filenameKey(filename);
    if (!claimed.has(key)) {
      claimed.add(key);
      return filename;
    }

    let suffix = 2;
    let candidate = withCollisionSuffix(base, suffix, extension);
    let candidateKey = filenameKey(candidate);
    while (originals.has(candidateKey) || claimed.has(candidateKey)) {
      suffix++;
      candidate = withCollisionSuffix(base, suffix, extension);
      candidateKey = filenameKey(candidate);
    }
    claimed.add(candidateKey);
    return candidate;
  });
}
