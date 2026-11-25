/**
 * Workers & Payroll Reports & Excel Export Service — الإقفال | AL EQFAL
 *
 * Provides Manager-only analytics, branch-level breakdowns (strictly attributing
 * historical advances to their transaction-time `branchId`), full cross-branch
 * worker financial statements, and multi-sheet RTL Arabic Excel (.xlsx) exports.
 */
import ExcelJS from 'exceljs';
import type { Branch, Organization, UserProfile } from '../types';
import type {
  PayrollBranchBreakdown,
  PayrollItem,
  PayrollPayment,
  Worker,
  WorkerAddition,
  WorkerAdvance,
  WorkerFinancialStatement,
  WorkersPayrollSummaryReport,
} from '../types/workersPayroll';
import { fromHalalas } from '../utils/accounting';
import {
  assertManagerPayrollAccess,
  assertValidYearMonth,
  DISBURSEMENT_STATUS_LABELS_AR,
  PAYMENT_METHOD_LABELS_AR,
  WORKER_STATUS_LABELS_AR,
} from '../utils/workersPayrollEngine';

/**
 * Computes the organization manager's comprehensive monthly payroll summary & branch breakdown.
 * - Counts active workers across the organization.
 * - Aggregates base salaries, additions, active (non-cancelled) advances, deductions, net payable,
 *   carry-over, paid, and remaining amounts in integer Halalas.
 * - Branch breakdown attributes each advance strictly to its historical `branchId` (not current branch!).
 */
