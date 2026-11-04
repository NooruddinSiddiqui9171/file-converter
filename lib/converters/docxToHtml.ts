// lib/converters/docxToHtml.ts
import JSZip from 'jszip';

export interface DocxToHtmlOptions {
  /**
   * Display scale multiplier for page frames (default: 1.25).
   */
  scale?: number;
  /**
   * WebP/JPEG compression quality for embedded media images (0.1 to 1.0, default: 0.75).
   */
  imageQuality?: number;
  /**
   * Maximum pixel dimension for embedded images to prevent oversized HTML files (default: 1600).
   */
  maxImageDimension?: number;
  /**
   * Optional progress callback (0 to 100).
   */
  onProgress?: (percent: number) => void;
}

interface PageGeometry {
  widthPx: number;
  heightPx: number;
  marginTopPx: number;
  marginRightPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  headerTopPx: number;
  footerBottomPx: number;
}

interface RunStyle {
  fontFamily?: string;
  fontSizePt?: number;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  vertAlign?: 'superscript' | 'subscript';
  smallCaps?: boolean;
  allCaps?: boolean;
}

interface ParaStyle {
  id: string;
  name: string;
  basedOn?: string;
  outlineLevel?: number;
  align?: string;
  spaceBeforePx?: number;
  spaceAfterPx?: number;
  lineHeight?: string;
  indentLeftPx?: number;
  indentRightPx?: number;
  indentFirstLinePx?: number;
  backgroundColor?: string;
  borderBottom?: string;
  pageBreakBefore?: boolean;
  numId?: string;
  ilvl?: number;
  runStyle: RunStyle;
}

interface NumberingLevel {
  numFmt: string;
  lvlText: string;
  start: number;
  indentLeftPx: number;
  hangingPx: number;
}

interface OutlineItem {
  id: string;
  title: string;
  level: number;
  pageHex: string;
}

interface RenderedBlock {
  html: string;
  forcePageBreakBefore?: boolean;
  headingId?: string;
  headingTitle?: string;
  headingLevel?: number;
  isTable?: boolean;
}

const TWIPS_PER_PX = 15; // 1440 twips/inch at 96 DPI = 15 twips/px
const EMU_PER_PX = 9525; // 914400 EMUs/inch at 96 DPI = 9525 EMUs/px
const PX_TO_PT = 72 / 96;

const HIGHLIGHT_COLOR_MAP: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGray: '#808080',
  lightGray: '#c0c0c0',
  black: '#000000',
  white: '#ffffff',
};

function fmtNum(val: number, decimals = 2): string {
  return Number(val.toFixed(decimals)).toString();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twipsToPx(twips: string | number | null | undefined, scale = 1): number {
  if (twips === null || twips === undefined || twips === '') return 0;
  const n = typeof twips === 'number' ? twips : parseInt(twips, 10);
  if (Number.isNaN(n)) return 0;
  return (n / TWIPS_PER_PX) * scale;
}

function getAttr(el: Element | null | undefined, localName: string): string | null {
  if (!el) return null;
  const direct = el.getAttribute(`w:${localName}`) ?? el.getAttribute(localName);
  if (direct !== null) return direct;
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (attr.localName === localName) return attr.value;
  }
  return null;
}

function findChild(parent: Element | null | undefined, localName: string): Element | null {
  if (!parent) return null;
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.localName === localName) return child;
  }
  return null;
}

function findChildren(parent: Element | null | undefined, localName: string): Element[] {
  const result: Element[] = [];
  if (!parent) return result;
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.localName === localName) result.push(child);
  }
  return result;
}

function findDescendants(parent: Element | null | undefined, localName: string): Element[] {
  const result: Element[] = [];
  if (!parent) return result;
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) {
      result.push(all[i]);
    }
  }
  return result;
}

function parseXml(xmlString: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, 'application/xml');
}

function normalizeColor(
  val: string | null | undefined,
  themeColors: Record<string, string>,
  themeColorAttr?: string | null
): string | undefined {
  if (themeColorAttr && themeColors[themeColorAttr]) {
    return `#${themeColors[themeColorAttr]}`;
  }
  if (!val || val === 'auto' || val === 'none' || val === 'nil') return undefined;
  const clean = val.replace(/^#/, '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean.toLowerCase()}`;
  }
  return undefined;
}

/**
 * Compresses an embedded image binary from `word/media/*` into a compact WebP or JPEG data URL.
 */
