import { messageLanguage } from "./messages";
import type { SupportedLanguage } from "./language";

export const galleryCopyEntries = {
  siteLabel: {
    en: "Hitomi Gallery",
    "zh-TW": "Hitomi 圖庫",
    ja: "Hitomi ギャラリー",
  },
  introduction: {
    en: "Supports Katfile free downloads and Hitomi single galleries.\nQueueCat manages the queue while Chrome saves files locally.\nCurrently a local Chrome test build requiring manual loading; full site workflows are still being verified.",
    "zh-TW":
      "支援 Katfile 免費檔案與 Hitomi 單本圖庫。\n貓貓替你排隊等候，檔案交由 Chrome 儲存在本機。\n目前為 Chrome 本機測試版，需手動載入；完整實站流程仍在驗證中。",
    ja: "Katfile 無料ダウンロードおよび Hitomi 単体ギャラリーに対応。\n猫猫が順番待ちを管理し、Chrome がローカルに保存します。\n現在は手動読み込みが必要な Chrome ローカルテスト版であり、実サイトでの完全な動作フローを検証中です。",
  },
  linkLabel: {
    en: "Katfile or Hitomi URL",
    "zh-TW": "Katfile 或 Hitomi 下載網址",
    ja: "Katfile または Hitomi ダウンロード URL",
  },
  addHint: {
    en: "Supports Katfile download links or Hitomi single gallery URLs",
    "zh-TW": "支援 Katfile 檔案或 Hitomi 單本圖庫網址",
    ja: "Katfile ファイルまたは Hitomi 単体ギャラリーの URL に対応",
  },
  addPlaceholder: {
    en: "https://katfile.com/123456789abc/sample-archive.zip\nhttps://hitomi.la/reader/1234567.html",
    "zh-TW":
      "https://katfile.com/123456789abc/sample-archive.zip\nhttps://hitomi.la/reader/1234567.html",
    ja: "https://katfile.com/123456789abc/sample-archive.zip\nhttps://hitomi.la/reader/1234567.html",
  },
  album: {
    en: "Gallery Album",
    "zh-TW": "單本圖庫",
    ja: "単体ギャラリー",
  },
  reading: {
    en: "Reading gallery index ฅ(・ω・)ฅ",
    "zh-TW": "讀取圖庫清單 ฅ(・ω・)ฅ",
    ja: "作品リストを読み込み中 ฅ(・ω・)ฅ",
  },
  waitingPage: {
    en: "Waiting for next page ฅ(－ω－)ฅ",
    "zh-TW": "等待下一頁下載 ฅ(－ω－)ฅ",
    ja: "次ページ待機中 ฅ(－ω－)ฅ",
  },
  progress: {
    en: "{done} / {total} pages",
    "zh-TW": "{done} / {total} 頁",
    ja: "{done} / {total} ページ",
  },
  // Authored by Gemini 3.8 Flash; integrated after the frozen review wave.
  unknownProgress: {
    en: "Pages completed: {done}; total not yet available",
    "zh-TW": "已完成 {done} 頁；總頁數未取得",
    ja: "{done} ページ完了（総ページ数未取得）",
  },
  complete: {
    en: "Gallery download complete ✨",
    "zh-TW": "圖庫下載完成 ✨",
    ja: "ギャラリーのダウンロード完了 ✨",
  },
  failed: {
    en: "Gallery download failed ₍ᐢ.ˬ.ᐢ₎",
    "zh-TW": "圖庫下載失敗 ₍ᐢ.ˬ.ᐢ₎",
    ja: "ギャラリーのダウンロード失敗 ₍ᐢ.ˬ.ᐢ₎",
  },
  unavailable: {
    en: "Gallery unavailable or removed",
    "zh-TW": "圖庫不存在或已失效",
    ja: "作品が見つからないか削除されています",
  },
  invalidGallery: {
    en: "Invalid or unsupported gallery link",
    "zh-TW": "無效或不支援的圖庫連結",
    ja: "無効または未対応のギャラリーリンクです",
  },
  metadataChanged: {
    en: "Source content or title changed; please remove this item and add it again (downloaded files will be kept)",
    "zh-TW":
      "來源內容或標題已變更，請移除這筆紀錄後重新加入；已下載的檔案會保留。",
    ja: "ソースの内容またはタイトルが変更されました。この項目を削除して再度追加してください（ダウンロード済みのファイルは保持されます）",
  },
  handoffUncertain: {
    en: "Download handoff uncertain and will not automatically resend; please check Chrome download history to avoid duplicates",
    "zh-TW":
      "下載交接狀態不明，系統不會自動重送；請先核對 Chrome 下載紀錄避免重複下載。",
    ja: "ダウンロードの引き継ぎ状態が不明です。自動で再送信はされません。重複を避けるため Chrome のダウンロード履歴をご確認ください",
  },
  forgetUncertain: {
    en: "Remove Record & Pause",
    "zh-TW": "移除紀錄並暫停",
    ja: "記録を削除して一時停止",
  },
  forgetUncertainConfirm: {
    en: "Chrome may have already started downloading. Are you sure you want to remove this QueueCat record and pause the queue? Existing files are kept; downloads will not be resent or canceled. Please check Chrome download history before resuming the queue.",
    "zh-TW":
      "Chrome 可能已經開始下載。確定移除此筆 QueueCat 紀錄並暫停排隊嗎？原檔保留，不會重送或取消下載。繼續排隊前請先核對 Chrome 下載紀錄。",
    ja: "Chrome 側ですでにダウンロードが開始されている可能性があります。この QueueCat の記録を削除し、キューを一時停止しますか？ファイルは保持され、再送信やキャンセルは行われません。キューを再開する前に Chrome のダウンロード履歴をご確認ください。",
  },
  missingDownload: {
    en: "Download item or image missing",
    "zh-TW": "找不到下載項目或圖片檔案",
    ja: "ダウンロード項目または画像ファイルが見つかりません",
  },
  invalidMetadata: {
    en: "Unable to parse gallery metadata",
    "zh-TW": "無法解析圖庫中繼資料",
    ja: "作品メタデータを解析できません",
  },
  requestFailed: {
    en: "Network request failed. Please retry later (completed pages are kept)",
    "zh-TW": "網路請求失敗，請稍後按重試（已完成頁面會保留）",
    ja: "ネットワーク接続に失敗しました。後ほど再試行してください（完了したページは保持されます）",
  },
  retryTip: {
    en: "Retrying resumes from unfinished pages while keeping completed ones",
    "zh-TW": "重試時會從未完成的頁面繼續下載，保留已完成的頁面",
    ja: "再試行時は完了したページを保持し、未完了のページから再開します",
  },
  resolving: {
    en: "Resolving gallery images ⸜(*ˊᗜˋ*)⸝",
    "zh-TW": "解析圖片清單中 ⸜(*ˊᗜˋ*)⸝",
    ja: "画像リストを解析中 ⸜(*ˊᗜˋ*)⸝",
  },
  folder: {
    en: "Gallery Folder",
    "zh-TW": "圖庫資料夾",
    ja: "ギャラリーフォルダ",
  },
  imageFormat: {
    en: "Saved into a dedicated folder per gallery with WebP images ordered by page number",
    "zh-TW": "每本圖庫獨立資料夾，圖片依頁碼儲存為 WebP",
    ja: "作品ごとに個別フォルダへ保存され、画像はページ順の WebP 形式になります",
  },
  gallerySource: {
    en: "Open Gallery Source",
    "zh-TW": "開啟來源圖庫",
    ja: "元のギャラリーを開く",
  },
  extractionNotSupported: {
    en: "Auto-extract not supported for image galleries",
    "zh-TW": "圖庫為純圖片下載，不支援自動解壓",
    ja: "画像ギャラリーのため自動解凍には非対応です",
  },
  downloadTip: {
    en: "Images are fetched sequentially in the background; please respect site limits.",
    "zh-TW": "圖片會在背景依序下載；請遵守網站使用限制。",
    ja: "画像はバックグラウンドで順番にダウンロードされます。サイトの利用制限にご配慮ください。",
  },
} as const satisfies Record<string, Record<SupportedLanguage, string>>;

export type GalleryCopyKey = keyof typeof galleryCopyEntries;

export function galleryCopy(
  key: GalleryCopyKey,
  language: SupportedLanguage = messageLanguage(),
): string {
  return galleryCopyEntries[key][language];
}
