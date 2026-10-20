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
      .replace(/^[\"']|[\"']$/g, "");

    if (!(key in process.env)) process.env[key] = value;
  }
}

function strictSslUrl(value) {
  return value.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
}

function parseIso(name, value) {
  if (!value) throw new Error(`${name} is required (ISO timestamp, e.g. 2026-10-20T02:00:00Z).`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${name} is not a valid timestamp: ${value}`);
  return ms;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

loadLocalEnv();

const databaseUrl = strictSslUrl(process.env.DATABASE_URL?.trim() || "");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const fromMs = parseIso("KRAKEN_RECOVERY_FROM", process.env.KRAKEN_RECOVERY_FROM);
const toMs = parseIso("KRAKEN_RECOVERY_TO", process.env.KRAKEN_RECOVERY_TO);
if (toMs <= fromMs) throw new Error("KRAKEN_RECOVERY_TO must be after KRAKEN_RECOVERY_FROM.");

const symbols = (process.env.ORDER_FLOW_KRAKEN_SYMBOLS || "BTC/USD,ETH/USD,SOL/USD,XRP/USD")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true
});

const INSERT_CHUNK_SIZE = 500;

async function insertTrades(rows) {
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
    const values = [];
    const tuples = chunk.map((row, index) => {
      const start = index * 9;
      values.push(
        row.provider,
        row.market,
        row.symbol,
        row.trade_id,
        row.trade_time,
        row.trade_epoch,
        row.price,
        row.qty,
        row.side
      );
      return `($${start + 1},$${start + 2},$${start + 3},$${start + 4},$${start + 5},$${start + 6},$${start + 7},$${start + 8},$${start + 9})`;
    });

    await pool.query(
      `insert into public.market_trade_tape (
         provider, market, symbol, trade_id, trade_time, trade_epoch, price, qty, side
       )
       values ${tuples.join(",")}
       on conflict (provider, symbol, trade_id) do nothing`,
      values
    );
  }
}

async function refreshBars(symbol) {
  await pool.query(
    "select public.refresh_market_order_flow_1m($1, $2, $3, $4, $5)",
    ["KRAKEN", "KRAKEN", symbol, Math.floor(fromMs / 1000 / 60) * 60, Math.floor(toMs / 1000 / 60) * 60 + 59]
  );
}

async function recoverSymbol(symbol) {
  let cursor = String(BigInt(fromMs) * 1_000_000n);
  let page = 0;
  let totalSeen = 0;
  let totalInWindow = 0;

  while (true) {
    const url = new URL("https://api.kraken.com/0/public/Trades");
    url.searchParams.set("pair", symbol);
    url.searchParams.set("assetVersion", "1");
    url.searchParams.set("since", cursor);
    url.searchParams.set("count", "1000");

    const response = await fetch(url, {
      headers: { "User-Agent": "ALLINONEVIEW-Kraken-Recovery/1.0" }
    });
    if (!response.ok) throw new Error(`${symbol}: Kraken HTTP ${response.status}`);

    const payload = await response.json();
    if (Array.isArray(payload?.error) && payload.error.length) {
      throw new Error(`${symbol}: ${payload.error.join(", ")}`);
    }

    const result = payload?.result ?? {};
    const rows = Array.isArray(result[symbol]) ? result[symbol] : [];
    const nextCursor = result.last ? String(result.last) : null;
    page += 1;
    totalSeen += rows.length;

    const normalized = [];
    let latestMs = null;

    for (const item of rows) {
      if (!Array.isArray(item) || item.length < 7) continue;
      const price = Number(item[0]);
      const qty = Number(item[1]);
      const timestampSeconds = Number(item[2]);
      const side = item[3] === "b" ? "buy" : item[3] === "s" ? "sell" : null;
      const tradeId = item[6] === null || item[6] === undefined ? null : String(item[6]);

      if (!(price > 0) || !(qty > 0) || !Number.isFinite(timestampSeconds) || !side || !tradeId) continue;

      const tradeMs = Math.floor(timestampSeconds * 1000);
      latestMs = latestMs === null ? tradeMs : Math.max(latestMs, tradeMs);

      if (tradeMs < fromMs || tradeMs > toMs) continue;

      normalized.push({
        provider: "KRAKEN",
        market: "KRAKEN",
        symbol,
        trade_id: tradeId,
        trade_time: new Date(tradeMs).toISOString(),
        trade_epoch: Math.floor(timestampSeconds),
        price,
        qty,
        side
      });
    }

    await insertTrades(normalized);
    totalInWindow += normalized.length;

    process.stdout.write(
      `[${new Date().toISOString()}] ${symbol} recovery page ${page}: fetched ${rows.length}, in-window ${normalized.length}\n`
    );

    if (!rows.length || !nextCursor || nextCursor === cursor || (latestMs !== null && latestMs >= toMs)) break;

    cursor = nextCursor;
    await sleep(250);
  }

  await refreshBars(symbol);
  process.stdout.write(
    `[${new Date().toISOString()}] ${symbol} recovery complete: fetched ${totalSeen}, processed ${totalInWindow} exact trades in requested window\n`
  );
}

try {
  process.stdout.write(
    `Recovering exact Kraken trades from ${new Date(fromMs).toISOString()} through ${new Date(toMs).toISOString()} for ${symbols.join(", ")}\n`
  );

  for (const symbol of symbols) {
    await recoverSymbol(symbol);
  }
} finally {
  await pool.end();
}
