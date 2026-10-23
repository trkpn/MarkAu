/**
 * ============================================================================
 * ZIP ARCHIVES
 * ============================================================================
 * EPUB and DOCX are both zip archives. Decompressing a whole book with the
 * synchronous reader blocks the page for as long as the archive takes; the
 * asynchronous reader hands each entry back through the event loop instead.
 * ============================================================================
 */

/** The library, loaded once. */
let fflatePromise = null;

/**
 * Loads fflate.
 * @returns {Promise<object>}
 */
function loadFflate() {
  if (!fflatePromise) {
    fflatePromise = import('fflate').then((module) => module);
  }

  return fflatePromise;
}

/**
 * Opens a zip archive without blocking the main thread.
 *
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Record<string, Uint8Array>>}
 */
export async function unzipAsync(bytes, { signal } = {}) {
  if (signal?.aborted) {
    const error = new Error('The work was stopped.');
    error.name = 'AbortError';
    throw error;
  }

  const fflate = await loadFflate();

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err, files) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);

      if (err) reject(err);
      else resolve(files || {});
    };

    const onAbort = () => {
      const error = new Error('The work was stopped.');
      error.name = 'AbortError';
      finish(error);
    };

    signal?.addEventListener?.('abort', onAbort, { once: true });

    try {
      fflate.unzip(bytes, {}, finish);
    } catch (err) {
      finish(err);
    }
  });
}
