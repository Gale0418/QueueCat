import { describe, expect, it, vi } from "vitest";
import {
  createGalleryTransport,
  fetchGalleryWebp,
  isExtensionBlobUrl,
  isSafeGalleryImageUrl,
  readWebpResponse,
} from "../src/background/gallery-transport";

const validImageUrl = `https://w1.gold-usergeneratedcontent.net/123/45/${"a".repeat(64)}.webp`;
const extensionOrigin = "chrome-extension://queuecat-test";
const validWebp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);

function response(bytes: Uint8Array, contentType = "image/webp"): Response {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(buffer, { headers: { "content-type": contentType } });
}

describe("圖庫 Blob 傳輸輸入驗證", () => {
  it("只接受規定的 HTTPS host、數字路徑與 64 位十六進位 hash", () => {
    expect(isSafeGalleryImageUrl(validImageUrl)).toBe(true);
    for (const url of [
      validImageUrl.replace("w1.", "w3."),
      validImageUrl.replace("https://", "http://"),
      validImageUrl.replace("/123/45/", "/abc/45/"),
      validImageUrl.replace("/123/45/", `/${"1".repeat(17)}/45/`),
      validImageUrl.replace("/123/45/", "/123/12345/"),
      validImageUrl.replace(`${"a".repeat(64)}.webp`, `${"g".repeat(64)}.webp`),
      `${validImageUrl}?download=1`,
      "https://w1.gold-usergeneratedcontent.net/123/45/image.webp",
    ])
      expect(isSafeGalleryImageUrl(url)).toBe(false);
  });

  it("只認同擴充功能 origin 的 Blob URL", () => {
    expect(
      isExtensionBlobUrl(
        `blob:${extensionOrigin}/d2e31f84-44ee-4a22-9f04-1a1b2c3d4e5f`,
        extensionOrigin,
      ),
    ).toBe(true);
    expect(
      isExtensionBlobUrl("blob:https://example.com/d2e31f", extensionOrigin),
    ).toBe(false);
    expect(
      isExtensionBlobUrl("data:image/webp;base64,AAAA", extensionOrigin),
    ).toBe(false);
  });

  it("串流分段讀取並驗證 WebP magic 與 Content-Type", async () => {
    const chunks = [validWebp.slice(0, 3), validWebp.slice(3)];
    const streamed = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      { headers: { "content-type": "image/webp; charset=binary" } },
    );
    expect((await readWebpResponse(streamed)).type).toBe("image/webp");

    const badMagic = validWebp.slice();
    badMagic[0] = 0;
    await expect(readWebpResponse(response(badMagic))).rejects.toThrow(
      "gallery_invalid_webp",
    );
    await expect(
      readWebpResponse(response(validWebp, "application/octet-stream")),
    ).rejects.toThrow("gallery_invalid_content_type");
  });

  it("在串流超過上限時立即拒絕", async () => {
    const tooLarge = new Uint8Array(13);
    tooLarge.set(validWebp);
    await expect(readWebpResponse(response(tooLarge), 12)).rejects.toThrow(
      "gallery_image_too_large",
    );
  });

  it("拒絕錯誤 Content-Type 時會取消尚未讀取的 body", async () => {
    const cancel = vi.fn(async () => undefined);
    const body = {
      cancel,
      getReader: vi.fn(),
    } as unknown as ReadableStream<Uint8Array>;
    const invalidResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body,
    } as Response;
    await expect(readWebpResponse(invalidResponse)).rejects.toThrow(
      "gallery_invalid_content_type",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("逾時會 abort fetch，且不會把未完成請求當成 Blob", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn(
      (_url: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((_resolve, _reject) => {
          signal = options?.signal as AbortSignal;
        }),
    );
    await expect(fetchGalleryWebp(validImageUrl, fetcher, 5)).rejects.toThrow(
      "gallery_fetch_timeout",
    );
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      validImageUrl,
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
  });
});

describe("圖庫傳輸取消與錯誤收尾", () => {
  it("清除 session rule 失敗時保留錯誤並取消已回覆的 Blob", async () => {
    const extensionId = "queuecat-test";
    const extensionUrl = `chrome-extension://${extensionId}/`;
    const blobUrl = `blob:${extensionUrl.slice(0, -1)}/d2e31f84-44ee-4a22-9f04-1a1b2c3d4e5f`;
    const blobs = new Set<string>();
    const messages: Array<Record<string, unknown>> = [];
    const closeDocument = vi.fn(async () => undefined);
    const updateSessionRules = vi.fn(
      async (rules: { addRules?: unknown[] }) => {
        if (!rules.addRules) throw new Error("session rule clear failed");
      },
    );
    vi.stubGlobal("chrome", {
      runtime: {
        id: extensionId,
        getURL: (path: string) => `${extensionUrl}${path}`,
        getContexts: vi.fn(async () => [{}]),
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(async (message: Record<string, unknown>) => {
          messages.push(message);
          if (message.action === "prepare") {
            blobs.add(blobUrl);
            return { ok: true, blobUrl };
          }
          if (message.action === "cancel") {
            blobs.delete(blobUrl);
            return { ok: true, idle: blobs.size === 0 };
          }
          return { ok: true, idle: true };
        }),
      },
      offscreen: { createDocument: vi.fn(), closeDocument },
      declarativeNetRequest: { updateSessionRules },
    });
    try {
      const transport = createGalleryTransport({
        requestMs: 50,
        cleanupMs: 50,
      });
      await expect(transport.prepare(validImageUrl)).rejects.toThrow(
        "Could not clear the gallery Referer session rule after one retry",
      );
      expect(messages.map((message) => message.action)).toEqual([
        "prepare",
        "cancel",
      ]);
      expect(messages[1].requestId).toBe(messages[0].requestId);
      expect(blobs.size).toBe(0);
      expect(closeDocument).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("session rule 暫時清理失敗時只重試一次並保留成功 Blob", async () => {
    const extensionId = "queuecat-test";
    const extensionUrl = `chrome-extension://${extensionId}/`;
    const blobUrl = `blob:${extensionUrl.slice(0, -1)}/d2e31f84-44ee-4a22-9f04-1a1b2c3d4e5f`;
    const messages: Array<Record<string, unknown>> = [];
    let removeCalls = 0;
    const updateSessionRules = vi.fn(
      async (rules: { addRules?: unknown[] }) => {
        if (!rules.addRules && ++removeCalls === 1)
          throw new Error("temporary session rule clear failure");
      },
    );
    vi.stubGlobal("chrome", {
      runtime: {
        id: extensionId,
        getURL: (path: string) => `${extensionUrl}${path}`,
        getContexts: vi.fn(async () => [{}]),
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(async (message: Record<string, unknown>) => {
          messages.push(message);
          return { ok: true, blobUrl };
        }),
      },
      offscreen: { createDocument: vi.fn(), closeDocument: vi.fn() },
      declarativeNetRequest: { updateSessionRules },
    });
    try {
      const transport = createGalleryTransport({
        requestMs: 50,
        cleanupMs: 50,
      });
      await expect(transport.prepare(validImageUrl)).resolves.toBe(blobUrl);
      expect(updateSessionRules).toHaveBeenCalledTimes(3);
      expect(removeCalls).toBe(2);
      expect(messages.map((message) => message.action)).toEqual(["prepare"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("背景 IPC timeout 後以同一 request ID 發出限時 cancel", async () => {
    const extensionId = "queuecat-test";
    const extensionUrl = `chrome-extension://${extensionId}/`;
    const messages: Array<Record<string, unknown>> = [];
    const closeDocument = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      runtime: {
        id: extensionId,
        getURL: (path: string) => `${extensionUrl}${path}`,
        getContexts: vi.fn(async () => [{}]),
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn((message: Record<string, unknown>) => {
          messages.push(message);
          if (message.action === "prepare")
            return new Promise<never>(() => undefined);
          return Promise.resolve({ ok: true, idle: true });
        }),
      },
      offscreen: { createDocument: vi.fn(), closeDocument },
      declarativeNetRequest: {
        updateSessionRules: vi.fn(async () => undefined),
      },
    });
    try {
      const transport = createGalleryTransport({ requestMs: 5, cleanupMs: 50 });
      await expect(transport.prepare(validImageUrl)).rejects.toThrow(
        "gallery_transport_timeout",
      );
      expect(messages.map((message) => message.action)).toEqual([
        "prepare",
        "cancel",
      ]);
      expect(messages[1].requestId).toBe(messages[0].requestId);
      expect(closeDocument).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("逾時取消最後一個 claim 後，晚到的 fetch 不會建立 Blob URL", async () => {
    vi.resetModules();
    const listeners: Array<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean
    > = [];
    vi.stubGlobal("chrome", {
      runtime: {
        id: "queuecat-test",
        getURL: (path: string) => `chrome-extension://queuecat-test/${path}`,
        onMessage: {
          addListener: (listener: (typeof listeners)[number]) =>
            listeners.push(listener),
        },
        sendMessage: vi.fn(async () => undefined),
      },
    });
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    try {
      await import("../src/offscreen/gallery");
      const listener = listeners[0];
      const sender = {
        id: "queuecat-test",
        url: "chrome-extension://queuecat-test/background.js",
      } as chrome.runtime.MessageSender;
      const requestId = "timed-out-request";
      const prepareResponse = new Promise<unknown>((resolve) => {
        expect(
          listener(
            {
              type: "QC_GALLERY_TRANSPORT",
              action: "prepare",
              requestId,
              url: validImageUrl,
            },
            sender,
            resolve,
          ),
        ).toBe(true);
      });
      const cancelResponse = vi.fn();
      expect(
        listener(
          {
            type: "QC_GALLERY_TRANSPORT",
            action: "cancel",
            requestId,
            url: validImageUrl,
          },
          sender,
          cancelResponse,
        ),
      ).toBe(false);
      expect(cancelResponse).toHaveBeenCalledWith({ ok: true, idle: false });

      resolveFetch(response(validWebp));
      await expect(prepareResponse).resolves.toMatchObject({
        ok: false,
        error: "gallery_request_cancelled",
        idle: true,
      });
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      createObjectURL.mockRestore();
    }
  });

  it("新 source 回收遺失交接的舊 Blob，且相同 source 仍共用 Blob", async () => {
    vi.resetModules();
    const listeners: Array<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean
    > = [];
    const extensionId = "queuecat-test";
    vi.stubGlobal("chrome", {
      runtime: {
        id: extensionId,
        getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
        onMessage: {
          addListener: (listener: (typeof listeners)[number]) =>
            listeners.push(listener),
        },
        sendMessage: vi.fn(async () => undefined),
      },
    });
    const fetcher = vi.fn(async () => response(validWebp));
    vi.stubGlobal("fetch", fetcher);
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(
        () => `blob:chrome-extension://${extensionId}/${ids.shift()}`,
      );
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    try {
      await import("../src/offscreen/gallery");
      const listener = listeners[0];
      const sender = {
        id: extensionId,
        url: `chrome-extension://${extensionId}/background.js`,
      } as chrome.runtime.MessageSender;
      const prepare = (url: string, requestId: string) =>
        new Promise<{ ok: boolean; blobUrl?: string }>((resolve) => {
          listener(
            {
              type: "QC_GALLERY_TRANSPORT",
              action: "prepare",
              requestId,
              url,
            },
            sender,
            (value) => resolve(value as { ok: boolean; blobUrl?: string }),
          );
        });
      const sourceA = validImageUrl;
      const sourceB = validImageUrl.replace("/123/45/", "/124/45/");
      const sourceC = validImageUrl.replace("/123/45/", "/125/45/");
      const blobA = (await prepare(sourceA, "source-a")).blobUrl;
      const blobB = (await prepare(sourceB, "source-b")).blobUrl;
      const sameBlobB = (await prepare(sourceB, "source-b-replay")).blobUrl;
      const blobC = (await prepare(sourceC, "source-c")).blobUrl;

      expect(blobA).not.toBe(blobB);
      expect(sameBlobB).toBe(blobB);
      expect(blobC).not.toBe(blobB);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(createObjectURL).toHaveBeenCalledTimes(3);
      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
      expect(revokeObjectURL).toHaveBeenNthCalledWith(1, blobA);
      expect(revokeObjectURL).toHaveBeenNthCalledWith(2, blobB);
    } finally {
      vi.unstubAllGlobals();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });
});
