# 本輪專家提詞與閉合方式

使用者明確要求不同領域嚴格驗收、修完經查證的問題，隔離 Chrome 實測後以 CodeRabbit 收尾。沿用「超額也沒關係，任務優先」授權；每席軟目標 6,000 tokens／35 工具／20 分鐘，不把它寫成使用者硬上限。所有實際分身為 gpt-6-luna/high，fork_turns=none，原始快照01、修後快照02皆唯讀且有SHA256；不得操作日常 Chrome 或 live Katfile。不同席不互讀盲審結論，第四席最後仲裁。

## 排隊／失敗恢復席

專查嚴格串行、倒數到期重新辨識、驗證接續、Chrome downloadId唯一關聯、其他下載保護、人工認領、背景與瀏覽器重啟、工作頁消失及未知交接。要求可達路徑或最小重現與影響；不評視覺、套件偏好。新回歸後只複核 future/expired/missing 等待恢復與防重，親跑41項引擎測試；不重新廣域找P2。

## UX／可及性／三語席

沿首次貼網址→預覽→加入不啟動→開始→暫停→驗證/核對→完成/分享/設定走查；實看六張三語圖與窄深色圖，檢查文字、焦點、原始檔名/網址、半透明大貓可讀性與觸及操作。不是引擎/打包席。親跑14項定向＋1項JSDOM互動；修後只查相對導頁與3種路徑回歸。真實讀屏與原生toolbar未觀察必須寫unknown。

## 安全／效能／交付席

專查 sender/source/finalURL信任界線、可見DOM、escaping/data-raw、熱路徑與實際量測證據、build/publish/package故障與回滾、GitHub source可用性。不要假設每個效能建議都有收益，不擅定license、不因缺證捏造安全缺陷。修後只複核README/授權狀態/舊文件連結與兩個修正未放寬信任界線。

## 獨立證據仲裁席

不是原三席之一。核對不可變快照manifest、各席實際行動與能力、issues嚴重度/可達性及處置、新97tests/build/23項隔離報告、CodeRabbit NDJSON。區分引用舊報告與親測，區分本機preview source交付和整體live release，不能把unknown改寫pass。全部selected seats有封存報告才收尾。

## 停止規則

沒有未解P0/P1即停止新增廣域挑剔；全部已確認且範圍內P2/P3必須修完，再做有界閉合。CodeRabbit最多一次完整及一次必要修復複審，第三次保留復原；本輪實際2次。外部建議先重現，不盲改；wait修法保留tab/source檢查，並非照建議整段跳過。
