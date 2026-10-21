# Hitomi 真實下載測試（2026-10-21）

本文件保留首次失敗的歷史。其後已修復傳輸並通過兩本共 24 頁的實站驗收，最新結果見 [傳輸修復紀錄](hitomi-transport-20261021.md)。

本人要求針對圖庫 ID 4270386、4270387 進行真實下載測試。結果 **未通過**，不能將既有中性 fixture 驗收說成實站功能已可用。

- 正式背景 bundle SHA-256：`44a1d360a01eea81605b74a9793d5b6ce7726dc89f1f138b4798dcf9fa9ea0fc`。
- 首輪報告：`artifacts/hitomi-live/2026-10-21T07-35-54-505Z/report.json`（本機忽略資料）。
- 由管理頁新增兩條本人提供的單本網址，得到兩筆 queued，新增本身沒有開始下載；接著透過正式命令啟動。
- 兩本皆成功取得 12 頁清單。第一本第一張 Chrome downloadId 1 明確中止 `SERVER_BAD_CONTENT`；QueueCat 接續第二本，第一張 downloadId 2 同樣失敗，兩本均完成 0 頁。
- 相同第一張來源 URL 的唯讀 HEAD：無 Referer 回 404；`Referer: https://hitomi.la/` 回 200、image/webp、Content-Length 146292。這確認來源標頭是相容性因素，但不能僅憑 HEAD 宣稱 Chrome GET 能成功。
- 試驗 DNR 精確 URL／extension initiator、無分頁及 explicit resourceTypes 條件，各輪實際下載仍失敗。直接 `chrome.downloads.download({headers:[{name:'Referer',...}]})` 回 `Unsafe request header name`。沒有降低 TLS 驗證、解除安全下載警告、改代理或處理驗證。
- 定向原型曾通過 30 項測試、全套 152 項及建置；這些屬未奏效原型的程式檢查，**不代表實站修復成功**。已完整撤回全部產品來源／測試／manifest 實驗改動，原型保存在忽略的 `artifacts/hitomi-live-prototype/`，恢復原正式版本並重新建置。
- 同時啟動的中性圖庫 runner 未完成瀏覽器啟動，之後明確停止該次專屬程序；不計為通過。後續應串行執行瀏覽器測試。

## 隔離與收尾

僅使用專案 artifacts 下的新設定檔、外掛副本與下載目錄；未附接或操作個人 Chrome、未讀取個人下載、未修改 HKCU 或小幫手。未開啟圖片預覽／執行下載檔。各實站 run 報告記錄 context 關閉與 profile 移除；未完成 fixture 的設定檔另在受限於該 run 路徑的清理後移除。最終確認無本輪 Chromium、無 fixture 443 listener。

恢復產品來源後重新建置的 ZIP 為 7,483,954 bytes，hash `0b7decf4da258c0c2396fb1c09ea27349461a389aeb797435e01e8af36e2faa5`（封裝時間不同，不沿用前輪 ZIP hash）；本輪只交付測試結果／限制文件，**沒有交付未驗證傳輸修正**。QC-T15 保留 Review，下一步是設計可保留持久交接語意的圖片傳輸方式並實測。
