// Improved code extraction with progress and validation
document.getElementById('extract').addEventListener('click', async () => {
  const button = document.getElementById('extract');
  const originalText = button.textContent;
  button.textContent = 'Extracting...';
  button.disabled = true;

  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showError('No active tab found');
      return;
    }

    // Check if it's an OpenEMR page
    if (!tab.url.includes('openemr') && !tab.url.includes('localhost') && !tab.url.includes('127.0.0.1')) {
      showError('Not an OpenEMR page. Please navigate to OpenEMR first.');
      return;
    }

    // Run the extraction in all frames
    chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      function: extractCodes
    }, (results) => {
      if (!results || results.length === 0) {
        showError('Script execution failed');
        return;
      }

      // Aggregate with improved processing
      const aggregate = aggregateResults(results);
      aggregate.startTime = Date.now();

      // Apply code validation
      validateCodes(aggregate);

      // Store results in storage for persistence
      chrome.storage.local.set({ lastExtraction: aggregate });

      // Display results with enhanced UI
      displayEnhancedResults(aggregate);

      updateStatistics(aggregate);
    });
  } catch (error) {
    showError('Error: ' + error.message);
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
});

// Improved aggregation with error handling
function aggregateResults(results) {
  const aggregate = { text: '', codes: {}, totalCodes: 0, extractionTime: 0 };
  const startTime = Date.now();

  for (const res of results) {
    if (!res || !res.result) continue;
    const r = res.result;
    aggregate.text += (r.text || '') + '\n';

    // Merge codes with validation
    for (const [type, list] of Object.entries(r.codes || {})) {
      if (!aggregate.codes[type]) aggregate.codes[type] = new Set();
      for (const c of list) {
        if (c && c.trim()) aggregate.codes[type].add(c.trim());
      }
    }
  }

  // Convert to arrays and calculate totals
  for (const k of Object.keys(aggregate.codes)) {
    aggregate.codes[k] = Array.from(aggregate.codes[k]);
    aggregate.totalCodes += aggregate.codes[k].length;
  }
  aggregate.extractionTime = Date.now() - startTime;
  return aggregate;
}

// Code validation against known patterns
function validateCodes(aggregate) {
  // ICD-10 validation - filter invalid formats
  if (aggregate.codes['ICD-10']) {
    aggregate.codes['ICD-10'] = aggregate.codes['ICD-10'].filter(code => validateICD10(code));
  }
  // CPT validation - ensure 5 digits, not dates
  if (aggregate.codes['CPT']) {
    aggregate.codes['CPT'] = aggregate.codes['CPT'].filter(code => validateCPT(code));
  }
  // SNOMED validation - ensure valid CT format
  if (aggregate.codes['SNOMED']) {
    aggregate.codes['SNOMED'] = aggregate.codes['SNOMED'].filter(code => validateSNOMED(code));
  }
}

// Validation functions
function validateICD10(code) {
  return /^[A-Z]\d{2}(\.\d{1,3})?$/.test(code) && code.length >= 3;
}

function validateCPT(code) {
  const numCode = code.replace(/\D/g, ''); // Remove non-digits
  return numCode.length === 5 && /^\d{5}$/.test(numCode) &&
         !/\d{4}[01]\d[0123]\d/.test(numCode); // Avoid date-like patterns
}

function validateSNOMED(code) {
  return /^\d{9,18}$/.test(code) && parseInt(code) >= 10000000;
}

function showError(message) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = `<div class="code-section">
    <h4 style="color: #dc3545;">❌ Error</h4>
    <p>${message}</p>
  </div>`;
}

function extractCodes() {
  // Get text from body
  let textAggregated = document.body.innerText || '';

  // Also get text from textarea and input elements
  const textareas = document.querySelectorAll('textarea, input[type="text"], input[type="textarea"], input:not([type]), [contenteditable="true"]');
  textareas.forEach(element => {
    textAggregated += ' ' + (element.value || element.textContent || element.innerText || '');
  });

  const codes = {};

  // ICD-10 patterns: A00-Z99 with optional dot and numbers
  // ICD-10 patterns: A00-Z99 with optional dot and numbers
  const icd10Regex = /\b([A-Z]\d{2})(?:\.\d{1,3})?\b/g;
  const icd10Matches = textAggregated.match(icd10Regex) || [];
  codes['ICD-10'] = [...new Set(icd10Matches.map(s => s.trim()))].filter(Boolean);

  // CPT codes: 5-digit numbers
  const cptRegex = /\b\d{5}\b/g;
  const cptMatches = (textAggregated.match(cptRegex) || []).filter(code => /^[0-9]{5}$/.test(code));
  codes['CPT'] = [...new Set(cptMatches)];

  // SNOMED: Long numbers (9+ digits)
  const snomedRegex = /\b\d{9,}\b/g;
  const snomedMatches = textAggregated.match(snomedRegex) || [];
  codes['SNOMED'] = [...new Set(snomedMatches)];

  return {codes: codes, text: textAggregated.substring(0, 500), found: textAggregated.includes('J20.9')};
}

