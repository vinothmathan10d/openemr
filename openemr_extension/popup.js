/**
 * OpenEMR SOAP Extractor - Popup Script
 * Handles UI interactions and coordinates with content scripts
 */

// Global variables
let currentSoapData = null;

// DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initializeTabs();
  initializeEventListeners();
  loadLastResults();
});

// Initialize tab system
function initializeTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and panels
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabPanels.forEach(panel => panel.classList.remove('active'));

      // Add active class to clicked button and corresponding panel
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      const panel = document.getElementById(tabId + '-tab');
      if (panel) panel.classList.add('active');
    });
  });
}

// Initialize event listeners
function initializeEventListeners() {
  // Extract button
  document.getElementById('extract').addEventListener('click', handleExtractData);

  // Clear button
  document.getElementById('clear').addEventListener('click', handleClearData);

  // Code filtering
  document.getElementById('codeFilter').addEventListener('change', handleCodeFilter);

  // Code controls
  document.getElementById('copyCodes').addEventListener('click', () => handleCopyCodes('clipboard'));
  document.getElementById('exportCsv').addEventListener('click', () => handleCopyCodes('csv'));

  // SOAP controls
  document.getElementById('generateSoapPrompt').addEventListener('click', handleGenerateSoapPrompt);
  document.getElementById('copySoapData').addEventListener('click', handleCopySoapData);
}

// Handle SOAP data extraction
async function handleExtractData() {
  const button = document.getElementById('extract');
  const originalText = button.textContent;
  button.textContent = '⏳ Extracting...';
  button.disabled = true;

  showLoading(true);

  try {
    const tab = await getActiveTab();
    if (!isValidOpenEMRPage(tab.url)) {
      showError('Not an OpenEMR page. Please navigate to OpenEMR first.');
      return;
    }

    // Execute the main extraction function
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      function: extractPageDataForSoap
    });

    if (!results || results.length === 0 || !results[0].result) {
      showError('Extraction failed. No data returned from content script.');
      return;
    }

    const soapData = results[0].result;
    currentSoapData = soapData;

    // Store in local storage
    await chrome.storage.local.set({ lastSoapData: soapData, lastExtractionTime: Date.now() });

    // Update UI
    displaySoapData(soapData);
    displayCodes(soapData.codes);

    updateStatistics(soapData);

  } catch (error) {
    console.error('Extraction error:', error);
    showError('Error during extraction: ' + error.message);
  } finally {
    button.textContent = originalText;
    button.disabled = false;
    showLoading(false);
  }
}

// Handle clear data
function handleClearData() {
  currentSoapData = null;
  document.getElementById('codes-container').innerHTML = '<div class="no-codes">No codes extracted yet. Click "Extract SOAP Data" to begin.</div>';
  document.getElementById('soap-sections').innerHTML = '<div class="no-codes">No SOAP data extracted yet. Click "Extract SOAP Data" to begin.</div>';
  document.getElementById('stats').textContent = 'Ready for extraction.';

  // Clear stored data
  chrome.storage.local.remove(['lastSoapData', 'lastExtractionTime']);

  // Hide any visible prompts
  const existingPrompt = document.querySelector('.prompt-display');
  if (existingPrompt) existingPrompt.remove();
}

// Handle code filtering
function handleCodeFilter() {
  if (currentSoapData) {
    displayCodes(currentSoapData.codes);
  }
}

// Handle copying codes
function handleCopyCodes(format) {
  if (!currentSoapData || !currentSoapData.codes) {
    showNotification('No codes available to copy');
    return;
  }

  const filter = document.getElementById('codeFilter').value;
  let codesToExport = currentSoapData.codes;

  if (filter !== 'all') {
    codesToExport = { [filter]: currentSoapData.codes[filter] || [] };
  }

  if (format === 'clipboard') {
    const allCodes = Object.values(codesToExport).flat().map(c => c.code || c);
    navigator.clipboard.writeText(allCodes.join(', ')).then(() => {
      showNotification('Codes copied to clipboard!');
    }).catch(() => {
      showNotification('Failed to copy to clipboard');
    });
  } else if (format === 'csv') {
    const csvLines = ['Type,Code,Context'];
    Object.entries(codesToExport).forEach(([type, list]) => {
      list.forEach(item => {
        const code = item.code || item;
        const context = item.context || '';
        csvLines.push(`"${type}","${code}","${context}"`);
      });
    });
    const csvContent = csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soap_codes_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification('CSV file downloaded!');
  }
}

