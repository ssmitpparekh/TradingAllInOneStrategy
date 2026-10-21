import { NextRequest, NextResponse } from "next/server";
import { getOandaQuote } from "@/lib/oanda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() || "";

  if (!symbol) {
    return NextResponse.json(
      { ok: false, error: "OANDA symbol is required." },
      { status: 400 }
    );
  }

  try {
    const quote = await getOandaQuote(symbol);
    return NextResponse.json({ ok: true, quote });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load OANDA quote."
      },
      { status: 502 }
    );
  }
}
