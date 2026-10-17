import { NextRequest, NextResponse } from "next/server";
import { getHistory, type FyersCandle } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60;

type RangeKey = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX";

function isDailyLike(resolution: string) {
  return resolution === "D" || resolution === "1D" || resolution === "1W" || resolution === "1M";
}

function requestedLookback(range: RangeKey, resolution: string): number {
  const map: Record<Exclude<RangeKey, "MAX">, number> = {
    "1D": 1 * DAY,
    "5D": 5 * DAY,
    "1M": 31 * DAY,
    "3M": 93 * DAY,
    "6M": 186 * DAY,
    "1Y": 366 * DAY,
    "5Y": 5 * 366 * DAY
  };

  if (range === "MAX") {
    return isDailyLike(resolution) ? 5 * 366 * DAY : 366 * DAY;
  }

  const desired = map[range];
  const standardPlanMax = isDailyLike(resolution) ? 5 * 366 * DAY : 366 * DAY;
  return Math.min(desired, standardPlanMax);
}

function maxChunkSeconds(resolution: string): number {
  return isDailyLike(resolution) ? 366 * DAY : 100 * DAY;
}

function dedupeAndSort(candles: FyersCandle[]) {
  const map = new Map<number, FyersCandle>();
  for (const candle of candles) map.set(candle.time, candle);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

export async function GET(request: NextRequest) {
  const session = await readFyersSession();

  if (!session?.accessToken) {
    return NextResponse.json(
      { ok: false, error: "FYERS is not connected." },
      { status: 401 }
    );
  }

  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() || "NSE:NIFTY50-INDEX";
  const resolution =
    request.nextUrl.searchParams.get("resolution")?.trim() || "15";
  const requestedRange =
    (request.nextUrl.searchParams.get("range")?.trim().toUpperCase() || "1M") as RangeKey;

  const allowedRanges: RangeKey[] = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "MAX"];
  const range = allowedRanges.includes(requestedRange) ? requestedRange : "1M";

  const now = Math.floor(Date.now() / 1000);
  const to = now - 60;
  const lookback = requestedLookback(range, resolution);
  const from = Math.max(0, to - lookback);
  const chunk = maxChunkSeconds(resolution);

  try {
    const chunks: Array<{ from: number; to: number }> = [];
    for (let start = from; start <= to; start += chunk + 1) {
      chunks.push({
        from: start,
        to: Math.min(start + chunk, to)
      });
    }

    const allCandles: FyersCandle[] = [];
    for (const part of chunks) {
      const candles = await getHistory(session.accessToken, {
        symbol,
        resolution,
        from: part.from,
        to: part.to
      });
      allCandles.push(...candles);
    }

    const candles = dedupeAndSort(allCandles);

    return NextResponse.json({
      ok: true,
      symbol,
      resolution,
      range,
      candles,
      from,
      to,
      appliedLimit:
        !isDailyLike(resolution) && (range === "5Y" || range === "MAX")
          ? "FYERS Standard intraday history is limited to the last 1 year."
          : isDailyLike(resolution) && range === "MAX"
            ? "FYERS Standard daily/weekly/monthly history is limited to about 5 years."
            : null
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to fetch history.";

    return NextResponse.json(
      { ok: false, error: message, reconnectRecommended: true },
      { status: 502 }
    );
  }
}
