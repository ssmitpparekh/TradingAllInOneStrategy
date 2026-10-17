"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type Instrument = {
  symbol: string;
  name: string;
  market: string;
  segment: string;
  type: string;
  underlying: string;
  expiry: string | null;
  strike: number | null;
  optionType: string | null;
};

type Resolution =
  | "1" | "2" | "3" | "5" | "10" | "15" | "20" | "30" | "45"
  | "60" | "120" | "180" | "240" | "1D" | "1W" | "1M";

type RangeKey = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX";

const DEFAULT_INSTRUMENT: Instrument = {
  symbol: "NSE:NIFTY50-INDEX",
  name: "NIFTY 50",
  market: "NSE",
  segment: "INDEX",
  type: "INDEX",
  underlying: "NIFTY50",
  expiry: null,
  strike: null,
  optionType: null
};

const RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  { value: "1", label: "1m" },
  { value: "2", label: "2m" },
  { value: "3", label: "3m" },
  { value: "5", label: "5m" },
  { value: "10", label: "10m" },
  { value: "15", label: "15m" },
  { value: "20", label: "20m" },
  { value: "30", label: "30m" },
  { value: "45", label: "45m" },
  { value: "60", label: "1H" },
  { value: "120", label: "2H" },
  { value: "180", label: "3H" },
  { value: "240", label: "4H" },
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" }
];

const RANGES: RangeKey[] = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "MAX"];
const MARKET_FILTERS = ["ALL", "NSE", "BSE", "MCX"];
const TYPE_FILTERS = ["ALL", "INDEX", "EQUITY", "ETF", "SGB", "MF", "FUTURE", "OPTION", "COMMODITY", "CURRENCY"];

function formatDate(timestamp: number | null) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(timestamp * 1000));
}

