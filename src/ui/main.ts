import "./style.css";
import type {
  AppState,
  Command,
  DownloadCandidate,
  QueueItem,
} from "../shared/types";
import { STORAGE_KEY, initialState } from "../shared/types";
import { isAutomaticRetryCandidate } from "../shared/automatic-retry";
import { previewUrls } from "../shared/urls";
import { canRetryEhentaiReaderInTab } from "../shared/ehentai-reader-retry";
import { parseGallerySource } from "../shared/gallery-sources";
import { GELBOORU_SESSION_KEY, gelbooruCredentials } from "../shared/gelbooru-session";
import { findDownloads, request, preview, scenario } from "./client";
import {
  bytes,
  briefReason,
  countdown,
  downloadRemaining,
  escape as e,
  isAttention,
  labels,
  progress,
  summary,
} from "./presentation";
import { icon } from "./icons";
import { tagline } from "./brand";
import {
  translateInterface,
  hasSameMarkup,
  rememberMarkup,
} from "./localization";
import {
  messageLanguage,
  setMessageLanguage,
  translateMessage as t,
} from "../shared/messages";
import { isLanguagePreference } from "../shared/language";
import { getLocale } from "../shared/locales";
import { extractionCopy as xc } from "../shared/extraction-copy";
import { galleryCopy as gc } from "../shared/gallery-copy";
import { galleryMessage, galleryPageProgress, galleryPercent } from "./gallery";
import {
  appendSelectedTabUrls,
  requestSupportedTabs,
  type SourceTab,
} from "./source-tabs";
import {
  normalizeEhentaiImportEntries,
  readVisibleEhentaiWorks,
  type EhentaiImportCandidate,
  type EhentaiPageEntry,
} from "./ehentai-import";
const localizedIntroduction = () => gc("introduction");

const popup = document.body.classList.contains("popup");
if (popup && !preview && chrome.extension?.getViews?.({ type: "popup" }).includes(window)) {
  document.body.classList.add("toolbar-popup");
}
const app = document.querySelector<HTMLDivElement>("#app")!;
let state = initialState(),
  filter = "queue",
  selected: string | undefined,
  addOpen = location.hash === "#add",
  settingsOpen = location.hash === "#settings";
let pending = false,
  lastRows = "",
  toastTimer: ReturnType<typeof setTimeout>;
let reconcileOpen = location.hash === "#reconcile";
let manualLoading = false;
let manualChoices: DownloadCandidate[] | undefined;
let manualItemId: string | undefined;
let sourceTabs: SourceTab[] | undefined;
let sourceTabsError = "";
let sourceTabsLoading = false;
let sourceTabsGeneration = 0;
let ehImportOpen = false;
let ehImportLoading = false;
let ehImportAdding = false;
let ehImportError = "";
let ehImportItems: EhentaiImportCandidate[] = [];
let ehImportEntries: EhentaiPageEntry[] = [];
const ehImportSelected = new Set<string>();
let ehImportGeneration = 0;
let ehImportMode: "reader" | "archive" = "reader";
const ehArchiveFor = (item?: QueueItem) => item?.ehArchive;
const ehReaderTabReasons = [
  "gallery_unavailable",
  "gallery_access_required",
  "gallery_content_warning",
  "gallery_invalid_metadata",
  "gallery_reader_tab_required",
];
function clearEhImport() {
  ehImportGeneration++;
  ehImportOpen = false;
  ehImportLoading = false;
  ehImportAdding = false;
  ehImportError = "";
  ehImportItems = [];
  ehImportEntries = [];
  ehImportSelected.clear();
  ehImportMode = "reader";
}
function ehentaiModeOptions(name: string, value: "reader" | "archive", browserFallback = false) {
  return `<fieldset class="ehentai-mode-options"><legend>${e(t("E-Hentai 下載模式"))}</legend><label><input type="radio" name="${e(name)}" value="reader" ${value === "reader" ? "checked" : ""}><span><strong>${e(t("閱讀圖 ZIP（免登入）"))}</strong><small>${e(t("使用閱讀圖，畫質與副檔名可能和官方原圖不同。"))}${browserFallback ? ` ${e(t("訪客讀不到時，會用 Chrome 開啟同一作品接續。"))}` : ""}</small></span></label><label><input type="radio" name="${e(name)}" value="archive" ${value === "archive" ? "checked" : ""}><span><strong>${e(t("官方原圖 ZIP"))}</strong><small>${e(t("需在 E-Hentai 官方頁登入，並自行確認點數。"))}</small></span></label></fieldset>`;
}
function refreshEhImportItems() {
  ehImportItems = normalizeEhentaiImportEntries(
    ehImportEntries,
    existingUrlsForEhentaiMode(ehImportMode),
  );
}
function clearSourceTabs() {
  sourceTabsGeneration++;
  sourceTabsLoading = false;
  sourceTabs = undefined;
  sourceTabsError = "";
}
function renderSourceTabs() {
  const panel = document.querySelector<HTMLElement>("#source-tabs-panel");
  if (!panel) return;
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="read-source-tabs"]')
    .forEach((button) => (button.disabled = sourceTabsLoading || preview));
  panel.hidden = !sourceTabs && !sourceTabsError && !sourceTabsLoading;
  if (sourceTabsLoading) {
    html(panel, `<p role="status">${e(t("正在讀取支援來源分頁…"))}</p>`);
    return;
  }
  if (sourceTabsError) {
    html(panel, `<p role="status">${e(t(sourceTabsError))}</p><button class="secondary" data-action="read-source-tabs">${e(t("再試一次"))}</button>`);
    return;
  }
  if (!sourceTabs) {
    html(panel, "");
    return;
  }
  if (!sourceTabs.length) {
    html(panel, `<p role="status">${e(t("找不到支援來源分頁。你可以直接貼上網址，或重新讀取分頁。"))}</p><button class="secondary" data-action="read-source-tabs">${e(t("重新讀取"))}</button>`);
    return;
  }
  const checked = new Set(
    [...panel.querySelectorAll<HTMLInputElement>('input[name="source-tab"]:checked')]
      .map((input) => Number(input.value)),
  );
  html(panel, `<p role="status">${e(t("列出所有 Chrome 視窗中的支援來源；只在此暫時顯示，不會儲存分頁資訊。"))}</p><label class="source-tab-select-all"><input type="checkbox" data-source-select-all ${checked.size === sourceTabs.length ? "checked" : ""}><span>${e(t("全選"))}</span></label><ul class="source-tab-list">${sourceTabs.map((tab) => `<li><label><input type="checkbox" name="source-tab" value="${tab.id}" ${checked.has(tab.id) ? "checked" : ""}><span data-raw title="${e(tab.title)}">${e(tab.title)}</span><small data-raw title="${e(tab.url)}">${e(tab.url)}</small></label></li>`).join("")}</ul><button class="secondary" data-action="insert-source-tabs">${e(t("加入已選分頁"))}</button><button class="quiet" data-action="close-source-tabs">${e(t("收起分頁清單"))}</button>`);
}
function renderEhentaiImportPanel() {
  const panel = document.querySelector<HTMLElement>("#ehentai-import-panel");
  if (!panel) return;
  panel.hidden = !popup || !ehImportOpen;
  if (!ehImportOpen) return;
  const stateText = ehImportLoading
    ? "正在讀取目前標籤頁的可見作品…"
    : ehImportError ||
      (ehImportItems.length
        ? `已找到 ${ehImportItems.length} 本。此頁最多匯入 50 本；不會自動翻頁。`
        : "只讀取目前頁面已顯示的作品，不會自動翻頁。網站登入、解鎖及點數由你處理。" );
  const list = ehImportItems.length
    ? `<ul id="ehentai-import-list" class="ehentai-import-list">${ehImportItems
        .map(
          (item, index) =>
            `<li><label><input type="checkbox" name="ehentai-work" value="${index}" ${ehImportSelected.has(item.url) ? "checked" : ""}><span title="${e(item.title)}">${e(item.title)}</span><small title="${e(item.url)}">${e(item.url)}</small></label></li>`,
        )
        .join("")}</ul>`
    : "";
  const selectedCount = ehImportItems.filter((item) => ehImportSelected.has(item.url)).length;
  const canReread = !ehImportLoading && (!ehImportItems.length || !!ehImportError);
  html(
    panel,
    `<div class="panel-heading"><h2>從此頁匯入作品</h2><button data-action="close-ehentai-import" class="icon-button" aria-label="返回佇列">${icon("close")}</button></div><p role="status">${e(t(stateText))}</p>${ehentaiModeOptions("ehentai-import-mode", ehImportMode)}${ehImportLoading ? "" : list}<div class="ehentai-import-actions">${canReread ? `<button class="secondary" data-action="retry-ehentai-import">${e(t("重新讀取此頁"))}</button>` : ""}<button class="quiet" data-action="close-ehentai-import">${e(t("返回佇列"))}</button><button id="ehentai-import-confirm" class="primary" data-action="confirm-ehentai-import" ${ehImportLoading || ehImportAdding || !selectedCount ? "disabled" : ""}>${ehImportAdding ? e(t("正在加入…")) : `${icon("plus")}${e(t("確認加入"))}${selectedCount ? `（${selectedCount}）` : ""}`}</button></div>`,
  );
}
let lastAnnouncedStatus = "";
let loaded = false;
const narrow = matchMedia("(max-width: 900px)");
const html = (el: Element, value: string) => {
  if (hasSameMarkup(el, value)) return;
  // 進度刷新會替換清單；用穩定操作識別保留鍵盤焦點，不依賴列的位置。
  const focused = document.activeElement;
  const keys = [
    "id",
    "data-action",
    "data-item",
    "data-select",
    "data-download",
    "data-source-select-all",
    "name",
    "value",
    "href",
  ];
  const identity =
    focused && el.contains(focused)
      ? keys.map((key) => [key, focused.getAttribute(key)] as const)
      : undefined;
  const rowId = focused?.closest(".queue-row")?.getAttribute("data-id");
  el.innerHTML = value;
  translateInterface(el);
  rememberMarkup(el, value);
  if (identity?.some(([, value]) => value !== null)) {
    const replacement = [
      ...el.querySelectorAll<HTMLElement>(
        "button, a, input, select, textarea, summary, [tabindex]",
      ),
    ].find(
      (candidate) =>
        identity.every(
          ([key, value]) => candidate.getAttribute(key) === value,
        ) && candidate.closest(".queue-row")?.getAttribute("data-id") === rowId,
    );
    replacement?.focus({ preventScroll: true });
  }
};
const btn = (name: string, label: string, action: string, extra = "") =>
  `<button class="${extra}" data-action="${action}">${icon(name)}<span>${label}</span></button>`;
