import { createClient } from '@supabase/supabase-js';
import {
  getActiveCryptoKey,
  encryptText,
  decryptText,
  encryptObject,
  decryptObject,
  encryptBinary,
  decryptBinary,
  isEncryptedPayload,
  isEncryptedBinary,
  deriveKeyFromPassphrase
} from './crypto.js';

const STORAGE_URL_KEY = 'upme_supabase_url';
const STORAGE_ANON_KEY = 'upme_supabase_anon_key';

const DEFAULT_SUPABASE_URL = 'https://sdsrxmetbtdzhooxqkkh.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_GYM_eBLwWpct8GT6pPuc-g_r_9zEr_1';

function hasLocalStorage() {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined' && window.localStorage !== null;
  } catch {
    return false;
  }
}

export function getSupabaseConfig() {
  let url = hasLocalStorage() ? window.localStorage.getItem(STORAGE_URL_KEY) : null;
  let key = hasLocalStorage() ? window.localStorage.getItem(STORAGE_ANON_KEY) : null;

  if (!url || !url.startsWith('http')) {
    url = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) || DEFAULT_SUPABASE_URL;
  }
  if (!key || key.length < 10) {
    key = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || DEFAULT_SUPABASE_ANON_KEY;
  }

  return { url: url.trim(), key: key.trim() };
}

export function saveSupabaseConfig(url, key) {
  if (hasLocalStorage()) {
    window.localStorage.setItem(STORAGE_URL_KEY, url.trim());
    window.localStorage.setItem(STORAGE_ANON_KEY, key.trim());
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
 * Get or create a persistent device identifier for ownership & delete control
 */
export function getOrCreateDeviceId() {
  if (!hasLocalStorage()) return 'server_device';
  let deviceId = window.localStorage.getItem('upmee_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    window.localStorage.setItem('upmee_device_id', deviceId);
  }
  return deviceId;
}

/**
 * Fetch the persistent encrypted challenge from Supabase to verify master passphrase
 */
export async function getVaultChallenge() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('shares')
      .select('content')
      .eq('code', 'VAULT1')
      .maybeSingle();
    if (error || !data) return null;
    return data.content;
  } catch (err) {
    console.warn('Error fetching vault challenge:', err);
    return null;
  }
}

/**
 * Setup or update the encrypted challenge in Supabase using the master CryptoKey
 */
export async function setupVaultChallenge(cryptoKey) {
  const supabase = getSupabaseClient();
  if (!supabase || !cryptoKey) return false;
  try {
    const challengeSecret = 'UPMEE_VAULT_ACTIVE_SECRET';
    const encryptedSecret = await encryptText(challengeSecret, cryptoKey);
    
    // Check if challenge already exists
    const existing = await getVaultChallenge();
    if (existing) {
      const { error } = await supabase
        .from('shares')
        .update({ content: encryptedSecret })
        .eq('code', 'VAULT1');
      return !error;
    } else {
      const { error } = await supabase
        .from('shares')
        .insert([
          {
            code: 'VAULT1',
            type: 'text',
            content: encryptedSecret,
            storage_path: null,
            file_name: 'vault_system_challenge',
            file_size: 0,
            one_time_download: false,
            expires_at: '2099-12-31T23:59:59Z'
          }
        ]);
      return !error;
    }
  } catch (err) {
    console.warn('Error setting up vault challenge:', err);
    return false;
  }
}

/**
 * Verify if an entered passphrase is valid against the vault challenge in Supabase
 */
export async function verifyPassphraseAgainstVault(passphrase) {
  const challenge = await getVaultChallenge();
  if (!challenge) {
    // If no challenge in DB yet, this is the first initialization of the vault
    return { isFirstTime: true, valid: true };
  }
  try {
    const testKey = await deriveKeyFromPassphrase(passphrase.trim());
    const decrypted = await decryptText(challenge, testKey);
    if (decrypted === 'UPMEE_VAULT_ACTIVE_SECRET') {
      return { isFirstTime: false, valid: true, key: testKey };
    }
    return { isFirstTime: false, valid: false };
  } catch {
    return { isFirstTime: false, valid: false };
  }
}

