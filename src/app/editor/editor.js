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
import { isDocumentFile, readDocumentFile } from '@/app/import/document-file.js';
import {
  beginImport,
  endImport,
  isCurrentImport,
  showImportProgress
} from '@/app/import/import-job.js';
import {
  deleteStored,
  isStorageAvailable,
  readStored,
  STORE,
  writeStored
} from '@/core/storage.js';
import { isSpeaking, stop as stopNarration } from '@/speech/tts.js';
import { setMessage } from '@/app/shell/status.js';
import { LARGE_DOC_CHARS } from '@/core/schedule.js';

const DRAFT_KEY = 'markdown_draft';
/** When the shared recovery copy was last written, as a millisecond stamp. */
const DRAFT_AT_KEY = 'markdown_draft_at';
/**
 * The draft of *this tab*. Several tabs are open at once - the reader pastes
 * a different document into each - so each tab keeps its own copy; the shared
 * key above is only the recovery copy that a tab without a copy of its own
 * can start from.
 */
const TAB_DRAFT_KEY = 'markdown_draft_tab';
/** When this tab's own draft was last written, as a millisecond stamp. */
const TAB_DRAFT_AT_KEY = 'markdown_draft_tab_at';
/** Set when the draft of this tab lives in IndexedDB rather than sessionStorage. */
const TAB_IDB_KEY = 'markdown_draft_tab_idb';
/** Set when the tab was opened deliberately empty (the New tab button). */
const NEW_TAB_KEY = 'markdown_new_tab';
const WORDS_PER_MINUTE = 180;

const contentListeners = new Set();

let draftTimer = null;
let lifecycleBound = false;
let cachedLineCount = 0;
let pendingMutationReason = null;
let statsTimer = null;

/* ==========================================================================
 * Content change notifications
 * ========================================================================== */

/**
 * Subscribes to document mutations.
 * @param {(payload: { reason: 'edited'|'replaced'|'translated' }) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onContentChange(fn) {
  contentListeners.add(fn);
  return () => contentListeners.delete(fn);
}

function emitChange(reason, meta = {}) {
  contentListeners.forEach((fn) => {
    try {
      fn({ reason, ...meta });
    } catch (e) {
      console.error('Content listener error:', e);
    }
  });
}

/**
 * The line a caret sits on, without splitting the document.
 *
 * This is kept out of the input event for a large document: the preview
 * calls it from its debounced patch, where one walk of the text is cheap
 * enough.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {number} 1-based
 */
export function lineAtOffset(text, offset) {
  const limit = Math.max(0, Math.min(text.length, offset));
  let line = 1;

  for (let index = 0; index < limit; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }

  return line;
}

/* ==========================================================================
 * Document statistics
 * ========================================================================== */

/**
 * Updates the line-number gutter and the footer statistics.
 *
 * @param {boolean} [immediate]
 */
function updateStats(immediate = false) {
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }

  if (immediate) {
    runStats();
    return;
  }

  statsTimer = setTimeout(() => {
    statsTimer = null;
    runStats();
  }, 80);
}

/**
 * The actual pass over the document. It is kept out of the input event so a
 * book-sized paste is counted once the typing has settled.
 */
