import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRandomKey,
  deriveKeyFromPassphrase,
  exportKeyToBase64,
  importKeyFromBase64,
  getKeyFingerprint,
  encryptText,
  decryptText,
  encryptObject,
  decryptObject,
  encryptBinary,
  decryptBinary,
  isEncryptedPayload,
  isEncryptedBinary,
  parseKeyOrPassphraseInput,
  applyKeyOrPassphrase,
  bytesToBase64,
  base64ToBytes
} from '../src/crypto.js';
import {
  inferMimeType,
  decryptShareRecord
} from '../src/supabase.js';

test('Reviewer Round 3: Text-only item decryptedFileName is null, not "File"', async () => {
  const key = await generateRandomKey();
  const textMessage = 'Hello this is an important message for team 🐰';

  // 1. Text item encrypted with encryptObject (metadata)
  const metaPayload = await encryptObject({
    text: textMessage,
    fileName: null,
    mimeType: null,
    fileSize: null
  }, key);

  const rawTextRecord = {
    id: 'text-1',
    code: '123456',
    type: 'text',
    content: metaPayload,
    storage_path: null,
    file_name: null,
    file_size: null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString()
  };

  const decrypted = await decryptShareRecord(rawTextRecord, key);
  assert.strictEqual(decrypted._isLocked, false);
  assert.strictEqual(decrypted.decryptedContent, textMessage);
  assert.strictEqual(decrypted.decryptedFileName, null, 'Text-only item decryptedFileName must be null, not "File"');
  assert.strictEqual(decrypted.decryptedMimeType, null);

  // 2. Locked text item (no key provided)
  const lockedDecrypted = await decryptShareRecord(rawTextRecord, null);
  assert.strictEqual(lockedDecrypted._isLocked, true);
  assert.strictEqual(lockedDecrypted.decryptedFileName, null, 'Locked text item without storage_path should not have fileName "🔒 Encrypted File"');
});

test('Reviewer Round 3: Extended MIME type inference for modern media and office documents', () => {
  assert.strictEqual(inferMimeType('IMG_9999.HEIC'), 'image/heic');
  assert.strictEqual(inferMimeType('photo.heif'), 'image/heif');
  assert.strictEqual(inferMimeType('video.webm'), 'video/webm');
  assert.strictEqual(inferMimeType('dataset.csv'), 'text/csv');
  assert.strictEqual(inferMimeType('Report.DOCX'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.strictEqual(inferMimeType('Sheet.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.strictEqual(inferMimeType('Presentation.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
});

test('Reviewer Round 3: Complex URL pairing formats with router paths and query prefixes', () => {
  const sampleKey = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEF+=';

  // Format 1: #/app?key=...
  const p1 = parseKeyOrPassphraseInput(`https://upmee.vercel.app/#/app?key=${encodeURIComponent(sampleKey)}`);
  assert.strictEqual(p1?.type, 'base64_key');
  assert.strictEqual(p1?.value, sampleKey);

  // Format 2: #/share#key=...
  const p2 = parseKeyOrPassphraseInput(`https://upmee.vercel.app/#/share#key=${encodeURIComponent(sampleKey)}`);
  assert.strictEqual(p2?.type, 'base64_key');
  assert.strictEqual(p2?.value, sampleKey);

  // Format 3: ?key=... (without hash)
  const p3 = parseKeyOrPassphraseInput(`https://upmee.vercel.app/?key=${encodeURIComponent(sampleKey)}`);
  assert.strictEqual(p3?.type, 'base64_key');
  assert.strictEqual(p3?.value, sampleKey);
});

test('Reviewer Round 3: High iteration (5,000) random IV uniqueness check', async () => {
  const key = await generateRandomKey();
  const ivSet = new Set();
  const msg = 'Test uniqueness';

  for (let i = 0; i < 5000; i++) {
    const enc = await encryptText(msg, key);
    const parsed = JSON.parse(enc);
    assert.strictEqual(ivSet.has(parsed.iv), false, 'IV collision detected!');
    ivSet.add(parsed.iv);
  }

  assert.strictEqual(ivSet.size, 5000, '5000 unique IVs generated');
});

test('Reviewer Round 3: Tampered IV detection for binary and text payloads', async () => {
  const key = await generateRandomKey();

  // 1. Binary IV tampering
  const rawBytes = new Uint8Array([10, 20, 30, 40, 50]);
  const encBinary = await encryptBinary(rawBytes, key);
  const tamperedBinary = new Uint8Array(encBinary);
  // IV is at index 5 to 16
  tamperedBinary[5] ^= 0x01; // flip 1 bit in IV

  await assert.rejects(
    async () => {
      await decryptBinary(tamperedBinary, key);
    },
    'Tampered IV in binary payload must fail GCM tag verification and throw'
  );

  // 2. JSON IV tampering
  const encText = await encryptText('Secret Message', key);
  const parsed = JSON.parse(encText);
  const ivBytes = base64ToBytes(parsed.iv);
  ivBytes[0] ^= 0x01;
  parsed.iv = bytesToBase64(ivBytes);
  const tamperedJson = JSON.stringify(parsed);

  await assert.rejects(
    async () => {
      await decryptText(tamperedJson, key);
    },
    'Tampered IV in JSON payload must fail GCM tag verification and throw'
  );
});

test('Reviewer Round 3: Unicode passphrase PBKDF2 deterministic derivation', async () => {
  const unicodePass = '🔑รหัสผ่านภาษาไทย_日本語_🌟_2026_!@#$%^&*()';
  const key1 = await deriveKeyFromPassphrase(unicodePass);
  const key2 = await deriveKeyFromPassphrase(unicodePass);

  const b64_1 = await exportKeyToBase64(key1);
  const b64_2 = await exportKeyToBase64(key2);

  assert.strictEqual(b64_1, b64_2, 'PBKDF2 with unicode passphrases must derive identical key bytes');

  const fp1 = await getKeyFingerprint(key1);
  const fp2 = await getKeyFingerprint(key2);
  assert.strictEqual(fp1, fp2);
});
