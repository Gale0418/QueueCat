import type { AppState, ItemStatus, Mascot, QueueItem } from "../shared/types";
import { extractionCopy } from "../shared/extraction-copy";
export const labels: Record<ItemStatus, string> = {
  queued: "排隊中",
  preparing: "準備頁面",
  waiting: "等待網站",
  verification: "需要驗證",
  handoff: "確認下載交接",
  downloading: "Chrome 下載中",
  blocked: "需要你看一下",
  failed: "下載失敗",
  complete: "已完成",
};
export const isAttention = (item: QueueItem) =>
  ["failed", "blocked"].includes(item.status);
export function summary(state: AppState): {
  mascot: Mascot;
  title: string;
  subtitle: string;
} {
  const active = state.items.find((i) => i.id === state.activeId);
  if (!active) {
    const extraction = state.extractions?.find(
      (g) =>
        g.status === "extracting" ||
        g.status === "queued" ||
        g.status === "failed",
    );
    if (extraction)
      return {
        mascot: extraction.status === "failed" ? "confused" : "work",
        title: extractionCopy(extraction.status),
        subtitle: "",
      };
  }
  if (active?.status === "blocked")
    return {
      mascot: "confused",
      title: "需要確認下載狀態",
      subtitle: active.reason || "先確認目前狀態，再讓貓貓繼續。",
    };
  if (active?.status === "verification")
    return {
      mascot: "verify",
      title: "輪到你完成驗證了",
      subtitle: state.running
        ? "在原本的 Katfile 分頁完成驗證，貓貓會接著排。"
        : "排隊已暫停；驗證完成後按「繼續排隊」。",
    };
  if (
    !active &&
    state.cycleNotifiedAt &&
    !state.items.some((i) => i.status === "queued")
  )
    return {
      mascot: "happy",
      title: "這一輪下載完成了",
      subtitle: state.items.some(isAttention)
        ? "有幾筆留在待處理，方便你稍後檢查。"
        : "下載紀錄都幫你收好了，休息一下吧。",
    };
  if (!state.running)
    return {
      mascot: "sleep",
      title:
        active?.status === "downloading"
          ? "排隊暫停，下載繼續"
          : state.items.length
            ? "準備好了，隨時出發"
            : "把等待，交給貓貓。",
      subtitle:
        active?.status === "downloading"
          ? "排隊已暫停，Chrome 裡的下載會繼續。"
          : state.items.some((item) => item.status === "queued")
            ? `已排好 ${state.items.filter((item) => item.status === "queued").length} 個下載，按「開始排隊」就出發。`
            : "貼上 Katfile 網址，剩下的慢慢來。",
    };
  if (state.externalWaitReason)
    return {
      mascot: "sleep",
      title: "等目前那筆下載結束",
      subtitle: state.externalWaitReason,
    };
  if (active?.status === "waiting")
    return {
      mascot: "sleep",
      title: "正在等網站放行",
      subtitle: "網站還在冷卻，貓貓幫你等。",
    };
  if (active?.status === "downloading")
    return {
      mascot: "work",
      title: "正在下載，貓貓顧著",
      subtitle: active.downloadPaused
        ? "目前檔案已在 Chrome 暫停；恢復後會繼續追蹤。"
        : "這筆下載完成後，再輪到下一筆。",
    };
  if (active)
    return {
      mascot: "work",
      title: "正在準備下載",
      subtitle: labels[active.status],
    };
  if (state.items.some((i) => i.status === "queued"))
    return {
      mascot: "sleep",
      title: "等網站允許，再接著來",
      subtitle: "佇列已保存，貓貓正在等候。",
    };
  return {
    mascot: "happy",
    title: "這一輪下載完成了",
    subtitle: state.items.some(isAttention)
      ? "有幾筆留在待處理，方便你稍後檢查。"
      : "下載紀錄都幫你收好了，休息一下吧。",
  };
}
export function briefReason(item: QueueItem): string {
  if (item.status === "waiting") return "倒數結束後，會重新確認網站。";
  if (item.status === "verification") return "請到原分頁完成驗證。";
  if (item.status === "preparing") return "正在確認網站狀態。";
  if (item.status === "blocked") {
    if (item.reason === "來源分頁已關閉") return "工作分頁追蹤已中斷。";
    const sentence = t(item.reason || "需要先確認目前狀態。").split(
      /[；。\n]/,
    )[0];
    return sentence.length > 100 ? sentence.slice(0, 100) + "…" : sentence;
  }
  return item.reason || "貓貓正在看網站的回應。";
}
export function bytes(n?: number): string {
  if (n === undefined || n < 0 || !Number.isFinite(n)) return t("大小未知");
  if (n < 1024) return `${Math.floor(n)} B`;
  const p = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** p).toFixed(p > 1 ? 2 : 0)} ${["B", "KB", "MB", "GB"][p]}`;
}
export function countdown(until?: number): string {
  if (!until) return "";
  const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  if (!s) return t("正在確認網站狀態");
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
export function progress(item: QueueItem): number | undefined {
  return item.totalBytes && item.totalBytes > 0
    ? Math.min(
        100,
        Math.max(0, ((item.bytesReceived || 0) / item.totalBytes) * 100),
      )
    : undefined;
}
export const escape = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
import { translateMessage as t } from "../shared/messages";
