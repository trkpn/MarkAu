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

const { ensureTokens, setPreviewContainer, markTokensStale } = await import('@/speech/tts.js');

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

/**
 * Builds the markup the parser emits for inline math, including the KaTeX
 * subtree whose text must never be read as prose.
 *
 * @param {string} formula
 * @returns {string}
 */
function inlineMath(formula) {
  return (
    `<span class="katex-inline" data-math="true" data-formula="${formula}">` +
    `<span class="katex"><span class="katex-mathml">${formula}</span></span></span>`
  );
}

describe('the narration of a transcript', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not read the time aloud', () => {
    const { tokens } = tokenize('<p><strong>0:43</strong> Never gonna give you up</p>');

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

describe('the narration of a formula', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads a formula where it appears in the document', () => {
    // Every formula used to be tokenized before the prose, so narration
    // began at a formula from the middle of the page and the highlight
    // scrolled there first.
    const { tokens } = tokenize(
      `<p>Alpha ${inlineMath('a + b')} beta</p>` + `<p>Gamma ${inlineMath('c + d')} delta</p>`
    );

    expect(tokens.map((token) => token.text)).toEqual([
      'Alpha',
      'a + b',
      'beta',
      'Gamma',
      'c + d',
      'delta'
    ]);
  });

  it('does not read the KaTeX markup of the formula', () => {
    const { tokens } = tokenize(`<p>Value ${inlineMath('E = mc^2')} now</p>`);

    const spoken = tokens.map((token) => token.text).join(' ');

    expect(spoken).toContain('E = mc^2');
    expect(spoken).not.toContain('katex');
  });

  it('gives the formula a single token that points at its element', () => {
    const { tokens, preview } = tokenize(`<p>Value ${inlineMath('x')} now</p>`);

    const formulaTokens = tokens.filter((token) => token.text === 'x');
    expect(formulaTokens).toHaveLength(1);
    expect(formulaTokens[0].element).toBe(preview.querySelector('[data-math="true"]'));
  });
});
