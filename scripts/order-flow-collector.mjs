import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

const supabaseUrl = (
  process.env.ORDER_FLOW_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const serviceKey =
  process.env.ORDER_FLOW_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const configuredSymbols =
  process.env.ORDER_FLOW_KRAKEN_SYMBOLS ||
  "BTC/USD,ETH/USD,SOL/USD,XRP/USD";
const symbols = configuredSymbols
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    "Persistent order-flow collector needs ORDER_FLOW_SUPABASE_URL and ORDER_FLOW_SUPABASE_SERVICE_ROLE_KEY."
  );
}

if (!symbols.length) {
  throw new Error("ORDER_FLOW_KRAKEN_SYMBOLS is empty.");
}

const headers = {
  apikey: serviceKey,
  Authorization: "Bearer " + serviceKey,
  "Content-Type": "application/json",
  Accept: "application/json"
};

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

async function insertTrades(rows) {
  if (!rows.length) return;

  const endpoint =
    supabaseUrl +
    "/rest/v1/market_trade_tape?on_conflict=provider,symbol,trade_id";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=ignore-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    throw new Error(
      "Trade tape insert failed: HTTP " +
        response.status +
        " " +
        (await response.text())
    );
  }
}

async function refreshBars(symbol, fromEpoch, toEpoch) {
  const response = await fetch(
    supabaseUrl + "/rest/v1/rpc/refresh_market_order_flow_1m",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_provider: "KRAKEN",
        p_market: "KRAKEN",
        p_symbol: symbol,
        p_from_epoch: fromEpoch,
        p_to_epoch: toEpoch
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      "1m order-flow refresh failed: HTTP " +
        response.status +
        " " +
        (await response.text())
    );
  }
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
      "[" +
        new Date().toISOString() +
        "] stored " +
        batch.length +
        " exact Kraken trades\n"
    );
  } catch (error) {
    pending = [...batch, ...pending].slice(-50000);
    process.stderr.write(
      "[" +
        new Date().toISOString() +
        "] collector flush error: " +
        (error instanceof Error ? error.message : String(error)) +
        "\n"
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
    "[" +
      new Date().toISOString() +
      "] connecting Kraken exact trade tape for " +
      symbols.join(", ") +
      "\n"
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
            "[" +
              new Date().toISOString() +
              "] Kraken subscription error: " +
              String(message.error ?? "unknown") +
              "\n"
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
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

connect();
