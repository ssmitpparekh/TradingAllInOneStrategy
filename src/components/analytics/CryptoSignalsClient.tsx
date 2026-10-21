"use client";

import { useEffect, useState } from "react";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";
import {
  buildScannerStaticContext,
  evaluateScannerContext,
  type ScannerOpportunity
} from "@/lib/scanner/engine";
import type { ChartCandle } from "@/components/MarketChart";

const PAIRS = [
  { symbol: "BTC/USD", name: "Bitcoin" },
  { symbol: "ETH/USD", name: "Ethereum" },
  { symbol: "SOL/USD", name: "Solana" },
  { symbol: "XRP/USD", name: "XRP" }
];

type Row = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  opportunity: ScannerOpportunity | null;
  error?: string;
};

export default function CryptoSignalsClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const next = await Promise.all(
        PAIRS.map(async (pair) => {
          try {
            const [historyResponse, quoteResponse] = await Promise.all([
              fetch(
                `/api/market/history?market=KRAKEN&symbol=${encodeURIComponent(pair.symbol)}&resolution=15&range=5D`,
                { cache: "no-store" }
              ),
              fetch(
                `/api/kraken/quote?symbol=${encodeURIComponent(pair.symbol)}`,
                { cache: "no-store" }
              )
            ]);

            const history = await historyResponse.json();
            const quoteBody = await quoteResponse.json();

            if (!historyResponse.ok || !history.ok) {
              throw new Error(history.error || "History unavailable.");
            }
            if (!quoteResponse.ok || !quoteBody.ok) {
              throw new Error(quoteBody.error || "Quote unavailable.");
            }

            const candles = (history.candles ?? []) as ChartCandle[];
            const quote = quoteBody.quote;
            const context = buildScannerStaticContext(
              {
                symbol: pair.symbol,
                name: pair.name,
                market: "KRAKEN",
                type: "CRYPTO",
                underlying: pair.symbol,
                lotSize: null
              },
              candles
            );

            const now = Math.floor(Date.now() / 1000);
            const opportunity =
              context && quote?.lp
                ? evaluateScannerContext(context, {
                    price: Number(quote.lp),
                    observedHigh: Number(quote.high ?? quote.lp),
                    observedLow: Number(quote.low ?? quote.lp),
                    observedSince: now,
                    updatedAt: Date.now(),
                    sourceTime: now
                  })
                : null;

            return {
              symbol: pair.symbol,
              name: pair.name,
              price: Number(quote?.lp ?? 0),
              changePercent: Number(quote?.chp ?? 0),
              opportunity
            } satisfies Row;
          } catch (error) {
            return {
              symbol: pair.symbol,
              name: pair.name,
              price: 0,
              changePercent: 0,
              opportunity: null,
              error:
                error instanceof Error ? error.message : "Unable to load."
            } satisfies Row;
          }
        })
      );

      if (!cancelled) {
        setRows(next);
        setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="analyticsPage">
      <AnalyticsHeader
        title="Crypto Signals"
        description="Kraken crypto evaluated through the same confirmed ALLINONEVIEW core strategy used by the main scanner. No separate shortcut signal formula."
        badge="KRAKEN · CORE STRATEGY"
      />

      {loading ? (
        <section className="analyticsLoading">Evaluating crypto pairs…</section>
      ) : (
        <section className="cryptoSignalGrid">
          {rows.map((row) => (
            <article className="card cryptoSignalCard" key={row.symbol}>
              <div className="cryptoSignalHeader">
                <div>
                  <p className="label">{row.symbol}</p>
                  <h2>{row.name}</h2>
                </div>
                <strong
                  className={
                    row.changePercent >= 0 ? "positive" : "negative"
                  }
                >
                  {row.changePercent >= 0 ? "+" : ""}
                  {row.changePercent.toFixed(2)}%
                </strong>
              </div>

              <div className="cryptoSignalPrice">
                {row.price
                  ? row.price.toLocaleString("en-US", {
                      maximumFractionDigits: 4
                    })
                  : "—"}
              </div>

              {row.error ? (
                <p className="analyticsMethodNote">{row.error}</p>
              ) : row.opportunity ? (
                <div
                  className={
                    row.opportunity.direction === "bullish"
                      ? "cryptoSignalState bullish"
                      : "cryptoSignalState bearish"
                  }
                >
                  <strong>
                    {row.opportunity.direction.toUpperCase()} · STRONG
                  </strong>
                  <span>{row.opportunity.trigger}</span>
                  <small>
                    Entry {row.opportunity.entry.toLocaleString("en-US")} · SL{" "}
                    {row.opportunity.stopLoss.toLocaleString("en-US")}
                  </small>
                </div>
              ) : (
                <div className="cryptoSignalState neutral">
                  <strong>NO CONFIRMED TRADE</strong>
                  <span>Core strategy gate is not READY.</span>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      <p className="analyticsMethodNote">
        A green/red daily move does not create a signal. This page only shows a
        trade when the existing ALLINONEVIEW confirmed trade-plan engine returns
        READY.
      </p>
    </main>
  );
}
