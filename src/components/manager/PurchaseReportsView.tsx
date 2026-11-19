import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import type { Purchase, PurchaseLineItem, Supplier } from '../../types';
import { formatCurrency } from '../../utils/accounting';
import { downloadXlsxBytes } from '../../services/excelReportService';
import {
  computePurchaseReport,
  DEFAULT_PURCHASE_REPORT_FILTERS,
  downloadPdfBytes,
  EnrichedPurchaseInvoice,
  fetchOrganizationPurchasesForReport,
  fetchOrganizationSuppliersForReport,
  fetchPurchaseItemsForInvoice,
  generatePurchaseReportExcel,
  generatePurchaseReportPdf,
  loadAllInvoiceItemsForExport,
  PurchaseReportDatePreset,
  PurchaseReportFilters,
} from '../../services/purchaseReportService';
import {
  AlertCircle,
  BarChart3,
  Building2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Lock,
  Paperclip,
  Percent,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Tag,
  Truck,
} from 'lucide-react';

const DATE_PRESETS: ReadonlyArray<{ id: PurchaseReportDatePreset; label: string }> = [
  { id: 'all', label: 'كافة الفترات' },
  { id: 'today', label: 'اليوم' },
  { id: 'week', label: 'آخر 7 أيام' },
  { id: 'month', label: 'الشهر الحالي' },
  { id: 'year', label: 'السنة الحالية' },
  { id: 'custom', label: 'تخصيص تاريخ' },
];

export interface PurchaseReportsNavigationFocus {
  purchaseId?: string;
  branchId?: string;
  nonce: number;
}

export interface PurchaseReportsViewProps {
  navigationFocus?: PurchaseReportsNavigationFocus | null;
}

