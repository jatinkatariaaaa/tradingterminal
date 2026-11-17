-- ════════════════════════════════════════════════════════════════════
-- Engine v3: firm-side controls (17 Nov 2026)
--
--  * accounts.leverage: per-account leverage. Margin used to be hard-coded
--    at 1:100 inside open_market_position; the admin "change leverage"
--    action only edited a label in the CRM.
--  * admin_freeze_account(): close every position at the current server
--    price, cancel working orders, then mark the account suspended or
--    breached, all in one transaction. The CRM used to flip a status and
--    leave positions open on an account nobody was ticking any more.
--  * admin_unfreeze_account(): put a suspended account back to trading.
--  * admin_reset_account(): give an account a fresh start in place.
-- Service role only.
-- ════════════════════════════════════════════════════════════════════

alter table public.accounts
  add column if not exists leverage integer not null default 100,
  add column if not exists reset_at timestamptz;

-- Trading days count from the last in-place reset, so a reset account earns its days again.
create or replace function public.account_trading_days(p_account_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with a as (select coalesce(reset_at, '-infinity'::timestamptz) as since from public.accounts where id = p_account_id)
  select count(distinct d)::int from (
    select ((t.open_time at time zone 'America/New_York') + interval '7 hours')::date as d
      from public.trades t, a where t.account_id = p_account_id and t.open_time >= a.since
    union
    select ((p.open_time at time zone 'America/New_York') + interval '7 hours')::date
      from public.positions p where p.account_id = p_account_id
  ) s;
$$;

do $$ begin
  alter table public.accounts add constraint accounts_leverage_range check (leverage between 1 and 500);
exception when duplicate_object then null; end $$;

-- Asset class from the symbol, for the spread model (positions do not store it).
create or replace function public.symbol_category(p_symbol text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_symbol like '%/USD' or p_symbol like '%USDT' then 'crypto'
    when p_symbol like 'XA%' or p_symbol in ('USOIL', 'UKOIL', 'WTIUSD') then 'commodities'
    else 'forex'
  end;
$$;
revoke all on function public.symbol_category(text) from public, anon, authenticated;
grant execute on function public.symbol_category(text) to service_role;

-- ── open a market position: margin now uses the account's leverage ──
create or replace function public.open_market_position(
  p_user_id uuid,
  p_account_id uuid,
  p_symbol text,
  p_direction trade_direction,
  p_volume numeric,
  p_contract_size numeric,
  p_digits smallint,
  p_category text,
  p_stop_loss numeric default null,
  p_take_profit numeric default null
)
returns public.positions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acct public.accounts;
  mid numeric;
  v_price_updated_at timestamptz;
  spread numeric;
  entry_fill numeric;
  v_margin numeric;
  commission numeric;
  used_margin numeric;
  free_margin numeric;
  new_row public.positions;
begin
  perform public.assert_owns_account(p_account_id, p_user_id);

  select * into acct from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account % not found', p_account_id; end if;
  if acct.status <> 'active' and acct.status <> 'funded' then
    raise exception 'account % is % — trading is closed', p_account_id, acct.status;
  end if;
  if p_volume is null or p_volume <= 0 then raise exception 'volume must be positive'; end if;

  select price, updated_at into mid, v_price_updated_at from public.prices where symbol = p_symbol;
  if mid is null then
    raise exception 'no server price for % — price feed may be disconnected', p_symbol;
  end if;
  if v_price_updated_at < now() - interval '60 seconds' then
    raise exception 'server price for % is stale (last update: %). Please try again in a moment.',
      p_symbol, v_price_updated_at;
  end if;

  spread := public.class_spread(p_category, mid, p_digits);
  entry_fill := case when p_direction = 'buy' then mid + spread / 2 else mid - spread / 2 end;

  if p_direction = 'buy' then
    if p_stop_loss is not null and p_stop_loss >= entry_fill then
      raise exception 'stop loss must be below the entry price for a buy';
    end if;
    if p_take_profit is not null and p_take_profit <= entry_fill then
      raise exception 'take profit must be above the entry price for a buy';
    end if;
  else
    if p_stop_loss is not null and p_stop_loss <= entry_fill then
      raise exception 'stop loss must be above the entry price for a sell';
    end if;
    if p_take_profit is not null and p_take_profit >= entry_fill then
      raise exception 'take profit must be below the entry price for a sell';
    end if;
  end if;

  v_margin := (p_volume * p_contract_size * entry_fill * public.usd_per_quote_unit(p_symbol))
              / greatest(1, coalesce(acct.leverage, 100));
  commission := 3 * 2 * p_volume;

  select coalesce(sum(margin), 0) into used_margin from public.positions where account_id = p_account_id;
  free_margin := acct.equity - used_margin;
  if v_margin > free_margin then
    raise exception 'insufficient free margin: need %, have %', round(v_margin, 2), round(free_margin, 2);
  end if;

  insert into public.positions (
    account_id, symbol, direction, volume, open_price, contract_size, digits,
    stop_loss, take_profit, commission, margin
  ) values (
    p_account_id, p_symbol, p_direction, p_volume, entry_fill, p_contract_size,
    p_digits, p_stop_loss, p_take_profit, commission, v_margin
  ) returning * into new_row;

  return new_row;
end;
$$;

-- ── freeze: close out at market, cancel orders, stop trading ─────────
create or replace function public.admin_freeze_account(p_account_id uuid, p_status account_status, p_reason text default null)
returns public.accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acct public.accounts;
  pos public.positions;
  mid numeric;
  spread numeric;
  exit_fill numeric;
  gross numeric;
  net numeric;
begin
  if p_status not in ('suspended', 'breached') then
    raise exception 'an account can only be frozen as suspended or breached';
  end if;

  select * into acct from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account % not found', p_account_id; end if;

  for pos in select * from public.positions where account_id = p_account_id for update loop
    select price into mid from public.prices where symbol = pos.symbol;
    if mid is null then
      exit_fill := pos.open_price;
      gross := 0;
    else
      spread := public.class_spread(public.symbol_category(pos.symbol), mid, pos.digits);
      exit_fill := case when pos.direction = 'buy' then mid - spread / 2 else mid + spread / 2 end;
      gross := (exit_fill - pos.open_price) * (case when pos.direction = 'buy' then 1 else -1 end)
               * pos.volume * pos.contract_size * public.usd_per_quote_unit(pos.symbol);
    end if;
    net := gross - pos.commission;

    insert into public.trades (
      account_id, symbol, direction, volume, open_price, close_price,
      open_time, gross_pnl, commission, swap, net_pnl, reason
    ) values (
      pos.account_id, pos.symbol, pos.direction, pos.volume, pos.open_price, exit_fill,
      pos.open_time, gross, pos.commission, pos.swap, net,
      case when p_status = 'breached' then 'breach'::close_reason else 'manual'::close_reason end
    );
    update public.accounts set balance = balance + net where id = p_account_id;
    delete from public.positions where id = pos.id;
  end loop;

  update public.orders
     set status = 'cancelled', cancelled_at = now()
   where account_id = p_account_id and status = 'working';

  update public.accounts
     set status = p_status,
         equity = balance,
         breach_reason = case when p_status = 'breached' then coalesce(p_reason, 'Closed by The People Prop') else breach_reason end
   where id = p_account_id
   returning * into acct;

  return acct;
end;
$$;

-- ── unfreeze: a suspended account goes back to trading ───────────────
create or replace function public.admin_unfreeze_account(p_account_id uuid)
returns public.accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acct public.accounts;
begin
  update public.accounts
     set status = case when phase = 'funded' then 'funded'::account_status else 'active'::account_status end
   where id = p_account_id and status = 'suspended'
   returning * into acct;
  if not found then raise exception 'only a suspended account can be re-enabled'; end if;
  return acct;
end;
$$;

-- ── reset in place: a fresh start on the same account ────────────────
-- Closed trades stay in the ledger (it is append-only); the account starts
-- again from its starting balance with a new daily anchor.
create or replace function public.admin_reset_account(p_account_id uuid)
returns public.accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acct public.accounts;
begin
  select * into acct from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account % not found', p_account_id; end if;

  if exists (select 1 from public.positions where account_id = p_account_id) then
    perform public.admin_freeze_account(p_account_id, 'suspended', null);
  end if;
  update public.orders set status = 'cancelled', cancelled_at = now()
   where account_id = p_account_id and status = 'working';

  update public.accounts
     set balance = starting_balance,
         equity = starting_balance,
         daily_start_balance = starting_balance,
         highest_equity = starting_balance,
         breach_reason = null,
         last_daily_reset_at = now(),
         reset_at = now(),
         status = case when phase = 'funded' then 'funded'::account_status else 'active'::account_status end
   where id = p_account_id
   returning * into acct;
  return acct;
end;
$$;

revoke all on function public.admin_freeze_account(uuid, account_status, text) from public, anon, authenticated;
revoke all on function public.admin_unfreeze_account(uuid) from public, anon, authenticated;
revoke all on function public.admin_reset_account(uuid) from public, anon, authenticated;
grant execute on function public.admin_freeze_account(uuid, account_status, text) to service_role;
grant execute on function public.admin_unfreeze_account(uuid) to service_role;
grant execute on function public.admin_reset_account(uuid) to service_role;
