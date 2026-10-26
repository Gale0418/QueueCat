# Chrome 下載進度與 Defender 偵測（QC-T23）

## 修改

使用者指出 SO-37194.rar 已在 Chrome 下載，popup 卻稱為其他下載並呈現準備頁面。新增以有效 Katfile 來源檔案 ID 核對唯一進行中下載；確認後綁定既有 Chrome ID，不重送下載。支援啟動佇列、下載建立事件、背景鬧鐘及 popup 讀取時恢復。

Chrome 缺少完整來源 referrer、僅提供主站 origin 時，仍追蹤外部下載的實際檔名、大小、速度與暫停狀態，不靠同名猜測綁定任務。popup 與管理頁顯示實際正在傳輸的檔案，並以剩餘 bytes／實測速度顯示預估時間；未知速度、大小或暫停如實呈現。英日翻譯同步補齊。

## 驗證與限制

`npm.cmd run check` 通過。引擎、presentation、UI DOM、圖庫與背景 adapter 共 121 項測試通過（其後增加同一 UI 測試內的外部傳輸呈現斷言，另行驗證）。涵蓋來源相符、跨尾碼、不同 ID、假網域、同名不足、重複候選、缺少 referrer 仍顯示實際速度與保留原鬧鐘期限。

沒有操作個人 Chrome、重新下載、重新載入擴充功能，未做瀏覽器視覺驗收。

## Defender 阻擋

17:00:43 Defender 偵測 `artifacts/unpacked/background.js` 為 `Trojan:Script/ObfusScript.A!ml`（ThreatID 2147842389）；建置在讀取該檔案時失敗。17:01:34 偵測紀錄狀態變更，查詢顯示 ActionSuccess=True、IsActive=False、DidThreatExecute=False，受影響的 staging 檔案已不存在。這些欄位僅代表該項偵測紀錄，不能用來證明整台電腦安全或證實誤判。

已停止本輪 build/test 命令，之後只執行來源型別與單測，不重新產生被標記 bundle。檢查 build 腳本使用 esbuild 從本地 src/background/index.ts bundle，沒有變更依賴或 lockfile；初步文字檢查未在背景來源找到 eval/new Function/child_process/PowerShell 命令執行。這不是完整安全審查，且隔離前產物已不可讀，無法核對其內容／雜湊。

沒有恢復隔離檔、停用防護、加入排除、變造產物躲偵測或上傳檔案。尚未證實是誤判；可使用 Microsoft 官方檔案分析管道進一步釐清。新版根目錄同步與 ZIP 未完成，先前交付產物不可當作本輪修正版本。

狀態維持 Review：功能來源已修改，發布與實站驗收受 Defender 偵測調查影響。

## 17:09 後續調查與交付

使用者授權調查並在確認後打包。主代理與獨立 Luna 唯讀審查背景入口的傳遞依賴及相關 diff，未發現明確惡意執行鏈。esbuild metafile 確認背景 bundle 僅包含 18 個本地 src 模組、沒有 node_modules 執行期程式。沒有 eval／Function 建構器、遠端程式執行或背景混淆；圖庫回傳腳本僅抽取及解析 JSON，Native Messaging 使用固定 helper 與操作。package.json、package-lock.json、scripts/build-content.mjs 相對 Git 無變更。這不是整台電腦或全部開發工具供應鏈的完整安全認證。

Defender 1116/1117 事件確認原先偵測來源為即時保護、類型 FastPath，17:01:34 隔離完成。安全情報版本 1.461.194.0、引擎 1.1.26100.4。Microsoft 對此名稱未公布技術細節，`!` 後綴是內部指標，不能僅靠名稱判定觸發原因。下載 API、Native Messaging、圖庫路由等是可能影響判斷的內容，未證實為命中條件。

沿用原設定重新產生最新版（未修改輸出以避開偵測）。第一次自訂掃描以正斜線路徑失敗 0x80508023，不算通過；改為原生 Windows 反斜線路徑後，背景檔掃描明確回報 found no threats、exit 0。路徑排除查詢因權限不足失敗，不能宣稱已讀取排除設定。

`npm.cmd run build` 完整通過型別、Vite、esbuild、根目錄同步、MV3 21 檔驗證及 ZIP 打包。再用 MpCmdRun 自訂掃描對以下兩者掃描，皆明確回報 found no threats、exit 0：

- `D:\MyGame\QueueCat\artifacts\unpacked`
- `D:\MyGame\QueueCat\dist\QueueCat-0.1.0.zip`

後兩次使用官方 `-DisableRemediation` 自訂掃描選項：僅讓該次掃描不自動處置，並忽略檔案排除、掃描壓縮內容；沒有停用即時保護。最終確認 RealTimeProtectionEnabled=True、安全情報版本仍為 1.461.194.0，QueueCat 偵測紀錄僅有 17:00:43 舊紀錄。root/staging background.js 的 SHA256 與記憶體建置結果一致：

`313F2EA328DD3FB4E44F8C15678E303923FEBC779B462FC0EBD0AD6DB907538C`

ZIP 7,574,908 bytes，SHA256：

`3B8F017641E794E17B896BE9C53E5D7519231A03A393EED36506CE93FD88DD32`

判斷：本次來源審查與最新版掃描未見明確惡意／威脅，足以交付此修正版；舊檔未取得隔離前雜湊與內容，不能保證與新版相同、不能確證原偵測是誤判或宣稱已找出精確命中條件。未上傳原始碼／產物、未還原隔離檔、未更新安全情報或變更排除設定。安全調查完成本機可驗證範圍，下載 UI 的個人 Chrome 實站驗收仍待使用者重載。

官方參考：[偵測名稱頁](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Trojan:Script/ObfusScript.A!ml&ThreatID=2147842389)、[惡意程式命名](https://learn.microsoft.com/en-us/defender-xdr/malware-naming)、[MpCmdRun 掃描選項](https://learn.microsoft.com/en-us/defender-endpoint/command-line-arguments-microsoft-defender-antivirus)。

## 17:14 同名下載尚未綁定的防重修正

使用者實站截圖顯示外部下載進度與原來源「準備頁面」同時存在。缺少完整 referrer 時，上一版只呈現外部傳輸，沒有把符合人工核對條件的原項目停下來。

目前重用 manualDownloads 的檔名、來源網域、起始時間、未被其他項目認領及安全狀態檢查，將符合外部下載的原項目轉為 blocked，清除 waitUntil、保存 activeId 與核對原因。原項目顯示「待核對下載」，位於待處理；下載進度卡提供「確認是同一筆下載，接續追蹤」。按下後以既有 adopt-download 再查一次候選並綁定 ID，清除外部傳輸顯示；不建立新下載。

即使外部下載先完成或背景重新啟動，待核對項目仍保留 blocked，不自動重跑；使用者可沿既有核對面板接回已完成下載。檔名不足以證明同一來源，因此保留一次明確的人工作業，沒有以同名自動合併。

95 項引擎、presentation 與 UI DOM 測試通過，包括確認、先完成、背景重啟、防重及按鈕命令。完整 build、MV3 驗證、根目錄同步與 ZIP 打包通過。未封裝版與 ZIP 的 Defender 自訂掃描再次皆 found no threats，exit 0。未操作個人 Chrome；實站點擊仍由使用者驗收。

最新 ZIP 7,575,616 bytes，SHA256：`BDFE010B0C8533D2A1D9A62D30DEDC3099D6082BD886F39DACA4DC97B416B328`。本節版本取代前一節交付產物。
