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
  | 'legacy_unrestricted'
  | 'billing_exempt';

export type BillingExemptionScope = 'full_permanent';

export type BranchExemptionScope = 'branch_permanent';

export type ExemptionClassification = 'billing_exempt' | 'legacy_unrestricted';

export type ExemptionSource = 'organization' | 'branch' | 'both' | 'none';

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
  | 'ORG_BILLING_EXEMPTION_GRANTED'
  | 'ORG_BILLING_EXEMPTION_REVOKED'
  | 'ORG_LEGACY_UNRESTRICTED_GRANTED'
  | 'ORG_LEGACY_UNRESTRICTED_REVOKED'
  | 'INVITE_UPSERTED'
  | 'INVITE_CANCELLED'
  | 'BRANCH_CREATED'
  | 'BRANCH_PAYMENT_UPDATED'
  | 'BRANCH_BILLING_EXEMPTION_GRANTED'
  | 'BRANCH_BILLING_EXEMPTION_REVOKED'
  | 'ORG_BRANCHES_BULK_EXEMPTION_GRANTED'
  | 'BRANCH_SUSPENDED'
  | 'BRANCH_REACTIVATED'
  | 'BRANCH_DRIVE_BACKUP_VERIFIED'
  | 'BRANCH_DB_PURGED'
  | 'MEMBER_CREATED'
  | 'MEMBER_UPDATED'
  | 'MEMBER_ROLE_CHANGED'
  | 'MEMBER_BRANCH_CHANGED'
  | 'MEMBER_ARCHIVED'
  | 'MEMBER_REACTIVATED'
  | 'MEMBER_ORG_MEMBERSHIP_RELEASED'
  | 'MEMBER_ORG_MEMBERSHIP_ASSIGNED';

export type MemberMembershipStatus = 'active' | 'archived' | 'released';

export type MemberOrgHistoryEventType = 'released' | 'assigned';

export interface MemberOrgHistoryRecord {
  id: string;
  eventType: MemberOrgHistoryEventType;
  uid: string;
  email: string;
  displayName: string;
  orgId: string;
  orgName: string;
  previousOrgId?: string;
  previousOrgName?: string;
  role: 'supervisor' | 'branch_manager' | 'employee';
  branchId?: string;
  branchName?: string;
  joinedAt?: string;
  effectiveAt: string;
  actorUid: string;
  actorEmail: string;
  reason: string;
  auditLogId: string;
  createdAt: string;
}

