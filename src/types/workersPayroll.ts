/**
 * Workers, Advances, Additions, Monthly Payroll Settlement & Disbursement Data Models
 * الإقفال | AL EQFAL — Workers & Payroll Module (Foundation Phase)
 *
 * Design Guarantees:
 * - Every record is tenant-isolated by `orgId` and carries a stable immutable `id`.
 * - Every Worker keeps one permanent `id` across branch transfers (`currentBranchId` updates;
 *   historical financial records NEVER change their original `branchId`).
 * - All monetary values store BOTH display currency numbers and exact integer Halalas
 *   (`100 Halalas = 1 Currency Unit`) to eliminate floating-point rounding drift.
 * - Approved payroll snapshots are immutable except through a manager-authored administrative
 *   correction logged atomically in `payrollAuditLogs`.
 */
import type { UserRole } from './index';

export type WorkerStatus = 'active' | 'suspended' | 'terminated';

export type PayrollPaymentMethod = 'cash' | 'bank_transfer';

export type WorkerAdvanceStatus = 'active' | 'cancelled';

export type WorkerAdditionCategory =
  | 'performance_bonus'
  | 'transport_allowance'
  | 'housing_allowance'
  | 'extra_allowance'
  | 'exceptional_bonus'
  | 'custom';

export type WorkerAdditionRecurrence = 'one_time' | 'monthly_recurring';

export type WorkerAdditionStatus = 'active' | 'stopped' | 'cancelled';

export type PayrollRunStatus = 'draft' | 'approved';

export type PayrollDisbursementStatus = 'unpaid' | 'partially_paid' | 'paid';

export type PayrollPaymentStatus = 'recorded' | 'reversed';

export type PayrollAuditTargetType =
  | 'worker'
  | 'worker_advance'
  | 'worker_addition'
  | 'payroll_run'
  | 'payroll_item'
  | 'payroll_payment';

export type PayrollProofSyncStatus =
  | 'uploaded'
  | 'pending_drive_sync'
  | 'sync_failed'
  | 'trashed';

export interface PayrollProofAttachmentRef {
  fileName: string;
  mimeType: string;
  fileSize: number;
  clientUploadKey: string;
  syncStatus: PayrollProofSyncStatus;
  driveFileId?: string;
  driveWebViewLink?: string;
  driveFolderPath?: string;
  uploadedAt?: string;
  uploadedBy?: string;
  lastSyncError?: string;
  trashedAt?: string;
  trashedBy?: string;
  trashedByName?: string;
  trashReason?: string;
}

export type PayrollAuditAction =
  | 'WORKER_CREATED'
  | 'WORKER_UPDATED'
  | 'WORKER_BRANCH_TRANSFERRED'
  | 'WORKER_STATUS_CHANGED'
  | 'WORKER_ADVANCE_RECORDED'
  | 'WORKER_ADVANCE_UPDATED'
  | 'WORKER_ADVANCE_CANCELLED'
  | 'WORKER_ADVANCE_PROOF_SYNCED'
  | 'WORKER_ADVANCE_PROOF_TRASHED'
  | 'WORKER_ADDITION_CREATED'
  | 'WORKER_ADDITION_UPDATED'
  | 'WORKER_ADDITION_STOPPED'
  | 'WORKER_ADDITION_CANCELLED'
  | 'PAYROLL_RUN_DRAFT_GENERATED'
  | 'PAYROLL_RUN_APPROVED'
  | 'PAYROLL_ITEM_ADMIN_CORRECTED'
  | 'PAYROLL_PAYMENT_RECORDED'
  | 'PAYROLL_PAYMENT_REVERSED'
  | 'PAYROLL_PAYMENT_PROOF_SYNCED'
  | 'PAYROLL_PAYMENT_PROOF_TRASHED';

export interface WorkerBranchTransferEntry {
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  transferredAt: string;
  transferredBy: string;
  transferredByName: string;
  reason?: string;
}

/**
 * Firestore Collection: `workers/{workerId}`
 * Stable worker entity independent from login `users/{uid}` accounts.
 */
