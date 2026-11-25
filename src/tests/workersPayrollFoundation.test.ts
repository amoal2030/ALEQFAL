/**
 * Workers & Payroll Foundation — Comprehensive Unit Test Suite
 *
 * Verifies every business, accounting, isolation, and RBAC invariant:
 *  1. Role Matrix & Zero Automatic Permission Expansion (supervisor & employee denied).
 *  2. Worker creation, validation, and permanent stable ID across branch transfers.
 *  3. Post-transfer Branch Manager isolation (old BM blocked, new BM allowed, historical branchId immutable).
 *  4. Branch Manager restrictions (no edit/cancel advance, no other-branch view, no additions/payroll/reports).
 *  5. Manager-only advance edit & soft-cancellation with mandatory reason + audit snapshots; locked after settlement.
 *  6. One-time vs monthly recurring financial additions (`startYearMonth` / `endYearMonth` / stopped / cancelled).
 *  7. Exact user payroll settlement example (3,000 + 500 = 3,500 vs 3,800 -> deducted 3,500, net 0, carry-over 300).
 *  8. Next-month carry-over chain, idempotent draft regeneration (no double carry-over/deduction), approved run lock.
 *  9. Integer-Halala precision (0.10 + 0.20, 3333.33) with zero floating-point drift.
 * 10. Partial & multiple salary payments (`unpaid` -> `partially_paid` -> `paid`) & overpayment block.
 * 11. Approved payroll administrative correction (mandatory reason, audit trail, paid-amount floor guard).
 * 12. Manager reports (org KPIs, historical branch attribution after transfer, cross-branch worker statement, RTL ExcelJS workbook).
 */
import assert from 'node:assert/strict';
import type { Branch, Organization, UserProfile } from '../types';
import type {
  PayrollItem,
  PayrollPayment,
  Worker,
  WorkerAddition,
  WorkerAdvance,
} from '../types/workersPayroll';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import {
  assertCanRecordWorkerAdvance,
  buildMonthlyPayrollRunDraft,
  buildValidatedWorkerAddition,
  buildValidatedWorkerAdvance,
  buildValidatedWorkerRecord,
  calculateWorkerMonthlyPayrollItem,
  filterVisibleWorkersForActor,
  generatePayrollItemId,
  generatePayrollRunId,
  isAdditionApplicableForMonth,
  prepareApprovedPayrollItemCorrection,
  preparePayrollPayment,
  prepareWorkerAdvanceCancellation,
  prepareWorkerAdvanceEdit,
  prepareWorkerBranchTransfer,
  resolveWorkersPayrollAccess,
  WorkersPayrollError,
} from '../utils/workersPayrollEngine';
import {
  buildMonthlyPayrollReportWorkbook,
  computeWorkerFinancialStatement,
  computeWorkersPayrollSummaryReport,
} from '../services/workersPayrollReportService';

const ORG_ID = 'org_eqfal_payroll_1';
const OTHER_ORG_ID = 'org_other_tenant_2';

