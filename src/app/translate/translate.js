/**
 * ============================================================================
 * TRANSLATION
 * Translates the document into another language.
 *
 * The user says where the text should end up; the language it comes from
 * is found by the translator itself. Nothing else is asked.
 *
 * The rule of the app is followed here as well: what the user can see
 * decides what happens.
 *   • a selection in the editor → only the selection is translated, and it
 *     is put back where it was
 *   • no selection              → a short document is translated in one
 *     pass; a long document is translated as the reader scrolls
 *
 * The original is kept, so that the translation can be taken back.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { applyDocumentPatch, onContentChange, setMarkdown } from '@/app/editor/editor.js';
import { getSettings, saveSettings } from '@/core/settings.js';
import { setMessage } from '@/app/shell/status.js';
import { confirmDialog } from '@/app/shell/dialog.js';
import {
  getVisibleSourceRange,
  isPreviewRendering,
  patchPreviewLines
} from '@/app/preview/preview.js';
import {
  isNarrationStarting,
  isSpeaking,
  isSpeechPaused,
  onTTSStateChange,
  wasRecentlyAutoScrolling
} from '@/speech/tts.js';
import {
  deleteStored,
  readStored,
  STORE,
  writeStored
} from '@/core/storage.js';
import {
  LARGE_DOC_CHARS,
  TRANSLATE_LOOKAHEAD_LINES,
  TRANSLATE_MAX_UNITS,
  throwIfAborted,
  yieldToMainThread
} from '@/core/schedule.js';
import { fingerprint } from '@/core/history.js';
import {
  TARGET_LANGUAGES,
  languageName,
  languageEnglishName,
  DEFAULT_TARGET
} from '@/translation/languages.js';
import {
  buildPlan,
  rebuildDocument,
  unmaskText,
  tokensIntact,
  normalizeEol
} from '@/translation/pipeline.js';
import { translateUnits, planRequests, TranslateError } from '@/translation/provider.js';

/** The endpoint of the translator. It is on the same origin. */
const TRANSLATE_ENDPOINT = '/api/translate';

/** The key the original document is kept under. */
const BACKUP_KEY = 'markau_translation_backup';

/** The small mirror of the lazy session, for browsers between IDB writes. */
const SESSION_KEY = 'markau_translation_session';

/** The lazy session that is currently following the reader. */
let lazySession = null;
let lazyTimer = null;
let lazyBusy = false;
let lazyPending = false;
/** The message of the last lazy failure, so the caller does not overwrite it. */
let lazyFailure = null;
/** The delete that a replacement started, so a new backup cannot race it. */
let backupClearPromise = Promise.resolve();
/** The delete of the lazy session, so a new session cannot be deleted by it. */
let lazyClearPromise = Promise.resolve();

/**
 * An error whose message is meant to be read by the user.
 */
export class TranslationError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'TranslationError';
  }
}

/* ==========================================================================
 * The original document
 * ==========================================================================
 */

/**
 * Reads the original document back.
 * @returns {{ markdown: string, target: string, at: number }|null}
 */
export function readBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.markdown !== 'string') return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Keeps the original document, so that the translation can be taken back.
 *
 * A backup that is already there is the original of the document, and it
 * is not overwritten: translating a piece of a document that has already
 * been translated must not throw the first original away.
 *
 * @param {string} markdown
 * @param {string} target
 * @returns {boolean} whether the original was kept
 */
export function saveBackup(markdown, target) {
  if (readBackup()) return false;

  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ markdown, target, at: Date.now() }));
    return true;
  } catch (err) {
    // The caller uses the answer to decide whether the translation may start
    // without a way back. A write that failed is not a backup.
    console.warn('The original could not be kept:', err);
    return false;
  }
}

/**
 * Forgets the original document.
 */
export function clearBackup() {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* the storage may be unavailable */
  }
  backupClearPromise = deleteStored(STORE.BACKUP, 'original').catch(() => {});
}

/**
 * Keeps the original in IndexedDB when it can, with the local copy as a
 * small-document fallback.
 *
 * @param {string} markdown
 * @param {string} target
 * @returns {Promise<boolean>}
 */
export async function saveBackupAsync(markdown, target) {
  await backupClearPromise;
  const existing = await readBackupAsync();
  if (existing) return false;

  const payload = { markdown, target, at: Date.now() };
  const stored = await writeStored(STORE.BACKUP, 'original', payload);

  if (stored) {
    if (markdown.length <= 2_000_000) {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(payload));
      } catch {
        /* the large copy is already safe */
      }
    }
    return true;
  }

  return saveBackup(markdown, target);
}

/**
 * Reads the original from IndexedDB, falling back to the local copy.
 * @returns {Promise<{ markdown: string, target: string, at: number }|null>}
 */
