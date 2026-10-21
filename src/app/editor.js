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

import { el } from './dom.js';
import { getSettings } from '../settings-manager.js';
import { isSpeaking, stop as stopNarration } from '../tts-engine.js';
import { setMessage } from './status.js';
import { renderMarkdown } from '../markdown-parser.js';

const DRAFT_KEY = 'markdown_draft';
const WORDS_PER_MINUTE = 180;

const contentListeners = new Set();

let draftTimer = null;
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

  el.docStats.textContent = `Lines: ${lineCount} | Words: ${wordCount} | Chars: ${charCount}`;
  el.readingTime.textContent = `Reading time: ~${Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE))} min`;
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
 * Writes the draft to localStorage right away.
 * @returns {boolean} whether the write succeeded
 */
function writeDraft() {
  try {
    const value = el.editor.value;
    if (value) {
      localStorage.setItem(DRAFT_KEY, value);
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
    return true;
  } catch (err) {
    console.error('Failed to persist draft:', err);
    setMessage('Draft could not be saved — browser storage is full', { tone: 'warn', ttl: 5000 });
    return false;
  }
}

/**
 * Reads the persisted draft.
 * @returns {string}
 */
export function loadDraft() {
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
 * Decides whether the incoming paste is a "major replacement" of the
 * document, using the real clipboard payload instead of a length guess.
 */
function detectPasteIntent(event) {
  const pasted = event.clipboardData?.getData('text/plain') ?? '';
  return classifyPaste(
    el.editor.value.length,
    el.editor.selectionStart,
    el.editor.selectionEnd,
    pasted.length
  );
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
  scheduleDraftSave();
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
async function openFile(file) {
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
</style>
</head>
<body>
${renderMarkdown(markdown)}
</body>
</html>
`;
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

  // Paste intent is captured before the content changes
  el.editor.addEventListener('paste', (event) => {
    pendingMutationReason = detectPasteIntent(event);
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
      if (action === 'clear') {
        handlers.onClear?.();
        return;
      }
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

  // Opening a file through the picker
  el.fileInput?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) openFile(file);
    event.target.value = '';
  });

  // Drag & drop a Markdown file onto the editor
  const pane = el.paneEditor;
  if (pane) {
    ['dragenter', 'dragover'].forEach((type) => {
      pane.addEventListener(type, (event) => {
        event.preventDefault();
        pane.dataset.dragging = 'true';
      });
    });
    ['dragleave', 'drop'].forEach((type) => {
      pane.addEventListener(type, (event) => {
        event.preventDefault();
        delete pane.dataset.dragging;
      });
    });
    pane.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) openFile(file);
    });
  }

  updateStats();
}
