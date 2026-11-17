-- ════════════════════════════════════════════════════════════════════
-- Trading engine v2 (16 Nov 2026)
--
--  1. Manual closes booked P&L in the QUOTE currency as if it were USD.
--     Ten pips on one lot of USDJPY is ¥10,000 (about $64) but was credited
--     as $10,000, enough to pass a $100K challenge on a single small move.
--     close_position_at_market / partial_close_position_at_market now convert
--     through usd_per_quote_unit(), the same rule the risk worker uses.
--  2. Minimum trading days are enforced: an evaluation only passes once the
--     account has traded on accounts.min_trading_days distinct sessions.
--  3. Market closes refuse to fill on a stale server price (same guard the
--     open already had), and market opens reject SL/TP on the wrong side.
-- ════════════════════════════════════════════════════════════════════

alter table public.accounts
  add column if not exists min_trading_days integer not null default 0;

-- USD value of one unit of a symbol's quote currency, from public.prices.
create or replace function public.usd_per_quote_unit(p_symbol text)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote text;
  v_rate numeric;
begin
  if p_symbol like '%USDT' or p_symbol like '%USD' then return 1; end if;
  if length(p_symbol) <> 6 then return 1; end if;
  v_quote := right(p_symbol, 3);

  select price into v_rate from public.prices where symbol = v_quote || 'USD';
  if v_rate is not null and v_rate > 0 then return v_rate; end if;

  select price into v_rate from public.prices where symbol = 'USD' || v_quote;
  if v_rate is not null and v_rate > 0 then return 1.0 / v_rate; end if;

  return 1;
end;
$$;
revoke all on function public.usd_per_quote_unit(text) from public, anon, authenticated;
grant execute on function public.usd_per_quote_unit(text) to service_role;

-- Distinct trading sessions (5pm New York rollover) on which the account opened a trade.
create or replace function public.account_trading_days(p_account_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct d)::int from (
    select ((t.open_time at time zone 'America/New_York') + interval '7 hours')::date as d
      from public.trades t where t.account_id = p_account_id
    union
    select ((p.open_time at time zone 'America/New_York') + interval '7 hours')::date
      from public.positions p where p.account_id = p_account_id
  ) s;
$$;
revoke all on function public.account_trading_days(uuid) from public, anon, authenticated;
grant execute on function public.account_trading_days(uuid) to service_role;

-- Synthetic spread in price units for an asset class (mirrors lib/trading/assets.ts
-- and server/risk-worker/src/valuation.ts — change all three together).
create or replace function public.class_spread(p_category text, p_mid numeric, p_digits smallint)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select (case p_category
    when 'forex' then 1.2 * power(10::numeric, -(p_digits - 1)::numeric)
    when 'crypto' then p_mid * 0.0002
    when 'commodities' then p_mid * 0.00012
    else p_mid * 0.0001
  end)::numeric;
$$;
revoke all on function public.class_spread(text, numeric, smallint) from public, anon, authenticated;
grant execute on function public.class_spread(text, numeric, smallint) to service_role;

-- ── open a market position ──────────────────────────────────────────
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

  -- Protective levels must sit on the correct side of the fill.
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

  -- Margin = USD notional / leverage (1:100).
  v_margin := (p_volume * p_contract_size * entry_fill * public.usd_per_quote_unit(p_symbol)) / 100;
  commission := 3 * 2 * p_volume;  -- $3 per lot per side, charged round-turn

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

-- ── close a whole position at market ────────────────────────────────
create or replace function public.close_position_at_market(p_user_id uuid, p_position_id uuid, p_category text)
returns public.trades
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pos public.positions;
  mid numeric;
  v_price_updated_at timestamptz;
  spread numeric;
  exit_fill numeric;
  sign int;
  gross numeric;
  commission numeric;
  net numeric;
  trade_row public.trades;
