/**
 * ============================================================================
 * MASTER TOOLBAR — RESPONSIVE DENSITY
 * ============================================================================
 * The toolbar is always a single row. When the screen is too narrow, the
 * least important controls are hidden one by one until everything fits.
 * A control that is hidden does not vanish: it reappears in the ⋯ menu
 * (see app/shell/more-menu.js), so nothing is out of reach on a phone.
 *
 * Why measured instead of media queries: the toolbar contains text whose
 * width depends on the loaded font, on the chosen voice name and on the
 * browser's own metrics. Hard-coded breakpoints therefore either waste space
 * or overflow. This module measures the real content width and drops the
 * controls in order of importance until it fits.
 *
 * Drop order (least important first):
 *   brand text → speed control → voice selector → tab labels →
 *   mic label → play label → sample button → copy button →
 *   import button → paste button → history button → translate button →
 *   brand mark → network badge
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { syncHeaderMoreMenu } from '@/app/shell/more-menu.js';

/**
 * Each step hides one group of controls. `attr` is written to the header as
 * a boolean-ish data attribute that the stylesheet reacts to.
 *
 * The order matters. Shortening a label is less destructive than removing a
 * control, so labels collapse first; whole controls are only dropped when
 * there is no other way. Branding goes first of all — functionality wins.
 */
export const DROP_STEPS = [
  { attr: 'hideBrandText', label: 'brand wordmark' },
  { attr: 'hideTabLabels', label: 'view tab labels' },
  { attr: 'hideMicLabel', label: 'dictation label' },
  { attr: 'hidePlayLabel', label: 'play label' },
  { attr: 'hideSpeed', label: 'speed control' },
  { attr: 'hideVoice', label: 'voice selector' },
  { attr: 'hidePrint', label: 'print button' },
  { attr: 'hideSample', label: 'sample button' },
  { attr: 'hideCopy', label: 'copy button' },
  { attr: 'hideImportUrl', label: 'import button' },
  { attr: 'hidePaste', label: 'paste button' },
  { attr: 'hideHistory', label: 'history button' },
  { attr: 'hideTranslate', label: 'translate button' },
  { attr: 'hideNewTab', label: 'new tab button' },
  { attr: 'hideReset', label: 'reset button' },
  { attr: 'hideDivider', label: 'header dividers' },
  { attr: 'hideBrandMark', label: 'brand mark' },
  { attr: 'compactIcons', label: 'compact icon buttons' }
];

let frame = null;
let timer = null;

/**
 * Whether the header row still holds more content than it has room for.
 * The header is the scroll container itself, so its `scrollWidth` is the
 * ground truth — a computed estimate drifts a few pixels off the real
 * layout, and a few pixels are the difference between fitting and
 * shedding on a phone.
 * @param {HTMLElement} header
 * @returns {boolean}
 */
function contentOverflows(header) {
  return header.scrollWidth > header.clientWidth + 1;
}

/**
 * Hides or shows every drop step.
 * @param {string} attr
 * @param {boolean} hidden
 */
function setStep(attr, hidden) {
  el.appHeader.setAttribute(
    `data-${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
    hidden ? 'true' : 'false'
  );
}

/**
 * Recomputes which controls have to be hidden. Runs on resize and whenever
 * the toolbar content changes.
 */
function updateDensity() {
  const header = el.appHeader;
  if (!header) return;

  // Start from "everything visible" and hide step by step until the row
  // really fits — the header's own overflow is the verdict.
  for (const step of DROP_STEPS) setStep(step.attr, false);
  if (!contentOverflows(header)) return;

  for (const step of DROP_STEPS) {
    setStep(step.attr, true);
    if (!contentOverflows(header)) return;
  }
}

/**
 * Recomputes the density and the overflow menu together — a control that is
 * shed from the row reappears in the ⋯ menu, it is not lost.
 */
export function updateToolbarLayout() {
  updateDensity();
  syncHeaderMoreMenu();
}

/**
 * Schedules a density recalculation.
 *
 * `requestAnimationFrame` is the primary path, but it does not fire in a
 * background tab — a timer keeps the toolbar correct in that case too.
 */
export function refreshToolbarDensity() {
  if (frame !== null || timer !== null) return;

  const run = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    frame = null;
    timer = null;
    updateToolbarLayout();
  };

  frame = requestAnimationFrame(run);
  timer = setTimeout(run, 120);
}

/**
 * Initializes the responsive toolbar.
 */
export function initToolbar() {
  if (!el.appHeader) return;

  // Web fonts (or a different system font) change the text widths, so the
  // density has to be recomputed once the fonts are ready.
  document.fonts?.ready?.then(refreshToolbarDensity).catch(() => {});

  window.addEventListener('resize', refreshToolbarDensity, { passive: true });

  // The voice selector and the theme can change the toolbar's content.
  window.addEventListener('orientationchange', refreshToolbarDensity);

  // iOS changes the viewport when its URL bar collapses, without firing a
  // window resize the layout always follows. The header is observed
  // directly, and the visual viewport covers the rest.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(refreshToolbarDensity).observe(el.appHeader);
    // The zones are flex-sized to their content: when that content changes
    // after the first measurement — a late web font, the voice list filling
    // in — the observer is what notices, so the shedding is never computed
    // against a stale width.
    if (el.zoneLeft) new ResizeObserver(refreshToolbarDensity).observe(el.zoneLeft);
    if (el.zoneRight) new ResizeObserver(refreshToolbarDensity).observe(el.zoneRight);
  }
  window.visualViewport?.addEventListener('resize', refreshToolbarDensity, { passive: true });

  // Rendering frames can be throttled or absent right after load — a
  // background tab, an embedded view — so the observers and rAF cannot be
  // the only safety net. A few delayed re-checks cover the layout that
  // settles after the first measurement, whatever mechanism hides it.
  [250, 750, 2000].forEach((delay) => setTimeout(refreshToolbarDensity, delay));

  refreshToolbarDensity();
}
