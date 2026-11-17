// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialState, type AppState } from "../src/shared/types";

vi.mock("../src/ui/client", () => ({
  preview: false,
  request: vi.fn(async () => ({ ok: true, state: initialState() })),
  findDownloads: vi.fn(),
  scenario: vi.fn(),
}));

interface MockTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
}

function makeChrome(
  permissionsRequest: () => Promise<boolean>,
  query: () => Promise<MockTab[]>,
) {
  return {
    notifications: { getPermissionLevel: vi.fn(async () => "granted") },
    permissions: { request: vi.fn(permissionsRequest) },
    tabs: { query: vi.fn(query) },
    storage: { onChanged: { addListener: vi.fn() } },
  };
}

async function mount(chromeApi: ReturnType<typeof makeChrome>, state?: AppState) {
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "#add");
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-TW"]);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
  }));
  vi.stubGlobal("chrome", chromeApi);
  vi.resetModules();
  if (state) {
    const { request } = await import("../src/ui/client");
    vi.mocked(request).mockResolvedValueOnce({ ok: true, state });
  }
  await import("../src/ui/main");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#add-panel")!.hidden).toBe(
      false,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, "", "#");
});

it("只有可自動重試的失敗項目時，仍能從開始排隊啟動", async () => {
  const sourceUrl = "https://e-hentai.org/g/42/0123456789/";
  const state: AppState = {
    ...initialState(),
    items: [{
      id: "failed-gallery",
      sourceUrl,
      title: "測試圖庫",
      status: "failed",
      createdAt: 1,
      updatedAt: 1,
      reason: "gallery_request_failed",
      gallery: { id: "42", completed: 0, output: "zip" },
      events: [],
    }],
  };
  await mount(makeChrome(async () => true, async () => []), state);
  await vi.waitFor(() =>
    expect(document.querySelector("#status-title")?.textContent).toBe("有失敗項目可以重試"),
  );
  document.querySelector<HTMLButtonElement>('#hero-actions [data-action="start"]')!.click();
  const { request } = await import("../src/ui/client");
  expect(request).toHaveBeenCalledWith({ kind: "start" });
});

it("由按鈕授權後讀取跨視窗分頁，支援全選與單選並用既有預覽去重", async () => {
  const tabs: MockTab[] = [
    {
      id: 10,
      windowId: 2,
      title: "已有網址的另一個檔名",
      url: "https://katfile.biz/abcdefghijkl/new-name.rar.html",
    },
    {
      id: 11,
      windowId: 8,
      title: "另一個 Katfile 檔案",
      url: "https://katfile.future/zyxwvutsrqpo/archive.rar.html",
    },
    {
      id: 12,
      windowId: 8,
      title: "Hitomi 畫廊",
      url: "https://hitomi.la/galleries/123.html",
    },
  ];
  const chromeApi = makeChrome(async () => true, async () => tabs);
  await mount(chromeApi);

  const input = document.querySelector<HTMLTextAreaElement>("#url-input")!;
  const existing = "https://katfile.biz/abcdefghijkl/original.rar.html";
  input.value = existing;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>("#read-source-tabs")!.click();

  expect(chromeApi.permissions.request).toHaveBeenCalledWith({
    permissions: ["tabs"],
  });
  await vi.waitFor(() =>
    expect(
      document.querySelectorAll<HTMLInputElement>(
        '#source-tabs-panel input[name="source-tab"]',
      ),
    ).toHaveLength(3),
  );
  expect(chromeApi.tabs.query).toHaveBeenCalledWith({});

  const selectAll = document.querySelector<HTMLInputElement>(
    "#source-tabs-panel [data-source-select-all]",
  )!;
  selectAll.click();
  const checkboxes = [
    ...document.querySelectorAll<HTMLInputElement>(
      '#source-tabs-panel input[name="source-tab"]',
    ),
  ];
  expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);
  checkboxes[2].click();
  expect(checkboxes[0].checked).toBe(true);
  expect(checkboxes[1].checked).toBe(true);
  expect(checkboxes[2].checked).toBe(false);
  expect(selectAll.checked).toBe(false);

  document
    .querySelector<HTMLButtonElement>('[data-action="insert-source-tabs"]')!
    .click();
  expect(input.value).toBe(`${existing}\n${tabs[0].url}\n${tabs[1].url}`);
  expect(document.querySelector("#url-preview .preview-counts")!.textContent)
    .toContain("2 個可加入");
  expect(document.querySelector("#url-preview .preview-counts")!.textContent)
    .toContain("1 個重複");
  expect(document.querySelector<HTMLElement>("#source-tabs-panel")!.hidden).toBe(
    true,
  );
});

it("拒絕授權後顯示重試入口，重試成功才查詢分頁", async () => {
  const query = vi.fn(async () => [] as MockTab[]);
  const permissionsRequest = vi
    .fn<() => Promise<boolean>>()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const chromeApi = makeChrome(permissionsRequest, query);
  await mount(chromeApi);

  document.querySelector<HTMLButtonElement>("#read-source-tabs")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#source-tabs-panel")!.textContent).toContain(
      "未取得分頁權限",
    ),
  );
  expect(query).not.toHaveBeenCalled();
  document
    .querySelector<HTMLButtonElement>(
      '#source-tabs-panel [data-action="read-source-tabs"]',
    )!
    .click();
  await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
  expect(chromeApi.permissions.request).toHaveBeenCalledTimes(2);
  expect(document.querySelector("#source-tabs-panel")!.textContent).toContain(
    "找不到支援來源分頁",
  );
});

it("查詢尚未完成就收起新增面板時不顯示過期清單", async () => {
  let resolveTabs!: (tabs: MockTab[]) => void;
  const query = vi.fn(
    () =>
      new Promise<MockTab[]>((resolve) => {
        resolveTabs = resolve;
      }),
  );
  const chromeApi = makeChrome(async () => true, query);
  await mount(chromeApi);

  document.querySelector<HTMLButtonElement>("#read-source-tabs")!.click();
  await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
  document.querySelector<HTMLButtonElement>('[data-action="close-add"]')!.click();
  expect(document.querySelector<HTMLElement>("#add-panel")!.hidden).toBe(true);

  resolveTabs([
    {
      id: 30,
      windowId: 3,
      title: "過期快照",
      url: "https://katfile.biz/abcdefghijkl/archive.rar.html",
    },
  ]);
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelector<HTMLElement>("#source-tabs-panel")!.hidden).toBe(
    true,
  );
  expect(document.querySelector("#source-tabs-panel")!.textContent).not.toContain(
    "過期快照",
  );
});
