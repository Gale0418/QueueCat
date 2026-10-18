# 已驗證經驗
- Katfile 實站依語系呈現不同等待文字，應優先讀可見 #kfaTimer，而非行銷文案的等待時間。
- 頁面點擊不等於下載已開始；必須核對 Chrome downloadId。
- 原生工作完成時必須等待 job lock 並確實保存終態；非阻塞取鎖失敗直接略過，會把已解出的檔案誤報 worker-lost。
- 7-Zip 的 RAR5 listing 會為普通檔案列出空的 Symbolic Link／Hard Link 欄位；判斷實際目標值，不可只找欄位名稱。WinRAR 實際分卷可能是 part1，不能只接受 part01。
- 密碼到期必須同時涵蓋使用拒絕、刪除意圖及公平掃描；未執行的小幫手不可能保證定時刪檔。清理密碼後，同一 job 的冪等查詢仍須回傳已保存結果。
- UI 取進度不可不斷延後既有 watchdog alarm；窄視窗的可見詳情與隱藏側欄也不可重複建立密碼欄位 ID。
