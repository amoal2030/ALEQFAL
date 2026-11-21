/**
 * Deterministic Pre-Grant Eligibility Verification & Non-Destructive Exemption Patch Builders
 *
 * Ensures Super Admin exemption actions (both 'billing_exempt' and explicit 'legacy_unrestricted'
 * for organizations and independent branches):
 *  - Never guess orgId or ownerId
 *  - Cross-verify orgId, ownerId, normalized ownerEmail, users/{ownerId}, org active status, and current branches
 *  - Guarantee zero deletion or zeroing of historical subscription, setup fee, reactivation fee, or payment fields
 */
import {
  Branch,
  BranchPaymentStatus,
  EffectiveSubscriptionState,
  ExemptionClassification,
  ManagerInvite,
  Organization,
  SubscriptionTimestampValue,
  UserProfile,
} from '../types';
import {
  evaluateBranchBillingAndGrace,
  evaluateOrganizationBranchPricing,
  isBranchIndividuallyExempt,
  isBranchSuspendedOrPurged,
} from './branchPricing';
import { evaluateOrganizationSubscription, toValidDate } from './subscription';

export type ExemptionCheckKey =
  | 'org_id_valid'
  | 'owner_id_bound'
  | 'owner_email_valid'
  | 'owner_user_doc_match'
  | 'org_status_eligible'
  | 'branches_inventory_verified'
  | 'historical_subscription_preserved';

export interface ExemptionVerificationCheck {
  key: ExemptionCheckKey;
  labelAr: string;
  passed: boolean;
  blocking: boolean;
  detailAr: string;
}

export interface HistoricalSubscriptionSnapshot {
  hasHistoricalFields: boolean;
  presentFieldKeys: string[];
  subscriptionPlan: Organization['subscriptionPlan'] | null;
  subscriptionStatus: Organization['subscriptionStatus'] | null;
  subscriptionStartAtIso: string | null;
  subscriptionEndAtIso: string | null;
  accountSetupFeeSar: number | null;
  setupFeeStatus: Organization['setupFeeStatus'] | null;
  reactivationFeeSar: number | null;
  reactivationFeeStatus: Organization['reactivationFeeStatus'] | null;
  willDeleteOrZeroHistoricalData: false;
}

export interface OrganizationBranchesExemptionInventory {
  totalBranchesCount: number;
  activeBranchesCount: number;
  suspendedBranchesCount: number;
  individuallyExemptBranchesCount: number;
  billableBranchesCount: number;
  currentEstimatedMonthlyFeeSar: number;
  postExemptionMonthlyFeeSar: 0;
  branchIds: string[];
}

export interface OrganizationExemptionPrecheckResult {
  eligible: boolean;
  blockingFailures: ExemptionVerificationCheck[];
  checks: ExemptionVerificationCheck[];
  orgId: string | null;
  orgName: string | null;
  ownerId: string | null;
  ownerEmailNormalized: string | null;
  matchedOwnerUser: UserProfile | null;
  pendingInviteFound: boolean;
  currentSubscriptionState: EffectiveSubscriptionState | null;
  currentIsFeeExempt: boolean;
  targetMode: ExemptionClassification;
  branchesInventory: OrganizationBranchesExemptionInventory;
  historicalSnapshot: HistoricalSubscriptionSnapshot;
}

export interface OrganizationOwnerLookupResult {
  queryEmailNormalized: string;
  matchedOrganizations: OrganizationExemptionPrecheckResult[];
  matchedUsers: UserProfile[];
  matchedInvites: ManagerInvite[];
  ambiguousMultipleOrgs: boolean;
}

export interface BranchExemptionPrecheckResult {
  eligible: boolean;
  blockingReasonAr: string | null;
  branchId: string;
  orgId: string;
  parentOrgIsFeeExempt: boolean;
  parentOrgExemptionMode: ExemptionClassification | 'none';
  branchCurrentlyIndividuallyExempt: boolean;
  currentMonthlyFeeSar: number;
  postExemptionMonthlyFeeSar: 0;
  preservesHistoricalPaymentFields: true;
  historicalPaymentFieldsPresent: string[];
}

