// popup.js - v3 (FIXED)
// Popup interface logic with improved error handling and content script injection

const CONFIG = {
  SCAN_TIMEOUT: 120000, // 2 minutes
  SUCCESS_DISPLAY_TIME: 3000,
  MOBBIN_DOMAIN: 'mobbin.com',
  INJECTION_RETRY_DELAY: 500,
  MAX_INJECTION_RETRIES: 3
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

    // Check if page is still loading
    if (currentTab.status === 'loading') {
      updateStatus("Waiting for page to load...", 'info');
      await waitForPageLoad();
    }

    // Inject content script with retry
    const injected = await injectContentScriptWithRetry();
    if (!injected) {
      showErrorState("Failed to connect to page");
      updateStatus("Try refreshing the page", 'error');
      return;
    }

    // Get page metadata
    const meta = await getPageMetaWithRetry();
    if (meta && !meta.error) {
      updateUI(meta);
      updateStatus("Ready to scan", 'success');
    } else {
      showErrorState("Could not read page data");
      updateStatus("Page may not be fully loaded", 'warning');
    }

  } catch (error) {
    console.error('Initialization error:', error);
    showErrorState("Failed to initialize");
    updateStatus(error.message || "Unknown error", 'error');
  }
}

/**
 * Wait for page to finish loading
 */
function waitForPageLoad() {
  return new Promise((resolve) => {
    const checkInterval = setInterval(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.status === 'complete') {
        clearInterval(checkInterval);
        currentTab = tab;
        resolve();
      }
    }, 100);

    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 10000);
  });
}

/**
 * Inject content script with retry logic
 */
async function injectContentScriptWithRetry() {
  for (let attempt = 0; attempt < CONFIG.MAX_INJECTION_RETRIES; attempt++) {
    try {
      // First, check if content script is already injected
      const isInjected = await checkContentScriptInjected();
      if (isInjected) {
        console.log('Content script already injected');
        return true;
      }

      // Try to inject
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ['content.js']
      });

      // Wait a bit for script to initialize
      await sleep(CONFIG.INJECTION_RETRY_DELAY);

      // Verify injection worked
      const verified = await checkContentScriptInjected();
      if (verified) {
        console.log('Content script injected successfully');
        return true;
      }

    } catch (error) {
      console.warn(`Injection attempt ${attempt + 1} failed:`, error);
      
      // If it's a "Cannot access" error, the page is restricted
      if (error.message && error.message.includes('Cannot access')) {
        console.error('Cannot inject into this page (restricted)');
        return false;
      }

      if (attempt < CONFIG.MAX_INJECTION_RETRIES - 1) {
        await sleep(CONFIG.INJECTION_RETRY_DELAY * (attempt + 1));
      }
    }
  }

  console.error('All injection attempts failed');
  return false;
}

/**
 * Check if content script is already injected
 */
function checkContentScriptInjected() {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      currentTab.id,
      { action: "ping" },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

/**
 * Get page metadata with retry
 */
async function getPageMetaWithRetry() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const meta = await getPageMeta();
      if (meta && !meta.error) {
        return meta;
      }
    } catch (error) {
      console.warn(`Meta fetch attempt ${attempt + 1} failed:`, error);
      if (attempt < 2) {
        await sleep(300);
      }
    }
  }
  return { error: "Failed to fetch metadata" };
}

/**
 * Get page metadata from content script
 */
function getPageMeta() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ error: "Timeout" });
    }, 5000);

    chrome.tabs.sendMessage(
      currentTab.id,
      { action: "get_meta" },
      (response) => {
        clearTimeout(timeout);
        
        if (chrome.runtime.lastError) {
          console.error('Meta fetch error:', chrome.runtime.lastError);
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { error: "No response" });
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

  // Dashboard button - ALWAYS enabled
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

    // Verify content script is still available
    const isAvailable = await checkContentScriptInjected();
    if (!isAvailable) {
      throw new Error("Lost connection to page. Try refreshing.");
    }

    // Set timeout for long scans
    scanTimeout = setTimeout(() => {
      updateStatus("Scan taking longer than expected...", 'warning');
    }, 30000); // 30 seconds

    // Start scrape with timeout
    const response = await Promise.race([
      sendScrapeMessage(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Scan timeout - page may be too large")), CONFIG.SCAN_TIMEOUT)
      )
    ]);

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
 * Send scrape message to content script
 */
function sendScrapeMessage() {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      currentTab.id,
      { action: "start_scrape" },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response) {
          reject(new Error("No response from content script"));
        } else {
          resolve(response);
        }
      }
    );
  });
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
  
  // Disable scan button but keep dashboard button always enabled
  elements.btnScan.disabled = true;
}

/**
 * Update status message
 */
function updateStatus(text, type = 'info') {
  elements.status.textContent = text;
  elements.status.className = `status-msg ${type}`;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}