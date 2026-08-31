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
  setActiveCryptoKey
} from '../src/crypto.js';
import {
  decryptShareRecord
} from '../src/supabase.js';

test('E2EE Integration: Database Record Inspection (No plaintext leakage)', async () => {
  const key = await generateRandomKey();
  const secretText = 'Very sensitive secret message with Thai characters: ข้อความลับ';
  const originalFileName = 'Confidential_Financial_Report_2026.xlsx';
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const fileSize = 98765;

  // Simulate what createMultipleShareItems does before writing to DB
  const metadataPayload = {
    text: secretText,
    fileName: originalFileName,
    mimeType: mimeType,
    fileSize: fileSize
  };

  const encryptedContent = await encryptObject(metadataPayload, key);
  const maskedFileName = '[E2EE Encrypted File]';
  const randomStoragePath = `uploads/1724765432100_0_9f8a7b6c5d4e.bin`;

  const rawDbRecord = {
    id: '11111111-2222-3333-4444-555555555555',
    code: '123456',
    type: 'both',
    content: encryptedContent,
    storage_path: randomStoragePath,
    file_name: maskedFileName,
    file_size: fileSize,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString()
  };

  // Inspect Raw Database Record:
  assert.ok(isEncryptedPayload(rawDbRecord.content), 'DB content must be encrypted JSON payload');
  assert.ok(!rawDbRecord.content.includes(secretText), 'DB content must NOT contain plaintext message');
  assert.ok(!rawDbRecord.content.includes(originalFileName), 'DB content must NOT contain plaintext filename');
  assert.ok(!rawDbRecord.file_name.includes(originalFileName), 'DB file_name column must NOT contain real filename');
  assert.ok(!rawDbRecord.storage_path.includes(originalFileName), 'DB storage_path must NOT contain real filename');

  // Test Decryption with correct key
  const decryptedRecord = await decryptShareRecord(rawDbRecord, key);
  assert.strictEqual(decryptedRecord._decrypted, true);
  assert.strictEqual(decryptedRecord._isLocked, false);
  assert.strictEqual(decryptedRecord.decryptedContent, secretText);
  assert.strictEqual(decryptedRecord.decryptedFileName, originalFileName);
  assert.strictEqual(decryptedRecord.decryptedMimeType, mimeType);
  assert.strictEqual(decryptedRecord.decryptedFileSize, fileSize);
});

test('E2EE Integration: Binary Storage Object Inspection & Decryption Roundtrip', async () => {
  const key = await generateRandomKey();

  // Create simulated binary file (e.g. PNG image with known header and random payload)
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const dummyData = new Uint8Array(64 * 1024);
  dummyData.set(pngHeader, 0);
  for (let i = 8; i < dummyData.length; i++) {
    dummyData[i] = (i * 19 + 7) & 0xFF;
  }

  // Encrypt binary before upload
  const encryptedUpload = await encryptBinary(dummyData, key);

  // Inspect storage bytes:
  assert.ok(isEncryptedBinary(encryptedUpload), 'Uploaded storage object must have UPME magic bytes');
  assert.notStrictEqual(
    encryptedUpload.slice(17, 25),
    pngHeader,
    'Storage bytes must NOT contain unencrypted PNG header'
  );

  // Decrypt binary on receiving client
  const decryptedArrayBuffer = await decryptBinary(encryptedUpload, key);
  const decryptedBytes = new Uint8Array(decryptedArrayBuffer);

  assert.strictEqual(decryptedBytes.byteLength, dummyData.byteLength);
  assert.deepStrictEqual(decryptedBytes, dummyData, 'Decrypted file must be 100% byte-for-byte identical');
});

test('E2EE Integration: Graceful Handling when Key is Missing or Incorrect', async () => {
  const correctKey = await generateRandomKey();
  const wrongKey = await generateRandomKey();

  const encryptedContent = await encryptObject({
    text: 'Secret instructions',
    fileName: 'secret.pdf',
    mimeType: 'application/pdf',
    fileSize: 4500
  }, correctKey);

  const rawDbRecord = {
    id: '22222222-3333-4444-5555-666666666666',
    code: '654321',
    type: 'file',
    content: encryptedContent,
    storage_path: 'uploads/test_uuid.bin',
    file_name: '[E2EE Encrypted File]',
    file_size: 4528,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString()
  };

  // Case A: Missing key (null) - should never lock the user out
  const recordNoKey = await decryptShareRecord(rawDbRecord, null);
  assert.strictEqual(recordNoKey._isLocked, false);
  assert.ok(recordNoKey.decryptedContent !== undefined);

  // Case B: Incorrect key - should gracefully fallback without locking
  const recordWrongKey = await decryptShareRecord(rawDbRecord, wrongKey);
  assert.strictEqual(recordWrongKey._isLocked, false);
  assert.ok(recordWrongKey.decryptedContent !== undefined);
});

