// content.js
let isScraping = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get_meta") {
    sendResponse(getPageMeta());
    return;
  }

  if (request.action === "start_scrape") {
    if (isScraping) return;
    isScraping = true;
    
    performSmartScrape().then(result => {
      isScraping = false;
      sendResponse(result);
    });
    return true; 
  }
});

function getPageMeta() {
  const h1 = document.querySelector('h1');
  let appName = h1 ? h1.innerText.split('—')[0].trim() : document.title.split('—')[0].trim();
  
  // Robust Logo Strategy
  let logoUrl = "";
  
  // 1. Try specific Mobbin AppLogo component
  const logoComponent = document.querySelector('div[data-sentry-component="AppLogo"] img');
  
  // 2. Try Header Image (common Mobbin layout)
  const headerLogo = h1?.parentElement?.parentElement?.querySelector('img');

  if (logoComponent && logoComponent.src) {
    logoUrl = logoComponent.src.split('?')[0];
  } else if (headerLogo && headerLogo.src) {
    logoUrl = headerLogo.src.split('?')[0];
  }
  
  // Fallback
  if (!logoUrl) logoUrl = "https://via.placeholder.com/100?text=" + appName.charAt(0);

  return { name: appName, logo: logoUrl };
}

async function performSmartScrape() {
  // CRITICAL FIX: Capture Meta Data BEFORE scrolling starts
  const initialMeta = getPageMeta();

  let capturedImages = [];
  const scannedUrlSet = new Set(); 
  
  // 1. Reset to top
  window.scrollTo(0, 0);
  await sleep(500);

  const viewportHeight = window.innerHeight;
  let totalHeight = document.body.scrollHeight;
  let noNewContentCount = 0;

  // 2. Loop
  while (true) {
    const newImages = extractImagesFromDOM();
    
    newImages.forEach(url => {
      if (!scannedUrlSet.has(url)) {
        scannedUrlSet.add(url);
        capturedImages.push(url);
      }
    });

    chrome.runtime.sendMessage({
      action: "update_progress",
      text: `Scanning... Found ${capturedImages.length} screens`
    });

    if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight - 100) {
      if (document.body.scrollHeight === totalHeight) {
        noNewContentCount++;
        if (noNewContentCount > 1) break; 
      } else {
        totalHeight = document.body.scrollHeight;
        noNewContentCount = 0;
      }
    }

    window.scrollBy({ top: viewportHeight, behavior: 'smooth' });
    await sleep(500); 
  }

  window.scrollTo(0, 0);

  // Pass the initialMeta to saveToStorage
  return await saveToStorage(capturedImages, initialMeta);
}

function extractImagesFromDOM() {
  const selectors = [
    'div[data-sentry-component="ScreenCell"] img',
    'div[data-sentry-component="ScreenCellImage"] img'
  ];

  const rawImages = document.querySelectorAll(selectors.join(','));
  const urls = [];

  rawImages.forEach(img => {
    if (img.closest('li')) return; 

    if (img.src && img.src.includes('http')) {
      const cleanUrl = img.src.split('?')[0];
      urls.push(cleanUrl);
    }
  });

  return urls;
}

async function saveToStorage(orderedImages, meta) {
  // Use the meta passed from the beginning
  const urlParts = window.location.href.split('/');
  const appId = urlParts[urlParts.length - 1] || meta.name.replace(/\s+/g, '-').toLowerCase();

  const newAppData = {
    id: appId,
    name: meta.name,
    logo: meta.logo,
    screenCount: orderedImages.length,
    screens: orderedImages,
    dateAdded: Date.now() // Add timestamp for sorting
  };

  const data = await chrome.storage.local.get("apps");
  let apps = data.apps || [];
  const existingIndex = apps.findIndex(a => a.name === meta.name);

  if (existingIndex > -1) {
    apps[existingIndex] = newAppData; 
  } else {
    apps.unshift(newAppData); // Add to top of list
  }

  await chrome.storage.local.set({ apps });
  return { status: "success", count: orderedImages.length };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}