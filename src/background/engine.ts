import {
  initialState,
  STORAGE_KEY,
  type AppState,
  type Command,
  type DownloadDelta,
  type DownloadCandidate,
  type GalleryImage,
  type GalleryManifest,
  type PageObservation,
  type QueueItem,
  type Request,
  type Response,
} from "../shared/types";
import {
  isLanguagePreference,
  normalizeLanguagePreference,
} from "../shared/language";
import {
  hitomiGalleryId,
  isKatfileHost,
  migrateLegacyKatfileSource,
  normalizeSource,
  sourceKey,
} from "../shared/urls";
import {
  planExtractions,
  extractionError,
  type NativeRequest,
  type NativeReply,
} from "../shared/extraction";

export interface DownloadRecord {
  id: number;
  url: string;
  finalUrl?: string;
  referrer?: string;
  filename?: string;
  state: "in_progress" | "interrupted" | "complete";
  bytesReceived: number;
  totalBytes: number;
  paused: boolean;
  canResume: boolean;
  error?: string;
  danger?: string;
  byExtensionId?: string;
  startTime?: string;
}
export interface EnginePorts {
  native?: { request(message: NativeRequest): Promise<NativeReply> };
  storage: {
    get(key: string): Promise<unknown>;
    set(value: Record<string, unknown>): Promise<void>;
  };
  tabs: {
    create(url: string, active?: boolean): Promise<{ id?: number }>;
    get(id: number): Promise<{ id?: number; url?: string }>;
    update(
      id: number,
      props: { active?: boolean; url?: string },
    ): Promise<unknown>;
    send(id: number, message: unknown): Promise<unknown>;
  };
  downloads: {
    download(options: {
      url: string;
      conflictAction: "uniquify";
      filename?: string;
    }): Promise<number>;
    search(query: {
      id?: number;
      state?: "in_progress" | "interrupted";
      startedAfter?: string;
      startedBefore?: string;
    }): Promise<DownloadRecord[]>;
    pause(id: number): Promise<void>;
    resume(id: number): Promise<void>;
    cancel(id: number): Promise<void>;
    show(id: number): Promise<void>;
  };
  gallery?: {
    load(id: string): Promise<GalleryManifest>;
    imageUrl(image: GalleryImage): Promise<string>;
    prepare?(url: string): Promise<string>;
    release?(blobUrl: string): Promise<void>;
    archive?: {
      stagePage(input: {
        key: string;
        fingerprint: string;
        total: number;
        index: number;
        hash: string;
        url: string;
      }): Promise<{ staged: number; bytes: number }>;
      pack(input: {
        key: string;
        fingerprint: string;
        total: number;
        hashes: string[];
      }): Promise<{ url: string; bytes: number }>;
      cleanup(key: string): Promise<void>;
    };
  };
  alarms: {
    get?(name: string): Promise<{ scheduledTime: number } | undefined>;
    create(
      name: string,
      info: { when?: number; periodInMinutes?: number },
    ): Promise<void> | void;
    clear(name: string): Promise<void> | void;
  };
  notify(
    title: string,
    message: string,
    notificationId?: string,
    language?: AppState["settings"]["language"],
    gallery?: boolean,
  ): Promise<void>;
  setBadge(
    text: string,
    color: string,
    language?: AppState["settings"]["language"],
  ): Promise<void>;
  getUrl(path: string): string;
  now(): number;
  extensionId: string;
}

const ALARM = "queuecat.tick";
const HANDOFF_WINDOW = 60_000;
const UNKNOWN_GRACE = 15_000;
const HOST_GAP = 30_000;
const isTerminal = (s: QueueItem["status"]) =>
  s === "failed" || s === "complete";
const FREE_ACTION_TIMEOUT = 30_000;
const EXTERNAL_WAIT = "Chrome 正在下載其他 Katfile 檔案，完成後繼續";
const MATCHING_DOWNLOAD =
  "Chrome 已有同名下載，請確認是否為同一筆；不會重新下載。";
const HITOMI_IMAGE_HOSTS = new Set([
  "w1.gold-usergeneratedcontent.net",
  "w2.gold-usergeneratedcontent.net",
]);

/** All state transitions and Chrome side effects pass through one serialized queue. */
export class QueueEngine {
  private tail: Promise<unknown> = Promise.resolve();
  private pauseEpoch = 0;
  private galleryControlRequested = 0;
  private galleryControlApplied = 0;
  private galleryPreparations = new Set<string>();
  private state?: AppState;
  private lastSample?: { at: number; bytes: number; id: number };
  private unknownSince = new Map<string, number>();

  constructor(private readonly p: EnginePorts) {}

