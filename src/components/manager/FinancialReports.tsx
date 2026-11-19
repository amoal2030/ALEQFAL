import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { resolveEffectivePermissions } from '../../utils/permissions';
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

const STATUS_MAP: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'مسودة', variant: 'neutral' },
  pending_review: { label: 'مرسل للمراجعة', variant: 'warning' },
  approved: { label: 'معتمد', variant: 'success' },
  rejected: { label: 'معاد للتعديل', variant: 'danger' },
};

export const FinancialReports: React.FC = () => {
  const { closings, branches, employees, currentOrg, userProfile } = useAuth();
  const { language } = useLanguage();
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

  const totalCash = filtered.reduce((acc, c) => acc + c.cashSales, 0);
  const totalCard = filtered.reduce((acc, c) => acc + c.cardSales, 0);
  const totalSales = filtered.reduce((acc, c) => acc + c.totalSales, 0);
  const totalExpenses = filtered.reduce((acc, c) => acc + c.expenses, 0);
  const totalRemainingInBox = filtered.reduce((acc, c) => acc + c.remainingInBox, 0);
  const totalNetPeriod = filtered.reduce((acc, c) => acc + c.netPeriod, 0);

  const [exportingXlsx, setExportingXlsx] = useState(false);

  const currency = currentOrg?.currency || 'SAR';

  const handleExportCSV = () => {
    exportClosingsToCSV(filtered, currency);
  };

  const handleExportXlsx = async () => {
    if (exportingXlsx) return;
    setExportingXlsx(true);
    try {
      const scopeLabel =
        statusScope === 'approved' ? 'الإقفالات المعتمدة' : 'شامل الحالات';
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
          title={`التقارير المالية والمحاسبية الدقيقة (${filtered.length} وردية)`}
          subtitle="كشف حساب تفصيلي لجميع فترات الورديات مع شريط المجاميع السفلية وإمكانية التصدير"
          icon={<FileText className="w-5 h-5" />}
          actions={
            canExport ? (
              <>
                <button type="button" onClick={handleExportCSV} className={BTN_SECONDARY}>
                  <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>تصدير (CSV)</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportXlsx}
                  disabled={exportingXlsx}
                  className={BTN_SUCCESS}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>{exportingXlsx ? 'جاري التوليد...' : 'تصدير Excel (.xlsx)'}</span>
                </button>

                <button type="button" onClick={handlePrint} className={BTN_PRIMARY}>
                  <Printer className="w-4 h-4" />
                  <span>طباعة التقرير / PDF</span>
                </button>
              </>
            ) : (
              <div className="px-3.5 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                وضع العرض فقط — التصدير متاح لمن يملك صلاحية تصدير التقارير
              </div>
            )
          }
        />
      </div>

      {/* Financial Scope Badge & Integrity Notice */}
      <SurfaceCard className="no-print">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-slate-600 dark:text-slate-300 font-semibold">
              نطاق الاحتساب المالي:
            </span>
            <StatusBadge variant={statusScope === 'approved' ? 'success' : 'neutral'}>
              {statusScope === 'approved'
                ? 'الإقفالات المعتمدة رسمياً فقط (مطابقة مالية مؤكدة)'
                : 'شامل المسودات وغير المعتمد'}
            </StatusBadge>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-bold">
            <span className="text-slate-500 dark:text-slate-400 font-medium">تغيير نطاق الاعتماد:</span>
            <button
              type="button"
              onClick={() => setStatusScope('approved')}
              className={`px-3 py-1.5 rounded-xl transition-colors ${
                statusScope === 'approved'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              المعتمدة فقط (افتراضي)
            </button>
            <button
              type="button"
              onClick={() => setStatusScope('all')}
              className={`px-3 py-1.5 rounded-xl transition-colors ${
                statusScope === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              كافة الحالات
            </button>
          </div>
        </div>
      </SurfaceCard>

      {/* Filter Ribbon (Hidden in Print) */}
      <SurfaceCard className="no-print">
        <div className="space-y-3">
          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold pb-3 border-b border-slate-100 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400 me-2 font-semibold">الفترة الزمنية:</span>
            {[
              { id: 'all', label: 'كافة الفترات' },
              { id: 'today', label: 'اليوم' },
              { id: 'week', label: 'آخر 7 أيام' },
              { id: 'month', label: 'الشهر الحالي' },
              { id: 'year', label: 'السنة الحالية' },
              { id: 'custom', label: 'تخصيص تاريخ' },
            ].map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() => setDateFilterType(preset.id as any)}
                className={`px-3 py-1.5 rounded-xl transition-colors ${
                  dateFilterType === preset.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
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
                    من تاريخ
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
                    إلى تاريخ
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
                الفرع
              </label>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className={`${SELECT_CLASS} py-2 text-xs`}
              >
                <option value="all">جميع الفروع</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                الموظف
              </label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className={`${SELECT_CLASS} py-2 text-xs`}
              >
                <option value="all">جميع الموظفين</option>
                {employees.map((emp) => (
                  <option key={emp.uid} value={emp.uid}>
                    {emp.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                الفترة
              </label>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className={`${SELECT_CLASS} py-2 text-xs`}
              >
                <option value="all">الصباحية والمسائية</option>
                <option value="morning">صباحية</option>
                <option value="evening">مسائية</option>
              </select>
            </div>
          </div>
        </div>
      </SurfaceCard>

      {/* Official Report Header for Print */}
      <div className="hidden print-only mb-6 text-center border-b pb-4">
        <h2 className="text-xl font-bold">تقرير إقفالات الوردية - {currentOrg?.name}</h2>
        <p className="text-xs text-gray-500">
          تاريخ الطباعة: {new Date().toLocaleDateString('ar-SA')} • العملة: {currency} • النطاق: {statusScope === 'approved' ? 'الإقفالات المعتمدة' : 'شامل'}
        </p>
      </div>

      {/* Mobile Report Cards (< 768px) */}
      <div className="block md:hidden space-y-3 no-print">
        {filtered.map((closing) => {
          const st = STATUS_MAP[closing.status] || STATUS_MAP.draft;
          return (
            <SurfaceCard key={closing.id}>
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-2">
                  <div>
                    <h4 className="font-bold text-[#0B192C] dark:text-white text-sm">{closing.branchName}</h4>
                    <span className="text-[11px] text-slate-500">
                      {closing.date} • {closing.period === 'morning' ? 'صباحية' : 'مسائية'} • {closing.employeeName}
                    </span>
                  </div>
                  <StatusBadge variant={st.variant}>{st.label}</StatusBadge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-xl bg-[#F8FAFC] dark:bg-[#0F1E33] border border-slate-200/80 dark:border-slate-800">
                    <span className="text-[10px] text-slate-500 block font-medium">إجمالي المبيعات</span>
                    <span className="font-mono-num font-bold text-[#0B192C] dark:text-white">
                      {closing.totalSales.toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F8FAFC] dark:bg-[#0F1E33] border border-slate-200/80 dark:border-slate-800">
                    <span className="text-[10px] text-slate-500 block font-medium">صافي الفترة</span>
                    <span className="font-mono-num font-bold text-emerald-700 dark:text-emerald-300">
                      {closing.netPeriod.toFixed(2)}
                    </span>
                  </div>
                  <div className="p-1.5 px-2 rounded-lg bg-[#F8FAFC] dark:bg-[#0F1E33] text-[11px] flex justify-between">
                    <span className="text-slate-500">النقد:</span>
                    <span className="font-mono-num font-bold text-blue-700 dark:text-blue-300">
                      {closing.cashSales.toFixed(2)}
                    </span>
                  </div>
                  <div className="p-1.5 px-2 rounded-lg bg-[#F8FAFC] dark:bg-[#0F1E33] text-[11px] flex justify-between">
                    <span className="text-slate-500">الشبكة:</span>
                    <span className="font-mono-num font-bold text-sky-600 dark:text-sky-400">
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
          <div className="p-4 rounded-2xl bg-[#0B192C] text-white border border-[#1E375B] shadow-sm space-y-2">
            <span className="text-xs font-extrabold text-blue-300 block">
              إجمالي الفترة المعروضة ({filtered.length} وردية)
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono-num">
              <div>
                <span className="text-[10px] font-sans text-slate-300 block">إجمالي المبيعات</span>
                <span className="text-sm font-bold text-white">{totalSales.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-300 block">صافي الفترة</span>
                <span className="text-sm font-bold text-emerald-300">{totalNetPeriod.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-300 block">مجموع النقد</span>
                <span className="text-xs text-blue-200">{totalCash.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-300 block">مجموع الشبكة</span>
                <span className="text-xs text-sky-300">{totalCard.toFixed(2)}</span>
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
                <th className="p-3.5 text-start">التاريخ</th>
                <th className="p-3.5 text-start">الفرع</th>
                <th className="p-3.5 text-start">الموظف</th>
                <th className="p-3.5 text-start">الفترة</th>
                <th className="p-3.5 text-start">النقد</th>
                <th className="p-3.5 text-start">الشبكة</th>
                <th className="p-3.5 text-start">الإجمالي</th>
                <th className="p-3.5 text-start">المشتريات</th>
                <th className="p-3.5 text-start">الباقي بالصندوق</th>
                <th className="p-3.5 text-start">الصافي</th>
                <th className="p-3.5 text-start">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((closing) => {
                const st = STATUS_MAP[closing.status] || STATUS_MAP.draft;
                return (
                  <tr key={closing.id} className={TABLE_ROW}>
                    <td className="p-3.5 font-mono-num font-bold text-[#0B192C] dark:text-white">
                      {closing.date}
                    </td>
                    <td className="p-3.5 text-slate-700 dark:text-slate-300 font-medium">
                      {closing.branchName}
                    </td>
                    <td className="p-3.5 text-slate-700 dark:text-slate-300">
                      {closing.employeeName}
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded-md text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {closing.period === 'morning' ? 'صباحية' : 'مسائية'}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono-num text-blue-700 dark:text-blue-300 font-bold">
                      {closing.cashSales.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num text-sky-600 dark:text-sky-400 font-bold">
                      {closing.cardSales.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num font-extrabold text-[#0B192C] dark:text-white">
                      {closing.totalSales.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num text-rose-600 dark:text-rose-400">
                      {closing.expenses.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num text-blue-700 dark:text-blue-300 font-bold">
                      {closing.remainingInBox.toFixed(2)}
                    </td>
                    <td className="p-3.5 font-mono-num text-emerald-700 dark:text-emerald-300 font-bold">
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
            <tfoot className="bg-[#EFF4FA] dark:bg-[#102036] border-t-2 border-slate-200 dark:border-slate-700 font-mono-num text-xs sm:text-sm font-bold">
              <tr>
                <td colSpan={4} className="p-4 text-[#0B192C] dark:text-white font-sans font-extrabold">
                  المجموع الكلي ({filtered.length} وردية معروضة):
                </td>
                <td className="p-4 text-blue-700 dark:text-blue-300 font-extrabold">
                  {totalCash.toFixed(2)}
                </td>
                <td className="p-4 text-sky-700 dark:text-sky-300 font-extrabold">
                  {totalCard.toFixed(2)}
                </td>
                <td className="p-4 text-[#0B192C] dark:text-white font-extrabold text-sm">
                  {totalSales.toFixed(2)}
                </td>
                <td className="p-4 text-rose-600 dark:text-rose-400 font-extrabold">
                  {totalExpenses.toFixed(2)}
                </td>
                <td className="p-4 text-blue-700 dark:text-blue-300 font-extrabold">
                  {totalRemainingInBox.toFixed(2)}
                </td>
                <td className="p-4 text-emerald-700 dark:text-emerald-300 font-extrabold text-sm">
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
            لا توجد سجلات مطابقة لمعايير البحث في التقارير.
          </div>
        )}
      </div>

      {/* Summary Stat Cards Below Table */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 no-print">
        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#0C1829] border border-slate-200/90 dark:border-slate-800 text-center shadow-xs">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold block mb-1">
            مجموع النقد
          </span>
          <span className="font-mono-num font-extrabold text-blue-700 dark:text-blue-300 text-sm">
            {formatCurrency(totalCash, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#0C1829] border border-slate-200/90 dark:border-slate-800 text-center shadow-xs">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold block mb-1">
            مجموع الشبكة
          </span>
          <span className="font-mono-num font-extrabold text-sky-700 dark:text-sky-300 text-sm">
            {formatCurrency(totalCard, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-blue-50/90 dark:bg-blue-950/35 border border-blue-200 dark:border-blue-800/70 text-center shadow-xs">
          <span className="text-[11px] text-blue-800 dark:text-blue-300 font-bold block mb-1">
            مجموع المبيعات
          </span>
          <span className="font-mono-num font-extrabold text-[#0B192C] dark:text-white text-base">
            {formatCurrency(totalSales, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#0C1829] border border-slate-200/90 dark:border-slate-800 text-center shadow-xs">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold block mb-1">
            مجموع المشتريات
          </span>
          <span className="font-mono-num font-extrabold text-rose-600 dark:text-rose-400 text-sm">
            {formatCurrency(totalExpenses, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-sky-50/90 dark:bg-sky-950/35 border border-sky-200 dark:border-sky-800/70 text-center shadow-xs">
          <span className="text-[11px] text-sky-800 dark:text-sky-300 font-bold block mb-1">
            باقي الصناديق
          </span>
          <span className="font-mono-num font-extrabold text-sky-700 dark:text-sky-300 text-sm">
            {formatCurrency(totalRemainingInBox, currency, language)}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 text-center shadow-xs">
          <span className="text-[11px] text-emerald-800 dark:text-emerald-300 font-bold block mb-1">
            صافي الفترات
          </span>
          <span className="font-mono-num font-extrabold text-emerald-700 dark:text-emerald-300 text-base">
            {formatCurrency(totalNetPeriod, currency, language)}
          </span>
        </div>
      </div>
    </div>
  );
};