app.innerHTML = `${preview ? `<div class="preview-bar">離線介面預覽 · 不會開始下載 <label>情境 <select id="scenario"><option value="empty">空佇列</option><option value="downloading">下載中</option><option value="waiting">網站等待</option><option value="verification">需要驗證</option><option value="blocked">下載中斷</option><option value="unknown-size">大小未知</option><option value="long-name">長檔名</option><option value="complete">全部完成</option></select></label></div>` : ""}
<div class="app-shell">
<aside class="sidebar"><a class="brand" href="manager.html">${icon("cat")}<span>QueueCat<span class="brand-dot">.</span></span></a><p class="brand-note">等待有人顧，時間留給你。</p><nav aria-label="主要導覽"><button data-filter="queue" class="nav-button selected">${icon("list")}下載佇列 <span id="nav-count"></span></button><button data-filter="attention" class="nav-button">${icon("alert")}待處理 <span id="attention-count"></span></button><button data-filter="complete" class="nav-button">${icon("check")}已完成 <span id="complete-count"></span></button></nav><div class="sidebar-bottom">${btn("folder", "Chrome 下載紀錄", "downloads")}${btn("settings", "偏好設定", "settings")}<div class="local-note"><span class="small-dot"></span>網址與紀錄，只留在這台電腦</div></div></aside>
<main class="main"><header class="topbar"><div class="popup-brand brand">${icon("cat")}QueueCat<span class="brand-dot">.</span></div><div class="breadcrumb">我的下載空間 <span>/</span> <span id="provider-breadcrumb" data-raw>Katfile</span></div><div class="top-actions">${popup ? `<span class="host-chip" id="provider-chip" data-raw>Katfile</span>` + btn("settings", "設定", "settings", "icon-button") : `<span class="host-chip" id="provider-chip" data-raw>Katfile</span>` + btn("settings", "設定", "settings", "icon-button top-settings")}</div></header>
<div id="status-announcement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
<section class="companion" aria-labelledby="status-title"><div class="companion-text"><div class="status-indicator"><span class="small-dot"></span><span id="run-label">正在休息</span></div><h1 id="status-title">把等待，交給貓貓。</h1><p id="status-subtitle">${e(gc("addHint"))}</p><div class="companion-actions" id="hero-actions"></div></div><img id="mascot" class="mascot" src="/assets/cat-sleep-v3.png" width="220" height="220" alt="熟睡的貓娘小管家"></section>
<ul id="first-promise" class="first-promise" aria-label="QueueCat 幫你做的事" hidden><li><strong>整串貼上</strong><span>多個網址，依序處理</span></li><li><strong>放心去忙</strong><span>網站倒數交給貓貓</span></li><li><strong>需要你再回來</strong><span>驗證或狀態不明時接手</span></li></ul><section id="current" class="current" aria-label="目前下載"></section>
<section id="reconcile-panel" class="inline-panel" hidden></section><section id="add-panel" class="inline-panel" hidden><div class="panel-heading"><h2>新增下載</h2><button data-action="close-add" class="icon-button" aria-label="收起新增網址">${icon("close")}</button></div><p>${e(gc("addHint"))}</p><button id="read-source-tabs" class="secondary" data-action="read-source-tabs" ${preview ? "disabled" : ""}>從分頁加入</button><section id="source-tabs-panel" aria-label="支援來源分頁" hidden></section><label for="url-input" class="sr-only">${e(gc("linkLabel"))}</label><textarea id="url-input" aria-label="${e(gc("linkLabel"))}" aria-keyshortcuts="Control+Enter Meta+Enter" rows="5" placeholder="${e(gc("addPlaceholder"))}" spellcheck="false"></textarea><div id="ehentai-add-mode" hidden>${ehentaiModeOptions("ehentai-add-mode-choice", "reader", true)}</div><div class="extraction-options"><label class="extraction-toggle"><input id="extract-after-download" type="checkbox"><span id="extract-label"></span></label><span id="gallery-extraction-hint" hidden>${e(gc("extractionNotSupported"))}</span><label id="batch-password-wrap" class="batch-password" for="batch-password" hidden><span id="batch-password-label"></span><input id="batch-password" type="password" autocomplete="new-password" aria-describedby="batch-password-hint"><small id="batch-password-hint"></small></label></div><div id="url-preview" class="url-preview"></div><div class="panel-footer"><span>只加入清單，不會立刻開始下載。<small class="shortcut-hint"><kbd>Ctrl / ⌘</kbd> + <kbd>Enter</kbd> 快速加入</small></span><button id="confirm-add" class="primary" disabled>${icon("plus")}確認加入</button></div></section>
<section id="settings-panel" class="inline-panel" hidden><div class="panel-heading"><h2>偏好設定</h2><button data-action="close-settings" class="icon-button" aria-label="收起設定">${icon("close")}</button></div><label class="setting-row"><span>${icon("bell")}桌面通知<small>需要驗證、需要你處理，或整輪完成時通知。</small></span><input id="notifications" type="checkbox" role="switch"></label><div class="setting-row"><span>確認通知能找到你<small id="notification-permission">Windows 專注模式也可能隱藏通知。</small></span><button data-action="test-notification">發送測試通知</button></div><label class="setting-row"><span>語言<small>預設跟隨瀏覽器；未支援的語言使用英文。</small></span><select id="language"><option value="system">跟隨瀏覽器</option><option value="en">English</option><option value="zh-TW">繁體中文</option><option value="ja">日本語</option></select></label><label class="setting-row"><span>${icon("moon")}介面主題</span><select id="theme"><option value="system">跟隨系統</option><option value="light">淺色</option><option value="dark">深色</option></select></label><label class="setting-row"><span>減少動態效果<small>貓娘一直都是靜態圖片；此設定減少介面過場。</small></span><input id="reduced-motion" type="checkbox" role="switch"></label><section id="helper-settings" class="helper-settings" aria-labelledby="helper-title"><h3 id="helper-title"></h3><p id="helper-description"></p><p id="helper-status" role="status"></p><p class="extension-id-row"><span id="extension-id-label"></span><code id="extension-id" data-raw></code></p><p id="helper-setup-instruction"></p><button data-action="check-helper"></button></section><p class="settings-help">檔案儲存位置與是否詢問另存新檔，沿用 Chrome 設定。暫停、續傳及取消目前檔案，請到 Chrome 下載紀錄操作。</p><details class="shortcut-help"><summary>更順手的小技巧</summary><dl><dt><kbd>Ctrl / ⌘</kbd> + <kbd>Enter</kbd></dt><dd>貼好網址後，直接加入，不會自動開始下載。</dd><dt><kbd>Alt</kbd> + <kbd>↑ / ↓</kbd></dt><dd>在待下載那一列調整順序；方向按鈕也一樣好用。</dd><dt><kbd>Esc</kbd></dt><dd>收起目前面板或檔案詳情，不會暫停或取消下載。</dd></dl></details><section id="about-queuecat" class="about-queuecat" aria-labelledby="about-title"><h3 id="about-title">等下載，也可以很療癒。</h3><p>${e(gc("introduction"))}</p><label for="share-intro">介紹給朋友</label><textarea id="share-intro" rows="6" readonly spellcheck="false">${e(gc("introduction"))}</textarea><div class="share-actions">${btn("link", "複製介紹", "copy-intro", "secondary")}<span>只有產品簡介，不含你的下載資料。</span></div></section></section>
<section class="queue-section"><div class="section-heading"><h2 id="list-title">下載佇列 <span id="list-count"></span></h2><div class="list-actions">${btn("trash", "清除完成紀錄", "clear-complete", "quiet")}${btn("plus", "新增網址", "add", "secondary")}</div></div><div class="mobile-tabs" role="group" aria-label="佇列分類"><button data-filter="queue">佇列</button><button data-filter="attention">待處理</button><button data-filter="complete">已完成</button></div><div class="queue-layout"><div id="queue-list"></div><aside id="details" class="details" aria-label="檔案詳情"></aside></div></section>
<footer class="page-footer"><span>貓貓管排隊，Chrome 管下載。</span>${btn("link", "介紹給朋友", "share", "quiet")}<span>QueueCat 0.1.0</span></footer><div class="popup-footer" id="popup-footer"><div id="popup-summary" class="popup-summary"></div>${btn("plus", "新增網址", "add")}${btn("arrow", "完整管理頁", "manager")}</div></main></div><div id="toast" class="toast" role="status" aria-live="polite" hidden></div>`;
if (popup) {
  const footer = document.querySelector(".popup-footer")!;
  const body = document.createElement("div");
  body.className = "popup-body";
  body.append(...Array.from(footer.parentElement!.children).filter((child) => child !== footer));
  footer.before(body);
  footer.insertAdjacentHTML(
    "afterbegin",
    `<button class="secondary" data-action="import-ehentai" hidden>${icon("plus")}<span>從此頁匯入作品</span></button>`,
  );
}
(app.querySelector(".popup-body") || app).insertAdjacentHTML(
  "beforeend",
  `<section id="ehentai-import-panel" class="ehentai-import-panel" aria-labelledby="ehentai-import-title" hidden><div class="panel-heading"><h2 id="ehentai-import-title">從此頁匯入作品</h2><button data-action="close-ehentai-import" class="icon-button" aria-label="返回佇列">${icon("close")}</button></div><p role="status"></p><ul id="ehentai-import-list" class="ehentai-import-list"></ul><div class="ehentai-import-actions"><button class="quiet" data-action="close-ehentai-import">返回佇列</button><button id="ehentai-import-confirm" class="primary" data-action="confirm-ehentai-import" disabled>確認加入</button></div></section>`,
);
const gelbooruSession = preview ? undefined : globalThis.chrome?.storage?.session;
if (gelbooruSession) {
  document.querySelector("#helper-settings")!.insertAdjacentHTML("afterend", `
    <details class="helper-settings" id="gelbooru-settings">
      <summary>Gelbooru API 設定</summary>
      <p>從 Gelbooru 帳號設定取得 User ID 和 API Key。資料只保留在這次 Chrome 工作階段。</p>
      <form>
        <label class="batch-password">User ID<input name="userId" inputmode="numeric" autocomplete="off" maxlength="10" required></label>
        <label class="batch-password">API Key<input name="apiKey" type="password" autocomplete="new-password" maxlength="160" required></label>
        <button type="submit">儲存 API 資料</button>
        <button type="button" id="forget-gelbooru">清除 API 資料</button>
      </form>
      <p role="status" id="gelbooru-status"></p>
    </details>`);
  const form = document.querySelector<HTMLFormElement>("#gelbooru-settings form")!;
  const result = document.querySelector<HTMLElement>("#gelbooru-status")!;
  const showResult = (message: string) => {
    result.textContent = message;
    translateInterface(result);
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const credentials = gelbooruCredentials({
      userId: String(values.get("userId") ?? "").trim(),
      apiKey: String(values.get("apiKey") ?? "").trim(),
    });
    if (!credentials) return showResult("請檢查 Gelbooru User ID 和 API Key 的格式。");
    try {
      await gelbooruSession.set({ [GELBOORU_SESSION_KEY]: credentials });
      form.reset();
      showResult("已設定這次 Chrome 工作階段的 Gelbooru API 資料。");
    } catch {
      showResult("無法更新 Gelbooru API 資料。");
    }
  });
  document.querySelector("#forget-gelbooru")!.addEventListener("click", async () => {
    try {
      await gelbooruSession.remove(GELBOORU_SESSION_KEY);
      form.reset();
      showResult("已清除 Gelbooru API 資料。");
    } catch {
      showResult("無法更新 Gelbooru API 資料。");
    }
  });
  void gelbooruSession.get(GELBOORU_SESSION_KEY).then((stored) => {
    if (gelbooruCredentials(stored[GELBOORU_SESSION_KEY]) && !result.textContent)
      showResult("已設定這次 Chrome 工作階段的 Gelbooru API 資料。");
  }).catch(() => undefined);
}
translateInterface(app);

