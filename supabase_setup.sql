-- ==========================================================================
-- UpMee — Production Supabase SQL Setup, Auto Storage Cleanup & Hardening
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

-- 3. Row Level Security (RLS) Policies for Shares Table
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

-- Shares: Protected Delete (Protects master VAULT1 challenge from deletion)
DROP POLICY IF EXISTS "Allow public delete shares" ON public.shares;
CREATE POLICY "Allow public delete shares" ON public.shares 
  FOR DELETE TO anon, authenticated 
  USING (code != 'VAULT1');

-- Push Subscriptions: Allow Insert
DROP POLICY IF EXISTS "Allow public insert push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Allow public insert push_subscriptions" ON public.push_subscriptions 
  FOR INSERT TO anon, authenticated 
  WITH CHECK (true);

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

-- 5. Storage Bucket Setup & Storage RLS Policies
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('user-shares', 'user-shares', true, 52428800) -- 50MB per file
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 52428800;

DROP POLICY IF EXISTS "Public Read Access for user-shares" ON storage.objects;
CREATE POLICY "Public Read Access for user-shares"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'user-shares');

DROP POLICY IF EXISTS "Public Upload Access for user-shares" ON storage.objects;
CREATE POLICY "Public Upload Access for user-shares"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'user-shares');

DROP POLICY IF EXISTS "Public Delete Access for user-shares" ON storage.objects;
CREATE POLICY "Public Delete Access for user-shares"
ON storage.objects FOR DELETE TO anon, authenticated
USING (bucket_id = 'user-shares');

-- 6. CRITICAL FIX: AUTOMATIC STORAGE CLEANUP TRIGGER
-- When a row is deleted from public.shares, automatically delete the physical file from storage.objects!
CREATE OR REPLACE FUNCTION public.handle_deleted_share_storage()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.storage_path IS NOT NULL AND OLD.storage_path != '' THEN
    DELETE FROM storage.objects 
    WHERE bucket_id = 'user-shares' 
      AND name = OLD.storage_path;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_delete_share_storage ON public.shares;
CREATE TRIGGER trigger_delete_share_storage
AFTER DELETE ON public.shares
FOR EACH ROW
EXECUTE FUNCTION public.handle_deleted_share_storage();

-- 7. Automated Storage & Record Cleanup Routine
CREATE OR REPLACE FUNCTION public.clean_expired_shares()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Explicitly clean storage.objects for expired records
  DELETE FROM storage.objects
  WHERE bucket_id = 'user-shares'
    AND name IN (
      SELECT storage_path FROM public.shares 
      WHERE expires_at < NOW() AND storage_path IS NOT NULL AND code != 'VAULT1'
    );

  -- 2. Delete expired shares database records (trigger will also guarantee cleanup)
  DELETE FROM public.shares
  WHERE expires_at < NOW() AND code != 'VAULT1';

  -- 3. Delete any orphaned storage objects with no matching record in public.shares
  DELETE FROM storage.objects
  WHERE bucket_id = 'user-shares'
    AND name NOT IN (
      SELECT storage_path FROM public.shares 
      WHERE storage_path IS NOT NULL
    );
END;
$$;

-- 8. Schedule pg_cron every 5 minutes if extension is active
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
