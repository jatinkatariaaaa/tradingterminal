-- Phase 3, Step 2: positions, orders, and the immutable trades ledger.
--
-- Security model (same principle as accounts):
--   * Clients (anon/authenticated) may SELECT only rows belonging to one of
--     THEIR accounts. Ownership is enforced by checking the parent account's
--     user_id via an EXISTS subquery in each RLS policy.
--   * Clients have NO insert/update/delete policies. Every fill, modification,
--     SL/TP trigger, and close is written by trusted server code (service-role
--     key) or SECURITY DEFINER functions. The browser can never open a position
--     at a fake price or rewrite trade history.
--   * trades is an APPEND-ONLY ledger: even server code should only insert; a
--     trigger blocks UPDATE/DELETE so closed history is tamper-evident.

-- ---------------------------------------------------------------------- Enums
do $$ begin
  create type trade_direction as enum ('buy', 'sell');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_kind as enum ('limit', 'stop');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('working', 'filled', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type close_reason as enum ('tp', 'sl', 'manual', 'breach');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ Positions
-- Currently-open positions. open_price is set server-side from the server
-- quote, never from the client.
create table if not exists public.positions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  symbol        text not null,
  direction     trade_direction not null,
  volume        numeric(18,4) not null check (volume > 0),
  open_price    numeric(18,8) not null check (open_price > 0),
  contract_size numeric(18,4) not null,
  digits        smallint not null check (digits between 0 and 8),
  stop_loss     numeric(18,8),
  take_profit   numeric(18,8),
  commission    numeric(18,4) not null default 0,
  swap          numeric(18,4) not null default 0,
  margin        numeric(18,2) not null default 0,
  open_time     timestamptz not null default now()
);
create index if not exists positions_account_idx on public.positions (account_id);

-- --------------------------------------------------------------------- Orders
-- Pending limit / stop orders awaiting their trigger. placed_price records the
-- market at placement so the worker only fills on a genuine cross.
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  symbol        text not null,
  direction     trade_direction not null,
  kind          order_kind not null,
  status        order_status not null default 'working',
  volume        numeric(18,4) not null check (volume > 0),
  trigger_price numeric(18,8) not null check (trigger_price > 0),
  placed_price  numeric(18,8) not null,
  stop_loss     numeric(18,8),
  take_profit   numeric(18,8),
  created_at    timestamptz not null default now(),
  filled_at     timestamptz,
  cancelled_at  timestamptz
);
create index if not exists orders_account_idx on public.orders (account_id);
create index if not exists orders_working_idx on public.orders (status) where status = 'working';

-- --------------------------------------------------------------------- Trades
-- Immutable closed-trade ledger. Append-only; never updated or deleted.
create table if not exists public.trades (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  symbol        text not null,
  direction     trade_direction not null,
  volume        numeric(18,4) not null check (volume > 0),
  open_price    numeric(18,8) not null,
  close_price   numeric(18,8) not null,
  open_time     timestamptz not null,
  close_time    timestamptz not null default now(),
  gross_pnl     numeric(18,4) not null,
  commission    numeric(18,4) not null default 0,
  swap          numeric(18,4) not null default 0,
  net_pnl       numeric(18,4) not null,
  reason        close_reason not null
);
create index if not exists trades_account_idx on public.trades (account_id, close_time desc);

-- Block any UPDATE/DELETE on trades, even from privileged roles, so the ledger
-- stays tamper-evident. Inserts are allowed (the worker records closes).
create or replace function public.block_trade_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'trades is an append-only ledger; % is not permitted', tg_op;
end;
$$;

drop trigger if exists trades_no_update on public.trades;
create trigger trades_no_update
  before update or delete on public.trades
  for each row execute function public.block_trade_mutation();

-- --------------------------------------------------------- Row-Level Security
alter table public.positions enable row level security;
alter table public.orders    enable row level security;
alter table public.trades    enable row level security;

-- A row is visible only when its parent account belongs to the caller. No
-- insert/update/delete policies exist for client roles — writes are server-only.
drop policy if exists positions_select_own on public.positions;
create policy positions_select_own on public.positions
  for select using (
    exists (
      select 1 from public.accounts a
      where a.id = positions.account_id and a.user_id = auth.uid()
    )
  );

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select using (
    exists (
      select 1 from public.accounts a
      where a.id = orders.account_id and a.user_id = auth.uid()
    )
  );

drop policy if exists trades_select_own on public.trades;
create policy trades_select_own on public.trades
  for select using (
    exists (
      select 1 from public.accounts a
      where a.id = trades.account_id and a.user_id = auth.uid()
    )
  );

-- Belt-and-suspenders: revoke direct write grants from client roles.
revoke insert, update, delete on public.positions from anon, authenticated;
revoke insert, update, delete on public.orders    from anon, authenticated;
revoke insert, update, delete on public.trades    from anon, authenticated;
