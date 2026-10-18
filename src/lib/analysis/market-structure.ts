export type AnalysisCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type SwingPoint = {
  index: number;
  time: number;
  price: number;
  type: "high" | "low";
  confirmed: boolean;
};

export type StructureEvent = {
  type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  time: number;
  close: number;
  brokenLevel: number;
  sourceSwing: SwingPoint;
};

export type MarketStructureSnapshot = {
  trend: "bullish" | "bearish" | "neutral";
  latestEvent: StructureEvent | null;
  events: StructureEvent[];
  recentEvents: StructureEvent[];
  activeSwingHigh: SwingPoint | null;
  activeSwingLow: SwingPoint | null;
};

export type FairValueGap = {
  direction: "bullish" | "bearish";
  createdTime: number;
  createdIndex: number;
  lower: number;
  upper: number;
  midpoint: number;
  size: number;
  status: "active" | "touched" | "filled";
  firstTouchTime: number | null;
  filledTime: number | null;
};

export type LiquiditySweep = {
  direction: "bullish" | "bearish";
  time: number;
  level: number;
  extreme: number;
  close: number;
  sourceSwing: SwingPoint;
};

export type LiquidityLevel = {
  side: "buy" | "sell";
  importance: "minor" | "major";
  level: number;
  zoneLower: number;
  zoneUpper: number;
  sourceSwing: SwingPoint;
  confirmedTime: number;
  sweptTime: number | null;
  status: "virgin" | "swept";
};

export type ImbalanceLiquiditySnapshot = {
  recentFvgs: FairValueGap[];
  activeFvgs: FairValueGap[];
  recentSweeps: LiquiditySweep[];
  latestSweep: LiquiditySweep | null;
  liquidityLevels: LiquidityLevel[];
};

export type OrderBlock = {
  direction: "bullish" | "bearish";
  sourceTime: number;
  createdByEventTime: number;
  createdByEventType: "BOS" | "CHoCH";
  lower: number;
  upper: number;
  midpoint: number;
  status: "active" | "touched" | "invalidated";
  firstTouchTime: number | null;
  invalidatedTime: number | null;
};

export type OrderBlockSnapshot = {
  recentBlocks: OrderBlock[];
  activeBlocks: OrderBlock[];
};

export type FibonacciLevel = {
  ratio: number;
  price: number;
  kind: "retracement" | "extension";
  label: string;
};

export type TrendExtensionSetup = {
  direction: "bullish" | "bearish";
  anchorA: SwingPoint;
  anchorB: SwingPoint;
  anchorC: SwingPoint;
  levels: FibonacciLevel[];
};

export type FibonacciSetup = {
  direction: "bullish" | "bearish" | "neutral";
  anchorA: SwingPoint | null;
  anchorB: SwingPoint | null;
  retracements: FibonacciLevel[];
  trendExtension: TrendExtensionSetup | null;
  goldenZone: {
    low: number;
    high: number;
  } | null;
  recentSwings: SwingPoint[];
  atr14: number | null;
};

const RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 0.886];
const EXTENSIONS = [0.618, 1, 1.272, 1.618, 2, 2.618];

function trueRange(
  candle: AnalysisCandle,
  previousClose: number | null
): number {
  if (previousClose === null) {
    return candle.high - candle.low;
  }

  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose)
  );
}

export function calculateAtr(
  candles: AnalysisCandle[],
  period = 14
): number | null {
  if (candles.length < period + 1) return null;

  const ranges: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    ranges.push(trueRange(candles[i], candles[i - 1].close));
  }

  if (ranges.length < period) return null;

  let atr =
    ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  for (let i = period; i < ranges.length; i += 1) {
    atr = (atr * (period - 1) + ranges[i]) / period;
  }

  return atr;
}

function isPivotHigh(
  candles: AnalysisCandle[],
  index: number,
  left: number,
  right: number
) {
  const value = candles[index].high;

  for (let i = index - left; i <= index + right; i += 1) {
    if (i === index) continue;
    if (candles[i].high > value) return false;
  }

  return true;
}

function isPivotLow(
  candles: AnalysisCandle[],
  index: number,
  left: number,
  right: number
) {
  const value = candles[index].low;

  for (let i = index - left; i <= index + right; i += 1) {
    if (i === index) continue;
    if (candles[i].low < value) return false;
  }

  return true;
}

