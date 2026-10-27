import { NextRequest, NextResponse } from "next/server";
import { getPostgresPool } from "@/lib/server/postgres";
import {
  BACKTEST_INSTRUMENTS,
  isBacktestInstrumentKey
} from "@/lib/strategy/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BacktestRow = {
  run_id: string;
  trade_id: string;
  strategy_version: string;
  instrument_key: string;
  provider: string;
  market: string;
  symbol: string;
  setup_type: "PRIMARY" | "REACTION";
  move_class: "TACTICAL" | "MAJOR";
  direction: "long" | "short";
  signal_time: number | string;
  confirmation_timeframe: string;
  entry: number;
  initial_stop: number;
  targets: unknown;
  score: number;
  status: "OPEN" | "CLOSED";
  outcome: string;
  highest_target_hit: number | string;
  result_r: number | null;
  closed_time: number | string | null;
  ambiguity_reason: string | null;
};

function summarize(rows: BacktestRow[]) {
  const closed = rows.filter(
    (row) => row.status === "CLOSED" && row.result_r !== null
  );
  const results = closed.map((row) => Number(row.result_r));
  const wins = results.filter((value) => value > 0);
  const losses = results.filter((value) => value < 0);
  const breakeven = results.filter((value) => value === 0);
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, value) => sum + value, 0)
  );

  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const value of results) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }

  return {
    total: rows.length,
    open: rows.filter((row) => row.status === "OPEN").length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    ambiguous: rows.filter((row) => row.outcome === "AMBIGUOUS").length,
    longTrades: rows.filter((row) => row.direction === "long").length,
    shortTrades: rows.filter((row) => row.direction === "short").length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    totalR: results.reduce((sum, value) => sum + value, 0),
    averageR: results.length
      ? results.reduce((sum, value) => sum + value, 0) / results.length
      : 0,
    profitFactor:
      grossLoss > 0
        ? grossWin / grossLoss
        : grossWin > 0
          ? null
          : 0,
    maxDrawdownR
  };
}

function mapTrade(row: BacktestRow) {
  return {
    runId: row.run_id,
    tradeId: row.trade_id,
    strategyVersion: row.strategy_version,
    instrumentKey: row.instrument_key,
    provider: row.provider,
    market: row.market,
    symbol: row.symbol,
    setupType: row.setup_type,
    moveClass: row.move_class,
    direction: row.direction,
    signalTime: Number(row.signal_time),
    confirmationTimeframe: row.confirmation_timeframe,
    entry: Number(row.entry),
    initialStop: Number(row.initial_stop),
    targets: row.targets,
    score: Number(row.score),
    status: row.status,
    outcome: row.outcome,
    highestTargetHit: Number(row.highest_target_hit),
    resultR: row.result_r === null ? null : Number(row.result_r),
    closedTime: row.closed_time === null ? null : Number(row.closed_time),
    ambiguityReason: row.ambiguity_reason
  };
}

export async function GET(request: NextRequest) {
  try {
    const requested =
      request.nextUrl.searchParams.get("instrument")?.trim().toUpperCase() ||
      "ALL";

    if (requested !== "ALL" && !isBacktestInstrumentKey(requested)) {
      return NextResponse.json(
        { ok: false, error: "Unsupported backtest instrument filter." },
        { status: 400 }
      );
    }

    const pool = getPostgresPool();
    const runResult = await pool.query(
      `select *
       from public.strategy_backtest_runs
       where status = 'COMPLETED'
       order by completed_at desc nulls last, started_at desc
       limit 1`
    );

    const run = runResult.rows[0] ?? null;

    if (!run) {
      return NextResponse.json({
        ok: true,
        available: false,
        instruments: BACKTEST_INSTRUMENTS,
        stats: summarize([]),
        grouped: [],
        trades: [],
        reason:
          "No completed platform backtest exists yet. Backtests are generated only after the official live timestamp is locked."
      });
    }

    const values: unknown[] = [run.id];
    let instrumentWhere = "";
    if (requested !== "ALL") {
      values.push(requested);
      instrumentWhere = `and instrument_key = $${values.length}`;
    }

    const tradeResult = await pool.query(
      `select *
       from public.strategy_backtest_trades
       where run_id = $1
       ${instrumentWhere}
       order by signal_time asc
       limit 50000`,
      values
    );

    const rows = tradeResult.rows as BacktestRow[];
    const grouped = BACKTEST_INSTRUMENTS.map((instrument) => {
      const instrumentRows = rows.filter(
        (row) => row.instrument_key === instrument.key
      );
      return {
        key: instrument.key,
        label: instrument.label,
        stats: summarize(instrumentRows)
      };
    }).filter((item) => item.stats.total > 0);

    return NextResponse.json({
      ok: true,
      available: true,
      instruments: BACKTEST_INSTRUMENTS,
      run: {
        id: run.id,
        strategyVersion: run.strategy_version,
        liveCutoff: run.live_cutoff,
        fullStrategy: Boolean(run.full_strategy),
        dataProfile: String(run.data_profile ?? ""),
        coverage: run.coverage ?? {},
        notes: String(run.notes ?? ""),
        completedAt: run.completed_at
      },
      stats: summarize(rows),
      grouped,
      trades: rows.map(mapTrade)
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load strategy backtests."
      },
      { status: 500 }
    );
  }
}
