本報告為針對 **QueueCat Chrome MV3** 外掛之唯讀正確性審查（Bounded Read-Only Correctness Review），範圍聚焦於 `D:\MyGame\QueueCat` 及其核心檔案（`src/background/engine.ts`、`src/background/index.ts`、`src/content/index.ts`、`src/content/katfile.ts`、`src/shared/types.ts`、`tests/engine.test.ts` 及各測試套件）。

審查對焦於產品核心規格與不可變式（Invariants）：
1. Katfile 免費下載；
2. 一次只處理一筆，Chrome 完成後才下一筆；
3. 等待以網站實際倒數為準，120 分鐘泛用提示不當倒數；
4. 人工 CAPTCHA；
5. 已確認 downloadId 才下載中；
6. 未知交接停止不重送；
7. 休眠／重啟恢復需核對；
8. 暫停只停後續網站操作；
9. 偵測既有 Katfile 下載要保護它。

---

## 審查發現摘要

經程式碼邏輯與執行期路徑核對，本專案在單一串行隊列（`serial` 鏈）、泛用 120 分鐘政策防呆（以 `#kfaTimer` / 實體倒數為主）、既有 Katfile 下載保護、暫停僅停排隊不停 Chrome 傳輸，以及未確認 downloadId 前維持 `handoff` 等規格實作方向正確。

然而，在 **「真實瀏覽器執行期環境（MV3 Service Worker 閒置喚醒、實體分頁生命週期、POST 轉址與 Chrome Downloads API 邊界）」** 存在 4 項明確的 P0/P1 邏輯缺陷，以及 1 項待驗證的導覽競爭風險，會直接破壞實站自動排隊規格。

---

### 發現 1【P0/P1】Content Script `handleAction` 網址嚴格比對導致免費步驟被拒絕執行
* **具體檔案／行號**：`src/content/index.ts`（約第 66～77 行）
* **破壞規格**：Katfile 免費下載自動化、一次只處理一筆。
* **觸發步驟**：
  1. 使用者加入未帶副檔名的 Katfile 網址（例如 `https://katfile.biz/abcdefgh1234`）或 `.com` 別名網址（例如 `https://katfile.com/abcdefgh1234`），被 `urls.ts` 的 `normalizeSource` 視為合法來源。
  2. 排隊引擎啟動並開啟該來源分頁，Katfile 伺服器在實站會將分頁 301/302 導覽至標準檔案頁（例如 `https://katfile.biz/abcdefgh1234/file.rar.html`）。
  3. Content Script 觀察到合法免費表單，背景發出 `QC_PAGE_ACTION`（`action.expectedUrl` 為佇列項目的原始來源網址 `item.sourceUrl`）。
  4. 分頁端收到指令並執行：
     ```ts
     const expected = new URL(action.expectedUrl);
     const current = new URL(window.location.href);
     if (
       expected.origin !== current.origin ||
       expected.pathname !== current.pathname
     )
       return { ok: false, error: "目前頁面與佇列要求的檔案頁不符。" };
     ```
* **結果**：
  由於 `expected.pathname`（`/abcdefgh1234`）與實站轉址後的 `current.pathname`（`/abcdefgh1234/file.rar.html`）不相等，或 `.com` 與 `.biz` 之 `origin` 不相等，`handleAction` 直接回傳錯誤，導致免費下載按鈕**完全不會被點擊**，任務卡在準備階段或直接報錯。
* **最小修正方向**：
  在 `src/content/index.ts` 中，比對不可採用字串全等；應改用 `urls.ts` 已定義的 `isKatfileHost` 與 `sourceKey` 比對 Katfile 檔案識別碼（File ID）：
  ```ts
  if (!isKatfileHost(current.hostname) || sourceKey(action.expectedUrl) !== sourceKey(window.location.href))
    return { ok: false, error: "目前頁面與佇列要求的檔案頁不符。" };
  ```

---

