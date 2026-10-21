import { describe, it, expect, beforeEach } from 'vitest';
import { installBrowserStubs } from './helpers.js';

installBrowserStubs();

const {
  sanitizeSettings,
  loadSettings,
  saveSettings,
  resetSettings,
  getSettings,
  DEFAULT_SETTINGS,
  SPLIT_RATIO_MIN,
  SPLIT_RATIO_MAX
} = await import('../src/settings-manager.js');

const KEY = 'markaudio_settings_v1';

describe('sanitizeSettings', () => {
  it('keeps valid values', () => {
    const result = sanitizeSettings({
      fontUi: 'Inter',
      fontReading: 'Georgia',
      fontEditor: 'JetBrains',
      theme: 'light',
      syncMode: 'ratio',
      speechChunk: 'block',
      autoSaveSeconds: 10,
      saveFormat: 'html',
      rememberPosition: false,
      followWhileReading: false
    });

    expect(result.fontUi).toBe('Inter');
    expect(result.fontReading).toBe('Georgia');
    expect(result.fontEditor).toBe('JetBrains');
    expect(result.theme).toBe('light');
    expect(result.syncMode).toBe('ratio');
    expect(result.speechChunk).toBe('block');
    expect(result.autoSaveSeconds).toBe(10);
    expect(result.saveFormat).toBe('html');
    expect(result.rememberPosition).toBe(false);
    expect(result.followWhileReading).toBe(false);
  });

  it('falls back to the default for unknown enum values', () => {
    const result = sanitizeSettings({
      theme: 'neon',
      syncMode: 'sideways',
      speechChunk: 'shout',
      highlightMode: 'rainbow',
      saveFormat: 'pdf',
      fontUi: 'Comic Sans'
    });

    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(result.syncMode).toBe(DEFAULT_SETTINGS.syncMode);
    expect(result.speechChunk).toBe(DEFAULT_SETTINGS.speechChunk);
    expect(result.highlightMode).toBe(DEFAULT_SETTINGS.highlightMode);
    expect(result.saveFormat).toBe(DEFAULT_SETTINGS.saveFormat);
    expect(result.fontUi).toBe(DEFAULT_SETTINGS.fontUi);
  });

  it('clamps the split ratio into the allowed range', () => {
    expect(sanitizeSettings({ splitRatioRow: 5 }).splitRatioRow).toBe(SPLIT_RATIO_MAX);
    expect(sanitizeSettings({ splitRatioColumn: -2 }).splitRatioColumn).toBe(SPLIT_RATIO_MIN);
    expect(sanitizeSettings({ splitRatioRow: 0.42 }).splitRatioRow).toBe(0.42);
  });

  it('falls back for a non numeric ratio', () => {
    expect(sanitizeSettings({ splitRatioRow: 'abc' }).splitRatioRow).toBe(
      DEFAULT_SETTINGS.splitRatioRow
    );
    expect(sanitizeSettings({ splitRatioRow: Number.NaN }).splitRatioRow).toBe(
      DEFAULT_SETTINGS.splitRatioRow
    );
  });

  it('drops unknown keys', () => {
    const result = sanitizeSettings({ somethingElse: true, theme: 'light' });
    expect(result.somethingElse).toBeUndefined();
  });
});

describe('migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('maps the v2 fonts onto the three new levels', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 2, fontSans: 'Inter', fontMono: 'JetBrains' })
    );
    const settings = loadSettings();

    expect(settings.fontUi).toBe('Inter');
    expect(settings.fontReading).toBe('Inter');
    expect(settings.fontEditor).toBe('JetBrains');
  });

  it('maps the old boolean sync flag onto a sync mode', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, smoothScrollActive: false }));
    expect(loadSettings().syncMode).toBe('off');

    localStorage.setItem(KEY, JSON.stringify({ version: 2, smoothScrollActive: true }));
    expect(loadSettings().syncMode).toBe('ratio');
  });

  it('resolves the legacy "auto" arrangement to a concrete axis', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, splitAxis: 'auto' }));
    const settings = loadSettings();
    expect(['row', 'column']).toContain(settings.splitAxis);
  });

  it('keeps an explicit arrangement untouched', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, splitAxis: 'column' }));
    expect(loadSettings().splitAxis).toBe('column');
  });

  it('survives a corrupted payload', () => {
    localStorage.setItem(KEY, '{not json');
    const settings = loadSettings();
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.fontUi).toBe(DEFAULT_SETTINGS.fontUi);
  });
});

describe('saveSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    loadSettings();
  });

  it('persists a partial update', () => {
    saveSettings({ theme: 'light' });
    expect(getSettings().theme).toBe('light');
    expect(JSON.parse(localStorage.getItem(KEY)).theme).toBe('light');
  });

  it('falls back to the default for an invalid value', () => {
    saveSettings({ theme: 'light' });
    saveSettings({ theme: 'nonsense' });
    expect(getSettings().theme).toBe(DEFAULT_SETTINGS.theme);
  });
});

describe('resetSettings', () => {
  it('restores the factory defaults', () => {
    localStorage.clear();
    loadSettings();
    saveSettings({ theme: 'light', fontReading: 'Georgia', splitRatioRow: 0.8 });

    resetSettings();

    const settings = getSettings();
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.fontReading).toBe(DEFAULT_SETTINGS.fontReading);
    expect(settings.splitRatioRow).toBe(DEFAULT_SETTINGS.splitRatioRow);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
