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

  // Persistent polling: keeps button alive and recovers from destroyed state.
  // SPA navigations can trigger context invalidation that sets destroyed=true,
  // but the context may become valid again on the next page.
  setInterval(() => {
    ensureModeBtn();
    if (destroyed && isContextValid()) {
      destroyed = false;
      try {
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (e) {}
      scanAll();
    }
  }, 2000);

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

  // --- Replace label text with hoverable pill ---
  function replaceLabelsInElement(el) {
    // Match [S1], [S1+R2], [⚠Legal M2+R3+F], [S2+F❗] etc.
    const labelPattern = /\[([^\]]*(?:S[1-3]|M[1-3]|R[1-3]|U|C|F)[^\]]*)\]/g;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      if (!labelPattern.test(text)) continue;
      labelPattern.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let match;
      while ((match = labelPattern.exec(text)) !== null) {
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
        }
        // Extract tags from this specific label
        const labelTags = [];
        const cleaned = match[1].replace(/[\u26A0\uFE0F\u2757]/g, '').replace(/[\u4e00-\u9fff]+/g, '');
        const tagRe = /\b(S[1-3]|M[1-3]|R[1-3]|U|C|F)\b/g;
        let tm;
        while ((tm = tagRe.exec(cleaned)) !== null) labelTags.push(tm[1]);

        // Create hoverable pill
        const pill = document.createElement('span');
        pill.className = 'cred-label-pill';
        pill.textContent = labelTags.join('·');
        pill.dataset.tags = JSON.stringify(labelTags);

        // Attach hover card to pill
        let card = null;
        pill.addEventListener('mouseenter', () => {
          if (mode !== 'audit') return;
          const tags = JSON.parse(pill.dataset.tags || '[]');
          if (tags.length === 0) return;
          card = createHoverCard(tags);
          document.body.appendChild(card);
          const rect = pill.getBoundingClientRect();
          let top = rect.top - card.offsetHeight - 6;
          let left = rect.left;
          if (top < 4) top = rect.bottom + 6;
          if (left + card.offsetWidth > window.innerWidth - 8) left = window.innerWidth - card.offsetWidth - 8;
          if (left < 4) left = 4;
          card.style.top = top + 'px';
          card.style.left = left + 'px';
        });
        pill.addEventListener('mouseleave', () => {
          if (card && card.parentNode) card.parentNode.removeChild(card);
          card = null;
        });

        // Store original label text in a hidden span so removeAll() can restore it
        const hidden = document.createElement('span');
        hidden.className = 'cred-label-hidden';
        hidden.textContent = match[0];
        frag.appendChild(hidden);
        frag.appendChild(pill);
        lastIdx = match.index + match[0].length;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  // --- Process paragraph ---
  function processParagraph(p) {
    const text = p.textContent || '';
    const tags = extractTags(text);

    // No labels found — don't mark as processed so we can re-check later
    // (streaming may add labels after initial render)
    if (tags.length === 0) return;

    // Already processed and content hasn't changed — skip
    if (p.dataset.credProcessed && p.dataset.credText === text) return;

    // Content changed since last process — strip old decorations first
    if (p.dataset.credProcessed) {
      p.classList.remove('cred-red', 'cred-orange', 'cred-gray', 'cred-green', 'cred-fragile');
      p.querySelectorAll('.cred-label-pill').forEach(pill => pill.remove());
      p.querySelectorAll('.cred-label-hidden').forEach(span => {
        span.replaceWith(document.createTextNode(span.textContent));
      });
    }

    const color = getColorLevel(tags);

    // Store tag data + text snapshot for change detection
    p.dataset.credLabels = JSON.stringify(tags);
    p.dataset.credColor = color;
    p.dataset.credText = text;

    // Apply color class
    p.classList.add('cred-' + color);

    // Fragile underline
    if (hasFragileTag(tags)) {
      p.classList.add('cred-fragile');
      let fragTip = null;
      p.addEventListener('mouseenter', () => {
        if (mode !== 'audit') return;
        fragTip = document.createElement('div');
        fragTip.className = 'cred-fragile-tip';
        fragTip.textContent = 'F = Insufficient evidence / unverifiable timeliness / missing key premise';
        p.style.position = p.style.position || 'relative';
        p.appendChild(fragTip);
      });
      p.addEventListener('mouseleave', () => {
        if (fragTip && fragTip.parentNode) fragTip.parentNode.removeChild(fragTip);
        fragTip = null;
      });
    }

    // Replace raw labels with hoverable pills (hover card attached to each pill)
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
      // Remove pills, then restore hidden labels back to raw text
      el.querySelectorAll('.cred-label-pill').forEach(pill => pill.remove());
      el.querySelectorAll('.cred-label-hidden').forEach(span => {
        span.replaceWith(document.createTextNode(span.textContent));
      });
      delete el.dataset.credProcessed;
      delete el.dataset.credColor;
      delete el.dataset.credLabels;
      delete el.dataset.credText;
    });
    counts.red = 0; counts.orange = 0; counts.gray = 0; counts.green = 0;
    updateBadge();
    saveCounts();
  }

  // --- Badge / storage ---
  function updateBadge() {
    safeChromeCall(() => {
      chrome.runtime.sendMessage({
        type: 'updateBadge',
        counts: { red: counts.red, orange: counts.orange, gray: counts.gray, green: counts.green },
      }).catch(() => {});
    });
  }

  function saveCounts() {
    safeChromeCall(() => {
      chrome.storage.local.set({
        credCounts: { red: counts.red, orange: counts.orange, gray: counts.gray, green: counts.green }
      });
    });
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

  // --- Init ---
  applyMode();
  scanAll();
})();