export function computeWorkersPayrollSummaryReport(params: {
  actor: UserProfile;
  orgId: string;
  yearMonth: string;
  branches: Branch[];
  workers: Worker[];
  advances: WorkerAdvance[];
  payrollItems: PayrollItem[];
}): WorkersPayrollSummaryReport {
  assertManagerPayrollAccess(params.actor, params.orgId);
  const cleanYearMonth = assertValidYearMonth(params.yearMonth);

  const orgBranches = params.branches.filter((b) => b.orgId === params.orgId);
  const branchNameMap = new Map<string, string>();
  for (const b of orgBranches) {
    branchNameMap.set(b.id, b.name);
  }

  const orgWorkers = params.workers.filter((w) => w.orgId === params.orgId);
  const activeWorkers = orgWorkers.filter((w) => w.status === 'active');

  const monthItems = params.payrollItems.filter(
    (item) => item.orgId === params.orgId && item.yearMonth === cleanYearMonth
  );
  const activeMonthAdvances = params.advances.filter(
    (adv) =>
      adv.orgId === params.orgId &&
      adv.yearMonth === cleanYearMonth &&
      adv.status === 'active'
  );

  // Branch accumulator map
  const branchAcc = new Map<
    string,
    {
      branchId: string;
      branchName: string;
      activeWorkersCount: number;
      baseSalaryHalalas: number;
      additionsHalalas: number;
      advancesHalalas: number;
      netPayableHalalas: number;
      paidAmountHalalas: number;
      remainingPayableHalalas: number;
    }
  >();

  const ensureBranchBucket = (branchId: string, fallbackName?: string) => {
    let bucket = branchAcc.get(branchId);
    if (!bucket) {
      bucket = {
        branchId,
        branchName: branchNameMap.get(branchId) || fallbackName || branchId,
        activeWorkersCount: 0,
        baseSalaryHalalas: 0,
        additionsHalalas: 0,
        advancesHalalas: 0,
        netPayableHalalas: 0,
        paidAmountHalalas: 0,
        remainingPayableHalalas: 0,
      };
      branchAcc.set(branchId, bucket);
    }
    return bucket;
  };

  for (const b of orgBranches) {
    ensureBranchBucket(b.id, b.name);
  }

  for (const w of activeWorkers) {
    const bucket = ensureBranchBucket(w.currentBranchId, w.currentBranchName);
    bucket.activeWorkersCount += 1;
  }

  // Attribute active advances strictly to their HISTORICAL branchId
  let totalAdvancesHalalas = 0;
  for (const adv of activeMonthAdvances) {
    totalAdvancesHalalas += adv.amountHalalas;
    const bucket = ensureBranchBucket(adv.branchId, adv.branchNameSnapshot);
    bucket.advancesHalalas += adv.amountHalalas;
  }

  let totalBaseSalaryHalalas = 0;
  let totalAdditionsHalalas = 0;
  let totalCarryOverInHalalas = 0;
  let totalDeductionsHalalas = 0;
  let totalNetPayableHalalas = 0;
  let totalCarryOverOutHalalas = 0;
  let totalPaidHalalas = 0;
  let totalRemainingHalalas = 0;

  if (monthItems.length > 0) {
    for (const item of monthItems) {
      totalBaseSalaryHalalas += item.baseSalaryHalalas;
      totalAdditionsHalalas += item.additionsTotalHalalas;
      totalCarryOverInHalalas += item.carryOverInHalalas;
      totalDeductionsHalalas += item.deductedAmountHalalas;
      totalNetPayableHalalas += item.netPayableHalalas;
      totalCarryOverOutHalalas += item.carryOverOutHalalas;
      totalPaidHalalas += item.paidAmountHalalas;
      totalRemainingHalalas += item.remainingPayableHalalas;

      const bucket = ensureBranchBucket(item.branchIdSnapshot, item.branchNameSnapshot);
      bucket.baseSalaryHalalas += item.baseSalaryHalalas;
      bucket.additionsHalalas += item.additionsTotalHalalas;
      bucket.netPayableHalalas += item.netPayableHalalas;
      bucket.paidAmountHalalas += item.paidAmountHalalas;
      bucket.remainingPayableHalalas += item.remainingPayableHalalas;
    }
  } else {
    // Before a monthly run is drafted, still report active baseline salaries per branch
    for (const w of activeWorkers) {
      totalBaseSalaryHalalas += w.monthlySalaryHalalas;
      const bucket = ensureBranchBucket(w.currentBranchId, w.currentBranchName);
      bucket.baseSalaryHalalas += w.monthlySalaryHalalas;
    }
  }

  const byBranch: PayrollBranchBreakdown[] = Array.from(branchAcc.values())
    .map((b) => ({
      branchId: b.branchId,
      branchName: b.branchName,
      activeWorkersCount: b.activeWorkersCount,
      baseSalary: fromHalalas(b.baseSalaryHalalas),
      baseSalaryHalalas: b.baseSalaryHalalas,
      additions: fromHalalas(b.additionsHalalas),
      additionsHalalas: b.additionsHalalas,
      advances: fromHalalas(b.advancesHalalas),
      advancesHalalas: b.advancesHalalas,
      netPayable: fromHalalas(b.netPayableHalalas),
      netPayableHalalas: b.netPayableHalalas,
      paidAmount: fromHalalas(b.paidAmountHalalas),
      paidAmountHalalas: b.paidAmountHalalas,
      remainingPayable: fromHalalas(b.remainingPayableHalalas),
      remainingPayableHalalas: b.remainingPayableHalalas,
    }))
    .sort((a, b) => a.branchName.localeCompare(b.branchName, 'ar'));

  return {
    orgId: params.orgId,
    yearMonth: cleanYearMonth,
    activeWorkersCount: activeWorkers.length,
    totalWorkersInPayroll: monthItems.length,
    totalBaseSalary: fromHalalas(totalBaseSalaryHalalas),
    totalBaseSalaryHalalas,
    totalAdvances: fromHalalas(totalAdvancesHalalas),
    totalAdvancesHalalas,
    totalAdditions: fromHalalas(totalAdditionsHalalas),
    totalAdditionsHalalas,
    totalCarryOverIn: fromHalalas(totalCarryOverInHalalas),
    totalCarryOverInHalalas,
    totalDeductions: fromHalalas(totalDeductionsHalalas),
    totalDeductionsHalalas,
    totalNetPayable: fromHalalas(totalNetPayableHalalas),
    totalNetPayableHalalas,
    totalCarryOverOut: fromHalalas(totalCarryOverOutHalalas),
    totalCarryOverOutHalalas,
    totalPaid: fromHalalas(totalPaidHalalas),
    totalPaidHalalas,
    totalRemaining: fromHalalas(totalRemainingHalalas),
    totalRemainingHalalas,
    byBranch,
  };
}

/**
 * Builds a complete, cross-branch historical financial statement for a single worker (Manager only).
 * Preserves every branch the worker ever received advances in, even after branch transfers.
 */
