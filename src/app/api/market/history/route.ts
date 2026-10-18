import { NextRequest, NextResponse } from "next/server";
import { getHistory, type FyersCandle } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";
import {
  getMarketCandleCoverage,
  readMarketCandles,
  upsertMarketCandles,
  type StoredMarketCandle
} from "@/lib/server/candle-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60;

type RangeKey =
  | "1D"
  | "5D"
  | "1M"
  | "3M"
  | "6M"
  | "1Y"
  | "5Y"
  | "MAX";

const ALLOWED_RANGES: RangeKey[] = [
  "1D",
  "5D",
  "1M",
  "3M",
  "6M",
  "1Y",
  "5Y",
  "MAX"
];

function normalizeResolution(value: string) {
  const map: Record<string, string> = {
    "1m": "1",
    "2m": "2",
    "3m": "3",
    "5m": "5",
    "10m": "10",
    "15m": "15",
    "20m": "20",
    "30m": "30",
    "45m": "45",
    "1h": "60",
    "2h": "120",
    "3h": "180",
    "4h": "240",
    "1d": "1D",
    "1w": "1W",
    "1mo": "1M"
  };

  const trimmed = value.trim();
  return map[trimmed.toLowerCase()] ?? trimmed;
}

function isDailyLike(resolution: string) {
  return ["D", "1D", "1W", "1M"].includes(resolution);
}

function resolutionSeconds(resolution: string) {
  if (resolution === "D" || resolution === "1D") return DAY;
  if (resolution === "1W") return 7 * DAY;
  if (resolution === "1M") return 30 * DAY;
  const minutes = Number(resolution);
  return Number.isFinite(minutes) && minutes > 0
    ? Math.round(minutes * 60)
    : 15 * 60;
}

function requestedLookback(
  range: RangeKey,
  resolution: string,
  provider: "FYERS" | "KRAKEN"
) {
  const map: Record<Exclude<RangeKey, "MAX">, number> = {
    "1D": DAY,
    "5D": 5 * DAY,
    "1M": 31 * DAY,
    "3M": 93 * DAY,
    "6M": 186 * DAY,
    "1Y": 366 * DAY,
    "5Y": 5 * 366 * DAY
  };

  const providerMax =
    provider === "FYERS"
      ? isDailyLike(resolution)
        ? 5 * 366 * DAY
        : 366 * DAY
      : isDailyLike(resolution)
        ? 5 * 366 * DAY
        : 366 * DAY;

  if (range !== "MAX") {
    return Math.min(map[range], providerMax);
  }

  return providerMax;
}

function dedupeAndSort(candles: StoredMarketCandle[]) {
  const map = new Map<number, StoredMarketCandle>();
  for (const candle of candles) map.set(candle.time, candle);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

async function fetchFyersHistory(options: {
  symbol: string;
  resolution: string;
  from: number;
  to: number;
}) {
  const session = await readFyersSession();
  if (!session?.accessToken) {
    throw new Error("FYERS is not connected.");
  }

  const chunkSeconds = isDailyLike(options.resolution)
    ? 365 * DAY
    : 99 * DAY;

  const all: FyersCandle[] = [];

  for (
    let start = options.from;
    start <= options.to;
    start += chunkSeconds + 1
  ) {
    const end = Math.min(start + chunkSeconds, options.to);
    const candles = await getHistory(session.accessToken, {
      symbol: options.symbol,
      resolution: options.resolution,
      from: start,
      to: end,
      includeOi: /(?:FUT|CE|PE)$/.test(options.symbol)
    });
    all.push(...candles);
  }

  return dedupeAndSort(all);
}

const KRAKEN_INTERVAL: Record<string, number> = {
  "1": 1,
  "5": 5,
  "15": 15,
  "30": 30,
  "60": 60,
  "240": 240,
  "1D": 1440,
  "1W": 10080
};

async function fetchKrakenRecent(
  symbol: string,
  resolution: string
): Promise<StoredMarketCandle[]> {
  const interval = KRAKEN_INTERVAL[resolution];
  if (!interval) {
    throw new Error(
      `Kraken does not provide ${resolution} candles directly.`
    );
  }

  const url = new URL("https://api.kraken.com/0/public/OHLC");
  url.searchParams.set("pair", symbol);
  url.searchParams.set("interval", String(interval));
  url.searchParams.set("assetVersion", "1");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const body = await response.json();

  if (
    !response.ok ||
    (Array.isArray(body?.error) && body.error.length > 0)
  ) {
    throw new Error(
      Array.isArray(body?.error) && body.error.length
        ? body.error.join(", ")
        : `Kraken HTTP ${response.status}`
    );
  }

  const result = body?.result ?? {};
  const pairKey = Object.keys(result).find((key) => key !== "last");
  const rows = pairKey ? result[pairKey] : null;

  if (!Array.isArray(rows)) {
    throw new Error(`No Kraken OHLC data returned for ${symbol}.`);
  }

  return rows.map((row: unknown[]) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[6] ?? 0)
  }));
}

