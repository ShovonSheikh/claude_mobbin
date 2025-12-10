// content.js - v3 FIXED
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
      'img[data-sentry-component="AppLogoImage"]',
      'img[data-sentry-source-file="AppLogoImage.tsx"]',
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

// Prevent multiple initializations
if (!window.mobbinVaultInitialized) {
  window.mobbinVaultInitialized = true;
  console.log('Mobbin Vault content script loaded');

  // Message listener - CRITICAL: Must be synchronous for get_meta
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script received message:', request.action);

    // Ping handler
    if (request.action === "ping") {
      sendResponse({ status: "ok" });
      return false;
    }

    // Get metadata - SYNCHRONOUS
    if (request.action === "get_meta") {
      try {
        const meta = getPageMeta();
        console.log('Sending meta:', meta);
        sendResponse(meta);
      } catch (error) {
        console.error('Failed to get page meta:', error);
        sendResponse({ error: error.message });
      }
      return false; // Synchronous
    }

    // Start scrape - ASYNCHRONOUS
    if (request.action === "start_scrape") {
      if (isScraping) {
        sendResponse({ status: "error", message: "Scrape already in progress" });
        return false;
      }
      
      isScraping = true;
      scrapingAborted = false;
      
      // Run async scrape
      performSmartScrape()
        .then(result => {
          isScraping = false;
          console.log('Scrape completed:', result);
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

    // Abort scrape
    if (request.action === "abort_scrape") {
      scrapingAborted = true;
      isScraping = false;
      sendResponse({ status: "aborted" });
      return false;
    }

    return false;
  });
}

/**
 * Extract page metadata (app name, logo)
 */
function getPageMeta() {
  const h1 = document.querySelector('h1');
  let appName = h1 
    ? h1.innerText.split('—')[0].trim() 
    : document.title.split('—')[0].trim();
  
  // Sanitize app name
  appName = sanitizeText(appName);
  
  // Extract main logo using improved logic
  let logoUrl = extractMainLogo();
  
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
 * Extract main app logo (not header/nav logos)
 */
function extractMainLogo() {
  // Strategy 1: Look for AppLogoImage component (most reliable)
  const appLogoImages = document.querySelectorAll('img[data-sentry-component="AppLogoImage"], img[data-sentry-source-file="AppLogoImage.tsx"]');
  
  if (appLogoImages.length > 0) {
    // Exclude images in header/nav
    const candidates = Array.from(appLogoImages)
      .filter(img => !img.closest('nav') && !img.closest('header') && !img.closest('[role="banner"]'))
      .map(img => {
        const rect = img.getBoundingClientRect();
        return {
          url: normalizeLogoUrl(img.src || img.getAttribute('src')),
          area: rect.width * rect.height,
          img: img
        };
      })
      .filter(c => c.url && c.area > 0);
    
    // Return largest (main logo, not thumbnail)
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.area - a.area);
      return candidates[0].url;
    }
  }
  
  // Strategy 2: Look for AppLogo component container
  const appLogoContainer = document.querySelector('div[data-sentry-component="AppLogo"] img');
  if (appLogoContainer && !appLogoContainer.closest('nav') && !appLogoContainer.closest('header')) {
    return normalizeLogoUrl(appLogoContainer.src || appLogoContainer.getAttribute('src'));
  }
  
  // Strategy 3: Look for large images near h1 (fallback)
  const h1 = document.querySelector('h1');
  if (h1) {
    const nearbyImg = h1.parentElement?.querySelector('img');
    if (nearbyImg && !nearbyImg.closest('nav') && !nearbyImg.closest('header')) {
      const rect = nearbyImg.getBoundingClientRect();
      if (rect.width >= 60 && rect.height >= 60) {
        return normalizeLogoUrl(nearbyImg.src || nearbyImg.getAttribute('src'));
      }
    }
  }
  
  return "";
}

/**
 * Normalize logo URL (remove query params)
 */
function normalizeLogoUrl(url) {
  if (!url) return "";
  try {
    const urlObj = new URL(url, window.location.href);
    return urlObj.origin + urlObj.pathname;
  } catch {
    return url ? url.split('?')[0].split('#')[0] : "";
  }
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
      newAppData.dateAdded = apps[existingIndex].dateAdded;
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