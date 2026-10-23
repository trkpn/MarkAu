/**
 * A short, self-documenting sample document.
 *
 * It is intentionally light: it shows what the editor can do and doubles as
 * a reminder of the keyboard shortcuts, without turning into a feature
 * pitch. Replace it with your own writing.
 */
export const defaultMarkdown = `# MarkAu

Markdown you can hear — write it, import it, and follow along as it is read aloud.

## Formatting

**Bold**, *italic*, ~~strikethrough~~ and \`inline code\` all work.

- Lists
- Work
- Fine

- [x] Live preview
- [x] Word-by-word reading
- [ ] Your next idea

Emoji shortcodes work too: :tada: :rocket: :books:

| Shortcut | Action |
| :--- | :--- |
| \`Space\` | Play / pause reading |
| \`Esc\` | Stop reading |
| \`Ctrl\` + \`B\` | Bold |

> [!TIP]
> Hover a heading to get a link to it, and use the button of a code block to
> copy the code.

## Code

\`\`\`js
const say = (text) => speechSynthesis.speak(text);
\`\`\`

## Math

Inline $a^2 + b^2 = c^2$ and a block:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

## Diagrams

A \`\`\`mermaid\` fence is drawn in the preview:

\`\`\`mermaid caption="From Markdown to audio"
graph LR
  A[Markdown] --> B[Preview]
  B --> C{Voice?}
  C -->|Yes| D[Read aloud]
  C -->|No| E[Keep writing]
\`\`\`

## Footnotes

Footnotes are supported as well[^why].

[^why]: They are the tidiest way to keep a note out of the flow of the text.

> Click any word in the preview to start reading from exactly there.

---

Everything above is plain Markdown — replace it with your own.
`;
