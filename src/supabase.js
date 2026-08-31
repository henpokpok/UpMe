import { createClient } from '@supabase/supabase-js';
import {
  getActiveCryptoKey,
  encryptObject,
  encryptBinary,
  decryptObject,
  decryptText,
  decryptBinary,
  isEncryptedPayload,
  isEncryptedBinary
} from './crypto.js';

const STORAGE_URL_KEY = 'upme_supabase_url';
const STORAGE_ANON_KEY = 'upme_supabase_anon_key';

const DEFAULT_SUPABASE_URL = 'https://sdsrxmetbtdzhooxqkkh.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_GYM_eBLwWpct8GT6pPuc-g_r_9zEr_1';

export function getSupabaseConfig() {
  let url = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_URL_KEY) : null;
  let key = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_ANON_KEY) : null;

  if (!url || !url.startsWith('http')) {
    url = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) || DEFAULT_SUPABASE_URL;
  }
  if (!key || key.length < 10) {
    key = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || DEFAULT_SUPABASE_ANON_KEY;
  }

  return { url: url.trim(), key: key.trim() };
}

export function saveSupabaseConfig(url, key) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_URL_KEY, url.trim());
    localStorage.setItem(STORAGE_ANON_KEY, key.trim());
  }
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
 * Get public URL for a file stored in Supabase Storage
 */
export function getFilePublicUrl(storagePath) {
  if (!storagePath) return null;
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
    return storagePath;
  }
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = supabase.storage.from('user-shares').getPublicUrl(storagePath);
  return data ? data.publicUrl : null;
}

/**
 * Save device push subscription token for background Web Push notifications
 */
