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
  const { language, tr } = useLanguage();

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
        managerName:
          userProfile?.displayName ||
          currentOrg?.ownerName ||
          tr('المدير العام', 'General Manager', 'جنرل منیجر'),
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
      tr,
    ]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr(
          `إدارة فروع المؤسسة (${branches.length})`,
          `Organization Branches (${branches.length})`,
          `ادارے کی برانچز کا انتظام (${branches.length})`
        )}
        subtitle={tr(
          `فروع المؤسسة التابعة لـ ${currentOrg?.name || ''}، لكل منها سجل مالي وإقفالات مستقلة`,
          `Branches under ${currentOrg?.name || ''}, each with independent financial records and shift closings`,
          `${currentOrg?.name || ''} کی تمام برانچز، ہر ایک کے اپنے مالی ریکارڈز اور شفٹ کلوزنگز کے ساتھ`
        )}
        icon={<GitBranch className="w-5 h-5" />}
        actions={
          <a
            href={branchRequestLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className={BTN_PRIMARY}
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            <span>{tr('طلب إضافة فرع جديد', 'Request New Branch', 'نئی برانچ کی درخواست کریں')}</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          </a>
        }
      />

      {/* 7-Day No-Paid-Branch Grace Alert */}
      {orgGraceEval.inGrace && !orgGraceEval.isLegacyExempt && (
        <AlertBanner
          variant="error"
          icon={<AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
          title={tr(
            'تنبيه مهلة 7 أيام: لا يوجد فرع مدفوع فعال حالياً',
            '7-Day Grace Notice: No Active Paid Branch Currently',
            '7 دن کی مہلت کا انتباہ: اس وقت کوئی فعال ادا شدہ برانچ موجود نہیں'
          )}
        >
          {tr('تبقى', 'Remaining:', 'باقی')}{' '}
          <span className="font-mono-num font-bold">{orgGraceEval.remainingGraceDays ?? 7}</span>{' '}
          {tr(
            'أيام قبل إيقاف حساب المؤسسة تلقائياً، وبعد الإيقاف تتطلب إعادة التنشيط رسوم',
            'day(s) before automatic account suspension. Reactivation afterward requires a fee of',
            'دن باقی ہیں، اس کے بعد اکاؤنٹ معطل ہو جائے گا اور دوبارہ فعال کرنے کے لیے فیس ہوگی'
          )}{' '}
          <span className="font-mono-num font-bold">
            {tr('10 ر.س', '10 SAR', '10 ریال')}
          </span>{' '}
          {tr(
            'بالإضافة إلى سداد فرع واحد على الأقل.',
            'plus settlement of at least one branch.',
            'اور کم از کم ایک برانچ کی ادائیگی لازمی ہوگی۔'
          )}
        </AlertBanner>
      )}

      {/* Super Admin Governance & Branch Pricing Notice */}
      <AlertBanner
        variant="info"
        icon={<ShieldCheck className="w-5 h-5 text-[#1764FF] dark:text-[#6CA2FF]" />}
        title={tr(
          'اعتماد وإضافة وتجديد الفروع يتم حصراً من إدارة المنصة',
          'Branch Approval, Creation & Renewal Are Managed Exclusively by Platform Administration',
          'برانچز کی منظوری، اضافہ اور تجدید صرف پلیٹ فارم انتظامیہ کرتی ہے'
        )}
      >
        <p className="leading-relaxed">
          {tr(
            'حمايةً لتكامل الفروع وربط الاشتراكات، يقوم المدير الرئيسي للنظام فقط بإضافة أو تعليق أو تسجيل سداد الفروع.',
            'To protect tenant integrity and subscription billing, only the Platform Super Admin adds, suspends, or records branch payments.',
            'برانچز کی سالمیت اور سبسکرپشن کے تحفظ کے لیے صرف سپر ایڈمن برانچ شامل، معطل یا ادائیگی درج کرتا ہے۔'
          )}
        </p>
        <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#1764FF] dark:text-[#6CA2FF] pt-1">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>
            {pricingEval.isLegacyExempt
              ? pricingEval.pricingSummary
              : tr(
                  `تسعيرة كل فرع: ${BRANCH_MONTHLY_FEE_SAR} ر.س/شهرياً من أول فرع — ${pricingEval.pricingSummary}`,
                  `Branch rate: ${BRANCH_MONTHLY_FEE_SAR} SAR/month starting from the first branch`,
                  `ہر برانچ کا ماہانہ کرایہ: ${BRANCH_MONTHLY_FEE_SAR} ریال پہلی برانچ سے`
                )}
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
              className={`bg-white dark:bg-[#122543] rounded-2xl p-6 border transition-all shadow-xs ${
                isSelected
                  ? 'border-[#1764FF] ring-2 ring-[#1764FF]/15'
                  : 'border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF]/50'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-[#0B1B32] text-white border border-[#1F3B66]">
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
                    ? tr('منظف من القاعدة', 'Purged from DB', 'ڈیٹا بیس سے صاف')
                    : billing.isSuspended
                    ? tr('معلق', 'Suspended', 'معطل')
                    : tr('نشط', 'Active', 'فعال')}
                </StatusBadge>
              </div>

              <h4 className="text-base font-extrabold text-[#0B1B32] dark:text-white mb-2">
                {branch.name}
              </h4>

              <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400 mb-4">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">
                    {branch.address || tr('العنوان غير مسجل', 'Address not recorded', 'پتہ درج نہیں')}
                  </span>
                </div>
                {branch.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span dir="ltr">{branch.phone}</span>
                  </div>
                )}
                {!pricingEval.isLegacyExempt && (
                  <div className="flex items-center justify-between pt-2 border-t border-[#E6EEFC] dark:border-[#1F3B66] text-[11px]">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {billing.feeDueAt
                          ? `${tr('الاستحقاق:', 'Due:', 'آخری تاریخ:')} ${billing.feeDueAt.toISOString().slice(0, 10)}`
                          : `${tr('الاستحقاق:', 'Due:', 'آخری تاریخ:')} —`}
                      </span>
                    </span>
                    <span className="font-mono-num font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                      {billing.monthlyFeeSar} {tr('ر.س/ش', 'SAR/mo', 'ریال/ماہ')}
                    </span>
                  </div>
                )}
              </div>

              {billing.isSuspended && billing.gracePeriodEndsAt && (
                <div className="mb-4 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-[11px] text-rose-700 dark:text-rose-300">
                  {tr(
                    'مهلة 30 يوماً قبل التنظيف تنتهي في',
                    '30-day retention grace ends on',
                    'ڈیٹا صفائی سے قبل 30 دن کی مہلت ختم ہوگی'
                  )}{' '}
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
                    ? 'w-full py-2.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-[#0E203A] text-slate-400 cursor-not-allowed'
                    : isSelected
                    ? `${BTN_PRIMARY} w-full cursor-default`
                    : `${BTN_SECONDARY} w-full`
                }
              >
                {billing.isSuspended || billing.isPurgedFromDb
                  ? tr('الفرع موقوف حالياً', 'Branch Currently Suspended', 'برانچ فی الحال معطل ہے')
                  : isSelected
                  ? tr('الفرع المحدد حالياً', 'Currently Selected Branch', 'فی الحال منتخب برانچ')
                  : tr('تحديد هذا الفرع للتقارير', 'Select Branch for Reports', 'رپورٹس کے لیے یہ برانچ منتخب کریں')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
