import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  auth,
  db,
  googleProvider,
  getSecondaryAuth,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from '../lib/firebase';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  limit,
  startAt,
  endAt,
  documentId,
  serverTimestamp,
  writeBatch,
  runTransaction,
  deleteField,
  Timestamp,
} from 'firebase/firestore';
import {
  Organization,
  UserProfile,
  Branch,
  AuditLog,
  ShiftClosing,
  ClosingStatus,
  ClosingArchiveRecord,
  DriveMonthFolderRef,
  DriveHealthStatus,
  SuperAdminOverviewData,
  ManagerInvite,
  PlatformAuditAction,
  PlatformAuditLog,
  MemberOrgHistoryRecord,
  FeePaymentStatus,
  BranchPaymentStatus,
  ExemptionClassification,
  SubscriptionPlan,
  SubscriptionStatus,
  DeactivationReason,
  TenantAccessStatus,
  SubscriptionBlockReason,
  InviteBlockReason,
  AccessErrorReason,
  Purchase,
  AttachmentItem,
  UserRole,
  AppNotification,
} from '../types';
import { isVerifiedSuperAdmin } from '../utils/superAdmin';
import {
  fetchSuperAdminOverviewWithDiagnostics,
  isPermissionDeniedError,
  TARGET_FIRESTORE_DATABASE_ID,
  verifySuperAdminForRealtimeListener,
} from '../utils/superAdminMonitoring';
import {
  calculateSubscriptionEndDate,
  evaluateOrganizationSubscription,
  OrganizationSubscriptionEvaluation,
  toValidDate,
} from '../utils/subscription';
import {
  ACCOUNT_SETUP_FEE_SAR,
  BRANCH_MONTHLY_FEE_SAR,
  BRANCH_PRICING_MODEL,
  BRANCH_SUSPENSION_GRACE_DAYS,
  BranchDriveBackupVerificationResult,
  evaluateOrganizationBranchPricing,
  isBranchCountedAsPaid,
  NEW_ORG_INCLUDED_BRANCHES_COUNT,
  NO_PAID_BRANCH_GRACE_DAYS,
  ORG_REACTIVATION_FEE_SAR,
  verifyBranchDriveBackupCompleteness,
} from '../utils/branchPricing';
import {
  buildSuperAdminAssignReleasedMemberBundle,
  buildSuperAdminBranchExemptionGrantBundle,
  buildSuperAdminBranchExemptionRevokeBundle,
  buildSuperAdminBulkBranchesExemptionBundles,
  buildSuperAdminMemberArchiveBundle,
  buildSuperAdminMemberCreateBundle,
  buildSuperAdminMemberReactivateBundle,
  buildSuperAdminMemberReleaseBundle,
  buildSuperAdminMemberUpdateBundle,
  buildSuperAdminOrgExemptionGrantBundle,
  buildSuperAdminOrgExemptionRevokeBundle,
  InFlightActionGuard,
  resolveOrgExemptionRevokeAuditAction,
  SuperAdminAssignableMemberRole,
  validateSuperAdminMemberCreateInput,
} from '../utils/superAdminGovernance';
import {
  buildAtomicInviteClaimPayloads,
  evaluateFirestoreErrorCategory,
  getSubscriptionBlockReason,
  isGoogleProviderUser,
  isValidNormalizedEmailDocId,
  resolveMemberMembershipStatus,
  normalizeEmail,
  resolveProfiledUserAccess,
  resolveUnprofiledUserAccess,
} from '../utils/tenantAccess';
import {
  assertProfileEmailImmutableOnEmployeeUpdate,
  AuthProfileEmailMismatchRecord,
  detectAuthProfileEmailMismatch,
  fetchFirestoreDocWithFreshServerCheck,
  normalizeLoginEmail,
  prepareLoginCredentials,
  syncAuthLanguageCode,
  validateLoadedUserProfileBinding,
} from '../utils/authCredentials';
import {
  buildEmployeeUidDiagnosticReport,
  DiagnosticCollectionProbe,
  EmployeeUidDiagnosticReport,
  RawDiagnosticUserDoc,
} from '../utils/employeeUidRebind';
import {
  BranchManagerOptionalPermissions,
  buildDefaultPermissionsForRole,
  canUserAccessBranch,
  resolveEffectivePermissions,
  resolvePrimaryAssignedBranchId,
  SupervisorOptionalPermissionKey,
  validateRoleAssignmentInput,
} from '../utils/permissions';
import {
  calculateShiftTotals,
  generateDeterministicClosingId,
} from '../utils/accounting';
import {
  evaluateShiftClosingSlotPolicy,
  executeAtomicReviewShiftClosing,
  fetchSlotClosingsFromServer,
  ShiftClosingBusinessError,
} from '../utils/shiftClosingGuards';
import {
  assertDriveSessionMatchesAccount,
  assertOrgDriveAuthorizationEligibility,
  buildBranchDriveDisconnectPayload,
  buildOrgDriveDisconnectPayload,
  clearDriveSession,
  downloadOriginalClosingExcelFromDrive,
  evaluateOrgDriveReadiness,
  executeOrgDriveDisconnect,
  getActiveDriveSession,
  isBranchActiveForDriveLink,
  isOAuthCancellationOrConfigError,
  OrgDriveReadinessResult,
  DRIVE_NOT_READY_MESSAGE,
  requestDriveAuthorization,
  selectBranchesForDriveDisconnect,
  uploadAndVerifyClosingExcelToDrive,
} from '../services/driveService';
import { clearUnifiedDriveFolderCache } from '../services/unifiedDriveService';
import {
  assertValidIsoCalendarDate,
  downloadXlsxBytes,
  generateClosingExcelWorkbook,
} from '../services/excelReportService';
import {
  buildClosingAdminCorrectedNotifications,
  buildClosingReviewedNotifications,
  buildClosingSubmittedNotifications,
  buildEmployeeLifecycleNotifications,
  buildOrgThresholdNotifications,
  buildSecurityAdminNotification,
  buildSuperAdminPlatformNotification,
  buildSuperAdminThresholdNotifications,
  getNotificationSoundEnabled,
  isNotificationReadByUser,
  mergeAndSortNotifications,
  NOTIFICATION_FEED_PAGE_SIZE,
  NotificationPersistenceTracker,
  NotificationSoundController,
  resetNotificationRuntimeControllers,
  resolveAuthorizedNotificationCheckFeedKey,
  resolveFeedKeysForUser,
  setNotificationSoundEnabled,
  showForegroundBrowserNotification,
  unlockNotificationAudio,
} from '../utils/notifications';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  currentOrg: Organization | null;
  branches: Branch[];
  currentBranch: Branch | null;
  employees: UserProfile[];
  closings: ShiftClosing[];
  closingArchives: ClosingArchiveRecord[];
  auditLogs: AuditLog[];
  loading: boolean;
  needsOnboarding: boolean;
  tenantStatus: TenantAccessStatus;
  subscriptionEvaluation: OrganizationSubscriptionEvaluation | null;
  subscriptionBlockReason: SubscriptionBlockReason | null;
  inviteBlockInfo: { reason: InviteBlockReason; email?: string; orgName?: string } | null;
  accessErrorInfo: { reason: AccessErrorReason; detail?: string } | null;
  authEmailMismatch: AuthProfileEmailMismatchRecord | null;
  loginWithGoogle: () => Promise<void>;
  loginWithEmailPassword: (email: string, pass: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  completeOrganizationSetup: (data: {
    orgName: string;
    activityType: string;
    currency: string;
    commercialRegistration?: string;
    firstBranchName: string;
    firstBranchAddress?: string;
  }) => Promise<void>;
  addBranch: (data: { name: string; address?: string; phone?: string; code?: string }) => Promise<Branch>;
  createEmployeeAccount: (data: {
    email: string;
    password: string;
    displayName: string;
    role?: 'employee' | 'branch_manager' | 'supervisor';
    branchId?: string;
    branchName?: string;
    phone?: string;
    supervisorPermissions?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
    branchManagerPermissions?: BranchManagerOptionalPermissions;
  }) => Promise<UserProfile>;
  updateEmployeeAccount: (data: {
    employeeUid: string;
    displayName: string;
    email?: string;
    phone?: string;
    role: 'employee' | 'branch_manager' | 'supervisor';
    branchId?: string;
    supervisorPermissions?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
    branchManagerPermissions?: BranchManagerOptionalPermissions;
  }) => Promise<void>;
  archiveEmployeeAccount: (employeeUid: string, reason?: string) => Promise<void>;
  sendEmployeePasswordReset: (employeeUid: string) => Promise<string>;
  toggleEmployeeStatus: (employeeUid: string, isActive: boolean) => Promise<void>;
  updateEmployeeBranch: (employeeUid: string, branchId: string, branchName: string) => Promise<void>;
  submitShiftClosing: (data: {
    branchId: string;
    branchName: string;
    date: string;
    period: 'morning' | 'evening';
    cashSales: number;
    cardSales: number;
    expenses: number;
    notes?: string;
    status: 'draft' | 'pending_review';
  }) => Promise<ShiftClosing>;
  reviewShiftClosing: (
    closingId: string,
    action: 'approve' | 'reject',
    rejectionReason?: string
  ) => Promise<void>;
  adminCorrectClosing: (data: {
    closingId: string;
    cashSales: number;
    cardSales: number;
    expenses: number;
    correctionReason: string;
  }) => Promise<void>;
  saveDriveConnection: (data: {
    driveAccountEmail: string;
    driveAccountName: string;
    driveGoogleSub: string;
    orgFolderId: string;
    orgFolderName: string;
    orgFolderLink: string;
    driveWriteVerified: boolean;
    driveWriteVerifiedAt: string;
    branchFolders?: Array<{
      branchId: string;
      folderId: string;
      folderName: string;
      webViewLink: string;
    }>;
    monthFolderMap?: Record<string, DriveMonthFolderRef>;
  }) => Promise<void>;
  recordDriveHealthFailure: (errorMessage: string) => Promise<void>;
  disconnectDriveConnection: () => Promise<void>;
  archiveClosingToDrive: (
    closingId: string,
    options?: { interactiveAuthIfNeeded?: boolean }
  ) => Promise<ClosingArchiveRecord>;
  archivePendingClosingsToDrive: (closingIds: string[]) => Promise<{
    succeeded: string[];
    failed: Array<{ closingId: string; error: string }>;
  }>;
  downloadArchivedExcelFromDrive: (
    closingId: string
  ) => Promise<{ fileName: string; revision: number }>;
  driveReadiness: OrgDriveReadinessResult;
  logout: () => Promise<void>;
  refreshTenantData: () => Promise<void>;
  setCurrentBranch: (branch: Branch) => void;
  authNotice: { type: 'info' | 'warning' | 'error'; message: string } | null;
  clearAuthNotice: () => void;
  isSuperAdmin: boolean;
  superAdminOverview: SuperAdminOverviewData | null;
  superAdminLoading: boolean;
  superAdminError: string | null;
  loadSuperAdminOverview: () => Promise<void>;
  createSuperAdminOrganizationWithInvite: (input: {
    name: string;
    taxNumber?: string;
    commercialRegistration?: string;
    activityType: string;
    currency: string;
    ownerName: string;
    ownerEmail: string;
    subscriptionPlan: SubscriptionPlan;
    startDateIso: string;
    endDateIso?: string;
    subscriptionNote?: string;
    setupFeeStatus: FeePaymentStatus;
    setupFeePaidDateIso?: string;
    firstBranchName: string;
    firstBranchCode?: string;
    firstBranchPaymentStatus: BranchPaymentStatus;
    firstBranchDueDateIso?: string;
  }) => Promise<{ orgId: string; branchId: string; inviteEmail: string }>;
  updateSuperAdminOrganizationProfileAndBilling: (input: {
    orgId: string;
    name: string;
    taxNumber?: string;
    commercialRegistration?: string;
    activityType: string;
    currency: string;
    ownerName: string;
    ownerEmail: string;
    setupFeeStatus?: FeePaymentStatus;
    setupFeePaidDateIso?: string;
    subscriptionPlan?: SubscriptionPlan;
    subscriptionStatus?: SubscriptionStatus;
    startDateIso?: string;
    endDateIso?: string;
    subscriptionNote?: string;
    convertLegacyToPaid?: boolean;
  }) => Promise<void>;
  updateSuperAdminOrgStatus: (input: {
    orgId: string;
    action: 'suspend' | 'start_no_paid_branch_grace' | 'deactivate_no_paid_branches' | 'reactivate';
    reason?: DeactivationReason;
    reactivationFeeStatus?: FeePaymentStatus;
    reactivationFeePaidDateIso?: string;
    note?: string;
  }) => Promise<void>;
  grantSuperAdminOrgBillingExemption: (input: {
    orgId: string;
    expectedOwnerEmail?: string;
    mode?: ExemptionClassification;
    reason: string;
  }) => Promise<{ auditLogId: string; ownerId: string; ownerEmail: string }>;
  revokeSuperAdminOrgBillingExemption: (input: {
    orgId: string;
    reason: string;
  }) => Promise<{ auditLogId: string }>;
  grantSuperAdminBranchExemption: (input: {
    branchId: string;
    mode?: ExemptionClassification;
    reason: string;
  }) => Promise<{ auditLogId: string }>;
  revokeSuperAdminBranchExemption: (input: {
    branchId: string;
    restoredPaymentStatus?: Exclude<BranchPaymentStatus, 'exempt'>;
    restoredMonthlyFeeSar?: number;
    reason: string;
  }) => Promise<{ auditLogId: string; parentOrgRemainsExempt: boolean }>;
  grantSuperAdminBulkOrgBranchesExemption: (input: {
    orgId: string;
    mode?: ExemptionClassification;
    reason: string;
  }) => Promise<{ exemptedCount: number; auditLogIds: string[] }>;
  createSuperAdminOrgMember: (input: {
    orgId: string;
    email: string;
    password: string;
    displayName: string;
    role: SuperAdminAssignableMemberRole;
    branchId?: string;
    phone?: string;
    supervisorPermissions?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
  }) => Promise<{ member: UserProfile; auditLogId: string }>;
  updateSuperAdminOrgMember: (input: {
    memberUid: string;
    displayName: string;
    phone?: string;
    role: SuperAdminAssignableMemberRole;
    branchId?: string;
    supervisorPermissions?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
    reason?: string;
  }) => Promise<{
    action: 'MEMBER_ROLE_CHANGED' | 'MEMBER_BRANCH_CHANGED' | 'MEMBER_UPDATED';
    auditLogId: string;
  }>;
  archiveSuperAdminOrgMember: (input: {
    memberUid: string;
    reason: string;
  }) => Promise<{ auditLogId: string }>;
  reactivateSuperAdminOrgMember: (input: {
    memberUid: string;
    reason?: string;
  }) => Promise<{ auditLogId: string }>;
  releaseSuperAdminOrgMember: (input: {
    memberUid: string;
    reason: string;
  }) => Promise<{ auditLogId: string; historyId: string }>;
  assignReleasedMemberToOrganization: (input: {
    memberUid: string;
    targetOrgId: string;
    role: SuperAdminAssignableMemberRole;
    branchId?: string;
    supervisorPermissions?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
    reason?: string;
    sendOptionalPasswordReset?: boolean;
  }) => Promise<{ auditLogId: string; historyId: string; passwordResetSent: boolean }>;
  sendSuperAdminMemberPasswordReset: (memberUid: string) => Promise<{ email: string }>;
  loadSuperAdminReleasedMembers: () => Promise<UserProfile[]>;
  loadSuperAdminMemberOrgHistory: (memberUid?: string) => Promise<MemberOrgHistoryRecord[]>;
  inspectEmployeeUidBindingDiagnostic: (input: {
    targetAuthUid: string;
    legacyDocId: string;
    email?: string;
  }) => Promise<EmployeeUidDiagnosticReport>;
  upsertSuperAdminManagerInvite: (input: {
    email: string;
    orgId: string;
    managerName?: string;
  }) => Promise<void>;
  cancelSuperAdminManagerInvite: (email: string) => Promise<void>;
  createSuperAdminBranch: (input: {
    orgId: string;
    name: string;
    code?: string;
    address?: string;
    phone?: string;
    paymentStatus: BranchPaymentStatus;
    subscriptionStartIso?: string;
    feeDueDateIso?: string;
    paymentNote?: string;
  }) => Promise<Branch>;
  recordSuperAdminBranchPayment: (input: {
    branchId: string;
    paymentStatus: BranchPaymentStatus;
    paidDateIso?: string;
    feeDueDateIso?: string;
    monthlyFeeSar?: number;
    paymentNote?: string;
  }) => Promise<void>;
  suspendSuperAdminBranch: (input: {
    branchId: string;
    reason?: string;
  }) => Promise<void>;
  reactivateSuperAdminBranch: (input: {
    branchId: string;
    paymentStatus: BranchPaymentStatus;
    feeDueDateIso?: string;
    paymentNote?: string;
  }) => Promise<void>;
  inspectBranchDriveBackupForPurge: (branchId: string) => Promise<
    BranchDriveBackupVerificationResult & {
      purchasesCount: number;
      attachmentsCount: number;
    }
  >;
  purgeSuspendedBranchFromDb: (branchId: string) => Promise<{
    deletedClosings: number;
    deletedPurchases: number;
    deletedAttachments: number;
    deletedClosingArchives: number;
  }>;
  // Phase 4.6 — Real-time Notification System
  tenantNotifications: AppNotification[];
  superAdminNotifications: AppNotification[];
  notificationsLoading: boolean;
  tenantNotificationsHasMore: boolean;
  superAdminNotificationsHasMore: boolean;
  notificationSoundEnabled: boolean;
  toggleNotificationSound: () => void;
  markNotificationAsRead: (notificationId: string) => Promise<void>;
  markAllNotificationsAsRead: (surface: 'tenant' | 'super_admin') => Promise<void>;
  loadMoreNotifications: (surface: 'tenant' | 'super_admin') => void;
  emitSecurityAccessDeniedAlert: (detail: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [employees, setEmployees] = useState<UserProfile[]>([]);
  const [closings, setClosings] = useState<ShiftClosing[]>([]);
  const [closingArchives, setClosingArchives] = useState<ClosingArchiveRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [tenantStatus, setTenantStatus] = useState<TenantAccessStatus>('loading');
  const [subscriptionEvaluation, setSubscriptionEvaluation] =
    useState<OrganizationSubscriptionEvaluation | null>(null);
  const [subscriptionBlockReason, setSubscriptionBlockReason] =
    useState<SubscriptionBlockReason | null>(null);
  const [inviteBlockInfo, setInviteBlockInfo] = useState<{
    reason: InviteBlockReason;
    email?: string;
    orgName?: string;
  } | null>(null);
  const [accessErrorInfo, setAccessErrorInfo] = useState<{
    reason: AccessErrorReason;
    detail?: string;
  } | null>(null);
  const [authEmailMismatch, setAuthEmailMismatch] = useState<AuthProfileEmailMismatchRecord | null>(
    null
  );
  const [authNotice, setAuthNotice] = useState<{ type: 'info' | 'warning' | 'error'; message: string } | null>(null);
  const [superAdminOverview, setSuperAdminOverview] = useState<SuperAdminOverviewData | null>(null);
  const [superAdminLoading, setSuperAdminLoading] = useState(false);
  const [superAdminError, setSuperAdminError] = useState<string | null>(null);
  const [tenantNotifications, setTenantNotifications] = useState<AppNotification[]>([]);
  const [superAdminNotifications, setSuperAdminNotifications] = useState<AppNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [tenantNotifLimit, setTenantNotifLimit] = useState(NOTIFICATION_FEED_PAGE_SIZE);
  const [saNotifLimit, setSaNotifLimit] = useState(NOTIFICATION_FEED_PAGE_SIZE);
  const [tenantNotificationsHasMore, setTenantNotificationsHasMore] = useState(false);
  const [superAdminNotificationsHasMore, setSuperAdminNotificationsHasMore] = useState(false);
  const [notificationSoundEnabled, setNotificationSoundEnabledState] = useState<boolean>(true);

  const activeUserUidRef = useRef<string | null>(null);
  const activeOrgIdRef = useRef<string | null>(null);
  const prevUserUidRef = useRef<string | null>(null);
  const prevOrgIdRef = useRef<string | null>(null);
  const loadInFlightRef = useRef<{ uid: string; promise: Promise<void> } | null>(null);
  const inviteClaimLockRef = useRef<string | null>(null);
  const tenantSoundControllerRef = useRef(new NotificationSoundController());
  const saSoundControllerRef = useRef(new NotificationSoundController());
  const notificationSoundEnabledRef = useRef<boolean>(true);
  const emittedThresholdTrackerRef = useRef(new NotificationPersistenceTracker());
  const loadedNotificationIdsRef = useRef<Set<string>>(new Set());
  const inFlightSuperAdminActionsRef = useRef(new InFlightActionGuard());

  activeUserUidRef.current = currentUser?.uid ?? null;
  activeOrgIdRef.current = currentOrg?.id ?? null;
  notificationSoundEnabledRef.current = notificationSoundEnabled;

  useEffect(() => {
    const ids = new Set<string>();
    for (const n of tenantNotifications) {
      if (n.id) ids.add(n.id);
    }
    for (const n of superAdminNotifications) {
      if (n.id) ids.add(n.id);
    }
    loadedNotificationIdsRef.current = ids;
  }, [tenantNotifications, superAdminNotifications]);

  const clearOperationalState = () => {
    setBranches([]);
    setCurrentBranch(null);
    setEmployees([]);
    setClosings([]);
    setClosingArchives([]);
    setAuditLogs([]);
    setTenantNotifications([]);
    setTenantNotificationsHasMore(false);
    setNotificationsLoading(false);
    setTenantNotifLimit(NOTIFICATION_FEED_PAGE_SIZE);
    tenantSoundControllerRef.current.reset('');
    emittedThresholdTrackerRef.current.reset();
    loadedNotificationIdsRef.current.clear();
  };

  // Enforce strict RAM session & tenant-state isolation whenever Firebase user switches or logs out/in
  useEffect(() => {
    const nextUid = currentUser?.uid ?? null;
    if (prevUserUidRef.current !== nextUid) {
      clearDriveSession();
      resetNotificationRuntimeControllers({
        tenantController: tenantSoundControllerRef.current,
        saController: saSoundControllerRef.current,
        persistenceTracker: emittedThresholdTrackerRef.current,
        setTenantLimit: setTenantNotifLimit,
        setSaLimit: setSaNotifLimit,
      });
    }
    if (!nextUid) {
      clearDriveSession();
      setAuthEmailMismatch(null);
      setTenantNotifications([]);
      setTenantNotificationsHasMore(false);
      setSuperAdminNotifications([]);
      setSuperAdminNotificationsHasMore(false);
      setNotificationsLoading(false);
      setNotificationSoundEnabledState(true);
      resetNotificationRuntimeControllers({
        tenantController: tenantSoundControllerRef.current,
        saController: saSoundControllerRef.current,
        persistenceTracker: emittedThresholdTrackerRef.current,
        setTenantLimit: setTenantNotifLimit,
        setSaLimit: setSaNotifLimit,
      });
    } else {
      setNotificationSoundEnabledState(getNotificationSoundEnabled(nextUid));
    }
    prevUserUidRef.current = nextUid;
  }, [currentUser?.uid]);

  useEffect(() => {
    const handleUnlock = () => unlockNotificationAudio();
    window.addEventListener('pointerdown', handleUnlock, { passive: true });
    window.addEventListener('keydown', handleUnlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleUnlock);
      window.removeEventListener('keydown', handleUnlock);
    };
  }, []);

  useEffect(() => {
    const nextOrgId = currentOrg?.id ?? null;
    if (prevOrgIdRef.current && prevOrgIdRef.current !== nextOrgId) {
      clearDriveSession(prevOrgIdRef.current);
      clearOperationalState();
    }
    prevOrgIdRef.current = nextOrgId;
  }, [currentOrg?.id]);

  const clearAuthNotice = () => setAuthNotice(null);

  useEffect(() => {
    testFirestoreConnection();
  }, []);

  useEffect(() => {
    // Process redirect sign-in result if returning from a mobile redirect flow;
    // onAuthStateChanged drives loadUserData once cleanly.
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          if (activeUserUidRef.current && activeUserUidRef.current !== result.user.uid) {
            clearDriveSession();
          }
          setCurrentUser(result.user);
        }
      })
      .catch((error) => {
        console.warn('Redirect sign-in resolution notice:', error?.message);
      });

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      const prevUid = activeUserUidRef.current;
      if (!fbUser || (prevUid && prevUid !== fbUser.uid)) {
        clearDriveSession();
      }
      activeUserUidRef.current = fbUser?.uid ?? null;
      setCurrentUser(fbUser);
      if (!isVerifiedSuperAdmin(fbUser)) {
        setSuperAdminOverview(null);
        setSuperAdminError(null);
      }
      if (fbUser) {
        setLoading(true);
        setTenantStatus('loading');
        await loadUserData(fbUser);
      } else {
        setUserProfile(null);
        setCurrentOrg(null);
        setSubscriptionEvaluation(null);
        setSubscriptionBlockReason(null);
        setInviteBlockInfo(null);
        setAccessErrorInfo(null);
        clearOperationalState();
        setSuperAdminOverview(null);
        setSuperAdminNotifications([]);
        setSuperAdminNotificationsHasMore(false);
        resetNotificationRuntimeControllers({
          tenantController: tenantSoundControllerRef.current,
          saController: saSoundControllerRef.current,
          persistenceTracker: emittedThresholdTrackerRef.current,
          setTenantLimit: setTenantNotifLimit,
          setSaLimit: setSaNotifLimit,
        });
        setSuperAdminError(null);
        setNeedsOnboarding(false);
        setTenantStatus('unauthenticated');
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Passive listeners for organization subscription status & self active-status enforcement
  // Active even when subscription_blocked so live Super Admin renewal unlocks Dashboard automatically
  useEffect(() => {
    if (!currentUser?.uid || !currentOrg?.id) return;
    if (tenantStatus !== 'active_tenant' && tenantStatus !== 'subscription_blocked') return;

    const orgDocRef = doc(db, 'organizations', currentOrg.id);
    const unsubOrg = onSnapshot(
      orgDocRef,
      (docSnap) => {
        if (!docSnap.exists()) return;
        const updatedOrg: Organization = { ...(docSnap.data() as Organization), id: docSnap.id };
        setCurrentOrg(updatedOrg);
        const nextEval = evaluateOrganizationSubscription(updatedOrg);
        setSubscriptionEvaluation(nextEval);

        if (!nextEval.isAllowed) {
          setSubscriptionBlockReason(getSubscriptionBlockReason(nextEval));
          if (tenantStatus === 'active_tenant') {
            setTenantStatus('subscription_blocked');
            clearOperationalState();
          }
        } else if (tenantStatus === 'subscription_blocked') {
          setSubscriptionBlockReason(null);
          if (userProfile && userProfile.isActive && userProfile.orgId === updatedOrg.id) {
            setTenantStatus('active_tenant');
          } else if (auth.currentUser) {
            void loadUserData(auth.currentUser);
          }
        }
      },
      (error) => {
        console.warn('Passive organization listener notice:', error?.message);
      }
    );

    let unsubSelf = () => {};
    if (userProfile && userProfile.isActive) {
      const userDocRef = doc(db, 'users', currentUser.uid);
      unsubSelf = onSnapshot(
        userDocRef,
        (docSnap) => {
          if (!docSnap.exists()) return;
          const data: UserProfile = { ...(docSnap.data() as UserProfile), uid: currentUser.uid };
          const membershipStatus = resolveMemberMembershipStatus(data);
          if (membershipStatus === 'released') {
            clearDriveSession();
            clearOperationalState();
            setUserProfile(null);
            setCurrentOrg(null);
            setSubscriptionEvaluation(null);
            setSubscriptionBlockReason(null);
            setInviteBlockInfo(null);
            setAccessErrorInfo({ reason: 'membership_released' });
            setTenantStatus('access_error');
            return;
          }
          if (membershipStatus === 'archived') {
            clearDriveSession();
            clearOperationalState();
            setUserProfile(null);
            setCurrentOrg(null);
            setSubscriptionEvaluation(null);
            setSubscriptionBlockReason(null);
            setInviteBlockInfo(null);
            setAccessErrorInfo({ reason: 'account_archived' });
            setTenantStatus('access_error');
            return;
          }
          if (data.isActive === false) {
            clearDriveSession();
            clearOperationalState();
            setUserProfile(null);
            setCurrentOrg(null);
            setSubscriptionEvaluation(null);
            setSubscriptionBlockReason(null);
            setInviteBlockInfo(null);
            setAccessErrorInfo({ reason: 'account_disabled' });
            setTenantStatus('access_error');
          } else {
            setUserProfile(data);
          }
        },
        (error) => {
          console.warn('User status listener notice:', error?.message);
        }
      );
    }

    return () => {
      unsubOrg();
      unsubSelf();
    };
  }, [currentOrg?.id, currentUser?.uid, tenantStatus, userProfile?.uid, userProfile?.isActive, userProfile?.orgId]);

  // Real-time boundary timer so an open active tab locks immediately at exact subscriptionEndAt
  useEffect(() => {
    if (!currentOrg) return;

    const nextDeadlineMs = [
      subscriptionEvaluation?.endDate?.getTime(),
      subscriptionEvaluation?.deactivationDueAt?.getTime(),
    ]
      .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts))
      .sort((a, b) => a - b)[0];

    if (
      tenantStatus === 'active_tenant' &&
      typeof nextDeadlineMs === 'number' &&
      !subscriptionEvaluation?.isLegacy
    ) {
      const msUntilExpiry = nextDeadlineMs - Date.now();
      if (msUntilExpiry <= 2147483647) {
        const timer = setTimeout(() => {
          const nextEval = evaluateOrganizationSubscription(currentOrg);
          setSubscriptionEvaluation(nextEval);
          if (!nextEval.isAllowed) {
            setSubscriptionBlockReason(getSubscriptionBlockReason(nextEval));
            setTenantStatus('subscription_blocked');
            clearOperationalState();
          }
        }, Math.max(0, msUntilExpiry + 100));
        return () => clearTimeout(timer);
      }
    }

    if (
      tenantStatus === 'subscription_blocked' &&
      subscriptionEvaluation?.notStarted &&
      subscriptionEvaluation.startDate
    ) {
      const msUntilStart = subscriptionEvaluation.startDate.getTime() - Date.now();
      if (msUntilStart <= 2147483647) {
        const timer = setTimeout(() => {
          if (auth.currentUser) {
            void loadUserData(auth.currentUser);
          }
        }, Math.max(0, msUntilStart + 250));
        return () => clearTimeout(timer);
      }
    }
  }, [
    currentOrg,
    tenantStatus,
    subscriptionEvaluation?.endDate?.getTime(),
    subscriptionEvaluation?.deactivationDueAt?.getTime(),
    subscriptionEvaluation?.startDate?.getTime(),
    subscriptionEvaluation?.isLegacy,
    subscriptionEvaluation?.notStarted,
  ]);

  // Operational Firestore listeners ONLY when subscription is active/legacy and user profile is verified
  useEffect(() => {
    if (
      tenantStatus !== 'active_tenant' ||
      !currentOrg?.id ||
      !currentUser?.uid ||
      !userProfile ||
      !userProfile.isActive ||
      userProfile.orgId !== currentOrg.id ||
      !subscriptionEvaluation?.isAllowed
    ) {
      return;
    }

    const assignedBranchId = resolvePrimaryAssignedBranchId(userProfile);
    const effectivePerms = resolveEffectivePermissions(userProfile);

    const branchesRef = collection(db, 'branches');
    const branchesQuery = query(branchesRef, where('orgId', '==', currentOrg.id));
    const unsubBranches = onSnapshot(
      branchesQuery,
      (snapshot) => {
        const loaded: Branch[] = [];
        snapshot.forEach((b) => loaded.push({ ...(b.data() as Branch), id: b.id }));
        setBranches(loaded);
        setCurrentBranch((prev) => {
          if (
            (userProfile.role === 'employee' || userProfile.role === 'branch_manager') &&
            assignedBranchId
          ) {
            return loaded.find((b) => b.id === assignedBranchId) || loaded[0] || null;
          }
          if (prev) {
            return loaded.find((b) => b.id === prev.id) || loaded[0] || null;
          }
          return loaded[0] || null;
        });
      },
      (error) => {
        console.warn('Branches listener notice:', error?.message);
      }
    );

    const closingsRef = collection(db, 'closings');
    let closingsQuery: ReturnType<typeof query> | null = null;
    if (userProfile.role === 'manager') {
      closingsQuery = query(closingsRef, where('orgId', '==', currentOrg.id));
    } else if (userProfile.role === 'supervisor') {
      closingsQuery =
        effectivePerms.canViewAllClosings ||
        effectivePerms.canApproveClosings ||
        effectivePerms.canViewFinancialReports ||
        effectivePerms.canExportReports
          ? query(closingsRef, where('orgId', '==', currentOrg.id))
          : query(
              closingsRef,
              where('orgId', '==', currentOrg.id),
              where('employeeId', '==', currentUser.uid)
            );
    } else if (
      (userProfile.role === 'employee' || userProfile.role === 'branch_manager') &&
      assignedBranchId
    ) {
      closingsQuery = query(
        closingsRef,
        where('orgId', '==', currentOrg.id),
        where('branchId', '==', assignedBranchId)
      );
    }

    let unsubClosings = () => {};
    if (closingsQuery) {
      unsubClosings = onSnapshot(
        closingsQuery,
        (snapshot) => {
          const loaded: ShiftClosing[] = [];
          snapshot.forEach((d) => {
            loaded.push(d.data() as ShiftClosing);
          });
          loaded.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setClosings(loaded);
        },
        (error) => {
          console.warn('Real-time closings notice:', error?.message);
        }
      );
    } else {
      setClosings([]);
    }

    let unsubUsers = () => {};
    if (userProfile.role === 'manager') {
      const usersRef = collection(db, 'users');
      const usersQuery = query(usersRef, where('orgId', '==', currentOrg.id));
      unsubUsers = onSnapshot(
        usersQuery,
        (snapshot) => {
          const loaded: UserProfile[] = [];
          snapshot.forEach((d) => {
            const raw = d.data() as UserProfile;
            if (raw.uid && raw.uid !== d.id) {
              console.warn(
                '[AL EQFAL Auth Diagnostic] Firestore users docId differs from stored uid (read-only):',
                { docId: d.id, storedUid: raw.uid, email: raw.email }
              );
            }
            loaded.push({
              ...raw,
              uid: raw.uid || d.id,
              firestoreDocId: d.id,
            });
          });
          setEmployees(loaded);
        },
        (error) => {
          console.warn('Employees listener notice:', error?.message);
        }
      );
    }

    let unsubLogs = () => {};
    if (userProfile.role === 'manager') {
      const logsRef = collection(db, 'auditLogs');
      const logsQuery = query(logsRef, where('orgId', '==', currentOrg.id));
      unsubLogs = onSnapshot(
        logsQuery,
        (snapshot) => {
          const loaded: AuditLog[] = [];
          snapshot.forEach((d) => {
            loaded.push(d.data() as AuditLog);
          });
          loaded.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          setAuditLogs(loaded);
        },
        (error) => {
          console.warn('Audit logs listener notice:', error?.message);
        }
      );
    }

    let unsubArchives = () => {};
    if (
      userProfile.role === 'manager' ||
      (userProfile.role === 'supervisor' &&
        (effectivePerms.canViewAllClosings || effectivePerms.canApproveClosings))
    ) {
      const archivesQuery = query(
        collection(db, 'closingArchives'),
        where('orgId', '==', currentOrg.id)
      );
      unsubArchives = onSnapshot(
        archivesQuery,
        (snapshot) => {
          const loaded: ClosingArchiveRecord[] = [];
          snapshot.forEach((d) => loaded.push(d.data() as ClosingArchiveRecord));
          setClosingArchives(loaded);
        },
        (error) => {
          console.warn('Closing archives listener notice:', error?.message);
        }
      );
    } else if (
      (userProfile.role === 'employee' || userProfile.role === 'branch_manager') &&
      assignedBranchId
    ) {
      const empArchivesQuery = query(
        collection(db, 'closingArchives'),
        where('orgId', '==', currentOrg.id),
        where('branchId', '==', assignedBranchId)
      );
      unsubArchives = onSnapshot(
        empArchivesQuery,
        (snapshot) => {
          const loaded: ClosingArchiveRecord[] = [];
          snapshot.forEach((d) => loaded.push(d.data() as ClosingArchiveRecord));
          setClosingArchives(loaded);
        },
        (error) => {
          console.warn('Employee closing archives listener notice:', error?.message);
        }
      );
    } else {
      setClosingArchives([]);
    }

    return () => {
      unsubBranches();
      unsubClosings();
      unsubUsers();
      unsubLogs();
      unsubArchives();
    };
  }, [
    tenantStatus,
    currentOrg?.id,
    currentUser?.uid,
    userProfile?.role,
    userProfile?.isActive,
    userProfile?.orgId,
    userProfile?.branchId,
    userProfile?.branchIds?.join(','),
    JSON.stringify(userProfile?.permissions || {}),
    subscriptionEvaluation?.isAllowed,
  ]);

  // Helper to safely persist notifications without blocking primary actions,
  // without issuing pre-create getDoc (which produces permission-denied on non-existent docs),
  // and without probing feeds outside the caller's authorized scope.
  const persistNonExistingNotificationsSafely = async (items: AppNotification[]) => {
    if (!items.length) return;
    try {
      const activeAuthUser = auth.currentUser;
      const isSa = isVerifiedSuperAdmin(activeAuthUser);
      const uid = currentUser?.uid ?? activeAuthUser?.uid ?? null;

      for (const item of items) {
        await emittedThresholdTrackerRef.current.runOnce(item.id, async () => {
          if (loadedNotificationIdsRef.current.has(item.id)) {
            return 'already_exists';
          }

          const checkFeedKey = resolveAuthorizedNotificationCheckFeedKey(item, {
            uid,
            isSuperAdmin: isSa,
            userProfile,
          });

          if (checkFeedKey) {
            try {
              const checkQuery = query(
                collection(db, 'notifications'),
                where('feedKeys', 'array-contains', checkFeedKey),
                orderBy(documentId(), 'asc'),
                startAt(item.id),
                endAt(item.id),
                limit(1)
              );
              const existingSnap = await getDocs(checkQuery);
              if (!existingSnap.empty) {
                loadedNotificationIdsRef.current.add(item.id);
                return 'already_exists';
              }
            } catch (checkErr: any) {
              console.warn('Notice checking notification feed:', checkErr?.message || checkErr);
              return 'failed';
            }
          }

          const ref = doc(db, 'notifications', item.id);
          try {
            await setDoc(ref, item);
            loadedNotificationIdsRef.current.add(item.id);
            return 'persisted';
          } catch (err: any) {
            console.warn('Notice creating notification:', err?.message || err);
            return 'failed';
          }
        });
      }
    } catch (err: any) {
      console.warn('Non-fatal notification persist notice:', err?.message || err);
    }
  };

  const toggleNotificationSound = () => {
    unlockNotificationAudio();
    setNotificationSoundEnabledState((prev) => {
      const next = !prev;
      if (currentUser?.uid) {
        setNotificationSoundEnabled(currentUser.uid, next);
      }
      return next;
    });
  };

  const markNotificationAsRead = async (notificationId: string) => {
    const uid = currentUser?.uid;
    if (!uid || !notificationId) return;
    const target =
      tenantNotifications.find((n) => n.id === notificationId) ||
      superAdminNotifications.find((n) => n.id === notificationId);
    if (!target || isNotificationReadByUser(target, uid)) return;

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      [`readBy.${uid}`]: nowIso,
      updatedAt: nowIso,
    };
    if (target.audienceScope === 'user' && target.recipientUid === uid) {
      updatePayload.isRead = true;
      updatePayload.readAt = nowIso;
    }

    await updateDoc(doc(db, 'notifications', notificationId), updatePayload);
  };

  const markAllNotificationsAsRead = async (surface: 'tenant' | 'super_admin') => {
    const uid = currentUser?.uid;
    if (!uid) return;
    const sourceList = surface === 'super_admin' ? superAdminNotifications : tenantNotifications;
    const unread = sourceList.filter((n) => !isNotificationReadByUser(n, uid));
    if (unread.length === 0) return;

    const nowIso = new Date().toISOString();
    for (let i = 0; i < unread.length; i += 400) {
      const chunk = unread.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const n of chunk) {
        const updatePayload: Record<string, unknown> = {
          [`readBy.${uid}`]: nowIso,
          updatedAt: nowIso,
        };
        if (n.audienceScope === 'user' && n.recipientUid === uid) {
          updatePayload.isRead = true;
          updatePayload.readAt = nowIso;
        }
        batch.update(doc(db, 'notifications', n.id), updatePayload);
      }
      await batch.commit();
    }
  };

  const loadMoreNotifications = (surface: 'tenant' | 'super_admin') => {
    if (surface === 'super_admin') {
      saSoundControllerRef.current.markPaginationExpansion();
      setSaNotifLimit((prev) => prev + NOTIFICATION_FEED_PAGE_SIZE);
    } else {
      tenantSoundControllerRef.current.markPaginationExpansion();
      setTenantNotifLimit((prev) => prev + NOTIFICATION_FEED_PAGE_SIZE);
    }
  };

  const emitSecurityAccessDeniedAlert = async (detail: string) => {
    if (!currentUser?.uid || !currentOrg?.id || !userProfile?.isActive) return;
    const dayHourKey = new Date().toISOString().slice(0, 13);
    const notif = buildSecurityAdminNotification({
      dedupKey: `sec_denied:${currentOrg.id}:${currentUser.uid}:${dayHourKey}`,
      type: 'SECURITY_ACCESS_DENIED_ALERT',
      severity: 'critical',
      orgId: currentOrg.id,
      audienceScope: 'org_manager',
      branchId: resolvePrimaryAssignedBranchId(userProfile) || undefined,
      actorUid: currentUser.uid,
      actorName: userProfile.displayName || currentUser.email || 'مستخدم',
      actorRole: userProfile.role,
      title: 'تنبيه أمني: محاولة وصول أو إجراء مرفوض',
      body: detail,
      targetType: 'security',
      targetId: currentUser.uid,
      tab: 'audit',
    });
    await persistNonExistingNotificationsSafely([notif]);
  };

  // Real-time role-scoped Tenant Notifications listener
  useEffect(() => {
    if (
      tenantStatus !== 'active_tenant' ||
      !currentOrg?.id ||
      !currentUser?.uid ||
      !userProfile ||
      !userProfile.isActive ||
      userProfile.orgId !== currentOrg.id ||
      !subscriptionEvaluation?.isAllowed
    ) {
      setTenantNotifications([]);
      setTenantNotificationsHasMore(false);
      return;
    }

    const context = {
      surface: 'tenant' as const,
      isSuperAdmin: false,
      uid: currentUser.uid,
      userProfile,
      orgId: currentOrg.id,
    };
    const feedKeys = resolveFeedKeysForUser(context);
    if (feedKeys.length === 0) {
      setTenantNotifications([]);
      setTenantNotificationsHasMore(false);
      return;
    }

    setNotificationsLoading(true);
    const perFeedDocs = new Map<string, AppNotification[]>();
    const perFeedHasMore = new Map<string, boolean>();
    const hydratedFeeds = new Set<string>();
    const scopeKey = `tenant:${currentOrg.id}:${currentUser.uid}`;

    const syncMerged = () => {
      const all: AppNotification[] = [];
      for (const list of perFeedDocs.values()) {
        all.push(...list);
      }
      const merged = mergeAndSortNotifications(all, context);
      setTenantNotifications(merged);
      setTenantNotificationsHasMore(Array.from(perFeedHasMore.values()).some(Boolean));

      if (hydratedFeeds.size >= feedKeys.length) {
        setNotificationsLoading(false);
        const soundRes = tenantSoundControllerRef.current.processSnapshot(merged, {
          scopeKey,
          uid: currentUser.uid,
          soundEnabled: notificationSoundEnabledRef.current,
          pageLimit: tenantNotifLimit,
        });
        if (
          soundRes.reason !== 'initial_hydration' &&
          soundRes.reason !== 'pagination_hydration' &&
          soundRes.newUnreadIds.length > 0
        ) {
          const newest = merged.find((n) => n.id === soundRes.newUnreadIds[0]);
          if (newest) {
            showForegroundBrowserNotification(newest);
          }
        }
      }
    };

    const unsubs = feedKeys.map((feedKey) => {
      const q = query(
        collection(db, 'notifications'),
        where('feedKeys', 'array-contains', feedKey),
        orderBy(documentId(), 'asc'),
        limit(tenantNotifLimit)
      );
      return onSnapshot(
        q,
        (snapshot) => {
          const list: AppNotification[] = [];
          snapshot.forEach((docSnap) => {
            list.push(docSnap.data() as AppNotification);
          });
          perFeedDocs.set(feedKey, list);
          perFeedHasMore.set(feedKey, snapshot.size >= tenantNotifLimit);
          hydratedFeeds.add(feedKey);
          syncMerged();
        },
        (error) => {
          console.warn(`Tenant notifications listener notice (${feedKey}):`, error?.message);
          hydratedFeeds.add(feedKey);
          if (hydratedFeeds.size >= feedKeys.length) {
            setNotificationsLoading(false);
          }
        }
      );
    });

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [
    tenantStatus,
    currentOrg?.id,
    currentUser?.uid,
    userProfile?.role,
    userProfile?.isActive,
    userProfile?.orgId,
    userProfile?.branchId,
    userProfile?.branchIds?.join(','),
    JSON.stringify(userProfile?.permissions || {}),
    subscriptionEvaluation?.isAllowed,
    tenantNotifLimit,
  ]);

  // Proactive Org & Branch threshold warnings for active Organization Manager (idempotent daily dedupKey)
  useEffect(() => {
    if (
      tenantStatus !== 'active_tenant' ||
      !currentOrg?.id ||
      !currentUser?.uid ||
      !userProfile?.isActive ||
      userProfile.role !== 'manager' ||
      userProfile.orgId !== currentOrg.id ||
      !subscriptionEvaluation?.isAllowed
    ) {
      return;
    }
    const alerts = buildOrgThresholdNotifications({
      org: currentOrg,
      branches,
      actorUid: currentUser.uid,
      actorName: userProfile.displayName || currentUser.email || 'مدير المؤسسة',
    });
    if (alerts.length > 0) {
      void persistNonExistingNotificationsSafely(alerts);
    }
  }, [
    tenantStatus,
    currentOrg?.id,
    currentOrg?.subscriptionEndAt,
    currentOrg?.deactivationDueAt,
    branches,
    currentUser?.uid,
    userProfile?.role,
    userProfile?.isActive,
    userProfile?.orgId,
    subscriptionEvaluation?.isAllowed,
  ]);

  // Real-time Super Admin Notifications listener (strictly amoal2030@gmail.com verified + verified JWT claims only)
  useEffect(() => {
    const authUser = auth.currentUser;
    if (!currentUser?.uid || !authUser || !isVerifiedSuperAdmin(authUser)) {
      setSuperAdminNotifications([]);
      setSuperAdminNotificationsHasMore(false);
      return;
    }

    let cancelled = false;
    let unsub: (() => void) | null = null;

    const attachSuperAdminListener = async () => {
      try {
        await verifySuperAdminForRealtimeListener(authUser);
      } catch (verifyErr: any) {
        if (!cancelled) {
          setSuperAdminNotifications([]);
          setSuperAdminNotificationsHasMore(false);
          console.warn(
            'Super Admin notifications token verification notice:',
            verifyErr?.message || verifyErr
          );
        }
        return;
      }

      const latestAuthUser = auth.currentUser;
      if (
        cancelled ||
        !latestAuthUser ||
        latestAuthUser.uid !== currentUser.uid ||
        !isVerifiedSuperAdmin(latestAuthUser)
      ) {
        return;
      }

      const context = {
        surface: 'super_admin' as const,
        isSuperAdmin: true,
        uid: currentUser.uid,
      };
      const scopeKey = `super_admin:${currentUser.uid}`;
      const q = query(
        collection(db, 'notifications'),
        where('feedKeys', 'array-contains', 'super_admin'),
        orderBy(documentId(), 'asc'),
        limit(saNotifLimit)
      );

      unsub = onSnapshot(
        q,
        (snapshot) => {
          if (cancelled) return;
          const raw: AppNotification[] = [];
          snapshot.forEach((docSnap) => {
            raw.push(docSnap.data() as AppNotification);
          });
          const merged = mergeAndSortNotifications(raw, context);
          setSuperAdminNotifications(merged);
          setSuperAdminNotificationsHasMore(snapshot.size >= saNotifLimit);
          const soundRes = saSoundControllerRef.current.processSnapshot(merged, {
            scopeKey,
            uid: currentUser.uid,
            soundEnabled: notificationSoundEnabledRef.current,
            pageLimit: saNotifLimit,
          });
          if (
            soundRes.reason !== 'initial_hydration' &&
            soundRes.reason !== 'pagination_hydration' &&
            soundRes.newUnreadIds.length > 0
          ) {
            const newest = merged.find((n) => n.id === soundRes.newUnreadIds[0]);
            if (newest) {
              showForegroundBrowserNotification(newest);
            }
          }
        },
        (error) => {
          console.warn('Super Admin notifications listener notice:', error?.message);
        }
      );
    };

    void attachSuperAdminListener();

    return () => {
      cancelled = true;
      if (unsub) {
        unsub();
        unsub = null;
      }
    };
  }, [currentUser?.uid, currentUser?.email, currentUser?.emailVerified, saNotifLimit]);

  const loadBranchesForOrg = async (orgId: string, profile: UserProfile) => {
    const branchesRef = collection(db, 'branches');
    const q = query(branchesRef, where('orgId', '==', orgId));
    const branchesSnap = await getDocs(q);
    const loadedBranches: Branch[] = [];
    branchesSnap.forEach((b) => loadedBranches.push({ ...(b.data() as Branch), id: b.id }));
    setBranches(loadedBranches);

    const assignedBranchId = resolvePrimaryAssignedBranchId(profile);
    if ((profile.role === 'employee' || profile.role === 'branch_manager') && assignedBranchId) {
      const assigned = loadedBranches.find((b) => b.id === assignedBranchId);
      setCurrentBranch(assigned || loadedBranches[0] || null);
    } else {
      setCurrentBranch(loadedBranches[0] || null);
    }
  };

  const performLoadUserData = async (fbUser: FirebaseUser) => {
    setLoading(true);
    setNeedsOnboarding(false);
    try {
      // Ensure the Firebase Auth ID token is ready right after sign-in or password reset
      await fbUser.getIdToken().catch(() => undefined);
      if (activeUserUidRef.current !== fbUser.uid) return;

      const userDocRef = doc(db, 'users', fbUser.uid);
      const userDocSnap = await fetchFirestoreDocWithFreshServerCheck(
        () => getDocFromServer(userDocRef),
        () => getDoc(userDocRef)
      );

      if (activeUserUidRef.current !== fbUser.uid) return;

      const bindingResult = validateLoadedUserProfileBinding({
        authUid: fbUser.uid,
        docId: userDocSnap.id,
        docExists: userDocSnap.exists(),
        rawProfile: userDocSnap.exists() ? (userDocSnap.data() as UserProfile) : null,
      });

      if (bindingResult.status === 'uid_mismatch') {
        const rawUserData = userDocSnap.exists() ? (userDocSnap.data() as UserProfile) : null;
        console.warn(
          '[AL EQFAL Auth Diagnostic] Strict Auth UID binding mismatch on users/{uid} (not auto-repaired):',
          {
            authUid: fbUser.uid,
            docId: userDocSnap.id,
            storedUid: rawUserData?.uid,
            reason: bindingResult.reason,
          }
        );
        clearDriveSession();
        clearOperationalState();
        setUserProfile(null);
        setCurrentOrg(null);
        setSubscriptionEvaluation(null);
        setSubscriptionBlockReason(null);
        setInviteBlockInfo(null);
        setAccessErrorInfo({ reason: bindingResult.reason });
        setTenantStatus('access_error');
        setLoading(false);
        return;
      }

      if (bindingResult.status === 'valid') {
        const profile: UserProfile = bindingResult.profile;

        // Read-only email mismatch diagnostic (never auto-syncs Firestore)
        const detectedMismatch = detectAuthProfileEmailMismatch({
          uid: fbUser.uid,
          authEmail: fbUser.email,
          profileEmail: profile.email,
        });
        setAuthEmailMismatch(detectedMismatch);
        if (detectedMismatch) {
          console.warn(
            '[AL EQFAL Auth Diagnostic] Auth/Firestore email mismatch detected (not auto-synced):',
            detectedMismatch
          );
        }

        const membershipStatus = resolveMemberMembershipStatus(profile);

        // Permanently released member: show dedicated clear notice without signing out or leaking any tenant data
        if (membershipStatus === 'released') {
          clearDriveSession();
          clearOperationalState();
          setUserProfile(null);
          setCurrentOrg(null);
          setSubscriptionEvaluation(null);
          setSubscriptionBlockReason(null);
          setInviteBlockInfo(null);
          setAccessErrorInfo({ reason: 'membership_released' });
          setTenantStatus('access_error');
          setLoading(false);
          return;
        }

        // Temporarily archived member: keep auth session separate from org access denial; load zero org data
        if (membershipStatus === 'archived') {
          clearDriveSession();
          clearOperationalState();
          setUserProfile(null);
          setCurrentOrg(null);
          setSubscriptionEvaluation(null);
          setSubscriptionBlockReason(null);
          setInviteBlockInfo(null);
          setAccessErrorInfo({ reason: 'account_archived' });
          setTenantStatus('access_error');
          setLoading(false);
          return;
        }

        // Disabled user enforcement (both Manager and Employee): separate auth success from access denial without loading org data
        if (profile.isActive === false) {
          clearDriveSession();
          clearOperationalState();
          setUserProfile(null);
          setCurrentOrg(null);
          setSubscriptionEvaluation(null);
          setSubscriptionBlockReason(null);
          setInviteBlockInfo(null);
          setAccessErrorInfo({ reason: 'account_disabled' });
          setTenantStatus('access_error');
          setLoading(false);
          return;
        }

        if (activeOrgIdRef.current && activeOrgIdRef.current !== profile.orgId) {
          clearDriveSession(activeOrgIdRef.current);
          clearOperationalState();
        }

        let orgData: Organization | null = null;
        if (profile.orgId) {
          const orgDocRef = doc(db, 'organizations', profile.orgId);
          const orgSnap = await fetchFirestoreDocWithFreshServerCheck(
            () => getDocFromServer(orgDocRef),
            () => getDoc(orgDocRef)
          );
          if (activeUserUidRef.current !== fbUser.uid) return;
          if (orgSnap.exists()) {
            orgData = { ...(orgSnap.data() as Organization), id: orgSnap.id };
          }
        }

        const resolved = resolveProfiledUserAccess({
          profile,
          org: orgData,
          authUid: fbUser.uid,
        });

        if (resolved.status === 'access_error') {
          clearDriveSession();
          clearOperationalState();
          setUserProfile(null);
          setCurrentOrg(null);
          setSubscriptionEvaluation(null);
          setSubscriptionBlockReason(null);
          setInviteBlockInfo(null);
          setAccessErrorInfo({ reason: resolved.errorReason });
          setTenantStatus('access_error');
          return;
        }

        if (resolved.status === 'subscription_blocked') {
          clearOperationalState();
          setUserProfile(resolved.profile);
          setCurrentOrg(resolved.org);
          setSubscriptionEvaluation(resolved.subscriptionEvaluation);
          setSubscriptionBlockReason(resolved.blockReason);
          setInviteBlockInfo(null);
          setAccessErrorInfo(null);
          setTenantStatus('subscription_blocked');
          return;
        }

        // Active tenant (active subscription or legacy_unrestricted): safe to load branches
        setUserProfile(resolved.profile);
        setCurrentOrg(resolved.org);
        setSubscriptionEvaluation(resolved.subscriptionEvaluation);
        setSubscriptionBlockReason(null);
        setInviteBlockInfo(null);
        setAccessErrorInfo(null);

        await loadBranchesForOrg(resolved.org.id, resolved.profile);
        if (activeUserUidRef.current !== fbUser.uid) return;

        setTenantStatus('active_tenant');
        return;
      }

      // User has NO document in users/{uid} yet
      clearDriveSession();
      clearOperationalState();
      setUserProfile(null);
      setCurrentOrg(null);
      setSubscriptionEvaluation(null);
      setSubscriptionBlockReason(null);

      const emailLower = normalizeEmail(fbUser.email);
      const isGoogle = isGoogleProviderUser(fbUser);
      const isVerified = fbUser.emailVerified === true;

      // Guard before querying managerInvites (non-Google or unverified users never query managerInvites)
      if (!isGoogle || !isVerified || !isValidNormalizedEmailDocId(emailLower)) {
        const preCheck = resolveUnprofiledUserAccess({
          uid: fbUser.uid,
          isGoogleUser: isGoogle,
          isVerifiedEmail: isVerified,
          emailLower,
          invite: null,
          inviteOrg: null,
        });
        setInviteBlockInfo(null);
        setAccessErrorInfo({
          reason: preCheck.status === 'access_error' ? preCheck.errorReason : 'email_not_verified',
        });
        setTenantStatus('access_error');
        return;
      }

      let inviteSnap;
      try {
        inviteSnap = await getDoc(doc(db, 'managerInvites', emailLower));
      } catch (inviteErr: any) {
        if (isVerifiedSuperAdmin(fbUser) && isPermissionDeniedError(inviteErr)) {
          if (activeUserUidRef.current !== fbUser.uid) return;
          setInviteBlockInfo(null);
          setAccessErrorInfo(null);
          setTenantStatus('subscription_request_required');
          return;
        }
        throw inviteErr;
      }
      if (activeUserUidRef.current !== fbUser.uid) return;

      if (!inviteSnap.exists()) {
        setInviteBlockInfo(null);
        setAccessErrorInfo(null);
        setTenantStatus('subscription_request_required');
        return;
      }

      const inviteData = inviteSnap.data() as ManagerInvite;
      let inviteOrg: Organization | null = null;

      if (
        inviteData.status === 'pending' &&
        inviteData.role === 'manager' &&
        normalizeEmail(inviteData.emailNormalized) === emailLower &&
        inviteData.orgId
      ) {
        try {
          const orgSnap = await getDoc(doc(db, 'organizations', inviteData.orgId));
          if (activeUserUidRef.current !== fbUser.uid) return;
          if (orgSnap.exists()) {
            inviteOrg = orgSnap.data() as Organization;
          }
        } catch (orgErr: any) {
          if (evaluateFirestoreErrorCategory(orgErr) === 'network_error') {
            throw orgErr;
          }
          // permission-denied on org read means ownerEmail/org binding does not match
          inviteOrg = null;
        }
      }

      const unprofiled = resolveUnprofiledUserAccess({
        uid: fbUser.uid,
        isGoogleUser: isGoogle,
        isVerifiedEmail: isVerified,
        emailLower,
        invite: inviteData,
        inviteOrg,
      });

      if (unprofiled.status === 'invite_blocked') {
        setAccessErrorInfo(null);
        setInviteBlockInfo({
          reason: unprofiled.inviteBlockReason,
          email: inviteData.email,
          orgName: inviteData.orgName,
        });
        setTenantStatus('invite_blocked');
        return;
      }

      if (unprofiled.status === 'subscription_blocked') {
        setInviteBlockInfo(null);
        setAccessErrorInfo(null);
        setCurrentOrg(unprofiled.org);
        setSubscriptionEvaluation(unprofiled.subscriptionEvaluation);
        setSubscriptionBlockReason(unprofiled.blockReason);
        setTenantStatus('subscription_blocked');
        return;
      }

      if (unprofiled.status === 'access_error') {
        setInviteBlockInfo(null);
        setAccessErrorInfo({ reason: unprofiled.errorReason });
        setTenantStatus('access_error');
        return;
      }

      if (unprofiled.status === 'ready_to_claim_invite') {
        if (inviteClaimLockRef.current === fbUser.uid) {
          return;
        }
        inviteClaimLockRef.current = fbUser.uid;
        try {
          const payloads = buildAtomicInviteClaimPayloads({
            uid: fbUser.uid,
            email: fbUser.email || emailLower,
            googleDisplayName: fbUser.displayName,
            org: unprofiled.org,
            invite: unprofiled.invite,
            serverTimestampValue: serverTimestamp(),
          });

          const batch = writeBatch(db);
          batch.update(doc(db, 'managerInvites', payloads.inviteDocId), payloads.inviteUpdate);
          batch.update(doc(db, 'organizations', payloads.orgId), payloads.orgUpdate);
          batch.set(doc(db, 'users', payloads.userDocId), payloads.userDoc);
          batch.set(doc(db, 'auditLogs', payloads.auditLogId), payloads.auditLog);

          await batch.commit();

          if (activeUserUidRef.current !== fbUser.uid) return;

          const claimedOrg: Organization = {
            ...unprofiled.org,
            ownerId: payloads.orgUpdate.ownerId,
            ownerName: payloads.orgUpdate.ownerName,
            updatedAt: payloads.orgUpdate.updatedAt,
          };

          setUserProfile(payloads.userDoc);
          setCurrentOrg(claimedOrg);
          setSubscriptionEvaluation(unprofiled.subscriptionEvaluation);
          setSubscriptionBlockReason(null);
          setInviteBlockInfo(null);
          setAccessErrorInfo(null);

          await loadBranchesForOrg(claimedOrg.id, payloads.userDoc);
          if (activeUserUidRef.current !== fbUser.uid) return;

          setTenantStatus('active_tenant');
        } finally {
          if (inviteClaimLockRef.current === fbUser.uid) {
            inviteClaimLockRef.current = null;
          }
        }
      }
    } catch (error: any) {
      console.warn('Notice loading user tenant data:', error?.message || error);
      const errCategory = evaluateFirestoreErrorCategory(error);
      clearOperationalState();
      setUserProfile(null);
      setCurrentOrg(null);
      setSubscriptionEvaluation(null);
      setSubscriptionBlockReason(null);
      setInviteBlockInfo(null);
      setNeedsOnboarding(false);
      setAccessErrorInfo({
        reason: errCategory,
        detail: error?.message,
      });
      setTenantStatus('access_error');

      if (errCategory === 'permission_denied') {
        setAuthNotice({
          type: 'error',
          message: 'تم رفض الوصول الأمني للبيانات (Permission Denied). يرجى مراجعة إدارة النظام.',
        });
      } else {
        setAuthNotice({
          type: 'warning',
          message: 'تعذر الاتصال بقاعدة البيانات مؤقتاً. يرجى التحقق من اتصال الإنترنت.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const loadUserData = async (fbUser: FirebaseUser) => {
    if (loadInFlightRef.current && loadInFlightRef.current.uid === fbUser.uid) {
      return loadInFlightRef.current.promise;
    }
    const promise = performLoadUserData(fbUser).finally(() => {
      if (loadInFlightRef.current?.promise === promise) {
        loadInFlightRef.current = null;
      }
    });
    loadInFlightRef.current = { uid: fbUser.uid, promise };
    return promise;
  };

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.warn('Google sign-in attempt warning:', error?.code, error?.message);
      if (error?.code === 'auth/popup-blocked') {
        console.info('Popup was blocked by mobile browser. Falling back to signInWithRedirect...');
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr) {
          console.error('Redirect sign-in error:', redirectErr);
          throw redirectErr;
        }
      }
      throw error;
    }
  };

  const loginWithEmailPassword = async (email: string, pass: string) => {
    try {
      const creds = prepareLoginCredentials(email, pass);
      await signInWithEmailAndPassword(auth, creds.email, creds.password);
    } catch (error: any) {
      console.error('Email sign-in error:', error);
      throw error;
    }
  };

  const applyPreferredAuthLanguage = () => {
    const docLang =
      typeof document !== 'undefined' ? document.documentElement?.lang?.toLowerCase() : null;
    syncAuthLanguageCode(auth, docLang);
  };

  const resetPassword = async (email: string) => {
    try {
      applyPreferredAuthLanguage();
      await sendPasswordResetEmail(auth, normalizeLoginEmail(email));
    } catch (error: any) {
      console.error('Reset password error:', error);
      throw error;
    }
  };

  const completeOrganizationSetup = async () => {
    throw new Error(
      'تم إيقاف التأسيس الذاتي للمؤسسات؛ يتطلب التأسيس دعوة مدير معتمدة واشتراكاً نشطاً من إدارة النظام.'
    );
  };

  const addBranch = async (_data: {
    name: string;
    address?: string;
    phone?: string;
    code?: string;
  }): Promise<Branch> => {
    throw new Error(
      'إضافة الفروع الجديدة مقتصرة حصراً على المدير الرئيسي للنظام (amoal2030@gmail.com). يرجى تقديم طلب إضافة فرع عبر الدعم.'
    );
  };

  const createEmployeeAccount = async (data: {
    email: string;
    password: string;
    displayName: string;
    role?: 'employee' | 'branch_manager' | 'supervisor';
    branchId?: string;
    branchName?: string;
    phone?: string;
    supervisorPermissions?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
    branchManagerPermissions?: BranchManagerOptionalPermissions;
  }): Promise<UserProfile> => {
    if (!currentOrg || !userProfile || userProfile.role !== 'manager' || !userProfile.isActive) {
      throw new Error('إدارة حسابات الموظفين والأدوار مقتصرة على مدير المؤسسة النشط فقط.');
    }

    const targetRole: 'employee' | 'branch_manager' | 'supervisor' =
      data.role === 'supervisor' || data.role === 'branch_manager' ? data.role : 'employee';

    const cleanName = data.displayName.trim();
    const cleanEmail = normalizeLoginEmail(data.email);
    if (!cleanName || cleanName.length > 100) {
      throw new Error('يرجى إدخال اسم موظف صحيح (1 إلى 100 حرف).');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('صيغة البريد الإلكتروني غير صحيحة.');
    }
    if (typeof data.password !== 'string' || data.password.length < 6) {
      throw new Error('يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.');
    }

    const assignmentCheck = validateRoleAssignmentInput({
      actorRole: userProfile.role,
      targetRole,
      branchId: data.branchId,
      branchIds: targetRole === 'branch_manager' && data.branchId ? [data.branchId] : undefined,
    });
    if (!assignmentCheck.valid) {
      throw new Error(assignmentCheck.error);
    }

    const targetBranch =
      targetRole === 'supervisor'
        ? undefined
        : branches.find((b) => b.id === assignmentCheck.assignedBranchId && b.orgId === currentOrg.id);
    if (targetRole !== 'supervisor' && !targetBranch) {
      throw new Error('الفرع المحدد غير موجود أو لا يتبع للمؤسسة الحالية.');
    }

    const safeActorName =
      userProfile.displayName && userProfile.displayName.trim().length >= 2
        ? userProfile.displayName.trim().slice(0, 100)
        : currentUser?.email || 'المدير العام';

    const canonicalPermissions = buildDefaultPermissionsForRole(
      targetRole,
      targetRole === 'supervisor' ? data.supervisorPermissions : undefined,
      targetRole === 'branch_manager' ? data.branchManagerPermissions : undefined
    );

    const secondaryAuth = getSecondaryAuth();
    try {
      const userCredential = await createUserWithEmailAndPassword(
        secondaryAuth,
        cleanEmail,
        data.password
      );

      const newUid = userCredential.user.uid;
      const nowIso = new Date().toISOString();

      const newProfile: UserProfile = {
        uid: newUid,
        orgId: currentOrg.id,
        email: cleanEmail,
        displayName: cleanName,
        role: targetRole,
        ...(targetBranch ? { branchId: targetBranch.id, branchName: targetBranch.name || data.branchName || '' } : {}),
        ...(targetRole === 'branch_manager' && targetBranch ? { branchIds: [targetBranch.id] } : {}),
        phone: data.phone?.trim().slice(0, 25) || '',
        isActive: true,
        isArchived: false,
        membershipStatus: 'active',
        permissions: canonicalPermissions,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const auditLogRef = doc(db, 'auditLogs', logId);

      const roleAr =
        targetRole === 'supervisor'
          ? 'مسؤول'
          : targetRole === 'branch_manager'
          ? 'مسؤول فرع'
          : 'موظف';

      const batch = writeBatch(db);
      batch.set(doc(db, 'users', newUid), newProfile);
      batch.set(auditLogRef, {
        id: logId,
        orgId: currentOrg.id,
        actorId: userProfile.uid,
        actorName: safeActorName,
        actorRole: 'manager',
        action: 'EMPLOYEE_PROVISIONED',
        targetType: 'employee',
        targetId: newUid,
        details: `تم إنشاء حساب ${roleAr} جديد: ${newProfile.displayName} (${newProfile.email})${
          targetBranch ? ` على فرع ${targetBranch.name}` : ' (نطاق المؤسسة)'
        }`,
        timestamp: nowIso,
      });

      const empNotifs = buildEmployeeLifecycleNotifications({
        action: 'created',
        orgId: currentOrg.id,
        actorUid: userProfile.uid,
        actorName: safeActorName,
        employeeUid: newUid,
        employeeName: newProfile.displayName,
        employeeRole: targetRole,
        branchId: targetBranch?.id,
        branchName: targetBranch?.name || data.branchName,
        createdAt: nowIso,
      });
      empNotifs.forEach((n) => batch.set(doc(db, 'notifications', n.id), n));

      await batch.commit();
      await signOut(secondaryAuth);
      return newProfile;
    } catch (error: any) {
      console.error('Error provisioning employee:', error);
      try {
        await signOut(secondaryAuth);
      } catch {
        // ignore
      }
      if (error?.code === 'auth/email-already-in-use') {
        throw new Error(
          'هذا البريد الإلكتروني مسجل مسبقاً في المنصة (قد يكون مرتبطاً بمؤسسة أخرى أو مؤرشفاً لديها). لا يمكن إضافته مباشرة؛ يرجى التواصل مع إدارة المنصة لفصل عضويته نهائياً من مؤسسته السابقة وإعادة ربطه بمؤسستكم.'
        );
      }
      throw error;
    }
  };

  const toggleEmployeeStatus = async (employeeUid: string, isActive: boolean) => {
    if (!currentOrg || userProfile?.role !== 'manager' || !userProfile.isActive) {
      throw new Error('تعديل حالة حسابات الموظفين مقتصر على مدير المؤسسة النشط فقط.');
    }
    if (employeeUid === userProfile.uid) {
      throw new Error('لا يمكن تعطيل حساب مدير المؤسسة من هذه الشاشة.');
    }

    const targetEmployee = employees.find((e) => e.uid === employeeUid);
    if (
      targetEmployee &&
      (targetEmployee.orgId !== currentOrg.id ||
        targetEmployee.role === 'manager' ||
        resolveMemberMembershipStatus(targetEmployee) === 'released')
    ) {
      throw new Error('لا يمكن تعديل حساب خارج المؤسسة أو محرر نهائياً أو حساب مدير المؤسسة.');
    }

    const safeActorName =
      userProfile.displayName && userProfile.displayName.trim().length >= 2
        ? userProfile.displayName.trim().slice(0, 100)
        : currentUser?.email || 'المدير العام';

    const nowIso = new Date().toISOString();
    const userRef = doc(db, 'users', employeeUid);
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const logRef = doc(db, 'auditLogs', logId);

    const statusUpdatePayload: Record<string, any> = {
      isActive,
      updatedAt: nowIso,
    };
    if (isActive) {
      statusUpdatePayload.isArchived = false;
      statusUpdatePayload.membershipStatus = 'active';
      statusUpdatePayload.archivedAt = deleteField();
      statusUpdatePayload.archivedBy = deleteField();
    }

    const targetLabel = targetEmployee?.displayName || employeeUid;
    const batch = writeBatch(db);
    batch.update(userRef, statusUpdatePayload);
    batch.set(logRef, {
      id: logId,
      orgId: currentOrg.id,
      actorId: userProfile.uid,
      actorName: safeActorName,
      actorRole: 'manager',
      action: isActive ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DISABLED',
      targetType: 'employee',
      targetId: employeeUid,
      details: `${isActive ? 'تنشيط' : 'تعطيل'} حساب الموظف ${targetLabel}`,
      timestamp: nowIso,
    });

    const statusNotifs = buildEmployeeLifecycleNotifications({
      action: isActive ? 'reactivated' : 'disabled',
      orgId: currentOrg.id,
      actorUid: userProfile.uid,
      actorName: safeActorName,
      employeeUid,
      employeeName: targetLabel,
      employeeRole: targetEmployee?.role || 'employee',
      branchId: targetEmployee?.branchId,
      branchName: targetEmployee?.branchName,
      createdAt: nowIso,
    });
    statusNotifs.forEach((n) => batch.set(doc(db, 'notifications', n.id), n));

    await batch.commit();
  };

  const updateEmployeeBranch = async (employeeUid: string, branchId: string, branchName: string) => {
    if (!currentOrg || userProfile?.role !== 'manager' || !userProfile.isActive) {
      throw new Error('نقل الموظف بين الفروع مقتصر على مدير المؤسسة النشط فقط.');
    }

    const targetBranch = branches.find((b) => b.id === branchId && b.orgId === currentOrg.id);
    if (!targetBranch) {
      throw new Error('الفرع المحدد غير موجود أو لا يتبع للمؤسسة الحالية.');
    }

    const targetEmployee = employees.find((e) => e.uid === employeeUid);
    if (targetEmployee && targetEmployee.orgId !== currentOrg.id) {
      throw new Error('لا يمكن تعديل موظف يتبع لمؤسسة أخرى.');
    }
    if (targetEmployee?.role === 'manager' || targetEmployee?.role === 'supervisor') {
      throw new Error('هذا الدور يعمل على مستوى المؤسسة ولا يرتبط بفرع واحد.');
    }
    if (targetEmployee && targetEmployee.branchId === targetBranch.id) {
      return;
    }

    const safeActorName =
      userProfile.displayName && userProfile.displayName.trim().length >= 2
        ? userProfile.displayName.trim().slice(0, 100)
        : currentUser?.email || 'المدير العام';

    const resolvedBranchName = targetBranch.name || branchName;
    const nowIso = new Date().toISOString();
    const userRef = doc(db, 'users', employeeUid);
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const logRef = doc(db, 'auditLogs', logId);

    const userUpdatePayload: Record<string, any> = {
      branchId: targetBranch.id,
      branchName: resolvedBranchName,
      updatedAt: nowIso,
    };
    if (targetEmployee?.role === 'branch_manager') {
      userUpdatePayload.branchIds = [targetBranch.id];
    } else {
      userUpdatePayload.branchIds = deleteField();
    }

    const batch = writeBatch(db);
    batch.update(userRef, userUpdatePayload);
    batch.set(logRef, {
      id: logId,
      orgId: currentOrg.id,
      actorId: userProfile.uid,
      actorName: safeActorName,
      actorRole: 'manager',
      action: 'EMPLOYEE_BRANCH_CHANGED',
      targetType: 'employee',
      targetId: employeeUid,
      details: `نقل الموظف ${targetEmployee?.displayName || employeeUid} إلى فرع ${resolvedBranchName}`,
      timestamp: nowIso,
    });

    const branchNotifs = buildEmployeeLifecycleNotifications({
      action: 'branch_changed',
      orgId: currentOrg.id,
      actorUid: userProfile.uid,
      actorName: safeActorName,
      employeeUid,
      employeeName: targetEmployee?.displayName || employeeUid,
      employeeRole: targetEmployee?.role || 'employee',
      branchId: targetBranch.id,
      branchName: resolvedBranchName,
      createdAt: nowIso,
    });
    branchNotifs.forEach((n) => batch.set(doc(db, 'notifications', n.id), n));

    await batch.commit();
  };

  const updateEmployeeAccount: AuthContextType['updateEmployeeAccount'] = async (data) => {
    if (!currentOrg || !userProfile || userProfile.role !== 'manager' || !userProfile.isActive) {
      throw new Error('تحديث بيانات الموظفين والأدوار مقتصر على مدير المؤسسة النشط فقط.');
    }
    if (data.employeeUid === userProfile.uid) {
      throw new Error('لا يمكن تعديل دور أو صلاحيات مدير المؤسسة.');
    }

    const userRef = doc(db, 'users', data.employeeUid);
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      throw new Error('حساب الموظف غير موجود في قاعدة البيانات.');
    }
    const prevProfile = existingSnap.data() as UserProfile;
    if (
      prevProfile.orgId !== currentOrg.id ||
      resolveMemberMembershipStatus(prevProfile) === 'released'
    ) {
      throw new Error('لا يمكن تعديل حساب يتبع لمؤسسة أخرى أو تم فصل عضويته نهائياً.');
    }
    if (prevProfile.role === 'manager') {
      throw new Error('لا يمكن تعديل حساب مدير المؤسسة من إدارة الموظفين.');
    }

    // Strictly prevent independent Firestore email mutation without an authoritative Firebase Auth update
    assertProfileEmailImmutableOnEmployeeUpdate(prevProfile.email, data.email);

    const cleanName = data.displayName.trim();
    const cleanPhone = (data.phone || '').trim().slice(0, 25);
    if (!cleanName || cleanName.length > 100) {
      throw new Error('يرجى إدخال اسم موظف صحيح (1 إلى 100 حرف).');
    }

    const assignmentCheck = validateRoleAssignmentInput({
      actorRole: userProfile.role,
      targetRole: data.role,
      branchId: data.branchId,
      branchIds: data.role === 'branch_manager' && data.branchId ? [data.branchId] : undefined,
    });
    if (!assignmentCheck.valid) {
      throw new Error(assignmentCheck.error);
    }

    const targetBranch =
      data.role === 'supervisor'
        ? undefined
        : branches.find((b) => b.id === assignmentCheck.assignedBranchId && b.orgId === currentOrg.id);
    if (data.role !== 'supervisor' && !targetBranch) {
      throw new Error('الفرع المحدد غير موجود أو لا يتبع للمؤسسة الحالية.');
    }

    const nextPermissions = buildDefaultPermissionsForRole(
      data.role,
      data.role === 'supervisor' ? data.supervisorPermissions : undefined,
      data.role === 'branch_manager' ? data.branchManagerPermissions : undefined
    );

    const safeActorName =
      userProfile.displayName && userProfile.displayName.trim().length >= 2
        ? userProfile.displayName.trim().slice(0, 100)
        : currentUser?.email || 'المدير العام';

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      displayName: cleanName,
      phone: cleanPhone,
      role: data.role,
      permissions: nextPermissions,
      updatedAt: nowIso,
    };

    if (data.role === 'supervisor') {
      updatePayload.branchId = deleteField();
      updatePayload.branchIds = deleteField();
      updatePayload.branchName = deleteField();
    } else if (targetBranch) {
      updatePayload.branchId = targetBranch.id;
      updatePayload.branchName = targetBranch.name;
      updatePayload.branchIds =
        data.role === 'branch_manager' ? [targetBranch.id] : deleteField();
    }

    const roleOrPermsChanged =
      prevProfile.role !== data.role ||
      JSON.stringify(prevProfile.permissions || {}) !== JSON.stringify(nextPermissions);
    const branchChanged =
      data.role !== 'supervisor' &&
      targetBranch &&
      (prevProfile.branchId || '') !== targetBranch.id;

    let auditAction = 'EMPLOYEE_UPDATED';
    if (roleOrPermsChanged) {
      auditAction = 'EMPLOYEE_ROLE_PERMISSIONS_UPDATED';
    } else if (branchChanged) {
      auditAction = 'EMPLOYEE_BRANCH_CHANGED';
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const logRef = doc(db, 'auditLogs', logId);

    const roleLabels: Record<'employee' | 'branch_manager' | 'supervisor', string> = {
      employee: 'موظف',
      branch_manager: 'مسؤول فرع',
      supervisor: 'مسؤول',
    };

    const batch = writeBatch(db);
    batch.update(userRef, updatePayload);
    batch.set(logRef, {
      id: logId,
      orgId: currentOrg.id,
      actorId: userProfile.uid,
      actorName: safeActorName,
      actorRole: 'manager',
      action: auditAction,
      targetType: 'employee',
      targetId: data.employeeUid,
      details: `تحديث بيانات وصلاحيات ${cleanName} (${roleLabels[data.role]}${
        targetBranch ? ` - فرع ${targetBranch.name}` : ' - على مستوى المؤسسة'
      })`,
      timestamp: nowIso,
    });

    if (roleOrPermsChanged || branchChanged) {
      const updateNotifs = buildEmployeeLifecycleNotifications({
        action: roleOrPermsChanged ? 'role_permissions_updated' : 'branch_changed',
        orgId: currentOrg.id,
        actorUid: userProfile.uid,
        actorName: safeActorName,
        employeeUid: data.employeeUid,
        employeeName: cleanName,
        employeeRole: data.role,
        branchId: targetBranch?.id,
        branchName: targetBranch?.name,
        createdAt: nowIso,
      });
      updateNotifs.forEach((n) => batch.set(doc(db, 'notifications', n.id), n));
    }

    await batch.commit();
  };

  const archiveEmployeeAccount: AuthContextType['archiveEmployeeAccount'] = async (
    employeeUid,
    reason
  ) => {
    if (!currentOrg || !userProfile || userProfile.role !== 'manager' || !userProfile.isActive) {
      throw new Error('أرشفة حسابات الموظفين مقتصرة على مدير المؤسسة النشط فقط.');
    }
    if (employeeUid === userProfile.uid) {
      throw new Error('لا يمكن أرشفة حساب مدير المؤسسة.');
    }

    const userRef = doc(db, 'users', employeeUid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      throw new Error('حساب الموظف غير موجود.');
    }
    const target = snap.data() as UserProfile;
    if (
      target.orgId !== currentOrg.id ||
      target.role === 'manager' ||
      resolveMemberMembershipStatus(target) === 'released'
    ) {
      throw new Error('لا يمكن أرشفة حساب خارج المؤسسة أو محرر نهائياً أو حساب مدير المؤسسة.');
    }

    const safeActorName =
      userProfile.displayName && userProfile.displayName.trim().length >= 2
        ? userProfile.displayName.trim().slice(0, 100)
        : currentUser?.email || 'المدير العام';

    const nowIso = new Date().toISOString();
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const logRef = doc(db, 'auditLogs', logId);

    const cleanReason = reason?.trim() ? ` السبب: ${reason.trim().slice(0, 200)}` : '';
    const batch = writeBatch(db);
    batch.update(userRef, {
      isActive: false,
      isArchived: true,
      membershipStatus: 'archived',
      archivedAt: nowIso,
      archivedBy: userProfile.uid,
      updatedAt: nowIso,
    });
    batch.set(logRef, {
      id: logId,
      orgId: currentOrg.id,
      actorId: userProfile.uid,
      actorName: safeActorName,
      actorRole: 'manager',
      action: 'EMPLOYEE_ARCHIVED',
      targetType: 'employee',
      targetId: employeeUid,
      details: `أرشفة وإيقاف حساب ${target.displayName} (${target.email}) مع الإبقاء التام على جميع الإقفالات والسجلات المالية السابقة.${cleanReason}`,
      timestamp: nowIso,
    });

    const archiveNotifs = buildEmployeeLifecycleNotifications({
      action: 'archived',
      orgId: currentOrg.id,
      actorUid: userProfile.uid,
      actorName: safeActorName,
      employeeUid,
      employeeName: target.displayName,
      employeeRole: target.role,
      branchId: target.branchId,
      branchName: target.branchName,
      createdAt: nowIso,
    });
    archiveNotifs.forEach((n) => batch.set(doc(db, 'notifications', n.id), n));

    await batch.commit();
  };

  const sendEmployeePasswordReset: AuthContextType['sendEmployeePasswordReset'] = async (
    employeeUid
  ) => {
    if (!currentOrg || !userProfile || userProfile.role !== 'manager' || !userProfile.isActive) {
      throw new Error('إرسال رابط إعادة تعيين كلمة المرور مقتصر على مدير المؤسسة النشط فقط.');
    }

    const targetEmployee =
      employees.find((e) => e.uid === employeeUid) ||
      ((await getDoc(doc(db, 'users', employeeUid))).data() as UserProfile | undefined);

    if (!targetEmployee || targetEmployee.orgId !== currentOrg.id) {
      throw new Error('الموظف غير موجود أو لا يتبع للمؤسسة الحالية.');
    }
    if (targetEmployee.role === 'manager') {
      throw new Error('لا يمكن إرسال رابط استعادة لمدير المؤسسة من قائمة الموظفين.');
    }
    const cleanEmail = normalizeLoginEmail(targetEmployee.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('لا يملك هذا الموظف بريداً إلكترونياً صالحاً لاستلام الرابط.');
    }

    applyPreferredAuthLanguage();
    await sendPasswordResetEmail(auth, cleanEmail);

    const safeActorName =
      userProfile.displayName && userProfile.displayName.trim().length >= 2
        ? userProfile.displayName.trim().slice(0, 100)
        : currentUser?.email || 'المدير العام';
    const nowIso = new Date().toISOString();
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const resetBatch = writeBatch(db);
    resetBatch.set(doc(db, 'auditLogs', logId), {
      id: logId,
      orgId: currentOrg.id,
      actorId: userProfile.uid,
      actorName: safeActorName,
      actorRole: 'manager',
      action: 'EMPLOYEE_PASSWORD_RESET_SENT',
      targetType: 'employee',
      targetId: employeeUid,
      details: `إرسال رابط إعادة تعيين كلمة المرور عبر Firebase إلى ${targetEmployee.displayName} (${cleanEmail})`,
      timestamp: nowIso,
    });
    const resetNotifMgr = buildSecurityAdminNotification({
      dedupKey: `pwd_reset_mgr:${currentOrg.id}:${employeeUid}:${nowIso}`,
      type: 'SECURITY_PASSWORD_RESET_SENT',
      severity: 'info',
      orgId: currentOrg.id,
      audienceScope: 'org_manager',
      branchId: targetEmployee.branchId,
      actorUid: userProfile.uid,
      actorName: safeActorName,
      actorRole: 'manager',
      title: 'إرسال رابط إعادة تعيين كلمة مرور',
      body: `تم إرسال رابط استعادة كلمة المرور عبر Firebase إلى ${targetEmployee.displayName} (${cleanEmail}).`,
      targetType: 'employee',
      targetId: employeeUid,
      tab: 'employees',
      createdAt: nowIso,
    });
    resetBatch.set(doc(db, 'notifications', resetNotifMgr.id), resetNotifMgr);
    await resetBatch.commit();

    return cleanEmail;
  };

  /**
   * Atomic Shift Closing Submission via writeBatch
   * Guarantees atomic dual-write for both closing document and immutable audit log,
   * fully compliant with Firestore Security Rules (getAfter and actor validation).
   */
  const submitShiftClosing = async (data: {
    branchId: string;
    branchName: string;
    date: string;
    period: 'morning' | 'evening';
    cashSales: number;
    cardSales: number;
    expenses: number;
    notes?: string;
    status: 'draft' | 'pending_review';
  }): Promise<ShiftClosing> => {
    if (!currentOrg || !userProfile || !currentUser) {
      throw new Error('بيانات المستخدم أو المؤسسة غير محملة. يرجى تسجيل الدخول مجدداً.');
    }

    if (userProfile.isActive === false) {
      throw new Error('حسابك معطل ولا يمكنك إرسال إقفالات.');
    }

    // Organization Isolation Check
    if (userProfile.orgId !== currentOrg.id) {
      throw new Error('لا يمكنك إنشاء إقفال لمؤسسة أخرى.');
    }

    const effectivePerms = resolveEffectivePermissions(userProfile);
    if (!effectivePerms.canCreateClosing) {
      throw new Error('لا يملك حسابك صلاحية إنشاء أو إرسال إقفالات الورديات.');
    }

    // Branch Assignment Security Check: Employee & Branch Manager can ONLY submit for their single assigned branch
    if (!canUserAccessBranch(userProfile, data.branchId)) {
      throw new Error('لا يمكنك إنشاء إقفال لفرع غير مخصص لحسابك.');
    }

    // Phase 1 Pre-Write Storage Gate: Block both manager and employee if Drive is not linked & write/read verified
    const targetBranchInMemory = branches.find((b) => b.id === data.branchId) || null;
    const localReadiness = evaluateOrgDriveReadiness(currentOrg, targetBranchInMemory);
    if (!localReadiness.isReady) {
      throw new Error(localReadiness.message);
    }

    // Anti-bypass fresh server check against Firestore (prevents stale in-memory state bypass)
    try {
      const [freshOrgSnap, freshBranchSnap] = await Promise.all([
        getDocFromServer(doc(db, 'organizations', currentOrg.id)),
        getDocFromServer(doc(db, 'branches', data.branchId)),
      ]);
      if (!freshOrgSnap.exists() || !freshBranchSnap.exists()) {
        throw new Error(DRIVE_NOT_READY_MESSAGE);
      }
      const freshOrg = freshOrgSnap.data() as Organization;
      const freshBranch = freshBranchSnap.data() as Branch;
      const serverReadiness = evaluateOrgDriveReadiness(freshOrg, freshBranch);
      if (!serverReadiness.isReady) {
        setCurrentOrg(freshOrg);
        throw new Error(serverReadiness.message);
      }
    } catch (gateErr: any) {
      if (gateErr?.message === DRIVE_NOT_READY_MESSAGE) {
        throw gateErr;
      }
      throw new Error(
        'تعذر التحقق الفوري من جاهزية Google Drive على الخادم قبل الحفظ. يرجى التحقق من الاتصال والمحاولة مجدداً.'
      );
    }

    const { date: cleanDate, yearMonth } = assertValidIsoCalendarDate(data.date);

    const calc = calculateShiftTotals(data.cashSales, data.cardSales, data.expenses);
    if (!calc.isValid) {
      throw new Error('يجب أن تكون جميع المبالغ المالية أرقاماً موجبة صحيحة.');
    }

    const canonicalClosingId = generateDeterministicClosingId(
      currentOrg.id,
      data.branchId,
      cleanDate,
      data.period
    );

    // Authoritative server-only check for ALL closings matching (orgId, branchId, date, period).
    // Fails closed on network/offline errors or permission-denied (never uses cache alone to allow creation).
    const serverSlotClosings = await fetchSlotClosingsFromServer({
      db,
      orgId: currentOrg.id,
      branchId: data.branchId,
      date: cleanDate,
      period: data.period,
    });

    // Enforce strict Single-Closing-Per-Slot policy BEFORE constructing any batch or write:
    // Blocks approved, pending_review, and any other employee's draft OR rejected closing.
    const slotEval = evaluateShiftClosingSlotPolicy({
      slotClosings: serverSlotClosings,
      canonicalClosingId,
      actorUid: currentUser.uid,
      branchName: data.branchName,
      date: cleanDate,
      period: data.period,
    });

    if (!slotEval.allowed) {
      throw new ShiftClosingBusinessError(
        slotEval.conflictCode,
        slotEval.errorMessage,
        slotEval.conflictingClosing.id
      );
    }

    const closingId = slotEval.targetClosingId;
    const existingData: ShiftClosing | null = slotEval.existingOwnClosing;
    const closingDocRef = doc(db, 'closings', closingId);
    const archiveDocRef = doc(db, 'closingArchives', closingId);
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const auditLogRef = doc(db, 'auditLogs', logId);
    const nowIso = new Date().toISOString();

    // Ensure safeActorName strictly complies with firestore.rules:
    // incoming().actorName is string && incoming().actorName.size() >= 2 && incoming().actorName.size() <= 100
    let safeActorName = (
      userProfile.displayName?.trim() ||
      currentUser.email?.trim() ||
      'موظف الصندوق'
    )
      .slice(0, 100)
      .trim();
    if (safeActorName.length < 2) {
      safeActorName = 'موظف الصندوق';
    }

    let safeEmployeeName = (
      userProfile.displayName?.trim() ||
      currentUser.email?.trim() ||
      'موظف الصندوق'
    )
      .slice(0, 100)
      .trim();
    if (safeEmployeeName.length < 2) {
      safeEmployeeName = 'موظف الصندوق';
    }

    const newClosing: ShiftClosing = {
      id: closingId,
      orgId: currentOrg.id,
      branchId: data.branchId,
      branchName: data.branchName,
      employeeId: currentUser.uid,
      employeeName: safeEmployeeName,
      date: cleanDate,
      period: data.period,
      cashSales: calc.cashSales,
      cardSales: calc.cardSales,
      totalSales: calc.totalSales,
      expenses: calc.expenses,
      remainingInBox: calc.remainingInBox,
      netPeriod: calc.netPeriod,
      notes: data.notes?.trim() || '',
      status: data.status,
      attachmentIds: existingData?.attachmentIds || [],
      createdAt: existingData ? existingData.createdAt : nowIso,
      updatedAt: nowIso,
    };

    const auditEntry: AuditLog = {
      id: logId,
      orgId: currentOrg.id,
      actorId: currentUser.uid,
      actorName: safeActorName,
      actorRole: userProfile.role,
      action: data.status === 'draft' ? 'CLOSING_DRAFT_SAVED' : 'CLOSING_SUBMITTED_FOR_REVIEW',
      targetType: 'closing',
      targetId: closingId,
      details: `${data.status === 'draft' ? 'حفظ مسودة' : 'إرسال للمراجعة'} إقفال وردية ${
        data.period === 'morning' ? 'صباحية' : 'مسائية'
      } لفرع ${data.branchName} بتاريخ ${cleanDate}. إجمالي المبيعات: ${calc.totalSales}`.slice(
        0,
        1000
      ),
      timestamp: nowIso,
    };

    let existingArchive: ClosingArchiveRecord | null =
      closingArchives.find((a) => a.closingId === closingId) || null;
    if (!existingArchive && existingData) {
      try {
        const archiveSnap = await getDoc(archiveDocRef);
        if (archiveSnap.exists()) {
          existingArchive = archiveSnap.data() as ClosingArchiveRecord;
        }
      } catch (archCheckErr) {
        console.warn('Notice checking existing closing archive:', archCheckErr);
      }
    }

    // Atomic batched write: creates closing, audit log, and pending_drive_sync archive index together
    const batch = writeBatch(db);
    const batchedTargets: string[] = [
      `closings/${closingId}:${existingData ? 'update' : 'create'}`,
      `auditLogs/${logId}:create`,
    ];
    batch.set(closingDocRef, newClosing);
    batch.set(auditLogRef, auditEntry);
    if (!existingArchive) {
      batch.set(archiveDocRef, {
        closingId,
        orgId: currentOrg.id,
        branchId: data.branchId,
        yearMonth,
        archiveStatus: 'pending_drive_sync',
        updatedAt: nowIso,
      });
      batchedTargets.push(`closingArchives/${closingId}:create`);
    } else if (existingArchive.archiveStatus === 'pending_drive_sync') {
      batch.update(archiveDocRef, {
        archiveStatus: 'pending_drive_sync',
        updatedAt: nowIso,
      });
      batchedTargets.push(`closingArchives/${closingId}:update`);
    }

    if (data.status === 'pending_review') {
      const submitNotifs = buildClosingSubmittedNotifications({
        closing: newClosing,
        isResubmission: slotEval.isResubmission,
        actorUid: currentUser.uid,
        actorName: safeActorName,
        actorRole: userProfile.role,
        createdAt: nowIso,
      });
      submitNotifs.forEach((n) => {
        batch.set(doc(db, 'notifications', n.id), n);
        batchedTargets.push(`notifications/${n.id}:create`);
      });
    }

    try {
      await batch.commit();
    } catch (err: any) {
      // If a concurrent write occupied the slot right before commit, query server to surface the real conflict message
      if (isPermissionDeniedError(err)) {
        try {
          const freshSlotClosings = await fetchSlotClosingsFromServer({
            db,
            orgId: currentOrg.id,
            branchId: data.branchId,
            date: cleanDate,
            period: data.period,
          });
          const postRaceEval = evaluateShiftClosingSlotPolicy({
            slotClosings: freshSlotClosings,
            canonicalClosingId,
            actorUid: currentUser.uid,
            branchName: data.branchName,
            date: cleanDate,
            period: data.period,
          });
          if (!postRaceEval.allowed) {
            throw new ShiftClosingBusinessError(
              postRaceEval.conflictCode,
              postRaceEval.errorMessage,
              postRaceEval.conflictingClosing.id
            );
          }
        } catch (recheckErr) {
          if (
            recheckErr instanceof ShiftClosingBusinessError &&
            recheckErr.code !== 'SLOT_SERVER_UNAVAILABLE' &&
            recheckErr.code !== 'SLOT_VERIFICATION_PERMISSION_DENIED'
          ) {
            throw recheckErr;
          }
        }
      }
      console.error('Error committing shift closing batch:', {
        closingId,
        orgId: currentOrg.id,
        branchId: data.branchId,
        status: data.status,
        actorRole: userProfile.role,
        totalWrites: batchedTargets.length,
        batchedTargets,
        code: err?.code || '',
        message: err instanceof Error ? err.message : String(err),
      });
      handleFirestoreError(err, OperationType.WRITE, `closings/${closingId}`);
    }

    return newClosing;
  };

  const reviewShiftClosing = async (
    closingId: string,
    action: 'approve' | 'reject',
    rejectionReason?: string
  ) => {
    const reviewerPerms = resolveEffectivePermissions(userProfile);
    const canApproveClosings =
      userProfile?.role === 'manager' ||
      (userProfile?.role === 'supervisor' && reviewerPerms.canApproveClosings);
    if (!currentOrg || !userProfile || !canApproveClosings || !currentUser) {
      throw new Error('اعتماد أو إرجاع الإقفالات مقتصر على المدير العام أو المسؤول المخول.');
    }

    if (action === 'reject' && (!rejectionReason || !rejectionReason.trim())) {
      throw new Error('يجب كتابة سبب الإرجاع للموظف حتى يتمكن من تصحيح الإقفال.');
    }

    const cachedArchiveExists = closingArchives.some((a) => a.closingId === closingId);

    try {
      await executeAtomicReviewShiftClosing({
        db,
        orgId: currentOrg.id,
        closingId,
        action,
        rejectionReason,
        reviewerUid: currentUser.uid,
        reviewerName: userProfile.displayName,
        reviewerEmail: currentUser.email,
        reviewerRole: userProfile.role,
        cachedArchiveExists,
      });
    } catch (error) {
      if (error instanceof ShiftClosingBusinessError) {
        throw error;
      }
      console.error('Error reviewing closing:', error);
      handleFirestoreError(error, OperationType.UPDATE, `closings/${closingId}`);
    }
  };

  /**
   * Administrative Correction for Managers on Approved Closings
   * Free Firebase Spark Architecture: Fully atomic transaction via runTransaction
   * Guarantees immutable historical fields, accurate accounting math, and mandatory audit log
   */
  const adminCorrectClosing = async (data: {
    closingId: string;
    cashSales: number;
    cardSales: number;
    expenses: number;
    correctionReason: string;
  }) => {
    if (!currentUser) {
      throw new Error('يجب تسجيل الدخول كمدير معتمد لإجراء التصحيح الإداري.');
    }
    if (!currentOrg || userProfile?.role !== 'manager' || !userProfile.isActive) {
      throw new Error('التصحيح الإداري مقتصر حصراً على المدراء النشطين في المؤسسة.');
    }

    const cleanReason = data.correctionReason?.trim();
    if (!cleanReason || cleanReason.length < 5) {
      throw new Error('يجب كتابة سبب التصحيح الإداري المبرر لتعديل إقفال معتمد (لا يقل عن 5 أحرف).');
    }

    const calc = calculateShiftTotals(data.cashSales, data.cardSales, data.expenses);
    if (!calc.isValid) {
      throw new Error('المبالغ المصححة يجب أن تكون قيماً موجبة صحيحة.');
    }

    const closingDocRef = doc(db, 'closings', data.closingId);
    const archiveDocRef = doc(db, 'closingArchives', data.closingId);
    const auditLogId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const auditLogDocRef = doc(db, 'auditLogs', auditLogId);
    let nowIso = new Date().toISOString();

    try {
      await runTransaction(db, async (transaction) => {
        // 1. Read existing closing AND closingArchive inside transaction before any writes
        const closingSnap = await transaction.get(closingDocRef);
        if (!closingSnap.exists()) {
          throw new Error('سجل الإقفال غير موجود.');
        }
        const archiveSnap = await transaction.get(archiveDocRef);

        const existing = closingSnap.data() as ShiftClosing;

        // 2. Strict Tenant and Status Checks
        if (existing.orgId !== currentOrg.id || existing.orgId !== userProfile.orgId) {
          throw new Error('لا يمكن تصحيح إقفال تابع لمؤسسة أخرى.');
        }

        if (existing.status !== 'approved') {
          throw new Error('التصحيح الإداري مخصص فقط للإقفالات المعتمدة.');
        }

        assertValidIsoCalendarDate(existing.date);

        if (existing.correctedAt === nowIso) {
          nowIso = new Date(Date.now() + 1).toISOString();
        }

        // 3. Genuine previous values snapshot from the server document
        const previousSnapshot = {
          cashSales: existing.cashSales,
          cardSales: existing.cardSales,
          expenses: existing.expenses,
          totalSales: existing.totalSales,
          remainingInBox: existing.remainingInBox,
          netPeriod: existing.netPeriod,
        };

        // 4. Update closing while preserving historical fields
        const updatedPayload: Partial<ShiftClosing> = {
          cashSales: calc.cashSales,
          cardSales: calc.cardSales,
          expenses: calc.expenses,
          totalSales: calc.totalSales,
          remainingInBox: calc.remainingInBox,
          netPeriod: calc.netPeriod,
          previousValues: previousSnapshot,
          correctionReason: cleanReason,
          correctedBy: currentUser.uid,
          correctedByName: userProfile.displayName || 'المدير العام',
          correctedAt: nowIso,
          updatedAt: nowIso,
        };

        transaction.update(closingDocRef, updatedPayload);

        // 5. Mark existing Drive archive as stale atomically if it was already archived / stale / failed-with-proof
        if (archiveSnap.exists()) {
          const prevArchive = archiveSnap.data() as ClosingArchiveRecord;
          if (
            prevArchive.archiveStatus === 'archived' ||
            prevArchive.archiveStatus === 'stale' ||
            (prevArchive.archiveStatus === 'failed' && Boolean(prevArchive.driveExcelFileId))
          ) {
            transaction.update(archiveDocRef, {
              archiveStatus: 'stale',
              archiveError: deleteField(),
              sourceCorrectionAt: nowIso,
              updatedAt: nowIso,
            });
          }
        }

        // 6. Create atomic audit log in the exact same transaction
        const auditLogData: AuditLog = {
          id: auditLogId,
          orgId: currentOrg.id,
          action: 'CLOSING_ADMIN_CORRECTED',
          targetType: 'closing',
          targetId: data.closingId,
          actorId: currentUser.uid,
          actorName: userProfile.displayName || 'المدير العام',
          actorRole: 'manager',
          details: `تصحيح إداري معتمد للإقفال (${data.closingId}). السبب: ${cleanReason}. المبيعات الجديدة: نقد ${calc.cashSales}، شبكة ${calc.cardSales}، مصاريف ${calc.expenses}. المبيعات السابقة: نقد ${existing.cashSales}، شبكة ${existing.cardSales}.`,
          timestamp: nowIso,
          previousValues: previousSnapshot,
          newValues: {
            cashSales: calc.cashSales,
            cardSales: calc.cardSales,
            expenses: calc.expenses,
            totalSales: calc.totalSales,
            remainingInBox: calc.remainingInBox,
            netPeriod: calc.netPeriod,
          },
        };

        transaction.set(auditLogDocRef, auditLogData);

        const correctionNotifs = buildClosingAdminCorrectedNotifications({
          closing: existing,
          correctionReason: cleanReason,
          actorUid: currentUser.uid,
          actorName: userProfile.displayName || 'المدير العام',
          createdAt: nowIso,
        });
        correctionNotifs.forEach((n) => transaction.set(doc(db, 'notifications', n.id), n));
      });
    } catch (error: any) {
      console.error('Error in administrative correction transaction:', error);
      throw error;
    }
  };

  /**
   * Saves non-secret Google Drive link metadata & folder IDs to Firestore.
   * Strictly enforces organization owner identity (currentUser.uid === currentOrg.ownerId).
   * Never stores any OAuth access token or secret.
   */
  const saveDriveConnection = async (data: {
    driveAccountEmail: string;
    driveAccountName: string;
    driveGoogleSub: string;
    orgFolderId: string;
    orgFolderName: string;
    orgFolderLink: string;
    driveWriteVerified: boolean;
    driveWriteVerifiedAt: string;
    branchFolders?: Array<{
      branchId: string;
      folderId: string;
      folderName: string;
      webViewLink: string;
    }>;
    monthFolderMap?: Record<string, DriveMonthFolderRef>;
  }) => {
    if (!currentUser || !currentOrg || !userProfile) {
      throw new Error('يجب تسجيل الدخول بحساب مالك المؤسسة لحفظ بيانات ربط Drive.');
    }
    if (
      userProfile.role !== 'manager' ||
      !userProfile.isActive ||
      userProfile.orgId !== currentOrg.id ||
      currentUser.uid !== currentOrg.ownerId
    ) {
      throw new Error('ربط Google Drive مقتصر حصراً على مالك المؤسسة المعتمد.');
    }
    if (!data.orgFolderId || !data.driveGoogleSub || !data.driveAccountEmail) {
      throw new Error('بيانات مجلد المؤسسة أو هوية Google غير مكتملة.');
    }
    if (data.driveWriteVerified !== true || !data.driveWriteVerifiedAt) {
      throw new Error('لا يمكن اعتماد ربط Google Drive قبل نجاح اختبار الكتابة والقراءة الفعلية.');
    }

    const targetOrgId = currentOrg.id;
    const targetUserUid = currentUser.uid;
    if (activeOrgIdRef.current !== targetOrgId || activeUserUidRef.current !== targetUserUid) {
      throw new Error('تم تبديل المؤسسة أو الجلسة أثناء الربط؛ تم إيقاف الحفظ لحماية عزل المؤسسات.');
    }

    const orgBranchesById = new Map(
      branches.filter((b) => b.orgId === targetOrgId).map((b) => [b.id, b])
    );
    const nowIso = new Date().toISOString();
    const orgRef = doc(db, 'organizations', targetOrgId);
    const batch = writeBatch(db);

    const orgUpdatePayload: Record<string, any> = {
      driveConnected: true,
      driveFolderId: data.orgFolderId,
      driveFolderName: data.orgFolderName,
      driveFolderLink: data.orgFolderLink,
      driveAccountEmail: data.driveAccountEmail,
      driveAccountName: data.driveAccountName,
      driveGoogleSub: data.driveGoogleSub,
      driveLinkedAt: nowIso,
      driveWriteVerified: true,
      driveWriteVerifiedAt: data.driveWriteVerifiedAt,
      driveLastHealthStatus: 'verified' as DriveHealthStatus,
      driveHealthError: deleteField(),
      updatedAt: nowIso,
    };

    if (data.monthFolderMap) {
      orgUpdatePayload.driveMonthFolderIds = data.monthFolderMap;
    }

    batch.update(orgRef, orgUpdatePayload);

    const branchMap = new Map<string, { folderId: string; folderName: string; webViewLink: string }>();
    if (data.branchFolders && data.branchFolders.length > 0) {
      for (const bf of data.branchFolders) {
        const targetBranch = orgBranchesById.get(bf.branchId);
        if (!targetBranch) {
          throw new Error(`تعارض عزل الفروع: الفرع (${bf.branchId}) لا يتبع للمؤسسة (${targetOrgId}).`);
        }
        // Suspended/inactive branches must never receive new or updated Drive folder links
        if (!isBranchActiveForDriveLink(targetBranch)) {
          continue;
        }
        branchMap.set(bf.branchId, bf);
        const branchRef = doc(db, 'branches', bf.branchId);
        batch.update(branchRef, {
          driveFolderId: bf.folderId,
          driveFolderName: bf.folderName,
          driveFolderLink: bf.webViewLink,
        });
      }
    }

    try {
      await batch.commit();
    } catch (error) {
      console.error('Error saving Drive connection metadata:', error);
      handleFirestoreError(error, OperationType.UPDATE, `organizations/${targetOrgId}`);
    }

    if (activeOrgIdRef.current !== targetOrgId || activeUserUidRef.current !== targetUserUid) {
      return;
    }

    setCurrentOrg((prev) =>
      prev && prev.id === targetOrgId
        ? {
            ...prev,
            driveConnected: true,
            driveFolderId: data.orgFolderId,
            driveFolderName: data.orgFolderName,
            driveFolderLink: data.orgFolderLink,
            driveAccountEmail: data.driveAccountEmail,
            driveAccountName: data.driveAccountName,
            driveGoogleSub: data.driveGoogleSub,
            driveLinkedAt: nowIso,
            driveWriteVerified: true,
            driveWriteVerifiedAt: data.driveWriteVerifiedAt,
            driveLastHealthStatus: 'verified',
            driveHealthError: undefined,
            driveMonthFolderIds: data.monthFolderMap ?? prev.driveMonthFolderIds,
            updatedAt: nowIso,
          }
        : prev
    );

    if (branchMap.size > 0) {
      setBranches((prev) =>
        prev.map((b) => {
          if (b.orgId !== targetOrgId) return b;
          const bf = branchMap.get(b.id);
          return bf
            ? {
                ...b,
                driveFolderId: bf.folderId,
                driveFolderName: bf.folderName,
                driveFolderLink: bf.webViewLink,
              }
            : b;
        })
      );
      setCurrentBranch((prev) => {
        if (!prev || prev.orgId !== targetOrgId) return prev;
        const bf = branchMap.get(prev.id);
        return bf
          ? {
              ...prev,
              driveFolderId: bf.folderId,
              driveFolderName: bf.folderName,
              driveFolderLink: bf.webViewLink,
            }
          : prev;
      });
    }
  };

  /**
   * Records non-secret Drive health failure in Firestore when a linked organization fails
   * write/read verification so operational entry stays safely gated until resolved.
   */
  const recordDriveHealthFailure = async (errorMessage: string) => {
    if (!currentUser || !currentOrg || !userProfile) return;
    if (
      userProfile.role !== 'manager' ||
      !userProfile.isActive ||
      userProfile.orgId !== currentOrg.id ||
      currentUser.uid !== currentOrg.ownerId
    ) {
      return;
    }
    if (!currentOrg.driveConnected) return;

    const targetOrgId = currentOrg.id;
    const targetUserUid = currentUser.uid;
    if (activeOrgIdRef.current !== targetOrgId || activeUserUidRef.current !== targetUserUid) {
      return;
    }

    const nowIso = new Date().toISOString();
    const safeError = (errorMessage || 'فشل التحقق من جاهزية Google Drive').slice(0, 500);
    const orgRef = doc(db, 'organizations', targetOrgId);

    try {
      await updateDoc(orgRef, {
        driveWriteVerified: false,
        driveLastHealthStatus: 'failed' as DriveHealthStatus,
        driveHealthError: safeError,
        updatedAt: nowIso,
      });

      if (activeOrgIdRef.current !== targetOrgId || activeUserUidRef.current !== targetUserUid) {
        return;
      }

      setCurrentOrg((prev) =>
        prev && prev.id === targetOrgId
          ? {
              ...prev,
              driveWriteVerified: false,
              driveLastHealthStatus: 'failed',
              driveHealthError: safeError,
              updatedAt: nowIso,
            }
          : prev
      );

      const driveFailNotif = buildSecurityAdminNotification({
        dedupKey: `drive_health_fail:${targetOrgId}:${nowIso.slice(0, 13)}`,
        type: 'SECURITY_DRIVE_HEALTH_FAILED',
        severity: 'critical',
        orgId: targetOrgId,
        audienceScope: 'org_manager',
        actorUid: targetUserUid,
        actorName: userProfile.displayName || currentUser.email || 'مدير المؤسسة',
        actorRole: 'manager',
        title: 'فشل فحص اتصال Google Drive',
        body: `تعذر التحقق من صلاحية الكتابة في Google Drive للمؤسسة: ${safeError}`,
        targetType: 'drive',
        targetId: targetOrgId,
        tab: 'settings',
        createdAt: nowIso,
      });
      void persistNonExistingNotificationsSafely([driveFailNotif]);
    } catch (err) {
      console.warn('Notice recording Drive health failure:', err);
    }
  };

  /**
   * Disconnects Google Drive integration metadata in Firestore without deleting
   * any files in Google Drive or any operational records in Firestore.
   */
  const disconnectDriveConnection = async () => {
    if (!currentUser || !currentOrg || !userProfile) {
      throw new Error('يجب تسجيل الدخول بحساب مالك المؤسسة لفصل الربط.');
    }
    if (
      userProfile.role !== 'manager' ||
      !userProfile.isActive ||
      userProfile.orgId !== currentOrg.id ||
      currentUser.uid !== currentOrg.ownerId
    ) {
      throw new Error('فصل ربط Google Drive مقتصر حصراً على مالك المؤسسة المعتمد.');
    }

    const targetOrgId = currentOrg.id;
    const targetUserUid = currentUser.uid;
    const nowIso = new Date().toISOString();
    const orgRef = doc(db, 'organizations', targetOrgId);
    const batch = writeBatch(db);

    batch.update(orgRef, buildOrgDriveDisconnectPayload(nowIso, deleteField));

    const branchesToClear = selectBranchesForDriveDisconnect(branches, targetOrgId);
    for (const branch of branchesToClear) {
      const branchRef = doc(db, 'branches', branch.id);
      batch.update(branchRef, buildBranchDriveDisconnectPayload(deleteField));
    }

    try {
      await executeOrgDriveDisconnect({
        orgId: targetOrgId,
        commitDisconnectBatch: () => batch.commit(),
        clearSession: clearDriveSession,
        clearFolderCache: clearUnifiedDriveFolderCache,
      });

      const driveDisconnectNotif = buildSecurityAdminNotification({
        dedupKey: `drive_disconnected:${targetOrgId}:${nowIso}`,
        type: 'SECURITY_DRIVE_DISCONNECTED',
        severity: 'warning',
        orgId: targetOrgId,
        audienceScope: 'org_manager',
        actorUid: targetUserUid,
        actorName: userProfile.displayName || currentUser.email || 'مدير المؤسسة',
        actorRole: 'manager',
        title: 'تم فصل ربط Google Drive',
        body: 'تم فصل ربط Google Drive لهذه المؤسسة؛ ستتوقف الإقفالات التشغيلية الجديدة حتى إعادة الربط والتحقق.',
        targetType: 'drive',
        targetId: targetOrgId,
        tab: 'settings',
        createdAt: nowIso,
      });
      void persistNonExistingNotificationsSafely([driveDisconnectNotif]);
    } catch (error) {
      console.error('Error disconnecting Drive metadata:', error);
      handleFirestoreError(error, OperationType.UPDATE, `organizations/${targetOrgId}`);
    }

    if (activeOrgIdRef.current !== targetOrgId || activeUserUidRef.current !== targetUserUid) {
      return;
    }

    setCurrentOrg((prev) =>
      prev && prev.id === targetOrgId
        ? {
            ...prev,
            driveConnected: false,
            driveWriteVerified: false,
            driveLastHealthStatus: 'disconnected',
            driveWriteVerifiedAt: undefined,
            driveHealthError: undefined,
            driveFolderId: undefined,
            driveFolderName: undefined,
            driveFolderLink: undefined,
            driveAccountEmail: undefined,
            driveAccountName: undefined,
            driveGoogleSub: undefined,
            driveLinkedAt: undefined,
            driveMonthFolderIds: undefined,
            updatedAt: nowIso,
          }
        : prev
    );

    setBranches((prev) =>
      prev.map((b) =>
        b.orgId === targetOrgId
          ? {
              ...b,
              driveFolderId: undefined,
              driveFolderName: undefined,
              driveFolderLink: undefined,
            }
          : b
      )
    );

    setCurrentBranch((prev) =>
      prev && prev.orgId === targetOrgId
        ? {
            ...prev,
            driveFolderId: undefined,
            driveFolderName: undefined,
            driveFolderLink: undefined,
          }
        : prev
    );
  };

  /**
   * Manager-only real Excel (.xlsx) archival to Google Drive with deduplication,
   * version chain preservation, and mandatory read-back verification prior to marking 'archived'.
   */
  const archiveClosingToDrive = async (
    closingId: string,
    options?: { interactiveAuthIfNeeded?: boolean }
  ): Promise<ClosingArchiveRecord> => {
    const interactiveAuthIfNeeded = options?.interactiveAuthIfNeeded ?? true;

    if (!currentOrg || !currentUser) {
      throw new Error('لا توجد مؤسسة أو جلسة مستخدم نشطة لإجراء الأرشفة في Google Drive.');
    }

    const targetOrg = currentOrg;
    const targetOrgId = targetOrg.id;
    const targetUserUid = currentUser.uid;

    const googleProviderData = currentUser.providerData.find((p) => p.providerId === 'google.com');
    const eligibility = assertOrgDriveAuthorizationEligibility({
      currentUserUid: targetUserUid,
      userProfile,
      org: targetOrg,
      googleUid: googleProviderData?.uid,
      ownerEmail: googleProviderData?.email || currentUser.email || targetOrg.ownerEmail || '',
    });

    const closingDocRef = doc(db, 'closings', closingId);
    const closingSnap = await getDocFromServer(closingDocRef).catch(() => getDoc(closingDocRef));
    if (!closingSnap.exists()) {
      throw new Error('سجل الإقفال غير موجود.');
    }

    const closing = closingSnap.data() as ShiftClosing;
    if (closing.orgId !== targetOrgId) {
      throw new Error('لا يمكن أرشفة إقفال تابع لمؤسسة أخرى.');
    }
    if (closing.status !== 'approved') {
      throw new Error('لا يمكن أرشفة الإقفال في Google Drive قبل اعتماده رسمياً.');
    }

    const { yearMonth } = assertValidIsoCalendarDate(closing.date);

    let branch = branches.find((b) => b.id === closing.branchId && b.orgId === targetOrgId) || null;
    if (!branch) {
      const brSnap = await getDoc(doc(db, 'branches', closing.branchId));
      if (brSnap.exists()) {
        branch = brSnap.data() as Branch;
      }
    }
    if (!branch || branch.orgId !== targetOrgId) {
      throw new Error('بيانات الفرع المرتبط بالإقفال غير متوفرة أو لا تتبع للمؤسسة الحالية.');
    }

    const readiness = evaluateOrgDriveReadiness(targetOrg, branch);
    if (!readiness.isReady) {
      throw new Error(readiness.detail || readiness.message);
    }

    const archiveDocRef = doc(db, 'closingArchives', closingId);
    let prevArchive: ClosingArchiveRecord | null = null;
    try {
      const archSnap = await getDocFromServer(archiveDocRef).catch(() => getDoc(archiveDocRef));
      if (archSnap.exists()) {
        prevArchive = archSnap.data() as ClosingArchiveRecord;
      }
    } catch {
      prevArchive = closingArchives.find((a) => a.closingId === closingId && a.orgId === targetOrgId) || null;
    }

    // Already archived cleanly on current version -> safe idempotent return
    if (
      prevArchive &&
      prevArchive.archiveStatus === 'archived' &&
      (!closing.correctedAt || prevArchive.sourceCorrectionAt === closing.correctedAt)
    ) {
      return prevArchive;
    }

    const isReArchive = Boolean(prevArchive?.driveExcelFileId);
    const targetRevision = isReArchive ? (prevArchive!.driveRevision || 1) + 1 : 1;
    const forbiddenPreviousFileId = isReArchive ? prevArchive!.driveExcelFileId : undefined;

    if (isReArchive && !closing.correctedAt) {
      throw new Error(
        'تعذر إعادة الأرشفة لعدم وجود طابع تصحيح إداري موثق (correctedAt) على الإقفال المعتمد.'
      );
    }

    let session = getActiveDriveSession(targetOrgId);
    if (session) {
      try {
        session = assertDriveSessionMatchesAccount(session, {
          orgId: targetOrgId,
          googleUid: eligibility.googleUid,
          email: eligibility.ownerEmail,
          linkedSub: targetOrg.driveGoogleSub,
          linkedEmail: targetOrg.driveAccountEmail,
        });
      } catch {
        session = null;
      }
    }

    if (!session) {
      if (!interactiveAuthIfNeeded) {
        throw new Error(
          'تم اعتماد الإقفال بنجاح. اضغط «أرشفة في Google Drive» لتجديد تفويض المتصفح المؤقت ورفع ملف Excel.'
        );
      }
      session = await requestDriveAuthorization({
        orgId: targetOrgId,
        googleUid: eligibility.googleUid,
        email: eligibility.ownerEmail,
        linkedAccount: eligibility.linkedAccount,
      });
    }

    if (activeOrgIdRef.current !== targetOrgId || activeUserUidRef.current !== targetUserUid) {
      throw new Error('تم تبديل المؤسسة أو الحساب أثناء الأرشفة؛ تم إيقاف الرفع لحماية عزل المؤسسات.');
    }

    try {
      // 1. Generate formatted RTL Excel workbook using ONLY real fields
      const excelPayload = await generateClosingExcelWorkbook({
        closing,
        org: targetOrg,
        branch,
        revision: targetRevision,
      });

      // 2. Upload to Unified Daily Drive Hierarchy (<Org Root>/الفروع/<Branch>/<YYYY>/<MM>/<DD>)
      //    and strictly verify metadata + binary + exceljs content
      const uploadResult = await uploadAndVerifyClosingExcelToDrive({
        token: session.accessToken,
        org: targetOrg,
        branch,
        closing,
        revision: targetRevision,
        excelPayload,
        forbiddenPreviousFileId,
        folderStrategy: 'unified_daily',
        actor: {
          uid: targetUserUid,
          orgId: targetOrgId,
          role: userProfile?.role || 'manager',
          isActive: Boolean(userProfile?.isActive),
          displayName: userProfile?.displayName || currentUser.displayName || targetOrg.ownerName,
          email: eligibility.ownerEmail,
          googleUid: eligibility.googleUid,
        },
      });

      if (activeOrgIdRef.current !== targetOrgId || activeUserUidRef.current !== targetUserUid) {
        throw new Error('تم تبديل المؤسسة أثناء الرفع؛ تم إيقاف تحديث Firestore.');
      }

      const nowIso = new Date().toISOString();

      // 3. Cache verified month folder ref in Organization metadata if new/updated
      const monthKey = `${branch.id}_${yearMonth}`;
      const existingMonthRef = targetOrg.driveMonthFolderIds?.[monthKey];
      if (!existingMonthRef || existingMonthRef.folderId !== uploadResult.monthFolder.folderId) {
        try {
          await updateDoc(doc(db, 'organizations', targetOrgId), {
            [`driveMonthFolderIds.${monthKey}`]: uploadResult.monthFolder,
            updatedAt: nowIso,
          });
        } catch (folderSyncErr) {
          console.warn('Notice updating cached month folder ref:', folderSyncErr);
        }
      }

      // 4. Write 'archived' state to Firestore closingArchives ONLY after verified Drive read-back
      const archivedFields: Record<string, any> = {
        closingId: closing.id,
        orgId: targetOrgId,
        branchId: closing.branchId,
        yearMonth,
        archiveStatus: 'archived',
        driveExcelFileId: uploadResult.fileId,
        driveExcelFileName: uploadResult.fileName,
        driveExcelWebViewLink: uploadResult.webViewLink,
        driveMonthFolderId: uploadResult.monthFolder.folderId,
        drivePayloadHash: uploadResult.payloadHash,
        driveRevision: targetRevision,
        archivedAt: nowIso,
        archivedBy: targetUserUid,
        updatedAt: nowIso,
      };

      if (isReArchive && prevArchive?.driveExcelFileId) {
        archivedFields.previousDriveExcelFileId = prevArchive.driveExcelFileId;
      }
      if (closing.correctedAt) {
        archivedFields.sourceCorrectionAt = closing.correctedAt;
      }

      if (!prevArchive) {
        await setDoc(archiveDocRef, archivedFields);
      } else {
        await updateDoc(archiveDocRef, {
          archiveStatus: 'archived',
          driveExcelFileId: uploadResult.fileId,
          driveExcelFileName: uploadResult.fileName,
          driveExcelWebViewLink: uploadResult.webViewLink,
          driveMonthFolderId: uploadResult.monthFolder.folderId,
          drivePayloadHash: uploadResult.payloadHash,
          driveRevision: targetRevision,
          archivedAt: nowIso,
          archivedBy: targetUserUid,
          archiveError: deleteField(),
          updatedAt: nowIso,
          ...(isReArchive && prevArchive.driveExcelFileId
            ? { previousDriveExcelFileId: prevArchive.driveExcelFileId }
            : {}),
          ...(closing.correctedAt ? { sourceCorrectionAt: closing.correctedAt } : {}),
        });
      }

      const savedRecord: ClosingArchiveRecord = {
        closingId: closing.id,
        orgId: targetOrgId,
        branchId: closing.branchId,
        yearMonth,
        archiveStatus: 'archived',
        driveExcelFileId: uploadResult.fileId,
        driveExcelFileName: uploadResult.fileName,
        driveExcelWebViewLink: uploadResult.webViewLink,
        driveMonthFolderId: uploadResult.monthFolder.folderId,
        drivePayloadHash: uploadResult.payloadHash,
        driveRevision: targetRevision,
        previousDriveExcelFileId:
          isReArchive && prevArchive?.driveExcelFileId ? prevArchive.driveExcelFileId : undefined,
        sourceCorrectionAt: closing.correctedAt || undefined,
        archivedAt: nowIso,
        archivedBy: targetUserUid,
        updatedAt: nowIso,
      };

      if (activeOrgIdRef.current === targetOrgId) {
        setClosingArchives((prev) => {
          const filteredList = prev.filter((item) => item.closingId !== closing.id);
          return [savedRecord, ...filteredList];
        });
      }

      return savedRecord;
    } catch (err: any) {
      if (!isOAuthCancellationOrConfigError(err) && activeOrgIdRef.current === targetOrgId) {
        const errTime = new Date().toISOString();
        const rawMsg = String(err?.message || err || 'فشل أرشفة ملف Excel في Google Drive').trim();
        const safeError = (rawMsg.length >= 5 ? rawMsg : `خطأ أرشفة: ${rawMsg}`).slice(0, 1000);

        try {
          if (!prevArchive) {
            await setDoc(archiveDocRef, {
              closingId: closing.id,
              orgId: targetOrgId,
              branchId: closing.branchId,
              yearMonth,
              archiveStatus: 'failed',
              archiveError: safeError,
              updatedAt: errTime,
            });
          } else if (prevArchive.archiveStatus !== 'archived') {
            await updateDoc(archiveDocRef, {
              archiveStatus: 'failed',
              archiveError: safeError,
              updatedAt: errTime,
            });
          }
        } catch (persistErr) {
          console.warn('Notice recording archive failure in closingArchives:', persistErr);
        }
      }

      throw err;
    }
  };

  /**
   * Batch archives multiple pending/stale/failed approved closings sequentially
   * using the owner's single RAM Drive session.
   */
  const archivePendingClosingsToDrive = async (closingIds: string[]) => {
    const succeeded: string[] = [];
    const failed: Array<{ closingId: string; error: string }> = [];

    for (const id of closingIds) {
      try {
        await archiveClosingToDrive(id, { interactiveAuthIfNeeded: true });
        succeeded.push(id);
      } catch (err: any) {
        failed.push({
          closingId: id,
          error: err?.message || 'فشل رفع ملف Excel للإقفال',
        });
      }
    }

    return { succeeded, failed };
  };

  /**
   * Downloads and verifies the original archived .xlsx file directly from Google Drive
   * (`files.get?alt=media`) using the stored `driveExcelFileId`, without regenerating locally from Firestore.
   */
  const downloadArchivedExcelFromDrive = async (
    closingId: string
  ): Promise<{ fileName: string; revision: number }> => {
    const targetOrg = currentOrg;
    const targetOrgId = currentOrg?.id;
    const targetUserUid = currentUser?.uid;

    const googleProviderData = currentUser?.providerData.find((p) => p.providerId === 'google.com');
    const eligibility = assertOrgDriveAuthorizationEligibility({
      currentUserUid: targetUserUid,
      userProfile,
      org: targetOrg,
      googleUid: googleProviderData?.uid,
      ownerEmail: googleProviderData?.email || currentUser?.email || targetOrg?.ownerEmail || '',
    });

    const closingDocRef = doc(db, 'closings', closingId);
    const closingSnap = await getDocFromServer(closingDocRef).catch(() => getDoc(closingDocRef));
    if (!closingSnap.exists()) {
      throw new Error('سجل الإقفال غير موجود.');
    }
    const closing = closingSnap.data() as ShiftClosing;
    if (!targetOrg || !targetOrgId || closing.orgId !== targetOrgId) {
      throw new Error('لا يمكن تنزيل ملف أرشيف تابع لمؤسسة أخرى.');
    }

    const archiveDocRef = doc(db, 'closingArchives', closingId);
    const archiveSnap = await getDocFromServer(archiveDocRef).catch(() => getDoc(archiveDocRef));
    if (!archiveSnap.exists()) {
      throw new Error('لا يوجد سجل أرشفة Google Drive لهذا الإقفال حتى الآن.');
    }
    const archiveRecord = archiveSnap.data() as ClosingArchiveRecord;
    if (!archiveRecord.driveExcelFileId) {
      throw new Error('لم يتم رفع ملف Excel لهذا الإقفال إلى Google Drive بعد.');
    }

    let session = getActiveDriveSession(targetOrgId);
    if (session) {
      try {
        session = assertDriveSessionMatchesAccount(session, {
          orgId: targetOrgId,
          googleUid: eligibility.googleUid,
          email: eligibility.ownerEmail,
          linkedSub: targetOrg.driveGoogleSub,
          linkedEmail: targetOrg.driveAccountEmail,
        });
      } catch {
        session = null;
      }
    }

    if (!session) {
      session = await requestDriveAuthorization({
        orgId: targetOrgId,
        googleUid: eligibility.googleUid,
        email: eligibility.ownerEmail,
        linkedAccount: eligibility.linkedAccount,
      });
    }

    if (activeOrgIdRef.current !== targetOrgId || activeUserUidRef.current !== targetUserUid) {
      throw new Error('تم تبديل المؤسسة أو الجلسة أثناء التنزيل؛ تم إيقاف العملية لحماية العزل.');
    }

    const downloaded = await downloadOriginalClosingExcelFromDrive({
      token: session.accessToken,
      org: targetOrg,
      closing,
      archiveRecord,
    });

    downloadXlsxBytes(downloaded.bytes, downloaded.fileName);
    return {
      fileName: downloaded.fileName,
      revision: downloaded.revision,
    };
  };

  const isSuperAdmin = isVerifiedSuperAdmin(currentUser);

  const loadSuperAdminOverview = async () => {
    const activeAuthUser = auth.currentUser;
    if (!isVerifiedSuperAdmin(activeAuthUser) || !activeAuthUser) {
      setSuperAdminOverview(null);
      const errMsg = 'غير مصرح بالوصول إلى لوحة المدير الرئيسي.';
      setSuperAdminError(errMsg);
      throw new Error(errMsg);
    }

    setSuperAdminLoading(true);
    setSuperAdminError(null);
    try {
      const overview = await fetchSuperAdminOverviewWithDiagnostics({
        user: activeAuthUser,
        databaseId: TARGET_FIRESTORE_DATABASE_ID,
        fetchCollection: async <T,>(colName: string): Promise<T[]> => {
          const colRef = collection(db, colName);
          const snap = await getDocsFromServer(colRef).catch((err: any) => {
            if (isPermissionDeniedError(err)) {
              throw err;
            }
            return getDocs(colRef);
          });
          const items: T[] = [];
          snap.forEach((docSnap) => {
            if (colName === 'users') {
              const rawUser = docSnap.data() as UserProfile;
              items.push({
                ...rawUser,
                uid: rawUser.uid || docSnap.id,
                firestoreDocId: docSnap.id,
              } as unknown as T);
            } else {
              items.push(docSnap.data() as T);
            }
          });
          return items;
        },
      });

      if (!isVerifiedSuperAdmin(auth.currentUser)) {
        setSuperAdminOverview(null);
        return;
      }

      // Fetch immutable memberOrgHistory non-blockingly so older deployed rulesets never break overview load
      let memberOrgHistory: MemberOrgHistoryRecord[] = [];
      try {
        const histColRef = collection(db, 'memberOrgHistory');
        const histSnap = await getDocsFromServer(histColRef).catch(() => getDocs(histColRef));
        histSnap.forEach((docSnap) => {
          memberOrgHistory.push(docSnap.data() as MemberOrgHistoryRecord);
        });
        memberOrgHistory.sort(
          (a, b) => new Date(b.effectiveAt || b.createdAt).getTime() - new Date(a.effectiveAt || a.createdAt).getTime()
        );
      } catch {
        memberOrgHistory = [];
      }

      setSuperAdminOverview({
        ...overview,
        memberOrgHistory,
      });
      if (overview.diagnosticMessage) {
        setSuperAdminError(overview.diagnosticMessage);
      }
      const saThresholdNotifs = buildSuperAdminThresholdNotifications({
        organizations: overview.organizations,
        branches: overview.branches,
        actorUid: activeAuthUser.uid,
        actorName: activeAuthUser.displayName || activeAuthUser.email || 'صاحب الموقع',
      });
      if (saThresholdNotifs.length > 0) {
        void persistNonExistingNotificationsSafely(saThresholdNotifs);
      }
    } catch (error: any) {
      setSuperAdminOverview(null);
      const msg =
        error?.message ||
        (isPermissionDeniedError(error)
          ? `تم رفض قراءة بيانات المراقبة من قواعد Firestore (Permission Denied) على قاعدة البيانات (${TARGET_FIRESTORE_DATABASE_ID}).`
          : 'تعذر تحميل بيانات المراقبة من قاعدة البيانات.');
      setSuperAdminError(msg);
    } finally {
      setSuperAdminLoading(false);
    }
  };

  const assertAuthorizedSuperAdmin = (): FirebaseUser => {
    const activeAuthUser = auth.currentUser;
    if (!activeAuthUser || !isVerifiedSuperAdmin(activeAuthUser)) {
      throw new Error('هذه العملية حصرية للمدير الرئيسي الموثق amoal2030@gmail.com فقط.');
    }
    return activeAuthUser;
  };

  const createPlatformAuditPayload = (params: {
    actor: FirebaseUser;
    action: PlatformAuditAction;
    targetType: PlatformAuditLog['targetType'];
    targetId: string;
    orgId?: string;
    details: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): PlatformAuditLog => {
    const nowIso = new Date().toISOString();
    const id = `pal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      actorEmail: (params.actor.email || 'amoal2030@gmail.com').trim().toLowerCase(),
      actorUid: params.actor.uid,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId.slice(0, 254),
      ...(params.orgId ? { orgId: params.orgId } : {}),
      details: (params.details.trim().length >= 5 ? params.details.trim() : `إجراء: ${params.action}`).slice(0, 1000),
      ...(params.metadata ? { metadata: params.metadata } : {}),
      timestamp: nowIso,
    };
  };

  const parseDateInputOrFallback = (isoOrDateStr: string | undefined, fallback: Date): Date => {
    if (!isoOrDateStr || !isoOrDateStr.trim()) return fallback;
    const trimmed = isoOrDateStr.trim();
    const candidate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? new Date(`${trimmed}T12:00:00.000Z`)
      : new Date(trimmed);
    return Number.isNaN(candidate.getTime()) ? fallback : candidate;
  };

  const createSuperAdminOrganizationWithInvite: AuthContextType['createSuperAdminOrganizationWithInvite'] = async (
    input
  ) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const cleanOrgName = input.name.trim();
    const cleanOwnerName = input.ownerName.trim();
    const emailNormalized = normalizeEmail(input.ownerEmail);
    if (cleanOrgName.length < 2) {
      throw new Error('اسم المؤسسة يجب أن يكون حرفين على الأقل.');
    }
    if (!isValidNormalizedEmailDocId(emailNormalized)) {
      throw new Error('بريد Google للمدير غير صالح.');
    }
    if (!cleanOwnerName) {
      throw new Error('اسم المدير مطلوب.');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const startDate = parseDateInputOrFallback(input.startDateIso, now);
    const computedEndDate = input.endDateIso
      ? parseDateInputOrFallback(input.endDateIso, calculateSubscriptionEndDate(startDate, input.subscriptionPlan))
      : calculateSubscriptionEndDate(startDate, input.subscriptionPlan);

    if (computedEndDate.getTime() <= startDate.getTime()) {
      throw new Error('تاريخ نهاية الاشتراك يجب أن يكون بعد تاريخ البداية.');
    }

    const existingInvSnap = await getDocFromServer(doc(db, 'managerInvites', emailNormalized)).catch(() =>
      getDoc(doc(db, 'managerInvites', emailNormalized))
    );
    if (existingInvSnap.exists()) {
      const existingInv = existingInvSnap.data() as ManagerInvite;
      if (existingInv.status === 'accepted') {
        throw new Error('هذا البريد مرتبط بدعوة تم قبولها مسبقاً ولا يمكن إعادة إصدارها كدعوة أولية.');
      }
    }

    const orgId = `org_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const branchId = `br_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();

    const setupFeePaidAt =
      input.setupFeeStatus === 'paid'
        ? Timestamp.fromDate(parseDateInputOrFallback(input.setupFeePaidDateIso, now))
        : null;

    const firstBranchName = (input.firstBranchName || 'الفرع الرئيسي').trim() || 'الفرع الرئيسي';
    const firstBranchCode = (input.firstBranchCode || 'MAIN').trim().toUpperCase().slice(0, 20) || 'MAIN';
    const defaultNextMonth = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const branchDueDate = parseDateInputOrFallback(input.firstBranchDueDateIso, defaultNextMonth);
    const isFirstBranchPaid = input.firstBranchPaymentStatus === 'paid' || input.firstBranchPaymentStatus === 'exempt';

    const graceDueDate = new Date(now.getTime() + NO_PAID_BRANCH_GRACE_DAYS * 24 * 60 * 60 * 1000);

    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', orgId), {
      id: orgId,
      name: cleanOrgName,
      ...(input.taxNumber?.trim() ? { taxNumber: input.taxNumber.trim().slice(0, 40) } : {}),
      ...(input.commercialRegistration?.trim()
        ? { commercialRegistration: input.commercialRegistration.trim().slice(0, 50) }
        : {}),
      activityType: input.activityType || 'retail',
      currency: input.currency || 'SAR',
      ownerEmail: input.ownerEmail.trim(),
      ownerName: cleanOwnerName,
      driveConnected: false,
      isActive: true,
      subscriptionPlan: input.subscriptionPlan,
      subscriptionStatus: 'active',
      subscriptionStartAt: Timestamp.fromDate(startDate),
      subscriptionEndAt: Timestamp.fromDate(computedEndDate),
      subscriptionUpdatedAt: serverTimestamp(),
      subscriptionUpdatedBy: actorEmail,
      ...(input.subscriptionNote?.trim() ? { subscriptionNote: input.subscriptionNote.trim().slice(0, 500) } : {}),
      branchPricingModel: BRANCH_PRICING_MODEL,
      includedBranchesCount: NEW_ORG_INCLUDED_BRANCHES_COUNT,
      extraBranchMonthlyFeeSar: BRANCH_MONTHLY_FEE_SAR,
      extraBranchesCount: 1,
      extraBranchesMonthlyTotalSar: BRANCH_MONTHLY_FEE_SAR,
      branchPricingUpdatedAt: serverTimestamp(),
      branchPricingUpdatedBy: actorEmail,
      accountSetupFeeSar: ACCOUNT_SETUP_FEE_SAR,
      setupFeeStatus: input.setupFeeStatus,
      setupFeePaidAt,
      reactivationFeeSar: ORG_REACTIVATION_FEE_SAR,
      reactivationFeeStatus: 'waived',
      ...(!isFirstBranchPaid
        ? {
            noPaidBranchGraceStartedAt: Timestamp.fromDate(now),
            deactivationDueAt: Timestamp.fromDate(graceDueDate),
          }
        : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    batch.set(doc(db, 'branches', branchId), {
      id: branchId,
      orgId,
      name: firstBranchName,
      code: firstBranchCode,
      isActive: true,
      lifecycleStatus: 'active',
      subscriptionStartAt: Timestamp.fromDate(startDate),
      feeDueAt: Timestamp.fromDate(branchDueDate),
      monthlyFeeSar: BRANCH_MONTHLY_FEE_SAR,
      paymentStatus: input.firstBranchPaymentStatus,
      lastPaidAt: isFirstBranchPaid ? Timestamp.fromDate(now) : null,
      lastPaidBy: isFirstBranchPaid ? actorEmail : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const inviteRef = doc(db, 'managerInvites', emailNormalized);
    if (existingInvSnap.exists()) {
      batch.update(inviteRef, {
        email: input.ownerEmail.trim(),
        orgId,
        orgName: cleanOrgName.slice(0, 120),
        managerName: cleanOwnerName.slice(0, 100),
        status: 'pending',
        updatedAt: serverTimestamp(),
        cancelledAt: deleteField(),
      });
    } else {
      batch.set(inviteRef, {
        id: emailNormalized,
        email: input.ownerEmail.trim(),
        emailNormalized,
        orgId,
        orgName: cleanOrgName.slice(0, 120),
        managerName: cleanOwnerName.slice(0, 100),
        role: 'manager',
        status: 'pending',
        createdAt: serverTimestamp(),
        createdBy: actorEmail,
        updatedAt: serverTimestamp(),
      });
    }

    const auditLog = createPlatformAuditPayload({
      actor,
      action: 'ORG_CREATED_WITH_INVITE',
      targetType: 'organization',
      targetId: orgId,
      orgId,
      details: `إنشاء مؤسسة جديدة "${cleanOrgName}" مع فرع أول (${firstBranchName}) ودعوة المدير ${emailNormalized} — رسوم تأسيس ${ACCOUNT_SETUP_FEE_SAR} ر.س (${input.setupFeeStatus})`,
      metadata: {
        branchId,
        inviteEmail: emailNormalized,
        setupFeeSar: ACCOUNT_SETUP_FEE_SAR,
        setupFeeStatus: input.setupFeeStatus,
        branchFeeSar: BRANCH_MONTHLY_FEE_SAR,
      },
    });
    batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
    const saOrgNotif = buildSuperAdminPlatformNotification({
      dedupKey: `sa_org_created:${orgId}`,
      category: 'org_branches',
      type: 'SA_ORG_CREATED',
      severity: 'success',
      relatedOrgId: orgId,
      branchId,
      branchName: firstBranchName,
      actorUid: actor.uid,
      actorName: actor.displayName || actorEmail,
      title: `تأسيس مؤسسة "${cleanOrgName}"`,
      body: `تم إنشاء المؤسسة مع الفرع الرئيسي "${firstBranchName}" وإصدار دعوة المدير ${emailNormalized}.`,
      targetType: 'organization',
      targetId: orgId,
      tab: 'organizations',
      createdAt: nowIso,
    });
    batch.set(doc(db, 'notifications', saOrgNotif.id), saOrgNotif);

    await batch.commit();
    await loadSuperAdminOverview();
    return { orgId, branchId, inviteEmail: emailNormalized };
  };

  const updateSuperAdminOrganizationProfileAndBilling: AuthContextType['updateSuperAdminOrganizationProfileAndBilling'] =
    async (input) => {
      const actor = assertAuthorizedSuperAdmin();
      await actor.getIdToken();

      const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
      const orgRef = doc(db, 'organizations', input.orgId);
      const orgSnap = await getDocFromServer(orgRef).catch(() => getDoc(orgRef));
      if (!orgSnap.exists()) {
        throw new Error('المؤسسة غير موجودة.');
      }
      const existingOrg = orgSnap.data() as Organization;
      const now = new Date();
      const nowIso = now.toISOString();
      const subEval = evaluateOrganizationSubscription(existingOrg, now);
      const nextOwnerEmailClean = input.ownerEmail.trim();
      const prevOwnerEmailLower = (existingOrg.ownerEmail || '').trim().toLowerCase();
      const nextOwnerEmailLower = nextOwnerEmailClean.toLowerCase();
      const ownerEmailChangedWhileExempt =
        existingOrg.billingExempt === true && nextOwnerEmailLower !== prevOwnerEmailLower;

      const updatePayload: Record<string, any> = {
        name: input.name.trim(),
        taxNumber: (input.taxNumber || '').trim().slice(0, 40),
        commercialRegistration: (input.commercialRegistration || '').trim().slice(0, 50),
        activityType: input.activityType || existingOrg.activityType || 'retail',
        currency: input.currency || existingOrg.currency || 'SAR',
        ownerName: input.ownerName.trim().slice(0, 100),
        ownerEmail: nextOwnerEmailClean,
        updatedAt: nowIso,
      };

      const shouldConfigureSubscription =
        !subEval.isBillingExempt &&
        (!subEval.isLegacy || input.convertLegacyToPaid === true);

      if (shouldConfigureSubscription && input.subscriptionPlan && input.startDateIso) {
        const startDate = parseDateInputOrFallback(input.startDateIso, now);
        const endDate = input.endDateIso
          ? parseDateInputOrFallback(
              input.endDateIso,
              calculateSubscriptionEndDate(startDate, input.subscriptionPlan)
            )
          : calculateSubscriptionEndDate(startDate, input.subscriptionPlan);

        if (endDate.getTime() <= startDate.getTime()) {
          throw new Error('تاريخ نهاية الاشتراك يجب أن يكون بعد تاريخ البداية.');
        }

        updatePayload.subscriptionPlan = input.subscriptionPlan;
        updatePayload.subscriptionStatus = input.subscriptionStatus || 'active';
        updatePayload.subscriptionStartAt = Timestamp.fromDate(startDate);
        updatePayload.subscriptionEndAt = Timestamp.fromDate(endDate);
        updatePayload.subscriptionUpdatedAt = serverTimestamp();
        updatePayload.subscriptionUpdatedBy = actorEmail;
        if (input.subscriptionNote !== undefined) {
          updatePayload.subscriptionNote = input.subscriptionNote.trim().slice(0, 500);
        }
        if (input.convertLegacyToPaid) {
          updatePayload.branchPricingModel = BRANCH_PRICING_MODEL;
          updatePayload.includedBranchesCount = NEW_ORG_INCLUDED_BRANCHES_COUNT;
          updatePayload.extraBranchMonthlyFeeSar = BRANCH_MONTHLY_FEE_SAR;
          updatePayload.accountSetupFeeSar = existingOrg.accountSetupFeeSar ?? ACCOUNT_SETUP_FEE_SAR;
          updatePayload.setupFeeStatus = input.setupFeeStatus || 'waived';
          updatePayload.reactivationFeeSar = ORG_REACTIVATION_FEE_SAR;
        }
      }

      // Never overwrite or charge setup fees on a permanently billing-exempt organization
      if (!subEval.isBillingExempt && input.setupFeeStatus) {
        updatePayload.accountSetupFeeSar = existingOrg.accountSetupFeeSar ?? ACCOUNT_SETUP_FEE_SAR;
        updatePayload.setupFeeStatus = input.setupFeeStatus;
        updatePayload.setupFeePaidAt =
          input.setupFeeStatus === 'paid'
            ? Timestamp.fromDate(parseDateInputOrFallback(input.setupFeePaidDateIso, now))
            : null;
      }

      const batch = writeBatch(db);

      // If ownerEmail changes while org is billing-exempt, atomically revoke exemption + write coupled audit log
      let autoRevokeAuditLog: PlatformAuditLog | null = null;
      if (ownerEmailChangedWhileExempt) {
        const autoRevokeAction = resolveOrgExemptionRevokeAuditAction(existingOrg.billingExemptMode);
        const autoRevokeReason = `إلغاء تلقائي للإعفاء الدائم بسبب تغيير بريد المالك من ${prevOwnerEmailLower} إلى ${nextOwnerEmailLower}`;
        autoRevokeAuditLog = createPlatformAuditPayload({
          actor,
          action: autoRevokeAction,
          targetType: 'billing',
          targetId: input.orgId,
          orgId: input.orgId,
          details: `إلغاء تلقائي للإعفاء الدائم لمؤسسة "${input.name.trim()}" بسبب تغيير بريد المالك (${prevOwnerEmailLower} → ${nextOwnerEmailLower})`,
          metadata: {
            orgId: input.orgId,
            previousMode: existingOrg.billingExemptMode || 'billing_exempt',
            previousOwnerEmail: prevOwnerEmailLower,
            newOwnerEmail: nextOwnerEmailLower,
            reason: autoRevokeReason,
            autoRevokedOnOwnerChange: true,
          },
        });
        updatePayload.billingExempt = false;
        updatePayload.billingExemptRevokedAt = Timestamp.fromDate(now);
        updatePayload.billingExemptRevokedBy = actorEmail;
        updatePayload.billingExemptRevokeReason = autoRevokeReason.slice(0, 500);
        updatePayload.billingExemptLastAuditLogId = autoRevokeAuditLog.id;
      }

      batch.update(orgRef, updatePayload);

      if (autoRevokeAuditLog) {
        batch.set(doc(db, 'platformAuditLogs', autoRevokeAuditLog.id), autoRevokeAuditLog);
      }

      const action: PlatformAuditAction = input.convertLegacyToPaid
        ? 'LEGACY_CONVERTED_TO_PAID'
        : !subEval.isBillingExempt && input.setupFeeStatus && input.setupFeeStatus !== existingOrg.setupFeeStatus
        ? 'SETUP_FEE_UPDATED'
        : 'ORG_PROFILE_UPDATED';

      const auditLog = createPlatformAuditPayload({
        actor,
        action,
        targetType: 'organization',
        targetId: input.orgId,
        orgId: input.orgId,
        details: input.convertLegacyToPaid
          ? `تحويل المؤسسة القديمة "${input.name.trim()}" إلى الاشتراك المدفوع يدوياً دون رسوم بأثر رجعي`
          : `تحديث بيانات/فوترة المؤسسة "${input.name.trim()}" (الرقم الضريبي: ${updatePayload.taxNumber || '—'}، حالة التأسيس: ${subEval.isBillingExempt ? 'billing_exempt' : updatePayload.setupFeeStatus || existingOrg.setupFeeStatus || 'legacy'})`,
      });
      batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);

      await batch.commit();
      await loadSuperAdminOverview();
    };

  const updateSuperAdminOrgStatus: AuthContextType['updateSuperAdminOrgStatus'] = async (input) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
    const orgRef = doc(db, 'organizations', input.orgId);
    const orgSnap = await getDocFromServer(orgRef).catch(() => getDoc(orgRef));
    if (!orgSnap.exists()) {
      throw new Error('المؤسسة غير موجودة.');
    }
    const existingOrg = orgSnap.data() as Organization;
    const subEval = evaluateOrganizationSubscription(existingOrg);
    const now = new Date();
    const nowIso = now.toISOString();

    const batch = writeBatch(db);
    let action: PlatformAuditAction = 'ORG_SUSPENDED';
    let details = '';

    if (input.action === 'suspend') {
      batch.update(orgRef, {
        isActive: false,
        deactivationReason: input.reason || 'manual_suspension',
        deactivatedAt: Timestamp.fromDate(now),
        // Preserve historical subscriptionStatus for legacy and permanently billing-exempt organizations
        ...(subEval.isFeeExempt ? {} : { subscriptionStatus: 'suspended' }),
        updatedAt: nowIso,
      });
      action = 'ORG_SUSPENDED';
      details = `إيقاف المؤسسة "${existingOrg.name}" (${input.reason || 'manual_suspension'})`;
    } else if (input.action === 'start_no_paid_branch_grace') {
      if (subEval.isFeeExempt) {
        throw new Error('لا يمكن تفعيل مهلة عدم وجود فروع مدفوعة لمؤسسة معفاة من الرسوم.');
      }
      const graceDue = new Date(now.getTime() + NO_PAID_BRANCH_GRACE_DAYS * 24 * 60 * 60 * 1000);
      batch.update(orgRef, {
        noPaidBranchGraceStartedAt: Timestamp.fromDate(now),
        deactivationDueAt: Timestamp.fromDate(graceDue),
        deactivationReason: 'no_paid_branches',
        updatedAt: nowIso,
      });
      action = 'ORG_DEACTIVATED_NO_PAID_BRANCHES';
      details = `بدء مهلة 7 أيام لعدم وجود فروع مدفوعة للمؤسسة "${existingOrg.name}" حتى ${graceDue.toISOString().slice(0, 10)}`;
    } else if (input.action === 'deactivate_no_paid_branches') {
      if (subEval.isFeeExempt) {
        throw new Error('لا يمكن تعطيل مؤسسة معفاة من الرسوم بسبب عدم وجود فروع مدفوعة.');
      }
      batch.update(orgRef, {
        isActive: false,
        deactivationReason: 'no_paid_branches',
        deactivatedAt: Timestamp.fromDate(now),
        reactivationFeeSar: ORG_REACTIVATION_FEE_SAR,
        reactivationFeeStatus: 'unpaid',
        reactivationFeePaidAt: null,
        updatedAt: nowIso,
      });
      action = 'ORG_DEACTIVATED_NO_PAID_BRANCHES';
      details = `تعطيل المؤسسة "${existingOrg.name}" لانتهاء المهلة دون فروع مدفوعة — رسوم إعادة التنشيط ${ORG_REACTIVATION_FEE_SAR} ر.س`;
    } else if (input.action === 'reactivate') {
      const feeStatus: FeePaymentStatus = subEval.isFeeExempt
        ? 'waived'
        : input.reactivationFeeStatus || 'paid';
      if (!subEval.isFeeExempt && existingOrg.deactivationReason === 'no_paid_branches' && feeStatus === 'unpaid') {
        throw new Error('يجب تسجيل سداد أو إعفاء رسوم إعادة التنشيط (10 ر.س) قبل إعادة تفعيل المؤسسة.');
      }
      const paidDate = parseDateInputOrFallback(input.reactivationFeePaidDateIso, now);
      batch.update(orgRef, {
        isActive: true,
        deactivationReason: null,
        noPaidBranchGraceStartedAt: null,
        deactivationDueAt: null,
        deactivatedAt: null,
        ...(subEval.isBillingExempt
          ? {}
          : {
              reactivationFeeSar: subEval.isFeeExempt ? 0 : ORG_REACTIVATION_FEE_SAR,
              reactivationFeeStatus: feeStatus,
              reactivationFeePaidAt: feeStatus === 'paid' ? Timestamp.fromDate(paidDate) : null,
            }),
        reactivatedAt: Timestamp.fromDate(now),
        reactivatedBy: actorEmail,
        // Preserve historical subscriptionStatus for legacy and permanently billing-exempt organizations
        ...(subEval.isFeeExempt ? {} : { subscriptionStatus: 'active' }),
        ...(input.note?.trim() ? { subscriptionNote: input.note.trim().slice(0, 500) } : {}),
        updatedAt: nowIso,
      });
      action = 'ORG_REACTIVATED';
      details = subEval.isBillingExempt
        ? `إعادة تنشيط المؤسسة المعفاة دائماً "${existingOrg.name}" دون أي رسوم (0 ر.س)`
        : `إعادة تنشيط المؤسسة "${existingOrg.name}" (رسوم إعادة التنشيط ${subEval.isFeeExempt ? 0 : ORG_REACTIVATION_FEE_SAR} ر.س: ${feeStatus})`;
    }

    const auditLog = createPlatformAuditPayload({
      actor,
      action,
      targetType: 'organization',
      targetId: input.orgId,
      orgId: input.orgId,
      details,
    });
    batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
    const saStatusNotif = buildSuperAdminPlatformNotification({
      dedupKey: `sa_org_status:${input.orgId}:${action}:${nowIso}`,
      category: 'security_admin',
      type: `SA_${action}`,
      severity: action === 'ORG_REACTIVATED' ? 'success' : 'warning',
      relatedOrgId: input.orgId,
      actorUid: actor.uid,
      actorName: actor.displayName || actorEmail,
      title: action === 'ORG_REACTIVATED' ? `إعادة تنشيط "${existingOrg.name}"` : `تحديث حالة "${existingOrg.name}"`,
      body: details,
      targetType: 'organization',
      targetId: input.orgId,
      tab: 'organizations',
      createdAt: nowIso,
    });
    batch.set(doc(db, 'notifications', saStatusNotif.id), saStatusNotif);

    await batch.commit();
    await loadSuperAdminOverview();
  };

  const grantSuperAdminOrgBillingExemption: AuthContextType['grantSuperAdminOrgBillingExemption'] = async (
    input
  ) => {
    return inFlightSuperAdminActionsRef.current.runExclusive(`org_exempt_grant:${input.orgId}`, async () => {
      const actor = assertAuthorizedSuperAdmin();
      await actor.getIdToken();

      const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
      const orgRef = doc(db, 'organizations', input.orgId);
      const orgSnap = await getDocFromServer(orgRef).catch(() => getDoc(orgRef));
      if (!orgSnap.exists()) {
        throw new Error('المؤسسة غير موجودة.');
      }
      const existingOrg = orgSnap.data() as Organization;

      const ownerIdClean = (existingOrg.ownerId || '').trim();
      let ownerUser: UserProfile | null = null;
      if (ownerIdClean) {
        const ownerUserRef = doc(db, 'users', ownerIdClean);
        const ownerUserSnap = await getDocFromServer(ownerUserRef).catch(() => getDoc(ownerUserRef));
        if (ownerUserSnap.exists()) {
          ownerUser = ownerUserSnap.data() as UserProfile;
        }
      }

      const orgBranchesSnap = await getDocs(
        query(collection(db, 'branches'), where('orgId', '==', existingOrg.id))
      );
      const orgBranches = orgBranchesSnap.docs.map((d) => d.data() as Branch);

      const now = new Date();
      const mode: ExemptionClassification =
        input.mode === 'legacy_unrestricted' ? 'legacy_unrestricted' : 'billing_exempt';

      const { orgPatch, auditLog, ownerId, ownerEmail } = buildSuperAdminOrgExemptionGrantBundle({
        actor: {
          uid: actor.uid,
          email: actor.email,
          emailVerified: actor.emailVerified,
          displayName: actor.displayName,
        },
        org: existingOrg,
        ownerUser,
        orgBranches,
        mode,
        reason: input.reason,
        expectedOwnerEmail: input.expectedOwnerEmail,
        now,
        grantedAtValue: Timestamp.fromDate(now),
      });

      const batch = writeBatch(db);
      batch.update(orgRef, orgPatch);
      batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
      const saGrantNotif = buildSuperAdminPlatformNotification({
        dedupKey: `sa_org_billing_exempt_grant:${existingOrg.id}:${auditLog.id}`,
        category: 'security_admin',
        type:
          mode === 'legacy_unrestricted'
            ? 'SA_ORG_LEGACY_UNRESTRICTED_GRANTED'
            : 'SA_ORG_BILLING_EXEMPTION_GRANTED',
        severity: 'success',
        relatedOrgId: existingOrg.id,
        actorUid: actor.uid,
        actorName: actor.displayName || actorEmail,
        title:
          mode === 'legacy_unrestricted'
            ? `اعتماد إعفاء legacy_unrestricted لمؤسسة "${existingOrg.name}"`
            : `اعتماد الإعفاء الدائم الشامل لمؤسسة "${existingOrg.name}"`,
        body: `تم منح الإعفاء الدائم (${mode}) للمالك الموثق ${ownerEmail} مع الاحتفاظ بكامل السجلات التاريخية.`,
        targetType: 'organization',
        targetId: existingOrg.id,
        tab: 'organizations',
        createdAt: now.toISOString(),
      });
      batch.set(doc(db, 'notifications', saGrantNotif.id), saGrantNotif);

      await batch.commit();
      await loadSuperAdminOverview();
      return { auditLogId: auditLog.id, ownerId, ownerEmail };
    });
  };

  const revokeSuperAdminOrgBillingExemption: AuthContextType['revokeSuperAdminOrgBillingExemption'] = async (
    input
  ) => {
    return inFlightSuperAdminActionsRef.current.runExclusive(`org_exempt_revoke:${input.orgId}`, async () => {
      const actor = assertAuthorizedSuperAdmin();
      await actor.getIdToken();

      const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
      const orgRef = doc(db, 'organizations', input.orgId);
      const orgSnap = await getDocFromServer(orgRef).catch(() => getDoc(orgRef));
      if (!orgSnap.exists()) {
        throw new Error('المؤسسة غير موجودة.');
      }
      const existingOrg = orgSnap.data() as Organization;
      const now = new Date();

      const { orgPatch, auditLog } = buildSuperAdminOrgExemptionRevokeBundle({
        actor: {
          uid: actor.uid,
          email: actor.email,
          emailVerified: actor.emailVerified,
          displayName: actor.displayName,
        },
        org: existingOrg,
        reason: input.reason,
        now,
        revokedAtValue: Timestamp.fromDate(now),
      });

      const batch = writeBatch(db);
      batch.update(orgRef, orgPatch);
      batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
      const saRevokeNotif = buildSuperAdminPlatformNotification({
        dedupKey: `sa_org_billing_exempt_revoke:${existingOrg.id}:${auditLog.id}`,
        category: 'security_admin',
        type:
          auditLog.action === 'ORG_LEGACY_UNRESTRICTED_REVOKED'
            ? 'SA_ORG_LEGACY_UNRESTRICTED_REVOKED'
            : 'SA_ORG_BILLING_EXEMPTION_REVOKED',
        severity: 'warning',
        relatedOrgId: existingOrg.id,
        actorUid: actor.uid,
        actorName: actor.displayName || actorEmail,
        title: `إلغاء الإعفاء الدائم لمؤسسة "${existingOrg.name}"`,
        body: `تم إلغاء الإعفاء الدائم وإعادة المؤسسة إلى نظام الاشتراكات القياسي مع حفظ كامل السجلات التاريخية.`,
        targetType: 'organization',
        targetId: existingOrg.id,
        tab: 'organizations',
        createdAt: now.toISOString(),
      });
      batch.set(doc(db, 'notifications', saRevokeNotif.id), saRevokeNotif);

      await batch.commit();
      await loadSuperAdminOverview();
      return { auditLogId: auditLog.id };
    });
  };

  const upsertSuperAdminManagerInvite: AuthContextType['upsertSuperAdminManagerInvite'] = async (
    input
  ) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const emailNormalized = normalizeEmail(input.email);
    if (!isValidNormalizedEmailDocId(emailNormalized)) {
      throw new Error('بريد Google غير صالح.');
    }

    const orgSnap = await getDocFromServer(doc(db, 'organizations', input.orgId)).catch(() =>
      getDoc(doc(db, 'organizations', input.orgId))
    );
    if (!orgSnap.exists()) {
      throw new Error('المؤسسة المستهدفة غير موجودة.');
    }
    const org = orgSnap.data() as Organization;
    const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
    const invRef = doc(db, 'managerInvites', emailNormalized);
    const invSnap = await getDocFromServer(invRef).catch(() => getDoc(invRef));
    const managerName = (input.managerName || org.ownerName || 'مدير المؤسسة').trim().slice(0, 100);

    const batch = writeBatch(db);
    if (invSnap.exists()) {
      const existingInv = invSnap.data() as ManagerInvite;
      if (existingInv.status === 'accepted') {
        throw new Error('تم قبول هذه الدعوة مسبقاً من حساب مدير آخر.');
      }
      batch.update(invRef, {
        email: input.email.trim(),
        orgId: input.orgId,
        orgName: org.name.slice(0, 120),
        managerName,
        status: 'pending',
        updatedAt: serverTimestamp(),
        cancelledAt: deleteField(),
      });
    } else {
      batch.set(invRef, {
        id: emailNormalized,
        email: input.email.trim(),
        emailNormalized,
        orgId: input.orgId,
        orgName: org.name.slice(0, 120),
        managerName,
        role: 'manager',
        status: 'pending',
        createdAt: serverTimestamp(),
        createdBy: actorEmail,
        updatedAt: serverTimestamp(),
      });
    }

    const auditLog = createPlatformAuditPayload({
      actor,
      action: 'INVITE_UPSERTED',
      targetType: 'invite',
      targetId: emailNormalized,
      orgId: input.orgId,
      details: `إصدار / تحديث دعوة المدير ${emailNormalized} للمؤسسة "${org.name}"`,
    });
    batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);

    await batch.commit();
    await loadSuperAdminOverview();
  };

  const cancelSuperAdminManagerInvite: AuthContextType['cancelSuperAdminManagerInvite'] = async (
    email
  ) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const emailNormalized = normalizeEmail(email);
    const invRef = doc(db, 'managerInvites', emailNormalized);
    const invSnap = await getDocFromServer(invRef).catch(() => getDoc(invRef));
    if (!invSnap.exists()) {
      throw new Error('الدعوة غير موجودة.');
    }
    const existingInv = invSnap.data() as ManagerInvite;
    if (existingInv.status === 'accepted') {
      throw new Error('لا يمكن إلغاء دعوة تم قبولها بالفعل.');
    }

    const batch = writeBatch(db);
    batch.update(invRef, {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const auditLog = createPlatformAuditPayload({
      actor,
      action: 'INVITE_CANCELLED',
      targetType: 'invite',
      targetId: emailNormalized,
      orgId: existingInv.orgId,
      details: `إلغاء دعوة المدير ${emailNormalized} التابعة للمؤسسة ${existingInv.orgId}`,
    });
    batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);

    await batch.commit();
    await loadSuperAdminOverview();
  };

  const syncOrgBranchBillingTotalsInBatch = async (
    batch: ReturnType<typeof writeBatch>,
    org: Organization,
    updatedBranches: Branch[],
    now: Date,
    actorEmail: string
  ) => {
    const subEval = evaluateOrganizationSubscription(org, now);
    if (subEval.isFeeExempt) return;

    const paidBranches = updatedBranches.filter((b) => isBranchCountedAsPaid(b, org, now));
    const pricingEval = evaluateOrganizationBranchPricing({
      org,
      branches: updatedBranches,
      now,
    });

    const orgUpdate: Record<string, any> = {
      extraBranchesCount: pricingEval.billableBranchesCount,
      extraBranchesMonthlyTotalSar: pricingEval.estimatedMonthlyBranchTotalSar,
      branchPricingUpdatedAt: serverTimestamp(),
      branchPricingUpdatedBy: actorEmail,
      updatedAt: now.toISOString(),
    };

    if (paidBranches.length > 0 && org.isActive !== false) {
      orgUpdate.noPaidBranchGraceStartedAt = null;
      orgUpdate.deactivationDueAt = null;
      if (org.deactivationReason === 'no_paid_branches') {
        orgUpdate.deactivationReason = null;
      }
    } else if (paidBranches.length === 0 && org.isActive !== false && !org.deactivationDueAt) {
      const graceDue = new Date(now.getTime() + NO_PAID_BRANCH_GRACE_DAYS * 24 * 60 * 60 * 1000);
      orgUpdate.noPaidBranchGraceStartedAt = Timestamp.fromDate(now);
      orgUpdate.deactivationDueAt = Timestamp.fromDate(graceDue);
      orgUpdate.deactivationReason = 'no_paid_branches';
    }

    batch.update(doc(db, 'organizations', org.id), orgUpdate);
  };

  const createSuperAdminBranch: AuthContextType['createSuperAdminBranch'] = async (input) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const cleanName = input.name.trim();
    if (cleanName.length < 2) {
      throw new Error('اسم الفرع يجب أن يكون حرفين على الأقل.');
    }

    const orgSnap = await getDocFromServer(doc(db, 'organizations', input.orgId)).catch(() =>
      getDoc(doc(db, 'organizations', input.orgId))
    );
    if (!orgSnap.exists()) {
      throw new Error('المؤسسة غير موجودة.');
    }
    const org = orgSnap.data() as Organization;
    const subEval = evaluateOrganizationSubscription(org);
    const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();

    const now = new Date();
    const nowIso = now.toISOString();
    const startDate = parseDateInputOrFallback(input.subscriptionStartIso, now);
    const dueDate = parseDateInputOrFallback(
      input.feeDueDateIso,
      new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000)
    );
    const branchId = `br_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const code = (input.code || `BR${Math.floor(100 + Math.random() * 900)}`).trim().toUpperCase().slice(0, 20);
    const paymentStatus: BranchPaymentStatus = subEval.isFeeExempt ? 'exempt' : input.paymentStatus;
    const monthlyFeeSar = subEval.isFeeExempt ? 0 : BRANCH_MONTHLY_FEE_SAR;
    const isPaid = paymentStatus === 'paid' || paymentStatus === 'exempt';
    const defaultExemptNote = subEval.isBillingExempt
      ? 'معفى تلقائياً ضمن الإعفاء الدائم الشامل للمؤسسة (0 ر.س)'
      : undefined;
    const resolvedPaymentNote = input.paymentNote?.trim()
      ? input.paymentNote.trim().slice(0, 500)
      : defaultExemptNote;

    const newBranch: Branch = {
      id: branchId,
      orgId: input.orgId,
      name: cleanName,
      code,
      ...(input.address?.trim() ? { address: input.address.trim().slice(0, 255) } : {}),
      ...(input.phone?.trim() ? { phone: input.phone.trim().slice(0, 25) } : {}),
      isActive: true,
      lifecycleStatus: 'active',
      subscriptionStartAt: Timestamp.fromDate(startDate),
      feeDueAt: subEval.isFeeExempt ? null : Timestamp.fromDate(dueDate),
      monthlyFeeSar,
      paymentStatus,
      ...(isPaid ? { lastPaidAt: Timestamp.fromDate(now), lastPaidBy: actorEmail } : {}),
      ...(resolvedPaymentNote ? { paymentNote: resolvedPaymentNote } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const existingOrgBranchesSnap = await getDocs(
      query(collection(db, 'branches'), where('orgId', '==', input.orgId))
    );
    const existingOrgBranches = existingOrgBranchesSnap.docs.map((d) => d.data() as Branch);

    const batch = writeBatch(db);
    batch.set(doc(db, 'branches', branchId), newBranch);
    await syncOrgBranchBillingTotalsInBatch(
      batch,
      org,
      [...existingOrgBranches, newBranch],
      now,
      actorEmail
    );

    const auditLog = createPlatformAuditPayload({
      actor,
      action: 'BRANCH_CREATED',
      targetType: 'branch',
      targetId: branchId,
      orgId: input.orgId,
      details: `إضافة فرع جديد "${cleanName}" (${code}) للمؤسسة "${org.name}" — ${monthlyFeeSar} ر.س/شهرياً (${paymentStatus})`,
    });
    batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
    const saBranchAddNotif = buildSuperAdminPlatformNotification({
      dedupKey: `sa_branch_created:${branchId}`,
      category: 'org_branches',
      type: 'SA_BRANCH_CREATED',
      severity: 'info',
      relatedOrgId: input.orgId,
      branchId,
      branchName: cleanName,
      actorUid: actor.uid,
      actorName: actor.displayName || actorEmail,
      title: `إضافة فرع "${cleanName}"`,
      body: `أُضيف الفرع (${code}) إلى مؤسسة "${org.name}" بحالة دفع (${paymentStatus}).`,
      targetType: 'branch',
      targetId: branchId,
      tab: 'branches',
      createdAt: nowIso,
    });
    batch.set(doc(db, 'notifications', saBranchAddNotif.id), saBranchAddNotif);

    await batch.commit();
    await loadSuperAdminOverview();
    return newBranch;
  };

  const recordSuperAdminBranchPayment: AuthContextType['recordSuperAdminBranchPayment'] = async (
    input
  ) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const branchRef = doc(db, 'branches', input.branchId);
    const branchSnap = await getDocFromServer(branchRef).catch(() => getDoc(branchRef));
    if (!branchSnap.exists()) {
      throw new Error('الفرع غير موجود.');
    }
    const existingBranch = branchSnap.data() as Branch;
    const orgSnap = await getDocFromServer(doc(db, 'organizations', existingBranch.orgId)).catch(() =>
      getDoc(doc(db, 'organizations', existingBranch.orgId))
    );
    if (!orgSnap.exists()) {
      throw new Error('المؤسسة غير موجودة.');
    }
    const org = orgSnap.data() as Organization;
    const subEval = evaluateOrganizationSubscription(org);
    if (existingBranch.billingExempt === true) {
      throw new Error(
        'هذا الفرع يحمل إعفاءً فردياً دائماً؛ لتغيير حالته إلى مدفوع أو غير مدفوع يرجى استخدام نافذة «إدارة إعفاء الفرع» وإلغاء الإعفاء بسجل تدقيق رسمي أولاً.'
      );
    }
    if (!subEval.isBillingExempt && input.paymentStatus === 'exempt' && existingBranch.paymentStatus !== 'exempt') {
      throw new Error(
        'لمنح إعفاء دائم للفرع بشكل رسمي وموثّق في سجل المنصة، يرجى استخدام زر «إعفاء الفرع» المخصص بدلاً من نافذة السداد.'
      );
    }
    const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
    const now = new Date();
    const paidDate = parseDateInputOrFallback(input.paidDateIso, now);
    const defaultNextDue = new Date(paidDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const dueDate = parseDateInputOrFallback(input.feeDueDateIso, defaultNextDue);
    const effectivePaymentStatus: BranchPaymentStatus = subEval.isBillingExempt
      ? 'exempt'
      : input.paymentStatus;
    const monthlyFeeSar = subEval.isBillingExempt
      ? 0
      : input.monthlyFeeSar ?? existingBranch.monthlyFeeSar ?? BRANCH_MONTHLY_FEE_SAR;

    const existingOrgBranchesSnap = await getDocs(
      query(collection(db, 'branches'), where('orgId', '==', existingBranch.orgId))
    );
    const updatedBranch: Branch = {
      ...existingBranch,
      monthlyFeeSar,
      paymentStatus: effectivePaymentStatus,
      feeDueAt: subEval.isBillingExempt ? null : Timestamp.fromDate(dueDate),
      lastPaidAt: effectivePaymentStatus === 'paid' ? Timestamp.fromDate(paidDate) : existingBranch.lastPaidAt,
      lastPaidBy: actorEmail,
      paymentNote: input.paymentNote?.trim().slice(0, 500) || existingBranch.paymentNote,
      updatedAt: now.toISOString(),
    };
    const mergedBranches = existingOrgBranchesSnap.docs.map((d) =>
      d.id === existingBranch.id ? updatedBranch : (d.data() as Branch)
    );

    const batch = writeBatch(db);
    batch.update(branchRef, {
      monthlyFeeSar,
      paymentStatus: effectivePaymentStatus,
      feeDueAt: subEval.isBillingExempt ? null : Timestamp.fromDate(dueDate),
      lastPaidAt:
        effectivePaymentStatus === 'paid'
          ? Timestamp.fromDate(paidDate)
          : existingBranch.lastPaidAt || null,
      lastPaidBy: actorEmail,
      paymentNote: input.paymentNote?.trim().slice(0, 500) || null,
      updatedAt: now.toISOString(),
    });
    await syncOrgBranchBillingTotalsInBatch(batch, org, mergedBranches, now, actorEmail);

    const auditLog = createPlatformAuditPayload({
      actor,
      action: 'BRANCH_PAYMENT_UPDATED',
      targetType: 'branch',
      targetId: existingBranch.id,
      orgId: existingBranch.orgId,
      details: `تحديث دفع فرع "${existingBranch.name}" إلى ${input.paymentStatus} (${monthlyFeeSar} ر.س) — الاستحقاق القادم ${dueDate.toISOString().slice(0, 10)}`,
    });
    batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);

    await batch.commit();
    await loadSuperAdminOverview();
  };

  const suspendSuperAdminBranch: AuthContextType['suspendSuperAdminBranch'] = async (input) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const branchRef = doc(db, 'branches', input.branchId);
    const branchSnap = await getDocFromServer(branchRef).catch(() => getDoc(branchRef));
    if (!branchSnap.exists()) {
      throw new Error('الفرع غير موجود.');
    }
    const existingBranch = branchSnap.data() as Branch;
    if (existingBranch.lifecycleStatus === 'purged_from_db') {
      throw new Error('تم تنظيف سجلات هذا الفرع من قاعدة البيانات مسبقاً.');
    }

    const orgSnap = await getDocFromServer(doc(db, 'organizations', existingBranch.orgId)).catch(() =>
      getDoc(doc(db, 'organizations', existingBranch.orgId))
    );
    if (!orgSnap.exists()) {
      throw new Error('المؤسسة غير موجودة.');
    }
    const org = orgSnap.data() as Organization;
    const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
    const now = new Date();
    const graceEnds = new Date(
      now.getTime() + BRANCH_SUSPENSION_GRACE_DAYS * 24 * 60 * 60 * 1000
    );

    const existingOrgBranchesSnap = await getDocs(
      query(collection(db, 'branches'), where('orgId', '==', existingBranch.orgId))
    );
    const updatedBranch: Branch = {
      ...existingBranch,
      isActive: false,
      lifecycleStatus: 'suspended',
      suspendedAt: Timestamp.fromDate(now),
      gracePeriodEndsAt: Timestamp.fromDate(graceEnds),
      driveBackupVerified: false,
    };
    const mergedBranches = existingOrgBranchesSnap.docs.map((d) =>
      d.id === existingBranch.id ? updatedBranch : (d.data() as Branch)
    );

    const batch = writeBatch(db);
    batch.update(branchRef, {
      isActive: false,
      lifecycleStatus: 'suspended',
      suspendedAt: Timestamp.fromDate(now),
      suspendedBy: actorEmail,
      suspensionReason: (input.reason || 'تعليق إداري من صاحب الموقع').trim().slice(0, 500),
      gracePeriodEndsAt: Timestamp.fromDate(graceEnds),
      driveBackupVerified: false,
      driveBackupVerifiedAt: null,
      driveBackupVerifiedBy: null,
      updatedAt: now.toISOString(),
    });
    await syncOrgBranchBillingTotalsInBatch(batch, org, mergedBranches, now, actorEmail);

    const auditLog = createPlatformAuditPayload({
      actor,
      action: 'BRANCH_SUSPENDED',
      targetType: 'branch',
      targetId: existingBranch.id,
      orgId: existingBranch.orgId,
      details: `تعليق فرع "${existingBranch.name}" وبدء مهلة 30 يوماً حتى ${graceEnds.toISOString().slice(0, 10)}`,
    });
    batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
    const saSuspendBranchNotif = buildSuperAdminPlatformNotification({
      dedupKey: `sa_branch_suspended:${existingBranch.id}:${now.toISOString()}`,
      category: 'org_branches',
      type: 'SA_BRANCH_SUSPENDED',
      severity: 'warning',
      relatedOrgId: existingBranch.orgId,
      branchId: existingBranch.id,
      branchName: existingBranch.name,
      actorUid: actor.uid,
      actorName: actor.displayName || actorEmail,
      title: `تعليق فرع "${existingBranch.name}"`,
      body: `تم تعليق فرع "${existingBranch.name}" لمؤسسة "${org.name}" وبدء مهلة 30 يوماً حتى ${graceEnds.toISOString().slice(0, 10)}.`,
      targetType: 'branch',
      targetId: existingBranch.id,
      tab: 'branches',
      createdAt: now.toISOString(),
    });
    batch.set(doc(db, 'notifications', saSuspendBranchNotif.id), saSuspendBranchNotif);

    await batch.commit();
    await loadSuperAdminOverview();
  };

  const reactivateSuperAdminBranch: AuthContextType['reactivateSuperAdminBranch'] = async (
    input
  ) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const branchRef = doc(db, 'branches', input.branchId);
    const branchSnap = await getDocFromServer(branchRef).catch(() => getDoc(branchRef));
    if (!branchSnap.exists()) {
      throw new Error('الفرع غير موجود.');
    }
    const existingBranch = branchSnap.data() as Branch;
    if (existingBranch.lifecycleStatus === 'purged_from_db') {
      throw new Error('لا يمكن إعادة تنشيط فرع تم حذف سجلاته من قاعدة البيانات؛ أضف فرعاً جديداً بدلاً من ذلك.');
    }

    const orgSnap = await getDocFromServer(doc(db, 'organizations', existingBranch.orgId)).catch(() =>
      getDoc(doc(db, 'organizations', existingBranch.orgId))
    );
    if (!orgSnap.exists()) {
      throw new Error('المؤسسة غير موجودة.');
    }
    const org = orgSnap.data() as Organization;
    const subEval = evaluateOrganizationSubscription(org);
    const isIndividuallyExempt = existingBranch.billingExempt === true;
    const branchIsFeeExempt = subEval.isFeeExempt || isIndividuallyExempt;
    if (!branchIsFeeExempt && input.paymentStatus === 'exempt') {
      throw new Error(
        'لمنح إعفاء دائم للفرع، أعد تنشيطه أولاً ثم استخدم زر «إعفاء الفرع» المخصص لتسجيل الإعفاء ذرياً في سجل التدقيق.'
      );
    }
    const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
    const now = new Date();
    const dueDate = parseDateInputOrFallback(
      input.feeDueDateIso,
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    );
    const paymentStatus: BranchPaymentStatus = branchIsFeeExempt ? 'exempt' : input.paymentStatus;
    const monthlyFeeSar = branchIsFeeExempt
      ? 0
      : existingBranch.monthlyFeeSar ?? BRANCH_MONTHLY_FEE_SAR;
    const isPaid = paymentStatus === 'paid' || paymentStatus === 'exempt';

    const existingOrgBranchesSnap = await getDocs(
      query(collection(db, 'branches'), where('orgId', '==', existingBranch.orgId))
    );
    const updatedBranch: Branch = {
      ...existingBranch,
      isActive: true,
      lifecycleStatus: 'active',
      monthlyFeeSar,
      paymentStatus,
      feeDueAt: branchIsFeeExempt ? null : Timestamp.fromDate(dueDate),
      driveBackupVerified: false,
    };
    const mergedBranches = existingOrgBranchesSnap.docs.map((d) =>
      d.id === existingBranch.id ? updatedBranch : (d.data() as Branch)
    );

    const batch = writeBatch(db);
    batch.update(branchRef, {
      isActive: true,
      lifecycleStatus: 'active',
      monthlyFeeSar,
      paymentStatus,
      feeDueAt: branchIsFeeExempt ? null : Timestamp.fromDate(dueDate),
      lastPaidAt: isPaid ? Timestamp.fromDate(now) : existingBranch.lastPaidAt || null,
      lastPaidBy: isPaid ? actorEmail : existingBranch.lastPaidBy || null,
      ...(input.paymentNote?.trim() ? { paymentNote: input.paymentNote.trim().slice(0, 500) } : {}),
      suspendedAt: null,
      suspendedBy: null,
      suspensionReason: null,
      gracePeriodEndsAt: null,
      driveBackupVerified: false,
      driveBackupVerifiedAt: null,
      driveBackupVerifiedBy: null,
      updatedAt: now.toISOString(),
    });
    await syncOrgBranchBillingTotalsInBatch(batch, org, mergedBranches, now, actorEmail);

    const auditLog = createPlatformAuditPayload({
      actor,
      action: 'BRANCH_REACTIVATED',
      targetType: 'branch',
      targetId: existingBranch.id,
      orgId: existingBranch.orgId,
      details: `إعادة تنشيط فرع "${existingBranch.name}" بحالة دفع ${paymentStatus} حتى ${dueDate.toISOString().slice(0, 10)}`,
    });
    batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
    const saReactivateBranchNotif = buildSuperAdminPlatformNotification({
      dedupKey: `sa_branch_reactivated:${existingBranch.id}:${now.toISOString()}`,
      category: 'org_branches',
      type: 'SA_BRANCH_REACTIVATED',
      severity: 'success',
      relatedOrgId: existingBranch.orgId,
      branchId: existingBranch.id,
      branchName: existingBranch.name,
      actorUid: actor.uid,
      actorName: actor.displayName || actorEmail,
      title: `إعادة تنشيط فرع "${existingBranch.name}"`,
      body: `تمت إعادة تنشيط فرع "${existingBranch.name}" بحالة دفع (${paymentStatus}) حتى ${dueDate.toISOString().slice(0, 10)}.`,
      targetType: 'branch',
      targetId: existingBranch.id,
      tab: 'branches',
      createdAt: now.toISOString(),
    });
    batch.set(doc(db, 'notifications', saReactivateBranchNotif.id), saReactivateBranchNotif);

    await batch.commit();
    await loadSuperAdminOverview();
  };

  const inspectBranchDriveBackupForPurge: AuthContextType['inspectBranchDriveBackupForPurge'] = async (
    branchId
  ) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const branchRef = doc(db, 'branches', branchId);
    const branchSnap = await getDocFromServer(branchRef).catch(() => getDoc(branchRef));
    if (!branchSnap.exists()) {
      throw new Error('الفرع غير موجود.');
    }
    const branch = branchSnap.data() as Branch;
    const now = new Date();
    const graceEnds = toValidDate(branch.gracePeriodEndsAt);
    if (branch.isActive !== false || branch.lifecycleStatus !== 'suspended') {
      return {
        verified: false,
        branchId,
        totalClosingsCount: 0,
        approvedClosingsCount: 0,
        verifiedArchivedCount: 0,
        unapprovedPendingCount: 0,
        missingOrUnverifiedClosingIds: [],
        failedOrStaleClosingIds: [],
        purchasesCount: 0,
        attachmentsCount: 0,
        reason: 'يجب أن يكون الفرع معلقاً أولاً للتحقق من الجاهزية للحذف.',
      };
    }
    if (!graceEnds || now.getTime() < graceEnds.getTime()) {
      return {
        verified: false,
        branchId,
        totalClosingsCount: 0,
        approvedClosingsCount: 0,
        verifiedArchivedCount: 0,
        unapprovedPendingCount: 0,
        missingOrUnverifiedClosingIds: [],
        failedOrStaleClosingIds: [],
        purchasesCount: 0,
        attachmentsCount: 0,
        reason: 'لم تنتهِ مهلة الـ 30 يوماً بعد تعليق الفرع بعد.',
      };
    }

    const [closingsSnap, archivesSnap, purchasesSnap, attachmentsSnap] = await Promise.all([
      getDocsFromServer(query(collection(db, 'closings'), where('branchId', '==', branchId))),
      getDocsFromServer(query(collection(db, 'closingArchives'), where('branchId', '==', branchId))),
      getDocsFromServer(query(collection(db, 'purchases'), where('branchId', '==', branchId))),
      getDocsFromServer(query(collection(db, 'attachments'), where('branchId', '==', branchId))),
    ]);

    const branchClosings = closingsSnap.docs.map((d) => d.data() as ShiftClosing);
    const branchArchives = archivesSnap.docs.map((d) => d.data() as ClosingArchiveRecord);

    const verification = verifyBranchDriveBackupCompleteness({
      branch,
      closings: branchClosings,
      archives: branchArchives,
      now,
    });

    const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
    const batch = writeBatch(db);
    if (verification.verified) {
      batch.update(branchRef, {
        driveBackupVerified: true,
        driveBackupVerifiedAt: Timestamp.fromDate(now),
        driveBackupVerifiedBy: actorEmail,
        driveBackupArchivedClosingsCount: verification.verifiedArchivedCount,
        updatedAt: now.toISOString(),
      });
      const auditLog = createPlatformAuditPayload({
        actor,
        action: 'BRANCH_DRIVE_BACKUP_VERIFIED',
        targetType: 'branch',
        targetId: branchId,
        orgId: branch.orgId,
        details: `التحقق من اكتمال النسخ الاحتياطي في Google Drive للفرع "${branch.name}" (${verification.verifiedArchivedCount}/${verification.approvedClosingsCount} إقفال معتمد)`,
      });
      batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
    } else {
      batch.update(branchRef, {
        driveBackupVerified: false,
        driveBackupVerifiedAt: null,
        driveBackupVerifiedBy: null,
        driveBackupArchivedClosingsCount: verification.verifiedArchivedCount,
        updatedAt: now.toISOString(),
      });
    }

    await batch.commit();
    await loadSuperAdminOverview();

    return {
      ...verification,
      purchasesCount: purchasesSnap.size,
      attachmentsCount: attachmentsSnap.size,
    };
  };

  const purgeSuspendedBranchFromDb: AuthContextType['purgeSuspendedBranchFromDb'] = async (
    branchId
  ) => {
    const actor = assertAuthorizedSuperAdmin();
    await actor.getIdToken();

    const branchRef = doc(db, 'branches', branchId);
    const branchSnap = await getDocFromServer(branchRef).catch(() => getDoc(branchRef));
    if (!branchSnap.exists()) {
      throw new Error('الفرع غير موجود.');
    }
    const branch = branchSnap.data() as Branch;
    if (branch.lifecycleStatus === 'purged_from_db') {
      throw new Error('تم حذف سجلات هذا الفرع من قاعدة البيانات مسبقاً.');
    }

    const [closingsSnap, archivesSnap, purchasesSnap, attachmentsSnap] = await Promise.all([
      getDocsFromServer(query(collection(db, 'closings'), where('branchId', '==', branchId))),
      getDocsFromServer(query(collection(db, 'closingArchives'), where('branchId', '==', branchId))),
      getDocsFromServer(query(collection(db, 'purchases'), where('branchId', '==', branchId))),
      getDocsFromServer(query(collection(db, 'attachments'), where('branchId', '==', branchId))),
    ]);

    const verification = verifyBranchDriveBackupCompleteness({
      branch,
      closings: closingsSnap.docs.map((d) => d.data() as ShiftClosing),
      archives: archivesSnap.docs.map((d) => d.data() as ClosingArchiveRecord),
      now: new Date(),
    });

    if (!verification.verified || branch.driveBackupVerified !== true) {
      throw new Error(verification.reason || 'تعذر التحقق من اكتمال أرشفة Google Drive؛ تم منع حذف البيانات.');
    }

    // Never touch Google Drive files and NEVER delete auditLogs!
    const docsToDelete = [
      ...closingsSnap.docs.map((d) => d.ref),
      ...purchasesSnap.docs.map((d) => d.ref),
      ...attachmentsSnap.docs.map((d) => d.ref),
      ...archivesSnap.docs.map((d) => d.ref),
    ];

    for (let i = 0; i < docsToDelete.length; i += 400) {
      const chunk = docsToDelete.slice(i, i + 400);
      const delBatch = writeBatch(db);
      chunk.forEach((ref) => delBatch.delete(ref));
      await delBatch.commit();
    }

    const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
    const now = new Date();
    const finalizeBatch = writeBatch(db);
    finalizeBatch.update(branchRef, {
      lifecycleStatus: 'purged_from_db',
      purgedFromDbAt: Timestamp.fromDate(now),
      purgedFromDbBy: actorEmail,
      updatedAt: now.toISOString(),
    });
    const auditLog = createPlatformAuditPayload({
      actor,
      action: 'BRANCH_DB_PURGED',
      targetType: 'branch',
      targetId: branchId,
      orgId: branch.orgId,
      details: `حذف سجلات فرع "${branch.name}" من قاعدة بيانات الموقع فقط (إقفالات: ${closingsSnap.size}، مشتريات: ${purchasesSnap.size}، مرفقات: ${attachmentsSnap.size}، أرشيف: ${archivesSnap.size}) بعد التحقق من أرشيف Google Drive دون المساس بملفات Drive أو auditLogs`,
      metadata: {
        deletedClosings: closingsSnap.size,
        deletedPurchases: purchasesSnap.size,
        deletedAttachments: attachmentsSnap.size,
        deletedClosingArchives: archivesSnap.size,
      },
    });
    finalizeBatch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
    const saPurgeNotif = buildSuperAdminPlatformNotification({
      dedupKey: `sa_branch_purged:${branchId}:${now.toISOString()}`,
      category: 'security_admin',
      type: 'SA_BRANCH_DB_PURGED',
      severity: 'critical',
      relatedOrgId: branch.orgId,
      branchId,
      branchName: branch.name,
      actorUid: actor.uid,
      actorName: actor.displayName || actorEmail,
      title: `تنظيف سجلات فرع "${branch.name}" من قاعدة البيانات`,
      body: `تم حذف سجلات الموقع فقط (إقفالات: ${closingsSnap.size}، مشتريات: ${purchasesSnap.size}) بعد التحقق من أرشيف Drive.`,
      targetType: 'branch',
      targetId: branchId,
      tab: 'branches',
      createdAt: now.toISOString(),
    });
    finalizeBatch.set(doc(db, 'notifications', saPurgeNotif.id), saPurgeNotif);
    await finalizeBatch.commit();

    await loadSuperAdminOverview();
    return {
      deletedClosings: closingsSnap.size,
      deletedPurchases: purchasesSnap.size,
      deletedAttachments: attachmentsSnap.size,
      deletedClosingArchives: archivesSnap.size,
    };
  };

  // Phase C — Individual Branch Exemption, Bulk Org Branch Exemption & Cross-Org Member Management
  const grantSuperAdminBranchExemption: AuthContextType['grantSuperAdminBranchExemption'] = async (
    input
  ) => {
    return inFlightSuperAdminActionsRef.current.runExclusive(
      `branch_exempt_grant:${input.branchId}`,
      async () => {
        const actor = assertAuthorizedSuperAdmin();
        await actor.getIdToken();

        const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
        const branchRef = doc(db, 'branches', input.branchId);
        const branchSnap = await getDocFromServer(branchRef).catch(() => getDoc(branchRef));
        if (!branchSnap.exists()) {
          throw new Error('الفرع غير موجود.');
        }
        const existingBranch = branchSnap.data() as Branch;

        const orgSnap = await getDocFromServer(doc(db, 'organizations', existingBranch.orgId)).catch(
          () => getDoc(doc(db, 'organizations', existingBranch.orgId))
        );
        if (!orgSnap.exists()) {
          throw new Error('المؤسسة المالكة للفرع غير موجودة.');
        }
        const org = orgSnap.data() as Organization;
        const now = new Date();
        const mode: ExemptionClassification =
          input.mode === 'legacy_unrestricted' ? 'legacy_unrestricted' : 'billing_exempt';

        const { branchPatch, auditLog } = buildSuperAdminBranchExemptionGrantBundle({
          actor: {
            uid: actor.uid,
            email: actor.email,
            emailVerified: actor.emailVerified,
            displayName: actor.displayName,
          },
          org,
          branch: existingBranch,
          mode,
          reason: input.reason,
          now,
          grantedAtValue: Timestamp.fromDate(now),
        });

        const existingOrgBranchesSnap = await getDocs(
          query(collection(db, 'branches'), where('orgId', '==', existingBranch.orgId))
        );
        const mergedBranches = existingOrgBranchesSnap.docs.map((d) =>
          d.id === existingBranch.id
            ? ({ ...existingBranch, ...branchPatch } as Branch)
            : (d.data() as Branch)
        );

        const batch = writeBatch(db);
        batch.update(branchRef, branchPatch);
        batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
        await syncOrgBranchBillingTotalsInBatch(batch, org, mergedBranches, now, actorEmail);

        const saNotif = buildSuperAdminPlatformNotification({
          dedupKey: `sa_branch_exempt_grant:${existingBranch.id}:${auditLog.id}`,
          category: 'security_admin',
          type: 'SA_BRANCH_BILLING_EXEMPTION_GRANTED',
          severity: 'success',
          relatedOrgId: org.id,
          branchId: existingBranch.id,
          branchName: existingBranch.name,
          actorUid: actor.uid,
          actorName: actor.displayName || actorEmail,
          title: `إعفاء دائم للفرع "${existingBranch.name}"`,
          body: `تم منح إعفاء دائم (${mode}) للفرع "${existingBranch.name}" في مؤسسة "${org.name}" (0 ر.س مع حفظ سجلات الدفع التاريخية).`,
          targetType: 'branch',
          targetId: existingBranch.id,
          tab: 'branches',
          createdAt: now.toISOString(),
        });
        batch.set(doc(db, 'notifications', saNotif.id), saNotif);

        await batch.commit();
        await loadSuperAdminOverview();
        return { auditLogId: auditLog.id };
      }
    );
  };

  const revokeSuperAdminBranchExemption: AuthContextType['revokeSuperAdminBranchExemption'] = async (
    input
  ) => {
    return inFlightSuperAdminActionsRef.current.runExclusive(
      `branch_exempt_revoke:${input.branchId}`,
      async () => {
        const actor = assertAuthorizedSuperAdmin();
        await actor.getIdToken();

        const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
        const branchRef = doc(db, 'branches', input.branchId);
        const branchSnap = await getDocFromServer(branchRef).catch(() => getDoc(branchRef));
        if (!branchSnap.exists()) {
          throw new Error('الفرع غير موجود.');
        }
        const existingBranch = branchSnap.data() as Branch;

        const orgSnap = await getDocFromServer(doc(db, 'organizations', existingBranch.orgId)).catch(
          () => getDoc(doc(db, 'organizations', existingBranch.orgId))
        );
        if (!orgSnap.exists()) {
          throw new Error('المؤسسة المالكة للفرع غير موجودة.');
        }
        const org = orgSnap.data() as Organization;
        const now = new Date();

        const { branchPatch, auditLog, parentOrgRemainsExempt } =
          buildSuperAdminBranchExemptionRevokeBundle({
            actor: {
              uid: actor.uid,
              email: actor.email,
              emailVerified: actor.emailVerified,
              displayName: actor.displayName,
            },
            org,
            branch: existingBranch,
            restoredPaymentStatus: input.restoredPaymentStatus,
            restoredMonthlyFeeSar: input.restoredMonthlyFeeSar,
            reason: input.reason,
            now,
            revokedAtValue: Timestamp.fromDate(now),
          });

        const existingOrgBranchesSnap = await getDocs(
          query(collection(db, 'branches'), where('orgId', '==', existingBranch.orgId))
        );
        const mergedBranches = existingOrgBranchesSnap.docs.map((d) =>
          d.id === existingBranch.id
            ? ({ ...existingBranch, ...branchPatch } as Branch)
            : (d.data() as Branch)
        );

        const batch = writeBatch(db);
        batch.update(branchRef, branchPatch);
        batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
        await syncOrgBranchBillingTotalsInBatch(batch, org, mergedBranches, now, actorEmail);

        const saNotif = buildSuperAdminPlatformNotification({
          dedupKey: `sa_branch_exempt_revoke:${existingBranch.id}:${auditLog.id}`,
          category: 'security_admin',
          type: 'SA_BRANCH_BILLING_EXEMPTION_REVOKED',
          severity: 'warning',
          relatedOrgId: org.id,
          branchId: existingBranch.id,
          branchName: existingBranch.name,
          actorUid: actor.uid,
          actorName: actor.displayName || actorEmail,
          title: `إلغاء الإعفاء الفردي للفرع "${existingBranch.name}"`,
          body: parentOrgRemainsExempt
            ? `تم إلغاء الإعفاء الفردي للفرع مع بقاء إعفاء المؤسسة الأم سارياً.`
            : `تم إلغاء الإعفاء الفردي للفرع "${existingBranch.name}" وإعادته لنظام الرسوم القياسي مع حفظ كامل السجلات التاريخية.`,
          targetType: 'branch',
          targetId: existingBranch.id,
          tab: 'branches',
          createdAt: now.toISOString(),
        });
        batch.set(doc(db, 'notifications', saNotif.id), saNotif);

        await batch.commit();
        await loadSuperAdminOverview();
        return { auditLogId: auditLog.id, parentOrgRemainsExempt };
      }
    );
  };

  const grantSuperAdminBulkOrgBranchesExemption: AuthContextType['grantSuperAdminBulkOrgBranchesExemption'] =
    async (input) => {
      return inFlightSuperAdminActionsRef.current.runExclusive(
        `org_branches_bulk_exempt:${input.orgId}`,
        async () => {
          const actor = assertAuthorizedSuperAdmin();
          await actor.getIdToken();

          const actorEmail = (actor.email || 'amoal2030@gmail.com').trim().toLowerCase();
          const orgSnap = await getDocFromServer(doc(db, 'organizations', input.orgId)).catch(() =>
            getDoc(doc(db, 'organizations', input.orgId))
          );
          if (!orgSnap.exists()) {
            throw new Error('المؤسسة غير موجودة.');
          }
          const org = orgSnap.data() as Organization;

          const orgBranchesSnap = await getDocs(
            query(collection(db, 'branches'), where('orgId', '==', org.id))
          );
          const orgBranches = orgBranchesSnap.docs.map((d) => d.data() as Branch);
          const now = new Date();
          const mode: ExemptionClassification =
            input.mode === 'legacy_unrestricted' ? 'legacy_unrestricted' : 'billing_exempt';

          const chunks = buildSuperAdminBulkBranchesExemptionBundles({
            actor: {
              uid: actor.uid,
              email: actor.email,
              emailVerified: actor.emailVerified,
              displayName: actor.displayName,
            },
            org,
            branches: orgBranches,
            mode,
            reason: input.reason,
            now,
            grantedAtValue: Timestamp.fromDate(now),
          });

          const auditLogIds: string[] = [];
          const updatedMap = new Map<string, Branch>(orgBranches.map((b) => [b.id, b]));
          let exemptedCount = 0;

          for (let i = 0; i < chunks.length; i += 1) {
            const chunk = chunks[i];
            const batch = writeBatch(db);
            for (const item of chunk.branches) {
              batch.update(doc(db, 'branches', item.branch.id), item.patch);
              updatedMap.set(item.branch.id, { ...item.branch, ...item.patch } as Branch);
              exemptedCount += 1;
            }
            batch.set(doc(db, 'platformAuditLogs', chunk.auditLog.id), chunk.auditLog);
            auditLogIds.push(chunk.auditLog.id);

            if (i === chunks.length - 1) {
              await syncOrgBranchBillingTotalsInBatch(
                batch,
                org,
                Array.from(updatedMap.values()),
                now,
                actorEmail
              );
              const saNotif = buildSuperAdminPlatformNotification({
                dedupKey: `sa_org_bulk_branch_exempt:${org.id}:${chunk.auditLog.id}`,
                category: 'security_admin',
                type: 'SA_ORG_BRANCHES_BULK_EXEMPTION_GRANTED',
                severity: 'success',
                relatedOrgId: org.id,
                actorUid: actor.uid,
                actorName: actor.displayName || actorEmail,
                title: `إعفاء جماعي لفروع مؤسسة "${org.name}"`,
                body: `تم إعفاء ${exemptedCount} فرعاً بشكل دائم (${mode}) مع حفظ جميع سجلات الدفع التاريخية.`,
                targetType: 'organization',
                targetId: org.id,
                tab: 'branches',
                createdAt: now.toISOString(),
              });
              batch.set(doc(db, 'notifications', saNotif.id), saNotif);
            }

            await batch.commit();
          }

          await loadSuperAdminOverview();
          return { exemptedCount, auditLogIds };
        }
      );
    };

  const createSuperAdminOrgMember: AuthContextType['createSuperAdminOrgMember'] = async (input) => {
    const emailKey = normalizeEmail(input.email);
    return inFlightSuperAdminActionsRef.current.runExclusive(
      `sa_member_create:${input.orgId}:${emailKey}`,
      async () => {
        const actor = assertAuthorizedSuperAdmin();
        await actor.getIdToken();

        const orgSnap = await getDocFromServer(doc(db, 'organizations', input.orgId)).catch(() =>
          getDoc(doc(db, 'organizations', input.orgId))
        );
        if (!orgSnap.exists()) {
          throw new Error('المؤسسة المستهدفة غير موجودة.');
        }
        const org = orgSnap.data() as Organization;

        const orgBranchesSnap = await getDocs(
          query(collection(db, 'branches'), where('orgId', '==', org.id))
        );
        const orgBranches = orgBranchesSnap.docs.map((d) => d.data() as Branch);

        const validated = validateSuperAdminMemberCreateInput({
          actor: {
            email: actor.email,
            emailVerified: actor.emailVerified,
          },
          org,
          orgBranches,
          email: input.email,
          password: input.password,
          displayName: input.displayName,
          role: input.role,
          branchId: input.branchId,
          phone: input.phone,
          supervisorPermissions: input.supervisorPermissions,
        });

        const secondaryAuth = getSecondaryAuth();
        let newUid = '';
        try {
          const cred = await createUserWithEmailAndPassword(
            secondaryAuth,
            validated.email,
            input.password
          );
          newUid = cred.user.uid;
        } catch (authErr: any) {
          if (authErr?.code === 'auth/email-already-in-use') {
            throw new Error(
              'هذا البريد مسجّل مسبقاً في Firebase Auth (مثل حساب Google قائم). لا يمكن إنشاء حساب جديد أو تخمين معرّفه تلقائياً؛ استخدم بريداً جديداً للموظف أو اربط الحساب عبر آلية الدعوة الرسمية.'
            );
          }
          if (authErr?.code === 'auth/weak-password') {
            throw new Error('كلمة المرور ضعيفة جداً؛ يجب أن تكون 6 أحرف على الأقل.');
          }
          if (authErr?.code === 'auth/invalid-email') {
            throw new Error('صيغة البريد الإلكتروني غير صالحة.');
          }
          throw authErr;
        } finally {
          await signOut(secondaryAuth).catch(() => {});
        }

        const now = new Date();
        const { userDoc, auditLog } = buildSuperAdminMemberCreateBundle({
          actor: {
            uid: actor.uid,
            email: actor.email,
            emailVerified: actor.emailVerified,
            displayName: actor.displayName,
          },
          org,
          newUid,
          validated,
          now,
        });

        const batch = writeBatch(db);
        batch.set(doc(db, 'users', newUid), userDoc);
        batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
        const saNotif = buildSuperAdminPlatformNotification({
          dedupKey: `sa_member_created:${newUid}:${auditLog.id}`,
          category: 'security_admin',
          type: 'SA_MEMBER_CREATED',
          severity: 'info',
          relatedOrgId: org.id,
          branchId: userDoc.branchId,
          branchName: userDoc.branchName,
          actorUid: actor.uid,
          actorName: actor.displayName || actor.email || 'صاحب الموقع',
          title: `إضافة عضو "${userDoc.displayName}"`,
          body: `تم إنشاء العضو (${userDoc.role}) في مؤسسة "${org.name}" بنجاح.`,
          targetType: 'organization',
          targetId: org.id,
          tab: 'members',
          createdAt: now.toISOString(),
        });
        batch.set(doc(db, 'notifications', saNotif.id), saNotif);

        await batch.commit();
        await loadSuperAdminOverview();
        return { member: userDoc, auditLogId: auditLog.id };
      }
    );
  };

  const updateSuperAdminOrgMember: AuthContextType['updateSuperAdminOrgMember'] = async (input) => {
    return inFlightSuperAdminActionsRef.current.runExclusive(
      `sa_member_update:${input.memberUid}`,
      async () => {
        const actor = assertAuthorizedSuperAdmin();
        await actor.getIdToken();

        const memberRef = doc(db, 'users', input.memberUid);
        const memberSnap = await getDocFromServer(memberRef).catch(() => getDoc(memberRef));
        if (!memberSnap.exists()) {
          throw new Error('العضو المطلوب غير موجود.');
        }
        const existingMember = memberSnap.data() as UserProfile;

        const orgSnap = await getDocFromServer(doc(db, 'organizations', existingMember.orgId)).catch(
          () => getDoc(doc(db, 'organizations', existingMember.orgId))
        );
        if (!orgSnap.exists()) {
          throw new Error('المؤسسة المرتبطة بالعضو غير موجودة.');
        }
        const org = orgSnap.data() as Organization;

        const orgBranchesSnap = await getDocs(
          query(collection(db, 'branches'), where('orgId', '==', org.id))
        );
        const orgBranches = orgBranchesSnap.docs.map((d) => d.data() as Branch);
        const now = new Date();

        const { action, userPatch, auditLog } = buildSuperAdminMemberUpdateBundle({
          actor: {
            uid: actor.uid,
            email: actor.email,
            emailVerified: actor.emailVerified,
            displayName: actor.displayName,
          },
          org,
          existingMember,
          orgBranches,
          displayName: input.displayName,
          phone: input.phone,
          role: input.role,
          branchId: input.branchId,
          supervisorPermissions: input.supervisorPermissions,
          reason: input.reason,
          now,
          deleteFieldSentinel: deleteField(),
        });

        const batch = writeBatch(db);
        batch.update(memberRef, userPatch);
        batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
        await batch.commit();
        await loadSuperAdminOverview();
        return { action, auditLogId: auditLog.id };
      }
    );
  };

  const archiveSuperAdminOrgMember: AuthContextType['archiveSuperAdminOrgMember'] = async (
    input
  ) => {
    return inFlightSuperAdminActionsRef.current.runExclusive(
      `sa_member_archive:${input.memberUid}`,
      async () => {
        const actor = assertAuthorizedSuperAdmin();
        await actor.getIdToken();

        const memberRef = doc(db, 'users', input.memberUid);
        const memberSnap = await getDocFromServer(memberRef).catch(() => getDoc(memberRef));
        if (!memberSnap.exists()) {
          throw new Error('العضو المطلوب غير موجود.');
        }
        const existingMember = memberSnap.data() as UserProfile;

        const orgSnap = await getDocFromServer(doc(db, 'organizations', existingMember.orgId)).catch(
          () => getDoc(doc(db, 'organizations', existingMember.orgId))
        );
        if (!orgSnap.exists()) {
          throw new Error('المؤسسة المرتبطة بالعضو غير موجودة.');
        }
        const org = orgSnap.data() as Organization;
        const now = new Date();

        const { userPatch, auditLog } = buildSuperAdminMemberArchiveBundle({
          actor: {
            uid: actor.uid,
            email: actor.email,
            emailVerified: actor.emailVerified,
            displayName: actor.displayName,
          },
          org,
          existingMember,
          reason: input.reason,
          now,
        });

        const batch = writeBatch(db);
        batch.update(memberRef, userPatch);
        batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
        const saNotif = buildSuperAdminPlatformNotification({
          dedupKey: `sa_member_archived:${existingMember.uid}:${auditLog.id}`,
          category: 'security_admin',
          type: 'SA_MEMBER_ARCHIVED',
          severity: 'warning',
          relatedOrgId: org.id,
          branchId: existingMember.branchId,
          branchName: existingMember.branchName,
          actorUid: actor.uid,
          actorName: actor.displayName || actor.email || 'صاحب الموقع',
          title: `أرشفة عضو "${existingMember.displayName}"`,
          body: `تم تعطيل وأرشفة العضو في مؤسسة "${org.name}" دون حذف أي سجلات تاريخية.`,
          targetType: 'organization',
          targetId: org.id,
          tab: 'members',
          createdAt: now.toISOString(),
        });
        batch.set(doc(db, 'notifications', saNotif.id), saNotif);

        await batch.commit();
        await loadSuperAdminOverview();
        return { auditLogId: auditLog.id };
      }
    );
  };

  const reactivateSuperAdminOrgMember: AuthContextType['reactivateSuperAdminOrgMember'] = async (
    input
  ) => {
    return inFlightSuperAdminActionsRef.current.runExclusive(
      `sa_member_reactivate:${input.memberUid}`,
      async () => {
        const actor = assertAuthorizedSuperAdmin();
        await actor.getIdToken();

        const memberRef = doc(db, 'users', input.memberUid);
        const memberSnap = await getDocFromServer(memberRef).catch(() => getDoc(memberRef));
        if (!memberSnap.exists()) {
          throw new Error('العضو المطلوب غير موجود.');
        }
        const existingMember = memberSnap.data() as UserProfile;

        const orgSnap = await getDocFromServer(doc(db, 'organizations', existingMember.orgId)).catch(
          () => getDoc(doc(db, 'organizations', existingMember.orgId))
        );
        if (!orgSnap.exists()) {
          throw new Error('المؤسسة المرتبطة بالعضو غير موجودة.');
        }
        const org = orgSnap.data() as Organization;
        const now = new Date();

        const { userPatch, auditLog } = buildSuperAdminMemberReactivateBundle({
          actor: {
            uid: actor.uid,
            email: actor.email,
            emailVerified: actor.emailVerified,
            displayName: actor.displayName,
          },
          org,
          existingMember,
          reason: input.reason,
          now,
        });

        const batch = writeBatch(db);
        batch.update(memberRef, userPatch);
        batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
        await batch.commit();
        await loadSuperAdminOverview();
        return { auditLogId: auditLog.id };
      }
    );
  };

  const releaseSuperAdminOrgMember: AuthContextType['releaseSuperAdminOrgMember'] = async (
    input
  ) => {
    return inFlightSuperAdminActionsRef.current.runExclusive(
      `sa_member_release:${input.memberUid}`,
      async () => {
        const actor = assertAuthorizedSuperAdmin();
        await actor.getIdToken();

        const memberRef = doc(db, 'users', input.memberUid);
        const memberSnap = await getDocFromServer(memberRef).catch(() => getDoc(memberRef));
        if (!memberSnap.exists()) {
          throw new Error('العضو المطلوب غير موجود.');
        }
        const existingMember = memberSnap.data() as UserProfile;

        if (!existingMember.orgId || resolveMemberMembershipStatus(existingMember) === 'released') {
          throw new Error('هذا العضو محرر نهائياً بالفعل ولا يرتبط بأي مؤسسة حالياً.');
        }

        const orgSnap = await getDocFromServer(doc(db, 'organizations', existingMember.orgId)).catch(
          () => getDoc(doc(db, 'organizations', existingMember.orgId))
        );
        if (!orgSnap.exists()) {
          throw new Error('المؤسسة المرتبطة بالعضو غير موجودة.');
        }
        const org = orgSnap.data() as Organization;
        const now = new Date();

        const { userPatch, historyRecord, auditLog } = buildSuperAdminMemberReleaseBundle({
          actor: {
            uid: actor.uid,
            email: actor.email,
            emailVerified: actor.emailVerified,
            displayName: actor.displayName,
          },
          org,
          existingMember,
          reason: input.reason,
          now,
          deleteFieldSentinel: deleteField(),
        });

        const batch = writeBatch(db);
        batch.update(memberRef, userPatch);
        batch.set(doc(db, 'memberOrgHistory', historyRecord.id), historyRecord);
        batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
        const saNotif = buildSuperAdminPlatformNotification({
          dedupKey: `sa_member_released:${existingMember.uid}:${auditLog.id}`,
          category: 'security_admin',
          type: 'SA_MEMBER_RELEASED',
          severity: 'warning',
          relatedOrgId: org.id,
          actorUid: actor.uid,
          actorName: actor.displayName || actor.email || 'صاحب الموقع',
          title: `فصل عضوية "${existingMember.displayName}" نهائياً`,
          body: `تم فصل العضو نهائياً عن مؤسسة "${org.name}" مع الاحتفاظ بحساب المصادقة وكافة السجلات التاريخية.`,
          targetType: 'organization',
          targetId: org.id,
          tab: 'members',
          createdAt: now.toISOString(),
        });
        batch.set(doc(db, 'notifications', saNotif.id), saNotif);

        await batch.commit();
        await loadSuperAdminOverview();
        return { auditLogId: auditLog.id, historyId: historyRecord.id };
      }
    );
  };

  const assignReleasedMemberToOrganization: AuthContextType['assignReleasedMemberToOrganization'] =
    async (input) => {
      return inFlightSuperAdminActionsRef.current.runExclusive(
        `sa_member_assign:${input.memberUid}`,
        async () => {
          const actor = assertAuthorizedSuperAdmin();
          await actor.getIdToken();

          const memberRef = doc(db, 'users', input.memberUid);
          const memberSnap = await getDocFromServer(memberRef).catch(() => getDoc(memberRef));
          if (!memberSnap.exists()) {
            throw new Error('العضو المطلوب غير موجود.');
          }
          const existingMember = memberSnap.data() as UserProfile;

          const targetOrgSnap = await getDocFromServer(
            doc(db, 'organizations', input.targetOrgId)
          ).catch(() => getDoc(doc(db, 'organizations', input.targetOrgId)));
          if (!targetOrgSnap.exists()) {
            throw new Error('المؤسسة الهدف غير موجودة.');
          }
          const targetOrg = targetOrgSnap.data() as Organization;

          const branchesQuery = query(
            collection(db, 'branches'),
            where('orgId', '==', targetOrg.id)
          );
          const branchesSnap = await getDocsFromServer(branchesQuery).catch(() =>
            getDocs(branchesQuery)
          );
          const targetOrgBranches: Branch[] = [];
          branchesSnap.forEach((b) => targetOrgBranches.push(b.data() as Branch));

          const now = new Date();
          const { userPatch, historyRecord, auditLog } = buildSuperAdminAssignReleasedMemberBundle({
            actor: {
              uid: actor.uid,
              email: actor.email,
              emailVerified: actor.emailVerified,
              displayName: actor.displayName,
            },
            existingMember,
            targetOrg,
            targetOrgBranches,
            role: input.role,
            branchId: input.branchId,
            supervisorPermissions: input.supervisorPermissions,
            reason: input.reason,
            now,
            deleteFieldSentinel: deleteField(),
          });

          const batch = writeBatch(db);
          batch.update(memberRef, userPatch);
          batch.set(doc(db, 'memberOrgHistory', historyRecord.id), historyRecord);
          batch.set(doc(db, 'platformAuditLogs', auditLog.id), auditLog);
          const saNotif = buildSuperAdminPlatformNotification({
            dedupKey: `sa_member_assigned:${existingMember.uid}:${auditLog.id}`,
            category: 'security_admin',
            type: 'SA_MEMBER_ASSIGNED',
            severity: 'success',
            relatedOrgId: targetOrg.id,
            branchId: historyRecord.branchId,
            branchName: historyRecord.branchName,
            actorUid: actor.uid,
            actorName: actor.displayName || actor.email || 'صاحب الموقع',
            title: `إعادة ربط "${existingMember.displayName}" بمؤسسة "${targetOrg.name}"`,
            body: `تم ربط العضو المحرر بنفس حسابه السابق بدور ${input.role} وصلاحيات جديدة مستقلة تماماً.`,
            targetType: 'organization',
            targetId: targetOrg.id,
            tab: 'members',
            createdAt: now.toISOString(),
          });
          batch.set(doc(db, 'notifications', saNotif.id), saNotif);

          await batch.commit();

          let passwordResetSent = false;
          if (input.sendOptionalPasswordReset && existingMember.email) {
            try {
              applyPreferredAuthLanguage();
              await sendPasswordResetEmail(auth, normalizeLoginEmail(existingMember.email));
              passwordResetSent = true;
            } catch (resetErr) {
              console.warn('Optional password reset email failed after member assignment:', resetErr);
            }
          }

          await loadSuperAdminOverview();
          return {
            auditLogId: auditLog.id,
            historyId: historyRecord.id,
            passwordResetSent,
          };
        }
      );
    };

  const sendSuperAdminMemberPasswordReset: AuthContextType['sendSuperAdminMemberPasswordReset'] =
    async (memberUid) => {
      return inFlightSuperAdminActionsRef.current.runExclusive(
        `sa_member_pwd_reset:${memberUid}`,
        async () => {
          const actor = assertAuthorizedSuperAdmin();
          await actor.getIdToken();

          const memberRef = doc(db, 'users', memberUid);
          const memberSnap = await getDocFromServer(memberRef).catch(() => getDoc(memberRef));
          if (!memberSnap.exists()) {
            throw new Error('العضو المطلوب غير موجود.');
          }
          const member = memberSnap.data() as UserProfile;
          const cleanEmail = normalizeLoginEmail(member.email);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            throw new Error('لا يملك هذا العضو بريداً إلكترونياً صالحاً لاستلام رابط إعادة التعيين.');
          }
          applyPreferredAuthLanguage();
          await sendPasswordResetEmail(auth, cleanEmail);
          return { email: cleanEmail };
        }
      );
    };

  const loadSuperAdminReleasedMembers: AuthContextType['loadSuperAdminReleasedMembers'] =
    async () => {
      assertAuthorizedSuperAdmin();
      const q = query(collection(db, 'users'), where('membershipStatus', '==', 'released'));
      const snap = await getDocsFromServer(q).catch(() => getDocs(q));
      const released: UserProfile[] = [];
      snap.forEach((d) => released.push(d.data() as UserProfile));
      released.sort(
        (a, b) =>
          new Date(b.releasedAt || b.updatedAt || b.createdAt).getTime() -
          new Date(a.releasedAt || a.updatedAt || a.createdAt).getTime()
      );
      return released;
    };

  const loadSuperAdminMemberOrgHistory: AuthContextType['loadSuperAdminMemberOrgHistory'] =
    async (memberUid) => {
      assertAuthorizedSuperAdmin();
      const baseRef = collection(db, 'memberOrgHistory');
      const q = memberUid ? query(baseRef, where('uid', '==', memberUid)) : baseRef;
      const snap = await getDocsFromServer(q).catch(() => getDocs(q));
      const records: MemberOrgHistoryRecord[] = [];
      snap.forEach((d) => records.push(d.data() as MemberOrgHistoryRecord));
      records.sort(
        (a, b) =>
          new Date(b.effectiveAt || b.createdAt).getTime() -
          new Date(a.effectiveAt || a.createdAt).getTime()
      );
      return records;
    };

  /**
   * Strictly READ-ONLY Super Admin UID Binding Diagnostic Inspector.
   * Exclusive to verified `amoal2030@gmail.com`. Queries only targeted documents
   * (never exposes unrelated employees and never performs any Firestore or Auth write).
   */
  const inspectEmployeeUidBindingDiagnostic: AuthContextType['inspectEmployeeUidBindingDiagnostic'] =
    async (input) => {
      const actor = assertAuthorizedSuperAdmin();
      await actor.getIdToken();

      const cleanTargetAuthUid = (input.targetAuthUid || '').trim();
      const cleanLegacyDocId = (input.legacyDocId || '').trim();
      const cleanEmailInput = normalizeEmail(input.email);

      const readUserDoc = async (uid: string): Promise<RawDiagnosticUserDoc | null> => {
        if (!uid) return null;
        const ref = doc(db, 'users', uid);
        const snap = await getDocFromServer(ref).catch(() => getDoc(ref));
        if (!snap.exists()) return null;
        return {
          docId: snap.id,
          data: snap.data() as UserProfile,
        };
      };

      const [targetAuthUidDoc, legacyDoc] = await Promise.all([
        readUserDoc(cleanTargetAuthUid),
        readUserDoc(cleanLegacyDocId),
      ]);

      const resolvedEmail = normalizeEmail(
        cleanEmailInput || legacyDoc?.data.email || targetAuthUidDoc?.data.email || ''
      );

      // Targeted read-only email & uid field queries (strictly filtered to the target identity)
      const emailMatchedDocs: RawDiagnosticUserDoc[] = [];
      if (resolvedEmail) {
        const emailQ = query(collection(db, 'users'), where('email', '==', resolvedEmail));
        const emailSnap = await getDocsFromServer(emailQ).catch(() => getDocs(emailQ));
        emailSnap.forEach((d) => {
          emailMatchedDocs.push({ docId: d.id, data: d.data() as UserProfile });
        });
      }

      const uidFieldMatchedDocs: RawDiagnosticUserDoc[] = [];
      const seenUidDocIds = new Set<string>();
      for (const candidateUid of Array.from(new Set([cleanTargetAuthUid, cleanLegacyDocId])).filter(Boolean)) {
        const uidQ = query(collection(db, 'users'), where('uid', '==', candidateUid));
        const uidSnap = await getDocsFromServer(uidQ).catch(() => getDocs(uidQ));
        uidSnap.forEach((d) => {
          if (!seenUidDocIds.has(d.id)) {
            seenUidDocIds.add(d.id);
            uidFieldMatchedDocs.push({ docId: d.id, data: d.data() as UserProfile });
          }
        });
      }

      const targetOrgId = legacyDoc?.data.orgId || targetAuthUidDoc?.data.orgId || '';
      let orgData: Organization | null = null;
      const orgBranches: Branch[] = [];
      if (targetOrgId) {
        const orgRef = doc(db, 'organizations', targetOrgId);
        const orgSnap = await getDocFromServer(orgRef).catch(() => getDoc(orgRef));
        if (orgSnap.exists()) {
          orgData = { ...(orgSnap.data() as Organization), id: orgSnap.id };
        }
        const branchQ = query(collection(db, 'branches'), where('orgId', '==', targetOrgId));
        const branchSnap = await getDocsFromServer(branchQ).catch(() => getDocs(branchQ));
        branchSnap.forEach((b) => orgBranches.push({ ...(b.data() as Branch), id: b.id }));
      }

      // Safe read-only probes for historical collections (gracefully records rule-restricted collections)
      const probeCollection = async (
        colName: DiagnosticCollectionProbe['collection'],
        qBuilder: () => ReturnType<typeof query>
      ): Promise<DiagnosticCollectionProbe> => {
        try {
          const snap = await getDocsFromServer(qBuilder()).catch((err) => {
            if (isPermissionDeniedError(err)) throw err;
            return getDocs(qBuilder());
          });
          return {
            collection: colName,
            status: 'readable',
            matchedCount: snap.size,
            note: `تم الفحص للقراءة فقط: ${snap.size} سجل مرتبط بالمعرّف القديم (${cleanLegacyDocId}).`,
          };
        } catch (err: any) {
          if (isPermissionDeniedError(err)) {
            return {
              collection: colName,
              status: 'restricted_by_rules_in_client_sdk',
              matchedCount: null,
              note: 'القراءة مقيّدة بـ firestore.rules لحساب المتصفح (عزل بيانات المؤسسة) — السجلات التاريخية تبقى محفوظة ولن تُمس.',
            };
          }
          return {
            collection: colName,
            status: 'error',
            matchedCount: null,
            note: `تعذر الفحص للقراءة فقط: ${err?.message || 'خطأ غير متوقع'}`,
          };
        }
      };

      const historicalCollectionProbes: DiagnosticCollectionProbe[] = await Promise.all([
        probeCollection('platformAuditLogs', () =>
          query(collection(db, 'platformAuditLogs'), where('targetId', '==', cleanLegacyDocId))
        ),
        probeCollection('memberOrgHistory', () =>
          query(collection(db, 'memberOrgHistory'), where('uid', '==', cleanLegacyDocId))
        ),
        probeCollection('auditLogs', () =>
          query(collection(db, 'auditLogs'), where('actorId', '==', cleanLegacyDocId))
        ),
        probeCollection('notifications', () =>
          query(collection(db, 'notifications'), where('actorUid', '==', cleanLegacyDocId))
        ),
        probeCollection('closings', () =>
          query(collection(db, 'closings'), where('employeeId', '==', cleanLegacyDocId))
        ),
        probeCollection('purchases', () =>
          query(collection(db, 'purchases'), where('createdBy', '==', cleanLegacyDocId))
        ),
      ]);

      return buildEmployeeUidDiagnosticReport({
        actor: {
          uid: actor.uid,
          email: actor.email,
          emailVerified: actor.emailVerified,
          displayName: actor.displayName,
        },
        targetAuthUid: cleanTargetAuthUid,
        legacyDocId: cleanLegacyDocId,
        email: resolvedEmail,
        targetAuthUidDoc,
        legacyDoc,
        emailMatchedDocs,
        uidFieldMatchedDocs,
        org: orgData,
        branches: orgBranches,
        historicalCollectionProbes,
      });
    };

  const logout = async () => {
    setLoading(true);
    try {
      clearDriveSession();
      await signOut(auth);
      setUserProfile(null);
      setCurrentOrg(null);
      setSubscriptionEvaluation(null);
      setSubscriptionBlockReason(null);
      setInviteBlockInfo(null);
      setAccessErrorInfo(null);
      clearOperationalState();
      setSuperAdminOverview(null);
      setSuperAdminNotifications([]);
      setSuperAdminNotificationsHasMore(false);
      resetNotificationRuntimeControllers({
        tenantController: tenantSoundControllerRef.current,
        saController: saSoundControllerRef.current,
        persistenceTracker: emittedThresholdTrackerRef.current,
        setTenantLimit: setTenantNotifLimit,
        setSaLimit: setSaNotifLimit,
      });
      setSuperAdminError(null);
      setNeedsOnboarding(false);
      setTenantStatus('unauthenticated');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshTenantData = async () => {
    if (auth.currentUser) {
      await loadUserData(auth.currentUser);
    }
  };

  const driveReadiness = evaluateOrgDriveReadiness(currentOrg, currentBranch);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        currentOrg,
        branches,
        currentBranch,
        employees,
        closings,
        closingArchives,
        auditLogs,
        loading,
        needsOnboarding,
        tenantStatus,
        subscriptionEvaluation,
        subscriptionBlockReason,
        inviteBlockInfo,
        accessErrorInfo,
        authEmailMismatch,
        loginWithGoogle,
        loginWithEmailPassword,
        resetPassword,
        completeOrganizationSetup,
        addBranch,
        createEmployeeAccount,
        updateEmployeeAccount,
        archiveEmployeeAccount,
        sendEmployeePasswordReset,
        toggleEmployeeStatus,
        updateEmployeeBranch,
        submitShiftClosing,
        reviewShiftClosing,
        adminCorrectClosing,
        saveDriveConnection,
        recordDriveHealthFailure,
        disconnectDriveConnection,
        archiveClosingToDrive,
        archivePendingClosingsToDrive,
        downloadArchivedExcelFromDrive,
        driveReadiness,
        logout,
        refreshTenantData,
        setCurrentBranch,
        authNotice,
        clearAuthNotice,
        isSuperAdmin,
        superAdminOverview,
        superAdminLoading,
        superAdminError,
        loadSuperAdminOverview,
        createSuperAdminOrganizationWithInvite,
        updateSuperAdminOrganizationProfileAndBilling,
        updateSuperAdminOrgStatus,
        grantSuperAdminOrgBillingExemption,
        revokeSuperAdminOrgBillingExemption,
        grantSuperAdminBranchExemption,
        revokeSuperAdminBranchExemption,
        grantSuperAdminBulkOrgBranchesExemption,
        createSuperAdminOrgMember,
        updateSuperAdminOrgMember,
        archiveSuperAdminOrgMember,
        reactivateSuperAdminOrgMember,
        releaseSuperAdminOrgMember,
        assignReleasedMemberToOrganization,
        sendSuperAdminMemberPasswordReset,
        loadSuperAdminReleasedMembers,
        loadSuperAdminMemberOrgHistory,
        inspectEmployeeUidBindingDiagnostic,
        upsertSuperAdminManagerInvite,
        cancelSuperAdminManagerInvite,
        createSuperAdminBranch,
        recordSuperAdminBranchPayment,
        suspendSuperAdminBranch,
        reactivateSuperAdminBranch,
        inspectBranchDriveBackupForPurge,
        purgeSuspendedBranchFromDb,
        tenantNotifications,
        superAdminNotifications,
        notificationsLoading,
        tenantNotificationsHasMore,
        superAdminNotificationsHasMore,
        notificationSoundEnabled,
        toggleNotificationSound,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        loadMoreNotifications,
        emitSecurityAccessDeniedAlert,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
