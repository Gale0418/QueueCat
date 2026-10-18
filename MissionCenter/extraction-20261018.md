# 自動解壓縮（2026-10-18）

使用者授權：新增下載時可勾選自動解壓並填同批共用密碼。分卷都下載完後，由Rust小幫手在下載所在資料夾建立獨立解壓資料夾；保留原檔、不覆蓋、不執行解出內容。測試限定隔離環境，不動日常Chrome和原下載。

## 實作邊界

- 純下載維持原本流程，小幫手是自動解壓的可選依賴。
- Windows x64 helper使用標準Native Messaging。只接受固定RPC，不能從網頁提供任意執行檔或shell指令。
- 預設附官方7-Zip26.04可攜引擎，無需系統安裝；安裝腳本可指定相容7z.exe路徑，WinRAR目前不列為已支援backend。
- 密碼經runtime傳入native後用Windows DPAPI保護落盤；Chrome佇列、事件與分享不保存密碼。7-Zip執行期間密碼會短暫出現在其命令列，具同使用者程序檢視能力者可能看見；沒有宣稱OS沙箱或抵禦已取得同帳號權限的程式。
- 分卷僅使用明確選定、由Chrome確認完成的downloadId及真實檔名，先hardlink/copy到私有input staging，再完整性與路徑檢查後解壓。沒有把鄰近同名未追蹤檔案一起帶進來。
- 檔名未知的純ID連結等本批下載完成後，以實際檔名分組。若漏貼最後一卷，engine完整性檢查會失敗，需補齊再處理；不能僅憑連號就假稱完整。
- 資料夾以新建staging產生、成功才用不覆寫的rename發布；原檔保留、不執行內容。來源檔案read-lock、檔案metadata與link/reparse/ADS/traversal拒絕都是防禦措施，並不代表壓縮parser沒有攻擊面。
- 保存native jobId後才start；不明回覆只查同一ID。queued/extracting失去程序以鎖與PID核對後標記failed，不盲重送；密碼更正重試使用新attempt而不重新下載。下載與解壓狀態分開。

## 來源與文案

官方分發：https://www.7-zip.org/download.html 、https://github.com/ip7z/7zip/releases/tag/26.04 。完整原始碼與license/相依crate notices隨helper ZIP保存，pinned下載hash見scripts/package-native.mjs；hash係從官方HTTPS來源取得後固定，不冒充上游另發的簽章/校驗公告。

Gemini文案對話 2e1db839-27a5-4fb8-a07a-f838deaee2e8，同對話Flash回稿及補稿標記皆取得；新copy位於src/shared/extraction-copy.ts。原先Argon配額RESOURCE_EXHAUSTED，未因此改讓其他writer重寫既有文案。

## 驗收進度

TypeScript 最終功能測試 14 檔／114 項及 type/build 通過。新增窄視窗密碼欄位隔離、到期密碼重填與無密碼重試回歸。原下載核心的 23 項隔離檢查通過，報告 `artifacts/browser-acceptance/2026-10-18T09-07-14-905Z/report.json`；該輪之後背景佇列核心未修改，後續變更限解壓與詳情呈現，不把舊報告當成新 native binary 的驗證。

最終 helper06 真正的 Chrome → Downloads API → Native Messaging → Rust → 7-Zip → 磁碟整合通過。最終報告 `artifacts/extraction-browser/2026-10-18T09-54-02-887Z/report.json`：兩卷由 loopback 下載，一卷完成時保持 waiting，兩卷都完成才解壓；payload hash 正確、原卷與既有資料夾保留、背景重啟只產生一個輸出資料夾。測試使用獨立 Chromium profile、臨時單一 extension origin 註冊，該輪清理旗標全部 true。

Rust 最終 22 項測試、格式檢查、release build／套件 CRC 核對通過。另用已安裝 WinRAR 6.11 只產生玩具 RAR fixture，正式 helper06 透過隨包 7-Zip 完成加密 RAR 單檔與四卷分卷；錯密碼可見 failed，輸出 SHA-256 與原 payload 相同，所有原檔 hash 保留。見 `artifacts/extraction-native/rar-acceptance.json` 的 finalBundle；前面的 debug 結果獨立保留，不冒充正式 binary 驗證。

最終不可變快照 `extraction-review-03`，manifest SHA-256 `a59a7baf239a263646e73a9b015e7477ba94b8a376163265a78e015204f8581f`，42 個來源／證據項目與兩個 ZIP 的封存副本。helper EXE SHA-256 `0316baf852b8d486c9bb88c9433957dec4622f2ea1c6b69ce4d0970f77e1558c`；Helper ZIP 3,108,133 bytes，SHA-256 `7ede8bbd3e98bec4668cff0b19161f1eb6c1c43f3f0d6e37c58dcd8e49edba46`；外掛 ZIP 7,469,653 bytes，SHA-256 `419bd5b90b91cf6df8a5df1a04dbdda05eb9049445742f0a2aa7834be88c8c4e`。

