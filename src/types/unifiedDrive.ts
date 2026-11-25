/**
 * Unified Google Drive Domain Types & Contracts — الإقفال | AL EQFAL
 * -------------------------------------------------------------------
 * Canonical types for the centralized Google Drive integration shared across:
 *   - Shift Closings (Morning & Evening)
 *   - Purchase Invoices & Attachments
 *   - Worker Advances & Withdrawals
 *   - Payroll Payments & Proofs
 *   - Organization Important Documents
 *
 * Approved Unified Folder Hierarchy (All Organizations):
 *   <Organization Root Folder>
 *     ├── الفروع
 *     │     └── <Branch Folder>
 *     │           └── <YYYY>
 *     │                 └── <MM>
 *     │                       └── <DD>
 *     │                             └── [All daily files directly here — NO per-type subfolders]
 *     └── مستندات المؤسسة المهمة
 *           └── [General organization-level documents]
 */

import type { UserRole } from './index';

export const UNIFIED_BRANCHES_FOLDER_NAME = 'الفروع';
export const UNIFIED_ORG_IMPORTANT_DOCS_FOLDER_NAME = 'مستندات المؤسسة المهمة';
export const UNIFIED_DRIVE_SCHEMA_VERSION = '2';

export type UnifiedDriveDocumentType =
  | 'closing_morning'
  | 'closing_evening'
  | 'purchase'
  | 'worker_advance'
  | 'payroll_payment'
  | 'org_important_document';

export type UnifiedDriveDailyDocumentType = Exclude<
  UnifiedDriveDocumentType,
  'org_important_document'
>;

export type UnifiedDriveFileStatus =
  | 'active'
  | 'trashed'
  | 'missing'
  | 'pending_sync'
  | 'sync_failed';

export type UnifiedDriveFolderRole =
  | 'org_root'
  | 'branches_container'
  | 'unified_branch_folder'
  | 'year_folder'
  | 'month_folder'
  | 'day_folder'
  | 'org_important_docs';

export type UnifiedDriveErrorCode =
  | 'UNAUTHORIZED_ROLE'
  | 'BRANCH_MANAGER_DIRECT_DRIVE_FORBIDDEN'
  | 'CROSS_ORG_FORBIDDEN'
  | 'RECORD_OWNERSHIP_MISMATCH'
  | 'CONFIRMATION_REQUIRED'
  | 'PERMANENT_DELETE_FORBIDDEN'
  | 'OAUTH_EXPIRED_OR_INVALID'
  | 'OAUTH_SCOPE_OR_PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'DUPLICATE_CONFLICT'
  | 'NETWORK_ERROR'
  | 'INVALID_INPUT'
  | 'DRIVE_API_ERROR';

export class UnifiedDriveError extends Error {
  public readonly code: UnifiedDriveErrorCode;
  public readonly httpStatus?: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: UnifiedDriveErrorCode,
    message: string,
    options?: { httpStatus?: number; details?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'UnifiedDriveError';
    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.details = options?.details;
  }
}

export interface UnifiedDriveActorContext {
  uid: string;
  orgId: string;
  role: UserRole;
  isActive: boolean;
  displayName?: string;
  email?: string;
  googleUid?: string;
}

export interface UnifiedDriveFolderNode {
  folderId: string;
  folderName: string;
  webViewLink: string;
  parents: string[];
  role: UnifiedDriveFolderRole;
  reused: boolean;
  verifiedViaGet: boolean;
}

export interface UnifiedDriveDailyPathResolution {
  orgId: string;
  branchId: string;
  branchName: string;
  date: string; // YYYY-MM-DD
  year: string; // YYYY
  month: string; // MM
  day: string; // DD
  yearMonth: string; // YYYY-MM
  orgFolder: UnifiedDriveFolderNode;
  branchesContainerFolder: UnifiedDriveFolderNode;
  branchFolder: UnifiedDriveFolderNode;
  yearFolder: UnifiedDriveFolderNode;
  monthFolder: UnifiedDriveFolderNode;
  dayFolder: UnifiedDriveFolderNode;
  /** Human-readable unified folder path for logs & UI */
  displayPath: string;
}

export interface UnifiedDriveImportantDocsResolution {
  orgId: string;
  orgFolder: UnifiedDriveFolderNode;
  importantDocsFolder: UnifiedDriveFolderNode;
  displayPath: string;
}

/**
 * Canonical platform metadata record bound strictly to Google Drive's immutable `fileId`.
 * Folder path or file name changes never break this reference.
 */
