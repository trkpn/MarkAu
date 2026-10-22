/**
 * ============================================================================
 * CLIPBOARD PASTE
 * ============================================================================
 * Puts the clipboard into the document without making the user leave the view
 * they are reading in.
 *
 * The rule follows what the user can actually see:
 *   • the editor is visible → the text lands at the caret, exactly like a
 *     manual paste (a selection is replaced)
 *   • the editor is hidden  → the document is replaced, because there is no
 *     caret to aim at
 *
 * That is what makes the button useful in Preview mode: a new document can be
 * dropped into the app and read straight away, without switching to the
 * editor, pasting and switching back.
 * ============================================================================
 */

import { el } from './dom.js';
import { insertText } from './editor.js';
import { getSettings, onSettingsChange } from '../settings-manager.js';
import { setMessage } from './status.js';

/**
 * True while the editor pane is hidden and the preview is the only thing on
 * screen.
 * @returns {boolean}
 */
export function isEditorHidden() {
  return getSettings().view === 'preview';
}

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

  const replaceDocument = isEditorHidden();
  insertText(text, { replaceDocument });

  const chars = text.length.toLocaleString();
  setMessage(
    replaceDocument
      ? `📋 Document replaced from the clipboard (${chars} characters)`
      : `📋 Pasted ${chars} characters at the cursor`,
    { tone: 'accent', ttl: 2500 }
  );
}

/**
 * Keeps the tooltip in step with the current view, so the button always says
 * what it is about to do.
 */
function updatePasteButton() {
  if (!el.btnPaste) return;

  const label = isEditorHidden()
    ? 'Paste the clipboard as the new document'
    : 'Paste the clipboard at the cursor';

  el.btnPaste.title = label;
  el.btnPaste.setAttribute('aria-label', label);
}

/**
 * Initializes the paste button.
 */
export function initPaste() {
  el.btnPaste?.addEventListener('click', () => {
    pasteFromClipboard();
  });

  onSettingsChange(updatePasteButton);
  updatePasteButton();
}
