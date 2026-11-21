/**
 * Phase A Unit Test Suite — Branch Exemption Pricing, Explicit `legacy_unrestricted`,
 * Pre-Grant Eligibility Verification & Historical Subscription Preservation
 *
 * Runs cleanly via Node / tsx without requiring Firestore Emulator or DOM.
 */
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import { Branch, ManagerInvite, Organization, UserProfile } from '../types';
import {
  evaluateOrganizationSubscription,
  getOrgExemptionClassification,
  isOrgPermanentlyBillingExempt,
} from '../utils/subscription';
import {
  evaluateBranchBillingAndGrace,
  evaluateOrganizationBranchPricing,
  evaluateOrgNoPaidBranchGrace,
  getBranchIndividualExemptionMode,
  isBranchCountedAsPaid,
  isBranchIndividuallyExempt,
} from '../utils/branchPricing';
import {
  buildNonDestructiveBranchExemptionPatch,
  buildNonDestructiveBranchExemptionRevokePatch,
  buildNonDestructiveOrgExemptionPatch,
  buildNonDestructiveOrgExemptionRevokePatch,
  locateOrganizationsByOwnerEmail,
  verifyBranchExemptionEligibility,
  verifyHistoricalSubscriptionFieldsPreserved,
  verifyOrganizationExemptionEligibility,
} from '../utils/exemptionVerification';

const NOW = new Date('2026-11-21T12:00:00.000Z');
const PAST_30D = Timestamp.fromDate(new Date('2026-10-22T12:00:00.000Z'));
const PAST_2D = Timestamp.fromDate(new Date('2026-11-19T12:00:00.000Z'));
const FUTURE_30D = Timestamp.fromDate(new Date('2026-12-21T12:00:00.000Z'));

function makePaidOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org_paid_01',
    name: 'مؤسسة الاختبار التجارية',
    activityType: 'retail',
    currency: 'SAR',
    ownerId: 'uid_owner_01',
    ownerEmail: 'owner01@example.com',
    ownerName: 'مالك الاختبار',
    driveConnected: false,
    isActive: true,
    subscriptionPlan: '1m',
    subscriptionStatus: 'active',
    subscriptionStartAt: PAST_30D,
    subscriptionEndAt: FUTURE_30D,
    subscriptionUpdatedAt: PAST_30D,
    subscriptionUpdatedBy: 'amoal2030@gmail.com',
    subscriptionNote: 'اشتراك شهري مدفوع',
    branchPricingModel: 'per_branch_50_sar',
    includedBranchesCount: 0,
    extraBranchMonthlyFeeSar: 50,
    accountSetupFeeSar: 80,
    setupFeeStatus: 'paid',
    setupFeePaidAt: PAST_30D,
    reactivationFeeSar: 10,
    reactivationFeeStatus: 'unpaid',
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-11-20T08:00:00.000Z',
    ...overrides,
  };
}

function makeOwnerUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid_owner_01',
    orgId: 'org_paid_01',
    email: 'owner01@example.com',
    displayName: 'مالك الاختبار',
    role: 'manager',
    isActive: true,
    isArchived: false,
    permissions: {
      canCreateClosing: true,
      canViewAllClosings: true,
      canApproveClosings: true,
      canManageBranches: true,
      canManageEmployees: true,
      canExportReports: true,
      canManagePurchases: true,
      canManageSuppliers: true,
      canViewSuppliers: true,
      canViewFinancialReports: true,
    },
    createdAt: '2026-01-10T08:00:00.000Z',
    ...overrides,
  };
}

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: 'br_01',
    orgId: 'org_paid_01',
    name: 'الفرع الأول',
    code: 'BR01',
    isActive: true,
    lifecycleStatus: 'active',
    subscriptionStartAt: PAST_30D,
    monthlyFeeSar: 50,
    paymentStatus: 'paid',
    feeDueAt: FUTURE_30D,
    lastPaidAt: PAST_30D,
    lastPaidBy: 'amoal2030@gmail.com',
    paymentNote: 'دفعة شهر أكتوبر',
    createdAt: '2026-01-10T08:00:00.000Z',
    ...overrides,
  };
}