export async function readBackupAsync() {
  await backupClearPromise;

  const stored = await readStored(STORE.BACKUP, 'original');
  const local = readBackup();
  const storedAt = Number(stored?.at) || 0;
  const localAt = Number(local?.at) || 0;

  if (stored && typeof stored.markdown === 'string') {
    if (local && localAt > storedAt) return local;
    return stored;
  }

  return local;
}

/**
 * Forgets the original in both stores.
 * @returns {Promise<void>}
 */
export async function clearBackupAsync() {
  clearBackup();
  await backupClearPromise;
}

/* ==========================================================================
 * Asking the translator
 * ==========================================================================
 */

/**
 * Sends the units to the translator and waits for the answers.
 *
 * The server of the app is asked first. It is the better way in, because
 * it can try again when the translator refuses and because the address of
 * the translator stays out of the app.
 *
 * But the server of a site on Cloudflare shares its address with every
 * other site on it — and the translator counts what it does per address.
 * So when the server says that the translator is busy, the browser asks
 * the translator itself: every visitor has an address of their own, and
 * the answer is the same.
 *
 * @param {string[]} units
 * @param {string} target
 * @returns {Promise<{ results: string[], detected: string }>}
 */
async function requestTranslation(units, target, { signal } = {}) {
  try {
    return await requestThroughServer(units, target, { signal });
  } catch (err) {
    if (signal?.aborted) {
      const aborted = new Error('The work was stopped.');
      aborted.name = 'AbortError';
      throw aborted;
    }
    // Only a refusal is worth trying another way. Every other failure
    // would fail the same way again.
    if (!(err instanceof TranslationError) || err.busy !== true) throw err;

    try {
      return await translateUnits(units, target, { signal });
    } catch (directError) {
      if (signal?.aborted || directError?.name === 'AbortError') {
        const aborted = new Error('The work was stopped.');
        aborted.name = 'AbortError';
        throw aborted;
      }
      if (directError instanceof TranslateError) {
        // A refusal of the translator stays a refusal — the user has to
        // know that the translator is busy, not that the network is down.
        const failure = new TranslationError(directError.message);
        failure.busy = directError.status === 429;
        throw failure;
      }

      // The other way in failed for a reason of its own — that reason is
      // the one worth telling the user about, not the refusal of the
      // server that came before it.
      const failure = new TranslationError(
        directError?.message || 'The translator could not be reached.'
      );
      failure.busy = false;
      failure.cause = directError;
      throw failure;
    }
  }
}

/**
 * Asks the server of the app for the translation.
 *
 * @param {string[]} units
 * @param {string} target
 * @returns {Promise<{ results: string[], detected: string }>}
 */
async function requestThroughServer(units, target, { signal } = {}) {
  let response;
  try {
    response = await fetch(TRANSLATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, units }),
      signal
    });
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') {
      const aborted = new Error('The work was stopped.');
      aborted.name = 'AbortError';
      throw aborted;
    }
    throw new TranslationError('The translator could not be reached.');
  }

  // The status is known before the body is read: a refusal of the
  // translator reaches the browser as a 429, and the body of it is often
  // a page of HTML rather than an answer that can be read.
  const busy = response.status === 429;

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new TranslationError('The translator sent an answer that could not be read.');
    error.busy = busy;
    throw error;
  }

  if (!payload || payload.ok !== true) {
    const error = new TranslationError(payload?.error || 'The document could not be translated.');
    error.busy = busy;
    throw error;
  }

  return {
    results: Array.isArray(payload.results) ? payload.results : [],
    detected: typeof payload.detected === 'string' ? payload.detected : ''
  };
}

/* ==========================================================================
 * The translation itself
 * ==========================================================================
 */

/**
 * Whether the user asked for the translation to stop.
 *
 * The work is not thrown away: what has been translated so far stays in
 * the document, and the original is still there to go back to.
 */
let stopRequested = false;

/* ==========================================================================
 * The dialog
 * ==========================================================================
 */

/**
 * Fills the list of languages.
 */
function fillLanguages() {
  const select = el.translateTarget;
  if (!select) return;

  select.innerHTML = '';
  for (const language of TARGET_LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = `${language.name} — ${language.english}`;
    select.appendChild(option);
  }

  const wanted = getSettings().translateTarget || DEFAULT_TARGET;
  select.value = TARGET_LANGUAGES.some((language) => language.code === wanted)
    ? wanted
    : DEFAULT_TARGET;
}

/**
 * The part of the document that is to be translated.
 *
 * @returns {{ text: string, start: number, end: number, whole: boolean }}
 */
function selectedPart() {
  const editor = el.editor;
  const start = editor.selectionStart ?? 0;
  const end = editor.selectionEnd ?? 0;

  if (end > start) {
    return { text: editor.value.slice(start, end), start, end, whole: false };
  }

  return { text: editor.value, start: 0, end: editor.value.length, whole: true };
}

/**
 * Shows the button that puts the original back — but only while there is
 * an original to put back.
 */
