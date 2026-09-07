#!/usr/bin/env python3
"""本地靜態伺服器 + Yahoo Finance 報價代理（解決瀏覽器 CORS）。"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8765
ROOT = Path(__file__).resolve().parent
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
USER_AGENT = (
    "Mozilla/5.0 (compatible; NetWorthDashboard/1.0; +local)"
)


def fetch_yahoo_quote(symbol: str) -> dict:
    url = YAHOO_CHART.format(symbol=urllib.parse.quote(symbol, safe=""))
    url += "?interval=1d&range=1d"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=12) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    result = (data.get("chart") or {}).get("result")
    if not result:
        err = (data.get("chart") or {}).get("error") or {"description": "no result"}
        raise ValueError(err.get("description") or "quote failed")

    meta = result[0].get("meta") or {}
    price = meta.get("regularMarketPrice")
    if price is None:
        # fallback: last close from indicators
        indicators = result[0].get("indicators") or {}
        quotes = (indicators.get("quote") or [{}])[0]
        closes = quotes.get("close") or []
        for c in reversed(closes):
            if c is not None:
                price = c
                break
    if price is None:
        raise ValueError(f"no price for {symbol}")

    currency = meta.get("currency") or ""
    name = meta.get("longName") or meta.get("shortName") or symbol
    previous = meta.get("chartPreviousClose") or meta.get("previousClose")
    return {
        "symbol": symbol,
        "price": float(price),
        "currency": currency,
        "name": name,
        "previousClose": float(previous) if previous is not None else None,
        "marketState": meta.get("marketState"),
        "exchange": meta.get("exchangeName") or meta.get("fullExchangeName"),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/quotes":
            self._handle_quotes(parsed)
            return
        if parsed.path == "/api/fx":
            self._handle_fx()
            return
        if parsed.path == "/api/health":
            self._json(200, {"ok": True})
            return
        super().do_GET()

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_quotes(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        raw = (qs.get("symbols") or [""])[0]
        symbols = [s.strip() for s in raw.split(",") if s.strip()]
        if not symbols:
            self._json(400, {"error": "missing symbols"})
            return
        quotes = {}
        errors = {}
        for sym in symbols[:40]:
            try:
                quotes[sym] = fetch_yahoo_quote(sym)
            except Exception as e:  # noqa: BLE001 — surface per-symbol errors
                errors[sym] = str(e)
        self._json(200, {"quotes": quotes, "errors": errors})

    def _handle_fx(self):
        try:
            q = fetch_yahoo_quote("USDTWD=X")
            self._json(
                200,
                {
                    "pair": "USD/TWD",
                    "rate": q["price"],
                    "source": "Yahoo Finance (USDTWD=X)",
                    "name": q.get("name"),
                },
            )
        except Exception as e:  # noqa: BLE001
            self._json(502, {"error": str(e)})

    def log_message(self, fmt, *args):
        # quieter default logs
        sys_stderr = __import__("sys").stderr
        sys_stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Net-worth dashboard: http://127.0.0.1:{PORT}/")
    print(f"Serving: {ROOT}")
    print("API: /api/quotes?symbols=2330.TW,AAPL  |  /api/fx")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
