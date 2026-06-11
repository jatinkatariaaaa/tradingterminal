-- Create Affiliate System Tables

-- 1. Affiliates Table (Stores overall stats for an affiliate)
CREATE TABLE IF NOT EXISTS public.affiliates (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    referral_code TEXT UNIQUE NOT NULL,
    total_earnings NUMERIC(18,2) DEFAULT 0.00,
    pending_payout NUMERIC(18,2) DEFAULT 0.00,
    total_referrals INTEGER DEFAULT 0,
    link_clicks INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on affiliates
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliates_select_own ON public.affiliates
    FOR SELECT USING (auth.uid() = user_id);

-- 2. Affiliate Referrals Table (Tracks who referred whom)
CREATE TABLE IF NOT EXISTS public.affiliate_referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- The referrer
    referred_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- The person who signed up
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(referred_user_id) -- A user can only be referred by one person
);

-- Enable RLS on referrals
ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY referrals_select_own ON public.affiliate_referrals
    FOR SELECT USING (auth.uid() = affiliate_id);

-- 3. Affiliate Earnings Table (Tracks individual commissions)
CREATE TABLE IF NOT EXISTS public.affiliate_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    purchase_id UUID REFERENCES public.purchases(id) ON DELETE CASCADE,
    amount NUMERIC(18,2) NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, available, paid
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on earnings
ALTER TABLE public.affiliate_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY earnings_select_own ON public.affiliate_earnings
    FOR SELECT USING (auth.uid() = affiliate_id);
