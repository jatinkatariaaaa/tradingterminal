-- An account the firm has paused (not breached, not passed). The risk worker
-- only ticks 'active' and 'funded' accounts, so a suspended account cannot trade.
-- Kept in its own migration: a new enum value cannot be used in the transaction
-- that adds it.
alter type public.account_status add value if not exists 'suspended';
