/**
 * ============================================================================
 * MERMAID DIAGRAM RENDERING
 * ============================================================================
 *
 * Mermaid is heavy: the diagram parsers and the layout engines weigh several
 * megabytes. It is therefore loaded on demand — a document without a diagram
 * never pays for it, and the first diagram pays exactly once. The full
 * Highlight.js language set is loaded the same way.
 *
 * The Markdown layer only emits a *placeholder*: a container plus the
 * untouched source. The diagram itself is drawn here, after the preview DOM
 * exists, because Mermaid needs a live document to measure and lay out its
 * labels.
 *
 * Four details keep the preview responsive:
 *
 *   1. RENDERED DIAGRAMS ARE CACHED — the preview is rewritten on every
 *      keystroke, and re-parsing an unchanged diagram would cost hundreds of
 *      milliseconds each time.
 *   2. A RENDER NEVER TOUCHES A STALE DOM — the preview may have been
 *      replaced while Mermaid was still working, so every write is guarded
 *      with an `isConnected` check.
 *   3. DIAGRAMS FOLLOW THE APP THEME — Mermaid bakes its colours into the
 *      SVG, so a theme change redraws the diagrams instead of leaving dark
 *      pictures in a light document.
 *   4. THE TOOLS LIVE ON THE DIAGRAM — zooming, panning, showing the source
 *      and downloading the drawing are handled here, next to the drawing
 *      they belong to.
 * ============================================================================
 */

import { icons } from './icons.js';
import { getSettings } from './settings-manager.js';
import { isSpeaking, refreshTokens } from './tts-engine.js';

/** The container the Markdown parser emits for every Mermaid fence. */
const BLOCK_SELECTOR = '.mermaid-block';

/** How many rendered diagrams are kept in the cache. */
const CACHE_LIMIT = 40;

/** The zoom range of a diagram, in multiples of its natural size. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

/** The tools every diagram carries. */
const TOOLBAR_BUTTONS = [
  { action: 'zoom-out', icon: 'zoomOut', label: 'Zoom out' },
  { action: 'zoom-in', icon: 'zoomIn', label: 'Zoom in' },
  { action: 'zoom-reset', icon: 'fit', label: 'Fit the diagram' },
  { action: 'source', icon: 'code', label: 'Show the diagram source' },
  { action: 'download', icon: 'download', label: 'Download the diagram as SVG' }
];

/** The loaded Mermaid instance, or the promise of it. */
let mermaidPromise = null;

/** The theme Mermaid is currently configured for. */
let configuredTheme = null;

/** The preview root the diagrams belong to. */
let activeRoot = null;

/** Monotonic counter that keeps the generated element ids unique. */
let diagramCounter = 0;

/** Rendered diagrams, keyed by theme, position and source. */
const svgCache = new Map();

/**
 * Resolves the app theme into a Mermaid theme.
 * @returns {'dark'|'default'}
 */
function resolveTheme() {
  const attribute = document.documentElement?.getAttribute('data-theme');
  return attribute === 'light' ? 'default' : 'dark';
}

/**
 * Loads Mermaid (once) and configures it for the given theme.
 * @param {'dark'|'default'} theme
 * @returns {Promise<object>} the Mermaid API
 */
async function getMermaid(theme) {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((module) => module.default || module);
  }

  const mermaid = await mermaidPromise;

  if (configuredTheme !== theme) {
    mermaid.initialize({
      // The app renders the diagrams itself — Mermaid must not scan the page.
      startOnLoad: false,
      // The SVG is sanitized by Mermaid itself before it is returned.
      securityLevel: 'strict',
      // A broken diagram is reported by the app, not by a picture of an error.
      suppressErrorRendering: true,
      theme,
      darkMode: theme === 'dark',
      flowchart: { useMaxWidth: true },
      sequence: { useMaxWidth: true }
    });
    configuredTheme = theme;
  }

  return mermaid;
}

