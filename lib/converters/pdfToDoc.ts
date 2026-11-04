/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * lib/converters/pdfToDoc.ts
 *
 * Client-side 100% Visual Image Page-by-Page PDF -> DOC/DOCX converter with JPEG compression.
 */

import {
  Document,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Packer,
  Paragraph,
  VerticalPositionRelativeFrom,
} from "docx";

const CONFIG = {
  renderScale: 2.0,
  maxCanvasPixels: 12000000,
  jpegQuality: 0.8,
};

const PX_PER_PT = 96 / 72;
const TWIPS_PER_PT = 20;

async function loadPdfJs(): Promise<any> {
  const pdfjsLib: any = await import("pdfjs-dist");
  const major = parseInt(String(pdfjsLib.version).split(".")[0], 10);
  const ext = Number.isFinite(major) && major < 4 ? "js" : "mjs";
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.${ext}`;
  return pdfjsLib;
}

async function renderPageToJpeg(page: any): Promise<Uint8Array> {
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

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas JPEG compression failed."))),
      "image/jpeg",
      CONFIG.jpegQuality
    );
  });

  const bytes = new Uint8Array(await blob.arrayBuffer());
  canvas.width = 0;
  canvas.height = 0;
  return bytes;
}

export async function convertPdfToDoc(file: File): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("convertPdfToDoc can only run in the browser.");
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

    const paragraphs: Paragraph[] = [];
    let firstPageWidth = 595.28;
    let firstPageHeight = 841.89;

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const viewport = page.getViewport({ scale: 1 });
        if (i === 1) {
          firstPageWidth = viewport.width;
          firstPageHeight = viewport.height;
        }

        const jpegBytes = await renderPageToJpeg(page);
        const pageWpx = Math.round(viewport.width * PX_PER_PT);
        const pageHpx = Math.round(viewport.height * PX_PER_PT);

        paragraphs.push(
          new Paragraph({
            spacing: { before: 0, after: 0, line: 240 },
            pageBreakBefore: i > 1,
            children: [
              new ImageRun({
                type: "jpeg",
                data: jpegBytes,
                transformation: {
                  width: pageWpx,
                  height: pageHpx,
                },
                floating: {
                  horizontalPosition: {
                    relative: HorizontalPositionRelativeFrom.PAGE,
                    offset: 0,
                  },
                  verticalPosition: {
                    relative: VerticalPositionRelativeFrom.PAGE,
                    offset: 0,
                  },
                  behindDocument: true,
                  allowOverlap: true,
                },
              } as any),
            ],
          })
        );
      } finally {
        page.cleanup();
      }
    }

    const doc = new Document({
      creator: "CONVERTER",
      title: file.name.replace(/\.pdf$/i, ""),
      sections: [
        {
          properties: {
            page: {
              size: {
                width: Math.round(firstPageWidth * TWIPS_PER_PT),
                height: Math.round(firstPageHeight * TWIPS_PER_PT),
              },
              margin: {
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
              },
            },
          },
          children: paragraphs,
        },
      ],
    });

    return await Packer.toBlob(doc);
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