/**
 * lib/converters/docxToPptx.ts
 *
 * 2-Stage Visual DOCX -> PDF -> PPTX converter pipeline.
 * Converts DOCX to a high-fidelity PDF first, then rasterizes PDF pages into PPTX slides.
 */

import { convertDocxToPdf } from "./docxToPdf";
import { convertPdfToPptx, PdfToPptxOptions } from "./pdfToPptx";

export interface DocxToPptxOptions extends PdfToPptxOptions {
  onProgress?: (progress: number) => void;
}

export async function convertDocxToPptx(
  file: File | Blob,
  options: DocxToPptxOptions = {}
): Promise<Blob> {
  const { onProgress, ...pdfOptions } = options;

  onProgress?.(5);

  // Stage 1: Convert DOCX to PDF via backend Word engine (5% -> 40%)
  const pdfBlob = await convertDocxToPdf(file, {
    onProgress: (stage1Progress) => {
      const mapped = Math.round(5 + (stage1Progress / 100) * 35);
      onProgress?.(mapped);
    },
  });

  onProgress?.(45);

  // Stage 2: Convert intermediate PDF Blob to visual PPTX slides (45% -> 100%)
  const pptxBlob = await convertPdfToPptx(pdfBlob, {
    ...pdfOptions,
    onProgress: (stage2Progress) => {
      const mapped = Math.round(45 + (stage2Progress / 100) * 55);
      onProgress?.(mapped);
    },
  });

  onProgress?.(100);
  return pptxBlob;
}