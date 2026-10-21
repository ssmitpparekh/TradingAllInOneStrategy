export type OrderFlowQuality = "exact" | "classified";

export type OrderFlowBucket = {
  time: number;
  buyVolume: number;
  sellVolume: number;
  trades: number;
  buyTrades: number;
  sellTrades: number;
  oi?: number | null;
  oiChange?: number | null;
  // partial means the bucket is not safe to present as a complete closed bar.
  // coverage distinguishes a live/open bar from a bucket where the stream
  // actually missed the beginning because we joined/reconnected mid-candle.
  partial: boolean;
  closed?: boolean;
  coverage?: "full" | "partial";
  quality: OrderFlowQuality;
  source: string;
};

const RESOLUTION_SECONDS: Record<string, number> = {
  "1": 60,
  "2": 120,
  "3": 180,
  "5": 300,
  "10": 600,
  "15": 900,
  "20": 1200,
  "30": 1800,
  "45": 2700,
  "60": 3600,
  "120": 7200,
  "180": 10800,
  "240": 14400,
  "1D": 86400,
  "1W": 604800
};

export function orderFlowBucketStart(
  timestamp: number,
  resolution: string
): number | null {
  const seconds = RESOLUTION_SECONDS[resolution];
  if (!seconds) return null;

  if (resolution === "1W") {
    const date = new Date(timestamp * 1000);
    const day = date.getUTCDay();
    const daysFromMonday = (day + 6) % 7;
    const midnight = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate()
    ) / 1000;
    return midnight - daysFromMonday * 86400;
  }

  return Math.floor(timestamp / seconds) * seconds;
}

export function orderFlowPercentages(bucket: OrderFlowBucket) {
  const total = bucket.buyVolume + bucket.sellVolume;

  if (!(total > 0)) {
    return {
      total: 0,
      buyPercent: 0,
      sellPercent: 0,
      delta: 0,
      deltaPercent: 0,
      cumulativeDelta: 0
    };
  }

  const delta = bucket.buyVolume - bucket.sellVolume;

  return {
    total,
    buyPercent: (bucket.buyVolume / total) * 100,
    sellPercent: (bucket.sellVolume / total) * 100,
    delta,
    deltaPercent: (delta / total) * 100,
    cumulativeDelta: delta
  };
}
