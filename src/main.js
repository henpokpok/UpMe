import QRCode from 'qrcode';
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  createShareItem,
  getActiveSharesList,
  getShareByCode,
  deleteShareRecordAndStorage,
  getStorageUsageInfo
} from './supabase.js';

// Application State
let selectedFile = null;
let selectedDurationKey = '24h'; // Default '24h'
let deferredPwaPrompt = null;

// DOM Elements
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

const receiveForm = document.getElementById('receive-form');
const receiveCodeInput = document.getElementById('receive-code-input');
const retrieveBtn = document.getElementById('retrieve-btn');
const receiveOutput = document.getElementById('receive-output');
const receiveError = document.getElementById('receive-error');
const errorMessage = document.getElementById('error-message');

const settingsBtn = document.getElementById('settings-btn');
const configModal = document.getElementById('config-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const cfgUrl = document.getElementById('cfg-url');
const cfgKey = document.getElementById('cfg-key');

const qrModal = document.getElementById('qr-modal');
const closeQrModalBtn = document.getElementById('close-qr-modal-btn');
const qrModalCanvas = document.getElementById('qr-modal-canvas');
const qrModalPasscode = document.getElementById('qr-modal-passcode');

const pwaInstallBtn = document.getElementById('pwa-install-btn');
const toast = document.getElementById('toast');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initPills();
  initDropzone();
  initForms();
  initSettingsModal();
  initQrModal();
  initPWA();
  
  // Load storage quota info and live feed items
  refreshAppFeed();
  checkUrlQueryParams();
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

// --- Forms & Upload Submissions ---
function initForms() {
  // Share Form Submit
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
      submitShareBtn.innerHTML = `<span>⏳ กำลังอัปโหลด...</span>`;

      const result = await createShareItem({
        textContent: textVal,
        file: selectedFile,
        durationKey: selectedDurationKey
      });

      showToast('🎉 อัปโหลดและแชร์รายการเรียบร้อยแล้ว!');

      // Clear input fields
      textContent.value = '';
      selectedFile = null;
      fileInput.value = '';
      filePreview.classList.add('hidden');
      dropzone.querySelector('.dropzone-content').classList.remove('hidden');

      // Refresh Live Feed & Storage Bar
      await refreshAppFeed();
    } catch (err) {
      showToast(`❌ ${err.message}`);
    } finally {
      submitShareBtn.disabled = false;
      submitShareBtn.innerHTML = `<span>💖 อัปโหลด & แชร์รายการ</span>`;
    }
  });

  // Manual Feed Refresh Button
  refreshFeedBtn.addEventListener('click', () => {
    refreshAppFeed();
    showToast('🔄 รีเฟรชรายการเรียบร้อยแล้ว');
  });

  // Receiver Form Submit
  receiveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = receiveCodeInput.value.trim();
    if (!code) return;

    await executeRetrieval(code);
  });
}

// --- Refresh App Live Feed & Storage Quota ---
async function refreshAppFeed() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    liveFeedContainer.innerHTML = `
      <div class="empty-feed-box">
        <span class="empty-emoji">⚙️</span>
        <p>กรุณากดไอคอนตั้งค่าด้านบนเพื่อเชื่อมต่อ Supabase ก่อนใช้งานนะจ๊ะ</p>
      </div>
    `;
    return;
  }

  // 1. Update Storage Usage Bar
  try {
    const { totalBytes, activeCount } = await getStorageUsageInfo();
    const TOTAL_CAPACITY = 1000 * 1024 * 1024; // 1,000 MB (1 GB)
    const percentage = Math.min(100, ((totalBytes / TOTAL_CAPACITY) * 100).toFixed(1));

    storageUsageText.textContent = `${formatBytes(totalBytes)} / 1,000 MB (${activeCount} รายการ)`;
    storageProgressFill.style.width = `${percentage}%`;
  } catch (err) {
    console.error('Error updating storage usage:', err);
  }

  // 2. Fetch Active Shares Feed
  try {
    liveFeedContainer.innerHTML = `
      <div class="loading-spinner-box">
        <span class="loading-emoji">⏳</span>
        <p>กำลังโหลดรายการล่าสุดของคุณ...</p>
      </div>
    `;

    const sharesList = await getActiveSharesList();

    if (!sharesList || sharesList.length === 0) {
      liveFeedContainer.innerHTML = `
        <div class="empty-feed-box">
          <span class="empty-emoji">🌸</span>
          <p>ยังไม่มีรายการที่แชร์อยู่ ลองพิมพ์ข้อความหรืออัปโหลดไฟล์ด้านบนได้เลยจ้า!</p>
        </div>
      `;
      return;
    }

    renderLiveFeedCards(sharesList);
  } catch (err) {
    liveFeedContainer.innerHTML = `
      <div class="empty-feed-box">
        <span class="empty-emoji">😿</span>
        <p>ไม่สามารถโหลดรายการได้: ${err.message}</p>
      </div>
    `;
  }
}

