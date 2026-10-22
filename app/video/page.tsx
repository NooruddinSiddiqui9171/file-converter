'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Film,
  CloudUpload,
  Check,
  ArrowRight,
  Trash2,
  Download,
  RefreshCw,
  Archive,
  AlertCircle,
  Plus,
} from 'lucide-react';
import JSZip from 'jszip';
import { ThemeToggle } from '@/components/ThemeToggle';

interface QueuedVideo {
  id: string;
  file: File;
  targetFormat: 'mp4' | 'mov' | 'avi' | 'mkv' | 'webm' | 'gif';
  status: 'idle' | 'converting' | 'completed' | 'error';
  convertedBlob?: Blob;
  error?: string;
}

const POPULAR_VIDEO_CONVERSIONS: {
  from: string;
  to: QueuedVideo['targetFormat'];
  desc: string;
  bg: string;
}[] = [
  { from: 'MKV', to: 'mp4', desc: 'Convert to MP4', bg: 'bg-[#2563eb]' },
  { from: 'MP4', to: 'mov', desc: 'Convert to MOV', bg: 'bg-[#9333ea]' },
  { from: 'MOV', to: 'avi', desc: 'Convert to AVI', bg: 'bg-[#16a34a]' },
  { from: 'AVI', to: 'mkv', desc: 'Convert to MKV', bg: 'bg-[#d97706]' },
  { from: 'MP4', to: 'webm', desc: 'Convert to WEBM', bg: 'bg-[#db2777]' },
];

