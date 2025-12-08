document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    logoImg: document.getElementById('app-logo'),
    logoText: document.getElementById('logo-text'),
    appName: document.getElementById('app-name'),
    btnScan: document.getElementById('btn-scan'),
    btnDash: document.getElementById('btn-dashboard'),
    status: document.getElementById('status')
  };

  // 1. Listen for Progress Updates from Content Script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "update_progress") {
      elements.status.textContent = message.text;
    }
  });

  // 2. Initialize: Get Meta Data
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab.url.includes('mobbin.com')) {
      elements.appName.textContent = "Not a Mobbin Page";
      elements.btnScan.disabled = true;
      elements.btnScan.style.opacity = "0.5";
      return;
    }

    // Inject content script if needed
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }, () => {
      chrome.tabs.sendMessage(tab.id, { action: "get_meta" }, (response) => {
        if (response) updateUI(response);
      });
    });
  });

  // 3. Scan Button Logic
  elements.btnScan.addEventListener('click', () => {
    elements.btnScan.textContent = "Scanning...";
    elements.btnScan.disabled = true;
    elements.status.textContent = "Starting scroll sequence...";

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "start_scrape" }, (response) => {
        // Final response handling
        if (response && response.status === "success") {
          elements.status.textContent = `Complete! Saved ${response.count} screens.`;
          elements.btnScan.textContent = "Scan Complete";
          setTimeout(() => {
             elements.btnScan.textContent = "Scan";
             elements.btnScan.disabled = false;
          }, 3000);
        } else {
          elements.status.textContent = "Scan failed or interrupted.";
          elements.btnScan.textContent = "Scan";
          elements.btnScan.disabled = false;
        }
      });
    });
  });

  // 4. Dashboard Button
  elements.btnDash.addEventListener('click', () => {
    chrome.tabs.create({ url: "dashboard.html" });
  });

  function updateUI(meta) {
    if (meta.logo && meta.logo !== "") {
      elements.logoImg.src = meta.logo;
      elements.logoImg.style.display = "block";
      elements.logoText.style.display = "none";
    }
    if (meta.name) {
      elements.appName.textContent = meta.name;
    }
  }
});