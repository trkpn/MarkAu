# MarkAu

A fast, lightweight and offline-capable Markdown editor with real-time text-to-speech (TTS) audio narration and voice dictation. Runs 100% in your browser — the only server piece is an optional one-function proxy that reads the web pages a browser is not allowed to read.

---

## Features

- **Paste from the clipboard:** A button next to the view tabs drops the clipboard straight into the document. In Preview mode it becomes the new document, in Editor / Split it lands at the cursor — so a new document can be read without the trip through the view switcher.
- **Import from a URL:** A button next to Paste takes a web address and brings the document in as Markdown. The import becomes the document — it replaces what was there, the way opening a file does — so a new document is never mixed into the text of the old one. A GitHub repository, a Hugging Face model / dataset / Space or a `.md` file is taken as it is — the Markdown the author wrote, untouched. Any other page is reduced to its main content the way a reading mode does: the navigation, the adverts and the footer are dropped, the headings, links, code and tables are kept, and the result is converted in the browser.
- **YouTube, Substack and Reddit:** A video becomes a document with its title, channel, length, date, description, chapters and its transcript. A post of a Substack publication becomes the post, with a note when only the open part could be read. A thread becomes the post and its comments; a subreddit becomes the list of its latest posts.
- **arXiv papers:** A paper becomes a document with its title, authors, subjects, the journal it was published in, its abstract — and the paper itself, drawn by arXiv from the LaTeX of the author. Every formula keeps the LaTeX it was written in, so the app draws it with KaTeX.
- **Drag and drop:** Something can be dropped on the app, and the app knows what to do with it. A file of text is opened, an address is imported, a piece of text lands in the document, a PDF or a book is read. A panel says which of them will happen before anything is dropped.
- **PDF and EPUB:** A PDF is read with the reader the browsers use (pdf.js): the text of the pages is taken out of the drawings. A book in EPUB form is opened in the browser — it is a bundle of HTML pages — and every chapter is turned into Markdown, so a whole book becomes one document. Both are loaded on demand.
- **Split View Editor:** Real-time Markdown preview with syntax highlighting (Highlight.js) and LaTeX math formulas (KaTeX).
- **Mermaid diagrams:** A ` ```mermaid ` fence is drawn as a real diagram in the preview — flowcharts, sequence diagrams, class diagrams, state machines and the rest of the Mermaid catalogue. The diagram follows the app theme, can be zoomed, panned and downloaded as an SVG, and a broken diagram shows the error next to its source instead of failing silently.
- **Callouts, footnotes and emoji:** `> [!NOTE]` blockquotes become coloured panels, `[^1]` footnotes collect at the end of the document, `:tada:` becomes 🎉, and every heading gets a link to itself.
- **Code blocks with a header:** The language, a copy button and the line numbers frame every code block.
- **Print and PDF:** The print button (or `Ctrl`/`Cmd` + `P`) prints the *rendered* document — diagrams, callouts and footnotes included — and the browser's dialog can save it as a PDF.
- **Synchronized Audio Reader:** Word-by-word text-to-speech highlighting using the browser's native `Intl.Segmenter` and Web Speech API. The signs that are not prose — the permalink of a heading, a formula, the time of a transcript — are seen, not heard.
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
| `Ctrl`/`Cmd` + `Shift` + `U`         | Import a document from a web address                           |
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
├── html-to-markdown.js     # Web page → Markdown (Readability + Turndown) — loaded on demand
├── youtube-to-markdown.js  # A video — its details, description, chapters, transcript
├── substack-to-markdown.js # A post — its body, and where the paywall begins
├── reddit-to-markdown.js   # A thread — the post and the comments
├── arxiv-to-markdown.js    # A paper — its metadata, its abstract, its formulas
├── pdf-to-markdown.js      # A PDF — the text of the pages (pdf.js)
├── epub-to-markdown.js     # A book — its chapters (EPUB is a bundle of pages)
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
    ├── drag-drop.js        # A file, an address or a piece of text, dropped on the app
    ├── url-import.js       # Import a document from a web address
    ├── url-sources.js      # What a URL points at — GitHub, Hugging Face, YouTube, Substack, Reddit, file, page
    ├── print.js            # Printing and PDF export of the rendered document
    ├── preview.js          # Render pipeline, lazy tokenization, sync scrolling
    ├── controls.js         # Playback, voice, dictation, theme, network, PWA
    ├── settings-modal.js   # Preferences
    └── dialog.js           # In-app confirmation dialog
server/
├── proxy-core.js           # The proxy that reads pages the browser may not read
└── youtube-transcript.js   # The transcript of a video, read on the server
functions/
└── api/
    ├── fetch.js            # Cloudflare Pages Function — mounts the proxy at /api/fetch
    └── youtube-transcript.js  # …and the transcript at /api/youtube-transcript
tests/                      # Vitest unit tests for the pure logic
```