export function computeWorkerFinancialStatement(params: {
  actor: UserProfile;
  worker: Worker;
  advances: WorkerAdvance[];
  additions: WorkerAddition[];
  payrollItems: PayrollItem[];
  payments: PayrollPayment[];
}): WorkerFinancialStatement {
  assertManagerPayrollAccess(params.actor, params.worker.orgId);

  const workerAdvances = params.advances
    .filter((a) => a.orgId === params.worker.orgId && a.workerId === params.worker.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const workerAdditions = params.additions
    .filter((ad) => ad.orgId === params.worker.orgId && ad.workerId === params.worker.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const workerItems = params.payrollItems
    .filter((i) => i.orgId === params.worker.orgId && i.workerId === params.worker.id)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  const workerPayments = params.payments
    .filter((p) => p.orgId === params.worker.orgId && p.workerId === params.worker.id)
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));

  let activeAdvancesTotalHalalas = 0;
  let cancelledAdvancesTotalHalalas = 0;
  const branchHistoryMap = new Map<
    string,
    { branchId: string; branchName: string; advancesCount: number; advancesHalalas: number }
  >();

  for (const adv of workerAdvances) {
    if (adv.status === 'active') {
      activeAdvancesTotalHalalas += adv.amountHalalas;
      const existing = branchHistoryMap.get(adv.branchId) || {
        branchId: adv.branchId,
        branchName: adv.branchNameSnapshot,
        advancesCount: 0,
        advancesHalalas: 0,
      };
      existing.advancesCount += 1;
      existing.advancesHalalas += adv.amountHalalas;
      branchHistoryMap.set(adv.branchId, existing);
    } else {
      cancelledAdvancesTotalHalalas += adv.amountHalalas;
    }
  }

  let totalNetPayableAcrossMonthsHalalas = 0;
  let totalPaidAcrossMonthsHalalas = 0;
  let totalRemainingAcrossMonthsHalalas = 0;

  for (const item of workerItems) {
    if (item.status !== 'approved') continue;
    totalNetPayableAcrossMonthsHalalas += item.netPayableHalalas;
    totalPaidAcrossMonthsHalalas += item.paidAmountHalalas;
    totalRemainingAcrossMonthsHalalas += item.remainingPayableHalalas;
  }

  const latestApprovedItem = workerItems.find((i) => i.status === 'approved') || null;
  const latestCarryOverOutHalalas = latestApprovedItem ? latestApprovedItem.carryOverOutHalalas : 0;

  return {
    worker: params.worker,
    advances: workerAdvances,
    activeAdvancesTotal: fromHalalas(activeAdvancesTotalHalalas),
    activeAdvancesTotalHalalas,
    cancelledAdvancesTotal: fromHalalas(cancelledAdvancesTotalHalalas),
    cancelledAdvancesTotalHalalas,
    additions: workerAdditions,
    payrollItems: workerItems,
    payments: workerPayments,
    totalNetPayableAcrossMonths: fromHalalas(totalNetPayableAcrossMonthsHalalas),
    totalNetPayableAcrossMonthsHalalas,
    totalPaidAcrossMonths: fromHalalas(totalPaidAcrossMonthsHalalas),
    totalPaidAcrossMonthsHalalas,
    totalRemainingAcrossMonths: fromHalalas(totalRemainingAcrossMonthsHalalas),
    totalRemainingAcrossMonthsHalalas,
    latestCarryOverOut: fromHalalas(latestCarryOverOutHalalas),
    latestCarryOverOutHalalas,
    branchesWorkedIn: Array.from(branchHistoryMap.values()).map((b) => ({
      branchId: b.branchId,
      branchName: b.branchName,
      advancesCount: b.advancesCount,
      advancesTotal: fromHalalas(b.advancesHalalas),
    })),
  };
}

/**
 * Generates an RTL Arabic multi-sheet ExcelJS workbook for monthly payroll reporting & archiving.
 */
