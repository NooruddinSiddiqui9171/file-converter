// lib/converters/pdfToPng.ts
import JSZip from 'jszip';

export interface PdfToPngOptions {
    /**
     * Render scale multiplier (default: 1.4 for crisp, clean text output).
     */
    scale?: number;
    /**
     * Optional progress callback (percent: 0..100, currentPage, totalPages).
     */
    onProgress?: (percent: number, currentPage: number, totalPages: number) => void;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to encode page canvas as PNG.'));
                }
            },
            'image/png'
        );
    });
}

/**
 * Renders every page of a PDF as a high-resolution PNG and packages them into a ZIP Blob.
 */
export async function convertPdfToPng(
    input: File | Blob | ArrayBuffer,
    options: PdfToPngOptions = {}
): Promise<Blob> {
    const scale = options.scale ?? 1.4;

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

        const pngBlob = await canvasToPngBlob(canvas);

        canvas.width = 0;
        canvas.height = 0;

        const paddedNum = String(pageNum).padStart(padLength, '0');
        const fileName = `${baseName}_page_${paddedNum}.png`;

        zip.file(fileName, pngBlob, {
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        const percent = Math.round((pageNum / numPages) * 100);
        options.onProgress?.(percent, pageNum, numPages);
    }

    return await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/zip',
    });
}