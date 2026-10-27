import { NextRequest, NextResponse } from "next/server";
import { getPostgresPool } from "@/lib/server/postgres";
import { PLATFORM_STRATEGY_VERSION } from "@/lib/analysis/platform-strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function identity(request: NextRequest) {
  const market =
    request.nextUrl.searchParams.get("market")?.trim().toUpperCase() || "";
  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() || "";
  const strategyVersion =
    request.nextUrl.searchParams.get("strategyVersion")?.trim() ||
    PLATFORM_STRATEGY_VERSION;

  return { market, symbol, strategyVersion };
}

export async function GET(request: NextRequest) {
  const { market, symbol, strategyVersion } = identity(request);

  if (!market || !symbol) {
    return NextResponse.json(
      { ok: false, error: "market and symbol are required." },
      { status: 400 }
    );
  }

  try {
    const result = await getPostgresPool().query(
      `select last_processed_epoch, last_heartbeat_at
       from public.strategy_runtime_checkpoints
       where strategy_version=$1 and market=$2 and symbol=$3
       limit 1`,
      [strategyVersion, market, symbol]
    );

    const row = result.rows[0] ?? null;
    return NextResponse.json({
      ok: true,
      strategyVersion,
      market,
      symbol,
      checkpoint: row
        ? {
            lastProcessedEpoch: Number(row.last_processed_epoch),
            lastHeartbeatAt: row.last_heartbeat_at
          }
        : null
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to read strategy checkpoint."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const strategyVersion =
      String(body?.strategyVersion ?? PLATFORM_STRATEGY_VERSION).trim();
    const market = String(body?.market ?? "").trim().toUpperCase();
    const symbol = String(body?.symbol ?? "").trim();
    const lastProcessedEpoch = Math.floor(
      Number(body?.lastProcessedEpoch ?? 0)
    );

    if (
      !strategyVersion ||
      !market ||
      !symbol ||
      !Number.isFinite(lastProcessedEpoch) ||
      lastProcessedEpoch <= 0
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid strategy checkpoint payload." },
        { status: 400 }
      );
    }

    const result = await getPostgresPool().query(
      `insert into public.strategy_runtime_checkpoints (
         strategy_version, market, symbol,
         last_processed_epoch, last_heartbeat_at
       )
       values ($1,$2,$3,$4,now())
       on conflict (strategy_version, market, symbol)
       do update set
         last_processed_epoch =
           greatest(
             public.strategy_runtime_checkpoints.last_processed_epoch,
             excluded.last_processed_epoch
           ),
         last_heartbeat_at = now()
       returning last_processed_epoch, last_heartbeat_at`,
      [strategyVersion, market, symbol, lastProcessedEpoch]
    );

    return NextResponse.json({
      ok: true,
      checkpoint: {
        lastProcessedEpoch: Number(result.rows[0].last_processed_epoch),
        lastHeartbeatAt: result.rows[0].last_heartbeat_at
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to update strategy checkpoint."
      },
      { status: 500 }
    );
  }
}