function mergeSameType(
  previous: SwingPoint,
  next: SwingPoint
): SwingPoint {
  if (previous.type === "high") {
    return next.price >= previous.price ? next : previous;
  }

  return next.price <= previous.price ? next : previous;
}

export function detectSwings(
  candles: AnalysisCandle[],
  options?: {
    leftBars?: number;
    rightBars?: number;
    atrMultiplier?: number;
  }
): SwingPoint[] {
  if (candles.length < 10) return [];

  const leftBars = Math.max(2, options?.leftBars ?? 3);
  const rightBars = Math.max(2, options?.rightBars ?? 3);
  const atrMultiplier = Math.max(0.25, options?.atrMultiplier ?? 0.75);
  const atr = calculateAtr(candles) ?? 0;
  const latestClose = candles[candles.length - 1].close;
  const relativeNoiseFloor = Math.max(latestClose * 0.0015, atr * atrMultiplier);

  const raw: SwingPoint[] = [];

  for (
    let index = leftBars;
    index < candles.length - rightBars;
    index += 1
  ) {
    const high = isPivotHigh(candles, index, leftBars, rightBars);
    const low = isPivotLow(candles, index, leftBars, rightBars);

    if (high) {
      raw.push({
        index,
        time: candles[index].time,
        price: candles[index].high,
        type: "high",
        confirmed: true
      });
    }

    if (low) {
      raw.push({
        index,
        time: candles[index].time,
        price: candles[index].low,
        type: "low",
        confirmed: true
      });
    }
  }

  raw.sort((a, b) => a.index - b.index || (a.type === "low" ? -1 : 1));

  const alternating: SwingPoint[] = [];

  for (const candidate of raw) {
    const previous = alternating[alternating.length - 1];

    if (!previous) {
      alternating.push(candidate);
      continue;
    }

    if (previous.type === candidate.type) {
      alternating[alternating.length - 1] = mergeSameType(
        previous,
        candidate
      );
      continue;
    }

    const move = Math.abs(candidate.price - previous.price);

    if (move < relativeNoiseFloor) {
      continue;
    }

    alternating.push(candidate);
  }

  return alternating;
}


export function buildMarketStructure(
  candles: AnalysisCandle[],
  options?: {
    confirmationBars?: number;
    maxEvents?: number;
  }
): MarketStructureSnapshot {
  const confirmationBars = Math.max(2, options?.confirmationBars ?? 3);
  const maxEvents = Math.max(1, options?.maxEvents ?? 12);
  const recentCandles = candles;

  const swings = detectSwings(recentCandles, {
    rightBars: confirmationBars
  });

  let trend: MarketStructureSnapshot["trend"] = "neutral";
  let activeSwingHigh: SwingPoint | null = null;
  let activeSwingLow: SwingPoint | null = null;
  let brokenHighTime: number | null = null;
  let brokenLowTime: number | null = null;
  const events: StructureEvent[] = [];

  let swingCursor = 0;

  for (let index = 0; index < recentCandles.length; index += 1) {
    while (
      swingCursor < swings.length &&
      swings[swingCursor].index + confirmationBars <= index
    ) {
      const swing = swings[swingCursor];

      if (swing.type === "high") {
        activeSwingHigh = swing;
        brokenHighTime = null;
      } else {
        activeSwingLow = swing;
        brokenLowTime = null;
      }

      swingCursor += 1;
    }

    const candle = recentCandles[index];

    if (
      activeSwingHigh &&
      brokenHighTime !== activeSwingHigh.time &&
      candle.close > activeSwingHigh.price
    ) {
      const event: StructureEvent = {
        type: trend === "bearish" ? "CHoCH" : "BOS",
        direction: "bullish",
        time: candle.time,
        close: candle.close,
        brokenLevel: activeSwingHigh.price,
        sourceSwing: activeSwingHigh
      };

      events.push(event);
      brokenHighTime = activeSwingHigh.time;
      trend = "bullish";
    }

    if (
      activeSwingLow &&
      brokenLowTime !== activeSwingLow.time &&
      candle.close < activeSwingLow.price
    ) {
      const event: StructureEvent = {
        type: trend === "bullish" ? "CHoCH" : "BOS",
        direction: "bearish",
        time: candle.time,
        close: candle.close,
        brokenLevel: activeSwingLow.price,
        sourceSwing: activeSwingLow
      };

      events.push(event);
      brokenLowTime = activeSwingLow.time;
      trend = "bearish";
    }
  }

  const recentEvents = events.slice(-maxEvents);

  return {
    trend,
    latestEvent: events[events.length - 1] ?? null,
    events,
    recentEvents,
    activeSwingHigh,
    activeSwingLow
  };
}


