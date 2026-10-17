import { NextRequest, NextResponse } from "next/server";
import { getFyersConfig } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await readFyersSession();

  if (!session?.accessToken) {
    return NextResponse.json(
      { ok: false, error: "FYERS is not connected." },
      { status: 401 }
    );
  }

  const symbols = [
    ...new Set(
      (request.nextUrl.searchParams.get("symbols") ?? "")
        .split(",")
        .map((symbol) => symbol.trim())
        .filter(Boolean)
    )
  ].slice(0, 50);

  if (!symbols.length) {
    return NextResponse.json(
      { ok: false, error: "At least one symbol is required." },
      { status: 400 }
    );
  }

  const { appId } = getFyersConfig();
  const url = new URL("https://api-t1.fyers.in/data/quotes");
  url.searchParams.set("symbols", symbols.join(","));

  const response = await fetch(url, {
    headers: {
      Authorization: `${appId}:${session.accessToken}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const body = await response.json();

  if (!response.ok || body?.s !== "ok" || !Array.isArray(body?.d)) {
    return NextResponse.json(
      {
        ok: false,
        error: body?.message || "FYERS batch quotes failed."
      },
      { status: response.ok ? 502 : response.status }
    );
  }

  const quotes = body.d.flatMap(
    (entry: {
      n?: string;
      s?: string;
      v?: Record<string, unknown>;
    }) => {
      const symbol = String(entry?.n ?? "");
      const v = entry?.v;
      const ltp = Number(v?.lp ?? 0);

      if (!symbol || entry?.s !== "ok" || !(ltp > 0)) return [];

      return [
        {
          symbol,
          ltp,
          change: Number(v?.ch ?? 0),
          changePercent: Number(v?.chp ?? 0),
          timestamp: Number(v?.tt ?? 0)
        }
      ];
    }
  );

  return NextResponse.json({
    ok: true,
    requested: symbols.length,
    returned: quotes.length,
    quotes
  });
}