// --- Render Feed Cards ---
function renderLiveFeedCards(sharesList) {
  liveFeedContainer.innerHTML = '';

  sharesList.forEach(item => {
    const cardEl = document.createElement('div');
    cardEl.className = 'feed-card';

    const formattedExpiry = new Date(item.expires_at).toLocaleString('th-TH');
    const isUrl = item.content && /^https?:\/\/[^\s]+$/i.test(item.content.trim());
    const isFile = item.type === 'file' || item.type === 'both';

    let cardBodyHtml = '';
    
    // Text Content render
    if (item.content && (item.type === 'text' || item.type === 'both')) {
      cardBodyHtml += `<div class="feed-card-content">${escapeHtml(item.content)}</div>`;
    }

    // File Content render
    if (isFile && item.storage_path) {
      const fileNameStr = item.file_name || 'ไฟล์แนบ';
      const fileSizeStr = item.file_size ? formatBytes(item.file_size) : '';

      cardBodyHtml += `
        <div class="feed-file-box">
          <span class="feed-file-icon">🎁</span>
          <div class="feed-file-details">
            <span class="feed-file-name">${escapeHtml(fileNameStr)}</span>
            ${fileSizeStr ? `<span class="file-size">${fileSizeStr}</span>` : ''}
          </div>
        </div>
      `;
    }

    cardEl.innerHTML = `
      <div class="feed-card-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="feed-card-type-badge">${item.type === 'both' ? '📝+📁 ข้อความและไฟล์' : item.type === 'file' ? '📁 ไฟล์แนบ' : '📝 ข้อความ/ลิงก์'}</span>
          <span class="passcode-pill">Code: ${item.code}</span>
        </div>
        <span class="feed-card-expiry">หมดอายุ: ${formattedExpiry}</span>
      </div>

      ${cardBodyHtml}

      <div class="feed-card-actions">
        ${item.content && !isFile ? `
          <button class="secondary-btn copy-text-btn">📋 คัดลอกข้อความ</button>
        ` : ''}

        ${isUrl ? `
          <a href="${escapeHtml(item.content)}" target="_blank" rel="noopener noreferrer" class="secondary-btn" style="text-decoration: none;">
            🔗 เปิดลิงก์
          </a>
        ` : ''}

        ${isFile ? `
          <a href="${item.content}" download="${escapeHtml(item.file_name || 'file')}" target="_blank" class="primary-btn" style="text-decoration: none; padding: 6px 16px; font-size: 0.85rem;">
            🌸 ดาวน์โหลดไฟล์
          </a>
        ` : ''}

        <button class="secondary-btn open-qr-btn" data-code="${item.code}">📱 QR Code</button>

        <button class="icon-btn-danger-outline delete-item-btn" style="margin-left: auto;">
          🗑️ ลบรายการ
        </button>
      </div>
    `;

    // Event Handlers for Card Buttons
    const copyBtn = cardEl.querySelector('.copy-text-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(item.content).then(() => {
          showToast('📋 คัดลอกข้อความเรียบร้อยแล้วจ้า 🐰✨');
        });
      });
    }

    const qrBtn = cardEl.querySelector('.open-qr-btn');
    if (qrBtn) {
      qrBtn.addEventListener('click', () => {
        openQrModal(item.code);
      });
    }

    const deleteBtn = cardEl.querySelector('.delete-item-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (confirm('คุณต้องการลบรายการนี้ใช่หรือไม่?')) {
          await deleteShareRecordAndStorage(item.id, item.storage_path);
          showToast('🗑️ ลบรายการเรียบร้อยแล้ว');
          await refreshAppFeed();
        }
      });
    }

    liveFeedContainer.appendChild(cardEl);
  });
}

