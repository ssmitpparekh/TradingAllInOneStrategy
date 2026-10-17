-- ALLINONEVIEW persistent exact order-flow storage.
-- Run once in the Supabase SQL editor used for ALLINONEVIEW.

create table if not exists public.market_trade_tape (
  provider text not null,
  market text not null,
  symbol text not null,
  trade_id text not null,
  trade_time timestamptz not null,
  trade_epoch bigint not null,
  price double precision not null,
  qty double precision not null,
  side text not null check (side in ('buy', 'sell')),
  received_at timestamptz not null default now(),
  primary key (provider, symbol, trade_id)
);

create index if not exists market_trade_tape_symbol_time_idx
  on public.market_trade_tape (provider, market, symbol, trade_epoch desc);

create table if not exists public.market_order_flow_1m (
  provider text not null,
  market text not null,
  symbol text not null,
  bucket_time bigint not null,
  buy_volume double precision not null default 0,
  sell_volume double precision not null default 0,
  trades bigint not null default 0,
  quality text not null default 'exact',
  source text not null default 'Persistent exact trade tape',
  refreshed_at timestamptz not null default now(),
  primary key (provider, market, symbol, bucket_time)
);

create index if not exists market_order_flow_1m_symbol_time_idx
  on public.market_order_flow_1m (provider, market, symbol, bucket_time desc);

alter table public.market_trade_tape enable row level security;
alter table public.market_order_flow_1m enable row level security;

-- No public RLS policies are created. The always-on collector and server API
-- use the service-role key; browsers never receive that key.

create or replace function public.refresh_market_order_flow_1m(
  p_provider text,
  p_market text,
  p_symbol text,
  p_from_epoch bigint,
  p_to_epoch bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.market_order_flow_1m (
    provider,
    market,
    symbol,
    bucket_time,
    buy_volume,
    sell_volume,
    trades,
    quality,
    source,
    refreshed_at
  )
  select
    p_provider,
    p_market,
    p_symbol,
    floor(t.trade_epoch / 60.0)::bigint * 60,
    coalesce(sum(case when t.side = 'buy' then t.qty else 0 end), 0),
    coalesce(sum(case when t.side = 'sell' then t.qty else 0 end), 0),
    count(*)::bigint,
    'exact',
    'Persistent exact Kraken trade tape',
    now()
  from public.market_trade_tape t
  where t.provider = p_provider
    and t.market = p_market
    and t.symbol = p_symbol
    and t.trade_epoch >= p_from_epoch
    and t.trade_epoch <= p_to_epoch
  group by floor(t.trade_epoch / 60.0)::bigint * 60
  on conflict (provider, market, symbol, bucket_time)
  do update set
    buy_volume = excluded.buy_volume,
    sell_volume = excluded.sell_volume,
    trades = excluded.trades,
    quality = excluded.quality,
    source = excluded.source,
    refreshed_at = now();
end;
$$;
