// dashboard.js - v3
// Dashboard interface with search, sort, and keyboard shortcuts

let appsData = [];
let filteredApps = [];
let currentApp = null;
let currentImage = null;
let currentSort = 'recent';
let currentSearch = '';

const elements = {
  views: {
    library: document.getElementById('view-library'),
    detail: document.getElementById('view-detail')
  },
  title: document.getElementById('page-title'),
  appCount: document.getElementById('app-count'),
  libraryControls: document.getElementById('library-controls'),
  detailActions: document.getElementById('detail-actions'),
  sidebar: document.getElementById('preview-sidebar'),
  overlay: document.getElementById('overlay'),
  searchInput: document.getElementById('search-input'),
  clearSearch: document.getElementById('clear-search'),
  sortSelect: document.getElementById('sort-select'),
  libraryGrid: document.getElementById('library-grid'),
  loadingState: document.getElementById('loading-state'),
  emptyState: document.getElementById('empty-state'),
  noResultsState: document.getElementById('no-results-state'),
  screensLoading: document.getElementById('screens-loading'),
  storageUsed: document.getElementById('storage-used'),
  storageProgress: document.getElementById('storage-progress')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  attachEventListeners();
  setupKeyboardShortcuts();
  updateStorageInfo();
});

/**
 * Load data from storage
 */
async function loadData() {
  try {
    showLoading(true);
    
    const result = await chrome.storage.local.get("apps");
    appsData = result.apps || [];
    filteredApps = [...appsData];
    
    applySortAndFilter();
    renderLibrary();
    
  } catch (error) {
    console.error('Failed to load data:', error);
    showToast('Failed to load apps', 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Attach event listeners
 */
function attachEventListeners() {
  // Navigation
  document.getElementById('btn-back').addEventListener('click', showLibrary);
  document.getElementById('nav-library').addEventListener('click', showLibrary);
  
  // Search
  elements.searchInput.addEventListener('input', handleSearch);
  elements.clearSearch.addEventListener('click', clearSearch);
  document.getElementById('btn-clear-search')?.addEventListener('click', clearSearch);
  
  // Sort
  elements.sortSelect.addEventListener('change', handleSort);
  
  // Clear all data
  document.getElementById('btn-clear').addEventListener('click', handleClearAll);
  
  // Delete current app
  document.getElementById('btn-delete-app').addEventListener('click', handleDeleteApp);
  
  // Sidebar / Preview
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  elements.overlay.addEventListener('click', closeSidebar);
  
  // Downloads
  document.getElementById('btn-download-current').addEventListener('click', () => {
    if (currentImage) downloadImage(currentImage);
  });
  
  document.getElementById('btn-download-all').addEventListener('click', handleDownloadAll);
  
  // Open Mobbin
  document.getElementById('btn-open-mobbin')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://mobbin.com' });
  });
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // ESC - Close sidebar or go back
    if (e.key === 'Escape') {
      if (elements.sidebar.classList.contains('open')) {
        closeSidebar();
      } else if (!elements.views.library.classList.contains('hidden')) {
        // In library view, clear search if active
        if (currentSearch) {
          clearSearch();
        }
      } else {
        showLibrary();
      }
    }
    
    // Ctrl/Cmd + K - Focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      elements.searchInput.focus();
    }
    
    // Ctrl/Cmd + Backspace - Delete current app (with confirmation)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace' && currentApp) {
      e.preventDefault();
      handleDeleteApp();
    }
  });
}

/**
 * Handle search input
 */
function handleSearch(e) {
  currentSearch = e.target.value.toLowerCase().trim();
  
  // Show/hide clear button
  elements.clearSearch.style.display = currentSearch ? 'block' : 'none';
  
  applySortAndFilter();
  renderLibrary();
}

/**
 * Clear search
 */
function clearSearch() {
  currentSearch = '';
  elements.searchInput.value = '';
  elements.clearSearch.style.display = 'none';
  
  applySortAndFilter();
  renderLibrary();
}

/**
 * Handle sort change
 */
function handleSort(e) {
  currentSort = e.target.value;
  applySortAndFilter();
  renderLibrary();
}

/**
 * Apply sorting and filtering
 */
function applySortAndFilter() {
  // Filter
  if (currentSearch) {
    filteredApps = appsData.filter(app => 
      app.name.toLowerCase().includes(currentSearch)
    );
  } else {
    filteredApps = [...appsData];
  }
  
  // Sort
  filteredApps.sort((a, b) => {
    switch(currentSort) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'screens':
        return b.screenCount - a.screenCount;
      case 'recent':
      default:
        return (b.dateAdded || 0) - (a.dateAdded || 0);
    }
  });
}

