import type { PageObservation } from "../shared/types";
import { isKatfileHost } from "../shared/urls";

const FILE_ID = /^[a-z0-9]{12}$/i;
const DOWNLOAD_EXT =
  /\.(?:(?:rar|zip|7z|tar|gz|bz2|xz|iso|mp4|mkv|mp3|pdf|exe|apk)|(?:7z|zip)\.\d{3}|r\d{2})$/i;
const PREMIUM_OR_LOGIN =
  /(?:premium|payment|login|sign.?in|registration|signup)/i;

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

type VisibilityCache = WeakMap<Element, boolean>;

function isVisible(element: Element, cache: VisibilityCache): boolean {
  let current: Element | null = element;
  const checked: Element[] = [];
  const view = element.ownerDocument.defaultView;
  let visible = true;
  while (current) {
    const cached = cache.get(current);
    if (cached !== undefined) {
      visible = cached;
      break;
    }
    checked.push(current);
    if (
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-hidden") === "true" ||
      (current.localName === "details" &&
        !current.hasAttribute("open") &&
        current !== element &&
        !Array.from(current.children)
          .find((child) => child.localName === "summary")
          ?.contains(element))
    ) {
      visible = false;
      break;
    }
    const style = view?.getComputedStyle(current);
    if (
      style &&
      (style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.opacity === "0" ||
        style.contentVisibility === "hidden")
    ) {
      visible = false;
      break;
    }
    current = current.parentElement;
  }
  for (const checkedElement of checked) {
    // 關閉的 details 容器對 summary 與其他子樹有不同可見性，不能共用快取結果。
    if (
      checkedElement.localName === "details" &&
      !checkedElement.hasAttribute("open")
    )
      continue;
    cache.set(checkedElement, visible);
  }
  return visible;
}

function visibleText(document: Document, visibility: VisibilityCache): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === node.TEXT_NODE) {
      const parent = node.parentElement;
      if (
        parent &&
        isVisible(parent, visibility) &&
        !parent.closest("script,style,noscript,template")
      ) {
        const text = normalizedText(node.textContent ?? "");
        if (text) parts.push(text);
      }
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  if (document.body) visit(document.body);
  return normalizedText(parts.join(" "));
}

function isKatfileFileUrl(pageUrl: URL): boolean {
  if (pageUrl.protocol !== "https:" || !isKatfileHost(pageUrl.hostname))
    return false;
  const fileId = pageUrl.pathname.split("/").filter(Boolean)[0] ?? "";
  return FILE_ID.test(fileId);
}

function hasMatchingDownloadForm(pageUrl: URL, document: Document): boolean {
  const fileId = pageUrl.pathname.split("/").filter(Boolean)[0] ?? "";
  return Array.from(document.forms).some((form) => {
    const op = form
      .querySelector<HTMLInputElement>('input[name="op"]')
      ?.value.toLowerCase();
    const id = form.querySelector<HTMLInputElement>('input[name="id"]')?.value;
    return (
      ["download1", "download2"].includes(op ?? "") &&
      id?.toLowerCase() === fileId.toLowerCase()
    );
  });
}

function cleanPageTitle(raw: string): string | undefined {
  const cleaned = normalizedText(raw)
    .replace(/^(?:download|下載)\s*/i, "")
    .replace(/\s*[-|–]\s*katfile\b.*$/i, "")
    .replace(
      /\s*[（(]\s*\d+(?:\.\d+)?\s*(?:bytes?|[kmgtpe]i?b)\s*[）)]\s*$/i,
      "",
    )
    .trim();
  return cleaned && !/^katfile(?:\b|$)/i.test(cleaned) ? cleaned : undefined;
}

