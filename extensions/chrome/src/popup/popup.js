const toggle = document.getElementById('toggle');
const modeBtn = document.getElementById('mode-btn');
const versionSelect = document.getElementById('version-select');
const copyBtn = document.getElementById('copy-btn');
const copyFeedback = document.getElementById('copy-feedback');
const autofillToggle = document.getElementById('autofill-toggle');

let currentMode = 'audit';

// --- Populate version dropdown ---
for (const [key, val] of Object.entries(PROMPT_VERSIONS)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = val.label;
  versionSelect.appendChild(opt);
}

// --- Load saved state ---
chrome.storage.local.get(
  ['credEnabled', 'credMode', 'promptVersion', 'autoFillEnabled'],
  (result) => {
    toggle.checked = result.credEnabled !== false;
    currentMode = result.credMode || 'audit';
    modeBtn.textContent = currentMode === 'simple' ? 'Simple' : 'Audit';
    versionSelect.value = result.promptVersion || PROMPT_LATEST;
    autofillToggle.checked = result.autoFillEnabled !== false;
  }
);

// --- Enable toggle ---
toggle.addEventListener('change', () => {
  chrome.storage.local.set({ credEnabled: toggle.checked });
});

// --- Mode toggle ---
modeBtn.addEventListener('click', () => {
  currentMode = currentMode === 'simple' ? 'audit' : 'simple';
  modeBtn.textContent = currentMode === 'simple' ? 'Simple' : 'Audit';
  chrome.storage.local.set({ credMode: currentMode });
});

// --- Version select ---
versionSelect.addEventListener('change', () => {
  chrome.storage.local.set({ promptVersion: versionSelect.value });
});

// --- Copy prompt ---
copyBtn.addEventListener('click', () => {
  const version = versionSelect.value;
  const promptData = PROMPT_VERSIONS[version];
  if (!promptData) return;

  navigator.clipboard.writeText(promptData.text).then(() => {
    copyFeedback.textContent = 'Copied!';
    copyFeedback.style.opacity = '1';
    setTimeout(() => {
      copyFeedback.style.opacity = '0';
    }, 2000);
  });
});

// --- Auto-fill toggle ---
autofillToggle.addEventListener('change', () => {
  chrome.storage.local.set({ autoFillEnabled: autofillToggle.checked });
});

// --- Live update from storage ---
chrome.storage.onChanged.addListener((changes) => {
  if (changes.credMode) {
    currentMode = changes.credMode.newValue;
    modeBtn.textContent = currentMode === 'simple' ? 'Simple' : 'Audit';
  }
});
