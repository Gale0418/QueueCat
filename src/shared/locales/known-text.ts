import type { SupportedLanguage } from "../language";

const EXACT_TRANSLATIONS: Record<string, Record<"en" | "ja", string>> = {
  // Engine events & state messages
  "已加入佇列": {
    en: "Added to queue",
    ja: "キューに追加されました",
  },
  "已重新排入佇列": {
    en: "Re-queued",
    ja: "キューに再追加されました",
  },
  "已重新核對": {
    en: "Re-checked",
    ja: "再照合しました",
  },
  "正在準備來源分頁": {
    en: "Preparing source tab",
    ja: "元のタブを準備中",
  },
  "下載完成": {
    en: "Download complete",
    ja: "ダウンロード完了",
  },
  "已通知需要完成網站驗證": {
    en: "Notified that site verification is needed",
    ja: "サイト認証が必要であることを通知しました",
  },
  "需要完成網站驗證": {
    en: "Site verification needed",
    ja: "サイトの認証が必要です",
  },
  "頁面狀態尚未辨識（等待判定）": {
    en: "Page state not yet recognized (waiting for assessment)",
    ja: "ページ状態が未判定です（判定待機中）",
  },
  "已保存交接動作，交由 Chrome 下載": {
    en: "Handoff saved; handed over to Chrome for download",
    ja: "引継ぎアクションを保存し、Chrome にダウンロードを引き渡しました",
  },
  "等待結束，繼續觀察來源頁": {
    en: "Cooldown ended; resuming observation of source page",
    ja: "待機が終了しました。元のページの監視を再開します",
  },
  "Chrome 正在下載其他 Katfile 檔案，完成後繼續": {
    en: "Chrome is downloading another Katfile file; will continue after completion",
    ja: "Chrome が他の Katfile ファイルをダウンロード中です。完了後に再開します",
  },
  "工作分頁追蹤已中斷；若已開始下載，請核對 Chrome 下載。": {
    en: "Tab tracking interrupted; if download already started, please check Chrome downloads.",
    ja: "作業タブの追跡が中断されました。ダウンロードが始まっている場合は Chrome 側をご確認ください。",
  },
  "來源分頁已關閉": {
    en: "Source tab closed",
    ja: "元のタブが閉じられました",
  },
  "工作分頁追蹤已中斷。": {
    en: "Tab tracking interrupted.",
    ja: "作業タブの追跡が中断されました。",
  },
  "原工作分頁已關閉；重新開啟後請使用「重新核對」": {
    en: "Original tab was closed; please use 'Re-check' after reopening",
    ja: "元の作業タブが閉じられました。開き直した後に「再チェック」を押してください",
  },
  "無法辨識頁面狀態，請人工檢查": {
    en: "Unable to recognize page state; please check manually",
    ja: "ページ状態を認識できません。手動で確認してください",
  },
  "來源分頁無法回應，請人工核對": {
    en: "Source tab not responding; please check manually",
    ja: "元のタブから応答がありません。手動で確認してください",
  },
  "等待結束但來源分頁無法回應": {
    en: "Wait finished but source tab did not respond",
    ja: "待機が終了しましたが元のタブが応答しません",
  },
  "瀏覽器重啟後無法核對來源分頁，請明確重試": {
    en: "Cannot verify source tab after browser restart; please retry",
    ja: "ブラウザ再起動後に元のタブを照合できませんでした。再試行してください",
  },
  "下載連結未通過 Katfile HTTPS 網域檢查": {
    en: "Download link failed Katfile HTTPS domain check",
    ja: "ダウンロードリンクが Katfile HTTPS ドメインチェックを通過しませんでした",
  },
  "交接記錄不完整": {
    en: "Handoff record incomplete",
    ja: "引継ぎ記録が不完全です",
  },
  "找到多筆可能的 Chrome 下載，請人工核對": {
    en: "Multiple candidate Chrome downloads found; please reconcile manually",
    ja: "複数の Chrome ダウンロード候補が見つかりました。手動で照合してください",
  },
  "Chrome 交接結果未知，為避免重複下載已暫停": {
    en: "Chrome handoff state unknown; paused to prevent duplicate downloads",
    ja: "Chrome への引継ぎ結果が不明です。二重ダウンロード防止のため一時停止しました",
  },
  "Chrome 找不到已保存的下載紀錄，請人工核對": {
    en: "Chrome cannot find saved download record; please check manually",
    ja: "Chrome に保存済みダウンロード履歴が見つかりません。手動で照合してください",
  },
  "Chrome 建立多筆可能下載，請人工核對": {
    en: "Chrome created multiple candidate downloads; please check manually",
    ja: "Chrome で複数のダウンロード候補が作成されました。手動で照合してください",
  },
  "Chrome 建立的下載尚無法核對，請人工檢查": {
    en: "Chrome download cannot be verified yet; please check manually",
    ja: "Chrome で作成されたダウンロードを照合できません。手動で確認してください",
  },
  "網站要求等待，倒數結束後重新確認。": {
    en: "Site requires waiting; will recheck after countdown.",
    ja: "サイトの待機時間が必要です。カウントダウン後に再確認します。",
  },
  "網站要求等待，但沒有可靠的剩餘時間；請查看來源頁。": {
    en: "Site requires waiting, but no reliable time remaining; check source tab.",
    ja: "サイトの待機時間が必要ですが残り時間が不明です。元のタブをご確認ください。",
  },
  "來源頁回報明確失敗": {
    en: "Source page reported failure",
    ja: "元のページから失敗が報告されました",
  },
  "來源頁沒有確認免費步驟": {
    en: "Source page did not confirm free step",
    ja: "元のページで無料ステップが確認されませんでした",
  },
  "無法通知來源頁執行，為避免重複點擊已暫停": {
    en: "Cannot notify source page; paused to prevent duplicate clicks",
    ja: "元のページに通知できません。二重クリック防止のため一時停止しました",
  },
  "外部下載完成，但來源分頁無法重新觀察": {
    en: "External download finished, but source tab cannot be observed again",
    ja: "外部ダウンロードは完了しましたが、元のタブを再監視できません",
  },
  "需要先確認目前狀態。": {
    en: "Current status needs confirmation.",
    ja: "現在の状態を確認する必要があります。",
  },
  "貓貓正在看網站的回應。": {
    en: "The cat is watching for site responses.",
    ja: "猫ちゃんがサイトの応答を見守っています。",
  },
  "倒數結束後，會重新確認網站。": {
    en: "Will recheck the site once countdown ends.",
    ja: "カウントダウン終了後、サイトを再確認します。",
  },
  "請到原分頁完成驗證。": {
    en: "Please complete verification in the original tab.",
    ja: "元のタブで認証を完了してください。",
  },
  "正在確認網站狀態。": {
    en: "Checking site status...",
    ja: "サイトの状態を確認中...",
  },
  "網站還在冷卻，貓貓幫你等。": {
    en: "Site is still cooling down; the cat is waiting for you.",
    ja: "サイトがクールダウン中です。猫ちゃんが代わりに待機しています。",
  },
  "加入後尚未開始處理。": {
    en: "Added to queue; processing has not started yet.",
    ja: "追加済み、処理はまだ開始されていません。",
  },
  "頁面倒數已結束，但網站尚未更新可辨識的下一步。": {
    en: "Page countdown ended, but site has not updated to a recognized next step.",
    ja: "ページのカウントダウンが終了しましたが、サイトの次のステップが認識できません。",
  },

  // Command errors & exceptions
  "只能重排待執行項目": {
    en: "Can only reorder queued items",
    ja: "並べ替えできるのは待機中の項目のみです",
  },
  "無法移除目前執行項目": {
    en: "Cannot remove the currently active item",
    ja: "現在実行中の項目は削除できません",
  },
  "只能重試失敗或暫停項目": {
    en: "Can only retry failed or paused items",
    ja: "再試行できるのは失敗または一時停止した項目のみです",
  },
  "已找到交接中的 Chrome 下載，請先核對其狀態後再操作": {
    en: "Found Chrome download in handoff; please verify its status first",
    ja: "引継ぎ中の Chrome ダウンロードが見つかりました。状態を確認してから操作してください",
  },
  "交接結果仍未知，請先重新核對；不會重新發起下載": {
    en: "Handoff result still unknown; please reconcile first without re-downloading",
    ja: "引継ぎ結果が不明です。二重ダウンロードを防ぐため先に照合してください",
  },
  "Chrome 找不到原下載紀錄，結果仍未知；請先人工核對，不會重新下載": {
    en: "Chrome download record not found; please check manually without re-downloading",
    ja: "Chrome のダウンロード履歴が見つかりません。二重ダウンロード防止のため手動で確認してください",
  },
  "Chrome 仍保留可續傳下載；請先在 Chrome 取消舊下載，或恢復並等它完成，再重新核對": {
    en: "Resumable download exists in Chrome; cancel it in Chrome or resume until complete before retrying",
    ja: "Chrome に再開可能なダウンロードが残っています。Chrome 側でキャンセルするか完了を待ってから再照合してください",
  },
  "項目目前不是暫停狀態": {
    en: "Item is not currently paused",
    ja: "項目は現在一時停止状態ではありません",
  },
  "無法重新觀察來源分頁，請人工檢查": {
    en: "Unable to re-observe source tab; please check manually",
    ja: "元のタブを再監視できません。手動で確認してください",
  },
  "這筆下載已不符合核對條件，請重新檢查": {
    en: "Download no longer matches reconciliation criteria; please re-check",
    ja: "このダウンロードは照合条件を満たさなくなりました。再度ご確認ください",
  },
  "語言設定無效": {
    en: "Invalid language setting",
    ja: "言語設定が無効です",
  },
  "找不到佇列項目": {
    en: "Queue item not found",
    ja: "キューの項目が見つかりません",
  },
  "無法重新開啟原始 Katfile 分頁": {
    en: "Unable to reopen original Katfile tab",
    ja: "元の Katfile タブを再度開けませんでした",
  },
  "Chrome 未回傳新分頁識別碼": {
    en: "Chrome did not return a new tab ID",
    ja: "Chrome が新しいタブIDを返しませんでした",
  },
  "Chrome 未回傳分頁識別碼": {
    en: "Chrome did not return a tab ID",
    ja: "Chrome がタブIDを返しませんでした",
  },
  "只能核對目前尚未交接的待處理項目": {
    en: "Can only reconcile pending items not yet handed off",
    ja: "照合できるのは未引継ぎの要確認項目のみです",
  },
  "背景處理失敗": {
    en: "Background processing failed",
    ja: "バックグラウンド処理に失敗しました",
  },
  "未知錯誤": {
    en: "Unknown error",
    ja: "不明なエラー",
  },
  "未知原因": {
    en: "unknown reason",
    ja: "原因不明",
  },
  "可續傳": {
    en: "resumable",
    ja: "再開可能",
  },

  // Content script messages
  "下載由背景 chrome.downloads API 處理，content script 不會點擊最終下載。": {
    en: "Downloads are handled by background chrome.downloads API; content script will not click final download.",
    ja: "ダウンロードはバックグラウンドの chrome.downloads API で処理されます。コンテンツスクリプトは最終ダウンロードをクリックしません。",
  },
  "免費步驟指令格式無效。": {
    en: "Invalid free step command format.",
    ja: "無料ステップのコマンド形式が無効です。",
  },
  "目前頁面與佇列要求的檔案頁不符。": {
    en: "Current page does not match the queue requested file page.",
    ja: "現在のページがキューの対象ファイルページと一致しません。",
  },
  "佇列要求的頁面網址無效。": {
    en: "Invalid page URL requested by queue.",
    ja: "キューで要求されたページURLが無効です。",
  },
  "這個免費步驟已處理過。": {
    en: "This free step has already been processed.",
    ja: "この無料ステップはすでに処理済みです。",
  },
  "無法安全保存此步驟的防重複記錄。": {
    en: "Unable to safely store duplicate-prevention state for this step.",
    ja: "重複防止レコードを安全に保存できませんでした。",
  },
};

