# 中斷下載的停止與移除（QC-T21）

## 摘要

使用者於 2026-10-23 回報 NETWORK_FAILED 項目卡在目前工作，無法刪除以改用其他載點。根因：UI 隱藏 active 項目的移除入口，engine 也一律拒絕移除目前 Katfile 任務，即使該任務已 blocked。

## 已完成

- 共用 `canRemoveBlockedSource` 判定允許移除的 Katfile blocked 項目，UI 與背景一致。
- Hero 與 popup 增加「停止並移除」，待處理列提供同名無障礙標籤的垃圾桶。繁中／英／日文均有標籤。
- 已有 downloadId 時先 cancel 該 ID，再 search 核對不再 in_progress；取消、核對或保存失敗不移除、不啟動下一筆。
- 成功才釋放 activeId 並銜接下一筆；暫停佇列仍保持暫停。舊分頁或下載回報不再影響新項目。
- 不呼叫 erase 或 removeFile，保留 Chrome 歷史及完成檔案；取消下載的部分暫存資料由 Chrome 管理，不承諾保留。
- 無 downloadId 的不明下載交接、執行中的解壓仍受原有防護；來源追蹤中斷但尚未交接的 blocked 項目可以移除。

## 驗證

- `npm.cmd test -- tests/engine.test.ts tests/ui-accessibility.test.ts tests/gallery-engine.test.ts tests/extraction.test.ts tests/localization.test.ts tests/messages.test.ts`：6 檔、104 項通過。新增 7 個背景情境與既有 UI 測試的入口／命令斷言。第一次 UI 斷言誤選 hero 按鈕讀取 aria-label，已改為核對 queue row，重跑通過。
- `npm.cmd run build`：typecheck、Vite、content、根目錄同步、MV3 資源與 ZIP 打包通過。
- `git diff --check`：通過。
- verification 流程：UI remove → QC_COMMAND → 背景取消及核對 → 保存／pump → UI 命令回傳，以注入 Chrome ports 測試涵蓋；未宣稱真 Chrome end-to-end 完成。
- Chrome 本機 Vite 離線預覽：管理頁與 popup AX 均有新按鈕，管理頁截圖已核對，兩頁 console error 為空。popup 按鈕 DOM 邊界在內容範圍內；popup 截圖逾時，未宣稱已完成 popup 圖像驗收。
- 圖像證據：`artifacts/removal-20261023/manager.png`，離線示意資料，不含個人下載資料。
- 官方 cancel API 依據：https://developer.chrome.com/docs/extensions/reference/api/downloads#method-cancel

## 未完成／限制

未操作使用者的 extension 管理頁、下載紀錄與檔案；先前 extension 協定工具政策仍適用，未繞過。需本人重載新版後按新按鈕。新主機仍可能有代理或網路問題，此修正僅解決卡住項目的移除與換下一筆。

## 完成評論與回顧

有界介面變更採 `critic_lite`，未派送額外獨立評論（沒有本輪評論預算授權），保留 Review，不宣稱獨立評論通過。修正應同時處理後端狀態規則與 UI 可發現性，僅顯示垃圾桶會留下背景拒絕缺口。
