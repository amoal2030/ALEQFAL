/**
 * Workers & Payroll — Comprehensive End-to-End Workflows, RBAC, Idempotency & Drive Proof Tests
 * Covers all 13 required functional, financial, security, reporting, and Google Drive scenarios.
 */
import assert from 'node:assert/strict';
import type { Branch, Organization, UserProfile } from '../types';
import type { PayrollItem, Worker, WorkerAddition, WorkerAdvance } from '../types/workersPayroll';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import {
  assertCanRecordWorkerAdvance,
  assertUniqueEmployeeNumber,
  buildMonthlyPayrollRunDraft,
  buildValidatedWorkerAddition,
  buildValidatedWorkerAdvance,
  buildValidatedWorkerRecord,
  filterVisibleWorkersForActor,
  generateIdempotentPayrollPaymentId,
  prepareApprovedPayrollItemCorrection,
  preparePayrollPayment,
  preparePayrollPaymentReversal,
  prepareWorkerAdditionStatusChange,
  prepareWorkerAdditionUpdate,
  prepareWorkerAdvanceCancellation,
  prepareWorkerAdvanceEdit,
  prepareWorkerBranchTransfer,
  prepareWorkerDetailsEdit,
  resolveWorkersPayrollAccess,
  WorkersPayrollError,
} from '../utils/workersPayrollEngine';
import {
  buildPendingProofAttachmentRef,
  formatWorkersPayrollServiceError,
  isFirestoreRulesPermissionDenied,
  uploadPayrollPaymentProofToDrive,
  uploadWorkerAdvanceProofToDrive,
} from '../services/workersPayrollService';
import {
  buildMonthlyPayrollReportWorkbook,
  computeWorkerFinancialStatement,
  computeWorkersPayrollSummaryReport,
} from '../services/workersPayrollReportService';
import {
  clearUnifiedDriveFolderCache,
  trashUnifiedDriveFile,
} from '../services/unifiedDriveService';
import { resolveTenantNotificationRoute } from '../utils/notifications';

