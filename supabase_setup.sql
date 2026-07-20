-- ==========================================================================
-- UpMee — Comprehensive Supabase Database Fix SQL
-- Removes all FK constraints & triggers referencing storage.objects
-- ==========================================================================

-- 1. Drop any triggers on shares table
DROP TRIGGER IF EXISTS on_share_deleted ON public.shares;
DROP TRIGGER IF EXISTS delete_storage_file_trigger ON public.shares;
DROP TRIGGER IF EXISTS tr_delete_storage_file ON public.shares;
DROP FUNCTION IF EXISTS delete_storage_file() CASCADE;

-- 2. Drop any foreign key constraints pointing to storage.objects
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND table_name = 'shares' AND constraint_type = 'FOREIGN KEY'
    ) LOOP
        EXECUTE 'ALTER TABLE public.shares DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

-- 3. Ensure clean RLS Policies for shares
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select shares" ON public.shares;
CREATE POLICY "Allow public select shares" ON public.shares FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow public insert shares" ON public.shares;
CREATE POLICY "Allow public insert shares" ON public.shares FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete shares" ON public.shares;
CREATE POLICY "Allow public delete shares" ON public.shares FOR DELETE TO anon, authenticated USING (true);

-- 4. Enable Supabase Realtime Broadcasts on shares table
ALTER PUBLICATION supabase_realtime ADD TABLE public.shares;
