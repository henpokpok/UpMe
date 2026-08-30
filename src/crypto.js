/**
 * UpMe Client-Side End-to-End Encryption (E2EE) Module
 * Native Web Crypto API (AES-GCM 256-bit, PBKDF2/SHA-256)
 */

// Universal crypto subtle resolver (Browser, Worker, Node.js)
function getSubtleCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    return window.crypto.subtle;
  }
  throw new Error('Web Crypto API (crypto.subtle) is not available in this environment');
}

function getRandomValues(array) {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
    return globalThis.crypto.getRandomValues(array);
  }
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    return window.crypto.getRandomValues(array);
  }
  throw new Error('crypto.getRandomValues is not available');
}

// Storage Keys
export const STORAGE_E2EE_KEY = 'upme_e2ee_key_b64';
export const STORAGE_E2EE_PASSPHRASE = 'upme_e2ee_passphrase';

// Constants
const PBKDF2_SALT = new TextEncoder().encode('UpMe-E2EE-PBKDF2-Salt-v1');
const PBKDF2_ITERATIONS = 100000;
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12; // 12 bytes for AES-GCM
const BINARY_MAGIC = new Uint8Array([0x55, 0x50, 0x4D, 0x45, 0x01]); // 'UPME\x01'
const BINARY_HEADER_LEN = BINARY_MAGIC.length + IV_LENGTH; // 5 + 12 = 17 bytes

// Base64 Helpers (safe for browser & node)
export function bytesToBase64(bytes) {
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength).toString('base64');
  }
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < uint8.length; i += CHUNK_SIZE) {
    const chunk = uint8.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return window.btoa(binary);
}

export function base64ToBytes(base64) {
  if (typeof base64 !== 'string') return new Uint8Array(0);
  let str = base64;
  // If string is exactly 43 or 44 chars, do not trim because leading/trailing space was originally a '+'
  if (str.length !== 43 && str.length !== 44) {
    str = str.trim();
  }
  // Normalize spaces (e.g. from URL query string decoding + as space), URL-safe chars, and padding
  let cleaned = str.replace(/\s+/g, '+').replace(/-/g, '+').replace(/_/g, '/');
  const pad = cleaned.length % 4;
  if (pad === 2) cleaned += '==';
  else if (pad === 3) cleaned += '=';
  else if (pad === 1) cleaned += '===';

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(cleaned, 'base64'));
  }
  const binary = window.atob(cleaned);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}


/**
 * Generate a new random AES-GCM 256-bit CryptoKey
 */
