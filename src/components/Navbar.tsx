import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { SupportedLanguage } from '../types';
import { BrandLogo } from './common/BrandLogo';
import {
  Sun,
  Moon,
  Globe,
  Menu,
  X,
  Lock,
  Building2,
  Calculator,
  ChevronDown,
} from 'lucide-react';

interface NavbarProps {
  onOpenAuth: (initialTab: 'manager' | 'employee' | 'register') => void;
  onNavigateSection?: (sectionId: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenAuth, onNavigateSection }) => {
  const { language, setLanguage, t, direction } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavClick = (sectionId: string) => {
    setMobileMenuOpen(false);
    if (onNavigateSection) {
      onNavigateSection(sectionId);
    } else {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  const languages: { code: SupportedLanguage; label: string; flag: string }[] = [
    { code: 'ar', label: 'العربية', flag: '🇸🇦' },
    { code: 'en', label: 'English', flag: '🇬🇧' },
    { code: 'ur', label: 'اردو', flag: '🇵🇰' },
  ];

  const currentLangObj = languages.find((l) => l.code === language) || languages[0];

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-white/95 dark:bg-[#0B1B32]/95 border-b border-[#E2EAFA] dark:border-[#1E3A63] transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-16 sm:h-20">
          {/* Official Brand Logo & Clean Wordmark */}
          <button
            type="button"
            onClick={() => handleNavClick('hero')}
            className="flex items-center gap-2.5 sm:gap-3 cursor-pointer select-none group shrink-0 text-start"
          >
            <BrandLogo size="md" />
            <div className="flex flex-col leading-tight">
              <span className="text-base sm:text-lg font-extrabold tracking-tight text-[#0B1B32] dark:text-white whitespace-nowrap">
                {t('brandName')}
              </span>
              <span className="text-[11px] font-bold tracking-wide text-[#1764FF] dark:text-[#6EA3FF] whitespace-nowrap">
                {t('brandSub')}
              </span>
            </div>
          </button>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1 xl:gap-1.5" aria-label={t('navHome')}>
            <button
              type="button"
              onClick={() => handleNavClick('features')}
              className="px-3 py-2 text-sm font-semibold text-[#4A6082] hover:text-[#1764FF] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-[#F5F8FF] dark:hover:bg-white/8 transition-colors whitespace-nowrap shrink-0"
            >
              {t('navFeatures')}
            </button>
            <button
              type="button"
              onClick={() => handleNavClick('how-it-works')}
              className="px-3 py-2 text-sm font-semibold text-[#4A6082] hover:text-[#1764FF] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-[#F5F8FF] dark:hover:bg-white/8 transition-colors whitespace-nowrap shrink-0"
            >
              {t('navHowItWorks')}
            </button>
            <button
              type="button"
              onClick={() => handleNavClick('simulator')}
              className="px-3 py-2 text-sm font-semibold text-[#4A6082] hover:text-[#1764FF] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-[#F5F8FF] dark:hover:bg-white/8 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Calculator className="w-4 h-4 text-[#1764FF] dark:text-[#6EA3FF] shrink-0" />
              <span>{t('navSimulator')}</span>
            </button>
            <button
              type="button"
              onClick={() => handleNavClick('benefits')}
              className="px-3 py-2 text-sm font-semibold text-[#4A6082] hover:text-[#1764FF] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-[#F5F8FF] dark:hover:bg-white/8 transition-colors whitespace-nowrap shrink-0"
            >
              {t('navBenefits')}
            </button>
            <button
              type="button"
              onClick={() => handleNavClick('faq')}
              className="px-3 py-2 text-sm font-semibold text-[#4A6082] hover:text-[#1764FF] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-[#F5F8FF] dark:hover:bg-white/8 transition-colors whitespace-nowrap shrink-0"
            >
              {t('navFaq')}
            </button>
            <button
              type="button"
              onClick={() => handleNavClick('contact')}
              className="px-3 py-2 text-sm font-semibold text-[#4A6082] hover:text-[#1764FF] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-[#F5F8FF] dark:hover:bg-white/8 transition-colors whitespace-nowrap shrink-0"
            >
              {t('navContact')}
            </button>
          </nav>

          {/* Right Action Tools: Language, Theme, Auth */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Language Selector */}
            <div className="relative" ref={langMenuRef}>
              <button
                type="button"
                onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-[#0B1B32] dark:text-slate-100 bg-[#F5F8FF] dark:bg-[#122543] hover:bg-[#EAF1FF] dark:hover:bg-[#193259] border border-[#DCE6F8] dark:border-[#23416E] transition-colors min-h-[38px]"
                title={t('language')}
                aria-label={t('language')}
              >
                <Globe className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6EA3FF]" />
                <span className="uppercase text-[11px]">{currentLangObj.code}</span>
                <ChevronDown className="w-3 h-3 text-[#647B9C] dark:text-slate-400 hidden xs:inline" />
              </button>

              {langDropdownOpen && (
                <div
                  className={`absolute top-full mt-1.5 w-36 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6F8] dark:border-[#23416E] shadow-xl py-1 z-50 ${
                    direction === 'rtl' ? 'left-0' : 'right-0'
                  }`}
                >
                  {languages.map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => {
                        setLanguage(l.code);
                        setLangDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium transition-colors ${
                        language === l.code
                          ? 'text-[#1764FF] dark:text-[#7EB0FF] bg-[#1764FF]/10 font-bold'
                          : 'text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#193259]'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{l.flag}</span>
                        <span>{l.label}</span>
                      </span>
                      {language === l.code && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#08C99B]" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dark / Light Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-xl text-[#0B1B32] dark:text-slate-100 bg-[#F5F8FF] dark:bg-[#122543] hover:bg-[#EAF1FF] dark:hover:bg-[#193259] border border-[#DCE6F8] dark:border-[#23416E] transition-colors min-w-[38px] min-h-[38px] flex items-center justify-center"
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
              aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#08C99B]" />
              ) : (
                <Moon className="w-4 h-4 text-[#0B1B32]" />
              )}
            </button>

            {/* Sign In Button */}
            <button
              type="button"
              onClick={() => onOpenAuth('manager')}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 text-xs sm:text-sm font-bold text-[#0B1B32] dark:text-white bg-white dark:bg-[#122543] hover:bg-[#F5F8FF] dark:hover:bg-[#193259] rounded-xl border border-[#DCE6F8] dark:border-[#23416E] transition-colors min-h-[38px] whitespace-nowrap shrink-0"
              title={t('navLogin')}
            >
              <Lock className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6EA3FF] shrink-0" />
              <span>{t('navLogin')}</span>
            </button>

            {/* Primary CTA: Register New Organization */}
            <button
              type="button"
              onClick={() => onOpenAuth('register')}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] rounded-xl shadow-xs transition-colors active:scale-95 min-h-[38px] whitespace-nowrap shrink-0"
            >
              <Building2 className="w-3.5 h-3.5 text-white shrink-0" />
              <span className="hidden sm:inline">{t('navRegisterOrg')}</span>
              <span className="sm:hidden text-xs">{t('navRegisterShort')}</span>
            </button>

            {/* Mobile Menu Toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-xl text-[#0B1B32] dark:text-white bg-[#F5F8FF] dark:bg-[#122543] hover:bg-[#EAF1FF] dark:hover:bg-[#193259] border border-[#DCE6F8] dark:border-[#23416E] min-w-[38px] min-h-[38px] flex items-center justify-center"
              aria-label={mobileMenuOpen ? t('navCloseMenu') : t('navOpenMenu')}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden px-4 pt-3 pb-6 border-t border-[#E2EAFA] dark:border-[#1E3A63] bg-white dark:bg-[#0B1B32] space-y-2.5">
          {/* Quick Auth Cards at Top of Mobile Drawer */}
          <div className="grid grid-cols-2 gap-2.5 pb-3 border-b border-[#EDF2FC] dark:border-[#1E3A63]">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAuth('manager');
              }}
              className="p-3 text-start text-xs font-bold text-[#0B1B32] dark:text-white bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6F8] dark:border-[#23416E] rounded-xl hover:border-[#1764FF] flex flex-col gap-1 min-h-[54px] justify-center transition-colors"
            >
              <span className="flex items-center gap-1.5 text-[#1764FF] dark:text-[#7EB0FF]">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>{t('navManagerLogin')}</span>
              </span>
              <span className="text-[11px] text-[#526785] dark:text-slate-300 font-normal">
                {t('navManagerLoginSub')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAuth('employee');
              }}
              className="p-3 text-start text-xs font-bold text-[#0B1B32] dark:text-white bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6F8] dark:border-[#23416E] rounded-xl hover:border-[#08C99B] flex flex-col gap-1 min-h-[54px] justify-center transition-colors"
            >
              <span className="flex items-center gap-1.5 text-[#048264] dark:text-[#3CE0B9]">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>{t('navEmployeeLogin')}</span>
              </span>
              <span className="text-[11px] text-[#526785] dark:text-slate-300 font-normal">
                {t('navEmployeeLoginSub')}
              </span>
            </button>
          </div>

          {/* Nav links */}
          <button
            type="button"
            onClick={() => handleNavClick('features')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#122543]"
          >
            {t('navFeatures')}
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('how-it-works')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#122543]"
          >
            {t('navHowItWorks')}
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('simulator')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#122543] flex items-center justify-between"
          >
            <span>{t('navSimulator')}</span>
            <Calculator className="w-4 h-4 text-[#1764FF] dark:text-[#6EA3FF]" />
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('benefits')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#122543]"
          >
            {t('navBenefits')}
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('faq')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#122543]"
          >
            {t('navFaq')}
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('contact')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#122543]"
          >
            {t('navContact')}
          </button>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAuth('register');
              }}
              className="w-full py-3 px-4 text-center text-xs font-bold text-white bg-[#1764FF] rounded-xl hover:bg-[#1052D8] shadow-xs"
            >
              {t('navRegisterOrg')}
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
