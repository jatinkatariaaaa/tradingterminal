-- Fix: Add staleness guard to open_market_position()
-- Prevents trades from filling at stale/old prices when the risk worker
-- is restarting or WebSocket feeds are temporarily disconnected.
-- If the price in public.prices is older than 60 seconds, the trade is
-- rejected instead of filling at a potentially wildly wrong price.

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
  v_price_updated_at timestamptz;
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

  -- Server price (must be reasonably fresh; the worker updates every tick).
  select price, updated_at into mid, v_price_updated_at
    from public.prices where symbol = p_symbol;
  if mid is null then
    raise exception 'no server price for % — price feed may be disconnected', p_symbol;
  end if;

  -- STALENESS GUARD: reject if the price is older than 60 seconds.
  -- This prevents fills at wildly wrong prices when the worker is restarting
  -- or WebSocket feeds are temporarily disconnected.
  if v_price_updated_at < now() - interval '60 seconds' then
    raise exception 'server price for % is stale (last update: %). Please try again in a moment.',
      p_symbol, v_price_updated_at;
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

  -- Margin = notional_usd / leverage
  v_margin := (p_volume * p_contract_size * entry_fill * v_usd_per_unit) / 100;
  commission := 3.0 * 2 * p_volume;  -- $3 per lot per side, round-turn

  -- Check free margin BEFORE inserting.
  select coalesce(sum(margin), 0) into used_margin
    from public.positions where account_id = p_account_id;
  free_margin := acct.equity - used_margin;
  if v_margin > free_margin then
    raise exception 'insufficient free margin (need %, have %)', round(v_margin, 2), round(free_margin, 2);
  end if;

  -- Insert the new position.
  insert into public.positions (
    account_id, symbol, direction, volume,
    open_price, contract_size, digits,
    stop_loss, take_profit,
    commission, swap, margin, open_time
  ) values (
    p_account_id, p_symbol, p_direction, p_volume,
    entry_fill, p_contract_size, p_digits,
    p_stop_loss, p_take_profit,
    commission, 0, v_margin, now()
  )
  returning * into new_row;

  return new_row;
end;
$$;
