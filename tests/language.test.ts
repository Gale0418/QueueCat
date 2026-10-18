import { describe, expect, it } from "vitest";
import { QueueEngine, type EnginePorts } from "../src/background/engine";
import {
  currentLanguage,
  normalizeLanguagePreference,
  resolveLanguage,
} from "../src/shared/language";
import { initialState, STORAGE_KEY, type AppState } from "../src/shared/types";

describe("language resolution", () => {
  it("honors a valid manual preference", () => {
    expect(resolveLanguage("ja", ["zh-TW", "en-US"])).toBe("ja");
  });

  it("uses the first supported system locale in browser order", () => {
    expect(resolveLanguage("system", ["fr-FR", "zh-CN", "ja-JP"])).toBe(
      "zh-TW",
    );
    expect(resolveLanguage("system", ["fr-FR", "ja-JP", "en-US"])).toBe(
      "ja",
    );
    expect(resolveLanguage("system", ["fr-FR", "en-GB", "ja-JP"])).toBe(
      "en",
    );
  });

  it("maps supported language families and falls back to English", () => {
    expect(resolveLanguage("system", ["zh-Hant-HK"])).toBe("zh-TW");
    expect(resolveLanguage("system", ["ja-JP"])).toBe("ja");
    expect(resolveLanguage("system", ["fr-FR", "de-DE"])).toBe("en");
    expect(resolveLanguage("system", [])).toBe("en");
  });

  it("normalizes invalid and legacy preferences back to system", () => {
    expect(normalizeLanguagePreference("auto")).toBe("system");
    expect(normalizeLanguagePreference(null)).toBe("system");
    expect(resolveLanguage("legacy", ["ja-JP"])).toBe("ja");
  });

  it("resolves explicit current preference without reading browser globals", () => {
    expect(currentLanguage("zh-TW")).toBe("zh-TW");
  });
});

function memoryEngine(seed: unknown) {
  let stored = seed;
  const ports = {
    storage: {
      async get() {
        return stored;
      },
      async set(value: Record<string, unknown>) {
        stored = value[STORAGE_KEY];
      },
    },
    tabs: {},
    downloads: {},
    alarms: {
      async create() {},
      async clear() {},
    },
    async notify() {},
    async setBadge() {},
    getUrl: (path: string) => `chrome-extension://test/${path}`,
    now: () => 1_800_000_000_000,
    extensionId: "test",
  } as unknown as EnginePorts;
  return {
    engine: new QueueEngine(ports),
    read: () => stored as AppState,
  };
}

describe("language settings persistence", () => {
  it("migrates missing and invalid stored values to system and persists it", async () => {
    const missing = initialState();
    delete (missing.settings as Partial<typeof missing.settings>).language;
    const legacy = memoryEngine(missing);
    const restored = await legacy.engine.getState();
    expect(restored.settings.language).toBe("system");
    await legacy.engine.command({ kind: "settings", settings: { theme: "dark" } });
    expect(legacy.read().settings.language).toBe("system");

    const invalid = initialState();
    (invalid.settings as { language: unknown }).language = "auto";
    const invalidFixture = memoryEngine(invalid);
    expect((await invalidFixture.engine.getState()).settings.language).toBe(
      "system",
    );
    await invalidFixture.engine.command({
      kind: "settings",
      settings: { theme: "dark" },
    });
    expect(invalidFixture.read().settings.language).toBe("system");
  });

  it("saves a valid preference and rejects an invalid command value", async () => {
    const fixture = memoryEngine(initialState());
    await fixture.engine.command({ kind: "settings", settings: { language: "ja" } });
    expect(fixture.read().settings.language).toBe("ja");

    const response = await fixture.engine.handleRequest({
      type: "QC_COMMAND",
      command: {
        kind: "settings",
        settings: { language: "fr" },
      } as unknown as { kind: "settings"; settings: Partial<AppState["settings"]> },
    });
    expect(response.ok).toBe(false);
    expect(fixture.read().settings.language).toBe("ja");
  });
});
