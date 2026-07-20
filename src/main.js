import QRCode from 'qrcode';
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  createShareItem,
  getActiveSharesList,
  deleteShareRecordAndStorage,
  getStorageUsageInfo
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
const historyModal = document.getElementById('history-modal');
const closeHistoryModalBtn = document.getElementById('close-history-modal-btn');
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

const pwaInstallBtn = document.getElementById('pwa-install-btn');
const toast = document.getElementById('toast');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initHistoryModal();
  initPills();
  initDropzone();
  initForms();
  initSettingsModal();
  initItemModal();
  initQrModal();
  initPWA();
  
  refreshAppFeed();
});

// --- Toast Helper ---
function showToast(msg, duration = 3000) {
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

// --- Upload History Modal Handlers ---
function initHistoryModal() {
  historyBtn.addEventListener('click', openHistoryModal);
  closeHistoryModalBtn.addEventListener('click', closeHistoryModal);
  historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) closeHistoryModal();
  });
}

async function openHistoryModal() {
  historyModal.classList.remove('hidden');
  historyListContainer.innerHTML = `
    <div class="loading-spinner-box"><p>Loading history...</p></div>
  `;

  const shares = await getActiveSharesList();
  const accessedList = getAccessedIds();

  if (!shares || shares.length === 0) {
    historyListContainer.innerHTML = `
      <div class="empty-feed-box"><p>ไม่มีประวัติการอัปโหลดขณะนี้ 🌸</p></div>
    `;
    return;
  }

  historyListContainer.innerHTML = '';

  shares.forEach(item => {
    const rowEl = document.createElement('div');
    rowEl.className = 'history-item-row';

    const uploadTimeStr = new Date(item.created_at).toLocaleString('th-TH');
    const expiryTimeStr = new Date(item.expires_at).toLocaleString('th-TH');
    const isAccessed = accessedList.includes(item.id);
    const titleStr = item.file_name || item.content || 'Item';

    rowEl.innerHTML = `
      <div class="history-item-info">
        <span class="history-item-title">${escapeHtml(titleStr)}</span>
        <span class="history-item-meta">📅 อัปโหลด: ${uploadTimeStr}</span>
        <span class="history-item-meta">⏱️ ลบเมื่อ: ${expiryTimeStr}</span>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
        <span class="history-status-badge ${isAccessed ? 'badge-accessed' : 'badge-active'}">
          ${isAccessed ? '🟢 โหลดแล้ว' : '⚪ รอการโหลด'}
        </span>
        <button class="icon-btn-danger-outline delete-history-btn" style="padding: 3px 8px; font-size: 0.72rem;">
          🗑️
        </button>
      </div>
    `;

    rowEl.querySelector('.delete-history-btn').addEventListener('click', async () => {
      if (confirm('คุณต้องการลบรายการนี้ใช่หรือไม่?')) {
        await deleteShareRecordAndStorage(item.id, item.storage_path);
        showToast('🗑️ ลบรายการเรียบร้อยแล้ว');
        await openHistoryModal();
        await refreshAppFeed();
      }
    });

    historyListContainer.appendChild(rowEl);
  });
}

function closeHistoryModal() {
  historyModal.classList.add('hidden');
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

  refreshFeedBtn.addEventListener('click', () => {
    refreshAppFeed();
    showToast('🔄 Refreshed');
  });
}

// --- Refresh Cloud Feed & Storage % Bar ---
async function refreshAppFeed() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    liveFeedContainer.innerHTML = `
      <div class="empty-feed-box">
        <p>Please configure Supabase credentials in settings ⚙️</p>
      </div>
    `;
    return;
  }

  // 1. Storage Bar % Calculation
  try {
    const { totalBytes } = await getStorageUsageInfo();
    const TOTAL_CAPACITY = 1000 * 1024 * 1024; // 1,000 MB (1 GB)
    const percentage = Math.min(100, ((totalBytes / TOTAL_CAPACITY) * 100)).toFixed(1);

    storageUsageText.textContent = `${percentage}%`;
    storageProgressFill.style.width = `${percentage}%`;
  } catch (err) {
    console.error('Error calculating storage percentage:', err);
  }

  // 2. Render Cloud Feed Floating Items
  try {
    liveFeedContainer.innerHTML = `
      <div class="loading-spinner-box">
        <p>Loading...</p>
      </div>
    `;

    const sharesList = await getActiveSharesList();

    if (!sharesList || sharesList.length === 0) {
      liveFeedContainer.innerHTML = `
        <div class="empty-feed-box">
          <p>☁️ Cloud is empty. Upload a file or message below!</p>
        </div>
      `;
      return;
    }

    renderCloudItemBubbles(sharesList);
  } catch (err) {
    liveFeedContainer.innerHTML = `
      <div class="empty-feed-box">
        <p>Error loading items: ${err.message}</p>
      </div>
    `;
  }
}

