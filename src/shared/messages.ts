import { copyEntries, type CopyEntry } from "./copy";
import { currentLanguage, type SupportedLanguage } from "./language";
import { translateKnownText } from "./locales/known-text";

const escapePattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const field = (language: SupportedLanguage) =>
  language === "zh-TW" ? "zhTW" : language;

/** 只辨識既知的產品訊息；模板中的檔名、網站原文與錯誤代碼不遞迴翻譯。 */
export function createTranslator(entries: readonly CopyEntry[]) {
  const exact = new Map(entries.map((entry) => [entry.source, entry]));
  const patterns = entries
    .filter((entry) => /\{\w+\}/.test(entry.source))
    .map((entry) => {
      const names: string[] = [];
      let cursor = 0,
        pattern = "^";
      for (const match of entry.source.matchAll(/\{(\w+)\}/g)) {
        pattern +=
          escapePattern(entry.source.slice(cursor, match.index)) +
          "([\\s\\S]*?)";
        names.push(match[1]);
        cursor = match.index! + match[0].length;
      }
      return {
        entry,
        names,
        pattern: new RegExp(
          pattern + escapePattern(entry.source.slice(cursor)) + "$",
        ),
      };
    });
  return (source: string, language: SupportedLanguage): string => {
    const trimmed = source.trim();
    const direct = exact.get(trimmed);
    let translated = direct?.[field(language)];
    if (translated === undefined) {
      for (const { entry, names, pattern } of patterns) {
        const match = pattern.exec(trimmed);
        if (!match) continue;
        const values = Object.fromEntries(
          names.map((name, index) => [name, match[index + 1]]),
        );
        translated = entry.render
          ? entry.render(values, language)
          : entry[field(language)].replace(
              /\{(\w+)\}/g,
              (token, name) => values[name] ?? token,
            );
        break;
      }
    }
    if (translated === undefined) return source;
    return (
      source.slice(0, source.indexOf(trimmed)) +
      translated +
      source.slice(source.indexOf(trimmed) + trimmed.length)
    );
  };
}

let language = currentLanguage("system");
const translate = createTranslator(copyEntries);
export function messageLanguage() {
  return language;
}
export function setMessageLanguage(preference: unknown) {
  const next = currentLanguage(preference);
  const changed = next !== language;
  language = next;
  return changed;
}
export function translateMessage(source: string, locale = language): string {
  const result = translate(source, locale);
  return result === source ? translateKnownText(source, locale) : result;
}
