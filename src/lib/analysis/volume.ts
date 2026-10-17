import type { AnalysisCandle } from "./market-structure";

export type VolumeCandle = AnalysisCandle & {
  volume?: number;
};

export type VwapPoint = {
  time: number;
  value: number;
};

export type VolumeProfileBin = {
  low: number;
  high: number;
  midpoint: number;
  volume: number;
};

export type VolumeProfile = {
  bins: VolumeProfileBin[];
  poc: number | null;
  vah: number | null;
  val: number | null;
  hvn: number[];
  lvn: number[];
  totalVolume: number;
  valueAreaPercent: number;
};

export type VolumeAnalytics = {
  available: boolean;
  sessionVwap: VwapPoint[];
  anchoredVwap: VwapPoint[];
  latestSessionVwap: number | null;
  latestAnchoredVwap: number | null;
  profile: VolumeProfile;
  latestVolume: number | null;
  averageVolume20: number | null;
  volumeRatio20: number | null;
};

function dateKey(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp * 1000));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function typicalPrice(candle: VolumeCandle): number {
  return (candle.high + candle.low + candle.close) / 3;
}

function calculateSessionVwap(
  candles: VolumeCandle[],
  timeZone: string
): VwapPoint[] {
  const points: VwapPoint[] = [];
  let session = "";
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const volume = Number(candle.volume ?? 0);
    if (!(volume > 0)) continue;

    const key = dateKey(candle.time, timeZone);
    if (key !== session) {
      session = key;
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
    }

    cumulativePriceVolume += typicalPrice(candle) * volume;
    cumulativeVolume += volume;

    if (cumulativeVolume > 0) {
      points.push({
        time: candle.time,
        value: cumulativePriceVolume / cumulativeVolume
      });
    }
  }

  return points;
}

function calculateAnchoredVwap(
  candles: VolumeCandle[],
  anchorTime: number | null
): VwapPoint[] {
  if (!anchorTime) return [];

  const points: VwapPoint[] = [];
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    if (candle.time < anchorTime) continue;

    const volume = Number(candle.volume ?? 0);
    if (!(volume > 0)) continue;

    cumulativePriceVolume += typicalPrice(candle) * volume;
    cumulativeVolume += volume;

    if (cumulativeVolume > 0) {
      points.push({
        time: candle.time,
        value: cumulativePriceVolume / cumulativeVolume
      });
    }
  }

  return points;
}

function emptyProfile(): VolumeProfile {
  return {
    bins: [],
    poc: null,
    vah: null,
    val: null,
    hvn: [],
    lvn: [],
    totalVolume: 0,
    valueAreaPercent: 0.7
  };
}