export function detectFairValueGaps(
  candles: AnalysisCandle[],
  options?: {
    maxRecent?: number;
    minAtrFraction?: number;
  }
): FairValueGap[] {
  if (candles.length < 3) return [];

  const maxRecent =
    options?.maxRecent === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(1, options.maxRecent);
  const minAtrFraction = Math.max(0, options?.minAtrFraction ?? 0.05);
  const recentCandles = candles;
  const atr = calculateAtr(recentCandles) ?? 0;
  const latestClose = recentCandles[recentCandles.length - 1].close;
  const minimumGap = Math.max(
    latestClose * 0.0002,
    atr * minAtrFraction
  );

  const gaps: FairValueGap[] = [];

  for (let index = 2; index < recentCandles.length; index += 1) {
    const first = recentCandles[index - 2];
    const third = recentCandles[index];

    const bullishSize = third.low - first.high;
    const bearishSize = first.low - third.high;

    let gap: FairValueGap | null = null;

    if (bullishSize >= minimumGap) {
      gap = {
        direction: "bullish",
        createdTime: third.time,
        createdIndex: index,
        lower: first.high,
        upper: third.low,
        midpoint: (first.high + third.low) / 2,
        size: bullishSize,
        status: "active",
        firstTouchTime: null,
        filledTime: null
      };
    } else if (bearishSize >= minimumGap) {
      gap = {
        direction: "bearish",
        createdTime: third.time,
        createdIndex: index,
        lower: third.high,
        upper: first.low,
        midpoint: (third.high + first.low) / 2,
        size: bearishSize,
        status: "active",
        firstTouchTime: null,
        filledTime: null
      };
    }

    if (!gap) continue;

    for (
      let futureIndex = index + 1;
      futureIndex < recentCandles.length;
      futureIndex += 1
    ) {
      const future = recentCandles[futureIndex];

      if (gap.direction === "bullish") {
        if (
          gap.firstTouchTime === null &&
          future.low <= gap.upper
        ) {
          gap.status = "touched";
          gap.firstTouchTime = future.time;
        }

        if (future.low <= gap.lower) {
          gap.status = "filled";
          gap.filledTime = future.time;
          break;
        }
      } else {
        if (
          gap.firstTouchTime === null &&
          future.high >= gap.lower
        ) {
          gap.status = "touched";
          gap.firstTouchTime = future.time;
        }

        if (future.high >= gap.upper) {
          gap.status = "filled";
          gap.filledTime = future.time;
          break;
        }
      }
    }

    gaps.push(gap);
  }

  return Number.isFinite(maxRecent)
    ? gaps.slice(-maxRecent)
    : gaps;
}