function toast(message: string, tone: "info" | "success" = "info") {
  const el = document.querySelector<HTMLElement>("#toast")!;
  el.dataset.tone = tone;
  html(
    el,
    `${icon(tone === "success" ? "cat" : "alert")}<span>${e(message)}</span>`,
  );
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => (el.hidden = true),
    tone === "success" ? 3800 : 6000,
  );
}
function meter(item: QueueItem) {
  if (item.gallery) {
    const percent = galleryPercent(item);
    return `<div class="progress-line gallery-progress"><progress ${percent === undefined ? "" : `value="${percent}"`} max="100" aria-label="${e(`${gc("album")}: ${galleryPageProgress(item)}`)}"></progress><span>${e(galleryPageProgress(item))}${percent === undefined ? "" : ` · ${percent.toFixed(1)}%`}</span></div>`;
  }
  const p = progress(item);
  return `<div class="progress-line">${item.status === "downloading" ? `<progress ${p === undefined ? "" : `value="${p}"`} max="100" aria-label="下載進度"></progress><span>${p === undefined ? "大小未知" : `${p.toFixed(1)}%`}</span>` : item.status === "waiting" ? `<span class="wait-clock-label">網站倒數</span><time data-until="${item.waitUntil || 0}">${countdown(item.waitUntil)}</time>` : ""}</div>`;
}
const canReconcile = (item?: QueueItem) =>
  !!item &&
  ((!!ehArchiveFor(item) &&
    ["verification", "blocked"].includes(item.status) &&
    item.downloadId === undefined &&
    Number.isFinite(ehArchiveFor(item)?.openedAt)) ||
    (item.status === "blocked" &&
      item.downloadId === undefined &&
      item.action?.kind !== "download"));
const pendingDownloadMatch = (item?: QueueItem) =>
  canReconcile(item) &&
  item?.reason === "Chrome 已有同名下載，請確認是否為同一筆；不會重新下載。";
const statusText = (item: QueueItem) =>
  pendingDownloadMatch(item) ? t("待核對下載") : labels[item.status];
const extractionFor = (itemId?: string) =>
  itemId
    ? [...(state.extractions || [])]
        .reverse()
        .find((group) => group.itemIds.includes(itemId))
    : undefined;
const extractionErrorKeys = {
  helper_unavailable: "helperMissing",
  engine_unavailable: "engineMissing",
  missing_volumes: "missingVolumes",
  password_or_corrupt: "wrongPassword",
  password_expired: "passwordExpired",
  unsafe_archive: "unsafeArchive",
  extraction_failed: "extractionFailed",
  unknown_job: "unknownJob",
  source_unavailable: "sourceUnavailable",
  invalid_archive: "invalidArchive",
  gallery_extraction_not_supported: "extractionFailed",
} as const;
const isKnownExtractionError = (code?: string) =>
  !!code && Object.hasOwn(extractionErrorKeys, code);
