"use client";

import { useEffect, useMemo, useState } from "react";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";

type OptionLeg = {
  symbol: string;
  optionType: "CE" | "PE";
  strike: number;
  ltp: number;
  bid: number;
  ask: number;
  volume: number;
  oi: number;
  oiChange: number;
  oiChangePercent: number;
  previousOi: number;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    iv: number;
  } | null;
};

type Expiry = {
  date: string;
  expiry: number;
};

type DerivativeData = {
  ok: boolean;
  available: boolean;
  reason?: string;
  future: null | {
    symbol: string;
    expiry: number | null;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    oi: number | null;
    previousOi: number | null;
    oiChange: number | null;
    oiChangePercent: number | null;
    basis: number | null;
    basisPercent: number | null;
  };
  options: null | {
    callOi: number;
    putOi: number;
    pcr: number | null;
    indiaVix: number | null;
    futuresPrice: number | null;
    nearestExpiry: Expiry | null;
    expiries: Expiry[];
    atm: {
      strike: number | null;
      call: OptionLeg | null;
      put: OptionLeg | null;
    };
    callOiWalls: OptionLeg[];
    putOiWalls: OptionLeg[];
    callOiBuild: OptionLeg[];
    putOiBuild: OptionLeg[];
    callUnwinding: OptionLeg[];
    putUnwinding: OptionLeg[];
    legs: OptionLeg[];
  };
  error?: string;
};

type QuoteResponse = {
  ok: boolean;
  quote?: {
    lp: number;
    ch: number;
    chp: number;
  };
  error?: string;
};

const UNDERLYINGS = [
  {
    key: "NIFTY",
    label: "NIFTY 50",
    symbol: "NSE:NIFTY50-INDEX",
    market: "NSE",
    type: "INDEX",
    underlying: "NIFTY"
  },
  {
    key: "BANKNIFTY",
    label: "BANK NIFTY",
    symbol: "NSE:NIFTYBANK-INDEX",
    market: "NSE",
    type: "INDEX",
    underlying: "BANKNIFTY"
  },
  {
    key: "FINNIFTY",
    label: "FINNIFTY",
    symbol: "NSE:FINNIFTY-INDEX",
    market: "NSE",
    type: "INDEX",
    underlying: "FINNIFTY"
  },
  {
    key: "SENSEX",
    label: "SENSEX",
    symbol: "BSE:SENSEX-INDEX",
    market: "BSE",
    type: "INDEX",
    underlying: "SENSEX"
  }
];

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function regime(
  changePercent: number,
  oiChange: number | null
) {
  if (oiChange === null) return "OI unavailable";
  if (changePercent >= 0 && oiChange > 0) return "Long build-up";
  if (changePercent < 0 && oiChange > 0) return "Short build-up";
  if (changePercent >= 0 && oiChange < 0) return "Short covering";
  if (changePercent < 0 && oiChange < 0) return "Long unwinding";
  return "Neutral";
}

