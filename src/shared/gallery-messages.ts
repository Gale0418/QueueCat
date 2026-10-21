import { galleryCopy } from "./gallery-copy";
import type { SupportedLanguage } from "./language";
import { messageLanguage, translateMessage } from "./messages";

const reasonKeys: Record<string, Parameters<typeof galleryCopy>[0]> = {
  gallery_unavailable: "unavailable",
  gallery_invalid_metadata: "invalidMetadata",
  gallery_invalid_routing: "invalidMetadata",
  galleryUnavailable: "unavailable",
  gallery_not_found: "unavailable",
  invalid_gallery: "invalidGallery",
  invalidGallery: "invalidGallery",
  gallery_metadata_changed: "metadataChanged",
  metadata_changed: "metadataChanged",
  metadataChanged: "metadataChanged",
  gallery_handoff_uncertain: "handoffUncertain",
  handoff_uncertain: "handoffUncertain",
  handoffUncertain: "handoffUncertain",
  gallery_missing_download: "missingDownload",
  missing_download: "missingDownload",
  invalid_gallery_metadata: "invalidMetadata",
  invalid_metadata: "invalidMetadata",
  gallery_request_failed: "requestFailed",
  request_failed: "requestFailed",
  圖庫不存在或已失效: "unavailable",
  無效或不支援的圖庫連結: "invalidGallery",
  圖庫資訊已變更: "metadataChanged",
  "圖庫資訊已變更，請重新核對": "metadataChanged",
  下載交接狀態不明: "handoffUncertain",
  "下載交接狀態不明，請先核對 Chrome 下載紀錄避免重複下載": "handoffUncertain",
  找不到下載項目或圖片檔案: "missingDownload",
  無法解析圖庫中繼資料: "invalidMetadata",
  網路請求失敗: "requestFailed",
};

export function translateGalleryMessage(
  raw: string,
  language?: SupportedLanguage,
): string {
  if (raw.startsWith("已暫停："))
    return translateGalleryMessage(raw.slice(4), language);
  const direct = reasonKeys[raw];
  if (direct) return galleryCopy(direct, language);
  if (raw.startsWith("Hitomi 圖庫識別碼無效"))
    return galleryCopy("invalidGallery", language);
  if (raw.startsWith("Hitomi 圖庫下載服務尚未就緒"))
    return galleryCopy("requestFailed", language);
  if (raw.startsWith("無法讀取 Hitomi 圖庫"))
    return galleryCopy("requestFailed", language);
  if (raw.startsWith("無法取得第 ") && raw.includes(" 張圖片網址"))
    return galleryCopy("requestFailed", language);
  if (
    raw.startsWith("Hitomi 圖庫資料無效") ||
    raw.startsWith("缺少已下載圖庫頁面的核對快照") ||
    raw.startsWith("Hitomi 圖庫清單過大")
  )
    return galleryCopy("invalidMetadata", language);
  if (raw.startsWith("Hitomi 圖庫內容或標題已變更"))
    return galleryCopy("metadataChanged", language);
  if (
    raw.startsWith("Chrome 圖庫下載交接結果不明") ||
    raw.startsWith("圖庫圖片 Chrome 交接結果未知") ||
    raw.startsWith("已找到交接中的圖庫圖片下載") ||
    raw.startsWith("找到多筆可能的圖庫圖片下載")
  )
    return galleryCopy("handoffUncertain", language);
  if (
    raw.startsWith("Hitomi 圖庫圖片清單遺失") ||
    raw.startsWith("Chrome 找不到已保存的圖庫圖片下載紀錄") ||
    raw.startsWith("圖庫進度與圖片清單不一致") ||
    raw.startsWith("圖庫圖片交接記錄不完整")
  )
    return galleryCopy("missingDownload", language);
  if (raw.startsWith("Hitomi 圖片網址未通過 HTTPS 網域與 hash 檢查"))
    return galleryCopy("invalidGallery", language);
  if (raw.startsWith("Chrome 安全性阻擋："))
    return galleryCopy("failed", language);
  if (raw.startsWith("圖庫下載失敗：")) return galleryCopy("failed", language);
  if (raw.startsWith("已讀取圖庫「")) return galleryCopy("reading", language);
  if (raw === "圖庫全部下載完成") return galleryCopy("complete", language);
  if (
    raw.startsWith("已保存第 ") &&
    raw.includes(" 張圖片交接，交由 Chrome 下載")
  )
    return galleryCopy("waitingPage", language);
  if (
    raw.startsWith("Chrome 已接手圖庫圖片下載 #") ||
    raw.startsWith("已核對圖庫圖片 Chrome 下載 #")
  )
    return galleryCopy("resolving", language);
  if (/^第 \d+ 張圖片完成$/.test(raw))
    return galleryCopy("waitingPage", language);
  if (
    raw.startsWith("Chrome 圖庫圖片下載中斷") ||
    raw.startsWith("Chrome 明確中止圖庫圖片下載")
  )
    return galleryCopy("failed", language);
  return translateMessage(raw, language ?? messageLanguage());
}
