/**
 * ============================================================================
 * WORKSPACE LAYOUT CONTROLLER
 * ============================================================================
 * Responsibilities:
 *   1. View switcher (Edit | Split | Preview)
 *   2. Panel arrangement (auto / side-by-side / stacked) — the user decides,
 *      the screen orientation is only the *default*
 *   3. A draggable, keyboard-accessible splitter that resizes both panes
 *   4. One ratio per axis, so rotating the screen keeps a sensible split
 * ============================================================================
 */

import { el } from './dom.js';
import { getSettings, saveSettings, onSettingsChange } from '../settings-manager.js';
import { icons } from '../icons.js';

const RATIO_STEP = 0.02;

/** Resolved axis for the current environment. */
let currentAxis = 'row';
let currentRatio = 0.5;
/** True while the splitter is being dragged (suppresses re-layouts). */
let isDragging = false;

/* ==========================================================================
 * Axis resolution
 * ========================================================================== */

/**
 * Normalizes an arrangement preference into a concrete axis.
 * @param {'row'|'column'} preference
 * @returns {'row'|'column'}
 */
function resolveAxis(preference) {
  if (preference === 'row' || preference === 'column') return preference;
  const portrait = window.matchMedia?.('(orientation: portrait)').matches ?? false;
  return portrait ? 'column' : 'row';
}

/**
 * @returns {'row'|'column'} the axis currently in use
 */
/**
 * @returns {number} the editor share of the workspace (0 – 1)
 */
export function getRatio() {
  return currentRatio;
}

/* ==========================================================================
 * Applying the layout
 * ========================================================================== */

/**
 * Applies the persisted view / axis / ratio to the DOM.
 */
function applyLayout() {
  const settings = getSettings();

  currentAxis = resolveAxis(settings.splitAxis);
  currentRatio = currentAxis === 'column' ? settings.splitRatioColumn : settings.splitRatioRow;

  el.workspace.dataset.view = settings.view;
  el.workspace.dataset.axis = currentAxis;
  el.workspace.style.setProperty('--ma-split-ratio', currentRatio.toFixed(4));

  // View tabs
  el.viewTabs?.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.view === settings.view));
  });

  // Splitter semantics
  if (el.splitter) {
    el.splitter.setAttribute(
      'aria-orientation',
      currentAxis === 'column' ? 'horizontal' : 'vertical'
    );
    el.splitter.setAttribute('aria-valuenow', String(Math.round(currentRatio * 100)));
  }

  updateAxisButton();
}

/**
 * Reflects the current arrangement on the quick-access header button.
 * The icon shows how the panels are arranged right now, the tooltip says what
 * clicking will do.
 */
function updateAxisButton() {
  if (!el.btnSplitAxis) return;

  const iconSlot = document.getElementById('icon-split-axis');
  const isRow = currentAxis === 'row';

  if (iconSlot) {
    iconSlot.innerHTML = isRow ? icons.splitH : icons.splitV;
  }

  const current = isRow ? 'side by side' : 'stacked';
  const next = isRow ? 'stacked' : 'side by side';

  el.btnSplitAxis.title = `Arrangement: ${current}`;
  el.btnSplitAxis.setAttribute('aria-label', `Arrangement: ${current}. Switch to ${next}.`);
}

/**
 * Persists a new ratio for the axis currently in use.
 * @param {number} ratio
 * @param {boolean} persist
 */
function applyRatio(ratio, persist = false) {
  currentRatio = Math.min(0.85, Math.max(0.15, ratio));

  el.workspace.style.setProperty('--ma-split-ratio', currentRatio.toFixed(4));
  el.splitter?.setAttribute('aria-valuenow', String(Math.round(currentRatio * 100)));

  if (persist) {
    const key = currentAxis === 'column' ? 'splitRatioColumn' : 'splitRatioRow';
    saveSettings({ [key]: currentRatio });
  }
}

/**
 * Switches the workspace view.
 * @param {'edit'|'split'|'preview'} view
 */
export function setView(view) {
  saveSettings({ view });
  applyLayout();
}

/**
 * Changes the panel arrangement.
 * @param {'row'|'column'} axis
 */
export function setSplitAxis(axis) {
  saveSettings({ splitAxis: axis });
  applyLayout();
}

