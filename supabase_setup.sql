-- ==========================================================================
-- UpMee — Supabase Database Setup SQL
-- ==========================================================================

-- 1. Drop outdated storage deletion trigger (Supabase blocks direct SQL delete on storage.objects)
DROP TRIGGER IF EXISTS on_share_deleted ON public.shares;
DROP FUNCTION IF EXISTS delete_storage_file();

-- 2. Create Shares Table
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

-- Index for expiration lookups
CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON public.shares(expires_at);

-- 3. Row Level Security (RLS) Policies for DB Table
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select shares" ON public.shares;
CREATE POLICY "Allow public select shares" ON public.shares FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow public insert shares" ON public.shares;
CREATE POLICY "Allow public insert shares" ON public.shares FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete shares" ON public.shares;
CREATE POLICY "Allow public delete shares" ON public.shares FOR DELETE TO anon, authenticated USING (true);

-- 4. Enable Supabase Realtime Broadcasts on shares table
ALTER PUBLICATION supabase_realtime ADD TABLE public.shares;
