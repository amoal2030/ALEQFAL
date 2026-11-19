import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { AppPageRoute, buildLegalPath } from '../utils/legalRoutes';
import { BrandLogo } from './common/BrandLogo';
import { ShieldCheck } from 'lucide-react';

interface FooterProps {
  onNavigatePage?: (page: AppPageRoute, sectionId?: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigatePage }) => {
  const { t, language, setLanguage } = useLanguage();

  const handleLegalClick = (e: React.MouseEvent<HTMLAnchorElement>, page: AppPageRoute) => {
    if (!onNavigatePage || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    onNavigatePage(page);
  };

  return (
    <footer className="bg-white dark:bg-[#091529] text-[#526785] dark:text-slate-300 border-t border-[#E2EAFA] dark:border-[#1E3A63] transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand Info with Auto-Switching Official Logo */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <BrandLogo size="md" />
              <div className="flex flex-col leading-tight">
                <span className="text-lg font-extrabold text-[#0B1B32] dark:text-white">
                  {t('brandName')}
                </span>
                <span className="text-xs font-bold text-[#1764FF] dark:text-[#6EA3FF]">
                  {t('brandSub')}
                </span>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-[#526785] dark:text-slate-300 max-w-md leading-relaxed">
              {t('tagline')}. {t('footerBrandDesc')}
            </p>
            <div className="flex items-center gap-2 text-xs text-[#048264] dark:text-[#3CE0B9] font-semibold">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>{t('footerIsolationNote')}</span>
            </div>
          </div>

          {/* Quick Links & Legal */}
          <div className="space-y-4">
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-[#0B1B32] dark:text-white">
                {t('footerSectionsTitle')}
              </h4>
              <ul className="space-y-2 text-xs text-[#526785] dark:text-slate-300">
                <li>
                  <a href="#features" className="hover:text-[#1764FF] dark:hover:text-[#7EB0FF] transition-colors">
                    {t('navFeatures')}
                  </a>
                </li>
                <li>
                  <a href="#how-it-works" className="hover:text-[#1764FF] dark:hover:text-[#7EB0FF] transition-colors">
                    {t('navHowItWorks')}
                  </a>
                </li>
                <li>
                  <a href="#simulator" className="hover:text-[#1764FF] dark:hover:text-[#7EB0FF] transition-colors">
                    {t('navSimulator')}
                  </a>
                </li>
                <li>
                  <a href="#benefits" className="hover:text-[#1764FF] dark:hover:text-[#7EB0FF] transition-colors">
                    {t('navBenefits')}
                  </a>
                </li>
                <li>
                  <a href="#faq" className="hover:text-[#1764FF] dark:hover:text-[#7EB0FF] transition-colors">
                    {t('navFaq')}
                  </a>
                </li>
              </ul>
            </div>

            <div className="space-y-2.5 pt-3 border-t border-[#EDF2FC] dark:border-[#1E3A63]">
              <h4 className="text-xs font-bold text-[#0B1B32] dark:text-white">
                {t('legalSectionTitle')}
              </h4>
              <ul className="space-y-2 text-xs text-[#526785] dark:text-slate-300">
                <li>
                  <a
                    href={buildLegalPath('privacy')}
                    onClick={(e) => handleLegalClick(e, 'privacy')}
                    className="hover:text-[#1764FF] dark:hover:text-[#7EB0FF] underline-offset-4 hover:underline transition-colors"
                  >
                    {t('privacyPolicy')}
                  </a>
                </li>
                <li>
                  <a
                    href={buildLegalPath('terms')}
                    onClick={(e) => handleLegalClick(e, 'terms')}
                    className="hover:text-[#1764FF] dark:hover:text-[#7EB0FF] underline-offset-4 hover:underline transition-colors"
                  >
                    {t('termsOfService')}
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Language Switcher */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-[#0B1B32] dark:text-white">
              {t('language')}
            </h4>
            <div className="flex flex-col gap-2 text-xs">
              <button
                type="button"
                onClick={() => setLanguage('ar')}
                className={`text-start px-3 py-2 rounded-xl transition-colors ${
                  language === 'ar'
                    ? 'bg-[#1764FF] text-white font-bold'
                    : 'bg-[#F5F8FF] dark:bg-[#122543] text-[#0B1B32] dark:text-slate-200 hover:bg-[#EAF1FF] dark:hover:bg-[#193259]'
                }`}
              >
                🇸🇦 العربية (RTL)
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`text-start px-3 py-2 rounded-xl transition-colors ${
                  language === 'en'
                    ? 'bg-[#1764FF] text-white font-bold'
                    : 'bg-[#F5F8FF] dark:bg-[#122543] text-[#0B1B32] dark:text-slate-200 hover:bg-[#EAF1FF] dark:hover:bg-[#193259]'
                }`}
              >
                🇬🇧 English (LTR)
              </button>
              <button
                type="button"
                onClick={() => setLanguage('ur')}
                className={`text-start px-3 py-2 rounded-xl transition-colors ${
                  language === 'ur'
                    ? 'bg-[#1764FF] text-white font-bold'
                    : 'bg-[#F5F8FF] dark:bg-[#122543] text-[#0B1B32] dark:text-slate-200 hover:bg-[#EAF1FF] dark:hover:bg-[#193259]'
                }`}
              >
                🇵🇰 اردو (RTL)
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-6 border-t border-[#EDF2FC] dark:border-[#1E3A63] flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-[#647B9C] dark:text-slate-400">
          <div>{t('allRightsReserved')}</div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href={buildLegalPath('privacy')}
              onClick={(e) => handleLegalClick(e, 'privacy')}
              className="text-[#4A6082] dark:text-slate-300 hover:text-[#1764FF] dark:hover:text-[#7EB0FF] transition-colors font-medium"
            >
              {t('privacyPolicy')}
            </a>
            <span aria-hidden="true">·</span>
            <a
              href={buildLegalPath('terms')}
              onClick={(e) => handleLegalClick(e, 'terms')}
              className="text-[#4A6082] dark:text-slate-300 hover:text-[#1764FF] dark:hover:text-[#7EB0FF] transition-colors font-medium"
            >
              {t('termsOfService')}
            </a>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-center">
            <span>{t('footerDesignedBy')}</span>
            <a
              href="https://amoal2030.github.io/a1/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1764FF] dark:text-[#7EB0FF] hover:underline font-semibold transition-colors"
              dir="ltr"
            >
              https://amoal2030.github.io/a1/
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
