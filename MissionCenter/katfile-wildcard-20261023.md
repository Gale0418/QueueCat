# Katfile 任意尾碼支援（QC-T19）

## 摘要

2026-10-23 使用者明確要求接受所有 `katfile.*`，網址來源由貼上者判斷。取代 QC-T18 的固定網域清單方案。

## 已完成

- 接受 `katfile.<任意單一 DNS 尾碼>` 與 www 別名；例如 cloud、download、future，包含 punycode 格式。保留檔案頁 ID、協定、憑證限制及跨網域去重。
- CDN 最終連結沿用同類網域及其子網域規則。`katfile.com.evil.test`、`evilkatfile.com` 不符合此格式。
- 依 Chrome 官方 manifest content-scripts 文件，以 HTTPS matches 搭配 include_globs 支援變動尾碼；沒有新增全網 host_permissions。matches 的權限提示可能顯示所有網站，不能將此描述為 Chrome 層級的精確網域授權。
- 入口再核對完整 hostname；不符合時不讀取 DOM、不註冊訊息監聽、MutationObserver 或計時器。
- README 說明接受格式、來源判斷、Chrome 提示與頁面結構相容性限制。

## 驗證

- `npm.cmd test -- tests/urls.test.ts tests/katfile.test.ts tests/content-host.test.ts tests/engine.test.ts tests/background-adapter.test.ts`：5 檔、99 項通過。包含任意新尾碼、www、去重、CDN、冷卻／最終連結、錯誤網域不啟動腳本、佇列與背景來源邊界。
- `npm.cmd run build`：TypeScript、Vite、content script、根目錄同步、MV3 matches／include_globs 契約與資源驗證、ZIP 打包通過。README 更新後另執行 `node scripts/package.mjs` 同步安裝包文件。
- 官方依據：https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts （2026-10-23 讀取）。

## 未完成與限制

未操作或重載個人 Chrome 擴充功能；之前的 chrome-extension 管理頁政策限制仍適用，未嘗試替代管道讀取。尚未在 Chrome 實際載入新版驗證匹配或進行完整實站下載。新尾碼格式被接受，不代表網站歸屬或頁面結構已驗證；多層後綴如 `katfile.co.uk` 不在單一尾碼規格內。

## 完成評論與回顧

`skip`：使用者授權的有限、非視覺網址規則變更；保持既有下載／佇列邊界，以入口停用測試、DOM 轉接層測試與既有引擎回歸驗證。未執行額外外部審查，整體實站驗收維持 Review。後續若頁面結構改版仍需維護 adapter，無法僅靠網域萬用匹配解決。
