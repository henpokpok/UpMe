import QRCode from 'qrcode';
import JSZip from 'jszip';
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  createMultipleShareItems,
  getActiveSharesList,
  deleteShareRecordAndStorage,
  batchDeleteShares,
  getStorageUsageInfo,
  subscribeToRealtimeUploads,
  savePushSubscription,
  getFilePublicUrl,
  setupVaultChallenge,
  verifyPassphraseAgainstVault,
  decryptAndFetchFileBlob
} from './supabase.js';
import {
  initializeEncryptionKey,
  isDeviceAuthorized,
  unlockWithPassphrase,
  unlockWithPairingToken,
  revokeDeviceAuthorization,
  getKeyFingerprint,
  getActiveCryptoKey,
  getPairingUrl
} from './crypto.js';

// Local Storage Key for Accessed Items
const ACCESSED_ITEMS_KEY = 'upme_accessed_ids';

function getAccessedIds() {
  try {
    return JSON.parse(localStorage.getItem(ACCESSED_ITEMS_KEY) || '[]');
  } catch {
    return [];
  }
}

function markItemAsAccessed(id) {
  const list = getAccessedIds();
  if (!list.includes(id)) {
    list.push(id);
    localStorage.setItem(ACCESSED_ITEMS_KEY, JSON.stringify(list));
  }
}

// Robust Clipboard Copy Helper with ExecCommand Fallback
async function copyToClipboard(text, successToastMsg = '📋 Copied!') {
  if (!text) return false;
  let copied = false;

  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (err) {
      console.warn('navigator.clipboard.writeText rejected:', err);
    }
  }

  if (!copied && typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      copied = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (fallbackErr) {
      console.warn('execCommand fallback failed:', fallbackErr);
    }
  }

  if (copied) {
    if (successToastMsg) showToast(successToastMsg);
    return true;
  } else {
    showToast('⚠️ Could not copy to clipboard automatically.');
    return false;
  }
}

// Application State
let selectedFiles = []; // Array of File objects
let selectedDurationKey = '24h'; // Default '24h'
let deferredPwaPrompt = null;
let currentActiveItem = null;
let isSelectMode = false;
let selectedShareIds = new Set();
let currentSharesList = [];

// DOM Elements
const headerE2eeBadge = document.getElementById('header-e2ee-badge');
const historyBtn = document.getElementById('history-btn');
const historyPopover = document.getElementById('history-popover');
const popoverNotifyToggle = document.getElementById('popover-notify-toggle');
const forceRegisterPushBtn = document.getElementById('force-register-push-btn');
const historyListContainer = document.getElementById('history-list-container');

const pillBtns = document.querySelectorAll('.pill-btn');
const textContent = document.getElementById('text-content');
const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');
const dropzoneEmptyContent = document.getElementById('dropzone-empty-content');
const filePreview = document.getElementById('file-preview');
const selectedFilesList = document.getElementById('selected-files-list');
const addMoreFilesBtn = document.getElementById('add-more-files-btn');
const clearAllFilesBtn = document.getElementById('clear-all-files-btn');
const queueTotalSize = document.getElementById('queue-total-size');
const queueFileCountBadge = document.getElementById('queue-file-count-badge');

const shareForm = document.getElementById('share-form');
const submitShareBtn = document.getElementById('submit-share-btn');

const storageUsageText = document.getElementById('storage-usage-text');
const storageProgressFill = document.getElementById('storage-progress-fill');

const liveFeedContainer = document.getElementById('live-feed-container');
const refreshFeedBtn = document.getElementById('refresh-feed-btn');
const toggleSelectModeBtn = document.getElementById('toggle-select-mode-btn');
const downloadAllBtn = document.getElementById('download-all-btn');

const batchActionsBar = document.getElementById('batch-actions-bar');
const batchSelectAllCb = document.getElementById('batch-select-all-cb');
const batchSelectedCount = document.getElementById('batch-selected-count');
const batchDownloadZipBtn = document.getElementById('batch-download-zip-btn');
const batchDownloadSeparateBtn = document.getElementById('batch-download-separate-btn');
const batchDeleteBtn = document.getElementById('batch-delete-btn');
const batchCancelBtn = document.getElementById('batch-cancel-btn');

const settingsBtn = document.getElementById('settings-btn');
const configModal = document.getElementById('config-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const cfgUrl = document.getElementById('cfg-url');
const cfgKey = document.getElementById('cfg-key');

const itemModal = document.getElementById('item-modal');
const closeItemModalBtn = document.getElementById('close-item-modal-btn');
const modalItemBadge = document.getElementById('modal-item-badge');
const modalFileName = document.getElementById('modal-file-name');
const modalPreviewArea = document.getElementById('modal-preview-area');
const modalTextContent = document.getElementById('modal-text-content');
const modalCopyBtn = document.getElementById('modal-copy-btn');
const modalOpenLinkBtn = document.getElementById('modal-open-link-btn');
const modalDownloadBtn = document.getElementById('modal-download-btn');
const modalShareBtn = document.getElementById('modal-share-btn');
const modalDeleteBtn = document.getElementById('modal-delete-btn');

const qrModal = document.getElementById('qr-modal');
const closeQrModalBtn = document.getElementById('close-qr-modal-btn');
const qrModalCanvas = document.getElementById('qr-modal-canvas');
const qrNativeShareBtn = document.getElementById('qr-native-share-btn');

const pwaInstallBtn = document.getElementById('pwa-install-btn');
const toast = document.getElementById('toast');

// Gatekeeper & Device Authorization Elements
const vaultGatekeeper = document.getElementById('vault-gatekeeper');
const appMainContent = document.getElementById('app-main-content');
const headerVaultBadge = document.getElementById('header-vault-badge');
const vaultBadgeText = document.getElementById('vault-badge-text');

const gatekeeperUnlockForm = document.getElementById('gatekeeper-unlock-form');
const gatekeeperPassInput = document.getElementById('gatekeeper-passphrase-input');
const gatekeeperTogglePwdBtn = document.getElementById('gatekeeper-toggle-pwd-btn');
const gatekeeperSubmitBtn = document.getElementById('gatekeeper-submit-btn');
const gatekeeperErrorMsg = document.getElementById('gatekeeper-error-msg');
const gatekeeperOpenPairBtn = document.getElementById('gatekeeper-open-pair-input-btn');
const gatekeeperPairBox = document.getElementById('gatekeeper-pair-input-box');
const gatekeeperPairInput = document.getElementById('gatekeeper-pair-token-input');
const gatekeeperApplyTokenBtn = document.getElementById('gatekeeper-apply-token-btn');

// Settings Device Pairing Elements
const settingsPairDeviceBtn = document.getElementById('settings-pair-device-btn');
const settingsRevokeDeviceBtn = document.getElementById('settings-revoke-device-btn');
const settingsKeyFingerprint = document.getElementById('settings-key-fingerprint');
const settingsDeviceStatusPill = document.getElementById('settings-device-status-pill');

// Pairing Modal Elements
const pairDeviceModal = document.getElementById('pair-device-modal');
const closePairModalBtn = document.getElementById('close-pair-modal-btn');
const pairModalCanvas = document.getElementById('pair-modal-canvas');
const copyPairLinkBtn = document.getElementById('copy-pair-link-btn');

// In-Memory Decrypted Image Blob Cache
const imageBlobUrlCache = new Map();
async function getImageBlobUrl(storagePath) {
  if (!storagePath) return null;
  if (imageBlobUrlCache.has(storagePath)) return imageBlobUrlCache.get(storagePath);
  try {
    const blob = await decryptAndFetchFileBlob(storagePath);
    const blobUrl = URL.createObjectURL(blob);
    imageBlobUrlCache.set(storagePath, blobUrl);
    return blobUrl;
  } catch (err) {
    console.warn('Could not decrypt image preview:', err);
    return null;
  }
}

function revokeBlobUrlForPath(storagePath) {
  if (!storagePath) return;
  if (imageBlobUrlCache.has(storagePath)) {
    const url = imageBlobUrlCache.get(storagePath);
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
    imageBlobUrlCache.delete(storagePath);
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  initHistoryPopover();
  initPills();
  initDropzone();
  initForms();
  initBatchActions();
  initSettingsModal();
  initDevicePairingSettings();
  initItemModal();
  initQrModal();
  initPWA();
  
  await initDeviceGatekeeper();
  initRealtimeSubscription();
  checkSharedDataFromGallery();

  // Auto-refresh feed when tab becomes active & pause CSS animations when hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.add('tab-hidden');
      }
    } else {
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('tab-hidden');
      }
      if (isDeviceAuthorized()) {
        debouncedRefreshAppFeed(200);
      }
    }
  });
});

