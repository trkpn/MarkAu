/**
 * ============================================================================
 * SETTINGS & PREFERENCES MANAGER (LOCAL STORAGE BEST PRACTICE)
 * ============================================================================
 * Features:
 * 1. Schema versioning and safe fallback to DEFAULT_SETTINGS
 * 2. Try-catch resilience against private browsing / quota restrictions
 * 3. Reactive CSS variable injection onto document.documentElement
 * 4. User font selection (Sans-serif & Monospace) and content replacement behavior
 * ============================================================================
 */

const SETTINGS_STORAGE_KEY = 'markaudio_settings_v1';

export const FONT_SANS_OPTIONS = [
  { id: 'Inter', name: 'Inter (Modern Sans)', value: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { id: 'Sarabun', name: 'Sarabun (Thai & Latin)', value: "'Sarabun', 'Inter', sans-serif" },
  { id: 'System', name: 'System UI', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { id: 'Georgia', name: 'Georgia (Serif Reading)', value: "Georgia, Cambria, 'Times New Roman', Times, serif" }
];

export const FONT_MONO_OPTIONS = [
  { id: 'JetBrains', name: 'JetBrains Mono', value: "'JetBrains Mono', 'Fira Code', monospace" },
  { id: 'FiraCode', name: 'Fira Code', value: "'Fira Code', 'JetBrains Mono', monospace" },
  { id: 'Consolas', name: 'Consolas / Menlo', value: "Menlo, Consolas, Monaco, monospace" }
];

export const FONT_SIZE_OPTIONS = [
  { id: 'sm', name: 'Small (14px)', value: '14px', preview: '0.92rem' },
  { id: 'md', name: 'Medium (16px - Default)', value: '16px', preview: '1rem' },
  { id: 'lg', name: 'Large (18px)', value: '18px', preview: '1.12rem' },
  { id: 'xl', name: 'Extra Large (20px)', value: '20px', preview: '1.25rem' }
];

export const DEFAULT_SETTINGS = {
  version: 1,
  fontSans: 'Inter',
  fontMono: 'JetBrains',
  fontSize: 'md',
  lineHeight: '1.75',
  autoStopOnReplace: true, // Auto-stop TTS when user replaces document / pastes all
  smoothScrollActive: true
};

let currentSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set();

/**
 * Loads settings from localStorage with fallback validation
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      currentSettings = { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (err) {
    console.warn('Failed to load settings from localStorage, using defaults:', err);
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  applySettings(currentSettings);
  return currentSettings;
}

/**
 * Saves partial or full settings to localStorage
 * @param {Partial<typeof DEFAULT_SETTINGS>} updates
 */
export function saveSettings(updates) {
  currentSettings = { ...currentSettings, ...updates };
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
  } catch (err) {
    console.error('Failed to save settings to localStorage:', err);
  }
  applySettings(currentSettings);
  notifyListeners();
  return currentSettings;
}

/**
 * Applies typography and visual settings as CSS Custom Properties on document root
 */
export function applySettings(settings) {
  const root = document.documentElement;

  // 1. Font Sans
  const sansOption = FONT_SANS_OPTIONS.find((f) => f.id === settings.fontSans) || FONT_SANS_OPTIONS[0];
  root.style.setProperty('--font-sans', sansOption.value);

  // 2. Font Mono
  const monoOption = FONT_MONO_OPTIONS.find((f) => f.id === settings.fontMono) || FONT_MONO_OPTIONS[0];
  root.style.setProperty('--font-mono', monoOption.value);

  // 3. Font Size Base
  const sizeOption = FONT_SIZE_OPTIONS.find((s) => s.id === settings.fontSize) || FONT_SIZE_OPTIONS[1];
  root.style.setProperty('--base-preview-size', sizeOption.preview);

  // 4. Line Height
  root.style.setProperty('--base-line-height', settings.lineHeight || '1.75');
}

/**
 * Returns current snapshot of settings
 */
export function getSettings() {
  return { ...currentSettings };
}

/**
 * Resets settings to factory defaults
 */
export function resetSettings() {
  currentSettings = { ...DEFAULT_SETTINGS };
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch (e) {
    // ignore
  }
  applySettings(currentSettings);
  notifyListeners();
  return currentSettings;
}

/**
 * Listen to settings updates
 */
export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners() {
  listeners.forEach((fn) => {
    try {
      fn(currentSettings);
    } catch (e) {
      console.error('Settings listener error:', e);
    }
  });
}
