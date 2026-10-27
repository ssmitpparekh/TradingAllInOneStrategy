"use client";

import { useEffect, useMemo, useState } from "react";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";

type PulseStock = {
  symbol: string;
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
};

type PulseIndex = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
};

type PulseSector = {
  sector: string;
  averageChangePercent: number;
  advancing: number;
  declining: number;
  unchanged: number;
  breadthPercent: number;
  members: PulseStock[];
};

type PulseResponse = {
  ok: boolean;
  generatedAt: number;
  breadth: {
    advancing: number;
    declining: number;
    unchanged: number;
    total: number;
    advanceDeclineRatio: number;
    averageChangePercent: number;
  };
  indexes: PulseIndex[];
  topGainers: PulseStock[];
  topLosers: PulseStock[];
  sectors: PulseSector[];
  stocks: PulseStock[];
  error?: string;
};

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function MarketPulseClient() {
  const [data, setData] = useState<PulseResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/analytics/india-pulse", {
          cache: "no-store"
        });
        const body = (await response.json()) as PulseResponse;
        if (!response.ok || !body.ok) {
          throw new Error(body.error || "Unable to load market pulse.");
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
              : "Unable to load market pulse."
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

  const strongestSectors = useMemo(
    () =>
      (data?.sectors ?? [])
        .slice()
        .sort(
          (a, b) =>
            b.averageChangePercent - a.averageChangePercent
        )
        .slice(0, 6),
    [data]
  );

  return (
    <main className="analyticsPage">
      <AnalyticsHeader
        title="Market Pulse"
        description="Live India breadth, index direction, gainers, losers and sector participation from FYERS market data."
        badge="FYERS LIVE"
      />

      {error ? <div className="analyticsError">{error}</div> : null}

      {!data ? (
        <section className="analyticsLoading">Loading live market pulse…</section>
      ) : (
        <>
          <section className="analyticsMetricGrid">
            <article className="analyticsMetricCard">
              <span>ADVANCING</span>
              <strong className="positive">{data.breadth.advancing}</strong>
              <small>of {data.breadth.total} core stocks</small>
            </article>
            <article className="analyticsMetricCard">
              <span>DECLINING</span>
              <strong className="negative">{data.breadth.declining}</strong>
              <small>{data.breadth.unchanged} unchanged</small>
            </article>
            <article className="analyticsMetricCard">
              <span>A/D RATIO</span>
              <strong>{data.breadth.advanceDeclineRatio.toFixed(2)}</strong>
              <small>advancers ÷ decliners</small>
            </article>
            <article className="analyticsMetricCard">
              <span>AVERAGE MOVE</span>
              <strong
                className={
                  data.breadth.averageChangePercent >= 0
                    ? "positive"
                    : "negative"
                }
              >
                {pct(data.breadth.averageChangePercent)}
              </strong>
              <small>equal-weight core basket</small>
            </article>
          </section>

          <section className="card analyticsBreadthCard">
            <div className="analyticsSectionHeader">
              <div>
                <p className="label">MARKET BREADTH</p>
                <h2>Gainers vs losers</h2>
              </div>
              <span>
                Updated{" "}
                {new Date(data.generatedAt * 1000).toLocaleTimeString()}
              </span>
            </div>
            <div className="breadthTrack">
              <div
                className="breadthUp"
                style={{
                  width: `${
                    data.breadth.total
                      ? (data.breadth.advancing / data.breadth.total) * 100
                      : 0
                  }%`
                }}
              />
              <div
                className="breadthFlat"
                style={{
                  width: `${
                    data.breadth.total
                      ? (data.breadth.unchanged / data.breadth.total) * 100
                      : 0
                  }%`
                }}
              />
              <div
                className="breadthDown"
                style={{
                  width: `${
                    data.breadth.total
                      ? (data.breadth.declining / data.breadth.total) * 100
                      : 0
                  }%`
                }}
              />
            </div>
          </section>

          <section className="analyticsIndexStrip">
            {data.indexes.map((index) => (
              <article className="analyticsIndexCard" key={index.symbol}>
                <span>{index.name}</span>
                <strong>{index.price.toLocaleString("en-IN")}</strong>
                <small
                  className={
                    index.changePercent >= 0 ? "positive" : "negative"
                  }
                >
                  {index.change >= 0 ? "+" : ""}
                  {index.change.toFixed(2)} · {pct(index.changePercent)}
                </small>
              </article>
            ))}
          </section>

          <section className="analyticsTwoColumn">
            <article className="card analyticsTableCard">
              <div className="analyticsSectionHeader">
                <div>
                  <p className="label">LEADERS</p>
                  <h2>Top gainers</h2>
                </div>
              </div>
              <div className="analyticsRows">
                {data.topGainers.map((stock, index) => (
                  <div className="analyticsRow" key={stock.symbol}>
                    <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{stock.ticker}</strong>
                      <small>{stock.sector}</small>
                    </div>
                    <span>{stock.price.toLocaleString("en-IN")}</span>
                    <strong className="positive">{pct(stock.changePercent)}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="card analyticsTableCard">
              <div className="analyticsSectionHeader">
                <div>
                  <p className="label">LAGGARDS</p>
                  <h2>Top losers</h2>
                </div>
              </div>
              <div className="analyticsRows">
                {data.topLosers.map((stock, index) => (
                  <div className="analyticsRow" key={stock.symbol}>
                    <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{stock.ticker}</strong>
                      <small>{stock.sector}</small>
                    </div>
                    <span>{stock.price.toLocaleString("en-IN")}</span>
                    <strong className="negative">{pct(stock.changePercent)}</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="card analyticsTableCard">
            <div className="analyticsSectionHeader">
              <div>
                <p className="label">SECTOR PARTICIPATION</p>
                <h2>Strongest sectors</h2>
              </div>
            </div>
            <div className="sectorScoreGrid">
              {strongestSectors.map((sector) => (
                <article key={sector.sector}>
                  <span>{sector.sector}</span>
                  <strong
                    className={
                      sector.averageChangePercent >= 0
                        ? "positive"
                        : "negative"
                    }
                  >
                    {pct(sector.averageChangePercent)}
                  </strong>
                  <small>
                    {sector.advancing} up · {sector.declining} down
                  </small>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
