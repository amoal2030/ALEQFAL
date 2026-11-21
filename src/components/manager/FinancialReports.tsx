import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { resolveEffectivePermissions } from '../../utils/permissions';
import { SupportedLanguage } from '../../types';
import {
  formatCurrency,
  exportClosingsToCSV,
} from '../../utils/accounting';
import {
  generateClosingsSummaryExcel,
  downloadXlsxBytes,
} from '../../services/excelReportService';
import {
  BadgeVariant,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SUCCESS,
  INPUT_CLASS,
  PageHeader,
  SELECT_CLASS,
  StatusBadge,
  SurfaceCard,
  TABLE_HEAD,
  TABLE_ROW,
  TABLE_WRAPPER,
} from '../common/UiPrimitives';
import {
  FileText,
  FileSpreadsheet,
  Download,
  Printer,
  ShieldCheck,
} from 'lucide-react';

const STATUS_MAP: Record<
  string,
  { labels: Record<SupportedLanguage, string>; variant: BadgeVariant }
> = {
  draft: {
    labels: { ar: 'مسودة', en: 'Draft', ur: 'مسودہ' },
    variant: 'neutral',
  },
  pending_review: {
    labels: { ar: 'مرسل للمراجعة', en: 'Pending Review', ur: 'جائزے کے لیے' },
    variant: 'warning',
  },
  approved: {
    labels: { ar: 'معتمد', en: 'Approved', ur: 'منظور شدہ' },
    variant: 'success',
  },
  rejected: {
    labels: { ar: 'معاد للتعديل', en: 'Returned', ur: 'ترمیم کے لیے واپس' },
    variant: 'danger',
  },
};

