import type { LanguagePreference } from "./language";

export type ItemStatus =
  | "queued"
  | "preparing"
  | "waiting"
  | "verification"
  | "handoff"
  | "downloading"
  | "blocked"
  | "failed"
  | "complete";
export type Mascot = "sleep" | "work" | "verify" | "confused" | "happy";
export interface QueueEvent {
  at: number;
  message: string;
}
export interface QueueItem {
  id: string;
  sourceUrl: string;
  title: string;
  status: ItemStatus;
  createdAt: number;
  updatedAt: number;
  tabId?: number;
  waitUntil?: number;
  downloadId?: number;
  reason?: string;
  bytesReceived?: number;
  totalBytes?: number;
  speed?: number;
  downloadPaused?: boolean;
  canResume?: boolean;
  action?: {
    id: string;
    kind: "free" | "download";
    at: number;
    step?: "download1" | "download2";
    expectedUrl?: string;
  };
  events: QueueEvent[];
}
export interface Settings {
  notifications: boolean;
  theme: "system" | "light" | "dark";
  reducedMotion: boolean;
  language: LanguagePreference;
}
export interface AppState {
  version: 1;
  running: boolean;
  activeId?: string;
  hostNotBefore?: number;
  items: QueueItem[];
  settings: Settings;
  cycleStartedAt?: number;
  cycleNotifiedAt?: number;
  externalDownloadId?: number;
  externalWaitReason?: string;
}
export type Command =
  | { kind: "add"; urls: string[] }
  | { kind: "start" }
  | { kind: "pause" }
  | { kind: "remove"; id: string }
  | { kind: "retry"; id: string }
  | { kind: "move"; id: string; direction: -1 | 1 }
  | { kind: "focus"; id: string }
  | { kind: "recheck"; id: string }
  | { kind: "adopt-download"; id: string; downloadId: number }
  | { kind: "clear-complete" }
  | { kind: "show-file"; id: string }
  | { kind: "open-manager"; section?: "add" | "settings" | "reconcile" }
  | { kind: "open-downloads" }
  | { kind: "settings"; settings: Partial<Settings> }
  | { kind: "test-notification" };
export interface PageObservation {
  kind: "free" | "waiting" | "verification" | "ready" | "failed" | "unknown";
  pageUrl: string;
  title?: string;
  reason?: string;
  waitSeconds?: number;
  finalUrl?: string;
  step?: "download1" | "download2";
}
export type Request =
  | { type: "QC_GET" }
  | { type: "QC_FIND_DOWNLOADS"; id: string }
  | { type: "QC_COMMAND"; command: Command }
  | { type: "QC_PAGE"; observation: PageObservation };
export interface Response {
  ok: boolean;
  state?: AppState;
  error?: string;
  downloads?: DownloadCandidate[];
}
export interface DownloadCandidate {
  id: number;
  filename: string;
  host: string;
  state: "in_progress" | "complete";
  startTime: string;
  bytesReceived: number;
  totalBytes: number;
}
export interface PageAction {
  type: "QC_PAGE_ACTION";
  actionId: string;
  kind: "free" | "download";
  step?: "download1" | "download2";
  expectedUrl?: string;
}
export interface DownloadDelta {
  id: number;
  state?: { current: "in_progress" | "interrupted" | "complete" };
  error?: { current: string };
  paused?: { current: boolean };
  canResume?: { current: boolean };
  danger?: { current: string };
}
export const STORAGE_KEY = "queuecat.state.v1";
export function initialState(): AppState {
  return {
    version: 1,
    running: false,
    items: [],
    settings: {
      notifications: true,
      theme: "system",
      reducedMotion: false,
      language: "system",
    },
  };
}
