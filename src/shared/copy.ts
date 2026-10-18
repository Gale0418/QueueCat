// 原始文案由 Antigravity / Gemini 維護；此層只對應既有介面的訊息來源。
import { en, ja, zhTW } from "./locales";
import type { LocaleMessages } from "./locales/types";
import type { SupportedLanguage } from "./language";
export interface CopyEntry {
  id: string;
  source: string;
  en: string;
  zhTW: string;
  ja: string;
  render?: (
    values: Record<string, string>,
    language: SupportedLanguage,
  ) => string;
}
type CopyFunction = (...values: (string | number)[]) => string;
const catalogs = { en, ja, "zh-TW": zhTW };
const keys = Object.keys(zhTW) as (keyof LocaleMessages)[];
const entries: CopyEntry[] = keys.map((key) => {
  const source = zhTW[key];
  if (typeof source === "string")
    return {
      id: key,
      source,
      en: en[key] as string,
      zhTW: source,
      ja: ja[key] as string,
    };
  const params = Array.from({ length: source.length }, (_, i) => `{p${i}}`);
  const call = (language: SupportedLanguage, args: (string | number)[]) =>
    (catalogs[language][key] as unknown as CopyFunction)(...args);
  return {
    id: key,
    source: call("zh-TW", params),
    en: call("en", params),
    zhTW: call("zh-TW", params),
    ja: call("ja", params),
    render: (values, language) =>
      call(
        language,
        params.map((_, index) => {
          const value = values[`p${index}`];
          return key !== "mascotAlt" && /^\d+$/.test(value)
            ? Number(value)
            : value;
        }),
      ),
  };
});
const aliases: Record<string, keyof LocaleMessages> = {
  這是最後一筆囉: "lastFileNotice",
  語言: "languageLabel",
  "預設跟隨瀏覽器；未支援的語言使用英文。": "languageHint",
  跟隨瀏覽器: "optLangSystem",
  繁體中文: "optLangZhTW",
  "有個地方，需要你看一下": "summaryBlockedTitle",
};
for (const [source, key] of Object.entries(aliases)) {
  const entry = entries.find((entry) => entry.id === key)!;
  entries.push({ ...entry, id: `${key}-legacy`, source });
}
export const copyEntries: readonly CopyEntry[] = entries;
