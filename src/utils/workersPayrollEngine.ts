/**
 * Workers, Advances, Additions, Monthly Payroll Settlement & Disbursement Engine
 * الإقفال | AL EQFAL — Pure Domain Logic, Validation, RBAC & Integer-Halala Math
 *
 * Security & Accounting Guarantees:
 * - Zero automatic permission expansion for `supervisor` or `employee` roles.
 * - Strict single-branch isolation for `branch_manager` (active workers in own branch ONLY).
 * - Strict cross-tenant isolation (`orgId` verified on every entity).
 * - Pure integer Halala arithmetic (`toHalalas` / `fromHalalas`) — zero floating-point drift.
 * - Deterministic IDs for `PayrollRun` and `PayrollItem` prevent duplicate monthly settlements.
 * - Explicit settlement stamping (`payrollSettledRunId`) & `carryOverSourceItemId` prevent
 *   double-counting advances or double-carrying balances across retries.
 */
import type { Branch, UserProfile } from '../types';
import type {
  PayrollAdditionSnapshot,
  PayrollAdvanceSnapshot,
  PayrollDisbursementStatus,
  PayrollItem,
  PayrollPayment,
  PayrollPaymentMethod,
  PayrollProofAttachmentRef,
  PayrollRun,
  Worker,
  WorkerAddition,
  WorkerAdditionCategory,
  WorkerAdditionRecurrence,
  WorkerAdditionStatus,
  WorkerAdvance,
  WorkersPayrollAccess,
  WorkerStatus,
} from '../types/workersPayroll';
import { fromHalalas, toHalalas } from './accounting';
import { resolveUserAssignedBranchIds } from './permissions';
import { assertValidIsoCalendarDate } from '../services/excelReportService';

export const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
export const SAFE_FIRESTORE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
export const MAX_MONETARY_AMOUNT = 10_000_000; // 10,000,000.00 safety ceiling

export const ADDITION_CATEGORY_LABELS_AR: Record<WorkerAdditionCategory, string> = {
  performance_bonus: 'مكافأة أداء',
  transport_allowance: 'بدل نقل',
  housing_allowance: 'بدل سكن',
  extra_allowance: 'العمل الإضافي / بدل إضافي',
  exceptional_bonus: 'مكافأة استثنائية',
  custom: 'إضافة مخصصة',
};

export const PAYMENT_METHOD_LABELS_AR: Record<PayrollPaymentMethod, string> = {
  cash: 'نقدي',
  bank_transfer: 'تحويل بنكي',
};

export const WORKER_STATUS_LABELS_AR: Record<WorkerStatus, string> = {
  active: 'نشط',
  suspended: 'موقوف مؤقتاً',
  terminated: 'منتهي الخدمة',
};

export const DISBURSEMENT_STATUS_LABELS_AR: Record<PayrollDisbursementStatus, string> = {
  unpaid: 'لم يُصرف',
  partially_paid: 'مدفوع جزئياً',
  paid: 'مدفوع بالكامل',
};

export type WorkersPayrollErrorCode =
  | 'UNAUTHORIZED_ROLE'
  | 'CROSS_ORG_DENIED'
  | 'BRANCH_MISMATCH'
  | 'WORKER_INACTIVE'
  | 'INVALID_INPUT'
  | 'DUPLICATE_EMPLOYEE_NUMBER'
  | 'DUPLICATE_PAYMENT_REQUEST'
  | 'ADVANCE_LOCKED_BY_APPROVED_PAYROLL'
  | 'ADVANCE_ALREADY_CANCELLED'
  | 'PAYROLL_RUN_ALREADY_APPROVED'
  | 'PAYROLL_ITEM_NOT_APPROVED'
  | 'PAYMENT_EXCEEDS_REMAINING'
  | 'CORRECTION_BELOW_PAID_AMOUNT'
  | 'PAYMENT_ALREADY_REVERSED';

export class WorkersPayrollError extends Error {
  readonly code: WorkersPayrollErrorCode;

  constructor(code: WorkersPayrollErrorCode, message: string) {
    super(message);
    this.name = 'WorkersPayrollError';
    this.code = code;
  }
}

function sanitizeIdPart(raw: string): string {
  return (raw || '').replace(/[^a-zA-Z0-9]/g, '');
}

function randomIdSuffix(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}_${rand}`;
}

export function generateWorkerId(): string {
  return `wrk_${randomIdSuffix()}`;
}

export function generateWorkerAdvanceId(): string {
  return `wadv_${randomIdSuffix()}`;
}

export function generateWorkerAdditionId(): string {
  return `wadd_${randomIdSuffix()}`;
}

export function generatePayrollPaymentId(): string {
  return `ppay_${randomIdSuffix()}`;
}

/**
 * Deterministic ID derived from `(payrollItemId, clientRequestKey)` so retrying or
 * double-clicking the exact same disbursement request hits the same Firestore doc ID
 * and can NEVER create a duplicate salary payment.
 */
export function generateIdempotentPayrollPaymentId(
  payrollItemId: string,
  clientRequestKey: string
): string {
  const cleanItem = sanitizeIdPart(payrollItemId);
  const cleanKey = (clientRequestKey || '').trim();
  if (!cleanItem || !cleanKey) {
    throw new WorkersPayrollError('INVALID_INPUT', 'مفتاح منع التكرار للدفعة غير صالح.');
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const seed = `${cleanItem}::${cleanKey}`;
  for (let i = 0; i < seed.length; i += 1) {
    const c = seed.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return `ppay_idem_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function normalizeEmployeeNumber(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

export function assertUniqueEmployeeNumber(params: {
  employeeNumber: string;
  orgId: string;
  existingWorkers: Worker[];
  excludeWorkerId?: string;
}): void {
  const targetNorm = normalizeEmployeeNumber(params.employeeNumber);
  if (!targetNorm) {
    throw new WorkersPayrollError('INVALID_INPUT', 'الرقم الوظيفي للعامل مطلوب.');
  }
  const conflict = params.existingWorkers.find(
    (w) =>
      w.orgId === params.orgId &&
      w.id !== params.excludeWorkerId &&
      normalizeEmployeeNumber(w.employeeNumber) === targetNorm
  );
  if (conflict) {
    throw new WorkersPayrollError(
      'DUPLICATE_EMPLOYEE_NUMBER',
      `الرقم الوظيفي "${params.employeeNumber.trim()}" مستخدم بالفعل للعامل "${conflict.fullName}" داخل نفس المؤسسة.`
    );
  }
}

export function generatePayrollAuditLogId(): string {
  return `plog_${randomIdSuffix()}`;
}

/**
 * Deterministic ID for a monthly payroll run: strictly ONE run per (orgId, yearMonth).
 */
export function generatePayrollRunId(orgId: string, yearMonth: string): string {
  assertValidYearMonth(yearMonth);
  const cleanOrg = sanitizeIdPart(orgId);
  if (!cleanOrg) {
    throw new WorkersPayrollError('INVALID_INPUT', 'معرّف المؤسسة غير صالح.');
  }
  return `prun_${cleanOrg}_${yearMonth}`;
}

/**
 * Deterministic ID for a worker's monthly payroll statement:
 * strictly ONE item per (orgId, yearMonth, workerId).
 */
export function generatePayrollItemId(
  orgId: string,
  yearMonth: string,
  workerId: string
): string {
  assertValidYearMonth(yearMonth);
  const cleanOrg = sanitizeIdPart(orgId);
  const cleanWorker = sanitizeIdPart(workerId);
  if (!cleanOrg || !cleanWorker) {
    throw new WorkersPayrollError('INVALID_INPUT', 'معرّف المؤسسة أو العامل غير صالح.');
  }
  return `pitem_${cleanOrg}_${yearMonth}_${cleanWorker}`;
}

export function assertValidYearMonth(yearMonth: string): string {
  const clean = (yearMonth || '').trim();
  if (!YEAR_MONTH_REGEX.test(clean)) {
    throw new WorkersPayrollError(
      'INVALID_INPUT',
      'صيغة الشهر غير صالحة؛ يجب أن تكون بصيغة YYYY-MM (مثال: 2026-11).'
    );
  }
  return clean;
}

export function getPreviousYearMonth(yearMonth: string): string {
  const clean = assertValidYearMonth(yearMonth);
  const [yStr, mStr] = clean.split('-');
  let year = Number(yStr);
  let month = Number(mStr) - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Validates that a currency amount is finite, within bounds, and has at most 2 decimal places.
 */
export function assertValidCurrencyHalalas(
  rawAmount: number | string,
  options: { fieldLabelAr: string; allowZero?: boolean }
): number {
  const numeric = typeof rawAmount === 'string' ? Number(rawAmount.trim()) : rawAmount;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    throw new WorkersPayrollError('INVALID_INPUT', `قيمة ${options.fieldLabelAr} غير صالحة.`);
  }
  if (options.allowZero ? numeric < 0 : numeric <= 0) {
    throw new WorkersPayrollError(
      'INVALID_INPUT',
      options.allowZero
        ? `يجب أن تكون قيمة ${options.fieldLabelAr} صفراً أو أكبر.`
        : `يجب أن تكون قيمة ${options.fieldLabelAr} أكبر من الصفر.`
    );
  }
  if (numeric > MAX_MONETARY_AMOUNT) {
    throw new WorkersPayrollError(
      'INVALID_INPUT',
      `قيمة ${options.fieldLabelAr} تتجاوز الحد الأقصى المسموح به.`
    );
  }
  const scaled = numeric * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
    throw new WorkersPayrollError(
      'INVALID_INPUT',
      `يجب ألا تحتوي قيمة ${options.fieldLabelAr} على أكثر من خانتين عشريتين (هللات).`
    );
  }
  return toHalalas(numeric);
}

