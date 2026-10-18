import { messageLanguage, translateMessage } from "../shared/messages";

const originals = new WeakMap<Node, { source: string; rendered: string }>();
const attributes = new WeakMap<
  Element,
  Map<string, { source: string; rendered: string }>
>();

/** 僅處理本程式產生的介面。所有檔名、網址等外部資料必須以 data-raw 標記。 */
export function translateInterface(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest("[data-raw], script, style, textarea"))
      continue;
    const previous = originals.get(node);
    const source =
      previous?.rendered === node.data ? previous.source : node.data;
    const rendered = translateMessage(source);
    if (rendered !== node.data) node.data = rendered;
    originals.set(node, { source, rendered });
  }
  for (const element of [
    root,
    ...root.querySelectorAll("[aria-label], [title], [alt], [placeholder]"),
  ]) {
    if (element.closest("[data-raw]")) continue;
    const saved = attributes.get(element) ?? new Map();
    for (const name of ["aria-label", "title", "alt", "placeholder"]) {
      const value = element.getAttribute(name);
      if (value === null) continue;
      const previous = saved.get(name);
      const source = previous?.rendered === value ? previous.source : value;
      const rendered = translateMessage(source);
      if (rendered !== value) element.setAttribute(name, rendered);
      saved.set(name, { source, rendered });
    }
    attributes.set(element, saved);
  }
}

const markups = new WeakMap<Element, { source: string; locale: string }>();
export function hasSameMarkup(element: Element, source: string) {
  const saved = markups.get(element);
  return saved?.source === source && saved.locale === messageLanguage();
}
export function rememberMarkup(element: Element, source: string) {
  markups.set(element, { source, locale: messageLanguage() });
}