export interface PlatformAuditLog {
  id: string;
  actorEmail: string;
  actorUid: string;
  action: PlatformAuditAction;
  targetType: 'organization' | 'branch' | 'invite' | 'billing' | 'member';
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
  | 'profile_uid_mismatch'
  | 'account_archived'
  | 'account_disabled'
  | 'membership_released'
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
  // Official Permanent Billing Exemption (Super Admin only, owner-bound, preserves historical billing records)
  billingExempt?: boolean;
  billingExemptScope?: BillingExemptionScope;
  /**
   * Classification for Super-Admin-granted permanent organization exemption.
   * Defaults to 'billing_exempt' when omitted. Setting 'legacy_unrestricted' grants
   * explicit legacy_unrestricted status independently of historical subscription fields.
   */
  billingExemptMode?: ExemptionClassification;
  billingExemptReason?: string;
  billingExemptGrantedAt?: SubscriptionTimestampValue | null;
  billingExemptGrantedBy?: string | null;
  billingExemptVerifiedOwnerId?: string | null;
  billingExemptVerifiedOwnerEmail?: string | null;
  billingExemptRevokedAt?: SubscriptionTimestampValue | null;
  billingExemptRevokedBy?: string | null;
  billingExemptRevokeReason?: string | null;
  billingExemptLastAuditLogId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SuperAdminOverviewData {
  organizations: Organization[];
  branches: Branch[];
  users: UserProfile[];
  managerInvites?: ManagerInvite[];
  platformAuditLogs?: PlatformAuditLog[];
  memberOrgHistory?: MemberOrgHistoryRecord[];
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
  feeDueAt?: SubscriptionTimestampValue | null;
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
  // Independent Branch-Level Exemption & Legacy Unrestricted Metadata (Super Admin only)
  // Kept strictly independent from organization-level exemption and historical payment fields.
  billingExempt?: boolean;
  billingExemptMode?: ExemptionClassification;
  billingExemptScope?: BranchExemptionScope;
  exemptReason?: string | null;
  exemptGrantedAt?: SubscriptionTimestampValue | null;
  exemptGrantedBy?: string | null;
  exemptRevokedAt?: SubscriptionTimestampValue | null;
  exemptRevokedBy?: string | null;
  exemptRevokeReason?: string | null;
  exemptLastAuditLogId?: string | null;
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
  canCreateSuppliers?: boolean;
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
  membershipStatus?: MemberMembershipStatus;
  releasedFromOrgId?: string;
  releasedFromOrgName?: string;
  releasedAt?: string;
  releasedBy?: string;
  releaseReason?: string;
  reassignedAt?: string;
  reassignedBy?: string;
  lastMemberOrgHistoryId?: string;
  lastPlatformAuditLogId?: string;
  permissions: UserPermissions;
  createdAt: string;
  updatedAt?: string;
  /**
   * Runtime-only diagnostic populated from Firestore `docSnap.id` during reads.
   * Never persisted to Firestore; used exclusively to detect docId vs `uid` mismatches read-only.
   */
  firestoreDocId?: string;
}

export interface Supplier {
  id: string;
  orgId: string;
  name: string;
  contactPerson?: string;
  companyName?: string;
  taxNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  openingBalance?: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type PurchasePaymentMethod = 'cash' | 'card' | 'transfer' | 'credit';

export interface PurchaseLineItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PurchaseSubLineItem extends PurchaseLineItem {
  purchaseId: string;
  orgId: string;
  branchId: string;
  lineIndex: number;
  createdBy: string;
  createdAt: string;
}

export interface PurchaseAttachmentDraft {
  localId: string;
  file: File;
  fileName: string;
  fileSize: number;
  mimeType: string;
  previewUrl?: string;
}

export interface Purchase {
  id: string;
  orgId: string;
  branchId: string;
  branchName?: string;
  supplierId: string;
  supplierName?: string;
  taxNumber?: string;
  invoiceNumber?: string;
  date: string; // YYYY-MM-DD
  items?: PurchaseLineItem[];
  amount: number;
  subtotalAmount?: number;
  discountAmount?: number;
  vatRate?: number;
  vatAmount?: number;
  totalAmount: number;
  paymentMethod: PurchasePaymentMethod;
  notes?: string;
  attachmentIds?: string[];
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
  purchaseId?: string;
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

// Phase 4.6 — Comprehensive Role-Scoped Notification System
export type NotificationCategory =
  | 'employees'
  | 'closings'
  | 'schedule_requests'
  | 'purchases_suppliers'
  | 'org_branches'
  | 'security_admin';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export type NotificationAudienceScope =
  | 'user'
  | 'org_manager'
  | 'org_supervisor_permission'
  | 'branch_manager'
  | 'super_admin';

export type NotificationTargetType =
  | 'employee'
  | 'closing'
  | 'schedule_request'
  | 'purchase'
  | 'supplier'
  | 'branch'
  | 'organization'
  | 'drive'
  | 'security';

export interface NotificationNavTarget {
  surface: 'tenant' | 'super_admin';
  tab?:
    | 'overview'
    | 'closings'
    | 'purchases'
    | 'purchase_reports'
    | 'suppliers'
    | 'reports'
    | 'workers_payroll'
    | 'worker_advances'
    | 'branches'
    | 'employees'
    | 'audit'
    | 'settings'
    | 'workspace'
    | 'organizations'
    | 'members'
    | 'invites'
    | 'auditLogs';
  entityId?: string;
  branchId?: string;
}

export interface AppNotification {
  id: string;
  dedupKey: string;
  category: NotificationCategory;
  type: string;
  severity: NotificationSeverity;
  audienceScope: NotificationAudienceScope;
  orgId: string; // 'platform' for super_admin platform feed, else tenant orgId
  relatedOrgId?: string; // optional tenant orgId when orgId === 'platform'
  branchId?: string;
  branchName?: string;
  recipientUid?: string; // required when audienceScope === 'user'
  requiredPermission?: keyof UserPermissions;
  secondaryPermission?: keyof UserPermissions;
  feedKeys: string[];
  actorUid: string;
  actorName: string;
  actorRole: string;
  title: string;
  body: string;
  targetType?: NotificationTargetType;
  targetId?: string;
  navTarget?: NotificationNavTarget;
  readBy: Record<string, string>;
  isRead?: boolean;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserNotificationCapability {
  supported: boolean;
  isSecureContext: boolean;
  permission: 'default' | 'granted' | 'denied' | 'unsupported';
  foregroundReady: boolean;
  backgroundPushAvailable: false;
  backgroundPushReason: string;
}

export * from './workersPayroll';


