/**
 * Workers & Payroll Atomic Firestore Service Layer — الإقفال | AL EQFAL
 *
 * IMPORTANT SECURITY & DEPLOYMENT STATUS:
 * - Targets ONLY the project's named Firestore database exported from `src/lib/firebase.ts`
 *   (`ai-studio-aleqfal-cf1d4528-a7af-44d6-b623-8a556a614788`, NEVER `(default)`).
 * - Uses `runTransaction`, atomic `writeBatch`, and server-authoritative reads
 *   (`getDocFromServer` / `getDocsFromServer`) for every financial operation.
 * - Requires independent approval & deployment of corresponding `firestore.rules`
 *   match blocks before wiring live UI tabs in `Dashboard.tsx`.
 */
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  runTransaction,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { db as defaultDb } from '../lib/firebase';
import type { Branch, Organization, UserProfile } from '../types';
import type { UnifiedDriveUploadResult } from '../types/unifiedDrive';
import {
  downloadUnifiedDriveFile,
  trashUnifiedDriveFile,
  uploadUnifiedDriveFile,
} from './unifiedDriveService';
import type {
  PayrollAuditLog,
  PayrollItem,
  PayrollPayment,
  PayrollProofAttachmentRef,
  PayrollProofSyncStatus,
  PayrollRun,
  Worker,
  WorkerAddition,
  WorkerAdditionCategory,
  WorkerAdditionStatus,
  WorkerAdvance,
  WorkerStatus,
} from '../types/workersPayroll';
import {
  assertCanRecordWorkerAdvance,
  assertManagerPayrollAccess,
  assertUniqueEmployeeNumber,
  assertValidCurrencyHalalas,
  assertValidYearMonth,
  buildMonthlyPayrollRunDraft,
  buildValidatedWorkerAddition,
  buildValidatedWorkerAdvance,
  buildValidatedWorkerRecord,
  CreateWorkerAdditionInput,
  CreateWorkerInput,
  filterVisibleWorkersForActor,
  generateIdempotentPayrollPaymentId,
  generatePayrollAuditLogId,
  generatePayrollRunId,
  prepareApprovedPayrollItemCorrection,
  preparePayrollPayment,
  preparePayrollPaymentReversal,
  prepareWorkerAdditionStatusChange,
  prepareWorkerAdditionUpdate,
  prepareWorkerAdvanceCancellation,
  prepareWorkerAdvanceEdit,
  prepareWorkerBranchTransfer,
  prepareWorkerDetailsEdit,
  RecordPayrollPaymentInput,
  RecordWorkerAdvanceInput,
  resolveWorkersPayrollAccess,
  summarizePayrollRunFromItems,
  WorkersPayrollError,
} from '../utils/workersPayrollEngine';
import { fromHalalas } from '../utils/accounting';

export const WORKERS_PAYROLL_COLLECTIONS = {
  workers: 'workers',
  workerAdvances: 'workerAdvances',
  workerAdditions: 'workerAdditions',
  payrollRuns: 'payrollRuns',
  payrollItems: 'payrollItems',
  payrollPayments: 'payrollPayments',
  payrollAuditLogs: 'payrollAuditLogs',
} as const;

function actorDisplayName(actor: UserProfile): string {
  return (actor.displayName || actor.email || 'الإدارة').trim().slice(0, 100);
}

export const FIRESTORE_RULES_PENDING_MESSAGE_AR =
  'قواعد أمان Firestore الحالية لم تُفعَّل بعد لمجموعات إدارة العمال والرواتب؛ لذلك لا يمكن الحفظ أو القراءة السحابية الدائمة حتى اعتماد ونشر قواعد Firestore المخصصة لهذه الوحدة.';

export function isFirestoreRulesPermissionDenied(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: unknown }).code || '').toLowerCase();
  const message = String((err as { message?: unknown }).message || '').toLowerCase();
  return (
    code === 'permission-denied' ||
    code === 'firestore/permission-denied' ||
    message.includes('missing or insufficient permissions') ||
    message.includes('permission_denied')
  );
}

export function formatWorkersPayrollServiceError(err: unknown): string {
  if (err instanceof WorkersPayrollError) {
    return err.message;
  }
  if (isFirestoreRulesPermissionDenied(err)) {
    return FIRESTORE_RULES_PENDING_MESSAGE_AR;
  }
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    const msg = (err as { message: string }).message.trim();
    if (msg) return msg;
  }
  return 'حدث خطأ غير متوقع أثناء تنفيذ العملية.';
}

export function buildPendingProofAttachmentRef(params: {
  fileName: string;
  mimeType: string;
  fileSize: number;
  clientUploadKey: string;
  syncStatus?: PayrollProofSyncStatus;
  lastSyncError?: string;
}): PayrollProofAttachmentRef {
  return {
    fileName: (params.fileName || 'proof').trim().slice(0, 180),
    mimeType: (params.mimeType || 'application/octet-stream').trim().slice(0, 120),
    fileSize: Math.max(0, Math.round(params.fileSize || 0)),
    clientUploadKey: params.clientUploadKey.trim(),
    syncStatus: params.syncStatus || 'pending_drive_sync',
    ...(params.lastSyncError ? { lastSyncError: params.lastSyncError.trim().slice(0, 400) } : {}),
  };
}

/**
 * Manager-only: Creates a new worker with a permanent immutable ID + atomic audit log.
 * Enforces unique `employeeNumber` within the same organization (`orgId`).
 */
export async function createWorker(params: {
  actor: UserProfile;
  orgId: string;
  branch: Branch;
  input: CreateWorkerInput;
  firestore?: Firestore;
}): Promise<Worker> {
  const firestore = params.firestore || defaultDb;
  const worker = buildValidatedWorkerRecord({
    actor: params.actor,
    orgId: params.orgId,
    branch: params.branch,
    input: params.input,
  });

  // Server-authoritative uniqueness check for employeeNumber within the same organization
  const existingWorkersSnap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workers),
      where('orgId', '==', worker.orgId)
    )
  );
  const existingWorkers = existingWorkersSnap.docs.map((d) => d.data() as Worker);
  assertUniqueEmployeeNumber({
    employeeNumber: worker.employeeNumber,
    orgId: worker.orgId,
    existingWorkers,
  });

  const logId = generatePayrollAuditLogId();
  const auditEntry: PayrollAuditLog = {
    id: logId,
    orgId: worker.orgId,
    actorId: params.actor.uid,
    actorName: actorDisplayName(params.actor),
    actorRole: params.actor.role,
    action: 'WORKER_CREATED',
    targetType: 'worker',
    targetId: worker.id,
    workerId: worker.id,
    branchId: worker.currentBranchId,
    newValues: {
      fullName: worker.fullName,
      employeeNumber: worker.employeeNumber,
      monthlySalary: worker.monthlySalary,
      currentBranchId: worker.currentBranchId,
      hireDate: worker.hireDate,
    },
    details: `إضافة العامل ${worker.fullName} (${worker.employeeNumber}) في فرع ${worker.currentBranchName} براتب ${worker.monthlySalary}`,
    timestamp: worker.createdAt,
  };

  const batch = writeBatch(firestore);
  batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workers, worker.id), worker);
  batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
  await batch.commit();
  return worker;
}

/**
 * Manager-only: Transfers a worker to a new branch atomically on the SAME worker ID.
 * Historical advances retain their original branchId untouched.
 */
export async function transferWorkerBranch(params: {
  actor: UserProfile;
  workerId: string;
  targetBranch: Branch;
  reason?: string;
  firestore?: Firestore;
}): Promise<Worker> {
  const firestore = params.firestore || defaultDb;
  const workerRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workers, params.workerId);
  let resultWorker!: Worker;

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(workerRef);
    if (!snap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'سجل العامل غير موجود.');
    }
    const existingWorker = snap.data() as Worker;
    const { updatedWorker, previousValues, newValues } = prepareWorkerBranchTransfer({
      actor: params.actor,
      worker: existingWorker,
      targetBranch: params.targetBranch,
      reason: params.reason,
    });

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: updatedWorker.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'WORKER_BRANCH_TRANSFERRED',
      targetType: 'worker',
      targetId: updatedWorker.id,
      workerId: updatedWorker.id,
      branchId: updatedWorker.currentBranchId,
      ...(params.reason?.trim() ? { reason: params.reason.trim().slice(0, 300) } : {}),
      previousValues,
      newValues,
      details: `نقل العامل ${updatedWorker.fullName} من ${existingWorker.currentBranchName} إلى ${params.targetBranch.name}`,
      timestamp: updatedWorker.updatedAt,
    };

    tx.set(workerRef, updatedWorker);
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    resultWorker = updatedWorker;
  });

  return resultWorker;
}

