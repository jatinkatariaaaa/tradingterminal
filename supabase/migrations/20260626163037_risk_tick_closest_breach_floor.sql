-- Keep the SQL fallback aligned with the Node risk worker:
-- whichever drawdown floor is closer to the current equity breaches first.
-- Example: 400K account with 5% daily and 10% overall floors breaches daily at
-- 380K, not overall at 360K.
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
  breach_floor  numeric;
  breach_type   account_event_type;
  breach_detail text;
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

  -- Challenge profit target reached -> mark as passed. A target of 0 means
  -- risk-only and must never auto-pass.
  if acct.phase = 'challenge' and acct.status = 'active' and acct.profit_target > 0 then
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

revoke all on function public.apply_risk_tick(uuid, numeric) from public, anon, authenticated;
grant execute on function public.apply_risk_tick(uuid, numeric) to service_role;
