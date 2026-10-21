import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(
      "https://api.kraken.com/0/public/SystemStatus",
      {
        headers: { Accept: "application/json" },
        cache: "no-store"
      }
    );
    const body = await response.json();

    const errors = Array.isArray(body?.error) ? body.error : [];
    const status = String(body?.result?.status ?? "");
    const connected =
      response.ok &&
      errors.length === 0 &&
      ["online", "maintenance", "cancel_only", "post_only"].includes(status);

    return NextResponse.json({
      ok: response.ok && errors.length === 0,
      connected,
      status: status || null,
      error: errors.length ? errors.join(", ") : null
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      connected: false,
      status: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to reach Kraken."
    });
  }
}
