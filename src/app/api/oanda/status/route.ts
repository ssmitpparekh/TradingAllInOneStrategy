import { NextResponse } from "next/server";
import {
  getOandaAccountId,
  getOandaInstruments,
  oandaBaseUrl
} from "@/lib/oanda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.OANDA_API_TOKEN?.trim()) {
    return NextResponse.json({
      ok: true,
      connected: false,
      configured: false,
      environment: oandaBaseUrl()
    });
  }

  try {
    const [accountId, instruments] = await Promise.all([
      getOandaAccountId(),
      getOandaInstruments()
    ]);

    return NextResponse.json({
      ok: true,
      connected: true,
      configured: true,
      accountId,
      instruments: instruments.length,
      environment: oandaBaseUrl()
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      connected: false,
      configured: true,
      error:
        error instanceof Error
          ? error.message
          : "Unable to connect to OANDA.",
      environment: oandaBaseUrl()
    });
  }
}