/**
 * Toggles the panel arrangement: side by side ↔ stacked.
 */
export function cycleSplitAxis() {
  setSplitAxis(currentAxis === 'row' ? 'column' : 'row');
}

/**
 * Resets both panel ratios to 50%.
 */
export function resetLayoutSizes() {
  saveSettings({ splitRatioRow: 0.5, splitRatioColumn: 0.5 });
  applyLayout();
}

/**
 * Applies a ratio coming from the settings slider.
 * @param {number} value 0 – 1
 */
export function setRatio(value) {
  applyRatio(value, true);
}

/* ==========================================================================
 * Splitter interaction
 * ========================================================================== */

/**
 * Converts a pointer position into a ratio for the active axis.
 * @param {number} clientX
 * @param {number} clientY
 * @returns {number}
 */
function ratioFromPointer(clientX, clientY) {
  const rect = el.workspace.getBoundingClientRect();
  const splitterSize = 10;

  if (currentAxis === 'column') {
    const usable = rect.height - splitterSize;
    if (usable <= 0) return 0.5;
    return (clientY - rect.top - splitterSize / 2) / usable;
  }

  const usable = rect.width - splitterSize;
  if (usable <= 0) return 0.5;
  return (clientX - rect.left - splitterSize / 2) / usable;
}

/**
 * Wires pointer + keyboard interaction on the splitter.
 */
function initSplitter() {
  if (!el.splitter) return;

  let pointerId = null;

  el.splitter.addEventListener('pointerdown', (event) => {
    isDragging = true;
    pointerId = event.pointerId;
    el.splitter.setPointerCapture?.(event.pointerId);
    el.splitter.dataset.dragging = 'true';
    document.body.style.cursor = currentAxis === 'column' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    event.preventDefault();
  });

  el.splitter.addEventListener('pointermove', (event) => {
    if (!isDragging) return;
    applyRatio(ratioFromPointer(event.clientX, event.clientY), false);
  });

  const endDrag = (event) => {
    if (!isDragging) return;
    isDragging = false;
    if (pointerId !== null) {
      el.splitter.releasePointerCapture?.(pointerId);
      pointerId = null;
    }
    delete el.splitter.dataset.dragging;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    applyRatio(currentRatio, true);
    event?.preventDefault?.();
  };

  el.splitter.addEventListener('pointerup', endDrag);
  el.splitter.addEventListener('pointercancel', endDrag);

  // Double click resets the split
  el.splitter.addEventListener('dblclick', () => {
    applyRatio(0.5, true);
  });

  // Keyboard accessibility
  el.splitter.addEventListener('keydown', (event) => {
    const decreaseKey = currentAxis === 'column' ? 'ArrowUp' : 'ArrowLeft';
    const increaseKey = currentAxis === 'column' ? 'ArrowDown' : 'ArrowRight';

    switch (event.key) {
      case decreaseKey:
        applyRatio(currentRatio - RATIO_STEP, true);
        break;
      case increaseKey:
        applyRatio(currentRatio + RATIO_STEP, true);
        break;
      case 'Home':
        applyRatio(0.15, true);
        break;
      case 'End':
        applyRatio(0.85, true);
        break;
      case 'Enter':
      case ' ':
        applyRatio(0.5, true);
        break;
      default:
        return;
    }
    event.preventDefault();
  });
}

/* ==========================================================================
 * Bootstrap
 * ========================================================================== */

/**
 * Initializes the workspace layout controller.
 */
export function initLayout() {
  // View tabs
  el.viewTabs?.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
    });
  });

  // Arrangement quick button
  el.btnSplitAxis?.addEventListener('click', () => {
    cycleSplitAxis();
  });

  initSplitter();

  // Re-apply when the settings change from anywhere else (e.g. the modal)
  onSettingsChange(() => {
    applyLayout();
  });

  // The arrangement is an explicit user choice, so rotating the screen keeps
  // it as-is. The ResizeObserver below still re-applies the layout so the
  // stored ratio for the active axis is restored after a resize.
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (isDragging) return;
      applyLayout();
    });
    observer.observe(el.workspace);
  }

  // A window resize can change the available space, keep the split sane
  window.addEventListener('resize', () => {
    if (isDragging) return;
    applyLayout();
  });

  applyLayout();
}
