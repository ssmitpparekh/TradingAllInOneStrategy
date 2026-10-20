import { NextRequest, NextResponse } from "next/server";
import { getPostgresPool } from "@/lib/server/postgres";
import type { JournalTrade, JournalTarget } from "@/lib/analysis/trade-journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canWrite(request: NextRequest) {
  const configured = process.env.PLATFORM_SIGNAL_WRITE_KEY?.trim();

  if (!configured) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${configured}`;
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableFinite(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTargets(value: unknown): JournalTarget[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === "object")
    .slice(0, 3)
    .flatMap((item) => {
      const row = item as Record<string, unknown>;
      const label = String(row.label ?? "");
      const price = Number(row.price);
      const rr = nullableFinite(row.rr);
      const source = String(row.source ?? "");

      if (
        !["T1", "T2", "T3"].includes(label) ||
        !Number.isFinite(price)
      ) {
        return [];
      }

      return [{
        label: label as "T1" | "T2" | "T3",
        price,
        rr,
        source
      }];
    });
}

function normalizeTrade(value: unknown): JournalTrade {
  const row = (value ?? {}) as Partial<JournalTrade>;
  const id = String(row.id ?? "").trim();
  const symbol = String(row.symbol ?? "").trim();
  const market = String(row.market ?? "").trim().toUpperCase();
  const direction = row.direction === "short" ? "short" : "long";
  const setupType = row.setupType === "REACTION" ? "REACTION" : "PRIMARY";
  const moveClass = row.moveClass === "MAJOR" ? "MAJOR" : "TACTICAL";
  const status = row.status === "CLOSED" ? "CLOSED" : "OPEN";
  const outcome = String(row.outcome ?? "OPEN") as JournalTrade["outcome"];
  const targets = normalizeTargets(row.targets);

  if (!id || !symbol || !market) {
    throw new Error("Signal id, market and symbol are required.");
  }

  if (
    !Number.isFinite(Number(row.signalTime)) ||
    !Number.isFinite(Number(row.entry)) ||
    !Number.isFinite(Number(row.initialStop)) ||
    targets.length < 1
  ) {
    throw new Error("Signal is missing locked entry/stop/target data.");
  }

  return {
    id,
    symbol,
    name: String(row.name ?? symbol),
    market,
    setupType,
    moveClass,
    direction,
    signalTime: Math.floor(Number(row.signalTime)),
    confirmationTimeframe:
      row.confirmationTimeframe === "1m" ||
      row.confirmationTimeframe === "5m"
        ? row.confirmationTimeframe
        : "15m",
    entry: Number(row.entry),
    initialStop: Number(row.initialStop),
    currentStop: finite(row.currentStop, Number(row.initialStop)),
    targets,
    trigger: String(row.trigger ?? ""),
    score: finite(row.score, 0),
    status,
    outcome,
    highestTargetHit: Math.max(
      0,
      Math.min(3, Math.floor(finite(row.highestTargetHit, 0)))
    ) as 0 | 1 | 2 | 3,
    resultR: nullableFinite(row.resultR),
    closedTime:
      row.closedTime === null || row.closedTime === undefined
        ? null
        : Math.floor(finite(row.closedTime, 0)) || null,
    ambiguityReason:
      row.ambiguityReason === null || row.ambiguityReason === undefined
        ? null
        : String(row.ambiguityReason),
    createdAt:
      Number.isFinite(Number(row.createdAt)) && Number(row.createdAt) > 0
        ? Math.floor(Number(row.createdAt))
        : Date.now(),
    origin: "LIVE",
    strategyVersion:
      String(
        row.strategyVersion ??
          process.env.PLATFORM_STRATEGY_VERSION ??
          "development"
      ),
    lockedAt: row.lockedAt == null ? null : String(row.lockedAt)
  };
}

function mapRow(row: Record<string, unknown>): JournalTrade {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    name: String(row.name ?? row.symbol ?? ""),
    market: String(row.market),
    setupType:
      row.setup_type === "REACTION" ? "REACTION" : "PRIMARY",
    moveClass:
      row.move_class === "MAJOR" ? "MAJOR" : "TACTICAL",
    direction: row.direction === "short" ? "short" : "long",
    signalTime: Number(row.signal_time),
    confirmationTimeframe:
      row.confirmation_timeframe === "1m" ||
      row.confirmation_timeframe === "5m"
        ? row.confirmation_timeframe
        : "15m",
    entry: Number(row.entry),
    initialStop: Number(row.initial_stop),
    currentStop: Number(row.current_stop),
    targets: normalizeTargets(row.targets),
    trigger: String(row.trigger ?? ""),
    score: Number(row.score ?? 0),
    status: row.status === "CLOSED" ? "CLOSED" : "OPEN",
    outcome: String(row.outcome ?? "OPEN") as JournalTrade["outcome"],
    highestTargetHit: Math.max(
      0,
      Math.min(3, Number(row.highest_target_hit ?? 0))
    ) as 0 | 1 | 2 | 3,
    resultR: row.result_r == null ? null : Number(row.result_r),
    closedTime: row.closed_time == null ? null : Number(row.closed_time),
    ambiguityReason:
      row.ambiguity_reason == null ? null : String(row.ambiguity_reason),
    createdAt: Number(row.created_at),
    origin: "LIVE",
    strategyVersion: String(row.strategy_version ?? "development"),
    lockedAt: row.locked_at == null ? null : String(row.locked_at)
  };
}

function liveSignalMaxAgeSeconds(
  timeframe: JournalTrade["confirmationTimeframe"]
) {
  return timeframe === "1m"
    ? 3 * 60
    : timeframe === "5m"
      ? 12 * 60
      : 35 * 60;
}

async function upsertSignal(trade: JournalTrade) {
  const pool = getPostgresPool();

  const existing = await pool.query(
    "select id from public.platform_signal_journal where id=$1 limit 1",
    [trade.id]
  );

  // A new row is a genuine LIVE signal only if the server receives it inside
  // the same freshness window the live UI uses. Historical/offline replays can
  // update nothing here and therefore can never contaminate live performance.
  if (!existing.rowCount) {
    const now = Math.floor(Date.now() / 1000);
    const age = now - trade.signalTime;
    const maxAge =
      liveSignalMaxAgeSeconds(trade.confirmationTimeframe);

    if (age < -60 || age > maxAge) {
      return {
        saved: null,
        rejected: {
          id: trade.id,
          reason:
            "Not inserted: signal was not locked inside the live signal window."
        }
      };
    }
  }

  const result = await pool.query(
    `insert into public.platform_signal_journal (
       id, signal_time, market, symbol, name, setup_type, move_class,
       direction, confirmation_timeframe, entry, initial_stop, current_stop,
       targets, trigger, score, status, outcome, highest_target_hit, result_r,
       closed_time, ambiguity_reason, created_at, origin, strategy_version,
       locked_at, updated_at
     )
     values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,'LIVE',$23,now(),now()
     )
     on conflict (id) do update set
       current_stop = excluded.current_stop,
       status = excluded.status,
       outcome = excluded.outcome,
       highest_target_hit = excluded.highest_target_hit,
       result_r = excluded.result_r,
       closed_time = excluded.closed_time,
       ambiguity_reason = excluded.ambiguity_reason,
       updated_at = now()
     returning *`,
    [
      trade.id,
      trade.signalTime,
      trade.market,
      trade.symbol,
      trade.name,
      trade.setupType ?? "PRIMARY",
      trade.moveClass ?? "TACTICAL",
      trade.direction,
      trade.confirmationTimeframe,
      trade.entry,
      trade.initialStop,
      trade.currentStop,
      JSON.stringify(trade.targets),
      trade.trigger,
      trade.score,
      trade.status,
      trade.outcome,
      trade.highestTargetHit,
      trade.resultR,
      trade.closedTime,
      trade.ambiguityReason ?? null,
      trade.createdAt,
      trade.strategyVersion ??
        process.env.PLATFORM_STRATEGY_VERSION ??
        "development"
    ]
  );

  return {
    saved: mapRow(result.rows[0]),
    rejected: null
  };
}

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
    const market =
      request.nextUrl.searchParams.get("market")?.trim().toUpperCase() ?? "";

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (market) {
      values.push(market);
      conditions.push(`market = $${values.length}`);
    }

    if (symbol) {
      values.push(symbol);
      conditions.push(`symbol = $${values.length}`);
    }

    const where = conditions.length
      ? "where " + conditions.join(" and ")
      : "";

    const result = await getPostgresPool().query(
      `select *
       from public.platform_signal_journal
       ${where}
       order by signal_time asc, created_at asc
       limit 10000`,
      values
    );

    return NextResponse.json({
      ok: true,
      trades: result.rows.map(mapRow)
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load platform signal history."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!canWrite(request)) {
    return NextResponse.json(
      { ok: false, error: "Platform signal writes are disabled." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const incoming = Array.isArray(body?.trades)
      ? body.trades
      : [body?.trade ?? body];
    const trades = incoming.map(normalizeTrade);

    const saved: JournalTrade[] = [];
    const rejected: Array<{ id: string; reason: string }> = [];

    for (const trade of trades) {
      const result = await upsertSignal(trade);
      if (result.saved) saved.push(result.saved);
      if (result.rejected) rejected.push(result.rejected);
    }

    return NextResponse.json({
      ok: true,
      trades: saved,
      rejected
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to persist platform signal history."
      },
      { status: 400 }
    );
  }
}
