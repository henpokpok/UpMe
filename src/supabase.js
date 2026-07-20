import { createClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'upme_supabase_url';
const STORAGE_ANON_KEY = 'upme_supabase_anon_key';

export function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem(STORAGE_URL_KEY) || '';
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem(STORAGE_ANON_KEY) || '';
  return { url, key };
}

export function saveSupabaseConfig(url, key) {
  localStorage.setItem(STORAGE_URL_KEY, url.trim());
  localStorage.setItem(STORAGE_ANON_KEY, key.trim());
}

let supabaseClientInstance = null;

export function getSupabaseClient() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  
  if (!supabaseClientInstance || supabaseClientInstance.supabaseUrl !== url) {
    supabaseClientInstance = createClient(url, key);
  }
  return supabaseClientInstance;
}

export function generatePasscode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

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
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Create a new share item (supports text, file, or both text + file)
 */
export async function createShareItem({ textContent, file, durationKey }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('กรุณาตั้งค่า Supabase URL และ Anon Key ในเมนูตั้งค่าก่อนใช้งานนะจ๊ะ');
  }

  const passcode = generatePasscode();
  const expiresAt = calculateExpirationISO(durationKey);

  let publicUrl = null;
  let storagePath = null;
  let fileName = null;
  let fileSize = null;
  let type = 'text';

  // 1. Upload File if attached
  if (file) {
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_SIZE) {
      throw new Error('ไฟล์มีขนาดเกิน 50MB ไม่สามารถอัปโหลดได้น้า');
    }

    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    storagePath = `uploads/${Date.now()}_${sanitizedFileName}`;

    const { error: uploadError } = await supabase
      .storage
      .from('user-shares')
      .upload(storagePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) {
      throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase
      .storage
      .from('user-shares')
      .getPublicUrl(storagePath);

    publicUrl = publicUrlData.publicUrl;
    fileName = file.name;
    fileSize = file.size;
    type = textContent ? 'both' : 'file';
  }

  const finalContent = textContent || publicUrl || '';

  // 2. Insert record into database
  const { data, error: dbError } = await supabase
    .from('shares')
    .insert([
      {
        code: passcode,
        type: type,
        content: finalContent,
        storage_path: storagePath,
        file_name: fileName,
        file_size: fileSize,
        one_time_download: false,
        expires_at: expiresAt
      }
    ])
    .select()
    .single();

  if (dbError) {
    if (storagePath) {
      await supabase.storage.from('user-shares').remove([storagePath]);
    }
    throw new Error(`บันทึกข้อมูลไม่สำเร็จ: ${dbError.message}`);
  }

  return data;
}

/**
 * Fetch all active non-expired shares for single-user live feed
 */
export async function getActiveSharesList() {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('shares')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching active shares:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Exception in getActiveSharesList:', err);
    return [];
  }
}

/**
 * Subscribe safely to Realtime WebSocket INSERT broadcasts on 'shares' table
 */
export function subscribeToRealtimeUploads(onNewUpload) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const channel = supabase
      .channel('upme-realtime-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shares' },
        (payload) => {
          if (payload && payload.new) {
            onNewUpload(payload.new);
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime status:', status);
      });

    return channel;
  } catch (err) {
    console.warn('Realtime subscription warning:', err);
    return null;
  }
}

/**
 * Retrieve active Share by Passcode
 */
export async function getShareByCode(code) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('กรุณาตั้งค่า Supabase URL และ Anon Key ก่อนนะจ๊ะ');
  }

  const cleanCode = code.trim();
  const { data, error } = await supabase
    .from('shares')
    .select('*')
    .eq('code', cleanCode)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(`เกิดข้อผิดพลาด: ${error.message}`);
  }

  return data;
}

/**
 * Delete a share record and storage file manually
 */
export async function deleteShareRecordAndStorage(id, storagePath) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    if (storagePath) {
      await supabase.storage.from('user-shares').remove([storagePath]);
    }

    await supabase.from('shares').delete().eq('id', id);
  } catch (err) {
    console.error('Error deleting share:', err);
  }
}

/**
 * Calculate total active storage bytes used out of 1GB free tier limit
 */
export async function getStorageUsageInfo() {
  try {
    const shares = await getActiveSharesList();
    const totalBytes = shares.reduce((acc, curr) => acc + (curr.file_size || 0), 0);
    const activeCount = shares.length;
    return { totalBytes, activeCount };
  } catch (err) {
    return { totalBytes: 0, activeCount: 0 };
  }
}
