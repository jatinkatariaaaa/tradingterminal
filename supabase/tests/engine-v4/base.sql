-- The parts of the live schema the risk engine touches, copied from the live project on 2026-11-27
-- (column types, defaults, triggers and function bodies as deployed). Used only by the engine-v4 tests.

-- gen_random_uuid() is built into PostgreSQL 13+.
create schema if not exists private;

create type account_event_type as enum ('daily_reset','daily_breach','overall_breach','target_hit','funded_promotion');
create type account_phase as enum ('challenge','funded');
create type account_status as enum ('active','passed','breached','funded','suspended');
create type close_reason as enum ('tp','sl','manual','breach','manual_partial');
create type order_kind as enum ('limit','stop');
create type order_status as enum ('working','filled','cancelled');
create type trade_direction as enum ('buy','sell');

create table public.trading_accounts (
  id uuid primary key default gen_random_uuid(),
  balance numeric(15,2) default 0,
  equity numeric(15,2) default 0,
  highest_equity numeric(15,2) default 0,
  current_daily_drawdown numeric(15,2) default 0,
  current_max_drawdown numeric(15,2) default 0,
  status character varying default 'active',
  breach_reason text,
  updated_at timestamptz default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  label text default 'Evaluation',
  phase account_phase default 'challenge',
  status account_status default 'active',
  starting_balance numeric(18,2),
  balance numeric(18,2),
  equity numeric(18,2),
  daily_start_balance numeric(18,2),
  highest_equity numeric(18,2),
  max_daily_drawdown numeric(6,4) default 0.05,
  max_overall_drawdown numeric(6,4) default 0.10,
  profit_target numeric(6,4) default 0.08,
  breach_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_daily_reset_at timestamptz,
  program_key text,
  business_account_id uuid references public.trading_accounts(id),
  min_trading_days integer default 0,
  leverage integer default 100,
  reset_at timestamptz
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  symbol text not null,
  direction trade_direction not null,
  volume numeric(18,4) not null,
  open_price numeric(18,8) not null,
  contract_size numeric(18,4) not null,
  digits smallint not null,
  stop_loss numeric(18,8),
  take_profit numeric(18,8),
  commission numeric(18,4) default 0,
  swap numeric(18,4) default 0,
  margin numeric(18,2) default 0,
  open_time timestamptz default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  symbol text not null,
  direction trade_direction not null,
  kind order_kind not null,
  status order_status default 'working',
  volume numeric(18,4) not null,
  trigger_price numeric(18,8) not null,
  placed_price numeric(18,8) not null,
  stop_loss numeric(18,8),
  take_profit numeric(18,8),
  created_at timestamptz default now(),
  filled_at timestamptz,
  cancelled_at timestamptz
);

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  symbol text not null,
  direction trade_direction not null,
  volume numeric(18,4) not null,
  open_price numeric(18,8) not null,
  close_price numeric(18,8) not null,
  open_time timestamptz not null,
  close_time timestamptz default now() not null,
  gross_pnl numeric(18,4) not null,
  commission numeric(18,4) default 0 not null,
  swap numeric(18,4) default 0 not null,
  net_pnl numeric(18,4) not null,
  reason close_reason not null,
  is_demo boolean default false not null
);

create table public.account_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  type account_event_type not null,
  equity_at_event numeric(18,2),
  detail text,
  created_at timestamptz default now() not null
);

create table public.prices (
  symbol text primary key,
  price numeric(18,8),
  updated_at timestamptz default now()
);

create or replace function public.forex_session_anchor(at timestamp with time zone default now())
returns timestamp with time zone language plpgsql immutable set search_path to 'public', 'pg_temp'
as $function$
declare
  ny_now    timestamp;
  ny_anchor timestamp;
begin
  ny_now := at at time zone 'America/New_York';
  ny_anchor := date_trunc('day', ny_now) + interval '17 hours';
  if ny_now < ny_anchor then
    ny_anchor := ny_anchor - interval '1 day';
  end if;
  return ny_anchor at time zone 'America/New_York';
end;
$function$;

create or replace function public.needs_daily_reset(last_reset timestamp with time zone, at timestamp with time zone default now())
returns boolean language sql immutable set search_path to 'public', 'pg_temp'
as $function$
  select last_reset is null or last_reset < public.forex_session_anchor(at);
$function$;

create or replace function public.account_trading_days(p_account_id uuid)
returns integer language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  with a as (select coalesce(reset_at, '-infinity'::timestamptz) as since from public.accounts where id = p_account_id)
  select count(distinct d)::int from (
    select ((t.open_time at time zone 'America/New_York') + interval '7 hours')::date as d
      from public.trades t, a where t.account_id = p_account_id and t.open_time >= a.since
    union
    select ((p.open_time at time zone 'America/New_York') + interval '7 hours')::date
      from public.positions p where p.account_id = p_account_id
  ) s;
