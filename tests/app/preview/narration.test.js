/**
 * The first Play must not wait for a whole book to finish rendering. It can
 * start from the blocks that are already on screen; the progressive render
 * adds the rest to the speech window as it goes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  playing: false,
  paused: false,
  starting: false,
  current: false,
  canPlay: true,
  hasContent: true,
  hasSpeech: true,
  playCalls: 0,
  ensureCalls: 0
}));

vi.mock('@/speech/tts.js', () => ({
  play: () => {
    mock.playCalls += 1;
    if (mock.canPlay && mock.hasSpeech) mock.starting = true;
  },
  pause: () => {
    mock.paused = true;
  },
  isSpeaking: () => mock.playing,
  isSpeechPaused: () => mock.paused,
  isNarrationStarting: () => mock.starting,
  hasSpeechContent: () => mock.hasSpeech
}));

vi.mock('@/app/preview/preview.js', () => ({
  flushRender: () => Promise.resolve(),
  isPreviewCurrent: () => mock.current,
  hasDocumentContent: () => mock.hasContent,
  ensureRenderedThrough: () => {
    mock.ensureCalls += 1;
    mock.canPlay = true;
    return Promise.resolve();
  }
}));

const { toggleNarration, cancelPendingStart } = await import('@/app/preview/narration.js');

describe('starting the narration', () => {
  beforeEach(() => {
    Object.assign(mock, {
      playing: false,
      paused: false,
      starting: false,
      current: false,
      canPlay: true,
      hasContent: true,
      hasSpeech: true,
      playCalls: 0,
      ensureCalls: 0
    });
    cancelPendingStart();
  });

  it('starts from the rendered prefix without waiting for the whole preview', () => {
    const state = toggleNarration();

    expect(mock.playCalls).toBe(1);
    expect(mock.ensureCalls).toBe(0);
    expect(state).toBe('playing');
  });

  it('waits for the first chunk only when the preview is empty', async () => {
    mock.canPlay = false;

    const state = toggleNarration();

    expect(mock.playCalls).toBe(1);
    expect(mock.ensureCalls).toBe(1);
    expect(state).toBe('starting');

    // The first chunk has arrived and the play is attempted again.
    await Promise.resolve();
    await Promise.resolve();

    expect(mock.playCalls).toBe(2);
    expect(mock.starting).toBe(true);
  });

  it('does not start when the document has no text', () => {
    mock.hasContent = false;

    const state = toggleNarration();

    expect(state).toBe('empty');
    expect(mock.playCalls).toBe(0);
    expect(mock.ensureCalls).toBe(0);
  });

  it('does not start when the visible preview has no readable text', () => {
    mock.current = true;
    mock.hasSpeech = false;

    const state = toggleNarration();

    expect(state).toBe('empty');
    expect(mock.starting).toBe(false);
  });

  it('answers a second press while the first one is waiting', async () => {
    mock.canPlay = false;

    expect(toggleNarration()).toBe('starting');
    expect(toggleNarration()).toBe('starting');

    expect(mock.playCalls).toBe(1);
    expect(mock.ensureCalls).toBe(1);

    await Promise.resolve();
    await Promise.resolve();

    expect(mock.playCalls).toBe(2);
  });

  it('does not start after a pending start is cancelled', async () => {
    mock.canPlay = false;

    expect(toggleNarration()).toBe('starting');
    cancelPendingStart();

    await Promise.resolve();
    await Promise.resolve();

    expect(mock.playCalls).toBe(1);
    expect(mock.starting).toBe(false);
  });
});
