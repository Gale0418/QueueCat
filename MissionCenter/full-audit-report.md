# QueueCat 全面抓蟲紀錄（2026-10-18）

此為抓蟲快照02的歷史報告。後續介面與安裝包已更新，最新結果見 [任務體驗精簡](experience-refinement-20261018.md)；本頁舊SHA只對應當時快照。

本輪修復與改善 16 項；另有 4 項主張以程式或規格反證，沒有盲目修改。三位 Luna 分別盲審下載可靠性、操作與無障礙、解析效能與交付，另由獨立 Luna 仲裁。Gemini 補充審查已完成並逐條查證；修復後各席聚焦核對同一個最終快照，不宣稱永遠沒有 bug。

主要變更：

- 外部 Katfile 下載仍可續傳時繼續等待，涵蓋已記錄及未記錄 ID；鬧鐘與重啟不會因此提前下一筆。原 handoff／人工認領防重保留。
- 不點擊 content-visibility:hidden 或關閉 details 裡未渲染的控制項，第一個 summary 與開啟 details 仍可用。
- 選取與進度刷新保留鍵盤焦點；排序邊界停用；未知交接不提供容易誤導的重排入口。
- blocked 不再每 30 秒反覆喚醒；外部事件尊重倒數與 pause；事件 API 拒絕被接住並記錄；缺少 settings/events 時補預設並保留任務。
- 單次掃描共用祖先可見性快取，下一次重新查；JSDOM 樣式查詢由 3,308 次降到 312 次，這不是 Chrome 耗時倍率。
- ZIP 先完成並實際解壓驗證才替換；root 發布失敗會回復。連回復都失敗時保留備份、回報復原目錄。根目錄仍可直接載入，dist 只放安裝包與 checksum。

完整 finding ID、重現與反證見 [累計清單](../artifacts/full-audit-findings-20261018.json)。[GitHub 研究](full-audit-research.md) 比較官方範例、DownThemAll、AB 整合；未複製第三方程式或新增下載器依賴。

| 驗證 | 結果 |
|---|---|
| 測試 | 8 檔 78 項通過 |
| 型別與 build | 通過；20 個實際成品檔，其中17項主要檢驗列冊，含5張透明角色圖 |
| 隔離 Chromium | 正式背景/content、真 Downloads API、loopback HTTPS；18項完整＋3項聚焦，重疊2項，共19個不同檢查通過 |
| 隱藏控制 | 5種情境：隱藏2種從free/click1改為unknown/click0，其餘可用情境保留 |
| 視覺 | popup、鍵盤焦點、620px管理頁淺／深色截圖已獨立檢視 |
| npm audit | 已知弱點0，不代表沒有未知風險 |

沒有操作日常 Chrome 或使用者下載；本次程序與 profile 已回收。逐項來源見 [驗證紀錄](../artifacts/full-audit-verification-20261018.md)。

[QueueCat-0.1.0.zip](../dist/QueueCat-0.1.0.zip)，7,421,770 bytes；SHA-256：`43d2e1eaf546b5d8b5c8e3194519a1cc6a667eb7e3adc5966215dafed675b5dc`。root／staging／ZIP 亦由交付席獨立比對。

列冊數澄清：先前建置訊息與評論中的17是主要檢驗項目，完整root/staging為20檔，另含3項補充資源；主代理已逐檔重核20份SHA，均相符，見 artifacts/full-audit-output-count-20261018.json。這是計數澄清，沒有變更凍結成品或失效任何執行測試。

原先實站「未關分頁卻顯示追蹤中斷」的精確根因仍未重現。同檔跨 Katfile 網域跳轉與手動接手通過，不能代替該事故根因證明。真人 CAPTCHA、真 Katfile 全自動兩筆、日常 Chrome 重開、原生工具列 popup、讀屏實機仍待觀察；不為驗證干擾使用者下載。

完整發行評論仍 limited、任務保留 Review。[Mission Center SKILL.md](C:/Users/USER/.codex/plugins/cache/mission-center-local/mission-center/0.5.2/skills/mission-center/SKILL.md) 規定：「無通過證據不得 Done。」這裡保留實際驗收缺口，不另加批准要求。CodeRabbit 沒有外送；套件缺少 critic_contract.py，未宣稱契約驗證通過。Rust sync／verify／doctor 只代表 Mission Center 本機資料檢查。

快照：queuecat-full-audit-20261018-01 → -02；最終85個內容定址項目。各席報告在 output/mission-center-critique，提詞見 [專家提詞](full-audit-critic-prompts.md)，補充查證見 [Gemini 裁定](gemini-full-audit-triage.md)。
