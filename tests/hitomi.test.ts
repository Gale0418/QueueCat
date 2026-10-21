import { afterEach, describe, expect, it, vi } from "vitest";
import type { GalleryImage } from "../src/shared/types";
import {
  createHitomiClient,
  HitomiClientError,
} from "../src/background/hitomi";

// Official public technical references reviewed; the fixture below is compact
// and synthetic rather than a copy or dependency on the saved source files.
// https://ltn.gold-usergeneratedcontent.net/gg.js
// https://ltn.gold-usergeneratedcontent.net/common.js
// https://ltn.gold-usergeneratedcontent.net/reader.js
// Reviewed snapshot SHA-256: gg.js 31cf5fad6effa191d06e9effdf80252657dbd018bcbfaf6b2742075c405cbaec
// Reviewed snapshot SHA-256: common.js 9cdb39101b3658f838ec8df4e7c3c355dc99d01791d32efe9098cea6d7e15788
const HASH_ROUTED_TO_ONE = `${"0".repeat(61)}f0c`; // s(hash) = 0xcf0 = 3312
const HASH_ROUTED_TO_TWO = `${"0".repeat(61)}123`; // s(hash) = 0x312 = 786

// Compact synthetic excerpt: the case values are present in the reviewed public
// gg.js snapshot, while the test remains independent of the local artifact.
const GG_FIXTURE = `'use strict';
gg = { m: function(g) {
var o = 1;
switch (g) {
case 3312:
case 757:
o = 0; break;
}
return o;
},
s: function(h) { var m = /(..)(.)$/.exec(h); return parseInt(m[2]+m[1], 16).toString(10); },
b: '1792544401/'
};`;

function response(text: string, status = 200, headers?: HeadersInit): Response {
  return new Response(text, { status, headers });
}

function metadata(
  id = "42",
  files = [{ hash: HASH_ROUTED_TO_ONE, name: "page.webp" }],
  title = "Example gallery",
): string {
  return `var galleryinfo = ${JSON.stringify({ id: Number(id), title, files })};`;
}

function metadataWithoutId(): string {
  return `var galleryinfo = ${JSON.stringify({
    title: "Example gallery",
    files: [{ hash: HASH_ROUTED_TO_ONE, name: "page.webp" }],
  })};`;
}

function fetchSequence(responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch");
    return next;
  };
  return { fetcher, calls };
}

const fetcherNever: typeof fetch = async () => {
  throw new Error("fetch must not be called");
};

afterEach(() => vi.useRealTimers());

