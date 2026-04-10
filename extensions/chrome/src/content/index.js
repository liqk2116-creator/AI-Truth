// Content script - injected into claude.ai, chatgpt.com, gemini.google.com
// Depends on: utils/labelParser.js (extractTags), utils/colorMapper.js (getColorLevel)

(function () {
  'use strict';

  let enabled = true;
  let destroyed = false;
  let mode = 'audit'; // default: audit
  const counts = { red: 0, orange: 0, gray: 0, green: 0 };

  // --- Tag metadata for hover cards ---
  const TAG_META = {
    S1: { role: 'Primary evidence', def: 'Multiple independent strong sources confirmed' },
    S2: { role: 'Primary evidence', def: 'Single strong source (official/regulatory/original)' },
    S3: { role: 'Primary evidence', def: 'Weak or secondary source' },
    M1: { role: 'Primary evidence', def: 'Stable consensus knowledge' },
    M2: { role: 'Primary evidence', def: 'Training memory, possibly outdated' },
    M3: { role: 'Primary evidence', def: 'Time-sensitive, should have been searched' },
    U:  { role: 'Primary evidence', def: 'User-provided, not externally verified' },
    R1: { role: 'Reasoning modifier', def: 'Mechanically verifiable deduction' },
    R2: { role: 'Reasoning modifier', def: 'Framework-dependent judgment' },
    R3: { role: 'Reasoning modifier', def: 'Open synthesis, high inference gap' },
    C:  { role: 'Creative modifier', def: 'Generative ideation or design' },
    F:  { role: 'Uncertainty flag', def: 'Insufficient evidence or conflicting information' },
  };

  function hasFragileTag(tags) {
    return tags.includes('F');
  }

  // --- Context validity (Chrome extension) ---
  function isContextValid() {
    try { return !!chrome.runtime.id; } catch (e) { return false; }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try { observer.disconnect(); } catch (e) {}
  }

  function safeChromeCall(fn) {
    if (!isContextValid()) { destroy(); return; }
    try { fn(); } catch (e) {
      if (e.message && e.message.includes('Extension context invalidated')) destroy();
    }
  }

  // --- Load state ---
  safeChromeCall(() => {
    chrome.storage.local.get(['credEnabled', 'credMode'], (result) => {
      if (chrome.runtime.lastError || destroyed) return;
      enabled = result.credEnabled !== false;
      mode = result.credMode || 'audit';
      applyMode();
      if (enabled) scanAll();
    });
  });

  safeChromeCall(() => {
    chrome.storage.onChanged.addListener((changes) => {
      if (destroyed || !isContextValid()) return;
      if (changes.credEnabled) {
        enabled = changes.credEnabled.newValue;
        if (enabled) scanAll(); else removeAll();
      }
      if (changes.credMode) {
        mode = changes.credMode.newValue;
        applyMode();
      }
    });
  });

  // --- Mode toggle ---
  function applyMode() {
    try {
      document.body.classList.toggle('mode-simple', mode === 'simple');
      document.body.classList.toggle('mode-audit', mode === 'audit');
    } catch (e) {}
    if (modeBtn) modeBtn.textContent = mode === 'simple' ? 'Simple' : 'Audit';
  }

  // --- Floating mode button (Shadow DOM to survive SPA re-renders) ---
  const modeBtnHost = document.createElement('div');
  modeBtnHost.id = 'cred-mode-toggle-host';
  modeBtnHost.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:2147483647;';
  const modeBtnShadow = modeBtnHost.attachShadow({ mode: 'open' });
  const modeBtnStyle = document.createElement('style');
  modeBtnStyle.textContent =
    'button{background:#374151;color:#F9FAFB;border:none;padding:4px 12px;' +
    'border-radius:4px;font-size:12px;cursor:pointer;font-family:sans-serif;}' +
    'button:hover{background:#4B5563;}';
  const modeBtn = document.createElement('button');
  modeBtn.textContent = 'Audit';
  modeBtnShadow.appendChild(modeBtnStyle);
  modeBtnShadow.appendChild(modeBtn);
  modeBtn.addEventListener('click', () => {
    mode = mode === 'simple' ? 'audit' : 'simple';
    applyMode();
    safeChromeCall(() => {
      chrome.storage.local.set({ credMode: mode });
    });
  });

  // Append to <html> (documentElement), not <body>.
  // SPAs like ChatGPT may clear/replace body contents but never touch <html>.
  document.documentElement.appendChild(modeBtnHost);

  // Re-attach if somehow removed — independent of observer/destroyed state
  function ensureModeBtn() {
    if (!document.documentElement.contains(modeBtnHost)) {
      document.documentElement.appendChild(modeBtnHost);
    }
  }

  // Persistent polling: keeps button alive, recovers from destroyed state,
  // and catches paragraphs that the MutationObserver + debounce missed
  // (e.g. late renders after streaming ends).
  setInterval(() => {
    ensureModeBtn();
    if (destroyed && isContextValid()) {
      destroyed = false;
      try {
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (e) {}
    }
    if (enabled && !destroyed) scanAll();
  }, 1500);

  // --- Find paragraphs ---
  function findParagraphs() {
    const selectors = [
      // Claude
      '[data-testid*="assistant-message"] p, [data-testid*="assistant-message"] li',
      '[data-testid*="assistant"] p, [data-testid*="assistant"] li',
      '.font-claude-message p, .font-claude-message li',
      '[class*="Message"][class*="assistant"] p, [class*="Message"][class*="assistant"] li',
      // ChatGPT
      '[data-message-author-role="assistant"] p, [data-message-author-role="assistant"] li',
      '.markdown.prose p, .markdown.prose li',
      '[class*="markdown"][class*="result"] p, [class*="markdown"][class*="result"] li',
      // Gemini
      '.model-response-text p, .model-response-text li',
      '.response-container p, .response-container li',
      'message-content p, message-content li',
      '[class*="response"][class*="container"] p, [class*="response"][class*="container"] li',
      '.markdown-main-panel p, .markdown-main-panel li',
      // Broad fallbacks
      '[data-is-streaming] p, [data-is-streaming] li',
      '.prose p, .prose li',
    ];
    const seen = new Set();
    const result = [];
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!seen.has(el)) { seen.add(el); result.push(el); }
        });
      } catch (e) {}
    }
    return result;
  }

  // --- Hover card creation ---
  function createHoverCard(tags) {
    const card = document.createElement('div');
    card.className = 'cred-hover-card';
    let html = '';
    for (const tag of tags) {
      const meta = TAG_META[tag];
      if (meta) {
        html += '<div class="tag-row">' +
          '<div class="tag-name">' + escHtml(tag) + '</div>' +
          '<div class="tag-role">' + meta.role + '</div>' +
          '<div class="tag-def">' + meta.def + '</div>' +
          '</div>';
      }
    }
    card.innerHTML = html;
    return card;
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Check if element is inside a streaming message ---
  function isStreaming(el) {
    return !!(el.closest('[data-is-streaming="true"]') || el.closest('.result-streaming'));
  }

  // --- Append a summary pill to element (non-destructive — never replaces text nodes) ---
  function replaceLabelsInElement(el) {
    // Remove any existing pill first
    el.querySelectorAll('.cred-label-pill').forEach(p => p.remove());

    const text = el.textContent || '';
    const labelPattern = /\[([^\]]*\b(?:S[1-3]|M[1-3]|R[1-3]|U|C|F)\b[^\]]*)\]/g;

    const allTags = [];
    let match;
    while ((match = labelPattern.exec(text)) !== null) {
      const cleaned = match[1].replace(/[\u26A0\uFE0F\u2757]/g, '').replace(/[\u4e00-\u9fff]+/g, '');
      const tagRe = /\b(S[1-3]|M[1-3]|R[1-3]|U|C|F)\b/g;
      let tm;
      while ((tm = tagRe.exec(cleaned)) !== null) {
        if (!allTags.includes(tm[1])) allTags.push(tm[1]);
      }
    }

    if (allTags.length === 0) return;

    // Append a single summary pill at the end (does not modify text nodes)
    const pill = document.createElement('span');
    pill.className = 'cred-label-pill';
    pill.textContent = allTags.join('·');
    pill.dataset.tags = JSON.stringify(allTags);
    el.appendChild(pill);
  }

  // --- Get text content excluding our own pill elements (read-only, no DOM mutation) ---
  function getCleanText(el) {
    const pills = el.querySelectorAll('.cred-label-pill');
    if (pills.length === 0) return el.textContent || '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.cred-label-pill').forEach(p => p.remove());
    return clone.textContent || '';
  }

  // --- Process paragraph ---
  function processParagraph(p) {
    // Skip paragraphs inside actively streaming messages
    if (isStreaming(p)) return;

    const text = getCleanText(p);
    const tags = extractTags(text);

    // No labels found — don't mark as processed so we can re-check later
    // (streaming may add labels after initial render)
    if (tags.length === 0) return;

    // Already processed and content hasn't changed — skip entirely
    if (p.dataset.credProcessed && p.dataset.credText === text) return;

    // Content changed since last process — strip old decorations first
    if (p.dataset.credProcessed) {
      p.classList.remove('cred-red', 'cred-orange', 'cred-gray', 'cred-green', 'cred-fragile');
      p.querySelectorAll('.cred-label-pill').forEach(pill => pill.remove());
      // Clean up any orphaned hover cards
      document.querySelectorAll('.cred-hover-card').forEach(c => c.remove());
    }

    const color = getColorLevel(tags);

    // Store tag data + clean text snapshot for change detection
    p.dataset.credLabels = JSON.stringify(tags);
    p.dataset.credColor = color;
    p.dataset.credText = text;

    // Apply color class
    p.classList.add('cred-' + color);

    // Fragile underline (hover handled by delegated listeners below)
    if (hasFragileTag(tags)) {
      p.classList.add('cred-fragile');
    }

    // Append summary pill (non-destructive)
    replaceLabelsInElement(p);

    p.dataset.credProcessed = 'true';
  }

  // --- Scan ---
  function scanAll() {
    if (!enabled || destroyed) return;

    counts.red = 0; counts.orange = 0; counts.gray = 0; counts.green = 0;

    findParagraphs().forEach((p) => {
      processParagraph(p);
      const c = p.dataset.credColor;
      if (c === 'red') counts.red++;
      else if (c === 'orange') counts.orange++;
      else if (c === 'gray') counts.gray++;
      else if (c === 'green') counts.green++;
    });

    updateBadge();
    saveCounts();
  }

  // --- Remove all ---
  function removeAll() {
    document.querySelectorAll('[data-cred-processed]').forEach((el) => {
      el.classList.remove('cred-red', 'cred-orange', 'cred-gray', 'cred-green', 'cred-risk', 'cred-fragile');
      el.querySelectorAll('.cred-label-pill').forEach(pill => pill.remove());
      delete el.dataset.credProcessed;
      delete el.dataset.credColor;
      delete el.dataset.credLabels;
      delete el.dataset.credText;
    });
    counts.red = 0; counts.orange = 0; counts.gray = 0; counts.green = 0;
    updateBadge();
    saveCounts();
  }

  // --- Badge / storage (fire-and-forget, never triggers destroy) ---
  function updateBadge() {
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({
        type: 'updateBadge',
        counts: { red: counts.red, orange: counts.orange, gray: counts.gray, green: counts.green },
      }).catch(() => {});
    } catch (e) {}
  }

  function saveCounts() {
    try {
      if (!chrome.runtime?.id) return;
      chrome.storage.local.set({
        credCounts: { red: counts.red, orange: counts.orange, gray: counts.gray, green: counts.green }
      });
    } catch (e) {}
  }

  // --- Debounce ---
  function debounce(fn, ms) {
    let timer;
    return function () { clearTimeout(timer); timer = setTimeout(fn, ms); };
  }

  // --- MutationObserver ---
  const debouncedScan = debounce(scanAll, 300);

  const observer = new MutationObserver((mutations) => {
    if (destroyed) return;
    ensureModeBtn();
    if (!enabled) return;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0 || mutation.type === 'characterData') {
        debouncedScan();
        return;
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // --- Delegated hover card for pills (one listener, never duplicated) ---
  document.addEventListener('mouseenter', (e) => {
    const pill = e.target.closest('.cred-label-pill');
    if (!pill || mode !== 'audit') return;
    document.querySelectorAll('.cred-hover-card').forEach(c => c.remove());
    const tags = JSON.parse(pill.dataset.tags || '[]');
    if (tags.length === 0) return;
    const card = createHoverCard(tags);
    document.body.appendChild(card);
    const rect = pill.getBoundingClientRect();
    let top = rect.top - card.offsetHeight - 6;
    let left = rect.left;
    if (top < 4) top = rect.bottom + 6;
    if (left + card.offsetWidth > window.innerWidth - 8) left = window.innerWidth - card.offsetWidth - 8;
    if (left < 4) left = 4;
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  }, true);

  document.addEventListener('mouseleave', (e) => {
    if (e.target.closest('.cred-label-pill')) {
      document.querySelectorAll('.cred-hover-card').forEach(c => c.remove());
    }
  }, true);

  // --- Delegated fragile tip (one listener, never duplicated) ---
  document.addEventListener('mouseenter', (e) => {
    const p = e.target.closest('.cred-fragile');
    if (!p || mode !== 'audit') return;
    document.querySelectorAll('.cred-fragile-tip').forEach(t => t.remove());
    const fragTip = document.createElement('div');
    fragTip.className = 'cred-fragile-tip';
    fragTip.textContent = 'F = Insufficient evidence / unverifiable timeliness / missing key premise';
    p.style.position = p.style.position || 'relative';
    p.appendChild(fragTip);
  }, true);

  document.addEventListener('mouseleave', (e) => {
    if (e.target.closest('.cred-fragile')) {
      document.querySelectorAll('.cred-fragile-tip').forEach(t => t.remove());
    }
  }, true);

  // --- Init ---
  applyMode();
  scanAll();
})();
