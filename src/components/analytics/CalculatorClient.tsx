"use client";

import { useMemo, useState } from "react";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";

function num(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function CalculatorClient() {
  const [capital, setCapital] = useState("100000");
  const [riskPercent, setRiskPercent] = useState("1");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [lotSize, setLotSize] = useState("1");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [currency, setCurrency] = useState("INR");

  const result = useMemo(() => {
    const capitalValue = Math.max(0, num(capital));
    const riskPct = Math.max(0, num(riskPercent));
    const entryValue = num(entry);
    const stopValue = num(stop);
    const targetValue = num(target);
    const lot = Math.max(1, Math.floor(num(lotSize) || 1));

    const riskAmount = capitalValue * (riskPct / 100);
    const perUnitRisk =
      side === "BUY"
        ? entryValue - stopValue
        : stopValue - entryValue;
    const rewardPerUnit =
      side === "BUY"
        ? targetValue - entryValue
        : entryValue - targetValue;

    const rawQty =
      perUnitRisk > 0 ? Math.floor(riskAmount / perUnitRisk) : 0;
    const lots = Math.floor(rawQty / lot);
    const qty = lots * lot;
    const rr =
      perUnitRisk > 0 && rewardPerUnit > 0
        ? rewardPerUnit / perUnitRisk
        : 0;

    return {
      riskAmount,
      perUnitRisk,
      rewardPerUnit,
      qty,
      lots,
      positionValue: qty * entryValue,
      plannedProfit: qty * Math.max(0, rewardPerUnit),
      rr
    };
  }, [capital, riskPercent, entry, stop, target, lotSize, side]);

  const money = (value: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(value);

  return (
    <main className="analyticsPage">
      <AnalyticsHeader
        title="Risk Calculator"
        description="Position sizing from account capital, risk %, entry and logical stop. This calculator does not override the strategy's stop-placement rules."
        badge="LOCAL CALCULATION"
      />

      <section className="calculatorGrid">
        <article className="card calculatorInputs">
          <div className="calculatorFormGrid">
            <label>
              <span>Account capital</span>
              <input value={capital} onChange={(e) => setCapital(e.target.value)} type="number" step="any" />
            </label>
            <label>
              <span>Risk %</span>
              <input value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} type="number" step="any" />
            </label>
            <label>
              <span>Side</span>
              <select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}>
                <option value="BUY">BUY / LONG</option>
                <option value="SELL">SELL / SHORT</option>
              </select>
            </label>
            <label>
              <span>Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {["INR","USD","CAD","GBP","EUR"].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span>Entry</span>
              <input value={entry} onChange={(e) => setEntry(e.target.value)} type="number" step="any" />
            </label>
            <label>
              <span>Stop loss</span>
              <input value={stop} onChange={(e) => setStop(e.target.value)} type="number" step="any" />
            </label>
            <label>
              <span>Target</span>
              <input value={target} onChange={(e) => setTarget(e.target.value)} type="number" step="any" />
            </label>
            <label>
              <span>Lot size</span>
              <input value={lotSize} onChange={(e) => setLotSize(e.target.value)} type="number" step="1" min="1" />
            </label>
          </div>
        </article>

        <article className="card calculatorResults">
          <p className="label">POSITION SIZE</p>
          <div className="calculatorResultGrid">
            <div><span>Risk amount</span><strong>{money(result.riskAmount)}</strong></div>
            <div><span>Risk / unit</span><strong>{money(result.perUnitRisk)}</strong></div>
            <div><span>Quantity</span><strong>{result.qty.toLocaleString("en-IN")}</strong></div>
            <div><span>Lots</span><strong>{result.lots}</strong></div>
            <div><span>Position value</span><strong>{money(result.positionValue)}</strong></div>
            <div><span>Planned profit</span><strong>{money(result.plannedProfit)}</strong></div>
            <div><span>Planned R:R</span><strong>{result.rr > 0 ? `1 : ${result.rr.toFixed(2)}` : "—"}</strong></div>
          </div>
        </article>
      </section>
    </main>
  );
}
