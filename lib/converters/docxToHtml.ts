/**
 * lib/converters/docxToHtml.ts
 *
 * 2-Stage High-Fidelity DOCX -> PDF -> HTML converter pipeline.
 * Converts DOCX to a native vector PDF via Word, then converts that PDF
 * into standalone pdf2htmlEX-compatible HTML with crisp text and fonts.
 */

import { convertDocxToPdf } from "./docxToPdf";
import { convertPdfToHtml, PdfToHtmlOptions } from "./pdfToHtml";

export interface DocxToHtmlOptions extends PdfToHtmlOptions {
  onProgress?: (percent: number) => void;
}

export async function convertDocxToHtml(
  file: File | Blob,
  options: DocxToHtmlOptions = {}
): Promise<Blob> {
  const { onProgress, ...htmlOptions } = options;

  onProgress?.(5);

  // Stage 1: Convert DOCX to PDF via backend Word engine (5% -> 40%)
  const pdfBlob = await convertDocxToPdf(file, {
    onProgress: (stage1Progress) => {
      const mapped = Math.round(5 + (stage1Progress / 100) * 35);
      onProgress?.(mapped);
    },
  });

  onProgress?.(42);

  // Stage 2: Convert intermediate PDF Blob to standalone HTML (42% -> 100%)
  const htmlBlob = await convertPdfToHtml(pdfBlob, {
    scale: 1.5,
    backgroundResolutionMultiplier: 1.0,
    textLayerMode: "vector",
    ...htmlOptions,
    onProgress: (stage2Progress) => {
      const mapped = Math.round(42 + (stage2Progress / 100) * 58);
      onProgress?.(mapped);
    },
  });

  onProgress?.(100);
  return htmlBlob;
}