function syncRestoreButton() {
  if (!el.btnTranslateRestore) return;

  // The local copy answers immediately; the IndexedDB copy catches up for a
  // book whose original was too large for localStorage.
  el.btnTranslateRestore.hidden = !readBackup();
  readBackupAsync().then((backup) => {
    el.btnTranslateRestore.hidden = !backup;
  });
}

/**
 * Opens the translation dialog.
 */
export function openDialog() {
  if (!el.modalTranslate) return;

  fillLanguages();
  el.translateError?.replaceChildren();
  syncRestoreButton();

  const part = selectedPart();
  if (el.translateScope) {
    if (part.whole && part.text.length >= LARGE_DOC_CHARS) {
      el.translateScope.textContent =
        'The visible section will be translated as you scroll. The rest of the document stays as it is.';
    } else {
      el.translateScope.textContent = part.whole
        ? 'The whole document will be translated.'
        : `Only the selected text will be translated (${part.text.length} characters).`;
    }
  }

  el.modalTranslate.removeAttribute('hidden');
  el.translateTarget?.focus();
}

/**
 * Closes the translation dialog.
 */
export function closeDialog() {
  el.modalTranslate?.setAttribute('hidden', '');
}

/**
 * Shows a message inside the dialog.
 * @param {string} message
 */
function showError(message) {
  if (!el.translateError) return;
  el.translateError.textContent = message;
}

/**
 * Switches the dialog between the idle and the working state.
 * @param {boolean} busy
 * @param {string} [label]
 */
function setBusy(busy, label = 'Translate') {
  if (el.btnTranslateRun) {
    el.btnTranslateRun.disabled = busy;
    el.btnTranslateRun.textContent = busy ? 'Translating…' : label;
  }
  if (el.translateTarget) el.translateTarget.disabled = busy;
}

/**
 * Shows how far the translation has come.
 *
 * The bar is what tells the user that the work is going on — without it,
 * a long document looks like a hang.
 *
 * @param {number} done how many parts are translated
 * @param {number} total how many parts there are
 */
function showProgress(done, total) {
  if (!el.translateProgress) return;

  el.translateProgress.removeAttribute('hidden');

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  if (el.translateProgressBar) {
    el.translateProgressBar.style.width = `${percent}%`;
  }
  if (el.translateProgressLabel) {
    el.translateProgressLabel.textContent = `Translating — ${done} of ${total} parts`;
  }
}

/**
 * Hides the bar.
 */
function hideProgress() {
  el.translateProgress?.setAttribute('hidden', '');
}

/* ==========================================================================
 * Lazy translation
 * ==========================================================================
 * A long document is translated a screen at a time. The source is updated
 * with a range patch, so the reader sees the translated paragraphs where
 * they are, and the rest of the book is not sent anywhere until it is
 * reached.
 * ========================================================================== */

/**
 * The offsets at which each line starts.
 *
 * @param {string} text
 * @returns {number[]}
 */