### 發現 2【P1】`onDownloadCreated` 內的 `downloads.search` 下界條件過嚴，容易排除剛建立的下載造成假性「多筆下載」阻斷
* **具體檔案／行號**：`src/background/engine.ts`（`onDownloadCreated` 函式內，約第 980～1010 行）
* **破壞規格**：已確認 downloadId 才下載中、未知交接停止不重送。
* **觸發步驟**：
  1. 背景接收到頁面回報 `kind: "ready"`，將任務轉為 `handoff` 並記錄 `actionAt = item.action.at`，隨後呼叫 `chrome.downloads.download({ url: finalUrl })`。
  2. Chrome 建立下載項目並觸發 `chrome.downloads.onCreated(d)`。
  3. `engine.onDownloadCreated` 找到該 `item`，隨後發起 `downloads.search` 進行反查核對：
     ```ts
     const candidates = (
       await this.p.downloads.search({
         startedAfter: new Date(actionAt).toISOString(),
         startedBefore: new Date(actionAt + HANDOFF_WINDOW).toISOString(),
       })
     ).filter(
       (x) =>
         x.byExtensionId === this.p.extensionId &&
         x.url === d.url &&
         Math.abs(Date.parse(x.startTime || "") - actionAt) <= HANDOFF_WINDOW,
     );
     if (candidates.length === 1) {
       item.downloadId = d.id;
       item.status = "downloading";
       ...
     } else await this.block(s, item, "Chrome 建立多筆可能下載，請人工核對");
     ```
  4. 在真實 Chromium 實作中（`DownloadQuery::Filter`），`startedAfter` 採嚴格大於（`GetStartTime() > started_after_`）。若 Chrome 回報的 `d.startTime` 因行程間時鐘精確度或儲存非同步延遲而等於或略早於 `actionAt`，該筆下載會被 Chromium 搜尋過濾排除，導致 `candidates` 為空陣列（長度為 0）。
* **結果**：
  `candidates.length === 1` 為 false，程式直接進入 `else` 分支，將任務阻斷並設定錯誤訊息為 `"Chrome 建立多筆可能下載，請人工核對"`（即使候選為 0 筆也誤報為多筆），使正常的自動下載交接中斷，被迫轉為手動認領。
* **最小修正方向**：
  1. `downloads.search` 查詢下界應對齊後續的雙向容許視窗，將 `startedAfter` 放寬為 `new Date(actionAt - HANDOFF_WINDOW).toISOString()`。
  2. 區分 `candidates.length === 0` 與 `> 1`，且若 `onDownloadCreated` 所傳入的 `d` 已完全符合擴充功能識別碼與預期網址且無歧義，應以 `d.id` 作為安全交接基準。

---

### 發現 3【P1】`onTabRemoved` 誤將 `waiting` 倒數中的分頁關閉判定為追蹤失敗並阻斷隊列
* **具體檔案／行號**：`src/background/engine.ts`（`onTabRemoved` 函式內，約第 950～970 行）
* **破壞規格**：等待以網站實際倒數為準、遵守網站等待不中斷。
* **觸發步驟**：
  1. Katfile 顯示需冷卻 120 分鐘（例如實際倒數 3767 秒），QueueCat 成功辨識並進入 `status: "waiting"`，排程 `waitUntil` alarm。
  2. 使用者在長達 1～2 小時的冷卻等待期間，手動關閉了該 Katfile 分頁（或瀏覽器因資源回收而卸載分頁）。
  3. Chrome 發出 `chrome.tabs.onRemoved`，觸發 `onTabRemoved`：
     ```ts
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
     ```
* **結果**：
  雖然測試規格明確指出 `blocks only preparing tabs when their source tab closes`，但實作邏輯卻是排除 `downloading` 與 `handoff`。這導致處於 `waiting` 的任務直接被阻斷為 `blocked`，取消了後續倒數結束後的重試，完全破壞背景長時等待規格。
* **最小修正方向**：
  修正判斷式，僅在頁面正處於操作中（`preparing`）時才視為追蹤中斷：
  ```ts
  if (i?.tabId === tabId && i.status === "preparing") {
    await this.block(s, i, "工作分頁追蹤已中斷；若已開始下載，請核對 Chrome 下載。");
  } else if (i?.tabId === tabId && i.status === "waiting") {
    i.tabId = undefined; // 釋放已關閉分頁參照，時間到由 alarm/pump 重新開啟
    await this.save(s);
  }
  ```

