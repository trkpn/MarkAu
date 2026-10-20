# MarkAudio

A fast, lightweight, and offline-capable Markdown editor with real-time text-to-speech (TTS) audio narration and voice dictation. Runs 100% in your browser with zero server dependencies.

---

## Features

- **Split View Editor:** Real-time Markdown preview with syntax highlighting (Highlight.js) and LaTeX math formulas (KaTeX).
- **Synchronized Audio Reader:** Word-by-word text-to-speech highlighting using the browser's native `Intl.Segmenter` and Web Speech API.
- **Interactive Click-to-Speak:** Click any word in the preview to start reading aloud from that exact spot.
- **Voice Dictation (STT):** Speak into your microphone to type Markdown directly at your cursor position.
- **Adaptive Layouts:** Switch seamlessly between `Edit`, `Split`, and `Preview` modes. Automatically adjusts between side-by-side (landscape) and stacked top-bottom (portrait) views.
- **Offline Ready:** Zero external network font requests, local service worker caching, and client-side persistence.
- **High Performance:** Smooth 60fps scrolling, adaptive render debouncing, and lightweight line-numbering optimized for large documents.
- **Preferences:** Customize typography (Sans/Mono fonts, font sizes, line heights) and narration behavior with safe local storage persistence.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```

### 3. Build for Production
```bash
npm run build
```

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` *(outside editor)* | Play / Pause reading aloud |
| `Escape` | Close Preferences / Settings modal |

---

## License
MIT
