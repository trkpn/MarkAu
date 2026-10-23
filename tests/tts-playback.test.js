/**
 * @vitest-environment jsdom
 *
 * The reading must be continuous, and it must survive a browser that drops
 * things.
 *
 * Web Speech loses a chunk for many reasons — a network voice that times
 * out, an engine reset, an OS audio-route change — and the reader must not
 * have to press Play again to hear the rest of the document. The next
 * request is therefore already waiting in the browser's queue while the
 * current one is spoken.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * A speech engine that records what it was asked to say and lets the test
 * decide what happens next.
 */
class FakeSpeechSynthesis {
  constructor() {
    this.speaking = false;
    this.pending = false;
    this.paused = false;
    this.spoken = [];
  }

  speak(utterance) {
    this.spoken.push(utterance);
  }

  cancel() {}

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  getVoices() {
    return [];
  }
}

globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
    this.lang = '';
  }
};

const fakeSpeech = new FakeSpeechSynthesis();
window.speechSynthesis = fakeSpeech;

// The cross-tab hand-shake is tested through its localStorage fallback in
// this file; the BroadcastChannel path has its own test in multi-tab.test.js.
delete globalThis.BroadcastChannel;

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  }
};

const tts = await import('../src/tts-engine.js');
const { initDocumentTitle } = await import('../src/app/document-title.js');

const SENTENCES = [
  'The first sentence of the document is long enough to carry some words of its own.',
  'The second sentence follows it immediately and keeps the same kind of length.',
  'The third sentence is here so that a second request has to be made by the reader.',
  'The fourth sentence continues the document in the very same way as the others.',
  'The fifth sentence brings the reading near its end without any special ceremony.',
  'The sixth sentence closes the document and lets the narration come to rest.'
];

/**
 * Builds a preview, tokenizes it and hands it to the engine.
 * @param {string} text
 */
function loadDocument(text) {
  const preview = document.createElement('div');
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  preview.appendChild(paragraph);
  document.body.appendChild(preview);

  tts.setPreviewContainer(preview);
  tts.markTokensStale('test');
  tts.ensureTokens();
}

/**
 * Starts the reading.
 * @returns {Promise<void>}
 */
async function startReading() {
  tts.play();
  await vi.advanceTimersByTimeAsync(60);
}

/**
 * Lets the fake engine speak everything it was handed, in order.
 * @returns {Promise<void>}
 */
async function readEverything() {
  let cursor = 0;

  while (cursor < fakeSpeech.spoken.length) {
    const utterance = fakeSpeech.spoken[cursor];
    cursor += 1;
    utterance.onstart();
    utterance.onend();
    await vi.advanceTimersByTimeAsync(20);
  }

  await vi.advanceTimersByTimeAsync(200);
}

