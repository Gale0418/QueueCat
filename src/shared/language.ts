export type LanguagePreference = "system" | "en" | "zh-TW" | "ja";
export type SupportedLanguage = Exclude<LanguagePreference, "system">;

const preferences: readonly LanguagePreference[] = [
  "system",
  "en",
  "zh-TW",
  "ja",
];

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return preferences.includes(value as LanguagePreference);
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return isLanguagePreference(value) ? value : "system";
}

function supportedLanguage(tag: string): SupportedLanguage | undefined {
  const normalized = tag.trim().toLowerCase();
  if (/^en(?:-|$)/.test(normalized)) return "en";
  if (/^zh(?:-|$)/.test(normalized)) return "zh-TW";
  if (/^ja(?:-|$)/.test(normalized)) return "ja";
  return undefined;
}

export function resolveLanguage(
  preference: unknown,
  languages: readonly string[],
): SupportedLanguage {
  const normalized = normalizeLanguagePreference(preference);
  if (normalized !== "system") return normalized;
  for (const tag of languages) {
    const supported = supportedLanguage(tag);
    if (supported) return supported;
  }
  return "en";
}

export function currentLanguage(preference: unknown): SupportedLanguage {
  const normalized = normalizeLanguagePreference(preference);
  if (normalized !== "system") return normalized;

  if (typeof navigator !== "undefined") {
    const languages = Array.isArray(navigator.languages)
      ? [...navigator.languages]
      : [];
    if (navigator.language && !languages.includes(navigator.language))
      languages.push(navigator.language);
    return resolveLanguage(normalized, languages);
  }

  try {
    if (typeof chrome !== "undefined") {
      const uiLanguage = chrome.i18n?.getUILanguage?.();
      if (uiLanguage) return resolveLanguage(normalized, [uiLanguage]);
    }
  } catch {
    // Chrome APIs can be unavailable during startup or outside an extension.
  }
  return "en";
}
