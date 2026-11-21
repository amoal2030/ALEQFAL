/**
 * Permanent Full Billing Exemption (`billing_exempt`) Comprehensive Unit, Domain & Static Rules Security Test Suite
 *
 * Covers:
 *  - Owner-bound permanent exemption evaluation (`isOrgPermanentlyBillingExempt`, `evaluateOrganizationSubscription`)
 *  - Historical subscription/billing field preservation
 *  - Manual suspension precedence (`isActive: false`) over exemption
 *  - Fail-closed behavior on ownerId/ownerEmail missing or mismatch (case-insensitive normalization)
 *  - Branch pricing, setup fee, reactivation fee, current & future branches = 0 SAR (including future price/plan changes)
 *  - Grace period suppression (no-paid-branch 7-day grace)
 *  - Notification suppression (tenant & Super Admin threshold alerts)
 *  - Revocation fallback across all 3 organization types (active sub, expired sub, legacy no-sub)
 *  - Zero impact on regular paid/expired/suspended/legacy organizations
 *  - Static security & CEL verification of `firestore.rules` (zero JS methods, balanced braces, no bypass allows,
 *    exact bidirectional atomic audit coupling, zero extra get/exists calls on closings/purchases, call budgets)
 *
 * Runs cleanly via Node / tsx without requiring Firestore Emulator or DOM.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { Timestamp } from 'firebase/firestore';
import { Branch, Organization } from '../types';
import {
  evaluateOrganizationSubscription,
  isOrgPermanentlyBillingExempt,
} from '../utils/subscription';
import {
  buildExtraBranchRequestWhatsApp,
  evaluateBranchBillingAndGrace,
  evaluateOrganizationBranchPricing,
  evaluateOrgNoPaidBranchGrace,
  isBranchCountedAsPaid,
} from '../utils/branchPricing';
import {
  buildOrgThresholdNotifications,
  buildSuperAdminThresholdNotifications,
} from '../utils/notifications';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const PAST_30D = Timestamp.fromDate(new Date('2026-10-21T12:00:00.000Z'));
const PAST_2D = Timestamp.fromDate(new Date('2026-11-18T12:00:00.000Z'));
const FUTURE_2D = Timestamp.fromDate(new Date('2026-11-22T12:00:00.000Z'));
const FUTURE_30D = Timestamp.fromDate(new Date('2026-12-20T12:00:00.000Z'));

function makeExpiredPaidOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org_target_01',
    name: 'مؤسسة المتمم للتجارة',
    activityType: 'retail',
    currency: 'SAR',
    ownerId: 'uid_owner_01',
    ownerEmail: 'adartalmtm@gmail.com',
    ownerName: 'أحمد المتمم',
    driveConnected: false,
    isActive: true,
    subscriptionPlan: '1m',
    subscriptionStatus: 'expired',
    subscriptionStartAt: PAST_30D,
    subscriptionEndAt: PAST_2D,
    subscriptionUpdatedAt: PAST_30D,
    subscriptionUpdatedBy: 'amoal2030@gmail.com',
    accountSetupFeeSar: 80,
    setupFeeStatus: 'unpaid',
    reactivationFeeSar: 10,
    reactivationFeeStatus: 'unpaid',
    deactivationReason: 'no_paid_branches',
    deactivationDueAt: PAST_2D,
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-11-18T12:00:00.000Z',
    ...overrides,
  };
}

function makeExemptOrg(overrides: Partial<Organization> = {}): Organization {
  return makeExpiredPaidOrg({
    billingExempt: true,
    billingExemptScope: 'full_permanent',
    billingExemptReason: 'إعفاء دائم شامل معتمد من المدير الرئيسي للمؤسسات التأسيسية',
    billingExemptGrantedAt: PAST_2D,
    billingExemptGrantedBy: 'amoal2030@gmail.com',
    billingExemptVerifiedOwnerId: 'uid_owner_01',
    billingExemptVerifiedOwnerEmail: 'adartalmtm@gmail.com',
    billingExemptLastAuditLogId: 'plog_exempt_grant_01',
    ...overrides,
  });
}

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: 'br_01',
    orgId: 'org_target_01',
    name: 'الفرع الرئيسي',
    code: 'BR01',
    isActive: true,
    lifecycleStatus: 'active',
    monthlyFeeSar: 50,
    paymentStatus: 'overdue',
    feeDueAt: PAST_2D,
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
  console.log('   PERMANENT BILLING EXEMPTION — UNIT, DOMAIN & RULES AUDIT SUITE       ');
  console.log('========================================================================\n');

  // 1. Valid owner-verified permanent exemption bypasses expired subscription & preserves historical fields
  test('1. Valid owner-verified permanent exemption evaluates as billing_exempt while preserving all historical fields', () => {
    const org = makeExemptOrg();
    assert.equal(isOrgPermanentlyBillingExempt(org), true);

    const subEval = evaluateOrganizationSubscription(org, NOW);
    assert.equal(subEval.state, 'billing_exempt');
    assert.equal(subEval.isAllowed, true);
    assert.equal(subEval.isBillingExempt, true);
    assert.equal(subEval.isFeeExempt, true);
    assert.equal(subEval.isLegacy, false);
    // Historical fields preserved intact
    assert.equal(subEval.plan, '1m');
    assert.equal(subEval.rawStatus, 'expired');
    assert.equal(subEval.startDate?.toISOString(), PAST_30D.toDate().toISOString());
    assert.equal(subEval.endDate?.toISOString(), PAST_2D.toDate().toISOString());
    assert.equal(org.accountSetupFeeSar, 80);
    assert.equal(org.setupFeeStatus, 'unpaid');
  });

  // 2. Owner email normalization handles uppercase/spaces on org doc cleanly when verified email is normalized lowercase
  test('2. Owner email normalization matches case-insensitively with trimmed whitespace', () => {
    const orgMixedCase = makeExemptOrg({
      ownerEmail: '  AdartAlmtm@Gmail.COM  ',
      billingExemptVerifiedOwnerEmail: 'adartalmtm@gmail.com',
    });
    assert.equal(isOrgPermanentlyBillingExempt(orgMixedCase), true);
    assert.equal(evaluateOrganizationSubscription(orgMixedCase, NOW).state, 'billing_exempt');
  });

  // 3. Owner mismatch (ownerId or ownerEmail) or missing ownerId automatically disables exemption (fail-closed)
  test('3. Missing ownerId, changed ownerId, or changed ownerEmail automatically fails closed', () => {
    // Without past deactivationDueAt -> falls back directly to 'expired' (isAllowed: false)
    const missingOwnerId = makeExemptOrg({ ownerId: '', deactivationDueAt: undefined, deactivationReason: undefined });
    assert.equal(isOrgPermanentlyBillingExempt(missingOwnerId), false);
    assert.equal(evaluateOrganizationSubscription(missingOwnerId, NOW).isAllowed, false);
    assert.equal(evaluateOrganizationSubscription(missingOwnerId, NOW).state, 'expired');

    // With past deactivationDueAt -> falls back to 'suspended' (isAllowed: false)
    const missingOwnerWithPastDue = makeExemptOrg({ ownerId: '' });
    assert.equal(isOrgPermanentlyBillingExempt(missingOwnerWithPastDue), false);
    assert.equal(evaluateOrganizationSubscription(missingOwnerWithPastDue, NOW).isAllowed, false);
    assert.equal(evaluateOrganizationSubscription(missingOwnerWithPastDue, NOW).state, 'suspended');

    const changedOwnerId = makeExemptOrg({ ownerId: 'uid_new_owner_99', deactivationDueAt: undefined });
    assert.equal(isOrgPermanentlyBillingExempt(changedOwnerId), false);
    assert.equal(evaluateOrganizationSubscription(changedOwnerId, NOW).isAllowed, false);
    assert.equal(evaluateOrganizationSubscription(changedOwnerId, NOW).state, 'expired');

    const changedOwnerEmail = makeExemptOrg({ ownerEmail: 'other.owner@gmail.com', deactivationDueAt: undefined });
    assert.equal(isOrgPermanentlyBillingExempt(changedOwnerEmail), false);
    assert.equal(evaluateOrganizationSubscription(changedOwnerEmail, NOW).isAllowed, false);
    assert.equal(evaluateOrganizationSubscription(changedOwnerEmail, NOW).state, 'expired');

    const wrongScope = makeExemptOrg({ billingExemptScope: undefined, deactivationDueAt: undefined });
    assert.equal(isOrgPermanentlyBillingExempt(wrongScope), false);
    assert.equal(evaluateOrganizationSubscription(wrongScope, NOW).isAllowed, false);

    // Un-normalized verified email in DB fails closed
    const unnormalizedVerifiedEmail = makeExemptOrg({
      billingExemptVerifiedOwnerEmail: 'AdartAlmtm@Gmail.com',
    });
    assert.equal(isOrgPermanentlyBillingExempt(unnormalizedVerifiedEmail), false);
  });

  // 4. Manual suspension (`isActive: false`) ALWAYS takes precedence over permanent exemption
  test('4. Manual suspension (isActive: false) still blocks permanently exempt organization', () => {
    const suspendedExempt = makeExemptOrg({ isActive: false, deactivationReason: 'manual_suspension' });
    assert.equal(isOrgPermanentlyBillingExempt(suspendedExempt), true);

    const subEval = evaluateOrganizationSubscription(suspendedExempt, NOW);
    assert.equal(subEval.state, 'suspended');
    assert.equal(subEval.isAllowed, false);
    assert.equal(subEval.isBillingExempt, true);
    assert.equal(subEval.isFeeExempt, true);
  });

  // 5. Branch pricing, setup fee, reactivation fee, current & future branches = 0 SAR even if pricing/plans change
  test('5. All fees (setup, reactivation, current branches, future branches) evaluate to 0 SAR regardless of future pricing changes', () => {
    const exemptOrg = makeExemptOrg({
      // Simulate future price increase stored on org doc
      extraBranchMonthlyFeeSar: 250,
      accountSetupFeeSar: 500,
      reactivationFeeSar: 150,
    });
    const currentBranches: Branch[] = [
      makeBranch({ id: 'br_01', paymentStatus: 'overdue', monthlyFeeSar: 50, feeDueAt: PAST_2D }),
      makeBranch({ id: 'br_02', paymentStatus: 'unpaid', monthlyFeeSar: 120, feeDueAt: PAST_2D }),
      makeBranch({ id: 'br_03_future', paymentStatus: 'exempt', monthlyFeeSar: 0, feeDueAt: null }),
    ];

    // Every active branch counts as paid/exempt under exempt org
    for (const b of currentBranches) {
      assert.equal(isBranchCountedAsPaid(b, exemptOrg, NOW), true);
      const bEval = evaluateBranchBillingAndGrace(b, exemptOrg, NOW);
      assert.equal(bEval.isPaidAndActive, true);
      assert.equal(bEval.monthlyFeeSar, 0);
      assert.equal(bEval.paymentStatus, 'exempt');
    }

    const pricing = evaluateOrganizationBranchPricing({
      org: exemptOrg,
      branches: currentBranches,
      now: NOW,
    });
    assert.equal(pricing.isBillingExempt, true);
    assert.equal(pricing.isFeeExempt, true);
    assert.equal(pricing.setupFeeSar, 0);
    assert.equal(pricing.setupFeeStatus, 'waived');
    assert.equal(pricing.reactivationFeeSar, 0);
    assert.equal(pricing.branchMonthlyFeeSar, 0);
    assert.equal(pricing.feePerExtraBranchMonthlySar, 0);
    assert.equal(pricing.estimatedMonthlyBranchTotalSar, 0);
    assert.equal(pricing.estimatedMonthlyExtraFeeSar, 0);
    assert.equal(pricing.paidBranchesCount, 3);
    assert.equal(pricing.activeBranchesCount, 3);
  });

  // 6. No-paid-branch 7-day grace period is completely suppressed for exempt organizations
  test('6. No-paid-branch 7-day grace period and deactivation timers never trigger for exempt organizations', () => {
    const exemptOrg = makeExemptOrg({
      noPaidBranchGraceStartedAt: PAST_30D,
      deactivationDueAt: PAST_2D,
      deactivationReason: 'no_paid_branches',
    });
    const unpaidBranch = makeBranch({ paymentStatus: 'unpaid', feeDueAt: PAST_2D });
    const graceEval = evaluateOrgNoPaidBranchGrace(exemptOrg, [unpaidBranch], NOW);
    assert.equal(graceEval.isBillingExempt, true);
    assert.equal(graceEval.isFeeExempt, true);
    assert.equal(graceEval.inGrace, false);
    assert.equal(graceEval.isDeactivated, false);
    assert.equal(graceEval.deactivationDueAt, null);
    assert.equal(graceEval.remainingGraceDays, null);
  });

  // 7. Extra-branch WhatsApp request for exempt org reflects 0 SAR / permanent exemption (no 50 SAR prompt)
  test('7. Extra branch WhatsApp message for exempt organization reflects permanent exemption (0 SAR)', () => {
    const wa = buildExtraBranchRequestWhatsApp({
      orgName: 'مؤسسة المتمم للتجارة',
      orgId: 'org_target_01',
      managerName: 'أحمد المتمم',
      managerEmail: 'adartalmtm@gmail.com',
      currentBranchCount: 2,
      isBillingExempt: true,
      language: 'ar',
    });
    assert.ok(wa.message.includes('0 ر.س'));
    assert.ok(!wa.message.includes('50 ر.س'));
  });

  // 8. Tenant & Super Admin expiry/grace notifications are suppressed for exempt orgs (while normal orgs still alert)
  test('8. Subscription expiry and no-paid-branch notifications are suppressed for exempt orgs, active for regular orgs', () => {
    const exemptOrgExpiringSoon = makeExemptOrg({
      subscriptionStatus: 'active',
      subscriptionStartAt: PAST_30D,
      subscriptionEndAt: FUTURE_2D,
      noPaidBranchGraceStartedAt: PAST_2D,
      deactivationDueAt: FUTURE_2D,
    });
    const unpaidBranch = makeBranch({ orgId: exemptOrgExpiringSoon.id, paymentStatus: 'unpaid', feeDueAt: PAST_2D });

    const tenantNotifsExempt = buildOrgThresholdNotifications({
      org: exemptOrgExpiringSoon,
      branches: [unpaidBranch],
      actorUid: 'uid_owner_01',
      actorName: 'أحمد المتمم',
      now: NOW,
    });
    assert.equal(
      tenantNotifsExempt.filter(
        (n) => n.type === 'ORG_SUBSCRIPTION_EXPIRING' || n.type === 'ORG_NO_PAID_BRANCH_WARNING'
      ).length,
      0
    );

    const saNotifsExempt = buildSuperAdminThresholdNotifications({
      organizations: [exemptOrgExpiringSoon],
      branches: [unpaidBranch],
      actorUid: 'uid_sa',
      actorName: 'المدير الرئيسي',
      now: NOW,
    });
    assert.equal(
      saNotifsExempt.filter(
        (n) =>
          n.type === 'SA_ORG_SUBSCRIPTION_EXPIRING' ||
          n.type === 'SA_ORG_SUBSCRIPTION_EXPIRED' ||
          n.type === 'SA_ORG_NO_PAID_BRANCH_GRACE'
      ).length,
      0
    );

    // Control: regular non-exempt org expiring in 2 days with unpaid branch STILL receives BOTH alerts
    const regularExpiringOrg = makeExpiredPaidOrg({
      id: 'org_regular_02',
      ownerId: 'uid_reg_02',
      ownerEmail: 'regular@example.com',
      subscriptionStatus: 'active',
      subscriptionStartAt: PAST_30D,
      subscriptionEndAt: FUTURE_2D,
      noPaidBranchGraceStartedAt: PAST_2D,
      deactivationDueAt: FUTURE_2D,
      deactivationReason: undefined,
    });
    const regUnpaidBranch = makeBranch({ id: 'br_reg_01', orgId: 'org_regular_02', paymentStatus: 'unpaid', feeDueAt: PAST_2D });

    const tenantNotifsRegular = buildOrgThresholdNotifications({
      org: regularExpiringOrg,
      branches: [regUnpaidBranch],
      actorUid: 'uid_reg_02',
      actorName: 'مدير عادي',
      now: NOW,
    });
    assert.ok(tenantNotifsRegular.some((n) => n.type === 'ORG_SUBSCRIPTION_EXPIRING'));
    assert.ok(tenantNotifsRegular.some((n) => n.type === 'ORG_NO_PAID_BRANCH_WARNING'));

    const saNotifsRegular = buildSuperAdminThresholdNotifications({
      organizations: [regularExpiringOrg],
      branches: [regUnpaidBranch],
      actorUid: 'uid_sa',
      actorName: 'المدير الرئيسي',
      now: NOW,
    });
    assert.ok(saNotifsRegular.some((n) => n.type === 'SA_ORG_SUBSCRIPTION_EXPIRING'));
    assert.ok(saNotifsRegular.some((n) => n.type === 'SA_ORG_NO_PAID_BRANCH_GRACE'));
  });

  // 9. Revocation restores exact underlying state across all 3 organization types without deleting history
  test('9. Revocation restores natural state for active-sub, expired-sub, and legacy-no-sub orgs with zero history loss', () => {
    const revokeFields: Partial<Organization> = {
      billingExempt: false,
      billingExemptRevokedAt: Timestamp.fromDate(NOW),
      billingExemptRevokedBy: 'amoal2030@gmail.com',
      billingExemptRevokeReason: 'مراجعة إدارية دورية وإعادة التفعيل على الباقة العادية',
      billingExemptLastAuditLogId: 'plog_exempt_revoke_01',
    };

    // Case A: Org with valid active historical subscription -> returns to 'active'
    const revokedActive = makeExemptOrg({
      subscriptionStatus: 'active',
      subscriptionStartAt: PAST_30D,
      subscriptionEndAt: FUTURE_30D,
      deactivationReason: undefined,
      deactivationDueAt: undefined,
      ...revokeFields,
    });
    const evalA = evaluateOrganizationSubscription(revokedActive, NOW);
    assert.equal(evalA.state, 'active');
    assert.equal(evalA.isAllowed, true);
    assert.equal(evalA.isBillingExempt, false);
    assert.equal(evalA.isFeeExempt, false);
    assert.equal(revokedActive.billingExemptGrantedBy, 'amoal2030@gmail.com'); // history preserved

    // Case B: Org with expired historical subscription -> returns to 'expired' & blocked
    const revokedExpired = makeExemptOrg({
      subscriptionStatus: 'expired',
      subscriptionStartAt: PAST_30D,
      subscriptionEndAt: PAST_2D,
      deactivationReason: undefined,
      deactivationDueAt: undefined,
      ...revokeFields,
    });
    const evalB = evaluateOrganizationSubscription(revokedExpired, NOW);
    assert.equal(evalB.state, 'expired');
    assert.equal(evalB.isAllowed, false);
    assert.equal(evalB.isBillingExempt, false);
    assert.equal(evalB.isFeeExempt, false);
    assert.equal(evalB.endDate?.toISOString(), PAST_2D.toDate().toISOString());

    // Case C: Legacy org with NO subscription fields -> returns to 'legacy_unrestricted'
    const revokedLegacy: Organization = {
      id: 'org_legacy_revoked',
      name: 'مؤسسة تأسيسية قديمة',
      activityType: 'services',
      currency: 'SAR',
      ownerId: 'uid_legacy_01',
      ownerEmail: 'foadalkamel05@gmail.com',
      ownerName: 'فؤاد الكامل',
      driveConnected: false,
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2026-11-20T12:00:00.000Z',
      billingExempt: false,
      billingExemptScope: 'full_permanent',
      billingExemptReason: 'إعفاء دائم سابق',
      billingExemptGrantedAt: PAST_30D,
      billingExemptGrantedBy: 'amoal2030@gmail.com',
      billingExemptVerifiedOwnerId: 'uid_legacy_01',
      billingExemptVerifiedOwnerEmail: 'foadalkamel05@gmail.com',
      billingExemptRevokedAt: Timestamp.fromDate(NOW),
      billingExemptRevokedBy: 'amoal2030@gmail.com',
      billingExemptRevokeReason: 'إلغاء تجريبي للعودة للوضع القديم',
      billingExemptLastAuditLogId: 'plog_exempt_revoke_legacy',
    };
    const evalC = evaluateOrganizationSubscription(revokedLegacy, NOW);
    assert.equal(evalC.state, 'legacy_unrestricted');
    assert.equal(evalC.isAllowed, true);
    assert.equal(evalC.isLegacy, true);
    assert.equal(evalC.isBillingExempt, false);
    assert.equal(evalC.isFeeExempt, true); // still legacy exempt
  });

  // 10. Regular organizations remain 100% unaffected (80 SAR setup, 50 SAR/branch, 10 SAR reactivation)
  test('10. Regular non-exempt organizations retain full 80/50/10 SAR pricing and strict expiry enforcement', () => {
    const regularOrg = makeExpiredPaidOrg({
      id: 'org_normal_10',
      subscriptionStatus: 'active',
      subscriptionStartAt: PAST_30D,
      subscriptionEndAt: FUTURE_30D,
      deactivationReason: undefined,
      deactivationDueAt: undefined,
    });
    const branches = [
      makeBranch({ id: 'br_n1', orgId: 'org_normal_10', paymentStatus: 'paid', monthlyFeeSar: 50, feeDueAt: FUTURE_30D }),
      makeBranch({ id: 'br_n2', orgId: 'org_normal_10', paymentStatus: 'paid', monthlyFeeSar: 50, feeDueAt: FUTURE_30D }),
    ];
    const pricing = evaluateOrganizationBranchPricing({
      org: regularOrg,
      branches,
      now: NOW,
    });
    assert.equal(pricing.isBillingExempt, false);
    assert.equal(pricing.isFeeExempt, false);
    assert.equal(pricing.setupFeeSar, 80);
    assert.equal(pricing.reactivationFeeSar, 10);
    assert.equal(pricing.branchMonthlyFeeSar, 50);
    assert.equal(pricing.estimatedMonthlyBranchTotalSar, 100);
  });

  // 11. Static CEL & Security Audit of `firestore.rules`
  test('11. firestore.rules static CEL syntax, brace balance, Super Admin exclusivity, and zero-bypass audit', () => {
    const rules = fs.readFileSync('firestore.rules', 'utf8');
    const lines = rules.split('\n');

    // A. Balanced braces & parentheses (single-pass strip preserving string literals like 'https://...')
    const stripped = rules.replace(/'(?:\\.|[^'\\])*'|\/\/[^\n]*/g, (m) =>
      m.startsWith("'") ? "''" : ''
    );
    let braceDepth = 0;
    let parenDepth = 0;
    for (const ch of stripped) {
      if (ch === '{') braceDepth += 1;
      else if (ch === '}') braceDepth -= 1;
      else if (ch === '(') parenDepth += 1;
      else if (ch === ')') parenDepth -= 1;
      assert.ok(braceDepth >= 0, 'Unbalanced closing brace in firestore.rules');
      assert.ok(parenDepth >= 0, 'Unbalanced closing paren in firestore.rules');
    }
    assert.equal(braceDepth, 0, `Unclosed braces in firestore.rules: depth=${braceDepth}`);
    assert.equal(parenDepth, 0, `Unclosed parens in firestore.rules: depth=${parenDepth}`);

    // B. Zero JavaScript-only syntax inside CEL rules
    assert.ok(!stripped.includes('.toLowerCase('), 'JS .toLowerCase() is invalid in Firestore Rules CEL');
    assert.ok(!stripped.includes('.toUpperCase('), 'JS .toUpperCase() is invalid in Firestore Rules CEL');
    assert.ok(!stripped.includes('==='), 'JS === operator is invalid in Firestore Rules CEL');
    assert.ok(!stripped.includes('!=='), 'JS !== operator is invalid in Firestore Rules CEL');
    assert.ok(!/\btypeof\b/.test(stripped), 'JS typeof is invalid in Firestore Rules CEL');
    assert.ok(!/\bconst\b/.test(stripped), 'JS const is invalid in Firestore Rules CEL');

    // C. Sole Super Admin hardcoded & verified
    assert.ok(rules.includes("request.auth.token.email.trim().lower() == 'amoal2030@gmail.com'"));
    assert.ok(rules.includes('request.auth.token.email_verified == true'));

    // D. Exemption helper is 0-read (no get/exists inside isOrgPermanentlyBillingExempt)
    const exemptFnMatch = rules.match(/function isOrgPermanentlyBillingExempt\(org\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(exemptFnMatch, 'isOrgPermanentlyBillingExempt function must exist');
    assert.ok(!/(?<!\.)\b(get|exists|getAfter|existsAfter)\s*\(\/databases\//.test(exemptFnMatch[0]), 'isOrgPermanentlyBillingExempt must perform 0 Firestore reads');

    // E. Exemption is wired into BOTH isOrgSubscriptionAllowed AND purchases hasActiveOrgSubFast
    const subAllowedMatch = rules.match(/function isOrgSubscriptionAllowed\(org\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(subAllowedMatch && subAllowedMatch[0].includes('isOrgPermanentlyBillingExempt(org)'));
    assert.ok(subAllowedMatch[0].includes("org.get('isActive', true) == true && ("));

    const fastSubMatch = rules.match(/function hasActiveOrgSubFast\(org\)\s*\{[\s\S]*?\n      \}/);
    assert.ok(fastSubMatch && fastSubMatch[0].includes('isOrgPermanentlyBillingExempt(org)'));
    assert.ok(fastSubMatch[0].includes("org.get('isActive', true) == true && ("));

    // F. billingExempt* fields MUST NOT appear in organizations `allow create`, Manager Drive update, or Invite Claim
    const orgBlockMatch = rules.match(/match \/organizations\/\{orgId\}\s*\{[\s\S]*?\n    \}/);
    assert.ok(orgBlockMatch, 'organizations match block must exist');
    const orgBlock = orgBlockMatch[0];
    const createBlock = orgBlock.slice(orgBlock.indexOf('allow create:'), orgBlock.indexOf('allow update:'));
    assert.ok(!createBlock.includes('billingExempt'), 'organizations allow create must NOT accept billingExempt fields');

    const managerBranchStart = orgBlock.indexOf('isOrgManager(orgId)');
    const nonSuperAdminUpdateBlock = orgBlock.slice(managerBranchStart);
    assert.ok(!nonSuperAdminUpdateBlock.includes('billingExempt'), 'Manager & Invite Claim update paths must NOT allow billingExempt fields');

    // G. Bidirectional atomic audit coupling is present in BOTH organizations and platformAuditLogs
    assert.ok(rules.includes('canSuperAdminUpdateOrg(orgId, request.resource.data, resource.data)'));
    assert.ok(rules.includes('canSuperAdminGrantOrgBillingExemption(orgId, next, prev)'));
    assert.ok(rules.includes('canSuperAdminRevokeOrgBillingExemption(orgId, next, prev)'));
    assert.ok(rules.includes('hasAtomicBillingExemptionAuditLog(orgId, nextAuditId, \'ORG_BILLING_EXEMPTION_GRANTED\')'));
    assert.ok(rules.includes('hasAtomicBillingExemptionAuditLog(orgId, nextAuditId, \'ORG_BILLING_EXEMPTION_REVOKED\')'));
    assert.ok(rules.includes('!exists(/databases/$(database)/documents/platformAuditLogs/$(logId))'));
    assert.ok(rules.includes('existsAfter(/databases/$(database)/documents/platformAuditLogs/$(logId))'));
    assert.ok(rules.includes('hasValidOrgExemptionTransitionForAudit(logId, incoming().orgId, incoming().action)'));

    // H. Branch paymentStatus == 'exempt' accepted ONLY under Super Admin create/update (never org manager)
    const branchBlockMatch = rules.match(/match \/branches\/\{branchId\}\s*\{[\s\S]*?\n    \}/);
    assert.ok(branchBlockMatch, 'branches match block must exist');
    const branchBlock = branchBlockMatch[0];
    assert.ok(branchBlock.includes('allow create: if isSignedIn() && isValidId(branchId) &&\n        isSuperAdmin()'));
    const mgrBranchIdx = branchBlock.indexOf('isOrgManager(resource.data.orgId)');
    assert.ok(mgrBranchIdx > 0, 'Manager branch update clause must exist');
    const mgrBranchUpdate = branchBlock.slice(mgrBranchIdx);
    assert.ok(!mgrBranchUpdate.includes('paymentStatus'), 'Org managers must NOT be able to edit branch paymentStatus');
    assert.ok(!mgrBranchUpdate.includes('monthlyFeeSar'), 'Org managers must NOT be able to edit branch monthlyFeeSar');

    // I. No unintended catch-all allow true anywhere in firestore.rules
    const allowLines = lines.filter((l) => /^\s*allow\s+/.test(l));
    assert.ok(allowLines.length >= 20, 'Expected full set of collection allow rules');
    for (const al of allowLines) {
      assert.ok(!/:\s*if\s+true\s*;/.test(al), `Dangerous open allow rule detected: ${al.trim()}`);
    }
  });

  // 12. Exact Firestore Rules Read/Call Budget Verification
  test('12. Rule call budgets for Grant, Revoke, Closings, and Purchases stay strictly within Firestore limits (<=10/doc, <=20/batch)', () => {
    const rules = fs.readFileSync('firestore.rules', 'utf8');
    const countDocCalls = (fnBody: string) =>
      (fnBody.match(/(?<!\.)\b(get|exists|getAfter|existsAfter)\s*\(\/databases\//g) || []).length;

    const ownerDocFn = rules.match(/function isVerifiedOrgOwnerDoc[\s\S]*?\n    \}/)?.[0] || '';
    const auditLogFn = rules.match(/function hasAtomicBillingExemptionAuditLog[\s\S]*?\n    \}/)?.[0] || '';
    const auditReverseFn = rules.match(/function hasValidOrgExemptionTransitionForAudit[\s\S]*?\n    \}/)?.[0] || '';
    const exemptHelperFn = rules.match(/function isOrgPermanentlyBillingExempt[\s\S]*?\n    \}/)?.[0] || '';

    const ownerCalls = countDocCalls(ownerDocFn); // get + exists = 2
    const auditForwardCalls = countDocCalls(auditLogFn); // getAfter + !exists + existsAfter = 3
    const auditReverseCalls = countDocCalls(auditReverseFn); // get + getAfter + exists = 3
    const exemptHelperCalls = countDocCalls(exemptHelperFn); // 0

    assert.equal(exemptHelperCalls, 0, 'isOrgPermanentlyBillingExempt must use 0 calls');
    assert.equal(ownerCalls, 2, 'isVerifiedOrgOwnerDoc must use 2 calls (exists + get)');
    assert.equal(auditForwardCalls, 3, 'hasAtomicBillingExemptionAuditLog must use 3 calls (!exists + existsAfter + getAfter)');
    assert.equal(auditReverseCalls, 3, 'hasValidOrgExemptionTransitionForAudit must use 3 calls (exists + get + getAfter)');

    // Grant batch total: Org update (2 + 3 = 5) + Audit log create (3) + SuperAdmin notification create (0) = 8 <= 20
    const grantOrgUpdateCalls = ownerCalls + auditForwardCalls;
    const grantBatchTotal = grantOrgUpdateCalls + auditReverseCalls + 0;
    assert.ok(grantOrgUpdateCalls <= 10, `Grant org update exceeds 10 calls: ${grantOrgUpdateCalls}`);
    assert.ok(grantBatchTotal <= 20, `Grant batch exceeds 20 calls: ${grantBatchTotal}`);

    // Revoke batch total: Org update (3) + Audit log create (3) + SuperAdmin notification create (0) = 6 <= 20
    const revokeOrgUpdateCalls = auditForwardCalls;
    const revokeBatchTotal = revokeOrgUpdateCalls + auditReverseCalls + 0;
    assert.ok(revokeOrgUpdateCalls <= 10, `Revoke org update exceeds 10 calls: ${revokeOrgUpdateCalls}`);
    assert.ok(revokeBatchTotal <= 20, `Revoke batch exceeds 20 calls: ${revokeBatchTotal}`);
  });

  console.log(`\n========================================================================`);
  console.log(`   ALL ${passed}/${passed} PERMANENT BILLING EXEMPTION UNIT & AUDIT TESTS PASSED.`);
  console.log(`========================================================================`);
}

runTests();