/**
 * Reads the diagram source out of a placeholder.
 * @param {HTMLElement} block
 * @returns {string}
 */
function getSource(block) {
  return block.querySelector('.mermaid-source code')?.textContent ?? '';
}

/**
 * Puts a rendered diagram into its placeholder.
 * @param {HTMLElement} block
 * @param {string} svg
 */
function applySvg(block, svg) {
  const canvas = block.querySelector('.mermaid-canvas');
  if (!canvas) return;

  canvas.innerHTML = svg;
  block.dataset.mermaidState = 'rendered';
}

/**
 * Reports a broken diagram and reveals the source that caused it.
 * @param {HTMLElement} block
 * @param {unknown} error
 */
function showError(block, error) {
  block.dataset.mermaidState = 'error';

  const canvas = block.querySelector('.mermaid-canvas');
  const source = block.querySelector('.mermaid-source');

  let message = 'The diagram could not be drawn.';
  if (error instanceof Error && error.message) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  }
  // Mermaid's parse errors repeat the whole source — one line is enough.
  message = message.split('\n').slice(0, 4).join('\n').trim();

  if (source) source.hidden = false;
  if (!canvas) return;

  const note = document.createElement('p');
  note.className = 'mermaid-error';
  note.textContent = message;
  canvas.replaceChildren(note);
}

/**
 * Reports that Mermaid itself is unavailable (no network, chunk not cached).
 * @param {HTMLElement} block
 */
function showUnavailable(block) {
  block.dataset.mermaidState = 'unavailable';

  const canvas = block.querySelector('.mermaid-canvas');
  const source = block.querySelector('.mermaid-source');

  if (source) source.hidden = false;
  if (!canvas) return;

  const note = document.createElement('p');
  note.className = 'mermaid-error';
  note.textContent = 'The diagram renderer is not available offline yet — the source is shown below.';
  canvas.replaceChildren(note);
}

/* ==========================================================================
 * The tools around a diagram
 * ========================================================================== */

/**
 * Adds the tool bar to a diagram — once.
 * @param {HTMLElement} block
 */
function ensureToolbar(block) {
  if (block.querySelector('.mermaid-toolbar')) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'mermaid-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Diagram tools');

  for (const button of TOOLBAR_BUTTONS) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'mermaid-btn';
    node.dataset.mermaidAction = button.action;
    node.title = button.label;
    node.setAttribute('aria-label', button.label);
    node.innerHTML = icons[button.icon];
    toolbar.appendChild(node);
  }

  // The tools sit above the drawing, but below the caption.
  const viewport = block.querySelector('.mermaid-viewport');
  block.insertBefore(toolbar, viewport);
}

/**
 * The width a diagram is drawn at before it is zoomed.
 *
 * The SVG scales its content to its own box, so the zoom has to start from
 * the width that box actually has — the diagram fitted into the panel.
 * @param {HTMLElement} block
 * @returns {number}
 */
function getFittedWidth(block) {
  const stored = Number(block.dataset.mermaidWidth);
  if (Number.isFinite(stored) && stored > 0) return stored;

  const svg = block.querySelector('.mermaid-canvas svg');
  return svg?.getBoundingClientRect().width || 0;
}

/**
 * Applies a zoom level to a diagram.
 * @param {HTMLElement} block
 * @param {number} zoom
 */
function applyZoom(block, zoom) {
  const svg = block.querySelector('.mermaid-canvas svg');
  if (!svg) return;

  block.dataset.mermaidZoom = String(zoom);

  // Mermaid sizes the drawing itself; that inline style is what the zoom
  // starts from and what "fit" goes back to.
  const original = block.dataset.mermaidStyle ?? svg.getAttribute('style') ?? '';
  block.dataset.mermaidStyle = original;

  if (zoom === 1) {
    svg.setAttribute('style', original);
    return;
  }

  const fitted = getFittedWidth(block);
  if (!fitted) return;

  svg.style.maxWidth = 'none';
  svg.style.width = `${Math.round(fitted * zoom)}px`;
  svg.style.height = 'auto';
}

