import { describe, expect, it } from "vitest";
import {
  hitomiGalleryId,
  normalizeSource,
  previewUrls,
  sourceKey,
} from "../src/shared/urls";
describe("批次網址", () => {
  it("同一本圖庫的閱讀頁與單本頁標準化並去重", () => {
    const links = [
      "https://hitomi.la/reader/12345.html#4",
      "https://hitomi.la/galleries/12345.html",
      "https://www.hitomi.la/doujinshi/sample-title-12345.html?from=test",
    ];
    expect(links.map(normalizeSource)).toEqual(
      links.map(() => "https://hitomi.la/galleries/12345.html"),
    );
    expect(previewUrls(links.join("\n")).map((r) => r.status)).toEqual([
      "valid",
      "duplicate",
      "duplicate",
    ]);
    expect(sourceKey(links[0])).toBe("hitomi:12345");
    expect(hitomiGalleryId(links[0])).toBe("12345");
  });
  it("圖庫只收單本與精確網域，不收首頁搜尋或憑證網址", () => {
    for (const url of [
      "https://hitomi.la/",
      "https://hitomi.la/search.html?x=1",
      "https://hitomi.la/tag/test-all-1.html",
      "https://hitomi.la/reader/0.html",
      "https://hitomi.la.evil.test/reader/12345.html",
      "https://u:p@hitomi.la/reader/12345.html",
      "https://hitomi.la:444/reader/12345.html",
    ])
      expect(normalizeSource(url)).toBeNull();
    expect(
      previewUrls(
        "https://katfile.biz/abcdefgh1234\nhttps://hitomi.la/reader/12345.html",
      ).map((r) => r.status),
    ).toEqual(["valid", "valid"]);
  });
  it("www別名標準化、損壞的既有網址不會弄壞新增預覽", () => {
    expect(normalizeSource("https://www.katfile.com/abcdefgh1234")).toBe(
      "https://katfile.com/abcdefgh1234",
    );
    expect(
      previewUrls("https://katfile.biz/abcdefgh1234", [""])[0].status,
    ).toBe("valid");
  });
  it("同檔案不同網域、檔名去重，但保留不同檔案", () => {
    const result = previewUrls(
      "https://katfile.biz/abcdefgh1234/a.rar.html\nhttps://katfile.com/abcdefgh1234\nhttps://katfile.biz/ijklmnop5678",
    );
    expect(result.map((x) => x.status)).toEqual([
      "valid",
      "duplicate",
      "valid",
    ]);
  });
  it("接受貼文中的連結，拒絕首頁、假網域、憑證與其他協定", () => {
    expect(
      previewUrls(
        "下載：https://katfile.biz/abcdefgh1234/a.rar.html，\n壞網址",
      )[0].status,
    ).toBe("valid");
    for (const url of [
      "https://katfile.biz/",
      "https://katfile.biz.evil.test/abcdefgh1234",
      "https://u:p@katfile.biz/abcdefgh1234",
      "javascript:alert(1)",
      "https://katfile.biz/login.html",
    ])
      expect(normalizeSource(url)).toBeNull();
  });
  it("既有紀錄也會去重，不因貼上重複建立任務", () => {
    expect(
      previewUrls("https://katfile.biz/abcdefgh1234/a", [
        "https://katfile.com/abcdefgh1234",
      ])[0].status,
    ).toBe("duplicate");
  });
});