function runStats() {
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
 * The identity of this tab, used as the key of its large draft.
 * @returns {string}
 */
function tabId() {
  try {
    let id = sessionStorage.getItem('markau_tab_id');
    if (!id) {
      id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('markau_tab_id', id);
    }
    return id;
  } catch {
    return 'tab';
  }
}

/**
 * @returns {string}
 */
function tabDraftStoreKey() {
  return `tab:${tabId()}`;
}

/**
 * Writes the draft right away.
 *
 * Small documents keep the immediate session/local copies. Large documents
 * go straight to IndexedDB, where the browser quota is large enough for a
 * book and the write does not block the page. The shared recovery copy is
 * kept in step too, so a new tab does not open an older article.
 *
 * @returns {boolean} whether the write succeeded
 */
function writeDraft() {
  if (!el.editor) return false;
  const value = el.editor.value;
  const now = Date.now();
  const large = value.length > LARGE_DOC_CHARS;
  let tabSaved = false;
  let localSaved = false;
  let hadIdbDraft = false;

  try {
    hadIdbDraft = sessionStorage.getItem(TAB_IDB_KEY) === '1';
  } catch {
    /* storage unavailable */
  }

  if (!large || !isStorageAvailable()) {
    try {
      // Even an empty document is a draft of its own: reloading after a Clear
      // must stay empty instead of bringing the recovery copy back.
      sessionStorage.setItem(TAB_DRAFT_KEY, value);
      sessionStorage.setItem(TAB_DRAFT_AT_KEY, String(now));
      sessionStorage.removeItem(NEW_TAB_KEY);
      tabSaved = true;
    } catch {
      /* session storage unavailable - the recovery copy is all there is */
    }

    try {
      if (value) {
        localStorage.setItem(DRAFT_KEY, value);
        localStorage.setItem(DRAFT_AT_KEY, String(now));
        localSaved = true;
      }
    } catch (err) {
      if (!tabSaved) {
        console.warn('Local draft could not be written:', err);
      }
    }
  }

  // A book does not belong in sessionStorage or localStorage, and a tab
  // whose session copy could not be written has to keep its draft somewhere
  // durable.
  if (isStorageAvailable() && (large || !tabSaved)) {
    writeStored(STORE.DRAFT, tabDraftStoreKey(), {
      markdown: value,
      at: now,
      tabId: tabId()
    }).catch(() => {});

    if (value) {
      writeStored(STORE.DRAFT, 'recovery', {
        markdown: value,
        at: now
      }).catch(() => {});
    }

    try {
      sessionStorage.setItem(TAB_IDB_KEY, '1');
      sessionStorage.removeItem(NEW_TAB_KEY);
    } catch {
      /* the marker is only an optimization */
    }

    return true;
  }

  if (isStorageAvailable()) {
    // The session copy is the tab's own; the small IDB copy of an older,
    // larger draft must not shadow it. The recovery copy is shared, so it is
    // refreshed for any new tab that starts from the last document.
    if (value) {
      writeStored(STORE.DRAFT, 'recovery', {
        markdown: value,
        at: now
      }).catch(() => {});
    }

    if (hadIdbDraft) {
      deleteStored(STORE.DRAFT, tabDraftStoreKey()).catch(() => {});
    }

    try {
      sessionStorage.removeItem(TAB_IDB_KEY);
      sessionStorage.removeItem(NEW_TAB_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  if (tabSaved || localSaved) return true;

  console.error('Failed to persist draft: browser storage is unavailable');
  setMessage('Draft could not be saved - browser storage is full', { tone: 'warn', ttl: 5000 });
  return false;
}

/**
 * Reads a draft that was too large for the local stores.
 *
 * The copies are compared by the time they were written: a tab whose draft
 * became small again must not be restored from an older, larger IDB copy,
 * and a new tab must not open a recovery copy that the local draft has
 * already replaced.
 *
 * @param {string} [fallback] the value the synchronous reader found
 * @returns {Promise<string>}
 */
export async function loadDraftAsync(fallback = '') {
  let ownDraftExists = false;
  let largeDraft = false;
  let newTab = false;
  let sessionAt = 0;
  let localAt = 0;

  try {
    ownDraftExists = sessionStorage.getItem(TAB_DRAFT_KEY) !== null;
    largeDraft = sessionStorage.getItem(TAB_IDB_KEY) === '1';
    newTab = sessionStorage.getItem(NEW_TAB_KEY) === '1';
    sessionAt = Number(sessionStorage.getItem(TAB_DRAFT_AT_KEY)) || 0;
  } catch {
    /* storage unavailable */
  }

  try {
    localAt = Number(localStorage.getItem(DRAFT_AT_KEY)) || 0;
  } catch {
    /* storage unavailable */
  }

  // A deliberately blank tab stays blank until it has a draft of its own.
  if (newTab && !ownDraftExists) return '';

  // A small draft is held by the session copy; its being empty is a real
  // answer (the document was cleared), not a reason to try the recovery copy.
  if (ownDraftExists && !largeDraft) return fallback;

  if (!isStorageAvailable()) return fallback;

  const own = await readStored(STORE.DRAFT, tabDraftStoreKey());
  const fallbackAt = ownDraftExists ? sessionAt || localAt : localAt;

  const candidates = [];
  const add = (text, at) => {
    if (typeof text === 'string') candidates.push({ text, at: Number(at) || 0 });
  };

  if (ownDraftExists) {
    // This tab's own copies only: another tab's recovery document is not
    // this tab's document. On a tie the IDB copy wins, because a large draft
    // is written there and the session copy can only be older.
    if (own) add(own.markdown, own.at);
    add(fallback, fallbackAt);
  } else {
    add(fallback, fallbackAt);
    if (own) add(own.markdown, own.at);

    const recovery = await readStored(STORE.DRAFT, 'recovery');
    if (recovery) add(recovery.markdown, recovery.at);
  }

  if (candidates.length === 0) return fallback;

  candidates.sort((a, b) => b.at - a.at);
  return candidates[0].text;
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
    sessionStorage.removeItem(TAB_DRAFT_AT_KEY);
    sessionStorage.removeItem(TAB_IDB_KEY);
  } catch {
    /* session storage unavailable - the tab is still blank right now */
  }
  deleteStored(STORE.DRAFT, tabDraftStoreKey()).catch(() => {});
}

/**
 * Whether this tab already has a document of its own. A browser-duplicated
 * tab does; a brand-new tab does not.
 * @returns {boolean}
 */
export function hasTabDraft() {
  try {
    return (
      sessionStorage.getItem(TAB_DRAFT_KEY) !== null ||
      sessionStorage.getItem(TAB_IDB_KEY) === '1'
    );
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
 * @param {'edited'|'replaced'|'translated'} reason
 */
function handleMutation(reason, meta = {}) {
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
  emitChange(reason, meta);
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
 * @param {'edited'|'replaced'|'translated'} [reason]
 */
export function setMarkdown(text, reason = 'replaced') {
  pendingMutationReason = reason;
  el.editor.value = text;
  el.editor.dispatchEvent(new Event('input', { bubbles: true, inputType: 'insertText' }));
}

/**
 * Replaces one range of the document without touching the rest.
 *
 * Translation writes one translated window at a time. A full-buffer rewrite
 * of a ten-megabyte document for every window would make the lazy promise a
 * lie, so the range is replaced and the normal mutation pipeline is notified
 * once.
 *
 * @param {{ start: number, end: number, text: string }} patch
 * @param {'edited'|'replaced'|'translated'} [reason]
 * @returns {boolean} whether the range still matched what the caller saw
 */
export function applyDocumentPatch(patch, reason = 'translated') {
  const start = Math.max(0, Math.min(el.editor.value.length, Number(patch.start) || 0));
  const end = Math.max(start, Math.min(el.editor.value.length, Number(patch.end) || 0));
  const replacement = String(patch.text ?? '');

  if (typeof patch.expected === 'string' && el.editor.value.slice(start, end) !== patch.expected) {
    return false;
  }

  const selectionStart = el.editor.selectionStart;
  const selectionEnd = el.editor.selectionEnd;
  const scrollTop = el.editor.scrollTop;
  const value = el.editor.value;
  const next = value.slice(0, start) + replacement + value.slice(end);

  if (next === value) return true;

  pendingMutationReason = reason;
  el.editor.value = next;

  if (document.activeElement === el.editor) {
    const delta = replacement.length - (end - start);
    const nextStart = selectionStart > end ? selectionStart + delta : Math.min(selectionStart, next.length);
    const nextEnd = selectionEnd > end ? selectionEnd + delta : Math.min(selectionEnd, next.length);
    el.editor.setSelectionRange(nextStart, nextEnd);
  }

  el.editor.scrollTop = scrollTop;
  if (el.lineNumbers) el.lineNumbers.scrollTop = scrollTop;

  el.editor.dispatchEvent(new Event('input', { bubbles: true, inputType: 'insertText' }));
  return true;
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
 * Loads a file into the editor.
 *
 * A file of text is opened as it is. A PDF, a book or a Word document is
 * read first, and what it holds becomes the document.
 *
 * @param {File} file
 */
export async function openFile(file) {
  if (!file) return false;

  const documentFile = isDocumentFile(file);
  const job = beginImport(documentFile ? 'Reading' : 'Opening', 'file');

  if (documentFile) {
    setMessage('Reading…', { tone: 'muted' });

    try {
      const { markdown, title, note } = await readDocumentFile(file, {
        signal: job.signal,
        onProgress: (progress) => showImportProgress(job, progress)
      });

      if (!isCurrentImport(job)) return false;

      setMarkdown(markdown, 'replaced');
      setMessage(`Read ${note} — ${title}`, { tone: 'accent', ttl: 3500 });
      return true;
    } catch (err) {
      if (err?.name === 'AbortError' || !isCurrentImport(job)) return false;

      const message = err instanceof Error ? err.message : 'Could not read that file';
      setMessage(message, { tone: 'warn', ttl: 4000 });
      return false;
    } finally {
      endImport(job);
    }
  }

  try {
    const text = await file.text();
    if (!isCurrentImport(job)) return false;

    setMarkdown(text, 'replaced');
    setMessage(`Opened ${file.name}`, { tone: 'accent', ttl: 2500 });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError' || !isCurrentImport(job)) return false;

    console.error('Failed to read file:', err);
    setMessage('Could not read that file', { tone: 'warn', ttl: 3000 });
    return false;
  } finally {
    endImport(job);
  }
}

/* ==========================================================================
 * Bootstrap
 * ========================================================================== */

/**
 * Initializes the editor.
 * @param {{ initialContent?: string, onSample?: () => void, onCopy?: () => void, onClear?: () => void, onSave?: () => void }} handlers
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

    const meta = {};
    if (
      reason === 'edited' &&
      !event.isComposing &&
      !String(event.inputType || '').includes('Composition') &&
      el.editor.value.length >= LARGE_DOC_CHARS
    ) {
      // The line is worked out in the preview's debounced patch: walking a
      // book-sized document on every keystroke would defeat the lazy path.
      meta.editOffset = el.editor.selectionStart ?? 0;
    }

    handleMutation(reason, meta);
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
        handlers.onSave?.();
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

  updateStats(true);
}
