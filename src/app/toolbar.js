/**
 * ============================================================================
 * MASTER TOOLBAR — RESPONSIVE DENSITY
 * ============================================================================
 * The toolbar is always a single row. When the screen is too narrow, the
 * least important controls are hidden one by one until everything fits.
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
 *   paste button → translate button → brand mark → network badge
 * ============================================================================
 */

import { el } from './dom.js';

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
  { attr: 'hidePaste', label: 'paste button' },
  { attr: 'hideTranslate', label: 'translate button' },
  { attr: 'hideReset', label: 'reset button' },
  { attr: 'hideDivider', label: 'header dividers' },
  { attr: 'hideBrandMark', label: 'brand mark' },
  { attr: 'compactIcons', label: 'compact icon buttons' }
];

let frame = null;
let timer = null;

/**
 * The width the toolbar content needs in its current state.
 * @returns {number}
 */
function requiredWidth() {
  const header = el.appHeader;
  if (!header) return 0;

  const style = getComputedStyle(header);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);

  const left = el.zoneLeft?.scrollWidth ?? 0;
  const right = el.zoneRight?.scrollWidth ?? 0;

  return left + right + gap + padding;
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

  // Start from "everything visible" and hide step by step.
  for (const step of DROP_STEPS) setStep(step.attr, false);

  const available = header.clientWidth;

  for (const step of DROP_STEPS) {
    if (requiredWidth() <= available) return; // fits — stop shedding
    setStep(step.attr, true);
  }
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
    updateDensity();
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

  refreshToolbarDensity();
}
