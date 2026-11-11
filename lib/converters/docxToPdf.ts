import { renderAsync } from "docx-preview";

export interface DocxToPdfOptions {
  onProgress?: (progress: number) => void;
}

export async function convertDocxToPdf(
  file: File | Blob,
  options: DocxToPdfOptions = {}
): Promise<Blob> {
  const { onProgress } = options;

  onProgress?.(20);

  const formData = new FormData();
  const fileName = (file as File).name || "document.docx";
  formData.append("file", file, fileName);

  onProgress?.(40);

  const response = await fetch("/api/convert-to-pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => null);
    throw new Error(errData?.error || `Server responded with ${response.status}`);
  }

  onProgress?.(85);
  const pdfBlob = await response.blob();
  onProgress?.(100);

  return pdfBlob;
}