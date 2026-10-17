import type { ChartCandle } from "@/components/MarketChart";
import type {
  ImbalanceLiquiditySnapshot,
  MarketStructureSnapshot
} from "./market-structure";
import type { SimpleTradePlan } from "./trade-plan";

export type ReactionTradePlan = {
  available: boolean;
  state: "READY" | "WATCH" | "NONE";
  direction: "bullish" | "bearish" | null;
  headline: string;
  instruction: string;
  entry: number | null;
  stopLoss: number | null;
  targets: Array<{
    label: "T1" | "T2" | "T3";
    price: number;
    rr: number | null;
    source: string;
  }>;
  signalTime: number | null;
  trigger: "LIQUIDITY SWEEP REVERSAL" | null;
  score: number;
  moveClass: "TACTICAL" | "MAJOR" | null;
  reason: string;
};

function candleAt(
  candles: ChartCandle[],
  time: number
): ChartCandle | null {
  return (
    candles.find((candle) => candle.time === time) ??
    null
  );
}

function reversalQuality(
  candle: ChartCandle,
  direction: "bullish" | "bearish",
  sweepLevel: number
) {
  const range = Math.max(
    1e-9,
    candle.high - candle.low
  );
  const body = Math.abs(candle.close - candle.open);
  const lowerWick =
    Math.min(candle.open, candle.close) - candle.low;
  const upperWick =
    candle.high - Math.max(candle.open, candle.close);
  const closeLocation =
    (candle.close - candle.low) / range;

  if (direction === "bullish") {
    return (
      candle.close > sweepLevel &&
      closeLocation >= 0.55 &&
      (lowerWick >= body * 0.5 || lowerWick >= range * 0.25)
    );
  }

  return (
    candle.close < sweepLevel &&
    closeLocation <= 0.45 &&
    (upperWick >= body * 0.5 || upperWick >= range * 0.25)
  );
}

function nearestStructureTarget(
  structure: MarketStructureSnapshot,
  direction: "bullish" | "bearish",
  entry: number
) {
  if (
    direction === "bullish" &&
    structure.activeSwingHigh &&
    structure.activeSwingHigh.price > entry
  ) {
    return structure.activeSwingHigh.price;
  }

  if (
    direction === "bearish" &&
    structure.activeSwingLow &&
    structure.activeSwingLow.price < entry
  ) {
    return structure.activeSwingLow.price;
  }

  return null;
}

