// SOAP Assistant popup behavior
const getContentBtn = document.getElementById('getContent');
const generateBtn = document.getElementById('generateSoap');
const clearBtn = document.getElementById('clearBtn');
const extractedTextEl = document.getElementById('extractedText');
const statusEl = document.getElementById('status');
const icdListEl = document.getElementById('icdList');
const cptListEl = document.getElementById('cptList');
const snomedListEl = document.getElementById('snomedList');
const contentArea = document.getElementById('contentArea');
const soapOutput = document.getElementById('soapOutput');
const soapText = document.getElementById('soapText');

function setStatus(msg, busy = false) {
  statusEl.innerHTML = msg + (busy ? ' <span class="spinner"></span>' : '');
}

// Tab switching
document.getElementById('tabExtracted').addEventListener('click', () => switchTab('extracted'));
document.getElementById('tabCodes').addEventListener('click', () => switchTab('codes'));

function switchTab(tab) {
  const tabExtracted = document.getElementById('tabExtracted');
  const tabCodes = document.getElementById('tabCodes');
  const extractedContent = document.getElementById('extractedContent');
  const codesContent = document.getElementById('codesContent');

  if (tab === 'extracted') {
    tabExtracted.classList.add('active');
    tabCodes.classList.remove('active');
    extractedContent.classList.add('active');
    codesContent.classList.remove('active');
  } else {
    tabCodes.classList.add('active');
    tabExtracted.classList.remove('active');
    codesContent.classList.add('active');
    extractedContent.classList.remove('active');
  }
}

clearBtn.addEventListener('click', () => {
  extractedTextEl.value = '';
  renderCodes({});
  generateBtn.disabled = true;
  contentArea.style.display = 'none';
  soapOutput.style.display = 'none';
  soapText.textContent = '';
  chrome.storage.local.remove(['lastExtraction']);
  setStatus('Cleared');
});

getContentBtn.addEventListener('click', async () => {
  try {
    setStatus('Extracting content...', true);
    getContentBtn.disabled = true;
  contentArea.style.display = 'none';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { setStatus('No active tab'); getContentBtn.disabled = false; return; }

    // Execute extraction in all frames and aggregate
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      function: pageExtractor
    });

    if (!results || results.length === 0) {
      setStatus('Failed to run extractor');
      getContentBtn.disabled = false;
      return;
    }

    const agg = aggregateResults(results.map(r => r.result).filter(Boolean));

    // show extracted text and codes
    extractedTextEl.value = agg.text || '';
    renderCodes(agg.codes || {});

    // enable generate
    generateBtn.disabled = false;
    contentArea.style.display = 'block';
    setStatus(`Extraction completed. ${Object.values(agg.codes || {}).flat().length} codes found.`);

    // persist last extraction
    chrome.storage.local.set({ lastExtraction: agg });
  } catch (err) {
    setStatus('Error: ' + (err.message || err));
  } finally {
    getContentBtn.disabled = false;
  }
});

// Improved aggregation with error handling
function aggregateResults(results) {
  // results: array of objects returned by pageExtractor
  const aggregate = { text: '', codes: {}, totalCodes: 0, extractionTime: 0 };
  const start = Date.now();

  for (const r of results) {
    if (!r) continue;
    aggregate.text += (r.text || '') + '\n';
    for (const [type, list] of Object.entries(r.codes || {})) {
      if (!aggregate.codes[type]) aggregate.codes[type] = new Set();
      for (const c of (list || [])) if (c && c.toString().trim()) aggregate.codes[type].add(c.toString().trim());
    }
  }

  for (const k of Object.keys(aggregate.codes)) {
    aggregate.codes[k] = Array.from(aggregate.codes[k]);
    aggregate.totalCodes += aggregate.codes[k].length;
  }
  aggregate.extractionTime = Date.now() - start;
  return aggregate;
}



