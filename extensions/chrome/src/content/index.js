// Content script - injected into claude.ai, chatgpt.com, gemini.google.com
// Depends on: utils/labelParser.js (extractTags), utils/colorMapper.js (getColorLevel)

(function () {
  'use strict';

  let enabled = true;
  let destroyed = false;
  let mode = 'audit'; // default: audit
  let mutating = false; // true while our code modifies the DOM (suppresses observer re-scans)
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
    const BLOCK_TAGS = 'p, li, h1, h2, h3, h4, h5, h6';
    const selectors = [
      // Claude
      ...['[data-testid*="assistant-message"]', '[data-testid*="assistant"]',
        '.font-claude-message', '[class*="Message"][class*="assistant"]'],
      // ChatGPT
      ...['[data-message-author-role="assistant"]', '.markdown.prose',
        '[class*="markdown"][class*="result"]'],
      // Gemini
      ...['[class*="model-response"]', '.model-response-text', '.response-container',
        'message-content', '[class*="response"][class*="container"]',
        '.markdown-main-panel'],
      // Broad fallbacks
      ...['[data-is-streaming]', '.prose'],
    ].map(root => BLOCK_TAGS.split(', ').map(tag => root + ' ' + tag).join(', '));
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

  // Safe Element.closest — guards against e.target being Document, Window,
  // a Text node, or any object whose `closest` is missing or non-callable
  // (some custom elements / Web Components shadow it). Returns null instead
  // of throwing "closest is not a function".
  function safeClosest(target, selector) {
    if (target && typeof target.closest === 'function') {
      try { return target.closest(selector); } catch (e) { return null; }
    }
    return null;
  }

  // --- Check if element is inside a streaming message ---
  function isStreaming(el) {
    return !!(
      el.closest('[data-is-streaming="true"]') ||
      el.closest('.result-streaming') ||
      // Gemini: actively streaming response indicators
      el.closest('[class*="streaming"]') ||
      el.closest('[class*="pending"]') ||
      el.closest('.model-response-text [class*="loading"]')
    );
  }

  // --- Append summary pill to element (non-destructive, no text node mutation) ---
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

    // Append a single summary pill at the end (no text node mutation here)
    const pill = document.createElement('span');
    pill.className = 'cred-label-pill';
    pill.textContent = allTags.join('·');
    pill.dataset.tags = JSON.stringify(allTags);
    el.appendChild(pill);
  }

  // --- Wrap raw label text (e.g. [S1], [M2+R3]) in hidden spans ---
  function wrapRawLabels(el) {
    const rawLabelRe = /\[([^\]]*\b(?:S[1-3]|M[1-3]|R[1-3]|U|C|F)\b[^\]]*)\]/g;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    for (const tn of textNodes) {
      if (!tn.parentNode || !tn.nodeValue) continue; // skip detached nodes
      if (!rawLabelRe.test(tn.nodeValue)) continue;
      rawLabelRe.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let m;
      while ((m = rawLabelRe.exec(tn.nodeValue)) !== null) {
        if (m.index > lastIndex) {
          frag.appendChild(document.createTextNode(tn.nodeValue.slice(lastIndex, m.index)));
        }
        const span = document.createElement('span');
        span.className = 'cred-raw-label';
        span.textContent = m[0];
        frag.appendChild(span);
        lastIndex = rawLabelRe.lastIndex;
      }
      if (lastIndex < tn.nodeValue.length) {
        frag.appendChild(document.createTextNode(tn.nodeValue.slice(lastIndex)));
      }
      try { tn.parentNode.replaceChild(frag, tn); } catch (e) {}
    }

    // Hide parent inline elements that became visually empty after wrapping
    // (e.g. Claude may render [S1] inside a <span> or <code> with its own background)
    el.querySelectorAll('.cred-raw-label').forEach((span) => {
      let parent = span.parentElement;
      while (parent && parent !== el) {
        const tag = parent.tagName;
        // Only collapse inline-level wrappers, not block containers
        if (/^(P|LI|DIV|BLOCKQUOTE|H[1-6])$/.test(tag)) break;
        const clone = parent.cloneNode(true);
        clone.querySelectorAll('.cred-raw-label').forEach(s => s.remove());
        if (clone.textContent.trim() === '') {
          parent.classList.add('cred-raw-label-parent');
        }
        parent = parent.parentElement;
      }
    });
  }

  // --- Unwrap raw label spans back to plain text ---
  function unwrapRawLabels(el) {
    el.querySelectorAll('.cred-raw-label-parent').forEach((p) => {
      p.classList.remove('cred-raw-label-parent');
    });
    el.querySelectorAll('.cred-raw-label').forEach((span) => {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    el.normalize();
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
    const streaming = isStreaming(p);
    const text = getCleanText(p);
    const tags = extractTags(text);

    // No labels found — don't mark as processed so we can re-check later
    // (streaming may add labels after initial render)
    if (tags.length === 0) return;

    const textStable = p.dataset.credText === text;
    const alreadyProcessed = !!p.dataset.credProcessed;

    // Text unchanged since last scan — apply deferred DOM mutations (pill, wrap)
    // only when streaming is done, to avoid interfering with React's reconciliation
    // of ChatGPT/Claude/Gemini's incremental renders.
    if (alreadyProcessed && textStable) {
      if (streaming) return;
      if (!p.dataset.credPilled) {
        mutating = true;
        try { replaceLabelsInElement(p); } finally { mutating = false; }
        p.dataset.credPilled = 'true';
      }
      if (!p.dataset.credWrapped) {
        mutating = true;
        try {
          unwrapRawLabels(p);
          wrapRawLabels(p);
        } finally { mutating = false; }
        p.dataset.credWrapped = 'true';
      }
      return;
    }

    // Content changed since last process — strip old decorations first
    if (alreadyProcessed) {
      mutating = true;
      try {
        p.classList.remove('cred-red', 'cred-orange', 'cred-gray', 'cred-green', 'cred-fragile');
        p.querySelectorAll('.cred-label-pill').forEach(pill => pill.remove());
        unwrapRawLabels(p);
      } finally { mutating = false; }
      delete p.dataset.credWrapped;
      delete p.dataset.credPilled;
    }

    const color = getColorLevel(tags);

    // Store tag data + clean text snapshot for change detection
    p.dataset.credLabels = JSON.stringify(tags);
    p.dataset.credColor = color;
    p.dataset.credText = text;

    // Apply color class — classList changes don't mutate the DOM tree, so
    // they're safe during streaming. (Our observer ignores attribute mutations.)
    p.classList.add('cred-' + color);

    // Fragile underline (hover handled by delegated listeners below)
    if (hasFragileTag(tags)) {
      p.classList.add('cred-fragile');
    }

    // Pill append + raw-label wrap are DOM-tree mutations that break React's
    // reconciliation of streaming paragraphs (causing visible content truncation
    // in ChatGPT until refresh). Defer both until a later scan finds the text
    // unchanged — the 1.5s periodic scan adds them once streaming ends.
    p.dataset.credProcessed = 'true';
  }

  // --- Scroll suppression: pause scanning while user drags scrollbar ---
  let scrolling = false;
  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    scrolling = true;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { scrolling = false; }, 400);
  }, true);

  // --- Scan ---
  function scanAll() {
    if (!enabled || destroyed || scrolling) return;

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
    mutating = true;
    try {
      document.querySelectorAll('[data-cred-processed]').forEach((el) => {
        el.classList.remove('cred-red', 'cred-orange', 'cred-gray', 'cred-green', 'cred-risk', 'cred-fragile');
        el.querySelectorAll('.cred-label-pill').forEach(pill => pill.remove());
        unwrapRawLabels(el);
        delete el.dataset.credProcessed;
        delete el.dataset.credColor;
        delete el.dataset.credLabels;
        delete el.dataset.credText;
        delete el.dataset.credWrapped;
        delete el.dataset.credPilled;
      });
    } finally { mutating = false; }
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
    if (destroyed || mutating) return;
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

  // --- Delegated hover card for pills (debounced to prevent flicker) ---
  let hoverHideTimer = null;
  let activePill = null;

  document.addEventListener('mouseenter', (e) => {
    const pill = safeClosest(e.target, '.cred-label-pill');
    if (!pill || mode !== 'audit') return;
    // Cancel pending hide if re-entering same or different pill
    if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
    // Skip if already showing card for this pill
    if (activePill === pill) return;
    activePill = pill;
    document.querySelectorAll('.cred-hover-card').forEach(c => c.remove());
    try {
      const tags = JSON.parse(pill.dataset.tags || '[]');
      if (tags.length === 0) return;
      const card = createHoverCard(tags);
      mutating = true;
      try { document.body.appendChild(card); } finally { mutating = false; }
      const rect = pill.getBoundingClientRect();
      let top = rect.top - card.offsetHeight - 6;
      let left = rect.left;
      if (top < 4) top = rect.bottom + 6;
      if (left + card.offsetWidth > window.innerWidth - 8) left = window.innerWidth - card.offsetWidth - 8;
      if (left < 4) left = 4;
      card.style.top = top + 'px';
      card.style.left = left + 'px';
    } catch (e) {}
  }, true);

  document.addEventListener('mouseleave', (e) => {
    if (safeClosest(e.target, '.cred-label-pill')) {
      // Delay hide to prevent flicker when mouse moves briefly off pill
      hoverHideTimer = setTimeout(() => {
        document.querySelectorAll('.cred-hover-card').forEach(c => c.remove());
        activePill = null;
        hoverHideTimer = null;
      }, 120);
    }
  }, true);

  // --- Delegated fragile tip (debounced hide) ---
  let fragHideTimer = null;

  document.addEventListener('mouseenter', (e) => {
    const p = safeClosest(e.target, '.cred-fragile');
    if (!p || mode !== 'audit') return;
    if (fragHideTimer) { clearTimeout(fragHideTimer); fragHideTimer = null; }
    if (p.querySelector('.cred-fragile-tip')) return; // already showing
    document.querySelectorAll('.cred-fragile-tip').forEach(t => t.remove());
    const fragTip = document.createElement('div');
    fragTip.className = 'cred-fragile-tip';
    fragTip.textContent = 'F = Insufficient evidence / unverifiable timeliness / missing key premise';
    p.style.position = p.style.position || 'relative';
    mutating = true;
    try { p.appendChild(fragTip); } finally { mutating = false; }
  }, true);

  document.addEventListener('mouseleave', (e) => {
    if (safeClosest(e.target, '.cred-fragile')) {
      fragHideTimer = setTimeout(() => {
        document.querySelectorAll('.cred-fragile-tip').forEach(t => t.remove());
        fragHideTimer = null;
      }, 120);
    }
  }, true);

  // --- Init ---
  applyMode();
  scanAll();
})();
