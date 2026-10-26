# QueueCat ฅ(－ω－)ฅ

**把等待，交給貓貓。** 貼上 Katfile 檔案網址，貓貓排隊，Chrome 下載。

整串網址一次整理，網站倒數有人顧；驗證或狀態不明時再由你接手。五張小房間貓娘陪你等，QueueCat 的佇列與紀錄只存本機。想介紹給朋友，可在管理頁底部複製不含個人下載資料的產品簡介。可分享短文見 [產品介紹](MARKETING.md)。

最新介面已簡化首次新增、網址預覽、開始排隊與下載核對流程；驗證與畫面紀錄見 [任務體驗精簡](MissionCenter/experience-refinement-20261018.md)。首次開啟空佇列可直接貼上網址，確認加入後再開始。

介面預設跟隨瀏覽器語言，提供 English、繁體中文與日本語；其他語言回退英文。在 **Preferences → Display Language** 可手動指定或切回 **Follow Browser Language**。通知、狀態、無障礙標籤、分享簡介與已知舊事件也會依設定呈現；檔名、網址及未知網站原文保留。放大角色、半透明卡片與三語驗證見 [本輪紀錄](MissionCenter/mascot-i18n-20261018.md)。

支援 Katfile 免費檔案的 Chrome 外掛。貓貓負責排隊，檔案由 Chrome 儲存；Katfile 驗證由本人在原頁面完成。

接受 `katfile.<任意單一網域尾碼>` 的檔案頁（例如 `.com`、`.biz`、`.co`、`.cloud`）及 `www` 別名，跨網域以相同檔案 ID 去重；網址來源由貼上者自行確認，接受格式不代表認證網域擁有者。Chrome 腳本以 HTTPS `include_globs` 配合完整網域檢查啟動，因此新增尾碼不需更新清單。Chrome 的安裝／更新提示可能將這種匹配顯示為所有網站存取；腳本啟動仍限定上述網址格式。網站改版導致頁面無法辨識時，仍需更新轉接層。

已知舊檔案頁 `katfile.cloud`（含 `www`）會自動轉成 `katfile.co`。新貼上的網址即時轉換；重載新版外掛後，已儲存的佇列來源也會遷移並保存，不必刪除重加。檔案 ID、順序與任務狀態保留；已交接的 CDN 下載連結及 Chrome 下載 ID 不改寫。尚未交接的舊工作頁會在背景恢復或「前往工作分頁」時改開 `.co`；既有暫停／錯誤狀態不會因遷移而自動重試。

排隊中若來源分頁追蹤中斷，按「前往工作分頁」會自動重新檢查並接回網站倒數，不必回管理頁再按一次。原頁已關閉時會重開；既有頁面的外掛腳本失效時會重新載入該頁。倒數以網站重新回報為準，重新載入來源頁可能重設網站自己的倒數。已暫停的佇列不會自行開始；已交接下載或結果不明的項目仍保留原有核對流程。

Katfile 的排隊、準備、等待、驗證、交接、下載中與完成紀錄，都可用垃圾桶或「移除紀錄」移除；只刪除 QueueCat 紀錄，不取消、暫停或清除 Chrome 下載，也不刪檔。尚未開始的項目移除後不再執行。進行中的下載仍由 Chrome 繼續，QueueCat 僅保留下載 ID 作為下一筆排程的防重用途，不再顯示該筆進度；完成後才接續下一筆。原本暫停的佇列保持暫停；未知交接沒有下載 ID 時，移除後會暫停佇列，避免自動啟動其他項目。原生解壓執行中的紀錄仍維持既有保護。

## 安裝本機版本

從 GitHub 取得的原始碼需先建置。請安裝 Node.js 20.19+（20 系列）或 22.12+，在專案資料夾執行：

```powershell
git clone https://github.com/Gale0418/QueueCat.git
cd QueueCat
npm ci
npm run build
```

1. 開啟 Chrome 的 `chrome://extensions`。
2. 開啟右上角「開發人員模式」。
3. 選「載入未封裝項目」，指定剛才建置的 **QueueCat 專案資料夾**，確認其中有 `manifest.json`。
4. 將 QueueCat 釘選到工具列，點貓貓圖示開啟小彈窗。