export const PurchaseReportsView: React.FC<PurchaseReportsViewProps> = ({ navigationFocus }) => {
  const { userProfile, currentOrg, branches } = useAuth();
  const { language } = useLanguage();
  const currency = currentOrg?.currency || 'SAR';
  const isManager = userProfile?.role === 'manager' && userProfile?.isActive === true;
  const appliedFocusNonceRef = useRef<number | null>(null);

  // Raw Firestore records
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [filters, setFilters] = useState<PurchaseReportFilters>(DEFAULT_PURCHASE_REPORT_FILTERS);

  // Invoice expansion + on-demand subcollection line items cache
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [itemsCache, setItemsCache] = useState<Record<string, PurchaseLineItem[]>>({});
  const [loadingItemsId, setLoadingItemsId] = useState<string | null>(null);

  // Export states
  const [exportingExcel, setExportingExcel] = useState<boolean>(false);
  const [exportingPdf, setExportingPdf] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isManager || !userProfile || !currentOrg?.id) return;
    setLoading(true);
    setLoadError(null);
    setExportError(null);
    try {
      const [fetchedPurchases, fetchedSuppliers] = await Promise.all([
        fetchOrganizationPurchasesForReport(userProfile, currentOrg.id),
        fetchOrganizationSuppliersForReport(userProfile, currentOrg.id),
      ]);
      setPurchases(fetchedPurchases);
      setSuppliers(fetchedSuppliers);
      setItemsCache({});
      setExpandedInvoiceId(null);
    } catch (err: any) {
      setLoadError(err?.message || 'تعذر تحميل بيانات تقارير المشتريات.');
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [isManager, userProfile, currentOrg?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Preserve real branchId / purchaseId passed from a clicked purchase notification
  // without fabricating any data when an ID is absent or does not match a loaded record.
  useEffect(() => {
    if (!navigationFocus || !hasLoadedOnce || loading) return;
    if (appliedFocusNonceRef.current === navigationFocus.nonce) return;

    const targetBranchId = navigationFocus.branchId?.trim();
    const targetPurchaseId = navigationFocus.purchaseId?.trim();
    const matchedBranch = targetBranchId
      ? branches.find((b) => b.id === targetBranchId)
      : undefined;
    const matchedPurchase = targetPurchaseId
      ? purchases.find((p) => p.id === targetPurchaseId)
      : undefined;

    appliedFocusNonceRef.current = navigationFocus.nonce;

    if (matchedBranch || matchedPurchase) {
      setFilters((prev) => ({
        ...DEFAULT_PURCHASE_REPORT_FILTERS,
        branchId: matchedBranch ? matchedBranch.id : prev.branchId,
      }));
    }

    if (matchedPurchase) {
      setExpandedInvoiceId(matchedPurchase.id);
      if (itemsCache[matchedPurchase.id] === undefined) {
        setLoadingItemsId(matchedPurchase.id);
        void fetchPurchaseItemsForInvoice(matchedPurchase)
          .then((items) => {
            setItemsCache((prev) => ({ ...prev, [matchedPurchase.id]: items }));
          })
          .finally(() => {
            setLoadingItemsId((cur) => (cur === matchedPurchase.id ? null : cur));
          });
      }
    }
  }, [navigationFocus, hasLoadedOnce, loading, branches, purchases, itemsCache]);

  // Computed real-time report (Integer Halala precision)
  const report = useMemo(
    () =>
      computePurchaseReport({
        purchases,
        branches,
        suppliers,
        filters,
        itemsByPurchaseId: itemsCache,
      }),
    [purchases, branches, suppliers, filters, itemsCache]
  );

  const hasActiveFilters = useMemo(
    () =>
      filters.datePreset !== 'all' ||
      filters.branchId !== 'all' ||
      filters.supplierId !== 'all' ||
      filters.searchQuery.trim() !== '',
    [filters]
  );

  const resetFilters = () => {
    setFilters(DEFAULT_PURCHASE_REPORT_FILTERS);
  };

  const handleToggleInvoiceDetails = async (inv: EnrichedPurchaseInvoice) => {
    if (expandedInvoiceId === inv.id) {
      setExpandedInvoiceId(null);
      return;
    }
    setExpandedInvoiceId(inv.id);

    if (itemsCache[inv.id] === undefined) {
      setLoadingItemsId(inv.id);
      try {
        const items = await fetchPurchaseItemsForInvoice(inv.purchase);
        setItemsCache((prev) => ({ ...prev, [inv.id]: items }));
      } finally {
        setLoadingItemsId((cur) => (cur === inv.id ? null : cur));
      }
    }
  };

  const handleExportExcel = async () => {
    if (exportingExcel || exportingPdf) return;
    setExportingExcel(true);
    setExportError(null);
    try {
      const fullItemsCache = await loadAllInvoiceItemsForExport(report.invoices, itemsCache);
      setItemsCache(fullItemsCache);
      const exportReport = computePurchaseReport({
        purchases,
        branches,
        suppliers,
        filters,
        itemsByPurchaseId: fullItemsCache,
      });
      const { bytes, fileName } = await generatePurchaseReportExcel({
        report: exportReport,
        org: currentOrg,
      });
      downloadXlsxBytes(bytes, fileName);
    } catch (err: any) {
      setExportError(err?.message || 'تعذر تصدير ملف Excel. يرجى المحاولة مرة أخرى.');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportingPdf || exportingExcel) return;
    setExportingPdf(true);
    setExportError(null);
    try {
      const fullItemsCache = await loadAllInvoiceItemsForExport(report.invoices, itemsCache);
      setItemsCache(fullItemsCache);
      const exportReport = computePurchaseReport({
        purchases,
        branches,
        suppliers,
        filters,
        itemsByPurchaseId: fullItemsCache,
      });
      const { bytes, fileName } = await generatePurchaseReportPdf({
        report: exportReport,
        org: currentOrg,
      });
      downloadPdfBytes(bytes, fileName);
    } catch (err: any) {
      setExportError(err?.message || 'تعذر تصدير ملف PDF. يرجى المحاولة مرة أخرى.');
    } finally {
      setExportingPdf(false);
    }
  };

  // Defense-in-depth Manager-only guard
  if (!isManager) {
    return (
      <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center max-w-2xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          قسم مخصص لمدير المؤسسة
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          تقارير المشتريات التفصيلية متاحة لحساب مدير المؤسسة فقط.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
            تقارير المشتريات
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{currentOrg?.name || 'المؤسسة'}</span>
            <span aria-hidden="true">·</span>
            <span>{report.filterLabels.periodLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {report.summary.invoiceCount} فاتورة مطابقة من أصل {purchases.length}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 hover:border-amber-500/40 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={loading || exportingExcel || exportingPdf}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{exportingExcel ? 'جاري التصدير...' : 'تنزيل Excel'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={loading || exportingPdf || exportingExcel}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            <span>{exportingPdf ? 'جاري التوليد...' : 'تنزيل PDF'}</span>
          </button>
        </div>
      </div>

      {/* Error Alerts */}
      {(loadError || exportError) && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-3 no-print"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <span>{loadError || exportError}</span>
          </div>
          {loadError && (
            <button
              type="button"
              onClick={() => void loadData()}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-500 transition-colors whitespace-nowrap"
            >
              إعادة المحاولة
            </button>
          )}
        </div>
      )}

      {/* Filter Toolbar */}
      <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4 no-print">
        {/* Date Presets */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 me-1">
              الفترة الزمنية:
            </span>
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    datePreset: preset.id,
                  }))
                }
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                  filters.datePreset === preset.id
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40'
                    : 'bg-slate-100 dark:bg-[#070e17] text-slate-600 dark:text-slate-300 border border-transparent hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة ضبط الفلاتر</span>
            </button>
          )}
        </div>

        {/* Custom Date Range + Branch + Supplier + Search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
          {filters.datePreset === 'custom' && (
            <>
              <div className="lg:col-span-2 space-y-1">
                <label
                  htmlFor="pr-from-date"
                  className="block text-[11px] font-bold text-slate-500 dark:text-slate-400"
                >
                  من تاريخ
                </label>
                <input
                  id="pr-from-date"
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, fromDate: e.target.value }))
                  }
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
              </div>
              <div className="lg:col-span-2 space-y-1">
                <label
                  htmlFor="pr-to-date"
                  className="block text-[11px] font-bold text-slate-500 dark:text-slate-400"
                >
                  إلى تاريخ
                </label>
                <input
                  id="pr-to-date"
                  type="date"
                  value={filters.toDate}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, toDate: e.target.value }))
                  }
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
              </div>
            </>
          )}

          <div
            className={
              filters.datePreset === 'custom' ? 'lg:col-span-3 space-y-1' : 'lg:col-span-3 space-y-1'
            }
          >
            <label
              htmlFor="pr-branch"
              className="block text-[11px] font-bold text-slate-500 dark:text-slate-400"
            >
              الفرع
            </label>
            <select
              id="pr-branch"
              value={filters.branchId}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, branchId: e.target.value }))
              }
              className="w-full px-3 py-2.5 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
            >
              <option value="all">جميع الفروع ({branches.length})</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} {b.code ? `(${b.code})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div
            className={
              filters.datePreset === 'custom' ? 'lg:col-span-2 space-y-1' : 'lg:col-span-4 space-y-1'
            }
          >
            <label
              htmlFor="pr-supplier"
              className="block text-[11px] font-bold text-slate-500 dark:text-slate-400"
            >
              المورد
            </label>
            <select
              id="pr-supplier"
              value={filters.supplierId}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, supplierId: e.target.value }))
              }
              className="w-full px-3 py-2.5 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
            >
              <option value="all">جميع الموردين ({suppliers.length})</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {!s.isActive ? ' (موقوف)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div
            className={
              filters.datePreset === 'custom' ? 'lg:col-span-3 space-y-1' : 'lg:col-span-5 space-y-1'
            }
          >
            <label
              htmlFor="pr-search"
              className="block text-[11px] font-bold text-slate-500 dark:text-slate-400"
            >
              بحث برقم الفاتورة أو المورد
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="pr-search"
                type="text"
                value={filters.searchQuery}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
                }
                placeholder="ابحث برقم الفاتورة، اسم المورد، الرقم الضريبي، أو ملاحظة..."
                className="w-full ps-10 pe-3.5 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Loading Skeleton */}
      {loading ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((k) => (
              <div
                key={k}
                className="h-28 rounded-2xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 animate-pulse"
              />
            ))}
          </div>
          <div className="h-64 rounded-2xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 animate-pulse" />
        </div>
      ) : (
        <>
          {/* 4 Primary KPI Cards */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>إجمالي قيمة المشتريات</span>
                <BarChart3 className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white font-mono-num">
                {formatCurrency(report.summary.totalAmount, currency, language)}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                قبل الضريبة: {formatCurrency(report.summary.subtotalAmount, currency, language)}
              </p>
            </div>

            <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>عدد فواتير المشتريات</span>
                <Receipt className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white font-mono-num">
                {report.summary.invoiceCount}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                متوسط الفاتورة:{' '}
                {formatCurrency(report.summary.averageInvoiceAmount, currency, language)}
              </p>
            </div>

            <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>إجمالي الضرائب</span>
                <Percent className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-amber-600 dark:text-amber-400 font-mono-num">
                {formatCurrency(report.summary.totalVat, currency, language)}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                إجمالي ضريبة القيمة المضافة
              </p>
            </div>

            <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>إجمالي الخصومات</span>
                <Tag className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono-num">
                {formatCurrency(report.summary.totalDiscount, currency, language)}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                إجمالي الخصومات المسجلة على الفواتير
              </p>
            </div>
          </section>

          {/* Breakdown Tables: By Branch & By Supplier */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            {/* By Branch */}
            <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    إجمالي المشتريات حسب الفرع
                  </h3>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {report.byBranch.length} فرع
                </span>
              </div>

              {report.byBranch.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  لا توجد مشتريات ضمن النطاق المحدد لعرض توزيع الفروع.
                </div>
              ) : (
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-start border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-[#070e17]/70 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold">
                        <th className="py-2.5 px-4 text-start">الفرع</th>
                        <th className="py-2.5 px-3 text-center">الفواتير</th>
                        <th className="py-2.5 px-3 text-center">الضريبة</th>
                        <th className="py-2.5 px-4 text-end">الإجمالي</th>
                        <th className="py-2.5 px-3 text-center">النسبة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {report.byBranch.map((br) => (
                        <tr
                          key={br.id}
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              branchId: prev.branchId === br.id ? 'all' : br.id,
                            }))
                          }
                          title="اضغط للتصفية حسب هذا الفرع"
                          className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                            filters.branchId === br.id ? 'bg-amber-500/10' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                            <div>{br.name}</div>
                            <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full"
                                style={{ width: `${Math.min(100, br.sharePercent)}%` }}
                              />
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center font-mono-num text-slate-700 dark:text-slate-300">
                            {br.invoiceCount}
                          </td>
                          <td className="py-3 px-3 text-center font-mono-num text-slate-600 dark:text-slate-400">
                            {formatCurrency(br.vatAmount, currency, language)}
                          </td>
                          <td className="py-3 px-4 text-end font-mono-num font-bold text-slate-900 dark:text-white whitespace-nowrap">
                            {formatCurrency(br.totalAmount, currency, language)}
                          </td>
                          <td className="py-3 px-3 text-center font-mono-num text-slate-500 dark:text-slate-400">
                            {br.sharePercent.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* By Supplier */}
            <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    إجمالي المشتريات حسب المورد
                  </h3>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {report.bySupplier.length} مورد
                </span>
              </div>

              {report.bySupplier.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  لا توجد مشتريات ضمن النطاق المحدد لعرض توزيع الموردين.
                </div>
              ) : (
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-start border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-[#070e17]/70 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold">
                        <th className="py-2.5 px-4 text-start">المورد</th>
                        <th className="py-2.5 px-3 text-center">الفواتير</th>
                        <th className="py-2.5 px-3 text-center">الضريبة</th>
                        <th className="py-2.5 px-4 text-end">الإجمالي</th>
                        <th className="py-2.5 px-3 text-center">النسبة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {report.bySupplier.map((sup) => (
                        <tr
                          key={sup.id}
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              supplierId: prev.supplierId === sup.id ? 'all' : sup.id,
                            }))
                          }
                          title="اضغط للتصفية حسب هذا المورد"
                          className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                            filters.supplierId === sup.id ? 'bg-amber-500/10' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                            <div>{sup.name}</div>
                            {sup.secondaryLabel && (
                              <div className="text-[10px] font-mono text-slate-400 mt-0.5" dir="ltr">
                                {sup.secondaryLabel}
                              </div>
                            )}
                            <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${Math.min(100, sup.sharePercent)}%` }}
                              />
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center font-mono-num text-slate-700 dark:text-slate-300">
                            {sup.invoiceCount}
                          </td>
                          <td className="py-3 px-3 text-center font-mono-num text-slate-600 dark:text-slate-400">
                            {formatCurrency(sup.vatAmount, currency, language)}
                          </td>
                          <td className="py-3 px-4 text-end font-mono-num font-bold text-slate-900 dark:text-white whitespace-nowrap">
                            {formatCurrency(sup.totalAmount, currency, language)}
                          </td>
                          <td className="py-3 px-3 text-center font-mono-num text-slate-500 dark:text-slate-400">
                            {sup.sharePercent.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* Detailed Purchase Invoices Table + Expandable Line Items */}
          <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  تفاصيل فواتير المشتريات
                </h3>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                اضغط على أي فاتورة لعرض الأصناف والكميات والأسعار والضرائب والخصومات
              </span>
            </div>

            {report.invoices.length === 0 ? (
              <div className="p-10 text-center space-y-2.5">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                  <Receipt className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  {purchases.length === 0
                    ? 'لا توجد فواتير مشتريات مسجلة في المؤسسة حتى الآن'
                    : 'لا توجد فواتير مطابقة لمعايير التصفية الحالية'}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  {purchases.length === 0
                    ? 'ستظهر هنا تقارير المشتريات التفصيلية تلقائياً فور تسجيل أول فاتورة مشتريات من قِبل المسؤول أو مسؤولي الفروع.'
                    : 'جرّب توسيع الفترة الزمنية أو اختيار «جميع الفروع» و«جميع الموردين».'}
                </p>
                {hasActiveFilters && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors"
                    >
                      عرض جميع المشتريات
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-start border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-[#070e17]/70 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold">
                        <th className="py-3 px-4 text-start">التاريخ</th>
                        <th className="py-3 px-3 text-start">رقم الفاتورة</th>
                        <th className="py-3 px-3 text-start">الفرع</th>
                        <th className="py-3 px-3 text-start">المورد</th>
                        <th className="py-3 px-3 text-center">الدفع</th>
                        <th className="py-3 px-3 text-end">قبل الضريبة</th>
                        <th className="py-3 px-3 text-end">الخصم</th>
                        <th className="py-3 px-3 text-end">الضريبة</th>
                        <th className="py-3 px-4 text-end">الإجمالي</th>
                        <th className="py-3 px-3 text-center w-24">الأصناف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {report.invoices.map((inv) => {
                        const isExpanded = expandedInvoiceId === inv.id;
                        const isLoadingItems = loadingItemsId === inv.id;
                        return (
                          <React.Fragment key={inv.id}>
                            <tr
                              onClick={() => void handleToggleInvoiceDetails(inv)}
                              className={`cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/35 transition-colors ${
                                isExpanded ? 'bg-amber-500/5 dark:bg-amber-500/10' : ''
                              }`}
                            >
                              <td className="py-3.5 px-4 font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {inv.date}
                              </td>
                              <td className="py-3.5 px-3 font-mono-num font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                {inv.invoiceNumber}
                              </td>
                              <td className="py-3.5 px-3 text-slate-700 dark:text-slate-300 font-medium">
                                {inv.branchName}
                              </td>
                              <td className="py-3.5 px-3">
                                <div className="font-bold text-slate-900 dark:text-white">
                                  {inv.supplierName}
                                </div>
                                {inv.supplierTaxNumber && (
                                  <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                                    {inv.supplierTaxNumber}
                                  </div>
                                )}
                              </td>
                              <td className="py-3.5 px-3 text-center text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                {inv.paymentMethodLabel}
                              </td>
                              <td className="py-3.5 px-3 text-end font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {formatCurrency(inv.subtotalAmount, currency, language)}
                              </td>
                              <td className="py-3.5 px-3 text-end font-mono-num text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                {inv.discountAmount > 0
                                  ? `-${formatCurrency(inv.discountAmount, currency, language)}`
                                  : '0.00'}
                              </td>
                              <td className="py-3.5 px-3 text-end font-mono-num text-amber-600 dark:text-amber-400 whitespace-nowrap">
                                {formatCurrency(inv.vatAmount, currency, language)}
                                <span className="text-[10px] text-slate-400 ms-1">
                                  ({inv.vatRate}%)
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-end font-mono-num font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                                {formatCurrency(inv.totalAmount, currency, language)}
                              </td>
                              <td className="py-3.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleToggleInvoiceDetails(inv);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                                >
                                  <span>{isExpanded ? 'إخفاء' : 'التفاصيل'}</span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr className="bg-slate-50/70 dark:bg-[#070e17]/80">
                                <td colSpan={10} className="p-4 sm:p-5">
                                  <InvoiceDetailsPanel
                                    inv={inv}
                                    currency={currency}
                                    language={language}
                                    loadingItems={isLoadingItems}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-amber-500/10 border-t-2 border-amber-500/30 font-extrabold text-slate-900 dark:text-white">
                        <td colSpan={5} className="py-3.5 px-4 text-start">
                          المجموع الكلي ({report.summary.invoiceCount} فاتورة)
                        </td>
                        <td className="py-3.5 px-3 text-end font-mono-num whitespace-nowrap">
                          {formatCurrency(report.summary.subtotalAmount, currency, language)}
                        </td>
                        <td className="py-3.5 px-3 text-end font-mono-num text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {formatCurrency(report.summary.totalDiscount, currency, language)}
                        </td>
                        <td className="py-3.5 px-3 text-end font-mono-num text-amber-700 dark:text-amber-400 whitespace-nowrap">
                          {formatCurrency(report.summary.totalVat, currency, language)}
                        </td>
                        <td className="py-3.5 px-4 text-end font-mono-num whitespace-nowrap">
                          {formatCurrency(report.summary.totalAmount, currency, language)}
                        </td>
                        <td className="py-3.5 px-3 text-center text-[11px] font-mono">
                          {currency}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Mobile Stacked Cards */}
                <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
                  {report.invoices.map((inv) => {
                    const isExpanded = expandedInvoiceId === inv.id;
                    const isLoadingItems = loadingItemsId === inv.id;
                    return (
                      <div key={inv.id} className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                              {inv.supplierName}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              <span className="font-mono-num">{inv.invoiceNumber}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-num">{inv.date}</span>
                              <span aria-hidden="true">·</span>
                              <span>{inv.branchName}</span>
                            </div>
                          </div>
                          <div className="text-end shrink-0">
                            <div className="text-sm font-extrabold font-mono-num text-slate-900 dark:text-white">
                              {formatCurrency(inv.totalAmount, currency, language)}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {inv.paymentMethodLabel}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-[11px] pt-2 border-t border-slate-100 dark:border-slate-800/80">
                          <div>
                            <span className="text-slate-400 block">قبل الضريبة</span>
                            <span className="font-mono-num font-bold text-slate-700 dark:text-slate-200">
                              {formatCurrency(inv.subtotalAmount, currency, language)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">الخصم</span>
                            <span className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(inv.discountAmount, currency, language)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">الضريبة ({inv.vatRate}%)</span>
                            <span className="font-mono-num font-bold text-amber-600 dark:text-amber-400">
                              {formatCurrency(inv.vatAmount, currency, language)}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleToggleInvoiceDetails(inv)}
                          className="w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                        >
                          <span>{isExpanded ? 'إخفاء تفاصيل الأصناف' : 'عرض الأصناف وتفاصيل الفاتورة'}</span>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="pt-2">
                            <InvoiceDetailsPanel
                              inv={inv}
                              currency={currency}
                              language={language}
                              loadingItems={isLoadingItems}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
};

interface InvoiceDetailsPanelProps {
  inv: EnrichedPurchaseInvoice;
  currency: string;
  language: 'ar' | 'en' | 'ur';
  loadingItems: boolean;
}

const InvoiceDetailsPanel: React.FC<InvoiceDetailsPanelProps> = ({
  inv,
  currency,
  language,
  loadingItems,
}) => {
  return (
    <div className="space-y-4">
      {/* Invoice Metadata Line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
        <span>
          <strong>رقم الفاتورة:</strong>{' '}
          <span className="font-mono-num">{inv.invoiceNumber}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <strong>الفرع:</strong> {inv.branchName}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <strong>المورد:</strong> {inv.supplierName}
        </span>
        {inv.createdByName && (
          <>
            <span aria-hidden="true">·</span>
            <span>
              <strong>أُدخلت بواسطة:</strong> {inv.createdByName}
            </span>
          </>
        )}
        {inv.attachmentsCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
              <Paperclip className="w-3.5 h-3.5" />
              <span>{inv.attachmentsCount} مرفق مرتبط</span>
            </span>
          </>
        )}
      </div>

      {/* Line Items Table */}
      {loadingItems ? (
        <div className="py-4 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />
          <span>جاري تحميل أصناف الفاتورة...</span>
        </div>
      ) : inv.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]">
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100/80 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold">
                <th className="py-2.5 px-3 text-center w-12">#</th>
                <th className="py-2.5 px-3 text-start">اسم الصنف</th>
                <th className="py-2.5 px-3 text-center">الكمية</th>
                <th className="py-2.5 px-3 text-end">سعر الوحدة</th>
                <th className="py-2.5 px-3 text-end">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {inv.items.map((item, idx) => (
                <tr key={item.id || `${inv.id}_${idx}`}>
                  <td className="py-2.5 px-3 text-center font-mono-num text-slate-400">
                    {idx + 1}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                    {item.name}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono-num text-slate-700 dark:text-slate-300">
                    {item.quantity}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {formatCurrency(item.unitPrice, currency, language)}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono-num font-bold text-slate-900 dark:text-white whitespace-nowrap">
                    {formatCurrency(item.total, currency, language)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          فاتورة مسجلة بالمبلغ الإجمالي بدون بنود أصناف منفصلة.
        </div>
      )}

      {/* Invoice Financial Breakdown + Notes */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
        <div className="text-slate-600 dark:text-slate-400 max-w-xl">
          {inv.notes ? (
            <span>
              <strong className="text-slate-800 dark:text-slate-200">ملاحظات:</strong> {inv.notes}
            </span>
          ) : (
            <span>لا توجد ملاحظات إضافية على هذه الفاتورة.</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 font-mono-num">
          <span className="text-slate-600 dark:text-slate-300">
            المجموع: <strong>{formatCurrency(inv.subtotalAmount, currency, language)}</strong>
          </span>
          <span className="text-emerald-600 dark:text-emerald-400">
            الخصم: <strong>{formatCurrency(inv.discountAmount, currency, language)}</strong>
          </span>
          <span className="text-amber-600 dark:text-amber-400">
            الضريبة ({inv.vatRate}%):{' '}
            <strong>{formatCurrency(inv.vatAmount, currency, language)}</strong>
          </span>
          <span className="text-slate-900 dark:text-white font-extrabold">
            الصافي النهائي: {formatCurrency(inv.totalAmount, currency, language)}
          </span>
        </div>
      </div>
    </div>
  );
};
