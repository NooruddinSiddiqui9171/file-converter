import { convertPdfToPptx } from './pdfToPptxClient';
import { convertDocxClientSide } from './docxClientConverter';

interface ConvertDocOptions {
  targetFormat: 'docx' | 'doc' | 'xlsx' | 'xls' | 'pptx' | 'ppt' | 'txt' | 'html' | 'png' | 'jpeg' | 'jpg' | 'pdf';
  onProgress?: (progress: number, message: string) => void;
}

export async function convertDocument(file: File, options: ConvertDocOptions): Promise<Blob> {
  const format = options.targetFormat.toLowerCase();
  const fileName = file.name.toLowerCase();

  // 1. Handle PDF -> PPTX client-side
  if (fileName.endsWith('.pdf') && (format === 'pptx' || format === 'ppt')) {
    return await convertPdfToPptx(file, {
      onProgress: options.onProgress,
    });
  }

  // 2. Handle DOCX -> TXT, HTML, PPTX, PDF client-side (100% free & local)
  if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
    return await convertDocxClientSide(file, format, {
      onProgress: options.onProgress,
    });
  }

  // 3. Otherwise, route other formats through your existing server API endpoint
  const formData = new FormData();
  formData.append('file', file);
  formData.append('targetFormat', options.targetFormat);

  const response = await fetch('/api/convert-document', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Document conversion failed on server.');
  }

  return await response.blob();
}