/**
 * Changes the zoom of a diagram.
 * @param {HTMLElement} block
 * @param {number} factor
 */
function zoomDiagram(block, factor) {
  const current = Number(block.dataset.mermaidZoom) || 1;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + factor));
  applyZoom(block, next);
}

/**
 * Shows or hides the source of a diagram.
 * @param {HTMLElement} block
 */
function toggleSource(block) {
  const source = block.querySelector('.mermaid-source');
  if (!source) return;

  source.hidden = !source.hidden;

  const button = block.querySelector('[data-mermaid-action="source"]');
  if (button) {
    const showing = !source.hidden;
    button.setAttribute('aria-pressed', String(showing));
    button.title = showing ? 'Hide the diagram source' : 'Show the diagram source';
  }
}

/**
 * The file name a downloaded diagram gets.
 * @param {HTMLElement} block
 * @returns {string}
 */
function suggestDiagramName(block) {
  const caption = block.querySelector('.mermaid-caption')?.textContent?.trim();
  if (caption) {
    const safe = caption.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim();
    if (safe) return safe.slice(0, 60);
  }
  return 'diagram';
}

/**
 * Downloads a diagram as a standalone SVG file.
 * @param {HTMLElement} block
 */
function downloadSvg(block) {
  const svg = block.querySelector('.mermaid-canvas svg');
  if (!svg) return;

  const markup = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${suggestDiagramName(block)}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Runs one of the diagram tools.
 * @param {string} action
 * @param {HTMLElement} block
 */
export function handleDiagramAction(action, block) {
  if (!block) return;

  switch (action) {
    case 'zoom-in':
      zoomDiagram(block, ZOOM_STEP);
      break;
    case 'zoom-out':
      zoomDiagram(block, -ZOOM_STEP);
      break;
    case 'zoom-reset':
      applyZoom(block, 1);
      break;
    case 'source':
      toggleSource(block);
      break;
    case 'download':
      downloadSvg(block);
      break;
    default:
      break;
  }
}

/**
 * Makes a diagram pannable with the pointer.
 *
 * A zoomed diagram is larger than its panel, so it can be dragged around.
 * @param {HTMLElement} block
 */
function enablePanning(block) {
  const viewport = block.querySelector('.mermaid-viewport');
  if (!viewport || viewport.dataset.pannable === 'true') return;
  viewport.dataset.pannable = 'true';

  let originX = 0;
  let originY = 0;
  let scrollLeft = 0;
  let scrollTop = 0;
  let dragging = false;

  viewport.addEventListener('pointerdown', (event) => {
    // A click on a link inside the diagram must stay a click.
    if (event.target.closest('a')) return;
    dragging = true;
    originX = event.clientX;
    originY = event.clientY;
    scrollLeft = viewport.scrollLeft;
    scrollTop = viewport.scrollTop;
    viewport.classList.add('is-panning');
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    viewport.scrollLeft = scrollLeft - (event.clientX - originX);
    viewport.scrollTop = scrollTop - (event.clientY - originY);
  });

  const stop = () => {
    dragging = false;
    viewport.classList.remove('is-panning');
  };

  viewport.addEventListener('pointerup', stop);
  viewport.addEventListener('pointercancel', stop);
  viewport.addEventListener('pointerleave', stop);
}

/**
 * Renders one placeholder.
 * @param {object} mermaid the Mermaid API
 * @param {HTMLElement} block
 * @param {number} index the position of the diagram in the document
 * @param {'dark'|'default'} theme
 */
async function renderBlock(mermaid, block, index, theme) {
  const source = getSource(block);
  if (!source.trim()) {
    block.dataset.mermaidState = 'empty';
    return;
  }

  // The position is part of the key: two identical diagrams in one document
  // must not share the element ids Mermaid bakes into the SVG.
  const cacheKey = `${theme}|${index}|${source}`;
  const cached = svgCache.get(cacheKey);
  if (cached) {
    applySvg(block, cached.svg);
    bindDiagram(block, cached.bind);
    return;
  }

  ensureToolbar(block);
  block.dataset.mermaidState = 'pending';

  try {
    const { svg, bindFunctions } = await mermaid.render(`ma-mermaid-${++diagramCounter}`, source);

    // The preview may have been replaced while Mermaid was working.
    if (!block.isConnected) return;

    svgCache.set(cacheKey, { svg, bind: bindFunctions });
    while (svgCache.size > CACHE_LIMIT) {
      svgCache.delete(svgCache.keys().next().value);
    }

    applySvg(block, svg);
    bindDiagram(block, bindFunctions);
    enablePanning(block);

    // Remember the fitted width — the zoom is measured from it.
    const drawn = block.querySelector('.mermaid-canvas svg');
    const fitted = drawn?.getBoundingClientRect().width;
    if (fitted) block.dataset.mermaidWidth = String(Math.round(fitted));

    applyZoom(block, Number(block.dataset.mermaidZoom) || 1);

    // The labels are now part of the document — the narration has to learn
    // them, but only when nothing is being read out loud.
    if (getSettings().readDiagramLabels && !isSpeaking()) {
      refreshTokens();
      // The word count and the narration are refreshed during idle time.
      block.dispatchEvent(new CustomEvent('preview:diagram-rendered', { bubbles: true }));
    }
  } catch (error) {
    if (!block.isConnected) return;
    console.warn('Mermaid could not render a diagram:', error);
    showError(block, error);
  }
}

/**
 * Activates the click handlers Mermaid defines for a diagram
 * (`click Node "https://…"`).
 * @param {HTMLElement} block
 * @param {Function|null} bindFunctions
 */
function bindDiagram(block, bindFunctions) {
  if (typeof bindFunctions !== 'function') return;

  const canvas = block.querySelector('.mermaid-canvas');
  if (!canvas) return;

  try {
    bindFunctions(canvas);
  } catch (error) {
    console.warn('Mermaid could not bind the diagram interactions:', error);
  }
}

/**
 * Draws every Mermaid diagram inside the given root.
 *
 * The call is fire-and-forget: the preview must not wait for the diagrams,
 * and a failure must never break the render pipeline.
 *
 * @param {HTMLElement} root the preview container
 * @returns {Promise<void>}
 */
export async function renderMermaidDiagrams(root) {
  if (!root) return;

  activeRoot = root;

  const blocks = Array.from(root.querySelectorAll(BLOCK_SELECTOR));
  if (blocks.length === 0) return;

  const theme = resolveTheme();

  let mermaid;
  try {
    mermaid = await getMermaid(theme);
  } catch (error) {
    console.warn('Mermaid could not be loaded:', error);
    blocks.forEach((block) => {
      if (block.isConnected) showUnavailable(block);
    });
    return;
  }

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block.isConnected) continue;
    await renderBlock(mermaid, block, index, theme);
  }
}

/**
 * Redraws every diagram — used when the app theme changes, because Mermaid
 * bakes its colours into the SVG.
 */
function redrawDiagrams() {
  if (!activeRoot || !activeRoot.isConnected) return;

  const blocks = Array.from(activeRoot.querySelectorAll(BLOCK_SELECTOR));
  if (blocks.length === 0) return;

  blocks.forEach((block) => {
    block.dataset.mermaidState = '';
    const canvas = block.querySelector('.mermaid-canvas');
    if (canvas) canvas.replaceChildren();
  });

  renderMermaidDiagrams(activeRoot);
}

/**
 * Watches the app theme so the diagrams follow it.
 */
function observeTheme() {
  if (typeof MutationObserver === 'undefined') return;

  const observer = new MutationObserver(() => {
    const theme = resolveTheme();
    if (theme === configuredTheme) return;
    configuredTheme = null;
    redrawDiagrams();
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}

observeTheme();
