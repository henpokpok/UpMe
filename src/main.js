import QRCode from 'qrcode';
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  createShareItem,
  getActiveSharesList,
  deleteShareRecordAndStorage,
  getStorageUsageInfo,
  subscribeToRealtimeUploads,
  savePushSubscription,
  getFilePublicUrl
} from './supabase.js';

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

// Application State
let selectedFile = null;
let selectedDurationKey = '24h'; // Default '24h'
let deferredPwaPrompt = null;
let currentActiveItem = null;

// DOM Elements
const historyBtn = document.getElementById('history-btn');
const historyPopover = document.getElementById('history-popover');
const popoverNotifyToggle = document.getElementById('popover-notify-toggle');
const forceRegisterPushBtn = document.getElementById('force-register-push-btn');
const historyListContainer = document.getElementById('history-list-container');

const pillBtns = document.querySelectorAll('.pill-btn');
const textContent = document.getElementById('text-content');
const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');
const filePreview = document.getElementById('file-preview');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const removeFileBtn = document.getElementById('remove-file-btn');

const shareForm = document.getElementById('share-form');
const submitShareBtn = document.getElementById('submit-share-btn');

const storageUsageText = document.getElementById('storage-usage-text');
const storageProgressFill = document.getElementById('storage-progress-fill');

const liveFeedContainer = document.getElementById('live-feed-container');
const refreshFeedBtn = document.getElementById('refresh-feed-btn');

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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initHistoryPopover();
  initPills();
  initDropzone();
  initForms();
  initSettingsModal();
  initItemModal();
  initQrModal();
  initPWA();
  
  refreshAppFeed();
  initRealtimeSubscription();
  checkSharedDataFromGallery();

  // Auto-refresh feed whenever tab becomes active/visible
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshAppFeed();
    }
  });
});

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

    // Check shared file from gallery app
    const fileRes = await cache.match('/shared-file');
    if (fileRes) {
      const blob = await fileRes.blob();
      const rawFileName = fileRes.headers.get('x-file-name') ? decodeURIComponent(fileRes.headers.get('x-file-name')) : 'shared_image.jpg';
      const sharedFile = new File([blob], rawFileName, { type: blob.type || 'image/jpeg' });
      
      handleFileSelection(sharedFile);
      await cache.delete('/shared-file');
      showToast('📷 Image loaded from Gallery share!');
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

// Clean concise remaining time format
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

// Short time format e.g. "07:31 PM"
function formatShortTime(createdAtISO) {
  return new Date(createdAtISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function calculateConfiguredHoursText(createdAtISO, expiresAtISO) {
  const diffHours = Math.round((new Date(expiresAtISO) - new Date(createdAtISO)) / (1000 * 60 * 60));
  if (diffHours >= 168) return '7d';
  return `${diffHours}h`;
}

// Helper to convert Base64 URL Key to Uint8Array for VAPID Web Push
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

// Register background Web Push PushManager subscription
// silent = true on auto-load to avoid toast notifications every time the user enters the app
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
    registerWebPushSubscription(true); // Silent sync on page load
  }

  if (forceRegisterPushBtn) {
    forceRegisterPushBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      registerWebPushSubscription(false); // Explicit click -> Shows toast
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

  const isFile = newRecord.type === 'file' || newRecord.type === 'both' || Boolean(newRecord.file_name);
  const isImage = isFile && newRecord.file_name && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(newRecord.file_name);

  const title = 'UpMee 🐰';
  let bodyText = '';
  let iconUrl = '/bunny_mascot.png';
  let imageUrl = undefined;

  if (isFile) {
    bodyText = `ไฟล์ใหม่: ${newRecord.file_name || 'ไฟล์แนบ'}`;
    if (isImage && newRecord.content) {
      iconUrl = newRecord.content;
      imageUrl = newRecord.content;
    }
  } else {
    bodyText = newRecord.content ? newRecord.content.substring(0, 40) : '';
  }

  const itemTag = 'upmee-share-' + (newRecord.id || newRecord.created_at || 'item');

  const options = {
    body: bodyText,
    icon: iconUrl,
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    tag: itemTag,
    renotify: false,
    data: newRecord
  };

  if (imageUrl) {
    options.image = imageUrl;
  }

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
    refreshAppFeed();
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

// --- Drag & Drop Handlers ---
function initDropzone() {
  if (!dropzone) return;

  dropzone.addEventListener('click', (e) => {
    if (e.target !== removeFileBtn && !removeFileBtn.contains(e.target)) {
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelection(e.target.files[0]);
    }
  });

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
    if (files && files[0]) {
      handleFileSelection(files[0]);
    }
  });

  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedFile = null;
    fileInput.value = '';
    filePreview.classList.add('hidden');
    dropzone.querySelector('.dropzone-content').classList.remove('hidden');
  });
}

