"use client";

import { useEffect, useMemo, useState } from "react";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";

type Stock = {
  symbol: string;
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
};

type Sector = {
  sector: string;
  averageChangePercent: number;
  advancing: number;
  declining: number;
  unchanged: number;
  breadthPercent: number;
  members: Stock[];
};

type Response = {
  ok: boolean;
  sectors: Sector[];
  error?: string;
};

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function heatStyle(value: number) {
  const intensity = Math.min(0.34, 0.08 + Math.abs(value) * 0.045);
  return value >= 0
    ? { background: `rgba(38, 185, 113, ${intensity})` }
    : { background: `rgba(224, 73, 87, ${intensity})` };
}

export default function SectorScopeClient() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/analytics/india-pulse", {
          cache: "no-store"
        });
        const body = (await response.json()) as Response;
        if (!response.ok || !body.ok) {
          throw new Error(body.error || "Unable to load sector data.");
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
              : "Unable to load sector data."
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

  const sectors = useMemo(
    () =>
      (data?.sectors ?? []).slice().sort(
        (a, b) =>
          b.averageChangePercent - a.averageChangePercent
      ),
    [data]
  );

  return (
    <main className="analyticsPage">
      <AnalyticsHeader
        title="Sector Scope"
        description="Live equal-weight sector breadth across the core India universe. Color shows daily move; counts show participation."
        badge="FYERS LIVE"
      />

      {error ? <div className="analyticsError">{error}</div> : null}

      {!data ? (
        <section className="analyticsLoading">Loading sector breadth…</section>
      ) : (
        <>
          <section className="sectorLeaderboard">
            {sectors.map((sector, index) => (
              <article
                className="sectorLeaderCard"
                key={sector.sector}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{sector.sector}</strong>
                  <small>
                    {sector.advancing} up · {sector.declining} down
                  </small>
                </div>
                <strong
                  className={
                    sector.averageChangePercent >= 0
                      ? "positive"
                      : "negative"
                  }
                >
                  {pct(sector.averageChangePercent)}
                </strong>
              </article>
            ))}
          </section>

          <section className="sectorScopeGrid">
            {sectors.map((sector) => {
              const total =
                sector.advancing +
                sector.declining +
                sector.unchanged;
              const upWidth = total
                ? (sector.advancing / total) * 100
                : 0;
              const downWidth = total
                ? (sector.declining / total) * 100
                : 0;

              return (
                <article className="card sectorScopeCard" key={sector.sector}>
                  <div className="sectorScopeHeader">
                    <div>
                      <p className="label">{sector.sector}</p>
                      <h2
                        className={
                          sector.averageChangePercent >= 0
                            ? "positive"
                            : "negative"
                        }
                      >
                        {pct(sector.averageChangePercent)}
                      </h2>
                    </div>
                    <span>{total} stocks</span>
                  </div>

                  <div className="sectorBreadthTrack">
                    <div
                      className="positiveFill"
                      style={{ width: `${upWidth}%` }}
                    />
                    <div
                      className="negativeFill"
                      style={{ width: `${downWidth}%` }}
                    />
                  </div>

                  <div className="sectorTileGrid">
                    {sector.members.map((stock) => (
                      <div
                        className="sectorTile"
                        key={stock.symbol}
                        style={heatStyle(stock.changePercent)}
                        title={stock.name}
                      >
                        <strong>{stock.ticker}</strong>
                        <span>{pct(stock.changePercent)}</span>
                        <small>{stock.price.toLocaleString("en-IN")}</small>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </section>

          <p className="analyticsMethodNote">
            Sector averages are equal-weight across the core stock universe.
            This is not presented as official NSE sector-index weighting.
          </p>
        </>
      )}
    </main>
  );
}
