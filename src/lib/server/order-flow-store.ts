import type { OrderFlowBucket } from "@/lib/analysis/order-flow";
import { getPostgresPool } from "@/lib/server/postgres";

type StoredOrderFlowRow = {
  provider: string;
  market: string;
  symbol: string;
  bucket_time: number | string;
  buy_volume: number;
  sell_volume: number;
  trades: number | string;
  buy_trades: number | string;
  sell_trades: number | string;
  quality: "exact" | "classified";
  source: string;
};

export function orderFlowStoreConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function readStoredOrderFlow(input: {
  provider: string;
  market: string;
  symbol: string;
  from: number;
  to: number;
}) {
  if (!orderFlowStoreConfigured()) {
    return {
      available: false,
      buckets: [] as OrderFlowBucket[],
      reason: "Persistent order-flow storage is not configured on this server."
    };
  }

  const result = await getPostgresPool().query(
    `select
       provider,
       market,
       symbol,
       bucket_time,
       buy_volume,
       sell_volume,
       trades,
       buy_trades,
       sell_trades,
       quality,
       source
     from public.market_order_flow_1m
     where provider = $1
       and market = $2
       and symbol = $3
       and bucket_time >= $4
       and bucket_time <= $5
     order by bucket_time asc`,
    [
      input.provider,
      input.market,
      input.symbol,
      Math.floor(input.from),
      Math.floor(input.to)
    ]
  );

  const rows = result.rows as StoredOrderFlowRow[];

  return {
    available: true,
    buckets: rows.map(
      (row): OrderFlowBucket => ({
        time: Number(row.bucket_time),
        buyVolume: Number(row.buy_volume),
        sellVolume: Number(row.sell_volume),
        trades: Number(row.trades),
        buyTrades: Number(row.buy_trades ?? 0),
        sellTrades: Number(row.sell_trades ?? 0),
        partial: false,
        quality: row.quality,
        source: row.source
      })
    ),
    reason: null
  };
}


export async function upsertStoredOrderFlow(input: {
  provider: string;
  market: string;
  symbol: string;
  buckets: OrderFlowBucket[];
}) {
  if (!orderFlowStoreConfigured() || !input.buckets.length) {
    return 0;
  }

  const pool = getPostgresPool();
  const chunkSize = 400;
  let written = 0;

  for (
    let offset = 0;
    offset < input.buckets.length;
    offset += chunkSize
  ) {
    const chunk = input.buckets.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((bucket, index) => {
      const start = index * 11;
      values.push(
        input.provider,
        input.market,
        input.symbol,
        Math.floor(bucket.time),
        bucket.buyVolume,
        bucket.sellVolume,
        bucket.trades,
        bucket.buyTrades,
        bucket.sellTrades,
        bucket.quality,
        bucket.source
      );

      return `($${start + 1},$${start + 2},$${start + 3},$${start + 4},$${start + 5},$${start + 6},$${start + 7},$${start + 8},$${start + 9},$${start + 10},$${start + 11},now())`;
    });

    await pool.query(
      `insert into public.market_order_flow_1m (
         provider, market, symbol, bucket_time,
         buy_volume, sell_volume, trades, buy_trades, sell_trades,
         quality, source, refreshed_at
       )
       values ${tuples.join(",")}
       on conflict (provider, market, symbol, bucket_time)
       do update set
         buy_volume = excluded.buy_volume,
         sell_volume = excluded.sell_volume,
         trades = excluded.trades,
         buy_trades = excluded.buy_trades,
         sell_trades = excluded.sell_trades,
         quality = excluded.quality,
         source = excluded.source,
         refreshed_at = now()`,
      values
    );

    written += chunk.length;
  }

  return written;
}
