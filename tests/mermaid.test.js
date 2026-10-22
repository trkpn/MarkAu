/**
 * @vitest-environment jsdom
 *
 * The Mermaid placeholder has to survive the sanitizer, so these tests run
 * against a real DOM instead of the lightweight stub the other suites use.
 */
import { describe, it, expect } from 'vitest';

const { renderMarkdown } = await import('../src/markdown-parser.js');

describe('mermaid fences', () => {
  it('turns a mermaid fence into a diagram placeholder', () => {
    const html = renderMarkdown('```mermaid\ngraph LR\n  A --> B\n```');

    expect(html).toContain('class="mermaid-block"');
    expect(html).toContain('data-mermaid="true"');
    expect(html).toContain('class="mermaid-canvas"');
  });

  it('keeps the diagram source in the DOM so it can be drawn later', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n  A[Start] --> B[End]\n```');

    expect(html).toContain('class="mermaid-source"');
    expect(html).toContain('A[Start] --&gt; B[End]');
  });

  it('hides the source until the diagram cannot be drawn', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n  A --> B\n```');

    expect(html).toContain('hidden');
  });

  it('strips markup out of the diagram source', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n  A["<script>alert(1)</script>"]\n```');

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('leaves other code fences alone', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```');

    expect(html).not.toContain('mermaid-block');
    expect(html).toContain('language-js');
  });

  it('anchors the diagram to its source line for the synced scrolling', () => {
    const html = renderMarkdown('Intro\n\n```mermaid\ngraph LR\n  A --> B\n```');

    expect(html).toContain('data-line="3"');
  });
});