// --- Receiver Passcode Retrieval (Fallback) ---
async function executeRetrieval(code) {
  receiveError.classList.add('hidden');
  receiveOutput.classList.add('hidden');
  receiveOutput.innerHTML = '';

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    openSettingsModal();
    showToast('⚠️ กรุณาตั้งค่า Supabase ก่อนดึงข้อมูลนะจ๊ะ');
    return;
  }

  try {
    retrieveBtn.disabled = true;
    retrieveBtn.querySelector('span').textContent = '⏳ กำลังค้นหา...';

    const shareItem = await getShareByCode(code);

    if (!shareItem) {
      errorMessage.textContent = 'รหัสผ่านไม่ถูกต้อง หรือรายการนี้หมดอายุไปแล้วจ้า 😿';
      receiveError.classList.remove('hidden');
      return;
    }

    renderShareOutput(shareItem);
  } catch (err) {
    errorMessage.textContent = err.message || 'รหัสผ่านไม่ถูกต้อง หรือหมดอายุแล้วจ้า 😿';
    receiveError.classList.remove('hidden');
  } finally {
    retrieveBtn.disabled = false;
    retrieveBtn.querySelector('span').textContent = '🐰 รับข้อมูล';
  }
}

function renderShareOutput(item) {
  receiveOutput.classList.remove('hidden');

  const formattedExpiry = new Date(item.expires_at).toLocaleString('th-TH');
  const isUrl = item.content && /^https?:\/\/[^\s]+$/i.test(item.content.trim());
  const isFile = item.type === 'file' || item.type === 'both';

  receiveOutput.innerHTML = `
    <div class="output-card">
      <div class="output-header">
        <span class="output-type-tag">ผลการค้นหารหัส: ${item.code}</span>
        <span class="output-expiry-tag">หมดอายุ: ${formattedExpiry}</span>
      </div>
      ${item.content ? `<div class="output-text-content">${escapeHtml(item.content)}</div>` : ''}
      ${isFile ? `
        <a href="${item.content}" download="${escapeHtml(item.file_name || 'file')}" target="_blank" class="primary-btn" style="text-decoration: none; text-align: center;">
          🌸 ดาวน์โหลดไฟล์
        </a>
      ` : ''}
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- Check URL Query Params (e.g. ?code=123456) ---
function checkUrlQueryParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('code');
  if (codeParam) {
    receiveCodeInput.value = codeParam;
    receiveForm.scrollIntoView({ behavior: 'smooth' });
    executeRetrieval(codeParam);
  }
}

// --- QR Modal Handlers ---
function initQrModal() {
  closeQrModalBtn.addEventListener('click', closeQrModal);
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) closeQrModal();
  });
}

function openQrModal(code) {
  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${code}`;
  qrModalPasscode.textContent = code;

  QRCode.toCanvas(qrModalCanvas, shareUrl, {
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
  closeModalBtn.addEventListener('click', closeSettingsModal);

  configModal.addEventListener('click', (e) => {
    if (e.target === configModal) closeSettingsModal();
  });

  saveConfigBtn.addEventListener('click', () => {
    const url = cfgUrl.value.trim();
    const key = cfgKey.value.trim();
    if (!url || !key) {
      showToast('❌ กรุณากรอกทั้ง URL และ Anon Key นะจ๊ะ');
      return;
    }
    saveSupabaseConfig(url, key);
    showToast('💖 บันทึกการตั้งค่า Supabase เรียบร้อยแล้ว!');
    closeSettingsModal();
    refreshAppFeed();
  });
}

function openSettingsModal() {
  const { url, key } = getSupabaseConfig();
  cfgUrl.value = url;
  cfgKey.value = key;
  configModal.classList.remove('hidden');
}

function closeSettingsModal() {
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
