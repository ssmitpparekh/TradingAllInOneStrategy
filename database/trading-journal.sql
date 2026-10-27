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


-- Immutable platform-generated strategy suggestions. These are the shared,
-- public performance record rendered back onto charts for every user.
create table if not exists public.platform_signal_journal (
  id text primary key,
  signal_time bigint not null,
  market text not null,
  symbol text not null,
  name text not null default '',
  setup_type text not null check (setup_type in ('PRIMARY','REACTION')),
  move_class text not null check (move_class in ('TACTICAL','MAJOR')),
  direction text not null check (direction in ('long','short')),
  confirmation_timeframe text not null,
  entry double precision not null,
  initial_stop double precision not null,
  current_stop double precision not null,
  targets jsonb not null default '[]'::jsonb,
  trigger text not null default '',
  score double precision not null default 0,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  outcome text not null default 'OPEN',
  highest_target_hit integer not null default 0,
  result_r double precision,
  closed_time bigint,
  ambiguity_reason text,
  created_at bigint not null,
  updated_at timestamptz not null default now()
);

create index if not exists platform_signal_journal_symbol_time_idx
  on public.platform_signal_journal (market, symbol, signal_time desc);

create index if not exists platform_signal_journal_status_idx
  on public.platform_signal_journal (status, signal_time desc);


-- Live platform signals are intentionally separated from historical backtests.
-- Only signals genuinely issued while the live engine is running belong here.
alter table public.platform_signal_journal
  add column if not exists origin text not null default 'LIVE';

alter table public.platform_signal_journal
  add column if not exists strategy_version text not null default 'development';

alter table public.platform_signal_journal
  add column if not exists locked_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_signal_journal_origin_live_only'
  ) then
    alter table public.platform_signal_journal
      add constraint platform_signal_journal_origin_live_only
      check (origin = 'LIVE');
  end if;
end;
$$;

create index if not exists platform_signal_journal_strategy_time_idx
  on public.platform_signal_journal (strategy_version, signal_time desc);
