import type { TechnicalContext } from "./indicators";
import type { FibonacciSetup, ImbalanceLiquiditySnapshot, MarketStructureSnapshot, OrderBlock, OrderBlockSnapshot } from "./market-structure";
import type { ReversalScore } from "./confluence";
import type { OpeningConfirmation } from "./opening-confirmation";

export type SimpleTradePlanState = "WAIT_TREND" | "WAIT_RETRACE" | "WAIT_CONFIRMATION" | "READY" | "NO_TRADE";

export type SimpleTradePlan = {
  trend: "bullish" | "bearish" | "neutral";
  state: SimpleTradePlanState;
  headline: string;
  instruction: string;
  zone: { low: number; high: number } | null;
  entry: number | null;
  stopLoss: number | null;
  trigger: "LIQUIDITY SWEEP" | "ORDER BLOCK" | "SWEEP + ORDER BLOCK" | null;
  score: number;
  targets: Array<{ label: "T1" | "T2" | "T3"; price: number; rr: number | null; source: string }>;
  reason: string;
  signalTime: number | null;
  confirmationTimeframe: "1m" | "5m" | "15m" | null;
  moveClass: "TACTICAL" | "MAJOR" | null;
};

function alignedTrend(technical: TechnicalContext, structure: MarketStructureSnapshot): SimpleTradePlan["trend"] {
  const technicalDirection = technical.trendState.includes("bullish") ? "bullish" : technical.trendState.includes("bearish") ? "bearish" : "neutral";
  if (technicalDirection !== "neutral" && structure.trend !== "neutral" && technicalDirection !== structure.trend) return "neutral";
  return technicalDirection !== "neutral" ? technicalDirection : structure.trend;
}

function nearestBlock(direction: "bullish" | "bearish", reference: number, blocks: OrderBlockSnapshot): OrderBlock | null {
  const matching = blocks.activeBlocks.filter((block) => block.direction === direction);
  if (!matching.length) return null;
  return matching.map((block) => ({ block, distance: reference < block.lower ? block.lower - reference : reference > block.upper ? reference - block.upper : 0 })).sort((a, b) => a.distance - b.distance)[0].block;
}

function overlapZone(a: { low: number; high: number }, b: { lower: number; upper: number }) {
  const low = Math.max(Math.min(a.low, a.high), Math.min(b.lower, b.upper));
  const high = Math.min(Math.max(a.low, a.high), Math.max(b.lower, b.upper));
  return low <= high ? { low, high } : null;
}

