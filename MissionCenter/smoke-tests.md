# 驗證紀錄

最新QC-E5/T7：78項test與type/build通過；最終19個不同隔離Chromium檢查及5種可見性情境通過。原缺陷先重現後修復；根目錄/ZIP比對及壓縮/發布/回復故障測試有證據，詳full-audit-report.md及artifacts/full-audit-verification-20261018.md。實站與native能力缺口仍unknown。
只記錄實際執行結果；最後整合結果於交付前更新。

| 日期 | Task | 動作 | 預期 | 觀察 | 結果 |
|---|---|---|---|---|---|
| 2026-10-18 | QC-T1 | 公開 GET 與 Chrome 唯讀 DOM | 找到免費下載等待狀態、不啟動下載 | download1 表單；#kfaTimer 倒數與繁中等待提示 | 通過（只讀範圍） |
| 2026-10-18 | QC-T3、QC-T4 | npm test | 核心、轉接層、runtime來源、網址與呈現回歸 | 5個測試檔、46項測試全部通過 | 通過（模擬範圍） |
| 2026-10-18 | QC-T6 | npm run build | TypeScript與production bundle正確產生 | tsc與Vite/esbuild完成，popup/manager/background/content均存在 | 通過 |
| 2026-10-18 | QC-T5、QC-T6 | node scripts/verify-dist.mjs | MV3入口與五張透明PNG完整 | 17個build檔案記錄SHA256，5張角色均有alpha | 通過 |
| 2026-10-18 | QC-T6 | npm audit | 開發依賴沒有已知公告漏洞 | found 0 vulnerabilities | 通過（執行當時） |
| 2026-10-18 | QC-T4 | Chrome離線管理頁互動 | 重複/無效網址不加入；加入不開始 | 貼三行只加入1筆，按鈕維持「開始排隊」 | 通過（離線預覽） |
| 2026-10-18 | QC-T4 | 380px彈窗、520px長檔名與深色設定 | 主要按鈕可見、詳情可讀、不水平溢位 | 修正後scrollWidth505<innerWidth520；深色背景rgb(33,30,37)；角色載入成功 | 通過（離線預覽） |
| 2026-10-18 | QC-T6 | 檢查ZIP entries（小房間 v3 重打包） | 根目錄有manifest、兩個腳本入口及五張新角色 | 20 entries，7376907 bytes，入口與新圖存在，無舊 v2 圖 | 通過 |
| 2026-10-18 | QC-T5、QC-T6 | 依使用者三視圖換圖後重新 build、verify-dist 及提示詞掃描 | 五張新圖有透明背景、可打包且來源可追溯 | 五張 1254×1254 alpha PNG；17 個 build 檔案；9 個 raster 無缺漏提示詞 | 通過 |
| 2026-10-18 | QC-T5 | Chrome 管理頁與 380px 彈窗新版角色 | 工作、招手姿態與狀態相符，主要按鈕可見 | 管理頁 work-v2 載入 1254px；彈窗顯示招手及前往驗證，截圖 desktop-v2.jpg / popup-v2.jpg | 通過（離線預覽） |

獨立建議證據與測試分開：Gemini靜態審查兩項網址處理建議已驗證修正；UI收尾檢查指出次要文字對比不足，修正後原審查者僅針對該問題確認 resolved/ship。機械detector回傳[]。這些不代替真實下載或正式MissionCenter council。

2026-10-18 小房間 v3：npm run build、verify-dist、prompt scan 通過；17 build檔、5張1254×1254 alpha PNG、9 raster無缺漏提示詞。Chrome五圖總覽全部載入，380px驗證彈窗操作可見。Luna獨立圖資檢查PASS。此輪只換圖與引用，未重跑佇列功能測試。

2026-10-18 QC-T2/T3/T4/T6：npm test=5檔54項通過；build=型別/Vite/esbuild、根目錄發布、17檔資源hash比對、ZIP通過（7420529 bytes）。離線核對候選→本人確認→下載中通過；真實核對待本人操作。截圖 .impeccable/review/manual-download-choices.jpg。
實站手動證據：使用者截圖01 35 48為實際等待，01 44 40為最終頁與追蹤中斷，01 46 18證明Chrome已開始1.2GB傳輸。本人點繼續免費下載且未關分頁，不當作全自動交接通過。

最後更新：55項測試於02:11:40通過；ZIP7420628 bytes，SHA256=19ea5509782abf6755d14eeb742156ea7ee073b0a980e119ba5b2e7608d9e1e1。review-snapshot-20261018.json凍結檔案hash，預算仍待核准。

2026-10-18 02:19：修正測試誤掃封存副本，限定 tests 後 5 檔 55 項及型別/build通過；凍結 queuecat-runtime-ui-20261018-02。ZIP 7420673 bytes，SHA256=7d2b28ca6d8bcb40326841580c3d21bf2e3e61d2f4b0589f53dc1423dcd619fc。正式評論與真實下載核對仍待回覆。

QC-T2/T3/T4：2026-10-18：使用者回覆重新載入後，已完成「核對已開始的下載」，QueueCat顯示Chrome下載中與進度。此為真實手動開始下載後的追蹤接手證據；不代表全自動開始、CAPTCHA、兩筆完成或Chrome重開驗收。 結果：手動連結與進度追蹤PASS（使用者實際回報）。

QC-T3/T4/T6 2026-10-18 02:42：6檔57項、type/build、17檔hash與5張alpha圖、根目錄與ZIP通過。兩席正式評論三項P2已修復並獨立核對；封存快照04。整體limited，完整實站仍待驗，非Done。

2026-10-18 QC-T2/T3/T4/T6：60項test、type/build通過；15組完整＋2組針對性隔離Chromium檢查PASS，來源/下載限loopback、正式背景/content SHA吻合。時間邊界/水平溢位修正後原兩席複查通過；真實站及native popup/discarded能力unknown仍Review。清理證據artifacts/browser-acceptance/cleanup-20261018.json。
