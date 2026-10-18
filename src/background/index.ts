import { QueueEngine, type DownloadRecord } from "./engine";
import type { Request } from "../shared/types";
import { currentLanguage, type LanguagePreference } from "../shared/language";
import { translateMessage } from "../shared/messages";
import { getLocale } from "../shared/locales";

const ports = {
  storage: {
    async get(key: string) {
      const result = await chrome.storage.local.get(key);
      return result[key];
    },
    async set(value: Record<string, unknown>) {
      await chrome.storage.local.set(value);
    },
  },
  tabs: {
    create(url: string, active = true) {
      return chrome.tabs.create({ url, active });
    },
    get(id: number) {
      return chrome.tabs.get(id);
    },
    async update(id: number, props: { active?: boolean; url?: string }) {
      const tab = await chrome.tabs.update(id, props);
      if (props.active && tab?.windowId !== undefined)
        await chrome.windows.update(tab.windowId, { focused: true });
      return tab;
    },
    send(id: number, message: unknown) {
      const normalized =
        message &&
        typeof message === "object" &&
        (message as { type?: string }).type === "QC_OBSERVE"
          ? { type: "QC_INSPECT" }
          : message;
      return chrome.tabs.sendMessage(id, normalized);
    },
  },
  downloads: {
    download(options: { url: string; conflictAction: "uniquify" }) {
      return chrome.downloads.download(options);
    },
    async search(query: {
      id?: number;
      state?: "in_progress" | "interrupted";
      startedAfter?: string;
      startedBefore?: string;
    }) {
      return (await chrome.downloads.search(
        query,
      )) as unknown as DownloadRecord[];
    },
    pause(id: number) {
      return chrome.downloads.pause(id);
    },
    resume(id: number) {
      return chrome.downloads.resume(id);
    },
    cancel(id: number) {
      return chrome.downloads.cancel(id);
    },
    async show(id: number) {
      chrome.downloads.show(id);
    },
  },
  alarms: {
    create(name: string, info: { when?: number; periodInMinutes?: number }) {
      chrome.alarms.create(name, info);
    },
    async clear(name: string) {
      await chrome.alarms.clear(name);
    },
  },
  async notify(
    title: string,
    message: string,
    notificationId?: string,
    language: LanguagePreference = "system",
  ) {
    const locale = currentLanguage(language);
    await chrome.notifications.create(
      notificationId || `queuecat-${crypto.randomUUID()}`,
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/48.png"),
        title: translateMessage(title, locale),
        message: translateMessage(message, locale),
      },
    );
  },
  async setBadge(
    text: string,
    color: string,
    language: LanguagePreference = "system",
  ) {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setTitle?.({
      title: `QueueCat — ${getLocale(currentLanguage(language)).tagline}`,
    });
  },
  getUrl(path: string) {
    return chrome.runtime.getURL(path);
  },
  now() {
    return Date.now();
  },
  extensionId: chrome.runtime.id,
};
const engine = new QueueEngine(ports);
const runBackground = (operation: Promise<unknown>) => {
  void operation.catch((error) =>
    console.error("QueueCat 背景事件處理失敗", error),
  );
};

// MV3 listeners register synchronously at module evaluation; async reply is wrapped explicitly.
chrome.runtime.onMessage.addListener(
  (message: Request, sender, sendResponse) => {
    if (
      !message ||
      typeof message !== "object" ||
      !["QC_GET", "QC_COMMAND", "QC_PAGE", "QC_FIND_DOWNLOADS"].includes(
        message.type,
      )
    ) {
      sendResponse({ ok: false, error: "無效的 QueueCat 訊息" });
      return false;
    }
    const pageReport = message.type === "QC_PAGE";
    const extensionPage =
      !!sender.url && sender.url.startsWith(chrome.runtime.getURL(""));
    if (
      (pageReport && (sender.tab?.id === undefined || extensionPage)) ||
      (!pageReport && !extensionPage)
    ) {
      sendResponse({ ok: false, error: "訊息來源不受信任" });
      return false;
    }
    void engine
      .handleRequest(message, pageReport ? sender.tab?.id : undefined)
      .then(sendResponse, (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "背景處理失敗",
        }),
      );
    return true;
  },
);
chrome.downloads.onChanged.addListener((delta) => {
  runBackground(
    engine.onDownloadChanged(
      delta as Parameters<typeof engine.onDownloadChanged>[0],
    ),
  );
});
chrome.downloads.onCreated.addListener((item) => {
  runBackground(engine.onDownloadCreated(item as unknown as DownloadRecord));
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "queuecat.tick") runBackground(engine.onAlarm());
});
chrome.tabs.onRemoved.addListener((tabId) => {
  runBackground(engine.onTabRemoved(tabId));
});
chrome.runtime.onStartup.addListener(() => {
  runBackground(engine.onStartup());
});
chrome.runtime.onInstalled.addListener(() => {
  runBackground(engine.onStartup());
});
chrome.notifications.onClicked.addListener((notificationId) => {
  const prefix = notificationId.startsWith("queuecat-verify-")
    ? "queuecat-verify-"
    : notificationId.startsWith("queuecat-block-")
      ? "queuecat-block-"
      : undefined;
  if (prefix)
    runBackground(
      engine.command({
        kind: "focus",
        id: notificationId.slice(prefix.length),
      }),
    );
});

// Service worker 可能因閒置而重啟；每次模組載入都核對狀態並補回單次 alarm。
runBackground(engine.onStartup());