export function detectLiquidityLevels(
  candles: AnalysisCandle[]
): LiquidityLevel[] {
  if (candles.length < 20) return [];

  const definitions = [
    {
      importance: "minor" as const,
      leftBars: 2,
      rightBars: 2,
      atrMultiplier: 0.35,
      zoneAtrFraction: 0.06
    },
    {
      importance: "major" as const,
      leftBars: 6,
      rightBars: 6,
      atrMultiplier: 1,
      zoneAtrFraction: 0.12
    }
  ];

  type Candidate = LiquidityLevel & {
    confirmationIndex: number;
    sweptIndex: number | null;
  };

  const chooseStickyActive = (
    candidates: Candidate[]
  ): Candidate | null => {
    const ordered = candidates
      .slice()
      .sort(
        (a, b) =>
          a.confirmationIndex - b.confirmationIndex ||
          a.sourceSwing.time - b.sourceSwing.time
      );

    let active: Candidate | null = null;

    for (let index = 0; index < candles.length; index += 1) {
      if (
        active &&
        active.sweptIndex !== null &&
        active.sweptIndex <= index
      ) {
        active = null;
      }

      if (active) continue;

      const available = ordered
        .filter(
          (candidate) =>
            candidate.confirmationIndex <= index &&
            (candidate.sweptIndex === null ||
              candidate.sweptIndex > index)
        )
        .sort(
          (a, b) =>
            b.confirmationIndex - a.confirmationIndex ||
            b.sourceSwing.time - a.sourceSwing.time
        );

      active = available[0] ?? null;
    }

    return active;
  };

  const selected: LiquidityLevel[] = [];

  for (const definition of definitions) {
    const swings = detectSwings(candles, {
      leftBars: definition.leftBars,
      rightBars: definition.rightBars,
      atrMultiplier: definition.atrMultiplier
    });

    for (const side of ["buy", "sell"] as const) {
      const candidates: Candidate[] = swings
        .filter((swing) =>
          side === "buy" ? swing.type === "high" : swing.type === "low"
        )
        .map((swing) => {
          const confirmationIndex = Math.min(
            candles.length - 1,
            swing.index + definition.rightBars
          );
          const localStart = Math.max(0, swing.index - 20);
          const localEnd = Math.min(candles.length, swing.index + 21);
          const localAtr =
            calculateAtr(candles.slice(localStart, localEnd)) ??
            calculateAtr(candles) ??
            0;
          const zoneHalfWidth = Math.max(
            swing.price * 0.00005,
            localAtr * definition.zoneAtrFraction
          );
          const zoneLower = swing.price - zoneHalfWidth;
          const zoneUpper = swing.price + zoneHalfWidth;
          let sweptIndex: number | null = null;

          for (
            let index = confirmationIndex + 1;
            index < candles.length;
            index += 1
          ) {
            const candle = candles[index];
            const swept =
              side === "buy"
                ? candle.high >= zoneUpper
                : candle.low <= zoneLower;

            if (swept) {
              sweptIndex = index;
              break;
            }
          }

          return {
            side,
            importance: definition.importance,
            level: swing.price,
            zoneLower,
            zoneUpper,
            sourceSwing: swing,
            confirmedTime: candles[confirmationIndex].time,
            sweptTime:
              sweptIndex === null ? null : candles[sweptIndex].time,
            status: sweptIndex === null ? "virgin" : "swept",
            confirmationIndex,
            sweptIndex
          };
        });

      const active = chooseStickyActive(candidates);

      if (active) {
        selected.push({
          side: active.side,
          importance: active.importance,
          level: active.level,
          zoneLower: active.zoneLower,
          zoneUpper: active.zoneUpper,
          sourceSwing: active.sourceSwing,
          confirmedTime: active.confirmedTime,
          sweptTime: active.sweptTime,
          status: active.status
        });
      }
    }
  }

  return selected;
}

export function detectLiquiditySweeps(
  candles: AnalysisCandle[],
  options?: {
    confirmationBars?: number;
    maxRecent?: number;
  }
): LiquiditySweep[] {
  if (candles.length < 10) return [];

  const confirmationBars = Math.max(
    2,
    options?.confirmationBars ?? 3
  );
  const maxRecent = Math.max(1, options?.maxRecent ?? 12);
  const recentCandles =
    candles.length > 1200 ? candles.slice(-1200) : candles;
  const swings = detectSwings(recentCandles, {
    rightBars: confirmationBars
  });
  const atr = calculateAtr(recentCandles) ?? 0;
  const latestClose = recentCandles[recentCandles.length - 1].close;
  const minimumOvershoot = Math.max(
    latestClose * 0.00005,
    atr * 0.02
  );

  let activeSwingHigh: SwingPoint | null = null;
  let activeSwingLow: SwingPoint | null = null;
  let sweptHighTime: number | null = null;
  let sweptLowTime: number | null = null;
  let swingCursor = 0;
  const sweeps: LiquiditySweep[] = [];

  for (let index = 0; index < recentCandles.length; index += 1) {
    while (
      swingCursor < swings.length &&
      swings[swingCursor].index + confirmationBars <= index
    ) {
      const swing = swings[swingCursor];

      if (swing.type === "high") {
        activeSwingHigh = swing;
        sweptHighTime = null;
      } else {
        activeSwingLow = swing;
        sweptLowTime = null;
      }

      swingCursor += 1;
    }

    const candle = recentCandles[index];

    if (
      activeSwingHigh &&
      sweptHighTime !== activeSwingHigh.time &&
      candle.high >= activeSwingHigh.price + minimumOvershoot &&
      candle.close < activeSwingHigh.price
    ) {
      sweeps.push({
        direction: "bearish",
        time: candle.time,
        level: activeSwingHigh.price,
        extreme: candle.high,
        close: candle.close,
        sourceSwing: activeSwingHigh
      });
      sweptHighTime = activeSwingHigh.time;
    }

    if (
      activeSwingLow &&
      sweptLowTime !== activeSwingLow.time &&
      candle.low <= activeSwingLow.price - minimumOvershoot &&
      candle.close > activeSwingLow.price
    ) {
      sweeps.push({
        direction: "bullish",
        time: candle.time,
        level: activeSwingLow.price,
        extreme: candle.low,
        close: candle.close,
        sourceSwing: activeSwingLow
      });
      sweptLowTime = activeSwingLow.time;
    }
  }

  return sweeps.slice(-maxRecent);
}

