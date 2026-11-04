// lib/converters/pdfToHtml.ts

export interface PdfToHtmlOptions {
  /**
   * Page container scale in screen pixels per PDF point.
   * pdf2htmlEX uses 1.5 by default (e.g. 595pt width -> ~892.5px).
   */
  scale?: number;
  /**
   * Canvas supersampling multiplier for background graphics (<img class="bi">).
   * Default 1.0 keeps file size small while HTML text stays vector-sharp.
   */
  backgroundResolutionMultiplier?: number;
  /**
   * Compression quality (0.1 to 1.0) for WebP/JPEG background images. Default: 0.72.
   */
  imageQuality?: number;
  /**
   * 'vector' (default): Suppresses text on the background image and renders crisp visible HTML text (.t) on top.
   * 'hybrid-overlay': Renders full page (including text) into the background image and places transparent selectable HTML text on top.
   */
  textLayerMode?: 'vector' | 'hybrid-overlay';
  /**
   * Optional progress callback (0 to 100).
   */
  onProgress?: (percent: number) => void;
}

interface CapturedGlyph {
  char: string;
  x: number;
  y: number;
  width: number;
  fontSizePx: number;
  renderedFontSizePx: number;
  fontLoadedName: string;
  colorRgb: string;
  matrix: [number, number, number, number];
  ascentRatio: number;
  descentRatio: number;
}

interface CapturedFont {
  id: number;
  loadedName: string;
  base64Data: string | null;
  mimeType: string;
  fallbackFamily: string;
  lineHeight: number;
  ascentRatio: number;
  descentRatio: number;
  isBold: boolean;
  isItalic: boolean;
}

const MATRIX_SCALE = 0.375; // Standard pdf2htmlEX sub-pixel font scaling factor (1.5 / 4)
const PX_TO_PT = 72 / 81;   // pdf2htmlEX screen-px to print-pt ratio (8 / 9)

/**
 * Formats a number to at most `decimals` places, stripping trailing zeros to save CSS bytes.
 */
function fmtNum(val: number, decimals = 2): string {
  return Number(val.toFixed(decimals)).toString();
}

/**
 * Fast FNV-1a 32-bit hash to deduplicate identical embedded font binaries across pages.
 */
function hashFontBytes(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.byteLength}_${(hash >>> 0).toString(16)}`;
}

/**
 * Checks whether the rendered background canvas is completely white (no graphics/borders left).
 */
function isCanvasAllWhite(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 252 || data[i + 1] < 252 || data[i + 2] < 252) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Compresses the background canvas using WebP (or JPEG fallback) and picks the smallest encoding.
 */
function encodeCompressedCanvas(
  canvas: HTMLCanvasElement,
  quality: number
): string {
  const webpUrl = canvas.toDataURL('image/webp', quality);
  if (webpUrl.startsWith('data:image/webp')) {
    return webpUrl;
  }
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Converts a Uint8Array into a Base64 string safely in the browser.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Normalizes any CSS color string (hex, rgb, rgba) to "rgb(r,g,b)".
 */
function normalizeCssColor(color: string | CanvasGradient | CanvasPattern): string {
  if (typeof color !== 'string') return 'rgb(0,0,0)';
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    const num = parseInt(hex.slice(0, 6), 16);
    if (Number.isNaN(num)) return 'rgb(0,0,0)';
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgb(${r},${g},${b})`;
  }
  const rgbMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return `rgb(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]})`;
  }
  return 'rgb(0,0,0)';
}

/**
 * Escapes text for safe HTML injection.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Pool manager that deduplicates numeric values or strings into hex-indexed CSS classes (.x0, .y1, .fs2, etc.)
 */
class CssPool<T extends number | string> {
  private map = new Map<string, { index: number; value: T }>();
  private list: { index: number; value: T }[] = [];
  private precision: number;

  constructor(precision = 1) {
    this.precision = precision;
  }

  getIndex(val: T): number {
    const key =
      typeof val === 'number' ? val.toFixed(this.precision) : String(val);
    const existing = this.map.get(key);
    if (existing !== undefined) {
      return existing.index;
    }
    const index = this.list.length;
    const normalizedVal =
      typeof val === 'number'
        ? (Number(val.toFixed(this.precision)) as T)
        : val;
    const entry = { index, value: normalizedVal };
    this.map.set(key, entry);
    this.list.push(entry);
    return index;
  }

  entries(): { index: number; hex: string; value: T }[] {
    return this.list.map((item) => ({
      index: item.index,
      hex: item.index.toString(16),
      value: item.value,
    }));
  }
}

/**
 * Converts a PDF File/Blob/ArrayBuffer into a standalone pdf2htmlEX-formatted HTML string.
 */