/**
 * Manager-only: Suspends, terminates, or reactivates a worker WITHOUT deleting any financial history.
 */
export async function updateWorkerStatus(params: {
  actor: UserProfile;
  workerId: string;
  nextStatus: WorkerStatus;
  reason?: string;
  terminationDate?: string;
  firestore?: Firestore;
}): Promise<Worker> {
  const firestore = params.firestore || defaultDb;
  const workerRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workers, params.workerId);
  let resultWorker!: Worker;

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(workerRef);
    if (!snap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'سجل العامل غير موجود.');
    }
    const existingWorker = snap.data() as Worker;
    assertManagerPayrollAccess(params.actor, existingWorker.orgId);

    const nowIso = new Date().toISOString();
    const cleanReason = (params.reason || '').trim().slice(0, 300);
    const updatedWorker: Worker = {
      ...existingWorker,
      status: params.nextStatus,
      statusChangedAt: nowIso,
      ...(cleanReason ? { statusReason: cleanReason } : {}),
      ...(params.nextStatus === 'terminated' && params.terminationDate
        ? { terminationDate: params.terminationDate }
        : {}),
      updatedAt: nowIso,
    };

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: updatedWorker.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'WORKER_STATUS_CHANGED',
      targetType: 'worker',
      targetId: updatedWorker.id,
      workerId: updatedWorker.id,
      branchId: updatedWorker.currentBranchId,
      ...(cleanReason ? { reason: cleanReason } : {}),
      previousValues: { status: existingWorker.status },
      newValues: { status: params.nextStatus },
      details: `تغيير حالة العامل ${updatedWorker.fullName} من ${existingWorker.status} إلى ${params.nextStatus}`,
      timestamp: nowIso,
    };

    tx.set(workerRef, updatedWorker);
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    resultWorker = updatedWorker;
  });

  return resultWorker;
}

/**
 * Branch Manager (own branch active workers ONLY) or Org Manager:
 * Transactionally locks `workers/{workerId}` to verify worker is STILL active AND STILL in `branch.id`
 * at commit time (eliminating transfer-vs-advance races), then writes advance + audit log.
 */
export async function recordWorkerAdvance(params: {
  actor: UserProfile;
  workerId: string;
  branch: Branch;
  input: RecordWorkerAdvanceInput;
  firestore?: Firestore;
}): Promise<WorkerAdvance> {
  const firestore = params.firestore || defaultDb;
  const workerRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workers, params.workerId);
  let createdAdvance!: WorkerAdvance;

  await runTransaction(firestore, async (tx) => {
    const workerSnap = await tx.get(workerRef);
    if (!workerSnap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'سجل العامل غير موجود.');
    }
    const freshWorker = workerSnap.data() as Worker;
    assertCanRecordWorkerAdvance({
      actor: params.actor,
      worker: freshWorker,
      targetBranchId: params.branch.id,
    });

    const advance = buildValidatedWorkerAdvance({
      actor: params.actor,
      worker: freshWorker,
      branch: params.branch,
      input: params.input,
    });

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: advance.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'WORKER_ADVANCE_RECORDED',
      targetType: 'worker_advance',
      targetId: advance.id,
      workerId: advance.workerId,
      branchId: advance.branchId,
      yearMonth: advance.yearMonth,
      reason: advance.reason,
      newValues: {
        amount: advance.amount,
        date: advance.date,
        paymentMethod: advance.paymentMethod,
        branchId: advance.branchId,
      },
      details: `تسجيل سحبية بقيمة ${advance.amount} للعامل ${advance.workerNameSnapshot} في فرع ${advance.branchNameSnapshot}`,
      timestamp: advance.createdAt,
    };

    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances, advance.id), advance);
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    createdAdvance = advance;
  });

  return createdAdvance;
}

/**
 * Manager-only: Edits an unsettled active advance atomically with full before/after audit log.
 */
export async function editWorkerAdvance(params: {
  actor: UserProfile;
  advanceId: string;
  updates: {
    amount?: number | string;
    date?: string;
    paymentMethod?: 'cash' | 'bank_transfer';
    reason?: string;
    notes?: string;
  };
  auditReason: string;
  firestore?: Firestore;
}): Promise<WorkerAdvance> {
  const firestore = params.firestore || defaultDb;
  const advRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances, params.advanceId);
  let resultAdvance!: WorkerAdvance;

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(advRef);
    if (!snap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'سجل السحبية غير موجود.');
    }
    const existing = snap.data() as WorkerAdvance;
    const { updatedAdvance, previousValues, newValues } = prepareWorkerAdvanceEdit({
      actor: params.actor,
      advance: existing,
      updates: params.updates,
      auditReason: params.auditReason,
    });

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: updatedAdvance.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'WORKER_ADVANCE_UPDATED',
      targetType: 'worker_advance',
      targetId: updatedAdvance.id,
      workerId: updatedAdvance.workerId,
      branchId: updatedAdvance.branchId,
      yearMonth: updatedAdvance.yearMonth,
      reason: params.auditReason.trim(),
      previousValues,
      newValues,
      details: `تعديل سحبية العامل ${updatedAdvance.workerNameSnapshot} من ${existing.amount} إلى ${updatedAdvance.amount}`,
      timestamp: updatedAdvance.updatedAt,
    };

    tx.set(advRef, updatedAdvance);
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    resultAdvance = updatedAdvance;
  });

  return resultAdvance;
}

/**
 * Manager-only: Soft-cancels an unsettled advance (status -> 'cancelled', NEVER deleted).
 */
export async function cancelWorkerAdvance(params: {
  actor: UserProfile;
  advanceId: string;
  cancellationReason: string;
  firestore?: Firestore;
}): Promise<WorkerAdvance> {
  const firestore = params.firestore || defaultDb;
  const advRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances, params.advanceId);
  let resultAdvance!: WorkerAdvance;

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(advRef);
    if (!snap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'سجل السحبية غير موجود.');
    }
    const existing = snap.data() as WorkerAdvance;
    const { cancelledAdvance, previousValues, newValues } = prepareWorkerAdvanceCancellation({
      actor: params.actor,
      advance: existing,
      cancellationReason: params.cancellationReason,
    });

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: cancelledAdvance.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'WORKER_ADVANCE_CANCELLED',
      targetType: 'worker_advance',
      targetId: cancelledAdvance.id,
      workerId: cancelledAdvance.workerId,
      branchId: cancelledAdvance.branchId,
      yearMonth: cancelledAdvance.yearMonth,
      reason: params.cancellationReason.trim(),
      previousValues,
      newValues,
      details: `إلغاء سحبية بقيمة ${cancelledAdvance.amount} للعامل ${cancelledAdvance.workerNameSnapshot}`,
      timestamp: cancelledAdvance.updatedAt,
    };

    tx.set(advRef, cancelledAdvance);
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    resultAdvance = cancelledAdvance;
  });

  return resultAdvance;
}

/**
 * Manager-only: Creates a one-time or recurring bonus/allowance atomically with audit log.
 */
