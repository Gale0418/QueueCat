import type { SupportedLanguage } from "../shared/language";
import { getLocale } from "../shared/locales";

/** 可公開複製的固定介紹；不接收佇列或使用者資料。 */
export function getTagline(lang: SupportedLanguage = "zh-TW"): string {
  return getLocale(lang).tagline;
}

export function getIntroduction(lang: SupportedLanguage = "zh-TW"): string {
  return getLocale(lang).introduction;
}

export const tagline = getTagline("zh-TW");
export const introduction = getIntroduction("zh-TW");