function handleFileSelection(file) {
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_SIZE) {
    showToast('❌ ไฟล์มีขนาดเกิน 50MB ไม่สามารถอัปโหลดได้น้า');
    return;
  }

  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);

  dropzone.querySelector('.dropzone-content').classList.add('hidden');
  filePreview.classList.remove('hidden');
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

    const textVal = textContent.value.trim();
    if (!textVal && !selectedFile) {
      showToast('⚠️ กรุณาพิมพ์ข้อความ/ลิงก์ หรือแนบไฟล์อย่างน้อย 1 อย่างนะจ๊ะ');
      return;
    }

    try {
      submitShareBtn.disabled = true;
      submitShareBtn.innerHTML = `<span>⏳ Uploading...</span>`;

      await createShareItem({
        textContent: textVal,
        file: selectedFile,
        durationKey: selectedDurationKey
      });

      showToast('🎉 Upload Complete!');

      // Clear fields
      textContent.value = '';
      selectedFile = null;
      fileInput.value = '';
      filePreview.classList.add('hidden');
      dropzone.querySelector('.dropzone-content').classList.remove('hidden');

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

// --- Refresh Cloud Feed & Storage % Bar ---
async function refreshAppFeed() {
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

  // 1. Storage Bar % Calculation
  try {
    const { totalBytes } = await getStorageUsageInfo();
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
  } catch (err) {
    console.error('Error calculating storage percentage:', err);
  }

  // 2. Render Cloud Feed Items
  try {
    if (liveFeedContainer) {
      liveFeedContainer.innerHTML = `
        <div class="loading-spinner-box">
          <div class="cloud-loader">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" class="spin-cloud">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" stroke="#f472b6" stroke-width="2.2" stroke-dasharray="4 2"/>
            </svg>
            <p>Syncing cloud...</p>
          </div>
        </div>
      `;
    }

    const sharesList = await getActiveSharesList();
    const countPill = document.getElementById('cloud-file-count');
    if (countPill) {
      const total = sharesList ? sharesList.length : 0;
      countPill.textContent = `${total} ${total === 1 ? 'item' : 'items'}`;
    }

    if (!sharesList || sharesList.length === 0) {
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
            <p class="cloud-empty-desc">No uploaded files yet. Attach a file or type a message below to share to Cloud! ☁️✨</p>
          </div>
        `;
      }
      return;
    }

    renderCloudItemBubbles(sharesList);
  } catch (err) {
    if (liveFeedContainer) {
      liveFeedContainer.innerHTML = `
        <div class="empty-feed-box">
          <p>Error loading items: ${err.message}</p>
        </div>
      `;
    }
  }
}

// --- Render Sleek Horizontal Rectangle Items ---
function renderCloudItemBubbles(sharesList) {
  if (!liveFeedContainer) return;
  liveFeedContainer.innerHTML = '';

  sharesList.forEach(item => {
    const cardEl = document.createElement('div');
    cardEl.className = 'cloud-item-row-card';

    const fileUrl = getFilePublicUrl(item.storage_path) || item.content;
    const isImage = item.file_name && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.file_name);
    const isFile = item.type === 'file' || item.type === 'both';
    const isUrl = item.content && /^https?:\/\/[^\s]+$/i.test(item.content.trim());

    // 1. Left Square Thumbnail (Stretch Image edge-to-edge)
    let squareThumbHtml = '';
    if (isImage && fileUrl) {
      squareThumbHtml = `
        <div class="cloud-item-square-thumb" title="Click for large preview">
          <img src="${fileUrl}" alt="preview" class="cloud-thumb-img" />
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
    const titleStr = item.file_name 
      ? (item.type === 'both' ? `${item.file_name} — "${item.content.substring(0, 24)}"` : item.file_name)
      : (item.content || 'Item');
    const shortUploadTime = formatShortTime(item.created_at);
    const remainingTimePinkStr = formatRemainingTimeClean(item.expires_at);
    const durationBadgeText = calculateConfiguredHoursText(item.created_at, item.expires_at);

    // SVG Action Buttons
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
      <!-- Top-Right Duration Hours Badge -->
      <span class="cloud-item-duration-badge">${durationBadgeText}</span>

      <!-- Left Square Thumbnail (Clickable) -->
      ${squareThumbHtml}

      <!-- Right Info Area -->
      <div class="cloud-item-right-info">
        <span class="cloud-item-title-text">${escapeHtml(titleStr)}</span>
        
        <!-- Single Combined Meta Line: Upload Time | Remaining Time -->
        <div class="cloud-item-meta-line">
          <span class="cloud-item-upload-time">${shortUploadTime}</span>
          <span class="meta-divider">|</span>
          <span class="cloud-item-remaining-pink">${remainingTimePinkStr}</span>
        </div>
        
        <!-- Bottom-Right Small Circular SVG Action Buttons -->
        <div class="cloud-item-bottom-actions">
          <button type="button" class="icon-action-btn-danger quick-delete-btn" title="Delete">
            ${deleteSvgIcon}
          </button>

          ${isFile ? `
            <a href="#" class="icon-action-btn quick-save-btn" title="Download">
              ${downloadSvgIcon}
            </a>
          ` : `
            <button type="button" class="icon-action-btn quick-copy-btn" title="Copy">
              ${copySvgIcon}
            </button>
          `}
        </div>
      </div>
    `;

    // Click on Left Square Thumbnail -> Opens Large Popup Modal
    const squareThumbEl = cardEl.querySelector('.cloud-item-square-thumb');
    if (squareThumbEl) {
      squareThumbEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openItemPreviewModal(item);
      });
    }

    // Quick Copy button
    const quickCopyBtn = cardEl.querySelector('.quick-copy-btn');
    if (quickCopyBtn) {
      quickCopyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        markItemAsAccessed(item.id);
        navigator.clipboard.writeText(item.content).then(() => {
          showToast('📋 Copied!');
        });
      });
    }

    // Quick Save button
    const quickSaveBtn = cardEl.querySelector('.quick-save-btn');
    if (quickSaveBtn) {
      quickSaveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        markItemAsAccessed(item.id);
        downloadFileDirectly(fileUrl, item.file_name || 'download');
      });
    }

    // Quick Delete button
    const quickDeleteBtn = cardEl.querySelector('.quick-delete-btn');
    if (quickDeleteBtn) {
      quickDeleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('คุณต้องการลบรายการนี้ใช่หรือไม่?')) {
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

    liveFeedContainer.appendChild(cardEl);
  });
}

// Helper to download files directly via blob (avoids cross-origin redirect tabs on mobile Safari/Chrome)
async function downloadFileDirectly(fileUrl, fileNameStr) {
  try {
    showToast('⏳ กําลังดาวน์โหลดไฟล์...');
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = fileNameStr || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    showToast('💾 ดาวน์โหลดไฟล์สำเร็จ!');
  } catch (err) {
    console.warn('Direct blob download failed, opening direct URL:', err);
    window.open(fileUrl, '_blank');
  }
}

// --- Item Preview Modal Handlers ---
function initItemModal() {
  if (!closeItemModalBtn) return;
  closeItemModalBtn.addEventListener('click', closeItemModal);
  itemModal.addEventListener('click', (e) => {
    if (e.target === itemModal) closeItemModal();
  });

  modalCopyBtn.addEventListener('click', () => {
    if (currentActiveItem && currentActiveItem.content) {
      markItemAsAccessed(currentActiveItem.id);
      navigator.clipboard.writeText(currentActiveItem.content).then(() => {
        showToast('📋 Copied!');
      });
    }
  });

  modalDownloadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentActiveItem) {
      const fileUrl = getFilePublicUrl(currentActiveItem.storage_path) || currentActiveItem.content;
      if (fileUrl) {
        markItemAsAccessed(currentActiveItem.id);
        downloadFileDirectly(fileUrl, currentActiveItem.file_name || 'download');
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
  const isFile = item.type === 'file' || item.type === 'both';
  const isUrl = item.content && /^https?:\/\/[^\s]+$/i.test(item.content.trim());

  // Image Preview Thumbnail inside Modal
  if (isImage && fileUrl) {
    modalPreviewArea.innerHTML = `<img src="${fileUrl}" alt="preview" class="modal-img-preview" />`;
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

  // Download Button for files
  if (isFile && fileUrl) {
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

// --- QR Modal Handlers (Pink QR Code + Bunny Mascot Logo + Native Gallery Share) ---
function initQrModal() {
  if (!closeQrModalBtn) return;
  closeQrModalBtn.addEventListener('click', closeQrModal);
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) closeQrModal();
  });

  if (qrNativeShareBtn) {
    qrNativeShareBtn.addEventListener('click', async () => {
      const urlToShare = (currentActiveItem && currentActiveItem.content) ? currentActiveItem.content : window.location.href;
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
            showToast(`❌ Share error: ${err.message}`);
          }
        }
      } else {
        navigator.clipboard.writeText(urlToShare).then(() => {
          showToast('📋 คัดลอกลิงก์ไปยังคลิปบอร์ดแล้ว!');
        });
      }
    });
  }
}

function openQrModal(urlToEncode) {
  QRCode.toCanvas(qrModalCanvas, urlToEncode, {
    width: 200,
    margin: 2,
    color: {
      dark: '#ec4899', // Pink theme color!
      light: '#ffffff'
    }
  }, (err) => {
    if (err) {
      console.error('QR code error:', err);
      return;
    }

    // Draw Bunny mascot logo in the center of the QR Code
    const ctx = qrModalCanvas.getContext('2d');
    const logo = new Image();
    logo.src = '/bunny_mascot.png';
    logo.onload = () => {
      const logoSize = qrModalCanvas.width * 0.24; // 24% width of QR
      const center = (qrModalCanvas.width - logoSize) / 2;

      // Draw white background circle behind logo
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(qrModalCanvas.width / 2, qrModalCanvas.height / 2, logoSize / 2 + 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw Bunny Logo Image
      ctx.drawImage(logo, center, center, logoSize, logoSize);
    };
  });

  qrModal.classList.remove('hidden');
}

function closeQrModal() {
  if (qrModal) qrModal.classList.add('hidden');
}

// --- Settings Modal Handlers ---
function initSettingsModal() {
  if (!settingsBtn) return;
  settingsBtn.addEventListener('click', openSettingsModal);
  closeModalBtn.addEventListener('click', closeModalBtnHandler);

  configModal.addEventListener('click', (e) => {
    if (e.target === configModal) closeModalBtnHandler();
  });

  saveConfigBtn.addEventListener('click', () => {
    const url = cfgUrl.value.trim();
    const key = cfgKey.value.trim();
    if (!url || !key) {
      showToast('❌ Please fill in both URL and Anon Key');
      return;
    }
    saveSupabaseConfig(url, key);
    showToast('💖 Saved!');
    closeModalBtnHandler();
    refreshAppFeed();
  });
}

function openSettingsModal() {
  const { url, key } = getSupabaseConfig();
  if (cfgUrl) cfgUrl.value = url;
  if (cfgKey) cfgKey.value = key;
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
    if (pwaInstallBtn) pwaInstallBtn.classList.remove('hidden');
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
