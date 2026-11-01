import * as pdfjsLib from 'pdfjs-dist';
import PptxGenJS from 'pptxgenjs';

// Ensure the PDF.js worker is properly linked
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

interface ConvertOptions {
  onProgress?: (progress: number, message: string) => void;
}

export async function convertPdfToPptx(
  file: File,
  options?: ConvertOptions
): Promise<Blob> {
  const { onProgress } = options || {};
  
  onProgress?.(5, 'Loading PDF document...');
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9'; // Default widescreen presentation layout

  for (let i = 1; i <= numPages; i++) {
    const percent = Math.round(10 + (i / numPages) * 75);
    onProgress?.(percent, `Rendering page ${i} of ${numPages}...`);

    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for crisp slide images

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    if (!context) {
      throw new Error('Failed to create canvas context for slide rendering.');
    }

    await page.render({
      canvas: canvas as any,
      canvasContext: context,
      viewport: viewport,
    }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    // Add slide
    const slide = pptx.addSlide();
    slide.addImage({
      data: dataUrl,
      x: 0,
      y: 0,
      w: '100%',
      h: '100%',
    });

    // Memory safeguard: clear canvas references
    canvas.width = 0;
    canvas.height = 0;
  }

  onProgress?.(92, 'Generating PowerPoint presentation file...');
  
  // Generate PowerPoint blob
  const pptxBlob = (await pptx.write({ outputType: 'blob' })) as Blob;

  onProgress?.(100, 'Done!');
  return pptxBlob;
}