function fileTitle(
  document: Document,
  pageUrl: URL,
  visibility: VisibilityCache,
): string | undefined {
  const fileId = pageUrl.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  const form = Array.from(document.forms).find((candidate) => {
    const op = candidate
      .querySelector<HTMLInputElement>('input[name="op"]')
      ?.value.toLowerCase();
    const id = candidate
      .querySelector<HTMLInputElement>('input[name="id"]')
      ?.value.toLowerCase();
    return ["download1", "download2"].includes(op ?? "") && id === fileId;
  });
  const fname = form
    ?.querySelector<HTMLInputElement>('input[name="fname"]')
    ?.value.trim();
  if (fname) return fname;
  const heading = document.querySelector("#btn_download h1");
  if (heading && isVisible(heading, visibility)) {
    const text = normalizedText(heading.textContent ?? "");
    if (text) return text;
  }
  return cleanPageTitle(document.title);
}

function hasCaptchaToken(document: Document): boolean {
  return Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name="g-recaptcha-response"], textarea[name="g-recaptcha-response"]',
    ),
  ).some((token) => token.value.trim().length > 0);
}

function hasVisibleVerification(
  document: Document,
  text: string,
  visibility: VisibilityCache,
): boolean {
  const visibleChallenge = Array.from(
    document.querySelectorAll(
      'iframe[src*="captcha" i], iframe[src*="challenges.cloudflare.com" i], .cf-turnstile, [data-sitekey], .g-recaptcha, #captcha, input[name*="captcha" i]',
    ),
  ).some((element) => isVisible(element, visibility));
  return (
    visibleChallenge ||
    /(?:verify that you are human|confirm you are human|complete (?:the )?(?:captcha|challenge)|captcha verification|security verification|人機驗證|完成驗證|請先驗證)/i.test(
      text,
    )
  );
}

function secondsFromText(text: string): number | undefined {
  const unitPattern =
    /(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|min|m|seconds?|secs?|sec|s|天|小時|分钟|分鐘|分|秒)/gi;
  let total = 0;
  let found = false;
  for (const match of text.matchAll(unitPattern)) {
    found = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier =
      /^(?:d|day)/.test(unit) || unit === "天"
        ? 86400
        : /^(?:h|hr|hour)/.test(unit) || unit === "小時"
          ? 3600
          : /^(?:m|min|minute)/.test(unit) ||
              ["分", "分钟", "分鐘"].includes(unit)
            ? 60
            : 1;
    total += amount * multiplier;
  }
  return found ? Math.min(total, 365 * 86400) : undefined;
}

