import type {
  FibonacciSetup,
  ImbalanceLiquiditySnapshot,
  MarketStructureSnapshot,
  OrderBlockSnapshot
} from "./market-structure";
import type { VolumeAnalytics } from "./volume";

export type ReversalDirection = "bullish" | "bearish";

export type DerivativeConfirmationInput = {
  available: boolean;
  future?: {
    change?: number | null;
    oiChange?: number | null;
    oiChangePercent?: number | null;
  } | null;
  options?: {
    pcr?: number | null;
    callOiBuild?: Array<{ oiChange: number }>;
    putOiBuild?: Array<{ oiChange: number }>;
  } | null;
};

export type ScoreComponent = {
  key:
    | "structure"
    | "fib"
    | "smartMoney"
    | "vwapProfile"
    | "volume"
    | "derivatives"
    | "confirmation15m";
  label: string;
  points: number;
  maxPoints: number;
  available: boolean;
  detail: string;
};

export type ReversalTarget = {
  label: "T1" | "T2" | "T3" | "T4";
  price: number;
  source: string;
};

export type ReversalScore = {
  direction: ReversalDirection;
  score: number;
  rawPoints: number;
  availablePoints: number;
  classification: "Ignore" | "Weak" | "Watch" | "Strong" | "Exceptional";
  entryState: "WAIT" | "CONFIRMING" | "CONFIRMED";
  components: ScoreComponent[];
  reversalZone: { low: number; high: number } | null;
  invalidation: number | null;
  stopLoss: number | null;
  targets: ReversalTarget[];
};

export type ReversalEngineResult = {
  selected: ReversalScore;
  bullish: ReversalScore;
  bearish: ReversalScore;
};

export type ReversalEngineInput = {
  price: number;
  atr: number | null;
  htfReady: boolean;
  confirmation15mReady: boolean;
  fibonacci: FibonacciSetup;
  structure: MarketStructureSnapshot;
  imbalance: ImbalanceLiquiditySnapshot;
  orderBlocks: OrderBlockSnapshot;
  volume: VolumeAnalytics;
  confirmation15m: MarketStructureSnapshot;
  derivatives: DerivativeConfirmationInput | null;
};

const WEIGHTS = {
  structure: 20,
  fib: 20,
  smartMoney: 20,
  vwapProfile: 15,
  volume: 10,
  derivatives: 10,
  confirmation15m: 5
} as const;

function directionMatches(
  value: "bullish" | "bearish" | "neutral",
  direction: ReversalDirection
) {
  return value === direction;
}

function zoneDistance(
  price: number,
  low: number,
  high: number
): number {
  const lower = Math.min(low, high);
  const upper = Math.max(low, high);

  if (price >= lower && price <= upper) return 0;
  if (price < lower) return lower - price;
  return price - upper;
}

function proximityPoints(
  distance: number,
  atr: number,
  maxPoints: number
) {
  if (!(atr > 0)) return 0;
  const ratio = distance / atr;

  if (ratio <= 0.2) return maxPoints;
  if (ratio <= 0.5) return Math.round(maxPoints * 0.72);
  if (ratio <= 1) return Math.round(maxPoints * 0.4);
  return 0;
}

function classification(
  score: number
): ReversalScore["classification"] {
  if (score >= 85) return "Exceptional";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Watch";
  if (score >= 40) return "Weak";
  return "Ignore";
}

function scoreStructure(
  direction: ReversalDirection,
  structure: MarketStructureSnapshot,
  ready: boolean
): ScoreComponent {
  if (!ready) {
    return {
      key: "structure",
      label: "HTF structure",
      points: 0,
      maxPoints: WEIGHTS.structure,
      available: false,
      detail: "Higher-timeframe structure unavailable."
    };
  }

  let points = 0;
  const details: string[] = [];

  if (directionMatches(structure.trend, direction)) {
    points += 12;
    details.push(`${direction} structure trend`);
  }

  if (structure.latestEvent?.direction === direction) {
    points += structure.latestEvent.type === "CHoCH" ? 8 : 6;
    details.push(
      `${structure.latestEvent.type} ${direction}`
    );
  }

  return {
    key: "structure",
    label: "HTF structure",
    points: Math.min(WEIGHTS.structure, points),
    maxPoints: WEIGHTS.structure,
    available: true,
    detail: details.length
      ? details.join(" + ")
      : "No aligned HTF structure confirmation."
  };
}