export const FinancialReports: React.FC = () => {
  const { closings, branches, employees, currentOrg, userProfile } = useAuth();
  const { language, tr } = useLanguage();
  const effectivePerms = resolveEffectivePermissions(userProfile);
  const canExport = effectivePerms.canExportReports;

  const [statusScope, setStatusScope] = useState<'approved' | 'all' | 'pending_review' | 'draft'>('approved');
  const [dateFilterType, setDateFilterType] = useState<'today' | 'week' | 'month' | 'year' | 'all' | 'custom'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');

  const todayStr = new Date().toISOString().split('T')[0];

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const firstOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];

  const filtered = closings.filter((c) => {
    if (statusScope !== 'all' && c.status !== statusScope) return false;

    if (dateFilterType === 'today' && c.date !== todayStr) return false;
    if (dateFilterType === 'week' && (c.date < oneWeekAgo || c.date > todayStr)) return false;
    if (dateFilterType === 'month' && c.date < firstOfMonth) return false;
    if (dateFilterType === 'year' && c.date < firstOfYear) return false;
    if (dateFilterType === 'custom') {
      if (fromDate && c.date < fromDate) return false;
      if (toDate && c.date > toDate) return false;
    }

    if (selectedBranchId !== 'all' && c.branchId !== selectedBranchId) return false;
    if (selectedEmployeeId !== 'all' && c.employeeId !== selectedEmployeeId) return false;
    if (selectedPeriod !== 'all' && c.period !== selectedPeriod) return false;

    return true;
  });

  const employeeFilterOptions = React.useMemo(() => {
    const map = new Map<string, { uid: string; label: string; isHistoricalOnly: boolean }>();
    employees.forEach((emp) => {
      map.set(emp.uid, {
        uid: emp.uid,
        label: emp.displayName || emp.email || emp.uid,
        isHistoricalOnly: false,
      });
    });
    closings.forEach((c) => {
      if (c.employeeId && !map.has(c.employeeId)) {
        map.set(c.employeeId, {
          uid: c.employeeId,
          label: `${c.employeeName || c.employeeId} (${tr('عضو سابق', 'Former Member', 'سابق رکن')})`,
          isHistoricalOnly: true,
        });
      }
    });
    return Array.from(map.values());
  }, [employees, closings, tr]);

  const totalCash = filtered.reduce((acc, c) => acc + c.cashSales, 0);
  const totalCard = filtered.reduce((acc, c) => acc + c.cardSales, 0);
  const totalSales = filtered.reduce((acc, c) => acc + c.totalSales, 0);
  const totalExpenses = filtered.reduce((acc, c) => acc + c.expenses, 0);
  const totalRemainingInBox = filtered.reduce((acc, c) => acc + c.remainingInBox, 0);
  const totalNetPeriod = filtered.reduce((acc, c) => acc + c.netPeriod, 0);

  const [exportingXlsx, setExportingXlsx] = useState(false);

  const currency = currentOrg?.currency || 'SAR';
  const locale = language === 'en' ? 'en-US' : language === 'ur' ? 'ur-PK' : 'ar-SA';

  const getStatus = (status: string) => {
    const entry = STATUS_MAP[status] || STATUS_MAP.draft;
    return { label: entry.labels[language] || entry.labels.ar, variant: entry.variant };
  };

  const periodLabel = (p: string) =>
    p === 'morning' ? tr('صباحية', 'Morning', 'صبح') : tr('مسائية', 'Evening', 'شام');

  const handleExportCSV = () => {
    exportClosingsToCSV(filtered, currency);
  };

  const handleExportXlsx = async () => {
    if (exportingXlsx) return;
    setExportingXlsx(true);
    try {
      const scopeLabel =
        statusScope === 'approved'
          ? tr('الإقفالات المعتمدة', 'Approved Closings', 'منظور شدہ کلوزنگز')
          : tr('شامل الحالات', 'All Statuses', 'تمام حالات');
      const { bytes, fileName } = await generateClosingsSummaryExcel({
        closings: filtered,
        org: currentOrg,
        statusScopeLabel: scopeLabel,
      });
      downloadXlsxBytes(bytes, fileName);
    } finally {
      setExportingXlsx(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PageHeader
          title={tr(
            `التقارير المالية والمحاسبية الدقيقة (${filtered.length} وردية)`,
            `Financial & Accounting Reports (${filtered.length} shifts)`,
            `درست مالیاتی اور اکاؤنٹنگ رپورٹس (${filtered.length} شفٹس)`
          )}
          subtitle={tr(
            'كشف حساب تفصيلي لجميع فترات الورديات مع شريط المجاميع السفلية وإمكانية التصدير',
            'Detailed ledger across all shift periods with grand totals and official export tools',
            'تمام شفٹ ادوار کا تفصیلی مالیاتی بیان، کل میزان اور ایکسپورٹ کی سہولت کے ساتھ'
          )}
          icon={<FileText className="w-5 h-5" />}
          actions={
            canExport ? (
              <>
                <button type="button" onClick={handleExportCSV} className={BTN_SECONDARY}>
                  <Download className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>{tr('تصدير (CSV)', 'Export CSV', 'CSV ایکسپورٹ')}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportXlsx}
                  disabled={exportingXlsx}
                  className={BTN_SUCCESS}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>
                    {exportingXlsx
                      ? tr('جاري التوليد...', 'Generating...', 'تیار ہو رہا ہے...')
                      : tr('تصدير Excel (.xlsx)', 'Export Excel (.xlsx)', 'Excel (.xlsx) ایکسپورٹ')}
                  </span>
                </button>

                <button type="button" onClick={handlePrint} className={BTN_PRIMARY}>
                  <Printer className="w-4 h-4" />
                  <span>{tr('طباعة التقرير / PDF', 'Print / PDF', 'پرنٹ / PDF')}</span>
                </button>
              </>
            ) : (
              <div className="px-3.5 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-600 dark:text-slate-300 border border-[#DCE6FA] dark:border-[#1F3B66]">
                {tr(
                  'وضع العرض فقط — التصدير متاح لمن يملك صلاحية تصدير التقارير',
                  'View-only mode — export requires report export permission',
                  'صرف دیکھنے کا موڈ — ایکسپورٹ کے لیے رپورٹ ایکسپورٹ اختیار درکار ہے'
                )}
              </div>
            )
          }
        />
      </div>

      {/* Financial Scope Badge & Integrity Notice */}
      <SurfaceCard className="no-print">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
            <span className="text-slate-600 dark:text-slate-300 font-semibold">
              {tr('نطاق الاحتساب المالي:', 'Calculation Scope:', 'مالیاتی حساب کا دائرہ:')}
            </span>
            <StatusBadge variant={statusScope === 'approved' ? 'success' : 'neutral'}>
              {statusScope === 'approved'
                ? tr(
                    'الإقفالات المعتمدة رسمياً فقط (مطابقة مالية مؤكدة)',
                    'Officially Approved Closings Only (Verified)',
                    'صرف سرکاری منظور شدہ کلوزنگز (تصدیق شدہ)'
                  )
                : tr(
                    'شامل المسودات وغير المعتمد',
                    'Includes Drafts & Pending Records',
                    'مسودات اور غیر منظور شدہ ریکارڈز سمیت'
                  )}
            </StatusBadge>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-bold">
            <span className="text-slate-500 dark:text-slate-400 font-medium">
              {tr('تغيير نطاق الاعتماد:', 'Scope:', 'دائرہ تبدیل کریں:')}
            </span>
            <button
              type="button"
              onClick={() => setStatusScope('approved')}
              className={`px-3 py-1.5 rounded-xl transition-colors ${
                statusScope === 'approved'
                  ? 'bg-[#1764FF] text-white'
                  : 'bg-[#F5F8FF] dark:bg-[#0E203A] text-[#0B1B32] dark:text-slate-300 hover:bg-[#EAF1FF] dark:hover:bg-[#173056]'
              }`}
            >
              {tr('المعتمدة فقط (افتراضي)', 'Approved Only (Default)', 'صرف منظور شدہ (ڈیفالٹ)')}
            </button>
            <button
              type="button"
              onClick={() => setStatusScope('all')}
              className={`px-3 py-1.5 rounded-xl transition-colors ${
                statusScope === 'all'
                  ? 'bg-[#1764FF] text-white'
                  : 'bg-[#F5F8FF] dark:bg-[#0E203A] text-[#0B1B32] dark:text-slate-300 hover:bg-[#EAF1FF] dark:hover:bg-[#173056]'
              }`}
            >
              {tr('كافة الحالات', 'All Statuses', 'تمام حالات')}
            </button>
          </div>
        </div>
      </SurfaceCard>

      {/* Filter Ribbon (Hidden in Print) */}
      <SurfaceCard className="no-print">
        <div className="space-y-3">
          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold pb-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
            <span className="text-slate-500 dark:text-slate-400 me-2 font-semibold">
              {tr('الفترة الزمنية:', 'Date Range:', 'مدت:')}
            </span>
            {[
              { id: 'all', label: tr('كافة الفترات', 'All Time', 'تمام مدت') },
              { id: 'today', label: tr('اليوم', 'Today', 'آج') },
              { id: 'week', label: tr('آخر 7 أيام', 'Last 7 Days', 'گزشتہ 7 دن') },
              { id: 'month', label: tr('الشهر الحالي', 'This Month', 'موجودہ مہینہ') },
              { id: 'year', label: tr('السنة الحالية', 'This Year', 'موجودہ سال') },
              { id: 'custom', label: tr('تخصيص تاريخ', 'Custom Range', 'مخصوص تاریخ') },
            ].map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() => setDateFilterType(preset.id as any)}
                className={`px-3 py-1.5 rounded-xl transition-colors ${
                  dateFilterType === preset.id
                    ? 'bg-[#1764FF] text-white'
                    : 'bg-[#F5F8FF] dark:bg-[#0E203A] text-[#0B1B32] dark:text-slate-300 hover:bg-[#EAF1FF] dark:hover:bg-[#173056]'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Detailed Dropdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-1">
            {dateFilterType === 'custom' && (
              <>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                    {tr('من تاريخ', 'From Date', 'تاریخ سے')}
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className={`${INPUT_CLASS} py-2 text-xs font-mono-num`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                    {tr('إلى تاريخ', 'To Date', 'تاریخ تک')}
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className={`${INPUT_CLASS} py-2 text-xs font-mono-num`}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                {tr('الفرع', 'Branch', 'برانچ')}
              </label>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className={`${SELECT_CLASS} py-2 text-xs`}
              >
                <option value="all">{tr('جميع الفروع', 'All Branches', 'تمام برانچز')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                {tr('الموظف', 'Staff Member', 'ملازم')}
              </label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className={`${SELECT_CLASS} py-2 text-xs`}
              >
                <option value="all">{tr('جميع الموظفين', 'All Staff', 'تمام ملازمین')}</option>
                {employeeFilterOptions.map((emp) => (
                  <option key={emp.uid} value={emp.uid}>
                    {emp.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                {tr('الفترة', 'Shift Period', 'شفٹ کا وقت')}
              </label>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className={`${SELECT_CLASS} py-2 text-xs`}
              >
                <option value="all">
                  {tr('الصباحية والمسائية', 'Morning & Evening', 'صبح اور شام')}
                </option>
                <option value="morning">{tr('صباحية', 'Morning', 'صبح')}</option>
                <option value="evening">{tr('مسائية', 'Evening', 'شام')}</option>
              </select>
            </div>
          </div>
        </div>
      </SurfaceCard>

      {/* Official Report Header for Print */}
      <div className="hidden print-only mb-6 text-center border-b pb-4">
        <h2 className="text-xl font-bold">
          {tr('تقرير إقفالات الوردية', 'Shift Closings Report', 'شفٹ کلوزنگز رپورٹ')} - {currentOrg?.name}
        </h2>
        <p className="text-xs text-gray-500">
          {tr('تاريخ الطباعة:', 'Print Date:', 'پرنٹ کی تاریخ:')} {new Date().toLocaleDateString(locale)} •{' '}
          {tr('العملة:', 'Currency:', 'کرنسی:')} {currency} •{' '}
          {tr('النطاق:', 'Scope:', 'دائرہ:')}{' '}
          {statusScope === 'approved'
            ? tr('الإقفالات المعتمدة', 'Approved Closings', 'منظور شدہ کلوزنگز')
            : tr('شامل', 'All Statuses', 'تمام')}
        </p>
      </div>

      {/* Mobile Report Cards (< 768px) */}
      <div className="block md:hidden space-y-3 no-print">
        {filtered.map((closing) => {
          const st = getStatus(closing.status);
          return (
            <SurfaceCard key={closing.id}>
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between border-b border-[#E6EEFC] dark:border-[#1F3B66] pb-2">
                  <div>
                    <h4 className="font-bold text-[#0B1B32] dark:text-white text-sm">{closing.branchName}</h4>
                    <span className="text-[11px] text-slate-500">
                      {closing.date} • {periodLabel(closing.period)} • {closing.employeeName}
                    </span>
                  </div>
                  <StatusBadge variant={st.variant}>{st.label}</StatusBadge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-[10px] text-slate-500 block font-medium">
                      {tr('إجمالي المبيعات', 'Total Sales', 'کل فروخت')}
                    </span>
                    <span className="font-mono-num font-bold text-[#0B1B32] dark:text-white">
                      {closing.totalSales.toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#08C99B]/10 border border-[#08C99B]/25">
                    <span className="text-[10px] text-[#048264] dark:text-[#08C99B] block font-medium">
                      {tr('صافي الفترة', 'Net Period', 'خالص مدت')}
                    </span>
                    <span className="font-mono-num font-bold text-[#048264] dark:text-[#08C99B]">
                      {closing.netPeriod.toFixed(2)}
                    </span>
                  </div>
                  <div className="p-1.5 px-2 rounded-lg bg-[#F5F8FF] dark:bg-[#0E203A] text-[11px] flex justify-between">
                    <span className="text-slate-500">{tr('النقد:', 'Cash:', 'نقد:')}</span>
                    <span className="font-mono-num font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                      {closing.cashSales.toFixed(2)}
                    </span>
                  </div>
                  <div className="p-1.5 px-2 rounded-lg bg-[#F5F8FF] dark:bg-[#0E203A] text-[11px] flex justify-between">
                    <span className="text-slate-500">{tr('الشبكة:', 'Card:', 'کارڈ:')}</span>
                    <span className="font-mono-num font-bold text-[#048264] dark:text-[#08C99B]">
                      {closing.cardSales.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </SurfaceCard>
          );
        })}

        {/* Mobile Grand Total Card */}
        {filtered.length > 0 && (
          <div className="p-4 rounded-2xl bg-[#0B1B32] text-white border border-[#1F3B66] shadow-sm space-y-2">
            <span className="text-xs font-extrabold text-[#6CA2FF] block">
              {tr(
                `إجمالي الفترة المعروضة (${filtered.length} وردية)`,
                `Displayed Period Total (${filtered.length} shifts)`,
                `ظاہر شدہ مدت کا کل (${filtered.length} شفٹس)`
              )}
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono-num">
              <div>
                <span className="text-[10px] font-sans text-slate-300 block">
                  {tr('إجمالي المبيعات', 'Total Sales', 'کل فروخت')}
                </span>
                <span className="text-sm font-bold text-white">{totalSales.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-300 block">
                  {tr('صافي الفترة', 'Net Period', 'خالص مدت')}
                </span>
                <span className="text-sm font-bold text-[#08C99B]">{totalNetPeriod.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-300 block">
                  {tr('مجموع النقد', 'Total Cash', 'کل نقد')}
                </span>
                <span className="text-xs text-[#6CA2FF]">{totalCash.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-300 block">
                  {tr('مجموع الشبكة', 'Total Card', 'کل کارڈ')}
                </span>
                <span className="text-xs text-[#08C99B]">{totalCard.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Financial Report Table (Desktop & Print) */}
      <div className={`hidden md:block ${TABLE_WRAPPER}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs sm:text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="p-3.5 text-start">{tr('التاريخ', 'Date', 'تاریخ')}</th>
                <th className="p-3.5 text-start">{tr('الفرع', 'Branch', 'برانچ')}</th>
                <th className="p-3.5 text-start">{tr('الموظف', 'Staff', 'ملازم')}</th>
                <th className="p-3.5 text-start">{tr('الفترة', 'Period', 'وقت')}</th>
                <th className="p-3.5 text-start">{tr('النقد', 'Cash', 'نقد')}</th>
                <th className="p-3.5 text-start">{tr('الشبكة', 'Card', 'کارڈ')}</th>
                <th className="p-3.5 text-start">{tr('الإجمالي', 'Total', 'کل')}</th>
                <th className="p-3.5 text-start">{tr('المشتريات', 'Expenses', 'اخراجات')}</th>
                <th className="p-3.5 text-start">{tr('الباقي بالصندوق', 'Drawer Cash', 'باقی نقد')}</th>
                <th className="p-3.5 text-start">{tr('الصافي', 'Net', 'خالص')}</th>
                <th className="p-3.5 text-start">{tr('الحالة', 'Status', 'حیثیت')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((closing) => {
                const st = getStatus(closing.status);
                return (
                  <tr key={closing.id} className={TABLE_ROW}>
                    <td className="p-3.5 font-mono-num font-bold text-[#0B1B32] dark:text-white">
                      {closing.date}
                    </td>
                    <td className="p-3.5 text-slate-700 dark:text-slate-300 font-medium">
                      {closing.branchName}
                    </td>
                    <td className="p-3.5 text-slate-700 dark:text-slate-300">
                      {closing.employeeName}
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded-md text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-700 dark:text-slate-300">
                        {periodLabel(closing.period)}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono-num text-[#1764FF] dark:text-[#6CA2FF] font-bold">
                      {closing.cashSales.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num text-[#048264] dark:text-[#08C99B] font-bold">
                      {closing.cardSales.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num font-extrabold text-[#0B1B32] dark:text-white">
                      {closing.totalSales.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num text-rose-600 dark:text-rose-400">
                      {closing.expenses.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num text-[#1764FF] dark:text-[#6CA2FF] font-bold">
                      {closing.remainingInBox.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num text-[#048264] dark:text-[#08C99B] font-bold">
                      {closing.netPeriod.toFixed(2)}
                    </td>
                    <td className="p-3.5">
                      <StatusBadge variant={st.variant}>{st.label}</StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* MANDATORY BOTTOM SUMMARY TOTALS BAR */}
            <tfoot className="bg-[#EAF1FF] dark:bg-[#0E203A] border-t-2 border-[#DCE6FA] dark:border-[#1F3B66] font-mono-num text-xs sm:text-sm font-bold">
              <tr>
                <td colSpan={4} className="p-4 text-[#0B1B32] dark:text-white font-sans font-extrabold">
                  {tr(
                    `المجموع الكلي (${filtered.length} وردية معروضة):`,
                    `Grand Total (${filtered.length} shifts shown):`,
                    `کل میزان (${filtered.length} شفٹس):`
                  )}
                </td>
                <td className="p-4 text-[#1764FF] dark:text-[#6CA2FF] font-extrabold">
                  {totalCash.toFixed(2)}
                </td>
                <td className="p-4 text-[#048264] dark:text-[#08C99B] font-extrabold">
                  {totalCard.toFixed(2)}
                </td>
                <td className="p-4 text-[#0B1B32] dark:text-white font-extrabold text-sm">
                  {totalSales.toFixed(2)}
                </td>
                <td className="p-4 text-rose-600 dark:text-rose-400 font-extrabold">
                  {totalExpenses.toFixed(2)}
                </td>
                <td className="p-4 text-[#1764FF] dark:text-[#6CA2FF] font-extrabold">
                  {totalRemainingInBox.toFixed(2)}
                </td>
                <td className="p-4 text-[#048264] dark:text-[#08C99B] font-extrabold text-sm">
                  {totalNetPeriod.toFixed(2)}
                </td>
                <td className="p-4 font-sans text-xs text-slate-500 dark:text-slate-400">
                  {currency}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-xs text-slate-400">
            {tr(
              'لا توجد سجلات مطابقة لمعايير البحث في التقارير.',
              'No shift records match the selected filters.',
              'منتخب فلٹرز کے مطابق کوئی ریکارڈ نہیں ملا۔'
            )}
          </div>
        )}
      </div>

      {/* Summary Stat Cards Below Table */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 no-print">
        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-center shadow-xs">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold block mb-1">
            {tr('مجموع النقد', 'Total Cash', 'کل نقد')}
          </span>
          <span className="font-mono-num font-extrabold text-[#1764FF] dark:text-[#6CA2FF] text-sm">
            {formatCurrency(totalCash, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-center shadow-xs">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold block mb-1">
            {tr('مجموع الشبكة', 'Total Card', 'کل کارڈ')}
          </span>
          <span className="font-mono-num font-extrabold text-[#048264] dark:text-[#08C99B] text-sm">
            {formatCurrency(totalCard, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#1764FF]/8 dark:bg-[#1764FF]/15 border border-[#1764FF]/25 text-center shadow-xs">
          <span className="text-[11px] text-[#1764FF] dark:text-[#6CA2FF] font-bold block mb-1">
            {tr('مجموع المبيعات', 'Total Sales', 'کل فروخت')}
          </span>
          <span className="font-mono-num font-extrabold text-[#0B1B32] dark:text-white text-base">
            {formatCurrency(totalSales, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-center shadow-xs">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold block mb-1">
            {tr('مجموع المشتريات', 'Total Expenses', 'کل اخراجات')}
          </span>
          <span className="font-mono-num font-extrabold text-rose-600 dark:text-rose-400 text-sm">
            {formatCurrency(totalExpenses, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#1764FF]/8 dark:bg-[#1764FF]/15 border border-[#1764FF]/25 text-center shadow-xs">
          <span className="text-[11px] text-[#1764FF] dark:text-[#6CA2FF] font-bold block mb-1">
            {tr('باقي الصناديق', 'Cash in Drawers', 'باقی کیش باکس')}
          </span>
          <span className="font-mono-num font-extrabold text-[#1764FF] dark:text-[#6CA2FF] text-sm">
            {formatCurrency(totalRemainingInBox, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#08C99B]/10 dark:bg-[#08C99B]/15 border border-[#08C99B]/30 text-center shadow-xs">
          <span className="text-[11px] text-[#048264] dark:text-[#08C99B] font-bold block mb-1">
            {tr('صافي الفترات', 'Total Net', 'کل خالص')}
          </span>
          <span className="font-mono-num font-extrabold text-[#048264] dark:text-[#08C99B] text-base">
            {formatCurrency(totalNetPeriod, currency, language)}
          </span>
        </div>
      </div>
    </div>
  );
};
