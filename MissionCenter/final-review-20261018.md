# 最終獨立驗收與 main 原始碼交付（2026-10-18）

本輪範圍為 QueueCat 0.1.0 本機測試版的程式碼、介面與隔離樣本驗收，並交付 GitHub main；不是實站完整 release。

## 已確認的修復

SEC-DEL-01（P3）：README 原先將作者的 D 槽路徑當成通用安裝位置。現已補上 git clone、Node.js 版本、npm ci/build，改載入建置後的實際專案資料夾。尚未由權利人選定開源授權，因此揭露目前授權狀態，沒有擅自新增寬鬆 LICENSE。獨立仲裁已確認文件修復。

- CR-1（minor）：離線預覽從 /entries/popup.html 開管理頁時，原先跳到根目錄 /manager.html。現以當前頁相對位置產生 manager.html?preview=1，保留可選設定 hash；root、entries、子路徑三種回歸皆通過。
- CR-2（major）：背景恢復時，未到期等待頁的 content receiver 暫時不可用會被誤判為阻塞。新回歸先重現失敗；現保留已核對來源分頁的等待期限，讓 alarm 到期後重新觀察。分頁確定遺失、來源不符或等待已到期的檢查仍保留；不自動 reload discarded 分頁，不增加下載呼叫。
- CR-3（minor）：舊全面審查文件的 SKILL.md 本機絕對連結改成政策名稱與原引句，避免 GitHub 讀者點入不存在的作者路徑。

## 嚴格獨立驗收

- 排隊／失敗恢復席：讀取凍結快照，核對串行、倒數、來源及 downloadId、防重、外部下載、手動認領與恢復，沒有新確認缺陷；本席沒有另跑 Chrome。
- UX／可及性／三語席：逐張檢視七張圖片，實跑 14 項定向測試和 1 項隔離 JSDOM 互動，沒有新確認缺陷。JSDOM 不代表真實讀屏器。
- 安全／效能／交付席：核查信任界線、escaping、熱路徑與封裝回滾，提出上述 P3；沒有新確認安全缺陷。既有 style-query 改善數據不代表 Chrome 耗時量測。
- 第四席獨立證據仲裁：確認快照、覆蓋責任與文件修復；不把歷史報告誤稱為本席實測。

原始封存報告位於 [final-acceptance-20261018](final-acceptance-20261018/queue-initial.json)，原始快照 manifest SHA256：8761954736f0cb7ff57dac83d889f25c80f6938323bc0fba4b56cfcc96291219；本機不可變快照 artifacts/review-snapshots/queuecat-final-20261018-01。

## 本輪主代理實測

- npm test：12 檔 97 項通過（修正前為 11 檔 91 項）。損壞 ZIP 故障注入會產生預期的 tar 錯誤文字，整體測試仍成功。
- npm run build：型別、Vite、正式 content、根目錄同步、17 個主資源與五張透明角色、ZIP 完整性通過。
- 全新隔離 Chromium：23 項通過，pageErrors=[]，profileRemoved=true。見 [逐項報告](final-acceptance-20261018/isolated-browser-final-report.json)。使用正式 MV3/background/content 和 Chrome Downloads API；網站、驗證與小檔案均為 loopback 樣本。測試設定檔及程序已回收。
- 未連接或重新載入日常 Chrome，未操作使用者正在下載的檔案。

## CodeRabbit

已獲使用者明確外傳程式碼授權。CLI 0.7.6 已登入；本輪完整審查 92 檔，包括仍維護的舊模組、測試、建置與文件，排除二進位素材、依賴、產物、鎖檔及重複歷史素材資料。限制每小時最多 3 次／每次最多 150 檔；實際使用 2 次：92 檔完整審查提出 3 個 issues（1 major、2 minor），全數查證後修復；6 檔修復差異複審 0 issues。保留第 3 次額度，沒有為追逐標章重跑。原始 NDJSON 與處置表均封存在 final-acceptance-20261018/。審查 CLI 提醒自身無法自動升級，未影響兩次成功完成，也未把它當成產品缺陷。

## 持續保留的實站缺口

真實 Katfile 全自動交接、真人 CAPTCHA、連續兩筆實站完成、日常 Chrome 重開及原工作分頁追蹤事故根因仍待確認。工具列原生 popup、真實讀屏器與 discarded-tab/lifecycle 卡住的診斷組合未完整觀察。原產品任務 QC-E1～E5／T1～T7 保持 Review；不能以本輪隔離與程式碼審查推定完成。

## 最終本機產物

ZIP 7,463,091 bytes；SHA256 `d62ae88652d1f06566b818d792e71b8974a4d4c0d77a5ae16d9086ce4d737bff`。dist 僅 ZIP 與校驗檔；GitHub main 提交原始碼與文件，不自動建立公開 release。兩次 CodeRabbit 輸入及最終 139 項 manifest 均以內容雜湊保存於本機不可變快照鏈 01→02。

獨立最終仲裁已核對139/139快照項目、三席修復複核及全部四項有效問題處置：本輪source交付閉合通過，整產品實站release仍limited。原始報告見 [最終仲裁](final-acceptance-20261018/final-arbitration.json)，提詞見 [本輪專家提詞](final-critic-prompts-20261018.md)。安裝的Mission Center套件沒有critic_contract.py，僅記錄JSON可解析與Rust資料檢查，不宣稱評論契約驗證器通過。
