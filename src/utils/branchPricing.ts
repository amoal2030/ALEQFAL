import {
  Branch,
  BranchPaymentStatus,
  BranchPricingModel,
  ClosingArchiveRecord,
  ExemptionClassification,
  ExemptionSource,
  FeePaymentStatus,
  Organization,
  ShiftClosing,
  SupportedLanguage,
} from '../types';
import {
  buildReactivationSubscriptionWhatsApp,
  buildSubscriptionWhatsAppUrl,
  evaluateOrganizationSubscription,
  PreparedWhatsAppLink,
  SUBSCRIPTION_WHATSAPP_INTL,
  SUBSCRIPTION_WHATSAPP_LOCAL,
  toValidDate,
} from './subscription';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const ACCOUNT_SETUP_FEE_SAR = 80;
export const BRANCH_MONTHLY_FEE_SAR = 50;
export const EXTRA_BRANCH_MONTHLY_FEE_SAR = BRANCH_MONTHLY_FEE_SAR;
export const ORG_REACTIVATION_FEE_SAR = 10;
export const NEW_ORG_INCLUDED_BRANCHES_COUNT = 0;
export const DEFAULT_INCLUDED_BRANCHES_COUNT = NEW_ORG_INCLUDED_BRANCHES_COUNT;
export const BRANCH_SUSPENSION_GRACE_DAYS = 30;
export const NO_PAID_BRANCH_GRACE_DAYS = 7;
export const BRANCH_PRICING_MODEL: BranchPricingModel = 'per_branch_50_sar';

export interface ExtraBranchPricingEvaluation {
  model: BranchPricingModel;
  setupFeeSar: number;
  setupFeeStatus: FeePaymentStatus;
  reactivationFeeSar: number;
  feePerExtraBranchMonthlySar: number;
  branchMonthlyFeeSar: number;
  includedBranchesCount: number;
  totalBranchesCount: number;
  activeBranchesCount: number;
  paidBranchesCount: number;
  exemptBranchesCount: number;
  billableBranchesCount: number;
  suspendedBranchesCount: number;
  extraBranchesCount: number;
  estimatedMonthlyExtraFeeSar: number;
  estimatedMonthlyBranchTotalSar: number;
  isLegacyExempt: boolean;
  isBillingExempt: boolean;
  isFeeExempt: boolean;
  exemptionMode: ExemptionClassification | 'none';
  autoBillingEnabled: false;
  pricingSummary: string;
}

export interface BranchBillingAndGraceEvaluation {
  branchId: string;
  isSuspended: boolean;
  isPurgedFromDb: boolean;
  isPaidAndActive: boolean;
  /** Unified exemption indicator: true if parent org is fee-exempt OR this branch is independently exempt. */
  isFeeExempt: boolean;
  /** True only when the parent organization itself is fee-exempt (billing_exempt or legacy_unrestricted). */
  isOrgFeeExempt: boolean;
  /** True only when this branch has an independent branch-level exemption. */
  isBranchIndividuallyExempt: boolean;
  exemptionSource: ExemptionSource;
  exemptionMode: ExemptionClassification | 'none';
  isLegacyUnrestricted: boolean;
  monthlyFeeSar: number;
  paymentStatus: BranchPaymentStatus;
  feeDueAt: Date | null;
  lastPaidAt: Date | null;
  suspendedAt: Date | null;
  gracePeriodEndsAt: Date | null;
  graceRemainingDays: number | null;
  isGraceExpired: boolean;
  driveBackupVerified: boolean;
  driveBackupVerifiedAt: Date | null;
  canPurgeFromDb: boolean;
}

export interface OrgNoPaidBranchGraceEvaluation {
  isLegacyExempt: boolean;
  isBillingExempt: boolean;
  isFeeExempt: boolean;
  activeBranchesCount: number;
  paidBranchesCount: number;
  inGrace: boolean;
  isDeactivated: boolean;
  graceStartedAt: Date | null;
  deactivationDueAt: Date | null;
  remainingGraceDays: number | null;
}

