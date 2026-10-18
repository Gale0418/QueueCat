// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { initialState, STORAGE_KEY } from "../src/shared/types";
import type { AppState, ExtractionGroup, QueueItem } from "../src/shared/types";

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

it("sends extraction settings only when checked and keeps secrets out of state and markup", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-TW"]);
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 900px)",
    addEventListener() {},
  }));
  let changed: (
    changes: Record<string, { newValue: AppState }>,
    area: string,
  ) => void;
  vi.stubGlobal("chrome", {
    runtime: { id: "safe-extension-id" },
    notifications: { getPermissionLevel: vi.fn(async () => "granted") },
    storage: {
      onChanged: {
        addListener: (listener: typeof changed) => {
          changed = listener;
        },
      },
    },
  });
  const { request } = await import("../src/ui/client");
  const uiRequest = vi.mocked(request);
  await import("../src/ui/main");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const url = "https://katfile.biz/abcdefghijkl/archive.zip.html";
  const secret = "private-batch-password";
  const urlInput = document.querySelector<HTMLTextAreaElement>("#url-input")!;
  const extract = document.querySelector<HTMLInputElement>(
    "#extract-after-download",
  )!;
  const password = document.querySelector<HTMLInputElement>("#batch-password")!;
  urlInput.value = url;
  urlInput.dispatchEvent(new Event("input"));
  extract.checked = true;
  extract.dispatchEvent(new Event("change"));
  password.value = secret;
  uiRequest.mockResolvedValueOnce({
    ok: false,
    error: "helper_unavailable",
    state: initialState(),
  });
  urlInput.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(uiRequest).toHaveBeenLastCalledWith({
    kind: "add",
    urls: [url],
    extraction: { password: secret },
  });
  expect(password.value).toBe(secret);
  expect(extract.checked).toBe(true);
  expect(document.querySelector("#toast")?.textContent).toContain(
    "未安裝小幫手（不影響下載）",
  );

  extract.checked = false;
  extract.dispatchEvent(new Event("change"));
  uiRequest.mockResolvedValueOnce({
    ok: true,
    state: stateWithItem("ordinary-item", url),
  });
  document.querySelector<HTMLButtonElement>("#confirm-add")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(uiRequest).toHaveBeenLastCalledWith({ kind: "add", urls: [url] });
  expect(password.value).toBe("");
  expect(extract.checked).toBe(false);

  const extractedUrl = "https://katfile.biz/mnopqrstuvwx/secret.zip.html";
  urlInput.value = extractedUrl;
  urlInput.dispatchEvent(new Event("input"));
  extract.checked = true;
  extract.dispatchEvent(new Event("change"));
  password.value = secret;
  const addedState = stateWithItem("ordinary-item", url);
  addedState.items.push(...stateWithItem("extracted-item", extractedUrl).items);
  addedState.extractions = [
    { id: "group-1", itemIds: ["extracted-item"], status: "queued" },
  ];
  uiRequest.mockResolvedValueOnce({ ok: true, state: addedState });
  document.querySelector<HTMLButtonElement>("#confirm-add")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(uiRequest).toHaveBeenLastCalledWith({
    kind: "add",
    urls: [extractedUrl],
    extraction: { password: secret },
  });
  expect(password.value).toBe("");
  expect(extract.checked).toBe(false);
  expect(JSON.stringify(addedState)).not.toContain(secret);

  const rawPath = 'C:\\QueueCat\\<img src=x onerror="alert(1)">';
  const failed = stateWithItem("extracted-item", extractedUrl, [
    {
      id: "group-1",
      itemIds: ["extracted-item"],
      status: "failed",
      errorCode: 'vendor_code_<img src=x onerror="alert(1)">',
      outputDir: rawPath,
    },
  ]);
  changed!({ [STORAGE_KEY]: { newValue: failed } }, "local");
  document
    .querySelector<HTMLButtonElement>('[data-select="extracted-item"]')!
    .click();
  const output = document.querySelector<HTMLElement>(
    ".extraction-output [data-raw]",
  )!;
  const rawCode = document.querySelector<HTMLElement>(
    ".extraction-detail code[data-raw]",
  )!;
  expect(output.textContent).toBe(rawPath);
  expect(output.getAttribute("title")).toBe(rawPath);
  expect(rawCode.textContent).toBe(
    'vendor_code_<img src=x onerror="alert(1)">',
  );
  expect(document.querySelectorAll(".extraction-detail img")).toHaveLength(0);

  const retry = document.querySelector<HTMLInputElement>(
    "#retry-extraction-password",
  )!;
  expect(document.querySelectorAll("#retry-extraction-password")).toHaveLength(
    1,
  );
  expect(retry.closest(".inline-details")).not.toBeNull();
  retry.value = "new-password";
  // A stale/unrelated control must never supply another group's password.
  const unrelated = document.createElement("input");
  unrelated.id = "retry-extraction-password";
  unrelated.type = "password";
  unrelated.value = "unrelated-password";
  document.body.prepend(unrelated);
  const retried = stateWithItem("extracted-item", extractedUrl, [
    { id: "group-1", itemIds: ["extracted-item"], status: "queued" },
  ]);
  uiRequest.mockResolvedValueOnce({ ok: true, state: retried });
  document
    .querySelector<HTMLButtonElement>('[data-action="retry-extraction"]')!
    .click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(uiRequest).toHaveBeenLastCalledWith({
    kind: "retry-extraction",
    id: "group-1",
    password: "new-password",
  });
  expect(JSON.stringify(retried)).not.toContain("new-password");
  expect(retry.value).toBe("");
  expect(unrelated.value).toBe("unrelated-password");
  unrelated.remove();

  const expired = structuredClone(failed);
  expired.extractions![0].errorCode = "password_expired";
  changed!({ [STORAGE_KEY]: { newValue: expired } }, "local");
  const emptyRetry = document.querySelector<HTMLInputElement>(
    "#retry-extraction-password",
  )!;
  expect(emptyRetry.value).toBe("");
  expect(document.querySelector("#retry-password-hint")?.textContent).toBe(
    "密碼已清除；若檔案無密碼可留白",
  );
  expect(document.querySelector(".extraction-detail")?.textContent).toContain(
    "7 天",
  );
  uiRequest.mockResolvedValueOnce({ ok: true, state: retried });
  document
    .querySelector<HTMLButtonElement>('[data-action="retry-extraction"]')!
    .click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(uiRequest).toHaveBeenLastCalledWith({
    kind: "retry-extraction",
    id: "group-1",
    password: "",
  });
});

function stateWithItem(
  id: string,
  sourceUrl: string,
  extractions?: ExtractionGroup[],
): AppState {
  const state = initialState();
  const item: QueueItem = {
    id,
    sourceUrl,
    title: "archive.zip",
    status: "queued",
    createdAt: 1,
    updatedAt: 1,
    events: [],
  };
  state.items.push(item);
  state.extractions = extractions;
  return state;
}
