'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  HelpCircle,
  Search,
  BookOpen,
  Wrench,
  Mail,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

const POPULAR_TOPICS: { title: string; content: string }[] = [
  {
    title: 'Supported File Formats',
    content:
      'We support over 300+ formats across Images (JPG, PNG, WEBP, HEIC, SVG), Documents (PDF, DOCX, XLSX, PPTX, TXT), Audio (MP3, WAV, AAC, FLAC, OGG), and Video (MP4, MOV, AVI, MKV, WEBM, GIF). All processing happens securely right in your browser or via our fast cloud infrastructure.',
  },
  {
    title: 'File Size Limit',
    content:
      'Standard files up to 100 MB are supported for images, documents, and audio. For heavy video processing, our platform supports files up to 1 GB per upload without compromising speed or browser performance.',
  },
  {
    title: 'Conversion Quality',
    content:
      'Our engine preserves your original layout, resolution, and audio/video codecs. You can also fine-tune advanced settings like image compression quality sliders or target formats before converting.',
  },
  {
    title: 'Privacy & Security',
    content:
      'Your privacy is 100% guaranteed. All uploaded files are processed securely over SSL and are automatically deleted from our servers after 24 hours. No one else has access to your personal documents or media.',
  },
  {
    title: 'Troubleshooting',
    content:
      'If a conversion fails or a file is rejected, ensure that your file is not password-protected or corrupted. Try converting a smaller batch or checking your internet connection for Google Drive imports.',
  },
  {
    title: 'Account & My Files',
    content:
      'You do not need an account to use the basic converter. The "My Files" counter tracks your current active session queue so you can download files individually or bundle everything into a single ZIP archive.',
  },
];

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [openTopicIndex, setOpenTopicIndex] = useState<number | null>(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const filteredTopics = POPULAR_TOPICS.filter(
    (topic) =>
      topic.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      topic.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
              className="hover:text-[#123999] dark:hover:text-white transition-colors h-full flex items-center border-b-2 border-transparent"
            >
              Convert video
            </Link>
            <Link
              href="/help"
              className="text-[#123999] dark:text-white font-semibold transition-colors h-full flex items-center border-b-2 border-[#123999] dark:border-white"
            >
              Help
            </Link>
          </div>

          {/* Right Section: Theme Toggle, My Files & Mobile Hamburger */}
          <div className="flex items-center gap-3">
            <ThemeToggle />

            <div className="flex items-center pl-3 sm:pl-4 border-l border-slate-200 dark:border-slate-800">
              <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-medium">
                <span>My Files</span>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full border border-[#38c18c] text-[#38c18c] bg-[#38c18c]/5 dark:bg-emerald-500/10 dark:border-emerald-500/40">
                  0
                </span>
              </span>
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
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-blue-50/70 via-white to-[#f8fafd] dark:from-[#161f33]/40 dark:via-[#0b101b] dark:to-[#0b101b] -z-10" />

        <div className="max-w-7xl w-full mx-auto px-4 sm:px-8">
          {/* Main 2-Column Help Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
            {/* Left Column: Hero, Search & 4 Category Cards */}
            <div className="lg:col-span-7 space-y-8">
              {/* Top Icon & Badge */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-[#123999] dark:bg-blue-600 text-white shadow-lg shadow-blue-900/15 flex items-center justify-center shrink-0">
                  <HelpCircle className="w-8 h-8 stroke-[2]" />
                </div>
                <span className="px-4 py-1.5 rounded-full bg-blue-50/90 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 text-[#123999] dark:text-blue-400 text-xs font-bold tracking-wider uppercase">
                  HELP & SUPPORT
                </span>
              </div>

              {/* Heading & Subtitle */}
              <div className="space-y-3">
                <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-[#142149] dark:text-white leading-[1.18] tracking-tight">
                  How can we help you?
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base leading-relaxed max-w-lg">
                  Find answers to common questions, learn how to use the
                  converter, or get in touch with our support team.
                </p>
              </div>

              {/* Search Bar */}
              <div className="relative max-w-xl">
                <span className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                  <Search className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  placeholder="Search for help articles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white dark:bg-[#111726] border border-slate-200/90 dark:border-slate-800 rounded-xl pl-11 pr-4 py-3.5 text-xs sm:text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#123999] dark:focus:ring-blue-500 shadow-xs"
                />
              </div>

              {/* 4 Quick Category Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
                {/* FAQs Card */}
                <div
                  onClick={() => setOpenTopicIndex(0)}
                  className="bg-white dark:bg-[#111726] p-4 sm:p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-none hover:shadow-md hover:border-blue-200 dark:hover:border-blue-500/50 transition-all cursor-pointer space-y-2 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-[#123999] dark:text-blue-400 flex items-center justify-center font-bold">
                    <HelpCircle className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white group-hover:text-[#123999] dark:group-hover:text-blue-400 transition-colors">
                    FAQs
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Find answers to common questions
                  </p>
                </div>

                {/* Getting Started Card */}
                <div
                  onClick={() => setOpenTopicIndex(1)}
                  className="bg-white dark:bg-[#111726] p-4 sm:p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-none hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-500/50 transition-all cursor-pointer space-y-2 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-[#20b486] dark:text-emerald-400 flex items-center justify-center font-bold">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white group-hover:text-[#20b486] dark:group-hover:text-emerald-400 transition-colors">
                    Getting Started
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Learn how to convert your files
                  </p>
                </div>

                {/* Troubleshooting Card */}
                <div
                  onClick={() => setOpenTopicIndex(4)}
                  className="bg-white dark:bg-[#111726] p-4 sm:p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-none hover:shadow-md hover:border-purple-200 dark:hover:border-purple-500/50 transition-all cursor-pointer space-y-2 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
                    <Wrench className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                    Troubleshooting
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Fix common issues and errors
                  </p>
                </div>

                {/* Contact Support Card */}
                <div
                  onClick={() => alert('Support email: support@converter.com')}
                  className="bg-white dark:bg-[#111726] p-4 sm:p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-none hover:shadow-md hover:border-orange-200 dark:hover:border-orange-500/50 transition-all cursor-pointer space-y-2 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
                    <Mail className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
                    Contact Support
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Still need help? We&apos;re here for you
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: Popular Help Topics Accordion */}
            <div className="lg:col-span-5 bg-white dark:bg-[#111726] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-[0_12px_40px_rgba(18,57,153,0.05)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] p-5 sm:p-6 space-y-4">
              <h2 className="text-base font-bold text-[#142149] dark:text-white pb-2 border-b border-slate-100 dark:border-slate-800">
                Popular Help Topics
              </h2>

              <div className="space-y-3">
                {filteredTopics.map((topic, index) => {
                  const isOpen = openTopicIndex === index;
                  return (
                    <div
                      key={index}
                      className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden transition-all bg-white dark:bg-[#0e1422]"
                    >
                      <button
                        onClick={() =>
                          setOpenTopicIndex(isOpen ? null : index)
                        }
                        className="w-full flex items-center justify-between p-3.5 text-left text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                      >
                        <span>{topic.title}</span>
                        {isOpen ? (
                          <ChevronUp className="w-4 h-4 text-[#123999] dark:text-blue-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </button>

                      {isOpen && (
                        <div className="px-3.5 pb-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed bg-slate-50/50 dark:bg-[#111726] border-t border-slate-100 dark:border-slate-800 pt-2">
                          {topic.content}
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredTopics.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-6">
                    No help topics found matching your search.
                  </p>
                )}
              </div>
            </div>
          </div>
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
                <Link href="/documents" className="hover:text-[#123999] dark:hover:text-blue-400">
                  PDF to DOCX
                </Link>
              </li>
              <li>
                <Link href="/" className="hover:text-[#123999] dark:hover:text-blue-400">
                  JPG to PNG
                </Link>
              </li>
              <li>
                <Link href="/audio" className="hover:text-[#123999] dark:hover:text-blue-400">
                  MP4 to MP3
                </Link>
              </li>
              <li>
                <Link href="/video" className="hover:text-[#123999] dark:hover:text-blue-400">
                  MKV to MP4
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
                <Link href="/" className="hover:text-[#123999] dark:hover:text-blue-400">
                  My Converted Files
                </Link>
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