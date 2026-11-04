/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * lib/converters/pdfToTxt.ts
 *
 * Client-side 100% Text Extraction PDF -> TXT converter.
 */

async function loadPdfJs(): Promise<any> {
  const pdfjsLib: any = await import("pdfjs-dist");
  const major = parseInt(String(pdfjsLib.version).split(".")[0], 10);
  const ext = Number.isFinite(major) && major < 4 ? "js" : "mjs";
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.${ext}`;
  return pdfjsLib;
}

export async function convertPdfToTxt(file: File): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("convertPdfToTxt can only run in the browser.");
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

    let fullText = "";

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const textContent = await page.getTextContent();
        
        let lastY: number | null = null;
        let pageText = "";

        // Extract items and reconstruct lines based on vertical position (transform[5])
        for (const item of textContent.items) {
          if (!item.str) continue;
          
          const currentY = item.transform ? item.transform[5] : null;
          
          // If Y changes significantly, insert a newline
          if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 5) {
            pageText += "\n";
          } else if (lastY !== null && pageText.length > 0 && !pageText.endsWith(" ")) {
            pageText += " ";
          }

          pageText += item.str;
          lastY = currentY;
        }

        fullText += `--- Page ${i} ---\n\n${pageText.trim()}\n\n\n`;
      } finally {
        page.cleanup();
      }
    }

    return new Blob([fullText.trim()], { type: "text/plain;charset=utf-8" });
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