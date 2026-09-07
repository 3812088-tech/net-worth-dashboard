# 淨值儀表板

簡單的單頁淨值儀表板：可編輯多券商持股、透過 Yahoo Finance 抓取台股／美股現價，並以 TWD／USD 顯示總淨值。

> **隱私提醒**：本 repo 為 **private**。`app.js` 內嵌真實持股（`USER_HOLDINGS`），資料也會存在瀏覽器 `localStorage`。請勿改為公開、勿把 token／密碼寫進程式碼；清除網站資料會讓本地快取消失。

## GitHub Pages（靜態託管）

若已啟用 GitHub Pages（來源：`main` 分支、根目錄 `/`），開啟：

- `https://3812088-tech.github.io/net-worth-dashboard/`
  （若 repo 名稱為 `net-worth-dashboard-tw`，路徑請改為對應名稱）

靜態 Pages **沒有** `server.py` 的 `/api/*`。前端會在非 localhost 環境改走 CORS proxy 抓 Yahoo chart JSON，功能與本地代理對齊；proxy 偶發失敗時可改用下方本機伺服器。

> 免費方案的 **private** repo 通常無法開 GitHub Pages；若啟用失敗，請改用本機 `server.py`，或升級方案後再開 Pages。

## 本機執行（建議，報價最穩定）

```bash
cd net-worth-dashboard
python3 server.py
```

瀏覽器開啟：

- http://127.0.0.1:8765/

本機會走 `/api/quotes`、`/api/fx`（由 `server.py` 代理 Yahoo，避開 CORS）。

API：

- `GET /api/quotes?symbols=2330.TW,AAPL`
- `GET /api/fx`（USD/TWD，Yahoo `USDTWD=X`）
- `GET /api/health`

### 其他靜態伺服器

若只用 `npx serve` 或 `python3 -m http.server`，前端會視為「非 localhost API」路徑之外的靜態情境：請直接用 `server.py`，或部署到 GitHub Pages 走 CORS proxy。

```bash
# 不建議用於報價（無 /api 代理）
python3 -m http.server 8765
```

## 如何編輯持股

1. 在「持股明細」直接編輯／新增／刪除列；或
2. 在「匯入持股」貼上 CSV／逐行文字，格式：

```text
broker,market,symbol,quantity,currency
Firstrade,美股,AAPL,10,USD
國泰證券,台股,2330.TW,100,TWD
兆豐證券,台股,0050.TW,200,TWD
```

- 券商：`Firstrade` / `國泰證券` / `兆豐證券`
- 市場：`台股` / `美股` / `其他`
- 台股代號可寫 `2330` 或 `2330.TW`（匯入時會自動補 `.TW`）
- 資料存在瀏覽器 `localStorage`，清除網站資料會消失
- 點「還原範例」可回到示範資料

## 功能摘要

- 依券商、依市場小計；總淨值 TWD + USD
- 匯率可自動抓取，失敗時可手動覆寫
- 報價失敗會顯示錯誤，並沿用上次成功快取（不會捏造現價）
- localhost → `/api/*`；GitHub Pages 等靜態站 → CORS proxy + Yahoo chart

## 限制

- 報價與匯率依賴 Yahoo 公開端點（與可選 CORS proxy），可能延遲、限流或暫時失敗
- 非投資建議；數值僅供個人整理參考
- 不要直接用 `file://` 開 HTML（無法呼叫本地 API）

## 檔案

| 檔案 | 說明 |
|------|------|
| `index.html` | 頁面 |
| `styles.css` | 樣式 |
| `app.js` | 前端邏輯（含靜態站 CORS 報價路徑） |
| `server.py` | 靜態伺服器 + 報價代理（port 8765） |
| `holdings-*.csv` | 持股匯入用 CSV |
