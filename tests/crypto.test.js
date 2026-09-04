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
  isEncryptedBinary
} from '../src/crypto.js';

test('E2EE Crypto: Key Generation and Export/Import', async () => {
  const key1 = await generateRandomKey();
  assert.ok(key1, 'Key should be generated');

  const b64 = await exportKeyToBase64(key1);
  assert.strictEqual(typeof b64, 'string');
  assert.strictEqual(b64.length, 44, '256-bit key in Base64 should be 44 chars (32 bytes + padding)');

  const key1Imported = await importKeyFromBase64(b64);
  assert.ok(key1Imported, 'Imported key should be valid CryptoKey');

  const fp1 = await getKeyFingerprint(key1);
  const fp2 = await getKeyFingerprint(key1Imported);
  assert.strictEqual(fp1, fp2, 'Fingerprints of original and imported key should match');
  assert.match(fp1, /^[0-9A-F]{4}-[0-9A-F]{4}$/, 'Fingerprint should match format XXXX-XXXX');
});

test('E2EE Crypto: Deterministic PBKDF2 Passphrase Derivation', async () => {
  const pass = 'super-secret-master-passphrase-123!';
  const keyA = await deriveKeyFromPassphrase(pass);
  const keyB = await deriveKeyFromPassphrase(pass);

  const b64A = await exportKeyToBase64(keyA);
  const b64B = await exportKeyToBase64(keyB);

  assert.strictEqual(b64A, b64B, 'Deriving key from same passphrase must yield identical key bytes');

  const keyC = await deriveKeyFromPassphrase('different-passphrase');
  const b64C = await exportKeyToBase64(keyC);
  assert.notStrictEqual(b64A, b64C, 'Different passphrases must yield different keys');
});

test('E2EE Crypto: Text Encryption and Decryption Roundtrip', async () => {
  const key = await generateRandomKey();
  const plaintext = 'Hello UpMe E2EE World! 🐰 🔒 แอบส่งข้อความลับ';

  const encryptedJson = await encryptText(plaintext, key);
  assert.ok(isEncryptedPayload(encryptedJson), 'Should be recognized as encrypted payload');
  assert.ok(!encryptedJson.includes(plaintext), 'Encrypted string must not contain plaintext');

  const decrypted = await decryptText(encryptedJson, key);
  assert.strictEqual(decrypted, plaintext, 'Decrypted text must match original plaintext');

  // Verify unique IV per encryption
  const encrypted2 = await encryptText(plaintext, key);
  assert.notStrictEqual(encryptedJson, encrypted2, 'Two encryptions of same plaintext must produce different ciphertexts due to unique IV');
});

test('E2EE Crypto: Metadata Object Encryption and Decryption', async () => {
  const key = await generateRandomKey();
  const metadata = {
    text: 'Note attached to file',
    fileName: 'secret_document_2026.pdf',
    mimeType: 'application/pdf',
    fileSize: 1048576,
    customTag: 'confidential'
  };

  const encryptedPayload = await encryptObject(metadata, key);
  assert.ok(isEncryptedPayload(encryptedPayload));
  assert.ok(!encryptedPayload.includes('secret_document_2026.pdf'), 'Metadata payload must not leak filename');

  const decrypted = await decryptObject(encryptedPayload, key);
  assert.deepStrictEqual(decrypted, metadata, 'Decrypted metadata object must equal original');
});

test('E2EE Crypto: Binary File Encryption & Decryption (100% Byte-for-Byte Accuracy)', async () => {
  const key = await generateRandomKey();

  // Create sample binary data (simulating an image or PDF)
  const originalBytes = new Uint8Array(256 * 1024); // 256 KB
  for (let i = 0; i < originalBytes.length; i++) {
    originalBytes[i] = (i * 37 + 13) & 0xFF;
  }

  const encryptedUint8 = await encryptBinary(originalBytes, key);
  assert.ok(isEncryptedBinary(encryptedUint8), 'Should have UPME magic header');
  assert.ok(encryptedUint8.byteLength > originalBytes.byteLength, 'Encrypted binary includes header + tag');

  // Ensure ciphertext does not match original bytes
  assert.notStrictEqual(encryptedUint8.slice(17, 33), originalBytes.slice(0, 16));

  const decryptedBuffer = await decryptBinary(encryptedUint8, key);
  const decryptedBytes = new Uint8Array(decryptedBuffer);

  assert.strictEqual(decryptedBytes.byteLength, originalBytes.byteLength, 'Decrypted length must match original');
  assert.deepStrictEqual(decryptedBytes, originalBytes, 'Decrypted binary must match original byte-for-byte');
});

