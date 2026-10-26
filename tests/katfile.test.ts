import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { inspectPage, performFreeAction } from "../src/content/katfile";

const PAGE_URL = "https://katfile.biz/ntrr1zdzt6i0/66-RJ01681172.rar.html";
const initialHtml = readFileSync(
  fileURLToPath(new URL("./fixtures/katfile-initial.html", import.meta.url)),
  "utf8",
);
const cooldownHtml = readFileSync(
  fileURLToPath(new URL("./fixtures/katfile-cooldown.html", import.meta.url)),
  "utf8",
);

function page(html = initialHtml, url = PAGE_URL) {
  return new JSDOM(html, { url });
}

function freeForm(extra = ""): string {
  return `<form method="POST" id="btn_download">
    <input type="hidden" name="op" value="download1"><input type="hidden" name="id" value="ntrr1zdzt6i0">
    <div class="n1-free"><button id="fbtn1">SLOW SPEED DOWNLOAD</button></div>${extra}
  </form>`;
}

describe("Katfile DOM 轉接層", () => {
  it.each(["co", "cloud", "future"])(
    "katfile.%s 能辨識冷卻與同站最終下載連結",
    (suffix) => {
      const url = `https://katfile.${suffix}/wfnml3a1oeg6/08-1924140.rar.html`;
      const waiting = page(cooldownHtml, url);
      expect(inspectPage(waiting.window.document, url)).toMatchObject({
        kind: "waiting",
        waitSeconds: 3767,
      });
      const finalUrl = `https://s1.katfile.${suffix}/d/fixture-only/archive.rar`;
      const ready = page(
        `<a id="dlink" href="${finalUrl}">繼續免費下載</a>`,
        url,
      );
      expect(inspectPage(ready.window.document, url)).toMatchObject({
        kind: "ready",
        finalUrl,
      });
    },
  );
  it.each(["archive.7z.001", "archive.zip.002", "archive.r00"])(
    "支援分卷最終下載連結 %s",
    (filename) => {
      const url = `https://cdn.katfile.biz/download/${filename}`;
      const dom = page(`<a href="${url}">Continue free download</a>`);
      expect(inspectPage(dom.window.document, PAGE_URL)).toMatchObject({
        kind: "ready",
        finalUrl: url,
      });
    },
  );
  it("不因任意數字副檔名就放寬最終下載連結辨識", () => {
    const dom = page(
      '<a href="https://cdn.katfile.biz/download/unknown.001">Continue free download</a>',
    );
    expect(inspectPage(dom.window.document, PAGE_URL).kind).toBe("unknown");
  });
  it("實站限速推銷頁的「繼續免費下載」是最終下載網址，不是驗證或錯誤", () => {
    const html = readFileSync(
      fileURLToPath(new URL("./fixtures/katfile-final.html", import.meta.url)),
      "utf8",
    );
    const dom = page(html);
    expect(inspectPage(dom.window.document, PAGE_URL)).toMatchObject({
      kind: "ready",
      finalUrl:
        "https://s5027.katfile.biz:183/d/fixture-only/66-RJ01681172.rar",
    });
  });
  it("依實站 GET 的初始 form 和可見冷卻訊息回報等待，不會觸發按鈕", () => {
    const dom = page();
    let clicks = 0;
    dom.window.document
      .querySelector("button")
      ?.addEventListener("click", () => clicks++);
    const result = inspectPage(dom.window.document, PAGE_URL);
    expect(result.kind).toBe("waiting");
    expect(result.waitSeconds).toBe(4089);
    expect(clicks).toBe(0);
  });

  it("標題優先讀 form fname，再讀表單 h1，最後清理頁面標題", () => {
    const fromFname = page();
    expect(inspectPage(fromFname.window.document, PAGE_URL).title).toBe(
      "66-RJ01681172.rar",
    );

    const fromHeading =
      page(`<title>Download misleading (2 GB) - KatFile</title>
      <form id="btn_download"><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"><h1>file-from-heading.rar</h1></form>`);
    expect(inspectPage(fromHeading.window.document, PAGE_URL).title).toBe(
      "file-from-heading.rar",
    );

    const fallback =
      page(`<title>Download clean-name.zip (1.2 GB) - KatFile</title>
      <form><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"></form>`);
    expect(inspectPage(fallback.window.document, PAGE_URL).title).toBe(
      "clean-name.zip",
    );
  });

  it("免費步驟只在頁面無等待時允許一次原生 click", () => {
    const dom = page(
      initialHtml.replace(/<div id="delay-box">[\s\S]*?<\/div>/, ""),
    );
    const button = dom.window.document.querySelector("button")!;
    let clicks = 0;
    button.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      clicks++;
    });
    expect(inspectPage(dom.window.document, PAGE_URL).kind).toBe("free");
    expect(inspectPage(dom.window.document, PAGE_URL).step).toBe("download1");
    expect(performFreeAction(dom.window.document, PAGE_URL)).toEqual({
      ok: true,
    });
    expect(clicks).toBe(1);
  });

  it("驗證優先於免費按鈕，並辨識已填入的 Turnstile token", () => {
    const challenge = `<div class="cf-turnstile"><iframe title="Cloudflare challenge"></iframe></div>`;
    const blocked = page(freeForm(challenge));
    expect(inspectPage(blocked.window.document, PAGE_URL).kind).toBe(
      "verification",
    );
    const passed = page(
      `${freeForm(challenge)}<textarea name="cf-turnstile-response">token-present</textarea>`,
    );
    expect(inspectPage(passed.window.document, PAGE_URL).kind).toBe("free");
  });

  it("忽略隱藏的廣告倒數/下載按鈕", () => {
    const dom =
      page(`${freeForm()}<div style="display:none">You have to wait 3 hours till next download
      <a href="https://ad.example/offer.rar">Download</a></div>`);
    expect(inspectPage(dom.window.document, PAGE_URL).kind).toBe("free");
  });

  it("不把 content-visibility:hidden 的免費控制項當成可用按鈕", () => {
    const dom = page(
      freeForm().replace(
        '<div class="n1-free">',
        '<div class="n1-free" style="content-visibility:hidden">',
      ),
    );
    const button = dom.window.document.querySelector("button")!;
    let clicks = 0;
    button.addEventListener("click", () => clicks++);

    expect(inspectPage(dom.window.document, PAGE_URL).kind).toBe("unknown");
    expect(performFreeAction(dom.window.document, PAGE_URL).ok).toBe(false);
    expect(clicks).toBe(0);
  });

  it("關閉 details 只允許第一個 summary 子樹，開啟 details 仍可用", () => {
    const closed = page(
      `<form><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"><details><summary>Details</summary><button id="fbtn1">SLOW SPEED DOWNLOAD</button></details></form>`,
    );
    const hiddenButton = closed.window.document.querySelector("button")!;
    let hiddenClicks = 0;
    hiddenButton.addEventListener("click", () => hiddenClicks++);
    expect(inspectPage(closed.window.document, PAGE_URL).kind).toBe("unknown");
    expect(performFreeAction(closed.window.document, PAGE_URL).ok).toBe(false);
    expect(hiddenClicks).toBe(0);

    const summary = page(
      `<form><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"><details><summary><button id="fbtn1">SLOW SPEED DOWNLOAD</button></summary></details></form>`,
    );
    expect(inspectPage(summary.window.document, PAGE_URL).kind).toBe("free");
    expect(performFreeAction(summary.window.document, PAGE_URL).ok).toBe(true);

    const open = page(
      `<form><input name="op" value="download1"><input name="id" value="ntrr1zdzt6i0"><details open><summary>Details</summary><button id="fbtn1">SLOW SPEED DOWNLOAD</button></details></form>`,
    );
    expect(inspectPage(open.window.document, PAGE_URL).kind).toBe("free");
    expect(performFreeAction(open.window.document, PAGE_URL).ok).toBe(true);
  });

  it("每次檢查重新判斷祖先可見性，並在同次檢查共用祖先樣式結果", () => {
    const dom = page(
      `${freeForm()}<div id="shared" style="display:none"><div class="cf-turnstile"><iframe title="Cloudflare challenge"></iframe></div></div>`,
    );
    const shared = dom.window.document.querySelector<HTMLElement>("#shared")!;
    expect(inspectPage(dom.window.document, PAGE_URL).kind).toBe("free");
    shared.style.display = "block";
    expect(inspectPage(dom.window.document, PAGE_URL).kind).toBe(
      "verification",
    );
    shared.style.display = "none";
    expect(inspectPage(dom.window.document, PAGE_URL).kind).toBe("free");

    const spans = Array.from(
      { length: 300 },
      (_, index) => `<span>${index}</span>`,
    ).join("");
    const repeated = page(
      `${freeForm()}${"<div>".repeat(8)}${spans}${"</div>".repeat(8)}`,
    );
    const getComputedStyle = repeated.window.getComputedStyle.bind(
      repeated.window,
    );
    let styleReads = 0;
    repeated.window.getComputedStyle = ((element: Element) => {
      styleReads++;
      return getComputedStyle(element);
    }) as typeof repeated.window.getComputedStyle;

    expect(inspectPage(repeated.window.document, PAGE_URL).kind).toBe("free");
    // 300 distinct spans plus their shared ancestors and controls; baseline was 3308 reads.
    expect(styleReads).toBeLessThan(600);
  });

  it("只接受唯一、HTTPS、Katfile 網域且明確標示下載的最終 URL", () => {
    const good = page(
      `${freeForm()}<a href="https://cdn.katfile.biz/files/abc.rar" download>Download file</a>`,
    );
    expect(inspectPage(good.window.document, PAGE_URL)).toMatchObject({
      kind: "ready",
      finalUrl: "https://cdn.katfile.biz/files/abc.rar",
    });
    const external = page(
      `${freeForm()}<a href="https://evil.example/files/abc.rar">Download file</a>`,
    );
    expect(inspectPage(external.window.document, PAGE_URL).kind).not.toBe(
      "ready",
    );
    const http = page(
      `${freeForm()}<a href="http://katfile.biz/files/abc.rar">Download file</a>`,
    );
    expect(inspectPage(http.window.document, PAGE_URL).kind).not.toBe("ready");
    const premium = page(
      `${freeForm()}<a href="https://katfile.biz/?op=payments">Download Premium</a>`,
    );
    expect(inspectPage(premium.window.document, PAGE_URL).kind).not.toBe(
      "ready",
    );
  });

  it("多個最終候選與停用免費按鈕都保守回報 unknown", () => {
    const multi = page(
      `${freeForm()}<a href="https://katfile.biz/a.rar">Download A</a><a href="https://katfile.com/b.zip">Download B</a>`,
    );
    expect(inspectPage(multi.window.document, PAGE_URL)).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("多個"),
    });
    const disabled = page(
      freeForm().replace('<button id="fbtn1">', '<button id="fbtn1" disabled>'),
    );
    expect(inspectPage(disabled.window.document, PAGE_URL)).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("停用"),
    });
  });

  it("解析英文和繁體中文冷卻時間，且不把一般限制文案當成正在等待", () => {
    const english = page(
      `${freeForm()}<div id="delay-box">You have to wait 2 hours, 3 minutes and 4 seconds till next download</div>`,
    );
    expect(inspectPage(english.window.document, PAGE_URL).waitSeconds).toBe(
      7384,
    );
    const chinese = page(
      `${freeForm()}<div id="delay-box">請等待 2 小時 3 分 4 秒後再下載</div>`,
    );
    expect(inspectPage(chinese.window.document, PAGE_URL)).toMatchObject({
      kind: "waiting",
      waitSeconds: 7384,
    });
    const policy = page(
      `${freeForm()}<div class="n1-free">限制：1 file per 120 minutes</div>`,
    );
    expect(inspectPage(policy.window.document, PAGE_URL).kind).toBe("free");
  });

  it("以可見 #kfaTimer 的 HH:MM:SS 作剩餘時間，不把冷卻政策的 120 分鐘當倒數", () => {
    const dom = page(cooldownHtml);
    expect(inspectPage(dom.window.document, PAGE_URL)).toMatchObject({
      kind: "waiting",
      waitSeconds: 3767,
    });
    const noTimer = page(
      `${freeForm()}<div id="delay-box">下載之間的等待時間必須不少於120分鐘，請稍後再試。</div>`,
    );
    expect(inspectPage(noTimer.window.document, PAGE_URL).kind).toBe("unknown");
  });

  it("倒數顯示 00:00:00 時可辨識目前免費步驟，且最終連結頁不要求保留 download form", () => {
    const zero = page(
      `${freeForm()}<div id="delay-box">請等待 <span id="kfaTimer">00:00:00</span></div>`,
    );
    expect(inspectPage(zero.window.document, PAGE_URL)).toMatchObject({
      kind: "free",
      step: "download1",
    });
    const finalOnly = page(
      `<a href="https://katfile.biz/files/abc.rar" download>Download file</a>`,
    );
    expect(inspectPage(finalOnly.window.document, PAGE_URL)).toMatchObject({
      kind: "ready",
      finalUrl: "https://katfile.biz/files/abc.rar",
    });
  });

  it("區分 download2 的 Create download link 步驟", () => {
    const secondStep = page(
      `<form method="POST"><input name="op" value="download2"><input name="id" value="ntrr1zdzt6i0"><button>Create download link</button></form>`,
    );
    expect(inspectPage(secondStep.window.document, PAGE_URL)).toMatchObject({
      kind: "free",
      step: "download2",
    });
    const button = secondStep.window.document.querySelector("button")!;
    let clicks = 0;
    button.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      clicks++;
    });
    expect(
      performFreeAction(secondStep.window.document, PAGE_URL, "download1").ok,
    ).toBe(false);
    expect(clicks).toBe(0);
    expect(
      performFreeAction(secondStep.window.document, PAGE_URL, "download2").ok,
    ).toBe(true);
    expect(clicks).toBe(1);
  });

  it("只在頁面明確表示檔案不存在時回報 failed；不認識的頁面保持 unknown 且不亂點", () => {
    const missing = page(`<div class="alert-danger">File not found</div>`);
    expect(inspectPage(missing.window.document, PAGE_URL).kind).toBe("failed");
    const otherUrl = page(freeForm(), "https://katfile.biz/login.html");
    const button = otherUrl.window.document.querySelector("button")!;
    let clicks = 0;
    button.addEventListener("click", () => clicks++);
    expect(
      inspectPage(otherUrl.window.document, "https://katfile.biz/login.html")
        .kind,
    ).toBe("unknown");
    expect(
      performFreeAction(
        otherUrl.window.document,
        "https://katfile.biz/login.html",
      ).ok,
    ).toBe(false);
    expect(clicks).toBe(0);
  });
});