也可解壓縮 `dist/QueueCat-0.1.0.zip`，再載入解壓縮後含 `manifest.json` 的資料夾。`dist` 只放 ZIP 安裝包與 SHA-256 校驗檔；不要直接把 ZIP 拖進 Chrome。Chrome 120 以上。

你已於 2026-10-18 回報根目錄版本成功載入 Chrome；網站倒數後顯示最終免費下載頁，並由你按「繼續免費下載」啟動傳輸。QueueCat 的全自動交接驗收仍在進行。

## Katfile 下載後自動解壓（可選）

新增網址時勾選 **Auto-extract after download**，在下方 **Archive Password** 填這批檔案共用的密碼；無密碼壓縮檔可留白。不同密碼請分批加入。分卷請整組貼齊；所有已選卷的 Chrome 下載完成後，才會檢查並解壓到下載位置下的新資料夾，保留原壓縮檔、不覆蓋既有內容、不執行解出的程式。

Windows x64 使用 Rust 小幫手，預設附官方 7-Zip 26.04 可攜引擎，朋友不必另外裝解壓軟體；也可在安裝小幫手時指定相容的既有 `7z.exe`。目前不直接呼叫 WinRAR。

1. 取得或自行建置 `dist/QueueCat-Helper-0.1.0-windows-x64.zip`，解壓至固定位置；保留其中的 `engine` 與授權文件。
2. 在 QueueCat **偏好設定 → 安裝說明** 找到「外掛 ID」（英文介面為 **Preferences → Setup Guide → Extension ID**），執行小幫手資料夾的 `Install-QueueCat.cmd` 並貼入 ID。此步只註冊目前 Windows 使用者，不需管理員、不改檔案關聯。
3. 等目前佇列安全閒置後，重新載入外掛以取得新增的 `nativeMessaging` 權限，再按 **Check Helper**。本次自動測試不會替你重新載入日常外掛。
4. 需要移除小幫手時，執行隨包的 `uninstall-native-helper.ps1`；不刪已下載或解壓的檔案。未設定小幫手仍可照常排隊下載。

支援 ZIP、7z、RAR、現代 `.part01.rar`、傳統 `.rar/.r00` 及 `.7z.001/.zip.001` 分卷。若網址不含檔名，會等該批下載完成再依 Chrome 實際檔名分組。漏貼最後一卷、密碼錯誤、損壞或空間不足都會停止該組解壓；在詳情更換密碼再按 **Retry Extraction**，不會重新下載。移除等待／失敗組任一卷的紀錄會取消該組解壓，但保留其他下載與原檔；執行中的解壓紀錄不能移除。

密碼不進 Chrome 佇列、事件或分享，僅由小幫手以 Windows DPAPI 保護落盤。成功及換密碼後會清理不再使用的密碼；失敗組密碼最多保留 7 天供重試；到期後下次小幫手呼叫會清理，重新解壓時可再輸入密碼。取消該組也會排程清理。解除安裝保留的加密資料可依原生說明手動移除，不會宣稱未執行的小幫手能定時刪檔。7-Zip 執行時密碼短暫出現在程序參數，可能被同帳號的程序檢視工具讀取；此功能有路徑與資源限制，但不是作業系統沙箱。詳見 [原生小幫手說明](native/README.md) 與 [本輪驗收紀錄](MissionCenter/extraction-20261018.md)。

## 使用方式

熟手小技巧：貼好網址按 **Ctrl／⌘＋Enter** 加入；焦點在待下載項目時按 **Alt＋↑／↓** 調整順序；**Esc** 收起目前面板或詳情。加入後仍由你按「開始排隊」；排序成功會回報實際位置。設定裡也有「更順手的小技巧」可查。

