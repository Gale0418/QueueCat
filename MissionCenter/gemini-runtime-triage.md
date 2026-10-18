# Gemini 原檢查查證

原request與cascade已觀察到QUEUECAT_RUNTIME_REVIEW_DONE及使用者提供marker，原報告gemini-runtime-review.md。

1. expectedUrl嚴格全等：當前背景free action不傳expectedUrl，無法重現所稱現行流程失敗；隔離實際.com→.biz轉址且兩次原生表單提交通過，拒絕當成已證實P0/P1。
2. 時間查詢端點：真Chrome startedAfter等於startTime時不包含原ID，已確認並修正。查詢外擴1ms後維持原精確過濾與唯一候選，未知/多候選仍停止；已測恢復兩端點及同毫秒手動候選。
3. 等待中關分頁應自動重開：與使用者明示工作分頁關閉應暫停規格衝突，拒絕此修正，保留明確人工恢復。
4. discarded分頁：保守停止不直接判缺陷；隔離組合診斷連線停住，觀測能力unknown，未以替身模擬冒稱原生測過。
5. setTimeout0重報舊DOM：背景已有action.step防重，單元案例與真實兩次POST串行通過，無重複下載反證。