const BRANCH_A: Branch = {
  id: 'br_riyadh_1',
  orgId: ORG_ID,
  name: 'فرع الرياض 1',
  code: 'RYD-1',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const BRANCH_B: Branch = {
  id: 'br_jeddah_2',
  orgId: ORG_ID,
  name: 'فرع جدة 2',
  code: 'JED-2',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const MANAGER: UserProfile = {
  uid: 'uid_mgr_1',
  orgId: ORG_ID,
  email: 'mgr@org1.test',
  displayName: 'مدير المؤسسة',
  role: 'manager',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('manager'),
  createdAt: '2026-01-01T00:00:00.000Z',
};

const OTHER_ORG_MANAGER: UserProfile = {
  ...MANAGER,
  uid: 'uid_mgr_other',
  orgId: OTHER_ORG_ID,
  email: 'mgr@org2.test',
};

const BM_A: UserProfile = {
  uid: 'uid_bm_a',
  orgId: ORG_ID,
  email: 'bma@org1.test',
  displayName: 'مسؤول فرع الرياض',
  role: 'branch_manager',
  branchId: BRANCH_A.id,
  branchIds: [BRANCH_A.id],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('branch_manager'),
  createdAt: '2026-01-01T00:00:00.000Z',
};

const BM_B: UserProfile = {
  uid: 'uid_bm_b',
  orgId: ORG_ID,
  email: 'bmb@org1.test',
  displayName: 'مسؤول فرع جدة',
  role: 'branch_manager',
  branchId: BRANCH_B.id,
  branchIds: [BRANCH_B.id],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('branch_manager'),
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SUPERVISOR: UserProfile = {
  uid: 'uid_sup_1',
  orgId: ORG_ID,
  email: 'sup@org1.test',
  displayName: 'مشرف عام',
  role: 'supervisor',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('supervisor', {
    canViewAllClosings: true,
    canApproveClosings: true,
    canViewFinancialReports: true,
  }),
  createdAt: '2026-01-01T00:00:00.000Z',
};

const EMPLOYEE: UserProfile = {
  uid: 'uid_emp_1',
  orgId: ORG_ID,
  email: 'emp@org1.test',
  displayName: 'موظف وردية',
  role: 'employee',
  branchId: BRANCH_A.id,
  branchIds: [BRANCH_A.id],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('employee'),
  createdAt: '2026-01-01T00:00:00.000Z',
};

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error('        ', err instanceof Error ? err.message : err);
    failed++;
  }
}

async function main() {
  console.log('========================================================================');
  console.log('   WORKERS & PAYROLL FOUNDATION — COMPREHENSIVE UNIT TEST SUITE         ');
  console.log('========================================================================');

  await runTest('1. Role matrix grants zero automatic permissions to supervisor/employee and scopes BM strictly to 1 branch', () => {
    const mgrAccess = resolveWorkersPayrollAccess(MANAGER);
    assert.equal(mgrAccess.canManageWorkers, true);
    assert.equal(mgrAccess.canApprovePayrollRuns, true);
    assert.equal(mgrAccess.canEditOrCancelAdvances, true);
    assert.equal(mgrAccess.canViewPayrollReports, true);

    const bmAccess = resolveWorkersPayrollAccess(BM_A);
    assert.equal(bmAccess.canViewBranchActiveWorkers, true);
    assert.equal(bmAccess.canRecordBranchAdvance, true);
    assert.equal(bmAccess.restrictedBranchId, BRANCH_A.id);
    assert.equal(bmAccess.canManageWorkers, false);
    assert.equal(bmAccess.canEditOrCancelAdvances, false);
    assert.equal(bmAccess.canManageAdditions, false);
    assert.equal(bmAccess.canManagePayrollRuns, false);
    assert.equal(bmAccess.canViewPayrollReports, false);

    // Supervisor & Employee MUST get zero automatic grants
    for (const profile of [SUPERVISOR, EMPLOYEE]) {
      const access = resolveWorkersPayrollAccess(profile);
      assert.equal(access.canViewBranchActiveWorkers, false);
      assert.equal(access.canRecordBranchAdvance, false);
      assert.equal(access.canManageWorkers, false);
      assert.equal(access.canViewPayrollReports, false);
    }
  });

  const worker1 = buildValidatedWorkerRecord({
    actor: MANAGER,
    orgId: ORG_ID,
    branch: BRANCH_A,
    workerId: 'wrk_stable_001',
    input: {
      fullName: 'سالم عبدالله الحربي',
      employeeNumber: 'EMP-101',
      phone: '0551234567',
      monthlySalary: 3000,
      branchId: BRANCH_A.id,
      hireDate: '2026-01-15',
    },
    nowIso: '2026-10-01T08:00:00.000Z',
  });

  await runTest('2. Worker creation produces stable ID, exact Halalas, and blocks non-managers & cross-org', () => {
    assert.equal(worker1.id, 'wrk_stable_001');
    assert.equal(worker1.monthlySalary, 3000);
    assert.equal(worker1.monthlySalaryHalalas, 300000);
    assert.equal(worker1.currentBranchId, BRANCH_A.id);

    assert.throws(
      () =>
        buildValidatedWorkerRecord({
          actor: BM_A,
          orgId: ORG_ID,
          branch: BRANCH_A,
          input: {
            fullName: 'عامل غير مصرح',
            employeeNumber: 'EMP-999',
            monthlySalary: 2000,
            branchId: BRANCH_A.id,
            hireDate: '2026-01-01',
          },
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'UNAUTHORIZED_ROLE'
    );

    assert.throws(
      () =>
        buildValidatedWorkerRecord({
          actor: OTHER_ORG_MANAGER,
          orgId: ORG_ID,
          branch: BRANCH_A,
          input: {
            fullName: 'عامل مؤسسة أخرى',
            employeeNumber: 'EMP-888',
            monthlySalary: 2000,
            branchId: BRANCH_A.id,
            hireDate: '2026-01-01',
          },
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'CROSS_ORG_DENIED'
    );
  });

  const advInBranchA = buildValidatedWorkerAdvance({
    actor: BM_A,
    worker: worker1,
    branch: BRANCH_A,
    advanceId: 'wadv_001',
    input: {
      amount: 1800,
      date: '2026-10-10',
      paymentMethod: 'cash',
      reason: 'سلفة مصروف شخصي',
    },
    nowIso: '2026-10-10T10:00:00.000Z',
  });

  await runTest('3. Branch transfer keeps exact same worker.id, preserves historical advance.branchId, blocks old BM & allows new BM', () => {
    assert.equal(advInBranchA.branchId, BRANCH_A.id);
    assert.equal(advInBranchA.amountHalalas, 180000);

    // Before transfer: BM_B cannot record advance for worker in Branch A
    assert.throws(
      () =>
        assertCanRecordWorkerAdvance({
          actor: BM_B,
          worker: worker1,
          targetBranchId: BRANCH_B.id,
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'BRANCH_MISMATCH'
    );

    const { updatedWorker: transferredWorker } = prepareWorkerBranchTransfer({
      actor: MANAGER,
      worker: worker1,
      targetBranch: BRANCH_B,
      reason: 'تغطية فرع جدة',
      nowIso: '2026-10-15T09:00:00.000Z',
    });

    // Same immutable worker ID
    assert.equal(transferredWorker.id, worker1.id);
    assert.equal(transferredWorker.currentBranchId, BRANCH_B.id);
    assert.equal(transferredWorker.branchTransferHistory?.length, 1);

    // Historical advance still bound to Branch A
    assert.equal(advInBranchA.branchId, BRANCH_A.id);

    // Old branch manager (BM_A) is IMMEDIATELY blocked after transfer
    assert.throws(
      () =>
        assertCanRecordWorkerAdvance({
          actor: BM_A,
          worker: transferredWorker,
          targetBranchId: BRANCH_A.id,
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'BRANCH_MISMATCH'
    );

    // Visible workers filter immediately hides transferred worker from BM_A and shows to BM_B
    assert.equal(filterVisibleWorkersForActor(BM_A, [transferredWorker]).length, 0);
    assert.equal(filterVisibleWorkersForActor(BM_B, [transferredWorker]).length, 1);

    // New branch manager (BM_B) CAN record a new advance bound to Branch B
    const advInBranchB = buildValidatedWorkerAdvance({
      actor: BM_B,
      worker: transferredWorker,
      branch: BRANCH_B,
      advanceId: 'wadv_002',
      input: {
        amount: 2000,
        date: '2026-10-20',
        paymentMethod: 'bank_transfer',
        reason: 'سلفة إيجار',
      },
      nowIso: '2026-10-20T12:00:00.000Z',
    });
    assert.equal(advInBranchB.branchId, BRANCH_B.id);
    assert.equal(advInBranchB.workerId, worker1.id);
  });

  await runTest('4. Branch Manager is strictly blocked from editing or cancelling advances; Manager edit/cancel enforces audit trail', () => {
    assert.throws(
      () =>
        prepareWorkerAdvanceEdit({
          actor: BM_A,
          advance: advInBranchA,
          updates: { amount: 500 },
          auditReason: 'محاولة تعديل',
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'UNAUTHORIZED_ROLE'
    );

    assert.throws(
      () =>
        prepareWorkerAdvanceCancellation({
          actor: BM_A,
          advance: advInBranchA,
          cancellationReason: 'محاولة إلغاء',
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'UNAUTHORIZED_ROLE'
    );

    // Manager edit produces explicit previousValues & newValues and preserves branchId
    const edited = prepareWorkerAdvanceEdit({
      actor: MANAGER,
      advance: advInBranchA,
      updates: { amount: 1850 },
      auditReason: 'تصحيح قيمة السلفة حسب الإيصال',
      nowIso: '2026-10-11T10:00:00.000Z',
    });
    assert.equal(edited.updatedAdvance.amount, 1850);
    assert.equal(edited.updatedAdvance.branchId, BRANCH_A.id);
    assert.equal(edited.previousValues.amount, 1800);
    assert.equal(edited.newValues.amount, 1850);

    // Manager soft cancellation preserves record with status='cancelled'
    const cancelled = prepareWorkerAdvanceCancellation({
      actor: MANAGER,
      advance: advInBranchA,
      cancellationReason: 'تكرار إدخال السلفة بالخطأ',
      nowIso: '2026-10-12T10:00:00.000Z',
    });
    assert.equal(cancelled.cancelledAdvance.status, 'cancelled');
    assert.equal(cancelled.cancelledAdvance.cancellationReason, 'تكرار إدخال السلفة بالخطأ');

    // Settled advance is locked against direct edit/cancel
    const settledAdv: WorkerAdvance = {
      ...advInBranchA,
      payrollSettledRunId: generatePayrollRunId(ORG_ID, '2026-10'),
    };
    assert.throws(
      () =>
        prepareWorkerAdvanceCancellation({
          actor: MANAGER,
          advance: settledAdv,
          cancellationReason: 'محاولة إلغاء بعد الاعتماد',
        }),
      (err: unknown) =>
        err instanceof WorkersPayrollError && err.code === 'ADVANCE_LOCKED_BY_APPROVED_PAYROLL'
    );
  });

  await runTest('5. Additions support one-time vs monthly recurring with start/end dates and stopped/cancelled rules', () => {
    const oneTimeBonus = buildValidatedWorkerAddition({
      actor: MANAGER,
      worker: worker1,
      additionId: 'wadd_onetime',
      input: {
        category: 'performance_bonus',
        recurrence: 'one_time',
        amount: 200,
        targetYearMonth: '2026-10',
      },
    });
    const recurringHousing = buildValidatedWorkerAddition({
      actor: MANAGER,
      worker: worker1,
      additionId: 'wadd_recurring',
      input: {
        category: 'housing_allowance',
        recurrence: 'monthly_recurring',
        amount: 300,
        startYearMonth: '2026-09',
        endYearMonth: '2026-11',
      },
    });
    const cancelledAdd: WorkerAddition = {
      ...oneTimeBonus,
      id: 'wadd_cancelled',
      status: 'cancelled',
    };

    assert.equal(isAdditionApplicableForMonth(oneTimeBonus, '2026-09'), false);
    assert.equal(isAdditionApplicableForMonth(oneTimeBonus, '2026-10'), true);
    assert.equal(isAdditionApplicableForMonth(oneTimeBonus, '2026-11'), false);

    assert.equal(isAdditionApplicableForMonth(recurringHousing, '2026-08'), false);
    assert.equal(isAdditionApplicableForMonth(recurringHousing, '2026-09'), true);
    assert.equal(isAdditionApplicableForMonth(recurringHousing, '2026-10'), true);
    assert.equal(isAdditionApplicableForMonth(recurringHousing, '2026-11'), true);
    assert.equal(isAdditionApplicableForMonth(recurringHousing, '2026-12'), false);

    assert.equal(isAdditionApplicableForMonth(cancelledAdd, '2026-10'), false);
  });

  await runTest('6. Exact user payroll settlement formula: Salary 3,000 + Additions 500 = 3,500 vs Advances 3,800 -> Deducted 3,500, Net 0, Carry-over 300', () => {
    const runIdOct = generatePayrollRunId(ORG_ID, '2026-10');
    const addition500 = buildValidatedWorkerAddition({
      actor: MANAGER,
      worker: worker1,
      additionId: 'wadd_500',
      input: {
        category: 'transport_allowance',
        recurrence: 'one_time',
        amount: 500,
        targetYearMonth: '2026-10',
      },
    });
    const adv2000 = buildValidatedWorkerAdvance({
      actor: BM_A,
      worker: worker1,
      branch: BRANCH_A,
      advanceId: 'wadv_2000',
      input: { amount: 2000, date: '2026-10-18', paymentMethod: 'cash', reason: 'سلفة ثانية' },
    });
    const cancelledAdv900: WorkerAdvance = {
      ...adv2000,
      id: 'wadv_cancelled_900',
      amount: 900,
      amountHalalas: 90000,
      status: 'cancelled',
    };

    // Total active advances = 1,800 + 2,000 = 3,800 (cancelled 900 MUST be excluded!)
    const itemOct = calculateWorkerMonthlyPayrollItem({
      orgId: ORG_ID,
      yearMonth: '2026-10',
      runId: runIdOct,
      worker: worker1,
      workerAdvances: [advInBranchA, adv2000, cancelledAdv900],
      workerAdditions: [addition500],
    });

    assert.equal(itemOct.id, generatePayrollItemId(ORG_ID, '2026-10', worker1.id));
    assert.equal(itemOct.baseSalary, 3000);
    assert.equal(itemOct.additionsTotal, 500);
    assert.equal(itemOct.advancesTotal, 3800);
    assert.equal(itemOct.carryOverIn, 0);
    assert.equal(itemOct.grossEntitlement, 3500);
    assert.equal(itemOct.deductedAmount, 3500);
    assert.equal(itemOct.netPayable, 0);
    assert.equal(itemOct.carryOverOut, 300);
    assert.equal(itemOct.carryOverOutHalalas, 30000);

    // Next month (2026-11) automatically carries over 300 ONLY once from approved October item
    const approvedOct: PayrollItem = { ...itemOct, status: 'approved', approvedAt: '2026-10-31T20:00:00.000Z' };
    const draftNov1 = buildMonthlyPayrollRunDraft({
      actor: MANAGER,
      orgId: ORG_ID,
      yearMonth: '2026-11',
      workers: [worker1],
      advances: [
        // Mark October advances as settled so they can NEVER be counted again
        { ...advInBranchA, payrollSettledRunId: runIdOct },
        { ...adv2000, payrollSettledRunId: runIdOct },
      ],
      additions: [],
      previousApprovedItems: [approvedOct],
    });

    assert.equal(draftNov1.items.length, 1);
    const novItem = draftNov1.items[0];
    assert.equal(novItem.carryOverIn, 300);
    assert.equal(novItem.carryOverSourceItemId, approvedOct.id);
    assert.equal(novItem.deductedAmount, 300);
    assert.equal(novItem.netPayable, 2700);
    assert.equal(novItem.carryOverOut, 0);

    // Re-running draft generation for 2026-11 is 100% idempotent (NO double carry-over!)
    const draftNov2 = buildMonthlyPayrollRunDraft({
      actor: MANAGER,
      orgId: ORG_ID,
      yearMonth: '2026-11',
      workers: [worker1],
      advances: [],
      additions: [],
      previousApprovedItems: [approvedOct],
      existingRun: draftNov1.run,
    });
    assert.equal(draftNov2.items[0].carryOverIn, 300);
    assert.equal(draftNov2.items[0].netPayable, 2700);

    // Re-generating an already APPROVED run MUST throw PAYROLL_RUN_ALREADY_APPROVED
    assert.throws(
      () =>
        buildMonthlyPayrollRunDraft({
          actor: MANAGER,
          orgId: ORG_ID,
          yearMonth: '2026-11',
          workers: [worker1],
          advances: [],
          additions: [],
          previousApprovedItems: [approvedOct],
          existingRun: { ...draftNov1.run, status: 'approved' },
        }),
      (err: unknown) =>
        err instanceof WorkersPayrollError && err.code === 'PAYROLL_RUN_ALREADY_APPROVED'
    );
  });

  await runTest('7. Integer-Halala precision eliminates floating-point errors (0.10 + 0.20 = 0.30, 3333.33)', () => {
    const fracWorker = buildValidatedWorkerRecord({
      actor: MANAGER,
      orgId: ORG_ID,
      branch: BRANCH_A,
      workerId: 'wrk_halala_test',
      input: {
        fullName: 'عامل اختبار الهللات',
        employeeNumber: 'EMP-H1',
        monthlySalary: 3333.33,
        branchId: BRANCH_A.id,
        hireDate: '2026-01-01',
      },
    });
    const add010 = buildValidatedWorkerAddition({
      actor: MANAGER,
      worker: fracWorker,
      input: { category: 'custom', customLabel: 'فرق 1', recurrence: 'one_time', amount: 0.1, targetYearMonth: '2026-11' },
    });
    const add020 = buildValidatedWorkerAddition({
      actor: MANAGER,
      worker: fracWorker,
      input: { category: 'custom', customLabel: 'فرق 2', recurrence: 'one_time', amount: 0.2, targetYearMonth: '2026-11' },
    });
    const adv = buildValidatedWorkerAdvance({
      actor: MANAGER,
      worker: fracWorker,
      branch: BRANCH_A,
      input: { amount: 1000.11, date: '2026-11-05', paymentMethod: 'cash', reason: 'سلفة كسر عشري' },
    });

    const item = calculateWorkerMonthlyPayrollItem({
      orgId: ORG_ID,
      yearMonth: '2026-11',
      runId: generatePayrollRunId(ORG_ID, '2026-11'),
      worker: fracWorker,
      workerAdvances: [adv],
      workerAdditions: [add010, add020],
    });
    assert.equal(item.additionsTotal, 0.3);
    assert.equal(item.grossEntitlement, 3333.63);
    assert.equal(item.netPayable, 2333.52);
    assert.equal(item.netPayableHalalas, 233352);
  });

  await runTest('8. Partial & multiple salary payments transition unpaid -> partially_paid -> paid and block overpayment', () => {
    const draftItem = calculateWorkerMonthlyPayrollItem({
      orgId: ORG_ID,
      yearMonth: '2026-11',
      runId: generatePayrollRunId(ORG_ID, '2026-11'),
      worker: worker1,
      workerAdvances: [],
      workerAdditions: [],
    });

    // Cannot pay before approval
    assert.throws(
      () =>
        preparePayrollPayment({
          actor: MANAGER,
          item: draftItem,
          input: { amount: 1000, paymentDate: '2026-11-28', paymentMethod: 'cash' },
        }),
      (err: unknown) =>
        err instanceof WorkersPayrollError && err.code === 'PAYROLL_ITEM_NOT_APPROVED'
    );

    const approvedItem: PayrollItem = { ...draftItem, status: 'approved' };
    assert.equal(approvedItem.disbursementStatus, 'unpaid');
    assert.equal(approvedItem.remainingPayable, 3000);

    // First partial payment: 1,250.50 cash
    const pay1 = preparePayrollPayment({
      actor: MANAGER,
      item: approvedItem,
      input: { amount: 1250.5, paymentDate: '2026-11-28', paymentMethod: 'cash', notes: 'دفعة أولى' },
    });
    assert.equal(pay1.updatedItem.paidAmount, 1250.5);
    assert.equal(pay1.updatedItem.remainingPayable, 1749.5);
    assert.equal(pay1.updatedItem.disbursementStatus, 'partially_paid');

    // Overpayment attempt: 1,750.00 > 1,749.50 MUST fail
    assert.throws(
      () =>
        preparePayrollPayment({
          actor: MANAGER,
          item: pay1.updatedItem,
          input: { amount: 1750, paymentDate: '2026-11-29', paymentMethod: 'bank_transfer' },
        }),
      (err: unknown) =>
        err instanceof WorkersPayrollError && err.code === 'PAYMENT_EXCEEDS_REMAINING'
    );

    // Second final payment: 1,749.50 bank transfer
    const pay2 = preparePayrollPayment({
      actor: MANAGER,
      item: pay1.updatedItem,
      input: { amount: 1749.5, paymentDate: '2026-11-30', paymentMethod: 'bank_transfer', notes: 'الدفعة المتبقية' },
    });
    assert.equal(pay2.updatedItem.paidAmount, 3000);
    assert.equal(pay2.updatedItem.remainingPayable, 0);
    assert.equal(pay2.updatedItem.disbursementStatus, 'paid');
  });

  await runTest('9. Documented administrative correction updates approved snapshot with full audit diff and protects paid floor', () => {
    const approvedItem: PayrollItem = {
      ...calculateWorkerMonthlyPayrollItem({
        orgId: ORG_ID,
        yearMonth: '2026-11',
        runId: generatePayrollRunId(ORG_ID, '2026-11'),
        worker: worker1,
        workerAdvances: [],
        workerAdditions: [],
      }),
      status: 'approved',
      paidAmount: 2000,
      paidAmountHalalas: 200000,
      remainingPayable: 1000,
      remainingPayableHalalas: 100000,
      disbursementStatus: 'partially_paid',
    };

    // Dropping net below already-paid 2,000 MUST fail
    assert.throws(
      () =>
        prepareApprovedPayrollItemCorrection({
          actor: MANAGER,
          item: approvedItem,
          baseSalary: 1500,
          correctionReason: 'تخفيض راتب أقل من المصروف',
        }),
      (err: unknown) =>
        err instanceof WorkersPayrollError && err.code === 'CORRECTION_BELOW_PAID_AMOUNT'
    );

    // Valid correction adding 250 bonus after approval
    const corr = prepareApprovedPayrollItemCorrection({
      actor: MANAGER,
      item: approvedItem,
      additionsTotal: 250,
      correctionReason: 'إضافة مكافأة معتمدة متأخرة بموافقة المدير',
    });
    assert.equal(corr.updatedItem.netPayable, 3250);
    assert.equal(corr.updatedItem.remainingPayable, 1250);
    assert.equal(corr.updatedItem.isAdminCorrected, true);
    assert.equal(corr.previousValues.netPayable, 3000);
    assert.equal(corr.newValues.netPayable, 3250);
  });

  await runTest('10. Manager reports attribute advances to historical branches, build full worker statement, and export RTL Excel workbook', async () => {
    const { updatedWorker: transferredWorker } = prepareWorkerBranchTransfer({
      actor: MANAGER,
      worker: worker1,
      targetBranch: BRANCH_B,
      nowIso: '2026-10-15T09:00:00.000Z',
    });
    const advB = buildValidatedWorkerAdvance({
      actor: BM_B,
      worker: transferredWorker,
      branch: BRANCH_B,
      advanceId: 'wadv_rep_b',
      input: { amount: 700, date: '2026-10-22', paymentMethod: 'bank_transfer', reason: 'سلفة فرع جدة' },
    });
    const draft = buildMonthlyPayrollRunDraft({
      actor: MANAGER,
      orgId: ORG_ID,
      yearMonth: '2026-10',
      workers: [transferredWorker],
      advances: [advInBranchA, advB],
      additions: [],
      previousApprovedItems: [],
    });
    const approvedItem: PayrollItem = { ...draft.items[0], status: 'approved' };
    const pay = preparePayrollPayment({
      actor: MANAGER,
      item: approvedItem,
      input: { amount: 500, paymentDate: '2026-10-31', paymentMethod: 'cash' },
    });

    const summary = computeWorkersPayrollSummaryReport({
      actor: MANAGER,
      orgId: ORG_ID,
      yearMonth: '2026-10',
      branches: [BRANCH_A, BRANCH_B],
      workers: [transferredWorker],
      advances: [advInBranchA, advB],
      payrollItems: [pay.updatedItem],
    });

    assert.equal(summary.activeWorkersCount, 1);
    assert.equal(summary.totalBaseSalary, 3000);
    assert.equal(summary.totalAdvances, 2500); // 1,800 (Branch A) + 700 (Branch B)
    assert.equal(summary.totalNetPayable, 500);
    assert.equal(summary.totalPaid, 500);
    assert.equal(summary.totalRemaining, 0);

    // Historical branch attribution verified!
    const brA = summary.byBranch.find((b) => b.branchId === BRANCH_A.id);
    const brB = summary.byBranch.find((b) => b.branchId === BRANCH_B.id);
    assert.equal(brA?.advances, 1800, 'Branch A retains its historical 1,800 advance even after transfer');
    assert.equal(brB?.advances, 700, 'Branch B records its 700 advance');

    // Cross-branch worker financial statement
    const statement = computeWorkerFinancialStatement({
      actor: MANAGER,
      worker: transferredWorker,
      advances: [advInBranchA, advB],
      additions: [],
      payrollItems: [pay.updatedItem],
      payments: [pay.payment as PayrollPayment],
    });
    assert.equal(statement.activeAdvancesTotal, 2500);
    assert.equal(statement.branchesWorkedIn.length, 2);

    // Branch Manager is denied running org-wide payroll reports
    assert.throws(
      () =>
        computeWorkersPayrollSummaryReport({
          actor: BM_A,
          orgId: ORG_ID,
          yearMonth: '2026-10',
          branches: [BRANCH_A, BRANCH_B],
          workers: [transferredWorker],
          advances: [advInBranchA, advB],
          payrollItems: [pay.updatedItem],
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'UNAUTHORIZED_ROLE'
    );

    // Multi-sheet RTL ExcelJS workbook builds cleanly
    const wb = await buildMonthlyPayrollReportWorkbook({
      org: { name: 'مؤسسة الاختبار', currency: 'SAR' } as Organization,
      report: summary,
      payrollItems: [pay.updatedItem],
      advances: [advInBranchA, advB],
    });
    assert.equal(wb.worksheets.length, 4);
    const buffer = await wb.xlsx.writeBuffer();
    assert.ok(buffer.byteLength > 2000, 'Expected valid non-empty xlsx binary');
  });

  console.log('========================================================================');
  console.log(`WORKERS & PAYROLL UNIT SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
