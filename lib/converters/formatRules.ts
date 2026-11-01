export interface TargetOption {
  value: string;
  label: string;
  description: string;
}

const FORMAT_MATRIX: Record<string, TargetOption[]> = {
  // 1. JPG / JPEG
  'image/jpeg': [
    { value: 'image/png', label: 'PNG', description: 'Adds lossless clarity or transparency' },
    { value: 'image/webp', label: 'WebP', description: 'Optimizes for modern web performance' },
    { value: 'image/tiff', label: 'TIFF', description: 'High-resolution printing or archiving' },
    { value: 'image/gif', label: 'GIF', description: 'Indexed standard colors' },
    { value: 'image/x-icon', label: 'ICO', description: 'Website favicon' },
    { value: 'image/avif', label: 'AVIF', description: 'Next-gen high-efficiency web format' },
  ],
  // 2. PNG
  'image/png': [
    { value: 'image/jpeg', label: 'JPG', description: 'Flattens transparency for smaller size' },
    { value: 'image/webp', label: 'WebP', description: 'Maintains transparency with low weight' },
    { value: 'image/tiff', label: 'TIFF', description: 'High-end design suite compatibility' },
    { value: 'image/gif', label: 'GIF', description: 'Indexed color palette' },
    { value: 'image/x-icon', label: 'ICO', description: 'Application or browser icons' },
    { value: 'image/avif', label: 'AVIF', description: 'Next-gen lossless/lossy encoding' },
  ],
  // 3. WebP
  'image/webp': [
    { value: 'image/png', label: 'PNG', description: 'Restores standard lossless raster' },
    { value: 'image/jpeg', label: 'JPG', description: 'Legacy system compatibility' },
    { value: 'image/tiff', label: 'TIFF', description: 'Archival or print-ready files' },
    { value: 'image/gif', label: 'GIF', description: 'Basic indexed color format' },
    { value: 'image/x-icon', label: 'ICO', description: 'Creates custom icons' },
    { value: 'image/avif', label: 'AVIF', description: 'Alternative next-gen compression' },
  ],
  // 4. HEIC / HEIF
  'image/heic': [
    { value: 'image/jpeg', label: 'JPG', description: 'Universally viewable photo format' },
    { value: 'image/png', label: 'PNG', description: 'Uncompressed standard raster' },
    { value: 'image/webp', label: 'WebP', description: 'Optimized web publishing' },
    { value: 'image/tiff', label: 'TIFF', description: 'Professional publishing format' },
    { value: 'image/avif', label: 'AVIF', description: 'Modern web optimization' },
  ],
  // 5. AVIF
  'image/avif': [
    { value: 'image/jpeg', label: 'JPG', description: 'Converts next-gen AVIF to standard JPEG' },
    { value: 'image/png', label: 'PNG', description: 'Converts to lossless PNG raster' },
    { value: 'image/webp', label: 'WebP', description: 'Converts to WebP format' },
    { value: 'image/tiff', label: 'TIFF', description: 'High-resolution archival format' },
    { value: 'image/gif', label: 'GIF', description: 'Indexed color format' },
    { value: 'image/x-icon', label: 'ICO', description: 'Website favicon format' },
  ],
  // 6. ICO
  'image/x-icon': [
    { value: 'image/jpeg', label: 'JPG', description: 'Converts icon to standard JPEG' },
    { value: 'image/png', label: 'PNG', description: 'Converts icon to full-resolution PNG' },
    { value: 'image/webp', label: 'WebP', description: 'Converts to WebP format' },
    { value: 'image/tiff', label: 'TIFF', description: 'High-resolution archival format' },
    { value: 'image/gif', label: 'GIF', description: 'Indexed color format' },
    { value: 'image/avif', label: 'AVIF', description: 'Next-gen high-efficiency web format' },
  ],
  // 7. SVG
  'image/svg+xml': [
    { value: 'image/png', label: 'PNG', description: 'Rasterizes vector into clear pixel grid' },
    { value: 'image/jpeg', label: 'JPG', description: 'Flattens vector onto solid background' },
    { value: 'image/webp', label: 'WebP', description: 'Compressed next-gen web image' },
    { value: 'image/x-icon', label: 'ICO', description: 'Turns vector icon into website favicon' },
  ],
  // 8. TIFF / TIF
  'image/tiff': [
    { value: 'image/jpeg', label: 'JPG', description: 'Shrinks heavy print files for the web' },
    { value: 'image/png', label: 'PNG', description: 'Retains high fidelity with web support' },
    { value: 'image/webp', label: 'WebP', description: 'Compresses professional imagery' },
    { value: 'image/avif', label: 'AVIF', description: 'Next-gen compression for master files' },
  ],
  // 9. RAW Camera Formats
  'image/raw': [
    { value: 'image/jpeg', label: 'JPG', description: 'Renders sensor data into viewable photo' },
    { value: 'image/png', label: 'PNG', description: 'Uncompressed lossless image data' },
    { value: 'image/webp', label: 'WebP', description: 'Optimizes camera shots for galleries' },
    { value: 'image/tiff', label: 'TIFF', description: 'Preserves tonal detail for editing' },
  ],
  // 10. GIF
  'image/gif': [
    { value: 'image/png', label: 'PNG', description: 'Upgrades indexed colors to full RGB' },
    { value: 'image/jpeg', label: 'JPG', description: 'Standard photo format' },
    { value: 'image/webp', label: 'WebP', description: 'Next-gen web format' },
  ],
};

export function getAllowedFormats(file: File): TargetOption[] {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (name.endsWith('.heic') || name.endsWith('.heif')) return FORMAT_MATRIX['image/heic'];
  if (name.endsWith('.avif')) return FORMAT_MATRIX['image/avif'];
  if (name.endsWith('.ico')) return FORMAT_MATRIX['image/x-icon'];
  if (name.endsWith('.svg')) return FORMAT_MATRIX['image/svg+xml'];
  if (name.endsWith('.tiff') || name.endsWith('.tif')) return FORMAT_MATRIX['image/tiff'];
  if (/\.(raw|cr2|nef|arw|dng)$/.test(name)) return FORMAT_MATRIX['image/raw'];

  return FORMAT_MATRIX[mime] || FORMAT_MATRIX['image/jpeg'];
}