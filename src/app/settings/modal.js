/**
 * ============================================================================
 * PREFERENCES MODAL
 * ============================================================================
 * Typography, reading, files, appearance, narration and the layout. Every
 * control writes through the settings manager, which is the single source of
 * truth — the rest of the application reacts to those changes.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
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
  LINE_HEIGHT_OPTIONS,
  HISTORY_LIMIT_OPTIONS,
  HISTORY_DELAY_OPTIONS
} from '@/core/settings.js';
import { setSplitAxis, setRatio, resetLayoutSizes, getRatio } from '@/app/shell/layout.js';
import { refreshPreview } from '@/app/preview/preview.js';
import { setMarkdown } from '@/app/editor/editor.js';
import { setMessage } from '@/app/shell/status.js';
import { confirmDialog } from '@/app/shell/dialog.js';
import { loadAllLanguages } from '@/markdown/parser.js';
import { defaultMarkdown } from '@/content/sample.js';
import { TARGET_LANGUAGES, DEFAULT_TARGET } from '@/translation/languages.js';
import {
  clearHistory,
  historyStats,
  formatBytes,
  onHistoryChange,
  trimHistory
} from '@/core/history.js';
import { openDialog as openHistoryDialog } from '@/app/history/dialog.js';

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
 * What the version history holds — how many versions, and how much space
 * they take in the browser.
 * @returns {string}
 */
function historyUsage() {
  const stats = historyStats();
  const noun = stats.count === 1 ? 'version' : 'versions';
  return `${stats.count} ${noun} · ${formatBytes(stats.bytes)}`;
}

/**
 * Writes the figure of the history into the preferences.
 */
function syncHistoryUsage() {
  if (!el.historyUsageText) return;
  el.historyUsageText.textContent = historyUsage();
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
  if (el.checkReaderFallback) {
    el.checkReaderFallback.checked = settings.readerFallback !== false;
  }
  if (el.inputReaderApiKey) {
    el.inputReaderApiKey.value = settings.readerApiKey || '';
  }
  if (el.selectTranslateLanguage) {
    el.selectTranslateLanguage.value = settings.translateTarget || DEFAULT_TARGET;
  }

  if (el.checkHistoryEnabled) {
    el.checkHistoryEnabled.checked = settings.historyEnabled !== false;
  }
  if (el.selectHistoryLimit) {
    el.selectHistoryLimit.value = String(settings.historyLimit);
  }
  if (el.selectHistoryDelay) {
    el.selectHistoryDelay.value = String(settings.historyDelaySeconds);
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

  syncHistoryUsage();
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
 * The function that closes the preferences. It is set when the dialog is
 * initialized, so that the dialog can also be closed from the outside.
 */
let closePreferences = null;

/**
 * Closes the preferences dialog from the outside — the version history
 * opens over them, and a dialog on top of a dialog is a dialog on top of
 * a dialog.
 */
export function closeSettings() {
  closePreferences?.();
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
  fillOptions(el.selectHistoryLimit, HISTORY_LIMIT_OPTIONS);
  fillOptions(el.selectHistoryDelay, HISTORY_DELAY_OPTIONS);

  // The languages the document can be translated into.
  fillOptions(
    el.selectTranslateLanguage,
    TARGET_LANGUAGES.map((language) => ({
      value: language.code,
      label: `${language.name} — ${language.english}`
    }))
  );

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

  closePreferences = close;

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

  // Web import
  el.checkReaderFallback?.addEventListener('change', () => {
    saveSettings({ readerFallback: el.checkReaderFallback.checked });
  });

  el.inputReaderApiKey?.addEventListener('change', () => {
    saveSettings({ readerApiKey: el.inputReaderApiKey.value.trim() });
  });

  // Translation
  el.selectTranslateLanguage?.addEventListener('change', () => {
    saveSettings({ translateTarget: el.selectTranslateLanguage.value });
  });

  // Version history
  el.checkHistoryEnabled?.addEventListener('change', () => {
    saveSettings({ historyEnabled: el.checkHistoryEnabled.checked });
  });

  el.selectHistoryLimit?.addEventListener('change', () => {
    const limit = Number.parseInt(el.selectHistoryLimit.value, 10) || 30;
    saveSettings({ historyLimit: limit });

    // The versions that are already stored go at once, not only when the
    // next one is taken.
    trimHistory({ limit });
  });

  el.selectHistoryDelay?.addEventListener('change', () => {
    saveSettings({
      historyDelaySeconds: Number.parseInt(el.selectHistoryDelay.value, 10) || 10
    });
  });

  el.btnHistorySettingsClear?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Clear the version history?',
      message: 'Every stored version is removed. The document itself is not touched.',
      confirmLabel: 'Clear history',
      danger: true
    });
    if (!confirmed) return;

    clearHistory();
    syncHistoryUsage();
    setMessage('The version history is empty', { tone: 'muted', ttl: 2500 });
  });

  el.btnHistoryOpen?.addEventListener('click', () => {
    closeSettings();
    openHistoryDialog();
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

  // The figure of the history changes with every version that is kept.
  onHistoryChange(() => {
    syncHistoryUsage();
  });

  syncInputs();
}