function lineOffsets(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

/**
 * The source slice for an inclusive line range.
 *
 * @param {string} text
 * @param {number[]} starts
 * @param {number} startLine 1-based
 * @param {number} endLine 1-based, inclusive
 * @returns {{ start: number, end: number, text: string }}
 */
function sliceLines(text, starts, startLine, endLine) {
  const start = Math.max(0, (starts[startLine - 1] ?? 0));
  const end = endLine < starts.length ? starts[endLine] : text.length;
  return { start, end, text: text.slice(start, end) };
}

/**
 * Merges a line range into the list of translated ranges.
 *
 * @param {Array<{ startLine: number, endLine: number }>} ranges
 * @param {number} startLine
 * @param {number} endLine
 * @returns {Array<{ startLine: number, endLine: number }>}
 */
function mergeRange(ranges, startLine, endLine) {
  const next = [...ranges, { startLine, endLine }].sort((a, b) => a.startLine - b.startLine);
  const merged = [];

  for (const range of next) {
    const last = merged[merged.length - 1];
    if (last && range.startLine <= last.endLine + 1) {
      last.endLine = Math.max(last.endLine, range.endLine);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

/**
 * The parts of a range that have not been translated yet.
 *
 * @param {number} startLine
 * @param {number} endLine
 * @param {Array<{ startLine: number, endLine: number }>} ranges
 * @returns {Array<{ startLine: number, endLine: number }>}
 */
function untranslatedRanges(startLine, endLine, ranges) {
  const pieces = [];
  let cursor = startLine;
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine);

  for (const range of sorted) {
    if (range.endLine < cursor) continue;
    if (range.startLine > endLine) break;

    if (range.startLine > cursor) {
      pieces.push({ startLine: cursor, endLine: Math.min(endLine, range.startLine - 1) });
    }

    cursor = Math.max(cursor, range.endLine + 1);
    if (cursor > endLine) break;
  }

  if (cursor <= endLine) pieces.push({ startLine: cursor, endLine });
  return pieces.filter((part) => part.endLine >= part.startLine);
}

/**
 * Walks the text with the translated lines removed, for the comparison that
 * survives a translated document.
 *
 * @param {string} text
 * @param {Array<{ startLine: number, endLine: number }>} ranges
 * @returns {string}
 */
function textOutsideRanges(text, ranges) {
  const lines = text.split('\n');

  for (const range of ranges || []) {
    const from = Math.max(0, range.startLine - 1);
    const to = Math.min(lines.length, range.endLine);
    for (let index = from; index < to; index += 1) lines[index] = '';
  }

  return lines.join('\n');
}

/**
 * Tells whether a stored session belongs to the document in the editor.
 *
 * The translated ranges no longer hold the original text, so the whole-file
 * fingerprint cannot match after the first window. The lines *outside* those
 * ranges can still be compared with the original backup.
 *
 * @param {object} payload
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function sessionMatchesDocument(payload, text) {
  if (!payload) return false;
  if (text.split('\n').length !== payload.totalLines) return false;
  if (payload.fingerprint === fingerprint(text)) return true;
  if (!Array.isArray(payload.translatedRanges) || payload.translatedRanges.length === 0) {
    return false;
  }

  const backup = await readBackupAsync();
  if (!backup?.markdown) return false;
  if (backup.markdown.split('\n').length !== payload.totalLines) return false;

  return (
    fingerprint(textOutsideRanges(text, payload.translatedRanges)) ===
    fingerprint(textOutsideRanges(backup.markdown, payload.translatedRanges))
  );
}

/**
 * The source range the reader can see, plus a short look-ahead.
 *
 * @param {object} session
 * @returns {{ startLine: number, endLine: number }|null}
 */
function visibleTranslationRange(session) {
  const text = el.editor.value;
  const totalLines = session.totalLines || text.split('\n').length;

  const visible = getVisibleSourceRange();
  const startLine = Math.max(
    1,
    visible.topBlock?.line ?? visible.startLine ?? 1
  );
  const visibleEnd = Math.max(
    visible.endLine || 1,
    visible.bottomBlock?.endLine || visible.endLine || startLine
  );
  const endLine = Math.min(
    totalLines,
    Math.max(startLine, visibleEnd + TRANSLATE_LOOKAHEAD_LINES)
  );

  return { startLine, endLine };
}

/**
 * Validates one translated unit before it is put back into the document.
 *
 * @param {string} text
 * @param {object} unit
 * @param {Map<number, object>} registry
 * @returns {{ text: string, intact: boolean }}
 */
function cleanTranslatedUnit(text, unit, registry) {
  const singleLine = String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!singleLine) return { text: unit.original, intact: false };

  if (singleLine.includes('|') && !unit.original.includes('|')) {
    return { text: unit.original, intact: false };
  }

  if (!tokensIntact(singleLine, unit.expected)) {
    return { text: unit.original, intact: false };
  }

  const restored = unmaskText(singleLine, registry);
  if (!restored.trim() || /[\r\n]/.test(restored)) {
    return { text: unit.original, intact: false };
  }

  return { text: restored, intact: true };
}

/**
 * Translates one line range and applies it as a source patch.
 *
 * @param {object} session
 * @param {{ start: number, end: number, text: string }} slice
 * @param {number} startLine
 * @param {number} endLine
 * @returns {Promise<{ done: number, total: number, endLine: number }|null>}
 */
async function translateLazySlice(session, slice, startLine, endLine) {
  if (!slice.text.trim()) {
    session.translatedRanges = mergeRange(session.translatedRanges, startLine, endLine);
    await saveLazySession(session);
    return { done: 0, total: 0, endLine };
  }

  let plan = buildPlan(slice.text);
  let currentEnd = endLine;
  let attempts = 0;
  // The document is unchanged until the patch is applied, so one set of line
  // offsets is enough for every attempt to fit the request budget.
  const starts = lineOffsets(el.editor.value);

  while (plan.units.length > TRANSLATE_MAX_UNITS && currentEnd > startLine + 1 && attempts < 6) {
    currentEnd = Math.max(
      startLine,
      startLine + Math.floor((currentEnd - startLine) * 0.7)
    );
    const next = sliceLines(el.editor.value, starts, startLine, currentEnd);
    slice = next;
    plan = buildPlan(slice.text);
    attempts += 1;
  }

  if (plan.units.length === 0) {
    session.translatedRanges = mergeRange(session.translatedRanges, startLine, currentEnd);
    await saveLazySession(session);
    return { done: 0, total: 0, endLine: currentEnd };
  }

  const requests = planRequests(plan.units.map((unit) => unit.text));
  const answers = new Array(plan.units.length).fill(null);
  const pieces = new Array(plan.units.length).fill(null).map(() => []);
  const expectedPieces = new Array(plan.units.length).fill(0);
  requests.forEach((request) =>
    request.pieces.forEach((piece) => {
      expectedPieces[piece.unit] += 1;
    })
  );

  let done = 0;

  for (const request of requests) {
    throwIfAborted(session.controller.signal);
    const answer = await requestTranslation(request.texts, session.target, {
      signal: session.controller.signal
    });
    throwIfAborted(session.controller.signal);

    request.pieces.forEach((piece, index) => {
      const text = answer.results[index];
      if (typeof text === 'string') pieces[piece.unit].push(text);
    });

    for (let unitIndex = 0; unitIndex < plan.units.length; unitIndex += 1) {
      if (answers[unitIndex] !== null) continue;
      if (pieces[unitIndex].length < expectedPieces[unitIndex]) continue;

      const unit = plan.units[unitIndex];
      const joined = pieces[unitIndex].join(' ');
      answers[unitIndex] = cleanTranslatedUnit(joined, unit, plan.registry);
      done += 1;
    }

    showProgress(done, plan.units.length);
    await yieldToMainThread();
  }

  throwIfAborted(session.controller.signal);

  let translated = rebuildDocument(plan, answers);
  const originalLines = slice.text.split(/\r?\n/).length;
  const translatedLines = translated.split(/\r?\n/).length;

  // Translation must never change the shape of the document; a newline in a
  // unit would move every following anchor.
  if (translatedLines !== originalLines) {
    translated = slice.text;
  }

  const applied = applyDocumentPatch(
    {
      start: slice.start,
      end: slice.end,
      text: translated,
      expected: slice.text
    },
    'translated'
  );

  if (!applied) {
    // The document moved under the translation. Keeping the session paused
    // would leave no way to continue from the screen; stop it and say so.
    session.status = 'stopped';
    await saveLazySession(session);
    throw new TranslationError(
      'The document changed while it was being translated. Start the translation again to continue.'
    );
  }

  session.translatedRanges = mergeRange(session.translatedRanges, startLine, currentEnd);
  patchPreviewLines(startLine, currentEnd);
  await saveLazySession(session);
  return { done, total: plan.units.length, endLine: currentEnd };
}

/**
 * Translates the part of the document the reader is looking at.
 *
 * @returns {Promise<boolean>}
 */
export async function processLazyVisible() {
  lazyFailure = null;

  const session = lazySession;
  if (!session || session.status !== 'active') return false;
  if (isSpeaking() || isSpeechPaused()) return false;
  if (wasRecentlyAutoScrolling()) return false;
  if (isPreviewRendering()) return false;
  if (lazyBusy) {
    lazyPending = true;
    return false;
  }

  const range = visibleTranslationRange(session);
  if (!range) {
    setMessage('Translation paused — the document changed', { tone: 'warn', ttl: 4000 });
    return false;
  }

  const parts = untranslatedRanges(
    range.startLine,
    range.endLine,
    session.translatedRanges
  );
  if (parts.length === 0) return true;

  lazyBusy = true;
  setMessage('Translating the visible section…', { tone: 'muted' });
  showProgress(0, 1);

  try {
    for (const part of parts) {
      // A part can be shortened to fit the request budget. The rest of that
      // part is translated in the next turn instead of being left behind
      // until the reader happens to scroll back.
      let cursor = part.startLine;

      while (cursor <= part.endLine) {
        throwIfAborted(session.controller.signal);

        const starts = lineOffsets(el.editor.value);
        const slice = sliceLines(el.editor.value, starts, cursor, part.endLine);
        const result = await translateLazySlice(session, slice, cursor, part.endLine);

        if (!result || result.endLine < cursor) break;

        showProgress(result.done, Math.max(1, result.total));
        cursor = Math.max(cursor + 1, result.endLine + 1);
        await yieldToMainThread();
      }
    }

    setMessage('Translated the visible section — scroll to continue', {
      tone: 'accent',
      ttl: 3500
    });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') {
      return false;
    }

    const message =
      err instanceof TranslationError
        ? err.message
        : `The visible section could not be translated (${err?.message || 'unknown error'}).`;
    lazyFailure = message;
    setMessage(message, { tone: 'warn', ttl: 5000 });
    return false;
  } finally {
    lazyBusy = false;
    hideProgress();

    // A new session may have been started while this one was unwinding. The
    // pending flag belongs to the module, not to the session, so it has to be
    // honoured for whichever session is current now. A failed pass is not
    // retried here; the user has been told what happened.
    if (!lazyFailure && lazyPending && lazySession?.status === 'active') {
      lazyPending = false;
      processLazyVisible();
    }
  }
}

/**
 * Starts the lazy translation session for a large document.
 *
 * @param {string} target
 * @returns {Promise<boolean>}
 */
async function runLazyTranslation(target) {
  if (lazySession?.controller) {
    lazySession.controller.abort();
  }

  setBusy(true);
  closeDialog();
  showProgress(0, 1);
  setMessage('Preparing the original…', { tone: 'muted' });

  // The backup is written asynchronously. The editor stays editable while
  // that happens, so the text the translation starts from has to be checked
  // against the text the original was taken from.
  const sourceText = el.editor.value;
  const saved = await saveBackupAsync(sourceText, target);

  if (!saved && !(await readBackupAsync())) {
    setBusy(false);
    hideProgress();
    showError('The original could not be kept, so the translation was not started.');
    setMessage('The original could not be kept', { tone: 'warn', ttl: 5000 });
    return false;
  }

  if (el.editor.value !== sourceText) {
    if (saved) await clearBackupAsync();
    setBusy(false);
    hideProgress();
    showError('The document changed while the original was being kept. Start the translation again.');
    setMessage('The document changed — translation not started', { tone: 'warn', ttl: 5000 });
    return false;
  }

  syncRestoreButton();

  const documentFingerprint = fingerprint(sourceText);
  let previous = await readStored(STORE.TRANSLATION, 'session');
  if (!previous) {
    try {
      previous = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      previous = null;
    }
  }

  const translatedRanges =
    previous &&
    previous.target === target &&
    (await sessionMatchesDocument(previous, sourceText))
      ? previous.translatedRanges || []
      : [];

  // Reading the previous session is asynchronous too. The text must still be
  // the one the backup belongs to when the session starts.
  if (el.editor.value !== sourceText) {
    if (saved) await clearBackupAsync();
    syncRestoreButton();
    setBusy(false);
    hideProgress();
    showError('The document changed while the translation was being prepared. Start it again.');
    setMessage('The document changed — translation not started', { tone: 'warn', ttl: 5000 });
    return false;
  }

  const session = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    target,
    fingerprint: documentFingerprint,
    totalLines: sourceText.split('\n').length,
    translatedRanges,
    status: 'active',
    at: Date.now(),
    controller: new AbortController()
  };

  lazySession = session;
  await saveLazySession(session);
  showProgress(0, 1);
  setMessage('Translating the visible section…', { tone: 'muted' });

  try {
    const worked = await processLazyVisible();
    saveSettings({ translateTarget: target });

    // The error message of the failed first window is already on screen; do
    // not replace it with a cheerful "started" one.
    if (lazyFailure) return false;

    // A replacement or a stop cancelled the session while its first window
    // was being translated; there is nothing to announce.
    if (lazySession !== session || session.status !== 'active') return false;

    setMessage(
      worked
        ? 'Translation started — it follows you as you scroll'
        : 'Translation started — it will continue when the preview is ready',
      { tone: 'accent', ttl: 4000 }
    );
    return true;
  } finally {
    setBusy(false);
    hideProgress();
  }
}

