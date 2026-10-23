/**
 * @vitest-environment jsdom
 *
 * A patch re-renders a fragment of the document. The fragment's source-line
 * attributes are relative to the fragment, so they have to be put back into
 * the place of the block they replace.
 */

import { describe, it, expect } from 'vitest';

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
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0
};

document.body.innerHTML = `
  <textarea id="editor"></textarea>
  <div id="line-numbers"></div>
  <span id="doc-stats"></span>
  <span id="reading-time"></span>
  <span id="active-token-info"></span>
  <div id="preview-wrapper"><div id="preview"></div></div>
`;

const editor = await import('@/app/editor/editor.js');
const preview = await import('@/app/preview/preview.js');
const { el } = await import('@/app/shell/dom.js');

const MARKDOWN = [
  '# The heading',
  '',
  'A paragraph before the code.',
  '',
  '```js',
  'const value = 1;',
  'console.log(value);',
  '```',
  '',
  '## The heading after',
  '',
  'A closing paragraph.',
  '',
  'See [the link][ref].',
  '',
  '[ref]: https://example.com'
].join('\n');

/**
 * The 1-based line of a line of the document.
 * @param {string} text
 * @param {string} line
 * @returns {number}
 */
function lineOf(text, line) {
  return text.split('\n').indexOf(line) + 1;
}

describe('a preview patch', () => {
  it('keeps the source lines absolute and leaves the code block alone', async () => {
    editor.initEditor({ initialContent: MARKDOWN });
    preview.initPreview();
    await preview.flushRender();

    const paragraphLine = lineOf(MARKDOWN, 'A paragraph before the code.');
    expect(el.preview.querySelector(`p[data-line="${paragraphLine}"]`)).not.toBeNull();
    expect(el.preview.querySelectorAll('.code-block')).toHaveLength(1);

    el.editor.value = MARKDOWN.replace('A paragraph before the code.', 'A changed paragraph.');
    expect(preview.patchPreviewLines(paragraphLine - 1, paragraphLine + 1)).toBe(true);

    const patched = el.preview.querySelector(`p[data-line="${paragraphLine}"]`);
    expect(patched).not.toBeNull();
    expect(patched.textContent).toContain('A changed paragraph.');

    // The code panel is not an anchor (the highlighter returns its own
    // <pre>), so a patch around it must not wrap it a second time.
    expect(el.preview.querySelectorAll('.code-block')).toHaveLength(1);
    expect(el.preview.querySelector('.code-block .code-block')).toBeNull();

    const heading = el.preview.querySelector('h2[data-line]');
    expect(Number(heading.dataset.line)).toBe(lineOf(MARKDOWN, '## The heading after'));

    // A second patch must read the now-correct line of the block again.
    el.editor.value = el.editor.value.replace('A changed paragraph.', 'The second change.');
    expect(preview.patchPreviewLines(paragraphLine - 1, paragraphLine + 1)).toBe(true);

    const patchedAgain = el.preview.querySelector(`p[data-line="${paragraphLine}"]`);
    expect(patchedAgain).not.toBeNull();
    expect(patchedAgain.textContent).toContain('The second change.');

    // Reference-style links are defined at the end of the document. A patch
    // must still resolve them instead of leaving the brackets as text.
    const linkLine = lineOf(MARKDOWN, 'See [the link][ref].');
    el.editor.value = el.editor.value.replace('See [the link][ref].', 'See [the link][ref] now.');
    expect(preview.patchPreviewLines(linkLine - 1, linkLine + 1)).toBe(true);

    const link = el.preview.querySelector(`p[data-line="${linkLine}"] a`);
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('https://example.com');
  });
});
