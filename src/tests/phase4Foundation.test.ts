/**
 * Phase 4.1 Unit Test Suite: Extra Branch Pricing Clarity Model & 4-Role RBAC Permissions
 */
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import { Branch, Organization, UserProfile } from '../types';
import {
  ACCOUNT_SETUP_FEE_SAR,
  BRANCH_MONTHLY_FEE_SAR,
  BRANCH_PRICING_MODEL,
  BRANCH_SUSPENSION_GRACE_DAYS,
  buildExtraBranchRequestWhatsApp,
  buildReactivationSubscriptionWhatsApp,
  DEFAULT_INCLUDED_BRANCHES_COUNT,
  evaluateBranchBillingAndGrace,
  evaluateOrganizationBranchPricing,
  evaluateOrgNoPaidBranchGrace,
  EXTRA_BRANCH_MONTHLY_FEE_SAR,
  isBranchCountedAsPaid,
  NEW_ORG_INCLUDED_BRANCHES_COUNT,
  NO_PAID_BRANCH_GRACE_DAYS,
  ORG_REACTIVATION_FEE_SAR,
  verifyBranchDriveBackupCompleteness,
} from '../utils/branchPricing';
import {
  buildDefaultPermissionsForRole,
  canUserAccessBranch,
  getUserRoleLabel,
  resolveEffectivePermissions,
  resolvePrimaryAssignedBranchId,
  resolveUserAssignedBranchIds,
  SUPERVISOR_OPTIONAL_PERMISSION_KEYS,
  validateRoleAssignmentInput,
} from '../utils/permissions';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function runTest(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`PASS: ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err?.message || String(err) });
    console.error(`FAIL: ${name} -> ${err?.message || err}`);
  }
}

const NOW = new Date('2026-11-15T12:00:00.000Z');
const PAST_2D = Timestamp.fromDate(new Date('2026-11-13T12:00:00.000Z'));
const PAST_35D = Timestamp.fromDate(new Date('2026-10-11T12:00:00.000Z'));
const PAST_5D = Timestamp.fromDate(new Date('2026-11-10T12:00:00.000Z'));
const FUTURE_5D = Timestamp.fromDate(new Date('2026-11-20T12:00:00.000Z'));
const FUTURE_30D = Timestamp.fromDate(new Date('2026-12-15T12:00:00.000Z'));

const managedOrg: Organization = {
  id: 'org_managed',
  name: 'شركة الآفاق',
  taxNumber: '310123456700003',
  commercialRegistration: '1010123456',
  activityType: 'retail',
  currency: 'SAR',
  ownerId: 'mgr_1',
  ownerEmail: 'mgr@afaq.com',
  ownerName: 'أحمد المدير',
  driveConnected: false,
  isActive: true,
  subscriptionPlan: '1m',
  subscriptionStatus: 'active',
  subscriptionStartAt: PAST_2D,
  subscriptionEndAt: FUTURE_30D,
  branchPricingModel: BRANCH_PRICING_MODEL,
  includedBranchesCount: 0,
  extraBranchMonthlyFeeSar: BRANCH_MONTHLY_FEE_SAR,
  accountSetupFeeSar: ACCOUNT_SETUP_FEE_SAR,
  setupFeeStatus: 'paid',
  reactivationFeeSar: ORG_REACTIVATION_FEE_SAR,
  createdAt: '2026-11-13T12:00:00.000Z',
  updatedAt: '2026-11-13T12:00:00.000Z',
};

const legacyOrg: Organization = {
  id: 'org_legacy',
  name: 'مؤسسة قديمة',
  activityType: 'retail',
  currency: 'SAR',
  ownerId: 'mgr_legacy',
  ownerEmail: 'legacy@old.com',
  ownerName: 'صالح القديم',
  driveConnected: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mkBranch = (
  id: string,
  isActive = true,
  extra: Partial<Branch> = {}
): Branch => ({
  id,
  orgId: 'org_managed',
  name: `فرع ${id}`,
  code: id.toUpperCase(),
  isActive,
  lifecycleStatus: isActive ? 'active' : 'suspended',
  paymentStatus: isActive ? 'paid' : 'unpaid',
  monthlyFeeSar: BRANCH_MONTHLY_FEE_SAR,
  feeDueAt: isActive ? FUTURE_30D : undefined,
  createdAt: '2026-11-13T12:00:00.000Z',
  ...extra,
});

console.log('====================================================================');
console.log('   PHASE 4.2 UNIT TESTS: 80/50/10 PRICING, GRACE & RBAC PERMISSIONS ');
console.log('====================================================================\n');

runTest('1. Phase 4.2 Constants match 80/50/10 SAR and 7d/30d grace specs', () => {
  assert.equal(ACCOUNT_SETUP_FEE_SAR, 80);
  assert.equal(BRANCH_MONTHLY_FEE_SAR, 50);
  assert.equal(EXTRA_BRANCH_MONTHLY_FEE_SAR, 50);
  assert.equal(ORG_REACTIVATION_FEE_SAR, 10);
  assert.equal(NEW_ORG_INCLUDED_BRANCHES_COUNT, 0);
  assert.equal(DEFAULT_INCLUDED_BRANCHES_COUNT, 0);
  assert.equal(BRANCH_PRICING_MODEL, 'per_branch_50_sar');
  assert.equal(BRANCH_SUSPENSION_GRACE_DAYS, 30);
  assert.equal(NO_PAID_BRANCH_GRACE_DAYS, 7);
});

runTest('2. First active branch on new managed org is 50 SAR/month (no auto billing), while explicit 1-included org calculates 0 extra', () => {
  const res = evaluateOrganizationBranchPricing({
    org: managedOrg,
    branches: [mkBranch('br_1')],
    now: NOW,
  });
  assert.equal(res.isLegacyExempt, false);
  assert.equal(res.setupFeeSar, 80);
  assert.equal(res.setupFeeStatus, 'paid');
  assert.equal(res.reactivationFeeSar, 10);
  assert.equal(res.includedBranchesCount, 0);
  assert.equal(res.activeBranchesCount, 1);
  assert.equal(res.paidBranchesCount, 1);
  assert.equal(res.extraBranchesCount, 1);
  assert.equal(res.estimatedMonthlyBranchTotalSar, 50);
  assert.equal(res.autoBillingEnabled, false);

  const grandfatheredRes = evaluateOrganizationBranchPricing({
    org: { ...managedOrg, includedBranchesCount: 1 },
    branches: [mkBranch('br_1')],
    now: NOW,
  });
  assert.equal(grandfatheredRes.includedBranchesCount, 1);
  assert.equal(grandfatheredRes.estimatedMonthlyExtraFeeSar, 0);
});

runTest('3. Multiple active branches calculate 50 SAR per active branch excluding suspended branches', () => {
  const res = evaluateOrganizationBranchPricing({
    org: managedOrg,
    branches: [
      mkBranch('br_1', true),
      mkBranch('br_2', true),
      mkBranch('br_3', true),
      mkBranch('br_4', false, { suspendedAt: PAST_5D, gracePeriodEndsAt: FUTURE_5D }),
    ],
    now: NOW,
  });
  assert.equal(res.totalBranchesCount, 4);
  assert.equal(res.activeBranchesCount, 3);
  assert.equal(res.paidBranchesCount, 3);
  assert.equal(res.suspendedBranchesCount, 1);
  assert.equal(res.extraBranchesCount, 3);
  assert.equal(res.estimatedMonthlyExtraFeeSar, 150);
  assert.equal(res.estimatedMonthlyBranchTotalSar, 150);
  assert.equal(res.autoBillingEnabled, false);
});

runTest('4. Legacy unrestricted org is strictly exempt (0 SAR setup/branch fees regardless of branch count)', () => {
  const res = evaluateOrganizationBranchPricing({
    org: legacyOrg,
    branches: [mkBranch('br_1'), mkBranch('br_2'), mkBranch('br_3'), mkBranch('br_4')],
    now: NOW,
  });
  assert.equal(res.isLegacyExempt, true);
  assert.equal(res.setupFeeSar, 0);
  assert.equal(res.setupFeeStatus, 'waived');
  assert.equal(res.feePerExtraBranchMonthlySar, 0);
  assert.equal(res.extraBranchesCount, 0);
  assert.equal(res.estimatedMonthlyExtraFeeSar, 0);
  assert.equal(res.autoBillingEnabled, false);
});

runTest('5. WhatsApp request & reactivation links encode 50 SAR branch rate, 10 SAR reactivation fee, or legacy exemption', () => {
  const managedLink = buildExtraBranchRequestWhatsApp({
    orgName: managedOrg.name,
    orgId: managedOrg.id,
    managerName: 'أحمد',
    managerEmail: 'mgr@afaq.com',
    currentBranchCount: 2,
    isLegacyExempt: false,
    language: 'ar',
  });
  assert.ok(managedLink.url.startsWith('https://wa.me/'));
  assert.ok(managedLink.message.includes('50 ريال سعودي'));

  const legacyLink = buildExtraBranchRequestWhatsApp({
    orgName: legacyOrg.name,
    orgId: legacyOrg.id,
    managerName: 'صالح',
    managerEmail: 'legacy@old.com',
    currentBranchCount: 3,
    isLegacyExempt: true,
    language: 'ar',
  });
  assert.ok(legacyLink.message.includes('معفاة'));
  assert.ok(!legacyLink.message.includes('50 ريال'));

  const reactivateLink = buildReactivationSubscriptionWhatsApp({
    orgName: managedOrg.name,
    orgId: managedOrg.id,
    managerName: 'أحمد',
    managerEmail: 'mgr@afaq.com',
    language: 'ar',
  });
  assert.ok(reactivateLink.url.startsWith('https://wa.me/'));
  assert.ok(reactivateLink.message.includes('10 ريال'));
  assert.ok(reactivateLink.message.includes('50 ريال'));
});

runTest('6. Supervisor has zero optional permissions enabled by default and is org-wide opt-in', () => {
  const defaults = buildDefaultPermissionsForRole('supervisor');
  for (const key of SUPERVISOR_OPTIONAL_PERMISSION_KEYS) {
    assert.equal(defaults[key], false, `Expected default ${key} to be false for supervisor`);
  }
  assert.equal(defaults.canManageBranches, false);
  assert.equal(defaults.canManageEmployees, false);

  const supervisorProfile: UserProfile = {
    uid: 'sup_1',
    orgId: 'org_managed',
    email: 'sup@afaq.com',
    displayName: 'مسؤول النظام',
    role: 'supervisor',
    isActive: true,
    permissions: defaults,
    createdAt: '2026-11-14T00:00:00Z',
  };
  const eff = resolveEffectivePermissions(supervisorProfile);
  assert.equal(eff.hasOrgWideBranchScope, true);
  assert.equal(eff.hasSingleBranchRestriction, false);
  assert.equal(eff.canCreateClosing, false);
  assert.equal(eff.canViewAllClosings, false);
  assert.equal(eff.canApproveClosings, false);
  assert.equal(eff.canManagePurchases, false);
  assert.equal(eff.canManageSuppliers, false);
  assert.equal(eff.canViewSuppliers, false);
  assert.equal(eff.canViewFinancialReports, false);
  assert.equal(eff.canExportReports, false);
  assert.equal(eff.canAdminCorrectClosings, false);
  assert.equal(eff.canManageOrgDrive, false);
  assert.equal(eff.canManageUsersAndRoles, false);
});

runTest('7. Supervisor opt-in grants requested operational permissions without leaking admin/branch powers', () => {
  const optedIn = buildDefaultPermissionsForRole('supervisor', {
    canViewAllClosings: true,
    canApproveClosings: true,
    canManagePurchases: true,
    canViewFinancialReports: true,
  });
  assert.equal(optedIn.canViewAllClosings, true);
  assert.equal(optedIn.canApproveClosings, true);
  assert.equal(optedIn.canManagePurchases, true);
  assert.equal(optedIn.canViewFinancialReports, true);
  assert.equal(optedIn.canExportReports, true); // coupled with financial reports
  assert.equal(optedIn.canManageSuppliers, false);
  assert.equal(optedIn.canCreateClosing, false);
  assert.equal(optedIn.canManageBranches, false);
  assert.equal(optedIn.canManageEmployees, false);

  const eff = resolveEffectivePermissions({
    role: 'supervisor',
    isActive: true,
    permissions: {
      ...optedIn,
      // Attempted spoofing in stored permissions map must still be stripped cleanly
      canManageBranches: true,
      canManageEmployees: true,
    },
  });
  assert.equal(eff.canManageBranches, false);
  assert.equal(eff.canManageEmployees, false);
  assert.equal(eff.canAdminCorrectClosings, false);
  assert.equal(eff.canManageOrgDrive, false);
  assert.equal(eff.canManageUsersAndRoles, false);
});

runTest('8. Branch Manager is strictly tied to 1 branch, can record closings & purchases, cannot add suppliers', () => {
  const defaults = buildDefaultPermissionsForRole('branch_manager');
  assert.equal(defaults.canCreateClosing, true);
  assert.equal(defaults.canManagePurchases, true);
  assert.equal(defaults.canViewSuppliers, true);
  assert.equal(defaults.canManageSuppliers, false);
  assert.equal(defaults.canApproveClosings, false);
  assert.equal(defaults.canViewAllClosings, false);
  assert.equal(defaults.canViewFinancialReports, false);
  assert.equal(defaults.canExportReports, false);
  assert.equal(defaults.canManageBranches, false);
  assert.equal(defaults.canManageEmployees, false);

  const validBranchMgr: UserProfile = {
    uid: 'bm_1',
    orgId: 'org_managed',
    email: 'bm@afaq.com',
    displayName: 'مسؤول الفرع 1',
    role: 'branch_manager',
    branchId: 'br_1',
    branchIds: ['br_1'],
    isActive: true,
    permissions: defaults,
    createdAt: '2026-11-14T00:00:00Z',
  };
  assert.equal(canUserAccessBranch(validBranchMgr, 'br_1'), true);
  assert.equal(canUserAccessBranch(validBranchMgr, 'br_2'), false);
  assert.equal(resolveEffectivePermissions(validBranchMgr).hasSingleBranchRestriction, true);

  // Ambiguous multi-branch assignment must fail closed
  const multiBranchSpoof: UserProfile = {
    ...validBranchMgr,
    branchIds: ['br_1', 'br_2'],
  };
  assert.equal(canUserAccessBranch(multiBranchSpoof, 'br_1'), false);
  assert.equal(resolveEffectivePermissions(multiBranchSpoof).canCreateClosing, false);
  assert.equal(resolveEffectivePermissions(multiBranchSpoof).canManagePurchases, false);
});

runTest('9. Legacy employee with scalar branchId only works cleanly without branchIds array', () => {
  const legacyEmployee: UserProfile = {
    uid: 'emp_legacy',
    orgId: 'org_legacy',
    email: 'emp@old.com',
    displayName: 'كاشير قديم',
    role: 'employee',
    branchId: 'br_old_1',
    isActive: true,
    permissions: {
      canCreateClosing: true,
      canViewAllClosings: false,
      canApproveClosings: false,
      canManageBranches: false,
      canManageEmployees: false,
      canExportReports: false,
    },
    createdAt: '2026-01-01T00:00:00Z',
  };
  assert.deepEqual(resolveUserAssignedBranchIds(legacyEmployee), ['br_old_1']);
  assert.equal(resolvePrimaryAssignedBranchId(legacyEmployee), 'br_old_1');
  assert.equal(canUserAccessBranch(legacyEmployee, 'br_old_1'), true);
  assert.equal(canUserAccessBranch(legacyEmployee, 'br_old_2'), false);

  const eff = resolveEffectivePermissions(legacyEmployee);
  assert.equal(eff.canCreateClosing, true);
  assert.equal(eff.canManagePurchases, false);
  assert.equal(eff.canViewSuppliers, false);
  assert.equal(eff.canApproveClosings, false);
});

runTest('10. Role assignment validation blocks non-managers and manager promotion', () => {
  const nonMgr = validateRoleAssignmentInput({
    actorRole: 'supervisor',
    targetRole: 'employee',
    branchId: 'br_1',
  });
  assert.equal(nonMgr.valid, false);

  const promoteToMgr = validateRoleAssignmentInput({
    actorRole: 'manager',
    targetRole: 'manager',
  });
  assert.equal(promoteToMgr.valid, false);

  const multiBranchMgr = validateRoleAssignmentInput({
    actorRole: 'manager',
    targetRole: 'branch_manager',
    branchId: 'br_1',
    branchIds: ['br_1', 'br_2'],
  });
  assert.equal(multiBranchMgr.valid, false);

  const validBM = validateRoleAssignmentInput({
    actorRole: 'manager',
    targetRole: 'branch_manager',
    branchId: 'br_1',
    branchIds: ['br_1'],
  });
  assert.equal(validBM.valid, true);
  if (validBM.valid) {
    assert.equal(validBM.assignedBranchId, 'br_1');
  }
});

runTest('11. Arabic/English role labels render accurately for all 4 roles', () => {
  assert.equal(getUserRoleLabel('manager', 'ar'), 'مدير المؤسسة');
  assert.equal(getUserRoleLabel('supervisor', 'ar'), 'مسؤول');
  assert.equal(getUserRoleLabel('branch_manager', 'ar'), 'مسؤول فرع');
  assert.equal(getUserRoleLabel('employee', 'ar'), 'موظف');
  assert.equal(getUserRoleLabel('branch_manager', 'en'), 'Branch Manager');
});

runTest('12. isBranchCountedAsPaid excludes suspended/unpaid/overdue branches and respects legacy exemption', () => {
  assert.equal(isBranchCountedAsPaid(mkBranch('br_paid', true, { paymentStatus: 'paid', feeDueAt: FUTURE_30D }), managedOrg, NOW), true);
  assert.equal(isBranchCountedAsPaid(mkBranch('br_unpaid', true, { paymentStatus: 'unpaid' }), managedOrg, NOW), false);
  assert.equal(isBranchCountedAsPaid(mkBranch('br_overdue', true, { paymentStatus: 'overdue' }), managedOrg, NOW), false);
  assert.equal(isBranchCountedAsPaid(mkBranch('br_due_past', true, { paymentStatus: 'paid', feeDueAt: PAST_2D }), managedOrg, NOW), false);
  // Suspended branch inside 30-day grace MUST NOT count as paid
  assert.equal(
    isBranchCountedAsPaid(
      mkBranch('br_susp', false, { paymentStatus: 'paid', feeDueAt: FUTURE_30D, suspendedAt: PAST_5D, gracePeriodEndsAt: FUTURE_5D }),
      managedOrg,
      NOW
    ),
    false
  );
  // Legacy unrestricted org counts active branch without paid status
  assert.equal(isBranchCountedAsPaid({ isActive: true }, legacyOrg, NOW), true);
});

runTest('13. evaluateOrgNoPaidBranchGrace tracks 7-day grace & auto-deactivation deadline while exempting legacy orgs', () => {
  const zeroPaidInGrace = evaluateOrgNoPaidBranchGrace(
    {
      ...managedOrg,
      noPaidBranchGraceStartedAt: PAST_2D,
      deactivationDueAt: FUTURE_5D,
    },
    [mkBranch('br_susp', false, { suspendedAt: PAST_2D, gracePeriodEndsAt: FUTURE_30D })],
    NOW
  );
  assert.equal(zeroPaidInGrace.isLegacyExempt, false);
  assert.equal(zeroPaidInGrace.paidBranchesCount, 0);
  assert.equal(zeroPaidInGrace.inGrace, true);
  assert.equal(zeroPaidInGrace.isDeactivated, false);
  assert.equal(zeroPaidInGrace.remainingGraceDays, 5);

  const expiredGrace = evaluateOrgNoPaidBranchGrace(
    {
      ...managedOrg,
      noPaidBranchGraceStartedAt: PAST_35D,
      deactivationDueAt: PAST_5D,
    },
    [],
    NOW
  );
  assert.equal(expiredGrace.inGrace, false);
  assert.equal(expiredGrace.isDeactivated, true);

  const legacyGrace = evaluateOrgNoPaidBranchGrace(legacyOrg, [], NOW);
  assert.equal(legacyGrace.isLegacyExempt, true);
  assert.equal(legacyGrace.inGrace, false);
  assert.equal(legacyGrace.isDeactivated, false);
});

runTest('14. evaluateBranchBillingAndGrace enforces 30-day grace countdown and DB purge prerequisites', () => {
  const inGrace = evaluateBranchBillingAndGrace(
    mkBranch('br_in_grace', false, { suspendedAt: PAST_5D, gracePeriodEndsAt: FUTURE_5D }),
    managedOrg,
    NOW
  );
  assert.equal(inGrace.isSuspended, true);
  assert.equal(inGrace.isGraceExpired, false);
  assert.equal(inGrace.graceRemainingDays, 5);
  assert.equal(inGrace.canPurgeFromDb, false);

  const expiredUnverified = evaluateBranchBillingAndGrace(
    mkBranch('br_exp_unv', false, { suspendedAt: PAST_35D, gracePeriodEndsAt: PAST_5D, driveBackupVerified: false }),
    managedOrg,
    NOW
  );
  assert.equal(expiredUnverified.isGraceExpired, true);
  assert.equal(expiredUnverified.graceRemainingDays, 0);
  assert.equal(expiredUnverified.canPurgeFromDb, false);

  const expiredVerified = evaluateBranchBillingAndGrace(
    mkBranch('br_exp_ver', false, {
      suspendedAt: PAST_35D,
      gracePeriodEndsAt: PAST_5D,
      driveBackupVerified: true,
      driveBackupVerifiedAt: NOW.toISOString(),
    }),
    managedOrg,
    NOW
  );
  assert.equal(expiredVerified.canPurgeFromDb, true);
});

runTest('15. verifyBranchDriveBackupCompleteness fails closed on unarchived/stale/pending closings & passes only when Drive backup is intact', () => {
  const validHash = 'b'.repeat(64);
  const expiredSuspBranch = mkBranch('br_purge', false, {
    suspendedAt: PAST_35D,
    gracePeriodEndsAt: PAST_5D,
  });

  // Fails before 30-day expiry
  const pre30d = verifyBranchDriveBackupCompleteness({
    branch: mkBranch('br_early', false, { suspendedAt: PAST_5D, gracePeriodEndsAt: FUTURE_5D }),
    closings: [],
    archives: [],
    now: NOW,
  });
  assert.equal(pre30d.verified, false);

  // Fails when approved closing has missing archive
  const missingArc = verifyBranchDriveBackupCompleteness({
    branch: expiredSuspBranch,
    closings: [{ id: 'c1', branchId: 'br_purge', status: 'approved' }],
    archives: [],
    now: NOW,
  });
  assert.equal(missingArc.verified, false);
  assert.deepEqual(missingArc.missingOrUnverifiedClosingIds, ['c1']);

  // Fails when closing was admin-corrected after archive timestamp
  const staleAfterCorrection = verifyBranchDriveBackupCompleteness({
    branch: expiredSuspBranch,
    closings: [{ id: 'c1', branchId: 'br_purge', status: 'approved', correctedAt: '2026-11-10T10:00:00Z' }],
    archives: [
      {
        closingId: 'c1',
        branchId: 'br_purge',
        archiveStatus: 'archived',
        driveExcelFileId: 'drv_1',
        driveExcelWebViewLink: 'https://drive.google.com/file/d/drv_1/view',
        drivePayloadHash: validHash,
        archivedAt: '2026-11-01T10:00:00Z',
        sourceCorrectionAt: '2026-11-05T10:00:00Z',
      },
    ],
    now: NOW,
  });
  assert.equal(staleAfterCorrection.verified, false);
  assert.deepEqual(staleAfterCorrection.failedOrStaleClosingIds, ['c1']);

  // Fails when pending_review closing exists
  const hasPending = verifyBranchDriveBackupCompleteness({
    branch: expiredSuspBranch,
    closings: [{ id: 'c_pending', branchId: 'br_purge', status: 'pending_review' }],
    archives: [],
    now: NOW,
  });
  assert.equal(hasPending.verified, false);
  assert.equal(hasPending.unapprovedPendingCount, 1);

  // Passes when 30d expired and all approved closings are archived with valid SHA-256 + link
  const okRes = verifyBranchDriveBackupCompleteness({
    branch: expiredSuspBranch,
    closings: [{ id: 'c1', branchId: 'br_purge', status: 'approved' }],
    archives: [
      {
        closingId: 'c1',
        branchId: 'br_purge',
        archiveStatus: 'archived',
        driveExcelFileId: 'drv_1',
        driveExcelWebViewLink: 'https://drive.google.com/file/d/drv_1/view',
        drivePayloadHash: validHash,
        archivedAt: '2026-11-01T10:00:00Z',
      },
    ],
    now: NOW,
  });
  assert.equal(okRes.verified, true);
  assert.equal(okRes.verifiedArchivedCount, 1);
});

const failed = results.filter((r) => !r.passed);
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed.`);
if (failed.length > 0) {
  process.exit(1);
}