// Handle generating SOAP prompt
function handleGenerateSoapPrompt() {
  if (!currentSoapData) {
    showNotification('No SOAP data available. Extract data first.');
    return;
  }

  try {
    const prompt = buildSoapPrompt(JSON.stringify(currentSoapData));

    // Check if prompt is an error message
    if (prompt.startsWith('Error:')) {
      showNotification('Failed to generate prompt: ' + prompt);
      return;
    }

    // Display the prompt in a collapsible section
    showSoapPrompt(prompt);

  } catch (error) {
    showNotification('Error generating prompt: ' + error.message);
  }
}

// Handle copying SOAP data
function handleCopySoapData() {
  if (!currentSoapData) {
    showNotification('No SOAP data available to copy.');
    return;
  }

  navigator.clipboard.writeText(JSON.stringify(currentSoapData, null, 2)).then(() => {
    showNotification('SOAP data copied to clipboard!');
  }).catch(() => {
    showNotification('Failed to copy SOAP data');
  });
}

// Get active tab
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');
  return tab;
}

// Check if valid OpenEMR page
function isValidOpenEMRPage(url) {
  return url && (url.includes('openemr') || url.includes('localhost') || url.includes('127.0.0.1'));
}

// Show loading state
function showLoading(show) {
  const existingLoading = document.querySelector('.loading');
  if (show) {
    if (!existingLoading) {
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'loading';
      loadingDiv.textContent = '⏳ Processing...';
      document.getElementById('codes-container').appendChild(loadingDiv);
      document.getElementById('soap-sections').appendChild(loadingDiv.cloneNode(true));
    }
  } else {
    if (existingLoading) existingLoading.remove();
  }
}

// Show error
function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error';
  errorDiv.textContent = message;

  // Clear containers and show error
  document.getElementById('codes-container').innerHTML = '';
  document.getElementById('soap-sections').innerHTML = '';
  document.getElementById('codes-container').appendChild(errorDiv);
}

// Show notification
function showNotification(message) {
  // Create a temporary notification
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #4CAF50;
    color: white;
    padding: 10px 15px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 9999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    opacity: 1;
    transition: opacity 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);

  // Auto remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Display codes
function displayCodes(codes) {
  const container = document.getElementById('codes-container');
  const filter = document.getElementById('codeFilter').value;

  if (!codes || Object.values(codes).every(arr => !arr || arr.length === 0)) {
    container.innerHTML = '<div class="no-codes">No medical codes found on this page.</div>';
    return;
  }

  container.innerHTML = '';

  const codeTypes = [
    { key: 'icd', label: 'ICD-10', color: '#FF5722' },
    { key: 'cpt', label: 'CPT', color: '#2196F3' },
    { key: 'snomed', label: 'SNOMED CT', color: '#4CAF50' }
  ];

  codeTypes.forEach(({ key, label, color }) => {
    const codeList = codes[key];
    if (!codeList || codeList.length === 0) return;

    // Skip if filtering and not this type
    if (filter !== 'all' && filter !== key) return;

    const section = document.createElement('div');
    section.className = 'codes-section';

    const header = document.createElement('h4');
    header.textContent = `${label} (${codeList.length})`;
    header.style.color = color;
    section.appendChild(header);

    const ul = document.createElement('ul');
    ul.className = 'codes-list';

    codeList.forEach(item => {
      const code = item.code || item;
      const li = document.createElement('li');
      li.className = 'code-item';
      li.textContent = code;
      li.title = item.context || code;
      li.onclick = () => highlightCode(code);
      ul.appendChild(li);
    });

    section.appendChild(ul);
    container.appendChild(section);
  });
}

