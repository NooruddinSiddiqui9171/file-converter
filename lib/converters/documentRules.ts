export interface TargetOption {
  value: string;
  label: string;
  description: string;
}

const DOCUMENT_FORMAT_MATRIX: Record<string, TargetOption[]> = {
  // 1. PDF Document
  'application/pdf': [
    { value: 'docx', label: 'DOCX', description: 'Converts PDF layout into an editable Word document' },
    { value: 'doc', label: 'DOC', description: 'Legacy Word format' },
    { value: 'pptx', label: 'PPTX', description: 'Converts PDF pages into PowerPoint presentation slides' },
    { value: 'txt', label: 'TXT', description: 'Extracts plain text content' },
    { value: 'html', label: 'HTML', description: 'Web-renderable document markup' },
    { value: 'png', label: 'PNG', description: 'Renders document pages as high-resolution images' },
    { value: 'jpeg', label: 'JPG', description: 'Renders document pages as standard JPEGs' },
  ],
  // 2. DOCX (Word) - Updated with JPG, PNG, and PPTX
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    { value: 'pdf', label: 'PDF', description: 'Fixed-layout document for secure sharing' },
    { value: 'doc', label: 'DOC', description: 'Legacy Word document' },
    { value: 'pptx', label: 'PPTX', description: 'Converts Word document into a PowerPoint presentation' },
    { value: 'txt', label: 'TXT', description: 'Extracts raw text without formatting' },
    { value: 'html', label: 'HTML', description: 'Converts document structure to web HTML' },
    { value: 'png', label: 'PNG', description: 'Renders document pages as high-resolution PNG images' },
    { value: 'jpeg', label: 'JPG', description: 'Renders document pages as standard JPG images' },
  ],
  // 3. DOC (Legacy Word)
  'application/msword': [
    { value: 'pdf', label: 'PDF', description: 'Converts legacy document to standard PDF' },
    { value: 'docx', label: 'DOCX', description: 'Upgrades legacy Word file to modern OpenXML format' },
    { value: 'txt', label: 'TXT', description: 'Extracts raw text content' },
  ],
  // 4. Plain Text (TXT)
  'text/plain': [
    { value: 'pdf', label: 'PDF', description: 'Wraps text into a clean PDF document' },
    { value: 'docx', label: 'DOCX', description: 'Creates a formatted Word document from text' },
    { value: 'html', label: 'HTML', description: 'Wraps text in basic HTML tags' },
  ],
  // 5. CSV (Spreadsheet Data)
  'text/csv': [
    { value: 'xlsx', label: 'XLSX', description: 'Opens data as a formatted Excel spreadsheet' },
    { value: 'pdf', label: 'PDF', description: 'Generates a printable table report' },
  ],
  // 6. XLSX (Excel)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    { value: 'pdf', label: 'PDF', description: 'Generates a printable report document from sheets' },
    { value: 'txt', label: 'TXT', description: 'Exports sheet data as plain text' },
  ],
  // 7. PowerPoint (PPTX)
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    { value: 'pdf', label: 'PDF', description: 'Converts slide deck into a printable PDF document' },
    { value: 'png', label: 'PNG', description: 'Exports presentation slides as individual images' },
  ],
};

export function getAllowedDocumentFormats(file: File): TargetOption[] {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) return DOCUMENT_FORMAT_MATRIX['application/pdf'];
  if (name.endsWith('.docx')) return DOCUMENT_FORMAT_MATRIX['application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (name.endsWith('.doc')) return DOCUMENT_FORMAT_MATRIX['application/msword'];
  if (name.endsWith('.txt')) return DOCUMENT_FORMAT_MATRIX['text/plain'];
  if (name.endsWith('.csv')) return DOCUMENT_FORMAT_MATRIX['text/csv'];
  if (name.endsWith('.xlsx')) return DOCUMENT_FORMAT_MATRIX['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
  if (name.endsWith('.pptx')) return DOCUMENT_FORMAT_MATRIX['application/vnd.openxmlformats-officedocument.presentationml.presentation'];

  return DOCUMENT_FORMAT_MATRIX[mime] || [
    { value: 'pdf', label: 'PDF', description: 'Convert to PDF' },
    { value: 'txt', label: 'TXT', description: 'Extract text' },
  ];
}