export interface UnifiedDriveFileRecord {
  /** Immutable Google Drive File ID — canonical reference */
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  orgId: string;
  branchId?: string;
  branchName?: string;
  documentType: UnifiedDriveDocumentType;
  /** ISO date YYYY-MM-DD for daily branch documents; optional for org important documents */
  documentDate?: string;
  /** Linked platform record ID (closingId / purchaseId / workerAdvanceId / payrollPaymentId / orgDocumentId) */
  recordId: string;
  status: UnifiedDriveFileStatus;
  parentFolderId: string;
  webViewLink: string;
  clientUploadKey?: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName: string;
  trashedAt?: string;
  trashedBy?: string;
  trashedByName?: string;
  trashReason?: string;
  restoredAt?: string;
  restoredBy?: string;
}

export interface UnifiedDriveRemoteFileMetadata {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  parents: string[];
  trashed: boolean;
  webViewLink: string;
  appProperties: Record<string, string>;
  createdTime?: string;
  modifiedTime?: string;
}

export type UnifiedDriveAuditAction =
  | 'DRIVE_FILE_UPLOADED'
  | 'DRIVE_FILE_UPDATED'
  | 'DRIVE_FILE_RENAMED'
  | 'DRIVE_FILE_MOVED'
  | 'DRIVE_FILE_TRASHED'
  | 'DRIVE_FILE_RESTORED';

export interface UnifiedDriveAuditEvent {
  id: string;
  action: UnifiedDriveAuditAction;
  orgId: string;
  branchId?: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  fileId: string;
  fileName: string;
  documentType?: UnifiedDriveDocumentType;
  recordId?: string;
  details: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  timestamp: string;
}

export interface UnifiedDriveDiagnosticEntry {
  timestamp: string;
  operation: string;
  status: 'ok' | 'error';
  orgId?: string;
  fileId?: string;
  folderId?: string;
  httpStatus?: number;
  errorCode?: UnifiedDriveErrorCode;
  message: string;
}

export interface UnifiedDriveTrashResult {
  fileId: string;
  fileName: string;
  trashed: true;
  trashedAt: string;
  trashedBy: string;
  trashedByName: string;
  trashReason?: string;
  /** Always true once Drive confirms `trashed === true`; parent financial record is NEVER deleted */
  parentFinancialRecordPreserved: true;
  /** True only if an optional platform status persistence callback succeeded after Drive trash */
  platformStateUpdated: boolean;
  platformStateError?: string;
  auditEvent: UnifiedDriveAuditEvent;
}

export interface UnifiedDriveRestoreResult {
  fileId: string;
  fileName: string;
  trashed: false;
  restoredAt: string;
  restoredBy: string;
  auditEvent: UnifiedDriveAuditEvent;
}

export interface UnifiedDriveUploadResult {
  record: UnifiedDriveFileRecord;
  folderPath: string;
  reusedExisting: boolean;
  auditEvent: UnifiedDriveAuditEvent;
}

// ---------------------------------------------------------------------------
// Legacy Inventory & Resumable Migration Plan Types
// ---------------------------------------------------------------------------

export type MigrationItemClassification =
  | 'already_unified'
  | 'ready_to_move'
  | 'skip_duplicate'
  | 'skip_unmatched'
  | 'missing_in_drive';

export type MigrationExecutionStatus =
  | 'pending'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface LegacyPlatformRecordRef {
  recordId: string;
  orgId: string;
  branchId?: string;
  branchName?: string;
  branchCode?: string;
  documentType: UnifiedDriveDocumentType;
  /** YYYY-MM-DD (required for daily docs) */
  documentDate?: string;
  fileId: string;
  fileName?: string;
  revision?: number;
  sourceCollection:
    | 'closingArchives'
    | 'attachments'
    | 'workerAdvances'
    | 'payrollPayments'
    | 'orgDocuments';
}

export interface DriveMigrationPlanItem {
  planItemId: string;
  fileId: string;
  fileName: string;
  currentParentIds: string[];
  classification: MigrationItemClassification;
  executionStatus: MigrationExecutionStatus;
  matchedRecord?: LegacyPlatformRecordRef;
  targetPathPreview?: string;
  reason: string;
  duplicateFileIds?: string[];
  errorMessage?: string;
  completedAt?: string;
}

export interface DriveMigrationPlan {
  planId: string;
  orgId: string;
  orgName: string;
  generatedAt: string;
  totalDriveFilesScanned: number;
  totalPlatformRecordsChecked: number;
  counts: {
    alreadyUnified: number;
    readyToMove: number;
    skippedDuplicates: number;
    skippedUnmatched: number;
    missingInDrive: number;
    completed: number;
    failed: number;
  };
  items: DriveMigrationPlanItem[];
}