export async function savePushSubscription(subscription) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, error: 'Supabase client not configured' };

    const { error } = await supabase.from('push_subscriptions').insert([
      {
        subscription: subscription,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js'
      }
    ]);

    if (error) {
      console.error('Error inserting push subscription to DB:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.warn('Error saving push subscription:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Infer MIME type from filename or path extension
 */
export function inferMimeType(fileNameOrPath, fallback = 'application/octet-stream') {
  if (!fileNameOrPath || typeof fileNameOrPath !== 'string') return fallback;
  const clean = fileNameOrPath.toLowerCase().split('?')[0].split('#')[0];
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.heic')) return 'image/heic';
  if (clean.endsWith('.heif')) return 'image/heif';
  if (clean.endsWith('.pdf')) return 'application/pdf';
  if (clean.endsWith('.txt')) return 'text/plain';
  if (clean.endsWith('.json')) return 'application/json';
  if (clean.endsWith('.csv')) return 'text/csv';
  if (clean.endsWith('.mp4')) return 'video/mp4';
  if (clean.endsWith('.mov')) return 'video/quicktime';
  if (clean.endsWith('.webm')) return 'video/webm';
  if (clean.endsWith('.mp3')) return 'audio/mpeg';
  if (clean.endsWith('.wav')) return 'audio/wav';
  if (clean.endsWith('.zip')) return 'application/zip';
  if (clean.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (clean.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (clean.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return fallback;
}

/**
 * Decrypt a single raw share record from the database (transparent with zero locked state)
 */
export async function decryptShareRecord(rawItem, cryptoKey = null) {
  if (!rawItem) return null;
  const key = cryptoKey || getActiveCryptoKey();
  const item = { ...rawItem };

  if (isEncryptedPayload(item.content)) {
    if (key) {
      try {
        const decryptedText = await decryptText(item.content, key);
        let decryptedMeta = null;
        try {
          decryptedMeta = JSON.parse(decryptedText);
        } catch {
          decryptedMeta = { text: decryptedText };
        }

        const isMetaObj = decryptedMeta && typeof decryptedMeta === 'object' && !Array.isArray(decryptedMeta);
        const textVal = isMetaObj && typeof decryptedMeta.text === 'string' 
          ? decryptedMeta.text 
          : (typeof decryptedMeta === 'string' ? decryptedMeta : decryptedText);

        const resolvedFileName = (isMetaObj && decryptedMeta.fileName) 
          ? decryptedMeta.fileName 
          : (item.file_name && !item.file_name.includes('[E2EE Encrypted File]') 
              ? item.file_name 
              : (item.storage_path ? 'File' : null));

        const resolvedMime = (isMetaObj && decryptedMeta.mimeType) 
          ? decryptedMeta.mimeType 
          : inferMimeType(resolvedFileName || item.storage_path, item.storage_path ? 'application/octet-stream' : null);

        item._decrypted = true;
        item._isLocked = false;
        item.decryptedContent = textVal || '';
        item.decryptedFileName = resolvedFileName;
        item.decryptedMimeType = resolvedMime;
        item.decryptedFileSize = (isMetaObj && typeof decryptedMeta.fileSize === 'number') 
          ? decryptedMeta.fileSize 
          : item.file_size;
        return item;
      } catch (err) {
        // Fallback gracefully
      }
    }

    // Transparent fallback without locking
    item._decrypted = true;
    item._isLocked = false;
    item.decryptedContent = item.content || '';
    item.decryptedFileName = item.file_name && !item.file_name.includes('[E2EE Encrypted File]') 
      ? item.file_name 
      : (item.storage_path ? 'File' : null);
    item.decryptedMimeType = inferMimeType(item.decryptedFileName || item.storage_path, item.storage_path ? 'application/octet-stream' : null);
    item.decryptedFileSize = item.file_size;
    return item;
  } else {
    // Clean unencrypted record
    item._decrypted = true;
    item._isLocked = false;
    item.decryptedContent = item.content || '';
    item.decryptedFileName = item.file_name;
    item.decryptedMimeType = inferMimeType(item.file_name || item.storage_path, item.storage_path ? 'application/octet-stream' : null);
    item.decryptedFileSize = item.file_size;
    return item;
  }
}

/**
 * Fetch and decrypt binary file data from Supabase Storage (frictionless fallback)
 */
export async function fetchAndDecryptFile(storagePath, cryptoKey = null, mimeType = null) {
  if (!storagePath) throw new Error('Storage path is required');
  const fileUrl = getFilePublicUrl(storagePath);
  if (!fileUrl) throw new Error(`Could not get public URL for ${storagePath}`);

  const key = cryptoKey || getActiveCryptoKey();
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Failed to fetch file from storage: HTTP ${res.status}`);

  const rawBuffer = await res.arrayBuffer();
  const effectiveMime = (mimeType && mimeType !== 'application/octet-stream')
    ? mimeType
    : inferMimeType(storagePath, 'application/octet-stream');

  if (isEncryptedBinary(rawBuffer) && key) {
    try {
      const decryptedBuffer = await decryptBinary(rawBuffer, key);
      return new Blob([decryptedBuffer], { type: effectiveMime });
    } catch (err) {
      console.warn('Binary decryption fallback:', err);
    }
  }

  return new Blob([rawBuffer], { type: effectiveMime });
}

/**
 * Create a new share item (single file or text)
 */
export async function createShareItem({ textContent, file, durationKey, cryptoKey = null }) {
  const items = await createMultipleShareItems({
    textContent,
    files: file ? [file] : [],
    durationKey,
    cryptoKey
  });
  return items[0];
}

/**
 * Upload multiple files (and optional text) cleanly to Supabase
 */
export async function createMultipleShareItems({ textContent, files = [], durationKey, onProgress }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('กรุณาตั้งค่า Supabase URL และ Anon Key ในเมนูตั้งค่าก่อนใช้งานนะจ๊ะ');
  }

  const expiresAt = calculateExpirationISO(durationKey);
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB per file

  // Case 1: Only text content, no files attached
  if (!files || files.length === 0) {
    if (!textContent) {
      throw new Error('กรุณาระบุข้อความหรือเลือกไฟล์อย่างน้อย 1 อย่าง');
    }
    const passcode = generatePasscode();

    const { data, error: dbError } = await supabase
      .from('shares')
      .insert([
        {
          code: passcode,
          type: 'text',
          content: textContent,
          storage_path: null,
          file_name: null,
          file_size: null,
          one_time_download: false,
          expires_at: expiresAt
        }
      ])
      .select()
      .single();

    if (dbError) {
      throw new Error(`บันทึกข้อความไม่สำเร็จ: ${dbError.message}`);
    }
    return [await decryptShareRecord(data)];
  }

  // Case 2: One or more files
  for (const file of files) {
    if (file.size > MAX_SIZE) {
      throw new Error(`ไฟล์ "${file.name}" มีขนาดเกิน 50MB ไม่สามารถอัปโหลดได้น้า`);
    }
  }

  const results = [];
  const errors = [];
  const totalCount = files.length;
  let completedCount = 0;

  // Process files with concurrency limit of 3
  const CONCURRENCY_LIMIT = 3;
  let currentIndex = 0;

  async function uploadWorker() {
    while (currentIndex < files.length) {
      const index = currentIndex++;
      const file = files[index];
      const timestamp = Date.now();
      
      const randomSuffix = (typeof crypto !== 'undefined' && crypto.randomUUID) 
        ? crypto.randomUUID().replace(/-/g, '') 
        : Math.random().toString(36).substring(2) + timestamp.toString(36);
      const fileExt = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const storagePath = `uploads/${timestamp}_${index}_${randomSuffix}.${fileExt}`;
      const passcode = generatePasscode();

      try {
        // 1. Upload File to Supabase Storage
        const { error: uploadError } = await supabase
          .storage
          .from('user-shares')
          .upload(storagePath, file, { cacheControl: '3600', upsert: false });

        if (uploadError) {
          throw new Error(`อัปโหลด "${file.name}" ไม่สำเร็จ: ${uploadError.message}`);
        }

        const fileType = textContent ? 'both' : 'file';

        // 2. Insert record into database
        let { data, error: dbError } = await supabase
          .from('shares')
          .insert([
            {
              code: passcode,
              type: fileType,
              content: textContent || '',
              storage_path: storagePath,
              file_name: file.name,
              file_size: file.size,
              one_time_download: false,
              expires_at: expiresAt
            }
          ])
          .select()
          .single();

        // Fallback for check constraint if type 'both' isn't supported in old schema
        if (dbError && dbError.message && dbError.message.includes('shares_type_check')) {
          const { data: retryData, error: retryError } = await supabase
            .from('shares')
            .insert([
              {
                code: passcode,
                type: 'file',
                content: textContent || '',
                storage_path: storagePath,
                file_name: file.name,
                file_size: file.size,
                one_time_download: false,
                expires_at: expiresAt
              }
            ])
            .select()
            .single();

          if (!retryError) {
            data = retryData;
            dbError = null;
          }
        }

        if (dbError) {
          await supabase.storage.from('user-shares').remove([storagePath]);
          throw new Error(`บันทึก "${file.name}" ไม่สำเร็จ: ${dbError.message}`);
        }

        results.push(await decryptShareRecord(data));
      } catch (err) {
        errors.push({ file: file.name, message: err.message });
      } finally {
        completedCount++;
        if (onProgress) {
          onProgress({
            completed: completedCount,
            total: totalCount,
            currentFile: file.name,
            percentage: Math.round((completedCount / totalCount) * 100)
          });
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, files.length) }, () => uploadWorker());
  await Promise.all(workers);

  if (results.length === 0 && errors.length > 0) {
    throw new Error(errors.map(e => e.message).join('\n'));
  }

  return results;
}

/**
 * Fetch all active non-expired shares and decrypt them on the fly
 */
export async function getActiveSharesList(cryptoKey = null) {
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

    if (!data || data.length === 0) return [];

    const key = cryptoKey || getActiveCryptoKey();
    const decryptedItems = await Promise.all(data.map(item => decryptShareRecord(item, key)));
    return decryptedItems;
  } catch (err) {
    console.error('Exception in getActiveSharesList:', err);
    return [];
  }
}

let activeRealtimeChannel = null;

/**
 * Subscribe safely to Realtime WebSocket INSERT broadcasts on 'shares' table
 */
export function subscribeToRealtimeUploads(onNewUpload, cryptoKey = null) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    if (activeRealtimeChannel) {
      try {
        supabase.removeChannel(activeRealtimeChannel);
      } catch (unsubErr) {
        console.warn('Channel removal note:', unsubErr);
      }
      activeRealtimeChannel = null;
    }

    activeRealtimeChannel = supabase
      .channel('upme-realtime-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shares' },
        async (payload) => {
          if (payload && payload.new) {
            const key = cryptoKey || getActiveCryptoKey();
            const decryptedRecord = await decryptShareRecord(payload.new, key);
            onNewUpload(decryptedRecord);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Connected safely
        }
      });

    return activeRealtimeChannel;
  } catch (err) {
    console.warn('Realtime subscription warning:', err);
    return null;
  }
}

/**
 * Delete a share record and storage file manually
 */
export async function deleteShareRecordAndStorage(id, storagePath) {
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false, error: 'Supabase client not configured' };

  try {
    const { error: dbError } = await supabase
      .from('shares')
      .delete()
      .eq('id', id);

    if (dbError) {
      console.error('Error deleting share from DB:', dbError);
      return { success: false, error: dbError.message };
    }

    if (storagePath) {
      supabase.storage
        .from('user-shares')
        .remove([storagePath])
        .catch(stErr => console.warn('Non-critical storage cleanup warning:', stErr));
    }

    return { success: true };
  } catch (err) {
    console.error('Exception in deleteShareRecordAndStorage:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Batch delete multiple shares and their associated storage files
 */
export async function batchDeleteShares(items) {
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false, error: 'Supabase client not configured' };
  if (!items || items.length === 0) return { success: true };

  try {
    const ids = items.map(i => i.id).filter(Boolean);
    const storagePaths = items.map(i => i.storage_path).filter(Boolean);

    if (ids.length > 0) {
      const { error: dbError } = await supabase
        .from('shares')
        .delete()
        .in('id', ids);

      if (dbError) {
        console.error('Error batch deleting shares from DB:', dbError);
        return { success: false, error: dbError.message };
      }
    }

    if (storagePaths.length > 0) {
      supabase.storage
        .from('user-shares')
        .remove(storagePaths)
        .catch(stErr => console.warn('Storage batch cleanup warning:', stErr));
    }

    return { success: true };
  } catch (err) {
    console.error('Exception in batchDeleteShares:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Calculate total active storage bytes used out of 1GB free tier limit
 * Supports passing pre-fetched shares to avoid duplicate network queries and decryptions
 */
export async function getStorageUsageInfo(providedShares = null) {
  try {
    if (Array.isArray(providedShares)) {
      const totalBytes = providedShares.reduce((acc, curr) => acc + (curr.file_size || curr.decryptedFileSize || 0), 0);
      const activeCount = providedShares.length;
      return { totalBytes, activeCount };
    }

    const supabase = getSupabaseClient();
    if (!supabase) return { totalBytes: 0, activeCount: 0 };

    const { data, error } = await supabase
      .from('shares')
      .select('file_size')
      .gt('expires_at', new Date().toISOString());

    if (error || !data) return { totalBytes: 0, activeCount: 0 };

    const totalBytes = data.reduce((acc, curr) => acc + (curr.file_size || 0), 0);
    return { totalBytes, activeCount: data.length };
  } catch (err) {
    return { totalBytes: 0, activeCount: 0 };
  }
}
