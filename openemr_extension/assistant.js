// Assistant logic - Runs inside the iframe
(function () {
    'use strict';

    // DOM Elements
    const closePanel = document.getElementById('closePanel');
    const getContentBtn = document.getElementById('getContentBtn');
    const clearContent = document.getElementById('clearContent');
    const generateSoapBtn = document.getElementById('generateSoapBtn');
    const regenerateBtn = document.getElementById('regenerateBtn');
    const backToContent = document.getElementById('backToContent');
    const extractedTextEl = document.getElementById('extractedText');
    const statusEl = document.getElementById('status');

    // State containers
    const initialState = document.getElementById('initialState');
    const contentState = document.getElementById('contentState');
    const resultsState = document.getElementById('resultsState');

    // SOAP elements
    const soapSubjective = document.getElementById('soapSubjective');
    const soapObjective = document.getElementById('soapObjective');
    const soapAssessment = document.getElementById('soapAssessment');
    const soapPlan = document.getElementById('soapPlan');
    const icdCodesGrid = document.getElementById('icdCodesGrid');
    const cptCodesGrid = document.getElementById('cptCodesGrid');

    // Tab elements
    const tabSoap = document.getElementById('tabSoap');
    const tabCodes = document.getElementById('tabCodes');
    const soapTab = document.getElementById('soapTab');
    const codesTab = document.getElementById('codesTab');

    // State management
    let currentState = 'initial'; // 'initial', 'content', 'results'

    // Close panel handler
    closePanel.addEventListener('click', () => {
        window.parent.postMessage({ action: 'closePanel' }, '*');
    });

    // Set status message
    function setStatus(msg, busy = false) {
        statusEl.innerHTML = msg + (busy ? ' <span class="spinner"></span>' : '');
    }

    // Switch between states
    function switchState(state) {
        currentState = state;

        initialState.style.display = state === 'initial' ? 'flex' : 'none';
        contentState.style.display = state === 'content' ? 'flex' : 'none';
        resultsState.style.display = state === 'results' ? 'flex' : 'none';
    }

    // Tab switching
    tabSoap.addEventListener('click', () => {
        tabSoap.classList.add('active');
        tabCodes.classList.remove('active');
        soapTab.classList.add('active');
        codesTab.classList.remove('active');
    });

    tabCodes.addEventListener('click', () => {
        tabCodes.classList.add('active');
        tabSoap.classList.remove('active');
        codesTab.classList.add('active');
        soapTab.classList.remove('active');
    });

    // Clear content
    clearContent.addEventListener('click', () => {
        extractedTextEl.value = '';
        chrome.storage.local.remove(['lastExtraction']);
        switchState('initial');
        setStatus('Cleared');
    });

    // Back to content
    backToContent.addEventListener('click', () => {
        switchState('content');
        setStatus('Ready');
    });

    // Get content from page
    getContentBtn.addEventListener('click', async () => {
        try {
            setStatus('Extracting content...', true);
            getContentBtn.disabled = true;

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                setStatus('No active tab');
                getContentBtn.disabled = false;
                return;
            }

            // Execute extraction in all frames
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                function: pageExtractor
            });

            if (!results || results.length === 0) {
                setStatus('Failed to extract content');
                getContentBtn.disabled = false;
                return;
            }

            const agg = aggregateResults(results.map(r => r.result).filter(Boolean));

            // Show extracted text
            extractedTextEl.value = agg.text || '';

            // Save to storage
            chrome.storage.local.set({ lastExtraction: agg });

            // Switch to content state
            switchState('content');
            setStatus('Extraction completed');
        } catch (err) {
            setStatus('Error: ' + (err.message || err));
        } finally {
            getContentBtn.disabled = false;
        }
    });

    // Aggregate extraction results
    function aggregateResults(results) {
        const aggregate = { text: '', codes: {}, totalCodes: 0 };

        for (const r of results) {
            if (!r) continue;
            aggregate.text += (r.text || '') + '\n';
            for (const [type, list] of Object.entries(r.codes || {})) {
                if (!aggregate.codes[type]) aggregate.codes[type] = new Set();
                for (const c of (list || [])) {
                    if (c && c.toString().trim()) {
                        aggregate.codes[type].add(c.toString().trim());
                    }
                }
            }
        }

        for (const k of Object.keys(aggregate.codes)) {
            aggregate.codes[k] = Array.from(aggregate.codes[k]);
            aggregate.totalCodes += aggregate.codes[k].length;
        }

        return aggregate;
    }

    // Page extractor function (runs in page context)
    function pageExtractor() {
        try {
            let text = (document.body && document.body.innerText) ? document.body.innerText : '';

            const hintSelectors = '[class*=note],[class*=notes],[class*=clinical],[class*=narrative],[id*=note],[id*=notes],[id*=clinical],[id*=narrative],[class*=visit],[id*=visit],[class*=encounter],[id*=encounter]';
            try {
                const hints = document.querySelectorAll(hintSelectors);
                hints.forEach(el => { if (el && el.innerText) text += '\n' + el.innerText; });
            } catch (e) { }

            const inputs = document.querySelectorAll('textarea, input[type=text], [contenteditable="true"]');
            inputs.forEach(i => {
                try {
                    text += '\n' + (i.value || i.innerText || i.textContent || '');
                } catch (e) { }
            });

            text = text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

            const codes = {};

            // ICD-10 codes
            const icdRegex = /\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b/g;
            const icd = (text.match(icdRegex) || []).map(s => s.trim());
            codes['ICD-10'] = [...new Set(icd)];

            // CPT codes
            const cptRegex = /\b\d{5}\b/g;
            const cpt = (text.match(cptRegex) || []).map(s => s.trim());
            codes['CPT'] = [...new Set(cpt)];

            // SNOMED codes
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

    // Generate SOAP note
    async function generateSoap() {
        const content = extractedTextEl.value.trim();
        if (!content) {
            setStatus('No content to generate from');
            return;
        }

        setStatus('Generating SOAP note...', true);
        generateSoapBtn.disabled = true;
        regenerateBtn.disabled = true;

        try {
            const options = await chrome.storage.sync.get({ apiKey: '' });
            const apiKey = options.apiKey || '';

            if (!apiKey) {
                setStatus('Please set your API key in extension options');
                generateSoapBtn.disabled = false;
                regenerateBtn.disabled = false;
                return;
            }

            const res = await chrome.storage.local.get(['lastExtraction']);
            const codes = res.lastExtraction?.codes || {};

            let codesInfo = '';
            if (Object.keys(codes).length > 0) {
                codesInfo = 'Extracted codes:\n';
                Object.entries(codes).forEach(([type, list]) => {
                    if (list.length > 0) codesInfo += `${type}: ${list.join(', ')}\n`;
                });
            }

            const truncatedContent = content.length > 4000 ? content.substring(0, 4000) + '...' : content;

            const prompt = `You are a clinical scribe. Based on the clinical content below, generate a concise SOAP note (keep each section under 150 words) with suggested ICD-10 and CPT codes.

IMPORTANT: Return ONLY valid JSON in this exact format. Do not include any markdown, code fences, explanations, or additional text before or after. Just the JSON object:

{
  "soap_content": {
    "subjective": "Brief subjective section...",
    "objective": "Brief objective findings...",
    "assessment": "Brief assessment...",
    "plan": "Brief plan..."
  },
  "codes": {
    "icd10": [{"code": "A01.0", "description": "Brief description"}],
    "cpt": [{"code": "99201", "description": "Brief description"}]
  }
}

Clinical content:
${truncatedContent}

${codesInfo}

Output only the JSON, start with { and end with }:`;

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
                    max_tokens: 2048
                })
            });

            if (!resp.ok) {
                const errText = await resp.text();
                setStatus('API error: ' + resp.status);
                generateSoapBtn.disabled = false;
                regenerateBtn.disabled = false;
                return;
            }

            const data = await resp.json();
            const answer = data.content?.[0]?.text || '';

            let parsed;
            try {
                parsed = JSON.parse(answer.trim());
            } catch (e) {
                const jsonMatch = answer.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        parsed = JSON.parse(jsonMatch[0]);
                    } catch (e2) {
                        setStatus('Failed to parse AI response');
                        generateSoapBtn.disabled = false;
                        regenerateBtn.disabled = false;
                        return;
                    }
                } else {
                    setStatus('No valid JSON in AI response');
                    generateSoapBtn.disabled = false;
                    regenerateBtn.disabled = false;
                    return;
                }
            }

            // Populate results
            populateResults(parsed.soap_content || {}, parsed.codes || {});

            // Switch to results state
            switchState('results');
            setStatus('SOAP note generated');
        } catch (e) {
            setStatus('Generation failed: ' + (e.message || e));
        } finally {
            generateSoapBtn.disabled = false;
            regenerateBtn.disabled = false;
        }
    }

    // Populate results
    function populateResults(soapContent, codes) {
        soapSubjective.textContent = soapContent.subjective || '';
        soapObjective.textContent = soapContent.objective || '';
        soapAssessment.textContent = soapContent.assessment || '';
        soapPlan.textContent = soapContent.plan || '';

        icdCodesGrid.innerHTML = '';
        (codes.icd10 || []).forEach(code => {
            const pill = document.createElement('div');
            pill.className = 'code-pill';
            pill.innerHTML = `
        <span class="code-text">${code.code || code}</span>
        ${code.description ? `<span class="code-desc">${code.description}</span>` : ''}
      `;
            icdCodesGrid.appendChild(pill);
        });

        cptCodesGrid.innerHTML = '';
        (codes.cpt || []).forEach(code => {
            const pill = document.createElement('div');
            pill.className = 'code-pill';
            pill.innerHTML = `
        <span class="code-text">${code.code || code}</span>
        ${code.description ? `<span class="code-desc">${code.description}</span>` : ''}
      `;
            cptCodesGrid.appendChild(pill);
        });
    }

    // Event listeners
    generateSoapBtn.addEventListener('click', generateSoap);
    regenerateBtn.addEventListener('click', generateSoap);

    // Initialize
    setStatus('Ready');
})();
