/**
 * ============================================================================
 * MARKUDIO — APPLICATION BOOTSTRAP
 * ============================================================================
 * MarkAu is a Markdown editor you can hear — a live preview with a
 * synchronized audio reader.
 * Everything runs locally in the browser: no server, no network fonts.
 *
 * Module map:
 *   settings-manager.js  — persisted preferences (single source of truth)
 *   markdown-parser.js    — Markdown → sanitized HTML
 *   tts-engine.js         — speech synthesis + word highlighting
 *   multi-tab.js          — one tab narrates at a time
 *   stt-engine.js         — speech recognition (dictation)
 *   app/dom.js            — element registry + icon injection
 *   app/status.js         — footer status manager
 *   app/layout.js         — view switcher, panel arrangement, splitter
 *   app/editor.js         — buffer, draft persistence, replacement detection
 *   app/preview.js        — render pipeline, tokenization, sync scrolling
 *   app/controls.js       — header controls
 *   app/paste.js          — clipboard paste
 *   app/url-import.js     — import a document from a web address
 *   app/translate.js      — translate the document into another language
 *   app/history.js        — the versions of the document, kept in the browser
 *   app/new-tab.js        — a second tab, with a copy of the document
 *   app/document-title.js — the document's name in the browser tab
 *   app/settings-modal.js — preferences
 *   app/dialog.js         — in-app confirmation dialog
 * ============================================================================
 */

import { loadSettings } from './settings-manager.js';
import { injectIcons, el } from './app/dom.js';
import { initStatus, setMessage } from './app/status.js';
import { initLayout } from './app/layout.js';
import { initToolbar, refreshToolbarDensity } from './app/toolbar.js';
import {
  initEditor,
  setMarkdown,
  loadDraft,
  hasTabDraft,
  startBlankTab,
  onContentChange
} from './app/editor.js';
import { initPreview, forgetTabPosition } from './app/preview.js';
import { initControls } from './app/controls.js';
import { initPaste } from './app/paste.js';
import { initUrlImport } from './app/url-import.js';
import { initTranslate } from './app/translate.js';
import { initHistory } from './app/history.js';
import { initDragDrop } from './app/drag-drop.js';
import { initShortcuts } from './app/shortcuts.js';
import { initNewTab } from './app/new-tab.js';
import { initDocumentTitle } from './app/document-title.js';
import { initMiniPlayer } from './app/mini-player.js';
import { initOutline, rebuildOutline } from './app/outline.js';
import { initSettingsModal } from './app/settings-modal.js';
import { confirmDialog } from './app/dialog.js';
import { defaultMarkdown } from './sample-markdown.js';
import { isAnotherTabOpen } from './multi-tab.js';

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
    title: 'Reset the document?',
    message: 'Removes all content from the editor.',
    confirmLabel: 'Reset',
    danger: true
  });
  if (!confirmed) return;

  setMarkdown('', 'replaced');
  setMessage('Cleared', { tone: 'muted', ttl: 2000 });
}

/* ==========================================================================
 * Bootstrap
 * ========================================================================== */

async function initApp() {
  // The app restores the reading position itself; the browser's automatic
  // scroll restoration would fight it and win.
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }
  // A tab opened by hand must not inherit the article of another tab. The
  // app URL resumes the last document only when this is the only tab; the
  // New tab button asks for an empty one explicitly.
  const url = new URL(window.location.href);
  const wantsNewTab = url.searchParams.has('new');
  if (wantsNewTab) {
    url.searchParams.delete('new');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  // 1. Preferences first — they drive the CSS variables and the layout
  loadSettings();
  injectIcons();
  initStatus();
  initToolbar();

  // 2. Workspace
  const startFresh = wantsNewTab || (!hasTabDraft() && (await isAnotherTabOpen()));
  if (startFresh) {
    startBlankTab();
    forgetTabPosition();
  }

  // An empty draft of this tab is a real answer - the document was cleared
  // on purpose - so only a tab with no draft at all starts from the sample.
  const draft = startFresh ? '' : loadDraft();
  const hasDraft = startFresh || hasTabDraft();

  initLayout();
  initEditor({
    initialContent: hasDraft ? draft : draft || defaultMarkdown,
    onSample: loadSampleDocument,
    onCopy: copyMarkdown,
    onClear: clearDocument
  });
  initPreview();

  // 3. Chrome
  initControls();
  initPaste();
  initUrlImport();
  initTranslate();
  initHistory();
  initDragDrop();
  initShortcuts();
  initNewTab();
  initDocumentTitle();
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
