/**
 * Comprehensive English sample markdown demonstrating core features:
 * - CommonMark & GFM (Tables, Task lists, Strikethrough, Autolinks)
 * - LaTeX Math rendering via KaTeX ($inline$ and $$block$$)
 * - Code syntax highlighting (JavaScript, Python)
 * - Real-time word tokenization via Intl.Segmenter
 * - Click-to-Speak audio narration with boundary synchronization
 */
export const defaultMarkdown = `# MarkAudio — Live Preview & Synchronized Audio Reader

Welcome to **MarkAudio**, a high-performance Single Page Application designed with a **Zero Server-side Dependency** architecture. 
This application operates 100% inside your browser, seamlessly combining a robust Markdown engine with the **Web Speech API** and **Intl.Segmenter**.

---

## 🌟 Real-Time Word Highlighting & Speech Synchronization

Traditional browser speech synthesizers typically highlight entire blocks or fail to track continuous reading boundaries. 
This application tokenizes rendered text nodes down to individual words using:

\`\`\`javascript
const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
\`\`\`

> **Interactive Click-to-Speak:** Click any word or sentence in this preview pane to immediately start reading aloud from that exact location.
> The active word is highlighted with gentle, fluid typography without layout shifting!

### 📝 Roadmap & Feature Checklist
- [x] Responsive Dual-Pane Split Layout with Portrait auto-stacking
- [x] CommonMark and GitHub Flavored Markdown (GFM)
- [x] Chromium Garbage Collection bug mitigation
- [x] Speech-to-Text (STT) real-time voice dictation
- [x] Frictionless 60fps synchronized scrolling
- [ ] Try clicking on any paragraph or formula to listen!

---

## 📐 Mathematical Formula Rendering (KaTeX LaTeX)

Supports both **Inline Math** like the mass-energy equivalence $E = mc^2$ or the de Broglie wavelength $\lambda = \\frac{h}{p}$, 
as well as **Display Block Math** for advanced calculus and statistical distributions:

$$
\\sigma = \\sqrt{\\frac{1}{N} \\sum_{i=1}^{N} (x_i - \\mu)^2}
$$

And the famous Gaussian Integral:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

---

## 💻 Code Syntax Highlighting

\`\`\`javascript
// Synchronized word tokenization with exact character mapping
export function tokenizeTextNodes(container, locale = 'en-US') {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  
  let node = walker.nextNode();
  while (node) {
    // Wrap words in span tokens for speech boundary tracking
    node = walker.nextNode();
  }
}
\`\`\`

---

## 📊 Comparison Matrix (GFM Table)

| Feature | Standard Web Readers | MarkAudio Engine |
| :--- | :--- | :--- |
| **Highlight Granularity** | Full paragraph or block | Precise word-level tracking |
| **Scrolling Dynamics** | Jerky / High friction | 60–120 FPS requestAnimationFrame |
| **Chromium GC Safety** | Audio drops after 15s | Persistent Module Scope + Keep-Alive |
| **Server Dependencies** | Cloud API required | 100% Client-Side Private |

---

> 💡 **Tip:** Click the **Dictate 🎙️** button in the top toolbar to test voice typing directly into the editor in real-time!
`;