let feedDebounceTimer = null;
function debouncedRefreshAppFeed(delay = 300) {
  if (feedDebounceTimer) clearTimeout(feedDebounceTimer);
  feedDebounceTimer = setTimeout(() => {
    refreshAppFeed();
  }, delay);
}

// Helper to load shared images/files sent directly from phone's Gallery Share Menu
async function checkSharedDataFromGallery() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('upmee-shared-data');

    // Check shared text
    const textRes = await cache.match('/shared-text');
    if (textRes) {
      const sharedText = await textRes.text();
      if (sharedText && textContent) {
        textContent.value = sharedText;
      }
      await cache.delete('/shared-text');
    }

    // Check shared files from gallery app
    const countRes = await cache.match('/shared-files-count');
    if (countRes) {
      const count = parseInt(await countRes.text(), 10) || 0;
      const loadedFiles = [];
      for (let i = 0; i < count; i++) {
        const fileRes = await cache.match(`/shared-file-${i}`);
        if (fileRes) {
          const blob = await fileRes.blob();
          const rawFileName = fileRes.headers.get('x-file-name') ? decodeURIComponent(fileRes.headers.get('x-file-name')) : `shared_image_${i + 1}.jpg`;
          const sharedFile = new File([blob], rawFileName, { type: blob.type || 'image/jpeg' });
          loadedFiles.push(sharedFile);
          await cache.delete(`/shared-file-${i}`);
        }
      }
      await cache.delete('/shared-files-count');
      if (loadedFiles.length > 0) {
        handleFilesSelection(loadedFiles);
        showToast(`📷 ${loadedFiles.length} file(s) loaded from Gallery share!`);
      }
    } else {
      // Legacy single shared file fallback
      const fileRes = await cache.match('/shared-file');
      if (fileRes) {
        const blob = await fileRes.blob();
        const rawFileName = fileRes.headers.get('x-file-name') ? decodeURIComponent(fileRes.headers.get('x-file-name')) : 'shared_image.jpg';
        const sharedFile = new File([blob], rawFileName, { type: blob.type || 'image/jpeg' });
        
        handleFilesSelection([sharedFile]);
        await cache.delete('/shared-file');
        showToast('📷 Image loaded from Gallery share!');
      }
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('shared') === 'true') {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch (err) {
    console.warn('Error reading shared data from gallery:', err);
  }
}

// --- Toast Helper ---
function showToast(msg, duration = 4000) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

