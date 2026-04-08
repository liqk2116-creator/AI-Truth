// Instruction selector: injects a dropdown into the input bar on all platforms
// Auto-injects persisted prompt on every new conversation
// Depends on: src/data/prompts.js (PROMPT_VERSIONS, PROMPT_LATEST)

(function () {
  'use strict';

  // --- Extension context guard ---
  let destroyed = false;

  function isContextValid() {
    try { return !!chrome.runtime.id; } catch (e) { return false; }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (urlCheckInterval) clearInterval(urlCheckInterval);
  }

  function safeChromeCall(fn) {
    if (!isContextValid()) { destroy(); return; }
    try { fn(); } catch (e) {
      if (e.message && e.message.includes('Extension context invalidated')) destroy();
    }
  }

  // --- Platform input selectors ---
  const PLATFORM_INPUT_SELECTORS = {
    'claude.ai': [
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][data-placeholder]',
      'fieldset div[contenteditable="true"]'
    ],
    'chatgpt.com': [
      'div#prompt-textarea[contenteditable]',
      'textarea#prompt-textarea',
      'div[contenteditable][data-placeholder]'
    ],
    'chat.openai.com': [
      'div#prompt-textarea[contenteditable]',
      'textarea#prompt-textarea',
      'div[contenteditable][data-placeholder]'
    ],
    'gemini.google.com': [
      'rich-textarea .ql-editor[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      '.input-area [contenteditable="true"]'
    ]
  };

  // --- Toolbar / buttons bar selectors per platform ---
  const PLATFORM_BAR_SELECTORS = {
    'claude.ai': {
      find(doc) {
        const fieldset = doc.querySelector('fieldset');
        if (fieldset) {
          const candidates = fieldset.querySelectorAll('div.flex.items-center');
          for (const c of candidates) {
            if (c.querySelectorAll('button').length >= 2) return c;
          }
        }
        return null;
      }
    },
    'chatgpt.com': {
      find(doc) {
        const selectors = [
          'div.flex.items-center.gap-2',
          'form div.flex.items-end > div.flex',
          'main form div.flex.items-center'
        ];
        for (const sel of selectors) {
          const els = doc.querySelectorAll(sel);
          for (const el of els) {
            if (el.querySelectorAll('button').length >= 1 && el.closest('form')) return el;
          }
        }
        return null;
      }
    },
    'chat.openai.com': {
      find(doc) {
        return PLATFORM_BAR_SELECTORS['chatgpt.com'].find(doc);
      }
    },
    'gemini.google.com': {
      find(doc) {
        const selectors = [
          '.input-buttons-wrapper',
          'div.input-area-container div.flex',
          '.input-area div[class*="action"]',
          'div[class*="bottom-container"] div.flex'
        ];
        for (const sel of selectors) {
          const el = doc.querySelector(sel);
          if (el) return el;
        }
        const input = doc.querySelector('rich-textarea');
        if (input) {
          const parent = input.closest('.input-area-container') || input.parentElement;
          if (parent) {
            const rows = parent.querySelectorAll('div');
            for (const row of rows) {
              if (row.querySelectorAll('button').length >= 1 && row !== input) return row;
            }
          }
        }
        return null;
      }
    }
  };

  const SELECTOR_ID = 'cred-instruction-selector';
  const DROPDOWN_ID = 'cred-instruction-dropdown';

  let currentPlatform = null;
  let urlCheckInterval = null;
  let lastUrl = location.href;
  let selectedVersion = null;   // currently displayed in trigger label
  let persistedVersion = null;  // saved in storage, auto-injected on new chats
  let dropdownOpen = false;
  let pollTimer = null;
  let autoInjected = false;     // prevent double-inject on the same page

  // =====================================================
  // Shared utilities
  // =====================================================

  function detectPlatform() {
    const host = location.hostname;
    for (const key of Object.keys(PLATFORM_INPUT_SELECTORS)) {
      if (host.includes(key)) return key;
    }
    return null;
  }

  function isNewConversation() {
    const path = location.pathname;
    if (currentPlatform === 'claude.ai') {
      return path === '/' || path === '/new' || /^\/new\?/.test(path + location.search);
    }
    if (currentPlatform === 'chatgpt.com' || currentPlatform === 'chat.openai.com') {
      return path === '/' || path === '';
    }
    if (currentPlatform === 'gemini.google.com') {
      return path === '/app' || path === '/app/';
    }
    return false;
  }

  function findInputElement() {
    const selectors = PLATFORM_INPUT_SELECTORS[currentPlatform];
    if (!selectors) return null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function injectPrompt(text) {
    const el = findInputElement();
    if (!el) return false;

    if (el.tagName === 'TEXTAREA') {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeSetter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.focus();
      el.textContent = '';
      const p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  // =====================================================
  // Auto-inject on new conversation
  // =====================================================

  function tryAutoInject() {
    if (autoInjected || !persistedVersion) return;
    if (!isNewConversation()) return;

    const promptData = PROMPT_VERSIONS[persistedVersion];
    if (!promptData) return;

    // Wait for input element to be ready
    let attempts = 0;
    const timer = setInterval(() => {
      if (destroyed) { clearInterval(timer); return; }
      attempts++;
      const el = findInputElement();
      if (el) {
        clearInterval(timer);
        // Only inject if input is empty
        const content = (el.textContent || el.value || '').trim();
        if (!content) {
          injectPrompt(promptData.text);
          autoInjected = true;
          selectedVersion = persistedVersion;
          updateTriggerLabel();
        }
      }
      if (attempts > 10) clearInterval(timer);
    }, 500);
  }

  // =====================================================
  // Inline instruction selector (all platforms)
  // =====================================================

  function findButtonsBar() {
    const platformBar = PLATFORM_BAR_SELECTORS[currentPlatform];
    if (platformBar) return platformBar.find(document);
    return null;
  }

  function createInlineSelector() {
    if (document.getElementById(SELECTOR_ID)) return null;

    const wrapper = document.createElement('div');
    wrapper.id = SELECTOR_ID;
    wrapper.className = 'cred-selector-wrapper';

    const trigger = document.createElement('button');
    trigger.className = 'cred-selector-trigger';
    trigger.type = 'button';

    // Show persisted version name if set
    const labelText = (persistedVersion && PROMPT_VERSIONS[persistedVersion])
      ? PROMPT_VERSIONS[persistedVersion].label
      : 'Credibility prompt';

    trigger.innerHTML =
      '<span class="cred-selector-label">' + labelText + '</span>' +
      '<span class="cred-selector-chevron">&#8964;</span>';

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    wrapper.appendChild(trigger);
    return wrapper;
  }

  function toggleDropdown() {
    if (document.getElementById(DROPDOWN_ID)) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  function openDropdown() {
    if (destroyed || document.getElementById(DROPDOWN_ID)) return;
    dropdownOpen = true;

    const trigger = document.querySelector('.cred-selector-trigger');
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();

    const dropdown = document.createElement('div');
    dropdown.id = DROPDOWN_ID;
    dropdown.className = 'cred-dropdown';

    dropdown.style.position = 'fixed';
    dropdown.style.left = Math.max(8, rect.left) + 'px';
    dropdown.style.bottom = (window.innerHeight - rect.top + 6) + 'px';

    // Header
    const header = document.createElement('div');
    header.className = 'cred-dropdown-header';
    header.textContent = 'Which credibility prompt to use?';
    dropdown.appendChild(header);

    // Content area: list + preview
    const content = document.createElement('div');
    content.className = 'cred-dropdown-content';

    const list = document.createElement('div');
    list.className = 'cred-dropdown-list';

    const preview = document.createElement('div');
    preview.className = 'cred-dropdown-preview';
    preview.textContent = 'Hover over a version to preview';

    const versions = Object.entries(PROMPT_VERSIONS);
    versions.forEach(([key, val]) => {
      const item = document.createElement('div');
      item.className = 'cred-dropdown-item';
      if (key === persistedVersion) item.classList.add('selected');
      item.textContent = val.label;

      item.addEventListener('mouseenter', () => {
        const desc = val.description ? val.description + '\n\n---\n\n' : '';
        preview.textContent = desc + val.text.substring(0, 400) + (val.text.length > 400 ? '...' : '');
      });

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectVersion(key);
        closeDropdown();
      });

      list.appendChild(item);
    });

    content.appendChild(list);
    content.appendChild(preview);
    dropdown.appendChild(content);

    // Clear selection
    if (persistedVersion) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'cred-dropdown-clear';
      clearBtn.textContent = 'Clear selection';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearSelection();
        closeDropdown();
      });
      dropdown.appendChild(clearBtn);
    }

    document.body.appendChild(dropdown);

    setTimeout(() => {
      document.addEventListener('click', onOutsideClick);
    }, 0);
  }

  function closeDropdown() {
    dropdownOpen = false;
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (dropdown) dropdown.remove();
    document.removeEventListener('click', onOutsideClick);
  }

  function onOutsideClick(e) {
    const dropdown = document.getElementById(DROPDOWN_ID);
    const selector = document.getElementById(SELECTOR_ID);
    if (dropdown && !dropdown.contains(e.target) &&
        selector && !selector.contains(e.target)) {
      closeDropdown();
    }
  }

  function selectVersion(version) {
    selectedVersion = version;
    persistedVersion = version;
    autoInjected = true; // user manually selected, don't auto-inject again

    safeChromeCall(() => {
      chrome.storage.local.set({ promptVersion: version });
    });

    const promptData = PROMPT_VERSIONS[version];
    if (promptData) injectPrompt(promptData.text);

    updateTriggerLabel();
  }

  function clearSelection() {
    selectedVersion = null;
    persistedVersion = null;
    autoInjected = false;

    safeChromeCall(() => {
      chrome.storage.local.remove('promptVersion');
    });

    updateTriggerLabel();
  }

  function updateTriggerLabel() {
    const label = document.querySelector('.cred-selector-label');
    if (!label) return;
    const ver = persistedVersion || selectedVersion;
    if (ver && PROMPT_VERSIONS[ver]) {
      label.textContent = PROMPT_VERSIONS[ver].label;
    } else {
      label.textContent = 'Credibility prompt';
    }
  }

  function tryInjectSelector() {
    if (destroyed || document.getElementById(SELECTOR_ID)) return;

    const bar = findButtonsBar();
    if (!bar) return;

    const selector = createInlineSelector();
    if (selector) bar.appendChild(selector);
  }

  // =====================================================
  // Main logic
  // =====================================================

  function cleanup() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    const selector = document.getElementById(SELECTOR_ID);
    if (selector) selector.remove();
    closeDropdown();
  }

  function init() {
    if (destroyed) return;
    safeChromeCall(() => {
      chrome.storage.local.get(['autoFillEnabled', 'promptVersion'], (result) => {
        if (destroyed) return;
        if (result.autoFillEnabled === false) return;

        persistedVersion = result.promptVersion || null;
        selectedVersion = persistedVersion;
        autoInjected = false;

        pollForBar();
        tryAutoInject();
      });
    });
  }

  function pollForBar() {
    let attempts = 0;
    pollTimer = setInterval(() => {
      if (destroyed) { clearInterval(pollTimer); pollTimer = null; return; }
      attempts++;
      if (document.getElementById(SELECTOR_ID)) {
        clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      tryInjectSelector();
      if (attempts > 30) { clearInterval(pollTimer); pollTimer = null; }
    }, 1000);
  }

  function startUrlWatcher() {
    urlCheckInterval = setInterval(() => {
      if (destroyed) { clearInterval(urlCheckInterval); return; }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        autoInjected = false;
        cleanup();
        init();
      }
    }, 1000);
  }

  let domObserver = null;

  function startDomWatcher() {
    if (domObserver) domObserver.disconnect();
    domObserver = new MutationObserver(() => {
      if (destroyed) { domObserver.disconnect(); return; }
      if (!document.getElementById(SELECTOR_ID)) {
        tryInjectSelector();
      }
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Listen for storage changes from popup
  safeChromeCall(() => {
    chrome.storage.onChanged.addListener((changes) => {
      if (destroyed) return;
      if (changes.autoFillEnabled) {
        if (changes.autoFillEnabled.newValue === false) {
          cleanup();
        } else {
          init();
        }
      }
      if (changes.promptVersion) {
        persistedVersion = changes.promptVersion.newValue || null;
        selectedVersion = persistedVersion;
        updateTriggerLabel();
      }
    });
  });

  // --- Boot ---
  currentPlatform = detectPlatform();
  if (currentPlatform) {
    init();
    startUrlWatcher();
    startDomWatcher();
  }
})();
