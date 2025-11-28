// Content script - Injects and manages the side panel
(function () {
    'use strict';

    let panelContainer = null;
    let isOpen = false;

    // Create and inject the side panel
    function createPanel() {
        if (panelContainer) return;

        // Create container
        panelContainer = document.createElement('div');
        panelContainer.id = 'soap-assistant-panel';

        // Create iframe to isolate styles
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'width: 100%; height: 100%; border: none;';

        // Get the HTML file URL
        const panelURL = chrome.runtime.getURL('sidepanel.html');
        iframe.src = panelURL;

        panelContainer.appendChild(iframe);
        document.body.appendChild(panelContainer);

        // Wait for iframe to load, then set up communication
        iframe.onload = () => {
            // The assistant.js will handle all the logic inside the iframe
        };
    }

    // Toggle panel visibility
    function togglePanel() {
        if (!panelContainer) {
            createPanel();
        }

        isOpen = !isOpen;

        if (isOpen) {
            panelContainer.classList.add('open');
            adjustPageLayout(true);
        } else {
            panelContainer.classList.remove('open');
            adjustPageLayout(false);
        }
    }

    // Adjust the page layout to accommodate the panel
    function adjustPageLayout(shrink) {
        const panelWidth = 400; // Match the panel width

        if (shrink) {
            // Shrink the page content
            document.body.style.marginRight = `${panelWidth}px`;
            document.body.style.transition = 'margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        } else {
            // Restore the page content
            document.body.style.marginRight = '0';
        }
    }

    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'toggleSidePanel') {
            togglePanel();
            sendResponse({ success: true });
        }
    });

    // Listen for messages from the iframe (to close the panel)
    window.addEventListener('message', (event) => {
        // Verify the message is from our extension
        if (event.data && event.data.action === 'closePanel') {
            if (isOpen) {
                togglePanel();
            }
        }
    });

})();
