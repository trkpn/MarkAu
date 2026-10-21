/**
 * ============================================================================
 * MARKUDIO — APPLICATION BOOTSTRAP
 * ============================================================================
 * MarkAudio is a Markdown live preview with a synchronized audio reader.
 * Everything runs locally in the browser: no server, no network fonts.
 *
 * Module map:
 *   settings-manager.js  — persisted preferences (single source of truth)
 *   markdown-parser.js    — Markdown → sanitized HTML
 *   tts-engine.js         — speech synthesis + word highlighting
 *   stt-engine.js         — speech recognition (dictation)
 *   app/dom.js            — element registry + icon injection
 *   app/status.js         — footer status manager
 *   app/layout.js         — view switcher, panel arrangement, splitter
 *   app/editor.js         — buffer, draft persistence, replacement detection
 *   app/preview.js        — render pipeline, tokenization, sync scrolling
 *   app/controls.js       — header controls
 *   app/settings-modal.js — preferences
 *   app/dialog.js         — in-app confirmation dialog
 * ============================================================================
 */

import { loadSettings } from './settings-manager.js';
import { injectIcons, el } from './app/dom.js';
import { initStatus, setMessage } from './app/status.js';
import { initLayout } from './app/layout.js';
import { initToolbar, refreshToolbarDensity } from './app/toolbar.js';
import { initEditor, setMarkdown, loadDraft, onContentChange } from './app/editor.js';
import { initPreview } from './app/preview.js';
import { initControls } from './app/controls.js';
import { initShortcuts } from './app/shortcuts.js';
import { initMiniPlayer } from './app/mini-player.js';
import { initOutline, rebuildOutline } from './app/outline.js';
import { initSettingsModal } from './app/settings-modal.js';
import { confirmDialog } from './app/dialog.js';
import { defaultMarkdown } from './sample-markdown.js';

/* ==========================================================================
 * Document level actions
 * ========================================================================== */

async function loadSampleDocument() {
  const confirmed = await confirmDialog({
    title: 'Load sample?',
    message: 'Replaces the current document with the built-in sample.',
    confirmLabel: 'Load',
    danger: true
  });
  if (!confirmed) return;

  setMarkdown(defaultMarkdown, 'replaced');
  setMessage('Sample loaded', { tone: 'accent', ttl: 2000 });
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(el.editor.value);
    setMessage('📋 Markdown copied to clipboard', { tone: 'accent', ttl: 2500 });
  } catch (err) {
    console.error(err);
    setMessage('Could not access the clipboard', { tone: 'warn', ttl: 3000 });
  }
}

async function clearDocument() {
  const confirmed = await confirmDialog({
    title: 'Clear the document?',
    message: 'Removes all content from the editor.',
    confirmLabel: 'Clear',
    danger: true
  });
  if (!confirmed) return;

  setMarkdown('', 'replaced');
  setMessage('Cleared', { tone: 'muted', ttl: 2000 });
}

/* ==========================================================================
 * Bootstrap
 * ========================================================================== */

function initApp() {
  // The app restores the reading position itself; the browser's automatic
  // scroll restoration would fight it and win.
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  // 1. Preferences first — they drive the CSS variables and the layout
  loadSettings();
  injectIcons();
  initStatus();
  initToolbar();

  // 2. Workspace
  initLayout();
  initEditor({
    initialContent: loadDraft() || defaultMarkdown,
    onSample: loadSampleDocument,
    onCopy: copyMarkdown,
    onClear: clearDocument
  });
  initPreview();

  // 3. Chrome
  initControls();
  initShortcuts();
  initMiniPlayer();
  initOutline();
  initSettingsModal();

  // The voice selector changes the toolbar's content width
  refreshToolbarDensity();

  // The outline follows the document
  onContentChange(() => rebuildOutline());
  rebuildOutline();
}

initApp();
