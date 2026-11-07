Option Explicit
' 若 7799 沒在監聽，就用隱藏視窗啟動 control.mjs（避免重複啟動）
Dim sh, http, need
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\user\OneDrive\Documents\deepseek-harness\default-workspace\news-desk"

need = True
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://127.0.0.1:7799/status", False
http.Send
If Err.Number = 0 And http.Status = 200 Then need = False
On Error GoTo 0

If need Then
  sh.Run """C:\Program Files\nodejs\node.exe"" ""C:\Users\user\OneDrive\Documents\deepseek-harness\default-workspace\news-desk\control.mjs""", 0, False
End If