/**
 * Resolves Workers & Payroll operational access strictly from existing user roles.
 * - `manager`: full organization management & reports.
 * - `branch_manager` (strictly single assigned branch): view active workers in OWN branch + create advances ONLY.
 * - `supervisor` & `employee`: strictly DENIED across all Workers & Payroll capabilities (zero automatic expansion).
 */
export function resolveWorkersPayrollAccess(
  profile: Pick<UserProfile, 'role' | 'isActive' | 'orgId' | 'branchId' | 'branchIds'> | null | undefined
): WorkersPayrollAccess {
  const denied: WorkersPayrollAccess = {
    canManageWorkers: false,
    canTransferWorkers: false,
    canViewAllOrgWorkers: false,
    canViewBranchActiveWorkers: false,
    canRecordBranchAdvance: false,
    canEditOrCancelAdvances: false,
    canManageAdditions: false,
    canManagePayrollRuns: false,
    canApprovePayrollRuns: false,
    canAdminCorrectPayroll: false,
    canRecordPayrollPayments: false,
    canViewPayrollReports: false,
    restrictedBranchId: null,
  };

  if (!profile || profile.isActive !== true || !profile.orgId) {
    return denied;
  }

  if (profile.role === 'manager') {
    return {
      canManageWorkers: true,
      canTransferWorkers: true,
      canViewAllOrgWorkers: true,
      canViewBranchActiveWorkers: true,
      canRecordBranchAdvance: true,
      canEditOrCancelAdvances: true,
      canManageAdditions: true,
      canManagePayrollRuns: true,
      canApprovePayrollRuns: true,
      canAdminCorrectPayroll: true,
      canRecordPayrollPayments: true,
      canViewPayrollReports: true,
      restrictedBranchId: null,
    };
  }

  if (profile.role === 'branch_manager') {
    const assignedBranches = resolveUserAssignedBranchIds(profile);
    if (assignedBranches.length !== 1) {
      return denied;
    }
    return {
      ...denied,
      canViewBranchActiveWorkers: true,
      canRecordBranchAdvance: true,
      restrictedBranchId: assignedBranches[0],
    };
  }

  // `supervisor` and `employee` receive ZERO automatic Workers & Payroll permissions
  return denied;
}

export function assertManagerPayrollAccess(
  profile: UserProfile | null | undefined,
  orgId: string
): void {
  if (!profile || profile.isActive !== true || profile.role !== 'manager') {
    throw new WorkersPayrollError(
      'UNAUTHORIZED_ROLE',
      'هذه العملية مقتصرة على مدير المؤسسة فقط.'
    );
  }
  if (!orgId || profile.orgId !== orgId) {
    throw new WorkersPayrollError(
      'CROSS_ORG_DENIED',
      'لا يمكن الوصول إلى سجلات العمال أو الرواتب التابعة لمؤسسة أخرى.'
    );
  }
}

/**
 * Verifies whether an actor (manager or single-branch branch_manager) is permitted to record
 * a new advance for `worker` on `targetBranchId` right now.
 *
 * Enforces post-transfer isolation:
 * - Old branch manager is immediately blocked once `worker.currentBranchId` changes.
 * - New branch manager is immediately permitted once `worker.currentBranchId` matches their branch.
 * - Suspended or terminated workers cannot receive new advances.
 */
export function assertCanRecordWorkerAdvance(params: {
  actor: UserProfile | null | undefined;
  worker: Worker;
  targetBranchId: string;
}): void {
  const { actor, worker, targetBranchId } = params;
  const access = resolveWorkersPayrollAccess(actor);
  if (!actor || !access.canRecordBranchAdvance) {
    throw new WorkersPayrollError(
      'UNAUTHORIZED_ROLE',
      'ليست لديك صلاحية تسجيل سلف أو سحبيات للعمال.'
    );
  }
  if (actor.orgId !== worker.orgId) {
    throw new WorkersPayrollError(
      'CROSS_ORG_DENIED',
      'لا يمكن تسجيل سحبية لعامل تابع لمؤسسة أخرى.'
    );
  }
  if (worker.status !== 'active') {
    throw new WorkersPayrollError(
      'WORKER_INACTIVE',
      'لا يمكن تسجيل سحبية جديدة لعامل موقوف أو منتهي الخدمة.'
    );
  }
  if (!targetBranchId || worker.currentBranchId !== targetBranchId) {
    throw new WorkersPayrollError(
      'BRANCH_MISMATCH',
      'العامل لا يتبع هذا الفرع حالياً؛ لا يمكن تسجيل سحبية على فرع مختلف عن فرعه الحالي.'
    );
  }
  if (actor.role === 'branch_manager' && access.restrictedBranchId !== targetBranchId) {
    throw new WorkersPayrollError(
      'BRANCH_MISMATCH',
      'يستطيع مسؤول الفرع تسجيل السحبيات لعمال فرعه المعيّن فقط.'
    );
  }
}

/**
 * Filters workers visible to a specific user profile.
 * - Manager: all workers in orgId (active, suspended, terminated).
 * - Branch Manager: strictly active workers in their single assigned branch.
 * - Supervisor / Employee: empty array.
 */
export function filterVisibleWorkersForActor(
  actor: UserProfile | null | undefined,
  workers: Worker[]
): Worker[] {
  const access = resolveWorkersPayrollAccess(actor);
  if (!actor) return [];

  if (access.canViewAllOrgWorkers) {
    return workers.filter((w) => w.orgId === actor.orgId);
  }

  if (access.canViewBranchActiveWorkers && access.restrictedBranchId) {
    return workers.filter(
      (w) =>
        w.orgId === actor.orgId &&
        w.status === 'active' &&
        w.currentBranchId === access.restrictedBranchId
    );
  }

  return [];
}

export interface CreateWorkerInput {
  fullName: string;
  employeeNumber: string;
  phone?: string;
  monthlySalary: number | string;
  branchId: string;
  hireDate: string;
  notes?: string;
}

