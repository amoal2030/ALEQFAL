import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { LEGAL_DOCUMENTS } from '../data/legalContent';
import { AppPageRoute, buildLegalPath } from '../utils/legalRoutes';
import { BrandLogo } from './common/BrandLogo';
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Globe,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';

interface LegalPageProps {
  page: 'privacy' | 'terms';
  isAuthenticated: boolean;
  onNavigatePage: (page: AppPageRoute, sectionId?: string) => void;
}

export const LegalPage: React.FC<LegalPageProps> = ({
  page,
  isAuthenticated,
  onNavigatePage,
}) => {
  const { language, setLanguage, direction, t, tr } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  // Official legal text is maintained in Arabic (RTL) and English (LTR).
  // When Urdu (RTL) is active, UI chrome displays in Urdu alongside the official Arabic legal text with one-click EN/AR switching.
  const activeLegalLang: 'ar' | 'en' = language === 'en' ? 'en' : 'ar';
  const legalDir: 'rtl' | 'ltr' = activeLegalLang === 'en' ? 'ltr' : 'rtl';
  const docData = LEGAL_DOCUMENTS[page][activeLegalLang];

  const otherPage: 'privacy' | 'terms' = page === 'privacy' ? 'terms' : 'privacy';
  const BackIcon = legalDir === 'rtl' ? ArrowRight : ArrowLeft;

  const uiLabels = {
    backHome: isAuthenticated
      ? tr('العودة إلى لوحة التحكم', 'Back to Dashboard', 'ڈیش بورڈ پر واپس جائیں')
      : tr('العودة إلى الرئيسية', 'Back to Home', 'ہوم پیج پر واپس جائیں'),
    backShort: tr('رجوع', 'Back', 'واپس'),
    contactLink: tr('تواصل معنا', 'Contact Us', 'رابطہ کریں'),
    tocTitle: tr('فهرس الأقسام', 'Document Sections', 'دستاویز کے حصے'),
    privacyTab: tr('سياسة الخصوصية', 'Privacy Policy', 'رازداری کی پالیسی'),
    termsTab: tr('شروط الاستخدام', 'Terms of Service', 'استعمال کی شرائط'),
    otherDocPrompt:
      page === 'privacy'
        ? tr(
            'اطلع أيضاً على شروط الاستخدام لمعرفة مسؤوليات الأدوار وضوابط التشغيل.',
            'Read the Terms of Service for usage rules and role responsibilities.',
            'کرداروں کی ذمہ داریوں اور آپریشنل قواعد کے لیے استعمال کی شرائط بھی پڑھیں۔'
          )
        : tr(
            'اطلع أيضاً على سياسة الخصوصية لمعرفة تفاصيل تخزين البيانات في Firebase وGoogle Drive.',
            'Read the Privacy Policy for Firebase & Google Drive data details.',
            'Firebase اور Google Drive میں ڈیٹا اسٹوریج کی تفصیلات کے لیے رازداری کی پالیسی پڑھیں۔'
          ),
  };

  return (
    <div
      className="min-h-screen flex flex-col bg-[#F5F8FF] dark:bg-[#0B1B32] text-[#0B1B32] dark:text-white transition-colors"
      dir={legalDir}
    >
      {/* Clean Top Bar for Legal Document Reading */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/95 dark:bg-[#0B1B32]/95 border-b border-[#DCE6FA] dark:border-[#1F3B66]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <a
            href={buildLegalPath('home')}
            onClick={(e) => {
              e.preventDefault();
              onNavigatePage('home');
            }}
            className="flex items-center gap-2.5 text-[#0B1B32] dark:text-white font-bold tracking-tight whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity"
          >
            <BrandLogo size="sm" />
            <span className="text-base sm:text-lg font-extrabold hidden sm:inline">
              {t('brandName')} <span className="text-[#1764FF] dark:text-[#6CA2FF]">| {t('brandSub')}</span>
            </span>
          </a>

          {/* Page Switcher (Desktop) */}
          <nav
            aria-label={tr('الوثائق القانونية', 'Legal Documents', 'قانونی دستاویزات')}
            className="hidden md:flex items-center gap-1 p-1 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
          >
            <a
              href={buildLegalPath('privacy')}
              onClick={(e) => {
                e.preventDefault();
                onNavigatePage('privacy');
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                page === 'privacy'
                  ? 'bg-[#1764FF] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-[#0B1B32] dark:hover:text-white'
              }`}
            >
              {uiLabels.privacyTab}
            </a>
            <a
              href={buildLegalPath('terms')}
              onClick={(e) => {
                e.preventDefault();
                onNavigatePage('terms');
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                page === 'terms'
                  ? 'bg-[#1764FF] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-[#0B1B32] dark:hover:text-white'
              }`}
            >
              {uiLabels.termsTab}
            </a>
          </nav>

          {/* Controls: AR/EN/UR Switcher, Theme, Back */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="flex items-center p-0.5 rounded-lg bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              role="group"
              aria-label={tr('لغة الوثيقة', 'Document Language', 'دستاویز کی زبان')}
            >
              <button
                type="button"
                onClick={() => setLanguage('ar')}
                className={`px-2 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  language === 'ar'
                    ? 'bg-[#1764FF] text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:text-[#0B1B32] dark:hover:text-white'
                }`}
              >
                العربية
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-2 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  language === 'en'
                    ? 'bg-[#1764FF] text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:text-[#0B1B32] dark:hover:text-white'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setLanguage('ur')}
                className={`px-2 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  language === 'ur'
                    ? 'bg-[#1764FF] text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:text-[#0B1B32] dark:hover:text-white'
                }`}
              >
                اردو
              </button>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-[#1764FF]/10 border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#122543] transition-colors min-w-[38px] min-h-[38px] flex items-center justify-center"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#08C99B]" />
              ) : (
                <Moon className="w-4 h-4 text-[#0B1B32]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigatePage('home')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
            >
              <BackIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{uiLabels.backHome}</span>
              <span className="sm:hidden">{uiLabels.backShort}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Legal Document Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Urdu Language Note when official AR/EN text is displayed */}
        {language === 'ur' && (
          <div className="mb-6 p-3.5 rounded-xl bg-[#1764FF]/8 dark:bg-[#1764FF]/15 border border-[#1764FF]/25 text-xs text-[#0B1B32] dark:text-blue-100 flex flex-wrap items-center justify-between gap-2">
            <span>
              سرکاری قانونی متن عربی اور انگریزی میں دستیاب ہے۔ آپ اوپر سے کسی بھی وقت زبان تبدیل کر سکتے ہیں۔
            </span>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className="text-[#1764FF] dark:text-[#6CA2FF] font-bold underline"
            >
              View in English
            </button>
          </div>
        )}

        {/* Mobile Document Switcher */}
        <div className="flex md:hidden items-center gap-1 p-1 mb-6 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]">
          <a
            href={buildLegalPath('privacy')}
            onClick={(e) => {
              e.preventDefault();
              onNavigatePage('privacy');
            }}
            className={`flex-1 text-center px-3 py-2.5 rounded-lg text-xs font-bold transition-colors ${
              page === 'privacy'
                ? 'bg-[#1764FF] text-white'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {uiLabels.privacyTab}
          </a>
          <a
            href={buildLegalPath('terms')}
            onClick={(e) => {
              e.preventDefault();
              onNavigatePage('terms');
            }}
            className={`flex-1 text-center px-3 py-2.5 rounded-lg text-xs font-bold transition-colors ${
              page === 'terms'
                ? 'bg-[#1764FF] text-white'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {uiLabels.termsTab}
          </a>
        </div>

        {/* Hero / Header Block */}
        <section className="pb-8 mb-8 border-b border-[#DCE6FA] dark:border-[#1F3B66] space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-bold text-[#1764FF] dark:text-[#6CA2FF]">
              {docData.eyebrow}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {docData.effectiveDateLabel}: {docData.effectiveDateValue}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {docData.scopeLabel}: {docData.scopeValue}
            </span>
          </div>

          <div className="space-y-3 max-w-3xl">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#0B1B32] dark:text-white text-balance">
              {docData.title}
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
              {docData.subtitle}
            </p>
          </div>

          {/* Factual Key Highlights Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {docData.summaryPoints.map((item) => (
              <div
                key={item.label}
                className="p-4 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] shadow-xs space-y-1.5"
              >
                <div className="text-xs font-extrabold text-[#1764FF] dark:text-[#6CA2FF]">
                  {item.label}
                </div>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Two-Column Reading Layout: Sticky TOC + Structured Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Table of Contents */}
          <aside className="lg:col-span-4 lg:sticky lg:top-24 space-y-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-[#0B1B32] dark:text-white">
                {page === 'privacy' ? (
                  <ShieldCheck className="w-4 h-4 text-[#08C99B] shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF] shrink-0" />
                )}
                <span>{uiLabels.tocTitle}</span>
              </div>
              <nav aria-label={uiLabels.tocTitle} className="space-y-1">
                {docData.sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="flex items-baseline gap-2.5 px-2.5 py-2 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-[#F5F8FF] dark:hover:bg-[#173056] hover:text-[#1764FF] dark:hover:text-[#6CA2FF] transition-colors"
                  >
                    <span className="font-mono-num text-[11px] font-bold text-[#1764FF] dark:text-[#6CA2FF] shrink-0">
                      {section.number}.
                    </span>
                    <span className="leading-snug">{section.title}</span>
                  </a>
                ))}
              </nav>
            </div>

            {/* Cross-link Card */}
            <div className="p-5 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] shadow-xs space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {uiLabels.otherDocPrompt}
              </p>
              <a
                href={buildLegalPath(otherPage)}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigatePage(otherPage);
                }}
                className="inline-flex items-center gap-2 text-xs font-bold text-[#1764FF] dark:text-[#6CA2FF] hover:underline"
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>{otherPage === 'privacy' ? uiLabels.privacyTab : uiLabels.termsTab}</span>
              </a>
            </div>
          </aside>

          {/* Main Document Article */}
          <article className="lg:col-span-8 bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-6 sm:p-8 shadow-xs space-y-8">
            {docData.sections.map((section, idx) => (
              <section
                key={section.id}
                id={section.id}
                className={`scroll-mt-24 ${
                  idx > 0 ? 'pt-8 border-t border-[#E6EEFC] dark:border-[#1F3B66]' : ''
                } space-y-4`}
              >
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white flex items-baseline gap-2.5">
                  <span className="font-mono-num text-base sm:text-lg text-[#1764FF] dark:text-[#6CA2FF] shrink-0">
                    {section.number}.
                  </span>
                  <span>{section.title}</span>
                </h2>

                <div className="space-y-3">
                  {section.paragraphs.map((paragraph, pIdx) => (
                    <p
                      key={pIdx}
                      className="text-sm sm:text-[15px] text-slate-700 dark:text-slate-300 leading-relaxed"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>

                {section.bullets && section.bullets.length > 0 && (
                  <ul className="space-y-2.5 pt-1">
                    {section.bullets.map((bullet, bIdx) => (
                      <li
                        key={bIdx}
                        className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2 w-1.5 h-1.5 rounded-full bg-[#1764FF] shrink-0"
                        />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            {/* Bottom Action Bar */}
            <div className="pt-8 border-t border-[#E6EEFC] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => onNavigatePage('home')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] transition-colors"
              >
                <BackIcon className="w-4 h-4 shrink-0" />
                <span>{uiLabels.backHome}</span>
              </button>

              {!isAuthenticated && (
                <a
                  href={`${buildLegalPath('home')}#contact`}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigatePage('home', 'contact');
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-[#0B1B32] dark:text-slate-200 bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF]/50 transition-colors"
                >
                  <span>{uiLabels.contactLink}</span>
                </a>
              )}
            </div>
          </article>
        </div>
      </main>

      {/* Quiet Legal Footer */}
      <footer
        className="border-t border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#0B1B32] py-6 text-xs text-slate-500 dark:text-slate-400"
        dir={direction}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>{t('allRightsReserved')}</span>
          <div className="flex items-center gap-4">
            <a
              href={buildLegalPath('privacy')}
              onClick={(e) => {
                e.preventDefault();
                onNavigatePage('privacy');
              }}
              className={`hover:text-[#1764FF] transition-colors ${
                page === 'privacy' ? 'text-[#1764FF] dark:text-[#6CA2FF] font-bold' : ''
              }`}
            >
              {t('privacyPolicy')}
            </a>
            <span aria-hidden="true">·</span>
            <a
              href={buildLegalPath('terms')}
              onClick={(e) => {
                e.preventDefault();
                onNavigatePage('terms');
              }}
              className={`hover:text-[#1764FF] transition-colors ${
                page === 'terms' ? 'text-[#1764FF] dark:text-[#6CA2FF] font-bold' : ''
              }`}
            >
              {t('termsOfService')}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
