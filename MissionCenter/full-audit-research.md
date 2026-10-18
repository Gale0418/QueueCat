# 既成作品研究（2026-10-18）

檢索前方向：QueueCat 保持單一背景寫入者、一次一筆、Chrome 管下載；優先修復狀態交接與可用性，不另造下載引擎。以 GitHub 連接器讀取公開第一手 README、官方範例及授權資料，未複製第三方程式或新增依賴。

| 候選與來源 | 授權／最近推送（GitHub 回傳） | 適配與取捨 |
|---|---|---|
| [Chrome 官方下載範例](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/api-samples/downloads/download_manager) | Apache-2.0；2026-10-14 | 用 Downloads API 讀取狀態、未知容量分流；範例會關掉 Chrome 原生下載 UI，QueueCat 不採用，以保留使用者原有操作。 |
| [DownThemAll](https://github.com/downthemall/downthemall/blob/master/Readme.md) | [授權分區](https://github.com/downthemall/downthemall/blob/master/LICENSE.md)：核心 MIT，HTML/CSS GPL-2.0，部分圖資 CC BY-SA；2026-10-17 | 批次整理、排隊與瀏覽器下載分工符合方向；不引入多連線、整套介面或圖資。GitHub license 欄 NOASSERTION 不能當成無授權。 |
| [AB Download Manager 瀏覽器整合](https://github.com/amir1376/ab-download-manager-browser-integration) | Apache-2.0；2026-10-13 | 訊息、背景、連結擷取分層有參考價值；需外部桌面程式，與目前 Chrome 下載定位不符，不新增 daemon 或攔截所有下載。 |

推送日期僅是觀察值，不足以判定維護品質。上述比較支持現有分層，沒有理由為了「優化架構」更換框架或導入大型相依。實際採用：針對每次解析建立區域快取、保留 Chrome 操作入口、封裝先成功後替換。
