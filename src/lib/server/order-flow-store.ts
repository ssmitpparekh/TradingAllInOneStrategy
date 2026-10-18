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
     order by bucket_time asc
     limit 100000`,
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
