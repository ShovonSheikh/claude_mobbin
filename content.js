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
  // 1. Get App Name
  const h1 = document.querySelector('h1');
  let appName = h1 ? h1.innerText.split('—')[0].trim() : document.title.split('—')[0].trim();
  
  // 2. Get Logo (Robust Strategy)
  let logoUrl = "";
  
  // Strategy A: Look for the specific AppLogo component provided in your snippet
  const logoComponent = document.querySelector('div[data-sentry-component="AppLogo"] img');
  
  // Strategy B: Look for the header image if Strategy A fails
  // Mobbin headers usually have a specific layout: Logo (img) + Text (h1)
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

// --- CORE SCRAPING LOGIC ---

async function performSmartScrape() {
  // We use an Array instead of a Set to strictly preserve order
  let capturedImages = [];
  const scannedUrlSet = new Set(); // Used only for fast lookup of duplicates
  
  // 1. Reset to top
  window.scrollTo(0, 0);
  await sleep(500);

  const viewportHeight = window.innerHeight;
  let totalHeight = document.body.scrollHeight;
  let noNewContentCount = 0;

  // 2. Loop
  while (true) {
    const newImages = extractImagesFromDOM();
    let foundNewInThisStep = false;
    
    newImages.forEach(url => {
      if (!scannedUrlSet.has(url)) {
        scannedUrlSet.add(url);
        capturedImages.push(url); // Push to array to maintain order
        foundNewInThisStep = true;
      }
    });

    // Report Progress
    chrome.runtime.sendMessage({
      action: "update_progress",
      text: `Scanning... Found ${capturedImages.length} screens`
    });

    // Check if we hit bottom
    if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight - 100) {
      if (document.body.scrollHeight === totalHeight) {
        noNewContentCount++;
        if (noNewContentCount > 1) break; 
      } else {
        totalHeight = document.body.scrollHeight;
        noNewContentCount = 0;
      }
    }

    // Scroll
    window.scrollBy({ top: viewportHeight, behavior: 'smooth' });
    await sleep(500); 
  }

  // 3. Scroll back to top when done
  window.scrollTo(0, 0);

  // 4. Save
  return await saveToStorage(capturedImages);
}

function extractImagesFromDOM() {
  const selectors = [
    'div[data-sentry-component="ScreenCell"] img',
    'div[data-sentry-component="ScreenCellImage"] img'
  ];

  // querySelectorAll returns elements in Document Order (Top to Bottom)
  // This is crucial for maintaining the correct sequence.
  const rawImages = document.querySelectorAll(selectors.join(','));
  const urls = [];

  rawImages.forEach(img => {
    if (img.closest('li')) return; // Ignore footer items

    if (img.src && img.src.includes('http')) {
      const cleanUrl = img.src.split('?')[0];
      urls.push(cleanUrl);
    }
  });

  return urls;
}

async function saveToStorage(orderedImages) {
  const meta = getPageMeta();
  const urlParts = window.location.href.split('/');
  const appId = urlParts[urlParts.length - 1] || meta.name.replace(/\s+/g, '-').toLowerCase();

  const newAppData = {
    id: appId,
    name: meta.name,
    logo: meta.logo,
    screenCount: orderedImages.length,
    screens: orderedImages // Saves the exact order captured
  };

  const data = await chrome.storage.local.get("apps");
  let apps = data.apps || [];
  const existingIndex = apps.findIndex(a => a.name === meta.name);

  if (existingIndex > -1) {
    // If updating, we overwrite with the new scrape to ensure the latest order is kept
    // (merging sets might mess up the order if the page layout changed)
    apps[existingIndex] = newAppData; 
  } else {
    apps.push(newAppData);
  }

  await chrome.storage.local.set({ apps });
  return { status: "success", count: orderedImages.length };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}