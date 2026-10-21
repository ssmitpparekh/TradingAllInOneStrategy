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
    const value = trimmed.slice(index + 1).trim().replace(/^[\"']|[\"']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function strictSslUrl(value) {
  return value.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
}

loadLocalEnv();
const databaseUrl = strictSslUrl(process.env.DATABASE_URL?.trim() || "");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  keepAlive: true
});

try {
  const before = await pool.query(`
    select
      pg_size_pretty(pg_database_size(current_database())) as database_size,
      pg_size_pretty(pg_total_relation_size('public.market_candles')) as candle_total,
      pg_size_pretty(pg_indexes_size('public.market_candles')) as candle_indexes
  `);

  process.stdout.write(
    `Before: database=${before.rows[0].database_size}, market_candles=${before.rows[0].candle_total}, indexes=${before.rows[0].candle_indexes}\n`
  );

  await pool.query("drop index if exists public.market_candles_lookup_idx");
  await pool.query("drop index if exists public.market_candles_symbol_time_idx");

  const after = await pool.query(`
    select
      pg_size_pretty(pg_database_size(current_database())) as database_size,
      pg_size_pretty(pg_total_relation_size('public.market_candles')) as candle_total,
      pg_size_pretty(pg_indexes_size('public.market_candles')) as candle_indexes
  `);

  process.stdout.write(
    `After:  database=${after.rows[0].database_size}, market_candles=${after.rows[0].candle_total}, indexes=${after.rows[0].candle_indexes}\n`
  );
  process.stdout.write("No candle rows were deleted or modified.\n");
} finally {
  await pool.end();
}
