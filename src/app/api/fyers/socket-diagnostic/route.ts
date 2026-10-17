import { NextResponse } from "next/server";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await readFyersSession();

  if (!session?.accessToken) {
    return NextResponse.json({
      ok: false,
      connected: false,
      problem: "No FYERS access token is stored."
    });
  }

  const payload = decodeJwtPayload(session.accessToken);
  let sdkLoaded = false;
  let sdkHasDataSocket = false;
  let sdkHasGetInstance = false;
  let sdkError: string | null = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require("fyers-api-v3");
    sdkLoaded = Boolean(sdk);
    sdkHasDataSocket = Boolean(sdk?.fyersDataSocket);
    sdkHasGetInstance =
      typeof sdk?.fyersDataSocket?.getInstance === "function";
  } catch (error) {
    sdkError = error instanceof Error ? error.message : String(error);
  }

  const expiresAt =
    payload && typeof payload.exp === "number"
      ? new Date(payload.exp * 1000).toISOString()
      : null;

  return NextResponse.json({
    ok: true,
    connected: true,
    tokenLooksLikeJwt: Boolean(payload),
    tokenHasHsmKey: Boolean(payload && "hsm_key" in payload),
    tokenExpiresAt: expiresAt,
    sdkLoaded,
    sdkHasDataSocket,
    sdkHasGetInstance,
    sdkError
  });
}