export async function createWorkerAddition(params: {
  actor: UserProfile;
  worker: Worker;
  input: CreateWorkerAdditionInput;
  firestore?: Firestore;
}): Promise<WorkerAddition> {
  const firestore = params.firestore || defaultDb;
  const addition = buildValidatedWorkerAddition({
    actor: params.actor,
    worker: params.worker,
    input: params.input,
  });

  const logId = generatePayrollAuditLogId();
  const auditEntry: PayrollAuditLog = {
    id: logId,
    orgId: addition.orgId,
    actorId: params.actor.uid,
    actorName: actorDisplayName(params.actor),
    actorRole: params.actor.role,
    action: 'WORKER_ADDITION_CREATED',
    targetType: 'worker_addition',
    targetId: addition.id,
    workerId: addition.workerId,
    yearMonth: addition.targetYearMonth || addition.startYearMonth || undefined,
    newValues: {
      label: addition.label,
      category: addition.category,
      recurrence: addition.recurrence,
      amount: addition.amount,
      targetYearMonth: addition.targetYearMonth,
      startYearMonth: addition.startYearMonth,
      endYearMonth: addition.endYearMonth,
    },
    details: `إضافة مالية (${addition.label}) بقيمة ${addition.amount} للعامل ${addition.workerNameSnapshot}`,
    timestamp: addition.createdAt,
  };

  const batch = writeBatch(firestore);
  batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdditions, addition.id), addition);
  batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
  await batch.commit();
  return addition;
}

/**
 * Manager-only: Generates or refreshes a DRAFT monthly payroll run using server-authoritative reads
 * and a deterministic run ID (`prun_<org>_<YYYY-MM>`) to prevent duplicate runs or double carry-over.
 */
export async function generateDraftMonthlyPayrollRun(params: {
  actor: UserProfile;
  orgId: string;
  yearMonth: string;
  firestore?: Firestore;
}): Promise<{ run: PayrollRun; items: PayrollItem[] }> {
  const firestore = params.firestore || defaultDb;
  assertManagerPayrollAccess(params.actor, params.orgId);
  const cleanYearMonth = assertValidYearMonth(params.yearMonth);
  const runId = generatePayrollRunId(params.orgId, cleanYearMonth);

  const [existingRunSnap, workersSnap, advancesSnap, additionsSnap, prevItemsSnap] =
    await Promise.all([
      getDocFromServer(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollRuns, runId)),
      getDocsFromServer(
        query(
          collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workers),
          where('orgId', '==', params.orgId)
        )
      ),
      getDocsFromServer(
        query(
          collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances),
          where('orgId', '==', params.orgId)
        )
      ),
      getDocsFromServer(
        query(
          collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdditions),
          where('orgId', '==', params.orgId)
        )
      ),
      getDocsFromServer(
        query(
          collection(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollItems),
          where('orgId', '==', params.orgId)
        )
      ),
    ]);

  const existingRun = existingRunSnap.exists() ? (existingRunSnap.data() as PayrollRun) : null;
  const workers = workersSnap.docs.map((d) => d.data() as Worker);
  const advances = advancesSnap.docs.map((d) => d.data() as WorkerAdvance);
  const additions = additionsSnap.docs.map((d) => d.data() as WorkerAddition);
  const allItems = prevItemsSnap.docs.map((d) => d.data() as PayrollItem);

  const { run, items } = buildMonthlyPayrollRunDraft({
    actor: params.actor,
    orgId: params.orgId,
    yearMonth: cleanYearMonth,
    workers,
    advances,
    additions,
    previousApprovedItems: allItems.filter((i) => i.status === 'approved'),
    existingRun,
  });

  const logId = generatePayrollAuditLogId();
  const auditEntry: PayrollAuditLog = {
    id: logId,
    orgId: params.orgId,
    actorId: params.actor.uid,
    actorName: actorDisplayName(params.actor),
    actorRole: params.actor.role,
    action: 'PAYROLL_RUN_DRAFT_GENERATED',
    targetType: 'payroll_run',
    targetId: run.id,
    yearMonth: cleanYearMonth,
    newValues: {
      workersCount: run.workersCount,
      totalNetPayable: run.totalNetPayable,
      totalCarryOverOut: run.totalCarryOverOut,
    },
    details: `إنشاء/تحديث مسودة تصفية رواتب شهر ${cleanYearMonth} لعدد ${run.workersCount} عامل`,
    timestamp: run.updatedAt,
  };

  const batch = writeBatch(firestore);
  batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollRuns, run.id), run);
  for (const item of items) {
    batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollItems, item.id), item);
  }
  batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
  await batch.commit();

  return { run, items };
}

/**
 * Manager-only: Atomically approves a monthly payroll run, freezing all item snapshots and
 * stamping every included advance with `payrollSettledRunId` inside a Firestore transaction.
 */
export async function approveMonthlyPayrollRun(params: {
  actor: UserProfile;
  orgId: string;
  yearMonth: string;
  firestore?: Firestore;
}): Promise<PayrollRun> {
  const firestore = params.firestore || defaultDb;
  assertManagerPayrollAccess(params.actor, params.orgId);
  const cleanYearMonth = assertValidYearMonth(params.yearMonth);
  const runId = generatePayrollRunId(params.orgId, cleanYearMonth);
  const runRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollRuns, runId);

  const itemsQuerySnap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollItems),
      where('orgId', '==', params.orgId),
      where('runId', '==', runId)
    )
  );
  const itemIds = itemsQuerySnap.docs.map((d) => d.id).sort();
  if (itemIds.length === 0) {
    throw new WorkersPayrollError(
      'INVALID_INPUT',
      'لا توجد كشوف عمال داخل هذه التصفية لاعتمادها.'
    );
  }

  let approvedRun!: PayrollRun;

  await runTransaction(firestore, async (tx) => {
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'مسودة تصفية الشهر غير موجودة.');
    }
    const existingRun = runSnap.data() as PayrollRun;
    if (existingRun.orgId !== params.orgId) {
      throw new WorkersPayrollError('CROSS_ORG_DENIED', 'تصفية الرواتب تتبع مؤسسة أخرى.');
    }
    if (existingRun.status === 'approved') {
      throw new WorkersPayrollError(
        'PAYROLL_RUN_ALREADY_APPROVED',
        `تصفية رواتب شهر ${cleanYearMonth} معتمدة بالفعل.`
      );
    }

    // Lock all payroll items and all referenced advances in deterministic sorted order
    const freshItems: PayrollItem[] = [];
    const advanceIdSet = new Set<string>();
    for (const itemId of itemIds) {
      const iSnap = await tx.get(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollItems, itemId));
      if (!iSnap.exists()) continue;
      const item = iSnap.data() as PayrollItem;
      freshItems.push(item);
      for (const advSnap of item.advancesSnapshot) {
        advanceIdSet.add(advSnap.advanceId);
      }
    }

    const sortedAdvanceIds = Array.from(advanceIdSet).sort();
    const freshAdvances = new Map<string, WorkerAdvance>();
    for (const advId of sortedAdvanceIds) {
      const aSnap = await tx.get(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances, advId));
      if (!aSnap.exists()) {
        throw new WorkersPayrollError(
          'INVALID_INPUT',
          'تغيّر أحد سجلات السحبيات قبل الاعتماد؛ يرجى إعادة تحديث مسودة التصفية أولاً.'
        );
      }
      const adv = aSnap.data() as WorkerAdvance;
      if (adv.status !== 'active' || (adv.payrollSettledRunId && adv.payrollSettledRunId !== runId)) {
        throw new WorkersPayrollError(
          'INVALID_INPUT',
          'إحدى السحبيات أُلغيت أو اعتمدت في تصفية أخرى؛ يرجى تحديث مسودة التصفية قبل الاعتماد.'
        );
      }
      freshAdvances.set(advId, adv);
    }

    const nowIso = new Date().toISOString();
    const actorName = actorDisplayName(params.actor);

    const approvedItems: PayrollItem[] = freshItems.map((item) => ({
      ...item,
      status: 'approved',
      approvedAt: nowIso,
      updatedAt: nowIso,
    }));

    approvedRun = summarizePayrollRunFromItems({
      runId,
      orgId: params.orgId,
      yearMonth: cleanYearMonth,
      status: 'approved',
      items: approvedItems,
      generatedBy: existingRun.generatedBy,
      generatedByName: existingRun.generatedByName,
      generatedAt: existingRun.generatedAt,
      approvedBy: params.actor.uid,
      approvedByName: actorName,
      approvedAt: nowIso,
      updatedAt: nowIso,
    });

    tx.set(runRef, approvedRun);
    for (const item of approvedItems) {
      tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollItems, item.id), item);
    }
    for (const [advId, adv] of freshAdvances.entries()) {
      tx.update(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances, advId), {
        payrollSettledRunId: runId,
        payrollSettledYearMonth: cleanYearMonth,
        updatedAt: nowIso,
      });
      void adv;
    }

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: params.orgId,
      actorId: params.actor.uid,
      actorName,
      actorRole: params.actor.role,
      action: 'PAYROLL_RUN_APPROVED',
      targetType: 'payroll_run',
      targetId: runId,
      yearMonth: cleanYearMonth,
      newValues: {
        status: 'approved',
        workersCount: approvedRun.workersCount,
        totalNetPayable: approvedRun.totalNetPayable,
        totalCarryOverOut: approvedRun.totalCarryOverOut,
      },
      details: `اعتماد تصفية رواتب شهر ${cleanYearMonth} رسمياً لعدد ${approvedRun.workersCount} عامل بصافي ${approvedRun.totalNetPayable}`,
      timestamp: nowIso,
    };
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
  });

  return approvedRun;
}

