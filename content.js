// content.js - v3
// Content script for scraping Mobbin pages

// Configuration constants
const CONFIG = {
  SCROLL_DELAY: 500,
  INITIAL_DELAY: 500,
  SCROLL_THRESHOLD: 100,
  MAX_NO_CONTENT_ATTEMPTS: 2,
  MAX_RETRY_ATTEMPTS: 3,
  SELECTORS: {
    logo: [
      'div[data-sentry-component="AppLogo"] img',
      'h1 + img',
      'header img'
    ],
    screens: [
      'div[data-sentry-component="ScreenCell"] img',
      'div[data-sentry-component="ScreenCellImage"] img'
    ]
  }
};

let isScraping = false;
let scrapingAborted = false;

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get_meta") {
    try {
      sendResponse(getPageMeta());
    } catch (error) {
      console.error('Failed to get page meta:', error);
      sendResponse({ error: error.message });
    }
    return false;
  }

  if (request.action === "start_scrape") {
    if (isScraping) {
      sendResponse({ status: "error", message: "Scrape already in progress" });
      return false;
    }
    
    isScraping = true;
    scrapingAborted = false;
    
    performSmartScrape()
      .then(result => {
        isScraping = false;
        sendResponse(result);
      })
      .catch(error => {
        isScraping = false;
        console.error('Scrape error:', error);
        sendResponse({ 
          status: "error", 
          message: error.message || "Scrape failed" 
        });
      });
    
    return true; // Async response
  }

  if (request.action === "abort_scrape") {
    scrapingAborted = true;
    isScraping = false;
    sendResponse({ status: "aborted" });
    return false;
  }
});

/**
 * Extract page metadata (app name, logo)
 */
function getPageMeta() {
  const h1 = document.querySelector('h1');
  let appName = h1 
    ? h1.innerText.split('—')[0].trim() 
    : document.title.split('—')[0].trim();
  
  // Sanitize app name (security: prevent XSS)
  appName = sanitizeText(appName);
  
  // Try multiple logo selector strategies
  let logoUrl = "";
  
  for (const selector of CONFIG.SELECTORS.logo) {
    const logoEl = document.querySelector(selector);
    if (logoEl && logoEl.src) {
      logoUrl = logoEl.src.split('?')[0];
      break;
    }
  }
  
  // Fallback to placeholder
  if (!logoUrl || !isValidImageUrl(logoUrl)) {
    logoUrl = `https://via.placeholder.com/100?text=${encodeURIComponent(appName.charAt(0))}`;
  }

  return { 
    name: appName, 
    logo: logoUrl,
    url: window.location.href 
  };
}

/**
 * Main scraping function with error handling and retries
 */
