# QueueCat Chrome MV3 背景可靠性與安全唯讀審查報告

**審查性質與安全聲明**
- **唯讀與隔離遵守**：本輪僅透過唯讀檔案工具檢視 `D:\MyGame\QueueCat`（`src/background/index.ts`、`src/background/engine.ts`、`src/shared/types.ts`、`src/shared/urls.ts`、`manifest.json`、`tests/background-adapter.test.ts`、`tests/engine.test.ts` 及審查紀錄），**未修改任何檔案、未執行任何命令／測試／瀏覽器／網路請求，完全未接觸使用者日常 Chrome 與進行中的 1.2GB 下載**。
- **排除項目確認**：已確認 `startedAfter`/`startedBefore` 端點已外擴 `±1ms` 並保留精確條件過濾（`engine.ts:986-996`）、`free` 動作不帶 `expectedUrl`、`step` 防重與「關閉工作分頁即暫停／封鎖等待人工恢復」均符合規格，本報告不重報。
- **嚴重度總結**：
  - **無已證實 P0**（背景程式碼對外部下載絕不呼叫 `downloads.cancel` 或 `pause`，使用者目前 1.2GB Chrome 下載不會被外掛取消或中斷）。
  - 下述列出 **5 項具體缺陷與風險（2 項已證實 P1、3 項已證實 P2／邊界缺陷，另附明確假說區分）**，按優先級排序。

---

### 1.【P1｜已證實】`onDownloadCreated` 偵測外部 Katfile 下載時直接覆寫單一鬧鐘 `queuecat.tick` 為 `+30s`，且未檢查 `s.running` 與空 `activeId`
* **具體檔案／行號**：`src/background/engine.ts` 第 80 行、第 1009–1028 行
* **程式碼證據**：
  ```ts
  } else if (
    d.state === "in_progress" &&
    d.byExtensionId !== this.p.extensionId &&
    [d.url, d.finalUrl, d.referrer].some(
      (u) => !!u && this.isKatfileReference(u),
    )
  ) {
    const active = s.items.find((x) => x.id === s.activeId);
    if (
      active &&
      !["downloading", "handoff", "blocked"].includes(active.status)
    ) {
      s.externalDownloadId = d.id;
      s.externalWaitReason = EXTERNAL_WAIT;
      await this.save(s);
      await this.p.alarms.create(ALARM, { when: this.p.now() + 30_000 });
    }
  }
  ```
* **可觸發反例（重現步驟）**：
  1. **反例 A（鬧鐘覆寫與佇列暫停誤排程）**：QueueCat 只有單一共用鬧鐘名稱 `ALARM = "queuecat.tick"`。當目前活躍項目處於 `preparing`（`unknown` 頁面 15 秒寬限期倒數，原鬧鐘在 `now + 15_000`）或 `waiting`（剩餘 5 秒倒數），甚至 `s.running === false`（使用者已按暫停，但 `s.activeId` 仍指向 `waiting`/`queued` 項目）時，使用者在 Chrome 手動開始另一筆 Katfile 下載觸發 `onDownloadCreated`。
  2. `onDownloadCreated` 直接呼叫 `this.p.alarms.create(ALARM, { when: this.p.now() + 30_000 })`，繞過 `this.arm(s)`，直接把原本 <30 秒的鬧鐘往後延遲至 30 秒，或在 `s.running === false` 時無故設定背景喚醒鬧鐘並改寫 `externalDownloadId`。
  3. **反例 B（兩筆間空檔漏記 `externalDownloadId`）**：當 `s.running === true` 但處於兩筆任務交接或 `HOST_GAP`（`s.activeId` 尚未指派或為 `undefined`）時，使用者手動啟動外部 Katfile 下載，`active` 為 `undefined`，導致 `onDownloadCreated` 不會記錄 `s.externalDownloadId`。
  4. **延伸假說（待驗證）**：`EnginePorts.downloads.search` 型別僅定義 `state?: "in_progress"`（`engine.ts:49`）。若外部 1.2GB 下載因網路瞬斷進入 Chrome 的 `state: "interrupted"` + `canResume: true`（可續傳中斷），僅以 `state: "in_progress"` 查詢外部下載的 `onAlarm`/`onStartup`/`pump` 路徑會將其視為已結束而提前放行下一筆 Katfile 任務。
