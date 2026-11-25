import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Building2,
  Calendar,
  Download,
  FileText,
  Phone,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { UserProfile } from '../../types';
import type {
  PayrollAuditLog,
  PayrollItem,
  PayrollPayment,
  Worker,
  WorkerAddition,
  WorkerAdvance,
} from '../../types/workersPayroll';
import { computeWorkerFinancialStatement } from '../../services/workersPayrollReportService';
import { formatCurrency } from '../../utils/accounting';
import {
  getAdditionCategoryLabel,
  getAdditionStatusLabel,
  getAuditActionLabel,
  getDisbursementStatusLabel,
  getPaymentMethodLabel,
  getProofSyncStatusLabel,
  getWorkerStatusLabel,
} from './payrollUiHelpers';

type ProfileSectionTab =
  | 'overview'
  | 'advances'
  | 'additions'
  | 'payrolls'
  | 'payments'
  | 'audit';

export interface WorkerFinancialProfileModalProps {
  actor: UserProfile;
  worker: Worker;
  advances: WorkerAdvance[];
  additions: WorkerAddition[];
  payrollItems: PayrollItem[];
  payments: PayrollPayment[];
  auditLogs: PayrollAuditLog[];
  currency: string;
  isAr: boolean;
  onClose: () => void;
  onDownloadDriveProof?: (fileId: string, expectedRecordId: string, fileName: string) => void;
}

