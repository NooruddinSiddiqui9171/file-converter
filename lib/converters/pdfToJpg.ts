// lib/converters/pdfToJpg.ts
import JSZip from 'jszip';

export interface PdfToJpgOptions {
  /**
   * Render scale multiplier (default: 1.5 for crisp, lightweight output).
   */
  scale?: number;
  /**
   * JPEG compression quality from 0.1 to 1.0 (default: 0.78).
   */
  quality?: number;
  /**
   * Optional progress callback (percent: 0..100, currentPage, totalPages).
   */
  onProgress?: (percent: number, currentPage: number, totalPages: number) => void;
}

function canvasToJpgBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to encode page canvas as JPEG.'));
        }
      },
      'image/jpeg',
      quality
    );
  });
}

export async function convertPdfToJpg(
  input: File | Blob | ArrayBuffer,
  options: PdfToJpgOptions = {}
): Promise<Blob> {
  const scale = options.scale ?? 1.5;     // Compressed default scale
  const quality = options.quality ?? 0.78; // Compressed default quality

  const pdfjsLib = await import('pdfjs-dist');

  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }

  const arrayBuffer =
    input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`,
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  if (numPages === 0) {
    throw new Error('The PDF file contains no pages.');
  }

  const zip = new JSZip();
  const baseName =
    input instanceof File
      ? input.name.replace(/\.pdf$/i, '') || 'page'
      : 'page';
  const padLength = numPages >= 100 ? 3 : numPages >= 10 ? 2 : 1;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    }).promise;

    const jpgBlob = await canvasToJpgBlob(canvas, quality);

    canvas.width = 0;
    canvas.height = 0;

    const paddedNum = String(pageNum).padStart(padLength, '0');
    const fileName = `${baseName}_page_${paddedNum}.jpg`;

    zip.file(fileName, jpgBlob, { compression: 'STORE' });

    const percent = Math.round((pageNum / numPages) * 100);
    options.onProgress?.(percent, pageNum, numPages);
  }

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
  });
}