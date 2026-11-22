import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { SupportedLanguage } from '../types';
import { SUBSCRIPTION_WHATSAPP_BASE_URL } from '../utils/subscription';
import { BrandLogo } from './common/BrandLogo';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ExternalLink,
  Globe,
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
  let isArchivedNotice = false;
  let isDisabledNotice = false;
  let showAuthSucceededNotice = false;

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
        showAuthSucceededNotice = true;
        break;
      case 'account_archived':
        title = t('subAccessArchivedAccountTitle');
        description = t('subAccessArchivedAccountDesc');
        isArchivedNotice = true;
        showAuthSucceededNotice = true;
        break;
      case 'account_disabled':
        title = t('subAccessDisabledAccountTitle');
        description = t('subAccessDisabledAccount');
        isDisabledNotice = true;
        showAuthSucceededNotice = true;
        break;
      case 'membership_released':
        title = t('subAccessMembershipReleasedTitle');
        description = t('subAccessMembershipReleasedDesc');
        showAuthSucceededNotice = true;
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

  const Icon = isNetworkError
    ? WifiOff
    : isArchivedNotice
    ? Archive
    : isDisabledNotice || tenantStatus === 'invite_blocked'
    ? ShieldX
    : AlertCircle;

  const iconContainerClass = isArchivedNotice
    ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-400'
    : 'bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400';

  return (
    <div
      className="min-h-screen flex flex-col bg-[#F5F8FF] dark:bg-[#0B1B32] text-[#0B1B32] dark:text-white transition-colors"
      dir={direction}
    >
      <header className="bg-white/95 dark:bg-[#0B1B32]/95 backdrop-blur-md border-b border-[#DCE6FA] dark:border-[#1F3B66] sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BrandLogo size="sm" />
            <span className="font-extrabold text-sm sm:text-base text-[#0B1B32] dark:text-white">
              {t('brandName')} | {t('brandSub')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setLangMenuOpen(!langMenuOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#122543] text-xs font-semibold text-[#0B1B32] dark:text-slate-200 hover:border-[#1764FF]/50 transition-colors"
              >
                <Globe className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                <span className="uppercase">{language}</span>
              </button>
              {langMenuOpen && (
                <div className="absolute end-0 mt-1.5 w-32 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] shadow-xl py-1 z-40">
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
                          ? 'text-[#1764FF] dark:text-[#6CA2FF] bg-[#1764FF]/10 font-bold'
                          : 'text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#173056]'
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
              className="p-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300 hover:border-[#1764FF]/50 transition-colors"
              aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#08C99B]" />
              ) : (
                <Moon className="w-4 h-4 text-[#0B1B32]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => logout()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15 dark:hover:text-rose-400 hover:border-rose-200 dark:hover:border-rose-500/30 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('navLogout')}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl shadow-xs p-6 sm:p-8 space-y-6">
          <div className="flex items-start gap-3.5">
            <div className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ${iconContainerClass}`}>
              <Icon className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-extrabold text-[#0B1B32] dark:text-white">{title}</h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {description}
              </p>
              {showAuthSucceededNotice && (
                <div className="pt-1 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('subAccessAuthVerifiedNotice')}</span>
                </div>
              )}
              {currentUser?.email && (
                <div className="pt-1 text-xs font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                  {currentUser.email}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-[#DCE6FA] dark:border-[#1F3B66]">
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm bg-[#1764FF] hover:bg-[#1052D8] text-white shadow-xs transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
              <span>{retrying ? t('subCheckingStatus') : t('subRetryCheck')}</span>
            </button>

            <a
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#0E203A] text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#173056] transition-colors"
            >
              <MessageCircle className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
              <span>{t('navContact')}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-700 dark:text-slate-200 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15 dark:hover:text-rose-400 transition-colors"
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