// --- Render Floating Items in Cloud ---
function renderCloudItemBubbles(sharesList) {
  liveFeedContainer.innerHTML = '';

  sharesList.forEach(item => {
    const cardEl = document.createElement('div');
    cardEl.className = 'cloud-item-card';

    const isImage = item.file_name && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.file_name);
    const isFile = item.type === 'file' || item.type === 'both';
    const isUrl = item.content && /^https?:\/\/[^\s]+$/i.test(item.content.trim());

    let icon = '📝';
    if (isImage) icon = '🖼️';
    else if (isFile) icon = '📁';
    else if (isUrl) icon = '🔗';

    let displayTitle = item.file_name || item.content || 'Item';
    const expiryTime = new Date(item.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    cardEl.innerHTML = `
      <span class="cloud-item-icon">${icon}</span>
      <span class="cloud-item-title">${escapeHtml(displayTitle)}</span>
      <span class="cloud-item-meta">${expiryTime}</span>
    `;

    cardEl.addEventListener('click', () => {
      openItemPreviewModal(item);
    });

    liveFeedContainer.appendChild(cardEl);
  });
}

// --- Item Preview Modal Handlers ---
function initItemModal() {
  closeItemModalBtn.addEventListener('click', closeItemModal);
  itemModal.addEventListener('click', (e) => {
    if (e.target === itemModal) closeItemModal();
  });

  modalCopyBtn.addEventListener('click', () => {
    if (currentActiveItem && currentActiveItem.content) {
      markItemAsAccessed(currentActiveItem.id);
      navigator.clipboard.writeText(currentActiveItem.content).then(() => {
        showToast('📋 Copied to clipboard!');
      });
    }
  });

  modalDownloadBtn.addEventListener('click', () => {
    if (currentActiveItem) {
      markItemAsAccessed(currentActiveItem.id);
    }
  });

  modalShareBtn.addEventListener('click', () => {
    if (currentActiveItem) {
      const urlToShare = currentActiveItem.content || window.location.href;
      openQrModal(urlToShare);
    }
  });

  modalDeleteBtn.addEventListener('click', async () => {
    if (currentActiveItem && confirm('คุณต้องการลบรายการนี้ใช่หรือไม่?')) {
      await deleteShareRecordAndStorage(currentActiveItem.id, currentActiveItem.storage_path);
      showToast('🗑️ Deleted!');
      closeItemModal();
      await refreshAppFeed();
    }
  });
}

function openItemPreviewModal(item) {
  currentActiveItem = item;

  modalItemBadge.textContent = item.type === 'both' ? 'Message + File' : item.type === 'file' ? 'File' : 'Message / Link';
  
  modalPreviewArea.innerHTML = '';
  modalTextContent.classList.add('hidden');
  modalCopyBtn.classList.add('hidden');
  modalOpenLinkBtn.classList.add('hidden');
  modalDownloadBtn.classList.add('hidden');

  const isImage = item.file_name && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.file_name);
  const isFile = item.type === 'file' || item.type === 'both';
  const isUrl = item.content && /^https?:\/\/[^\s]+$/i.test(item.content.trim());

  // Image Preview Thumbnail
  if (isImage && item.content) {
    modalPreviewArea.innerHTML = `<img src="${item.content}" alt="preview" class="modal-img-preview" />`;
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
  if (isFile && item.content) {
    modalDownloadBtn.href = item.content;
    modalDownloadBtn.download = item.file_name || 'download';
    modalDownloadBtn.classList.remove('hidden');
  }

  itemModal.classList.remove('hidden');
}

function closeItemModal() {
  itemModal.classList.add('hidden');
  currentActiveItem = null;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- QR Modal Handlers ---
function initQrModal() {
  closeQrModalBtn.addEventListener('click', closeQrModal);
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) closeQrModal();
  });
}

function openQrModal(urlToEncode) {
  QRCode.toCanvas(qrModalCanvas, urlToEncode, {
    width: 160,
    margin: 1,
    color: {
      dark: '#7c3aed',
      light: '#ffffff'
    }
  }, (err) => {
    if (err) console.error('QR code error:', err);
  });

  qrModal.classList.remove('hidden');
}

function closeQrModal() {
  qrModal.classList.add('hidden');
}

// --- Settings Modal Handlers ---
function initSettingsModal() {
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
  cfgUrl.value = url;
  cfgKey.value = key;
  configModal.classList.remove('hidden');
}

function closeModalBtnHandler() {
  configModal.classList.add('hidden');
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
    pwaInstallBtn.classList.remove('hidden');
  });

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
