/**
 * Super Admin Governance, Validation & Atomic Audit Payload Builders (Phase C)
 *
 * Shared pure domain module used by both AuthContext and SuperAdminDashboard so that:
 *  - Only verified `amoal2030@gmail.com` (`emailVerified === true`) can execute platform actions
 *  - Disallowed roles (`manager`, `super_admin`) and targeting `amoal2030@gmail.com` are blocked
 *  - Foreign-org branch assignments are strictly rejected on create and update/transfer
 *  - Historical billing, payment, and user records are never deleted or zeroed
 *  - Every mutation builds a bidirectionally coupled atomic `platformAuditLogs` payload matching `firestore.rules`
 *  - Duplicate/concurrent rapid-click operations are rejected deterministically
 */
import {
  Branch,
  BranchPaymentStatus,
  ExemptionClassification,
  MemberOrgHistoryRecord,
  Organization,
  PlatformAuditAction,
  PlatformAuditLog,
  SubscriptionTimestampValue,
  SupportedLanguage,
  UserPermissions,
  UserProfile,
} from '../types';
import {
  BRANCH_MONTHLY_FEE_SAR,
  evaluateBranchBillingAndGrace,
  isBranchSuspendedOrPurged,
} from './branchPricing';
import { resolveMemberMembershipStatus } from './tenantAccess';
import {
  buildNonDestructiveBranchExemptionPatch,
  buildNonDestructiveBranchExemptionRevokePatch,
  buildNonDestructiveOrgExemptionPatch,
  buildNonDestructiveOrgExemptionRevokePatch,
  normalizeEmailLower,
  verifyBranchExemptionEligibility,
  verifyOrganizationExemptionEligibility,
} from './exemptionVerification';
import {
  buildDefaultPermissionsForRole,
  SupervisorOptionalPermissionKey,
} from './permissions';
import { isVerifiedSuperAdmin, SUPER_ADMIN_EMAIL, SuperAdminAuthIdentity } from './superAdmin';
import { evaluateOrganizationSubscription } from './subscription';

export const ALLOWED_SUPER_ADMIN_MEMBER_ROLES = [
  'supervisor',
  'branch_manager',
  'employee',
] as const;

export type SuperAdminAssignableMemberRole =
  (typeof ALLOWED_SUPER_ADMIN_MEMBER_ROLES)[number];

