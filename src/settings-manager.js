/**
 * ============================================================================
 * SETTINGS & PREFERENCES MANAGER (LOCAL STORAGE BEST PRACTICE)
 * ============================================================================
 * 1. Schema versioning with a forward migration path
 * 2. Every value is sanitized on load, so a corrupted / hand-edited payload
 *    can never put the app into an invalid state
 * 3. Try-catch resilience against private browsing / quota restrictions
 * 4. Reactive CSS variable injection onto document.documentElement
 * 5. Single source of truth for everything the preferences dialog exposes
 * ============================================================================
 */

const SETTINGS_STORAGE_KEY = 'markau_settings_v1';

/**
 * The key the settings had before the app was renamed. The preferences are
 * moved over, so the rename does not cost the reader their settings.
 */
const LEGACY_SETTINGS_KEY = 'markaudio_settings_v1';

const SCHEMA_VERSION = 3;

/** Legacy standalone keys that are folded into the settings payload on load. */
const LEGACY_KEYS = {
  view: 'preferred_view',
  theme: 'theme',
  voiceName: 'preferred_voice_name'
};

/**
 * Typography is split into three independent levels, because the three
 * surfaces have very different jobs:
 *
 *   UI       — the app chrome: header, footer, dialogs, buttons
 *   Reading  — the rendered document, the thing you actually read
 *   Editor   — the Markdown source, where alignment and monospace matter
 *
 * Every level can also stay on the operating system's own default.
 */
const SYSTEM_SANS =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SYSTEM_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export const FONT_UI_OPTIONS = [
  { id: 'System', name: 'System default', value: SYSTEM_SANS },
  { id: 'Inter', name: 'Inter', value: "'Inter', system-ui, sans-serif" },
  { id: 'Sarabun', name: 'Sarabun', value: "'Sarabun', 'Inter', system-ui, sans-serif" },
  { id: 'Georgia', name: 'Georgia', value: "Georgia, Cambria, 'Times New Roman', serif" }
];

export const FONT_READING_OPTIONS = [
  { id: 'System', name: 'System default', value: SYSTEM_SANS },
  { id: 'Inter', name: 'Inter', value: "'Inter', system-ui, sans-serif" },
  { id: 'Sarabun', name: 'Sarabun', value: "'Sarabun', 'Inter', system-ui, sans-serif" },
  { id: 'Georgia', name: 'Georgia', value: "Georgia, Cambria, 'Times New Roman', serif" },
  { id: 'Charter', name: 'Charter', value: "Charter, 'Bitstream Charter', Cambria, Georgia, serif" }
];

export const FONT_EDITOR_OPTIONS = [
  { id: 'System', name: 'System default', value: SYSTEM_MONO },
  { id: 'JetBrains', name: 'JetBrains Mono', value: "'JetBrains Mono', 'Fira Code', monospace" },
  { id: 'FiraCode', name: 'Fira Code', value: "'Fira Code', 'JetBrains Mono', monospace" },
  {
    id: 'Consolas',
    name: 'Consolas',
    value: "Menlo, Consolas, Monaco, 'Liberation Mono', monospace"
  }
];

export const FONT_SIZE_OPTIONS = [
  { id: 'sm', name: 'Small (14px)', value: '14px', preview: '0.92rem' },
  { id: 'md', name: 'Medium (16px)', value: '16px', preview: '1rem' },
  { id: 'lg', name: 'Large (18px)', value: '18px', preview: '1.12rem' },
  { id: 'xl', name: 'Extra Large (20px)', value: '20px', preview: '1.25rem' }
];

export const VIEW_MODES = ['edit', 'split', 'preview'];

/**
 * The selectable options are defined once and drive both the preferences
 * dialog and the validation, so the two can never drift apart.
 */
export const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Follow system' }
];

export const SYNC_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'ratio', label: 'Proportional' },
  { value: 'line', label: 'By source line' }
];

export const SPEECH_CHUNK_OPTIONS = [
  { value: 'block', label: 'Whole document' },
  { value: 'sentence', label: 'Sentence by sentence' }
];

export const HIGHLIGHT_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'common', label: 'Common languages' },
  { value: 'all', label: 'All languages' }
];

export const AUTO_SAVE_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'After 1s' },
  { value: 3, label: 'After 3s' },
  { value: 10, label: 'After 10s' }
];

export const SAVE_FORMAT_OPTIONS = [
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'html', label: 'HTML (.html)' }
];

export const LINE_HEIGHT_OPTIONS = [
  { value: '1.5', label: '1.5 Compact' },
  { value: '1.75', label: '1.75 Comfortable' },
  { value: '2.0', label: '2.0 Relaxed' }
];

/** Panel arrangement: side by side or stacked. */
export const SPLIT_AXES = ['row', 'column'];

