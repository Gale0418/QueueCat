// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { initialState, STORAGE_KEY } from "../src/shared/types";
import type { AppState, QueueItem } from "../src/shared/types";
import { setMessageLanguage } from "../src/shared/messages";
import { translateGalleryMessage } from "../src/shared/gallery-messages";
import { getLocale } from "../src/shared/locales";
import {
  galleryPageProgress,
  galleryPercent,
  galleryMessage,
} from "../src/ui/gallery";

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
  vi.resetModules();
});

it("formats gallery page progress without inventing a percentage", () => {
  const item = galleryItem("gallery-format", "作品", 1, 4);
  setMessageLanguage("en");
  expect(galleryPageProgress(item)).toContain("1 / 4");
  expect(galleryPercent(item)).toBe(25);
  setMessageLanguage("zh-TW");
  expect(galleryPageProgress(item)).toContain("1 / 4 頁");
  setMessageLanguage("en");
  item.gallery!.total = undefined;
  item.gallery!.images = undefined;
  expect(galleryPageProgress(item)).toContain("total not yet available");
  expect(galleryPageProgress(item)).toContain("1");
  expect(galleryPercent(item)).toBeUndefined();
  item.reason =
    "Hitomi 圖庫內容或標題已變更；為避免混入不同版本，請重新加入圖庫";
  expect(galleryMessage(item)).not.toContain("Hitomi 圖庫");
  item.status = "complete";
  expect(translateGalleryMessage("第 1 張圖片完成")).not.toContain("complete");
  for (const language of ["en", "ja"] as const) {
    expect(
      translateGalleryMessage("Hitomi 圖庫圖片清單遺失，請重新核對", language),
    ).not.toContain("遺失");
  }
});

it("distinguishes ZIP staging, packaging, and Chrome completion", () => {
  setMessageLanguage("en");
  const item = galleryItem("zip-ui", "Book", 0, 4);
  item.gallery!.output = "zip";
  item.gallery!.archive = {
    key: item.id,
    fingerprint: "a".repeat(64),
    staged: 4,
    bytes: 1024,
    phase: "packing",
  };
  item.status = "preparing";
  expect(galleryPageProgress(item)).toContain("4 / 4");
  expect(galleryPercent(item)).toBeUndefined();
  expect(galleryMessage(item)).toContain("ZIP");
  item.status = "downloading";
  item.totalBytes = 200;
  item.bytesReceived = 50;
  expect(galleryPercent(item)).toBe(25);
  item.status = "complete";
  item.gallery!.completed = 4;
  expect(galleryPercent(item)).toBe(100);
  for (const language of ["en", "ja"] as const) {
    expect(
      translateGalleryMessage("圖庫 ZIP 下載完成", language),
    ).not.toContain("下載完成");
    expect(
      translateGalleryMessage("ZIP 圖庫暫存進度與快照不一致", language),
    ).not.toContain("暫存");
  }
});

