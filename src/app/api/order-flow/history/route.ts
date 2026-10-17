import { NextRequest, NextResponse } from "next/server";
import {
  orderFlowBucketStart,
  type OrderFlowBucket
} from "@/lib/analysis/order-flow";
import {
  orderFlowStoreConfigured,
  readStoredOrderFlow
} from "@/lib/server/order-flow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  resolution: string
) {
  const grouped = new Map<number, OrderFlowBucket>();

  for (const row of rows) {
    const bucketTime = orderFlowBucketStart(
      row.time,
      resolution
    );
    if (bucketTime === null) continue;

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
        quality: row.quality,
        source: "Persistent exact trade tape"
      });
    }
  }

  return [...grouped.values()].sort((a, b) => a.time - b.time);
}

export async function GET(request: NextRequest) {
  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
  const market =
    request.nextUrl.searchParams.get("market")?.trim().toUpperCase() ??
    "";
  const resolution =
    request.nextUrl.searchParams.get("resolution")?.trim() ?? "15";
  const from = Number(
    request.nextUrl.searchParams.get("from") ?? 0
  );
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
        "Persistent order-flow recorder is not configured on this server."
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
    const stored = await readStoredOrderFlow({
      provider: market === "KRAKEN" ? "KRAKEN" : "FYERS",
      market,
      symbol,
      from: safeFrom,
      to: safeTo
    });

    return NextResponse.json({
      ok: true,
      available: stored.available,
      buckets: aggregate(stored.buckets, resolution),
      sourceResolution: "1m",
      requestedResolution: resolution,
      reason: stored.reason
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to read persistent order flow."
      },
      { status: 502 }
    );
  }
}
