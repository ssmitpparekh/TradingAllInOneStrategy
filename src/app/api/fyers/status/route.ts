import { NextResponse } from "next/server";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readFyersSession();

  return NextResponse.json({
    connected: Boolean(session?.accessToken),
    connectedAt: session?.createdAt ?? null
  });
}
