/**
 * @vitest-environment jsdom
 *
 * The time of a transcript is seen, not heard.
 *
 * A reader does not want the time of every line of a video called out to
 * them — but they do want to see it, so that they know which part of the
 * video is being read.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const { ensureTokens, setPreviewContainer, markTokensStale } = await import('../src/tts-engine.js');

/**
 * Builds a preview with a transcript in it and tokenizes it.
 *
 * @param {string} html
 * @returns {{ tokens: Array<{ text: string }>, preview: HTMLElement }}
 */
function tokenize(html) {
  const preview = document.createElement('div');
  preview.innerHTML = html;
  document.body.appendChild(preview);

  setPreviewContainer(preview);
  markTokensStale('test');

  return { tokens: ensureTokens(), preview };
}

describe('the narration of a transcript', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not read the time aloud', () => {
    const { tokens } = tokenize(
      '<p><strong>0:43</strong> Never gonna give you up</p>'
    );

    const spoken = tokens.map((token) => token.text).join(' ');

    expect(spoken).toContain('Never');
    expect(spoken).not.toContain('0');
    expect(spoken).not.toContain('43');
  });

  it('leaves the time in the document, to be seen', () => {
    const { preview } = tokenize('<p><strong>0:43</strong> Never gonna give you up</p>');

    const time = preview.querySelector('strong');
    expect(time.textContent).toBe('0:43');
  });

  it('does not read a time of hours and minutes either', () => {
    const { tokens } = tokenize('<p><strong>[1:02:03]</strong> The words</p>');

    const spoken = tokens.map((token) => token.text).join(' ');

    expect(spoken).toContain('The');
    expect(spoken).not.toContain('02');
  });

  it('reads the words of the transcript', () => {
    const { tokens } = tokenize(
      '<p><strong>0:01</strong> We are no strangers to love</p>' +
        '<p><strong>0:43</strong> Never gonna give you up</p>'
    );

    const spoken = tokens.map((token) => token.text).join(' ');

    expect(spoken).toContain('strangers');
    expect(spoken).toContain('Never');
  });

  it('still reads a time that is written in the text itself', () => {
    // Only a time that stands on its own, in bold, is a sign. A time
    // inside a sentence is a word of the sentence.
    const { tokens } = tokenize('<p>It happened at <strong>12:30</strong> in the evening.</p>');

    const spoken = tokens.map((token) => token.text).join(' ');

    expect(spoken).toContain('evening');
  });
});
