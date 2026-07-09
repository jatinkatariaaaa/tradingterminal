-- Price freshness guard.
--
-- Incident: a worker restart seeded a hardcoded fallback price (EURUSD 1.165)
-- into public.prices. A market order then filled ~200 pips away from the real
-- market (entry 1.16506 vs live 1.14413), instantly breaching the account.
--
-- Defence-in-depth fix (the worker no longer seeds fake prices, but the SQL
-- must also protect itself): open_market_position and close_position_at_market
-- now REJECT any price older than 15 seconds instead of silently filling on it.
-- The worker publishes each symbol at most every 5s, so 15s comfortably covers
-- normal operation while blocking stale/seeded quotes.

-- ------------------------------------------------------- open_market_position
create or replace function public.open_market_position(
  p_user_id     uuid,
  p_account_id  uuid,
  p_symbol      text,
  p_direction   trade_direction,
  p_volume      numeric,
  p_contract_size numeric,
  p_digits      smallint,
  p_category    text,             -- 'forex' | 'crypto' | 'commodities'
  p_stop_loss   numeric default null,
  p_take_profit numeric default null
)
returns public.positions
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.accounts;
  mid numeric;
  price_age interval;
  spread numeric;
  pip numeric;
  entry_fill numeric;
  v_margin numeric;
  commission numeric;
  used_margin numeric;
  free_margin numeric;
  new_row public.positions;
  v_quote_currency text;
  v_usd_per_unit numeric;
begin
  perform public.assert_owns_account(p_account_id, p_user_id);

  select * into acct from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account % not found', p_account_id; end if;
  if acct.status <> 'active' and acct.status <> 'funded' then
    raise exception 'account % is % — trading is closed', p_account_id, acct.status;
  end if;
  if p_volume <= 0 then raise exception 'volume must be positive'; end if;

  -- Server price MUST be fresh. A stale row means the worker is down or was
  -- just restarted — rejecting is always safer than filling on a wrong price.
  select price, now() - updated_at into mid, price_age
    from public.prices where symbol = p_symbol;
  if mid is null then raise exception 'no server price for %', p_symbol; end if;
  if price_age > interval '15 seconds' then
    raise exception 'server price for % is stale (%s old) — order rejected', p_symbol, price_age;
  end if;

  -- Spread mirrors the worker/client valuation module.
  if p_category = 'forex' then
    pip := power(10, -(p_digits - 1));
    spread := 1.2 * pip;
  elsif p_category = 'crypto' then
    spread := mid * 0.0002;
  elsif p_category = 'commodities' then
    spread := mid * 0.00012;
  else
    spread := mid * 0.0001;
  end if;

  -- Entry on the open side: buy -> ask (mid + half), sell -> bid (mid - half).
  entry_fill := case when p_direction = 'buy' then mid + spread / 2 else mid - spread / 2 end;

  -- Extract quote currency to apply usd_per_unit math (matches the client & worker)
  if p_symbol like '%USDT' or p_symbol like '%USD' then
    v_quote_currency := 'USD';
  elsif length(p_symbol) = 6 then
    v_quote_currency := right(p_symbol, 3);
  else
    v_quote_currency := 'USD';
  end if;

  -- Resolve usd_per_unit conversion rate
  if v_quote_currency = 'USD' then
    v_usd_per_unit := 1.0;
  else
    -- Direct conversion (e.g. GBPUSD)
    select price into v_usd_per_unit from public.prices where symbol = (v_quote_currency || 'USD');
    if v_usd_per_unit is null then
      -- Inverse conversion (e.g. USDJPY)
      declare
        v_inverse_price numeric;
      begin
        select price into v_inverse_price from public.prices where symbol = ('USD' || v_quote_currency);
        if v_inverse_price is not null and v_inverse_price > 0 then
          v_usd_per_unit := 1.0 / v_inverse_price;
        else
          v_usd_per_unit := 1.0;
        end if;
      end;
    end if;
  end if;

  -- Margin = (volume * contract_size * entry_fill * v_usd_per_unit) / leverage (100)
  v_margin := (p_volume * p_contract_size * entry_fill * v_usd_per_unit) / 100;
  commission := 3 * 2 * p_volume;  -- round-turn, per lot per side x2

  select coalesce(sum(margin), 0) into used_margin
    from public.positions where account_id = p_account_id;
  free_margin := acct.equity - used_margin;
  if v_margin > free_margin then
    raise exception 'insufficient free margin: need %, have %', v_margin, free_margin;
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

-- --------------------------------------------------- close_position_at_market
create or replace function public.close_position_at_market(
  p_user_id     uuid,
  p_position_id uuid,
  p_category    text
)
returns public.trades
language plpgsql
security definer
set search_path = public
as $$
declare
  pos public.positions;
  mid numeric;
  price_age interval;
  spread numeric;
  pip numeric;
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

  select price, now() - updated_at into mid, price_age
    from public.prices where symbol = pos.symbol;
  if mid is null then raise exception 'no server price for %', pos.symbol; end if;
  if price_age > interval '15 seconds' then
    raise exception 'server price for % is stale (%s old) — close rejected', pos.symbol, price_age;
  end if;

  if p_category = 'forex' then
    pip := power(10, -(pos.digits - 1));
    spread := 1.2 * pip;
  elsif p_category = 'crypto' then
    spread := mid * 0.0002;
  elsif p_category = 'commodities' then
    spread := mid * 0.00012;
  else
    spread := mid * 0.0001;
  end if;

  -- Close side: buy exits on the bid (mid - half), sell on the ask (mid + half).
  exit_fill := case when pos.direction = 'buy' then mid - spread / 2 else mid + spread / 2 end;
  sign := case when pos.direction = 'buy' then 1 else -1 end;
  -- Quote-unit PnL (USD for the majors/crypto/commodities handled here).
  gross := (exit_fill - pos.open_price) * sign * pos.volume * pos.contract_size;
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