/**
 * Show loading state
 */
function showLoading(show) {
  elements.loadingState.style.display = show ? 'flex' : 'none';
  elements.libraryGrid.style.display = show ? 'none' : 'grid';
}

/**
 * Render library grid
 */
function renderLibrary() {
  const grid = elements.libraryGrid;
  grid.innerHTML = '';
  
  // Update app count
  elements.appCount.textContent = `${appsData.length} app${appsData.length !== 1 ? 's' : ''}`;
  
  // Show appropriate state
  if (appsData.length === 0) {
    elements.emptyState.classList.remove('hidden');
    elements.noResultsState.classList.add('hidden');
    grid.style.display = 'none';
    return;
  }
  
  if (filteredApps.length === 0) {
    elements.emptyState.classList.add('hidden');
    elements.noResultsState.classList.remove('hidden');
    document.getElementById('search-query-text').textContent = 
      `No results for "${currentSearch}"`;
    grid.style.display = 'none';
    return;
  }
  
  // Hide empty states
  elements.emptyState.classList.add('hidden');
  elements.noResultsState.classList.add('hidden');
  grid.style.display = 'grid';
  
  // Render cards
  filteredApps.forEach(app => {
    const card = createAppCard(app);
    grid.appendChild(card);
  });
}

/**
 * Create app card element
 */
function createAppCard(app) {
  const card = document.createElement('div');
  card.className = 'app-card';
  
  const logoSrc = app.logo || `https://via.placeholder.com/100?text=${encodeURIComponent(app.name.charAt(0))}`;
  
  const dateStr = app.dateAdded 
    ? formatDate(app.dateAdded) 
    : 'Recently';
  
  card.innerHTML = `
    <img class="app-logo" src="${sanitizeUrl(logoSrc)}" loading="lazy" alt="${sanitizeText(app.name)}">
    <div class="app-title">${sanitizeText(app.name)}</div>
    <div class="app-meta">
      <span>${app.screenCount} screen${app.screenCount !== 1 ? 's' : ''}</span>
      <span class="separator">•</span>
      <span>${dateStr}</span>
    </div>
  `;
  
  card.addEventListener('click', () => openDetail(app));
  
  return card;
}

/**
 * Show library view
 */
function showLibrary() {
  elements.views.library.classList.remove('hidden');
  elements.views.detail.classList.add('hidden');
  elements.libraryControls.classList.remove('hidden');
  elements.detailActions.classList.add('hidden');
  elements.title.textContent = "Library";
  elements.appCount.style.display = 'inline';
  
  document.getElementById('nav-library').classList.add('active');
  
  currentApp = null;
  closeSidebar();
}

/**
 * Open detail view
 */
async function openDetail(app) {
  currentApp = app;
  
  // Update header
  elements.views.library.classList.add('hidden');
  elements.views.detail.classList.remove('hidden');
  elements.libraryControls.classList.add('hidden');
  elements.detailActions.classList.remove('hidden');
  elements.title.textContent = "App Details";
  elements.appCount.style.display = 'none';
  document.getElementById('nav-library').classList.remove('active');

  // Update detail view metadata
  document.getElementById('detail-name').textContent = sanitizeText(app.name);
  document.getElementById('detail-count').textContent = 
    `${app.screenCount} screen${app.screenCount !== 1 ? 's' : ''}`;
  document.getElementById('detail-date').textContent = 
    `Added ${formatDate(app.dateAdded)}`;
  
  const logoSrc = app.logo || `https://via.placeholder.com/100?text=${encodeURIComponent(app.name.charAt(0))}`;
  document.getElementById('detail-logo').src = sanitizeUrl(logoSrc);
  
  // Show loading state for screens
  elements.screensLoading.style.display = 'flex';
  const grid = document.getElementById('detail-grid');
  grid.innerHTML = '';
  grid.style.display = 'none';
  
  // Simulate async loading (in real app, this could be progressive image loading)
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Render screens
  renderScreens(app.screens);
  
  elements.screensLoading.style.display = 'none';
  grid.style.display = 'grid';
}

/**
 * Render screens grid
 */
