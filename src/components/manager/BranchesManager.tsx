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
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-amber-500" />
            <span>إدارة فروع المؤسسة ({branches.length})</span>
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            فروع المؤسسة التابعة لـ {currentOrg?.name}، لكل منها سجل مالي وإقفالات مستقلة
          </span>
        </div>

        <a
          href={branchRequestLink.url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-amber-400 hover:bg-amber-300 transition-all inline-flex items-center gap-2 shadow-sm"
        >
          <MessageCircle className="w-4 h-4 shrink-0" />
          <span>طلب إضافة فرع جديد</span>
          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
        </a>
      </div>

      {/* 7-Day No-Paid-Branch Grace Alert */}
      {orgGraceEval.inGrace && !orgGraceEval.isLegacyExempt && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3 text-xs">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-rose-700 dark:text-rose-300">
              تنبيه مهلة 7 أيام: لا يوجد فرع مدفوع فعال حالياً
            </p>
            <p className="text-rose-700/90 dark:text-rose-200/90 leading-relaxed">
              تبقى{' '}
              <span className="font-mono font-bold tabular-nums">
                {orgGraceEval.remainingGraceDays ?? 7}
              </span>{' '}
              أيام قبل إيقاف حساب المؤسسة تلقائياً، وبعد الإيقاف تتطلب إعادة التنشيط رسوم{' '}
              <span className="font-mono font-bold tabular-nums">10 ر.س</span> بالإضافة إلى سداد فرع واحد على الأقل.
            </p>
          </div>
        </div>
      )}

      {/* Super Admin Governance & Branch Pricing Notice */}
      <div className="p-4 rounded-2xl bg-white dark:bg-[#0c1829] border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0 mt-0.5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="space-y-1 text-xs">
            <p className="font-bold text-slate-900 dark:text-white">
              اعتماد وإضافة وتجديد الفروع يتم حصراً من إدارة المنصة
            </p>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              حمايةً لتكامل الفروع وربط الاشتراكات، يقوم المدير الرئيسي للنظام فقط بإضافة أو تعليق أو تسجيل سداد الفروع.
            </p>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 pt-0.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>
                {pricingEval.isLegacyExempt
                  ? pricingEval.pricingSummary
                  : `تسعيرة كل فرع: ${BRANCH_MONTHLY_FEE_SAR} ر.س/شهرياً من أول فرع — ${pricingEval.pricingSummary}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Branches Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {branches.map((branch) => {
          const isSelected = currentBranch?.id === branch.id;
          const billing = evaluateBranchBillingAndGrace(branch, currentOrg);
          return (
            <div
              key={branch.id}
              className={`bg-white dark:bg-[#0c1829] rounded-2xl p-6 border transition-all ${
                isSelected
                  ? 'border-amber-500 shadow-lg shadow-amber-500/10'
                  : 'border-slate-200 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  {branch.code}
                </span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded ${
                    billing.isPurgedFromDb
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                      : billing.isSuspended
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {billing.isPurgedFromDb
                    ? 'منظف من القاعدة'
                    : billing.isSuspended
                    ? 'معلق'
                    : 'نشط'}
                </span>
              </div>

              <h4 className="text-base font-bold text-slate-900 dark:text-white mb-2">
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
                    <span>{branch.phone}</span>
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
                    <span className="font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {billing.monthlyFeeSar} ر.س/ش
                    </span>
                  </div>
                )}
              </div>

              {billing.isSuspended && billing.gracePeriodEndsAt && (
                <div className="mb-4 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-700 dark:text-rose-300">
                  مهلة 30 يوماً قبل التنظيف تنتهي في{' '}
                  <span className="font-mono tabular-nums" dir="ltr">
                    {billing.gracePeriodEndsAt.toISOString().slice(0, 10)}
                  </span>
                </div>
              )}

              <button
                onClick={() => setCurrentBranch(branch)}
                disabled={billing.isSuspended || billing.isPurgedFromDb}
                className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${
                  billing.isSuspended || billing.isPurgedFromDb
                    ? 'bg-slate-100 dark:bg-slate-800/60 text-slate-400 cursor-not-allowed'
                    : isSelected
                    ? 'bg-amber-500 text-slate-950 font-black cursor-default'
                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
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
