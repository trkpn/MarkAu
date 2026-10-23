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
    setMessage(
      reason === 'unsupported'
        ? 'This browser cannot read the clipboard — use Ctrl+V in the editor'
        : 'Clipboard access denied — use Ctrl+V in the editor',
      { tone: 'warn', ttl: 4000 }
    );
    return;
  }

  if (!text.trim()) {
    setMessage('The clipboard is empty', { tone: 'muted', ttl: 2500 });
    return;
  }

  pasteAsDocument(text);
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
