import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { calculateShiftTotals, formatCurrency } from '../utils/accounting';
import {
  Calculator,
  Coins,
  CreditCard,
  ShoppingBag,
  CheckCircle2,
  Info,
  RotateCcw,
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
    <section
      id="simulator"
      className="py-20 bg-[#F5F8FF] dark:bg-[#0B1B32] border-b border-[#E2EAFA] dark:border-[#1E3A63] transition-colors"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12 space-y-2">
          <p className="text-xs font-bold text-[#1764FF] dark:text-[#7EB0FF] tracking-wide">
            {t('navSimulator')}
          </p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-[#0B1B32] dark:text-white tracking-tight text-balance">
            {t('simTitle')}
          </h2>
          <p className="text-sm sm:text-base text-[#526785] dark:text-slate-300">
            {t('simSubtitle')}
          </p>

          {/* Benchmark Load Bar */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleLoadBenchmark}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-[#1764FF] hover:bg-[#1052D8] text-white shadow-xs transition-all active:scale-95"
            >
              <Calculator className="w-4 h-4 text-white" />
              <span>{t('simLoadExample')}</span>
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-[#0B1B32] dark:text-slate-200 bg-white dark:bg-[#122543] border border-[#DCE6F8] dark:border-[#23416E] hover:bg-[#EAF1FF] dark:hover:bg-[#193259] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t('simReset')}</span>
            </button>
          </div>
        </div>

        {/* Main Grid: Inputs & Live Formula Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Input Cards: 5 Cols */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white dark:bg-[#122543] rounded-2xl p-6 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-[#EDF2FC] dark:border-[#1E3A63]">
                <span className="text-sm font-extrabold text-[#0B1B32] dark:text-white">
                  {t('simInputsTitle')}
                </span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#F5F8FF] dark:bg-[#0E203A] text-[#0B1B32] dark:text-white border border-[#DCE6F8] dark:border-[#23416E] focus:outline-none focus:border-[#1764FF]"
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
                <label className="flex items-center justify-between text-xs font-bold text-[#0B1B32] dark:text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-[#1764FF] dark:text-[#7EB0FF]" />
                    {t('simCash')}
                  </span>
                  <span className="text-[11px] font-medium text-[#647B9C] dark:text-slate-400">
                    {t('simCashHint')}
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6F8] dark:border-[#23416E] focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20 text-[#0B1B32] dark:text-white font-mono-num text-base font-bold transition-all"
                  />
                  <span className="absolute end-3 top-3.5 text-xs font-semibold text-[#647B9C] dark:text-slate-400">
                    {currency}
                  </span>
                </div>
              </div>

              {/* Card Sales Input */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs font-bold text-[#0B1B32] dark:text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-[#08C99B]" />
                    {t('simCard')}
                  </span>
                  <span className="text-[11px] font-medium text-[#647B9C] dark:text-slate-400">
                    {t('simCardHint')}
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={card}
                    onChange={(e) => setCard(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6F8] dark:border-[#23416E] focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20 text-[#0B1B32] dark:text-white font-mono-num text-base font-bold transition-all"
                  />
                  <span className="absolute end-3 top-3.5 text-xs font-semibold text-[#647B9C] dark:text-slate-400">
                    {currency}
                  </span>
                </div>
              </div>

              {/* Expenses Input */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs font-bold text-[#0B1B32] dark:text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <ShoppingBag className="w-4 h-4 text-rose-500" />
                    {t('simExpenses')}
                  </span>
                  <span className="text-[11px] font-medium text-[#647B9C] dark:text-slate-400">
                    {t('simExpensesHint')}
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenses}
                    onChange={(e) => setExpenses(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6F8] dark:border-[#23416E] focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20 text-[#0B1B32] dark:text-white font-mono-num text-base font-bold transition-all"
                  />
                  <span className="absolute end-3 top-3.5 text-xs font-semibold text-[#647B9C] dark:text-slate-400">
                    {currency}
                  </span>
                </div>
              </div>

              {/* Verification Info Note */}
              <div className="p-3.5 rounded-xl bg-[#1764FF]/8 dark:bg-[#1764FF]/15 border border-[#1764FF]/20 dark:border-[#1764FF]/35 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-[#1764FF] dark:text-[#7EB0FF] shrink-0 mt-0.5" />
                <p className="text-xs text-[#243958] dark:text-slate-200 leading-relaxed">
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
              <div className="bg-white dark:bg-[#122543] rounded-2xl p-5 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs">
                <span className="text-xs font-bold text-[#526785] dark:text-slate-300 block mb-1">
                  {t('simTotalSales')}
                </span>
                <div className="text-2xl font-extrabold text-[#0B1B32] dark:text-white font-mono-num tracking-tight">
                  {formatCurrency(calculations.totalSales, currency, language)}
                </div>
                <div className="mt-2.5 text-[11px] font-bold text-[#1764FF] dark:text-[#7EB0FF]">
                  {t('simTotalFormula')}
                </div>
              </div>

              {/* Remaining in Box */}
              <div className="bg-white dark:bg-[#122543] rounded-2xl p-5 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs">
                <span className="text-xs font-bold text-[#526785] dark:text-slate-300 block mb-1">
                  {t('simRemainingInBox')}
                </span>
                <div className="text-2xl font-extrabold text-[#0B1B32] dark:text-white font-mono-num tracking-tight">
                  {formatCurrency(calculations.remainingInBox, currency, language)}
                </div>
                <div className="mt-2.5 text-[11px] font-bold text-[#048264] dark:text-[#3CE0B9]">
                  {t('simRemainingFormula')}
                </div>
              </div>

              {/* Net Period */}
              <div className="bg-[#0B1B32] dark:bg-[#1764FF] rounded-2xl p-5 border border-[#1E3A63] dark:border-[#4A8BFF] shadow-xs text-white">
                <span className="text-xs font-bold text-blue-100/90 block mb-1">
                  {t('simNetPeriod')}
                </span>
                <div className="text-2xl font-extrabold text-white font-mono-num tracking-tight">
                  {formatCurrency(calculations.netPeriod, currency, language)}
                </div>
                <div className="mt-2.5 text-[11px] font-bold text-[#08C99B] dark:text-white/90">
                  {t('simNetFormula')}
                </div>
              </div>
            </div>

            {/* Live Formula Walkthrough Card */}
            <div className="bg-white dark:bg-[#122543] rounded-2xl p-6 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs space-y-4">
              <h3 className="text-sm font-extrabold text-[#0B1B32] dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#08C99B]" />
                <span>{t('simWalkthroughTitle')}</span>
              </h3>

              <div className="space-y-3 text-xs sm:text-sm">
                {/* 1. Total Sales */}
                <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#E2EAFA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-[#1764FF] text-white font-bold flex items-center justify-center text-xs">
                      1
                    </span>
                    <span className="text-[#243958] dark:text-slate-200 font-semibold">
                      {t('simRow1')}
                    </span>
                  </div>
                  <div className="text-[#0B1B32] dark:text-white font-bold font-mono-num">
                    {formatCurrency(calculations.cashSales, currency, language)} +{' '}
                    {formatCurrency(calculations.cardSales, currency, language)} ={' '}
                    <span className="text-[#1764FF] dark:text-[#7EB0FF]">
                      {formatCurrency(calculations.totalSales, currency, language)}
                    </span>
                  </div>
                </div>

                {/* 2. Remaining in Box */}
                <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#E2EAFA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-[#08C99B] text-[#0B1B32] font-bold flex items-center justify-center text-xs">
                      2
                    </span>
                    <span className="text-[#243958] dark:text-slate-200 font-semibold">
                      {t('simRow2')}
                    </span>
                  </div>
                  <div className="text-[#0B1B32] dark:text-white font-bold font-mono-num">
                    {formatCurrency(calculations.cashSales, currency, language)} −{' '}
                    {formatCurrency(calculations.expenses, currency, language)} ={' '}
                    <span className="text-[#048264] dark:text-[#3CE0B9]">
                      {formatCurrency(calculations.remainingInBox, currency, language)}
                    </span>
                  </div>
                </div>

                {/* 3. Net Period */}
                <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#E2EAFA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-[#0B1B32] dark:bg-[#1764FF] text-white font-bold flex items-center justify-center text-xs">
                      3
                    </span>
                    <span className="text-[#243958] dark:text-slate-200 font-semibold">
                      {t('simRow3')}
                    </span>
                  </div>
                  <div className="text-[#0B1B32] dark:text-white font-bold font-mono-num">
                    {formatCurrency(calculations.totalSales, currency, language)} −{' '}
                    {formatCurrency(calculations.expenses, currency, language)} ={' '}
                    <span className="text-[#048264] dark:text-[#3CE0B9]">
                      {formatCurrency(calculations.netPeriod, currency, language)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status Footer */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#526785] dark:text-slate-300">
                <span>{t('simStatusBalanced')}</span>
                <span className="font-bold text-[#048264] dark:text-[#3CE0B9]">
                  {t('simStatusZeroDiff')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
