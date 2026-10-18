import type { SupportedLanguage } from "../language";
import type { ItemStatus } from "../types";
import { en } from "./en";
import { ja } from "./ja";
import { zhTW } from "./zh-TW";
import type { LocaleMessages, StatusLabels } from "./types";
import { translateKnownText } from "./known-text";

export * from "./types";
export { translateKnownText } from "./known-text";

const CATALOGS: Record<SupportedLanguage, LocaleMessages> = {
  en,
  "zh-TW": zhTW,
  ja,
};

export function getLocale(lang: SupportedLanguage = "en"): LocaleMessages {
  return CATALOGS[lang] || CATALOGS.en;
}

export function getStatusLabels(lang: SupportedLanguage = "en"): StatusLabels {
  const loc = getLocale(lang);
  return {
    queued: loc.statusQueued,
    preparing: loc.statusPreparing,
    waiting: loc.statusWaiting,
    verification: loc.statusVerification,
    handoff: loc.statusHandoff,
    downloading: loc.statusDownloading,
    blocked: loc.statusBlocked,
    failed: loc.statusFailed,
    complete: loc.statusComplete,
  };
}

export { en, ja, zhTW };