function secondsFromClock(text: string): number | undefined {
  const match = text.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

function getWait(
  document: Document,
  visibility: VisibilityCache,
): { seconds?: number; evidence: string } | null {
  const candidates = Array.from(
    document.querySelectorAll(
      '#delay-box, #m-delay-box, .kfa, .k-alert, .alert, [id*="wait" i], [class*="wait" i]',
    ),
  )
    .filter((element) => isVisible(element, visibility))
    .map((element) => normalizedText(element.textContent ?? ""))
    .filter(Boolean);
  const text = candidates.join(" ");
  const explicitWait =
    /(?:you have to wait|please wait|free (?:download|slow download) (?:will start|available)|wait time|till next download|until (?:the )?next download|download available in|wait for|請等待|還需等待|尚需等待|下次下載|下載之間.{0,20}等待|等待時間.{0,20}(?:不少於|不低於)|請稍後再試)/i.test(
      text,
    );
  if (!explicitWait) return null;
  const timer = Array.from(
    document.querySelectorAll<HTMLElement>("#kfaTimer"),
  ).find((element) => isVisible(element, visibility));
  const timerText = timer ? normalizedText(timer.textContent ?? "") : "";
  const timerSeconds = timerText ? secondsFromClock(timerText) : undefined;
  // 「不得少於 120 分鐘」是政策說明，不代表目前還要等滿 120 分鐘；缺少倒數值時不猜剩餘時間。
  const policyOnly =
    /(?:must be (?:at least|not less than)|不少於|不低於)/i.test(text);
  const seconds =
    timerSeconds ?? (policyOnly ? undefined : secondsFromText(text));
  return {
    seconds,
    evidence: normalizedText(`${text} ${timerText}`).slice(0, 180),
  };
}

function safeKatfileUrl(raw: string, pageUrl: URL): string | null {
  try {
    const url = new URL(raw, pageUrl);
    if (
      url.protocol !== "https:" ||
      !isKatfileHost(url.hostname) ||
      url.username ||
      url.password
    )
      return null;
    if (PREMIUM_OR_LOGIN.test(`${url.pathname} ${url.search}`)) return null;
    if (url.pathname === pageUrl.pathname && url.search === pageUrl.search)
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function findFinalUrl(
  document: Document,
  pageUrl: URL,
  visibility: VisibilityCache,
): { url: string | null; ambiguous: boolean } {
  const candidates = new Set<string>();
  for (const anchor of Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  )) {
    if (!isVisible(anchor, visibility)) continue;
    const label = normalizedText(anchor.textContent ?? "");
    if (
      !/download|下載/i.test(label) ||
      /premium|high speed|instant|upgrade|登入|升級/i.test(label)
    )
      continue;
    const safe = safeKatfileUrl(anchor.href, pageUrl);
    if (!safe) continue;
    const url = new URL(safe);
    const hasDownloadShape =
      DOWNLOAD_EXT.test(url.pathname) ||
      /(?:^|[?&])(?:op|action)=(?:download|download3|direct)/i.test(url.search);
    if (hasDownloadShape) candidates.add(safe);
  }
  return {
    url: candidates.size === 1 ? [...candidates][0] : null,
    ambiguous: candidates.size > 1,
  };
}

interface FreeControl {
  element: HTMLButtonElement | HTMLInputElement;
  form: HTMLFormElement;
  op: string;
  disabled: boolean;
}
function findFreeControls(
  document: Document,
  pageUrl: URL,
  visibility: VisibilityCache,
): FreeControl[] {
  const fileId = pageUrl.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  const controls: FreeControl[] = [];
  for (const form of Array.from(document.forms)) {
    const op =
      form
        .querySelector<HTMLInputElement>('input[name="op"]')
        ?.value.toLowerCase() ?? "";
    const id = form
      .querySelector<HTMLInputElement>('input[name="id"]')
      ?.value.toLowerCase();
    if (!["download1", "download2"].includes(op) || id !== fileId) continue;
    const method = (form.getAttribute("method") ?? "get").toLowerCase();
    const action = form.getAttribute("action") ?? "";
    if (
      !["get", "post"].includes(method) ||
      (action && !safeKatfileUrl(action, pageUrl))
    )
      continue;
    for (const control of Array.from(
      form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button, input[type="submit"]',
      ),
    )) {
      if (!isVisible(control, visibility)) continue;
      const label = normalizedText(
        control.textContent ||
          (control instanceof document.defaultView!.HTMLInputElement
            ? control.value
            : ""),
      );
      const isFree =
        /slow speed download|free download|create download link|免費下載|建立下載連結/i.test(
          label,
        ) ||
        control.id === "fbtn1" ||
        control.id === "fbtn2";
      if (!isFree || /premium|high speed|upgrade/i.test(label)) continue;
      controls.push({
        element: control,
        form,
        op,
        disabled:
          control.hasAttribute("disabled") ||
          control.getAttribute("aria-disabled") === "true" ||
          (control instanceof document.defaultView!.HTMLButtonElement &&
            control.disabled) ||
          (control instanceof document.defaultView!.HTMLInputElement &&
            control.disabled),
      });
    }
  }
  return controls;
}

function fileMissing(text: string): boolean {
  return /(?:file|this file|requested file) (?:was )?(?:not found|does not exist|has been (?:removed|deleted|blocked))|檔案不存在|檔案已(?:刪除|移除)/i.test(
    text,
  );
}

/** 純 DOM 判讀：只依目前可見頁面與 Katfile 檔案表單結構分類，不操作頁面。 */
export function inspectPage(
  document: Document,
  pageUrl: string,
): PageObservation {
  const base: PageObservation = { kind: "unknown", pageUrl };
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(pageUrl);
  } catch {
    return { ...base, reason: "頁面網址格式無效。" };
  }
  if (!isKatfileFileUrl(parsedUrl))
    return {
      ...base,
      title: document.title || undefined,
      reason: "這不是可辨識的 Katfile 檔案頁。",
    };

  const visibility: VisibilityCache = new WeakMap();
  const text = visibleText(document, visibility);
  const title = fileTitle(document, parsedUrl, visibility);
  if (fileMissing(text))
    return {
      ...base,
      kind: "failed",
      title,
      reason: "Katfile 明確表示檔案不存在或已移除。",
    };
  if (
    !hasCaptchaToken(document) &&
    hasVisibleVerification(document, text, visibility)
  ) {
    return {
      ...base,
      kind: "verification",
      title,
      reason: "頁面顯示驗證挑戰；需要使用者完成驗證。",
    };
  }

  const wait = getWait(document, visibility);
  if (wait && wait.seconds === undefined)
    return {
      ...base,
      title,
      reason: "Katfile 要求稍後再試，但沒有可讀取的剩餘倒數；請查看來源分頁。",
    };
  if (wait && wait.seconds! > 0)
    return {
      ...base,
      kind: "waiting",
      title,
      waitSeconds: wait.seconds,
      reason: `Katfile 顯示免費下載等待：${wait.evidence}`,
    };

  const final = findFinalUrl(document, parsedUrl, visibility);
  if (final.ambiguous)
    return {
      ...base,
      title,
      reason: "頁面有多個可能的下載網址，無法安全判定。",
    };
  if (final.url)
    return {
      ...base,
      kind: "ready",
      title,
      finalUrl: final.url,
      reason: "找到唯一的 Katfile HTTPS 下載網址。",
    };

  if (!hasMatchingDownloadForm(parsedUrl, document)) {
    return {
      ...base,
      title,
      reason: "找不到包含目前檔案識別碼的 download1/download2 表單。",
    };
  }

  const controls = findFreeControls(document, parsedUrl, visibility);
  if (controls.length === 1 && !controls[0].disabled)
    return {
      ...base,
      kind: "free",
      step: controls[0].op as "download1" | "download2",
      title,
      reason: "找到唯一可用的免費下載步驟。",
    };
  if (controls.length > 1)
    return {
      ...base,
      title,
      reason: "頁面有多個免費下載控制項，無法安全選擇。",
    };
  if (controls.length === 1 && controls[0].disabled)
    return { ...base, title, reason: "免費下載控制項目前停用。" };
  return {
    ...base,
    title,
    reason: "找不到可安全辨識的免費步驟或最終下載網址。",
  };
}

/** 供 free action 重檢：下載動作一律留給背景 chrome.downloads API。 */
export function performFreeAction(
  document: Document,
  pageUrl: string,
  expectedStep?: "download1" | "download2",
): { ok: boolean; error?: string } {
  const observation = inspectPage(document, pageUrl);
  if (observation.kind !== "free")
    return {
      ok: false,
      error: observation.reason ?? "目前頁面不允許免費步驟。",
    };
  if (expectedStep && observation.step !== expectedStep)
    return { ok: false, error: "目前免費步驟與佇列要求的階段不符。" };
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(pageUrl);
  } catch {
    return { ok: false, error: "頁面網址無效。" };
  }
  const controls = findFreeControls(document, parsedUrl, new WeakMap());
  if (
    controls.length !== 1 ||
    controls[0].disabled ||
    (expectedStep && controls[0].op !== expectedStep)
  )
    return { ok: false, error: "免費下載控制項已變更或不唯一。" };
  controls[0].element.click();
  return { ok: true };
}
