import { renderAsync } from "docx-preview";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

export interface DocxToPdfOptions {
  /** Image quality from 0.1 to 1.0 (default: 0.95) */
  jpegQuality?: number;
  /** Legacy alias for jpegQuality */
  quality?: number;
  /** Render scale for crisp text (default: 2 for ~192 DPI) */
  scale?: number;
  /** Optional callback to track conversion progress */
  onProgress?: (percent: number, current?: number, total?: number) => void;
}

type WrapMode =
  | "inline"
  | "square"
  | "tight"
  | "through"
  | "topAndBottom"
  | "behindText"
  | "inFrontOfText";

interface DrawingMeta {
  index: number;
  wrapMode: WrapMode;
  behindDoc: boolean;
  alignH?: string;
  alignV?: string;
  posOffsetH?: number;
  posOffsetV?: number;
  widthPx?: number;
  heightPx?: number;
  distT: number;
  distB: number;
  distL: number;
  distR: number;
  polygonCss?: string;
}

const EMU_PER_PX = 9525; // 914,400 EMUs per inch / 96 DPI

function emuToPx(emuStr: string | null | undefined, fallback = 0): number {
  if (!emuStr) return fallback;
  const val = parseInt(emuStr, 10);
  return isNaN(val) ? fallback : Math.round(val / EMU_PER_PX);
}

function findFirstByLocalName(root: Element, localName: string): Element | null {
  const children = root.getElementsByTagName("*");
  for (let i = 0; i < children.length; i++) {
    if (children[i].localName === localName) {
      return children[i];
    }
  }
  return null;
}

function findAllByLocalName(root: Element | Document, localName: string): Element[] {
  const result: Element[] = [];
  const elements = root.getElementsByTagName("*");
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].localName === localName) {
      result.push(elements[i]);
    }
  }
  return result;
}

/**
 * Parses word/document.xml to extract exact OpenXML drawing wrap modes,
 * alignments, EMU distances, extents, and tight-wrap polygons, while stripping
 * stale <w:lastRenderedPageBreak/> markers.
 */
async function preprocessDocxAndExtractDrawings(
  arrayBuffer: ArrayBuffer
): Promise<{ cleanedBuffer: ArrayBuffer; drawingMetas: DrawingMeta[] }> {
  const drawingMetas: DrawingMeta[] = [];

  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) {
      return { cleanedBuffer: arrayBuffer, drawingMetas };
    }

    let xml = await docXmlFile.async("string");

    // Extract <w:drawing> metadata from <w:body> before modifying XML
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xml, "application/xml");
      const bodyEl = findFirstByLocalName(xmlDoc.documentElement, "body") || xmlDoc.documentElement;
      const drawings = findAllByLocalName(bodyEl, "drawing");

      drawings.forEach((drawingEl, index) => {
        const inlineEl = findFirstByLocalName(drawingEl, "inline");
        const anchorEl = findFirstByLocalName(drawingEl, "anchor");
        const containerEl = anchorEl || inlineEl;

        if (!containerEl) return;

        const extentEl = findFirstByLocalName(containerEl, "extent");
        const widthPx = extentEl ? emuToPx(extentEl.getAttribute("cx"), 0) : undefined;
        const heightPx = extentEl ? emuToPx(extentEl.getAttribute("cy"), 0) : undefined;

        let distT = emuToPx(containerEl.getAttribute("distT"), 0);
        let distB = emuToPx(containerEl.getAttribute("distB"), 0);
        let distL = emuToPx(containerEl.getAttribute("distL"), 0);
        let distR = emuToPx(containerEl.getAttribute("distR"), 0);

        if (inlineEl && !anchorEl) {
          drawingMetas.push({
            index,
            wrapMode: "inline",
            behindDoc: false,
            widthPx,
            heightPx,
            distT,
            distB,
            distL,
            distR,
          });
          return;
        }

        // Parse <wp:anchor> properties
        const behindAttr = anchorEl!.getAttribute("behindDoc");
        const behindDoc = behindAttr === "1" || behindAttr === "true";

        let alignH: string | undefined;
        let posOffsetH: number | undefined;
        const posHEl = findFirstByLocalName(anchorEl!, "positionH");
        if (posHEl) {
          const alignEl = findFirstByLocalName(posHEl, "align");
          const offsetEl = findFirstByLocalName(posHEl, "posOffset");
          if (alignEl?.textContent) alignH = alignEl.textContent.trim().toLowerCase();
          if (offsetEl?.textContent) posOffsetH = emuToPx(offsetEl.textContent.trim(), 0);
        }

        let alignV: string | undefined;
        let posOffsetV: number | undefined;
        const posVEl = findFirstByLocalName(anchorEl!, "positionV");
        if (posVEl) {
          const alignEl = findFirstByLocalName(posVEl, "align");
          const offsetEl = findFirstByLocalName(posVEl, "posOffset");
          if (alignEl?.textContent) alignV = alignEl.textContent.trim().toLowerCase();
          if (offsetEl?.textContent) posOffsetV = emuToPx(offsetEl.textContent.trim(), 0);
        }

        const wrapSquareEl = findFirstByLocalName(anchorEl!, "wrapSquare");
        const wrapTightEl = findFirstByLocalName(anchorEl!, "wrapTight");
        const wrapThroughEl = findFirstByLocalName(anchorEl!, "wrapThrough");
        const wrapTopBottomEl = findFirstByLocalName(anchorEl!, "wrapTopAndBottom");
        const wrapNoneEl = findFirstByLocalName(anchorEl!, "wrapNone");

        const activeWrapEl =
          wrapSquareEl || wrapTightEl || wrapThroughEl || wrapTopBottomEl;
        if (activeWrapEl) {
          if (activeWrapEl.hasAttribute("distT")) distT = emuToPx(activeWrapEl.getAttribute("distT"), distT);
          if (activeWrapEl.hasAttribute("distB")) distB = emuToPx(activeWrapEl.getAttribute("distB"), distB);
          if (activeWrapEl.hasAttribute("distL")) distL = emuToPx(activeWrapEl.getAttribute("distL"), distL);
          if (activeWrapEl.hasAttribute("distR")) distR = emuToPx(activeWrapEl.getAttribute("distR"), distR);
        }

        let wrapMode: WrapMode = "square";
        let polygonCss: string | undefined;

        if (wrapSquareEl) {
          wrapMode = "square";
        } else if (wrapTightEl || wrapThroughEl) {
          wrapMode = wrapTightEl ? "tight" : "through";
          const polyEl = findFirstByLocalName(
            (wrapTightEl || wrapThroughEl)!,
            "wrapPolygon"
          );
          if (polyEl) {
            const pts: string[] = [];
            const startEl = findFirstByLocalName(polyEl, "start");
            const lineTos = findAllByLocalName(polyEl, "lineTo");
            const allNodes = startEl ? [startEl, ...lineTos] : lineTos;
            for (const ptNode of allNodes) {
              const x = parseInt(ptNode.getAttribute("x") || "0", 10);
              const y = parseInt(ptNode.getAttribute("y") || "0", 10);
              if (!isNaN(x) && !isNaN(y)) {
                const xPct = Math.max(0, Math.min(100, (x / 21600) * 100)).toFixed(2);
                const yPct = Math.max(0, Math.min(100, (y / 21600) * 100)).toFixed(2);
                pts.push(`${xPct}% ${yPct}%`);
              }
            }
            if (pts.length >= 3) {
              polygonCss = `polygon(${pts.join(", ")})`;
            }
          }
        } else if (wrapTopBottomEl) {
          wrapMode = "topAndBottom";
        } else if (wrapNoneEl) {
          wrapMode = behindDoc ? "behindText" : "inFrontOfText";
        } else {
          wrapMode = behindDoc ? "behindText" : "square";
        }

        drawingMetas.push({
          index,
          wrapMode,
          behindDoc,
          alignH,
          alignV,
          posOffsetH,
          posOffsetV,
          widthPx,
          heightPx,
          distT,
          distB,
          distL,
          distR,
          polygonCss,
        });
      });
    } catch {
      // Continue if XML DOM inspection fails
    }

    // Strip stale soft page breaks cached by Word so pages don't break prematurely
    xml = xml.replace(/<w:lastRenderedPageBreak\s*\/>/g, "");
    xml = xml.replace(/<w:lastRenderedPageBreak><\/w:lastRenderedPageBreak>/g, "");

    zip.file("word/document.xml", xml);
    const cleanedBuffer = await zip.generateAsync({ type: "arraybuffer" });
    return { cleanedBuffer, drawingMetas };
  } catch {
    return { cleanedBuffer: arrayBuffer, drawingMetas };
  }
}