/**
 * Manager-only: Transactionally records a partial or full salary disbursement against an APPROVED
 * PayrollItem, updating `paidAmount`, `remainingPayable`, `disbursementStatus`, and parent `PayrollRun` totals.
 */
export async function recordPayrollPayment(params: {
  actor: UserProfile;
  payrollItemId: string;
  input: RecordPayrollPaymentInput;
  firestore?: Firestore;
}): Promise<{ payment: PayrollPayment; updatedItem: PayrollItem }> {
  const firestore = params.firestore || defaultDb;
  const itemRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollItems, params.payrollItemId);
  let outcome!: { payment: PayrollPayment; updatedItem: PayrollItem };

  await runTransaction(firestore, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'كشف راتب العامل غير موجود.');
    }
    const existingItem = itemSnap.data() as PayrollItem;
    const runRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollRuns, existingItem.runId);
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'تصفية الشهر المرتبطة غير موجودة.');
    }
    const existingRun = runSnap.data() as PayrollRun;

    const cleanRequestKey = (params.input.clientRequestKey || '').trim();
    const deterministicPaymentId = cleanRequestKey
      ? generateIdempotentPayrollPaymentId(existingItem.id, cleanRequestKey)
      : undefined;

    if (deterministicPaymentId) {
      const existingPaySnap = await tx.get(
        doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollPayments, deterministicPaymentId)
      );
      if (existingPaySnap.exists()) {
        throw new WorkersPayrollError(
          'DUPLICATE_PAYMENT_REQUEST',
          'تم تسجيل هذه الدفعة بالفعل؛ تم منع التسجيل المكرر تلقائياً.'
        );
      }
    }

    const { payment, updatedItem } = preparePayrollPayment({
      actor: params.actor,
      item: existingItem,
      input: params.input,
      paymentId: deterministicPaymentId,
    });

    const nextRunPaidHalalas = existingRun.totalPaidHalalas + payment.amountHalalas;
    const nextRunRemainingHalalas = Math.max(0, existingRun.totalNetPayableHalalas - nextRunPaidHalalas);

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: updatedItem.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'PAYROLL_PAYMENT_RECORDED',
      targetType: 'payroll_payment',
      targetId: payment.id,
      workerId: updatedItem.workerId,
      branchId: updatedItem.branchIdSnapshot,
      yearMonth: updatedItem.yearMonth,
      newValues: {
        amount: payment.amount,
        paymentDate: payment.paymentDate,
        paymentMethod: payment.paymentMethod,
        disbursementStatus: updatedItem.disbursementStatus,
        remainingPayable: updatedItem.remainingPayable,
      },
      details: `صرف دفعة راتب بقيمة ${payment.amount} للعامل ${updatedItem.workerNameSnapshot} عن شهر ${updatedItem.yearMonth}`,
      timestamp: payment.recordedAt,
    };

    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollPayments, payment.id), payment);
    tx.set(itemRef, updatedItem);
    tx.update(runRef, {
      totalPaid: fromHalalas(nextRunPaidHalalas),
      totalPaidHalalas: nextRunPaidHalalas,
      totalRemaining: fromHalalas(nextRunRemainingHalalas),
      totalRemainingHalalas: nextRunRemainingHalalas,
      updatedAt: payment.recordedAt,
    });
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);

    outcome = { payment, updatedItem };
  });

  return outcome;
}

/**
 * Manager-only: Documented administrative correction of an APPROVED PayrollItem.
 */
export async function adminCorrectApprovedPayrollItem(params: {
  actor: UserProfile;
  payrollItemId: string;
  baseSalary?: number | string;
  additionsTotal?: number | string;
  advancesTotal?: number | string;
  carryOverIn?: number | string;
  correctionReason: string;
  firestore?: Firestore;
}): Promise<PayrollItem> {
  const firestore = params.firestore || defaultDb;
  const itemRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollItems, params.payrollItemId);
  let resultItem!: PayrollItem;

  await runTransaction(firestore, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'كشف راتب العامل غير موجود.');
    }
    const existingItem = itemSnap.data() as PayrollItem;
    const runRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollRuns, existingItem.runId);
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'تصفية الشهر المرتبطة غير موجودة.');
    }
    const existingRun = runSnap.data() as PayrollRun;

    const { updatedItem, previousValues, newValues } = prepareApprovedPayrollItemCorrection({
      actor: params.actor,
      item: existingItem,
      baseSalary: params.baseSalary,
      additionsTotal: params.additionsTotal,
      advancesTotal: params.advancesTotal,
      carryOverIn: params.carryOverIn,
      correctionReason: params.correctionReason,
    });

    const deltaBase = updatedItem.baseSalaryHalalas - existingItem.baseSalaryHalalas;
    const deltaAdditions = updatedItem.additionsTotalHalalas - existingItem.additionsTotalHalalas;
    const deltaAdvances = updatedItem.advancesTotalHalalas - existingItem.advancesTotalHalalas;
    const deltaCarryIn = updatedItem.carryOverInHalalas - existingItem.carryOverInHalalas;
    const deltaGross = updatedItem.grossEntitlementHalalas - existingItem.grossEntitlementHalalas;
    const deltaDeducted = updatedItem.deductedAmountHalalas - existingItem.deductedAmountHalalas;
    const deltaNet = updatedItem.netPayableHalalas - existingItem.netPayableHalalas;
    const deltaCarryOut = updatedItem.carryOverOutHalalas - existingItem.carryOverOutHalalas;
    const deltaRemaining = updatedItem.remainingPayableHalalas - existingItem.remainingPayableHalalas;

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: updatedItem.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'PAYROLL_ITEM_ADMIN_CORRECTED',
      targetType: 'payroll_item',
      targetId: updatedItem.id,
      workerId: updatedItem.workerId,
      branchId: updatedItem.branchIdSnapshot,
      yearMonth: updatedItem.yearMonth,
      reason: params.correctionReason.trim(),
      previousValues,
      newValues,
      details: `تصحيح إداري موثق لكشف راتب ${updatedItem.workerNameSnapshot} عن شهر ${updatedItem.yearMonth}`,
      timestamp: updatedItem.updatedAt,
    };

    tx.set(itemRef, updatedItem);
    tx.update(runRef, {
      totalBaseSalary: fromHalalas(existingRun.totalBaseSalaryHalalas + deltaBase),
      totalBaseSalaryHalalas: existingRun.totalBaseSalaryHalalas + deltaBase,
      totalAdditions: fromHalalas(existingRun.totalAdditionsHalalas + deltaAdditions),
      totalAdditionsHalalas: existingRun.totalAdditionsHalalas + deltaAdditions,
      totalAdvances: fromHalalas(existingRun.totalAdvancesHalalas + deltaAdvances),
      totalAdvancesHalalas: existingRun.totalAdvancesHalalas + deltaAdvances,
      totalCarryOverIn: fromHalalas(existingRun.totalCarryOverInHalalas + deltaCarryIn),
      totalCarryOverInHalalas: existingRun.totalCarryOverInHalalas + deltaCarryIn,
      totalGrossEntitlement: fromHalalas(existingRun.totalGrossEntitlementHalalas + deltaGross),
      totalGrossEntitlementHalalas: existingRun.totalGrossEntitlementHalalas + deltaGross,
      totalDeductions: fromHalalas(existingRun.totalDeductionsHalalas + deltaDeducted),
      totalDeductionsHalalas: existingRun.totalDeductionsHalalas + deltaDeducted,
      totalNetPayable: fromHalalas(existingRun.totalNetPayableHalalas + deltaNet),
      totalNetPayableHalalas: existingRun.totalNetPayableHalalas + deltaNet,
      totalCarryOverOut: fromHalalas(existingRun.totalCarryOverOutHalalas + deltaCarryOut),
      totalCarryOverOutHalalas: existingRun.totalCarryOverOutHalalas + deltaCarryOut,
      totalRemaining: fromHalalas(existingRun.totalRemainingHalalas + deltaRemaining),
      totalRemainingHalalas: existingRun.totalRemainingHalalas + deltaRemaining,
      updatedAt: updatedItem.updatedAt,
    });
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    resultItem = updatedItem;
  });

  return resultItem;
}