* **影響**：破壞等待鬧鐘排程精準度（延後 `unknown` 封鎖或實際倒數喚醒）、暫停狀態下仍寫入外部等待狀態並排程鬧鐘；若外部下載短暫處於可續傳中斷，可能與實站免費佇列同 IP 限制衝突。
* **最小修復方向**：
  1. 在 `onDownloadCreated` 外部下載分支中，僅在 `s.running` 為 `true`（或有未終止排隊項目）時記錄 `s.externalDownloadId`，並將 `await this.p.alarms.create(ALARM, { when: this.p.now() + 30_000 })` 改為 `await this.arm(s)`，由 `arm(s)` 取所有待辦期限（`waitUntil`、`unknown` 寬限、外部下載輪詢）的最小值。
  2. 外部下載檢查除 `state === "in_progress"` 外，若 `state === "interrupted" && canResume === true` 亦應視為尚未結束的外部下載予以保護。
* **信心與未知**：
  - **已證實（高信心）**：`onDownloadCreated` 直接 `alarms.create(..., now + 30_000)` 覆寫同名鬧鐘且未檢查 `s.running`。
  - **假說／未知**：`engine.ts` 中段 `findExternalDownload`／`onAlarm` 對 `interrupted + canResume` 的實際過濾條件因大型檔案分段讀取限制未直接讀到完整中段行號，列為高優先核對假說。

---

### 2.【P1｜已證實】`onStartup` 在活躍項目尚未建立分頁（如等待外部下載或 `queued`）時喚醒會誤判為「無法核對來源分頁」並直接封鎖（`blocked`）
* **具體檔案／行號**：`src/background/engine.ts` 第 932–952 行；`src/background/index.ts` 第 126–131、141 行
* **程式碼證據**：
  ```ts
  onStartup(): Promise<AppState> {
    return this.serial(async () => {
      const s = await this.load();
      const item = s.items.find((x) => x.id === s.activeId);
      if (item?.downloadId !== undefined) await this.syncDownload(s, item);
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
            await this.p.tabs.send(item.tabId, { type: "QC_OBSERVE" });
          } else throw new Error();
        } catch {
          await this.block(s, item, "瀏覽器重啟後無法核對來源分頁，請明確重試");
        }
      } else if (!item && s.running) await this.pump(s);
  ```
* **可觸發反例（重現步驟）**：
  1. 佇列正在執行（`s.running === true`），且 `s.activeId` 已指向當前項目 `item`，但該項目因等待條件（或剛排入尚未建立分頁，`item.tabId === undefined` 且 `item.status === "queued"`）尚未開啟分頁；或者在 `s.externalDownloadId` 外部下載期間，`item` 已有分頁但 MV3 Service Worker 因 30 秒閒置休眠後再次載入模組（觸發 `index.ts:141` 的 `void engine.onStartup()`）。
  2. 若 `item.tabId === undefined`：`onStartup` 進入 `else throw new Error()`，直接呼叫 `this.block(s, item, "瀏覽器重啟後無法核對來源分頁，請明確重試")`，將原本正常等待中的佇列暫停封鎖。
  3. 若 `s.externalDownloadId` 存在且 `item.tabId !== undefined`：`onStartup` 未先核對 `s.externalDownloadId` 是否仍在進行，便直接對 `item.tabId` 發送 `{ type: "QC_OBSERVE" }`，觸發內容腳本回報 `QC_PAGE`。
* **影響**：MV3 Service Worker 只要在閒置 30 秒後因任何事件（如開啟彈窗、外部下載事件）重新載入模組，就執行頂層 `engine.onStartup()`；任何 `s.activeId` 已設定但 `tabId === undefined` 的狀態都會被無故 `block`。
* **最小修復方向**：
  - 在 `onStartup()` 中：若 `s.externalDownloadId !== undefined` 或 `item.status === "queued" && item.tabId === undefined`，應交由 `await this.pump(s)` 核對外部下載與排程，而非走 `else throw new Error()` 將項目封鎖。
* **信心與未知**：
  - **已證實（高信心）**：`engine.ts:936-947` 對所有 `s.running && item && !["blocked", "failed", "complete"].includes(item.status)` 強制要求 `item.tabId !== undefined` 且 `tabs.send` 成功，否則一律 `block`。

