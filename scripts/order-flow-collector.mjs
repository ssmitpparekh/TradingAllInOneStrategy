import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

const databaseUrl = strictSslUrl(process.env.DATABASE_URL?.trim() || "");
const configuredSymbols =
  process.env.ORDER_FLOW_KRAKEN_SYMBOLS ||
  "BTC/USD,ETH/USD,SOL/USD,XRP/USD";
const symbols = configuredSymbols
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!databaseUrl) {
  throw new Error(
    "Persistent order-flow collector needs DATABASE_URL. Run `neon env pull --service postgres` first."
  );
}

if (!symbols.length) {
  throw new Error("ORDER_FLOW_KRAKEN_SYMBOLS is empty.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true
});

let socket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let flushTimer = null;
let pending = [];
let flushing = false;
let stopping = false;

function fallbackTradeId(item, epoch) {
  return createHash("sha256")
    .update(
      [
        item.symbol,
        epoch,
        item.price,
        item.qty,
        item.side,
        item.ord_type ?? ""
      ].join("|")
    )
    .digest("hex");
}

const INSERT_CHUNK_SIZE = 500;

async function insertTrades(rows) {
  if (!rows.length) return;

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

      return `(${start + 1},${start + 2},${start + 3},${start + 4},${start + 5},${start + 6},${start + 7},${start + 8},${start + 9})`;
    });

    await pool.query(
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
       values ${tuples.join(",")}
       on conflict (provider, symbol, trade_id) do nothing`,
      values
    );
  }
}

async function refreshBars(symbol, fromEpoch, toEpoch) {
  await pool.query(
    "select public.refresh_market_order_flow_1m($1, $2, $3, $4, $5)",
    ["KRAKEN", "KRAKEN", symbol, fromEpoch, toEpoch]
  );
}

async function flush() {
  if (flushing || !pending.length) return;
  flushing = true;

  const batch = pending;
  pending = [];

  try {
    await insertTrades(batch);

    const bySymbol = new Map();
    for (const row of batch) {
      const current = bySymbol.get(row.symbol);

      if (!current) {
        bySymbol.set(row.symbol, {
          min: row.trade_epoch,
          max: row.trade_epoch
        });
      } else {
        current.min = Math.min(current.min, row.trade_epoch);
        current.max = Math.max(current.max, row.trade_epoch);
      }
    }

    await Promise.all(
      [...bySymbol.entries()].map(([symbol, range]) =>
        refreshBars(
          symbol,
          Math.floor(range.min / 60) * 60,
          Math.floor(range.max / 60) * 60 + 59
        )
      )
    );

    process.stdout.write(
      `[${new Date().toISOString()}] stored ${batch.length} exact Kraken trades\n`
    );
  } catch (error) {
    // Requeue the entire failed batch. Never silently discard exact trade tape.
    // Successful chunks are safe to retry because the table has an idempotent
    // provider/symbol/trade_id primary key with ON CONFLICT DO NOTHING.
    pending = [...batch, ...pending];

    process.stderr.write(
      `[${new Date().toISOString()}] collector flush error: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  } finally {
    flushing = false;
  }
}

function connect() {
  if (stopping) return;

  if (typeof WebSocket === "undefined") {
    throw new Error(
      "This collector requires a Node runtime with the built-in WebSocket API (Node 22+)."
    );
  }

  process.stdout.write(
    `[${new Date().toISOString()}] connecting Kraken exact trade tape for ${symbols.join(", ")}\n`
  );

  socket = new WebSocket("wss://ws.kraken.com/v2");

  socket.addEventListener("open", () => {
    reconnectDelay = 1000;

    socket.send(
      JSON.stringify({
        method: "subscribe",
        params: {
          channel: "trade",
          symbol: symbols,
          snapshot: false
        }
      })
    );
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data));

      if (message?.channel !== "trade" || !Array.isArray(message.data)) {
        if (message?.success === false) {
          process.stderr.write(
            `[${new Date().toISOString()}] Kraken subscription error: ${String(
              message.error ?? "unknown"
            )}\n`
          );
        }
        return;
      }

      for (const item of message.data) {
        const timestamp = Date.parse(String(item.timestamp ?? ""));
        const qty = Number(item.qty ?? 0);
        const price = Number(item.price ?? 0);
        const side =
          item.side === "buy" || item.side === "sell"
            ? item.side
            : null;

        if (
          !Number.isFinite(timestamp) ||
          !(qty > 0) ||
          !(price > 0) ||
          !side ||
          !item.symbol
        ) {
          continue;
        }

        const epoch = Math.floor(timestamp / 1000);
        const tradeId =
          item.trade_id === null || item.trade_id === undefined
            ? fallbackTradeId(item, epoch)
            : String(item.trade_id);

        pending.push({
          provider: "KRAKEN",
          market: "KRAKEN",
          symbol: String(item.symbol),
          trade_id: tradeId,
          trade_time: new Date(timestamp).toISOString(),
          trade_epoch: epoch,
          price,
          qty,
          side
        });
      }

      if (pending.length >= 500) {
        void flush();
      }
    } catch {
      // Ignore unsupported upstream messages.
    }
  });

  const reconnect = () => {
    if (stopping || reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(30_000, reconnectDelay * 2);
      connect();
    }, reconnectDelay);
  };

  socket.addEventListener("error", reconnect);
  socket.addEventListener("close", reconnect);
}

flushTimer = setInterval(() => {
  void flush();
}, 2000);

const shutdown = async () => {
  if (stopping) return;
  stopping = true;

  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (flushTimer) clearInterval(flushTimer);

  try {
    socket?.close();
  } catch {
    // no-op
  }

  await flush();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

connect();