export async function buildMonthlyPayrollReportWorkbook(params: {
  org: Pick<Organization, 'name' | 'currency'>;
  report: WorkersPayrollSummaryReport;
  payrollItems: PayrollItem[];
  advances: WorkerAdvance[];
}): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AL EQFAL | الإقفال';
  wb.created = new Date();
  const currency = params.org.currency || 'SAR';

  // Sheet 1: Executive Summary
  const summarySheet = wb.addWorksheet('ملخص الرواتب', {
    views: [{ rightToLeft: true }],
  });
  summarySheet.columns = [
    { header: 'البند', key: 'metric', width: 34 },
    { header: `القيمة (${currency})`, key: 'value', width: 22 },
  ];
  summarySheet.addRows([
    { metric: 'المؤسسة', value: params.org.name },
    { metric: 'شهر التصفية', value: params.report.yearMonth },
    { metric: 'عدد العمال النشطين', value: params.report.activeWorkersCount },
    { metric: 'إجمالي الرواتب الأساسية', value: params.report.totalBaseSalary },
    { metric: 'إجمالي المكافآت والبدلات', value: params.report.totalAdditions },
    { metric: 'إجمالي السحبيات النشطة', value: params.report.totalAdvances },
    { metric: 'إجمالي المرحّل من أشهر سابقة', value: params.report.totalCarryOverIn },
    { metric: 'إجمالي الخصومات', value: params.report.totalDeductions },
    { metric: 'إجمالي صافي الرواتب المستحقة', value: params.report.totalNetPayable },
    { metric: 'إجمالي ما تم دفعه', value: params.report.totalPaid },
    { metric: 'إجمالي المبالغ المتبقية للصرف', value: params.report.totalRemaining },
    { metric: 'إجمالي المرحّل للشهر التالي', value: params.report.totalCarryOverOut },
  ]);

  // Sheet 2: Per-Worker Payroll Items
  const itemsSheet = wb.addWorksheet('كشوف رواتب العمال', {
    views: [{ rightToLeft: true }],
  });
  itemsSheet.columns = [
    { header: 'اسم العامل', key: 'workerName', width: 24 },
    { header: 'الرقم الوظيفي', key: 'empNo', width: 15 },
    { header: 'الفرع', key: 'branchName', width: 18 },
    { header: 'الحالة', key: 'workerStatus', width: 14 },
    { header: 'الراتب الأساسي', key: 'baseSalary', width: 15 },
    { header: 'الإضافات', key: 'additions', width: 14 },
    { header: 'السحبيات', key: 'advances', width: 14 },
    { header: 'المرحّل السابق', key: 'carryOverIn', width: 15 },
    { header: 'إجمالي المستحق', key: 'gross', width: 15 },
    { header: 'إجمالي الخصومات', key: 'deducted', width: 15 },
    { header: 'صافي الراتب', key: 'netPayable', width: 15 },
    { header: 'المرحّل للتالي', key: 'carryOverOut', width: 15 },
    { header: 'المدفوع', key: 'paid', width: 14 },
    { header: 'المتبقي', key: 'remaining', width: 14 },
    { header: 'حالة الصرف', key: 'disbursementStatus', width: 15 },
  ];
  for (const item of params.payrollItems) {
    itemsSheet.addRow({
      workerName: item.workerNameSnapshot,
      empNo: item.employeeNumberSnapshot,
      branchName: item.branchNameSnapshot,
      workerStatus: WORKER_STATUS_LABELS_AR[item.workerStatusSnapshot] || item.workerStatusSnapshot,
      baseSalary: item.baseSalary,
      additions: item.additionsTotal,
      advances: item.advancesTotal,
      carryOverIn: item.carryOverIn,
      gross: item.grossEntitlement,
      deducted: item.deductedAmount,
      netPayable: item.netPayable,
      carryOverOut: item.carryOverOut,
      paid: item.paidAmount,
      remaining: item.remainingPayable,
      disbursementStatus:
        DISBURSEMENT_STATUS_LABELS_AR[item.disbursementStatus] || item.disbursementStatus,
    });
  }

  // Sheet 3: Branch Breakdown
  const branchSheet = wb.addWorksheet('تقرير الفروع', {
    views: [{ rightToLeft: true }],
  });
  branchSheet.columns = [
    { header: 'الفرع', key: 'branchName', width: 22 },
    { header: 'العمال النشطون', key: 'activeWorkersCount', width: 15 },
    { header: 'الرواتب الأساسية', key: 'baseSalary', width: 16 },
    { header: 'الإضافات', key: 'additions', width: 14 },
    { header: 'السحبيات المسجلة بالفرع', key: 'advances', width: 20 },
    { header: 'صافي المستحق', key: 'netPayable', width: 16 },
    { header: 'المدفوع', key: 'paidAmount', width: 15 },
    { header: 'المتبقي', key: 'remainingPayable', width: 15 },
  ];
  for (const b of params.report.byBranch) {
    branchSheet.addRow(b);
  }

  // Sheet 4: Month Active Advances
  const advSheet = wb.addWorksheet('سجل السحبيات', {
    views: [{ rightToLeft: true }],
  });
  advSheet.columns = [
    { header: 'التاريخ', key: 'date', width: 14 },
    { header: 'العامل', key: 'workerName', width: 22 },
    { header: 'الفرع وقت السحب', key: 'branchName', width: 18 },
    { header: 'المبلغ', key: 'amount', width: 14 },
    { header: 'طريقة التسليم', key: 'method', width: 15 },
    { header: 'السبب', key: 'reason', width: 28 },
    { header: 'سجّلها', key: 'createdByName', width: 20 },
    { header: 'الحالة', key: 'status', width: 12 },
  ];
  for (const adv of params.advances) {
    if (adv.yearMonth !== params.report.yearMonth) continue;
    advSheet.addRow({
      date: adv.date,
      workerName: adv.workerNameSnapshot,
      branchName: adv.branchNameSnapshot,
      amount: adv.amount,
      method: PAYMENT_METHOD_LABELS_AR[adv.paymentMethod] || adv.paymentMethod,
      reason: adv.reason,
      createdByName: adv.createdByName,
      status: adv.status === 'cancelled' ? 'ملغاة' : 'نشطة',
    });
  }

  return wb;
}
