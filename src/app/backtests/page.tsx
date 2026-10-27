"use client";

import { useEffect, useMemo, useState } from "react";

type Instrument = {
  key: string;
  label: string;
  note: string;
};

type Stats = {
  total: number;
  open: number;
  closed: number;
  wins: number;
  losses: number;
  breakeven: number;
  ambiguous: number;
  longTrades: number;
  shortTrades: number;
  winRate: number;
  totalR: number;
  averageR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
};

type BacktestTrade = {
  tradeId: string;
  instrumentKey: string;
  symbol: string;
  setupType: string;
  moveClass: string;
  direction: "long" | "short";
  signalTime: number;
  entry: number;
  initialStop: number;
  status: "OPEN" | "CLOSED";
  outcome: string;
  resultR: number | null;
};

type Payload = {
  ok: boolean;
  available: boolean;
  reason?: string;
  instruments: Instrument[];
  run?: {
    strategyVersion: string;
    liveCutoff: string;
    fullStrategy: boolean;
    dataProfile: string;
    coverage: Record<string, unknown>;
    notes: string;
    completedAt: string | null;
  };
  stats: Stats;
  grouped: Array<{ key: string; label: string; stats: Stats }>;
  trades: BacktestTrade[];
};

const EMPTY_STATS: Stats = {
  total: 0,
  open: 0,
  closed: 0,
  wins: 0,
  losses: 0,
  breakeven: 0,
  ambiguous: 0,
  longTrades: 0,
  shortTrades: 0,
  winRate: 0,
  totalR: 0,
  averageR: 0,
  profitFactor: 0,
  maxDrawdownR: 0
};

function number(value: number, digits = 2) {
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: digits
  });
}

export default function BacktestsPage() {
  const [instrument, setInstrument] = useState("ALL");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(
      "/api/backtests/results?instrument=" +
        encodeURIComponent(instrument),
      { cache: "no-store" }
    )
      .then(async (response) => {
        const payload = (await response.json()) as Payload & {
          error?: string;
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Unable to load backtests.");
        }
        if (!cancelled) {
          setData(payload);
          setMessage("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to load backtests."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [instrument]);

  const stats = data?.stats ?? EMPTY_STATS;
  const filters = useMemo(
    () => [
      { key: "ALL", label: "All" },
      ...(data?.instruments ?? []).map((item) => ({
        key: item.key,
        label: item.label
      }))
    ],
    [data?.instruments]
  );

  return (
    <main className="backtestPage">
      <section className="card backtestHero">
        <div>
          <p className="label">ALLINONEVIEW · STRATEGY EVIDENCE</p>
          <h1>Strategy Backtests</h1>
          <p>
            Historical results are kept completely separate from live platform
            calls. Only strategy-valid signals are stored; refused, rejected and
            unverifiable candidates never enter this table.
          </p>
        </div>
        <div className="tradeJournalHeroActions">
          <a className="button secondary" href="/trades">
            Live trades
          </a>
          <a className="tradeHistoryLink" href="/">
            ← Back to chart
          </a>
        </div>
      </section>

      <section className="card backtestPolicy">
        <strong>Backtest / live boundary</strong>
        <p>
          {data?.run
            ? "Strategy " +
              data.run.strategyVersion +
              " is backtested only on data before " +
              new Date(data.run.liveCutoff).toLocaleString() +
              "."
            : "The official live timestamp has not been locked and no completed backtest exists yet."}
        </p>
        {data?.run && !data.run.fullStrategy ? (
          <p className="backtestWarning">
            This run is a deterministic technical-core replay. Historical
            live-only veto inputs that could not be reconstructed are not
            silently invented.
          </p>
        ) : null}
      </section>

      <div className="backtestFilters" role="tablist" aria-label="Backtest instrument">
        {filters.map((item) => (
          <button
            key={item.key}
            type="button"
            className={instrument === item.key ? "active" : ""}
            onClick={() => setInstrument(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {message ? <div className="tradeJournalMessage">{message}</div> : null}

      {!loading && data && !data.available ? (
        <section className="card backtestEmpty">
          <h2>Backtest results will appear here after launch is locked.</h2>
          <p>{data.reason}</p>
        </section>
      ) : null}

      {data?.available ? (
        <>
          <section className="backtestStats">
            <div className="card"><span>VALID TRADES</span><strong>{stats.total}</strong></div>
            <div className="card"><span>WIN RATE</span><strong>{number(stats.winRate)}%</strong></div>
            <div className="card"><span>TOTAL R</span><strong>{number(stats.totalR)}R</strong></div>
            <div className="card"><span>AVG R / TRADE</span><strong>{number(stats.averageR)}R</strong></div>
            <div className="card"><span>PROFIT FACTOR</span><strong>{stats.profitFactor === null ? "∞" : number(stats.profitFactor)}</strong></div>
            <div className="card"><span>MAX DRAWDOWN</span><strong>{number(stats.maxDrawdownR)}R</strong></div>
          </section>

          <section className="card backtestBreakdown">
            <h2>Instrument dependence</h2>
            <div className="backtestBreakdownGrid">
              {data.grouped.map((item) => (
                <div key={item.key}>
                  <strong>{item.label}</strong>
                  <span>{item.stats.total} trades</span>
                  <span>{number(item.stats.winRate)}% wins</span>
                  <span>{number(item.stats.totalR)}R total</span>
                  <span>{number(item.stats.maxDrawdownR)}R max DD</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card backtestTableCard">
            <div className="backtestTableHeader">
              <div>
                <p className="label">ACCEPTED HISTORICAL SIGNALS ONLY</p>
                <h2>{instrument === "ALL" ? "All instruments" : instrument}</h2>
              </div>
              <span>{data.trades.length} rows</span>
            </div>

            <div className="backtestTableWrap">
              <table className="backtestTable">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Instrument</th>
                    <th>Setup</th>
                    <th>Side</th>
                    <th>Entry</th>
                    <th>Stop</th>
                    <th>Outcome</th>
                    <th>R</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.trades]
                    .sort((a, b) => b.signalTime - a.signalTime)
                    .map((trade) => (
                      <tr key={trade.tradeId}>
                        <td>{new Date(trade.signalTime * 1000).toLocaleString()}</td>
                        <td>{trade.instrumentKey}</td>
                        <td>{trade.setupType} · {trade.moveClass}</td>
                        <td>{trade.direction.toUpperCase()}</td>
                        <td>{number(trade.entry)}</td>
                        <td>{number(trade.initialStop)}</td>
                        <td>{trade.outcome}</td>
                        <td>{trade.resultR === null ? "—" : number(trade.resultR) + "R"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
