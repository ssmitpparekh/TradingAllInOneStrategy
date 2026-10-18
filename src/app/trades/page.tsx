"use client";

import { useEffect, useMemo, useState } from "react";
import {
  summarizeTrades,
  type JournalTrade
} from "@/lib/analysis/trade-journal";

const TRADE_JOURNAL_KEY = "allinoneview:trade-journal:v1";
const THEME_KEY = "allinoneview:theme:v1";

type MarketFilter = "ALL" | "NSE" | "BSE" | "KRAKEN";
type RangeFilter = "TODAY" | "YESTERDAY" | "7D" | "30D" | "ALL";

const MARKET_FILTERS: MarketFilter[] = ["ALL", "NSE", "BSE", "KRAKEN"];
const RANGE_FILTERS: Array<{ value: RangeFilter; label: string }> = [
  { value: "TODAY", label: "TODAY" },
  { value: "YESTERDAY", label: "YESTERDAY" },
  { value: "7D", label: "LAST 7 DAYS" },
  { value: "30D", label: "LAST 30 DAYS" },
  { value: "ALL", label: "ALL TIME" }
];

function inRange(trade: JournalTrade, range: RangeFilter) {
  if (range === "ALL") return true;

  const now = new Date();
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime() / 1000;
  const time = trade.signalTime;

  if (range === "TODAY") {
    return time >= startToday;
  }

  if (range === "YESTERDAY") {
    return time >= startToday - 86400 && time < startToday;
  }

  const seconds = range === "7D" ? 7 * 86400 : 30 * 86400;
  return time >= Date.now() / 1000 - seconds;
}

function formatSignalTime(trade: JournalTrade) {
  return new Date(trade.signalTime * 1000).toLocaleString("en-IN", {
    timeZone: trade.market === "KRAKEN" ? "UTC" : "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function TradesPage() {
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [market, setMarket] = useState<MarketFilter>("ALL");
  const [range, setRange] = useState<RangeFilter>("ALL");
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_KEY);
      const theme =
        savedTheme === "light" || savedTheme === "dark"
          ? savedTheme
          : window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
      document.documentElement.dataset.theme = theme;
    } catch {
      // Keep the current document theme.
    }

    const load = () => {
      try {
        const raw = window.localStorage.getItem(TRADE_JOURNAL_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setTrades(Array.isArray(parsed) ? parsed : []);
      } catch {
        setTrades([]);
      }
    };

    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return trades
      .filter((trade) => market === "ALL" || trade.market === market)
      .filter((trade) => inRange(trade, range))
      .filter((trade) => {
        if (!normalizedQuery) return true;
        return (
          trade.symbol.toLowerCase().includes(normalizedQuery) ||
          trade.name.toLowerCase().includes(normalizedQuery)
        );
      })
      .slice()
      .sort((a, b) => b.signalTime - a.signalTime);
  }, [trades, market, range, query]);

  const stats = useMemo(() => summarizeTrades(filtered), [filtered]);

  return (
    <main className="tradeHistoryPage">
      <section className="card tradeHistoryHero">
        <div>
          <p className="label">ALLINONEVIEW · PLATFORM JOURNAL</p>
          <h1>Trade History</h1>
          <p>
            Every confirmed READY signal recorded by this AllInOneView journal,
            newest first.
          </p>
        </div>
        <a className="tradeHistoryLink" href="/">
          ← BACK TO CHART
        </a>
      </section>

      <section className="card tradeHistoryControlsCard">
        <div className="tradeHistoryFilterBlock">
          <span>MARKET</span>
          <div className="tradeHistoryFilterRow">
            {MARKET_FILTERS.map((item) => (
              <button
                className={
                  market === item
                    ? "tradeHistoryFilter active"
                    : "tradeHistoryFilter"
                }
                key={item}
                onClick={() => setMarket(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="tradeHistoryFilterBlock">
          <span>DATE RANGE</span>
          <div className="tradeHistoryFilterRow">
            {RANGE_FILTERS.map((item) => (
              <button
                className={
                  range === item.value
                    ? "tradeHistoryFilter active"
                    : "tradeHistoryFilter"
                }
                key={item.value}
                onClick={() => setRange(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <label className="tradeHistorySearch">
          <span>SYMBOL</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search symbol or name…"
          />
        </label>
      </section>

      <section className="tradeHistorySummaryGrid">
        <div className="card tradeHistorySummaryCard">
          <span>VISIBLE TRADES</span>
          <strong>{filtered.length.toLocaleString("en-IN")}</strong>
        </div>
        <div className="card tradeHistorySummaryCard">
          <span>WIN RATE</span>
          <strong>{stats.winRate.toFixed(1)}%</strong>
        </div>
        <div className="card tradeHistorySummaryCard">
          <span>TOTAL RESULT</span>
          <strong>{stats.totalR >= 0 ? "+" : ""}{stats.totalR.toFixed(2)}R</strong>
        </div>
        <div className="card tradeHistorySummaryCard">
          <span>OPEN / CLOSED</span>
          <strong>{stats.open} / {stats.closed}</strong>
        </div>
      </section>

      <section className="card tradeHistoryFullCard">
        <div className="tradeHistoryFullHeader">
          <div>
            <p className="label">FILTERED TRADE RECORD</p>
            <h2>{filtered.length} trade{filtered.length === 1 ? "" : "s"}</h2>
          </div>
          <small>
            Times display in IST for NSE/BSE and UTC for Kraken.
          </small>
        </div>

        <div className="tradeHistoryTableWrap">
          <table className="tradeHistoryTable">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Market</th>
                <th>Symbol</th>
                <th>Setup</th>
                <th>Move</th>
                <th>Side</th>
                <th>TF</th>
                <th>Entry</th>
                <th>SL / Live Stop</th>
                <th>Outcome</th>
                <th>P/L</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map((trade) => (
                  <tr key={trade.id}>
                    <td>{formatSignalTime(trade)}</td>
                    <td>{trade.market}</td>
                    <td title={trade.name}>{trade.symbol}</td>
                    <td>{trade.setupType ?? "PRIMARY"}</td>
                    <td>{trade.moveClass ?? "TACTICAL"}</td>
                    <td className={trade.direction}>
                      {trade.direction.toUpperCase()}
                    </td>
                    <td>{trade.confirmationTimeframe}</td>
                    <td>
                      {trade.entry.toLocaleString("en-IN", {
                        maximumFractionDigits: 2
                      })}
                    </td>
                    <td>
                      {trade.currentStop.toLocaleString("en-IN", {
                        maximumFractionDigits: 2
                      })}
                    </td>
                    <td title={trade.ambiguityReason ?? undefined}>
                      {trade.outcome}
                    </td>
                    <td
                      className={
                        (trade.resultR ?? 0) > 0
                          ? "positive"
                          : (trade.resultR ?? 0) < 0
                            ? "negative"
                            : ""
                      }
                    >
                      {trade.resultR === null
                        ? "OPEN"
                        : (trade.resultR > 0 ? "+" : "") +
                          trade.resultR.toFixed(2) +
                          "R"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11}>
                    No journaled platform trades match these filters yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
