import type { LocaleMessages } from "./types";

export const ja: LocaleMessages = {
  tagline: "待つ時間は、ぜんぶ猫ちゃんにおまかせ。",
  brandNote: "待ち時間は猫ちゃんが見守り、あなたの時間をもっと自由に。",
  introduction: [
    "QueueCat｜待つ時間は、ぜんぶ猫ちゃんにおまかせ。",
    "Katfile のリンクをまとめて貼り付ければ、猫ちゃんが順番に並んで待機し、サイトの制限解除後に Chrome へダウンロードを引き渡します。",
    "認証や確認が必要なときだけ声をかけるので、ずっと画面を見つめている必要はありません。",
    "QueueCat のキューや履歴はすべてこのパソコン内にのみ保存され、小さなお部屋の看板猫ちゃんが一緒に待ってくれます。",
    "現在は Katfile 専用の Chrome ローカル試用版（手動読み込みが必要）であり、実際のダウンロードフローは継続して検証中です。",
  ].join("\n"),
  shareTip:
    "製品の紹介文のみをコピーします。ダウンロード履歴や個人データは含まれません。",
  footerQuote: "キューの整理は猫ちゃん、ダウンロードは Chrome が担当します。",

  // Titles & Topbar
  popupTitle: "QueueCat",
  managerTitle: "QueueCat · ダウンロードキュー",
  breadcrumbPrefix: "マイドキュメント",
  hostChip: "Katfile 無料ダウンロード",

  // Nav & Tabs
  mainNavAria: "メインナビゲーション",
  tabGroupAria: "キューの分類",
  navQueue: "ダウンロードキュー",
  navAttention: "要確認",
  navComplete: "完了済み",
  tabQueue: "キュー",
  tabAttention: "要確認",
  tabComplete: "完了済み",
  chromeDownloads: "Chrome ダウンロード履歴",
  settings: "環境設定",
  settingsShort: "設定",
  localOnlyNote: "URL や履歴はこのパソコン内にのみ保存されます",

  // Companion & Hero
  runStatusWorking: "猫ちゃん当番中 ฅ(•ω•ฅ)",
  runStatusResting: "猫ちゃん休憩中 ฅ(－ω－)ฅ",
  mascotAlt: (title) => `${title}の看板猫ちゃん`,
  heroEmptySubtitle:
    "Katfile の URL を貼り付ければ、キューは猫ちゃん、保存は Chrome。",
  defaultHeroSubtitle:
    "Katfile の URL を貼り付けて、あとはのんびり待ちましょう。",
  actionAddUrls: "ダウンロードURLを追加",
  actionAddShort: "URLを追加",
  actionCheckDownloadStatus: "ダウンロード状態を確認",
  actionGoToVerification: "認証ページへ移動",
  actionGoToTab: "作業タブへ移動",
  actionStartQueue: "キューを開始",
  actionPauseQueue: "キューを一時停止",
  actionResumeQueue: "キューを再開",

  // First Promise
  promiseAria: "QueueCat がサポートすること",
  promise1Title: "まとめて貼り付け",
  promise1Desc: "複数の URL を順番に自動処理",
  promise2Title: "作業に集中",
  promise2Desc: "待ち時間のカウントダウンはおまかせ",
  promise3Title: "必要なときだけ戻る",
  promise3Desc: "認証や手動確認のときだけご案内",

  // Current Section
  currentSectionAria: "現在のダウンロード",
  noCurrentTitle: "現在進行中のダウンロードはありません",
  serialNote: "1件ずつ、順番にダウンロード",
  currentLabel: "現在のファイル",
  reconcileStartedDownload: "開始済みダウンロードを照合",
  manageInChrome: "Chrome でこのダウンロードを管理",
  nextFilePrefix: "次のファイル",
  lastFileNotice: "これが最後のファイルです ฅ(•ω•ฅ)",
  waitClockLabel: "サイト待機中",
  downloadProgressAria: "ダウンロード進捗",
  unknownSize: "サイズ不明",
  checkingSite: "サイトの状態を確認中...",

  // Add Panel
  addPanelTitle: "ダウンロードを追加",
  closeAddAria: "URL追加パネルを閉じる",
  addTip: "Katfile の URL を1行に1つ貼り付けてください（文章混ざりでもOK）。",
  urlInputAria: "Katfile ダウンロードURL",
  urlPlaceholder: "https://katfile.biz/xxxxxxxxxxxx/ファイル.rar.html",
  addFooterNotice:
    "キューに追加するだけで、すぐにはダウンロードを開始しません。",
  shortcutHint: "クイック追加",
  confirmAdd: "キューに追加",
  confirmAddWithCount: (n) => `${n} 件のダウンロードを追加`,
  adding: "追加中…",
  previewValid: (n) => `${n} 件追加可能`,
  previewDuplicate: (n) => `${n} 件重複`,
  previewUnsupported: (n) => `${n} 件未対応`,
  previewDetails: (n) => `URLの詳細を確認 (${n})`,
  tagValid: "追加可能",
  tagDuplicate: "重複",
  tagUnsupported: "未対応",
  previewLimitNotice:
    "先頭30件のみ表示しています。有効なURLはすべて追加されます。",

  // Settings Panel
  settingsTitle: "環境設定",
  closeSettingsAria: "設定を閉じる",
  languageLabel: "表示言語",
  languageHint: "ブラウザ設定に従うか、手動で言語を選択できます。",
  optLangSystem: "ブラウザの言語に従う",
  optLangEn: "English",
  optLangZhTW: "繁體中文（台灣）",
  optLangJa: "日本語",
  notificationsLabel: "デスクトップ通知",
  notificationsHint:
    "認証・手動確認が必要な場合や、すべてのダウンロードが完了したときに通知します。",
  testNotificationLabel: "通知が届くか確認",
  testNotificationBtn: "テスト通知を送信",
  notificationDenied:
    "通知が無効になっています。Chrome / Windows の設定から許可してください。",
  notificationGranted:
    "Chrome の通知は有効です。※Windows の集中モード等で非表示になる場合があります。",
  notificationDefault: "Windows の集中モードで通知が隠れる場合があります。",
  themeLabel: "テーマ",
  themeSystem: "システム設定に従う",
  themeLight: "ライト",
  themeDark: "ダーク",
  reducedMotionLabel: "視覚効果を減らす",
  reducedMotionHint:
    "猫ちゃんは常に静止画イラストです。この設定は画面のトランジションを軽減します。",
  settingsHelp:
    "保存先フォルダーや保存ダイアログの表示は Chrome の設定に準拠します。一時停止・再開・キャンセルは Chrome のダウンロード履歴画面で行ってください。",
  shortcutSummary: "便利なショートカット",
  shortcutCtrlEnter:
    "URL を貼り付け後すぐ追加します（自動ダウンロードは開始されません）。",
  shortcutAltArrows:
    "待機中アイテムの順序を並べ替えます。矢印ボタンでも操作可能です。",
  shortcutEscape:
    "パネルやファイル詳細を閉じます。ダウンロードの中断・キャンセルは行われません。",
  aboutTitle: "ダウンロード待ちも、ほっこり癒しの時間に。",
  aboutDesc:
    "QueueCat は並び待ちを猫ちゃんに任せて、あなたの時間をお返しします。Katfile 専用、ファイル保存は Chrome、履歴はすべてローカル保存。",
  shareIntroLabel: "友達に紹介する",
  copyIntroBtn: "紹介文をコピー",
  copyIntroNote: "製品の紹介文のみをコピーします。個人データは含まれません。",

  // List & Rows
  clearComplete: "完了履歴を消去",
  listColName: "ファイル名",
  listColAction: "状態と操作",
  actionMoveUpAria: "上へ移動",
  actionMoveUpTitle: "上へ移動 (Alt + ↑)",
  actionMoveDownAria: "下へ移動",
  actionMoveDownTitle: "下へ移動 (Alt + ↓)",
  actionRetryAria: "もう一度並ぶ",
  actionShowFileAria: "フォルダーに表示",
  actionRemoveAria: "項目を削除",
  actionStopRemove: "停止して削除",
  emptyQueueTitle: "待機中のファイルはありません ฅ(－ω－)ฅ",
  emptyQueueDesc:
    "Katfile の URL を貼り付けて、猫ちゃんをお仕事に向かわせましょう。",
  emptyQueueBtn: "最初のURLを追加",
  emptyAttentionTitle: "確認が必要な項目はありません ฅ(•ω•ฅ)",
  emptyAttentionDesc: "中断した項目や確認が必要な項目はここに残ります。",
  emptyCompleteTitle: "完了したダウンロードはここに整理されます ฅ(＾・ω・＾ฅ)",
  emptyCompleteDesc:
    "ファイル本体は Chrome が保存し、猫ちゃんは履歴のみ保管します。",

  // Details
  detailsSectionAria: "ファイル詳細",
  detailsEmptyTitle: "どのファイルにも、それぞれのペースがあります",
  detailsEmptyDesc: "リストからファイルを選択して、URLや履歴を確認できます。",
  detailsTitle: "ファイル詳細",
  closeDetailAria: "詳細を閉じる",
  detailsWaitingFileName: "サイトからのファイル名を待機中",
  detailsSourceUrl: "元のURL",
  detailsGoToTab: "作業タブへ移動",
  detailsRecheck: "再チェック",
  detailsActivityLog: "処理履歴",
  detailsNoEvents: "追加済み、処理はまだ開始されていません。",

  // Reconcile Panel
  reconcileTitle: "開始済みダウンロードを照合",
  closeReconcileAria: "照合パネルを閉じる",
  reconcileCurrentPrefix: "現在のファイル：",
  reconcileTip:
    "Katfile 上で「無料ダウンロードを続ける」をクリック済みの場合は、Chrome 側のファイル名・時刻・サイズを照合してください。確認後は追跡のみを再開し、二重ダウンロードは行いません。",
  btnFindDownloads: "照合可能なダウンロードを取得",
  btnFindDownloadsLoading: "読み込み中…",
  btnAdoptDownload: "このダウンロードを確認して追跡を再開",
  reconcileStatusDownloading: "ダウンロード中",
  reconcileStatusComplete: "完了",
  reconcileNotFound:
    "ファイル名・時刻・Katfile ドメインに合致するダウンロードが見つかりませんでした。再クリックせず、まずは Chrome の履歴を確認してください。",

  // Toasts
  toastCopyIntroSuccess:
    "紹介文をコピーしました。製品紹介のみで、個人データは含まれません。",
  toastCopyIntroFallback:
    "自動コピーに失敗しました。テキストを選択しましたので手動でコピーしてください。",
  toastMovedItem: (pos, total) => `${total} 件中 ${pos} 番目に移動しました。`,
  toastAddedRunning: (n) =>
    `猫ちゃんが受け取りました！${n} 件のダウンロードをキューに追加しました ฅ(•ω•ฅ)`,
  toastAddedPaused: (n) =>
    `猫ちゃんが受け取りました！${n} 件をセットしました。「キューを開始」でスタートします ฅ(•ω•ฅ)`,
  toastAdoptLinked:
    "Chrome のダウンロードと連携しました。猫ちゃんが追跡を続けます。",
  toastAdoptBlocked:
    "ダウンロードを連携しましたが、Chrome 側での確認が必要です。",
  toastGenericError: "操作を完了できませんでした。もう一度お試しください。",
  toastFindDownloadsError: "ダウンロードを照合できません",
  toastRefreshError: "キューを読み込めません。",

  // Popup & Footer
  popupSummary: (queue, complete, attention) =>
    `待機 ${queue} · 完了 ${complete} · 要確認 ${attention}`,
  btnOpenManager: "フル管理画面",
  btnShare: "友達に紹介する",
  footerCatQuote:
    "キューの整理は猫ちゃん、ダウンロードは Chrome が担当します。",

  // Status Labels
  statusQueued: "待機中",
  statusPreparing: "ページ準備中",
  statusWaiting: "サイト待機中",
  statusVerification: "認証が必要",
  statusHandoff: "ダウンロード引継ぎ確認中",
  statusDownloading: "Chrome でダウンロード中",
  statusBlocked: "要確認",
  statusFailed: "ダウンロード失敗",
  statusComplete: "完了",

  // Companion Summary
  summaryBlockedTitle: "ダウンロード状態の確認が必要です",
  summaryExternalDownloadingTitle: "現在のダウンロード完了を待機中",
  summaryBlockedSubtitle:
    "現在の状態を確認してから、猫ちゃんを再開させてください。",
  summaryVerificationTitle: "認証の完了をお願いします",
  summaryVerificationSubtitleRunning:
    "元の Katfile タブで認証を完了してください。猫ちゃんがキューを引き継ぎます。",
  summaryVerificationSubtitlePaused:
    "キューを一時停止しました。認証後に「キューを再開」を押してください。",
  summaryCycleCompleteTitle: "このラウンドのダウンロードが完了しました",
  summaryCycleCompleteSubtitleAttention:
    "要確認に残っている項目があります。あとで確認してくださいね。",
  summaryCycleCompleteSubtitleRest:
    "ダウンロード履歴を整理しておきました。少し休憩しましょう！",
  summaryPausedDownloadingTitle: "キュー停止中、ダウンロードは継続中",
  summaryPausedDownloadingSubtitle:
    "キューは一時停止中ですが、Chrome でのダウンロードは継続されます。",
  summaryReadyToGoTitle: "準備完了、いつでも出発できます",
  summaryReadyToGoSubtitleWithQueued: (count) =>
    `${count} 件のダウンロードを準備しました。「キューを開始」でスタートします。`,
  summaryReadyToGoSubtitleNoQueued:
    "Katfile の URL を貼り付けて、あとはのんびり待ちましょう。",
  summaryWaitingCooldownTitle: "サイトの制限解除を待機中",
  summaryWaitingCooldownSubtitle:
    "サイトがクールダウン中です。猫ちゃんが代わりに待機しています。",
  summaryDownloadingTitle: "ダウンロード中、猫ちゃんが見守り中",
  summaryDownloadingSubtitlePaused:
    "ファイルは Chrome 側で一時停止中です。再開され次第追跡を続けます。",
  summaryDownloadingSubtitleNormal:
    "このファイルが完了したら、次のダウンロードに進みます。",
  summaryPreparingTitle: "ダウンロードの準備中",
  summaryQueuedWaitingSiteTitle: "サイトの許可を待ってから再開します",
  summaryQueuedWaitingSiteSubtitle:
    "キューは保存済みです。猫ちゃんが待機しています。",

  // Brief Reason
  briefWaiting: "カウントダウン終了後、サイトを再確認します。",
  briefVerification: "元のタブで認証を完了してください。",
  briefPreparing: "サイトの状態を確認中...",
  briefTabTrackingLost: "作業タブの追跡が中断されました。",
  briefBlockedDefault: "現在の状態を確認する必要があります。",
  briefFallbackWatching: "猫ちゃんがサイトの応答を見守っています。",

  // Notifications
  notifyCycleCompleteTitle: "QueueCat キュー完了",
  notifyCycleCompleteMessage: "Katfile のダウンロードがすべて完了しました。",
  notifyNeedsHelpTitle: "QueueCat からのお願い",
  notifyQueuePausedTitle: "QueueCat キューを一時停止しました",
  notifyTestTitle: "QueueCat テスト通知",
  notifyTestMessage: "通知は正常に機能しています。",

  // Preview Bar
  previewBarText: "オフラインUIプレビュー · ダウンロードは開始されません",
  previewBarScenarioLabel: "シナリオ",
  scenarioEmpty: "空のキュー",
  scenarioDownloading: "ダウンロード中",
  scenarioWaiting: "サイト待機中",
  scenarioVerification: "要認証",
  scenarioBlocked: "引継ぎ不明",
  scenarioUnknownSize: "サイズ不明",
  scenarioLongName: "長いファイル名",
  scenarioComplete: "全完了",
};