export function buildImbalanceLiquiditySnapshot(
  candles: AnalysisCandle[]
): ImbalanceLiquiditySnapshot {
  const recentFvgs = detectFairValueGaps(candles);
  const recentSweeps = detectLiquiditySweeps(candles);
  const liquidityLevels = detectLiquidityLevels(candles);

  return {
    recentFvgs,
    activeFvgs: recentFvgs
      .filter((gap) => gap.status !== "filled")
      .slice(-6),
    recentSweeps,
    latestSweep: recentSweeps[recentSweeps.length - 1] ?? null,
    liquidityLevels
  };
}


export function detectOrderBlocks(
  candles: AnalysisCandle[],
  options?: {
    maxLookbackBars?: number;
    maxRecent?: number;
    displacementAtr?: number;
  }
): OrderBlock[] {
  if (candles.length < 20) return [];

  const maxLookbackBars = Math.max(3, options?.maxLookbackBars ?? 12);
  const maxRecent = Math.max(1, options?.maxRecent ?? 16);
  const displacementAtr = Math.max(
    0.1,
    options?.displacementAtr ?? 0.5
  );

  const recentCandles =
    candles.length > 1200 ? candles.slice(-1200) : candles;
  const structure = buildMarketStructure(recentCandles, {
    maxEvents: 40
  });
  const atr = calculateAtr(recentCandles) ?? 0;
  const blocks = new Map<string, OrderBlock>();

  for (const event of structure.recentEvents) {
    const eventIndex = recentCandles.findIndex(
      (candle) => candle.time === event.time
    );

    if (eventIndex < 1) continue;

    const eventCandle = recentCandles[eventIndex];
    const eventBody = Math.abs(
      eventCandle.close - eventCandle.open
    );
    const breakDistance = Math.abs(
      eventCandle.close - event.brokenLevel
    );

    if (
      atr > 0 &&
      eventBody < atr * displacementAtr &&
      breakDistance < atr * 0.2
    ) {
      continue;
    }

    const earliest = Math.max(
      0,
      eventIndex - maxLookbackBars
    );
    let sourceIndex = -1;

    for (
      let index = eventIndex - 1;
      index >= earliest;
      index -= 1
    ) {
      const candle = recentCandles[index];
      const oppositeCandle =
        event.direction === "bullish"
          ? candle.close < candle.open
          : candle.close > candle.open;

      if (oppositeCandle) {
        sourceIndex = index;
        break;
      }
    }

    if (sourceIndex < 0) continue;

    const source = recentCandles[sourceIndex];
    const block: OrderBlock = {
      direction: event.direction,
      sourceTime: source.time,
      createdByEventTime: event.time,
      createdByEventType: event.type,
      lower: source.low,
      upper: source.high,
      midpoint: (source.low + source.high) / 2,
      status: "active",
      firstTouchTime: null,
      invalidatedTime: null
    };

    for (
      let futureIndex = eventIndex + 1;
      futureIndex < recentCandles.length;
      futureIndex += 1
    ) {
      const future = recentCandles[futureIndex];
      const intersects =
        future.high >= block.lower &&
        future.low <= block.upper;

      if (intersects && block.firstTouchTime === null) {
        block.status = "touched";
        block.firstTouchTime = future.time;
      }

      const invalidated =
        block.direction === "bullish"
          ? future.close < block.lower
          : future.close > block.upper;

      if (invalidated) {
        block.status = "invalidated";
        block.invalidatedTime = future.time;
        break;
      }
    }

    const key = `${block.direction}-${block.sourceTime}`;
    blocks.set(key, block);
  }

  return [...blocks.values()]
    .sort((a, b) => a.createdByEventTime - b.createdByEventTime)
    .slice(-maxRecent);
}