export interface Worker {
  id: string; // Stable immutable ID: wrk_<...>
  orgId: string;
  fullName: string;
  employeeNumber: string;
  phone?: string;
  monthlySalary: number;
  monthlySalaryHalalas: number;
  currentBranchId: string;
  currentBranchName: string;
  hireDate: string; // YYYY-MM-DD
  status: WorkerStatus;
  statusChangedAt?: string;
  statusReason?: string;
  terminationDate?: string; // YYYY-MM-DD (optional when terminated)
  notes?: string;
  branchTransferHistory?: WorkerBranchTransferEntry[];
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Firestore Collection: `workerAdvances/{advanceId}`
 * Branch-bound historical cash/transfer advance or withdrawal.
 * `branchId` records the branch at the exact time of the transaction and is NEVER mutated on transfer.
 */
export interface WorkerAdvance {
  id: string; // wadv_<...>
  orgId: string;
  workerId: string;
  workerNameSnapshot: string;
  workerEmployeeNumberSnapshot?: string;
  branchId: string; // Immutable historical branch where advance was issued
  branchNameSnapshot: string;
  amount: number;
  amountHalalas: number;
  date: string; // YYYY-MM-DD
  yearMonth: string; // YYYY-MM derived from `date`
  paymentMethod: PayrollPaymentMethod;
  reason: string;
  notes?: string;
  attachmentIds?: string[];
  proofAttachment?: PayrollProofAttachmentRef | null;
  status: WorkerAdvanceStatus;
  /**
   * Set atomically upon `PAYROLL_RUN_APPROVED` so the same advance can NEVER
   * be deducted twice in another payroll run or silently mutated after approval.
   */
  payrollSettledRunId?: string | null;
  payrollSettledYearMonth?: string | null;
  createdBy: string;
  createdByName: string;
  createdByRole: UserRole;
  createdAt: string;
  updatedAt: string;
  editedBy?: string;
  editedByName?: string;
  editedAt?: string;
  editReason?: string;
  cancelledBy?: string;
  cancelledByName?: string;
  cancelledAt?: string;
  cancellationReason?: string;
}

/**
 * Firestore Collection: `workerAdditions/{additionId}`
 * Bonuses, allowances, and recurring/one-time financial additions managed exclusively by org manager.
 */
export interface WorkerAddition {
  id: string; // wadd_<...>
  orgId: string;
  workerId: string;
  workerNameSnapshot: string;
  category: WorkerAdditionCategory;
  label: string;
  recurrence: WorkerAdditionRecurrence;
  amount: number;
  amountHalalas: number;
  /** Required when recurrence === 'one_time' (YYYY-MM) */
  targetYearMonth?: string | null;
  /** Required when recurrence === 'monthly_recurring' (YYYY-MM) */
  startYearMonth?: string | null;
  /** Optional inclusive end month when recurrence === 'monthly_recurring' (YYYY-MM) */
  endYearMonth?: string | null;
  status: WorkerAdditionStatus;
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  updatedByName?: string;
  lastChangeReason?: string;
}

export interface PayrollAdditionSnapshot {
  additionId: string;
  category: WorkerAdditionCategory;
  label: string;
  recurrence: WorkerAdditionRecurrence;
  amount: number;
  amountHalalas: number;
}

export interface PayrollAdvanceSnapshot {
  advanceId: string;
  date: string;
  branchId: string;
  branchName: string;
  paymentMethod: PayrollPaymentMethod;
  reason: string;
  amount: number;
  amountHalalas: number;
}

/**
 * Firestore Collection: `payrollRuns/{runId}`
 * Deterministic ID: `prun_<cleanOrgId>_<YYYY-MM>` — guarantees strictly ONE run per org per month.
 */
export interface PayrollRun {
  id: string;
  orgId: string;
  yearMonth: string; // YYYY-MM
  status: PayrollRunStatus;
  workersCount: number;
  totalBaseSalary: number;
  totalBaseSalaryHalalas: number;
  totalAdditions: number;
  totalAdditionsHalalas: number;
  totalAdvances: number;
  totalAdvancesHalalas: number;
  totalCarryOverIn: number;
  totalCarryOverInHalalas: number;
  totalGrossEntitlement: number;
  totalGrossEntitlementHalalas: number;
  totalDeductions: number;
  totalDeductionsHalalas: number;
  totalNetPayable: number;
  totalNetPayableHalalas: number;
  totalCarryOverOut: number;
  totalCarryOverOutHalalas: number;
  totalPaid: number;
  totalPaidHalalas: number;
  totalRemaining: number;
  totalRemainingHalalas: number;
  generatedBy: string;
  generatedByName: string;
  generatedAt: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  updatedAt: string;
}

/**
 * Firestore Collection: `payrollItems/{itemId}`
 * Deterministic ID: `pitem_<cleanOrgId>_<YYYY-MM>_<cleanWorkerId>`
 * Stores frozen historical snapshot for a single worker in a specific month's payroll run.
 */
export interface PayrollItem {
  id: string;
  runId: string;
  orgId: string;
  yearMonth: string; // YYYY-MM
  workerId: string;
  workerNameSnapshot: string;
  employeeNumberSnapshot: string;
  branchIdSnapshot: string;
  branchNameSnapshot: string;
  workerStatusSnapshot: WorkerStatus;
  status: PayrollRunStatus;
  baseSalary: number;
  baseSalaryHalalas: number;
  additionsSnapshot: PayrollAdditionSnapshot[];
  additionsTotal: number;
  additionsTotalHalalas: number;
  advancesSnapshot: PayrollAdvanceSnapshot[];
  advancesTotal: number;
  advancesTotalHalalas: number;
  carryOverIn: number;
  carryOverInHalalas: number;
  /** Deterministic reference to the previous approved payrollItem that produced carryOverIn */
  carryOverSourceItemId?: string | null;
  carryOverSourceYearMonth?: string | null;
  grossEntitlement: number;
  grossEntitlementHalalas: number;
  totalObligations: number;
  totalObligationsHalalas: number;
  deductedAmount: number;
  deductedAmountHalalas: number;
  netPayable: number;
  netPayableHalalas: number;
  carryOverOut: number;
  carryOverOutHalalas: number;
  paidAmount: number;
  paidAmountHalalas: number;
  remainingPayable: number;
  remainingPayableHalalas: number;
  disbursementStatus: PayrollDisbursementStatus;
  isAdminCorrected?: boolean;
  correctionCount?: number;
  lastCorrectionReason?: string;
  lastCorrectedBy?: string;
  lastCorrectedByName?: string;
  lastCorrectedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Firestore Collection: `payrollPayments/{paymentId}`
 * Independent disbursement record supporting partial & multiple payments per PayrollItem.
 * Never deleted; only reversed via documented manager administrative action.
 */
export interface PayrollPayment {
  id: string; // ppay_<...>
  orgId: string;
  runId: string;
  payrollItemId: string;
  yearMonth: string; // YYYY-MM
  workerId: string;
  workerNameSnapshot: string;
  branchIdSnapshot: string;
  branchNameSnapshot: string;
  amount: number;
  amountHalalas: number;
  paymentDate: string; // YYYY-MM-DD
  paymentMethod: PayrollPaymentMethod;
  notes?: string;
  attachmentIds?: string[];
  proofAttachment?: PayrollProofAttachmentRef | null;
  /** Deterministic idempotency key preventing duplicate payment submission on double-click/retry */
  clientRequestKey?: string;
  status: PayrollPaymentStatus;
  recordedBy: string;
  recordedByName: string;
  recordedAt: string;
  reversedBy?: string;
  reversedByName?: string;
  reversedAt?: string;
  reversalReason?: string;
}

/**
 * Firestore Collection: `payrollAuditLogs/{logId}`
 * Completely immutable audit trail for all Workers & Payroll operations.
 */
export interface PayrollAuditLog {
  id: string; // plog_<...>
  orgId: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: PayrollAuditAction;
  targetType: PayrollAuditTargetType;
  targetId: string;
  workerId?: string;
  branchId?: string;
  yearMonth?: string;
  reason?: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  details: string;
  timestamp: string;
}

export interface WorkersPayrollAccess {
  canManageWorkers: boolean;
  canTransferWorkers: boolean;
  canViewAllOrgWorkers: boolean;
  canViewBranchActiveWorkers: boolean;
  canRecordBranchAdvance: boolean;
  canEditOrCancelAdvances: boolean;
  canManageAdditions: boolean;
  canManagePayrollRuns: boolean;
  canApprovePayrollRuns: boolean;
  canAdminCorrectPayroll: boolean;
  canRecordPayrollPayments: boolean;
  canViewPayrollReports: boolean;
  restrictedBranchId: string | null;
}

export interface PayrollBranchBreakdown {
  branchId: string;
  branchName: string;
  activeWorkersCount: number;
  baseSalary: number;
  baseSalaryHalalas: number;
  additions: number;
  additionsHalalas: number;
  advances: number;
  advancesHalalas: number;
  netPayable: number;
  netPayableHalalas: number;
  paidAmount: number;
  paidAmountHalalas: number;
  remainingPayable: number;
  remainingPayableHalalas: number;
}

export interface WorkersPayrollSummaryReport {
  orgId: string;
  yearMonth: string;
  activeWorkersCount: number;
  totalWorkersInPayroll: number;
  totalBaseSalary: number;
  totalBaseSalaryHalalas: number;
  totalAdvances: number;
  totalAdvancesHalalas: number;
  totalAdditions: number;
  totalAdditionsHalalas: number;
  totalCarryOverIn: number;
  totalCarryOverInHalalas: number;
  totalDeductions: number;
  totalDeductionsHalalas: number;
  totalNetPayable: number;
  totalNetPayableHalalas: number;
  totalCarryOverOut: number;
  totalCarryOverOutHalalas: number;
  totalPaid: number;
  totalPaidHalalas: number;
  totalRemaining: number;
  totalRemainingHalalas: number;
  byBranch: PayrollBranchBreakdown[];
}

export interface WorkerFinancialStatement {
  worker: Worker;
  advances: WorkerAdvance[];
  activeAdvancesTotal: number;
  activeAdvancesTotalHalalas: number;
  cancelledAdvancesTotal: number;
  cancelledAdvancesTotalHalalas: number;
  additions: WorkerAddition[];
  payrollItems: PayrollItem[];
  payments: PayrollPayment[];
  totalNetPayableAcrossMonths: number;
  totalNetPayableAcrossMonthsHalalas: number;
  totalPaidAcrossMonths: number;
  totalPaidAcrossMonthsHalalas: number;
  totalRemainingAcrossMonths: number;
  totalRemainingAcrossMonthsHalalas: number;
  latestCarryOverOut: number;
  latestCarryOverOutHalalas: number;
  branchesWorkedIn: Array<{ branchId: string; branchName: string; advancesCount: number; advancesTotal: number }>;
}
