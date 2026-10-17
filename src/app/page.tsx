"use client";

import { useEffect, useMemo, useState } from "react";
import MarketChart, { type ChartCandle } from "@/components/MarketChart";

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

type Resolution = "5" | "15" | "60" | "1D";

const RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1H" },
  { value: "1D", label: "1D" }
];

export default function Home() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [resolution, setResolution] = useState<Resolution>("15");
  const [message, setMessage] = useState("Checking FYERS connection…");
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamMessage, setStreamMessage] = useState("Stream waiting…");
  const [socketDiagnostic, setSocketDiagnostic] = useState<Record<string, unknown> | null>(null);

  async function refreshStatus() {
    try {
      const response = await fetch("/api/fyers/status", { cache: "no-store" });
      const data = await response.json();
      const isConnected = Boolean(data.connected);
      setConnected(isConnected);
      setMessage(
        isConnected
          ? "FYERS connected. Market-data access is ready."
          : "FYERS is not connected yet."
      );
    } catch {
      setConnected(false);
      setMessage("Unable to read FYERS connection status.");
    }
  }

  async function fetchQuote(silent = false) {
    if (!silent) setLoadingQuote(true);

    try {
      const response = await fetch("/api/fyers/quote", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Quote request failed.");
      }

      setQuote(data.quote);
      setConnected(true);
      if (!silent) setMessage("FYERS quote received successfully.");
    } catch (error) {
      if (!silent) {
        setMessage(
          error instanceof Error ? error.message : "Unable to fetch the quote."
        );
      }
    } finally {
      if (!silent) setLoadingQuote(false);
    }
  }

  async function fetchHistory(nextResolution = resolution) {
    setLoadingChart(true);

    try {
      const response = await fetch(
        `/api/fyers/history?resolution=${encodeURIComponent(nextResolution)}`,
        { cache: "no-store" }
      );
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Historical candle request failed.");
      }

      setCandles(data.candles);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load candles."
      );
    } finally {
      setLoadingChart(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (!connected) return;

    void fetchQuote(true);
    void fetchHistory(resolution);
  }, [connected, resolution]);

  useEffect(() => {
    if (!connected) return;

    void fetch("/api/fyers/socket-diagnostic", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setSocketDiagnostic(data))
      .catch(() => setSocketDiagnostic({ ok: false, problem: "Diagnostic request failed." }));

    const source = new EventSource("/api/fyers/stream");

    const onStatus = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data);
        setStreamConnected(Boolean(payload.connected));
        setStreamMessage(
          payload.connected
            ? "FYERS Data Socket connected"
            : payload.opening
              ? "Opening FYERS Data Socket…"
              : payload.error || "FYERS Data Socket disconnected"
        );
      } catch {
        setStreamConnected(false);
        setStreamMessage("Unable to read stream status.");
      }
    };

    const onTick = (event: MessageEvent<string>) => {
      try {
        const tick = JSON.parse(event.data);

        if (typeof tick.ltp === "number") {
          setQuote((current) =>
            current
              ? {
                  ...current,
                  lp: tick.ltp,
                  ch:
                    typeof tick.ch === "number" ? tick.ch : current.ch,
                  chp:
                    typeof tick.chp === "number" ? tick.chp : current.chp,
                  open:
                    typeof tick.open_price === "number"
                      ? tick.open_price
                      : current.open,
                  high:
                    typeof tick.high_price === "number"
                      ? tick.high_price
                      : current.high,
                  low:
                    typeof tick.low_price === "number"
                      ? tick.low_price
                      : current.low,
                  previousClose:
                    typeof tick.prev_close_price === "number"
                      ? tick.prev_close_price
                      : current.previousClose
                }
              : current
          );
        }
      } catch {
        // Ignore malformed vendor messages and keep the last good quote.
      }
    };

    source.addEventListener("status", onStatus as EventListener);
    source.addEventListener("tick", onTick as EventListener);

    source.onerror = () => {
      setStreamConnected(false);
      setStreamMessage(
        "Browser lost the stream connection. Check the PowerShell window for the FYERS socket error."
      );
    };

    return () => {
      source.close();
      setStreamConnected(false);
    };
  }, [connected]);

  const changeClass = useMemo(() => {
    if (!quote) return "";
    return quote.ch >= 0 ? "positive" : "negative";
  }, [quote]);

  return (
    <main className="shell wide">
      <section className="hero compactHero">
        <p className="eyebrow">PHASE 2 · LIVE MARKET VIEW</p>
        <div className="heroRow">
          <div>
            <h1>ALLINONEVIEW</h1>
            <p className="lead">
              Read-only analysis. FYERS market data. No order placement.
            </p>
          </div>
          <div className="connectionStack">
            <div className={connected ? "connectionPill online" : "connectionPill"}>
              <span className="dot" />
              {connected ? "FYERS CONNECTED" : "FYERS OFFLINE"}
            </div>
            <div className={streamConnected ? "connectionPill online" : "connectionPill"}>
              <span className="dot" />
              {streamConnected ? "LIVE SOCKET" : "SOCKET WAITING"}
            </div>
          </div>
        </div>
      </section>

      {!connected ? (
        <section className="card">
          <div className="row">
            <div>
              <p className="label">FYERS connection</p>
              <p className="status">Not connected</p>
            </div>
            <a className="button" href="/api/auth/fyers/login">
              Connect FYERS
            </a>
          </div>
          <p className="message">{message}</p>
        </section>
      ) : null}

      <section className="terminalCard">
        <div className="marketHeader">
          <div>
            <p className="label">NSE INDEX</p>
            <div className="priceRow">
              <h2>NIFTY 50</h2>
              {quote ? (
                <>
                  <strong className="bigPrice">
                    {quote.lp.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </strong>
                  <span className={`marketChange ${changeClass}`}>
                    {quote.ch >= 0 ? "+" : ""}
                    {quote.ch.toFixed(2)} ({quote.chp.toFixed(2)}%)
                  </span>
                </>
              ) : (
                <span className="marketChange">Loading quote…</span>
              )}
            </div>
          </div>

          <button
            className="button secondary compactButton"
            onClick={() => void fetchQuote()}
            disabled={loadingQuote}
          >
            {loadingQuote ? "Refreshing…" : "Refresh quote"}
          </button>
        </div>

        <div className="chartToolbar">
          <div className="timeframes">
            {RESOLUTIONS.map((item) => (
              <button
                key={item.value}
                className={
                  resolution === item.value
                    ? "timeframe active"
                    : "timeframe"
                }
                onClick={() => {
                  setResolution(item.value);
                  void fetchHistory(item.value);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="chartStatus">
            {loadingChart
              ? "Loading candles…"
              : `${candles.length.toLocaleString()} candles`}
          </span>
        </div>

        <MarketChart candles={candles} />

        {quote ? (
          <div className="ohlcStrip">
            <span>
              O <strong>{quote.open.toLocaleString("en-IN")}</strong>
            </span>
            <span>
              H <strong>{quote.high.toLocaleString("en-IN")}</strong>
            </span>
            <span>
              L <strong>{quote.low.toLocaleString("en-IN")}</strong>
            </span>
            <span>
              PC <strong>{quote.previousClose.toLocaleString("en-IN")}</strong>
            </span>
            <span className="feedNote">
              {streamMessage}. Historical candles come from FYERS History API.
            </span>
          </div>
        ) : null}
      </section>

      {connected && !streamConnected && socketDiagnostic ? (
        <section className="card">
          <p className="label">Safe socket diagnostic</p>
          <div className="quoteGrid">
            <div>
              <span>SDK loaded</span>
              <strong>{socketDiagnostic.sdkLoaded ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>Data Socket found</span>
              <strong>{socketDiagnostic.sdkHasDataSocket ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>getInstance found</span>
              <strong>{socketDiagnostic.sdkHasGetInstance ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>Token is JWT</span>
              <strong>{socketDiagnostic.tokenLooksLikeJwt ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>Token has hsm_key</span>
              <strong>{socketDiagnostic.tokenHasHsmKey ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>SDK error</span>
              <strong>{String(socketDiagnostic.sdkError || "None")}</strong>
            </div>
          </div>
        </section>
      ) : null}

      <section className="card roadmap">
        <p className="label">Analysis engine coming onto this chart</p>
        <p>
          Auto swing detection → Fib / Trend Fib → BOS/CHoCH → Order Blocks/FVG
          → liquidity → futures VWAP/volume profile → OI/ΔOI → reversal score,
          invalidation, SL and targets.
        </p>
      </section>
    </main>
  );
}