// Enhanced display with filtering, sorting, export options
function displayEnhancedResults(aggregate) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = '';

  // Add control buttons
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'controls';
  controlsDiv.style.marginBottom = '10px';

  const exportBtn = document.createElement('button');
  exportBtn.textContent = '📋 Copy All';
  exportBtn.onclick = () => exportCodes(aggregate.codes, 'clipboard');
  exportBtn.style.marginRight = '5px';
  exportBtn.style.fontSize = '12px';
  exportBtn.style.padding = '5px 10px';

  const csvBtn = document.createElement('button');
  csvBtn.textContent = '💾 Export CSV';
  csvBtn.onclick = () => exportCodes(aggregate.codes, 'csv');
  csvBtn.style.marginRight = '5px';
  csvBtn.style.fontSize = '12px';
  csvBtn.style.padding = '5px 10px';

  const filterSelect = document.createElement('select');
  filterSelect.id = 'codeFilter';
  filterSelect.onchange = () => filterAndDisplay(aggregate);
  filterSelect.style.fontSize = '12px';
  filterSelect.style.marginRight = '5px';

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All Types';
  filterSelect.appendChild(allOption);

  const types = ['ICD-10', 'CPT', 'SNOMED'];
  types.forEach(type => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    filterSelect.appendChild(option);
  });

  controlsDiv.appendChild(exportBtn);
  controlsDiv.appendChild(csvBtn);
  controlsDiv.appendChild(filterSelect);
  resultsDiv.appendChild(controlsDiv);

  // Display codes by type with sorting
  const codeTypes = ['ICD-10', 'CPT', 'SNOMED'];
  let hasResults = false;

  codeTypes.forEach(type => {
    if (aggregate.codes[type] && aggregate.codes[type].length > 0) {
      const section = document.createElement('div');
      section.className = 'code-section';

      const header = document.createElement('h4');
      header.textContent = `${type} (${aggregate.codes[type].length})`;
      section.appendChild(header);

      const ul = document.createElement('ul');
      aggregate.codes[type].sort().forEach(code => {
        const li = document.createElement('li');
        li.textContent = code;
        li.onclick = () => highlightCode(code, type);
        li.style.cursor = 'pointer';
        ul.appendChild(li);
      });
      section.appendChild(ul);
      resultsDiv.appendChild(section);
      hasResults = true;
    }
  });

  if (!hasResults) {
    const noResults = document.createElement('div');
    noResults.className = 'no-results';
    noResults.textContent = 'No valid medical codes found on this page.';
    resultsDiv.appendChild(noResults);
  }
}

function filterAndDisplay(aggregate) {
  const filter = document.getElementById('codeFilter').value;
  const resultsDiv = document.getElementById('results');
  const filteredCodes = {};

  if (filter === 'all') {
    Object.assign(filteredCodes, aggregate.codes);
  } else if (filter && aggregate.codes[filter]) {
    filteredCodes[filter] = aggregate.codes[filter];
  }

  const tempAggregate = { ...aggregate, codes: filteredCodes };
  displayEnhancedResults(tempAggregate);
}

function updateStatistics(aggregate) {
  const statsDiv = document.getElementById('stats');
  statsDiv.textContent = `Extraction completed in ${aggregate.extractionTime}ms. Total codes: ${aggregate.totalCodes}. Last updated: ${new Date().toLocaleTimeString()}`;
}

function exportCodes(codes, format) {
  let exportData = '';

  if (format === 'clipboard') {
    const allCodes = Object.values(codes).flat();
    navigator.clipboard.writeText(allCodes.join(', ')).then(() => {
      alert('Codes copied to clipboard!');
    });
  } else if (format === 'csv') {
    const csvLines = ['Type,Code'];
    Object.entries(codes).forEach(([type, list]) => {
      list.forEach(code => csvLines.push(`${type},${code}`));
    });
    const csvContent = csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extracted_codes.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

function highlightCode(code, type) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: highlightOnPage,
      args: [code]
    });
  });
}

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
        }
      }
    }
  }
}

// Load persistent results on popup open
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['lastExtraction'], (result) => {
    if (result.lastExtraction) {
      document.getElementById('stats').textContent = 'Last Results (Cached)';
      displayEnhancedResults(result.lastExtraction);
      updateStatistics(result.lastExtraction);
    }
  });
});

// Clear button handler
document.getElementById('clear').addEventListener('click', () => {
  document.getElementById('results').innerHTML = '';
  document.getElementById('stats').textContent = 'Ready for extraction.';
  chrome.storage.local.remove('lastExtraction');
});
