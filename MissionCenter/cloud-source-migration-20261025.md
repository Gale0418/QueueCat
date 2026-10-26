# 舊 cloud 來源自動遷移（QC-T22）

## 摘要

2026-10-25 使用者遇到 katfile.cloud 的 NET::ERR_CERT_AUTHORITY_INVALID，要求新貼上的舊網址自動轉至 .co，並修正已加入的佇列。先前唯讀檢查：.cloud 憑證驗證失敗，對應 .co 同檔案頁 HTTP 200 且憑證驗證成功；沒有略過憑證檢查。

## 已完成

- normalizeSource 在完成來源網域及檔案 ID 檢查後，將 katfile.cloud 與 www 別名轉成 katfile.co。保留既有 HTTPS、查詢參數、去除 hash 及跨網址去重行為。
- 共用 migrateLegacyKatfileSource 僅遷移已知 cloud 根網域的有效來源頁；不改 CDN 子網域、假網域、憑證網址或其他來源。
- engine 首次 load 遷移所有現存 item.sourceUrl，先寫入 storage 再更新快取。失敗仍保留原資料，下次載入可重試；成功後重讀與背景重啟不會重複寫入。
- 保留任務狀態、順序、downloadId、action 與 action.expectedUrl，不合併或重新加入任務。
- 背景恢復或 focus 確認仍停在 cloud 同檔工作頁時，僅對尚未交接的任務導航到 co，等新頁回報，不向舊頁送出免費步驟。blocked 狀態仍由使用者按「前往工作分頁」恢復；不自動重試原有錯誤或暫停佇列。

## 驗證

- `npm.cmd test -- tests/urls.test.ts tests/engine.test.ts tests/background-adapter.test.ts tests/gallery-engine.test.ts tests/extraction.test.ts`：5 檔、141 項通過。
- 新測試涵蓋 www／HTTP／查詢參數、新舊網址去重、CDN 與非法來源不變；9 種狀態的來源遷移與交接資料保留、持久化及重啟冪等、保存失敗重試、新任務開 co、準備／等待／驗證狀態的舊工作頁恢復、blocked focus 後接回倒數。
- 第一次 build 在 TypeScript 快取分支型別檢查失敗；改為明確「持久化完成後指派快取」，受影響測試已重跑通過。最終 `npm.cmd run build` 通過 TypeScript、Vite、content 建置、根目錄同步、MV3 資源檢查與 ZIP 打包。README 更新後另執行 `node scripts/package.mjs`；`git diff --check` 通過。

## 未完成與限制

未直接修改使用者的 Chrome storage 或重載個人外掛；實際既有佇列會在本人重載新版後由正式 load 路徑遷移。沒有啟動實站下載，也沒有繞過憑證警告。已知 cloud 來源的映射不代表任意 katfile 尾碼都是官方網域。

## 完成評論與回顧

`skip`：範圍為使用者明確要求的非視覺、已知網域遷移及來源恢復；以狀態保留、持久化失敗與防重回歸驗證。未執行額外外部審查，實站驗收維持 Review。來源頁與帶 token 的最終下載網址必須分開處理，不能全域字串取代。
