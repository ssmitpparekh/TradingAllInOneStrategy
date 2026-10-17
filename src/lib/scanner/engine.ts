import {
  buildFibonacciSetup,
  buildImbalanceLiquiditySnapshot,
  buildMarketStructure,
  buildOrderBlockSnapshot,
  type FibonacciSetup,
  type ImbalanceLiquiditySnapshot,
  type MarketStructureSnapshot,
  type OrderBlockSnapshot
} from "@/lib/analysis/market-structure";
import { buildTechnicalContext, type TechnicalContext } from "@/lib/analysis/indicators";
import { buildVolumeAnalytics, type VolumeAnalytics } from "@/lib/analysis/volume";
import { buildReversalEngine } from "@/lib/analysis/confluence";
import { buildSimpleTradePlan } from "@/lib/analysis/trade-plan";
import type { ChartCandle } from "@/components/MarketChart";

export type ScannerInstrument = {
  symbol: string;
  name: string;
  market: "NSE" | "BSE" | "MCX" | "KRAKEN";
  type: "INDEX" | "EQUITY" | "FUTURE" | "CRYPTO";
  underlying: string;
  lotSize: number | null;
};

export type ScannerStaticContext = {
  instrument: ScannerInstrument;
  candles15m: ChartCandle[];
  htfTechnical: TechnicalContext;
  htfFib: FibonacciSetup;
  htfStructure: MarketStructureSnapshot;
  refineFib: FibonacciSetup;
  refineImbalance: ImbalanceLiquiditySnapshot;
  refineOrderBlocks: OrderBlockSnapshot;
  refineVolume: VolumeAnalytics;
  confirmation15m: MarketStructureSnapshot;
  atr: number | null;
  builtAt: number;
};

export type ScannerLiveState = {
  price: number;
  observedHigh: number;
  observedLow: number;
  observedSince: number;
  updatedAt: number;
  sourceTime: number;
};

export type ScannerOpportunity = {
  instrument: ScannerInstrument;
  direction: "bullish" | "bearish";
  state: "STRONG";
  score: number;
  price: number;
  entry: number;
  stopLoss: number;
  targets: Array<{
    label: "T1" | "T2" | "T3";
    price: number;
    rr: number | null;
    source: string;
  }>;
  moveClass: "TACTICAL" | "MAJOR";
  confirmationTimeframe: "15m";
  trigger: string;
  reason: string;
  zone: { low: number; high: number } | null;
  observedSweep: boolean;
  updatedAt: number;
  sourceTime: number;
};

export function scannerQuoteIsFresh(
  market: ScannerInstrument["market"],
  sourceTime: number,
  nowMs = Date.now()
) {
  if (!(sourceTime > 0)) return false;

  const ageMs = nowMs - sourceTime * 1000;
  if (ageMs < -30_000) return false;

  // Kraken is a continuous market and should be genuinely streaming.
  if (market === "KRAKEN") return ageMs <= 45_000;

  // Indian scanner rows are "NOW" only when the exchange/provider quote
  // itself is fresh. Re-polling yesterday's close must never make it live.
  return ageMs <= 120_000;
}