// --- Format Helpers ---
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatRemainingTimeClean(expiresAtISO) {
  const diffMs = new Date(expiresAtISO) - new Date();
  if (diffMs <= 0) return 'Expired';
  const totalMins = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} วัน`;
  }
  if (hours > 0) {
    return `${hours} ชม. ${mins} นาที`;
  }
  return `${mins} นาที`;
}

function formatShortTime(createdAtISO) {
  return new Date(createdAtISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function calculateConfiguredHoursText(createdAtISO, expiresAtISO) {
  const diffHours = Math.round((new Date(expiresAtISO) - new Date(createdAtISO)) / (1000 * 60 * 60));
  if (diffHours >= 168) return '7d';
  return `${diffHours}h`;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerWebPushSubscription(silent = false) {
  if (!('serviceWorker' in navigator)) {
    if (!silent) showToast('⚠️ เบราว์เซอร์นี้ยังไม่รองรับ ServiceWorker');
    return;
  }

  if (!('PushManager' in window)) {
    if (!silent) showToast('⚠️ บน iPad/iPhone ต้องแตะ "เพิ่มไปยังหน้าจอโฮม" และเปิดจากไอคอนโฮมสกรีนเท่านั้นนะจ๊ะ');
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    let sub = await reg.pushManager.getSubscription();

    if (sub) {
      try {
        await sub.unsubscribe();
      } catch (unsubErr) {
        console.warn('Unsubscribe note:', unsubErr);
      }
    }

    const publicVapidKey = 'BCKyt1Zaqd4A2WUFCxedHrZCQXSTlOP2EJo9dYTuaOzzJ0suZmAPZkCLEUkggxsQXuDShNwxo2SQzuHQMyfBTjs';
    const convertedKey = urlBase64ToUint8Array(publicVapidKey);

    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedKey
    });

    if (sub) {
      const res = await savePushSubscription(sub.toJSON());
      if (res && res.success) {
        if (!silent) showToast('🔔 บันทึก Push Token เข้าฐานข้อมูลสำเร็จ!');
      } else {
        if (!silent) showToast(`❌ บันทึก Token ไม่สำเร็จ: ${res?.error || 'RLS Policy'}`);
      }
    }
  } catch (err) {
    console.warn('Web Push Manager note:', err);
    if (!silent) showToast(`❌ Push Error: ${err.message}`);
  }
}

// --- Chat Bubble Popover (History + Notifications Toggle) ---
function initHistoryPopover() {
  if ('Notification' in window && Notification.permission === 'granted') {
    if (popoverNotifyToggle) popoverNotifyToggle.checked = true;
    registerWebPushSubscription(true);
  }

  if (forceRegisterPushBtn) {
    forceRegisterPushBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      registerWebPushSubscription(false);
    });
  }

  if (popoverNotifyToggle) {
    popoverNotifyToggle.addEventListener('change', async () => {
      if (!('Notification' in window)) {
        showToast('❌ เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือนนะจ๊ะ');
        popoverNotifyToggle.checked = false;
        return;
      }

      if (popoverNotifyToggle.checked) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          showToast('🔔 เปิดใช้งานการแจ้งเตือนเรียบร้อยแล้ว!');
          registerWebPushSubscription(false);
        } else {
          popoverNotifyToggle.checked = false;
          showToast('⚠️ ไม่อนุญาตให้เปิดการแจ้งเตือน');
        }
      } else {
        showToast('🔕 ปิดการแจ้งเตือนเรียบร้อยแล้ว');
      }
    });
  }

  if (historyBtn) {
    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = historyPopover.classList.contains('hidden');
      if (isHidden) {
        openHistoryPopover();
      } else {
        closeHistoryPopover();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (historyPopover && !historyPopover.contains(e.target) && historyBtn && !historyBtn.contains(e.target)) {
      closeHistoryPopover();
    }
  });
}

async function openHistoryPopover() {
  if (!historyPopover) return;
  historyPopover.classList.remove('hidden');

  if (!isDeviceAuthorized()) {
    historyListContainer.innerHTML = `
      <div class="empty-feed-box"><p>🔒 อุปกรณ์นี้ยังไม่ได้รับการปลดล็อคห้องนิรภัย</p></div>
    `;
    return;
  }

  historyListContainer.innerHTML = `
    <div class="loading-spinner-box"><p>Loading history...</p></div>
  `;

  const shares = await getActiveSharesList();
  const accessedList = getAccessedIds();

  if (!shares || shares.length === 0) {
    historyListContainer.innerHTML = `
      <div class="empty-feed-box"><p>ไม่มีประวัติขณะนี้ 🌸</p></div>
    `;
    return;
  }

  historyListContainer.innerHTML = '';

  shares.forEach(item => {
    const rowEl = document.createElement('div');
    rowEl.className = 'history-item-row';

    const uploadTimeStr = formatShortTime(item.created_at);
    const isAccessed = accessedList.includes(item.id);
    const titleStr = item.file_name || item.content || 'Item';

    rowEl.innerHTML = `
      <div class="history-item-info">
        <span class="history-item-title">${escapeHtml(titleStr)}</span>
        <span class="history-item-meta">${uploadTimeStr}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="history-status-badge ${isAccessed ? 'badge-accessed' : 'badge-active'}">
          ${isAccessed ? '🟢 โหลดแล้ว' : '⚪ รอการโหลด'}
        </span>
        <button type="button" class="icon-btn-danger-outline delete-history-btn" style="padding: 2px 6px; font-size: 0.7rem;">
          🗑️
        </button>
      </div>
    `;

    const deleteBtn = rowEl.querySelector('.delete-history-btn');
    deleteBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (confirm('คุณต้องการลบรายการนี้ใช่หรือไม่?')) {
        const res = await deleteShareRecordAndStorage(item.id, item.storage_path);
        if (res.success) {
          showToast('🗑️ ลบรายการเรียบร้อยแล้ว');
        } else {
          showToast(`❌ ลบไม่สำเร็จ: ${res.error || 'RLS Permission'}`);
        }
        await refreshAppFeed();
        if (!historyPopover.classList.contains('hidden')) {
          await openHistoryPopover();
        }
      }
    });

    historyListContainer.appendChild(rowEl);
  });
}

function closeHistoryPopover() {
  if (historyPopover) historyPopover.classList.add('hidden');
}

// --- Trigger Cross-Platform System Notification ---
function triggerSystemNotification(newRecord) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const isFile = newRecord.type === 'file' || newRecord.type === 'both' || Boolean(newRecord.storage_path);
  const title = 'UpMee 🐰';
  let bodyText = '';

  if (isFile) {
    bodyText = `ไฟล์ใหม่: ${newRecord.file_name || 'ไฟล์แนบ'}`;
  } else {
    bodyText = newRecord.content ? newRecord.content.substring(0, 40) : 'ข้อความใหม่';
  }

  const itemTag = 'upmee-share-' + (newRecord.id || newRecord.created_at || 'item');

  const options = {
    body: bodyText,
    icon: '/bunny_mascot.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    tag: itemTag,
    renotify: false,
    data: newRecord
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, options);
    }).catch(() => {
      new Notification(title, options);
    });
  } else {
    new Notification(title, options);
  }
}

// --- Realtime WebSocket Listener ---
function initRealtimeSubscription() {
  subscribeToRealtimeUploads((newRecord) => {
    debouncedRefreshAppFeed(250);
    triggerSystemNotification(newRecord);
  });
}

// --- Expiration Pill Selector ---
function initPills() {
  pillBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pillBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDurationKey = btn.getAttribute('data-value');
    });
  });
}

// --- Multi-File Selection & Dropzone Handlers ---
function initDropzone() {
  if (!dropzone) return;

  dropzone.addEventListener('click', (e) => {
    if (
      e.target.closest('#add-more-files-btn') ||
      e.target.closest('#clear-all-files-btn') ||
      e.target.closest('.selected-file-remove-btn')
    ) {
      return;
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesSelection(Array.from(e.target.files));
      fileInput.value = '';
    }
  });

  if (addMoreFilesBtn) {
    addMoreFilesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (clearAllFilesBtn) {
    clearAllFilesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAllQueuedFiles();
    });
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      handleFilesSelection(Array.from(files));
    }
  });
}

function handleFilesSelection(newFiles) {
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  let oversizedCount = 0;

  newFiles.forEach(file => {
    if (file.size > MAX_SIZE) {
      oversizedCount++;
      return;
    }

    const isDuplicate = selectedFiles.some(
      existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified
    );

    if (!isDuplicate) {
      selectedFiles.push(file);
    }
  });

  if (oversizedCount > 0) {
    showToast(`⚠️ ข้าม ${oversizedCount} ไฟล์ที่มีขนาดเกิน 50MB`);
  }

  renderSelectedFilesQueue();
}

function removeFileFromQueue(index) {
  if (index >= 0 && index < selectedFiles.length) {
    selectedFiles.splice(index, 1);
    renderSelectedFilesQueue();
  }
}

function clearAllQueuedFiles() {
  selectedFiles = [];
  renderSelectedFilesQueue();
}

function renderSelectedFilesQueue() {
  if (!filePreview || !dropzoneEmptyContent || !selectedFilesList) return;

  if (selectedFiles.length === 0) {
    filePreview.classList.add('hidden');
    dropzoneEmptyContent.classList.remove('hidden');
    if (queueFileCountBadge) queueFileCountBadge.classList.add('hidden');
    return;
  }

  dropzoneEmptyContent.classList.add('hidden');
  filePreview.classList.remove('hidden');

  if (queueFileCountBadge) {
    queueFileCountBadge.textContent = `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`;
    queueFileCountBadge.classList.remove('hidden');
  }

  const totalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
  if (queueTotalSize) {
    queueTotalSize.textContent = `(${formatBytes(totalBytes)})`;
  }

  selectedFilesList.innerHTML = '';

  selectedFiles.forEach((file, index) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'selected-file-row';

    const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);
    let thumbHtml = '';

    if (isImage) {
      const blobUrl = URL.createObjectURL(file);
      thumbHtml = `<img src="${blobUrl}" alt="thumb" class="selected-file-thumb" />`;
    } else {
      let icon = '📄';
      if (/\.(pdf)$/i.test(file.name)) icon = '📕';
      else if (/\.(zip|rar|7z|tar|gz)$/i.test(file.name)) icon = '📦';
      else if (/\.(mp4|mov|avi|mkv)$/i.test(file.name)) icon = '🎬';
      else if (/\.(mp3|wav|ogg|m4a)$/i.test(file.name)) icon = '🎵';
      else if (/\.(docx?|xlsx?|pptx?)$/i.test(file.name)) icon = '📊';
      thumbHtml = `<span class="selected-file-icon">${icon}</span>`;
    }

    rowEl.innerHTML = `
      <div class="selected-file-left">
        ${thumbHtml}
        <div class="selected-file-meta">
          <span class="selected-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <span class="selected-file-size">${formatBytes(file.size)}</span>
        </div>
      </div>
      <button type="button" class="selected-file-remove-btn" data-index="${index}" title="Remove file">&times;</button>
    `;

    const removeBtn = rowEl.querySelector('.selected-file-remove-btn');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFileFromQueue(index);
    });

    selectedFilesList.appendChild(rowEl);
  });
}

// --- Upload Submissions ---
function initForms() {
  if (!shareForm) return;

  shareForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      openSettingsModal();
      showToast('⚠️ กรุณาตั้งค่า Supabase URL และ Anon Key ก่อนนะจ๊ะ');
      return;
    }

    if (!isDeviceAuthorized()) {
      showToast('🔒 อุปกรณ์นี้ยังไม่ได้รับการปลดล็อคห้องนิรภัย');
      return;
    }

    const textVal = textContent.value.trim();
    if (!textVal && selectedFiles.length === 0) {
      showToast('⚠️ กรุณาพิมพ์ข้อความ/ลิงก์ หรือแนบไฟล์อย่างน้อย 1 อย่างนะจ๊ะ');
      return;
    }

    const totalToUpload = selectedFiles.length;

    try {
      submitShareBtn.disabled = true;
      submitShareBtn.innerHTML = `<span>⏳ Encrypting & Uploading...</span>`;

      await createMultipleShareItems({
        textContent: textVal,
        files: selectedFiles,
        durationKey: selectedDurationKey,
        onProgress: ({ completed, total }) => {
          if (submitShareBtn) {
            submitShareBtn.innerHTML = `<span>⏳ Uploading (${completed}/${total})...</span>`;
          }
        }
      });

      if (totalToUpload > 1) {
        showToast(`🎉 Encrypted & uploaded ${totalToUpload} files successfully! 🛡️`);
      } else {
        showToast('🎉 Upload Complete (E2EE Protected 🛡️)!');
      }

      // Clear form & queue
      textContent.value = '';
      clearAllQueuedFiles();

      await refreshAppFeed();
    } catch (err) {
      showToast(`❌ ${err.message}`);
    } finally {
      submitShareBtn.disabled = false;
      submitShareBtn.innerHTML = `<span>Upload 🐰</span>`;
    }
  });

  if (refreshFeedBtn) {
    refreshFeedBtn.addEventListener('click', () => {
      refreshAppFeed();
      showToast('🔄 Refreshed');
    });
  }
}

// --- Multi-Download & Batch Actions ---
function initBatchActions() {
  if (toggleSelectModeBtn) {
    toggleSelectModeBtn.addEventListener('click', () => {
      setSelectMode(!isSelectMode);
    });
  }

  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', () => {
      downloadAllAsZip();
    });
  }

  if (batchSelectAllCb) {
    batchSelectAllCb.addEventListener('change', () => {
      if (batchSelectAllCb.checked) {
        currentSharesList.forEach(item => selectedShareIds.add(item.id));
      } else {
        selectedShareIds.clear();
      }
      updateBatchUI();
    });
  }

  if (batchCancelBtn) {
    batchCancelBtn.addEventListener('click', () => {
      setSelectMode(false);
    });
  }

  if (batchDownloadZipBtn) {
    batchDownloadZipBtn.addEventListener('click', () => {
      downloadSelectedAsZip();
    });
  }

  if (batchDownloadSeparateBtn) {
    batchDownloadSeparateBtn.addEventListener('click', () => {
      downloadSelectedConcurrently();
    });
  }

  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', async () => {
      await batchDeleteSelected();
    });
  }
}

function setSelectMode(enable) {
  isSelectMode = enable;
  if (toggleSelectModeBtn) {
    toggleSelectModeBtn.classList.toggle('active', isSelectMode);
  }

  if (!isSelectMode) {
    selectedShareIds.clear();
    if (batchActionsBar) batchActionsBar.classList.add('hidden');
  } else {
    if (batchActionsBar) batchActionsBar.classList.remove('hidden');
  }

  updateBatchUI();
  renderCloudItemBubbles(currentSharesList);
}

function updateBatchUI() {
  const selectedCount = selectedShareIds.size;
  if (batchSelectedCount) {
    batchSelectedCount.textContent = `${selectedCount} selected`;
  }

  if (batchSelectAllCb) {
    batchSelectAllCb.checked = currentSharesList.length > 0 && selectedCount === currentSharesList.length;
    batchSelectAllCb.indeterminate = selectedCount > 0 && selectedCount < currentSharesList.length;
  }

  const cards = document.querySelectorAll('.cloud-item-row-card');
  cards.forEach(card => {
    const id = card.getAttribute('data-id');
    const isSelected = selectedShareIds.has(id);
    card.classList.toggle('selected', isSelected);
    const cb = card.querySelector('.cloud-item-select-checkbox');
    if (cb) cb.checked = isSelected;
  });
}

// Download All active files as single ZIP
async function downloadAllAsZip() {
  const fileItems = currentSharesList.filter(item => item.storage_path || item.content);
  if (!fileItems || fileItems.length === 0) {
    showToast('⚠️ ไม่มีไฟล์สำหรับดาวน์โหลด');
    return;
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  await downloadFilesAsZip(fileItems, `UpMee_All_Files_${dateStr}.zip`);
}

// Download Selected items as ZIP
async function downloadSelectedAsZip() {
  const selectedItems = currentSharesList.filter(item => selectedShareIds.has(item.id));
  if (selectedItems.length === 0) {
    showToast('⚠️ กรุณาเลือกรายการที่ต้องการดาวน์โหลดก่อน');
    return;
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  await downloadFilesAsZip(selectedItems, `UpMee_Selected_${dateStr}.zip`);
}

// Download Selected items concurrently
async function downloadSelectedConcurrently() {
  const selectedItems = currentSharesList.filter(item => selectedShareIds.has(item.id));
  if (selectedItems.length === 0) {
    showToast('⚠️ กรุณาเลือกรายการที่ต้องการดาวน์โหลดก่อน');
    return;
  }
  await downloadFilesConcurrently(selectedItems);
}

// Batch Delete Selected items
async function batchDeleteSelected() {
  const selectedItems = currentSharesList.filter(item => selectedShareIds.has(item.id));
  if (selectedItems.length === 0) {
    showToast('⚠️ กรุณาเลือกรายการที่ต้องการลบก่อน');
    return;
  }

  if (confirm(`คุณต้องการลบ ${selectedItems.length} รายการที่เลือกใช่หรือไม่?`)) {
    showToast('⏳ กำลังลบรายการ...');
    selectedItems.forEach(i => revokeBlobUrlForPath(i.storage_path));
    const res = await batchDeleteShares(selectedItems);
    if (res.success) {
      showToast(`🗑️ ลบ ${selectedItems.length} รายการเรียบร้อยแล้ว!`);
      selectedShareIds.clear();
      setSelectMode(false);
      await refreshAppFeed();
    } else {
      showToast(`❌ ลบไม่สำเร็จ: ${res.error || 'Permission error'}`);
    }
  }
}

// Robust JSZip file archiver with direct fetch, client-side decryption, and original file names
async function downloadFilesAsZip(itemsToDownload, zipFileName = 'UpMee_Archive.zip') {
  try {
    showToast(`⏳ กำลังบีบอัด ${itemsToDownload.length} รายการเป็นไฟล์ ZIP...`);
    const zip = new JSZip();
    const usedNames = new Map();

    const BATCH_SIZE = 5;
    for (let i = 0; i < itemsToDownload.length; i += BATCH_SIZE) {
      const chunk = itemsToDownload.slice(i, i + BATCH_SIZE);
      await Promise.all(chunk.map(async (item, chunkIdx) => {
        const index = i + chunkIdx;
        const fileUrl = getFilePublicUrl(item.storage_path) || item.content;
        const isFile = item.type === 'file' || item.type === 'both' || Boolean(item.storage_path);

        if (isFile) {
          try {
            let blob = null;
            if (item.storage_path) {
              blob = await decryptAndFetchFileBlob(item.storage_path);
            } else if (fileUrl) {
              const res = await fetch(fileUrl);
              blob = await res.blob();
            }

            if (!blob) return;

            let fileNameStr = item.file_name || `file_${index + 1}`;

            if (usedNames.has(fileNameStr)) {
              const count = usedNames.get(fileNameStr) + 1;
              usedNames.set(fileNameStr, count);
              const extDot = fileNameStr.lastIndexOf('.');
              if (extDot > 0) {
                fileNameStr = `${fileNameStr.slice(0, extDot)}_${count}${fileNameStr.slice(extDot)}`;
              } else {
                fileNameStr = `${fileNameStr}_${count}`;
              }
            } else {
              usedNames.set(fileNameStr, 1);
            }

            zip.file(fileNameStr, blob);
            markItemAsAccessed(item.id);
          } catch (fetchErr) {
            console.warn(`Failed to fetch file for ZIP (${item.file_name}):`, fetchErr);
          }
        } else if (item.content) {
          let textName = `note_${index + 1}.txt`;
          zip.file(textName, item.content);
          markItemAsAccessed(item.id);
        }
      }));
    }

    showToast('📦 กำลังสร้างไฟล์ ZIP...');
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const blobUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = zipFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    showToast('💾 ดาวน์โหลด ZIP สำเร็จเรียบร้อย!');
  } catch (err) {
    console.error('ZIP generation error:', err);
    showToast(`❌ สร้างไฟล์ ZIP ไม่สำเร็จ: ${err.message}`);
  }
}

// Download multiple files concurrently
async function downloadFilesConcurrently(itemsToDownload) {
  showToast(`⚡ กำลังดาวน์โหลด ${itemsToDownload.length} ไฟล์พร้อมกัน...`);

  for (let i = 0; i < itemsToDownload.length; i++) {
    const item = itemsToDownload[i];
    const fileUrl = getFilePublicUrl(item.storage_path) || item.content;
    if (fileUrl || item.storage_path) {
      markItemAsAccessed(item.id);
      await downloadFileDirectly(fileUrl, item.file_name || 'download', item.storage_path);
      if (i < itemsToDownload.length - 1) {
        await new Promise(r => setTimeout(r, 150));
      }
    }
  }
}

// Direct file download preserving original file names with client-side decryption
async function downloadFileDirectly(url, fileName, storagePath = null) {
  try {
    let blob = null;
    if (storagePath) {
      blob = await decryptAndFetchFileBlob(storagePath);
    } else if (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    }
    if (!blob) throw new Error('No file data available');
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    showToast('💾 ดาวน์โหลดไฟล์สำเร็จ!');
  } catch (err) {
    console.error('Direct download fallback:', err);
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.target = '_blank';
      a.click();
    } else {
      showToast('❌ ดาวน์โหลดไฟล์ไม่สำเร็จ');
    }
  }
}

// --- Refresh Cloud Feed & Storage % Bar (Single-Pass & Debounced) ---
let isRefreshingFeed = false;
let pendingRefreshRequest = false;

async function refreshAppFeed() {
  if (!isDeviceAuthorized()) {
    updateVaultUIState(false);
    return;
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    if (liveFeedContainer) {
      liveFeedContainer.innerHTML = `
        <div class="empty-feed-box">
          <p>Please configure Supabase credentials in settings ⚙️</p>
        </div>
      `;
    }
    return;
  }

  if (isRefreshingFeed) {
    pendingRefreshRequest = true;
    return;
  }

  isRefreshingFeed = true;

  try {
    // 1. Fetch active shares list once
    const sharesList = await getActiveSharesList();
    currentSharesList = sharesList || [];

    // 2. Storage Bar % Calculation directly from pre-fetched list
    const { totalBytes } = await getStorageUsageInfo(currentSharesList);
    const TOTAL_CAPACITY = 1000 * 1024 * 1024; // 1,000 MB (1 GB)
    const percentageNum = (totalBytes / TOTAL_CAPACITY) * 100;
    const percentage = percentageNum > 0 && percentageNum < 0.1 ? '0.1%' : `${percentageNum.toFixed(1)}%`;

    if (storageUsageText) {
      if (totalBytes > 0) {
        storageUsageText.textContent = `${formatBytes(totalBytes)} (${percentage})`;
      } else {
        storageUsageText.textContent = `0%`;
      }
    }

    if (storageProgressFill) {
      storageProgressFill.style.width = `${Math.max(0, Math.min(100, percentageNum))}%`;
    }

    // 3. Update count pill
    const countPill = document.getElementById('cloud-file-count');
    if (countPill) {
      const total = currentSharesList.length;
      countPill.textContent = `${total} ${total === 1 ? 'item' : 'items'}`;
    }

    // 4. Render Cloud Feed Items
    if (!currentSharesList || currentSharesList.length === 0) {
      if (liveFeedContainer) {
        liveFeedContainer.innerHTML = `
          <div class="cloud-empty-state">
            <div class="cloud-empty-graphic">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" fill="url(#emptyCloudGrad)" stroke="#f472b6" stroke-width="1.8" stroke-dasharray="3 3"/>
                <path d="M12 11v4M12 18h.01" stroke="#f472b6" stroke-width="2" stroke-linecap="round"/>
                <defs>
                  <linearGradient id="emptyCloudGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#ffffff"/>
                    <stop offset="100%" stop-color="#fce7f3"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <p class="cloud-empty-title">Cloud is Empty</p>
            <p class="cloud-empty-desc">No uploaded files yet. Attach files or type a message below to share to Cloud! ☁️✨</p>
          </div>
        `;
      }
      if (isSelectMode) setSelectMode(false);
      return;
    }

    renderCloudItemBubbles(currentSharesList);
    updateBatchUI();
  } catch (err) {
    if (liveFeedContainer) {
      liveFeedContainer.innerHTML = `
        <div class="empty-feed-box">
          <p>Error loading items: ${err.message}</p>
        </div>
      `;
    }
  } finally {
    isRefreshingFeed = false;
    if (pendingRefreshRequest) {
      pendingRefreshRequest = false;
      refreshAppFeed();
    }
  }
}

// --- Render Sleek Horizontal Rectangle Items (Instant 1-Click Access) ---
function renderCloudItemBubbles(sharesList) {
  if (!liveFeedContainer) return;
  liveFeedContainer.innerHTML = '';

  sharesList.forEach(item => {
    const cardEl = document.createElement('div');
    cardEl.className = `cloud-item-row-card ${selectedShareIds.has(item.id) ? 'selected' : ''}`;
    cardEl.setAttribute('data-id', item.id);

    const fileUrl = getFilePublicUrl(item.storage_path) || item.content;
    const isImage = item.file_name && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.file_name);
    const isFile = item.type === 'file' || item.type === 'both' || Boolean(item.storage_path);
    const isUrl = item.content && /^https?:\/\/[^\s]+$/i.test(item.content.trim());

    // 0. Select Checkbox
    let checkboxHtml = '';
    if (isSelectMode) {
      checkboxHtml = `
        <div class="cloud-item-checkbox-container">
          <input type="checkbox" class="custom-checkbox cloud-item-select-checkbox" ${selectedShareIds.has(item.id) ? 'checked' : ''} />
        </div>
      `;
    }

    // 1. Left Square Thumbnail
    let squareThumbHtml = '';
    if (isImage && (item.storage_path || fileUrl)) {
      squareThumbHtml = `
        <div class="cloud-item-square-thumb" title="Click for large preview">
          <img src="" data-thumb-path="${escapeHtml(item.storage_path || '')}" data-raw-url="${escapeHtml(fileUrl || '')}" alt="preview" class="cloud-thumb-img cloud-thumb-lazy" />
        </div>
      `;
    } else {
      let icon = '📝';
      if (item.type === 'both') icon = '📦';
      else if (isFile) icon = '📁';
      else if (isUrl) icon = '🔗';
      squareThumbHtml = `
        <div class="cloud-item-square-thumb" title="Click for details">
          <span class="cloud-thumb-icon">${icon}</span>
        </div>
      `;
    }

    // 2. Right Info & Timestamps
    let titleStr = '';
    if (item.file_name) {
      titleStr = item.type === 'both' && item.content
        ? `${item.file_name} — "${item.content.substring(0, 24)}"`
        : item.file_name;
    } else {
      titleStr = item.content || 'Item';
    }

    const shortUploadTime = formatShortTime(item.created_at);
    const remainingTimePinkStr = formatRemainingTimeClean(item.expires_at);
    const durationBadgeText = calculateConfiguredHoursText(item.created_at, item.expires_at);

    // SVG Icons
    const downloadSvgIcon = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    `;

    const copySvgIcon = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    `;

    const deleteSvgIcon = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
    `;

    cardEl.innerHTML = `
      ${checkboxHtml}
      <span class="cloud-item-duration-badge">${durationBadgeText}</span>
      ${squareThumbHtml}

      <div class="cloud-item-right-info">
        <span class="cloud-item-title-text">${escapeHtml(titleStr)}</span>
        
        <div class="cloud-item-meta-line">
          <span class="cloud-item-upload-time">${shortUploadTime}</span>
          <span class="meta-divider">|</span>
          <span class="cloud-item-remaining-pink">${remainingTimePinkStr}</span>
        </div>
        
        <div class="cloud-item-bottom-actions">
          <button type="button" class="icon-action-btn-danger quick-delete-btn" title="Delete">
            ${deleteSvgIcon}
          </button>

          ${isFile ? `
            <button type="button" class="icon-action-btn quick-save-btn" title="Download">
              ${downloadSvgIcon}
            </button>
          ` : `
            <button type="button" class="icon-action-btn quick-copy-btn" title="Copy">
              ${copySvgIcon}
            </button>
          `}
        </div>
      </div>
    `;

    // Multi-Select Card Click Handler
    if (isSelectMode) {
      cardEl.addEventListener('click', (e) => {
        if (e.target.closest('.quick-delete-btn') || e.target.closest('.quick-save-btn') || e.target.closest('.quick-copy-btn')) {
          return;
        }
        if (selectedShareIds.has(item.id)) {
          selectedShareIds.delete(item.id);
        } else {
          selectedShareIds.add(item.id);
        }
        updateBatchUI();
      });
    } else {
      // Click on Card or Left Square Thumbnail
      const squareThumbEl = cardEl.querySelector('.cloud-item-square-thumb');
      if (squareThumbEl) {
        squareThumbEl.addEventListener('click', (e) => {
          e.stopPropagation();
          openItemPreviewModal(item);
        });
      }

      cardEl.addEventListener('click', (e) => {
        if (e.target.closest('.cloud-item-bottom-actions') || e.target.closest('.cloud-item-square-thumb')) return;
        openItemPreviewModal(item);
      });
    }

    // Quick Copy button
    const quickCopyBtn = cardEl.querySelector('.quick-copy-btn');
    if (quickCopyBtn) {
      quickCopyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (item.content) {
          markItemAsAccessed(item.id);
          await copyToClipboard(item.content, '📋 Copied!');
        }
      });
    }

    // Quick Save button
    const quickSaveBtn = cardEl.querySelector('.quick-save-btn');
    if (quickSaveBtn) {
      quickSaveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (fileUrl || item.storage_path) {
          markItemAsAccessed(item.id);
          downloadFileDirectly(fileUrl, item.file_name || 'download', item.storage_path);
        }
      });
    }

    // Quick Delete button
    const quickDeleteBtn = cardEl.querySelector('.quick-delete-btn');
    if (quickDeleteBtn) {
      quickDeleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('คุณต้องการลบรายการนี้ใช่หรือไม่?')) {
          revokeBlobUrlForPath(item.storage_path);
          const res = await deleteShareRecordAndStorage(item.id, item.storage_path);
          if (res.success) {
            showToast('🗑️ Deleted!');
          } else {
            showToast(`❌ Delete failed: ${res.error || 'RLS Permission'}`);
          }
          await refreshAppFeed();
        }
      });
    }

    // Resolve lazy thumbnail image if present
    const thumbImg = cardEl.querySelector('.cloud-thumb-lazy');
    if (thumbImg) {
      const storagePath = thumbImg.dataset.thumbPath;
      const rawUrl = thumbImg.dataset.rawUrl;
      if (storagePath) {
        getImageBlobUrl(storagePath).then(blobUrl => {
          if (blobUrl) {
            thumbImg.src = blobUrl;
          } else if (rawUrl) {
            thumbImg.src = rawUrl;
          }
        });
      } else if (rawUrl) {
        thumbImg.src = rawUrl;
      }
    }

    liveFeedContainer.appendChild(cardEl);
  });
}

