'use client';

import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Trash2, Download, AlertCircle, RefreshCw, Archive } from 'lucide-react';
import JSZip from 'jszip';
import { convertImage, getExtensionFromMime } from '@/lib/converters/image';

interface QueuedFile {
  id: string;
  file: File;
  previewUrl: string;
  targetFormat: 'image/png' | 'image/jpeg' | 'image/webp';
  quality: number;
  status: 'idle' | 'converting' | 'completed' | 'error';
  convertedBlob?: Blob;
  estimatedSize?: number;
  isEstimating?: boolean;
  error?: string;
}

export default function Home() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isBatchConverting, setIsBatchConverting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceTimers = useRef<{ [key: string]: NodeJS.Timeout }>({});

  // Cleanup object URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      queue.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const updateEstimatedSize = async (
    id: string,
    targetFile: File,
    format: 'image/png' | 'image/jpeg' | 'image/webp',
    quality: number
  ) => {
    setQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, isEstimating: true } : q))
    );

    try {
      const previewBlob = await convertImage(targetFile, {
        targetFormat: format,
        quality: quality,
      });

      setQueue((prev) =>
        prev.map((q) =>
          q.id === id ? { ...q, estimatedSize: previewBlob.size, isEstimating: false } : q
        )
      );
    } catch {
      setQueue((prev) =>
        prev.map((q) => (q.id === id ? { ...q, isEstimating: false } : q))
      );
    }
  };

  const handleFiles = (incomingFiles: FileList | File[] | null) => {
    if (!incomingFiles || incomingFiles.length === 0) return;

    const rawFiles = Array.from(incomingFiles);

    const newEntries: QueuedFile[] = rawFiles.map((f, index) => {
      const isJpeg =
        (f.type && (f.type.includes('jpeg') || f.type.includes('jpg'))) ||
        /\.jpe?g$/i.test(f.name || '');
      const defaultFormat = isJpeg ? 'image/png' : 'image/jpeg';
      const defaultQuality = 0.9;
      const id = `${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`;
      const previewUrl = URL.createObjectURL(f);

      // Run background preview size calculation
      setTimeout(() => {
        updateEstimatedSize(id, f, defaultFormat, defaultQuality);
      }, 100);

      return {
        id,
        file: f,
        previewUrl,
        targetFormat: defaultFormat,
        quality: defaultQuality,
        status: 'idle',
      };
    });

    setQueue((prev) => [...prev, ...newEntries]);
  };

  const removeFile = (id: string) => {
    setQueue((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const updateFileFormat = (
    id: string,
    format: 'image/png' | 'image/jpeg' | 'image/webp'
  ) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;

    setQueue((prev) =>
      prev.map((q) =>
        q.id === id
          ? { ...q, targetFormat: format, status: 'idle', convertedBlob: undefined }
          : q
      )
    );
    updateEstimatedSize(id, item.file, format, item.quality);
  };

  const handleQualityChange = (id: string, quality: number) => {
    const currentItem = queue.find((q) => q.id === id);
    if (!currentItem) return;

    setQueue((prev) =>
      prev.map((q) =>
        q.id === id
          ? { ...q, quality, status: 'idle', convertedBlob: undefined }
          : q
      )
    );

    if (debounceTimers.current[id]) {
      clearTimeout(debounceTimers.current[id]);
    }

    debounceTimers.current[id] = setTimeout(() => {
      updateEstimatedSize(id, currentItem.file, currentItem.targetFormat, quality);
    }, 200);
  };

  const convertSingle = async (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;

    setQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: 'converting', error: undefined } : q))
    );

    try {
      const blob = await convertImage(item.file, {
        targetFormat: item.targetFormat,
        quality: item.quality,
      });

      setQueue((prev) =>
        prev.map((q) =>
          q.id === id
            ? { ...q, status: 'completed', convertedBlob: blob, estimatedSize: blob.size }
            : q
        )
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Conversion failed';
      setQueue((prev) =>
        prev.map((q) => (q.id === id ? { ...q, status: 'error', error: message } : q))
      );
    }
  };

  const convertAll = async () => {
    setIsBatchConverting(true);
    for (const item of queue) {
      if (item.status !== 'completed') {
        await convertSingle(item.id);
      }
    }
    setIsBatchConverting(false);
  };

  const downloadSingle = (item: QueuedFile) => {
    if (!item.convertedBlob) return;
    const ext = getExtensionFromMime(item.targetFormat);
    const baseName =
      item.file.name.substring(0, item.file.name.lastIndexOf('.')) || item.file.name || 'image';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(item.convertedBlob);
    link.download = `${baseName}.${ext}`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadAllZip = async () => {
    const zip = new JSZip();
    let count = 0;

    queue.forEach((item) => {
      if (item.convertedBlob) {
        const ext = getExtensionFromMime(item.targetFormat);
        const baseName =
          item.file.name.substring(0, item.file.name.lastIndexOf('.')) || item.file.name || 'image';
        zip.file(`${baseName}.${ext}`, item.convertedBlob);
        count++;
      }
    });

    if (count === 0) return;

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'converted_images.zip';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="text-center space-y-1">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight">
            Image Converter
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm md:text-base">
            Pure client-side conversion. Files never leave your browser.
          </p>
        </header>

        {/* Dropzone with Native Input Overlay */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              handleFiles(e.dataTransfer.files);
            }
          }}
          className={`relative border-2 border-dashed rounded-xl p-6 sm:p-10 text-center transition-colors cursor-pointer ${
            isDragging
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-300 hover:border-slate-400 bg-white'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFiles(e.target.files);
                e.target.value = '';
              }
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="flex flex-col items-center justify-center space-y-2 pointer-events-none">
            <div className="p-3 bg-blue-50 rounded-full text-blue-600">
              <UploadCloud className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <div>
              <p className="text-sm sm:text-base font-semibold">
                Click to upload or drag & drop
              </p>
              <p className="text-xs text-slate-400 mt-1">
                PNG, JPG, WebP, SVG, BMP, or GIF
              </p>
            </div>
          </div>
        </div>

        {/* Batch Action Bar */}
        {queue.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs sm:text-sm font-medium text-slate-600">
              {queue.length} file{queue.length > 1 ? 's' : ''} queued
            </span>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setQueue([])}
                className="text-xs sm:text-sm text-slate-500 hover:text-red-600 px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                Clear All
              </button>
              <button
                onClick={convertAll}
                disabled={isBatchConverting}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
                    isBatchConverting ? 'animate-spin' : ''
                  }`}
                />
                Convert All
              </button>
              {queue.some((q) => q.status === 'completed') && (
                <button
                  onClick={downloadAllZip}
                  className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Download ZIP
                </button>
              )}
            </div>
          </div>
        )}

        {/* Queued Cards with Thumbnail Preview */}
        <div className="space-y-3">
          {queue.map((item) => {
            const originalSize = item.file.size;
            const targetSize = item.convertedBlob?.size || item.estimatedSize;
            const savingsPercent =
              targetSize && originalSize
                ? Math.round(((originalSize - targetSize) / originalSize) * 100)
                : null;

            return (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 sm:p-4 bg-white rounded-xl border border-slate-200 shadow-sm"
              >
                {/* Thumbnail Preview & File Details */}
                <div className="flex items-center gap-3 overflow-hidden min-w-0">
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="w-12 h-12 object-cover rounded-lg border border-slate-200 shrink-0 bg-slate-100"
                  />
                  <div className="truncate">
                    <p className="text-xs sm:text-sm font-medium truncate">
                      {item.file.name || 'Selected Image'}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] sm:text-xs mt-0.5 text-slate-500">
                      <span>{formatBytes(originalSize)}</span>
                      {targetSize && (
                        <>
                          <span className="text-slate-300">→</span>
                          <span
                            className={
                              item.isEstimating
                                ? 'opacity-40'
                                : 'text-slate-700 font-medium'
                            }
                          >
                            {formatBytes(targetSize)}
                          </span>
                          {savingsPercent !== null && savingsPercent > 0 && (
                            <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                              -{savingsPercent}%
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Format, Quality Slider & Actions */}
                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-500">To:</label>
                    <select
                      value={item.targetFormat}
                      onChange={(e) =>
                        updateFileFormat(
                          item.id,
                          e.target.value as 'image/png' | 'image/jpeg' | 'image/webp'
                        )
                      }
                      className="text-xs bg-slate-50 border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="image/png">PNG</option>
                      <option value="image/jpeg">JPG</option>
                      <option value="image/webp">WebP</option>
                    </select>
                  </div>

                  {item.targetFormat !== 'image/png' && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] text-slate-500">Quality:</label>
                      <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.05"
                        value={item.quality}
                        onChange={(e) =>
                          handleQualityChange(item.id, parseFloat(e.target.value))
                        }
                        className="w-16 sm:w-20 accent-blue-600 cursor-pointer"
                      />
                      <span className="text-[11px] text-slate-500 w-8">
                        {Math.round(item.quality * 100)}%
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-1">
                    {item.status === 'completed' && (
                      <button
                        onClick={() => downloadSingle(item)}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors cursor-pointer"
                        title="Download Converted File"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    {item.status === 'converting' && (
                      <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
                    )}
                    {item.status === 'error' && (
                      <span title={item.error}>
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      </span>
                    )}
                    {item.status === 'idle' && (
                      <button
                        onClick={() => convertSingle(item.id)}
                        className="text-xs font-medium text-blue-600 hover:bg-blue-50 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                      >
                        Convert
                      </button>
                    )}
                    <button
                      onClick={() => removeFile(item.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                      title="Remove from Queue"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}