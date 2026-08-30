import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
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
  setActiveCryptoKey,
  getActiveCryptoKey
} from '../src/crypto.js';
import {
  decryptShareRecord
} from '../src/supabase.js';

test('E2EE Advanced: Multi-language Unicode & Emoji Handling', async () => {
  const key = await generateRandomKey();
  const unicodeText = '🔒 ทดสอบการเข้ารหัสข้อความภาษาไทย 🐰 สวัสดีวันใหม่ 🚀✨ Chinese: 你好 | Arabic: مرحبا | Cyrillic: Привет | Special: <>&"\'/?=\\n\\r';
  const unicodeFileName = 'เอกสารลับ_รายงานประจำปี_๒๕๖๙_🐰.pdf';

  const payload = {
    text: unicodeText,
    fileName: unicodeFileName,
    mimeType: 'application/pdf',
    fileSize: 123456
  };

  const encryptedJson = await encryptObject(payload, key);
  assert.ok(!encryptedJson.includes('ทดสอบ'), 'Ciphertext must not leak Thai text');
  assert.ok(!encryptedJson.includes('เอกสารลับ'), 'Ciphertext must not leak Thai filename');

  const decrypted = await decryptObject(encryptedJson, key);
  assert.strictEqual(decrypted.text, unicodeText);
  assert.strictEqual(decrypted.fileName, unicodeFileName);
});

test('E2EE Advanced: Large 5MB Binary Buffer Encryption & Decryption Roundtrip', async () => {
  const key = await generateRandomKey();
  const size = 5 * 1024 * 1024; // 5 MB
  const largeBuffer = new Uint8Array(size);

  // Fill with deterministic pseudo-random bytes
  for (let i = 0; i < size; i += 4096) {
    largeBuffer[i] = (i ^ 0xAA) & 0xFF;
  }

  const startTime = Date.now();
  const encrypted = await encryptBinary(largeBuffer, key);
  const encryptDuration = Date.now() - startTime;

  assert.ok(isEncryptedBinary(encrypted));
  assert.strictEqual(encrypted.byteLength, 17 + size + 16, 'Size must equal header(17) + data(size) + GCM tag(16)');

  const decryptStartTime = Date.now();
  const decrypted = await decryptBinary(encrypted, key);
  const decryptDuration = Date.now() - decryptStartTime;

  const decryptedBytes = new Uint8Array(decrypted);
  assert.strictEqual(decryptedBytes.byteLength, size);
  assert.deepStrictEqual(decryptedBytes, largeBuffer);

  // Sanity check that 5MB crypto runs quickly (under 2 seconds)
  assert.ok(encryptDuration < 2000, `Encryption took ${encryptDuration}ms`);
  assert.ok(decryptDuration < 2000, `Decryption took ${decryptDuration}ms`);
});

test('E2EE Advanced: JSZip Decrypted Archive Generation', async () => {
  const key = await generateRandomKey();

  // Create 3 encrypted files and 1 encrypted note
  const file1Data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const file2Data = new Uint8Array([10, 20, 30, 40, 50]);
  const file3Data = new Uint8Array([100, 101, 102]);

  const enc1 = await encryptBinary(file1Data, key);
  const enc2 = await encryptBinary(file2Data, key);
  const enc3 = await encryptBinary(file3Data, key);

  const rawShares = [
    {
      id: 'f1',
      type: 'file',
      content: await encryptObject({ text: '', fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 8 }, key),
      storage_path: 'uploads/f1.bin',
      file_name: '[E2EE Encrypted File]',
      file_size: enc1.byteLength
    },
    {
      id: 'f2',
      type: 'file',
      content: await encryptObject({ text: '', fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 5 }, key), // Duplicate filename
      storage_path: 'uploads/f2.bin',
      file_name: '[E2EE Encrypted File]',
      file_size: enc2.byteLength
    },
    {
      id: 't1',
      type: 'text',
      content: await encryptObject({ text: 'Secret meeting notes', fileName: null, mimeType: null, fileSize: null }, key),
      storage_path: null,
      file_name: null,
      file_size: null
    }
  ];

  // Decrypt share records
  const decryptedItems = await Promise.all(rawShares.map(item => decryptShareRecord(item, key)));

  // Build ZIP using decrypted contents
  const zip = new JSZip();
  const mockStorage = {
    'uploads/f1.bin': enc1,
    'uploads/f2.bin': enc2
  };

  const usedNames = new Map();

  for (let i = 0; i < decryptedItems.length; i++) {
    const item = decryptedItems[i];
    if (item.storage_path) {
      const encBytes = mockStorage[item.storage_path];
      const decBuffer = await decryptBinary(encBytes, key);
      let name = item.decryptedFileName;
      if (usedNames.has(name)) {
        const count = usedNames.get(name) + 1;
        usedNames.set(name, count);
        const extDot = name.lastIndexOf('.');
        name = `${name.slice(0, extDot)}_${count}${name.slice(extDot)}`;
      } else {
        usedNames.set(name, 1);
      }
      zip.file(name, decBuffer);
    } else if (item.decryptedContent) {
      zip.file(`note_${i + 1}.txt`, item.decryptedContent);
    }
  }

  const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
  assert.ok(zipBuffer.byteLength > 0, 'ZIP archive generated');

  // Verify contents inside the ZIP
  const unzipped = await JSZip.loadAsync(zipBuffer);
  const unzippedNames = Object.keys(unzipped.files);

  assert.ok(unzippedNames.includes('photo.jpg'));
  assert.ok(unzippedNames.includes('photo_2.jpg'), 'Duplicate filename should be cleanly disambiguated');
  assert.ok(unzippedNames.includes('note_3.txt'));

  const extractedPhoto1 = await unzipped.file('photo.jpg').async('uint8array');
  assert.deepStrictEqual(extractedPhoto1, file1Data);

  const extractedPhoto2 = await unzipped.file('photo_2.jpg').async('uint8array');
  assert.deepStrictEqual(extractedPhoto2, file2Data);

  const extractedNote = await unzipped.file('note_3.txt').async('string');
  assert.strictEqual(extractedNote, 'Secret meeting notes');
});
