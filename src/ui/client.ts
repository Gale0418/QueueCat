import {
  initialState,
  type AppState,
  type Command,
  type Response,
} from "../shared/types";
import { normalizeSource, sourceKey } from "../shared/urls";
export const preview = !globalThis.chrome?.runtime?.id;
let sample = initialState();
export function scenario(name: string): void {
  sample = initialState();
  if (name === "empty") return;
  const now = Date.now();
  sample.items = Array.from({ length: 5 }, (_, n) => ({
    id: `preview-${n}`,
    sourceUrl: `https://katfile.biz/demo0000000${n}/示意檔案.part0${n + 1}.rar.html`,
    title: `週末的小收藏.part0${n + 1}.rar`,
    status: n === 0 ? "downloading" : n === 4 ? "complete" : "queued",
    createdAt: now,
    updatedAt: now,
    events: [{ at: now, message: "這是離線示意資料，不會下載檔案。" }],
  }));
  sample.running = true;
  sample.activeId = sample.items[0].id;
  Object.assign(sample.items[0], {
    bytesReceived: 382 * 1024 ** 2,
    totalBytes: 1.2 * 1024 ** 3,
    speed: 48 * 1024,
  });
  if (name === "waiting")
    Object.assign(sample.items[0], {
      status: "waiting",
      waitUntil: now + 272000,
      reason:
        "Katfile 顯示免費下載等待：下載之間的等待時間必須不少於120分鐘，請稍後再試。05:07 升級至高級版 ".repeat(
          3,
        ),
    });
  if (name === "verification") sample.items[0].status = "verification";
  if (name === "blocked")
    Object.assign(sample.items[0], {
      status: "blocked",
      reason: "下載交接結果不明，請先在 Chrome 下載紀錄確認。",
    });
  if (name === "unknown-size") sample.items[0].totalBytes = -1;
  if (name === "long-name")
    sample.items[0].title =
      "這是一個很長很長的檔案名稱_為了確認繁體中文與空格都不會撐破版面_週末收藏備份.part01.rar";
  if (name === "complete") {
    sample.activeId = undefined;
    sample.items.forEach((i) => (i.status = "complete"));
  }
}
export async function request(command?: Command): Promise<Response> {
  if (!preview) {
    try {
      return await chrome.runtime.sendMessage(
        command ? { type: "QC_COMMAND", command } : { type: "QC_GET" },
      );
    } catch {
      return { ok: false, error: "無法連上貓貓，請重新載入外掛後再試。" };
    }
  }
  if (command) {
    const item =
      "id" in command
        ? sample.items.find((i) => i.id === command.id)
        : undefined;
    switch (command.kind) {
      case "add":
        for (const raw of command.urls) {
          const url = normalizeSource(raw);
          if (
            url &&
            !sample.items.some((i) => sourceKey(i.sourceUrl) === sourceKey(url))
          )
            sample.items.push({
              id: crypto.randomUUID(),
              sourceUrl: url,
              title: "",
              status: "queued",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              events: [],
            });
        }
        break;
      case "start":
        sample.running = true;
        break;
      case "pause":
        sample.running = false;
        break;
      case "adopt-download":
        if (item?.status === "blocked") {
          item.status = "downloading";
          item.downloadId = command.downloadId;
          item.reason = undefined;
        }
        break;
      case "settings":
        Object.assign(sample.settings, command.settings);
        break;
      case "remove":
        sample.items = sample.items.filter((i) => i.id !== command.id);
        break;
      case "retry":
        if (item) {
          item.status = "queued";
          item.reason = undefined;
          if (sample.activeId === item.id) sample.activeId = undefined;
        }
        break;
      case "clear-complete":
        sample.items = sample.items.filter((i) => i.status !== "complete");
        break;
      case "move": {
        const i = sample.items.findIndex((t) => t.id === command.id),
          j = i + command.direction;
        if (
          i >= 0 &&
          j >= 0 &&
          j < sample.items.length &&
          sample.items[j].status === "queued"
        )
          [sample.items[i], sample.items[j]] = [
            sample.items[j],
            sample.items[i],
          ];
        break;
      }
      case "open-manager":
        window.location.href = `/manager.html?preview=1${command.section ? "#" + command.section : ""}`;
        break;
      default:
        return {
          ok: true,
          state: sample,
          error: "離線預覽不會操作 Chrome 或開始下載。",
        };
    }
  }
  return { ok: true, state: structuredClone(sample) };
}
export const demoState = (): AppState => structuredClone(sample);
export async function findDownloads(id: string): Promise<Response> {
  if (preview) {
    const item = sample.items.find((i) => i.id === id);
    return {
      ok: true,
      downloads:
        item?.status === "blocked"
          ? [
              {
                id: 101,
                filename: item.title,
                host: "s1.katfile.biz",
                state: "in_progress",
                startTime: new Date().toISOString(),
                bytesReceived: 382 * 1024 ** 2,
                totalBytes: 1.2 * 1024 ** 3,
              },
            ]
          : [],
    };
  }
  try {
    return await chrome.runtime.sendMessage({ type: "QC_FIND_DOWNLOADS", id });
  } catch {
    return { ok: false, error: "無法讀取 Chrome 下載，請稍後再試。" };
  }
}
