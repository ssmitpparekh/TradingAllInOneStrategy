import { NextRequest, NextResponse } from "next/server";
import { getHistory, type FyersCandle } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";
import { getOandaCandles } from "@/lib/oanda";
import {
  readMarketCandles,
  type StoredMarketCandle
} from "@/lib/server/candle-store";
import { readKrakenCompactCandles } from "@/lib/server/kraken-compact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60;
const HISTORY_MEMORY_TTL_MS = 60_000;
const HISTORY_MEMORY_MAX_ENTRIES = 96;

type MemoryHistoryEntry = {
  expiresAt: number;
  candles: StoredMarketCandle[];
  from: number;
  to: number;
  note: string;
};

const historyMemoryCache = new Map<string, MemoryHistoryEntry>();

function readMemoryHistory(key: string) {
  const entry = historyMemoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    historyMemoryCache.delete(key);
    return null;
  }

  // Refresh LRU order.
  historyMemoryCache.delete(key);
  historyMemoryCache.set(key, entry);
  return entry;
}

function writeMemoryHistory(key: string, entry: MemoryHistoryEntry) {
  historyMemoryCache.delete(key);
  historyMemoryCache.set(key, entry);

  while (historyMemoryCache.size > HISTORY_MEMORY_MAX_ENTRIES) {
    const oldest = historyMemoryCache.keys().next().value;
    if (!oldest) break;
    historyMemoryCache.delete(oldest);
  }
}

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

function fyersRefreshWindow(resolution: string) {
  // FYERS Standard permits roughly one year of intraday history and five
  // years of daily history. Keep a small safety margin so timezone/leap-day
  // boundaries never push range_from outside the plan window.
  return isDailyLike(resolution)
    ? 5 * 365 * DAY - 2 * DAY
    : 364 * DAY;
}