function extractionError(code?: string) {
  if (!code) return xc("extractionFailed");
  return isKnownExtractionError(code)
    ? xc(extractionErrorKeys[code as keyof typeof extractionErrorKeys])
    : code;
}
function extractionStatus(group: NonNullable<AppState["extractions"]>[number]) {
  return group.errorCode && group.status !== "failed"
    ? `${xc(group.status)} · ${extractionError(group.errorCode)}`
    : xc(group.status);
}
function renderExtractionSettings() {
  document.querySelector<HTMLElement>("#helper-title")!.textContent =
    xc("helperSetup");
  document.querySelector<HTMLElement>("#helper-description")!.textContent =
    xc("helperDescription");
  document.querySelector<HTMLElement>(
    "#helper-setup-instruction",
  )!.textContent = xc("setupInstruction");
  document.querySelector<HTMLButtonElement>(
    '#helper-settings [data-action="check-helper"]',
  )!.textContent = xc("checkHelper");
  document.querySelector<HTMLElement>("#extension-id-label")!.textContent =
    xc("extensionId");
  const extensionId =
    !preview && typeof chrome !== "undefined" ? chrome.runtime?.id || "" : "";
  document.querySelector<HTMLElement>("#extension-id")!.textContent =
    extensionId;
  const status = document.querySelector<HTMLElement>("#helper-status")!;
  status.textContent =
    state.nativeHelper === undefined
      ? xc("helperNotChecked")
      : state.nativeHelper.available
        ? state.nativeHelper.engineAvailable
          ? xc("helperReady")
          : xc("engineMissing")
        : xc("helperMissing");
}
function reconcileHtml() {
  const item = state.items.find((i) => i.id === state.activeId);
  if (!canReconcile(item)) return "";
  const choices = manualItemId === item!.id ? manualChoices : undefined;
  const ehArchive = !!ehArchiveFor(item);
  return `<div class="panel-heading"><h2>核對已開始的下載</h2><button data-action="close-reconcile" class="icon-button" aria-label="收起核對下載">${icon("close")}</button></div><p>目前檔案：<strong data-raw>${e(item!.title || item!.sourceUrl)}</strong></p><p>${e(t(ehArchive ? "先在官方頁選擇原圖 ZIP、確認點數並開始下載。核對這裡的檔名、來源與時間後，可接續追蹤。" : "如果你已按過 Katfile 的「繼續免費下載」，請先核對 Chrome 裡的檔案、時間與容量，再確認這是同一筆。確認後只接續追蹤，不會重新下載。"))}</p><button data-action="find-downloads" ${manualLoading ? "disabled" : ""}>${manualLoading ? e(t("正在讀取…")) : e(t("讀取可核對的下載"))}</button>${choices ? (choices.length ? `<ul class="download-choices">${choices.map((d) => `<li><strong data-raw>${e(d.filename)}</strong><span data-raw>${e(d.host)} · ${e(new Date(d.startTime).toLocaleString(messageLanguage()))}</span><span>${t(d.state === "complete" ? "已完成" : "下載中")} · ${bytes(d.bytesReceived)}${d.totalBytes > 0 ? " / " + bytes(d.totalBytes) : " · " + t("大小未知")}</span><button class="secondary" data-action="adopt-download" data-download="${d.id}">確認這筆，接續追蹤</button></li>`).join("")}</ul>` : `<p role="status">${e(t(ehArchive ? "找不到符合條件的 E-Hentai ZIP 下載。請先在官方頁自行啟動 ZIP，完成後再讀取候選。" : "找不到符合檔名、時間與 Katfile 網域的下載。請先到 Chrome 核對，不要重新按下載。"))}</p>`) : ""}`;
}
function currentHtml(item?: QueueItem) {
  if (!item)
    return `<div class="no-current">${icon("list")}<span>目前沒有進行中的下載</span><span class="serial-note">一次一筆，依序下載</span></div>`;
  const next = state.items.find(
    (i) => i.status === "queued" && i.id !== item.id,
  );
  const group = extractionFor(item.id);
  const displayTitle = item.gallery?.title || item.title || item.sourceUrl;
  const ehArchive = !!item.ehArchive;
  const transfer =
    item.status === "downloading"
      ? `${bytes(item.bytesReceived || 0)}${item.totalBytes && item.totalBytes > 0 ? " / " + bytes(item.totalBytes) : " · " + t("大小未知")}`
      : e(
          item.gallery
            ? galleryMessage(item) || gc("album")
            : briefReason(item),
        );
  return `<div class="current-heading"><span class="current-label">目前${item.gallery ? e(gc("album")) : ehArchive ? e(t("E-Hentai 官方 ZIP")) : "檔案"}</span><span class="status-tag ${item.status}">${e(statusText(item))}</span></div><div class="current-file">${icon("folder")}<strong data-raw title="${e(displayTitle)}">${e(displayTitle)}</strong></div>${meter(item)}${group ? `<div class="extraction-status ${group.status}">${e(extractionStatus(group))}${group.status === "failed" ? ` · ${e(extractionError(group.errorCode))}` : ""}</div>` : ""}${canReconcile(item) ? `<button data-action="reconcile" class="text-button">${e(t(ehArchive ? "核對已開始的 ZIP 下載" : "核對已開始的下載"))}</button>` : ""}<div class="transfer-meta"><span>${item.gallery && item.status === "downloading" ? `${e(galleryPageProgress(item))} · ${transfer}` : transfer}</span><span>${item.status === "downloading" && item.speed !== undefined ? bytes(item.speed) + "/s" : ""}</span></div>${item.status === "downloading" ? `<p class="download-remaining">${e(downloadRemaining(item))}</p>` : ""}${item.status === "downloading" ? '<button data-action="downloads" class="text-button">到 Chrome 管理這筆下載</button>' : item.gallery && item.status === "blocked" && (item.downloadId !== undefined || item.action?.kind === "download") ? `<button data-action="downloads" class="text-button">${e(t("核對下載狀態"))}</button>` : ""}${!item.gallery && !ehArchive && next ? `<div class="next-file">下一筆 <span data-raw>${e(next.title || next.sourceUrl)}</span></div>` : ""}`;
}
function rowHtml(
  item: QueueItem,
  n: number,
  firstQueued?: string,
  lastQueued?: string,
): string {
  const active =
    state.activeId === item.id ||
    ["queued", "extracting"].includes(extractionFor(item.id)?.status || "");
  const removableGalleryBlock =
    !!item.gallery &&
    item.status === "blocked" &&
    item.downloadId === undefined &&
    item.action?.kind !== "download";
  const removableSourceBlock =
    !item.gallery &&
    (!item.ehArchive ||
      (item.downloadId === undefined &&
        ["verification", "blocked"].includes(item.status))) &&
    !["queued", "extracting"].includes(extractionFor(item.id)?.status || "");
  const readerTabRetryable = canRetryEhentaiReaderInTab(item);
  const retryable =
    readerTabRetryable ||
    item.status === "failed" ||
    (!item.gallery &&
      !item.ehArchive &&
      item.status === "blocked" &&
      item.action?.kind !== "download" &&
      item.downloadId === undefined);
  const group = extractionFor(item.id);
  const removeLabel =
    group && group.status !== "complete"
      ? xc("removeCancelsExtraction")
      : t("移除紀錄");
  const displayTitle = item.gallery?.title || item.title || item.sourceUrl;
  const secondary = item.reason === "gallery_manual_archive"
    ? gc("manualArchive")
    : item.ehArchive
      ? t("E-Hentai 官方 ZIP")
    : item.gallery
    ? `${galleryPageProgress(item)}${galleryPercent(item) === undefined ? "" : ` · ${galleryPercent(item)!.toFixed(1)}%`}${item.status === "downloading" ? ` · ${bytes(item.bytesReceived || 0)}${item.totalBytes && item.totalBytes > 0 ? " / " + bytes(item.totalBytes) : " · " + t("大小未知")}` : ` · ${galleryMessage(item) || gc("album")}`}`
    : item.status === "downloading"
      ? bytes(item.bytesReceived || 0) +
        (item.totalBytes && item.totalBytes > 0
          ? " / " + bytes(item.totalBytes)
          : " · " + t("大小未知"))
      : item.status === "waiting"
        ? briefReason(item)
        : item.reason || "katfile.biz";
  return `<article class="queue-row ${selected === item.id ? "is-selected" : ""}" data-id="${item.id}"><button class="file-select" data-select="${item.id}" aria-expanded="${selected === item.id}"><span class="row-number">${item.status === "complete" ? icon("check") : String(n + 1).padStart(2, "0")}</span><span class="file-icon">${icon("folder")}</span><span class="file-info"><strong data-raw title="${e(displayTitle)}">${e(displayTitle)}</strong><small>${e(secondary)}${group ? ` · ${e(extractionStatus(group))}` : ""}</small></span><span class="status-tag ${item.status}">${e(statusText(item))}</span></button><div class="row-actions">${item.status === "queued" ? `<button data-item="${item.id}" data-action="up" aria-label="往前移" title="往前移（Alt + ↑）" aria-keyshortcuts="Alt+ArrowUp" ${item.id === firstQueued ? "disabled" : ""}>${icon("up")}</button><button data-item="${item.id}" data-action="down" aria-label="往後移" title="往後移（Alt + ↓）" aria-keyshortcuts="Alt+ArrowDown" ${item.id === lastQueued ? "disabled" : ""}>${icon("down")}</button>` : ""}${retryable ? `<button data-item="${item.id}" data-action="retry" aria-label="${e(t(readerTabRetryable ? "使用這本的作品分頁重試" : "重新排隊"))}" title="${e(t(readerTabRetryable ? "使用這本的作品分頁重試" : "重新排隊"))}" ${pending ? "disabled" : ""}>${icon("retry")}</button>` : ""}${item.status === "complete" ? `<button data-item="${item.id}" data-action="show-file" aria-label="在資料夾顯示">${icon("folder")}</button>` : ""}${!active || removableGalleryBlock || removableSourceBlock ? `<button data-item="${item.id}" data-action="remove" aria-label="${e(removeLabel)}" title="${e(removeLabel)}">${icon("trash")}</button>` : ""}</div></article>`;
}
function detailsHtml(item?: QueueItem) {
  if (!item)
    return `<div class="detail-empty">${icon("link")}<h3>每個檔案，都有自己的步調</h3><p>選取清單中的檔案，查看來源與處理紀錄。</p></div>`;
  const times = new Intl.DateTimeFormat(messageLanguage(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const group = extractionFor(item.id);
  const displayTitle = item.gallery?.title || item.title || "等待網站提供檔名";
  const ehArchive = !!item.ehArchive;
  const manualArchive = item.reason === "gallery_manual_archive";
  const sourceHref = item.gallery || ehArchive
    ? parseGallerySource(item.sourceUrl)?.url || item.sourceUrl
    : item.sourceUrl;
  const focusable = ehArchive
    ? ["verification", "blocked"].includes(item.status)
    : !item.gallery &&
      ["verification", "blocked", "waiting", "preparing"].includes(item.status);
  const sourceActions = focusable
    ? `<div class="detail-actions"><button data-action="focus" data-item="${item.id}">${icon("arrow")}${e(t(ehArchive ? "前往官方 ZIP 頁面" : "前往工作分頁"))}</button>${!ehArchive && item.status === "blocked" ? `<button data-action="recheck" data-item="${item.id}">${icon("retry")}重新檢查</button>` : ""}</div>`
    : "";
  const ehArchiveDetails = ehArchive
    ? `<section class="gallery-detail ehentai-detail"><p><strong>${e(t("官方原圖 ZIP"))}</strong></p><p>${e(t("先在官方頁選擇原圖 ZIP、確認點數並開始下載。QueueCat 不會代替你使用點數或啟動下載。"))}</p>${canReconcile(item) ? `<button class="secondary" data-action="reconcile" data-item="${item.id}">${e(t("核對已開始的 ZIP 下載"))}</button>` : ""}</section>`
    : "";
  const ehReader = item.gallery && parseGallerySource(item.sourceUrl)?.site === "ehentai";
  const readerTabUsed = Boolean(item.gallery?.readerTab);
  const outputName =
    item.gallery?.output === "zip"
      ? item.gallery.archive?.filename
      : item.gallery?.folder;
  const galleryDetails = item.gallery && !manualArchive
    ? `<section class="gallery-detail${ehReader ? " ehentai-detail" : ""}">${ehReader ? `<p><strong>${e(t(readerTabUsed ? "閱讀圖 ZIP（使用作品分頁）" : "閱讀圖 ZIP（免登入）"))}</strong> · ${e(t("使用閱讀圖，畫質與副檔名可能和官方原圖不同。"))}</p>` : ""}<p><strong>${e(galleryPageProgress(item))}</strong>${galleryPercent(item) === undefined ? "" : ` · ${galleryPercent(item)!.toFixed(1)}%`}</p>${outputName ? `<p>${e(gc(item.gallery.output === "zip" ? "folder" : "album"))}：<span data-raw title="${e(outputName)}">${e(outputName)}</span></p>` : ""}<p>${e(gc(item.gallery.output === "zip" ? "imageFormat" : "legacyFormat"))}</p>${item.gallery.output === "zip" && item.reason !== "gallery_content_warning" ? `<p>${e(gc("retryTip"))}</p>` : ""}</section>`
    : "";
  const readerTabAction =
    ehReader &&
    ["failed", "blocked"].includes(item.status) &&
    ehReaderTabReasons.includes(item.reason || "")
      ? `<section class="gallery-detail ehentai-detail"><p>${e(t("先在 E-Hentai 開到這本的作品清單。分頁關閉時，QueueCat 會重開這本。"))}</p><button class="secondary" data-action="use-ehentai-tab" data-item="${e(item.id)}" ${pending ? "disabled" : ""}>${e(t("使用這本的作品分頁重試"))}</button></section>`
      : "";
  return `<div class="detail-heading"><h3>檔案詳情</h3><button data-action="close-detail" class="icon-button" aria-label="收起詳情">${icon("close")}</button></div><strong class="detail-filename" data-raw>${e(displayTitle)}</strong><span class="status-tag ${item.status}">${e(statusText(item))}</span><h4>${item.gallery ? e(gc("gallerySource")) : ehArchive ? e(t("E-Hentai 官方作品")) : "來源網址"}</h4>${item.gallery || ehArchive ? `<a class="text-button" href="${e(sourceHref)}" target="_blank" rel="noopener noreferrer">${icon("arrow")}${e(t(ehArchive ? "開啟官方作品頁" : gc("gallerySource")))}</a><span data-raw title="${e(item.sourceUrl)}">${e(item.sourceUrl)}</span>` : `<a data-raw href="${e(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(item.sourceUrl)}</a>`}${item.reason ? `<p class="reason" ${item.gallery || ehArchive ? "data-raw" : ""}>${e(item.gallery ? galleryMessage(item) : item.reason)}</p>` : ""}${galleryDetails}${readerTabAction}${ehArchiveDetails}${group ? `<section class="extraction-detail"><h4>${e(xc("enable"))}</h4><p class="extraction-status ${group.status}">${e(extractionStatus(group))}</p>${group.status === "failed" ? `<p class="reason">${e(extractionError(group.errorCode))}${group.errorCode && !(group.errorCode in extractionErrorKeys) ? ` <code data-raw>${e(group.errorCode)}</code>` : ""}</p><label class="retry-password" for="retry-extraction-password">${e(xc(group.errorCode === "password_expired" ? "passwordLabel" : "retryPassword"))}<input id="retry-extraction-password" type="password" autocomplete="new-password" aria-describedby="retry-password-hint" data-group="${e(group.id)}"><small id="retry-password-hint">${e(xc(group.errorCode === "password_expired" ? "expiredPasswordHint" : "retryPasswordHint"))}</small></label><button class="secondary" data-action="retry-extraction" data-group="${e(group.id)}">${e(xc("retry"))}</button>` : ""}${group.outputDir ? `<p class="extraction-output"><span>${e(xc("output"))}:</span> <span data-raw title="${e(group.outputDir)}">${e(group.outputDir)}</span></p>` : ""}</section>` : ""}${sourceActions}${item.gallery && item.status === "blocked" && item.action?.kind === "download" && item.downloadId === undefined ? `<div class="detail-actions"><button data-action="downloads" data-item="${item.id}">${icon("arrow")}${e(t("核對下載狀態"))}</button></div>` : ""}<h4>處理紀錄</h4><ol class="event-list">${
    item.events.length
      ? item.events
          .slice(-12)
          .reverse()
          .map(
            (event) =>
              `<li><time>${times.format(event.at)}</time><span ${item.gallery ? "data-raw" : ""}>${e(item.gallery ? galleryMessage(item, event.message) : event.message)}</span></li>`,
          )
          .join("")
      : "<li>加入後尚未開始處理。</li>"
  }</ol>`;
}
function render() {
  const languageChanged = setMessageLanguage(state.settings.language);
  document.documentElement.lang = messageLanguage();
  document.title =
    getLocale(messageLanguage())[popup ? "popupTitle" : "managerTitle"];
  if (languageChanged) {
    lastRows = "";
    translateInterface(app);
  }
  document.querySelector<HTMLElement>("#first-promise")!.hidden =
    popup || state.items.length > 0 || settingsOpen || reconcileOpen;
  document.body.dataset.empty = String(state.items.length === 0);
  const ehImporting = popup && ehImportOpen;
  document.body.dataset.panel = ehImporting
    ? "ehentai-import"
    : addOpen
    ? "add"
    : settingsOpen
      ? "settings"
      : reconcileOpen
        ? "reconcile"
        : "";
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.reducedMotion = String(
    state.settings.reducedMotion,
  );
  const info = summary(state),
    active = state.items.find((i) => i.id === state.activeId);
  // 只公告離散狀態或目前檔案切換；每秒取樣與倒數不重複打斷讀屏。
  const provider = state.items.some((item) => item.gallery)
    ? gc("siteLabel")
    : "Katfile";
  document.querySelector("#provider-breadcrumb")!.textContent = provider;
  document.querySelector("#provider-chip")!.textContent = provider;
  const announcementKey = JSON.stringify([
    messageLanguage(),
    state.running,
    active?.id,
    active?.status,
    info.title,
    active?.gallery?.completed,
    active?.gallery?.archive?.staged,
    active?.gallery?.archive?.phase,
  ]);
  if (announcementKey !== lastAnnouncedStatus) {
    lastAnnouncedStatus = announcementKey;
    document.querySelector("#status-announcement")!.textContent =
      t(info.title) +
      (active
        ? " " +
          (active.title || active.sourceUrl) +
          "，" +
          t(labels[active.status]) +
          (active.gallery ? " " + galleryPageProgress(active) : "")
        : "");
  }
  document.querySelector("#status-title")!.textContent = !state.items.length
    ? tagline
    : info.title;
  document.querySelector("#status-subtitle")!.textContent = !state.items.length
    ? gc("addHint")
    : active?.gallery && active.status === "blocked"
      ? galleryMessage(active) || gc("handoffUncertain")
      : popup && active?.status === "blocked"
        ? briefReason(active)
        : info.subtitle;
  document.querySelector("#run-label")!.textContent = state.running
    ? "貓貓值班中"
    : "貓貓休息中";
  const img = document.querySelector<HTMLImageElement>("#mascot")!;
  img.src = `/assets/cat-${info.mascot}-v3.png`;
  img.alt = getLocale(messageLanguage()).mascotAlt(t(info.title));
  const hero = document.querySelector("#hero-actions")!;
  const needsDownloadCheck =
    active?.status === "blocked" &&
    (active.downloadId !== undefined || active.action?.kind === "download");
  const attentionAction =
    active?.downloadId !== undefined ? "downloads" : "recheck";
  const hasPendingWork = state.items.some(
    (item) => item.status === "queued" || isAutomaticRetryCandidate(item),
  );
  const primaryAction =
    !active && !hasPendingWork
      ? btn("plus", "新增下載網址", "add", "primary")
      : needsDownloadCheck
        ? `<button class="primary" data-action="${attentionAction}" data-item="${active!.id}">${icon("arrow")}核對下載狀態</button>`
        : active?.gallery && active.status === "blocked"
          ? ""
          : active && ["verification", "blocked"].includes(active.status)
            ? `<button class="primary" data-action="focus" data-item="${active.id}">${icon("arrow")}${active.ehArchive ? "前往官方 ZIP 頁面" : active.status === "verification" ? "前往驗證" : "前往工作分頁"}</button>`
            : btn(
                state.running ? "pause" : "play",
                state.running ? "暫停排隊" : "開始排隊",
                state.running ? "pause" : "start",
                "primary",
              );
  const forgetAction =
    active?.gallery &&
    active.status === "blocked" &&
    active.downloadId === undefined &&
    active.action?.kind === "download"
      ? btn("trash", e(gc("forgetUncertain")), "forget-gallery", "quiet")
      : "";
  const removeSourceAction =
    active &&
    !active.ehArchive &&
    !active.gallery &&
    !["queued", "extracting"].includes(extractionFor(active.id)?.status || "")
      ? `<button data-action="remove" data-item="${active.id}" class="quiet" title="${e(t("只移除 QueueCat 紀錄，Chrome 下載會繼續。"))}">${icon("trash")}${e(t("移除紀錄"))}</button>`
      : "";
  html(
    hero,
    `${primaryAction}${active && ["verification", "blocked"].includes(active.status) ? btn(state.running ? "pause" : "play", state.running ? "暫停排隊" : "繼續排隊", state.running ? "pause" : "start") : ""}${forgetAction}${removeSourceAction}${!popup && state.items.length ? btn("plus", "新增網址", "add", "quiet") : ""}`,
  );
  hero.setAttribute("aria-busy", String(pending));
  hero.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.disabled =
      pending || (!active && !hasPendingWork && b.dataset.action === "start");
  });
  const displayed =
    state.externalDownloadId !== undefined &&
    state.externalWaitReason &&
    state.externalTransfer
      ? {
          id: `external-${state.externalDownloadId}`,
          sourceUrl: "",
          status: "downloading" as const,
          createdAt: 0,
          updatedAt: 0,
          events: [],
          ...state.externalTransfer,
        }
      : active;
  document.querySelector<HTMLElement>("#current")!.dataset.status =
    displayed?.status || "empty";
  document.querySelector<HTMLElement>("#current")!.hidden = ehImporting || !displayed;
  html(
    document.querySelector("#current")!,
    currentHtml(displayed) +
      (pendingDownloadMatch(active) && state.externalDownloadId !== undefined
        ? `<button class="text-button" data-action="confirm-external" data-item="${e(active!.id)}" data-download="${state.externalDownloadId}">${e(t("確認是同一筆下載，接續追蹤"))}</button>`
        : ""),
  );
  const queue = state.items.filter(
      (i) => !["failed", "blocked", "complete"].includes(i.status),
    ),
    attention = state.items.filter(
      (i) => isAttention(i) || extractionFor(i.id)?.status === "failed",
    ),
    completed = state.items.filter(
      (i) =>
        i.status === "complete" && extractionFor(i.id)?.status !== "failed",
    );
  document.querySelector("#popup-summary")!.textContent = state.items.length
    ? `排隊 ${queue.length} · 完成 ${completed.length} · 待處理 ${attention.length}`
    : "";
  [
    ["nav-count", queue.length],
    ["attention-count", attention.length],
    ["complete-count", completed.length],
  ].forEach(
    ([id, n]) => (document.getElementById(String(id))!.textContent = String(n)),
  );
  const items =
    filter === "attention"
      ? attention
      : filter === "complete"
        ? completed
        : queue;
  html(
    document.querySelector("#list-title")!,
    `${filter === "queue" ? "下載佇列" : filter === "attention" ? "待處理" : "已完成"} <span>${items.length}</span>`,
  );
  const movable = queue.filter((item) => item.status === "queued");
  const rows = items.length
    ? `<div class="list-caption"><span>檔案名稱</span><span>狀態與操作</span></div>${items.map((item, index) => rowHtml(item, index, movable[0]?.id, movable[movable.length - 1]?.id) + (narrow.matches && selected === item.id ? `<section class="inline-details details">${detailsHtml(item)}</section>` : "")).join("")}`
    : `<div class="empty-state">${icon(filter === "complete" ? "check" : filter === "attention" ? "alert" : "list")}<h3>${filter === "queue" ? "還沒有要排隊的檔案" : filter === "attention" ? "目前沒有需要你處理的項目" : "這裡會收好完成的下載"}</h3><p>${filter === "queue" ? e(gc("addHint")) : filter === "attention" ? "失效或中斷的項目會保留在這裡。" : "檔案由 Chrome 儲存，貓貓只保留處理紀錄。"}</p>${filter === "queue" ? btn("plus", "加入第一批網址", "add", "secondary") : ""}</div>`;
  if (rows !== lastRows) {
    html(document.querySelector("#queue-list")!, rows);
    lastRows = rows;
  }
  html(
    document.querySelector("#details")!,
    narrow.matches
      ? ""
      : detailsHtml(state.items.find((i) => i.id === selected)),
  );
  document.querySelector<HTMLElement>("#details")!.hidden = narrow.matches;
  document
    .querySelectorAll<HTMLButtonElement>("[data-filter]")
    .forEach((el) => {
      el.classList.toggle("selected", el.dataset.filter === filter);
      el.setAttribute("aria-pressed", String(el.dataset.filter === filter));
    });
  const clear = document.querySelector<HTMLButtonElement>(
    '[data-action="clear-complete"]',
  )!;
  clear.hidden = filter !== "complete";
  clear.disabled = !completed.length;
  document.querySelector<HTMLElement>("#add-panel")!.hidden = !addOpen;
  renderSourceTabs();
  document.querySelector<HTMLElement>("#settings-panel")!.hidden =
    !settingsOpen;
  document.querySelector<HTMLElement>(".queue-section")!.hidden =
    ehImporting || !state.items.length;
  document.querySelector<HTMLElement>(".companion")!.hidden = ehImporting;
  document.querySelector<HTMLElement>(".popup-footer")!.hidden = ehImporting;
  renderEhentaiImportPanel();
  if (addOpen) updatePreview();
  const reconcilePanel =
    document.querySelector<HTMLElement>("#reconcile-panel")!;
  reconcilePanel.hidden = !reconcileOpen || !canReconcile(active);
  html(reconcilePanel, reconcileHtml());
  const notifications =
      document.querySelector<HTMLInputElement>("#notifications")!,
    motion = document.querySelector<HTMLInputElement>("#reduced-motion")!,
    theme = document.querySelector<HTMLSelectElement>("#theme")!;
  notifications.checked = state.settings.notifications;
  motion.checked = state.settings.reducedMotion;
  theme.value = state.settings.theme;
  document.querySelector<HTMLSelectElement>("#language")!.value =
    state.settings.language;
  document.querySelector<HTMLTextAreaElement>("#share-intro")!.value =
    localizedIntroduction();
  document.querySelector<HTMLElement>("#extract-label")!.textContent =
    xc("label");
  document.querySelector<HTMLElement>("#batch-password-label")!.textContent =
    xc("passwordLabel");
  document.querySelector<HTMLElement>("#batch-password-hint")!.textContent =
    xc("passwordHint");
  document.querySelector<HTMLElement>("#batch-password-wrap")!.hidden =
    !document.querySelector<HTMLInputElement>("#extract-after-download")!
      .checked || hasGalleryPreview();
  document.querySelector<HTMLElement>("#gallery-extraction-hint")!.hidden =
    !hasGalleryPreview();
  renderExtractionSettings();
  for (const id of [
    "status-title",
    "status-subtitle",
    "run-label",
    "popup-summary",
  ]) {
    const element = document.getElementById(id)!;
    element.textContent = t(element.textContent || "");
  }
  if (popup)
    document
      .querySelector(".queue-section")!
      .setAttribute(
        "data-summary",
        `排隊 ${queue.length} · 完成 ${completed.length} · 待處理 ${attention.length}`,
      );
}
async function execute(command: Command) {
  if (pending) return false;
  pending = true;
  render();
  try {
    const result = await request(command);
    if (result.state) state = result.state;
    if (!result.ok || result.error)
      toast(
        result.error === "gallery_extraction_not_supported"
          ? gc("extractionNotSupported")
          : result.error === "gallery_reader_tab_required"
            ? t("請在 Chrome 開啟這本的作品清單，再試一次。")
          : isKnownExtractionError(result.error)
            ? extractionError(result.error)
            : result.error || "這次操作沒有完成，請再試一次。",
      );
    return result.ok && !result.error;
  } finally {
    pending = false;
    render();
  }
}
async function loadManualDownloads() {
  const item = state.items.find((i) => i.id === state.activeId);
  if (!canReconcile(item) || manualLoading) return;
  manualLoading = true;
  manualItemId = item!.id;
  render();
  try {
    const result = await findDownloads(item!.id);
    if (result.ok) manualChoices = result.downloads || [];
    else toast(result.error || "無法核對下載");
  } finally {
    manualLoading = false;
    render();
  }
}
async function confirmManualDownload(downloadId: number) {
  const item = state.items.find((i) => i.id === state.activeId);
  if (!canReconcile(item)) return;
  if (!(await execute({ kind: "adopt-download", id: item!.id, downloadId })))
    return;
  const linked = state.items.find((i) => i.id === item!.id);
  if (linked?.downloadId === downloadId) {
    reconcileOpen = false;
    manualChoices = undefined;
    toast(
      linked.status === "blocked"
        ? "已連結下載，但 Chrome 仍需要你檢查。"
        : "已連結 Chrome 下載，貓貓會接著追蹤。",
    );
    render();
  }
}
function retryableEhentaiItemsForUrls(urls: readonly string[], mode: "reader" | "archive") {
  if (popup || mode !== "reader") return [];
  const retryableSources = new Set(
    urls.flatMap((url) => {
      const source = parseGallerySource(url);
      return source?.site === "ehentai" ? [source.url] : [];
    }),
  );
  return state.items.filter((item) => {
    const source = parseGallerySource(item.sourceUrl);
    return (
      !!source &&
      retryableSources.has(source.url) &&
      canRetryEhentaiReaderInTab(item)
    );
  });
}
function matchingRetryableEhentaiItems(text: string) {
  if (popup || selectedAddMode() !== "reader") return [];
  const urls = previewUrls(text, [])
    .filter((result) => result.status !== "unsupported")
    .map((result) => result.normalized || result.url);
  return retryableEhentaiItemsForUrls(urls, "reader");
}
function existingUrlsForEhentaiMode(mode: "reader" | "archive", text = "") {
  const retryableIds = new Set(
    !popup && mode === "reader"
      ? matchingRetryableEhentaiItems(text).map((item) => item.id)
      : [],
  );
  return state.items
    .filter((item) => {
      if (retryableIds.has(item.id)) return false;
      if (parseGallerySource(item.sourceUrl)?.site !== "ehentai") return true;
      return !!item.ehArchive === (mode === "archive");
    })
    .map((item) => item.sourceUrl);
}
function selectedAddMode(): "reader" | "archive" {
  return document.querySelector<HTMLInputElement>('input[name="ehentai-add-mode-choice"]:checked')?.value === "archive" ? "archive" : "reader";
}
function updatePreview() {
  const text = document.querySelector<HTMLTextAreaElement>("#url-input")!.value;
  const mode = selectedAddMode();
  const results = previewUrls(
    text,
    existingUrlsForEhentaiMode(mode, text),
  );
  const retryableOldItems = retryableEhentaiItemsForUrls(
    results.filter((result) => result.status === "valid").map((result) => result.normalized || result.url),
    mode,
  );
  const counts = {
    valid: results.filter((r) => r.status === "valid").length,
    duplicate: results.filter((r) => r.status === "duplicate").length,
    unsupported: results.filter((r) => r.status === "unsupported").length,
  };
  const ehentaiBatch = results.some((r) => r.status !== "unsupported" && parseGallerySource(r.normalized || r.url)?.site === "ehentai");
  document.querySelector<HTMLElement>("#ehentai-add-mode")!.hidden = !ehentaiBatch;
  const galleryBatch = results.some(
    (r) => r.status === "valid" && !!parseGallerySource(r.normalized || r.url),
  );
  const extract = document.querySelector<HTMLInputElement>(
    "#extract-after-download",
  )!;
  if (galleryBatch && extract.checked) {
    extract.checked = false;
    document.querySelector<HTMLInputElement>("#batch-password")!.value = "";
  }
  document.querySelector<HTMLElement>("#gallery-extraction-hint")!.hidden =
    !galleryBatch;
  extract.disabled = galleryBatch;
  document.querySelector<HTMLElement>("#batch-password-wrap")!.hidden =
    !extract.checked || galleryBatch;
  const expanded =
    document.querySelector<HTMLDetailsElement>("#url-preview details")?.open ??
    counts.unsupported > 0;
  html(
    document.querySelector("#url-preview")!,
    results.length
      ? `<div class="preview-counts" role="status"><span>${counts.valid} 個可加入</span>${retryableOldItems.length ? `<span>${e(t(`可重新排隊的舊作品：${retryableOldItems.length} 本`))}</span>` : ""}${counts.duplicate ? `<span>${counts.duplicate} 個重複</span>` : ""}${counts.unsupported ? `<span>${counts.unsupported} 個不支援</span>` : ""}</div><details ${expanded ? "open" : ""}><summary id="preview-toggle">查看網址明細（${results.length}）</summary><ul>${results
          .slice(0, 30)
          .map(
            (r) =>
              `<li class="${r.status}"><span>${r.status === "valid" ? "可加入" : r.status === "duplicate" ? "重複" : "不支援"}</span><span data-raw title="${e(r.url)}">${e(r.url)}</span></li>`,
          )
          .join(
            "",
          )}</ul>${results.length > 30 ? "<p>僅顯示前 30 筆；有效網址會全部加入。</p>" : ""}</details>`
      : "",
  );
  const confirm = document.querySelector<HTMLButtonElement>("#confirm-add")!;
  confirm.disabled = pending || !counts.valid;
  confirm.textContent = pending
    ? "正在加入…"
    : counts.valid
      ? `加入 ${counts.valid} 個下載`
      : "確認加入";
  confirm.textContent = t(confirm.textContent || "");
}
async function readSourceTabs() {
  if (preview || sourceTabsLoading) return;
  const generation = ++sourceTabsGeneration;
  const api =
    typeof chrome === "undefined"
      ? undefined
      : {
          permissions: {
            request: (options: { permissions: string[] }) =>
              chrome.permissions.request(
                options as chrome.permissions.Permissions,
              ),
          },
          tabs: { query: (query: Record<string, never>) => chrome.tabs.query(query) },
        };
  // Start requestSupportedTabs now, while the original button gesture is active.
  const pendingResult = requestSupportedTabs(api);
  sourceTabsLoading = true;
  sourceTabsError = "";
  renderSourceTabs();
  let result: Awaited<ReturnType<typeof requestSupportedTabs>>;
  try {
    result = await pendingResult;
  } catch {
    result = { status: "unavailable" };
  }
  if (generation !== sourceTabsGeneration || !addOpen) return;
  sourceTabsLoading = false;
  sourceTabs = result.status === "ok" ? result.tabs : undefined;
  sourceTabsError =
    result.status === "denied"
      ? "未取得分頁權限。請按「從分頁加入」重試，並在 Chrome 對話框中允許。"
      : result.status === "unavailable"
        ? "目前無法讀取分頁。請更新 Chrome，或直接貼上支援來源網址。"
        : "";
  renderSourceTabs();
}
async function currentEhentaiTagTab(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || !tab.url) return undefined;
  const url = new URL(tab.url);
  return url.origin === "https://e-hentai.org" && url.pathname.startsWith("/tag/")
    ? tab.id
    : undefined;
}
async function showEhentaiImportAction() {
  const button = app.querySelector<HTMLButtonElement>('[data-action="import-ehentai"]');
  if (!button || preview) return;
  try {
    button.hidden = (await currentEhentaiTagTab()) === undefined;
  } catch {
    button.hidden = true;
  }
}
async function readEhentaiCurrentPage() {
  if (preview || ehImportLoading || !ehImportOpen) return;
  const generation = ++ehImportGeneration;
  ehImportLoading = true;
  ehImportError = "";
  ehImportItems = [];
  ehImportEntries = [];
  ehImportSelected.clear();
  renderEhentaiImportPanel();
  try {
    const tabId = await currentEhentaiTagTab();
    if (generation !== ehImportGeneration || !ehImportOpen) return;
    if (tabId === undefined) {
      ehImportError = "無法讀取目前分頁。請確認 E-Hentai 標籤清單仍開啟，再試一次。";
      return;
    }
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readVisibleEhentaiWorks,
    });
    if (generation !== ehImportGeneration || !ehImportOpen) return;
    const entries = Array.isArray(injection?.result)
      ? (injection.result as EhentaiPageEntry[])
      : [];
    ehImportEntries = entries;
    ehImportSelected.clear();
    refreshEhImportItems();
    ehImportError = "";
    if (!ehImportItems.length)
      ehImportError = "目前頁面找不到可見的新作品。請確認清單已載入，或檢查這些作品是否已在佇列中。";
  } catch {
    if (generation === ehImportGeneration && ehImportOpen)
      ehImportError = "讀取此頁失敗。請確認目前開啟 E-Hentai 標籤清單，再試一次。";
  } finally {
    if (generation === ehImportGeneration && ehImportOpen) {
      ehImportLoading = false;
      renderEhentaiImportPanel();
    }
  }
}
function openEhentaiImport() {
  clearEhImport();
  ehImportOpen = true;
  render();
  void readEhentaiCurrentPage();
}
async function confirmEhentaiImport() {
  if (ehImportAdding || !ehImportOpen) return;
  refreshEhImportItems();
  const chosen = ehImportItems.filter((item) => ehImportSelected.has(item.url));
  if (!chosen.length) {
    toast(t("請至少勾選一本作品。"));
    return;
  }
  const before = new Set(state.items.map((item) => item.id));
  const titles = Object.fromEntries(chosen.map((item) => [item.url, item.title]));
  ehImportAdding = true;
  renderEhentaiImportPanel();
  const ok = await execute({ kind: "add", urls: chosen.map((item) => item.url), titles, ehentaiMode: ehImportMode });
  ehImportAdding = false;
  if (!ok) {
    renderEhentaiImportPanel();
    return;
  }
  const added = state.items.filter((item) => !before.has(item.id)).length;
  if (!added) {
    ehImportSelected.clear();
    refreshEhImportItems();
    ehImportError = "沒有新增作品，請重新讀取此頁確認是否已在佇列中。";
    renderEhentaiImportPanel();
    return;
  }
  clearEhImport();
  render();
  toast(`已加入 ${added} 本作品。`, "success");
}
function hasGalleryPreview(): boolean {
  const text =
    document.querySelector<HTMLTextAreaElement>("#url-input")?.value || "";
  return previewUrls(
    text,
    existingUrlsForEhentaiMode(selectedAddMode(), text),
  ).some(
    (r) => r.status === "valid" && !!parseGallerySource(r.normalized || r.url),
  );
}
function openPanel(panel: "add" | "settings" | "reconcile") {
  if (panel !== "add") clearSourceTabs();
  if (panel === "add") {
    const readerMode = document.querySelector<HTMLInputElement>(
      'input[name="ehentai-add-mode-choice"][value="reader"]',
    );
    if (readerMode) readerMode.checked = true;
  }
  addOpen = panel === "add";
  settingsOpen = panel === "settings";
  reconcileOpen = panel === "reconcile";
  render();
  const target = document.querySelector<HTMLElement>(
    panel === "add"
      ? "#url-input"
      : panel === "settings"
        ? "#theme"
        : '[data-action="find-downloads"]',
  );
  target?.focus({ preventScroll: true });
  document
    .querySelector(`#${panel === "reconcile" ? "reconcile" : panel}-panel`)
    ?.scrollIntoView?.({ block: "nearest" });
}
async function copyIntroduction() {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-action="copy-intro"]',
  )!;
  button.disabled = true;
  try {
    await navigator.clipboard.writeText(localizedIntroduction());
    toast("介紹已複製。只有產品簡介，不含你的下載資料。", "success");
  } catch {
    const field = document.querySelector<HTMLTextAreaElement>("#share-intro")!;
    field.focus();
    field.select();
    toast("無法自動複製，已選取介紹文字，請手動複製。");
  } finally {
    button.disabled = false;
  }
}
async function moveItem(id: string, direction: -1 | 1) {
  if (pending) return;
  const queued = state.items.filter((item) => item.status === "queued");
  const before = queued.findIndex((item) => item.id === id);
  if (before < 0 || !queued[before + direction]) return;
  if (!(await execute({ kind: "move", id, direction }))) return;
  const next = state.items.filter((item) => item.status === "queued");
  const position = next.findIndex((item) => item.id === id);
  if (position < 0 || position === before) return;
  const control = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-select]"),
  ].find((button) => button.dataset.select === id);
  control?.focus({ preventScroll: true });
  control?.scrollIntoView?.({ block: "nearest" });
  toast(`已移到第 ${position + 1} 位，共 ${next.length} 個待下載。`, "success");
}
app.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLButtonElement>("button");
  if (!target) return;
  if (target.dataset.filter) {
    filter = target.dataset.filter;
    render();
    return;
  }
  if (target.dataset.select) {
    selected =
      selected === target.dataset.select ? undefined : target.dataset.select;
    render();
    return;
  }
  const action = target.dataset.action,
    id = target.dataset.item || state.activeId;
  if (action === "import-ehentai") {
    openEhentaiImport();
  } else if (action === "close-ehentai-import") {
    clearEhImport();
    render();
    document
      .querySelector<HTMLButtonElement>('[data-action="import-ehentai"]')
      ?.focus();
  } else if (action === "retry-ehentai-import") {
    void readEhentaiCurrentPage();
  } else if (action === "confirm-ehentai-import") {
    void confirmEhentaiImport();
  } else if (action === "share") {
    openPanel("settings");
    document
      .querySelector<HTMLElement>("#about-queuecat")
      ?.scrollIntoView?.({ block: "nearest" });
    document
      .querySelector<HTMLElement>("#share-intro")
      ?.focus({ preventScroll: true });
  } else if (action === "copy-intro") {
    void copyIntroduction();
  } else if (action === "add") {
    if (popup) void execute({ kind: "open-manager", section: "add" });
    else {
      openPanel("add");
    }
  } else if (action === "close-add") {
    addOpen = false;
    clearSourceTabs();
    render();
    document
      .querySelector<HTMLButtonElement>('#hero-actions [data-action="add"]')
      ?.focus();
  } else if (action === "settings") {
    if (popup) void execute({ kind: "open-manager", section: "settings" });
    else {
      if (settingsOpen) {
        settingsOpen = false;
        render();
      } else openPanel("settings");
      if (settingsOpen && !preview)
        void chrome.notifications
          .getPermissionLevel()
          .then(
            (level) =>
              (document.querySelector("#notification-permission")!.textContent =
                t(
                  level === "denied"
                    ? "通知已停用，請在 Chrome／Windows 設定中開啟。"
                    : "Chrome 通知已開啟；Windows 專注模式仍可能隱藏通知。",
                )),
          );
    }
  } else if (action === "close-settings") {
    settingsOpen = false;
    render();
    const controls = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-action="settings"]',
      ),
    ];
    (
      controls.find((button) => button.getClientRects().length > 0) ||
      controls[0]
    )?.focus();
  } else if (action === "close-detail") {
    const previous = selected;
    selected = undefined;
    render();
    [...document.querySelectorAll<HTMLButtonElement>("[data-select]")]
      .find((button) => button.dataset.select === previous)
      ?.focus();
  } else if (action === "read-source-tabs") {
    // Invoked directly from the click path so permissions.request retains the user gesture.
    void readSourceTabs();
  } else if (action === "insert-source-tabs") {
    const selectedIds = [
      ...document.querySelectorAll<HTMLInputElement>(
        '#source-tabs-panel input[name="source-tab"]:checked',
      ),
    ].map((input) => Number(input.value));
    if (!sourceTabs || !selectedIds.length) {
      toast(t("請先選擇至少一個分頁。"));
    } else {
      const input = document.querySelector<HTMLTextAreaElement>("#url-input")!;
      input.value = appendSelectedTabUrls(input.value, sourceTabs, selectedIds);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      clearSourceTabs();
      renderSourceTabs();
      input.focus({ preventScroll: true });
    }
  } else if (action === "close-source-tabs") {
    clearSourceTabs();
    renderSourceTabs();
  } else if (action === "manager") void execute({ kind: "open-manager" });
  else if (action === "downloads") void execute({ kind: "open-downloads" });
  else if (action === "confirm-external" && id)
    void execute({
      kind: "adopt-download",
      id,
      downloadId: Number(target.dataset.download),
    });
  else if (action === "check-helper") void execute({ kind: "check-helper" });
  else if (action === "forget-gallery" && id) {
    const item = state.items.find((entry) => entry.id === id);
    if (
      item?.gallery &&
      item.status === "blocked" &&
      item.downloadId === undefined &&
      item.action?.kind === "download" &&
      window.confirm(gc("forgetUncertainConfirm"))
    )
      void execute({ kind: "remove", id, confirmUncertain: true });
  } else if (action === "retry-extraction") {
    const groupId = target.dataset.group;
    const password = target
      .closest(".extraction-detail")
      ?.querySelector<HTMLInputElement>('input[type="password"]');
    if (groupId) {
      const expired =
        state.extractions?.find((g) => g.id === groupId)?.errorCode ===
        "password_expired";
      const supplied = password?.value || (expired ? "" : undefined);
      void execute({
        kind: "retry-extraction",
        id: groupId,
        ...(supplied !== undefined ? { password: supplied } : {}),
      }).then((ok) => {
        if (ok && password) password.value = "";
      });
    }
  } else if (action === "reconcile") {
    if (popup) void execute({ kind: "open-manager", section: "reconcile" });
    else {
      openPanel("reconcile");
    }
  } else if (action === "close-reconcile") {
    reconcileOpen = false;
    render();
    document
      .querySelector<HTMLButtonElement>('#current [data-action="reconcile"]')
      ?.focus();
  } else if (action === "find-downloads") void loadManualDownloads();
  else if (action === "adopt-download")
    void confirmManualDownload(Number(target.dataset.download));
  else if (action === "use-ehentai-tab" && id)
    void execute({ kind: "use-ehentai-tab", id });
  else if (action === "retry" && id) {
    const item = state.items.find((entry) => entry.id === id);
    void execute(
      item && canRetryEhentaiReaderInTab(item)
        ? { kind: "use-ehentai-tab", id }
        : { kind: "retry", id },
    );
  }
  else if (
    ["start", "pause", "clear-complete", "test-notification"].includes(
      action || "",
    )
  )
    void execute({ kind: action } as Command);
  else if (
    id &&
    ["remove", "focus", "recheck", "show-file"].includes(action || "")
  )
    void execute({ kind: action, id } as Command);
  else if (id && (action === "up" || action === "down"))
    void moveItem(id, action === "up" ? -1 : 1);
});

