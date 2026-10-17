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

export type FibonacciLevel = {
  ratio: number;
  price: number;
  kind: "retracement" | "extension";
  label: string;
};

export type FibonacciSetup = {
  direction: "bullish" | "bearish" | "neutral";
  anchorA: SwingPoint | null;
  anchorB: SwingPoint | null;
  anchorC: SwingPoint | null;
  retracements: FibonacciLevel[];
  extensions: FibonacciLevel[];
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
      anchorC: null,
      retracements: [],
      extensions: [],
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
      anchorC: null,
      retracements: [],
      extensions: [],
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

  let anchorC: SwingPoint | null = null;

  if (swings.length >= 3) {
    const candidate = swings[swings.length - 3];

    if (
      direction === "bullish" &&
      candidate.type === "low" &&
      anchorA.type === "low"
    ) {
      // The newest confirmed high has no confirmed retracement low yet.
      anchorC = null;
    } else if (
      direction === "bearish" &&
      candidate.type === "high" &&
      anchorA.type === "high"
    ) {
      anchorC = null;
    }
  }

  // A proper three-point Trend Fib needs A→B→C. If the latest three swings
  // form low-high-low or high-low-high, use them for extensions.
  let extensionA = anchorA;
  let extensionB = anchorB;
  let extensionC: SwingPoint | null = null;

  if (swings.length >= 3) {
    const a = swings[swings.length - 3];
    const b = swings[swings.length - 2];
    const c = swings[swings.length - 1];

    const bullishThreePoint =
      a.type === "low" && b.type === "high" && c.type === "low";
    const bearishThreePoint =
      a.type === "high" && b.type === "low" && c.type === "high";

    if (bullishThreePoint || bearishThreePoint) {
      extensionA = a;
      extensionB = b;
      extensionC = c;
      direction = bullishThreePoint ? "bullish" : "bearish";
      anchorA = a;
      anchorB = b;
      anchorC = c;
    }
  }

  const extensions = extensionC
    ? EXTENSIONS.map((ratio) => ({
        ratio,
        price: priceForExtension(
          direction,
          extensionA.price,
          extensionB.price,
          extensionC.price,
          ratio
        ),
        kind: "extension" as const,
        label: `${ratio.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}x`
      }))
    : [];

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
    anchorC,
    retracements,
    extensions,
    goldenZone,
    recentSwings,
    atr14
  };
}
