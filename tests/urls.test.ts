import { describe, expect, it } from "vitest";
import {
  isKatfileHost,
  isKatfileSourceHost,
  hitomiGalleryId,
  normalizeSource,
  migrateLegacyKatfileSource,
  previewUrls,
  sourceKey,
} from "../src/shared/urls";
describe("批次網址", () => {
  it("舊 cloud 來源保留檔案與查詢參數轉為 co，並跨新舊網址去重", () => {
    const cloud =
      "http://www.katfile.cloud/f2zz0o58k8ef/SO-37194.rar.html?download=1#section";
    const co = "https://katfile.co/f2zz0o58k8ef/SO-37194.rar.html?download=1";
    expect(normalizeSource(cloud)).toBe(co);
    expect(migrateLegacyKatfileSource(cloud)).toBe(co);
    expect(previewUrls(`${cloud}\n${co}`).map((r) => r.status)).toEqual([
      "valid",
      "duplicate",
    ]);
    for (const untouched of [
      "https://s5003.katfile.cloud:183/d/token/file.rar",
      "https://katfile.cloud.evil.test/f2zz0o58k8ef",
      "https://u:p@katfile.cloud/f2zz0o58k8ef",
      "https://katfile.cloud/login.html",
      "https://katfile.biz/f2zz0o58k8ef/file.rar.html",
      "broken",
    ])
      expect(migrateLegacyKatfileSource(untouched)).toBe(untouched);
  });
  it.each(["com", "biz", "co", "cloud", "download", "future", "xn--p1ai"])(
    "接受任意 Katfile 尾碼 %s，不需更新白名單",
    (suffix) => {
      const host = `katfile.${suffix}`;
      const url = `https://${host}/wfnml3a1oeg6/archive.rar.html`;
      const expected =
        suffix === "cloud" ? url.replace(host, "katfile.co") : url;
      expect(normalizeSource(url)).toBe(expected);
      expect(normalizeSource(url.replace(host, `www.${host}`))).toBe(expected);
      expect(previewUrls(url)[0].status).toBe("valid");
      expect(
        previewUrls(url, ["https://katfile.biz/wfnml3a1oeg6"])[0].status,
      ).toBe("duplicate");
      expect(isKatfileHost(`cdn.${host}`)).toBe(true);
      expect(isKatfileSourceHost(`cdn.${host}`)).toBe(false);
    },
  );
  it.each([
    "evilkatfile.com",
    "katfile.com.evil.test",
    "katfile.cloud.evil.test",
    "katfile",
    "katfile.-cloud",
    "katfile.cloud-",
    "example.com",
  ])("不把 %s 當成 Katfile 網域", (host) => {
    expect(isKatfileHost(host)).toBe(false);
    expect(isKatfileSourceHost(host)).toBe(false);
    expect(normalizeSource(`https://${host}/wfnml3a1oeg6`)).toBeNull();
  });
  it("接受 katfile.co 檔案頁與 www 別名，跨網域仍會去重", () => {
    const url = "https://katfile.co/wfnml3a1oeg6/08-1924140.rar.html";
    expect(normalizeSource(url)).toBe(url);
    expect(normalizeSource(url.replace("katfile.co/", "www.katfile.co/"))).toBe(
      url,
    );
    expect(previewUrls(url)[0].status).toBe("valid");
    expect(
      previewUrls(url, ["https://katfile.biz/wfnml3a1oeg6"])[0].status,
    ).toBe("duplicate");
    for (const invalid of [
      "https://katfile.co/",
      "https://katfile.co/login.html",
      "https://katfile.co.evil.test/wfnml3a1oeg6",
      "https://evilkatfile.co/wfnml3a1oeg6",
      "https://u:p@katfile.co/wfnml3a1oeg6",
    ])
      expect(normalizeSource(invalid)).toBeNull();
  });
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