function requestedLookback(
  range: RangeKey,
  resolution: string,
  provider: "FYERS" | "KRAKEN" | "OANDA"
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

  const numericResolution = Number(resolution);
  const providerMax =
    provider === "FYERS"
      ? fyersRefreshWindow(resolution)
      : provider === "OANDA"
        ? isDailyLike(resolution)
          ? 22 * 366 * DAY
          : Number.isFinite(numericResolution) &&
              numericResolution >= 60
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

async function fetchOandaHistory(options: {
  symbol: string;
  resolution: string;
  from: number;
  to: number;
}) {
  const step = resolutionSeconds(options.resolution);
  const chunkSeconds = Math.max(step, step * 4500);
  const all: StoredMarketCandle[] = [];

  for (
    let start = options.from;
    start <= options.to;
    start += chunkSeconds + 1
  ) {
    const end = Math.min(start + chunkSeconds, options.to);
    const candles = await getOandaCandles({
      symbol: options.symbol,
      resolution: options.resolution,
      from: start,
      to: end
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
  const provider =
    market === "KRAKEN"
      ? "KRAKEN"
      : market === "OANDA"
        ? "OANDA"
        : "FYERS";
  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() ||
    (provider === "KRAKEN"
      ? "BTC/USD"
      : provider === "OANDA"
        ? "XAU_USD"
        : "NSE:NIFTY50-INDEX");
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
  const upstreamFrom =
    provider === "FYERS"
      ? Math.max(from, to - fyersRefreshWindow(resolution))
      : from;

  const memoryKey = [
    provider,
    market,
    symbol,
    resolution,
    range
  ].join("|");
  const memoryHit = readMemoryHistory(memoryKey);

  if (memoryHit) {
    return NextResponse.json({
      ok: true,
      provider,
      market,
      symbol,
      resolution,
      range,
      candles: memoryHit.candles,
      from: memoryHit.from,
      to: memoryHit.to,
      cache: {
        enabled: true,
        kind: "memory",
        candles: memoryHit.candles.length,
        firstTime: memoryHit.candles[0]?.time ?? null,
        lastTime: memoryHit.candles.at(-1)?.time ?? null
      },
      note: memoryHit.note
    });
  }

  // Existing Neon candle rows are read-only during the provider-first migration.
  // They are never refreshed or expanded here and can be removed after the
  // provider-first path is verified.
  let legacyCached: StoredMarketCandle[] = [];
  try {
    legacyCached = await readMarketCandles({
      provider,
      market,
      symbol,
      resolution,
      from,
      to
    });
  } catch {
    legacyCached = [];
  }

  let compactKraken: StoredMarketCandle[] = [];
  if (provider === "KRAKEN") {
    try {
      compactKraken = await readKrakenCompactCandles({
        symbol,
        resolution,
        from,
        to
      });
    } catch {
      compactKraken = [];
    }
  }

  let upstream: StoredMarketCandle[] = [];
  let upstreamError: string | null = null;

  try {
    upstream =
      provider === "FYERS"
        ? await fetchFyersHistory({
            symbol,
            resolution,
            from: upstreamFrom,
            to
          })
        : provider === "OANDA"
          ? await fetchOandaHistory({
              symbol,
              resolution,
              from,
              to
            })
          : await fetchKrakenRecent(symbol, resolution);
  } catch (error) {
    upstreamError =
      error instanceof Error
        ? error.message
        : "Unable to fetch upstream history.";
  }

  let usedLegacyFallback = false;
  let candles: StoredMarketCandle[] = [];

  if (provider === "KRAKEN") {
    usedLegacyFallback = legacyCached.length > 0;
    // Priority on overlap: legacy cache < compact exact trade recovery <
    // current Kraken OHLC. This closes the June-to-current gap without
    // reintroducing permanent candle writes to Neon.
    candles = dedupeAndSort([
      ...legacyCached,
      ...compactKraken,
      ...upstream
    ]);
  } else if (upstream.length) {
    if (provider === "FYERS" && upstreamFrom > from) {
      const older = legacyCached.filter(
        (candle) => candle.time < upstreamFrom
      );
      usedLegacyFallback = older.length > 0;
      candles = dedupeAndSort([...older, ...upstream]);
    } else {
      candles = dedupeAndSort(upstream);
    }
  } else if (legacyCached.length) {
    usedLegacyFallback = true;
    candles = dedupeAndSort(legacyCached);
  }

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

  const notes: string[] = [
    "Provider-first candle mode is active. New candle history is not persisted to Neon."
  ];

  if (provider === "FYERS") {
    notes.push(
      "Candles are requested directly from the connected FYERS Historical Data API."
    );
    if (!isDailyLike(resolution) && (range === "5Y" || range === "MAX")) {
      notes.push(
        "FYERS Standard intraday history is limited to the recent plan window."
      );
    }
  } else if (provider === "OANDA") {
    notes.push(
      "OANDA v20 midpoint candles are requested directly. OANDA candle volume is price/tick count rather than centralized exchange trade volume. Available instruments come from the connected OANDA account."
    );
  } else {
    notes.push(
      compactKraken.length
        ? "Kraken history is stitched from the existing read-only deep cache, compact exact trade-derived recovery, and current Kraken OHLC/live data."
        : "Recent Kraken OHLC is requested directly. Run npm run kraken:prepare-exact once to bridge the June-to-current intraday archive gap and exact trade-side history."
    );
  }

  if (provider === "FYERS" && upstreamFrom > from) {
    notes.push(
      "Older candles are being served from Neon while FYERS refreshes only the history window permitted by the connected plan."
    );
  }

  if (usedLegacyFallback) {
    notes.push(
      "Some older candles came from the existing read-only Neon safety cache; no new candle rows were written."
    );
  }

  if (upstreamError && candles.length) {
    notes.push(
      "The provider refresh could not be completed, so existing read-only safety candles were used where available."
    );
  }

  const note = notes.join(" ");
  writeMemoryHistory(memoryKey, {
    expiresAt: Date.now() + HISTORY_MEMORY_TTL_MS,
    candles,
    from,
    to,
    note
  });

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
      enabled: true,
      kind: "provider-memory",
      candles: candles.length,
      firstTime: candles[0]?.time ?? null,
      lastTime: candles.at(-1)?.time ?? null
    },
    note
  });
}
