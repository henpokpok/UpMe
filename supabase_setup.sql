-- ==========================================================================
-- UpMee — Production Supabase SQL Setup & Security Hardening
-- ==========================================================================

-- 1. Create Shares Table
CREATE TABLE IF NOT EXISTS public.shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('text', 'file', 'both')),
  content TEXT NOT NULL,
  storage_path TEXT,
  file_name TEXT,
  file_size BIGINT,
  one_time_download BOOLEAN DEFAULT false,
  download_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Performance & Fast Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_shares_code ON public.shares(code);
CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON public.shares(expires_at);
CREATE INDEX IF NOT EXISTS idx_shares_created_at ON public.shares(created_at DESC);

-- 2. Create Push Subscriptions Table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription JSONB NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Row Level Security (RLS) Policies
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Shares: Public Read for Active Content & Vault Challenge
DROP POLICY IF EXISTS "Allow public select shares" ON public.shares;
CREATE POLICY "Allow public select shares" ON public.shares 
  FOR SELECT TO anon, authenticated 
  USING (true);

-- Shares: Public Insert
DROP POLICY IF EXISTS "Allow public insert shares" ON public.shares;
CREATE POLICY "Allow public insert shares" ON public.shares 
  FOR INSERT TO anon, authenticated 
  WITH CHECK (true);

-- Shares: Public Update (Permitted for Vault Challenge & download counts)
DROP POLICY IF EXISTS "Allow public update shares" ON public.shares;
CREATE POLICY "Allow public update shares" ON public.shares 
  FOR UPDATE TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

-- Shares: Protected Delete (Crucial: Protects master VAULT1 challenge from being deleted)
DROP POLICY IF EXISTS "Allow public delete shares" ON public.shares;
CREATE POLICY "Allow public delete shares" ON public.shares 
  FOR DELETE TO anon, authenticated 
  USING (code != 'VAULT1');

-- Push Subscriptions: Allow Insert (Privacy hardened: anon cannot SELECT other users' tokens)
DROP POLICY IF EXISTS "Allow public insert push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Allow public insert push_subscriptions" ON public.push_subscriptions 
  FOR INSERT TO anon, authenticated 
  WITH CHECK (true);

-- Revoke public SELECT on push_subscriptions to protect user privacy (Edge function uses service_role)
DROP POLICY IF EXISTS "Allow public select push_subscriptions" ON public.push_subscriptions;

-- 4. Enable Supabase Realtime Broadcasts on shares table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shares'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shares;
  END IF;
END $$;

-- 5. Automated Storage & Record Cleanup Routine (Runs every 5 minutes if pg_cron is enabled)
CREATE OR REPLACE FUNCTION public.clean_expired_shares()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete expired shares (excluding permanent VAULT1 challenge)
  DELETE FROM public.shares
  WHERE expires_at < NOW() AND code != 'VAULT1';
END;
$$;

-- Schedule cron job if pg_cron extension exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-expired-shares-every-5m',
      '*/5 * * * *',
      'SELECT public.clean_expired_shares();'
    );
  END IF;
END $$;
