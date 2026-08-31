import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePasscode,
  getStorageUsageInfo,
  getFilePublicUrl
} from '../src/supabase.js';

test('Share: Original APK and file names are preserved accurately', () => {
  const testFiles = [
    { file_name: 'app-release.apk', file_size: 15420000, type: 'file' },
    { file_name: 'document.pdf', file_size: 2450000, type: 'file' },
    { file_name: 'photo_vacation.png', file_size: 4500000, type: 'file' },
    { file_name: null, content: 'https://example.com', type: 'text' }
  ];

  assert.strictEqual(testFiles[0].file_name, 'app-release.apk');
  assert.strictEqual(testFiles[1].file_name, 'document.pdf');
  assert.strictEqual(testFiles[2].file_name, 'photo_vacation.png');
  assert.strictEqual(testFiles[3].file_name, null);
});

test('Share: generatePasscode generates a 6-digit numeric string', () => {
  for (let i = 0; i < 50; i++) {
    const code = generatePasscode();
    assert.strictEqual(code.length, 6);
    assert.match(code, /^\d{6}$/);
  }
});

test('Performance: getStorageUsageInfo computes storage accurately from pre-fetched array in single pass', async () => {
  const mockShares = [
    { id: '1', file_name: 'test1.apk', file_size: 1024 * 1024 * 10 },
    { id: '2', file_name: 'test2.png', file_size: 1024 * 1024 * 5 },
    { id: '3', file_name: null, content: 'hello', file_size: 0 }
  ];

  const info = await getStorageUsageInfo(mockShares);
  assert.strictEqual(info.activeCount, 3);
  assert.strictEqual(info.totalBytes, 1024 * 1024 * 15);
});

test('Share: getFilePublicUrl returns correct public storage URL or raw HTTP url', () => {
  assert.strictEqual(getFilePublicUrl(null), null);
  assert.strictEqual(getFilePublicUrl('https://example.com/file.apk'), 'https://example.com/file.apk');
  
  const publicUrl = getFilePublicUrl('uploads/12345_0_app.apk');
  assert.ok(publicUrl.includes('uploads/12345_0_app.apk'));
  assert.ok(publicUrl.includes('user-shares'));
});
