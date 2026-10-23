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
});
