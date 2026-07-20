-- ============================================================================
-- upMe — Supabase PostgreSQL Schema, Storage, RLS, and Cleanup Setup
-- Execute this entire script inside your Supabase SQL Editor
-- ============================================================================

-- 1. DATABASE SCHEMA SETUP
CREATE TABLE IF NOT EXISTS public.shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(6) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('text', 'file')),
    content TEXT NOT NULL,
    storage_path TEXT DEFAULT NULL,
    file_name TEXT DEFAULT NULL,
    file_size BIGINT DEFAULT NULL,
    one_time_download BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Create performance indexes for rapid retrieval & expiry cleanup
CREATE INDEX IF NOT EXISTS idx_shares_code ON public.shares (code);
CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON public.shares (expires_at);

-- 2. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to SELECT non-expired shares
CREATE POLICY "Allow public select active shares" 
ON public.shares 
FOR SELECT 
TO anon, authenticated 
USING (expires_at > now());

-- Allow anonymous users to INSERT new shares
CREATE POLICY "Allow public insert shares" 
ON public.shares 
FOR INSERT 
TO anon, authenticated 
WITH CHECK (true);

-- Allow anonymous users to DELETE shares (Required for One-Time Download auto-deletion)
CREATE POLICY "Allow public delete shares" 
ON public.shares 
FOR DELETE 
TO anon, authenticated 
USING (true);


-- 3. SUPABASE STORAGE BUCKET CONFIGURATION ('user-shares')
-- Insert public storage bucket if not already present
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-shares', 
  'user-shares', 
  true, 
  52428800, -- 50MB in bytes
  NULL -- Allows all mime types
)
ON CONFLICT (id) DO UPDATE 
SET public = true, file_size_limit = 52428800;

-- Storage RLS Policies
CREATE POLICY "Public Read Access for user-shares"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'user-shares');

CREATE POLICY "Public Upload Access for user-shares"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'user-shares');

CREATE POLICY "Public Delete Access for user-shares"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'user-shares');


-- 4. BACKGROUND AUTO-DESTRUCT SYSTEM (pg_cron)
-- Enable the pg_cron extension (Supabase supports pg_cron on free tier database extensions)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cron job running every 5 minutes to delete expired database records
SELECT cron.schedule(
    'auto-delete-expired-shares',
    '*/5 * * * *', -- Every 5 minutes
    $$ DELETE FROM public.shares WHERE expires_at < now(); $$
);


-- 5. AUTOMATIC STORAGE FILE CLEANUP ON RECORD DELETION
-- Function & Trigger to automatically clean up storage files when a row is deleted (via cron or one-time download)

-- Step 5A: Function to delete storage object using Supabase Storage Internal API / pg_net
CREATE OR REPLACE FUNCTION public.handle_deleted_share_storage()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if deleted row contained a storage path
    IF OLD.storage_path IS NOT NULL AND OLD.storage_path != '' THEN
        DELETE FROM storage.objects 
        WHERE bucket_id = 'user-shares' 
          AND name = OLD.storage_path;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5B: Trigger attached to AFTER DELETE on public.shares
DROP TRIGGER IF EXISTS trigger_delete_share_storage ON public.shares;

CREATE TRIGGER trigger_delete_share_storage
AFTER DELETE ON public.shares
FOR EACH ROW
EXECUTE FUNCTION public.handle_deleted_share_storage();
