import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { SupportedLanguage } from '../types';
import {
  Sun,
  Moon,
  Globe,
  Menu,
  X,
  Lock,
  Building2,
  Calculator,
  HelpCircle,
  PhoneCall,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  ChevronDown
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
    <header className="sticky top-0 z-50 backdrop-blur-md bg-white/95 dark:bg-[#0B192C]/95 border-b border-slate-200/90 dark:border-[#1A3152] transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Logo & Brand */}
          <div
            onClick={() => handleNavClick('hero')}
            className="flex items-center gap-2.5 sm:gap-3 cursor-pointer select-none group shrink-0"
          >
            <div className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#0B192C] border border-[#1E3A63] shadow-xs group-hover:bg-blue-600 group-hover:border-blue-500 transition-colors shrink-0">
              <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-white transition-transform group-hover:scale-105" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-base sm:text-xl font-extrabold tracking-tight text-[#0B192C] dark:text-white">
                  {t('brandName')}
                </span>
                <span className="text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-400/30">
                  {t('brandSub')}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium hidden md:inline-block">
                {t('tagline')}
              </span>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1 xl:gap-1.5">
            <button
              onClick={() => handleNavClick('features')}
              className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-[#0B192C] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-blue-50/70 dark:hover:bg-white/10 transition-colors"
            >
              {t('navFeatures')}
            </button>
            <button
              onClick={() => handleNavClick('how-it-works')}
              className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-[#0B192C] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-blue-50/70 dark:hover:bg-white/10 transition-colors"
            >
              {t('navHowItWorks')}
            </button>
            <button
              onClick={() => handleNavClick('simulator')}
              className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-blue-700 dark:text-slate-300 dark:hover:text-blue-200 rounded-xl hover:bg-blue-50/70 dark:hover:bg-white/10 transition-colors flex items-center gap-1.5"
            >
              <Calculator className="w-4 h-4 text-blue-600 dark:text-blue-300" />
              <span>{t('navSimulator')}</span>
            </button>
            <button
              onClick={() => handleNavClick('benefits')}
              className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-[#0B192C] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-blue-50/70 dark:hover:bg-white/10 transition-colors"
            >
              {t('navBenefits')}
            </button>
            <button
              onClick={() => handleNavClick('faq')}
              className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-[#0B192C] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-blue-50/70 dark:hover:bg-white/10 transition-colors"
            >
              {t('navFaq')}
            </button>
            <button
              onClick={() => handleNavClick('contact')}
              className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-[#0B192C] dark:text-slate-300 dark:hover:text-white rounded-xl hover:bg-blue-50/70 dark:hover:bg-white/10 transition-colors"
            >
              {t('navContact')}
            </button>
          </nav>

          {/* Right Action Tools: Language, Theme, Auth */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {/* Language Selector */}
            <div className="relative">
              <button
                onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-[#0B192C] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-[#1E375B] transition-colors min-h-[36px]"
                title={t('language')}
                aria-label="تغيير اللغة"
              >
                <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300" />
                <span className="uppercase text-[11px]">{currentLangObj.code}</span>
                <ChevronDown className="w-3 h-3 text-slate-400 hidden xs:inline" />
              </button>

              {langDropdownOpen && (
                <div
                  className={`absolute top-full mt-1.5 w-36 rounded-xl bg-white dark:bg-[#0C1829] border border-slate-200 dark:border-slate-800 shadow-xl py-1 z-50 ${
                    direction === 'rtl' ? 'left-0' : 'right-0'
                  }`}
                >
                  {languages.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => {
                        setLanguage(l.code);
                        setLangDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium transition-colors ${
                        language === l.code
                          ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 font-bold'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{l.flag}</span>
                        <span>{l.label}</span>
                      </span>
                      {language === l.code && <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dark / Light Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl text-slate-600 hover:text-blue-700 dark:text-slate-300 dark:hover:text-white hover:bg-blue-50 dark:hover:bg-white/10 border border-slate-200 dark:border-[#1E375B] transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
              aria-label="Toggle Theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-sky-300" />
              ) : (
                <Moon className="w-4 h-4 text-[#0B192C]" />
              )}
            </button>

            {/* Sign In Button - ALWAYS visible on mobile & desktop */}
            <button
              onClick={() => onOpenAuth('manager')}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-[#0B192C] dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl border border-slate-200 dark:border-[#1E375B] transition-colors min-h-[36px]"
              title={t('navLogin')}
            >
              <Lock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300 shrink-0" />
              <span>{t('navLogin')}</span>
            </button>

            {/* Register New Organization Button */}
            <button
              onClick={() => onOpenAuth('register')}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors active:scale-95 min-h-[36px]"
            >
              <Building2 className="w-3.5 h-3.5 text-white shrink-0" />
              <span className="hidden sm:inline">{t('navRegisterOrg')}</span>
              <span className="sm:hidden text-xs">تأسيس</span>
            </button>

            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-1.5 sm:p-2 rounded-xl text-[#0B192C] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-[#1E375B] min-w-[36px] min-h-[36px] flex items-center justify-center"
              aria-label="Toggle Mobile Menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden px-4 pt-3 pb-6 border-t border-slate-200 dark:border-[#1A3152] bg-white dark:bg-[#0B192C] space-y-3">
          {/* Quick Auth Cards at Top of Mobile Drawer */}
          <div className="grid grid-cols-2 gap-2.5 pb-3 border-b border-slate-100 dark:border-[#1A3152]">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAuth('manager');
              }}
              className="p-3 text-start text-xs font-bold text-[#0B192C] dark:text-white bg-[#F4F7FB] dark:bg-[#112440] border border-blue-200 dark:border-blue-500/30 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-950/50 flex flex-col gap-1 min-h-[50px] justify-center"
            >
              <span className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                <Lock className="w-3.5 h-3.5" />
                <span>دخول المدير</span>
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">عبر Google</span>
            </button>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAuth('employee');
              }}
              className="p-3 text-start text-xs font-bold text-[#0B192C] dark:text-white bg-[#F4F7FB] dark:bg-[#112440] border border-sky-200 dark:border-sky-500/30 rounded-xl hover:bg-sky-50 dark:hover:bg-sky-950/50 flex flex-col gap-1 min-h-[50px] justify-center"
            >
              <span className="flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
                <Lock className="w-3.5 h-3.5" />
                <span>دخول الموظف</span>
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">بالبريد والرقم السري</span>
            </button>
          </div>

          {/* Nav links */}
          <button
            onClick={() => handleNavClick('features')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-white/10"
          >
            {t('navFeatures')}
          </button>
          <button
            onClick={() => handleNavClick('how-it-works')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-white/10"
          >
            {t('navHowItWorks')}
          </button>
          <button
            onClick={() => handleNavClick('simulator')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-white/10 flex items-center justify-between"
          >
            <span>{t('navSimulator')}</span>
            <Calculator className="w-4 h-4 text-blue-600 dark:text-blue-300" />
          </button>
          <button
            onClick={() => handleNavClick('benefits')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-white/10"
          >
            {t('navBenefits')}
          </button>
          <button
            onClick={() => handleNavClick('faq')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-white/10"
          >
            {t('navFaq')}
          </button>
          <button
            onClick={() => handleNavClick('contact')}
            className="w-full text-start px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-white/10"
          >
            {t('navContact')}
          </button>

          <div className="pt-2">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAuth('register');
              }}
              className="w-full py-3 px-4 text-center text-xs font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-xs"
            >
              {t('navRegisterOrg')}
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