async function performSmartScrape() {
  try {
    // Capture meta data before scrolling
    const initialMeta = getPageMeta();
    
    if (!initialMeta.name) {
      throw new Error("Could not detect app name");
    }

    let capturedImages = [];
    const scannedUrlSet = new Set();
    let retryCount = 0;
    
    // Reset to top
    window.scrollTo(0, 0);
    await sleep(CONFIG.INITIAL_DELAY);

    const viewportHeight = window.innerHeight;
    let totalHeight = document.body.scrollHeight;
    let noNewContentCount = 0;
    let scrollPosition = 0;

    // Scrolling loop
    while (!scrapingAborted) {
      try {
        const newImages = extractImagesFromDOM();
        
        let newCount = 0;
        newImages.forEach(url => {
          if (!scannedUrlSet.has(url) && isValidImageUrl(url)) {
            scannedUrlSet.add(url);
            capturedImages.push(url);
            newCount++;
          }
        });

        // Send progress update
        sendProgressUpdate(`Scanning... Found ${capturedImages.length} screens`);

        // Check if reached bottom
        const atBottom = (window.innerHeight + window.scrollY) >= 
                        document.body.scrollHeight - CONFIG.SCROLL_THRESHOLD;

        if (atBottom) {
          if (document.body.scrollHeight === totalHeight) {
            noNewContentCount++;
            if (noNewContentCount >= CONFIG.MAX_NO_CONTENT_ATTEMPTS) {
              break; // No more content loading
            }
          } else {
            totalHeight = document.body.scrollHeight;
            noNewContentCount = 0;
          }
        }

        // Scroll down
        scrollPosition += viewportHeight;
        window.scrollBy({ top: viewportHeight, behavior: 'smooth' });
        await sleep(CONFIG.SCROLL_DELAY);

      } catch (error) {
        console.error('Error during scroll iteration:', error);
        retryCount++;
        
        if (retryCount >= CONFIG.MAX_RETRY_ATTEMPTS) {
          throw new Error(`Scraping failed after ${retryCount} retries: ${error.message}`);
        }
        
        // Wait longer before retry
        await sleep(CONFIG.SCROLL_DELAY * 2);
      }
    }

    if (scrapingAborted) {
      return { status: "aborted", message: "Scrape cancelled by user" };
    }

    // Reset scroll position
    window.scrollTo(0, 0);

    // Validate results
    if (capturedImages.length === 0) {
      throw new Error("No screens found. This might not be a valid Mobbin app page.");
    }

    // Save to storage
    return await saveToStorage(capturedImages, initialMeta);

  } catch (error) {
    console.error('Scraping error:', error);
    return { 
      status: "error", 
      message: error.message || "Unknown scraping error" 
    };
  }
}

/**
 * Extract image URLs from DOM
 */
function extractImagesFromDOM() {
  const selectors = CONFIG.SELECTORS.screens;
  const rawImages = document.querySelectorAll(selectors.join(','));
  const urls = [];

  rawImages.forEach(img => {
    // Skip images in list items (thumbnails)
    if (img.closest('li')) return;

    if (img.src && img.src.includes('http')) {
      const cleanUrl = img.src.split('?')[0];
      urls.push(cleanUrl);
    }
  });

  return urls;
}

/**
 * Save scraped data to Chrome storage with error handling
 */
async function saveToStorage(orderedImages, meta) {
  try {
    const urlParts = window.location.href.split('/');
    const appId = urlParts[urlParts.length - 1] || 
                  meta.name.replace(/\s+/g, '-').toLowerCase();

    const newAppData = {
      id: appId,
      name: meta.name,
      logo: meta.logo,
      sourceUrl: meta.url,
      screenCount: orderedImages.length,
      screens: orderedImages,
      dateAdded: Date.now(),
      dateUpdated: Date.now()
    };

    // Get existing data
    const data = await chrome.storage.local.get("apps");
    let apps = data.apps || [];
    
    // Check for duplicates
    const existingIndex = apps.findIndex(a => 
      a.name === meta.name || a.id === appId
    );

    if (existingIndex > -1) {
      // Update existing
      newAppData.dateAdded = apps[existingIndex].dateAdded; // Keep original date
      apps[existingIndex] = newAppData;
    } else {
      // Add new to top
      apps.unshift(newAppData);
    }

    // Save to storage
    await chrome.storage.local.set({ apps });
    
    return { 
      status: "success", 
      count: orderedImages.length,
      appName: meta.name,
      isUpdate: existingIndex > -1
    };

  } catch (error) {
    console.error('Storage error:', error);
    
    if (error.message && error.message.includes('QUOTA_BYTES')) {
      throw new Error("Storage quota exceeded. Try clearing some apps first.");
    }
    
    throw new Error(`Failed to save: ${error.message}`);
  }
}

/**
 * Helper: Send progress update to popup
 */
function sendProgressUpdate(text) {
  try {
    chrome.runtime.sendMessage({
      action: "update_progress",
      text: text
    });
  } catch (error) {
    // Popup might be closed, ignore
    console.debug('Could not send progress update:', error);
  }
}

/**
 * Helper: Validate image URL
 */
function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Helper: Sanitize text to prevent XSS
 */
function sanitizeText(text) {
  const temp = document.createElement('div');
  temp.textContent = text;
  return temp.innerHTML;
}

/**
 * Helper: Sleep/delay function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}