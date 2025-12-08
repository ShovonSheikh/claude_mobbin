// State
let appsData = [];
let currentApp = null;
let currentImage = null;

// DOM Elements
const views = {
  library: document.getElementById('view-library'),
  detail: document.getElementById('view-detail')
};
const sidebar = document.getElementById('preview-sidebar');
const overlay = document.getElementById('overlay');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupEventListeners();
});

function loadData() {
  chrome.storage.local.get("apps", (result) => {
    appsData = result.apps || [];
    renderLibrary();
  });
}

function setupEventListeners() {
  // Navigation
  document.getElementById('btn-back').addEventListener('click', () => switchView('library'));
  
  // NOTE: Scraper logic removed. Use the Extension Popup to scan.
  
  // Clear Data
  document.getElementById('btn-clear').addEventListener('click', () => {
    if(confirm('Delete all saved apps?')) {
      chrome.storage.local.clear(() => {
        appsData = [];
        renderLibrary();
      });
    }
  });

  // Sidebar Controls
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);
  
  // Downloads
  document.getElementById('btn-download-current').addEventListener('click', () => {
    if (currentImage) downloadImage(currentImage);
  });
  
  document.getElementById('btn-download-all').addEventListener('click', () => {
    if (currentApp) {
      currentApp.screens.forEach(url => downloadImage(url, currentApp.name));
    }
  });
}

// --- Render Logic ---

function renderLibrary() {
  const grid = document.getElementById('library-grid');
  const empty = document.getElementById('empty-state');
  grid.innerHTML = '';

  if (appsData.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  appsData.forEach(app => {
    const card = document.createElement('div');
    card.className = 'card';
    // Handle logo placeholder if missing
    const logoSrc = app.logo || "https://via.placeholder.com/100?text=" + app.name.charAt(0);

    card.innerHTML = `
      <div class="card-top">
        <img class="card-logo" src="${logoSrc}" loading="lazy">
      </div>
      <div class="card-mid">${app.name}</div>
      <div class="card-bot">${app.screenCount} Screens</div>
    `;
    card.addEventListener('click', () => openDetail(app));
    grid.appendChild(card);
  });
}

function openDetail(app) {
  currentApp = app;
  document.getElementById('detail-title').textContent = app.name;
  document.getElementById('detail-logo').src = app.logo || "https://via.placeholder.com/100?text=" + app.name.charAt(0);
  
  const grid = document.getElementById('detail-grid');
  grid.innerHTML = '';

  // Use the saved screens (which are now ordered correctly thanks to content.js)
  app.screens.forEach(url => {
    const item = document.createElement('div');
    item.className = 'screen-item';
    
    // Main Image
    const img = document.createElement('img');
    img.src = url;
    img.loading = "lazy";
    
    // Hover Overlay for Download
    const actions = document.createElement('div');
    actions.className = 'screen-actions';
    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn-hover-dl';
    dlBtn.innerHTML = '⬇'; 
    dlBtn.title = "Download this image";
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation(); 
      downloadImage(url);
    });
    actions.appendChild(dlBtn);

    item.appendChild(img);
    item.appendChild(actions);

    item.addEventListener('click', () => openSidebar(url));
    grid.appendChild(item);
  });

  switchView('detail');
}

// --- Sidebar & View Management ---

function switchView(viewName) {
  Object.values(views).forEach(el => el.classList.add('hidden'));
  views[viewName].classList.remove('hidden');
  window.scrollTo(0,0);
}

function openSidebar(url) {
  currentImage = url;
  document.getElementById('sidebar-image').src = url;
  sidebar.classList.add('open');
  overlay.classList.add('visible');
  document.body.style.overflow = 'hidden'; 
}

function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
  document.body.style.overflow = '';
}

function downloadImage(url, prefix = "") {
  let filename = url.split('/').pop().split('?')[0];
  if (!filename.endsWith('.png') && !filename.endsWith('.jpg') && !filename.endsWith('.webp')) {
    filename += '.png';
  }
  
  if (prefix) filename = `${prefix.replace(/\s+/g, '_')}/${filename}`;

  chrome.downloads.download({
    url: url,
    filename: filename,
    conflictAction: 'uniquify'
  });
}