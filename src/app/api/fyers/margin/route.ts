import { NextRequest, NextResponse } from "next/server";
import { getFyersConfig } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarginRequest = {
  symbol?: string;
  qty?: number;
  side?: 1 | -1;
  productType?: "INTRADAY" | "MARGIN";
};

export async function POST(request: NextRequest) {
  const session = await readFyersSession();

  if (!session?.accessToken) {
    return NextResponse.json(
      { ok: false, error: "FYERS is not connected." },
      { status: 401 }
    );
  }

  let input: MarginRequest;

  try {
    input = (await request.json()) as MarginRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const symbol = input.symbol?.trim() ?? "";
  const qty = Math.floor(Number(input.qty ?? 0));
  const side = input.side === -1 ? -1 : 1;
  const productType =
    input.productType === "INTRADAY" ? "INTRADAY" : "MARGIN";

  if (!symbol || qty < 1) {
    return NextResponse.json(
      { ok: false, error: "A valid symbol and quantity are required." },
      { status: 400 }
    );
  }

  const { appId } = getFyersConfig();

  const response = await fetch(
    "https://api-t1.fyers.in/api/v3/multiorder/margin",
    {
      method: "POST",
      headers: {
        Authorization: `${appId}:${session.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        data: [
          {
            symbol,
            qty,
            side,
            type: 2,
            productType,
            limitPrice: 0,
            stopPrice: 0,
            stopLoss: 0,
            takeProfit: 0
          }
        ]
      }),
      cache: "no-store"
    }
  );

  const body = await response.json();
  const data = body?.data;

  if (!response.ok || body?.s !== "ok" || !data) {
    return NextResponse.json(
      {
        ok: false,
        error:
          body?.message ||
          "FYERS margin calculator is unavailable for this contract."
      },
      { status: response.ok ? 502 : response.status }
    );
  }

  return NextResponse.json({
    ok: true,
    marginTotal: Number(data.margin_total ?? 0),
    marginNewOrder: Number(data.margin_new_order ?? 0),
    marginAvailable: Number(data.margin_avail ?? 0)
  });
}