// --- Item Preview Modal Handlers ---
function initItemModal() {
  if (!closeItemModalBtn) return;
  closeItemModalBtn.addEventListener('click', closeItemModal);
  itemModal.addEventListener('click', (e) => {
    if (e.target === itemModal) closeItemModal();
  });

  modalCopyBtn.addEventListener('click', async () => {
    if (currentActiveItem && currentActiveItem.content) {
      markItemAsAccessed(currentActiveItem.id);
      await copyToClipboard(currentActiveItem.content, '📋 Copied!');
    }
  });

  modalDownloadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentActiveItem) {
      const fileUrl = getFilePublicUrl(currentActiveItem.storage_path) || currentActiveItem.content;
      if (fileUrl || currentActiveItem.storage_path) {
        markItemAsAccessed(currentActiveItem.id);
        downloadFileDirectly(fileUrl, currentActiveItem.file_name || 'download', currentActiveItem.storage_path);
      }
    }
  });

  modalShareBtn.addEventListener('click', () => {
    if (currentActiveItem) {
      const fileUrl = getFilePublicUrl(currentActiveItem.storage_path) || currentActiveItem.content;
      openQrModal(fileUrl || window.location.href);
    }
  });

  modalDeleteBtn.addEventListener('click', async () => {
    if (currentActiveItem && confirm('คุณต้องการลบรายการนี้ใช่หรือไม่?')) {
      revokeBlobUrlForPath(currentActiveItem.storage_path);
      const res = await deleteShareRecordAndStorage(currentActiveItem.id, currentActiveItem.storage_path);
      if (res.success) {
        showToast('🗑️ Deleted!');
        closeItemModal();
        await refreshAppFeed();
      } else {
        showToast(`❌ Delete failed: ${res.error || 'RLS Permission'}`);
      }
    }
  });
}

