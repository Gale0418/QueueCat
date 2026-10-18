# QueueCat ฅ(－ω－)ฅ

**把等待，交給貓貓。** 貼上 Katfile 網址，貓貓排隊，Chrome 下載。

整串網址一次整理，網站倒數有人顧；驗證或狀態不明時再由你接手。五張小房間貓娘陪你等，QueueCat 的佇列與紀錄只存本機。想介紹給朋友，可在管理頁底部複製不含個人下載資料的產品簡介。可分享短文見 [產品介紹](MARKETING.md)。

最新介面已簡化首次新增、網址預覽、開始排隊與下載核對流程；驗證與畫面紀錄見 [任務體驗精簡](MissionCenter/experience-refinement-20261018.md)。首次開啟空佇列可直接貼上網址，確認加入後再開始。

介面預設跟隨瀏覽器語言，提供 English、繁體中文與日本語；其他語言回退英文。在 **Preferences → Display Language** 可手動指定或切回 **Follow Browser Language**。通知、狀態、無障礙標籤、分享簡介與已知舊事件也會依設定呈現；檔名、網址及未知網站原文保留。放大角色、半透明卡片與三語驗證見 [本輪紀錄](MissionCenter/mascot-i18n-20261018.md)。

Katfile 免費下載佇列 Chrome 外掛。貓貓負責排隊與網站等待，檔案由 Chrome 儲存；驗證由本人在原頁面完成。

## 安裝本機版本

1. 開啟 Chrome 的 `chrome://extensions`。
2. 開啟右上角「開發人員模式」。
3. 選「載入未封裝項目」，直接指定 **`D:\MyGame\QueueCat`** 專案根目錄。
4. 將 QueueCat 釘選到工具列，點貓貓圖示開啟小彈窗。

也可解壓縮 `dist/QueueCat-0.1.0.zip`，再載入解壓縮後含 `manifest.json` 的資料夾。`dist` 只放 ZIP 安裝包與 SHA-256 校驗檔；不要直接把 ZIP 拖進 Chrome。Chrome 120 以上。

你已於 2026-10-18 回報根目錄版本成功載入 Chrome；網站倒數後顯示最終免費下載頁，並由你按「繼續免費下載」啟動傳輸。QueueCat 的全自動交接驗收仍在進行。

## 使用方式

熟手小技巧：貼好網址按 **Ctrl／⌘＋Enter** 加入；焦點在待下載項目時按 **Alt＋↑／↓** 調整順序；**Esc** 收起目前面板或詳情。加入後仍由你按「開始排隊」；排序成功會回報實際位置。設定裡也有「更順手的小技巧」可查。

- 點「新增網址」，貼多行 Katfile 檔案網址；檢查有效、重複與不支援項目後，按「確認加入」。
- 按「開始排隊」才開始處理。一次一筆；上一筆下載完成後，重新確認網站是否允許下一筆。
- 如果偵測到 Chrome 已有其他 Katfile 下載，會先等它結束。這只涵蓋 Chrome 能辨識來源的下載，不涵蓋其他瀏覽器或外部下載器；網站的限制仍以實際頁面為準。
- 網站顯示「下載之間不少於120分鐘」時，讀取頁面實際剩餘倒數；不假設從開始或結束起算，也不自行再加滿120分鐘。
- 需要驗證時會通知；點通知或「前往驗證」回到工作分頁。貓貓不處理 CAPTCHA。
- 「暫停排隊」只停止後續網站操作，已交給 Chrome 的檔案繼續下載。取消、暫停、續傳請用 Chrome 下載紀錄。
- 下載交接不明會停下；「重新檢查」先核對原下載，不會盲目重送。可續傳中斷必須先到 Chrome 恢復或取消舊下載，才能重新排隊。
- 已自行點「繼續免費下載」，但 QueueCat 留在待處理時，可按「核對已開始的下載」。候選限於加入項目後開始、同檔名且直接來自 Katfile 的下載；請核對網域、開始時間與容量，再按「確認這筆，接續追蹤」。不會自動認領或重送；原本 API 交接結果未知的項目仍走原有嚴格核對。
- 清除完成紀錄只清 QueueCat 紀錄，不刪磁碟檔案。

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

## 專案結構與資料

- `src/background`：唯一狀態寫入者、Chrome 事件與佇列核心。
- `src/content`：Katfile 可見 DOM 判讀與經背景核准的單步表單操作。
- `src/ui`：共用彈窗／管理頁與離線預覽。
- `public/assets`：五張靜態透明 PNG、隨包字體與來源／提示詞紀錄。
- `MissionCenter`：任務及驗收證據；未驗證項目保持 Review。

佇列存在 `chrome.storage.local` 的 `queuecat.state.v1`，不使用雲端同步與遙測。外掛不讀取密碼、不要求 cookies 權限；Katfile 登入與驗證維持在網站原頁面。桌面通知受 Chrome 與作業系統通知設定影響。

角色依你提供的長髮睡衣貓娘三視圖，以 Codex 內建 ImageGen 製作五張透明靜態小房間切片：小床抱被數羊、書桌工作／招手、同張沙發上拿手機思考／伸懶腰。來源見 `public/assets/PROVENANCE.md`，完整提示詞鏈見 `design/reference/mascot-v3-prompts.json`，五圖總覽見 `design/room-v3-preview.html`。圖示為專案幾何 SVG；Nunito Sans 授權見 `public/assets/FONT-LICENSE.txt`。