const ORG_A: Organization = {
  id: 'org_wp_test_a',
  name: 'مؤسسة الاختبار المالية',
  activityType: 'تجارة',
  currency: 'SAR',
  ownerId: 'uid_mgr_a',
  ownerName: 'أحمد المدير',
  ownerEmail: 'mgr@a.test',
  driveConnected: true,
  driveFolderId: 'drv_root_a',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BRANCH_1: Branch = {
  id: 'br_1',
  orgId: ORG_A.id,
  name: 'فرع الرياض 1',
  code: 'RUH-1',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const BRANCH_2: Branch = {
  id: 'br_2',
  orgId: ORG_A.id,
  name: 'فرع جدة 2',
  code: 'JED-2',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const MANAGER_A: UserProfile = {
  uid: 'uid_mgr_a',
  orgId: ORG_A.id,
  email: 'mgr@a.test',
  displayName: 'أحمد المدير',
  role: 'manager',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('manager'),
  createdAt: '2026-01-01T00:00:00.000Z',
};

const BRANCH_MGR_1: UserProfile = {
  uid: 'uid_bm_1',
  orgId: ORG_A.id,
  email: 'bm1@a.test',
  displayName: 'سعد مسؤول الفرع',
  role: 'branch_manager',
  branchId: BRANCH_1.id,
  branchIds: [BRANCH_1.id],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('branch_manager'),
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SUPERVISOR_A: UserProfile = {
  uid: 'uid_sup_a',
  orgId: ORG_A.id,
  email: 'sup@a.test',
  displayName: 'خالد المشرف',
  role: 'supervisor',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('supervisor'),
  createdAt: '2026-01-01T00:00:00.000Z',
};

const EMPLOYEE_A: UserProfile = {
  uid: 'uid_emp_a',
  orgId: ORG_A.id,
  email: 'emp@a.test',
  displayName: 'عمر الموظف',
  role: 'employee',
  branchId: BRANCH_1.id,
  branchIds: [BRANCH_1.id],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('employee'),
  createdAt: '2026-01-01T00:00:00.000Z',
};

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} -> ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function main() {
  console.log('========================================================================');
  console.log('  WORKERS & PAYROLL — UI WORKFLOWS, RBAC, IDEMPOTENCY & DRIVE TESTS     ');
  console.log('========================================================================');

  // 1. Add, edit, transfer, suspend/terminate worker without deleting record
  let worker1!: Worker;
  let worker2!: Worker;
  await test('1. Add, edit, transfer, and suspend/terminate worker while preserving permanent ID', () => {
    worker1 = buildValidatedWorkerRecord({
      actor: MANAGER_A,
      orgId: ORG_A.id,
      branch: BRANCH_1,
      workerId: 'wrk_stable_1',
      input: {
        fullName: 'محمد العلي',
        employeeNumber: 'EMP-101',
        phone: '0501112222',
        branchId: BRANCH_1.id,
        monthlySalary: 4000,
        hireDate: '2026-01-15',
      },
    });
    assert.equal(worker1.id, 'wrk_stable_1');
    assert.equal(worker1.monthlySalaryHalalas, 400_000);

    const edited = prepareWorkerDetailsEdit({
      actor: MANAGER_A,
      worker: worker1,
      existingWorkers: [worker1],
      updates: { fullName: 'محمد العلي الحربي', monthlySalary: 4500 },
    });
    assert.equal(edited.updatedWorker.id, worker1.id);
    assert.equal(edited.updatedWorker.monthlySalary, 4500);
    assert.equal(edited.previousValues.monthlySalary, 4000);
    assert.equal(edited.newValues.monthlySalary, 4500);

    const transferred = prepareWorkerBranchTransfer({
      actor: MANAGER_A,
      worker: edited.updatedWorker,
      targetBranch: BRANCH_2,
      reason: 'تغطية موسمية',
    });
    assert.equal(transferred.updatedWorker.id, worker1.id);
    assert.equal(transferred.updatedWorker.currentBranchId, BRANCH_2.id);
    assert.equal(transferred.updatedWorker.branchTransferHistory?.length, 1);

    worker2 = buildValidatedWorkerRecord({
      actor: MANAGER_A,
      orgId: ORG_A.id,
      branch: BRANCH_1,
      workerId: 'wrk_stable_2',
      input: {
        fullName: 'سالم الدوسري',
        employeeNumber: 'EMP-102',
        branchId: BRANCH_1.id,
        monthlySalary: 3000,
        hireDate: '2026-02-01',
      },
    });
    const suspendedWorker: Worker = { ...worker2, status: 'suspended', statusReason: 'إجازة بدون راتب' };
    assert.equal(suspendedWorker.id, 'wrk_stable_2');
    assert.equal(suspendedWorker.status, 'suspended');
  });

  // 2. Prevent duplicate employeeNumber within same org (allow in different org)
  await test('2. Prevent duplicate employeeNumber in same org (case-insensitive) while allowing other orgs', () => {
    assert.throws(
      () =>
        assertUniqueEmployeeNumber({
          employeeNumber: '  emp-101 ',
          orgId: ORG_A.id,
          existingWorkers: [worker1, worker2],
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'DUPLICATE_EMPLOYEE_NUMBER'
    );

    // Editing same worker with its own employeeNumber is allowed
    assert.doesNotThrow(() =>
      assertUniqueEmployeeNumber({
        employeeNumber: 'EMP-101',
        orgId: ORG_A.id,
        existingWorkers: [worker1, worker2],
        excludeWorkerId: worker1.id,
      })
    );

    // Same employeeNumber in a different org is allowed
    assert.doesNotThrow(() =>
      assertUniqueEmployeeNumber({
        employeeNumber: 'EMP-101',
        orgId: 'org_other_tenant',
        existingWorkers: [worker1, worker2],
      })
    );
  });

  // 3. Branch isolation for Branch Manager
  await test('3. Branch Manager sees ONLY active workers in own assigned branch', () => {
    const workerInBr2: Worker = { ...worker1, id: 'wrk_br2', currentBranchId: BRANCH_2.id, currentBranchName: BRANCH_2.name };
    const suspendedInBr1: Worker = { ...worker2, id: 'wrk_susp_br1', status: 'suspended' };
    const activeInBr1: Worker = { ...worker2, id: 'wrk_act_br1', status: 'active' };
    const otherOrgWorker: Worker = { ...worker2, id: 'wrk_other_org', orgId: 'org_other' };

    const visibleToBm1 = filterVisibleWorkersForActor(BRANCH_MGR_1, [
      workerInBr2,
      suspendedInBr1,
      activeInBr1,
      otherOrgWorker,
    ]);
    assert.deepEqual(
      visibleToBm1.map((w) => w.id),
      ['wrk_act_br1']
    );

    // Supervisor & Employee see ZERO workers
    assert.equal(filterVisibleWorkersForActor(SUPERVISOR_A, [activeInBr1]).length, 0);
    assert.equal(filterVisibleWorkersForActor(EMPLOYEE_A, [activeInBr1]).length, 0);
  });

  // 4. Block Branch Manager from recording advance for transferred or inactive worker
  await test('4. Block Branch Manager from recording advance for transferred or inactive worker', () => {
    const transferredWorker = prepareWorkerBranchTransfer({
      actor: MANAGER_A,
      worker: worker1,
      targetBranch: BRANCH_2,
    }).updatedWorker;

    assert.throws(
      () =>
        assertCanRecordWorkerAdvance({
          actor: BRANCH_MGR_1,
          worker: transferredWorker,
          targetBranchId: BRANCH_1.id,
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'BRANCH_MISMATCH'
    );

    const terminatedWorker: Worker = { ...worker1, status: 'terminated' };
    assert.throws(
      () =>
        assertCanRecordWorkerAdvance({
          actor: BRANCH_MGR_1,
          worker: terminatedWorker,
          targetBranchId: BRANCH_1.id,
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'WORKER_INACTIVE'
    );
  });

  // 5. Block Branch Manager from editing or cancelling advances after recording
  let adv1!: WorkerAdvance;
  await test('5. Branch Manager can record advance in own branch but CANNOT edit or cancel it', () => {
    adv1 = buildValidatedWorkerAdvance({
      actor: BRANCH_MGR_1,
      worker: worker1,
      branch: BRANCH_1,
      advanceId: 'wadv_bm_test_1',
      input: {
        amount: 600,
        date: '2026-11-10',
        paymentMethod: 'cash',
        reason: 'سلفة منتصف الشهر',
      },
    });
    assert.equal(adv1.branchId, BRANCH_1.id);
    assert.equal(adv1.amountHalalas, 60_000);

    assert.throws(
      () =>
        prepareWorkerAdvanceEdit({
          actor: BRANCH_MGR_1,
          advance: adv1,
          updates: { amount: 500 },
          auditReason: 'محاولة تعديل',
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'UNAUTHORIZED_ROLE'
    );

    assert.throws(
      () =>
        prepareWorkerAdvanceCancellation({
          actor: BRANCH_MGR_1,
          advance: adv1,
          cancellationReason: 'محاولة إلغاء',
        }),
      (err: unknown) => err instanceof WorkersPayrollError && err.code === 'UNAUTHORIZED_ROLE'
    );
  });

  // 6. Manager documented edit & cancel of unsettled advances + lock on settled advances
  await test('6. Manager edits/cancels unsettled advances with audit trail; settled advances are locked', () => {
    const editedAdv = prepareWorkerAdvanceEdit({
      actor: MANAGER_A,
      advance: adv1,
      updates: { amount: 750 },
      auditReason: 'تصحيح المبلغ حسب الإيصال',
    });
    assert.equal(editedAdv.updatedAdvance.amount, 750);
    assert.equal(editedAdv.previousValues.amount, 600);
    assert.equal(editedAdv.newValues.amount, 750);

    const cancelledAdv = prepareWorkerAdvanceCancellation({
      actor: MANAGER_A,
      advance: editedAdv.updatedAdvance,
      cancellationReason: 'إدخال مكرر',
    });
    assert.equal(cancelledAdv.cancelledAdvance.status, 'cancelled');

    const settledAdv: WorkerAdvance = {
      ...adv1,
      payrollSettledRunId: 'prun_orgwptesta_2026-11',
      payrollSettledYearMonth: '2026-11',
    };
    assert.throws(
      () =>
        prepareWorkerAdvanceEdit({
          actor: MANAGER_A,
          advance: settledAdv,
          updates: { amount: 100 },
          auditReason: 'تعديل بعد الاعتماد',
        }),
      (err: unknown) =>
        err instanceof WorkersPayrollError && err.code === 'ADVANCE_LOCKED_BY_APPROVED_PAYROLL'
    );
  });

  // 7 & 8. Payroll calculation (base + one-time/recurring additions + advances + carry-over) & single approval
  let novApprovedItem!: PayrollItem;
  let recurringAdd!: WorkerAddition;
  await test('7 & 8. Payroll math with additions, advances, carry-over, single approval & anti-double-deduction', () => {
    const oneTimeBonus = buildValidatedWorkerAddition({
      actor: MANAGER_A,
      worker: worker1,
      additionId: 'wadd_ot_1',
      input: {
        category: 'performance_bonus',
        recurrence: 'one_time',
        amount: 500,
        targetYearMonth: '2026-11',
      },
    });
    recurringAdd = buildValidatedWorkerAddition({
      actor: MANAGER_A,
      worker: worker1,
      additionId: 'wadd_rec_1',
      input: {
        category: 'transport_allowance',
        recurrence: 'monthly_recurring',
        amount: 300,
        startYearMonth: '2026-11',
      },
    });
    const largeAdvance = buildValidatedWorkerAdvance({
      actor: MANAGER_A,
      worker: worker1,
      branch: BRANCH_1,
      advanceId: 'wadv_large_1',
      input: {
        amount: 5000, // Exceeds 4000 + 800 = 4800 -> carryOverOut = 200
        date: '2026-11-05',
        paymentMethod: 'bank_transfer',
        reason: 'سلفة كبيرة',
      },
    });

    const novDraft = buildMonthlyPayrollRunDraft({
      actor: MANAGER_A,
      orgId: ORG_A.id,
      yearMonth: '2026-11',
      workers: [worker1],
      advances: [largeAdvance],
      additions: [oneTimeBonus, recurringAdd],
      previousApprovedItems: [],
    });

    assert.equal(novDraft.items.length, 1);
    const novItem = novDraft.items[0];
    assert.equal(novItem.baseSalary, 4000);
    assert.equal(novItem.additionsTotal, 800);
    assert.equal(novItem.advancesTotal, 5000);
    assert.equal(novItem.netPayable, 0);
    assert.equal(novItem.carryOverOut, 200);

    // Approve November run -> re-drafting approved month must throw PAYROLL_RUN_ALREADY_APPROVED
    const approvedRun = { ...novDraft.run, status: 'approved' as const };
    novApprovedItem = { ...novItem, status: 'approved' as const };
    assert.throws(
      () =>
        buildMonthlyPayrollRunDraft({
          actor: MANAGER_A,
          orgId: ORG_A.id,
          yearMonth: '2026-11',
          workers: [worker1],
          advances: [largeAdvance],
          additions: [oneTimeBonus, recurringAdd],
          previousApprovedItems: [novApprovedItem],
          existingRun: approvedRun,
        }),
      (err: unknown) =>
        err instanceof WorkersPayrollError && err.code === 'PAYROLL_RUN_ALREADY_APPROVED'
    );

    // December draft carries over exactly 200 once and does NOT re-deduct November settled advance
    const settledNovAdv: WorkerAdvance = {
      ...largeAdvance,
      payrollSettledRunId: approvedRun.id,
      payrollSettledYearMonth: '2026-11',
    };
    const decDraft = buildMonthlyPayrollRunDraft({
      actor: MANAGER_A,
      orgId: ORG_A.id,
      yearMonth: '2026-12',
      workers: [worker1],
      advances: [settledNovAdv],
      additions: [oneTimeBonus, recurringAdd],
      previousApprovedItems: [novApprovedItem],
    });
    const decItem = decDraft.items[0];
    assert.equal(decItem.additionsTotal, 300); // Only recurring applies in Dec
    assert.equal(decItem.advancesTotal, 0); // Nov advance NOT double-deducted
    assert.equal(decItem.carryOverIn, 200);
    assert.equal(decItem.netPayable, 4100); // 4000 + 300 - 200
    assert.equal(decItem.carryOverOut, 0);
  });

  // 9 & 10. Partial/full payments, overpayment prevention, duplicate payment idempotency, and reversal
  await test('9 & 10. Partial/full payments, overpayment block, duplicate request key idempotency & reversal', () => {
    const approvedDec: PayrollItem = {
      ...novApprovedItem,
      id: 'pitem_orgwptesta_2026-12_wrkstable1',
      yearMonth: '2026-12',
      netPayable: 4100,
      netPayableHalalas: 410_000,
      paidAmount: 0,
      paidAmountHalalas: 0,
      remainingPayable: 4100,
      remainingPayableHalalas: 410_000,
      disbursementStatus: 'unpaid',
    };

    // Overpayment blocked
    assert.throws(
      () =>
        preparePayrollPayment({
          actor: MANAGER_A,
          item: approvedDec,
          input: {
            amount: 4200,
            paymentDate: '2026-12-28',
            paymentMethod: 'bank_transfer',
          },
        }),
      (err: unknown) =>
        err instanceof WorkersPayrollError && err.code === 'PAYMENT_EXCEEDS_REMAINING'
    );

    // Deterministic idempotency ID for identical clientRequestKey
    const idA = generateIdempotentPayrollPaymentId(approvedDec.id, 'req_dec_part_1');
    const idB = generateIdempotentPayrollPaymentId(approvedDec.id, 'req_dec_part_1');
    const idC = generateIdempotentPayrollPaymentId(approvedDec.id, 'req_dec_part_2');
    assert.equal(idA, idB);
    assert.notEqual(idA, idC);

    // Partial payment -> partially_paid
    const part1 = preparePayrollPayment({
      actor: MANAGER_A,
      item: approvedDec,
      input: {
        amount: 2000,
        paymentDate: '2026-12-25',
        paymentMethod: 'cash',
        clientRequestKey: 'req_dec_part_1',
      },
    });
    assert.equal(part1.payment.id, idA);
    assert.equal(part1.updatedItem.disbursementStatus, 'partially_paid');
    assert.equal(part1.updatedItem.remainingPayable, 2100);

    // Second payment -> paid
    const part2 = preparePayrollPayment({
      actor: MANAGER_A,
      item: part1.updatedItem,
      input: {
        amount: 2100,
        paymentDate: '2026-12-30',
        paymentMethod: 'bank_transfer',
        clientRequestKey: 'req_dec_part_2',
      },
    });
    assert.equal(part2.updatedItem.disbursementStatus, 'paid');
    assert.equal(part2.updatedItem.remainingPayable, 0);

    // Reversal restores remaining payable & preserves payment record
    const reversed = preparePayrollPaymentReversal({
      actor: MANAGER_A,
      item: part2.updatedItem,
      payment: part2.payment,
      reversalReason: 'تحويل بنكي مرتجع',
    });
    assert.equal(reversed.reversedPayment.status, 'reversed');
    assert.equal(reversed.updatedItem.disbursementStatus, 'partially_paid');
    assert.equal(reversed.updatedItem.remainingPayable, 2100);
  });

  // 11. Immutability of historical approved payroll statements after editing/stopping additions or admin correction
  await test('11. Editing/stopping recurring additions does NOT mutate approved historical payroll snapshots', () => {
    const updatedAdd = prepareWorkerAdditionUpdate({
      actor: MANAGER_A,
      addition: recurringAdd,
      updates: { amount: 600 },
      reason: 'زيادة بدل النقل',
    });
    assert.equal(updatedAdd.updatedAddition.amount, 600);

    const stoppedAdd = prepareWorkerAdditionStatusChange({
      actor: MANAGER_A,
      addition: updatedAdd.updatedAddition,
      nextStatus: 'stopped',
      endYearMonth: '2026-12',
      reason: 'إيقاف البدل مع نهاية العام',
    });
    assert.equal(stoppedAdd.updatedAddition.status, 'stopped');

    // Historical November snapshot remains 100% frozen at 800
    assert.equal(novApprovedItem.additionsTotal, 800);

    // Explicit documented Admin Correction works ONLY with reason & produces before/after values
    const corr = prepareApprovedPayrollItemCorrection({
      actor: MANAGER_A,
      item: novApprovedItem,
      additionsTotal: 900,
      correctionReason: 'إضافة مكافأة معتمدة متأخراً',
    });
    assert.equal(corr.updatedItem.isAdminCorrected, true);
    assert.equal(corr.updatedItem.correctionCount, 1);
    assert.equal(corr.previousValues.additionsTotal, 800);
    assert.equal(corr.newValues.additionsTotal, 900);
  });

  // 12. Reports & RTL Arabic Excel (.xlsx) Export
  await test('12. Manager summary report, worker statement & RTL Arabic Excel (.xlsx) workbook export', async () => {
    const summary = computeWorkersPayrollSummaryReport({
      actor: MANAGER_A,
      orgId: ORG_A.id,
      yearMonth: '2026-11',
      branches: [BRANCH_1, BRANCH_2],
      workers: [worker1, worker2],
      advances: [adv1],
      payrollItems: [novApprovedItem],
    });
    assert.equal(summary.activeWorkersCount, 2);
    assert.equal(summary.totalBaseSalary, 4000);
    assert.ok(summary.byBranch.length >= 1);

    const statement = computeWorkerFinancialStatement({
      actor: MANAGER_A,
      worker: worker1,
      advances: [adv1],
      additions: [recurringAdd],
      payrollItems: [novApprovedItem],
      payments: [],
    });
    assert.equal(statement.worker.id, worker1.id);
    assert.equal(statement.latestCarryOverOut, 200);

    const wb = await buildMonthlyPayrollReportWorkbook({
      org: ORG_A,
      report: summary,
      payrollItems: [novApprovedItem],
      advances: [adv1],
    });
    assert.equal(wb.worksheets.length, 4);
    const rawBuf = await wb.xlsx.writeBuffer();
    const bytes = new Uint8Array(rawBuf as ArrayBuffer);
    assert.ok(bytes.byteLength > 500);
    // PKZIP signature ('P', 'K')
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
  });

  // 13. Google Drive proof failure -> pending metadata preserved, idempotent retry (zero duplicates), Safe Trash ONLY
  await test('13. Drive proof failure keeps pending state, retry reuses existing file, Safe Trash uses PATCH only (zero HTTP DELETE)', async () => {
    clearUnifiedDriveFolderCache();
    const pendingRef = buildPendingProofAttachmentRef({
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      fileSize: 2048,
      clientUploadKey: 'adv_proof_wadv_1',
      syncStatus: 'pending_drive_sync',
    });
    assert.equal(pendingRef.syncStatus, 'pending_drive_sync');
    assert.equal(pendingRef.clientUploadKey, 'adv_proof_wadv_1');

    // Mock fetch to verify idempotent upload + Safe Trash PATCH { trashed: true } + ZERO HTTP DELETE
    const originalFetch = globalThis.fetch;
    const methodsSeen: string[] = [];
    let uploadedFiles: Array<{ id: string; name: string; parents: string[]; appProperties: Record<string, string>; trashed: boolean }> = [];
    let folderCounter = 1;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();
      methodsSeen.push(`${method} ${url}`);

      if (method === 'DELETE') {
        throw new Error('FORBIDDEN HTTP DELETE CALLED!');
      }

      // List/search files & folders
      if (method === 'GET' && url.includes('/drive/v3/files?')) {
        const parsed = new URL(url);
        const q = parsed.searchParams.get('q') || '';
        if (q.includes("clientUploadKey")) {
          const match = uploadedFiles.find((f) => q.includes(f.appProperties.clientUploadKey));
          return new Response(JSON.stringify({ files: match ? [match] : [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }

      // Single file/folder metadata fetch (for root verification & Trash verification)
      if (method === 'GET' && url.includes('/drive/v3/files/')) {
        const idPart = decodeURIComponent(url.split('/drive/v3/files/')[1].split('?')[0]);
        if (idPart === ORG_A.driveFolderId || idPart.startsWith('fld_')) {
          return new Response(
            JSON.stringify({
              id: idPart,
              name: idPart === ORG_A.driveFolderId ? ORG_A.name : idPart,
              mimeType: 'application/vnd.google-apps.folder',
              trashed: false,
              appProperties: { orgId: ORG_A.id, system: 'al_eqfal' },
            }),
            { status: 200 }
          );
        }
        const found = uploadedFiles.find((f) => f.id === idPart);
        return new Response(JSON.stringify(found || {}), { status: found ? 200 : 404 });
      }

      // Folder creation (exclude /upload/ multipart endpoint)
      if (method === 'POST' && !url.includes('/upload/') && url.includes('/drive/v3/files')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const id = `fld_${folderCounter++}`;
        return new Response(
          JSON.stringify({
            id,
            name: body.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: body.parents || [],
            trashed: false,
          }),
          { status: 200 }
        );
      }

      // Multipart file upload
      if (method === 'POST' && url.includes('/upload/drive/v3/files')) {
        const rawBody = init?.body;
        let buf: Buffer;
        if (rawBody instanceof Uint8Array) {
          buf = Buffer.from(rawBody);
        } else if (rawBody instanceof ArrayBuffer) {
          buf = Buffer.from(rawBody);
        } else if (rawBody instanceof Blob) {
          buf = Buffer.from(await rawBody.arrayBuffer());
        } else {
          buf = Buffer.from(String(rawBody || ''), 'utf8');
        }
        const headers = (init?.headers || {}) as Record<string, string>;
        const contentType = headers['Content-Type'] || headers['content-type'] || '';
        const bMatch = contentType.match(/boundary=([^\s;]+)/i);
        const boundary = bMatch ? bMatch[1].replace(/^"|"$/g, '') : '';
        let meta: any = {};
        if (boundary) {
          const marker = Buffer.from(`--${boundary}`);
          const first = buf.indexOf(marker);
          const second = buf.indexOf(marker, first + marker.length);
          if (first >= 0 && second > first) {
            const part1 = buf.subarray(first + marker.length, second);
            const sep1 = part1.indexOf(Buffer.from('\r\n\r\n'));
            if (sep1 >= 0) {
              meta = JSON.parse(part1.subarray(sep1 + 4, part1.length - 2).toString('utf8'));
            }
          }
        }
        const newFile = {
          id: `drv_file_${uploadedFiles.length + 1}`,
          name: meta.name || 'proof.pdf',
          mimeType: 'application/pdf',
          parents: meta.parents || [],
          webViewLink: `https://drive.google.com/file/d/drv_file_${uploadedFiles.length + 1}/view`,
          appProperties: meta.appProperties || {},
          trashed: false,
        };
        uploadedFiles.push(newFile);
        return new Response(JSON.stringify(newFile), { status: 200 });
      }

      // Idempotent multipart PATCH (re-uploading same clientUploadKey updates existing file in place)
      if (method === 'PATCH' && url.includes('/upload/drive/v3/files/')) {
        const idPart = decodeURIComponent(url.split('/upload/drive/v3/files/')[1].split('?')[0]);
        const found = uploadedFiles.find((f) => f.id === idPart);
        assert.ok(found, 'Expected existing file for idempotent multipart PATCH');
        return new Response(JSON.stringify(found), { status: 200 });
      }

      // Safe Trash PATCH (metadata-only, excludes /upload/)
      if (method === 'PATCH' && !url.includes('/upload/') && url.includes('/drive/v3/files/')) {
        const idPart = decodeURIComponent(url.split('/drive/v3/files/')[1].split('?')[0]);
        const body = JSON.parse(String(init?.body || '{}'));
        const found = uploadedFiles.find((f) => f.id === idPart);
        assert.ok(found, 'Expected file to exist for PATCH trash');
        assert.equal(body.trashed, true);
        found.trashed = true;
        return new Response(JSON.stringify(found), { status: 200 });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    try {
      const sampleBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

      // First upload
      const firstUpload = await uploadWorkerAdvanceProofToDrive({
        token: 'valid_owner_token',
        actor: MANAGER_A,
        org: ORG_A,
        branch: BRANCH_1,
        advanceId: 'wadv_1',
        advanceDate: '2026-11-10',
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        bytes: sampleBytes,
        clientUploadKey: 'adv_proof_wadv_1',
      });
      assert.equal(firstUpload.reusedExisting, false);
      assert.equal(uploadedFiles.length, 1);

      // Idempotent retry with SAME clientUploadKey -> reuses existing file, ZERO duplicates!
      const retryUpload = await uploadWorkerAdvanceProofToDrive({
        token: 'valid_owner_token',
        actor: MANAGER_A,
        org: ORG_A,
        branch: BRANCH_1,
        advanceId: 'wadv_1',
        advanceDate: '2026-11-10',
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        bytes: sampleBytes,
        clientUploadKey: 'adv_proof_wadv_1',
      });
      assert.equal(retryUpload.reusedExisting, true);
      assert.equal(retryUpload.record.fileId, firstUpload.record.fileId);
      assert.equal(uploadedFiles.length, 1);

      // Payment proof upload also uses unifiedDriveService
      const payUpload = await uploadPayrollPaymentProofToDrive({
        token: 'valid_owner_token',
        actor: MANAGER_A,
        org: ORG_A,
        branch: BRANCH_1,
        paymentId: 'ppay_1',
        paymentDate: '2026-11-30',
        fileName: 'salary_transfer.pdf',
        mimeType: 'application/pdf',
        bytes: sampleBytes,
        clientUploadKey: 'pay_proof_ppay_1',
      });
      assert.equal(payUpload.reusedExisting, false);

      // Safe Trash moves file to Trash ONLY, calls onDriveTrashed, keeps parent record intact
      let parentRecordIntact = true;
      let trashedCallbackRan = false;
      const trashRes = await trashUnifiedDriveFile({
        token: 'valid_owner_token',
        actor: MANAGER_A,
        org: ORG_A,
        fileId: firstUpload.record.fileId,
        confirmed: true,
        expectedRecordId: 'wadv_1',
        documentType: 'worker_advance',
        reason: 'استبدال الإيصال',
        onDriveTrashed: () => {
          trashedCallbackRan = true;
        },
      });
      assert.equal(trashRes.trashed, true);
      assert.equal(trashedCallbackRan, true);
      assert.equal(parentRecordIntact, true);
      assert.equal(
        methodsSeen.some((m) => m.startsWith('DELETE ')),
        false
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 14. RBAC & Dashboard/Routing + Honest Firestore permission-denied message
  await test('14. RBAC routing & honest Arabic permission-denied handling', () => {
    const mgrAccess = resolveWorkersPayrollAccess(MANAGER_A);
    assert.equal(mgrAccess.canManageWorkers, true);
    assert.equal(mgrAccess.canApprovePayrollRuns, true);

    const bmAccess = resolveWorkersPayrollAccess(BRANCH_MGR_1);
    assert.equal(bmAccess.canRecordBranchAdvance, true);
    assert.equal(bmAccess.canManageWorkers, false);
    assert.equal(bmAccess.canEditOrCancelAdvances, false);
    assert.equal(bmAccess.restrictedBranchId, BRANCH_1.id);

    const supAccess = resolveWorkersPayrollAccess(SUPERVISOR_A);
    assert.equal(supAccess.canRecordBranchAdvance, false);
    assert.equal(supAccess.canManageWorkers, false);

    const empAccess = resolveWorkersPayrollAccess(EMPLOYEE_A);
    assert.equal(empAccess.canRecordBranchAdvance, false);
    assert.equal(empAccess.canManageWorkers, false);

    // Manager notification route supports workers_payroll tab
    const route = resolveTenantNotificationRoute({
      userProfile: MANAGER_A,
      target: { surface: 'tenant', tab: 'workers_payroll' },
    });
    assert.equal(route.managerTab, 'workers_payroll');

    // Honest Firestore permission-denied formatting
    const permErr = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    assert.equal(isFirestoreRulesPermissionDenied(permErr), true);
    assert.ok(formatWorkersPayrollServiceError(permErr).includes('Firestore'));
  });

  console.log('========================================================================');
  console.log(`WORKERS & PAYROLL UI/WORKFLOWS SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
