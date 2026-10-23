/**
 * ============================================================================
 * DOM REGISTRY & ICON INJECTION
 * ============================================================================
 * A single place where every element lookup happens, so the rest of the
 * application never repeats `document.getElementById(...)` and can rely on
 * the references being present.
 * ============================================================================
 */

import { icons } from '@/ui/icons.js';

export const el = {
  // Workspace
  workspace: document.getElementById('workspace'),
  splitter: document.getElementById('splitter'),
  panePreview: document.getElementById('pane-preview'),

  // Master toolbar
  appHeader: document.querySelector('.app-header'),
  zoneLeft: document.querySelector('.zone-left'),
  zoneRight: document.querySelector('.zone-right'),

  // Editor
  editor: document.getElementById('editor'),
  lineNumbers: document.getElementById('line-numbers'),
  fileInput: document.getElementById('file-input'),

  // Preview
  preview: document.getElementById('preview'),
  previewWrapper: document.getElementById('preview-wrapper'),
  miniPlayer: document.getElementById('mini-player'),
  mpToggle: document.getElementById('mp-toggle'),
  mpStop: document.getElementById('mp-stop'),
  mpClose: document.getElementById('mp-close'),
  mpLabel: document.getElementById('mp-label'),
  mpBar: document.getElementById('mp-bar'),
  outlineToggle: document.getElementById('outline-toggle'),
  outlinePanel: document.getElementById('outline-panel'),
  outlineClose: document.getElementById('outline-close'),
  outlineList: document.getElementById('outline-list'),
  breadcrumb: document.getElementById('breadcrumb'),

  // Header — view switcher
  viewTabs: document.getElementById('view-tabs'),

  // Header — audio
  btnPlay: document.getElementById('btn-play'),
  btnStop: document.getElementById('btn-stop'),
  voiceSelect: document.getElementById('voice-select'),
  rateSlider: document.getElementById('rate-slider'),
  rateBadge: document.getElementById('rate-badge'),
  btnMic: document.getElementById('btn-mic'),

  // Header — quick tools
  btnSample: document.getElementById('btn-sample'),
  btnCopy: document.getElementById('btn-copy'),
  btnPrint: document.getElementById('btn-print'),
  btnPaste: document.getElementById('btn-paste'),
  btnImportUrl: document.getElementById('btn-import-url'),
  btnTranslate: document.getElementById('btn-translate'),
  btnHistory: document.getElementById('btn-history'),
  btnReset: document.getElementById('btn-reset'),
  btnNewTab: document.getElementById('btn-new-tab'),
  btnSyncScroll: document.getElementById('btn-sync-scroll'),
  btnSplitAxis: document.getElementById('btn-split-axis'),
  btnTheme: document.getElementById('btn-theme'),
  btnSettings: document.getElementById('btn-settings'),

  // Settings modal
  modalSettings: document.getElementById('modal-settings'),
  modalCard: document.querySelector('#modal-settings .modal-card'),
  modalBody: document.querySelector('#modal-settings .modal-body'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  selectFontUi: document.getElementById('select-font-ui'),
  selectFontReading: document.getElementById('select-font-reading'),
  selectFontEditor: document.getElementById('select-font-editor'),
  selectFontSize: document.getElementById('select-font-size'),
  selectLineHeight: document.getElementById('select-line-height'),
  checkAutoStop: document.getElementById('check-auto-stop'),
  checkPauseOtherTabs: document.getElementById('check-pause-other-tabs'),
  checkVsCodeLinks: document.getElementById('check-vscode-links'),
  checkRememberPosition: document.getElementById('check-remember-position'),
  checkFollow: document.getElementById('check-follow'),
  checkDiagramLabels: document.getElementById('check-diagram-labels'),
  selectSyncMode: document.getElementById('select-sync-mode'),
  selectSpeechChunk: document.getElementById('select-speech-chunk'),
  selectSaveFormat: document.getElementById('select-save-format'),
  selectAutoSave: document.getElementById('select-auto-save'),
  selectHighlightMode: document.getElementById('select-highlight-mode'),
  selectTheme: document.getElementById('select-theme'),
  btnResetSettings: document.getElementById('btn-reset-settings'),
  storageUsageText: document.getElementById('storage-usage-text'),
  checkReaderFallback: document.getElementById('check-reader-fallback'),
  inputReaderApiKey: document.getElementById('input-reader-api-key'),
  selectTranslateLanguage: document.getElementById('select-translate-language'),
  checkHistoryEnabled: document.getElementById('check-history-enabled'),
  selectHistoryLimit: document.getElementById('select-history-limit'),
  selectHistoryDelay: document.getElementById('select-history-delay'),
  historyUsageText: document.getElementById('history-usage-text'),
  btnHistorySettingsClear: document.getElementById('btn-history-settings-clear'),
  btnHistoryOpen: document.getElementById('btn-history-open'),

  // Import from URL modal
  modalUrlImport: document.getElementById('modal-url-import'),
  dropOverlay: document.getElementById('drop-overlay'),
  dropOverlayText: document.getElementById('drop-overlay-text'),
  urlImportForm: document.getElementById('url-import-form'),
  urlImportInput: document.getElementById('url-import-input'),
  urlImportError: document.getElementById('url-import-error'),
  btnUrlImportSubmit: document.getElementById('btn-url-import-submit'),
  btnUrlImportCancel: document.getElementById('btn-url-import-cancel'),
  btnCloseUrlImport: document.getElementById('btn-close-url-import'),

  // Translation modal
  modalTranslate: document.getElementById('modal-translate'),
  translateForm: document.getElementById('translate-form'),
  translateTarget: document.getElementById('select-translate-target'),
  translateScope: document.getElementById('translate-scope'),
  translateError: document.getElementById('translate-error'),
  btnTranslateRun: document.getElementById('btn-translate-run'),
  btnTranslateCancel: document.getElementById('btn-translate-cancel'),
  btnTranslateRestore: document.getElementById('btn-translate-restore'),
  btnCloseTranslate: document.getElementById('btn-close-translate'),
  btnTranslateStop: document.getElementById('btn-translate-stop'),
  translateProgress: document.getElementById('translate-progress'),
  translateProgressBar: document.getElementById('translate-progress-bar'),
  translateProgressLabel: document.getElementById('translate-progress-label'),

  // Version history modal
  modalHistory: document.getElementById('modal-history'),
  modalHistoryCard: document.querySelector('#modal-history .modal-card'),
  btnCloseHistory: document.getElementById('btn-close-history'),
  historyList: document.getElementById('history-list'),
  historyStats: document.getElementById('history-stats'),
  historyEmpty: document.getElementById('history-empty'),
  btnHistorySave: document.getElementById('btn-history-save'),
  btnHistoryClear: document.getElementById('btn-history-clear'),
  btnHistoryClose: document.getElementById('btn-history-close'),

  splitAxisInputs: Array.from(document.querySelectorAll('input[name="split-axis"]')),
  splitRatioSlider: document.getElementById('split-ratio-slider'),
  splitRatioBadge: document.getElementById('split-ratio-badge'),
  btnResetLayout: document.getElementById('btn-reset-layout'),

  // Footer
  systemStatusDot: document.getElementById('system-status-dot'),
  systemStatusText: document.getElementById('system-status-text'),
  docStats: document.getElementById('doc-stats'),
  readingTime: document.getElementById('reading-time'),
  activeTokenInfo: document.getElementById('active-token-info'),
  speechStatusChip: document.getElementById('speech-status-chip')
};

const ICON_MAPPINGS = {
  'icon-play': icons.play,
  'icon-stop': icons.stop,
  'icon-mic': icons.mic,
  'icon-sync': icons.syncScroll,
  'icon-theme': icons.moon,
  'icon-settings': icons.settings,
  'modal-icon-settings': icons.settings,
  'icon-close-settings': icons.close,
  'icon-bold': icons.bold,
  'icon-italic': icons.italic,
  'icon-heading': icons.heading,
  'icon-code': icons.code,
  'icon-math': icons.math,
  'icon-table': icons.table,
  'icon-task': icons.task,
  'icon-sample': icons.sparkles,
  'icon-copy': icons.copy,
  'icon-print': icons.printer,
  'icon-paste': icons.paste,
  'icon-import-url': icons.link,
  'icon-import-url-modal': icons.link,
  'icon-close-url-import': icons.close,
  'icon-translate': icons.translate,
  'icon-translate-modal': icons.translate,
  'icon-close-translate': icons.close,
  'icon-history': icons.history,
  'icon-history-modal': icons.history,
  'icon-close-history': icons.close,
  'icon-drop-overlay': icons.drop,
  'icon-reset': icons.reset,
  'icon-new-tab': icons.newTab,
  'icon-open': icons.open,
  'icon-save': icons.save,
  'icon-outline': icons.outline,
  'icon-outline-close': icons.close,
  'icon-tab-edit': icons.edit,
  'icon-tab-split': icons.splitH,
  'icon-tab-preview': icons.eye,
  'icon-split-axis': icons.splitH
};

/**
 * Injects the inline SVG icons into their placeholder slots.
 */
export function injectIcons() {
  for (const [id, svgHtml] of Object.entries(ICON_MAPPINGS)) {
    const node = document.getElementById(id);
    if (node) node.innerHTML = svgHtml;
  }
}