describe('narration that the browser drops', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '';
    fakeSpeech.spoken = [];
    fakeSpeech.speaking = true;
    fakeSpeech.pending = false;
    fakeSpeech.paused = false;
  });

  afterEach(() => {
    tts.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('queues the next request while the current one is still speaking', async () => {
    loadDocument(SENTENCES.join(' '));

    await startReading();

    expect(fakeSpeech.spoken.length).toBe(2);
    expect(fakeSpeech.spoken[0].text.trim()).not.toBe('');
    expect(fakeSpeech.spoken[0].text).not.toBe(fakeSpeech.spoken[1].text);
  });

  it('reads the whole document without a gap between requests', async () => {
    loadDocument(SENTENCES.join(' '));

    await startReading();
    await readEverything();

    const spoken = fakeSpeech.spoken
      .map((utterance) => utterance.text)
      .join(' ')
      .replace(/\s+/g, ' ');
    for (const sentence of SENTENCES) {
      expect(spoken).toContain(sentence.replace(/\s+/g, ' '));
    }
    expect(tts.isSpeaking()).toBe(false);
  });

  it('asks again for a chunk the engine failed on', async () => {
    loadDocument(SENTENCES.join(' '));

    await startReading();
    const first = fakeSpeech.spoken[0];
    first.onstart();
    first.onerror({ error: 'network' });

    await vi.advanceTimersByTimeAsync(400);

    const retry = fakeSpeech.spoken.filter((utterance) => utterance.text === first.text);
    expect(retry.length).toBe(2);
    expect(tts.isSpeaking()).toBe(true);
  });

  it('skips a chunk that keeps failing and reads the rest', async () => {
    loadDocument(SENTENCES.join(' '));

    await startReading();
    const failedText = fakeSpeech.spoken[0].text;
    const used = new Set();

    while (used.size < 4) {
      const attempt = fakeSpeech.spoken.find(
        (utterance) => utterance.text === failedText && !used.has(utterance)
      );
      if (!attempt) break;

      used.add(attempt);
      attempt.onstart();
      attempt.onerror({ error: 'synthesis-failed' });
      await vi.advanceTimersByTimeAsync(500);
    }

    const texts = fakeSpeech.spoken.map((utterance) => utterance.text);

    // The engine was asked four times (the first try and three retries) and
    // then the reading moved on instead of dying.
    expect(texts.filter((text) => text === failedText).length).toBe(4);
    expect(texts.some((text) => text !== failedText)).toBe(true);
  });

  it('does not treat its own cancel as the end of the reading', async () => {
    loadDocument(SENTENCES.join(' '));

    await startReading();
    const first = fakeSpeech.spoken[0];
    first.onstart();
    first.onerror({ error: 'canceled' });

    await vi.advanceTimersByTimeAsync(1000);

    expect(fakeSpeech.spoken.length).toBe(2);
    expect(tts.isSpeaking()).toBe(true);
  });

  it('never asks the engine for more text from inside its own event', async () => {
    loadDocument(SENTENCES.join(' '));

    await startReading();
    const first = fakeSpeech.spoken[0];
    first.onstart();
    await vi.advanceTimersByTimeAsync(0);

    const before = fakeSpeech.spoken.length;
    first.onend();

    // Chromium can swallow a speak() that runs inside onend; the hand-over
    // has to happen on the next turn of the loop.
    expect(fakeSpeech.spoken.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(fakeSpeech.spoken.length).toBe(before + 1);
  });

  it('does not nudge the engine with pause and resume while it speaks', async () => {
    const pause = vi.spyOn(fakeSpeech, 'pause');
    const resume = vi.spyOn(fakeSpeech, 'resume');
    loadDocument(SENTENCES.join(' '));

    await startReading();
    const first = fakeSpeech.spoken[0];
    first.onstart();
    await vi.advanceTimersByTimeAsync(12000);

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('ignores the events of an utterance it cancelled', async () => {
    loadDocument(SENTENCES.join(' '));

    await startReading();
    const first = fakeSpeech.spoken[0];
    const queued = fakeSpeech.spoken[1];

    first.onstart();
    first.onerror({ error: 'network' });
    await vi.advanceTimersByTimeAsync(500);

    // The queued request was cancelled when the failed chunk was re-requested;
    // a late start/end from it must not be counted as a spoken chunk.
    const before = fakeSpeech.spoken.length;
    queued.onstart();
    queued.onend();

    expect(fakeSpeech.spoken.length).toBe(before);
    expect(tts.isSpeaking()).toBe(true);
  });

  it('recovers when the engine reports speaking but has gone silent', async () => {
    loadDocument(SENTENCES.join(' '));

    await startReading();
    const first = fakeSpeech.spoken[0];
    first.onstart();

    const before = fakeSpeech.spoken.length;
    await vi.advanceTimersByTimeAsync(14000);
    tts.reconcileWithSpeechApi();
    await vi.advanceTimersByTimeAsync(50);

    expect(fakeSpeech.spoken.length).toBeGreaterThan(before);
    expect(tts.isSpeaking()).toBe(true);
  });

  it('resumes an engine that the browser paused behind its back', async () => {
    loadDocument(SENTENCES.join(' '));

    await startReading();
    fakeSpeech.spoken[0].onstart();
    fakeSpeech.paused = true;

    tts.reconcileWithSpeechApi();

    expect(fakeSpeech.paused).toBe(false);
  });

  it('pauses when another tab starts narrating', async () => {
    const states = [];
    const off = tts.onTTSStateChange((state) => states.push(state));

    loadDocument(SENTENCES.join(' '));
    await startReading();
    fakeSpeech.spoken[0].onstart();

    expect(localStorage.getItem('markau_narration_ping')).not.toBeNull();

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'markau_narration_ping',
        newValue: String(Date.now())
      })
    );

    expect(tts.isSpeechPaused()).toBe(true);
    expect(states.at(-1).reason).toBe('other-tab');
    off();
  });

  it('stops reading when the page goes away', async () => {
    loadDocument(SENTENCES.join(' '));
    await startReading();
    fakeSpeech.spoken[0].onstart();

    window.dispatchEvent(new Event('pagehide'));

    expect(tts.isSpeaking()).toBe(false);
    expect(tts.isSpeechPaused()).toBe(false);
  });

  it('marks the tab while it is reading', async () => {
    initDocumentTitle();
    loadDocument(SENTENCES.join(' '));
    await startReading();
    fakeSpeech.spoken[0].onstart();

    expect(document.title.startsWith('▶ ')).toBe(true);

    tts.stop();

    expect(document.title.startsWith('▶ ')).toBe(false);
  });

  it('takes the reading back when Play is pressed after another tab paused it', async () => {
    loadDocument(SENTENCES.join(' '));
    await startReading();
    fakeSpeech.spoken[0].onstart();

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'markau_narration_ping',
        newValue: String(Date.now())
      })
    );
    expect(tts.isSpeechPaused()).toBe(true);
    const pausedPing = localStorage.getItem('markau_narration_ping');

    tts.play();

    expect(tts.isSpeechPaused()).toBe(false);
    expect(localStorage.getItem('markau_narration_ping')).not.toBe(pausedPing);
  });

  it('carries the document language to the engine', async () => {
    tts.setDocumentLocale('th-TH');
    loadDocument('สวัสดีครับ วันนี้อากาศดี และเราจะไปเที่ยวทะเลกันที่จังหวัดระยอง');

    await startReading();

    expect(fakeSpeech.spoken[0].lang).toBe('th-TH');
  });
});