export function buildValidatedWorkerRecord(params: {
  actor: UserProfile;
  orgId: string;
  branch: Branch;
  input: CreateWorkerInput;
  workerId?: string;
  nowIso?: string;
}): Worker {
  assertManagerPayrollAccess(params.actor, params.orgId);

  if (params.branch.orgId !== params.orgId) {
    throw new WorkersPayrollError('CROSS_ORG_DENIED', 'الفرع المحدد لا يتبع هذه المؤسسة.');
  }
  if (!params.branch.isActive) {
    throw new WorkersPayrollError('INVALID_INPUT', 'لا يمكن ربط العامل بفرع غير نشط.');
  }

  const fullName = (params.input.fullName || '').trim();
  if (fullName.length < 2 || fullName.length > 120) {
    throw new WorkersPayrollError('INVALID_INPUT', 'يجب إدخال اسم العامل (من 2 إلى 120 حرفاً).');
  }

  const employeeNumber = (params.input.employeeNumber || '').trim();
  if (employeeNumber.length < 1 || employeeNumber.length > 40) {
    throw new WorkersPayrollError('INVALID_INPUT', 'يجب إدخال الرقم الوظيفي للعامل.');
  }

  const phone = (params.input.phone || '').trim();
  if (phone.length > 30) {
    throw new WorkersPayrollError('INVALID_INPUT', 'رقم الجوال طويل جداً (الحد الأقصى 30 خانة).');
  }

  const monthlySalaryHalalas = assertValidCurrencyHalalas(params.input.monthlySalary, {
    fieldLabelAr: 'الراتب الشهري',
    allowZero: true,
  });

  const { date: hireDate } = assertValidIsoCalendarDate(params.input.hireDate);
  const notes = (params.input.notes || '').trim().slice(0, 500);
  const nowIso = params.nowIso || new Date().toISOString();

  return {
    id: params.workerId || generateWorkerId(),
    orgId: params.orgId,
    fullName,
    employeeNumber,
    ...(phone ? { phone } : {}),
    monthlySalary: fromHalalas(monthlySalaryHalalas),
    monthlySalaryHalalas,
    currentBranchId: params.branch.id,
    currentBranchName: params.branch.name,
    hireDate,
    status: 'active',
    ...(notes ? { notes } : {}),
    branchTransferHistory: [],
    createdBy: params.actor.uid,
    createdByName: (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Prepares a branch transfer on the SAME stable worker record.
 * Historical advances are NEVER modified; they retain their original `branchId`.
 */
export function prepareWorkerBranchTransfer(params: {
  actor: UserProfile;
  worker: Worker;
  targetBranch: Branch;
  reason?: string;
  nowIso?: string;
}): {
  updatedWorker: Worker;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} {
  assertManagerPayrollAccess(params.actor, params.worker.orgId);

  if (params.targetBranch.orgId !== params.worker.orgId) {
    throw new WorkersPayrollError('CROSS_ORG_DENIED', 'الفرع الهدف لا يتبع هذه المؤسسة.');
  }
  if (!params.targetBranch.isActive) {
    throw new WorkersPayrollError('INVALID_INPUT', 'لا يمكن نقل العامل إلى فرع غير نشط.');
  }
  if (params.worker.currentBranchId === params.targetBranch.id) {
    throw new WorkersPayrollError('INVALID_INPUT', 'العامل يعمل بالفعل في هذا الفرع.');
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const reason = (params.reason || '').trim().slice(0, 300);
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  const history = Array.isArray(params.worker.branchTransferHistory)
    ? [...params.worker.branchTransferHistory]
    : [];
  history.push({
    fromBranchId: params.worker.currentBranchId,
    fromBranchName: params.worker.currentBranchName,
    toBranchId: params.targetBranch.id,
    toBranchName: params.targetBranch.name,
    transferredAt: nowIso,
    transferredBy: params.actor.uid,
    transferredByName: actorName,
    ...(reason ? { reason } : {}),
  });

  const updatedWorker: Worker = {
    ...params.worker,
    // Strictly preserve stable worker.id
    id: params.worker.id,
    currentBranchId: params.targetBranch.id,
    currentBranchName: params.targetBranch.name,
    branchTransferHistory: history,
    updatedAt: nowIso,
  };

  return {
    updatedWorker,
    previousValues: {
      currentBranchId: params.worker.currentBranchId,
      currentBranchName: params.worker.currentBranchName,
    },
    newValues: {
      currentBranchId: params.targetBranch.id,
      currentBranchName: params.targetBranch.name,
    },
  };
}

export interface RecordWorkerAdvanceInput {
  amount: number | string;
  date: string; // YYYY-MM-DD
  paymentMethod: PayrollPaymentMethod;
  reason: string;
  notes?: string;
  attachmentIds?: string[];
  proofAttachment?: PayrollProofAttachmentRef | null;
}

export function buildValidatedWorkerAdvance(params: {
  actor: UserProfile;
  worker: Worker;
  branch: Branch;
  input: RecordWorkerAdvanceInput;
  advanceId?: string;
  nowIso?: string;
}): WorkerAdvance {
  assertCanRecordWorkerAdvance({
    actor: params.actor,
    worker: params.worker,
    targetBranchId: params.branch.id,
  });

  if (params.branch.orgId !== params.worker.orgId || !params.branch.isActive) {
    throw new WorkersPayrollError('INVALID_INPUT', 'الفرع غير صالح أو غير نشط.');
  }

  const amountHalalas = assertValidCurrencyHalalas(params.input.amount, {
    fieldLabelAr: 'مبلغ السحبية',
    allowZero: false,
  });
  const { date: isoDate, yearMonth } = assertValidIsoCalendarDate(params.input.date);

  if (params.input.paymentMethod !== 'cash' && params.input.paymentMethod !== 'bank_transfer') {
    throw new WorkersPayrollError('INVALID_INPUT', 'طريقة التسليم يجب أن تكون نقدي أو تحويل بنكي.');
  }

  const reason = (params.input.reason || '').trim();
  if (reason.length < 2 || reason.length > 300) {
    throw new WorkersPayrollError('INVALID_INPUT', 'يجب توضيح سبب السحبية (من 2 إلى 300 حرف).');
  }

  const notes = (params.input.notes || '').trim().slice(0, 500);
  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = (params.actor.displayName || params.actor.email || 'مستخدم').trim().slice(0, 100);

  return {
    id: params.advanceId || generateWorkerAdvanceId(),
    orgId: params.worker.orgId,
    workerId: params.worker.id,
    workerNameSnapshot: params.worker.fullName,
    workerEmployeeNumberSnapshot: params.worker.employeeNumber,
    branchId: params.branch.id,
    branchNameSnapshot: params.branch.name,
    amount: fromHalalas(amountHalalas),
    amountHalalas,
    date: isoDate,
    yearMonth,
    paymentMethod: params.input.paymentMethod,
    reason,
    ...(notes ? { notes } : {}),
    attachmentIds: Array.isArray(params.input.attachmentIds) ? params.input.attachmentIds : [],
    ...(params.input.proofAttachment ? { proofAttachment: params.input.proofAttachment } : {}),
    status: 'active',
    payrollSettledRunId: null,
    payrollSettledYearMonth: null,
    createdBy: params.actor.uid,
    createdByName: actorName,
    createdByRole: params.actor.role,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Manager-only advance edit with mandatory audit trail (`previousValues`, `newValues`, `reason`).
 * Blocks editing cancelled advances or advances already settled in an approved payroll run.
 */
export function prepareWorkerAdvanceEdit(params: {
  actor: UserProfile;
  advance: WorkerAdvance;
  updates: {
    amount?: number | string;
    date?: string;
    paymentMethod?: PayrollPaymentMethod;
    reason?: string;
    notes?: string;
  };
  auditReason: string;
  nowIso?: string;
}): {
  updatedAdvance: WorkerAdvance;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} {
  assertManagerPayrollAccess(params.actor, params.advance.orgId);

  if (params.advance.status === 'cancelled') {
    throw new WorkersPayrollError('ADVANCE_ALREADY_CANCELLED', 'لا يمكن تعديل سحبية ملغاة.');
  }
  if (params.advance.payrollSettledRunId) {
    throw new WorkersPayrollError(
      'ADVANCE_LOCKED_BY_APPROVED_PAYROLL',
      'لا يمكن تعديل سحبية تم احتسابها داخل كشف رواتب معتمد؛ يرجى استخدام إجراء التصحيح الإداري الموثق.'
    );
  }

  const cleanAuditReason = (params.auditReason || '').trim();
  if (cleanAuditReason.length < 3 || cleanAuditReason.length > 300) {
    throw new WorkersPayrollError('INVALID_INPUT', 'يجب كتابة سبب واضح للتعديل (3 أحرف على الأقل).');
  }

  const nextAmountHalalas =
    params.updates.amount !== undefined
      ? assertValidCurrencyHalalas(params.updates.amount, {
          fieldLabelAr: 'مبلغ السحبية',
          allowZero: false,
        })
      : params.advance.amountHalalas;

  let nextDate = params.advance.date;
  let nextYearMonth = params.advance.yearMonth;
  if (params.updates.date !== undefined) {
    const parsed = assertValidIsoCalendarDate(params.updates.date);
    nextDate = parsed.date;
    nextYearMonth = parsed.yearMonth;
  }

  const nextMethod = params.updates.paymentMethod ?? params.advance.paymentMethod;
  if (nextMethod !== 'cash' && nextMethod !== 'bank_transfer') {
    throw new WorkersPayrollError('INVALID_INPUT', 'طريقة التسليم غير صالحة.');
  }

  const nextReason =
    params.updates.reason !== undefined ? params.updates.reason.trim() : params.advance.reason;
  if (nextReason.length < 2 || nextReason.length > 300) {
    throw new WorkersPayrollError('INVALID_INPUT', 'سبب السحبية غير صالح.');
  }

  const nextNotes =
    params.updates.notes !== undefined
      ? params.updates.notes.trim().slice(0, 500)
      : params.advance.notes || '';

  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  const updatedAdvance: WorkerAdvance = {
    ...params.advance,
    // Strictly preserve historical branchId and workerId
    branchId: params.advance.branchId,
    branchNameSnapshot: params.advance.branchNameSnapshot,
    workerId: params.advance.workerId,
    amount: fromHalalas(nextAmountHalalas),
    amountHalalas: nextAmountHalalas,
    date: nextDate,
    yearMonth: nextYearMonth,
    paymentMethod: nextMethod,
    reason: nextReason,
    ...(nextNotes ? { notes: nextNotes } : {}),
    editedBy: params.actor.uid,
    editedByName: actorName,
    editedAt: nowIso,
    editReason: cleanAuditReason,
    updatedAt: nowIso,
  };

  return {
    updatedAdvance,
    previousValues: {
      amount: params.advance.amount,
      amountHalalas: params.advance.amountHalalas,
      date: params.advance.date,
      yearMonth: params.advance.yearMonth,
      paymentMethod: params.advance.paymentMethod,
      reason: params.advance.reason,
      notes: params.advance.notes || '',
    },
    newValues: {
      amount: updatedAdvance.amount,
      amountHalalas: updatedAdvance.amountHalalas,
      date: updatedAdvance.date,
      yearMonth: updatedAdvance.yearMonth,
      paymentMethod: updatedAdvance.paymentMethod,
      reason: updatedAdvance.reason,
      notes: updatedAdvance.notes || '',
    },
  };
}

/**
 * Manager-only soft cancellation of an advance (NEVER deletes record; excludes from future payroll).
 */
export function prepareWorkerAdvanceCancellation(params: {
  actor: UserProfile;
  advance: WorkerAdvance;
  cancellationReason: string;
  nowIso?: string;
}): {
  cancelledAdvance: WorkerAdvance;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} {
  assertManagerPayrollAccess(params.actor, params.advance.orgId);

  if (params.advance.status === 'cancelled') {
    throw new WorkersPayrollError('ADVANCE_ALREADY_CANCELLED', 'هذه السحبية ملغاة بالفعل.');
  }
  if (params.advance.payrollSettledRunId) {
    throw new WorkersPayrollError(
      'ADVANCE_LOCKED_BY_APPROVED_PAYROLL',
      'لا يمكن إلغاء سحبية معتمدة داخل كشف رواتب سابق؛ يجب إجراء تصحيح إداري موثق.'
    );
  }

  const cleanReason = (params.cancellationReason || '').trim();
  if (cleanReason.length < 3 || cleanReason.length > 300) {
    throw new WorkersPayrollError('INVALID_INPUT', 'يجب كتابة سبب الإلغاء (3 أحرف على الأقل).');
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  const cancelledAdvance: WorkerAdvance = {
    ...params.advance,
    status: 'cancelled',
    cancelledBy: params.actor.uid,
    cancelledByName: actorName,
    cancelledAt: nowIso,
    cancellationReason: cleanReason,
    updatedAt: nowIso,
  };

  return {
    cancelledAdvance,
    previousValues: { status: 'active', amount: params.advance.amount },
    newValues: { status: 'cancelled', cancellationReason: cleanReason },
  };
}

export interface CreateWorkerAdditionInput {
  category: WorkerAdditionCategory;
  customLabel?: string;
  recurrence: WorkerAdditionRecurrence;
  amount: number | string;
  targetYearMonth?: string;
  startYearMonth?: string;
  endYearMonth?: string;
  notes?: string;
}

export function buildValidatedWorkerAddition(params: {
  actor: UserProfile;
  worker: Worker;
  input: CreateWorkerAdditionInput;
  additionId?: string;
  nowIso?: string;
}): WorkerAddition {
  assertManagerPayrollAccess(params.actor, params.worker.orgId);

  const amountHalalas = assertValidCurrencyHalalas(params.input.amount, {
    fieldLabelAr: 'قيمة الإضافة المالية',
    allowZero: false,
  });

  const baseLabel =
    params.input.category === 'custom'
      ? (params.input.customLabel || '').trim()
      : (params.input.customLabel || '').trim() || ADDITION_CATEGORY_LABELS_AR[params.input.category];

  if (!baseLabel || baseLabel.length < 2 || baseLabel.length > 120) {
    throw new WorkersPayrollError('INVALID_INPUT', 'يجب تحديد اسم واضح للإضافة المالية.');
  }

  let targetYearMonth: string | null = null;
  let startYearMonth: string | null = null;
  let endYearMonth: string | null = null;

  if (params.input.recurrence === 'one_time') {
    targetYearMonth = assertValidYearMonth(params.input.targetYearMonth || '');
  } else if (params.input.recurrence === 'monthly_recurring') {
    startYearMonth = assertValidYearMonth(params.input.startYearMonth || '');
    if (params.input.endYearMonth && params.input.endYearMonth.trim()) {
      endYearMonth = assertValidYearMonth(params.input.endYearMonth);
      if (endYearMonth < startYearMonth) {
        throw new WorkersPayrollError(
          'INVALID_INPUT',
          'شهر الإيقاف يجب أن يكون مساوياً أو لاحقاً لشهر البداية.'
        );
      }
    }
  } else {
    throw new WorkersPayrollError('INVALID_INPUT', 'نوع تكرار الإضافة غير صالح.');
  }

  const notes = (params.input.notes || '').trim().slice(0, 500);
  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  return {
    id: params.additionId || generateWorkerAdditionId(),
    orgId: params.worker.orgId,
    workerId: params.worker.id,
    workerNameSnapshot: params.worker.fullName,
    category: params.input.category,
    label: baseLabel,
    recurrence: params.input.recurrence,
    amount: fromHalalas(amountHalalas),
    amountHalalas,
    targetYearMonth,
    startYearMonth,
    endYearMonth,
    status: 'active',
    ...(notes ? { notes } : {}),
    createdBy: params.actor.uid,
    createdByName: actorName,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Determines whether a financial addition applies to a specific `yearMonth` (`YYYY-MM`).
 * - Cancelled additions NEVER apply.
 * - `one_time` applies strictly when `targetYearMonth === yearMonth` and `status === 'active'`.
 * - `monthly_recurring` applies when `startYearMonth <= yearMonth` AND:
 *   - if `status === 'active'`: `!endYearMonth || yearMonth <= endYearMonth`
 *   - if `status === 'stopped'`: applies ONLY up to `endYearMonth` (requires explicit `endYearMonth >= yearMonth`)
 */
export function isAdditionApplicableForMonth(
  addition: WorkerAddition,
  yearMonth: string
): boolean {
  if (addition.status === 'cancelled') return false;

  if (addition.recurrence === 'one_time') {
    return addition.status === 'active' && addition.targetYearMonth === yearMonth;
  }

  if (!addition.startYearMonth || yearMonth < addition.startYearMonth) {
    return false;
  }

  if (addition.status === 'stopped') {
    return Boolean(addition.endYearMonth && yearMonth <= addition.endYearMonth);
  }

  return !addition.endYearMonth || yearMonth <= addition.endYearMonth;
}

export function resolveDisbursementStatus(
  netPayableHalalas: number,
  paidAmountHalalas: number
): PayrollDisbursementStatus {
  if (netPayableHalalas <= 0) {
    return 'paid';
  }
  if (paidAmountHalalas <= 0) {
    return 'unpaid';
  }
  if (paidAmountHalalas >= netPayableHalalas) {
    return 'paid';
  }
  return 'partially_paid';
}

/**
 * Pure Integer-Halala Calculation of a Worker's Monthly Payroll Statement.
 *
 * Exact Binding Formula:
 *   grossEntitlement = baseSalary + additionsTotal
 *   totalObligations = activeUnsettledAdvancesInMonth + carryOverInFromPreviousApprovedMonth
 *   deductedAmount   = min(grossEntitlement, totalObligations)
 *   netPayable       = grossEntitlement - deductedAmount
 *   carryOverOut     = totalObligations - deductedAmount
 *
 * Anti-double-counting guarantees:
 * - Excludes cancelled advances (`status === 'cancelled'`).
 * - Excludes advances already stamped `payrollSettledRunId` for a DIFFERENT run.
 * - Deduplicates advances & additions by ID.
 * - Links `carryOverIn` explicitly to `previousApprovedItem.id` so retries NEVER double-carry.
 */
export function calculateWorkerMonthlyPayrollItem(params: {
  orgId: string;
  yearMonth: string;
  runId: string;
  worker: Worker;
  workerAdvances: WorkerAdvance[];
  workerAdditions: WorkerAddition[];
  previousApprovedItem?: PayrollItem | null;
  nowIso?: string;
}): PayrollItem {
  const cleanYearMonth = assertValidYearMonth(params.yearMonth);
  const nowIso = params.nowIso || new Date().toISOString();
  const { worker } = params;

  const baseSalaryHalalas =
    typeof worker.monthlySalaryHalalas === 'number'
      ? Math.max(0, Math.round(worker.monthlySalaryHalalas))
      : toHalalas(worker.monthlySalary);

  // 1. Applicable additions (deduplicated by ID)
  const uniqueAdditions = new Map<string, WorkerAddition>();
  for (const add of params.workerAdditions) {
    if (add.orgId === params.orgId && add.workerId === worker.id) {
      uniqueAdditions.set(add.id, add);
    }
  }
  const additionsSnapshot: PayrollAdditionSnapshot[] = [];
  let additionsTotalHalalas = 0;
  for (const add of uniqueAdditions.values()) {
    if (!isAdditionApplicableForMonth(add, cleanYearMonth)) continue;
    const amtHalalas =
      typeof add.amountHalalas === 'number' ? Math.round(add.amountHalalas) : toHalalas(add.amount);
    additionsTotalHalalas += amtHalalas;
    additionsSnapshot.push({
      additionId: add.id,
      category: add.category,
      label: add.label,
      recurrence: add.recurrence,
      amount: fromHalalas(amtHalalas),
      amountHalalas: amtHalalas,
    });
  }

  // 2. Active non-cancelled advances for this yearMonth not already settled in another approved run
  const uniqueAdvances = new Map<string, WorkerAdvance>();
  for (const adv of params.workerAdvances) {
    if (adv.orgId === params.orgId && adv.workerId === worker.id) {
      uniqueAdvances.set(adv.id, adv);
    }
  }
  const advancesSnapshot: PayrollAdvanceSnapshot[] = [];
  let advancesTotalHalalas = 0;
  for (const adv of uniqueAdvances.values()) {
    if (adv.status !== 'active') continue;
    if (adv.yearMonth !== cleanYearMonth) continue;
    if (adv.payrollSettledRunId && adv.payrollSettledRunId !== params.runId) continue;

    const amtHalalas =
      typeof adv.amountHalalas === 'number' ? Math.round(adv.amountHalalas) : toHalalas(adv.amount);
    advancesTotalHalalas += amtHalalas;
    advancesSnapshot.push({
      advanceId: adv.id,
      date: adv.date,
      branchId: adv.branchId,
      branchName: adv.branchNameSnapshot,
      paymentMethod: adv.paymentMethod,
      reason: adv.reason,
      amount: fromHalalas(amtHalalas),
      amountHalalas: amtHalalas,
    });
  }
  advancesSnapshot.sort((a, b) => a.date.localeCompare(b.date));

  // 3. Carry-over strictly from the latest APPROVED prior payroll item (never from drafts)
  const validPrevItem =
    params.previousApprovedItem &&
    params.previousApprovedItem.status === 'approved' &&
    params.previousApprovedItem.orgId === params.orgId &&
    params.previousApprovedItem.workerId === worker.id &&
    params.previousApprovedItem.yearMonth < cleanYearMonth
      ? params.previousApprovedItem
      : null;

  const carryOverInHalalas = validPrevItem
    ? Math.max(
        0,
        typeof validPrevItem.carryOverOutHalalas === 'number'
          ? Math.round(validPrevItem.carryOverOutHalalas)
          : toHalalas(validPrevItem.carryOverOut)
      )
    : 0;

  // 4. Exact Settlement Math
  const grossEntitlementHalalas = baseSalaryHalalas + additionsTotalHalalas;
  const totalObligationsHalalas = advancesTotalHalalas + carryOverInHalalas;
  const deductedAmountHalalas = Math.min(grossEntitlementHalalas, totalObligationsHalalas);
  const netPayableHalalas = grossEntitlementHalalas - deductedAmountHalalas;
  const carryOverOutHalalas = totalObligationsHalalas - deductedAmountHalalas;

  const disbursementStatus = resolveDisbursementStatus(netPayableHalalas, 0);

  return {
    id: generatePayrollItemId(params.orgId, cleanYearMonth, worker.id),
    runId: params.runId,
    orgId: params.orgId,
    yearMonth: cleanYearMonth,
    workerId: worker.id,
    workerNameSnapshot: worker.fullName,
    employeeNumberSnapshot: worker.employeeNumber,
    branchIdSnapshot: worker.currentBranchId,
    branchNameSnapshot: worker.currentBranchName,
    workerStatusSnapshot: worker.status,
    status: 'draft',
    baseSalary: fromHalalas(baseSalaryHalalas),
    baseSalaryHalalas,
    additionsSnapshot,
    additionsTotal: fromHalalas(additionsTotalHalalas),
    additionsTotalHalalas,
    advancesSnapshot,
    advancesTotal: fromHalalas(advancesTotalHalalas),
    advancesTotalHalalas,
    carryOverIn: fromHalalas(carryOverInHalalas),
    carryOverInHalalas,
    carryOverSourceItemId: validPrevItem && carryOverInHalalas > 0 ? validPrevItem.id : null,
    carryOverSourceYearMonth:
      validPrevItem && carryOverInHalalas > 0 ? validPrevItem.yearMonth : null,
    grossEntitlement: fromHalalas(grossEntitlementHalalas),
    grossEntitlementHalalas,
    totalObligations: fromHalalas(totalObligationsHalalas),
    totalObligationsHalalas,
    deductedAmount: fromHalalas(deductedAmountHalalas),
    deductedAmountHalalas,
    netPayable: fromHalalas(netPayableHalalas),
    netPayableHalalas,
    carryOverOut: fromHalalas(carryOverOutHalalas),
    carryOverOutHalalas,
    paidAmount: 0,
    paidAmountHalalas: 0,
    remainingPayable: fromHalalas(netPayableHalalas),
    remainingPayableHalalas: netPayableHalalas,
    disbursementStatus,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Aggregates a complete monthly `PayrollRun` + all eligible `PayrollItem` drafts.
 * - Blocks re-generating if an `existingRun` for `(orgId, yearMonth)` is already `approved`.
 * - Includes active workers hired on or before `yearMonth`, PLUS any suspended/terminated workers
 *   who have active advances in `yearMonth` or unpaid carry-over obligations from a prior approved month.
 */
export function buildMonthlyPayrollRunDraft(params: {
  actor: UserProfile;
  orgId: string;
  yearMonth: string;
  workers: Worker[];
  advances: WorkerAdvance[];
  additions: WorkerAddition[];
  previousApprovedItems: PayrollItem[];
  existingRun?: PayrollRun | null;
  nowIso?: string;
}): { run: PayrollRun; items: PayrollItem[] } {
  assertManagerPayrollAccess(params.actor, params.orgId);
  const cleanYearMonth = assertValidYearMonth(params.yearMonth);
  const runId = generatePayrollRunId(params.orgId, cleanYearMonth);

  if (params.existingRun && params.existingRun.status === 'approved') {
    throw new WorkersPayrollError(
      'PAYROLL_RUN_ALREADY_APPROVED',
      `تصفية رواتب شهر ${cleanYearMonth} معتمدة مسبقاً ولا يمكن إعادة إنشائها أو الكتابة فوقها.`
    );
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  // Pick the latest approved prior item (< cleanYearMonth) for each worker
  const latestApprovedByWorker = new Map<string, PayrollItem>();
  for (const prev of params.previousApprovedItems) {
    if (
      prev.orgId !== params.orgId ||
      prev.status !== 'approved' ||
      prev.yearMonth >= cleanYearMonth
    ) {
      continue;
    }
    const existing = latestApprovedByWorker.get(prev.workerId);
    if (!existing || prev.yearMonth > existing.yearMonth) {
      latestApprovedByWorker.set(prev.workerId, prev);
    }
  }

  const orgWorkers = params.workers.filter((w) => w.orgId === params.orgId);
  const items: PayrollItem[] = [];

  for (const worker of orgWorkers) {
    const workerHireYearMonth = (worker.hireDate || '').slice(0, 7);
    const prevApproved = latestApprovedByWorker.get(worker.id) || null;
    const workerAdvances = params.advances.filter(
      (a) => a.orgId === params.orgId && a.workerId === worker.id
    );
    const hasActiveMonthAdvance = workerAdvances.some(
      (a) => a.status === 'active' && a.yearMonth === cleanYearMonth
    );
    const hasPriorCarryOver = Boolean(prevApproved && prevApproved.carryOverOutHalalas > 0);

    // Exclude workers hired in a future month unless they already have an advance
    if (workerHireYearMonth && workerHireYearMonth > cleanYearMonth && !hasActiveMonthAdvance) {
      continue;
    }
    // Exclude suspended/terminated workers unless they have active advances or carry-over to settle
    if (worker.status !== 'active' && !hasActiveMonthAdvance && !hasPriorCarryOver) {
      continue;
    }

    const workerAdditions = params.additions.filter(
      (ad) => ad.orgId === params.orgId && ad.workerId === worker.id
    );

    const effectiveWorkerForCalc: Worker =
      worker.status === 'active'
        ? worker
        : {
            ...worker,
            // Terminated/suspended workers carried in solely for advance/carry-over reconciliation have 0 base salary
            monthlySalary: 0,
            monthlySalaryHalalas: 0,
          };

    const item = calculateWorkerMonthlyPayrollItem({
      orgId: params.orgId,
      yearMonth: cleanYearMonth,
      runId,
      worker: effectiveWorkerForCalc,
      workerAdvances,
      workerAdditions: worker.status === 'active' ? workerAdditions : [],
      previousApprovedItem: prevApproved,
      nowIso,
    });
    items.push(item);
  }

  items.sort((a, b) => a.workerNameSnapshot.localeCompare(b.workerNameSnapshot, 'ar'));

  const run = summarizePayrollRunFromItems({
    runId,
    orgId: params.orgId,
    yearMonth: cleanYearMonth,
    status: 'draft',
    items,
    generatedBy: params.existingRun?.generatedBy || params.actor.uid,
    generatedByName: params.existingRun?.generatedByName || actorName,
    generatedAt: params.existingRun?.generatedAt || nowIso,
    updatedAt: nowIso,
  });

  return { run, items };
}

export function summarizePayrollRunFromItems(params: {
  runId: string;
  orgId: string;
  yearMonth: string;
  status: 'draft' | 'approved';
  items: PayrollItem[];
  generatedBy: string;
  generatedByName: string;
  generatedAt: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  updatedAt: string;
}): PayrollRun {
  let totalBaseSalaryHalalas = 0;
  let totalAdditionsHalalas = 0;
  let totalAdvancesHalalas = 0;
  let totalCarryOverInHalalas = 0;
  let totalGrossEntitlementHalalas = 0;
  let totalDeductionsHalalas = 0;
  let totalNetPayableHalalas = 0;
  let totalCarryOverOutHalalas = 0;
  let totalPaidHalalas = 0;
  let totalRemainingHalalas = 0;

  for (const item of params.items) {
    totalBaseSalaryHalalas += item.baseSalaryHalalas;
    totalAdditionsHalalas += item.additionsTotalHalalas;
    totalAdvancesHalalas += item.advancesTotalHalalas;
    totalCarryOverInHalalas += item.carryOverInHalalas;
    totalGrossEntitlementHalalas += item.grossEntitlementHalalas;
    totalDeductionsHalalas += item.deductedAmountHalalas;
    totalNetPayableHalalas += item.netPayableHalalas;
    totalCarryOverOutHalalas += item.carryOverOutHalalas;
    totalPaidHalalas += item.paidAmountHalalas;
    totalRemainingHalalas += item.remainingPayableHalalas;
  }

  return {
    id: params.runId,
    orgId: params.orgId,
    yearMonth: params.yearMonth,
    status: params.status,
    workersCount: params.items.length,
    totalBaseSalary: fromHalalas(totalBaseSalaryHalalas),
    totalBaseSalaryHalalas,
    totalAdditions: fromHalalas(totalAdditionsHalalas),
    totalAdditionsHalalas,
    totalAdvances: fromHalalas(totalAdvancesHalalas),
    totalAdvancesHalalas,
    totalCarryOverIn: fromHalalas(totalCarryOverInHalalas),
    totalCarryOverInHalalas,
    totalGrossEntitlement: fromHalalas(totalGrossEntitlementHalalas),
    totalGrossEntitlementHalalas,
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
    generatedBy: params.generatedBy,
    generatedByName: params.generatedByName,
    generatedAt: params.generatedAt,
    ...(params.approvedBy ? { approvedBy: params.approvedBy } : {}),
    ...(params.approvedByName ? { approvedByName: params.approvedByName } : {}),
    ...(params.approvedAt ? { approvedAt: params.approvedAt } : {}),
    updatedAt: params.updatedAt,
  };
}

export interface RecordPayrollPaymentInput {
  amount: number | string;
  paymentDate: string; // YYYY-MM-DD
  paymentMethod: PayrollPaymentMethod;
  notes?: string;
  attachmentIds?: string[];
  proofAttachment?: PayrollProofAttachmentRef | null;
  clientRequestKey?: string;
}

/**
 * Validates and prepares a partial or full salary disbursement against an APPROVED PayrollItem.
 */
export function preparePayrollPayment(params: {
  actor: UserProfile;
  item: PayrollItem;
  input: RecordPayrollPaymentInput;
  paymentId?: string;
  nowIso?: string;
}): { payment: PayrollPayment; updatedItem: PayrollItem } {
  assertManagerPayrollAccess(params.actor, params.item.orgId);

  if (params.item.status !== 'approved') {
    throw new WorkersPayrollError(
      'PAYROLL_ITEM_NOT_APPROVED',
      'لا يمكن تسجيل صرف راتب قبل اعتماد تصفية الشهر.'
    );
  }

  const amountHalalas = assertValidCurrencyHalalas(params.input.amount, {
    fieldLabelAr: 'مبلغ الصرف',
    allowZero: false,
  });

  if (amountHalalas > params.item.remainingPayableHalalas) {
    throw new WorkersPayrollError(
      'PAYMENT_EXCEEDS_REMAINING',
      `المبلغ المدفوع (${fromHalalas(amountHalalas)}) يتجاوز المتبقي المستحق للعامل (${params.item.remainingPayable}).`
    );
  }

  const { date: paymentDate } = assertValidIsoCalendarDate(params.input.paymentDate);
  if (params.input.paymentMethod !== 'cash' && params.input.paymentMethod !== 'bank_transfer') {
    throw new WorkersPayrollError('INVALID_INPUT', 'طريقة الدفع يجب أن تكون نقدي أو تحويل بنكي.');
  }

  const notes = (params.input.notes || '').trim().slice(0, 500);
  const cleanRequestKey = (params.input.clientRequestKey || '').trim().slice(0, 120);
  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  const nextPaidHalalas = params.item.paidAmountHalalas + amountHalalas;
  const nextRemainingHalalas = params.item.netPayableHalalas - nextPaidHalalas;
  const nextDisbursementStatus = resolveDisbursementStatus(
    params.item.netPayableHalalas,
    nextPaidHalalas
  );

  const resolvedPaymentId =
    params.paymentId ||
    (cleanRequestKey
      ? generateIdempotentPayrollPaymentId(params.item.id, cleanRequestKey)
      : generatePayrollPaymentId());

  const payment: PayrollPayment = {
    id: resolvedPaymentId,
    orgId: params.item.orgId,
    runId: params.item.runId,
    payrollItemId: params.item.id,
    yearMonth: params.item.yearMonth,
    workerId: params.item.workerId,
    workerNameSnapshot: params.item.workerNameSnapshot,
    branchIdSnapshot: params.item.branchIdSnapshot,
    branchNameSnapshot: params.item.branchNameSnapshot,
    amount: fromHalalas(amountHalalas),
    amountHalalas,
    paymentDate,
    paymentMethod: params.input.paymentMethod,
    ...(notes ? { notes } : {}),
    attachmentIds: Array.isArray(params.input.attachmentIds) ? params.input.attachmentIds : [],
    ...(params.input.proofAttachment ? { proofAttachment: params.input.proofAttachment } : {}),
    ...(cleanRequestKey ? { clientRequestKey: cleanRequestKey } : {}),
    status: 'recorded',
    recordedBy: params.actor.uid,
    recordedByName: actorName,
    recordedAt: nowIso,
  };

  const updatedItem: PayrollItem = {
    ...params.item,
    paidAmount: fromHalalas(nextPaidHalalas),
    paidAmountHalalas: nextPaidHalalas,
    remainingPayable: fromHalalas(nextRemainingHalalas),
    remainingPayableHalalas: nextRemainingHalalas,
    disbursementStatus: nextDisbursementStatus,
    updatedAt: nowIso,
  };

  return { payment, updatedItem };
}

/**
 * Documented administrative correction for an already-approved PayrollItem (manager-only).
 * Never mutates silently: returns explicit `previousValues` and `newValues` for `payrollAuditLogs`.
 */
export function prepareApprovedPayrollItemCorrection(params: {
  actor: UserProfile;
  item: PayrollItem;
  baseSalary?: number | string;
  additionsTotal?: number | string;
  advancesTotal?: number | string;
  carryOverIn?: number | string;
  correctionReason: string;
  nowIso?: string;
}): {
  updatedItem: PayrollItem;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} {
  assertManagerPayrollAccess(params.actor, params.item.orgId);

  if (params.item.status !== 'approved') {
    throw new WorkersPayrollError(
      'PAYROLL_ITEM_NOT_APPROVED',
      'التصحيح الإداري الموثق مخصص لكشوف الرواتب المعتمدة فقط.'
    );
  }

  const reason = (params.correctionReason || '').trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new WorkersPayrollError(
      'INVALID_INPUT',
      'يجب كتابة سبب إداري واضح للتصحيح (5 أحرف على الأقل).'
    );
  }

  const nextBaseHalalas =
    params.baseSalary !== undefined
      ? assertValidCurrencyHalalas(params.baseSalary, {
          fieldLabelAr: 'الراتب الأساسي',
          allowZero: true,
        })
      : params.item.baseSalaryHalalas;

  const nextAdditionsHalalas =
    params.additionsTotal !== undefined
      ? assertValidCurrencyHalalas(params.additionsTotal, {
          fieldLabelAr: 'إجمالي الإضافات',
          allowZero: true,
        })
      : params.item.additionsTotalHalalas;

  const nextAdvancesHalalas =
    params.advancesTotal !== undefined
      ? assertValidCurrencyHalalas(params.advancesTotal, {
          fieldLabelAr: 'إجمالي السحبيات',
          allowZero: true,
        })
      : params.item.advancesTotalHalalas;

  const nextCarryOverInHalalas =
    params.carryOverIn !== undefined
      ? assertValidCurrencyHalalas(params.carryOverIn, {
          fieldLabelAr: 'الرصيد المرحّل السابق',
          allowZero: true,
        })
      : params.item.carryOverInHalalas;

  const grossEntitlementHalalas = nextBaseHalalas + nextAdditionsHalalas;
  const totalObligationsHalalas = nextAdvancesHalalas + nextCarryOverInHalalas;
  const deductedAmountHalalas = Math.min(grossEntitlementHalalas, totalObligationsHalalas);
  const netPayableHalalas = grossEntitlementHalalas - deductedAmountHalalas;
  const carryOverOutHalalas = totalObligationsHalalas - deductedAmountHalalas;

  if (netPayableHalalas < params.item.paidAmountHalalas) {
    throw new WorkersPayrollError(
      'CORRECTION_BELOW_PAID_AMOUNT',
      'لا يمكن أن يكون صافي الراتب بعد التصحيح أقل من المبلغ المصروف فعلياً للعامل؛ يرجى عكس الدفعة الزائدة أولاً.'
    );
  }

  const remainingPayableHalalas = netPayableHalalas - params.item.paidAmountHalalas;
  const disbursementStatus = resolveDisbursementStatus(
    netPayableHalalas,
    params.item.paidAmountHalalas
  );

  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  const updatedItem: PayrollItem = {
    ...params.item,
    baseSalary: fromHalalas(nextBaseHalalas),
    baseSalaryHalalas: nextBaseHalalas,
    additionsTotal: fromHalalas(nextAdditionsHalalas),
    additionsTotalHalalas: nextAdditionsHalalas,
    advancesTotal: fromHalalas(nextAdvancesHalalas),
    advancesTotalHalalas: nextAdvancesHalalas,
    carryOverIn: fromHalalas(nextCarryOverInHalalas),
    carryOverInHalalas: nextCarryOverInHalalas,
    grossEntitlement: fromHalalas(grossEntitlementHalalas),
    grossEntitlementHalalas,
    totalObligations: fromHalalas(totalObligationsHalalas),
    totalObligationsHalalas,
    deductedAmount: fromHalalas(deductedAmountHalalas),
    deductedAmountHalalas,
    netPayable: fromHalalas(netPayableHalalas),
    netPayableHalalas,
    carryOverOut: fromHalalas(carryOverOutHalalas),
    carryOverOutHalalas,
    remainingPayable: fromHalalas(remainingPayableHalalas),
    remainingPayableHalalas,
    disbursementStatus,
    isAdminCorrected: true,
    correctionCount: (params.item.correctionCount || 0) + 1,
    lastCorrectionReason: reason,
    lastCorrectedBy: params.actor.uid,
    lastCorrectedByName: actorName,
    lastCorrectedAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    updatedItem,
    previousValues: {
      baseSalary: params.item.baseSalary,
      additionsTotal: params.item.additionsTotal,
      advancesTotal: params.item.advancesTotal,
      carryOverIn: params.item.carryOverIn,
      deductedAmount: params.item.deductedAmount,
      netPayable: params.item.netPayable,
      carryOverOut: params.item.carryOverOut,
      remainingPayable: params.item.remainingPayable,
    },
    newValues: {
      baseSalary: updatedItem.baseSalary,
      additionsTotal: updatedItem.additionsTotal,
      advancesTotal: updatedItem.advancesTotal,
      carryOverIn: updatedItem.carryOverIn,
      deductedAmount: updatedItem.deductedAmount,
      netPayable: updatedItem.netPayable,
      carryOverOut: updatedItem.carryOverOut,
      remainingPayable: updatedItem.remainingPayable,
      correctionReason: reason,
    },
  };
}

/**
 * Manager-only: Validates and prepares updates to worker profile & base salary.
 * NEVER mutates historical approved payroll items or historical advances.
 */
export function prepareWorkerDetailsEdit(params: {
  actor: UserProfile;
  worker: Worker;
  existingWorkers?: Worker[];
  updates: {
    fullName?: string;
    employeeNumber?: string;
    phone?: string;
    monthlySalary?: number | string;
    hireDate?: string;
    notes?: string;
  };
  nowIso?: string;
}): {
  updatedWorker: Worker;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} {
  assertManagerPayrollAccess(params.actor, params.worker.orgId);

  const nextName =
    params.updates.fullName !== undefined
      ? params.updates.fullName.trim()
      : params.worker.fullName;
  if (nextName.length < 2 || nextName.length > 120) {
    throw new WorkersPayrollError('INVALID_INPUT', 'اسم العامل يجب أن يكون بين حرفين و120 حرفاً.');
  }

  const nextEmpNo =
    params.updates.employeeNumber !== undefined
      ? params.updates.employeeNumber.trim()
      : params.worker.employeeNumber;
  if (nextEmpNo.length < 1 || nextEmpNo.length > 40) {
    throw new WorkersPayrollError('INVALID_INPUT', 'الرقم الوظيفي للعامل مطلوب (حتى 40 حرفاً).');
  }

  if (Array.isArray(params.existingWorkers)) {
    assertUniqueEmployeeNumber({
      employeeNumber: nextEmpNo,
      orgId: params.worker.orgId,
      existingWorkers: params.existingWorkers,
      excludeWorkerId: params.worker.id,
    });
  }

  const nextSalaryHalalas =
    params.updates.monthlySalary !== undefined
      ? assertValidCurrencyHalalas(params.updates.monthlySalary, {
          fieldLabelAr: 'الراتب الشهري',
          allowZero: false,
        })
      : params.worker.monthlySalaryHalalas;

  const nextHireDate =
    params.updates.hireDate !== undefined
      ? assertValidIsoCalendarDate(params.updates.hireDate).date
      : params.worker.hireDate;

  const nextPhone =
    params.updates.phone !== undefined
      ? params.updates.phone.trim().slice(0, 30)
      : params.worker.phone || '';
  const nextNotes =
    params.updates.notes !== undefined
      ? params.updates.notes.trim().slice(0, 500)
      : params.worker.notes || '';

  const nowIso = params.nowIso || new Date().toISOString();

  const updatedWorker: Worker = {
    ...params.worker,
    id: params.worker.id,
    fullName: nextName,
    employeeNumber: nextEmpNo,
    monthlySalary: fromHalalas(nextSalaryHalalas),
    monthlySalaryHalalas: nextSalaryHalalas,
    hireDate: nextHireDate,
    ...(nextPhone ? { phone: nextPhone } : { phone: '' }),
    ...(nextNotes ? { notes: nextNotes } : { notes: '' }),
    updatedAt: nowIso,
  };
  if (!nextPhone) delete updatedWorker.phone;
  if (!nextNotes) delete updatedWorker.notes;

  return {
    updatedWorker,
    previousValues: {
      fullName: params.worker.fullName,
      employeeNumber: params.worker.employeeNumber,
      monthlySalary: params.worker.monthlySalary,
      hireDate: params.worker.hireDate,
      phone: params.worker.phone || '',
    },
    newValues: {
      fullName: updatedWorker.fullName,
      employeeNumber: updatedWorker.employeeNumber,
      monthlySalary: updatedWorker.monthlySalary,
      hireDate: updatedWorker.hireDate,
      phone: updatedWorker.phone || '',
    },
  };
}

/**
 * Manager-only: Edits a WorkerAddition (bonus/allowance) for future/draft runs.
 * Historical approved payroll items retain their frozen `additionsSnapshot` untouched.
 */
export function prepareWorkerAdditionUpdate(params: {
  actor: UserProfile;
  addition: WorkerAddition;
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
  nowIso?: string;
}): {
  updatedAddition: WorkerAddition;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} {
  assertManagerPayrollAccess(params.actor, params.addition.orgId);

  const nextCategory = params.updates.category ?? params.addition.category;
  const nextLabel =
    params.updates.label !== undefined
      ? params.updates.label.trim()
      : params.addition.label;
  if (nextLabel.length < 2 || nextLabel.length > 100) {
    throw new WorkersPayrollError('INVALID_INPUT', 'مسمى الإضافة يجب أن يكون بين حرفين و100 حرف.');
  }

  const nextAmountHalalas =
    params.updates.amount !== undefined
      ? assertValidCurrencyHalalas(params.updates.amount, {
          fieldLabelAr: 'مبلغ الإضافة',
          allowZero: false,
        })
      : params.addition.amountHalalas;

  let targetYearMonth = params.addition.targetYearMonth ?? null;
  let startYearMonth = params.addition.startYearMonth ?? null;
  let endYearMonth = params.addition.endYearMonth ?? null;

  if (params.addition.recurrence === 'one_time') {
    if (params.updates.targetYearMonth !== undefined) {
      targetYearMonth = assertValidYearMonth(params.updates.targetYearMonth || '');
    }
  } else {
    if (params.updates.startYearMonth !== undefined) {
      startYearMonth = assertValidYearMonth(params.updates.startYearMonth || '');
    }
    if (params.updates.endYearMonth !== undefined) {
      endYearMonth = params.updates.endYearMonth
        ? assertValidYearMonth(params.updates.endYearMonth)
        : null;
    }
    if (startYearMonth && endYearMonth && endYearMonth < startYearMonth) {
      throw new WorkersPayrollError(
        'INVALID_INPUT',
        'شهر نهاية الإضافة المتكررة يجب أن يكون مساوياً أو لاحقاً لشهر البداية.'
      );
    }
  }

  const nextNotes =
    params.updates.notes !== undefined
      ? params.updates.notes.trim().slice(0, 400)
      : params.addition.notes || '';
  const cleanReason = (params.reason || '').trim().slice(0, 300);
  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  const updatedAddition: WorkerAddition = {
    ...params.addition,
    category: nextCategory,
    label: nextLabel,
    amount: fromHalalas(nextAmountHalalas),
    amountHalalas: nextAmountHalalas,
    targetYearMonth,
    startYearMonth,
    endYearMonth,
    ...(nextNotes ? { notes: nextNotes } : {}),
    updatedAt: nowIso,
    updatedBy: params.actor.uid,
    updatedByName: actorName,
    ...(cleanReason ? { lastChangeReason: cleanReason } : {}),
  };
  if (!nextNotes) delete updatedAddition.notes;

  return {
    updatedAddition,
    previousValues: {
      category: params.addition.category,
      label: params.addition.label,
      amount: params.addition.amount,
      targetYearMonth: params.addition.targetYearMonth ?? null,
      startYearMonth: params.addition.startYearMonth ?? null,
      endYearMonth: params.addition.endYearMonth ?? null,
    },
    newValues: {
      category: updatedAddition.category,
      label: updatedAddition.label,
      amount: updatedAddition.amount,
      targetYearMonth: updatedAddition.targetYearMonth ?? null,
      startYearMonth: updatedAddition.startYearMonth ?? null,
      endYearMonth: updatedAddition.endYearMonth ?? null,
    },
  };
}

/**
 * Manager-only: Stops or cancels (or reactivates) a WorkerAddition WITHOUT mutating approved historical payrolls.
 */
export function prepareWorkerAdditionStatusChange(params: {
  actor: UserProfile;
  addition: WorkerAddition;
  nextStatus: WorkerAdditionStatus;
  endYearMonth?: string | null;
  reason?: string;
  nowIso?: string;
}): {
  updatedAddition: WorkerAddition;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} {
  assertManagerPayrollAccess(params.actor, params.addition.orgId);

  let nextEndMonth = params.addition.endYearMonth ?? null;
  if (params.endYearMonth !== undefined) {
    nextEndMonth = params.endYearMonth ? assertValidYearMonth(params.endYearMonth) : null;
  }
  if (
    params.addition.recurrence === 'monthly_recurring' &&
    params.addition.startYearMonth &&
    nextEndMonth &&
    nextEndMonth < params.addition.startYearMonth
  ) {
    throw new WorkersPayrollError(
      'INVALID_INPUT',
      'شهر الإيقاف لا يمكن أن يسبق شهر بداية الإضافة المتكررة.'
    );
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const cleanReason = (params.reason || '').trim().slice(0, 300);
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  const updatedAddition: WorkerAddition = {
    ...params.addition,
    status: params.nextStatus,
    endYearMonth: nextEndMonth,
    updatedAt: nowIso,
    updatedBy: params.actor.uid,
    updatedByName: actorName,
    ...(cleanReason ? { lastChangeReason: cleanReason } : {}),
  };

  return {
    updatedAddition,
    previousValues: {
      status: params.addition.status,
      endYearMonth: params.addition.endYearMonth ?? null,
    },
    newValues: {
      status: updatedAddition.status,
      endYearMonth: updatedAddition.endYearMonth ?? null,
    },
  };
}

/**
 * Manager-only: Reverses a recorded salary payment (status -> 'reversed', NEVER deleted)
 * and restores `paidAmount`, `remainingPayable`, and `disbursementStatus` on the parent PayrollItem.
 */
export function preparePayrollPaymentReversal(params: {
  actor: UserProfile;
  item: PayrollItem;
  payment: PayrollPayment;
  reversalReason: string;
  nowIso?: string;
}): {
  reversedPayment: PayrollPayment;
  updatedItem: PayrollItem;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} {
  assertManagerPayrollAccess(params.actor, params.payment.orgId);
  if (params.payment.orgId !== params.item.orgId || params.payment.payrollItemId !== params.item.id) {
    throw new WorkersPayrollError('INVALID_INPUT', 'سجل الدفعة لا يطابق كشف الراتب المحدد.');
  }
  if (params.payment.status === 'reversed') {
    throw new WorkersPayrollError('PAYMENT_ALREADY_REVERSED', 'هذه الدفعة معكوسة بالفعل.');
  }
  const cleanReason = (params.reversalReason || '').trim();
  if (cleanReason.length < 3 || cleanReason.length > 300) {
    throw new WorkersPayrollError('INVALID_INPUT', 'يجب كتابة سبب واضح لعكس الدفعة (3 أحرف على الأقل).');
  }

  const nextPaidHalalas = Math.max(0, params.item.paidAmountHalalas - params.payment.amountHalalas);
  const nextRemainingHalalas = Math.max(0, params.item.netPayableHalalas - nextPaidHalalas);
  const nextDisbursementStatus = resolveDisbursementStatus(
    params.item.netPayableHalalas,
    nextPaidHalalas
  );

  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = (params.actor.displayName || params.actor.email || 'المدير').trim().slice(0, 100);

  const reversedPayment: PayrollPayment = {
    ...params.payment,
    status: 'reversed',
    reversedBy: params.actor.uid,
    reversedByName: actorName,
    reversedAt: nowIso,
    reversalReason: cleanReason,
  };

  const updatedItem: PayrollItem = {
    ...params.item,
    paidAmount: fromHalalas(nextPaidHalalas),
    paidAmountHalalas: nextPaidHalalas,
    remainingPayable: fromHalalas(nextRemainingHalalas),
    remainingPayableHalalas: nextRemainingHalalas,
    disbursementStatus: nextDisbursementStatus,
    updatedAt: nowIso,
  };

  return {
    reversedPayment,
    updatedItem,
    previousValues: {
      paymentStatus: params.payment.status,
      itemPaidAmount: params.item.paidAmount,
      itemRemainingPayable: params.item.remainingPayable,
      itemDisbursementStatus: params.item.disbursementStatus,
    },
    newValues: {
      paymentStatus: 'reversed',
      itemPaidAmount: updatedItem.paidAmount,
      itemRemainingPayable: updatedItem.remainingPayable,
      itemDisbursementStatus: updatedItem.disbursementStatus,
      reversalReason: cleanReason,
    },
  };
}

