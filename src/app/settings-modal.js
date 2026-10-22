/**
 * ============================================================================
 * PREFERENCES MODAL
 * ============================================================================
 * Typography, reading, files, appearance, narration and the layout. Every
 * control writes through the settings manager, which is the single source of
 * truth — the rest of the application reacts to those changes.
 * ============================================================================
 */

import { el } from './dom.js';
import {
  loadSettings,
  saveSettings,
  getSettings,
  resetSettings,
  clearDraft,
  onSettingsChange,
  FONT_UI_OPTIONS,
  FONT_READING_OPTIONS,
  FONT_EDITOR_OPTIONS,
  FONT_SIZE_OPTIONS,
  THEME_OPTIONS,
  SYNC_MODE_OPTIONS,
  SPEECH_CHUNK_OPTIONS,
  HIGHLIGHT_MODE_OPTIONS,
  AUTO_SAVE_OPTIONS,
  SAVE_FORMAT_OPTIONS,
  LINE_HEIGHT_OPTIONS
} from '../settings-manager.js';
import { setSplitAxis, setRatio, resetLayoutSizes, getRatio } from './layout.js';
import { refreshPreview } from './preview.js';
import { setMarkdown } from './editor.js';
import { setMessage } from './status.js';
import { confirmDialog } from './dialog.js';
import { loadAllLanguages } from '../markdown-parser.js';
import { defaultMarkdown } from '../sample-markdown.js';

/**
 * Fills a <select> with the given options.
 * @param {HTMLSelectElement} select
 * @param {Array<{id: string, name: string}>} options
 */
function fillSelect(select, options) {
  if (!select) return;
  select.innerHTML = '';
  options.forEach((option) => {
    const node = document.createElement('option');
    node.value = option.id;
    node.textContent = option.name;
    select.appendChild(node);
  });
}

/**
 * Fills a <select> from a shared option list ({ value, label }).
 * @param {HTMLSelectElement} select
 * @param {Array<{ value: string|number, label: string }>} options
 */
function fillOptions(select, options) {
  if (!select) return;
  select.innerHTML = '';
  options.forEach((option) => {
    const node = document.createElement('option');
    node.value = String(option.value);
    node.textContent = option.label;
    select.appendChild(node);
  });
}

/**
 * Computes an approximate localStorage usage figure.
 * @returns {string}
 */
function storageUsage() {
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      totalBytes += (localStorage.getItem(key).length + key.length) * 2;
    }
  } catch {
    return '~0 KB';
  }
  return `${(totalBytes / 1024).toFixed(1)} KB`;
}

/**
 * Syncs every control with the persisted settings.
 */
function syncInputs() {
  const settings = getSettings();

  el.selectFontUi.value = settings.fontUi;
  el.selectFontReading.value = settings.fontReading;
  el.selectFontEditor.value = settings.fontEditor;
  el.selectFontSize.value = settings.fontSize;
  el.selectLineHeight.value = settings.lineHeight;

  el.selectSyncMode.value = settings.syncMode;
  el.selectSpeechChunk.value = settings.speechChunk;
  el.selectSaveFormat.value = settings.saveFormat;
  el.selectAutoSave.value = String(settings.autoSaveSeconds);
  el.selectHighlightMode.value = settings.highlightMode;
  el.selectTheme.value = settings.theme;

  el.checkAutoStop.checked = settings.autoStopOnReplace;
  el.checkRememberPosition.checked = settings.rememberPosition;
  el.checkFollow.checked = settings.followWhileReading;
  if (el.checkDiagramLabels) {
    el.checkDiagramLabels.checked = settings.readDiagramLabels;
  }
  if (el.checkVsCodeLinks) {
    el.checkVsCodeLinks.checked = settings.openFileInVsCode !== false;
  }

  el.splitAxisInputs.forEach((input) => {
    input.checked = input.value === settings.splitAxis;
  });

  const ratioPercent = Math.round(getRatio() * 100);
  if (el.splitRatioSlider) el.splitRatioSlider.value = String(ratioPercent);
  if (el.splitRatioBadge) el.splitRatioBadge.textContent = `${ratioPercent}%`;

  if (el.storageUsageText) {
    el.storageUsageText.textContent = `Usage: ~${storageUsage()}`;
  }
}

/**
 * Shows a soft fade at the bottom of the dialog while there is more content
 * below, so a cut-off row never looks like a rendering glitch.
 */
function updateScrollHint() {
  const body = el.modalBody;
  const card = el.modalCard;
  if (!body || !card) return;

  const remaining = body.scrollHeight - body.clientHeight - body.scrollTop;
  card.dataset.scrollable = remaining > 4 ? 'true' : 'false';
}

/**
 * The scroll event is not delivered reliably in every environment (background
 * tabs throttle it), so the hint is polled while the dialog is open.
 */
let scrollPoll = null;

function startScrollPolling() {
  if (scrollPoll !== null) return;
  scrollPoll = setInterval(updateScrollHint, 200);
}

function stopScrollPolling() {
  if (scrollPoll === null) return;
  clearInterval(scrollPoll);
  scrollPoll = null;
}

/**
 * Initializes the preferences modal.
 */
