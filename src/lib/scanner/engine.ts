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
import { buildReversalEngine, type ReversalScore } from "@/lib/analysis/confluence";
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
};

export type ScannerOpportunity = {
  instrument: ScannerInstrument;
  direction: "bullish" | "bearish";
  state: "STRONG" | "WATCH" | "LIVE SWEEP";
  score: number;
  price: number;
  trigger: string;
  reason: string;
  zone: { low: number; high: number } | null;
  observedSweep: boolean;
  updatedAt: number;
};

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
    Date.UTC(year, month - 1, day, 3, 45, 0) / 1000
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

function distanceToZone(
  price: number,
  zone: { low: number; high: number } | null
) {
  if (!zone) return Number.POSITIVE_INFINITY;
  if (price < zone.low) return zone.low - price;
  if (price > zone.high) return price - zone.high;
  return 0;
}

function observedSweep(
  context: ScannerStaticContext,
  live: ScannerLiveState,
  direction: "bullish" | "bearish"
) {
  const swingHigh = context.confirmation15m.activeSwingHigh;
  const swingLow = context.confirmation15m.activeSwingLow;

  if (
    direction === "bearish" &&
    swingHigh &&
    live.observedHigh > swingHigh.price &&
    live.price < swingHigh.price
  ) {
    return true;
  }

  if (
    direction === "bullish" &&
    swingLow &&
    live.observedLow < swingLow.price &&
    live.price > swingLow.price
  ) {
    return true;
  }

  return false;
}

function activeBlockNear(
  context: ScannerStaticContext,
  direction: "bullish" | "bearish",
  price: number
) {
  const atr = context.atr ?? 0;

  return context.refineOrderBlocks.activeBlocks.some((block) => {
    if (block.direction !== direction) return false;
    if (price >= block.lower && price <= block.upper) return true;

    if (!(atr > 0)) return false;

    const distance = Math.min(
      Math.abs(price - block.lower),
      Math.abs(price - block.upper)
    );
    return distance <= atr * 0.3;
  });
}

export function evaluateScannerContext(
  context: ScannerStaticContext,
  live: ScannerLiveState
): ScannerOpportunity | null {
  if (!(live.price > 0)) return null;

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

  const selected: ReversalScore = reversal.selected;

  if (
    selected.direction !== "bullish" &&
    selected.direction !== "bearish"
  ) {
    return null;
  }

  const direction = selected.direction;
  const zone = context.htfFib.goldenZone
    ? {
        low: Math.min(
          context.htfFib.goldenZone.low,
          context.htfFib.goldenZone.high
        ),
        high: Math.max(
          context.htfFib.goldenZone.low,
          context.htfFib.goldenZone.high
        )
      }
    : null;

  const atr = context.atr ?? 0;
  const zoneDistance = distanceToZone(live.price, zone);
  const nearZone =
    zoneDistance === 0 ||
    (atr > 0 && zoneDistance <= atr * 0.5);
  const sweep = observedSweep(context, live, direction);
  const block = activeBlockNear(context, direction, live.price);

  if (!sweep && !block && !nearZone && selected.score < 75) {
    return null;
  }

  let state: ScannerOpportunity["state"] = "WATCH";
  let trigger = "HTF confluence";

  if (sweep) {
    state = selected.score >= 70 ? "STRONG" : "LIVE SWEEP";
    trigger = "Observed 15m liquidity sweep";
  } else if (block && nearZone && selected.score >= 70) {
    state = "STRONG";
    trigger = "Order Block + retracement";
  } else if (selected.score >= 75 && nearZone) {
    state = "STRONG";
    trigger = "High confluence retracement";
  }

  return {
    instrument: context.instrument,
    direction,
    state,
    score: selected.score,
    price: live.price,
    trigger,
    reason: selected.summary,
    zone,
    observedSweep: sweep,
    updatedAt: live.updatedAt
  };
}