// The function that will run in the page context to extract text and codes
function pageExtractor() {
  try {
    const ignoredTags = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','IMG','SVG','CANVAS','INPUT','BUTTON','SELECT','OPTION']);
    // Collect body visible text
    let text = (document.body && document.body.innerText) ? document.body.innerText : '';

    // Collect focused areas: elements with class or id hints
    const hintSelectors = '[class*=note],[class*=notes],[class*=clinical],[class*=narrative],[id*=note],[id*=notes],[id*=clinical],[id*=narrative],[class*=visit],[id*=visit],[class*=encounter],[id*=encounter]';
    try {
      const hints = document.querySelectorAll(hintSelectors);
      hints.forEach(el => { if (el && el.innerText) text += '\n' + el.innerText; });
    } catch(e) {}

    // Collect textarea/input values
    const inputs = document.querySelectorAll('textarea, input[type=text], [contenteditable="true"]');
    inputs.forEach(i => { try { text += '\n' + (i.value || i.innerText || i.textContent || ''); } catch(e) {} });

    // Normalize whitespace
    text = text.replace(/\u00A0/g,' ').replace(/\s+/, ' ').trim();

    const codes = {};
    // ICD-10 e.g. J20.9 or A01
    const icdRegex = /\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b/g;
    const icd = (text.match(icdRegex) || []).map(s => s.trim());
    codes['ICD-10'] = [...new Set(icd)];

    // CPT 5-digit
    const cptRegex = /\b\d{5}\b/g;
    const cpt = (text.match(cptRegex) || []).map(s => s.trim());
    codes['CPT'] = [...new Set(cpt)];

    // SNOMED - long numeric identifiers often shown as 'SNOMED CT:123456789'
    const snomedRegex = /(?:SNOMED[: ]+CT[: ]*)?(\d{6,18})/gi;
    let sm = [];
    let m;
    while ((m = snomedRegex.exec(text)) !== null) sm.push(m[1]);
    codes['SNOMED'] = [...new Set(sm)];

    return { text: text.substring(0, 16000), codes };
  } catch (err) {
    return { text: '', codes: {} };
  }
}

// Enhanced display with filtering, sorting, export options
function renderCodes(codes) {
  icdListEl.innerHTML = '';
  cptListEl.innerHTML = '';
  snomedListEl.innerHTML = '';

  (codes['ICD-10'] || []).forEach(c => icdListEl.appendChild(createChip(c)));
  (codes['CPT'] || []).forEach(c => cptListEl.appendChild(createChip(c)));
  (codes['SNOMED'] || []).forEach(c => snomedListEl.appendChild(createChip(c)));
}

function createChip(text) {
  const d = document.createElement('div');
  d.className = 'chip';
  d.textContent = text;
  d.title = 'Click to highlight on page';
  d.style.cursor = 'pointer';
  d.onclick = () => highlightOnPage(text);
  return d;
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
// Load cached extraction if present
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['lastExtraction'], (res) => {
    if (res.lastExtraction) {
      extractedTextEl.value = res.lastExtraction.text || '';
      renderCodes(res.lastExtraction.codes || {});
      generateBtn.disabled = false;
      contentArea.style.display = 'block';
      setStatus('Loaded cached extraction');
    }
  });
});

// Generate SOAP button handler
generateBtn.addEventListener('click', async () => {
  const content = extractedTextEl.value.trim();
  if (!content) { setStatus('No content to send'); return; }

  setStatus('Generating SOAP...', true);
  generateBtn.disabled = true;
  try {
    // Get API key from options
    const options = await new Promise(resolve => chrome.storage.sync.get({ apiKey: '' }, resolve));
    const apiKey = options.apiKey;
    if (!apiKey) {
      setStatus('API key not configured. Please set it in extension options.');
      generateBtn.disabled = false;
      return;
    }

    const res = await new Promise(resolve => chrome.storage.local.get(['lastExtraction'], resolve));
    const codes = res.lastExtraction?.codes || {};

    // Prepare codes info
    let codesInfo = '';
    if (Object.keys(codes).length > 0) {
      codesInfo = 'Extracted codes:\n';
      Object.entries(codes).forEach(([type, list]) => {
        if (list.length > 0) codesInfo += `${type}: ${list.join(', ')}\n`;
      });
    }

    const prompt = `You are a clinical scribe. Produce a concise SOAP note (Subjective, Objective, Assessment, Plan) from the clinical content below. Include relevant extracted codes when appropriate. Return plain text with clear S:, O:, A:, P: sections.\n\nClinical content:\n${content}\n\n${codesInfo}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      setStatus('API error: ' + resp.status + ' ' + errText);
      generateBtn.disabled = false;
      return;
    }

    const data = await resp.json();
    const answer = data.content?.[0]?.text || '';

    // Show generated SOAP below the button
    soapText.textContent = answer.trim();
    soapOutput.style.display = 'block';
    setStatus('SOAP generated');
  } catch (e) {
    setStatus('Generation failed: ' + (e.message || e));
  } finally {
    generateBtn.disabled = false;
  }
});
