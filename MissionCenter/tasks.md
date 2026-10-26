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

| QC-E6 | 最終獨立驗收與 GitHub main 交付 | Epic | - | P1 | Review | Codex | - | 本機測試版source交付，保留產品實站Review | 分身報告、隔離 Chrome、GitHub main 對帳 | - | verification,closeout | 本輪只交付本機測試版原始碼，不宣稱實站 release |
| QC-T8 | 不同領域盲審與隔離修復驗收 | Task | QC-E6 | P1 | Review | Codex | - | 四席閉合已核；97單測/23隔離通過；實站缺口維持Review | 不可變快照、重現、回歸、獨立仲裁 | - | verification | 保護個人 Chrome 與正在下載的檔案 |
| QC-T9 | CodeRabbit 全範圍程式碼審查與結案 | Task | QC-E6 | P1 | Review | Codex | QC-T8 | 92檔3issues全fixed；6檔複審0issues（2次額度） | 原始 NDJSON、查證處置與必要聚焦複審 | - | verification | 使用者同意上傳程式碼；每小時至多3次、每次150檔 |
| QC-T10 | 更新文件並將 main 推送 GitHub | Task | QC-E6 | P1 | Review | Codex | QC-T8,QC-T9 | main原始碼已推送3e26a1f且遠端SHA相符；保留產品Review | 本機／遠端 SHA 相同且僅 main | - | closeout | 既有空白 Gale0418/QueueCat；不建長留分支 |

| QC-E7 | 密碼自動解壓與 Rust 小幫手 | Epic | - | P1 | Review | Codex | - | 本機功能與獨立仲裁通過；main 9af93cd 遠端SHA相符 | 114TS/22Rust、final helper06 Chrome與RAR實測、三席閉合 | - | verification,closeout | 實站release仍limited；日常Chrome/原下載未操作 |
| QC-T11 | 原生解壓與安全工作狀態 | Task | QC-E7 | P1 | Review | Codex | - | 安全席03閉合，保留明示lazy expiry與非OS沙箱限制 | 22Rust；加密RAR單檔/4卷/錯密碼/hash；terminal鎖與原子寫入回歸 | - | verification | 未系統安裝7-Zip或修改檔案關聯 |
| QC-T12 | 密碼輸入、分卷排隊與三語狀態 | Task | QC-E7 | P1 | Review | Codex | - | 佇列與UX席03閉合；實站整合保留Review | 114TS及修後定向；取消group/expiry空密碼/closest scope/watchdog | - | verification | Gemini三語文案；純下載不需小幫手 |
| QC-T13 | 隔離瀏覽器、套件與文件 | Task | QC-E7 | P1 | Review | Codex | QC-T11,QC-T12 | 10/21正式helper已註冊；本人重載後確認就緒；保留實站Review | Chrome06 pass/cleanup全true；2ZIP/CRC/hash；Rabbit3輪7issues修補 | - | verification,closeout | 舊run3兩暫存目錄清理遭policy拒絕已如實保留 |

