### QueueCat UI 只讀整合檢查報告

#### 檢查項目核對
1. **靜態資源與品牌**：`PRODUCT.md` 與 `types.ts` 確認採用五張靜態 PNG（sleep, work, verify, confused, happy），無動畫。
2. **離線預覽**：`src/shared/urls.ts` 的 `previewUrls` 為純記憶體字串比對與正規表達式解析，完全不發起網路請求與真實下載。
3. **清除紀錄**：背景命令定義為 `{ kind: 'clear-complete' }`，僅清除佇列狀態中的已完成項目，不包含磁碟檔案刪除邏輯。
4. **範圍與限制**：本次嚴格受限於 8 次讀取上限與排除 `src/background` 核心邏輯之範圍，僅針對現有讀取檔案進行靜態分析。

---

#### 確認缺陷清單（P0-P2）

1. **缺陷 1 (P1)**
   - **路徑**：`src/shared/urls.ts`
   - **函式**：`normalizeSource`
   - **實際觸發條件**：使用者貼上含有 `www.` 子網域的 Katfile 網址（例如 `https://www.katfile.com/...`）時，因函式內直接使用 `!KATFILE_HOSTS.includes(url.hostname)` 進行嚴格比對，未調用同檔案定義之 `isKatfileHost`，導致合法 `www.` 網址回傳 `null`，在 UI 預覽與排程中均被誤判為 `unsupported` 而無法加入佇列。

2. **缺陷 2 (P2)**
   - **路徑**：`src/shared/urls.ts`
   - **函式**：`sourceKey`（被 `previewUrls` 調用）
   - **實際觸發條件**：當 `previewUrls` 的 `existing` 參數陣列中含有不合規格式字串或空字串時，`sourceKey` 直接執行 `new URL(raw)` 且未以 `try...catch` 包覆，會直接拋出 `TypeError: Invalid URL` 造成整個預覽比對流程崩潰中斷。

QUEUECAT_UI_REVIEW_DONE
ANTIGRAVITY_BRIDGE_MARKER_501708ccff984fac8e631f8d190466ec
