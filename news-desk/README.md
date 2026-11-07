# Market Desk — 美股新聞、名單、突發通知

每小時掃描新聞與報價 → 重大事件即時推送手機 → 收盤後一頁簡報 → 每日覆核推薦名單。

> 想不開電腦也能看？見 **[CLOUD.md](CLOUD.md)**（GitHub Pages + Actions 每小時自動更新）。

## 三層架構

```
每小時 :05/:35   collect.mjs        抓 7 組新聞查詢 + SEC 8-K + 12 檔報價
                 ↓ 去重、聚類、評分（0–11 分）
                 ≥8 分且跨來源確認 → ntfy 推送（手機）
                 5–7 分 → 排入待 digest
                 <5 分 → 只存檔

每日 05:15（HKT）digest            5 條大事 + 名單變動 + 明日關注 + 復盤

隨時             watchlist.json     每檔都有論點與「失效條件」，每日 review
```

## 檔案

| 檔案 | 作用 |
|---|---|
| `collect.mjs` | 主程式：抓取、去重、評分、推送（零依賴） |
| `notify.mjs` | 推送工具（給排程與我呼叫） |
| `config.json` | 來源、門檻、靜默時段、ntfy topic |
| `watchlist.json` | 推薦名單（12 檔種子） |
| `watchlist-history.jsonl` | 名單每次改動的審計紀錄 |
| `state.json` | 已見新聞、當日警報數、價格冷卻（自動產生） |
| `news/YYYY-MM-DD.jsonl` | 當日所有新聞與分數（自動產生） |
| `alerts/YYYY-MM-DD.md` | 當日警報紀錄（自動產生） |
| `digest/` | 每日簡報 |
| `build-site.mjs` | 把以上資料組成離線網站 |
| `site/index.html` | 檔案庫（分類樹／日期／搜尋），自動重建 |
| `collect.log` | 執行紀錄 |

## 指令

```powershell
node collect.mjs                 # 人類可讀報告
node collect.mjs --json          # 機器可讀（排程／分析用）
node collect.mjs --quiet         # 只在有警報時輸出
node collect.mjs --no-push       # 不推手機
node collect.mjs --no-quotes     # 跳過報價（更快）
node collect.mjs --digest --hours=18   # 不抓取，輸出今日摘要
node collect.mjs --selftest      # 離線測試
node notify.mjs "訊息" --title "標題" --priority high
```

Exit code：`0` 正常、`8` 有警報、`2` 失敗、`3` 設定錯誤。

## 通知（ntfy）

1. 手機裝 **ntfy**（iOS / Android，免費）。
2. 新增訂閱，topic 填 `（由 NTFY_TOPIC 環境變數指定）`（或 `https://ntfy.sh/（由 NTFY_TOPIC 環境變數指定）`）。
3. 換 topic 就改 `config.json` 的 `ntfy.topic`，等於換頻道。

Topic 是公開伺服器上的共享密鑰：知道 topic 的人都能讀。用長隨機字串就是最低成本的隱私保護；要更嚴謹可自架 ntfy。

## 排程

| 排程 | 時間 | 做什麼 |
|---|---|---|
| DSH 排程（本對話） | 每小時 :05 | 我讀新事件、寫 2–3 句解讀再推送 |
| DSH 排程（本對話） | 每日 05:15（週二至週六） | 收盤簡報 + 名單覆核 |
| Windows 工作排程器 | 每小時 :35 | 不開 app 也跑，直接推原始警報 |

Windows 那個要你自己裝一次（DSH 沙箱封鎖了 Task Scheduler RPC）：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\user\OneDrive\Documents\deepseek-harness\default-workspace\news-desk\install-task.ps1"
```

## 警報規則

**分數 = 可信度 S(0–3) + 影響廣度 B(0–3) + 名單相關 R(0–3) + 時效 T(0–2)**

| 條件 | 行為 |
|---|---|
| ≥8 分、S≥2、≥2 個來源（或一級來源／SEC／交易所數據） | 立即推送 |
| 5–7 分，或達標但被擋 | 進收盤簡報 |
| <5 分 | 只存檔 |
| 每日上限 5 條 | 超過的降級進簡報 |
| HKT 01:00–07:00 | 只推 ≥10 分 |
| 同一檔價格異動 6 小時內、幅度差 <2pp | 不重複推 |

## 名單規則

- 每檔必須有 `thesis`（為什麼持有）與 `invalidation`（什麼情況下我錯了）。沒有就不能進名單。
- 每日 review 只允許四種動作：加、留、降級、剔；每個改動寫入 `watchlist-history.jsonl`。
- 上限 20 檔；每日最多 +2/−2，防止被新聞拖著走。
- 30 天沒 review 的會被標記 stale。

## 檔案庫（瀏覽歷史，不用滾對話）

`news-desk\site\index.html` 是一個離線網站：資料內嵌、雙擊即開，不需要伺服器或網絡。

- **分類**：左側樹狀，例「科技 › 半導體 › 芯片設計」。點進去看到該類股票與相關新聞，可逐層往下。
- **日期**：左側切到「日期」，任意一天可看當日簡報、警報紀錄與全部新聞。
- **搜尋**：右上角輸入股票代號或關鍵字，按 Enter。
- **股票頁**：點任何 ticker，看論點、失效條件、催化劑與相關新聞時間線。
**K 線**：個股頁有三張圖（1 天 5 分、5 天 30 分、1 個月日線），build 時抓取並內嵌，離線與 GitHub Pages 都看得到。
**名詞庫**：側欄「名詞庫」可搜尋 57 個詞；個股頁的專業詞彙有虛線，點一下開卡片（人話＋專業兩種解釋）。詞條在 glossary.json。

開啟：雙擊 `view.cmd`，或直接開 `site\index.html`。
重建：`node build-site.mjs`（每次採集與收盤簡報後會自動重建）。
保留：最近 60 天、每日最多 90 條高分新聞；原始 `news\*.jsonl` 不刪，要更深的歷史直接查檔。

新增分類：在 `watchlist.json` 給股票加 `path`（例如 `["科技","半導體","芯片設計"]`），重建後樹上就會出現該層。

## 已知限制

- 免費源有 5–30 分鐘延遲；社交媒體爆料一律不作為推送依據（除非一級來源）。
- 跨來源確認靠標題相似度，少數同事件不同寫法會誤判為「未確認」而進簡報而非推送 — 寧可漏推，不可誤推。
- 收盤簡報時間固定在 HKT 05:15，夏令時（EDT）會比收盤晚約 1 小時 15 分。
- 這是資訊整理與研究輔助，**不是投資建議**。
