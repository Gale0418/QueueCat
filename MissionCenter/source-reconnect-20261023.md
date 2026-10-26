# 工作分頁自動接回倒數（QC-T20）

## 摘要

2026-10-23 使用者回報網站仍在倒數，QueueCat 卻顯示工作分頁追蹤中斷，並要求「前往工作分頁」後自動重新檢查，不必再切回管理頁按一次。

## 已完成

- 原先 focus 僅開啟／聚焦分頁，blocked 任務會拒收頁面觀察，因而必須另按 recheck。現在排隊中的目前 Katfile 任務，在沒有 downloadId 或 download action 時，focus 會一起恢復來源觀察。
- 既有分頁先核對 HTTPS 網域及同一檔案 ID，跨 Katfile 尾碼轉址可接回；原頁已關閉或切到其他檔案時另開正確來源。
- 新頁尚未有 content receiver 時等待主動回報並保留 watchdog；既有頁 receiver 失效才重載已核對來源，取得新版腳本。重新載入失敗會明確 blocked。
- 接回前保存狀態，清除舊 unknown grace 記錄，保留免費步驟 action 防重。已交接下載、非目前項目、暫停佇列與圖庫不走這條自動恢復流程。
- README 更新操作說明。

## 煙霧測試

日期：2026-10-23，任務：QC-T20。

- `npm.cmd test -- tests/engine.test.ts tests/background-adapter.test.ts tests/katfile.test.ts tests/content-host.test.ts tests/gallery-engine.test.ts`：5 檔、112 項通過。新增 11 項恢復情境：同檔跨域、關閉重開、新頁就緒、舊 sender 拒絕、舊腳本失效、不同檔案、重載與保存失敗、交接／暫停／非目前項目保護、免費步驟防重與未知逾時重設。
- 已觀察 focus → preparing → 來源 waiting 回報 → waiting／正確 waitUntil；無第二筆下載，下一項保持 queued。
- `npm.cmd run build`：TypeScript、Vite、content script、根目錄同步、MV3 與資源驗證、ZIP 打包通過。安裝包 `dist/QueueCat-0.1.0.zip`，7,573,085 bytes。
- `git diff --check`：通過。

## 未完成與風險

上述為自動測試注入 Chrome ports 的功能驗證，未宣稱真實 Chrome 端到端通過。未操作／重載個人擴充功能，原工作分頁與下載未動。Chrome 工具先前拒絕 extension 協定讀取的限制仍適用，未繞過。需本人閒置時重載新版外掛後實用確認。重新載入來源頁可能重設站方頁面本地倒數；顯示以網站重新回報為準，不自行猜測。

## 完成評論與回顧

`skip`：有限、非視覺的既有命令串接；以重開競態、來源核對、保存失敗與防重回歸覆蓋。未執行額外外部審查；實站驗收維持 Review。取得分頁失敗的 catch 已縮小，保存／聚焦錯誤不再誤觸另開分頁分支。
