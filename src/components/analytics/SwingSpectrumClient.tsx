"use client";

import { useEffect, useState } from "react";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";

type ScanItem = {
  symbol: string;
  ticker: string;
  name: string;
  sector: string;
  close: number;
  changePercent: number;
  time: number;
  direction: "BULL" | "BEAR";
  reference?: number;
  distancePercent?: number;
  volumeRatio?: number;
  range?: number;
  weeklyChangePercent?: number;
};

type Response = {
  ok: boolean;
  methodology: Record<string, string>;
  coverage: {
    requested: number;
    withDailyHistory: number;
  };
  scans: {
    breakout10: ScanItem[];
    breakout50: ScanItem[];
    reversal: ScanItem[];
    channel: ScanItem[];
    nr7: ScanItem[];
    weekly: ScanItem[];
  };
  error?: string;
};

const GROUPS: Array<{
  key: keyof Response["scans"];
  title: string;
  subtitle: string;
}> = [
  {
    key: "breakout10",
    title: "10 Day Breakout",
    subtitle: "Close beyond prior 10-session range"
  },
  {
    key: "breakout50",
    title: "50 Day Breakout",
    subtitle: "Close beyond prior 50-session range"
  },
  {
    key: "reversal",
    title: "Reversal Radar",
    subtitle: "Directional sequence + prior-day break"
  },
  {
    key: "channel",
    title: "Channel Breakout",
    subtitle: "20-day channel + volume confirmation"
  },
  {
    key: "nr7",
    title: "NR7",
    subtitle: "Narrowest daily range in seven sessions"
  },
  {
    key: "weekly",
    title: "Weekly Watch",
    subtitle: "Five-session move ≥ 2%"
  }
];

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function SwingSpectrumClient() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/analytics/swing-spectrum", {
          cache: "no-store"
        });
        const body = (await response.json()) as Response;
        if (!response.ok || !body.ok) {
          throw new Error(body.error || "Unable to load swing scans.");
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
              : "Unable to load swing scans."
          );
        }
      }
    };

    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="analyticsPage">
      <AnalyticsHeader
        title="Swing Spectrum"
        description="Completed-daily-candle scans for breakouts, contractions, reversals and weekly momentum."
        badge="NEON HISTORY · FYERS"
      />

      {error ? <div className="analyticsError">{error}</div> : null}

      {!data ? (
        <section className="analyticsLoading">Loading swing scans…</section>
      ) : (
        <>
          <section className="analyticsCoverageBar">
            <span>
              Daily history available for{" "}
              <strong>{data.coverage.withDailyHistory}</strong> /{" "}
              {data.coverage.requested} core instruments
            </span>
            <small>
              Run the market backfill if this coverage is incomplete.
            </small>
          </section>

          <section className="swingSpectrumGrid">
            {GROUPS.map((group) => {
              const items = data.scans[group.key];
              return (
                <article className="card swingScanCard" key={group.key}>
                  <div className="analyticsSectionHeader">
                    <div>
                      <p className="label">{group.title}</p>
                      <h2>{items.length} match{items.length === 1 ? "" : "es"}</h2>
                    </div>
                    <span>{group.subtitle}</span>
                  </div>

                  <div className="swingScanRows">
                    {items.length ? (
                      items.slice(0, 10).map((item) => (
                        <div className="swingScanRow" key={item.symbol}>
                          <div>
                            <strong>{item.ticker}</strong>
                            <small>{item.sector}</small>
                          </div>
                          <span>{item.close.toLocaleString("en-IN")}</span>
                          <strong
                            className={
                              item.direction === "BULL"
                                ? "positive"
                                : "negative"
                            }
                          >
                            {item.direction === "BULL" ? "↑" : "↓"}{" "}
                            {group.key === "weekly" &&
                            item.weeklyChangePercent !== undefined
                              ? pct(item.weeklyChangePercent)
                              : pct(item.changePercent)}
                          </strong>
                        </div>
                      ))
                    ) : (
                      <div className="analyticsEmptyState">
                        No confirmed matches on the latest completed daily
                        candle.
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>

          <section className="card analyticsMethodCard">
            <p className="label">CALCULATION RULES</p>
            <div className="methodRuleGrid">
              {Object.entries(data.methodology).map(([key, value]) => (
                <div key={key}>
                  <strong>{key}</strong>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
