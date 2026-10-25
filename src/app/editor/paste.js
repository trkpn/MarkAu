/**
 * ============================================================================
 * CLIPBOARD PASTE
 * ============================================================================
 * Puts the clipboard into the document without making the user leave the view
 * they are reading in.
 *
 * The rule is the one the import follows: what is pasted is a document of its
 * own. It replaces the document that is there instead of being slipped into
 * it, so a new text is never mixed into the old one. A text that is already
 * the document changes nothing at all.
 *
 * That is what makes the button useful in every view: a new document can be
 * dropped into the app and read straight away, without switching to the
 * editor, pasting and switching back.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { setMarkdown } from '@/app/editor/editor.js';
import { setMessage } from '@/app/shell/status.js';

/**
 * Reads the plain text from the clipboard.
 *
 * The browser only grants this in a secure context and with the user's
 * permission, so every failure has to be handled — the fallback is the
 * native paste inside the editor.
 *
 * @returns {Promise<{ text: string|null, reason?: string }>} the text, or a
 *   reason why it could not be read
 */
async function readClipboardText() {
  if (!navigator.clipboard?.readText) {
    return { text: null, reason: 'unsupported' };
  }

  try {
    return { text: await navigator.clipboard.readText() };
  } catch (err) {
    console.warn('Clipboard read failed:', err);
    return { text: null, reason: 'denied' };
  }
}

/**
 * Puts a text into the document as its new content.
 *
 * What arrives from the clipboard — a paste, a drop, the button — is a
 * document of its own, so it replaces the document that is there. The same
 * text that is already the document replaces nothing and keeps nothing.
 *
 * @param {string} text
 * @param {string} [action] how the text arrived: "Pasted", "Dropped"
 * @returns {boolean} whether the document was replaced
 */
export function pasteAsDocument(text, action = 'Pasted') {
  if (!text) return false;

  if (text === el.editor?.value) {
    setMessage('The document already holds that text', { tone: 'muted', ttl: 2500 });
    return false;
  }

  setMarkdown(text, 'replaced');
  setMessage(`📋 ${action} as the new document (${text.length.toLocaleString()} characters)`, {
    tone: 'accent',
    ttl: 2500
  });
  return true;
}

/**
 * Pastes the clipboard into the document.
 * @returns {Promise<void>}
 */
export async function pasteFromClipboard() {
  const { text, reason } = await readClipboardText();

  if (text === null) {
    // iOS Safari does not hand the clipboard over to a plain button, so
    // the message alone would be a dead end. The fallback box is the way
    // to paste on a phone: the system paste command works in any field.
    openPasteFallback(reason);
    return;
  }

  if (!text.trim()) {
    setMessage('The clipboard is empty', { tone: 'muted', ttl: 2500 });
    return;
  }

  pasteAsDocument(text);
}

/* ==========================================================================
 * Manual paste fallback
 * ========================================================================== */

/** The open fallback dialog, created on first use. */
let fallbackOverlay = null;

/**
 * Opens the manual paste box: a textarea the system paste command works
 * in, and an Insert button that makes the text the new document.
 * @param {string} [reason] why the clipboard could not be read
 */
function openPasteFallback(reason) {
  const overlay = ensurePasteFallback();
  const textarea = overlay.querySelector('.paste-fallback-text');

  overlay.querySelector('.paste-fallback-hint').textContent =
    reason === 'denied'
      ? 'Clipboard access was denied. Tap the box, choose Paste from the menu that appears, then press Insert.'
      : 'This browser does not hand the clipboard to a button. Tap the box, choose Paste from the menu that appears, then press Insert.';

  textarea.value = '';
  overlay.removeAttribute('hidden');
  textarea.focus();
}

function closePasteFallback() {
  fallbackOverlay?.setAttribute('hidden', '');
}

/**
 * Builds the fallback dialog once and wires it up.
 * @returns {HTMLElement}
 */
function ensurePasteFallback() {
  if (fallbackOverlay) return fallbackOverlay;

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal-card paste-fallback-card" role="dialog" aria-modal="true" aria-labelledby="paste-fallback-title">
      <div class="modal-header">
        <div class="modal-title">
          <h3 id="paste-fallback-title">Paste the clipboard</h3>
        </div>
      </div>
      <div class="modal-body">
        <p class="paste-fallback-hint"></p>
        <textarea class="paste-fallback-text" rows="7" placeholder="Long-press here, then choose Paste"></textarea>
        <div class="paste-fallback-actions">
          <button class="btn" type="button" data-paste-cancel>Cancel</button>
          <button class="btn btn-primary" type="button" data-paste-insert>Insert as the document</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const textarea = overlay.querySelector('.paste-fallback-text');

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closePasteFallback();
  });
  overlay.querySelector('[data-paste-cancel]').addEventListener('click', closePasteFallback);
  overlay.querySelector('[data-paste-insert]').addEventListener('click', () => {
    const text = textarea.value;
    closePasteFallback();
    if (!pasteAsDocument(text)) {
      setMessage('Nothing was pasted', { tone: 'muted', ttl: 2500 });
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hasAttribute('hidden')) closePasteFallback();
  });

  fallbackOverlay = overlay;
  return overlay;
}

/**
 * Initializes the paste button.
 *
 * The button does one thing in every view now, so its label is written once
 * instead of being kept in step with the view.
 */
export function initPaste() {
  const label = 'Paste the clipboard as the new document';

  if (el.btnPaste) {
    el.btnPaste.title = label;
    el.btnPaste.setAttribute('aria-label', label);
  }

  el.btnPaste?.addEventListener('click', () => {
    pasteFromClipboard();
  });
}
