import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

let dom: JSDOM | undefined;
afterEach(() => {
  dom?.window.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Katfile content script 啟動範圍", () => {
  it.each([
    ["https://katfile.cloud/abcdefgh1234", true],
    ["https://www.katfile.future/abcdefgh1234", true],
    ["https://katfile.com.evil.test/abcdefgh1234", false],
    ["https://katfile.cloud.evil.test/abcdefgh1234", false],
    ["https://evilkatfile.com/abcdefgh1234", false],
    ["https://example.com/katfile.cloud/abcdefgh1234", false],
    ["http://katfile.cloud/abcdefgh1234", false],
  ])("%s 只在符合的 HTTPS 網域啟動：%s", async (url, active) => {
    vi.resetModules();
    dom = new JSDOM("<!doctype html><body>fixture</body>", { url });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    const observe = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe = observe;
      },
    );
    const addListener = vi.fn();
    const sendMessage = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      runtime: { onMessage: { addListener }, sendMessage },
    });
    const readDom = vi.spyOn(dom.window.document, "querySelectorAll");
    const setInterval = vi.spyOn(dom.window, "setInterval").mockReturnValue(1);
    await import("../src/content/index");
    expect(addListener).toHaveBeenCalledTimes(active ? 1 : 0);
    expect(observe).toHaveBeenCalledTimes(active ? 1 : 0);
    expect(setInterval).toHaveBeenCalledTimes(active ? 1 : 0);
    expect(sendMessage).toHaveBeenCalledTimes(active ? 1 : 0);
    if (!active) expect(readDom).not.toHaveBeenCalled();
  });
});
