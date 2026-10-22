'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Trash2,
  Download,
  AlertCircle,
  RefreshCw,
  Archive,
  Plus,
  Monitor,
  HardDrive,
  Clock,
  CloudUpload,
  Sliders,
  ShieldCheck,
  Smartphone,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Play,
  Camera,
} from 'lucide-react';
import JSZip from 'jszip';
import useDrivePicker from 'react-google-drive-picker';
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

const FEATURES = [
  {
    title: '300+ formats supported',
    description:
      'We support more than 25600 different conversions between more than 300 different file formats. More than any other converter.',
    icon: RefreshCw,
    iconColor: 'text-[#38c18c]',
  },
  {
    title: 'Fast and easy',
    description:
      'Just drop your files on the page, choose an output format and click "Convert" button. Wait a little for the process to complete. We aim to do all our conversions in under 1-2 minutes.',
    icon: Clock,
    iconColor: 'text-[#123999]',
  },
  {
    title: 'In the cloud',
    description:
      'All conversions take place in the cloud and will not consume any capacity from your computer.',
    icon: CloudUpload,
    iconColor: 'text-[#38c18c]',
  },
  {
    title: 'Custom settings',
    description:
      'Most conversion types support advanced options. For example with a video converter you can choose quality, aspect ratio, codec and other settings, rotate and flip.',
    icon: Sliders,
    iconColor: 'text-[#123999]',
  },
  {
    title: 'Security guaranteed',
    description:
      'We delete uploaded files instantly and converted ones after 24 hours. No one has access to your files and privacy is 100% guaranteed. Read more about security.',
    icon: ShieldCheck,
    iconColor: 'text-[#38c18c]',
  },
  {
    title: 'All devices supported',
    description:
      'Converter is browser-based and works for all platforms. There is no need to download and install any software.',
    icon: Smartphone,
    iconColor: 'text-[#123999]',
  },
];

const FORMAT_TABS = ['Documents', 'Images', 'Audio', 'Video'] as const;

const POPULAR_FORMATS: Record<
  (typeof FORMAT_TABS)[number],
  { from: string; to: string; desc: string }[]
> = {
  Documents: [
    { from: 'PDF', to: 'DOCX', desc: 'Adobe PDF to Word Document' },
    { from: 'DOCX', to: 'PDF', desc: 'Word Document to Adobe PDF' },
    { from: 'PDF', to: 'TXT', desc: 'Adobe PDF to Plain Text' },
    { from: 'TXT', to: 'PDF', desc: 'Plain Text to Adobe PDF' },
    { from: 'HTML', to: 'PDF', desc: 'Web Page to Adobe PDF' },
    { from: 'RTF', to: 'DOCX', desc: 'Rich Text Format to Word' },
    { from: 'TXT', to: 'RTF', desc: 'Plain Text to Rich Text' },
    { from: 'DOCX', to: 'HTML', desc: 'Word Document to Web Page' },
  ],
  Images: [
    { from: 'HEIC', to: 'JPG', desc: 'Apple Image to JPEG' },
    { from: 'PNG', to: 'JPG', desc: 'Portable Network Graphics to JPG' },
    { from: 'JPG', to: 'PNG', desc: 'JPEG to Portable Network Graphics' },
    { from: 'WEBP', to: 'PNG', desc: 'WebP Image to PNG' },
    { from: 'PNG', to: 'WEBP', desc: 'PNG to Next-Gen WebP' },
    { from: 'SVG', to: 'PNG', desc: 'Scalable Vector to Raster PNG' },
    { from: 'TIFF', to: 'JPG', desc: 'Tagged Image File to JPEG' },
    { from: 'RAW', to: 'JPG', desc: 'Digital Camera Raw to JPEG' },
  ],
  Audio: [
    { from: 'MP3', to: 'WAV', desc: 'MPEG Audio Layer 3 to Waveform' },
    { from: 'WAV', to: 'MP3', desc: 'Waveform Audio to MP3' },
    { from: 'FLAC', to: 'MP3', desc: 'Free Lossless Audio to MP3' },
    { from: 'M4A', to: 'MP3', desc: 'MPEG-4 Audio to MP3' },
    { from: 'OGG', to: 'MP3', desc: 'Ogg Vorbis to MP3' },
    { from: 'AAC', to: 'MP3', desc: 'Advanced Audio Coding to MP3' },
    { from: 'WMA', to: 'MP3', desc: 'Windows Media Audio to MP3' },
    { from: 'MP3', to: 'FLAC', desc: 'MP3 to Lossless FLAC' },
  ],
  Video: [
    { from: 'MP4', to: 'AVI', desc: 'MPEG-4 Video to Audio Video Interleave' },
    { from: 'AVI', to: 'MP4', desc: 'AVI Video to MPEG-4' },
    { from: 'MKV', to: 'MP4', desc: 'Matroska Video to MPEG-4' },
    { from: 'MOV', to: 'MP4', desc: 'Apple QuickTime Movie to MP4' },
    { from: 'WEBM', to: 'MP4', desc: 'WebM Video to MPEG-4' },
    { from: 'WMV', to: 'MP4', desc: 'Windows Media Video to MP4' },
    { from: 'MP4', to: 'GIF', desc: 'MPEG-4 Video to Animated GIF' },
    { from: 'FLV', to: 'MP4', desc: 'Flash Video to MPEG-4' },
  ],
};