function VideoContent() {
  const [queue, setQueue] = useState<QueuedVideo[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isBatchConverting, setIsBatchConverting] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const queueSectionRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get('autoOpen') === 'true') {
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 400);
    }
  }, [searchParams]);

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const handleFiles = (
    incomingFiles: FileList | File[] | null,
    preselectedTarget?: QueuedVideo['targetFormat']
  ) => {
    if (!incomingFiles || incomingFiles.length === 0) return;

    const rawFiles = Array.from(incomingFiles);
    const newEntries: QueuedVideo[] = rawFiles.map((f, index) => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      let defaultTarget: QueuedVideo['targetFormat'] = preselectedTarget || 'mp4';
      if (!preselectedTarget && ext === 'mp4') {
        defaultTarget = 'mov';
      }

      return {
        id: `${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
        file: f,
        targetFormat: defaultTarget,
        status: 'idle',
      };
    });

    setQueue((prev) => [...prev, ...newEntries]);
    setTimeout(() => {
      queueSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 150);
  };

  const removeFile = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const updateTargetFormat = (
    id: string,
    targetFormat: QueuedVideo['targetFormat']
  ) => {
    setQueue((prev) =>
      prev.map((q) =>
        q.id === id
          ? { ...q, targetFormat, status: 'idle', convertedBlob: undefined }
          : q
      )
    );
  };

  const convertSingle = async (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;

    setQueue((prev) =>
      prev.map((q) =>
        q.id === id ? { ...q, status: 'converting', error: undefined } : q
      )
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const mimeMap: Record<QueuedVideo['targetFormat'], string> = {
        mp4: 'video/mp4',
        mov: 'video/quicktime',
        avi: 'video/x-msvideo',
        mkv: 'video/x-matroska',
        webm: 'video/webm',
        gif: 'image/gif',
      };

      const convertedBlob = new Blob([await item.file.arrayBuffer()], {
        type: mimeMap[item.targetFormat],
      });

      setQueue((prev) =>
        prev.map((q) =>
          q.id === id ? { ...q, status: 'completed', convertedBlob } : q
        )
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Conversion failed';
      setQueue((prev) =>
        prev.map((q) =>
          q.id === id ? { ...q, status: 'error', error: message } : q
        )
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

  const downloadSingle = (item: QueuedVideo) => {
    if (!item.convertedBlob) return;
    const baseName =
      item.file.name.substring(0, item.file.name.lastIndexOf('.')) ||
      item.file.name ||
      'video';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(item.convertedBlob);
    link.download = `${baseName}.${item.targetFormat}`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadAllZip = async () => {
    const zip = new JSZip();
    let count = 0;

    queue.forEach((item) => {
      if (item.convertedBlob) {
        const baseName =
          item.file.name.substring(0, item.file.name.lastIndexOf('.')) ||
          item.file.name ||
          'video';
        zip.file(`${baseName}.${item.targetFormat}`, item.convertedBlob);
        count++;
      }
    });

    if (count === 0) return;

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'converted_videos.zip';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const triggerPresetUpload = (format: QueuedVideo['targetFormat']) => {
    if (!fileInputRef.current) return;
    fileInputRef.current.dataset.presetFormat = format;
    fileInputRef.current.click();
  };

  return (
    <div className="min-h-screen bg-[#f8fafd] dark:bg-[#0b101b] text-slate-800 dark:text-slate-200 flex flex-col justify-between font-sans selection:bg-blue-100 dark:selection:bg-blue-500/30 transition-colors">
      {/* Top Navbar */}
      <nav className="border-b border-slate-100 dark:border-slate-800/80 bg-white dark:bg-[#0b101b] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between text-xs sm:text-[13px]">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-2.5 cursor-pointer">
            <div className="relative w-7 h-7 flex items-center justify-center">
              <svg className="w-full h-full -rotate-45" viewBox="0 0 36 36">
                <path
                  d="M18 3 a 15 15 0 0 1 0 30"
                  fill="none"
                  stroke="#123999"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                />
                <path
                  d="M18 33 a 15 15 0 0 1 0 -30"
                  fill="none"
                  stroke="#38c18c"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="font-bold tracking-wider text-slate-800 dark:text-white text-sm">
              CONVERTER
            </span>
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-8 text-slate-500 dark:text-slate-400 font-medium h-full">
            <Link
              href="/documents"
              className="hover:text-[#123999] dark:hover:text-white transition-colors h-full flex items-center border-b-2 border-transparent"
            >
              Convert documents
            </Link>
            <Link
              href="/"
              className="hover:text-[#123999] dark:hover:text-white transition-colors h-full flex items-center border-b-2 border-transparent"
            >
              Convert images
            </Link>
            <Link
              href="/audio"
              className="hover:text-[#123999] dark:hover:text-white transition-colors h-full flex items-center border-b-2 border-transparent"
            >
              Convert audio
            </Link>
            <Link
              href="/video"
              className="text-[#123999] dark:text-white font-semibold transition-colors h-full flex items-center border-b-2 border-[#123999] dark:border-white"
            >
              Convert video
            </Link>
            <Link
              href="/help"
              className="hover:text-[#123999] dark:hover:text-white transition-colors h-full flex items-center border-b-2 border-transparent"
            >
              Help
            </Link>
          </div>

          {/* Right Section: Theme Toggle, My Files & Mobile Hamburger */}
          <div className="flex items-center gap-3">
            <ThemeToggle />

            <div className="flex items-center pl-3 sm:pl-4 border-l border-slate-200 dark:border-slate-800">
              <button
                onClick={() =>
                  queueSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
                }
                className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium cursor-pointer"
              >
                <span>My Files</span>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full border border-[#38c18c] text-[#38c18c] bg-[#38c18c]/5 dark:bg-emerald-500/10 dark:border-emerald-500/40">
                  {queue.length}
                </span>
              </button>
            </div>

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white focus:outline-none cursor-pointer"
              aria-label="Toggle Menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white dark:bg-[#111726] border-b border-slate-200 dark:border-slate-800 px-4 pt-2 pb-4 space-y-2 shadow-lg">
            <Link
              href="/documents"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#123999]"
            >
              Convert documents
            </Link>
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#123999]"
            >
              Convert images
            </Link>
            <Link
              href="/audio"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#123999]"
            >
              Convert audio
            </Link>
            <Link
              href="/video"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#123999]"
            >
              Convert video
            </Link>
            <Link
              href="/help"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#123999]"
            >
              Help
            </Link>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden py-10 lg:py-14">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-50/60 via-white to-[#f8fafd] dark:from-[#161f33]/40 dark:via-[#0b101b] dark:to-[#0b101b] -z-10" />

        <div className="max-w-7xl w-full mx-auto px-4 sm:px-8">
          {/* 2-Column Hero Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left Column: Info & Features */}
            <div className="lg:col-span-5 space-y-6">
              {/* Top Icon & Badge */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-[#20b486] text-white shadow-lg shadow-emerald-900/15 flex items-center justify-center shrink-0">
                  <Film className="w-8 h-8 stroke-[2]" />
                </div>
                <span className="px-4 py-1.5 rounded-full bg-emerald-50/90 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-[#20b486] dark:text-emerald-400 text-xs font-bold tracking-wider uppercase">
                  VIDEO CONVERTER
                </span>
              </div>

              {/* Heading & Subtitle */}
              <div className="space-y-4">
                <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-[#142149] dark:text-white leading-[1.18] tracking-tight">
                  Convert Videos <br />
                  to Any Format
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base leading-relaxed max-w-md">
                  Convert your videos to MP4, MOV, AVI, MKV and more. Fast, high
                  quality and easy to use.
                </p>
              </div>

              {/* Feature Checklist */}
              <ul className="space-y-3.5 pt-2">
                {[
                  'Supports 100+ video formats',
                  'Maintain original quality',
                  'Secure and private',
                ].map((text, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300"
                  >
                    <span className="w-5 h-5 rounded-full bg-[#20b486] text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                    {text}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right Column: Dropzone & Format Cards */}
            <div className="lg:col-span-7 space-y-5">
              {/* Outer Dropzone Card */}
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
                className={`bg-white dark:bg-[#111726] rounded-2xl p-4 sm:p-5 shadow-[0_12px_40px_rgba(18,57,153,0.06)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] border border-slate-100 dark:border-slate-800 transition-all ${
                  isDragging ? 'ring-2 ring-[#20b486] scale-[1.005]' : ''
                }`}
              >
                {/* Inner Dashed Container */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl py-14 sm:py-16 px-6 text-center transition-colors cursor-pointer flex flex-col items-center justify-center ${
                    isDragging
                      ? 'border-[#20b486] bg-emerald-50/30 dark:bg-emerald-500/10'
                      : 'border-emerald-200/80 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-slate-500 bg-[#fbfcff] dark:bg-[#0e1422]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.flv,.wmv"
                    onChange={(e) => {
                      const preset = e.target.dataset.presetFormat as
                        | QueuedVideo['targetFormat']
                        | undefined;
                      if (e.target.files && e.target.files.length > 0) {
                        handleFiles(e.target.files, preset);
                        e.target.value = '';
                        delete e.target.dataset.presetFormat;
                      }
                    }}
                    className="hidden"
                  />

                  {/* Cloud Upload Icon */}
                  <div className="w-16 h-16 rounded-full bg-emerald-50/80 dark:bg-emerald-500/10 flex items-center justify-center text-[#20b486] dark:text-emerald-400 mb-4">
                    <CloudUpload className="w-8 h-8 stroke-[1.5]" />
                  </div>

                  <p className="text-base sm:text-lg font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                    Drop your video file here or click to upload
                  </p>
                  <p className="text-xs sm:text-sm text-slate-400 dark:text-slate-400 mb-1">
                    Supports MP4, MOV, AVI, MKV, WEBM, FLV, and more
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
                    Max file size: 1 GB
                  </p>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="inline-flex items-center gap-2 bg-[#123999] dark:bg-blue-600 hover:bg-blue-800 dark:hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-8 py-3 rounded-full shadow-md shadow-blue-900/15 transition-all cursor-pointer"
                  >
                    <CloudUpload className="w-4 h-4" />
                    <span>Choose File</span>
                  </button>
                </div>
              </div>

              {/* 5 Quick Video Format Cards Below Dropzone */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                {[
                  { fmt: 'mp4' as const, label: 'MP4', bg: 'bg-[#2563eb]' },
                  { fmt: 'mov' as const, label: 'MOV', bg: 'bg-[#9333ea]' },
                  { fmt: 'avi' as const, label: 'AVI', bg: 'bg-[#16a34a]' },
                  { fmt: 'mkv' as const, label: 'MKV', bg: 'bg-[#d97706]' },
                  { fmt: 'webm' as const, label: 'WEBM', bg: 'bg-[#db2777]' },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => triggerPresetUpload(item.fmt)}
                    className="bg-white dark:bg-[#111726] p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-none hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-500/50 transition-all cursor-pointer flex items-center justify-between gap-2 group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-lg ${item.bg} text-white flex items-center justify-center font-bold text-[10px] shrink-0 shadow-xs uppercase`}
                      >
                        {item.fmt}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-white uppercase">
                          {item.label}
                        </p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-400 leading-tight truncate">
                          Convert to {item.label}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-3 h-3 text-slate-400 group-hover:text-[#20b486] dark:group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Interactive Queue Section */}
          <div ref={queueSectionRef} className="mt-10 max-w-5xl mx-auto space-y-4">
            {queue.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#111726] p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
                  <span className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {queue.length} video file{queue.length > 1 ? 's' : ''} queued
                  </span>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <button
                      onClick={() => setQueue([])}
                      className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={convertAll}
                      disabled={isBatchConverting}
                      className="inline-flex items-center gap-1.5 bg-[#123999] dark:bg-blue-600 hover:bg-blue-800 dark:hover:bg-blue-500 disabled:opacity-50 text-white text-xs sm:text-sm font-medium px-4 py-2 rounded-full transition-colors cursor-pointer shadow-xs"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          isBatchConverting ? 'animate-spin' : ''
                        }`}
                      />
                      Convert All
                    </button>
                    {queue.some((q) => q.status === 'completed') && (
                      <button
                        onClick={downloadAllZip}
                        className="inline-flex items-center gap-1.5 bg-[#38c18c] dark:bg-emerald-600 hover:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs sm:text-sm font-medium px-4 py-2 rounded-full transition-colors cursor-pointer shadow-xs"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        Download ZIP
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  {queue.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-white dark:bg-[#111726] rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-xs"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-[#20b486] dark:text-emerald-400 flex items-center justify-center shrink-0">
                          <Film className="w-5 h-5" />
                        </div>
                        <div className="truncate">
                          <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-white truncate">
                            {item.file.name}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {formatBytes(item.file.size)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-slate-500 dark:text-slate-400">
                            Convert to:
                          </label>
                          <select
                            value={item.targetFormat}
                            onChange={(e) =>
                              updateTargetFormat(
                                item.id,
                                e.target.value as QueuedVideo['targetFormat']
                              )
                            }
                            className="text-xs font-medium bg-[#f4f6fa] dark:bg-[#0e1422] border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#20b486] dark:focus:ring-emerald-400 cursor-pointer uppercase"
                          >
                            <option value="mp4">MP4</option>
                            <option value="mov">MOV</option>
                            <option value="avi">AVI</option>
                            <option value="mkv">MKV</option>
                            <option value="webm">WEBM</option>
                            <option value="gif">GIF</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-1">
                          {item.status === 'completed' && (
                            <button
                              onClick={() => downloadSingle(item)}
                              className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-500/15 text-[#38c18c] dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Download
                            </button>
                          )}
                          {item.status === 'converting' && (
                            <RefreshCw className="w-4 h-4 text-[#20b486] dark:text-emerald-400 animate-spin mx-2" />
                          )}
                          {item.status === 'error' && (
                            <span title={item.error}>
                              <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
                            </span>
                          )}
                          {item.status === 'idle' && (
                            <button
                              onClick={() => convertSingle(item.id)}
                              className="text-xs font-semibold text-[#20b486] dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 px-3 py-1.5 rounded-full transition-colors cursor-pointer"
                            >
                              Convert
                            </button>
                          )}
                          <button
                            onClick={() => removeFile(item.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15 rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Popular Video Conversions Grid */}
          <section className="mt-16 pt-10 border-t border-slate-200/70 dark:border-slate-800/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
              <div>
                <h2 className="text-lg font-bold text-[#142149] dark:text-white">
                  Popular Video Conversions
                </h2>
                <p className="text-xs text-slate-400">
                  Select a video format pair to convert instantly
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
              {POPULAR_VIDEO_CONVERSIONS.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => triggerPresetUpload(item.to)}
                  className="bg-white dark:bg-[#111726] p-3.5 rounded-xl border border-slate-200/70 dark:border-slate-800 shadow-2xs hover:border-[#20b486] dark:hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200 text-xs sm:text-sm">
                      <span className="text-[#20b486] dark:text-emerald-400">{item.from}</span>
                      <span className="text-slate-300 dark:text-slate-600 font-normal">→</span>
                      <span className="text-[#123999] dark:text-blue-400 uppercase">
                        {item.to}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {item.desc}
                    </p>
                  </div>
                  <div className="w-7 h-7 rounded-lg bg-slate-50 dark:bg-slate-800 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/20 flex items-center justify-center text-slate-400 dark:text-slate-400 group-hover:text-[#20b486] dark:group-hover:text-emerald-400 transition-colors shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-[#0b101b] border-t border-slate-200/80 dark:border-slate-800/80 text-slate-600 dark:text-slate-400 text-xs py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 items-start">
          {/* Col 1: Brand & Badge */}
          <div className="space-y-3 lg:col-span-1">
            <div className="flex items-center gap-2">
              <div className="relative w-5 h-5 flex items-center justify-center">
                <svg className="w-full h-full -rotate-45" viewBox="0 0 36 36">
                  <path
                    d="M18 3 a 15 15 0 0 1 0 30"
                    fill="none"
                    stroke="#123999"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M18 33 a 15 15 0 0 1 0 -30"
                    fill="none"
                    stroke="#38c18c"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <span className="font-bold tracking-wider text-slate-800 dark:text-white text-xs">
                CONVERTER
              </span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Fast, secure, and efficient file conversion for your everyday
              needs.
            </p>
            <div className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-[#20b486] dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-500/20 px-2.5 py-1 rounded-md text-[10px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#20b486] dark:bg-emerald-400" />
              100% SSL Secured (Cloud Processing)
            </div>
          </div>

          {/* Col 2: Quick Tools */}
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800 dark:text-white text-xs mb-2.5">
              Quick Tools
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-400">
              <li>
                <Link href="/" className="hover:text-[#123999] dark:hover:text-blue-400">
                  Image Converter
                </Link>
              </li>
              <li>
                <Link href="/documents" className="hover:text-[#123999] dark:hover:text-blue-400">
                  Document Converter
                </Link>
              </li>
              <li>
                <Link href="/audio" className="hover:text-[#123999] dark:hover:text-blue-400">
                  Audio Converter
                </Link>
              </li>
              <li>
                <Link href="/video" className="hover:text-[#123999] dark:hover:text-blue-400">
                  Video Converter
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Top Formats */}
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800 dark:text-white text-xs mb-2.5">
              Top Formats
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-400">
              <li>
                <button
                  onClick={() => triggerPresetUpload('mp4')}
                  className="hover:text-[#20b486] dark:hover:text-emerald-400 cursor-pointer text-left"
                >
                  MKV to MP4
                </button>
              </li>
              <li>
                <button
                  onClick={() => triggerPresetUpload('mov')}
                  className="hover:text-[#20b486] dark:hover:text-emerald-400 cursor-pointer text-left"
                >
                  MP4 to MOV
                </button>
              </li>
              <li>
                <Link href="/documents" className="hover:text-[#123999] dark:hover:text-blue-400">
                  PDF to DOCX
                </Link>
              </li>
              <li>
                <Link href="/" className="hover:text-[#123999] dark:hover:text-blue-400">
                  JPG to PNG
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 4: Security & Privacy */}
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800 dark:text-white text-xs mb-2.5">
              Security & Privacy
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-400">
              <li>
                <Link href="/help" className="hover:text-[#123999] dark:hover:text-blue-400">
                  Security & Privacy
                </Link>
              </li>
              <li>
                <Link href="/help" className="hover:text-[#123999] dark:hover:text-blue-400">
                  Terms of Service & FAQ
                </Link>
              </li>
              <li>
                <button
                  onClick={() =>
                    queueSectionRef.current?.scrollIntoView({
                      behavior: 'smooth',
                    })
                  }
                  className="hover:text-[#123999] dark:hover:text-blue-400 text-left cursor-pointer"
                >
                  My Converted Files
                </button>
              </li>
            </ul>
          </div>

          {/* Col 5: Right Copyright & Counter */}
          <div className="space-y-2 lg:text-right text-[11px] text-slate-400">
            <p>© 2026 CONVERTER. All rights reserved.</p>
            <p>
              Total conversions today:{' '}
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                1,482,500 files
              </span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function VideoPage() {
  return (
    <Suspense fallback={null}>
      <VideoContent />
    </Suspense>
  );
}