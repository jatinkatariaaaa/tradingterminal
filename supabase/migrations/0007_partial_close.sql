-- --------------------------------------------------- partial-close-by-user (market)
create or replace function public.partial_close_position_at_market(
  p_user_id      uuid,
  p_position_id  uuid,
  p_close_volume numeric,
  p_category     text
)
returns public.trades
language plpgsql
security definer
set search_path = public
as $$
declare
  pos public.positions;
  mid numeric;
  spread numeric;
  pip numeric;
  exit_fill numeric;
  sign int;
  gross numeric;
  closed_commission numeric;
  net numeric;
  trade_row public.trades;
  new_volume numeric;
  new_margin numeric;
  new_commission numeric;
  vol_ratio numeric;
begin
  if p_close_volume <= 0 then raise exception 'close volume must be positive'; end if;

  select * into pos from public.positions where id = p_position_id for update;
  if not found then raise exception 'position % not found', p_position_id; end if;
  perform public.assert_owns_account(pos.account_id, p_user_id);

  if p_close_volume >= pos.volume then
    -- Full close fallback if requested close volume is >= current volume
    return public.close_position_at_market(p_user_id, p_position_id, p_category);
  end if;

  select price into mid from public.prices where symbol = pos.symbol;
  if mid is null then raise exception 'no server price for %', pos.symbol; end if;

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

  exit_fill := case when pos.direction = 'buy' then mid - spread / 2 else mid + spread / 2 end;
  sign := case when pos.direction = 'buy' then 1 else -1 end;
  
  -- Gross P&L realized on the CLOSED fraction
  -- NOTE: this assumes USD-quoted assets or inverse/direct conversion is applied later.
  -- Wait, the `close_position_at_market` actually doesn't do `usd_per_unit` conversion for PnL! 
  -- It assumes USD for the majors/crypto/commodities it handles.
  gross := (exit_fill - pos.open_price) * sign * p_close_volume * pos.contract_size;
  
  vol_ratio := p_close_volume / pos.volume;
  closed_commission := pos.commission * vol_ratio;
  net := gross - closed_commission;

  new_volume := pos.volume - p_close_volume;
  new_margin := pos.margin - (pos.margin * vol_ratio);
  new_commission := pos.commission - closed_commission;

  -- Insert closed trade record
  insert into public.trades (
    account_id, symbol, direction, volume, open_price, close_price,
    open_time, gross_pnl, commission, swap, net_pnl, reason
  ) values (
    pos.account_id, pos.symbol, pos.direction, p_close_volume, pos.open_price, exit_fill,
    pos.open_time, gross, closed_commission, pos.swap * vol_ratio, net, 'manual_partial'
  ) returning * into trade_row;

  -- Update remaining position
  update public.positions 
     set volume = new_volume,
         margin = new_margin,
         commission = new_commission,
         swap = pos.swap - (pos.swap * vol_ratio)
   where id = p_position_id;

  -- Credit/debit account balance
  update public.accounts set balance = balance + net where id = pos.account_id;

  return trade_row;
end;
$$;

revoke all on function public.partial_close_position_at_market(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.partial_close_position_at_market(uuid, uuid, numeric, text) to service_role;
