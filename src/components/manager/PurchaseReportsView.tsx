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

const DATE_PRESETS: ReadonlyArray<{
  id: PurchaseReportDatePreset;
  ar: string;
  en: string;
  ur: string;
}> = [
  { id: 'all', ar: 'كافة الفترات', en: 'All Periods', ur: 'تمام ادوار' },
  { id: 'today', ar: 'اليوم', en: 'Today', ur: 'آج' },
  { id: 'week', ar: 'آخر 7 أيام', en: 'Last 7 Days', ur: 'گزشتہ 7 دن' },
  { id: 'month', ar: 'الشهر الحالي', en: 'This Month', ur: 'موجودہ مہینہ' },
  { id: 'year', ar: 'السنة الحالية', en: 'This Year', ur: 'موجودہ سال' },
  { id: 'custom', ar: 'تخصيص تاريخ', en: 'Custom Date', ur: 'مخصوص تاریخ' },
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
  const { language, tr } = useLanguage();
  const currency = currentOrg?.currency || 'SAR';
  const isManager = userProfile?.role === 'manager' && userProfile?.isActive === true;
  const appliedFocusNonceRef = useRef<number | null>(null);

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filters, setFilters] = useState<PurchaseReportFilters>(DEFAULT_PURCHASE_REPORT_FILTERS);

  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [itemsCache, setItemsCache] = useState<Record<string, PurchaseLineItem[]>>({});
  const [loadingItemsId, setLoadingItemsId] = useState<string | null>(null);

  const [exportingExcel, setExportingExcel] = useState<boolean>(false);
  const [exportingPdf, setExportingPdf] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const formatPaymentMethod = useCallback(
    (inv: EnrichedPurchaseInvoice): string => {
      if (language === 'ar') return inv.paymentMethodLabel;
      const pm = inv.purchase.paymentMethod;
      if (pm === 'cash') return tr('نقدي', 'Cash', 'نقد');
      if (pm === 'transfer') return tr('تحويل بنكي', 'Bank Transfer', 'بینک ٹرانسفر');
      if (pm === 'credit') return tr('آجل', 'Credit', 'ادھار');
      if (pm === 'card') return tr('بطاقة / شبكة', 'Card / POS', 'کارڈ / پی او ایس');
      return inv.paymentMethodLabel;
    },
    [language, tr]
  );

  const localizedPeriodLabel = useMemo(() => {
    if (language === 'ar') return reportPeriodFallback();
    function reportPeriodFallback() {
      return DATE_PRESETS.find((p) => p.id === filters.datePreset)?.ar || 'كافة الفترات';
    }
    if (filters.datePreset === 'custom') {
      if (filters.fromDate && filters.toDate) return `${filters.fromDate} → ${filters.toDate}`;
      if (filters.fromDate) return `${tr('من', 'From', 'از')} ${filters.fromDate}`;
      if (filters.toDate) return `${tr('حتى', 'Until', 'تک')} ${filters.toDate}`;
    }
    const preset = DATE_PRESETS.find((p) => p.id === filters.datePreset);
    return preset ? tr(preset.ar, preset.en, preset.ur) : tr('كافة الفترات', 'All Periods', 'تمام ادوار');
  }, [language, filters.datePreset, filters.fromDate, filters.toDate, tr]);

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
      setLoadError(
        err?.message ||
          tr(
            'تعذر تحميل بيانات تقارير المشتريات.',
            'Failed to load purchase report data.',
            'خریداری کی رپورٹس کا ڈیٹا لوڈ نہیں ہو سکا۔'
          )
      );
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [isManager, userProfile, currentOrg?.id, tr]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
      setExportError(
        err?.message ||
          tr(
            'تعذر تصدير ملف Excel. يرجى المحاولة مرة أخرى.',
            'Failed to export Excel file. Please try again.',
            'Excel فائل ایکسپورٹ نہیں ہو سکی۔ براہِ کرم دوبارہ کوشش کریں۔'
          )
      );
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
      setExportError(
        err?.message ||
          tr(
            'تعذر تصدير ملف PDF. يرجى المحاولة مرة أخرى.',
            'Failed to export PDF file. Please try again.',
            'PDF فائل ایکسپورٹ نہیں ہو سکی۔ براہِ کرم دوبارہ کوشش کریں۔'
          )
      );
    } finally {
      setExportingPdf(false);
    }
  };

  if (!isManager) {
    return (
      <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-8 text-center max-w-2xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#0B1B32] dark:text-white">
          {tr('قسم مخصص لمدير المؤسسة', 'Organization Manager Only', 'صرف ادارے کے مینیجر کے لیے')}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {tr(
            'تقارير المشتريات التفصيلية متاحة لحساب مدير المؤسسة فقط.',
            'Detailed purchase reports are available exclusively to the Organization Manager account.',
            'تفصیلی خریداری رپورٹس صرف ادارے کے مینیجر اکاؤنٹ کے لیے دستیاب ہیں۔'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          {language === 'ar' ? (
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white">
              تقارير المشتريات
            </h2>
          ) : (
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white">
              {tr('تقارير المشتريات', 'Purchase Reports', 'خریداری کی رپورٹس')}
            </h2>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{currentOrg?.name || tr('المؤسسة', 'Organization', 'ادارہ')}</span>
            <span aria-hidden="true">·</span>
            <span>{language === 'ar' ? report.filterLabels.periodLabel : localizedPeriodLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {language === 'ar'
                ? `${report.summary.invoiceCount} فاتورة مطابقة من أصل ${purchases.length}`
                : language === 'en'
                  ? `${report.summary.invoiceCount} matching invoices of ${purchases.length}`
                  : `${purchases.length} میں سے ${report.summary.invoiceCount} مماثل انوائسز`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF]/50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{tr('تحديث', 'Refresh', 'تازہ کریں')}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={loading || exportingExcel || exportingPdf}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-[#0B1B32] bg-[#08C99B] hover:bg-[#06B48A] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>
              {exportingExcel
                ? tr('جاري التصدير...', 'Exporting...', 'ایکسپورٹ ہو رہا ہے...')
                : tr('تنزيل Excel', 'Download Excel', 'Excel ڈاؤن لوڈ')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={loading || exportingPdf || exportingExcel}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 shadow-sm shadow-[#1764FF]/20"
          >
            <FileText className="w-4 h-4" />
            <span>
              {exportingPdf
                ? tr('جاري التوليد...', 'Generating...', 'تیار ہو رہا ہے...')
                : tr('تنزيل PDF', 'Download PDF', 'PDF ڈاؤن لوڈ')}
            </span>
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
              {tr('إعادة المحاولة', 'Retry', 'دوبارہ کوشش کریں')}
            </button>
          )}
        </div>
      )}

      {/* Filter Toolbar */}
      <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-4 sm:p-5 space-y-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 me-1">
              {tr('الفترة الزمنية:', 'Period:', 'مدت:')}
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
                    ? 'bg-[#1764FF]/12 text-[#1764FF] dark:text-[#6CA2FF] border border-[#1764FF]/35'
                    : 'bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-600 dark:text-slate-300 border border-transparent hover:border-[#DCE6FA] dark:hover:border-[#1F3B66]'
                }`}
              >
                {tr(preset.ar, preset.en, preset.ur)}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-[#1764FF] dark:hover:text-[#6CA2FF] transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{tr('إعادة ضبط الفلاتر', 'Reset Filters', 'فلٹرز ری سیٹ کریں')}</span>
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
                  {tr('من تاريخ', 'From Date', 'تاریخ سے')}
                </label>
                <input
                  id="pr-from-date"
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, fromDate: e.target.value }))
                  }
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
                />
              </div>
              <div className="lg:col-span-2 space-y-1">
                <label
                  htmlFor="pr-to-date"
                  className="block text-[11px] font-bold text-slate-500 dark:text-slate-400"
                >
                  {tr('إلى تاريخ', 'To Date', 'تاریخ تک')}
                </label>
                <input
                  id="pr-to-date"
                  type="date"
                  value={filters.toDate}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, toDate: e.target.value }))
                  }
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
                />
              </div>
            </>
          )}

          <div className="lg:col-span-3 space-y-1">
            <label
              htmlFor="pr-branch"
              className="block text-[11px] font-bold text-slate-500 dark:text-slate-400"
            >
              {tr('الفرع', 'Branch', 'برانچ')}
            </label>
            <select
              id="pr-branch"
              value={filters.branchId}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, branchId: e.target.value }))
              }
              className="w-full px-3 py-2.5 rounded-xl text-xs font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
            >
              <option value="all">
                {tr('جميع الفروع', 'All Branches', 'تمام برانچز')} ({branches.length})
              </option>
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
              {tr('المورد', 'Supplier', 'سپلائر')}
            </label>
            <select
              id="pr-supplier"
              value={filters.supplierId}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, supplierId: e.target.value }))
              }
              className="w-full px-3 py-2.5 rounded-xl text-xs font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
            >
              <option value="all">
                {tr('جميع الموردين', 'All Suppliers', 'تمام سپلائرز')} ({suppliers.length})
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {!s.isActive ? ` (${tr('موقوف', 'Inactive', 'غیر فعال')})` : ''}
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
              {tr(
                'بحث برقم الفاتورة أو المورد',
                'Search by Invoice # or Supplier',
                'انوائس نمبر یا سپلائر سے تلاش کریں'
              )}
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
                placeholder={tr(
                  'ابحث برقم الفاتورة، اسم المورد، الرقم الضريبي، أو ملاحظة...',
                  'Search by invoice number, supplier name, VAT ID, or note...',
                  'انوائس نمبر، سپلائر نام، ٹیکس نمبر یا نوٹ سے تلاش کریں...'
                )}
                className="w-full ps-10 pe-3.5 py-2.5 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
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
                className="h-28 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] animate-pulse"
              />
            ))}
          </div>
          <div className="h-64 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] animate-pulse" />
        </div>
      ) : (
        <>
          {/* 4 Primary KPI Cards */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{tr('إجمالي قيمة المشتريات', 'Total Purchases Value', 'کل خریداری کی مالیت')}</span>
                <span className="w-8 h-8 rounded-xl bg-[#1764FF]/10 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center">
                  <BarChart3 className="w-4 h-4" />
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white font-mono-num">
                {formatCurrency(report.summary.totalAmount, currency, language)}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                {tr('قبل الضريبة:', 'Before VAT:', 'ٹیکس سے پہلے:')}{' '}
                {formatCurrency(report.summary.subtotalAmount, currency, language)}
              </p>
            </div>

            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{tr('عدد فواتير المشتريات', 'Purchase Invoices Count', 'خریداری انوائسز کی تعداد')}</span>
                <span className="w-8 h-8 rounded-xl bg-[#1764FF]/10 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center">
                  <Receipt className="w-4 h-4" />
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white font-mono-num">
                {report.summary.invoiceCount}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                {tr('متوسط الفاتورة:', 'Avg. Invoice:', 'اوسط انوائس:')}{' '}
                {formatCurrency(report.summary.averageInvoiceAmount, currency, language)}
              </p>
            </div>

            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{tr('إجمالي الضرائب', 'Total VAT', 'کل ٹیکس')}</span>
                <span className="w-8 h-8 rounded-xl bg-[#1764FF]/10 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center">
                  <Percent className="w-4 h-4" />
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-[#1764FF] dark:text-[#6CA2FF] font-mono-num">
                {formatCurrency(report.summary.totalVat, currency, language)}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr('إجمالي ضريبة القيمة المضافة', 'Total Value Added Tax', 'کل ویلیو ایڈڈ ٹیکس')}
              </p>
            </div>

            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{tr('إجمالي الخصومات', 'Total Discounts', 'کل رعایتیں')}</span>
                <span className="w-8 h-8 rounded-xl bg-[#08C99B]/15 text-[#048264] dark:text-[#08C99B] flex items-center justify-center">
                  <Tag className="w-4 h-4" />
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-[#048264] dark:text-[#08C99B] font-mono-num">
                {formatCurrency(report.summary.totalDiscount, currency, language)}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  'إجمالي الخصومات المسجلة على الفواتير',
                  'Total discounts recorded across invoices',
                  'انوائسز پر درج کل رعایتیں'
                )}
              </p>
            </div>
          </section>

          {/* Breakdown Tables: By Branch & By Supplier */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            {/* By Branch */}
            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-[#E6EEFC] dark:border-[#1F3B66] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <h3 className="text-sm sm:text-base font-bold text-[#0B1B32] dark:text-white">
                    {tr('إجمالي المشتريات حسب الفرع', 'Purchases by Branch', 'برانچ کے لحاظ سے خریداری')}
                  </h3>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {report.byBranch.length} {tr('فرع', 'branch(es)', 'برانچ')}
                </span>
              </div>

              {report.byBranch.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'لا توجد مشتريات ضمن النطاق المحدد لعرض توزيع الفروع.',
                    'No purchases within the selected range to show branch breakdown.',
                    'منتخب مدت میں برانچ کی تقسیم دکھانے کے لیے کوئی خریداری موجود نہیں۔'
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-start border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#F5F8FF] dark:bg-[#0E203A] border-b border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-400 font-bold">
                        <th className="py-2.5 px-4 text-start">{tr('الفرع', 'Branch', 'برانچ')}</th>
                        <th className="py-2.5 px-3 text-center">{tr('الفواتير', 'Invoices', 'انوائسز')}</th>
                        <th className="py-2.5 px-3 text-center">{tr('الضريبة', 'VAT', 'ٹیکس')}</th>
                        <th className="py-2.5 px-4 text-end">{tr('الإجمالي', 'Total', 'کل')}</th>
                        <th className="py-2.5 px-3 text-center">{tr('النسبة', 'Share', 'حصہ')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66]/70">
                      {report.byBranch.map((br) => (
                        <tr
                          key={br.id}
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              branchId: prev.branchId === br.id ? 'all' : br.id,
                            }))
                          }
                          title={tr(
                            'اضغط للتصفية حسب هذا الفرع',
                            'Click to filter by this branch',
                            'اس برانچ کے لحاظ سے فلٹر کرنے کے لیے کلک کریں'
                          )}
                          className={`cursor-pointer hover:bg-[#F5F8FF] dark:hover:bg-[#173056]/60 transition-colors ${
                            filters.branchId === br.id ? 'bg-[#1764FF]/8 dark:bg-[#1764FF]/15' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-bold text-[#0B1B32] dark:text-white">
                            <div>{br.name}</div>
                            <div className="w-full h-1.5 bg-[#E6EEFC] dark:bg-[#0E203A] rounded-full mt-1.5 overflow-hidden">
                              <div
                                className="h-full bg-[#1764FF] rounded-full"
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
                          <td className="py-3 px-4 text-end font-mono-num font-bold text-[#0B1B32] dark:text-white whitespace-nowrap">
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
            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-[#E6EEFC] dark:border-[#1F3B66] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-[#048264] dark:text-[#08C99B]" />
                  <h3 className="text-sm sm:text-base font-bold text-[#0B1B32] dark:text-white">
                    {tr('إجمالي المشتريات حسب المورد', 'Purchases by Supplier', 'سپلائر کے لحاظ سے خریداری')}
                  </h3>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {report.bySupplier.length} {tr('مورد', 'supplier(s)', 'سپلائر')}
                </span>
              </div>

              {report.bySupplier.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'لا توجد مشتريات ضمن النطاق المحدد لعرض توزيع الموردين.',
                    'No purchases within the selected range to show supplier breakdown.',
                    'منتخب مدت میں سپلائر کی تقسیم دکھانے کے لیے کوئی خریداری موجود نہیں۔'
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-start border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#F5F8FF] dark:bg-[#0E203A] border-b border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-400 font-bold">
                        <th className="py-2.5 px-4 text-start">{tr('المورد', 'Supplier', 'سپلائر')}</th>
                        <th className="py-2.5 px-3 text-center">{tr('الفواتير', 'Invoices', 'انوائسز')}</th>
                        <th className="py-2.5 px-3 text-center">{tr('الضريبة', 'VAT', 'ٹیکس')}</th>
                        <th className="py-2.5 px-4 text-end">{tr('الإجمالي', 'Total', 'کل')}</th>
                        <th className="py-2.5 px-3 text-center">{tr('النسبة', 'Share', 'حصہ')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66]/70">
                      {report.bySupplier.map((sup) => (
                        <tr
                          key={sup.id}
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              supplierId: prev.supplierId === sup.id ? 'all' : sup.id,
                            }))
                          }
                          title={tr(
                            'اضغط للتصفية حسب هذا المورد',
                            'Click to filter by this supplier',
                            'اس سپلائر کے لحاظ سے فلٹر کرنے کے لیے کلک کریں'
                          )}
                          className={`cursor-pointer hover:bg-[#F5F8FF] dark:hover:bg-[#173056]/60 transition-colors ${
                            filters.supplierId === sup.id ? 'bg-[#08C99B]/10' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-bold text-[#0B1B32] dark:text-white">
                            <div>{sup.name}</div>
                            {sup.secondaryLabel && (
                              <div className="text-[10px] font-mono text-slate-400 mt-0.5" dir="ltr">
                                {sup.secondaryLabel}
                              </div>
                            )}
                            <div className="w-full h-1.5 bg-[#E6EEFC] dark:bg-[#0E203A] rounded-full mt-1.5 overflow-hidden">
                              <div
                                className="h-full bg-[#08C99B] rounded-full"
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
                          <td className="py-3 px-4 text-end font-mono-num font-bold text-[#0B1B32] dark:text-white whitespace-nowrap">
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
          <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6EEFC] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                <h3 className="text-sm sm:text-base font-bold text-[#0B1B32] dark:text-white">
                  {tr('تفاصيل فواتير المشتريات', 'Purchase Invoices Details', 'خریداری انوائسز کی تفصیلات')}
                </h3>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  'اضغط على أي فاتورة لعرض الأصناف والكميات والأسعار والضرائب والخصومات',
                  'Click any invoice to view line items, quantities, prices, VAT, and discounts',
                  'اشیاء، مقدار، قیمتیں، ٹیکس اور رعایت دیکھنے کے لیے کسی بھی انوائس پر کلک کریں'
                )}
              </span>
            </div>

            {report.invoices.length === 0 ? (
              <div className="p-10 text-center space-y-2.5">
                <div className="w-12 h-12 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-400 flex items-center justify-center mx-auto">
                  <Receipt className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-[#0B1B32] dark:text-white">
                  {purchases.length === 0
                    ? tr(
                        'لا توجد فواتير مشتريات مسجلة في المؤسسة حتى الآن',
                        'No purchase invoices recorded in this organization yet',
                        'اس ادارے میں ابھی تک کوئی خریداری انوائس درج نہیں ہوئی'
                      )
                    : tr(
                        'لا توجد فواتير مطابقة لمعايير التصفية الحالية',
                        'No invoices match the current filter criteria',
                        'موجودہ فلٹرز کے مطابق کوئی انوائس نہیں ملی'
                      )}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  {purchases.length === 0
                    ? tr(
                        'ستظهر هنا تقارير المشتريات التفصيلية تلقائياً فور تسجيل أول فاتورة مشتريات من قِبل المسؤول أو مسؤولي الفروع.',
                        'Detailed purchase reports will automatically appear here as soon as the first purchase invoice is logged by a supervisor or branch manager.',
                        'جیسے ہی سپروائزر یا برانچ مینیجر پہلی خریداری انوائس درج کریں گے، تفصیلی رپورٹس خودکار طور پر یہاں ظاہر ہو جائیں گی۔'
                      )
                    : tr(
                        'جرّب توسيع الفترة الزمنية أو اختيار «جميع الفروع» و«جميع الموردين».',
                        'Try widening the date range or selecting "All Branches" and "All Suppliers".',
                        'تاریخ کی حد وسیع کرنے یا "تمام برانچز" اور "تمام سپلائرز" منتخب کرنے کی کوشش کریں۔'
                      )}
                </p>
                {hasActiveFilters && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-[#1764FF] text-white hover:bg-[#1052D8] transition-colors"
                    >
                      {tr('عرض جميع المشتريات', 'Show All Purchases', 'تمام خریداری دکھائیں')}
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
                      <tr className="bg-[#F5F8FF] dark:bg-[#0E203A] border-b border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-400 font-bold">
                        <th className="py-3 px-4 text-start">{tr('التاريخ', 'Date', 'تاریخ')}</th>
                        <th className="py-3 px-3 text-start">{tr('رقم الفاتورة', 'Invoice #', 'انوائس نمبر')}</th>
                        <th className="py-3 px-3 text-start">{tr('الفرع', 'Branch', 'برانچ')}</th>
                        <th className="py-3 px-3 text-start">{tr('المورد', 'Supplier', 'سپلائر')}</th>
                        <th className="py-3 px-3 text-center">{tr('الدفع', 'Payment', 'ادائیگی')}</th>
                        <th className="py-3 px-3 text-end">{tr('قبل الضريبة', 'Subtotal', 'ٹیکس سے پہلے')}</th>
                        <th className="py-3 px-3 text-end">{tr('الخصم', 'Discount', 'رعایت')}</th>
                        <th className="py-3 px-3 text-end">{tr('الضريبة', 'VAT', 'ٹیکس')}</th>
                        <th className="py-3 px-4 text-end">{tr('الإجمالي', 'Total', 'کل')}</th>
                        <th className="py-3 px-3 text-center w-24">{tr('الأصناف', 'Items', 'اشیاء')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66]/70">
                      {report.invoices.map((inv) => {
                        const isExpanded = expandedInvoiceId === inv.id;
                        const isLoadingItems = loadingItemsId === inv.id;
                        return (
                          <React.Fragment key={inv.id}>
                            <tr
                              onClick={() => void handleToggleInvoiceDetails(inv)}
                              className={`cursor-pointer hover:bg-[#F5F8FF] dark:hover:bg-[#173056]/50 transition-colors ${
                                isExpanded ? 'bg-[#1764FF]/6 dark:bg-[#1764FF]/12' : ''
                              }`}
                            >
                              <td className="py-3.5 px-4 font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {inv.date}
                              </td>
                              <td className="py-3.5 px-3 font-mono-num font-bold text-[#0B1B32] dark:text-white whitespace-nowrap">
                                {inv.invoiceNumber}
                              </td>
                              <td className="py-3.5 px-3 text-slate-700 dark:text-slate-300 font-medium">
                                {inv.branchName}
                              </td>
                              <td className="py-3.5 px-3">
                                <div className="font-bold text-[#0B1B32] dark:text-white">
                                  {inv.supplierName}
                                </div>
                                {inv.supplierTaxNumber && (
                                  <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                                    {inv.supplierTaxNumber}
                                  </div>
                                )}
                              </td>
                              <td className="py-3.5 px-3 text-center text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                {formatPaymentMethod(inv)}
                              </td>
                              <td className="py-3.5 px-3 text-end font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {formatCurrency(inv.subtotalAmount, currency, language)}
                              </td>
                              <td className="py-3.5 px-3 text-end font-mono-num text-[#048264] dark:text-[#08C99B] whitespace-nowrap">
                                {inv.discountAmount > 0
                                  ? `-${formatCurrency(inv.discountAmount, currency, language)}`
                                  : '0.00'}
                              </td>
                              <td className="py-3.5 px-3 text-end font-mono-num text-[#1764FF] dark:text-[#6CA2FF] whitespace-nowrap">
                                {formatCurrency(inv.vatAmount, currency, language)}
                                <span className="text-[10px] text-slate-400 ms-1">
                                  ({inv.vatRate}%)
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-end font-mono-num font-extrabold text-[#0B1B32] dark:text-white whitespace-nowrap">
                                {formatCurrency(inv.totalAmount, currency, language)}
                              </td>
                              <td className="py-3.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleToggleInvoiceDetails(inv);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-[#1764FF] dark:text-[#6CA2FF] bg-[#1764FF]/10 hover:bg-[#1764FF]/20 transition-colors whitespace-nowrap"
                                >
                                  <span>
                                    {isExpanded
                                      ? tr('إخفاء', 'Hide', 'چھپائیں')
                                      : tr('التفاصيل', 'Details', 'تفصیل')}
                                  </span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr className="bg-[#F5F8FF]/80 dark:bg-[#0E203A]/85">
                                <td colSpan={10} className="p-4 sm:p-5">
                                  <InvoiceDetailsPanel
                                    inv={inv}
                                    currency={currency}
                                    language={language}
                                    loadingItems={isLoadingItems}
                                    tr={tr}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[#1764FF]/8 dark:bg-[#1764FF]/15 border-t-2 border-[#1764FF]/30 font-extrabold text-[#0B1B32] dark:text-white">
                        <td colSpan={5} className="py-3.5 px-4 text-start">
                          {tr('المجموع الكلي', 'Grand Total', 'مجموعی کل')} ({report.summary.invoiceCount}{' '}
                          {tr('فاتورة', 'invoices', 'انوائسز')})
                        </td>
                        <td className="py-3.5 px-3 text-end font-mono-num whitespace-nowrap">
                          {formatCurrency(report.summary.subtotalAmount, currency, language)}
                        </td>
                        <td className="py-3.5 px-3 text-end font-mono-num text-[#048264] dark:text-[#08C99B] whitespace-nowrap">
                          {formatCurrency(report.summary.totalDiscount, currency, language)}
                        </td>
                        <td className="py-3.5 px-3 text-end font-mono-num text-[#1764FF] dark:text-[#6CA2FF] whitespace-nowrap">
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
                <div className="md:hidden divide-y divide-[#DCE6FA] dark:divide-[#1F3B66]">
                  {report.invoices.map((inv) => {
                    const isExpanded = expandedInvoiceId === inv.id;
                    const isLoadingItems = loadingItemsId === inv.id;
                    return (
                      <div key={inv.id} className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#0B1B32] dark:text-white truncate">
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
                            <div className="text-sm font-extrabold font-mono-num text-[#0B1B32] dark:text-white">
                              {formatCurrency(inv.totalAmount, currency, language)}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {formatPaymentMethod(inv)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-[11px] pt-2 border-t border-[#E6EEFC] dark:border-[#1F3B66]/70">
                          <div>
                            <span className="text-slate-400 block">
                              {tr('قبل الضريبة', 'Subtotal', 'ٹیکس سے پہلے')}
                            </span>
                            <span className="font-mono-num font-bold text-slate-700 dark:text-slate-200">
                              {formatCurrency(inv.subtotalAmount, currency, language)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">
                              {tr('الخصم', 'Discount', 'رعایت')}
                            </span>
                            <span className="font-mono-num font-bold text-[#048264] dark:text-[#08C99B]">
                              {formatCurrency(inv.discountAmount, currency, language)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">
                              {tr('الضريبة', 'VAT', 'ٹیکس')} ({inv.vatRate}%)
                            </span>
                            <span className="font-mono-num font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                              {formatCurrency(inv.vatAmount, currency, language)}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleToggleInvoiceDetails(inv)}
                          className="w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-[#1764FF] dark:text-[#6CA2FF] bg-[#1764FF]/10 hover:bg-[#1764FF]/20 transition-colors"
                        >
                          <span>
                            {isExpanded
                              ? tr('إخفاء تفاصيل الأصناف', 'Hide Line Items', 'اشیاء کی تفصیل چھپائیں')
                              : tr('عرض الأصناف وتفاصيل الفاتورة', 'View Items & Invoice Details', 'اشیاء اور انوائس کی تفصیل دیکھیں')}
                          </span>
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
                              tr={tr}
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
  tr: (ar: string, en: string, ur: string) => string;
}

const InvoiceDetailsPanel: React.FC<InvoiceDetailsPanelProps> = ({
  inv,
  currency,
  language,
  loadingItems,
  tr,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
        <span>
          <strong>{tr('رقم الفاتورة:', 'Invoice #:', 'انوائس نمبر:')}</strong>{' '}
          <span className="font-mono-num">{inv.invoiceNumber}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <strong>{tr('الفرع:', 'Branch:', 'برانچ:')}</strong> {inv.branchName}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <strong>{tr('المورد:', 'Supplier:', 'سپلائر:')}</strong> {inv.supplierName}
        </span>
        {inv.createdByName && (
          <>
            <span aria-hidden="true">·</span>
            <span>
              <strong>{tr('أُدخلت بواسطة:', 'Entered By:', 'درج کنندہ:')}</strong>{' '}
              {inv.createdByName}
            </span>
          </>
        )}
        {inv.attachmentsCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-[#1764FF] dark:text-[#6CA2FF] font-semibold">
              <Paperclip className="w-3.5 h-3.5" />
              <span>
                {inv.attachmentsCount} {tr('مرفق مرتبط', 'attachment(s)', 'منسلک فائل')}
              </span>
            </span>
          </>
        )}
      </div>

      {loadingItems ? (
        <div className="py-4 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#1764FF]" />
          <span>
            {tr('جاري تحميل أصناف الفاتورة...', 'Loading invoice items...', 'انوائس کی اشیاء لوڈ ہو رہی ہیں...')}
          </span>
        </div>
      ) : inv.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]">
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="bg-[#F5F8FF] dark:bg-[#0E203A] border-b border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300 font-bold">
                <th className="py-2.5 px-3 text-center w-12">#</th>
                <th className="py-2.5 px-3 text-start">{tr('اسم الصنف', 'Item Name', 'شے کا نام')}</th>
                <th className="py-2.5 px-3 text-center">{tr('الكمية', 'Qty', 'مقدار')}</th>
                <th className="py-2.5 px-3 text-end">{tr('سعر الوحدة', 'Unit Price', 'یونٹ قیمت')}</th>
                <th className="py-2.5 px-3 text-end">{tr('الإجمالي', 'Total', 'کل')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66]/70">
              {inv.items.map((item, idx) => (
                <tr key={item.id || `${inv.id}_${idx}`}>
                  <td className="py-2.5 px-3 text-center font-mono-num text-slate-400">
                    {idx + 1}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-[#0B1B32] dark:text-white">
                    {item.name}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono-num text-slate-700 dark:text-slate-300">
                    {item.quantity}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {formatCurrency(item.unitPrice, currency, language)}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono-num font-bold text-[#0B1B32] dark:text-white whitespace-nowrap">
                    {formatCurrency(item.total, currency, language)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-slate-500 dark:text-slate-400">
          {tr(
            'فاتورة مسجلة بالمبلغ الإجمالي بدون بنود أصناف منفصلة.',
            'Invoice recorded by lump-sum total without separate line items.',
            'انوائس علیحدہ اشیاء کی فہرست کے بغیر مجموعی رقم کے طور پر درج ہے۔'
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#DCE6FA] dark:border-[#1F3B66] text-xs">
        <div className="text-slate-600 dark:text-slate-400 max-w-xl">
          {inv.notes ? (
            <span>
              <strong className="text-[#0B1B32] dark:text-slate-200">
                {tr('ملاحظات:', 'Notes:', 'نوٹس:')}
              </strong>{' '}
              {inv.notes}
            </span>
          ) : (
            <span>
              {tr(
                'لا توجد ملاحظات إضافية على هذه الفاتورة.',
                'No additional notes on this invoice.',
                'اس انوائس پر کوئی اضافی نوٹس نہیں ہیں۔'
              )}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 font-mono-num">
          <span className="text-slate-600 dark:text-slate-300">
            {tr('المجموع:', 'Subtotal:', 'ذیلی کل:')}{' '}
            <strong>{formatCurrency(inv.subtotalAmount, currency, language)}</strong>
          </span>
          <span className="text-[#048264] dark:text-[#08C99B]">
            {tr('الخصم:', 'Discount:', 'رعایت:')}{' '}
            <strong>{formatCurrency(inv.discountAmount, currency, language)}</strong>
          </span>
          <span className="text-[#1764FF] dark:text-[#6CA2FF]">
            {tr('الضريبة', 'VAT', 'ٹیکس')} ({inv.vatRate}%):{' '}
            <strong>{formatCurrency(inv.vatAmount, currency, language)}</strong>
          </span>
          <span className="text-[#0B1B32] dark:text-white font-extrabold">
            {tr('الصافي النهائي:', 'Net Total:', 'حتمی کل:')}{' '}
            {formatCurrency(inv.totalAmount, currency, language)}
          </span>
        </div>
      </div>
    </div>
  );
};