/**
 * Download and decrypt an encrypted file from Supabase Storage, returning a decrypted Blob
 */
export async function decryptAndFetchFileBlob(storagePath) {
  const publicUrl = getFilePublicUrl(storagePath);
  if (!publicUrl) throw new Error('File URL not found');
  
  const res = await fetch(publicUrl);
  if (!res.ok) throw new Error(`Failed to fetch file: HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  const cryptoKey = getActiveCryptoKey();
  if (isEncryptedBinary(uint8)) {
    if (!cryptoKey) throw new Error('Master encryption key required to decrypt this file');
    const decryptedBuffer = await decryptBinary(uint8, cryptoKey);
    return new Blob([decryptedBuffer]);
  }

  // Not encrypted (legacy file)
  return new Blob([uint8]);
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
 * Create a new share item (single file or text)
 */
export async function createShareItem({ textContent, file, durationKey }) {
  const items = await createMultipleShareItems({
    textContent,
    files: file ? [file] : [],
    durationKey
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
    const cryptoKey = getActiveCryptoKey();
    let finalContent = textContent;

    if (cryptoKey) {
      const metadata = {
        text: textContent,
        fileName: null,
        mimeType: 'text/plain',
        fileSize: 0,
        ownerDevice: getOrCreateDeviceId()
      };
      finalContent = await encryptObject(metadata, cryptoKey);
    }

    const { data, error: dbError } = await supabase
      .from('shares')
      .insert([
        {
          code: passcode,
          type: 'text',
          content: finalContent,
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
    return [data];
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
  const cryptoKey = getActiveCryptoKey();

  // Process files with concurrency limit of 3
  const CONCURRENCY_LIMIT = 3;
  let currentIndex = 0;

  async function uploadWorker() {
    while (currentIndex < files.length) {
      const index = currentIndex++;
      const file = files[index];
      const timestamp = Date.now();
      const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = cryptoKey 
        ? `uploads/${timestamp}_${index}_vault.bin`
        : `uploads/${timestamp}_${index}_${sanitizedFileName}`;
      const passcode = generatePasscode();

      try {
        let uploadPayload = file;
        let finalContent = '';
        let insertFileName = file.name;
        let insertFileSize = file.size;

        if (cryptoKey) {
          const fileBuffer = await file.arrayBuffer();
          const encryptedBytes = await encryptBinary(fileBuffer, cryptoKey);
          uploadPayload = encryptedBytes;
          insertFileSize = encryptedBytes.byteLength;
          insertFileName = 'Encrypted File';

          const metadata = {
            text: textContent || null,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileSize: file.size,
            ownerDevice: getOrCreateDeviceId()
          };
          finalContent = await encryptObject(metadata, cryptoKey);
        }

        // 1. Upload File to Supabase Storage
        const { error: uploadError } = await supabase
          .storage
          .from('user-shares')
          .upload(storagePath, uploadPayload, { 
            cacheControl: '3600', 
            upsert: false,
            contentType: cryptoKey ? 'application/octet-stream' : (file.type || 'application/octet-stream')
          });

        if (uploadError) {
          throw new Error(`อัปโหลด "${file.name}" ไม่สำเร็จ: ${uploadError.message}`);
        }

        const { data: publicUrlData } = supabase
          .storage
          .from('user-shares')
          .getPublicUrl(storagePath);

        const publicUrl = publicUrlData ? publicUrlData.publicUrl : '';
        const fileType = textContent ? 'both' : 'file';
        if (!cryptoKey) {
          finalContent = textContent ? textContent : (publicUrl || '');
        }

        // 2. Insert record into database
        let { data, error: dbError } = await supabase
          .from('shares')
          .insert([
            {
              code: passcode,
              type: fileType,
              content: finalContent,
              storage_path: storagePath,
              file_name: insertFileName,
              file_size: insertFileSize,
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
                content: finalContent,
                storage_path: storagePath,
                file_name: insertFileName,
                file_size: insertFileSize,
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

        results.push(data);
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
 * Fetch all active non-expired shares and decrypt them if key is active
 */
export async function getActiveSharesList() {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('shares')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .neq('code', 'VAULT1')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching active shares:', error);
      if (error.message && (error.message.includes('exceed_storage_size_quota') || error.message.includes('restricted'))) {
        throw new Error('Supabase Storage เต็มโควตา (เกิน 1 GB) ทำให้ระบบถูกระงับชั่วคราว');
      }
      return [];
    }

    if (!data || data.length === 0) return [];

    const cryptoKey = getActiveCryptoKey();
    const decryptedShares = await Promise.all(data.map(async (item) => {
      if (isEncryptedPayload(item.content)) {
        if (cryptoKey) {
          try {
            const meta = await decryptObject(item.content, cryptoKey);
            return {
              ...item,
              _isEncrypted: true,
              _isLocked: false,
              file_name: meta.fileName || (item.storage_path ? item.file_name : null),
              file_size: meta.fileSize !== undefined ? meta.fileSize : item.file_size,
              mimeType: meta.mimeType || null,
              content: meta.text || (item.storage_path ? '' : item.content),
              ownerDevice: meta.ownerDevice || null
            };
          } catch {
            return {
              ...item,
              _isEncrypted: true,
              _isLocked: true,
              file_name: '🔒 Encrypted File',
              content: '🔒 Encrypted Content'
            };
          }
        } else {
          return {
            ...item,
            _isEncrypted: true,
            _isLocked: true,
            file_name: '🔒 Encrypted File',
            content: '🔒 Encrypted Content'
          };
        }
      }
      return {
        ...item,
        _isEncrypted: false,
        _isLocked: false
      };
    }));

    return decryptedShares;
  } catch (err) {
    console.error('Exception in getActiveSharesList:', err);
    return [];
  }
}

let activeRealtimeChannel = null;

/**
 * Subscribe safely to Realtime WebSocket INSERT broadcasts on 'shares' table
 */
export function subscribeToRealtimeUploads(onNewUpload) {
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
        (payload) => {
          if (payload && payload.new) {
            onNewUpload(payload.new);
          }
        }
      )
      .subscribe();

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
      .eq('id', id)
      .neq('code', 'VAULT1');

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
        .in('id', ids)
        .neq('code', 'VAULT1');

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
 * Supports passing pre-fetched shares to avoid duplicate network queries
 */
export async function getStorageUsageInfo(providedShares = null) {
  try {
    if (Array.isArray(providedShares)) {
      const totalBytes = providedShares.reduce((acc, curr) => acc + (curr.file_size || 0), 0);
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

/**
 * Clean up expired shares and their physical files in Supabase Storage via official Storage API
 */
export async function cleanExpiredSharesClientSide() {
  const supabase = getSupabaseClient();
  if (!supabase) return { cleanedCount: 0 };

  try {
    const { data: expiredShares, error } = await supabase
      .from('shares')
      .select('id, storage_path')
      .lt('expires_at', new Date().toISOString())
      .neq('code', 'VAULT1')
      .limit(50);

    if (error || !expiredShares || expiredShares.length === 0) {
      return { cleanedCount: 0 };
    }

    const storagePaths = expiredShares.map(s => s.storage_path).filter(Boolean);
    const ids = expiredShares.map(s => s.id);

    if (storagePaths.length > 0) {
      await supabase.storage.from('user-shares').remove(storagePaths);
    }

    if (ids.length > 0) {
      await supabase.from('shares').delete().in('id', ids).neq('code', 'VAULT1');
    }

    return { cleanedCount: expiredShares.length };
  } catch (err) {
    console.warn('Auto cleanup error:', err);
    return { cleanedCount: 0 };
  }
}