function openItemPreviewModal(item) {
  currentActiveItem = item;
  const fileUrl = getFilePublicUrl(item.storage_path) || item.content;

  modalItemBadge.textContent = item.type === 'both' ? 'Message + File' : item.type === 'file' ? 'File' : 'Message / Link';
  if (modalFileName) {
    modalFileName.textContent = item.file_name || (item.content ? item.content.substring(0, 30) : 'Item');
  }

  modalPreviewArea.innerHTML = '';
  modalTextContent.classList.add('hidden');
  modalCopyBtn.classList.add('hidden');
  modalOpenLinkBtn.classList.add('hidden');
  modalDownloadBtn.classList.add('hidden');

  const isImage = item.file_name && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.file_name);
  const isFile = item.type === 'file' || item.type === 'both' || Boolean(item.storage_path);
  const isUrl = item.content && /^https?:\/\/[^\s]+$/i.test(item.content.trim());

  // Image Preview inside Modal
  if (isImage && (item.storage_path || fileUrl)) {
    modalPreviewArea.innerHTML = `<div style="padding: 24px; font-size: 0.85rem; color: #9ca3af; text-align: center;">⏳ กำลังถอดรหัสรูปภาพ...</div>`;
    if (item.storage_path) {
      getImageBlobUrl(item.storage_path).then(blobUrl => {
        if (blobUrl) {
          modalPreviewArea.innerHTML = `<img src="${blobUrl}" alt="preview" class="modal-img-preview" />`;
        } else if (fileUrl) {
          modalPreviewArea.innerHTML = `<img src="${fileUrl}" alt="preview" class="modal-img-preview" />`;
        }
      });
    } else {
      modalPreviewArea.innerHTML = `<img src="${fileUrl}" alt="preview" class="modal-img-preview" />`;
    }
  } else if (isFile) {
    const fileNameStr = item.file_name || 'File';
    const fileSizeStr = item.file_size ? formatBytes(item.file_size) : '';
    modalPreviewArea.innerHTML = `
      <div style="font-size: 3rem; margin-bottom: 4px;">📁</div>
      <p style="font-size: 0.95rem; font-weight: 700;">${escapeHtml(fileNameStr)}</p>
      ${fileSizeStr ? `<p style="font-size: 0.78rem; color: #6b7280;">${fileSizeStr}</p>` : ''}
    `;
  }

  // Text Content Display
  if (item.content && (item.type === 'text' || item.type === 'both')) {
    modalTextContent.textContent = item.content;
    modalTextContent.classList.remove('hidden');
    modalCopyBtn.classList.remove('hidden');

    if (isUrl) {
      modalOpenLinkBtn.href = item.content;
      modalOpenLinkBtn.classList.remove('hidden');
    }
  }

  if (isFile && (fileUrl || item.storage_path)) {
    modalDownloadBtn.classList.remove('hidden');
  }

  itemModal.classList.remove('hidden');
}