export function buildSimpleTradePlan(input: {
  price: number;
  latestTime: number | null;
  htfTechnical: TechnicalContext;
  htfStructure: MarketStructureSnapshot;
  fibonacci: FibonacciSetup;
  imbalance: ImbalanceLiquiditySnapshot;
  orderBlocks: OrderBlockSnapshot;
  reversal: ReversalScore;
  refineAtr: number | null;
  openingConfirmation?: OpeningConfirmation | null;
  confirmation15m?: MarketStructureSnapshot | null;
}): SimpleTradePlan {
  const {
    price,
    latestTime,
    htfTechnical,
    htfStructure,
    fibonacci,
    imbalance,
    orderBlocks,
    reversal
  } = input;
  const atr = input.refineAtr ?? fibonacci.atr14 ?? 0;
  const trend = alignedTrend(htfTechnical, htfStructure);
  const empty = (
    state: SimpleTradePlanState,
    headline: string,
    instruction: string,
    reason: string
  ): SimpleTradePlan => ({
    trend,
    state,
    headline,
    instruction,
    zone: null,
    entry: null,
    stopLoss: null,
    trigger: null,
    score: reversal.score,
    targets: [],
    reason,
    signalTime: null,
    confirmationTimeframe: null,
    moveClass: null
  });

  if (trend === "neutral" || reversal.direction !== trend || !fibonacci.goldenZone || fibonacci.direction !== trend) {
    return empty("WAIT_TREND", "WAIT — no clean directional setup", "Wait for 4H trend and structure to align before planning an entry.", "Higher-timeframe trend, structure and Fib impulse are not fully aligned.");
  }

  const fibZone = { low: Math.min(fibonacci.goldenZone.low, fibonacci.goldenZone.high), high: Math.max(fibonacci.goldenZone.low, fibonacci.goldenZone.high) };
  const midpoint = (fibZone.low + fibZone.high) / 2;
  const block = nearestBlock(trend, midpoint, orderBlocks);
  const overlap = block ? overlapZone(fibZone, block) : null;
  const recentSweep = imbalance.latestSweep?.direction === trend && latestTime !== null && latestTime >= imbalance.latestSweep.time && latestTime - imbalance.latestSweep.time <= 48 * 60 * 60 ? imbalance.latestSweep : null;
  const obNearFib = block && (overlap !== null || (atr > 0 && Math.min(Math.abs(block.lower - midpoint), Math.abs(block.upper - midpoint)) <= atr * 0.35)) ? block : null;
  const trigger = recentSweep && obNearFib ? "SWEEP + ORDER BLOCK" : recentSweep ? "LIQUIDITY SWEEP" : obNearFib ? "ORDER BLOCK" : null;
  const zone = overlap ?? fibZone;
  const zoneMid = (zone.low + zone.high) / 2;
  const zoneDistance = price < zone.low ? zone.low - price : price > zone.high ? price - zone.high : 0;
  const nearZone = zoneDistance === 0 || (atr > 0 && zoneDistance <= atr * 0.2);

  const stopCandidates: number[] = [];
  if (obNearFib && atr > 0) stopCandidates.push(trend === "bullish" ? obNearFib.lower - atr * 0.2 : obNearFib.upper + atr * 0.2);
  if (recentSweep && atr > 0) stopCandidates.push(trend === "bullish" ? recentSweep.extreme - atr * 0.2 : recentSweep.extreme + atr * 0.2);
  const validStops = stopCandidates.filter((stop) => trend === "bullish" ? stop < zone.low : stop > zone.high);
  const stopLoss = validStops.length ? (trend === "bullish" ? Math.max(...validStops) : Math.min(...validStops)) : null;
  const entry = nearZone ? price : zoneMid;
  const risk = stopLoss !== null ? Math.abs(entry - stopLoss) : null;
  const targets = reversal.targets.filter((target) => trend === "bullish" ? target.price > entry : target.price < entry).slice(0, 3).map((target, index) => ({
    label: (["T1", "T2", "T3"] as const)[index],
    price: target.price,
    rr: risk && risk > 0 ? Math.abs(target.price - entry) / risk : null,
    source: target.source
  }));

  const opening = input.openingConfirmation;
  const normalEvent = input.confirmation15m?.latestEvent ?? null;
  const openingConfirmed =
    opening?.active === true &&
    opening.confirmed &&
    opening.time !== null &&
    opening.timeframe !== null;
  const normalConfirmed =
    reversal.entryState === "CONFIRMED" &&
    normalEvent?.direction === trend;

  const confirmationTimeframe = openingConfirmed
    ? opening!.timeframe
    : normalConfirmed
      ? "15m"
      : null;
  const signalTime = openingConfirmed
    ? opening!.time
    : normalConfirmed
      ? normalEvent?.time ?? null
      : null;
  const effectiveTrigger =
    openingConfirmed && opening?.trigger
      ? opening.trigger
      : trigger;

  const requiredScore =
    confirmationTimeframe === "1m"
      ? 85
      : confirmationTimeframe === "5m"
        ? 80
        : 75;

  if (reversal.score < 60) return { ...empty("NO_TRADE", "NO TRADE — confluence too weak", "Ignore this setup and wait for stronger real-data alignment.", "Confluence score is only " + reversal.score + "/100."), zone, trigger };
  if (!nearZone) return { trend, state: "WAIT_RETRACE", headline: "WAIT FOR " + trend.toUpperCase() + " RETRACEMENT", instruction: "Do not chase price. Wait for " + zone.low.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + "–" + zone.high.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + ".", zone, entry: zoneMid, stopLoss, trigger, score: reversal.score, targets, signalTime: null, confirmationTimeframe: null, moveClass: null, reason: trigger ? "Preferred zone has " + trigger.toLowerCase() + " confluence." : "Fib zone exists, but no qualifying sweep/order-block trigger is present yet." };
  if (!effectiveTrigger || confirmationTimeframe === null) {
    return {
      trend,
      state: "WAIT_CONFIRMATION",
      headline: "WAIT — retracement reached, confirmation missing",
      instruction:
        opening?.active
          ? "Opening setup is pre-mapped from prior sessions. Enter only after a fresh 1m/5m sweep/structure confirmation."
          : "Enter only after a qualifying liquidity sweep or Order Block reaction and aligned 15m BOS/CHoCH.",
      zone,
      entry,
      stopLoss,
      trigger: effectiveTrigger,
      score: reversal.score,
      targets,
      reason: !effectiveTrigger
        ? "No qualifying sweep or Order Block trigger."
        : opening?.active
          ? opening.reason
          : "15m structure confirmation is not complete.",
      signalTime: null,
      confirmationTimeframe: null,
      moveClass: null
    };
  }
  if (stopLoss === null || risk === null || !(atr > 0)) return { trend, state: "NO_TRADE", headline: "NO TRADE — no strict invalidation", instruction: "Wait for a cleaner sweep or Order Block that gives a defensible tight stop.", zone, entry, stopLoss: null, trigger, score: reversal.score, targets, signalTime: null, confirmationTimeframe: null, moveClass: null, reason: "A real invalidation level could not be established." };
  if (risk > atr * 0.65) return { trend, state: "NO_TRADE", headline: "NO TRADE — stop is too wide", instruction: "Wait for a tighter retracement/sweep. Do not force a wide stop.", zone, entry, stopLoss, trigger, score: reversal.score, targets, signalTime: null, confirmationTimeframe: null, moveClass: null, reason: "Required stop is " + (risk / atr).toFixed(2) + "× 1H ATR; strict limit is 0.65× ATR." };
  const bestRr = Math.max(0, ...targets.map((target) => target.rr ?? 0));
  const t3 = targets.find((target) => target.label === "T3") ?? null;
  const t3DistanceAtr =
    t3 && atr > 0 ? Math.abs(t3.price - entry) / atr : 0;
  const moveClass: "TACTICAL" | "MAJOR" =
    bestRr >= 4 && t3DistanceAtr >= 3 ? "MAJOR" : "TACTICAL";
  if (reversal.score < requiredScore || bestRr < 3) {
    return {
      trend,
      state: "NO_TRADE",
      headline: "NO TRADE — reward/risk is not strong enough",
      instruction:
        "Wait for a better retracement with a smaller invalidation or larger clean target.",
      zone,
      entry,
      stopLoss,
      trigger: effectiveTrigger,
      score: reversal.score,
      targets,
      signalTime: null,
      confirmationTimeframe: null,
      moveClass: null,
      reason:
        reversal.score < requiredScore
          ? "Confirmation threshold not met (" +
            reversal.score +
            "/" +
            requiredScore +
            ")."
          : "Best available target is only " + bestRr.toFixed(1) + "R."
    };
  }
  return {
    trend,
    state: "READY",
    headline: trend.toUpperCase() + " SETUP — CONFIRMED",
    instruction:
      "Entry is valid only while price remains in/near the planned retracement zone and the confirmation remains intact.",
    zone,
    entry,
    stopLoss,
    trigger: effectiveTrigger,
    score: reversal.score,
    targets,
    signalTime,
    confirmationTimeframe,
    moveClass,
    reason:
      effectiveTrigger +
      " + " +
      confirmationTimeframe +
      " confirmation + strong confluence with a strict invalidation."
  };
}