  private notify(
    s: AppState,
    title: string,
    message: string,
    id?: string,
    gallery = false,
  ) {
    return this.p.notify(title, message, id, s.settings.language, gallery);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async load(): Promise<AppState> {
    if (!this.state) {
      const raw = await this.p.storage.get(STORAGE_KEY);
      const s = raw as AppState | undefined;
      let migrated = false;
      const next =
        s?.version === 1 && Array.isArray(s.items)
          ? {
              ...s,
              settings: {
                ...initialState().settings,
                ...s.settings,
                language: normalizeLanguagePreference(s.settings?.language),
              },
              items: s.items.map((item) => {
                const sourceUrl = migrateLegacyKatfileSource(item.sourceUrl);
                migrated ||= sourceUrl !== item.sourceUrl;
                return {
                  ...item,
                  sourceUrl,
                  events: Array.isArray(item.events) ? item.events : [],
                };
              }),
            }
          : initialState();
      // 先持久化才更新快取；保存失敗時下次載入仍會重試遷移。
      if (migrated) await this.p.storage.set({ [STORAGE_KEY]: next });
      this.state = next;
    }
    return structuredClone(this.state);
  }
  private async save(s: AppState): Promise<void> {
    await this.p.storage.set({ [STORAGE_KEY]: s });
    this.state = structuredClone(s);
    await this.updateBadge(s);
  }
  private async updateBadge(s: AppState): Promise<void> {
    const item = s.items.find((x) => x.id === s.activeId);
    const remaining = s.items.filter(
      (x) => !["complete", "failed"].includes(x.status),
    ).length;
    let text = remaining > 99 ? "99+" : remaining ? String(remaining) : "";
    let color = "#8273a8";
    if (
      item?.status === "verification" ||
      item?.status === "blocked" ||
      s.extractions?.some((g) => g.status === "failed" || !!g.errorCode)
    ) {
      text = "!";
      color = "#bd6158";
    } else if (item?.status === "waiting") {
      color = "#b18843";
    }
    try {
      await this.p.setBadge(text, color, s.settings.language);
    } catch {
      /* badge 不影響已保存的佇列狀態 */
    }
  }
  private event(item: QueueItem, message: string): void {
    item.updatedAt = this.p.now();
    item.events.push({ at: item.updatedAt, message });
    if (item.events.length > 60) item.events.splice(0, item.events.length - 60);
  }
  private galleryFolder(id: string, title: string, itemId: string): string {
    const safeTitle =
      Array.from(
        title
          .normalize("NFC")
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
          .replace(/[. ]+$/g, "")
          .replace(/^\.+/g, "")
          .trim(),
      )
        .slice(0, 80)
        .join("")
        .replace(/[. ]+$/g, "") || "Gallery";
    // A new queue entry gets a separate folder, so re-adding changed metadata
    // cannot mix an old completed prefix with pages from a different revision.
    const run = itemId.replace(/[^a-z0-9]/gi, "").slice(0, 12);
    return `QueueCat/Hitomi-${id}-${run}-${safeTitle}`;
  }
  private validGalleryImageUrl(raw: string, image: GalleryImage): boolean {
    try {
      const url = new URL(raw);
      const segments = url.pathname.split("/").filter(Boolean);
      return (
        url.protocol === "https:" &&
        HITOMI_IMAGE_HOSTS.has(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash &&
        segments.length === 3 &&
        /^[1-9]\d{0,15}$/.test(segments[0]) &&
        /^(?:0|[1-9]\d{0,3})$/.test(segments[1]) &&
        Number(segments[1]) ===
          Number.parseInt(
            `${image.hash.at(-1)}${image.hash.slice(-3, -1)}`,
            16,
          ) &&
        segments.every(
          (segment) =>
            segment !== "." &&
            segment !== ".." &&
            /^[a-z0-9._-]+$/i.test(segment),
        ) &&
        segments.at(-1)?.toLowerCase() === `${image.hash.toLowerCase()}.webp`
      );
    } catch {
      return false;
    }
  }
  private validGalleryHandoff(item: QueueItem, image: GalleryImage): boolean {
    const action = item.action;
    if (!action?.expectedUrl) return false;
    if (!action.sourceImageUrl)
      return this.validGalleryImageUrl(action.expectedUrl, image);
    const prefix = `blob:chrome-extension://${this.p.extensionId}/`;
    return (
      this.validGalleryImageUrl(action.sourceImageUrl, image) &&
      action.expectedUrl.startsWith(prefix) &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
        action.expectedUrl.slice(prefix.length),
      )
    );
  }
  private async validGalleryArchiveHandoff(item: QueueItem): Promise<boolean> {
    const action = item.action;
    const gallery = item.gallery;
    const archive = gallery?.archive;
    const fingerprint = archive?.fingerprint;
    const prefix = `blob:chrome-extension://${this.p.extensionId}/`;
    if (
      action?.kind === "download" &&
      action.archiveFingerprint &&
      action.archiveFingerprint === fingerprint &&
      action.expectedUrl?.startsWith(prefix) &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
        action.expectedUrl.slice(prefix.length),
      )
    ) {
      if (
        !gallery?.images ||
        gallery.images.length !== (gallery.total || gallery.images.length) ||
        !gallery.title ||
        !gallery.id
      )
        return false;
      return (
        (await this.galleryFingerprint(
          gallery.id,
          gallery.title,
          gallery.images,
        )) === fingerprint
      );
    }
    return false;
  }
  private async galleryFingerprint(
    id: string,
    title: string,
    images: GalleryImage[],
  ): Promise<string> {
    const snapshot = images.map(({ hash, name }) => ({ hash, name }));
    const bytes = new TextEncoder().encode(
      JSON.stringify({ id, title, images: snapshot }),
    );
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  private galleryArchiveFailureCode(error: unknown): string {
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    const message =
      error instanceof Error ? error.message : String(error || "");
    const details =
      `${typeof code === "string" ? code : ""} ${message}`.toLowerCase();
    if (
      /gallery_archive_(?:stage_missing|receipt_mismatch|receipt_invalid)/.test(
        details,
      )
    )
      return "gallery_archive_missing";
    if (/gallery_archive_quota|quota/.test(details))
      return "gallery_archive_limit";
    if (details.includes("gallery_archive_limit"))
      return "gallery_archive_limit";
    if (details.includes("gallery_archive_failed"))
      return "gallery_archive_failed";
    if (details.includes("gallery_archive_missing"))
      return "gallery_archive_missing";
    return "gallery_request_failed";
  }
  private async releaseGalleryBlob(item: QueueItem): Promise<void> {
    const url = item.action?.expectedUrl;
    if (item.action?.sourceImageUrl && url && this.p.gallery?.release) {
      // A cleanup failure must not turn a completed Chrome download into a retry.
      await this.p.gallery.release(url).catch(() => undefined);
    }
  }
  private async refreshGalleryManifest(
    s: AppState,
    item: QueueItem,
  ): Promise<boolean> {
    const gallery = item.gallery;
    if (!gallery) return false;
    if (!/^[1-9]\d{0,9}$/.test(gallery.id)) {
      await this.block(s, item, "Hitomi 圖庫識別碼無效");
      return false;
    }
    if (!this.p.gallery) {
      await this.failGallery(s, item, "Hitomi 圖庫下載服務尚未就緒");
      return false;
    }
    let manifest: GalleryManifest;
    try {
      manifest = await this.p.gallery.load(gallery.id);
    } catch (error) {
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      await this.failGallery(
        s,
        item,
        typeof code === "string" &&
          [
            "gallery_unavailable",
            "gallery_invalid_metadata",
            "gallery_invalid_routing",
          ].includes(code)
          ? code
          : "gallery_request_failed",
      );
      return false;
    }
    const valid =
      manifest?.id === gallery.id &&
      typeof manifest.title === "string" &&
      !!manifest.title.trim() &&
      manifest.title.length <= 300 &&
      Array.isArray(manifest.images) &&
      manifest.images.length > 0 &&
      manifest.images.length <= 2_000 &&
      manifest.images.every(
        (image) =>
          image &&
          typeof image.hash === "string" &&
          /^[a-f0-9]{64}$/i.test(image.hash) &&
          typeof image.name === "string" &&
          image.name.length > 0 &&
          image.name.length <= 512 &&
          !/[\0\r\n]/.test(image.name),
      ) &&
      new Set(manifest.images.map((image) => image.hash.toLowerCase())).size ===
        manifest.images.length;
    if (!valid) {
      await this.block(s, item, "Hitomi 圖庫資料無效或已無法核對");
      return false;
    }
    if (!gallery.images && gallery.completed > 0) {
      await this.block(
        s,
        item,
        "缺少已下載圖庫頁面的核對快照；為避免混冊，請重新加入圖庫",
      );
      return false;
    }
    const snapshot = manifest.images.map(({ hash, name }) => ({ hash, name }));
    if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 3_000_000) {
      await this.block(s, item, "Hitomi 圖庫清單過大，無法安全保存進度");
      return false;
    }
    const changed =
      (gallery.images !== undefined &&
        (!gallery.title ||
          !gallery.folder ||
          gallery.title !== manifest.title ||
          gallery.total !== snapshot.length ||
          gallery.images.length !== snapshot.length ||
          gallery.images.some(
            (image, index) =>
              image.hash !== snapshot[index].hash ||
              image.name !== snapshot[index].name,
          ))) ||
      (gallery.folder !== undefined &&
        gallery.folder !==
          this.galleryFolder(gallery.id, manifest.title, item.id));
    if (changed) {
      item.title = manifest.title;
      await this.block(
        s,
        item,
        "Hitomi 圖庫內容或標題已變更；為避免混入不同版本，請重新加入圖庫",
      );
      return false;
    }
    const titleChanged = item.title !== manifest.title;
    item.title = manifest.title;
    if (!gallery.images) {
      gallery.images = snapshot;
      gallery.total = snapshot.length;
      gallery.title = manifest.title;
      gallery.folder = this.galleryFolder(gallery.id, manifest.title, item.id);
      this.event(
        item,
        `已讀取圖庫「${manifest.title}」，共 ${snapshot.length} 張`,
      );
      await this.save(s);
    } else if (titleChanged) await this.save(s);
    return true;
  }
  private async failGallery(
    s: AppState,
    item: QueueItem,
    reason: string,
    continueQueue = true,
  ): Promise<void> {
    if (isTerminal(item.status)) return;
    await this.releaseGalleryBlob(item);
    item.status = "failed";
    item.reason = reason;
    this.event(item, `圖庫下載失敗：${reason}`);
    if (s.activeId === item.id) s.activeId = undefined;
    await this.save(s);
    if (continueQueue && s.running) await this.pump(s);
  }
  private async failGalleryArchive(
    s: AppState,
    item: QueueItem,
    reason: string,
  ): Promise<void> {
    const canContinue = this.galleryArchiveControlCurrent(s);
    await this.failGallery(s, item, reason, false);
    if (canContinue && this.galleryArchiveControlCurrent(s)) await this.pump(s);
  }
  private async startGalleryPage(
    s: AppState,
    item: QueueItem,
    revalidate: boolean,
  ): Promise<void> {
    const pauseEpoch = this.pauseEpoch;
    const gallery = item.gallery;
    if (
      !gallery ||
      this.galleryPreparations.has(item.id) ||
      !s.running ||
      (s.activeId !== undefined && s.activeId !== item.id) ||
      item.downloadId !== undefined ||
      ["blocked", "failed", "complete"].includes(item.status)
    )
      return;
    if (item.action?.kind === "download") {
      await this.recoverGalleryHandoff(s, item);
      return;
    }
    s.activeId = item.id;
    if (revalidate || !gallery.images) {
      item.status = "preparing";
      await this.save(s);
      if (!(await this.refreshGalleryManifest(s, item))) return;
    }
    const images = gallery.images;
    if (!images) {
      await this.block(s, item, "Hitomi 圖庫圖片清單遺失，請重新核對");
      return;
    }
    if (gallery.output === "zip") {
      if (this.pauseEpoch !== pauseEpoch || !s.running) {
        s.running = false;
        s.activeId = undefined;
        item.status = "queued";
        await this.save(s);
        return;
      }
      await this.startGalleryArchive(s, item, images, pauseEpoch);
      return;
    }
    if (gallery.completed >= (gallery.total || images.length)) {
      item.status = "complete";
      item.reason = undefined;
      gallery.images = undefined;
      s.activeId = undefined;
      this.event(item, "圖庫全部下載完成");
      await this.save(s);
      if (s.running) await this.pump(s);
      else await this.arm(s);
      return;
    }
    const image = images[gallery.completed];
    if (!image || !this.p.gallery) {
      await this.block(s, item, "圖庫進度與圖片清單不一致，請重新核對");
      return;
    }
    let url: string;
    try {
      url = await this.p.gallery.imageUrl(image);
    } catch (error) {
      await this.failGallery(
        s,
        item,
        `無法取得第 ${gallery.completed + 1} 張圖片網址：${this.message(error)}`,
      );
      return;
    }
    if (!this.validGalleryImageUrl(url, image)) {
      await this.block(s, item, "Hitomi 圖片網址未通過 HTTPS 網域與 hash 檢查");
      return;
    }
    if (this.pauseEpoch !== pauseEpoch) {
      s.running = false;
      s.activeId = undefined;
      item.status = "queued";
      await this.save(s);
      return;
    }
    if (this.p.gallery.prepare && this.pauseEpoch === pauseEpoch) {
      // Network transfer must not hold the state writer: GET/pause remain
      // responsive. Only the serialized callback below may create a download.
      item.status = "preparing";
      await this.save(s);
      this.galleryPreparations.add(item.id);
      const finish = (downloadUrl?: string) =>
        this.serial(async () => {
          this.galleryPreparations.delete(item.id);
          const current = await this.load();
          const target = current.items.find(
            (candidate) => candidate.id === item.id,
          );
          const currentImage =
            target?.gallery?.images?.[target.gallery.completed];
          if (
            !target ||
            current.activeId !== item.id ||
            target.status !== "preparing" ||
            !currentImage ||
            !this.validGalleryImageUrl(url, currentImage)
          ) {
            if (downloadUrl)
              await this.p.gallery
                ?.release?.(downloadUrl)
                .catch(() => undefined);
            return;
          }
          if (!current.running || this.pauseEpoch !== pauseEpoch) {
            if (downloadUrl)
              await this.p.gallery
                ?.release?.(downloadUrl)
                .catch(() => undefined);
            target.status = "queued";
            current.activeId = undefined;
            await this.save(current);
            // A later explicit start may already be queued behind the pause.
            if (current.running) await this.pump(current);
            return;
          }
          if (!downloadUrl) {
            await this.failGallery(current, target, "gallery_request_failed");
            return;
          }
          await this.handoffGalleryImage(
            current,
            target,
            currentImage,
            url,
            downloadUrl,
          );
        });
      void this.p.gallery
        .prepare(url)
        .then(
          (downloadUrl) => finish(downloadUrl),
          () => finish(),
        )
        .catch((error) =>
          console.error("QueueCat gallery preparation callback", error),
        );
      await this.arm(s);
      return;
    }
    await this.handoffGalleryImage(s, item, image, url, url);
  }
  private safeGalleryTitle(title: string): string {
    return (
      Array.from(
        title
          .normalize("NFC")
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
          .replace(/[. ]+$/g, "")
          .replace(/^\.+/g, "")
          .trim(),
      )
        .slice(0, 80)
        .join("")
        .replace(/[. ]+$/g, "") || "Gallery"
    );
  }
  private galleryPauseRequested(s: AppState, pauseEpoch: number): boolean {
    return !s.running || this.pauseEpoch !== pauseEpoch;
  }
  private galleryArchiveControlCurrent(s: AppState): boolean {
    return (
      s.running && this.galleryControlRequested === this.galleryControlApplied
    );
  }
  private async suspendGalleryArchive(
    s: AppState,
    item: QueueItem,
    clearAction = false,
  ): Promise<void> {
    if (s.activeId === item.id) s.activeId = undefined;
    item.status = "queued";
    if (clearAction) item.action = undefined;
    await this.save(s);
    await this.arm(s);
  }
  private async startGalleryArchive(
    s: AppState,
    item: QueueItem,
    images: GalleryImage[],
    pauseEpoch: number,
  ): Promise<void> {
    const archivePort = this.p.gallery?.archive;
    const gallery = item.gallery!;
    if (!archivePort) {
      await this.failGalleryArchive(s, item, "gallery_archive_missing");
      return;
    }
    const fingerprint = await this.galleryFingerprint(
      gallery.id,
      gallery.title || item.title,
      images,
    );
    if (this.galleryPauseRequested(s, pauseEpoch)) {
      await this.suspendGalleryArchive(s, item);
      return;
    }
    const total = gallery.total || images.length;
    if (
      gallery.archive &&
      (gallery.archive.key !== item.id ||
        gallery.archive.fingerprint !== fingerprint ||
        !Number.isSafeInteger(gallery.archive.staged) ||
        gallery.archive.staged < 0 ||
        gallery.archive.staged > total ||
        !Number.isSafeInteger(gallery.archive.bytes) ||
        gallery.archive.bytes < 0 ||
        !["collecting", "packing", "ready"].includes(gallery.archive.phase))
    ) {
      await this.block(s, item, "ZIP 圖庫暫存與目前快照不符，請人工核對");
      return;
    }
    gallery.archive ??= {
      key: item.id,
      fingerprint,
      staged: 0,
      bytes: 0,
      phase: "collecting",
    };
    s.activeId = item.id;
    if (gallery.archive.staged === total) {
      gallery.archive.phase = "packing";
      item.status = "preparing";
      await this.save(s);
      if (this.galleryPauseRequested(s, pauseEpoch)) {
        await this.suspendGalleryArchive(s, item);
        return;
      }
      this.galleryPreparations.add(item.id);
      void this.packGalleryArchive(item.id, fingerprint, images);
      return;
    }
    const index = gallery.archive.staged;
    const image = images[index];
    if (!image) {
      await this.block(s, item, "ZIP 圖庫暫存進度與快照不一致");
      return;
    }
    item.status = "preparing";
    await this.save(s);
    if (this.galleryPauseRequested(s, pauseEpoch)) {
      await this.suspendGalleryArchive(s, item);
      return;
    }
    this.galleryPreparations.add(item.id);
    void this.stageGalleryArchivePage(
      item.id,
      fingerprint,
      total,
      index,
      image,
    );
  }
  private async stageGalleryArchivePage(
    itemId: string,
    fingerprint: string,
    total: number,
    index: number,
    image: GalleryImage,
  ): Promise<void> {
    let receipt: { staged: number; bytes: number } | undefined;
    let error: unknown;
    try {
      const url = await this.p.gallery!.imageUrl(image);
      if (!this.validGalleryImageUrl(url, image))
        throw Object.assign(new Error("invalid source image url"), {
          code: "gallery_archive_failed",
        });
      receipt = await this.p.gallery!.archive!.stagePage({
        key: itemId,
        fingerprint,
        total,
        index,
        hash: image.hash,
        url,
      });
    } catch (caught) {
      error = caught;
    }
    await this.serial(async () => {
      this.galleryPreparations.delete(itemId);
      const current = await this.load();
      const target = current.items.find((candidate) => candidate.id === itemId);
      const archive = target?.gallery?.archive;
      if (
        !target ||
        !archive ||
        archive.fingerprint !== fingerprint ||
        current.activeId !== itemId ||
        target.status !== "preparing" ||
        target.gallery?.images?.[index]?.hash !== image.hash ||
        !target.gallery?.title ||
        (await this.galleryFingerprint(
          target.gallery.id,
          target.gallery.title,
          target.gallery.images || [],
        )) !== fingerprint
      )
        return;
      if (error !== undefined) {
        await this.failGalleryArchive(
          current,
          target,
          this.galleryArchiveFailureCode(error),
        );
        return;
      }
      if (
        !receipt ||
        !Number.isSafeInteger(receipt.staged) ||
        receipt.staged <= archive.staged ||
        receipt.staged > Math.min(total, index + 1) ||
        !Number.isSafeInteger(receipt.bytes) ||
        receipt.bytes < archive.bytes
      ) {
        await this.failGalleryArchive(
          current,
          target,
          "gallery_archive_failed",
        );
        return;
      }
      archive.staged = receipt.staged;
      archive.bytes = receipt.bytes;
      archive.phase = "collecting";
      target.status = "queued";
      await this.save(current);
      if (!this.galleryArchiveControlCurrent(current)) {
        await this.suspendGalleryArchive(current, target);
        return;
      }
      await this.startGalleryPage(current, target, false);
    }).catch((caught) =>
      console.error("QueueCat gallery archive stage callback", caught),
    );
  }
  private async packGalleryArchive(
    itemId: string,
    fingerprint: string,
    images: GalleryImage[],
  ): Promise<void> {
    let result: { url: string; bytes: number } | undefined;
    let error: unknown;
    try {
      result = await this.p.gallery!.archive!.pack({
        key: itemId,
        fingerprint,
        total: images.length,
        hashes: images.map((image) => image.hash),
      });
    } catch (caught) {
      error = caught;
    }
    await this.serial(async () => {
      this.galleryPreparations.delete(itemId);
      const current = await this.load();
      const target = current.items.find((candidate) => candidate.id === itemId);
      const archive = target?.gallery?.archive;
      if (
        !target ||
        !archive ||
        archive.fingerprint !== fingerprint ||
        archive.phase !== "packing" ||
        current.activeId !== itemId ||
        target.status !== "preparing" ||
        !target.gallery?.title ||
        (await this.galleryFingerprint(
          target.gallery.id,
          target.gallery.title,
          target.gallery.images || [],
        )) !== fingerprint
      )
        return;
      if (error !== undefined) {
        await this.failGalleryArchive(
          current,
          target,
          this.galleryArchiveFailureCode(error),
        );
        return;
      }
      const prefix = `blob:chrome-extension://${this.p.extensionId}/`;
      if (
        !result ||
        !result.url.startsWith(prefix) ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
          result.url.slice(prefix.length),
        ) ||
        !Number.isSafeInteger(result.bytes) ||
        result.bytes < 0
      ) {
        await this.failGalleryArchive(
          current,
          target,
          "gallery_archive_failed",
        );
        return;
      }
      archive.phase = "ready";
      archive.zipBytes = result.bytes;
      archive.filename = `QueueCat/${target.gallery!.id}-${this.safeGalleryTitle(
        target.gallery!.title || target.title,
      )}.zip`;
      await this.save(current);
      if (
        !this.galleryArchiveControlCurrent(current) ||
        current.activeId !== itemId
      ) {
        await this.suspendGalleryArchive(current, target);
        return;
      }
      await this.handoffGalleryArchive(current, target, result.url);
    }).catch((caught) =>
      console.error("QueueCat gallery archive pack callback", caught),
    );
  }
  private async handoffGalleryArchive(
    s: AppState,
    item: QueueItem,
    preparedUrl?: string,
  ): Promise<void> {
    const gallery = item.gallery!;
    const archive = gallery.archive!;
    const expectedUrl = preparedUrl || item.action?.expectedUrl;
    if (!expectedUrl) {
      // A ready URL is kept in the handoff intent; never repack to guess it.
      await this.block(s, item, "ZIP 圖庫交接網址遺失，請人工核對");
      return;
    }
    if (!this.galleryArchiveControlCurrent(s)) {
      await this.suspendGalleryArchive(s, item);
      return;
    }
    item.reason = undefined;
    item.status = "handoff";
    item.action = {
      id: crypto.randomUUID(),
      kind: "download",
      at: this.p.now(),
      expectedUrl,
      archiveFingerprint: archive.fingerprint,
    };
    const valid = await this.validGalleryArchiveHandoff(item);
    if (!this.galleryArchiveControlCurrent(s)) {
      await this.suspendGalleryArchive(s, item, true);
      return;
    }
    if (!valid) {
      await this.block(s, item, "ZIP 圖庫交接記錄不完整，請人工核對");
      return;
    }
    this.event(item, "已保存整本 ZIP 交接，交由 Chrome 下載");
    await this.save(s);
    if (!this.galleryArchiveControlCurrent(s)) {
      await this.suspendGalleryArchive(s, item, true);
      return;
    }
    try {
      const id = await this.p.downloads.download({
        url: expectedUrl,
        filename: archive.filename,
        conflictAction: "uniquify",
      });
      item.downloadId = id;
      item.status = "downloading";
      this.event(item, `Chrome 已接手圖庫 ZIP 下載 #${id}`);
      await this.save(s);
      await this.syncGalleryDownload(s, item);
    } catch (error) {
      await this.block(
        s,
        item,
        `Chrome 圖庫 ZIP 交接結果不明：${this.message(error)}；不會自動重送`,
      );
    }
    await this.arm(await this.load());
  }
  private async handoffGalleryImage(
    s: AppState,
    item: QueueItem,
    image: GalleryImage,
    url: string,
    downloadUrl: string,
  ): Promise<void> {
    const gallery = item.gallery!;
    const filename = `${gallery.folder}/${String(gallery.completed + 1).padStart(4, "0")}.webp`;
    item.reason = undefined;
    item.status = "handoff";
    item.action = {
      id: crypto.randomUUID(),
      kind: "download",
      at: this.p.now(),
      expectedUrl: downloadUrl,
      ...(downloadUrl !== url ? { sourceImageUrl: url } : {}),
    };
    if (!this.validGalleryHandoff(item, image)) {
      await this.releaseGalleryBlob(item);
      await this.block(s, item, "圖庫圖片交接記錄不完整，請人工核對");
      return;
    }
    this.event(
      item,
      `已保存第 ${gallery.completed + 1} 張圖片交接，交由 Chrome 下載`,
    );
    await this.save(s);
    try {
      const id = await this.p.downloads.download({
        url: downloadUrl,
        filename,
        conflictAction: "uniquify",
      });
      item.downloadId = id;
      item.status = "downloading";
      this.event(item, `Chrome 已接手圖庫圖片下載 #${id}`);
      await this.save(s);
      await this.syncGalleryDownload(s, item);
    } catch (error) {
      await this.block(
        s,
        item,
        `Chrome 圖庫下載交接結果不明：${this.message(error)}；不會自動重送`,
      );
    }
    await this.arm(await this.load());
  }
  private async recoverGalleryHandoff(
    s: AppState,
    item: QueueItem,
  ): Promise<void> {
    const action = item.action;
    const image = item.gallery?.images?.[item.gallery.completed];
    const zip = item.gallery?.output === "zip";
    if (
      !action?.expectedUrl ||
      (zip
        ? !(await this.validGalleryArchiveHandoff(item))
        : !image || !this.validGalleryHandoff(item, image)) ||
      !Number.isFinite(action.at)
    ) {
      await this.block(
        s,
        item,
        zip
          ? "ZIP 圖庫交接記錄不完整，請人工核對"
          : "圖庫圖片交接記錄不完整，請人工核對",
      );
      return;
    }
    const candidates = (
      await this.p.downloads.search({
        startedAfter: new Date(action.at - 1).toISOString(),
        startedBefore: new Date(action.at + HANDOFF_WINDOW + 1).toISOString(),
      })
    ).filter(
      (download) =>
        download.byExtensionId === this.p.extensionId &&
        download.url === action.expectedUrl &&
        Date.parse(download.startTime || "") >= action.at &&
        Date.parse(download.startTime || "") <= action.at + HANDOFF_WINDOW,
    );
    if (candidates.length !== 1) {
      await this.block(
        s,
        item,
        candidates.length
          ? `找到多筆可能的圖庫${zip ? " ZIP" : "圖片"}下載，請人工核對`
          : `圖庫${zip ? " ZIP" : "圖片"} Chrome 交接結果未知，為避免重複下載已暫停`,
      );
      return;
    }
    item.downloadId = candidates[0].id;
    item.status = "downloading";
    this.event(item, `已核對圖庫圖片 Chrome 下載 #${item.downloadId}`);
    await this.save(s);
    await this.syncGalleryDownload(s, item);
  }
  private async syncGalleryDownload(
    s: AppState,
    item: QueueItem,
  ): Promise<void> {
    if (
      item.downloadId === undefined ||
      !item.gallery ||
      isTerminal(item.status)
    )
      return;
    const [download] = await this.p.downloads.search({ id: item.downloadId });
    if (!download) {
      await this.block(
        s,
        item,
        "Chrome 找不到已保存的圖庫圖片下載紀錄，請人工核對",
      );
      return;
    }
    const zip = item.gallery.output === "zip";
    const expectedImage = item.gallery.images?.[item.gallery.completed];
    if (
      !item.action?.expectedUrl ||
      (zip
        ? !(await this.validGalleryArchiveHandoff(item))
        : !expectedImage || !this.validGalleryHandoff(item, expectedImage)) ||
      download.url !== item.action.expectedUrl ||
      download.byExtensionId !== this.p.extensionId
    ) {
      await this.block(s, item, "圖庫圖片交接記錄不完整，請人工核對");
      return;
    }
    item.bytesReceived = download.bytesReceived;
    item.totalBytes = download.totalBytes;
    item.downloadPaused = download.paused;
    item.canResume = download.canResume;
    const now = this.p.now();
    if (this.lastSample?.id === download.id && now > this.lastSample.at)
      item.speed = Math.max(
        0,
        ((download.bytesReceived - this.lastSample.bytes) * 1000) /
          (now - this.lastSample.at),
      );
    this.lastSample = {
      id: download.id,
      bytes: download.bytesReceived,
      at: now,
    };
    if (
      download.state !== "interrupted" &&
      download.danger &&
      !["safe", "accepted"].includes(download.danger)
    ) {
      await this.block(s, item, `Chrome 安全性阻擋：${download.danger}`);
      return;
    }
    if (download.state === "complete") {
      if (zip) {
        const gallery = item.gallery;
        gallery.lastDownloadId = download.id;
        gallery.completed = gallery.total || gallery.images?.length || 0;
        item.downloadId = undefined;
        item.action = undefined;
        item.bytesReceived = undefined;
        item.totalBytes = undefined;
        item.speed = undefined;
        item.downloadPaused = undefined;
        item.canResume = undefined;
        item.reason = undefined;
        item.status = "complete";
        gallery.images = undefined;
        s.activeId = undefined;
        this.event(item, "圖庫 ZIP 下載完成");
        await this.save(s);
        await this.p.gallery?.archive
          ?.cleanup(gallery.archive?.key || item.id)
          .catch(() => undefined);
        if (this.galleryArchiveControlCurrent(s)) await this.pump(s);
        else await this.arm(s);
        return;
      }
      await this.releaseGalleryBlob(item);
      const gallery = item.gallery;
      gallery.lastDownloadId = download.id;
      gallery.completed = Math.min(
        gallery.completed + 1,
        gallery.total || gallery.completed + 1,
      );
      item.downloadId = undefined;
      item.action = undefined;
      item.bytesReceived = undefined;
      item.totalBytes = undefined;
      item.speed = undefined;
      item.downloadPaused = undefined;
      item.canResume = undefined;
      item.reason = undefined;
      if (gallery.completed >= (gallery.total || gallery.images?.length || 0)) {
        item.status = "complete";
        gallery.images = undefined;
        s.activeId = undefined;
        this.event(item, "圖庫全部下載完成");
        await this.save(s);
        if (s.running) await this.pump(s);
        else await this.arm(s);
      } else {
        item.status = "queued";
        if (!s.running) s.activeId = undefined;
        this.event(item, `第 ${gallery.completed} 張圖片完成`);
        await this.save(s);
        if (s.running) await this.startGalleryPage(s, item, false);
        else await this.arm(s);
      }
      return;
    }
    if (download.state === "interrupted") {
      if (
        download.canResume ||
        /USER_SHUTDOWN|CRASH/i.test(download.error || "")
      )
        await this.block(
          s,
          item,
          `Chrome 圖庫圖片下載中斷（${download.error || "可續傳"}），請先在 Chrome 核對`,
        );
      else
        await this.failGallery(
          s,
          item,
          `Chrome 明確中止圖庫圖片下載：${download.error || "未知原因"}`,
        );
      return;
    }
    item.status = "downloading";
    await this.save(s);
  }
  private async arm(s: AppState, preserveEarlier = false): Promise<void> {
    if (preserveEarlier) {
      if (!this.p.alarms.get) return;
      const existing = await this.p.alarms.get(ALARM);
      if (
        existing &&
        existing.scheduledTime > this.p.now() &&
        existing.scheduledTime <= this.p.now() + 30_000
      )
        return;
    }
    await this.p.alarms.clear(ALARM);
    if (s.pendingSecretDeletes?.length)
      await this.p.alarms.create(ALARM, {
        when: Math.max(s.nextSecretCleanupAt || 0, this.p.now() + 30_000),
      });
    if (
      s.extractions?.some(
        (g) => g.status === "queued" || g.status === "extracting",
      )
    ) {
      await this.p.alarms.create(ALARM, { when: this.p.now() + 30_000 });
    }
    if (s.running && s.externalDownloadId !== undefined) {
      const active = s.items.find((item) => item.id === s.activeId);
      const deadline =
        active?.status === "waiting" && (active.waitUntil || 0) > this.p.now()
          ? Math.min(active.waitUntil!, this.p.now() + 30_000)
          : this.p.now() + 30_000;
      await this.p.alarms.create(ALARM, { when: deadline });
      return;
    }
    if (!s.activeId) {
      if (s.running && s.items.some((x) => x.status === "queued")) {
        // 下載結束與外部下載等待都可能沒有 activeId，仍須保存下一次喚醒。
        const next =
          s.hostNotBefore && s.hostNotBefore > this.p.now()
            ? Math.min(s.hostNotBefore, this.p.now() + 30_000)
            : this.p.now() + 30_000;
        await this.p.alarms.create(ALARM, { when: next });
      }
      return;
    }
    const item = s.items.find((x) => x.id === s.activeId);
    if (!item) return;
    if (item.status === "blocked") return;
    if (!s.running && item.status !== "downloading") return;
    const when =
      item.status === "waiting"
        ? Math.min(item.waitUntil ?? this.p.now(), this.p.now() + 30_000)
        : this.p.now() + 30_000;
    await this.p.alarms.create(ALARM, { when });
  }
  private async mutate(
    fn: (s: AppState) => Promise<void> | void,
  ): Promise<AppState> {
    const s = await this.load();
    await fn(s);
    await this.save(s);
    await this.arm(s);
    return s;
  }
  getState(): Promise<AppState> {
    return this.serial(async () => structuredClone(await this.load()));
  }

  private async native(message: NativeRequest): Promise<NativeReply> {
    if (!this.p.native) throw new Error("helper_unavailable");
    try {
      const reply = await this.p.native.request(message);
      if (!reply || typeof reply.ok !== "boolean") throw new Error();
      return reply;
    } catch {
      throw new Error("helper_unavailable");
    }
  }

  private async extractionPaths(s: AppState, ids: string[]): Promise<string[]> {
    const paths: string[] = [];
    for (const id of ids) {
      const item = s.items.find((i) => i.id === id);
      if (item?.status !== "complete" || item.downloadId === undefined)
        throw new Error("source_unavailable");
      const [download] = await this.p.downloads.search({ id: item.downloadId });
      if (
        !download ||
        download.state !== "complete" ||
        !download.filename ||
        (download.danger && !["safe", "accepted"].includes(download.danger))
      )
        throw new Error("source_unavailable");
      paths.push(download.filename);
    }
    return paths;
  }

  private queueSecretCleanup(s: AppState, ids: string[]): void {
    const needed = new Set(
      (s.extractions || [])
        .filter((g) => g.status !== "complete")
        .map((g) => g.secretId || g.id),
    );
    s.pendingSecretDeletes = [
      ...new Set([...(s.pendingSecretDeletes || []), ...ids]),
    ].filter((id) => !needed.has(id));
  }

  private async cleanSecrets(s: AppState): Promise<void> {
    if (
      !s.pendingSecretDeletes?.length ||
      (s.nextSecretCleanupAt || 0) > this.p.now()
    )
      return;
    for (const id of [...s.pendingSecretDeletes]) {
      try {
        const reply = await this.native({ op: "forget-secret", id });
        if (!reply.ok) throw new Error();
        s.pendingSecretDeletes = s.pendingSecretDeletes.filter(
          (value) => value !== id,
        );
      } catch {
        s.nextSecretCleanupAt = this.p.now() + 300_000;
        await this.save(s);
        return;
      }
    }
    s.nextSecretCleanupAt = undefined;
    await this.save(s);
  }

  /** Native starts/status are quick RPCs; extraction runs in its detached worker. */
  private async syncExtractions(s: AppState): Promise<void> {
    await this.cleanSecrets(s);
    let changed = false;
    const completedSecrets: string[] = [];
    const resolved = [] as NonNullable<AppState["extractions"]>;
    for (const group of s.extractions || []) {
      if (
        group.unresolved &&
        group.status === "waiting" &&
        group.itemIds.every((id) =>
          s.items.some((i) => i.id === id && i.status === "complete"),
        )
      ) {
        try {
          const paths = await this.extractionPaths(s, group.itemIds);
          const names = new Map(
            group.itemIds.map((id, i) => [id, paths[i].split(/[\\/]/).pop()!]),
          );
          const items = group.itemIds.map((id) =>
            s.items.find((i) => i.id === id)!,
          );
          resolved.push(
            ...planExtractions(items, (item) => names.get(item.id)!).map(
              (g) => ({ ...g, secretId: group.secretId || group.id }),
            ),
          );
        } catch {
          group.status = "failed";
          group.errorCode = "invalid_archive";
          resolved.push(group);
        }
        changed = true;
      } else resolved.push(group);
    }
    if (changed) {
      s.extractions = resolved;
      await this.save(s);
    }
    for (const group of s.extractions || []) {
      if (group.status === "complete" || group.status === "failed") continue;
      if (
        group.status === "waiting" &&
        !group.itemIds.every((id) =>
          s.items.some((i) => i.id === id && i.status === "complete"),
        )
      )
        continue;
      let reply: NativeReply;
      try {
        if (!group.jobId) {
          group.jobId = crypto.randomUUID();
          group.status = "queued";
          // Persist the operation ID before any native side effect.
          await this.save(s);
        }
        reply = await this.native({ op: "status", id: group.jobId });
        if (!reply.ok && reply.errorCode === "job-not-found") {
          const paths = await this.extractionPaths(s, group.itemIds);
          reply = await this.native({
            op: "start",
            id: group.jobId,
            secretId: group.secretId || group.id,
            paths,
          });
        }
        if (
          !reply.ok &&
          ["job-busy", "worker-capacity"].includes(reply.errorCode || "")
        ) {
          group.errorCode = undefined;
        } else if (
          !reply.ok &&
          [
            "job-state-invalid",
            "job-state-failed",
            "job-conflict",
            "internal-error",
          ].includes(reply.errorCode || "")
        ) {
          group.errorCode = "unknown_job"; // Preserve the operation ID; its outcome is ambiguous.
        } else if (
          !reply.ok ||
          !reply.status ||
          !["queued", "extracting", "complete", "failed"].includes(reply.status)
        ) {
          group.status = "failed";
          group.errorCode = extractionError(reply.errorCode);
        } else {
          group.status = reply.status;
          group.errorCode = reply.errorCode
            ? extractionError(reply.errorCode)
            : undefined;
          group.outputDir =
            reply.status === "complete" && typeof reply.outputDir === "string"
              ? reply.outputDir
              : undefined;
          if (group.status === "complete")
            completedSecrets.push(group.secretId || group.id);
        }
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "helper_unavailable";
        // A lost start reply may already have launched a worker. Keep the same ID.
        if (code === "helper_unavailable") {
          group.errorCode = code;
          changed = true;
          break; // One unreachable host must not stall the queue once per archive.
        } else {
          group.status = "failed";
          group.errorCode =
            code === "source_unavailable" ? code : "extraction_failed";
        }
      }
      changed = true;
    }
    if (changed) {
      this.queueSecretCleanup(s, completedSecrets);
      await this.save(s);
      await this.cleanSecrets(s);
    }
  }

  handleRequest(request: Request, senderTabId?: number): Promise<Response> {
    if (request.type === "QC_COMMAND")
      return this.command(request.command).then(
        (state) => ({ ok: true, state: structuredClone(state) }),
        async (error) => ({
          ok: false,
          state: structuredClone(await this.load().catch(() => initialState())),
          error: error instanceof Error ? error.message : "背景處理失敗",
        }),
      );
    return this.serial(async () => {
      try {
        if (request.type === "QC_GET") {
          const s = await this.load();
          const item = s.items.find((x) => x.id === s.activeId);
          if (s.externalDownloadId !== undefined || s.externalWaitReason) {
            const external = await this.findExternal(
              new Set(
                s.items.flatMap((i) =>
                  i.downloadId === undefined ? [] : [i.downloadId],
                ),
              ),
              s.externalDownloadId,
              s.detachedDownloadIds,
            );
            if (external) await this.waitForExternal(s, external);
            else {
              s.externalDownloadId = undefined;
              s.externalWaitReason = undefined;
              s.externalTransfer = undefined;
              s.detachedDownloadIds = [];
              await this.save(s);
              if (s.running && !s.activeId) await this.pump(s);
            }
          }
          if (item?.status === "downloading" && item.downloadId !== undefined)
            await (item.gallery
              ? this.syncGalleryDownload(s, item)
              : this.syncDownload(s, item));
          await this.syncExtractions(await this.load());
          await this.arm(await this.load(), true);
          return { ok: true, state: structuredClone(await this.load()) };
        }
        if (request.type === "QC_FIND_DOWNLOADS") {
          const s = await this.load();
          const item = this.manualDownloadItem(s, request.id);
          return { ok: true, downloads: await this.manualDownloads(s, item) };
        }
        return {
          ok: true,
          state: await this.observe(request.observation, senderTabId),
        };
      } catch (e) {
        return {
          ok: false,
          state: structuredClone(await this.load().catch(() => initialState())),
          error: e instanceof Error ? e.message : "背景處理失敗",
        };
      }
    });
  }
  command(command: Command): Promise<AppState> {
    const galleryControl = command.kind === "pause" || command.kind === "start";
    if (command.kind === "pause") this.pauseEpoch++;
    const controlGeneration = galleryControl
      ? ++this.galleryControlRequested
      : this.galleryControlRequested;
    return this.serial(() => {
      if (galleryControl) this.galleryControlApplied = controlGeneration;
      return this.doCommand(command);
    });
  }
  private async doCommand(c: Command): Promise<AppState> {
    let s = await this.load();
    switch (c.kind) {
      case "add": {
        if (
          c.extraction &&
          (typeof c.extraction.password !== "string" ||
            c.extraction.password.length > 1024 ||
            /[\0\r\n]/.test(c.extraction.password))
        )
          throw new Error("invalid_archive");
        if (c.extraction && c.urls.some((raw) => hitomiGalleryId(raw)))
          throw new Error("gallery_extraction_not_supported");
        const additions: QueueItem[] = [];
        for (const raw of c.urls) {
          const url = normalizeSource(raw);
          if (!url) continue;
          const key = sourceKey(url);
          if (
            s.items.some((x) => sourceKey(x.sourceUrl) === key) ||
            additions.some((x) => sourceKey(x.sourceUrl) === key)
          )
            continue;
          const at = this.p.now();
          additions.push({
            id: crypto.randomUUID(),
            sourceUrl: url,
            title: url,
            status: "queued",
            ...(hitomiGalleryId(url)
              ? {
                  gallery: {
                    id: hitomiGalleryId(url)!,
                    completed: 0,
                    output: this.p.gallery?.archive ? "zip" : "pages",
                  },
                }
              : {}),
            createdAt: at,
            updatedAt: at,
            events: [{ at, message: "已加入佇列" }],
          });
        }
        if (c.extraction) {
          const selected = [...s.items, ...additions].filter((i) =>
            c.urls.some(
              (u) =>
                sourceKey(normalizeSource(u) || "") === sourceKey(i.sourceUrl),
            ),
          );
          const groups = selected.some(
            (item) =>
              new URL(item.sourceUrl).pathname.split("/").filter(Boolean)
                .length < 2,
          )
            ? [
                {
                  id: crypto.randomUUID(),
                  itemIds: selected.map((i) => i.id),
                  status: "waiting" as const,
                  unresolved: true,
                  secretId: undefined as string | undefined,
                },
              ]
            : planExtractions(selected);
          if (
            !groups.length ||
            groups.length > 100 ||
            groups.some((g) =>
              s.extractions?.some(
                (old) =>
                  old.status !== "failed" &&
                  old.status !== "complete" &&
                  old.itemIds.some((id) => g.itemIds.includes(id)),
              ),
            )
          )
            throw new Error("invalid_archive");
          const ping = await this.native({ op: "ping" });
          if (!ping.ok || !ping.sevenZipAvailable)
            throw new Error("engine_unavailable");
          const stored: string[] = [];
          try {
            for (const group of groups) {
              const reply = await this.native({
                op: "store-secret",
                id: group.id,
                password: c.extraction.password,
              });
              if (!reply.ok) throw new Error("extraction_failed");
              stored.push(group.id);
              group.secretId = group.id;
            }
          } catch (error) {
            for (const id of stored)
              try {
                await this.native({ op: "forget-secret", id });
              } catch {
                /* encrypted orphan only */
              }
            throw error;
          }
          const superseded = (s.extractions || []).filter((old) =>
            groups.some((g) =>
              old.itemIds.some((id) => g.itemIds.includes(id)),
            ),
          );
          s.extractions = [
            ...(s.extractions || []).filter(
              (old) =>
                !groups.some((g) =>
                  old.itemIds.some((id) => g.itemIds.includes(id)),
                ),
            ),
            ...groups,
          ];
          this.queueSecretCleanup(
            s,
            superseded.map((g) => g.secretId || g.id),
          );
          s.nativeHelper = { available: true, engineAvailable: true };
        }
        s.items.push(...additions);
        if (additions.length && !s.running && !s.activeId) {
          s.cycleStartedAt = undefined;
          s.cycleNotifiedAt = undefined;
        }
        await this.save(s);
        if (c.extraction) await this.syncExtractions(s);
        await this.arm(s);
        return structuredClone(s);
      }
      case "start": {
        if (
          !s.running &&
          !s.activeId &&
          s.items.some((x) => x.status === "queued")
        ) {
          s.cycleStartedAt = this.p.now();
          s.cycleNotifiedAt = undefined;
        }
        s.running = true;
        if (!s.cycleStartedAt) s.cycleStartedAt = this.p.now();
        await this.save(s);
        const active = s.items.find((x) => x.id === s.activeId);
        if (active?.gallery && active.downloadId === undefined)
          await this.startGalleryPage(s, active, true);
        else await this.pump(s);
        return structuredClone(await this.load());
      }
      case "pause":
        s.running = false;
        await this.save(s);
        await this.arm(s);
        return structuredClone(s);
      case "move": {
        const i = s.items.findIndex((x) => x.id === c.id);
        if (i < 0 || s.items[i].status !== "queued")
          throw new Error("只能重排待執行項目");
        const pending = s.items
          .map((item, index) => ({ item, index }))
          .filter((x) => x.item.status === "queued");
        const position = pending.findIndex((x) => x.index === i);
        const j = pending[position + c.direction]?.index;
        if (j !== undefined)
          [s.items[i], s.items[j]] = [s.items[j], s.items[i]];
        await this.save(s);
        return structuredClone(s);
      }
      case "remove": {
        const item = s.items.find((x) => x.id === c.id);
        const forgetUncertain =
          c.confirmUncertain === true &&
          !!item?.gallery &&
          item.status === "blocked" &&
          item.downloadId === undefined &&
          item.action?.kind === "download";
        const removableGallery =
          !!item?.gallery &&
          item.status === "blocked" &&
          item.downloadId === undefined &&
          (item.action?.kind !== "download" || forgetUncertain);
        const removedActiveGallery =
          removableGallery && item?.id === s.activeId;
        const removableSource = !!item && !item.gallery;
        const removedActiveSource = removableSource && item?.id === s.activeId;
        if (
          !item ||
          (item.id === s.activeId && !removableGallery && !removableSource) ||
          s.extractions?.some(
            (g) =>
              g.itemIds.includes(c.id) &&
              ["queued", "extracting"].includes(g.status),
          )
        )
          throw new Error("無法移除目前執行項目");
        if (removableSource) {
          // Removing a reminder never controls the actual Chrome download.
          // Keep only its ID to prevent the next queued source running in parallel.
          if (item.downloadId !== undefined && item.status !== "complete")
            s.detachedDownloadIds = [
              ...new Set([...(s.detachedDownloadIds || []), item.downloadId]),
            ];
          if (
            removedActiveSource &&
            s.externalDownloadId !== undefined &&
            (await this.manualDownloads(s, item)).some(
              (d) => d.id === s.externalDownloadId,
            )
          )
            s.detachedDownloadIds = [
              ...new Set([
                ...(s.detachedDownloadIds || []),
                s.externalDownloadId,
              ]),
            ];
          if (
            s.externalDownloadId !== undefined &&
            s.detachedDownloadIds?.includes(s.externalDownloadId)
          )
            s.externalTransfer = undefined;
          if (
            removedActiveSource &&
            item.action?.kind === "download" &&
            item.downloadId === undefined
          )
            s.running = false;
        }
        if (s.activeId === item.id) s.activeId = undefined;
        // Forgetting uncertain bookkeeping never retries, cancels, deletes files,
        // or starts the following item. The user must inspect Chrome first.
        if (forgetUncertain) s.running = false;
        if (item.gallery) await this.releaseGalleryBlob(item);
        const archiveKey = item.gallery?.archive?.key || item.id;
        const cleanupArchive =
          item.gallery?.output === "zip" && !forgetUncertain
            ? this.p.gallery?.archive
                ?.cleanup(archiveKey)
                .catch(() => undefined)
            : undefined;
        s.items = s.items.filter((x) => x.id !== c.id);
        const canceled = (s.extractions || []).filter(
          (g) => g.itemIds.includes(c.id) && g.status !== "complete",
        );
        s.extractions = s.extractions
          ?.filter((g) => !canceled.includes(g))
          .map((g) => ({
            ...g,
            itemIds: g.itemIds.filter((id) => id !== c.id),
          }))
          .filter((g) => g.itemIds.length);
        this.queueSecretCleanup(
          s,
          canceled.map((g) => g.secretId || g.id),
        );
        await this.save(s);
        await cleanupArchive;
        await this.cleanSecrets(s);
        if ((removedActiveGallery || removedActiveSource) && s.running)
          await this.pump(s);
        else await this.arm(s);
        return structuredClone(await this.load());
      }
      case "retry": {
        let item = s.items.find((x) => x.id === c.id);
        if (!item || !["failed", "blocked"].includes(item.status))
          throw new Error("只能重試失敗或暫停項目");
        if (
          item.gallery &&
          item.action?.kind === "download" &&
          item.downloadId === undefined
        ) {
          await this.recoverGalleryHandoff(s, item);
          s = await this.load();
          item = s.items.find((x) => x.id === c.id)!;
          if (item.status !== "blocked" || item.downloadId !== undefined)
            throw new Error(
              "已找到交接中的圖庫圖片下載，請先核對其狀態後再操作",
            );
          throw new Error("圖庫圖片交接結果仍未知；不會重新發起下載");
        }
        if (item.action?.kind === "download" && item.downloadId === undefined) {
          await this.recoverHandoff(s, item);
          s = await this.load();
          item = s.items.find((x) => x.id === c.id)!;
          if (item.status !== "blocked" || item.downloadId !== undefined)
            throw new Error(
              "已找到交接中的 Chrome 下載，請先核對其狀態後再操作",
            );
          throw new Error("交接結果仍未知，請先重新核對；不會重新發起下載");
        }
        if (item.downloadId !== undefined) {
          const [d] = await this.p.downloads.search({ id: item.downloadId });
          if (!d)
            throw new Error(
              "Chrome 找不到原下載紀錄，結果仍未知；請先人工核對，不會重新下載",
            );
          if (
            d.state === "in_progress" ||
            (d.state === "interrupted" && d.canResume)
          )
            throw new Error(
              "Chrome 仍保留可續傳下載；請先在 Chrome 取消舊下載，或恢復並等它完成，再重新核對",
            );
        }
        if (
          item.gallery?.output === "zip" &&
          item.reason === "gallery_archive_missing" &&
          item.downloadId === undefined &&
          item.action?.kind !== "download" &&
          item.gallery.archive
        ) {
          await this.p.gallery?.archive
            ?.cleanup(item.gallery.archive.key)
            .catch(() => undefined);
          item.gallery.archive = undefined;
        }
        if (s.activeId === item.id) s.activeId = undefined;
        item.status = "queued";
        item.reason = undefined;
        item.tabId = undefined;
        item.downloadId = undefined;
        item.action = undefined;
        item.waitUntil = undefined;
        this.event(item, "已重新排入佇列");
        await this.save(s);
        if (s.running) await this.pump(s);
        else await this.arm(s);
        return structuredClone(await this.load());
      }
      case "recheck": {
        const item = s.items.find((x) => x.id === c.id);
        if (!item || item.status !== "blocked")
          throw new Error("項目目前不是暫停狀態");
        item.reason = undefined;
        if (item.gallery && item.downloadId !== undefined)
          await this.syncGalleryDownload(s, item);
        else if (item.gallery && item.action?.kind === "download")
          await this.recoverGalleryHandoff(s, item);
        else if (item.gallery) {
          item.status = "preparing";
          await this.save(s);
          if (await this.refreshGalleryManifest(s, item)) {
            item.status = "queued";
            item.reason = undefined;
            if (s.activeId === item.id) s.activeId = undefined;
            await this.save(s);
          }
        } else if (item.downloadId !== undefined)
          await this.syncDownload(s, item);
        else if (item.action?.kind === "download")
          await this.recoverHandoff(s, item);
        else if (item.tabId !== undefined) {
          try {
            const tab = await this.p.tabs.get(item.tabId);
            if (!tab.url || !this.isSourceFor(item, tab.url)) throw new Error();
            item.status = "preparing";
            await this.save(s);
            await this.p.tabs.send(item.tabId, { type: "QC_OBSERVE" });
          } catch {
            item.status = "blocked";
            item.reason = "無法重新觀察來源分頁，請人工檢查";
          }
        }
        this.event(item, "已重新核對");
        await this.save(s);
        if (s.running) await this.pump(s);
        else await this.arm(s);
        return structuredClone(await this.load());
      }
      case "adopt-download": {
        const item = this.manualDownloadItem(s, c.id);
        const candidates = await this.manualDownloads(s, item);
        if (
          !Number.isSafeInteger(c.downloadId) ||
          !candidates.some((d) => d.id === c.downloadId)
        )
          throw new Error("這筆下載已不符合核對條件，請重新檢查");
        item.downloadId = c.downloadId;
        item.status = "downloading";
        item.reason = undefined;
        if (s.externalDownloadId === c.downloadId) {
          s.externalDownloadId = undefined;
          s.externalWaitReason = undefined;
          s.externalTransfer = undefined;
        }
        this.event(item, `已由你確認並連結 Chrome 下載 #${c.downloadId}`);
        await this.save(s);
        if (item.gallery) await this.syncGalleryDownload(s, item);
        else await this.syncDownload(s, item);
        await this.arm(await this.load());
        return structuredClone(await this.load());
      }
      case "clear-complete":
        const completedSecrets = (s.extractions || [])
          .filter((g) => g.status === "complete")
          .map((g) => g.secretId || g.id);
        s.items = s.items.filter(
          (x) =>
            x.status !== "complete" ||
            s.extractions?.some(
              (g) => g.itemIds.includes(x.id) && g.status !== "complete",
            ),
        );
        s.extractions = s.extractions?.filter((g) =>
          g.itemIds.some((id) => s.items.some((i) => i.id === id)),
        );
        this.queueSecretCleanup(s, completedSecrets);
        await this.save(s);
        await this.cleanSecrets(s);
        await this.arm(s);
        return structuredClone(s);
      case "check-helper": {
        try {
          const r = await this.native({ op: "ping" });
          s.nativeHelper = {
            available: r.ok,
            engineAvailable: !!r.sevenZipAvailable,
          };
        } catch {
          s.nativeHelper = { available: false };
        }
        await this.save(s);
        return structuredClone(s);
      }
      case "retry-extraction": {
        const group = s.extractions?.find((g) => g.id === c.id);
        if (!group || group.status !== "failed")
          throw new Error("extraction_failed");
        const oldSecret = group.secretId || group.id;
        if (c.password !== undefined) {
          if (
            typeof c.password !== "string" ||
            c.password.length > 1024 ||
            /[\0\r\n]/.test(c.password)
          )
            throw new Error("invalid_archive");
          const secretId = crypto.randomUUID();
          const reply = await this.native({
            op: "store-secret",
            id: secretId,
            password: c.password,
          });
          if (!reply.ok) throw new Error("extraction_failed");
          group.secretId = secretId;
        }
        group.status = "waiting";
        group.jobId = undefined;
        group.errorCode = undefined;
        group.outputDir = undefined;
        this.queueSecretCleanup(s, c.password !== undefined ? [oldSecret] : []);
        await this.save(s);
        await this.cleanSecrets(s);
        await this.syncExtractions(s);
        await this.arm(s);
        return structuredClone(s);
      }
      case "settings":
        if (
          c.settings.language !== undefined &&
          !isLanguagePreference(c.settings.language)
        )
          throw new Error("語言設定無效");
        s.settings = { ...s.settings, ...c.settings };
        await this.save(s);
        return structuredClone(s);
      case "focus":
        return this.focusItem(s, c.id);
      case "open-manager":
        await this.p.tabs.create(
          this.p.getUrl(`manager.html${c.section ? `#${c.section}` : ""}`),
        );
        return structuredClone(s);
      case "open-downloads":
        await this.p.tabs.create("chrome://downloads/");
        return structuredClone(s);
      case "show-file": {
        const item = s.items.find((x) => x.id === c.id);
        const downloadId = item?.gallery
          ? item.gallery.lastDownloadId
          : item?.downloadId;
        if (downloadId !== undefined) await this.p.downloads.show(downloadId);
        return structuredClone(s);
      }
      case "test-notification":
        await this.notify(s, "QueueCat 測試通知", "通知設定正常。");
        return structuredClone(s);
    }
  }
  private async focusItem(s: AppState, id: string): Promise<AppState> {
    const item = s.items.find((x) => x.id === id);
    if (!item) throw new Error("找不到佇列項目");
    const reconnect =
      s.running &&
      !item.gallery &&
      item.id === s.activeId &&
      ["preparing", "waiting", "verification", "blocked"].includes(
        item.status,
      ) &&
      item.downloadId === undefined &&
      item.action?.kind !== "download";
    if (
      item.gallery &&
      item.status === "blocked" &&
      (item.action?.kind === "download" || item.downloadId !== undefined)
    ) {
      await this.p.tabs.create("chrome://downloads/");
      return structuredClone(s);
    }
    if (item.tabId !== undefined) {
      let tab: { url?: string } | undefined;
      try {
        tab = await this.p.tabs.get(item.tabId);
      } catch {
        /* 原分頁已關閉，重新建立來源分頁供使用者查看。 */
      }
      if (tab?.url && this.isSourceFor(item, tab.url)) {
        if (reconnect && migrateLegacyKatfileSource(tab.url) !== tab.url) {
          await this.reconnectSource(s, item, undefined, true);
          await this.p.tabs.update(item.tabId, {
            url: item.sourceUrl,
            active: true,
          });
          return structuredClone(s);
        }
        await this.p.tabs.update(item.tabId, { active: true });
        if (reconnect) await this.reconnectSource(s, item, tab.url);
        return structuredClone(s);
      }
    }
    if (
      !reconnect &&
      !item.gallery &&
      item.id === s.activeId &&
      !["downloading", "handoff", "blocked", "failed", "complete"].includes(
        item.status,
      )
    ) {
      await this.block(
        s,
        item,
        "原工作分頁已關閉；重新開啟後請使用「重新核對」",
      );
    }
    let tab: { id?: number };
    try {
      tab = await this.p.tabs.create(item.sourceUrl, false);
    } catch {
      throw new Error("無法重新開啟原始 Katfile 分頁");
    }
    if (tab.id === undefined) throw new Error("Chrome 未回傳新分頁識別碼");
    item.tabId = tab.id;
    await this.save(s);
    await this.p.tabs.update(tab.id, { active: true });
    if (reconnect) await this.reconnectSource(s, item);
    return structuredClone(s);
  }
  private async reconnectSource(
    s: AppState,
    item: QueueItem,
    existingUrl?: string,
    waitForLoad = false,
  ): Promise<void> {
    // 呼叫端已核對來源與交接狀態；保留免費步驟 action，避免重新送出同一步驟。
    item.status = "preparing";
    item.reason = undefined;
    item.waitUntil = undefined;
    this.unknownSince.delete(item.id);
    item.events = item.events.filter(
      (e) => e.message !== "頁面狀態尚未辨識（等待判定）",
    );
    this.event(item, "已重新核對");
    await this.save(s);
    await this.arm(s);
    if (waitForLoad) return;
    try {
      await this.p.tabs.send(item.tabId!, { type: "QC_OBSERVE" });
    } catch {
      // 新頁面載入後會主動回報。既有頁面的舊腳本可能因外掛重載而失效，
      // 僅在訊息無法送達時重載已核對的來源網址，讓 Chrome 載入新版腳本。
      if (existingUrl) {
        try {
          await this.p.tabs.update(item.tabId!, { url: existingUrl });
        } catch {
          await this.block(s, item, "無法重新觀察來源分頁，請人工檢查");
        }
      }
    }
  }
  private async pump(s: AppState): Promise<void> {
    if (!s.running || s.activeId) {
      await this.arm(s);
      return;
    }
    const item = s.items.find((x) => x.status === "queued");
    if (!item) {
      s.running = false;
      s.activeId = undefined;
      const cycleComplete =
        s.items.length > 0 && s.items.every((x) => isTerminal(x.status));
      const notifyCycle =
        cycleComplete && !s.cycleNotifiedAt && s.settings.notifications;
      if (cycleComplete) s.cycleNotifiedAt = this.p.now();
      await this.save(s);
      await this.arm(s);
      if (notifyCycle)
        await this.notify(
          s,
          "QueueCat 佇列已完成",
          s.items.some((x) => x.gallery)
            ? "QueueCat 佇列已完成"
            : "本輪 Katfile 下載工作已結束。",
          `queuecat-cycle-${s.cycleStartedAt || s.cycleNotifiedAt}`,
        );
      return;
    }
    if (item.gallery) {
      await this.startGalleryPage(s, item, true);
      return;
    }
    const ownIds = new Set(
      s.items.flatMap((i) =>
        i.downloadId === undefined ? [] : [i.downloadId],
      ),
    );
    const external = await this.findExternal(
      ownIds,
      s.externalDownloadId,
      s.detachedDownloadIds,
    );
    if (external) {
      await this.waitForExternal(s, external);
      return;
    }
    const hadExternal =
      s.externalDownloadId !== undefined || s.externalWaitReason !== undefined;
    s.externalDownloadId = undefined;
    s.externalWaitReason = undefined;
    s.externalTransfer = undefined;
    if (hadExternal) await this.save(s);
    if (s.hostNotBefore && s.hostNotBefore > this.p.now()) {
      await this.p.alarms.create(ALARM, {
        when: Math.min(s.hostNotBefore, this.p.now() + 30_000),
      });
      return;
    }
    s.activeId = item.id;
    item.status = "preparing";
    this.event(item, "正在準備來源分頁");
    await this.save(s);
    try {
      const tab = await this.p.tabs.create(item.sourceUrl, false);
      if (tab.id === undefined) throw new Error("Chrome 未回傳分頁識別碼");
      item.tabId = tab.id;
      await this.save(s);
      await this.arm(s);
    } catch (e) {
      await this.fail(s, item, `無法開啟來源分頁：${this.message(e)}`);
    }
  }
  private async findExternal(
    ownIds: Set<number>,
    knownId?: number,
    detachedIds: number[] = [],
  ): Promise<DownloadRecord | undefined> {
    for (const id of detachedIds) {
      const [detached] = await this.p.downloads.search({ id });
      if (detached && !ownIds.has(id) && detached.state === "in_progress")
        return detached;
    }
    if (
      knownId !== undefined &&
      !ownIds.has(knownId) &&
      !detachedIds.includes(knownId)
    ) {
      const [known] = await this.p.downloads.search({ id: knownId });
      if (
        known &&
        known.byExtensionId !== this.p.extensionId &&
        known.state === "in_progress" &&
        [known.url, known.finalUrl, known.referrer].some(
          (u) => !!u && this.isKatfileReference(u),
        )
      )
        return known;
    }
    const active = await this.p.downloads.search({ state: "in_progress" });
    return active.find(
      (d) =>
        !ownIds.has(d.id) &&
        !detachedIds.includes(d.id) &&
        d.byExtensionId !== this.p.extensionId &&
        d.state === "in_progress" &&
        [d.url, d.finalUrl, d.referrer].some(
          (u) => !!u && this.isKatfileReference(u),
        ),
    );
  }
  private manualDownloadItem(s: AppState, id: string): QueueItem {
    const item = s.items.find((i) => i.id === id);
    if (
      !item ||
      !!item.gallery ||
      s.activeId !== id ||
      item.status !== "blocked" ||
      item.downloadId !== undefined ||
      item.action?.kind === "download"
    )
      throw new Error("只能核對目前尚未交接的待處理項目");
    return item;
  }
  private async manualDownloads(
    s: AppState,
    item: QueueItem,
  ): Promise<DownloadCandidate[]> {
    const basename = (value: string) => value.split(/[\\/]/).pop() || "";
    const decode = (value: string) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };
    const sourceName = decode(
      new URL(item.sourceUrl).pathname.split("/").pop() || "",
    ).replace(/\.html$/i, "");
    const names = new Set(
      [sourceName, item.title]
        .filter((n) => n && !n.includes("://"))
        .map((n) => n.toLowerCase()),
    );
    const claimed = new Set(
      s.items.filter((i) => i.id !== item.id).map((i) => i.downloadId),
    );
    const records = await this.p.downloads.search({
      startedAfter: new Date(item.createdAt - 1).toISOString(),
    });
    return records.flatMap((d) => {
      let file = basename(d.filename || "");
      if (!file) {
        try {
          file = decode(basename(new URL(d.finalUrl || d.url).pathname));
        } catch {
          return [];
        }
      }
      const origin = [d.finalUrl, d.url].find(
        (u) => !!u && this.isKatfileReference(u),
      );
      if (
        claimed.has(d.id) ||
        !["in_progress", "complete"].includes(d.state) ||
        !Number.isFinite(Date.parse(d.startTime || "")) ||
        Date.parse(d.startTime!) < item.createdAt ||
        !origin ||
        !names.has(file.toLowerCase()) ||
        (d.danger && !["safe", "accepted"].includes(d.danger))
      )
        return [];
      return [
        {
          id: d.id,
          filename: file,
          host: new URL(origin).host,
          state: d.state as "in_progress" | "complete",
          startTime: d.startTime!,
          bytesReceived: d.bytesReceived,
          totalBytes: d.totalBytes,
        },
      ];
    });
  }
  private async waitForExternal(
    s: AppState,
    external: DownloadRecord,
  ): Promise<void> {
    if (s.detachedDownloadIds?.includes(external.id)) {
      if (
        s.externalDownloadId !== external.id ||
        s.externalTransfer ||
        s.externalWaitReason !== EXTERNAL_WAIT
      ) {
        s.externalDownloadId = external.id;
        s.externalWaitReason = EXTERNAL_WAIT;
        s.externalTransfer = undefined;
        await this.save(s);
      }
      await this.arm(s, true);
      return;
    }
    const item =
      s.items.find((x) => x.id === s.activeId) ||
      s.items.find((x) => x.status === "queued");
    // A filename alone is ambiguous. Only reconnect a unique live download
    // whose source page carries this file's Katfile ID.
    const matchesSource = (d: DownloadRecord) =>
      [d.referrer, d.url, d.finalUrl].some(
        (url) =>
          !!url &&
          !!normalizeSource(url) &&
          !!item &&
          this.isSourceFor(item, url),
      );
    if (
      s.running &&
      item &&
      !item.gallery &&
      item.downloadId === undefined &&
      item.action?.kind !== "download" &&
      ["queued", "preparing", "waiting", "verification"].includes(
        item.status,
      ) &&
      external.state === "in_progress" &&
      matchesSource(external)
    ) {
      const matches = (
        await this.p.downloads.search({ state: "in_progress" })
      ).filter(
        (d) => !s.items.some((x) => x.downloadId === d.id) && matchesSource(d),
      );
      if (matches.length === 1 && matches[0].id === external.id) {
        s.activeId = item.id;
        s.externalDownloadId = undefined;
        s.externalWaitReason = undefined;
        s.externalTransfer = undefined;
        item.downloadId = external.id;
        item.status = "downloading";
        item.reason = undefined;
        item.waitUntil = undefined;
        this.event(item, `已核對 Chrome 下載 #${external.id}`);
        await this.save(s);
        await this.syncDownload(s, item);
        await this.arm(s);
        return;
      }
    }
    const now = this.p.now();
    const sample = this.lastSample;
    // Missing source IDs must not leave a same-name item ready to download
    // again after the external transfer ends. Reuse the manual candidate checks.
    let needsConfirmation = false;
    if (
      s.running &&
      item &&
      !item.gallery &&
      item.downloadId === undefined &&
      item.action?.kind !== "download" &&
      ["queued", "preparing", "waiting", "verification"].includes(
        item.status,
      ) &&
      (await this.manualDownloads(s, item)).some((d) => d.id === external.id)
    ) {
      s.activeId = item.id;
      item.status = "blocked";
      item.reason = MATCHING_DOWNLOAD;
      item.waitUntil = undefined;
      this.event(item, MATCHING_DOWNLOAD);
      needsConfirmation = true;
    }
    const transfer = {
      title:
        external.filename?.split(/[\\/]/).pop() ||
        new URL(external.url).pathname.split("/").pop() ||
        "Katfile",
      bytesReceived: external.bytesReceived,
      totalBytes: external.totalBytes,
      downloadPaused: external.paused || external.state === "interrupted",
      speed:
        sample?.id === external.id && now > sample.at
          ? Math.max(
              0,
              ((external.bytesReceived - sample.bytes) * 1000) /
                (now - sample.at),
            )
          : s.externalDownloadId === external.id
            ? s.externalTransfer?.speed
            : undefined,
    };
    this.lastSample = {
      id: external.id,
      bytes: external.bytesReceived,
      at: now,
    };
    const transferChanged =
      JSON.stringify(s.externalTransfer) !== JSON.stringify(transfer);
    s.externalTransfer = transfer;
    if (
      s.externalDownloadId === external.id &&
      s.externalWaitReason === EXTERNAL_WAIT
    ) {
      if (transferChanged || needsConfirmation) await this.save(s);
      await this.arm(s, true);
      return;
    }
    s.externalDownloadId = external.id;
    s.externalWaitReason = EXTERNAL_WAIT;
    await this.save(s);
    await this.arm(s, true);
  }
  private isSourceFor(item: QueueItem, raw: string): boolean {
    try {
      const u = new URL(raw);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        isKatfileHost(u.hostname) &&
        sourceKey(item.sourceUrl) === sourceKey(raw)
      );
    } catch {
      return false;
    }
  }
  private async observe(
    o: PageObservation,
    senderTabId?: number,
  ): Promise<AppState> {
    const s = await this.load();
    const item = s.items.find((x) => x.id === s.activeId);
    if (
      !item ||
      item.tabId === undefined ||
      senderTabId !== item.tabId ||
      !this.isSourceFor(item, o.pageUrl)
    )
      return structuredClone(s);
    if (!s.running && item.status !== "downloading") return structuredClone(s);
    try {
      const actual = await this.p.tabs.get(senderTabId);
      if (!actual.url || !this.isSourceFor(item, actual.url))
        return structuredClone(s);
    } catch {
      return structuredClone(s);
    }
    if (
      item.status === "blocked" ||
      item.status === "downloading" ||
      item.status === "handoff"
    )
      return structuredClone(s);
    if (o.title && !["unknown", "verification"].includes(o.kind))
      item.title = o.title.trim().slice(0, 500);
    const external = await this.findExternal(
      new Set(
        s.items.flatMap((x) =>
          x.downloadId === undefined ? [] : [x.downloadId],
        ),
      ),
      s.externalDownloadId,
      s.detachedDownloadIds,
    );
    if (external) {
      await this.waitForExternal(s, external);
      return structuredClone(s);
    }
    const clearedExternal =
      s.externalDownloadId !== undefined || !!s.externalWaitReason;
    if (clearedExternal) {
      s.externalDownloadId = undefined;
      s.externalWaitReason = undefined;
      await this.save(s);
    }
    if (o.kind !== "unknown") {
      this.unknownSince.delete(item.id);
      item.events = item.events.filter(
        (e) => e.message !== "頁面狀態尚未辨識（等待判定）",
      );
    }
    switch (o.kind) {
      case "unknown": {
        const previous = item.events.find(
          (e) => e.message === "頁面狀態尚未辨識（等待判定）",
        );
        const since =
          this.unknownSince.get(item.id) ?? previous?.at ?? this.p.now();
        this.unknownSince.set(item.id, since);
        if (!previous) this.event(item, "頁面狀態尚未辨識（等待判定）");
        if (this.p.now() - since >= UNKNOWN_GRACE)
          await this.block(s, item, o.reason || "無法辨識頁面狀態，請人工檢查");
        else {
          await this.save(s);
          await this.p.alarms.create(ALARM, { when: since + UNKNOWN_GRACE });
        }
        break;
      }
      case "free": {
        this.unknownSince.delete(item.id);
        const step = o.step ?? "download1";
        if (item.action?.kind === "free" && item.action.step === step) {
          if (this.p.now() - item.action.at >= FREE_ACTION_TIMEOUT)
            await this.block(
              s,
              item,
              `免費步驟 ${step} 已送出但結果未知；為避免重複點擊，請人工檢查後重試`,
            );
          return structuredClone(s);
        }
        if (
          item.action?.kind === "free" &&
          item.action.step === "download2" &&
          step === "download1"
        )
          return structuredClone(s);
        item.action = {
          id: crypto.randomUUID(),
          kind: "free",
          at: this.p.now(),
          step,
        };
        item.status = "preparing";
        this.event(item, `已記錄 ${step} 免費下載動作，通知來源頁執行一次`);
        await this.save(s);
        try {
          const reply = await this.p.tabs.send(item.tabId, {
            type: "QC_PAGE_ACTION",
            actionId: item.action.id,
            kind: "free",
            step,
          });
          if (
            !reply ||
            typeof reply !== "object" ||
            (reply as { ok?: boolean }).ok !== true
          ) {
            const error =
              (reply as { error?: string } | undefined)?.error ||
              "來源頁沒有確認免費步驟";
            await this.block(s, item, `免費步驟未執行：${error}`);
          }
        } catch {
          await this.block(s, item, "無法通知來源頁執行，為避免重複點擊已暫停");
        }
        break;
      }
      case "waiting": {
        if (
          typeof o.waitSeconds !== "number" ||
          !Number.isFinite(o.waitSeconds) ||
          o.waitSeconds <= 0
        ) {
          await this.block(
            s,
            item,
            "網站要求等待，但沒有可靠的剩餘時間；請查看來源頁。",
          );
          break;
        }
        const seconds = Math.min(
          24 * 3600,
          Math.max(1, Math.ceil(o.waitSeconds)),
        );
        const proposed = this.p.now() + seconds * 1000;
        const wasWaiting = item.status === "waiting";
        const previousDeadline = item.waitUntil;
        item.waitUntil =
          wasWaiting && previousDeadline
            ? Math.min(proposed, previousDeadline + 1000)
            : proposed;
        item.status = "waiting";
        item.reason = o.reason || "網站要求等待，倒數結束後重新確認。";
        s.hostNotBefore = item.waitUntil;
        if (
          !wasWaiting ||
          !previousDeadline ||
          Math.abs(item.waitUntil - previousDeadline) > 1000
        )
          this.event(
            item,
            `網站要求等待約 ${Math.max(0, Math.ceil((item.waitUntil - this.p.now()) / 1000))} 秒`,
          );
        await this.save(s);
        break;
      }
      case "verification":
        item.status = "verification";
        item.reason = o.reason || "需要完成網站驗證";
        const firstVerification = !item.events.some(
          (e) => e.message === "已通知需要完成網站驗證",
        );
        if (firstVerification) {
          this.event(item, item.reason);
          this.event(item, "已通知需要完成網站驗證");
        }
        await this.save(s);
        if (firstVerification && s.settings.notifications)
          await this.notify(
            s,
            "QueueCat 需要你協助",
            item.reason,
            `queuecat-verify-${item.id}`,
          );
        break;
      case "ready": {
        if (!o.finalUrl || !this.isVerifiedDownloadUrl(o.finalUrl)) {
          await this.block(s, item, "下載連結未通過 Katfile HTTPS 網域檢查");
          break;
        }
        if (item.action?.kind === "download" || item.downloadId !== undefined)
          break;
        const concurrent = await this.findExternal(
          new Set(
            s.items.flatMap((x) =>
              x.downloadId === undefined ? [] : [x.downloadId],
            ),
          ),
          s.externalDownloadId,
          s.detachedDownloadIds,
        );
        if (concurrent) {
          await this.waitForExternal(s, concurrent);
          break;
        }
        item.action = {
          id: crypto.randomUUID(),
          kind: "download",
          at: this.p.now(),
          expectedUrl: o.finalUrl,
        };
        item.status = "handoff";
        this.event(item, "已保存交接動作，交由 Chrome 下載");
        await this.save(s);
        try {
          const id = await this.p.downloads.download({
            url: o.finalUrl,
            conflictAction: "uniquify",
          });
          item.downloadId = id;
          item.status = "downloading";
          this.event(item, `Chrome 已接手下載 #${id}`);
          await this.save(s);
          await this.syncDownload(s, item);
        } catch (e) {
          await this.block(
            s,
            item,
            `Chrome 下載交接結果不明：${this.message(e)}；不會自動重送`,
          );
        }
        break;
      }
      case "failed":
        await this.fail(s, item, o.reason || "來源頁回報明確失敗");
        break;
    }
    await this.arm(s);
    return structuredClone(s);
  }
  private isVerifiedDownloadUrl(raw: string): boolean {
    try {
      const u = new URL(raw);
      return (
        u.protocol === "https:" &&
        isKatfileHost(u.hostname) &&
        !u.username &&
        !u.password
      );
    } catch {
      return false;
    }
  }
  private isKatfileReference(raw: string): boolean {
    try {
      return isKatfileHost(new URL(raw).hostname);
    } catch {
      return false;
    }
  }
  private message(e: unknown): string {
    return e instanceof Error ? e.message : "未知錯誤";
  }
  private async block(
    s: AppState,
    item: QueueItem,
    reason: string,
  ): Promise<void> {
    if (item.status === "blocked" && item.reason === reason) return;
    const notify = item.status !== "blocked" && s.settings.notifications;
    item.status = "blocked";
    item.reason = reason;
    this.event(item, `已暫停：${reason}`);
    await this.save(s);
    await this.arm(s);
    if (notify)
      await this.notify(
        s,
        "QueueCat 已暫停佇列",
        reason,
        `queuecat-block-${item.id}`,
        !!item.gallery,
      );
  }
  private async fail(
    s: AppState,
    item: QueueItem,
    reason: string,
  ): Promise<void> {
    if (isTerminal(item.status)) return;
    item.status = "failed";
    item.reason = reason;
    this.event(item, `下載失敗：${reason}`);
    if (s.activeId === item.id) {
      s.activeId = undefined;
      s.hostNotBefore = Math.max(s.hostNotBefore || 0, this.p.now() + HOST_GAP);
    }
    await this.save(s);
    if (s.running) await this.pump(s);
  }
  /** Chrome event, startup recovery, and watchdog all converge on persisted IDs. */
  onDownloadChanged(delta: DownloadDelta): Promise<AppState> {
    return this.serial(async () => {
      const s = await this.load();
      const wasDetached = s.detachedDownloadIds?.includes(delta.id);
      if (wasDetached) {
        const [detached] = await this.p.downloads.search({ id: delta.id });
        if (
          !detached ||
          detached.state === "complete" ||
          detached.state === "interrupted"
        ) {
          s.detachedDownloadIds = s.detachedDownloadIds!.filter(
            (id) => id !== delta.id,
          );
          await this.save(s);
        }
      }
      const item = s.items.find((x) => x.downloadId === delta.id);
      if (item) {
        if (!isTerminal(item.status))
          await (item.gallery
            ? this.syncGalleryDownload(s, item)
            : this.syncDownload(s, item));
        await this.arm(await this.load());
        return structuredClone(await this.load());
      }
      if (s.externalDownloadId === delta.id) {
        const [external] = await this.p.downloads.search({ id: delta.id });
        if (!external || external.state !== "in_progress") {
          s.externalDownloadId = undefined;
          s.externalWaitReason = undefined;
          s.externalTransfer = undefined;
          await this.save(s);
          if (s.running && !s.activeId) await this.pump(s);
          else if (s.running) {
            const active = s.items.find((x) => x.id === s.activeId);
            if (
              active &&
              !["downloading", "handoff", "blocked"].includes(active.status) &&
              active.tabId !== undefined
            ) {
              try {
                await this.p.tabs.send(active.tabId, { type: "QC_OBSERVE" });
              } catch {
                await this.block(
                  s,
                  active,
                  "外部下載完成，但來源分頁無法重新觀察",
                );
              }
            }
          }
        } else await this.arm(s);
        return structuredClone(await this.load());
      }
      const handoff = s.items.find(
        (x) =>
          x.status === "handoff" &&
          x.action?.kind === "download" &&
          x.action.expectedUrl,
      );
      if (handoff) {
        if (handoff.gallery) await this.recoverGalleryHandoff(s, handoff);
        else await this.recoverHandoff(s, handoff);
      }
      return structuredClone(await this.load());
    });
  }
  private async recoverHandoff(s: AppState, item: QueueItem): Promise<void> {
    const action = item.action;
    if (!action?.expectedUrl) {
      await this.block(s, item, "交接記錄不完整");
      return;
    }
    const candidates = (
      await this.p.downloads.search({
        // Chrome 的 after/before 為嚴格界線；查詢多取 1ms，再由下方含端點條件精確過濾。
        startedAfter: new Date(action.at - 1).toISOString(),
        startedBefore: new Date(action.at + HANDOFF_WINDOW + 1).toISOString(),
      })
    ).filter(
      (d) =>
        d.byExtensionId === this.p.extensionId &&
        d.url === action.expectedUrl &&
        Date.parse(d.startTime || "") >= action.at &&
        Date.parse(d.startTime || "") <= action.at + HANDOFF_WINDOW,
    );
    if (candidates.length === 1) {
      item.downloadId = candidates[0].id;
      item.status = "downloading";
      this.event(item, `已核對 Chrome 下載 #${item.downloadId}`);
      await this.save(s);
      await this.syncDownload(s, item);
    } else
      await this.block(
        s,
        item,
        candidates.length
          ? "找到多筆可能的 Chrome 下載，請人工核對"
          : "Chrome 交接結果未知，為避免重複下載已暫停",
      );
  }
  private async syncDownload(s: AppState, item: QueueItem): Promise<void> {
    if (item.downloadId === undefined) return;
    if (isTerminal(item.status)) return;
    const [d] = await this.p.downloads.search({ id: item.downloadId });
    if (!d) {
      await this.block(s, item, "Chrome 找不到已保存的下載紀錄，請人工核對");
      return;
    }
    item.bytesReceived = d.bytesReceived;
    item.totalBytes = d.totalBytes;
    item.downloadPaused = d.paused;
    item.canResume = d.canResume;
    const fileName = d.filename?.split(/[\\/]/).pop();
    if (fileName) item.title = fileName;
    const now = this.p.now();
    if (this.lastSample?.id === d.id && now > this.lastSample.at)
      item.speed = Math.max(
        0,
        ((d.bytesReceived - this.lastSample.bytes) * 1000) /
          (now - this.lastSample.at),
      );
    this.lastSample = { id: d.id, bytes: d.bytesReceived, at: now };
    if (d.danger && !["safe", "accepted"].includes(d.danger)) {
      await this.block(s, item, `Chrome 安全性阻擋：${d.danger}`);
      return;
    }
    if (d.state === "complete") {
      item.status = "complete";
      item.reason = undefined;
      this.event(item, "下載完成");
      if (s.activeId === item.id) {
        s.activeId = undefined;
        s.hostNotBefore = Math.max(s.hostNotBefore || 0, now + HOST_GAP);
      }
      await this.save(s);
      await this.syncExtractions(s);
      if (s.running) await this.pump(s);
      return;
    }
    if (d.state === "interrupted") {
      if (d.canResume || /USER_SHUTDOWN|CRASH/i.test(d.error || ""))
        await this.block(
          s,
          item,
          `Chrome 下載中斷（${d.error || "可續傳"}），請先在 Chrome 核對`,
        );
      else
        await this.fail(
          s,
          item,
          `Chrome 明確中止下載：${d.error || "未知原因"}`,
        );
      return;
    }
    item.status = "downloading";
    if (!s.running && !d.paused) {
      /* paused queue still observes Chrome; do not resume or start another item */
    }
    await this.save(s);
  }
  onAlarm(): Promise<AppState> {
    return this.serial(async () => {
      const s = await this.load();
      await this.syncExtractions(s);
      const item = s.items.find((x) => x.id === s.activeId);
      if (item?.gallery) {
        if (item.downloadId !== undefined)
          await this.syncGalleryDownload(s, item);
        else if (item.action?.kind === "download")
          await this.recoverGalleryHandoff(s, item);
        else if (
          s.running &&
          !["blocked", "failed", "complete"].includes(item.status)
        )
          await this.startGalleryPage(s, item, true);
        const current = await this.load();
        await this.arm(current);
        return structuredClone(current);
      }
      if (!item) {
        if (s.running) await this.pump(s);
        await this.arm(await this.load());
        return structuredClone(await this.load());
      }
      if (!s.running) {
        if (item.status === "downloading" && item.downloadId !== undefined)
          await this.syncDownload(s, item);
        await this.arm(await this.load());
        return structuredClone(await this.load());
      }
      if (item.status !== "downloading" && item.status !== "handoff") {
        const externalIds = new Set(
          s.items.flatMap((x) =>
            x.downloadId === undefined ? [] : [x.downloadId],
          ),
        );
        const [knownExternal] =
          s.externalDownloadId === undefined
            ? []
            : await this.p.downloads.search({ id: s.externalDownloadId });
        const external =
          knownExternal && knownExternal.state === "in_progress"
            ? knownExternal
            : await this.findExternal(
                externalIds,
                undefined,
                s.detachedDownloadIds,
              );
        if (external) {
          await this.waitForExternal(s, external);
          return structuredClone(await this.load());
        }
        if (s.externalDownloadId !== undefined || s.externalWaitReason) {
          s.externalDownloadId = undefined;
          s.externalWaitReason = undefined;
          s.externalTransfer = undefined;
          await this.save(s);
        }
      }
      if (item.downloadId !== undefined) await this.syncDownload(s, item);
      else if (item.status === "handoff") await this.recoverHandoff(s, item);
      else if (
        item.status === "waiting" &&
        (item.waitUntil || 0) <= this.p.now()
      ) {
        s.hostNotBefore = undefined;
        item.status = "preparing";
        item.waitUntil = undefined;
        this.event(item, "等待結束，繼續觀察來源頁");
        await this.save(s);
        if (item.tabId !== undefined) {
          try {
            await this.p.tabs.send(item.tabId, { type: "QC_OBSERVE" });
          } catch {
            await this.block(s, item, "等待結束但來源分頁無法回應");
          }
        }
      } else if (
        item.status === "preparing" ||
        item.status === "verification"
      ) {
        const marker = item.events.find(
          (e) => e.message === "頁面狀態尚未辨識（等待判定）",
        );
        if (
          item.status === "preparing" &&
          marker &&
          this.p.now() - marker.at >= UNKNOWN_GRACE
        )
          await this.block(s, item, "無法辨識頁面狀態，請人工檢查");
        else
          try {
            if (item.tabId !== undefined)
              await this.p.tabs.send(item.tabId, { type: "QC_OBSERVE" });
          } catch {
            await this.block(s, item, "來源分頁無法回應，請人工核對");
          }
      } else if (s.running) await this.pump(s);
      const current = await this.load();
      await this.arm(current);
      await this.updateBadge(current);
      return structuredClone(current);
    });
  }
  onStartup(): Promise<AppState> {
    return this.serial(async () => {
      const s = await this.load();
      await this.syncExtractions(s);
      const item = s.items.find((x) => x.id === s.activeId);
      if (item?.gallery) {
        if (item.downloadId !== undefined)
          await this.syncGalleryDownload(s, item);
        else if (item.action?.kind === "download")
          await this.recoverGalleryHandoff(s, item);
        else if (
          s.running &&
          !["blocked", "failed", "complete"].includes(item.status)
        )
          await this.startGalleryPage(s, item, true);
      } else if (item?.downloadId !== undefined)
        await this.syncDownload(s, item);
      else if (item?.status === "handoff") await this.recoverHandoff(s, item);
      else if (
        s.running &&
        item &&
        !["blocked", "failed", "complete"].includes(item.status)
      ) {
        try {
          if (item.tabId !== undefined) {
            const t = await this.p.tabs.get(item.tabId);
            if (!t.url || !this.isSourceFor(item, t.url)) throw new Error();
            if (
              item.action?.kind !== "download" &&
              migrateLegacyKatfileSource(t.url) !== t.url
            ) {
              await this.reconnectSource(s, item, undefined, true);
              await this.p.tabs.update(item.tabId, { url: item.sourceUrl });
            }
            // A restored/discarded page may not have a content receiver yet.
            // Keep its saved wait; the deadline alarm will inspect before advancing.
            else if (
              item.status !== "waiting" ||
              (item.waitUntil || 0) <= this.p.now()
            )
              await this.p.tabs.send(item.tabId, { type: "QC_OBSERVE" });
          } else throw new Error();
        } catch {
          await this.block(s, item, "瀏覽器重啟後無法核對來源分頁，請明確重試");
        }
      } else if (!item && s.running) await this.pump(s);
      const current = await this.load();
      await this.arm(current);
      await this.updateBadge(current);
      return structuredClone(current);
    });
  }
  onTabRemoved(tabId: number): Promise<AppState> {
    return this.serial(async () => {
      const s = await this.load();
      const i = s.items.find((x) => x.id === s.activeId);
      if (
        i?.tabId === tabId &&
        !["downloading", "handoff"].includes(i.status)
      ) {
        this.event(i, `Chrome 回報工作分頁識別碼 ${tabId} 已移除`);
        await this.block(
          s,
          i,
          "工作分頁追蹤已中斷；若已開始下載，請核對 Chrome 下載。",
        );
      }
      return structuredClone(s);
    });
  }
  onDownloadCreated(d: DownloadRecord): Promise<AppState> {
    return this.serial(async () => {
      const s = await this.load();
      const item = s.items.find(
        (x) =>
          x.status === "handoff" &&
          x.action?.kind === "download" &&
          x.action.expectedUrl === d.url &&
          d.byExtensionId === this.p.extensionId &&
          d.startTime &&
          Math.abs(Date.parse(d.startTime) - (x.action?.at || 0)) <=
            HANDOFF_WINDOW,
      );
      if (item) {
        const actionAt = item.action?.at || 0;
        const candidates = (
          await this.p.downloads.search({
            startedAfter: new Date(actionAt - 1).toISOString(),
            startedBefore: new Date(
              actionAt + HANDOFF_WINDOW + 1,
            ).toISOString(),
          })
        ).filter(
          (x) =>
            x.byExtensionId === this.p.extensionId &&
            x.url === d.url &&
            Math.abs(Date.parse(x.startTime || "") - actionAt) <=
              HANDOFF_WINDOW,
        );
        if (candidates.length === 1) {
          item.downloadId = d.id;
          item.status = "downloading";
          this.event(
            item,
            item.gallery
              ? `Chrome 已建立圖庫圖片下載 #${d.id}`
              : `Chrome 已建立下載 #${d.id}`,
          );
          await this.save(s);
          if (item.gallery) await this.syncGalleryDownload(s, item);
        } else
          await this.block(
            s,
            item,
            candidates.length
              ? "Chrome 建立多筆可能下載，請人工核對"
              : "Chrome 建立的下載尚無法核對，請人工檢查",
          );
      } else if (
        d.state === "in_progress" &&
        d.byExtensionId !== this.p.extensionId &&
        [d.url, d.finalUrl, d.referrer].some(
          (u) => !!u && this.isKatfileReference(u),
        )
      ) {
        const active = s.items.find((x) => x.id === s.activeId);
        if (
          s.running &&
          (active
            ? !["downloading", "handoff", "blocked"].includes(active.status)
            : s.items.some((x) => x.status === "queued"))
        ) {
          await this.waitForExternal(s, d);
          await this.arm(s);
        }
      }
      return structuredClone(s);
    });
  }
}
