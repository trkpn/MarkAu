# MarkAu

**Markdown you can hear.**

A fast, lightweight and offline-capable Markdown editor with real-time text-to-speech (TTS) audio narration and voice dictation. Import a page, a video, a paper, a PDF, a book or a Word document; translate it; then follow along word by word as it is read aloud to you. Runs 100% in your browser — the only server piece is an optional one-function proxy that reads the web pages a browser is not allowed to read.

---

## Features

- **Paste from the clipboard:** A button next to the view tabs takes the clipboard and makes it the document. What is pasted replaces what is there — the way opening a file or importing an address does — so a new text is never mixed into the old one, and a text that is already the document changes nothing. The paste button, `Ctrl`/`Cmd` + `V` in the editor and `Ctrl`/`Cmd` + `Shift` + `V` anywhere all follow the same rule.
- **Import from a URL:** A button next to Paste takes a web address and brings the document in as Markdown. The import becomes the document — it replaces what was there, the way opening a file does — so a new document is never mixed into the text of the old one. A GitHub repository, a Hugging Face model / dataset / Space or a `.md` file is taken as it is — the Markdown the author wrote, untouched. Any other page is reduced to its main content the way a reading mode does: the navigation, the adverts and the footer are dropped, the headings, links, code and tables are kept, and the result is converted in the browser.
- **YouTube, Substack and Reddit:** A video becomes a document with its title, channel, length, date, description, chapters and its transcript. A post of a Substack publication becomes the post, with a note when only the open part could be read. A thread becomes the post and its comments; a subreddit becomes the list of its latest posts.
- **arXiv papers:** A paper becomes a document with its title, authors, subjects, the journal it was published in, its abstract — and the paper itself, drawn by arXiv from the LaTeX of the author. Every formula keeps the LaTeX it was written in, so the app draws it with KaTeX.
- **Drag and drop:** Something can be dropped on the app, and the app knows what to do with it. A file of text is opened, an address is imported, a piece of text lands in the document, a PDF, a book or a Word document is read. A panel says which of them will happen before anything is dropped.
- **Translation:** A button next to Import reads the document in another language. Only the language it should end up in is asked for — the language it comes from is found on its own, and reported back afterwards. The structure of the document survives: code, formulas, links, images and tables are kept as they are, and only the words around them are translated. A selection in the editor is translated on its own; without one, a short document is translated in one pass, while a long document is translated as you scroll — the rest is not sent anywhere until you reach it. The original is kept, so the translation can be taken back.
- **Version history:** The versions of the document are kept in the browser — and nowhere else. A version is taken a few seconds after a change worth keeping (and after ten minutes without one), the text that was there is kept before the document is replaced by an import, a translation, a reset or a paste, and `Ctrl`/`Cmd` + `S` keeps one at once. Small edits do not fill the list. The list can be looked at, a version can be put back, and the whole history can be thrown away.
- **PDF, EPUB and Word:** A PDF is read with the reader the browsers use (pdf.js): the text of the pages is taken out of the drawings. A book in EPUB form is opened in the browser — it is a bundle of HTML pages — and every chapter is turned into Markdown, so a whole book becomes one document. A Word document is opened in the browser too: its headings, paragraphs, lists, tables, links and emphasis are kept, and the file never leaves the machine. All three are loaded on demand.
- **Split View Editor:** Real-time Markdown preview with syntax highlighting (Highlight.js) and LaTeX math formulas (KaTeX).
- **Mermaid diagrams:** A ` ```mermaid ` fence is drawn as a real diagram in the preview — flowcharts, sequence diagrams, class diagrams, state machines and the rest of the Mermaid catalogue. The diagram follows the app theme, can be zoomed, panned and downloaded as an SVG, and a broken diagram shows the error next to its source instead of failing silently.
- **Callouts, footnotes and emoji:** `> [!NOTE]` blockquotes become coloured panels, `[^1]` footnotes collect at the end of the document, `:tada:` becomes 🎉, and every heading gets a link to itself.
- **Code blocks with a header:** The language, a copy button and the line numbers frame every code block.
- **Print and PDF:** The print button (or `Ctrl`/`Cmd` + `P`) prints the _rendered_ document — diagrams, callouts and footnotes included — and the browser's dialog can save it as a PDF.
- **Synchronized Audio Reader:** Word-by-word text-to-speech highlighting using the browser's native `Intl.Segmenter` and Web Speech API. The signs that are not prose — the permalink of a heading, a formula, the time of a transcript — are seen, not heard.
- **One transport, one meaning:** The header carries a single Play / Pause button, the mini player carries a single toggle, `Space` toggles, and a click on the empty space of the preview toggles — all four do the same thing, everywhere. The Space key works even when a button or a slider has the focus; only a check box and an open dialog keep it for themselves.
- **Interactive Click-to-Speak:** Click any word in the preview to start reading aloud from that exact spot. Click the empty space around the text to play or pause — the same thing `Space` does.
- **Mini player:** While the narration runs, a compact bar floats at the bottom of the preview with pause, stop and progress — the transport is never a long reach away on a phone.
- **Follow the narration:** The preview can follow the word being read, and it yields the moment you scroll by hand instead of dragging you back.
- **Document outline:** A floating panel lists the document's headings; clicking one jumps there and starts reading from it. The header shows the current section as a breadcrumb.
- **Continuous narration:** Sentences are grouped into requests sized to the playback rate, and the next request is already waiting in the browser's queue - so the voice does not fall silent between sentences, and long documents are no longer truncated.
- **Voice Dictation (STT):** Speak into your microphone to type Markdown directly at your cursor position.
- **Resizable Workspace:** Drag the divider between the editor and the preview to set the split — the size is remembered per axis.
- **Layout You Choose:** Keep the panels side-by-side (left/right) or stacked (top/bottom) in _any_ orientation. The default follows the screen orientation, but you can override it at any time.
- **Synced scrolling with three modes:** _Proportional_ (the default — both panes scroll at the same rate), _By source line_ (the preview follows the exact paragraph the editor is showing) or _Off_.
- **Files:** Open a `.md` file (button or drag & drop) and save the document as Markdown or HTML.
- **Tailwind CSS Design System:** The whole interface is built on Tailwind CSS v4 with runtime-switchable design tokens (dark / light / follow the system).
- **Offline Ready:** The service worker serves the app shell and every asset from the cache, so a cold start without a network loads in milliseconds. Zero network fonts, client-side persistence.
- **No flash on load:** The stylesheet is linked in the document head, so the browser paints the styled shell immediately instead of an unstyled skeleton while the script boots.
- **Preferences:** Three independent font levels — _Interface_ (app chrome), _Reading_ (the rendered document) and _Editor_ (the Markdown source) — plus preview size, line spacing, theme, sync mode, narration mode, auto-save, panel arrangement and more. Every font can stay on the operating system's default.
- **Several tabs at once:** Each tab keeps its own document and scroll position, so several articles can be read one tab at a time and closed when done; preferences and the version history are shared and follow a change made in another tab, and only one tab narrates at a time.

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
| `Space` _(outside the editor)_         | Play / pause reading aloud — the same as the Play button       |
| `Esc`                                  | Stop reading — or close the Preferences dialog when it is open |
| `Ctrl`/`Cmd` + `B`                     | Bold the selection                                             |
| `Ctrl`/`Cmd` + `I`                     | Italicise the selection                                        |
| `Ctrl`/`Cmd` + `S`                     | Save the draft and keep a version                              |
| `Ctrl`/`Cmd` + `Alt`/`Option` + `N`    | Open a new tab for another document                            |
| `Ctrl`/`Cmd` + `Shift` + `V`           | Paste as the new document                                      |
| `Ctrl`/`Cmd` + `Shift` + `U`           | Import a document from a web address                           |
| `Ctrl`/`Cmd` + `Shift` + `L`           | Translate the document into another language                   |
| `Ctrl`/`Cmd` + `Shift` + `H`           | Open the version history                                       |
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
├── app/                    # UI and feature controllers
│   ├── shell/              # dom, status, layout, toolbar, controls, shortcuts, dialog
│   ├── editor/             # editor, paste, document-title, new-tab, print
│   ├── preview/            # preview, outline, narration, mini-player
│   ├── import/             # url-import, sources, drag-drop
│   ├── history/            # the version-history dialog
│   ├── settings/           # preferences modal
│   └── translate/          # the translation dialog
├── core/                   # settings, history store, multi-tab, frontmatter, language
├── markdown/               # parser (KaTeX, Highlight.js, DOMPurify) and Mermaid
├── speech/                 # TTS, STT, voice grouping
├── translation/            # pipeline, provider, languages
├── importers/              # html, youtube, substack, reddit, arxiv, pdf, epub, docx
├── ui/                     # inline SVG icons
├── content/                # built-in sample document
└── styles/                 # Tailwind v4 entry point (@theme tokens, layers)

server/
├── proxy-core.js           # The proxy that reads pages the browser may not read
├── youtube-transcript.js   # The transcript of a video, read on the server
└── translate-core.js       # The translation, read on the server

functions/
└── api/                    # Cloudflare Pages Function routes for the server cores

tests/                      # Vitest unit tests, grouped to mirror src/
├── app/                    # UI/feature controllers
├── core/                   # settings, history, multi-tab, language
├── markdown/               # parser and Mermaid
├── speech/                 # TTS, STT, voices
├── translation/            # pipeline, provider, app dialog
├── importers/              # document readers and drag/drop
├── server/                 # proxy and translation cores
└── helpers.js              # shared browser stubs
```