export default function OptionsAnalyticsClient({
  mode
}: {
  mode: "clock" | "apex";
}) {
  const [underlyingKey, setUnderlyingKey] = useState("NIFTY");
  const [expiry, setExpiry] = useState<number | null>(null);
  const [data, setData] = useState<DerivativeData | null>(null);
  const [spot, setSpot] = useState(0);
  const [error, setError] = useState("");

  const selected =
    UNDERLYINGS.find((item) => item.key === underlyingKey) ??
    UNDERLYINGS[0];

  useEffect(() => {
    setExpiry(null);
  }, [underlyingKey]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const quoteResponse = await fetch(
          `/api/fyers/quote?symbol=${encodeURIComponent(selected.symbol)}`,
          { cache: "no-store" }
        );
        const quoteBody = (await quoteResponse.json()) as QuoteResponse;
        const nextSpot =
          quoteResponse.ok && quoteBody.ok
            ? Number(quoteBody.quote?.lp ?? 0)
            : 0;

        const params = new URLSearchParams({
          symbol: selected.symbol,
          market: selected.market,
          type: selected.type,
          underlying: selected.underlying,
          spotPrice: String(nextSpot)
        });
        if (expiry) params.set("expiry", String(expiry));

        const derivativeResponse = await fetch(
          `/api/fyers/derivatives?${params.toString()}`,
          { cache: "no-store" }
        );
        const body = (await derivativeResponse.json()) as DerivativeData;

        if (!derivativeResponse.ok || !body.ok) {
          throw new Error(body.error || "Unable to load options analytics.");
        }

        if (!body.available) {
          throw new Error(
            body.reason || "Options analytics are unavailable."
          );
        }

        if (!cancelled) {
          setSpot(nextSpot);
          setData(body);
          setError("");
          if (
            expiry === null &&
            body.options?.nearestExpiry?.expiry
          ) {
            setExpiry(body.options.nearestExpiry.expiry);
          }
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to load options analytics."
          );
        }
      }
    };

    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selected, expiry]);

  const strikes = useMemo(() => {
    const legs = data?.options?.legs ?? [];
    const byStrike = new Map<
      number,
      { strike: number; call: OptionLeg | null; put: OptionLeg | null }
    >();

    for (const leg of legs) {
      const row = byStrike.get(leg.strike) ?? {
        strike: leg.strike,
        call: null,
        put: null
      };
      if (leg.optionType === "CE") row.call = leg;
      else row.put = leg;
      byStrike.set(leg.strike, row);
    }

    return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  }, [data]);

  const maxAbsOiChange = useMemo(
    () =>
      Math.max(
        1,
        ...strikes.flatMap((row) => [
          Math.abs(row.call?.oiChange ?? 0),
          Math.abs(row.put?.oiChange ?? 0)
        ])
      ),
    [strikes]
  );

  const callPositive = strikes.reduce(
    (sum, row) => sum + Math.max(0, row.call?.oiChange ?? 0),
    0
  );
  const putPositive = strikes.reduce(
    (sum, row) => sum + Math.max(0, row.put?.oiChange ?? 0),
    0
  );
  const buildTotal = callPositive + putPositive;
  const putBuildShare = buildTotal ? (putPositive / buildTotal) * 100 : 50;

  const options = data?.options;
  const future = data?.future;

  return (
    <main className="analyticsPage">
      <AnalyticsHeader
        title={mode === "clock" ? "Option Clock" : "Option Apex"}
        description={
          mode === "clock"
            ? "Strike-by-strike Call/Put OI change, total OI distribution and PCR from FYERS."
            : "Options and futures context: OI walls, Greeks, VIX, futures basis and price/OI regime."
        }
        badge="FYERS DERIVATIVES"
      />

      <section className="optionsControls">
        <div className="analyticsTabs">
          {UNDERLYINGS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={underlyingKey === item.key ? "active" : ""}
              onClick={() => setUnderlyingKey(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label>
          <span>EXPIRY</span>
          <select
            value={expiry ?? ""}
            onChange={(event) =>
              setExpiry(
                event.target.value ? Number(event.target.value) : null
              )
            }
          >
            {(data?.options?.expiries ?? []).map((item) => (
              <option key={item.expiry} value={item.expiry}>
                {item.date}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error ? <div className="analyticsError">{error}</div> : null}

      {!data || !options ? (
        <section className="analyticsLoading">
          Loading {selected.label} derivatives…
        </section>
      ) : mode === "clock" ? (
        <>
          <section className="analyticsMetricGrid">
            <article className="analyticsMetricCard">
              <span>SPOT</span>
              <strong>{spot ? spot.toLocaleString("en-IN") : "—"}</strong>
              <small>{selected.label}</small>
            </article>
            <article className="analyticsMetricCard">
              <span>ATM</span>
              <strong>
                {options.atm.strike?.toLocaleString("en-IN") ?? "—"}
              </strong>
              <small>nearest returned strike</small>
            </article>
            <article className="analyticsMetricCard">
              <span>PCR · TOTAL OI</span>
              <strong>{options.pcr?.toFixed(2) ?? "—"}</strong>
              <small>Put OI ÷ Call OI</small>
            </article>
            <article className="analyticsMetricCard">
              <span>INDIA VIX</span>
              <strong>{options.indiaVix?.toFixed(2) ?? "—"}</strong>
              <small>FYERS chain context</small>
            </article>
          </section>

          <section className="optionClockGrid">
            <article className="card optionClockMain">
              <div className="analyticsSectionHeader">
                <div>
                  <p className="label">OI CLOCK</p>
                  <h2>Call / Put OI change by strike</h2>
                </div>
                <span>ATM {options.atm.strike?.toLocaleString("en-IN")}</span>
              </div>

              <div className="optionClockLegend">
                <span><i className="callLegend" /> Call OI Δ</span>
                <span><i className="putLegend" /> Put OI Δ</span>
              </div>

              <div className="optionClockRows">
                {strikes.map((row) => {
                  const call = row.call?.oiChange ?? 0;
                  const put = row.put?.oiChange ?? 0;
                  const isAtm = row.strike === options.atm.strike;
                  return (
                    <div
                      className={isAtm ? "optionClockRow atm" : "optionClockRow"}
                      key={row.strike}
                    >
                      <div className="optionBarSide call">
                        <span
                          style={{
                            width: `${(Math.abs(call) / maxAbsOiChange) * 100}%`
                          }}
                        />
                        <strong>{formatCompact(call)}</strong>
                      </div>
                      <b>{row.strike.toLocaleString("en-IN")}</b>
                      <div className="optionBarSide put">
                        <span
                          style={{
                            width: `${(Math.abs(put) / maxAbsOiChange) * 100}%`
                          }}
                        />
                        <strong>{formatCompact(put)}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>

            <aside className="optionClockSide">
              <article className="card optionBuildCard">
                <p className="label">POSITIVE OI BUILD</p>
                <h2>Put vs Call additions</h2>
                <div className="optionBuildTrack">
                  <div
                    className="putBuild"
                    style={{ width: `${putBuildShare}%` }}
                  />
                  <div
                    className="callBuild"
                    style={{ width: `${100 - putBuildShare}%` }}
                  />
                </div>
                <div className="optionBuildNumbers">
                  <div>
                    <span>Put OI Δ+</span>
                    <strong className="positive">
                      {formatCompact(putPositive)}
                    </strong>
                  </div>
                  <div>
                    <span>Call OI Δ+</span>
                    <strong className="negative">
                      {formatCompact(callPositive)}
                    </strong>
                  </div>
                </div>
              </article>

              <article className="card optionPcrCard">
                <p className="label">TOTAL OI DISTRIBUTION</p>
                <div
                  className="optionPcrDonut"
                  style={{
                    background: `conic-gradient(#36c987 0 ${
                      options.callOi + options.putOi
                        ? (options.putOi /
                            (options.callOi + options.putOi)) *
                          100
                        : 50
                    }%, #ef6b75 0 100%)`
                  }}
                >
                  <div>
                    <span>PCR</span>
                    <strong>{options.pcr?.toFixed(2) ?? "—"}</strong>
                  </div>
                </div>
                <div className="optionBuildNumbers">
                  <div>
                    <span>PUT OI</span>
                    <strong>{formatCompact(options.putOi)}</strong>
                  </div>
                  <div>
                    <span>CALL OI</span>
                    <strong>{formatCompact(options.callOi)}</strong>
                  </div>
                </div>
              </article>
            </aside>
          </section>

          <p className="analyticsMethodNote">
            OI additions are displayed as Call/Put positioning data. OI change
            alone does not prove whether an option was bought or written, so
            this page does not falsely label every OI change as bullish or
            bearish.
          </p>
        </>
      ) : (
        <>
          <section className="analyticsMetricGrid">
            <article className="analyticsMetricCard">
              <span>SPOT</span>
              <strong>{spot ? spot.toLocaleString("en-IN") : "—"}</strong>
              <small>{selected.label}</small>
            </article>
            <article className="analyticsMetricCard">
              <span>FUTURE</span>
              <strong>{future?.price.toLocaleString("en-IN") ?? "—"}</strong>
              <small
                className={
                  (future?.changePercent ?? 0) >= 0
                    ? "positive"
                    : "negative"
                }
              >
                {future
                  ? `${future.changePercent >= 0 ? "+" : ""}${future.changePercent.toFixed(2)}%`
                  : "—"}
              </small>
            </article>
            <article className="analyticsMetricCard">
              <span>FUTURE OI REGIME</span>
              <strong>
                {future
                  ? regime(future.changePercent, future.oiChange)
                  : "—"}
              </strong>
              <small>
                Price direction + futures OI change
              </small>
            </article>
            <article className="analyticsMetricCard">
              <span>BASIS</span>
              <strong>
                {future?.basis === null || future?.basis === undefined
                  ? "—"
                  : future.basis.toFixed(2)}
              </strong>
              <small>
                {future?.basisPercent === null ||
                future?.basisPercent === undefined
                  ? "Future − spot"
                  : `${future.basisPercent >= 0 ? "+" : ""}${future.basisPercent.toFixed(3)}%`}
              </small>
            </article>
          </section>

          <section className="optionsApexGrid">
            <article className="card optionApexPanel">
              <div className="analyticsSectionHeader">
                <div>
                  <p className="label">OPTIONS CONTEXT</p>
                  <h2>ATM Greeks</h2>
                </div>
                <span>VIX {options.indiaVix?.toFixed(2) ?? "—"}</span>
              </div>

              <div className="greeksGrid">
                {[
                  ["CALL", options.atm.call],
                  ["PUT", options.atm.put]
                ].map(([label, leg]) => {
                  const option = leg as OptionLeg | null;
                  return (
                    <div key={String(label)}>
                      <strong>{String(label)}</strong>
                      <span>
                        LTP {option?.ltp.toFixed(2) ?? "—"}
                      </span>
                      <span>
                        Δ {option?.greeks?.delta.toFixed(3) ?? "—"}
                      </span>
                      <span>
                        Γ {option?.greeks?.gamma.toFixed(4) ?? "—"}
                      </span>
                      <span>
                        Θ {option?.greeks?.theta.toFixed(2) ?? "—"}
                      </span>
                      <span>
                        IV {option?.greeks?.iv.toFixed(2) ?? "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="card optionApexPanel">
              <div className="analyticsSectionHeader">
                <div>
                  <p className="label">OI WALLS</p>
                  <h2>Largest open-interest concentrations</h2>
                </div>
              </div>
              <div className="oiWallsGrid">
                <div>
                  <span>CALL OI WALLS</span>
                  {options.callOiWalls.map((leg) => (
                    <p key={leg.symbol}>
                      <strong>{leg.strike.toLocaleString("en-IN")}</strong>
                      <small>{formatCompact(leg.oi)} OI</small>
                    </p>
                  ))}
                </div>
                <div>
                  <span>PUT OI WALLS</span>
                  {options.putOiWalls.map((leg) => (
                    <p key={leg.symbol}>
                      <strong>{leg.strike.toLocaleString("en-IN")}</strong>
                      <small>{formatCompact(leg.oi)} OI</small>
                    </p>
                  ))}
                </div>
              </div>
            </article>
          </section>

          <section className="card optionFluxCard">
            <div className="analyticsSectionHeader">
              <div>
                <p className="label">OPTION OI FLUX</p>
                <h2>Strike map</h2>
              </div>
              <span>
                Green = Put OI build · Red = Call OI build
              </span>
            </div>
            <div className="optionFluxGrid">
              {strikes.map((row) => {
                const call = Math.max(0, row.call?.oiChange ?? 0);
                const put = Math.max(0, row.put?.oiChange ?? 0);
                const dominantPut = put >= call;
                const strength = Math.max(call, put) / maxAbsOiChange;
                return (
                  <div
                    key={row.strike}
                    className={
                      dominantPut
                        ? "optionFluxTile put"
                        : "optionFluxTile call"
                    }
                    style={{ opacity: 0.45 + Math.min(0.55, strength * 0.55) }}
                  >
                    <strong>{row.strike.toLocaleString("en-IN")}</strong>
                    <span>
                      {dominantPut ? "PUT" : "CALL"} ΔOI{" "}
                      {formatCompact(Math.max(call, put))}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <p className="analyticsMethodNote">
            “Long build-up / short build-up / covering / unwinding” uses the
            standard transparent combination of futures price direction and
            futures OI change. OI walls are concentrations, not guaranteed
            support/resistance.
          </p>
        </>
      )}
    </main>
  );
}