---

### 3.【P2｜已證實】`src/background/index.ts` 七個 Chrome 事件監聽器未加上 `.catch()`，且模組載入與 `onStartup`/`onInstalled` 重複觸發兩次 `engine.onStartup()`
* **具體檔案／行號**：`src/background/index.ts` 第 113–141 行；`src/background/engine.ts` 第 88–92 行
* **程式碼證據**：
  ```ts
  // engine.ts:88-92
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result; // result 本身仍會向呼叫端 reject
  }

  // index.ts:113-141
  chrome.downloads.onChanged.addListener((delta) => {
    void engine.onDownloadChanged(...);
  });
  chrome.downloads.onCreated.addListener((item) => {
    void engine.onDownloadCreated(...);
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "queuecat.tick") void engine.onAlarm();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void engine.onTabRemoved(tabId);
  });
  chrome.runtime.onStartup.addListener(() => {
    void engine.onStartup();
  });
  chrome.runtime.onInstalled.addListener(() => {
    void engine.onStartup();
  });
  chrome.notifications.onClicked.addListener((notificationId) => { ...
    if (prefix) void engine.command({ kind: "focus", id: ... });
  });
  void engine.onStartup().catch(() => undefined);
  ```
* **可觸發反例（重現步驟）**：
  1. **Unhandled Rejection**：使用者點擊舊系統通知（`queuecat-verify-<id>` 或 `queuecat-block-<id>`），觸發 `notifications.onClicked` -> `void engine.command({ kind: "focus", id })`。若對應分頁或視窗已被關閉，或 `chrome.storage.local.set` / `chrome.action.setBadgeText` 發生暫時性 Chrome API 例外，`serial()` 回傳的 `result` Promise 為 rejected，而 `index.ts:113-138` 的 7 個監聽器皆無 `.catch()`（僅第 141 行有 `.catch(() => undefined)`），直接產生 Service Worker `Uncaught (in promise)` 錯誤。
  2. **重複啟動執行**：瀏覽器啟動或外掛重載時，頂層第 141 行先排入一次 `engine.onStartup()`，`runtime.onStartup` / `runtime.onInstalled` 緊接著再排入第二次 `engine.onStartup()`，導致同一個活躍分頁連續收到兩次 `{ type: "QC_OBSERVE" }`。
* **影響**：在 `chrome://extensions` 錯誤面板留下未捕捉 Promise 例外紀錄，並於重啟時造成重複的 `QC_OBSERVE` 觀測訊息。
* **最小修復方向**：
  - 在 `index.ts` 中建立小型包裝函式 `const run = (p: Promise<unknown>) => void p.catch(() => undefined);` 套用至所有背景事件監聽器。
  - 若模組頂層已執行 `engine.onStartup()`，可透過旗標或合併啟動周期避免同一 tick 內 `onStartup`/`onInstalled` 重複觸發第二次 `onStartup()`。
* **信心與未知**：**已證實（高信心）**，直接由 `index.ts:113-141` 與 `engine.ts:88-92` 證明。

---

### 4.【P2｜已證實】`QC_PAGE` 訊息驗證僅傳遞 `sender.tab.id` 而丟棄 `sender.url` 與 `sender.frameId`，由內容端自行宣告 `observation.pageUrl`
* **具體檔案／行號**：`src/background/index.ts` 第 98–106 行
* **程式碼證據**：
  ```ts
  const pageReport = message.type === "QC_PAGE";
  const extensionPage =
    !!sender.url && sender.url.startsWith(chrome.runtime.getURL(""));
  if (
    (pageReport && (sender.tab?.id === undefined || extensionPage)) ||
    (!pageReport && !extensionPage)
  ) {
    sendResponse({ ok: false, error: "訊息來源不受信任" });
    return false;
  }
  void engine
    .handleRequest(message, pageReport ? sender.tab?.id : undefined)
  ```