- 點「新增網址」，貼多行 Katfile 檔案網址；檢查有效、重複與不支援項目後，按「確認加入」。
- 按「開始排隊」才開始處理。一次一筆；上一筆下載完成後，重新確認網站是否允許下一筆。
- 如果偵測到 Chrome 有其他正在傳輸的 Katfile 下載（包含 Chrome 暫停中的下載），會先等它結束；已完成或已中斷的舊下載不會單獨擋住排程。背景漏接完成事件時，QueueCat 會在重新讀取狀態後核對並恢復排程。這只涵蓋 Chrome 能辨識來源的下載，不涵蓋其他瀏覽器或外部下載器；網站的限制仍以實際頁面為準。
- 網站顯示「下載之間不少於120分鐘」時，讀取頁面實際剩餘倒數；不假設從開始或結束起算，也不自行再加滿120分鐘。
- 需要驗證時會通知；點通知或「前往驗證」回到工作分頁。貓貓不處理 CAPTCHA。
- 「暫停排隊」只停止後續網站操作，已交給 Chrome 的檔案繼續下載。取消、暫停、續傳請用 Chrome 下載紀錄。
- 下載交接不明會停下；「重新檢查」先核對原下載，不會盲目重送。若是 QueueCat 已追蹤的中斷下載，請先在 Chrome 恢復或取消舊下載，再處理該項目；歷史上可續傳的外部下載不會阻擋新的排程。
- 已自行點「繼續免費下載」時，若 Chrome 回報完整來源檔案 ID 且只有一筆符合，QueueCat 會自動接回既有下載。缺少來源 ID、只找到同名候選時會停在待核對；可按進度下方「確認是同一筆下載，接續追蹤」，或在「核對已開始的下載」面板核對網域、開始時間與容量。人工候選限於加入項目後開始、同檔名且直接來自 Katfile 的下載，不會只憑同名自動認領或重送；原本 API 交接結果未知的項目仍走原有嚴格核對。
- QueueCat 依剩餘資料量與 Chrome 實測速度顯示下載進度及預估時間；大小或速度未知、或下載暫停時會如實顯示未知／暫停，不推算虛假的 ETA。同名不足以證明來源相同，需由你核對後明確接手。
- 清除完成紀錄只清 QueueCat 紀錄，不刪磁碟檔案。

下載核心前輪的獨立驗收見 [驗收紀錄](MissionCenter/final-review-20261018.md)，本輪自動解壓見 [解壓驗收紀錄](MissionCenter/extraction-20261018.md)。此倉庫交付本機測試版原始碼，完整實站驗收仍保留以下缺口。

## 已驗證與實站限制

使用者提供的 Katfile 頁面已透過公開 GET 與 Chrome 唯讀 DOM 確認有實際冷卻倒數；保存的測試片段已移除廣告與腳本。

串行、持久化恢復、外部下載保護、兩階段免費表單、防重交接、來源訊息、網址解析與介面呈現有自動化測試。管理頁與彈窗有瀏覽器互動及響應式畫面驗證。

真實外掛已載入、讀到網站倒數，並觀察到 HTTPS Katfile 子網域及非標準連接埠的最終免費網址。使用者按網站按鈕後，Chrome 已開始下載 1.2 GB 檔案；期間 QueueCat 顯示工作分頁追蹤中斷，使用者確認沒有關閉分頁，根因仍待追查。

使用者已確認手動核對接手後，QueueCat 顯示 Chrome 下載中與進度。**Katfile 實站的全自動交接、真人驗證後接續、連續兩筆完成與實際重開 Chrome 仍待完整確認。** 最終 URL 只接受可辨識的 HTTPS Katfile 網域或子網域；其他 CDN 或無可讀倒數會保守停止。此版本為本機測試版，不宣稱通過 Chrome Web Store 審核。

## 開發與離線預覽

```powershell
npm ci
npm run check
npm test
npm run build
npm run dev
# Windows x64：需要 Rust 工具鏈，首次會下載固定版本官方引擎
npm run build:helper
```

開啟 `http://127.0.0.1:5173/entries/manager.html?preview=1` 或 `entries/popup.html?preview=1`。一般網頁環境會明確顯示離線預覽，選擇示意情境；**預覽不會啟動真實下載**。真實外掛只讀取 Chrome 本機佇列，不帶示意檔案。

HTML 原始入口在 `entries/`；建置暫存位於 `artifacts/unpacked/`。`npm run build` 會將完成的外掛同步至根目錄、核對資源，再產生 `dist/QueueCat-0.1.0.zip`。根目錄的外掛檔案由建置產生，請修改 `src/`、`entries/`、`public/` 中的來源。Windows 打包使用系統 tar.exe；macOS/Linux 的打包步驟需要 zip 指令。

### 隔離 Chromium 自動驗收

先執行 `npm run build`，再指定已安裝的 Playwright 模組、Chromium 快取與 OpenSSL：

