import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { formatCurrency } from '../../utils/accounting';
import { FinancialCharts } from '../common/Charts';
import { PageHeader, KpiStatCard, SELECT_CLASS, BTN_PRIMARY } from '../common/UiPrimitives';
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
} from 'lucide-react';

interface ManagerOverviewProps {
  onNavigateTab: (tab: 'branches' | 'employees' | 'closings' | 'reports') => void;
}

export const ManagerOverview: React.FC<ManagerOverviewProps> = ({ onNavigateTab }) => {
  const { closings, branches, currentOrg } = useAuth();
  const { language } = useLanguage();

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="مؤشرات الأداء المالي والإقفالات"
        subtitle="ملخص فوري لجميع صناديق الفروع والمبيعات والمصروفات"
        icon={<TrendingUp className="w-5 h-5" />}
        actions={
          <select
            value={filterBranchId}
            onChange={(e) => setFilterBranchId(e.target.value)}
            className={`${SELECT_CLASS} sm:w-56 font-bold text-xs`}
          >
            <option value="all">جميع الفروع ({branches.length})</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        }
      />

      {/* 10 Required KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <KpiStatCard
          label="إجمالي المبيعات"
          value={
            <span className="font-mono-num text-base sm:text-xl">
              {formatCurrency(totalSales, currency, language)}
            </span>
          }
          sublabel="نقد + شبكة"
          icon={<TrendingUp className="w-4 h-4" />}
          tone="navy"
        />

        <KpiStatCard
          label="إجمالي النقد (كاش)"
          value={
            <span className="font-mono-num text-base sm:text-xl text-blue-700 dark:text-blue-300">
              {formatCurrency(totalCash, currency, language)}
            </span>
          }
          sublabel="السيولة المستلمة"
          icon={<Coins className="w-4 h-4" />}
          tone="blue"
        />

        <KpiStatCard
          label="إجمالي الشبكة (مدى)"
          value={
            <span className="font-mono-num text-base sm:text-xl text-sky-700 dark:text-sky-300">
              {formatCurrency(totalCard, currency, language)}
            </span>
          }
          sublabel="مدفوعات نقاط البيع"
          icon={<CreditCard className="w-4 h-4" />}
          tone="sky"
        />

        <KpiStatCard
          label="إجمالي المشتريات"
          value={
            <span className="font-mono-num text-base sm:text-xl text-rose-600 dark:text-rose-400">
              {formatCurrency(totalExpenses, currency, language)}
            </span>
          }
          sublabel="مصروفات الصناديق"
          icon={<ShoppingBag className="w-4 h-4" />}
          tone="rose"
        />

        <KpiStatCard
          label="الكاش المتبقي بالصندوق"
          value={
            <span className="font-mono-num text-base sm:text-xl text-blue-700 dark:text-blue-300">
              {formatCurrency(totalRemainingInBox, currency, language)}
            </span>
          }
          sublabel="النقد - المشتريات"
          icon={<Wallet className="w-4 h-4" />}
          tone="blue"
        />

        <KpiStatCard
          label="صافي المبيعات"
          value={
            <span className="font-mono-num text-base sm:text-xl text-emerald-700 dark:text-emerald-300">
              {formatCurrency(totalNetPeriod, currency, language)}
            </span>
          }
          sublabel="المبيعات - المشتريات"
          icon={<Banknote className="w-4 h-4" />}
          tone="emerald"
        />

        <KpiStatCard
          label="عدد الإقفالات"
          value={<span className="font-mono-num text-base sm:text-xl">{activeClosings.length}</span>}
          sublabel="جميع الورديات"
          icon={<FileSpreadsheet className="w-4 h-4" />}
          tone="navy"
        />

        <button
          type="button"
          onClick={() => onNavigateTab('closings')}
          className="text-start bg-white dark:bg-[#0C1829] rounded-2xl border border-amber-300 dark:border-amber-500/40 p-4 sm:p-5 shadow-xs hover:border-blue-500 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300 truncate">
                معلق للمراجعة
              </p>
              <div className="text-base sm:text-xl font-extrabold text-amber-700 dark:text-amber-300 mt-1.5 font-mono-num">
                {pendingCount}
              </div>
              <div className="text-[11px] font-bold text-blue-600 dark:text-blue-400 mt-1 underline">
                فحص واعتماد الآن ←
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
          </div>
        </button>

        <KpiStatCard
          label="إقفالات معتمدة"
          value={
            <span className="font-mono-num text-base sm:text-xl text-emerald-700 dark:text-emerald-300">
              {approvedCount}
            </span>
          }
          sublabel="مقفلة رسمياً"
          icon={<CheckCircle2 className="w-4 h-4" />}
          tone="emerald"
        />

        <KpiStatCard
          label="معاد للتعديل"
          value={
            <span className="font-mono-num text-base sm:text-xl text-rose-600 dark:text-rose-400">
              {rejectedCount}
            </span>
          }
          sublabel="بانتظار تصحيح الموظف"
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

      {/* Pending Reviews Alert Banner */}
      {pendingCount > 0 && (
        <div className="p-5 rounded-2xl bg-[#0B192C] text-white border border-[#1E375B] flex flex-wrap items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/25 border border-blue-400/30 text-blue-300 flex items-center justify-center font-bold shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold">
                لديك {pendingCount} إقفال وردية بانتظار المراجعة والاعتماد
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                قام الموظفون برفع مبيعات النقد والشبكة والمرفقات؛ يمكنك اعتمادها الآن لإدراجها في الكشوفات الرسمية.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('closings')}
            className={BTN_PRIMARY}
          >
            الانتقال لجدول الإقفالات
          </button>
        </div>
      )}
    </div>
  );
};