export const WorkerFinancialProfileModal: React.FC<WorkerFinancialProfileModalProps> = ({
  actor,
  worker,
  advances,
  additions,
  payrollItems,
  payments,
  auditLogs,
  currency,
  isAr,
  onClose,
  onDownloadDriveProof,
}) => {
  const [section, setSection] = useState<ProfileSectionTab>('overview');

  const statement = useMemo(
    () =>
      computeWorkerFinancialStatement({
        actor,
        worker,
        advances,
        additions,
        payrollItems,
        payments,
      }),
    [actor, worker, advances, additions, payrollItems, payments]
  );

  const workerAuditLogs = useMemo(
    () =>
      auditLogs
        .filter((l) => l.workerId === worker.id || l.targetId === worker.id)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [auditLogs, worker.id]
  );

  const fmt = (amount: number) => formatCurrency(amount, currency);
  const transferHistory = worker.branchTransferHistory || [];

  const subTabClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
      active
        ? 'bg-[#1764FF] text-white'
        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#173056]'
    }`;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={isAr ? `الملف المالي للعامل ${worker.fullName}` : `Financial Profile: ${worker.fullName}`}
    >
      <div className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E6EEFC] dark:border-[#1B345B] flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-[#0B1B32] dark:text-white truncate">
              {worker.fullName}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="tabular-nums">
                {isAr ? 'الرقم الوظيفي:' : 'Employee #:'} <strong className="text-slate-700 dark:text-slate-200">{worker.employeeNumber}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                {worker.currentBranchName}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-semibold ${
                  worker.status === 'active'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : worker.status === 'suspended'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {getWorkerStatusLabel(worker.status, isAr)}
              </span>
              {worker.phone && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 tabular-nums" dir="ltr">
                    <Phone className="w-3.5 h-3.5" />
                    {worker.phone}
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Calendar className="w-3.5 h-3.5" />
                {isAr ? 'تاريخ التعيين:' : 'Hired:'} {worker.hireDate}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#173056] transition-colors shrink-0"
            aria-label={isAr ? 'إغلاق' : 'Close'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary KPI Strip */}
        <div className="px-5 py-3.5 bg-[#F8FAFF] dark:bg-[#0B192E] border-b border-[#E6EEFC] dark:border-[#1B345B] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isAr ? 'الراتب الأساسي' : 'Base Salary'}
            </p>
            <p className="text-sm font-bold text-[#0B1B32] dark:text-white tabular-nums mt-0.5">
              {fmt(worker.monthlySalary)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isAr ? 'السحبيات النشطة' : 'Active Advances'}
            </p>
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">
              {fmt(statement.activeAdvancesTotal)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isAr ? 'إجمالي المستحق' : 'Total Net Payable'}
            </p>
            <p className="text-sm font-bold text-[#0B1B32] dark:text-white tabular-nums mt-0.5">
              {fmt(statement.totalNetPayableAcrossMonths)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isAr ? 'إجمالي المصروف' : 'Total Paid'}
            </p>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">
              {fmt(statement.totalPaidAcrossMonths)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isAr ? 'المتبقي للصرف' : 'Remaining'}
            </p>
            <p className="text-sm font-bold text-[#1764FF] dark:text-[#6CA2FF] tabular-nums mt-0.5">
              {fmt(statement.totalRemainingAcrossMonths)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isAr ? 'الرصيد المرحّل الحالي' : 'Carry-Over Balance'}
            </p>
            <p className="text-sm font-bold text-rose-700 dark:text-rose-400 tabular-nums mt-0.5">
              {fmt(statement.latestCarryOverOut)}
            </p>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="px-5 py-2.5 border-b border-[#E6EEFC] dark:border-[#1B345B] flex items-center gap-1.5 overflow-x-auto">
          <button type="button" onClick={() => setSection('overview')} className={subTabClass(section === 'overview')}>
            {isAr ? `سجل الفروع (${transferHistory.length})` : `Branches (${transferHistory.length})`}
          </button>
          <button type="button" onClick={() => setSection('advances')} className={subTabClass(section === 'advances')}>
            {isAr ? `السلف والسحبيات (${statement.advances.length})` : `Advances (${statement.advances.length})`}
          </button>
          <button type="button" onClick={() => setSection('additions')} className={subTabClass(section === 'additions')}>
            {isAr ? `المكافآت والبدلات (${statement.additions.length})` : `Additions (${statement.additions.length})`}
          </button>
          <button type="button" onClick={() => setSection('payrolls')} className={subTabClass(section === 'payrolls')}>
            {isAr ? `كشوف الرواتب (${statement.payrollItems.length})` : `Payroll Statements (${statement.payrollItems.length})`}
          </button>
          <button type="button" onClick={() => setSection('payments')} className={subTabClass(section === 'payments')}>
            {isAr ? `دفعات الصرف (${statement.payments.length})` : `Payments (${statement.payments.length})`}
          </button>
          <button type="button" onClick={() => setSection('audit')} className={subTabClass(section === 'audit')}>
            {isAr ? `سجل التدقيق (${workerAuditLogs.length})` : `Audit Log (${workerAuditLogs.length})`}
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5 text-sm">
          {section === 'overview' && (
            <div className="space-y-5">
              {worker.notes && (
                <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-slate-700 dark:text-slate-200">
                  <strong className="block mb-1">{isAr ? 'ملاحظات العامل:' : 'Worker Notes:'}</strong>
                  {worker.notes}
                </div>
              )}

              <div>
                <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2.5 flex items-center gap-1.5">
                  <ArrowLeftRight className="w-4 h-4 text-[#1764FF]" />
                  {isAr ? 'سجل التنقل بين الفروع' : 'Branch Transfer History'}
                </h3>
                {transferHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isAr
                      ? 'لم يتم نقل العامل من فرعه الأول حتى الآن.'
                      : 'This worker has not been transferred to another branch yet.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-[#E6EEFC] dark:border-[#1B345B] rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                        <tr>
                          <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'التاريخ' : 'Date'}</th>
                          <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'من فرع' : 'From'}</th>
                          <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'إلى فرع' : 'To'}</th>
                          <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'بواسطة' : 'By'}</th>
                          <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'السبب' : 'Reason'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                        {transferHistory.map((tr, idx) => (
                          <tr key={`${tr.transferredAt}_${idx}`}>
                            <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">{tr.transferredAt.slice(0, 10)}</td>
                            <td className="py-2.5 px-3">{tr.fromBranchName}</td>
                            <td className="py-2.5 px-3 font-semibold text-[#1764FF] dark:text-[#6CA2FF]">{tr.toBranchName}</td>
                            <td className="py-2.5 px-3">{tr.transferredByName}</td>
                            <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{tr.reason || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2.5 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-[#1764FF]" />
                  {isAr ? 'ملخص الفروع التي سُجّلت فيها سحبيات للعامل' : 'Branches with Recorded Advances'}
                </h3>
                {statement.branchesWorkedIn.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isAr ? 'لا توجد سحبيات مسجلة على أي فرع بعد.' : 'No branch advances recorded yet.'}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {statement.branchesWorkedIn.map((b) => (
                      <div
                        key={b.branchId}
                        className="p-3 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                      >
                        <p className="text-xs font-bold text-[#0B1B32] dark:text-white">{b.branchName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                          {isAr ? `عدد السحبيات: ${b.advancesCount}` : `Advances: ${b.advancesCount}`} ·{' '}
                          <strong className="text-slate-800 dark:text-slate-100">{fmt(b.advancesTotal)}</strong>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {section === 'advances' && (
            statement.advances.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                {isAr ? 'لا توجد سلف أو سحبيات مسجلة لهذا العامل.' : 'No advances recorded for this worker.'}
              </p>
            ) : (
              <div className="overflow-x-auto border border-[#E6EEFC] dark:border-[#1B345B] rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'التاريخ' : 'Date'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الفرع الأصلي' : 'Original Branch'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'المبلغ' : 'Amount'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الطريقة' : 'Method'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'السبب' : 'Reason'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الحالة والتسوية' : 'Status'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الإثبات' : 'Proof'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {statement.advances.map((adv) => (
                      <tr key={adv.id} className={adv.status === 'cancelled' ? 'opacity-65' : ''}>
                        <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">{adv.date}</td>
                        <td className="py-2.5 px-3">{adv.branchNameSnapshot}</td>
                        <td className="py-2.5 px-3 font-bold tabular-nums">{fmt(adv.amount)}</td>
                        <td className="py-2.5 px-3">{getPaymentMethodLabel(adv.paymentMethod, isAr)}</td>
                        <td className="py-2.5 px-3 max-w-xs">
                          <div>{adv.reason}</div>
                          {adv.cancellationReason && (
                            <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">
                              {isAr ? 'سبب الإلغاء:' : 'Cancel reason:'} {adv.cancellationReason}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {adv.status === 'cancelled' ? (
                            <span className="text-rose-600 dark:text-rose-400 font-semibold">
                              {isAr ? 'ملغاة' : 'Cancelled'}
                            </span>
                          ) : adv.payrollSettledYearMonth ? (
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                              {isAr ? `مسوّاة (${adv.payrollSettledYearMonth})` : `Settled (${adv.payrollSettledYearMonth})`}
                            </span>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-400 font-semibold">
                              {isAr ? 'نشطة (غير مسوّاة)' : 'Active (Unsettled)'}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {adv.proofAttachment ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-slate-600 dark:text-slate-300">
                                {getProofSyncStatusLabel(adv.proofAttachment.syncStatus, isAr)}
                              </span>
                              {adv.proofAttachment.syncStatus === 'uploaded' &&
                                adv.proofAttachment.driveFileId &&
                                onDownloadDriveProof && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onDownloadDriveProof(
                                        adv.proofAttachment!.driveFileId!,
                                        adv.id,
                                        adv.proofAttachment!.fileName
                                      )
                                    }
                                    className="text-[#1764FF] hover:underline inline-flex items-center gap-1"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {section === 'additions' && (
            statement.additions.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                {isAr ? 'لا توجد مكافآت أو بدلات مسجلة لهذا العامل.' : 'No bonuses or allowances recorded for this worker.'}
              </p>
            ) : (
              <div className="overflow-x-auto border border-[#E6EEFC] dark:border-[#1B345B] rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'المسمى' : 'Label'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'النوع' : 'Category'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'التكرار والفترة' : 'Recurrence'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'المبلغ' : 'Amount'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الحالة' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {statement.additions.map((add) => (
                      <tr key={add.id}>
                        <td className="py-2.5 px-3 font-semibold">{add.label}</td>
                        <td className="py-2.5 px-3">{getAdditionCategoryLabel(add.category, isAr)}</td>
                        <td className="py-2.5 px-3 tabular-nums">
                          {add.recurrence === 'one_time'
                            ? isAr
                              ? `مرة واحدة (${add.targetYearMonth})`
                              : `One-time (${add.targetYearMonth})`
                            : isAr
                            ? `متكرر شهرياً من ${add.startYearMonth}${add.endYearMonth ? ` إلى ${add.endYearMonth}` : ''}`
                            : `Recurring from ${add.startYearMonth}${add.endYearMonth ? ` to ${add.endYearMonth}` : ''}`}
                        </td>
                        <td className="py-2.5 px-3 font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {fmt(add.amount)}
                        </td>
                        <td className="py-2.5 px-3">{getAdditionStatusLabel(add.status, isAr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {section === 'payrolls' && (
            statement.payrollItems.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                {isAr ? 'لا توجد كشوف رواتب شهرية لهذا العامل بعد.' : 'No monthly payroll statements yet.'}
              </p>
            ) : (
              <div className="overflow-x-auto border border-[#E6EEFC] dark:border-[#1B345B] rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الشهر' : 'Month'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الأساسي' : 'Base'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الإضافات' : 'Additions'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'السحبيات' : 'Advances'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'مرحّل سابق' : 'Carry In'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'صافي المستحق' : 'Net Payable'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'المصروف' : 'Paid'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'مرحّل قادم' : 'Carry Out'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الحالة' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {statement.payrollItems.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2.5 px-3 font-semibold tabular-nums whitespace-nowrap">
                          {item.yearMonth}
                          {item.isAdminCorrected && (
                            <span className="block text-[10px] text-amber-700 dark:text-amber-400">
                              {isAr ? `مصحح إدارياً (${item.correctionCount || 1})` : `Admin corrected (${item.correctionCount || 1})`}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums">{fmt(item.baseSalary)}</td>
                        <td className="py-2.5 px-3 tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(item.additionsTotal)}</td>
                        <td className="py-2.5 px-3 tabular-nums text-amber-700 dark:text-amber-400">{fmt(item.advancesTotal)}</td>
                        <td className="py-2.5 px-3 tabular-nums">{fmt(item.carryOverIn)}</td>
                        <td className="py-2.5 px-3 tabular-nums font-bold">{fmt(item.netPayable)}</td>
                        <td className="py-2.5 px-3 tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(item.paidAmount)}</td>
                        <td className="py-2.5 px-3 tabular-nums text-rose-700 dark:text-rose-400">{fmt(item.carryOverOut)}</td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {item.status === 'draft'
                            ? isAr
                              ? 'مسودة'
                              : 'Draft'
                            : getDisbursementStatusLabel(item.disbursementStatus, isAr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {section === 'payments' && (
            statement.payments.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                {isAr ? 'لا توجد دفعات صرف مسجلة لهذا العامل بعد.' : 'No salary payments recorded yet.'}
              </p>
            ) : (
              <div className="overflow-x-auto border border-[#E6EEFC] dark:border-[#1B345B] rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'التاريخ' : 'Date'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'عن شهر' : 'Month'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'المبلغ' : 'Amount'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الطريقة' : 'Method'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'الحالة' : 'Status'}</th>
                      <th className="py-2.5 px-3 text-start font-semibold">{isAr ? 'ملاحظات / إثبات' : 'Notes / Proof'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {statement.payments.map((pay) => (
                      <tr key={pay.id} className={pay.status === 'reversed' ? 'opacity-65' : ''}>
                        <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">{pay.paymentDate}</td>
                        <td className="py-2.5 px-3 tabular-nums">{pay.yearMonth}</td>
                        <td className="py-2.5 px-3 font-bold tabular-nums">{fmt(pay.amount)}</td>
                        <td className="py-2.5 px-3">{getPaymentMethodLabel(pay.paymentMethod, isAr)}</td>
                        <td className="py-2.5 px-3">
                          {pay.status === 'reversed'
                            ? isAr
                              ? 'معكوسة'
                              : 'Reversed'
                            : isAr
                            ? 'مصروفة'
                            : 'Recorded'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div>{pay.notes || '—'}</div>
                          {pay.reversalReason && (
                            <div className="text-[11px] text-rose-600 dark:text-rose-400">
                              {isAr ? 'سبب العكس:' : 'Reversal:'} {pay.reversalReason}
                            </div>
                          )}
                          {pay.proofAttachment && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5">
                              <span>{getProofSyncStatusLabel(pay.proofAttachment.syncStatus, isAr)}</span>
                              {pay.proofAttachment.syncStatus === 'uploaded' &&
                                pay.proofAttachment.driveFileId &&
                                onDownloadDriveProof && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onDownloadDriveProof(
                                        pay.proofAttachment!.driveFileId!,
                                        pay.id,
                                        pay.proofAttachment!.fileName
                                      )
                                    }
                                    className="text-[#1764FF] hover:underline inline-flex items-center gap-1"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {section === 'audit' && (
            workerAuditLogs.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                {isAr ? 'لا توجد قيود تدقيق لهذا العامل بعد.' : 'No audit log entries for this worker yet.'}
              </p>
            ) : (
              <div className="space-y-2.5">
                {workerAuditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-xl border border-[#E6EEFC] dark:border-[#1B345B] bg-[#F8FAFF] dark:bg-[#122543] space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-[#0B1B32] dark:text-white inline-flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#1764FF]" />
                        {getAuditActionLabel(log.action, isAr)}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {log.actorName} · {log.timestamp.replace('T', ' ').slice(0, 16)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-200">{log.details}</p>
                    {log.reason && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                        {isAr ? 'السبب الموثق:' : 'Documented reason:'} {log.reason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#E6EEFC] dark:border-[#1B345B] flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {isAr
              ? `معرّف العامل الثابت: ${worker.id}`
              : `Permanent Worker ID: ${worker.id}`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-200 dark:hover:bg-[#1E3B6B] transition-colors"
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
