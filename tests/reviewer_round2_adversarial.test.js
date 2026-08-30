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
  decryptShareRecord,
  fetchAndDecryptFile
} from '../src/supabase.js';

test('Reviewer Round 2: parseKeyOrPassphraseInput handles URLs, hex keys, base64 keys, and passphrases', async () => {
  const sampleB64Key = 'wY8Hx+sVbQ3/kLv12M+Nopqrstuvwxyz1234567890=';

  // Case 1: Full pairing URL with hash #key=...
  const parsedUrlHash = parseKeyOrPassphraseInput(`https://upme.netlify.app/#key=${encodeURIComponent(sampleB64Key)}`);
  assert.strictEqual(parsedUrlHash.type, 'base64_key');
  assert.strictEqual(parsedUrlHash.value, sampleB64Key);

  // Case 2: Full pairing URL with query ?key=...
  const parsedUrlQuery = parseKeyOrPassphraseInput(`https://upme.netlify.app/?key=${encodeURIComponent(sampleB64Key)}`);
  assert.strictEqual(parsedUrlQuery.type, 'base64_key');
  assert.strictEqual(parsedUrlQuery.value, sampleB64Key);

  // Case 3: Full pairing URL with passphrase #passphrase=...
  const parsedPassUrl = parseKeyOrPassphraseInput('https://upme.netlify.app/#passphrase=my-secure-passphrase-2026');
  assert.strictEqual(parsedPassUrl.type, 'passphrase');
  assert.strictEqual(parsedPassUrl.value, 'my-secure-passphrase-2026');

  // Case 4: Raw 64-char Hex key (32 bytes = 256-bit)
  const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const parsedHex = parseKeyOrPassphraseInput(hexKey);
  assert.strictEqual(parsedHex.type, 'hex_key');
  assert.strictEqual(parsedHex.value, hexKey);

  // Case 5: Raw 44-char Base64 Key
  const parsedRawB64 = parseKeyOrPassphraseInput(sampleB64Key);
  assert.strictEqual(parsedRawB64.type, 'base64_key');

  // Case 6: Standard User Passphrase
  const parsedPlainPass = parseKeyOrPassphraseInput('CorrectHorseBatteryStaple!');
  assert.strictEqual(parsedPlainPass.type, 'passphrase');
  assert.strictEqual(parsedPlainPass.value, 'CorrectHorseBatteryStaple!');

  // Case 7: Null or empty
  assert.strictEqual(parseKeyOrPassphraseInput(''), null);
  assert.strictEqual(parseKeyOrPassphraseInput(null), null);
});

test('Reviewer Round 2: applyKeyOrPassphrase end-to-end activation across all input formats', async () => {
  // Test with generated key
  const randomKey = await generateRandomKey();
  const b64 = await exportKeyToBase64(randomKey);

  // 1. Activate via pairing URL
  const res1 = await applyKeyOrPassphrase(`https://upme.netlify.app/#key=${encodeURIComponent(b64)}`);
  assert.strictEqual(res1.type, 'base64_key');
  const fp1 = await getKeyFingerprint(res1.key);
  const fpOrig = await getKeyFingerprint(randomKey);
  assert.strictEqual(fp1, fpOrig);

  // 2. Activate via Master Passphrase
  const res2 = await applyKeyOrPassphrase('my-unique-test-passphrase-999');
  assert.strictEqual(res2.type, 'passphrase');
  const expectedPassKey = await deriveKeyFromPassphrase('my-unique-test-passphrase-999');
  const fp2 = await getKeyFingerprint(res2.key);
  const fpExpected = await getKeyFingerprint(expectedPassKey);
  assert.strictEqual(fp2, fpExpected);

  // 3. Activate via Hex Key
  const hex32Bytes = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const res3 = await applyKeyOrPassphrase(hex32Bytes);
  assert.strictEqual(res3.type, 'hex_key');
  assert.ok(res3.key);

  // Encrypt with res3 key and decrypt
  const encText = await encryptText('Secret message with hex key', res3.key);
  const decText = await decryptText(encText, res3.key);
  assert.strictEqual(decText, 'Secret message with hex key');
});

