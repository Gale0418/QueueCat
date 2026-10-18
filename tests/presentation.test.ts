import { describe, expect, it } from "vitest";
import { initialState, type QueueItem } from "../src/shared/types";
import {
  briefReason,
  bytes,
  escape,
  progress,
  summary,
} from "../src/ui/presentation";
const item: QueueItem = {
  id: "1",
  sourceUrl: "https://katfile.biz/abcdefgh1234",
  title: "x",
  status: "downloading",
  createdAt: 0,
  updatedAt: 0,
  events: [],
};
describe("狀態與未知資料呈現", () => {
  it("未知大小不產生虛構百分比", () => {
    expect(
      progress({ ...item, totalBytes: -1, bytesReceived: 10 }),
    ).toBeUndefined();
    expect(bytes(-1)).toBe("大小未知");
    expect(bytes(0)).toBe("0 B");
  });
  it("完成後顯示開心圖片，即使排隊已停", () => {
    const s = initialState();
    s.cycleNotifiedAt = 1;
    s.items = [{ ...item, status: "complete" }];
    expect(summary(s).mascot).toBe("happy");
  });
  it("手動暫停下載中只說排隊停了，不說檔案已暫停", () => {
    const s = initialState();
    s.activeId = "1";
    s.items = [item];
    expect(summary(s).subtitle).toContain("Chrome 裡的下載會繼續");
  });
  it("網站提供文字不得變成HTML", () => {
    expect(escape("<img src=x onerror=alert(1)>")).not.toContain("<img");
  });
  it("舊版分頁提示在小摘要改為追蹤中斷，完整原因仍留在原資料", () => {
    const blocked = { ...item, status: "blocked" as const, reason: "來源分頁已關閉" };
    expect(briefReason(blocked)).toBe("工作分頁追蹤已中斷。");
    expect(blocked.reason).toBe("來源分頁已關閉");
  });
  it("實站等待原文含重複升級廣告時，摘要仍維持簡短，原始原因保留", () => {
    const reason =
      "下載之間不少於120分鐘，請稍後再試。05:07 升級至高級版 ".repeat(3);
    const waiting = { ...item, status: "waiting" as const, reason };
    const state = {
      ...initialState(),
      running: true,
      activeId: item.id,
      items: [waiting],
    };
    expect(summary(state).subtitle).toBe("網站還在冷卻，貓貓幫你等。");
    expect(briefReason(waiting)).not.toContain("升級");
    expect(waiting.reason).toBe(reason);
  });
});
