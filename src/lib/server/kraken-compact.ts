import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export type KrakenCompactCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CacheEntry = {
  mtimeMs: number;
  rows: KrakenCompactCandle[];
};

const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 16;

function symbolKey(symbol: string) {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function filePath(symbol: string, resolution: string) {
  return path.join(
    process.cwd(),
    ".data",
    "kraken-compact",
    symbolKey(symbol) + "-" + resolution + ".csv"
  );
}

function remember(key: string, value: CacheEntry) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const first = cache.keys().next().value;
    if (!first) break;
    cache.delete(first);
  }
}

async function loadFile(symbol: string, resolution: string) {
  const filename = filePath(symbol, resolution);

  try {
    const info = await stat(filename);
    const hit = cache.get(filename);
    if (hit && hit.mtimeMs === info.mtimeMs) {
      cache.delete(filename);
      cache.set(filename, hit);
      return hit.rows;
    }

    const raw = await readFile(filename, "utf8");
    const rows = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const parts = line.split(",");
        if (parts.length < 6) return [];

        const row: KrakenCompactCandle = {
          time: Number(parts[0]),
          open: Number(parts[1]),
          high: Number(parts[2]),
          low: Number(parts[3]),
          close: Number(parts[4]),
          volume: Number(parts[5])
        };

        return Number.isFinite(row.time) &&
          Number.isFinite(row.open) &&
          Number.isFinite(row.high) &&
          Number.isFinite(row.low) &&
          Number.isFinite(row.close) &&
          Number.isFinite(row.volume)
          ? [row]
          : [];
      });

    remember(filename, { mtimeMs: info.mtimeMs, rows });
    return rows;
  } catch {
    return [];
  }
}

export async function readKrakenCompactCandles(input: {
  symbol: string;
  resolution: string;
  from: number;
  to: number;
}) {
  const rows = await loadFile(input.symbol, input.resolution);
  if (!rows.length) return [];

  return rows.filter(
    (row) => row.time >= input.from && row.time <= input.to
  );
}

export function krakenCompactPathHint() {
  return path.join(process.cwd(), ".data", "kraken-compact");
}


export async function readKrakenCompactOrderFlow(input: {
  symbol: string;
  from: number;
  to: number;
}) {
  const filename = path.join(
    process.cwd(),
    ".data",
    "kraken-compact",
    symbolKey(input.symbol) + "-orderflow-1m.csv"
  );

  try {
    const raw = await readFile(filename, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const parts = line.split(",");
        if (parts.length < 6) return [];

        const time = Number(parts[0]);
        if (
          !Number.isFinite(time) ||
          time < input.from ||
          time > input.to
        ) {
          return [];
        }

        return [{
          time,
          buyVolume: Number(parts[1]),
          sellVolume: Number(parts[2]),
          trades: Number(parts[3]),
          buyTrades: Number(parts[4]),
          sellTrades: Number(parts[5]),
          partial: false,
          closed: true,
          coverage: "full" as const,
          quality: "exact" as const,
          source: "Kraken official archive/REST compact local recovery"
        }];
      });
  } catch {
    return [];
  }
}
