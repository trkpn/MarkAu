/**
 * ============================================================================
 * FRONTMATTER
 * ============================================================================
 *
 * A small reader for the YAML-ish block that may open a Markdown document:
 *
 *   ---
 *   title: My document
 *   author: Tawatchai
 *   ---
 *
 * Only the flat `key: value` pairs are understood — that is what documents
 * actually use, and a full YAML parser would be a heavy dependency for it.
 *
 * The block is replaced by empty lines instead of being cut out: the preview
 * anchors every block to the line it starts on, so the line numbers of the
 * rest of the document must not move.
 */

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Reads the front matter of a document.
 * @param {string} text
 * @returns {{ data: Record<string, string>, body: string }} the values and the
 *   document with the block replaced by empty lines
 */
export function parseFrontmatter(text) {
  if (!text) return { data: {}, body: text || '' };

  const match = text.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: text };

  const data = {};

  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!entry) continue;

    let value = entry[2].trim();
    if (value.length > 1) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }

    data[entry[1].toLowerCase()] = value;
  }

  // Keep the line count: the block turns into empty lines.
  const blankLines = (match[0].match(/\n/g) || []).length;
  const body = '\n'.repeat(blankLines) + text.slice(match[0].length);

  return { data, body };
}