app.addEventListener("keydown", (event) => {
  if (event.isComposing || event.repeat) return;
  const target = event.target instanceof Element ? event.target : undefined;
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key === "Enter" &&
    target?.id === "url-input"
  ) {
    event.preventDefault();
    document.querySelector<HTMLButtonElement>("#confirm-add")?.click();
  } else if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    ["ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    const id = target?.closest<HTMLElement>(".queue-row")?.dataset.id;
    if (
      id &&
      state.items.some((item) => item.id === id && item.status === "queued")
    ) {
      event.preventDefault();
      void moveItem(id, event.key === "ArrowUp" ? -1 : 1);
    }
  } else if (event.key === "Escape") {
    const action = ehImportOpen
      ? "close-ehentai-import"
      : reconcileOpen
      ? "close-reconcile"
      : settingsOpen
        ? "close-settings"
        : addOpen
          ? "close-add"
          : selected
            ? "close-detail"
            : undefined;
    if (action) {
      event.preventDefault();
      document
        .querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
        ?.click();
    }
  }
});
document.querySelector("#url-input")!.addEventListener("input", updatePreview);
document.querySelector("#add-panel")!.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.matches('input[name="ehentai-add-mode-choice"]')) updatePreview();
});
document.querySelector("#source-tabs-panel")!.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement;
  if (!sourceTabs || !target.matches("input[type=checkbox]")) return;
  if (target.hasAttribute("data-source-select-all")) {
    document
      .querySelectorAll<HTMLInputElement>('#source-tabs-panel input[name="source-tab"]')
      .forEach((checkbox) => (checkbox.checked = target.checked));
    return;
  }
  const all = document.querySelectorAll<HTMLInputElement>(
    '#source-tabs-panel input[name="source-tab"]',
  );
  const selectedCount = [...all].filter((checkbox) => checkbox.checked).length;
  const selectAll = document.querySelector<HTMLInputElement>(
    "#source-tabs-panel [data-source-select-all]",
  );
  if (selectAll) selectAll.checked = selectedCount === all.length;
});
document.querySelector("#ehentai-import-panel")!.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.matches('input[name="ehentai-import-mode"]')) {
    ehImportMode = input.value === "archive" ? "archive" : "reader";
    refreshEhImportItems();
    ehImportError = ehImportItems.length || !ehImportEntries.length ? "" : "目前頁面找不到可見的新作品。請確認清單已載入，或檢查這些作品是否已在佇列中。";
    renderEhentaiImportPanel();
    document.querySelector<HTMLInputElement>('input[name="ehentai-import-mode"]:checked')?.focus();
    return;
  }
  if (!input.matches('input[name="ehentai-work"]')) return;
  const index = Number(input.value);
  if (!Number.isInteger(index) || index < 0 || index >= ehImportItems.length)
    return;
  const item = ehImportItems[index];
  if (input.checked) ehImportSelected.add(item.url);
  else ehImportSelected.delete(item.url);
  renderEhentaiImportPanel();
});
document
  .querySelector<HTMLInputElement>("#extract-after-download")!
  .addEventListener("change", (event) => {
    if ((event.target as HTMLInputElement).checked && hasGalleryPreview()) {
      (event.target as HTMLInputElement).checked = false;
      document.querySelector<HTMLInputElement>("#batch-password")!.value = "";
    }
    document.querySelector<HTMLElement>("#batch-password-wrap")!.hidden =
      !(event.target as HTMLInputElement).checked || hasGalleryPreview();
    document.querySelector<HTMLElement>("#gallery-extraction-hint")!.hidden =
      !hasGalleryPreview();
    (event.target as HTMLInputElement).disabled = hasGalleryPreview();
  });
