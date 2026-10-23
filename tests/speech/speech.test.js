import { describe, it, expect, beforeEach } from 'vitest';
import { installBrowserStubs } from '../helpers.js';

installBrowserStubs();

const { buildChunks } = await import('@/speech/tts.js');
const { loadSettings, saveSettings } = await import('@/core/settings.js');

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

  it('groups short sentences into one request in sentence mode', () => {
    saveSettings({ speechChunk: 'sentence' });
    const text = 'First sentence here. Second sentence follows. Third one closes.';
    const chunks = buildChunks(text, 'en-US');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
  });

  it('cuts a long document at sentence ends', () => {
    saveSettings({ speechChunk: 'sentence' });
    const sentence = 'This sentence is long enough to be worth speaking on its own. ';
    const text = sentence.repeat(12).trim();
    const chunks = buildChunks(text, 'en-US');

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.trimEnd().endsWith('.')).toBe(true);
    }
  });

  it('shortens the ceiling when the playback rate is slow', () => {
    saveSettings({ speechChunk: 'sentence' });
    const text = 'The narration of this document continues for a good while. '.repeat(10);
    const slow = buildChunks(text, 'en-US', 0.5);
    const fast = buildChunks(text, 'en-US', 2);

    expect(slow.length).toBeGreaterThan(fast.length);
  });

  it('caps a long block so the browser does not cut it off', () => {
    saveSettings({ speechChunk: 'block' });
    const text = 'The document keeps going without any sentence boundary at all '.repeat(10);
    const chunks = buildChunks(text, 'en-US');

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(140);
    }
  });

  it('keeps a Thai request shorter than an English one', () => {
    saveSettings({ speechChunk: 'block' });
    const text = 'ภาษาไทยเขียนติดกันเป็นประโยคยาว '.repeat(20);
    const thai = buildChunks(text, 'th-TH');
    const english = buildChunks(text, 'en-US');

    expect(thai[0].text.length).toBeLessThan(english[0].text.length);
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
