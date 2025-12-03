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

    // Insert button
    const insertBtn = document.getElementById('insertBtn');

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
                setStatus('Failed to extract content'); l
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
            const apiKey = options.apiKey ;

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
    "icd10": [
      {
        "code": "A01.0",
        "active": "Yes",
        "codeType": "ICD10",
        "shortDescription": "Brief short description",
        "fullDescription": "Complete full description of the diagnosis",
        "price": ""
      }
    ],
    "cpt": [
      {
        "code": "99201",
        "active": "Yes",
        "codeType": "CPT4",
        "shortDescription": "Brief short description",
        "fullDescription": "Complete full description of the procedure",
        "price": "100.00"
      }
    ]
  }
}

Format requirements:
- For ICD-10 codes: Use proper ICD-10 format (e.g., A01.0, E11.9, J44.0)
- For CPT codes: Use 5-digit codes (e.g., 99201-99205 for office visits, 90000s for vaccines/immunizations)
- active: Always set to "Yes"
- codeType: "ICD10" for diagnosis codes, "CPT4" for procedure codes
- shortDescription: Brief name (under 50 characters)
- fullDescription: Complete description of the code
- price: For CPT codes, include reasonable pricing (e.g., "100.00" for basic office visit, "250.00" for complex procedures). Leave empty for ICD-10 codes.

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
        (codes.icd10 || []).forEach(codeObj => {
            const pill = document.createElement('div');
            pill.className = 'code-pill';

            // Handle both old format (string/simple object) and new format (detailed object)
            const code = codeObj.code || codeObj;
            const codeType = codeObj.codeType || 'ICD10';
            const shortDesc = codeObj.shortDescription || codeObj.description || '';
            const fullDesc = codeObj.fullDescription || codeObj.description || '';

            pill.innerHTML = `
                <span class="code-text">${code}</span>
                <span class="code-type">${codeType}</span>
                ${fullDesc ? `<span class="code-desc">${fullDesc}</span>` : ''}
            `;
            pill.title = `${code} - ${codeType}\n${fullDesc}`;
            icdCodesGrid.appendChild(pill);
        });

        cptCodesGrid.innerHTML = '';
        (codes.cpt || []).forEach(codeObj => {
            const pill = document.createElement('div');
            pill.className = 'code-pill';

            // Handle both old format (string/simple object) and new format (detailed object)
            const code = codeObj.code || codeObj;
            const codeType = codeObj.codeType || 'CPT4';
            const shortDesc = codeObj.shortDescription || codeObj.description || '';
            const fullDesc = codeObj.fullDescription || codeObj.description || '';
            const price = codeObj.price || '';

            pill.innerHTML = `
                <span class="code-text">${code}</span>
                <span class="code-type">${codeType}</span>
                ${fullDesc ? `<span class="code-desc">${fullDesc}</span>` : ''}
                ${price ? `<span class="code-price">$${price}</span>` : ''}
            `;
            pill.title = `${code} - ${codeType}\n${fullDesc}${price ? '\nPrice: $' + price : ''}`;
            cptCodesGrid.appendChild(pill);
        });
    }

    // Worker function to run inside the page (in all frames)
    async function insertionWorker(data, autoSave = false) {
        try {
            console.log('[Extension] insertionWorker called in frame:', window.location.href);
            console.log('[Extension] Data received:', data);

            let inserted = false;
            let soapUrl = null;
            let feeSheetUrl = null;

            // Helper to find textarea by various means
            const findTextarea = (key) => {
                // 1. Try exact ID or name match (case insensitive)
                let el = document.querySelector(`textarea[name*="${key}" i], textarea[id*="${key}" i]`);
                if (el) return el;

                // 2. Try finding by label
                const labels = Array.from(document.querySelectorAll('label, h2, h3, h4, div, span'));
                for (const label of labels) {
                    if (label.innerText && label.innerText.toLowerCase().includes(key.toLowerCase())) {
                        // Look for textarea in next siblings or children
                        const textarea = label.querySelector('textarea') ||
                            label.parentElement.querySelector('textarea') ||
                            label.parentElement.nextElementSibling?.querySelector('textarea') ||
                            label.nextElementSibling;
                        if (textarea && textarea.tagName === 'TEXTAREA') return textarea;
                    }
                }
                return null;
            };

            // Helper to find Save button
            const clickSave = () => {
                const saveBtns = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.button'));
                const saveBtn = saveBtns.find(b =>
                    b.innerText?.toLowerCase().includes('save') ||
                    b.value?.toLowerCase().includes('save') ||
                    b.id?.toLowerCase().includes('save')
                );
                if (saveBtn) {
                    saveBtn.click();
                    return true;
                }
                return false;
            };

            // Insert SOAP data
            if (data.soap) {
                console.log('[Extension] Attempting to insert SOAP data');

                const fields = {
                    'subjective': data.soap.subjective,
                    'objective': data.soap.objective,
                    'assessment': data.soap.assessment,
                    'plan': data.soap.plan
                };

                let soapFieldsFound = 0;
                for (const [key, value] of Object.entries(fields)) {
                    if (!value) continue;
                    const el = findTextarea(key);
                    if (el) {
                        console.log(`[Extension] Found ${key} field:`, el);
                        el.value = value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.dispatchEvent(new Event('blur', { bubbles: true }));
                        inserted = true;
                        soapFieldsFound++;
                    } else {
                        console.log(`[Extension] Could not find ${key} field`);
                    }
                }

                console.log(`[Extension] SOAP fields found: ${soapFieldsFound} / 4`);

                if (soapFieldsFound > 0 && autoSave) {
                    setTimeout(clickSave, 500);
                }
            }

            // Insert Codes - Direct table insertion
            if (data.icdCodes && data.icdCodes.length > 0 || data.cptCodes && data.cptCodes.length > 0) {
                console.log('[Extension] Attempting to insert codes');
                console.log('[Extension] ICD Codes:', data.icdCodes);
                console.log('[Extension] CPT Codes:', data.cptCodes);

                // Check if we're on the right page based on URL
                const currentUrl = window.location.href.toLowerCase();
                const isFeeSheetPage = currentUrl.includes('fee_sheet') ||
                    currentUrl.includes('billing') ||
                    currentUrl.includes('superbill');

                console.log('[Extension] URL check - Is Fee Sheet page?', isFeeSheetPage);
                console.log('[Extension] Current URL:', window.location.href);

                if (!isFeeSheetPage) {
                    console.warn('[Extension] ⚠️ WARNING: You may not be on the Fee Sheet page!');
                    console.warn('[Extension] Expected URL to contain: "fee_sheet", "billing", or "superbill"');
                    console.warn('[Extension] Current URL:', window.location.href);
                    console.warn('[Extension] Please navigate to the Fee Sheet tab before clicking Insert');
                }

                // Helper to find the "Selected Fee Sheet Codes and Charges for Current Encounter" table
                const findFeeSheetTable = () => {
                    console.log('[Extension] Searching for Fee Sheet table...');
                    console.log('[Extension] Current URL:', window.location.href);
                    console.log('[Extension] Page title:', document.title);

                    // Strategy 1: Look for the specific heading "Selected Fee Sheet Codes"
                    const allElements = Array.from(document.querySelectorAll('*'));
                    console.log(`[Extension] Checking ${allElements.length} elements for heading`);

                    for (const element of allElements) {
                        const text = element.innerText || element.textContent || '';

                        // Look for the section heading (more flexible matching)
                        if (text.includes('Selected Fee Sheet Codes') ||
                            text.includes('Fee Sheet Codes and Charges')) {
                            console.log('[Extension] Found Fee Sheet heading:', element);
                            console.log('[Extension] Heading text:', text.substring(0, 100));

                            // Found the heading, now find the table after it
                            let nextElement = element.nextElementSibling;

                            // Search through next siblings for a table
                            while (nextElement) {
                                if (nextElement.tagName === 'TABLE') {
                                    console.log('[Extension] Found table after heading:', nextElement);
                                    return nextElement;
                                }
                                // Also check if table is nested inside the next element
                                const nestedTable = nextElement.querySelector('table');
                                if (nestedTable) {
                                    console.log('[Extension] Found nested table:', nestedTable);
                                    return nestedTable;
                                }
                                nextElement = nextElement.nextElementSibling;
                            }

                            // If not found in siblings, check parent's next siblings
                            let parentNext = element.parentElement?.nextElementSibling;
                            while (parentNext) {
                                if (parentNext.tagName === 'TABLE') {
                                    console.log('[Extension] Found table in parent siblings:', parentNext);
                                    return parentNext;
                                }
                                const nestedTable = parentNext.querySelector('table');
                                if (nestedTable) {
                                    console.log('[Extension] Found nested table in parent siblings:', nestedTable);
                                    return nestedTable;
                                }
                                parentNext = parentNext.nextElementSibling;
                            }
                        }
                    }

                    // Strategy 2: Look for table with specific column headers
                    console.log('[Extension] Strategy 1 failed, trying header-based detection...');
                    const tables = Array.from(document.querySelectorAll('table'));
                    console.log(`[Extension] Found ${tables.length} tables on page`);

                    for (let i = 0; i < tables.length; i++) {
                        const table = tables[i];
                        const headerRow = table.querySelector('thead tr, tr:first-child');
                        if (headerRow) {
                            const headerText = headerRow.innerText.toLowerCase();
                            console.log(`[Extension] Table ${i + 1} headers:`, headerText);

                            // Check for Fee Sheet table headers (more flexible)
                            const hasType = headerText.includes('type');
                            const hasCode = headerText.includes('code');
                            const hasDescription = headerText.includes('description');
                            const hasPrice = headerText.includes('price');
                            const hasQty = headerText.includes('qty');

                            // Exclude "Select Code" tables
                            const isSelectCodeTable = headerText.includes('new patient') ||
                                headerText.includes('established patient');

                            console.log(`[Extension] Table ${i + 1} analysis:`, {
                                hasType, hasCode, hasDescription, hasPrice, hasQty, isSelectCodeTable
                            });

                            if (hasType && hasCode && hasDescription && !isSelectCodeTable) {
                                console.log('[Extension] Found matching Fee Sheet table!', table);
                                return table;
                            }
                        }
                    }

                    // Strategy 3: Look for any table with "Type" and "Code" columns (very permissive)
                    console.log('[Extension] Strategy 2 failed, trying permissive detection...');
                    for (let i = 0; i < tables.length; i++) {
                        const table = tables[i];
                        const headerRow = table.querySelector('tr');
                        if (headerRow) {
                            const cells = Array.from(headerRow.querySelectorAll('th, td'));
                            const cellTexts = cells.map(c => c.innerText.toLowerCase().trim());
                            console.log(`[Extension] Table ${i + 1} cell texts:`, cellTexts);

                            if (cellTexts.includes('type') && cellTexts.includes('code')) {
                                console.log('[Extension] Found table with Type and Code columns:', table);
                                return table;
                            }
                        }
                    }

                    console.log('[Extension] No Fee Sheet table found after all strategies');
                    return null;
                };



                // Helper to create a table row for a code
                const createCodeRow = (codeData, codeType) => {
                    console.log(`[Extension] Creating row for ${codeType}:`, codeData);

                    const row = document.createElement('tr');

                    // Mark this row as inserted by the extension so we can remove it later
                    row.setAttribute('data-extension-inserted', 'true');
                    row.setAttribute('data-code-type', codeType);
                    row.setAttribute('data-code-value', codeData.code || codeData);

                    // Determine the structure based on code type
                    const isICD = codeType === 'ICD10';
                    const code = codeData.code || codeData;
                    const description = codeData.fullDescription || codeData.shortDescription || codeData.description || code;
                    const price = codeData.price || (isICD ? '' : '0.00');

                    console.log(`[Extension] Row data - Code: ${code}, Desc: ${description}, Price: ${price}`);


                    // Match the exact OpenEMR table structure from the screenshot
                    // Columns: Type | Code | Description | Modifiers | Price | Qty | Justify | Note Codes | Auth | Delete

                    // Type cell (plain text, no input)
                    const typeCell = document.createElement('td');
                    typeCell.textContent = codeType;
                    row.appendChild(typeCell);

                    // Code cell (plain text, no input)
                    const codeCell = document.createElement('td');
                    codeCell.textContent = code;
                    row.appendChild(codeCell);

                    // Description cell (Truncated with click to expand)
                    const descCell = document.createElement('td');
                    descCell.title = "Click to view full description";
                    descCell.style.cursor = "pointer";
                    descCell.style.whiteSpace = "nowrap";
                    descCell.style.overflow = "hidden";
                    descCell.style.textOverflow = "ellipsis";
                    descCell.style.maxWidth = "300px"; // Limit width
                    descCell.style.display = "block"; // Needed for max-width to work in td sometimes, or use div inside

                    // Better approach: Put text in a div inside td
                    descCell.innerHTML = '';
                    const descDiv = document.createElement('div');
                    descDiv.textContent = description;
                    descDiv.style.whiteSpace = "nowrap";
                    descDiv.style.overflow = "hidden";
                    descDiv.style.textOverflow = "ellipsis";
                    descDiv.style.maxWidth = "350px";
                    descCell.appendChild(descDiv);

                    // Click handler to toggle expansion
                    descCell.onclick = function () {
                        if (descDiv.style.whiteSpace === "nowrap") {
                            descDiv.style.whiteSpace = "normal";
                            descDiv.style.overflow = "visible";
                            descDiv.style.textOverflow = "clip";
                        } else {
                            descDiv.style.whiteSpace = "nowrap";
                            descDiv.style.overflow = "hidden";
                            descDiv.style.textOverflow = "ellipsis";
                        }
                    };
                    row.appendChild(descCell);

                    // Modifiers cell (empty input)
                    const modCell = document.createElement('td');
                    modCell.innerHTML = '<input type="text" value="" />';
                    row.appendChild(modCell);

                    // Price cell (input with price)
                    const priceCell = document.createElement('td');
                    priceCell.innerHTML = `<input type="text" name="price[]" value="${price}" />`;
                    row.appendChild(priceCell);

                    // Qty cell (input - 1 for CPT, empty for ICD)
                    const qtyCell = document.createElement('td');
                    qtyCell.innerHTML = `<input type="text" name="qty[]" value="${isICD ? '' : '1'}" />`;
                    row.appendChild(qtyCell);

                    // Justify cell (dropdown/select - empty by default)
                    const justifyCell = document.createElement('td');
                    justifyCell.innerHTML = '<select name="justify[]"><option value=""></option></select>';
                    row.appendChild(justifyCell);

                    // Note Codes cell (empty input)
                    const noteCodesCell = document.createElement('td');
                    noteCodesCell.innerHTML = '<input type="text" value="" />';
                    row.appendChild(noteCodesCell);

                    // Auth cell (checkbox)
                    const authCell = document.createElement('td');
                    authCell.innerHTML = '<input type="checkbox" name="auth[]" />';
                    row.appendChild(authCell);

                    // Delete cell (checkbox)
                    const deleteCell = document.createElement('td');
                    deleteCell.innerHTML = '<input type="checkbox" name="delete[]" />';
                    row.appendChild(deleteCell);

                    return row;
                };

                // Helper to trigger recalculation of totals
                const recalculateTotals = () => {
                    // Look for total calculation functions in the page
                    if (typeof window.calc_total === 'function') {
                        window.calc_total();
                    }

                    // Dispatch change events on fee inputs to trigger calculations
                    const feeInputs = document.querySelectorAll('input[name="fee[]"]');
                    feeInputs.forEach(input => {
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                };

                // Main insertion logic
                try {
                    let table = findFeeSheetTable();

                    // SMART FIX: If table not found, try to find and click the "Fee Sheet" tab
                    if (!table) {
                        console.log('[Extension] Table not found. Looking for "Fee Sheet" tab to auto-navigate...');

                        // Look for the Fee Sheet tab/link
                        const allLinks = Array.from(document.querySelectorAll('a, li, span, div'));
                        const feeSheetTab = allLinks.find(el => {
                            const text = (el.innerText || '').toLowerCase().trim();
                            return text === 'fee sheet' && el.offsetParent !== null; // Must be visible
                        });

                        if (feeSheetTab) {
                            console.log('[Extension] Found Fee Sheet tab! Attempting to click...', feeSheetTab);
                            feeSheetTab.click();

                            // Wait for potential iframe load or AJAX update
                            console.log('[Extension] Waiting for Fee Sheet to load...');
                            await new Promise(resolve => setTimeout(resolve, 1500));

                            // Try finding table again
                            table = findFeeSheetTable();
                            if (table) {
                                console.log('[Extension] Success! Found table after navigation.');
                            } else {
                                console.log('[Extension] Still could not find table after navigation.');

                                // Try looking in new frames?
                                // We can't easily jump frames here, but often the tab loads in the SAME frame or a child
                                // If it's a child frame, we might need to rely on the user clicking Insert again
                                // But let's try one more fallback - check if a new iframe appeared
                                const iframes = document.querySelectorAll('iframe');
                                if (iframes.length > 0) {
                                    console.log(`[Extension] Found ${iframes.length} iframes. The table might be inside one of them.`);
                                    // Removed the return statement here to allow the process to continue
                                    // and potentially find the table in the newly loaded content.
                                }
                            }
                        } else {
                            console.log('[Extension] Could not find "Fee Sheet" tab to click.');
                        }
                    }

                    if (!table) {
                        console.error('[Extension] Could not find Fee Sheet table');
                        return { success: false, error: 'Fee Sheet table not found. Please make sure you are on the Fee Sheet tab.' };
                    }

                    console.log('[Extension] Found Fee Sheet table, proceeding with insertion');
                    const tbody = table.querySelector('tbody') || table;

                    // IMPORTANT: Remove all previously inserted rows by the extension
                    // This prevents duplicates when clicking "Insert" multiple times
                    const previouslyInserted = tbody.querySelectorAll('tr[data-extension-inserted="true"]');
                    console.log(`[Extension] Removing ${previouslyInserted.length} previously inserted rows`);
                    previouslyInserted.forEach(row => row.remove());

                    // 1. Find the Header Row
                    let headerRow = null;
                    const allRows = Array.from(tbody.querySelectorAll('tr'));

                    // Log all rows to debug structure
                    console.log(`[Extension] Scanning ${allRows.length} rows for header...`);

                    for (const row of allRows) {
                        const text = row.innerText.toLowerCase();
                        // Relaxed check: just Type, Code, Description
                        if (text.includes('type') && text.includes('code') && text.includes('description')) {
                            headerRow = row;
                            console.log('[Extension] FOUND HEADER ROW:', row);
                            break;
                        }
                    }

                    // 2. Force Header to Top
                    if (headerRow) {
                        // Check if it's already at the top
                        if (tbody.firstElementChild !== headerRow) {
                            console.log('[Extension] Moving header row to the very top of tbody');
                            tbody.prepend(headerRow);
                        }
                    } else {
                        // Fallback: Check THEAD
                        const thead = table.querySelector('thead');
                        if (thead) {
                            const theadRow = thead.querySelector('tr');
                            if (theadRow && theadRow.innerText.toLowerCase().includes('type')) {
                                console.log('[Extension] Found header in THEAD');
                                headerRow = theadRow;
                            }
                        }

                        if (!headerRow) {
                            console.error('[Extension] CRITICAL: Could not find header row. Table structure is unexpected.');
                            // We will continue, but layout might be wrong.
                            // Try to use the first row as anchor if it looks like a header?
                            if (allRows.length > 0) {
                                console.warn('[Extension] Using first row as fallback anchor');
                                headerRow = allRows[0];
                            }
                        }
                    }

                    // 3. Prepare New Rows
                    const fragment = document.createDocumentFragment();
                    let insertedCount = 0;

                    // Helper to add to fragment
                    const addToFragment = (codeData, type) => {
                        const row = createCodeRow(codeData, type);
                        fragment.appendChild(row);
                        insertedCount++;
                    };

                    // Add ICD codes
                    if (data.icdCodes && data.icdCodes.length > 0) {
                        console.log(`[Extension] Adding ${data.icdCodes.length} ICD codes to fragment`);
                        data.icdCodes.forEach(code => addToFragment(code, 'ICD10'));
                    }

                    // Add CPT codes
                    if (data.cptCodes && data.cptCodes.length > 0) {
                        console.log(`[Extension] Adding ${data.cptCodes.length} CPT codes to fragment`);
                        data.cptCodes.forEach(code => addToFragment(code, 'CPT4'));
                    }

                    // 4. Insert Fragment
                    if (insertedCount > 0) {
                        if (headerRow) {
                            console.log('[Extension] Inserting new rows AFTER header row');
                            headerRow.after(fragment);
                        } else {
                            console.log('[Extension] No header row anchor. Appending new rows to tbody.');
                            tbody.appendChild(fragment);
                        }
                    }




                    console.log(`[Extension] Successfully inserted ${insertedCount} code rows`);

                    // Trigger any recalculation functions
                    if (insertedCount > 0) {
                        setTimeout(() => recalculateTotals(), 100);

                        // Auto-save if requested
                        if (autoSave) {
                            setTimeout(() => clickSave(), 500);
                        }
                    }

                    inserted = insertedCount > 0;
                } catch (e) {
                    console.error('[Extension] Error inserting codes directly:', e);
                    return { success: false, error: e.message };
                }
            }

            // If nothing was inserted, look for links to the correct pages
            if (!inserted) {
                console.log('[Extension] No fields found, searching for navigation links...');
                const links = Array.from(document.querySelectorAll('a'));
                console.log(`[Extension] Found ${links.length} links on page`);

                // Find SOAP link
                const soapLink = links.find(a => a.innerText && (
                    a.innerText.toLowerCase() === 'soap' ||
                    a.innerText.toLowerCase().includes('soap note') ||
                    a.innerText.toLowerCase().includes('clinical')
                ));
                if (soapLink) {
                    soapUrl = soapLink.href;
                    console.log('[Extension] Found SOAP link:', soapUrl);
                } else {
                    console.log('[Extension] No SOAP link found');
                }

                // Find Fee Sheet link
                const feeLink = links.find(a => a.innerText && (
                    a.innerText.toLowerCase() === 'fee sheet' ||
                    a.innerText.toLowerCase().includes('fee sheet') ||
                    a.innerText.toLowerCase().includes('billing') ||
                    a.innerText.toLowerCase().includes('coding')
                ));
                if (feeLink) {
                    feeSheetUrl = feeLink.href;
                    console.log('[Extension] Found Fee Sheet link:', feeSheetUrl);
                } else {
                    console.log('[Extension] No Fee Sheet link found');
                }
            }

            const result = { success: inserted, soapUrl, feeSheetUrl };
            console.log('[Extension] Returning result:', result);
            return result;
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    // Insert into OpenEMR functionality
    async function insertIntoOpenEMR() {
        setStatus('Inserting into OpenEMR...', true);
        insertBtn.disabled = true;

        try {
            // Get the active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                setStatus('No active tab found');
                insertBtn.disabled = false;
                return;
            }

            // Get the generated SOAP and codes data
            const soapData = {
                subjective: soapSubjective.textContent,
                objective: soapObjective.textContent,
                assessment: soapAssessment.textContent,
                plan: soapPlan.textContent
            };

            // Get codes from the grids - Extract full code objects
            const icdCodes = [];
            const cptCodes = [];

            icdCodesGrid.querySelectorAll('.code-pill').forEach(pill => {
                const codeText = pill.querySelector('.code-text');
                const codeType = pill.querySelector('.code-type');
                const codeDesc = pill.querySelector('.code-desc');

                if (codeText) {
                    icdCodes.push({
                        code: codeText.textContent.trim(),
                        codeType: codeType ? codeType.textContent.trim() : 'ICD10',
                        description: codeDesc ? codeDesc.textContent.trim() : '',
                        fullDescription: codeDesc ? codeDesc.textContent.trim() : '',
                        shortDescription: codeDesc ? codeDesc.textContent.trim().substring(0, 50) : '',
                        price: '',
                        active: 'Yes'
                    });
                }
            });

            cptCodesGrid.querySelectorAll('.code-pill').forEach(pill => {
                const codeText = pill.querySelector('.code-text');
                const codeType = pill.querySelector('.code-type');
                const codeDesc = pill.querySelector('.code-desc');
                const codePrice = pill.querySelector('.code-price');

                if (codeText) {
                    cptCodes.push({
                        code: codeText.textContent.trim(),
                        codeType: codeType ? codeType.textContent.trim() : 'CPT4',
                        description: codeDesc ? codeDesc.textContent.trim() : '',
                        fullDescription: codeDesc ? codeDesc.textContent.trim() : '',
                        shortDescription: codeDesc ? codeDesc.textContent.trim().substring(0, 50) : '',
                        price: codePrice ? codePrice.textContent.trim().replace('$', '') : '0.00',
                        active: 'Yes'
                    });
                }
            });

            console.log('[Extension] Extracted ICD codes:', icdCodes);
            console.log('[Extension] Extracted CPT codes:', cptCodes);


            // 1. Try to insert in the current page (all frames)
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: insertionWorker,
                args: [{
                    soap: soapData,
                    icdCodes: icdCodes,
                    cptCodes: cptCodes
                }, false] // autoSave = false for current page (let user review)
            });

            // Check results
            let inserted = false;
            let foundSoapUrl = null;
            let foundFeeSheetUrl = null;

            for (const r of results) {
                if (r.result) {
                    if (r.result.success) inserted = true;
                    if (r.result.soapUrl) foundSoapUrl = r.result.soapUrl;
                    if (r.result.feeSheetUrl) foundFeeSheetUrl = r.result.feeSheetUrl;
                }
            }

            if (inserted) {
                setStatus('✓ Successfully inserted into OpenEMR');
                setTimeout(() => setStatus('Ready'), 3000);
            } else if (foundSoapUrl || foundFeeSheetUrl) {
                // 2. If not inserted but links found, open them in background and insert
                setStatus('Opening forms in background...', true);

                let actionsTaken = [];

                if (foundSoapUrl) {
                    const newTab = await chrome.tabs.create({ url: foundSoapUrl, active: false });

                    // Wait for tab to load
                    await new Promise(resolve => {
                        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                            if (tabId === newTab.id && info.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);
                                setTimeout(resolve, 2000); // Wait extra time for frames to init
                            }
                        });
                    });

                    // Insert and Auto-Save
                    await chrome.scripting.executeScript({
                        target: { tabId: newTab.id, allFrames: true }, // IMPORTANT: Run in all frames
                        func: insertionWorker,
                        args: [{ soap: soapData }, true] // autoSave = true
                    });
                    actionsTaken.push('SOAP');

                    // Optional: Close tab after a delay? Better to leave open for review
                }

                if (foundFeeSheetUrl) {
                    const newTab = await chrome.tabs.create({ url: foundFeeSheetUrl, active: false });

                    // Wait for tab to load
                    await new Promise(resolve => {
                        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                            if (tabId === newTab.id && info.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);
                                setTimeout(resolve, 2000); // Wait extra time for frames to init
                            }
                        });
                    });

                    // Insert and Auto-Save
                    await chrome.scripting.executeScript({
                        target: { tabId: newTab.id, allFrames: true }, // IMPORTANT: Run in all frames
                        func: insertionWorker,
                        args: [{ icdCodes, cptCodes }, true] // autoSave = true
                    });
                    actionsTaken.push('Fee Sheet');
                }

                setStatus(`✓ Opened & Updated: ${actionsTaken.join(', ')}`);
                setTimeout(() => setStatus('Ready'), 4000);

            } else {
                setStatus('Could not find SOAP/Fee Sheet fields or links. Try navigating to the page manually.');
            }
        } catch (error) {
            console.error('Insert error:', error);
            setStatus('Error: ' + error.message);
        } finally {
            insertBtn.disabled = false;
        }
    }

    // Event listeners
    generateSoapBtn.addEventListener('click', generateSoap);
    regenerateBtn.addEventListener('click', generateSoap);
    insertBtn.addEventListener('click', insertIntoOpenEMR);

    // Initialize
    setStatus('Ready');
})();