document.querySelector("#confirm-add")!.addEventListener("click", async () => {
  const input = document.querySelector<HTMLTextAreaElement>("#url-input")!;
  const urls = previewUrls(
    input.value,
    existingUrlsForEhentaiMode(selectedAddMode(), input.value),
  )
    .filter((r) => r.status === "valid")
    .map((r) => r.normalized!);
  const ehentaiMode = selectedAddMode();
  const retryableOldItems = !popup && ehentaiMode === "reader"
    ? retryableEhentaiItemsForUrls(urls, ehentaiMode)
    : [];
  const retryableOldEventTimes = new Map(
    retryableOldItems.map((item) => [
      item.id,
      item.events
        .filter((event) => event.message === "已排入作品分頁重試")
        .slice(-1)[0]?.at,
    ]),
  );
  const before = state.items.length;
  const extractionEnabled = document.querySelector<HTMLInputElement>(
    "#extract-after-download",
  )!.checked;
  if (extractionEnabled && urls.some((url) => !!parseGallerySource(url))) {
    toast(gc("extractionNotSupported"));
    return;
  }
  const password =
    document.querySelector<HTMLInputElement>("#batch-password")!.value;
  const hasEhentai = urls.some((url) => parseGallerySource(url)?.site === "ehentai");
  const ok = await execute({
    kind: "add",
    urls,
    ...(hasEhentai ? { ehentaiMode } : {}),
    ...(hasEhentai && ehentaiMode === "reader" ? { ehentaiBrowserFallback: true } : {}),
    ...(extractionEnabled ? { extraction: { password } } : {}),
  });
  const added = state.items.length - before;
  const retried = ok
    ? state.items.filter(
        (item) => {
          const previousEventAt = retryableOldEventTimes.get(item.id);
          const latestEventAt = item.events
            .filter((event) => event.message === "已排入作品分頁重試")
            .slice(-1)[0]?.at;
          return (
            retryableOldEventTimes.has(item.id) &&
            latestEventAt !== undefined &&
            latestEventAt > (previousEventAt ?? -Infinity)
          );
        },
      ).length
    : 0;
  if (added > 0 || retried > 0) {
    input.value = "";
    document.querySelector<HTMLInputElement>("#batch-password")!.value = "";
    document.querySelector<HTMLInputElement>(
      "#extract-after-download",
    )!.checked = false;
    document.querySelector<HTMLElement>("#batch-password-wrap")!.hidden = true;
    addOpen = false;
    updatePreview();
    render();
    document
      .querySelector<HTMLButtonElement>('#hero-actions [data-action="start"]')
      ?.focus();
    if (added > 0 && retried > 0)
      toast(t(`已新增 ${added} 個下載，並重排 ${retried} 本舊作品。`), "success");
    else if (retried > 0)
      toast(t(`已重新排入 ${retried} 本舊作品。`), "success");
    else
      toast(
        state.running
          ? getLocale(messageLanguage()).toastAddedRunning(added)
          : getLocale(messageLanguage()).toastAddedPaused(added),
        "success",
      );
  }
});
document.querySelector("#notifications")!.addEventListener(
  "change",
  (event) =>
    void execute({
      kind: "settings",
      settings: { notifications: (event.target as HTMLInputElement).checked },
    }),
);
document.querySelector("#reduced-motion")!.addEventListener(
  "change",
  (event) =>
    void execute({
      kind: "settings",
      settings: { reducedMotion: (event.target as HTMLInputElement).checked },
    }),
);
document.querySelector("#language")!.addEventListener("change", (event) => {
  const language = (event.target as HTMLSelectElement).value;
  if (isLanguagePreference(language))
    void execute({ kind: "settings", settings: { language } });
});
window.addEventListener("languagechange", () => render());

