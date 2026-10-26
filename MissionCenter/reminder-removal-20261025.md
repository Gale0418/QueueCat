# Katfile 移除紀錄語意（QC-T24）

使用者要求下載中與排隊中都有刪除，這裡是提醒及排程紀錄，實際下載由 Chrome 管理。本輪取代 QC-T21 的「停止並移除」行為。

## 修改

- Katfile 的 queued、preparing、waiting、verification、handoff、downloading、blocked、failed、complete 皆可移除紀錄；移除不呼叫 Chrome cancel、pause、resume、erase 或刪檔 API。
- 列上的垃圾桶及目前項目按鈕統一為「移除紀錄」，目前項目 tooltip 說明 Chrome 下載會繼續。圖庫的進行中封存與未知 Blob 交接、原生解壓的 queued/extracting 保護維持既有行為，未擴張到這些工作生命週期。
- 尚未交接的來源移除後停止觀察及後續執行，舊分頁報告無法命中新的 activeId。已暫停的佇列不自行繼續。
- 已有 Chrome ID 的下載只保存 detachedDownloadIds 作為序列排程閘門，不再呈現原項目與下載卡；實際進行中等待完成，已中斷的項目不再阻擋下一筆。完成或中斷事件會清理 ID；背景重啟仍能查核進行中下載。
- 同名但尚未綁定的來源移除時，符合原候選檢查的外部下載也改為隱藏追蹤；刪除最後一筆不留下原下載卡。
- 未知交接且沒有下載 ID 的目前來源仍可移除，並暫停佇列，避免自動啟動其他工作。儲存失敗不啟動下一筆。
- README 同步新的語意；原生解壓與圖庫界線保留。

## 驗證

Luna 負責 tests/engine.test.ts 的移除回歸更新，主代理驗收並補上最後一筆未綁定來源的下載卡消失回歸。引擎 94 項通過；UI DOM、圖庫、背景 adapter 與解壓共 45 項通過，合計 139 項。UI DOM 逐一驗證各狀態垃圾桶及目前項目文字。未操作個人 Chrome，未執行實站刪除。

完整 build（typecheck、Vite、esbuild、根目錄同步、MV3 21 檔驗證與 ZIP）通過；最後一次 build 因修正「已中斷的隱藏下載不阻擋下一筆」而重跑。未封裝版與 ZIP 的 Defender 自訂掃描均明確 found no threats、exit 0；使用可掃壓縮內容並忽略排除的官方自訂掃描參數，未停用即時保護。

最新 ZIP 7,575,931 bytes，SHA256：`0518B83D51AB788B78D68FFB0436B8DF8AA2AC1E9B4F8BAF5DD2093D30A946AB`。此版本取代 QC-T23 的包。狀態 Review，待使用者重載後驗收。