The browser code and the tests import through the `@/` alias, which points at
`src/`. The server cores and the Cloudflare functions keep relative imports,
because Cloudflare does not resolve Vite aliases.

### Reading a page from the web

Most websites do not allow a browser to read them from another origin — they answer with a CORS error instead of the page. The import therefore tries three ways, in this order:

1. **The page itself.** Nothing leaves the browser, and it costs nothing.
2. **The proxy of the app** — a Cloudflare Pages Function that carries the raw bytes and nothing else. The conversion still happens in the browser. A file that is not text — a PDF, a book, a Word document — travels as base64.
3. **A public reader service.** The last resort, and it can be switched off under _Preferences → Web import_, because the address is handed to a third party.

The proxy checks every address before it fetches it: only `http` and `https`, only the standard ports, never a private, loopback or link-local address, at most three redirects — each of them checked again — a ten second timeout and a five megabyte cap. The conversion itself is done by Readability (the algorithm behind the reading mode of the browsers) and Turndown, both loaded only when a page is actually imported.

### The three readers of their own

Some sites need more than a general reader:

- **YouTube** — a video has no text. The page knows everything about it: the title, the channel, the length, the date, the description and the chapters. The transcript is fetched as well, when YouTube is willing to hand it out; when it is not, the document says so instead of pretending.
- **Substack** — the page knows where the post is and where the paywall begins. A post for subscribers is cut short, and the document says that too. A publication with a domain of its own is recognised by the page, not by its address.
- **Reddit** — the thread is read from the JSON Reddit serves, the feed is the second way in, and the page itself the last. Reddit refuses many addresses, so the proxy dresses up as a browser when it talks to it.
- **YouTube** — the transcript is the caption track of the video. The track that the page names is guarded by a token that only a player can produce, and the answer of the server is an empty one. The other way in is the address that the players of the apps use: it asks for the video with the voice of the app for Android, and the answer carries the captions that can be read right away. That address does not allow a call from a browser at all — it answers with the address of the caller in the wrong shape and no permission — so the work is done by the server, at `/api/youtube-transcript`. Only the address of the video is taken from the caller; the address that is fetched is fixed in the code.
- **arXiv** — the metadata of the paper comes from the API of arXiv, the paper itself from the form arXiv draws from the LaTeX of the author. The formulas of that form are MathML, but every one of them keeps the LaTeX it was written in — so the formula is put back the way it was written, and the app draws it. The little differences between LaTeX and the renderer of the app — an empty argument of an environment, a reference to a label — are taken care of along the way. A paper that arXiv has not drawn is read out of its PDF instead; the prose is there, the formulas are not.

