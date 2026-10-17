import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SYMBOL = "NSE:NIFTY50-INDEX";

export async function GET(request: NextRequest) {
  const session = await readFyersSession();

  if (!session?.accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "FYERS is not connected. Complete FYERS login first."
      },
      { status: 401 }
    );
  }

  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() || DEFAULT_SYMBOL;

  try {
    const quote = await getQuote(session.accessToken, symbol);
    return NextResponse.json({ ok: true, quote });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to fetch FYERS quote.";

    return NextResponse.json(
      {
        ok: false,
        error: message,
        reconnectRecommended: true
      },
      { status: 502 }
    );
  }
}
