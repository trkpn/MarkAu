/**
 * ============================================================================
 * EPUB
 * Turns a book into a document.
 *
 * An EPUB is a small bundle: a zip file that holds the text of the book
 * as a pile of HTML pages, a file that says what the book is called, and
 * a list of the order the pages are read in.
 *
 * All of that is read here, and the pages are turned into Markdown with
 * the same converter the web pages use. A book becomes one document.
 *
 * The zip is opened in the browser — the book never goes anywhere else.
 * ============================================================================
 */

import { unzipAsync } from '@/importers/zip.js';
import { reportProgress, throwIfAborted, yieldToMainThread } from '@/core/schedule.js';

/**
 * Opens a zip file.
 *
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Record<string, Uint8Array>>} the files, by name
 */
export async function unzip(bytes, options = {}) {
  return unzipAsync(bytes, options);
}

/**
 * Turns bytes into text.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeText(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Reads the list of the files of a book.
 *
 * The list of the pages is in the file that says what the book is (the
 * OPF). That file is found through another small file, the container.
 *
 * @param {Record<string, Uint8Array>} files
 * @returns {{
 *   opfPath: string,
 *   title: string,
 *   author: string,
 *   language: string,
 *   chapters: string[]
 * }|null}
 */
export function readBookManifest(files) {
  const container = files['META-INF/container.xml'];
  if (!container) return null;

  const containerText = decodeText(container);
  const opfPath = containerText.match(/full-path\s*=\s*"([^"]+)"/)?.[1];
  if (!opfPath || !files[opfPath]) return null;

  const opf = decodeText(files[opfPath]);
  const doc = new DOMParser().parseFromString(opf, 'text/xml');

  const title =
    doc.querySelector('metadata > title, title')?.textContent?.trim() ||
    doc.querySelector('metadata title')?.textContent?.trim() ||
    '';

  const author = doc.querySelector('metadata > creator, creator')?.textContent?.trim() || '';

  const language = doc.querySelector('metadata > language, language')?.textContent?.trim() || '';

  // The spine is the order of the pages.
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const chapters = Array.from(doc.querySelectorAll('spine > itemref'))
    .map((item) => item.getAttribute('idref'))
    .filter(Boolean)
    .map((id) => {
      const href = doc.querySelector(`manifest > item[id="${id}"]`)?.getAttribute('href');
      if (!href) return null;

      try {
        return decodeURIComponent(
          new URL(href, `https://epub.invalid/${base}`).pathname.replace(/^\/+/, '')
        );
      } catch {
        return base + href;
      }
    })
    .filter(Boolean);

  return { opfPath, title, author, language, chapters };
}

/**
 * Resolves one chapter against the address of the book.
 *
 * @param {string} chapter the path inside the archive
 * @param {string} bookUrl where the book came from
 * @returns {string}
 */
function chapterUrl(chapter, bookUrl) {
  const base = String(bookUrl || '').trim();
  if (!base || !/^https?:\/\//i.test(base)) return chapter;

  try {
    return new URL(chapter, base).href;
  } catch {
    return chapter;
  }
}

/**
 * Turns a book into a document.
 *
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {string} [options.url] where the book came from
 * @param {(html: string, baseUrl: string) => Promise<string>} options.toMarkdown
 *   the converter for a page of the book
 * @param {(progress: { phase: string, done: number, total: number }) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ markdown: string, title: string, chapters: number }>}
 */
export async function epubToMarkdown(
  bytes,
  { url = '', toMarkdown, onProgress, signal } = {}
) {
  reportProgress(onProgress, { phase: 'unpacking', done: 0, total: 1 });
  const files = await unzip(bytes, { signal });
  throwIfAborted(signal);

  const manifest = readBookManifest(files);

  if (!manifest) {
    throw new Error('That file is not a book in EPUB form.');
  }

  const lines = [];
  const title = manifest.title || 'Book';
  lines.push(`# ${title}`);
  lines.push('');

  const facts = [];
  if (manifest.author) facts.push(`**Author:** ${manifest.author}`);
  if (manifest.chapters.length) facts.push(`**Chapters:** ${manifest.chapters.length}`);
  if (url) facts.push(`**Source:** ${url}`);
  if (facts.length > 0) {
    lines.push(facts.join('  \n'));
    lines.push('');
  }

  let written = 0;
  const total = manifest.chapters.length;

  reportProgress(onProgress, { phase: 'converting', done: 0, total });

  for (const path of manifest.chapters) {
    throwIfAborted(signal);

    const file = files[path];
    if (!file) continue;

    const html = decodeText(file);
    const markdown = toMarkdown
      ? await toMarkdown(html, chapterUrl(path, url))
      : html;
    if (!markdown || !markdown.trim()) continue;

    lines.push(markdown);
    lines.push('');
    written += 1;

    reportProgress(onProgress, { phase: 'converting', done: written, total });
    await yieldToMainThread();
  }

  throwIfAborted(signal);

  return {
    markdown: lines.join('\n').trim(),
    title,
    chapters: written
  };
}

/**
 * Builds the document of a book.
 *
 * @param {{ markdown: string, title: string, chapters: number }} book
 * @returns {string}
 */
export function buildEpubDocument(book) {
  return book.markdown;
}
