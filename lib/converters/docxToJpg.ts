/**
 * lib/converters/docxToJpg.ts
 *
 * 2-Stage High-Fidelity DOCX -> PDF -> JPG converter pipeline.
 * Converts DOCX to a native PDF via Word, then rasterizes each page
 * to crisp JPEG images bundled inside a ZIP archive.
 */

import { convertDocxToPdf } from './docxToPdf';
import { convertPdfToJpg, PdfToJpgOptions } from './pdfToJpg';

export interface DocxToJpgOptions extends PdfToJpgOptions {
  onProgress?: (percent: number, currentPage?: number, totalPages?: number) => void;
}

export async function convertDocxToJpg(
  file: File | Blob,
  options: DocxToJpgOptions = {}
): Promise<Blob> {
  const { onProgress, ...jpgOptions } = options;

  onProgress?.(5);

  // Stage 1: Convert DOCX to PDF via backend Word engine (5% -> 40%)
  const pdfBlob = await convertDocxToPdf(file, {
    onProgress: (stage1Progress) => {
      const mapped = Math.round(5 + (stage1Progress / 100) * 35);
      onProgress?.(mapped);
    },
  });

  onProgress?.(42);

  // Stage 2: Rasterize PDF pages into JPEG images inside a ZIP (42% -> 100%)
  const zipBlob = await convertPdfToJpg(pdfBlob, {
    scale: 1.5,
    quality: 0.8,
    ...jpgOptions,
    onProgress: (stage2Progress, currentPage, totalPages) => {
      const mapped = Math.round(42 + (stage2Progress / 100) * 58);
      onProgress?.(mapped, currentPage, totalPages);
    },
  });

  onProgress?.(100);
  return zipBlob;
}