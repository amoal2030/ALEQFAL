import {
  AuditLog,
  Branch,
  MemberOrgHistoryRecord,
  Organization,
  PlatformAuditLog,
  Purchase,
  ShiftClosing,
  AppNotification,
  UserPermissions,
  UserProfile,
} from '../types';
import { SUPER_ADMIN_EMAIL } from './superAdmin';
import {
  assertSuperAdminIdentity,
  buildPlatformAuditLogEntry,
  isAllowedSuperAdminMemberRole,
  SuperAdminActorSnapshot,
  SuperAdminAssignableMemberRole,
  validateSuperAdminAuditReason,
} from './superAdminGovernance';
import { buildDefaultPermissionsForRole } from './permissions';
import { normalizeEmail, resolveMemberMembershipStatus } from './tenantAccess';

const VALID_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

export type LegacyUidAuthVerificationStatus =
  | 'pending_console_verification'
  | 'confirmed_unused_or_same_person'
  | 'active_different_employee';

export type DiagnosticCollectionProbeStatus =
  | 'readable'
  | 'restricted_by_rules_in_client_sdk'
  | 'error';

export interface EmployeeUidDiagnosticDocSummary {
  docId: string;
  storedUid: string;
  docIdMatchesStoredUid: boolean;
  email: string;
  displayName: string;
  phone: string;
  orgId: string;
  branchId: string | null;
  branchIds: string[];
  branchName: string | null;
  role: string;
  permissions: UserPermissions | null;
  isActive: boolean;
  isArchived: boolean;
  membershipStatus: 'active' | 'archived' | 'released';
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DiagnosticCollectionProbe {
  collection:
    | 'platformAuditLogs'
    | 'memberOrgHistory'
    | 'auditLogs'
    | 'notifications'
    | 'closings'
    | 'purchases';
  status: DiagnosticCollectionProbeStatus;
  matchedCount: number | null;
  note: string;
}

export interface EmployeeUidDiagnosticReport {
  generatedAt: string;
  inspectorEmail: string;
  readOnlyMode: true;
  requestedTargetAuthUid: string;
  requestedLegacyDocId: string;
  requestedEmail: string;
  targetAuthUidDocExists: boolean;
  targetAuthUidDoc: EmployeeUidDiagnosticDocSummary | null;
  legacyDocExists: boolean;
  legacyDoc: EmployeeUidDiagnosticDocSummary | null;
  organization: {
    orgId: string;
    orgName: string;
    status: string;
    ownerId: string | null;
    ownerEmail: string | null;
    isLegacyProfileOrgOwner: boolean;
  } | null;
  assignedBranch: {
    branchId: string;
    branchName: string;
    code: string;
    orgId: string;
    lifecycleStatus: string;
    belongsToSameOrg: boolean;
  } | null;
  emailMatchedDocs: EmployeeUidDiagnosticDocSummary[];
  uidFieldMatchedDocs: EmployeeUidDiagnosticDocSummary[];
  legacyUidAuthAccountCheck: {
    checkedUid: string;
    status: 'requires_firebase_console_auth_check';
    clientSdkCanInspectOtherAuthUsers: false;
    explanationAr: string;
    consoleStepsAr: string[];
    firestoreCrossDocumentIndicators: string[];
  };
  historicalCollectionProbes: DiagnosticCollectionProbe[];
  readinessAssessment: {
    canProceedAfterConsoleAuthVerification: boolean;
    blockingReasons: string[];
    warnings: string[];
  };
}

export interface RawDiagnosticUserDoc {
  docId: string;
  data: UserProfile;
}

export interface EmployeeAuthUidRebindPlan {
  planVersion: '1.0-local-simulation';
  dryRunOnly: true;
  createdAt: string;
  actorUid: string;
  actorEmail: string;
  targetAuthUid: string;
  legacyDocId: string;
  legacyStoredUid: string;
  email: string;
  orgId: string;
  orgName: string;
  role: SuperAdminAssignableMemberRole;
  branchId: string | null;
  branchIds: string[];
  branchName: string | null;
  requiresConsoleAuthVerificationBeforeProduction: boolean;
  legacyUidAuthVerification: LegacyUidAuthVerificationStatus;
  mandatoryInvariants: {
    deletesFirebaseAuthAccount: false;
    createsFirebaseAuthAccount: false;
    deletesLegacyEmployeeDoc: false;
    mutatesOrDeletesHistoricalRecords: false;
    changesEmail: false;
    changesOrgOrBranchOrRoleOrPermissions: false;
    bypassesOrgIsolation: false;
  };
  step1ArchiveLegacy: {
    operation: 'update_doc_with_atomic_platform_audit';
    targetPath: string;
    userPatch: Record<string, unknown>;
    auditLogPath: string;
    auditLog: PlatformAuditLog;
  };
  step2CreateActive: {
    operation: 'create_doc_with_atomic_platform_audit';
    targetPath: string;
    userDoc: UserProfile;
    auditLogPath: string;
    auditLog: PlatformAuditLog;
  };
  historicalPreservationManifest: {
    auditLogs: 'untouched_zero_deletes_zero_mutations';
    platformAuditLogs: 'append_only_plus_2_audit_entries';
    memberOrgHistory: 'untouched_zero_deletes_zero_mutations';
    notifications: 'untouched_zero_deletes_zero_mutations';
    closings: 'untouched_zero_deletes_zero_mutations';
    closingArchives: 'untouched_zero_deletes_zero_mutations';
    purchases: 'untouched_zero_deletes_zero_mutations';
    attachments: 'untouched_zero_deletes_zero_mutations';
  };
}

export interface RebindSimulationState {
  users: Record<string, UserProfile>;
  closings: Record<string, ShiftClosing>;
  purchases: Record<string, Purchase>;
  auditLogs: Record<string, AuditLog>;
  platformAuditLogs: Record<string, PlatformAuditLog>;
  memberOrgHistory: Record<string, MemberOrgHistoryRecord>;
  notifications: Record<string, AppNotification>;
}

export interface RebindSimulationResult {
  nextState: RebindSimulationState;
  verification: {
    activeProfilesForPersonCount: number;
    legacyDocStillExists: boolean;
    legacyDocArchivedAndInactive: boolean;
    newActiveDocExistsUnderTargetAuthUid: boolean;
    authUidPreserved: boolean;
    emailPreserved: boolean;
    orgPreserved: boolean;
    branchPreserved: boolean;
    rolePreserved: boolean;
    permissionsPreserved: boolean;
    historicalRecordsCompletelyUntouched: boolean;
    noPrivilegeEscalation: boolean;
    noCrossOrgMovement: boolean;
    allMandatoryConditionsPassed: boolean;
  };
}

function summarizeDiagnosticUserDoc(docId: string, data: UserProfile): EmployeeUidDiagnosticDocSummary {
  const cleanDocId = (docId || '').trim();
  const storedUid = typeof data.uid === 'string' ? data.uid.trim() : '';
  const branchIds = Array.isArray(data.branchIds)
    ? data.branchIds.filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
    : [];
  return {
    docId: cleanDocId,
    storedUid,
    docIdMatchesStoredUid: Boolean(cleanDocId && storedUid && cleanDocId === storedUid),
    email: typeof data.email === 'string' ? data.email : '',
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    orgId: typeof data.orgId === 'string' ? data.orgId : '',
    branchId: typeof data.branchId === 'string' && data.branchId.trim() ? data.branchId.trim() : null,
    branchIds,
    branchName:
      typeof data.branchName === 'string' && data.branchName.trim() ? data.branchName.trim() : null,
    role: typeof data.role === 'string' ? data.role : '',
    permissions: data.permissions ? { ...data.permissions } : null,
    isActive: data.isActive === true,
    isArchived: data.isArchived === true,
    membershipStatus: resolveMemberMembershipStatus(data),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
  };
}

function clonePermissions(perms: UserPermissions | undefined, role: SuperAdminAssignableMemberRole): UserPermissions {
  const baseline = buildDefaultPermissionsForRole(role);
  if (!perms) return baseline;
  // Strictly preserve existing permissions while enforcing zero escalation for non-managers
  const cloned: UserPermissions = {
    canCreateClosing: perms.canCreateClosing === true,
    canViewAllClosings: perms.canViewAllClosings === true,
    canApproveClosings: perms.canApproveClosings === true,
    canManageBranches: false,
    canManageEmployees: false,
    canViewFinancialReports: perms.canViewFinancialReports === true,
    canExportReports: perms.canExportReports === true,
    canManagePurchases: perms.canManagePurchases === true,
    canManageSuppliers: perms.canManageSuppliers === true,
    canCreateSuppliers: false,
    canViewSuppliers: perms.canViewSuppliers === true,
  };

  if (role === 'employee') {
    return buildDefaultPermissionsForRole('employee');
  }
  if (role === 'branch_manager') {
    return buildDefaultPermissionsForRole('branch_manager', undefined, {
      canCreateSuppliers: perms.canCreateSuppliers === true,
    });
  }
  return cloned;
}

function permissionsEqual(a: UserPermissions | undefined | null, b: UserPermissions | undefined | null): boolean {
  if (!a || !b) return a === b;
  const keys: Array<keyof UserPermissions> = [
    'canCreateClosing',
    'canViewAllClosings',
    'canApproveClosings',
    'canManageBranches',
    'canManageEmployees',
    'canViewFinancialReports',
    'canExportReports',
    'canManagePurchases',
    'canManageSuppliers',
    'canCreateSuppliers',
    'canViewSuppliers',
  ];
  return keys.every((k) => Boolean(a[k]) === Boolean(b[k]));
}

/**
 * Pure, strictly read-only diagnostic report builder for the verified Super Admin.
 * Filters strictly to the targeted Auth UID, legacy Doc ID, and normalized email so
 * unrelated employees' data is never surfaced.
 */
export function buildEmployeeUidDiagnosticReport(params: {
  actor: SuperAdminActorSnapshot;
  targetAuthUid: string;
  legacyDocId: string;
  email?: string;
  targetAuthUidDoc: RawDiagnosticUserDoc | null;
  legacyDoc: RawDiagnosticUserDoc | null;
  emailMatchedDocs?: RawDiagnosticUserDoc[];
  uidFieldMatchedDocs?: RawDiagnosticUserDoc[];
  org?: Organization | null;
  branches?: Branch[];
  historicalCollectionProbes?: DiagnosticCollectionProbe[];
  now?: Date;
}): EmployeeUidDiagnosticReport {
  assertSuperAdminIdentity(params.actor);

  const cleanTargetAuthUid = (params.targetAuthUid || '').trim();
  const cleanLegacyDocId = (params.legacyDocId || '').trim();
  const cleanEmail = normalizeEmail(
    params.email || params.legacyDoc?.data.email || params.targetAuthUidDoc?.data.email || ''
  );

  if (!cleanTargetAuthUid || !VALID_ID_REGEX.test(cleanTargetAuthUid)) {
    throw new Error('معرّف Firebase Auth UID الحالي غير صالح.');
  }
  if (!cleanLegacyDocId || !VALID_ID_REGEX.test(cleanLegacyDocId)) {
    throw new Error('معرّف وثيقة الموظف (Firestore Doc ID / UID القديم) غير صالح.');
  }

  const targetSummary = params.targetAuthUidDoc
    ? summarizeDiagnosticUserDoc(params.targetAuthUidDoc.docId, params.targetAuthUidDoc.data)
    : null;
  const legacySummary = params.legacyDoc
    ? summarizeDiagnosticUserDoc(params.legacyDoc.docId, params.legacyDoc.data)
    : null;

  // Strictly scope returned lists so unrelated employees are never exposed
  const scopedEmailDocs = (params.emailMatchedDocs || [])
    .filter((d) => cleanEmail && normalizeEmail(d.data.email) === cleanEmail)
    .map((d) => summarizeDiagnosticUserDoc(d.docId, d.data));

  const scopedUidDocs = (params.uidFieldMatchedDocs || [])
    .filter((d) => {
      const u = typeof d.data.uid === 'string' ? d.data.uid.trim() : '';
      return u === cleanTargetAuthUid || u === cleanLegacyDocId || d.docId === cleanTargetAuthUid || d.docId === cleanLegacyDocId;
    })
    .map((d) => summarizeDiagnosticUserDoc(d.docId, d.data));

  const orgSummary = params.org
    ? {
        orgId: params.org.id,
        orgName: params.org.name,
        status: params.org.subscriptionStatus || (params.org.isActive ? 'active' : 'inactive'),
        ownerId: params.org.ownerId || null,
        ownerEmail: params.org.ownerEmail || null,
        isLegacyProfileOrgOwner: Boolean(
          legacySummary &&
            ((params.org.ownerId && params.org.ownerId === legacySummary.docId) ||
              (params.org.ownerId && params.org.ownerId === legacySummary.storedUid) ||
              (params.org.ownerEmail &&
                normalizeEmail(params.org.ownerEmail) === normalizeEmail(legacySummary.email)))
        ),
      }
    : null;

  const targetBranchId =
    legacySummary?.branchId || (legacySummary?.branchIds && legacySummary.branchIds[0]) || null;
  const matchedBranch =
    targetBranchId && Array.isArray(params.branches)
      ? params.branches.find((b) => b.id === targetBranchId) || null
      : null;

  const assignedBranch = matchedBranch
    ? {
        branchId: matchedBranch.id,
        branchName: matchedBranch.name,
        code: matchedBranch.code || '',
        orgId: matchedBranch.orgId,
        lifecycleStatus: matchedBranch.lifecycleStatus || 'active',
        belongsToSameOrg: Boolean(legacySummary && matchedBranch.orgId === legacySummary.orgId),
      }
    : null;

  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const firestoreCrossDocumentIndicators: string[] = [];

  if (cleanTargetAuthUid === cleanLegacyDocId) {
    blockingReasons.push(
      'معرّف Auth UID الحالي مطابق بالفعل لمعرّف وثيقة الموظف؛ لا توجد حاجة لإعادة ربط UID.'
    );
  }
  if (!legacySummary) {
    blockingReasons.push(
      `لم يتم العثور على وثيقة الموظف القديمة users/${cleanLegacyDocId} في Firestore.`
    );
  }
  if (targetSummary) {
    blockingReasons.push(
      `توجد بالفعل وثيقة أخرى تحت users/${cleanTargetAuthUid} (${targetSummary.displayName || targetSummary.email})؛ يُمنع الكتابة فوقها تلقائياً.`
    );
  }
  if (legacySummary) {
    if (!legacySummary.docIdMatchesStoredUid) {
      warnings.push(
        `عدم تطابق داخلي في الوثيقة القديمة: docId=${legacySummary.docId} بينما حقل uid=${legacySummary.storedUid || '(فارغ)'}.`
      );
    }
    if (!isAllowedSuperAdminMemberRole(legacySummary.role)) {
      blockingReasons.push(
        `الدور الحالي (${legacySummary.role}) غير مشمول في إعادة ربط الموظفين (المسموح فقط: supervisor / branch_manager / employee).`
      );
    }
    if (normalizeEmail(legacySummary.email) === SUPER_ADMIN_EMAIL) {
      blockingReasons.push('يُمنع تنفيذ أي إجراء إعادة ربط على حساب المدير الرئيسي.');
    }
    if (orgSummary?.isLegacyProfileOrgOwner) {
      blockingReasons.push('الوثيقة المستهدفة تعود لمالك المؤسسة؛ يُمنع معالجتها كحساب موظف عادي.');
    }
    if (legacySummary.membershipStatus === 'released') {
      blockingReasons.push('العضو في حالة فصل نهائي (released) ولا يُعاد ربطه بهذه الآلية.');
    }
    if (!legacySummary.isActive || legacySummary.isArchived) {
      warnings.push('الوثيقة القديمة غير نشطة أو مؤرشفة مسبقاً؛ يجب مراجعة السبب قبل أي إجراء.');
    }
    if (
      (legacySummary.role === 'branch_manager' || legacySummary.role === 'employee') &&
      (!legacySummary.branchId || (assignedBranch && !assignedBranch.belongsToSameOrg))
    ) {
      blockingReasons.push('ارتباط الفرع للوثيقة القديمة غير مكتمل أو لا يتبع نفس المؤسسة.');
    }
  }

  const activeEmailMatches = scopedEmailDocs.filter(
    (d) => d.isActive && !d.isArchived && d.membershipStatus === 'active'
  );
  if (activeEmailMatches.length > 1) {
    warnings.push(
      `تم رصد ${activeEmailMatches.length} وثائق نشطة تحمل نفس البريد (${cleanEmail}) — يجب التأكد من عدم وجود ازدواجية قبل أي إجراء.`
    );
    firestoreCrossDocumentIndicators.push(
      `توجد ${activeEmailMatches.length} وثائق نشطة في users تحمل البريد ${cleanEmail}: ${activeEmailMatches.map((d) => d.docId).join(', ')}`
    );
  }

  const uidConflictDocs = scopedUidDocs.filter(
    (d) => d.docId !== cleanLegacyDocId && (d.storedUid === cleanLegacyDocId || d.docId === cleanTargetAuthUid)
  );
  if (uidConflictDocs.length > 0) {
    firestoreCrossDocumentIndicators.push(
      `تم رصد وثيقة مرتبطة أخرى في Firestore: ${uidConflictDocs.map((d) => `${d.docId} (${d.email})`).join(', ')}`
    );
  }

  return {
    generatedAt: (params.now || new Date()).toISOString(),
    inspectorEmail: normalizeEmail(params.actor.email) || SUPER_ADMIN_EMAIL,
    readOnlyMode: true,
    requestedTargetAuthUid: cleanTargetAuthUid,
    requestedLegacyDocId: cleanLegacyDocId,
    requestedEmail: cleanEmail,
    targetAuthUidDocExists: Boolean(targetSummary),
    targetAuthUidDoc: targetSummary,
    legacyDocExists: Boolean(legacySummary),
    legacyDoc: legacySummary,
    organization: orgSummary,
    assignedBranch,
    emailMatchedDocs: scopedEmailDocs,
    uidFieldMatchedDocs: scopedUidDocs,
    legacyUidAuthAccountCheck: {
      checkedUid: cleanLegacyDocId,
      status: 'requires_firebase_console_auth_check',
      clientSdkCanInspectOtherAuthUsers: false,
      explanationAr:
        'حزمة Firebase Client SDK في المتصفح لا تملك صلاحية الاستعلام عن حسابات مستخدمين آخرين داخل Firebase Authentication. للتحقق اليقيني مما إذا كان المعرّف القديم مستخدماً في حساب مصادقة آخر، يجب فحصه مباشرة من لوحة Firebase Console → Authentication → Users قبل تنفيذ أي ربط إنتاجي.',
      consoleStepsAr: [
        'افتح Firebase Console للمشروع scenic-proton-s3kqt ثم انتقل إلى Authentication → Users.',
        `ابحث عن المعرّف القديم (${cleanLegacyDocId}) وتأكد هل يوجد حساب Auth بهذا الـ UID أم أنه غير موجود / محذوف سابقاً.`,
        `إذا وجد حساب Auth للمعرّف القديم، تحقق من البريد الإلكتروني المرتبط به: إذا كان يعود لموظف مختلف تماماً يُوقف الإجراء فوراً.`,
        `تحقق أيضاً من وجود المعرّف الحالي (${cleanTargetAuthUid}) بنفس البريد (${cleanEmail || 'البريد المستهدف'}) دون حذف أو إنشاء أي حساب Auth.`,
      ],
      firestoreCrossDocumentIndicators,
    },
    historicalCollectionProbes: params.historicalCollectionProbes || [],
    readinessAssessment: {
      canProceedAfterConsoleAuthVerification: blockingReasons.length === 0,
      blockingReasons,
      warnings,
    },
  };
}

/**
 * Pure local planner for safely rebinding an employee's active Firebase Auth UID to an existing
 * employee profile WITHOUT deleting Firebase Auth accounts, WITHOUT creating new Auth accounts,
 * WITHOUT deleting the legacy Firestore document, and WITHOUT mutating/deleting historical data.
 *
 * Strictly Super Admin exclusive (`amoal2030@gmail.com` + `emailVerified === true`).
 * Produces two `firestore.rules`-compliant atomic bundles (no rule changes required):
 *   1. Archive legacy `users/{legacyDocId}` with atomic `platformAuditLogs` (`MEMBER_ARCHIVED`)
 *   2. Create active `users/{targetAuthUid}` preserving exact identity/org/branch/role/permissions
 *      with atomic `platformAuditLogs` (`MEMBER_CREATED`)
 */
export function buildEmployeeAuthUidRebindPlan(params: {
  actor: SuperAdminActorSnapshot;
  targetAuthUid: string;
  targetAuthUidDocExists: boolean;
  legacyDocId: string;
  legacyProfile: UserProfile;
  org: Organization;
  orgBranches: Branch[];
  legacyUidAuthVerification: LegacyUidAuthVerificationStatus;
  reason: string;
  now?: Date;
  archiveAuditLogId?: string;
  createAuditLogId?: string;
}): EmployeeAuthUidRebindPlan {
  assertSuperAdminIdentity(params.actor);

  const cleanTargetAuthUid = (params.targetAuthUid || '').trim();
  const cleanLegacyDocId = (params.legacyDocId || '').trim();
  const cleanReason = validateSuperAdminAuditReason(params.reason, 'إعادة ربط Auth UID للموظف');

  if (!VALID_ID_REGEX.test(cleanTargetAuthUid)) {
    throw new Error('معرّف Firebase Auth UID الحالي غير صالح.');
  }
  if (!VALID_ID_REGEX.test(cleanLegacyDocId)) {
    throw new Error('معرّف وثيقة الموظف القديمة غير صالح.');
  }
  if (cleanTargetAuthUid === cleanLegacyDocId) {
    throw new Error('معرّف Auth UID الحالي مطابق بالفعل لمعرّف الوثيقة القديمة.');
  }
  if (params.targetAuthUidDocExists) {
    throw new Error(
      `توجد بالفعل وثيقة قائمة تحت users/${cleanTargetAuthUid}؛ يُمنع الكتابة فوقها أو دمجها تلقائياً.`
    );
  }
  if (params.legacyUidAuthVerification === 'active_different_employee') {
    throw new Error(
      'تم إيقاف خطة الربط: المعرّف القديم مستخدم في حساب Firebase Authentication يعود لموظف آخر مختلف.'
    );
  }

  const legacy = params.legacyProfile;
  const legacyStoredUid = typeof legacy.uid === 'string' ? legacy.uid.trim() : '';

  // Note: `canSuperAdminUpdateOrgMember` in firestore.rules enforces `next.uid == prev.uid && next.uid == userId`.
  if (legacyStoredUid !== cleanLegacyDocId) {
    throw new Error(
      `عدم تطابق داخلي في الوثيقة القديمة: docId (${cleanLegacyDocId}) != uid (${legacyStoredUid || '(فارغ)'}). يتطلب معالجة خاصة قبل استخدام مسار الأرشفة القياسي.`
    );
  }

  if (!isAllowedSuperAdminMemberRole(legacy.role)) {
    throw new Error(
      `لا يُسمح بإعادة ربط دور "${legacy.role}" عبر هذا المسار؛ الأدوار المسموحة فقط: supervisor، branch_manager، employee.`
    );
  }
  const role: SuperAdminAssignableMemberRole = legacy.role;

  const cleanEmail = (legacy.email || '').trim();
  const emailLower = normalizeEmail(cleanEmail);
  if (!emailLower || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    throw new Error('البريد الإلكتروني في وثيقة الموظف القديمة غير صالح.');
  }
  if (emailLower === SUPER_ADMIN_EMAIL) {
    throw new Error('يُمنع تنفيذ أي عملية إعادة ربط على حساب المدير الرئيسي.');
  }

  if (!legacy.orgId || legacy.orgId !== params.org.id) {
    throw new Error('المؤسسة المستهدفة لا تطابق orgId المخزّن في وثيقة الموظف القديمة.');
  }
  if (
    params.org.ownerId === cleanLegacyDocId ||
    (params.org.ownerEmail && normalizeEmail(params.org.ownerEmail) === emailLower)
  ) {
    throw new Error('لا يمكن تنفيذ هذا الإجراء على مالك المؤسسة.');
  }

  const membershipStatus = resolveMemberMembershipStatus(legacy);
  if (membershipStatus === 'released') {
    throw new Error('العضو في حالة فصل نهائي (released) ولا يمكن أرشفته أو ربطه بهذا المسار.');
  }
  if (legacy.isArchived === true || legacy.isActive === false) {
    throw new Error('الوثيقة القديمة مؤرشفة أو معطّلة بالفعل؛ يجب مراجعتها قبل إنشاء وثيقة نشطة جديدة.');
  }

  // Validate branch binding strictly within the SAME org (zero cross-org movement)
  let resolvedBranch: Branch | null = null;
  let resolvedBranchIds: string[] = [];
  if (role === 'branch_manager' || role === 'employee') {
    const primaryBranchId =
      (typeof legacy.branchId === 'string' && legacy.branchId.trim()) ||
      (Array.isArray(legacy.branchIds) && legacy.branchIds[0] ? legacy.branchIds[0].trim() : '');
    if (!primaryBranchId) {
      throw new Error('وثيقة الموظف القديمة لا تحتوي على branchId صالح.');
    }
    resolvedBranch = params.orgBranches.find((b) => b.id === primaryBranchId) || null;
    if (!resolvedBranch || resolvedBranch.orgId !== params.org.id) {
      throw new Error('الفرع المرتبط بوثيقة الموظف لا يتبع لنفس المؤسسة؛ يمنع النقل عبر المؤسسات.');
    }
    if (resolvedBranch.lifecycleStatus === 'purged_from_db') {
      throw new Error('الفرع المرتبط بالموظف محذوف من قاعدة البيانات.');
    }
    if (role === 'branch_manager') {
      const existingIds = Array.isArray(legacy.branchIds)
        ? legacy.branchIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [];
      for (const bid of existingIds) {
        const b = params.orgBranches.find((item) => item.id === bid);
        if (!b || b.orgId !== params.org.id || b.lifecycleStatus === 'purged_from_db') {
          throw new Error(`الفرع (${bid}) في branchIds لا يتبع لنفس المؤسسة أو غير صالح.`);
        }
      }
      if (existingIds.length > 1 || (existingIds.length === 1 && existingIds[0] !== resolvedBranch.id)) {
        throw new Error(
          'قواعد firestore.rules تُلزم مسؤول الفرع بفرع واحد مطابق لـ branchId؛ يرجى مراجعة branchIds قبل الربط.'
        );
      }
      resolvedBranchIds = [resolvedBranch.id];
    }
  }

  const preservedPermissions = clonePermissions(legacy.permissions, role);
  if (legacy.permissions && !permissionsEqual(legacy.permissions, preservedPermissions)) {
    throw new Error(
      'تم اكتشاف تباين محتمل في الصلاحيات؛ تم إيقاف الخطة لضمان عدم منح أو تغيير أي صلاحيات.'
    );
  }

  const now = params.now || new Date();
  const nowIso = now.toISOString();
  const cleanName = (legacy.displayName || '').trim();
  if (cleanName.length < 1 || cleanName.length > 100) {
    throw new Error('اسم الموظف في الوثيقة القديمة غير صالح.');
  }
  const cleanPhone = typeof legacy.phone === 'string' ? legacy.phone.trim().slice(0, 25) : '';
  const resolvedBranchName = (legacy.branchName || resolvedBranch?.name || '').trim().slice(0, 120);

  // Step 1: Archive legacy doc (preserves old doc forever, prevents 2 active profiles)
  const archiveAuditLog = buildPlatformAuditLogEntry({
    id: params.archiveAuditLogId,
    actor: params.actor,
    action: 'MEMBER_ARCHIVED',
    targetType: 'member',
    targetId: cleanLegacyDocId,
    orgId: params.org.id,
    details: `أرشفة وثيقة الموظف القديمة "${cleanName}" (${cleanEmail}) تحت UID القديم ${cleanLegacyDocId} تمهيداً لربط نفس الموظف بـ Auth UID الحالي ${cleanTargetAuthUid} داخل مؤسسة "${params.org.name}" دون حذف أي سجل تاريخي — السبب: ${cleanReason}`,
    metadata: {
      orgId: params.org.id,
      memberUid: cleanLegacyDocId,
      role,
      branchId: resolvedBranch?.id || null,
      branchName: resolvedBranchName || null,
      rebindOperation: 'archive_legacy_uid_profile',
      rebindTargetAuthUid: cleanTargetAuthUid,
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const archiveUserPatch: Record<string, unknown> = {
    isActive: false,
    isArchived: true,
    membershipStatus: 'archived',
    archivedAt: nowIso,
    archivedBy: params.actor.uid,
    lastPlatformAuditLogId: archiveAuditLog.id,
    updatedAt: nowIso,
  };

  // Step 2: Create active identity doc under current Auth UID preserving exact org/branch/role/permissions/email
  const createAuditLog = buildPlatformAuditLogEntry({
    id: params.createAuditLogId,
    actor: params.actor,
    action: 'MEMBER_CREATED',
    targetType: 'member',
    targetId: cleanTargetAuthUid,
    orgId: params.org.id,
    details: `إنشاء وثيقة الهوية النشطة للموظف "${cleanName}" (${cleanEmail}) تحت Auth UID الحالي ${cleanTargetAuthUid} استكمالاً لربط الوثيقة المؤرشفة ${cleanLegacyDocId} في مؤسسة "${params.org.name}" بنفس الفرع والدور والصلاحيات — السبب: ${cleanReason}`,
    metadata: {
      orgId: params.org.id,
      memberUid: cleanTargetAuthUid,
      email: emailLower,
      role,
      branchId: resolvedBranch?.id || null,
      branchName: resolvedBranchName || null,
      rebindOperation: 'create_rebound_auth_uid_profile',
      reboundFromLegacyUid: cleanLegacyDocId,
      pairedArchiveAuditLogId: archiveAuditLog.id,
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const newActiveUserDoc: UserProfile = {
    uid: cleanTargetAuthUid,
    orgId: params.org.id,
    email: cleanEmail,
    displayName: cleanName,
    role,
    ...(resolvedBranch
      ? {
          branchId: resolvedBranch.id,
          branchName: resolvedBranchName,
        }
      : {}),
    ...(role === 'branch_manager' && resolvedBranchIds.length > 0
      ? { branchIds: resolvedBranchIds }
      : {}),
    ...(cleanPhone ? { phone: cleanPhone } : {}),
    isActive: true,
    isArchived: false,
    membershipStatus: 'active',
    permissions: preservedPermissions,
    lastPlatformAuditLogId: createAuditLog.id,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    planVersion: '1.0-local-simulation',
    dryRunOnly: true,
    createdAt: nowIso,
    actorUid: params.actor.uid,
    actorEmail: normalizeEmail(params.actor.email) || SUPER_ADMIN_EMAIL,
    targetAuthUid: cleanTargetAuthUid,
    legacyDocId: cleanLegacyDocId,
    legacyStoredUid,
    email: cleanEmail,
    orgId: params.org.id,
    orgName: params.org.name,
    role,
    branchId: resolvedBranch?.id || null,
    branchIds: resolvedBranchIds,
    branchName: resolvedBranchName || null,
    requiresConsoleAuthVerificationBeforeProduction:
      params.legacyUidAuthVerification !== 'confirmed_unused_or_same_person',
    legacyUidAuthVerification: params.legacyUidAuthVerification,
    mandatoryInvariants: {
      deletesFirebaseAuthAccount: false,
      createsFirebaseAuthAccount: false,
      deletesLegacyEmployeeDoc: false,
      mutatesOrDeletesHistoricalRecords: false,
      changesEmail: false,
      changesOrgOrBranchOrRoleOrPermissions: false,
      bypassesOrgIsolation: false,
    },
    step1ArchiveLegacy: {
      operation: 'update_doc_with_atomic_platform_audit',
      targetPath: `users/${cleanLegacyDocId}`,
      userPatch: archiveUserPatch,
      auditLogPath: `platformAuditLogs/${archiveAuditLog.id}`,
      auditLog: archiveAuditLog,
    },
    step2CreateActive: {
      operation: 'create_doc_with_atomic_platform_audit',
      targetPath: `users/${cleanTargetAuthUid}`,
      userDoc: newActiveUserDoc,
      auditLogPath: `platformAuditLogs/${createAuditLog.id}`,
      auditLog: createAuditLog,
    },
    historicalPreservationManifest: {
      auditLogs: 'untouched_zero_deletes_zero_mutations',
      platformAuditLogs: 'append_only_plus_2_audit_entries',
      memberOrgHistory: 'untouched_zero_deletes_zero_mutations',
      notifications: 'untouched_zero_deletes_zero_mutations',
      closings: 'untouched_zero_deletes_zero_mutations',
      closingArchives: 'untouched_zero_deletes_zero_mutations',
      purchases: 'untouched_zero_deletes_zero_mutations',
      attachments: 'untouched_zero_deletes_zero_mutations',
    },
  };
}

/**
 * Pure local in-memory simulator for verifying the rebind plan without touching Firestore.
 */
export function simulateEmployeeAuthUidRebind(
  initialState: RebindSimulationState,
  plan: EmployeeAuthUidRebindPlan
): RebindSimulationResult {
  const beforeLegacy = initialState.users[plan.legacyDocId];
  if (!beforeLegacy) {
    throw new Error(`وثيقة الموظف القديمة غير موجودة في حالة المحاكاة: ${plan.legacyDocId}`);
  }
  if (initialState.users[plan.targetAuthUid]) {
    throw new Error(`وثيقة Auth UID المستهدفة موجودة بالفعل في حالة المحاكاة: ${plan.targetAuthUid}`);
  }

  // Deep clone state to guarantee immutability of initialState
  const nextState: RebindSimulationState = {
    users: JSON.parse(JSON.stringify(initialState.users)),
    closings: JSON.parse(JSON.stringify(initialState.closings)),
    purchases: JSON.parse(JSON.stringify(initialState.purchases)),
    auditLogs: JSON.parse(JSON.stringify(initialState.auditLogs)),
    platformAuditLogs: JSON.parse(JSON.stringify(initialState.platformAuditLogs)),
    memberOrgHistory: JSON.parse(JSON.stringify(initialState.memberOrgHistory)),
    notifications: JSON.parse(JSON.stringify(initialState.notifications)),
  };

  // Apply Step 1: Archive legacy doc + append platformAuditLog
  nextState.users[plan.legacyDocId] = {
    ...nextState.users[plan.legacyDocId],
    ...(plan.step1ArchiveLegacy.userPatch as Partial<UserProfile>),
  };
  nextState.platformAuditLogs[plan.step1ArchiveLegacy.auditLog.id] = JSON.parse(
    JSON.stringify(plan.step1ArchiveLegacy.auditLog)
  );

  // Apply Step 2: Create active doc under targetAuthUid + append platformAuditLog
  nextState.users[plan.targetAuthUid] = JSON.parse(
    JSON.stringify(plan.step2CreateActive.userDoc)
  );
  nextState.platformAuditLogs[plan.step2CreateActive.auditLog.id] = JSON.parse(
    JSON.stringify(plan.step2CreateActive.auditLog)
  );

  const normalizedEmail = normalizeEmail(beforeLegacy.email);
  const activeProfilesForPerson = Object.values(nextState.users).filter(
    (u) =>
      normalizeEmail(u.email) === normalizedEmail &&
      u.isActive === true &&
      u.isArchived !== true &&
      resolveMemberMembershipStatus(u) === 'active'
  );

  const afterLegacy = nextState.users[plan.legacyDocId];
  const afterNew = nextState.users[plan.targetAuthUid];

  const legacyDocStillExists = Boolean(afterLegacy);
  const legacyDocArchivedAndInactive = Boolean(
    afterLegacy &&
      afterLegacy.isActive === false &&
      afterLegacy.isArchived === true &&
      afterLegacy.membershipStatus === 'archived' &&
      afterLegacy.orgId === beforeLegacy.orgId &&
      afterLegacy.email === beforeLegacy.email
  );
  const newActiveDocExistsUnderTargetAuthUid = Boolean(
    afterNew &&
      afterNew.uid === plan.targetAuthUid &&
      afterNew.isActive === true &&
      afterNew.isArchived === false &&
      afterNew.membershipStatus === 'active'
  );
  const authUidPreserved = afterNew.uid === plan.targetAuthUid;
  const emailPreserved = afterNew.email === beforeLegacy.email;
  const orgPreserved = afterNew.orgId === beforeLegacy.orgId;
  const branchPreserved =
    (afterNew.branchId || null) === (beforeLegacy.branchId || null) &&
    JSON.stringify(afterNew.branchIds || []) ===
      JSON.stringify(
        beforeLegacy.role === 'branch_manager'
          ? beforeLegacy.branchIds && beforeLegacy.branchIds.length > 0
            ? beforeLegacy.branchIds
            : beforeLegacy.branchId
            ? [beforeLegacy.branchId]
            : []
          : []
      );
  const rolePreserved = afterNew.role === beforeLegacy.role;
  const permissionsPreserved = permissionsEqual(afterNew.permissions, beforeLegacy.permissions);

  // Verify every single historical collection stayed 100% intact (and platformAuditLogs only grew by +2)
  const closingsIntact = JSON.stringify(nextState.closings) === JSON.stringify(initialState.closings);
  const purchasesIntact = JSON.stringify(nextState.purchases) === JSON.stringify(initialState.purchases);
  const auditLogsIntact = JSON.stringify(nextState.auditLogs) === JSON.stringify(initialState.auditLogs);
  const memberOrgHistoryIntact =
    JSON.stringify(nextState.memberOrgHistory) === JSON.stringify(initialState.memberOrgHistory);
  const notificationsIntact =
    JSON.stringify(nextState.notifications) === JSON.stringify(initialState.notifications);
  const priorPlatformLogsIntact = Object.keys(initialState.platformAuditLogs).every(
    (k) =>
      JSON.stringify(nextState.platformAuditLogs[k]) ===
      JSON.stringify(initialState.platformAuditLogs[k])
  );
  const platformLogsAppendedExactlyTwo =
    Object.keys(nextState.platformAuditLogs).length ===
    Object.keys(initialState.platformAuditLogs).length + 2;

  const historicalRecordsCompletelyUntouched =
    closingsIntact &&
    purchasesIntact &&
    auditLogsIntact &&
    memberOrgHistoryIntact &&
    notificationsIntact &&
    priorPlatformLogsIntact &&
    platformLogsAppendedExactlyTwo;

  const noPrivilegeEscalation =
    afterNew.role === beforeLegacy.role &&
    afterNew.role !== 'manager' &&
    afterNew.permissions?.canManageBranches === false &&
    afterNew.permissions?.canManageEmployees === false;

  const noCrossOrgMovement =
    afterNew.orgId === beforeLegacy.orgId && afterLegacy.orgId === beforeLegacy.orgId;

  const allMandatoryConditionsPassed =
    activeProfilesForPerson.length === 1 &&
    legacyDocStillExists &&
    legacyDocArchivedAndInactive &&
    newActiveDocExistsUnderTargetAuthUid &&
    authUidPreserved &&
    emailPreserved &&
    orgPreserved &&
    branchPreserved &&
    rolePreserved &&
    permissionsPreserved &&
    historicalRecordsCompletelyUntouched &&
    noPrivilegeEscalation &&
    noCrossOrgMovement;

  return {
    nextState,
    verification: {
      activeProfilesForPersonCount: activeProfilesForPerson.length,
      legacyDocStillExists,
      legacyDocArchivedAndInactive,
      newActiveDocExistsUnderTargetAuthUid,
      authUidPreserved,
      emailPreserved,
      orgPreserved,
      branchPreserved,
      rolePreserved,
      permissionsPreserved,
      historicalRecordsCompletelyUntouched,
      noPrivilegeEscalation,
      noCrossOrgMovement,
      allMandatoryConditionsPassed,
    },
  };
}