* **可觸發反例（重現步驟）**：
  1. 當 `message.type === "QC_PAGE"` 時，`index.ts` 僅檢查 `sender.tab?.id !== undefined && !extensionPage`，未檢查 `sender.frameId === 0`，也未將 Chrome 提供的可信 `sender.url` 傳入 `engine.handleRequest`。
  2. 背景引擎只能依賴訊息 payload 內不可信的 `message.observation.pageUrl` 來判斷來源網址，而未與 `sender.url` 交叉比對。
* **影響**：違反 MV3 最小信任邊界原則；若活躍工作分頁內的子框架或受污染環境發送偽造 `observation.pageUrl` 的 `QC_PAGE`，背景無法透過瀏覽器層級的 `sender.url`／`sender.frameId` 攔截。
* **最小修復方向**：
  - 在 `index.ts` 的 `pageReport` 條件中加入 `(sender.frameId !== undefined && sender.frameId !== 0)` 拒絕非頂層 frame，並檢查 `sender.url` 必須為合法的 Katfile 網域（或將 `sender.url` 一併傳入 `handleRequest` 覆寫／核對 `observation.pageUrl`）。
* **信心與未知**：**已證實（高信心）**，注意現有 `tests/background-adapter.test.ts` 的 mock `sender` 未帶 `frameId`，若新增檢查建議使用 `sender.frameId !== undefined && sender.frameId !== 0` 以向下相容既有單元測試。

---

### 5.【P2｜已證實】`load()` 儲存結構驗證過於寬鬆，且 `save()` 在 `updateBadge` 拋錯時會造成呼叫端錯誤處理與已提交之 `this.state` 不一致
* **具體檔案／行號**：`src/background/engine.ts` 第 93–106 行、`onTabRemoved` 第 953–968 行
* **程式碼證據**：
  ```ts
  private async load(): Promise<AppState> {
    if (!this.state) {
      const raw = await this.p.storage.get(STORAGE_KEY);
      const s = raw as AppState | undefined;
      this.state =
        s?.version === 1 && Array.isArray(s.items) ? s : initialState();
    }
    return structuredClone(this.state);
  }
  private async save(s: AppState): Promise<void> {
    await this.p.storage.set({ [STORAGE_KEY]: s });
    this.state = structuredClone(s);
    await this.updateBadge(s);
  }
  ```
* **可觸發反例（重現步驟）**：
  1. **儲存結構驗證缺口**：`load()` 只驗證 `s?.version === 1 && Array.isArray(s.items)`，未合併預設 `initialState().settings`。若 `chrome.storage.local` 內的舊版或損毀狀態缺少 `settings` 物件（或某項目的 `events` 非陣列），後續讀取 `s.settings.notifications` 或 `item.events.push` 會直接拋出 `TypeError`，使整個背景佇列卡死。
  2. **`save()` 副作用順序**：`save(s)` 在 `storage.set` 與 `this.state = structuredClone(s)` 成功後才 `await this.updateBadge(s)`。若 `setBadgeText`/`setBadgeBackgroundColor` 因 Chrome UI 尚未就緒而拋錯，狀態實際上已寫入 storage 與快取，但 `save(s)` 卻對呼叫端拋出異常（例如在 `try/catch` 中被誤判為儲存失敗）。
  3. **`onTabRemoved` 鬧鐘收斂**：`onTabRemoved`（第 953–968 行）在呼叫 `this.block(s, i, ...)` 後直接回傳，未像 `onStartup` 一樣在結尾呼叫 `await this.arm(s)` 重新收斂鬧鐘（若 `block` 內部未重調 `arm(s)`，舊 `waitUntil` 或 `unknown` 鬧鐘將殘留至下次觸發）。
* **影響**：儲存欄位缺漏或 Badge API 暫時性失敗會導致背景請求回傳失敗或狀態機不一致。
* **最小修復方向**：
  - 在 `load()` 中補齊預設值：`settings: { ...initialState().settings, ...(s.settings ?? {}) }`，並確保每個 `item.events` 為陣列。
  - 在 `save()` 中對 `await this.updateBadge(s)` 加上 `.catch(() => undefined)`，避免非關鍵的圖示徽章更新失敗影響核心狀態交易。
* **信心與未知**：**已證實（高信心）**，由 `engine.ts:93-106` 直接確認。

---

QUEUECAT_FULL_AUDIT_DONE
ANTIGRAVITY_BRIDGE_MARKER_e0d512055390491e8c2a59d055477d28