const values = (options) => options.map((option) => option.value);

export const THEME_MODES = values(THEME_OPTIONS);
export const SYNC_MODES = values(SYNC_MODE_OPTIONS);
export const SPEECH_CHUNK_MODES = values(SPEECH_CHUNK_OPTIONS);
export const HIGHLIGHT_MODES = values(HIGHLIGHT_MODE_OPTIONS);
export const AUTO_SAVE_SECONDS = values(AUTO_SAVE_OPTIONS);
export const SAVE_FORMATS = values(SAVE_FORMAT_OPTIONS);

/** Minimum / maximum share of the workspace a single pane may occupy. */
export const SPLIT_RATIO_MIN = 0.15;
export const SPLIT_RATIO_MAX = 0.85;

/**
 * The arrangement a fresh installation starts with: side by side on a
 * landscape screen, stacked on a portrait screen. Once the user picks one it
 * is remembered — in either orientation.
 * @returns {'row'|'column'}
 */
export function resolveDefaultAxis() {
  const portrait =
    typeof window !== 'undefined' && window.matchMedia?.('(orientation: portrait)').matches;
  return portrait ? 'column' : 'row';
}

export const DEFAULT_SETTINGS = {
  version: SCHEMA_VERSION,
  // Typography — one per surface
  fontUi: 'System',
  fontReading: 'System',
  fontEditor: 'System',
  fontSize: 'md',
  lineHeight: '1.75',
  // Behaviour
  autoStopOnReplace: true,
  smoothScrollActive: true,
  openFileInVsCode: true,
  syncMode: 'ratio',
  followWhileReading: true,
  speechChunk: 'sentence',
  readDiagramLabels: false,
  highlightMode: 'common',
  autoSaveSeconds: 3,
  saveFormat: 'md',
  rememberPosition: true,
  // Workspace
  view: 'split',
  theme: 'dark',
  splitAxis: 'row',
  splitRatioRow: 0.5,
  splitRatioColumn: 0.5,
  voiceName: ''
};

let currentSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set();

/* ==========================================================================
 * Validation helpers
 * ========================================================================== */

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function clampRatio(value, fallback) {
  const num = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, num));
}

/**
 * Produces a fully valid settings object from an arbitrary payload.
 * Unknown keys are dropped, invalid values fall back to their default.
 * @param {object} raw
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function sanitizeSettings(raw) {
  const d = DEFAULT_SETTINGS;
  const source = raw && typeof raw === 'object' ? raw : {};

  return {
    version: SCHEMA_VERSION,
    fontUi: oneOf(
      source.fontUi,
      FONT_UI_OPTIONS.map((f) => f.id),
      d.fontUi
    ),
    fontReading: oneOf(
      source.fontReading,
      FONT_READING_OPTIONS.map((f) => f.id),
      d.fontReading
    ),
    fontEditor: oneOf(
      source.fontEditor,
      FONT_EDITOR_OPTIONS.map((f) => f.id),
      d.fontEditor
    ),
    fontSize: oneOf(
      source.fontSize,
      FONT_SIZE_OPTIONS.map((s) => s.id),
      d.fontSize
    ),
    lineHeight: oneOf(source.lineHeight, LINE_HEIGHT_OPTIONS, d.lineHeight),
    autoStopOnReplace: bool(source.autoStopOnReplace, d.autoStopOnReplace),
    smoothScrollActive: bool(source.smoothScrollActive, d.smoothScrollActive),
    openFileInVsCode: bool(source.openFileInVsCode, d.openFileInVsCode),
    syncMode: oneOf(source.syncMode, SYNC_MODES, d.syncMode),
    followWhileReading: bool(source.followWhileReading, d.followWhileReading),
    speechChunk: oneOf(source.speechChunk, SPEECH_CHUNK_MODES, d.speechChunk),
    readDiagramLabels: bool(source.readDiagramLabels, d.readDiagramLabels),
    highlightMode: oneOf(source.highlightMode, HIGHLIGHT_MODES, d.highlightMode),
    autoSaveSeconds: oneOf(source.autoSaveSeconds, AUTO_SAVE_SECONDS, d.autoSaveSeconds),
    saveFormat: oneOf(source.saveFormat, SAVE_FORMATS, d.saveFormat),
    rememberPosition: bool(source.rememberPosition, d.rememberPosition),
    view: oneOf(source.view, VIEW_MODES, d.view),
    theme: oneOf(source.theme, THEME_MODES, d.theme),
    // A legacy "auto" value resolves to the arrangement that matches the
    // current screen, so old installations keep working.
    splitAxis: oneOf(source.splitAxis, SPLIT_AXES, resolveDefaultAxis()),
    splitRatioRow: clampRatio(source.splitRatioRow, d.splitRatioRow),
    splitRatioColumn: clampRatio(source.splitRatioColumn, d.splitRatioColumn),
    voiceName: typeof source.voiceName === 'string' ? source.voiceName : d.voiceName
  };
}

/**
 * Folds legacy standalone localStorage keys into the settings payload and
 * upgrades older schema versions.
 * @param {object} parsed
 * @returns {object}
 */
