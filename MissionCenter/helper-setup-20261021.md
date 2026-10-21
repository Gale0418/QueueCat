# Rust 小幫手設定與完整分卷驗收（2026-10-21）

使用者本輪明確要求設定正式 Rust 小幫手，先確認 Chrome 沒有下載，再用自建加密分卷測試完整流程。使用者已回覆「沒有下載中的檔案，可以繼續設定」。

## 檢查與準備

- Browser Use 拒絕開啟 `chrome://downloads/`：內建 URL protocol policy 不允許，且明確禁止換介面或間接執行繞過。未再嘗試讀取個人下載，下載閒置狀態由使用者本人確認。
- Helper ZIP SHA-256 `7ede8bbd3e98bec4668cff0b19161f1eb6c1c43f3f0d6e37c58dcd8e49edba46`，與 10/18 已驗收套件相同。
- 已檢查 ZIP 路徑不超出目的地，解壓至固定位置 `C:\Users\USER\AppData\Local\QueueCatHelper\app\0.1.0`。Helper EXE SHA-256 `0316baf852b8d486c9bb88c9433957dec4622f2ea1c6b69ce4d0970f77e1558c` 相符。
- 使用者提供目前管理頁截圖，網址列與安裝說明均顯示 Extension ID `mnpcmpcfebnpjhlhpfccglgafhonmhnb`，已直接讀取，不要求使用者重新抄寫。
- 隔離測試完全收尾後，已以隨包安裝腳本建立目前使用者 HKCU Native Messaging 註冊，限定上述唯一 Extension ID。README 已補上實際繁中選項名稱「偏好設定 → 安裝說明」，避免只給英文名稱讓使用者找不到。
- 正式 Chrome 外掛重新載入／權限提示若需本人操作，會明示尚待完成，不把檔案準備當成正式連線成功。

## 完整驗收範圍

新增測試要從正式管理頁貼兩卷連結、填密碼、按開始，正式背景／content 表單流程交接到真 Downloads API，兩卷完成才透過 Native Messaging 解壓。不以 seedState 手動標記下載完成。使用自有 Chromium profile、loopback 合成檔、獨立 helper state、所有權限定的暫時註冊；不得操作個人 Chrome 或下載。

最終完整測試通過：[原始流程報告](helper-acceptance-20261021/flow-report.json)。正式管理頁填密碼並按開始，兩筆真 Chrome 下載 ID 1／2，沒有 seedState 或直接寫入 Chrome storage；兩個來源頁各經正式 content script 送出兩次 POST。第一卷 complete、第二卷仍 in_progress 時 group=waiting；放行最後 byte 後 group/nativeJob 均 complete。payload 及輸出 SHA-256 均為 db687044dcf29cf06e3015d1143025e1de283f48f6dd4975edbfc0938c6cd343。原卷 hash 保留，既有資料夾未覆蓋，背景重啟不重複解壓，密碼未進 Chrome state。

本輪測試 Chromium、loopback HTTPS 服務、暫存 Native Messaging 註冊、helper worker、profile 與 helper state 已全數按所有權清理。該輪 content.js SHA-256 297b0713d81289900d9541cc15d4c6d88a07944a0c664779008b1401e329fa83 與目前根目錄相同。真 Katfile 實站流程依然保持 Review。

## 圖庫網站可行性詢問

本輪未授權直接新增 hitomi 轉接層，僅回答可行性。gallery-dl 的主要來源支援清單列有 Hitomi.la 的 Galleries／Site Index／Search Results／Tag Searches：<https://gdl-org.github.io/docs/supportedsites.html>。這證明有既成技術參考，不代表 QueueCat 已支援、可直接沿用程式碼或保證實站穩定。

建議若後續實作，維持「圖庫工作 → 有序圖片子項 → 整本完成」的獨立轉接層，支援去重、低併發、失敗頁重試與保存進度；先只接單一本連結，避免首頁或搜尋結果無界擴張。仍需確認 Chrome 多檔儲存體驗、圖源變動與第三方授權，再選 Chrome 下載或可選原生後端。

## 本輪找到並修正的串接缺口

最終下載連結辨識原先不接受 .7z.001、.zip.002 及傳統 .r00，導致網站可下載但 QueueCat 停在 unknown。新增 3 個支援案例＋1 個任意 unknown.001 仍拒絕的反例，先實際得到 3 fail／1 pass，再最小修改 DOWNLOAD_EXT；修後 Katfile 20 項及全套 14 檔／118 項測試通過，type/build／打包通過。HTTPS、Katfile 網域、可見下載文字、排除 Premium／登入與唯一候選條件均未移除。Luna 另做唯讀差異核對，沒有冒稱自己執行主代理的單測。

外掛 ZIP 更新為 7,469,672 bytes，SHA-256 4ca72af636e6ececf14b9b585e33d3843bb32af44a6df75ac4cc95f3a6f0fa88。Helper EXE／ZIP 未修改、不需重建。

測試自身也曾修正：隨機來源 port 會被正式 URL 正規化移除，改用安全綁定 loopback 443；第二卷 gate 改成先送前 N-1 bytes、最後 byte 由測試放行，區分下載已開始與已完成；state 讀取另設 15 秒界限。先前失敗與中斷報告保留在 artifacts，不當成通過。合成 HTTPS 憑證僅在自有測試 Chromium 允許，不改個人 Chrome／系統安全設定。

## 正式安裝與本人確認

[安裝檢查報告](helper-acceptance-20261021/install-report.json)：HKCU 指向固定 native-host.json，allowed_origins 只有上述 QueueCat ID；正式位置的 EXE hash 相符，使用正式 helper home 的 framed ping 回覆 ok=true、version=0.1.0、sevenZipAvailable=true。沒有安裝系統版 7-Zip或變更檔案關聯。

使用者已在日常 Chrome 按「檢查小幫手」，回覆已就緒／引擎可用；之後依指示於佇列空閒時重新載入 QueueCat 以套用分卷辨識修正，再次確認已就緒／引擎可用。這兩次為使用者實機回報，不冒充工具直接觀測。所有任務維持產品實站 Review；本輪安裝與本機完整測試已完成。
