-- Engine v4, step 2: apply_risk_tick runs on private.risk_tick (added in 20261127090000).
--
-- Same name, arguments, result and grants, so the risk worker needs no change for this step: a tick that
-- changes nothing becomes a read-only transaction (no row lock, no transaction id, no WAL flush). Tested
-- against the live body in supabase/tests/engine-v4 (identical status and stored state on every tick).
--
-- Rollback: supabase/rollbacks/20261127090000_engine_v4_fewer_writes.down.sql.

-- Same name, arguments, result and grants as before: existing callers keep working.
create or replace function public.apply_risk_tick(p_account_id uuid, p_equity numeric)
returns account_status
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  return private.risk_tick(p_account_id, p_equity, p_equity);
end;
$function$;