export async function generateRandomKey() {
  const subtle = getSubtleCrypto();
  return await subtle.generateKey(
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive an AES-GCM 256-bit CryptoKey from a user passphrase using PBKDF2 with SHA-256
 */
export async function deriveKeyFromPassphrase(passphrase) {
  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('Passphrase must be a non-empty string');
  }
  const subtle = getSubtleCrypto();
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: PBKDF2_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Export a CryptoKey to a Base64 string
 */
export async function exportKeyToBase64(cryptoKey) {
  const subtle = getSubtleCrypto();
  const raw = await subtle.exportKey('raw', cryptoKey);
  return bytesToBase64(raw);
}

/**
 * Import an AES-GCM 256-bit CryptoKey from a Base64 string
 */
export async function importKeyFromBase64(base64Key) {
  if (!base64Key || typeof base64Key !== 'string') {
    throw new Error('Invalid Base64 key string');
  }
  const rawBytes = base64ToBytes(base64Key);
  if (rawBytes.byteLength !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes (256-bit), got ${rawBytes.byteLength} bytes`);
  }
  const subtle = getSubtleCrypto();
  return await subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Calculate a short visual fingerprint for a CryptoKey (e.g. "A1B2-C3D4")
 */
export async function getKeyFingerprint(cryptoKey) {
  if (!cryptoKey) return null;
  const subtle = getSubtleCrypto();
  const raw = await subtle.exportKey('raw', cryptoKey);
  const hash = await subtle.digest('SHA-256', raw);
  const hashBytes = new Uint8Array(hash);
  const hex = Array.from(hashBytes.slice(0, 4))
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

/**
 * Encrypt a plaintext string using AES-GCM 256-bit
 * Returns a JSON-serialized encrypted payload string
 */
export async function encryptText(plaintext, cryptoKey) {
  if (typeof plaintext !== 'string') {
    plaintext = String(plaintext || '');
  }
  const subtle = getSubtleCrypto();
  const iv = getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoded
  );

  return JSON.stringify({
    v: 1,
    e2ee: true,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertextBuffer))
  });
}

/**
 * Check if a given string is an E2EE encrypted JSON payload
 */
export function isEncryptedPayload(str) {
  if (typeof str !== 'string') {
    return false;
  }
  const trimmed = str.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return Boolean(
      parsed &&
      parsed.e2ee === true &&
      typeof parsed.iv === 'string' &&
      typeof parsed.data === 'string' &&
      parsed.iv.length > 0 &&
      parsed.data.length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Decrypt an E2EE encrypted JSON payload string
 */
export async function decryptText(payloadStr, cryptoKey) {
  if (typeof payloadStr !== 'string' || !isEncryptedPayload(payloadStr)) {
    // Return original string if not an encrypted payload (legacy unencrypted content)
    return payloadStr;
  }

  if (!cryptoKey) {
    throw new Error('Encryption key required for decryption');
  }

  const parsed = JSON.parse(payloadStr.trim());
  const iv = base64ToBytes(parsed.iv);
  const ciphertext = base64ToBytes(parsed.data);
  const subtle = getSubtleCrypto();

  const decryptedBuffer = await subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Encrypt a JavaScript Object into an E2EE encrypted JSON string
 */
export async function encryptObject(obj, cryptoKey) {
  const jsonStr = JSON.stringify(obj);
  return await encryptText(jsonStr, cryptoKey);
}

/**
 * Decrypt an E2EE encrypted JSON string back into a JavaScript Object
 */
export async function decryptObject(payloadStr, cryptoKey) {
  const decryptedText = await decryptText(payloadStr, cryptoKey);
  try {
    return JSON.parse(decryptedText);
  } catch (err) {
    throw new Error(`Failed to parse decrypted JSON object: ${err.message}`);
  }
}

/**
 * Check if an ArrayBuffer or Uint8Array has the UpMe E2EE binary magic header
 */
export function isEncryptedBinary(data) {
  if (!data) return false;
  const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Header (17 bytes) + AES-GCM Auth Tag (16 bytes) = minimum 33 bytes
  if (uint8.byteLength < BINARY_HEADER_LEN + 16) return false;

  for (let i = 0; i < BINARY_MAGIC.length; i++) {
    if (uint8[i] !== BINARY_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Encrypt binary data (ArrayBuffer or Uint8Array) using AES-GCM 256-bit
 * Returns a Uint8Array containing: [ MAGIC (5 bytes) | IV (12 bytes) | Ciphertext + Tag ]
 */
export async function encryptBinary(binaryData, cryptoKey) {
  const subtle = getSubtleCrypto();
  const iv = getRandomValues(new Uint8Array(IV_LENGTH));
  const rawBytes = binaryData instanceof Uint8Array ? binaryData : new Uint8Array(binaryData);

  const ciphertextBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    rawBytes
  );

  const ciphertextUint8 = new Uint8Array(ciphertextBuffer);
  const output = new Uint8Array(BINARY_HEADER_LEN + ciphertextUint8.byteLength);

  // Write Magic Header 'UPME\x01'
  output.set(BINARY_MAGIC, 0);
  // Write IV (12 bytes)
  output.set(iv, BINARY_MAGIC.length);
  // Write Ciphertext + Tag
  output.set(ciphertextUint8, BINARY_HEADER_LEN);

  return output;
}

/**
 * Decrypt binary data that was encrypted with encryptBinary
 * Returns the decrypted ArrayBuffer
 */
export async function decryptBinary(encryptedData, cryptoKey) {
  const uint8 = encryptedData instanceof Uint8Array ? encryptedData : new Uint8Array(encryptedData);

  if (!isEncryptedBinary(uint8)) {
    // If not encrypted (legacy file), return underlying ArrayBuffer directly
    return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
  }

  if (!cryptoKey) {
    throw new Error('Encryption key required for binary decryption');
  }

  const iv = uint8.slice(BINARY_MAGIC.length, BINARY_HEADER_LEN);
  const ciphertext = uint8.slice(BINARY_HEADER_LEN);
  const subtle = getSubtleCrypto();

  return await subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );
}

// In-Memory Key Singleton
let activeCryptoKey = null;

/**
 * Get current active CryptoKey instance in memory
 */
export function getActiveCryptoKey() {
  return activeCryptoKey;
}

/**
 * Set active CryptoKey in memory
 */
export function setActiveCryptoKey(key) {
  activeCryptoKey = key;
}

/**
 * Load encryption key from localStorage or URL hash/query (#key=..., ?key=..., #passphrase=..., ?passphrase=...)
 * Automatically generates a key if none exists on first launch.
 */
export async function initializeEncryptionKey() {
  // 1. Check URL Hash Fragment or Search Query for pairing
  if (typeof window !== 'undefined' && window.location) {
    let keyParam = null;
    let passParam = null;

    if (window.location.hash) {
      const hashSegments = window.location.hash.split('#').slice(1);
      const keySegment = hashSegments.find(s => s.includes('key=') || s.includes('passphrase='));
      const cleanHash = keySegment || hashSegments[hashSegments.length - 1] || '';
      const queryInHash = cleanHash.includes('?') ? (cleanHash.split('?').find(s => s.includes('key=') || s.includes('passphrase=')) || cleanHash.split('?')[1]) : cleanHash;
      const hashParams = new URLSearchParams((queryInHash || '').replace(/^[/#&]+/, ''));
      keyParam = hashParams.get('key');
      passParam = hashParams.get('passphrase');
    }

    if (!keyParam && !passParam && window.location.search) {
      const searchParams = new URLSearchParams(window.location.search);
      keyParam = searchParams.get('key');
      passParam = searchParams.get('passphrase');
    }

    if (keyParam) {
      try {
        const key = await importKeyFromBase64(keyParam);
        await saveEncryptionKey(key);
        // Clear hash & query params cleanly from address bar without reloading
        const cleanUrl = window.location.pathname;
        window.history.replaceState(null, document.title, cleanUrl);
        return { key, paired: true, source: 'url_key' };
      } catch (err) {
        console.warn('Failed to import key from URL:', err);
      }
    } else if (passParam) {
      try {
        const key = await deriveKeyFromPassphrase(passParam);
        await saveEncryptionKey(key, passParam);
        const cleanUrl = window.location.pathname;
        window.history.replaceState(null, document.title, cleanUrl);
        return { key, paired: true, source: 'url_passphrase' };
      } catch (err) {
        console.warn('Failed to import passphrase from URL:', err);
      }
    }
  }

  // 2. Check localStorage for stored key
  if (typeof localStorage !== 'undefined') {
    const storedB64 = localStorage.getItem(STORAGE_E2EE_KEY);
    if (storedB64) {
      try {
        const key = await importKeyFromBase64(storedB64);
        setActiveCryptoKey(key);
        return { key, paired: false, source: 'localStorage' };
      } catch (err) {
        console.warn('Failed to load stored key from localStorage:', err);
      }
    }

    const storedPassphrase = localStorage.getItem(STORAGE_E2EE_PASSPHRASE);
    if (storedPassphrase) {
      try {
        const key = await deriveKeyFromPassphrase(storedPassphrase);
        setActiveCryptoKey(key);
        return { key, paired: false, source: 'localStorage_passphrase' };
      } catch (err) {
        console.warn('Failed to derive key from stored passphrase:', err);
      }
    }
  }

  // 3. First Launch: Generate a random 256-bit AES-GCM Key and save it
  const newKey = await generateRandomKey();
  await saveEncryptionKey(newKey);
  return { key: newKey, paired: false, source: 'auto_generated' };
}

/**
 * Persist an encryption key into localStorage
 */
export async function saveEncryptionKey(cryptoKey, optionalPassphrase = null) {
  setActiveCryptoKey(cryptoKey);
  if (typeof localStorage !== 'undefined') {
    const b64 = await exportKeyToBase64(cryptoKey);
    localStorage.setItem(STORAGE_E2EE_KEY, b64);
    if (optionalPassphrase) {
      localStorage.setItem(STORAGE_E2EE_PASSPHRASE, optionalPassphrase);
    } else {
      localStorage.removeItem(STORAGE_E2EE_PASSPHRASE);
    }
  }
}

/**
 * Parse user input string which may be a master passphrase, raw base64 key, hex key, or pairing URL
 */
export function parseKeyOrPassphraseInput(inputStr) {
  if (!inputStr || typeof inputStr !== 'string') return null;
  const trimmed = inputStr.trim();
  if (!trimmed) return null;

  // 1. Check if input is a URL or query/hash string containing key or passphrase
  if (trimmed.includes('#') || trimmed.includes('?') || trimmed.includes('key=') || trimmed.includes('passphrase=')) {
    try {
      let paramStr = trimmed;
      if (trimmed.includes('#')) {
        const hashSegments = trimmed.split('#');
        const keySegment = hashSegments.slice(1).find(s => s.includes('key=') || s.includes('passphrase='));
        paramStr = keySegment || hashSegments[hashSegments.length - 1];
      } else if (trimmed.includes('?')) {
        const querySegments = trimmed.split('?');
        const keySegment = querySegments.slice(1).find(s => s.includes('key=') || s.includes('passphrase='));
        paramStr = keySegment || querySegments[querySegments.length - 1];
      }
      if (paramStr.includes('?')) {
        const subQuery = paramStr.split('?').find(s => s.includes('key=') || s.includes('passphrase='));
        if (subQuery) paramStr = subQuery;
      }
      paramStr = paramStr.replace(/^[/?#&]+/, '');
      const params = new URLSearchParams(paramStr);
      const urlKey = params.get('key');
      const urlPass = params.get('passphrase');
      if (urlKey) return { type: 'base64_key', value: urlKey };
      if (urlPass) return { type: 'passphrase', value: urlPass };
    } catch {}
  }

  // 2. Check if input is a 64-char Hex string (32 bytes = 256 bits)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { type: 'hex_key', value: trimmed };
  }

  // 3. Check if input is standard / URL-safe Base64 key (32 bytes = 43 or 44 chars)
  const normalizedB64 = trimmed.replace(/\s+/g, '+');
  if ((normalizedB64.length === 43 || normalizedB64.length === 44) && /^[A-Za-z0-9+/_-]+=*$/.test(normalizedB64)) {
    return { type: 'base64_key', value: normalizedB64 };
  }

  // 4. Default: User master passphrase
  return { type: 'passphrase', value: trimmed };
}

/**
 * Apply and activate key from either passphrase, base64 key, hex key, or pairing link
 */
export async function applyKeyOrPassphrase(inputStr) {
  const parsed = parseKeyOrPassphraseInput(inputStr);
  if (!parsed) throw new Error('Passphrase or Key cannot be empty');

  if (parsed.type === 'hex_key') {
    const rawBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      rawBytes[i] = parseInt(parsed.value.substr(i * 2, 2), 16);
    }
    const subtle = getSubtleCrypto();
    const key = await subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    await saveEncryptionKey(key, null);
    return { key, type: 'hex_key' };
  }

  if (parsed.type === 'base64_key') {
    try {
      const key = await importKeyFromBase64(parsed.value);
      await saveEncryptionKey(key, null);
      return { key, type: 'base64_key' };
    } catch {
      // Fallback to passphrase derivation if base64 decoding fails
      const key = await setMasterPassphrase(parsed.value);
      return { key, type: 'passphrase' };
    }
  }

  const key = await setMasterPassphrase(parsed.value);
  return { key, type: 'passphrase' };
}

/**
 * Set and save a user master passphrase
 */
export async function setMasterPassphrase(passphrase) {
  const key = await deriveKeyFromPassphrase(passphrase);
  await saveEncryptionKey(key, passphrase);
  return key;
}

/**
 * Set and save a raw base64 key
 */
export async function setRawKeyBase64(base64Key) {
  const key = await importKeyFromBase64(base64Key);
  await saveEncryptionKey(key, null);
  return key;
}

/**
 * Clear stored encryption keys (for testing or reset)
 */
export function clearStoredEncryptionKey() {
  setActiveCryptoKey(null);
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_E2EE_KEY);
    localStorage.removeItem(STORAGE_E2EE_PASSPHRASE);
  }
}

/**
 * Generate a shareable device pairing URL for the current active key
 */
export async function getPairingUrl() {
  const key = getActiveCryptoKey();
  if (!key) return null;
  const b64 = await exportKeyToBase64(key);
  if (typeof window !== 'undefined' && window.location) {
    const base = window.location.origin + window.location.pathname;
    return `${base}#key=${encodeURIComponent(b64)}`;
  }
  return `#key=${encodeURIComponent(b64)}`;
}
