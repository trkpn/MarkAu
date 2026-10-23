/**
 * ============================================================================
 * EDITOR BUFFER
 * ============================================================================
 * Owns the Markdown source: input events, draft persistence, content
 * replacement detection, the formatting commands and the document statistics.
 *
 * The replacement detection is the heart of the "paste while narrating" fix:
 * it knows exactly what was pasted (via `clipboardData`) and how much of the
 * document it replaced, instead of guessing from a stale length.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { getSettings } from '@/core/settings.js';
import { isSpeaking, stop as stopNarration } from '@/speech/tts.js';
import { setMessage } from '@/app/shell/status.js';
import { renderMarkdown } from '@/markdown/parser.js';

const DRAFT_KEY = 'markdown_draft';
/**
 * The draft of *this tab*. Several tabs are open at once - the reader pastes
 * a different document into each - so each tab keeps its own copy; the shared
 * key above is only the recovery copy that a tab without a copy of its own
 * can start from.
 */
const TAB_DRAFT_KEY = 'markdown_draft_tab';
/** Set when the tab was opened deliberately empty (the New tab button). */
const NEW_TAB_KEY = 'markdown_new_tab';
const WORDS_PER_MINUTE = 180;

const contentListeners = new Set();

let draftTimer = null;
let lifecycleBound = false;
let cachedLineCount = 0;
let pendingMutationReason = null;

/* ==========================================================================
 * Content change notifications
 * ========================================================================== */

/**
 * Subscribes to document mutations.
 * @param {(payload: { reason: 'edited'|'replaced' }) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onContentChange(fn) {
  contentListeners.add(fn);
  return () => contentListeners.delete(fn);
}

function emitChange(reason) {
  contentListeners.forEach((fn) => {
    try {
      fn({ reason });
    } catch (e) {
      console.error('Content listener error:', e);
    }
  });
}

/* ==========================================================================
 * Document statistics
 * ========================================================================== */

/**
 * Updates the line-number gutter and the footer statistics.
 */
function updateStats() {
  const text = el.editor.value;
  const lineCount = text.split('\n').length;

  if (lineCount !== cachedLineCount) {
    cachedLineCount = lineCount;
    const arr = new Array(lineCount);
    for (let i = 0; i < lineCount; i++) arr[i] = i + 1;
    el.lineNumbers.textContent = arr.join('\n');
  }

  const charCount = text.length;
  const trimmed = text.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

  el.docStats.textContent = `Lines: ${lineCount} · Chars: ${charCount}`;
  el.readingTime.textContent = `~${Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE))} min read`;
}

/* ==========================================================================
 * Draft persistence
 * ========================================================================== */

/**
 * Persists the draft. The delay comes from the preferences; with auto-save
 * switched off the document is only written when the user asks for it.
 */
function scheduleDraftSave() {
  if (draftTimer) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }

  const seconds = getSettings().autoSaveSeconds;
  if (!seconds) return;

  draftTimer = setTimeout(() => {
    draftTimer = null;
    writeDraft();
  }, seconds * 1000);
}

/**
 * Writes the draft right away.
 *
 * Two copies are written: this tab's own draft in `sessionStorage`, and the
 * shared recovery copy in `localStorage`. A second tab cannot overwrite the
 * first tab's document (its copy is its own), while a tab that has no copy
 * of its own can still start from the last document.
 *
 * An empty document never erases the recovery copy: the copy may belong to
 * another tab, and a blank tab that is closed right away must not take the
 * last article with it.
 *
 * @returns {boolean} whether the write succeeded
 */
function writeDraft() {
  if (!el.editor) return false;
  const value = el.editor.value;
  let tabSaved = false;

  try {
    // Even an empty document is a draft of its own: reloading after a Clear
    // must stay empty instead of bringing the recovery copy back.
    sessionStorage.setItem(TAB_DRAFT_KEY, value);
    tabSaved = true;
  } catch {
    /* session storage unavailable - the recovery copy is all there is */
  }

  try {
    if (value) localStorage.setItem(DRAFT_KEY, value);
    return true;
  } catch (err) {
    if (tabSaved) {
      console.warn('Draft recovery copy could not be written:', err);
      return true;
    }
    console.error('Failed to persist draft:', err);
    setMessage('Draft could not be saved - browser storage is full', { tone: 'warn', ttl: 5000 });
    return false;
  }
}

/**
 * Starts a deliberately empty tab: the next open of this tab is empty too,
 * not the recovery copy of another article. The recovery copy itself is
 * left alone.
 */
export function startBlankTab() {
  try {
    sessionStorage.setItem(NEW_TAB_KEY, '1');
    sessionStorage.removeItem(TAB_DRAFT_KEY);
  } catch {
    /* session storage unavailable - the tab is still blank right now */
  }
}

