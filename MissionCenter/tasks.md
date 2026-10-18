# QueueCat 任務（唯一狀態來源）

使用者於 2026-10-18 核准完整規劃與實作。由原六欄表格正規化為 Mission Center 契約欄位，保留全部 ID、順序及 Review 狀態，未補造通過證據。

| ID | Title | Type | Parent | Priority | Status | Owner | Depends on | Next action | Verification | Estimate | Labels | Comments |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QC-E1 | Katfile 流程確認 | Epic | - | P1 | Review | Codex | - | 核對隔離證據並保留實站缺口 | 實站倒數與最終HTTPS頁；本人按免費下載後Chrome傳輸中，全自動未驗 | - | execution,verification | 正式評論與實站驗收尚未全部完成 |
| QC-T1 | 讀取指定檔案頁並辨識冷卻 | Task | QC-E1 | P1 | Review | Codex | - | 復核網站當下倒數 | GET 與 Chrome DOM 顯示實際倒數 | - | execution,verification | 正式評論與實站驗收尚未全部完成 |
| QC-T2 | 正式下載連結與交接驗證 | Task | QC-E1 | P1 | Review | Codex | - | 正式評論與追查分頁追蹤中斷 | 實站已手動連結原Chrome下載並顯示進度；分頁追蹤中斷根因未定 | - | execution,verification | 正式評論與實站驗收尚未全部完成 |
| QC-E2 | 可靠佇列與背景恢復 | Epic | - | P1 | Review | Codex | - | 核對子任務驗收證據 | Vitest 核心狀態測試通過 | - | execution,verification | 正式評論與實站驗收尚未全部完成 |
| QC-T3 | 持久化、串行、外部下載等待、防重交接 | Task | QC-E2 | P1 | Review | Codex | - | 補真Katfile與日常Chrome重開觀察 | 60項整體測試含明確認領原ID、防重送、候選過濾與來源界線 | - | execution,verification | 正式評論與實站驗收尚未全部完成 |
| QC-E3 | 介面與靜態貓娘 | Epic | - | P2 | Review | Codex | - | 核對子任務驗收證據 | 瀏覽器互動＋截圖 | - | execution,verification | 正式評論與實站驗收尚未全部完成 |
| QC-T4 | 彈窗、管理頁、網址預覽、設定 | Task | QC-E3 | P2 | Review | Codex | - | 實站原生popup/讀屏依能力補驗 | 實站截圖字體問題已修；14/16/20px，離線候選確認轉下載中通過 | - | execution,verification | 正式評論與實站驗收尚未全部完成 |
| QC-T5 | 五張透明靜態角色圖片 | Task | QC-E3 | P2 | Review | Codex | - | 保存圖資審查與打包證據 | verify-dist 確認五檔及 alpha，來源／完整提示詞隨包 | - | execution,verification | 正式評論與實站驗收尚未全部完成 |
| QC-E4 | 整合驗收與交付 | Epic | - | P1 | Review | Codex | - | 核對子任務驗收證據 | 60項測試、build、根目錄資源與ZIP通過；Chrome已載入，整輪待驗 | - | execution,verification | 正式評論與實站驗收尚未全部完成 |
| QC-T6 | 安裝包、說明與驗證紀錄 | Task | QC-E4 | P1 | Review | Codex | - | 確認根目錄載入與 dist ZIP | 根目錄直接載入已由使用者確認；dist/QueueCat-0.1.0.zip，約7.4MB | - | execution,verification | 正式評論與實站驗收尚未全部完成 |

| QC-E5 | 全面抓蟲與效能交付審查 | Epic | - | P1 | Review | Codex | - | 保留實站缺口，核對最終評論證據 | 78項test、build、19個不同隔離檢查、5種可見性情境通過 | - | execution,verification | 16項修復改善，4項反證；見full-audit-report.md；發行limited |
| QC-T7 | 重現問題、修復與收斂評論 | Task | QC-E5 | P1 | Review | Codex | - | 完整實站與原來源追蹤事故另需觀察 | 三席盲審及聚焦複查、獨立仲裁；快照01→02 | - | execution,verification | Gemini已完成查證，未操作個人Chrome；驗收缺口不冒稱完成 |

所有 Review 項目不代表完成；完整實站下載尚未驗收；正式評論預算已由使用者核准。
