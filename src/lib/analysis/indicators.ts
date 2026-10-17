import type { AnalysisCandle } from "./market-structure";

export type IndicatorPoint = {
  time: number;
  value: number;
};

export type TechnicalContext = {
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  ema200: IndicatorPoint[];
  latestEma20: number | null;
  latestEma50: number | null;
  latestEma200: number | null;
  rsi14: number | null;
  atr14: number | null;
  atrPercent: number | null;
  adx14: number | null;
  trendState:
    | "strong_bullish"
    | "bullish"
    | "neutral"
    | "bearish"
    | "strong_bearish";
  volatilityState: "low" | "normal" | "high";
};

function emaSeries(
  candles: AnalysisCandle[],
  period: number
): IndicatorPoint[] {
  if (candles.length < period) return [];

  const alpha = 2 / (period + 1);
  const seed =
    candles
      .slice(0, period)
      .reduce((sum, candle) => sum + candle.close, 0) / period;

  const points: IndicatorPoint[] = [
    {
      time: candles[period - 1].time,
      value: seed
    }
  ];

  let previous = seed;

  for (let index = period; index < candles.length; index += 1) {
    const value =
      candles[index].close * alpha + previous * (1 - alpha);
    points.push({
      time: candles[index].time,
      value
    });
    previous = value;
  }

  return points;
}

function rsi(
  candles: AnalysisCandle[],
  period = 14
): number | null {
  if (candles.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let index = period + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    averageGain =
      (averageGain * (period - 1) + gain) / period;
    averageLoss =
      (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) return 100;

  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

function atr(
  candles: AnalysisCandle[],
  period = 14
): number | null {
  if (candles.length <= period) return null;

  const ranges: number[] = [];

  for (let index = 1; index < candles.length; index += 1) {
    const previousClose = candles[index - 1].close;
    const candle = candles[index];

    ranges.push(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose)
      )
    );
  }

  let value =
    ranges.slice(0, period).reduce((sum, item) => sum + item, 0) /
    period;

  for (let index = period; index < ranges.length; index += 1) {
    value =
      (value * (period - 1) + ranges[index]) / period;
  }

  return value;
}

function adx(
  candles: AnalysisCandle[],
  period = 14
): number | null {
  if (candles.length < period * 2 + 1) return null;

  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];

    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    plusDm.push(
      upMove > downMove && upMove > 0 ? upMove : 0
    );
    minusDm.push(
      downMove > upMove && downMove > 0 ? downMove : 0
    );

    tr.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }

  let smoothedTr = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlus =
    plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinus =
    minusDm.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];

  for (let index = period; index < tr.length; index += 1) {
    if (index > period) {
      smoothedTr =
        smoothedTr -
        smoothedTr / period +
        tr[index];
      smoothedPlus =
        smoothedPlus -
        smoothedPlus / period +
        plusDm[index];
      smoothedMinus =
        smoothedMinus -
        smoothedMinus / period +
        minusDm[index];
    }

    if (smoothedTr <= 0) continue;

    const plusDi = (100 * smoothedPlus) / smoothedTr;
    const minusDi = (100 * smoothedMinus) / smoothedTr;
    const denominator = plusDi + minusDi;

    if (denominator <= 0) {
      dxValues.push(0);
    } else {
      dxValues.push(
        (100 * Math.abs(plusDi - minusDi)) / denominator
      );
    }
  }

  if (dxValues.length < period) return null;

  let value =
    dxValues.slice(0, period).reduce((a, b) => a + b, 0) /
    period;

  for (let index = period; index < dxValues.length; index += 1) {
    value =
      (value * (period - 1) + dxValues[index]) /
      period;
  }

  return value;
}

export function buildTechnicalContext(
  candles: AnalysisCandle[]
): TechnicalContext {
  const ema20 = emaSeries(candles, 20);
  const ema50 = emaSeries(candles, 50);
  const ema200 = emaSeries(candles, 200);

  const latestEma20 = ema20.at(-1)?.value ?? null;
  const latestEma50 = ema50.at(-1)?.value ?? null;
  const latestEma200 = ema200.at(-1)?.value ?? null;

  const rsi14 = rsi(candles, 14);
  const atr14 = atr(candles, 14);
  const latestClose = candles.at(-1)?.close ?? null;
  const atrPercent =
    atr14 !== null && latestClose && latestClose > 0
      ? (atr14 / latestClose) * 100
      : null;
  const adx14 = adx(candles, 14);

  let trendState: TechnicalContext["trendState"] = "neutral";

  if (
    latestClose !== null &&
    latestEma20 !== null &&
    latestEma50 !== null
  ) {
    const bullish =
      latestClose > latestEma20 &&
      latestEma20 > latestEma50;
    const bearish =
      latestClose < latestEma20 &&
      latestEma20 < latestEma50;

    if (bullish) {
      trendState =
        adx14 !== null && adx14 >= 25
          ? "strong_bullish"
          : "bullish";
    } else if (bearish) {
      trendState =
        adx14 !== null && adx14 >= 25
          ? "strong_bearish"
          : "bearish";
    }
  }

  let volatilityState: TechnicalContext["volatilityState"] =
    "normal";

  if (atrPercent !== null) {
    if (atrPercent < 0.4) volatilityState = "low";
    else if (atrPercent > 1.5) volatilityState = "high";
  }

  return {
    ema20,
    ema50,
    ema200,
    latestEma20,
    latestEma50,
    latestEma200,
    rsi14,
    atr14,
    atrPercent,
    adx14,
    trendState,
    volatilityState
  };
}
