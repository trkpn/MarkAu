/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

const {
  parseMarkdownDocument,
  groupMarkdownTokens,
  groupLineRange,
  renderMarkdownGroup,
  renderMarkdown
} = await import('@/markdown/parser.js');

/**
 * Renders a document the way the preview does.
 * @param {string} markdown
 * @returns {string}
 */
function renderInGroups(markdown) {
  const { tokens, env } = parseMarkdownDocument(markdown);
  const groups = groupMarkdownTokens(tokens);
  return {
    html: groups.map((group) => renderMarkdownGroup(group, env)).join(''),
    groups,
    ranges: groups.map((group) => groupLineRange(group))
  };
}

describe('progressive rendering', () => {
  it('keeps a footnote reference and its note together', () => {
    const markdown = 'Text[^1].\n\n[^1]: The note.';
    const full = renderMarkdown(markdown);
    const progressive = renderInGroups(markdown);

    expect(progressive.html).toContain('footnote-ref');
    expect(progressive.html).toContain('The note.');
    expect(progressive.html).toContain('</section>');
    expect(full).toContain('The note.');
  });

  it('keeps repeated heading ids unique across groups', () => {
    const markdown = '# Same\n\nText\n\n# Same';
    const progressive = renderInGroups(markdown);

    expect(progressive.html).toContain('id="same"');
    expect(progressive.html).toContain('id="same-2"');
  });

  it('renders lists, tables and math in balanced groups', () => {
    const markdown = [
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '- one',
      '- two',
      '',
      'The mass is $E = mc^2$.'
    ].join('\n');

    const progressive = renderInGroups(markdown);

    expect(progressive.html).toContain('<table');
    expect(progressive.html).toContain('<ul');
    expect(progressive.html).toContain('katex-inline');
  });

  it('gives every group a source line range', () => {
    const { groups, ranges } = renderInGroups('# One\n\nText\n\n## Two');

    expect(groups.length).toBeGreaterThan(2);
    expect(ranges[0]).toEqual({ startLine: 1, endLine: 1 });
    expect(ranges.every((range) => range.startLine >= 1 && range.endLine >= range.startLine)).toBe(
      true
    );
  });

  it('keeps front matter out and preserves the line numbers', () => {
    const { html } = renderInGroups('---\ntitle: Hidden\n---\n\n# Heading');

    expect(html).not.toContain('title: Hidden');
    expect(html).toContain('data-line="5"');
    expect(html).toContain('data-line-end="5"');
  });

  it('renders callouts in balanced groups', () => {
    const markdown = '> [!NOTE]\n> Lorem ipsum';
    const progressive = renderInGroups(markdown);
    expect(progressive.html).toContain('callout callout-note');
    expect(progressive.html).toContain('callout-title');
    expect(progressive.html).toContain('Lorem ipsum');
    expect(progressive.groups).toHaveLength(1);
  });

  it('renders callout followed by blank line and content in balanced groups', () => {
    const markdown = '> [!WARNING]\n>\n> Cautionary message\n\nNext paragraph outside';
    const progressive = renderInGroups(markdown);
    expect(progressive.html).toContain('callout callout-warning');
    expect(progressive.html).toContain('Cautionary message');
    expect(progressive.html).toContain('Next paragraph outside');
    expect(progressive.groups).toHaveLength(2);
  });

  it('renders consecutive callouts cleanly', () => {
    const markdown = '> [!NOTE]\n> Note text\n\n> [!TIP]\n> Tip text';
    const progressive = renderInGroups(markdown);
    expect(progressive.html).toContain('callout-note');
    expect(progressive.html).toContain('Note text');
    expect(progressive.html).toContain('callout-tip');
    expect(progressive.html).toContain('Tip text');
    expect(progressive.groups).toHaveLength(2);
  });
});