// Display SOAP sections
function displaySoapData(data) {
  const container = document.getElementById('soap-sections');

  if (!data || !data.soapContext) {
    container.innerHTML = '<div class="no-codes">No SOAP data extracted yet. Click "Extract SOAP Data" to begin.</div>';
    return;
  }

  container.innerHTML = '';

  const sections = [
    { key: 'subjective', label: 'S (Subjective)', icon: '🗣️' },
    { key: 'objective', label: 'O (Objective)', icon: '👁️' },
    { key: 'assessment', label: 'A (Assessment)', icon: '📋' },
    { key: 'plan', label: 'P (Plan)', icon: '📝' }
  ];

  sections.forEach(({ key, label, icon }) => {
    const text = data.soapContext[key] || '';

    const section = document.createElement('div');
    section.className = 'soap-section';

    const header = document.createElement('h4');
    header.innerHTML = `<span>${icon}</span> ${label}`;
    section.appendChild(header);

    const content = document.createElement('div');
    content.className = 'soap-content';
    content.textContent = text || 'Not documented';
    section.appendChild(content);

    container.appendChild(section);
  });
}

// Show SOAP prompt
function showSoapPrompt(prompt) {
  const existingPrompt = document.querySelector('.prompt-display');
  if (existingPrompt) existingPrompt.remove();

  const promptDiv = document.createElement('div');
  promptDiv.className = 'prompt-display';
  promptDiv.innerHTML = `
    <strong>Generated AI Prompt:</strong><br><br>
    <button onclick="this.parentElement.remove()" style="float:right; margin-bottom:10px;">✕ Close</button>
    <pre>${prompt}</pre>
  `;

  document.getElementById('soap-container').appendChild(promptDiv);

  // Scroll to the prompt
  promptDiv.scrollIntoView({ behavior: 'smooth' });
}

// Update statistics
function updateStatistics(data) {
  if (data.summaries) {
    const totalCodes = Object.values(data.summaries).reduce((sum, count) => sum + count, 0);
    const time = data.extractionTime || 0;
    document.getElementById('stats').textContent =
      `Extracted in ${time}ms. Total codes: ${totalCodes}. Last updated: ${new Date().toLocaleTimeString()}`;
  } else {
    document.getElementById('stats').textContent =
      `Data extracted successfully. Last updated: ${new Date().toLocaleTimeString()}`;
  }
}

// Highlight code on page
function highlightCode(code) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: highlightOnPage,
      args: [code]
    });
  });
}

// Page highlighting function
function highlightOnPage(code) {
  const elements = document.querySelectorAll('*');
  for (let elem of elements) {
    if (elem.nodeType === Node.TEXT_NODE) {
      const regex = new RegExp(`\\b${code}\\b`, 'gi');
      if (regex.test(elem.textContent)) {
        const parent = elem.parentElement;
        if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE') {
          parent.style.backgroundColor = 'yellow';
          parent.style.color = 'black';
          parent.style.border = '2px solid orange';
        }
      }
    }
  }

  // Scroll to first highlight
  const highlighted = document.querySelector('[style*="yellow"]');
  if (highlighted) {
    highlighted.scrollIntoView({ behavior: 'smooth' });
  }
}

// Load last results on popup open
async function loadLastResults() {
  const result = await chrome.storage.local.get(['lastSoapData', 'lastExtractionTime']);
  if (result.lastSoapData) {
    currentSoapData = result.lastSoapData;
    displaySoapData(result.lastSoapData);
    displayCodes(result.lastSoapData.codes);
    updateStatistics(result.lastSoapData);

    const lastTime = result.lastExtractionTime;
    if (lastTime) {
      document.getElementById('stats').textContent += ` | Cached from ${new Date(lastTime).toLocaleString()}`;
    }
  }
}
