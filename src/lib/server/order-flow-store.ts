import type { OrderFlowBucket } from "@/lib/analysis/order-flow";

type StoredOrderFlowRow = {
  provider: string;
  market: string;
  symbol: string;
  bucket_time: number;
  buy_volume: number;
  sell_volume: number;
  trades: number;
  buy_trades: number;
  sell_trades: number;
  quality: "exact" | "classified";
  source: string;
};

function config() {
  const url =
    process.env.ORDER_FLOW_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    "";
  const key =
    process.env.ORDER_FLOW_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";

  return { url: url.replace(/\/$/, ""), key };
}

function headers() {
  const { key } = config();
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    Accept: "application/json"
  };
}

export function orderFlowStoreConfigured() {
  const { url, key } = config();
  return Boolean(url && key);
}

export async function readStoredOrderFlow(input: {
  provider: string;
  market: string;
  symbol: string;
  from: number;
  to: number;
}) {
  const { url } = config();

  if (!orderFlowStoreConfigured()) {
    return {
      available: false,
      buckets: [] as OrderFlowBucket[],
      reason:
        "Persistent order-flow storage is not configured on this server."
    };
  }

  const endpoint = new URL(
    url + "/rest/v1/market_order_flow_1m"
  );
  endpoint.searchParams.set(
    "select",
    "provider,market,symbol,bucket_time,buy_volume,sell_volume,trades,buy_trades,sell_trades,quality,source"
  );
  endpoint.searchParams.set("provider", "eq." + input.provider);
  endpoint.searchParams.set("market", "eq." + input.market);
  endpoint.searchParams.set("symbol", "eq." + input.symbol);
  endpoint.searchParams.set(
    "bucket_time",
    "gte." + Math.floor(input.from)
  );
  endpoint.searchParams.append(
    "bucket_time",
    "lte." + Math.floor(input.to)
  );
  endpoint.searchParams.set("order", "bucket_time.asc");

  const rows: StoredOrderFlowRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < 100000; offset += pageSize) {
    const response = await fetch(endpoint, {
      headers: {
        ...headers(),
        Range: offset + "-" + (offset + pageSize - 1)
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "Persistent order-flow read failed: HTTP " +
          response.status
      );
    }

    const page = (await response.json()) as StoredOrderFlowRow[];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

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
