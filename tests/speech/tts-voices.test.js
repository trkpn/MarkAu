/**
 * @vitest-environment jsdom
 *
 * iOS Safari starts with an empty voice list and populates it late — often
 * without a `voiceschanged` event, sometimes only after the first gesture.
 * The wait has to keep polling instead of giving up after one second, and
 * an empty answer must never be cached: the next call tries again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

class FakeSpeechSynthesis {
  constructor() {
    this.voiceList = [];
    this.listeners = {};
  }

  getVoices() {
    return this.voiceList;
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((candidate) => candidate !== fn);
  }

  emit(type) {
    (this.listeners[type] || []).forEach((fn) => fn());
  }
}

const fakeSpeech = new FakeSpeechSynthesis();
window.speechSynthesis = fakeSpeech;

const { getAvailableVoices } = await import('@/speech/tts.js');

function makeVoice(name) {
  return { name, lang: 'th-TH', default: false, localService: true, voiceURI: name };
}

describe('getAvailableVoices', () => {
  beforeEach(() => {
    fakeSpeech.voiceList = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves at once when the browser already has voices', async () => {
    fakeSpeech.voiceList = [makeVoice('Ready voice')];

    const voices = await getAvailableVoices();

    expect(voices).toHaveLength(1);
    expect(voices[0].name).toBe('Ready voice');
  });

  it('resolves when the list arrives late through voiceschanged', async () => {
    const pending = getAvailableVoices();

    fakeSpeech.voiceList = [makeVoice('Late voice')];
    fakeSpeech.emit('voiceschanged');

    const voices = await pending;
    expect(voices).toHaveLength(1);
  });

  it('keeps polling when voiceschanged never fires (iOS Safari)', async () => {
    const pending = getAvailableVoices();
    let resolved = false;
    pending.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(1500);
    expect(resolved).toBe(false);

    // The list appears silently; the next poll tick has to pick it up.
    fakeSpeech.voiceList = [makeVoice('Polled voice')];
    await vi.advanceTimersByTimeAsync(1000);

    const voices = await pending;
    expect(voices).toHaveLength(1);
  });

  it('gives up after the timeout with an empty list — and retries on the next call', async () => {
    const first = getAvailableVoices();

    await vi.advanceTimersByTimeAsync(11000);
    expect(await first).toEqual([]);

    // The empty answer was not cached: a retry with the list present now
    // succeeds immediately.
    fakeSpeech.voiceList = [makeVoice('Recovered voice')];

    const voices = await getAvailableVoices();
    expect(voices).toHaveLength(1);
  });

  it('shares one wait between concurrent callers', async () => {
    const first = getAvailableVoices();
    const second = getAvailableVoices();

    fakeSpeech.voiceList = [makeVoice('Shared voice')];
    fakeSpeech.emit('voiceschanged');

    expect(await first).toEqual(await second);
  });
});
