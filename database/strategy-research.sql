-- ALLINONEVIEW strategy release, runtime checkpoint and backtest storage.
-- Live platform trades and historical backtests are deliberately separate.

create table if not exists public.platform_strategy_releases (
  id bigserial primary key,
  strategy_version text not null unique,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','LIVE','RETIRED')),
  live_at timestamptz,
  git_commit text,
  ui_commit text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'LIVE' and live_at is not null) or status <> 'LIVE')
);

create unique index if not exists one_active_platform_strategy_release_idx
  on public.platform_strategy_releases ((status))
  where status = 'LIVE';

create or replace function public.protect_platform_live_release()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.live_at is not null then
    if new.strategy_version is distinct from old.strategy_version
       or new.live_at is distinct from old.live_at
       or new.git_commit is distinct from old.git_commit
       or new.ui_commit is distinct from old.ui_commit then
      raise exception 'A recorded platform live release is immutable.';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists protect_platform_live_release_trigger
  on public.platform_strategy_releases;

create trigger protect_platform_live_release_trigger
before update on public.platform_strategy_releases
for each row execute function public.protect_platform_live_release();

create table if not exists public.strategy_runtime_checkpoints (
  strategy_version text not null,
  market text not null,
  symbol text not null,
  last_processed_epoch bigint not null,
  last_heartbeat_at timestamptz not null default now(),
  primary key (strategy_version, market, symbol)
);

create table if not exists public.strategy_backtest_runs (
  id text primary key,
  strategy_version text not null,
  live_cutoff timestamptz not null,
  status text not null default 'RUNNING'
    check (status in ('RUNNING','COMPLETED','FAILED')),
  full_strategy boolean not null default false,
  data_profile text not null default '',
  coverage jsonb not null default '{}'::jsonb,
  notes text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists strategy_backtest_runs_version_time_idx
  on public.strategy_backtest_runs (strategy_version, started_at desc);

create table if not exists public.strategy_backtest_trades (
  run_id text not null references public.strategy_backtest_runs(id)
    on delete cascade,
  trade_id text not null,
  strategy_version text not null,
  instrument_key text not null
    check (instrument_key in (
      'GOLD','BTC','NIFTY50','BANKNIFTY','SENSEX',
      'ETH','CRUDEOIL','USOIL','SILVER'
    )),
  provider text not null,
  market text not null,
  symbol text not null,
  setup_type text not null check (setup_type in ('PRIMARY','REACTION')),
  move_class text not null check (move_class in ('TACTICAL','MAJOR')),
  direction text not null check (direction in ('long','short')),
  signal_time bigint not null,
  confirmation_timeframe text not null,
  entry double precision not null,
  initial_stop double precision not null,
  targets jsonb not null,
  score double precision not null default 0,
  status text not null check (status in ('OPEN','CLOSED')),
  outcome text not null,
  highest_target_hit integer not null default 0,
  result_r double precision,
  closed_time bigint,
  ambiguity_reason text,
  created_at timestamptz not null default now(),
  primary key (run_id, trade_id)
);

create index if not exists strategy_backtest_trades_instrument_time_idx
  on public.strategy_backtest_trades (
    strategy_version, instrument_key, signal_time desc
  );

create index if not exists strategy_backtest_trades_run_time_idx
  on public.strategy_backtest_trades (run_id, signal_time asc);
