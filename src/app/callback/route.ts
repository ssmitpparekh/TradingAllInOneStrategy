import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FYERS is configured to redirect to:
 * http://127.0.0.1:8080/callback
 *
 * Keep that dashboard setting unchanged and forward the full query string
 * to the internal auth handler.
 */
export async function GET(request: NextRequest) {
  const target = new URL("/api/auth/fyers/callback", request.url);
  target.search = request.nextUrl.search;

  return NextResponse.redirect(target);
}
