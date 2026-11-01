import mammoth from 'mammoth';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';

interface ParsedDoc {
  rawText: string;
  valueHtml: string;
  paragraphs: string[];
}

interface ConvertOptions {
  onProgress?: (progress: number, message: string) => void;
}

interface ImageDimension {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Small shared helpers & Text Sanitizers
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Cleans broken glyphs, backtick Rupee symbols, and glued words from PDF-to-DOCX files
function sanitizeExtractedContent(input: string): string {
  return (
    input
      .replace(/[\uE000-\uF8FF]{2,}/g, (m) => '★'.repeat(m.length))
      .replace(/[\uE000-\uF8FF](?=\s*\d+\.\d+)/g, '★ ')
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/`\s*(?=\d)/g, '₹')
      .replace(/\(\s*`\s*\)/g, '(₹)')
      .replace(/@\s*`\s*(?=\d)/g, '@ ₹')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([.,;:!?])([A-Za-z])/g, '$1 $2')
  );
}

// ---------------------------------------------------------------------------
// 1. Accurate Native Image Sizing (extractDocxImageSizes)
// ---------------------------------------------------------------------------
async function extractDocxImageSizes(
  arrayBuffer: ArrayBuffer
): Promise<Array<ImageDimension | null>> {
  const sizes: Array<ImageDimension | null> = [];
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) return sizes;

    const drawingRegex = /<w:drawing\b[\s\S]*?<\/w:drawing>|<w:pict\b[\s\S]*?<\/w:pict>/g;
    let match: RegExpExecArray | null;

    while ((match = drawingRegex.exec(docXml)) !== null) {
      const block = match[0];
      if (!/r:(?:embed|id)="([^"]+)"/.test(block)) continue;

      let dim: ImageDimension | null = null;
      const extentMatch = block.match(/<wp:extent\b[^>]*?\bcx="(\d+)"[^>]*?\bcy="(\d+)"/);
      if (extentMatch) {
        const cx = parseInt(extentMatch[1], 10);
        const cy = parseInt(extentMatch[2], 10);
        if (cx > 0 && cy > 0) {
          dim = {
            width: Math.max(12, Math.round(cx / 9525)),
            height: Math.max(12, Math.round(cy / 9525)),
          };
        }
      }
      sizes.push(dim);
    }
  } catch {
    // Ignore XML errors and fall back gracefully
  }
  return sizes;
}

const MAMMOTH_STYLE_MAP = [
  "p[style-name='align-center'] => p.align-center:fresh",
  "p[style-name='align-right'] => p.align-right:fresh",
  "p[style-name='align-justify'] => p.align-justify:fresh",
];

function buildMammothOptions(imageSizes: Array<ImageDimension | null>): any {
  const transforms = (mammoth as any).transforms;
  let imgIdx = 0;

  const convertImage = mammoth.images.imgElement(async (image) => {
    const base64 = await image.read('base64');
    const dim = imageSizes[imgIdx++] || null;

    const attrs: {
      src: string;
      width?: string;
      height?: string;
      'data-docx-w'?: string;
      'data-docx-h'?: string;
    } = {
      src: `data:${image.contentType};base64,${base64}`,
    };

    if (dim) {
      const clampedW = Math.min(dim.width, 720);
      const scaledH = Math.max(1, Math.round((dim.height * clampedW) / dim.width));
      attrs.width = String(clampedW);
      attrs.height = String(scaledH);
      attrs['data-docx-w'] = String(clampedW);
      attrs['data-docx-h'] = String(scaledH);
    }
    return attrs;
  });

  if (!transforms || typeof transforms.paragraph !== 'function') {
    return { styleMap: MAMMOTH_STYLE_MAP, convertImage };
  }

  return {
    styleMap: MAMMOTH_STYLE_MAP,
    convertImage,
    transformDocument: transforms.paragraph((paragraph: any) => {
      const existing = String(paragraph.styleName || '').toLowerCase();
      if (existing && existing !== 'normal' && existing !== 'default') {
        return paragraph;
      }

      const alignment = paragraph.alignment;
      if (alignment === 'center') {
        return { ...paragraph, styleName: 'align-center' };
      }
      if (alignment === 'right' || alignment === 'end') {
        return { ...paragraph, styleName: 'align-right' };
      }
      if (alignment === 'both' || alignment === 'justify') {
        return { ...paragraph, styleName: 'align-justify' };
      }
      return paragraph;
    }),
  };
}

async function parseDocxFile(file: File): Promise<ParsedDoc> {
  const arrayBuffer = await file.arrayBuffer();
  const imageSizes = await extractDocxImageSizes(arrayBuffer);

  const textResult = await mammoth.extractRawText({ arrayBuffer });
  const rawText = sanitizeExtractedContent(textResult.value || '');
  const paragraphs = rawText
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  let htmlResult;
  try {
    htmlResult = await mammoth.convertToHtml(
      { arrayBuffer },
      buildMammothOptions(imageSizes)
    );
  } catch (error) {
    console.warn('Mammoth custom options failed, using defaults:', error);
    htmlResult = await mammoth.convertToHtml({ arrayBuffer });
  }
  const valueHtml = sanitizeExtractedContent(htmlResult.value || '');

  return { rawText, valueHtml, paragraphs };
}

// ---------------------------------------------------------------------------
// 4. Structured Plain Text & PowerPoint Exporters
// ---------------------------------------------------------------------------

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName;

  if (tag === 'BR') return '\n';
  if (tag === 'IMG' || tag === 'STYLE' || tag === 'SCRIPT') return '';

  return Array.from(el.childNodes).map(inlineText).join('');
}

function normalizeLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim();
}

function pushBlank(out: string[]): void {
  if (out.length > 0 && out[out.length - 1] !== '') {
    out.push('');
  }
}

function cellToText(cell: Element): string {
  const parts: string[] = [];
  cell.childNodes.forEach((child) => parts.push(inlineText(child)));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function tableToText(table: HTMLTableElement, out: string[]): void {
  pushBlank(out);
  Array.from(table.rows).forEach((row) => {
    const cells = Array.from(row.cells).map(cellToText);
    if (cells.some((c) => c.length > 0)) {
      out.push(cells.join('\t')); // Table cells separated by a TAB
    }
  });
  pushBlank(out);
}

function listToText(list: Element, out: string[], depth: number): void {
  const ordered = list.tagName === 'OL';
  let index = 1;

  Array.from(list.children).forEach((child) => {
    if (child.tagName !== 'LI') return;

    const parts: string[] = [];
    child.childNodes.forEach((node) => {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        ((node as Element).tagName === 'UL' || (node as Element).tagName === 'OL')
      ) {
        return;
      }
      parts.push(inlineText(node));
    });

    const text = normalizeLines(parts.join(' '));
    if (text) {
      const bullet = ordered ? `${index}. ` : '\u2022 '; // Keep bullet formatting
      out.push('  '.repeat(depth) + bullet + text);
      index += 1;
    }

    Array.from(child.children)
      .filter((c) => c.tagName === 'UL' || c.tagName === 'OL')
      .forEach((sub) => listToText(sub, out, depth + 1));
  });
}

function collectText(parent: Element, out: string[]): void {
  parent.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const tag = el.tagName;

    if (tag === 'TABLE') {
      tableToText(el as HTMLTableElement, out);
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      pushBlank(out);
      listToText(el, out, 0);
      pushBlank(out);
      return;
    }
    if (tag === 'IMG' || tag === 'STYLE' || tag === 'SCRIPT') return;

    if (HEADING_TAGS.has(tag)) {
      const text = normalizeLines(inlineText(el));
      if (text) {
        pushBlank(out);
        out.push(text);
        pushBlank(out);
      }
      return;
    }

    if (tag === 'P' || tag === 'BLOCKQUOTE' || tag === 'PRE') {
      const text = normalizeLines(inlineText(el));
      if (text) out.push(text);
      return;
    }

    collectText(el, out);
  });
}

function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  collectText(doc.body, out);

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function exportToTxt(parsed: ParsedDoc): Promise<Blob> {
  let text = '';
  try {
    text = htmlToPlainText(parsed.valueHtml);
  } catch (error) {
    console.warn('Structured TXT export failed, using raw text:', error);
  }
  if (!text) {
    text = parsed.rawText;
  }

  return new Blob(['\uFEFF' + text + '\n'], {
    type: 'text/plain;charset=utf-8',
  });
}

async function exportToHtml(parsed: ParsedDoc, fileName: string): Promise<Blob> {
  const htmlOutput = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)}</title>
  <style>
    body {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 14px;
      line-height: 1.55;
      max-width: 860px;
      margin: 32px auto;
      padding: 0 20px;
      color: #1e293b;
      overflow-wrap: break-word;
    }
    h1, h2, h3, h4, h5, h6 { color: #0f172a; line-height: 1.25; margin: 1.2em 0 0.5em; }
    p { margin: 0 0 0.8em; }
    ul, ol { margin: 0 0 0.8em; padding-left: 1.6em; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    td, th { border: 1px solid #cbd5e1; padding: 7px 10px; vertical-align: top; text-align: left; }
    th { background-color: #f1f5f9; font-weight: 600; color: #0f172a; }
    td p, th p { margin: 0; }
    img { max-width: 100%; height: auto; }
    .align-center { text-align: center; }
    .align-right { text-align: right; }
    .align-justify { text-align: justify; }
    @media print { body { margin: 0; max-width: none; } }
  </style>
</head>
<body>
${parsed.valueHtml}
</body>
</html>`;

  return new Blob([htmlOutput], { type: 'text/html;charset=utf-8' });
}

// ---------------------------------------------------------------------------
// 3. Word-Compatible DOC Exporter (exportToDoc)
// ---------------------------------------------------------------------------
const DOC_MAX_IMAGE_WIDTH_PX = 620;
const DOC_MAX_IMAGE_HEIGHT_PX = 880;

interface MimePart {
  location: string;
  mime: string;
  base64: string;
}

function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/webp': 'webp',
    'image/tiff': 'tif',
  };
  return map[mime.toLowerCase()] || 'png';
}

