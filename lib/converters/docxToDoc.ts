export interface DocxToDocOptions {
  onProgress?: (progress: number) => void;
}

export async function convertDocxToDoc(
  file: File | Blob,
  options: DocxToDocOptions = {}
): Promise<Blob> {
  const { onProgress } = options;

  onProgress?.(20);

  const formData = new FormData();
  const fileName = (file as File).name || "document.docx";
  formData.append("file", file, fileName);

  onProgress?.(40);

  const response = await fetch("/api/convert-to-doc", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => null);
    throw new Error(errData?.error || `Server responded with ${response.status}`);
  }

  onProgress?.(85);
  const docBlob = await response.blob();
  onProgress?.(100);

  return docBlob;
}