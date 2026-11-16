import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { SupportedLanguage } from '../types';
import { SUBSCRIPTION_WHATSAPP_BASE_URL } from '../utils/subscription';
import {
  AlertCircle,
  ExternalLink,
  Globe,
  Lock,
  LogOut,
  MessageCircle,
  Moon,
  RefreshCw,
  ShieldX,
  Sun,
  WifiOff,
} from 'lucide-react';

export const TenantAccessNoticeView: React.FC = () => {
  const {
    tenantStatus,
    inviteBlockInfo,
    accessErrorInfo,
    currentUser,
    logout,
    refreshTenantData,
  } = useAuth();
  const { t, language, setLanguage, direction } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [retrying, setRetrying] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await refreshTenantData();
    } finally {
      setRetrying(false);
    }
  };

  let title = t('subAccessDeniedTitle');
  let description = t('subAccessPermissionError');
  let isNetworkError = false;

  if (tenantStatus === 'invite_blocked' && inviteBlockInfo) {
    if (inviteBlockInfo.reason === 'cancelled') {
      title = t('subInviteCancelledTitle');
      description = t('subInviteCancelledDesc');
    } else if (inviteBlockInfo.reason === 'accepted') {
      title = t('subInviteAcceptedTitle');
      description = t('subInviteAcceptedDesc');
    } else {
      title = t('subInviteOrgErrorTitle');
      description = t('subInviteOrgErrorDesc');
    }
  } else if (accessErrorInfo) {
    switch (accessErrorInfo.reason) {
      case 'email_not_verified':
        description = t('subAccessEmailUnverified');
        break;
      case 'missing_employee_profile':
        description = t('subAccessMissingEmployee');
        break;
      case 'account_disabled':
        description = t('subAccessDisabledAccount');
        break;
      case 'network_error':
        description = t('subAccessNetworkError');
        isNetworkError = true;
        break;
      default:
        description = t('subAccessPermissionError');
        break;
    }
  }

  const supportMessage = encodeURIComponent(
    `${title}\nEmail: ${currentUser?.email || inviteBlockInfo?.email || '—'}`
  );
  const supportUrl = `${SUBSCRIPTION_WHATSAPP_BASE_URL}?text=${supportMessage}`;

  const languages: { code: SupportedLanguage; label: string }[] = [
    { code: 'ar', label: 'العربية' },
    { code: 'en', label: 'English' },
    { code: 'ur', label: 'اردو' },
  ];

  const Icon = isNetworkError ? WifiOff : tenantStatus === 'invite_blocked' ? ShieldX : AlertCircle;

  return (
    <div
      className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#070e17] text-slate-900 dark:text-slate-100 transition-colors"
      dir={direction}
    >
      <header className="bg-white dark:bg-[#0c1829] border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#0b192c] border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
              {t('brandName')} | {t('brandSub')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setLangMenuOpen(!langMenuOpen)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Globe className="w-3.5 h-3.5 text-amber-500" />
                <span className="uppercase">{language}</span>
              </button>
              {langMenuOpen && (
                <div className="absolute end-0 mt-1.5 w-32 rounded-xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 shadow-xl py-1 z-40">
                  {languages.map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => {
                        setLanguage(l.code);
                        setLangMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-start text-xs font-medium ${
                        language === l.code
                          ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 font-bold'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => logout()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-500/30 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('navLogout')}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 sm:p-8 space-y-6">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <Icon className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {description}
              </p>
              {currentUser?.email && (
                <div className="pt-1 text-xs font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                  {currentUser.email}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-xs sm:text-sm bg-amber-400 hover:bg-amber-300 text-slate-950 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
              <span>{retrying ? t('subCheckingStatus') : t('subRetryCheck')}</span>
            </button>

            <a
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-xs sm:text-sm border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <MessageCircle className="w-4 h-4 text-amber-500" />
              <span>{t('navContact')}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-xs sm:text-sm border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>{t('navLogout')}</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};
