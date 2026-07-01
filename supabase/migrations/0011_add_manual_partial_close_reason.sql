-- Add 'manual_partial' to the close_reason enum so partial closes can be recorded
ALTER TYPE close_reason ADD VALUE IF NOT EXISTS 'manual_partial';
