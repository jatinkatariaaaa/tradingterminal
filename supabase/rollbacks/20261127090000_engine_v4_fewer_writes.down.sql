-- Rollback for 20261127090000_engine_v4_fewer_writes.sql.
-- Restores apply_risk_tick exactly as it was live on 2026-11-27, then drops the v4 functions.
-- Point the risk worker back at the legacy loop first (RISK_ENGINE=legacy), because risk_cycle goes away.

create or replace function public.apply_risk_tick(p_account_id uuid, p_equity numeric)
returns account_status
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  if acct.equity is distinct from p_equity or acct.highest_equity < p_equity then
    update public.accounts
       set equity = p_equity,
           highest_equity = greatest(highest_equity, p_equity)
     where id = p_account_id;
  end if;

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

drop function if exists public.risk_cycle(jsonb, jsonb, jsonb);
drop function if exists private.risk_tick(uuid, numeric, numeric);
