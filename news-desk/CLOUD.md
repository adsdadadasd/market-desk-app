# 放到 GitHub：不開電腦也能看

做完之後你會得到一個固定網址（例：`https://yourname.github.io/market-desk/`），手機加到主畫面就能隨時看分類、日期、新聞；採集、推送、更新網站全部在 GitHub 的伺服器上跑，電腦關機不影響。

## 需要準備

- GitHub 帳號（免費）
- 裝了 Git（可選；用網頁上傳就不需要）

## 步驟 A：建一個 repo

1. github.com → 右上角 **+** → **New repository**
2. 名稱：`market-desk`
3. 選 **Public**（免費 Pages 需要公開；私有 repo 的 Pages 要付費方案）
4. **不要**勾 Add a README
5. Create repository

## 步驟 B：把檔案放上去

repo 根目錄要長這樣：

```
market-desk/
├─ .github/workflows/market-desk.yml
├─ .gitignore
└─ news-desk/          ← 整個資料夾
   ├─ collect.mjs
   ├─ build-site.mjs
   ├─ digest-auto.mjs
   ├─ config.json
   ├─ watchlist.json
   └─ …
```

**方法 1（網頁，不用裝 Git）**

Add file → Upload files → 把 `news-desk` 資料夾、`.github` 資料夾、`.gitignore` 一起拖進瀏覽器 → Commit。
`.github` 是隱藏資料夾，Windows 要先在檔案總管開啟「檢視 → 顯示 → 隱藏項目」。

**方法 2（命令列）**

```powershell
cd C:\Users\user\OneDrive\Documents\deepseek-harness\default-workspace
git init
git add news-desk .github .gitignore
git commit -m "init market desk"
git branch -M main
git remote add origin https://github.com/<你的帳號>/market-desk.git
git push -u origin main
```

第一次 push 會彈出瀏覽器要求登入 GitHub。

## 步驟 C：開啟 Pages

repo → **Settings** → **Pages** → Build and deployment → Source 選 **GitHub Actions**（不要選 branch）。

## 步驟 D：讓 workflow 有寫入權限

repo → **Settings** → **Actions** → **General** → Workflow permissions → 選 **Read and write permissions** → Save。

## 步驟 E：ntfy topic 放進 Secret（建議）

repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

- Name：`NTFY_TOPIC`
- Value：你的 ntfy topic

workflow 會在執行時注入，**不會**被 commit。不過 `config.json` 裡原本的 topic 仍會出現在 repo，所以如果在意，先換一個新 topic（在手機 ntfy 重新訂閱），再把新值放進 Secret 並同時更新 `config.json`。

## 步驟 F：手動跑一次

**Actions** → 左邊選 `market-desk` → 右邊 **Run workflow** → **Run workflow**。

等 1–2 分鐘，網址就會出現：

```
https://<你的帳號>.github.io/market-desk/
```

手機用瀏覽器開，選「加到主畫面」，之後就像一個 app。

## 之後的節奏

| 時間 | 誰做 | 做什麼 |
|---|---|---|
| 每小時 :07（UTC） | GitHub Actions | 採集、推送警報、重建網站、commit |
| HKT 04–09 之間 | GitHub Actions | 若當日還沒有正式簡報，產生「自動摘要」 |
| 你開 DSH 時 | 我 | 補上有判讀的收盤簡報，取代自動摘要 |

## 要留意的限制

- GitHub 的 cron 最小間隔 5 分鐘，實際常延遲 5–15 分鐘；不是秒級即時。
- 公開 repo 的新聞與名單都是公開的。名單內容若不想公開，考慮改為私有 repo（Pages 需 Pro）。
- 公開 repo 若 60 天沒有任何活動，GitHub 會暫停排程；workflow 的 commit 通常算活動，但久未開電腦時可在 Actions 頁按一次 Run workflow。
- 雲端版沒有模型解讀，只有規則產生的自動摘要；深度簡報要開 DSH 才有。
- Yahoo 報價在雲端 IP 有機會被限流；真的抓不到時新聞仍會更新，只是報價欄位會空。
- GitHub 免費額度：公開 repo 的 Actions 分鐘數不收費；每次執行約 1 分鐘。

## 想改設定的話

- 換 topic：改 `config.json` 的 `ntfy.topic`（或改 Secret）。
- 換排程時間：改 `.github/workflows/market-desk.yml` 的 `cron`（UTC 時間）。
- 加減名單：改 `watchlist.json`。