### Translating a document

The user says where the text should end up; the language it comes from is found by the translator itself and reported back afterwards.

The translator knows nothing about Markdown, so the document is taken apart before it goes anywhere:

- **What carries meaning on its own is set aside** — the front matter, the fenced blocks of code (the diagrams of Mermaid among them), the blocks of mathematics, the lines of HTML. None of it is ever sent away.
- **What only carries structure is lifted off** — the `#` of a heading, the `-` of a list, the `|` of a table. It is put back afterwards, so the shape of the document is the same before and after.
- **The words in between are marked with a token** — the name of a function, the destination of a link, the marks of an emphasis. The translator moves them around as a whole and cannot split them. A token that comes back changed, missing or doubled means that the structure was damaged, and then that piece of the document is left as it was: a document that is half-translated is better than a document whose code no longer compiles.

The document is translated piece by piece, and every piece that comes back is written into the document right away. A short document finishes in one pass. A long document follows the reader: the visible section and a short look-ahead are translated, and the next section waits until it is reached. The bar names the work that is left, so a long document cannot be mistaken for a hang. A translation that is no longer wanted can be stopped: what has been translated stays, and the original is still there to go back to. The target and the translated ranges are kept, so a reload can continue instead of translating the same pages again.

The translation is asked for at `/api/translate`, a Cloudflare Pages Function. The address of the translator stays out of the app, and a refusal is tried again. But the server of a site on Cloudflare shares its address with every other site on it — and the translator counts what it does per address — so when the server says that the translator is busy, the browser asks the translator itself: every visitor has an address of their own, and the answer is the same. A refusal is never the end of the story: the request is made again after a pause, a few times, before the user is told about it.

