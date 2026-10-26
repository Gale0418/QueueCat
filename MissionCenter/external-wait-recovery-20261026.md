# 外部下載完成後佇列自動接續（QC-T25）

使用者截圖：Chrome 顯示 SO-37194.rar 完成，QueueCat 仍顯示「等目前那筆下載結束」，EM-19705.rar 保留 queued。未操作個人 Chrome 或直接讀取其下載資料，因此未斷言當時是哪個下載 ID／歷史紀錄造成阻擋。

## 已確認的程式缺口及修正

- findExternal 原先將歷史 interrupted 且 canResume 的非 QueueCat 下載也當成正在傳輸；現在只有 in_progress（含 Chrome 暫停中的下載）作為外部排程閘門。QueueCat 自己追蹤的中斷下載仍保留既有待處理與核對流程。
- QC_GET 原先只更新仍在下載的外部進度，已完成或不存在時未清理／pump。現在重新查核所有真正在進行中的外部下載，確認沒有其他進行中下載後清除 externalDownloadId、externalWaitReason、externalTransfer 與失效的 detached IDs，僅在 running 且沒有 activeId 時啟動下一筆。暫停佇列不會被啟動。
- waitForExternal 原先每次狀態讀取都以 now+30 秒覆蓋背景鬧鐘。改用 arm(s,true) 保留未過期的較早期限，已過期的 alarm 不視為有效；背景外部等待即使 active item blocked 也保留核對鬧鐘。
- 下載事件、鬧鐘及 pump 的完成／中斷清理同步刪除舊外部傳輸呈現。另一筆 in_progress 仍會擋住下一筆，不將單一下載完成等同所有下載完成。

## 驗證

Luna 只更新 tests/engine.test.ts，主代理審查測試與整合。99 項引擎回歸通過；另 45 項背景 adapter、圖庫、解壓及 UI DOM 回歸通過，合計 144 項。新測試包含漏接外部／detached 完成事件後 QC_GET 恢復、歷史可續傳中斷不阻擋、另一筆真下載仍阻擋、連續讀取不延後 alarm、暫停狀態只清理不啟動下一筆。

未執行實站下載或重載個人 Chrome；新版將由使用者重載驗收。下一筆開始仍須遵守網站冷卻、驗證及原有交接防重規則。

第一次完整 build 在 publish 的 finally 清理暫存備份時遇到 EBUSY；root 與 staging 背景雜湊一致，沒有新增 Defender 偵測，但該輪未執行 ZIP 打包。建置尚未結束時曾掃描到舊 ZIP，該結果不作為新版交付證據。之後重新執行完整 build，僅在確認命令成功結束後掃描最後產物。

最終完整 build（型別、Vite、esbuild、root 同步、MV3 21 檔驗證與 ZIP）成功結束。未封裝目錄與最後 ZIP 的 Defender 自訂掃描均 found no threats、exit 0；掃描未修改即時保護設定。ZIP 7,575,976 bytes，SHA256：`016FDC2E887B73F4F63252A9EAC25E1041F845C59C08A6FAB0730724301AB5CE`。git diff --check 無錯誤（tasks.md 僅換行格式提示）。狀態 Review，待本人重載後實站驗收。

完整交付驗證後，嘗試在解析絕對路徑並檢查父目錄及精確名稱後清理本次 `.publish-9WSAYF` 暫存備份。exec_command 的自動安全審核以 `blocked by policy` 拒絕執行；未透過其他方式繞過清除，暫存備份保留，不影響已驗證的交付產物。
