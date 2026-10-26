import type { PageAction, PageObservation, Request } from "../shared/types";
import { inspectPage, performFreeAction } from "./katfile";
import { isKatfileSourceHost } from "../shared/urls";

const ACTION_KEY_PREFIX = "queuecat.action.";
const ACTION_ID_LIMIT = 160;
let lastReport = "";
let mutationTimer: number | undefined;
let waitBaseline:
  { signature: string; seconds: number; at: number } | undefined;

function currentObservation(): PageObservation {
  return inspectPage(document, window.location.href);
}

function observationForReport(
  observation: PageObservation,
  force: boolean,
): PageObservation {
  if (observation.kind !== "waiting" || observation.waitSeconds === undefined) {
    waitBaseline = undefined;
    return observation;
  }
  const signature = (observation.reason ?? "").replace(
    /\b\d{1,3}:\d{1,2}:\d{2}\b/g,
    "<倒數>",
  );
  const now = Date.now();
  if (
    !waitBaseline ||
    waitBaseline.signature !== signature ||
    waitBaseline.seconds !== observation.waitSeconds
  ) {
    waitBaseline = { signature, seconds: observation.waitSeconds, at: now };
    return observation;
  }
  if (!force) return observation;
  const remaining = Math.max(
    0,
    waitBaseline.seconds - Math.floor((now - waitBaseline.at) / 1000),
  );
  if (remaining === 0) {
    return {
      ...observation,
      kind: "unknown",
      waitSeconds: undefined,
      reason: "頁面倒數已結束，但網站尚未更新可辨識的下一步。",
    };
  }
  return { ...observation, waitSeconds: remaining };
}

function report(force = false): void {
  const rawObservation = currentObservation();
  const observation = observationForReport(rawObservation, force);
  const serialized = JSON.stringify(rawObservation);
  if (!force && serialized === lastReport) return;
  lastReport = serialized;
  try {
    void chrome.runtime
      .sendMessage({ type: "QC_PAGE", observation } satisfies Request)
      .catch(() => undefined);
  } catch {
    /* 背景頁正在重啟或擴充功能已關閉時，稍後的 fallback 會再檢查。 */
  }
}

function handleAction(action: PageAction): { ok: boolean; error?: string } {
  if (action.kind === "download")
    return {
      ok: false,
      error:
        "下載由背景 chrome.downloads API 處理，content script 不會點擊最終下載。",
    };
  if (
    action.kind !== "free" ||
    typeof action.actionId !== "string" ||
    action.actionId.length === 0 ||
    action.actionId.length > ACTION_ID_LIMIT
  ) {
    return { ok: false, error: "免費步驟指令格式無效。" };
  }
  if (action.expectedUrl) {
    try {
      const expected = new URL(action.expectedUrl);
      const current = new URL(window.location.href);
      if (
        expected.origin !== current.origin ||
        expected.pathname !== current.pathname
      )
        return { ok: false, error: "目前頁面與佇列要求的檔案頁不符。" };
    } catch {
      return { ok: false, error: "佇列要求的頁面網址無效。" };
    }
  }

  const key = ACTION_KEY_PREFIX + action.actionId;
  try {
    if (sessionStorage.getItem(key))
      return { ok: false, error: "這個免費步驟已處理過。" };
    // 先留下 actionId 再觸發網站原生 click，避免背景重送時重複提交。
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return { ok: false, error: "無法安全保存此步驟的防重複記錄。" };
  }

  const result = performFreeAction(document, window.location.href, action.step);
  if (!result.ok) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* 保留主要錯誤。 */
    }
  }
  return result;
}

function start(): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      if (!message || typeof message !== "object") return;
      const request = message as {
        type?: string;
        actionId?: string;
        kind?: string;
        expectedUrl?: string;
      };
      if (request.type === "QC_INSPECT" || request.type === "QC_OBSERVE") {
        report(true);
        sendResponse({ ok: true });
        return;
      }
      if (request.type === "QC_PAGE_ACTION") {
        const response = handleAction(request as PageAction);
        sendResponse(response);
        if (response.ok) window.setTimeout(() => report(true), 0);
      }
    },
  );

  report();

  const observer = new MutationObserver(() => {
    if (mutationTimer !== undefined) return;
    mutationTimer = window.setTimeout(() => {
      mutationTimer = undefined;
      report();
    }, 500);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  // 部分倒數文字由頁面計時器更新屬性；10 秒 fallback 僅比對結果有變化時才送到背景。
  window.setInterval(() => report(), 10_000);
}

// Chrome matches 不支援尾碼萬用字元；include_globs 先篩選，再核對完整 hostname。
// 不符合的頁面不讀取 DOM、不註冊 listener、observer 或計時器。
if (
  window.location.protocol === "https:" &&
  isKatfileSourceHost(window.location.hostname)
) {
  start();
}
