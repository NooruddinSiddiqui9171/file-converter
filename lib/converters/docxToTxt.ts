/**
 * lib/converters/docxToTxt.ts
 *
 * Client-side DOCX -> TXT converter.
 * Extracts clean plain text from word/document.xml, removes web-font icon
 * artifacts, trims whitespace, and collapses redundant blank lines.
 */

import JSZip from 'jszip';

export interface DocxToTxtOptions {
  onProgress?: (percent: number) => void;
  /**
   * Collapse multiple consecutive empty lines down to a single blank line.
   * Default: true.
   */
  collapseBlankLines?: boolean;
  /**
   * Strip Private Use Area (PUA) icon font characters (e.g. \uE000-\uF8FF).
   * Default: true.
   */
  stripIconGlyphs?: boolean;
}

export async function convertDocxToTxt(
  file: File | Blob,
  options: DocxToTxtOptions = {}
): Promise<Blob> {
  const {
    onProgress,
    collapseBlankLines = true,
    stripIconGlyphs = true,
  } = options;

  onProgress?.(10);

  const arrayBuffer = await file.arrayBuffer();
  onProgress?.(30);

  const zip = await JSZip.loadAsync(arrayBuffer);
  onProgress?.(50);

  const documentXml = zip.file('word/document.xml');
  if (!documentXml) {
    throw new Error('Invalid DOCX document: word/document.xml was not found.');
  }

  const xmlContent = await documentXml.async('text');
  onProgress?.(70);

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

  const parseErrors = xmlDoc.getElementsByTagName('parsererror');
  if (parseErrors.length > 0) {
    throw new Error('Failed to parse the DOCX XML structure.');
  }

  // Retrieve all paragraph nodes across body, tables, and nested containers
  const paragraphNodes = xmlDoc.getElementsByTagNameNS('*', 'p');
  const textLines: string[] = [];

  for (let i = 0; i < paragraphNodes.length; i++) {
    const p = paragraphNodes[i];
    let paragraphText = '';

    const walker = document.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
    let currentNode = walker.currentNode as Element;

    while (currentNode) {
      const tag = (currentNode.localName || currentNode.nodeName).toLowerCase();

      if (tag === 't') {
        paragraphText += currentNode.textContent || '';
      } else if (tag === 'tab') {
        paragraphText += '\t';
      } else if (tag === 'br' || tag === 'cr') {
        paragraphText += '\n';
      }

      currentNode = walker.nextNode() as Element;
    }

    let cleaned = paragraphText.trim();

    // Strip Private Use Area unicode glyphs used by web icon fonts
    if (stripIconGlyphs && cleaned.length > 0) {
      cleaned = cleaned.replace(/[\uE000-\uF8FF]/g, '').trim();
    }

    textLines.push(cleaned);
  }

  onProgress?.(90);

  let fullText = textLines.join('\n');

  if (collapseBlankLines) {
    // Collapse 3 or more consecutive newlines into at most 2 (one blank line between text)
    fullText = fullText.replace(/\n{3,}/g, '\n\n').trim();
  }

  const txtBlob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });

  onProgress?.(100);
  return txtBlob;
}