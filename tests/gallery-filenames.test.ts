import { describe, expect, it } from "vitest";
import { galleryArchiveFilenames } from "../src/shared/gallery-filenames";

describe("圖庫 ZIP 檔名", () => {
  it("可依驗證過的影像格式保留 ZIP 副檔名", () => {
    expect(
      galleryArchiveFilenames(
        ["cover.jpg", "page.png", "animation.gif", "scan.avif"],
        [".jpg", ".png", ".gif", ".avif"],
      ),
    ).toEqual(["cover.jpg", "page.png", "animation.gif", "scan.avif"]);
  });

  it("保留原始編號與 Unicode，只把最後副檔名改成 WebP", () => {
    expect(
      galleryArchiveFilenames([
        "CG_007.jpg",
        "作品第１２頁.final.png",
        "no-extension",
      ]),
    ).toEqual(["CG_007.webp", "作品第１２頁.final.webp", "no-extension.webp"]);
  });

  it("將路徑與 Windows 禁用字元攤平，並替換保留裝置名稱", () => {
    expect(
      galleryArchiveFilenames([
        "../folder/secret|name?.jpg",
        "CON.txt",
        "com1.png",
        "CON.extra.jpg",
        "bad\u0001name\u007f.jpg",
      ]),
    ).toEqual([
      "_folder_secret_name_.webp",
      "_CON.webp",
      "_com1.webp",
      "_CON.extra.webp",
      "bad_name_.webp",
    ]);
  });

  it("清理開頭點、尾端點與空白，空基名改用四位頁碼", () => {
    expect(
      galleryArchiveFilenames([
        "...hidden.jpg",
        "name...   ",
        "...jpg",
        `${" ".repeat(300)}visible.jpg`,
      ]),
    ).toEqual(["hidden.webp", "name.webp", "0003.webp", "visible.webp"]);
  });

  it("以大小寫不敏感及 NFC 等價方式處理重名", () => {
    expect(
      galleryArchiveFilenames([
        "Image.jpg",
        "image.png",
        "café.jpg",
        "café.png",
      ]),
    ).toEqual(["Image.webp", "image (2).webp", "café.webp", "café (2).webp"]);
  });

  it("略過原始檔名已有的 suffix，保留唯一的 cg (2)", () => {
    expect(galleryArchiveFilenames(["cg.jpg", "cg.png", "cg (2).png"])).toEqual(
      ["cg.webp", "cg (3).webp", "cg (2).webp"],
    );
  });

  it("UTF-8 截短後仍保持唯一且每個 entry 不超過 240 bytes", () => {
    const longName = "a".repeat(240);
    const [first, second] = galleryArchiveFilenames([
      `${longName}.jpg`,
      `${longName}.png`,
    ]);

    expect(first).toBe(`${"a".repeat(235)}.webp`);
    expect(second).toBe(`${"a".repeat(231)} (2).webp`);
    expect(new TextEncoder().encode(first).length).toBeLessThanOrEqual(240);
    expect(new TextEncoder().encode(second).length).toBeLessThanOrEqual(240);
    expect(second).not.toBe(first);

    const multibyte = galleryArchiveFilenames([`${"界".repeat(80)}.jpg`])[0];
    expect(multibyte).toBe(`${"界".repeat(78)}.webp`);
    expect(new TextEncoder().encode(multibyte).length).toBe(239);
  });

  it("suffix 遇到截短後的原始名稱時再往後尋找", () => {
    const base = "b".repeat(235);
    const reserved = `${"b".repeat(231)} (2).png`;
    expect(
      galleryArchiveFilenames([`${base}.jpg`, `${base}.png`, reserved]),
    ).toEqual([
      `${base}.webp`,
      `${"b".repeat(231)} (3).webp`,
      reserved.replace(/\.png$/u, ".webp"),
    ]);
  });
});
