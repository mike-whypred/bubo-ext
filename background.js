chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureScreen') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' })
      .then(dataUrl => {
        sendResponse(dataUrl);
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true; // Required for async response
  }
}); 