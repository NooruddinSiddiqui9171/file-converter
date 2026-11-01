import mammoth from 'mammoth';

export interface ParsedDoc {
  rawText: string;
  valueHtml: string;
  paragraphs: string[];
}

export async function parseDocxFile(file: File): Promise<ParsedDoc> {
  const arrayBuffer = await file.arrayBuffer();

  // Extract raw text
  const textResult = await mammoth.extractRawText({ arrayBuffer });
  const rawText = textResult.value || '';
  const paragraphs = rawText
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Extract semantic HTML
  const htmlResult = await mammoth.convertToHtml({ arrayBuffer });
  const valueHtml = htmlResult.value || '';

  return {
    rawText,
    valueHtml,
    paragraphs,
  };
}