function renderScreens(screens) {
  const grid = document.getElementById('detail-grid');
  
  screens.forEach((url, index) => {
    const item = document.createElement('div');
    item.className = 'screen-item';
    
    const img = document.createElement('img');
    img.src = sanitizeUrl(url);
    img.loading = "lazy";
    img.alt = `Screen ${index + 1}`;
    
    // Handle image load errors
    img.onerror = () => {
      item.classList.add('error');
      img.src = 'https://via.placeholder.com/400x800?text=Failed+to+Load';
    };
    
    item.appendChild(img);
    item.addEventListener('click', () => openSidebar(url));
    grid.appendChild(item);
  });
}

/**
 * Open preview sidebar
 */
function openSidebar(url) {
  currentImage = url;
  document.getElementById('sidebar-image').src = sanitizeUrl(url);
  elements.sidebar.classList.add('open');
  elements.overlay.classList.add('visible');
}

/**
 * Close preview sidebar
 */
function closeSidebar() {
  elements.sidebar.classList.remove('open');
  elements.overlay.classList.remove('visible');
}

/**
 * Handle clear all data
 */
async function handleClearAll() {
  const confirmed = confirm(
    `Are you sure you want to delete all ${appsData.length} apps?\n\nThis cannot be undone.`
  );
  
  if (!confirmed) return;
  
  try {
    await chrome.storage.local.clear();
    appsData = [];
    filteredApps = [];
    renderLibrary();
    updateStorageInfo();
    showToast('All data cleared', 'success');
  } catch (error) {
    console.error('Failed to clear data:', error);
    showToast('Failed to clear data', 'error');
  }
}

/**
 * Handle delete current app
 */
async function handleDeleteApp() {
  if (!currentApp) return;
  
  const confirmed = confirm(
    `Delete "${currentApp.name}"?\n\nThis will remove ${currentApp.screenCount} screens.`
  );
  
  if (!confirmed) return;
  
  try {
    // Remove from array
    appsData = appsData.filter(app => app.id !== currentApp.id);
    
    // Save to storage
    await chrome.storage.local.set({ apps: appsData });
    
    // Update UI
    filteredApps = [...appsData];
    applySortAndFilter();
    showLibrary();
    updateStorageInfo();
    
    showToast(`Deleted "${currentApp.name}"`, 'success');
  } catch (error) {
    console.error('Failed to delete app:', error);
    showToast('Failed to delete app', 'error');
  }
}

/**
 * Handle download all images
 */
function handleDownloadAll() {
  if (!currentApp) return;
  
  const confirmed = confirm(
    `Download all ${currentApp.screens.length} images from "${currentApp.name}"?`
  );
  
  if (!confirmed) return;
  
  showToast(`Downloading ${currentApp.screens.length} images...`, 'info');
  
  currentApp.screens.forEach((url, index) => {
    // Add small delay between downloads to avoid overwhelming browser
    setTimeout(() => {
      downloadImage(url, currentApp.name);
    }, index * 100);
  });
}

/**
 * Download single image
 */
function downloadImage(url, prefix = "") {
  try {
    let filename = url.split('/').pop().split('?')[0];
    
    // Ensure file extension
    if (!filename.match(/\.(png|jpg|jpeg|webp)$/i)) {
      filename += '.png';
    }
    
    // Add prefix if provided
    if (prefix) {
      const safePrefix = prefix.replace(/[^a-z0-9]/gi, '_');
      filename = `${safePrefix}/${filename}`;
    }

    chrome.downloads.download({
      url: url,
      filename: filename,
      conflictAction: 'uniquify'
    });
    
  } catch (error) {
    console.error('Download error:', error);
    showToast('Download failed', 'error');
  }
}

/**
 * Update storage info display
 */
async function updateStorageInfo() {
  try {
    const result = await chrome.runtime.sendMessage({ 
      action: 'check_storage' 
    });
    
    if (result && !result.error) {
      elements.storageUsed.textContent = `${result.mbInUse} MB`;
      elements.storageProgress.style.width = `${result.percentUsed}%`;
      
      // Change color if near limit
      if (result.nearLimit) {
        elements.storageProgress.style.backgroundColor = '#ef4444';
      } else {
        elements.storageProgress.style.backgroundColor = '#ffffff';
      }
    }
  } catch (error) {
    console.debug('Could not fetch storage info:', error);
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${sanitizeText(message)}</span>
  `;
  
  container.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after delay
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Format date
 */
function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  
  return date.toLocaleDateString();
}

/**
 * Sanitize text to prevent XSS
 */
function sanitizeText(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Sanitize URL
 */
function sanitizeUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return 'about:blank';
    }
    return url;
  } catch {
    return 'about:blank';
  }
}