test('Reviewer Round 2: inferMimeType extension resolution', () => {
  assert.strictEqual(inferMimeType('photo.PNG'), 'image/png');
  assert.strictEqual(inferMimeType('image.jpg'), 'image/jpeg');
  assert.strictEqual(inferMimeType('image.jpeg'), 'image/jpeg');
  assert.strictEqual(inferMimeType('sticker.webp'), 'image/webp');
  assert.strictEqual(inferMimeType('animation.gif'), 'image/gif');
  assert.strictEqual(inferMimeType('vector.svg'), 'image/svg+xml');
  assert.strictEqual(inferMimeType('document.pdf'), 'application/pdf');
  assert.strictEqual(inferMimeType('log.txt'), 'text/plain');
  assert.strictEqual(inferMimeType('data.json'), 'application/json');
  assert.strictEqual(inferMimeType('video.mp4'), 'video/mp4');
  assert.strictEqual(inferMimeType('movie.mov'), 'video/quicktime');
  assert.strictEqual(inferMimeType('sound.mp3'), 'audio/mpeg');
  assert.strictEqual(inferMimeType('audio.wav'), 'audio/wav');
  assert.strictEqual(inferMimeType('archive.zip'), 'application/zip');
  assert.strictEqual(inferMimeType('unknown.xyz'), 'application/octet-stream');
  assert.strictEqual(inferMimeType('image.png?v=123#frag'), 'image/png');
  assert.strictEqual(inferMimeType(null), 'application/octet-stream');
});

test('Reviewer Round 2: Encrypted payload with surrounding whitespace & newlines', async () => {
  const key = await generateRandomKey();
  const rawPayload = await encryptText('Whitespace resilience test', key);

  // Surround with spaces, newlines, and tabs
  const formattedPayload = `\n\n  \t  ${rawPayload}  \r\n  `;

  assert.strictEqual(isEncryptedPayload(formattedPayload), true);

  const decrypted = await decryptText(formattedPayload, key);
  assert.strictEqual(decrypted, 'Whitespace resilience test');

  // Also verify decryptShareRecord handles surrounding whitespace
  const record = {
    id: 'ws-rec',
    content: formattedPayload,
    file_name: null
  };
  const decRecord = await decryptShareRecord(record, key);
  assert.strictEqual(decRecord._isLocked, false);
  assert.strictEqual(decRecord.decryptedContent, 'Whitespace resilience test');
});

test('Reviewer Round 2: 10MB large binary encryption and decryption stress test', async () => {
  const key = await generateRandomKey();
  const size = 10 * 1024 * 1024; // 10 MB
  const buffer = new Uint8Array(size);

  // Fill pseudo-random patterns
  for (let i = 0; i < size; i += 65536) {
    buffer[i] = (i * 31) & 0xFF;
  }

  const startEnc = Date.now();
  const encrypted = await encryptBinary(buffer, key);
  const encTime = Date.now() - startEnc;

  assert.strictEqual(encrypted.byteLength, 17 + size + 16);
  assert.ok(isEncryptedBinary(encrypted));

  const startDec = Date.now();
  const decrypted = await decryptBinary(encrypted, key);
  const decTime = Date.now() - startDec;

  const decBytes = new Uint8Array(decrypted);
  assert.strictEqual(decBytes.byteLength, size);
  assert.deepStrictEqual(decBytes, buffer);

  assert.ok(encTime < 3000, `10MB encryption took ${encTime}ms`);
  assert.ok(decTime < 3000, `10MB decryption took ${decTime}ms`);
});

test('Reviewer Round 2: decryptShareRecord MIME type inference for files with missing metadata', async () => {
  const key = await generateRandomKey();

  // Record with encrypted plaintext string (no JSON metadata) but with an image filename
  const encContent = await encryptText('Note attached', key);
  const record = {
    id: 'rec-mime-test',
    content: encContent,
    file_name: 'vacation_photo.png',
    storage_path: 'uploads/12345_0_random.bin',
    file_size: 54321
  };

  const decrypted = await decryptShareRecord(record, key);
  assert.strictEqual(decrypted._isLocked, false);
  assert.strictEqual(decrypted.decryptedFileName, 'vacation_photo.png');
  assert.strictEqual(decrypted.decryptedMimeType, 'image/png'); // Inferred cleanly from filename!
});
