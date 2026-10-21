# Hitomi 圖片傳輸修復與實站驗收（2026-10-21）

## 摘要（Summary）

修正 Chrome 直接取得圖片缺少來源標頭、回報 `SERVER_BAD_CONTENT` 的問題。兩本本人指定的圖庫（4270386、4270387）已各完成 **12／12 頁，共 24 張**；每頁都以官方 metadata 的陣列順序，獨立重新取得來源 WebP，比對實際存檔 SHA-256，相符才算通過。Chrome 下載時間另確認逐頁、逐本嚴格串行；不是只數檔案或比對無序 hash 集合。

最終實站報告：[live-final.json](hitomi-transport-acceptance-20261021/live-final.json)。原圖僅留在本機 `artifacts/gallery-live/2026-10-21T08-23-18-592Z/downloads/`，未上傳 GitHub、未開啟預覽或執行。第一次失敗的紀錄仍保留於 [歷史報告](hitomi-live-20261021.md)。

## 已完成（Completed）

- 用 Chrome 官方 [offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) 的 `BLOBS` 離屏文件取得單張圖片。來源標頭規則只對外掛自己發出的、完全相符的 HTTPS 圖片 URL／GET／XHR 生效，不套用一般瀏覽；取得完成即移除 session rule。
- 不執行遠端程式。限制 32 MiB／60 秒、檢查 MIME 與 RIFF／WEBP signature，拒絕跳轉；大小、逾時或回應錯誤時停止並清理讀取。
- 背景先保存原始圖片 URL 與外掛自己的 Blob URL 交接意圖，才呼叫 Chrome Downloads；只核對相同 URL、外掛 ID 與時間的下載。未知交接保留人工核對，不自動重送。
- 圖片取得不占用狀態寫入鎖，管理頁與暫停仍可回應；暫停期間取得完的圖片不交接存檔。Chrome 已開始的下載沿用既有行為。
- 同來源共用正在取得或已取得的 Blob。背景重啟後若來源路由變動，新合法 prepare 會回收不再使用的其他來源 claim／Blob，並中止舊 fetch，避免佔滿容量。已有下載意圖／ID 時 engine 只 recover／sync，不會進 prepare，因此回收不碰仍追蹤中的 Chrome 下載。
- IPC 逾時與規則清理失敗會取消對應 request claim；最後 claim 消失後，晚到回應不再建立 Blob。規則移除最多重試一次，永久 API 拒絕則取消交接、保留錯誤；無法保證故障中的 Chrome API 成功清理，但作用範圍仍是上述精確規則，瀏覽器 session 結束即清除。
- 全部釋放後關閉離屏文件。Katfile 與 Rust 小幫手流程沒有重構；全程沒有操作個人 Chrome、下載紀錄或 HKCU 註冊。

## 煙霧測試（Smoke tests）

- `npm test -- --maxWorkers=2`：**18 個測試檔、165 項通過**。涵蓋 Blob 交接持久化、準備中暫停、已有意圖的恢復不重送、超限／錯 MIME／逾時、孤兒回收與有界規則清理。
- `npm run build`：型別、建置、根目錄外掛與 ZIP 校驗通過，共 19 個資源。
- 中性圖庫最終報告：[fixture-final.json](hitomi-transport-acceptance-20261021/fixture-final.json)，6 項通過。fixture 缺少來源標頭會拒絕；第二張最後一個 byte gate 驗證取得期間仍能讀狀態／暫停，未交接的圖片不存檔；恢復後依頁碼比對真正 Chrome 存檔內容。
- `npm run test:gallery-live -- --ids 4270386,4270387` 搭配本機 Playwright／Chromium 路徑：兩本完成、24 頁逐檔內容比對、Chrome 時序與文件／規則回收通過。此指令需要明確指定 ID 才連實站，使用自己的 profile，不附接個人 Chrome。
- Katfile 最終 [katfile-final.json](hitomi-transport-acceptance-20261021/katfile-final.json)：23 項隔離回歸通過。
- 來源、實測副本與包的獨立核對見 [verification.json](hitomi-transport-acceptance-20261021/verification.json)：17 個來源檔固定，正式 build 19 檔；圖庫 fixture／實站副本各 19 檔完全相符，Katfile 副本 18 檔相符、manifest 只有 name 不同。24 個本機下載檔再次重算 SHA-256，三份 profile 都已不存在。
- ZIP 7,490,065 bytes，SHA-256 `402621675b28ef66dbcb9b44a6bba8dbabd6e3cbf5e6a9d5e02a1fe92d09e355`。

## 完成對抗評論（Completion critic council）

- CodeRabbit 本輪兩次、每次 17 個小型來源／測試檔，未傳大圖、引擎或壓縮包。首輪 **2 issues（1 major、1 minor）**：孤兒 claim 回收與實站 runner 本機預設路徑，均確認後修復；複查 **0 issues**。未超過每小時 3 次／每次 150 檔。
- Luna 獨立可靠性與安全席核對並修復逾時與規則清理回收路徑；無已查證未修 P0／P1／P2。最初「active preparing 可直接移除造成孤兒」推論經合法命令核對後撤回，不當作已修產品缺陷。
- 最終來源／成品固定在 `QC-HITOMI-TRANSPORT-FINAL-02`；另有整合席與獨立證據仲裁核對，報告索引見 [index.json](hitomi-transport-acceptance-20261021/index.json)。一般發布維持 limited，不將本次兩本成功擴大成所有網站情境通過。

## 未完成（Unfinished）

兩次額外 CDP 強制停止測試沒有觀察到替換後的 extension worker，因此不能把它記成實機重啟成功。最終中性報告將該覆蓋標為 `unknown`，改以狀態核對名稱記錄；持久交接恢復有獨立引擎單元測試。這兩次 runner 失敗的歷史仍在本機 artifacts，沒有刪除或當成通過。

QC-E8／T14–16 保留 Review，後續由本人在閒置時重新載入新權限並觀察日常使用。README 已同步更新，來源以 main 交付。

## 風險（Risks）

僅驗證這兩本，不保證所有網站圖庫、未來路由版本、真人 CAPTCHA 或原生工具列彈窗。不可恢復的 Chrome API 故障仍可能留下範圍受限的 session rule；瀏覽器 session 結束即清除。未觀察的背景程序替換仍列 unknown，不宣稱完整發布驗收。

## 回顧（Retro）

來源 fixture 必須要求與實站相同的來源標頭；單靠 metadata／路由公式正確不足以證明 Chrome 傳輸可用。CDP 停止命令回傳也不能直接當成背景重啟成功，應核對實際程序替換；這次未能確認的部分已更正驗收名稱與覆蓋狀態。