/**
 * Stores the lazy session in IndexedDB and in the small local mirror.
 * @param {object} session
 * @returns {Promise<void>}
 */
async function saveLazySession(session) {
  await lazyClearPromise;

  // A session that was replaced or cleared while this write was waiting must
  // not put itself back into the storage.
  if (lazySession !== session) return;

  const payload = {
    id: session.id,
    target: session.target,
    fingerprint: session.fingerprint,
    totalLines: session.totalLines,
    translatedRanges: session.translatedRanges,
    status: session.status,
    at: session.at
  };

  await writeStored(STORE.TRANSLATION, 'session', payload);
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* the large copy is already safe */
  }
}

/**
 * Forgets the lazy session.
 */
function clearLazySession() {
  if (lazySession?.controller) lazySession.controller.abort();
  lazySession = null;
  lazyPending = false;
  lazyBusy = false;
  lazyFailure = null;
  lazyClearPromise = deleteStored(STORE.TRANSLATION, 'session').catch(() => {});
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Stops the lazy session where it is. The text that was translated stays.
 */
export function stopLazyTranslation() {
  if (!lazySession) return;
  lazySession.status = 'stopped';
  lazySession.controller.abort();
  saveLazySession(lazySession);
  setMessage('Translation stopped — the translated text stays', {
    tone: 'warn',
    ttl: 4000
  });
}

/**
 * Reads a previous lazy session and resumes it when the document is the same.
 *
 * @returns {Promise<boolean>}
 */
export async function restoreLazySession() {
  let payload = await readStored(STORE.TRANSLATION, 'session');
  if (!payload) {
    try {
      payload = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      payload = null;
    }
  }

  if (!payload || !payload.target || payload.status === 'stopped') return false;
  if (!(await sessionMatchesDocument(payload, el.editor.value))) {
    clearLazySession();
    return false;
  }

  lazySession = {
    ...payload,
    status: 'active',
    controller: new AbortController()
  };

  setMessage('Translation resumed — scroll to continue', { tone: 'accent', ttl: 4000 });
  setTimeout(() => processLazyVisible(), 500);
  return true;
}

/**
 * Debounces the scroll-driven translation.
 */
function scheduleLazyVisible() {
  if (!lazySession || lazySession.status !== 'active') return;
  if (lazyBusy) {
    lazyPending = true;
    return;
  }
  if (isSpeaking() || isSpeechPaused()) return;
  if (wasRecentlyAutoScrolling()) return;
  if (isPreviewRendering()) return;

  if (lazyTimer) clearTimeout(lazyTimer);
  lazyTimer = setTimeout(() => {
    lazyTimer = null;
    processLazyVisible();
  }, 350);
}

/**
 * Puts the original document back.
 */
async function restoreOriginal() {
  const backup = await readBackupAsync();
  if (!backup) {
    setMessage('There is no original to go back to', { tone: 'muted', ttl: 2500 });
    return;
  }

  const confirmed = await confirmDialog({
    title: 'Go back to the original?',
    message: 'The translated text is replaced by the document it came from.',
    confirmLabel: 'Restore',
    danger: true
  });
  if (!confirmed) return;

  setMarkdown(backup.markdown, 'replaced');
  await clearBackupAsync();
  closeDialog();
  setMessage('The original document is back', { tone: 'accent', ttl: 2500 });
}

/**
 * Translates the document and puts the answer in its place.
 *
 * The document is translated piece by piece, and every piece that comes
 * back is put into the document right away. The user sees the translation
 * grow instead of waiting for the whole document — and the bar says how
 * far it has come, so that the work cannot be mistaken for a hang.
 *
 * A refusal of the translator is thrown on, so that the caller can try
 * again — every other failure is shown to the user right away.
 *
 * @returns {Promise<boolean>} whether the document was translated
 * @throws {TranslationError} when the translator refused
 */
export async function runTranslation() {
  const target = el.translateTarget?.value || getSettings().translateTarget || DEFAULT_TARGET;

  const part = selectedPart();
  if (!part.text.trim()) {
    showError('There is nothing to translate.');
    return false;
  }

  // A long document is translated as the reader moves through it. A short
  // document still finishes in one pass, because the difference is invisible
  // to the reader and avoids needless session state.
  if (part.whole && el.editor.value.length >= LARGE_DOC_CHARS) {
    return runLazyTranslation(target);
  }

  const plan = buildPlan(part.text);
  if (plan.units.length === 0) {
    setMessage('There is nothing to translate in this text', { tone: 'warn', ttl: 4000 });
    showError('This text holds no words — only code and formulas.');
    return false;
  }

  setBusy(true);
  closeDialog();
  showProgress(0, plan.units.length);
  setMessage('Translating…', { tone: 'muted' });

  // The original is kept before anything is written into the document — a
  // translation that cannot be taken back is a translation nobody wants.
  const kept = saveBackup(el.editor.value, target);
  if (!kept && !readBackup()) {
    setBusy(false);
    hideProgress();
    showError('The original could not be kept, so the translation was not started.');
    setMessage('The original could not be kept', { tone: 'warn', ttl: 5000 });
    return false;
  }
  syncRestoreButton();

  // The text around the part that is translated stays as it is.
  const before = part.whole ? '' : el.editor.value.slice(0, part.start);
  const after = part.whole ? '' : el.editor.value.slice(part.end);

  // The answers of the units, piece by piece. A unit that was cut in two
  // is put together once both of its pieces are in.
  const answers = new Array(plan.units.length).fill(null);
  const pieces = new Array(plan.units.length).fill(null).map(() => []);

  const requests = planRequests(plan.units.map((unit) => unit.text));
  let done = 0;
  let detected = '';
  let damaged = 0;
  stopRequested = false;

  try {
    for (const request of requests) {
      if (stopRequested) break;

      const answer = await requestTranslation(request.texts, target);
      if (!detected) detected = answer.detected;

      // Every piece is put where it belongs.
      request.pieces.forEach((piece, index) => {
        const text = answer.results[index];
        if (typeof text === 'string') pieces[piece.unit].push(text);
      });

      // A unit is whole once all of its pieces are in.
      for (let unit = 0; unit < plan.units.length; unit += 1) {
        if (answers[unit] !== null) continue;

        const unitPieces = pieces[unit];
        const expectedPieces = requests
          .flatMap((entry) => entry.pieces)
          .filter((piece) => piece.unit === unit).length;

        if (unitPieces.length < expectedPieces) continue;

        const joined = unitPieces.join(' ');
        const original = plan.units[unit];

        // The structure of the unit has to be intact: every token has to
        // be there, and it has to be there once. If it is not, the
        // original text is used — a document that is half-translated is
        // better than a document whose code no longer compiles.
        if (!tokensIntact(joined, original.expected)) {
          damaged += 1;
          answers[unit] = { text: original.original, intact: false };
        } else {
          answers[unit] = { text: unmaskText(joined, plan.registry), intact: true };
        }

        done += 1;
      }

      // The document is written with what has been translated so far.
      // The line endings are kept: a document that came from Windows
      // keeps them, and one that came from anywhere else does not get
      // them.
      const partial = normalizeEol(rebuildDocument(plan, answers), plan.eol);
      setMarkdown(before + partial + after, 'edited');
      showProgress(done, plan.units.length);
    }

    if (stopRequested) {
      setMessage(`Stopped — ${done} of ${plan.units.length} parts were translated`, {
        tone: 'warn',
        ttl: 5000
      });
      return false;
    }

    if (done === 0) {
      setMessage('Nothing was translated', { tone: 'warn', ttl: 4000 });
      showError('The translator did not change anything.');
      return false;
    }

    saveSettings({ translateTarget: target });

    const from = detected ? ` from ${languageEnglishName(detected)}` : '';
    const broken = damaged > 0 ? ` — ${damaged} part(s) kept as they were` : '';
    setMessage(`Translated${from} into ${languageName(target)}${broken}`, {
      tone: damaged > 0 ? 'warn' : 'accent',
      // The message stays a while: a translation of a long document takes
      // a while, and the user reads the message when it is done.
      ttl: 8000
    });

    return true;
  } catch (err) {
    // The translator refuses when it is asked too much at once, and it
    // says so with a status of its own. The refusal is not the end of the
    // story — the same document can be translated a moment later.
    const busy = err instanceof TranslationError && err.busy;

    const message = busy
      ? 'The translator is busy right now. Try again in a moment.'
      : err instanceof TranslationError
        ? err.message
        : `The document could not be translated (${err?.message || 'unknown error'}).`;

    showError(message);
    setMessage(message, { tone: 'warn', ttl: busy ? 6000 : 5000 });

    if (busy) throw err;
    return false;
  } finally {
    setBusy(false);
    hideProgress();
  }
}

/**
 * Translates the document, and tries again when the translator refuses.
 *
 * A refusal is not a failure of the document — it is the translator saying
 * that it is busy. So the request is made again after a pause, a few
 * times, and only then the user is told.
 *
 * @param {number} [attempts] how many times the request may be made
 * @returns {Promise<boolean>} whether the translation worked
 */
export async function runTranslationWithRetry(attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runTranslation();
    } catch (err) {
      const busy = err instanceof TranslationError && err.busy;
      if (!busy || attempt === attempts) {
        // The translator refused again and again. The user has been told
        // already; there is nothing left to say.
        return false;
      }

      // A pause that grows with every attempt: the translator needs the
      // time, and the user sees that something is happening.
      const wait = 2000 * attempt;
      setMessage(`The translator is busy — trying again in ${Math.round(wait / 1000)}s…`, {
        tone: 'muted',
        ttl: wait
      });
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  return false;
}

/**
 * Initializes the translation dialog and its button.
 */
export function initTranslate() {
  el.btnTranslate?.addEventListener('click', openDialog);
  el.btnCloseTranslate?.addEventListener('click', closeDialog);
  el.btnTranslateCancel?.addEventListener('click', closeDialog);
  el.btnTranslateRestore?.addEventListener('click', restoreOriginal);

  // The translation can be stopped: what has been translated so far stays
  // in the document, and the rest is left as it was.
  el.btnTranslateStop?.addEventListener('click', () => {
    stopRequested = true;
    stopLazyTranslation();
    if (el.translateProgressLabel) {
      el.translateProgressLabel.textContent = 'Stopping…';
    }
  });

  el.modalTranslate?.addEventListener('click', (event) => {
    if (event.target === el.modalTranslate) closeDialog();
  });

  el.translateForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    runTranslationWithRetry();
  });

  el.translateTarget?.addEventListener('change', () => {
    saveSettings({ translateTarget: el.translateTarget.value });
  });

  // The lazy session follows the reader, never the narrator's own scrolling.
  el.previewWrapper?.addEventListener('scroll', scheduleLazyVisible, { passive: true });
  el.preview?.addEventListener('preview:user-navigation', scheduleLazyVisible);
  el.preview?.addEventListener('preview:rendered', scheduleLazyVisible);

  // The first window can be blocked while the narrator is speaking. Once the
  // reading ends there is no scroll event to wake the session up again.
  onTTSStateChange(({ isPlaying }) => {
    if (!isPlaying && !isNarrationStarting()) scheduleLazyVisible();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && el.modalTranslate && !el.modalTranslate.hasAttribute('hidden')) {
      closeDialog();
    }
  });

  // A new document is not the document the original belonged to. Keeping
  // an old backup would make "Restore original" bring back another article.
  onContentChange(({ reason }) => {
    if (reason === 'replaced') {
      clearLazySession();
      clearBackup();
      return;
    }

    if (reason === 'edited' && lazySession?.status === 'active') {
      lazySession.status = 'stopped';
      lazySession.controller.abort();
      saveLazySession(lazySession);
      setMessage('Translation stopped — the document was edited. Start it again to continue.', {
        tone: 'muted',
        ttl: 3500
      });
    }
  });

  restoreLazySession();
  syncRestoreButton();
}
