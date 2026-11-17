import {
  isGalleryMediaUrl,
  parseGallerySource,
} from "../shared/gallery-sources";
import type { EhentaiReaderTab, GalleryImage, GalleryImageRoute, GalleryManifest } from "../shared/types";
import {
  isEhentaiReaderPage,
  loadEhentaiReader,
  resolveEhentaiReaderImage,
  resolveEhentaiReaderRoute,
} from "./ehentai-reader";
import { createEhentaiTabHttp, findEhentaiReaderTab } from "./ehentai-tab";
import { createGalleryHttp, gallerySiteError, type GalleryHttp } from "./gallery-site-http";
import type { GallerySource } from "../shared/gallery-sources";
import { createHitomiClient } from "./hitomi";
import { illustrationAdapters } from "./illustration-sites";
import { mangaAdapters } from "./manga-sites";

const adapters = { ...mangaAdapters, ...illustrationAdapters };

async function imageIdentity(reference: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(reference),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createGallerySiteClient(
  fetcher: typeof fetch = fetch,
  readGelbooruCredentials?: Parameters<typeof createGalleryHttp>[1],
) {
  const hitomi = createHitomiClient(fetcher);
  const http = createGalleryHttp(fetcher, readGelbooruCredentials);
  const readerTabs = new Map<string, EhentaiReaderTab>();
  async function connectEhentaiReaderTab(sourceUrl: string): Promise<void> {
    const tab = await findEhentaiReaderTab(sourceUrl, true);
    if (!tab) throw gallerySiteError("gallery_reader_tab_required");
    readerTabs.set(sourceUrl, tab);
  }
  function readerHttp(source: GallerySource, useTab?: true, signal?: AbortSignal): GalleryHttp {
    if (!useTab) {
      return { ...http, text: (url, init) => http.text(url, { ...init, signal }) };
    }
    return {
      ...http,
      async text(url, init) {
        signal?.throwIfAborted();
        let tab = readerTabs.get(source.url);
        if (!tab) {
          await connectEhentaiReaderTab(source.url);
          tab = readerTabs.get(source.url)!;
        }
        try {
          return await createEhentaiTabHttp(source, tab, signal).text(url, init);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "gallery_reader_tab_required")
            throw error;
          readerTabs.delete(source.url);
          signal?.throwIfAborted();
          await connectEhentaiReaderTab(source.url);
          return createEhentaiTabHttp(source, readerTabs.get(source.url)!, signal).text(url, init);
        }
      },
    };
  }
  async function readerPage(image: GalleryImage, sourceUrl: string) {
    const source = parseGallerySource(sourceUrl);
    const page = image.source;
    if (
      source?.site !== "ehentai" ||
      !isEhentaiReaderPage(source, page) ||
      image.hash !== (await imageIdentity(`ehentai:${page}`))
    ) throw gallerySiteError("gallery_invalid_metadata");
    return { source, page };
  }
  return {
    async load(id: string, sourceUrl?: string, signal?: AbortSignal, useTab?: true): Promise<GalleryManifest> {
      if (!sourceUrl) return hitomi.load(id);
      const source = parseGallerySource(sourceUrl);
      if (!source || source.id !== id)
        throw gallerySiteError("gallery_invalid_metadata");
      if (source.site === "hitomi") return hitomi.load(id);
      if (source.site === "nhentai")
        throw gallerySiteError("gallery_invalid_metadata");

      const manifest =
        source.site === "ehentai"
          ? await loadEhentaiReader(source, readerHttp(source, useTab, signal))
          : await adapters[source.site].load(source, http).then(({ title, pages }) => ({
              title,
              pages: pages.map((url, index) => {
                if (!isGalleryMediaUrl(source.site, url))
                  throw gallerySiteError("gallery_invalid_metadata");
                const basename = new URL(url).pathname.split("/").at(-1);
                const number = String(index + 1).padStart(4, "0");
                return { url, name: basename ? `${number} - ${basename}` : number };
              }),
            }));
      const { pages } = manifest;
      const title = manifest.title
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, 300);
      if (
        !title ||
        !Array.isArray(pages) ||
        !pages.length ||
        pages.length > 2_000
      ) {
        throw gallerySiteError("gallery_invalid_metadata");
      }

      const images: GalleryImage[] = [];
      for (const page of pages) {
        images.push({
          hash: await imageIdentity(`${source.site}:${page.url}`),
          name: page.name,
          source: page.url,
        });
      }
      return { id, title, images };
    },
    async ehentaiImageRoute(image: GalleryImage, sourceUrl: string, useTab?: true): Promise<GalleryImageRoute> {
      const { source, page } = await readerPage(image, sourceUrl);
      return resolveEhentaiReaderRoute(source, page, readerHttp(source, useTab));
    },
    async imageUrl(image: GalleryImage, sourceUrl?: string): Promise<string> {
      if (!sourceUrl) return hitomi.imageUrl(image);
      const source = parseGallerySource(sourceUrl);
      if (!source) throw gallerySiteError("gallery_invalid_metadata");
      if (source.site === "hitomi") return hitomi.imageUrl(image);
      if (source.site === "nhentai")
        throw gallerySiteError("gallery_invalid_metadata");
      if (source.site === "ehentai") {
        const { page } = await readerPage(image, sourceUrl);
        return resolveEhentaiReaderImage(source, page, http);
      }
      const reference = image.source;
      if (
        !isGalleryMediaUrl(source.site, reference) ||
        image.hash !== (await imageIdentity(`${source.site}:${reference}`))
      ) {
        throw gallerySiteError("gallery_invalid_metadata");
      }
      return reference;
    },
  };
}
