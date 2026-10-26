// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { initialState, STORAGE_KEY } from "../src/shared/types";
import type { AppState } from "../src/shared/types";

vi.mock("../src/ui/client", () => ({
  preview: false,
  request: vi.fn(async () => ({ ok: true, state: initialState() })),
  findDownloads: vi.fn(),
  scenario: vi.fn(),
}));

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("exposes both category selectors and announces status changes without repeating progress samples", async () => {
  vi.useFakeTimers();
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-TW"]);
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
  }));
  let changed: (
    changes: Record<string, { newValue: AppState }>,
    area: string,
  ) => void;
  vi.stubGlobal("chrome", {
    notifications: { getPermissionLevel: vi.fn(async () => "granted") },
    storage: {
      onChanged: {
        addListener: (listener: typeof changed) => {
          changed = listener;
        },
      },
    },
  });
  await import("../src/ui/main");
  await Promise.resolve();
  expect(document.querySelector<HTMLElement>("#add-panel")!.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>("#current")!.hidden).toBe(true);
  expect(
    document.querySelector('#hero-actions [data-action="start"]'),
  ).toBeNull();
  const input = document.querySelector<HTMLTextAreaElement>("#url-input")!;
  input.value = "https://katfile.biz/abcdefghijkl/file.rar.html";
  input.dispatchEvent(new Event("input"));
  expect(document.querySelector("#confirm-add")!.textContent).toBe(
    "加入 1 個下載",
  );
  expect(
    document.querySelector<HTMLDetailsElement>("#url-preview details")!.open,
  ).toBe(false);
  const uiRequest = vi.mocked((await import("../src/ui/client")).request);
  const callsBeforeShortcut = uiRequest.mock.calls.length;
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      repeat: true,
      bubbles: true,
    }),
  );
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
      bubbles: true,
    }),
  );
  expect(uiRequest.mock.calls.length).toBe(callsBeforeShortcut);
  document
    .querySelector<HTMLButtonElement>('[data-action="settings"]')!
    .click();
  expect(document.querySelector<HTMLElement>("#add-panel")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#settings-panel")!.hidden).toBe(
    false,
  );
  document
    .querySelector("#theme")!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  expect(document.querySelector<HTMLElement>("#settings-panel")!.hidden).toBe(
    true,
  );
  expect((document.activeElement as HTMLElement).dataset.action).toBe(
    "settings",
  );
  document
    .querySelector<HTMLButtonElement>('#hero-actions [data-action="add"]')!
    .click();
  expect(document.activeElement).toBe(input);
  expect(document.querySelector<HTMLElement>("#settings-panel")!.hidden).toBe(
    true,
  );

  const selectors = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-filter="attention"]',
    ),
  ];
  expect(selectors).toHaveLength(2);
  expect(document.querySelector('[role="tab"]')).toBeNull();
  selectors[1].focus();
  selectors[1].click();
  expect(document.activeElement).toBe(selectors[1]);
  expect(
    selectors.every((button) => button.getAttribute("aria-pressed") === "true"),
  ).toBe(true);
  expect(
    [...document.querySelectorAll('[data-filter="queue"]')].every(
      (button) => button.getAttribute("aria-pressed") === "false",
    ),
  ).toBe(true);

  const state = initialState();
  state.running = true;
  state.activeId = "test-download";
  state.items.push({
    id: state.activeId,
    sourceUrl: "https://katfile.biz/abcdefghijkl/file.rar.html",
    title: "file.rar",
    status: "verification",
    createdAt: 1,
    updatedAt: 1,
    events: [],
  });
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  const announcement = document.querySelector("#status-announcement")!;
  expect(announcement.getAttribute("role")).toBe("status");
  expect(announcement.textContent).toContain("file.rar");
  expect(announcement.textContent).toContain("驗證");

  state.items[0].status = "downloading";
  state.items[0].bytesReceived = 100;
  state.items[0].totalBytes = 1000;
  state.items[0].speed = 10;
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  expect(announcement.textContent).toContain("下載中");
  expect(document.querySelector(".download-remaining")?.textContent).toBe(
    "預估下載剩餘 01:30",
  );
  const announcedText = announcement.firstChild;
  state.items[0].bytesReceived = 200;
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  expect(announcement.firstChild).toBe(announcedText);
  expect(document.querySelector(".transfer-meta")?.textContent).toContain(
    "200 B",
  );
  state.externalDownloadId = 91;
  state.externalWaitReason = "Chrome 正在下載其他 Katfile 檔案，完成後繼續";
  state.externalTransfer = {
    title: "SO-37194.rar",
    bytesReceived: 500,
    totalBytes: 1500,
    speed: 10,
  };
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  expect(
    document.querySelector("#current .current-file")?.textContent,
  ).toContain("SO-37194.rar");
  expect(document.querySelector(".download-remaining")?.textContent).toBe(
    "預估下載剩餘 01:40",
  );
  state.items[0].status = "blocked";
  state.items[0].reason =
    "Chrome 已有同名下載，請確認是否為同一筆；不會重新下載。";
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  const confirmExternal = document.querySelector<HTMLButtonElement>(
    '[data-action="confirm-external"]',
  )!;
  expect(confirmExternal.textContent).toBe("確認是同一筆下載，接續追蹤");
  confirmExternal.click();
  expect(uiRequest).toHaveBeenLastCalledWith({
    kind: "adopt-download",
    id: "test-download",
    downloadId: 91,
  });
  await Promise.resolve();
  state.items[0].status = "downloading";
  state.items[0].reason = undefined;
  state.externalDownloadId = undefined;
  state.externalWaitReason = undefined;
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  document.querySelector<HTMLButtonElement>('[data-filter="queue"]')!.click();
  const file = document.querySelector<HTMLButtonElement>(
    '[data-select="test-download"]',
  )!;
  file.focus();
  file.click();
  expect((document.activeElement as HTMLElement).dataset.select).toBe(
    "test-download",
  );
  state.items[0].bytesReceived = 300;
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  expect((document.activeElement as HTMLElement).dataset.select).toBe(
    "test-download",
  );
  document
    .querySelector<HTMLButtonElement>('#current [data-action="downloads"]')!
    .focus();
  state.items[0].bytesReceived = 400;
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  expect(document.activeElement?.closest("#current")).not.toBeNull();
  expect((document.activeElement as HTMLElement).dataset.action).toBe(
    "downloads",
  );
  state.items.push(
    ...["queued-a", "queued-b"].map((id) => ({
      ...state.items[0],
      id,
      status: "queued" as const,
    })),
  );
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  expect(
    document.querySelector<HTMLButtonElement>(
      '[data-item="queued-a"][data-action="up"]',
    )!.disabled,
  ).toBe(true);
  expect(
    document.querySelector<HTMLButtonElement>(
      '[data-item="queued-a"][data-action="down"]',
    )!.disabled,
  ).toBe(false);
  expect(
    document.querySelector<HTMLButtonElement>(
      '[data-item="queued-b"][data-action="down"]',
    )!.disabled,
  ).toBe(true);
  state.items[0].status = "blocked";
  state.items[0].action = { id: "unknown-handoff", kind: "download", at: 1 };
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  document
    .querySelector<HTMLButtonElement>('[data-filter="attention"]')!
    .click();
  expect(
    document.querySelector('[data-item="test-download"][data-action="retry"]'),
  ).toBeNull();
  expect(
    document.querySelector('[data-select="test-download"]'),
  ).not.toBeNull();
  expect(
    document
      .querySelector("#hero-actions .primary")
      ?.getAttribute("data-action"),
  ).toBe("recheck");
  state.items[0].downloadId = 90;
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  expect(
    document
      .querySelector("#hero-actions .primary")
      ?.getAttribute("data-action"),
  ).toBe("downloads");
  expect(
    document.querySelector('#hero-actions [data-action="remove"]')?.textContent,
  ).toContain("移除紀錄");
  expect(
    document
      .querySelector(
        '.queue-row[data-id="test-download"] [data-action="remove"]',
      )
      ?.getAttribute("aria-label"),
  ).toBe("移除紀錄");
  for (const status of [
    "queued",
    "preparing",
    "waiting",
    "verification",
    "handoff",
    "downloading",
    "complete",
  ] as const) {
    state.items[0].status = status;
    changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
    document
      .querySelector<HTMLButtonElement>(
        `[data-filter="${status === "complete" ? "complete" : "queue"}"]`,
      )!
      .click();
    expect(
      document
        .querySelector(
          '.queue-row[data-id="test-download"] [data-action="remove"]',
        )
        ?.getAttribute("aria-label"),
    ).toBe("移除紀錄");
  }
  state.items[0].status = "blocked";
  const literalReason = '等待 & <來源> <img src=x onerror="alert(1)">';
  state.items[0].reason = literalReason;
  changed!({ [STORAGE_KEY]: { newValue: state } }, "local");
  document
    .querySelector<HTMLButtonElement>('[data-filter="attention"]')!
    .click();
  const secondary = document.querySelector(
    '.queue-row[data-id="test-download"] .file-info small',
  )!;
  expect(secondary.textContent).toBe(literalReason);
  expect(secondary.querySelector("img")).toBeNull();
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  document.querySelector<HTMLButtonElement>('[data-action="share"]')!.click();
  expect(document.querySelector<HTMLElement>("#settings-panel")!.hidden).toBe(
    false,
  );
  expect(document.activeElement?.id).toBe("share-intro");
  document
    .querySelector<HTMLButtonElement>('[data-action="copy-intro"]')!
    .click();
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledOnce();
  const copied = writeText.mock.calls[0][0];
  expect(copied).toContain("本機測試版");
  expect(copied).not.toContain(state.items[0].sourceUrl);
  expect(copied).not.toContain("file.rar");
  writeText.mockRejectedValueOnce(new Error("clipboard blocked"));
  document
    .querySelector<HTMLButtonElement>('[data-action="copy-intro"]')!
    .click();
  await Promise.resolve();
  const intro = document.querySelector<HTMLTextAreaElement>("#share-intro")!;
  expect(document.activeElement).toBe(intro);
  expect(intro.selectionEnd).toBe(intro.value.length);
  document
    .querySelector<HTMLButtonElement>('#hero-actions [data-action="remove"]')!
    .click();
  expect(uiRequest).toHaveBeenLastCalledWith({
    kind: "remove",
    id: "test-download",
  });
});
