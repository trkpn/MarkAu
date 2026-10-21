/**
 * Minimal browser environment for the unit tests.
 *
 * The modules under test only touch `localStorage` and
 * `document.documentElement`, so a very small stub is enough — and it keeps
 * the test suite free of a heavyweight DOM implementation.
 */

/**
 * Installs the stubs. Call before importing a module that reads them.
 */
export function installBrowserStubs() {
  const store = new Map();

  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    }
  };

  globalThis.document = {
    documentElement: {
      style: {
        setProperty: () => {}
      }
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  globalThis.window = {
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    addEventListener: () => {}
  };

  globalThis.addEventListener = () => {};

  return store;
}
