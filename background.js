// background.js - v3
// Service worker for Chrome extension
// Handles background tasks and persistent state

// Configuration constants
const CONFIG = {
  NOTIFICATION_DURATION: 3000,
  MAX_STORAGE_SIZE_MB: 4.5 // Leave some buffer from 5MB limit
};

// Listen for installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Mobbin Vault installed successfully');
    // Open dashboard on first install
    chrome.tabs.create({ url: 'dashboard.html' });
  } else if (details.reason === 'update') {
    console.log('Mobbin Vault updated to version', chrome.runtime.getManifest().version);
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'update_progress') {
    // Forward progress updates (handled by popup.js)
    return false;
  }
  
  if (request.action === 'show_notification') {
    showNotification(request.message, request.type || 'info');
    return false;
  }
  
  if (request.action === 'check_storage') {
    checkStorageSize().then(result => {
      sendResponse(result);
    });
    return true; // Async response
  }
});

// Show notification helper
function showNotification(message, type = 'info') {
  const iconMap = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: 'Mobbin Vault',
    message: `${iconMap[type] || ''} ${message}`,
    priority: 2
  });
}

// Check storage usage
async function checkStorageSize() {
  try {
    const bytesInUse = await chrome.storage.local.getBytesInUse();
    const mbInUse = (bytesInUse / (1024 * 1024)).toFixed(2);
    const percentUsed = ((bytesInUse / (5 * 1024 * 1024)) * 100).toFixed(1);
    
    return {
      bytesInUse,
      mbInUse,
      percentUsed,
      nearLimit: percentUsed > 80
    };
  } catch (error) {
    console.error('Failed to check storage:', error);
    return { error: error.message };
  }
}