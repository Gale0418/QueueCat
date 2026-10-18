import { describe, expect, it } from "vitest";
import { createTranslator } from "../src/shared/messages";
import type { CopyEntry } from "../src/shared/copy";

const entries: CopyEntry[] = [
  { id: "test-static", source: "測試", en: "Test", zhTW: "測試", ja: "テスト" },
  {
    id: "test-param",
    source: "測試（{value}）",
    en: "Test ({value})",
    zhTW: "測試（{value}）",
    ja: "テスト（{value}）",
  },
];
describe("product message translation", () => {
  const translate = createTranslator(entries);
  it("selects the requested catalog and retains surrounding spacing", () => {
    expect(translate(" 測試 ", "en")).toBe(" Test ");
    expect(translate("測試", "ja")).toBe("テスト");
  });
  it("keeps placeholder values verbatim without recursively translating external data", () => {
    expect(translate("測試（測試）", "en")).toBe("Test (測試)");
    expect(translate("測試（<script>literal</script>）", "ja")).toBe(
      "テスト（<script>literal</script>）",
    );
  });
  it("keeps unknown website text, paths and messages unchanged", () => {
    for (const source of [
      "website message",
      "網站原文",
      "C:/Downloads/測試.zip",
      "https://katfile.biz/abcdefghijkl/測試.rar.html",
    ])
      expect(translate(source, "en")).toBe(source);
  });
});
