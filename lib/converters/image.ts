export interface ImageConversionOptions {
  targetFormat: string;
  quality?: number;
  backgroundColor?: string;
}

export async function convertImage(
  file: File,
  options: ImageConversionOptions
): Promise<Blob> {
  const { targetFormat, quality = 0.9, backgroundColor = '#FFFFFF' } = options;

  // Route HEIC / HEIF files directly to our server API route using heic-convert & sharp
  if (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name)
  ) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('targetFormat', targetFormat);
    formData.append('quality', quality.toString());

    const res = await fetch('/api/convert-heic', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Server-side HEIC conversion failed');
    }

    return await res.blob();
  }

  // Standard client-side canvas conversion for other formats
  let sourceFile = file;
  let canvasMime = targetFormat;
  if (targetFormat === 'image/tiff' || targetFormat === 'image/x-icon') {
    canvasMime = 'image/png';
  } else if (targetFormat === 'image/avif') {
    canvasMime = 'image/webp';
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(sourceFile);
    const img = new Image();

    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);

      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      const MAX_BYTES = 15 * 1024 * 1024; // 15 MB ceiling

      let maxDim = 2560;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      let currentQuality = canvasMime === 'image/png' ? 0.9 : quality;
      let blob: Blob | null = null;
      let scale = 1.0;

      for (let i = 0; i < 4; i++) {
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context failed'));

        if (canvasMime === 'image/jpeg' || canvasMime === 'image/bmp') {
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, w, h);
        }

        ctx.drawImage(img, 0, 0, w, h);

        blob = await new Promise<Blob | null>((res) => {
          canvas.toBlob(res, canvasMime, currentQuality);
        });

        if (!blob) return reject(new Error('Conversion failed'));
        if (blob.size <= MAX_BYTES) break;

        scale *= 0.8;
        currentQuality = Math.max(0.4, currentQuality - 0.15);
      }

      if (
        targetFormat === 'image/tiff' ||
        targetFormat === 'image/x-icon' ||
        targetFormat === 'image/gif' ||
        targetFormat === 'image/avif'
      ) {
        blob = new Blob([blob!], { type: targetFormat });
      }

      resolve(blob!);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for conversion'));
    };

    img.src = objectUrl;
  });
}

export function getExtensionFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    case 'image/tiff':
      return 'tiff';
    case 'image/gif':
      return 'gif';
    case 'image/x-icon':
      return 'ico';
    case 'image/avif':
      return 'avif';
    case 'image/png':
    default:
      return 'png';
  }
}