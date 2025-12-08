// popup.js - v3
// Popup interface logic with improved error handling

const CONFIG = {
  SCAN_TIMEOUT: 120000, // 2 minutes
  SUCCESS_DISPLAY_TIME: 3000,
  MOBBIN_DOMAIN: 'mobbin.com'
};

const elements = {
  logoImg: document.getElementById('app-logo'),
  logoText: document.getElementById('logo-text'),
  appName: document.getElementById('app-name'),
  btnScan: document.getElementById('btn-scan'),
  scanText: document.getElementById('scan-text'),
  scanSpinner: document.getElementById('scan-spinner'),
  btnDash: document.getElementById('btn-dashboard'),
  status: document.getElementById('status'),
  errorState: document.getElementById('error-state'),
  actionButtons: document.getElementById('action-buttons')
};

let currentTab = null;
let scanTimeout = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initializePopup();
  attachEventListeners();
});

/**
 * Initialize popup state
 */
async function initializePopup() {
  try {
    // Get current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];

    // Check if valid Mobbin page
    if (!currentTab.url || !currentTab.url.includes(CONFIG.MOBBIN_DOMAIN)) {
      showErrorState("Not a Mobbin page");
      return;
    }

    // Inject content script
    await injectContentScript();

    // Get page metadata
    const meta = await getPageMeta();
    if (meta && !meta.error) {
      updateUI(meta);
    } else {
      showErrorState("Could not read page data");
    }

  } catch (error) {
    console.error('Initialization error:', error);
    showErrorState("Failed to initialize");
  }
}

/**
 * Inject content script into page
 */
async function injectContentScript() {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['content.js']
    });
  } catch (error) {
    // Script might already be injected
    console.debug('Script injection:', error);
  }
}

/**
 * Get page metadata from content script
 */
function getPageMeta() {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      currentTab.id, 
      { action: "get_meta" }, 
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Meta fetch error:', chrome.runtime.lastError);
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      }
    );
  });
}

/**
 * Attach event listeners
 */
function attachEventListeners() {
  // Listen for progress updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "update_progress") {
      updateStatus(message.text, 'info');
    }
  });

  // Scan button
  elements.btnScan.addEventListener('click', handleScan);

  // Dashboard button
  elements.btnDash.addEventListener('click', () => {
    chrome.tabs.create({ url: "dashboard.html" });
  });
}

/**
 * Handle scan button click
 */
async function handleScan() {
  if (elements.btnScan.disabled) return;

  try {
    // Update UI to scanning state
    setScanning(true);
    updateStatus("Initializing scan...", 'info');

    // Set timeout for long scans
    scanTimeout = setTimeout(() => {
      updateStatus("Scan taking longer than expected...", 'warning');
    }, 30000); // 30 seconds

    // Start scrape
    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(
        currentTab.id,
        { action: "start_scrape" },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ 
              status: "error", 
              message: chrome.runtime.lastError.message 
            });
          } else {
            resolve(response);
          }
        }
      );
    });

    clearTimeout(scanTimeout);

    // Handle response
    if (response.status === "success") {
      const message = response.isUpdate 
        ? `Updated! ${response.count} screens saved.`
        : `Success! ${response.count} screens saved.`;
      
      updateStatus(message, 'success');
      elements.scanText.textContent = "✓ Complete";

      // Reset after delay
      setTimeout(() => {
        setScanning(false);
        elements.scanText.textContent = "Scan This App";
      }, CONFIG.SUCCESS_DISPLAY_TIME);

    } else if (response.status === "aborted") {
      updateStatus("Scan cancelled", 'warning');
      setScanning(false);
      
    } else {
      throw new Error(response.message || "Scan failed");
    }

  } catch (error) {
    console.error('Scan error:', error);
    clearTimeout(scanTimeout);
    updateStatus(error.message || "Scan failed. Please try again.", 'error');
    setScanning(false);
  }
}

/**
 * Set scanning UI state
 */
function setScanning(isScanning) {
  elements.btnScan.disabled = isScanning;
  elements.scanSpinner.style.display = isScanning ? 'inline-block' : 'none';
  
  if (isScanning) {
    elements.scanText.textContent = "Scanning...";
  }
}

/**
 * Update UI with page metadata
 */
function updateUI(meta) {
  if (meta.logo && meta.logo !== "" && !meta.logo.includes('placeholder')) {
    elements.logoImg.src = meta.logo;
    elements.logoImg.style.display = "block";
    elements.logoText.style.display = "none";
    
    // Handle broken images
    elements.logoImg.onerror = () => {
      elements.logoImg.style.display = "none";
      elements.logoText.style.display = "block";
      elements.logoText.textContent = meta.name.charAt(0).toUpperCase();
    };
  } else {
    elements.logoText.textContent = meta.name.charAt(0).toUpperCase();
  }
  
  if (meta.name) {
    elements.appName.textContent = meta.name;
  }
}

/**
 * Show error state
 */
function showErrorState(message) {
  elements.errorState.style.display = "block";
  elements.actionButtons.style.display = "none";
  elements.appName.textContent = message;
  
  // Still allow dashboard access
  elements.btnDash.style.display = "flex";
}

/**
 * Update status message
 */
function updateStatus(text, type = 'info') {
  elements.status.textContent = text;
  elements.status.className = `status-msg ${type}`;
}