export interface SuperAdminActorSnapshot extends SuperAdminAuthIdentity {
  uid: string;
  displayName?: string | null;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_EMAIL_REGEX = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

export function isAllowedSuperAdminMemberRole(
  role: unknown
): role is SuperAdminAssignableMemberRole {
  return (
    typeof role === 'string' &&
    (ALLOWED_SUPER_ADMIN_MEMBER_ROLES as readonly string[]).includes(role)
  );
}

/**
 * Strict identity gate for all Super Admin platform actions.
 * Explicitly rejects `onlak2030@gmail.com`, unverified emails, and any non-Super-Admin identity.
 */
export function assertSuperAdminIdentity<T extends SuperAdminAuthIdentity>(
  actor: T | null | undefined
): T {
  if (!actor || !isVerifiedSuperAdmin(actor)) {
    throw new Error(
      `هذه العملية حصرية للمدير الرئيسي الموثق (${SUPER_ADMIN_EMAIL}) مع تفعيل email_verified فقط.`
    );
  }
  return actor;
}

/**
 * Validates mandatory audit reasons matching `firestore.rules` (5..500 chars trimmed).
 */
export function validateSuperAdminAuditReason(
  reason: string | undefined | null,
  actionLabelAr: string
): string {
  const clean = typeof reason === 'string' ? reason.trim() : '';
  if (clean.length < 5 || clean.length > 500) {
    throw new Error(`يجب إدخال سبب واضح لـ ${actionLabelAr} (بين 5 و 500 حرف).`);
  }
  return clean;
}

export function generatePlatformAuditLogId(prefix = 'pal'): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'pal';
  return `${cleanPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildPlatformAuditLogEntry(params: {
  id?: string;
  actor: SuperAdminActorSnapshot;
  action: PlatformAuditAction;
  targetType: PlatformAuditLog['targetType'];
  targetId: string;
  orgId?: string;
  details: string;
  metadata?: Record<string, string | number | boolean | null>;
  timestamp?: string;
}): PlatformAuditLog {
  assertSuperAdminIdentity(params.actor);
  const id = params.id && VALID_ID_REGEX.test(params.id)
    ? params.id
    : generatePlatformAuditLogId();
  const timestamp = params.timestamp || new Date().toISOString();
  const cleanDetails =
    params.details.trim().length >= 5
      ? params.details.trim().slice(0, 1000)
      : `إجراء إداري: ${params.action}`;

  return {
    id,
    actorEmail: normalizeEmailLower(params.actor.email) || SUPER_ADMIN_EMAIL,
    actorUid: params.actor.uid,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId.slice(0, 254),
    ...(params.orgId ? { orgId: params.orgId } : {}),
    details: cleanDetails,
    ...(params.metadata ? { metadata: params.metadata } : {}),
    timestamp,
  };
}

/**
 * Deterministic concurrency guard preventing rapid double-clicks / duplicate submissions
 * for the same action key.
 */
export class InFlightActionGuard {
  private readonly activeKeys = new Set<string>();

  isRunning(key: string): boolean {
    return this.activeKeys.has(key);
  }

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (this.activeKeys.has(key)) {
      throw new Error('يوجد إجراء مماثل قيد التنفيذ حالياً؛ يرجى الانتظار حتى اكتماله لمنع التكرار.');
    }
    this.activeKeys.add(key);
    try {
      return await task();
    } finally {
      this.activeKeys.delete(key);
    }
  }
}

export function resolveOrgExemptionGrantAuditAction(
  mode: ExemptionClassification
): 'ORG_LEGACY_UNRESTRICTED_GRANTED' | 'ORG_BILLING_EXEMPTION_GRANTED' {
  return mode === 'legacy_unrestricted'
    ? 'ORG_LEGACY_UNRESTRICTED_GRANTED'
    : 'ORG_BILLING_EXEMPTION_GRANTED';
}

export function resolveOrgExemptionRevokeAuditAction(
  previousMode: ExemptionClassification | undefined | null
): 'ORG_LEGACY_UNRESTRICTED_REVOKED' | 'ORG_BILLING_EXEMPTION_REVOKED' {
  return previousMode === 'legacy_unrestricted'
    ? 'ORG_LEGACY_UNRESTRICTED_REVOKED'
    : 'ORG_BILLING_EXEMPTION_REVOKED';
}

/**
 * Builds the non-destructive organization exemption grant patch + coupled platformAuditLog.
 * Fails closed on manual suspension, missing/mismatched ownerId/users/{ownerId}, or duplicate grant.
 */
export function buildSuperAdminOrgExemptionGrantBundle(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  ownerUser: UserProfile | null;
  orgBranches: Branch[];
  mode: ExemptionClassification;
  reason: string;
  expectedOwnerEmail?: string;
  now?: Date;
  grantedAtValue: SubscriptionTimestampValue;
  auditLogId?: string;
}): {
  orgPatch: Record<string, unknown>;
  auditLog: PlatformAuditLog;
  ownerId: string;
  ownerEmail: string;
} {
  assertSuperAdminIdentity(params.actor);
  const cleanReason = validateSuperAdminAuditReason(params.reason, 'منح إعفاء المؤسسة');
  const now = params.now || new Date();
  const nowIso = now.toISOString();

  if (params.org.billingExempt === true) {
    throw new Error('هذه المؤسسة مشمولة بالإعفاء الدائم مسبقاً.');
  }

  const precheck = verifyOrganizationExemptionEligibility({
    org: params.org,
    users: params.ownerUser ? [params.ownerUser] : [],
    branches: params.orgBranches,
    expectedOwnerEmail: params.expectedOwnerEmail,
    targetMode: params.mode,
    now,
  });

  if (!precheck.eligible) {
    throw new Error(
      precheck.blockingFailures.map((f) => f.detailAr).join(' | ') ||
        'تعذر استيفاء شروط التحقق لمنح إعفاء المؤسسة.'
    );
  }

  const ownerId = precheck.ownerId!;
  const ownerEmail = precheck.ownerEmailNormalized!;
  const action = resolveOrgExemptionGrantAuditAction(params.mode);
  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action,
    targetType: 'billing',
    targetId: params.org.id,
    orgId: params.org.id,
    details:
      params.mode === 'legacy_unrestricted'
        ? `منح إعفاء دائم من نوع legacy_unrestricted للمؤسسة "${params.org.name}" (${params.org.id}) للمالك الموثق ${ownerEmail} (${ownerId}) — الفروع المشمولة: ${precheck.branchesInventory.totalBranchesCount} — السبب: ${cleanReason}`
        : `منح إعفاء دائم شامل (billing_exempt) للمؤسسة "${params.org.name}" (${params.org.id}) للمالك الموثق ${ownerEmail} (${ownerId}) — الفروع المشمولة: ${precheck.branchesInventory.totalBranchesCount} — السبب: ${cleanReason}`,
    metadata: {
      orgId: params.org.id,
      ownerId,
      ownerEmail,
      mode: params.mode,
      scope: 'full_permanent',
      branchesCount: precheck.branchesInventory.totalBranchesCount,
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const basePatch = buildNonDestructiveOrgExemptionPatch({
    org: params.org,
    mode: params.mode,
    reason: cleanReason,
    grantedBy: normalizeEmailLower(params.actor.email) || SUPER_ADMIN_EMAIL,
    grantedAt: params.grantedAtValue,
    auditLogId: auditLog.id,
  });

  // Keep the org exemption grant patch strictly scoped to exemption fields + updatedAt:
  // 1) Preserves historical grace/deactivation metadata untouched.
  // 2) Both firestore.rules (isOrgSubscriptionAllowed) and branchPricing.ts (evaluateOrgNoPaidBranchGrace)
  //    already short-circuit grace timers whenever isOrgPermanentlyBillingExempt is true.
  // 3) Prevents triggering hasValidOrgFeeAndDeactivationFields alongside canSuperAdminGrantOrgBillingExemption
  //    in the same organizations update (which would exceed Firestore's 1,000-expression budget).
  const orgPatch: Record<string, unknown> = {
    ...basePatch,
    updatedAt: nowIso,
  };

  return { orgPatch, auditLog, ownerId, ownerEmail };
}

/**
 * Builds the non-destructive organization exemption revoke patch + coupled platformAuditLog.
 */
export function buildSuperAdminOrgExemptionRevokeBundle(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  reason: string;
  now?: Date;
  revokedAtValue: SubscriptionTimestampValue;
  auditLogId?: string;
}): {
  orgPatch: Record<string, unknown>;
  auditLog: PlatformAuditLog;
} {
  assertSuperAdminIdentity(params.actor);
  const cleanReason = validateSuperAdminAuditReason(params.reason, 'إلغاء إعفاء المؤسسة');
  if (params.org.billingExempt !== true) {
    throw new Error('هذه المؤسسة ليست مشمولة بإعفاء صريح حالياً.');
  }

  const now = params.now || new Date();
  const nowIso = now.toISOString();
  const previousMode: ExemptionClassification =
    params.org.billingExemptMode === 'legacy_unrestricted'
      ? 'legacy_unrestricted'
      : 'billing_exempt';
  const action = resolveOrgExemptionRevokeAuditAction(previousMode);

  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action,
    targetType: 'billing',
    targetId: params.org.id,
    orgId: params.org.id,
    details: `إلغاء الإعفاء الدائم (${previousMode}) للمؤسسة "${params.org.name}" (${params.org.id}) وإعادتها لنظام الرسوم القياسي مع حفظ كامل البيانات التاريخية — السبب: ${cleanReason}`,
    metadata: {
      orgId: params.org.id,
      previousMode,
      ownerId: params.org.ownerId || null,
      ownerEmail: normalizeEmailLower(params.org.ownerEmail) || null,
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const orgPatch: Record<string, unknown> = {
    ...buildNonDestructiveOrgExemptionRevokePatch({
      revokeReason: cleanReason,
      revokedBy: normalizeEmailLower(params.actor.email) || SUPER_ADMIN_EMAIL,
      revokedAt: params.revokedAtValue,
      auditLogId: auditLog.id,
    }),
    updatedAt: nowIso,
  };

  return { orgPatch, auditLog };
}

/**
 * Builds an independent branch exemption grant patch + coupled platformAuditLog.
 * Never mutates historical payment fields (`subscriptionStartAt`, `lastPaidAt`, `lastPaidBy`, `paymentNote`).
 */
export function buildSuperAdminBranchExemptionGrantBundle(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  branch: Branch;
  mode: ExemptionClassification;
  reason: string;
  now?: Date;
  grantedAtValue: SubscriptionTimestampValue;
  auditLogId?: string;
}): {
  branchPatch: Record<string, unknown>;
  auditLog: PlatformAuditLog;
} {
  assertSuperAdminIdentity(params.actor);
  const cleanReason = validateSuperAdminAuditReason(params.reason, 'منح إعفاء الفرع');
  const now = params.now || new Date();
  const nowIso = now.toISOString();

  const precheck = verifyBranchExemptionEligibility({
    branch: params.branch,
    org: params.org,
    now,
  });
  if (!precheck.eligible) {
    throw new Error(precheck.blockingReasonAr || 'الفرع غير مؤهل لمنح الإعفاء.');
  }

  if (
    params.branch.billingExempt === true &&
    (params.branch.billingExemptMode || 'billing_exempt') === params.mode
  ) {
    throw new Error('هذا الفرع معفى فردياً بالفعل بنفس التصنيف المحدد.');
  }

  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action: 'BRANCH_BILLING_EXEMPTION_GRANTED',
    targetType: 'branch',
    targetId: params.branch.id,
    orgId: params.org.id,
    details: `منح إعفاء دائم (${params.mode}) للفرع "${params.branch.name}" (${params.branch.code}) التابع للمؤسسة "${params.org.name}" (0 ر.س مع حفظ سجلات الدفع التاريخية) — السبب: ${cleanReason}`,
    metadata: {
      orgId: params.org.id,
      branchId: params.branch.id,
      branchName: params.branch.name,
      mode: params.mode,
      scope: 'branch_permanent',
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const branchPatch: Record<string, unknown> = {
    ...buildNonDestructiveBranchExemptionPatch({
      mode: params.mode,
      reason: cleanReason,
      grantedBy: normalizeEmailLower(params.actor.email) || SUPER_ADMIN_EMAIL,
      grantedAt: params.grantedAtValue,
      auditLogId: auditLog.id,
    }),
    feeDueAt: null,
    updatedAt: nowIso,
  };

  return { branchPatch, auditLog };
}

/**
 * Builds an independent branch exemption revoke patch + coupled platformAuditLog.
 * Never mutates historical payment fields or original grant metadata, and NEVER cancels inherited org exemption.
 */
export function buildSuperAdminBranchExemptionRevokeBundle(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  branch: Branch;
  restoredPaymentStatus?: Exclude<BranchPaymentStatus, 'exempt'>;
  restoredMonthlyFeeSar?: number;
  reason: string;
  now?: Date;
  revokedAtValue: SubscriptionTimestampValue;
  auditLogId?: string;
}): {
  branchPatch: Record<string, unknown>;
  auditLog: PlatformAuditLog;
  parentOrgRemainsExempt: boolean;
} {
  assertSuperAdminIdentity(params.actor);
  const cleanReason = validateSuperAdminAuditReason(params.reason, 'إلغاء إعفاء الفرع');
  const now = params.now || new Date();
  const nowIso = now.toISOString();

  if (params.branch.orgId !== params.org.id) {
    throw new Error('الفرع لا يتبع للمؤسسة المحددة.');
  }
  if (params.branch.lifecycleStatus === 'purged_from_db') {
    throw new Error('لا يمكن تعديل إعفاء فرع محذوف من قاعدة البيانات.');
  }
  const hasIndividualExemption =
    params.branch.billingExempt === true || params.branch.paymentStatus === 'exempt';
  if (!hasIndividualExemption) {
    throw new Error('هذا الفرع لا يحمل إعفاءً فردياً قابلاً للإلغاء حالياً.');
  }

  const restoredStatus: Exclude<BranchPaymentStatus, 'exempt'> =
    params.restoredPaymentStatus &&
    (['paid', 'unpaid', 'overdue'] as const).includes(params.restoredPaymentStatus)
      ? params.restoredPaymentStatus
      : 'unpaid';

  const defaultFee =
    typeof params.org.extraBranchMonthlyFeeSar === 'number' &&
    params.org.extraBranchMonthlyFeeSar >= 0
      ? params.org.extraBranchMonthlyFeeSar
      : BRANCH_MONTHLY_FEE_SAR;
  const restoredMonthlyFeeSar =
    typeof params.restoredMonthlyFeeSar === 'number' &&
    Number.isFinite(params.restoredMonthlyFeeSar) &&
    params.restoredMonthlyFeeSar >= 0
      ? params.restoredMonthlyFeeSar
      : defaultFee;

  const orgSubEval = evaluateOrganizationSubscription(params.org, now);
  const parentOrgRemainsExempt = orgSubEval.isFeeExempt;

  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action: 'BRANCH_BILLING_EXEMPTION_REVOKED',
    targetType: 'branch',
    targetId: params.branch.id,
    orgId: params.org.id,
    details: parentOrgRemainsExempt
      ? `إلغاء الإعفاء الفردي للفرع "${params.branch.name}" (${params.branch.code}) مع بقاء إعفاء المؤسسة الأم الموروث سارياً — السبب: ${cleanReason}`
      : `إلغاء الإعفاء الفردي للفرع "${params.branch.name}" (${params.branch.code}) وإعادته لنظام الرسوم (${restoredMonthlyFeeSar} ر.س / ${restoredStatus}) مع حفظ سجل الإعفاء السابق — السبب: ${cleanReason}`,
    metadata: {
      orgId: params.org.id,
      branchId: params.branch.id,
      branchName: params.branch.name,
      restoredPaymentStatus: restoredStatus,
      restoredMonthlyFeeSar,
      parentOrgRemainsExempt,
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const branchPatch: Record<string, unknown> = {
    ...buildNonDestructiveBranchExemptionRevokePatch({
      restoredPaymentStatus: restoredStatus,
      restoredMonthlyFeeSar,
      revokeReason: cleanReason,
      revokedBy: normalizeEmailLower(params.actor.email) || SUPER_ADMIN_EMAIL,
      revokedAt: params.revokedAtValue,
      auditLogId: auditLog.id,
    }),
    updatedAt: nowIso,
  };

  return { branchPatch, auditLog, parentOrgRemainsExempt };
}

/**
 * Builds bulk all-branch exemption bundles for an organization (chunked safely for Firestore batch call budgets).
 * Every chunk has a unique `auditLog.id` and `metadata.primaryBranchId` matching `firestore.rules`.
 */
export function buildSuperAdminBulkBranchesExemptionBundles(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  branches: Branch[];
  mode: ExemptionClassification;
  reason: string;
  now?: Date;
  grantedAtValue: SubscriptionTimestampValue;
  chunkSize?: number;
}): Array<{
  branches: Array<{ branch: Branch; patch: Record<string, unknown> }>;
  auditLog: PlatformAuditLog;
}> {
  assertSuperAdminIdentity(params.actor);
  const cleanReason = validateSuperAdminAuditReason(params.reason, 'إعفاء جميع فروع المؤسسة');
  const now = params.now || new Date();
  const nowIso = now.toISOString();

  // Strictly filter to branches belonging to params.org.id and not purged_from_db
  const foreignBranch = params.branches.find((b) => b.orgId !== params.org.id);
  if (foreignBranch) {
    throw new Error(
      `لا يمكن تنفيذ الإعفاء الجماعي لوجود فرع (${foreignBranch.id}) تابع لمؤسسة أخرى.`
    );
  }

  const eligibleBranches = params.branches.filter(
    (b) =>
      b.orgId === params.org.id &&
      b.lifecycleStatus !== 'purged_from_db' &&
      !(b.billingExempt === true && (b.billingExemptMode || 'billing_exempt') === params.mode)
  );

  if (eligibleBranches.length === 0) {
    throw new Error(
      'لا توجد فروع مؤهلة غير معفاة حالياً في هذه المؤسسة لتطبيق الإعفاء الجماعي.'
    );
  }

  const safeChunkSize = Math.max(1, Math.min(10, params.chunkSize ?? 8));
  const chunks: Array<{
    branches: Array<{ branch: Branch; patch: Record<string, unknown> }>;
    auditLog: PlatformAuditLog;
  }> = [];

  for (let i = 0; i < eligibleBranches.length; i += safeChunkSize) {
    const slice = eligibleBranches.slice(i, i + safeChunkSize);
    const primaryBranch = slice[0];
    const auditLog = buildPlatformAuditLogEntry({
      id: generatePlatformAuditLogId('pal_bulk'),
      actor: params.actor,
      action: 'ORG_BRANCHES_BULK_EXEMPTION_GRANTED',
      targetType: 'organization',
      targetId: params.org.id,
      orgId: params.org.id,
      details: `إعفاء جماعي دائم (${params.mode}) لعدد ${slice.length} فرع في المؤسسة "${params.org.name}" (الفرع المرجعي: ${primaryBranch.name}) — السبب: ${cleanReason}`,
      metadata: {
        orgId: params.org.id,
        primaryBranchId: primaryBranch.id,
        exemptedBranchesCount: slice.length,
        mode: params.mode,
        scope: 'branch_permanent',
        reason: cleanReason,
      },
      timestamp: nowIso,
    });

    const items = slice.map((branch) => ({
      branch,
      patch: {
        ...buildNonDestructiveBranchExemptionPatch({
          mode: params.mode,
          reason: cleanReason,
          grantedBy: normalizeEmailLower(params.actor.email) || SUPER_ADMIN_EMAIL,
          grantedAt: params.grantedAtValue,
          auditLogId: auditLog.id,
        }),
        feeDueAt: null,
        updatedAt: nowIso,
      },
    }));

    chunks.push({ branches: items, auditLog });
  }

  return chunks;
}

export interface SuperAdminCreateMemberValidatedInput {
  orgId: string;
  email: string;
  displayName: string;
  role: SuperAdminAssignableMemberRole;
  branchId?: string;
  branchName?: string;
  phone: string;
  permissions: ReturnType<typeof buildDefaultPermissionsForRole>;
}

/**
 * Validates Super Admin cross-organization member creation input before touching Firebase Auth or Firestore.
 */
export function validateSuperAdminMemberCreateInput(params: {
  actor: SuperAdminAuthIdentity | null | undefined;
  org: Organization | null | undefined;
  orgBranches: Branch[];
  email: string;
  password: string;
  displayName: string;
  role: string;
  branchId?: string;
  phone?: string;
  supervisorPermissions?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
}): SuperAdminCreateMemberValidatedInput {
  assertSuperAdminIdentity(params.actor);

  if (!params.org || !VALID_ID_REGEX.test(params.org.id)) {
    throw new Error('المؤسسة المستهدفة غير موجودة أو معرّفها غير صالح.');
  }

  if (!isAllowedSuperAdminMemberRole(params.role)) {
    throw new Error(
      'الأدوار المسموح بها من إدارة الأعضاء هي فقط: مسؤول (supervisor)، مسؤول فرع (branch_manager)، موظف (employee). يمنع إنشاء مدير مؤسسة أو مدير رئيسي من هنا.'
    );
  }

  const cleanName = (params.displayName || '').trim();
  if (cleanName.length < 1 || cleanName.length > 100) {
    throw new Error('يجب إدخال اسم عضو صحيح (بين 1 و 100 حرف).');
  }

  const cleanEmail = (params.email || '').trim();
  const normalizedEmail = normalizeEmailLower(cleanEmail);
  if (!VALID_EMAIL_REGEX.test(normalizedEmail) || cleanEmail.length > 254) {
    throw new Error('صيغة البريد الإلكتروني غير صحيحة.');
  }
  if (normalizedEmail === SUPER_ADMIN_EMAIL) {
    throw new Error('لا يمكن إنشاء أو استهداف حساب المدير الرئيسي من إدارة الأعضاء.');
  }

  if (typeof params.password !== 'string' || params.password.length < 6) {
    throw new Error('يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.');
  }

  const cleanPhone = (params.phone || '').trim().slice(0, 25);

  let resolvedBranch: Branch | undefined;
  if (params.role === 'branch_manager' || params.role === 'employee') {
    const cleanBranchId = (params.branchId || '').trim();
    if (!cleanBranchId) {
      throw new Error(
        params.role === 'branch_manager'
          ? 'يجب اختيار فرع تابع للمؤسسة نفسها عند تعيين دور مسؤول فرع.'
          : 'يجب اختيار فرع تابع للمؤسسة نفسها عند إنشاء موظف.'
      );
    }
    resolvedBranch = params.orgBranches.find((b) => b.id === cleanBranchId);
    if (!resolvedBranch || resolvedBranch.orgId !== params.org.id) {
      throw new Error(
        'الفرع المحدد غير موجود أو يتبع لمؤسسة أخرى؛ يمنع ربط عضو بفرع من مؤسسة أجنبية.'
      );
    }
    if (resolvedBranch.lifecycleStatus === 'purged_from_db') {
      throw new Error('لا يمكن ربط عضو بفرع تم حذف سجلاته من قاعدة البيانات.');
    }
  }

  const permissions = buildDefaultPermissionsForRole(
    params.role,
    params.role === 'supervisor' ? params.supervisorPermissions : undefined
  );

  return {
    orgId: params.org.id,
    email: normalizedEmail,
    displayName: cleanName,
    role: params.role,
    ...(resolvedBranch
      ? { branchId: resolvedBranch.id, branchName: resolvedBranch.name.slice(0, 120) }
      : {}),
    phone: cleanPhone,
    permissions,
  };
}

/**
 * Builds the atomic `users/{newUid}` document + coupled `platformAuditLogs/{logId}` for `MEMBER_CREATED`.
 */
export function buildSuperAdminMemberCreateBundle(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  newUid: string;
  validated: SuperAdminCreateMemberValidatedInput;
  now?: Date;
  auditLogId?: string;
}): {
  userDoc: UserProfile;
  auditLog: PlatformAuditLog;
} {
  assertSuperAdminIdentity(params.actor);
  if (!VALID_ID_REGEX.test(params.newUid)) {
    throw new Error('معرّف المستخدم (UID) غير صالح.');
  }
  const now = params.now || new Date();
  const nowIso = now.toISOString();

  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action: 'MEMBER_CREATED',
    targetType: 'member',
    targetId: params.newUid,
    orgId: params.org.id,
    details: `إنشاء عضو جديد "${params.validated.displayName}" (${params.validated.email}) بدور ${params.validated.role} في مؤسسة "${params.org.name}"${
      params.validated.branchName ? ` — الفرع: ${params.validated.branchName}` : ' — نطاق المؤسسة'
    }`,
    metadata: {
      orgId: params.org.id,
      memberUid: params.newUid,
      email: normalizeEmailLower(params.validated.email),
      role: params.validated.role,
      branchId: params.validated.branchId || null,
      branchName: params.validated.branchName || null,
      reason: 'إضافة عضو جديد من لوحة المدير الرئيسي',
    },
    timestamp: nowIso,
  });

  const userDoc: UserProfile = {
    uid: params.newUid,
    orgId: params.org.id,
    email: params.validated.email,
    displayName: params.validated.displayName,
    role: params.validated.role,
    ...(params.validated.branchId
      ? {
          branchId: params.validated.branchId,
          branchName: params.validated.branchName || '',
        }
      : {}),
    ...(params.validated.role === 'branch_manager' && params.validated.branchId
      ? { branchIds: [params.validated.branchId] }
      : {}),
    phone: params.validated.phone,
    isActive: true,
    isArchived: false,
    membershipStatus: 'active',
    permissions: params.validated.permissions,
    lastPlatformAuditLogId: auditLog.id,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return { userDoc, auditLog };
}

/**
 * Validates and builds atomic update patch + coupled `platformAuditLogs/{logId}` for editing a member's
 * role, branch, profile, or supervisor permissions.
 * Strictly forbids editing `manager`, targeting `amoal2030@gmail.com`, changing `orgId`/`uid`, or binding foreign branches.
 */
export function buildSuperAdminMemberUpdateBundle(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  existingMember: UserProfile;
  orgBranches: Branch[];
  displayName: string;
  phone?: string;
  role: string;
  branchId?: string;
  supervisorPermissions?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
  targetOrgIdAttempt?: string;
  reason?: string;
  now?: Date;
  auditLogId?: string;
  deleteFieldSentinel: unknown;
}): {
  action: 'MEMBER_ROLE_CHANGED' | 'MEMBER_BRANCH_CHANGED' | 'MEMBER_UPDATED';
  userPatch: Record<string, unknown>;
  auditLog: PlatformAuditLog;
} {
  assertSuperAdminIdentity(params.actor);

  if (resolveMemberMembershipStatus(params.existingMember) === 'released') {
    throw new Error(
      'هذا العضو محرر نهائياً ولا يتبع لأي مؤسسة حالياً؛ استخدم خيار «إعادة ربط بمؤسسة» لربطه بمؤسسة نشطة.'
    );
  }

  if (
    params.targetOrgIdAttempt &&
    params.targetOrgIdAttempt.trim() !== params.existingMember.orgId
  ) {
    throw new Error('لا يُسمح بنقل العضو قسراً إلى مؤسسة أخرى؛ يجب الحفاظ على orgId ثابتاً.');
  }

  if (params.existingMember.orgId !== params.org.id) {
    throw new Error('عدم تطابق المؤسسة المرتبطة بالعضو.');
  }

  if (!isAllowedSuperAdminMemberRole(params.existingMember.role)) {
    throw new Error(
      'لا يمكن تعديل دور أو عضوية مدير المؤسسة (manager) من واجهة إدارة الأعضاء.'
    );
  }

  if (!isAllowedSuperAdminMemberRole(params.role)) {
    throw new Error(
      'الأدوار المسموحة هي فقط: supervisor، branch_manager، employee. يمنع الترقية إلى manager أو super_admin.'
    );
  }

  if (normalizeEmailLower(params.existingMember.email) === SUPER_ADMIN_EMAIL) {
    throw new Error('لا يمكن تعديل حساب المدير الرئيسي من إدارة الأعضاء.');
  }

  const cleanName = (params.displayName || '').trim();
  if (cleanName.length < 1 || cleanName.length > 100) {
    throw new Error('يجب إدخال اسم عضو صحيح (بين 1 و 100 حرف).');
  }
  const cleanPhone = (params.phone || '').trim().slice(0, 25);

  let resolvedBranch: Branch | undefined;
  if (params.role === 'branch_manager' || params.role === 'employee') {
    const cleanBranchId = (params.branchId || '').trim();
    if (!cleanBranchId) {
      throw new Error(
        params.role === 'branch_manager'
          ? 'يجب اختيار فرع تابع لنفس المؤسسة عند تعيين دور مسؤول فرع.'
          : 'يجب اختيار فرع تابع لنفس المؤسسة للموظف.'
      );
    }
    resolvedBranch = params.orgBranches.find((b) => b.id === cleanBranchId);
    if (!resolvedBranch || resolvedBranch.orgId !== params.existingMember.orgId) {
      throw new Error(
        'الفرع المحدد لا يتبع لمؤسسة العضو؛ يمنع ربط العضو بفرع تابع لمؤسسة أخرى.'
      );
    }
    if (resolvedBranch.lifecycleStatus === 'purged_from_db') {
      throw new Error('لا يمكن نقل العضو إلى فرع محذوف من قاعدة البيانات.');
    }
  }

  const prevBranchId = (params.existingMember.branchId || '').trim();
  const nextBranchId = resolvedBranch ? resolvedBranch.id : '';
  const roleChanged = params.role !== params.existingMember.role;
  const branchChanged = nextBranchId !== prevBranchId;

  const action: 'MEMBER_ROLE_CHANGED' | 'MEMBER_BRANCH_CHANGED' | 'MEMBER_UPDATED' =
    roleChanged
      ? 'MEMBER_ROLE_CHANGED'
      : branchChanged
      ? 'MEMBER_BRANCH_CHANGED'
      : 'MEMBER_UPDATED';

  const now = params.now || new Date();
  const nowIso = now.toISOString();
  const permissions = buildDefaultPermissionsForRole(
    params.role,
    params.role === 'supervisor' ? params.supervisorPermissions : undefined
  );
  const cleanReason = (params.reason || '').trim().slice(0, 500);

  const details =
    action === 'MEMBER_ROLE_CHANGED'
      ? `تغيير دور العضو "${cleanName}" في مؤسسة "${params.org.name}" من ${params.existingMember.role} إلى ${params.role}${
          resolvedBranch ? ` (الفرع: ${resolvedBranch.name})` : ' (نطاق المؤسسة)'
        }${cleanReason ? ` — السبب: ${cleanReason}` : ''}`
      : action === 'MEMBER_BRANCH_CHANGED'
      ? `نقل العضو "${cleanName}" في مؤسسة "${params.org.name}" إلى فرع "${resolvedBranch?.name || '—'}" (${nextBranchId})${
          cleanReason ? ` — السبب: ${cleanReason}` : ''
        }`
      : `تحديث بيانات وصلاحيات العضو "${cleanName}" في مؤسسة "${params.org.name}"${
          cleanReason ? ` — السبب: ${cleanReason}` : ''
        }`;

  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action,
    targetType: 'member',
    targetId: params.existingMember.uid,
    orgId: params.existingMember.orgId,
    details,
    metadata: {
      orgId: params.existingMember.orgId,
      memberUid: params.existingMember.uid,
      previousRole: params.existingMember.role,
      newRole: params.role,
      previousBranchId: prevBranchId || null,
      newBranchId: nextBranchId || null,
      reason: cleanReason || null,
    },
    timestamp: nowIso,
  });

  const userPatch: Record<string, unknown> = {
    displayName: cleanName,
    phone: cleanPhone,
    role: params.role,
    permissions,
    lastPlatformAuditLogId: auditLog.id,
    updatedAt: nowIso,
  };

  if (params.role === 'supervisor') {
    userPatch.branchId = params.deleteFieldSentinel;
    userPatch.branchIds = params.deleteFieldSentinel;
    userPatch.branchName = params.deleteFieldSentinel;
  } else if (params.role === 'branch_manager' && resolvedBranch) {
    userPatch.branchId = resolvedBranch.id;
    userPatch.branchIds = [resolvedBranch.id];
    userPatch.branchName = resolvedBranch.name.slice(0, 120);
  } else if (resolvedBranch) {
    userPatch.branchId = resolvedBranch.id;
    userPatch.branchIds = params.deleteFieldSentinel;
    userPatch.branchName = resolvedBranch.name.slice(0, 120);
  }

  return { action, userPatch, auditLog };
}

/**
 * Builds atomic soft-archive patch + coupled `platformAuditLogs/{logId}` (`MEMBER_ARCHIVED`).
 * Never deletes the user document, Google account, or historical closings/purchases.
 */
export function buildSuperAdminMemberArchiveBundle(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  existingMember: UserProfile;
  reason: string;
  now?: Date;
  auditLogId?: string;
}): {
  userPatch: Record<string, unknown>;
  auditLog: PlatformAuditLog;
} {
  assertSuperAdminIdentity(params.actor);
  const cleanReason = validateSuperAdminAuditReason(params.reason, 'أرشفة العضو');

  if (resolveMemberMembershipStatus(params.existingMember) === 'released') {
    throw new Error('هذا العضو محرر نهائياً بالفعل ولا يمكن أرشفته.');
  }
  if (!isAllowedSuperAdminMemberRole(params.existingMember.role)) {
    throw new Error('لا يمكن أرشفة مدير المؤسسة (manager) من واجهة إدارة الأعضاء.');
  }
  if (normalizeEmailLower(params.existingMember.email) === SUPER_ADMIN_EMAIL) {
    throw new Error('لا يمكن أرشفة حساب المدير الرئيسي.');
  }
  if (params.existingMember.isArchived === true) {
    throw new Error('هذا العضو مؤرشف بالفعل.');
  }

  const now = params.now || new Date();
  const nowIso = now.toISOString();

  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action: 'MEMBER_ARCHIVED',
    targetType: 'member',
    targetId: params.existingMember.uid,
    orgId: params.existingMember.orgId,
    details: `أرشفة وتعطيل عضوية "${params.existingMember.displayName}" (${params.existingMember.email}) في مؤسسة "${params.org.name}" دون حذف أي سجلات تاريخية — السبب: ${cleanReason}`,
    metadata: {
      orgId: params.existingMember.orgId,
      memberUid: params.existingMember.uid,
      role: params.existingMember.role,
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const userPatch: Record<string, unknown> = {
    isActive: false,
    isArchived: true,
    membershipStatus: 'archived',
    archivedAt: nowIso,
    archivedBy: params.actor.uid,
    lastPlatformAuditLogId: auditLog.id,
    updatedAt: nowIso,
  };

  return { userPatch, auditLog };
}

/**
 * Builds atomic reactivation patch + coupled `platformAuditLogs/{logId}` (`MEMBER_REACTIVATED`).
 * Preserves historical `archivedAt` / `archivedBy` metadata.
 * Strictly forbids reactivating a permanently `released` member.
 */
export function buildSuperAdminMemberReactivateBundle(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  existingMember: UserProfile;
  reason?: string;
  now?: Date;
  auditLogId?: string;
}): {
  userPatch: Record<string, unknown>;
  auditLog: PlatformAuditLog;
} {
  assertSuperAdminIdentity(params.actor);

  if (resolveMemberMembershipStatus(params.existingMember) === 'released') {
    throw new Error(
      'لا يمكن إعادة تفعيل عضو تم فصل عضويته نهائياً في مؤسسته السابقة؛ يجب استخدام إجراء «إعادة ربط بمؤسسة» بشكل صريح.'
    );
  }
  if (!isAllowedSuperAdminMemberRole(params.existingMember.role)) {
    throw new Error('لا يمكن تعديل حالة مدير المؤسسة (manager) من واجهة إدارة الأعضاء.');
  }
  if (normalizeEmailLower(params.existingMember.email) === SUPER_ADMIN_EMAIL) {
    throw new Error('لا يمكن تعديل حساب المدير الرئيسي من إدارة الأعضاء.');
  }
  if (params.existingMember.isActive === true && params.existingMember.isArchived !== true) {
    throw new Error('هذا العضو نشط بالفعل.');
  }

  const now = params.now || new Date();
  const nowIso = now.toISOString();
  const cleanReason =
    (params.reason || '').trim().slice(0, 500) || 'إعادة تفعيل العضوية من لوحة المدير الرئيسي';

  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action: 'MEMBER_REACTIVATED',
    targetType: 'member',
    targetId: params.existingMember.uid,
    orgId: params.existingMember.orgId,
    details: `إعادة تفعيل عضوية "${params.existingMember.displayName}" (${params.existingMember.email}) في مؤسسة "${params.org.name}" — السبب: ${cleanReason}`,
    metadata: {
      orgId: params.existingMember.orgId,
      memberUid: params.existingMember.uid,
      role: params.existingMember.role,
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const userPatch: Record<string, unknown> = {
    isActive: true,
    isArchived: false,
    membershipStatus: 'active',
    lastPlatformAuditLogId: auditLog.id,
    updatedAt: nowIso,
  };

  return { userPatch, auditLog };
}

/**
 * Generates a unique, valid Firestore ID for `memberOrgHistory/{historyId}`.
 */
export function generateMemberOrgHistoryId(prefix = 'moh'): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'moh';
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${safePrefix}_${ts}_${rand}`;
}

