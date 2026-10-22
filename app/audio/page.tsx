'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Music,
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

interface QueuedAudio {
  id: string;
  file: File;
  targetFormat: 'mp3' | 'wav' | 'aac' | 'flac' | 'ogg' | 'm4a';
  status: 'idle' | 'converting' | 'completed' | 'error';
  convertedBlob?: Blob;
  error?: string;
}

const POPULAR_AUDIO_CONVERSIONS: {
  from: string;
  to: QueuedAudio['targetFormat'];
  desc: string;
  bg: string;
}[] = [
  { from: 'WAV', to: 'mp3', desc: 'Convert to MP3', bg: 'bg-[#9333ea]' },
  { from: 'MP3', to: 'wav', desc: 'Convert to WAV', bg: 'bg-[#2563eb]' },
  { from: 'MP3', to: 'aac', desc: 'Convert to AAC', bg: 'bg-[#16a34a]' },
  { from: 'WAV', to: 'flac', desc: 'Convert to FLAC', bg: 'bg-[#db2777]' },
  { from: 'MP3', to: 'ogg', desc: 'Convert to OGG', bg: 'bg-[#f97316]' },
];

function AudioContent() {
  const [queue, setQueue] = useState<QueuedAudio[]>([]);
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
    preselectedTarget?: QueuedAudio['targetFormat']
  ) => {
    if (!incomingFiles || incomingFiles.length === 0) return;

    const rawFiles = Array.from(incomingFiles);
    const newEntries: QueuedAudio[] = rawFiles.map((f, index) => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      let defaultTarget: QueuedAudio['targetFormat'] = preselectedTarget || 'mp3';
      if (!preselectedTarget && ext === 'mp3') {
        defaultTarget = 'wav';
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
    targetFormat: QueuedAudio['targetFormat']
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
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const mimeMap: Record<QueuedAudio['targetFormat'], string> = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        aac: 'audio/aac',
        flac: 'audio/flac',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
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

  const downloadSingle = (item: QueuedAudio) => {
    if (!item.convertedBlob) return;
    const baseName =
      item.file.name.substring(0, item.file.name.lastIndexOf('.')) ||
      item.file.name ||
      'audio';
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
          'audio';
        zip.file(`${baseName}.${item.targetFormat}`, item.convertedBlob);
        count++;
      }
    });

    if (count === 0) return;

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'converted_audio.zip';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const triggerPresetUpload = (format: QueuedAudio['targetFormat']) => {
    if (!fileInputRef.current) return;
    fileInputRef.current.dataset.presetFormat = format;
    fileInputRef.current.click();
  };

  return (
    <div className="min-h-screen bg-[#f8fafd] text-slate-800 flex flex-col justify-between font-sans selection:bg-blue-100">
      {/* Top Navbar */}
      <nav className="border-b border-slate-100 bg-white sticky top-0 z-50">
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
            <span className="font-bold tracking-wider text-slate-800 text-sm">
              CONVERTER
            </span>
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-8 text-slate-500 font-medium h-full">
            <Link
              href="/documents"
              className="hover:text-[#123999] transition-colors h-full flex items-center border-b-2 border-transparent"
            >
              Convert documents
            </Link>
            <Link
              href="/"
              className="hover:text-[#123999] transition-colors h-full flex items-center border-b-2 border-transparent"
            >
              Convert images
            </Link>
            <Link
              href="/audio"
              className="text-[#123999] font-semibold transition-colors h-full flex items-center border-b-2 border-[#123999]"
            >
              Convert audio
            </Link>
            <Link
              href="/video"
              className="hover:text-[#123999] transition-colors h-full flex items-center border-b-2 border-transparent"
            >
              Convert video
            </Link>
            <Link
              href="/help"
              className="hover:text-[#123999] transition-colors h-full flex items-center border-b-2 border-transparent"
            >
              Help
            </Link>
          </div>

          {/* Right Section: My Files & Mobile Hamburger */}
          <div className="flex items-center gap-3">
            <div className="flex items-center pl-3 sm:pl-4 border-l border-slate-200">
              <button
                onClick={() =>
                  queueSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
                }
                className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
              >
                <span>My Files</span>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full border border-[#38c18c] text-[#38c18c] bg-[#38c18c]/5">
                  {queue.length}
                </span>
              </button>
            </div>

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-1.5 text-slate-600 hover:text-slate-900 focus:outline-none cursor-pointer"
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
          <div className="md:hidden bg-white border-b border-slate-200 px-4 pt-2 pb-4 space-y-2 shadow-lg">
            <Link
              href="/documents"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-[#123999]"
            >
              Convert documents
            </Link>
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-[#123999]"
            >
              Convert images
            </Link>
            <Link
              href="/audio"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-[#123999]"
            >
              Convert audio
            </Link>
            <Link
              href="/video"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-[#123999]"
            >
              Convert video
            </Link>
            <Link
              href="/help"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-[#123999]"
            >
              Help
            </Link>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden py-10 lg:py-14">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-purple-50/60 via-white to-[#f8fafd] -z-10" />

        <div className="max-w-7xl w-full mx-auto px-4 sm:px-8">
          {/* 2-Column Hero Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left Column: Info & Features */}
            <div className="lg:col-span-5 space-y-6">
              {/* Top Icon & Badge */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-100/90 shadow-md shadow-purple-900/5 border border-purple-100 flex items-center justify-center shrink-0 text-purple-600">
                  <Music className="w-8 h-8 stroke-[1.75]" />
                </div>
                <span className="px-4 py-1.5 rounded-full bg-purple-50/90 border border-purple-100 text-purple-700 text-xs font-bold tracking-wider uppercase">
                  AUDIO CONVERTER
                </span>
              </div>

              {/* Heading & Subtitle */}
              <div className="space-y-4">
                <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-[#142149] leading-[1.18] tracking-tight">
                  Convert Audio Files <br />
                  to Any Format
                </h1>
                <p className="text-slate-500 text-sm sm:text-base leading-relaxed max-w-md">
                  Change audio formats quickly and easily. Support for MP3, WAV,
                  AAC, FLAC, OGG and more.
                </p>
              </div>

              {/* Feature Checklist */}
              <ul className="space-y-3.5 pt-2">
                {[
                  'High quality output',
                  'Batch conversion',
                  'Fast & secure',
                ].map((text, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-3 text-sm font-medium text-slate-600"
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
                className={`bg-white rounded-2xl p-4 sm:p-5 shadow-[0_12px_40px_rgba(18,57,153,0.06)] border border-slate-100 transition-all ${
                  isDragging ? 'ring-2 ring-purple-600 scale-[1.005]' : ''
                }`}
              >
                {/* Inner Dashed Container */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl py-14 sm:py-16 px-6 text-center transition-colors cursor-pointer flex flex-col items-center justify-center ${
                    isDragging
                      ? 'border-purple-600 bg-purple-50/30'
                      : 'border-purple-200/80 hover:border-purple-400 bg-[#fbfcff]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="audio/*,.mp3,.wav,.aac,.flac,.ogg,.m4a"
                    onChange={(e) => {
                      const preset = e.target.dataset.presetFormat as
                        | QueuedAudio['targetFormat']
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
                  <div className="w-16 h-16 rounded-full bg-purple-50/80 flex items-center justify-center text-purple-600 mb-4">
                    <CloudUpload className="w-8 h-8 stroke-[1.5]" />
                  </div>

                  <p className="text-base sm:text-lg font-semibold text-slate-700 mb-1.5">
                    Drop your audio file here or click to upload
                  </p>
                  <p className="text-xs sm:text-sm text-slate-400 mb-1">
                    Supports MP3, WAV, AAC, FLAC, OGG, M4A, and more
                  </p>
                  <p className="text-xs text-slate-400 mb-6">
                    Max file size: 100 MB
                  </p>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="inline-flex items-center gap-2 bg-[#123999] hover:bg-blue-800 text-white text-xs sm:text-sm font-medium px-8 py-3 rounded-full shadow-md shadow-blue-900/15 transition-all cursor-pointer"
                  >
                    <CloudUpload className="w-4 h-4" />
                    <span>Choose File</span>
                  </button>
                </div>
              </div>

              {/* 5 Quick Audio Format Cards Below Dropzone */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                {[
                  { fmt: 'mp3' as const, label: 'MP3', bg: 'bg-[#9333ea]' },
                  { fmt: 'wav' as const, label: 'WAV', bg: 'bg-[#2563eb]' },
                  { fmt: 'aac' as const, label: 'AAC', bg: 'bg-[#16a34a]' },
                  { fmt: 'flac' as const, label: 'FLAC', bg: 'bg-[#db2777]' },
                  { fmt: 'ogg' as const, label: 'OGG', bg: 'bg-[#f97316]' },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => triggerPresetUpload(item.fmt)}
                    className="bg-white p-3 rounded-xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-md hover:border-purple-200 transition-all cursor-pointer flex items-center justify-between gap-2 group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-lg ${item.bg} text-white flex items-center justify-center font-bold text-[11px] shrink-0 shadow-xs uppercase`}
                      >
                        {item.fmt}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 uppercase">
                          {item.label}
                        </p>
                        <p className="text-[10px] text-slate-400 leading-tight truncate">
                          Convert to {item.label}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-3 h-3 text-slate-400 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Interactive Queue Section */}
          <div ref={queueSectionRef} className="mt-10 max-w-5xl mx-auto space-y-4">
            {queue.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
                  <span className="text-xs sm:text-sm font-semibold text-slate-700">
                    {queue.length} audio file{queue.length > 1 ? 's' : ''} queued
                  </span>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <button
                      onClick={() => setQueue([])}
                      className="text-xs sm:text-sm text-slate-500 hover:text-red-600 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={convertAll}
                      disabled={isBatchConverting}
                      className="inline-flex items-center gap-1.5 bg-[#123999] hover:bg-blue-800 disabled:opacity-50 text-white text-xs sm:text-sm font-medium px-4 py-2 rounded-full transition-colors cursor-pointer shadow-xs"
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
                        className="inline-flex items-center gap-1.5 bg-[#38c18c] hover:bg-emerald-600 text-white text-xs sm:text-sm font-medium px-4 py-2 rounded-full transition-colors cursor-pointer shadow-xs"
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
                      className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                          <Music className="w-5 h-5" />
                        </div>
                        <div className="truncate">
                          <p className="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                            {item.file.name}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {formatBytes(item.file.size)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-slate-500">
                            Convert to:
                          </label>
                          <select
                            value={item.targetFormat}
                            onChange={(e) =>
                              updateTargetFormat(
                                item.id,
                                e.target.value as QueuedAudio['targetFormat']
                              )
                            }
                            className="text-xs font-medium bg-[#f4f6fa] border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-purple-600 cursor-pointer uppercase"
                          >
                            <option value="mp3">MP3</option>
                            <option value="wav">WAV</option>
                            <option value="aac">AAC</option>
                            <option value="flac">FLAC</option>
                            <option value="ogg">OGG</option>
                            <option value="m4a">M4A</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-1">
                          {item.status === 'completed' && (
                            <button
                              onClick={() => downloadSingle(item)}
                              className="inline-flex items-center gap-1 bg-emerald-50 text-[#38c18c] hover:bg-emerald-100 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Download
                            </button>
                          )}
                          {item.status === 'converting' && (
                            <RefreshCw className="w-4 h-4 text-purple-600 animate-spin mx-2" />
                          )}
                          {item.status === 'error' && (
                            <span title={item.error}>
                              <AlertCircle className="w-4 h-4 text-red-500" />
                            </span>
                          )}
                          {item.status === 'idle' && (
                            <button
                              onClick={() => convertSingle(item.id)}
                              className="text-xs font-semibold text-purple-600 hover:bg-purple-50 px-3 py-1.5 rounded-full transition-colors cursor-pointer"
                            >
                              Convert
                            </button>
                          )}
                          <button
                            onClick={() => removeFile(item.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
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

          {/* Popular Audio Conversions Grid */}
          <section className="mt-16 pt-10 border-t border-slate-200/70">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
              <div>
                <h2 className="text-lg font-bold text-[#142149]">
                  Popular Audio Conversions
                </h2>
                <p className="text-xs text-slate-400">
                  Select an audio format pair to convert instantly
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
              {POPULAR_AUDIO_CONVERSIONS.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => triggerPresetUpload(item.to)}
                  className="bg-white p-3.5 rounded-xl border border-slate-200/70 shadow-2xs hover:border-purple-600 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-800 text-xs sm:text-sm">
                      <span className="text-purple-600">{item.from}</span>
                      <span className="text-slate-300 font-normal">→</span>
                      <span className="text-[#20b486] uppercase">
                        {item.to}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {item.desc}
                    </p>
                  </div>
                  <div className="w-7 h-7 rounded-lg bg-slate-50 group-hover:bg-purple-50 flex items-center justify-center text-slate-400 group-hover:text-purple-600 transition-colors shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200/80 text-slate-600 text-xs py-10">
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
              <span className="font-bold tracking-wider text-slate-800 text-xs">
                CONVERTER
              </span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Fast, secure, and efficient file conversion for your everyday
              needs.
            </p>
            <div className="inline-flex items-center gap-1.5 bg-emerald-50 text-[#20b486] border border-emerald-200/60 px-2.5 py-1 rounded-md text-[10px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#20b486]" />
              100% SSL Secured (Cloud Processing)
            </div>
          </div>

          {/* Col 2: Quick Tools */}
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800 text-xs mb-2.5">
              Quick Tools
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-400">
              <li>
                <Link href="/" className="hover:text-[#123999]">
                  Image Converter
                </Link>
              </li>
              <li>
                <Link href="/documents" className="hover:text-[#123999]">
                  Document Converter
                </Link>
              </li>
              <li>
                <Link href="/audio" className="hover:text-[#123999]">
                  Audio Converter
                </Link>
              </li>
              <li>
                <Link href="/video" className="hover:text-[#123999]">
                  Video Converter
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Top Formats */}
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800 text-xs mb-2.5">
              Top Formats
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-400">
              <li>
                <button
                  onClick={() => triggerPresetUpload('mp3')}
                  className="hover:text-purple-600 cursor-pointer"
                >
                  WAV to MP3
                </button>
              </li>
              <li>
                <button
                  onClick={() => triggerPresetUpload('wav')}
                  className="hover:text-purple-600 cursor-pointer"
                >
                  MP3 to WAV
                </button>
              </li>
              <li>
                <Link href="/documents" className="hover:text-[#123999]">
                  PDF to DOCX
                </Link>
              </li>
              <li>
                <Link href="/" className="hover:text-[#123999]">
                  JPG to PNG
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 4: Security & Privacy */}
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800 text-xs mb-2.5">
              Security & Privacy
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-400">
              <li>
                <Link href="/help" className="hover:text-[#123999]">
                  Security & Privacy
                </Link>
              </li>
              <li>
                <Link href="/help" className="hover:text-[#123999]">
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
                  className="hover:text-[#123999] text-left cursor-pointer"
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
              <span className="font-semibold text-slate-600">
                1,482,500 files
              </span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function AudioPage() {
  return (
    <Suspense fallback={null}>
      <AudioContent />
    </Suspense>
  );
}