# Katfile .co 網域修正（QC-T18）

## 摘要

2026-10-23 使用者回報 `https://katfile.co/wfnml3a1oeg6/08-1924140.rar.html` 在新增預覽顯示不支援。根因為共用白名單僅有 `.com` 與 `.biz`；manifest 的網站權限與 content script matches 同樣缺少 `.co`。

## 已完成

- 共用網址規則新增 `katfile.co`，接受 www 別名，沿用檔案 ID 去重與既有網址安全限制。
- manifest 新增 `.co`、`www.katfile.co` 的精確 HTTPS 網站權限與腳本匹配。
- 建置驗證同步核對網站權限與腳本匹配，避免只修新增預覽而遺漏腳本。

## 驗證

- `npm.cmd test -- tests/urls.test.ts tests/katfile.test.ts`：2 個檔案、28 項測試通過。包含回報網址、www、跨網域去重、假網域與憑證網址拒絕，以及 `.co` 冷卻／最終下載連結辨識。
- `git diff --check`：通過。
- `npm.cmd run build`：通過 TypeScript、Vite、content script 建置、根目錄同步、MV3 契約與資源檢查、ZIP 打包；輸出 `dist/QueueCat-0.1.0.zip`（7,572,869 bytes）。
- Chrome 唯讀觀察：使用者原有 `.co` 檔案頁顯示 KatFile 檔案資訊與約兩小時的下載間隔倒數。未觸發下載。

## 未完成與限制

Chrome 工具政策拒絕讀取 `chrome-extension://` 管理頁，未嘗試繞過；未重載個人擴充功能或操作原佇列。更新後仍需本人重載擴充功能及管理頁，實站完整下載仍維持 Review。網站冷卻由站方控制。

## 完成評論

路由 `skip`：範圍為既有網站轉接層的有限白名單修正，沒有視覺設計或新下載機制；以定向回歸、manifest 契約與建置驗證覆蓋。沒有宣稱外部獨立審查或完整實站驗收通過。

## 回顧

新增站方網域時，應一起檢查網址白名單、網站權限與腳本匹配三處；只修其中一處會留下後續流程缺口。