async function compressImageBlobToDataUrl(
  uint8: Uint8Array,
  ext: string,
  quality: number,
  maxDim: number
): Promise<string> {
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
  };
  const mime = mimeMap[ext] || 'image/png';
  const blob = new Blob([uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) as ArrayBuffer], {
    type: mime,
  });

  // Keep SVG or animated GIF as-is
  if (ext === 'svg' || ext === 'gif') {
    return await blobToDataUrl(blob);
  }

  const originalDataUrl = await blobToDataUrl(blob);

  try {
    const imgUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = imgUrl;
      });

      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (!w || !h) return originalDataUrl;

      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.max(1, Math.round(w * ratio));
        h = Math.max(1, Math.round(h * ratio));
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return originalDataUrl;

      ctx.drawImage(img, 0, 0, w, h);

      // WebP supports both lossy compression and alpha transparency
      const webpDataUrl = canvas.toDataURL('image/webp', quality);
      if (webpDataUrl.startsWith('data:image/webp')) {
        return webpDataUrl.length < originalDataUrl.length
          ? webpDataUrl
          : originalDataUrl;
      }

      const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
      return jpegDataUrl.length < originalDataUrl.length
        ? jpegDataUrl
        : originalDataUrl;
    } finally {
      URL.revokeObjectURL(imgUrl);
    }
  } catch {
    return originalDataUrl;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Formats list counter values (decimal, lowerLetter, upperLetter, lowerRoman, upperRoman).
 */
function formatCounter(val: number, fmt: string): string {
  if (fmt === 'lowerLetter') {
    let n = Math.max(1, val);
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(97 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  if (fmt === 'upperLetter') {
    return formatCounter(val, 'lowerLetter').toUpperCase();
  }
  if (fmt === 'lowerRoman' || fmt === 'upperRoman') {
    const numerals: [number, string][] = [
      [1000, 'm'],
      [900, 'cm'],
      [500, 'd'],
      [400, 'cd'],
      [100, 'c'],
      [90, 'xc'],
      [50, 'l'],
      [40, 'xl'],
      [10, 'x'],
      [9, 'ix'],
      [5, 'v'],
      [4, 'iv'],
      [1, 'i'],
    ];
    let n = Math.max(1, val);
    let res = '';
    for (const [num, sym] of numerals) {
      while (n >= num) {
        res += sym;
        n -= num;
      }
    }
    return fmt === 'upperRoman' ? res.toUpperCase() : res;
  }
  return String(val);
}

/**
 * Converts a DOCX File/Blob/ArrayBuffer into a standalone pdf2htmlEX-styled HTML string.
 */
export async function convertDocxToHtmlString(
  input: File | Blob | ArrayBuffer,
  options: DocxToHtmlOptions = {}
): Promise<string> {
  const scale = options.scale ?? 1.25;
  const imageQuality = options.imageQuality ?? 0.75;
  const maxImageDim = options.maxImageDimension ?? 1600;

  const arrayBuffer =
    input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Invalid DOCX file: word/document.xml not found.');
  }

  options.onProgress?.(10);

  const [
    docXmlStr,
    stylesXmlStr,
    numberingXmlStr,
    themeXmlStr,
    relsXmlStr,
  ] = await Promise.all([
    docXmlFile.async('string'),
    zip.file('word/styles.xml')?.async('string') ?? Promise.resolve(''),
    zip.file('word/numbering.xml')?.async('string') ?? Promise.resolve(''),
    zip.file('word/theme/theme1.xml')?.async('string') ?? Promise.resolve(''),
    zip.file('word/_rels/document.xml.rels')?.async('string') ?? Promise.resolve(''),
  ]);

  // 1. Parse theme colors & fonts
  const themeColors: Record<string, string> = {
    dk1: '000000',
    lt1: 'ffffff',
    dk2: '1f497d',
    lt2: 'eeece1',
    accent1: '4f81bd',
    accent2: 'c0504d',
    accent3: '9bbb59',
    accent4: '8064a2',
    accent5: '4bacc6',
    accent6: 'f79646',
    hlink: '0000ff',
    folHlink: '800080',
  };
  let defaultMajorFont = 'Calibri, Arial, sans-serif';
  let defaultMinorFont = 'Calibri, Arial, sans-serif';

  if (themeXmlStr) {
    const themeDoc = parseXml(themeXmlStr);
    const clrScheme = findDescendants(themeDoc.documentElement, 'clrScheme')[0];
    if (clrScheme) {
      for (let i = 0; i < clrScheme.children.length; i++) {
        const cNode = clrScheme.children[i];
        const srgb = findChild(cNode, 'srgbClr');
        const sys = findChild(cNode, 'sysClr');
        const hex =
          getAttr(srgb, 'val') || getAttr(sys, 'lastClr') || getAttr(sys, 'val');
        if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) {
          themeColors[cNode.localName] = hex.toLowerCase();
        }
      }
    }
    const majorLatin = findDescendants(themeDoc.documentElement, 'majorFont')[0];
    const minorLatin = findDescendants(themeDoc.documentElement, 'minorFont')[0];
    const majTypeface = getAttr(findChild(majorLatin, 'latin'), 'typeface');
    const minTypeface = getAttr(findChild(minorLatin, 'latin'), 'typeface');
    if (majTypeface) defaultMajorFont = `"${majTypeface}", Calibri, Arial, sans-serif`;
    if (minTypeface) defaultMinorFont = `"${minTypeface}", Calibri, Arial, sans-serif`;
  }

  // 2. Parse relationships (word/_rels/document.xml.rels)
  const parseRels = (relsStr: string) => {
    const map = new Map<string, { target: string; type: string; external: boolean }>();
    if (!relsStr) return map;
    const relsDoc = parseXml(relsStr);
    const rels = findDescendants(relsDoc.documentElement, 'Relationship');
    for (const rel of rels) {
      const id = getAttr(rel, 'Id');
      const target = getAttr(rel, 'Target');
      const type = getAttr(rel, 'Type') || '';
      const mode = getAttr(rel, 'TargetMode');
      if (id && target) {
        map.set(id, {
          target,
          type,
          external: mode === 'External',
        });
      }
    }
    return map;
  };

  const docRels = parseRels(relsXmlStr);

  // 3. Preload and compress all media images referenced in the DOCX
  const mediaDataUrls = new Map<string, string>();
  const mediaFiles = Object.keys(zip.files).filter((p) =>
    p.startsWith('word/media/')
  );

  for (let i = 0; i < mediaFiles.length; i++) {
    const fullPath = mediaFiles[i];
    const fileObj = zip.file(fullPath);
    if (!fileObj || fileObj.dir) continue;
    const uint8 = await fileObj.async('uint8array');
    const ext = fullPath.split('.').pop()?.toLowerCase() || 'png';
    const dataUrl = await compressImageBlobToDataUrl(
      uint8,
      ext,
      imageQuality,
      maxImageDim
    );
    const normalizedKey = fullPath.replace(/^word\//, '');
    mediaDataUrls.set(normalizedKey, dataUrl);
    mediaDataUrls.set(fullPath, dataUrl);
  }

  options.onProgress?.(35);

  // 4. Parse styles.xml
  let docDefaultRunStyle: RunStyle = {
    fontFamily: defaultMinorFont,
    fontSizePt: 11,
    color: '#000000',
  };
  let docDefaultSpaceAfterPx = twipsToPx(160, scale);
  let docDefaultLineHeight = '1.15';

  const styleMap = new Map<string, ParaStyle>();

  const parseRunPr = (rPr: Element | null): RunStyle => {
    const style: RunStyle = {};
    if (!rPr) return style;

    const rFonts = findChild(rPr, 'rFonts');
    if (rFonts) {
      const asciiTheme = getAttr(rFonts, 'asciiTheme') || getAttr(rFonts, 'hAnsiTheme');
      const ascii =
        getAttr(rFonts, 'ascii') ||
        getAttr(rFonts, 'hAnsi') ||
        getAttr(rFonts, 'cs');
      if (ascii) {
        style.fontFamily = `"${ascii}", Calibri, Arial, sans-serif`;
      } else if (asciiTheme) {
        style.fontFamily = asciiTheme.startsWith('major')
          ? defaultMajorFont
          : defaultMinorFont;
      }
    }

    const sz = findChild(rPr, 'sz') || findChild(rPr, 'szCs');
    const szVal = getAttr(sz, 'val');
    if (szVal) {
      const halfPt = parseFloat(szVal);
      if (!Number.isNaN(halfPt) && halfPt > 0) {
        style.fontSizePt = halfPt / 2;
      }
    }

    const colorEl = findChild(rPr, 'color');
    if (colorEl) {
      const c = normalizeColor(
        getAttr(colorEl, 'val'),
        themeColors,
        getAttr(colorEl, 'themeColor')
      );
      if (c) style.color = c;
    }

    const highlightEl = findChild(rPr, 'highlight');
    const hlVal = getAttr(highlightEl, 'val');
    if (hlVal && HIGHLIGHT_COLOR_MAP[hlVal]) {
      style.backgroundColor = HIGHLIGHT_COLOR_MAP[hlVal];
    }

    const shdEl = findChild(rPr, 'shd');
    if (shdEl && !style.backgroundColor) {
      const fill = normalizeColor(
        getAttr(shdEl, 'fill'),
        themeColors,
        getAttr(shdEl, 'themeFill')
      );
      if (fill && fill !== '#ffffff') style.backgroundColor = fill;
    }

    const bEl = findChild(rPr, 'b');
    if (bEl) {
      const v = getAttr(bEl, 'val');
      style.bold = v !== '0' && v !== 'false';
    }

    const iEl = findChild(rPr, 'i');
    if (iEl) {
      const v = getAttr(iEl, 'val');
      style.italic = v !== '0' && v !== 'false';
    }

    const uEl = findChild(rPr, 'u');
    if (uEl) {
      const v = getAttr(uEl, 'val');
      style.underline = v !== 'none' && v !== '0' && v !== 'false';
    }

    const strikeEl = findChild(rPr, 'strike') || findChild(rPr, 'dstrike');
    if (strikeEl) {
      const v = getAttr(strikeEl, 'val');
      style.strike = v !== '0' && v !== 'false';
    }

    const vertAlignEl = findChild(rPr, 'vertAlign');
    const vaVal = getAttr(vertAlignEl, 'val');
    if (vaVal === 'superscript' || vaVal === 'subscript') {
      style.vertAlign = vaVal;
    }

    if (findChild(rPr, 'smallCaps')) style.smallCaps = true;
    if (findChild(rPr, 'caps')) style.allCaps = true;

    return style;
  };

  const parseBorderCss = (bdrEl: Element | null): string | undefined => {
    if (!bdrEl) return undefined;
    const val = getAttr(bdrEl, 'val');
    if (!val || val === 'none' || val === 'nil') return 'none';
    const szEighths = parseInt(getAttr(bdrEl, 'sz') || '4', 10);
    const widthPx = Math.max(1, Math.round(((szEighths / 8) * (96 / 72)) * 10) / 10);
    const color =
      normalizeColor(
        getAttr(bdrEl, 'color'),
        themeColors,
        getAttr(bdrEl, 'themeColor')
      ) || '#000000';
    const lineStyle =
      val === 'dotted' ? 'dotted' : val === 'dashed' ? 'dashed' : val === 'double' ? 'double' : 'solid';
    return `${widthPx}px ${lineStyle} ${color}`;
  };

  const applyParaPrToStyle = (pPr: Element | null, target: ParaStyle) => {
    if (!pPr) return;

    const jcVal = getAttr(findChild(pPr, 'jc'), 'val');
    if (jcVal) {
      target.align =
        jcVal === 'both' || jcVal === 'distribute'
          ? 'justify'
          : jcVal === 'end'
            ? 'right'
            : jcVal === 'start'
              ? 'left'
              : jcVal;
    }

    const spacing = findChild(pPr, 'spacing');
    if (spacing) {
      const before = getAttr(spacing, 'before');
      const after = getAttr(spacing, 'after');
      const line = getAttr(spacing, 'line');
      const lineRule = getAttr(spacing, 'lineRule');
      if (before !== null) target.spaceBeforePx = twipsToPx(before, scale);
      if (after !== null) target.spaceAfterPx = twipsToPx(after, scale);
      if (line !== null) {
        const lineNum = parseInt(line, 10);
        if (!Number.isNaN(lineNum) && lineNum > 0) {
          if (lineRule === 'exact' || lineRule === 'atLeast') {
            target.lineHeight = `${fmtNum(twipsToPx(lineNum, scale))}px`;
          } else {
            target.lineHeight = fmtNum(Math.max(0.85, lineNum / 240), 2);
          }
        }
      }
    }

    const ind = findChild(pPr, 'ind');
    if (ind) {
      const left = getAttr(ind, 'left') ?? getAttr(ind, 'start');
      const right = getAttr(ind, 'right') ?? getAttr(ind, 'end');
      const firstLine = getAttr(ind, 'firstLine');
      const hanging = getAttr(ind, 'hanging');
      if (left !== null) target.indentLeftPx = twipsToPx(left, scale);
      if (right !== null) target.indentRightPx = twipsToPx(right, scale);
      if (firstLine !== null) target.indentFirstLinePx = twipsToPx(firstLine, scale);
      if (hanging !== null) target.indentFirstLinePx = -twipsToPx(hanging, scale);
    }

    const shd = findChild(pPr, 'shd');
    if (shd) {
      const fill = normalizeColor(
        getAttr(shd, 'fill'),
        themeColors,
        getAttr(shd, 'themeFill')
      );
      if (fill && fill !== '#ffffff') target.backgroundColor = fill;
    }

    const pBdr = findChild(pPr, 'pBdr');
    if (pBdr) {
      const bottomBdr = parseBorderCss(findChild(pBdr, 'bottom'));
      if (bottomBdr && bottomBdr !== 'none') target.borderBottom = bottomBdr;
    }

    if (findChild(pPr, 'pageBreakBefore')) {
      const v = getAttr(findChild(pPr, 'pageBreakBefore'), 'val');
      if (v !== '0' && v !== 'false') target.pageBreakBefore = true;
    }

    const outlineLvlEl = findChild(pPr, 'outlineLvl');
    const outlineVal = getAttr(outlineLvlEl, 'val');
    if (outlineVal !== null) {
      const lvl = parseInt(outlineVal, 10);
      if (!Number.isNaN(lvl) && lvl >= 0 && lvl <= 8) {
        target.outlineLevel = lvl + 1;
      }
    }

    const numPr = findChild(pPr, 'numPr');
    if (numPr) {
      const numId = getAttr(findChild(numPr, 'numId'), 'val');
      const ilvl = getAttr(findChild(numPr, 'ilvl'), 'val');
      if (numId && numId !== '0') {
        target.numId = numId;
        target.ilvl = ilvl ? parseInt(ilvl, 10) : 0;
      }
    }
  };

  if (stylesXmlStr) {
    const stylesDoc = parseXml(stylesXmlStr);
    const docDefaults = findDescendants(stylesDoc.documentElement, 'docDefaults')[0];
    if (docDefaults) {
      const rPrDefault = findDescendants(docDefaults, 'rPr')[0];
      docDefaultRunStyle = {
        ...docDefaultRunStyle,
        ...parseRunPr(rPrDefault),
      };
      const pPrDefault = findDescendants(docDefaults, 'pPr')[0];
      const tempPara: ParaStyle = { id: '_def', name: '_def', runStyle: {} };
      applyParaPrToStyle(pPrDefault, tempPara);
      if (tempPara.spaceAfterPx !== undefined) {
        docDefaultSpaceAfterPx = tempPara.spaceAfterPx;
      }
      if (tempPara.lineHeight !== undefined) {
        docDefaultLineHeight = tempPara.lineHeight;
      }
    }

    const styleNodes = findDescendants(stylesDoc.documentElement, 'style');
    for (const sNode of styleNodes) {
      const styleId = getAttr(sNode, 'styleId');
      if (!styleId) continue;
      const name = getAttr(findChild(sNode, 'name'), 'val') || styleId;
      const basedOn = getAttr(findChild(sNode, 'basedOn'), 'val') || undefined;
      const pStyle: ParaStyle = {
        id: styleId,
        name,
        basedOn,
        runStyle: parseRunPr(findChild(sNode, 'rPr')),
      };
      const headingMatch = name.match(/^heading\s*(\d)$/i);
      if (headingMatch) {
        pStyle.outlineLevel = parseInt(headingMatch[1], 10);
      }
      applyParaPrToStyle(findChild(sNode, 'pPr'), pStyle);
      styleMap.set(styleId, pStyle);
    }
  }

  // Resolve style inheritance (`w:basedOn`)
  const resolveParaStyle = (styleId: string | null | undefined): ParaStyle => {
    const base: ParaStyle = {
      id: styleId || 'Normal',
      name: styleId || 'Normal',
      spaceAfterPx: docDefaultSpaceAfterPx,
      lineHeight: docDefaultLineHeight,
      runStyle: { ...docDefaultRunStyle },
    };
    if (!styleId || !styleMap.has(styleId)) return base;

    const chain: ParaStyle[] = [];
    const visited = new Set<string>();
    let cur: string | undefined = styleId;
    while (cur && styleMap.has(cur) && !visited.has(cur)) {
      visited.add(cur);
      const s: ParaStyle = styleMap.get(cur)!;
      chain.unshift(s);
      cur = s.basedOn;
    }

    for (const s of chain) {
      if (s.outlineLevel !== undefined) base.outlineLevel = s.outlineLevel;
      if (s.align !== undefined) base.align = s.align;
      if (s.spaceBeforePx !== undefined) base.spaceBeforePx = s.spaceBeforePx;
      if (s.spaceAfterPx !== undefined) base.spaceAfterPx = s.spaceAfterPx;
      if (s.lineHeight !== undefined) base.lineHeight = s.lineHeight;
      if (s.indentLeftPx !== undefined) base.indentLeftPx = s.indentLeftPx;
      if (s.indentRightPx !== undefined) base.indentRightPx = s.indentRightPx;
      if (s.indentFirstLinePx !== undefined) base.indentFirstLinePx = s.indentFirstLinePx;
      if (s.backgroundColor !== undefined) base.backgroundColor = s.backgroundColor;
      if (s.borderBottom !== undefined) base.borderBottom = s.borderBottom;
      if (s.pageBreakBefore !== undefined) base.pageBreakBefore = s.pageBreakBefore;
      if (s.numId !== undefined) base.numId = s.numId;
      if (s.ilvl !== undefined) base.ilvl = s.ilvl;
      base.runStyle = { ...base.runStyle, ...s.runStyle };
    }
    return base;
  };

  // 5. Parse numbering.xml for bulleted and numbered lists
  const abstractNumMap = new Map<string, Map<number, NumberingLevel>>();
  const numToAbstractMap = new Map<string, string>();
  const listCounters = new Map<string, number>();

  if (numberingXmlStr) {
    const numDoc = parseXml(numberingXmlStr);
    const abstractNums = findDescendants(numDoc.documentElement, 'abstractNum');
    for (const abs of abstractNums) {
      const absId = getAttr(abs, 'abstractNumId');
      if (!absId) continue;
      const lvlMap = new Map<number, NumberingLevel>();
      const lvls = findChildren(abs, 'lvl');
      for (const lvl of lvls) {
        const ilvl = parseInt(getAttr(lvl, 'ilvl') || '0', 10);
        const numFmt = getAttr(findChild(lvl, 'numFmt'), 'val') || 'bullet';
        const lvlText = getAttr(findChild(lvl, 'lvlText'), 'val') || '•';
        const start = parseInt(getAttr(findChild(lvl, 'start'), 'val') || '1', 10);
        const pPr = findChild(lvl, 'pPr');
        const ind = findChild(pPr, 'ind');
        const indentLeftPx = twipsToPx(getAttr(ind, 'left') || '720', scale);
        const hangingPx = twipsToPx(getAttr(ind, 'hanging') || '360', scale);
        lvlMap.set(ilvl, {
          numFmt,
          lvlText,
          start: Number.isNaN(start) ? 1 : start,
          indentLeftPx,
          hangingPx,
        });
      }
      abstractNumMap.set(absId, lvlMap);
    }

    const nums = findDescendants(numDoc.documentElement, 'num');
    for (const num of nums) {
      const numId = getAttr(num, 'numId');
      const absId = getAttr(findChild(num, 'abstractNumId'), 'val');
      if (numId && absId) {
        numToAbstractMap.set(numId, absId);
      }
    }
  }

  // 6. Parse document.xml & page geometry
  const docDom = parseXml(docXmlStr);
  const bodyEl = findDescendants(docDom.documentElement, 'body')[0];
  if (!bodyEl) {
    throw new Error('Invalid DOCX file: word/body element not found.');
  }

  const sectPr =
    findChild(bodyEl, 'sectPr') || findDescendants(bodyEl, 'sectPr')[0];
  const pgSz = findChild(sectPr, 'pgSz');
  const pgMar = findChild(sectPr, 'pgMar');

  const pageGeometry: PageGeometry = {
    widthPx: Math.round(twipsToPx(getAttr(pgSz, 'w') || '11906', scale)),
    heightPx: Math.round(twipsToPx(getAttr(pgSz, 'h') || '16838', scale)),
    marginTopPx: Math.round(twipsToPx(getAttr(pgMar, 'top') || '1440', scale)),
    marginRightPx: Math.round(twipsToPx(getAttr(pgMar, 'right') || '1440', scale)),
    marginBottomPx: Math.round(twipsToPx(getAttr(pgMar, 'bottom') || '1440', scale)),
    marginLeftPx: Math.round(twipsToPx(getAttr(pgMar, 'left') || '1440', scale)),
    headerTopPx: Math.round(twipsToPx(getAttr(pgMar, 'header') || '720', scale)),
    footerBottomPx: Math.round(twipsToPx(getAttr(pgMar, 'footer') || '720', scale)),
  };

  let headingSeq = 0;

  // Helper to convert RunStyle into inline CSS
  const runStyleToCss = (rs: RunStyle): string => {
    const parts: string[] = [];
    if (rs.fontFamily) parts.push(`font-family:${rs.fontFamily}`);
    if (rs.fontSizePt) {
      const px = rs.fontSizePt * (96 / 72) * scale;
      parts.push(`font-size:${fmtNum(px)}px`);
    }
    if (rs.color) parts.push(`color:${rs.color}`);
    if (rs.backgroundColor) parts.push(`background-color:${rs.backgroundColor}`);
    if (rs.bold) parts.push('font-weight:700');
    if (rs.italic) parts.push('font-style:italic');
    const decorations: string[] = [];
    if (rs.underline) decorations.push('underline');
    if (rs.strike) decorations.push('line-through');
    if (decorations.length > 0) {
      parts.push(`text-decoration:${decorations.join(' ')}`);
    }
    if (rs.smallCaps) parts.push('font-variant:small-caps');
    if (rs.allCaps) parts.push('text-transform:uppercase');
    if (rs.vertAlign === 'superscript') {
      parts.push('vertical-align:super;font-size:0.78em');
    } else if (rs.vertAlign === 'subscript') {
      parts.push('vertical-align:sub;font-size:0.78em');
    }
    return parts.join(';');
  };

  // Render an embedded DrawingML / VML image inside a run
  const renderDrawingHtml = (
    drawingEl: Element,
    activeRels: Map<string, { target: string; type: string; external: boolean }>
  ): string => {
    const blips = [
      ...findDescendants(drawingEl, 'blip'),
      ...findDescendants(drawingEl, 'imagedata'),
    ];
    if (blips.length === 0) return '';

    const blip = blips[0];
    const embedId =
      getAttr(blip, 'embed') || getAttr(blip, 'id') || getAttr(blip, 'r:embed');
    if (!embedId) return '';

    const rel = activeRels.get(embedId);
    if (!rel) return '';

    const cleanTarget = rel.target.replace(/^\.\.\//, '').replace(/^\/?word\//, '');
    const src = mediaDataUrls.get(cleanTarget) || mediaDataUrls.get(`word/${cleanTarget}`);
    if (!src) return '';

    const extent =
      findDescendants(drawingEl, 'extent')[0] ||
      findDescendants(drawingEl, 'ext')[0];
    const cx = getAttr(extent, 'cx');
    const cy = getAttr(extent, 'cy');

    const maxContentWidth =
      pageGeometry.widthPx - pageGeometry.marginLeftPx - pageGeometry.marginRightPx;

    let widthPx = cx ? (parseInt(cx, 10) / EMU_PER_PX) * scale : 0;
    let heightPx = cy ? (parseInt(cy, 10) / EMU_PER_PX) * scale : 0;

    if (widthPx > maxContentWidth && widthPx > 0) {
      const ratio = maxContentWidth / widthPx;
      widthPx = maxContentWidth;
      heightPx = heightPx * ratio;
    }

    const sizeStyle =
      widthPx > 0 && heightPx > 0
        ? `width:${fmtNum(widthPx)}px;height:${fmtNum(heightPx)}px;max-width:100%;`
        : 'max-width:100%;height:auto;';

    return `<img src="${src}" alt="" style="display:inline-block;vertical-align:middle;${sizeStyle}" />`;
  };

  // Render a single `<w:r>` run element
  const renderRunHtml = (
    runEl: Element,
    inheritedRunStyle: RunStyle,
    activeRels: Map<string, { target: string; type: string; external: boolean }>
  ): { html: string; hasPageBreak: boolean } => {
    let hasPageBreak = false;
    const rPr = findChild(runEl, 'rPr');
    const runStyle: RunStyle = {
      ...inheritedRunStyle,
      ...parseRunPr(rPr),
    };

    const charStyleId = getAttr(findChild(rPr, 'rStyle'), 'val');
    if (charStyleId && styleMap.has(charStyleId)) {
      Object.assign(runStyle, styleMap.get(charStyleId)!.runStyle, parseRunPr(rPr));
    }

    let inner = '';
    for (let i = 0; i < runEl.children.length; i++) {
      const child = runEl.children[i];
      const ln = child.localName;
      if (ln === 't' || ln === 'delText') {
        inner += escapeHtml(child.textContent || '');
      } else if (ln === 'tab') {
        inner += '<span style="display:inline-block;width:2.2em;">&emsp;</span>';
      } else if (ln === 'br' || ln === 'cr') {
        const brType = getAttr(child, 'type');
        if (brType === 'page') {
          hasPageBreak = true;
        } else {
          inner += '<br/>';
        }
      } else if (ln === 'drawing' || ln === 'pict') {
        inner += renderDrawingHtml(child, activeRels);
      }
    }

    if (!inner) return { html: '', hasPageBreak };
    const css = runStyleToCss(runStyle);
    return {
      html: `<span style="${css}">${inner}</span>`,
      hasPageBreak,
    };
  };

  // Render a `<w:p>` paragraph into one or more RenderedBlocks (splitting if an inline page break occurs)
  const renderParagraphBlocks = (
    pEl: Element,
    activeRels: Map<string, { target: string; type: string; external: boolean }>,
    inTableCell = false
  ): RenderedBlock[] => {
    const pPr = findChild(pEl, 'pPr');
    const pStyleId = getAttr(findChild(pPr, 'pStyle'), 'val');
    const resolvedStyle = resolveParaStyle(pStyleId);
    applyParaPrToStyle(pPr, resolvedStyle);

    // Override paragraph-level run defaults if pPr has rPr
    const pRPr = findChild(pPr, 'rPr');
    if (pRPr) {
      resolvedStyle.runStyle = {
        ...resolvedStyle.runStyle,
        ...parseRunPr(pRPr),
      };
    }

    // Check list numbering marker
    let listBulletHtml = '';
    if (resolvedStyle.numId) {
      const absId = numToAbstractMap.get(resolvedStyle.numId);
      const lvlMap = absId ? abstractNumMap.get(absId) : undefined;
      const ilvl = resolvedStyle.ilvl ?? 0;
      const lvlInfo = lvlMap?.get(ilvl);

      const counterKey = `${resolvedStyle.numId}_${ilvl}`;
      const nextCount = (listCounters.get(counterKey) ?? (lvlInfo?.start ?? 1) - 1) + 1;
      listCounters.set(counterKey, nextCount);

      let markerText = '•';
      if (lvlInfo) {
        if (lvlInfo.numFmt === 'bullet') {
          markerText =
            lvlInfo.lvlText === '\uf0b7' || lvlInfo.lvlText === ''
              ? '•'
              : lvlInfo.lvlText === 'o'
                ? '◦'
                : lvlInfo.lvlText === '\uf0a7'
                  ? '▪'
                  : '•';
        } else {
          const formatted = formatCounter(nextCount, lvlInfo.numFmt);
          markerText = lvlInfo.lvlText.replace(`%${ilvl + 1}`, formatted);
          if (markerText === lvlInfo.lvlText) markerText = `${formatted}.`;
        }
        if (resolvedStyle.indentLeftPx === undefined) {
          resolvedStyle.indentLeftPx = lvlInfo.indentLeftPx;
        }
      }

      const markerCss = runStyleToCss(resolvedStyle.runStyle);
      listBulletHtml = `<span style="display:inline-block;min-width:${fmtNum(18 * scale)}px;padding-right:${fmtNum(6 * scale)}px;${markerCss}">${escapeHtml(markerText)}</span>`;
    }

    const segments: string[] = [];
    let currentSegment = listBulletHtml;

    for (let i = 0; i < pEl.children.length; i++) {
      const child = pEl.children[i];
      const ln = child.localName;

      if (ln === 'r') {
        const { html, hasPageBreak } = renderRunHtml(
          child,
          resolvedStyle.runStyle,
          activeRels
        );
        if (hasPageBreak && currentSegment.trim().length > 0) {
          segments.push(currentSegment);
          currentSegment = html;
        } else {
          currentSegment += html;
          if (hasPageBreak) {
            segments.push(currentSegment);
            currentSegment = '';
          }
        }
      } else if (ln === 'hyperlink') {
        const rId = getAttr(child, 'id') || getAttr(child, 'r:id');
        const anchor = getAttr(child, 'anchor');
        const rel = rId ? activeRels.get(rId) : undefined;
        const href = rel?.target || (anchor ? `#${anchor}` : '#');

        let linkInner = '';
        for (let j = 0; j < child.children.length; j++) {
          if (child.children[j].localName === 'r') {
            linkInner += renderRunHtml(
              child.children[j],
              { ...resolvedStyle.runStyle, color: '#0563c1', underline: true },
              activeRels
            ).html;
          }
        }
        if (linkInner) {
          currentSegment += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:#0563c1;text-decoration:underline;">${linkInner}</a>`;
        }
      } else if (ln === 'sdt' || ln === 'smartTag' || ln === 'ins') {
        const innerRuns = findDescendants(child, 'r');
        for (const r of innerRuns) {
          currentSegment += renderRunHtml(r, resolvedStyle.runStyle, activeRels).html;
        }
      }
    }

    if (currentSegment.length > 0 || segments.length === 0) {
      segments.push(currentSegment);
    }

    const pCss: string[] = ['margin:0', 'word-wrap:break-word', 'overflow-wrap:break-word'];
    if (resolvedStyle.align) pCss.push(`text-align:${resolvedStyle.align}`);
    if (resolvedStyle.spaceBeforePx) {
      pCss.push(`padding-top:${fmtNum(resolvedStyle.spaceBeforePx)}px`);
    }
    const spaceAfter = inTableCell
      ? Math.min(resolvedStyle.spaceAfterPx ?? 0, 4 * scale)
      : (resolvedStyle.spaceAfterPx ?? docDefaultSpaceAfterPx);
    if (spaceAfter > 0) {
      pCss.push(`padding-bottom:${fmtNum(spaceAfter)}px`);
    }
    if (resolvedStyle.lineHeight) {
      pCss.push(`line-height:${resolvedStyle.lineHeight}`);
    }
    if (resolvedStyle.indentLeftPx) {
      pCss.push(`padding-left:${fmtNum(resolvedStyle.indentLeftPx)}px`);
    }
    if (resolvedStyle.indentRightPx) {
      pCss.push(`padding-right:${fmtNum(resolvedStyle.indentRightPx)}px`);
    }
    if (resolvedStyle.indentFirstLinePx) {
      pCss.push(`text-indent:${fmtNum(resolvedStyle.indentFirstLinePx)}px`);
    }
    if (resolvedStyle.backgroundColor) {
      pCss.push(`background-color:${resolvedStyle.backgroundColor}`);
    }
    if (resolvedStyle.borderBottom) {
      pCss.push(`border-bottom:${resolvedStyle.borderBottom};margin-bottom:4px`);
    }

    const plainText = (pEl.textContent || '').trim();
    let headingId: string | undefined;
    let headingTitle: string | undefined;
    let headingLevel: number | undefined;

    if (!inTableCell && resolvedStyle.outlineLevel && plainText.length > 0) {
      headingSeq++;
      headingId = `docx-h-${headingSeq}`;
      headingTitle = plainText;
      headingLevel = resolvedStyle.outlineLevel;
    }

    return segments.map((segHtml, idx) => {
      const innerContent =
        segHtml.trim().length > 0
          ? segHtml
          : `<span style="${runStyleToCss(resolvedStyle.runStyle)}">&nbsp;</span>`;
      const idAttr = idx === 0 && headingId ? ` id="${headingId}"` : '';
      return {
        html: `<div class="docx-p"${idAttr} style="${pCss.join(';')}">${innerContent}</div>`,
        forcePageBreakBefore:
          idx > 0 ? true : Boolean(resolvedStyle.pageBreakBefore),
        headingId: idx === 0 ? headingId : undefined,
        headingTitle: idx === 0 ? headingTitle : undefined,
        headingLevel: idx === 0 ? headingLevel : undefined,
      };
    });
  };

  // Render a `<w:tbl>` table element
  const renderTableBlock = (
    tblEl: Element,
    activeRels: Map<string, { target: string; type: string; external: boolean }>
  ): RenderedBlock => {
    const tblPr = findChild(tblEl, 'tblPr');
    const tblBorders = findChild(tblPr, 'tblBorders');

    const defaultTop = parseBorderCss(findChild(tblBorders, 'top')) || '1px solid #d0d7de';
    const defaultBottom = parseBorderCss(findChild(tblBorders, 'bottom')) || '1px solid #d0d7de';
    const defaultLeft = parseBorderCss(findChild(tblBorders, 'left')) || '1px solid #d0d7de';
    const defaultRight = parseBorderCss(findChild(tblBorders, 'right')) || '1px solid #d0d7de';
    const defaultInsideH = parseBorderCss(findChild(tblBorders, 'insideH')) || '1px solid #d0d7de';
    const defaultInsideV = parseBorderCss(findChild(tblBorders, 'insideV')) || '1px solid #d0d7de';

    const tblGrid = findChild(tblEl, 'tblGrid');
    const gridCols = findChildren(tblGrid, 'gridCol').map((c) =>
      twipsToPx(getAttr(c, 'w'), scale)
    );
    const totalGridWidth = gridCols.reduce((a, b) => a + b, 0);

    const rows = findChildren(tblEl, 'tr');

    // Compute vertical merges (rowspan) across rows
    const rowCells = rows.map((tr) => findChildren(tr, 'tc'));
    const vMergeMatrix: {
      rowSpan: number;
      skip: boolean;
      colSpan: number;
    }[][] = rowCells.map((tcs) =>
      tcs.map((tc) => {
        const tcPr = findChild(tc, 'tcPr');
        const gridSpan = parseInt(getAttr(findChild(tcPr, 'gridSpan'), 'val') || '1', 10);
        return {
          rowSpan: 1,
          skip: false,
          colSpan: Number.isNaN(gridSpan) ? 1 : gridSpan,
        };
      })
    );

    for (let r = 0; r < rowCells.length; r++) {
      let colCursor = 0;
      for (let c = 0; c < rowCells[r].length; c++) {
        const tc = rowCells[r][c];
        const tcPr = findChild(tc, 'tcPr');
        const vMerge = findChild(tcPr, 'vMerge');
        const span = vMergeMatrix[r][c].colSpan;

        if (vMerge) {
          const val = getAttr(vMerge, 'val');
          if (val !== 'restart') {
            vMergeMatrix[r][c].skip = true;
            // Find the starting cell above in the same column
            for (let prevR = r - 1; prevR >= 0; prevR--) {
              let prevCol = 0;
              for (let prevC = 0; prevC < rowCells[prevR].length; prevC++) {
                if (prevCol === colCursor && !vMergeMatrix[prevR][prevC].skip) {
                  vMergeMatrix[prevR][prevC].rowSpan++;
                  prevR = -1;
                  break;
                }
                prevCol += vMergeMatrix[prevR][prevC].colSpan;
              }
            }
          }
        }
        colCursor += span;
      }
    }

    const trHtmlList: string[] = [];

    for (let r = 0; r < rows.length; r++) {
      const tr = rows[r];
      const trPr = findChild(tr, 'trPr');
      const trHeight = twipsToPx(getAttr(findChild(trPr, 'trHeight'), 'val'), scale);
      const isHeaderRow = Boolean(findChild(trPr, 'tblHeader'));

      const tdList: string[] = [];
      let colIndex = 0;

      for (let c = 0; c < rowCells[r].length; c++) {
        const meta = vMergeMatrix[r][c];
        const colSpan = meta.colSpan;
        if (meta.skip) {
          colIndex += colSpan;
          continue;
        }

        const tc = rowCells[r][c];
        const tcPr = findChild(tc, 'tcPr');
        const tcBorders = findChild(tcPr, 'tcBorders');

        const bTop = parseBorderCss(findChild(tcBorders, 'top')) ?? (r === 0 ? defaultTop : defaultInsideH);
        const bBottom =
          parseBorderCss(findChild(tcBorders, 'bottom')) ??
          (r === rows.length - 1 ? defaultBottom : defaultInsideH);
        const bLeft = parseBorderCss(findChild(tcBorders, 'left')) ?? (c === 0 ? defaultLeft : defaultInsideV);
        const bRight =
          parseBorderCss(findChild(tcBorders, 'right')) ??
          (c === rowCells[r].length - 1 ? defaultRight : defaultInsideV);

        const shd = findChild(tcPr, 'shd');
        const bgColor = normalizeColor(
          getAttr(shd, 'fill'),
          themeColors,
          getAttr(shd, 'themeFill')
        );

        const vAlignVal = getAttr(findChild(tcPr, 'vAlign'), 'val');
        const vAlign =
          vAlignVal === 'center'
            ? 'middle'
            : vAlignVal === 'bottom'
              ? 'bottom'
              : 'top';

        let cellWidthPct = '';
        if (totalGridWidth > 0 && gridCols.length > colIndex) {
          let wSum = 0;
          for (let k = 0; k < colSpan && colIndex + k < gridCols.length; k++) {
            wSum += gridCols[colIndex + k];
          }
          if (wSum > 0) {
            cellWidthPct = `width:${fmtNum((wSum / totalGridWidth) * 100, 2)}%;`;
          }
        }

        let cellContentHtml = '';
        for (let k = 0; k < tc.children.length; k++) {
          const child = tc.children[k];
          if (child.localName === 'p') {
            const pBlocks = renderParagraphBlocks(child, activeRels, true);
            cellContentHtml += pBlocks.map((b) => b.html).join('');
          } else if (child.localName === 'tbl') {
            cellContentHtml += renderTableBlock(child, activeRels).html;
          }
        }

        const tdCss = [
          `border-top:${bTop}`,
          `border-bottom:${bBottom}`,
          `border-left:${bLeft}`,
          `border-right:${bRight}`,
          `vertical-align:${vAlign}`,
          `padding:${fmtNum(4 * scale)}px ${fmtNum(6 * scale)}px`,
          cellWidthPct,
          bgColor ? `background-color:${bgColor}` : '',
        ]
          .filter(Boolean)
          .join(';');

        const colSpanAttr = colSpan > 1 ? ` colspan="${colSpan}"` : '';
        const rowSpanAttr = meta.rowSpan > 1 ? ` rowspan="${meta.rowSpan}"` : '';
        const tag = isHeaderRow ? 'th' : 'td';

        tdList.push(
          `<${tag}${colSpanAttr}${rowSpanAttr} style="${tdCss}">${cellContentHtml}</${tag}>`
        );
        colIndex += colSpan;
      }

      const trStyle = trHeight > 0 ? ` style="min-height:${fmtNum(trHeight)}px;"` : '';
      const dataHeader = isHeaderRow ? ' data-tbl-header="1"' : '';
      trHtmlList.push(`<tr${trStyle}${dataHeader}>${tdList.join('')}</tr>`);
    }

    return {
      html: `<table class="docx-tbl" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:${fmtNum(6 * scale)}px 0;"><tbody>${trHtmlList.join('')}</tbody></table>`,
      isTable: true,
    };
  };

  // 7. Render optional Header & Footer HTML
  const renderHeaderFooterXml = async (typeSubstr: string): Promise<string> => {
    const refs = findDescendants(sectPr, `${typeSubstr}Reference`);
    let chosenRid: string | null = null;
    for (const ref of refs) {
      const t = getAttr(ref, 'type');
      const rId = getAttr(ref, 'id') || getAttr(ref, 'r:id');
      if (t === 'default' && rId) {
        chosenRid = rId;
        break;
      }
      if (!chosenRid && rId) chosenRid = rId;
    }
    if (!chosenRid) return '';

    const rel = docRels.get(chosenRid);
    if (!rel) return '';

    const targetPath = `word/${rel.target.replace(/^\.\.\//, '').replace(/^\/?word\//, '')}`;
    const xmlFile = zip.file(targetPath);
    if (!xmlFile) return '';

    const xmlStr = await xmlFile.async('string');
    const relsFileName = targetPath.replace('word/', 'word/_rels/') + '.rels';
    const subRelsStr = (await zip.file(relsFileName)?.async('string')) || '';
    const subRels = subRelsStr ? parseRels(subRelsStr) : docRels;

    const dom = parseXml(xmlStr);
    const root = dom.documentElement;
    const htmlParts: string[] = [];
    for (let i = 0; i < root.children.length; i++) {
      const ch = root.children[i];
      if (ch.localName === 'p') {
        htmlParts.push(...renderParagraphBlocks(ch, subRels, true).map((b) => b.html));
      } else if (ch.localName === 'tbl') {
        htmlParts.push(renderTableBlock(ch, subRels).html);
      }
    }
    return htmlParts.join('');
  };

  const [headerHtml, footerHtml] = await Promise.all([
    renderHeaderFooterXml('header'),
    renderHeaderFooterXml('footer'),
  ]);

  options.onProgress?.(65);

  // 8. Render all body children into blocks
  const blocks: RenderedBlock[] = [];
  for (let i = 0; i < bodyEl.children.length; i++) {
    const child = bodyEl.children[i];
    if (child.localName === 'p') {
      blocks.push(...renderParagraphBlocks(child, docRels, false));
    } else if (child.localName === 'tbl') {
      blocks.push(renderTableBlock(child, docRels));
    }
  }

  // 9. Paginate blocks into discrete `.pf` pages using an offscreen DOM measurer
  const { pagesHtml, outlineItems } = paginateBlocksIntoPages(
    blocks,
    pageGeometry,
    headerHtml,
    footerHtml
  );

  options.onProgress?.(100);

  const outlineHtml = buildOutlineTreeHtml(outlineItems);
  return assembleDocxHtmlDocument(pageGeometry, outlineHtml, pagesHtml.join('\n'));
}

/**
 * Convenience wrapper that returns a downloadable HTML Blob.
 */
export async function convertDocxToHtml(
  file: File | Blob,
  options: DocxToHtmlOptions = {}
): Promise<Blob> {
  const htmlString = await convertDocxToHtmlString(file, options);
  return new Blob([htmlString], { type: 'text/html;charset=utf-8' });
}

/**
 * Measures rendered blocks offscreen and splits them cleanly into discrete `.pf` page frames.
 */
function paginateBlocksIntoPages(
  blocks: RenderedBlock[],
  geom: PageGeometry,
  headerHtml: string,
  footerHtml: string
): { pagesHtml: string[]; outlineItems: OutlineItem[] } {
  const contentWidthPx = Math.max(
    200,
    geom.widthPx - geom.marginLeftPx - geom.marginRightPx
  );

  const measurer = document.createElement('div');
  measurer.style.cssText = `position:fixed;left:-99999px;top:0;width:${contentWidthPx}px;visibility:hidden;pointer-events:none;box-sizing:border-box;`;
  document.body.appendChild(measurer);

  let headerHeightPx = 0;
  let footerHeightPx = 0;

  if (headerHtml) {
    measurer.innerHTML = `<div style="padding-bottom:8px;">${headerHtml}</div>`;
    headerHeightPx = measurer.offsetHeight;
  }
  if (footerHtml) {
    measurer.innerHTML = `<div style="padding-top:8px;">${footerHtml}</div>`;
    footerHeightPx = measurer.offsetHeight;
  }

  const effectiveTopPx = Math.max(
    geom.marginTopPx,
    geom.headerTopPx + headerHeightPx
  );
  const effectiveBottomPx = Math.max(
    geom.marginBottomPx,
    geom.footerBottomPx + footerHeightPx
  );
  const maxPageBodyHeightPx = Math.max(
    240,
    geom.heightPx - effectiveTopPx - effectiveBottomPx
  );

  const pagesContent: string[][] = [[]];
  const outlineItems: OutlineItem[] = [];
  let currentHeightPx = 0;

  const startNewPage = () => {
    if (pagesContent[pagesContent.length - 1].length > 0) {
      pagesContent.push([]);
      currentHeightPx = 0;
    }
  };

  try {
    for (const block of blocks) {
      if (block.forcePageBreakBefore) {
        startNewPage();
      }

      measurer.innerHTML = block.html;
      const blockEl = measurer.firstElementChild as HTMLElement | null;
      const blockHeight = measurer.offsetHeight || 20;

      // Split tall tables row-by-row across pages if needed
      if (
        block.isTable &&
        blockEl &&
        currentHeightPx + blockHeight > maxPageBodyHeightPx
      ) {
        const rows = Array.from(blockEl.querySelectorAll(':scope > tbody > tr'));
        if (rows.length > 1) {
          const headerRowsHtml = rows
            .filter((r) => r.getAttribute('data-tbl-header') === '1')
            .map((r) => r.outerHTML)
            .join('');

          let currentChunkRows: string[] = [];
          for (const row of rows) {
            const candidateRows = [...currentChunkRows, row.outerHTML].join('');
            const tableShell = `<table class="docx-tbl" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:4px 0;"><tbody>${candidateRows}</tbody></table>`;
            measurer.innerHTML = tableShell;
            const candidateHeight = measurer.offsetHeight;

            if (
              currentHeightPx + candidateHeight > maxPageBodyHeightPx &&
              (currentChunkRows.length > 0 || currentHeightPx > 0)
            ) {
              if (currentChunkRows.length > 0) {
                pagesContent[pagesContent.length - 1].push(
                  `<table class="docx-tbl" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:4px 0;"><tbody>${currentChunkRows.join('')}</tbody></table>`
                );
              }
              startNewPage();
              currentChunkRows = headerRowsHtml
                ? [headerRowsHtml, row.outerHTML]
                : [row.outerHTML];
            } else {
              currentChunkRows.push(row.outerHTML);
            }
          }

          if (currentChunkRows.length > 0) {
            const finalTableHtml = `<table class="docx-tbl" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:4px 0;"><tbody>${currentChunkRows.join('')}</tbody></table>`;
            measurer.innerHTML = finalTableHtml;
            currentHeightPx += measurer.offsetHeight;
            pagesContent[pagesContent.length - 1].push(finalTableHtml);
          }
          continue;
        }
      }

      if (
        currentHeightPx + blockHeight > maxPageBodyHeightPx &&
        pagesContent[pagesContent.length - 1].length > 0
      ) {
        startNewPage();
      }

      const pageHex = pagesContent.length.toString(16);
      if (block.headingId && block.headingTitle && block.headingLevel) {
        outlineItems.push({
          id: block.headingId,
          title: block.headingTitle,
          level: block.headingLevel,
          pageHex,
        });
      }

      pagesContent[pagesContent.length - 1].push(block.html);
      currentHeightPx += blockHeight;
    }
  } finally {
    measurer.remove();
  }

  const pagesHtml = pagesContent.map((pageBlocks, idx) => {
    const pageNum = idx + 1;
    const pageHex = pageNum.toString(16);

    const headerBox = headerHtml
      ? `<div class="docx-hf" style="position:absolute;left:${geom.marginLeftPx}px;right:${geom.marginRightPx}px;top:${geom.headerTopPx}px;opacity:0.85;">${headerHtml}</div>`
      : '';
    const footerBox = footerHtml
      ? `<div class="docx-hf" style="position:absolute;left:${geom.marginLeftPx}px;right:${geom.marginRightPx}px;bottom:${geom.footerBottomPx}px;opacity:0.85;">${footerHtml}</div>`
      : '';

    return (
      `<div id="pf${pageHex}" class="pf w0 h0" data-page-no="${pageHex}">` +
        `<div class="pc pc${pageHex} w0 h0">` +
          headerBox +
          `<div class="docx-body" style="position:absolute;left:${geom.marginLeftPx}px;right:${geom.marginRightPx}px;top:${effectiveTopPx}px;bottom:${effectiveBottomPx}px;overflow:hidden;">` +
            pageBlocks.join('') +
          `</div>` +
          footerBox +
        `</div>` +
        `<div class="pi" data-data='{"ctm":[1,0,0,1,0,0]}'></div>` +
      `</div>`
    );
  });

  return { pagesHtml, outlineItems };
}

/**
 * Builds the `#outline` sidebar navigation HTML from extracted Word headings.
 */
function buildOutlineTreeHtml(items: OutlineItem[]): string {
  if (items.length === 0) return '';
  const lis = items.map((item) => {
    const indentEm = Math.max(0, item.level - 1) * 0.85;
    const destDetail = JSON.stringify([
      parseInt(item.pageHex, 16),
      'XYZ',
      null,
      null,
      null,
    ]);
    return `<li style="margin-left:${fmtNum(indentEm)}em"><a class="l" href="#pf${item.pageHex}" data-dest-detail='${destDetail}'>${escapeHtml(item.title)}</a></li>`;
  });
  return `<ul>${lis.join('')}</ul>`;
}

/**
 * Wraps the rendered DOCX pages inside the standalone pdf2htmlEX viewer shell.
 */
function assembleDocxHtmlDocument(
  geom: PageGeometry,
  outlineHtml: string,
  pagesHtml: string
): string {
  const wPt = fmtNum(geom.widthPx * PX_TO_PT);
  const hPt = fmtNum(geom.heightPx * PX_TO_PT);

  return `<!DOCTYPE html>
<!-- Created by pdf2htmlEX (https://github.com/pdf2htmlEX/pdf2htmlEX) -->
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="generator" content="pdf2htmlEX"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1"/>
<style type="text/css">
#sidebar{position:absolute;top:0;left:0;bottom:0;width:250px;padding:0;margin:0;overflow:auto}#page-container{position:absolute;top:0;left:0;margin:0;padding:0;border:0}@media screen{#sidebar.opened+#page-container{left:250px}#page-container{bottom:0;right:0;overflow:auto}.loading-indicator{display:none}}@media print{@page{margin:0}html{margin:0}body{margin:0;-webkit-print-color-adjust:exact}#sidebar{display:none}#page-container{width:auto;height:auto;overflow:visible;background-color:transparent}}.pf{position:relative;background-color:white;overflow:hidden;margin:0;border:0}.pc{position:absolute;border:0;padding:0;margin:0;top:0;left:0;width:100%;height:100%;overflow:hidden;display:block;transform-origin:0 0;-ms-transform-origin:0 0;-webkit-transform-origin:0 0}.pc.opened{display:block}@media print{.pf{margin:0;box-shadow:none;page-break-after:always;page-break-inside:avoid}}::selection{background:rgba(127,255,255,0.4)}::-moz-selection{background:rgba(127,255,255,0.4)}.pi{display:none}
</style>
<style type="text/css">
@keyframes fadein{from{opacity:0}to{opacity:1}}@-webkit-keyframes fadein{from{opacity:0}to{opacity:1}}@media screen{#sidebar{background-color:#2f3236;background-image:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjNDAzYzNmIj48L3JlY3Q+CjxwYXRoIGQ9Ik0wIDBMNCA0Wk00IDBMMCA0WiIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2U9IiMxZTI5MmQiPjwvcGF0aD4KPC9zdmc+")}#outline{font-family:Georgia,Times,"Times New Roman",serif;font-size:13px;margin:2em 1em}#outline ul{padding:0}#outline li{list-style-type:none;margin:0.8em 0}#outline a,#outline a:visited,#outline a:hover,#outline a:active{line-height:1.25;color:#e8e8e8;text-overflow:ellipsis;white-space:nowrap;text-decoration:none;display:block;overflow:hidden;outline:0}#outline a:hover{color:#0cf}#page-container{background-color:#9e9e9e;background-image:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1IiBoZWlnaHQ9IjUiPgo8cmVjdCB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSIjOWU5ZTllIj48L3JlY3Q+CjxwYXRoIGQ9Ik0wIDVMNSAwWk02IDRMNCA2Wk0tMSAxTDEgLTFaIiBzdHJva2U9IiM4ODgiIHN0cm9rZS13aWR0aD0iMSI+PC9wYXRoPgo8L3N2Zz4=");-webkit-transition:left 500ms;transition:left 500ms}.pf{margin:13px auto;box-shadow:1px 1px 3px 1px #333;border-collapse:separate}.pc.opened{-webkit-animation:fadein 100ms;animation:fadein 100ms}}
</style>
<style type="text/css">
.w0{width:${geom.widthPx}px;}
.h0{height:${geom.heightPx}px;}
.docx-body{font-family:Calibri,Arial,sans-serif;color:#000000;box-sizing:border-box;}
.docx-tbl td,.docx-tbl th{box-sizing:border-box;word-wrap:break-word;overflow-wrap:break-word;}
@media print{
.w0{width:${wPt}pt;}
.h0{height:${hPt}pt;}
}
</style>
<script>
(function(){
var pdf2htmlEX=window.pdf2htmlEX=window.pdf2htmlEX||{},CSS_CLASS_NAMES={page_frame:"pf",page_content_box:"pc",page_data:"pi",background_image:"bi",link:"l",input_radio:"ir",__dummy__:"no comma"},DEFAULT_CONFIG={container_id:"page-container",sidebar_id:"sidebar",outline_id:"outline",loading_indicator_cls:"loading-indicator",preload_pages:3,render_timeout:100,scale_step:0.9,key_handler:!0,hashchange_handler:!0,view_history_handler:!0,__dummy__:"no comma"},EPS=1E-6;
function invert(a){var b=a[0]*a[3]-a[1]*a[2];return[a[3]/b,-a[1]/b,-a[2]/b,a[0]/b,(a[2]*a[5]-a[3]*a[4])/b,(a[1]*a[4]-a[0]*a[5])/b]}function transform(a,b){return[a[0]*b[0]+a[2]*b[1]+a[4],a[1]*b[0]+a[3]*b[1]+a[5]]}function get_page_number(a){return parseInt(a.getAttribute("data-page-no"),16)}
function clone_and_extend_objs(a){for(var b={},c=0,e=arguments.length;c<e;++c){var h=arguments[c],d;for(d in h)h.hasOwnProperty(d)&&(b[d]=h[d])}return b}
function Page(a){if(a){this.shown=this.loaded=!1;this.page=a;this.num=get_page_number(a);this.original_height=a.clientHeight;this.original_width=a.clientWidth;var b=a.getElementsByClassName(CSS_CLASS_NAMES.page_content_box)[0];b&&(this.content_box=b,this.original_scale=this.cur_scale=this.original_height/b.clientHeight,this.page_data=JSON.parse(a.getElementsByClassName(CSS_CLASS_NAMES.page_data)[0].getAttribute("data-data")),this.ctm=this.page_data.ctm,this.ictm=invert(this.ctm),this.loaded=!0)}}
Page.prototype={hide:function(){this.loaded&&this.shown&&(this.content_box.classList.remove("opened"),this.shown=!1)},show:function(){this.loaded&&!this.shown&&(this.content_box.classList.add("opened"),this.shown=!0)},rescale:function(a){this.cur_scale=0===a?this.original_scale:a;this.loaded&&(a=this.content_box.style,a.msTransform=a.webkitTransform=a.transform="scale("+this.cur_scale.toFixed(3)+")");a=this.page.style;a.height=this.original_height*this.cur_scale+"px";a.width=this.original_width*this.cur_scale+"px"},
view_position:function(){var a=this.page,b=a.parentNode;return[b.scrollLeft-a.offsetLeft-a.clientLeft,b.scrollTop-a.offsetTop-a.clientTop]},height:function(){return this.page.clientHeight},width:function(){return this.page.clientWidth}};function Viewer(a){this.config=clone_and_extend_objs(DEFAULT_CONFIG,0<arguments.length?a:{});this.pages_loading=[];this.init_before_loading_content();var b=this;document.addEventListener("DOMContentLoaded",function(){b.init_after_loading_content()},!1)}
Viewer.prototype={scale:1,cur_page_idx:0,first_page_idx:0,init_before_loading_content:function(){this.pre_hide_pages()},init_after_loading_content:function(){this.sidebar=document.getElementById(this.config.sidebar_id);this.outline=document.getElementById(this.config.outline_id);this.container=document.getElementById(this.config.container_id);
for(var a=!0,b=this.outline.childNodes,c=0,e=b.length;c<e;++c)if("ul"===b[c].nodeName.toLowerCase()){a=!1;break}a||this.sidebar.classList.add("opened");this.find_pages();if(0!=this.pages.length){this.config.key_handler&&this.register_key_handler();var h=this;this.container.addEventListener("scroll",function(){h.update_page_idx();h.schedule_render(!0)},!1);[this.outline].forEach(function(a){a.addEventListener("click",h.link_handler.bind(h),!1)});this.render()}},find_pages:function(){for(var a=
[],b={},c=this.container.childNodes,e=0,h=c.length;e<h;++e){var d=c[e];d.nodeType===Node.ELEMENT_NODE&&d.classList.contains(CSS_CLASS_NAMES.page_frame)&&(d=new Page(d),a.push(d),b[d.num]=a.length-1)}this.pages=a;this.page_map=b},pre_hide_pages:function(){var a="@media screen{."+CSS_CLASS_NAMES.page_content_box+"{display:none;}}",b=document.createElement("style");b.styleSheet?b.styleSheet.cssText=a:b.appendChild(document.createTextNode(a));document.head.appendChild(b)},render:function(){for(var a=
this.container,b=a.scrollTop,c=a.clientHeight,a=b-c,b=b+c+c,c=this.pages,e=0,h=c.length;e<h;++e){var d=c[e],f=d.page,g=f.offsetTop+f.clientTop,f=g+f.clientHeight;g<=b&&f>=a?d.show():d.hide()}},update_page_idx:function(){var a=this.pages,b=a.length;if(!(2>b)){for(var c=this.container,e=c.scrollTop,c=e+c.clientHeight,h=-1,d=b,f=d-h;1<f;){var g=h+Math.floor(f/2),f=a[g].page;f.offsetTop+f.clientTop+f.clientHeight>=e?d=g:h=g;f=d-h}this.first_page_idx=d;for(var g=h=this.cur_page_idx,k=0;d<b;++d){var f=
a[d].page,l=f.offsetTop+f.clientTop,f=f.clientHeight;if(l>c)break;f=(Math.min(c,l+f)-Math.max(e,l))/f;if(d===h&&Math.abs(f-1)<=EPS){g=h;break}f>k&&(k=f,g=d)}this.cur_page_idx=g}},schedule_render:function(a){if(void 0!==this.render_timer){if(!a)return;clearTimeout(this.render_timer)}var b=this;this.render_timer=setTimeout(function(){delete b.render_timer;b.render()},this.config.render_timeout)},register_key_handler:function(){var a=this;window.addEventListener("DOMMouseScroll",function(b){if(b.ctrlKey){b.preventDefault();
var c=a.container,e=c.getBoundingClientRect(),c=[b.clientX-e.left-c.clientLeft,b.clientY-e.top-c.clientTop];a.rescale(Math.pow(a.config.scale_step,b.detail),!0,c)}},!1);window.addEventListener("keydown",function(b){var c=!1,e=b.ctrlKey||b.metaKey,h=b.altKey;switch(b.keyCode){case 61:case 107:case 187:e&&(a.rescale(1/a.config.scale_step,!0),c=!0);break;case 173:case 109:case 189:e&&(a.rescale(a.config.scale_step,!0),c=!0);break;case 48:e&&(a.rescale(0,!1),c=!0);break;case 33:h?a.scroll_to(a.cur_page_idx-1):
a.container.scrollTop-=a.container.clientHeight;c=!0;break;case 34:h?a.scroll_to(a.cur_page_idx+1):a.container.scrollTop+=a.container.clientHeight;c=!0;break;case 35:a.container.scrollTop=a.container.scrollHeight;c=!0;break;case 36:a.container.scrollTop=0,c=!0}c&&b.preventDefault()},!1)},rescale:function(a,b,c){var e=this.scale;this.scale=a=0===a?1:b?e*a:a;c||(c=[0,0]);b=this.container;c[0]+=b.scrollLeft;c[1]+=b.scrollTop;for(var h=this.pages,d=h.length,f=this.first_page_idx;f<d;++f){var g=h[f].page;
if(g.offsetTop+g.clientTop>=c[1])break}g=f-1;0>g&&(g=0);var g=h[g].page,k=g.clientWidth,f=g.clientHeight,l=g.offsetLeft+g.clientLeft,m=c[0]-l;0>m?m=0:m>k&&(m=k);k=g.offsetTop+g.clientTop;c=c[1]-k;0>c?c=0:c>f&&(c=f);for(f=0;f<d;++f)h[f].rescale(a);b.scrollLeft+=m/e*a+g.offsetLeft+g.clientLeft-m-l;b.scrollTop+=c/e*a+g.offsetTop+g.clientTop-c-k;this.schedule_render(!0)},link_handler:function(a){var b=a.target,c=b.getAttribute("data-dest-detail");if(c){try{var d=JSON.parse(c),p=d[0],idx=this.page_map[p];if(void 0!==idx)this.scroll_to(idx,[0,0])}catch(e){}a.preventDefault()}},scroll_to:function(a,b){var c=this.pages;if(!(0>a||a>=c.length)){c=c[a].view_position();void 0===b&&(b=[0,0]);var e=this.container;e.scrollLeft+=b[0]-c[0];e.scrollTop+=b[1]-c[1]}}};pdf2htmlEX.Viewer=Viewer;})();
</script>
<script>
try{
pdf2htmlEX.defaultViewer = new pdf2htmlEX.Viewer({});
}catch(e){}
</script>
<title></title>
</head>
<body>
<div id="sidebar">
<div id="outline">
${outlineHtml}
</div>
</div>
<div id="page-container">
${pagesHtml}
</div>
</body>
</html>`;
}