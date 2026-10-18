# 隔離 Chromium 驗收（2026-10-18）

60項本地測試與型別檢查通過；正式MV3背景、content script與UI執行於全新獨立profile，網站/驗證使用本機HTTPS樣本，每筆測試檔64KiB，由真實Chrome Downloads API接手。使用Chromium 151.0.7922.34；未接管日常Chrome、未複製登入資料、未操作目前1.2GB下載。

15組主要流程通過：批次網址預覽與加入不啟動、實際倒數與兩次POST、原生下載ID與popup進度、停止worker後接回原ID、暫停時目前檔案仍完成、樣本人工驗證後接續、時間查詢邊界實測、同毫秒交接恢復、網頁手動下載保護、失效檔留待處理並繼續下一筆、未知大小無虛構百分比、交接不明重啟不重送、不明頁面停止、工作分頁關閉停止、重開隔離瀏覽器保留暫停佇列與設定。

新增2組針對性驗收通過：同檔案.com→.biz轉址使用正式content action完成；380×420 popup允許垂直捲動且無水平溢出。基線15組使用相同背景/content二進位；最後CSS差異以新建置做針對性檢查。

主報告：artifacts/browser-acceptance/2026-10-17T22-53-33-820Z/report.json
針對性報告：artifacts/browser-acceptance/2026-10-17T23-02-38-018Z/report.json
摘要/建置SHA：artifacts/browser-acceptance-summary-20261018.json

修正：嚴格after/before時間查詢多取1ms後仍由原本含端點條件精確過濾；兩個恢復端點回歸先重現失敗、修復後通過。另驗證同毫秒手動候選。popup固定寬度加max-width，修正垂直捲軸造成橫向溢出。

限制：樣本驗證不代表真人CAPTCHA；真Katfile全自動、兩筆實站大檔、現用Chrome重開仍待觀察。工具列原生popup沒有穩定取得。discarded分頁搭配生命週期診斷使測試連線停住，保留unknown；停止已驗明的測試runner，未將此判為產品通過或失敗。通知停用已涵蓋，作業系統通知顯示/讀屏仍未自動驗收。