The translator counts its clients apart, and one of them can be refused for hours while the others answer. So the app asks with one client after another and remembers the one that worked — the next request goes straight to it.

### The versions of the document

The editor keeps the versions of the document, so that a text that is gone can come back.

A version is taken at three moments:

- **when the change is worth one** — a few seconds after the text stops changing (10 seconds by default), and only when the edit is big enough: at least 40 characters, or 1% of the last version, changed. A word or a fixed typo is not a version. However, when nothing has been kept for ten minutes, the next edit is kept whatever its size, so work that grows a word at a time is not lost either;
- **when the document is replaced** — an import, a translation, a reset, a paste or a dropped text — the text that was there is kept at once, and the text that replaced it is kept like a new document, whatever its size;
- **when the user asks for it** — **Save version now** in the dialog, or `Ctrl`/`Cmd` + `S` while writing. Both keep the document right away, even if the last edit was a single character.

Nothing is kept for an edit that changes nothing: pasting the same text over itself, restoring a version that is already on screen, or any other no-op. The same text is never kept twice either — a document that was kept before is moved to the top instead of being kept again.

**The flow, inside:** every change of the editor reaches the history as one event. A no-op ends there. A replaced document keeps the old text at once and marks the new one to be kept whatever its size. An ordinary edit plans a capture for when the typing stops; when it fires, the size of the change is weighed against the newest version, and only a change that is worth it (or one that follows ten silent minutes) becomes a version. `Ctrl`/`Cmd` + `S` and **Save version now** skip the weighing. Restoring keeps the text that is on screen as _Before restoring_, writes the old version into the editor, and leaves the restored text alone (it is already in the list). After every write the list in the dialog and the figure under _Preferences → History_ are refreshed.

**What is kept:** the Markdown of the document, together with the moment it was taken, the reason it was taken and a few figures about it (its title, its length, its number of words). The list of the versions shows the title, how long ago it was taken and why it was kept; **Preview** shows the first 1,500 characters of it.

**Where it lives:** in the localStorage of the browser, under the key `markau_history_v1` — and nowhere else. Nothing is sent to a server, and the history dies with the browser data. A payload that was edited by hand or cut in half by a crash is thrown away and the history starts from empty; it never brings the app down.

**How much there is:** at most 100 versions by default (10, 30, 50 or 100 under _Preferences → History_) and about 1.5 MB of text. The oldest versions go first when there are more of them than that, and at least one version always stays. The same text is never stored twice: a document that was kept before is moved to the top instead of being kept again, so pasting the same thing ten times leaves one version.

**How it is thrown away:** with **Clear history** in the history dialog, or with **Clear history** under _Preferences → History_. Both ask first. A single version is deleted right away, without a question — the whole history is the thing that needs a confirmation.

