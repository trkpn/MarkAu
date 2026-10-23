import { describe, it, expect } from 'vitest';
import { installBrowserStubs } from '../../helpers.js';

installBrowserStubs();

/**
 * The toolbar sheds controls in a fixed order. This test locks that order
 * down, because "functionality first, branding last" is a product promise.
 */
const { DROP_STEPS } = await import('@/app/shell/toolbar.js');

describe('toolbar drop order', () => {
  it('hides the brand before anything functional', () => {
    const brandIndex = DROP_STEPS.findIndex((step) => step.attr === 'hideBrandText');
    const functional = DROP_STEPS.filter((step) => step.attr !== 'hideBrandText');

    expect(brandIndex).toBe(0);
    expect(functional.length).toBeGreaterThan(0);
  });

  it('collapses labels before removing whole controls', () => {
    const labelSteps = ['hideTabLabels', 'hideMicLabel', 'hidePlayLabel'];
    const controlSteps = ['hideSpeed', 'hideVoice', 'hideSample', 'hideCopy'];

    const lastLabel = Math.max(
      ...labelSteps.map((attr) => DROP_STEPS.findIndex((s) => s.attr === attr))
    );
    const firstControl = Math.min(
      ...controlSteps.map((attr) => DROP_STEPS.findIndex((s) => s.attr === attr))
    );

    expect(lastLabel).toBeLessThan(firstControl);
  });

  it('keeps the playback transport and the view tabs until the very end', () => {
    const attrs = DROP_STEPS.map((step) => step.attr);
    // There is no step that hides the transport or the tabs themselves.
    expect(attrs).not.toContain('hideTransport');
    expect(attrs).not.toContain('hideTabs');
  });

  it('uses unique attribute names', () => {
    const attrs = DROP_STEPS.map((step) => step.attr);
    expect(new Set(attrs).size).toBe(attrs.length);
  });
});