function closeItemModal() {
  if (itemModal) itemModal.classList.add('hidden');
  currentActiveItem = null;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- QR Modal Handlers ---
let currentQrUrl = null;

function initQrModal() {
  if (!closeQrModalBtn) return;
  closeQrModalBtn.addEventListener('click', closeQrModal);
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) closeQrModal();
  });

  if (qrNativeShareBtn) {
    qrNativeShareBtn.addEventListener('click', async () => {
      const urlToShare = currentQrUrl || (currentActiveItem && currentActiveItem.content) || window.location.href;
      const shareTitle = 'UpMee 🐰';
      const shareText = (currentActiveItem && currentActiveItem.file_name) 
        ? `UpMee File: ${currentActiveItem.file_name}`
        : 'UpMee Share';

      if (navigator.share) {
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: urlToShare
          });
        } catch (err) {
          if (err.name !== 'AbortError') {
            await copyToClipboard(urlToShare, '📋 Copied link to clipboard!');
          }
        }
      } else {
        await copyToClipboard(urlToShare, '📋 Copied link to clipboard!');
      }
    });
  }
}

function openQrModal(urlToEncode) {
  currentQrUrl = urlToEncode;
  QRCode.toCanvas(qrModalCanvas, urlToEncode, {
    width: 200,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#ec4899',
      light: '#ffffff'
    }
  }, (err) => {
    if (err) {
      console.error('QR code error:', err);
      return;
    }

    const ctx = qrModalCanvas.getContext('2d');
    const logo = new Image();
    logo.src = '/bunny_mascot.png';
    logo.onload = () => {
      const logoSize = qrModalCanvas.width * 0.24;
      const center = (qrModalCanvas.width - logoSize) / 2;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(qrModalCanvas.width / 2, qrModalCanvas.height / 2, logoSize / 2 + 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.drawImage(logo, center, center, logoSize, logoSize);
    };
    logo.onerror = () => {
      console.warn('Bunny mascot logo could not be loaded for QR overlay');
    };
  });

  qrModal.classList.remove('hidden');
}

