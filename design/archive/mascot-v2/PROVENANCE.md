# QueueCat 靜態圖資來源

2026-10-18 依使用者提供的「慵懶貓耳睡衣角色三視圖.png」，使用 Codex 內建 ImageGen 分別產生五張靜態透明 PNG。正式角色為白色長髮、淡紫陰影與粉紅髮尾、粉紅白色貓掌睡衣、貓臉拖鞋。每張均直接參考同一份三視圖。

原始生成圖保留；專案副本只加入提示詞 PNG metadata，未裁切、重繪、去背或製作動畫。五張均為 1254 × 1254、有 alpha 的 PNG。

| 狀態 | 專案檔案 | 原始生成識別碼 |
|---|---|---|
| 睡覺 | cat-sleep-v2.png | exec-65270f7b-3f8e-4995-bf42-df855e2f67da |
| 工作 | cat-work-v2.png | exec-21013c94-a342-417f-9539-53204a1760f8 |
| 驗證招手 | cat-verify-v2.png | exec-2c0760ef-8241-4bd7-81b4-423324794f76 |
| 困惑 | cat-confused-v2.png | exec-cb6e129b-9795-4879-a9db-8f39ec0f8c9a |
| 開心 | cat-happy-v2.png | exec-ab84f7cd-798f-4cb8-9fc1-6237ae2827ee |

完整逐張提示詞與原始生成路徑見 `design/reference/mascot-v2-prompts.json`；參考原圖見 `design/reference/queuecat-character.png`。舊版草稿與原有提示詞保存在 `design/archive/mascot-v1/`，不隨外掛打包。

工具列圖示由 `scripts/make-icons.mjs` 內的幾何 SVG 繪製。Nunito Sans 字體透過 @fontsource-variable/nunito-sans 隨包提供；授權見 FONT-LICENSE.txt。繁中採作業系統字體後備。
