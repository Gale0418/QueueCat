export type GallerySite =
  | "hitomi"
  | "ehentai"
  | "nhentai"
  | "hentaifox"
  | "nozomi"
  | "danbooru"
  | "gelbooru"
  | "zerochan";

export interface GallerySource {
  site: GallerySite;
  id: string;
  url: string;
}

const ID = "[1-9]\\d{0,9}";

export function parseGallerySource(raw: string): GallerySource | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    return undefined;

  const path = url.pathname;
  const host = url.hostname.replace(/^www\./, "");
  const match = (pattern: string) => new RegExp(`^${pattern}$`).exec(path);
  switch (host) {
    case "hitomi.la": {
      const id = (match(`/(?:reader|galleries)/(${ID})\\.html`) ||
        match(
          `/(?:doujinshi|manga|cg|gamecg|artistcg|anime|imageset)/[^/]+-(${ID})\\.html`,
        ))?.[1];
      if (id)
        return {
          site: "hitomi",
          id,
          url: `https://hitomi.la/galleries/${id}.html`,
        };
      break;
    }
    case "e-hentai.org": {
      const gallery = match(`/g/(${ID})/([a-f0-9]{10})/?`);
      if (gallery)
        return {
          site: "ehentai",
          id: gallery[1],
          url: `https://e-hentai.org/g/${gallery[1]}/${gallery[2]}/`,
        };
      break;
    }
    case "nhentai.net": {
      const id = match(`/g/(${ID})(?:/${ID})?/?`)?.[1];
      if (id)
        return { site: "nhentai", id, url: `https://nhentai.net/g/${id}/` };
      break;
    }
    case "hentaifox.com": {
      const id = (match(`/gallery/(${ID})/?`) ||
        match(`/g/(${ID})/${ID}/?`))?.[1];
      if (id)
        return {
          site: "hentaifox",
          id,
          url: `https://hentaifox.com/gallery/${id}/`,
        };
      break;
    }
    case "nozomi.la": {
      const id = match(`/post/(${ID})(?:\\.html)?/?`)?.[1];
      if (id)
        return { site: "nozomi", id, url: `https://nozomi.la/post/${id}.html` };
      break;
    }
    case "danbooru.donmai.us": {
      const id = match(`/posts/(${ID})/?`)?.[1];
      if (id)
        return {
          site: "danbooru",
          id,
          url: `https://danbooru.donmai.us/posts/${id}`,
        };
      break;
    }
    case "gelbooru.com": {
      const id = url.searchParams.get("id");
      if (
        path === "/index.php" &&
        url.searchParams.get("page") === "post" &&
        url.searchParams.get("s") === "view" &&
        id &&
        new RegExp(`^${ID}$`).test(id)
      ) {
        return {
          site: "gelbooru",
          id,
          url: `https://gelbooru.com/index.php?page=post&s=view&id=${id}`,
        };
      }
      break;
    }
    case "zerochan.net": {
      const id = match(`/(${ID})/?`)?.[1];
      if (id)
        return { site: "zerochan", id, url: `https://www.zerochan.net/${id}` };
      break;
    }
  }
  return undefined;
}

const REFERERS: Record<GallerySite, string> = {
  hitomi: "https://hitomi.la/",
  ehentai: "https://e-hentai.org/",
  nhentai: "https://nhentai.net/",
  hentaifox: "https://hentaifox.com/",
  nozomi: "https://nozomi.la/",
  danbooru: "https://danbooru.donmai.us/",
  gelbooru: "https://gelbooru.com/",
  zerochan: "https://www.zerochan.net/",
};

export function galleryReferer(site: GallerySite): string {
  return REFERERS[site];
}

export function isGalleryMediaUrl(
  site: GallerySite,
  raw: unknown,
): raw is string {
  if (typeof raw !== "string" || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    return false;
  const host = url.hostname;
  if (site === "hitomi") {
    return /^https:\/\/w[12]\.gold-usergeneratedcontent\.net\/\d{1,16}\/\d{1,4}\/[0-9a-f]{64}\.webp$/.test(
      raw,
    );
  }
  if (site === "ehentai") {
    const imageName = /\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname);
    if (!imageName || url.search) return false;
    return (
      (/^(?:[a-z0-9-]+\.){1,2}hath\.network$/.test(host) &&
        /^\/h\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname)) ||
      // The public viewer can serve an image from its own H@H origin as well.
      (!url.port &&
        /^[a-z0-9-]+\.hath\.network$/.test(host) &&
        /^\/om\/\d{1,16}\/[a-z0-9-]+\/[a-z0-9-]+\/\d{1,5}\/[a-z0-9-]+\/[^/]+$/i.test(url.pathname))
    );
  }
  if (url.port || !/\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname))
    return false;
  switch (site) {
    case "hentaifox":
      return (
        /^i\d*\.hentaifox\.com$/.test(host) &&
        /^\/\d+\/\d+\//.test(url.pathname)
      );
    case "nozomi":
      return [
        "w.gold-usergeneratedcontent.net",
        "g.gold-usergeneratedcontent.net",
      ].includes(host);
    case "danbooru":
      return host === "cdn.donmai.us";
    case "gelbooru":
      return /^(?:img\d*|images)\.gelbooru\.com$/.test(host);
    case "zerochan":
      return host === "static.zerochan.net";
    default:
      return false;
  }
}
