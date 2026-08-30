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
  bytesToBase64,
  base64ToBytes
} from '../src/crypto.js';
import {
  decryptShareRecord,
  getFilePublicUrl
} from '../src/supabase.js';

test('Adversarial: 0-byte empty binary file encryption and decryption roundtrip', async () => {
  const key = await generateRandomKey();
  const emptyBytes = new Uint8Array(0);

  const encrypted = await encryptBinary(emptyBytes, key);
  assert.ok(isEncryptedBinary(encrypted), 'Encrypted 0-byte file should have header');
  assert.strictEqual(encrypted.byteLength, 17 + 16, 'Header(17) + AES-GCM Tag(16) = 33 bytes');

  const decryptedBuffer = await decryptBinary(encrypted, key);
  const decryptedBytes = new Uint8Array(decryptedBuffer);
  assert.strictEqual(decryptedBytes.byteLength, 0, 'Decrypted binary must be 0 bytes');
});

test('Adversarial: 0-byte empty string encryption and decryption roundtrip', async () => {
  const key = await generateRandomKey();
  const emptyStr = '';

  const encrypted = await encryptText(emptyStr, key);
  assert.ok(isEncryptedPayload(encrypted));

  const decrypted = await decryptText(encrypted, key);
  assert.strictEqual(decrypted, emptyStr);
});

test('Adversarial: Direct encryptText string payload in decryptShareRecord should NOT be falsely locked', async () => {
  const key = await generateRandomKey();
  const plainTextMessage = 'Plain text note without JSON structure';

  // Suppose an item was encrypted directly using encryptText
  const encryptedPayload = await encryptText(plainTextMessage, key);

  const rawRecord = {
    id: 'text-item-1',
    code: '123456',
    type: 'text',
    content: encryptedPayload,
    storage_path: null,
    file_name: null,
    file_size: null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString()
  };

  const decryptedRecord = await decryptShareRecord(rawRecord, key);
  assert.strictEqual(decryptedRecord._isLocked, false, 'Record should NOT be locked with correct key');
  assert.strictEqual(decryptedRecord._decrypted, true);
  assert.strictEqual(decryptedRecord.decryptedContent, plainTextMessage);
});

test('Adversarial: URL-safe Base64 and unpadded Base64 keys in importKeyFromBase64', async () => {
  const key = await generateRandomKey();
  const stdB64 = await exportKeyToBase64(key);

  // Convert to URL-safe base64 (replace + with -, / with _, remove =)
  const urlSafeB64 = stdB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const importedKey = await importKeyFromBase64(urlSafeB64);
  assert.ok(importedKey, 'Should successfully import URL-safe Base64 key');

  const fpOrig = await getKeyFingerprint(key);
  const fpImported = await getKeyFingerprint(importedKey);
  assert.strictEqual(fpOrig, fpImported, 'Fingerprints must match for url-safe imported key');

  // Verify encryption/decryption works across standard and url-safe keys
  const testMsg = 'Secret data across url-safe key';
  const enc = await encryptText(testMsg, key);
  const dec = await decryptText(enc, importedKey);
  assert.strictEqual(dec, testMsg);
});

test('Adversarial: Base64 key with spaces from URLSearchParams decode (+ replaced by space)', async () => {
  const key = await generateRandomKey();
  const stdB64 = await exportKeyToBase64(key);

  // If stdB64 has '+', simulate URLSearchParams turning '+' into ' '
  const withSpaces = stdB64.replace(/\+/g, ' ');

  const importedKey = await importKeyFromBase64(withSpaces);
  const fpOrig = await getKeyFingerprint(key);
  const fpImported = await getKeyFingerprint(importedKey);
  assert.strictEqual(fpOrig, fpImported, 'Should handle space-converted Base64 gracefully');
});

test('Adversarial: Tampered Ciphertext detection (AES-GCM Auth Tag Failure)', async () => {
  const key = await generateRandomKey();
  const originalBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const encrypted = await encryptBinary(originalBytes, key);

  // Tamper 1 byte in ciphertext body
  const tampered = new Uint8Array(encrypted);
  tampered[tampered.byteLength - 1] ^= 0xFF; // flip bits in GCM tag

  await assert.rejects(
    async () => {
      await decryptBinary(tampered, key);
    },
    'Tampered binary payload must fail GCM verification and throw'
  );

  // Tamper in JSON payload
  const encryptedJson = await encryptText('Confidential Info', key);
  const parsed = JSON.parse(encryptedJson);
  const dataBytes = base64ToBytes(parsed.data);
  dataBytes[dataBytes.length - 1] ^= 0x01; // flip 1 bit
  parsed.data = bytesToBase64(dataBytes);
  const tamperedJson = JSON.stringify(parsed);

  await assert.rejects(
    async () => {
      await decryptText(tamperedJson, key);
    },
    'Tampered text payload must fail GCM verification and throw'
  );
});

