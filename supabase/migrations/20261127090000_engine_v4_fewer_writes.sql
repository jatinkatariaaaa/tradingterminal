-- Engine v4: the same risk rules with far fewer database writes and requests.
--
-- Measured on the live project on 2026-11-27 (24 hours): the risk worker sent 467,182 apply_risk_tick
-- requests, one per tradable account per loop. About 84% of them changed nothing, but every call still
-- took a FOR UPDATE row lock. A row lock assigns a transaction id and writes WAL, so even a tick that
-- changed nothing ended in a WAL flush to disk at commit. Equity was also compared unrounded against the
-- numeric(18,2) column, so an account with an open position rewrote its row on every tick even when the
-- stored value did not change.
--
-- This migration keeps every rule exactly as it was and changes only when the database writes:
--   * private.risk_tick holds the rules. It first reads the account without a lock. When nothing would
--     be written and no rule fires, it returns the status straight away: a read-only transaction takes no
--     lock, gets no transaction id and writes no WAL. Otherwise it locks the row and runs the old logic.
--     Equity is compared at the precision the column stores, so a change smaller than half a cent does
--     not rewrite the row (the stored value would be the same either way).
--   * apply_risk_tick keeps its name, arguments, result and grants, and calls private.risk_tick
--     (next migration). Workers that still call it get the fast path without being redeployed.
--   * risk_cycle lets the worker send one loop's equity updates and price updates in a single request and
--     transaction, and returns the account, position and order snapshot the worker trades on. Each part
--     of the snapshot is sent only when it changed (the worker passes back the fingerprints it holds), so
--     a quiet loop costs a few hundred bytes. The snapshot is read in one statement, so balances and
--     positions always come from the same moment.
--
-- This file only adds functions (nothing calls them until the worker runs engine v4). The switch of
-- apply_risk_tick onto private.risk_tick is the next migration, 20261127090100_engine_v4_apply_risk_tick.sql.
--
-- Rollback: supabase/rollbacks/20261127090000_engine_v4_fewer_writes.down.sql restores the previous
-- apply_risk_tick body and drops the new functions.

create schema if not exists private;

create or replace function private.risk_tick(p_account_id uuid, p_equity numeric, p_peak numeric default null)
returns public.account_status
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  acct public.accounts;
  -- What the numeric(18,2) columns would store; a write is skipped when it would store the same value.
  v_equity numeric := round(p_equity, 2);
  -- The worker may persist equity less often than it marks it; p_peak is the highest equity it saw since
  -- the last write, so the high-water mark stays exact.
  v_peak   numeric := round(greatest(p_equity, coalesce(p_peak, p_equity)), 2);
  v_now    timestamptz := now();
  daily_floor   numeric;
  overall_floor numeric;
  breach_floor  numeric;
  breach_type   account_event_type;
  breach_detail text;
  target_equity numeric;
begin
  if p_equity is null then
    raise exception 'equity is required for account %', p_account_id;
  end if;

  -- Fast path: no lock. Return only when the locked path below would write nothing and return this status.
  select * into acct from public.accounts where id = p_account_id;
  if not found then raise exception 'account % not found', p_account_id; end if;

  if not coalesce(acct.equity is distinct from v_equity or acct.highest_equity < v_peak
                  -- the old body also filled in a missing high-water mark on any unrounded change
                  or (acct.highest_equity is null and acct.equity is distinct from p_equity), false)
     and not public.needs_daily_reset(acct.last_daily_reset_at, v_now) then
    if acct.status <> 'active' and acct.status <> 'funded' then
      return acct.status;
    end if;
    daily_floor   := acct.daily_start_balance * (1 - acct.max_daily_drawdown);
    overall_floor := acct.starting_balance   * (1 - acct.max_overall_drawdown);
    -- Any doubt (a null rule, equity at or under a floor, the profit target reached) takes the locked path.
    if coalesce(p_equity > greatest(daily_floor, overall_floor), false)
       and not coalesce(acct.phase = 'challenge' and acct.status = 'active' and acct.profit_target > 0
                        and p_equity >= acct.starting_balance * (1 + acct.profit_target), true) then
      return acct.status;
    end if;
  end if;

  -- Locked path: the engine's rules, unchanged.
  select * into acct from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account % not found', p_account_id; end if;

  if acct.equity is distinct from v_equity or acct.highest_equity < v_peak
     or (acct.highest_equity is null and acct.equity is distinct from p_equity) then
    update public.accounts
       set equity = v_equity,
           highest_equity = greatest(highest_equity, v_peak)
     where id = p_account_id;
  end if;

  if public.needs_daily_reset(acct.last_daily_reset_at, v_now) then
    update public.accounts
       set daily_start_balance = balance,
           last_daily_reset_at = public.forex_session_anchor(v_now)
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

revoke all on function private.risk_tick(uuid, numeric, numeric) from public;
revoke all on function private.risk_tick(uuid, numeric, numeric) from anon, authenticated;

