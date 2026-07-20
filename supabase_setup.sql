-- ==========================================================================
-- UpMee — Comprehensive Supabase SQL Cleanup & Fix
-- Drops ALL Triggers and Rules on shares table that reference storage.objects
-- ==========================================================================

-- 1. Drop ALL Triggers on public.shares
DO $$
DECLARE
    trig RECORD;
BEGIN
    FOR trig IN (
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE event_object_schema = 'public' AND event_object_table = 'shares'
    ) LOOP
        EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(trig.trigger_name) || ' ON public.shares CASCADE;';
    END LOOP;
END $$;

-- 2. Drop ALL Rules on public.shares
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT rulename
        FROM pg_rules
        WHERE schemaname = 'public' AND tablename = 'shares'
    ) LOOP
        EXECUTE 'DROP RULE IF EXISTS ' || quote_ident(r.rulename) || ' ON public.shares CASCADE;';
    END LOOP;
END $$;

-- 3. Drop custom storage deletion functions
DROP FUNCTION IF EXISTS public.delete_storage_file CASCADE;
DROP FUNCTION IF EXISTS public.delete_storage_file_trigger CASCADE;
DROP FUNCTION IF EXISTS delete_storage_file CASCADE;

-- 4. Drop Foreign Keys referencing storage.objects
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

-- 5. Ensure clean RLS Policies for shares table
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select shares" ON public.shares;
CREATE POLICY "Allow public select shares" ON public.shares FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow public insert shares" ON public.shares;
CREATE POLICY "Allow public insert shares" ON public.shares FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete shares" ON public.shares;
CREATE POLICY "Allow public delete shares" ON public.shares FOR DELETE TO anon, authenticated USING (true);

-- 6. Enable Supabase Realtime Broadcasts on shares table
ALTER PUBLICATION supabase_realtime ADD TABLE public.shares;
