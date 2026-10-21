import { messageLanguage } from "./messages";
import type { SupportedLanguage } from "./language";

// New ZIP and discreet-entry copy authored by Gemini 3.8 Flash, draft-only bridge requests 01/02.
export const galleryCopyEntries = {
  siteLabel: {
    en: "Gallery",
    "zh-TW": "圖庫",
    ja: "ギャラリー",
  },
  introduction: {
    en: "Leave the waiting to the cat.\nBatch paste Katfile links; QueueCat manages the queue and hands downloads to Chrome.\nCurrently a local Chrome test build requiring manual loading; full site workflows are still being verified.",
    "zh-TW":
      "把等待，交給貓貓。\n批次貼上 Katfile 網址，貓貓依序排隊、等網站放行，檔案交由 Chrome 儲存在本機。\n目前為 Chrome 本機測試版，需手動載入；完整實站流程仍在驗證中。",
    ja: "待ち時間は、猫猫におまかせ。\nKatfile のURLを一括貼り付け。猫猫が順番待ちをし、Chrome がローカルに保存します。\n現在は手動読み込みが必要な Chrome ローカルテスト版であり、実サイトでの完全な動作フローを検証中です。",
  },
  linkLabel: {
    en: "Download URL",
    "zh-TW": "下載網址",
    ja: "ダウンロード URL",
  },
  addHint: {
    en: "Paste download URLs, one per line or within a block of text.",
    "zh-TW": "貼上下載網址，每行一個；整段文字也可以。",
    ja: "ダウンロードURLを1行に1つ貼り付けてください（テキスト全文でも可）。",
  },
  addPlaceholder: {
    en: "https://katfile.biz/abcdefghijkl/example.rar.html",
    "zh-TW": "https://katfile.biz/abcdefghijkl/example.rar.html",
    ja: "https://katfile.biz/abcdefghijkl/example.rar.html",
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
    en: "Retrying verifies existing staged files and resumes unfinished pages",
    "zh-TW": "重試會核對既有暫存，並接續收集未完成頁面",
    ja: "再試行時は既存の一時ファイルを確認し、未完了ページから再開します",
  },
  resolving: {
    en: "Resolving gallery images ⸜(*ˊᗜˋ*)⸝",
    "zh-TW": "解析圖片清單中 ⸜(*ˊᗜˋ*)⸝",
    ja: "画像リストを解析中 ⸜(*ˊᗜˋ*)⸝",
  },
  folder: {
    en: "ZIP Archive",
    "zh-TW": "ZIP 壓縮檔",
    ja: "ZIP アーカイブ",
  },
  imageFormat: {
    en: "Single ZIP per album containing WebP images ordered by page number",
    "zh-TW": "一本一個 ZIP，內含依頁碼排序的 WebP 圖片",
    ja: "作品ごとに1つのZIP、ページ順のWebP画像を収録",
  },
  gallerySource: {
    en: "Open Gallery Source",
    "zh-TW": "開啟來源圖庫",
    ja: "元のギャラリーを開く",
  },
  extractionNotSupported: {
    en: "This task outputs a single ZIP; auto-extract is not supported here",
    "zh-TW": "此任務輸出為單本 ZIP，不在此自動解壓縮",
    ja: "このタスクは単一ZIPを出力するため、自動解凍は行われません",
  },
  downloadTip: {
    en: "Images are collected sequentially in the background and packaged into a ZIP once complete.",
    "zh-TW": "圖片會在背景依序收集，收齊後打包為單本 ZIP。",
    ja: "画像はバックグラウンドで順番に収集され、揃ったあとに作品ごとのZIPにまとめられます。",
  },
  collecting: {
    en: "Collecting images ฅ(・ω・)ฅ",
    "zh-TW": "正在收集圖片 ฅ(・ω・)ฅ",
    ja: "画像を収集中 ฅ(・ω・)ฅ",
  },
  packing: {
    en: "Packaging ZIP ₍ᐢ.ˬ.ᐢ₎",
    "zh-TW": "正在打包 ZIP ₍ᐢ.ˬ.ᐢ₎",
    ja: "ZIP をパッケージ中 ₍ᐢ.ˬ.ᐢ₎",
  },
  zipReady: {
    en: "ZIP ready, waiting for Chrome",
    "zh-TW": "ZIP 已備妥，等候 Chrome 存檔",
    ja: "ZIP 準備完了、Chrome の保存待機中",
  },
  zipSaving: {
    en: "Chrome is saving ZIP ✨",
    "zh-TW": "Chrome 正在儲存 ZIP ✨",
    ja: "Chrome で ZIP を保存中 ✨",
  },
  zipComplete: {
    en: "ZIP download complete ✨",
    "zh-TW": "ZIP 下載完成 ✨",
    ja: "ZIP ダウンロード完了 ✨",
  },
  stagedProgress: {
    en: "{done} / {total} pages staged",
    "zh-TW": "已暫存 {done} / {total} 頁",
    ja: "{done} / {total} ページ一時保存済み",
  },
  zipLimit: {
    en: "Exceeds 2GiB limit or insufficient storage space",
    "zh-TW": "超過 2GiB 限制或儲存空間不足",
    ja: "2GiB 制限超過または空き容量不足",
  },
  stagingMissing: {
    en: "Staged files missing or unverified; needs recollection",
    "zh-TW": "暫存遺失或無法核對，需重新收集圖片",
    ja: "一時ファイルが見つからないか確認できないため、再収集が必要です",
  },
  legacyFormat: {
    en: "This legacy task saves as separate images; re-add to create a ZIP",
    "zh-TW": "此舊任務仍按單張圖片存檔；重新加入可建立 ZIP",
    ja: "この古いタスクは単体画像として保存されます。再追加すると ZIP になります",
  },
} as const satisfies Record<string, Record<SupportedLanguage, string>>;

export type GalleryCopyKey = keyof typeof galleryCopyEntries;

export function galleryCopy(
  key: GalleryCopyKey,
  language: SupportedLanguage = messageLanguage(),
): string {
  return galleryCopyEntries[key][language];
}
