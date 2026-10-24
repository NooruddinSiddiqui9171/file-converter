'use client';

import React, { useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { CloudUpload } from 'lucide-react';

export interface DropZoneRef {
  open: (presetFormat?: string) => void;
}

interface DropZoneProps {
  accept: string;
  maxSizeLabel?: string;
  description?: string;
  onFilesSelected: (files: FileList, presetFormat?: string) => void;
  icon?: React.ReactNode;
  ringColorClass?: string;
  className?: string;
  children?: React.ReactNode;
  customInner?: React.ReactNode;
  hideButton?: boolean;
}

export const DropZone = forwardRef<DropZoneRef, DropZoneProps>(({
  accept,
  maxSizeLabel = '100 MB',
  description = 'Supports multiple file formats',
  onFilesSelected,
  icon,
  ringColorClass = 'ring-2 ring-[#123999]',
  className = '',
  children,
  customInner,
  hideButton = false,
}, ref) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetFormatRef = useRef<string | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    open: (preset?: string) => {
      presetFormatRef.current = preset;
      fileInputRef.current?.click();
    },
  }));

  return (
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
          onFilesSelected(e.dataTransfer.files, presetFormatRef.current);
          presetFormatRef.current = undefined;
        }
      }}
      className={`relative transition-all ${
        isDragging ? `${ringColorClass} scale-[1.005]` : ''
      } ${className}`}
    >
      <div
        onClick={() => {
          presetFormatRef.current = undefined;
          fileInputRef.current?.click();
        }}
        className="cursor-pointer"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFilesSelected(e.target.files, presetFormatRef.current);
              e.target.value = '';
              presetFormatRef.current = undefined;
            }
          }}
          className="hidden"
        />
        {customInner ? (
          customInner
        ) : (
          <div className="border-2 border-dashed rounded-xl py-14 sm:py-16 px-6 text-center transition-colors flex flex-col items-center justify-center bg-white dark:bg-[#0e1422] border-blue-200/80 dark:border-slate-700 hover:border-blue-400 dark:hover:border-slate-500">
            <div className="w-16 h-16 rounded-full bg-blue-50/80 dark:bg-blue-500/10 flex items-center justify-center text-blue-500 dark:text-blue-400 mb-4">
              {icon || <CloudUpload className="w-8 h-8 stroke-[1.5]" />}
            </div>
            <p className="text-base sm:text-lg font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
              Drop your files here or click to upload
            </p>
            <p className="text-xs sm:text-sm text-slate-400 dark:text-slate-400 mb-1">
              {description}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
              Max file size: {maxSizeLabel}
            </p>
            {!hideButton && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  presetFormatRef.current = undefined;
                  fileInputRef.current?.click();
                }}
                className="inline-flex items-center gap-2 bg-[#123999] dark:bg-blue-600 hover:bg-blue-800 dark:hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-8 py-3 rounded-full shadow-md shadow-blue-900/15 transition-all cursor-pointer"
              >
                <CloudUpload className="w-4 h-4" />
                <span>Choose File</span>
              </button>
            )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
});

DropZone.displayName = 'DropZone';