function getImageSize(
  src: string
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = Array.from(bytes.subarray(i, i + chunkSize));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function wrapBase64(base64: string): string {
  const lines = base64.match(/.{1,76}/g);
  return lines ? lines.join('\r\n') : '';
}

async function exportToDoc(parsed: ParsedDoc, fileName: string): Promise<Blob> {
  const dom = new DOMParser().parseFromString(
    `<body>${parsed.valueHtml}</body>`,
    'text/html'
  );

  const parts: MimePart[] = [];
  const images = Array.from(dom.querySelectorAll('img'));

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const src = img.getAttribute('src') || '';
    const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(src);
    if (!match) continue;

    const mime = match[1];
    const base64 = match[2];
    const location = `file:///C:/docx-export/image${String(i + 1).padStart(
      3,
      '0'
    )}.${mimeToExtension(mime)}`;

    const size = await getImageSize(src);
    if (size && size.width > 0 && size.height > 0) {
      const ratio = size.width / size.height;
      const maxWidth =
        ratio < 1.25 ? DOC_MAX_IMAGE_WIDTH_PX * 0.45 : DOC_MAX_IMAGE_WIDTH_PX;
      const scale = Math.min(
        1,
        maxWidth / size.width,
        DOC_MAX_IMAGE_HEIGHT_PX / size.height
      );
      img.setAttribute('width', String(Math.max(1, Math.round(size.width * scale))));
      img.setAttribute('height', String(Math.max(1, Math.round(size.height * scale))));
    }

    img.setAttribute('src', location);
    parts.push({ location, mime, base64 });
  }

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="Microsoft Word">
<title>${escapeHtml(fileName)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
<!--
@page WordSection1 { size: 21.0cm 29.7cm; margin: 1.5cm 1.5cm 1.5cm 1.5cm; }
div.WordSection1 { page: WordSection1; }
body { font-family: Calibri, Arial, sans-serif; font-size: 10.5pt; color: #1e293b; }
p { margin: 0cm 0cm 6pt 0cm; }
h1, h2, h3, h4, h5, h6 { font-family: Calibri, Arial, sans-serif; color: #0f172a; margin: 12pt 0cm 6pt 0cm; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0cm; }
td, th { border: 1pt solid #cbd5e1; padding: 4pt 6pt; vertical-align: top; }
th { background-color: #f1f5f9; font-weight: bold; }
td p, th p { margin: 0cm; }
p.align-center { text-align: center; }
p.align-right { text-align: right; }
p.align-justify { text-align: justify; }
-->
</style>
</head>
<body lang="EN-US">
<div class="WordSection1">
${dom.body.innerHTML}
</div>
</body>
</html>`;

  const boundary = `----=_NextPart_${Date.now().toString(16)}`;
  const lines: string[] = [
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    'Content-Location: file:///C:/docx-export/document.htm',
    '',
    wrapBase64(utf8ToBase64(html)),
  ];

  for (const part of parts) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${part.mime}`,
      'Content-Transfer-Encoding: base64',
      `Content-Location: ${part.location}`,
      '',
      wrapBase64(part.base64)
    );
  }

  lines.push(`--${boundary}--`, '');

  return new Blob([lines.join('\r\n')], { type: 'application/msword' });
}

// ---------------------------------------------------------------------------
// PPTX Exporter (Group paragraphs into chunked slide arrays in 16:9 widescreen layout)
// ---------------------------------------------------------------------------
async function exportToPptx(parsed: ParsedDoc): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  const chunks: string[][] = [];
  for (let i = 0; i < parsed.paragraphs.length; i += 4) {
    chunks.push(parsed.paragraphs.slice(i, i + 4));
  }

  if (chunks.length === 0) {
    chunks.push(['Empty Document']);
  }

  chunks.forEach((chunk, index) => {
    const slide = pptx.addSlide();

    slide.addText(`Slide ${index + 1}`, {
      x: 0.8,
      y: 0.6,
      w: '80%',
      h: 0.6,
      fontSize: 22,
      bold: true,
      color: '123999',
    });

    slide.addText(
      chunk.map((text) => ({ text })),
      {
        x: 0.8,
        y: 1.5,
        w: '85%',
        h: '70%',
        fontSize: 14,
        color: '333333',
        bullet: true,
        lineSpacing: 20,
      }
    );
  });

  return (await pptx.write({ outputType: 'blob' })) as Blob;
}

// ---------------------------------------------------------------------------
// 2. Professional PDF Layout Engine (exportToPdf)
// ---------------------------------------------------------------------------
const PDF_PAGE_W_MM = 210;
const PDF_PAGE_H_MM = 297;
const PDF_MARGIN_MM = 12;
const PDF_CONTENT_W_MM = PDF_PAGE_W_MM - PDF_MARGIN_MM * 2;
const PDF_CONTENT_H_MM = PDF_PAGE_H_MM - PDF_MARGIN_MM * 2;
const PDF_CONTENT_W_PX = 720;
const PDF_PAGE_H_PX = Math.floor(
  (PDF_CONTENT_W_PX * PDF_CONTENT_H_MM) / PDF_CONTENT_W_MM
);
const PDF_MM_PER_PX = PDF_CONTENT_W_MM / PDF_CONTENT_W_PX;
const PDF_RENDER_SCALE = 2.5;

const UNBREAKABLE_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, tr, pre, blockquote, .section-banner, table.keep-together';

interface Band {
  top: number;
  bottom: number;
}

interface PageSegment {
  start: number;
  end: number;
}

const CURRENCY_OR_NUM_RE =
  /^[+\-=]?\s*(?:₹|Rs\.?|INR|\$)?\s*\d[\d,.]*(?:\s*(?:\/-|\/night|%|Mbps|Sec|hrs?|m|₹))?$/i;

function extractCellLines(cell: HTMLElement): string[] {
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  clone.querySelectorAll('p, div, li').forEach((block) => {
    block.append('\n');
  });
  return (clone.textContent || '')
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

function rebuildTocTable(tbl: HTMLTableElement): void {
  const entries: Array<{ sec: string; title: string; page: string }> = [];
  const rawRowStrings: string[] = [];

  Array.from(tbl.rows).forEach((row) => {
    const cellParts: string[] = [];
    Array.from(row.cells).forEach((cell) => {
      const lines = extractCellLines(cell);
      if (lines.length > 0) {
        cellParts.push(lines.join('\n'));
      }
    });
    const combined = cellParts.join(' ');
    combined
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => rawRowStrings.push(line));
  });

  for (const line of rawRowStrings) {
    const cleaned = line.replace(/\.{3,}/g, ' ').replace(/\s+/g, ' ').trim();
    const match = /^(\d+(?:\.\d+)*)\s+(.+?)\s+(\d+)(?:\s+\d+)?$/.exec(cleaned);
    if (match) {
      entries.push({ sec: match[1], title: match[2].trim(), page: match[3] });
    } else {
      const noPageMatch = /^(\d+(?:\.\d+)*)\s+(.+)$/.exec(cleaned);
      if (noPageMatch) {
        entries.push({ sec: noPageMatch[1], title: noPageMatch[2].trim(), page: '' });
      }
    }
  }

  if (entries.length === 0) return;

  tbl.innerHTML = '';
  tbl.classList.add('toc-table', 'keep-together');

  const thead = tbl.createTHead();
  const hRow = thead.insertRow();
  hRow.className = 'pdf-table-header';
  ['Section', 'Topic / Description', 'Page'].forEach((label, idx) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (idx === 0) th.style.width = '75px';
    if (idx === 2) {
      th.style.width = '65px';
      th.style.textAlign = 'right';
    }
    hRow.appendChild(th);
  });

  const tbody = tbl.createTBody();
  entries.forEach((item, idx) => {
    const tr = tbody.insertRow();
    if (idx % 2 === 1) tr.className = 'pdf-table-zebra';
    const isTopLevel = !item.sec.includes('.');
    if (isTopLevel) tr.style.fontWeight = '700';

    const tdSec = tr.insertCell();
    tdSec.textContent = item.sec;
    tdSec.style.width = '75px';

    const tdTitle = tr.insertCell();
    tdTitle.textContent = item.title;

    const tdPage = tr.insertCell();
    tdPage.textContent = item.page;
    tdPage.className = 'num-cell';
    tdPage.style.width = '65px';
  });
}

function restructureDocumentForPdf(container: HTMLElement): void {
  // Strip decorative graphics, canvas blobs, or website UI crumbs
  container.querySelectorAll('img, svg, picture, canvas').forEach((el) => el.remove());

  Array.from(container.querySelectorAll<HTMLElement>('p')).forEach((p) => {
    if (p.closest('table')) return;

    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();

    if (
      !text ||
      /^\d{1,2}$/.test(text) ||
      /^(?:read less|show more|go to web check in|book cab|scan & pay.*)$/i.test(text) ||
      /^page \d+ of \d+$/i.test(text)
    ) {
      p.remove();
      return;
    }

    if (/^(?:chapter\s+\d+|contents|tariff details|billing address|payment modes|other information|dangerous goods.*)/i.test(text)) {
      p.classList.add('section-banner');
      return;
    }
    if (/^\d+\.\d+(?:\.\d+)?\s+[A-Z]/.test(text) && text.length < 90) {
      const h3 = document.createElement('h3');
      h3.textContent = text;
      p.replaceWith(h3);
    }
  });

  const tables = Array.from(container.querySelectorAll<HTMLTableElement>('table'));

  for (const tbl of tables) {
    const rawText = (tbl.textContent || '').trim();
    if (!rawText) {
      tbl.remove();
      continue;
    }

    if (/\.{5,}/.test(tbl.innerHTML)) {
      rebuildTocTable(tbl);
      continue;
    }

    const matrix: string[][] = [];
    Array.from(tbl.rows).forEach((row) => {
      const rowCells: string[] = [];
      Array.from(row.cells).forEach((cell) => {
        const lines = extractCellLines(cell);
        const text = lines.join(' · ').trim();
        if (!text || /^[-+=•]$/.test(text)) return;
        rowCells.push(text);
      });

      if (rowCells.length > 0) {
        matrix.push(rowCells);
      }
    });

    if (matrix.length === 0) {
      tbl.remove();
      continue;
    }

    const maxCols = Math.max(...matrix.map((r) => r.length));
    if (maxCols === 1 && matrix.length <= 2) {
      const wrapper = document.createElement('div');
      matrix.forEach((r) => {
        const p = document.createElement('div');
        p.className = r[0].length < 85 ? 'section-banner' : 'info-card';
        p.textContent = r[0];
        wrapper.appendChild(p);
      });
      tbl.replaceWith(wrapper);
      continue;
    }

    tbl.innerHTML = '';
    const tbody = tbl.createTBody();

    matrix.forEach((rowCells, rIdx) => {
      const tr = tbody.insertRow();

      if (rowCells.length === 1 && maxCols > 1) {
        tr.className = 'pdf-table-subheader';
        const td = tr.insertCell();
        td.colSpan = maxCols;
        td.textContent = rowCells[0];
        return;
      }

      const isHeaderRow =
        rIdx === 0 &&
        rowCells.length >= 2 &&
        rowCells.every((c) => c.length <= 40 && !CURRENCY_OR_NUM_RE.test(c));

      const joinedRow = rowCells.join(' ');
      const isTotalRow =
        !isHeaderRow &&
        /^(?:total|revised charges|payable amount|this month's charges|net charges|charges for bill period)/i.test(
          rowCells[0]
        );

      if (isHeaderRow) {
        tr.className = 'pdf-table-header';
      } else if (isTotalRow || /total payable/i.test(joinedRow)) {
        tr.className = 'pdf-table-total';
      } else if (rIdx % 2 === 1) {
        tr.className = 'pdf-table-zebra';
      }

      rowCells.forEach((cellText, cIdx) => {
        const td = tr.insertCell();
        td.textContent = cellText;

        if (cIdx === rowCells.length - 1 && rowCells.length < maxCols) {
          td.colSpan = maxCols - rowCells.length + 1;
        }

        // Right-align numeric/currency (₹) columns using tabular-nums
        if (!isHeaderRow && CURRENCY_OR_NUM_RE.test(cellText)) {
          td.classList.add('num-cell');
        }
      });
    });

    if (matrix.length <= 10) {
      tbl.classList.add('keep-together');
    }
  }
}

function collectUnbreakableBands(
  container: HTMLElement,
  pageHeightPx: number
): Band[] {
  const baseTop = container.getBoundingClientRect().top;
  const bands: Band[] = [];

  const push = (rect: DOMRect, pad = 0) => {
    if (rect.height > 0) {
      bands.push({
        top: Math.max(0, rect.top - baseTop - pad),
        bottom: rect.bottom - baseTop + pad,
      });
    }
  };

  const addFineGrained = (el: Element) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.textContent && node.textContent.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        Array.from(range.getClientRects()).forEach((r) => push(r, 1));
      }
      node = walker.nextNode();
    }
  };

  container.querySelectorAll(UNBREAKABLE_SELECTOR).forEach((el) => {
    const rect = el.getBoundingClientRect();

    if (
      (HEADING_TAGS.has(el.tagName) || el.classList.contains('section-banner')) &&
      el.nextElementSibling
    ) {
      const nextRect = el.nextElementSibling.getBoundingClientRect();
      const combinedBottom = Math.min(nextRect.bottom, rect.bottom + 75);
      bands.push({
        top: Math.max(0, rect.top - baseTop),
        bottom: combinedBottom - baseTop,
      });
      return;
    }

    if (rect.height <= pageHeightPx * 0.45) {
      push(rect, 2);
    } else {
      addFineGrained(el);
    }
  });

  return bands;
}