export async function convertPdfToHtmlString(
  input: File | Blob | ArrayBuffer,
  options: PdfToHtmlOptions = {}
): Promise<string> {
  const displayScale = options.scale ?? 1.5;
  const bgMultiplier = options.backgroundResolutionMultiplier ?? 1.0;
  const imageQuality = options.imageQuality ?? 0.72;
  const textLayerMode = options.textLayerMode ?? 'vector';

  const pdfjsLib = await import('pdfjs-dist');

  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }

  const arrayBuffer =
    input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  // Intercept window.FontFace so we can capture embedded OpenType/TrueType font binaries from pdf.js
  const capturedFontBinaries = new Map<string, Uint8Array>();
  const OriginalFontFace =
    typeof window !== 'undefined' ? window.FontFace : undefined;

  if (typeof window !== 'undefined' && OriginalFontFace) {
    const PatchedFontFace = function (
      family: string,
      source: string | ArrayBuffer | Uint8Array,
      descriptors?: FontFaceDescriptors
    ) {
      try {
        const cleanFamily = family.replace(/^["']|["']$/g, '');
        if (source instanceof Uint8Array) {
          capturedFontBinaries.set(cleanFamily, new Uint8Array(source));
        } else if (source instanceof ArrayBuffer) {
          capturedFontBinaries.set(cleanFamily, new Uint8Array(source));
        } else if (ArrayBuffer.isView(source)) {
          capturedFontBinaries.set(
            cleanFamily,
            new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
          );
        }
      } catch {
        // Ignore font capture errors and proceed
      }
      return new (OriginalFontFace as any)(family, source, descriptors);
    } as unknown as typeof FontFace;

    PatchedFontFace.prototype = OriginalFontFace.prototype;
    window.FontFace = PatchedFontFace;
  }

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useSystemFonts: true,
      cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`,
    });

    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;

    // CSS class pools with compact 0.1px precision to maximize class reuse across pages
    const widthPool = new CssPool<number>(1);
    const heightPool = new CssPool<number>(1);
    const xPool = new CssPool<number>(1);
    const yPool = new CssPool<number>(1);
    const fontSizePool = new CssPool<number>(1);
    const colorPool = new CssPool<string>();
    const matrixPool = new CssPool<string>();
    const spaceWidthPool = new CssPool<number>(1);

    const fontMap = new Map<string, CapturedFont>();
    const fontHashToCaptured = new Map<string, CapturedFont>();

    // Ensure default m0 matrix (0.375, 0, 0, 0.375) and fc0 color exist
    matrixPool.getIndex(`${MATRIX_SCALE},0,0,${MATRIX_SCALE}`);
    colorPool.getIndex('rgb(0,0,0)');

    const getOrRegisterFont = (
      loadedName: string,
      page: any,
      rawCssFont: string
    ): CapturedFont => {
      const cleanName = loadedName.replace(/^["']|["']$/g, '');
      const existing = fontMap.get(cleanName);
      if (existing) return existing;

      let fontObj: any = null;
      try {
        if (page.commonObjs?.has(cleanName)) {
          fontObj = page.commonObjs.get(cleanName);
        }
      } catch {
        // Fallback if commonObj not resolved
      }

      let rawBytes = capturedFontBinaries.get(cleanName) ?? null;
      if (!rawBytes && fontObj?.data instanceof Uint8Array) {
        rawBytes = fontObj.data;
      }

      // Deduplicate identical font binaries across pages
      if (rawBytes && rawBytes.byteLength > 0) {
        const hash = hashFontBytes(rawBytes);
        const deduplicated = fontHashToCaptured.get(hash);
        if (deduplicated) {
          fontMap.set(cleanName, deduplicated);
          return deduplicated;
        }
      }

      const realName = (fontObj?.name || rawCssFont || '').toLowerCase();
      const isSerif =
        realName.includes('times') ||
        realName.includes('serif') ||
        realName.includes('georgia') ||
        realName.includes('cambria') ||
        realName.includes('garamond');
      const isMono =
        realName.includes('courier') ||
        realName.includes('mono') ||
        realName.includes('consolas');
      const fallbackFamily = isMono
        ? 'monospace'
        : isSerif
          ? 'serif'
          : 'sans-serif';

      const isBold =
        realName.includes('bold') ||
        realName.includes('black') ||
        realName.includes('heavy') ||
        /\bbold\b/i.test(rawCssFont);
      const isItalic =
        realName.includes('italic') ||
        realName.includes('oblique') ||
        /\b(italic|oblique)\b/i.test(rawCssFont);

      let ascentRatio = 0.92;
      let descentRatio = 0.22;
      if (typeof fontObj?.ascent === 'number' && fontObj.ascent > 0) {
        ascentRatio = fontObj.ascent;
      }
      if (typeof fontObj?.descent === 'number') {
        descentRatio = Math.abs(fontObj.descent);
      }

      const id = fontHashToCaptured.size + fontMap.size + 1;
      const captured: CapturedFont = {
        id,
        loadedName: cleanName,
        base64Data: rawBytes ? uint8ToBase64(rawBytes) : null,
        mimeType: 'application/font-woff',
        fallbackFamily,
        lineHeight: Number(Math.max(0.7, Math.min(1.35, ascentRatio)).toFixed(3)),
        ascentRatio,
        descentRatio,
        isBold,
        isItalic,
      };

      if (rawBytes && rawBytes.byteLength > 0) {
        fontHashToCaptured.set(hashFontBytes(rawBytes), captured);
      }
      fontMap.set(cleanName, captured);
      return captured;
    };

    const pagesHtml: string[] = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const displayViewport = page.getViewport({ scale: displayScale });
      const renderScale = displayScale * bgMultiplier;
      const renderViewport = page.getViewport({ scale: renderScale });

      const pageWidthPx = Number(displayViewport.width.toFixed(1));
      const pageHeightPx = Number(displayViewport.height.toFixed(1));

      const wIdx = widthPool.getIndex(pageWidthPx);
      const hIdx = heightPool.getIndex(pageHeightPx);
      const x0Idx = xPool.getIndex(0);
      const y0Idx = yPool.getIndex(0);

      // Create canvas for background rendering and pre-fill with solid white for clean WebP/JPEG compression
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      const realCtx = canvas.getContext('2d', { willReadFrequently: true })!;
      realCtx.fillStyle = '#ffffff';
      realCtx.fillRect(0, 0, canvas.width, canvas.height);

      const capturedGlyphs: CapturedGlyph[] = [];

      // Proxy the 2D context to intercept text drawing commands
      const proxyCtx = new Proxy(realCtx, {
        get(target, prop, receiver) {
          if (prop === 'fillText' || prop === 'strokeText') {
            return function (text: string, x: number, y: number, maxWidth?: number) {
              if (prop === 'fillText' && text && text.length > 0) {
                const m = target.getTransform();
                const inv = 1 / bgMultiplier;
                const a = m.a * inv;
                const b = m.b * inv;
                const c = m.c * inv;
                const d = m.d * inv;
                const e = m.e * inv;
                const f = m.f * inv;

                const px = a * x + c * y + e;
                const py = b * x + d * y + f;
                const bottomY = pageHeightPx - py;

                const scaleY = Math.hypot(c, d);
                const scaleX = Math.hypot(a, b);

                if (scaleY > 0.0001 && scaleX > 0.0001) {
                  const rawFont = target.font || '10px sans-serif';
                  const sizeMatch = rawFont.match(/([\d.]+)px/);
                  const canvasFontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 10;

                  const familyMatch = rawFont.match(/px\s+([^,]+)/);
                  const rawFamily = familyMatch
                    ? familyMatch[1].replace(/\b(normal|bold|italic|oblique)\b/gi, '').trim()
                    : 'sans-serif';

                  const fontInfo = getOrRegisterFont(rawFamily, page, rawFont);
                  const renderedFontSizePx = canvasFontSize * scaleY;
                  const unscaledFontSizePx = renderedFontSizePx / MATRIX_SCALE;

                  const ma = (a / scaleY) * MATRIX_SCALE;
                  const mb = (b / scaleY) * MATRIX_SCALE;
                  const mc = (c / scaleY) * MATRIX_SCALE;
                  const md = (d / scaleY) * MATRIX_SCALE;

                  const metrics = target.measureText(text);
                  const advanceWidthPx = metrics.width * scaleX;

                  capturedGlyphs.push({
                    char: text,
                    x: px,
                    y: bottomY,
                    width: advanceWidthPx,
                    fontSizePx: unscaledFontSizePx,
                    renderedFontSizePx,
                    fontLoadedName: fontInfo.loadedName,
                    colorRgb: normalizeCssColor(target.fillStyle),
                    matrix: [ma, mb, mc, md],
                    ascentRatio: fontInfo.ascentRatio,
                    descentRatio: fontInfo.descentRatio,
                  });
                }
              }

              if (textLayerMode === 'hybrid-overlay') {
                return (target as any)[prop](text, x, y, maxWidth);
              }
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, prop, value) {
          return Reflect.set(target, prop, value);
        },
      });

      await page.render({
        canvas,
        canvasContext: proxyCtx,
        viewport: renderViewport,
      }).promise;

      // Only emit <img class="bi"> if the page actually has non-white background graphics/images
      const bgImgHtml = isCanvasAllWhite(realCtx, canvas.width, canvas.height)
        ? ''
        : `<img class="bi x${x0Idx.toString(16)} y${y0Idx.toString(16)} w${wIdx.toString(16)} h${hIdx.toString(16)}" alt="" src="${encodeCompressedCanvas(canvas, imageQuality)}"/>`;

      const textDivsHtml = buildPageTextDivs(
        capturedGlyphs,
        fontMap,
        xPool,
        yPool,
        heightPool,
        fontSizePool,
        colorPool,
        matrixPool,
        spaceWidthPool
      );

      const annotations = await page.getAnnotations();
      const linksHtml = buildPageLinksHtml(
        annotations,
        displayViewport,
        pageHeightPx
      );

      const pageHex = pageNum.toString(16);
      const scaleVal = Number(displayScale.toFixed(4));
      const ctmJson = JSON.stringify({
        ctm: [scaleVal, 0, 0, scaleVal, 0, 0],
      });

      pagesHtml.push(
        `<div id="pf${pageHex}" class="pf w${wIdx.toString(16)} h${hIdx.toString(16)}" data-page-no="${pageHex}">` +
          `<div class="pc pc${pageHex} w${wIdx.toString(16)} h${hIdx.toString(16)}">` +
            bgImgHtml +
            `<div class="c x${x0Idx.toString(16)} y${y0Idx.toString(16)} w${wIdx.toString(16)} h${hIdx.toString(16)}">` +
              textDivsHtml +
            `</div>` +
            linksHtml +
          `</div>` +
          `<div class="pi" data-data='${ctmJson}'></div>` +
        `</div>`
      );

      options.onProgress?.(Math.round((pageNum / numPages) * 100));
    }

    const outlineHtml = await buildOutlineHtml(pdf);

    const dynamicCss = buildDynamicCss({
      fontMap,
      widthPool,
      heightPool,
      xPool,
      yPool,
      fontSizePool,
      colorPool,
      matrixPool,
      spaceWidthPool,
      textLayerMode,
    });

    return assemblePdf2HtmlExDocument(dynamicCss, outlineHtml, pagesHtml.join('\n'));
  } finally {
    if (typeof window !== 'undefined' && OriginalFontFace) {
      window.FontFace = OriginalFontFace;
    }
  }
}

/**
 * Convenience wrapper that returns a downloadable HTML Blob.
 */
export async function convertPdfToHtml(
  file: File | Blob,
  options: PdfToHtmlOptions = {}
): Promise<Blob> {
  const htmlString = await convertPdfToHtmlString(file, options);
  return new Blob([htmlString], { type: 'text/html;charset=utf-8' });
}

/**
 * Groups individual glyphs on the same baseline into pdf2htmlEX `<div class="t ...">` line blocks.
 */
function buildPageTextDivs(
  glyphs: CapturedGlyph[],
  fontMap: Map<string, CapturedFont>,
  xPool: CssPool<number>,
  yPool: CssPool<number>,
  heightPool: CssPool<number>,
  fontSizePool: CssPool<number>,
  colorPool: CssPool<string>,
  matrixPool: CssPool<string>,
  spaceWidthPool: CssPool<number>
): string {
  if (glyphs.length === 0) return '';

  interface LineGroup {
    matrixStr: string;
    baselineY: number;
    glyphs: CapturedGlyph[];
  }

  const lines: LineGroup[] = [];

  for (const g of glyphs) {
    const mStr = g.matrix.map((v) => fmtNum(v, 4)).join(',');
    const lastLine = lines[lines.length - 1];

    const isHorizontal =
      Math.abs(g.matrix[1]) < 0.001 && Math.abs(g.matrix[2]) < 0.001;

    if (
      lastLine &&
      isHorizontal &&
      lastLine.matrixStr === mStr &&
      Math.abs(lastLine.baselineY - g.y) <= 0.75
    ) {
      const prevGlyph = lastLine.glyphs[lastLine.glyphs.length - 1];
      const expectedNextX = prevGlyph.x + prevGlyph.width;
      const gap = g.x - expectedNextX;
      if (gap >= -g.renderedFontSizePx * 0.8 && gap <= g.renderedFontSizePx * 4.5) {
        lastLine.glyphs.push(g);
        continue;
      }
    }

    lines.push({
      matrixStr: mStr,
      baselineY: g.y,
      glyphs: [g],
    });
  }

  const divStrings: string[] = [];

  for (const line of lines) {
    const first = line.glyphs[0];
    const fontInfo = fontMap.get(first.fontLoadedName);
    const ffId = fontInfo ? fontInfo.id : 1;

    const mIdx = matrixPool.getIndex(line.matrixStr);
    const xIdx = xPool.getIndex(first.x);

    const descentOffsetPx = first.renderedFontSizePx * (first.descentRatio * 0.85);
    const adjustedBottomPx = first.y - descentOffsetPx;
    const yIdx = yPool.getIndex(adjustedBottomPx);

    const unscaledBoxHeight =
      first.fontSizePx * (first.ascentRatio + first.descentRatio * 0.25);
    const hIdx = heightPool.getIndex(unscaledBoxHeight);
    const fsIdx = fontSizePool.getIndex(first.fontSizePx);
    const fcIdx = colorPool.getIndex(first.colorRgb);

    let innerHtml = '';
    let curFfId = ffId;
    let curFsIdx = fsIdx;
    let curFcIdx = fcIdx;
    let spanOpen = false;

    for (let i = 0; i < line.glyphs.length; i++) {
      const g = line.glyphs[i];
      const gFont = fontMap.get(g.fontLoadedName);
      const gFfId = gFont ? gFont.id : 1;
      const gFsIdx = fontSizePool.getIndex(g.fontSizePx);
      const gFcIdx = colorPool.getIndex(g.colorRgb);

      if (i > 0) {
        const prev = line.glyphs[i - 1];
        const gapPx = g.x - (prev.x + prev.width);
        const unscaledGapPx = gapPx / MATRIX_SCALE;
        const spaceThreshold = g.renderedFontSizePx * 0.16;

        if (gapPx > spaceThreshold) {
          const defaultSpaceWidth = g.fontSizePx * 0.25;
          const extraSpace = unscaledGapPx - defaultSpaceWidth;
          if (Math.abs(extraSpace) > 0.45) {
            const spIdx = spaceWidthPool.getIndex(extraSpace);
            innerHtml += `<span class="_ _${spIdx.toString(16)}"> </span>`;
          } else {
            innerHtml += ' ';
          }
        } else if (Math.abs(unscaledGapPx) > 0.55) {
          const spIdx = spaceWidthPool.getIndex(unscaledGapPx);
          innerHtml += `<span class="_ _${spIdx.toString(16)}"></span>`;
        }
      }

      if (gFfId !== curFfId || gFsIdx !== curFsIdx || gFcIdx !== curFcIdx) {
        if (spanOpen) innerHtml += '</span>';
        const classes: string[] = [];
        if (gFfId !== ffId) classes.push(`ff${gFfId.toString(16)}`);
        if (gFsIdx !== fsIdx) classes.push(`fs${gFsIdx.toString(16)}`);
        if (gFcIdx !== fcIdx) classes.push(`fc${gFcIdx.toString(16)}`);
        if (classes.length > 0) {
          innerHtml += `<span class="${classes.join(' ')}">`;
          spanOpen = true;
        } else {
          spanOpen = false;
        }
        curFfId = gFfId;
        curFsIdx = gFsIdx;
        curFcIdx = gFcIdx;
      }

      innerHtml += escapeHtml(g.char);
    }

    if (spanOpen) innerHtml += '</span>';

    divStrings.push(
      `<div class="t m${mIdx.toString(16)} x${xIdx.toString(16)} h${hIdx.toString(16)} y${yIdx.toString(16)} ff${ffId.toString(16)} fs${fsIdx.toString(16)} fc${fcIdx.toString(16)} sc0 ls0 ws0">${innerHtml}</div>`
    );
  }

  return divStrings.join('');
}

/**
 * Builds clickable `<a class="l">` link overlays from PDF annotations.
 */
function buildPageLinksHtml(
  annotations: any[],
  viewport: any,
  pageHeightPx: number
): string {
  const links: string[] = [];
  if (!Array.isArray(annotations)) return '';

  for (const annot of annotations) {
    if (annot?.subtype !== 'Link' || !Array.isArray(annot.rect) || annot.rect.length < 4) {
      continue;
    }
    const href = annot.url || annot.unsafeUrl;
    if (!href) continue;

    let x1: number, y1: number, x2: number, y2: number;
    const t = viewport?.transform;

    if (typeof viewport?.convertToViewportRectangle === 'function') {
      [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annot.rect);
    } else if (Array.isArray(t) && t.length === 6) {
      const [a, b, c, d, e, f] = t;
      x1 = a * annot.rect[0] + c * annot.rect[1] + e;
      y1 = b * annot.rect[0] + d * annot.rect[1] + f;
      x2 = a * annot.rect[2] + c * annot.rect[3] + e;
      y2 = b * annot.rect[2] + d * annot.rect[3] + f;
    } else {
      const scale = viewport?.scale ?? 1.5;
      x1 = annot.rect[0] * scale;
      y1 = pageHeightPx - annot.rect[1] * scale;
      x2 = annot.rect[2] * scale;
      y2 = pageHeightPx - annot.rect[3] * scale;
    }

    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    const width = right - left;
    const height = bottom - top;
    const bottomPx = pageHeightPx - bottom;

    links.push(
      `<a class="l" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">` +
        `<div class="d" style="border-style:none;position:absolute;left:${fmtNum(left)}px;bottom:${fmtNum(bottomPx)}px;width:${fmtNum(width)}px;height:${fmtNum(height)}px;background-color:rgba(255,255,255,0.000001);"></div>` +
      `</a>`
    );
  }
  return links.join('');
}