test('Adversarial: Corrupted / Malformed JSON in decryptShareRecord fails safely', async () => {
  const key = await generateRandomKey();

  const malformedRecords = [
    { id: '1', content: '{ "e2ee": true }' }, // missing iv and data
    { id: '2', content: '{ "e2ee": true, "iv": 12345, "data": null }' }, // invalid types
    { id: '3', content: '{ "e2ee": true, "iv": "invalid_base64!!!", "data": "invalid!!!" }' } // corrupt base64
  ];

  for (const raw of malformedRecords) {
    const result = await decryptShareRecord(raw, key);
    assert.ok(result);
    // Either treated as non-encrypted legacy or caught as locked
    assert.ok(result._decrypted === false || result.decryptedContent === raw.content);
  }
});

test('Adversarial: Subarray with non-zero byteOffset', async () => {
  const key = await generateRandomKey();

  // Create a large parent buffer and a subarray slice
  const parent = new Uint8Array(1024);
  for (let i = 0; i < parent.length; i++) parent[i] = i & 0xFF;

  const subarray = parent.subarray(100, 250); // length 150, byteOffset 100
  assert.strictEqual(subarray.byteOffset, 100);
  assert.strictEqual(subarray.byteLength, 150);

  const encrypted = await encryptBinary(subarray, key);
  const decryptedBuffer = await decryptBinary(encrypted, key);
  const decryptedBytes = new Uint8Array(decryptedBuffer);

  assert.strictEqual(decryptedBytes.byteLength, 150);
  assert.deepStrictEqual(decryptedBytes, new Uint8Array(subarray));
});

test('Adversarial: Legacy full-URL storage_path does not get duplicated', () => {
  const fullUrl = 'https://sdsrxmetbtdzhooxqkkh.supabase.co/storage/v1/object/public/user-shares/uploads/legacy.jpg';
  const url = getFilePublicUrl(fullUrl);
  assert.strictEqual(url, fullUrl, 'Should return full URL as-is without nesting');
});

test('Adversarial: Strict boundary validation for isEncryptedBinary and isEncryptedPayload', () => {
  // Binary checks
  assert.strictEqual(isEncryptedBinary(null), false);
  assert.strictEqual(isEncryptedBinary(undefined), false);
  assert.strictEqual(isEncryptedBinary(new Uint8Array(0)), false);
  assert.strictEqual(isEncryptedBinary(new Uint8Array([0x55, 0x50, 0x4D, 0x45, 0x01])), false); // 5 bytes (only magic)
  assert.strictEqual(isEncryptedBinary(new Uint8Array(32)), false); // 32 bytes (less than 33 min)

  // Payload checks
  assert.strictEqual(isEncryptedPayload(null), false);
  assert.strictEqual(isEncryptedPayload(12345), false);
  assert.strictEqual(isEncryptedPayload(''), false);
  assert.strictEqual(isEncryptedPayload('{}'), false);
  assert.strictEqual(isEncryptedPayload('{"e2ee":false}'), false);
  assert.strictEqual(isEncryptedPayload('{"e2ee":true}'), false);
  assert.strictEqual(isEncryptedPayload('{"e2ee":true,"iv":"","data":""}'), false);
  assert.strictEqual(isEncryptedPayload('{"e2ee":true,"iv":"abc"}'), false);
  assert.strictEqual(isEncryptedPayload('{"e2ee":true,"iv":"abc","data":123}'), false);
});

test('Adversarial: High concurrency (50 parallel operations)', async () => {
  const key = await generateRandomKey();
  const operations = [];

  for (let i = 0; i < 50; i++) {
    operations.push((async (idx) => {
      // 1. Text encryption
      const msg = `Concurrent message #${idx} with random nonce ${Math.random()}`;
      const encText = await encryptText(msg, key);
      const decText = await decryptText(encText, key);
      assert.strictEqual(decText, msg);

      // 2. Binary encryption
      const bin = new Uint8Array(idx * 128 + 16);
      for (let b = 0; b < bin.length; b++) bin[b] = (b + idx) & 0xFF;
      const encBin = await encryptBinary(bin, key);
      const decBin = await decryptBinary(encBin, key);
      assert.deepStrictEqual(new Uint8Array(decBin), bin);

      // 3. Metadata record decryption
      const record = {
        id: `rec-${idx}`,
        content: await encryptObject({ text: msg, fileName: `file_${idx}.dat`, fileSize: bin.length }, key),
        file_name: '[E2EE Encrypted File]'
      };
      const decRec = await decryptShareRecord(record, key);
      assert.strictEqual(decRec.decryptedContent, msg);
      assert.strictEqual(decRec.decryptedFileName, `file_${idx}.dat`);
    })(i));
  }

  await Promise.all(operations);
});

test('Adversarial: Deeply nested metadata object encryption and decryption', async () => {
  const key = await generateRandomKey();
  const complexObj = {
    text: 'Note with structured metadata',
    fileName: 'nested.json',
    fileSize: 4096,
    tags: ['secure', 'e2ee', 'vault'],
    author: {
      id: 999,
      device: 'iPad Pro',
      locale: 'th-TH'
    },
    checksums: {
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    }
  };

  const enc = await encryptObject(complexObj, key);
  const dec = await decryptObject(enc, key);
  assert.deepStrictEqual(dec, complexObj);
});