/**
 * Whether this tab already has a document of its own. A browser-duplicated
 * tab does; a brand-new tab does not.
 * @returns {boolean}
 */
export function hasTabDraft() {
  try {
    return sessionStorage.getItem(TAB_DRAFT_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Reads the persisted draft of this tab, falling back to the recovery copy
 * the last autosave left behind.
 * @returns {string}
 */
export function loadDraft() {
  try {
    const own = sessionStorage.getItem(TAB_DRAFT_KEY);
    if (own !== null) return own;
    if (sessionStorage.getItem(NEW_TAB_KEY) === '1') return '';
  } catch {
    /* session storage unavailable */
  }

  try {
    return localStorage.getItem(DRAFT_KEY) || '';
  } catch {
    return '';
  }
}

/* ==========================================================================
 * Content mutation handling
 * ========================================================================== */

/**
 * Decides whether an incoming paste is a "major replacement" of the
 * document.
 *
 * Pure on purpose: this is the rule that decides whether narration is
 * interrupted, so it is worth testing on its own.
 *
 * @param {number} currentLength length of the document before the paste
 * @param {number} selectionStart start of the replaced selection
 * @param {number} selectionEnd end of the replaced selection
 * @param {number} pastedLength length of the pasted text
 * @returns {'replaced'|'edited'}
 */
export function classifyPaste(currentLength, selectionStart, selectionEnd, pastedLength) {
  const replacedLength = Math.max(0, selectionEnd - selectionStart);
  const resultingLength = currentLength - replacedLength + pastedLength;

  const selectionWasMost = currentLength > 0 && replacedLength >= currentLength * 0.75;
  const pasteBecomesMost = resultingLength > 0 && pastedLength >= resultingLength * 0.75;

  return selectionWasMost || pasteBecomesMost ? 'replaced' : 'edited';
}

/**
 * Handles a document mutation: stops narration when needed and notifies the
 * preview pipeline.
 * @param {'edited'|'replaced'} reason
 */
function handleMutation(reason) {
  const settings = getSettings();

  if (settings.autoStopOnReplace && isSpeaking()) {
    // Stop BEFORE the preview DOM is rewritten, so the utterance can never
    // describe a document that no longer exists.
    stopNarration(reason === 'replaced' ? 'content-replaced' : 'content-edited');
  }

  updateStats();
  if (reason === 'replaced') {
    // A whole new document (a paste, an import, a restore) is saved right
    // away: it is the article the reader came for, not a keystroke to wait
    // out. Typing keeps the auto-save delay from the preferences.
    flushDraft();
  } else {
    scheduleDraftSave();
  }
  emitChange(reason);
}

/* ==========================================================================
 * Public API
 * ========================================================================== */

/**
 * Replaces the whole document and notifies the rest of the application.
 *
 * The value is written and a native `input` event is dispatched, so the
 * normal mutation pipeline (statistics, draft persistence, narration stop,
 * preview re-render) runs exactly once.
 *
 * @param {string} text
 * @param {'edited'|'replaced'} [reason]
 */
export function setMarkdown(text, reason = 'replaced') {
  pendingMutationReason = reason;
  el.editor.value = text;
  el.editor.dispatchEvent(new Event('input', { bubbles: true, inputType: 'insertText' }));
}

/**
 * Inserts text into the buffer the way a real paste would.
 *
 * The mutation goes through the normal pipeline (statistics, draft
 * persistence, narration stop, preview re-render), so a paste from the
 * clipboard behaves exactly like a manual one.
 *
 * @param {string} text
 * @param {{ replaceDocument?: boolean }} [options] when the document is
 *   replaced the whole buffer is swapped; otherwise the text lands at the
 *   current selection
 * @returns {'replaced'|'edited'} how the mutation was classified
 */
export function insertText(text, { replaceDocument = false } = {}) {
  if (!text) return 'edited';

  if (replaceDocument) {
    setMarkdown(text, 'replaced');
    return 'replaced';
  }

  const start = el.editor.selectionStart;
  const end = el.editor.selectionEnd;
  const reason = classifyPaste(el.editor.value.length, start, end, text.length);

  pendingMutationReason = reason;

  el.editor.focus();
  el.editor.setSelectionRange(start, end);

  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    el.editor.setRangeText(text, start, end, 'end');
    el.editor.dispatchEvent(new Event('input', { bubbles: true, inputType: 'insertText' }));
  }

  return reason;
}

/**
 * Applies a formatting command around the current selection.
 *
 * `execCommand('insertText')` is used on purpose: it is the only API that
 * keeps the browser's native undo history for a textarea. A manual
 * `value = …` rewrite destroys it.
 */
function insertFormatting(prefix, suffix = '', defaultText = '') {
  const start = el.editor.selectionStart;
  const end = el.editor.selectionEnd;
  const selected = el.editor.value.substring(start, end) || defaultText;
  const replacement = `${prefix}${selected}${suffix}`;
  const newCursor = start + prefix.length + selected.length;

  el.editor.focus();
  el.editor.setSelectionRange(start, end);

  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, replacement);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    el.editor.setRangeText(replacement, start, end, 'end');
    el.editor.dispatchEvent(new Event('input', { bubbles: true, inputType: 'insertText' }));
  }

  el.editor.setSelectionRange(newCursor, newCursor);
}

