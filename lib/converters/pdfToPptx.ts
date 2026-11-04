/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * lib/converters/pdfToPptx.ts
 *
 * Client-side 100% Visual Page-by-Page PDF -> PPTX converter.
 */

import pptxgen from "pptxgenjs";

const CONFIG = {
  renderScale: 2.0,
  maxCanvasPixels: 12000000,
  jpegQuality: 0.85,
};

async function loadPdfJs(): Promise<any> {
  const pdfjsLib: any = await import("pdfjs-dist");
  const major = parseInt(String(pdfjsLib.version).split(".")[0], 10);
  const ext = Number.isFinite(major) && major < 4 ? "js" : "mjs";
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.${ext}`;
  return pdfjsLib;
}

async function renderPageToJpegDataUrl(page: any): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const maxScaleByPixels = Math.sqrt(
    CONFIG.maxCanvasPixels / (base.width * base.height)
  );
  const scale = Math.min(CONFIG.renderScale, maxScaleByPixels);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Unable to create a 2D canvas context.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
    background: "#ffffff",
  } as any).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", CONFIG.jpegQuality);
  
  // Clean up canvas
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}

export async function convertPdfToPptx(file: File): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("convertPdfToPptx can only run in the browser.");
  }

  const pdfjsLib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
  } as any);
  const pdf = await loadingTask.promise;

  try {
    const numPages: number = pdf.numPages;
    if (!numPages) throw new Error("The PDF has no pages.");

    const pres = new pptxgen();

    // Set default presentation layout size based on the first page aspect ratio
    const firstPage = await pdf.getPage(1);
    const initialVp = firstPage.getViewport({ scale: 1 });
    firstPage.cleanup();

    // Define custom layout dimensions matching the PDF aspect ratio (in inches)
    // PPTX standard layout width is usually 10 inches (custom layout allows matching PDF proportion)
    const ptWidth = initialVp.width;
    const ptHeight = initialVp.height;
    
    // 72 points = 1 inch
    const slideWidthInches = ptWidth / 72;
    const slideHeightInches = ptHeight / 72;

    pres.defineLayout({
      name: "PDF_CUSTOM",
      width: slideWidthInches,
      height: slideHeightInches,
    });
    pres.layout = "PDF_CUSTOM";

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const dataUrl = await renderPageToJpegDataUrl(page);
        
        // Add a blank slide for each page
        const slide = pres.addSlide();

        // Place the rendered page image to fill the entire slide (0,0 to width/height)
        slide.addImage({
          data: dataUrl,
          x: 0,
          y: 0,
          w: slideWidthInches,
          h: slideHeightInches,
        });
      } finally {
        page.cleanup();
      }
    }

    // Generate output blob
    const pptxBlob = (await pres.write({ outputType: "blob" })) as Blob;
    return pptxBlob;
  } finally {
    try {
      if (pdf && typeof pdf.cleanup === "function") {
        await pdf.cleanup();
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}