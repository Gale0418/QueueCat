# Gemini 補充審查查證

原文：gemini-full-audit-review.md；request queuecat-full-audit-20261018-01，cascade 92069d46-d0e1-4e9f-aeba-beb5927e4f79，已收到完成標記。唯讀補充審查，沒有把協作者自稱「已證實」直接當作事實。獨立 arbiter 也以凍結快照核對五組 claim。

| Claim | 查證與處置 |
|---|---|
| 外部下載漏記 ID／alarm 直接覆寫 | 漏記與 Luna external-recovery 同根因。新增「未記 ID 的 interrupted/canResume 在 startup」先失敗再通過；全域搜尋補 interrupted。onCreated 在 running 且有待辦時記錄，改走 arm，尊重較早倒數及 pause；補對應測試。alarm 延後／額外喚醒為 P3，不能沿用 Gemini P1 定級。 |
| startup 無 tabId 就 blocked | 可達的是 preparing 已保存、tabs.create 結果未保存的中止窗口，不是一般 queued／等待。計畫規定結果不明保留待確認；自動再建分頁也無法證明前次沒成功。保留保守 blocked 行為，新增明確回歸確認不另開頁；以規格反證拒絕「必須自動重開」建議。 |
| listener rejected Promise／重複 startup | 拒絕處理是 P3，已統一接住並記錄；測試注入 alarm API 失敗，確認記錄且不造成未處理拒絕。重複 observe 為冪等操作，既有 step/action/download guards 防重；無證據顯示狀態損毀，不新增啟動生命週期重構。 |
| QC_PAGE 未檢 frameId/url | manifest 未啟用 all_frames，背景另查可信 tabs.get 的實際網址、active tab ID 與來源。沒有證明子框架可透過目前注入路徑偽造回報；列防禦偏好，不認定可達漏洞。 |
| 缺 settings/events／Badge 失敗／block alarm | settings/events 缺欄位容錯補齊，保留原任務並補測試；不宣稱完整任意損毀資料修復。Badge 的 updateBadge 已自行 catch，原 claim 錯誤。blocked 項目原本重複排 30 秒 alarm，已先測失敗再修，block 立即清 alarm、後續不再排；不誤稱會阻止核心下載。 |

所有實站與原生 popup 未觀察的範圍仍為 unknown；補充靜態審查不代替下載驗收。