const FORMAT_ACTIONS = {
  bold: () => insertFormatting('**', '**', 'bold text'),
  italic: () => insertFormatting('*', '*', 'italic text'),
  heading: () => insertFormatting('### ', '\n', 'Heading'),
  code: () => insertFormatting('```javascript\n', '\n```\n', '// code here'),
  math: () => insertFormatting('$$\n', '\n$$\n', 'E = mc^2'),
  table: () =>
    insertFormatting('\n| Header 1 | Header 2 |\n| :--- | :--- |\n| Data 1 | Data 2 |\n'),
  task: () => insertFormatting('- [ ] ', '\n', 'New Task')
};

/**
 * Applies a formatting command to the current selection.
 * @param {'bold'|'italic'|'heading'|'code'|'math'|'table'|'task'} action
 */
export function applyFormat(action) {
  FORMAT_ACTIONS[action]?.();
}

/**
 * Writes the draft to localStorage right away instead of waiting for the
 * debounce (used by the "save" shortcut).
 */
export function flushDraft() {
  if (draftTimer) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  return writeDraft();
}

/* ==========================================================================
 * Files
 * ========================================================================== */

/**
 * Loads a Markdown file into the editor.
 * @param {File} file
 */
export async function openFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    setMarkdown(text, 'replaced');
    setMessage(`Opened ${file.name}`, { tone: 'accent', ttl: 2500 });
  } catch (err) {
    console.error('Failed to read file:', err);
    setMessage('Could not read that file', { tone: 'warn', ttl: 3000 });
  }
}

/**
 * Downloads the current document.
 */
