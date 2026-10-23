/**
 * ============================================================================
 * SUBSTACK
 * Turns a post into a document.
 *
 * A Substack post is an article, so the general reader would do most of the
 * work. But the page knows exactly where the post is — and it knows where
 * the paywall begins. Reading that part directly is both more accurate and
 * more honest: a post for subscribers is cut short, and the document has to
 * say so instead of pretending it is the whole thing.
 * ============================================================================
 */

/** The elements that hold the paywall of a post. */
const PAYWALL_SELECTOR = [
  '.paywall',
  '.paywall-title',
  '[data-testid="paywall"]',
  '.paywall-banner',
  '.subscription-widget-wrap',
  '.post-footer-paywall',
  '[data-paywall]'
].join(', ');

/** The words a post for subscribers carries. */
const PAYWALL_WORDS = /This post is for (paid|paying) subscribers/i;

/**
 * Tells whether a page is a post of a Substack publication.
 *
 * The address of a publication is not always a `substack.com` one — most
 * of them have a domain of their own. So the page itself has to answer:
 * the box that holds the post and the title of the post are Substack's
 * own marks, and the number of the publication is in the data of the page.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function looksLikeSubstack(html) {
  if (!html) return false;

  const hasBody = /class="[^"]*\bavailable-content\b/.test(html);
  const hasTitle = /class="[^"]*\bpost-title\b/.test(html);
  const hasPublication = /"publication_id"\s*:\s*"?\d+/.test(html);

  return hasBody && (hasTitle || hasPublication);
}

/**
 * Reads a post out of the page.
 *
 * @param {string} html the HTML of the post
 * @param {string} pageUrl the address the HTML came from
 * @returns {{
 *   title: string,
 *   publication: string,
 *   author: string,
 *   published: string,
 *   bodyHtml: string,
 *   paywalled: boolean
 * }|null}
 */
export function parseSubstackPost(html, pageUrl) {
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  const content =
    doc.querySelector('.available-content') ||
    doc.querySelector('.body.markup') ||
    doc.querySelector('article .markup') ||
    doc.querySelector('article');

  if (!content) return null;

  // The paywall of a post for subscribers is an element of the page, so it
  // is looked for as one. Looking for the word itself would be wrong: the
  // word is in the script of the page as well, and a post that is open to
  // everyone would be taken for one that is not.
  const wall = doc.querySelector(PAYWALL_SELECTOR);
  const paywalled = Boolean(wall) || PAYWALL_WORDS.test(content.textContent || '');

  if (wall) wall.remove();

  const title =
    doc.querySelector('h1.post-title')?.textContent?.trim() ||
    doc.querySelector('article h1')?.textContent?.trim() ||
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    '';

  const publication =
    doc.querySelector('.publication-name')?.textContent?.trim() ||
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
    hostOf(pageUrl);

  const author =
    doc.querySelector('.byline-names')?.textContent?.trim() ||
    doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
    '';

  const published =
    doc.querySelector('time[datetime]')?.getAttribute('datetime') ||
    doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
    html.match(/"publish_date"\s*:\s*"([^"]+)"/)?.[1] ||
    '';

  return {
    title,
    publication,
    author,
    published,
    bodyHtml: content.innerHTML,
    paywalled
  };
}

/**
 * Builds the document of a post.
 *
 * @param {object} post the parsed post
 * @param {string} bodyMarkdown the body of the post, already converted
 * @returns {string}
 */
export function buildSubstackDocument(post, bodyMarkdown) {
  const lines = [];

  if (post.title) {
    lines.push(`# ${post.title}`);
    lines.push('');
  }

  const facts = [];
  if (post.publication) facts.push(`**Publication:** ${post.publication}`);
  if (post.author) facts.push(`**By:** ${post.author}`);
  if (post.published) facts.push(`**Published:** ${post.published.slice(0, 10)}`);

  if (facts.length > 0) {
    lines.push(facts.join('  \n'));
    lines.push('');
  }

  if (bodyMarkdown) {
    lines.push(bodyMarkdown);
    lines.push('');
  }

  if (post.paywalled) {
    lines.push('---');
    lines.push('');
    lines.push(
      '_This post is for subscribers. The part that is open to everyone is shown above; the rest could not be read._'
    );
  }

  return lines.join('\n').trim();
}

/**
 * The host of an address, without the leading www.
 * @param {string} url
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
