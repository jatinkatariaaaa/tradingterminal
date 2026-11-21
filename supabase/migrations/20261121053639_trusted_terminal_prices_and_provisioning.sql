-- The CRM can issue an account before its business row exists. The terminal ID
-- is the stable issue key; preserve the original identity across lifecycle changes.
alter table public.accounts add column provisioning_fingerprint text;

-- Preserve event time and never let a lagging worker overwrite a newer quote.
create function public.publish_terminal_prices(p_quotes jsonb)
returns void language sql set search_path = '' as $$
  insert into public.prices(symbol, price, updated_at)
    select symbol, price, updated_at from jsonb_to_recordset(p_quotes) as q(symbol text, price numeric, updated_at timestamptz)
    where price > 0 and updated_at between now() - interval '120 seconds' and now()
    on conflict (symbol) do update set price = excluded.price, updated_at = excluded.updated_at
    where public.prices.updated_at is null or excluded.updated_at > public.prices.updated_at
$$;
revoke all on function public.publish_terminal_prices(jsonb) from public, anon, authenticated;
grant execute on function public.publish_terminal_prices(jsonb) to service_role;

create function public.position_asset_class(p_symbol text) returns text
language sql immutable strict set search_path = '' as $$
  select case
    when p_symbol in ('BTC/USD','ETH/USD','BTCUSDT','ETHUSDT') then 'crypto'
    when p_symbol in ('XAUUSD','XAGUSD','XPTUSD','XPDUSD','USOIL','UKOIL','NATGAS') then 'commodities'
    else 'forex'
  end
$$;
revoke all on function public.position_asset_class(text) from public, anon, authenticated;
grant execute on function public.position_asset_class(text) to service_role;

-- Missing conversion quotes must never value foreign currency at USD parity.
create or replace function public.usd_per_quote_unit(p_symbol text)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  currency text := right(p_symbol, 3);
  rate numeric;
begin
  if p_symbol like '%USD' or p_symbol like '%USDT' or p_symbol in ('USOIL','UKOIL','NATGAS') then return 1; end if;
  select case when symbol = currency || 'USD' then price else 1 / price end into rate
    from public.prices where symbol in (currency || 'USD', 'USD' || currency) and price > 0
      and updated_at between now() - interval '120 seconds' and now() order by updated_at desc limit 1;
  if rate is null then raise exception 'No fresh USD conversion quote for %', p_symbol; end if;
  return rate;
end
$$;

-- Existing callers may still supply p_category; the stored position determines its spread.
create or replace function public.close_position_at_market(p_user_id uuid, p_position_id uuid, p_category text default null)
returns public.trades language plpgsql security definer set search_path = public, pg_temp as $$
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
  if mid is null or mid <= 0 then raise exception 'no server price for %', pos.symbol; end if;
  if v_price_updated_at is null or v_price_updated_at > now() or v_price_updated_at < now() - interval '120 seconds' then
    raise exception 'server price for % is stale (last update: %). Please try again in a moment.',
      pos.symbol, v_price_updated_at;
  end if;

  spread := public.class_spread(public.position_asset_class(pos.symbol), mid, pos.digits);
  exit_fill := case when pos.direction = 'buy' then mid - spread / 2 else mid + spread / 2 end;
  sign := case when pos.direction = 'buy' then 1 else -1 end;

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

create or replace function public.partial_close_position_at_market(p_user_id uuid, p_position_id uuid, p_close_volume numeric, p_category text default null)
returns public.trades language plpgsql security definer set search_path = public, pg_temp as $$
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
    return public.close_position_at_market(p_user_id, p_position_id);
  end if;

  select price, updated_at into mid, v_price_updated_at from public.prices where symbol = pos.symbol;
  if mid is null or mid <= 0 then raise exception 'no server price for %', pos.symbol; end if;
  if v_price_updated_at is null or v_price_updated_at > now() or v_price_updated_at < now() - interval '120 seconds' then
    raise exception 'server price for % is stale (last update: %). Please try again in a moment.',
      pos.symbol, v_price_updated_at;
  end if;

  spread := public.class_spread(public.position_asset_class(pos.symbol), mid, pos.digits);
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
