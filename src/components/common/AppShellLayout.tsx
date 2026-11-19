import React, { useState, useEffect } from 'react';
import { Lock, Menu, X, Sun, Moon, LogOut, Globe, ChevronDown } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { SupportedLanguage } from '../../types';

export interface AppShellNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badgeCount?: number;
}

interface AppShellLayoutProps {
  brandTitle?: string;
  brandSubtitle: string;
  contextBadge?: string;
  contextTitle?: string;
  contextSubtitle?: string;
  navItems: AppShellNavItem[];
  activeNavId: string;
  onSelectNav: (id: string) => void;
  sidebarFooter?: React.ReactNode;
  headerActions?: React.ReactNode;
  headerBanners?: React.ReactNode;
  footer?: React.ReactNode;
  userDisplayName?: string;
  userEmail?: string;
  userRoleLabel?: string;
  onLogout: () => void;
  children: React.ReactNode;
}

const LANG_LABELS: Record<SupportedLanguage, string> = {
  ar: 'العربية',
  en: 'English',
  ur: 'اردو',
};

export const AppShellLayout: React.FC<AppShellLayoutProps> = ({
  brandTitle = 'الإقفال | AL EQFAL',
  brandSubtitle,
  contextBadge,
  contextTitle,
  contextSubtitle,
  navItems,
  activeNavId,
  onSelectNav,
  sidebarFooter,
  headerActions,
  headerBanners,
  footer,
  userDisplayName,
  userEmail,
  userRoleLabel,
  onLogout,
  children,
}) => {
  const { theme, toggleTheme } = useTheme();
  const { language, direction, setLanguage } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mobileOpen]);

  const activeItem = navItems.find((item) => item.id === activeNavId) || navItems[0];

  const handleNavClick = (id: string) => {
    onSelectNav(id);
    setMobileOpen(false);
  };

  const renderSidebarContent = (isMobile: boolean) => (
    <div className="flex flex-col h-full bg-[#0B192C] text-white select-none">
      {/* Top Brand Block */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#1A3152]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-blue-950/40 ring-1 ring-blue-400/30">
            <Lock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-extrabold tracking-tight text-white truncate">
              {brandTitle}
            </div>
            <div className="text-[11px] font-medium text-blue-300/90 truncate">
              {brandSubtitle}
            </div>
          </div>
        </div>
        {isMobile && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={direction === 'rtl' ? 'إغلاق القائمة' : 'Close menu'}
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Organization / Role Context Card inside Sidebar */}
      {(contextTitle || contextSubtitle || contextBadge) && (
        <div className="mx-3 mt-4 p-3.5 rounded-xl bg-[#112440] border border-[#1E375B]">
          {contextBadge && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/20 text-blue-200 border border-blue-400/25 mb-1.5">
              {contextBadge}
            </span>
          )}
          {contextTitle && (
            <p className="text-xs font-bold text-white truncate" title={contextTitle}>
              {contextTitle}
            </p>
          )}
          {contextSubtitle && (
            <p className="text-[11px] text-slate-300/85 truncate mt-0.5" title={contextSubtitle}>
              {contextSubtitle}
            </p>
          )}
        </div>
      )}

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Sidebar Navigation">
        {navItems.map((item) => {
          const isActive = item.id === activeNavId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all duration-150 ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-950/50'
                  : 'text-slate-300 hover:bg-white/8 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className={`shrink-0 ${isActive ? 'text-white' : 'text-blue-300/80'}`}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold tabular-nums shrink-0 ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-blue-500/25 text-blue-200'
                  }`}
                >
                  {item.badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Sidebar Bottom Slot + Account Card */}
      <div className="p-3 border-t border-[#1A3152] space-y-2.5 bg-[#091526]">
        {sidebarFooter}

        <div className="flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl bg-[#10213A] border border-[#1B3355]">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-white truncate">
              {userDisplayName || userEmail || 'المستخدم'}
            </p>
            <p className="text-[10px] text-slate-300/80 truncate">
              {userRoleLabel || userEmail}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="p-2 rounded-lg text-slate-300 hover:text-rose-300 hover:bg-rose-500/15 transition-colors shrink-0"
            title={direction === 'rtl' ? 'تسجيل الخروج' : 'Sign out'}
            aria-label={direction === 'rtl' ? 'تسجيل الخروج' : 'Sign out'}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      dir={direction}
      className="min-h-screen flex bg-[#F4F7FB] text-[#0B192C] dark:bg-[#070E17] dark:text-slate-100 transition-colors duration-200"
    >
      {/* Desktop Fixed/Sticky Navy Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-[264px] lg:shrink-0 lg:flex-col lg:sticky lg:top-0 lg:h-screen border-e border-[#1A3152] z-30">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile / Tablet Slide-Over Drawer */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-[280px] max-w-[85vw] h-full shadow-2xl z-10 border-e border-[#1A3152]">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Top White Utility Bar */}
        <header className="no-print sticky top-0 z-20 h-16 bg-white/95 dark:bg-[#0C1829]/95 backdrop-blur-md border-b border-slate-200/90 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0B192C] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
              aria-label={direction === 'rtl' ? 'فتح القائمة' : 'Open navigation'}
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-extrabold text-[#0B192C] dark:text-white truncate">
                  {activeItem?.label || brandTitle}
                </h1>
              </div>
              {contextTitle && (
                <p className="hidden sm:block text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                  {contextTitle}
                  {contextSubtitle ? ` — ${contextSubtitle}` : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {headerActions}

            {/* Language Selector */}
            <div className="relative hidden sm:flex items-center">
              <Globe className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute start-2.5" />
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
                aria-label="Language"
                className="appearance-none ps-7 pe-6 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-xs font-semibold text-[#0B192C] dark:text-slate-200 focus:outline-none focus:border-blue-600 transition-colors"
              >
                {(['ar', 'en', 'ur'] as SupportedLanguage[]).map((lang) => (
                  <option key={lang} value={lang}>
                    {LANG_LABELS[lang]}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 pointer-events-none absolute end-2" />
            </div>

            {/* Mobile compact language toggle */}
            <button
              type="button"
              onClick={() =>
                setLanguage(language === 'ar' ? 'en' : language === 'en' ? 'ur' : 'ar')
              }
              className="sm:hidden px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-bold text-[#0B192C] dark:text-slate-200"
              title="Language"
            >
              {language.toUpperCase()}
            </button>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-slate-700 transition-colors"
              title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
              aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* System Status / Drive / Readiness Banners */}
        {headerBanners && (
          <div className="no-print px-4 sm:px-6 pt-4 space-y-2.5 max-w-[1440px] w-full mx-auto">
            {headerBanners}
          </div>
        )}

        {/* Active View Content */}
        <main className="flex-1 px-4 sm:px-6 py-5 sm:py-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>

        {/* Optional Workspace Footer */}
        {footer && <div className="no-print mt-auto">{footer}</div>}
      </div>
    </div>
  );
};