/**
 * Unified Google Drive integration for Worker Advance & Withdrawal proof attachments.
 * Saves directly inside `<Org Root> / الفروع / <Branch> / <YYYY> / <MM> / <DD>`
 * with NO per-type subfolder, enforcing organization owner Drive access & retry idempotency.
 */
export async function uploadWorkerAdvanceProofToDrive(params: {
  token: string;
  actor: UserProfile;
  org: Organization;
  branch: Branch;
  advanceId: string;
  advanceDate: string; // YYYY-MM-DD
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  clientUploadKey?: string;
}): Promise<UnifiedDriveUploadResult> {
  return uploadUnifiedDriveFile({
    token: params.token,
    actor: {
      uid: params.actor.uid,
      orgId: params.actor.orgId,
      role: params.actor.role,
      isActive: params.actor.isActive,
      displayName: params.actor.displayName,
      email: params.actor.email,
    },
    org: params.org,
    branch: params.branch,
    documentType: 'worker_advance',
    documentDate: params.advanceDate,
    recordId: params.advanceId,
    fileName: params.fileName,
    mimeType: params.mimeType,
    bytes: params.bytes,
    clientUploadKey: params.clientUploadKey,
  });
}

/**
 * Unified Google Drive integration for Payroll Payment proof attachments.
 * Saves directly inside `<Org Root> / الفروع / <Branch> / <YYYY> / <MM> / <DD>`
 * with NO per-type subfolder, enforcing organization owner Drive access & retry idempotency.
 */
export async function uploadPayrollPaymentProofToDrive(params: {
  token: string;
  actor: UserProfile;
  org: Organization;
  branch: Branch;
  paymentId: string;
  paymentDate: string; // YYYY-MM-DD
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  clientUploadKey?: string;
}): Promise<UnifiedDriveUploadResult> {
  return uploadUnifiedDriveFile({
    token: params.token,
    actor: {
      uid: params.actor.uid,
      orgId: params.actor.orgId,
      role: params.actor.role,
      isActive: params.actor.isActive,
      displayName: params.actor.displayName,
      email: params.actor.email,
    },
    org: params.org,
    branch: params.branch,
    documentType: 'payroll_payment',
    documentDate: params.paymentDate,
    recordId: params.paymentId,
    fileName: params.fileName,
    mimeType: params.mimeType,
    bytes: params.bytes,
    clientUploadKey: params.clientUploadKey,
  });
}

// =============================================================================
// Server-Authoritative Read / Query Operations (Strict Role & Tenant Isolation)
// =============================================================================

export async function fetchOrgWorkers(params: {
  actor: UserProfile;
  orgId: string;
  firestore?: Firestore;
}): Promise<Worker[]> {
  assertManagerPayrollAccess(params.actor, params.orgId);
  const firestore = params.firestore || defaultDb;
  const snap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workers),
      where('orgId', '==', params.orgId)
    )
  );
  return snap.docs
    .map((d) => d.data() as Worker)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
}

export async function fetchBranchActiveWorkers(params: {
  actor: UserProfile;
  orgId: string;
  branchId: string;
  firestore?: Firestore;
}): Promise<Worker[]> {
  const access = resolveWorkersPayrollAccess(params.actor);
  if (!access.canViewBranchActiveWorkers) {
    throw new WorkersPayrollError(
      'UNAUTHORIZED_ROLE',
      'ليس لديك صلاحية الاطلاع على عمال الفرع.'
    );
  }
  if (params.actor.orgId !== params.orgId) {
    throw new WorkersPayrollError('CROSS_ORG_DENIED', 'لا يمكن الوصول إلى عمال مؤسسة أخرى.');
  }
  if (access.restrictedBranchId && access.restrictedBranchId !== params.branchId) {
    throw new WorkersPayrollError(
      'BRANCH_MISMATCH',
      'مسؤول الفرع مقيّد بالاطلاع على عمال فرعه المعيّن فقط.'
    );
  }
  const firestore = params.firestore || defaultDb;
  const snap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workers),
      where('orgId', '==', params.orgId),
      where('currentBranchId', '==', params.branchId),
      where('status', '==', 'active')
    )
  );
  const raw = snap.docs.map((d) => d.data() as Worker);
  return filterVisibleWorkersForActor(params.actor, raw).sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'ar')
  );
}

export async function fetchOrgWorkerAdvances(params: {
  actor: UserProfile;
  orgId: string;
  firestore?: Firestore;
}): Promise<WorkerAdvance[]> {
  assertManagerPayrollAccess(params.actor, params.orgId);
  const firestore = params.firestore || defaultDb;
  const snap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances),
      where('orgId', '==', params.orgId)
    )
  );
  return snap.docs
    .map((d) => d.data() as WorkerAdvance)
    .sort((a, b) => (b.date !== a.date ? b.date.localeCompare(a.date) : b.createdAt.localeCompare(a.createdAt)));
}

export async function fetchBranchWorkerAdvances(params: {
  actor: UserProfile;
  orgId: string;
  branchId: string;
  firestore?: Firestore;
}): Promise<WorkerAdvance[]> {
  const access = resolveWorkersPayrollAccess(params.actor);
  if (!access.canRecordBranchAdvance) {
    throw new WorkersPayrollError('UNAUTHORIZED_ROLE', 'ليس لديك صلاحية عرض سُلف الفرع.');
  }
  if (params.actor.orgId !== params.orgId) {
    throw new WorkersPayrollError('CROSS_ORG_DENIED', 'لا يمكن الوصول إلى سُلف مؤسسة أخرى.');
  }
  if (access.restrictedBranchId && access.restrictedBranchId !== params.branchId) {
    throw new WorkersPayrollError(
      'BRANCH_MISMATCH',
      'مسؤول الفرع مقيّد بعرض سُلف فرعه المعيّن فقط.'
    );
  }
  const firestore = params.firestore || defaultDb;
  const snap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances),
      where('orgId', '==', params.orgId),
      where('branchId', '==', params.branchId)
    )
  );
  return snap.docs
    .map((d) => d.data() as WorkerAdvance)
    .sort((a, b) => (b.date !== a.date ? b.date.localeCompare(a.date) : b.createdAt.localeCompare(a.createdAt)));
}

export async function fetchOrgWorkerAdditions(params: {
  actor: UserProfile;
  orgId: string;
  firestore?: Firestore;
}): Promise<WorkerAddition[]> {
  assertManagerPayrollAccess(params.actor, params.orgId);
  const firestore = params.firestore || defaultDb;
  const snap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdditions),
      where('orgId', '==', params.orgId)
    )
  );
  return snap.docs
    .map((d) => d.data() as WorkerAddition)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function fetchOrgPayrollRuns(params: {
  actor: UserProfile;
  orgId: string;
  firestore?: Firestore;
}): Promise<PayrollRun[]> {
  assertManagerPayrollAccess(params.actor, params.orgId);
  const firestore = params.firestore || defaultDb;
  const snap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollRuns),
      where('orgId', '==', params.orgId)
    )
  );
  return snap.docs
    .map((d) => d.data() as PayrollRun)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
}

