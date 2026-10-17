import { NextRequest, NextResponse } from "next/server";
import { getHistory } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60;

function lookbackForResolution(resolution: string): number {
  if (resolution === "1D" || resolution === "D") return 365 * DAY;
  if (resolution === "60") return 120 * DAY;
  if (resolution === "15") return 45 * DAY;
  if (resolution === "5") return 14 * DAY;
  return 7 * DAY;
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

  const now = Math.floor(Date.now() / 1000);
  const to = now - 60;
  const from = to - lookbackForResolution(resolution);

  try {
    const candles = await getHistory(session.accessToken, {
      symbol,
      resolution,
      from,
      to
    });

    return NextResponse.json({
      ok: true,
      symbol,
      resolution,
      candles
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
