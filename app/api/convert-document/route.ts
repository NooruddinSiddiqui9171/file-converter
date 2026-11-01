import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  ExportPDFJob,
  ExportPDFParams,
  ExportPDFResult,
  ExportPDFTargetFormat
} from '@adobe/pdfservices-node-sdk';

const execFileAsync = promisify(execFile);

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function uniqueId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// PDF -> DOCX using Python pdf2docx
async function convertPdfToDocxWithPython(pdfBuffer: Buffer): Promise<Buffer | null> {
  const tmpDir = os.tmpdir();
  const id = uniqueId();

  const inPath = path.join(tmpDir, `in_${id}.pdf`);
  const outPath = path.join(tmpDir, `out_${id}.docx`);
  const scriptPath = path.join(tmpDir, `script_${id}.py`);

  try {
    await fs.writeFile(inPath, pdfBuffer);

    const pyScript = [
      'import sys',
      'from pdf2docx import Converter',
      'pdf_file = sys.argv[1]',
      'docx_file = sys.argv[2]',
      'cv = Converter(pdf_file)',
      'try:',
      '    cv.convert(docx_file, start=0, end=None, parse_lattice_table=True, parse_stream_table=True)',
      'finally:',
      '    cv.close()',
    ].join('\n');

    await fs.writeFile(scriptPath, pyScript, 'utf8');

    try {
      await execFileAsync('python', [scriptPath, inPath, outPath], { timeout: 300000 });
    } catch {
      await execFileAsync('py', [scriptPath, inPath, outPath], { timeout: 300000 });
    }

    const docxBuffer = await fs.readFile(outPath);
    return docxBuffer.length > 0 ? docxBuffer : null;
  } catch (error) {
    console.error('Python DOCX conversion failed:', error);
    return null;
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
    await fs.unlink(scriptPath).catch(() => {});
  }
}

async function convertPdfWithAdobe(
  pdfBuffer: Buffer,
  targetFormat: ExportPDFTargetFormat
): Promise<Buffer | null> {
  let tempFilePath = '';
  try {
    const clientId = process.env.ADOBE_CLIENT_ID;
    const clientSecret = process.env.ADOBE_CLIENT_SECRET;

    if (!clientId || !clientSecret) return null;

    const credentials = new ServicePrincipalCredentials({ clientId, clientSecret });
    const pdfServices = new PDFServices({ credentials });

    tempFilePath = path.join(os.tmpdir(), `adobe_in_${uniqueId()}.pdf`);
    await fs.writeFile(tempFilePath, pdfBuffer);
    const fileHandle = await fs.open(tempFilePath, 'r');
    const readStream = fileHandle.createReadStream();

    const inputAsset = await pdfServices.upload({
      readStream: readStream as any,
      mimeType: MimeType.PDF,
    });
    await fileHandle.close();

    const params = new ExportPDFParams({ targetFormat });
    const job = new ExportPDFJob({ inputAsset, params });

    const pollingURL = await pdfServices.submit({ job });
    const pdfServicesResponse = await pdfServices.getJobResult({
      pollingURL,
      resultType: ExportPDFResult,
    });

    const resultAsset = pdfServicesResponse.result?.asset;
    if (!resultAsset) return null;

    const streamAsset = await pdfServices.getContent({ asset: resultAsset });
    const chunks: Buffer[] = [];
    //@ts-ignore
    for await (const chunk of streamAsset.readStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('Adobe PDF Services API conversion failed:', error);
    return null;
  } finally {
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const targetFormat = formData.get('targetFormat');

    if (!(file instanceof File) || typeof targetFormat !== 'string') {
      return NextResponse.json({ message: 'Invalid request parameters.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const lastDot = file.name.lastIndexOf('.');
    const baseName = (lastDot > 0 ? file.name.substring(0, lastDot) : file.name) || 'document';
    const format = targetFormat.toLowerCase().trim();

    if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return NextResponse.json({ message: 'Please upload a valid PDF file.' }, { status: 415 });
    }

    // 1. PDF -> DOCX
    if (format === 'docx' || format === 'doc') {
      let docxBuffer = await convertPdfWithAdobe(buffer, ExportPDFTargetFormat.DOCX);
      if (!docxBuffer) docxBuffer = await convertPdfToDocxWithPython(buffer);

      if (!docxBuffer) {
        return NextResponse.json({ message: 'PDF to DOCX conversion failed.' }, { status: 500 });
      }

      return new NextResponse(toArrayBuffer(new Uint8Array(docxBuffer)), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${baseName}.docx"`,
        },
      });
    }

    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    const pdfDocument = await loadingTask.promise;

    try {
      const numPages = pdfDocument.numPages;

      // 2. PDF -> PNG/JPG
      if (format === 'png' || format === 'jpeg' || format === 'jpg') {
        const zip = new JSZip();

        for (let i = 1; i <= numPages; i++) {
          const page = await pdfDocument.getPage(i);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext('2d');

          await page.render({ canvas: canvas as any, canvasContext: context as any, viewport }).promise;

          const extension = format === 'jpeg' ? 'jpg' : format;
          const imageBuffer = format === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', 90);

          zip.file(`${baseName}_page_${i}.${extension}`, new Uint8Array(imageBuffer));
        }

        const zipContent = await zip.generateAsync({ type: 'uint8array' });
        return new NextResponse(toArrayBuffer(zipContent), {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${baseName}_to_${format}.zip"`,
          },
        });
      }

      // 3. PDF -> TXT
      if (format === 'txt') {
        const pages: string[] = [];
        for (let i = 1; i <= numPages; i++) {
          const page = await pdfDocument.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => (item.str ?? '') + (item.hasEOL ? '\n' : ' ')).join('').trim();
          pages.push(`--- Page ${i} ---\n${pageText}`);
        }

        return new NextResponse(pages.join('\n\n'), {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${baseName}.txt"`,
          },
        });
      }

      // 4. PDF -> HTML
      if (format === 'html' || format === 'htm') {
        const escapeHtml = (val: string) => val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const htmlPages: string[] = [];

        for (let i = 1; i <= numPages; i++) {
          const page = await pdfDocument.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => escapeHtml(item.str ?? '')).join(' ');
          htmlPages.push(`<section class="pdf-page">${pageText}</section>`);
        }

        const htmlOutput = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(baseName)}</title></head><body>${htmlPages.join('\n')}</body></html>`;
        return new NextResponse(htmlOutput, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': `attachment; filename="${baseName}.html"`,
          },
        });
      }

      return NextResponse.json({ message: `Unsupported target format: ${format}` }, { status: 400 });
    } finally {
      await loadingTask.destroy();
    }
  } catch (error: unknown) {
    console.error('DOCUMENT CONVERSION ERROR:', error);
    return NextResponse.json({ message: 'Document conversion failed.' }, { status: 500 });
  }
}