export async function fetchOrgPayrollItems(params: {
  actor: UserProfile;
  orgId: string;
  yearMonth?: string;
  firestore?: Firestore;
}): Promise<PayrollItem[]> {
  assertManagerPayrollAccess(params.actor, params.orgId);
  const firestore = params.firestore || defaultDb;
  const constraints = [where('orgId', '==', params.orgId)];
  if (params.yearMonth) {
    constraints.push(where('yearMonth', '==', assertValidYearMonth(params.yearMonth)));
  }
  const snap = await getDocsFromServer(
    query(collection(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollItems), ...constraints)
  );
  return snap.docs
    .map((d) => d.data() as PayrollItem)
    .sort((a, b) =>
      b.yearMonth !== a.yearMonth
        ? b.yearMonth.localeCompare(a.yearMonth)
        : a.workerNameSnapshot.localeCompare(b.workerNameSnapshot, 'ar')
    );
}

export async function fetchOrgPayrollPayments(params: {
  actor: UserProfile;
  orgId: string;
  yearMonth?: string;
  firestore?: Firestore;
}): Promise<PayrollPayment[]> {
  assertManagerPayrollAccess(params.actor, params.orgId);
  const firestore = params.firestore || defaultDb;
  const constraints = [where('orgId', '==', params.orgId)];
  if (params.yearMonth) {
    constraints.push(where('yearMonth', '==', assertValidYearMonth(params.yearMonth)));
  }
  const snap = await getDocsFromServer(
    query(collection(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollPayments), ...constraints)
  );
  return snap.docs
    .map((d) => d.data() as PayrollPayment)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export async function fetchOrgPayrollAuditLogs(params: {
  actor: UserProfile;
  orgId: string;
  firestore?: Firestore;
}): Promise<PayrollAuditLog[]> {
  assertManagerPayrollAccess(params.actor, params.orgId);
  const firestore = params.firestore || defaultDb;
  const snap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs),
      where('orgId', '==', params.orgId)
    )
  );
  return snap.docs
    .map((d) => d.data() as PayrollAuditLog)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// =============================================================================
// Additional Manager Lifecycle Write Operations (Worker Edit, Additions, Reversal)
// =============================================================================

export async function updateWorkerDetails(params: {
  actor: UserProfile;
  workerId: string;
  updates: {
    fullName?: string;
    employeeNumber?: string;
    phone?: string;
    monthlySalary?: number | string;
    hireDate?: string;
    notes?: string;
  };
  firestore?: Firestore;
}): Promise<Worker> {
  const firestore = params.firestore || defaultDb;
  const workerRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workers, params.workerId);
  const preSnap = await getDocFromServer(workerRef);
  if (!preSnap.exists()) {
    throw new WorkersPayrollError('INVALID_INPUT', 'سجل العامل غير موجود.');
  }
  const preWorker = preSnap.data() as Worker;
  assertManagerPayrollAccess(params.actor, preWorker.orgId);

  const orgWorkersSnap = await getDocsFromServer(
    query(
      collection(firestore, WORKERS_PAYROLL_COLLECTIONS.workers),
      where('orgId', '==', preWorker.orgId)
    )
  );
  const orgWorkers = orgWorkersSnap.docs.map((d) => d.data() as Worker);

  let resultWorker!: Worker;
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(workerRef);
    if (!snap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'سجل العامل غير موجود.');
    }
    const existingWorker = snap.data() as Worker;
    const { updatedWorker, previousValues, newValues } = prepareWorkerDetailsEdit({
      actor: params.actor,
      worker: existingWorker,
      existingWorkers: orgWorkers,
      updates: params.updates,
    });

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: updatedWorker.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'WORKER_UPDATED',
      targetType: 'worker',
      targetId: updatedWorker.id,
      workerId: updatedWorker.id,
      branchId: updatedWorker.currentBranchId,
      previousValues,
      newValues,
      details: `تحديث بيانات العامل ${updatedWorker.fullName} (${updatedWorker.employeeNumber})`,
      timestamp: updatedWorker.updatedAt,
    };

    tx.set(workerRef, updatedWorker);
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    resultWorker = updatedWorker;
  });

  return resultWorker;
}

export async function updateWorkerAddition(params: {
  actor: UserProfile;
  additionId: string;
  updates: {
    category?: WorkerAdditionCategory;
    label?: string;
    amount?: number | string;
    targetYearMonth?: string | null;
    startYearMonth?: string | null;
    endYearMonth?: string | null;
    notes?: string;
  };
  reason?: string;
  firestore?: Firestore;
}): Promise<WorkerAddition> {
  const firestore = params.firestore || defaultDb;
  const addRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdditions, params.additionId);
  let resultAddition!: WorkerAddition;

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(addRef);
    if (!snap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'سجل الإضافة المالية غير موجود.');
    }
    const existing = snap.data() as WorkerAddition;
    const { updatedAddition, previousValues, newValues } = prepareWorkerAdditionUpdate({
      actor: params.actor,
      addition: existing,
      updates: params.updates,
      reason: params.reason,
    });

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: updatedAddition.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'WORKER_ADDITION_UPDATED',
      targetType: 'worker_addition',
      targetId: updatedAddition.id,
      workerId: updatedAddition.workerId,
      yearMonth: updatedAddition.targetYearMonth || updatedAddition.startYearMonth || undefined,
      ...(params.reason?.trim() ? { reason: params.reason.trim().slice(0, 300) } : {}),
      previousValues,
      newValues,
      details: `تعديل الإضافة المالية (${updatedAddition.label}) للعامل ${updatedAddition.workerNameSnapshot} إلى ${updatedAddition.amount}`,
      timestamp: updatedAddition.updatedAt,
    };

    tx.set(addRef, updatedAddition);
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    resultAddition = updatedAddition;
  });

  return resultAddition;
}

export async function changeWorkerAdditionStatus(params: {
  actor: UserProfile;
  additionId: string;
  nextStatus: WorkerAdditionStatus;
  endYearMonth?: string | null;
  reason?: string;
  firestore?: Firestore;
}): Promise<WorkerAddition> {
  const firestore = params.firestore || defaultDb;
  const addRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdditions, params.additionId);
  let resultAddition!: WorkerAddition;

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(addRef);
    if (!snap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'سجل الإضافة المالية غير موجود.');
    }
    const existing = snap.data() as WorkerAddition;
    const { updatedAddition, previousValues, newValues } = prepareWorkerAdditionStatusChange({
      actor: params.actor,
      addition: existing,
      nextStatus: params.nextStatus,
      endYearMonth: params.endYearMonth,
      reason: params.reason,
    });

    const logId = generatePayrollAuditLogId();
    const auditAction =
      params.nextStatus === 'stopped'
        ? 'WORKER_ADDITION_STOPPED'
        : params.nextStatus === 'cancelled'
        ? 'WORKER_ADDITION_CANCELLED'
        : 'WORKER_ADDITION_UPDATED';
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: updatedAddition.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: auditAction,
      targetType: 'worker_addition',
      targetId: updatedAddition.id,
      workerId: updatedAddition.workerId,
      ...(params.reason?.trim() ? { reason: params.reason.trim().slice(0, 300) } : {}),
      previousValues,
      newValues,
      details: `تغيير حالة الإضافة (${updatedAddition.label}) للعامل ${updatedAddition.workerNameSnapshot} إلى ${params.nextStatus}`,
      timestamp: updatedAddition.updatedAt,
    };

    tx.set(addRef, updatedAddition);
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    resultAddition = updatedAddition;
  });

  return resultAddition;
}

