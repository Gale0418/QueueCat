// Product copy authored by Gemini through the local Antigravity bridge; see MissionCenter/extraction-20261018.md.
import { messageLanguage } from "./messages";
import type { SupportedLanguage } from "./language";

export const extractionCopyEntries = {
  expiredPasswordHint: {
    en: "Password cleared; leave blank for unencrypted archives",
    "zh-TW": "密碼已清除；若檔案無密碼可留白",
    ja: "パスワードが削除されました。暗号化されていない場合は空欄にしてください",
  },
  passwordExpired: {
    en: "Password expired (stored up to 7 days). Re-enter password to retry (no re-download).",
    "zh-TW":
      "密碼已過期（最長保存 7 天），請重新輸入密碼後重試（不重新下載）。",
    ja: "パスワードの保存期間（7日間）が切れました。パスワードを再入力して再試行してください（再DLなし）。",
  },
  removeCancelsExtraction: {
    en: "Remove from history (cancel extraction, keep files)",
    "zh-TW": "移除紀錄（取消解壓，保留檔案）",
    ja: "履歴から削除（解凍をキャンセル・ファイル保持）",
  },
  enable: { en: "Auto Extract", "zh-TW": "自動解壓縮", ja: "自動解凍" },
  label: {
    en: "Auto-extract after download",
    "zh-TW": "完成後自動解壓",
    ja: "ダウンロード後自動解凍",
  },
  passwordLabel: {
    en: "Archive Password",
    "zh-TW": "壓縮密碼",
    ja: "解凍パスワード",
  },
  passwordHint: {
    en: "Applies to batch, not saved in history",
    "zh-TW": "同批次適用，不上紀錄",
    ja: "一括適用・履歴に残りません",
  },
  waiting: {
    en: "Waiting for volumes ฅ(－ω－)ฅ",
    "zh-TW": "等待分卷到齊 ฅ(－ω－)ฅ",
    ja: "分割ファイル待ち ฅ(－ω－)ฅ",
  },
  queued: {
    en: "Queued for extraction",
    "zh-TW": "排隊解壓中",
    ja: "解凍待機中",
  },
  extracting: {
    en: "Extracting ⸜(*ˊᗜˋ*)⸝",
    "zh-TW": "正在解壓縮 ⸜(*ˊᗜˋ*)⸝",
    ja: "解凍中 ⸜(*ˊᗜˋ*)⸝",
  },
  complete: { en: "Extracted ✨", "zh-TW": "解壓完成 ✨", ja: "解凍完了 ✨" },
  failed: {
    en: "Extraction failed ₍ᐢ.ˬ.ᐢ₎",
    "zh-TW": "解壓失敗 ₍ᐢ.ˬ.ᐢ₎",
    ja: "解凍失敗 ₍ᐢ.ˬ.ᐢ₎",
  },
  output: {
    en: "Extracted Folder",
    "zh-TW": "解壓資料夾",
    ja: "解凍先フォルダ",
  },
  helperMissing: {
    en: "Helper not installed (downloads unaffected)",
    "zh-TW": "未安裝小幫手（不影響下載）",
    ja: "ヘルパー未導入（DLに影響なし）",
  },
  engineMissing: {
    en: "Extraction engine not found",
    "zh-TW": "找不到解壓引擎",
    ja: "解凍エンジンが見つかりません",
  },
  missingVolumes: {
    en: "Missing volumes, please complete the set",
    "zh-TW": "分卷不全，請補齊最後一卷",
    ja: "分割ファイル不足（最終巻を確認してください）",
  },
  wrongPassword: {
    en: "Wrong password or damaged archive",
    "zh-TW": "密碼錯誤或檔案損壞",
    ja: "パスワード間違いまたは破損",
  },
  unsafeArchive: {
    en: "Unsafe path rejected",
    "zh-TW": "路徑不安全，已拒絕解壓",
    ja: "安全でないパスを拒否しました",
  },
  extractionFailed: {
    en: "Extraction failed. Check files and retry without re-downloading",
    "zh-TW": "解壓失敗，檢查檔案後可重試（不重新下載）",
    ja: "解凍失敗。ファイルを確認して再試行（再DLなし）",
  },
  sourceUnavailable: {
    en: "Source archive unavailable",
    "zh-TW": "找不到完整來源檔",
    ja: "ソースファイルが見つかりません",
  },
  invalidArchive: {
    en: "Unsupported archive or split format",
    "zh-TW": "不支援的壓縮或分卷格式",
    ja: "サポートされていない圧縮または分割形式",
  },
  unknownJob: {
    en: "Unable to verify extraction job, please check",
    "zh-TW": "無法核對解壓工作，請檢查",
    ja: "解凍ジョブを確認できません",
  },
  retry: { en: "Retry Extraction", "zh-TW": "重新解壓", ja: "再解凍" },
  retryPassword: {
    en: "Change password (leave blank to keep)",
    "zh-TW": "更換解壓密碼（可留白沿用）",
    ja: "パスワード変更（空欄で維持）",
  },
  retryPasswordHint: {
    en: "Leave blank to use saved password",
    "zh-TW": "留白則沿用已儲存密碼",
    ja: "空欄の場合は保存されたパスワードを使用",
  },
  helperSetup: {
    en: "Setup Guide",
    "zh-TW": "安裝說明",
    ja: "セットアップ手順",
  },
  helperDescription: {
    en: "Official portable engine, no extra software needed; original files kept, not overwritten or auto-executed.",
    "zh-TW": "內建官方可攜引擎，免裝解壓軟體；原檔保留，不覆蓋、不自動執行。",
    ja: "公式ポータブルエンジン内蔵（追加ソフト不要）。元ファイル保持・上書きなし・自動実行なし。",
  },
  setupInstruction: {
    en: "Run the helper installer and enter this Extension ID",
    "zh-TW": "執行小幫手安裝程式並填入這個外掛 ID",
    ja: "ヘルパーインストーラーを実行し、この拡張機能 ID を入力してください",
  },
  checkHelper: {
    en: "Check Helper",
    "zh-TW": "檢查小幫手",
    ja: "ヘルパーを確認",
  },
  helperReady: {
    en: "Helper ready ✨",
    "zh-TW": "小幫手就緒 ✨",
    ja: "ヘルパー準備完了 ✨",
  },
  helperNotChecked: {
    en: "Helper not checked yet",
    "zh-TW": "尚未檢查小幫手",
    ja: "ヘルパー未確認",
  },
  helperCheckFailed: {
    en: "Helper not ready ₍ᐢ.ˬ.ᐢ₎",
    "zh-TW": "小幫手尚未就緒 ₍ᐢ.ˬ.ᐢ₎",
    ja: "ヘルパーの準備ができていません ₍ᐢ.ˬ.ᐢ₎",
  },
  extensionId: { en: "Extension ID", "zh-TW": "外掛 ID", ja: "拡張機能 ID" },
} as const satisfies Record<string, Record<SupportedLanguage, string>>;

export type ExtractionCopyKey = keyof typeof extractionCopyEntries;

export function extractionCopy(
  key: ExtractionCopyKey,
  locale: SupportedLanguage = messageLanguage(),
): string {
  return extractionCopyEntries[key][locale];
}