---

### 發現 4【P1】Service Worker 閒置喚醒（Idle Wakeup）時誤將背景分頁卸載／休眠當作重啟失敗阻斷任務
* **具體檔案／行號**：`src/background/engine.ts`（`onStartup`，約第 920～945 行）及 `src/background/index.ts`（頂層喚醒呼叫）
* **破壞規格**：休眠／重啟恢復需核對。
* **觸發步驟**：
  1. 外掛處於排隊或等待狀態，Chrome MV3 Service Worker 在 30 秒無事件後自動休眠終止。
  2. 使用者開啟其他分頁，Chrome Memory Saver（Chrome 120+ 預設啟用）將背景未聚焦的 Katfile 分頁標記為 `discarded`（卸載分頁內容腳本但保留分頁標籤）。
  3. 倒數鬧鐘觸發或使用者點擊擴充功能圖示開啟彈窗，Service Worker 啟動重新載入 `src/background/index.ts`，執行頂層代碼：
     ```ts
     void engine.onStartup().catch(() => undefined);
     ```
  4. `engine.onStartup()` 對活躍任務執行核對：
     ```ts
     const t = await this.p.tabs.get(item.tabId);
     if (!t.url || !this.isSourceFor(item, t.url)) throw new Error();
     await this.p.tabs.send(item.tabId, { type: "QC_OBSERVE" });
     ```
  5. 由於該分頁處於 `discarded` 狀態，Content Script 未載入，`chrome.tabs.sendMessage` 立即拋出例外（`Could not establish connection. Receiving end does not exist.`）。
* **結果**：
  執行流直接落入 `catch`，執行：
  `await this.block(s, item, "瀏覽器重啟後無法核對來源分頁，請明確重試");`
  任務在瀏覽器完全沒有重啟的情況下，僅因 Service Worker 正常閒置喚醒與分頁休眠，即被錯誤阻斷。
* **最小修正方向**：
  在 `onStartup` 核對分頁時：
  1. 若 `item.status === "waiting"`，不應強求 Content Script 立即回應，因倒數由 `waitUntil` 守護。
  2. 檢查 `t.discarded`，若分頁被凍結／卸載，應呼叫 `chrome.tabs.reload(item.tabId)` 喚醒分頁，或給予重試寬限，不可直接將正常隊列阻斷。

---

### 發現 5【待驗證】Content Script 在按鈕原生點擊後立即以 `setTimeout(0)` 回報舊 DOM 狀態
* **具體檔案／行號**：`src/content/index.ts`（約第 108 行）
* **破壞規格**：未知交接停止不重送、單一串行隊列一致性。
* **觸發步驟**：
  1. Content Script 收到 `QC_PAGE_ACTION`（例如點擊第一步的慢速下載按鈕）。
  2. `performFreeAction` 觸發表單提交按鈕的 `element.click()`，啟動 HTTP POST 導覽。
  3. `index.ts` 在收到回應後立即排程 `window.setTimeout(() => report(true), 0)`。
  4. 由於 HTTP 表單請求為非同步網路導覽，在 0 毫秒時瀏覽器分頁尚未跳轉，DOM 仍保留舊的第一步頁面。
  5. `report(true)` 強制將舊頁面狀態（`kind: "free", step: "download1"`）再次發送至背景 Service Worker。
* **結果**：
  背景可能在頁面跳轉前接收到重複的步驟回報，若處理不當可能引發重複 dispatch 或狀態擾動。
* **最小修正方向**：
  表單點擊提交後已觸發導覽，不應在當前即將卸載的 DOM 排程即時回報；應移除此 `setTimeout(..., 0)`，交由跳轉後新頁面的 `document_idle` 注入及 `MutationObserver` 進行回報。

---

QUEUECAT_RUNTIME_REVIEW_DONE

ANTIGRAVITY_BRIDGE_MARKER_1ecf80fcb9b04aa0a35f2631fb599ded
