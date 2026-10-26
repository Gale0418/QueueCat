import type { LocaleMessages } from "./types";

export const en: LocaleMessages = {
  tagline: "Leave the waiting to the cat.",
  brandNote: "The cat minds the wait, your time stays yours.",
  introduction: [
    "QueueCat | Leave the waiting to the cat.",
    "Paste Katfile links in batch. The cat queues them up, waits out site cooldowns, and hands files over to Chrome.",
    "Whenever verification or human confirmation is needed, you take over—no need to stare at countdowns.",
    "QueueCat keeps your queue and logs strictly on this machine, with a cozy room cat companion to keep you company.",
    "Currently a Katfile-only Chrome local preview that must be unpacked manually; full real-world site flows are still being verified.",
  ].join("\n"),
  shareTip:
    "Only the product intro is copied; never includes your download data.",
  footerQuote: "The cat minds the queue; Chrome handles the download.",

  // Titles & Topbar
  popupTitle: "QueueCat",
  managerTitle: "QueueCat · Download Queue",
  breadcrumbPrefix: "My Downloads",
  hostChip: "Katfile Free Download",

  // Nav & Tabs
  mainNavAria: "Main Navigation",
  tabGroupAria: "Queue Categories",
  navQueue: "Download Queue",
  navAttention: "Needs Attention",
  navComplete: "Completed",
  tabQueue: "Queue",
  tabAttention: "Attention",
  tabComplete: "Completed",
  chromeDownloads: "Chrome Downloads",
  settings: "Preferences",
  settingsShort: "Settings",
  localOnlyNote: "Links and logs stay strictly on this computer",

  // Companion & Hero
  runStatusWorking: "Cat on duty ฅ(•ω•ฅ)",
  runStatusResting: "Cat resting ฅ(－ω－)ฅ",
  mascotAlt: (title) => `Cat companion: ${title}`,
  heroEmptySubtitle: "Paste Katfile links: the cat queues, Chrome downloads.",
  defaultHeroSubtitle: "Paste Katfile links; take your time with the rest.",
  actionAddUrls: "Add Download Links",
  actionAddShort: "Add Links",
  actionCheckDownloadStatus: "Check Download Status",
  actionGoToVerification: "Go to Verification",
  actionGoToTab: "Go to Tab",
  actionStartQueue: "Start Queue",
  actionPauseQueue: "Pause Queue",
  actionResumeQueue: "Resume Queue",

  // First Promise
  promiseAria: "What QueueCat does for you",
  promise1Title: "Paste All Links",
  promise1Desc: "Handles multiple links one by one",
  promise2Title: "Focus on Your Work",
  promise2Desc: "Let the cat handle countdowns",
  promise3Title: "Return When Needed",
  promise3Desc: "Step in for captcha or unexpected issues",

  // Current Section
  currentSectionAria: "Current Download",
  noCurrentTitle: "No downloads currently in progress",
  serialNote: "One file at a time, sequentially",
  currentLabel: "Current File",
  reconcileStartedDownload: "Reconcile Started Download",
  manageInChrome: "Manage this download in Chrome",
  nextFilePrefix: "Next",
  lastFileNotice: "This is the last one! ฅ(•ω•ฅ)",
  waitClockLabel: "Site countdown",
  downloadProgressAria: "Download progress",
  unknownSize: "Unknown size",
  checkingSite: "Checking site status...",

  // Add Panel
  addPanelTitle: "Add Downloads",
  closeAddAria: "Close add links panel",
  addTip: "Paste Katfile links, one per line (or text containing links).",
  urlInputAria: "Katfile download URLs",
  urlPlaceholder: "https://katfile.biz/xxxxxxxxxxxx/file.rar.html",
  addFooterNotice:
    "Only added to queue; will not start downloading immediately.",
  shortcutHint: "Quick add",
  confirmAdd: "Add to Queue",
  confirmAddWithCount: (n) => `Add ${n} download${n === 1 ? "" : "s"}`,
  adding: "Adding...",
  previewValid: (n) => `${n} valid`,
  previewDuplicate: (n) => `${n} duplicate`,
  previewUnsupported: (n) => `${n} unsupported`,
  previewDetails: (n) => `View link details (${n})`,
  tagValid: "Ready",
  tagDuplicate: "Duplicate",
  tagUnsupported: "Unsupported",
  previewLimitNotice: "Showing first 30 only; all valid URLs will be added.",

  // Settings Panel
  settingsTitle: "Preferences",
  closeSettingsAria: "Close settings",
  languageLabel: "Display Language",
  languageHint: "Follow browser language or select manually.",
  optLangSystem: "Follow Browser Language",
  optLangEn: "English",
  optLangZhTW: "繁體中文（台灣）",
  optLangJa: "日本語",
  notificationsLabel: "Desktop Notifications",
  notificationsHint:
    "Notify when verification or action is needed, or when the batch finishes.",
  testNotificationLabel: "Ensure notifications reach you",
  testNotificationBtn: "Send Test Notification",
  notificationDenied:
    "Notifications are disabled. Please enable them in Chrome / Windows settings.",
  notificationGranted:
    "Chrome notifications enabled. Note: Windows Focus Assist may still hide alerts.",
  notificationDefault: "Windows Focus Assist may also hide notifications.",
  themeLabel: "Theme",
  themeSystem: "System default",
  themeLight: "Light",
  themeDark: "Dark",
  reducedMotionLabel: "Reduce Motion",
  reducedMotionHint:
    "The cat companion is always a static illustration; this setting reduces UI transitions.",
  settingsHelp:
    "Download locations and prompt behavior follow Chrome settings. To pause, resume, or cancel active files, please use the Chrome Downloads page.",
  shortcutSummary: "Helpful Shortcuts",
  shortcutCtrlEnter:
    "Add URLs directly after pasting. Does not start downloads automatically.",
  shortcutAltArrows:
    "Reorder pending items in the queue; the arrow buttons work too.",
  shortcutEscape:
    "Close active panels or item details without pausing or canceling downloads.",
  aboutTitle: "Waiting for downloads can be cozy too.",
  aboutDesc:
    "QueueCat leaves the queueing to the cat and gives time back to you. Tailored for Katfile, stored by Chrome, kept strictly local.",
  shareIntroLabel: "Share with Friends",
  copyIntroBtn: "Copy Intro",
  copyIntroNote:
    "Only product intro is copied; never includes your download data.",

  // List & Rows
  clearComplete: "Clear Completed",
  listColName: "File Name",
  listColAction: "Status & Actions",
  actionMoveUpAria: "Move up",
  actionMoveUpTitle: "Move up (Alt + ↑)",
  actionMoveDownAria: "Move down",
  actionMoveDownTitle: "Move down (Alt + ↓)",
  actionRetryAria: "Retry queue",
  actionShowFileAria: "Show in folder",
  actionRemoveAria: "Remove item",
  actionStopRemove: "Stop and remove",
  emptyQueueTitle: "No files queued yet ฅ(－ω－)ฅ",
  emptyQueueDesc: "Paste a few Katfile links to put the cat on duty.",
  emptyQueueBtn: "Add first batch of links",
  emptyAttentionTitle: "Nothing needs your attention right now ฅ(•ω•ฅ)",
  emptyAttentionDesc:
    "Interrupted or failed items will stay here for your review.",
  emptyCompleteTitle: "Finished downloads will be kept here ฅ(＾・ω・＾ฅ)",
  emptyCompleteDesc:
    "Files are saved by Chrome; the cat only maintains the event log.",

  // Details
  detailsSectionAria: "File Details",
  detailsEmptyTitle: "Every file moves at its own pace",
  detailsEmptyDesc:
    "Select a file from the list to view its source and history.",
  detailsTitle: "File Details",
  closeDetailAria: "Close details",
  detailsWaitingFileName: "Waiting for website to provide file name",
  detailsSourceUrl: "Source URL",
  detailsGoToTab: "Go to Tab",
  detailsRecheck: "Re-check",
  detailsActivityLog: "Activity Log",
  detailsNoEvents: "Added to queue; processing has not started yet.",

  // Reconcile Panel
  reconcileTitle: "Reconcile Started Download",
  closeReconcileAria: "Close reconciliation",
  reconcileCurrentPrefix: "Current file: ",
  reconcileTip:
    "If you already clicked 'Continue Free Download' on Katfile, check the file name, timestamp, and size in Chrome before confirming it is the same download. Confirming will only resume tracking without re-downloading.",
  btnFindDownloads: "Find Reconcilable Downloads",
  btnFindDownloadsLoading: "Loading...",
  btnAdoptDownload: "Confirm this download & resume tracking",
  reconcileStatusDownloading: "Downloading",
  reconcileStatusComplete: "Completed",
  reconcileNotFound:
    "No downloads matching the file name, time, and Katfile domain were found. Please check Chrome first and avoid clicking download again.",

  // Toasts
  toastCopyIntroSuccess:
    "Intro copied. Product description only, no download data included.",
  toastCopyIntroFallback:
    "Unable to copy automatically. Text selected; please copy manually.",
  toastMovedItem: (pos, total) =>
    `Moved to position ${pos} of ${total} pending downloads.`,
  toastAddedRunning: (n) =>
    `The cat got them! Added ${n} download${n === 1 ? "" : "s"} to the queue. ฅ(•ω•ฅ)`,
  toastAddedPaused: (n) =>
    `The cat got them! Ready with ${n} download${n === 1 ? "" : "s"}. Press "Start Queue" whenever ready. ฅ(•ω•ฅ)`,
  toastAdoptLinked:
    "Linked with Chrome download; the cat will continue tracking.",
  toastAdoptBlocked: "Linked download, but Chrome still requires your review.",
  toastGenericError: "Operation did not complete. Please try again.",
  toastFindDownloadsError: "Unable to reconcile downloads",
  toastRefreshError: "Unable to load queue.",

  // Popup & Footer
  popupSummary: (queue, complete, attention) =>
    `Queue ${queue} · Complete ${complete} · Attention ${attention}`,
  btnOpenManager: "Full Manager Page",
  btnShare: "Share with Friends",
  footerCatQuote: "The cat minds the queue; Chrome handles the download.",

  // Status Labels
  statusQueued: "Queued",
  statusPreparing: "Preparing page",
  statusWaiting: "Waiting on site",
  statusVerification: "Verification needed",
  statusHandoff: "Confirming download handoff",
  statusDownloading: "Chrome downloading",
  statusBlocked: "Needs review",
  statusFailed: "Download failed",
  statusComplete: "Completed",

  // Companion Summary
  summaryBlockedTitle: "Download status needs review",
  summaryExternalDownloadingTitle: "Waiting for active download to finish",
  summaryBlockedSubtitle:
    "Review current status before letting the cat continue.",
  summaryVerificationTitle: "Your turn to complete verification",
  summaryVerificationSubtitleRunning:
    "Complete the challenge in original Katfile tab; the cat will resume queuing.",
  summaryVerificationSubtitlePaused:
    "Queue paused; click 'Resume Queue' after finishing verification.",
  summaryCycleCompleteTitle: "This download round is complete",
  summaryCycleCompleteSubtitleAttention:
    "A few items were left in Needs Attention for you to review later.",
  summaryCycleCompleteSubtitleRest:
    "Download logs are neatly archived. Time for a little break!",
  summaryPausedDownloadingTitle: "Queue paused, downloads continue",
  summaryPausedDownloadingSubtitle:
    "Queueing is paused; downloads in Chrome will keep running.",
  summaryReadyToGoTitle: "Ready to go whenever you are",
  summaryReadyToGoSubtitleWithQueued: (count) =>
    `Queued ${count} download${count === 1 ? "" : "s"}. Click 'Start Queue' to begin.`,
  summaryReadyToGoSubtitleNoQueued:
    "Paste Katfile links; take your time with the rest.",
  summaryWaitingCooldownTitle: "Waiting for site cooldown",
  summaryWaitingCooldownSubtitle:
    "The site is still cooling down; the cat is waiting for you.",
  summaryDownloadingTitle: "Downloading, the cat is keeping watch",
  summaryDownloadingSubtitlePaused:
    "File is paused in Chrome; tracking will resume once unpaused.",
  summaryDownloadingSubtitleNormal:
    "Once this file finishes, the next will take its turn.",
  summaryPreparingTitle: "Preparing download",
  summaryQueuedWaitingSiteTitle:
    "Waiting for site permission before continuing",
  summaryQueuedWaitingSiteSubtitle:
    "Queue is saved; the cat is waiting patiently.",

  // Brief Reason
  briefWaiting: "Will recheck the site once countdown ends.",
  briefVerification: "Please complete verification in original tab.",
  briefPreparing: "Checking site status...",
  briefTabTrackingLost: "Tab tracking interrupted.",
  briefBlockedDefault: "Current status needs confirmation.",
  briefFallbackWatching: "The cat is watching for site responses.",

  // Notifications
  notifyCycleCompleteTitle: "QueueCat Queue Completed",
  notifyCycleCompleteMessage: "Katfile download batch has finished.",
  notifyNeedsHelpTitle: "QueueCat Needs Your Help",
  notifyQueuePausedTitle: "QueueCat Paused Queue",
  notifyTestTitle: "QueueCat Test Notification",
  notifyTestMessage: "Notification settings are working properly.",

  // Preview Bar
  previewBarText: "Offline Preview · Will not start downloads",
  previewBarScenarioLabel: "Scenario",
  scenarioEmpty: "Empty Queue",
  scenarioDownloading: "Downloading",
  scenarioWaiting: "Site Waiting",
  scenarioVerification: "Verification",
  scenarioBlocked: "Handoff Unknown",
  scenarioUnknownSize: "Unknown Size",
  scenarioLongName: "Long Filename",
  scenarioComplete: "All Complete",
};
