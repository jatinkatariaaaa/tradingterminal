-- Fix: Add 'funded' to trading_accounts status check constraint.
--
-- The sync_account_to_trading_account() trigger copies the terminal account
-- status (which can be 'funded') into trading_accounts. But the check
-- constraint only allowed: active, breached, passed, suspended, deleted.
-- This caused "violates check constraint trading_accounts_status_check"
-- errors whenever a funded account had ANY update (open/close trade, equity tick).

ALTER TABLE public.trading_accounts DROP CONSTRAINT IF EXISTS trading_accounts_status_check;

ALTER TABLE public.trading_accounts ADD CONSTRAINT trading_accounts_status_check
  CHECK (status::text = ANY (ARRAY[
    'active', 'breached', 'passed', 'suspended', 'deleted', 'funded'
  ]::text[]));