export default function Home() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Instrument>(DEFAULT_INSTRUMENT);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [resolution, setResolution] = useState<Resolution>("15");
  const [range, setRange] = useState<RangeKey>("1M");
  const [message, setMessage] = useState("Checking FYERS connection…");
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamMessage, setStreamMessage] = useState("Stream waiting…");
  const [socketDiagnostic, setSocketDiagnostic] = useState<Record<string, unknown> | null>(null);
  const [historyMeta, setHistoryMeta] = useState<{ from: number | null; to: number | null; note: string | null }>({
    from: null,
    to: null,
    note: null
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [searchResults, setSearchResults] = useState<Instrument[]>([]);
  const [searching, setSearching] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestId = useRef(0);

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

  async function fetchQuote(silent = false, symbol = selected.symbol) {
    if (!silent) setLoadingQuote(true);

    try {
      const response = await fetch(
        `/api/fyers/quote?symbol=${encodeURIComponent(symbol)}`,
        { cache: "no-store" }
      );
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Quote request failed.");
      }

      setQuote(data.quote);
      setConnected(true);
      if (!silent) setMessage("FYERS quote received successfully.");
    } catch (error) {
      if (!silent) {
        setMessage(error instanceof Error ? error.message : "Unable to fetch the quote.");
      }
    } finally {
      if (!silent) setLoadingQuote(false);
    }
  }

  async function fetchHistory(
    nextResolution = resolution,
    nextRange = range,
    symbol = selected.symbol,
    signal?: AbortSignal
  ) {
    const requestId = ++historyRequestId.current;
    setLoadingChart(true);
    setHistoryError(null);
    setCandles([]);
    setHistoryMeta({ from: null, to: null, note: null });

    try {
      const response = await fetch(
        `/api/fyers/history?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(nextResolution)}&range=${encodeURIComponent(nextRange)}`,
        { cache: "no-store", signal }
      );
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Historical candle request failed.");
      }

      if (requestId !== historyRequestId.current || signal?.aborted) return;

      setCandles(data.candles);
      setHistoryMeta({
        from: data.candles?.[0]?.time ?? data.from ?? null,
        to: data.candles?.[data.candles.length - 1]?.time ?? data.to ?? null,
        note: data.appliedLimit ?? null
      });
    } catch (error) {
      if (signal?.aborted) return;
      const detail =
        error instanceof Error ? error.message : "Unable to load candles.";
      if (requestId === historyRequestId.current) {
        setHistoryError(detail);
        setMessage(detail);
      }
    } finally {
      if (requestId === historyRequestId.current && !signal?.aborted) {
        setLoadingChart(false);
      }
    }
  }

  async function selectInstrument(instrument: Instrument) {
    setSelected(instrument);
    setSearchQuery("");
    setSearchResults([]);
    setQuote(null);
    setCandles([]);
    setHistoryMeta({ from: null, to: null, note: null });
  }

  async function toggleFullscreen() {
    const terminal = document.getElementById("market-terminal");
    if (!terminal) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await terminal.requestFullscreen();
      }
    } catch {
      setMessage("Your browser blocked fullscreen mode.");
    }
  }

  useEffect(() => {
    void refreshStatus();

    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!connected) return;

    const controller = new AbortController();

    void fetchQuote(true, selected.symbol);
    void fetchHistory(
      resolution,
      range,
      selected.symbol,
      controller.signal
    );

    return () => controller.abort();
  }, [connected, selected.symbol, resolution, range]);

  useEffect(() => {
    if (!connected) return;

    void fetch("/api/fyers/socket-diagnostic", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setSocketDiagnostic(data))
      .catch(() => setSocketDiagnostic({ ok: false, problem: "Diagnostic request failed." }));

    const source = new EventSource(
      `/api/fyers/stream?symbol=${encodeURIComponent(selected.symbol)}`
    );

    const onStatus = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data);
        setStreamConnected(Boolean(payload.connected));
        setStreamMessage(
          payload.connected
            ? `Live: ${selected.symbol}`
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
        if (tick.symbol && tick.symbol !== selected.symbol) return;

        if (typeof tick.ltp === "number") {
          setQuote((current) =>
            current
              ? {
                  ...current,
                  lp: tick.ltp,
                  ch: typeof tick.ch === "number" ? tick.ch : current.ch,
                  chp: typeof tick.chp === "number" ? tick.chp : current.chp,
                  open: typeof tick.open_price === "number" ? tick.open_price : current.open,
                  high: typeof tick.high_price === "number" ? tick.high_price : current.high,
                  low: typeof tick.low_price === "number" ? tick.low_price : current.low,
                  previousClose:
                    typeof tick.prev_close_price === "number"
                      ? tick.prev_close_price
                      : current.previousClose,
                  volume:
                    typeof tick.vol_traded_today === "number"
                      ? tick.vol_traded_today
                      : current.volume,
                  bid: typeof tick.bid === "number" ? tick.bid : current.bid,
                  ask: typeof tick.ask === "number" ? tick.ask : current.ask
                }
              : current
          );
        }
      } catch {
        // Keep last good quote.
      }
    };

    source.addEventListener("status", onStatus as EventListener);
    source.addEventListener("tick", onTick as EventListener);

    source.onerror = () => {
      setStreamConnected(false);
      setStreamMessage("Live stream reconnecting…");
    };

    return () => {
      source.close();
      setStreamConnected(false);
    };
  }, [connected, selected.symbol]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(() => {
      void fetch(
        `/api/fyers/instruments?q=${encodeURIComponent(query)}&market=${encodeURIComponent(marketFilter)}&type=${encodeURIComponent(typeFilter)}`,
        { cache: "no-store" }
      )
        .then((response) => response.json())
        .then((data) => {
          setSearchResults(data.ok ? data.instruments : []);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchQuery, marketFilter, typeFilter]);

  const changeClass = useMemo(() => {
    if (!quote) return "";
    return quote.ch >= 0 ? "positive" : "negative";
  }, [quote]);

  return (
    <main className="shell wide">
      <section className="hero compactHero">
        <p className="eyebrow">ALL MARKETS · ONE VIEW</p>
        <div className="heroRow">
          <div>
            <h1>ALLINONEVIEW</h1>
            <p className="lead">
              Read-only analysis across supported NSE, BSE and MCX instruments.
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

      <section className="instrumentPanel">
        <div className="instrumentSearchRow">
          <div className="searchBox">
            <span className="searchIcon">⌕</span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search NIFTY, Reliance, Gold, Crude, expiry, strike…"
              autoComplete="off"
            />
            {searching ? <span className="searching">Searching…</span> : null}
          </div>
          <div className="filterRow">
            {MARKET_FILTERS.map((item) => (
              <button
                key={item}
                className={marketFilter === item ? "filterChip active" : "filterChip"}
                onClick={() => setMarketFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="filterRow typeFilters">
          {TYPE_FILTERS.map((item) => (
            <button
              key={item}
              className={typeFilter === item ? "filterChip active" : "filterChip"}
              onClick={() => setTypeFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>

        {searchQuery.trim() ? (
          <div className="searchResults">
            {searchResults.length ? (
              searchResults.map((instrument) => (
                <button
                  key={instrument.symbol}
                  className="instrumentResult"
                  onClick={() => void selectInstrument(instrument)}
                >
                  <div>
                    <strong>{instrument.name}</strong>
                    <span>{instrument.symbol}</span>
                  </div>
                  <div className="instrumentBadges">
                    <span>{instrument.market}</span>
                    <span>{instrument.type}</span>
                    {instrument.expiry ? <span>{instrument.expiry}</span> : null}
                    {instrument.strike && instrument.optionType ? (
                      <span>{instrument.strike} {instrument.optionType}</span>
                    ) : null}
                  </div>
                </button>
              ))
            ) : !searching ? (
              <p className="emptySearch">No matching current FYERS instruments found.</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="terminalCard" id="market-terminal">
        <div className="marketHeader">
          <div>
            <p className="label">
              {selected.market} · {selected.type}
              {selected.expiry ? ` · EXP ${selected.expiry}` : ""}
            </p>
            <div className="priceRow">
              <h2>{selected.name}</h2>
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
            <p className="symbolLine">{selected.symbol}</p>
          </div>

          <div className="headerActions">
            <button
              className="button secondary compactButton"
              onClick={() => setFitNonce((value) => value + 1)}
            >
              Fit
            </button>
            <button
              className="button secondary compactButton"
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
            <button
              className="button secondary compactButton"
              onClick={() => void fetchQuote()}
              disabled={loadingQuote}
            >
              {loadingQuote ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="chartToolbar stackedToolbar">
          <div className="toolbarGroup">
            <span className="toolbarLabel">TIMEFRAME</span>
            <div className="timeframes scrollable">
              {RESOLUTIONS.map((item) => (
                <button
                  key={item.value}
                  className={resolution === item.value ? "timeframe active" : "timeframe"}
                  onClick={() => setResolution(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="toolbarGroup rangeGroup">
            <span className="toolbarLabel">RANGE</span>
            <div className="timeframes">
              {RANGES.map((item) => (
                <button
                  key={item}
                  className={range === item ? "timeframe active" : "timeframe"}
                  onClick={() => setRange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="historyStatus">
            <span>
              {loadingChart
                ? `Loading ${RESOLUTIONS.find((item) => item.value === resolution)?.label ?? resolution}…`
                : `${candles.length.toLocaleString()} candles · ${RESOLUTIONS.find((item) => item.value === resolution)?.label ?? resolution}`}
            </span>
            <span>{formatDate(historyMeta.from)} → {formatDate(historyMeta.to)}</span>
          </div>
        </div>

        {historyError ? (
          <div className="historyError">
            Candle request failed for {resolution}: {historyError}
          </div>
        ) : null}
        {historyMeta.note ? <div className="historyNotice">{historyMeta.note}</div> : null}

        <MarketChart candles={candles} fitNonce={fitNonce} />

        {quote ? (
          <div className="ohlcStrip">
            <span>O <strong>{quote.open.toLocaleString("en-IN")}</strong></span>
            <span>H <strong>{quote.high.toLocaleString("en-IN")}</strong></span>
            <span>L <strong>{quote.low.toLocaleString("en-IN")}</strong></span>
            <span>PC <strong>{quote.previousClose.toLocaleString("en-IN")}</strong></span>
            {quote.volume ? <span>VOL <strong>{quote.volume.toLocaleString("en-IN")}</strong></span> : null}
            <span className="feedNote">{streamMessage}</span>
          </div>
        ) : null}
      </section>

      {connected && !streamConnected && socketDiagnostic ? (
        <section className="card">
          <p className="label">Safe socket diagnostic</p>
          <div className="quoteGrid">
            <div><span>SDK loaded</span><strong>{socketDiagnostic.sdkLoaded ? "Yes" : "No"}</strong></div>
            <div><span>Data Socket found</span><strong>{socketDiagnostic.sdkHasDataSocket ? "Yes" : "No"}</strong></div>
            <div><span>getInstance found</span><strong>{socketDiagnostic.sdkHasGetInstance ? "Yes" : "No"}</strong></div>
            <div><span>Token is JWT</span><strong>{socketDiagnostic.tokenLooksLikeJwt ? "Yes" : "No"}</strong></div>
            <div><span>Token has hsm_key</span><strong>{socketDiagnostic.tokenHasHsmKey ? "Yes" : "No"}</strong></div>
            <div><span>SDK error</span><strong>{String(socketDiagnostic.sdkError || "None")}</strong></div>
          </div>
        </section>
      ) : null}

      <section className="card roadmap">
        <p className="label">Next layer</p>
        <p>
          Auto swing detection → Fib / Trend Fib → BOS/CHoCH → Order Blocks/FVG
          → liquidity → futures VWAP/volume profile → OI/ΔOI → reversal score,
          invalidation, SL and targets.
        </p>
      </section>
    </main>
  );
}
