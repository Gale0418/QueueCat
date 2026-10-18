import type { SupportedLanguage } from "../language";
import type { ItemStatus } from "../types";

export interface LocaleMessages {
  tagline: string;
  brandNote: string;
  introduction: string;
  shareTip: string;
  footerQuote: string;

  // Titles & Topbar
  popupTitle: string;
  managerTitle: string;
  breadcrumbPrefix: string;
  hostChip: string;

  // Nav & Tabs
  mainNavAria: string;
  tabGroupAria: string;
  navQueue: string;
  navAttention: string;
  navComplete: string;
  tabQueue: string;
  tabAttention: string;
  tabComplete: string;
  chromeDownloads: string;
  settings: string;
  settingsShort: string;
  localOnlyNote: string;

  // Companion & Hero
  runStatusWorking: string;
  runStatusResting: string;
  mascotAlt: (title: string) => string;
  heroEmptySubtitle: string;
  defaultHeroSubtitle: string;
  actionAddUrls: string;
  actionAddShort: string;
  actionCheckDownloadStatus: string;
  actionGoToVerification: string;
  actionGoToTab: string;
  actionStartQueue: string;
  actionPauseQueue: string;
  actionResumeQueue: string;

  // First Promise
  promiseAria: string;
  promise1Title: string;
  promise1Desc: string;
  promise2Title: string;
  promise2Desc: string;
  promise3Title: string;
  promise3Desc: string;

  // Current Section
  currentSectionAria: string;
  noCurrentTitle: string;
  serialNote: string;
  currentLabel: string;
  reconcileStartedDownload: string;
  manageInChrome: string;
  nextFilePrefix: string;
  lastFileNotice: string;
  waitClockLabel: string;
  downloadProgressAria: string;
  unknownSize: string;
  checkingSite: string;

  // Add Panel
  addPanelTitle: string;
  closeAddAria: string;
  addTip: string;
  urlInputAria: string;
  urlPlaceholder: string;
  addFooterNotice: string;
  shortcutHint: string;
  confirmAdd: string;
  confirmAddWithCount: (n: number) => string;
  adding: string;
  previewValid: (n: number) => string;
  previewDuplicate: (n: number) => string;
  previewUnsupported: (n: number) => string;
  previewDetails: (n: number) => string;
  tagValid: string;
  tagDuplicate: string;
  tagUnsupported: string;
  previewLimitNotice: string;

  // Settings Panel
  settingsTitle: string;
  closeSettingsAria: string;
  languageLabel: string;
  languageHint: string;
  optLangSystem: string;
  optLangEn: string;
  optLangZhTW: string;
  optLangJa: string;
  notificationsLabel: string;
  notificationsHint: string;
  testNotificationLabel: string;
  testNotificationBtn: string;
  notificationDenied: string;
  notificationGranted: string;
  notificationDefault: string;
  themeLabel: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  reducedMotionLabel: string;
  reducedMotionHint: string;
  settingsHelp: string;
  shortcutSummary: string;
  shortcutCtrlEnter: string;
  shortcutAltArrows: string;
  shortcutEscape: string;
  aboutTitle: string;
  aboutDesc: string;
  shareIntroLabel: string;
  copyIntroBtn: string;
  copyIntroNote: string;

  // List & Rows
  clearComplete: string;
  listColName: string;
  listColAction: string;
  actionMoveUpAria: string;
  actionMoveUpTitle: string;
  actionMoveDownAria: string;
  actionMoveDownTitle: string;
  actionRetryAria: string;
  actionShowFileAria: string;
  actionRemoveAria: string;
  emptyQueueTitle: string;
  emptyQueueDesc: string;
  emptyQueueBtn: string;
  emptyAttentionTitle: string;
  emptyAttentionDesc: string;
  emptyCompleteTitle: string;
  emptyCompleteDesc: string;

  // Details
  detailsSectionAria: string;
  detailsEmptyTitle: string;
  detailsEmptyDesc: string;
  detailsTitle: string;
  closeDetailAria: string;
  detailsWaitingFileName: string;
  detailsSourceUrl: string;
  detailsGoToTab: string;
  detailsRecheck: string;
  detailsActivityLog: string;
  detailsNoEvents: string;

  // Reconcile Panel
  reconcileTitle: string;
  closeReconcileAria: string;
  reconcileCurrentPrefix: string;
  reconcileTip: string;
  btnFindDownloads: string;
  btnFindDownloadsLoading: string;
  btnAdoptDownload: string;
  reconcileStatusDownloading: string;
  reconcileStatusComplete: string;
  reconcileNotFound: string;

  // Toasts
  toastCopyIntroSuccess: string;
  toastCopyIntroFallback: string;
  toastMovedItem: (pos: number, total: number) => string;
  toastAddedRunning: (n: number) => string;
  toastAddedPaused: (n: number) => string;
  toastAdoptLinked: string;
  toastAdoptBlocked: string;
  toastGenericError: string;
  toastFindDownloadsError: string;
  toastRefreshError: string;

  // Popup & Footer
  popupSummary: (queue: number, complete: number, attention: number) => string;
  btnOpenManager: string;
  btnShare: string;
  footerCatQuote: string;

  // Status Labels
  statusQueued: string;
  statusPreparing: string;
  statusWaiting: string;
  statusVerification: string;
  statusHandoff: string;
  statusDownloading: string;
  statusBlocked: string;
  statusFailed: string;
  statusComplete: string;

  // Companion Summary
  summaryBlockedTitle: string;
  summaryBlockedSubtitle: string;
  summaryExternalDownloadingTitle: string;
  summaryVerificationTitle: string;
  summaryVerificationSubtitleRunning: string;
  summaryVerificationSubtitlePaused: string;
  summaryCycleCompleteTitle: string;
  summaryCycleCompleteSubtitleAttention: string;
  summaryCycleCompleteSubtitleRest: string;
  summaryPausedDownloadingTitle: string;
  summaryPausedDownloadingSubtitle: string;
  summaryReadyToGoTitle: string;
  summaryReadyToGoSubtitleWithQueued: (count: number) => string;
  summaryReadyToGoSubtitleNoQueued: string;
  summaryWaitingCooldownTitle: string;
  summaryWaitingCooldownSubtitle: string;
  summaryDownloadingTitle: string;
  summaryDownloadingSubtitlePaused: string;
  summaryDownloadingSubtitleNormal: string;
  summaryPreparingTitle: string;
  summaryQueuedWaitingSiteTitle: string;
  summaryQueuedWaitingSiteSubtitle: string;

  // Brief Reason
  briefWaiting: string;
  briefVerification: string;
  briefPreparing: string;
  briefTabTrackingLost: string;
  briefBlockedDefault: string;
  briefFallbackWatching: string;

  // Notifications
  notifyCycleCompleteTitle: string;
  notifyCycleCompleteMessage: string;
  notifyNeedsHelpTitle: string;
  notifyQueuePausedTitle: string;
  notifyTestTitle: string;
  notifyTestMessage: string;

  // Preview Bar
  previewBarText: string;
  previewBarScenarioLabel: string;
  scenarioEmpty: string;
  scenarioDownloading: string;
  scenarioWaiting: string;
  scenarioVerification: string;
  scenarioBlocked: string;
  scenarioUnknownSize: string;
  scenarioLongName: string;
  scenarioComplete: string;
}

export type StatusLabels = Record<ItemStatus, string>;
