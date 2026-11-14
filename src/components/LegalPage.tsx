import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { LEGAL_DOCUMENTS } from '../data/legalContent';
import { AppPageRoute, buildLegalPath } from '../utils/legalRoutes';
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Globe,
  Lock,
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
  const { language, setLanguage, direction, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  // Official legal pages explicitly support Arabic (RTL) and English (LTR).
  // If Urdu is active globally, default display cleanly to Arabic while allowing instant AR/EN switching.
  const activeLegalLang: 'ar' | 'en' = language === 'en' ? 'en' : 'ar';
  const legalDir: 'rtl' | 'ltr' = activeLegalLang === 'en' ? 'ltr' : 'rtl';
  const docData = LEGAL_DOCUMENTS[page][activeLegalLang];

  const otherPage: 'privacy' | 'terms' = page === 'privacy' ? 'terms' : 'privacy';
  const BackIcon = legalDir === 'rtl' ? ArrowRight : ArrowLeft;

  const uiLabels =
    activeLegalLang === 'en'
      ? {
          backHome: isAuthenticated ? 'Back to Dashboard' : 'Back to Home',
          contactLink: 'Contact Us',
          tocTitle: 'Document Sections',
          privacyTab: 'Privacy Policy',
          termsTab: 'Terms of Service',
          otherDocPrompt:
            page === 'privacy'
              ? 'Read the Terms of Service for usage rules and role responsibilities.'
              : 'Read the Privacy Policy for Firebase & Google Drive data details.',
        }
      : {
          backHome: isAuthenticated ? 'العودة إلى لوحة التحكم' : 'العودة إلى الرئيسية',
          contactLink: 'تواصل معنا',
          tocTitle: 'فهرس الأقسام',
          privacyTab: 'سياسة الخصوصية',
          termsTab: 'شروط الاستخدام',
          otherDocPrompt:
            page === 'privacy'
              ? 'اطلع أيضاً على شروط الاستخدام لمعرفة مسؤوليات الأدوار وضوابط التشغيل.'
              : 'اطلع أيضاً على سياسة الخصوصية لمعرفة تفاصيل تخزين البيانات في Firebase وGoogle Drive.',
        };

  return (
    <div
      className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#070e17] text-slate-900 dark:text-slate-100 transition-colors"
      dir={legalDir}
    >
      {/* Clean Top Bar for Legal Document Reading */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/95 dark:bg-[#0b192c]/95 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <a
            href={buildLegalPath('home')}
            onClick={(e) => {
              e.preventDefault();
              onNavigatePage('home');
            }}
            className="flex items-center gap-2.5 text-slate-900 dark:text-white font-bold tracking-tight whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity"
          >
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#0b192c] border border-amber-500/40 text-amber-400">
              <Lock className="w-4 h-4" />
            </span>
            <span className="text-base sm:text-lg font-extrabold">
              {t('brandName')} <span className="text-amber-500">| {t('brandSub')}</span>
            </span>
          </a>

          {/* Page Switcher (Desktop) */}
          <nav
            aria-label={activeLegalLang === 'en' ? 'Legal Documents' : 'الوثائق القانونية'}
            className="hidden md:flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800"
          >
            <a
              href={buildLegalPath('privacy')}
              onClick={(e) => {
                e.preventDefault();
                onNavigatePage('privacy');
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                page === 'privacy'
                  ? 'bg-white dark:bg-[#0c1829] text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                page === 'terms'
                  ? 'bg-white dark:bg-[#0c1829] text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {uiLabels.termsTab}
            </a>
          </nav>

          {/* Controls: AR/EN Switcher, Theme, Back */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800"
              role="group"
              aria-label={activeLegalLang === 'en' ? 'Document Language' : 'لغة الوثيقة'}
            >
              <button
                type="button"
                onClick={() => setLanguage('ar')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  activeLegalLang === 'ar'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                العربية
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  activeLegalLang === 'en'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                English
              </button>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors min-w-[38px] min-h-[38px] flex items-center justify-center"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigatePage('home')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
            >
              <BackIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{uiLabels.backHome}</span>
              <span className="sm:hidden">{activeLegalLang === 'en' ? 'Back' : 'رجوع'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Legal Document Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Mobile Document Switcher */}
        <div className="flex md:hidden items-center gap-1 p-1 mb-6 rounded-xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800">
          <a
            href={buildLegalPath('privacy')}
            onClick={(e) => {
              e.preventDefault();
              onNavigatePage('privacy');
            }}
            className={`flex-1 text-center px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
              page === 'privacy'
                ? 'bg-amber-400 text-slate-950 font-bold'
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
            className={`flex-1 text-center px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
              page === 'terms'
                ? 'bg-amber-400 text-slate-950 font-bold'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {uiLabels.termsTab}
          </a>
        </div>

        {/* Hero / Header Block */}
        <section className="pb-8 mb-8 border-b border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-amber-600 dark:text-amber-400">
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
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white text-balance">
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
                className="p-4 rounded-xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 space-y-1.5"
              >
                <div className="text-xs font-bold text-amber-600 dark:text-amber-400">
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
            <div className="p-5 rounded-2xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                {page === 'privacy' ? (
                  <ShieldCheck className="w-4 h-4 text-amber-500 shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-amber-500 shrink-0" />
                )}
                <span>{uiLabels.tocTitle}</span>
              </div>
              <nav aria-label={uiLabels.tocTitle} className="space-y-1">
                {docData.sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="flex items-baseline gap-2.5 px-2.5 py-2 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-amber-400 transition-colors"
                  >
                    <span className="font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400 shrink-0 tabular-nums">
                      {section.number}.
                    </span>
                    <span className="leading-snug">{section.title}</span>
                  </a>
                ))}
              </nav>
            </div>

            {/* Cross-link Card */}
            <div className="p-5 rounded-2xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {uiLabels.otherDocPrompt}
              </p>
              <a
                href={buildLegalPath(otherPage)}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigatePage(otherPage);
                }}
                className="inline-flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline"
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>{otherPage === 'privacy' ? uiLabels.privacyTab : uiLabels.termsTab}</span>
              </a>
            </div>
          </aside>

          {/* Main Document Article */}
          <article className="lg:col-span-8 space-y-8">
            {docData.sections.map((section, idx) => (
              <section
                key={section.id}
                id={section.id}
                className={`scroll-mt-24 ${
                  idx > 0 ? 'pt-8 border-t border-slate-200 dark:border-slate-800' : ''
                } space-y-4`}
              >
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-baseline gap-2.5">
                  <span className="font-mono text-base sm:text-lg text-amber-600 dark:text-amber-400 tabular-nums shrink-0">
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
                          className="mt-2 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                        />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            {/* Bottom Action Bar */}
            <div className="pt-8 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => onNavigatePage('home')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors"
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
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 hover:border-amber-500/40 transition-colors"
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
        className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b192c] py-6 text-xs text-slate-500 dark:text-slate-400"
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
              className={`hover:text-amber-500 transition-colors ${
                page === 'privacy' ? 'text-amber-500 font-bold' : ''
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
              className={`hover:text-amber-500 transition-colors ${
                page === 'terms' ? 'text-amber-500 font-bold' : ''
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
