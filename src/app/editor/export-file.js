/**
 * ============================================================================
 * DOCUMENT EXPORT
 * ============================================================================
 * Downloads the document as Markdown or as a standalone HTML page. The HTML
 * export is built from the source, but it borrows the diagrams that the
 * preview has already drawn — so the preview has to be up to date first.
 *
 * This lives outside `editor.js` on purpose: the preview imports the editor
 * backwards, and the editor must not import the preview back. The toolbar's
 * save button is wired to this module by the bootstrap instead.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { getSettings } from '@/core/settings.js';
import { setMessage } from '@/app/shell/status.js';
import { renderMarkdown } from '@/markdown/parser.js';
import { flushRender } from '@/app/preview/preview.js';

/**
 * Downloads the current document.
 */
export async function saveFile() {
  const format = getSettings().saveFormat;
  const markdown = el.editor.value;
  const isHtml = format === 'html';

  if (isHtml) {
    // The export must not leave out the chunks that are still being
    // rendered, or the diagrams that are waiting for their turn.
    await flushRender();
  }

  const blob = new Blob([isHtml ? toHtml(markdown) : markdown], {
    type: isHtml ? 'text/html' : 'text/markdown'
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${suggestFileName()}.${isHtml ? 'html' : 'md'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  setMessage(`Saved ${link.download}`, { tone: 'accent', ttl: 2500 });
}

/**
 * A file name derived from the document's first heading.
 * @returns {string}
 */
function suggestFileName() {
  const heading = el.editor.value.split('\n').find((line) => line.startsWith('# '));
  const title = heading ? heading.slice(2).trim() : 'document';
  const safe = title.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'document';
  return safe.slice(0, 60);
}

/**
 * Wraps the Markdown in a minimal HTML document.
 * @param {string} markdown
 * @returns {string}
 */
function toHtml(markdown) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${suggestFileName()}</title>
<style>
  body { max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem;
         font: 16px/1.75 system-ui, sans-serif; color: #0f172a; }
  pre { background: #0f172a; color: #e2e8f0; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  code { font-family: ui-monospace, monospace; }
  .mermaid-block { margin: 1.3rem 0; padding: 0.9rem; background: #f4f5f8;
                   border: 1px solid #e2e4ec; border-radius: 8px; }
  .mermaid-caption { margin-bottom: 0.6rem; color: #475569; font-size: 0.9em;
                     font-weight: 600; text-align: center; }
  .mermaid-canvas { display: flex; justify-content: center; }
  .mermaid-canvas svg { max-width: 100%; height: auto; }
  .mermaid-source { margin: 0.75rem 0 0; }
  .code-block { margin: 1.2rem 0; border: 1px solid #e2e4ec; border-radius: 8px;
                overflow: hidden; }
  .code-head { display: flex; justify-content: space-between; padding: 0.3rem 0.85rem;
               border-bottom: 1px solid #e2e4ec; background: #f4f5f8;
               color: #64748b; font-size: 0.72rem; text-transform: uppercase; }
  .code-body { display: flex; }
  .code-gutter { padding: 1rem 0.5rem 1rem 0.8rem; border-right: 1px solid #e2e4ec;
                 color: #94a3b8; font-size: 0.88rem; line-height: 1.5; text-align: right;
                 white-space: pre; }
  .code-body pre { border-radius: 0; margin: 0; flex: 1 1 auto; }
  .callout { margin: 1.2rem 0; padding: 0.85rem 1rem; border-left: 4px solid #4c5fd7;
             background: #f4f5f8; }
  .callout-title { margin: 0 0 0.35rem; color: #4c5fd7; font-weight: 700; }
  .callout-tip { border-color: #16a06a; }
  .callout-tip .callout-title { color: #16a06a; }
  .callout-warning { border-color: #d98b28; }
  .callout-warning .callout-title { color: #b06d12; }
  .callout-caution { border-color: #d4453f; }
  .callout-caution .callout-title { color: #d4453f; }
  .footnotes { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #e2e4ec;
               color: #475569; font-size: 0.9em; }
  .heading-anchor { display: none; }
</style>
</head>
<body>
${withRenderedDiagrams(renderMarkdown(markdown))}
</body>
</html>
`;
}

/**
 * Puts the drawn diagrams into the exported HTML.
 *
 * The export is rendered from the Markdown source, so it only contains the
 * diagram placeholders. The SVG that is currently drawn in the preview is
 * copied in — and when there is no drawing (a diagram that could not be
 * parsed, or a preview that is out of date) the source code is revealed
 * instead of shipping an empty box.
 * @param {string} html
 * @returns {string}
 */
function withRenderedDiagrams(html) {
  const blocks = Array.from(el.preview.querySelectorAll('.mermaid-block'));
  if (blocks.length === 0) return html;

  // The drawings of the preview, in the order of the document.
  const drawings = blocks.map((block) => {
    const content = block.querySelector('.mermaid-canvas')?.innerHTML?.trim() ?? '';
    return content.includes('<svg') ? content : '';
  });

  let canvasIndex = 0;
  const withDrawings = html.replace(/<div class="mermaid-canvas"><\/div>/g, (match) => {
    const drawing = drawings[canvasIndex++] ?? '';
    return drawing ? `<div class="mermaid-canvas">${drawing}</div>` : match;
  });

  // A diagram that is not drawn shows its source instead of an empty box.
  let sourceIndex = 0;
  return withDrawings.replace(/<pre class="mermaid-source"([^>]*)>/g, (match, attributes) => {
    const drawing = drawings[sourceIndex++] ?? '';
    if (drawing) return match;
    return `<pre class="mermaid-source"${attributes.replace(/\shidden(=(""|''))?/, '')}>`;
  });
}
