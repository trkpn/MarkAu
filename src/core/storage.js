/**
 * ============================================================================
 * LARGE PAYLOAD STORAGE (INDEXEDDB)
 * ============================================================================
 * localStorage is synchronous and small. A book, a version history and the
 * original of a translated document do not belong there.
 *
 * IndexedDB holds the payloads that may be large. The small, synchronous
 * APIs that already exist keep working: they read a local mirror when one is
 * available, and the large copy is loaded at startup.
 * ============================================================================
 */

const DATABASE_NAME = 'markau';
const DATABASE_VERSION = 1;

export const STORE = {
  DRAFT: 'drafts',
  HISTORY: 'history',
  BACKUP: 'backup',
  TRANSLATION: 'translation',
  META: 'meta'
};

let databasePromise = null;

/**
 * Tells whether IndexedDB can be used here.
 * @returns {boolean}
 */
export function isStorageAvailable() {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

/**
 * Opens the database once.
 * @returns {Promise<IDBDatabase|null>}
 */
export function openStorage() {
  if (!isStorageAvailable()) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      const stores = [
        STORE.DRAFT,
        STORE.HISTORY,
        STORE.BACKUP,
        STORE.TRANSLATION,
        STORE.META
      ];

      for (const name of stores) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name);
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return databasePromise;
}

/**
 * Reads a value from a store.
 *
 * @param {string} store
 * @param {IDBValidKey} key
 * @returns {Promise<unknown>}
 */
export async function readStored(store, key) {
  const database = await openStorage();
  if (!database) return null;

  return new Promise((resolve) => {
    try {
      const request = database.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Writes a value to a store.
 *
 * @param {string} store
 * @param {IDBValidKey} key
 * @param {unknown} value
 * @returns {Promise<boolean>}
 */
export async function writeStored(store, key, value) {
  const database = await openStorage();
  if (!database) return false;

  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(store, 'readwrite');
      transaction.objectStore(store).put(value, key);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Deletes a value from a store.
 *
 * @param {string} store
 * @param {IDBValidKey} key
 * @returns {Promise<boolean>}
 */
export async function deleteStored(store, key) {
  const database = await openStorage();
  if (!database) return false;

  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(store, 'readwrite');
      transaction.objectStore(store).delete(key);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Reads every value in a store.
 *
 * @param {string} store
 * @returns {Promise<unknown[]>}
 */
export async function readAllStored(store) {
  const database = await openStorage();
  if (!database) return [];

  return new Promise((resolve) => {
    try {
      const request = database.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Clears one store.
 *
 * @param {string} store
 * @returns {Promise<boolean>}
 */
export async function clearStored(store) {
  const database = await openStorage();
  if (!database) return false;

  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(store, 'readwrite');
      transaction.objectStore(store).clear();
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
