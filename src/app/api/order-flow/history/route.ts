import { NextRequest, NextResponse } from "next/server";
import {
  orderFlowBucketStart,
  type OrderFlowBucket
} from "@/lib/analysis/order-flow";
import {
  orderFlowStoreConfigured,
  readStoredOrderFlow,
  upsertStoredOrderFlow
} from "@/lib/server/order-flow-store";
import { readKrakenCompactOrderFlow } from "@/lib/server/kraken-compact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTO_RECOVERY_MAX_MINUTES = Math.max(
  30,
  Number(process.env.KRAKEN_ORDER_FLOW_AUTO_RECOVERY_MINUTES ?? 720)
);
const AUTO_RECOVERY_MAX_PAGES = Math.max(
  10,
  Number(process.env.KRAKEN_ORDER_FLOW_AUTO_RECOVERY_PAGES ?? 250)
);

function resolutionSeconds(resolution: string) {
  const map: Record<string, number> = {
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
  return map[resolution] ?? null;
}

function aggregate(
  rows: OrderFlowBucket[],
  resolution: string,
  closedThrough: number
) {
  const grouped = new Map<number, OrderFlowBucket>();
  const seconds = resolutionSeconds(resolution);

  if (!seconds) return [];

  for (const row of rows) {
    const bucketTime = orderFlowBucketStart(row.time, resolution);
    if (bucketTime === null) continue;

    if (bucketTime + seconds > closedThrough + 1) continue;

    const current = grouped.get(bucketTime);
    if (current) {
      current.buyVolume += row.buyVolume;
      current.sellVolume += row.sellVolume;
      current.trades += row.trades;
      current.buyTrades += row.buyTrades;
      current.sellTrades += row.sellTrades;
    } else {
      grouped.set(bucketTime, {
        time: bucketTime,
        buyVolume: row.buyVolume,
        sellVolume: row.sellVolume,
        trades: row.trades,
        buyTrades: row.buyTrades,
        sellTrades: row.sellTrades,
        partial: false,
        closed: true,
        coverage: "full",
        quality: row.quality,
        source: row.source
      });
    }
  }

  return [...grouped.values()].sort((a, b) => a.time - b.time);
}

function mergeMinuteBuckets(
  ...groups: OrderFlowBucket[][]
) {
  const map = new Map<number, OrderFlowBucket>();

  for (const group of groups) {
    for (const bucket of group) {
      map.set(bucket.time, bucket);
    }
  }

  return [...map.values()].sort((a, b) => a.time - b.time);
}

function latestMissingWindow(
  rows: OrderFlowBucket[],
  from: number,
  to: number
) {
  const firstMinute = Math.floor(from / 60) * 60;
  const lastMinute = Math.floor(to / 60) * 60;
  const present = new Set(rows.map((row) => Math.floor(row.time / 60) * 60));

  let end: number | null = null;
  for (let minute = lastMinute; minute >= firstMinute; minute -= 60) {
    if (!present.has(minute)) {
      end = minute;
      break;
    }
  }

  if (end === null) return null;

  let start = end;
  const maxSpan = (AUTO_RECOVERY_MAX_MINUTES - 1) * 60;

  while (
    start - 60 >= firstMinute &&
    end - (start - 60) <= maxSpan &&
    !present.has(start - 60)
  ) {
    start -= 60;
  }

  return {
    from: start,
    to: Math.min(to, end + 59)
  };
}

async function fetchKrakenExactMinutes(input: {
  symbol: string;
  from: number;
  to: number;
}) {
  let cursor = String(BigInt(Math.floor(input.from)) * 1_000_000_000n);
  let pages = 0;
  let latestRawTime = 0;
  let firstRawTime: number | null = null;
  const trades: Array<{
    time: number;
    qty: number;
    side: "buy" | "sell";
  }> = [];

  while (pages < AUTO_RECOVERY_MAX_PAGES) {
    const url = new URL("https://api.kraken.com/0/public/Trades");
    url.searchParams.set("pair", input.symbol);
    url.searchParams.set("assetVersion", "1");
    url.searchParams.set("since", cursor);
    url.searchParams.set("count", "1000");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ALLINONEVIEW-Exact-OrderFlow-Recovery/1.0"
      },
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
    const rows = pairKey && Array.isArray(result[pairKey])
      ? result[pairKey]
      : [];
    const nextCursor =
      result.last === null || result.last === undefined
        ? null
        : String(result.last);

    pages += 1;

    if (!rows.length || !nextCursor || nextCursor === cursor) {
      break;
    }

    for (const item of rows) {
      if (!Array.isArray(item) || item.length < 4) continue;

      const time = Number(item[2]);
      if (!Number.isFinite(time)) continue;

      latestRawTime = Math.max(latestRawTime, time);
      firstRawTime =
        firstRawTime === null ? time : Math.min(firstRawTime, time);

      if (time < input.from || time > input.to) continue;

      const qty = Number(item[1]);
      const side =
        item[3] === "b"
          ? "buy"
          : item[3] === "s"
            ? "sell"
            : null;

      if (!(qty > 0) || side === null) continue;
      trades.push({ time, qty, side });
    }

    cursor = nextCursor;

    if (latestRawTime >= input.to) break;
  }

  if (!trades.length || firstRawTime === null) {
    return {
      buckets: [] as OrderFlowBucket[],
      pages,
      coveredFrom: null as number | null,
      coveredTo: null as number | null
    };
  }

  const observedFrom = Math.max(input.from, firstRawTime);
  const observedTo = Math.min(
    input.to,
    latestRawTime > 0 ? latestRawTime : input.to
  );
  const firstMinute = Math.floor(observedFrom / 60) * 60;
  const lastMinute = Math.floor(observedTo / 60) * 60;
  const map = new Map<number, OrderFlowBucket>();

  // The REST cursor enumerates trades in chronological order. Once we have
  // observed the interval, zero-trade minutes inside that observed span can be
  // represented explicitly without inventing buy/sell classification.
  for (
    let minute = firstMinute;
    minute <= lastMinute;
    minute += 60
  ) {
    map.set(minute, {
      time: minute,
      buyVolume: 0,
      sellVolume: 0,
      trades: 0,
      buyTrades: 0,
      sellTrades: 0,
      partial: false,
      closed: true,
      coverage: "full",
      quality: "exact",
      source: "Kraken Trades REST exact recovery"
    });
  }

  for (const trade of trades) {
    const minute = Math.floor(trade.time / 60) * 60;
    const bucket = map.get(minute);
    if (!bucket) continue;

    bucket.trades += 1;
    if (trade.side === "buy") {
      bucket.buyVolume += trade.qty;
      bucket.buyTrades += 1;
    } else {
      bucket.sellVolume += trade.qty;
      bucket.sellTrades += 1;
    }
  }

  return {
    buckets: [...map.values()],
    pages,
    coveredFrom: firstMinute,
    coveredTo: lastMinute
  };
}

