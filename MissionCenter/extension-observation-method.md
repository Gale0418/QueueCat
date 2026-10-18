# 外掛介面觀測方式（2026-10-18）

來源：使用者授權請教「檢視五個視窗並修復 LLMeeting」（01a1344a-6995-7993-a772-10449439d795），對方已回覆。

已驗證方法：獨立Chromium持久化profile、隔離外掛副本、替身worker；匯入Playwright前設定 PW_CHROMIUM_ATTACH_TO_OTHER=1，以測試頁使用者手勢呼叫chrome.sidePanel.open，再透過context的page事件取得原生側欄。側欄不在chrome.tabs.query一般分頁清單。正式renderer/CSS/storage可執行，但不等同現用Chrome的真實背景或帳號E2E。

QueueCat目前使用popup與管理分頁，尚未套用該隔離Side Panel方法。現有瀏覽器工具曾阻擋chrome://extensions協定，不能以其他控制表面繞過同一限制。保留使用者正在下載的Chrome；手動重新載入與接手下載已由使用者確認通過。

這次只讀取對話並請教方法，未操作LLMeeting專案或瀏覽器。
