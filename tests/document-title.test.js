/**
 * @vitest-environment jsdom
 *
 * The browser tab is the list of open documents: it carries the document's
 * name, and the tab that is reading says so.
 */

import { describe, it, expect, beforeEach } from 'vitest';

document.body.innerHTML = '<textarea id="editor"></textarea>';

const { initDocumentTitle, refreshDocumentTitle, titleFromMarkdown, composeTabTitle } =
  await import('../src/app/document-title.js');

describe('the name of the document', () => {
  it('prefers the title in the front matter', () => {
    expect(titleFromMarkdown('---\ntitle: A Quiet Paper\nauthor: Ada\n---\n\n# Heading')).toBe(
      'A Quiet Paper'
    );
  });

  it('uses the first heading of the body', () => {
    expect(titleFromMarkdown('Some opening words.\n\n## The Second Part\n\nText.')).toBe(
      'The Second Part'
    );
  });

  it('ignores headings inside a code fence', () => {
    expect(titleFromMarkdown('```md\n# Not a title\n```\n\n# The Real Title')).toBe(
      'The Real Title'
    );
  });

  it('falls back to the first line of a document without headings', () => {
    expect(titleFromMarkdown('---\ntitle: ""\n---\n\n- The first item of a list')).toBe(
      'The first item of a list'
    );
  });

  it('drops the Markdown out of the name', () => {
    expect(titleFromMarkdown('## **Bold** [link](https://example.com) `code`')).toBe(
      'Bold link code'
    );
  });

  it('shortens a name that is too long for a tab', () => {
    const long = `# ${'word '.repeat(30)}`;
    const title = titleFromMarkdown(long);

    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith('…')).toBe(true);
  });

  it('has no name for an empty document', () => {
    expect(titleFromMarkdown('')).toBe('');
    expect(titleFromMarkdown('\n\n   \n')).toBe('');
  });
});

describe('the title of the tab', () => {
  it('carries the document name and the app name', () => {
    expect(composeTabTitle('A Quiet Paper', false)).toBe('A Quiet Paper — MarkAu');
  });

  it('marks the tab that is reading', () => {
    expect(composeTabTitle('A Quiet Paper', true)).toBe('▶ A Quiet Paper — MarkAu');
  });

  it('keeps the app name alone when the document has none', () => {
    expect(composeTabTitle('', false)).toBe('MarkAu');
    expect(composeTabTitle('', true)).toBe('▶ MarkAu');
  });
});

describe('the tab itself', () => {
  beforeEach(() => {
    document.getElementById('editor').value = '';
  });

  it('names the tab after the document and gives it an icon', () => {
    document.getElementById('editor').value = '# The Document\n\nBody.';

    initDocumentTitle();

    expect(document.title).toBe('The Document — MarkAu');
    const icon = document.querySelector('link[rel="icon"]');
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('href')).toMatch(/^data:image\/svg\+xml,/);
  });

  it('names an empty tab as a new document', () => {
    initDocumentTitle();
    document.getElementById('editor').value = '   ';
    refreshDocumentTitle();

    expect(document.title.startsWith('New document')).toBe(true);
  });

  it('follows a document that is replaced', () => {
    initDocumentTitle();

    document.getElementById('editor').value = '# Another Document';
    refreshDocumentTitle();

    expect(document.title).toBe('Another Document — MarkAu');
  });
});
