export interface ImageConversionOptions {
  targetFormat: 'image/png' | 'image/jpeg' | 'image/webp';
  quality?: number; // 0.1 to 1.0 (ignored for PNG)
  backgroundColor?: string; // fills transparency for PNG -> JPG
}

/**
 * Converts any browser-supported image File to PNG, JPEG, or WebP.
 */
export async function convertImage(
  file: File,
  options: ImageConversionOptions
): Promise<Blob> {
  const { targetFormat, quality = 0.9, backgroundColor = '#FFFFFF' } = options;

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Failed to get 2D canvas context'));
      }

      // If target is JPEG, fill background so transparent pixels don't turn black
      if (targetFormat === 'image/jpeg') {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            return reject(new Error('Canvas conversion to Blob failed'));
          }
          resolve(blob);
        },
        targetFormat,
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image file into browser decoder'));
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
    case 'image/png':
    default:
      return 'png';
  }
}