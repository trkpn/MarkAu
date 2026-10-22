/**
 * ============================================================================
 * KEYBOARD SHORTCUTS
 * ============================================================================
 * One place for every keyboard interaction, so the behaviour is consistent
 * and easy to extend.
 *
 * Rules:
 *   • Shortcuts never fire while the user is typing in a text field, unless
 *     the shortcut is explicitly a formatting command.
 *   • Escape always does the least destructive thing first: it closes the
 *     preferences dialog if that is open, and only then stops narration.
 * ============================================================================
 */

import { el } from './dom.js';
import { play, pause, stop, isSpeaking, isSpeechPaused } from '../tts-engine.js';
import { applyFormat, flushDraft } from './editor.js';
import { setView } from './layout.js';
import { pasteFromClipboard } from './paste.js';
import { flushRender } from './preview.js';
import { setMessage } from './status.js';

/**
 * @param {EventTarget|null} target
 * @returns {boolean} whether the event target is a text entry field
 */
function isTextEntry(target) {
  if (!target || target === el.editor) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
  );
}

/**
 * Starts narration from the current document.
 */
function startReading() {
  flushRender();
  play();
}

/**
 * @returns {boolean} whether a modal surface is currently open
 */
function isModalOpen() {
  if (el.modalSettings && !el.modalSettings.hasAttribute('hidden')) return true;
  return Boolean(document.querySelector('dialog[open]'));
}

/**
 * Handles a single key press.
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
  const mod = event.ctrlKey || event.metaKey;
  const inEditor = event.target === el.editor;
  const inField = isTextEntry(event.target);

  /* ---------------------------------------------------------------- ESC --
   * Escape closes the preferences dialog first; if no dialog is open it
   * stops the narration.
   */
  if (event.key === 'Escape') {
    if (el.modalSettings && !el.modalSettings.hasAttribute('hidden')) return; // handled by the modal
    if (isSpeaking()) {
      event.preventDefault();
      stop('user');
      setMessage('Reading stopped', { tone: 'muted', ttl: 1500 });
    }
    return;
  }

  /* ------------------------------------------------------- formatting --
   * These work inside the editor, where the browser's own bold/italic
   * shortcuts would otherwise do nothing.
   */
  if (inEditor && mod && !event.altKey) {
    const key = event.key.toLowerCase();

    if (key === 'b') {
      event.preventDefault();
      applyFormat('bold');
      return;
    }

    if (key === 'i') {
      event.preventDefault();
      applyFormat('italic');
      return;
    }

    if (key === 's') {
      event.preventDefault();
      flushDraft();
      setMessage('💾 Draft saved', { tone: 'accent', ttl: 1500 });
      return;
    }
  }

  /* ------------------------------------------------------------- paste --
   * The browser's own paste only reaches a text field, so outside the editor
   * the app offers its own: it drops the clipboard into the document
   * without a trip through the view switcher.
   */
  if (
    mod &&
    event.shiftKey &&
    !event.altKey &&
    !inEditor &&
    !inField &&
    !isModalOpen() &&
    event.key.toLowerCase() === 'v'
  ) {
    event.preventDefault();
    pasteFromClipboard();
    return;
  }

  /* -------------------------------------------------- playback & views --
   * These only apply outside the editor, so they never get in the way of
   * writing — and never while a dialog owns the keyboard.
   */
  if (inEditor || inField || mod || event.altKey || isModalOpen()) return;

  if (event.code === 'Space') {
    event.preventDefault();
    if (isSpeaking() && !isSpeechPaused()) {
      pause();
    } else {
      startReading();
    }
    return;
  }

  if (event.key === '1') {
    event.preventDefault();
    setView('edit');
    return;
  }

  if (event.key === '2') {
    event.preventDefault();
    setView('split');
    return;
  }

  if (event.key === '3') {
    event.preventDefault();
    setView('preview');
  }
}

/**
 * Initializes the keyboard shortcuts.
 */
export function initShortcuts() {
  window.addEventListener('keydown', onKeyDown);
}