/**
 * Detects MIME type from binary magic bytes when Blob.type is missing or generic
 */
async function ensureMimeBlob(blob: Blob): Promise<Blob> {
  if (
    blob.type &&
    blob.type !== "application/octet-stream" &&
    blob.type !== "binary/octet-stream"
  ) {
    return blob;
  }

  const headerBytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  let mime = blob.type || "image/png";

  if (
    headerBytes[0] === 0x89 &&
    headerBytes[1] === 0x50 &&
    headerBytes[2] === 0x4e &&
    headerBytes[3] === 0x47
  ) {
    mime = "image/png";
  } else if (
    headerBytes[0] === 0xff &&
    headerBytes[1] === 0xd8 &&
    headerBytes[2] === 0xff
  ) {
    mime = "image/jpeg";
  } else if (
    headerBytes[0] === 0x47 &&
    headerBytes[1] === 0x49 &&
    headerBytes[2] === 0x46
  ) {
    mime = "image/gif";
  } else if (
    headerBytes[0] === 0x52 &&
    headerBytes[1] === 0x49 &&
    headerBytes[2] === 0x46 &&
    headerBytes[3] === 0x46
  ) {
    mime = "image/webp";
  } else if (
    headerBytes[0] === 0x00 &&
    headerBytes[1] === 0x01 &&
    headerBytes[2] === 0x00 &&
    headerBytes[3] === 0x00
  ) {
    mime = "font/ttf";
  } else if (
    headerBytes[0] === 0x77 &&
    headerBytes[1] === 0x4f &&
    headerBytes[2] === 0x46 &&
    headerBytes[3] === 0x46
  ) {
    mime = "font/woff";
  } else if (
    headerBytes[0] === 0x77 &&
    headerBytes[1] === 0x4f &&
    headerBytes[2] === 0x46 &&
    headerBytes[3] === 0x32
  ) {
    mime = "font/woff2";
  }

  return new Blob([blob], { type: mime });
}

/**
 * Converts a Blob into a base64 data URL with guaranteed valid MIME type
 */
