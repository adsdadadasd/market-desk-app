# 安裝每小時採集（Windows 工作排程器）

在**正常的 PowerShell 視窗**（不是 DSH 的沙箱）執行一次即可。DSH 的沙箱封鎖了 Task Scheduler 的 RPC，所以這一步要你自己跑。

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\user\OneDrive\Documents\deepseek-harness\default-workspace\news-desk\install-task.ps1"
```

或直接手動：

```powershell
schtasks /Create /TN "MarketDesk-Collect" /SC HOURLY /MO 1 /ST 00:35 /TR "\"C:\Users\user\OneDrive\Documents\deepseek-harness\default-workspace\news-desk\run-collect.cmd\"" /F
```

檢查：

```powershell
schtasks /Query /TN "MarketDesk-Collect" /V /FO LIST
```

移除：

```powershell
schtasks /Delete /TN "MarketDesk-Collect" /F
```

## 注意

- 這個工作在使用者登入時執行；電腦睡眠時不會跑（醒來後補跑一次）。
- 它每小時 :35 跑 `collect.mjs --quiet`：有達門檻的事件就直接推 ntfy，不需要開著 DSH。
- DSH 內另有一個 :05 的排程做「解讀」，兩者共用 `state.json`，同一條新聞只會被處理一次。
- 想改時間就 `/SC HOURLY /ST` 改掉，或在工作排程器 GUI 調。