function migrate(parsed) {
  const migrated = { ...parsed };

  for (const [field, legacyKey] of Object.entries(LEGACY_KEYS)) {
    if (migrated[field] === undefined || migrated[field] === '') {
      try {
        const legacyValue = localStorage.getItem(legacyKey);
        if (legacyValue !== null && legacyValue !== '') {
          migrated[field] = legacyValue;
        }
      } catch {
        /* storage unavailable — keep defaults */
      }
    }
  }

  // v2 had a single "sans" font for both the interface and the reading
  // view, plus a separate monospace font for the editor.
  if (migrated.fontUi === undefined && migrated.fontSans !== undefined) {
    migrated.fontUi = migrated.fontSans;
  }
  if (migrated.fontReading === undefined && migrated.fontSans !== undefined) {
    migrated.fontReading = migrated.fontSans;
  }
  if (migrated.fontEditor === undefined && migrated.fontMono !== undefined) {
    migrated.fontEditor = migrated.fontMono;
  }

  // v2 had a boolean "smoothScrollActive"; v3 offers three sync modes.
  // "Proportional" is the direct successor of the old behaviour.
  if (migrated.syncMode === undefined) {
    migrated.syncMode = migrated.smoothScrollActive === false ? 'off' : 'ratio';
  }

  migrated.version = SCHEMA_VERSION;
  return migrated;
}

/* ==========================================================================
 * Public API
 * ========================================================================== */

/**
 * Moves the settings over from the key they had before the rename.
 */
function adoptLegacySettings() {
  try {
    if (localStorage.getItem(SETTINGS_STORAGE_KEY)) return;

    const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!legacy) return;

    localStorage.setItem(SETTINGS_STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_SETTINGS_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Loads settings from localStorage, migrates and sanitizes them.
 */
export function loadSettings() {
  try {
    adoptLegacySettings();

    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      currentSettings = sanitizeSettings(migrate(parsed));
    } else {
      currentSettings = sanitizeSettings(migrate({}));
    }
  } catch (err) {
    console.warn('Failed to load settings from localStorage, using defaults:', err);
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  applySettings(currentSettings);
  return getSettings();
}

/**
 * Saves partial or full settings to localStorage.
 * @param {Partial<typeof DEFAULT_SETTINGS>} updates
 */
export function saveSettings(updates) {
  currentSettings = sanitizeSettings({ ...currentSettings, ...updates });
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
  } catch (err) {
    console.error('Failed to save settings to localStorage:', err);
  }
  applySettings(currentSettings);
  notifyListeners();
  return getSettings();
}

/**
 * Applies typography and visual settings as CSS Custom Properties on the
 * document root so that every consumer (Tailwind utilities included) stays
 * in sync without a re-render.
 */
function applySettings(settings) {
  const root = document.documentElement;

  const pick = (options, id) => options.find((f) => f.id === id) || options[0];

  root.style.setProperty('--ma-font-ui', pick(FONT_UI_OPTIONS, settings.fontUi).value);
  root.style.setProperty(
    '--ma-font-reading',
    pick(FONT_READING_OPTIONS, settings.fontReading).value
  );
  root.style.setProperty('--ma-font-editor', pick(FONT_EDITOR_OPTIONS, settings.fontEditor).value);

  const sizeOption =
    FONT_SIZE_OPTIONS.find((s) => s.id === settings.fontSize) || FONT_SIZE_OPTIONS[1];
  root.style.setProperty('--ma-preview-size', sizeOption.preview);

  root.style.setProperty('--ma-line-height', settings.lineHeight || '1.75');
}

/**
 * Returns a snapshot of the current settings.
 */
export function getSettings() {
  return { ...currentSettings };
}

/**
 * Resets settings to factory defaults, including the legacy standalone keys.
 */
export function resetSettings() {
  currentSettings = sanitizeSettings({});
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    Object.values(LEGACY_KEYS).forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore — storage may be unavailable */
  }
  applySettings(currentSettings);
  notifyListeners();
  return getSettings();
}

/**
 * Removes the persisted document draft (used by "Reset all").
 */
export function clearDraft() {
  try {
    localStorage.removeItem('markdown_draft');
  } catch {
    /* ignore */
  }
}

/**
 * Subscribes to settings updates.
 * @param {(settings: typeof DEFAULT_SETTINGS) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners() {
  const snapshot = getSettings();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (e) {
      console.error('Settings listener error:', e);
    }
  });
}