export function calculateVolumeProfile(
  candles: VolumeCandle[],
  options?: {
    binCount?: number;
    valueAreaPercent?: number;
  }
): VolumeProfile {
  const usable = candles.filter(
    (candle) =>
      Number(candle.volume ?? 0) > 0 &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.high)
  );

  if (!usable.length) return emptyProfile();

  const binCount = Math.min(
    100,
    Math.max(12, Math.floor(options?.binCount ?? 48))
  );
  const valueAreaPercent = Math.min(
    0.95,
    Math.max(0.5, options?.valueAreaPercent ?? 0.7)
  );

  const minPrice = Math.min(...usable.map((candle) => candle.low));
  const maxPrice = Math.max(...usable.map((candle) => candle.high));

  if (!(maxPrice > minPrice)) return emptyProfile();

  const step = (maxPrice - minPrice) / binCount;
  const bins: VolumeProfileBin[] = Array.from(
    { length: binCount },
    (_, index) => {
      const low = minPrice + index * step;
      const high =
        index === binCount - 1 ? maxPrice : low + step;

      return {
        low,
        high,
        midpoint: (low + high) / 2,
        volume: 0
      };
    }
  );

  for (const candle of usable) {
    const volume = Number(candle.volume ?? 0);
    const lowIndex = Math.max(
      0,
      Math.min(
        binCount - 1,
        Math.floor((candle.low - minPrice) / step)
      )
    );
    const highIndex = Math.max(
      lowIndex,
      Math.min(
        binCount - 1,
        Math.floor((candle.high - minPrice) / step)
      )
    );
    const touchedBins = highIndex - lowIndex + 1;
    const volumePerBin = volume / touchedBins;

    for (let index = lowIndex; index <= highIndex; index += 1) {
      bins[index].volume += volumePerBin;
    }
  }

  const totalVolume = bins.reduce(
    (sum, bin) => sum + bin.volume,
    0
  );

  if (!(totalVolume > 0)) return emptyProfile();

  let pocIndex = 0;
  for (let index = 1; index < bins.length; index += 1) {
    if (bins[index].volume > bins[pocIndex].volume) {
      pocIndex = index;
    }
  }

  const targetVolume = totalVolume * valueAreaPercent;
  let lowIndex = pocIndex;
  let highIndex = pocIndex;
  let accumulated = bins[pocIndex].volume;

  while (accumulated < targetVolume) {
    const lowerVolume =
      lowIndex > 0 ? bins[lowIndex - 1].volume : -1;
    const upperVolume =
      highIndex < bins.length - 1
        ? bins[highIndex + 1].volume
        : -1;

    if (lowerVolume < 0 && upperVolume < 0) break;

    if (upperVolume >= lowerVolume) {
      highIndex += 1;
      accumulated += bins[highIndex].volume;
    } else {
      lowIndex -= 1;
      accumulated += bins[lowIndex].volume;
    }
  }

  const rankedHigh = bins
    .map((bin, index) => ({ index, volume: bin.volume }))
    .sort((a, b) => b.volume - a.volume);

  const rankedLow = bins
    .map((bin, index) => ({ index, volume: bin.volume }))
    .filter((entry) => entry.volume > 0)
    .sort((a, b) => a.volume - b.volume);

  return {
    bins,
    poc: bins[pocIndex].midpoint,
    vah: bins[highIndex].high,
    val: bins[lowIndex].low,
    hvn: rankedHigh
      .slice(0, 3)
      .map((entry) => bins[entry.index].midpoint),
    lvn: rankedLow
      .slice(0, 3)
      .map((entry) => bins[entry.index].midpoint),
    totalVolume,
    valueAreaPercent
  };
}

export function buildVolumeAnalytics(
  candles: VolumeCandle[],
  options?: {
    timeZone?: string;
    anchorTime?: number | null;
  }
): VolumeAnalytics {
  const positiveVolumeCandles = candles.filter(
    (candle) => Number(candle.volume ?? 0) > 0
  );

  const available =
    positiveVolumeCandles.length >=
    Math.max(3, Math.floor(candles.length * 0.1));

  if (!available) {
    return {
      available: false,
      sessionVwap: [],
      anchoredVwap: [],
      latestSessionVwap: null,
      latestAnchoredVwap: null,
      profile: emptyProfile(),
      latestVolume: null,
      averageVolume20: null,
      volumeRatio20: null
    };
  }

  const timeZone = options?.timeZone ?? "UTC";
  const sessionVwap = calculateSessionVwap(candles, timeZone);
  const anchoredVwap = calculateAnchoredVwap(
    candles,
    options?.anchorTime ?? null
  );
  const profile = calculateVolumeProfile(candles);

  const volumes = positiveVolumeCandles.map(
    (candle) => Number(candle.volume ?? 0)
  );
  const latestVolume = volumes[volumes.length - 1] ?? null;
  const previous = volumes.slice(
    Math.max(0, volumes.length - 21),
    Math.max(0, volumes.length - 1)
  );
  const averageVolume20 = previous.length
    ? previous.reduce((sum, value) => sum + value, 0) /
      previous.length
    : null;
  const volumeRatio20 =
    latestVolume !== null &&
    averageVolume20 !== null &&
    averageVolume20 > 0
      ? latestVolume / averageVolume20
      : null;

  return {
    available,
    sessionVwap,
    anchoredVwap,
    latestSessionVwap:
      sessionVwap[sessionVwap.length - 1]?.value ?? null,
    latestAnchoredVwap:
      anchoredVwap[anchoredVwap.length - 1]?.value ?? null,
    profile,
    latestVolume,
    averageVolume20,
    volumeRatio20
  };
}