document.querySelector("#theme")!.addEventListener(
  "change",
  (event) =>
    void execute({
      kind: "settings",
      settings: {
        theme: (event.target as HTMLSelectElement)
          .value as AppState["settings"]["theme"],
      },
    }),
);
document
  .querySelector("#scenario")
  ?.addEventListener("change", async (event) => {
    scenario((event.target as HTMLSelectElement).value);
    selected = undefined;
    const result = await request();
    state = result.state!;
    render();
  });
async function refresh() {
  if (document.hidden || pending) return;
  const result = await request();
  if (result.ok && result.state) {
    state = result.state;
    const firstLoad = !loaded;
    if (!loaded && !popup && !state.items.length && !location.hash)
      addOpen = true;
    loaded = true;
    render();
    if (firstLoad && !popup && addOpen)
      document
        .querySelector<HTMLTextAreaElement>("#url-input")
        ?.focus({ preventScroll: true });
  } else toast(result.error || "無法讀取佇列。");
}
if (!preview)
  chrome.storage.onChanged.addListener((changes, area) => {
    const next = changes[STORAGE_KEY]?.newValue as AppState | undefined;
    if (area === "local" && next?.version === 1 && Array.isArray(next.items)) {
      state = next;
      if (ehImportOpen && !ehImportLoading && ehImportEntries.length) {
        refreshEhImportItems();
        ehImportError = ehImportItems.length
          ? ""
          : "目前頁面找不到可見的新作品。請確認清單已載入，或檢查這些作品是否已在佇列中。";
      }
      render();
    }
  });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
const refreshTimer = setInterval(() => {
  document
    .querySelectorAll<HTMLTimeElement>("time[data-until]")
    .forEach((el) => (el.textContent = countdown(Number(el.dataset.until))));
  if (
    state.externalWaitReason ||
    state.items.some((i) => i.status === "downloading")
  )
    void refresh();
}, 1000);
window.addEventListener("pagehide", () => clearInterval(refreshTimer), {
  once: true,
});
window.addEventListener("hashchange", () => {
  addOpen = location.hash === "#add";
  settingsOpen = location.hash === "#settings";
  reconcileOpen = location.hash === "#reconcile";
  if (!addOpen) clearSourceTabs();
  render();
});
narrow.addEventListener("change", render);
void showEhentaiImportAction();
void refresh();
render();