function scoreFib(
  direction: ReversalDirection,
  price: number,
  atr: number,
  fibonacci: FibonacciSetup,
  ready: boolean
): ScoreComponent {
  if (!ready || !fibonacci.anchorA || !fibonacci.anchorB) {
    return {
      key: "fib",
      label: "Fib 61.8–78.6",
      points: 0,
      maxPoints: WEIGHTS.fib,
      available: false,
      detail: "Confirmed HTF swing anchors unavailable."
    };
  }

  if (
    fibonacci.direction !== direction ||
    !fibonacci.goldenZone
  ) {
    return {
      key: "fib",
      label: "Fib 61.8–78.6",
      points: 0,
      maxPoints: WEIGHTS.fib,
      available: true,
      detail: "Current impulse points the other way."
    };
  }

  const distance = zoneDistance(
    price,
    fibonacci.goldenZone.low,
    fibonacci.goldenZone.high
  );
  const points =
    distance === 0
      ? WEIGHTS.fib
      : proximityPoints(distance, atr, WEIGHTS.fib);

  return {
    key: "fib",
    label: "Fib 61.8–78.6",
    points,
    maxPoints: WEIGHTS.fib,
    available: true,
    detail:
      distance === 0
        ? "Price is inside the HTF golden zone."
        : points > 0
          ? `Price is ${(distance / Math.max(atr, 1e-9)).toFixed(2)} ATR from the golden zone.`
          : "Price is not near the HTF golden zone."
  };
}