export async function GET(request: NextRequest) {
  const market =
    request.nextUrl.searchParams.get("market")?.trim().toUpperCase() ||
    "NSE";
  const provider = market === "KRAKEN" ? "KRAKEN" : "FYERS";
  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() ||
    (provider === "KRAKEN" ? "BTC/USD" : "NSE:NIFTY50-INDEX");
  const resolution = normalizeResolution(
    request.nextUrl.searchParams.get("resolution")?.trim() || "15"
  );
  const requestedRange =
    (request.nextUrl.searchParams
      .get("range")
      ?.trim()
      .toUpperCase() || "1M") as RangeKey;
  const range = ALLOWED_RANGES.includes(requestedRange)
    ? requestedRange
    : "1M";

  const now = Math.floor(Date.now() / 1000);
  const to = now - 60;
  const lookback = requestedLookback(range, resolution, provider);
  const calendarBuffer =
    range === "1D"
      ? 4 * DAY
      : range === "5D"
        ? 5 * DAY
        : 2 * DAY;
  const from = Math.max(0, to - lookback - calendarBuffer);

  let cached: StoredMarketCandle[] = [];
  let cacheAvailable = true;
  let coverage:
    | Awaited<ReturnType<typeof getMarketCandleCoverage>>
    | null = null;

  try {
    coverage = await getMarketCandleCoverage({
      provider,
      market,
      symbol,
      resolution
    });

    cached = await readMarketCandles({
      provider,
      market,
      symbol,
      resolution,
      from,
      to
    });
  } catch {
    cacheAvailable = false;
  }

  const step = resolutionSeconds(resolution);
  const coverageStartsEarlyEnough =
    coverage?.firstTime !== null &&
    coverage?.firstTime !== undefined &&
    coverage.firstTime <= from + Math.max(step * 2, DAY);
  const cacheRecentlyRefreshed =
    coverage?.lastRefresh !== null &&
    coverage?.lastRefresh !== undefined &&
    Date.now() - coverage.lastRefresh < 2 * 60 * 1000;

  let upstream: StoredMarketCandle[] = [];
  let upstreamError: string | null = null;

  if (!coverageStartsEarlyEnough || !cacheRecentlyRefreshed) {
    try {
      upstream =
        provider === "FYERS"
          ? await fetchFyersHistory({
              symbol,
              resolution,
              from,
              to
            })
          : await fetchKrakenRecent(symbol, resolution);

      if (cacheAvailable && upstream.length) {
        await upsertMarketCandles({
          provider,
          market,
          symbol,
          resolution,
          source:
            provider === "FYERS"
              ? "FYERS Historical Data API"
              : "Kraken Spot OHLC REST",
          quality: "exact_ohlcv",
          candles: upstream
        });

        cached = await readMarketCandles({
          provider,
          market,
          symbol,
          resolution,
          from,
          to
        });
      }
    } catch (error) {
      upstreamError =
        error instanceof Error
          ? error.message
          : "Unable to fetch upstream history.";
    }
  }

  const candles = dedupeAndSort(
    cacheAvailable ? cached : [...cached, ...upstream]
  );

  if (!candles.length && upstreamError) {
    return NextResponse.json(
      {
        ok: false,
        provider,
        market,
        symbol,
        resolution,
        range,
        error: upstreamError
      },
      { status: 502 }
    );
  }

  const notes: string[] = [];

  if (provider === "FYERS") {
    notes.push(
      "Historical candles are cached in Neon after provider retrieval."
    );
    if (!isDailyLike(resolution) && (range === "5Y" || range === "MAX")) {
      notes.push(
        "FYERS Standard intraday history is limited to the recent plan window."
      );
    }
  } else {
    notes.push(
      "Recent Kraken OHLC is cached in Neon; deep archive backfill is handled separately."
    );
  }

  if (upstreamError && candles.length) {
    notes.push(
      `Serving cached candles because upstream refresh failed: ${upstreamError}`
    );
  }

  return NextResponse.json({
    ok: true,
    provider,
    market,
    symbol,
    resolution,
    range,
    candles,
    from,
    to,
    cache: {
      enabled: cacheAvailable,
      candles: candles.length,
      firstTime: candles[0]?.time ?? null,
      lastTime: candles.at(-1)?.time ?? null
    },
    note: notes.join(" ")
  });
}