The history can be switched off altogether under _Preferences → History_; nothing is kept then.

---

### Several tabs at once

Two or three tabs of the app can be open, each with its own document. The **Open a new tab** button in the header opens one for the next article; the tab starts empty, and it stays empty on reload, so the article that is already open is not copied into it. The document of a tab is kept in the `sessionStorage` of that tab, so an autosave in one tab never overwrites the text of another; a recovery copy also goes to `localStorage` under `markdown_draft`, and a tab that has no copy of its own (a fresh tab, a restored session) starts from that copy. An empty tab closed right away leaves the recovery copy alone. The scroll position is kept per tab in the same way.

Opening the app URL by hand follows the same idea: if another tab is already open, the new one starts empty instead of showing the article of the first; when it is the only tab, it resumes the last document. A browser-duplicated tab and a reload keep the document that is on their screen.

What is shared, is shared live: a preference changed in one tab is applied to the others as soon as it is saved, and an open history dialog re-reads the history when another tab writes a version. Two tabs do not narrate at the same time — the moment one tab starts reading, the others pause with **Paused — another tab is reading. Press Play to take over.**; pressing Play there takes the reading back, and the first tab pauses in turn.

The tab strip is the list of open documents: each tab is named after its document (the front-matter title, the first heading, or the first line), and the tab that is reading carries a **▶** and a green dot on its icon. Switching away from a tab, or closing it, writes the draft and the reading position right away, so the last few seconds of typing are not lost to a pending timer. A tab that is put into the back/forward cache stops reading instead of being left silently "playing".

---

### Reliability guarantees

- **No ghost audio.** The preview DOM is only rewritten after narration has been stopped, so an utterance can never describe a document that no longer exists.
- **No stuck "playing" state.** A watchdog reconciles the engine state with the Web Speech API: an utterance that is silently dropped, an engine that keeps claiming to speak while producing no audio, and an engine the browser paused on its own are all noticed and the reading is resumed — a press of Play always heals a reading that went quiet.
- **A lost sentence does not end the reading.** A chunk that the engine refuses, drops or errors on is asked for again; only a chunk that keeps failing is skipped, and the rest of the document is still read.
- **The document's own language.** Nothing is hardcoded to one language: the narration names the language from the writing system (Thai, Lao, Khmer, Burmese, Japanese, Korean, Chinese, Arabic, Persian, Urdu, Hebrew, Greek, Cyrillic, the Indic scripts, Georgian, Armenian, Amharic) and, for the Latin alphabet, from common words and distinctive letters (English, French, German, Spanish, Portuguese, Italian, Dutch, the Scandinavian languages, Polish, Czech, Romanian, Hungarian, Croatian, Catalan, Turkish, Vietnamese, Indonesian). The engine then speaks with a matching voice and splits at that language's own sentence and word boundaries; code blocks do not count as prose.
- **Correct word highlighting.** The auto-scroll uses the real scroll container and viewport-relative math, and token lookup is O(1) through a `Map`.
- **Unblocked input.** Large documents are rendered in token groups, tokenized in speech windows, and translated in visible ranges. Typing in a large document patches the affected block instead of re-rendering the whole book, and drafts, history and the translation original live in IndexedDB when they outgrow localStorage.
- **Small first load.** Only the 36 most common syntax highlighting languages are bundled; the full set is fetched on demand. Mermaid works the same way — the diagram parsers are only downloaded when a document actually contains a diagram, and the service worker keeps them for the next offline start. The page reader is loaded the same way: a visitor who never imports a web page never downloads Readability or Turndown.
- **A fetched page cannot hurt the document.** The HTML of a page is read in an inert document where no script runs, and the result is converted to plain Markdown before it reaches the editor — where it goes through the same sanitizer as everything else.
- **Diagrams are not read aloud.** A Mermaid diagram is a picture, not prose: its labels stay out of the narration and out of the word count — unless the preference "Read diagram labels aloud" is switched on.
- **A translation cannot break the document.** Code, formulas, links and images are never sent to the translator, and a piece whose structure came back damaged is left as it was rather than written into the document broken.

---

## License

MIT
