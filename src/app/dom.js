/**
 * ============================================================================
 * DOM REGISTRY & ICON INJECTION
 * ============================================================================
 * A single place where every element lookup happens, so the rest of the
 * application never repeats `document.getElementById(...)` and can rely on
 * the references being present.
 * ============================================================================
 */

import { icons } from '../icons.js';

export const el = {
  // Workspace
  workspace: document.getElementById('workspace'),
  splitter: document.getElementById('splitter'),
  paneEditor: document.getElementById('pane-editor'),
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
  btnPause: document.getElementById('btn-pause'),
  btnStop: document.getElementById('btn-stop'),
  voiceSelect: document.getElementById('voice-select'),
  rateSlider: document.getElementById('rate-slider'),
  rateBadge: document.getElementById('rate-badge'),
  btnMic: document.getElementById('btn-mic'),

  // Header — quick tools
  btnSample: document.getElementById('btn-sample'),
  btnCopy: document.getElementById('btn-copy'),
  btnPaste: document.getElementById('btn-paste'),
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
  checkVsCodeLinks: document.getElementById('check-vscode-links'),
  checkRememberPosition: document.getElementById('check-remember-position'),
  checkFollow: document.getElementById('check-follow'),
  selectSyncMode: document.getElementById('select-sync-mode'),
  selectSpeechChunk: document.getElementById('select-speech-chunk'),
  selectSaveFormat: document.getElementById('select-save-format'),
  selectAutoSave: document.getElementById('select-auto-save'),
  selectHighlightMode: document.getElementById('select-highlight-mode'),
  selectTheme: document.getElementById('select-theme'),
  btnResetSettings: document.getElementById('btn-reset-settings'),
  storageUsageText: document.getElementById('storage-usage-text'),
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
  'icon-pause': icons.pause,
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
  'icon-paste': icons.paste,
  'icon-trash': icons.trash,
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
