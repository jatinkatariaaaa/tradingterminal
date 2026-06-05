-- Phase 3, Step 1: profiles + accounts, server-authoritative with RLS.
--
-- Run this in the Supabase SQL editor (or via the Supabase CLI). It is
-- idempotent where practical so it can be re-applied safely during setup.
--
-- Security model:
--   * Clients (anon/authenticated) may SELECT only their OWN rows.
--   * Clients may NOT insert/update/delete accounts at all — every money or
--     status change happens through trusted server code (service-role key) or a
--     SECURITY DEFINER function added in later steps. This is what makes the
--     risk engine cheat-proof: DevTools can read state but never mutate balance,
--     equity, drawdown, phase, or status.

-- ----------------------------------------------------------------- Extensions
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------- Enums
do $$ begin
  create type account_phase as enum ('challenge', 'funded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type account_status as enum ('active', 'passed', 'breached', 'funded');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------- Profiles
-- One row per auth user, created automatically by a trigger on sign-up.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  display_name text,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- Accounts
-- A user may own MANY accounts (multiple purchased challenges).
create table if not exists public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  label                 text not null default 'Evaluation',
  phase                 account_phase  not null default 'challenge',
  status                account_status not null default 'active',
  starting_balance      numeric(18,2) not null,
  balance               numeric(18,2) not null,
  equity                numeric(18,2) not null,
  daily_start_balance   numeric(18,2) not null,
  highest_equity        numeric(18,2) not null,
  max_daily_drawdown    numeric(6,4)  not null default 0.05,  -- 5%
  max_overall_drawdown  numeric(6,4)  not null default 0.10,  -- 10%
  profit_target         numeric(6,4)  not null default 0.08,  -- 8%
  breach_reason         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Guard rails so stored values stay sane regardless of who writes them.
  constraint accounts_positive_start check (starting_balance > 0),
  constraint accounts_dd_fraction    check (max_daily_drawdown   between 0 and 1),
  constraint accounts_overall_dd_fraction check (max_overall_drawdown between 0 and 1),
  constraint accounts_target_fraction check (profit_target between 0 and 5)
);

create index if not exists accounts_user_id_idx on public.accounts (user_id);
create index if not exists accounts_user_status_idx on public.accounts (user_id, status);

-- ----------------------------------------------------------- updated_at touch
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists accounts_touch_updated_at on public.accounts;
create trigger accounts_touch_updated_at
  before update on public.accounts
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------- Auto-create profile row
-- Runs as definer so it can insert into public.profiles for the new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------- Row-Level Security
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;

-- Profiles: a user can read and update only their own profile row. They cannot
-- insert (the trigger does that) or delete it.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Accounts: clients may ONLY read their own rows. There are deliberately NO
-- insert/update/delete policies for the anon/authenticated roles, so RLS denies
-- every client write. Account creation and all money/status mutations are
-- performed by trusted server code using the service-role key (which bypasses
-- RLS) or via SECURITY DEFINER functions introduced in later steps.
drop policy if exists accounts_select_own on public.accounts;
create policy accounts_select_own on public.accounts
  for select using (auth.uid() = user_id);

-- Lock down direct grants too: the service role bypasses RLS, so revoking write
-- privileges from the client roles is belt-and-suspenders against future policy
-- mistakes.
revoke insert, update, delete on public.accounts from anon, authenticated;
