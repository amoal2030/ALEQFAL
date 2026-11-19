import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { calculateShiftTotals, formatCurrency } from '../utils/accounting';
import {
  Calculator,
  Coins,
  CreditCard,
  ShoppingBag,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Info,
  RotateCcw
} from 'lucide-react';

export const CalculatorSimulator: React.FC = () => {
  const { t, language } = useLanguage();

  // Test case default: 1500 Cash, 2000 Card, 400 Purchases
  const [cash, setCash] = useState<string>('1500');
  const [card, setCard] = useState<string>('2000');
  const [expenses, setExpenses] = useState<string>('400');
  const [currency, setCurrency] = useState<string>('SAR');

  const calculations = calculateShiftTotals(cash, card, expenses);

  const handleLoadBenchmark = () => {
    setCash('1500');
    setCard('2000');
    setExpenses('400');
  };

  const handleReset = () => {
    setCash('0');
    setCard('0');
    setExpenses('0');
  };

  return (
    <section id="simulator" className="py-20 bg-[#EFF4FA] dark:bg-[#0B192C]/60 border-y border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-white dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs font-bold mb-4">
            <Calculator className="w-3.5 h-3.5" />
            <span>{t('simTitle')}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0B192C] dark:text-white tracking-tight">
            {t('simTitle')}
          </h2>
          <p className="mt-3 text-base sm:text-lg text-slate-600 dark:text-slate-300">
            {t('simSubtitle')}
          </p>

          {/* Benchmark Load Bar */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleLoadBenchmark}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-all active:scale-95"
            >
              <Sparkles className="w-4 h-4 text-white" />
              <span>{t('simLoadExample')}</span>
            </button>
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-[#0B192C] dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة التعيين</span>
            </button>
          </div>
        </div>

        {/* Main Grid: Inputs on Left, Equations & Outputs on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Input Cards: 5 Cols */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white dark:bg-[#0C1829] rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <span className="text-sm font-extrabold text-[#0B192C] dark:text-white">
                  مدخلات الوردية المالية
                </span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#F4F7FB] dark:bg-slate-800 text-[#0B192C] dark:text-slate-200 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-blue-600"
                >
                  <option value="SAR">SAR (ر.س)</option>
                  <option value="AED">AED (د.إ)</option>
                  <option value="QAR">QAR (ر.ق)</option>
                  <option value="KWD">KWD (د.ك)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>

              {/* Cash Sales Input */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs font-bold text-[#0B192C] dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    {t('simCash')}
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">نقد الكاش الفعلي</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 text-[#0B192C] dark:text-white font-mono-num text-base font-bold transition-all"
                  />
                  <span className="absolute end-3 top-3.5 text-xs font-semibold text-slate-400">
                    {currency}
                  </span>
                </div>
              </div>

              {/* Card Sales Input */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs font-bold text-[#0B192C] dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    {t('simCard')}
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">مدى / فيزا / ماستر</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={card}
                    onChange={(e) => setCard(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 text-[#0B192C] dark:text-white font-mono-num text-base font-bold transition-all"
                  />
                  <span className="absolute end-3 top-3.5 text-xs font-semibold text-slate-400">
                    {currency}
                  </span>
                </div>
              </div>

              {/* Expenses Input */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs font-bold text-[#0B192C] dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <ShoppingBag className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                    {t('simExpenses')}
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">مصروفات وفواتير الوردية</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenses}
                    onChange={(e) => setExpenses(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 text-[#0B192C] dark:text-white font-mono-num text-base font-bold transition-all"
                  />
                  <span className="absolute end-3 top-3.5 text-xs font-semibold text-slate-400">
                    {currency}
                  </span>
                </div>
              </div>

              {/* Verification Info Note */}
              <div className="p-3.5 rounded-xl bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800/60 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {t('simTestNotes')}
                </p>
              </div>
            </div>
          </div>

          {/* Results & Math Breakdown: 7 Cols */}
          <div className="lg:col-span-7 space-y-4">
            {/* Output Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Total Sales */}
              <div className="bg-white dark:bg-[#0C1829] rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">
                  {t('simTotalSales')}
                </span>
                <div className="text-2xl font-extrabold text-[#0B192C] dark:text-white font-mono-num tracking-tight">
                  {formatCurrency(calculations.totalSales, currency, language)}
                </div>
                <div className="mt-2.5 text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 px-2.5 py-1 rounded-md inline-block">
                  {t('simTotalFormula')}
                </div>
              </div>

              {/* Remaining in Box */}
              <div className="bg-white dark:bg-[#0C1829] rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">
                  {t('simRemainingInBox')}
                </span>
                <div className="text-2xl font-extrabold text-[#0B192C] dark:text-white font-mono-num tracking-tight">
                  {formatCurrency(calculations.remainingInBox, currency, language)}
                </div>
                <div className="mt-2.5 text-[11px] font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/15 px-2.5 py-1 rounded-md inline-block">
                  {t('simRemainingFormula')}
                </div>
              </div>

              {/* Net Period */}
              <div className="bg-[#0B192C] rounded-2xl p-5 border border-[#1E375B] shadow-xs text-white">
                <span className="text-xs font-bold text-blue-200/80 block mb-1">
                  {t('simNetPeriod')}
                </span>
                <div className="text-2xl font-extrabold text-white font-mono-num tracking-tight">
                  {formatCurrency(calculations.netPeriod, currency, language)}
                </div>
                <div className="mt-2.5 text-[11px] font-bold text-blue-100 bg-blue-600/35 border border-blue-400/30 px-2.5 py-1 rounded-md inline-block">
                  {t('simNetFormula')}
                </div>
              </div>
            </div>

            {/* Live Formula Walkthrough Card */}
            <div className="bg-white dark:bg-[#0C1829] rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <h3 className="text-sm font-extrabold text-[#0B192C] dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>تفصيل المعادلات الحسابية المعتمدة وفقاً للبيانات المدخلة</span>
              </h3>

              <div className="space-y-3 text-xs sm:text-sm">
                {/* 1. Total Sales Calculation Row */}
                <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-xs">
                      1
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 font-semibold">
                      إجمالي المبيعات = النقد + الشبكة
                    </span>
                  </div>
                  <div className="text-[#0B192C] dark:text-white font-bold font-mono-num">
                    {formatCurrency(calculations.cashSales, currency, language)} +{' '}
                    {formatCurrency(calculations.cardSales, currency, language)} ={' '}
                    <span className="text-blue-700 dark:text-blue-300">
                      {formatCurrency(calculations.totalSales, currency, language)}
                    </span>
                  </div>
                </div>

                {/* 2. Remaining in Box Calculation Row */}
                <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-sky-600 text-white font-bold flex items-center justify-center text-xs">
                      2
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 font-semibold">
                      الباقي في الصندوق = النقد - المشتريات
                    </span>
                  </div>
                  <div className="text-[#0B192C] dark:text-white font-bold font-mono-num">
                    {formatCurrency(calculations.cashSales, currency, language)} -{' '}
                    {formatCurrency(calculations.expenses, currency, language)} ={' '}
                    <span className="text-sky-700 dark:text-sky-300">
                      {formatCurrency(calculations.remainingInBox, currency, language)}
                    </span>
                  </div>
                </div>

                {/* 3. Net Period Calculation Row */}
                <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-[#0B192C] text-white font-bold flex items-center justify-center text-xs">
                      3
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 font-semibold">
                      صافي الفترة = إجمالي المبيعات - المشتريات
                    </span>
                  </div>
                  <div className="text-[#0B192C] dark:text-white font-bold font-mono-num">
                    {formatCurrency(calculations.totalSales, currency, language)} -{' '}
                    {formatCurrency(calculations.expenses, currency, language)} ={' '}
                    <span className="text-emerald-700 dark:text-emerald-300">
                      {formatCurrency(calculations.netPeriod, currency, language)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status Alert */}
              <div className="pt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>الحالة الحسابية: متطابقة بدقة عشرية سليمة</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-300">خالٍ من الفروقات</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