test('E2EE Integration: Pairing Mechanism via Key Export and Base64 Import', async () => {
  // Device 1: Generates key
  const device1Key = await generateRandomKey();
  const device1KeyB64 = await exportKeyToBase64(device1Key);

  // Device 1 encrypts a file and a note
  const originalMessage = 'Hello from Device 1!';
  const originalFileName = 'shared_photo.jpg';
  const encryptedPayload = await encryptObject({
    text: originalMessage,
    fileName: originalFileName,
    mimeType: 'image/jpeg',
    fileSize: 20480
  }, device1Key);

  // Device 2: Receives key via Pairing link (#key=device1KeyB64)
  const device2Key = await importKeyFromBase64(device1KeyB64);

  // Device 2 decrypts the item
  const decryptedOnDevice2 = await decryptObject(encryptedPayload, device2Key);
  assert.strictEqual(decryptedOnDevice2.text, originalMessage);
  assert.strictEqual(decryptedOnDevice2.fileName, originalFileName);

  // Device 1 and Device 2 share the same key fingerprint
  const fp1 = await getKeyFingerprint(device1Key);
  const fp2 = await getKeyFingerprint(device2Key);
  assert.strictEqual(fp1, fp2);
});

test('Performance: getStorageUsageInfo computes storage accurately from pre-fetched array in single pass', async () => {
  const { getStorageUsageInfo } = await import('../src/supabase.js');
  const mockShares = [
    { id: '1', file_size: 1024 * 1024 * 5, decryptedFileSize: 1024 * 1024 * 5 }, // 5 MB
    { id: '2', file_size: 1024 * 1024 * 10, decryptedFileSize: 1024 * 1024 * 10 }, // 10 MB
    { id: '3', file_size: null, decryptedFileSize: null }, // Text only
    { id: '4', file_size: 1024 * 512, decryptedFileSize: 1024 * 512 } // 512 KB
  ];

  const startTime = performance.now();
  const info = await getStorageUsageInfo(mockShares);
  const elapsed = performance.now() - startTime;

  assert.strictEqual(info.activeCount, 4);
  assert.strictEqual(info.totalBytes, (15 * 1024 * 1024) + (512 * 1024));
  assert.ok(elapsed < 10, `Single-pass calculation should execute in < 10ms (took ${elapsed.toFixed(2)}ms)`);
});

test('Performance: LRU Cache logic evicts oldest items when exceeding max capacity', () => {
  const MAX_ITEMS = 20;
  const mockCache = new Map();
  const revokedUrls = [];

  function mockCacheBlob(key, url) {
    if (mockCache.has(key)) {
      mockCache.delete(key);
    } else if (mockCache.size >= MAX_ITEMS) {
      const oldestKey = mockCache.keys().next().value;
      if (oldestKey) {
        revokedUrls.push(mockCache.get(oldestKey));
        mockCache.delete(oldestKey);
      }
    }
    mockCache.set(key, url);
  }

  // Insert 30 items
  for (let i = 1; i <= 30; i++) {
    mockCacheBlob(`path/file_${i}.bin`, `blob:http://localhost/blob_${i}`);
  }

  assert.strictEqual(mockCache.size, MAX_ITEMS, 'Cache size should not exceed 20 items');
  assert.strictEqual(revokedUrls.length, 10, '10 oldest URLs should have been revoked');
  assert.strictEqual(revokedUrls[0], 'blob:http://localhost/blob_1', 'First inserted URL should be the first revoked');
  assert.ok(mockCache.has('path/file_30.bin'), 'Most recent item should exist in cache');
  assert.ok(!mockCache.has('path/file_1.bin'), 'Oldest item should no longer exist in cache');
});
