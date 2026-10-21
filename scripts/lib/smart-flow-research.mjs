// Research-only Smart Flow candidate.
// IMPORTANT: This module is not imported by the live application.
// Signals are calculated only from the current/previous CLOSED candles.

export const DEFAULT_SMART_FLOW_PARAMS = Object.freeze({
  range: 70,
  length: 10,
  factor: 1.2,
  fastEma: 10,
  slowEma: 30
});

const EPS = 1e-12;

function ema(previous, value, length) {
  const alpha = 2 / (length + 1);
  return previous == null ? value : previous + alpha * (value - previous);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function computeSmartFlow(candles, params = DEFAULT_SMART_FLOW_PARAMS, options = {}) {
  const p = { ...DEFAULT_SMART_FLOW_PARAMS, ...params };
  const tickVolume = Boolean(options.tickVolume);
  const volumeWeight = tickVolume ? 0.55 : 1;

  let atr = null;
  let volumeEma = null;
  let fast = null;
  let slow = null;
  let pressureEma = null;
  let previousClose = null;

  const rawPressureWindow = [];
  const points = [];

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const high = Number(candle.high);
    const low = Number(candle.low);
    const open = Number(candle.open);
    const close = Number(candle.close);
    const volume = Math.max(0, Number(candle.volume ?? 0));
    const range = Math.max(EPS, high - low);

    const trueRange =
      previousClose == null
        ? range
        : Math.max(
            range,
            Math.abs(high - previousClose),
            Math.abs(low - previousClose)
          );

    atr = ema(atr, trueRange, p.length);
    volumeEma = ema(volumeEma, volume, p.length);
    fast = ema(fast, close, p.fastEma);
    slow = ema(slow, close, p.slowEma);

    // Public, transparent pressure primitives:
    // CLV: +1 near candle high, -1 near candle low.
    const closeLocation =
      ((close - low) - (high - close)) / range;
    // Body direction/intensity inside this candle.
    const bodyPressure = (close - open) / range;
    // Activity relative to recent activity. OANDA tick-count is deliberately
    // down-weighted because it is not centralized exchange volume.
    const volumeRatio =
      volumeEma && volumeEma > EPS ? volume / volumeEma : 1;
    const activityBoost =
      1 + volumeWeight * 0.35 * clamp(volumeRatio - 1, -0.75, 2);

    const flowPressure =
      clamp(
        (0.65 * closeLocation + 0.35 * bodyPressure) *
          activityBoost,
        -2,
        2
      );

    pressureEma = ema(pressureEma, flowPressure, p.length);
    rawPressureWindow.push(pressureEma);
    if (rawPressureWindow.length > p.range) rawPressureWindow.shift();

    const mean =
      rawPressureWindow.reduce((sum, value) => sum + value, 0) /
      Math.max(1, rawPressureWindow.length);
    const variance =
      rawPressureWindow.reduce(
        (sum, value) => sum + (value - mean) ** 2,
        0
      ) / Math.max(1, rawPressureWindow.length);
    const sigma = Math.sqrt(variance);

    const normalizedFlow =
      sigma > EPS ? (pressureEma - mean) / sigma : 0;
    const trendStrength =
      atr && atr > EPS ? (fast - slow) / atr : 0;

    const composite =
      0.7 * normalizedFlow +
      0.3 * clamp(trendStrength, -3, 3);

    const ready =
      i >= Math.max(p.range, p.slowEma) &&
      Number.isFinite(composite);

    let state = "NEUTRAL";
    if (
      ready &&
      composite >= p.factor &&
      fast > slow &&
      close >= fast
    ) {
      state = "BULL";
    } else if (
      ready &&
      composite <= -p.factor &&
      fast < slow &&
      close <= fast
    ) {
      state = "BEAR";
    }

    points.push({
      time: Number(candle.time),
      close,
      atr: atr ?? 0,
      fastEma: fast ?? close,
      slowEma: slow ?? close,
      flowPressure,
      normalizedFlow,
      composite,
      state
    });

    previousClose = close;
  }

  return points;
}

export function stateTransitions(points) {
  const signals = [];
  let previous = "NEUTRAL";

  for (let i = 0; i < points.length; i += 1) {
    const state = points[i].state;
    if (
      state !== "NEUTRAL" &&
      state !== previous
    ) {
      signals.push({
        index: i,
        time: points[i].time,
        direction: state === "BULL" ? "LONG" : "SHORT",
        score: points[i].composite
      });
    }

    if (state !== "NEUTRAL") previous = state;
  }

  return signals;
}
