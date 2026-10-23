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
 *   • no selection              → the whole document is translated, and it
 *     becomes the document
 *
 * The original is kept, so that the translation can be taken back.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { setMarkdown } from '@/app/editor/editor.js';
import { getSettings, saveSettings } from '@/core/settings.js';
import { setMessage } from '@/app/shell/status.js';
import { confirmDialog } from '@/app/shell/dialog.js';
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
  } catch {
    /* the storage may be full — the translation still happened */
  }

  return true;
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
async function requestTranslation(units, target) {
  try {
    return await requestThroughServer(units, target);
  } catch (err) {
    // Only a refusal is worth trying another way. Every other failure
    // would fail the same way again.
    if (!(err instanceof TranslationError) || err.busy !== true) throw err;

    try {
      return await translateUnits(units, target);
    } catch (directError) {
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
async function requestThroughServer(units, target) {
  let response;
  try {
    response = await fetch(TRANSLATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, units })
    });
  } catch {
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
  el.btnTranslateRestore.hidden = !readBackup();
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
    el.translateScope.textContent = part.whole
      ? 'The whole document will be translated.'
      : `Only the selected text will be translated (${part.text.length} characters).`;
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

/**
 * Puts the original document back.
 */
async function restoreOriginal() {
  const backup = readBackup();
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
  clearBackup();
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
  saveBackup(el.editor.value, target);
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

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && el.modalTranslate && !el.modalTranslate.hasAttribute('hidden')) {
      closeDialog();
    }
  });

  syncRestoreButton();
}