begin
  select * into pos from public.positions where id = p_position_id for update;
  if not found then raise exception 'position % not found', p_position_id; end if;
  perform public.assert_owns_account(pos.account_id, p_user_id);

  select price, updated_at into mid, v_price_updated_at from public.prices where symbol = pos.symbol;
  if mid is null then raise exception 'no server price for %', pos.symbol; end if;
  if v_price_updated_at < now() - interval '120 seconds' then
    raise exception 'server price for % is stale (last update: %). Please try again in a moment.',
      pos.symbol, v_price_updated_at;
  end if;

  spread := public.class_spread(p_category, mid, pos.digits);
  exit_fill := case when pos.direction = 'buy' then mid - spread / 2 else mid + spread / 2 end;
  sign := case when pos.direction = 'buy' then 1 else -1 end;

  -- P&L in the quote currency, converted to USD.
  gross := (exit_fill - pos.open_price) * sign * pos.volume * pos.contract_size
           * public.usd_per_quote_unit(pos.symbol);
  commission := pos.commission;
  net := gross - commission;

  insert into public.trades (
    account_id, symbol, direction, volume, open_price, close_price,
    open_time, gross_pnl, commission, swap, net_pnl, reason
  ) values (
    pos.account_id, pos.symbol, pos.direction, pos.volume, pos.open_price, exit_fill,
    pos.open_time, gross, commission, pos.swap, net, 'manual'
  ) returning * into trade_row;

  update public.accounts set balance = balance + net where id = pos.account_id;
  delete from public.positions where id = p_position_id;
  return trade_row;
end;
$$;

-- ── close part of a position at market ──────────────────────────────
create or replace function public.partial_close_position_at_market(
  p_user_id uuid,
  p_position_id uuid,
  p_close_volume numeric,
  p_category text
)
returns public.trades
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pos public.positions;
  mid numeric;
  v_price_updated_at timestamptz;
  spread numeric;
  exit_fill numeric;
  sign int;
  gross numeric;
  closed_commission numeric;
  net numeric;
  trade_row public.trades;
  vol_ratio numeric;
begin
  if p_close_volume is null or p_close_volume <= 0 then raise exception 'close volume must be positive'; end if;

  select * into pos from public.positions where id = p_position_id for update;
  if not found then raise exception 'position % not found', p_position_id; end if;
  perform public.assert_owns_account(pos.account_id, p_user_id);

  if p_close_volume >= pos.volume then
    return public.close_position_at_market(p_user_id, p_position_id, p_category);
  end if;

  select price, updated_at into mid, v_price_updated_at from public.prices where symbol = pos.symbol;
  if mid is null then raise exception 'no server price for %', pos.symbol; end if;
  if v_price_updated_at < now() - interval '120 seconds' then
    raise exception 'server price for % is stale (last update: %). Please try again in a moment.',
      pos.symbol, v_price_updated_at;
  end if;

  spread := public.class_spread(p_category, mid, pos.digits);
  exit_fill := case when pos.direction = 'buy' then mid - spread / 2 else mid + spread / 2 end;
  sign := case when pos.direction = 'buy' then 1 else -1 end;

  gross := (exit_fill - pos.open_price) * sign * p_close_volume * pos.contract_size
           * public.usd_per_quote_unit(pos.symbol);

  vol_ratio := p_close_volume / pos.volume;
  closed_commission := pos.commission * vol_ratio;
  net := gross - closed_commission;

  insert into public.trades (
    account_id, symbol, direction, volume, open_price, close_price,
    open_time, gross_pnl, commission, swap, net_pnl, reason
  ) values (
    pos.account_id, pos.symbol, pos.direction, p_close_volume, pos.open_price, exit_fill,
    pos.open_time, gross, closed_commission, pos.swap * vol_ratio, net, 'manual_partial'
  ) returning * into trade_row;

  update public.positions
     set volume = pos.volume - p_close_volume,
         margin = pos.margin - (pos.margin * vol_ratio),
         commission = pos.commission - closed_commission,
         swap = pos.swap - (pos.swap * vol_ratio)
   where id = p_position_id;

  update public.accounts set balance = balance + net where id = pos.account_id;
  return trade_row;
end;
$$;

-- ── per-tick risk bookkeeping ───────────────────────────────────────
create or replace function public.apply_risk_tick(p_account_id uuid, p_equity numeric)
returns account_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- Only write when something moved: every write here fans out to the CRM row.
  if acct.equity is distinct from p_equity or acct.highest_equity < p_equity then
    update public.accounts
       set equity = p_equity,
           highest_equity = greatest(highest_equity, p_equity)
     where id = p_account_id;
  end if;

  -- 5pm New York rollover: rebase the daily-loss anchor to the current balance.
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

  -- Profit target reached -> passed, once the minimum trading days are done.
  -- A target of 0 means a risk-only (funded) account, which never auto-passes.
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
$$;