| QC-E8 | Hitomi 單本圖庫佇列 | Epic | - | P1 | Review | Codex | - | 兩本實站24頁通過；本人閒置重載新傳輸權限 | 165 tests/type/build；圖庫6項；逐頁獨立SHA及串行時序核對 | - | verification,closeout | 單本一任務、固定快照WebP資料夾；其他圖庫與原生popup未全面驗證 |
| QC-T14 | 圖庫網址與metadata路由 | Task | QC-E8 | P1 | Review | Codex | - | 保留站方路由改版後的更新需求 | 官方技術來源與JSON-only解析、9個adapter測試、安全host/hash/timeout | - | verification | 未複製GPL extractor；不下載示例圖片；57檔最終來源快照 |
| QC-T15 | 持久圖庫游標與Chrome下載 | Task | QC-E8 | P1 | Review | Codex | QC-T14 | 觀察本人Chrome更新後的實際使用 | 離屏取得後持久Blob交接；兩本各12頁完成，24頁與獨立來源SHA相符 | - | verification | 32MiB/60s上限；來源規則owned/exactURL；claim/逾時/孤兒回收；詳hitomi-transport-20261021.md |
| QC-T16 | 三語介面、完整隔離與交付 | Task | QC-E8 | P1 | Review | Codex | QC-T14,QC-T15 | 本人閒置重載offscreen與請求規則權限 | Gemini原28keys保留；新增傳輸Rabbit17檔2issues修後17檔0；獨立可靠性與安全delta閉合 | - | verification,closeout | 兩本實站通過；未能確認CDP實際替換背景worker，該覆蓋如實unknown |
| QC-T17 | 背景封裝、暫存復原與公開文案維護 | Task | QC-E8 | P1 | Review | Codex | QC-T16 | 閒置重載本機測試版；觀察真實背景替換與完整實站生命週期 | 193 單測、type/build、8 項隔離、23 項 Katfile 回歸及來源內容核對通過；三席修補閉合與獨立仲裁通過本輪 source handoff | - | verification,closeout | 沒有未解 P0/P1 或已確認 P2/P3；整體產品限制維持 Review；個人 Chrome 未附接；見 archive-maintenance-20261021.md；詳細證據保留本機 artifacts/zip-review |
| QC-T18 | 補齊 Katfile .co 網域辨識與腳本匹配 | Task | QC-E1 | P1 | Review | Codex | - | 本人重載擴充功能與管理頁後確認新增預覽；實站下載待冷卻 | 28 項定向測試、type/build、MV3 與 ZIP 打包通過 | - | verification,maintenance | 根因為共用白名單與manifest皆漏.co；Chrome工具政策不允許管理頁讀取；詳katfile-co-20261023.md |
| QC-T19 | 依使用者要求接受 Katfile 任意網域尾碼 | Task | QC-E1 | P1 | Review | Codex | QC-T18 | 本人閒置重載新版，驗證Chrome實際匹配及下載 | 99 項定向與引擎／背景回歸、type/build、MV3與ZIP打包通過 | - | verification,maintenance | 替代固定網域清單，include_globs與入口hostname檢查；來源由貼上者判斷；詳katfile-wildcard-20261023.md |
| QC-T20 | 前往工作分頁時自動重新檢查並接回倒數 | Task | QC-E1 | P1 | Review | Codex | QC-T19 | 本人閒置重載新版後按前往工作分頁確認 | 112 項定向／背景／DOM／圖庫回歸、type/build、MV3與ZIP打包通過 | - | verification,maintenance | 新增11項恢復回歸，保留交接及免費步驟防重；未操作個人Chrome；詳source-reconnect-20261023.md |
| QC-T21 | 讓中斷的 Katfile 項目可以停止並移除 | Task | QC-E1 | P1 | Review | Codex | QC-T20 | 本人重載新版後移除原錯誤項目，實站換載點待確認 | 104 項引擎／UI／圖庫／解壓／語系回歸、type/build、離線管理頁截圖與popup AX通過 | - | verification,maintenance | 精確ID取消後核對，保留歷史與完成檔案；critic_lite未派送；詳blocked-removal-20261023.md |
| QC-T22 | 新舊佇列的 cloud 來源自動遷移至 co | Task | QC-E1 | P1 | Review | Codex | QC-T21 | 本人重載新版套用已存佇列遷移，保留錯誤／暫停狀態 | 141 項定向與引擎／背景／圖庫／解壓回歸、type/build、MV3及ZIP打包通過 | - | verification,maintenance | 僅改來源，不改downloadId及帶token的交接連結；詳cloud-source-migration-20261025.md |
| QC-T23 | 接回實際 Chrome 下載並顯示預估剩餘時間 | Task | QC-E1 | P1 | Review | Codex | QC-T22 | 本人重載 QueueCat 後實站驗收 | 型別與121項定向測試通過；追加UI外部傳輸斷言、完整build、根目錄與ZIP交付通過 | - | verification,maintenance | 主代理及Luna未見明確惡意；背景／未封裝版／ZIP Defender掃描無威脅；原偵測疑似誤判但無法確證；詳download-tracking-defender-20261025.md |
| QC-T24 | Katfile 各狀態皆可純移除紀錄 | Task | QC-E1 | P1 | Review | Codex | QC-T23 | 本人重載後驗收下載中與排隊項目移除 | 139項引擎／UI／圖庫／背景／解壓回歸、完整build及Defender未封裝版／ZIP掃描通過 | - | verification,maintenance | 不取消Chrome下載；隱藏ID僅作進行中排程防重；圖庫及原生解壓既有保護維持；詳reminder-removal-20261025.md |
| QC-T25 | 外部下載完成後佇列自動接續與等待復原 | Task | QC-E1 | P1 | Review | Codex | QC-T24 | 本人重載後確認下一筆開始檢查網站 | 144項引擎／背景／圖庫／解壓／UI回歸、完整build及最終Defender掃描通過 | - | verification,maintenance | 歷史中斷不當成進行中；漏事件由QC_GET恢復；保留早期alarm與暫停行為；詳external-wait-recovery-20261026.md |
| QC-T26 | CodeRabbit 完整來源審查與 main 直接交付 | Task | QC-E4 | P1 | Review | Codex | QC-T25 | 本人重載後進行個人Chrome日常驗收 | 277項測試、完整build與Defender通過；CodeRabbit140檔2 Minor均修、3檔複查0 issues；main 3a91a7e遠端SHA相符 | - | verification,release | 來源交付完成、整產品實站仍Review；共用2次額度；README與任務中心已更新；詳release-20261026.md |