export const HISTORICAL_ORG_BILLING_FIELD_KEYS = [
  'subscriptionPlan',
  'subscriptionStatus',
  'subscriptionStartAt',
  'subscriptionEndAt',
  'subscriptionUpdatedAt',
  'subscriptionUpdatedBy',
  'subscriptionNote',
  'accountSetupFeeSar',
  'setupFeeStatus',
  'setupFeePaidAt',
  'reactivationFeeSar',
  'reactivationFeeStatus',
  'reactivationFeePaidAt',
] as const;

export const HISTORICAL_BRANCH_PAYMENT_FIELD_KEYS = [
  'subscriptionStartAt',
  'lastPaidAt',
  'lastPaidBy',
  'paymentNote',
] as const;

export function normalizeEmailLower(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function serializeTimestampForComparison(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const parsed = toValidDate(value);
  return parsed ? parsed.toISOString() : String(value);
}

/**
 * Extracts a read-only snapshot of all historical subscription & billing fields on an organization.
 */
export function buildHistoricalSubscriptionSnapshot(
  org: Organization | null | undefined
): HistoricalSubscriptionSnapshot {
  if (!org) {
    return {
      hasHistoricalFields: false,
      presentFieldKeys: [],
      subscriptionPlan: null,
      subscriptionStatus: null,
      subscriptionStartAtIso: null,
      subscriptionEndAtIso: null,
      accountSetupFeeSar: null,
      setupFeeStatus: null,
      reactivationFeeSar: null,
      reactivationFeeStatus: null,
      willDeleteOrZeroHistoricalData: false,
    };
  }

  const presentFieldKeys = HISTORICAL_ORG_BILLING_FIELD_KEYS.filter(
    (key) => org[key] !== undefined && org[key] !== null
  );

  return {
    hasHistoricalFields: presentFieldKeys.length > 0,
    presentFieldKeys: [...presentFieldKeys],
    subscriptionPlan: org.subscriptionPlan ?? null,
    subscriptionStatus: org.subscriptionStatus ?? null,
    subscriptionStartAtIso: serializeTimestampForComparison(org.subscriptionStartAt),
    subscriptionEndAtIso: serializeTimestampForComparison(org.subscriptionEndAt),
    accountSetupFeeSar:
      typeof org.accountSetupFeeSar === 'number' ? org.accountSetupFeeSar : null,
    setupFeeStatus: org.setupFeeStatus ?? null,
    reactivationFeeSar:
      typeof org.reactivationFeeSar === 'number' ? org.reactivationFeeSar : null,
    reactivationFeeStatus: org.reactivationFeeStatus ?? null,
    willDeleteOrZeroHistoricalData: false,
  };
}

/**
 * Verifies that every historical subscription & billing field on an organization
 * remained 100% identical before and after applying/revoking an exemption.
 */
export function verifyHistoricalSubscriptionFieldsPreserved(
  beforeOrg: Organization,
  afterOrg: Organization
): { preserved: boolean; mutatedFields: string[] } {
  const mutatedFields: string[] = [];

  for (const key of HISTORICAL_ORG_BILLING_FIELD_KEYS) {
    const beforeVal = beforeOrg[key];
    const afterVal = afterOrg[key];

    const isTimestampKey =
      key === 'subscriptionStartAt' ||
      key === 'subscriptionEndAt' ||
      key === 'subscriptionUpdatedAt' ||
      key === 'setupFeePaidAt' ||
      key === 'reactivationFeePaidAt';

    if (isTimestampKey) {
      if (
        serializeTimestampForComparison(beforeVal) !==
        serializeTimestampForComparison(afterVal)
      ) {
        mutatedFields.push(key);
      }
    } else if (beforeVal !== afterVal) {
      mutatedFields.push(key);
    }
  }

  return {
    preserved: mutatedFields.length === 0,
    mutatedFields,
  };
}

/**
 * Deterministic 7-point pre-grant eligibility verification for granting permanent exemption
 * (`billing_exempt` or explicit `legacy_unrestricted`) to an organization.
 *
 * Fail-closed: blocks if orgId, ownerId, ownerEmail, users/{ownerId} binding,
 * org active state, or branch ownership integrity fail.
 */
export function verifyOrganizationExemptionEligibility(params: {
  org: Organization | null | undefined;
  users: UserProfile[];
  branches: Branch[];
  managerInvites?: ManagerInvite[];
  expectedOwnerEmail?: string;
  targetMode?: ExemptionClassification;
  now?: Date;
}): OrganizationExemptionPrecheckResult {
  const {
    org,
    users,
    branches,
    managerInvites = [],
    expectedOwnerEmail,
    targetMode = 'billing_exempt',
    now = new Date(),
  } = params;

  const historicalSnapshot = buildHistoricalSubscriptionSnapshot(org);
  const emptyInventory: OrganizationBranchesExemptionInventory = {
    totalBranchesCount: 0,
    activeBranchesCount: 0,
    suspendedBranchesCount: 0,
    individuallyExemptBranchesCount: 0,
    billableBranchesCount: 0,
    currentEstimatedMonthlyFeeSar: 0,
    postExemptionMonthlyFeeSar: 0,
    branchIds: [],
  };

  if (!org || typeof org.id !== 'string' || org.id.trim().length === 0) {
    const check: ExemptionVerificationCheck = {
      key: 'org_id_valid',
      labelAr: 'معرّف المؤسسة (orgId)',
      passed: false,
      blocking: true,
      detailAr: 'لم يتم العثور على وثيقة مؤسسة صالحة أو معرّفها فارغ.',
    };
    return {
      eligible: false,
      blockingFailures: [check],
      checks: [check],
      orgId: null,
      orgName: null,
      ownerId: null,
      ownerEmailNormalized: null,
      matchedOwnerUser: null,
      pendingInviteFound: false,
      currentSubscriptionState: null,
      currentIsFeeExempt: false,
      targetMode,
      branchesInventory: emptyInventory,
      historicalSnapshot,
    };
  }

  const orgId = org.id.trim();
  const ownerId = typeof org.ownerId === 'string' ? org.ownerId.trim() : '';
  const ownerEmailNormalized = normalizeEmailLower(org.ownerEmail);
  const expectedEmailNormalized = normalizeEmailLower(expectedOwnerEmail);
  const emailLooksValid =
    ownerEmailNormalized.length >= 5 &&
    ownerEmailNormalized.includes('@') &&
    ownerEmailNormalized.includes('.');

  const pendingInviteFound = managerInvites.some(
    (inv) =>
      inv.orgId === orgId &&
      inv.status === 'pending' &&
      normalizeEmailLower(inv.emailNormalized || inv.email) === ownerEmailNormalized
  );

  // 1. orgId check
  const orgIdCheck: ExemptionVerificationCheck = {
    key: 'org_id_valid',
    labelAr: 'معرّف المؤسسة (orgId)',
    passed: true,
    blocking: true,
    detailAr: `تم التحقق من المؤسسة (${orgId}) — ${org.name}.`,
  };

  // 2. ownerId bound check
  const ownerIdBound = ownerId.length > 0;
  const ownerIdCheck: ExemptionVerificationCheck = {
    key: 'owner_id_bound',
    labelAr: 'ربط معرّف المالك (ownerId)',
    passed: ownerIdBound,
    blocking: true,
    detailAr: ownerIdBound
      ? `معرّف المالك مرتبط: ${ownerId}.`
      : pendingInviteFound
      ? 'معرّف المالك غير مرتبط بعد؛ توجد دعوة مدير معلّقة (pending) ويجب أن يسجّل المالك دخوله عبر Google أولاً.'
      : 'حقل ownerId فارغ على وثيقة المؤسسة؛ لا يمكن منح الإعفاء قبل توثيق هوية المالك.',
  };

  // 3. ownerEmail valid & optional expected email match
  const expectedEmailMatches =
    !expectedEmailNormalized || ownerEmailNormalized === expectedEmailNormalized;
  const ownerEmailPassed = emailLooksValid && expectedEmailMatches;
  const ownerEmailCheck: ExemptionVerificationCheck = {
    key: 'owner_email_valid',
    labelAr: 'البريد الإلكتروني للمالك (ownerEmail)',
    passed: ownerEmailPassed,
    blocking: true,
    detailAr: !emailLooksValid
      ? 'بريد المالك على وثيقة المؤسسة غير صالح أو فارغ.'
      : !expectedEmailMatches
      ? `بريد المالك المسجّل (${ownerEmailNormalized}) لا يطابق البريد المستهدف (${expectedEmailNormalized}).`
      : `البريد الإلكتروني الموحّد صالح ومطابق: ${ownerEmailNormalized}.`,
  };

  // 4. users/{ownerId} cross-document verification
  const matchedOwnerUser = ownerIdBound
    ? users.find((u) => u.uid === ownerId) || null
    : null;

  const ownerDocFailures: string[] = [];
  if (!ownerIdBound) {
    ownerDocFailures.push('لا يوجد ownerId للبحث عن وثيقة المستخدم');
  } else if (!matchedOwnerUser) {
    ownerDocFailures.push(`لم يتم العثور على وثيقة المستخدم users/${ownerId}`);
  } else {
    if (matchedOwnerUser.orgId !== orgId) {
      ownerDocFailures.push(
        `المستخدم مرتبط بمؤسسة أخرى (${matchedOwnerUser.orgId} ≠ ${orgId})`
      );
    }
    if (matchedOwnerUser.role !== 'manager') {
      ownerDocFailures.push(`دور المستخدم هو "${matchedOwnerUser.role}" وليس "manager"`);
    }
    if (normalizeEmailLower(matchedOwnerUser.email) !== ownerEmailNormalized) {
      ownerDocFailures.push(
        `بريد وثيقة المستخدم (${normalizeEmailLower(matchedOwnerUser.email)}) لا يطابق بريد مالك المؤسسة (${ownerEmailNormalized})`
      );
    }
    if (matchedOwnerUser.isActive !== true || matchedOwnerUser.isArchived === true) {
      ownerDocFailures.push('حساب المالك في users غير نشط أو مؤرشف');
    }
  }

  const ownerDocCheck: ExemptionVerificationCheck = {
    key: 'owner_user_doc_match',
    labelAr: 'مطابقة وثيقة المستخدم (users/{ownerId})',
    passed: ownerDocFailures.length === 0,
    blocking: true,
    detailAr:
      ownerDocFailures.length === 0
        ? `وثيقة users/${ownerId} نشطة ومطابقة للمؤسسة بدور manager وبريد ${ownerEmailNormalized}.`
        : ownerDocFailures.join(' — '),
  };

  // 5. Organization status check (isActive === false blocks because manual suspension always overrides exemption)
  const subEval = evaluateOrganizationSubscription(org, now);
  const orgActiveEligible = org.isActive !== false;
  const orgStatusCheck: ExemptionVerificationCheck = {
    key: 'org_status_eligible',
    labelAr: 'حالة المؤسسة التشغيلية',
    passed: orgActiveEligible,
    blocking: true,
    detailAr: orgActiveEligible
      ? `المؤسسة غير موقوفة يدوياً (الحالة الفعالة الحالية: ${subEval.state}).`
      : `المؤسسة موقوفة حالياً (isActive: false${
          org.deactivationReason ? ` — السبب: ${org.deactivationReason}` : ''
        }). الإيقاف اليدوي يغلب الإعفاء، لذا يجب مراجعة تنشيط المؤسسة أولاً.`,
  };

  // 6. Current branches inventory
  const orgBranches = branches.filter((b) => b.orgId === orgId);
  const pricingEval = evaluateOrganizationBranchPricing({
    org,
    branches: orgBranches,
    now,
  });
  const activeBranches = orgBranches.filter((b) => !isBranchSuspendedOrPurged(b));
  const suspendedBranches = orgBranches.filter((b) => isBranchSuspendedOrPurged(b));
  const individuallyExemptCount = activeBranches.filter((b) =>
    isBranchIndividuallyExempt(b)
  ).length;

  const branchesInventory: OrganizationBranchesExemptionInventory = {
    totalBranchesCount: orgBranches.length,
    activeBranchesCount: activeBranches.length,
    suspendedBranchesCount: suspendedBranches.length,
    individuallyExemptBranchesCount: individuallyExemptCount,
    billableBranchesCount: pricingEval.billableBranchesCount,
    currentEstimatedMonthlyFeeSar: pricingEval.estimatedMonthlyBranchTotalSar,
    postExemptionMonthlyFeeSar: 0,
    branchIds: orgBranches.map((b) => b.id),
  };

  const branchesCheck: ExemptionVerificationCheck = {
    key: 'branches_inventory_verified',
    labelAr: 'جرد الفروع الحالية للمؤسسة',
    passed: true,
    blocking: false,
    detailAr:
      orgBranches.length > 0
        ? `إجمالي الفروع: ${orgBranches.length} (فعالة: ${activeBranches.length}، معلّقة: ${suspendedBranches.length}، معفاة فردياً: ${individuallyExemptCount}). الرسوم الشهرية الحالية: ${pricingEval.estimatedMonthlyBranchTotalSar} ر.س ← بعد الإعفاء: 0 ر.س.`
        : 'لا توجد فروع مسجلة حالياً؛ أي فرع مستقبلي سيُنشأ تلقائياً كفرع معفى (0 ر.س).',
  };

  // 7. Historical subscription & billing data preservation check
  const historyCheck: ExemptionVerificationCheck = {
    key: 'historical_subscription_preserved',
    labelAr: 'حفظ بيانات الاشتراك والفواتير التاريخية',
    passed: true,
    blocking: false,
    detailAr: historicalSnapshot.hasHistoricalFields
      ? `تم رصد ${historicalSnapshot.presentFieldKeys.length} حقل اشتراك/رسوم تاريخي (${historicalSnapshot.presentFieldKeys.join(', ')}) — سيتم الاحتفاظ بها كاملة دون حذف أو تصفير.`
      : 'لا توجد حقول اشتراك سابقة على المؤسسة؛ سيتم حفظ أي سجلات تاريخية قائمة دون تعديل.',
  };

  const checks: ExemptionVerificationCheck[] = [
    orgIdCheck,
    ownerIdCheck,
    ownerEmailCheck,
    ownerDocCheck,
    orgStatusCheck,
    branchesCheck,
    historyCheck,
  ];
  const blockingFailures = checks.filter((c) => c.blocking && !c.passed);

  return {
    eligible: blockingFailures.length === 0,
    blockingFailures,
    checks,
    orgId,
    orgName: org.name,
    ownerId: ownerIdBound ? ownerId : null,
    ownerEmailNormalized: emailLooksValid ? ownerEmailNormalized : null,
    matchedOwnerUser,
    pendingInviteFound,
    currentSubscriptionState: subEval.state,
    currentIsFeeExempt: subEval.isFeeExempt,
    targetMode,
    branchesInventory,
    historicalSnapshot,
  };
}

/**
 * Deterministically locates organizations owned by a normalized lowercase email
 * across organizations, users, branches, and managerInvites without guessing IDs.
 */
export function locateOrganizationsByOwnerEmail(params: {
  ownerEmail: string;
  organizations: Organization[];
  users: UserProfile[];
  branches: Branch[];
  managerInvites?: ManagerInvite[];
  targetMode?: ExemptionClassification;
  now?: Date;
}): OrganizationOwnerLookupResult {
  const queryEmailNormalized = normalizeEmailLower(params.ownerEmail);
  const managerInvites = params.managerInvites || [];

  if (!queryEmailNormalized) {
    return {
      queryEmailNormalized: '',
      matchedOrganizations: [],
      matchedUsers: [],
      matchedInvites: [],
      ambiguousMultipleOrgs: false,
    };
  }

  const candidateOrgs = params.organizations.filter(
    (org) => normalizeEmailLower(org.ownerEmail) === queryEmailNormalized
  );
  const matchedUsers = params.users.filter(
    (u) => normalizeEmailLower(u.email) === queryEmailNormalized
  );
  const matchedInvites = managerInvites.filter(
    (inv) =>
      normalizeEmailLower(inv.emailNormalized || inv.email) === queryEmailNormalized
  );

  const matchedOrganizations = candidateOrgs.map((org) =>
    verifyOrganizationExemptionEligibility({
      org,
      users: params.users,
      branches: params.branches,
      managerInvites,
      expectedOwnerEmail: queryEmailNormalized,
      targetMode: params.targetMode,
      now: params.now,
    })
  );

  return {
    queryEmailNormalized,
    matchedOrganizations,
    matchedUsers,
    matchedInvites,
    ambiguousMultipleOrgs: candidateOrgs.length > 1,
  };
}

/**
 * Verifies eligibility for granting or revoking an independent branch-level exemption
 * while distinguishing parent org exemption from independent branch exemption.
 */
export function verifyBranchExemptionEligibility(params: {
  branch: Branch | null | undefined;
  org: Organization | null | undefined;
  now?: Date;
}): BranchExemptionPrecheckResult {
  const { branch, org, now = new Date() } = params;

  if (!branch || !org) {
    return {
      eligible: false,
      blockingReasonAr: 'بيانات الفرع أو المؤسسة غير متوفرة.',
      branchId: branch?.id || '',
      orgId: org?.id || branch?.orgId || '',
      parentOrgIsFeeExempt: false,
      parentOrgExemptionMode: 'none',
      branchCurrentlyIndividuallyExempt: false,
      currentMonthlyFeeSar: 0,
      postExemptionMonthlyFeeSar: 0,
      preservesHistoricalPaymentFields: true,
      historicalPaymentFieldsPresent: [],
    };
  }

  const branchEval = evaluateBranchBillingAndGrace(branch, org, now);
  const subEval = evaluateOrganizationSubscription(org, now);
  const historicalPaymentFieldsPresent = HISTORICAL_BRANCH_PAYMENT_FIELD_KEYS.filter(
    (key) => branch[key] !== undefined && branch[key] !== null
  );

  if (branch.orgId !== org.id) {
    return {
      eligible: false,
      blockingReasonAr: `الفرع (${branch.id}) لا ينتمي إلى المؤسسة المحددة (${org.id}).`,
      branchId: branch.id,
      orgId: org.id,
      parentOrgIsFeeExempt: subEval.isFeeExempt,
      parentOrgExemptionMode: subEval.exemptionMode,
      branchCurrentlyIndividuallyExempt: branchEval.isBranchIndividuallyExempt,
      currentMonthlyFeeSar: branchEval.monthlyFeeSar,
      postExemptionMonthlyFeeSar: 0,
      preservesHistoricalPaymentFields: true,
      historicalPaymentFieldsPresent: [...historicalPaymentFieldsPresent],
    };
  }

  if (branch.lifecycleStatus === 'purged_from_db') {
    return {
      eligible: false,
      blockingReasonAr: 'لا يمكن تعديل إعفاء فرع محذوف نهائياً من قاعدة البيانات.',
      branchId: branch.id,
      orgId: org.id,
      parentOrgIsFeeExempt: subEval.isFeeExempt,
      parentOrgExemptionMode: subEval.exemptionMode,
      branchCurrentlyIndividuallyExempt: branchEval.isBranchIndividuallyExempt,
      currentMonthlyFeeSar: branchEval.monthlyFeeSar,
      postExemptionMonthlyFeeSar: 0,
      preservesHistoricalPaymentFields: true,
      historicalPaymentFieldsPresent: [...historicalPaymentFieldsPresent],
    };
  }

  return {
    eligible: true,
    blockingReasonAr: null,
    branchId: branch.id,
    orgId: org.id,
    parentOrgIsFeeExempt: subEval.isFeeExempt,
    parentOrgExemptionMode: subEval.exemptionMode,
    branchCurrentlyIndividuallyExempt: branchEval.isBranchIndividuallyExempt,
    currentMonthlyFeeSar: branchEval.monthlyFeeSar,
    postExemptionMonthlyFeeSar: 0,
    preservesHistoricalPaymentFields: true,
    historicalPaymentFieldsPresent: [...historicalPaymentFieldsPresent],
  };
}

/**
 * Builds a strictly non-destructive patch for granting an organization permanent exemption
 * (`billing_exempt` or explicit `legacy_unrestricted`).
 * NEVER touches historical subscription/setup/reactivation fields.
 */
export function buildNonDestructiveOrgExemptionPatch(params: {
  org: Organization;
  mode: ExemptionClassification;
  reason: string;
  grantedBy: string;
  grantedAt: SubscriptionTimestampValue;
  auditLogId: string;
}): Partial<Organization> {
  return {
    billingExempt: true,
    billingExemptScope: 'full_permanent',
    billingExemptMode: params.mode,
    billingExemptReason: params.reason.trim(),
    billingExemptGrantedAt: params.grantedAt,
    billingExemptGrantedBy: normalizeEmailLower(params.grantedBy),
    billingExemptVerifiedOwnerId: params.org.ownerId.trim(),
    billingExemptVerifiedOwnerEmail: normalizeEmailLower(params.org.ownerEmail),
    billingExemptRevokedAt: null,
    billingExemptRevokedBy: null,
    billingExemptRevokeReason: null,
    billingExemptLastAuditLogId: params.auditLogId,
  };
}

/**
 * Builds a strictly non-destructive patch for revoking an organization permanent exemption.
 * Preserves ALL historical subscription fields AND original grant metadata.
 */
export function buildNonDestructiveOrgExemptionRevokePatch(params: {
  revokeReason: string;
  revokedBy: string;
  revokedAt: SubscriptionTimestampValue;
  auditLogId: string;
}): Partial<Organization> {
  return {
    billingExempt: false,
    billingExemptRevokedAt: params.revokedAt,
    billingExemptRevokedBy: normalizeEmailLower(params.revokedBy),
    billingExemptRevokeReason: params.revokeReason.trim(),
    billingExemptLastAuditLogId: params.auditLogId,
  };
}

/**
 * Builds a strictly non-destructive patch for granting an independent branch-level exemption
 * (`billing_exempt` or `legacy_unrestricted`).
 * Preserves historical lastPaidAt, lastPaidBy, paymentNote, and subscriptionStartAt untouched.
 */
export function buildNonDestructiveBranchExemptionPatch(params: {
  mode: ExemptionClassification;
  reason: string;
  grantedBy: string;
  grantedAt: SubscriptionTimestampValue;
  auditLogId: string;
}): Partial<Branch> {
  return {
    paymentStatus: 'exempt',
    monthlyFeeSar: 0,
    billingExempt: true,
    billingExemptMode: params.mode,
    billingExemptScope: 'branch_permanent',
    exemptReason: params.reason.trim(),
    exemptGrantedAt: params.grantedAt,
    exemptGrantedBy: normalizeEmailLower(params.grantedBy),
    exemptRevokedAt: null,
    exemptRevokedBy: null,
    exemptRevokeReason: null,
    exemptLastAuditLogId: params.auditLogId,
  };
}

/**
 * Builds a strictly non-destructive patch for revoking an independent branch-level exemption.
 * Preserves historical lastPaidAt, lastPaidBy, paymentNote, and original grant metadata.
 */
export function buildNonDestructiveBranchExemptionRevokePatch(params: {
  restoredPaymentStatus: Exclude<BranchPaymentStatus, 'exempt'>;
  restoredMonthlyFeeSar: number;
  revokeReason: string;
  revokedBy: string;
  revokedAt: SubscriptionTimestampValue;
  auditLogId: string;
}): Partial<Branch> {
  return {
    paymentStatus: params.restoredPaymentStatus,
    monthlyFeeSar: params.restoredMonthlyFeeSar,
    billingExempt: false,
    exemptRevokedAt: params.revokedAt,
    exemptRevokedBy: normalizeEmailLower(params.revokedBy),
    exemptRevokeReason: params.revokeReason.trim(),
    exemptLastAuditLogId: params.auditLogId,
  };
}