export function buildReactionTradePlan(input: {
  price: number;
  candles15m: ChartCandle[];
  imbalance15m: ImbalanceLiquiditySnapshot;
  structure15m: MarketStructureSnapshot;
  primaryPlan: SimpleTradePlan;
  atr15m: number | null;
}): ReactionTradePlan {
  const {
    price,
    candles15m,
    imbalance15m,
    structure15m,
    primaryPlan
  } = input;
  const atr = input.atr15m ?? 0;

  const empty = (
    state: ReactionTradePlan["state"],
    headline: string,
    instruction: string,
    reason: string
  ): ReactionTradePlan => ({
    available: false,
    state,
    direction: null,
    headline,
    instruction,
    entry: null,
    stopLoss: null,
    targets: [],
    signalTime: null,
    trigger: null,
    score: 0,
    moveClass: null,
    reason
  });

  if (
    primaryPlan.state !== "WAIT_RETRACE" ||
    !primaryPlan.zone ||
    primaryPlan.trend === "neutral" ||
    !(price > 0) ||
    !(atr > 0)
  ) {
    return empty(
      "NONE",
      "No reaction trade",
      "Reaction trades only exist while the primary setup is waiting for a distant retracement.",
      "Primary setup is not currently in WAIT_RETRACE."
    );
  }

  const reactionDirection =
    primaryPlan.trend === "bearish" ? "bullish" : "bearish";

  const zoneAhead =
    reactionDirection === "bullish"
      ? primaryPlan.zone.low > price
      : primaryPlan.zone.high < price;

  if (!zoneAhead) {
    return empty(
      "NONE",
      "No reaction trade",
      "The primary zone is not ahead of price in the reaction direction.",
      "Price has already reached or passed the primary entry area."
    );
  }

  const sweep = imbalance15m.latestSweep;

  if (!sweep || sweep.direction !== reactionDirection) {
    return empty(
      "WATCH",
      "WATCH FOR REACTION",
      "A distant primary zone exists, but a fresh opposite-direction liquidity sweep has not appeared yet.",
      "No qualifying 15m liquidity sweep in the reaction direction."
    );
  }

  const latestTime =
    candles15m[candles15m.length - 1]?.time ?? null;

  if (
    latestTime === null ||
    latestTime < sweep.time ||
    latestTime - sweep.time > 30 * 60
  ) {
    return empty(
      "WATCH",
      "WATCH FOR FRESH REACTION",
      "The last sweep is too old for a new tactical entry.",
      "Reaction sweep must be within the last two 15m candles."
    );
  }

  const sweepCandle = candleAt(candles15m, sweep.time);

  if (
    !sweepCandle ||
    !reversalQuality(
      sweepCandle,
      reactionDirection,
      sweep.level
    )
  ) {
    return empty(
      "WATCH",
      "SWEEP SEEN — REVERSAL NOT STRONG ENOUGH",
      "Wait for a stronger rejection/reclaim candle before taking the reaction leg.",
      "Sweep exists but reversal-candle quality is insufficient."
    );
  }

  const stopBuffer = atr * 0.12;
  const stopLoss =
    reactionDirection === "bullish"
      ? sweep.extreme - stopBuffer
      : sweep.extreme + stopBuffer;
  const risk = Math.abs(price - stopLoss);

  if (!(risk > 0) || risk > atr * 0.85) {
    return empty(
      "WATCH",
      "REACTION EXISTS — STOP TOO WIDE",
      "Do not chase the bounce. Wait for a tighter reclaim or a retest.",
      "Counter-trend reaction risk exceeds 0.85× 15m ATR."
    );
  }

  const chaseDistance = Math.abs(price - sweep.close);
  if (chaseDistance > atr * 0.75) {
    return empty(
      "WATCH",
      "REACTION MOVED TOO FAR",
      "Wait for a small pullback instead of chasing the reaction candle.",
      "Current price is already more than 0.75× 15m ATR from the sweep reclaim close."
    );
  }

  const zoneEdge =
    reactionDirection === "bullish"
      ? primaryPlan.zone.low
      : primaryPlan.zone.high;
  const zoneBuffer = atr * 0.12;
  const finalTarget =
    reactionDirection === "bullish"
      ? zoneEdge - zoneBuffer
      : zoneEdge + zoneBuffer;

  const finalRr =
    Math.abs(finalTarget - price) / risk;

  if (finalRr < 2.5) {
    return empty(
      "NONE",
      "NO REACTION TRADE — EDGE TOO SMALL",
      "The move into the primary zone no longer offers enough reward for a counter-trend trade.",
      "Reaction leg offers only " + finalRr.toFixed(1) + "R to the zone."
    );
  }

  const structureTarget = nearestStructureTarget(
    structure15m,
    reactionDirection,
    price
  );

  const halfway = price + (finalTarget - price) * 0.55;
  const t1Candidate =
    structureTarget !== null
      ? reactionDirection === "bullish"
        ? Math.min(structureTarget, halfway)
        : Math.max(structureTarget, halfway)
      : halfway;

  const t2 = price + (finalTarget - price) * 0.78;

  const rawTargets = [
    {
      label: "T1" as const,
      price: t1Candidate,
      source:
        structureTarget !== null
          ? "Nearest 15m structure"
          : "55% of move to primary zone"
    },
    {
      label: "T2" as const,
      price: t2,
      source: "78% of move to primary zone"
    },
    {
      label: "T3" as const,
      price: finalTarget,
      source: "Front-run primary HTF entry zone"
    }
  ];

  const targets = rawTargets
    .filter((target) =>
      reactionDirection === "bullish"
        ? target.price > price
        : target.price < price
    )
    .map((target) => ({
      ...target,
      rr: Math.abs(target.price - price) / risk
    }));

  if (targets.length < 3) {
    return empty(
      "WATCH",
      "REACTION TARGETS NOT CLEAN",
      "Wait for more room before the primary zone.",
      "A full T1/T2/T3 ladder cannot be established."
    );
  }

  const score = Math.min(
    90,
    75 + Math.max(0, Math.floor((finalRr - 2.5) * 4))
  );
  const moveDistanceAtr =
    atr > 0 ? Math.abs(finalTarget - price) / atr : 0;
  const moveClass: "TACTICAL" | "MAJOR" =
    finalRr >= 4 && moveDistanceAtr >= 3 ? "MAJOR" : "TACTICAL";

  return {
    available: true,
    state: "READY",
    direction: reactionDirection,
    headline:
      reactionDirection === "bullish"
        ? "REACTION LONG — TOWARD PRIMARY SHORT ZONE"
        : "REACTION SHORT — TOWARD PRIMARY LONG ZONE",
    instruction:
      "This is a tactical counter-trend leg only. Exit before the primary HTF entry zone, then reassess for the main trend trade.",
    entry: price,
    stopLoss,
    targets,
    signalTime: sweep.time,
    trigger: "LIQUIDITY SWEEP REVERSAL",
    score,
    moveClass,
    reason:
      "Fresh 15m liquidity sweep + reclaim/reversal candle + tight invalidation + " +
      finalRr.toFixed(1) +
      "R available into the primary zone."
  };
}
