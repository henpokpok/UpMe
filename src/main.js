import QRCode from 'qrcode';
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  createTextShare,
  createFileShare,
  getShareByCode,
  deleteShareRecordAndStorage
} from './supabase.js';

// Application State
let selectedType = 'text'; // 'text' | 'file'
let selectedFile = null;
let deferredPwaPrompt = null;

// DOM Elements
const typeBtns = document.querySelectorAll('.type-btn');

const textInputGroup = document.getElementById('text-input-group');
const fileInputGroup = document.getElementById('file-input-group');
const textContent = document.getElementById('text-content');
const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');
const filePreview = document.getElementById('file-preview');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const removeFileBtn = document.getElementById('remove-file-btn');

const shareForm = document.getElementById('share-form');
const expirySelect = document.getElementById('expiry-select');
const oneTimeToggle = document.getElementById('one-time-toggle');
const submitShareBtn = document.getElementById('submit-share-btn');

const shareResult = document.getElementById('share-result');
const resultPasscode = document.getElementById('result-passcode');
const resultUrl = document.getElementById('result-url');
const qrCanvas = document.getElementById('qr-canvas');
const copyCodeBtn = document.getElementById('copy-code-btn');
const copyUrlBtn = document.getElementById('copy-url-btn');
const createAnotherBtn = document.getElementById('create-another-btn');

const receiveForm = document.getElementById('receive-form');
const receiveCodeInput = document.getElementById('receive-code-input');
const retrieveBtn = document.getElementById('retrieve-btn');
const receiveOutput = document.getElementById('receive-output');
const receiveError = document.getElementById('receive-error');
const errorMessage = document.getElementById('error-message');
const receiveSection = document.getElementById('receive-section');

const settingsBtn = document.getElementById('settings-btn');
const configModal = document.getElementById('config-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const cfgUrl = document.getElementById('cfg-url');
const cfgKey = document.getElementById('cfg-key');

const pwaInstallBtn = document.getElementById('pwa-install-btn');
const toast = document.getElementById('toast');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTypeSelector();
  initDropzone();
  initForms();
  initSettingsModal();
  initPWA();
  checkUrlQueryParams();
});

// --- Toast Notification Helper ---
function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

// --- Formatting Helpers ---
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- Content Type Toggle (Text vs File) ---
function initTypeSelector() {
  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      typeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.getAttribute('data-type');

      if (selectedType === 'text') {
        textInputGroup.classList.remove('hidden');
        fileInputGroup.classList.add('hidden');
        textContent.required = true;
      } else {
        textInputGroup.classList.add('hidden');
        fileInputGroup.classList.remove('hidden');
        textContent.required = false;
      }
    });
  });
}

// --- Drag & Drop File Upload Handlers ---
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

// --- Form Submissions & Logic ---
function initForms() {
  // Sender Form Submit
  shareForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      openSettingsModal();
      showToast('⚠️ กรุณาตั้งค่า Supabase URL และ Anon Key ก่อนนะจ๊ะ');
      return;
    }

    const durationKey = expirySelect.value;
    const oneTimeDownload = oneTimeToggle.checked;

    try {
      submitShareBtn.disabled = true;
      submitShareBtn.innerHTML = `<span>⏳ กำลังอัปโหลดและสร้างรหัส...</span>`;

      let result;
      if (selectedType === 'text') {
        const textVal = textContent.value.trim();
        if (!textVal) throw new Error('กรุณาระบุข้อความหรือลิงก์ก่อนส่งนะจ๊ะ');
        result = await createTextShare({ content: textVal, durationKey, oneTimeDownload });
      } else {
        if (!selectedFile) throw new Error('กรุณาเลือกไฟล์ที่ต้องการส่งก่อนนะจ๊ะ');
        result = await createFileShare({ file: selectedFile, durationKey, oneTimeDownload });
      }

      // Display Share Result
      showShareResult(result);
    } catch (err) {
      showToast(`❌ ${err.message}`);
    } finally {
      submitShareBtn.disabled = false;
      submitShareBtn.innerHTML = `<span>💖 สร้างรหัสส่งของ (Generate Passcode)</span>`;
    }
  });

  // Create Another Item Button
  createAnotherBtn.addEventListener('click', () => {
    shareResult.classList.add('hidden');
    shareForm.classList.remove('hidden');
    textContent.value = '';
    selectedFile = null;
    fileInput.value = '';
    filePreview.classList.add('hidden');
    dropzone.querySelector('.dropzone-content').classList.remove('hidden');
  });

  // Copy Code & Copy URL
  copyCodeBtn.addEventListener('click', () => {
    const code = resultPasscode.textContent;
    navigator.clipboard.writeText(code).then(() => {
      showToast('📋 คัดลอกรหัสผ่านเรียบร้อยแล้วจ้า 🐰✨');
    });
  });

  copyUrlBtn.addEventListener('click', () => {
    const url = resultUrl.value;
    navigator.clipboard.writeText(url).then(() => {
      showToast('🔗 คัดลอกลิงก์ตรงเรียบร้อยแล้วจ้า ✨');
    });
  });

  // Receiver Form Submit
  receiveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = receiveCodeInput.value.trim();
    if (!code) return;

    await executeRetrieval(code);
  });
}