function closeQrModal() {
  if (qrModal) qrModal.classList.add('hidden');
  currentQrUrl = null;
}

// --- Settings Modal Handlers ---
function initSettingsModal() {
  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettingsModal);
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeModalBtnHandler);
  }

  if (configModal) {
    configModal.addEventListener('click', (e) => {
      if (e.target === configModal) closeModalBtnHandler();
    });
  }

  // Save Supabase Settings
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', () => {
      const url = cfgUrl.value.trim();
      const key = cfgKey.value.trim();
      if (!url || !key) {
        showToast('❌ Please fill in both URL and Anon Key');
        return;
      }
      saveSupabaseConfig(url, key);
      showToast('💖 Settings Saved!');
      closeModalBtnHandler();
      refreshAppFeed();
    });
  }
}

function openSettingsModal() {
  const { url, key } = getSupabaseConfig();
  if (cfgUrl) cfgUrl.value = url;
  if (cfgKey) cfgKey.value = key;
  if (settingsDeviceStatusPill) {
    if (isDeviceAuthorized()) {
      settingsDeviceStatusPill.textContent = '✅ Trusted Device';
      settingsDeviceStatusPill.className = 'e2ee-status-pill protected';
    } else {
      settingsDeviceStatusPill.textContent = '🔒 Not Authorized';
      settingsDeviceStatusPill.className = 'e2ee-status-pill warning';
    }
  }
  if (settingsKeyFingerprint) {
    settingsKeyFingerprint.textContent = isDeviceAuthorized() ? (getKeyFingerprint() || '----') : '----';
  }
  if (configModal) configModal.classList.remove('hidden');
}

function closeModalBtnHandler() {
  if (configModal) configModal.classList.add('hidden');
}

// --- PWA Installation & Service Worker ---
function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('Service Worker registration failed:', err);
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    // Only show install button if device is authorized!
    if (pwaInstallBtn && isDeviceAuthorized()) {
      pwaInstallBtn.classList.remove('hidden');
    }
  });

  if (pwaInstallBtn) {
    pwaInstallBtn.addEventListener('click', async () => {
      if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        const { outcome } = await deferredPwaPrompt.userChoice;
        if (outcome === 'accepted') {
          pwaInstallBtn.classList.add('hidden');
        }
        deferredPwaPrompt = null;
      }
    });
  }
}

// --- Device Gatekeeper & Vault Security UI ---
function updateVaultUIState(isAuthorized) {
  if (isAuthorized) {
    if (vaultGatekeeper) vaultGatekeeper.classList.add('hidden');
    if (appMainContent) appMainContent.classList.remove('hidden');
    if (headerVaultBadge) {
      headerVaultBadge.classList.remove('vault-locked');
      headerVaultBadge.classList.add('vault-unlocked');
    }
    if (vaultBadgeText) vaultBadgeText.textContent = 'Vault Active';
    if (settingsDeviceStatusPill) {
      settingsDeviceStatusPill.textContent = '✅ Trusted Device';
      settingsDeviceStatusPill.className = 'e2ee-status-pill protected';
    }
    if (settingsKeyFingerprint) {
      settingsKeyFingerprint.textContent = getKeyFingerprint() || '----';
    }
    if (pwaInstallBtn && deferredPwaPrompt) {
      pwaInstallBtn.classList.remove('hidden');
    }
  } else {
    if (vaultGatekeeper) vaultGatekeeper.classList.remove('hidden');
    if (appMainContent) appMainContent.classList.add('hidden');
    if (headerVaultBadge) {
      headerVaultBadge.classList.remove('vault-unlocked');
      headerVaultBadge.classList.add('vault-locked');
    }
    if (vaultBadgeText) vaultBadgeText.textContent = 'Vault Locked';
    if (settingsDeviceStatusPill) {
      settingsDeviceStatusPill.textContent = '🔒 Not Authorized';
      settingsDeviceStatusPill.className = 'e2ee-status-pill warning';
    }
    if (settingsKeyFingerprint) {
      settingsKeyFingerprint.textContent = '----';
    }
    if (pwaInstallBtn) {
      pwaInstallBtn.classList.add('hidden');
    }
  }
}

let gatekeeperInitialized = false;

