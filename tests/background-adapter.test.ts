import { beforeAll, describe, expect, it, vi } from "vitest";
import { initialState, STORAGE_KEY, type Response } from "../src/shared/types";
import { getLocale } from "../src/shared/locales";

let listener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: Response) => void,
) => boolean;
const extensionUrl = "chrome-extension://queuecat-test/";
let startupListener: () => void;
beforeAll(async () => {
  const state = initialState();
  const event = () => ({ addListener: vi.fn() });
  vi.stubGlobal("chrome", {
    runtime: {
      id: "queuecat-test",
      getURL: (path: string) => extensionUrl + path,
      onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
      onStartup: {
        addListener: (fn: typeof startupListener) => (startupListener = fn),
      },
      onInstalled: event(),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({ [STORAGE_KEY]: state })),
        set: vi.fn(async () => undefined),
      },
    },
    tabs: {
      create: vi.fn(async () => ({ id: 42 })),
      get: vi.fn(),
      update: vi.fn(),
      sendMessage: vi.fn(),
      onRemoved: event(),
    },
    downloads: {
      search: vi.fn(async () => []),
      onCreated: event(),
      onChanged: event(),
    },
    alarms: {
      get: vi.fn(async () => undefined),
      clear: vi.fn(async () => true),
      create: vi.fn(async () => undefined),
      onAlarm: event(),
    },
    notifications: { create: vi.fn(async () => "n"), onClicked: event() },
    action: {
      setTitle: vi.fn(async () => undefined),
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
  });
  await import("../src/background/index");
});
const send = (message: unknown, sender: chrome.runtime.MessageSender) =>
  new Promise<Response>((resolve) => listener(message, sender, resolve));
describe("Chrome runtime 訊息來源邊界", () => {
  it("uses the saved language for notifications and toolbar titles without stale UI globals", async () => {
    const sender = { url: extensionUrl + "manager.html" };
    for (const language of ["ja", "en", "zh-TW"] as const) {
      expect(
        (
          await send(
            {
              type: "QC_COMMAND",
              command: { kind: "settings", settings: { language } },
            },
            sender,
          )
        ).ok,
      ).toBe(true);
      expect(
        (
          await send(
            { type: "QC_COMMAND", command: { kind: "test-notification" } },
            sender,
          )
        ).ok,
      ).toBe(true);
      expect(chrome.notifications.create).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          title: getLocale(language).notifyTestTitle,
          message: getLocale(language).notifyTestMessage,
        }),
      );
      expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
        title: `QueueCat — ${getLocale(language).tagline}`,
      });
    }
  });
  it("records event API failures without an unhandled rejection", async () => {
    const failure = new Error("injected alarm API failure");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(chrome.alarms.clear).mockRejectedValueOnce(failure);
      startupListener();
      await vi.waitFor(() =>
        expect(errorLog).toHaveBeenCalledWith(
          "QueueCat 背景事件處理失敗",
          failure,
        ),
      );
    } finally {
      errorLog.mockRestore();
    }
  });
  it("網站不能讀取核對手動下載的候選紀錄", async () => {
    const response = await send(
      { type: "QC_FIND_DOWNLOADS", id: "1" },
      {
        url: "https://katfile.biz/ntrr1zdzt6i0/file.rar.html",
        tab: { id: 12 } as chrome.tabs.Tab,
      },
    );
    expect(response.ok).toBe(false);
    expect(response.downloads).toBeUndefined();
  });
  it("完整管理分頁即使有 sender.tab 也能讀取與操作", async () => {
    const response = await send(
      { type: "QC_GET" },
      {
        url: extensionUrl + "manager.html",
        tab: { id: 12 } as chrome.tabs.Tab,
      },
    );
    expect(response.ok).toBe(true);
    expect(response.state?.version).toBe(1);
  });
  it("一般網站不能假扮管理頁送排隊指令", async () => {
    const response = await send(
      { type: "QC_COMMAND", command: { kind: "start" } },
      {
        url: "https://katfile.biz/abcdefgh1234",
        tab: { id: 12 } as chrome.tabs.Tab,
      },
    );
    expect(response.ok).toBe(false);
  });
  it("管理頁不能偽裝成網站觀察回報", async () => {
    const response = await send(
      {
        type: "QC_PAGE",
        observation: {
          kind: "ready",
          pageUrl: "https://katfile.biz/abcdefgh1234",
        },
      },
      {
        url: extensionUrl + "manager.html",
        tab: { id: 12 } as chrome.tabs.Tab,
      },
    );
    expect(response.ok).toBe(false);
  });
});
