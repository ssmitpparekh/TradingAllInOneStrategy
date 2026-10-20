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

-- The primary key already provides a B-tree on
-- (provider, market, symbol, resolution, candle_time). PostgreSQL can scan
-- that index in either direction, so a second lookup index on the same
-- columns is redundant and wastes substantial storage.
--
-- ALLINONEVIEW candle reads always include provider + market + symbol +
-- resolution. Keep only the primary-key index unless a future measured query
-- pattern demonstrates a need for another index.
drop index if exists public.market_candles_lookup_idx;
drop index if exists public.market_candles_symbol_time_idx;
