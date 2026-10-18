-- ALLINONEVIEW persistent historical candle cache.
-- Provider history is cached here so charts do not depend on a fresh upstream
-- request every time a user changes symbol/range/timeframe.

create table if not exists public.market_candles (
  provider text not null,
  market text not null,
  symbol text not null,
  resolution text not null,
  candle_time bigint not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision not null default 0,
  oi double precision,
  quality text not null default 'exact_ohlcv',
  source text not null,
  refreshed_at timestamptz not null default now(),
  primary key (provider, market, symbol, resolution, candle_time)
);

create index if not exists market_candles_lookup_idx
  on public.market_candles (
    provider,
    market,
    symbol,
    resolution,
    candle_time desc
  );

create index if not exists market_candles_symbol_time_idx
  on public.market_candles (symbol, resolution, candle_time desc);
