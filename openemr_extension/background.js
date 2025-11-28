// Background service worker to handle extension icon clicks
chrome.action.onClicked.addListener(async (tab) => {
    // Check if we're on a valid page (not chrome:// or extension pages)
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        console.log('Cannot inject on this page');
        return;
    }

    try {
        // Try to send message to content script
        await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidePanel' });
    } catch (error) {
        // Content script not loaded yet, inject it manually
        console.log('Content script not found, injecting...');

        try {
            // Inject CSS first
            await chrome.scripting.insertCSS({
                target: { tabId: tab.id },
                files: ['sidepanel.css']
            });

            // Then inject the content script
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            });

            // Wait a bit for the script to initialize, then send the message
            setTimeout(async () => {
                try {
                    await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidePanel' });
                } catch (e) {
                    console.error('Failed to toggle after injection:', e);
                }
            }, 100);
        } catch (injectError) {
            console.error('Failed to inject content script:', injectError);
        }
    }
});
