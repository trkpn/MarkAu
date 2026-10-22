/**
 * @vitest-environment jsdom
 *
 * The Markdown extensions have to survive the sanitizer, so these tests run
 * against a real DOM.
 */
import { describe, it, expect } from 'vitest';

const { renderMarkdown, getDocumentMeta } = await import('../src/markdown-parser.js');
const { parseFrontmatter } = await import('../src/frontmatter.js');

describe('front matter', () => {
  it('is not part of the rendered document', () => {
    const html = renderMarkdown('---\ntitle: Hidden\n---\n\nVisible text');

    expect(html).not.toContain('title: Hidden');
    expect(html).toContain('Visible text');
  });

  it('keeps the line numbers of the document intact', () => {
    const html = renderMarkdown('---\ntitle: X\n---\n\n# Heading');

    // The block takes the first three lines, the heading is on the fifth.
    expect(html).toContain('data-line="5"');
  });

  it('reads the values of the block', () => {
    const { data } = parseFrontmatter('---\ntitle: My document\nauthor: "Tawatchai"\n---\n\nBody');

    expect(data.title).toBe('My document');
    expect(data.author).toBe('Tawatchai');
  });

  it('is exposed for the rest of the app', () => {
    expect(getDocumentMeta('---\ntitle: Named\n---\n\nBody').title).toBe('Named');
  });

  it('leaves a document without front matter alone', () => {
    const { data, body } = parseFrontmatter('# Heading\n\nText');

    expect(data).toEqual({});
    expect(body).toBe('# Heading\n\nText');
  });
});

describe('callouts', () => {
  it('turns a marked blockquote into a callout', () => {
    const html = renderMarkdown('> [!NOTE]\n> Something worth knowing.');

    expect(html).toContain('callout callout-note');
    expect(html).toContain('callout-title');
    expect(html).toContain('Something worth knowing.');
  });

  it('knows the kinds of GitHub', () => {
    const html = renderMarkdown('> [!WARNING]\n> Careful.');

    expect(html).toContain('callout callout-warning');
  });

  it('leaves an ordinary blockquote alone', () => {
    const html = renderMarkdown('> Just a quote.');

    expect(html).not.toContain('callout');
    expect(html).toContain('blockquote');
  });

  it('does not keep the line break of the marker', () => {
    const html = renderMarkdown('> [!TIP]\n> The text.');

    expect(html).not.toContain('<br>');
  });
});

describe('emoji', () => {
  it('renders a shortcode as the character itself', () => {
    const html = renderMarkdown('Well done :tada:');

    expect(html).toContain('🎉');
    expect(html).not.toContain(':tada:');
  });

  it('leaves an unknown shortcode alone', () => {
    const html = renderMarkdown('Nothing :not_an_emoji_shortcode: here');

    expect(html).toContain(':not_an_emoji_shortcode:');
  });
});

describe('heading anchors', () => {
  it('gives a heading an id and a permalink', () => {
    const html = renderMarkdown('# A heading');

    expect(html).toContain('id="a-heading"');
    expect(html).toContain('href="#a-heading"');
    expect(html).toContain('heading-anchor');
  });

  it('keeps the text of the heading clean', () => {
    const html = renderMarkdown('# A heading');

    // The sign of the permalink comes from the stylesheet, so the text of
    // the heading stays exactly what the author wrote.
    expect(html).toContain('>A heading<a');
    expect(html).not.toContain('>A heading#');
  });

  it('makes repeated headings unique', () => {
    const html = renderMarkdown('# Same\n\n# Same');

    expect(html).toContain('id="same"');
    expect(html).toContain('id="same-2"');
  });

  it('gives the same document the same ids every time', () => {
    const first = renderMarkdown('# Stable');
    const second = renderMarkdown('# Stable');

    expect(first).toContain('id="stable"');
    expect(second).toContain('id="stable"');
  });

  it('handles headings in other scripts', () => {
    const html = renderMarkdown('# หัวข้อภาษาไทย');

    expect(html).toMatch(/id="หัวข้อภาษาไทย"/);
  });
});

describe('footnotes', () => {
  it('renders the reference and the note', () => {
    const html = renderMarkdown('Text[^1].\n\n[^1]: The note.');

    expect(html).toContain('footnote-ref');
    expect(html).toContain('footnotes');
    expect(html).toContain('The note.');
  });
});

describe('code blocks', () => {
  it('get a header with the language and a copy button', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```');

    expect(html).toContain('code-block');
    expect(html).toContain('code-lang');
    expect(html).toContain('data-code-copy');
  });

  it('get a gutter with the line numbers', () => {
    const html = renderMarkdown('```js\nconst a = 1;\nconst b = 2;\n```');

    expect(html).toContain('code-gutter');
    expect(html).toContain('1\n2');
  });

  it('leave a single line without a gutter', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```');

    expect(html).not.toContain('code-gutter');
  });
});
