-- Update handle_new_user to track referrals
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affiliate_id uuid;
BEGIN
  -- 1. Create the user's profile
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email)
  ON CONFLICT (id) DO NOTHING;
  
  -- 2. Create the user's affiliate account so they have a referral code
  INSERT INTO public.affiliates (user_id, referral_code)
  VALUES (new.id, substr(md5(new.id::text), 1, 8))
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Check if they were referred by someone
  affiliate_id := (new.raw_user_meta_data->>'affiliate_id')::uuid;
  
  IF affiliate_id IS NOT NULL THEN
    -- Insert the referral relationship
    INSERT INTO public.affiliate_referrals (affiliate_id, referred_user_id)
    VALUES (affiliate_id, new.id)
    ON CONFLICT (referred_user_id) DO NOTHING;
    
    -- Increment the referrer's total referrals count
    UPDATE public.affiliates
    SET total_referrals = total_referrals + 1
    WHERE user_id = affiliate_id;
  END IF;

  RETURN new;
END;
$$;
