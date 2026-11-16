/**
 * Core Data Models & Types for الإقفال | AL EQFAL
 * Multi-Tenant Cloud Shift Closing & Cash Management System
 */

export type UserRole = 'manager' | 'supervisor' | 'branch_manager' | 'employee';

export type ShiftPeriod = 'morning' | 'evening';

export type ClosingStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export type SupportedLanguage = 'ar' | 'en' | 'ur';

export type ThemeMode = 'dark' | 'light';

export interface DriveMonthFolderRef {
  folderId: string;
  folderName: string;
  webViewLink: string;
  branchId: string;
  yearMonth: string;
  updatedAt: string;
}

export type DriveHealthStatus = 'untested' | 'verified' | 'failed' | 'disconnected';

export type ClosingArchiveStatus = 'pending_drive_sync' | 'archived' | 'failed' | 'stale';

export interface ClosingArchiveRecord {
  closingId: string;
  orgId: string;
  branchId: string;
  yearMonth: string; // YYYY-MM
  archiveStatus: ClosingArchiveStatus;
  driveExcelFileId?: string;
  driveExcelFileName?: string;
  driveExcelWebViewLink?: string;
  driveMonthFolderId?: string;
  drivePayloadHash?: string;
  driveRevision?: number;
  previousDriveExcelFileId?: string;
  sourceCorrectionAt?: string;
  archivedAt?: string;
  archivedBy?: string;
  archiveError?: string;
  updatedAt: string;
}

export type SubscriptionPlan = 'trial_7d' | '1m' | '3m' | '6m' | '1y';

export type SubscriptionStatus = 'active' | 'expired' | 'suspended';

export type EffectiveSubscriptionState =
  | 'active'
  | 'expired'
  | 'suspended'
  | 'legacy_unrestricted';

export type BranchPricingModel = 'per_branch_50_sar' | 'per_extra_branch_50_sar';

export type FeePaymentStatus = 'paid' | 'unpaid' | 'waived';

export type BranchPaymentStatus = 'paid' | 'unpaid' | 'overdue' | 'exempt';

export type BranchLifecycleStatus = 'active' | 'suspended' | 'purged_from_db';

export type DeactivationReason = 'no_paid_branches' | 'manual_suspension' | 'expired';

export type PlatformAuditAction =
  | 'ORG_CREATED_WITH_INVITE'
  | 'ORG_PROFILE_UPDATED'
  | 'SUBSCRIPTION_UPDATED'
  | 'LEGACY_CONVERTED_TO_PAID'
  | 'SETUP_FEE_UPDATED'
  | 'ORG_SUSPENDED'
  | 'ORG_DEACTIVATED_NO_PAID_BRANCHES'
  | 'ORG_REACTIVATED'
  | 'INVITE_UPSERTED'
  | 'INVITE_CANCELLED'
  | 'BRANCH_CREATED'
  | 'BRANCH_PAYMENT_UPDATED'
  | 'BRANCH_SUSPENDED'
  | 'BRANCH_REACTIVATED'
  | 'BRANCH_DRIVE_BACKUP_VERIFIED'
  | 'BRANCH_DB_PURGED';

export interface PlatformAuditLog {
  id: string;
  actorEmail: string;
  actorUid: string;
  action: PlatformAuditAction;
  targetType: 'organization' | 'branch' | 'invite' | 'billing';
  targetId: string;
  orgId?: string;
  details: string;
  metadata?: Record<string, string | number | boolean | null>;
  timestamp: string;
}

export type SubscriptionTimestampValue =
  | Date
  | string
  | { toDate: () => Date }
  | { seconds: number; nanoseconds?: number }
  | { _seconds: number; _nanoseconds?: number };

export type ManagerInviteStatus = 'pending' | 'accepted' | 'cancelled';

