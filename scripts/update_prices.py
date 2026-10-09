#!/usr/bin/env python3
"""Fetch Yahoo quotes for holdings and write prices-snapshot.json (same-origin for GitHub Pages)."""
from __future__ import annotations

import csv
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "prices-snapshot.json"
CSV = ROOT / "holdings-all.csv"
UA = {"User-Agent": "Mozilla/5.0 (compatible; net-worth-dashboard/1.0)"}


def load_symbols() -> list[str]:
    symbols: set[str] = set()
    if CSV.exists():
        with CSV.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                sym = (row.get("symbol") or "").strip()
                if sym:
                    symbols.add(sym)
    symbols.add("USDTWD=X")
    return sorted(symbols)


def fetch_chart(symbol: str) -> dict:
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        + urllib.parse.quote(symbol)
        + "?interval=1d&range=1d"
    )
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.load(resp)
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        err = ((data.get("chart") or {}).get("error") or {}).get("description") or "no result"
        raise RuntimeError(err)
    meta = result[0].get("meta") or {}
    price = meta.get("regularMarketPrice")
    if price is None:
        closes = (((result[0].get("indicators") or {}).get("quote") or [{}])[0] or {}).get("close") or []
        for c in reversed(closes):
            if c is not None:
                price = c
                break
    if price is None:
        raise RuntimeError("no price")
    return {
        "price": float(price),
        "currency": meta.get("currency") or "",
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "fetchedAt": int(time.time() * 1000),
    }


def main() -> None:
    quotes: dict = {}
    errors: dict = {}
    for sym in load_symbols():
        try:
            quotes[sym] = fetch_chart(sym)
            print(f"OK {sym} {quotes[sym]['price']}")
        except Exception as e:  # noqa: BLE001
            errors[sym] = str(e)
            print(f"ERR {sym} {e}")
    fx = quotes.pop("USDTWD=X", None)
    snapshot = {
        "updatedAt": int(time.time() * 1000),
        "updatedAtIso": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "fx": {
            "pair": "USD/TWD",
            "rate": fx["price"] if fx else None,
            "source": "Yahoo Finance USDTWD=X",
            "name": (fx or {}).get("name"),
        },
        "quotes": quotes,
        "errors": errors,
    }
    OUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} quotes={len(quotes)} errors={len(errors)}")


if __name__ == "__main__":
    main()