/**
 * Builds an all-false permissions map for permanently released members so zero
 * operational capability remains on their profile while unattached to any org.
 */
export function buildReleasedMemberZeroPermissions(): UserPermissions {
  return {
    canCreateClosing: false,
    canViewAllClosings: false,
    canApproveClosings: false,
    canManageBranches: false,
    canManageEmployees: false,
    canExportReports: false,
    canManagePurchases: false,
    canManageSuppliers: false,
    canViewSuppliers: false,
    canViewFinancialReports: false,
  };
}

/**
 * Checks whether a member is permanently released from any organization.
 */
export function isMemberReleased(member: UserProfile | null | undefined): boolean {
  return resolveMemberMembershipStatus(member) === 'released';
}

/**
 * Checks whether a member is eligible for permanent membership release.
 * Strictly excludes `manager`, `super_admin`, `amoal2030@gmail.com`, org owners,
 * and members already in `released` state or missing an org binding.
 */
export function isMemberEligibleForRelease(
  member: UserProfile | null | undefined,
  org?: Organization | null
): boolean {
  if (!member) return false;
  if (resolveMemberMembershipStatus(member) === 'released') return false;
  if (!member.orgId || !member.orgId.trim()) return false;
  if (!isAllowedSuperAdminMemberRole(member.role)) return false;
  const memberEmailLower = normalizeEmailLower(member.email);
  if (!memberEmailLower || memberEmailLower === SUPER_ADMIN_EMAIL) return false;
  if (org) {
    if (org.ownerId && org.ownerId === member.uid) return false;
    if (org.ownerEmail && normalizeEmailLower(org.ownerEmail) === memberEmailLower) return false;
  }
  return true;
}

