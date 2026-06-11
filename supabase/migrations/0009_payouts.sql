create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  amount numeric(18,2) not null,
  crypto_address text not null,
  status text not null default 'pending', -- 'pending', 'paid', 'rejected'
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.payouts enable row level security;

-- Policies
create policy "Users can view their own payouts"
  on public.payouts for select
  using (auth.uid() = user_id);

create policy "Users can insert their own payouts"
  on public.payouts for insert
  with check (auth.uid() = user_id);

-- Admins can read/update all (via service role or if we add an admin policy)
-- The admin Next.js routes will use service_role so they bypass RLS anyway.
