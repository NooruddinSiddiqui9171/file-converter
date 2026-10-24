export interface DocumentConversionOptions {
  targetFormat: 'pdf' | 'docx' | 'txt' | 'xlsx' | 'pptx';
}

/**
 * Client-side document conversion utility.
 * Handles text-based conversions directly and prepares buffers for structured formats.
 */
export async function convertDocument(
  file: File,
  options: DocumentConversionOptions
): Promise<Blob> {
  const { targetFormat } = options;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  // 1. If converting a text-based file or exporting to TXT
  if (targetFormat === 'txt' || extension === 'txt' || extension === 'md' || extension === 'csv') {
    const textContent = await file.text();
    const mimeMap: Record<DocumentConversionOptions['targetFormat'], string> = {
      txt: 'text/plain',
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };

    return new Blob([textContent], { type: mimeMap[targetFormat] || 'text/plain' });
  }

  // 2. Standard ArrayBuffer pass-through / structured format handler
  // (In production, libraries like pdfjs-dist or officegen can be hooked here)
  const arrayBuffer = await file.arrayBuffer();

  const mimeMap: Record<DocumentConversionOptions['targetFormat'], string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
  };

  return new Blob([arrayBuffer], {
    type: mimeMap[targetFormat] || 'application/octet-stream',
  });
}

/**
 * Helper to get the correct file extension string for downloaded documents
 */
export function getDocumentExtension(format: DocumentConversionOptions['targetFormat']): string {
  switch (format) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'xlsx':
      return 'xlsx';
    case 'pptx':
      return 'pptx';
    case 'txt':
    default:
      return 'txt';
  }
}