-- Trading functions the risk worker calls, as deployed on the live project on 2026-11-27.
-- Loaded on top of supabase/tests/engine-v4/base.sql by the engine simulations.

create or replace function public.close_position(p_position_id uuid, p_exit_fill numeric, p_gross_pnl numeric, p_commission numeric, p_reason close_reason)
returns trades language plpgsql security definer set search_path to 'public'
as $function$
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
$function$;

create or replace function public.fill_order(p_order_id uuid, p_entry_fill numeric, p_contract_size numeric, p_digits smallint, p_margin numeric, p_commission numeric)
returns positions language plpgsql security definer set search_path to 'public'
as $function$
declare
  ord  public.orders;
  acct public.accounts;
  used_margin numeric;
  free_margin numeric;
  new_row public.positions;
begin
  select * into ord from public.orders where id = p_order_id for update;
  if not found then return null; end if;
  if ord.status <> 'working' then return null; end if;

  select * into acct from public.accounts where id = ord.account_id for update;
  if not found then raise exception 'account % not found', ord.account_id; end if;
  if acct.status <> 'active' and acct.status <> 'funded' then
    update public.orders set status = 'cancelled', cancelled_at = now() where id = p_order_id;
    return null;
  end if;

  select coalesce(sum(margin), 0) into used_margin
    from public.positions where account_id = ord.account_id;
  free_margin := acct.equity - used_margin;
  if p_margin > free_margin then
    return null;
  end if;

  insert into public.positions (
    account_id, symbol, direction, volume, open_price, contract_size, digits,
    stop_loss, take_profit, commission, margin
  ) values (
    ord.account_id, ord.symbol, ord.direction, ord.volume, p_entry_fill, p_contract_size,
    p_digits, ord.stop_loss, ord.take_profit, p_commission, p_margin
  ) returning * into new_row;

  update public.orders
     set status = 'filled', filled_at = now()
   where id = p_order_id;

  return new_row;
end;
$function$;

create or replace function public.breach_account(p_account_id uuid, p_equity numeric, p_kind account_event_type, p_reason text, p_marks jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  acct public.accounts;
  pos  public.positions;
  mark jsonb;
  exit_fill  numeric;
  gross      numeric;
  commission numeric;
  net        numeric;
begin
  select * into acct from public.accounts where id = p_account_id for update;
  if not found then raise exception 'account % not found', p_account_id; end if;
  if acct.status <> 'active' and acct.status <> 'funded' then
    return;
  end if;

  for pos in select * from public.positions where account_id = p_account_id for update loop
    mark := (
      select m from jsonb_array_elements(p_marks) m
      where (m->>'position_id')::uuid = pos.id
      limit 1
    );
    if mark is not null then
      exit_fill  := (mark->>'exit_fill')::numeric;
      gross      := (mark->>'gross_pnl')::numeric;
      commission := coalesce((mark->>'commission')::numeric, 0);
    else
      exit_fill  := pos.open_price;
      gross      := 0;
      commission := 0;
    end if;
    net := gross - commission;

    insert into public.trades (
      account_id, symbol, direction, volume, open_price, close_price,
      open_time, gross_pnl, commission, swap, net_pnl, reason
    ) values (
      pos.account_id, pos.symbol, pos.direction, pos.volume, pos.open_price, exit_fill,
      pos.open_time, gross, commission, pos.swap, net, 'breach'
    );

    update public.accounts set balance = balance + net where id = p_account_id;
    delete from public.positions where id = pos.id;
  end loop;

  update public.orders
     set status = 'cancelled', cancelled_at = now()
   where account_id = p_account_id and status = 'working';

  update public.accounts
     set status = 'breached',
         breach_reason = p_reason,
         equity = balance
   where id = p_account_id;

  insert into public.account_events (account_id, type, equity_at_event, detail)
  values (p_account_id, p_kind, p_equity, p_reason);
end;
$function$;

create or replace function public.pass_account(p_account_id uuid, p_equity numeric, p_marks jsonb default '[]'::jsonb)
returns accounts language plpgsql security definer set search_path to 'public'
as $function$
declare
  acct public.accounts;
  pos public.positions;
  mark jsonb;
  exit_fill numeric;
  gross numeric;
  commission numeric;
  net numeric;
begin
  select * into acct from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'account % not found', p_account_id;
  end if;

  if acct.status not in ('active', 'passed') then
    return acct;
  end if;

  for pos in select * from public.positions where account_id = p_account_id for update loop
    mark := (
      select m from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) as m
      where (m->>'position_id')::uuid = pos.id
      limit 1
    );
    if mark is not null then
      exit_fill := (mark->>'exit_fill')::numeric;
      gross := (mark->>'gross_pnl')::numeric;
      commission := coalesce((mark->>'commission')::numeric, 0);
    else
      exit_fill := pos.open_price;
      gross := 0;
      commission := 0;
    end if;
    net := gross - commission;

    insert into public.trades (
      account_id, symbol, direction, volume, open_price, close_price,
      open_time, gross_pnl, commission, swap, net_pnl, reason
    ) values (
      pos.account_id, pos.symbol, pos.direction, pos.volume, pos.open_price, exit_fill,
      pos.open_time, gross, commission, pos.swap, net, 'tp'
    );

    update public.accounts
       set balance = balance + net,
           updated_at = now()
     where id = p_account_id;

    delete from public.positions where id = pos.id;
  end loop;

  update public.orders
     set status = 'cancelled',
         cancelled_at = now()
   where account_id = p_account_id
     and status = 'working';

  update public.accounts
     set status = 'passed',
         equity = balance,
         highest_equity = greatest(highest_equity, balance, p_equity),
         updated_at = now()
   where id = p_account_id
   returning * into acct;

  if not exists (
    select 1 from public.account_events where account_id = p_account_id and type = 'target_hit'
  ) then
    insert into public.account_events (account_id, type, equity_at_event, detail)
    values (p_account_id, 'target_hit', p_equity, 'profit target reached');
  end if;

  return acct;
end;
$function$;
