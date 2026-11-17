import { describe, expect, it, vi } from "vitest";
import { createGalleryHttp } from "../src/background/gallery-site-http";
import {
  parseGallerySource,
  isGalleryMediaUrl,
} from "../src/shared/gallery-sources";
import { previewUrls } from "../src/shared/urls";

describe("gallery source URLs", () => {
  it.each([
    [
      "ehentai",
      "https://e-hentai.org/g/42/0123456789/?p=2",
      "https://e-hentai.org/g/42/0123456789/",
    ],
    ["nhentai", "https://nhentai.net/g/42/3/", "https://nhentai.net/g/42/"],
    [
      "hentaifox",
      "https://hentaifox.com/gallery/42",
      "https://hentaifox.com/gallery/42/",
    ],
    [
      "nozomi",
      "https://nozomi.la/post/42.html#image",
      "https://nozomi.la/post/42.html",
    ],
    [
      "danbooru",
      "https://danbooru.donmai.us/posts/42?tags=test",
      "https://danbooru.donmai.us/posts/42",
    ],
    [
      "gelbooru",
      "https://gelbooru.com/index.php?id=42&s=view&page=post",
      "https://gelbooru.com/index.php?page=post&s=view&id=42",
    ],
    [
      "zerochan",
      "https://zerochan.net/42#large",
      "https://www.zerochan.net/42",
    ],
  ])("normalizes %s as an independent source", (site, input, url) => {
    expect(parseGallerySource(input)).toEqual({ site, id: "42", url });
  });

  it("deduplicates aliases while preserving the same ID from different sites", () => {
    const rows = previewUrls(
      [
        "https://nhentai.net/g/42/",
        "https://nhentai.net/g/42/2/",
        "https://www.zerochan.net/42",
        "https://www.pixiv.net/artworks/42",
        "https://e-hentai.org/tag/example",
        "https://www.zerochan.net:8443/42",
      ].join("\n"),
    );
    expect(rows.map((row) => row.status)).toEqual([
      "valid",
      "duplicate",
      "valid",
      "unsupported",
      "unsupported",
      "unsupported",
    ]);
  });

  it("validates the source-specific media host, not just the extension", () => {
    expect(
      isGalleryMediaUrl(
        "zerochan",
        "https://static.zerochan.net/Work.full.42.jpg",
      ),
    ).toBe(true);
    expect(
      isGalleryMediaUrl(
        "zerochan",
        "https://static.zerochan.net.example.org/42.jpg",
      ),
    ).toBe(false);
    expect(
      isGalleryMediaUrl(
        "danbooru",
        "https://static.zerochan.net/Work.full.42.jpg",
      ),
    ).toBe(false);
  });

  it("limits E-Hentai reading images to HTTPS H@H image paths", () => {
    const media = "https://a1.b2.hath.network:8443/h/a/b/ev01_01.webp";
    const originMedia = "https://a1.hath.network/om/12345678/a-b/c-d/800/e1f2/ev01_01.webp";
    expect(isGalleryMediaUrl("ehentai", media)).toBe(true);
    expect(isGalleryMediaUrl("ehentai", originMedia)).toBe(true);
    for (const invalid of [
      media.replace(".hath.network", ".hath.network.test"),
      media.replace("https:", "http:"),
      media + "?signed=123",
      "https://e-hentai.org/fullimg/42/1/ev01_01.png",
      "https://a1.b2.hath.network/archive/42.webp",
      originMedia.replace("a1.", "a1.b2."),
      originMedia.replace("/800/", "/other/"),
      originMedia + "?x=1",
    ]) expect(isGalleryMediaUrl("ehentai", invalid)).toBe(false);
  });
});

describe("gallery metadata transport", () => {
  it("requests E-Hentai reader metadata anonymously and rejects archive endpoints", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html></html>"));
    const http = createGalleryHttp(fetcher);
    await http.text("https://e-hentai.org/g/42/0123456789/?p=1", { credentials: "include" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://e-hentai.org/g/42/0123456789/?p=1",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
    await expect(http.text("https://e-hentai.org/archiver.php?gid=42")).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
    await expect(http.text("https://e-hentai.org/fullimg/42/1")).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
    await expect(http.text("https://e-hentai.org/s/0123456789/42-1?nl=1")).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("sends the Gelbooru session key only to the official single-post endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("{}"));
    const http = createGalleryHttp(fetcher, async () => ({
      userId: "42",
      apiKey: "fixture-key",
    }));
    await http.json(
      "https://gelbooru.com/index.php?page=dapi&s=post&q=index&id=12&json=1",
    );
    await http.text("https://gelbooru.com/index.php?page=post&s=view&id=12");
    await http.json("https://danbooru.donmai.us/posts/12.json");
    const [authorized, normal, other] = fetcher.mock.calls.map(
      ([url]) => new URL(String(url)),
    );
    expect(authorized.searchParams.get("api_key")).toBe("fixture-key");
    expect(authorized.searchParams.get("user_id")).toBe("42");
    expect(normal.searchParams.has("api_key")).toBe(false);
    expect(other.searchParams.has("api_key")).toBe(false);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
    });
  });

  it("refuses lookalike hosts and distinguishes rate limits from permission errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    const http = createGalleryHttp(fetcher);
    await expect(
      http.text("https://gelbooru.com.example.org/index.php"),
    ).rejects.toMatchObject({ code: "gallery_invalid_metadata" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      http.json("https://danbooru.donmai.us/posts/12.json"),
    ).rejects.toMatchObject({ code: "gallery_access_required" });
    await expect(
      http.json("https://danbooru.donmai.us/posts/12.json"),
    ).rejects.toMatchObject({ code: "gallery_rate_limited" });
  });
});