export interface ManagerInvite {
  id: string;
  email: string;
  emailNormalized: string;
  orgId: string;
  orgName?: string;
  managerName?: string;
  role: 'manager';
  status: ManagerInviteStatus;
  acceptedByUid?: string;
  acceptedAt?: SubscriptionTimestampValue;
  cancelledAt?: SubscriptionTimestampValue;
  createdAt: SubscriptionTimestampValue;
  createdBy: string;
  updatedAt: SubscriptionTimestampValue;
}

export type TenantAccessStatus =
  | 'loading'
  | 'unauthenticated'
  | 'active_tenant'
  | 'subscription_blocked'
  | 'subscription_request_required'
  | 'invite_blocked'
  | 'access_error';

export type SubscriptionBlockReason =
  | 'expired'
  | 'suspended'
  | 'not_started'
  | 'no_paid_branches';

export type InviteBlockReason =
  | 'cancelled'
  | 'accepted'
  | 'org_not_found'
  | 'owner_mismatch';

export type AccessErrorReason =
  | 'email_not_verified'
  | 'missing_employee_profile'
  | 'account_disabled'
  | 'permission_denied'
  | 'network_error';

export interface Organization {
  id: string;
  name: string;
  taxNumber?: string;
  commercialRegistration?: string;
  activityType: string;
  currency: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  driveFolderId?: string;
  driveFolderName?: string;
  driveFolderLink?: string;
  driveAccountEmail?: string;
  driveAccountName?: string;
  driveGoogleSub?: string;
  driveLinkedAt?: string;
  driveMonthFolderIds?: Record<string, DriveMonthFolderRef>;
  driveConnected: boolean;
  driveWriteVerified?: boolean;
  driveWriteVerifiedAt?: string;
  driveLastHealthStatus?: DriveHealthStatus;
  driveHealthError?: string;
  isActive?: boolean;
  subscriptionPlan?: SubscriptionPlan;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionStartAt?: SubscriptionTimestampValue;
  subscriptionEndAt?: SubscriptionTimestampValue;
  subscriptionUpdatedAt?: SubscriptionTimestampValue;
  subscriptionUpdatedBy?: string;
  subscriptionNote?: string;
  branchPricingModel?: BranchPricingModel;
  includedBranchesCount?: number;
  extraBranchMonthlyFeeSar?: number;
  extraBranchesCount?: number;
  extraBranchesMonthlyTotalSar?: number;
  branchPricingUpdatedAt?: SubscriptionTimestampValue;
  branchPricingUpdatedBy?: string;
  branchPricingNote?: string;
  // Phase 4.2 Manual Payment Tracking, 7-Day No-Paid-Branch Grace & 10 SAR Reactivation
  accountSetupFeeSar?: number;
  setupFeeStatus?: FeePaymentStatus;
  setupFeePaidAt?: SubscriptionTimestampValue;
  reactivationFeeSar?: number;
  reactivationFeeStatus?: FeePaymentStatus;
  reactivationFeePaidAt?: SubscriptionTimestampValue;
  reactivatedAt?: SubscriptionTimestampValue;
  reactivatedBy?: string;
  deactivationReason?: DeactivationReason;
  noPaidBranchGraceStartedAt?: SubscriptionTimestampValue;
  deactivationDueAt?: SubscriptionTimestampValue;
  deactivatedAt?: SubscriptionTimestampValue;
  createdAt: string;
  updatedAt: string;
}

export interface SuperAdminOverviewData {
  organizations: Organization[];
  branches: Branch[];
  users: UserProfile[];
  managerInvites?: ManagerInvite[];
  platformAuditLogs?: PlatformAuditLog[];
  fetchedAt: string;
  partialDeniedCollections?: string[];
  diagnosticMessage?: string;
}

