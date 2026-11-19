import React, { useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  BRANCH_MONTHLY_FEE_SAR,
  buildExtraBranchRequestWhatsApp,
  evaluateBranchBillingAndGrace,
  evaluateOrgNoPaidBranchGrace,
  evaluateOrganizationBranchPricing,
} from '../../utils/branchPricing';
import {
  AlertBanner,
  BTN_PRIMARY,
  BTN_SECONDARY,
  PageHeader,
  StatusBadge,
} from '../common/UiPrimitives';
import {
  GitBranch,
  MapPin,
  Phone,
  ShieldCheck,
  MessageCircle,
  ExternalLink,
  Info,
  AlertTriangle,
  Calendar,
} from 'lucide-react';

export const BranchesManager: React.FC = () => {
  const { currentOrg, currentUser, userProfile, branches, currentBranch, setCurrentBranch } = useAuth();
  const { language } = useLanguage();

  const pricingEval = useMemo(
    () =>
      evaluateOrganizationBranchPricing({
        org: currentOrg,
        branches,
      }),
    [currentOrg, branches]
  );

  const orgGraceEval = useMemo(
    () => evaluateOrgNoPaidBranchGrace(currentOrg, branches),
    [currentOrg, branches]
  );

  const branchRequestLink = useMemo(
    () =>
      buildExtraBranchRequestWhatsApp({
        orgName: currentOrg?.name || 'AL EQFAL',
        orgId: currentOrg?.id || '',
        managerName: userProfile?.displayName || currentOrg?.ownerName || 'المدير العام',
        managerEmail: currentUser?.email || currentOrg?.ownerEmail || '',
        currentBranchCount: branches.length,
        isLegacyExempt: pricingEval.isLegacyExempt,
        language,
      }),
    [
      currentOrg?.name,
      currentOrg?.id,
      currentOrg?.ownerName,
      currentOrg?.ownerEmail,
      userProfile?.displayName,
      currentUser?.email,
      branches.length,
      pricingEval.isLegacyExempt,
      language,
    ]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`إدارة فروع المؤسسة (${branches.length})`}
        subtitle={`فروع المؤسسة التابعة لـ ${currentOrg?.name || ''}، لكل منها سجل مالي وإقفالات مستقلة`}
        icon={<GitBranch className="w-5 h-5" />}
        actions={
          <a
            href={branchRequestLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className={BTN_PRIMARY}
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            <span>طلب إضافة فرع جديد</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          </a>
        }
      />

      {/* 7-Day No-Paid-Branch Grace Alert */}
      {orgGraceEval.inGrace && !orgGraceEval.isLegacyExempt && (
        <AlertBanner
          variant="error"
          icon={<AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
          title="تنبيه مهلة 7 أيام: لا يوجد فرع مدفوع فعال حالياً"
        >
          تبقى{' '}
          <span className="font-mono-num font-bold">{orgGraceEval.remainingGraceDays ?? 7}</span>{' '}
          أيام قبل إيقاف حساب المؤسسة تلقائياً، وبعد الإيقاف تتطلب إعادة التنشيط رسوم{' '}
          <span className="font-mono-num font-bold">10 ر.س</span> بالإضافة إلى سداد فرع واحد على الأقل.
        </AlertBanner>
      )}

      {/* Super Admin Governance & Branch Pricing Notice */}
      <AlertBanner
        variant="info"
        icon={<ShieldCheck className="w-5 h-5 text-blue-700 dark:text-blue-300" />}
        title="اعتماد وإضافة وتجديد الفروع يتم حصراً من إدارة المنصة"
      >
        <p className="leading-relaxed">
          حمايةً لتكامل الفروع وربط الاشتراكات، يقوم المدير الرئيسي للنظام فقط بإضافة أو تعليق أو تسجيل سداد الفروع.
        </p>
        <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-800 dark:text-blue-200 pt-1">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>
            {pricingEval.isLegacyExempt
              ? pricingEval.pricingSummary
              : `تسعيرة كل فرع: ${BRANCH_MONTHLY_FEE_SAR} ر.س/شهرياً من أول فرع — ${pricingEval.pricingSummary}`}
          </span>
        </div>
      </AlertBanner>

      {/* Branches Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {branches.map((branch) => {
          const isSelected = currentBranch?.id === branch.id;
          const billing = evaluateBranchBillingAndGrace(branch, currentOrg);
          return (
            <div
              key={branch.id}
              className={`bg-white dark:bg-[#0C1829] rounded-2xl p-6 border transition-all shadow-xs ${
                isSelected
                  ? 'border-blue-600 ring-2 ring-blue-600/15'
                  : 'border-slate-200/90 dark:border-slate-800 hover:border-blue-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-[#0B192C] text-white border border-[#1E375B]">
                  {branch.code}
                </span>
                <StatusBadge
                  variant={
                    billing.isPurgedFromDb
                      ? 'neutral'
                      : billing.isSuspended
                      ? 'danger'
                      : 'success'
                  }
                >
                  {billing.isPurgedFromDb
                    ? 'منظف من القاعدة'
                    : billing.isSuspended
                    ? 'معلق'
                    : 'نشط'}
                </StatusBadge>
              </div>

              <h4 className="text-base font-extrabold text-[#0B192C] dark:text-white mb-2">
                {branch.name}
              </h4>

              <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400 mb-4">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{branch.address || 'العنوان غير مسجل'}</span>
                </div>
                {branch.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span dir="ltr">{branch.phone}</span>
                  </div>
                )}
                {!pricingEval.isLegacyExempt && (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px]">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {billing.feeDueAt
                          ? `الاستحقاق: ${billing.feeDueAt.toISOString().slice(0, 10)}`
                          : 'الاستحقاق: —'}
                      </span>
                    </span>
                    <span className="font-mono-num font-bold text-blue-700 dark:text-blue-300">
                      {billing.monthlyFeeSar} ر.س/ش
                    </span>
                  </div>
                )}
              </div>

              {billing.isSuspended && billing.gracePeriodEndsAt && (
                <div className="mb-4 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-[11px] text-rose-700 dark:text-rose-300">
                  مهلة 30 يوماً قبل التنظيف تنتهي في{' '}
                  <span className="font-mono-num font-bold" dir="ltr">
                    {billing.gracePeriodEndsAt.toISOString().slice(0, 10)}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={() => setCurrentBranch(branch)}
                disabled={billing.isSuspended || billing.isPurgedFromDb}
                className={
                  billing.isSuspended || billing.isPurgedFromDb
                    ? 'w-full py-2.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800/60 text-slate-400 cursor-not-allowed'
                    : isSelected
                    ? `${BTN_PRIMARY} w-full cursor-default`
                    : `${BTN_SECONDARY} w-full`
                }
              >
                {billing.isSuspended || billing.isPurgedFromDb
                  ? 'الفرع موقوف حالياً'
                  : isSelected
                  ? 'الفرع المحدد حالياً'
                  : 'تحديد هذا الفرع للتقارير'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
