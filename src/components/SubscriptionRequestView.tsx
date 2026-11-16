import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { SubscriptionPlan, SupportedLanguage } from '../types';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_WHATSAPP_LOCAL,
  buildNewSubscriptionWhatsApp,
  getSubscriptionPlanLabel,
} from '../utils/subscription';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Lock,
  LogOut,
  Mail,
  MessageCircle,
  Moon,
  RefreshCw,
  Sun,
  User,
} from 'lucide-react';

export const SubscriptionRequestView: React.FC = () => {
  const { currentUser, logout, refreshTenantData } = useAuth();
  const { t, language, setLanguage, direction } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const googleEmail = (currentUser?.email || '').trim();
  const [ownerName, setOwnerName] = useState<string>(() => (currentUser?.displayName || '').trim());
  const [orgName, setOrgName] = useState<string>('');
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>('1m');
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const isFormComplete = ownerName.trim().length >= 2 && orgName.trim().length >= 2;

  const whatsapp = useMemo(
    () =>
      buildNewSubscriptionWhatsApp({
        ownerName: ownerName.trim() || '—',
        googleEmail: googleEmail || '—',
        orgName: orgName.trim() || '—',
        plan: selectedPlan,
        language,
      }),
    [ownerName, googleEmail, orgName, selectedPlan, language]
  );

  const handleCopyMessage = async () => {
    if (!isFormComplete) return;
    try {
      await navigator.clipboard.writeText(whatsapp.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API may be blocked in restricted contexts
    }
  };

  const handleCheckActivation = async () => {
    setChecking(true);
    try {
      await refreshTenantData();
    } finally {
      setChecking(false);
    }
  };

  const languages: { code: SupportedLanguage; label: string }[] = [
    { code: 'ar', label: 'العربية' },
    { code: 'en', label: 'English' },
    { code: 'ur', label: 'اردو' },
  ];

  return (
    <div
      className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#070e17] text-slate-900 dark:text-slate-100 transition-colors"
      dir={direction}
    >
      {/* Top Bar */}
      <header className="bg-white dark:bg-[#0c1829] border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0b192c] border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate block">
                {t('brandName')} | {t('brandSub')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-5 sm:p-8 space-y-6">
          {/* Header */}
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                {t('subReqTitle')}
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {t('subReqSubtitle')}
              </p>
            </div>
          </div>

          {/* Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Read-only Google Email */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t('subReqGoogleEmail')}
              </label>
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 text-sm text-slate-800 dark:text-slate-200">
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-mono text-xs sm:text-sm truncate select-all" dir="ltr">
                    {googleEmail}
                  </span>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              </div>
            </div>

            {/* Owner Name */}
            <div>
              <label
                htmlFor="sub-req-owner-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('subReqOwnerName')}
              </label>
              <div className="relative">
                <input
                  id="sub-req-owner-name"
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  maxLength={100}
                  placeholder={t('subReqOwnerNamePlaceholder')}
                  className="w-full ps-9 pe-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                />
                <User className="w-4 h-4 text-slate-400 absolute start-3 top-3" />
              </div>
            </div>

            {/* Organization Name */}
            <div>
              <label
                htmlFor="sub-req-org-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t('subReqOrgName')}
              </label>
              <div className="relative">
                <input
                  id="sub-req-org-name"
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  maxLength={120}
                  placeholder={t('subReqOrgNamePlaceholder')}
                  className="w-full ps-9 pe-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                />
                <Building2 className="w-4 h-4 text-slate-400 absolute start-3 top-3" />
              </div>
            </div>
          </div>

          {/* 5 Subscription Plans */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t('subSelectDuration')}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {SUBSCRIPTION_PLANS.map((plan) => {
                const active = selectedPlan === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`p-3 rounded-xl border text-start transition-all ${
                      active
                        ? 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] text-slate-700 dark:text-slate-300 hover:border-amber-500/40'
                    }`}
                  >
                    <div className="text-xs sm:text-sm leading-snug">
                      {getSubscriptionPlanLabel(plan.id, language)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview Box */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold">{t('subPreviewMessageLabel')}</span>
              <span className="font-mono" dir="ltr">
                +{SUBSCRIPTION_WHATSAPP_LOCAL}
              </span>
            </div>
            <pre className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
              {whatsapp.message}
            </pre>
            {!isFormComplete && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {t('subReqMissingFields')}
              </p>
            )}
          </div>

          {/* Primary & Secondary Actions */}
          <div className="space-y-3 pt-1">
            <div className="flex flex-col sm:flex-row gap-2.5">
              {isFormComplete ? (
                <a
                  href={whatsapp.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm text-slate-950 bg-amber-400 hover:bg-amber-300 transition-all shadow-sm"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>{t('subSubscribeNow')}</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm text-slate-500 bg-slate-200 dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>{t('subSubscribeNow')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyMessage}
                disabled={!isFormComplete}
                className="inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-xs sm:text-sm border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? t('subCopiedMessage') : t('subCopyMessage')}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleCheckActivation}
              disabled={checking}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-xs sm:text-sm border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
              <span>{checking ? t('subCheckingStatus') : t('subCheckActivation')}</span>
            </button>

            <p className="text-[11px] text-center text-slate-500 dark:text-slate-400">
              {t('subReqWhatsAppHint')}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};
