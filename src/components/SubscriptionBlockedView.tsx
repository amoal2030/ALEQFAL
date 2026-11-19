import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { SubscriptionPlan, SupportedLanguage } from '../types';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_WHATSAPP_LOCAL,
  buildReactivationSubscriptionWhatsApp,
  buildRenewalSubscriptionWhatsApp,
  getSubscriptionPlanLabel,
} from '../utils/subscription';
import {
  BRANCH_MONTHLY_FEE_SAR,
  ORG_REACTIVATION_FEE_SAR,
} from '../utils/branchPricing';
import {
  AlertTriangle,
  CalendarX2,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Lock,
  LogOut,
  MessageCircle,
  Moon,
  RefreshCw,
  ShieldAlert,
  Sun,
} from 'lucide-react';

export const SubscriptionBlockedView: React.FC = () => {
  const {
    currentUser,
    userProfile,
    currentOrg,
    subscriptionEvaluation,
    subscriptionBlockReason,
    logout,
    refreshTenantData,
  } = useAuth();
  const { t, language, setLanguage, direction } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const isEmployee = Boolean(userProfile && userProfile.role !== 'manager');
  const defaultPlan: SubscriptionPlan =
    subscriptionEvaluation?.plan && subscriptionEvaluation.plan !== 'trial_7d'
      ? subscriptionEvaluation.plan
      : '1m';
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>(defaultPlan);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const blockType = subscriptionBlockReason || 'expired';
  const isNoPaidBranches = blockType === 'no_paid_branches';

  const statusTitle =
    blockType === 'no_paid_branches'
      ? t('subNoPaidBranchesTitle')
      : blockType === 'suspended'
      ? t('subSuspendedTitle')
      : blockType === 'not_started'
      ? t('subNotStartedTitle')
      : t('subExpiredTitle');

  const statusDescription = isEmployee
    ? t('subBlockedDescEmployee')
    : blockType === 'no_paid_branches'
    ? t('subNoPaidBranchesDescManager')
    : blockType === 'suspended'
    ? t('subSuspendedDescManager')
    : blockType === 'not_started'
    ? t('subNotStartedDescManager')
    : t('subExpiredDescManager');

  const formatDateDisplay = (d: Date | null | undefined): string => {
    if (!d) return '—';
    return d.toISOString().slice(0, 10);
  };

  const whatsappRequest = useMemo(
    () =>
      isNoPaidBranches
        ? buildReactivationSubscriptionWhatsApp({
            orgName: currentOrg?.name || 'AL EQFAL',
            orgId: currentOrg?.id,
            managerName:
              userProfile?.displayName ||
              currentOrg?.ownerName ||
              currentUser?.displayName ||
              currentUser?.email ||
              '—',
            managerEmail: currentUser?.email || currentOrg?.ownerEmail || '—',
            reactivationFeeSar: currentOrg?.reactivationFeeSar ?? ORG_REACTIVATION_FEE_SAR,
            branchMonthlyFeeSar: currentOrg?.extraBranchMonthlyFeeSar ?? BRANCH_MONTHLY_FEE_SAR,
            language,
          })
        : buildRenewalSubscriptionWhatsApp({
            orgName: currentOrg?.name || 'AL EQFAL',
            orgId: currentOrg?.id,
            managerName:
              userProfile?.displayName ||
              currentOrg?.ownerName ||
              currentUser?.displayName ||
              currentUser?.email ||
              '—',
            managerEmail: currentUser?.email || currentOrg?.ownerEmail || '—',
            plan: selectedPlan,
            currentEndAt: currentOrg?.subscriptionEndAt,
            language,
          }),
    [
      isNoPaidBranches,
      currentOrg?.name,
      currentOrg?.id,
      currentOrg?.ownerName,
      currentOrg?.ownerEmail,
      currentOrg?.subscriptionEndAt,
      currentOrg?.reactivationFeeSar,
      currentOrg?.extraBranchMonthlyFeeSar,
      userProfile?.displayName,
      currentUser?.displayName,
      currentUser?.email,
      selectedPlan,
      language,
    ]
  );

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(whatsappRequest.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore if clipboard blocked
    }
  };

  const handleRefreshStatus = async () => {
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

  const IconComponent =
    blockType === 'suspended' || blockType === 'no_paid_branches'
      ? ShieldAlert
      : blockType === 'not_started'
      ? Clock
      : CalendarX2;

  const iconColors =
    blockType === 'suspended' || blockType === 'no_paid_branches'
      ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
      : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400';

  return (
    <div
      className="min-h-screen flex flex-col bg-[#F4F7FB] dark:bg-[#070E17] text-[#0B192C] dark:text-slate-100 transition-colors"
      dir={direction}
    >
      {/* Top Bar */}
      <header className="bg-white/95 dark:bg-[#0C1829]/95 backdrop-blur-md border-b border-slate-200/90 dark:border-slate-800 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0B192C] border border-[#1E375B] text-blue-400 flex items-center justify-center shrink-0 shadow-xs">
              <Lock className="w-4 h-4" />
            </div>
            <span className="font-extrabold text-sm sm:text-base text-[#0B192C] dark:text-white truncate">
              {t('brandName')} | {t('brandSub')}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <button
                type="button"
                onClick={() => setLangMenuOpen(!langMenuOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-xs font-semibold text-[#0B192C] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="uppercase">{language}</span>
              </button>
              {langMenuOpen && (
                <div className="absolute end-0 mt-1.5 w-32 rounded-xl bg-white dark:bg-[#0C1829] border border-slate-200 dark:border-slate-800 shadow-xl py-1 z-40">
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
                          ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 font-bold'
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
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-slate-700 transition-colors"
              aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => logout()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15 dark:hover:text-rose-400 hover:border-rose-200 dark:hover:border-rose-500/30 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('navLogout')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl bg-white dark:bg-[#0C1829] border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs p-5 sm:p-8 space-y-6">
          {/* Status Banner */}
          <div className="flex items-start gap-3.5">
            <div
              className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ${iconColors}`}
            >
              <IconComponent className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg sm:text-xl font-extrabold text-[#0B192C] dark:text-white">
                {statusTitle}
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {statusDescription}
              </p>
            </div>
          </div>

          {/* Organization Subscription Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-[#F8FAFC] dark:bg-[#0F1E33] border border-slate-200 dark:border-slate-800 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400 block mb-0.5">
                {t('subOrgNameLabel')}
              </span>
              <span className="font-extrabold text-[#0B192C] dark:text-white text-sm">
                {currentOrg?.name || '—'}
              </span>
            </div>

            <div>
              <span className="text-slate-500 dark:text-slate-400 block mb-0.5">
                {t('subPlanLabel')}
              </span>
              <span className="font-bold text-[#0B192C] dark:text-white text-sm">
                {subscriptionEvaluation?.plan
                  ? getSubscriptionPlanLabel(subscriptionEvaluation.plan, language)
                  : '—'}
              </span>
            </div>

            {blockType === 'not_started' && subscriptionEvaluation?.startDate && (
              <div>
                <span className="text-slate-500 dark:text-slate-400 block mb-0.5">
                  {t('subStartDateLabel')}
                </span>
                <span className="font-mono font-bold text-[#0B192C] dark:text-white tabular-nums" dir="ltr">
                  {formatDateDisplay(subscriptionEvaluation.startDate)}
                </span>
              </div>
            )}

            {subscriptionEvaluation?.endDate && (
              <div>
                <span className="text-slate-500 dark:text-slate-400 block mb-0.5">
                  {t('subEndDateLabel')}
                </span>
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400 tabular-nums" dir="ltr">
                  {formatDateDisplay(subscriptionEvaluation.endDate)}
                </span>
              </div>
            )}

            {isNoPaidBranches && (
              <div>
                <span className="text-slate-500 dark:text-slate-400 block mb-0.5">
                  {t('subReactivationFeeLabel')}
                </span>
                <span className="font-mono font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                  {currentOrg?.reactivationFeeSar ?? ORG_REACTIVATION_FEE_SAR} SAR
                </span>
              </div>
            )}

            {currentOrg?.subscriptionNote && (
              <div className="sm:col-span-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 block mb-0.5">
                  {t('subNoteLabel')}
                </span>
                <p className="text-slate-700 dark:text-slate-200 font-medium">
                  {currentOrg.subscriptionNote}
                </p>
              </div>
            )}
          </div>

          {/* Manager / Invited Owner Renewal or Reactivation Flow */}
          {!isEmployee ? (
            <div className="space-y-4">
              {!isNoPaidBranches && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300">
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
                          className={`p-2.5 rounded-xl border text-start transition-all ${
                            active
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 font-bold ring-1 ring-blue-600/20'
                              : 'border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-[#0F1E33] text-slate-700 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-500/40'
                          }`}
                        >
                          <div className="text-xs sm:text-sm">
                            {getSubscriptionPlanLabel(plan.id, language)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-bold text-[#0B192C] dark:text-slate-300">{t('subPreviewMessageLabel')}</span>
                  <span className="font-mono" dir="ltr">
                    +{SUBSCRIPTION_WHATSAPP_LOCAL}
                  </span>
                </div>
                <pre className="p-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0F1E33] border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {whatsappRequest.message}
                </pre>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <a
                  href={whatsappRequest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>{isNoPaidBranches ? t('subRequestReactivation') : t('subRenewNow')}</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </a>

                <button
                  type="button"
                  onClick={handleCopyMessage}
                  className="inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0B192C] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? t('subCopiedMessage') : t('subCopyMessage')}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{t('subBlockedDescEmployee')}</p>
            </div>
          )}

          {/* Refresh & Logout */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleRefreshStatus}
              disabled={checking}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm border border-blue-200 dark:border-blue-500/30 bg-blue-50/80 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-100/80 dark:hover:bg-blue-500/20 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
              <span>{checking ? t('subCheckingStatus') : t('subRefreshStatus')}</span>
            </button>

            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl font-bold text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0B192C] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
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
