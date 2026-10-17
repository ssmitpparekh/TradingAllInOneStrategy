import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode } from "@/lib/fyers";
import { saveFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "allinoneview_fyers_state";

function home(request: NextRequest, status: "connected" | "error") {
  return new URL(`/?fyers=${status}`, request.url);
}

export async function GET(request: NextRequest) {
  const authCode = request.nextUrl.searchParams.get("auth_code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;

  if (!authCode || !returnedState || !expectedState || returnedState !== expectedState) {
    const response = NextResponse.redirect(home(request, "error"));
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  try {
    const tokens = await exchangeAuthCode(authCode);

    await saveFyersSession({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      createdAt: new Date().toISOString()
    });

    const response = NextResponse.redirect(home(request, "connected"));
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch {
    const response = NextResponse.redirect(home(request, "error"));
    response.cookies.delete(STATE_COOKIE);
    return response;
  }
}