/**
 * Validates and builds the atomic 3-document bundle for permanently releasing a staff member's
 * membership from their current organization (`users/{uid}` + `memberOrgHistory/{historyId}` + `platformAuditLogs/{auditLogId}`).
 *
 * Guarantees:
 * - Only verified Super Admin (`amoal2030@gmail.com`) can execute.
 * - Preserves Firebase Auth account, `uid`, `email`, `displayName`, `phone`, `createdAt`, and all
 *   historical records (`closings`, `purchases`, `attachments`, `auditLogs`, `closingArchives`, `notifications`).
 * - Detaches `orgId` (`''`), removes branch bindings, zeroes operational permissions, sets `membershipStatus: 'released'`,
 *   `isActive: false`, `isArchived: false`, and writes immutable history + platform audit records.
 * - Strictly blocks releasing organization owners, `manager`, `super_admin`, or `amoal2030@gmail.com`.
 */
export function buildSuperAdminMemberReleaseBundle(params: {
  actor: SuperAdminActorSnapshot;
  org: Organization;
  existingMember: UserProfile;
  reason: string;
  now?: Date;
  auditLogId?: string;
  historyId?: string;
  deleteFieldSentinel: unknown;
}): {
  userPatch: Record<string, unknown>;
  historyRecord: MemberOrgHistoryRecord;
  auditLog: PlatformAuditLog;
} {
  assertSuperAdminIdentity(params.actor);
  const cleanReason = validateSuperAdminAuditReason(params.reason, 'فصل عضوية الموظف نهائياً');

  if (resolveMemberMembershipStatus(params.existingMember) === 'released') {
    throw new Error('هذا العضو محرر نهائياً بالفعل ولا يرتبط بأي مؤسسة حالياً.');
  }
  if (!params.existingMember.orgId || params.existingMember.orgId !== params.org.id) {
    throw new Error('عدم تطابق المؤسسة الحالية للعضو مع المؤسسة المحددة.');
  }
  if (!isAllowedSuperAdminMemberRole(params.existingMember.role)) {
    throw new Error(
      'يُمنع فصل عضوية مدير المؤسسة (manager) أو المالك من خلال إجراء فصل عضوية الموظفين.'
    );
  }

  const memberEmailLower = normalizeEmailLower(params.existingMember.email);
  if (memberEmailLower === SUPER_ADMIN_EMAIL) {
    throw new Error('يُمنع فصل حساب المدير الرئيسي للمنصة.');
  }
  if (
    (params.org.ownerId && params.org.ownerId === params.existingMember.uid) ||
    (params.org.ownerEmail && normalizeEmailLower(params.org.ownerEmail) === memberEmailLower)
  ) {
    throw new Error('يُمنع فصل مالك المؤسسة (ownerId / ownerEmail) عبر هذا الإجراء.');
  }

  const now = params.now || new Date();
  const nowIso = now.toISOString();
  const actorEmail = normalizeEmailLower(params.actor.email);
  const historyId = (params.historyId || generateMemberOrgHistoryId('moh_rel')).trim();
  const prevBranchId = (params.existingMember.branchId || '').trim();
  const prevBranchName = (params.existingMember.branchName || '').trim().slice(0, 120);
  const cleanOrgName = (params.org.name || params.org.id).trim().slice(0, 120);

  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action: 'MEMBER_ORG_MEMBERSHIP_RELEASED',
    targetType: 'member',
    targetId: params.existingMember.uid,
    orgId: params.org.id,
    details: `فصل عضوية "${params.existingMember.displayName}" (${params.existingMember.email}) نهائياً عن مؤسسة "${cleanOrgName}" مع الاحتفاظ بحساب المصادقة وكافة السجلات التاريخية — السبب: ${cleanReason}`,
    metadata: {
      historyId,
      previousOrgId: params.org.id,
      previousOrgName: cleanOrgName,
      previousRole: params.existingMember.role,
      previousBranchId: prevBranchId || null,
      memberUid: params.existingMember.uid,
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const currentOrgJoinedAt =
    params.existingMember.reassignedAt || params.existingMember.createdAt;

  const historyRecord: MemberOrgHistoryRecord = {
    id: historyId,
    eventType: 'released',
    uid: params.existingMember.uid,
    email: params.existingMember.email,
    displayName: params.existingMember.displayName,
    orgId: params.org.id,
    orgName: cleanOrgName,
    role: params.existingMember.role,
    ...(prevBranchId ? { branchId: prevBranchId } : {}),
    ...(prevBranchName ? { branchName: prevBranchName } : {}),
    ...(currentOrgJoinedAt ? { joinedAt: currentOrgJoinedAt } : {}),
    effectiveAt: nowIso,
    actorUid: params.actor.uid,
    actorEmail,
    reason: cleanReason,
    auditLogId: auditLog.id,
    createdAt: nowIso,
  };

  const userPatch: Record<string, unknown> = {
    orgId: '',
    membershipStatus: 'released',
    isActive: false,
    isArchived: false,
    archivedAt: params.deleteFieldSentinel,
    archivedBy: params.deleteFieldSentinel,
    branchId: params.deleteFieldSentinel,
    branchIds: params.deleteFieldSentinel,
    branchName: params.deleteFieldSentinel,
    permissions: buildReleasedMemberZeroPermissions(),
    releasedFromOrgId: params.org.id,
    releasedFromOrgName: cleanOrgName,
    releasedAt: nowIso,
    releasedBy: actorEmail,
    releaseReason: cleanReason,
    lastMemberOrgHistoryId: historyId,
    lastPlatformAuditLogId: auditLog.id,
    updatedAt: nowIso,
  };

  return { userPatch, historyRecord, auditLog };
}

/**
 * Validates and builds the atomic 3-document bundle for assigning a permanently `released`
 * staff member (reusing their existing Firebase Auth UID) to a target active organization
 * (`users/{uid}` + `memberOrgHistory/{historyId}` + `platformAuditLogs/{auditLogId}`).
 *
 * Guarantees:
 * - Only verified Super Admin (`amoal2030@gmail.com`) can execute.
 * - Target member MUST be in `released` state (`membershipStatus === 'released'`, `orgId === ''`, `isActive === false`).
 * - Target organization MUST exist and be active (`isActive !== false`).
 * - Allowed roles strictly `supervisor | branch_manager | employee` (never `manager` / `super_admin`).
 * - Branch binding strictly verified to belong to `targetOrg.id` (never foreign org, never purged).
 * - Fresh role-scoped permissions built from scratch; ZERO legacy permissions copied.
 * - Purges previous-org archive and release metadata (`archivedAt`, `archivedBy`, `releasedFromOrgId`,
 *   `releasedFromOrgName`, `releasedAt`, `releasedBy`, `releaseReason`) from `users/{uid}` so the new
 *   organization's manager never sees previous-org identity or internal release notes, while preserving
 *   100% of immutable history exclusively in Super-Admin-only `memberOrgHistory` and preserving `createdAt`, `uid`, `email`.
 */
export function buildSuperAdminAssignReleasedMemberBundle(params: {
  actor: SuperAdminActorSnapshot;
  existingMember: UserProfile;
  targetOrg: Organization;
  targetOrgBranches: Branch[];
  role: string;
  branchId?: string;
  supervisorPermissions?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
  reason?: string;
  now?: Date;
  auditLogId?: string;
  historyId?: string;
  deleteFieldSentinel: unknown;
}): {
  userPatch: Record<string, unknown>;
  historyRecord: MemberOrgHistoryRecord;
  auditLog: PlatformAuditLog;
} {
  assertSuperAdminIdentity(params.actor);

  if (
    resolveMemberMembershipStatus(params.existingMember) !== 'released' ||
    (params.existingMember.orgId || '').trim() !== '' ||
    params.existingMember.isActive !== false
  ) {
    throw new Error(
      'لا يمكن إعادة ربط هذا العضو قبل فصل عضويته نهائياً (يجب أن تكون حالته «محرر نهائياً» بدون مؤسسة حالية).'
    );
  }

  const memberEmailLower = normalizeEmailLower(params.existingMember.email);
  if (!memberEmailLower || memberEmailLower === SUPER_ADMIN_EMAIL) {
    throw new Error('يُمنع إعادة ربط حساب المدير الرئيسي كعضو مؤسسة.');
  }

  if (!params.targetOrg || !params.targetOrg.id) {
    throw new Error('يجب اختيار مؤسسة هدف صالحة.');
  }
  if (params.targetOrg.isActive === false) {
    throw new Error('لا يمكن ربط العضو بمؤسسة موقوفة أو غير نشطة؛ يرجى اختيار مؤسسة نشطة.');
  }
  if (
    (params.targetOrg.ownerId && params.targetOrg.ownerId === params.existingMember.uid) ||
    (params.targetOrg.ownerEmail && normalizeEmailLower(params.targetOrg.ownerEmail) === memberEmailLower)
  ) {
    throw new Error('لا يمكن ربط مالك المؤسسة بدور موظف عبر واجهة إعادة الربط.');
  }

  if (!isAllowedSuperAdminMemberRole(params.role)) {
    throw new Error(
      'الأدوار المسموحة عند إعادة الربط هي فقط: supervisor، branch_manager، employee. يمنع تعيين manager أو super_admin.'
    );
  }

  let resolvedBranch: Branch | undefined;
  if (params.role === 'branch_manager' || params.role === 'employee') {
    const cleanBranchId = (params.branchId || '').trim();
    if (!cleanBranchId) {
      throw new Error(
        params.role === 'branch_manager'
          ? 'يجب اختيار فرع تابع للمؤسسة الجديدة لدور مسؤول الفرع.'
          : 'يجب اختيار فرع تابع للمؤسسة الجديدة لدور الموظف.'
      );
    }
    resolvedBranch = params.targetOrgBranches.find((b) => b.id === cleanBranchId);
    if (!resolvedBranch || resolvedBranch.orgId !== params.targetOrg.id) {
      throw new Error(
        'الفرع المحدد لا يتبع للمؤسسة الجديدة؛ يمنع ربط العضو بفرع تابع لمؤسسة أخرى.'
      );
    }
    if (resolvedBranch.lifecycleStatus === 'purged_from_db') {
      throw new Error('لا يمكن ربط العضو بفرع محذوف من قاعدة البيانات.');
    }
  }

  const now = params.now || new Date();
  const nowIso = now.toISOString();
  const actorEmail = normalizeEmailLower(params.actor.email);
  const historyId = (params.historyId || generateMemberOrgHistoryId('moh_asg')).trim();
  const cleanTargetOrgName = (params.targetOrg.name || params.targetOrg.id).trim().slice(0, 120);
  const cleanReason =
    (params.reason || '').trim().slice(0, 500) ||
    `إعادة ربط العضو المحرر بمؤسسة "${cleanTargetOrgName}" بدور ${params.role}`;

  if (cleanReason.length < 5) {
    throw new Error('سبب إعادة الربط يجب أن لا يقل عن 5 أحرف.');
  }

  const freshPermissions = buildDefaultPermissionsForRole(
    params.role,
    params.role === 'supervisor' ? params.supervisorPermissions : undefined
  );

  const prevOrgId = (params.existingMember.releasedFromOrgId || '').trim();
  const prevOrgName = (params.existingMember.releasedFromOrgName || '').trim().slice(0, 120);

  const auditLog = buildPlatformAuditLogEntry({
    id: params.auditLogId,
    actor: params.actor,
    action: 'MEMBER_ORG_MEMBERSHIP_ASSIGNED',
    targetType: 'member',
    targetId: params.existingMember.uid,
    orgId: params.targetOrg.id,
    details: `إعادة ربط العضو المحرر "${params.existingMember.displayName}" (${params.existingMember.email}) بمؤسسة "${cleanTargetOrgName}" بدور ${params.role}${
      resolvedBranch ? ` — الفرع: ${resolvedBranch.name}` : ' (نطاق المؤسسة)'
    } — السبب: ${cleanReason}`,
    metadata: {
      historyId,
      previousOrgId: prevOrgId || null,
      newOrgId: params.targetOrg.id,
      newOrgName: cleanTargetOrgName,
      newRole: params.role,
      newBranchId: resolvedBranch ? resolvedBranch.id : null,
      memberUid: params.existingMember.uid,
      reason: cleanReason,
    },
    timestamp: nowIso,
  });

  const historyRecord: MemberOrgHistoryRecord = {
    id: historyId,
    eventType: 'assigned',
    uid: params.existingMember.uid,
    email: params.existingMember.email,
    displayName: params.existingMember.displayName,
    orgId: params.targetOrg.id,
    orgName: cleanTargetOrgName,
    ...(prevOrgId ? { previousOrgId: prevOrgId } : {}),
    ...(prevOrgName ? { previousOrgName: prevOrgName } : {}),
    role: params.role,
    ...(resolvedBranch ? { branchId: resolvedBranch.id, branchName: resolvedBranch.name.slice(0, 120) } : {}),
    effectiveAt: nowIso,
    actorUid: params.actor.uid,
    actorEmail,
    reason: cleanReason,
    auditLogId: auditLog.id,
    createdAt: nowIso,
  };

  const userPatch: Record<string, unknown> = {
    orgId: params.targetOrg.id,
    role: params.role,
    permissions: freshPermissions,
    membershipStatus: 'active',
    isActive: true,
    isArchived: false,
    archivedAt: params.deleteFieldSentinel,
    archivedBy: params.deleteFieldSentinel,
    releasedFromOrgId: params.deleteFieldSentinel,
    releasedFromOrgName: params.deleteFieldSentinel,
    releasedAt: params.deleteFieldSentinel,
    releasedBy: params.deleteFieldSentinel,
    releaseReason: params.deleteFieldSentinel,
    reassignedAt: nowIso,
    reassignedBy: actorEmail,
    lastMemberOrgHistoryId: historyId,
    lastPlatformAuditLogId: auditLog.id,
    updatedAt: nowIso,
  };

  if (params.role === 'supervisor') {
    userPatch.branchId = params.deleteFieldSentinel;
    userPatch.branchIds = params.deleteFieldSentinel;
    userPatch.branchName = params.deleteFieldSentinel;
  } else if (params.role === 'branch_manager' && resolvedBranch) {
    userPatch.branchId = resolvedBranch.id;
    userPatch.branchIds = [resolvedBranch.id];
    userPatch.branchName = resolvedBranch.name.slice(0, 120);
  } else if (resolvedBranch) {
    userPatch.branchId = resolvedBranch.id;
    userPatch.branchIds = params.deleteFieldSentinel;
    userPatch.branchName = resolvedBranch.name.slice(0, 120);
  }

  return { userPatch, historyRecord, auditLog };
}

/**
 * Summarizes an organization's effective branch exemption breakdown for UI cards & modals.
 */
export function summarizeOrgBranchExemptions(org: Organization, orgBranches: Branch[]) {
  const activeBranches = orgBranches.filter((b) => !isBranchSuspendedOrPurged(b));
  const nonPurgedBranches = orgBranches.filter((b) => b.lifecycleStatus !== 'purged_from_db');
  const individuallyExemptBranches = nonPurgedBranches.filter((b) => {
    const evalB = evaluateBranchBillingAndGrace(b, org);
    return evalB.isBranchIndividuallyExempt;
  });
  return {
    totalBranches: orgBranches.length,
    activeBranches: activeBranches.length,
    nonPurgedBranches: nonPurgedBranches.length,
    individuallyExemptCount: individuallyExemptBranches.length,
  };
}

export function getPlatformAuditActionLabel(
  action: PlatformAuditAction | string,
  language: SupportedLanguage = 'ar'
): string {
  const map: Record<string, { ar: string; en: string; ur: string }> = {
    ORG_CREATED_WITH_INVITE: {
      ar: 'إنشاء مؤسسة ودعوة مدير',
      en: 'Org Created with Invite',
      ur: 'ادارہ اور مینیجر دعوت تخلیق',
    },
    ORG_PROFILE_UPDATED: {
      ar: 'تحديث بيانات/فوترة مؤسسة',
      en: 'Org Profile / Billing Updated',
      ur: 'ادارہ پروفائل / بلنگ اپ ڈیٹ',
    },
    SUBSCRIPTION_UPDATED: {
      ar: 'تحديث الاشتراك',
      en: 'Subscription Updated',
      ur: 'سبسکرپشن اپ ڈیٹ',
    },
    LEGACY_CONVERTED_TO_PAID: {
      ar: 'تحويل مؤسسة قديمة إلى مدفوعة',
      en: 'Legacy Converted to Paid',
      ur: 'سابقہ ادارہ ادا شدہ میں منتقل',
    },
    SETUP_FEE_UPDATED: {
      ar: 'تحديث رسوم التأسيس',
      en: 'Setup Fee Updated',
      ur: 'سیٹ اپ فیس اپ ڈیٹ',
    },
    ORG_SUSPENDED: {
      ar: 'إيقاف مؤسسة',
      en: 'Org Suspended',
      ur: 'ادارہ معطل',
    },
    ORG_DEACTIVATED_NO_PAID_BRANCHES: {
      ar: 'تعطيل/مهلة بلا فروع مدفوعة',
      en: 'No-Paid-Branches Grace / Deactivation',
      ur: 'بغیر ادا شدہ برانچز مہلت/تعطیل',
    },
    ORG_REACTIVATED: {
      ar: 'إعادة تنشيط مؤسسة',
      en: 'Org Reactivated',
      ur: 'ادارہ دوبارہ فعال',
    },
    ORG_BILLING_EXEMPTION_GRANTED: {
      ar: 'منح إعفاء مالي دائم لمؤسسة',
      en: 'Org Billing Exemption Granted',
      ur: 'ادارے کو مستقل فیس استثنیٰ',
    },
    ORG_BILLING_EXEMPTION_REVOKED: {
      ar: 'إلغاء إعفاء مالي دائم لمؤسسة',
      en: 'Org Billing Exemption Revoked',
      ur: 'ادارے کا فیس استثنیٰ منسوخ',
    },
    ORG_LEGACY_UNRESTRICTED_GRANTED: {
      ar: 'منح إعفاء legacy_unrestricted لمؤسسة',
      en: 'Org Legacy Unrestricted Granted',
      ur: 'ادارے کو legacy_unrestricted استثنیٰ',
    },
    ORG_LEGACY_UNRESTRICTED_REVOKED: {
      ar: 'إلغاء إعفاء legacy_unrestricted لمؤسسة',
      en: 'Org Legacy Unrestricted Revoked',
      ur: 'ادارے کا legacy_unrestricted منسوخ',
    },
    BRANCH_BILLING_EXEMPTION_GRANTED: {
      ar: 'منح إعفاء دائم لفرع',
      en: 'Branch Exemption Granted',
      ur: 'برانچ کو مستقل استثنیٰ',
    },
    BRANCH_BILLING_EXEMPTION_REVOKED: {
      ar: 'إلغاء إعفاء فرع',
      en: 'Branch Exemption Revoked',
      ur: 'برانچ کا استثنیٰ منسوخ',
    },
    ORG_BRANCHES_BULK_EXEMPTION_GRANTED: {
      ar: 'إعفاء جماعي لجميع فروع المؤسسة',
      en: 'All Org Branches Bulk Exempted',
      ur: 'ادارے کی تمام برانچز مستثنیٰ',
    },
    INVITE_UPSERTED: {
      ar: 'إصدار / تحديث دعوة مدير',
      en: 'Manager Invite Issued / Updated',
      ur: 'مینیجر دعوت جاری / اپ ڈیٹ',
    },
    INVITE_CANCELLED: {
      ar: 'إلغاء دعوة مدير',
      en: 'Manager Invite Cancelled',
      ur: 'مینیجر دعوت منسوخ',
    },
    BRANCH_CREATED: {
      ar: 'إضافة فرع',
      en: 'Branch Created',
      ur: 'برانچ شامل',
    },
    BRANCH_PAYMENT_UPDATED: {
      ar: 'تحديث سداد فرع',
      en: 'Branch Payment Updated',
      ur: 'برانچ ادائیگی اپ ڈیٹ',
    },
    BRANCH_SUSPENDED: {
      ar: 'تعليق فرع (مهلة 30 يوماً)',
      en: 'Branch Suspended (30d Grace)',
      ur: 'برانچ معطل (30 دن مہلت)',
    },
    BRANCH_REACTIVATED: {
      ar: 'إعادة تنشيط فرع',
      en: 'Branch Reactivated',
      ur: 'برانچ دوبارہ فعال',
    },
    BRANCH_DRIVE_BACKUP_VERIFIED: {
      ar: 'التحقق من أرشيف Drive للفرع',
      en: 'Branch Drive Backup Verified',
      ur: 'برانچ Drive بیک اپ تصدیق شدہ',
    },
    BRANCH_DB_PURGED: {
      ar: 'تنظيف سجلات فرع من DB فقط',
      en: 'Branch DB Records Purged',
      ur: 'برانچ DB ریکارڈز حذف',
    },
    MEMBER_CREATED: {
      ar: 'إضافة عضو لمؤسسة',
      en: 'Org Member Created',
      ur: 'ادارے میں رکن شامل',
    },
    MEMBER_UPDATED: {
      ar: 'تحديث بيانات عضو',
      en: 'Org Member Updated',
      ur: 'رکن کی تفصیلات اپ ڈیٹ',
    },
    MEMBER_ROLE_CHANGED: {
      ar: 'تغيير دور عضو',
      en: 'Member Role Changed',
      ur: 'رکن کا کردار تبدیل',
    },
    MEMBER_BRANCH_CHANGED: {
      ar: 'تغيير / نقل فرع عضو',
      en: 'Member Branch Changed',
      ur: 'رکن کی برانچ تبدیل',
    },
    MEMBER_ARCHIVED: {
      ar: 'أرشفة عضو',
      en: 'Member Archived',
      ur: 'رکن آرکائیو',
    },
    MEMBER_REACTIVATED: {
      ar: 'إعادة تفعيل عضو',
      en: 'Member Reactivated',
      ur: 'رکن دوبارہ فعال',
    },
    MEMBER_ORG_MEMBERSHIP_RELEASED: {
      ar: 'فصل عضوية موظف نهائياً عن المؤسسة',
      en: 'Member Permanently Released',
      ur: 'رکن کی ادارے سے مستقل علیحدگی',
    },
    MEMBER_ORG_MEMBERSHIP_ASSIGNED: {
      ar: 'إعادة ربط عضو محرر بمؤسسة',
      en: 'Released Member Assigned to Org',
      ur: 'آزاد رکن کو ادارے سے منسلک کیا گیا',
    },
  };

  const entry = map[action];
  if (!entry) return action;
  return entry[language] || entry.ar;
}
