import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { formatCurrency, fromHalalas, toHalalas } from '../../utils/accounting';
import { isNotificationReadByUser, ManagerDashboardTab } from '../../utils/notifications';
import {
  fetchOrganizationPurchasesForReport,
  fetchOrganizationSuppliersForReport,
} from '../../services/purchaseReportService';
import type { AppNotification, NotificationNavTarget, Purchase, Supplier } from '../../types';
import { FinancialCharts } from '../common/Charts';
import { KpiStatCard, SELECT_CLASS, BTN_PRIMARY } from '../common/UiPrimitives';
import {
  Coins,
  CreditCard,
  ShoppingBag,
  ShoppingCart,
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
  Bell,
} from 'lucide-react';

interface ManagerOverviewProps {
  onNavigateTab: (tab: ManagerDashboardTab) => void;
  onNavigateNotification?: (target: NotificationNavTarget, notification?: AppNotification) => void;
}

function formatCompactAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export const ManagerOverview: React.FC<ManagerOverviewProps> = ({
  onNavigateTab,
  onNavigateNotification,
}) => {
  const {
    currentUser,
    closings,
    branches,
    employees,
    currentOrg,
    userProfile,
    driveReadiness,
    tenantNotifications,
    markNotificationAsRead,
  } = useAuth();
  const { t, tr, language } = useLanguage();

  const [filterBranchId, setFilterBranchId] = useState<string>('all');
  const [orgPurchases, setOrgPurchases] = useState<Purchase[]>([]);
  const [orgSuppliers, setOrgSuppliers] = useState<Supplier[]>([]);
  const [purchasesLoaded, setPurchasesLoaded] = useState<boolean>(false);

  const isActiveManager = userProfile?.role === 'manager' && userProfile?.isActive === true;

  // Load real organization purchases & suppliers for the Manager's Overview homepage
  useEffect(() => {
    let cancelled = false;
    if (!isActiveManager || !userProfile || !currentOrg?.id) {
      setOrgPurchases([]);
      setOrgSuppliers([]);
      setPurchasesLoaded(true);
      return;
    }

    setPurchasesLoaded(false);
    Promise.all([
      fetchOrganizationPurchasesForReport(userProfile, currentOrg.id).catch(() => [] as Purchase[]),
      fetchOrganizationSuppliersForReport(userProfile, currentOrg.id).catch(() => [] as Supplier[]),
    ]).then(([purchasesList, suppliersList]) => {
      if (cancelled) return;
      setOrgPurchases(purchasesList);
      setOrgSuppliers(suppliersList);
      setPurchasesLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isActiveManager, userProfile, currentOrg?.id]);

  const activeClosings = useMemo(
    () =>
      closings.filter((c) => {
        if (filterBranchId !== 'all' && c.branchId !== filterBranchId) return false;
        return true;
      }),
    [closings, filterBranchId]
  );

  const filteredPurchases = useMemo(
    () =>
      orgPurchases.filter((p) => {
        if (filterBranchId !== 'all' && p.branchId !== filterBranchId) return false;
        return true;
      }),
    [orgPurchases, filterBranchId]
  );

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

  // Current month key (YYYY-MM) for operational monthly stats
  const currentMonthPrefix = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }, []);

  const monthClosingsCount = useMemo(
    () => activeClosings.filter((c) => (c.date || '').startsWith(currentMonthPrefix)).length,
    [activeClosings, currentMonthPrefix]
  );

  // Integer-Halala total purchases
  const totalPurchasesAmount = useMemo(() => {
    const totalHalalas = filteredPurchases.reduce(
      (sum, p) => sum + toHalalas(Number(p.totalAmount ?? p.amount ?? 0)),
      0
    );
    return fromHalalas(totalHalalas);
  }, [filteredPurchases]);

  // Last 4 months purchase chart series (real live org data)
  const monthlyPurchasesSeries = useMemo(() => {
    const locale = language === 'en' ? 'en-US' : language === 'ur' ? 'ur-PK' : 'ar-SA';
    const formatter = new Intl.DateTimeFormat(locale, { month: 'short' });
    const now = new Date();
    const buckets: Array<{ key: string; label: string; halalas: number }> = [];

    for (let offset = 3; offset >= 0; offset -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.push({
        key,
        label: formatter.format(d),
        halalas: 0,
      });
    }

    const bucketMap = new Map(buckets.map((b) => [b.key, b]));
    filteredPurchases.forEach((p) => {
      const monthKey = (p.date || '').slice(0, 7);
      const bucket = bucketMap.get(monthKey);
      if (bucket) {
        bucket.halalas += toHalalas(Number(p.totalAmount ?? p.amount ?? 0));
      }
    });

    const maxHalalas = Math.max(...buckets.map((b) => b.halalas), 0);
    return buckets.map((b) => {
      const amount = fromHalalas(b.halalas);
      const height =
        maxHalalas > 0 ? Math.max(b.halalas > 0 ? 16 : 6, Math.round((b.halalas / maxHalalas) * 100)) : 8;
      return {
        key: b.key,
        label: b.label,
        amount,
        compact: formatCompactAmount(amount),
        height,
      };
    });
  }, [filteredPurchases, language]);

  const latestNotifications = useMemo(
    () => tenantNotifications.slice(0, 4),
    [tenantNotifications]
  );

  const uid = currentUser?.uid || null;

  const formatNotifDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const locale = language === 'en' ? 'en-US' : language === 'ur' ? 'ur-PK' : 'ar-SA';
    return d.toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleOpenNotification = (notif: AppNotification) => {
    if (uid && !isNotificationReadByUser(notif, uid)) {
      markNotificationAsRead(notif.id).catch(() => {});
    }
    if (onNavigateNotification && notif.navTarget) {
      onNavigateNotification(notif.navTarget, notif);
      return;
    }
    if (notif.category === 'purchases_suppliers') {
      onNavigateTab('purchase_reports');
    } else if (notif.category === 'closings') {
      onNavigateTab('closings');
    } else if (notif.category === 'employees') {
      onNavigateTab('employees');
    } else if (notif.category === 'org_branches') {
      onNavigateTab('branches');
    } else {
      onNavigateTab('audit');
    }
  };

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
      {/* Executive Welcome Hero Strip */}
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
                'ملخص فوري لجميع صناديق الفروع والمبيعات والمشتريات والمصروفات مع متابعة مباشرة لحالة الاعتمادات.',
                'Real-time overview of all branch cash drawers, sales, purchases, expenses, and shift approval status.',
                'تمام برانچز کے کیش باکسز، فروخت، خریداری، اخراجات اور منظوریوں کا فوری جائزہ۔'
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

      {/* Row 1: 4 Executive Organization Summary Cards (Branches, Staff, Suppliers, Total Purchases) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => onNavigateTab('branches')}
          className="text-start bg-white dark:bg-[#122543] rounded-2xl p-4 sm:p-5 border border-[#E2EAFA] dark:border-[#1F3B66] hover:border-[#1764FF] transition-colors flex items-center justify-between gap-3 shadow-xs"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#526785] dark:text-slate-300 truncate">
              {t('previewKpiBranches')}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white font-mono-num mt-1">
              {branches.length}
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#08C99B]/12 text-[#048264] dark:bg-[#08C99B]/20 dark:text-[#3CE0B9] flex items-center justify-center shrink-0">
            <GitBranch className="w-5 h-5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('employees')}
          className="text-start bg-white dark:bg-[#122543] rounded-2xl p-4 sm:p-5 border border-[#E2EAFA] dark:border-[#1F3B66] hover:border-[#1764FF] transition-colors flex items-center justify-between gap-3 shadow-xs"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#526785] dark:text-slate-300 truncate">
              {t('previewKpiStaff')}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white font-mono-num mt-1">
              {employees.length}
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#1764FF]/10 text-[#1764FF] dark:bg-[#1764FF]/20 dark:text-[#7EB0FF] flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('suppliers')}
          className="text-start bg-white dark:bg-[#122543] rounded-2xl p-4 sm:p-5 border border-[#E2EAFA] dark:border-[#1F3B66] hover:border-[#1764FF] transition-colors flex items-center justify-between gap-3 shadow-xs"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#526785] dark:text-slate-300 truncate">
              {t('previewKpiSuppliers')}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white font-mono-num mt-1">
              {purchasesLoaded ? orgSuppliers.length : '—'}
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#08C99B]/12 text-[#048264] dark:bg-[#08C99B]/20 dark:text-[#3CE0B9] flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('purchase_reports')}
          className="text-start bg-white dark:bg-[#122543] rounded-2xl p-4 sm:p-5 border border-[#E2EAFA] dark:border-[#1F3B66] hover:border-[#1764FF] transition-colors flex items-center justify-between gap-3 shadow-xs"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#526785] dark:text-slate-300 truncate">
              {t('previewTotalPurchases')}
            </p>
            <p className="text-base sm:text-xl font-extrabold text-[#1764FF] dark:text-[#7EB0FF] font-mono-num mt-1 truncate">
              {purchasesLoaded ? formatCurrency(totalPurchasesAmount, currency, language) : '—'}
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#1764FF]/10 text-[#1764FF] dark:bg-[#1764FF]/20 dark:text-[#7EB0FF] flex items-center justify-center shrink-0">
            <ShoppingCart className="w-5 h-5" />
          </div>
        </button>
      </div>

      {/* Row 2: Executive Operational Row (Latest Notifications + System Status + Monthly Purchases Chart) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Latest Notifications Panel (4 Cols) */}
        <div className="lg:col-span-4 bg-white dark:bg-[#122543] rounded-2xl p-5 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#EDF2FC] dark:border-[#1E3A63]">
              <div className="flex items-center gap-2 text-sm font-extrabold text-[#0B1B32] dark:text-white">
                <Bell className="w-4 h-4 text-[#1764FF]" />
                <span>{t('previewLatestAlerts')}</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('audit')}
                className="text-xs font-bold text-[#1764FF] dark:text-[#7EB0FF] hover:underline"
              >
                {t('previewViewAll')}
              </button>
            </div>

            {latestNotifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#647B9C] dark:text-slate-400">
                {tr(
                  'لا توجد إشعارات حديثة حالياً',
                  'No recent notifications at the moment',
                  'فی الحال کوئی تازہ اطلاعات نہیں ہیں'
                )}
              </div>
            ) : (
              <div className="divide-y divide-[#EDF2FC] dark:divide-[#1E3A63]">
                {latestNotifications.map((notif) => {
                  const isUnread = !isNotificationReadByUser(notif, uid);
                  const isPurchase = notif.category === 'purchases_suppliers';
                  const isClosing = notif.category === 'closings';
                  return (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => handleOpenNotification(notif)}
                      className="w-full text-start py-2.5 flex items-start gap-3 hover:bg-[#F5F8FF] dark:hover:bg-[#173056]/60 rounded-lg px-1.5 -mx-1.5 transition-colors"
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isPurchase
                            ? 'bg-[#08C99B]/12 text-[#048264] dark:bg-[#08C99B]/20 dark:text-[#3CE0B9]'
                            : isClosing
                            ? 'bg-[#1764FF]/10 text-[#1764FF] dark:bg-[#1764FF]/20 dark:text-[#7EB0FF]'
                            : 'bg-[#0B1B32]/8 text-[#0B1B32] dark:bg-white/10 dark:text-white'
                        }`}
                      >
                        {isPurchase ? (
                          <ShoppingCart className="w-4 h-4" />
                        ) : isClosing ? (
                          <Clock className="w-4 h-4" />
                        ) : (
                          <ShieldCheck className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-[#1764FF] shrink-0" />
                          )}
                          <p className="text-xs font-bold text-[#0B1B32] dark:text-white leading-snug truncate">
                            {notif.title}
                          </p>
                        </div>
                        {notif.body && (
                          <p className="text-[11px] text-[#526785] dark:text-slate-300 mt-0.5 line-clamp-1">
                            {notif.body}
                          </p>
                        )}
                        <p className="text-[10px] text-[#647B9C] dark:text-slate-400 mt-0.5">
                          {formatNotifDate(notif.createdAt)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* System Status & Integrity Card (3 Cols) */}
        <div className="lg:col-span-3 bg-white dark:bg-[#122543] rounded-2xl p-5 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs flex flex-col items-center justify-center text-center space-y-3">
          <div className="flex items-center gap-1.5 text-sm font-extrabold text-[#0B1B32] dark:text-white">
            <ShieldCheck
              className={`w-4 h-4 ${
                driveReadiness.isReady ? 'text-[#08C99B]' : 'text-rose-500'
              }`}
            />
            <span>{t('previewSystemStatus')}</span>
          </div>
          <div
            className={`w-16 h-16 rounded-full border-4 flex items-center justify-center ${
              driveReadiness.isReady
                ? 'bg-[#08C99B]/12 border-[#08C99B] text-[#08C99B]'
                : 'bg-rose-500/12 border-rose-500 text-rose-500'
            }`}
          >
            {driveReadiness.isReady ? (
              <CheckCircle2 className="w-8 h-8" />
            ) : (
              <AlertTriangle className="w-8 h-8" />
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-extrabold text-[#0B1B32] dark:text-white">
              {driveReadiness.isReady
                ? t('previewSystemHealthy')
                : tr('يتطلب ربط Google Drive', 'Google Drive Setup Required', 'Google Drive منسلک کرنا ضروری ہے')}
            </p>
            <p className="text-xs text-[#526785] dark:text-slate-300 leading-relaxed">
              {driveReadiness.isReady
                ? t('previewSystemHealthySub')
                : tr('أكمل الربط من صفحة الإعدادات لتفعيل الأرشفة', 'Complete setup in Settings to enable archiving', 'آرکائیو فعال کرنے کے لیے سیٹنگز مکمل کریں')}
            </p>
          </div>
          {!driveReadiness.isReady && (
            <button
              type="button"
              onClick={() => onNavigateTab('settings')}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] transition-colors"
            >
              {tr('فتح الإعدادات', 'Open Settings', 'ترتیبات کھولیں')}
            </button>
          )}
        </div>

        {/* Monthly Purchases Bar Chart (5 Cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-[#122543] rounded-2xl p-5 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 pb-3 mb-2 border-b border-[#EDF2FC] dark:border-[#1E3A63]">
            <button
              type="button"
              onClick={() => onNavigateTab('purchase_reports')}
              className="flex items-center gap-2 text-sm font-extrabold text-[#0B1B32] dark:text-white hover:text-[#1764FF] dark:hover:text-[#7EB0FF] transition-colors"
            >
              <BarChart3 className="w-4 h-4 text-[#1764FF]" />
              <span>{t('previewTotalPurchases')}</span>
            </button>
            <span className="text-xs font-extrabold font-mono-num text-[#1764FF] dark:text-[#7EB0FF]">
              {purchasesLoaded ? formatCurrency(totalPurchasesAmount, currency, language) : '—'}
            </span>
          </div>

          <div className="h-36 flex items-end justify-around gap-3 pt-4 pb-1 px-2">
            {monthlyPurchasesSeries.map((bar, i) => (
              <div key={bar.key} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                <span className="text-[10px] font-mono-num font-bold text-[#526785] dark:text-slate-300">
                  {bar.compact}
                </span>
                <div
                  title={`${bar.label}: ${formatCurrency(bar.amount, currency, language)}`}
                  className={`w-full max-w-[44px] rounded-t-lg transition-all ${
                    i === monthlyPurchasesSeries.length - 1
                      ? 'bg-gradient-to-t from-[#1764FF] to-[#4A8BFF]'
                      : 'bg-gradient-to-t from-[#1764FF]/75 to-[#6EA3FF]/85 dark:from-[#1764FF]/80 dark:to-[#4A8BFF]/80'
                  }`}
                  style={{ height: `${bar.height}%` }}
                />
                <span className="text-[11px] font-semibold text-[#526785] dark:text-slate-300">
                  {bar.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 10 Required Shift Closing KPI Cards */}
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

      {/* Visual Financial Charts */}
      <FinancialCharts
        closings={activeClosings}
        currency={currency}
        language={language}
      />

      {/* Bottom Row: Quick Access Grid + Quick Operational Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
            <div>
              <h3 className="text-sm font-extrabold text-[#0B1B32] dark:text-white">
                {t('previewQuickAccess')}
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

        {/* Quick Operational Stats */}
        <div className="lg:col-span-5 bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 shadow-xs flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="pb-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
              <h3 className="text-sm font-extrabold text-[#0B1B32] dark:text-white">
                {t('previewQuickStats')}
              </h3>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="p-3.5 rounded-xl bg-[#1764FF]/8 dark:bg-[#1764FF]/15 border border-[#1764FF]/15">
                <div className="text-lg font-extrabold text-[#0B1B32] dark:text-white font-mono-num">
                  {approvalRate}%
                </div>
                <div className="text-[11px] font-medium text-[#526785] dark:text-slate-300 mt-0.5">
                  {t('previewComplianceRate')}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#08C99B]/12 dark:bg-[#08C99B]/18 border border-[#08C99B]/25">
                <div className="text-lg font-extrabold text-[#048264] dark:text-[#3CE0B9] font-mono-num">
                  {monthClosingsCount}
                </div>
                <div className="text-[11px] font-medium text-[#526785] dark:text-slate-300 mt-0.5">
                  {t('previewMonthClosings')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('purchase_reports')}
                className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#162D50] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF] transition-colors"
              >
                <div className="text-lg font-extrabold text-[#1764FF] dark:text-[#7EB0FF] font-mono-num">
                  {purchasesLoaded ? filteredPurchases.length : '—'}
                </div>
                <div className="text-[11px] font-medium text-[#526785] dark:text-slate-300 mt-0.5">
                  {t('previewPurchaseInvoices')}
                </div>
              </button>
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
