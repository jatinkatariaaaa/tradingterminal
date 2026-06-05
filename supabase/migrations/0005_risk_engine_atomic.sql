-- Phase 3, Step 3a (review fixes): atomic order fills and atomic breach close.
--
-- Adds two SECURITY DEFINER functions that close correctness gaps found in the
-- 0004 risk-engine review:
--   * fill_order      — fill a pending order exactly once (no re-fill loop).
--   * breach_account  — close all positions + freeze + audit in ONE transaction.
-- Both are locked to the service_role, consistent with 0004.

-- ---------------------------------------------------------------- fill_order
-- Atomically convert a working pending order into an open position. The order
-- is locked FOR UPDATE and the function NO-OPS (returns null) unless it is still
-- 'working', so a tick that races another tick can never open the position
-- twice. Free margin is validated against current equity, same as open_position.
create or replace function public.fill_order(
  p_order_id     uuid,
  p_entry_fill   numeric,
  p_contract_size numeric,
  p_digits       smallint,
  p_margin       numeric,
  p_commission   numeric
)
returns public.positions
language plpgsql
security definer
set search_path = public
as $$
declare
  ord  public.orders;
  acct public.accounts;
  used_margin numeric;
  free_margin numeric;
  new_row public.positions;
begin
  -- Lock the order first; bail out if another tick already filled/cancelled it.
  select * into ord from public.orders where id = p_order_id for update;
  if not found then return null; end if;
  if ord.status <> 'working' then return null; end if;

  select * into acct from public.accounts where id = ord.account_id for update;
  if not found then raise exception 'account % not found', ord.account_id; end if;
  if acct.status <> 'active' and acct.status <> 'funded' then
    -- Account no longer tradable — cancel the dangling order rather than fill.
    update public.orders set status = 'cancelled', cancelled_at = now() where id = p_order_id;
    return null;
  end if;

  select coalesce(sum(margin), 0) into used_margin
    from public.positions where account_id = ord.account_id;
  free_margin := acct.equity - used_margin;
  if p_margin > free_margin then
    -- Can't afford it yet; leave the order working for a later tick.
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
$$;

-- ------------------------------------------------------------ breach_account
-- Close every open position for an account at worker-supplied close-side marks,
-- write the immutable trades, then freeze + audit — all atomically. `p_marks` is
-- a JSON array of objects computed by the worker's valuation module:
--   [{ "position_id": uuid, "exit_fill": num, "gross_pnl": num, "commission": num }, ...]
-- Positions absent from p_marks (no live price this tick) are closed at their
-- open price with zero PnL so the account is fully flat after a breach.
create or replace function public.breach_account(
  p_account_id uuid,
  p_equity     numeric,
  p_kind       account_event_type,  -- 'daily_breach' or 'overall_breach'
  p_reason     text,
  p_marks      jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    return;  -- already terminal; nothing to do
  end if;

  -- Close each open position, preferring the worker-supplied mark.
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
      -- No live mark: close flat at open price (zero PnL, zero commission).
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

  -- Cancel any working orders so nothing fills on a frozen account.
  update public.orders
     set status = 'cancelled', cancelled_at = now()
   where account_id = p_account_id and status = 'working';

  -- Freeze + audit. equity is recomputed as the now-realized balance.
  update public.accounts
     set status = 'breached',
         breach_reason = p_reason,
         equity = balance
   where id = p_account_id;

  insert into public.account_events (account_id, type, equity_at_event, detail)
  values (p_account_id, p_kind, p_equity, p_reason);
end;
$$;

-- ------------------------------------------------------------------ Grants
revoke all on function public.fill_order(uuid, numeric, numeric, smallint, numeric, numeric) from public, anon, authenticated;
revoke all on function public.breach_account(uuid, numeric, account_event_type, text, jsonb) from public, anon, authenticated;

grant execute on function public.fill_order(uuid, numeric, numeric, smallint, numeric, numeric) to service_role;
grant execute on function public.breach_account(uuid, numeric, account_event_type, text, jsonb) to service_role;

-- Note: apply_risk_tick (0004) still updates equity/highwater, performs the 5pm
-- ET daily rollover, and detects the profit target. After this migration the
-- worker calls breach_account directly when its own close-side equity crosses a
-- floor (so the close + freeze are atomic), and uses apply_risk_tick for the
-- non-breach bookkeeping. apply_risk_tick's own breach branch remains as a
-- belt-and-suspenders backstop.