function saveFile() {
  const format = getSettings().saveFormat;
  const markdown = el.editor.value;
  const isHtml = format === 'html';

  const blob = new Blob([isHtml ? toHtml(markdown) : markdown], {
    type: isHtml ? 'text/html' : 'text/markdown'
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${suggestFileName()}.${isHtml ? 'html' : 'md'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  setMessage(`Saved ${link.download}`, { tone: 'accent', ttl: 2500 });
}

/**
 * A file name derived from the document's first heading.
 * @returns {string}
 */
function suggestFileName() {
  const heading = el.editor.value.split('\n').find((line) => line.startsWith('# '));
  const title = heading ? heading.slice(2).trim() : 'document';
  const safe = title.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'document';
  return safe.slice(0, 60);
}

/**
 * Wraps the Markdown in a minimal HTML document.
 * @param {string} markdown
 * @returns {string}
 */
function toHtml(markdown) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${suggestFileName()}</title>
<style>
  body { max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem;
         font: 16px/1.75 system-ui, sans-serif; color: #0f172a; }
  pre { background: #0f172a; color: #e2e8f0; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  code { font-family: ui-monospace, monospace; }
  .mermaid-block { margin: 1.3rem 0; padding: 0.9rem; background: #f4f5f8;
                   border: 1px solid #e2e4ec; border-radius: 8px; }
  .mermaid-caption { margin-bottom: 0.6rem; color: #475569; font-size: 0.9em;
                     font-weight: 600; text-align: center; }
  .mermaid-canvas { display: flex; justify-content: center; }
  .mermaid-canvas svg { max-width: 100%; height: auto; }
  .mermaid-source { margin: 0.75rem 0 0; }
  .code-block { margin: 1.2rem 0; border: 1px solid #e2e4ec; border-radius: 8px;
                overflow: hidden; }
  .code-head { display: flex; justify-content: space-between; padding: 0.3rem 0.85rem;
               border-bottom: 1px solid #e2e4ec; background: #f4f5f8;
               color: #64748b; font-size: 0.72rem; text-transform: uppercase; }
  .code-body { display: flex; }
  .code-gutter { padding: 1rem 0.5rem 1rem 0.8rem; border-right: 1px solid #e2e4ec;
                 color: #94a3b8; font-size: 0.88rem; line-height: 1.5; text-align: right;
                 white-space: pre; }
  .code-body pre { border-radius: 0; margin: 0; flex: 1 1 auto; }
  .callout { margin: 1.2rem 0; padding: 0.85rem 1rem; border-left: 4px solid #4c5fd7;
             background: #f4f5f8; }
  .callout-title { margin: 0 0 0.35rem; color: #4c5fd7; font-weight: 700; }
  .callout-tip { border-color: #16a06a; }
  .callout-tip .callout-title { color: #16a06a; }
  .callout-warning { border-color: #d98b28; }
  .callout-warning .callout-title { color: #b06d12; }
  .callout-caution { border-color: #d4453f; }
  .callout-caution .callout-title { color: #d4453f; }
  .footnotes { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #e2e4ec;
               color: #475569; font-size: 0.9em; }
  .heading-anchor { display: none; }
</style>
</head>
<body>
${withRenderedDiagrams(renderMarkdown(markdown))}
</body>
</html>
`;
}

/**
 * Puts the drawn diagrams into the exported HTML.
 *
 * The export is rendered from the Markdown source, so it only contains the
 * diagram placeholders. The SVG that is currently drawn in the preview is
 * copied in — and when there is no drawing (a diagram that could not be
 * parsed, or a preview that is out of date) the source code is revealed
 * instead of shipping an empty box.
 * @param {string} html
 * @returns {string}
 */
function withRenderedDiagrams(html) {
  const blocks = Array.from(el.preview.querySelectorAll('.mermaid-block'));
  if (blocks.length === 0) return html;

  // The drawings of the preview, in the order of the document.
  const drawings = blocks.map((block) => {
    const content = block.querySelector('.mermaid-canvas')?.innerHTML?.trim() ?? '';
    return content.includes('<svg') ? content : '';
  });

  let canvasIndex = 0;
  const withDrawings = html.replace(/<div class="mermaid-canvas"><\/div>/g, (match) => {
    const drawing = drawings[canvasIndex++] ?? '';
    return drawing ? `<div class="mermaid-canvas">${drawing}</div>` : match;
  });

  // A diagram that is not drawn shows its source instead of an empty box.
  let sourceIndex = 0;
  return withDrawings.replace(/<pre class="mermaid-source"([^>]*)>/g, (match, attributes) => {
    const drawing = drawings[sourceIndex++] ?? '';
    if (drawing) return match;
    return `<pre class="mermaid-source"${attributes.replace(/\shidden(=(""|''))?/, '')}>`;
  });
}

/* ==========================================================================
 * Bootstrap
 * ========================================================================== */

/**
 * Initializes the editor.
 * @param {{ initialContent?: string, onSample?: () => void, onCopy?: () => void, onClear?: () => void }} handlers
 */
export function initEditor(handlers = {}) {
  // Seed the buffer before any listener is attached
  el.editor.value = handlers.initialContent ?? '';

  // What the clipboard holds is a document of its own: it replaces the
  // document that is there, instead of being slipped into it. A paste the
  // browser does not share the text of (an image, say) is left to the
  // browser, and an unchanged text is not pasted at all.
  el.editor.addEventListener('paste', (event) => {
    const pasted = event.clipboardData?.getData('text/plain') ?? '';
    if (!pasted) return;

    event.preventDefault();

    if (pasted === el.editor.value) {
      setMessage('The document already holds that text', { tone: 'muted', ttl: 2500 });
      return;
    }

    setMarkdown(pasted, 'replaced');
  });

  el.editor.addEventListener('input', (event) => {
    const isPaste = event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop';
    const reason = pendingMutationReason ?? (isPaste ? 'replaced' : 'edited');
    pendingMutationReason = null;
    handleMutation(reason);
  });

  // Formatting toolbar
  document.querySelectorAll('.toolbar-btn[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'open') {
        el.fileInput?.click();
        return;
      }
      if (action === 'save') {
        saveFile();
        return;
      }
      FORMAT_ACTIONS[action]?.();
    });
  });

  el.btnSample?.addEventListener('click', () => handlers.onSample?.());
  el.btnCopy?.addEventListener('click', () => handlers.onCopy?.());
  // The reset button in the header empties the document, just like the
  // toolbar button of the editor.
  el.btnReset?.addEventListener('click', () => handlers.onClear?.());

  // Opening a file through the picker
  el.fileInput?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) openFile(file);
    event.target.value = '';
  });

  // Drag & drop is handled by the app as a whole — a file, an address or
  // a piece of text can be dropped anywhere on it.

  // The last keystrokes would take the draft timer with them if the tab was
  // closed or hidden first. Write the draft now, while the page still exists.
  if (!lifecycleBound) {
    lifecycleBound = true;
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushDraft();
    });
  }

  updateStats();
}
