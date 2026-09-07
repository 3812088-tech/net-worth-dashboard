(() => {
  "use strict";

  const STORAGE_KEY = "networth.holdings.v10";
  const PRICES_KEY = "networth.prices.v10";
  const FX_KEY = "networth.fx.v10";
  const DEMO_FLAG_KEY = "networth.isDemo.v10";

  const BROKERS = ["Firstrade", "國泰證券", "兆豐證券"];
  const MARKETS = ["台股", "美股", "其他"];
  const CURRENCIES = ["TWD", "USD"];

  /** @type {Array<{id:string,broker:string,market:string,symbol:string,name:string,quantity:number,currency:string}>} */
  let holdings = [];
  /** @type {Record<string,{price:number,currency:string,name?:string,fetchedAt:number,error?:string}>} */
  let priceCache = {};
  let fxRate = 32.0;
  let fxMeta = { source: "手動預設", time: null, manual: true };
  let isDemo = true;

  const uid = () =>
    "h_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const DEMO_HOLDINGS = [
    { id: uid(), broker: "國泰證券", market: "台股", symbol: "2330.TW", name: "台積電", quantity: 100, currency: "TWD" },
    { id: uid(), broker: "兆豐證券", market: "台股", symbol: "0050.TW", name: "元大台灣50", quantity: 200, currency: "TWD" },
    { id: uid(), broker: "Firstrade", market: "美股", symbol: "AAPL", name: "Apple", quantity: 15, currency: "USD" },
    { id: uid(), broker: "Firstrade", market: "美股", symbol: "TSLA", name: "Tesla", quantity: 5, currency: "USD" },
    { id: uid(), broker: "國泰證券", market: "美股", symbol: "VOO", name: "Vanguard S&P 500", quantity: 8, currency: "USD" },
    { id: uid(), broker: "兆豐證券", market: "其他", symbol: "00713.TW", name: "元大台灣高息低波", quantity: 300, currency: "TWD" },
  ];

  // 公開站不內嵌真實持股；請用匯入或手動新增
  const USER_HOLDINGS = [];

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const holdingsBody = $("#holdings-body");
  const demoBanner = $("#demo-banner");
  const totalTwdEl = $("#total-twd");
  const totalUsdEl = $("#total-usd");
  const breakdownEl = $("#breakdown");
  const priceStatusEl = $("#price-status");
  const saveStatusEl = $("#save-status");
  const fxInput = $("#fx-rate");
  const fxMetaEl = $("#fx-meta");
  const importText = $("#import-text");
  const importMsg = $("#import-msg");

  // ---------- Storage ----------
  
  function ensureCashPrice() {
    const cash = holdings.filter((h) => h.symbol === "CASH-USD");
    if (!cash.length) return;
    priceCache["CASH-USD"] = {
      price: 1,
      currency: "USD",
      name: "USD Cash",
      fetchedAt: Date.now(),
    };
  }

function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const demoRaw = localStorage.getItem(DEMO_FLAG_KEY);
      if (raw) {
        holdings = JSON.parse(raw);
        isDemo = demoRaw === null ? false : demoRaw === "1";
      } else {
        holdings = structuredClone(USER_HOLDINGS);
        isDemo = false;
        saveHoldings();
      }
    } catch {
      holdings = structuredClone(USER_HOLDINGS);
      isDemo = false;
    }

    try {
      const p = localStorage.getItem(PRICES_KEY);
      if (p) priceCache = JSON.parse(p);
    } catch {
      priceCache = {};
    }

    try {
      const f = localStorage.getItem(FX_KEY);
      if (f) {
        const parsed = JSON.parse(f);
        if (parsed && typeof parsed.rate === "number" && parsed.rate > 0) {
          fxRate = parsed.rate;
          fxMeta = {
            source: parsed.source || "快取",
            time: parsed.time || null,
            manual: !!parsed.manual,
          };
        }
      }
    } catch {
      /* keep defaults */
    }
  }

  function saveHoldings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
    localStorage.setItem(DEMO_FLAG_KEY, isDemo ? "1" : "0");
    saveStatusEl.textContent = "已儲存至本機";
    setTimeout(() => {
      if (saveStatusEl.textContent === "已儲存至本機") saveStatusEl.textContent = "";
    }, 1800);
  }

  function savePrices() {
    localStorage.setItem(PRICES_KEY, JSON.stringify(priceCache));
  }

  function saveFx() {
    localStorage.setItem(
      FX_KEY,
      JSON.stringify({ rate: fxRate, source: fxMeta.source, time: fxMeta.time, manual: fxMeta.manual })
    );
  }

  // ---------- Formatting ----------
  function fmtMoney(n, currency) {
    if (n == null || Number.isNaN(n)) return "—";
    const abs = Math.abs(n);
    const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
    try {
      return new Intl.NumberFormat("zh-TW", {
        style: "currency",
        currency,
        maximumFractionDigits: digits,
        minimumFractionDigits: currency === "TWD" && digits === 0 ? 0 : Math.min(2, digits),
      }).format(n);
    } catch {
      return (currency === "TWD" ? "NT$" : "$") + n.toFixed(2);
    }
  }

  function fmtNum(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return "—";
    return new Intl.NumberFormat("zh-TW", {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }).format(n);
  }

  function fmtTime(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) + " (台北)";
    } catch {
      return new Date(ts).toISOString();
    }
  }

  // ---------- Symbol helpers ----------
  function normalizeSymbol(sym, market) {
    let s = (sym || "").trim().toUpperCase();
    if (!s) return s;
    if (market === "台股" && /^\d{4,6}$/.test(s)) s = s + ".TW";
    return s;
  }

  function marketValueTWD(h) {
    const q = priceCache[h.symbol];
    if (!q || q.price == null || q.error) return null;
    const mv = q.price * Number(h.quantity || 0);
    const ccy = (q.currency || h.currency || "USD").toUpperCase();
    if (ccy === "TWD" || ccy === "TAI") return mv;
    if (ccy === "USD") return mv * fxRate;
    // treat unknown as USD-ish if holding currency says USD else TWD
    if ((h.currency || "").toUpperCase() === "USD") return mv * fxRate;
    return mv;
  }

  function marketValueNative(h) {
    const q = priceCache[h.symbol];
    if (!q || q.price == null || q.error) return null;
    return q.price * Number(h.quantity || 0);
  }

  // ---------- Render ----------
  function optionHtml(list, selected) {
    return list.map((v) => `<option value="${escapeAttr(v)}"${v === selected ? " selected" : ""}>${escapeHtml(v)}</option>`).join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function renderTable() {
    demoBanner.classList.toggle("hidden", !isDemo);

    if (!holdings.length) {
      holdingsBody.innerHTML =
        '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:1.5rem">尚無持股 — 請新增或匯入</td></tr>';
      renderTotals();
      return;
    }

    holdingsBody.innerHTML = holdings
      .map((h) => {
        const q = priceCache[h.symbol];
        let priceCell = '<span class="price-stale">—</span>';
        let mvCell = "—";
        if (q) {
          if (q.error && q.price == null) {
            priceCell = `<span class="price-err" title="${escapeAttr(q.error)}">錯誤</span>`;
          } else if (q.price != null) {
            const ccy = (q.currency || h.currency || "").toUpperCase();
            const stale = q.error ? " price-stale" : " price-ok";
            priceCell = `<span class="${stale.trim()}" title="${q.error ? escapeAttr(q.error) : "OK"}">${fmtNum(q.price, 4)} <small>${escapeHtml(ccy)}</small></span>`;
            const mv = marketValueNative(h);
            mvCell = mv == null ? "—" : fmtMoney(mv, ccy === "TWD" || ccy === "TAI" ? "TWD" : "USD");
            if (q.name && !h.name) {
              // leave name field as-is; user edits manually
            }
          }
        }
        return `<tr data-id="${escapeAttr(h.id)}">
          <td><select data-f="broker">${optionHtml(BROKERS, h.broker)}</select></td>
          <td><select data-f="market">${optionHtml(MARKETS, h.market)}</select></td>
          <td><input type="text" data-f="symbol" value="${escapeAttr(h.symbol)}" placeholder="2330.TW" /></td>
          <td><input type="text" data-f="name" value="${escapeAttr(h.name || "")}" placeholder="選填" /></td>
          <td><input type="number" data-f="quantity" value="${escapeAttr(h.quantity)}" min="0" step="any" /></td>
          <td><select data-f="currency">${optionHtml(CURRENCIES, h.currency)}</select></td>
          <td class="cell-price">${priceCell}</td>
          <td class="cell-mv">${mvCell}</td>
          <td><button type="button" class="btn icon danger" data-action="del" title="刪除">✕</button></td>
        </tr>`;
      })
      .join("");

    renderTotals();
  }

  function renderTotals() {
    let totalTwd = 0;
    let priced = 0;
    let unpriced = 0;
    const byBroker = {};
    const byMarket = {};
    BROKERS.forEach((b) => (byBroker[b] = 0));
    MARKETS.forEach((m) => (byMarket[m] = 0));

    for (const h of holdings) {
      const mv = marketValueTWD(h);
      if (mv == null) {
        unpriced += 1;
        continue;
      }
      priced += 1;
      totalTwd += mv;
      byBroker[h.broker] = (byBroker[h.broker] || 0) + mv;
      byMarket[h.market] = (byMarket[h.market] || 0) + mv;
    }

    const totalUsd = fxRate > 0 ? totalTwd / fxRate : null;
    totalTwdEl.textContent = priced ? fmtMoney(totalTwd, "TWD") : "—";
    totalUsdEl.textContent = priced && totalUsd != null ? fmtMoney(totalUsd, "USD") : "—";

    const brokerHtml = BROKERS.map((k) => {
      const has = holdings.some((h) => h.broker === k);
      if (!has) return "";
      const v = byBroker[k] || 0;
      const anyPriced = holdings.some((h) => h.broker === k && marketValueTWD(h) != null);
      return `<div class="breakdown-row"><span class="lbl">${escapeHtml(k)}</span><span class="amt">${anyPriced ? fmtMoney(v, "TWD") : "—"}</span></div>`;
    }).join("");

    const marketHtml = MARKETS.map((k) => {
      const has = holdings.some((h) => h.market === k);
      if (!has) return "";
      const v = byMarket[k] || 0;
      const anyPriced = holdings.some((h) => h.market === k && marketValueTWD(h) != null);
      return `<div class="breakdown-row"><span class="lbl">${escapeHtml(k)}</span><span class="amt">${anyPriced ? fmtMoney(v, "TWD") : "—"}</span></div>`;
    }).join("");

    breakdownEl.innerHTML = `
      <div class="breakdown-block"><h3>依券商 (TWD)</h3>${brokerHtml || '<div class="breakdown-row"><span class="lbl">無</span></div>'}</div>
      <div class="breakdown-block"><h3>依市場 (TWD)</h3>${marketHtml || '<div class="breakdown-row"><span class="lbl">無</span></div>'}</div>
    `;

    void unpriced;
  }

  function renderFx() {
    fxInput.value = String(fxRate);
    const t = fxMeta.time ? fmtTime(fxMeta.time) : "";
    fxMetaEl.textContent = fxMeta.manual
      ? `手動設定${t ? " · " + t : ""}`
      : `${fxMeta.source || "Yahoo"}${t ? " · " + t : ""}`;
  }

  // ---------- Events ----------
  function bindTableEvents() {
    holdingsBody.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const tr = t.closest("tr[data-id]");
      if (!tr) return;
      const id = tr.getAttribute("data-id");
      const h = holdings.find((x) => x.id === id);
      if (!h) return;
      const field = t.getAttribute("data-f");
      if (!field) return;

      if (t instanceof HTMLSelectElement || t instanceof HTMLInputElement) {
        let val = t.value;
        if (field === "quantity") {
          h.quantity = Number(val);
          if (Number.isNaN(h.quantity)) h.quantity = 0;
        } else if (field === "symbol") {
          h.symbol = normalizeSymbol(val, h.market);
          t.value = h.symbol;
        } else if (field === "market") {
          h.market = val;
          h.symbol = normalizeSymbol(h.symbol, h.market);
        } else if (field === "broker") {
          h.broker = val;
        } else if (field === "currency") {
          h.currency = val;
        } else if (field === "name") {
          h.name = val;
        }
        isDemo = false;
        saveHoldings();
        renderTable();
      }
    });

    holdingsBody.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const btn = t.closest("[data-action=del]");
      if (!btn) return;
      const tr = btn.closest("tr[data-id]");
      if (!tr) return;
      const id = tr.getAttribute("data-id");
      holdings = holdings.filter((x) => x.id !== id);
      isDemo = false;
      saveHoldings();
      renderTable();
    });
  }

  $("#btn-add").addEventListener("click", () => {
    holdings.push({
      id: uid(),
      broker: BROKERS[0],
      market: "美股",
      symbol: "",
      name: "",
      quantity: 0,
      currency: "USD",
    });
    isDemo = false;
    saveHoldings();
    renderTable();
  });

  $("#btn-clear").addEventListener("click", () => {
    if (!confirm("確定清空所有持股？")) return;
    holdings = [];
    isDemo = false;
    saveHoldings();
    renderTable();
  });

  $("#btn-reset-demo").addEventListener("click", () => {
    if (!confirm("還原為範例資料？目前持股將被覆蓋。")) return;
    holdings = DEMO_HOLDINGS.map((h) => ({ ...h, id: uid() }));
    isDemo = true;
    saveHoldings();
    renderTable();
    refreshPrices();
  });

  fxInput.addEventListener("change", () => {
    const v = Number(fxInput.value);
    if (!v || v <= 0) {
      renderFx();
      return;
    }
    fxRate = v;
    fxMeta = { source: "手動", time: Date.now(), manual: true };
    saveFx();
    renderFx();
    renderTotals();
    renderTable();
  });

  $("#btn-fx").addEventListener("click", () => refreshFx());
  $("#btn-refresh").addEventListener("click", () => {
    refreshFx();
    refreshPrices();
  });

  function parseImport(text) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) throw new Error("沒有內容");

    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/[,，\t]/).map((p) => p.trim());
      if (parts.length < 4) throw new Error(`第 ${i + 1} 行欄位不足`);
      // skip header
      if (i === 0 && /broker|券商|symbol|代號/i.test(parts[0] + parts[2])) continue;

      let [broker, market, symbol, quantity, currency] = parts;
      if (!BROKERS.includes(broker)) {
        // allow fuzzy? keep as-is but warn — force to first known if close
        const found = BROKERS.find((b) => b.toLowerCase() === broker.toLowerCase());
        if (found) broker = found;
        else throw new Error(`第 ${i + 1} 行券商無效：${broker}（可用：${BROKERS.join(" / ")}）`);
      }
      if (!MARKETS.includes(market)) {
        if (/tw|台/i.test(market)) market = "台股";
        else if (/us|美/i.test(market)) market = "美股";
        else if (/other|其/i.test(market)) market = "其他";
        else throw new Error(`第 ${i + 1} 行市場無效：${market}`);
      }
      symbol = normalizeSymbol(symbol, market);
      const qty = Number(quantity);
      if (!symbol || Number.isNaN(qty)) throw new Error(`第 ${i + 1} 行代號或數量無效`);
      currency = (currency || (market === "台股" ? "TWD" : "USD")).toUpperCase();
      if (!CURRENCIES.includes(currency)) currency = market === "台股" ? "TWD" : "USD";

      rows.push({
        id: uid(),
        broker,
        market,
        symbol,
        name: "",
        quantity: qty,
        currency,
      });
    }
    if (!rows.length) throw new Error("沒有可匯入的資料列");
    return rows;
  }

  function doImport(replace) {
    try {
      const rows = parseImport(importText.value);
      holdings = replace ? rows : holdings.concat(rows);
      isDemo = false;
      saveHoldings();
      renderTable();
      importMsg.textContent = `已匯入 ${rows.length} 筆` + (replace ? "（已取代）" : "（已附加）");
      refreshPrices();
    } catch (err) {
      importMsg.textContent = "匯入失敗：" + (err && err.message ? err.message : String(err));
    }
  }

  $("#btn-import-replace").addEventListener("click", () => doImport(true));
  $("#btn-import-append").addEventListener("click", () => doImport(false));

  // ---------- API ----------
  const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
  const CORS_PROXY = "https://api.allorigins.win/raw?url=";

  function isLocalApiHost() {
    const h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function yahooChartUrl(symbol) {
    return (
      YAHOO_CHART +
      encodeURIComponent(symbol) +
      "?interval=1d&range=1d"
    );
  }

  function proxiedYahooUrl(symbol) {
    return CORS_PROXY + encodeURIComponent(yahooChartUrl(symbol));
  }

  /** Parse Yahoo chart JSON the same way server.py does. */
  function parseYahooChart(data, symbol) {
    const result = (data && data.chart && data.chart.result) || null;
    if (!result || !result.length) {
      const err = (data && data.chart && data.chart.error) || {};
      throw new Error(err.description || "no result");
    }
    const meta = result[0].meta || {};
    let price = meta.regularMarketPrice;
    if (price == null) {
      const indicators = result[0].indicators || {};
      const quotes = (indicators.quote || [{}])[0] || {};
      const closes = quotes.close || [];
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null) {
          price = closes[i];
          break;
        }
      }
    }
    if (price == null) throw new Error("no price for " + symbol);
    const previous = meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose;
    return {
      symbol,
      price: Number(price),
      currency: meta.currency || "",
      name: meta.longName || meta.shortName || symbol,
      previousClose: previous != null ? Number(previous) : null,
      marketState: meta.marketState,
      exchange: meta.exchangeName || meta.fullExchangeName,
    };
  }

  async function fetchQuotesViaProxy(symbols) {
    const quotes = {};
    const errors = {};
    await Promise.all(
      symbols.slice(0, 40).map(async (sym) => {
        try {
          const res = await fetch(proxiedYahooUrl(sym));
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          quotes[sym] = parseYahooChart(data, sym);
        } catch (e) {
          errors[sym] = e && e.message ? e.message : String(e);
        }
      })
    );
    return { quotes, errors };
  }

  async function fetchFxViaProxy() {
    const res = await fetch(proxiedYahooUrl("USDTWD=X"));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const q = parseYahooChart(data, "USDTWD=X");
    return {
      pair: "USD/TWD",
      rate: q.price,
      source: "Yahoo Finance via CORS proxy (USDTWD=X)",
      name: q.name,
    };
  }

  async function fetchQuotesPayload(symbols) {
    if (isLocalApiHost()) {
      const url = "/api/quotes?symbols=" + encodeURIComponent(symbols.join(","));
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      return { quotes: data.quotes || {}, errors: data.errors || {} };
    }
    return fetchQuotesViaProxy(symbols);
  }

  async function fetchFxPayload() {
    if (isLocalApiHost()) {
      const res = await fetch("/api/fx");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);
      return data;
    }
    return fetchFxViaProxy();
  }

  async function refreshFx() {
    fxMetaEl.textContent = "抓取中…";
    try {
      const data = await fetchFxPayload();
      fxRate = Number(data.rate);
      fxMeta = {
        source: data.source || "Yahoo Finance",
        time: Date.now(),
        manual: false,
      };
      saveFx();
      renderFx();
      renderTotals();
      renderTable();
    } catch (err) {
      fxMetaEl.textContent =
        "匯率抓取失敗，請手動輸入。原因：" + (err && err.message ? err.message : String(err));
    }
  }

  async function refreshPrices() {
    const symbols = [...new Set(holdings.map((h) => h.symbol).filter((s) => s && s !== "CASH-USD"))];
    ensureCashPrice();
    if (!symbols.length) {
      priceStatusEl.textContent = "無代號可更新";
      return;
    }

    const btn = $("#btn-refresh");
    btn.disabled = true;
    priceStatusEl.textContent = `更新報價中（${symbols.length}）…`;
    document.body.classList.add("loading-pulse");

    try {
      const data = await fetchQuotesPayload(symbols);
      const quotes = data.quotes || {};
      const errors = data.errors || {};
      const now = Date.now();
      let ok = 0;
      let fail = 0;

      for (const sym of symbols) {
        if (quotes[sym] && quotes[sym].price != null) {
          const prev = priceCache[sym] || {};
          priceCache[sym] = {
            price: quotes[sym].price,
            currency: quotes[sym].currency || prev.currency || "",
            name: quotes[sym].name || prev.name,
            fetchedAt: now,
            error: undefined,
          };
          // fill empty names
          for (const h of holdings) {
            if (h.symbol === sym && !h.name && quotes[sym].name) h.name = quotes[sym].name;
          }
          ok += 1;
        } else {
          fail += 1;
          const msg = errors[sym] || "無報價";
          const prev = priceCache[sym];
          if (prev && prev.price != null) {
            priceCache[sym] = { ...prev, error: "沿用快取 · " + msg };
          } else {
            priceCache[sym] = { price: null, currency: "", fetchedAt: now, error: msg };
          }
        }
      }

      savePrices();
      saveHoldings();
      priceStatusEl.textContent = `報價更新完成：成功 ${ok}、失敗 ${fail} · ${fmtTime(now)}`;
      if (fail && ok === 0) {
        priceStatusEl.textContent += isLocalApiHost()
          ? "（全部失敗，請確認已用本地 server.py 開啟，而非直接開 HTML）"
          : "（全部失敗：靜態站 CORS proxy／Yahoo 可能暫時不可用，可改用本機 python3 server.py）";
      }
    } catch (err) {
      priceStatusEl.textContent =
        "報價更新失敗：" +
        (err && err.message ? err.message : String(err)) +
        (isLocalApiHost()
          ? " — 請用 python3 server.py 啟動後再開瀏覽器"
          : " — 靜態站請檢查 CORS proxy；或改用本機 python3 server.py");
    } finally {
      btn.disabled = false;
      document.body.classList.remove("loading-pulse");
      renderTable();
    }
  }

  // ---------- Init ----------
  loadState();
  ensureCashPrice();
  bindTableEvents();
  renderFx();
  renderTable();

  // auto refresh on load
  refreshFx().finally(() => refreshPrices());
})();
