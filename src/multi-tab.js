/**
 * ============================================================================
 * CROSS-TAB COORDINATION
 * ============================================================================
 * Several tabs of the app can be open at once - the reader pastes a different
 * document into each. They share one set of speakers, so narration is a
 * single-tab affair: the tab that starts speaking asks the others to pause.
 *
 * `BroadcastChannel` is used where it exists (Edge, Chrome, Firefox); a
 * `localStorage` ping is the fallback for browsers without it.
 * ============================================================================
 */

const CHANNEL_NAME = 'markau-narration';
const PING_KEY = 'markau_narration_ping';
/** How long a new tab waits to hear that another tab is already open. */
const PROBE_TIMEOUT_MS = 150;

let channel = null;
let channelChecked = false;

/**
 * Opens the broadcast channel once, if the browser has one.
 * @returns {BroadcastChannel|null}
 */
function getChannel() {
  if (channelChecked) return channel;
  channelChecked = true;
  try {
    if (typeof BroadcastChannel === 'function') channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

/**
 * Tells the other tabs that this one is about to speak.
 */
export function announceNarrationStart() {
  const bus = getChannel();
  if (bus) {
    bus.postMessage({ type: 'narration-start', at: Date.now() });
    return;
  }

  try {
    // The value must differ from the last ping, or the browser skips the event.
    localStorage.setItem(PING_KEY, `${Date.now()}:${Math.random().toString(36).slice(2)}`);
  } catch {
    /* storage unavailable - the other tabs will simply not hear about it */
  }
}

/**
 * Calls `fn` when another tab starts narrating.
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onOtherTabNarrationStart(fn) {
  const bus = getChannel();

  if (bus) {
    const handler = (event) => {
      if (event.data?.type === 'narration-start') fn();
    };
    bus.addEventListener('message', handler);
    return () => bus.removeEventListener('message', handler);
  }

  const handler = (event) => {
    if (event.key === PING_KEY) fn();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/**
 * Asks the other tabs whether any of them is open. A tab that is opened by
 * hand should start empty when the reader is already reading another article,
 * and resume the last document only when it is alone.
 *
 * Without a broadcast channel there is no reliable way to ask, so the answer
 * is `false` and the caller falls back to the recovery copy.
 *
 * @returns {Promise<boolean>}
 */
export function isAnotherTabOpen() {
  const bus = getChannel();
  if (!bus) return Promise.resolve(false);

  const id = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    let settled = false;
    /** @param {boolean} open */
    const finish = (open) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bus.removeEventListener('message', handler);
      resolve(open);
    };
    /** @param {MessageEvent} event */
    const handler = (event) => {
      if (event.data?.type === 'here' && event.data.to === id) finish(true);
    };

    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    bus.addEventListener('message', handler);

    try {
      bus.postMessage({ type: 'probe', id });
    } catch {
      finish(false);
    }
  });
}

// Every tab answers the probe of a tab that is just opening.
if (typeof window !== 'undefined') {
  const bus = getChannel();
  if (bus) {
    bus.addEventListener('message', (event) => {
      if (event.data?.type !== 'probe') return;
      bus.postMessage({ type: 'here', to: event.data.id });
    });
  }
}
