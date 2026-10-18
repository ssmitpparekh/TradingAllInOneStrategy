"use client";

import { useEffect, useMemo, useState } from "react";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";

type Stock = {
  symbol: string;
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
};

type IndexQuote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
};

type Pulse = {
  ok: boolean;
  indexes: IndexQuote[];
  stocks: Stock[];
  error?: string;
};

const VIEWS = [
  {
    key: "NIFTY50",
    label: "NIFTY 50",
    indexSymbol: "NSE:NIFTY50-INDEX",
    sectors: null as string[] | null
  },
  {
    key: "BANK",
    label: "BANKING",
    indexSymbol: "NSE:NIFTYBANK-INDEX",
    sectors: ["BANK"]
  },
  {
    key: "FIN",
    label: "FINNIFTY",
    indexSymbol: "NSE:FINNIFTY-INDEX",
    sectors: ["BANK", "FINANCIAL"]
  },
  {
    key: "IT",
    label: "NIFTY IT",
    indexSymbol: "NSE:NIFTYIT-INDEX",
    sectors: ["IT"]
  },
  {
    key: "MIDCAP",
    label: "MIDCAP",
    indexSymbol: "NSE:NIFTYMIDCAP50-INDEX",
    sectors: null as string[] | null
  },
  {
    key: "SENSEX",
    label: "SENSEX",
    indexSymbol: "BSE:SENSEX-INDEX",
    sectors: null as string[] | null
  }
];

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function IndexMoverClient() {
  const [data, setData] = useState<Pulse | null>(null);
  const [view, setView] = useState("NIFTY50");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/analytics/india-pulse", {
          cache: "no-store"
        });
        const body = (await response.json()) as Pulse;
        if (!response.ok || !body.ok) {
          throw new Error(body.error || "Unable to load index movers.");
        }
        if (!cancelled) {
          setData(body);
          setError("");
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to load index movers."
          );
        }
      }
    };

    void load();
    const timer = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const selectedView =
    VIEWS.find((item) => item.key === view) ?? VIEWS[0];

  const selectedIndex = data?.indexes.find(
    (item) => item.symbol === selectedView.indexSymbol
  );

  const members = useMemo(() => {
    const all = data?.stocks ?? [];
    const filtered = selectedView.sectors
      ? all.filter((stock) =>
          selectedView.sectors!.includes(stock.sector)
        )
      : all;

    return filtered
      .slice()
      .sort(
        (a, b) =>
          Math.abs(b.changePercent) - Math.abs(a.changePercent)
      );
  }, [data, selectedView]);

  const advancing = members.filter(
    (item) => item.changePercent > 0
  ).length;
  const declining = members.filter(
    (item) => item.changePercent < 0
  ).length;
  const total = members.length || 1;
  const upShare = (advancing / total) * 100;

  return (
    <main className="analyticsPage">
      <AnalyticsHeader
        title="Index Mover"
        description="Live index direction plus the strongest and weakest movers in the relevant core basket."
        badge="FYERS LIVE"
      />

      {error ? <div className="analyticsError">{error}</div> : null}

      {!data ? (
        <section className="analyticsLoading">Loading index movers…</section>
      ) : (
        <>
          <div className="analyticsTabs">
            {VIEWS.map((item) => (
              <button
                type="button"
                className={view === item.key ? "active" : ""}
                key={item.key}
                onClick={() => setView(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <section className="indexMoverHeroGrid">
            <article className="card indexMoverQuote">
              <p className="label">{selectedView.label}</p>
              <strong>
                {selectedIndex
                  ? selectedIndex.price.toLocaleString("en-IN")
                  : "—"}
              </strong>
              <span
                className={
                  (selectedIndex?.changePercent ?? 0) >= 0
                    ? "positive"
                    : "negative"
                }
              >
                {selectedIndex
                  ? `${selectedIndex.change >= 0 ? "+" : ""}${selectedIndex.change.toFixed(2)} · ${pct(selectedIndex.changePercent)}`
                  : "Index quote not available"}
              </span>
            </article>

            <article className="card indexMoverBreadth">
              <div>
                <p className="label">CORE BASKET BREADTH</p>
                <h2>
                  <span className="positive">{advancing} up</span>
                  {" · "}
                  <span className="negative">{declining} down</span>
                </h2>
              </div>
              <div className="breadthTrack">
                <div
                  className="breadthUp"
                  style={{ width: `${upShare}%` }}
                />
                <div
                  className="breadthDown"
                  style={{ width: `${100 - upShare}%` }}
                />
              </div>
            </article>
          </section>

          <section className="analyticsTwoColumn indexMoverMain">
            <article className="card indexMoverDonutCard">
              <div className="analyticsSectionHeader">
                <div>
                  <p className="label">PARTICIPATION</p>
                  <h2>{selectedView.label}</h2>
                </div>
              </div>
              <div
                className="indexBreadthDonut"
                style={{
                  background: `conic-gradient(#35b977 0 ${upShare}%, #e05a64 ${upShare}% 100%)`
                }}
              >
                <div>
                  <strong>{advancing}</strong>
                  <span>UP</span>
                  <small>{declining} down</small>
                </div>
              </div>
              <p className="analyticsMethodNote">
                Donut shows breadth count, not index point contribution.
              </p>
            </article>

            <article className="card analyticsTableCard">
              <div className="analyticsSectionHeader">
                <div>
                  <p className="label">MOVERS</p>
                  <h2>Largest absolute moves</h2>
                </div>
              </div>
              <div className="analyticsRows">
                {members.slice(0, 14).map((stock, index) => (
                  <div className="analyticsRow" key={stock.symbol}>
                    <span className="rank">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <strong>{stock.ticker}</strong>
                      <small>{stock.sector}</small>
                    </div>
                    <span>{stock.price.toLocaleString("en-IN")}</span>
                    <strong
                      className={
                        stock.changePercent >= 0
                          ? "positive"
                          : "negative"
                      }
                    >
                      {pct(stock.changePercent)}
                    </strong>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <p className="analyticsMethodNote">
            Exact official point contribution requires current licensed index
            constituent weights. Until those are connected, this page shows
            genuine live price movement and breadth without fabricating point
            contribution.
          </p>
        </>
      )}
    </main>
  );
}
