import "./style.css";
import type {
  AppState,
  Command,
  DownloadCandidate,
  QueueItem,
} from "../shared/types";
import { STORAGE_KEY, initialState } from "../shared/types";
import { hitomiGalleryId, previewUrls } from "../shared/urls";
import { findDownloads, request, preview, scenario } from "./client";
import {
  bytes,
  briefReason,
  countdown,
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
const localizedIntroduction = () => gc("introduction");

const popup = document.body.classList.contains("popup");
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
app.innerHTML = `${preview ? `<div class="preview-bar">離線介面預覽 · 不會開始下載 <label>情境 <select id="scenario"><option value="empty">空佇列</option><option value="downloading">下載中</option><option value="waiting">網站等待</option><option value="verification">需要驗證</option><option value="blocked">交接不明</option><option value="unknown-size">大小未知</option><option value="long-name">長檔名</option><option value="complete">全部完成</option></select></label></div>` : ""}
<div class="app-shell">
<aside class="sidebar"><a class="brand" href="manager.html">${icon("cat")}<span>QueueCat<span class="brand-dot">.</span></span></a><p class="brand-note">等待有人顧，時間留給你。</p><nav aria-label="主要導覽"><button data-filter="queue" class="nav-button selected">${icon("list")}下載佇列 <span id="nav-count"></span></button><button data-filter="attention" class="nav-button">${icon("alert")}待處理 <span id="attention-count"></span></button><button data-filter="complete" class="nav-button">${icon("check")}已完成 <span id="complete-count"></span></button></nav><div class="sidebar-bottom">${btn("folder", "Chrome 下載紀錄", "downloads")}${btn("settings", "偏好設定", "settings")}<div class="local-note"><span class="small-dot"></span>網址與紀錄，只留在這台電腦</div></div></aside>
<main class="main"><header class="topbar"><div class="popup-brand brand">${icon("cat")}QueueCat<span class="brand-dot">.</span></div><div class="breadcrumb">我的下載空間 <span>/</span> <span id="provider-breadcrumb" data-raw>Katfile</span></div><div class="top-actions">${popup ? `<span class="host-chip" id="provider-chip" data-raw>Katfile</span>` + btn("settings", "設定", "settings", "icon-button") : `<span class="host-chip" id="provider-chip" data-raw>Katfile</span>` + btn("settings", "設定", "settings", "icon-button top-settings")}</div></header>
<div id="status-announcement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
<section class="companion" aria-labelledby="status-title"><div class="companion-text"><div class="status-indicator"><span class="small-dot"></span><span id="run-label">正在休息</span></div><h1 id="status-title">把等待，交給貓貓。</h1><p id="status-subtitle">${e(gc("addHint"))}</p><div class="companion-actions" id="hero-actions"></div></div><img id="mascot" class="mascot" src="/assets/cat-sleep-v3.png" width="220" height="220" alt="熟睡的貓娘小管家"></section>
<ul id="first-promise" class="first-promise" aria-label="QueueCat 幫你做的事" hidden><li><strong>整串貼上</strong><span>多個網址，依序處理</span></li><li><strong>放心去忙</strong><span>網站倒數交給貓貓</span></li><li><strong>需要你再回來</strong><span>驗證或狀態不明時接手</span></li></ul><section id="current" class="current" aria-label="目前下載"></section>
<section id="reconcile-panel" class="inline-panel" hidden></section><section id="add-panel" class="inline-panel" hidden><div class="panel-heading"><h2>新增下載</h2><button data-action="close-add" class="icon-button" aria-label="收起新增網址">${icon("close")}</button></div><p>${e(gc("addHint"))}</p><label for="url-input" class="sr-only">${e(gc("linkLabel"))}</label><textarea id="url-input" aria-label="${e(gc("linkLabel"))}" aria-keyshortcuts="Control+Enter Meta+Enter" rows="5" placeholder="${e(gc("addPlaceholder"))}" spellcheck="false"></textarea><div class="extraction-options"><label class="extraction-toggle"><input id="extract-after-download" type="checkbox"><span id="extract-label"></span></label><span id="gallery-extraction-hint" hidden>${e(gc("extractionNotSupported"))}</span><label id="batch-password-wrap" class="batch-password" for="batch-password" hidden><span id="batch-password-label"></span><input id="batch-password" type="password" autocomplete="new-password" aria-describedby="batch-password-hint"><small id="batch-password-hint"></small></label></div><div id="url-preview" class="url-preview"></div><div class="panel-footer"><span>只加入清單，不會立刻開始下載。<small class="shortcut-hint"><kbd>Ctrl / ⌘</kbd> + <kbd>Enter</kbd> 快速加入</small></span><button id="confirm-add" class="primary" disabled>${icon("plus")}確認加入</button></div></section>
<section id="settings-panel" class="inline-panel" hidden><div class="panel-heading"><h2>偏好設定</h2><button data-action="close-settings" class="icon-button" aria-label="收起設定">${icon("close")}</button></div><label class="setting-row"><span>${icon("bell")}桌面通知<small>需要驗證、需要你處理，或整輪完成時通知。</small></span><input id="notifications" type="checkbox" role="switch"></label><div class="setting-row"><span>確認通知能找到你<small id="notification-permission">Windows 專注模式也可能隱藏通知。</small></span><button data-action="test-notification">發送測試通知</button></div><label class="setting-row"><span>語言<small>預設跟隨瀏覽器；未支援的語言使用英文。</small></span><select id="language"><option value="system">跟隨瀏覽器</option><option value="en">English</option><option value="zh-TW">繁體中文</option><option value="ja">日本語</option></select></label><label class="setting-row"><span>${icon("moon")}介面主題</span><select id="theme"><option value="system">跟隨系統</option><option value="light">淺色</option><option value="dark">深色</option></select></label><label class="setting-row"><span>減少動態效果<small>貓娘一直都是靜態圖片；此設定減少介面過場。</small></span><input id="reduced-motion" type="checkbox" role="switch"></label><section id="helper-settings" class="helper-settings" aria-labelledby="helper-title"><h3 id="helper-title"></h3><p id="helper-description"></p><p id="helper-status" role="status"></p><p class="extension-id-row"><span id="extension-id-label"></span><code id="extension-id" data-raw></code></p><p id="helper-setup-instruction"></p><button data-action="check-helper"></button></section><p class="settings-help">檔案儲存位置與是否詢問另存新檔，沿用 Chrome 設定。暫停、續傳及取消目前檔案，請到 Chrome 下載紀錄操作。</p><details class="shortcut-help"><summary>更順手的小技巧</summary><dl><dt><kbd>Ctrl / ⌘</kbd> + <kbd>Enter</kbd></dt><dd>貼好網址後，直接加入，不會自動開始下載。</dd><dt><kbd>Alt</kbd> + <kbd>↑ / ↓</kbd></dt><dd>在待下載那一列調整順序；方向按鈕也一樣好用。</dd><dt><kbd>Esc</kbd></dt><dd>收起目前面板或檔案詳情，不會暫停或取消下載。</dd></dl></details><section id="about-queuecat" class="about-queuecat" aria-labelledby="about-title"><h3 id="about-title">等下載，也可以很療癒。</h3><p>${e(gc("introduction"))}</p><label for="share-intro">介紹給朋友</label><textarea id="share-intro" rows="6" readonly spellcheck="false">${e(gc("introduction"))}</textarea><div class="share-actions">${btn("link", "複製介紹", "copy-intro", "secondary")}<span>只有產品簡介，不含你的下載資料。</span></div></section></section>
<section class="queue-section"><div class="section-heading"><h2 id="list-title">下載佇列 <span id="list-count"></span></h2><div class="list-actions">${btn("trash", "清除完成紀錄", "clear-complete", "quiet")}${btn("plus", "新增網址", "add", "secondary")}</div></div><div class="mobile-tabs" role="group" aria-label="佇列分類"><button data-filter="queue">佇列</button><button data-filter="attention">待處理</button><button data-filter="complete">已完成</button></div><div class="queue-layout"><div id="queue-list"></div><aside id="details" class="details" aria-label="檔案詳情"></aside></div></section>
<footer class="page-footer"><span>貓貓管排隊，Chrome 管下載。</span>${btn("link", "介紹給朋友", "share", "quiet")}<span>QueueCat 0.1.0</span></footer><div class="popup-footer"><div id="popup-summary" class="popup-summary"></div>${btn("plus", "新增網址", "add")}${btn("arrow", "完整管理頁", "manager")}</div></main></div><div id="toast" class="toast" role="status" aria-live="polite" hidden></div>`;
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
  item.status === "blocked" &&
  item.downloadId === undefined &&
  item.action?.kind !== "download";
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
  return `<div class="panel-heading"><h2>核對已開始的下載</h2><button data-action="close-reconcile" class="icon-button" aria-label="收起核對下載">${icon("close")}</button></div><p>目前檔案：<strong data-raw>${e(item!.title || item!.sourceUrl)}</strong></p><p>如果你已按過 Katfile 的「繼續免費下載」，請先核對 Chrome 裡的檔案、時間與容量，再確認這是同一筆。確認後只接續追蹤，不會重新下載。</p><button data-action="find-downloads" ${manualLoading ? "disabled" : ""}>${manualLoading ? "正在讀取…" : "讀取可核對的下載"}</button>${choices ? (choices.length ? `<ul class="download-choices">${choices.map((d) => `<li><strong data-raw>${e(d.filename)}</strong><span data-raw>${e(d.host)} · ${e(new Date(d.startTime).toLocaleString(messageLanguage()))}</span><span>${t(d.state === "complete" ? "已完成" : "下載中")} · ${bytes(d.bytesReceived)}${d.totalBytes > 0 ? " / " + bytes(d.totalBytes) : " · " + t("大小未知")}</span><button class="secondary" data-action="adopt-download" data-download="${d.id}">確認這筆，接續追蹤</button></li>`).join("")}</ul>` : '<p role="status">找不到符合檔名、時間與 Katfile 網域的下載。請先到 Chrome 核對，不要重新按下載。</p>') : ""}`;
}
function currentHtml(item?: QueueItem) {
  if (!item)
    return `<div class="no-current">${icon("list")}<span>目前沒有進行中的下載</span><span class="serial-note">一次一筆，依序下載</span></div>`;
  const next = state.items.find(
    (i) => i.status === "queued" && i.id !== item.id,
  );
  const group = extractionFor(item.id);
  const displayTitle = item.gallery?.title || item.title || item.sourceUrl;
  const transfer =
    item.status === "downloading"
      ? `${bytes(item.bytesReceived || 0)}${item.totalBytes && item.totalBytes > 0 ? " / " + bytes(item.totalBytes) : " · " + t("大小未知")}`
      : e(
          item.gallery
            ? galleryMessage(item) || gc("album")
            : briefReason(item),
        );
  return `<div class="current-heading"><span class="current-label">目前${item.gallery ? e(gc("album")) : "檔案"}</span><span class="status-tag ${item.status}">${labels[item.status]}</span></div><div class="current-file">${icon("folder")}<strong data-raw title="${e(displayTitle)}">${e(displayTitle)}</strong></div>${meter(item)}${group ? `<div class="extraction-status ${group.status}">${e(extractionStatus(group))}${group.status === "failed" ? ` · ${e(extractionError(group.errorCode))}` : ""}</div>` : ""}${canReconcile(item) ? `<button data-action="reconcile" class="text-button">核對已開始的下載</button>` : ""}<div class="transfer-meta"><span>${item.gallery && item.status === "downloading" ? `${e(galleryPageProgress(item))} · ${transfer}` : transfer}</span><span>${item.status === "downloading" && item.speed !== undefined ? bytes(item.speed) + "/s" : ""}</span></div>${item.status === "downloading" ? '<button data-action="downloads" class="text-button">到 Chrome 管理這筆下載</button>' : item.gallery && item.status === "blocked" && (item.downloadId !== undefined || item.action?.kind === "download") ? `<button data-action="downloads" class="text-button">${e(t("核對下載狀態"))}</button>` : ""}${!item.gallery && next ? `<div class="next-file">下一筆 <span data-raw>${e(next.title || next.sourceUrl)}</span></div>` : ""}`;
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
  const retryable =
    item.status === "failed" ||
    (!item.gallery &&
      item.status === "blocked" &&
      item.action?.kind !== "download" &&
      item.downloadId === undefined);
  const group = extractionFor(item.id);
  const displayTitle = item.gallery?.title || item.title || item.sourceUrl;
  const secondary = item.gallery
    ? `${galleryPageProgress(item)}${galleryPercent(item) === undefined ? "" : ` · ${galleryPercent(item)!.toFixed(1)}%`}${item.status === "downloading" ? ` · ${bytes(item.bytesReceived || 0)}${item.totalBytes && item.totalBytes > 0 ? " / " + bytes(item.totalBytes) : " · " + t("大小未知")}` : ` · ${galleryMessage(item) || gc("album")}`}`
    : item.status === "downloading"
      ? bytes(item.bytesReceived || 0) +
        (item.totalBytes && item.totalBytes > 0
          ? " / " + bytes(item.totalBytes)
          : " · " + t("大小未知"))
      : e(
          item.status === "waiting"
            ? briefReason(item)
            : item.reason || "katfile.biz",
        );
  return `<article class="queue-row ${selected === item.id ? "is-selected" : ""}" data-id="${item.id}"><button class="file-select" data-select="${item.id}" aria-expanded="${selected === item.id}"><span class="row-number">${item.status === "complete" ? icon("check") : String(n + 1).padStart(2, "0")}</span><span class="file-icon">${icon("folder")}</span><span class="file-info"><strong data-raw title="${e(displayTitle)}">${e(displayTitle)}</strong><small>${e(secondary)}${group ? ` · ${e(extractionStatus(group))}` : ""}</small></span><span class="status-tag ${item.status}">${labels[item.status]}</span></button><div class="row-actions">${item.status === "queued" ? `<button data-item="${item.id}" data-action="up" aria-label="往前移" title="往前移（Alt + ↑）" aria-keyshortcuts="Alt+ArrowUp" ${item.id === firstQueued ? "disabled" : ""}>${icon("up")}</button><button data-item="${item.id}" data-action="down" aria-label="往後移" title="往後移（Alt + ↓）" aria-keyshortcuts="Alt+ArrowDown" ${item.id === lastQueued ? "disabled" : ""}>${icon("down")}</button>` : ""}${retryable ? `<button data-item="${item.id}" data-action="retry" aria-label="重新排隊">${icon("retry")}</button>` : ""}${item.status === "complete" ? `<button data-item="${item.id}" data-action="show-file" aria-label="在資料夾顯示">${icon("folder")}</button>` : ""}${!active || removableGalleryBlock ? `<button data-item="${item.id}" data-action="remove" aria-label="${e(group && group.status !== "complete" ? xc("removeCancelsExtraction") : t("移除紀錄"))}" title="${e(group && group.status !== "complete" ? xc("removeCancelsExtraction") : t("移除紀錄"))}">${icon("trash")}</button>` : ""}</div></article>`;
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
  const galleryId = item.gallery ? hitomiGalleryId(item.sourceUrl) : undefined;
  const sourceHref = galleryId
    ? `https://hitomi.la/galleries/${galleryId}.html`
    : item.sourceUrl;
  const outputName =
    item.gallery?.output === "zip"
      ? item.gallery.archive?.filename
      : item.gallery?.folder;
  const galleryDetails = item.gallery
    ? `<section class="gallery-detail"><p><strong>${e(galleryPageProgress(item))}</strong>${galleryPercent(item) === undefined ? "" : ` · ${galleryPercent(item)!.toFixed(1)}%`}</p>${outputName ? `<p>${e(gc(item.gallery.output === "zip" ? "folder" : "album"))}：<span data-raw title="${e(outputName)}">${e(outputName)}</span></p>` : ""}<p>${e(gc(item.gallery.output === "zip" ? "imageFormat" : "legacyFormat"))}</p>${item.gallery.output === "zip" ? `<p>${e(gc("retryTip"))}</p>` : ""}</section>`
    : "";
  return `<div class="detail-heading"><h3>檔案詳情</h3><button data-action="close-detail" class="icon-button" aria-label="收起詳情">${icon("close")}</button></div><strong class="detail-filename" data-raw>${e(displayTitle)}</strong><span class="status-tag ${item.status}">${labels[item.status]}</span><h4>${item.gallery ? e(gc("gallerySource")) : "來源網址"}</h4>${item.gallery ? `<a class="text-button" href="${e(sourceHref)}" target="_blank" rel="noopener noreferrer">${icon("arrow")}${e(gc("gallerySource"))}</a><span data-raw title="${e(item.sourceUrl)}">${e(item.sourceUrl)}</span>` : `<a data-raw href="${e(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(item.sourceUrl)}</a>`}${item.reason ? `<p class="reason" ${item.gallery ? "data-raw" : ""}>${e(item.gallery ? galleryMessage(item) : item.reason)}</p>` : ""}${galleryDetails}${group ? `<section class="extraction-detail"><h4>${e(xc("enable"))}</h4><p class="extraction-status ${group.status}">${e(extractionStatus(group))}</p>${group.status === "failed" ? `<p class="reason">${e(extractionError(group.errorCode))}${group.errorCode && !(group.errorCode in extractionErrorKeys) ? ` <code data-raw>${e(group.errorCode)}</code>` : ""}</p><label class="retry-password" for="retry-extraction-password">${e(xc(group.errorCode === "password_expired" ? "passwordLabel" : "retryPassword"))}<input id="retry-extraction-password" type="password" autocomplete="new-password" aria-describedby="retry-password-hint" data-group="${e(group.id)}"><small id="retry-password-hint">${e(xc(group.errorCode === "password_expired" ? "expiredPasswordHint" : "retryPasswordHint"))}</small></label><button class="secondary" data-action="retry-extraction" data-group="${e(group.id)}">${e(xc("retry"))}</button>` : ""}${group.outputDir ? `<p class="extraction-output"><span>${e(xc("output"))}:</span> <span data-raw title="${e(group.outputDir)}">${e(group.outputDir)}</span></p>` : ""}</section>` : ""}${!item.gallery && ["verification", "blocked", "waiting", "preparing"].includes(item.status) ? `<div class="detail-actions"><button data-action="focus" data-item="${item.id}">${icon("arrow")}前往工作分頁</button>${item.status === "blocked" ? `<button data-action="recheck" data-item="${item.id}">${icon("retry")}重新檢查</button>` : ""}</div>` : item.gallery && item.status === "blocked" && item.action?.kind === "download" && item.downloadId === undefined ? `<div class="detail-actions"><button data-action="downloads" data-item="${item.id}">${icon("arrow")}${e(t("核對下載狀態"))}</button></div>` : ""}<h4>處理紀錄</h4><ol class="event-list">${
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
  document.body.dataset.panel = addOpen
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
  const primaryAction =
    !active && !state.items.some((item) => item.status === "queued")
      ? btn("plus", "新增下載網址", "add", "primary")
      : needsDownloadCheck
        ? `<button class="primary" data-action="${attentionAction}" data-item="${active!.id}">${icon("arrow")}核對下載狀態</button>`
        : active?.gallery && active.status === "blocked"
          ? ""
          : active && ["verification", "blocked"].includes(active.status)
            ? `<button class="primary" data-action="focus" data-item="${active.id}">${icon("arrow")}${active.status === "verification" ? "前往驗證" : "前往工作分頁"}</button>`
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
  html(
    hero,
    `${primaryAction}${active && ["verification", "blocked"].includes(active.status) ? btn(state.running ? "pause" : "play", state.running ? "暫停排隊" : "繼續排隊", state.running ? "pause" : "start") : ""}${forgetAction}${!popup && state.items.length ? btn("plus", "新增網址", "add", "quiet") : ""}`,
  );
  hero.setAttribute("aria-busy", String(pending));
  hero.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.disabled =
      pending ||
      (!state.items.some(
        (i) => i.status === "queued" || i.id === state.activeId,
      ) &&
        b.dataset.action === "start");
  });
  document.querySelector<HTMLElement>("#current")!.dataset.status =
    active?.status || "empty";
  document.querySelector<HTMLElement>("#current")!.hidden = !active;
  html(document.querySelector("#current")!, currentHtml(active));
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
  document.querySelector<HTMLElement>("#settings-panel")!.hidden =
    !settingsOpen;
  document.querySelector<HTMLElement>(".queue-section")!.hidden =
    !state.items.length;
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
function updatePreview() {
  const text = document.querySelector<HTMLTextAreaElement>("#url-input")!.value;
  const results = previewUrls(
    text,
    state.items.map((i) => i.sourceUrl),
  );
  const counts = {
    valid: results.filter((r) => r.status === "valid").length,
    duplicate: results.filter((r) => r.status === "duplicate").length,
    unsupported: results.filter((r) => r.status === "unsupported").length,
  };
  const galleryBatch = results.some(
    (r) => r.status === "valid" && !!hitomiGalleryId(r.normalized || r.url),
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
      ? `<div class="preview-counts" role="status"><span>${counts.valid} 個可加入</span>${counts.duplicate ? `<span>${counts.duplicate} 個重複</span>` : ""}${counts.unsupported ? `<span>${counts.unsupported} 個不支援</span>` : ""}</div><details ${expanded ? "open" : ""}><summary id="preview-toggle">查看網址明細（${results.length}）</summary><ul>${results
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
function hasGalleryPreview(): boolean {
  const text =
    document.querySelector<HTMLTextAreaElement>("#url-input")?.value || "";
  return previewUrls(
    text,
    state.items.map((i) => i.sourceUrl),
  ).some(
    (r) => r.status === "valid" && !!hitomiGalleryId(r.normalized || r.url),
  );
}
function openPanel(panel: "add" | "settings" | "reconcile") {
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
  if (action === "share") {
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
  } else if (action === "manager") void execute({ kind: "open-manager" });
  else if (action === "downloads") void execute({ kind: "open-downloads" });
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
  else if (
    ["start", "pause", "clear-complete", "test-notification"].includes(
      action || "",
    )
  )
    void execute({ kind: action } as Command);
  else if (
    id &&
    ["remove", "retry", "focus", "recheck", "show-file"].includes(action || "")
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
    const action = reconcileOpen
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
    state.items.map((i) => i.sourceUrl),
  )
    .filter((r) => r.status === "valid")
    .map((r) => r.normalized!);
  const before = state.items.length;
  const extractionEnabled = document.querySelector<HTMLInputElement>(
    "#extract-after-download",
  )!.checked;
  if (extractionEnabled && urls.some((url) => !!hitomiGalleryId(url))) {
    toast(gc("extractionNotSupported"));
    return;
  }
  const password =
    document.querySelector<HTMLInputElement>("#batch-password")!.value;
  await execute({
    kind: "add",
    urls,
    ...(extractionEnabled ? { extraction: { password } } : {}),
  });
  const added = state.items.length - before;
  if (added > 0) {
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
  if (state.items.some((i) => i.status === "downloading")) void refresh();
}, 1000);
window.addEventListener("pagehide", () => clearInterval(refreshTimer), {
  once: true,
});
window.addEventListener("hashchange", () => {
  addOpen = location.hash === "#add";
  settingsOpen = location.hash === "#settings";
  reconcileOpen = location.hash === "#reconcile";
  render();
});
narrow.addEventListener("change", render);
void refresh();
render();
