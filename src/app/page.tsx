"use client";

import { useEffect, useState } from "react";

type Quote = {
  symbol: string;
  lp: number;
  ch: number;
  chp: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  bid: number;
  ask: number;
};

export default function Home() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState("Checking FYERS connection…");
  const [loading, setLoading] = useState(false);

  async function refreshStatus() {
    try {
      const response = await fetch("/api/fyers/status", { cache: "no-store" });
      const data = await response.json();
      setConnected(Boolean(data.connected));
      setMessage(
        data.connected
          ? "FYERS connected. Market-data access is ready."
          : "FYERS is not connected yet."
      );
    } catch {
      setConnected(false);
      setMessage("Unable to read FYERS connection status.");
    }
  }

  async function testNiftyQuote() {
    setLoading(true);
    setMessage("Requesting NIFTY 50 quote from FYERS…");

    try {
      const response = await fetch("/api/fyers/quote", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Quote request failed.");
      }

      setQuote(data.quote);
      setConnected(true);
      setMessage("Live FYERS quote received successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to fetch the quote."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">PHASE 1 · DATA FOUNDATION</p>
        <h1>ALLINONEVIEW</h1>
        <p className="lead">
          Read-only market analysis. No order placement. FYERS is used only for
          permitted market and historical data.
        </p>
      </section>

      <section className="card">
        <div className="row">
          <div>
            <p className="label">FYERS connection</p>
            <p className={connected ? "status good" : "status"}>
              {connected === null
                ? "Checking…"
                : connected
                  ? "Connected"
                  : "Not connected"}
            </p>
          </div>

          <a className="button" href="/api/auth/fyers/login">
            Connect FYERS
          </a>
        </div>

        <p className="message">{message}</p>
      </section>

      <section className="card">
        <div className="row">
          <div>
            <p className="label">First data test</p>
            <h2>NIFTY 50</h2>
          </div>

          <button
            className="button secondary"
            onClick={testNiftyQuote}
            disabled={loading}
          >
            {loading ? "Loading…" : "Test live quote"}
          </button>
        </div>

        {quote ? (
          <div className="quoteGrid">
            <div>
              <span>LTP</span>
              <strong>{quote.lp.toLocaleString("en-IN")}</strong>
            </div>
            <div>
              <span>Change</span>
              <strong>
                {quote.ch.toFixed(2)} ({quote.chp.toFixed(2)}%)
              </strong>
            </div>
            <div>
              <span>Open</span>
              <strong>{quote.open.toLocaleString("en-IN")}</strong>
            </div>
            <div>
              <span>High</span>
              <strong>{quote.high.toLocaleString("en-IN")}</strong>
            </div>
            <div>
              <span>Low</span>
              <strong>{quote.low.toLocaleString("en-IN")}</strong>
            </div>
            <div>
              <span>Previous close</span>
              <strong>{quote.previousClose.toLocaleString("en-IN")}</strong>
            </div>
          </div>
        ) : (
          <p className="placeholder">
            Connect FYERS, then press “Test live quote”.
          </p>
        )}
      </section>

      <section className="card roadmap">
        <p className="label">Next after the quote works</p>
        <p>
          Historical candles → live WebSocket → chart → Fib / Trend Fib →
          BOS/CHoCH → Order Blocks/FVG → futures volume/OI → options ΔOI →
          reversal score.
        </p>
      </section>
    </main>
  );
}