function nearestDirectionalZone(
  direction: ReversalDirection,
  price: number,
  atr: number,
  zones: Array<{
    direction: "bullish" | "bearish";
    lower: number;
    upper: number;
  }>
) {
  const matches = zones.filter(
    (zone) => zone.direction === direction
  );

  if (!matches.length) return null;

  return matches
    .map((zone) => ({
      zone,
      distance: zoneDistance(price, zone.lower, zone.upper)
    }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function scoreSmartMoney(
  direction: ReversalDirection,
  price: number,
  atr: number,
  imbalance: ImbalanceLiquiditySnapshot,
  orderBlocks: OrderBlockSnapshot,
  ready: boolean
): ScoreComponent {
  if (!ready) {
    return {
      key: "smartMoney",
      label: "OB / FVG / liquidity",
      points: 0,
      maxPoints: WEIGHTS.smartMoney,
      available: false,
      detail: "HTF smart-money context unavailable."
    };
  }

  let points = 0;
  const detail: string[] = [];

  const nearestOb = nearestDirectionalZone(
    direction,
    price,
    atr,
    orderBlocks.activeBlocks
  );

  if (nearestOb) {
    const awarded = proximityPoints(
      nearestOb.distance,
      atr,
      7
    );
    points += awarded;
    if (awarded > 0) detail.push("Order Block");
  }

  const nearestFvg = nearestDirectionalZone(
    direction,
    price,
    atr,
    imbalance.activeFvgs
  );

  if (nearestFvg) {
    const awarded = proximityPoints(
      nearestFvg.distance,
      atr,
      6
    );
    points += awarded;
    if (awarded > 0) detail.push("FVG");
  }

  if (imbalance.latestSweep?.direction === direction) {
    points += 7;
    detail.push("liquidity sweep");
  }

  return {
    key: "smartMoney",
    label: "OB / FVG / liquidity",
    points: Math.min(WEIGHTS.smartMoney, points),
    maxPoints: WEIGHTS.smartMoney,
    available: true,
    detail: detail.length
      ? detail.join(" + ")
      : "No nearby aligned OB/FVG/sweep."
  };
}

function scoreVwapProfile(
  price: number,
  atr: number,
  volume: VolumeAnalytics
): ScoreComponent {
  if (!volume.available) {
    return {
      key: "vwapProfile",
      label: "VWAP / Volume Profile",
      points: 0,
      maxPoints: WEIGHTS.vwapProfile,
      available: false,
      detail: "Traded volume/VWAP unavailable."
    };
  }

  const levels = [
    volume.latestSessionVwap,
    volume.latestAnchoredVwap,
    volume.profile.poc,
    volume.profile.vah,
    volume.profile.val
  ].filter(
    (value): value is number =>
      value !== null && Number.isFinite(value)
  );

  if (!levels.length) {
    return {
      key: "vwapProfile",
      label: "VWAP / Volume Profile",
      points: 0,
      maxPoints: WEIGHTS.vwapProfile,
      available: true,
      detail: "No usable VWAP/profile level."
    };
  }

  const distance = Math.min(
    ...levels.map((level) => Math.abs(price - level))
  );
  const points = proximityPoints(
    distance,
    atr,
    WEIGHTS.vwapProfile
  );

  return {
    key: "vwapProfile",
    label: "VWAP / Volume Profile",
    points,
    maxPoints: WEIGHTS.vwapProfile,
    available: true,
    detail:
      points > 0
        ? `Price is ${(distance / Math.max(atr, 1e-9)).toFixed(2)} ATR from a VWAP/profile level.`
        : "No close VWAP/profile confluence."
  };
}

function scoreVolume(
  volume: VolumeAnalytics
): ScoreComponent {
  if (!volume.available || volume.volumeRatio20 === null) {
    return {
      key: "volume",
      label: "Volume behaviour",
      points: 0,
      maxPoints: WEIGHTS.volume,
      available: false,
      detail: "Comparable traded volume unavailable."
    };
  }

  const ratio = volume.volumeRatio20;
  const points =
    ratio >= 2
      ? 10
      : ratio >= 1.5
        ? 8
        : ratio >= 1.2
          ? 6
          : ratio >= 1
            ? 4
            : ratio >= 0.75
              ? 2
              : 0;

  return {
    key: "volume",
    label: "Volume behaviour",
    points,
    maxPoints: WEIGHTS.volume,
    available: true,
    detail: `Current candle volume is ${ratio.toFixed(2)}× its recent average.`
  };
}

function scoreDerivatives(
  direction: ReversalDirection,
  derivatives: DerivativeConfirmationInput | null
): ScoreComponent {
  if (!derivatives?.available) {
    return {
      key: "derivatives",
      label: "OI / ΔOI",
      points: 0,
      maxPoints: WEIGHTS.derivatives,
      available: false,
      detail: "Derivatives confirmation unavailable."
    };
  }

  let points = 0;
  const details: string[] = [];

  const futureChange = Number(
    derivatives.future?.change ?? 0
  );
  const futureOiChange = Number(
    derivatives.future?.oiChange ?? 0
  );

  if (futureOiChange !== 0 || futureChange !== 0) {
    if (direction === "bullish") {
      if (futureChange > 0 && futureOiChange > 0) {
        points += 5;
        details.push("futures long build");
      } else if (futureChange > 0 && futureOiChange < 0) {
        points += 4;
        details.push("futures short covering");
      }
    } else {
      if (futureChange < 0 && futureOiChange > 0) {
        points += 5;
        details.push("futures short build");
      } else if (futureChange < 0 && futureOiChange < 0) {
        points += 4;
        details.push("futures long unwinding");
      }
    }
  }

  const callBuild = (
    derivatives.options?.callOiBuild ?? []
  ).reduce(
    (sum, leg) => sum + Math.max(0, Number(leg.oiChange ?? 0)),
    0
  );
  const putBuild = (
    derivatives.options?.putOiBuild ?? []
  ).reduce(
    (sum, leg) => sum + Math.max(0, Number(leg.oiChange ?? 0)),
    0
  );
  const pcr = derivatives.options?.pcr ?? null;

  if (direction === "bullish") {
    if (putBuild > callBuild && putBuild > 0) {
      points += 3;
      details.push("put OI build");
    }
    if (pcr !== null && pcr >= 1) {
      points += 2;
      details.push(`PCR ${pcr.toFixed(2)}`);
    }
  } else {
    if (callBuild > putBuild && callBuild > 0) {
      points += 3;
      details.push("call OI build");
    }
    if (pcr !== null && pcr <= 0.9) {
      points += 2;
      details.push(`PCR ${pcr.toFixed(2)}`);
    }
  }

  return {
    key: "derivatives",
    label: "OI / ΔOI",
    points: Math.min(WEIGHTS.derivatives, points),
    maxPoints: WEIGHTS.derivatives,
    available: true,
    detail: details.length
      ? details.join(" + ")
      : "Derivatives are available but not directionally aligned."
  };
}

function score15mConfirmation(
  direction: ReversalDirection,
  structure: MarketStructureSnapshot,
  ready: boolean
): ScoreComponent {
  if (!ready) {
    return {
      key: "confirmation15m",
      label: "15m confirmation",
      points: 0,
      maxPoints: WEIGHTS.confirmation15m,
      available: false,
      detail: "15-minute structure unavailable."
    };
  }

  if (structure.latestEvent?.direction === direction) {
    return {
      key: "confirmation15m",
      label: "15m confirmation",
      points:
        structure.latestEvent.type === "CHoCH" ? 5 : 4,
      maxPoints: WEIGHTS.confirmation15m,
      available: true,
      detail: `${structure.latestEvent.type} ${direction} on 15m.`
    };
  }

  if (structure.trend === direction) {
    return {
      key: "confirmation15m",
      label: "15m confirmation",
      points: 2,
      maxPoints: WEIGHTS.confirmation15m,
      available: true,
      detail: `15m structure is ${direction}, but no fresh aligned break.`
    };
  }

  return {
    key: "confirmation15m",
    label: "15m confirmation",
    points: 0,
    maxPoints: WEIGHTS.confirmation15m,
    available: true,
    detail: "No aligned 15m BOS/CHoCH."
  };
}

function buildTargets(
  direction: ReversalDirection,
  price: number,
  fibonacci: FibonacciSetup,
  structure: MarketStructureSnapshot
): ReversalTarget[] {
  const raw: ReversalTarget[] = [];

  const structureTarget =
    direction === "bullish"
      ? structure.activeSwingHigh?.price
      : structure.activeSwingLow?.price;

  if (
    structureTarget !== undefined &&
    (direction === "bullish"
      ? structureTarget > price
      : structureTarget < price)
  ) {
    raw.push({
      label: "T1",
      price: structureTarget,
      source: "Nearest confirmed structure"
    });
  }

  if (
    fibonacci.anchorB &&
    (direction === "bullish"
      ? fibonacci.anchorB.price > price
      : fibonacci.anchorB.price < price)
  ) {
    raw.push({
      label: raw.length ? "T2" : "T1",
      price: fibonacci.anchorB.price,
      source: "Original swing extreme"
    });
  }

  if (
    fibonacci.trendExtension?.direction === direction
  ) {
    const ext1272 = fibonacci.trendExtension.levels.find(
      (level) => level.ratio === 1.272
    );
    const ext1618 = fibonacci.trendExtension.levels.find(
      (level) => level.ratio === 1.618
    );

    if (
      ext1272 &&
      (direction === "bullish"
        ? ext1272.price > price
        : ext1272.price < price)
    ) {
      raw.push({
        label: raw.length >= 2 ? "T3" : raw.length ? "T2" : "T1",
        price: ext1272.price,
        source: "Trend Fib 1.272"
      });
    }

    if (
      ext1618 &&
      (direction === "bullish"
        ? ext1618.price > price
        : ext1618.price < price)
    ) {
      raw.push({
        label:
          raw.length >= 3
            ? "T4"
            : raw.length === 2
              ? "T3"
              : raw.length
                ? "T2"
                : "T1",
        price: ext1618.price,
        source: "Trend Fib 1.618"
      });
    }
  }

  const unique: ReversalTarget[] = [];
  const seen = new Set<string>();

  for (const target of raw) {
    const key = target.price.toFixed(8);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }

  return unique.slice(0, 4).map((target, index) => ({
    ...target,
    label: (["T1", "T2", "T3", "T4"] as const)[index]
  }));
}

function invalidationAndStop(
  direction: ReversalDirection,
  price: number,
  atr: number,
  fibonacci: FibonacciSetup,
  structure: MarketStructureSnapshot,
  imbalance: ImbalanceLiquiditySnapshot
) {
  const candidates: number[] = [];

  if (direction === "bullish") {
    if (
      structure.activeSwingLow &&
      structure.activeSwingLow.price < price
    ) {
      candidates.push(structure.activeSwingLow.price);
    }
    if (fibonacci.anchorA && fibonacci.anchorA.price < price) {
      candidates.push(fibonacci.anchorA.price);
    }
    if (
      imbalance.latestSweep?.direction === "bullish" &&
      imbalance.latestSweep.extreme < price
    ) {
      candidates.push(imbalance.latestSweep.extreme);
    }

    const invalidation = candidates.length
      ? Math.max(...candidates)
      : null;

    return {
      invalidation,
      stopLoss:
        invalidation !== null && atr > 0
          ? invalidation - atr * 0.25
          : null
    };
  }

  if (
    structure.activeSwingHigh &&
    structure.activeSwingHigh.price > price
  ) {
    candidates.push(structure.activeSwingHigh.price);
  }
  if (fibonacci.anchorA && fibonacci.anchorA.price > price) {
    candidates.push(fibonacci.anchorA.price);
  }
  if (
    imbalance.latestSweep?.direction === "bearish" &&
    imbalance.latestSweep.extreme > price
  ) {
    candidates.push(imbalance.latestSweep.extreme);
  }

  const invalidation = candidates.length
    ? Math.min(...candidates)
    : null;

  return {
    invalidation,
    stopLoss:
      invalidation !== null && atr > 0
        ? invalidation + atr * 0.25
        : null
  };
}

function scoreDirection(
  direction: ReversalDirection,
  input: ReversalEngineInput
): ReversalScore {
  const atr = input.atr ?? input.fibonacci.atr14 ?? 0;

  const components = [
    scoreStructure(direction, input.structure, input.htfReady),
    scoreFib(
      direction,
      input.price,
      atr,
      input.fibonacci,
      input.htfReady
    ),
    scoreSmartMoney(
      direction,
      input.price,
      atr,
      input.imbalance,
      input.orderBlocks,
      input.htfReady
    ),
    scoreVwapProfile(input.price, atr, input.volume),
    scoreVolume(input.volume),
    scoreDerivatives(direction, input.derivatives),
    score15mConfirmation(
      direction,
      input.confirmation15m,
      input.confirmation15mReady
    )
  ];

  const available = components.filter(
    (component) => component.available
  );
  const rawPoints = available.reduce(
    (sum, component) => sum + component.points,
    0
  );
  const availablePoints = available.reduce(
    (sum, component) => sum + component.maxPoints,
    0
  );
  const score =
    availablePoints > 0
      ? Math.round((rawPoints / availablePoints) * 100)
      : 0;

  const confirmation = components.find(
    (component) => component.key === "confirmation15m"
  );
  const confirmed15m =
    confirmation?.available &&
    (confirmation.points >= 4);

  const entryState: ReversalScore["entryState"] =
    score >= 75 && confirmed15m
      ? "CONFIRMED"
      : score >= 60
        ? "CONFIRMING"
        : "WAIT";

  const risk = invalidationAndStop(
    direction,
    input.price,
    atr,
    input.fibonacci,
    input.structure,
    input.imbalance
  );

  return {
    direction,
    score,
    rawPoints,
    availablePoints,
    classification: classification(score),
    entryState,
    components,
    reversalZone:
      input.fibonacci.direction === direction
        ? input.fibonacci.goldenZone
        : null,
    invalidation: risk.invalidation,
    stopLoss: risk.stopLoss,
    targets: buildTargets(
      direction,
      input.price,
      input.fibonacci,
      input.structure
    )
  };
}

export function buildReversalEngine(
  input: ReversalEngineInput
): ReversalEngineResult {
  const bullish = scoreDirection("bullish", input);
  const bearish = scoreDirection("bearish", input);

  let selected: ReversalScore;

  if (bullish.score > bearish.score) {
    selected = bullish;
  } else if (bearish.score > bullish.score) {
    selected = bearish;
  } else if (input.fibonacci.direction === "bullish") {
    selected = bullish;
  } else if (input.fibonacci.direction === "bearish") {
    selected = bearish;
  } else if (input.structure.trend === "bullish") {
    selected = bullish;
  } else {
    selected = bearish;
  }

  return {
    selected,
    bullish,
    bearish
  };
}
