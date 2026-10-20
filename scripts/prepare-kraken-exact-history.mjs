import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync
} from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import readline from "node:readline";
import path from "node:path";
import { execFileSync } from "node:child_process";
const LIVE_AT = "2026-10-20T00:52:25-08:00";
const LIVE_EPOCH = Math.floor(Date.parse(LIVE_AT) / 1000);
const RECOVERY_FROM = Math.floor(
  Date.parse("2026-06-01T00:00:00Z") / 1000
);
const Q4_FROM = Math.floor(
  Date.parse("2026-10-01T00:00:00Z") / 1000
);
const QUARTERS = ["2026Q2", "2026Q3"];

const SYMBOLS = [
  {
    symbol: "BTC/USD",
    key: "BTCUSD",
    aliases: ["BTCUSD", "XBTUSD", "XXBTZUSD"]
  },
  {
    symbol: "ETH/USD",
    key: "ETHUSD",
    aliases: ["ETHUSD", "XETHZUSD"]
  },
  {
    symbol: "SOL/USD",
    key: "SOLUSD",
    aliases: ["SOLUSD"]
  }
];

const DATA_ROOT = path.join(process.cwd(), ".data", "kraken-recovery");
const COMPACT_ROOT = path.join(process.cwd(), ".data", "kraken-compact");

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

function normalizeName(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function minuteBucket(epoch) {
  return Math.floor(epoch / 60) * 60;
}

function makeState() {
  return {
    minutes: new Map(),
    firstTrade: null,
    lastTrade: null
  };
}

function acceptTrade(state, time, price, qty, side) {
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(price) ||
    !Number.isFinite(qty) ||
    !(price > 0) ||
    !(qty > 0) ||
    (side !== "buy" && side !== "sell")
  ) {
    return;
  }

  const bucket = minuteBucket(time);
  let row = state.minutes.get(bucket);

  if (!row) {
    row = {
      time: bucket,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      trades: 0,
      buyVolume: 0,
      sellVolume: 0,
      buyTrades: 0,
      sellTrades: 0
    };
    state.minutes.set(bucket, row);
  }

  row.high = Math.max(row.high, price);
  row.low = Math.min(row.low, price);
  row.close = price;
  row.volume += qty;
  row.trades += 1;

  if (side === "buy") {
    row.buyVolume += qty;
    row.buyTrades += 1;
  } else {
    row.sellVolume += qty;
    row.sellTrades += 1;
  }

  state.firstTrade =
    state.firstTrade === null ? time : Math.min(state.firstTrade, time);
  state.lastTrade =
    state.lastTrade === null ? time : Math.max(state.lastTrade, time);
}

function parseTimestamp(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return NaN;
  if (value > 1e15) return value / 1e9;
  if (value > 1e12) return value / 1000;
  return value;
}

async function download(url, destination) {
  try {
    const info = await stat(destination);
    if (info.size > 0) return;
  } catch {}

  process.stdout.write("Downloading " + url + "\n");
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ALLINONEVIEW-Kraken-Compact-Recovery/1.0"
    }
  });

  if (!response.ok || !response.body) {
    throw new Error(
      "Download failed: HTTP " + response.status + " " + url
    );
  }

  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination)
  );
}

async function walk(directory) {
  const output = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) output.push(...(await walk(full)));
    else output.push(full);
  }
  return output;
}

async function processTradeCsv(
  filename,
  state,
  fromEpoch,
  toEpoch
) {
  const input = createReadStream(filename);
  const lines = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  let seen = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (parts.length < 4) continue;

    const time = parseTimestamp(parts[0]);
    if (!Number.isFinite(time)) continue;
    if (time < fromEpoch || time > toEpoch) continue;

    const price = Number(parts[1]);
    const qty = Number(parts[2]);
    const side =
      String(parts[3]).trim().toLowerCase() === "b"
        ? "buy"
        : String(parts[3]).trim().toLowerCase() === "s"
          ? "sell"
          : null;

    if (!side) continue;
    acceptTrade(state, time, price, qty, side);
    seen += 1;
  }

  return seen;
}

