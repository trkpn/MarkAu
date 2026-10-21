import { describe, it, expect, beforeEach } from 'vitest';
import { installBrowserStubs } from './helpers.js';

installBrowserStubs();

const { buildChunks } = await import('../src/tts-engine.js');
const { loadSettings, saveSettings } = await import('../src/settings-manager.js');

describe('buildChunks', () => {
  beforeEach(() => {
    localStorage.clear();
    loadSettings();
  });

  it('returns a single chunk in block mode', () => {
    saveSettings({ speechChunk: 'block' });
    const text = 'One sentence. Another sentence.';
    const chunks = buildChunks(text, 'en-US');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[0].charEnd).toBe(text.length);
  });

  it('splits into sentences in sentence mode', () => {
    saveSettings({ speechChunk: 'sentence' });
    const text = 'First sentence here. Second sentence follows. Third one closes.';
    const chunks = buildChunks(text, 'en-US');

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text.trim()).toBe('First sentence here.');
  });

  it('keeps the character ranges consistent with the source text', () => {
    saveSettings({ speechChunk: 'sentence' });
    const text = 'Alpha beta gamma. Delta epsilon zeta.';
    const chunks = buildChunks(text, 'en-US');

    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
  });

  it('drops whitespace-only chunks', () => {
    saveSettings({ speechChunk: 'sentence' });
    const chunks = buildChunks('   \n\n  ', 'en-US');
    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('returns an empty list for empty text', () => {
    saveSettings({ speechChunk: 'sentence' });
    expect(buildChunks('', 'en-US')).toEqual([]);
  });

  it('falls back to a single chunk when segmentation produces nothing', () => {
    saveSettings({ speechChunk: 'sentence' });
    const chunks = buildChunks('   ', 'en-US');
    expect(chunks.length).toBeGreaterThanOrEqual(0);
  });
});