export async function GET(request: NextRequest) {
  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
  const market =
    request.nextUrl.searchParams.get("market")?.trim().toUpperCase() ?? "";
  const resolution =
    request.nextUrl.searchParams.get("resolution")?.trim() ?? "15";
  const from = Number(request.nextUrl.searchParams.get("from") ?? 0);
  const to = Number(
    request.nextUrl.searchParams.get("to") ??
      Math.floor(Date.now() / 1000)
  );

  if (!symbol || !market) {
    return NextResponse.json(
      { ok: false, error: "symbol and market are required." },
      { status: 400 }
    );
  }

  if (!resolutionSeconds(resolution)) {
    return NextResponse.json(
      { ok: false, error: "Unsupported order-flow timeframe." },
      { status: 400 }
    );
  }

  if (!orderFlowStoreConfigured()) {
    return NextResponse.json({
      ok: true,
      available: false,
      buckets: [],
      reason:
        "Persistent compact order-flow storage is not configured on this server."
    });
  }

  const safeTo =
    Number.isFinite(to) && to > 0
      ? Math.floor(to)
      : Math.floor(Date.now() / 1000);
  const safeFrom =
    Number.isFinite(from) && from > 0
      ? Math.floor(from)
      : safeTo - 30 * 24 * 60 * 60;

  try {
    let stored = await readStoredOrderFlow({
      provider: market === "KRAKEN" ? "KRAKEN" : "FYERS",
      market,
      symbol,
      from: safeFrom,
      to: safeTo
    });

    const localCompact =
      market === "KRAKEN"
        ? await readKrakenCompactOrderFlow({
            symbol,
            from: safeFrom,
            to: safeTo
          })
        : [];

    let minuteBuckets = mergeMinuteBuckets(
      localCompact,
      stored.buckets
    );

    let recovery:
      | {
          attempted: boolean;
          from: number;
          to: number;
          written: number;
          pages: number;
          coveredFrom: number | null;
          coveredTo: number | null;
        }
      | null = null;

    if (market === "KRAKEN") {
      const missing = latestMissingWindow(
        minuteBuckets,
        safeFrom,
        safeTo
      );

      if (missing) {
        const exact = await fetchKrakenExactMinutes({
          symbol,
          from: missing.from,
          to: missing.to
        });

        const written = await upsertStoredOrderFlow({
          provider: "KRAKEN",
          market: "KRAKEN",
          symbol,
          buckets: exact.buckets
        });

        recovery = {
          attempted: true,
          from: missing.from,
          to: missing.to,
          written,
          pages: exact.pages,
          coveredFrom: exact.coveredFrom,
          coveredTo: exact.coveredTo
        };

        if (written > 0) {
          stored = await readStoredOrderFlow({
            provider: "KRAKEN",
            market,
            symbol,
            from: safeFrom,
            to: safeTo
          });
          minuteBuckets = mergeMinuteBuckets(
            localCompact,
            stored.buckets
          );
        }
      }
    }

    const buckets = aggregate(
      minuteBuckets,
      resolution,
      safeTo
    );

    return NextResponse.json({
      ok: true,
      available: buckets.length > 0,
      buckets,
      sourceResolution: "1m",
      requestedResolution: resolution,
      recovery,
      reason:
        buckets.length > 0
          ? recovery?.written
            ? "Exact Kraken trade-side gaps were recovered on demand and compacted to 1-minute buckets."
            : null
          : stored.reason ??
            (localCompact.length
              ? "Compact exact local Kraken history is loaded."
              : "No exact trade-side order flow is available for this interval.")
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load or recover exact order flow."
      },
      { status: 502 }
    );
  }
}