function computePageSegments(
  container: HTMLElement,
  pageHeightPx: number
): PageSegment[] {
  const total = Math.ceil(container.scrollHeight);
  const bands = collectUnbreakableBands(container, pageHeightPx);

  const segments: PageSegment[] = [];
  let start = 0;

  while (total - start > 1) {
    if (start + pageHeightPx >= total) {
      segments.push({ start, end: total });
      break;
    }

    const hardEnd = start + pageHeightPx;
    let end = hardEnd;

    for (let i = 0; i < 50; i++) {
      const hits = bands.filter(
        (b) => b.top + 0.5 < end && b.bottom - 0.5 > end
      );
      if (hits.length === 0) break;
      end = Math.min(...hits.map((b) => b.top));
    }

    if (end - start < pageHeightPx * 0.25) {
      end = hardEnd;
    }

    segments.push({ start, end });
    start = end;
  }

  if (segments.length === 0) {
    segments.push({ start: 0, end: Math.max(total, 1) });
  }

  return segments;
}

async function exportToPdf(parsed: ParsedDoc, fileName: string): Promise<Blob> {
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '0';
  container.style.top = '0';
  container.style.width = `${PDF_CONTENT_W_PX}px`;
  container.style.boxSizing = 'border-box';
  container.style.padding = '0';
  container.style.background = '#ffffff';
  container.style.color = '#0f172a';
  container.style.zIndex = '-9999';

  container.innerHTML = `
    <style>
      .docx-pdf {
        font-family: 'Segoe UI', Inter, Arial, Helvetica, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        color: #1e293b;
        background: #ffffff;
        overflow-wrap: break-word;
        word-break: normal;
      }
      .docx-pdf p {
        margin: 0 0 8px;
        color: #334155;
      }
      .docx-pdf .align-center { text-align: center; }
      .docx-pdf .align-right { text-align: right; }
      .docx-pdf .align-justify { text-align: justify; }

      .docx-pdf h1 {
        font-size: 18px;
        font-weight: 700;
        margin: 14px 0 8px;
        padding-bottom: 5px;
        border-bottom: 2px solid #1e293b;
        color: #0f172a;
        line-height: 1.25;
      }
      .docx-pdf h2 {
        font-size: 15px;
        font-weight: 700;
        margin: 12px 0 6px;
        color: #0f172a;
        line-height: 1.3;
      }
      .docx-pdf h3, .docx-pdf h4, .docx-pdf h5, .docx-pdf h6 {
        font-size: 13px;
        font-weight: 700;
        margin: 10px 0 4px;
        color: #1e293b;
        line-height: 1.3;
      }
      .docx-pdf .section-banner {
        background-color: #1e293b;
        color: #ffffff;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.3px;
        padding: 6px 10px;
        margin: 12px 0 6px;
        border-radius: 3px;
        text-transform: uppercase;
      }
      .docx-pdf .info-card {
        background-color: #f8fafc;
        border-left: 3px solid #475569;
        padding: 6px 10px;
        margin: 6px 0;
        font-size: 11.5px;
        color: #334155;
      }
      .docx-pdf ul, .docx-pdf ol {
        margin: 0 0 8px;
        padding-left: 20px;
      }
      .docx-pdf li {
        margin-bottom: 4px;
        color: #334155;
      }

      .docx-pdf table {
        border-collapse: collapse;
        width: 100%;
        margin: 8px 0 12px;
        table-layout: auto;
        font-size: 11.5px;
        line-height: 1.4;
        border: 1px solid #cbd5e1;
      }
      .docx-pdf td, .docx-pdf th {
        border: 1px solid #cbd5e1;
        padding: 6px 9px;
        vertical-align: middle;
        text-align: left;
        overflow-wrap: break-word;
        word-break: normal;
        color: #1e293b;
      }

      /* Promote headers to dark slate banners (#1e293b) */
      .docx-pdf th,
      .docx-pdf tr.pdf-table-header td {
        background-color: #1e293b !important;
        color: #ffffff !important;
        font-weight: 700;
        border-color: #1e293b !important;
        font-size: 11px;
        letter-spacing: 0.2px;
      }

      .docx-pdf tr.pdf-table-subheader td {
        background-color: #e2e8f0;
        color: #0f172a;
        font-weight: 700;
        font-size: 11.5px;
        padding: 5px 9px;
      }

      /* Zebra-stripe alternating rows (#f8fafc) */
      .docx-pdf tr.pdf-table-zebra td {
        background-color: #f8fafc;
      }
      .docx-pdf tr.pdf-table-total td {
        background-color: #f1f5f9;
        font-weight: 700;
        color: #0f172a;
        border-top: 1.5px solid #64748b;
        border-bottom: 1.5px solid #64748b;
      }

      .docx-pdf td.num-cell {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        font-weight: 500;
      }
    </style>
    <div class="docx-pdf">${parsed.valueHtml}</div>
  `;

  document.body.appendChild(container);

  try {
    restructureDocumentForPdf(container);

    await new Promise((resolve) => setTimeout(resolve, 150));
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const segments = computePageSegments(container, PDF_PAGE_H_PX);

    const pdf = new jsPDF('p', 'mm', 'a4');
    pdf.setProperties({ title: fileName });

    for (let i = 0; i < segments.length; i++) {
      const startPx = Math.round(segments[i].start);
      const endPx = Math.round(segments[i].end);
      const sliceHeightPx = Math.max(1, endPx - startPx);

      const canvas = await html2canvas(container, {
        scale: PDF_RENDER_SCALE,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        x: 0,
        y: startPx,
        width: PDF_CONTENT_W_PX,
        height: sliceHeightPx,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.96);

      if (i > 0) {
        pdf.addPage();
      }

      pdf.addImage(
        imgData,
        'JPEG',
        PDF_MARGIN_MM,
        PDF_MARGIN_MM,
        PDF_CONTENT_W_MM,
        sliceHeightPx * PDF_MM_PER_PX
      );
    }

    return pdf.output('blob') as Blob;
  } finally {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }
}

// ---------------------------------------------------------------------------
// Unified Master Function to route DOCX conversions client-side
// ---------------------------------------------------------------------------

export async function convertDocxClientSide(
  file: File,
  targetFormat: string,
  options?: ConvertOptions
): Promise<Blob> {
  const { onProgress } = options || {};
  const format = targetFormat.toLowerCase();
  const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;

  onProgress?.(20, 'Reading Word document...');
  const parsed = await parseDocxFile(file);

  onProgress?.(60, `Generating ${format.toUpperCase()}...`);

  let resultBlob: Blob;
  if (format === 'txt') {
    resultBlob = await exportToTxt(parsed);
  } else if (format === 'html' || format === 'htm') {
    resultBlob = await exportToHtml(parsed, baseName);
  } else if (format === 'doc') {
    resultBlob = await exportToDoc(parsed, baseName);
  } else if (format === 'pptx' || format === 'ppt') {
    resultBlob = await exportToPptx(parsed);
  } else if (format === 'pdf') {
    resultBlob = await exportToPdf(parsed, baseName);
  } else {
    throw new Error(`Unsupported client-side format: ${format}`);
  }

  onProgress?.(100, 'Done!');
  return resultBlob;
}