export function initSettingsModal() {
  fillSelect(el.selectFontUi, FONT_UI_OPTIONS);
  fillSelect(el.selectFontReading, FONT_READING_OPTIONS);
  fillSelect(el.selectFontEditor, FONT_EDITOR_OPTIONS);
  fillSelect(el.selectFontSize, FONT_SIZE_OPTIONS);

  // The remaining pick-lists come from the same definitions the settings
  // manager validates against.
  fillOptions(el.selectTheme, THEME_OPTIONS);
  fillOptions(el.selectSyncMode, SYNC_MODE_OPTIONS);
  fillOptions(el.selectSpeechChunk, SPEECH_CHUNK_OPTIONS);
  fillOptions(el.selectHighlightMode, HIGHLIGHT_MODE_OPTIONS);
  fillOptions(el.selectAutoSave, AUTO_SAVE_OPTIONS);
  fillOptions(el.selectSaveFormat, SAVE_FORMAT_OPTIONS);
  fillOptions(el.selectLineHeight, LINE_HEIGHT_OPTIONS);

  let lastFocused = null;

  const open = () => {
    lastFocused = document.activeElement;
    syncInputs();
    el.modalSettings.removeAttribute('hidden');
    updateScrollHint();
    startScrollPolling();
    // Move focus into the dialog so keyboard and screen-reader users are not
    // left behind on the page behind the modal.
    el.btnCloseSettings?.focus();
  };

  const close = () => {
    el.modalSettings.setAttribute('hidden', '');
    stopScrollPolling();
    // Give the focus back to wherever it came from.
    const target = lastFocused && document.contains(lastFocused) ? lastFocused : el.btnSettings;
    if (target && typeof target.focus === 'function') target.focus();
    lastFocused = null;
  };

  el.btnSettings?.addEventListener('click', open);
  el.btnCloseSettings?.addEventListener('click', close);

  el.modalSettings?.addEventListener('click', (event) => {
    if (event.target === el.modalSettings) close();
  });

  // Keep the keyboard focus inside the dialog while it is open.
  el.modalSettings?.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      el.modalSettings.querySelectorAll('button, select, input, [tabindex]:not([tabindex="-1"])')
    ).filter((node) => node.offsetParent !== null);

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.modalSettings.hasAttribute('hidden')) {
      close();
    }
  });

  // Typography
  el.selectFontUi?.addEventListener('change', () =>
    saveSettings({ fontUi: el.selectFontUi.value })
  );
  el.selectFontReading?.addEventListener('change', () =>
    saveSettings({ fontReading: el.selectFontReading.value })
  );
  el.selectFontEditor?.addEventListener('change', () =>
    saveSettings({ fontEditor: el.selectFontEditor.value })
  );
  el.selectFontSize?.addEventListener('change', () =>
    saveSettings({ fontSize: el.selectFontSize.value })
  );
  el.selectLineHeight?.addEventListener('change', () =>
    saveSettings({ lineHeight: el.selectLineHeight.value })
  );

  // Reading
  el.selectSyncMode?.addEventListener('change', () =>
    saveSettings({ syncMode: el.selectSyncMode.value })
  );
  el.selectSpeechChunk?.addEventListener('change', () =>
    saveSettings({ speechChunk: el.selectSpeechChunk.value })
  );
  el.checkRememberPosition?.addEventListener('change', () => {
    saveSettings({ rememberPosition: el.checkRememberPosition.checked });
  });
  el.checkFollow?.addEventListener('change', () => {
    saveSettings({ followWhileReading: el.checkFollow.checked });
  });
  el.checkDiagramLabels?.addEventListener('change', () => {
    saveSettings({ readDiagramLabels: el.checkDiagramLabels.checked });
    // The words of the document changed, so the narration has to learn them.
    refreshPreview();
  });

  // Files
  el.selectSaveFormat?.addEventListener('change', () =>
    saveSettings({ saveFormat: el.selectSaveFormat.value })
  );
  el.selectAutoSave?.addEventListener('change', () => {
    saveSettings({ autoSaveSeconds: Number.parseInt(el.selectAutoSave.value, 10) || 0 });
  });
  el.selectHighlightMode?.addEventListener('change', async () => {
    const mode = el.selectHighlightMode.value;
    saveSettings({ highlightMode: mode });
    if (mode === 'all') {
      setMessage('Loading all languages…', { tone: 'muted', ttl: 1500 });
      const loaded = await loadAllLanguages();
      setMessage(loaded ? 'All languages loaded' : 'Could not load all languages', {
        tone: loaded ? 'accent' : 'warn',
        ttl: 2500
      });
    }
    refreshPreview();
  });

  // Appearance
  el.selectTheme?.addEventListener('change', () => saveSettings({ theme: el.selectTheme.value }));

  // Narration
  el.checkAutoStop?.addEventListener('change', () => {
    saveSettings({ autoStopOnReplace: el.checkAutoStop.checked });
  });

  el.checkVsCodeLinks?.addEventListener('change', () => {
    saveSettings({ openFileInVsCode: el.checkVsCodeLinks.checked });
    refreshPreview();
  });

  // Layout
  el.splitAxisInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      setSplitAxis(input.value);
      syncInputs();
    });
  });

  el.splitRatioSlider?.addEventListener('input', (event) => {
    const value = Number.parseInt(event.target.value, 10) / 100;
    setRatio(value);
    if (el.splitRatioBadge) {
      el.splitRatioBadge.textContent = `${event.target.value}%`;
    }
  });

  el.btnResetLayout?.addEventListener('click', () => {
    resetLayoutSizes();
    syncInputs();
  });

  // Reset everything
  el.btnResetSettings?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Reset all preferences?',
      message: 'Fonts, layout, narration and the saved draft go back to defaults.',
      confirmLabel: 'Reset all',
      danger: true
    });
    if (!confirmed) return;

    resetSettings();
    clearDraft();
    loadSettings();
    setMarkdown(defaultMarkdown, 'replaced');
    refreshPreview();
    syncInputs();
    setMessage('Preferences reset', { tone: 'accent', ttl: 2000 });
  });

  // Keep the modal in sync with changes made elsewhere
  onSettingsChange(() => {
    if (!el.modalSettings.hasAttribute('hidden')) {
      syncInputs();
    }
  });

  syncInputs();
}
