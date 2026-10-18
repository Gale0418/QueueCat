# QueueCat
<!-- impeccable:product-schema 1 -->
## Platform
web
## Stack
使用者已核准：Chrome MV3、TypeScript、Vite、原生 HTML/CSS。
## Users
Katfile 免費下載使用者，希望貼上一串網址後交給外掛依序處理，遇到驗證再回來。
## Product Purpose
保存下載佇列，遵守網站等待，交給 Chrome 下載，重開瀏覽器後核對並恢復。
## Brand Commitments
睡覺的可愛貓娘小管家，五張同風格透明背景靜態圖片；奶油白、暖灰、柔和紫色。正式角色以使用者提供的 design/reference/queuecat-character.png 三視圖為準：白銀長髮、粉紅髮尾、粉白貓爪長袖長褲睡衣與貓咪拖鞋。家具版視為同一間小房間：抱被窩數羊的小床、工作／招手共用的小桌椅、困惑／完成共用的小沙發與貓臉抱枕。同件家具保持設計、角度與擺位一致。
## Capabilities and Constraints
工具列彈窗與完整管理分頁；一次一筆，明確失敗繼續、未知交接暫停。資料只存本機，不繞過驗證、限速或 Chrome 安全提示。圖片靜態替換，不做角色動畫。
## Evidence on Hand
專案起始為空；規劃經使用者核准。不得把模擬測試說成實站測試。

2026-10-18 更新：已取得使用者指定檔案網址，透過 GET 與 Chrome 唯讀 DOM 觀察到實際冷卻頁；未觸發第二筆下載。已完成離線 UI 截圖與互動檢查，真實下載全流程仍待外掛載入後驗證。
