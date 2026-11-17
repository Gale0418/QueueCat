import type { SupportedLanguage } from "../language";

const EXACT_TRANSLATIONS: Record<string, Record<"en" | "ja", string>> = {
  "從此頁匯入作品": { en: "Import works from this page", ja: "このページから作品を追加" },
  "返回佇列": { en: "Back to queue", ja: "キューに戻る" },
  "重新讀取此頁": { en: "Read this page again", ja: "このページを再読み込み" },
  "正在加入…": { en: "Adding…", ja: "追加中…" },
  "正在讀取目前標籤頁的可見作品…": { en: "Reading works on this tag page…", ja: "このタグページの作品を読み込み中…" },
  "請至少勾選一本作品。": { en: "Select at least one work.", ja: "作品を1つ以上選択してください。" },
  "只讀取目前頁面已顯示的作品，不會自動翻頁。網站登入、解鎖及點數由你處理。": {
    en: "Import works shown on this page. Sign in and confirm any points on E-Hentai.",
    ja: "このページに表示されている作品を追加します。ログインとポイントの確認は E-Hentai で行ってください。",
  },
  "目前分頁不是 E-Hentai 標籤清單。請先開啟 e-hentai.org 的 /tag/ 頁面。": {
    en: "Open an E-Hentai tag page first.",
    ja: "先に E-Hentai のタグページを開いてください。",
  },
  "無法讀取目前分頁。請確認 E-Hentai 標籤清單仍開啟，再試一次。": {
    en: "Couldn't read the current tab. Keep the E-Hentai tag page open and try again.",
    ja: "現在のタブを読み込めません。E-Hentai のタグページを開いて再試行してください。",
  },
  "讀取此頁失敗。請確認目前開啟 E-Hentai 標籤清單，再試一次。": {
    en: "Couldn't read this page. Open the E-Hentai tag list and try again.",
    ja: "このページを読み込めません。E-Hentai のタグ一覧を開いて再試行してください。",
  },
  "目前頁面找不到可見的新作品。請確認清單已載入，或檢查這些作品是否已在佇列中。": {
    en: "No new works found. Check that the list has loaded or that the works are already in the queue.",
    ja: "新しい作品が見つかりません。一覧の読み込みや、キューに追加済みかをご確認ください。",
  },
  "沒有新增作品，請重新讀取此頁確認是否已在佇列中。": {
    en: "No works were added. Read this page again to check whether they are already queued.",
    ja: "作品は追加されませんでした。キューに追加済みか確認するため、このページを再読み込みしてください。",
  },
  "E-Hentai 官方 ZIP": { en: "E-Hentai archive ZIP", ja: "E-Hentai 公式 ZIP" },
  "E-Hentai 下載模式": { en: "E-Hentai download mode", ja: "E-Hentai のダウンロード方式" },
  "閱讀圖 ZIP（免登入）": { en: "Reader ZIP (no sign-in)", ja: "閲覧用画像 ZIP（ログイン不要）" },
  "閱讀圖 ZIP（使用作品分頁）": { en: "Reader ZIP (using gallery tab)", ja: "閲覧用画像 ZIP（作品タブを使用）" },
  "官方原圖 ZIP": { en: "Original image ZIP", ja: "公式オリジナル画像 ZIP" },
  "使用閱讀圖，畫質與副檔名可能和官方原圖不同。": { en: "Uses reader images; image quality and file extensions may differ from the official originals.", ja: "閲覧用画像を使用します。画質や拡張子は公式オリジナル画像と異なる場合があります。" },
  "訪客讀不到時，會用 Chrome 開啟同一作品接續。": { en: "If guest access cannot read it, Chrome will open the same gallery to continue.", ja: "ゲストで読み取れない場合、Chrome で同じ作品を開いて続行します。" },
  "先在 E-Hentai 開到這本的作品清單。分頁關閉時，QueueCat 會重開這本。": { en: "Open this gallery on E-Hentai first. If its tab is closed, QueueCat will reopen it.", ja: "先に E-Hentai でこの作品を開いてください。タブを閉じた場合、QueueCat が再度開きます。" },
  "使用這本的作品分頁重試": { en: "Retry with this gallery tab", ja: "この作品タブで再試行" },
  重新排隊: { en: "Re-queue", ja: "キューに再追加" },
  已排入作品分頁重試: { en: "Queued for retry using the gallery tab", ja: "作品タブを使った再試行をキューに追加しました" },
  "請在 Chrome 開啟這本的作品清單，再試一次。": { en: "Open this gallery in Chrome, then try again.", ja: "Chrome でこの作品を開いてから、もう一度お試しください。" },
  gallery_unavailable: { en: "Gallery is unavailable or no longer exists.", ja: "作品を利用できないか、存在しません。" },
  gallery_access_required: { en: "This gallery requires sign-in or access.", ja: "この作品にはログインまたはアクセス権が必要です。" },
  gallery_content_warning: { en: "Confirm the content warning on the gallery page.", ja: "作品ページでコンテンツ警告を確認してください。" },
  gallery_invalid_metadata: { en: "Could not read valid gallery information.", ja: "有効な作品情報を読み取れませんでした。" },
  gallery_reader_tab_required: { en: "Reader access requires the gallery page in Chrome.", ja: "閲覧用画像の取得には Chrome で作品ページを開く必要があります。" },
  "需在 E-Hentai 官方頁登入，並自行確認點數。": { en: "Sign in on E-Hentai and confirm any points on its official page.", ja: "E-Hentai 公式ページにログインし、必要なポイントをご確認ください。" },
  "E-Hentai 官方作品": { en: "E-Hentai gallery", ja: "E-Hentai ギャラリー" },
  "開啟官方作品頁": { en: "Open gallery page", ja: "作品ページを開く" },
  "前往官方 ZIP 頁面": { en: "Open official ZIP page", ja: "公式 ZIP ページを開く" },
  "等你確認原圖 ZIP": { en: "Waiting for you to confirm the original ZIP", ja: "オリジナル ZIP の確認待ち" },
  "核對已開始的 ZIP 下載": { en: "Match a ZIP download", ja: "ZIP ダウンロードを照合" },
  "先在官方頁選擇原圖 ZIP、確認點數並開始下載。核對這裡的檔名、來源與時間後，可接續追蹤。": {
    en: "Choose the original ZIP, confirm the points, and start downloading on E-Hentai. Match the file name, source, and time here to track it.",
    ja: "E-Hentai でオリジナル ZIP を選び、ポイントを確認してダウンロードを開始します。ここでファイル名、ソース、時刻を照合して追跡できます。",
  },
  "先在官方頁選擇原圖 ZIP、確認點數並開始下載。QueueCat 不會代替你使用點數或啟動下載。": {
    en: "Choose the original ZIP, confirm the points, and start downloading on E-Hentai.",
    ja: "E-Hentai でオリジナル ZIP を選び、ポイントを確認してダウンロードを開始してください。",
  },
  "找不到符合條件的 E-Hentai ZIP 下載。請先在官方頁自行啟動 ZIP，完成後再讀取候選。": {
    en: "No matching E-Hentai ZIP download found. Start the ZIP on E-Hentai, then check again.",
    ja: "一致する E-Hentai の ZIP が見つかりません。E-Hentai でダウンロードを開始して再確認してください。",
  },
  "請在 E-Hentai 選擇原圖 ZIP 並確認點數。": {
    en: "Select the original ZIP on E-Hentai and confirm the points.",
    ja: "E-Hentai でオリジナル ZIP を選び、必要なポイントを確認してください。",
  },
  "有多筆可能的 E-Hentai ZIP，請核對這一本的下載。": {
    en: "Several E-Hentai ZIP downloads match. Confirm the right one for this gallery.",
    ja: "E-Hentai の ZIP が複数見つかりました。この作品のダウンロードを確認してください。",
  },
  "已連結 E-Hentai 官方 ZIP 下載。": { en: "Linked the E-Hentai ZIP download.", ja: "E-Hentai の公式 ZIP ダウンロードと連携しました。" },
  "無法開啟 E-Hentai 官方下載頁。": { en: "Couldn't open the E-Hentai archive page.", ja: "E-Hentai のダウンロードページを開けませんでした。" },
  "E-Hentai 圖庫網址無效。": { en: "The E-Hentai gallery URL is invalid.", ja: "E-Hentai の作品 URL が無効です。" },
  "Gelbooru API 設定": { en: "Gelbooru API settings", ja: "Gelbooru API 設定" },
  "從 Gelbooru 帳號設定取得 User ID 和 API Key。資料只保留在這次 Chrome 工作階段。": {
    en: "Get your User ID and API key from your Gelbooru account settings. They are kept for this Chrome session.",
    ja: "Gelbooru のアカウント設定から User ID と API Key を取得してください。この Chrome セッション中のみ保存します。",
  },
  "儲存 API 資料": { en: "Save API credentials", ja: "API 認証情報を保存" },
  "清除 API 資料": { en: "Clear API credentials", ja: "API 認証情報を消去" },
  "請檢查 Gelbooru User ID 和 API Key 的格式。": { en: "Check the format of the Gelbooru User ID and API key.", ja: "Gelbooru の User ID と API Key の形式を確認してください。" },
  "已設定這次 Chrome 工作階段的 Gelbooru API 資料。": { en: "Gelbooru API credentials are set for this Chrome session.", ja: "この Chrome セッションの Gelbooru API 認証情報を設定しました。" },
  "已清除 Gelbooru API 資料。": { en: "Gelbooru API credentials cleared.", ja: "Gelbooru API 認証情報を消去しました。" },
  "無法更新 Gelbooru API 資料。": { en: "Could not update the Gelbooru API credentials.", ja: "Gelbooru API 認証情報を更新できませんでした。" },
  "從分頁加入": { en: "Add from tabs", ja: "タブから追加" },
  "支援來源分頁": { en: "Supported source tabs", ja: "対応するソースタブ" },
  "正在讀取支援來源分頁…": { en: "Reading supported source tabs…", ja: "対応するソースタブを読み込み中…" },
  "列出所有 Chrome 視窗中的支援來源；只在此暫時顯示，不會儲存分頁資訊。": {
    en: "Supported sources from all Chrome windows are shown temporarily here. Tab details are not saved.",
    ja: "すべての Chrome ウィンドウにある対応ソースを一時表示します。タブ情報は保存されません。",
  },
  全選: { en: "Select all", ja: "すべて選択" },
  "加入已選分頁": { en: "Add selected tabs", ja: "選択したタブを追加" },
  "收起分頁清單": { en: "Hide tab list", ja: "タブ一覧を閉じる" },
  "找不到支援來源分頁。你可以直接貼上網址，或重新讀取分頁。": {
    en: "No supported source tabs found. Paste URLs directly or read tabs again.",
    ja: "対応するソースタブがありません。URL を貼り付けるか、再読み込みしてください。",
  },
  "未取得分頁權限。請按「從分頁加入」重試，並在 Chrome 對話框中允許。": {
    en: "Tab permission was not granted. Choose Add from tabs again and allow it in Chrome.",
    ja: "タブの権限が許可されませんでした。「タブから追加」を再度選び、Chrome で許可してください。",
  },
  "目前無法讀取分頁。請更新 Chrome，或直接貼上支援來源網址。": {
    en: "Tabs cannot be read right now. Update Chrome or paste supported source URLs directly.",
    ja: "現在タブを読み取れません。Chrome を更新するか、対応するソース URL を貼り付けてください。",
  },
  "請先選擇至少一個分頁。": { en: "Select at least one tab first.", ja: "先にタブを 1 つ以上選択してください。" },
  "再試一次": { en: "Try again", ja: "再試行" },
  "重新讀取": { en: "Read tabs again", ja: "タブを再読み込み" },
  "只移除 QueueCat 紀錄，Chrome 下載會繼續。": {
    en: "Remove only the QueueCat record. Chrome downloads continue.",
    ja: "QueueCat の記録のみ削除します。Chrome のダウンロードは続行します。",
  },
  待核對下載: { en: "Match download", ja: "ダウンロードの照合待ち" },
  "確認是同一筆下載，接續追蹤": {
    en: "Confirm this is the same download and track it",
    ja: "同じダウンロードと確認して追跡",
  },
  "Chrome 已有同名下載，請確認是否為同一筆；不會重新下載。": {
    en: "Chrome has a download with the same name. Confirm whether it is the same file; it will not be downloaded again.",
    ja: "Chrome に同名のダウンロードがあります。同じファイルか確認してください。再ダウンロードはしません。",
  },
  下載已暫停: { en: "Download paused", ja: "ダウンロード一時停止中" },
  "正在追蹤 Chrome 下載，完成後繼續佇列。": {
    en: "Tracking the Chrome download; the queue continues when it finishes.",
    ja: "Chrome のダウンロードを追跡中。完了後にキューを再開します。",
  },
  正在估算下載剩餘時間: {
    en: "Estimating download time remaining",
    ja: "ダウンロード残り時間を計算中",
  },
  // Engine events & state messages
  已加入佇列: {
    en: "Added to queue",
    ja: "キューに追加されました",
  },
  已重新排入佇列: {
    en: "Re-queued",
    ja: "キューに再追加されました",
  },
  已排入一次自動重試: {
    en: "Queued for one automatic retry",
    ja: "自動再試行（1回）のキューに追加されました",
  },
  有失敗項目可以重試: {
    en: "Some failed downloads can be retried",
    ja: "再試行できるダウンロードがあります",
  },
  "按「開始排隊」，每筆可重試的項目會再跑一次。": {
    en: "Select Start queue to retry each eligible download once.",
    ja: "「キューを開始」を選ぶと、再試行できる項目を1回ずつ実行します。",
  },
  已重新核對: {
    en: "Re-checked",
    ja: "再照合しました",
  },
  正在準備來源分頁: {
    en: "Preparing source tab",
    ja: "元のタブを準備中",
  },
  下載完成: {
    en: "Download complete",
    ja: "ダウンロード完了",
  },
  已通知需要完成網站驗證: {
    en: "Notified that site verification is needed",
    ja: "サイト認証が必要であることを通知しました",
  },
  需要完成網站驗證: {
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
  來源分頁已關閉: {
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
  等待結束但來源分頁無法回應: {
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
  交接記錄不完整: {
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
  來源頁回報明確失敗: {
    en: "Source page reported failure",
    ja: "元のページから失敗が報告されました",
  },
  來源頁沒有確認免費步驟: {
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
  只能重排待執行項目: {
    en: "Can only reorder queued items",
    ja: "並べ替えできるのは待機中の項目のみです",
  },
  無法移除目前執行項目: {
    en: "Cannot remove the currently active item",
    ja: "現在実行中の項目は削除できません",
  },
  只能重試失敗或暫停項目: {
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
  "Chrome 仍保留可續傳下載；請先在 Chrome 取消舊下載，或恢復並等它完成，再重新核對":
    {
      en: "Resumable download exists in Chrome; cancel it in Chrome or resume until complete before retrying",
      ja: "Chrome に再開可能なダウンロードが残っています。Chrome 側でキャンセルするか完了を待ってから再照合してください",
    },
  項目目前不是暫停狀態: {
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
  語言設定無效: {
    en: "Invalid language setting",
    ja: "言語設定が無効です",
  },
  找不到佇列項目: {
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
  只能核對目前尚未交接的待處理項目: {
    en: "Can only reconcile pending items not yet handed off",
    ja: "照合できるのは未引継ぎの要確認項目のみです",
  },
  背景處理失敗: {
    en: "Background processing failed",
    ja: "バックグラウンド処理に失敗しました",
  },
  未知錯誤: {
    en: "Unknown error",
    ja: "不明なエラー",
  },
  未知原因: {
    en: "unknown reason",
    ja: "原因不明",
  },
  可續傳: {
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
    pattern: /^可重新排隊的舊作品：(\d+) 本$/,
    en: (m) => `${m[1]} old works can be re-queued`,
    ja: (m) => `再キュー可能な既存作品：${m[1]} 件`,
  },
  {
    pattern: /^已重新排入 (\d+) 本舊作品。$/,
    en: (m) => `Re-queued ${m[1]} existing works.`,
    ja: (m) => `既存作品 ${m[1]} 件を再キューしました。`,
  },
  {
    pattern: /^已新增 (\d+) 個下載，並重排 (\d+) 本舊作品。$/,
    en: (m) => `Added ${m[1]} downloads and re-queued ${m[2]} existing works.`,
    ja: (m) => `ダウンロード ${m[1]} 件を追加し、既存作品 ${m[2]} 件を再キューしました。`,
  },
  {
    pattern: /^已找到 (\d+) 本。此頁最多匯入 50 本；不會自動翻頁。$/,
    en: (m) => `${m[1]} works found. Import up to 50 from this page.`,
    ja: (m) => `${m[1]} 件見つかりました。このページから最大50件追加できます。`,
  },
  {
    pattern: /^已加入 (\d+) 本作品。$/,
    en: (m) => `Added ${m[1]} works.`,
    ja: (m) => `${m[1]} 件の作品を追加しました。`,
  },
  {
    pattern: /^預估下載剩餘 ([\d:]+)$/,
    en: (m) => `Estimated download time remaining: ${m[1]}`,
    ja: (m) => `ダウンロード残り時間の目安：${m[1]}`,
  },
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
