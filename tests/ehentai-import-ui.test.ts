// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { initialState, STORAGE_KEY } from "../src/shared/types";
import type { AppState, QueueItem } from "../src/shared/types";

vi.mock("../src/ui/client", () => ({
  preview: false,
  request: vi.fn(async () => ({ ok: true, state: initialState() })),
  findDownloads: vi.fn(),
  scenario: vi.fn(),
}));

const works = [
  {
    url: "https://e-hentai.org/g/435/0123456789/",
    title: "Sample work",
  },
  {
    url: "https://e-hentai.org/g/436/abcdef1234/",
    title: "New work",
  },
];

function workItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "work-435",
    sourceUrl: works[0].url,
    title: works[0].title,
    status: "failed",
    createdAt: 1,
    updatedAt: 1,
    reason: "gallery_unavailable",
    ehArchive: { openedAt: 1 },
    events: [],
    ...overrides,
  };
}

function chromeApi() {
  return {
    runtime: { id: "test-extension" },
    notifications: { getPermissionLevel: vi.fn(async () => "granted") },
    tabs: {
      query: vi.fn(async () => [
        { id: 12, url: "https://e-hentai.org/tag/test" },
      ]),
    },
    scripting: {
      executeScript: vi.fn(async () => [{ result: works }]),
    },
    storage: {
      onChanged: {
        addListener: vi.fn((listener: (changes: Record<string, unknown>, area: string) => void) => listeners.push(listener)),
      },
    },
  };
}

const listeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];

async function mount(state: AppState, popup = true) {
  document.body.innerHTML = '<div id="app"></div>';
  document.body.className = popup ? "popup" : "";
  history.replaceState(null, "", "#");
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-TW"]);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
  }));
  listeners.length = 0;
  const chrome = chromeApi();
  vi.stubGlobal("chrome", chrome);
  vi.resetModules();
  const client = await import("../src/ui/client");
  vi.mocked(client.request).mockResolvedValue({ ok: true, state });
  await import("../src/ui/main");
  await vi.waitFor(() => expect(client.request).toHaveBeenCalled());
  return { client, chrome };
}

async function openImporter(expectedCount = works.length) {
  const button = document.querySelector<HTMLButtonElement>('[data-action="import-ehentai"]')!;
  await vi.waitFor(() => expect(button.hidden).toBe(false));
  button.click();
  await vi.waitFor(() =>
    expect(document.querySelectorAll('#ehentai-import-list input[name="ehentai-work"]')).toHaveLength(expectedCount),
  );
}

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  history.replaceState(null, "", "#");
  document.body.className = "";
  listeners.length = 0;
});

it("preserves checked works across modes without selecting newly visible works", async () => {
  const state = { ...initialState(), items: [workItem()] };
  await mount(state);
  await openImporter();

  const work = document.querySelector<HTMLInputElement>('input[name="ehentai-work"][value="0"]')!;
  work.click();
  expect(document.querySelector<HTMLButtonElement>("#ehentai-import-confirm")!.disabled).toBe(false);

  document.querySelector<HTMLInputElement>('input[name="ehentai-import-mode"][value="archive"]')!.click();
  await vi.waitFor(() => expect(document.querySelectorAll('input[name="ehentai-work"]')).toHaveLength(1));
  expect(document.querySelector('#ehentai-import-list')!.textContent).toContain("New work");
  expect(document.querySelector<HTMLInputElement>('input[name="ehentai-work"]')!.checked).toBe(false);
  expect(document.querySelector<HTMLButtonElement>("#ehentai-import-confirm")!.disabled).toBe(true);

  document.querySelector<HTMLInputElement>('input[name="ehentai-import-mode"][value="reader"]')!.click();
  await vi.waitFor(() => expect(document.querySelectorAll('input[name="ehentai-work"]')).toHaveLength(2));
  expect(document.querySelector<HTMLInputElement>('input[name="ehentai-work"][value="0"]')!.checked).toBe(true);
  expect(document.querySelector<HTMLInputElement>('input[name="ehentai-work"][value="1"]')!.checked).toBe(false);
  expect(document.querySelector<HTMLButtonElement>("#ehentai-import-confirm")!.disabled).toBe(false);
});

it("refreshes popup candidates when another surface queues the same work", async () => {
  const { chrome } = await mount(initialState());
  await openImporter();
  document.querySelector<HTMLInputElement>('input[name="ehentai-work"]')!.click();

  const onChanged = chrome.storage.onChanged.addListener.mock.calls[0][0];
  onChanged({ [STORAGE_KEY]: { newValue: { ...initialState(), items: [workItem({ ehArchive: undefined, gallery: { id: "435", completed: 0, output: "zip" } })] } } }, "local");
  expect(document.querySelectorAll('#ehentai-import-list input[name="ehentai-work"]')).toHaveLength(1);
  expect(document.querySelector('#ehentai-import-list')!.textContent).toContain("New work");
  expect(document.querySelector<HTMLButtonElement>("#ehentai-import-confirm")!.disabled).toBe(true);
  expect(document.querySelectorAll('#ehentai-import-list input[name="ehentai-work"]:checked')).toHaveLength(0);
});

it("offers a re-read without showing success or closing the importer when zero works are added", async () => {
  const { client, chrome } = await mount(initialState());
  await openImporter();
  document.querySelector<HTMLInputElement>('input[name="ehentai-work"]')!.click();
  vi.mocked(client.request).mockResolvedValueOnce({ ok: true, state: initialState() });
  document.querySelector<HTMLButtonElement>("#ehentai-import-confirm")!.click();

  await vi.waitFor(() =>
    expect(document.querySelector("#ehentai-import-panel")!.textContent).toContain("沒有新增作品"),
  );
  expect(document.querySelector<HTMLElement>("#ehentai-import-panel")!.hidden).toBe(false);
  expect(document.querySelector("#toast")!.textContent).not.toContain("已加入 0");
  document.querySelector<HTMLButtonElement>('[data-action="retry-ehentai-import"]')!.click();
  await vi.waitFor(() => expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2));
});

it("disables the reader tab retry CTA while another command is pending", async () => {
  const state = {
    ...initialState(),
    items: [
      workItem({
        ehArchive: undefined,
        gallery: { id: "435", completed: 0, output: "zip" },
      }),
    ],
  };
  const { client } = await mount(state, false);
  document.querySelector<HTMLButtonElement>('[data-filter="attention"]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-select="work-435"]')).not.toBeNull());
  document.querySelector<HTMLButtonElement>('[data-select="work-435"]')!.click();
  const cta = document.querySelector<HTMLButtonElement>('[data-action="use-ehentai-tab"]')!;
  expect(cta.disabled).toBe(false);

  let resolveCommand!: (value: { ok: boolean; state: AppState }) => void;
  vi.mocked(client.request).mockImplementationOnce(
    () => new Promise((resolve) => { resolveCommand = resolve; }),
  );
  document.querySelector<HTMLButtonElement>('[data-action="use-ehentai-tab"]')!.click();
  expect(document.querySelector<HTMLButtonElement>('[data-action="use-ehentai-tab"]')!.disabled).toBe(true);
  resolveCommand({ ok: true, state });
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLButtonElement>('[data-action="use-ehentai-tab"]')!.disabled).toBe(false),
  );
});
