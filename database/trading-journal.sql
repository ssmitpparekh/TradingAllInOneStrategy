-- Manual trading journal persisted in Neon.
create table if not exists public.manual_trade_journal (
  id text primary key,
  trade_time bigint not null,
  market text not null,
  instrument_type text not null,
  symbol text not null,
  name text not null default '',
  side text not null check (side in ('BUY','SELL')),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  quantity double precision,
  entry_price double precision,
  stop_loss double precision,
  target_price double precision,
  exit_price double precision,
  amount_in double precision,
  fees double precision not null default 0,
  profit_loss double precision,
  currency text not null default 'INR',
  expiry date,
  strike double precision,
  option_type text check (option_type is null or option_type in ('CE','PE','CALL','PUT')),
  setup text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manual_trade_journal_time_idx
  on public.manual_trade_journal (trade_time desc);

create index if not exists manual_trade_journal_symbol_idx
  on public.manual_trade_journal (symbol, trade_time desc);

create index if not exists manual_trade_journal_market_idx
  on public.manual_trade_journal (market, trade_time desc);
