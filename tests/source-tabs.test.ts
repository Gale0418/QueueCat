import { describe, expect, it, vi } from "vitest";
import { previewUrls } from "../src/shared/urls";
import {
  appendSelectedTabUrls,
  requestSupportedTabs,
  type TabsPermissionApi,
} from "../src/ui/source-tabs";

const sourceUrl = "https://katfile.biz/abcdefghijkl/file.rar.html";

describe("從分頁加入來源", () => {
  it("權限遭拒時提供拒絕結果，且不查詢分頁", async () => {
    const query = vi.fn();
    const api: TabsPermissionApi = {
      permissions: { request: vi.fn(async () => false) },
      tabs: { query },
    };
    await expect(requestSupportedTabs(api)).resolves.toEqual({
      status: "denied",
    });
    expect(api.permissions.request).toHaveBeenCalledWith({ permissions: ["tabs"] });
    expect(query).not.toHaveBeenCalled();
  });

  it("沒有支援來源時回傳空清單，並略過管理頁與不支援分頁", async () => {
    const api: TabsPermissionApi = {
      permissions: { request: vi.fn(async () => true) },
      tabs: {
        query: vi.fn(async () => [
          { id: 1, windowId: 1, title: "extension manager", url: "chrome-extension://abc/manager.html" },
          { id: 2, windowId: 1, title: "other", url: "https://example.com" },
        ]),
      },
    };
    await expect(requestSupportedTabs(api)).resolves.toEqual({
      status: "ok",
      tabs: [],
    });
    expect(api.tabs.query).toHaveBeenCalledWith({});
  });

  it("從所有視窗辨識支援的任意 Katfile 尾碼與 Hitomi 分頁", async () => {
    const api: TabsPermissionApi = {
      permissions: { request: vi.fn(async () => true) },
      tabs: {
        query: vi.fn(async () => [
          { id: 11, windowId: 2, title: "future", url: "https://katfile.future/abcdefghijkl/file.rar.html" },
          { id: 12, windowId: 9, title: "gallery", url: "https://hitomi.la/galleries/123.html" },
          { id: 13, windowId: 9, title: "bad path", url: "https://katfile.future/login.html" },
        ]),
      },
    };
    await expect(requestSupportedTabs(api)).resolves.toMatchObject({
      status: "ok",
      tabs: [
        { id: 11, windowId: 2 },
        { id: 12, windowId: 9 },
      ],
    });
  });

  it("保留已輸入文字，只附加選取網址，並沿用預覽去重", () => {
    const tabs = [
      { id: 7, windowId: 1, title: "one", url: sourceUrl },
      { id: 8, windowId: 2, title: "two", url: "https://katfile.co/zyxwvutsrqpo/archive.rar.html" },
    ];
    const prior = "https://katfile.biz/zyxwvutsrqpo/another-name.rar.html";
    const merged = appendSelectedTabUrls(`  ${prior}  `, tabs, [7, 8]);
    expect(merged).toBe(`  ${prior}  \n${sourceUrl}\n${tabs[1].url}`);
    expect(previewUrls(merged).map((row) => row.status)).toEqual([
      "valid",
      "valid",
      "duplicate",
    ]);
    expect(appendSelectedTabUrls(merged, tabs, [])).toBe(merged);
  });
});