export async function reversePayrollPayment(params: {
  actor: UserProfile;
  paymentId: string;
  reversalReason: string;
  firestore?: Firestore;
}): Promise<{ reversedPayment: PayrollPayment; updatedItem: PayrollItem }> {
  const firestore = params.firestore || defaultDb;
  const paymentRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollPayments, params.paymentId);
  let outcome!: { reversedPayment: PayrollPayment; updatedItem: PayrollItem };

  await runTransaction(firestore, async (tx) => {
    const paySnap = await tx.get(paymentRef);
    if (!paySnap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'سجل دفعة الراتب غير موجود.');
    }
    const existingPayment = paySnap.data() as PayrollPayment;
    const itemRef = doc(
      firestore,
      WORKERS_PAYROLL_COLLECTIONS.payrollItems,
      existingPayment.payrollItemId
    );
    const runRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollRuns, existingPayment.runId);
    const [itemSnap, runSnap] = await Promise.all([tx.get(itemRef), tx.get(runRef)]);
    if (!itemSnap.exists() || !runSnap.exists()) {
      throw new WorkersPayrollError('INVALID_INPUT', 'كشف الراتب المرتبط بالدفعة غير موجود.');
    }
    const existingItem = itemSnap.data() as PayrollItem;
    const existingRun = runSnap.data() as PayrollRun;

    const { reversedPayment, updatedItem, previousValues, newValues } =
      preparePayrollPaymentReversal({
        actor: params.actor,
        item: existingItem,
        payment: existingPayment,
        reversalReason: params.reversalReason,
      });

    const nextRunPaidHalalas = Math.max(0, existingRun.totalPaidHalalas - existingPayment.amountHalalas);
    const nextRunRemainingHalalas = Math.max(
      0,
      existingRun.totalNetPayableHalalas - nextRunPaidHalalas
    );

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: updatedItem.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'PAYROLL_PAYMENT_REVERSED',
      targetType: 'payroll_payment',
      targetId: reversedPayment.id,
      workerId: updatedItem.workerId,
      branchId: updatedItem.branchIdSnapshot,
      yearMonth: updatedItem.yearMonth,
      reason: params.reversalReason.trim(),
      previousValues,
      newValues,
      details: `عكس دفعة راتب بقيمة ${existingPayment.amount} للعامل ${updatedItem.workerNameSnapshot} عن شهر ${updatedItem.yearMonth}`,
      timestamp: updatedItem.updatedAt,
    };

    tx.set(paymentRef, reversedPayment);
    tx.set(itemRef, updatedItem);
    tx.update(runRef, {
      totalPaid: fromHalalas(nextRunPaidHalalas),
      totalPaidHalalas: nextRunPaidHalalas,
      totalRemaining: fromHalalas(nextRunRemainingHalalas),
      totalRemainingHalalas: nextRunRemainingHalalas,
      updatedAt: updatedItem.updatedAt,
    });
    tx.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);

    outcome = { reversedPayment, updatedItem };
  });

  return outcome;
}

// =============================================================================
// Unified Google Drive Proof Sync, Idempotent Retry & Safe Trash Helpers
// =============================================================================

export async function syncWorkerAdvanceProofToDrive(params: {
  token: string;
  actor: UserProfile;
  org: Organization;
  branch: Branch;
  advance: WorkerAdvance;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  firestore?: Firestore;
}): Promise<{ proofAttachment: PayrollProofAttachmentRef; uploadResult: UnifiedDriveUploadResult }> {
  assertManagerPayrollAccess(params.actor, params.advance.orgId);
  const clientUploadKey =
    params.advance.proofAttachment?.clientUploadKey || `adv_proof_${params.advance.id}`;
  const firestore = params.firestore || defaultDb;
  const advRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances, params.advance.id);

  try {
    const uploadResult = await uploadWorkerAdvanceProofToDrive({
      token: params.token,
      actor: params.actor,
      org: params.org,
      branch: params.branch,
      advanceId: params.advance.id,
      advanceDate: params.advance.date,
      fileName: params.fileName,
      mimeType: params.mimeType,
      bytes: params.bytes,
      clientUploadKey,
    });

    const nowIso = new Date().toISOString();
    const proofAttachment: PayrollProofAttachmentRef = {
      fileName: uploadResult.record.fileName || params.fileName,
      mimeType: params.mimeType,
      fileSize: params.bytes.byteLength,
      clientUploadKey,
      syncStatus: 'uploaded',
      driveFileId: uploadResult.record.fileId,
      driveWebViewLink: uploadResult.record.webViewLink,
      driveFolderPath: uploadResult.folderPath,
      uploadedAt: nowIso,
      uploadedBy: params.actor.uid,
    };

    const nextAttachmentIds = Array.from(
      new Set([...(params.advance.attachmentIds || []), uploadResult.record.fileId])
    );

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: params.advance.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'WORKER_ADVANCE_PROOF_SYNCED',
      targetType: 'worker_advance',
      targetId: params.advance.id,
      workerId: params.advance.workerId,
      branchId: params.advance.branchId,
      yearMonth: params.advance.yearMonth,
      newValues: {
        driveFileId: uploadResult.record.fileId,
        fileName: proofAttachment.fileName,
        reusedExisting: uploadResult.reusedExisting,
      },
      details: `مزامنة إثبات سحبية العامل ${params.advance.workerNameSnapshot} إلى Google Drive (${proofAttachment.fileName})`,
      timestamp: nowIso,
    };

    const batch = writeBatch(firestore);
    batch.update(advRef, {
      proofAttachment,
      attachmentIds: nextAttachmentIds,
      updatedAt: nowIso,
    });
    batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    await batch.commit();

    return { proofAttachment, uploadResult };
  } catch (err) {
    // Never lose the advance or proof metadata if Drive upload fails
    const errMsg = formatWorkersPayrollServiceError(err);
    const failedRef = buildPendingProofAttachmentRef({
      fileName: params.fileName,
      mimeType: params.mimeType,
      fileSize: params.bytes.byteLength,
      clientUploadKey,
      syncStatus: 'sync_failed',
      lastSyncError: errMsg,
    });
    try {
      const batch = writeBatch(firestore);
      batch.update(advRef, {
        proofAttachment: failedRef,
        updatedAt: new Date().toISOString(),
      });
      await batch.commit();
    } catch {
      // Preserve original Drive error even if Firestore rules also block update
    }
    throw err;
  }
}

export async function syncPayrollPaymentProofToDrive(params: {
  token: string;
  actor: UserProfile;
  org: Organization;
  branch: Branch;
  payment: PayrollPayment;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  firestore?: Firestore;
}): Promise<{ proofAttachment: PayrollProofAttachmentRef; uploadResult: UnifiedDriveUploadResult }> {
  assertManagerPayrollAccess(params.actor, params.payment.orgId);
  const clientUploadKey =
    params.payment.proofAttachment?.clientUploadKey || `pay_proof_${params.payment.id}`;
  const firestore = params.firestore || defaultDb;
  const payRef = doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollPayments, params.payment.id);

  try {
    const uploadResult = await uploadPayrollPaymentProofToDrive({
      token: params.token,
      actor: params.actor,
      org: params.org,
      branch: params.branch,
      paymentId: params.payment.id,
      paymentDate: params.payment.paymentDate,
      fileName: params.fileName,
      mimeType: params.mimeType,
      bytes: params.bytes,
      clientUploadKey,
    });

    const nowIso = new Date().toISOString();
    const proofAttachment: PayrollProofAttachmentRef = {
      fileName: uploadResult.record.fileName || params.fileName,
      mimeType: params.mimeType,
      fileSize: params.bytes.byteLength,
      clientUploadKey,
      syncStatus: 'uploaded',
      driveFileId: uploadResult.record.fileId,
      driveWebViewLink: uploadResult.record.webViewLink,
      driveFolderPath: uploadResult.folderPath,
      uploadedAt: nowIso,
      uploadedBy: params.actor.uid,
    };

    const nextAttachmentIds = Array.from(
      new Set([...(params.payment.attachmentIds || []), uploadResult.record.fileId])
    );

    const logId = generatePayrollAuditLogId();
    const auditEntry: PayrollAuditLog = {
      id: logId,
      orgId: params.payment.orgId,
      actorId: params.actor.uid,
      actorName: actorDisplayName(params.actor),
      actorRole: params.actor.role,
      action: 'PAYROLL_PAYMENT_PROOF_SYNCED',
      targetType: 'payroll_payment',
      targetId: params.payment.id,
      workerId: params.payment.workerId,
      branchId: params.payment.branchIdSnapshot,
      yearMonth: params.payment.yearMonth,
      newValues: {
        driveFileId: uploadResult.record.fileId,
        fileName: proofAttachment.fileName,
        reusedExisting: uploadResult.reusedExisting,
      },
      details: `مزامنة إثبات صرف راتب العامل ${params.payment.workerNameSnapshot} إلى Google Drive (${proofAttachment.fileName})`,
      timestamp: nowIso,
    };

    const batch = writeBatch(firestore);
    batch.update(payRef, {
      proofAttachment,
      attachmentIds: nextAttachmentIds,
    });
    batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
    await batch.commit();

    return { proofAttachment, uploadResult };
  } catch (err) {
    const errMsg = formatWorkersPayrollServiceError(err);
    const failedRef = buildPendingProofAttachmentRef({
      fileName: params.fileName,
      mimeType: params.mimeType,
      fileSize: params.bytes.byteLength,
      clientUploadKey,
      syncStatus: 'sync_failed',
      lastSyncError: errMsg,
    });
    try {
      const batch = writeBatch(firestore);
      batch.update(payRef, { proofAttachment: failedRef });
      await batch.commit();
    } catch {
      // Preserve original Drive error
    }
    throw err;
  }
}

