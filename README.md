# MarkAudio

A fast, lightweight and offline-capable Markdown editor with real-time text-to-speech (TTS) audio narration and voice dictation. Runs 100% in your browser with zero server dependencies.

---

## Features

- **Paste from the clipboard:** A button next to the view tabs drops the clipboard straight into the document. In Preview mode it becomes the new document, in Editor / Split it lands at the cursor — so a new document can be read without the trip through the view switcher.
- **Split View Editor:** Real-time Markdown preview with syntax highlighting (Highlight.js) and LaTeX math formulas (KaTeX).
- **Mermaid diagrams:** A ` ```mermaid ` fence is drawn as a real diagram in the preview — flowcharts, sequence diagrams, class diagrams, state machines and the rest of the Mermaid catalogue. The diagram follows the app theme, can be zoomed, panned and downloaded as an SVG, and a broken diagram shows the error next to its source instead of failing silently.
- **Callouts, footnotes and emoji:** `> [!NOTE]` blockquotes become coloured panels, `[^1]` footnotes collect at the end of the document, `:tada:` becomes 🎉, and every heading gets a link to itself.
- **Code blocks with a header:** The language, a copy button and the line numbers frame every code block.
- **Print and PDF:** The print button (or `Ctrl`/`Cmd` + `P`) prints the *rendered* document — diagrams, callouts and footnotes included — and the browser's dialog can save it as a PDF.
- **Synchronized Audio Reader:** Word-by-word text-to-speech highlighting using the browser's native `Intl.Segmenter` and Web Speech API.
- **One transport, one meaning:** The header carries a single Play / Pause button, the mini player carries a single toggle, `Space` toggles, and a click on the empty space of the preview toggles — all four do the same thing, everywhere. The Space key works even when a button or a slider has the focus; only a check box and an open dialog keep it for themselves.
- **Interactive Click-to-Speak:** Click any word in the preview to start reading aloud from that exact spot. Click the empty space around the text to play or pause — the same thing `Space` does.
- **Mini player:** While the narration runs, a compact bar floats at the bottom of the preview with pause, stop and progress — the transport is never a long reach away on a phone.
- **Follow the narration:** The preview can follow the word being read, and it yields the moment you scroll by hand instead of dragging you back.
- **Document outline:** A floating panel lists the document's headings; clicking one jumps there and starts reading from it. The header shows the current section as a breadcrumb.
- **Sentence-by-sentence narration:** The document is spoken in chunks instead of one giant utterance — long documents no longer get truncated or stuttered.
- **Voice Dictation (STT):** Speak into your microphone to type Markdown directly at your cursor position.
- **Resizable Workspace:** Drag the divider between the editor and the preview to set the split — the size is remembered per axis.
- **Layout You Choose:** Keep the panels side-by-side (left/right) or stacked (top/bottom) in _any_ orientation. The default follows the screen orientation, but you can override it at any time.
- **Synced scrolling with three modes:** _Proportional_ (the default — both panes scroll at the same rate), _By source line_ (the preview follows the exact paragraph the editor is showing) or _Off_.
- **Files:** Open a `.md` file (button or drag & drop) and save the document as Markdown or HTML.
- **Tailwind CSS Design System:** The whole interface is built on Tailwind CSS v4 with runtime-switchable design tokens (dark / light / follow the system).
- **Offline Ready:** The service worker serves the app shell and every asset from the cache, so a cold start without a network loads in milliseconds. Zero network fonts, client-side persistence.
- **No flash on load:** The stylesheet is linked in the document head, so the browser paints the styled shell immediately instead of an unstyled skeleton while the script boots.
- **Preferences:** Three independent font levels — _Interface_ (app chrome), _Reading_ (the rendered document) and _Editor_ (the Markdown source) — plus preview size, line spacing, theme, sync mode, narration mode, auto-save, panel arrangement and more. Every font can stay on the operating system's default.

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

## Development Scripts

| Script           | What it does         |
| :--------------- | :------------------- |
| `npm run dev`    | Vite dev server      |
| `npm run build`  | Production build     |
| `npm test`       | Unit tests (Vitest)  |
| `npm run lint`   | ESLint (flat config) |
| `npm run format` | Prettier             |
| `npm run check`  | Lint + test          |

---

## Keyboard Shortcuts

| Shortcut                               | Action                                                         |
| :------------------------------------- | :------------------------------------------------------------- |
| `Space` _(outside the editor)_         | Play / pause reading aloud — the same as the Play button         |
| `Esc`                                  | Stop reading — or close the Preferences dialog when it is open |
| `Ctrl`/`Cmd` + `B`                     | Bold the selection                                             |
| `Ctrl`/`Cmd` + `I`                     | Italicise the selection                                        |
| `Ctrl`/`Cmd` + `S`                     | Save the draft now                                             |
| `Ctrl`/`Cmd` + `Shift` + `V`         | Paste the clipboard into the document                           |
| `1` / `2` / `3` _(outside the editor)_ | Editor / Split / Preview view                                  |
| `←` `→` _(splitter focused)_           | Shrink / grow the editor pane                                  |
| `Home` / `End` _(splitter focused)_    | Jump to the minimum / maximum size                             |
| `Enter` _(splitter focused)_           | Reset the split to 50%                                         |

Double-clicking the divider also resets the split to 50%. The full list is
available under **Preferences → Shortcuts**.

---

## Architecture

```
src/
├── main.js                 # Bootstrap: wires the modules together
├── style.css               # Tailwind v4 entry point (@theme tokens, layers)
├── settings-manager.js     # Persisted preferences — single source of truth
├── markdown-parser.js      # Markdown → sanitized HTML (KaTeX, Highlight.js, DOMPurify)
├── mermaid-renderer.js     # Mermaid diagrams — loaded on demand, drawn into the preview
├── frontmatter.js          # The YAML-ish block that may open a document
├── tts-engine.js           # Speech synthesis, word highlighting, playback watchdog
├── stt-engine.js           # Speech recognition (dictation)
├── icons.js                # Inline SVG icons
├── sample-markdown.js      # Built-in sample document
└── app/
    ├── dom.js              # Element registry + icon injection
    ├── status.js           # Footer status manager (base message + timed override)
    ├── layout.js           # View switcher, panel arrangement, draggable splitter
    ├── toolbar.js          # Single-row toolbar that sheds controls by importance
    ├── shortcuts.js        # Keyboard shortcuts
    ├── mini-player.js      # Floating reading controls
    ├── outline.js          # Document outline (table of contents) + breadcrumb
    ├── editor.js           # Buffer, draft persistence, paste detection, file handling
    ├── paste.js            # Clipboard paste (button + shortcut)
    ├── print.js            # Printing and PDF export of the rendered document
    ├── preview.js          # Render pipeline, lazy tokenization, sync scrolling
    ├── controls.js         # Playback, voice, dictation, theme, network, PWA
    ├── settings-modal.js   # Preferences
    └── dialog.js           # In-app confirmation dialog
tests/                      # Vitest unit tests for the pure logic
```

### Reliability guarantees

- **No ghost audio.** The preview DOM is only rewritten after narration has been stopped, so an utterance can never describe a document that no longer exists.
- **No stuck "playing" state.** A watchdog reconciles the engine state with the Web Speech API, so a browser that silently drops an utterance cannot leave the UI out of sync.
- **Correct word highlighting.** The auto-scroll uses the real scroll container and viewport-relative math, and token lookup is O(1) through a `Map`.
- **Unblocked input.** Tokenization runs during idle time instead of on every keystroke, and the draft is persisted on a debounce.
- **Small first load.** Only the 36 most common syntax highlighting languages are bundled; the full set is fetched on demand. Mermaid works the same way — the diagram parsers are only downloaded when a document actually contains a diagram, and the service worker keeps them for the next offline start.
- **Diagrams are not read aloud.** A Mermaid diagram is a picture, not prose: its labels stay out of the narration and out of the word count — unless the preference "Read diagram labels aloud" is switched on.

---

## License

MIT