/**
 * Builds the `#outline` sidebar HTML from the PDF's bookmark tree.
 */
async function buildOutlineHtml(pdf: any): Promise<string> {
  try {
    const outline = await pdf.getOutline();
    if (!outline || outline.length === 0) return '';

    const renderItems = async (items: any[]): Promise<string> => {
      const lis: string[] = [];
      for (const item of items) {
        let pageHex = '1';
        try {
          let dest = item.dest;
          if (typeof dest === 'string') {
            dest = await pdf.getDestination(dest);
          }
          if (Array.isArray(dest) && dest[0]) {
            const pageIndex = await pdf.getPageIndex(dest[0]);
            pageHex = (pageIndex + 1).toString(16);
          }
        } catch {
          // Default to page 1 if destination lookup fails
        }
        const childrenHtml =
          item.items && item.items.length > 0
            ? await renderItems(item.items)
            : '';
        const destDetail = JSON.stringify([parseInt(pageHex, 16), 'XYZ', null, null, null]);
        lis.push(
          `<li><a class="l" href="#pf${pageHex}" data-dest-detail='${destDetail}'>${escapeHtml(item.title || 'Section')}</a>${childrenHtml}</li>`
        );
      }
      return `<ul>${lis.join('')}</ul>`;
    };

    return await renderItems(outline);
  } catch {
    return '';
  }
}

