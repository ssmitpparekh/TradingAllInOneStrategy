import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/lib/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualTradeInput = {
  id?: string;
  tradeTime?: number;
  market?: string;
  instrumentType?: string;
  symbol?: string;
  name?: string;
  side?: "BUY" | "SELL";
  status?: "OPEN" | "CLOSED";
  quantity?: number | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  targetPrice?: number | null;
  exitPrice?: number | null;
  amountIn?: number | null;
  fees?: number | null;
  profitLoss?: number | null;
  currency?: string;
  expiry?: string | null;
  strike?: number | null;
  optionType?: "CE" | "PE" | "CALL" | "PUT" | null;
  setup?: string;
  notes?: string;
};

function finiteOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeInput(body: ManualTradeInput) {
  const tradeTime =
    Number.isFinite(Number(body.tradeTime)) && Number(body.tradeTime) > 0
      ? Math.floor(Number(body.tradeTime))
      : Math.floor(Date.now() / 1000);
  const market = cleanText(body.market, "NSE").toUpperCase();
  const instrumentType = cleanText(body.instrumentType, "STOCK").toUpperCase();
  const symbol = cleanText(body.symbol).toUpperCase();
  const name = cleanText(body.name);
  const side = body.side === "SELL" ? "SELL" : "BUY";
  const status = body.status === "CLOSED" ? "CLOSED" : "OPEN";
  const quantity = finiteOrNull(body.quantity);
  const entryPrice = finiteOrNull(body.entryPrice);
  const stopLoss = finiteOrNull(body.stopLoss);
  const targetPrice = finiteOrNull(body.targetPrice);
  const exitPrice = finiteOrNull(body.exitPrice);
  const amountIn = finiteOrNull(body.amountIn);
  const fees = finiteOrNull(body.fees) ?? 0;
  const manualProfitLoss = finiteOrNull(body.profitLoss);
  const currency = cleanText(body.currency, "INR").toUpperCase();
  const expiry = body.expiry ? String(body.expiry).slice(0, 10) : null;
  const strike = finiteOrNull(body.strike);
  const optionType =
    body.optionType && ["CE", "PE", "CALL", "PUT"].includes(body.optionType)
      ? body.optionType
      : null;
  const setup = cleanText(body.setup);
  const notes = cleanText(body.notes);

  if (!symbol) {
    throw new Error("Symbol / instrument name is required.");
  }

  let profitLoss = manualProfitLoss;
  if (
    profitLoss === null &&
    status === "CLOSED" &&
    quantity !== null &&
    entryPrice !== null &&
    exitPrice !== null
  ) {
    const raw =
      side === "BUY"
        ? (exitPrice - entryPrice) * quantity
        : (entryPrice - exitPrice) * quantity;
    profitLoss = raw - fees;
  }

  return {
    tradeTime,
    market,
    instrumentType,
    symbol,
    name,
    side,
    status,
    quantity,
    entryPrice,
    stopLoss,
    targetPrice,
    exitPrice,
    amountIn,
    fees,
    profitLoss,
    currency,
    expiry,
    strike,
    optionType,
    setup,
    notes
  };
}

function mapRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    tradeTime: Number(row.trade_time),
    market: String(row.market),
    instrumentType: String(row.instrument_type),
    symbol: String(row.symbol),
    name: String(row.name ?? ""),
    side: String(row.side),
    status: String(row.status),
    quantity: row.quantity == null ? null : Number(row.quantity),
    entryPrice: row.entry_price == null ? null : Number(row.entry_price),
    stopLoss: row.stop_loss == null ? null : Number(row.stop_loss),
    targetPrice: row.target_price == null ? null : Number(row.target_price),
    exitPrice: row.exit_price == null ? null : Number(row.exit_price),
    amountIn: row.amount_in == null ? null : Number(row.amount_in),
    fees: Number(row.fees ?? 0),
    profitLoss: row.profit_loss == null ? null : Number(row.profit_loss),
    currency: String(row.currency ?? "INR"),
    expiry: row.expiry ? String(row.expiry).slice(0, 10) : null,
    strike: row.strike == null ? null : Number(row.strike),
    optionType: row.option_type == null ? null : String(row.option_type),
    setup: String(row.setup ?? ""),
    notes: String(row.notes ?? ""),
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null
  };
}

export async function GET() {
  try {
    const pool = getPostgresPool();
    const result = await pool.query(
      `select *
       from public.manual_trade_journal
       order by trade_time desc, created_at desc`
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
            : "Unable to load trading journal."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ManualTradeInput;
    const input = normalizeInput(body);
    const id = body.id?.trim() || randomUUID();
    const pool = getPostgresPool();

    const result = await pool.query(
      `insert into public.manual_trade_journal (
         id, trade_time, market, instrument_type, symbol, name, side, status,
         quantity, entry_price, stop_loss, target_price, exit_price, amount_in,
         fees, profit_loss, currency, expiry, strike, option_type, setup, notes
       )
       values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
       )
       returning *`,
      [
        id,
        input.tradeTime,
        input.market,
        input.instrumentType,
        input.symbol,
        input.name,
        input.side,
        input.status,
        input.quantity,
        input.entryPrice,
        input.stopLoss,
        input.targetPrice,
        input.exitPrice,
        input.amountIn,
        input.fees,
        input.profitLoss,
        input.currency,
        input.expiry,
        input.strike,
        input.optionType,
        input.setup,
        input.notes
      ]
    );

    return NextResponse.json({ ok: true, trade: mapRow(result.rows[0]) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unable to add trade."
      },
      { status: 400 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as ManualTradeInput;
    const id = body.id?.trim();
    if (!id) throw new Error("Trade id is required.");

    const input = normalizeInput(body);
    const pool = getPostgresPool();

    const result = await pool.query(
      `update public.manual_trade_journal
       set trade_time=$2, market=$3, instrument_type=$4, symbol=$5, name=$6,
           side=$7, status=$8, quantity=$9, entry_price=$10, stop_loss=$11,
           target_price=$12, exit_price=$13, amount_in=$14, fees=$15,
           profit_loss=$16, currency=$17, expiry=$18, strike=$19,
           option_type=$20, setup=$21, notes=$22, updated_at=now()
       where id=$1
       returning *`,
      [
        id,
        input.tradeTime,
        input.market,
        input.instrumentType,
        input.symbol,
        input.name,
        input.side,
        input.status,
        input.quantity,
        input.entryPrice,
        input.stopLoss,
        input.targetPrice,
        input.exitPrice,
        input.amountIn,
        input.fees,
        input.profitLoss,
        input.currency,
        input.expiry,
        input.strike,
        input.optionType,
        input.setup,
        input.notes
      ]
    );

    if (!result.rows[0]) {
      return NextResponse.json(
        { ok: false, error: "Trade not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, trade: mapRow(result.rows[0]) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unable to update trade."
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (!id) throw new Error("Trade id is required.");

    const pool = getPostgresPool();
    await pool.query(
      "delete from public.manual_trade_journal where id = $1",
      [id]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unable to delete trade."
      },
      { status: 400 }
    );
  }
}