正式安裝腳本尚未對日常 Chrome 執行，權限需在使用者方便且佇列安全閒置時重新載入外掛才生效。小幫手 ZIP 內附可攜引擎；沒有系統安裝 7-Zip，也沒有接管日常 Chrome。

## 已查證修正與評論

- 獨立安全席：worker 跨程序上限 4；7-Zip 子程序各 30 分鐘逾時及 kill/reap；密碼完成／替換／取消清理與離線刪除意圖持久化；installer caught-failure transaction rollback。失敗密碼另加 7 天期限，只有小幫手被呼叫時清理，未執行或解除安裝時沒有背景定時刪除承諾。
- 獨立佇列席 EQ-001：移除等待／失敗組的一卷時取消整組解壓，保留其餘下載與磁碟檔案，不留下無法重試的懸空 group。
- 獨立 UX 席 UX-02-01／CodeRabbit 同一根因：窄視窗不再重複渲染隱藏詳情；重試只讀取按鈕所在詳情的密碼欄位。大貓與半透明卡片保留，實際截圖已檢查。
- CodeRabbit 第一輪 33 檔、3 issues：worker breakaway 旗標與僅 access-denied 回退、正常檔名含 `.part` 的辨識、密碼欄位定位。
- CodeRabbit 第二輪 11 檔、2 issues：既有工作先核對身份再要求密碼，及到期清理公平前進，已修並有重播／cursor 回歸。
- CodeRabbit 第三輪 4 檔、2 minor issues：UNC 與 extended UNC path key 一致；write/sync/replace 失敗清除暫存檔，初始狀態失敗在持鎖時保存失敗並重試、不啟動 engine。三輪共 7 issues，均有查證修補；該輪已用滿當時一小時 3 次額度，末輪修補由定向測試與獨立評論閉合，不宣稱 CodeRabbit 提出 0 issues。
- 真實 RAR fixture 揪出空 link metadata 誤拒與 `.part1.rar` 命名誤拒，均修正並用正式包重測；非空 symbolic/hard link target 仍拒絕。
- 曾觀察到輸出已存在但 worker-lost：已追到終態非阻塞取鎖失敗便跳過寫入的根因，改成等待鎖確實保存；獨立子程序持鎖的確定性測試通過，不以後續偶然成功掩蓋失敗。
- 整輪下載隔離回歸曾抓到 QC_GET 重設 watchdog：介面取進度不可延後既有喚醒時間，已加入先失敗後通過的定向測試並重跑 23 項隔離檢查。

## 保留的實站與環境限制

真 Katfile 完整自動下載、真人 CAPTCHA、兩筆實站大檔完成與日常 Chrome 重開等原缺口仍維持 Review，不以本機樣本推定正式發布通過。沒有自動執行正式 helper 安裝／日常 extension reload。Windows x64 以本機隔離 Chromium 驗證，未宣稱全平台或全新 Windows VM 覆蓋。

第三輪失敗測試的 `artifacts/extraction-browser/2026-10-18T08-53-52-243Z/profile` 與 `helper-state` 刪除曾被自動安全審查以 `blocked by policy` 拒絕，沒有換工具繞過；兩個自建暫存目錄保留。該輪臨時註冊與程序已回收。後續成功測試的自有 profile、helper-state、註冊與程序均已按報告清理。

## 最終獨立閉合與交付範圍

安全、佇列、UX 三席均核對快照03並完成閉合；佇列席親跑 5 項聚焦測試，UX 席親跑 1 項並看兩張最終截圖，安全席為靜態審查。獨立仲裁核對 42 項來源／證據、目前工作樹、兩個 ZIP 與正式 helper hash，判定 optional_windows_x64_rust_source_handoff_passed；完整產品仍 limited_review。RAR 實測由 Luna 執行、主代理派工與核證；Chrome06 由主代理執行，包含實際臨時自有 HKCU 註冊；installer rollback 另用模擬登錄測試，正式安裝未執行。

[公開驗收索引](extraction-acceptance-20261018/index.json) 保存三輪 Rabbit 原始結果、修正處置、三席閉合與仲裁。評論紀錄為 advisory；已安裝 Mission Center 缺少 critic_contract.py，不宣稱正式契約驗證器通過。沒有已知未修的 P0/P1 或已確認待修的 P2/P3；實站未知仍保持 Review。
