/**
 * @vitest-environment jsdom
 *
 * A Word document is a zip of XML parts. The reader opens the parts and
 * writes the words out as Markdown: headings, emphasis, links, lists and
 * tables.
 */
import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';

const { detectSource, SOURCE } = await import('@/app/import/sources.js');
const { docxToMarkdown, readStyles, readNumbering } = await import('@/importers/docx.js');
const { isDocumentFile } = await import('@/app/import/document-file.js');

const NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function paragraph(content, properties = '') {
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${content}</w:p>`;
}

function run(text, properties = '') {
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function listItem(text, numId, level = 0) {
  return paragraph(
    run(text),
    `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`
  );
}

function buildDocx() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NAMESPACE}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraph(run('My Report'), '<w:pStyle w:val="Title"/>')}
    ${paragraph(run('Introduction'), '<w:pStyle w:val="Heading1"/>')}
    ${paragraph(
      `${run('Bold', '<w:b/>')}${run(' and ')}${run('italic', '<w:i/>')}${run(' ')}<w:hyperlink r:id="rId5">${run('link')}</w:hyperlink>`
    )}
    ${listItem('First', 1)}
    ${listItem('Second', 1)}
    ${listItem('Ordered', 2)}
    <w:tbl>
      <w:tr>
        <w:tc>${paragraph(run('Name'))}</w:tc>
        <w:tc>${paragraph(run('Age'))}</w:tc>
      </w:tr>
      <w:tr>
        <w:tc>${paragraph(run('Ada'))}</w:tc>
        <w:tc>${paragraph(run('36'))}</w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="${NAMESPACE}">
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="${NAMESPACE}">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;

  const relationshipsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${RELATIONSHIPS}">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`;

  const coreXml = `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>My Report</dc:title>
  <dc:creator>Jane Doe</dc:creator>
</cp:coreProperties>`;

  const encoder = new TextEncoder();

  return zipSync({
    '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types/>'),
    'word/document.xml': encoder.encode(documentXml),
    'word/styles.xml': encoder.encode(stylesXml),
    'word/numbering.xml': encoder.encode(numberingXml),
    'word/_rels/document.xml.rels': encoder.encode(relationshipsXml),
    'docProps/core.xml': encoder.encode(coreXml)
  });
}