it("renders escaped gallery titles and progress, and disables extraction for a gallery batch", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
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
    runtime: { id: "test-extension" },
    notifications: { getPermissionLevel: vi.fn(async () => "granted") },
    storage: {
      onChanged: {
        addListener: (listener: typeof changed) => {
          changed = listener;
        },
      },
    },
  });
  const state = initialState();
  state.settings.language = "en";
  const item = galleryItem(
    "gallery-ui",
    '<img src=x onerror="alert(1)">',
    1,
    4,
  );
  state.items.push(item);
  state.activeId = item.id;
  const client = await import("../src/ui/client");
  vi.mocked(client.request).mockResolvedValue({ ok: true, state });
  window.history.replaceState({}, "", "#add");
  await import("../src/ui/main");
  await new Promise((resolve) => setTimeout(resolve, 0));

  document
    .querySelector<HTMLButtonElement>(`[data-select="${item.id}"]`)!
    .click();
  expect(
    document.querySelectorAll(".details .detail-filename img"),
  ).toHaveLength(0);
  expect(document.querySelector(".details .detail-filename")?.textContent).toBe(
    item.gallery!.title,
  );
  expect(
    document.querySelector(".details .gallery-detail")?.textContent,
  ).toContain("1 / 4 pages");
  expect(
    document.querySelector(".details .gallery-detail")?.textContent,
  ).toContain("25.0%");
  expect(
    document.querySelectorAll(".details input[type=password]"),
  ).toHaveLength(0);
  expect(
    document.querySelector(`.queue-row[data-id="${item.id}"] .file-info small`)
      ?.textContent,
  ).toContain("25.0%");
  const unknownTotal = structuredClone(state);
  unknownTotal.items[0].gallery!.total = undefined;
  unknownTotal.items[0].gallery!.images = undefined;
  changed!({ [STORAGE_KEY]: { newValue: unknownTotal } }, "local");
  expect(
    document
      .querySelector(".gallery-progress progress")
      ?.getAttribute("aria-label"),
  ).toContain("total not yet available");
  expect(
    document.querySelector(".gallery-progress progress")?.hasAttribute("value"),
  ).toBe(false);
  const nextPage = structuredClone(state);
  nextPage.items[0].gallery!.completed = 2;
  changed!({ [STORAGE_KEY]: { newValue: nextPage } }, "local");
  expect(document.querySelector("#status-announcement")?.textContent).toContain(
    "2 / 4 pages",
  );

  const extraction = document.querySelector<HTMLInputElement>(
    "#extract-after-download",
  )!;
  const password = document.querySelector<HTMLInputElement>("#batch-password")!;
  extraction.checked = true;
  password.value = "secret";
  const urls = document.querySelector<HTMLTextAreaElement>("#url-input")!;
  urls.value = "https://hitomi.la/reader/7654321.html";
  urls.dispatchEvent(new Event("input"));
  expect(extraction.disabled).toBe(true);
  expect(extraction.checked).toBe(false);
  expect(password.value).toBe("");
  expect(
    document.querySelector<HTMLElement>("#gallery-extraction-hint")!.hidden,
  ).toBe(false);
  expect(
    document.querySelector<HTMLElement>("#batch-password-wrap")!.hidden,
  ).toBe(true);

  const uncertain = structuredClone(state);
  document
    .querySelector<HTMLButtonElement>('[data-filter="attention"]')!
    .click();
  uncertain.items[0].status = "blocked";
  uncertain.items[0].reason =
    "Chrome 圖庫下載交接結果不明：timeout；不會自動重送";
  uncertain.items[0].action = {
    id: "pending",
    kind: "download",
    at: Date.now(),
  };
  changed!({ [STORAGE_KEY]: { newValue: uncertain } }, "local");
  for (const language of ["en", "ja"] as const) {
    uncertain.settings.language = language;
    changed!(
      { [STORAGE_KEY]: { newValue: structuredClone(uncertain) } },
      "local",
    );
    expect(document.querySelector("#status-title")?.textContent).toBe(
      getLocale(language).summaryBlockedTitle,
    );
    const paused = structuredClone(uncertain);
    paused.running = false;
    paused.activeId = undefined;
    paused.items[0].status = "queued";
    paused.items[0].action = undefined;
    paused.items[0].reason = undefined;
    changed!({ [STORAGE_KEY]: { newValue: paused } }, "local");
    expect(document.querySelector("#status-title")?.textContent).toBe(
      getLocale(language).summaryReadyToGoTitle,
    );
    paused.activeId = paused.items[0].id;
    paused.items[0].status = "preparing";
    changed!({ [STORAGE_KEY]: { newValue: paused } }, "local");
    expect(document.querySelector("#status-title")?.textContent).toBe(
      getLocale(language).notifyQueuePausedTitle,
    );
  }
  uncertain.settings.language = "en";
  changed!({ [STORAGE_KEY]: { newValue: uncertain } }, "local");
  const row = document.querySelector(`.queue-row[data-id="${item.id}"]`)!;
  expect(document.querySelector("#status-title")?.textContent).not.toContain(
    "automatically",
  );
  expect(document.querySelector("#status-subtitle")?.textContent).toContain(
    "automatically",
  );
  expect(row.querySelector('[data-action="retry"]')).toBeNull();
  expect(row.querySelector('[data-action="remove"]')).toBeNull();
  expect(row.querySelector('[data-action="up"]')).toBeNull();
  expect(row.querySelector('[data-action="down"]')).toBeNull();
  const confirmForget = vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.mocked(client.request).mockClear();
  document
    .querySelector<HTMLButtonElement>('[data-action="forget-gallery"]')!
    .click();
  expect(confirmForget).toHaveBeenCalledOnce();
  expect(client.request).not.toHaveBeenCalled();
  confirmForget.mockReturnValue(true);
  document
    .querySelector<HTMLButtonElement>('[data-action="forget-gallery"]')!
    .click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.request).toHaveBeenCalledWith({
    kind: "remove",
    id: item.id,
    confirmUncertain: true,
  });

  const changedMetadata = structuredClone(uncertain);
  changedMetadata.items[0].action = undefined;
  changedMetadata.items[0].reason =
    "Hitomi 圖庫內容或標題已變更；為避免混入不同版本，請重新加入圖庫";
  changed!({ [STORAGE_KEY]: { newValue: changedMetadata } }, "local");
  expect(
    document.querySelector(
      `.queue-row[data-id="${item.id}"] [data-action="remove"]`,
    ),
  ).not.toBeNull();
  expect(
    document.querySelector(
      `.queue-row[data-id="${item.id}"] [data-action="retry"]`,
    ),
  ).toBeNull();
  expect(
    document.querySelectorAll("#hero-actions [data-action=focus]"),
  ).toHaveLength(0);
  const addedState = structuredClone(changedMetadata);
  addedState.items.push(galleryItem("new-gallery", "second", 0, 4));
  vi.mocked(client.request).mockResolvedValue({ ok: true, state: addedState });
  document.querySelector<HTMLButtonElement>("#confirm-add")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector("#toast")?.textContent).not.toContain(
    "貓貓收到了",
  );
  expect(document.querySelector("#toast")?.textContent).toContain("1");
  const queued = structuredClone(addedState);
  queued.activeId = undefined;
  queued.items.forEach((entry) => {
    entry.status = "queued";
    entry.action = undefined;
  });
  document.querySelector<HTMLButtonElement>('[data-filter="queue"]')!.click();
  changed!({ [STORAGE_KEY]: { newValue: queued } }, "local");
  expect(
    document.querySelector<HTMLButtonElement>(
      `.queue-row[data-id="${item.id}"] [data-action="down"]`,
    )?.disabled,
  ).toBe(false);
});

function galleryItem(
  id: string,
  title: string,
  completed: number,
  total: number,
): QueueItem {
  return {
    id,
    sourceUrl: "https://hitomi.la/galleries/1234567.html",
    title: "0002.webp",
    status: "downloading",
    createdAt: 1,
    updatedAt: 1,
    bytesReceived: 512,
    totalBytes: 1024,
    speed: 64,
    events: [],
    gallery: {
      id: "1234567",
      title,
      folder: "QueueCat/Hitomi-1234567-title",
      images: Array.from({ length: total }, (_, i) => ({
        hash: `${i + 1}`.padStart(8, "0"),
        name: `${i + 1}.webp`,
      })),
      total,
      completed,
    },
  };
}
