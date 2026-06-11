-- Add is_admin column to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Allow admins to read all profiles (Optional, usually we use service_role for admin tasks, but helpful if querying directly)
-- For the Next.js admin panel, we will use supabaseAdmin (service_role key) so RLS isn't strictly necessary to bypass,
-- but having the column is required.

-- Helper comment:
-- Run this to make yourself an admin:
-- UPDATE public.profiles SET is_admin = true WHERE email = 'your@email.com';