interface PatternRule {
  pattern: RegExp;
  en: (match: RegExpExecArray) => string;
  ja: (match: RegExpExecArray) => string;
}

const PATTERN_RULES: PatternRule[] = [
  {
    pattern: /^已記錄\s+(download\d+)\s+免費下載動作，通知來源頁執行一次$/,
    en: (m) =>
      `Logged ${m[1]} free download action; notified source page to execute once`,
    ja: (m) =>
      `${m[1]} 無料ダウンロードアクションを記録し、元のページに1回実行を通知しました`,
  },
  {
    pattern: /^已由你確認並連結 Chrome 下載 #(\d+)$/,
    en: (m) => `Confirmed by you and linked Chrome download #${m[1]}`,
    ja: (m) => `確認済み：Chrome ダウンロード #${m[1]} と連携しました`,
  },
  {
    pattern: /^Chrome 已接手下載 #(\d+)$/,
    en: (m) => `Chrome took over download #${m[1]}`,
    ja: (m) => `Chrome がダウンロード #${m[1]} を引き継ぎました`,
  },
  {
    pattern: /^Chrome 已建立下載 #(\d+)$/,
    en: (m) => `Chrome created download #${m[1]}`,
    ja: (m) => `Chrome がダウンロード #${m[1]} を作成しました`,
  },
  {
    pattern: /^已核對 Chrome 下載 #(\d+)$/,
    en: (m) => `Reconciled Chrome download #${m[1]}`,
    ja: (m) => `Chrome ダウンロード #${m[1]} を照合しました`,
  },
  {
    pattern: /^Chrome 回報工作分頁識別碼 (\d+) 已移除$/,
    en: (m) => `Chrome reported tab #${m[1]} was removed`,
    ja: (m) => `Chrome が作業タブ #${m[1]} の削除を通知しました`,
  },
  {
    pattern: /^網站要求等待約 (\d+) 秒$/,
    en: (m) => `Site requires waiting: ~${m[1]}s remaining`,
    ja: (m) => `サイト待機時間：残り約 ${m[1]} 秒`,
  },
  {
    pattern: /^已暫停：(.*)$/,
    en: (m) => `Paused: ${translateKnownText(m[1], "en")}`,
    ja: (m) => `一時停止：${translateKnownText(m[1], "ja")}`,
  },
  {
    pattern: /^下載失敗：(.*)$/,
    en: (m) => `Download failed: ${translateKnownText(m[1], "en")}`,
    ja: (m) => `ダウンロード失敗：${translateKnownText(m[1], "ja")}`,
  },
  {
    pattern:
      /^免費步驟 (download\d+) 已送出但結果未知；為避免重複點擊，請人工檢查後重試$/,
    en: (m) =>
      `Free step ${m[1]} submitted with unknown result; please check manually to avoid duplicate clicks`,
    ja: (m) =>
      `無料ステップ ${m[1]} を送信しましたが結果が不明です。二重クリック防止のため手動で確認してください`,
  },
  {
    pattern: /^免費步驟未執行：(.*)$/,
    en: (m) => `Free step not executed: ${translateKnownText(m[1], "en")}`,
    ja: (m) => `無料ステップ未実行：${translateKnownText(m[1], "ja")}`,
  },
  {
    pattern: /^Chrome 下載交接結果不明：(.*)；不會自動重送$/,
    en: (m) =>
      `Chrome download handoff state unknown: ${m[1]}; will not retry automatically`,
    ja: (m) =>
      `Chrome ダウンロードの引継ぎ結果が不明です：${m[1]}；自動再試行は行いません`,
  },
  {
    pattern: /^Chrome 下載中斷（(.*)），請先在 Chrome 核對$/,
    en: (m) =>
      `Chrome download interrupted (${m[1]}); please check in Chrome first`,
    ja: (m) =>
      `Chrome ダウンロードが中断されました（${m[1]}）；まずは Chrome 側でご確認ください`,
  },
  {
    pattern: /^Chrome 明確中止下載：(.*)$/,
    en: (m) => `Chrome terminated download: ${m[1]}`,
    ja: (m) => `Chrome がダウンロードを中止しました：${m[1]}`,
  },
  {
    pattern: /^Chrome 安全性阻擋：(.*)$/,
    en: (m) => `Blocked by Chrome security: ${m[1]}`,
    ja: (m) => `Chrome のセキュリティによりブロック：${m[1]}`,
  },
  {
    pattern: /^無法開啟來源分頁：(.*)$/,
    en: (m) => `Cannot open source tab: ${m[1]}`,
    ja: (m) => `元のタブを開けませんでした：${m[1]}`,
  },
];

/**
 * 安全轉換已知的繁體中文 app 訊息與 reason。
 * 若非已知文字或為純用戶資料，保留原文。
 */
export function translateKnownText(
  text: string | undefined,
  targetLang: SupportedLanguage,
): string {
  if (!text) return "";
  if (targetLang === "zh-TW") return text;

  const exact = EXACT_TRANSLATIONS[text];
  if (exact && exact[targetLang]) {
    return exact[targetLang];
  }

  for (const rule of PATTERN_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      return rule[targetLang](match);
    }
  }

  return text;
}