export interface Branch {
  id: string;
  orgId: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  driveFolderId?: string;
  driveFolderName?: string;
  driveFolderLink?: string;
  // Phase 4.2 Exclusive Branch Billing, 30-Day Grace & Verified Drive Purge
  lifecycleStatus?: BranchLifecycleStatus;
  subscriptionStartAt?: SubscriptionTimestampValue;
  feeDueAt?: SubscriptionTimestampValue;
  monthlyFeeSar?: number;
  paymentStatus?: BranchPaymentStatus;
  lastPaidAt?: SubscriptionTimestampValue;
  lastPaidBy?: string;
  paymentNote?: string;
  suspendedAt?: SubscriptionTimestampValue;
  suspendedBy?: string;
  suspensionReason?: string;
  gracePeriodEndsAt?: SubscriptionTimestampValue;
  driveBackupVerified?: boolean;
  driveBackupVerifiedAt?: SubscriptionTimestampValue;
  driveBackupVerifiedBy?: string;
  driveBackupArchivedClosingsCount?: number;
  purgedFromDbAt?: SubscriptionTimestampValue;
  purgedFromDbBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface UserPermissions {
  canCreateClosing: boolean;
  canViewAllClosings: boolean;
  canApproveClosings: boolean;
  canManageBranches: boolean;
  canManageEmployees: boolean;
  canExportReports: boolean;
  canManagePurchases?: boolean;
  canManageSuppliers?: boolean;
  canViewSuppliers?: boolean;
  canViewFinancialReports?: boolean;
}

export interface UserProfile {
  uid: string;
  orgId: string;
  email: string;
  displayName: string;
  role: UserRole;
  branchId?: string;
  branchIds?: string[];
  branchName?: string;
  phone?: string;
  isActive: boolean;
  isArchived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  permissions: UserPermissions;
  createdAt: string;
  updatedAt?: string;
}

export interface Supplier {
  id: string;
  orgId: string;
  name: string;
  taxNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type PurchasePaymentMethod = 'cash' | 'card' | 'transfer' | 'credit';

export interface Purchase {
  id: string;
  orgId: string;
  branchId: string;
  branchName?: string;
  supplierId: string;
  supplierName?: string;
  invoiceNumber?: string;
  date: string; // YYYY-MM-DD
  amount: number;
  vatAmount?: number;
  totalAmount: number;
  paymentMethod: PurchasePaymentMethod;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdByRole: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftClosing {
  id: string;
  orgId: string;
  branchId: string;
  branchName: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  period: ShiftPeriod;
  cashSales: number;
  cardSales: number;
  totalSales: number;     // cashSales + cardSales
  expenses: number;
  remainingInBox: number; // cashSales - expenses
  netPeriod: number;      // totalSales - expenses
  notes?: string;
  status: ClosingStatus;
  rejectionReason?: string;
  attachmentIds: string[];
  attachments?: AttachmentItem[];
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  correctionReason?: string;
  correctedBy?: string;
  correctedByName?: string;
  correctedAt?: string;
  previousValues?: {
    cashSales: number;
    cardSales: number;
    expenses: number;
    totalSales: number;
    remainingInBox: number;
    netPeriod: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentItem {
  id: string;
  orgId: string;
  branchId: string;
  closingId?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  driveFileId?: string;
  driveWebViewLink?: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
}

export interface AuditLog {
  id: string;
  orgId: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  targetType:
    | 'closing'
    | 'branch'
    | 'employee'
    | 'drive'
    | 'organization'
    | 'supplier'
    | 'purchase';
  targetId: string;
  details: string;
  timestamp: string;
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
}

export interface OrgSettings {
  orgId: string;
  defaultCurrency: string;
  enableDriveSync: boolean;
  requireReceiptAttachment: boolean;
  preventDuplicateClosing: boolean;
  morningShiftStart: string;
  morningShiftEnd: string;
  eveningShiftStart: string;
  eveningShiftEnd: string;
}

export interface FinancialSummary {
  totalCash: number;
  totalCard: number;
  totalSales: number;
  totalExpenses: number;
  totalRemainingInBox: number;
  totalNetPeriod: number;
  closingsCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  draftCount: number;
}
