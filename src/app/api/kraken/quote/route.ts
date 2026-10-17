import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim() || "BTC/USD";

  const url = new URL("https://api.kraken.com/0/public/Ticker");
  url.searchParams.set("pair", symbol);

  try {
    const response = await fetch(url, {
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

    const first = Object.values(body?.result ?? {})[0] as
      | Record<string, unknown>
      | undefined;

    if (!first) {
      throw new Error(`No Kraken quote returned for ${symbol}.`);
    }

    const last = Number(Array.isArray(first.c) ? first.c[0] : 0);
    const open = Number(first.o ?? 0);
    const high = Number(Array.isArray(first.h) ? first.h[1] ?? first.h[0] : 0);
    const low = Number(Array.isArray(first.l) ? first.l[1] ?? first.l[0] : 0);
    const volume = Number(Array.isArray(first.v) ? first.v[1] ?? first.v[0] : 0);
    const bid = Number(Array.isArray(first.b) ? first.b[0] : 0);
    const ask = Number(Array.isArray(first.a) ? first.a[0] : 0);
    const ch = last - open;
    const chp = open ? (ch / open) * 100 : 0;

    return NextResponse.json({
      ok: true,
      quote: {
        symbol,
        lp: last,
        ch,
        chp,
        open,
        high,
        low,
        previousClose: open,
        volume,
        bid,
        ask
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unable to load Kraken quote."
      },
      { status: 502 }
    );
  }
}
