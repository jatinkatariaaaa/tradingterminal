-- Phase 3, Step 2: daily-drawdown rollover anchored to the Forex session close,
-- 5:00 PM Eastern Time (the industry-standard prop-firm "day").
--
-- 5pm ET is DST-aware: it is UTC-5 in winter (EST) and UTC-4 in summer (EDT).
-- We never hardcode an offset — all math is done in the America/New_York zone so
-- the rollover instant shifts correctly across DST changes.

-- Track when each account last had its daily baseline rolled over.
alter table public.accounts
  add column if not exists last_daily_reset_at timestamptz;

-- The most recent 5:00 PM America/New_York instant at or before `at` (UTC).
--
-- How it works: convert `at` into wall-clock time in New York, take that day's
-- 17:00 local; if `at` is still before today's 17:00 ET, step back one day.
-- Casting the naive local timestamp back AT TIME ZONE 'America/New_York' yields
-- the correct UTC instant with the right DST offset applied automatically.
create or replace function public.forex_session_anchor(at timestamptz default now())
returns timestamptz
language plpgsql
immutable
as $$
declare
  ny_now    timestamp;   -- wall-clock time in New York (naive)
  ny_anchor timestamp;   -- 17:00 local on the relevant day (naive)
begin
  ny_now := at at time zone 'America/New_York';
  ny_anchor := date_trunc('day', ny_now) + interval '17 hours';
  if ny_now < ny_anchor then
    ny_anchor := ny_anchor - interval '1 day';
  end if;
  -- Interpret the naive NY wall-clock anchor back as a UTC instant.
  return ny_anchor at time zone 'America/New_York';
end;
$$;

-- True when the account has not been rolled over since the current session
-- anchor — i.e. the worker should reset its daily baseline now.
create or replace function public.needs_daily_reset(
  last_reset timestamptz,
  at timestamptz default now()
)
returns boolean
language sql
immutable
as $$
  select last_reset is null or last_reset < public.forex_session_anchor(at);
$$;

-- Note: the actual reset (set daily_start_balance = balance, stamp
-- last_daily_reset_at = forex_session_anchor(now())) is performed by the trusted
-- Node risk worker using the service-role key, so it stays server-authoritative.