function showShareResult(result) {
  shareForm.classList.add('hidden');
  shareResult.classList.remove('hidden');

  resultPasscode.textContent = result.code;

  // Build direct share URL with passcode embedded in query parameter
  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${result.code}`;
  resultUrl.value = shareUrl;

  // Render Pastel Cute QR Code onto Canvas
  QRCode.toCanvas(qrCanvas, shareUrl, {
    width: 120,
    margin: 1,
    color: {
      dark: '#7c3aed',
      light: '#ffffff'
    }
  }, (err) => {
    if (err) console.error('QR code generation error:', err);
  });
}

// --- Receiver Retrieval Logic ---
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

    // Render output card based on share type
    renderShareOutput(shareItem);

    // One-Time Download deletion handling
    if (shareItem.one_time_download) {
      showToast('🔥 ระบบลบข้อมูลรายการนี้ออกจากเซิร์ฟเวอร์เรียบร้อยแล้ว ตามการตั้งค่าลบหลังรับ!');
      deleteShareRecordAndStorage(shareItem.id, shareItem.storage_path);
    }

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

  if (item.type === 'text') {
    const isUrl = /^https?:\/\/[^\s]+$/i.test(item.content.trim());

    receiveOutput.innerHTML = `
      <div class="output-card">
        <div class="output-header">
          <span class="output-type-tag">📝 ข้อความ / ลิงก์</span>
          <span class="output-expiry-tag">หมดอายุ: ${formattedExpiry}</span>
        </div>
        <div class="output-text-content">${escapeHtml(item.content)}</div>
        <div class="output-actions" style="display: flex; flex-direction: column; gap: 8px;">
          <button id="copy-text-btn" class="primary-btn" style="width: 100%;">
            <span>📋 คัดลอกข้อความ</span>
          </button>
          ${isUrl ? `
            <a href="${escapeHtml(item.content)}" target="_blank" rel="noopener noreferrer" class="secondary-btn" style="text-align: center; text-decoration: none; display: block;">
              🔗 เปิดลิงก์ในแท็บใหม่
            </a>
          ` : ''}
        </div>
      </div>
    `;

    document.getElementById('copy-text-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(item.content).then(() => {
        showToast('📋 คัดลอกข้อความเรียบร้อยแล้วจ้า 🐰✨');
      });
    });
  } else {
    // File Share Output
    const fileName = item.file_name || 'ไฟล์ที่ได้รับ';
    const fileSizeStr = item.file_size ? formatBytes(item.file_size) : '';

    receiveOutput.innerHTML = `
      <div class="output-card">
        <div class="output-header">
          <span class="output-type-tag">📁 ไฟล์แนบ</span>
          <span class="output-expiry-tag">หมดอายุ: ${formattedExpiry}</span>
        </div>
        <div class="file-output-box">
          <span class="file-output-icon">🎁</span>
          <div class="file-output-details">
            <span class="file-output-title">${escapeHtml(fileName)}</span>
            ${fileSizeStr ? `<span class="file-size">${fileSizeStr}</span>` : ''}
          </div>
        </div>
        <a href="${item.content}" download="${escapeHtml(fileName)}" target="_blank" class="primary-btn" style="text-decoration: none; text-align: center;">
          <span>🌸 ดาวน์โหลดไฟล์</span>
        </a>
      </div>
    `;
  }
}

function escapeHtml(str) {
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
    receiveSection.scrollIntoView({ behavior: 'smooth' });
    executeRetrieval(codeParam);
  }
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
