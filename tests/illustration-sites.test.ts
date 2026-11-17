import { describe, expect, it, vi } from "vitest";
import type { GallerySource } from "../src/shared/gallery-sources";
import type { GalleryHttp } from "../src/background/gallery-site-http";
import { illustrationAdapters } from "../src/background/illustration-sites";

const nozomiSource: GallerySource = {
  site: "nozomi",
  id: "26905532",
  url: "https://nozomi.la/post/26905532.html",
};
const danbooruSource: GallerySource = {
  site: "danbooru",
  id: "11322863",
  url: "https://danbooru.donmai.us/posts/11322863",
};
const gelbooruSource: GallerySource = {
  site: "gelbooru",
  id: "1",
  url: "https://gelbooru.com/index.php?page=post&s=view&id=1",
};
const zerochanSource: GallerySource = {
  site: "zerochan",
  id: "3793685",
  url: "https://www.zerochan.net/3793685",
};

const nozomiFixture = {
  postid: 26905532,
  imageurls: [
    {
      dataid: "fcedb19b290f62136c304480d1aa18ab98caee262b97a519ccf289fb0f56dd0b",
      type: "jpg",
      is_video: "",
    },
    {
      dataid: "a12345678901234567890123456789012345678901234567890123456789012f",
      type: "gif",
      is_video: "",
    },
  ],
};
const danbooruFixture = {
  id: 11322863,
  file_ext: "jpg",
  file_url: "https://cdn.donmai.us/original/ab/cd/0123456789abcdef0123456789abcdef.jpg",
  artist_commentary_title: "Sample commentary",
};
const gelbooruFixture = {
  "@attributes": { count: 1, offset: 0 },
  post: [
    {
      id: 1,
      title: "Sample Gelbooru post",
      file_url: "https://img3.gelbooru.com/images/ab/cd/abcdef0123456789.jpg",
    },
  ],
};
const zerochanFixture = `<!doctype html><html><head>
  <title>Yukihana Lamy - Zerochan</title>
  <script type="application/ld+json">{
    "@context":"http://schema.org",
    "@type":"ImageObject",
    "contentUrl":"https://static.zerochan.net/Yukihana.Lamy.full.3793685.jpg",
    "name":"Yukihana Lamy by Roco Mobile Wallpaper"
  }</script>
</head><body></body></html>`;