function buildDocxWith(body, { styles = '', numbering = '', relationships = '', core = '' } = {}) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NAMESPACE}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`;

  const encoder = new TextEncoder();
  const files = {
    '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types/>'),
    'word/document.xml': encoder.encode(documentXml)
  };

  if (styles) files['word/styles.xml'] = encoder.encode(styles);
  if (numbering) files['word/numbering.xml'] = encoder.encode(numbering);
  if (relationships) files['word/_rels/document.xml.rels'] = encoder.encode(relationships);
  if (core) files['docProps/core.xml'] = encoder.encode(core);

  return zipSync(files);
}

describe('seeing a Word document', () => {
  it('sees the file from its address', () => {
    const source = detectSource('https://example.com/files/report.docx');

    expect(source.type).toBe(SOURCE.DOCX_DOCUMENT);
  });

  it('sees a file in a repository from its raw address', () => {
    const source = detectSource('https://github.com/owner/repo/blob/main/files/report.docx');

    expect(source.type).toBe(SOURCE.DOCX_DOCUMENT);
    expect(source.url).toBe(
      'https://raw.githubusercontent.com/owner/repo/main/files/report.docx'
    );
  });

  it('sees a file on Hugging Face from its resolve address', () => {
    const source = detectSource('https://huggingface.co/owner/repo/resolve/main/report.docx');

    expect(source.type).toBe(SOURCE.DOCX_DOCUMENT);
    expect(source.url).toBe('https://huggingface.co/owner/repo/resolve/main/report.docx');
  });

  it('sees the file when it is dropped', () => {
    expect(isDocumentFile({ name: 'report.docx', type: '' })).toBe(true);
    expect(
      isDocumentFile({
        name: 'report',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })
    ).toBe(true);
    expect(isDocumentFile({ name: 'report.doc', type: 'application/msword' })).toBe(false);
  });
});

describe('reading a Word document', () => {
  it('reads the styles and the numbering of the lists', () => {
    const encoder = new TextEncoder();
    const styles = readStyles({
      'word/styles.xml': encoder.encode(
        `<w:styles xmlns:w="${NAMESPACE}"><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`
      )
    });
    const numbering = readNumbering({
      'word/numbering.xml': encoder.encode(
        `<w:numbering xmlns:w="${NAMESPACE}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
      )
    });

    expect(styles.get('Heading2').name).toBe('heading 2');
    expect(numbering.get('1').get(0).ordered).toBe(false);
  });

  it('turns the document into Markdown', async () => {
    const docx = await docxToMarkdown(buildDocx(), { url: 'report.docx' });

    expect(docx.title).toBe('My Report');
    expect(docx.markdown).toContain('# My Report');
    expect(docx.markdown.match(/# My Report/g)).toHaveLength(1);
    expect(docx.markdown).toContain('**Author:** Jane Doe');
    expect(docx.markdown).toContain('# Introduction');
    expect(docx.markdown).toContain('**Bold** and _italic_ [link](https://example.com)');
    expect(docx.markdown).toContain('- First\n- Second');
    expect(docx.markdown).toContain('1. Ordered');
    expect(docx.markdown).toContain('| Name | Age |');
    expect(docx.markdown).toContain('| Ada | 36 |');
    expect(docx.paragraphs).toBeGreaterThan(0);
  });

  it('imports the document from an address', async () => {
    const original = globalThis.fetch;

    globalThis.fetch = async () =>
      new Response(buildDocx(), {
        status: 200,
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
      });

    try {
      const { importFromUrl } = await import('@/app/import/url-import.js');
      const result = await importFromUrl('https://example.com/files/report.docx');

      expect(result.title).toBe('My Report');
      expect(result.markdown).toContain('# My Report');
      expect(result.note).toContain('Word document');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('says so when the file is not a Word document', async () => {
    await expect(docxToMarkdown(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

describe('the details of a Word document', () => {
  it('escapes paragraphs that begin like a list', async () => {
    const body = `${paragraph(run('1. First'))}${paragraph(run('2024. Second'))}`;
    const docx = await docxToMarkdown(buildDocxWith(body), { url: 'report.docx' });

    expect(docx.markdown).toContain('1\\. First');
    expect(docx.markdown).toContain('2024\\. Second');
    expect(docx.markdown).not.toContain('\\1.');
  });

  it('treats outline level nine as body text', async () => {
    const styles = `<w:styles xmlns:w="${NAMESPACE}"><w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style></w:styles>`;
    const body = `${paragraph(run('Styled body.'), '<w:pStyle w:val="BodyText"/>')}${paragraph(run('Direct body.'), '<w:outlineLvl w:val="9"/>')}`;
    const docx = await docxToMarkdown(buildDocxWith(body, { styles }), { url: 'report.docx' });

    expect(docx.markdown).toContain('Styled body.');
    expect(docx.markdown).toContain('Direct body.');
    expect(docx.markdown).not.toMatch(/^#{1,6} (Styled|Direct) body\.$/m);
  });

  it('keeps a numbered heading a heading', async () => {
    const styles = `<w:styles xmlns:w="${NAMESPACE}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr></w:style></w:styles>`;
    const numbering = `<w:numbering xmlns:w="${NAMESPACE}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const body = `${paragraph(run('Introduction'), '<w:pStyle w:val="Heading1"/>')}${paragraph(run('Body.'))}`;
    const docx = await docxToMarkdown(buildDocxWith(body, { styles, numbering }), {
      url: 'report.docx'
    });

    expect(docx.markdown).toContain('# Introduction');
    expect(docx.markdown).not.toContain('1. Introduction');
  });

  it('escapes dollars and tildes that Markdown would read', async () => {
    const docx = await docxToMarkdown(
      buildDocxWith(paragraph(run('It costs $5 and $10, not ~~old~~.'))),
      { url: 'report.docx' }
    );

    expect(docx.markdown).toContain('It costs \\$5 and \\$10, not \\~\\~old\\~\\~.');
  });

  it('escapes ampersands and lines that Markdown would read as a rule', async () => {
    const body = `${paragraph(run('A &amp; B'))}${paragraph(run('---'))}`;
    const docx = await docxToMarkdown(buildDocxWith(body), { url: 'report.docx' });

    expect(docx.markdown).toContain('A &amp; B');
    expect(docx.markdown).toContain('\\---');
  });

  it('keeps a line break inside a paragraph', async () => {
    const body = '<w:p><w:r><w:t>line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>';
    const docx = await docxToMarkdown(buildDocxWith(body), { url: 'report.docx' });

    expect(docx.markdown).toContain('line one  \nline two');
  });

  it('keeps a line break inside a table cell on one row', async () => {
    const body =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const docx = await docxToMarkdown(buildDocxWith(body), { url: 'report.docx' });

    expect(docx.markdown).toContain('| line one<br>line two |');
  });

  it('does not add a second title when the document begins with a heading', async () => {
    const styles = `<w:styles xmlns:w="${NAMESPACE}"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`;
    const core = `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Other Title</dc:title>
</cp:coreProperties>`;
    const body = `${paragraph(run('Doc Title'), '<w:pStyle w:val="Title"/>')}${paragraph(run('Body.'))}`;
    const docx = await docxToMarkdown(buildDocxWith(body, { styles, core }), {
      url: 'report.docx'
    });

    expect(docx.markdown.match(/^# /gm)).toHaveLength(1);
    expect(docx.markdown).toContain('# Doc Title');
    expect(docx.markdown).not.toContain('# Other Title');
  });
});