async function prepareQuarter(quarter, states) {
  const archive = path.join(DATA_ROOT, "Kraken_Trades_" + quarter + ".zip");
  const extracted = path.join(DATA_ROOT, "extract-" + quarter);
  const url =
    "https://assets.kraken.com/marketing/institutions/Kraken_Trades_" +
    quarter +
    ".zip";

  await download(url, archive);

  await rm(extracted, { recursive: true, force: true });
  await mkdir(extracted, { recursive: true });

  process.stdout.write("Extracting " + quarter + " archive…\n");
  execFileSync("tar", ["-xf", archive, "-C", extracted], {
    stdio: "inherit"
  });

  const files = (await walk(extracted)).filter((file) =>
    file.toLowerCase().endsWith(".csv")
  );

  for (const spec of SYMBOLS) {
    const match = files.find((file) => {
      const stem = normalizeName(path.basename(file, path.extname(file)));
      return spec.aliases.some((alias) => stem === normalizeName(alias));
    });

    if (!match) {
      process.stderr.write(
        "No " + spec.symbol + " trade CSV found in " + quarter + ".\n"
      );
      continue;
    }

    const seen = await processTradeCsv(
      match,
      states.get(spec.symbol),
      RECOVERY_FROM,
      LIVE_EPOCH
    );

    process.stdout.write(
      quarter + " " + spec.symbol + ": " + seen + " trades processed.\n"
    );
  }

  await rm(extracted, { recursive: true, force: true });

  if (process.env.KEEP_KRAKEN_ARCHIVES !== "YES") {
    await rm(archive, { force: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recoverCurrentQuarter(spec, state) {
  let cursor = String(BigInt(Q4_FROM) * 1_000_000_000n);
  let pages = 0;
  let latestTime = 0;
  let retries = 0;

  process.stdout.write(
    "Recovering " + spec.symbol + " from Kraken REST through official live cutoff…\n"
  );

  while (latestTime < LIVE_EPOCH) {
    const url = new URL("https://api.kraken.com/0/public/Trades");
    url.searchParams.set("pair", spec.symbol);
    url.searchParams.set("assetVersion", "1");
    url.searchParams.set("since", cursor);
    url.searchParams.set("count", "1000");

    const response = await fetch(url, {
      headers: {
        "User-Agent": "ALLINONEVIEW-Kraken-Compact-Recovery/1.0"
      },
      cache: "no-store"
    });

    const body = await response.json().catch(() => ({}));
    const errors = Array.isArray(body?.error) ? body.error : [];

    if (!response.ok || errors.length) {
      const message =
        errors.join(", ") || "HTTP " + response.status;
      if (/rate limit/i.test(message) && retries < 8) {
        retries += 1;
        await sleep(1000 * retries);
        continue;
      }
      throw new Error(spec.symbol + ": " + message);
    }

    retries = 0;
    const result = body?.result ?? {};
    const pairKey = Object.keys(result).find((key) => key !== "last");
    const rows =
      pairKey && Array.isArray(result[pairKey]) ? result[pairKey] : [];
    const next =
      result.last === undefined || result.last === null
        ? null
        : String(result.last);

    if (!rows.length || !next || next === cursor) break;

    for (const item of rows) {
      if (!Array.isArray(item) || item.length < 4) continue;

      const time = Number(item[2]);
      if (!Number.isFinite(time)) continue;
      latestTime = Math.max(latestTime, time);

      if (time < Q4_FROM || time > LIVE_EPOCH) continue;

      const price = Number(item[0]);
      const qty = Number(item[1]);
      const side =
        item[3] === "b"
          ? "buy"
          : item[3] === "s"
            ? "sell"
            : null;
      if (side) acceptTrade(state, time, price, qty, side);
    }

    cursor = next;
    pages += 1;

    if (pages % 100 === 0) {
      process.stdout.write(
        spec.symbol +
          ": " +
          pages +
          " pages, reached " +
          new Date(latestTime * 1000).toISOString() +
          "\n"
      );
    }

    if (latestTime >= LIVE_EPOCH) break;
    await sleep(160);
  }

  process.stdout.write(
    spec.symbol +
      ": REST recovery complete after " +
      pages +
      " pages.\n"
  );
}

function aggregateCandles(minuteRows, resolutionMinutes) {
  const seconds = resolutionMinutes * 60;
  const map = new Map();

  for (const row of minuteRows) {
    if (row.trades <= 0) continue;
    const bucket = Math.floor(row.time / seconds) * seconds;
    const existing = map.get(bucket);

    if (!existing) {
      map.set(bucket, {
        time: bucket,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        trades: row.trades
      });
    } else {
      existing.high = Math.max(existing.high, row.high);
      existing.low = Math.min(existing.low, row.low);
      existing.close = row.close;
      existing.volume += row.volume;
      existing.trades += row.trades;
    }
  }

  return [...map.values()].sort((a, b) => a.time - b.time);
}

async function writeCompactCandles(spec, state) {
  const minuteRows = [...state.minutes.values()].sort(
    (a, b) => a.time - b.time
  );

  const resolutions = [1, 5, 15, 30, 60, 240, 1440];

  for (const resolution of resolutions) {
    const rows =
      resolution === 1
        ? minuteRows.filter((row) => row.trades > 0)
        : aggregateCandles(minuteRows, resolution);

    const text = rows
      .map((row) =>
        [
          row.time,
          row.open,
          row.high,
          row.low,
          row.close,
          row.volume,
          row.trades
        ].join(",")
      )
      .join("\n");

    const key = resolution === 1440 ? "1D" : String(resolution);
    await writeFile(
      path.join(COMPACT_ROOT, spec.key + "-" + key + ".csv"),
      text + (text ? "\n" : ""),
      "utf8"
    );
  }
}

async function writeCompactOrderFlow(spec, state) {
  const rows = [];
  const firstMinute = minuteBucket(RECOVERY_FROM);
  const lastMinute = minuteBucket(LIVE_EPOCH);

  for (
    let minute = firstMinute;
    minute <= lastMinute;
    minute += 60
  ) {
    const row = state.minutes.get(minute);
    rows.push(
      [
        minute,
        row?.buyVolume ?? 0,
        row?.sellVolume ?? 0,
        row?.trades ?? 0,
        row?.buyTrades ?? 0,
        row?.sellTrades ?? 0
      ].join(",")
    );
  }

  await writeFile(
    path.join(COMPACT_ROOT, spec.key + "-orderflow-1m.csv"),
    rows.join("\n") + "\n",
    "utf8"
  );
}

loadLocalEnv();

await mkdir(DATA_ROOT, { recursive: true });
await mkdir(COMPACT_ROOT, { recursive: true });

const states = new Map(
  SYMBOLS.map((spec) => [spec.symbol, makeState()])
);

for (const quarter of QUARTERS) {
  await prepareQuarter(quarter, states);
}

for (const spec of SYMBOLS) {
  await recoverCurrentQuarter(spec, states.get(spec.symbol));
}

for (const spec of SYMBOLS) {
  const state = states.get(spec.symbol);
  await writeCompactCandles(spec, state);
  await writeCompactOrderFlow(spec, state);
  process.stdout.write(
    spec.symbol +
      ": compact candles + exact order flow ready from " +
      new Date(RECOVERY_FROM * 1000).toISOString() +
      " through " +
      new Date(LIVE_EPOCH * 1000).toISOString() +
      ".\n"
  );
}

process.stdout.write(
  "\nKraken compact exact history is ready locally. Raw trades were not stored and Neon bulk storage was not increased.\n"
);
