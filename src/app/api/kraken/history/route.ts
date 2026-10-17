import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESOLUTION_TO_MINUTES: Record<string, number> = {
  "1": 1,
  "5": 5,
  "15": 15,
  "30": 30,
  "60": 60,
  "240": 240,
  "1D": 1440,
  "1W": 10080
};

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim() || "BTC/USD";
  const resolution = request.nextUrl.searchParams.get("resolution")?.trim() || "15";
  const interval = RESOLUTION_TO_MINUTES[resolution] ?? 15;

  const url = new URL("https://api.kraken.com/0/public/OHLC");
  url.searchParams.set("pair", symbol);
  url.searchParams.set("interval", String(interval));
  url.searchParams.set("assetVersion", "1");

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    const body = await response.json();

    if (!response.ok || (Array.isArray(body?.error) && body.error.length > 0)) {
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

    const candles = rows.map((row: unknown[]) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[6] ?? 0)
    }));

    return NextResponse.json({
      ok: true,
      provider: "KRAKEN",
      symbol,
      resolution,
      candles,
      note:
        "Kraken Spot REST returns up to the 720 most recent OHLC candles for the selected timeframe."
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Kraken history."
      },
      { status: 502 }
    );
  }
}
