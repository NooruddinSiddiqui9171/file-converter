/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * lib/converters/pdfToPptx.ts
 *
 * Client-side Visual Page-by-Page PDF -> PPTX converter.
 * Converts each PDF page into an image snapshot and embeds it into a PowerPoint slide.
 */

import pptxgen from "pptxgenjs";

export interface PdfToPptxOptions {
  onProgress?: (progress: number) => void;
  renderScale?: number;
  jpegQuality?: number;
  maxCanvasPixels?: number;
}

const DEFAULT_CONFIG = {
  renderScale: 1.8,
  maxCanvasPixels: 12000000,
  jpegQuality: 0.85,
};

async function loadPdfJs(): Promise<any> {
  const pdfjsLib: any = await import("pdfjs-dist");
  const major = parseInt(String(pdfjsLib.version).split(".")[0], 10);
  const ext = Number.isFinite(major) && major < 4 ? "js" : "mjs";

  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.${ext}`;
  }

  return pdfjsLib;
}

async function renderPageToJpegDataUrl(
  page: any,
  scaleConfig: number,
  quality: number,
  maxPixels: number
): Promise<{ dataUrl: string; width: number; height: number }> {
  const base = page.getViewport({ scale: 1 });
  const maxScaleByPixels = Math.sqrt(maxPixels / (base.width * base.height));
  const scale = Math.min(scaleConfig, maxScaleByPixels);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Unable to create a 2D canvas context.");
  }

  // Draw solid white background behind transparent PDF layers
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
    background: "#ffffff",
  } as any).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", quality);

  // Force immediate GPU buffer release
  canvas.width = 0;
  canvas.height = 0;

  return {
    dataUrl,
    width: base.width,
    height: base.height,
  };
}

export async function convertPdfToPptx(
  file: File | Blob,
  options: PdfToPptxOptions = {}
): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("convertPdfToPptx can only run in the browser.");
  }

  const {
    onProgress,
    renderScale = DEFAULT_CONFIG.renderScale,
    jpegQuality = DEFAULT_CONFIG.jpegQuality,
    maxCanvasPixels = DEFAULT_CONFIG.maxCanvasPixels,
  } = options;

  onProgress?.(5);

  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
  } as any);

  const pdf = await loadingTask.promise;

  try {
    const numPages: number = pdf.numPages;
    if (!numPages) {
      throw new Error("The PDF has no pages.");
    }

    onProgress?.(15);

    const pres = new pptxgen();

    // 1. Calculate presentation dimensions based on Page 1 (72 PDF points = 1 inch)
    const firstPage = await pdf.getPage(1);
    const initialVp = firstPage.getViewport({ scale: 1 });
    firstPage.cleanup();

    const slideWidthInches = initialVp.width / 72;
    const slideHeightInches = initialVp.height / 72;

    pres.defineLayout({
      name: "PDF_CUSTOM",
      width: slideWidthInches,
      height: slideHeightInches,
    });
    pres.layout = "PDF_CUSTOM";

    // 2. Render each page and place onto corresponding slide
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const { dataUrl, width, height } = await renderPageToJpegDataUrl(
          page,
          renderScale,
          jpegQuality,
          maxCanvasPixels
        );

        const slide = pres.addSlide();

        // Prevent distortion if subsequent pages differ in aspect ratio from Page 1
        const pageRatio = width / height;
        const slideRatio = slideWidthInches / slideHeightInches;

        let renderW = slideWidthInches;
        let renderH = slideHeightInches;
        let posX = 0;
        let posY = 0;

        if (Math.abs(pageRatio - slideRatio) > 0.01) {
          if (pageRatio > slideRatio) {
            renderW = slideWidthInches;
            renderH = slideWidthInches / pageRatio;
            posY = (slideHeightInches - renderH) / 2;
          } else {
            renderH = slideHeightInches;
            renderW = slideHeightInches * pageRatio;
            posX = (slideWidthInches - renderW) / 2;
          }
        }

        slide.addImage({
          data: dataUrl,
          x: posX,
          y: posY,
          w: renderW,
          h: renderH,
        });

        // Report progress mapped between 15% and 85%
        const currentProgress = Math.round(15 + (i / numPages) * 70);
        onProgress?.(currentProgress);
      } finally {
        page.cleanup();
      }
    }

    onProgress?.(90);

    // 3. Generate binary PowerPoint file with explicit PPTX MIME type
    const rawBlob = (await pres.write({ outputType: "blob" })) as Blob;
    const pptxBlob = new Blob([rawBlob], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });

    onProgress?.(100);
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