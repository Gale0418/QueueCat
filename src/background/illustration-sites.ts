import { isGalleryMediaUrl, type GallerySource, type GallerySite } from "../shared/gallery-sources";
import {
  attribute,
  elementText,
  gallerySiteError,
  htmlElements,
  type GalleryHttp,
  type GallerySiteAdapter,
} from "./gallery-site-http";

const MAX_PAGES = 2_000;
const ID_PATTERN = /^[1-9]\d{0,9}$/;
const DATA_ID_PATTERN = /^[a-f\d]{64}$/i;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSource(source: GallerySource, site: GallerySite): string {
  if (source.site !== site || !ID_PATTERN.test(source.id)) {
    throw gallerySiteError("gallery_invalid_metadata");
  }
  return source.id;
}

function cleanTitle(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const title = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return title ? title.slice(0, 300) : fallback;
}

function safeMediaUrl(site: GallerySite, value: unknown): value is string {
  return isGalleryMediaUrl(site, value);
}

function dataId(value: unknown): string {
  if (typeof value !== "string" || !DATA_ID_PATTERN.test(value)) {
    throw gallerySiteError("gallery_invalid_metadata");
  }
  return value.toLowerCase();
}

function nozomiPostUrl(id: string): string {
  return `https://j.gold-usergeneratedcontent.net/post/${id.at(-1)}/${id.slice(-3, -1)}/${id}.json`;
}

const nozomi: GallerySiteAdapter = {
  async load(source, http) {
    const id = requireSource(source, "nozomi");
    const raw = await http.json(nozomiPostUrl(id));
    if (!isRecord(raw) || String(raw.postid) !== id || !Array.isArray(raw.imageurls) ||
      raw.imageurls.length < 1 || raw.imageurls.length > MAX_PAGES) {
      throw gallerySiteError("gallery_invalid_metadata");
    }

    const pages: string[] = [];
    for (const image of raw.imageurls) {
      if (!isRecord(image)) throw gallerySiteError("gallery_invalid_metadata");
      const isVideo = image.is_video === true ||
        (typeof image.is_video === "string" && image.is_video.trim() !== "" && image.is_video !== "0");
      if (isVideo) throw gallerySiteError("gallery_unsupported_media");
      if (typeof image.type !== "string" || /^(?:webm|mp4|m4v|mov|swf)$/i.test(image.type)) {
        throw gallerySiteError("gallery_unsupported_media");
      }
      if (!/^(?:jpe?g|png|gif|webp|avif)$/i.test(image.type)) {
        throw gallerySiteError("gallery_invalid_metadata");
      }

      const hash = dataId(image.dataid);
      const host = image.type === "gif" ? "g" : "w";
      const extension = image.type.toLowerCase() === "gif" ? "gif" : "webp";
      const url = `https://${host}.gold-usergeneratedcontent.net/${hash.at(-1)}/${hash.slice(-3, -1)}/${hash}.${extension}`;
      if (!safeMediaUrl("nozomi", url)) throw gallerySiteError("gallery_invalid_metadata");
      pages.push(url);
    }
    return { title: cleanTitle(raw.title, `Nozomi #${id}`), pages };
  },
};

const danbooru: GallerySiteAdapter = {
  async load(source, http) {
    const id = requireSource(source, "danbooru");
    const raw = await http.json(`https://danbooru.donmai.us/posts/${id}.json`);
    if (!isRecord(raw) || String(raw.id) !== id) {
      throw gallerySiteError("gallery_invalid_metadata");
    }
    if (typeof raw.file_ext === "string" && /^(?:webm|mp4|swf)$/i.test(raw.file_ext)) {
      throw gallerySiteError("gallery_unsupported_media");
    }

    if (typeof raw.file_url !== "string" || !raw.file_url.trim()) {
      throw gallerySiteError("gallery_access_required");
    }
    const imageUrl = raw.file_url;
    if (!safeMediaUrl("danbooru", imageUrl)) throw gallerySiteError("gallery_invalid_metadata");
    return {
      title: cleanTitle(raw.artist_commentary_title, `Danbooru #${id}`),
      pages: [imageUrl],
    };
  },
};

function gelbooruPost(raw: unknown, requestedId: string): JsonRecord {
  const posts = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.post) ? raw.post :
    isRecord(raw) && isRecord(raw.post) ? [raw.post] : [];
  if (posts.length !== 1 || !isRecord(posts[0]) || String(posts[0].id) !== requestedId) {
    throw gallerySiteError("gallery_invalid_metadata");
  }
  return posts[0];
}

const gelbooru: GallerySiteAdapter = {
  async load(source, http) {
    const id = requireSource(source, "gelbooru");
    const query = new URLSearchParams({
      page: "dapi",
      s: "post",
      q: "index",
      id,
      json: "1",
    });
    const post = gelbooruPost(
      await http.json(`https://gelbooru.com/index.php?${query.toString()}`),
      id,
    );
    const imageUrl = post.file_url;
    if ((typeof imageUrl === "string" && /\.(?:webm|mp4|m4v|mov|swf)$/i.test(imageUrl)) ||
      (typeof post.file_ext === "string" && /^(?:webm|mp4|m4v|mov|swf)$/i.test(post.file_ext))) {
      throw gallerySiteError("gallery_unsupported_media");
    }
    if (!safeMediaUrl("gelbooru", imageUrl)) {
      throw gallerySiteError("gallery_invalid_metadata");
    }
    return { title: cleanTitle(post.title, `Gelbooru #${id}`), pages: [imageUrl] };
  },
};

function imageObjectFromJsonLd(value: unknown): JsonRecord[] {
  const found: JsonRecord[] = [];
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (++visited > 20_000) throw gallerySiteError("gallery_invalid_metadata");
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;

    const type = current["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("ImageObject")) found.push(current);
    pending.push(...Object.values(current));
  }
  return found;
}

function zerochanImageObjects(html: string): JsonRecord[] {
  const found: JsonRecord[] = [];
  for (const element of htmlElements(html)) {
    if (element.tagName !== "script" ||
      attribute(element, "type")?.trim().toLowerCase() !== "application/ld+json") continue;
    try {
      found.push(...imageObjectFromJsonLd(JSON.parse(elementText(element)) as unknown));
    } catch (error) {
      if (error instanceof Error && "code" in error) throw error;
      // Other JSON-LD blocks may be unrelated or malformed; valid ImageObjects
      // from a separate block on the same public page remain usable.
    }
  }
  return found;
}

const zerochan: GallerySiteAdapter = {
  async load(source, http) {
    const id = requireSource(source, "zerochan");
    const html = await http.text(`https://www.zerochan.net/${id}`);
    const idFile = new RegExp(`(?:^|[/.])${id}\\.(?:jpe?g|png|gif|webp|avif)$`, "i");
    for (const item of zerochanImageObjects(html)) {
      const contentUrl = item.contentUrl;
      if (!safeMediaUrl("zerochan", contentUrl)) continue;
      const parsed = new URL(contentUrl);
      if (!idFile.test(parsed.pathname)) continue;
      return {
        title: cleanTitle(item.name, `Zerochan #${id}`),
        pages: [contentUrl],
      };
    }
    throw gallerySiteError("gallery_invalid_metadata");
  },
};

export const illustrationAdapters: Record<"nozomi" | "danbooru" | "gelbooru" | "zerochan", GallerySiteAdapter> = {
  nozomi,
  danbooru,
  gelbooru,
  zerochan,
};