-- One request per worker loop.
--   p_ticks  [{ "id": uuid, "equity": number, "peak": number }]  accounts whose equity changed or that
--            need the 5pm ET roll; each runs through private.risk_tick in its own subtransaction, so one
--            bad account never blocks the others. Locked in id order, so two cycles can never deadlock.
--   p_prices [{ "symbol": text, "price": number, "updated_at": timestamptz }]  same upsert the worker made
--            with a separate request before.
--   p_known  { "accounts": fp, "positions": fp, "orders": fp }  fingerprints of the snapshot parts the worker
--            already holds; a part is only sent back when its fingerprint differs.
create or replace function public.risk_cycle(
  p_ticks  jsonb default '[]'::jsonb,
  p_prices jsonb default '[]'::jsonb,
  p_known  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_known  jsonb := coalesce(p_known, '{}'::jsonb);
  v_ticks  jsonb := '[]'::jsonb;
  v_status public.account_status;
  v_equity numeric;
  v_high   numeric;
  v_now    timestamptz := now();
  v_out    jsonb;
  t        record;
begin
  if jsonb_typeof(p_prices) = 'array' and jsonb_array_length(p_prices) > 0 then
    insert into public.prices as p (symbol, price, updated_at)
    select distinct on (x.symbol) x.symbol, x.price, coalesce(x.updated_at, v_now)
      from jsonb_to_recordset(p_prices) as x(symbol text, price numeric, updated_at timestamptz)
     where x.symbol is not null and x.price > 0
     order by x.symbol, x.updated_at desc nulls last
    on conflict (symbol) do update
      set price = excluded.price,
          updated_at = excluded.updated_at;
  end if;

  if jsonb_typeof(p_ticks) = 'array' and jsonb_array_length(p_ticks) > 0 then
    for t in
      select distinct on (x.id) x.id, x.equity, x.peak
        from jsonb_to_recordset(p_ticks) as x(id uuid, equity numeric, peak numeric)
       where x.id is not null
       order by x.id
    loop
      begin
        v_status := private.risk_tick(t.id, t.equity, t.peak);
        -- What the row now stores, so the worker knows without reading it back.
        select a.equity, a.highest_equity into v_equity, v_high from public.accounts a where a.id = t.id;
        v_ticks := v_ticks || jsonb_build_object('id', t.id, 'status', v_status,
                                                 'equity', v_equity, 'highest_equity', v_high);
      exception when others then
        v_ticks := v_ticks || jsonb_build_object('id', t.id, 'error', sqlerrm);
      end;
    end loop;
  end if;

  -- One statement, so accounts, positions and orders come from the same snapshot.
  with tradable as (
    select a.* from public.accounts a where a.status in ('active', 'funded')
  ),
  pos as (
    select p.* from public.positions p join tradable a on a.id = p.account_id
  ),
  ord as (
    select o.* from public.orders o join tradable a on a.id = o.account_id where o.status = 'working'
  ),
  fp as (
    select
      (select md5(coalesce(string_agg(row(a.id, a.status, a.phase, a.balance, a.starting_balance,
                a.daily_start_balance, a.max_daily_drawdown, a.max_overall_drawdown, a.profit_target,
                a.last_daily_reset_at, a.leverage, a.min_trading_days, a.reset_at)::text, ',' order by a.id), ''))
         from tradable a) as accounts,
      (select md5(coalesce(string_agg(row(p.id, p.account_id, p.symbol, p.direction, p.volume, p.open_price,
                p.contract_size, p.digits, p.stop_loss, p.take_profit, p.commission, p.margin)::text, ',' order by p.id), ''))
         from pos p) as positions,
      (select md5(coalesce(string_agg(row(o.id, o.account_id, o.symbol, o.direction, o.kind, o.volume,
                o.trigger_price, o.placed_price, o.stop_loss, o.take_profit)::text, ',' order by o.id), ''))
         from ord o) as orders
  ),
  clock as (
    select v_now at time zone 'America/New_York' as ny
  )
  select jsonb_build_object(
    'ticks', v_ticks,
    'now', v_now,
    'next_daily_reset_at', (
      select (case when c.ny < date_trunc('day', c.ny) + interval '17 hours'
                   then date_trunc('day', c.ny) + interval '17 hours'
                   else date_trunc('day', c.ny) + interval '1 day' + interval '17 hours'
              end) at time zone 'America/New_York'
        from clock c),
    'due_daily_reset', (
      select coalesce(jsonb_agg(a.id order by a.id), '[]'::jsonb)
        from tradable a where public.needs_daily_reset(a.last_daily_reset_at, v_now)),
    'fp', jsonb_build_object('accounts', f.accounts, 'positions', f.positions, 'orders', f.orders),
    'accounts', case when f.accounts is distinct from v_known->>'accounts' then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'status', a.status, 'phase', a.phase, 'balance', a.balance, 'equity', a.equity,
               'highest_equity', a.highest_equity, 'starting_balance', a.starting_balance,
               'daily_start_balance', a.daily_start_balance, 'max_daily_drawdown', a.max_daily_drawdown,
               'max_overall_drawdown', a.max_overall_drawdown, 'profit_target', a.profit_target,
               'last_daily_reset_at', a.last_daily_reset_at, 'leverage', a.leverage,
               'min_trading_days', a.min_trading_days) order by a.id), '[]'::jsonb)
        from tradable a) end,
    'positions', case when f.positions is distinct from v_known->>'positions' then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'account_id', p.account_id, 'symbol', p.symbol, 'direction', p.direction,
               'volume', p.volume, 'open_price', p.open_price, 'contract_size', p.contract_size,
               'digits', p.digits, 'stop_loss', p.stop_loss, 'take_profit', p.take_profit,
               'commission', p.commission, 'margin', p.margin) order by p.id), '[]'::jsonb)
        from pos p) end,
    'orders', case when f.orders is distinct from v_known->>'orders' then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'account_id', o.account_id, 'symbol', o.symbol, 'direction', o.direction,
               'kind', o.kind, 'volume', o.volume, 'trigger_price', o.trigger_price,
               'placed_price', o.placed_price, 'stop_loss', o.stop_loss, 'take_profit', o.take_profit)
               order by o.id), '[]'::jsonb)
        from ord o) end
  )
  into v_out
  from fp f;

  return v_out;
end;
$function$;

revoke all on function public.risk_cycle(jsonb, jsonb, jsonb) from public;
revoke all on function public.risk_cycle(jsonb, jsonb, jsonb) from anon, authenticated;
grant execute on function public.risk_cycle(jsonb, jsonb, jsonb) to service_role;