/**
 * Generates the third `<style>` block with deduplicated `@font-face` declarations and compact CSS rules.
 */
function buildDynamicCss(params: {
  fontMap: Map<string, CapturedFont>;
  widthPool: CssPool<number>;
  heightPool: CssPool<number>;
  xPool: CssPool<number>;
  yPool: CssPool<number>;
  fontSizePool: CssPool<number>;
  colorPool: CssPool<string>;
  matrixPool: CssPool<string>;
  spaceWidthPool: CssPool<number>;
  textLayerMode: 'vector' | 'hybrid-overlay';
}): string {
  const lines: string[] = [];
  lines.push('.ff0{font-family:sans-serif;visibility:hidden;}');

  // Emit each unique font ID once
  const emittedFontIds = new Set<number>();
  for (const font of params.fontMap.values()) {
    if (emittedFontIds.has(font.id)) continue;
    emittedFontIds.add(font.id);

    const ffHex = font.id.toString(16);
    const weight = font.isBold ? 'bold' : 'normal';
    const style = font.isItalic ? 'italic' : 'normal';

    if (font.base64Data) {
      lines.push(
        `@font-face{font-family:ff${ffHex};src:url('data:${font.mimeType};base64,${font.base64Data}')format("opentype");}`
      );
      lines.push(
        `.ff${ffHex}{font-family:ff${ffHex},${font.fallbackFamily};line-height:${font.lineHeight};font-style:${style};font-weight:${weight};visibility:visible;}`
      );
    } else {
      lines.push(
        `.ff${ffHex}{font-family:${font.fallbackFamily};line-height:${font.lineHeight};font-style:${style};font-weight:${weight};visibility:visible;}`
      );
    }
  }

  for (const m of params.matrixPool.entries()) {
    lines.push(
      `.m${m.hex}{transform:matrix(${m.value},0,0);-ms-transform:matrix(${m.value},0,0);-webkit-transform:matrix(${m.value},0,0);}`
    );
  }

  lines.push('.v0{vertical-align:0;}');
  lines.push('.ls0{letter-spacing:0;}');
  lines.push('.sc_{text-shadow:none;}');
  lines.push(
    '.sc0{text-shadow:-0.015em 0 transparent,0 0.015em transparent,0.015em 0 transparent,0 -0.015em transparent;}'
  );
  lines.push(
    '@media screen and (-webkit-min-device-pixel-ratio:0){.sc_{-webkit-text-stroke:0px transparent;}.sc0{-webkit-text-stroke:0.015em transparent;text-shadow:none;}}'
  );
  lines.push('.ws0{word-spacing:0;}');

  for (const sp of params.spaceWidthPool.entries()) {
    if (sp.value < 0) {
      lines.push(`._${sp.hex}{margin-left:${fmtNum(sp.value)}px;}`);
    } else {
      lines.push(`._${sp.hex}{width:${fmtNum(sp.value)}px;}`);
    }
  }

  for (const fc of params.colorPool.entries()) {
    const colorVal =
      params.textLayerMode === 'hybrid-overlay' ? 'transparent' : fc.value;
    lines.push(`.fc${fc.hex}{color:${colorVal};}`);
  }

  for (const fs of params.fontSizePool.entries()) {
    lines.push(`.fs${fs.hex}{font-size:${fmtNum(fs.value)}px;}`);
  }

  for (const y of params.yPool.entries()) {
    lines.push(`.y${y.hex}{bottom:${fmtNum(y.value)}px;}`);
  }

  for (const h of params.heightPool.entries()) {
    lines.push(`.h${h.hex}{height:${fmtNum(h.value)}px;}`);
  }

  for (const w of params.widthPool.entries()) {
    lines.push(`.w${w.hex}{width:${fmtNum(w.value)}px;}`);
  }

  for (const x of params.xPool.entries()) {
    lines.push(`.x${x.hex}{left:${fmtNum(x.value)}px;}`);
  }

  // @media print rules in pt
  lines.push('@media print{');
  lines.push('.v0{vertical-align:0;}');
  lines.push('.ls0{letter-spacing:0;}');
  lines.push('.ws0{word-spacing:0;}');

  for (const sp of params.spaceWidthPool.entries()) {
    const ptVal = fmtNum(sp.value * PX_TO_PT);
    if (sp.value < 0) {
      lines.push(`._${sp.hex}{margin-left:${ptVal}pt;}`);
    } else {
      lines.push(`._${sp.hex}{width:${ptVal}pt;}`);
    }
  }

  for (const fs of params.fontSizePool.entries()) {
    lines.push(`.fs${fs.hex}{font-size:${fmtNum(fs.value * PX_TO_PT)}pt;}`);
  }

  for (const y of params.yPool.entries()) {
    lines.push(`.y${y.hex}{bottom:${fmtNum(y.value * PX_TO_PT)}pt;}`);
  }

  for (const h of params.heightPool.entries()) {
    lines.push(`.h${h.hex}{height:${fmtNum(h.value * PX_TO_PT)}pt;}`);
  }

  for (const w of params.widthPool.entries()) {
    lines.push(`.w${w.hex}{width:${fmtNum(w.value * PX_TO_PT)}pt;}`);
  }

  for (const x of params.xPool.entries()) {
    lines.push(`.x${x.hex}{left:${fmtNum(x.value * PX_TO_PT)}pt;}`);
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Assembles the final standalone HTML file using the exact pdf2htmlEX CSS and JS viewer template.
 */
function assemblePdf2HtmlExDocument(
  dynamicCss: string,
  outlineHtml: string,
  pagesHtml: string
): string {
  return `<!DOCTYPE html>
<!-- Created by pdf2htmlEX (https://github.com/pdf2htmlEX/pdf2htmlEX) -->
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="generator" content="pdf2htmlEX"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1"/>
<style type="text/css">
/*! 
 * Base CSS for pdf2htmlEX
 * Copyright 2012,2013 Lu Wang <coolwanglu@gmail.com> 
 * https://github.com/pdf2htmlEX/pdf2htmlEX/blob/master/share/LICENSE
 */#sidebar{position:absolute;top:0;left:0;bottom:0;width:250px;padding:0;margin:0;overflow:auto}#page-container{position:absolute;top:0;left:0;margin:0;padding:0;border:0}@media screen{#sidebar.opened+#page-container{left:250px}#page-container{bottom:0;right:0;overflow:auto}.loading-indicator{display:none}.loading-indicator.active{display:block;position:absolute;width:64px;height:64px;top:50%;left:50%;margin-top:-32px;margin-left:-32px}.loading-indicator img{position:absolute;top:0;left:0;bottom:0;right:0}}@media print{@page{margin:0}html{margin:0}body{margin:0;-webkit-print-color-adjust:exact}#sidebar{display:none}#page-container{width:auto;height:auto;overflow:visible;background-color:transparent}.d{display:none}}.pf{position:relative;background-color:white;overflow:hidden;margin:0;border:0}.pc{position:absolute;border:0;padding:0;margin:0;top:0;left:0;width:100%;height:100%;overflow:hidden;display:block;transform-origin:0 0;-ms-transform-origin:0 0;-webkit-transform-origin:0 0}.pc.opened{display:block}.bf{position:absolute;border:0;margin:0;top:0;bottom:0;width:100%;height:100%;-ms-user-select:none;-moz-user-select:none;-webkit-user-select:none;user-select:none}.bi{position:absolute;border:0;margin:0;-ms-user-select:none;-moz-user-select:none;-webkit-user-select:none;user-select:none}@media print{.pf{margin:0;box-shadow:none;page-break-after:always;page-break-inside:avoid}@-moz-document url-prefix(){.pf{overflow:visible;border:1px solid #fff}.pc{overflow:visible}}}.c{position:absolute;border:0;padding:0;margin:0;overflow:hidden;display:block}.t{position:absolute;white-space:pre;font-size:1px;transform-origin:0 100%;-ms-transform-origin:0 100%;-webkit-transform-origin:0 100%;unicode-bidi:bidi-override;-moz-font-feature-settings:"liga" 0}.t:after{content:''}.t:before{content:'';display:inline-block}.t span{position:relative;unicode-bidi:bidi-override}._{display:inline-block;color:transparent;z-index:-1}::selection{background:rgba(127,255,255,0.4)}::-moz-selection{background:rgba(127,255,255,0.4)}.pi{display:none}.d{position:absolute;transform-origin:0 100%;-ms-transform-origin:0 100%;-webkit-transform-origin:0 100%}.it{border:0;background-color:rgba(255,255,255,0.0)}.ir:hover{cursor:pointer}</style>
<style type="text/css">
/*! 
 * Fancy styles for pdf2htmlEX
 * Copyright 2012,2013 Lu Wang <coolwanglu@gmail.com> 
 * https://github.com/pdf2htmlEX/pdf2htmlEX/blob/master/share/LICENSE
 */@keyframes fadein{from{opacity:0}to{opacity:1}}@-webkit-keyframes fadein{from{opacity:0}to{opacity:1}}@keyframes swing{0{transform:rotate(0)}10%{transform:rotate(0)}90%{transform:rotate(720deg)}100%{transform:rotate(720deg)}}@-webkit-keyframes swing{0{-webkit-transform:rotate(0)}10%{-webkit-transform:rotate(0)}90%{-webkit-transform:rotate(720deg)}100%{-webkit-transform:rotate(720deg)}}@media screen{#sidebar{background-color:#2f3236;background-image:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjNDAzYzNmIj48L3JlY3Q+CjxwYXRoIGQ9Ik0wIDBMNCA0Wk00IDBMMCA0WiIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2U9IiMxZTI5MmQiPjwvcGF0aD4KPC9zdmc+")}#outline{font-family:Georgia,Times,"Times New Roman",serif;font-size:13px;margin:2em 1em}#outline ul{padding:0}#outline li{list-style-type:none;margin:1em 0}#outline li>ul{margin-left:1em}#outline a,#outline a:visited,#outline a:hover,#outline a:active{line-height:1.2;color:#e8e8e8;text-overflow:ellipsis;white-space:nowrap;text-decoration:none;display:block;overflow:hidden;outline:0}#outline a:hover{color:#0cf}#page-container{background-color:#9e9e9e;background-image:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1IiBoZWlnaHQ9IjUiPgo8cmVjdCB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSIjOWU5ZTllIj48L3JlY3Q+CjxwYXRoIGQ9Ik0wIDVMNSAwWk02IDRMNCA2Wk0tMSAxTDEgLTFaIiBzdHJva2U9IiM4ODgiIHN0cm9rZS13aWR0aD0iMSI+PC9wYXRoPgo8L3N2Zz4=");-webkit-transition:left 500ms;transition:left 500ms}.pf{margin:13px auto;box-shadow:1px 1px 3px 1px #333;border-collapse:separate}.pc.opened{-webkit-animation:fadein 100ms;animation:fadein 100ms}.loading-indicator.active{-webkit-animation:swing 1.5s ease-in-out .01s infinite alternate none;animation:swing 1.5s ease-in-out .01s infinite alternate none}}</style>
<style type="text/css">
${dynamicCss}
</style>
<script>
(function(){function b(a,b,e,f){var c=(a.className||"").split(/\\s+/g);""===c[0]&&c.shift();var d=c.indexOf(b);0>d&&e&&c.push(b);0<=d&&f&&c.splice(d,1);a.className=c.join(" ");return 0<=d}if(!("classList"in document.createElement("div"))){var e={add:function(a){b(this.element,a,!0,!1)},contains:function(a){return b(this.element,a,!1,!1)},remove:function(a){b(this.element,a,!1,!0)},toggle:function(a){b(this.element,a,!0,!0)}};Object.defineProperty(HTMLElement.prototype,"classList",{get:function(){if(this._classList)return this._classList;
var a=Object.create(e,{element:{value:this,writable:!1,enumerable:!0}});Object.defineProperty(this,"_classList",{value:a,writable:!1,enumerable:!1});return a},enumerable:!0})}})();
</script>
<script>
(function(){
var pdf2htmlEX=window.pdf2htmlEX=window.pdf2htmlEX||{},CSS_CLASS_NAMES={page_frame:"pf",page_content_box:"pc",page_data:"pi",background_image:"bi",link:"l",input_radio:"ir",__dummy__:"no comma"},DEFAULT_CONFIG={container_id:"page-container",sidebar_id:"sidebar",outline_id:"outline",loading_indicator_cls:"loading-indicator",preload_pages:3,render_timeout:100,scale_step:0.9,key_handler:!0,hashchange_handler:!0,view_history_handler:!0,__dummy__:"no comma"},EPS=1E-6;
function invert(a){var b=a[0]*a[3]-a[1]*a[2];return[a[3]/b,-a[1]/b,-a[2]/b,a[0]/b,(a[2]*a[5]-a[3]*a[4])/b,(a[1]*a[4]-a[0]*a[5])/b]}function transform(a,b){return[a[0]*b[0]+a[2]*b[1]+a[4],a[1]*b[0]+a[3]*b[1]+a[5]]}function get_page_number(a){return parseInt(a.getAttribute("data-page-no"),16)}function disable_dragstart(a){for(var b=0,c=a.length;b<c;++b)a[b].addEventListener("dragstart",function(){return!1},!1)}
function clone_and_extend_objs(a){for(var b={},c=0,e=arguments.length;c<e;++c){var h=arguments[c],d;for(d in h)h.hasOwnProperty(d)&&(b[d]=h[d])}return b}
function Page(a){if(a){this.shown=this.loaded=!1;this.page=a;this.num=get_page_number(a);this.original_height=a.clientHeight;this.original_width=a.clientWidth;var b=a.getElementsByClassName(CSS_CLASS_NAMES.page_content_box)[0];b&&(this.content_box=b,this.original_scale=this.cur_scale=this.original_height/b.clientHeight,this.page_data=JSON.parse(a.getElementsByClassName(CSS_CLASS_NAMES.page_data)[0].getAttribute("data-data")),this.ctm=this.page_data.ctm,this.ictm=invert(this.ctm),this.loaded=!0)}}
Page.prototype={hide:function(){this.loaded&&this.shown&&(this.content_box.classList.remove("opened"),this.shown=!1)},show:function(){this.loaded&&!this.shown&&(this.content_box.classList.add("opened"),this.shown=!0)},rescale:function(a){this.cur_scale=0===a?this.original_scale:a;this.loaded&&(a=this.content_box.style,a.msTransform=a.webkitTransform=a.transform="scale("+this.cur_scale.toFixed(3)+")");a=this.page.style;a.height=this.original_height*this.cur_scale+"px";a.width=this.original_width*this.cur_scale+"px"},
view_position:function(){var a=this.page,b=a.parentNode;return[b.scrollLeft-a.offsetLeft-a.clientLeft,b.scrollTop-a.offsetTop-a.clientTop]},height:function(){return this.page.clientHeight},width:function(){return this.page.clientWidth}};function Viewer(a){this.config=clone_and_extend_objs(DEFAULT_CONFIG,0<arguments.length?a:{});this.pages_loading=[];this.init_before_loading_content();var b=this;document.addEventListener("DOMContentLoaded",function(){b.init_after_loading_content()},!1)}
Viewer.prototype={scale:1,cur_page_idx:0,first_page_idx:0,init_before_loading_content:function(){this.pre_hide_pages()},initialize_radio_button:function(){for(var a=document.getElementsByClassName(CSS_CLASS_NAMES.input_radio),b=0;b<a.length;b++)a[b].addEventListener("click",function(){this.classList.toggle("checked")})},init_after_loading_content:function(){this.sidebar=document.getElementById(this.config.sidebar_id);this.outline=document.getElementById(this.config.outline_id);this.container=document.getElementById(this.config.container_id);
this.loading_indicator=document.getElementsByClassName(this.config.loading_indicator_cls)[0];for(var a=!0,b=this.outline.childNodes,c=0,e=b.length;c<e;++c)if("ul"===b[c].nodeName.toLowerCase()){a=!1;break}a||this.sidebar.classList.add("opened");this.find_pages();if(0!=this.pages.length){disable_dragstart(document.getElementsByClassName(CSS_CLASS_NAMES.background_image));this.config.key_handler&&this.register_key_handler();var h=this;this.config.hashchange_handler&&window.addEventListener("hashchange",
function(a){h.navigate_to_dest(document.location.hash.substring(1))},!1);this.config.view_history_handler&&window.addEventListener("popstate",function(a){a.state&&h.navigate_to_dest(a.state)},!1);this.container.addEventListener("scroll",function(){h.update_page_idx();h.schedule_render(!0)},!1);[this.outline].concat(Array.from(this.container.querySelectorAll("a.l"))).forEach(function(a){a.addEventListener("click",h.link_handler.bind(h),!1)});this.initialize_radio_button();this.render()}},find_pages:function(){for(var a=
[],b={},c=this.container.childNodes,e=0,h=c.length;e<h;++e){var d=c[e];d.nodeType===Node.ELEMENT_NODE&&d.classList.contains(CSS_CLASS_NAMES.page_frame)&&(d=new Page(d),a.push(d),b[d.num]=a.length-1)}this.pages=a;this.page_map=b},pre_hide_pages:function(){var a="@media screen{."+CSS_CLASS_NAMES.page_content_box+"{display:none;}}",b=document.createElement("style");b.styleSheet?b.styleSheet.cssText=a:b.appendChild(document.createTextNode(a));document.head.appendChild(b)},render:function(){for(var a=
this.container,b=a.scrollTop,c=a.clientHeight,a=b-c,b=b+c+c,c=this.pages,e=0,h=c.length;e<h;++e){var d=c[e],f=d.page,g=f.offsetTop+f.clientTop,f=g+f.clientHeight;g<=b&&f>=a?d.show():d.hide()}},update_page_idx:function(){var a=this.pages,b=a.length;if(!(2>b)){for(var c=this.container,e=c.scrollTop,c=e+c.clientHeight,h=-1,d=b,f=d-h;1<f;){var g=h+Math.floor(f/2),f=a[g].page;f.offsetTop+f.clientTop+f.clientHeight>=e?d=g:h=g;f=d-h}this.first_page_idx=d;for(var g=h=this.cur_page_idx,k=0;d<b;++d){var f=
a[d].page,l=f.offsetTop+f.clientTop,f=f.clientHeight;if(l>c)break;f=(Math.min(c,l+f)-Math.max(e,l))/f;if(d===h&&Math.abs(f-1)<=EPS){g=h;break}f>k&&(k=f,g=d)}this.cur_page_idx=g}},schedule_render:function(a){if(void 0!==this.render_timer){if(!a)return;clearTimeout(this.render_timer)}var b=this;this.render_timer=setTimeout(function(){delete b.render_timer;b.render()},this.config.render_timeout)},register_key_handler:function(){var a=this;window.addEventListener("DOMMouseScroll",function(b){if(b.ctrlKey){b.preventDefault();
var c=a.container,e=c.getBoundingClientRect(),c=[b.clientX-e.left-c.clientLeft,b.clientY-e.top-c.clientTop];a.rescale(Math.pow(a.config.scale_step,b.detail),!0,c)}},!1);window.addEventListener("keydown",function(b){var c=!1,e=b.ctrlKey||b.metaKey,h=b.altKey;switch(b.keyCode){case 61:case 107:case 187:e&&(a.rescale(1/a.config.scale_step,!0),c=!0);break;case 173:case 109:case 189:e&&(a.rescale(a.config.scale_step,!0),c=!0);break;case 48:e&&(a.rescale(0,!1),c=!0);break;case 33:h?a.scroll_to(a.cur_page_idx-1):
a.container.scrollTop-=a.container.clientHeight;c=!0;break;case 34:h?a.scroll_to(a.cur_page_idx+1):a.container.scrollTop+=a.container.clientHeight;c=!0;break;case 35:a.container.scrollTop=a.container.scrollHeight;c=!0;break;case 36:a.container.scrollTop=0,c=!0}c&&b.preventDefault()},!1)},rescale:function(a,b,c){var e=this.scale;this.scale=a=0===a?1:b?e*a:a;c||(c=[0,0]);b=this.container;c[0]+=b.scrollLeft;c[1]+=b.scrollTop;for(var h=this.pages,d=h.length,f=this.first_page_idx;f<d;++f){var g=h[f].page;
if(g.offsetTop+g.clientTop>=c[1])break}g=f-1;0>g&&(g=0);var g=h[g].page,k=g.clientWidth,f=g.clientHeight,l=g.offsetLeft+g.clientLeft,m=c[0]-l;0>m?m=0:m>k&&(m=k);k=g.offsetTop+g.clientTop;c=c[1]-k;0>c?c=0:c>f&&(c=f);for(f=0;f<d;++f)h[f].rescale(a);b.scrollLeft+=m/e*a+g.offsetLeft+g.clientLeft-m-l;b.scrollTop+=c/e*a+g.offsetTop+g.clientTop-c-k;this.schedule_render(!0)},fit_width:function(){var a=this.cur_page_idx;this.rescale(this.container.clientWidth/this.pages[a].width(),!0);this.scroll_to(a)},
fit_height:function(){var a=this.cur_page_idx;this.rescale(this.container.clientHeight/this.pages[a].height(),!0);this.scroll_to(a)},get_containing_page:function(a){for(;a;){if(a.nodeType===Node.ELEMENT_NODE&&a.classList.contains(CSS_CLASS_NAMES.page_frame)){a=get_page_number(a);var b=this.page_map;return a in b?this.pages[b[a]]:null}a=a.parentNode}return null},link_handler:function(a){var b=a.target,c=b.getAttribute("data-dest-detail");c||(b=a.currentTarget,c=b.getAttribute("data-dest-detail"));
if(c){if(this.config.view_history_handler)try{var e=this.get_current_view_hash();window.history.replaceState(e,"","#"+e);window.history.pushState(c,"","#"+c)}catch(h){}this.navigate_to_dest(c,this.get_containing_page(b));a.preventDefault()}},navigate_to_dest:function(a,b){try{var c=JSON.parse(a)}catch(e){return}if(c instanceof Array){var h=c[0],d=this.page_map;if(h in d){for(var f=d[h],h=this.pages[f],d=2,g=c.length;d<g;++d){var k=c[d];if(null!==k&&"number"!==typeof k)return}for(;6>c.length;)c.push(null);
var g=b||this.pages[this.cur_page_idx],d=g.view_position(),d=transform(g.ictm,[d[0],g.height()-d[1]]),g=this.scale,l=[0,0],m=!0,k=!1,n=this.scale;switch(c[1]){case "XYZ":l=[null===c[2]?d[0]:c[2]*n,null===c[3]?d[1]:c[3]*n];g=c[4];if(null===g||0===g)g=this.scale;k=!0;break;case "Fit":case "FitB":l=[0,0];k=!0;break;case "FitH":case "FitBH":l=[0,null===c[2]?d[1]:c[2]*n];k=!0;break;case "FitV":case "FitBV":l=[null===c[2]?d[0]:c[2]*n,0];k=!0;break;case "FitR":l=[c[2]*n,c[5]*n],m=!1,k=!0}if(k){this.rescale(g,!1);
var p=this,c=function(a){l=transform(a.ctm,l);m&&(l[1]=a.height()-l[1]);p.scroll_to(f,l)};h.loaded&&c(h)}}}},scroll_to:function(a,b){var c=this.pages;if(!(0>a||a>=c.length)){c=c[a].view_position();void 0===b&&(b=[0,0]);var e=this.container;e.scrollLeft+=b[0]-c[0];e.scrollTop+=b[1]-c[1]}},get_current_view_hash:function(){var a=[],b=this.pages[this.cur_page_idx];a.push(b.num);a.push("XYZ");var c=b.view_position(),c=transform(b.ictm,[c[0],b.height()-c[1]]);a.push(c[0]/this.scale);a.push(c[1]/this.scale);
a.push(this.scale);return JSON.stringify(a)}};pdf2htmlEX.Viewer=Viewer;})();
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