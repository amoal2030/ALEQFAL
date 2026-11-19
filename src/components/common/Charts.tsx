import React from 'react';
import { ShiftClosing } from '../../types';
import { formatCurrency } from '../../utils/accounting';

interface FinancialChartsProps {
  closings: ShiftClosing[];
  currency: string;
  language: 'ar' | 'en' | 'ur';
}

export const FinancialCharts: React.FC<FinancialChartsProps> = ({
  closings,
  currency,
  language,
}) => {
  const tr = (ar: string, en: string, ur: string) =>
    language === 'en' ? en : language === 'ur' ? ur : ar;

  // Aggregate data by date (last 7 days)
  const last7DaysMap = new Map<string, { date: string; cash: number; card: number; total: number }>();

  // Sort closings by date
  const sorted = [...closings].sort((a, b) => a.date.localeCompare(b.date));

  sorted.forEach((c) => {
    const existing = last7DaysMap.get(c.date) || { date: c.date, cash: 0, card: 0, total: 0 };
    existing.cash += c.cashSales;
    existing.card += c.cardSales;
    existing.total += c.totalSales;
    last7DaysMap.set(c.date, existing);
  });

  const dailyData = Array.from(last7DaysMap.values()).slice(-7);
  const maxSales = Math.max(...dailyData.map((d) => d.total), 100);

  // Totals for cash vs card split
  const totalCash = closings.reduce((sum, c) => sum + c.cashSales, 0);
  const totalCard = closings.reduce((sum, c) => sum + c.cardSales, 0);
  const grandTotal = totalCash + totalCard;
  const cashPercentage = grandTotal > 0 ? Math.round((totalCash / grandTotal) * 100) : 50;
  const cardPercentage = grandTotal > 0 ? 100 - cashPercentage : 50;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 1. Daily Sales Trend Chart (2 Cols) */}
      <div className="lg:col-span-2 bg-white dark:bg-[#122543] rounded-2xl p-5 sm:p-6 border border-[#DCE6FA] dark:border-[#1F3B66] shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
          <div>
            <h4 className="text-sm font-extrabold text-[#0B1B32] dark:text-white">
              {tr(
                'حركة المبيعات اليومية (النقد والشبكة)',
                'Daily Sales Trend (Cash & Card)',
                'روزانہ فروخت کا رجحان (نقد اور کارڈ)'
              )}
            </h4>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {tr(
                'مقارنة الإيرادات اليومية المعتمدة',
                'Comparison of approved daily revenue',
                'منظور شدہ روزانہ آمدنی کا موازنہ'
              )}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-[#1764FF] dark:text-[#6CA2FF] font-bold">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#1764FF]" />
              {tr('النقد (كاش)', 'Cash', 'نقد (کیش)')}
            </span>
            <span className="flex items-center gap-1.5 text-[#048264] dark:text-[#08C99B] font-bold">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#08C99B]" />
              {tr('الشبكة (مدى/بطاقات)', 'Card / POS', 'کارڈ / نیٹ ورک')}
            </span>
          </div>
        </div>

        {dailyData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-xs text-slate-400">
            {tr(
              'لا توجد بيانات مسجلة كافية لعرض الرسم البياني بعد',
              'Not enough recorded data to display the chart yet',
              'چارٹ دکھانے کے لیے ابھی کافی ریکارڈ شدہ ڈیٹا موجود نہیں ہے'
            )}
          </div>
        ) : (
          <div className="h-52 flex items-end justify-between gap-2 sm:gap-4 pt-6 pb-2 px-2">
            {dailyData.map((d, idx) => {
              const heightTotal = Math.round((d.total / maxSales) * 100);
              const cashShare = d.total > 0 ? (d.cash / d.total) * 100 : 50;
              const cardShare = 100 - cashShare;

              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                  {/* Tooltip on hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-[#0B1B32] text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-md pointer-events-none whitespace-nowrap mb-1 border border-[#1F3B66]">
                    <div className="text-slate-300 font-mono-num">{d.date}</div>
                    <div className="font-bold text-[#08C99B] font-mono-num">
                      {formatCurrency(d.total, currency, language)}
                    </div>
                  </div>

                  {/* Dual Bar */}
                  <div
                    className="w-full max-w-[40px] rounded-t-lg overflow-hidden flex flex-col justify-end transition-all duration-300 group-hover:brightness-105 bg-[#F5F8FF] dark:bg-[#0E203A]"
                    style={{ height: `${Math.max(heightTotal, 8)}%` }}
                  >
                    <div
                      className="w-full bg-[#08C99B] transition-all"
                      style={{ height: `${cardShare}%` }}
                      title={`${tr('شبكة', 'Card', 'کارڈ')}: ${d.card}`}
                    />
                    <div
                      className="w-full bg-[#1764FF] transition-all"
                      style={{ height: `${cashShare}%` }}
                      title={`${tr('نقد', 'Cash', 'نقد')}: ${d.cash}`}
                    />
                  </div>

                  <span className="text-[10px] font-mono-num text-slate-500 dark:text-slate-400 truncate max-w-[50px]">
                    {d.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Cash vs Network Distribution Split */}
      <div className="bg-white dark:bg-[#122543] rounded-2xl p-5 sm:p-6 border border-[#DCE6FA] dark:border-[#1F3B66] shadow-xs space-y-5 flex flex-col justify-between">
        <div>
          <h4 className="text-sm font-extrabold text-[#0B1B32] dark:text-white pb-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
            {tr(
              'توزيع قنوات الدفع (نقد مقابل شبكة)',
              'Payment Channel Mix (Cash vs Card)',
              'ادائیگی کے ذرائع کی تقسیم (نقد بمقابلہ کارڈ)'
            )}
          </h4>
          <span className="text-xs text-slate-500 dark:text-slate-400 mt-2 block">
            {tr(
              'نسبة السيولة النقدية مقابل المدفوعات الإلكترونية',
              'Ratio of cash liquidity vs electronic card payments',
              'نقد رقم اور الیکٹرانک ادائیگیوں کا تناسب'
            )}
          </span>
        </div>

        {grandTotal === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400">
            {tr(
              'سيتم احتساب النسبة فور اعتماد أول إقفال',
              'Split will be calculated once the first closing is approved',
              'پہلی کلوزنگ منظور ہوتے ہی تناسب خودکار حساب ہو جائے گا'
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Split Progress Bar */}
            <div className="h-3.5 w-full rounded-full bg-[#F5F8FF] dark:bg-[#0E203A] overflow-hidden flex">
              <div
                className="bg-[#1764FF] transition-all duration-500"
                style={{ width: `${cashPercentage}%` }}
              />
              <div
                className="bg-[#08C99B] transition-all duration-500"
                style={{ width: `${cardPercentage}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#1764FF]/12 border border-[#DCE6FA] dark:border-[#1764FF]/30">
                <span className="text-[11px] text-[#1764FF] dark:text-[#6CA2FF] font-bold block mb-1">
                  {tr('النقد (كاش)', 'Cash', 'نقد')} {cashPercentage}%
                </span>
                <span className="text-sm sm:text-base font-extrabold text-[#0B1B32] dark:text-white font-mono-num">
                  {formatCurrency(totalCash, currency, language)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#08C99B]/10 dark:bg-[#08C99B]/12 border border-[#08C99B]/30">
                <span className="text-[11px] text-[#048264] dark:text-[#08C99B] font-bold block mb-1">
                  {tr('الشبكة (مدى)', 'Card / POS', 'کارڈ')} {cardPercentage}%
                </span>
                <span className="text-sm sm:text-base font-extrabold text-[#0B1B32] dark:text-white font-mono-num">
                  {formatCurrency(totalCard, currency, language)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="text-[11px] font-semibold text-[#048264] dark:text-[#08C99B] p-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-center">
          {tr(
            'مطابقة تامة بدقة الهللات',
            'Exact sub-unit precision reconciliation',
            'مکمل اور درست اعشاریہ مطابقت'
          )}
        </div>
      </div>
    </div>
  );
};
