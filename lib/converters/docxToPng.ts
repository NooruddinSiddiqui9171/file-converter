/**
 * lib/converters/docxToPng.ts
 *
 * 2-Stage High-Fidelity DOCX -> PDF -> PNG converter pipeline.
 * Converts DOCX to a native PDF via Word, then rasterizes each page
 * to crisp lossless PNG images bundled inside a ZIP archive.
 */

import { convertDocxToPdf } from './docxToPdf';
import { convertPdfToPng, PdfToPngOptions } from './pdfToPng';

export interface DocxToPngOptions extends PdfToPngOptions {
  onProgress?: (percent: number, currentPage?: number, totalPages?: number) => void;
}

export async function convertDocxToPng(
  file: File | Blob,
  options: DocxToPngOptions = {}
): Promise<Blob> {
  const { onProgress, ...pngOptions } = options;

  onProgress?.(5);

  // Stage 1: Convert DOCX to PDF via backend Word engine (5% -> 40%)
  const pdfBlob = await convertDocxToPdf(file, {
    onProgress: (stage1Progress) => {
      const mapped = Math.round(5 + (stage1Progress / 100) * 35);
      onProgress?.(mapped);
    },
  });

  onProgress?.(42);

  // Stage 2: Rasterize PDF pages into PNG images inside a ZIP (42% -> 100%)
  const zipBlob = await convertPdfToPng(pdfBlob, {
    scale: 1.4,
    ...pngOptions,
    onProgress: (stage2Progress, currentPage, totalPages) => {
      const mapped = Math.round(42 + (stage2Progress / 100) * 58);
      onProgress?.(mapped, currentPage, totalPages);
    },
  });

  onProgress?.(100);
  return zipBlob;
}