test('E2EE Crypto: Decryption Fails Gracefully with Wrong Key', async () => {
  const correctKey = await generateRandomKey();
  const wrongKey = await generateRandomKey();

  const secretText = 'Top Secret UpMe Data';
  const encryptedText = await encryptText(secretText, correctKey);

  await assert.rejects(
    async () => {
      await decryptText(encryptedText, wrongKey);
    },
    'Decrypting with wrong key must reject / throw error'
  );

  const sampleBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const encryptedBinary = await encryptBinary(sampleBytes, correctKey);

  await assert.rejects(
    async () => {
      await decryptBinary(encryptedBinary, wrongKey);
    },
    'Decrypting binary with wrong key must reject / throw error'
  );
});

test('E2EE Crypto: Graceful Handling of Legacy / Unencrypted Data', async () => {
  const key = await generateRandomKey();
  const legacyText = 'This is legacy plaintext message without encryption';

  assert.strictEqual(isEncryptedPayload(legacyText), false);
  const result = await decryptText(legacyText, key);
  assert.strictEqual(result, legacyText, 'Legacy text should be returned as-is without throwing');

  const legacyBinary = new Uint8Array([10, 20, 30, 40]);
  assert.strictEqual(isEncryptedBinary(legacyBinary), false);
  const binResult = await decryptBinary(legacyBinary, key);
  assert.deepStrictEqual(new Uint8Array(binResult), legacyBinary, 'Legacy binary should be returned as-is');
});

test('Device Gatekeeper: Authorization Lifecycle and Token Pairing', async () => {
  const {
    isDeviceAuthorized,
    markDeviceAuthorized,
    revokeDeviceAuthorization,
    unlockWithPassphrase,
    unlockWithPairingToken,
    getPairingUrl,
    getActiveCryptoKey
  } = await import('../src/crypto.js');

  // Test reset
  revokeDeviceAuthorization();
  assert.strictEqual(isDeviceAuthorized(), false, 'Device should not be authorized after revoke');

  // Unlock with Passphrase
  const masterPass = 'MyUltraSecureVaultKey2026!';
  const key = await unlockWithPassphrase(masterPass);
  assert.ok(key, 'Key should be derived from passphrase');
  assert.strictEqual(isDeviceAuthorized(), true, 'Device should be marked authorized');

  // Generate pairing URL
  const pairUrl = await getPairingUrl();
  assert.ok(pairUrl, 'Pairing URL should be generated');
  assert.match(pairUrl, /#key=/, 'Pairing URL should contain #key=');

  // Revoke device
  revokeDeviceAuthorization();
  assert.strictEqual(isDeviceAuthorized(), false);
  assert.strictEqual(getActiveCryptoKey(), null);

  // Pair device via the pairing URL
  const pairedKey = await unlockWithPairingToken(pairUrl);
  assert.ok(pairedKey, 'Should successfully import key from pairing URL');
  assert.strictEqual(isDeviceAuthorized(), true, 'Device should be authorized via paired key');

  // Clean up
  revokeDeviceAuthorization();
});

test('Zero-Knowledge Challenge: Vault Challenge Verification Logic', async () => {
  const {
    deriveKeyFromPassphrase,
    encryptText,
    decryptText
  } = await import('../src/crypto.js');

  const correctPass = 'MasterPassword123!';
  const wrongPass = 'WrongPassword456!';

  const masterKey = await deriveKeyFromPassphrase(correctPass);
  const challengeSecret = 'UPMEE_VAULT_ACTIVE_SECRET';

  // Device A creates encrypted challenge in Supabase
  const encryptedChallenge = await encryptText(challengeSecret, masterKey);

  // Device B attempts to verify with correct password
  const testKeyCorrect = await deriveKeyFromPassphrase(correctPass);
  const decryptedSecret = await decryptText(encryptedChallenge, testKeyCorrect);
  assert.strictEqual(decryptedSecret, challengeSecret, 'Correct password must decrypt challenge secret successfully');

  // Device C attempts to verify with wrong password
  const testKeyWrong = await deriveKeyFromPassphrase(wrongPass);
  await assert.rejects(
    async () => {
      await decryptText(encryptedChallenge, testKeyWrong);
    },
    'Wrong password must fail AES-GCM tag verification and reject'
  );
});

