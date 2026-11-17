import { describe, expect, it } from "vitest";
import {
  ehentaiArchiveUrl,
  isEhentaiArchivePage,
  isEhentaiArchiveCandidate,
  isEhentaiArchiveDownload,
} from "../src/shared/ehentai-archive";

const gallery = "https://e-hentai.org/g/42/0123456789/";
const archive = "https://e-hentai.org/archiver.php?gid=42&token=0123456789";
const zip = {
  url: `${archive}&dltype=org`,
  filename: "gallery.zip",
  mime: "application/zip",
};

describe("E-Hentai 官方 ZIP 身分核對", () => {
  it("由標準單本網址產生官方 archiver URL，query 順序不影響識別", () => {
    expect(ehentaiArchiveUrl(gallery)).toBe(archive);
    expect(
      isEhentaiArchiveDownload(gallery, {
        ...zip,
        url: "https://e-hentai.org/archiver.php?token=0123456789&gid=42",
      }),
    ).toBe(true);
    expect(ehentaiArchiveUrl("https://nhentai.net/g/42/")).toBeUndefined();
    expect(isEhentaiArchivePage(gallery, `${archive}&mode=org`)).toBe(true);
    expect(isEhentaiArchivePage(gallery, "https://e-hentai.org/archiver.php?token=0123456789&gid=42")).toBe(true);
    expect(isEhentaiArchivePage(gallery, "https://e-hentai.org/archiver.php?gid=42&gid=42&token=0123456789")).toBe(false);
    expect(isEhentaiArchivePage(gallery, "https://e-hentai.org/archiver.php?gid=43&token=0123456789")).toBe(false);
    expect(isEhentaiArchivePage(gallery, "http://e-hentai.org/archiver.php?gid=42&token=0123456789")).toBe(false);
  });

  it("要求 ZIP 特徵與精確 gid/token 身分，不能只靠同名", () => {
    expect(isEhentaiArchiveDownload(gallery, { ...zip, filename: "same.zip", url: "https://e-hentai.org/files/same.zip" })).toBe(false);
    expect(isEhentaiArchiveDownload(gallery, { ...zip, mime: "text/html", filename: "page.html" })).toBe(false);
    expect(isEhentaiArchiveDownload(gallery, {
      ...zip,
      url: "https://e-hentai.org/archiver.php?gid=43&token=0123456789",
    })).toBe(false);
    expect(isEhentaiArchiveDownload(gallery, {
      ...zip,
      url: "https://e-hentai.org/archiver.php?gid=42&token=1123456789",
    })).toBe(false);
    for (const mime of ["text/html", "image/jpeg", "application/pdf"]) {
      expect(isEhentaiArchiveDownload(gallery, {
        ...zip,
        mime,
        filename: "gallery.zip",
      })).toBe(false);
    }
    expect(isEhentaiArchiveDownload(gallery, {
      ...zip,
      mime: "application/octet-stream",
      filename: "gallery.zip",
    })).toBe(true);
  });

  it("拒絕重複 identity 參數、假 host、非 HTTPS 與非可信 ZIP host", () => {
    for (const url of [
      "https://e-hentai.org/archiver.php?gid=42&gid=42&token=0123456789",
      "https://e-hentai.org/archiver.php?gid=42&token=0123456789&token=0123456789",
      "https://e-hentai.org.evil.test/archiver.php?gid=42&token=0123456789",
      "http://e-hentai.org/archiver.php?gid=42&token=0123456789",
      "https://archive.hath.network/42.zip",
    ]) {
      expect(isEhentaiArchiveDownload(gallery, { ...zip, url })).toBe(false);
    }
  });

  it("完整精確官網 referrer 可證明 Chrome 開始的安全 HTTPS CDN ZIP 下載", () => {
    const cdnRecord = {
      url: "https://cdn.example.net/download/temporary?id=1",
      referrer: `${archive}&dltype=org`,
      filename: "gallery.zip",
      mime: "application/octet-stream",
    };
    expect(isEhentaiArchiveDownload(gallery, cdnRecord)).toBe(true);
    expect(isEhentaiArchiveDownload(gallery, { ...cdnRecord, url: "http://cdn.example.net/file.zip" })).toBe(false);
    expect(isEhentaiArchiveDownload(gallery, { ...cdnRecord, url: "https://127.0.0.1/file.zip" })).toBe(false);
    expect(isEhentaiArchiveDownload(gallery, { ...cdnRecord, url: "https://cdn.example.net:8443/file.zip" })).toBe(false);
    expect(isEhentaiArchiveDownload(gallery, { ...cdnRecord, referrer: "https://e-hentai.org/" })).toBe(false);
    expect(isEhentaiArchiveDownload(gallery, {
      ...cdnRecord,
      referrer: "https://e-hentai.org/",
      finalUrl: "",
    })).toBe(false);
  });

  it("可從官方 referrer 或 finalUrl 配對，但拒絕另一個本的衝突身分", () => {
    expect(isEhentaiArchiveDownload(gallery, {
      url: "https://e-hentai.org/files/42.zip",
      referrer: archive,
      filename: "42.zip",
    })).toBe(true);
    expect(isEhentaiArchiveDownload(gallery, {
      url: "https://e-hentai.org/files/42.zip",
      finalUrl: `${archive}&dltype=org`,
      filename: "42.zip",
    })).toBe(true);
    expect(isEhentaiArchiveDownload(gallery, {
      ...zip,
      referrer: "https://e-hentai.org/archiver.php?gid=43&token=0123456789",
    })).toBe(false);
  });

  it("人工候選需 HTTPS 官方 host、origin-only referrer 與 ZIP 特徵", () => {
    expect(isEhentaiArchiveCandidate({
      url: "https://e-hentai.org/files/official.zip",
      filename: "official.zip",
    })).toBe(true);
    expect(isEhentaiArchiveCandidate({
      url: "https://e-hentai.org/files/archive.zip",
      referrer: "https://e-hentai.org/",
      filename: "archive.zip",
    })).toBe(true);
    expect(isEhentaiArchiveCandidate({
      url: "https://e-hentai.org/files/archive",
      referrer: "https://e-hentai.org/",
      mime: "application/x-zip-compressed",
    })).toBe(true);
    for (const record of [
      { ...zip, url: "https://e-hentai.org.evil.test/archive.zip", referrer: "https://e-hentai.org/" },
      { ...zip, url: "http://e-hentai.org/archive.zip", referrer: "https://e-hentai.org/" },
      { ...zip, url: "https://e-hentai.org/archive.zip", referrer: "https://e-hentai.org/g/42/0123456789/" },
      { ...zip, url: "https://e-hentai.org/archive.zip", referrer: "https://example.test/" },
      { url: "https://e-hentai.org/archive", referrer: "https://e-hentai.org/", filename: "archive.html" },
    ]) {
      expect(isEhentaiArchiveCandidate(record)).toBe(false);
    }
  });

  it("人工候選可核對目標本，明確不同本的 archiver identity 不因同名而通過", () => {
    const selected = {
      url: "https://e-hentai.org/files/same.zip",
      referrer: "https://e-hentai.org/archiver.php?token=0123456789&gid=42",
      filename: "same.zip",
    };
    expect(isEhentaiArchiveCandidate(selected, gallery)).toBe(true);
    expect(isEhentaiArchiveCandidate({
      ...selected,
      referrer: "https://e-hentai.org/archiver.php?gid=43&token=0123456789",
    }, gallery)).toBe(false);
    expect(isEhentaiArchiveCandidate({
      ...selected,
      referrer: "https://e-hentai.org/archiver.php?gid=42&gid=42&token=0123456789",
    }, gallery)).toBe(false);
    expect(isEhentaiArchiveCandidate({
      url: "https://e-hentai.org/files/same.zip",
      referrer: "https://e-hentai.org/",
      filename: "same.zip",
    }, gallery)).toBe(true);
    expect(isEhentaiArchiveCandidate({
      url: "https://cdn.example.net/archive.zip",
      referrer: "https://e-hentai.org/archiver.php?gid=42&token=0123456789",
      filename: "same.zip",
    }, gallery)).toBe(true);
    expect(isEhentaiArchiveCandidate({
      url: "https://cdn.example.net/archive.zip",
      referrer: "https://e-hentai.org/",
      filename: "same.zip",
    }, gallery)).toBe(true);
    expect(isEhentaiArchiveCandidate({
      url: "https://unknown-cdn.example/archive.zip",
      referrer: "https://e-hentai.org/",
      filename: "same.zip",
    })).toBe(true);
    expect(isEhentaiArchiveDownload(gallery, {
      url: "https://unknown-cdn.example/archive.zip",
      referrer: "https://e-hentai.org/",
      filename: "same.zip",
    })).toBe(false);
    expect(isEhentaiArchiveCandidate({
      url: "https://e-hentai.org/files/not-a-zip.zip",
      filename: "not-a-zip.zip",
      mime: "text/html",
    })).toBe(false);
    expect(isEhentaiArchiveCandidate({
      url: "https://cdn.example.net/archive.zip",
      filename: "archive.zip",
      mime: "application/octet-stream",
    })).toBe(false);
  });
});
