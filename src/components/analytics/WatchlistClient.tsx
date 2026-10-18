"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";

const KEY = "allinoneview:watchlist:v1";

type WatchItem = {
  id: string;
  market: "NSE" | "BSE" | "MCX" | "KRAKEN" | "OANDA";
  symbol: string;
  name: string;
};

type Quote = {
  lp: number;
  ch: number;
  chp: number;
  bid?: number;
  ask?: number;
};

type QuoteRow = WatchItem & {
  quote: Quote | null;
  error?: string;
};

const PRESETS: WatchItem[] = [
  { id: "nifty", market: "NSE", symbol: "NSE:NIFTY50-INDEX", name: "NIFTY 50" },
  { id: "banknifty", market: "NSE", symbol: "NSE:NIFTYBANK-INDEX", name: "BANK NIFTY" },
  { id: "btc", market: "KRAKEN", symbol: "BTC/USD", name: "Bitcoin" },
  { id: "eth", market: "KRAKEN", symbol: "ETH/USD", name: "Ethereum" },
  { id: "gold", market: "OANDA", symbol: "XAU_USD", name: "Gold" }
];

function quoteUrl(item: WatchItem) {
  if (item.market === "KRAKEN") {
    return `/api/kraken/quote?symbol=${encodeURIComponent(item.symbol)}`;
  }
  if (item.market === "OANDA") {
    return `/api/oanda/quote?symbol=${encodeURIComponent(item.symbol)}`;
  }
  return `/api/fyers/quote?symbol=${encodeURIComponent(item.symbol)}`;
}

export default function WatchlistClient() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [market, setMarket] = useState<WatchItem["market"]>("NSE");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : PRESETS;
      setItems(Array.isArray(parsed) && parsed.length ? parsed : PRESETS);
    } catch {
      setItems(PRESETS);
    }
  }, []);

  useEffect(() => {
    if (!items.length) return;

    try {
      window.localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      // Keep in-memory list if storage is unavailable.
    }

    let cancelled = false;

    const load = async () => {
      const next = await Promise.all(
        items.map(async (item) => {
          try {
            const response = await fetch(quoteUrl(item), {
              cache: "no-store"
            });
            const body = await response.json();
            if (!response.ok || !body.ok) {
              throw new Error(body.error || "Quote unavailable.");
            }
            return {
              ...item,
              quote: body.quote as Quote
            } satisfies QuoteRow;
          } catch (error) {
            return {
              ...item,
              quote: null,
              error:
                error instanceof Error
                  ? error.message
                  : "Quote unavailable."
            } satisfies QuoteRow;
          }
        })
      );
      if (!cancelled) setRows(next);
    };

    void load();
    const timer = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [items]);

  const sorted = useMemo(
    () =>
      rows.slice().sort((a, b) => {
        const aMove = Math.abs(a.quote?.chp ?? 0);
        const bMove = Math.abs(b.quote?.chp ?? 0);
        return bMove - aMove;
      }),
    [rows]
  );

  const add = (event: FormEvent) => {
    event.preventDefault();
    const cleanSymbol = symbol.trim();
    if (!cleanSymbol) return;

    const id = `${market}:${cleanSymbol}`;
    setItems((current) => {
      if (current.some((item) => item.id === id)) return current;
      return [
        ...current,
        {
          id,
          market,
          symbol: cleanSymbol,
          name: name.trim() || cleanSymbol
        }
      ];
    });
    setSymbol("");
    setName("");
  };

  return (
    <main className="analyticsPage">
      <AnalyticsHeader
        title="Watchlist"
        description="Your cross-market watchlist across India, Kraken crypto and OANDA global instruments."
        badge="LIVE QUOTES"
      />

      <section className="card watchlistAddCard">
        <form className="watchlistAddForm" onSubmit={add}>
          <label>
            <span>MARKET</span>
            <select
              value={market}
              onChange={(event) =>
                setMarket(event.target.value as WatchItem["market"])
              }
            >
              {["NSE", "BSE", "MCX", "KRAKEN", "OANDA"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>SYMBOL</span>
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder={
                market === "KRAKEN"
                  ? "BTC/USD"
                  : market === "OANDA"
                    ? "XAU_USD"
                    : "NSE:RELIANCE-EQ"
              }
            />
          </label>
          <label>
            <span>NAME</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Optional label"
            />
          </label>
          <button className="button" type="submit">
            Add
          </button>
        </form>
      </section>

      <section className="watchlistGrid">
        {sorted.map((row) => (
          <article className="card watchlistCard" key={row.id}>
            <div>
              <p className="label">{row.market}</p>
              <h2>{row.name}</h2>
              <small>{row.symbol}</small>
            </div>

            <div className="watchlistQuote">
              <strong>
                {row.quote
                  ? row.quote.lp.toLocaleString("en-US", {
                      maximumFractionDigits: 5
                    })
                  : "—"}
              </strong>
              <span
                className={
                  (row.quote?.chp ?? 0) >= 0 ? "positive" : "negative"
                }
              >
                {row.quote
                  ? `${row.quote.ch >= 0 ? "+" : ""}${row.quote.ch.toFixed(3)} · ${row.quote.chp >= 0 ? "+" : ""}${row.quote.chp.toFixed(2)}%`
                  : row.error || "Waiting"}
              </span>
            </div>

            <button
              className="watchlistRemove"
              type="button"
              onClick={() =>
                setItems((current) =>
                  current.filter((item) => item.id !== row.id)
                )
              }
            >
              Remove
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
