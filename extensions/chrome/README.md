# AI Credibility Visualizer - Chrome Extension

Chrome extension that auto-highlights AI responses by evidence strength and lets you copy or auto-fill the credibility prompt. Works on Claude, ChatGPT, and Gemini.

## Install

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extensions/chrome` folder
4. Open [claude.ai](https://claude.ai), [chatgpt.com](https://chatgpt.com), or [gemini.google.com](https://gemini.google.com) and start chatting

## Features

### Label Visualization

When the AI outputs labels like `[S1]`, `[M2+R3]`, `[S3+R2+F]`, the extension auto-detects them and colors each paragraph:

| Color | Level | Triggers |
|-------|-------|----------|
| Red | Alert | M3, F, R3 |
| Orange | Caution | R2, S3, M2 |
| Light Gray | Reference | U, C |
| Green | Trusted | S1, S2, M1, R1 only |

Two display modes:
- **Simple** — colored badge prefix per paragraph
- **Audit** — full color backgrounds, hoverable label pills with tag explanations

### Copy Prompt

Click the extension icon and use the **Copy Prompt** button to copy the credibility framework prompt to your clipboard. Select a prompt version from the dropdown if multiple versions are available.

### Instruction Selector

A **"Credibility prompt"** dropdown is injected into the input toolbar on all supported platforms — next to the model selector on Claude.ai, and near the input area on ChatGPT and Gemini. Click it to pick a prompt version; selecting one injects the prompt into the input box. The dropdown shows a preview panel on hover.

## File Structure

```
extensions/chrome/
├── manifest.json
├── src/
│   ├── background/index.js      — Service worker for badge updates
│   ├── content/
│   │   ├── index.js             — Label detection, coloring, hover cards
│   │   └── autofill.js          — Inline instruction selector for all platforms
│   ├── popup/
│   │   ├── popup.html           — Extension popup UI
│   │   ├── popup.js             — Popup state management
│   │   └── popup.css            — Popup styling
│   ├── utils/
│   │   ├── labelParser.js       — Regex-based label extraction
│   │   └── colorMapper.js       — Four-level color mapping
│   ├── data/
│   │   └── prompts.js           — Bundled prompt versions
│   └── styles/
│       └── inject.css           — Injected page styles
├── public/
│   └── icons/                   — Extension icons (16, 48, 128px)
└── README.md
```

## Prompt Versions

- **v7 Compact** — compressed rules format. Short enough to paste into AI personalization settings (Claude's "Customize Claude", ChatGPT's "Custom Instructions", Gemini's style settings) so every conversation uses the framework automatically.
- **v7 Full** — detailed version with expanded explanations. Best for pasting at the start of a conversation.

## Adding a New Prompt Version

1. Add the new version file to `model_instructions/` (e.g., `prompts-v8-compact.md`)
2. Open `src/data/prompts.js` and add a new entry to `PROMPT_VERSIONS` with `label`, `description`, and `text`
3. Update `PROMPT_LATEST` if the new version should be the default
4. Reload the extension in `chrome://extensions/`