/**
 * Safe Delete (Trash ONLY — NEVER HTTP DELETE, NEVER deletes the parent advance record).
 */
export async function trashWorkerAdvanceProofSafely(params: {
  token: string;
  actor: UserProfile;
  org: Organization;
  advance: WorkerAdvance;
  confirmed: boolean;
  reason?: string;
  firestore?: Firestore;
}): Promise<PayrollProofAttachmentRef> {
  assertManagerPayrollAccess(params.actor, params.advance.orgId);
  const existingProof = params.advance.proofAttachment;
  if (!existingProof?.driveFileId) {
    throw new WorkersPayrollError('INVALID_INPUT', 'لا يوجد ملف مرفق مرفوع في Google Drive لنقله إلى السلة.');
  }

  const firestore = params.firestore || defaultDb;
  let updatedProof: PayrollProofAttachmentRef = existingProof;

  await trashUnifiedDriveFile({
    token: params.token,
    actor: {
      uid: params.actor.uid,
      orgId: params.actor.orgId,
      role: params.actor.role,
      isActive: params.actor.isActive,
      displayName: params.actor.displayName,
      email: params.actor.email,
    },
    org: params.org,
    fileId: existingProof.driveFileId,
    confirmed: params.confirmed,
    expectedRecordId: params.advance.id,
    documentType: 'worker_advance',
    reason: params.reason,
    onDriveTrashed: async ({ trashedAt, trashedBy, trashedByName }) => {
      updatedProof = {
        ...existingProof,
        syncStatus: 'trashed',
        trashedAt,
        trashedBy,
        trashedByName,
        ...(params.reason?.trim() ? { trashReason: params.reason.trim().slice(0, 300) } : {}),
      };
      const logId = generatePayrollAuditLogId();
      const auditEntry: PayrollAuditLog = {
        id: logId,
        orgId: params.advance.orgId,
        actorId: params.actor.uid,
        actorName: actorDisplayName(params.actor),
        actorRole: params.actor.role,
        action: 'WORKER_ADVANCE_PROOF_TRASHED',
        targetType: 'worker_advance',
        targetId: params.advance.id,
        workerId: params.advance.workerId,
        branchId: params.advance.branchId,
        yearMonth: params.advance.yearMonth,
        ...(params.reason?.trim() ? { reason: params.reason.trim().slice(0, 300) } : {}),
        previousValues: { syncStatus: existingProof.syncStatus, driveFileId: existingProof.driveFileId },
        newValues: { syncStatus: 'trashed', trashedAt },
        details: `نقل مرفق سحبية ${params.advance.workerNameSnapshot} إلى سلة مهملات Google Drive مع بقاء سجل السحبية سليماً`,
        timestamp: trashedAt,
      };

      const batch = writeBatch(firestore);
      batch.update(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.workerAdvances, params.advance.id), {
        proofAttachment: updatedProof,
        updatedAt: trashedAt,
      });
      batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
      await batch.commit();
    },
  });

  return updatedProof;
}

/**
 * Safe Delete (Trash ONLY — NEVER HTTP DELETE, NEVER deletes the parent payment record).
 */
export async function trashPayrollPaymentProofSafely(params: {
  token: string;
  actor: UserProfile;
  org: Organization;
  payment: PayrollPayment;
  confirmed: boolean;
  reason?: string;
  firestore?: Firestore;
}): Promise<PayrollProofAttachmentRef> {
  assertManagerPayrollAccess(params.actor, params.payment.orgId);
  const existingProof = params.payment.proofAttachment;
  if (!existingProof?.driveFileId) {
    throw new WorkersPayrollError('INVALID_INPUT', 'لا يوجد إثبات صرف مرفوع في Google Drive لنقله إلى السلة.');
  }

  const firestore = params.firestore || defaultDb;
  let updatedProof: PayrollProofAttachmentRef = existingProof;

  await trashUnifiedDriveFile({
    token: params.token,
    actor: {
      uid: params.actor.uid,
      orgId: params.actor.orgId,
      role: params.actor.role,
      isActive: params.actor.isActive,
      displayName: params.actor.displayName,
      email: params.actor.email,
    },
    org: params.org,
    fileId: existingProof.driveFileId,
    confirmed: params.confirmed,
    expectedRecordId: params.payment.id,
    documentType: 'payroll_payment',
    reason: params.reason,
    onDriveTrashed: async ({ trashedAt, trashedBy, trashedByName }) => {
      updatedProof = {
        ...existingProof,
        syncStatus: 'trashed',
        trashedAt,
        trashedBy,
        trashedByName,
        ...(params.reason?.trim() ? { trashReason: params.reason.trim().slice(0, 300) } : {}),
      };
      const logId = generatePayrollAuditLogId();
      const auditEntry: PayrollAuditLog = {
        id: logId,
        orgId: params.payment.orgId,
        actorId: params.actor.uid,
        actorName: actorDisplayName(params.actor),
        actorRole: params.actor.role,
        action: 'PAYROLL_PAYMENT_PROOF_TRASHED',
        targetType: 'payroll_payment',
        targetId: params.payment.id,
        workerId: params.payment.workerId,
        branchId: params.payment.branchIdSnapshot,
        yearMonth: params.payment.yearMonth,
        ...(params.reason?.trim() ? { reason: params.reason.trim().slice(0, 300) } : {}),
        previousValues: { syncStatus: existingProof.syncStatus, driveFileId: existingProof.driveFileId },
        newValues: { syncStatus: 'trashed', trashedAt },
        details: `نقل إثبات صرف راتب ${params.payment.workerNameSnapshot} إلى سلة مهملات Google Drive مع بقاء سجل الدفعة سليماً`,
        timestamp: trashedAt,
      };

      const batch = writeBatch(firestore);
      batch.update(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollPayments, params.payment.id), {
        proofAttachment: updatedProof,
      });
      batch.set(doc(firestore, WORKERS_PAYROLL_COLLECTIONS.payrollAuditLogs, logId), auditEntry);
      await batch.commit();
    },
  });

  return updatedProof;
}

export async function downloadPayrollProofFromDrive(params: {
  token: string;
  actor: UserProfile;
  org: Organization;
  fileId: string;
  expectedRecordId?: string;
}) {
  return downloadUnifiedDriveFile({
    token: params.token,
    actor: {
      uid: params.actor.uid,
      orgId: params.actor.orgId,
      role: params.actor.role,
      isActive: params.actor.isActive,
      displayName: params.actor.displayName,
      email: params.actor.email,
    },
    org: params.org,
    fileId: params.fileId,
    expectedRecordId: params.expectedRecordId,
  });
}

export { assertValidCurrencyHalalas };

