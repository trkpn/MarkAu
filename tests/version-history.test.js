/**
 * ============================================================================
 * VERSION HISTORY — THE STORAGE
 * ============================================================================
 * The versions of the document live in the browser and nowhere else. These
 * tests make sure that the storage cannot be broken by a payload that was
 * edited by hand, that it stays within its limits, and that a browser that
 * refuses the write is handled instead of thrown at the user.
 * ============================================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { installBrowserStubs } from './helpers.js';

installBrowserStubs();

const {
  addVersion,
  changedCharacters,
  clearHistory,
  entryBytes,
  fingerprint,
  formatBytes,
  formatRelativeTime,
  getVersion,
  historyStats,
  listVersions,
  looksLikeBulkRewrite,
  prune,
  readHistory,
  removeVersion,
  summarize,
  trimHistory,
  MIN_ENTRIES
} = await import('../src/version-history.js');

const KEY = 'markau_history_v1';

describe('the payload', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is empty when there is none', () => {
    expect(readHistory()).toEqual([]);
    expect(listVersions()).toEqual([]);
    expect(historyStats().count).toBe(0);
    expect(historyStats().bytes).toBe(0);
  });

  it('survives a payload that is not JSON', () => {
    localStorage.setItem(KEY, '{not json');

    expect(readHistory()).toEqual([]);
  });

  it('survives a payload that is not a list', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, entries: 'nonsense' }));

    expect(readHistory()).toEqual([]);
  });

  it('throws away the entries that hold no text', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { id: 'a', at: 1, markdown: '# Fine' },
          { id: 'b', at: 2, markdown: 42 },
          { id: 'c', at: 3 },
          null
        ]
      })
    );

    const entries = readHistory();
    expect(entries.length).toBe(1);
    expect(entries[0].markdown).toBe('# Fine');
  });

  it('coerces what is broken', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        entries: [{ id: 'a', at: 'yesterday', reason: 'nonsense', markdown: 'some text' }]
      })
    );

    const [entry] = readHistory();
    expect(entry.at).toBe(0);
    expect(entry.reason).toBe('auto');
  });

  it('keeps the reason it was given', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        entries: [{ id: 'a', at: 5, reason: 'before-replace', markdown: 'some text' }]
      })
    );

    expect(readHistory()[0].reason).toBe('before-replace');
  });

  it('computes the metadata again instead of believing the payload', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { id: 'a', at: 5, title: 'A lie', chars: 9999, words: 42, lines: 7, markdown: '# Real' }
        ]
      })
    );

    const [entry] = readHistory();
    expect(entry.title).toBe('Real');
    expect(entry.chars).toBe(6);
    expect(entry.lines).toBe(1);
  });
});

describe('keeping a version', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps the text of the document', () => {
    const result = addVersion('# The title\n\nSome text.', { at: 100 });

    expect(result.added).toBe(true);
    expect(result.entry.markdown).toBe('# The title\n\nSome text.');
    expect(result.entry.reason).toBe('auto');
    expect(readHistory().length).toBe(1);
  });

  it('keeps the reason it was given', () => {
    const result = addVersion('# Something', { at: 100, reason: 'before-replace' });
    expect(result.entry.reason).toBe('before-replace');
  });

  it('does not keep the same text twice in a row', () => {
    addVersion('# The same', { at: 100 });

    const second = addVersion('# The same', { at: 200 });

    expect(second.added).toBe(false);
    expect(second.reason).toBe('duplicate');
    expect(listVersions().length).toBe(1);
  });

  it('keeps the same document only once, wherever it sits', () => {
    addVersion('# First', { at: 1 });
    addVersion('# Second', { at: 2 });
    expect(listVersions().length).toBe(2);

    // The same text again — a paste of something that was there before.
    expect(addVersion('# First', { at: 3 }).added).toBe(true);

    const versions = listVersions();
    expect(versions.length).toBe(2);
    expect(versions[0].title).toBe('First');
    expect(versions[0].at).toBe(3);
    expect(versions[1].title).toBe('Second');
  });

  it('stays at one version however often the same text is kept', () => {
    for (let index = 0; index < 10; index += 1) {
      addVersion('# The pasted document', { at: 1000 + index });
    }

    expect(listVersions().length).toBe(1);
  });

  it('does not keep a document that holds nothing', () => {
    const result = addVersion('   \n  ', { at: 100 });

    expect(result.added).toBe(false);
    expect(result.reason).toBe('empty');
    expect(readHistory().length).toBe(0);
  });

  it('keeps the number of versions that was asked for', () => {
    for (let index = 0; index < 5; index += 1) {
      addVersion(`# Version ${index}`, { at: index + 1, limit: 3 });
    }

    const versions = listVersions();
    expect(versions.length).toBe(3);

    // The newest are the ones that are kept, and the oldest are the ones
    // that go.
    expect(versions[0].title).toBe('Version 4');
    expect(versions[2].title).toBe('Version 2');
  });

  it('keeps the newest version even when it does not fit', () => {
    const result = addVersion('x'.repeat(2000), { at: 1, budget: 100 });

    expect(result.added).toBe(true);
    expect(listVersions().length).toBe(1);
  });

  it('says so when the browser refuses the write', () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      const error = new Error('The storage is full');
      error.name = 'QuotaExceededError';
      throw error;
    };

    try {
      const result = addVersion('# Too much', { at: 1 });

      expect(result.added).toBe(false);
      expect(result.reason).toBe('quota');
    } finally {
      localStorage.setItem = original;
    }
  });
});

describe('the limits', () => {
  const entries = [
    { id: 'new', at: 3, reason: 'auto', markdown: 'x'.repeat(100) },
    { id: 'mid', at: 2, reason: 'auto', markdown: 'y'.repeat(100) },
    { id: 'old', at: 1, reason: 'auto', markdown: 'z'.repeat(100) }
  ];

  it('throws the oldest versions out when the space runs out', () => {
    const budget = entryBytes(entries[0]) + entryBytes(entries[1]) + 10;

    const kept = prune(entries, { limit: 10, budget });

    expect(kept.length).toBe(2);
    expect(kept[0].id).toBe('new');
    expect(kept[1].id).toBe('mid');
  });

  it('never throws out the last version', () => {
    const kept = prune(entries, { limit: 30, budget: 10 });

    expect(kept.length).toBe(MIN_ENTRIES);
    expect(kept[0].id).toBe('new');
  });

  it('never keeps more than the number that was asked for', () => {
    expect(prune(entries, { limit: 1, budget: 10_000 }).length).toBe(1);
    expect(prune(entries, { limit: 0, budget: 10_000 }).length).toBe(MIN_ENTRIES);
  });
});

describe('throwing versions away', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('throws one version away', () => {
    const first = addVersion('# One', { at: 1 });
    addVersion('# Two', { at: 2 });

    expect(removeVersion(first.entry.id)).toBe(true);
    expect(listVersions().length).toBe(1);
    expect(listVersions()[0].title).toBe('Two');
  });

  it('says so when there is nothing to throw away', () => {
    expect(removeVersion('nothing-like-this')).toBe(false);
  });

  it('throws the whole history away', () => {
    addVersion('# One', { at: 1 });
    addVersion('# Two', { at: 2 });

    clearHistory();

    expect(readHistory()).toEqual([]);
    expect(historyStats().count).toBe(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('brings the stored versions within a smaller limit', () => {
    for (let index = 0; index < 5; index += 1) {
      addVersion(`# Version ${index}`, { at: 1000 + index, limit: 10 });
    }
    expect(listVersions().length).toBe(5);

    expect(trimHistory({ limit: 2 })).toBe(true);

    const versions = listVersions();
    expect(versions.length).toBe(2);
    expect(versions[0].title).toBe('Version 4');
    expect(versions[1].title).toBe('Version 3');
  });
});

describe('the figures', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('counts the versions and their size', () => {
    addVersion('# One', { at: 100 });
    addVersion('# Two', { at: 200 });

    const stats = historyStats();
    expect(stats.count).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.newest).toBe(200);
    expect(stats.oldest).toBe(100);
  });

  it('finds a version by its name', () => {
    const result = addVersion('# One', { at: 100 });

    expect(getVersion(result.entry.id).markdown).toBe('# One');
    expect(getVersion('nothing-like-this')).toBeNull();
  });
});

describe('the helpers', () => {
  it('gives the same mark to the same text', () => {
    expect(fingerprint('# The same')).toBe(fingerprint('# The same'));
    expect(fingerprint('# The same')).not.toBe(fingerprint('# Another'));
    expect(fingerprint('# The same')).not.toBe(fingerprint('# The same!'));
  });

  it('takes the name of a document from its heading', () => {
    expect(summarize('# The title\n\nSome text.').title).toBe('The title');
  });

  it('falls back to the first line that is not empty', () => {
    expect(summarize('\n\nJust a line\nand another').title).toBe('Just a line');
  });

  it('cuts a long name short', () => {
    expect(summarize(`# ${'x'.repeat(200)}`).title.length).toBe(60);
  });

  it('counts the document', () => {
    const summary = summarize('# Title\n\nOne two three.');
    expect(summary.chars).toBe(23);
    expect(summary.words).toBe(5);
    expect(summary.lines).toBe(3);
  });

  it('sees a rewrite when the text is gone', () => {
    expect(looksLikeBulkRewrite('the old document', 'the old document')).toBe(false);
    expect(looksLikeBulkRewrite('the old document', 'something else')).toBe(true);
  });

  it('does not see a rewrite when the text is only added to', () => {
    expect(looksLikeBulkRewrite('the old document', 'the old document and more')).toBe(false);
  });

  it('measures an edit by the characters it changes', () => {
    expect(changedCharacters('the document', 'the document')).toBe(0);
    expect(changedCharacters('the document', 'the document!')).toBe(1);
    expect(changedCharacters('abc', 'abd')).toBe(2);
    expect(changedCharacters('', 'four')).toBe(4);
    expect(changedCharacters('four', '')).toBe(4);
  });

  it('tells how long ago a version was taken', () => {
    const now = 1_000_000_000;
    expect(formatRelativeTime(now, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60 * 1000, now)).toBe('5 min ago');
    expect(formatRelativeTime(now - 3 * 60 * 60 * 1000, now)).toBe('3 hours ago');
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60 * 1000, now)).toBe('2 days ago');
  });

  it('tells how much space a number of bytes takes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });
});
