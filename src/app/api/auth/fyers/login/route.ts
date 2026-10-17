import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { buildAuthorizationUrl } from "@/lib/fyers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "allinoneview_fyers_state";

export async function GET() {
  try {
    const state = randomBytes(32).toString("hex");
    const response = NextResponse.redirect(buildAuthorizationUrl(state));

    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: "/"
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