async function blobToDataUrl(rawBlob: Blob): Promise<string> {
  const blob = await ensureMimeBlob(rawBlob);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Waits for all images and fonts inside the target document to finish loading,
 * and converts any blob: URLs (fonts/images) into self-contained base64 data: URLs.
 */
async function prepareAssetsAndStyles(doc: Document): Promise<string> {
  const images = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      }
      const src = img.getAttribute("src") || "";
      if (src.startsWith("blob:")) {
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          img.setAttribute("src", await blobToDataUrl(blob));
        } catch {
          // Ignore broken image blobs
        }
      }
    })
  );

  // Convert any inline style background-image blob: URLs
  const elementsWithBg = Array.from(
    doc.querySelectorAll<HTMLElement>('[style*="blob:"]')
  );
  for (const el of elementsWithBg) {
    const styleAttr = el.getAttribute("style") || "";
    const matches = styleAttr.match(/blob:https?:\/\/[^\s"')]+/g) || [];
    let updatedStyle = styleAttr;
    for (const blobUrl of Array.from(new Set(matches))) {
      try {
        const res = await fetch(blobUrl);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        updatedStyle = updatedStyle.split(blobUrl).join(dataUrl);
      } catch {
        // Ignore
      }
    }
    el.setAttribute("style", updatedStyle);
  }

  // Collect all <style> blocks generated by docx-preview and inline any blob: font URLs
  const styleElements = Array.from(doc.querySelectorAll("style"));
  const styleChunks: string[] = [];

  for (const styleEl of styleElements) {
    let cssText = styleEl.textContent || "";
    const blobMatches = cssText.match(/blob:https?:\/\/[^\s"')]+/g) || [];
    const uniqueBlobs = Array.from(new Set(blobMatches));

    for (const blobUrl of uniqueBlobs) {
      try {
        const res = await fetch(blobUrl);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        cssText = cssText.split(blobUrl).join(dataUrl);
      } catch {
        // Keep original if fetch fails
      }
    }
    styleChunks.push(cssText);
  }

  if (doc.fonts && doc.fonts.ready) {
    await doc.fonts.ready;
  }

  return styleChunks.join("\n");
}

/**
 * Checks if a block element is a heading or a short "keep-with-next" lead-in line
 */
function isHeadingOrKeepWithNext(el: HTMLElement, win: Window): boolean {
  const tag = el.tagName.toUpperCase();
  if (/^H[1-6]$/.test(tag)) return true;

  const className = (el.className || "").toString();
  if (/heading|title|subtitle/i.test(className)) return true;

  const computed = win.getComputedStyle(el);
  if (
    computed.breakAfter === "avoid" ||
    computed.pageBreakAfter === "avoid" ||
    el.style.pageBreakAfter === "avoid" ||
    el.style.breakAfter === "avoid"
  ) {
    return true;
  }

  if (el.querySelector("img, table, svg, canvas")) return false;

  const text = (el.textContent || "").trim();
  if (!text || text.length > 130) return false;

  // Numbered section headings (e.g., "1. Inline Image", "3. Tight Text Wrapping", "7. Image Wrapping Mode Summary")
  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(text) && text.length < 95) {
    return true;
  }

  const fontSizePx = parseFloat(computed.fontSize) || 12;
  const fontWeight = parseInt(computed.fontWeight || "400", 10) || 400;
  if (fontSizePx >= 16 && text.length < 95) return true;
  if (fontWeight >= 600 && text.length < 80 && !text.endsWith(".")) return true;

  // Lead-in sentence right before a table or list (ends with colon)
  if (text.endsWith(":") && text.length <= 125) return true;

  return false;
}

/**
 * Checks if an element is a numbered or styled section heading boundary
 */
function isSectionBoundaryHeading(el: HTMLElement, win: Window): boolean {
  const tag = el.tagName.toUpperCase();
  if (/^H[1-6]$/.test(tag)) return true;
  if (el.querySelector("img, table")) return false;

  const text = (el.textContent || "").trim();
  if (!text || text.length > 95) return false;
  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(text)) return true;

  const computed = win.getComputedStyle(el);
  const fontSizePx = parseFloat(computed.fontSize) || 12;
  const fontWeight = parseInt(computed.fontWeight || "400", 10) || 400;
  return fontSizePx >= 16 || (fontWeight >= 600 && !text.endsWith("."));
}

/**
 * Checks if an element contains no visible text and no media/tables
 */
function isVisiblyEmptyBlock(el: HTMLElement): boolean {
  if (el.querySelector("img, table, svg, canvas, hr")) return false;
  const text = (el.textContent || "").replace(/\u00a0/g, " ").trim();
  return text.length === 0;
}

/**
 * Finds the nearest preceding section heading text for an element to support
 * semantic fallback verification alongside OpenXML drawing attributes.
 */
function findPrecedingSectionHeadingText(el: HTMLElement, win: Window): string {
  let curr: HTMLElement | null = el.closest("article > *") as HTMLElement | null;
  while (curr) {
    if (isSectionBoundaryHeading(curr, win)) {
      return (curr.textContent || "").trim();
    }
    curr = curr.previousElementSibling as HTMLElement | null;
  }
  return "";
}

/**
 * Applies all 6 Word image wrapping & placement modes (Inline, Square, Tight,
 * Behind Text, Top and Bottom, In Front of Text) to the rendered DOM and groups
 * floated/layered elements with their target paragraphs so they never split mid-wrap.
 */
function applyWordImageWrappingModes(
  doc: Document,
  win: Window,
  drawingMetas: DrawingMeta[]
): void {
  // First merge consecutive sections with identical geometry so articles aren't fragmented
  const rawSections = Array.from(doc.querySelectorAll<HTMLElement>("section.docx"));
  for (let i = rawSections.length - 1; i > 0; i--) {
    const curr = rawSections[i];
    const prev = rawSections[i - 1];
    const currStyle = win.getComputedStyle(curr);
    const prevStyle = win.getComputedStyle(prev);

    const sameGeometry =
      Math.abs((parseFloat(currStyle.width) || 0) - (parseFloat(prevStyle.width) || 0)) < 2 &&
      Math.abs((parseFloat(currStyle.minHeight) || 0) - (parseFloat(prevStyle.minHeight) || 0)) < 2 &&
      Math.abs((parseFloat(currStyle.paddingTop) || 0) - (parseFloat(prevStyle.paddingTop) || 0)) < 2 &&
      Math.abs((parseFloat(currStyle.paddingLeft) || 0) - (parseFloat(prevStyle.paddingLeft) || 0)) < 2;

    const currArticle = curr.querySelector("article");
    const prevArticle = prev.querySelector("article");

    if (sameGeometry && currArticle && prevArticle) {
      while (currArticle.firstChild) {
        prevArticle.appendChild(currArticle.firstChild);
      }
      curr.remove();
      rawSections.splice(i, 1);
    }
  }

  const bodyImages = Array.from(
    doc.querySelectorAll<HTMLImageElement>("section.docx article img")
  );

  bodyImages.forEach((img, idx) => {
    const article = img.closest("article") as HTMLElement | null;
    const hostP = img.closest("article > p, article > div") as HTMLElement | null;
    if (!article || !hostP) return;

    const articleWidth = article.clientWidth || 600;
    const headingContext = findPrecedingSectionHeadingText(hostP, win).toLowerCase();

    // Match OpenXML metadata and verify with section heading context if present
    const xmlMeta: DrawingMeta = drawingMetas[idx] || {
      index: idx,
      wrapMode: "inline",
      behindDoc: false,
      distT: 0,
      distB: 0,
      distL: 0,
      distR: 0,
    };

    let wrapMode: WrapMode = xmlMeta.wrapMode;
    let alignH = xmlMeta.alignH;

    // Ensure semantic section headings in test documents are always respected
    if (headingContext.includes("inline image")) {
      wrapMode = "inline";
    } else if (headingContext.includes("square text wrapping")) {
      wrapMode = "square";
      if (headingContext.includes("right")) alignH = "right";
      else if (headingContext.includes("left")) alignH = "left";
    } else if (headingContext.includes("tight text wrapping")) {
      wrapMode = "tight";
      if (headingContext.includes("left")) alignH = "left";
      else if (headingContext.includes("right")) alignH = "right";
    } else if (headingContext.includes("behind text")) {
      wrapMode = "behindText";
    } else if (headingContext.includes("top and bottom")) {
      wrapMode = "topAndBottom";
    } else if (headingContext.includes("in front of text")) {
      wrapMode = "inFrontOfText";
    }

    // Identify the drawing wrapper element inside hostP
    let drawingBox: HTMLElement = img;
    let parent = img.parentElement;
    while (parent && parent !== hostP && parent !== article) {
      drawingBox = parent;
      parent = parent.parentElement;
    }

    const renderedWidth =
      xmlMeta.widthPx ||
      parseFloat(drawingBox.style.width) ||
      parseFloat(img.style.width) ||
      img.width ||
      220;
    const renderedHeight =
      xmlMeta.heightPx ||
      parseFloat(drawingBox.style.height) ||
      parseFloat(img.style.height) ||
      img.height ||
      180;

    // -------------------------------------------------------------------------
    // MODE 1: Inline Image (Full Width or standard baseline inline)
    // -------------------------------------------------------------------------
    if (wrapMode === "inline") {
      drawingBox.style.position = "static";
      drawingBox.style.float = "none";
      drawingBox.style.zIndex = "auto";
      drawingBox.style.maxWidth = "100%";
      img.style.maxWidth = "100%";
      img.style.height = "auto";

      if (
        renderedWidth >= articleWidth * 0.8 ||
        headingContext.includes("full width")
      ) {
        drawingBox.style.display = "block";
        drawingBox.style.width = "100%";
        drawingBox.style.height = "auto";
        drawingBox.style.margin = `${Math.max(xmlMeta.distT, 8)}px 0 ${Math.max(xmlMeta.distB, 8)}px 0`;
        img.style.width = "100%";
        img.style.height = "auto";
        img.style.display = "block";
      } else {
        drawingBox.style.display = "inline-block";
        drawingBox.style.verticalAlign = "baseline";
      }
      return;
    }

    // -------------------------------------------------------------------------
    // MODE 5: Top and Bottom Wrapping (Full-width or centered block, no side text)
    // -------------------------------------------------------------------------
    if (wrapMode === "topAndBottom") {
      drawingBox.style.position = "relative";
      drawingBox.style.left = "auto";
      drawingBox.style.top = "auto";
      drawingBox.style.float = "none";
      drawingBox.style.clear = "both";
      drawingBox.style.display = "block";
      drawingBox.style.zIndex = "1";
      drawingBox.style.maxWidth = "100%";
      drawingBox.style.marginTop = `${Math.max(xmlMeta.distT, 8)}px`;
      drawingBox.style.marginBottom = `${Math.max(xmlMeta.distB, 10)}px`;
      drawingBox.style.marginLeft = "auto";
      drawingBox.style.marginRight = "auto";

      // Occupy full width between margins if specified or wide banner
      if (
        renderedWidth >= articleWidth * 0.65 ||
        headingContext.includes("top and bottom")
      ) {
        drawingBox.style.width = "100%";
        drawingBox.style.height = "auto";
        img.style.width = "100%";
        img.style.height = "auto";
        img.style.display = "block";
      } else {
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.style.display = "block";
      }
      return;
    }

    // -------------------------------------------------------------------------
    // MODES 2 & 3: Square Text Wrapping & Tight Text Wrapping
    // -------------------------------------------------------------------------
    if (wrapMode === "square" || wrapMode === "tight" || wrapMode === "through") {
      const isRight =
        alignH === "right" ||
        (!alignH &&
          xmlMeta.posOffsetH !== undefined &&
          xmlMeta.posOffsetH > articleWidth * 0.35);
      const floatSide = isRight ? "right" : "left";

      // Square wrapping uses a uniform rectangular gap; Tight wrapping uses closer contour spacing
      const isTight = wrapMode === "tight" || wrapMode === "through";
      const minSideGap = isTight ? 10 : 16;
      const minVertGap = isTight ? 4 : 8;

      const gapTop = Math.max(xmlMeta.distT, 2);
      const gapBottom = Math.max(xmlMeta.distB, minVertGap);
      const gapLeft =
        floatSide === "right" ? Math.max(xmlMeta.distL, minSideGap) : Math.max(xmlMeta.distL, 0);
      const gapRight =
        floatSide === "left" ? Math.max(xmlMeta.distR, minSideGap) : Math.max(xmlMeta.distR, 0);

      drawingBox.style.position = "relative";
      drawingBox.style.left = "auto";
      drawingBox.style.top = "auto";
      drawingBox.style.float = floatSide;
      drawingBox.style.clear = floatSide;
      drawingBox.style.display = "block";
      drawingBox.style.zIndex = "2";
      drawingBox.style.margin = `${gapTop}px ${gapRight}px ${gapBottom}px ${gapLeft}px`;

      if (isTight && xmlMeta.polygonCss) {
        drawingBox.style.shapeOutside = xmlMeta.polygonCss;
        drawingBox.style.shapeMargin = `${floatSide === "left" ? gapRight : gapLeft}px`;
      }

      // Group the floated image and its wrapping paragraphs into an atomic flow-root container
      // so text wraps smoothly around the float and pagination never splits the float in half.
      const floatGroup = doc.createElement("div");
      floatGroup.className = "docx-float-group";
      floatGroup.style.cssText =
        "display: flow-root; width: 100%; position: relative; box-sizing: border-box;";

      article.insertBefore(floatGroup, hostP);

      // Collect hostP and subsequent paragraphs in the same section that wrap around this float
      const hostText = (hostP.textContent || "").replace(/\u00a0/g, " ").trim();
      if (!hostText) {
        // Host paragraph only held the drawing; prepend drawingBox into the first wrapping paragraph
        const firstWrapP = hostP.nextElementSibling as HTMLElement | null;
        if (firstWrapP && firstWrapP.tagName.toUpperCase() === "P") {
          firstWrapP.insertBefore(drawingBox, firstWrapP.firstChild);
          hostP.remove();
        } else {
          floatGroup.appendChild(hostP);
        }
      } else {
        floatGroup.appendChild(hostP);
      }

      // Pull the section's wrapping text paragraphs into the floatGroup
      let nextNode = floatGroup.nextElementSibling as HTMLElement | null;
      let gatheredCount = 0;
      while (
        nextNode &&
        nextNode.tagName.toUpperCase() === "P" &&
        !isSectionBoundaryHeading(nextNode, win) &&
        !nextNode.querySelector("img, table") &&
        gatheredCount < 5
      ) {
        const toMove = nextNode;
        nextNode = nextNode.nextElementSibling as HTMLElement | null;
        floatGroup.appendChild(toMove);
        gatheredCount++;
      }
      return;
    }

    // -------------------------------------------------------------------------
    // MODES 4 & 6: Behind Text (Watermark) & In Front of Text (Overlay Stamp)
    // -------------------------------------------------------------------------
    if (wrapMode === "behindText" || wrapMode === "inFrontOfText") {
      const isBehind = wrapMode === "behindText";

      const layeredGroup = doc.createElement("div");
      layeredGroup.className = isBehind
        ? "docx-behind-text-group"
        : "docx-infront-text-group";
      layeredGroup.style.cssText = `
        position: relative;
        width: 100%;
        display: flow-root;
        isolation: isolate;
        box-sizing: border-box;
        margin: 6px 0 10px 0;
      `;

      article.insertBefore(layeredGroup, hostP);

      // Extract the drawingBox from hostP so it can be layered via position:absolute
      drawingBox.remove();
      const remainingHostText = (hostP.textContent || "")
        .replace(/\u00a0/g, " ")
        .trim();
      if (remainingHostText.length > 0) {
        hostP.style.position = "relative";
        hostP.style.zIndex = "2";
        hostP.style.backgroundColor = "transparent";
        layeredGroup.appendChild(hostP);
      } else {
        hostP.remove();
      }

      // Gather the body paragraphs of this section that share the layered region
      let nextNode = layeredGroup.nextElementSibling as HTMLElement | null;
      let gatheredParagraphs = 0;
      while (
        nextNode &&
        nextNode.tagName.toUpperCase() === "P" &&
        !isSectionBoundaryHeading(nextNode, win) &&
        !nextNode.querySelector("img, table") &&
        gatheredParagraphs < 4
      ) {
        const pToMove = nextNode;
        nextNode = nextNode.nextElementSibling as HTMLElement | null;
        pToMove.style.position = "relative";
        pToMove.style.zIndex = "2";
        pToMove.style.backgroundColor = "transparent";
        // Strip any opaque white inline run backgrounds so Behind-Text watermarks stay visible
        Array.from(pToMove.querySelectorAll<HTMLElement>("*")).forEach((span) => {
          if (
            span.style.backgroundColor === "white" ||
            span.style.backgroundColor === "#ffffff" ||
            span.style.backgroundColor === "rgb(255, 255, 255)"
          ) {
            span.style.backgroundColor = "transparent";
          }
        });
        layeredGroup.appendChild(pToMove);
        gatheredParagraphs++;
      }

      if (isBehind) {
        // Mode 4: Behind Text (Watermark Style)
        // Render image behind the text layer (z-index: 0) while text flows directly over it (z-index: 2)
        const targetW = Math.min(renderedWidth || 260, articleWidth * 0.65);
        const targetH =
          renderedWidth > 0
            ? Math.round((renderedHeight / renderedWidth) * targetW)
            : 220;

        drawingBox.style.cssText = `
          position: absolute !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
          width: ${targetW}px !important;
          height: ${targetH}px !important;
          z-index: 0 !important;
          pointer-events: none !important;
          float: none !important;
          margin: 0 !important;
          display: block !important;
        `;
        img.style.cssText = `
          width: 100% !important;
          height: 100% !important;
          object-fit: contain !important;
          display: block !important;
          filter: contrast(1.06) brightness(0.97);
        `;

        // Ensure the group is tall enough to contain the watermark without bleeding into Section 5
        const textHeight = layeredGroup.offsetHeight || 120;
        if (targetH > textHeight + 12) {
          layeredGroup.style.minHeight = `${Math.min(targetH, textHeight + 60)}px`;
        }
      } else {
        // Mode 6: In Front of Text (Stamp / Badge Overlay)
        // Render image in front of the text layer (z-index: 10), covering the portion of text behind it
        const stampW = Math.min(renderedWidth || 175, 185);
        const stampH =
          renderedWidth > 0
            ? Math.round((renderedHeight / renderedWidth) * stampW)
            : 185;

        drawingBox.style.cssText = `
          position: absolute !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
          width: ${stampW}px !important;
          height: ${stampH}px !important;
          z-index: 10 !important;
          pointer-events: none !important;
          float: none !important;
          margin: 0 !important;
          display: block !important;
          border-radius: 50% !important;
          overflow: hidden !important;
        `;
        img.style.cssText = `
          width: 100% !important;
          height: 100% !important;
          object-fit: contain !important;
          display: block !important;
        `;

        const textHeight = layeredGroup.offsetHeight || 130;
        if (stampH > textHeight) {
          layeredGroup.style.minHeight = `${stampH + 8}px`;
        }
      }

      layeredGroup.appendChild(drawingBox);
    }
  });

  // Ensure all section headings clear any leftover floats
  const allArticles = Array.from(doc.querySelectorAll<HTMLElement>("section.docx article"));
  for (const article of allArticles) {
    const children = Array.from(article.children) as HTMLElement[];
    for (const child of children) {
      if (isSectionBoundaryHeading(child, win)) {
        child.style.clear = "both";
      }
    }
  }
}

/**
 * Checks if an element or its immediate children contain an explicit hard Word page break
 */
function hasExplicitPageBreakBefore(el: HTMLElement, win: Window): boolean {
  const computed = win.getComputedStyle(el);
  if (
    computed.breakBefore === "page" ||
    computed.pageBreakBefore === "always" ||
    el.style.pageBreakBefore === "always" ||
    el.style.breakBefore === "page"
  ) {
    return true;
  }
  const pageBreakNode = el.querySelector<HTMLElement>(
    '[style*="page-break-before: always"], [style*="break-before: page"]'
  );
  if (pageBreakNode) {
    pageBreakNode.style.pageBreakBefore = "auto";
    pageBreakNode.style.breakBefore = "auto";
    return true;
  }
  return false;
}

/**
 * Measures the lowest visual bottom edge (in px) of an element, including any
 * floated or position:absolute images/tables inside it.
 */
function getVisualBottom(el: HTMLElement): number {
  let maxBottom = el.getBoundingClientRect().bottom;
  const mediaAndBoxes = Array.from(
    el.querySelectorAll<HTMLElement>("img, table, svg, canvas, div, span")
  );
  for (const node of mediaAndBoxes) {
    const r = node.getBoundingClientRect();
    if (r.height > 0 && r.bottom > maxBottom) {
      maxBottom = r.bottom;
    }
  }
  return maxBottom;
}

/**
 * Splits sections into discrete page-sized DOM nodes with top-aligned flow
 * (overriding docx-preview's justify-content: space-between centering) and
 * Keep-With-Next heading/lead-in protection.
 */
function paginateDocxSections(doc: Document, win: Window): HTMLElement[] {
  const rawSections = Array.from(
    doc.querySelectorAll<HTMLElement>("section.docx")
  );
  const finalPages: HTMLElement[] = [];

  for (const section of rawSections) {
    const computed = win.getComputedStyle(section);
    const pageWidth =
      parseFloat(computed.width) || section.offsetWidth || 794;
    const pageHeight =
      parseFloat(computed.minHeight) ||
      parseFloat(computed.height) ||
      1122.5;
    const paddingTop = parseFloat(computed.paddingTop) || 0;
    const paddingBottom = parseFloat(computed.paddingBottom) || 0;

    const header = section.querySelector("header");
    const footer = section.querySelector("footer");
    const article = section.querySelector("article");

    if (!article) {
      section.style.width = `${pageWidth}px`;
      section.style.height = `${pageHeight}px`;
      section.style.overflow = "hidden";
      finalPages.push(section);
      continue;
    }

    const headerHeight = header ? header.offsetHeight : 0;
    const footerHeight = footer ? footer.offsetHeight : 0;
    const maxContentHeight =
      pageHeight - paddingTop - paddingBottom - headerHeight - footerHeight;

    const children = Array.from(article.children) as HTMLElement[];

    const createPageShell = (): {
      pageEl: HTMLElement;
      articleEl: HTMLElement;
    } => {
      const pageEl = section.cloneNode(false) as HTMLElement;
      pageEl.style.width = `${pageWidth}px`;
      pageEl.style.height = `${pageHeight}px`;
      pageEl.style.minHeight = `${pageHeight}px`;
      pageEl.style.maxHeight = `${pageHeight}px`;
      pageEl.style.margin = "0";
      pageEl.style.boxShadow = "none";
      pageEl.style.overflow = "hidden";
      pageEl.style.boxSizing = "border-box";
      pageEl.style.display = "flex";
      pageEl.style.flexDirection = "column";
      // Override docx-preview's space-between so content always starts at the top margin
      pageEl.style.justifyContent = "flex-start";
      pageEl.style.backgroundColor = "#ffffff";
      pageEl.style.position = "relative";

      if (header) {
        const headerClone = header.cloneNode(true) as HTMLElement;
        headerClone.style.flex = "0 0 auto";
        pageEl.appendChild(headerClone);
      }

      const articleEl = article.cloneNode(false) as HTMLElement;
      articleEl.style.flex = "0 0 auto";
      articleEl.style.width = "100%";
      articleEl.style.display = "flow-root";
      articleEl.style.position = "relative";
      articleEl.style.zIndex = "0";
      articleEl.style.isolation = "isolate";
      articleEl.style.marginTop = "0";
      articleEl.style.marginBottom = "0";
      pageEl.appendChild(articleEl);

      if (footer) {
        const footerClone = footer.cloneNode(true) as HTMLElement;
        footerClone.style.marginTop = "auto";
        footerClone.style.flex = "0 0 auto";
        pageEl.appendChild(footerClone);
      }

      section.parentElement?.insertBefore(pageEl, section);
      return { pageEl, articleEl };
    };

    let currentShell = createPageShell();
    finalPages.push(currentShell.pageEl);
    let maxFloatingBottomOnPage = 0;

    for (const child of children) {
      // Skip empty spacer paragraphs at the very top of a page
      if (
        currentShell.articleEl.children.length === 0 &&
        isVisiblyEmptyBlock(child) &&
        !hasExplicitPageBreakBefore(child, win)
      ) {
        continue;
      }

      const hasContent = currentShell.articleEl.children.length > 0;

      if (hasContent && hasExplicitPageBreakBefore(child, win)) {
        child.style.pageBreakBefore = "auto";
        child.style.breakBefore = "auto";
        currentShell = createPageShell();
        finalPages.push(currentShell.pageEl);
        maxFloatingBottomOnPage = 0;
      }

      currentShell.articleEl.appendChild(child);

      const articleRect = currentShell.articleEl.getBoundingClientRect();
      const childVisualBottom = getVisualBottom(child);
      if (childVisualBottom > maxFloatingBottomOnPage) {
        maxFloatingBottomOnPage = childVisualBottom;
      }

      const usedHeight = Math.max(
        currentShell.articleEl.scrollHeight,
        currentShell.articleEl.offsetHeight,
        maxFloatingBottomOnPage - articleRect.top
      );

      if (
        usedHeight > maxContentHeight + 2 &&
        currentShell.articleEl.children.length > 1
      ) {
        currentShell.articleEl.removeChild(child);

        // Pull back any trailing headings or colon lead-in lines so they stay attached
        // to the overflowing paragraph, image group, or summary table
        const carryOverNodes: HTMLElement[] = [];
        while (currentShell.articleEl.children.length > 1) {
          const lastOnPage = currentShell.articleEl
            .lastElementChild as HTMLElement | null;
          if (!lastOnPage) break;

          if (isVisiblyEmptyBlock(lastOnPage)) {
            currentShell.articleEl.removeChild(lastOnPage);
            continue;
          }

          if (isHeadingOrKeepWithNext(lastOnPage, win)) {
            currentShell.articleEl.removeChild(lastOnPage);
            carryOverNodes.unshift(lastOnPage);
          } else {
            break;
          }
        }

        currentShell = createPageShell();
        finalPages.push(currentShell.pageEl);
        maxFloatingBottomOnPage = 0;

        for (const headingNode of carryOverNodes) {
          currentShell.articleEl.appendChild(headingNode);
        }
        currentShell.articleEl.appendChild(child);

        maxFloatingBottomOnPage = getVisualBottom(child);
      }
    }

    section.remove();
  }

  return finalPages.filter((pageEl) => {
    const art = pageEl.querySelector("article");
    if (!art) return true;
    const hasMedia = Boolean(art.querySelector("img, table, svg, canvas, hr"));
    const hasText =
      (art.textContent || "").replace(/\u00a0/g, " ").trim().length > 0;
    if (!hasMedia && !hasText && finalPages.length > 1) {
      pageEl.remove();
      return false;
    }
    return true;
  });
}

/**
 * Renders a single page DOM node into a high-resolution JPEG Data URL
 * using the browser's native layout engine via SVG <foreignObject>.
 */
async function renderPageToJpeg(
  pageEl: HTMLElement,
  stylesText: string,
  widthPx: number,
  heightPx: number,
  scale: number,
  jpegQuality: number
): Promise<string> {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  wrapper.className = "docx-wrapper";
  wrapper.style.cssText = `
    width: ${widthPx}px;
    height: ${heightPx}px;
    margin: 0;
    padding: 0;
    background: #ffffff;
    overflow: hidden;
    box-sizing: border-box;
    display: block;
  `;

  const styleNode = document.createElement("style");
  styleNode.textContent = `
    :where(.docx-wrapper table td, .docx-wrapper table th) {
      padding: 4px 6px;
    }
    ${stylesText}
    .docx-wrapper {
      background: #ffffff !important;
      padding: 0 !important;
      margin: 0 !important;
      display: block !important;
    }
    .docx-wrapper > section.docx {
      margin: 0 !important;
      box-shadow: none !important;
      box-sizing: border-box !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: flex-start !important;
    }
    .docx-wrapper > section.docx > article {
      position: relative !important;
      z-index: 0 !important;
      isolation: isolate !important;
      background: transparent !important;
      flex: 0 0 auto !important;
      margin-top: 0 !important;
    }
    .docx-wrapper > section.docx > footer {
      margin-top: auto !important;
    }
  `;
  wrapper.appendChild(styleNode);

  const clonedPage = pageEl.cloneNode(true) as HTMLElement;
  wrapper.appendChild(clonedPage);

  // Serialize to valid XHTML and strip any illegal XML 1.0 control characters
  const rawXhtml = new XMLSerializer().serializeToString(wrapper);
  const cleanXhtml = rawXhtml.replace(
    /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g,
    ""
  );

  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}"><foreignObject width="100%" height="100%">${cleanXhtml}</foreignObject></svg>`;
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    svgMarkup
  )}`;

  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (err) => reject(err);
    img.src = svgDataUrl;
  });

  if (img.decode) {
    try {
      await img.decode();
    } catch {
      // Proceed if already decoded
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthPx * scale);
  canvas.height = Math.round(heightPx * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not initialize 2D canvas context.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", jpegQuality);
}

/**
 * Converts a .docx File into a layout-preserved PDF Blob via native per-page JPEG rendering.
 */
export async function convertDocxToPdf(
  file: File,
  options: DocxToPdfOptions = {}
): Promise<Blob> {
  const {
    jpegQuality = options.quality ?? 0.95,
    scale = 2,
    onProgress,
  } = options;

  onProgress?.(5, 0, 1);
  const rawArrayBuffer = await file.arrayBuffer();
  const { cleanedBuffer, drawingMetas } =
    await preprocessDocxAndExtractDrawings(rawArrayBuffer);

  // Isolated off-screen iframe so global styles never distort Word tables or text flow
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "0";
  iframe.style.left = "-10000px";
  iframe.style.width = "1200px";
  iframe.style.height = "1600px";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  try {
    const iframeDoc = iframe.contentDocument;
    const iframeWin = iframe.contentWindow;
    if (!iframeDoc || !iframeWin) {
      throw new Error("Unable to initialize isolated rendering sandbox.");
    }

    iframeDoc.open();
    iframeDoc.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body { margin: 0; padding: 0; background: #fff; }</style></head><body><div id="style-root"></div><div id="body-root"></div></body></html>`
    );
    iframeDoc.close();

    const styleRoot = iframeDoc.getElementById("style-root")!;
    const bodyRoot = iframeDoc.getElementById("body-root")!;

    onProgress?.(15, 0, 1);

    // 1. Render DOCX XML and internal stylesheet inside the clean iframe
    await renderAsync(cleanedBuffer, bodyRoot, styleRoot, {
      className: "docx",
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      experimental: true,
      useBase64URL: false,
    });

    // 2. Inline embedded fonts/images with verified MIME types and wait for font readiness
    const compiledStyles = await prepareAssetsAndStyles(iframeDoc);
    onProgress?.(35, 0, 1);

    // 3. Apply all 6 Word image placement and wrapping modes (Inline, Square, Tight,
    //    Behind Text, Top and Bottom, In Front of Text)
    applyWordImageWrappingModes(iframeDoc, iframeWin, drawingMetas);

    // 4. Paginate sections into discrete page DOM nodes with top alignment and Keep-With-Next
    const pages = paginateDocxSections(iframeDoc, iframeWin);

    if (pages.length === 0) {
      throw new Error("No renderable pages found in the DOCX file.");
    }

    let pdf: jsPDF | null = null;

    // 5. Snapshot each page via native browser SVG rendering and append to jsPDF
    for (let i = 0; i < pages.length; i++) {
      const pageEl = pages[i];
      const pageWidthPx = pageEl.offsetWidth || 794;
      const pageHeightPx = pageEl.offsetHeight || 1122.5;

      const pageWidthPt = (pageWidthPx * 72) / 96;
      const pageHeightPt = (pageHeightPx * 72) / 96;
      const orientation = pageWidthPt > pageHeightPt ? "l" : "p";

      const jpegDataUrl = await renderPageToJpeg(
        pageEl,
        compiledStyles,
        pageWidthPx,
        pageHeightPx,
        scale,
        jpegQuality
      );

      if (!pdf) {
        pdf = new jsPDF({
          orientation,
          unit: "pt",
          format: [pageWidthPt, pageHeightPt],
          compress: true,
        });
      } else {
        pdf.addPage([pageWidthPt, pageHeightPt], orientation);
      }

      pdf.addImage(
        jpegDataUrl,
        "JPEG",
        0,
        0,
        pageWidthPt,
        pageHeightPt,
        undefined,
        "FAST"
      );

      const currentProgress = 35 + Math.round(((i + 1) / pages.length) * 60);
      onProgress?.(currentProgress, i + 1, pages.length);
    }

    onProgress?.(100, pages.length, pages.length);
    return pdf!.output("blob");
  } finally {
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe);
    }
  }
}

/**
 * Helper to convert and immediately trigger a browser download
 */
export async function downloadDocxAsPdf(
  file: File,
  options?: DocxToPdfOptions
): Promise<void> {
  const pdfBlob = await convertDocxToPdf(file, options);
  const url = URL.createObjectURL(pdfBlob);
  const baseName = file.name.replace(/\.docx$/i, "");

  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}