function httpFixture(overrides: Partial<GalleryHttp> = {}): GalleryHttp {
  return {
    text: vi.fn(async () => ""),
    json: vi.fn(async () => ({})),
    ...overrides,
  };
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

describe("單篇插畫站 resolver", () => {
  it("Nozomi 只讀取該篇 metadata，保留多圖順序並建立官方 CDN URL", async () => {
    const http = httpFixture({ json: vi.fn(async () => nozomiFixture) });
    const result = await illustrationAdapters.nozomi.load(nozomiSource, http);

    expect(http.json).toHaveBeenCalledOnce();
    expect(http.json).toHaveBeenCalledWith(
      "https://j.gold-usergeneratedcontent.net/post/2/53/26905532.json",
    );
    expect(result).toEqual({
      title: "Nozomi #26905532",
      pages: [
        "https://w.gold-usergeneratedcontent.net/b/d0/fcedb19b290f62136c304480d1aa18ab98caee262b97a519ccf289fb0f56dd0b.webp",
        "https://g.gold-usergeneratedcontent.net/f/12/a12345678901234567890123456789012345678901234567890123456789012f.gif",
      ],
    });
  });

  it("Nozomi 明確拒絕影片，不把它誤列為圖片", async () => {
    const fixture = {
      ...nozomiFixture,
      imageurls: [{ ...nozomiFixture.imageurls[0], is_video: "1" }],
    };
    const http = httpFixture({ json: vi.fn(async () => fixture) });
    await expect(illustrationAdapters.nozomi.load(nozomiSource, http)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "gallery_unsupported_media",
    );
  });

  it("Danbooru 以識別碼讀單篇 JSON，選用已允許的圖片 URL", async () => {
    const http = httpFixture({ json: vi.fn(async () => danbooruFixture) });
    await expect(illustrationAdapters.danbooru.load(danbooruSource, http)).resolves.toEqual({
      title: "Sample commentary",
      pages: [danbooruFixture.file_url],
    });
    expect(http.json).toHaveBeenCalledOnce();
    expect(http.json).toHaveBeenCalledWith(
      "https://danbooru.donmai.us/posts/11322863.json",
    );
  });

  it("Danbooru 不接受回應識別碼不相符或外站圖片 URL", async () => {
    const wrongId = httpFixture({
      json: vi.fn(async () => ({ ...danbooruFixture, id: 999 })),
    });
    await expect(illustrationAdapters.danbooru.load(danbooruSource, wrongId)).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });

    const unsafeUrl = httpFixture({
      json: vi.fn(async () => ({
        ...danbooruFixture,
        file_url: "https://example.com/image.jpg",
        large_file_url: null,
        preview_file_url: null,
      })),
    });
    await expect(illustrationAdapters.danbooru.load(danbooruSource, unsafeUrl)).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
  });

  it("Danbooru 原始檔 URL 不可見時回報需要存取權，不降級成縮圖", async () => {
    const restricted = httpFixture({
      json: vi.fn(async () => ({
        ...danbooruFixture,
        file_url: null,
        large_file_url: "https://cdn.donmai.us/large/ab/cd/0123456789abcdef0123456789abcdef.jpg",
        preview_file_url: "https://cdn.donmai.us/preview/ab/cd/0123456789abcdef0123456789abcdef.jpg",
      })),
    });
    await expect(illustrationAdapters.danbooru.load(danbooruSource, restricted)).rejects.toMatchObject({
      code: "gallery_access_required",
    });
  });

  it("Gelbooru 只用官方 DAPI 查指定 id，沒有加入憑證或列表分頁", async () => {
    const http = httpFixture({ json: vi.fn(async () => gelbooruFixture) });
    const result = await illustrationAdapters.gelbooru.load(gelbooruSource, http);

    expect(result).toEqual({
      title: "Sample Gelbooru post",
      pages: [gelbooruFixture.post[0].file_url],
    });
    const request = new URL(vi.mocked(http.json).mock.calls[0][0]);
    expect(request.origin).toBe("https://gelbooru.com");
    expect(Object.fromEntries(request.searchParams)).toEqual({
      page: "dapi",
      s: "post",
      q: "index",
      id: "1",
      json: "1",
    });
  });

  it("Gelbooru 將 HTTP client 回報的認證需求原樣傳回", async () => {
    const accessRequired = Object.assign(new Error("gallery_access_required"), {
      code: "gallery_access_required",
    });
    const http = httpFixture({ json: vi.fn(async () => Promise.reject(accessRequired)) });
    await expect(illustrationAdapters.gelbooru.load(gelbooruSource, http)).rejects.toBe(accessRequired);
  });

  it("Gelbooru 先識別影片副檔名，再檢查圖片 URL allowlist", async () => {
    const http = httpFixture({
      json: vi.fn(async () => ({
        post: [{ id: 1, file_ext: "webm", file_url: "https://img3.gelbooru.com/video.webm" }],
      })),
    });
    await expect(illustrationAdapters.gelbooru.load(gelbooruSource, http)).rejects.toMatchObject({
      code: "gallery_unsupported_media",
    });
  });

  it("Zerochan 從公開單篇 HTML 的 JSON-LD ImageObject 讀 contentUrl", async () => {
    const http = httpFixture({ text: vi.fn(async () => zerochanFixture) });
    await expect(illustrationAdapters.zerochan.load(zerochanSource, http)).resolves.toEqual({
      title: "Yukihana Lamy by Roco Mobile Wallpaper",
      pages: ["https://static.zerochan.net/Yukihana.Lamy.full.3793685.jpg"],
    });
    expect(http.text).toHaveBeenCalledOnce();
    expect(http.text).toHaveBeenCalledWith("https://www.zerochan.net/3793685");
  });

  it("Zerochan 忽略不符作品 id 或非允許 host 的 JSON-LD 圖片", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "ImageObject",
      contentUrl: "https://static.zerochan.net/Other.full.9999999.jpg",
      name: "Wrong post",
    })}</script><script type="application/ld+json">${JSON.stringify({
      "@type": "ImageObject",
      contentUrl: "https://example.com/3793685.jpg",
      name: "Wrong host",
    })}</script>`;
    const http = httpFixture({ text: vi.fn(async () => html) });
    await expect(illustrationAdapters.zerochan.load(zerochanSource, http)).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
  });
});
