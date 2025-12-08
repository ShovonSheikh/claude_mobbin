let appsData = [];
let currentApp = null;
let currentImage = null;

const els = {
  views: {
    library: document.getElementById('view-library'),
    detail: document.getElementById('view-detail')
  },
  title: document.getElementById('page-title'),
  detailActions: document.getElementById('detail-actions'),
  sidebar: document.getElementById('preview-sidebar'),
  overlay: document.getElementById('overlay')
};

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  
  // Navigation
  document.getElementById('btn-back').addEventListener('click', showLibrary);
  document.getElementById('nav-library').addEventListener('click', showLibrary);
  
  // Clear
  document.getElementById('btn-clear').addEventListener('click', () => {
    if(confirm('Are you sure you want to clear all data? This cannot be undone.')) {
      chrome.storage.local.clear(() => {
        appsData = [];
        renderLibrary();
      });
    }
  });

  // Sidebar / Downloads
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  els.overlay.addEventListener('click', closeSidebar);
  
  document.getElementById('btn-download-current').addEventListener('click', () => {
    if (currentImage) downloadImage(currentImage);
  });
  
  document.getElementById('btn-download-all').addEventListener('click', () => {
    if (currentApp) {
      if(confirm(`Download ${currentApp.screens.length} images?`)) {
        currentApp.screens.forEach(url => downloadImage(url, currentApp.name));
      }
    }
  });
});

function loadData() {
  chrome.storage.local.get("apps", (result) => {
    appsData = result.apps || [];
    renderLibrary();
  });
}

function showLibrary() {
  els.views.library.classList.remove('hidden');
  els.views.detail.classList.add('hidden');
  els.detailActions.classList.add('hidden');
  els.title.textContent = "Library";
  document.getElementById('nav-library').classList.add('active');
}

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
    card.className = 'app-card';
    const logoSrc = app.logo || "https://via.placeholder.com/100?text=" + app.name.charAt(0);

    card.innerHTML = `
      <img class="app-logo" src="${logoSrc}" loading="lazy">
      <div class="app-title">${app.name}</div>
      <div class="app-meta">${app.screenCount} Screens</div>
    `;
    card.addEventListener('click', () => openDetail(app));
    grid.appendChild(card);
  });
}

function openDetail(app) {
  currentApp = app;
  
  // Update Header
  els.views.library.classList.add('hidden');
  els.views.detail.classList.remove('hidden');
  els.detailActions.classList.remove('hidden');
  els.title.textContent = "App Details";
  document.getElementById('nav-library').classList.remove('active');

  // Update Detail View
  document.getElementById('detail-name').textContent = app.name;
  document.getElementById('detail-count').textContent = `${app.screenCount} screens collected`;
  document.getElementById('detail-logo').src = app.logo || "https://via.placeholder.com/100";
  
  const grid = document.getElementById('detail-grid');
  grid.innerHTML = '';

  app.screens.forEach(url => {
    const item = document.createElement('div');
    item.className = 'screen-item';
    
    const img = document.createElement('img');
    img.src = url;
    img.loading = "lazy";
    
    item.appendChild(img);
    item.addEventListener('click', () => openSidebar(url));
    grid.appendChild(item);
  });
}

function openSidebar(url) {
  currentImage = url;
  document.getElementById('sidebar-image').src = url;
  els.sidebar.classList.add('open');
  els.overlay.classList.add('visible');
}

function closeSidebar() {
  els.sidebar.classList.remove('open');
  els.overlay.classList.remove('visible');
}

function downloadImage(url, prefix = "") {
  let filename = url.split('/').pop().split('?')[0];
  if (!filename.match(/\.(png|jpg|webp)$/)) filename += '.png';
  if (prefix) filename = `${prefix.replace(/\s+/g, '_')}/${filename}`;

  chrome.downloads.download({
    url: url,
    filename: filename,
    conflictAction: 'uniquify'
  });
}