export interface BranchDriveBackupVerificationResult {
  verified: boolean;
  branchId: string;
  totalClosingsCount: number;
  approvedClosingsCount: number;
  verifiedArchivedCount: number;
  unapprovedPendingCount: number;
  missingOrUnverifiedClosingIds: string[];
  failedOrStaleClosingIds: string[];
  reason: string;
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

export function isBranchSuspendedOrPurged(
  branch: Pick<Branch, 'isActive' | 'lifecycleStatus'> | null | undefined
): boolean {
  if (!branch) return true;
  return (
    branch.isActive === false ||
    branch.lifecycleStatus === 'suspended' ||
    branch.lifecycleStatus === 'purged_from_db'
  );
}

/**
 * Determines whether a branch holds an independent branch-level exemption
 * (strictly distinct from parent organization-level exemption).
 * - Explicit `billingExempt === true` -> exempt
 * - Explicit `billingExempt === false` -> NOT exempt (fail-closed on explicit revocation)
 * - Undefined `billingExempt` -> backward-compatible check on `paymentStatus === 'exempt'`
 */
export function isBranchIndividuallyExempt(
  branch:
    | Partial<Pick<Branch, 'paymentStatus' | 'billingExempt' | 'billingExemptMode'>>
    | null
    | undefined
): boolean {
  if (!branch) return false;
  if (branch.billingExempt === true) return true;
  if (branch.billingExempt === false) return false;
  return branch.paymentStatus === 'exempt';
}

export function getBranchIndividualExemptionMode(
  branch:
    | Partial<Pick<Branch, 'paymentStatus' | 'billingExempt' | 'billingExemptMode'>>
    | null
    | undefined
): ExemptionClassification | 'none' {
  if (!isBranchIndividuallyExempt(branch)) return 'none';
  return branch?.billingExemptMode === 'legacy_unrestricted'
    ? 'legacy_unrestricted'
    : 'billing_exempt';
}

/**
 * Determines whether a branch counts as a currently paid, active branch.
 * - Suspended branches (even inside their 30-day grace window) NEVER count as paid.
 * - Fee-exempt orgs' active branches count as active/exempt.
 * - Individually exempt active branches count as covered/exempt.
 * - Non-exempt orgs require paymentStatus === 'paid' (with future or unset feeDueAt) or exempt;
 *   explicit 'unpaid' / 'overdue' / expired feeDueAt returns false.
 */
export function isBranchCountedAsPaid(
  branch:
    | (Pick<Branch, 'isActive' | 'lifecycleStatus' | 'paymentStatus' | 'feeDueAt'> &
        Partial<Pick<Branch, 'billingExempt' | 'billingExemptMode'>>)
    | null
    | undefined,
  org:
    | (Pick<
        Organization,
        | 'isActive'
        | 'subscriptionPlan'
        | 'subscriptionStatus'
        | 'subscriptionStartAt'
        | 'subscriptionEndAt'
        | 'deactivationReason'
        | 'noPaidBranchGraceStartedAt'
        | 'deactivationDueAt'
        | 'branchPricingModel'
      > &
        Partial<
          Pick<
            Organization,
            | 'ownerId'
            | 'ownerEmail'
            | 'billingExempt'
            | 'billingExemptScope'
            | 'billingExemptMode'
            | 'billingExemptVerifiedOwnerId'
            | 'billingExemptVerifiedOwnerEmail'
          >
        >)
    | null
    | undefined,
  nowInput: Date = new Date()
): boolean {
  if (!branch || isBranchSuspendedOrPurged(branch)) {
    return false;
  }

  const now = toValidDate(nowInput) || new Date();
  const subEval = evaluateOrganizationSubscription(org, now);

  if (org && subEval.isFeeExempt) {
    return true;
  }

  if (isBranchIndividuallyExempt(branch)) {
    return true;
  }

  if (
    branch.paymentStatus === 'unpaid' ||
    branch.paymentStatus === 'overdue' ||
    (branch.billingExempt === false && branch.paymentStatus === 'exempt')
  ) {
    return false;
  }

  const feeDueAt = toValidDate(branch.feeDueAt);
  if (feeDueAt && feeDueAt.getTime() <= now.getTime()) {
    return false;
  }

  if (branch.paymentStatus === 'paid') {
    return true;
  }

  // Backward compatibility for pre-4.2 active branches on managed orgs before branch payment status was seeded
  if (org?.branchPricingModel === 'per_branch_50_sar') {
    return false;
  }

  return branch.isActive !== false;
}

export function evaluateBranchBillingAndGrace(
  branch: Pick<
    Branch,
    | 'id'
    | 'isActive'
    | 'lifecycleStatus'
    | 'feeDueAt'
    | 'monthlyFeeSar'
    | 'paymentStatus'
    | 'lastPaidAt'
    | 'suspendedAt'
    | 'gracePeriodEndsAt'
    | 'driveBackupVerified'
    | 'driveBackupVerifiedAt'
  > &
    Partial<Pick<Branch, 'billingExempt' | 'billingExemptMode'>>,
  org:
    | (Pick<
        Organization,
        | 'isActive'
        | 'subscriptionPlan'
        | 'subscriptionStatus'
        | 'subscriptionStartAt'
        | 'subscriptionEndAt'
        | 'deactivationReason'
        | 'noPaidBranchGraceStartedAt'
        | 'deactivationDueAt'
        | 'branchPricingModel'
      > &
        Partial<
          Pick<
            Organization,
            | 'ownerId'
            | 'ownerEmail'
            | 'billingExempt'
            | 'billingExemptScope'
            | 'billingExemptMode'
            | 'billingExemptVerifiedOwnerId'
            | 'billingExemptVerifiedOwnerEmail'
          >
        >)
    | null
    | undefined,
  nowInput: Date = new Date()
): BranchBillingAndGraceEvaluation {
  const now = toValidDate(nowInput) || new Date();
  const subEval = evaluateOrganizationSubscription(org, now);
  const isOrgFeeExempt = Boolean(org && subEval.isFeeExempt);
  const isBranchExempt = isBranchIndividuallyExempt(branch);
  const isFeeExempt = isOrgFeeExempt || isBranchExempt;
  const exemptionSource: ExemptionSource =
    isOrgFeeExempt && isBranchExempt
      ? 'both'
      : isOrgFeeExempt
      ? 'organization'
      : isBranchExempt
      ? 'branch'
      : 'none';
  const exemptionMode: ExemptionClassification | 'none' = isOrgFeeExempt
    ? subEval.exemptionMode
    : isBranchExempt
    ? getBranchIndividualExemptionMode(branch)
    : 'none';
  const isLegacyUnrestricted = exemptionMode === 'legacy_unrestricted';

  const isPurgedFromDb = branch.lifecycleStatus === 'purged_from_db';
  const isSuspended = branch.isActive === false || branch.lifecycleStatus === 'suspended';

  const feeDueAt = toValidDate(branch.feeDueAt);
  const lastPaidAt = toValidDate(branch.lastPaidAt);
  const suspendedAt = toValidDate(branch.suspendedAt);
  const explicitGraceEnd = toValidDate(branch.gracePeriodEndsAt);
  const gracePeriodEndsAt =
    explicitGraceEnd ||
    (suspendedAt
      ? new Date(suspendedAt.getTime() + BRANCH_SUSPENSION_GRACE_DAYS * MS_PER_DAY)
      : null);

  let graceRemainingDays: number | null = null;
  let isGraceExpired = false;

  if (isSuspended && gracePeriodEndsAt) {
    const remainingMs = gracePeriodEndsAt.getTime() - now.getTime();
    if (remainingMs <= 0) {
      isGraceExpired = true;
      graceRemainingDays = 0;
    } else {
      isGraceExpired = false;
      graceRemainingDays = Math.ceil(remainingMs / MS_PER_DAY);
    }
  }

  let effectivePaymentStatus: BranchPaymentStatus;
  if (isFeeExempt) {
    effectivePaymentStatus = 'exempt';
  } else if (branch.billingExempt === false && branch.paymentStatus === 'exempt') {
    // Explicit branch exemption revocation fails closed even if legacy paymentStatus wasn't updated yet
    effectivePaymentStatus =
      feeDueAt && feeDueAt.getTime() <= now.getTime() ? 'overdue' : 'unpaid';
  } else if (branch.paymentStatus) {
    if (
      branch.paymentStatus === 'paid' &&
      feeDueAt &&
      feeDueAt.getTime() <= now.getTime()
    ) {
      effectivePaymentStatus = 'overdue';
    } else {
      effectivePaymentStatus = branch.paymentStatus;
    }
  } else {
    effectivePaymentStatus = isSuspended ? 'unpaid' : 'paid';
  }

  const isPaidAndActive = isBranchCountedAsPaid(branch, org, now);
  // Exempt branches ALWAYS have 0 SAR monthly fee (whether org-exempt or individually exempt)
  const monthlyFeeSar = isFeeExempt
    ? 0
    : normalizeNonNegativeInt(branch.monthlyFeeSar, BRANCH_MONTHLY_FEE_SAR);
  const driveBackupVerified = branch.driveBackupVerified === true;
  const driveBackupVerifiedAt = toValidDate(branch.driveBackupVerifiedAt);

  return {
    branchId: branch.id,
    isSuspended,
    isPurgedFromDb,
    isPaidAndActive,
    isFeeExempt,
    isOrgFeeExempt,
    isBranchIndividuallyExempt: isBranchExempt,
    exemptionSource,
    exemptionMode,
    isLegacyUnrestricted,
    monthlyFeeSar,
    paymentStatus: effectivePaymentStatus,
    feeDueAt,
    lastPaidAt,
    suspendedAt,
    gracePeriodEndsAt,
    graceRemainingDays,
    isGraceExpired,
    driveBackupVerified,
    driveBackupVerifiedAt,
    canPurgeFromDb: Boolean(
      isSuspended &&
        !isPurgedFromDb &&
        isGraceExpired &&
        driveBackupVerified &&
        driveBackupVerifiedAt !== null
    ),
  };
}

/**
 * Evaluates an organization's 7-day grace period when it has zero paid active branches.
 * - Legacy exempt orgs (`legacy_unrestricted`) are never placed into this grace.
 * - Suspended branches inside their 30-day window do NOT count as paid branches.
 */
export function evaluateOrgNoPaidBranchGrace(
  org: (Pick<
    Organization,
    | 'isActive'
    | 'subscriptionPlan'
    | 'subscriptionStatus'
    | 'subscriptionStartAt'
    | 'subscriptionEndAt'
    | 'deactivationReason'
    | 'noPaidBranchGraceStartedAt'
    | 'deactivationDueAt'
    | 'branchPricingModel'
  > &
    Partial<
      Pick<
        Organization,
        | 'ownerId'
        | 'ownerEmail'
        | 'billingExempt'
        | 'billingExemptScope'
        | 'billingExemptMode'
        | 'billingExemptVerifiedOwnerId'
        | 'billingExemptVerifiedOwnerEmail'
      >
    >) | null | undefined,
  branches: Array<
    Pick<Branch, 'id' | 'isActive' | 'lifecycleStatus' | 'paymentStatus' | 'feeDueAt'> &
      Partial<Pick<Branch, 'billingExempt' | 'billingExemptMode'>>
  >,
  nowInput: Date = new Date()
): OrgNoPaidBranchGraceEvaluation {
  const now = toValidDate(nowInput) || new Date();
  const subEval = evaluateOrganizationSubscription(org, now);
  const activeBranches = branches.filter((b) => !isBranchSuspendedOrPurged(b));
  const paidBranches = branches.filter((b) => isBranchCountedAsPaid(b, org, now));

  if (!org || subEval.isFeeExempt) {
    return {
      isLegacyExempt: !org || subEval.isLegacy,
      isBillingExempt: Boolean(org && subEval.isBillingExempt),
      isFeeExempt: true,
      activeBranchesCount: activeBranches.length,
      paidBranchesCount: activeBranches.length,
      inGrace: false,
      isDeactivated: false,
      graceStartedAt: null,
      deactivationDueAt: null,
      remainingGraceDays: null,
    };
  }

  const graceStartedAt = toValidDate(org.noPaidBranchGraceStartedAt);
  const explicitDue = toValidDate(org.deactivationDueAt);
  const deactivationDueAt =
    explicitDue ||
    (graceStartedAt
      ? new Date(graceStartedAt.getTime() + NO_PAID_BRANCH_GRACE_DAYS * MS_PER_DAY)
      : null);

  const explicitlyDeactivated =
    org.isActive === false && org.deactivationReason === 'no_paid_branches';
  const deadlineElapsedWithZeroPaid =
    paidBranches.length === 0 &&
    deactivationDueAt !== null &&
    now.getTime() >= deactivationDueAt.getTime();

  const isDeactivated = explicitlyDeactivated || deadlineElapsedWithZeroPaid;
  const inGrace = paidBranches.length === 0 && !isDeactivated;

  let remainingGraceDays: number | null = null;
  if (inGrace && deactivationDueAt) {
    const remMs = deactivationDueAt.getTime() - now.getTime();
    remainingGraceDays = remMs > 0 ? Math.ceil(remMs / MS_PER_DAY) : 0;
  } else if (inGrace) {
    remainingGraceDays = NO_PAID_BRANCH_GRACE_DAYS;
  }

  return {
    isLegacyExempt: false,
    isBillingExempt: false,
    isFeeExempt: false,
    activeBranchesCount: activeBranches.length,
    paidBranchesCount: paidBranches.length,
    inGrace,
    isDeactivated,
    graceStartedAt,
    deactivationDueAt,
    remainingGraceDays,
  };
}

/**
 * Evaluates Phase 4.2 manual payment pricing breakdown:
 * - Setup fee: 80 SAR one-time (for new/managed orgs)
 * - Monthly branch fee: 50 SAR/month starting from the 1st active branch (includedBranchesCount = 0)
 * - Reactivation fee after deactivation: 10 SAR
 * - Legacy organizations ('legacy_unrestricted') remain exempt (0 SAR) until explicitly converted by Super Admin.
 * - Automatic charging/billing remains explicitly disabled (`autoBillingEnabled: false`).
 */
export function evaluateOrganizationBranchPricing(params: {
  org: (Pick<
    Organization,
    | 'isActive'
    | 'subscriptionPlan'
    | 'subscriptionStatus'
    | 'subscriptionStartAt'
    | 'subscriptionEndAt'
    | 'branchPricingModel'
    | 'includedBranchesCount'
    | 'extraBranchMonthlyFeeSar'
    | 'accountSetupFeeSar'
    | 'setupFeeStatus'
    | 'reactivationFeeSar'
    | 'deactivationReason'
    | 'noPaidBranchGraceStartedAt'
    | 'deactivationDueAt'
  > &
    Partial<
      Pick<
        Organization,
        | 'ownerId'
        | 'ownerEmail'
        | 'billingExempt'
        | 'billingExemptScope'
        | 'billingExemptMode'
        | 'billingExemptVerifiedOwnerId'
        | 'billingExemptVerifiedOwnerEmail'
      >
    >) | null | undefined;
  branches?: Array<
    Pick<Branch, 'id' | 'isActive' | 'lifecycleStatus' | 'paymentStatus' | 'feeDueAt'> &
      Partial<Pick<Branch, 'billingExempt' | 'billingExemptMode'>>
  >;
  totalBranchesCount?: number;
  activeBranchesCount?: number;
  now?: Date;
}): ExtraBranchPricingEvaluation {
  const { org, branches, now = new Date() } = params;

  const totalCount =
    typeof params.totalBranchesCount === 'number' && params.totalBranchesCount >= 0
      ? Math.floor(params.totalBranchesCount)
      : Array.isArray(branches)
      ? branches.length
      : 0;

  const activeCount =
    typeof params.activeBranchesCount === 'number' && params.activeBranchesCount >= 0
      ? Math.floor(params.activeBranchesCount)
      : Array.isArray(branches)
      ? branches.filter((b) => !isBranchSuspendedOrPurged(b)).length
      : totalCount;

  const suspendedCount = Array.isArray(branches)
    ? branches.filter((b) => isBranchSuspendedOrPurged(b)).length
    : Math.max(0, totalCount - activeCount);

  const subEval = evaluateOrganizationSubscription(org, now);
  const includedCount = normalizeNonNegativeInt(
    org?.includedBranchesCount,
    NEW_ORG_INCLUDED_BRANCHES_COUNT
  );
  const feePerBranch = normalizeNonNegativeInt(
    org?.extraBranchMonthlyFeeSar,
    BRANCH_MONTHLY_FEE_SAR
  );
  const reactivationFeeSar = normalizeNonNegativeInt(
    org?.reactivationFeeSar,
    ORG_REACTIVATION_FEE_SAR
  );

  // Unified organization-level fee exemption (handles billing_exempt, explicit legacy_unrestricted, and implicit legacy_unrestricted)
  if (!org || subEval.isFeeExempt) {
    const isLegacyExempt = !org || subEval.isLegacy;
    const isBillingExempt = Boolean(org && subEval.isBillingExempt);
    const exemptionMode: ExemptionClassification = isBillingExempt
      ? 'billing_exempt'
      : 'legacy_unrestricted';

    return {
      model: org?.branchPricingModel || BRANCH_PRICING_MODEL,
      setupFeeSar: 0,
      setupFeeStatus: 'waived',
      reactivationFeeSar: 0,
      feePerExtraBranchMonthlySar: 0,
      branchMonthlyFeeSar: 0,
      includedBranchesCount: includedCount,
      totalBranchesCount: totalCount,
      activeBranchesCount: activeCount,
      paidBranchesCount: activeCount,
      exemptBranchesCount: activeCount,
      billableBranchesCount: 0,
      suspendedBranchesCount: suspendedCount,
      extraBranchesCount: 0,
      estimatedMonthlyExtraFeeSar: 0,
      estimatedMonthlyBranchTotalSar: 0,
      isLegacyExempt,
      isBillingExempt,
      isFeeExempt: true,
      exemptionMode,
      autoBillingEnabled: false,
      pricingSummary: isBillingExempt
        ? 'مؤسسة معفاة دائماً (billing_exempt): معفاة من رسوم الاشتراك والتأسيس وإعادة التنشيط وجميع الفروع الحالية والمستقبلية (0 ر.س).'
        : subEval.isExplicitLegacyUnrestricted
        ? 'مؤسسة معفاة دائماً (legacy_unrestricted): معفاة من رسوم الاشتراك والتأسيس وإعادة التنشيط وجميع الفروع الحالية والمستقبلية مع حفظ السجل التاريخي (0 ر.س).'
        : 'مؤسسة قديمة (legacy_unrestricted): معفاة من رسوم التأسيس واشتراك الفروع حتى التفعيل اليدوي.',
    };
  }

  const paidBranchesCount = Array.isArray(branches)
    ? branches.filter((b) => isBranchCountedAsPaid(b, org, now)).length
    : activeCount;

  // Individually exempt active branches are excluded from billable branch fees (0 SAR each)
  const exemptBranchesCount = Array.isArray(branches)
    ? branches.filter(
        (b) => !isBranchSuspendedOrPurged(b) && isBranchIndividuallyExempt(b)
      ).length
    : 0;

  const nonExemptActiveCount = Math.max(0, activeCount - exemptBranchesCount);
  const billableBranchesCount = Math.max(0, nonExemptActiveCount - includedCount);
  const estimatedMonthlyTotalSar = billableBranchesCount * feePerBranch;
  const setupFeeSar = normalizeNonNegativeInt(
    org.accountSetupFeeSar,
    ACCOUNT_SETUP_FEE_SAR
  );
  const setupFeeStatus: FeePaymentStatus = org.setupFeeStatus || 'unpaid';
  const model = org.branchPricingModel || BRANCH_PRICING_MODEL;

  const exemptSuffix =
    exemptBranchesCount > 0 ? ` — ويُستثنى ${exemptBranchesCount} فرع معفى فردياً (0 ر.س)` : '';

  const pricingSummary =
    includedCount === 0
      ? billableBranchesCount > 0
        ? `${billableBranchesCount} فرع فعال خاضع للرسوم × ${feePerBranch} ر.س/شهرياً = ${estimatedMonthlyTotalSar} ر.س/شهرياً${exemptSuffix} (التتبع اليدوي بدون خصم آلي)`
        : exemptBranchesCount > 0
        ? `جميع الفروع الفعالة معفاة فردياً (${exemptBranchesCount} فرع — 0 ر.س/شهرياً)`
        : `لا توجد فروع فعالة حالياً — ${feePerBranch} ر.س/شهرياً لكل فرع بدءاً من أول فرع`
      : billableBranchesCount > 0
      ? `${billableBranchesCount} فرع خاضع للرسوم × ${feePerBranch} ر.س/شهرياً = ${estimatedMonthlyTotalSar} ر.س/شهرياً${exemptSuffix}`
      : `ضمن الحد المشمول (${includedCount} فرع)${exemptSuffix} — ${feePerBranch} ر.س/شهرياً لكل فرع إضافي`;

  return {
    model,
    setupFeeSar,
    setupFeeStatus,
    reactivationFeeSar,
    feePerExtraBranchMonthlySar: feePerBranch,
    branchMonthlyFeeSar: feePerBranch,
    includedBranchesCount: includedCount,
    totalBranchesCount: totalCount,
    activeBranchesCount: activeCount,
    paidBranchesCount,
    exemptBranchesCount,
    billableBranchesCount,
    suspendedBranchesCount: suspendedCount,
    extraBranchesCount: billableBranchesCount,
    estimatedMonthlyExtraFeeSar: estimatedMonthlyTotalSar,
    estimatedMonthlyBranchTotalSar: estimatedMonthlyTotalSar,
    isLegacyExempt: false,
    isBillingExempt: false,
    isFeeExempt: false,
    exemptionMode: 'none',
    autoBillingEnabled: false,
    pricingSummary,
  };
}

/**
 * Verifies Google Drive backup completeness before allowing website Firestore DB purge of a branch.
 * Fail-closed: rejects if branch is not suspended, 30-day grace has not expired,
 * any approved closing lacks an intact 'archived' Google Drive record with SHA-256 hash & file link,
 * any pending/unapproved closings remain unarchived, or any archive failed/became stale after correction.
 */
export function verifyBranchDriveBackupCompleteness(params: {
  branch: Pick<
    Branch,
    'id' | 'isActive' | 'lifecycleStatus' | 'suspendedAt' | 'gracePeriodEndsAt'
  > | null | undefined;
  closings: Array<
    Pick<ShiftClosing, 'id' | 'branchId' | 'status' | 'correctedAt'>
  >;
  archives: Array<
    Pick<
      ClosingArchiveRecord,
      | 'closingId'
      | 'branchId'
      | 'archiveStatus'
      | 'driveExcelFileId'
      | 'driveExcelWebViewLink'
      | 'drivePayloadHash'
      | 'archivedAt'
      | 'sourceCorrectionAt'
    >
  >;
  now?: Date;
}): BranchDriveBackupVerificationResult {
  const { branch, closings, archives, now = new Date() } = params;
  const branchId = branch?.id || '';

  if (!branch) {
    return {
      verified: false,
      branchId,
      totalClosingsCount: 0,
      approvedClosingsCount: 0,
      verifiedArchivedCount: 0,
      unapprovedPendingCount: 0,
      missingOrUnverifiedClosingIds: [],
      failedOrStaleClosingIds: [],
      reason: 'بيانات الفرع غير موجودة.',
    };
  }

  const isSuspended =
    branch.isActive === false || branch.lifecycleStatus === 'suspended';
  if (!isSuspended || branch.lifecycleStatus === 'purged_from_db') {
    return {
      verified: false,
      branchId,
      totalClosingsCount: 0,
      approvedClosingsCount: 0,
      verifiedArchivedCount: 0,
      unapprovedPendingCount: 0,
      missingOrUnverifiedClosingIds: [],
      failedOrStaleClosingIds: [],
      reason: 'يجب تعليق الفرع أولاً والانتظار حتى انتهاء مهلة الـ 30 يوماً قبل التحقق للحذف.',
    };
  }

  const suspendedAt = toValidDate(branch.suspendedAt);
  const explicitGraceEnd = toValidDate(branch.gracePeriodEndsAt);
  const graceEnd =
    explicitGraceEnd ||
    (suspendedAt
      ? new Date(suspendedAt.getTime() + BRANCH_SUSPENSION_GRACE_DAYS * MS_PER_DAY)
      : null);

  if (!graceEnd || now.getTime() < graceEnd.getTime()) {
    return {
      verified: false,
      branchId,
      totalClosingsCount: 0,
      approvedClosingsCount: 0,
      verifiedArchivedCount: 0,
      unapprovedPendingCount: 0,
      missingOrUnverifiedClosingIds: [],
      failedOrStaleClosingIds: [],
      reason: 'لم تنتهِ مهلة السماح البالغة 30 يوماً بعد تعليق الفرع.',
    };
  }

  const branchClosings = closings.filter((c) => c.branchId === branch.id);
  const archiveByClosingId = new Map<
    string,
    (typeof archives)[number]
  >();
  for (const arc of archives) {
    if (arc.branchId === branch.id) {
      archiveByClosingId.set(arc.closingId, arc);
    }
  }

  const approvedClosings = branchClosings.filter((c) => c.status === 'approved');
  const pendingReviewClosings = branchClosings.filter(
    (c) => c.status === 'pending_review'
  );

  const missingOrUnverifiedClosingIds: string[] = [];
  const failedOrStaleClosingIds: string[] = [];
  let verifiedArchivedCount = 0;

  for (const arc of archiveByClosingId.values()) {
    if (arc.archiveStatus === 'failed' || arc.archiveStatus === 'stale') {
      failedOrStaleClosingIds.push(arc.closingId);
    }
  }

  for (const closing of approvedClosings) {
    const arc = archiveByClosingId.get(closing.id);
    if (!arc) {
      missingOrUnverifiedClosingIds.push(closing.id);
      continue;
    }

    const hasProofFields =
      arc.archiveStatus === 'archived' &&
      typeof arc.driveExcelFileId === 'string' &&
      arc.driveExcelFileId.trim().length > 0 &&
      typeof arc.driveExcelWebViewLink === 'string' &&
      arc.driveExcelWebViewLink.trim().length > 0 &&
      typeof arc.drivePayloadHash === 'string' &&
      /^[a-fA-F0-9]{64}$/.test(arc.drivePayloadHash) &&
      typeof arc.archivedAt === 'string' &&
      arc.archivedAt.trim().length > 0;

    if (!hasProofFields) {
      if (arc.archiveStatus === 'failed' || arc.archiveStatus === 'stale') {
        if (!failedOrStaleClosingIds.includes(closing.id)) {
          failedOrStaleClosingIds.push(closing.id);
        }
      } else {
        missingOrUnverifiedClosingIds.push(closing.id);
      }
      continue;
    }

    const closingCorrectedAt = toValidDate(closing.correctedAt);
    const arcCorrectionAt = toValidDate(arc.sourceCorrectionAt);
    if (
      closingCorrectedAt &&
      (!arcCorrectionAt || arcCorrectionAt.getTime() < closingCorrectedAt.getTime())
    ) {
      failedOrStaleClosingIds.push(closing.id);
      continue;
    }

    verifiedArchivedCount += 1;
  }

  if (
    missingOrUnverifiedClosingIds.length > 0 ||
    failedOrStaleClosingIds.length > 0 ||
    pendingReviewClosings.length > 0
  ) {
    const reasons: string[] = [];
    if (missingOrUnverifiedClosingIds.length > 0) {
      reasons.push(
        `يوجد ${missingOrUnverifiedClosingIds.length} إقفال معتمد غير مؤرشف بالكامل في Google Drive`
      );
    }
    if (failedOrStaleClosingIds.length > 0) {
      reasons.push(
        `يوجد ${failedOrStaleClosingIds.length} سجل أرشيف فاشل أو متأخر بعد تصحيح إداري`
      );
    }
    if (pendingReviewClosings.length > 0) {
      reasons.push(
        `يوجد ${pendingReviewClosings.length} إقفال قيد المراجعة لم يُعتمد أو يُؤرشف بعد`
      );
    }

    return {
      verified: false,
      branchId,
      totalClosingsCount: branchClosings.length,
      approvedClosingsCount: approvedClosings.length,
      verifiedArchivedCount,
      unapprovedPendingCount: pendingReviewClosings.length,
      missingOrUnverifiedClosingIds,
      failedOrStaleClosingIds,
      reason: reasons.join(' — '),
    };
  }

  return {
    verified: true,
    branchId,
    totalClosingsCount: branchClosings.length,
    approvedClosingsCount: approvedClosings.length,
    verifiedArchivedCount,
    unapprovedPendingCount: 0,
    missingOrUnverifiedClosingIds: [],
    failedOrStaleClosingIds: [],
    reason:
      approvedClosings.length > 0
        ? `تم التحقق من اكتمال أرشفة جميع الإقفالات المعتمدة (${verifiedArchivedCount}/${approvedClosings.length}) على Google Drive بنجاح.`
        : 'لا توجد إقفالات معتمدة غير مؤرشفة لهذا الفرع؛ الحذف من قاعدة بيانات الموقع مأمون ولن يمس ملفات Google Drive.',
  };
}

/**
 * Prepares a WhatsApp message to request adding a new branch from Super Admin
 * (50 SAR/month starting from 1st branch for managed subscriptions).
 */
export function buildExtraBranchRequestWhatsApp(params: {
  orgName: string;
  orgId: string;
  managerName: string;
  managerEmail: string;
  currentBranchCount: number;
  isLegacyExempt?: boolean;
  isBillingExempt?: boolean;
  language?: SupportedLanguage;
}): PreparedWhatsAppLink {
  const language = params.language || 'ar';
  const cleanOrgName = params.orgName.trim();
  const cleanManagerName = params.managerName.trim();
  const cleanEmail = params.managerEmail.trim();

  const message =
    language === 'en'
      ? [
          'Hello AL EQFAL Management,',
          'I would like to request adding a new branch to our organization:',
          `- Organization: ${cleanOrgName} (${params.orgId})`,
          `- Manager: ${cleanManagerName} (${cleanEmail})`,
          `- Current Branches: ${params.currentBranchCount}`,
          params.isBillingExempt
            ? '- Account Tier: Permanent Full Billing Exemption (0 SAR)'
            : params.isLegacyExempt
            ? '- Account Tier: Legacy Unrestricted'
            : `- Branch Rate: ${BRANCH_MONTHLY_FEE_SAR} SAR/month per branch`,
        ].join('\n')
      : language === 'ur'
      ? [
          'السلام علیکم الاقفال انتظامیہ،',
          'میں اپنے ادارے میں ایک نئی برانچ شامل کرنے کی درخواست کرنا چاہتا ہوں:',
          `- ادارہ: ${cleanOrgName} (${params.orgId})`,
          `- منیجر: ${cleanManagerName} (${cleanEmail})`,
          `- موجودہ برانچز: ${params.currentBranchCount}`,
          params.isBillingExempt
            ? '- اکاؤنٹ کی قسم: مستقل مکمل فیس استثنیٰ (0 ریال)'
            : params.isLegacyExempt
            ? '- اکاؤنٹ کی قسم: لیگیسی (بغیر پابندی)'
            : `- برانچ فیس: ${BRANCH_MONTHLY_FEE_SAR} ریال ماہانہ فی برانچ`,
        ].join('\n')
      : [
          'السلام عليكم إدارة نظام الإقفال AL EQFAL،',
          'أرغب في طلب إضافة فرع جديد للمؤسسة:',
          `- اسم المؤسسة: ${cleanOrgName} (${params.orgId})`,
          `- المدير: ${cleanManagerName} (${cleanEmail})`,
          `- عدد الفروع الحالية: ${params.currentBranchCount}`,
          params.isBillingExempt
            ? '- تصنيف الحساب: إعفاء دائم شامل (0 ر.س)'
            : params.isLegacyExempt
            ? '- تصنيف الحساب: مؤسسة قديمة معفاة'
            : `- تسعيرة الفرع: ${BRANCH_MONTHLY_FEE_SAR} ريال سعودي / شهرياً لكل فرع`,
        ].join('\n');

  return {
    phoneLocal: SUBSCRIPTION_WHATSAPP_LOCAL,
    phoneIntl: SUBSCRIPTION_WHATSAPP_INTL,
    message,
    url: buildSubscriptionWhatsAppUrl(message),
  };
}

export { buildReactivationSubscriptionWhatsApp };
