# QueueCat 靜態圖資來源
2026-10-18 使用 Codex 內建 ImageGen 產生五張靜態透明 PNG；其餘四張以睡覺圖為唯一角色參考。原始 alpha 保留，不做裁切、重繪或動畫。

| 狀態 | 專案檔案 | 原始生成識別碼 |
|---|---|---|
| 睡覺 | cat-sleep.png | exec-f3807fab-f8d8-4463-8482-c2e32b04cc5e |
| 工作 | cat-work.png | exec-1bd27668-1f28-4c99-a8d9-5565a2b9d822 |
| 驗證 | cat-verify.png | exec-488e6f7b-9255-4b4a-b53e-e1499e774278 |
| 困惑 | cat-confused.png | exec-e1be5497-7610-439e-b286-05c7da53a8e8 |
| 完成 | cat-happy.png | exec-89b248f7-6894-4d3e-84dd-f5c3721ceff9 |

## 首張提示詞
Use case: stylized-concept. Project asset: QueueCat Chrome extension mascot, one static transparent PNG image, no text. Draw ONE original adorable adult anime catgirl assistant in a polished soft pastel chibi illustration style. Design: short fluffy silver-lilac bob haircut with small cream cat ears, tiny purple bow on her left ear, warm ivory oversized cardigan over a modest lavender dress, small curled fluffy tail, soft mauve lineart, cream and muted lavender palette. Pose/state SLEEP: curled up peacefully asleep, eyes closed, cheek resting on folded arms, tiny pillow under arms. Full body / compact seated silhouette, centered in a square canvas with generous transparent margins, entire character and ears visible; designed to remain legible at 140px in a utility UI. Cozy friendly expression, high quality clean illustration, subtly shaded and crisp edges. Transparent background with genuine alpha. No background scene, no circle or enclosing badge, no border, no watermark, no lettering, no animation, no other characters. Keep costume simple to reproduce in four subsequent expressions.

## 其餘四張共用提示詞
Use case: identity-preserve. Create one static transparent PNG for QueueCat app. Reference image is the approved mascot; preserve EXACT same adult chibi catgirl identity, hair cut, ears, tiny purple ear bow, warm ivory cardigan, lavender modest dress, white socks, fluffy cream tail, pastel mauve lineart and illustration quality. Change ONLY pose/expression to {STATE} Same compact full-body scale and generous transparent margins as reference, square canvas, entire figure visible. This is a small UI companion image shown at 140px; clean readable silhouette. Transparent background, true alpha, no scene, no enclosure, no watermarks, no lettering, no animation, one character only.

- WORK: awake, calmly seated holding a small plain checklist and pencil, violet eyes focused, reassuring small smile.
- CALL FOR HELP: awake, one hand waving toward viewer, violet eyes open with a friendly expectant expression. No text or question mark.
- CONFUSED: seated, one hand touching cheek, slightly tilted head, violet eyes with a gently puzzled expression, brows raised. No text or question mark.
- COMPLETE: seated and doing a relaxed happy stretch with arms raised, eyes joyfully closed and a delighted smile. No symbols or text.

工具列圖示由 scripts/make-icons.mjs 內的幾何 SVG 繪製。Nunito Sans 字體透過 @fontsource-variable/nunito-sans 隨包提供；授權見 FONT-LICENSE.txt。繁中採作業系統字體後備。
