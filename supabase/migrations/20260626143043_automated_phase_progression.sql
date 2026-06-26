drop function if exists public.pass_account(uuid, numeric, jsonb);

create function public.pass_account(
  p_account_id uuid,
  p_equity numeric,
  p_marks jsonb default '[]'::jsonb
)
returns public.accounts
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  acct public.accounts;
  pos public.positions;
  mark jsonb;
  exit_fill numeric;
  gross numeric;
  commission numeric;
  net numeric;
begin
  select * into acct
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'account % not found', p_account_id;
  end if;

  if acct.status not in ('active', 'passed') then
    return acct;
  end if;

  for pos in
    select *
    from public.positions
    where account_id = p_account_id
    for update
  loop
    mark := (
      select m
      from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) as m
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
      account_id,
      symbol,
      direction,
      volume,
      open_price,
      close_price,
      open_time,
      gross_pnl,
      commission,
      swap,
      net_pnl,
      reason
    ) values (
      pos.account_id,
      pos.symbol,
      pos.direction,
      pos.volume,
      pos.open_price,
      exit_fill,
      pos.open_time,
      gross,
      commission,
      pos.swap,
      net,
      'tp'
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
    select 1
    from public.account_events
    where account_id = p_account_id
      and type = 'target_hit'
  ) then
    insert into public.account_events (account_id, type, equity_at_event, detail)
    values (p_account_id, 'target_hit', p_equity, 'profit target reached');
  end if;

  return acct;
end;
$$;

revoke execute on function public.pass_account(uuid, numeric, jsonb) from public;
revoke execute on function public.pass_account(uuid, numeric, jsonb) from anon;
revoke execute on function public.pass_account(uuid, numeric, jsonb) from authenticated;
grant execute on function public.pass_account(uuid, numeric, jsonb) to service_role;