export function buildOrderBlockSnapshot(
  candles: AnalysisCandle[]
): OrderBlockSnapshot {
  const recentBlocks = detectOrderBlocks(candles);

  return {
    recentBlocks,
    activeBlocks: recentBlocks
      .filter((block) => block.status !== "invalidated")
      .slice(-6)
  };
}

function priceForRetracement(
  direction: "bullish" | "bearish",
  a: number,
  b: number,
  ratio: number
) {
  const distance = Math.abs(b - a);
  return direction === "bullish"
    ? b - distance * ratio
    : b + distance * ratio;
}

function priceForExtension(
  direction: "bullish" | "bearish",
  a: number,
  b: number,
  c: number,
  ratio: number
) {
  const distance = Math.abs(b - a);
  return direction === "bullish"
    ? c + distance * ratio
    : c - distance * ratio;
}

export function buildFibonacciSetup(
  candles: AnalysisCandle[]
): FibonacciSetup {
  const recentCandles =
    candles.length > 1200 ? candles.slice(-1200) : candles;

  const swings = detectSwings(recentCandles);
  const recentSwings = swings.slice(-8);
  const atr14 = calculateAtr(recentCandles);

  if (swings.length < 2) {
    return {
      direction: "neutral",
      anchorA: null,
      anchorB: null,
      retracements: [],
      trendExtension: null,
      goldenZone: null,
      recentSwings,
      atr14
    };
  }

  const last = swings[swings.length - 1];
  const previous = swings[swings.length - 2];

  let direction: "bullish" | "bearish";
  let anchorA: SwingPoint;
  let anchorB: SwingPoint;

  if (previous.type === "low" && last.type === "high") {
    direction = "bullish";
    anchorA = previous;
    anchorB = last;
  } else if (previous.type === "high" && last.type === "low") {
    direction = "bearish";
    anchorA = previous;
    anchorB = last;
  } else {
    return {
      direction: "neutral",
      anchorA: null,
      anchorB: null,
      retracements: [],
      trendExtension: null,
      goldenZone: null,
      recentSwings,
      atr14
    };
  }

  const retracements = RETRACEMENTS.map((ratio) => ({
    ratio,
    price: priceForRetracement(
      direction,
      anchorA.price,
      anchorB.price,
      ratio
    ),
    kind: "retracement" as const,
    label: `${(ratio * 100).toFixed(1)}%`
  }));

  let trendExtension: TrendExtensionSetup | null = null;

  // A proper Trend Fib uses A→B→C:
  // bullish = low→high→higher/confirmed low
  // bearish = high→low→lower/confirmed high.
  if (swings.length >= 3) {
    const a = swings[swings.length - 3];
    const b = swings[swings.length - 2];
    const cPoint = swings[swings.length - 1];

    const bullishThreePoint =
      a.type === "low" && b.type === "high" && cPoint.type === "low";
    const bearishThreePoint =
      a.type === "high" && b.type === "low" && cPoint.type === "high";

    if (bullishThreePoint || bearishThreePoint) {
      const extensionDirection = bullishThreePoint ? "bullish" : "bearish";

      trendExtension = {
        direction: extensionDirection,
        anchorA: a,
        anchorB: b,
        anchorC: cPoint,
        levels: EXTENSIONS.map((ratio) => ({
          ratio,
          price: priceForExtension(
            extensionDirection,
            a.price,
            b.price,
            cPoint.price,
            ratio
          ),
          kind: "extension" as const,
          label: `${ratio
            .toFixed(3)
            .replace(/0+$/, "")
            .replace(/\.$/, "")}x`
        }))
      };
    }
  }

  const zone618 = retracements.find((level) => level.ratio === 0.618);
  const zone786 = retracements.find((level) => level.ratio === 0.786);

  const goldenZone =
    zone618 && zone786
      ? {
          low: Math.min(zone618.price, zone786.price),
          high: Math.max(zone618.price, zone786.price)
        }
      : null;

  return {
    direction,
    anchorA,
    anchorB,
    retracements,
    trendExtension,
    goldenZone,
    recentSwings,
    atr14
  };
}
