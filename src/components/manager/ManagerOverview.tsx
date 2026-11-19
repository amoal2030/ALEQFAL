import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { formatCurrency } from '../../utils/accounting';
import { ManagerDashboardTab } from '../../utils/notifications';
import { FinancialCharts } from '../common/Charts';
import { KpiStatCard, SELECT_CLASS, BTN_PRIMARY } from '../common/UiPrimitives';
import {
  Coins,
  CreditCard,
  ShoppingBag,
  TrendingUp,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  RotateCcw,
  Wallet,
  Banknote,
  BarChart3,
  Truck,
  FileText,
  GitBranch,
  Users,
  ShieldCheck,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react';

interface ManagerOverviewProps {
  onNavigateTab: (tab: ManagerDashboardTab) => void;
}

export const ManagerOverview: React.FC<ManagerOverviewProps> = ({ onNavigateTab }) => {
  const { closings, branches, employees, currentOrg, userProfile, driveReadiness } = useAuth();
  const { tr, language } = useLanguage();

  const [filterBranchId, setFilterBranchId] = useState<string>('all');

  const activeClosings = closings.filter((c) => {
    if (filterBranchId !== 'all' && c.branchId !== filterBranchId) return false;
    return true;
  });

  const totalSales = activeClosings.reduce((sum, c) => sum + c.totalSales, 0);
  const totalCash = activeClosings.reduce((sum, c) => sum + c.cashSales, 0);
  const totalCard = activeClosings.reduce((sum, c) => sum + c.cardSales, 0);
  const totalExpenses = activeClosings.reduce((sum, c) => sum + c.expenses, 0);
  const totalRemainingInBox = activeClosings.reduce((sum, c) => sum + c.remainingInBox, 0);
  const totalNetPeriod = activeClosings.reduce((sum, c) => sum + c.netPeriod, 0);

  const pendingCount = activeClosings.filter((c) => c.status === 'pending_review').length;
  const approvedCount = activeClosings.filter((c) => c.status === 'approved').length;
  const rejectedCount = activeClosings.filter((c) => c.status === 'rejected').length;

  const currency = currentOrg?.currency || 'SAR';
  const approvalRate =
    activeClosings.length > 0 ? Math.round((approvedCount / activeClosings.length) * 100) : 100;

  const quickActions: Array<{
    tab: ManagerDashboardTab;
    label: string;
    desc: string;
    icon: React.ReactNode;
    accent: string;
  }> = [
    {
      tab: 'closings',
      label: tr('مراجعة الإقفالات', 'Closings Review', 'کلوزنگز کا جائزہ'),
      desc: tr('فحص واعتماد ورديات الفروع', 'Review & approve branch shifts', 'برانچ شفٹس کی جانچ اور منظوری'),
      icon: <FileSpreadsheet className="w-5 h-5" />,
      accent: 'bg-[#1764FF]/10 text-[#1764FF] dark:text-[#6CA2FF] border-[#1764FF]/20',
    },
    {
      tab: 'purchase_reports',
      label: tr('تقارير المشتريات', 'Purchase Reports', 'خریداری رپورٹس'),
      desc: tr('تحليل فواتير الموردين والضرائب', 'Supplier invoices, VAT & exports', 'سپلائر انوائسز، ٹیکس اور ایکسپورٹ'),
      icon: <BarChart3 className="w-5 h-5" />,
      accent: 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] border-[#08C99B]/25',
    },
    {
      tab: 'reports',
      label: tr('التقارير المالية', 'Financial Reports', 'مالیاتی رپورٹس'),
      desc: tr('كشوفات الإقفال والتصدير الرسمي', 'Official statements & Excel/PDF', 'سرکاری بیان اور ایکسل/پی ڈی ایف'),
      icon: <FileText className="w-5 h-5" />,
      accent: 'bg-[#1764FF]/10 text-[#1764FF] dark:text-[#6CA2FF] border-[#1764FF]/20',
    },
    {
      tab: 'suppliers',
      label: tr('إدارة الموردين', 'Suppliers', 'سپلائرز کا انتظام'),
      desc: tr('سجل الموردين المعتمدين بالمنشأة', 'Approved supplier directory', 'منظور شدہ سپلائرز کی فہرست'),
      icon: <Truck className="w-5 h-5" />,
      accent: 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] border-[#08C99B]/25',
    },
    {
      tab: 'branches',
      label: tr('إدارة الفروع', 'Branches', 'برانچز کا انتظام'),
      desc: tr('حالة الفروع والاشتراكات النشطة', 'Branch status & active billing', 'برانچ کی حیثیت اور سبسکرپشن'),
      icon: <GitBranch className="w-5 h-5" />,
      accent: 'bg-[#1764FF]/10 text-[#1764FF] dark:text-[#6CA2FF] border-[#1764FF]/20',
    },
    {
      tab: 'employees',
      label: tr('إدارة الموظفين', 'Team & Roles', 'ملازمین اور اختیارات'),
      desc: tr('الأدوار والصلاحيات وربط الفروع', 'Roles, permissions & branches', 'کردار، اختیارات اور برانچ لنکنگ'),
      icon: <Users className="w-5 h-5" />,
      accent: 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] border-[#08C99B]/25',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Executive Welcome Hero Strip (Inspired by Visual Reference) */}
      <section className="relative overflow-hidden rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-gradient-to-br from-white via-[#F5F8FF] to-[#EAF1FF] dark:from-[#122543] dark:via-[#0E203A] dark:to-[#0B1B32] p-5 sm:p-6 shadow-xs">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -end-16 w-64 h-64 rounded-full bg-[#1764FF]/10 dark:bg-[#1764FF]/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 -start-12 w-56 h-56 rounded-full bg-[#08C99B]/12 dark:bg-[#08C99B]/12 blur-3xl"
        />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-bold text-[#1764FF] dark:text-[#6CA2FF]">
              <TrendingUp className="w-4 h-4 shrink-0" />
              <span>
                {tr(
                  'مؤشرات الأداء المالي والإقفالات',
                  'Financial Performance & Shift Closings',
                  'مالیاتی کارکردگی اور شفٹ کلوزنگز'
                )}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white tracking-tight">
              {tr('مرحباً،', 'Welcome,', 'خوش آمدید،')}{' '}
              <span className="text-[#1764FF] dark:text-[#6CA2FF]">
                {userProfile?.displayName || currentOrg?.name}
              </span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-2xl">
              {tr(
                'ملخص فوري لجميع صناديق الفروع والمبيعات والمصروفات مع متابعة مباشرة لحالة الاعتمادات.',
                'Real-time overview of all branch cash drawers, sales, expenses, and shift approval status.',
                'تمام برانچز کے کیش باکسز، فروخت، اخراجات اور منظوریوں کا فوری جائزہ۔'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <select
              value={filterBranchId}
              onChange={(e) => setFilterBranchId(e.target.value)}
              aria-label={tr('تصفية حسب الفرع', 'Filter by branch', 'برانچ کے لحاظ سے فلٹر کریں')}
              className={`${SELECT_CLASS} sm:w-56 font-bold text-xs bg-white/90 dark:bg-[#0B1B32]/90`}
            >
              <option value="all">
                {tr(`جميع الفروع (${branches.length})`, `All Branches (${branches.length})`, `تمام برانچز (${branches.length})`)}
              </option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 10 Required KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <KpiStatCard
          label={tr('إجمالي المبيعات', 'Total Sales', 'کل فروخت')}
          value={
            <span className="font-mono-num text-base sm:text-xl">
              {formatCurrency(totalSales, currency, language)}
            </span>
          }
          sublabel={tr('نقد + شبكة', 'Cash + Card', 'نقد + کارڈ')}
          icon={<TrendingUp className="w-4 h-4" />}
          tone="navy"
        />

        <KpiStatCard
          label={tr('إجمالي النقد (كاش)', 'Total Cash', 'کل نقد (کیش)')}
          value={
            <span className="font-mono-num text-base sm:text-xl text-[#1764FF] dark:text-[#6CA2FF]">
              {formatCurrency(totalCash, currency, language)}
            </span>
          }
          sublabel={tr('السيولة المستلمة', 'Collected cash', 'وصول شدہ نقد')}
          icon={<Coins className="w-4 h-4" />}
          tone="blue"
        />

        <KpiStatCard
          label={tr('إجمالي الشبكة (مدى)', 'Total Card / POS', 'کل کارڈ / نیٹ ورک')}
          value={
            <span className="font-mono-num text-base sm:text-xl text-[#048264] dark:text-[#08C99B]">
              {formatCurrency(totalCard, currency, language)}
            </span>
          }
          sublabel={tr('مدفوعات نقاط البيع', 'POS card payments', 'POS کارڈ ادائیگیاں')}
          icon={<CreditCard className="w-4 h-4" />}
          tone="emerald"
        />

        <KpiStatCard
          label={tr('إجمالي المصروفات', 'Drawer Expenses', 'کل اخراجات')}
          value={
            <span className="font-mono-num text-base sm:text-xl text-rose-600 dark:text-rose-400">
              {formatCurrency(totalExpenses, currency, language)}
            </span>
          }
          sublabel={tr('مصروفات الصناديق', 'Cash drawer outflows', 'کیش باکس اخراجات')}
          icon={<ShoppingBag className="w-4 h-4" />}
          tone="rose"
        />

        <KpiStatCard
          label={tr('الكاش المتبقي بالصندوق', 'Cash in Drawer', 'باقی نقد باکس میں')}
          value={
            <span className="font-mono-num text-base sm:text-xl text-[#1764FF] dark:text-[#6CA2FF]">
              {formatCurrency(totalRemainingInBox, currency, language)}
            </span>
          }
          sublabel={tr('النقد - المشتريات', 'Cash - Expenses', 'نقد - اخراجات')}
          icon={<Wallet className="w-4 h-4" />}
          tone="blue"
        />

        <KpiStatCard
          label={tr('صافي المبيعات', 'Net Period', 'خالص فروخت')}
          value={
            <span className="font-mono-num text-base sm:text-xl text-[#048264] dark:text-[#08C99B]">
              {formatCurrency(totalNetPeriod, currency, language)}
            </span>
          }
          sublabel={tr('المبيعات - المشتريات', 'Sales - Expenses', 'فروخت - اخراجات')}
          icon={<Banknote className="w-4 h-4" />}
          tone="emerald"
        />

        <KpiStatCard
          label={tr('عدد الإقفالات', 'Total Closings', 'کل کلوزنگز')}
          value={<span className="font-mono-num text-base sm:text-xl">{activeClosings.length}</span>}
          sublabel={tr('جميع الورديات', 'All shifts', 'تمام شفٹس')}
          icon={<FileSpreadsheet className="w-4 h-4" />}
          tone="navy"
        />

        <button
          type="button"
          onClick={() => onNavigateTab('closings')}
          className="text-start bg-white dark:bg-[#122543] rounded-2xl border border-amber-300 dark:border-amber-500/40 p-4 sm:p-5 shadow-xs hover:border-[#1764FF] transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300 truncate">
                {tr('معلق للمراجعة', 'Pending Review', 'زیر التواء جائزہ')}
              </p>
              <div className="text-base sm:text-xl font-extrabold text-amber-700 dark:text-amber-300 mt-1.5 font-mono-num">
                {pendingCount}
              </div>
              <div className="text-[11px] font-bold text-[#1764FF] dark:text-[#6CA2FF] mt-1 underline">
                {tr('فحص واعتماد الآن ←', 'Review & approve →', 'ابھی جانچیں اور منظور کریں ←')}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
          </div>
        </button>

        <KpiStatCard
          label={tr('إقفالات معتمدة', 'Approved Closings', 'منظور شدہ کلوزنگز')}
          value={
            <span className="font-mono-num text-base sm:text-xl text-[#048264] dark:text-[#08C99B]">
              {approvedCount}
            </span>
          }
          sublabel={tr('مقفلة رسمياً', 'Officially locked', 'سرکاری طور پر مقفل')}
          icon={<CheckCircle2 className="w-4 h-4" />}
          tone="emerald"
        />

        <KpiStatCard
          label={tr('معاد للتعديل', 'Returned for Edit', 'ترمیم کے لیے واپس')}
          value={
            <span className="font-mono-num text-base sm:text-xl text-rose-600 dark:text-rose-400">
              {rejectedCount}
            </span>
          }
          sublabel={tr('بانتظار تصحيح الموظف', 'Awaiting staff edit', 'ملازم کی تصحیح کا منتظر')}
          icon={<RotateCcw className="w-4 h-4" />}
          tone="rose"
        />
      </div>

      {/* Visual Charts */}
      <FinancialCharts
        closings={activeClosings}
        currency={currency}
        language={language}
      />

      {/* Bottom Row: Quick Access Grid + Operational Readiness Card (Reference Inspired) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8 bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
            <div>
              <h3 className="text-sm font-extrabold text-[#0B1B32] dark:text-white">
                {tr('الوصول السريع', 'Quick Access', 'فوری رسائی')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  'انتقل مباشرة إلى الأقسام التشغيلية والمالية الأساسية',
                  'Jump straight into core operational and financial sections',
                  'بنیادی آپریشنل اور مالیاتی حصوں تک براہ راست رسائی'
                )}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {quickActions.map((item) => (
              <button
                key={item.tab}
                type="button"
                onClick={() => onNavigateTab(item.tab)}
                className="group text-start p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF] dark:hover:border-[#6CA2FF] transition-all flex items-start gap-3"
              >
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${item.accent}`}>
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-extrabold text-[#0B1B32] dark:text-white group-hover:text-[#1764FF] dark:group-hover:text-[#6CA2FF] truncate transition-colors">
                      {item.label}
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#1764FF] shrink-0 transition-colors" />
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                    {item.desc}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* System Status & Quick Operational Stats */}
        <div className="lg:col-span-4 bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 shadow-xs flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="pb-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
              <h3 className="text-sm font-extrabold text-[#0B1B32] dark:text-white">
                {tr('حالة المنظومة والإحصائيات', 'System Status & Snapshot', 'سسٹم کی حیثیت اور خلاصہ')}
              </h3>
            </div>

            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  driveReadiness.isReady
                    ? 'bg-[#08C99B]/15 text-[#048264] dark:text-[#08C99B]'
                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                }`}
              >
                {driveReadiness.isReady ? (
                  <ShieldCheck className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-[#0B1B32] dark:text-white">
                  {driveReadiness.isReady
                    ? tr('الأرشفة السحابية جاهزة', 'Cloud Archive Verified', 'کلاؤڈ آرکائیو تصدیق شدہ')
                    : tr('يتطلب ربط Google Drive', 'Google Drive Setup Required', 'Google Drive منسلک کرنا ضروری ہے')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {driveReadiness.isReady
                    ? tr('جميع الفروع مرتبطة ومستعدة للتشغيل', 'All branches synced & verified', 'تمام برانچز منسلک اور تیار ہیں')
                    : tr('أكمل الربط من صفحة الإعدادات', 'Complete setup in Settings', 'سیٹنگز سے کنکشن مکمل کریں')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
                  {tr('الفروع', 'Branches', 'برانچز')}
                </span>
                <span className="text-lg font-extrabold font-mono-num text-[#1764FF] dark:text-[#6CA2FF]">
                  {branches.length}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
                  {tr('الموظفون', 'Staff', 'ملازمین')}
                </span>
                <span className="text-lg font-extrabold font-mono-num text-[#0B1B32] dark:text-white">
                  {employees.length}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[#08C99B]/10 border border-[#08C99B]/25">
                <span className="text-[10px] font-bold text-[#048264] dark:text-[#08C99B] block">
                  {tr('نسبة الاعتماد', 'Approval', 'منظوری شرح')}
                </span>
                <span className="text-lg font-extrabold font-mono-num text-[#048264] dark:text-[#08C99B]">
                  {approvalRate}%
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab(pendingCount > 0 ? 'closings' : 'reports')}
            className={`${BTN_PRIMARY} w-full`}
          >
            {pendingCount > 0
              ? tr(`مراجعة ${pendingCount} إقفال معلق`, `Review ${pendingCount} Pending`, `${pendingCount} زیر التواء کا جائزہ لیں`)
              : tr('فتح التقارير المالية', 'Open Financial Reports', 'مالیاتی رپورٹس کھولیں')}
          </button>
        </div>
      </div>

      {/* Pending Reviews Alert Banner */}
      {pendingCount > 0 && (
        <div className="p-5 rounded-2xl bg-[#0B1B32] text-white border border-[#1F3B66] flex flex-wrap items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1764FF]/25 border border-[#1764FF]/40 text-[#6CA2FF] flex items-center justify-center font-bold shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold">
                {tr(
                  `لديك ${pendingCount} إقفال وردية بانتظار المراجعة والاعتماد`,
                  `You have ${pendingCount} shift closing(s) awaiting review and approval`,
                  `آپ کے پاس ${pendingCount} شفٹ کلوزنگز جائزے اور منظوری کی منتظر ہیں`
                )}
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                {tr(
                  'قام الموظفون برفع مبيعات النقد والشبكة والمرفقات؛ يمكنك اعتمادها الآن لإدراجها في الكشوفات الرسمية.',
                  'Staff have submitted cash, card sales, and notes; approve them now to include them in official reports.',
                  'ملازمین نے نقد اور کارڈ فروخت جمع کروا دی ہے؛ سرکاری رپورٹس میں شامل کرنے کے لیے ابھی منظور کریں۔'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('closings')}
            className={BTN_PRIMARY}
          >
            {tr('الانتقال لجدول الإقفالات', 'Go to Closings Table', 'کلوزنگز ٹیبل پر جائیں')}
          </button>
        </div>
      )}
    </div>
  );
};
