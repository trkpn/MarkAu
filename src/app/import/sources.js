/**
 * ============================================================================
 * URL SOURCES
 * Works out what a URL points at, so the importer knows how to read it.
 *
 * There are two kinds of source:
 *
 *   • Markdown sources — a repository README, a document, a model card. The
 *     content is already Markdown, so it is taken as it is. This is the good
 *     path: nothing is guessed and nothing is lost.
 *   • Web pages — an article. The HTML has to be reduced to its main content
 *     and converted, which is what a reader mode does.
 *
 * Everything in this module is pure. It decides what a URL is; it never
 * fetches anything. That keeps the decision making testable and keeps the
 * network out of it.
 * ============================================================================
 */

/** The kinds of source the importer understands. */
export const SOURCE = {
  GITHUB_REPO: 'github-repo',
  GITHUB_FILE: 'github-file',
  HF_MODEL: 'hf-model',
  HF_DATASET: 'hf-dataset',
  HF_SPACE: 'hf-space',
  RAW_MARKDOWN: 'raw-markdown',
  YOUTUBE_VIDEO: 'youtube-video',
  YOUTUBE_PLAYLIST: 'youtube-playlist',
  SUBSTACK_POST: 'substack-post',
  REDDIT_THREAD: 'reddit-thread',
  REDDIT_SUBREDDIT: 'reddit-subreddit',
  ARXIV_PAPER: 'arxiv-paper',
  PDF_DOCUMENT: 'pdf-document',
  EPUB_BOOK: 'epub-book',
  DOCX_DOCUMENT: 'docx-document',
  WEB_PAGE: 'web-page'
};

/**
 * GitHub paths that look like an owner but are not one. A URL like
 * `github.com/topics/markdown` is a listing, not a repository.
 */
const GITHUB_RESERVED = new Set([
  'about',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'enterprise',
  'events',
  'explore',
  'features',
  'join',
  'login',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'pricing',
  'readme',
  'search',
  'security',
  'settings',
  'site',
  'sponsors',
  'stars',
  'topics',
  'users'
]);

/**
 * Hugging Face paths that are not model repositories.
 */
const HF_RESERVED = new Set([
  'about',
  'chat',
  'collections',
  'docs',
  'enterprise',
  'join',
  'learn',
  'login',
  'organizations',
  'papers',
  'pricing',
  'settings',
  'tasks',
  'teams'
]);

/** A file that is already Markdown (or plain text). */
const MARKDOWN_FILE = /\.(md|markdown|mdown|txt|text)$/i;

/**
 * Decodes a path segment without letting a malformed escape break the import.
 * @param {string} segment
 * @returns {string}
 */
function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Turns what the user typed into a URL.
 *
 * A missing scheme is not an error — `github.com/user/repo` is what people
 * actually type.
 *
 * @param {string} input
 * @returns {URL|null} null when the text cannot be a web address
 */
export function normalizeUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

/**
 * Tells which kind of document an address names, from its extension.
 *
 * @param {string} pathname
 * @returns {{ type: string, label: string }|null}
 */
function documentKind(pathname) {
  if (/\.pdf$/i.test(pathname)) return { type: SOURCE.PDF_DOCUMENT, label: 'PDF document' };
  if (/\.epub$/i.test(pathname)) return { type: SOURCE.EPUB_BOOK, label: 'EPUB book' };
  if (/\.docx$/i.test(pathname)) return { type: SOURCE.DOCX_DOCUMENT, label: 'Word document' };
  return null;
}

/**
 * Decides what a URL is.
 *
 * @param {string} input the URL as the user typed it
 * @returns {{
 *   type: string,
 *   label: string,
 *   url: string,
 *   owner?: string,
 *   repo?: string,
 *   ref?: string,
 *   path?: string,
 *   repoType?: string,
 *   id?: string
 * }|null} null when the URL is not usable
 */