$function$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path to 'public', 'pg_temp'
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.sync_account_to_trading_account()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.business_account_id is not null then
    update public.trading_accounts
    set
      balance = new.balance,
      equity = new.equity,
      status = new.status::text,
      highest_equity = new.highest_equity,
      breach_reason = case when new.status::text = 'breached' then coalesce(new.breach_reason, breach_reason) else breach_reason end,
      current_daily_drawdown = case
        when new.daily_start_balance > 0 then greatest(0, ((new.daily_start_balance - new.equity) / new.daily_start_balance) * 100)
        else 0
      end,
      current_max_drawdown = case
        when new.starting_balance > 0 then greatest(0, ((new.starting_balance - new.equity) / new.starting_balance) * 100)
        else 0
      end
    where id = new.business_account_id;
  end if;
  return new;
end;
$function$;

create trigger accounts_touch_updated_at before update on public.accounts
  for each row execute function touch_updated_at();
create trigger trg_sync_account_changes after update of balance, equity, status, phase, highest_equity on public.accounts
  for each row when (((new.balance is distinct from old.balance) or (new.equity is distinct from old.equity)
    or (new.status is distinct from old.status) or (new.phase is distinct from old.phase)
    or (new.highest_equity is distinct from old.highest_equity)))
  execute function sync_account_to_trading_account();

-- Live apply_risk_tick as deployed before engine v4.
create or replace function public.apply_risk_tick(p_account_id uuid, p_equity numeric)
returns account_status language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  acct public.accounts;
  daily_floor   numeric;
  overall_floor numeric;
  breach_floor  numeric;
  breach_type   account_event_type;
  breach_detail text;
  target_equity numeric;
begin
  select * into acct from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account % not found', p_account_id; end if;

  if acct.equity is distinct from p_equity or acct.highest_equity < p_equity then
    update public.accounts
       set equity = p_equity,
           highest_equity = greatest(highest_equity, p_equity)
     where id = p_account_id;
  end if;

  if public.needs_daily_reset(acct.last_daily_reset_at, now()) then
    update public.accounts
       set daily_start_balance = balance,
           last_daily_reset_at = public.forex_session_anchor(now())
     where id = p_account_id;
    insert into public.account_events (account_id, type, equity_at_event, detail)
    values (p_account_id, 'daily_reset', p_equity, '5pm ET daily baseline reset');
    select * into acct from public.accounts where id = p_account_id;
  end if;

  if acct.status <> 'active' and acct.status <> 'funded' then
    return acct.status;
  end if;

  daily_floor   := acct.daily_start_balance * (1 - acct.max_daily_drawdown);
  overall_floor := acct.starting_balance   * (1 - acct.max_overall_drawdown);

  if daily_floor >= overall_floor then
    breach_floor := daily_floor;
    breach_type := 'daily_breach';
    breach_detail := 'max daily drawdown';
  else
    breach_floor := overall_floor;
    breach_type := 'overall_breach';
    breach_detail := 'max overall drawdown';
  end if;

  if p_equity <= breach_floor then
    update public.accounts
       set status = 'breached',
           breach_reason = format(
             '%s breached: equity %s <= floor %s',
             case when breach_type = 'daily_breach' then 'Daily drawdown' else 'Overall drawdown' end,
             round(p_equity, 2),
             round(breach_floor, 2)
           )
     where id = p_account_id;
    insert into public.account_events (account_id, type, equity_at_event, detail)
    values (p_account_id, breach_type, p_equity, breach_detail);
    return 'breached';
  end if;

  if acct.phase = 'challenge' and acct.status = 'active' and acct.profit_target > 0 then
    target_equity := acct.starting_balance * (1 + acct.profit_target);
    if p_equity >= target_equity then
      if acct.min_trading_days > 0
         and public.account_trading_days(p_account_id) < acct.min_trading_days then
        return acct.status;
      end if;
      update public.accounts set status = 'passed' where id = p_account_id;
      insert into public.account_events (account_id, type, equity_at_event, detail)
      values (p_account_id, 'target_hit', p_equity, 'profit target reached');
      return 'passed';
    end if;
  end if;

  return acct.status;
end;
$function$;

-- Test-only: count row writes on accounts, so the tests can compare how often each version writes.
create table public.write_log (n bigint not null default 0);
insert into public.write_log values (0);
create or replace function public.count_account_write() returns trigger language plpgsql as $$
begin
  update public.write_log set n = n + 1;
  return new;
end $$;
create trigger zz_count_account_write after update on public.accounts
  for each row execute function count_account_write();

-- Roles the migration grants to or revokes from.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