async function initDeviceGatekeeper() {
  // 1. Initialize encryption key & check pairing params in URL
  const initRes = await initializeEncryptionKey();
  const authorized = isDeviceAuthorized();
  updateVaultUIState(authorized);

  if (initRes && initRes.paired) {
    showToast('📱 จับคู่อุปกรณ์สำเร็จ! ปลดล็อคห้องนิรภัยแล้ว 🐰💖');
  }

  // Hook header vault badge click
  if (headerVaultBadge) {
    headerVaultBadge.addEventListener('click', () => {
      if (isDeviceAuthorized()) {
        openSettingsModal();
      } else {
        if (gatekeeperPassInput) gatekeeperPassInput.focus();
      }
    });
  }

  if (gatekeeperInitialized) return;
  gatekeeperInitialized = true;

  // Toggle Password visibility
  if (gatekeeperTogglePwdBtn && gatekeeperPassInput) {
    gatekeeperTogglePwdBtn.addEventListener('click', () => {
      const isPwd = gatekeeperPassInput.type === 'password';
      gatekeeperPassInput.type = isPwd ? 'text' : 'password';
      gatekeeperTogglePwdBtn.textContent = isPwd ? '🙈' : '👁️';
    });
  }

  // Toggle Pairing input box
  if (gatekeeperOpenPairBtn && gatekeeperPairBox) {
    gatekeeperOpenPairBtn.addEventListener('click', () => {
      gatekeeperPairBox.classList.toggle('hidden');
      if (!gatekeeperPairBox.classList.contains('hidden') && gatekeeperPairInput) {
        gatekeeperPairInput.focus();
      }
    });
  }

  // Apply Pairing Token / Link
  if (gatekeeperApplyTokenBtn && gatekeeperPairInput) {
    gatekeeperApplyTokenBtn.addEventListener('click', async () => {
      const token = gatekeeperPairInput.value.trim();
      if (!token) {
        showToast('⚠️ กรุณากรอก Pairing Token หรือ ลิงก์จับคู่');
        return;
      }
      try {
        await unlockWithPairingToken(token);
        updateVaultUIState(true);
        showToast('📱 เชื่อมต่อและลงทะเบียนเครื่องสำเร็จ! 🐰💖');
        await refreshAppFeed();
      } catch (err) {
        console.error('Pairing error:', err);
        showToast('❌ Token ไม่ถูกต้องหรือไม่สามารถถอดรหัสได้');
        if (vaultGatekeeper) {
          vaultGatekeeper.classList.add('shake');
          setTimeout(() => vaultGatekeeper.classList.remove('shake'), 600);
        }
      }
    });
  }

  // Submit Passphrase
  if (gatekeeperUnlockForm && gatekeeperPassInput) {
    gatekeeperUnlockForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const passphrase = gatekeeperPassInput.value.trim();
      if (!passphrase) return;

      if (gatekeeperSubmitBtn) {
        gatekeeperSubmitBtn.disabled = true;
        gatekeeperSubmitBtn.innerHTML = '<span>กำลังตรวจสอบรหัส... ⏳</span>';
      }

      try {
        const verifyRes = await verifyPassphraseAgainstVault(passphrase);
        if (verifyRes.valid) {
          await unlockWithPassphrase(passphrase);
          if (verifyRes.isFirstTime) {
            await setupVaultChallenge(getActiveCryptoKey());
          }
          if (gatekeeperErrorMsg) gatekeeperErrorMsg.classList.add('hidden');
          gatekeeperPassInput.value = '';
          updateVaultUIState(true);
          showToast('🔓 ปลดล็อค & ยืนยันเครื่องสำเร็จเรียบร้อย! 🐰✨');
          await refreshAppFeed();
        } else {
          if (gatekeeperErrorMsg) gatekeeperErrorMsg.classList.remove('hidden');
          if (vaultGatekeeper) {
            vaultGatekeeper.classList.add('shake');
            setTimeout(() => vaultGatekeeper.classList.remove('shake'), 600);
          }
          gatekeeperPassInput.focus();
          gatekeeperPassInput.select();
        }
      } catch (err) {
        console.error('Unlock error:', err);
        showToast(`❌ เกิดข้อผิดพลาด: ${err.message}`);
      } finally {
        if (gatekeeperSubmitBtn) {
          gatekeeperSubmitBtn.disabled = false;
          gatekeeperSubmitBtn.innerHTML = '<span>ปลดล็อค & ลงทะเบียนเครื่องนี้ 🐰✨</span>';
        }
      }
    });
  }
}

// --- Device Pairing in Settings Modal ---
let currentPairingUrl = null;

function initDevicePairingSettings() {
  if (settingsPairDeviceBtn) {
    settingsPairDeviceBtn.addEventListener('click', async () => {
      if (!isDeviceAuthorized()) {
        showToast('⚠️ กรุณาปลดล็อคเครื่องนี้ก่อนจับคู่อุปกรณ์อื่น');
        return;
      }
      try {
        const pairUrl = await getPairingUrl();
        if (!pairUrl) {
          showToast('❌ ไม่พบคีย์เข้ารหัส กรุณาปลดล็อคใหม่อีกครั้ง');
          return;
        }
        currentPairingUrl = pairUrl;
        openPairDeviceModal(pairUrl);
      } catch (err) {
        console.error('Failed to generate pairing url:', err);
        showToast('❌ ไม่สามารถสร้างรหัสจับคู่ได้');
      }
    });
  }

  if (settingsRevokeDeviceBtn) {
    settingsRevokeDeviceBtn.addEventListener('click', () => {
      if (confirm('คุณแน่ใจหรือไม่ว่าต้องการยกเลิกการอนุญาตเครื่องนี้? หลังจากนี้เครื่องนี้จะไม่สามารถดูหรือดาวน์โหลดไฟล์ใน Vault ได้')) {
        revokeDeviceAuthorization();
        closeModalBtnHandler();
        updateVaultUIState(false);
        if (liveFeedContainer) liveFeedContainer.innerHTML = '';
        showToast('🔒 ยกเลิกการอนุญาตเครื่องนี้แล้ว');
      }
    });
  }

  if (closePairModalBtn) {
    closePairModalBtn.addEventListener('click', closePairDeviceModal);
  }

  if (pairDeviceModal) {
    pairDeviceModal.addEventListener('click', (e) => {
      if (e.target === pairDeviceModal) closePairDeviceModal();
    });
  }

  if (copyPairLinkBtn) {
    copyPairLinkBtn.addEventListener('click', async () => {
      if (currentPairingUrl) {
        await copyToClipboard(currentPairingUrl, '📋 คัดลอก Pairing Link เรียบร้อย!');
      }
    });
  }
}

function openPairDeviceModal(pairUrl) {
  if (!pairDeviceModal || !pairModalCanvas) return;
  QRCode.toCanvas(pairModalCanvas, pairUrl, {
    width: 220,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#ec4899',
      light: '#ffffff'
    }
  }, (err) => {
    if (err) {
      console.error('QR code error for pairing:', err);
      return;
    }
    const ctx = pairModalCanvas.getContext('2d');
    const logo = new Image();
    logo.src = '/bunny_mascot.png';
    logo.onload = () => {
      const logoSize = pairModalCanvas.width * 0.24;
      const center = (pairModalCanvas.width - logoSize) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pairModalCanvas.width / 2, pairModalCanvas.height / 2, logoSize / 2 + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(logo, center, center, logoSize, logoSize);
    };
    logo.onerror = () => {
      console.warn('Bunny mascot logo could not be loaded for QR overlay');
    };
  });

  pairDeviceModal.classList.remove('hidden');
}

function closePairDeviceModal() {
  if (pairDeviceModal) pairDeviceModal.classList.add('hidden');
  currentPairingUrl = null;
}