### Reading a page from the web

Most websites do not allow a browser to read them from another origin — they answer with a CORS error instead of the page. The import therefore tries three ways, in this order:

1. **The page itself.** Nothing leaves the browser, and it costs nothing.
2. **The proxy of the app** — a Cloudflare Pages Function that carries the raw bytes and nothing else. The conversion still happens in the browser. A file that is not text — a PDF, a book — travels as base64.
3. **A public reader service.** The last resort, and it can be switched off under *Preferences → Web import*, because the address is handed to a third party.

The proxy checks every address before it fetches it: only `http` and `https`, only the standard ports, never a private, loopback or link-local address, at most three redirects — each of them checked again — a ten second timeout and a five megabyte cap. The conversion itself is done by Readability (the algorithm behind the reading mode of the browsers) and Turndown, both loaded only when a page is actually imported.

### The three readers of their own

Some sites need more than a general reader:

- **YouTube** — a video has no text. The page knows everything about it: the title, the channel, the length, the date, the description and the chapters. The transcript is fetched as well, when YouTube is willing to hand it out; when it is not, the document says so instead of pretending.
- **Substack** — the page knows where the post is and where the paywall begins. A post for subscribers is cut short, and the document says that too. A publication with a domain of its own is recognised by the page, not by its address.
- **Reddit** — the thread is read from the JSON Reddit serves, the feed is the second way in, and the page itself the last. Reddit refuses many addresses, so the proxy dresses up as a browser when it talks to it.
- **YouTube** — the transcript is the caption track of the video. The track that the page names is guarded by a token that only a player can produce, and the answer of the server is an empty one. The other way in is the address that the players of the apps use: it asks for the video with the voice of the app for Android, and the answer carries the captions that can be read right away. That address does not allow a call from a browser at all — it answers with the address of the caller in the wrong shape and no permission — so the work is done by the server, at `/api/youtube-transcript`. Only the address of the video is taken from the caller; the address that is fetched is fixed in the code.
- **arXiv** — the metadata of the paper comes from the API of arXiv, the paper itself from the form arXiv draws from the LaTeX of the author. The formulas of that form are MathML, but every one of them keeps the LaTeX it was written in — so the formula is put back the way it was written, and the app draws it. The little differences between LaTeX and the renderer of the app — an empty argument of an environment, a reference to a label — are taken care of along the way. A paper that arXiv has not drawn is read out of its PDF instead; the prose is there, the formulas are not.

### Reliability guarantees

- **No ghost audio.** The preview DOM is only rewritten after narration has been stopped, so an utterance can never describe a document that no longer exists.
- **No stuck "playing" state.** A watchdog reconciles the engine state with the Web Speech API, so a browser that silently drops an utterance cannot leave the UI out of sync.
- **Correct word highlighting.** The auto-scroll uses the real scroll container and viewport-relative math, and token lookup is O(1) through a `Map`.
- **Unblocked input.** Tokenization runs during idle time instead of on every keystroke, and the draft is persisted on a debounce.
- **Small first load.** Only the 36 most common syntax highlighting languages are bundled; the full set is fetched on demand. Mermaid works the same way — the diagram parsers are only downloaded when a document actually contains a diagram, and the service worker keeps them for the next offline start. The page reader is loaded the same way: a visitor who never imports a web page never downloads Readability or Turndown.
- **A fetched page cannot hurt the document.** The HTML of a page is read in an inert document where no script runs, and the result is converted to plain Markdown before it reaches the editor — where it goes through the same sanitizer as everything else.
- **Diagrams are not read aloud.** A Mermaid diagram is a picture, not prose: its labels stay out of the narration and out of the word count — unless the preference "Read diagram labels aloud" is switched on.

---

## License

MIT
