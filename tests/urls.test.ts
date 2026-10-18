import { describe, expect, it } from "vitest";
import { normalizeSource, previewUrls } from "../src/shared/urls";
describe("批次網址", () => {
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