export function scannerBucketStart(
  timestamp: number,
  minutes: number,
  market: ScannerInstrument["market"]
) {
  if (market === "KRAKEN") {
    const seconds = minutes * 60;
    return Math.floor(timestamp / seconds) * seconds;
  }

  const date = new Date(timestamp * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const year = get("year");
  const month = get("month");
  const day = get("day");

  if (!year || !month || !day) {
    const seconds = minutes * 60;
    return Math.floor(timestamp / seconds) * seconds;
  }

  const sessionOpen = Math.floor(
    Date.UTC(
      year,
      month - 1,
      day,
      market === "MCX" ? 3 : 3,
      market === "MCX" ? 30 : 45,
      0
    ) / 1000
  );
  const elapsed = Math.max(0, timestamp - sessionOpen);
  const size = minutes * 60;

  return sessionOpen + Math.floor(elapsed / size) * size;
}

export function aggregateCandles(
  candles: ChartCandle[],
  minutes: number,
  market: ScannerInstrument["market"]
) {
  const grouped = new Map<number, ChartCandle>();

  for (const candle of candles) {
    const time = scannerBucketStart(candle.time, minutes, market);
    const current = grouped.get(time);

    if (!current) {
      grouped.set(time, {
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume ?? 0,
        oi: candle.oi
      });
      continue;
    }

    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume = (current.volume ?? 0) + (candle.volume ?? 0);

    if (candle.oi !== undefined) current.oi = candle.oi;
  }

  return [...grouped.values()].sort((a, b) => a.time - b.time);
}

export function buildScannerStaticContext(
  instrument: ScannerInstrument,
  candles15m: ChartCandle[]
): ScannerStaticContext | null {
  if (candles15m.length < 80) return null;

  const clean15 = candles15m
    .slice()
    .sort((a, b) => a.time - b.time)
    .slice(-900);
  const h1 = aggregateCandles(clean15, 60, instrument.market);
  const h4 = aggregateCandles(clean15, 240, instrument.market);

  if (h1.length < 30 || h4.length < 20) return null;

  const htfFib = buildFibonacciSetup(h4);
  const refineFib = buildFibonacciSetup(h1);

  return {
    instrument,
    candles15m: clean15,
    htfTechnical: buildTechnicalContext(h4),
    htfFib,
    htfStructure: buildMarketStructure(h4),
    refineFib,
    refineImbalance: buildImbalanceLiquiditySnapshot(h1),
    refineOrderBlocks: buildOrderBlockSnapshot(h1),
    refineVolume: buildVolumeAnalytics(h1, {
      timeZone: instrument.market === "KRAKEN" ? "UTC" : "Asia/Kolkata",
      anchorTime: htfFib.anchorA?.time ?? null
    }),
    confirmation15m: buildMarketStructure(clean15),
    atr: refineFib.atr14,
    builtAt: Date.now()
  };
}

export function evaluateScannerContext(
  context: ScannerStaticContext,
  live: ScannerLiveState
): ScannerOpportunity | null {
  if (
    !(live.price > 0) ||
    !scannerQuoteIsFresh(
      context.instrument.market,
      live.sourceTime
    )
  ) {
    return null;
  }

  const reversal = buildReversalEngine({
    price: live.price,
    htfAtr: context.htfFib.atr14,
    refineAtr: context.refineFib.atr14,
    htfReady: true,
    confirmation15mReady: context.candles15m.length >= 30,
    fibonacci: context.htfFib,
    structure: context.htfStructure,
    imbalance: context.refineImbalance,
    orderBlocks: context.refineOrderBlocks,
    volume: context.refineVolume,
    confirmation15m: context.confirmation15m,
    derivatives: null
  });

  const latestTime =
    context.candles15m[context.candles15m.length - 1]?.time ?? null;

  const plan = buildSimpleTradePlan({
    price: live.price,
    latestTime,
    htfTechnical: context.htfTechnical,
    htfStructure: context.htfStructure,
    fibonacci: context.htfFib,
    imbalance: context.refineImbalance,
    orderBlocks: context.refineOrderBlocks,
    reversal: reversal.selected,
    refineAtr: context.refineFib.atr14,
    openingConfirmation: null,
    confirmation15m: context.confirmation15m
  });

  // The scanner is not allowed to invent a shortcut "strong" state.
  // If the same core trade-plan gate used by the chart is not READY,
  // there is no actionable scanner trade.
  if (
    plan.state !== "READY" ||
    plan.trend === "neutral" ||
    plan.entry === null ||
    plan.stopLoss === null ||
    plan.moveClass === null ||
    plan.confirmationTimeframe !== "15m" ||
    plan.targets.length < 3
  ) {
    return null;
  }

  return {
    instrument: context.instrument,
    direction: plan.trend,
    state: "STRONG",
    score: plan.score,
    price: live.price,
    entry: plan.entry,
    stopLoss: plan.stopLoss,
    targets: plan.targets.slice(0, 3),
    moveClass: plan.moveClass,
    confirmationTimeframe: "15m",
    trigger: plan.trigger ?? "CONFIRMED STRUCTURE",
    reason: plan.reason,
    zone: plan.zone,
    observedSweep:
      plan.trigger === "LIQUIDITY SWEEP" ||
      plan.trigger === "SWEEP + ORDER BLOCK",
    updatedAt: live.updatedAt,
    sourceTime: live.sourceTime
  };
}