```powershell
npm run test:browser -- --playwright-module <Playwright/index.mjs> --browser-cache <Chromium快取目錄> --openssl <openssl.exe>
```

測試建立全新設定檔、複製建置成品並執行正式背景程式及 content script。Katfile 回應由 loopback HTTPS 樣本提供，小檔案交給真正的 Chrome Downloads API。DNS 映射及測試憑證設定僅傳給這個新瀏覽器程序，不修改系統、現用 Chrome 或現用外掛；不複製登入資料，也不連真實 Katfile。

來源樣本需占用本機 `127.0.0.1:443`；若已被使用，測試直接停止，不關閉其他服務。下載、截圖與逐項報告位於 `artifacts/browser-acceptance/<執行ID>/`。測試會關閉自己建立的瀏覽器及 HTTPS 服務。模擬驗證通過不等於通過真人 CAPTCHA；以彈窗 HTML 頁面做互動與排版驗收，也不代表工具列原生彈窗已取得。

自動解壓的隔離驗收另用 `npm run test:extraction-browser -- --helper-exe <小幫手.exe> --seven-zip <7z.exe> --playwright-module <Playwright/index.mjs> --browser-cache <Chromium快取目錄>`。它在自己的 profile 下載本機產生的加密分卷，核對真正的 downloadId、解壓內容 hash 與背景重啟的冪等結果；只有 native host 註冊原先不存在時才暫時建立測試註冊，測完按所有權還原，不覆寫既有註冊。證據位於 `artifacts/extraction-browser/<執行ID>/`。

完整的「填密碼 → 開始佇列 → 正式網頁表單 → 分卷下載 → 自動解壓」測試使用 `node tests/browser/extraction-flow.mjs`，沿用上述四個必要參數，另可用 `--openssl <openssl.exe>` 指定本機測試憑證工具。它不直接寫入佇列狀態，會讓第二卷保留最後一個 byte，確認兩卷完成才解壓；只使用隔離 Chromium、loopback HTTPS 與臨時原生註冊，不改系統憑證。此開發測試需要原生 host 尚未註冊，若已安裝正式小幫手就安全停止，不會覆寫；已完成的報告見 [2026-10-21 驗收紀錄](MissionCenter/helper-setup-20261021.md)。

## 專案結構與資料

- `src/background`：唯一狀態寫入者、Chrome 事件與佇列核心。
- `src/content`：Katfile 可見 DOM 判讀與經背景核准的單步表單操作。
- `src/ui`：共用彈窗／管理頁與離線預覽。
- `native`：可選 Rust 解壓小幫手、Native Messaging 協定與 Windows 安全回歸測試。
- `public/assets`：五張靜態透明 PNG、隨包字體與來源／提示詞紀錄。
- `MissionCenter`：任務及驗收證據；未驗證項目保持 Review。

佇列存在 `chrome.storage.local` 的 `queuecat.state.v1`，不使用雲端同步與遙測。外掛不讀取 Katfile 登入密碼、不要求 cookies 權限；Katfile 登入與驗證維持在網站原頁面。只有你主動填入的壓縮檔密碼會傳給本機小幫手，儲存與限制見上方說明。桌面通知受 Chrome 與作業系統通知設定影響。

角色依你提供的長髮睡衣貓娘三視圖，以 Codex 內建 ImageGen 製作五張透明靜態小房間切片：小床抱被數羊、書桌工作／招手、同張沙發上拿手機思考／伸懶腰。來源見 `public/assets/PROVENANCE.md`，完整提示詞鏈見 `design/reference/mascot-v3-prompts.json`，五圖總覽見 `design/room-v3-preview.html`。圖示為專案幾何 SVG；Nunito Sans 授權見 `public/assets/FONT-LICENSE.txt`；ZIP 函式庫授權隨安裝包附於 `assets/zip-license.txt`。

## 原始碼授權狀態

本專案目前未指定開源授權；公開倉庫不代表授予額外的重用、改作或散布權利。若需要這些用途，請先聯絡維護者確認授權。第三方字體、7-Zip 及 Rust 相依套件依各自授權處理；小幫手 ZIP 保留官方引擎授權、對應完整原始碼及相依套件 notices。角色參考圖與生成素材的來源亦保留於來源紀錄中。