export function detectSource(input) {
  const url = normalizeUrl(input);
  if (!url) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean).map(safeDecode);

  /* ------------------------------------------------------------- GitHub */
  if (host === 'github.com') {
    const [owner, repo, kind, ...rest] = segments;

    if (!owner || !repo || GITHUB_RESERVED.has(owner.toLowerCase())) {
      return webPage(url);
    }

    // A file inside the repository — the raw file is the content.
    if (kind === 'blob' && rest.length > 0) {
      const [ref, ...pathParts] = rest;
      const path = pathParts.join('/');
      const file = documentKind(path);

      // A PDF, a book or a Word document is read as bytes, from the raw
      // host; the page of the repository is not the document itself.
      if (file) {
        return {
          ...file,
          url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref || 'HEAD'}/${path}`
        };
      }

      return {
        type: SOURCE.GITHUB_FILE,
        label: 'GitHub file',
        url: url.href,
        owner,
        repo,
        ref: ref || 'HEAD',
        path
      };
    }

    // A repository — its README is the entry point.
    return {
      type: SOURCE.GITHUB_REPO,
      label: 'GitHub repository',
      url: url.href,
      owner,
      repo: repo.replace(/\.git$/, '')
    };
  }

  /* ------------------------------------------------------- Hugging Face */
  if (host === 'huggingface.co') {
    const [head, ...tail] = segments;
    if (!head) return webPage(url);

    // A resolve address serves the file itself, not the page of the
    // repository: a PDF, a book or a Word document is taken from there.
    const file = segments.includes('resolve') ? documentKind(url.pathname) : null;
    if (file) return { ...file, url: url.href };

    const lowerHead = head.toLowerCase();

    if (lowerHead === 'datasets' || lowerHead === 'spaces') {
      const id = tail[0];
      if (!id) return webPage(url);
      return {
        type: lowerHead === 'datasets' ? SOURCE.HF_DATASET : SOURCE.HF_SPACE,
        label: lowerHead === 'datasets' ? 'Hugging Face dataset' : 'Hugging Face Space',
        url: url.href,
        repoType: lowerHead,
        id
      };
    }

    if (HF_RESERVED.has(lowerHead)) return webPage(url);

    // A model repository is written as owner/name — sometimes the owner is
    // left out and only the name is given.
    return {
      type: SOURCE.HF_MODEL,
      label: 'Hugging Face model',
      url: url.href,
      repoType: 'models',
      id: segments.slice(0, 2).join('/')
    };
  }

  /* ------------------------------------------------------- Markdown file */
  if (MARKDOWN_FILE.test(url.pathname)) {
    return {
      type: SOURCE.RAW_MARKDOWN,
      label: 'Markdown file',
      url: url.href
    };
  }

  /* ------------------------------------------- PDF, books and Word files */
  const file = documentKind(url.pathname);
  if (file) return { ...file, url: url.href };

  /* ----------------------------------------------------------- YouTube */
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
    return youtube(url, host, segments);
  }

  /* ---------------------------------------------------------- Substack */
  if (host === 'substack.com' || host.endsWith('.substack.com')) {
    // The home page of a publication is not a post — it stays a page.
    if (segments.length === 0) return webPage(url);

    return {
      type: SOURCE.SUBSTACK_POST,
      label: 'Substack post',
      url: url.href,
      publication: host.replace(/^www\./, ''),
      slug: segments[segments.length - 1]
    };
  }

  /* ------------------------------------------------------------- arXiv */
  if (host === 'arxiv.org' || host === 'export.arxiv.org' || host === 'www.arxiv.org') {
    // The paper is written in the address: /abs/<id>, /pdf/<id> or
    // /html/<id>. The version may be written down as well.
    const [kind, rawId] = segments;

    if ((kind === 'abs' || kind === 'pdf' || kind === 'html' || kind === 'format') && rawId) {
      const id = rawId.replace(/v\d+$/, '');

      return {
        type: SOURCE.ARXIV_PAPER,
        label: 'arXiv paper',
        url: url.href,
        paperId: id,
        version: rawId.match(/v(\d+)$/)?.[1] || ''
      };
    }
  }

  /* ----------------------------------------------------------- Reddit */
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    const [, subreddit, kind, id] = segments;

    if (kind === 'comments' && subreddit && id) {
      return {
        type: SOURCE.REDDIT_THREAD,
        label: 'Reddit thread',
        url: url.href,
        subreddit,
        id,
        slug: segments[4] || ''
      };
    }

    // A subreddit — the list of its latest posts.
    if (subreddit && segments.length === 2) {
      return {
        type: SOURCE.REDDIT_SUBREDDIT,
        label: 'Reddit subreddit',
        url: url.href,
        subreddit
      };
    }
  }

  return webPage(url);
}

/**
 * Works out what a YouTube address points at.
 *
 * @param {URL} url
 * @param {string} host
 * @param {string[]} segments the path of the address
 * @returns {object}
 */
function youtube(url, host, segments) {
  // A short link: youtu.be/<id>
  if (host === 'youtu.be') {
    const id = segments[0];
    if (!id) return webPage(url);
    return {
      type: SOURCE.YOUTUBE_VIDEO,
      label: 'YouTube video',
      url: url.href,
      videoId: id
    };
  }

  // A playlist: youtube.com/playlist?list=<id>
  const list = url.searchParams.get('list');
  if (list && (segments.length === 0 || segments[0] === 'playlist')) {
    return {
      type: SOURCE.YOUTUBE_PLAYLIST,
      label: 'YouTube playlist',
      url: url.href,
      listId: list
    };
  }

  // A video: ?v=<id>, or one of the paths that hold the id.
  const fromQuery = url.searchParams.get('v');
  if (fromQuery) {
    return {
      type: SOURCE.YOUTUBE_VIDEO,
      label: 'YouTube video',
      url: url.href,
      videoId: fromQuery
    };
  }

  const [kind, id] = segments;
  if (['shorts', 'embed', 'live', 'v'].includes(kind) && id) {
    return {
      type: SOURCE.YOUTUBE_VIDEO,
      label: 'YouTube video',
      url: url.href,
      videoId: id
    };
  }

  return webPage(url);
}

/**
 * The fallback: a page that has to be read.
 * @param {URL} url
 */
function webPage(url) {
  return {
    type: SOURCE.WEB_PAGE,
    label: 'Web page',
    url: url.href
  };
}

/**
 * Decodes the base64 payload the GitHub API returns for a file.
 *
 * @param {string} base64
 * @returns {string}
 */
export function decodeBase64Utf8(base64) {
  const cleaned = String(base64 || '').replace(/\s/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}
