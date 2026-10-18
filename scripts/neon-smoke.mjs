import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const text = readFileSync(".env.local", "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (!(key in process.env)) process.env[key] = value;
  }
}

function strictSslUrl(value) {
  return value.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
}

loadLocalEnv();

const rawConnectionString = process.env.DATABASE_URL?.trim() || "";
if (!rawConnectionString) {
  throw new Error(
    "DATABASE_URL is missing. Run `neon env pull --service postgres` first."
  );
}

const pool = new Pool({
  connectionString: strictSslUrl(rawConnectionString),
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true
});

const client = await pool.connect();
let inTransaction = false;

try {
  const identity = await client.query(
    "select current_database() as database, current_user as user"
  );

  const objects = await client.query(`
    select
      to_regclass('public.market_trade_tape') as trade_table,
      to_regclass('public.market_order_flow_1m') as bucket_table,
      to_regclass('public.market_candles') as candle_table,
      to_regclass('public.manual_trade_journal') as journal_table,
      to_regprocedure(
        'public.refresh_market_order_flow_1m(text,text,text,bigint,bigint)'
      ) as refresh_function
  `);

  const objectRow = objects.rows[0];

  if (
    !objectRow?.trade_table ||
    !objectRow?.bucket_table ||
    !objectRow?.candle_table ||
    !objectRow?.journal_table ||
    !objectRow?.refresh_function
  ) {
    throw new Error(
      "Neon schema is incomplete. Run `npm run db:setup` first."
    );
  }

  await client.query("begin");
  inTransaction = true;

  const nowEpoch = Math.floor(Date.now() / 1000);
  const tradeId = `smoke-${Date.now()}`;

  await client.query(
    `insert into public.market_trade_tape (
       provider,
       market,
       symbol,
       trade_id,
       trade_time,
       trade_epoch,
       price,
       qty,
       side
     )
     values ($1, $2, $3, $4, now(), $5, $6, $7, $8)`,
    ["SMOKE", "SMOKE", "SMOKE/TEST", tradeId, nowEpoch, 100, 2, "buy"]
  );

  await client.query(
    "select public.refresh_market_order_flow_1m($1, $2, $3, $4, $5)",
    [
      "SMOKE",
      "SMOKE",
      "SMOKE/TEST",
      Math.floor(nowEpoch / 60) * 60,
      Math.floor(nowEpoch / 60) * 60 + 59
    ]
  );

  const readBack = await client.query(
    `select trades, buy_trades, sell_trades, buy_volume, sell_volume
       from public.market_order_flow_1m
      where provider = $1
        and market = $2
        and symbol = $3
      order by bucket_time desc
      limit 1`,
    ["SMOKE", "SMOKE", "SMOKE/TEST"]
  );

  await client.query(
    `insert into public.market_candles (
       provider,
       market,
       symbol,
       resolution,
       candle_time,
       open,
       high,
       low,
       close,
       volume,
       quality,
       source
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (provider, market, symbol, resolution, candle_time)
     do update set close = excluded.close`,
    [
      "SMOKE",
      "SMOKE",
      "SMOKE/TEST",
      "1",
      nowEpoch,
      100,
      101,
      99,
      100.5,
      10,
      "exact_ohlcv",
      "Smoke test"
    ]
  );

  const candleReadBack = await client.query(
    `select close
       from public.market_candles
      where provider = $1
        and market = $2
        and symbol = $3
        and resolution = $4
        and candle_time = $5`,
    ["SMOKE", "SMOKE", "SMOKE/TEST", "1", nowEpoch]
  );

  if (
    !candleReadBack.rows[0] ||
    Number(candleReadBack.rows[0].close) !== 100.5
  ) {
    throw new Error("Neon candle cache smoke test failed.");
  }

  const row = readBack.rows[0];

  if (
    !row ||
    Number(row.trades) !== 1 ||
    Number(row.buy_trades) !== 1 ||
    Number(row.sell_trades) !== 0 ||
    Number(row.buy_volume) !== 2
  ) {
    throw new Error("Neon write/read/function smoke test failed.");
  }

  process.stdout.write(
    `Neon smoke test passed: database=${identity.rows[0].database}, user=${identity.rows[0].user}.\n`
  );
} finally {
  if (inTransaction) {
    await client.query("rollback").catch(() => {});
  }

  client.release();
  await pool.end();
}