describe("Hitomi metadata 與圖片路由轉接", () => {
  it("只解析 JSON metadata，並以官方 m/s/b 數據格式產生固定 WebP URL", async () => {
    const { fetcher, calls } = fetchSequence([
      response(metadata()),
      response(GG_FIXTURE),
    ]);
    const client = createHitomiClient(fetcher);

    const manifest = await client.load("42");
    expect(manifest).toEqual({
      id: "42",
      title: "Example gallery",
      images: [{ hash: HASH_ROUTED_TO_ONE, name: "page.webp" }],
    });
    expect(await client.imageUrl(manifest.images[0])).toBe(
      `https://w1.gold-usergeneratedcontent.net/1792544401/3312/${HASH_ROUTED_TO_ONE}.webp`,
    );
    expect(calls.map((call) => call.url)).toEqual([
      "https://ltn.gold-usergeneratedcontent.net/galleries/42.js",
      "https://ltn.gold-usergeneratedcontent.net/gg.js",
    ]);
    expect(
      calls.every(
        ({ init }) => init?.redirect === "error" && init.credentials === "omit",
      ),
    ).toBe(true);
  });

  it("case 清單以外採預設路由，且檔名不會進入 URL", async () => {
    const { fetcher } = fetchSequence([response(GG_FIXTURE)]);
    const client = createHitomiClient(fetcher);
    const image: GalleryImage = {
      hash: HASH_ROUTED_TO_TWO,
      name: "../../evil?x=1",
    };
    expect(await client.imageUrl(image)).toBe(
      `https://w2.gold-usergeneratedcontent.net/1792544401/786/${HASH_ROUTED_TO_TWO}.webp`,
    );
  });

  it("接受輪換中的正數 GG base，並支援 case/default shard 值反轉", async () => {
    const rotatedBase = GG_FIXTURE.replace("1792544401/", "1234567890123456/");
    const { fetcher: rotatedFetch } = fetchSequence([response(rotatedBase)]);
    expect(
      await createHitomiClient(rotatedFetch).imageUrl({
        hash: HASH_ROUTED_TO_ONE,
        name: "x",
      }),
    ).toBe(
      `https://w1.gold-usergeneratedcontent.net/1234567890123456/3312/${HASH_ROUTED_TO_ONE}.webp`,
    );

    const reversed = GG_FIXTURE.replace("var o = 1;", "var o = 0;").replace(
      "o = 0; break;",
      "o = 1; break;",
    );
    const { fetcher: reversedFetch } = fetchSequence([response(reversed)]);
    const client = createHitomiClient(reversedFetch);
    expect(
      await client.imageUrl({ hash: HASH_ROUTED_TO_ONE, name: "x" }),
    ).toContain("https://w2.");
    expect(
      await client.imageUrl({ hash: HASH_ROUTED_TO_TWO, name: "x" }),
    ).toContain("https://w1.");
  });

  it("快取 GG 一次，load 後會清除快取並重讀更新的路由", async () => {
    const updated = GG_FIXTURE.replace("1792544401/", "87654321/");
    const { fetcher, calls } = fetchSequence([
      response(GG_FIXTURE),
      response(metadata()),
      response(updated),
    ]);
    const client = createHitomiClient(fetcher);
    const image = { hash: HASH_ROUTED_TO_ONE, name: "x" };

    await client.imageUrl(image);
    await client.imageUrl(image);
    expect(calls).toHaveLength(1);

    await client.load("42");
    expect(await client.imageUrl(image)).toContain("/87654321/3312/");
    expect(calls.map(({ url }) => url)).toEqual([
      "https://ltn.gold-usergeneratedcontent.net/gg.js",
      "https://ltn.gold-usergeneratedcontent.net/galleries/42.js",
      "https://ltn.gold-usergeneratedcontent.net/gg.js",
    ]);
  });

  it("拒絕 metadata 內的可執行尾碼而不執行它", async () => {
    const globalName = "__hitomiMetadataPayloadRan";
    (globalThis as Record<string, unknown>)[globalName] = false;
    const malicious = `${metadata()}\n(globalThis.${globalName} = true);`;
    const { fetcher } = fetchSequence([response(malicious)]);
    await expect(createHitomiClient(fetcher).load("42")).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
    expect((globalThis as Record<string, unknown>)[globalName]).toBe(false);
    delete (globalThis as Record<string, unknown>)[globalName];
  });

  it("拒絕 metadata 不一致、重複或格式錯誤的 hash", async () => {
    for (const body of [
      metadataWithoutId(),
      metadata("43"),
      metadata("42", [
        { hash: HASH_ROUTED_TO_ONE, name: "a" },
        { hash: HASH_ROUTED_TO_ONE.toUpperCase(), name: "b" },
      ]),
      metadata("42", [{ hash: "https://attacker.invalid/image", name: "a" }]),
      metadata("42", [{ hash: HASH_ROUTED_TO_ONE, name: "bad\0name" }]),
      metadata("42", [{ hash: HASH_ROUTED_TO_ONE, name: "bad\rname" }]),
      metadata("42", [{ hash: HASH_ROUTED_TO_ONE, name: "bad\nname" }]),
    ]) {
      const { fetcher } = fetchSequence([response(body)]);
      await expect(
        createHitomiClient(fetcher).load("42"),
      ).rejects.toBeInstanceOf(HitomiClientError);
    }
  });

  it("拒絕超大回應與可疑 GG 程式碼", async () => {
    let oversizedCanceled = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      cancel() {
        oversizedCanceled = true;
      },
    });
    const oversized = new Response(oversizedBody, {
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    });
    await expect(
      createHitomiClient(async () => oversized).load("42"),
    ).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
    expect(oversizedCanceled).toBe(true);

    const executable = `${GG_FIXTURE}\nfetch('https://attacker.invalid')`;
    const { fetcher } = fetchSequence([response(executable)]);
    await expect(
      createHitomiClient(fetcher).imageUrl({
        hash: HASH_ROUTED_TO_ONE,
        name: "x",
      }),
    ).rejects.toMatchObject({ code: "gallery_invalid_routing" });
  });

  it("拒絕壞路由、redirect、非成功狀態與無效 gallery id", async () => {
    const { fetcher: badRoutingFetch } = fetchSequence([
      response(GG_FIXTURE.replace("1792544401/", "0/")),
    ]);
    await expect(
      createHitomiClient(badRoutingFetch).imageUrl({
        hash: HASH_ROUTED_TO_ONE,
        name: "x",
      }),
    ).rejects.toMatchObject({ code: "gallery_invalid_routing" });

    const redirectFetcher: typeof fetch = async (_input, init) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("redirect blocked");
    };
    await expect(
      createHitomiClient(redirectFetcher).load("42"),
    ).rejects.toMatchObject({
      code: "gallery_request_failed",
    });

    let failedBodyCanceled = false;
    const failedBody = new ReadableStream<Uint8Array>({
      cancel() {
        failedBodyCanceled = true;
      },
    });
    const { fetcher: missingFetch } = fetchSequence([
      new Response(failedBody, { status: 404 }),
    ]);
    await expect(
      createHitomiClient(missingFetch).load("42"),
    ).rejects.toMatchObject({
      code: "gallery_unavailable",
    });
    expect(failedBodyCanceled).toBe(true);
    await expect(
      createHitomiClient(fetcherNever).load("0"),
    ).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
    await expect(
      createHitomiClient(fetcherNever).load("12345678901"),
    ).rejects.toMatchObject({
      code: "gallery_invalid_metadata",
    });
  });

  it("timeout 時會中止 fetch 並回報明確錯誤碼", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetcher: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    const pending = createHitomiClient(fetcher).load("42");
    const assertion = expect(pending).rejects.toMatchObject({
      code: "gallery_request_failed",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(aborted).toBe(true);
  });
});
