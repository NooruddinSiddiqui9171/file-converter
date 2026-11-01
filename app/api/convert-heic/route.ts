import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import convert from 'heic-convert';
import sharp from 'sharp';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const targetFormat = (formData.get('targetFormat') as string) || 'image/jpeg';
    const quality = parseFloat((formData.get('quality') as string) || '0.9');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // Decode HEIC using heic-convert (handles HEVC profiles)
    const decodedJpegBuffer = (await convert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: quality,
    })) as ArrayBuffer;

    let outputBuffer: Buffer;
    let contentType = targetFormat;

    if (targetFormat === 'image/jpeg') {
      outputBuffer = Buffer.from(decodedJpegBuffer);
    } else {
      const pipeline = sharp(Buffer.from(decodedJpegBuffer));
      switch (targetFormat) {
        case 'image/webp':
          outputBuffer = await pipeline
            .webp({ quality: Math.round(quality * 100) })
            .toBuffer();
          break;
        case 'image/png':
          outputBuffer = await pipeline.png().toBuffer();
          break;
        case 'image/bmp':
          outputBuffer = await pipeline.toFormat('bmp' as any).toBuffer();
          contentType = 'image/bmp';
          break;
        case 'image/tiff':
          outputBuffer = await pipeline.tiff().toBuffer();
          contentType = 'image/tiff';
          break;
        case 'image/gif':
          outputBuffer = await pipeline.gif().toBuffer();
          contentType = 'image/gif';
          break;
        case 'image/avif':
          outputBuffer = await pipeline
            .avif({ quality: Math.round(quality * 100) })
            .toBuffer();
          contentType = 'image/avif';
          break;
        default:
          outputBuffer = Buffer.from(decodedJpegBuffer);
          contentType = 'image/jpeg';
      }
    }

    return new NextResponse(outputBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': outputBuffer.length.toString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Conversion failed';
    console.error('Server HEIC conversion error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}