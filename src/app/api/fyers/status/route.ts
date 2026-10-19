import { NextResponse } from "next/server";
import { getQuote } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readFyersSession();

  if (!session?.accessToken) {
    return NextResponse.json({
      connected: false,
      configured: false,
      connectedAt: null,
      reason: "No FYERS session is stored."
    });
  }

  try {
    // Do not call a stored token "connected" until FYERS accepts it.
    // NIFTY 50 is used only as a lightweight authenticated data probe.
    await getQuote(session.accessToken, "NSE:NIFTY50-INDEX");

    return NextResponse.json({
      connected: true,
      configured: true,
      connectedAt: session.createdAt,
      verified: true
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      configured: true,
      connectedAt: session.createdAt,
      verified: false,
      reconnectRecommended: true,
      reason:
        error instanceof Error
          ? error.message
          : "FYERS rejected the stored session."
    });
  }
}
