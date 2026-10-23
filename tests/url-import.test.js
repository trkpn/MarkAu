/**
 * @vitest-environment jsdom
 *
 * The importer has to recognise what a URL points at, and it has to turn a
 * page into Markdown that keeps the things a reader needs: the headings,
 * the links, the code, the tables — and none of the navigation.
 */
import { describe, it, expect } from 'vitest';

const { detectSource, normalizeUrl, decodeBase64Utf8, SOURCE } =
  await import('../src/app/url-sources.js');
const { htmlToMarkdown, resolveUrl } = await import('../src/html-to-markdown.js');
const { buildDocument, isTextual, stripReaderHeader } = await import('../src/app/url-import.js');

describe('reading an address', () => {
  it('accepts an address without a scheme', () => {
    expect(normalizeUrl('github.com/owner/repo')?.href).toBe('https://github.com/owner/repo');
  });

  it('refuses something that is not an address', () => {
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });

  it('refuses a scheme that is not http', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('knowing the source', () => {
  it('sees a GitHub repository', () => {
    const source = detectSource('https://github.com/owner/repository');

    expect(source.type).toBe(SOURCE.GITHUB_REPO);
    expect(source.owner).toBe('owner');
    expect(source.repo).toBe('repository');
  });

  it('sees a file inside a GitHub repository', () => {
    const source = detectSource('https://github.com/owner/repository/blob/main/docs/guide.md');

    expect(source.type).toBe(SOURCE.GITHUB_FILE);
    expect(source.ref).toBe('main');
    expect(source.path).toBe('docs/guide.md');
  });

  it('does not mistake a GitHub listing for a repository', () => {
    expect(detectSource('https://github.com/topics/markdown')?.type).toBe(SOURCE.WEB_PAGE);
    expect(detectSource('https://github.com/settings/profile')?.type).toBe(SOURCE.WEB_PAGE);
  });

  it('sees a Hugging Face model', () => {
    const source = detectSource('https://huggingface.co/some-org/some-model');

    expect(source.type).toBe(SOURCE.HF_MODEL);
    expect(source.id).toBe('some-org/some-model');
  });

  it('sees a Hugging Face dataset and a Space', () => {
    expect(detectSource('https://huggingface.co/datasets/some-org/some-set')?.type).toBe(
      SOURCE.HF_DATASET
    );
    expect(detectSource('https://huggingface.co/spaces/some-org/some-space')?.type).toBe(
      SOURCE.HF_SPACE
    );
  });

  it('sees a Markdown file', () => {
    expect(detectSource('https://example.com/notes/readme.md')?.type).toBe(SOURCE.RAW_MARKDOWN);
    expect(detectSource('https://example.com/notes/readme.MARKDOWN')?.type).toBe(
      SOURCE.RAW_MARKDOWN
    );
  });

  it('sees anything else as a page to read', () => {
    expect(detectSource('https://example.com/some/article')?.type).toBe(SOURCE.WEB_PAGE);
  });

  it('sees a YouTube video', () => {
    expect(detectSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.videoId).toBe(
      'dQw4w9WgXcQ'
    );
    expect(detectSource('https://youtu.be/dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ');
    expect(detectSource('https://www.youtube.com/shorts/abc123')?.videoId).toBe('abc123');
    expect(detectSource('https://www.youtube.com/embed/abc123')?.videoId).toBe('abc123');
    expect(detectSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.type).toBe(
      SOURCE.YOUTUBE_VIDEO
    );
  });

  it('sees a YouTube playlist', () => {
    const source = detectSource('https://www.youtube.com/playlist?list=PL123');

    expect(source.type).toBe(SOURCE.YOUTUBE_PLAYLIST);
    expect(source.listId).toBe('PL123');
  });

  it('sees a Substack post', () => {
    const source = detectSource('https://blog.example.substack.com/p/some-post');

    expect(source.type).toBe(SOURCE.SUBSTACK_POST);
    expect(source.publication).toBe('blog.example.substack.com');
  });

  it('leaves the home page of a publication as a page', () => {
    expect(detectSource('https://blog.example.substack.com/')?.type).toBe(SOURCE.WEB_PAGE);
  });

  it('sees a Reddit thread', () => {
    const source = detectSource('https://www.reddit.com/r/programming/comments/abc123/a_post/');

    expect(source.type).toBe(SOURCE.REDDIT_THREAD);
    expect(source.subreddit).toBe('programming');
    expect(source.id).toBe('abc123');
  });
});

describe('decoding what GitHub sends', () => {
  it('turns the base64 payload into the text of the file', () => {
    const text = '# Title\n\nSome text with Thai: สวัสดี';
    const encoded = Buffer.from(text, 'utf8').toString('base64');

    expect(decodeBase64Utf8(encoded)).toBe(text);
  });

  it('survives the line breaks GitHub puts in the payload', () => {
    const encoded = Buffer.from('hello', 'utf8').toString('base64');
    const broken = encoded.replace(/(.{4})/g, '$1\n');

    expect(decodeBase64Utf8(broken)).toBe('hello');
  });
});

describe('resolving links', () => {
  it('makes a relative link absolute', () => {
    expect(resolveUrl('/about', 'https://example.com/post/1')).toBe('https://example.com/about');
    expect(resolveUrl('other', 'https://example.com/post/1')).toBe(
      'https://example.com/post/other'
    );
  });

  it('leaves an absolute link alone', () => {
    expect(resolveUrl('https://other.example/x', 'https://example.com/')).toBe(
      'https://other.example/x'
    );
  });
});

describe('putting the document together', () => {
  it('knows what can be read and what cannot', () => {
    expect(isTextual('text/html; charset=utf-8')).toBe(true);
    expect(isTextual('application/xhtml+xml')).toBe(true);
    expect(isTextual('application/xml')).toBe(true);
    expect(isTextual('')).toBe(true);

    expect(isTextual('application/pdf')).toBe(false);
    expect(isTextual('image/png')).toBe(false);
    expect(isTextual('video/mp4')).toBe(false);
    expect(isTextual('application/zip')).toBe(false);
  });

  it('takes the header of the reader service off the answer', () => {
    const answer = `Title: The page

URL Source: https://example.com/page

Published Time: Jan 1, 2024

Markdown Content:
The text of the page.`;

    expect(stripReaderHeader(answer)).toBe('The text of the page.');
    expect(stripReaderHeader('Just the text.')).toBe('Just the text.');
  });

  it('writes a header that says where the document came from', () => {
    const document = buildDocument({
      markdown: '# The Article\n\nBody',
      title: 'The Article',
      sourceUrl: 'https://example.com/post'
    });

    expect(document).toContain('title: The Article');
    expect(document).toContain('source: https://example.com/post');
    expect(document).toContain('# The Article');
  });

  it('merges the header of the document into the one of the import', () => {
    const document = buildDocument({
      markdown: '---\nlanguage: en\nlicense: mit\n---\n\n# The Model Card',
      title: 'some-model',
      sourceUrl: 'https://huggingface.co/some-model'
    });

    expect(document).toContain('language: en');
    expect(document).toContain('license: mit');
    expect(document).toContain('title: some-model');

    // The block of the document must not be left inside the text.
    expect(document.match(/^---$/gm)).toHaveLength(2);
  });

  it('lets the document keep its own title', () => {
    const document = buildDocument({
      markdown: '---\ntitle: The Real Title\n---\n\nBody',
      title: 'some-model',
      sourceUrl: 'https://huggingface.co/some-model'
    });

    expect(document).toContain('title: The Real Title');
    expect(document).not.toContain('title: some-model');
  });
});

describe('turning a page into Markdown', () => {
  const page = `
    <!doctype html>
    <html>
      <head><title>The Article</title></head>
      <body>
        <nav><a href="/home">Home</a><a href="/about">About</a></nav>
        <header><h1 class="site-name">The News Site</h1></header>
        <main>
          <article>
            <h1>The Article</h1>
            <p>This is the opening paragraph of the article, and it is long enough for the
               reader to consider it a real piece of writing.</p>
            <p>A second paragraph with a <a href="/other/story">link inside</a> and some
               <strong>bold words</strong> as well as <em>italic ones</em>.</p>
            <h2>A section</h2>
            <ul><li>first item</li><li>second item</li></ul>
            <pre><code class="language-js">const answer = 42;</code></pre>
            <table>
              <thead><tr><th>Name</th><th>Value</th></tr></thead>
              <tbody><tr><td>alpha</td><td>1</td></tr></tbody>
            </table>
            <figure>
              <img src="/images/photo.jpg" alt="A photo" />
              <figcaption>The caption</figcaption>
            </figure>
          </article>
        </main>
        <aside class="advert"><p>Buy something now, this is an advert.</p></aside>
        <footer><p>Copyright nobody</p></footer>
      </body>
    </html>
  `;

  it('keeps the heading of the article', async () => {
    const { markdown } = await htmlToMarkdown(page, 'https://news.example/post/1');

    expect(markdown).toContain('# The Article');
  });

  it('keeps the text of the article', async () => {
    const { markdown } = await htmlToMarkdown(page, 'https://news.example/post/1');

    expect(markdown).toContain('opening paragraph of the article');
  });

  it('makes a relative link absolute', async () => {
    const { markdown } = await htmlToMarkdown(page, 'https://news.example/post/1');

    expect(markdown).toContain('https://news.example/other/story');
  });

  it('keeps the code block with its language', async () => {
    const { markdown } = await htmlToMarkdown(page, 'https://news.example/post/1');

    expect(markdown).toContain('```js');
    expect(markdown).toContain('const answer = 42;');
  });

  it('keeps the table as a table', async () => {
    const { markdown } = await htmlToMarkdown(page, 'https://news.example/post/1');

    expect(markdown).toContain('| Name');
    expect(markdown).toContain('alpha');
  });

  it('makes the image absolute', async () => {
    const { markdown } = await htmlToMarkdown(page, 'https://news.example/post/1');

    expect(markdown).toContain('https://news.example/images/photo.jpg');
  });

  it('leaves the navigation and the adverts out', async () => {
    const { markdown } = await htmlToMarkdown(page, 'https://news.example/post/1');

    expect(markdown).not.toContain('Buy something now');
    expect(markdown).not.toContain('Copyright nobody');
  });

  it('does not run the scripts of the page', async () => {
    const { markdown } = await htmlToMarkdown(
      '<html><body><script>window.hacked = true</script><p>Text of the page that is long enough.</p></body></html>',
      'https://example.com/'
    );

    expect(markdown).not.toContain('hacked');
  });

  it('keeps a list inside a table cell from breaking the table', async () => {
    const { markdown } = await htmlToMarkdown(
      `<html><body><article>
         <p>A paragraph that is long enough for the reader to treat this as an article.</p>
         <table>
           <thead><tr><th>Field</th><th>Authors</th></tr></thead>
           <tbody><tr><td>Written by</td><td><ul><li>First</li><li>Second</li></ul></td></tr></tbody>
         </table>
       </article></body></html>`,
      'https://example.com/'
    );

    // The row has to stay one row: no marker of a list may end it, and no
    // line break may split it in two.
    const rows = markdown.split('\n').filter((line) => line.trim().startsWith('|'));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toBe('| Written by | First Second |');
  });
});
