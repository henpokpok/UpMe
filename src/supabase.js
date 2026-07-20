import { createClient } from '@supabase/supabase-js';

// Local storage key constants
const STORAGE_URL_KEY = 'upme_supabase_url';
const STORAGE_ANON_KEY = 'upme_supabase_anon_key';

/**
 * Helper to obtain stored configuration or environment variables
 */
export function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem(STORAGE_URL_KEY) || '';
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem(STORAGE_ANON_KEY) || '';
  return { url, key };
}

/**
 * Save custom configuration to local storage
 */
export function saveSupabaseConfig(url, key) {
  localStorage.setItem(STORAGE_URL_KEY, url.trim());
  localStorage.setItem(STORAGE_ANON_KEY, key.trim());
}

/**
 * Get initialized Supabase Client instance
 */
let supabaseClientInstance = null;

export function getSupabaseClient() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return null;
  }
  
  if (!supabaseClientInstance || supabaseClientInstance.supabaseUrl !== url) {
    supabaseClientInstance = createClient(url, key);
  }
  return supabaseClientInstance;
}

/**
 * Generate a random 6-digit numeric passcode
 */
export function generatePasscode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Convert duration key ('1h', '8h', '24h', '7d') to ISO Timestamp
 */
function calculateExpirationISO(durationKey) {
  const now = new Date();
  let hours = 24;
  switch (durationKey) {
    case '1h': hours = 1; break;
    case '8h': hours = 8; break;
    case '24h': hours = 24; break;
    case '7d': hours = 24 * 7; break;
    default: hours = 24;
  }
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return expiresAt.toISOString();
}

/**
 * Create a Text / Link Share
 */
export async function createTextShare({ content, durationKey, oneTimeDownload }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase credentials not configured. Click settings to set up your Supabase project credentials.');
  }

  const passcode = generatePasscode();
  const expiresAt = calculateExpirationISO(durationKey);

  const { data, error } = await supabase
    .from('shares')
    .insert([
      {
        code: passcode,
        type: 'text',
        content: content,
        one_time_download: oneTimeDownload,
        expires_at: expiresAt
      }
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data;
}

/**
 * Create a File Share
 */
export async function createFileShare({ file, durationKey, oneTimeDownload }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase credentials not configured. Click settings to set up your Supabase project credentials.');
  }

  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_SIZE) {
    throw new Error('File size exceeds the 50MB maximum limit.');
  }

  // 1. Upload File to Supabase Storage Bucket 'user-shares'
  const fileExt = file.name.split('.').pop();
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `uploads/${Date.now()}_${sanitizedFileName}`;

  const { data: uploadData, error: uploadError } = await supabase
    .storage
    .from('user-shares')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}. Make sure 'user-shares' bucket exists and RLS allows public uploads.`);
  }

  // 2. Retrieve Public URL for the uploaded file
  const { data: publicUrlData } = supabase
    .storage
    .from('user-shares')
    .getPublicUrl(storagePath);

  const publicUrl = publicUrlData.publicUrl;
  const passcode = generatePasscode();
  const expiresAt = calculateExpirationISO(durationKey);

  // 3. Insert metadata record into 'shares' table
  const { data, error: dbError } = await supabase
    .from('shares')
    .insert([
      {
        code: passcode,
        type: 'file',
        content: publicUrl,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        one_time_download: oneTimeDownload,
        expires_at: expiresAt
      }
    ])
    .select()
    .single();

  if (dbError) {
    // Rollback file if DB insert fails
    await supabase.storage.from('user-shares').remove([storagePath]);
    throw new Error(`Database record creation failed: ${dbError.message}`);
  }

  return data;
}

/**
 * Retrieve active Share by Passcode
 */
export async function getShareByCode(code) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase credentials not configured. Please open settings to configure credentials.');
  }

  const cleanCode = code.trim();
  const { data, error } = await supabase
    .from('shares')
    .select('*')
    .eq('code', cleanCode)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(`Error fetching share: ${error.message}`);
  }

  return data;
}

/**
 * Delete a share record and its associated storage file (for One-Time Download feature)
 */
export async function deleteShareRecordAndStorage(id, storagePath) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    // Delete file from storage if present
    if (storagePath) {
      await supabase.storage.from('user-shares').remove([storagePath]);
    }

    // Delete record from table
    await supabase.from('shares').delete().eq('id', id);
  } catch (err) {
    console.error('Error during one-time download deletion:', err);
  }
}