function runTests() {
  let passed = 0;
  const test = (name: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`✔ PASS: ${name}`);
  };

  console.log('========================================================================');
  console.log('  PHASE A — BRANCH EXEMPTION, LEGACY_UNRESTRICTED & PRECHECK UNIT SUITE ');
  console.log('========================================================================\n');

  // 1. Fully exempt organization (both billing_exempt & explicit legacy_unrestricted)
  test('1. Fully exempt organization (billing_exempt & explicit legacy_unrestricted) zeros all org and branch fees', () => {
    const baseOrg = makePaidOrg({
      subscriptionStatus: 'expired',
      subscriptionEndAt: PAST_2D,
    });
    const branches = [
      makeBranch({ id: 'br_1', paymentStatus: 'overdue', monthlyFeeSar: 50, feeDueAt: PAST_2D }),
      makeBranch({ id: 'br_2', paymentStatus: 'unpaid', monthlyFeeSar: 50, feeDueAt: PAST_2D }),
    ];

    // 1A: billing_exempt mode
    const exemptOrg: Organization = {
      ...baseOrg,
      ...buildNonDestructiveOrgExemptionPatch({
        org: baseOrg,
        mode: 'billing_exempt',
        reason: 'إعفاء دائم شامل للمؤسسة',
        grantedBy: 'amoal2030@gmail.com',
        grantedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_org_ex_1',
      }),
    };
    const subEval1 = evaluateOrganizationSubscription(exemptOrg, NOW);
    assert.equal(subEval1.state, 'billing_exempt');
    assert.equal(subEval1.isAllowed, true);
    assert.equal(subEval1.isFeeExempt, true);
    assert.equal(subEval1.isBillingExempt, true);
    assert.equal(subEval1.isLegacy, false);
    assert.equal(subEval1.exemptionMode, 'billing_exempt');

    const pricing1 = evaluateOrganizationBranchPricing({ org: exemptOrg, branches, now: NOW });
    assert.equal(pricing1.isFeeExempt, true);
    assert.equal(pricing1.isBillingExempt, true);
    assert.equal(pricing1.isLegacyExempt, false);
    assert.equal(pricing1.setupFeeSar, 0);
    assert.equal(pricing1.reactivationFeeSar, 0);
    assert.equal(pricing1.billableBranchesCount, 0);
    assert.equal(pricing1.exemptBranchesCount, 2);
    assert.equal(pricing1.estimatedMonthlyBranchTotalSar, 0);

    for (const b of branches) {
      const bEval = evaluateBranchBillingAndGrace(b, exemptOrg, NOW);
      assert.equal(bEval.monthlyFeeSar, 0);
      assert.equal(bEval.paymentStatus, 'exempt');
      assert.equal(bEval.isFeeExempt, true);
      assert.equal(bEval.isOrgFeeExempt, true);
      assert.equal(bEval.isBranchIndividuallyExempt, false);
      assert.equal(bEval.exemptionSource, 'organization');
      assert.equal(bEval.exemptionMode, 'billing_exempt');
    }

    // 1B: explicit legacy_unrestricted mode (independent of historical subscription fields!)
    const explicitLegacyOrg: Organization = {
      ...baseOrg,
      ...buildNonDestructiveOrgExemptionPatch({
        org: baseOrg,
        mode: 'legacy_unrestricted',
        reason: 'اعتماد المؤسسة ضمن سياسة legacy_unrestricted دون حذف سجل الاشتراك',
        grantedBy: 'amoal2030@gmail.com',
        grantedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_org_leg_1',
      }),
    };
    assert.equal(isOrgPermanentlyBillingExempt(explicitLegacyOrg), true);
    assert.equal(getOrgExemptionClassification(explicitLegacyOrg), 'legacy_unrestricted');

    const subEval2 = evaluateOrganizationSubscription(explicitLegacyOrg, NOW);
    assert.equal(subEval2.state, 'legacy_unrestricted');
    assert.equal(subEval2.isAllowed, true);
    assert.equal(subEval2.isFeeExempt, true);
    assert.equal(subEval2.isLegacy, true);
    assert.equal(subEval2.isExplicitLegacyUnrestricted, true);
    assert.equal(subEval2.isBillingExempt, false);
    assert.equal(subEval2.exemptionMode, 'legacy_unrestricted');

    const pricing2 = evaluateOrganizationBranchPricing({
      org: explicitLegacyOrg,
      branches,
      now: NOW,
    });
    assert.equal(pricing2.isFeeExempt, true);
    assert.equal(pricing2.isLegacyExempt, true);
    assert.equal(pricing2.exemptionMode, 'legacy_unrestricted');
    assert.equal(pricing2.billableBranchesCount, 0);
    assert.equal(pricing2.estimatedMonthlyBranchTotalSar, 0);
    assert.equal(pricing2.setupFeeSar, 0);
    assert.equal(pricing2.reactivationFeeSar, 0);

    const bEvalLegacy = evaluateBranchBillingAndGrace(branches[0], explicitLegacyOrg, NOW);
    assert.equal(bEvalLegacy.monthlyFeeSar, 0);
    assert.equal(bEvalLegacy.isFeeExempt, true);
    assert.equal(bEvalLegacy.isOrgFeeExempt, true);
    assert.equal(bEvalLegacy.isBranchIndividuallyExempt, false);
    assert.equal(bEvalLegacy.exemptionSource, 'organization');
    assert.equal(bEvalLegacy.exemptionMode, 'legacy_unrestricted');
    assert.equal(bEvalLegacy.isLegacyUnrestricted, true);
  });

  // 2. Non-exempt regular organization pricing stays completely unchanged
  test('2. Non-exempt paid organization retains exact 80/50/10 SAR pricing for regular branches', () => {
    const paidOrg = makePaidOrg();
    const branches = [
      makeBranch({ id: 'br_1', paymentStatus: 'paid', monthlyFeeSar: 50 }),
      makeBranch({ id: 'br_2', paymentStatus: 'paid', monthlyFeeSar: 50 }),
      makeBranch({ id: 'br_3_susp', isActive: false, lifecycleStatus: 'suspended', paymentStatus: 'unpaid', monthlyFeeSar: 50 }),
    ];

    const subEval = evaluateOrganizationSubscription(paidOrg, NOW);
    assert.equal(subEval.state, 'active');
    assert.equal(subEval.isFeeExempt, false);
    assert.equal(subEval.exemptionMode, 'none');

    const pricing = evaluateOrganizationBranchPricing({ org: paidOrg, branches, now: NOW });
    assert.equal(pricing.isFeeExempt, false);
    assert.equal(pricing.setupFeeSar, 80);
    assert.equal(pricing.reactivationFeeSar, 10);
    assert.equal(pricing.totalBranchesCount, 3);
    assert.equal(pricing.activeBranchesCount, 2);
    assert.equal(pricing.suspendedBranchesCount, 1);
    assert.equal(pricing.exemptBranchesCount, 0);
    assert.equal(pricing.billableBranchesCount, 2);
    assert.equal(pricing.extraBranchesCount, 2);
    assert.equal(pricing.estimatedMonthlyBranchTotalSar, 100);
    assert.equal(pricing.estimatedMonthlyExtraFeeSar, 100);
  });

  // 3. Individually exempt branch inside a paid organization (both billing_exempt & legacy_unrestricted)
  test('3. Individually exempt branch inside a paid org has 0 SAR fee and is excluded from billable branches count', () => {
    const paidOrg = makePaidOrg();

    // Branch A: regular paid branch (50 SAR)
    const normalBranch = makeBranch({
      id: 'br_normal',
      paymentStatus: 'paid',
      monthlyFeeSar: 50,
    });

    // Branch B: individually exempt via paymentStatus='exempt' even with stale monthlyFeeSar=50
    const exemptBranchLegacyStyle = makeBranch({
      id: 'br_exempt_1',
      paymentStatus: 'exempt',
      monthlyFeeSar: 50, // Deliberately 50 to prove engine forces 0 SAR
    });

    // Branch C: individually granted legacy_unrestricted via non-destructive patch
    const exemptBranchLegacyUnrestricted: Branch = {
      ...makeBranch({ id: 'br_exempt_2', paymentStatus: 'paid', monthlyFeeSar: 50 }),
      ...buildNonDestructiveBranchExemptionPatch({
        mode: 'legacy_unrestricted',
        reason: 'فرع قديم معفى ضمن مؤسسة مدفوعة',
        grantedBy: 'amoal2030@gmail.com',
        grantedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_br_leg_1',
      }),
    };

    // Verify individual branch evaluations
    const normalEval = evaluateBranchBillingAndGrace(normalBranch, paidOrg, NOW);
    assert.equal(normalEval.monthlyFeeSar, 50);
    assert.equal(normalEval.isFeeExempt, false);
    assert.equal(normalEval.exemptionSource, 'none');
    assert.equal(normalEval.exemptionMode, 'none');

    const exEval1 = evaluateBranchBillingAndGrace(exemptBranchLegacyStyle, paidOrg, NOW);
    assert.equal(exEval1.monthlyFeeSar, 0);
    assert.equal(exEval1.paymentStatus, 'exempt');
    assert.equal(exEval1.isPaidAndActive, true);
    assert.equal(exEval1.isFeeExempt, true);
    assert.equal(exEval1.isOrgFeeExempt, false);
    assert.equal(exEval1.isBranchIndividuallyExempt, true);
    assert.equal(exEval1.exemptionSource, 'branch');
    assert.equal(exEval1.exemptionMode, 'billing_exempt');
    assert.equal(exEval1.isLegacyUnrestricted, false);

    const exEval2 = evaluateBranchBillingAndGrace(exemptBranchLegacyUnrestricted, paidOrg, NOW);
    assert.equal(exEval2.monthlyFeeSar, 0);
    assert.equal(exEval2.paymentStatus, 'exempt');
    assert.equal(exEval2.isPaidAndActive, true);
    assert.equal(exEval2.isFeeExempt, true);
    assert.equal(exEval2.isOrgFeeExempt, false);
    assert.equal(exEval2.isBranchIndividuallyExempt, true);
    assert.equal(exEval2.exemptionSource, 'branch');
    assert.equal(exEval2.exemptionMode, 'legacy_unrestricted');
    assert.equal(exEval2.isLegacyUnrestricted, true);
    assert.equal(getBranchIndividualExemptionMode(exemptBranchLegacyUnrestricted), 'legacy_unrestricted');
    // Historical branch payment metadata preserved untouched
    assert.equal(exemptBranchLegacyUnrestricted.lastPaidBy, 'amoal2030@gmail.com');
    assert.equal(exemptBranchLegacyUnrestricted.paymentNote, 'دفعة شهر أكتوبر');

    // Verify org-level aggregate pricing: 3 active branches (1 normal + 2 exempt) => ONLY 1 billable (50 SAR)!
    const pricing = evaluateOrganizationBranchPricing({
      org: paidOrg,
      branches: [normalBranch, exemptBranchLegacyStyle, exemptBranchLegacyUnrestricted],
      now: NOW,
    });
    assert.equal(pricing.isFeeExempt, false); // Org itself is STILL paid, not exempt
    assert.equal(pricing.activeBranchesCount, 3);
    assert.equal(pricing.paidBranchesCount, 3);
    assert.equal(pricing.exemptBranchesCount, 2);
    assert.equal(pricing.billableBranchesCount, 1);
    assert.equal(pricing.extraBranchesCount, 1);
    assert.equal(pricing.estimatedMonthlyBranchTotalSar, 50);
    assert.equal(pricing.estimatedMonthlyExtraFeeSar, 50);
  });

  // 4. Normal branch inside a paid org alongside includedBranchesCount edge case
  test('4. Normal branch inside a paid org computes exact billable count with includedBranchesCount', () => {
    const orgWith1Included = makePaidOrg({ includedBranchesCount: 1 });
    const branches = [
      makeBranch({ id: 'br_norm_1', paymentStatus: 'paid', monthlyFeeSar: 50 }),
      makeBranch({ id: 'br_norm_2', paymentStatus: 'paid', monthlyFeeSar: 50 }),
      makeBranch({ id: 'br_ex_1', paymentStatus: 'exempt', billingExempt: true, monthlyFeeSar: 0 }),
    ];

    // 2 non-exempt active branches minus 1 included = 1 billable (50 SAR); exempt branch excluded
    const pricing = evaluateOrganizationBranchPricing({
      org: orgWith1Included,
      branches,
      now: NOW,
    });
    assert.equal(pricing.activeBranchesCount, 3);
    assert.equal(pricing.exemptBranchesCount, 1);
    assert.equal(pricing.billableBranchesCount, 1);
    assert.equal(pricing.estimatedMonthlyBranchTotalSar, 50);
  });

  // 5. Revoking individual branch exemption restores normal billing & fails closed
  test('5. Revoking individual branch exemption restores 50 SAR billing and re-includes branch in billable count', () => {
    const paidOrg = makePaidOrg();
    const initialBranch = makeBranch({ id: 'br_toggle', paymentStatus: 'paid', monthlyFeeSar: 50 });

    const grantedBranch: Branch = {
      ...initialBranch,
      ...buildNonDestructiveBranchExemptionPatch({
        mode: 'legacy_unrestricted',
        reason: 'إعفاء مؤقت لفرع تجريبي',
        grantedBy: 'amoal2030@gmail.com',
        grantedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_br_grant',
      }),
    };
    assert.equal(isBranchIndividuallyExempt(grantedBranch), true);
    assert.equal(evaluateBranchBillingAndGrace(grantedBranch, paidOrg, NOW).monthlyFeeSar, 0);

    const revokedBranch: Branch = {
      ...grantedBranch,
      ...buildNonDestructiveBranchExemptionRevokePatch({
        restoredPaymentStatus: 'unpaid',
        restoredMonthlyFeeSar: 50,
        revokeReason: 'انتهاء فترة الإعفاء المستقل للفرع',
        revokedBy: 'amoal2030@gmail.com',
        revokedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_br_revoke',
      }),
    };
    assert.equal(isBranchIndividuallyExempt(revokedBranch), false);
    const revokedEval = evaluateBranchBillingAndGrace(revokedBranch, paidOrg, NOW);
    assert.equal(revokedEval.isFeeExempt, false);
    assert.equal(revokedEval.isBranchIndividuallyExempt, false);
    assert.equal(revokedEval.exemptionSource, 'none');
    assert.equal(revokedEval.exemptionMode, 'none');
    assert.equal(revokedEval.paymentStatus, 'unpaid');
    assert.equal(revokedEval.monthlyFeeSar, 50);
    assert.equal(revokedEval.isPaidAndActive, false);
    // Original grant history & payment history remain intact
    assert.equal(revokedBranch.exemptGrantedBy, 'amoal2030@gmail.com');
    assert.equal(revokedBranch.lastPaidBy, 'amoal2030@gmail.com');

    const pricingAfterRevoke = evaluateOrganizationBranchPricing({
      org: paidOrg,
      branches: [revokedBranch],
      now: NOW,
    });
    assert.equal(pricingAfterRevoke.exemptBranchesCount, 0);
    assert.equal(pricingAfterRevoke.billableBranchesCount, 1);
    assert.equal(pricingAfterRevoke.estimatedMonthlyBranchTotalSar, 50);

    // Fail-closed safety: if billingExempt is explicitly false even with stale paymentStatus='exempt'
    const inconsistentRevoked: Branch = {
      ...grantedBranch,
      billingExempt: false,
      paymentStatus: 'exempt',
      monthlyFeeSar: 50,
    };
    assert.equal(isBranchIndividuallyExempt(inconsistentRevoked), false);
    const failClosedEval = evaluateBranchBillingAndGrace(inconsistentRevoked, paidOrg, NOW);
    assert.equal(failClosedEval.isFeeExempt, false);
    assert.equal(failClosedEval.paymentStatus, 'unpaid');
    assert.equal(failClosedEval.monthlyFeeSar, 50);
  });

  // 6. Bulk-exempting all branches inside a paid organization
  test('6. Exempting all active branches of a paid org yields 0 SAR branch total and prevents 7-day grace while keeping org distinction', () => {
    const paidOrg = makePaidOrg();
    const bulkExemptBranches = ['br_1', 'br_2', 'br_3'].map((id) => ({
      ...makeBranch({ id, paymentStatus: 'unpaid', monthlyFeeSar: 50, feeDueAt: PAST_2D }),
      ...buildNonDestructiveBranchExemptionPatch({
        mode: 'billing_exempt',
        reason: 'إعفاء جميع الفروع الحالية دفعة واحدة',
        grantedBy: 'amoal2030@gmail.com',
        grantedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_bulk_ex_1',
      }),
    }));

    const pricing = evaluateOrganizationBranchPricing({
      org: paidOrg,
      branches: bulkExemptBranches,
      now: NOW,
    });
    assert.equal(pricing.isFeeExempt, false); // Distinct from org-level exemption!
    assert.equal(pricing.activeBranchesCount, 3);
    assert.equal(pricing.exemptBranchesCount, 3);
    assert.equal(pricing.billableBranchesCount, 0);
    assert.equal(pricing.paidBranchesCount, 3);
    assert.equal(pricing.estimatedMonthlyBranchTotalSar, 0);

    // Org is NOT placed into 7-day no-paid-branch grace because all active branches are covered/exempt
    const grace = evaluateOrgNoPaidBranchGrace(paidOrg, bulkExemptBranches, NOW);
    assert.equal(grace.isFeeExempt, false);
    assert.equal(grace.paidBranchesCount, 3);
    assert.equal(grace.inGrace, false);
    assert.equal(grace.isDeactivated, false);

    // A suspended exempt branch STILL does not count as paid/active
    const suspendedExempt = { ...bulkExemptBranches[0], isActive: false, lifecycleStatus: 'suspended' as const };
    assert.equal(isBranchCountedAsPaid(suspendedExempt, paidOrg, NOW), false);
  });

  // 7. Organization transition from exempt -> non-exempt
  test('7. Transitioning org from exempt (billing_exempt or legacy_unrestricted) to non-exempt restores branch billing accurately', () => {
    const baseOrg = makePaidOrg({
      subscriptionStatus: 'active',
      subscriptionEndAt: FUTURE_30D,
    });
    const exemptOrg: Organization = {
      ...baseOrg,
      ...buildNonDestructiveOrgExemptionPatch({
        org: baseOrg,
        mode: 'legacy_unrestricted',
        reason: 'إعفاء قديم للمؤسسة',
        grantedBy: 'amoal2030@gmail.com',
        grantedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_org_leg_grant',
      }),
    };

    const orgInheritedOnlyBranch = makeBranch({
      id: 'br_org_only',
      paymentStatus: 'paid',
      monthlyFeeSar: 50,
    });
    const independentlyExemptBranch: Branch = {
      ...makeBranch({ id: 'br_indep', paymentStatus: 'paid', monthlyFeeSar: 50 }),
      ...buildNonDestructiveBranchExemptionPatch({
        mode: 'billing_exempt',
        reason: 'إعفاء فرع مستقل',
        grantedBy: 'amoal2030@gmail.com',
        grantedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_br_indep',
      }),
    };

    // While org is exempt: both branches are 0 SAR; br_indep shows source === 'both'
    assert.equal(
      evaluateBranchBillingAndGrace(orgInheritedOnlyBranch, exemptOrg, NOW).exemptionSource,
      'organization'
    );
    assert.equal(
      evaluateBranchBillingAndGrace(independentlyExemptBranch, exemptOrg, NOW).exemptionSource,
      'both'
    );
    assert.equal(
      evaluateOrganizationBranchPricing({
        org: exemptOrg,
        branches: [orgInheritedOnlyBranch, independentlyExemptBranch],
        now: NOW,
      }).estimatedMonthlyBranchTotalSar,
      0
    );

    // Revoke org-level exemption -> br_org_only returns to 50 SAR, br_indep remains independently exempt (0 SAR)
    const nonExemptOrg: Organization = {
      ...exemptOrg,
      ...buildNonDestructiveOrgExemptionRevokePatch({
        revokeReason: 'إلغاء إعفاء المؤسسة والعودة للباقة العادية',
        revokedBy: 'amoal2030@gmail.com',
        revokedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_org_leg_revoke',
      }),
    };

    const subAfter = evaluateOrganizationSubscription(nonExemptOrg, NOW);
    assert.equal(subAfter.state, 'active');
    assert.equal(subAfter.isFeeExempt, false);
    assert.equal(subAfter.isLegacy, false);
    assert.equal(subAfter.exemptionMode, 'none');

    const bOrgOnlyAfter = evaluateBranchBillingAndGrace(orgInheritedOnlyBranch, nonExemptOrg, NOW);
    assert.equal(bOrgOnlyAfter.isFeeExempt, false);
    assert.equal(bOrgOnlyAfter.monthlyFeeSar, 50);
    assert.equal(bOrgOnlyAfter.exemptionSource, 'none');

    const bIndepAfter = evaluateBranchBillingAndGrace(independentlyExemptBranch, nonExemptOrg, NOW);
    assert.equal(bIndepAfter.isFeeExempt, true);
    assert.equal(bIndepAfter.isOrgFeeExempt, false);
    assert.equal(bIndepAfter.isBranchIndividuallyExempt, true);
    assert.equal(bIndepAfter.monthlyFeeSar, 0);
    assert.equal(bIndepAfter.exemptionSource, 'branch');

    const pricingAfter = evaluateOrganizationBranchPricing({
      org: nonExemptOrg,
      branches: [orgInheritedOnlyBranch, independentlyExemptBranch],
      now: NOW,
    });
    assert.equal(pricingAfter.isFeeExempt, false);
    assert.equal(pricingAfter.exemptBranchesCount, 1);
    assert.equal(pricingAfter.billableBranchesCount, 1);
    assert.equal(pricingAfter.estimatedMonthlyBranchTotalSar, 50);
  });

  // 8. Zero loss of historical subscription, setup, reactivation, or invoice fields
  test('8. Granting and revoking billing_exempt or legacy_unrestricted preserves 100% of historical subscription fields', () => {
    const beforeOrg = makePaidOrg({
      subscriptionPlan: '6m',
      subscriptionStatus: 'expired',
      subscriptionStartAt: PAST_30D,
      subscriptionEndAt: PAST_2D,
      subscriptionNote: 'سجل فاتورة #INV-2026-014',
      accountSetupFeeSar: 80,
      setupFeeStatus: 'paid',
      setupFeePaidAt: PAST_30D,
      reactivationFeeSar: 10,
      reactivationFeeStatus: 'paid',
      reactivationFeePaidAt: PAST_2D,
    });

    const afterGrant: Organization = {
      ...beforeOrg,
      ...buildNonDestructiveOrgExemptionPatch({
        org: beforeOrg,
        mode: 'legacy_unrestricted',
        reason: 'منح legacy_unrestricted مع الحفاظ التام على التاريخ',
        grantedBy: 'amoal2030@gmail.com',
        grantedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_hist_1',
      }),
    };
    const checkGrant = verifyHistoricalSubscriptionFieldsPreserved(beforeOrg, afterGrant);
    assert.equal(checkGrant.preserved, true);
    assert.deepEqual(checkGrant.mutatedFields, []);

    const afterRevoke: Organization = {
      ...afterGrant,
      ...buildNonDestructiveOrgExemptionRevokePatch({
        revokeReason: 'إلغاء الإعفاء',
        revokedBy: 'amoal2030@gmail.com',
        revokedAt: Timestamp.fromDate(NOW),
        auditLogId: 'plog_hist_2',
      }),
    };
    const checkRevoke = verifyHistoricalSubscriptionFieldsPreserved(beforeOrg, afterRevoke);
    assert.equal(checkRevoke.preserved, true);
    assert.deepEqual(checkRevoke.mutatedFields, []);

    // Confirm detector catches accidental mutation
    const mutatedOrg: Organization = { ...afterGrant, subscriptionPlan: undefined };
    const checkMutated = verifyHistoricalSubscriptionFieldsPreserved(beforeOrg, mutatedOrg);
    assert.equal(checkMutated.preserved, false);
    assert.ok(checkMutated.mutatedFields.includes('subscriptionPlan'));
  });

  // 9. Pre-grant eligibility verification checks all 7 criteria & email-based deterministic lookup
  test('9. Pre-grant verification validates orgId, ownerId, ownerEmail, user doc match, org status, branches, and history', () => {
    const org = makePaidOrg({
      id: 'org_verified_99',
      ownerId: 'uid_mgr_99',
      ownerEmail: '  Owner99@Gmail.COM ',
      subscriptionStatus: 'expired',
      subscriptionEndAt: PAST_2D,
    });
    const user = makeOwnerUser({
      uid: 'uid_mgr_99',
      orgId: 'org_verified_99',
      email: 'owner99@gmail.com',
      role: 'manager',
      isActive: true,
    });
    const branches = [
      makeBranch({ id: 'br_v1', orgId: 'org_verified_99', paymentStatus: 'overdue', monthlyFeeSar: 50 }),
      makeBranch({ id: 'br_v2', orgId: 'org_verified_99', paymentStatus: 'exempt', monthlyFeeSar: 0 }),
    ];

    // 9A: Valid org passes all checks
    const lookup = locateOrganizationsByOwnerEmail({
      ownerEmail: 'OWNER99@gmail.com',
      organizations: [org],
      users: [user],
      branches,
      targetMode: 'legacy_unrestricted',
      now: NOW,
    });
    assert.equal(lookup.queryEmailNormalized, 'owner99@gmail.com');
    assert.equal(lookup.ambiguousMultipleOrgs, false);
    assert.equal(lookup.matchedOrganizations.length, 1);

    const precheck = lookup.matchedOrganizations[0];
    assert.equal(precheck.eligible, true);
    assert.equal(precheck.blockingFailures.length, 0);
    assert.equal(precheck.checks.length, 7);
    assert.equal(precheck.orgId, 'org_verified_99');
    assert.equal(precheck.ownerId, 'uid_mgr_99');
    assert.equal(precheck.ownerEmailNormalized, 'owner99@gmail.com');
    assert.equal(precheck.branchesInventory.totalBranchesCount, 2);
    assert.equal(precheck.branchesInventory.individuallyExemptBranchesCount, 1);
    assert.equal(precheck.branchesInventory.billableBranchesCount, 1);
    assert.equal(precheck.branchesInventory.currentEstimatedMonthlyFeeSar, 50);
    assert.equal(precheck.branchesInventory.postExemptionMonthlyFeeSar, 0);
    assert.equal(precheck.historicalSnapshot.hasHistoricalFields, true);
    assert.equal(precheck.historicalSnapshot.willDeleteOrZeroHistoricalData, false);

    // 9B: Missing ownerId with pending invite fails closed
    const unboundOrg = makePaidOrg({ id: 'org_unbound', ownerId: '', ownerEmail: 'pending@example.com' });
    const pendingInvite: ManagerInvite = {
      id: 'pending@example.com',
      email: 'pending@example.com',
      emailNormalized: 'pending@example.com',
      orgId: 'org_unbound',
      role: 'manager',
      status: 'pending',
      createdAt: PAST_2D,
      createdBy: 'amoal2030@gmail.com',
      updatedAt: PAST_2D,
    };
    const unboundPrecheck = verifyOrganizationExemptionEligibility({
      org: unboundOrg,
      users: [],
      branches: [],
      managerInvites: [pendingInvite],
      now: NOW,
    });
    assert.equal(unboundPrecheck.eligible, false);
    assert.equal(unboundPrecheck.pendingInviteFound, true);
    assert.ok(unboundPrecheck.blockingFailures.some((f) => f.key === 'owner_id_bound'));
    assert.ok(unboundPrecheck.blockingFailures.some((f) => f.key === 'owner_user_doc_match'));

    // 9C: Mismatched user role or wrong orgId fails closed
    const badRoleUser = makeOwnerUser({
      uid: 'uid_mgr_99',
      orgId: 'org_verified_99',
      email: 'owner99@gmail.com',
      role: 'employee',
    });
    const roleMismatchCheck = verifyOrganizationExemptionEligibility({
      org,
      users: [badRoleUser],
      branches,
      now: NOW,
    });
    assert.equal(roleMismatchCheck.eligible, false);
    assert.ok(roleMismatchCheck.blockingFailures.some((f) => f.key === 'owner_user_doc_match'));

    // 9D: Manually suspended org (isActive: false) blocks eligibility because manual suspension overrides exemption
    const suspendedOrg = { ...org, isActive: false, deactivationReason: 'manual_suspension' as const };
    const suspendedCheck = verifyOrganizationExemptionEligibility({
      org: suspendedOrg,
      users: [user],
      branches,
      now: NOW,
    });
    assert.equal(suspendedCheck.eligible, false);
    assert.ok(suspendedCheck.blockingFailures.some((f) => f.key === 'org_status_eligible'));

    // 9E: Branch exemption precheck blocks cross-org branch & purged branch
    const foreignBranch = makeBranch({ id: 'br_foreign', orgId: 'other_org' });
    assert.equal(
      verifyBranchExemptionEligibility({ branch: foreignBranch, org, now: NOW }).eligible,
      false
    );
    const purgedBranch = makeBranch({
      id: 'br_purged',
      orgId: org.id,
      isActive: false,
      lifecycleStatus: 'purged_from_db',
    });
    assert.equal(
      verifyBranchExemptionEligibility({ branch: purgedBranch, org, now: NOW }).eligible,
      false
    );
    const validBranchCheck = verifyBranchExemptionEligibility({
      branch: branches[0],
      org,
      now: NOW,
    });
    assert.equal(validBranchCheck.eligible, true);
    assert.equal(validBranchCheck.preservesHistoricalPaymentFields, true);
    assert.equal(validBranchCheck.postExemptionMonthlyFeeSar, 0);
  });

  console.log(`\n========================================================================`);
  console.log(`   ALL ${passed}/${passed} PHASE A EXEMPTION & BRANCH PRICING TESTS PASSED.`);
  console.log(`========================================================================`);
}

runTests();