export default function Home() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isBatchConverting, setIsBatchConverting] = useState(false);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] =
    useState<(typeof FORMAT_TABS)[number]>('Images');

  const [openPicker, authResponse] = useDrivePicker();
  const accessTokenRef = useRef<string | undefined>(undefined);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const queueSectionRef = useRef<HTMLDivElement>(null);
  const debounceTimers = useRef<{ [key: string]: NodeJS.Timeout }>({});

  useEffect(() => {
    if (authResponse?.access_token) {
      accessTokenRef.current = authResponse.access_token;
    }
  }, [authResponse]);

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
          q.id === id
            ? { ...q, estimatedSize: previewBlob.size, isEstimating: false }
            : q
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
      const id = `${Date.now()}-${index}-${Math.random()
        .toString(36)
        .substring(2, 7)}`;
      const previewUrl = URL.createObjectURL(f);

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

  const handleOpenGoogleDrive = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const developerKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;

    if (!clientId || !developerKey) {
      alert(
        'Google Drive keys are missing! Please add NEXT_PUBLIC_GOOGLE_CLIENT_ID and NEXT_PUBLIC_GOOGLE_API_KEY to your .env.local file.'
      );
      return;
    }

    openPicker({
      clientId,
      developerKey,
      viewId: 'DOCS_IMAGES',
      showUploadView: true,
      showUploadFolders: true,
      supportDrives: true,
      multiselect: true,
      customScopes: ['https://www.googleapis.com/auth/drive.readonly'],
      callbackFunction: async (data) => {
        if (data.action === 'picked' && data.docs.length > 0) {
          setIsLoadingDrive(true);
          try {
            const token = authResponse?.access_token || accessTokenRef.current;
            const downloadedFiles: File[] = [];

            for (const doc of data.docs) {
              const res = await fetch(
                `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`,
                {
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                }
              );

              if (!res.ok) {
                throw new Error(`Failed to download ${doc.name}`);
              }

              const blob = await res.blob();
              const file = new File([blob], doc.name, {
                type: doc.mimeType || blob.type || 'image/jpeg',
              });
              downloadedFiles.push(file);
            }

            handleFiles(downloadedFiles);
          } catch (error) {
            console.error('Error importing from Google Drive:', error);
            alert(
              'Failed to download the selected image(s) from Google Drive.'
            );
          } finally {
            setIsLoadingDrive(false);
          }
        }
      },
    });
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
          ? {
              ...q,
              targetFormat: format,
              status: 'idle',
              convertedBlob: undefined,
            }
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
      updateEstimatedSize(
        id,
        currentItem.file,
        currentItem.targetFormat,
        quality
      );
    }, 200);
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
      const blob = await convertImage(item.file, {
        targetFormat: item.targetFormat,
        quality: item.quality,
      });

      setQueue((prev) =>
        prev.map((q) =>
          q.id === id
            ? {
                ...q,
                status: 'completed',
                convertedBlob: blob,
                estimatedSize: blob.size,
              }
            : q
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

  const downloadSingle = (item: QueuedFile) => {
    if (!item.convertedBlob) return;
    const ext = getExtensionFromMime(item.targetFormat);
    const baseName =
      item.file.name.substring(0, item.file.name.lastIndexOf('.')) ||
      item.file.name ||
      'image';
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
          item.file.name.substring(0, item.file.name.lastIndexOf('.')) ||
          item.file.name ||
          'image';
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

  const handlePopularCardClick = (tab: (typeof FORMAT_TABS)[number]) => {
    if (tab === 'Documents') {
      window.location.href = '/documents?autoOpen=true';
    } else if (tab === 'Images') {
      fileInputRef.current?.click();
    } else if (tab === 'Audio') {
      window.location.href = '/audio?autoOpen=true';
    } else if (tab === 'Video') {
      window.location.href = '/video?autoOpen=true';
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-800 flex flex-col font-sans selection:bg-blue-100">
      {/* Top Navbar */}
      <nav className="border-b border-slate-100 bg-white sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between text-xs sm:text-[13px]">
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
          <div className="hidden md:flex items-center gap-7 text-slate-500 font-medium">
            <Link
              href="/documents"
              className="hover:text-[#123999] transition-colors"
            >
              Convert documents
            </Link>
            <Link
              href="/"
              className="text-[#123999] font-semibold transition-colors"
            >
              Convert images
            </Link>
            <Link href="/audio" className="hover:text-[#123999] transition-colors">
              Convert audio
            </Link>
            <Link href="/video" className="hover:text-[#123999] transition-colors">
              Convert video
            </Link>
            <Link href="/help" className="hover:text-[#123999] transition-colors">
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
      <main className="flex-1 relative overflow-hidden">
        {/* Decorative Background Waves & Floating Media Icons */}
        <div className="absolute inset-x-0 top-0 h-[430px] pointer-events-none -z-10 overflow-hidden">
          <svg
            className="w-full h-full object-cover"
            viewBox="0 0 1440 420"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d="M0 150 C320 70, 620 230, 980 140 C1220 80, 1360 110, 1440 130 L1440 390 L0 390 Z"
              fill="#F3F7FB"
            />
            <path
              d="M0 210 C380 290, 720 110, 1120 190 C1300 225, 1390 195, 1440 180 L1440 390 L0 390 Z"
              fill="#ECF2F9"
              fillOpacity="0.85"
            />
            <path
              d="M0 280 C420 200, 820 330, 1440 240 L1440 420 L0 420 Z"
              fill="#E5ECF6"
              fillOpacity="0.6"
            />
          </svg>

          {/* Subtle Floating Background Icons */}
          <Camera className="w-5 h-5 text-slate-300/80 absolute top-14 left-[7%] -rotate-12" />
          <FileText className="w-4 h-4 text-slate-300/70 absolute top-10 left-[31%] rotate-12" />
          <ImageIcon className="w-5 h-5 text-slate-300/80 absolute top-28 left-[18%] rotate-6" />
          <Play className="w-5 h-5 text-emerald-300/70 absolute top-48 left-[13%] -rotate-12" />
          <Play className="w-6 h-6 text-emerald-300/70 absolute top-52 left-[22%] rotate-12" />
          <Film className="w-5 h-5 text-slate-300/90 absolute top-72 left-[23%]" />

          <Film className="w-5 h-5 text-emerald-300/70 absolute top-10 right-[26%]" />
          <Music className="w-5 h-5 text-slate-300/80 absolute top-36 right-[18%] rotate-12" />
          <Camera className="w-5 h-5 text-slate-300/70 absolute top-60 right-[12%] -rotate-6" />
          <FileText className="w-5 h-5 text-slate-300/80 absolute top-72 right-[20%]" />
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-20">
          {/* Hero Header */}
          <header className="text-center space-y-2 mb-8">
            <h1 className="text-3xl sm:text-4xl font-light text-slate-800 tracking-wide">
              File Converter
            </h1>
            <p className="text-[#123999] text-sm sm:text-base font-semibold">
              Convert your files to any format
            </p>
          </header>

          {/* Center Dropzone Card */}
          <div className="max-w-2xl mx-auto relative mb-16">
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
              className={`bg-white rounded-xl p-3 sm:p-4 shadow-[0_15px_45px_rgba(18,57,153,0.08)] transition-all ${
                isDragging ? 'ring-2 ring-[#38c18c] scale-[1.01]' : ''
              }`}
            >
              {/* Inner Dashed Area */}
              <div
                className={`relative border border-dashed rounded-lg py-12 sm:py-16 px-4 text-center transition-colors cursor-pointer ${
                  isDragging
                    ? 'border-[#38c18c] bg-emerald-50/30'
                    : 'border-slate-300/90 hover:border-slate-400 bg-white'
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

                <div className="flex flex-col items-center justify-center space-y-4 pointer-events-none">
                  <div className="w-12 h-12 rounded-full border border-[#38c18c] flex items-center justify-center text-[#38c18c]">
                    <Plus className="w-6 h-6 stroke-[1.5]" />
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 font-normal">
                    Drop files here. 100 MB maximum file size
                  </p>
                </div>
              </div>
            </div>

            {/* Overlapping Split Royal-Blue Pill Button */}
            <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center bg-[#123999] text-white rounded-full shadow-lg overflow-hidden text-xs sm:text-[13px] font-medium whitespace-nowrap">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-5 sm:px-6 py-2.5 hover:bg-blue-800 transition-colors cursor-pointer"
              >
                <Monitor className="w-4 h-4 stroke-[1.75]" />
                <span>Choose File</span>
              </button>
              <div className="w-[1px] h-5 bg-blue-400/40" />
              <button
                type="button"
                onClick={handleOpenGoogleDrive}
                disabled={isLoadingDrive}
                className="flex items-center gap-2 px-5 sm:px-6 py-2.5 hover:bg-blue-800 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {isLoadingDrive ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <HardDrive className="w-4 h-4 stroke-[1.75]" />
                )}
                <span>
                  {isLoadingDrive ? 'Importing...' : 'From Google Drive'}
                </span>
              </button>
            </div>
          </div>

          {/* Queued Files & Batch Action Section */}
          <div ref={queueSectionRef} className="max-w-3xl mx-auto space-y-4 mb-16">
            {queue.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[#f4f6fa] p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs">
                <span className="text-xs sm:text-sm font-semibold text-slate-700">
                  {queue.length} file{queue.length > 1 ? 's' : ''} queued
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
                      className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
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
                const targetSize =
                  item.convertedBlob?.size || item.estimatedSize;
                const savingsPercent =
                  targetSize && originalSize
                    ? Math.round(
                        ((originalSize - targetSize) / originalSize) * 100
                      )
                    : null;

                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 sm:p-4 bg-white rounded-xl border border-slate-200/90 shadow-xs hover:shadow-md transition-shadow"
                  >
                    {/* Thumbnail Preview & File Details */}
                    <div className="flex items-center gap-3 overflow-hidden min-w-0">
                      <img
                        src={item.previewUrl}
                        alt={item.file.name}
                        className="w-12 h-12 object-cover rounded-lg border border-slate-200 shrink-0 bg-slate-100"
                      />
                      <div className="truncate">
                        <p className="text-xs sm:text-sm font-semibold text-slate-800 truncate">
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
                                    : 'text-[#123999] font-semibold'
                                }
                              >
                                {formatBytes(targetSize)}
                              </span>
                              {savingsPercent !== null &&
                                savingsPercent > 0 && (
                                  <span className="text-[#38c18c] bg-emerald-50 px-1.5 py-0.5 rounded text-[10px] font-semibold">
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
                              e.target.value as
                                | 'image/png'
                                | 'image/jpeg'
                                | 'image/webp'
                            )
                          }
                          className="text-xs font-medium bg-[#f4f6fa] border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#123999] cursor-pointer"
                        >
                          <option value="image/png">PNG</option>
                          <option value="image/jpeg">JPG</option>
                          <option value="image/webp">WebP</option>
                        </select>
                      </div>

                      {item.targetFormat !== 'image/png' && (
                        <div className="flex items-center gap-1.5">
                          <label className="text-[11px] text-slate-500">
                            Quality:
                          </label>
                          <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            value={item.quality}
                            onChange={(e) =>
                              handleQualityChange(
                                item.id,
                                parseFloat(e.target.value)
                              )
                            }
                            className="w-16 sm:w-20 accent-[#123999] cursor-pointer"
                          />
                          <span className="text-[11px] text-slate-600 font-medium w-8">
                            {Math.round(item.quality * 100)}%
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-1">
                        {item.status === 'completed' && (
                          <button
                            onClick={() => downloadSingle(item)}
                            className="p-1.5 text-[#38c18c] hover:bg-emerald-50 rounded-md transition-colors cursor-pointer"
                            title="Download Converted File"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        )}
                        {item.status === 'converting' && (
                          <RefreshCw className="w-4 h-4 text-[#123999] animate-spin" />
                        )}
                        {item.status === 'error' && (
                          <span title={item.error}>
                            <AlertCircle className="w-4 h-4 text-red-500" />
                          </span>
                        )}
                        {item.status === 'idle' && (
                          <button
                            onClick={() => convertSingle(item.id)}
                            className="text-xs font-semibold text-[#123999] hover:bg-blue-50 px-3 py-1.5 rounded-full transition-colors cursor-pointer"
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

          {/* 6 Feature Cards Grid */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-12 pt-6 mb-24">
            {FEATURES.map((feature, idx) => {
              const IconComponent = feature.icon;
              return (
                <div
                  key={idx}
                  className="relative bg-[#f4f6fa] rounded-xl pt-12 pb-7 px-6 text-center transition-transform hover:-translate-y-0.5"
                >
                  <div className="w-14 h-14 bg-white rounded-xl shadow-[0_8px_20px_rgba(18,57,153,0.06)] flex items-center justify-center mx-auto absolute -top-6 left-1/2 -translate-x-1/2">
                    <IconComponent
                      className={`w-6 h-6 stroke-[1.75] ${feature.iconColor}`}
                    />
                  </div>

                  <h3 className="text-sm font-semibold text-slate-800 mb-2.5">
                    {feature.title}
                  </h3>
                  <p className="text-[11px] sm:text-xs text-slate-500 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </section>

          {/* Popular Format Conversions Section */}
          <section className="pt-10 border-t border-slate-200/80">
            <div className="text-center space-y-2 mb-8">
              <h2 className="text-xl sm:text-2xl font-semibold text-slate-800">
                Popular Format Conversions
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Click any popular conversion to preload or learn more instantly
              </p>

              {/* Tab Pills */}
              <div className="flex items-center justify-center gap-2 pt-3">
                {FORMAT_TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === tab
                        ? 'bg-[#123999] text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Format Conversion Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
              {POPULAR_FORMATS[activeTab].map((fmt, i) => (
                <div
                  key={i}
                  onClick={() => handlePopularCardClick(activeTab)}
                  className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs hover:border-[#123999] hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-800 text-xs sm:text-sm">
                      <span className="text-[#123999]">{fmt.from}</span>
                      <span className="text-slate-300 font-normal">→</span>
                      <span className="text-[#38c18c]">{fmt.to}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {fmt.desc}
                    </p>
                  </div>
                  <div className="w-7 h-7 rounded-lg bg-slate-50 group-hover:bg-blue-50 flex items-center justify-center text-slate-400 group-hover:text-[#123999] transition-colors shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#f4f6fa] border-t border-slate-200/80 text-slate-600 text-xs py-10 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Col 1: Brand & Desc */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="relative w-6 h-6 flex items-center justify-center">
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
            <p className="text-slate-500 text-[11px] leading-relaxed">
              Fast, secure, and advanced cloud-based file conversion tools right
              at your fingertips.
            </p>
            <div className="inline-flex items-center gap-1.5 bg-emerald-50 text-[#38c18c] border border-emerald-200/60 px-2.5 py-1 rounded-md text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#38c18c] animate-pulse" />
              100 MB SSL Secured Cloud Processing
            </div>
          </div>

          {/* Col 2: Quick Links */}
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800 text-[13px] mb-3">
              Quick Tools
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-500">
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
            <h4 className="font-semibold text-slate-800 text-[13px] mb-3">
              Top Formats
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-500">
              <li>
                <Link href="/documents?autoOpen=true" className="hover:text-[#123999]">
                  PDF to DOCX
                </Link>
              </li>
              <li>
                <Link href="/" className="hover:text-[#123999]">
                  HEIC to JPG
                </Link>
              </li>
              <li>
                <Link href="/video?autoOpen=true" className="hover:text-[#123999]">
                  MP4 to GIF
                </Link>
              </li>
              <li>
                <Link href="/audio?autoOpen=true" className="hover:text-[#123999]">
                  WAV to MP3
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 4: Security & Privacy */}
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800 text-[13px] mb-3">
              Security & Privacy
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-500">
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
                    queueSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
                  }
                  className="hover:text-[#123999] text-left cursor-pointer"
                >
                  My Converted Files
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright bar */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 mt-8 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400 gap-2">
          <p>© 2026 CONVERTER. All rights reserved.</p>
          <p>Total conversions today: 1,424,550 files</p>
        </div>
      </footer>
    </div>
  );
}