import { getPostgresPool } from "./postgres";

export type StoredMarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
};

export async function readMarketCandles(options: {
  provider: string;
  market: string;
  symbol: string;
  resolution: string;
  from: number;
  to: number;
}): Promise<StoredMarketCandle[]> {
  const pool = getPostgresPool();
  const result = await pool.query(
    `select
       candle_time,
       open,
       high,
       low,
       close,
       volume,
       oi
     from public.market_candles
     where provider = $1
       and market = $2
       and symbol = $3
       and resolution = $4
       and candle_time >= $5
       and candle_time <= $6
     order by candle_time asc`,
    [
      options.provider,
      options.market,
      options.symbol,
      options.resolution,
      options.from,
      options.to
    ]
  );

  return result.rows.map((row) => ({
    time: Number(row.candle_time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume ?? 0),
    ...(row.oi === null || row.oi === undefined
      ? {}
      : { oi: Number(row.oi) })
  }));
}

export async function getMarketCandleCoverage(options: {
  provider: string;
  market: string;
  symbol: string;
  resolution: string;
}) {
  const pool = getPostgresPool();
  const result = await pool.query(
    `select
       min(candle_time) as first_time,
       max(candle_time) as last_time,
       count(*)::bigint as candles
     from public.market_candles
     where provider = $1
       and market = $2
       and symbol = $3
       and resolution = $4`,
    [
      options.provider,
      options.market,
      options.symbol,
      options.resolution
    ]
  );

  const row = result.rows[0];
  return {
    firstTime:
      row?.first_time === null || row?.first_time === undefined
        ? null
        : Number(row.first_time),
    lastTime:
      row?.last_time === null || row?.last_time === undefined
        ? null
        : Number(row.last_time),
    candles: Number(row?.candles ?? 0)
  };
}

export async function upsertMarketCandles(options: {
  provider: string;
  market: string;
  symbol: string;
  resolution: string;
  source: string;
  quality?: string;
  candles: StoredMarketCandle[];
}) {
  if (!options.candles.length) return 0;

  const pool = getPostgresPool();
  const chunkSize = 400;
  let inserted = 0;

  for (let offset = 0; offset < options.candles.length; offset += chunkSize) {
    const chunk = options.candles.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const rows = chunk.map((candle, index) => {
      const base = index * 13;
      values.push(
        options.provider,
        options.market,
        options.symbol,
        options.resolution,
        candle.time,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume ?? 0,
        candle.oi ?? null,
        options.quality ?? "exact_ohlcv",
        options.source
      );

      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4},
        $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8},
        $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12},
        $${base + 13})`;
    });

    const result = await pool.query(
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
         oi,
         quality,
         source
       )
       values ${rows.join(",")}
       on conflict (provider, market, symbol, resolution, candle_time)
       do update set
         open = excluded.open,
         high = excluded.high,
         low = excluded.low,
         close = excluded.close,
         volume = excluded.volume,
         oi = excluded.oi,
         quality = excluded.quality,
         source = excluded.source,
         refreshed_at = now()`,
      values
    );

    inserted += result.rowCount ?? 0;
  }

  return inserted;
}
