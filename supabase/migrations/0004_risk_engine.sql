-- Phase 3, Step 3a: server-authoritative risk-engine write surface.
--
-- Everything here is SECURITY DEFINER and locked to the service_role, so the
-- ONLY way money/positions/trades change is through these validated functions,
-- invoked by trusted server code (the Node risk worker and the API routes added
-- in Step 3b). The browser can never call them and never writes these tables.
--
-- Valuation convention (matches the client's floatingPnlUsd): positions are
-- marked on the CLOSE side of the spread — longs at the bid, shorts at the ask.
-- The worker passes the already-close-side mark price into these functions; the
-- SQL does not re-derive spread, it trusts the server-computed mark.

-- ------------------------------------------------------------ account_events
-- Append-only audit log of every material account state transition. Critical
-- for prop-firm disputes ("why was I breached?").
do $$ begin
  create type account_event_type as enum (
    'daily_reset', 'daily_breach', 'overall_breach', 'target_hit', 'funded_promotion'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.account_events (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  type            account_event_type not null,
  equity_at_event numeric(18,2),
  detail          text,
  created_at      timestamptz not null default now()
);
create index if not exists account_events_account_idx
  on public.account_events (account_id, created_at desc);

alter table public.account_events enable row level security;

-- Read-own (joined through accounts); no client writes (worker inserts only).
drop policy if exists account_events_select_own on public.account_events;
create policy account_events_select_own on public.account_events
  for select using (
    exists (
      select 1 from public.accounts a
      where a.id = account_events.account_id and a.user_id = auth.uid()
    )
  );

-- Block UPDATE/DELETE so the audit trail is tamper-evident.
drop trigger if exists account_events_no_mutation on public.account_events;
create trigger account_events_no_mutation
  before update or delete on public.account_events
  for each row execute function public.block_trade_mutation();

revoke insert, update, delete on public.account_events from anon, authenticated;

-- ----------------------------------------------------------- open_position
-- Validate and open a position atomically. `mark_price` is the server's live
-- mark for the symbol; `entry_fill` is the spread-adjusted entry the worker
-- computed (buy→ask, sell→bid). Margin/commission are passed in already
-- computed by the worker's shared valuation module so SQL and worker agree.
create or replace function public.open_position(
  p_account_id   uuid,
  p_symbol       text,
  p_direction    trade_direction,
  p_volume       numeric,
  p_entry_fill   numeric,
  p_contract_size numeric,
  p_digits       smallint,
  p_margin       numeric,
  p_commission   numeric,
  p_stop_loss    numeric default null,
  p_take_profit  numeric default null
)
returns public.positions
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.accounts;
  used_margin numeric;
  free_margin numeric;
  new_row public.positions;
begin
  select * into acct from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account % not found', p_account_id; end if;
  if acct.status <> 'active' and acct.status <> 'funded' then
    raise exception 'account % is % — trading is closed', p_account_id, acct.status;
  end if;
  if p_volume <= 0 then raise exception 'volume must be positive'; end if;

  -- Free-margin gate against the account's current equity.
  select coalesce(sum(margin), 0) into used_margin
    from public.positions where account_id = p_account_id;
  free_margin := acct.equity - used_margin;
  if p_margin > free_margin then
    raise exception 'insufficient free margin: need %, have %', p_margin, free_margin;
  end if;

  insert into public.positions (
    account_id, symbol, direction, volume, open_price, contract_size, digits,
    stop_loss, take_profit, commission, margin
  ) values (
    p_account_id, p_symbol, p_direction, p_volume, p_entry_fill, p_contract_size,
    p_digits, p_stop_loss, p_take_profit, p_commission, p_margin
  ) returning * into new_row;

  return new_row;
end;
$$;

-- ----------------------------------------------------------- close_position
-- Close a position at a server-computed exit fill, record the immutable trade,
-- and credit/debit the realized PnL to the account balance. Atomic.
create or replace function public.close_position(
  p_position_id uuid,
  p_exit_fill   numeric,
  p_gross_pnl   numeric,
  p_commission  numeric,
  p_reason      close_reason
)
returns public.trades
language plpgsql
security definer
set search_path = public
as $$
declare
  pos public.positions;
  net numeric;
  trade_row public.trades;
begin
  select * into pos from public.positions where id = p_position_id for update;
  if not found then raise exception 'position % not found', p_position_id; end if;

  net := p_gross_pnl - p_commission;

  insert into public.trades (
    account_id, symbol, direction, volume, open_price, close_price,
    open_time, gross_pnl, commission, swap, net_pnl, reason
  ) values (
    pos.account_id, pos.symbol, pos.direction, pos.volume, pos.open_price, p_exit_fill,
    pos.open_time, p_gross_pnl, p_commission, pos.swap, net, p_reason
  ) returning * into trade_row;

  update public.accounts
     set balance = balance + net
   where id = pos.account_id;

  delete from public.positions where id = p_position_id;

  return trade_row;
end;
$$;

-- -------------------------------------------------------------- cancel_order
create or replace function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set status = 'cancelled', cancelled_at = now()
   where id = p_order_id and status = 'working';
end;
$$;

-- ------------------------------------------------------------ apply_risk_tick
-- Called by the worker each tick with the freshly computed equity for an
-- account. Handles the 5pm ET daily-baseline rollover and drawdown breaches.
-- On breach the caller is expected to have already closed every position via
-- close_position(reason => 'breach'); this function freezes the account and
-- writes the audit event. Returns the (possibly updated) status.
create or replace function public.apply_risk_tick(
  p_account_id uuid,
  p_equity     numeric
)
returns account_status
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.accounts;
  daily_floor   numeric;
  overall_floor numeric;
  target_equity numeric;
begin
  select * into acct from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account % not found', p_account_id; end if;

  -- Always keep equity + highwater current.
  update public.accounts
     set equity = p_equity,
         highest_equity = greatest(highest_equity, p_equity)
   where id = p_account_id;

  -- 5pm ET daily rollover: rebase the daily-drawdown anchor to the current
  -- balance once per session.
  if public.needs_daily_reset(acct.last_daily_reset_at, now()) then
    update public.accounts
       set daily_start_balance = balance,
           last_daily_reset_at = public.forex_session_anchor(now())
     where id = p_account_id;
    insert into public.account_events (account_id, type, equity_at_event, detail)
    values (p_account_id, 'daily_reset', p_equity, '5pm ET daily baseline reset');
    -- Refresh local copy for the breach math below.
    select * into acct from public.accounts where id = p_account_id;
  end if;

  if acct.status <> 'active' and acct.status <> 'funded' then
    return acct.status;  -- already terminal
  end if;

  daily_floor   := acct.daily_start_balance * (1 - acct.max_daily_drawdown);
  overall_floor := acct.starting_balance   * (1 - acct.max_overall_drawdown);

  if p_equity <= overall_floor then
    update public.accounts
       set status = 'breached',
           breach_reason = format('Overall drawdown breached: equity %s <= floor %s',
                                   round(p_equity, 2), round(overall_floor, 2))
     where id = p_account_id;
    insert into public.account_events (account_id, type, equity_at_event, detail)
    values (p_account_id, 'overall_breach', p_equity, 'max overall drawdown');
    return 'breached';
  elsif p_equity <= daily_floor then
    update public.accounts
       set status = 'breached',
           breach_reason = format('Daily drawdown breached: equity %s <= floor %s',
                                   round(p_equity, 2), round(daily_floor, 2))
     where id = p_account_id;
    insert into public.account_events (account_id, type, equity_at_event, detail)
    values (p_account_id, 'daily_breach', p_equity, 'max daily drawdown');
    return 'breached';
  end if;

  -- Challenge profit target reached → mark as passed (promotion handled later).
  if acct.phase = 'challenge' and acct.status = 'active' then
    target_equity := acct.starting_balance * (1 + acct.profit_target);
    if p_equity >= target_equity then
      update public.accounts set status = 'passed' where id = p_account_id;
      insert into public.account_events (account_id, type, equity_at_event, detail)
      values (p_account_id, 'target_hit', p_equity, 'profit target reached');
      return 'passed';
    end if;
  end if;

  return acct.status;
end;
$$;

-- ------------------------------------------------------------------ Grants
-- Lock the write surface to the service role only. authenticated/anon never
-- get EXECUTE, so even a leaked anon key cannot move money.
revoke all on function public.open_position(uuid, text, trade_direction, numeric, numeric, numeric, smallint, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.close_position(uuid, numeric, numeric, numeric, close_reason) from public, anon, authenticated;
revoke all on function public.cancel_order(uuid) from public, anon, authenticated;
revoke all on function public.apply_risk_tick(uuid, numeric) from public, anon, authenticated;

grant execute on function public.open_position(uuid, text, trade_direction, numeric, numeric, numeric, smallint, numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.close_position(uuid, numeric, numeric, numeric, close_reason) to service_role;
grant execute on function public.cancel_order(uuid) to service_role;
grant execute on function public.apply_risk_tick(uuid, numeric) to service_role;
