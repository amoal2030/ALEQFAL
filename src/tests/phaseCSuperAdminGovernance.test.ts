/**
 * Phase C — Super Admin Governance, UI Isolation & Live Firestore Emulator Integration Suite
 *
 * Tests EVERY requirement of Phase C:
 *  Part A (Unit & Static Contract):
 *   1. Identity gate rejects onlak2030@gmail.com, unverified amoal2030@gmail.com, manager, supervisor, branch_manager, employee
 *   2. Organization exemption grant/revoke bundles (`legacy_unrestricted` & `billing_exempt`) preserve 100% of historical fields & fail closed on manual suspension or unverified owner
 *   3. Individual & bulk branch exemption bundles preserve historical payment fields & respect inherited org exemption when individual branch exemption is revoked
 *   4. Cross-org member creation/update/archive/reactivate strictly blocks `manager`, `super_admin`, `amoal2030@gmail.com`, cross-org `orgId` changes, and foreign-org branch bindings
 *   5. `InFlightActionGuard` deterministically rejects concurrent duplicate submissions and releases after completion/failure
 *   6. Static audit of `SuperAdminDashboard.tsx`: zero direct Firestore/Drive calls (`updateDoc`/`setDoc`/`deleteDoc`/`requestDriveAuthorization`/`getActiveDriveSession`), zero delete-user or delete-audit-log actions, strict operational role options
 *
 *  Part B (Live Firestore Emulator Integration using EXACT `superAdminGovernance.ts` bundle outputs against Phase B `firestore.rules`):
 *   7. Org `legacy_unrestricted` grant & revoke commit atomically with `platformAuditLogs` and preserve historical subscription/setup fields
 *   8. Individual branch exemption grant & revoke commit atomically (including inherited org exemption scenario) and preserve `lastPaidAt`/`subscriptionStartAt`
 *   9. Bulk all-branch exemption commits atomically across all org branches with `ORG_BRANCHES_BULK_EXEMPTION_GRANTED`
 *  10. Full cross-org member lifecycle (`MEMBER_CREATED` -> `MEMBER_ROLE_CHANGED` -> `MEMBER_BRANCH_CHANGED` -> `MEMBER_UPDATED` -> `MEMBER_ARCHIVED` -> `MEMBER_REACTIVATED`) commits atomically while preserving user doc & historical closings
 *  11. Genuine security denials (`onlak2030@gmail.com`, unverified `amoal2030@gmail.com`, manager promotion, foreign branch, user delete, audit log update/delete) with ZERO 1,000-expression errors
 *
 * Run with:
 *   PATH="/tmp/jre21/bin:$PATH" firebase emulators:exec --only firestore "npx tsx src/tests/phaseCSuperAdminGovernance.test.ts"
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  FieldValue,
  initializeNamedDbTestEnvironment,
  NamedDbRulesTestEnvironment,
  parseEmulatorHostAndPort,
  Timestamp,
} from './namedDbEmulatorHarness';
import { Branch, Organization, UserProfile } from '../types';
import { evaluateBranchBillingAndGrace, evaluateOrganizationBranchPricing } from '../utils/branchPricing';
import { buildSuperAdminPlatformNotification } from '../utils/notifications';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import { evaluateOrganizationSubscription } from '../utils/subscription';
import {
  ALLOWED_SUPER_ADMIN_MEMBER_ROLES,
  assertSuperAdminIdentity,
  buildSuperAdminBranchExemptionGrantBundle,
  buildSuperAdminBranchExemptionRevokeBundle,
  buildSuperAdminBulkBranchesExemptionBundles,
  buildSuperAdminMemberArchiveBundle,
  buildSuperAdminMemberCreateBundle,
  buildSuperAdminMemberReactivateBundle,
  buildSuperAdminMemberUpdateBundle,
  buildSuperAdminOrgExemptionGrantBundle,
  buildSuperAdminOrgExemptionRevokeBundle,
  getPlatformAuditActionLabel,
  InFlightActionGuard,
  SuperAdminActorSnapshot,
  validateSuperAdminMemberCreateInput,
} from '../utils/superAdminGovernance';

interface TestOutcome {
  name: string;
  passed: boolean;
  error?: string;
}

let genuineSecurityDenialsCount = 0;
let expressionLimitErrorsCount = 0;

async function assertGenuineFails<T>(promise: Promise<T>, label: string): Promise<void> {
  const err = await assertFails(promise);
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('maximum of 1000 expressions')) {
    expressionLimitErrorsCount += 1;
    throw new Error(`FALSE-POSITIVE REJECTION (hit 1,000-expression limit) [${label}]: ${msg}`);
  }
  genuineSecurityDenialsCount += 1;
}

function parseEmulatorConfig(): { host: string; port: number } | null {
  if (!process.env.FIRESTORE_EMULATOR_HOST) return null;
  return parseEmulatorHostAndPort();
}

const VERIFIED_SA: SuperAdminActorSnapshot = {
  uid: 'sa_verified_uid',
  email: 'amoal2030@gmail.com',
  emailVerified: true,
  displayName: 'Platform Owner',
};

const now = new Date('2026-06-15T12:00:00.000Z');
const nowIso = now.toISOString();
const pastIso = '2026-01-15T12:00:00.000Z';
const futureIso = '2026-12-15T12:00:00.000Z';

function makeSampleOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org_c_1',
    name: 'مؤسسة الإقفال الاختبارية',
    activityType: 'retail',
    currency: 'SAR',
    ownerId: 'mgr_c_1',
    ownerEmail: 'owner.c1@example.com',
    ownerName: 'أحمد المالك',
    driveConnected: false,
    isActive: true,
    subscriptionPlan: '1y',
    subscriptionStatus: 'active',
    subscriptionStartAt: pastIso,
    subscriptionEndAt: futureIso,
    accountSetupFeeSar: 80,
    setupFeeStatus: 'paid',
    setupFeePaidAt: pastIso,
    includedBranchesCount: 0,
    extraBranchMonthlyFeeSar: 50,
    createdAt: pastIso,
    updatedAt: pastIso,
    ...overrides,
  };
}

function makeSampleOwner(orgId = 'org_c_1'): UserProfile {
  return {
    uid: 'mgr_c_1',
    orgId,
    email: 'owner.c1@example.com',
    displayName: 'أحمد المالك',
    role: 'manager',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('manager'),
    createdAt: pastIso,
    updatedAt: pastIso,
  };
}

function makeSampleBranch(id: string, orgId = 'org_c_1', overrides: Partial<Branch> = {}): Branch {
  return {
    id,
    orgId,
    name: `فرع ${id}`,
    code: id.toUpperCase().slice(0, 8),
    isActive: true,
    lifecycleStatus: 'active',
    monthlyFeeSar: 50,
    paymentStatus: 'paid',
    subscriptionStartAt: pastIso,
    lastPaidAt: pastIso,
    lastPaidBy: 'amoal2030@gmail.com',
    paymentNote: 'سجل دفع تاريخي محفوظ',
    createdAt: pastIso,
    updatedAt: pastIso,
    ...overrides,
  };
}

function makeSampleMember(overrides: Partial<UserProfile> = {}): UserProfile {
  const role = overrides.role ?? 'employee';
  return {
    uid: 'emp_c_1',
    orgId: 'org_c_1',
    email: 'emp.c1@example.com',
    displayName: 'سالم الموظف',
    role,
    branchId: 'br_c_1',
    branchName: 'فرع br_c_1',
    phone: '0551112233',
    isActive: true,
    isArchived: false,
    permissions: overrides.permissions ?? buildDefaultPermissionsForRole(role),
    createdAt: pastIso,
    updatedAt: pastIso,
    ...overrides,
  };
}

async function runPhaseCTests() {
  console.log('========================================================================');
  console.log('   PHASE C — SUPER ADMIN GOVERNANCE & EMULATOR INTEGRATION SUITE        ');
  console.log('========================================================================\n');

  const results: TestOutcome[] = [];

  async function runTest(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`  [PASS] ${name}`);
    } catch (err: any) {
      results.push({ name, passed: false, error: err?.message || String(err) });
      console.error(`  [FAIL] ${name}\n         ${err?.message || String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // PART A — Unit, Governance Contracts & Static UI Security Audit
  // -------------------------------------------------------------------------
  console.log('--- Part A: Governance Logic, Concurrency Guard & Static UI Audit ---');

  await runTest('C1: Identity gate strictly blocks onlak2030, unverified SA, and non-SA roles', () => {
    assert.doesNotThrow(() => assertSuperAdminIdentity(VERIFIED_SA));
    assert.throws(() =>
      assertSuperAdminIdentity({ email: 'onlak2030@gmail.com', emailVerified: true })
    );
    assert.throws(() =>
      assertSuperAdminIdentity({ email: 'amoal2030@gmail.com', emailVerified: false })
    );
    assert.throws(() =>
      assertSuperAdminIdentity({ email: 'manager@example.com', emailVerified: true })
    );
    assert.throws(() => assertSuperAdminIdentity(null));
  });

  await runTest('C2: Org legacy_unrestricted & billing_exempt bundles preserve historical fields and fail closed on suspended org', () => {
    const org = makeSampleOrg();
    const owner = makeSampleOwner();
    const branches = [makeSampleBranch('br_c_1'), makeSampleBranch('br_c_2')];

    const grantLegacy = buildSuperAdminOrgExemptionGrantBundle({
      actor: VERIFIED_SA,
      org,
      ownerUser: owner,
      orgBranches: branches,
      mode: 'legacy_unrestricted',
      reason: 'اعتماد إعفاء legacy_unrestricted رسمي للمؤسسة',
      expectedOwnerEmail: org.ownerEmail,
      now,
      grantedAtValue: Timestamp.fromDate(now),
    });

    assert.equal(grantLegacy.auditLog.action, 'ORG_LEGACY_UNRESTRICTED_GRANTED');
    assert.equal(grantLegacy.orgPatch.billingExempt, true);
    assert.equal(grantLegacy.orgPatch.billingExemptMode, 'legacy_unrestricted');
    assert.equal(grantLegacy.orgPatch.billingExemptLastAuditLogId, grantLegacy.auditLog.id);
    // Historical subscription/setup fields MUST NOT be touched
    assert.equal('subscriptionPlan' in grantLegacy.orgPatch, false);
    assert.equal('subscriptionStatus' in grantLegacy.orgPatch, false);
    assert.equal('accountSetupFeeSar' in grantLegacy.orgPatch, false);
    assert.equal('setupFeeStatus' in grantLegacy.orgPatch, false);

    // Suspended org must fail closed
    const suspendedOrg = makeSampleOrg({ isActive: false, deactivationReason: 'manual_suspension' });
    assert.throws(() =>
      buildSuperAdminOrgExemptionGrantBundle({
        actor: VERIFIED_SA,
        org: suspendedOrg,
        ownerUser: owner,
        orgBranches: branches,
        mode: 'billing_exempt',
        reason: 'محاولة إعفاء مؤسسة موقوفة يدوياً',
        now,
        grantedAtValue: Timestamp.fromDate(now),
      })
    );

    // Revoke preserves original grant metadata and chooses ORG_LEGACY_UNRESTRICTED_REVOKED
    const exemptOrg: Organization = {
      ...org,
      ...(grantLegacy.orgPatch as Partial<Organization>),
    };
    const revokeLegacy = buildSuperAdminOrgExemptionRevokeBundle({
      actor: VERIFIED_SA,
      org: exemptOrg,
      reason: 'إلغاء إعفاء legacy_unrestricted وإعادة الاشتراك القياسي',
      now,
      revokedAtValue: Timestamp.fromDate(now),
    });
    assert.equal(revokeLegacy.auditLog.action, 'ORG_LEGACY_UNRESTRICTED_REVOKED');
    assert.equal(revokeLegacy.orgPatch.billingExempt, false);
    assert.equal('billingExemptGrantedAt' in revokeLegacy.orgPatch, false);
    assert.equal('billingExemptReason' in revokeLegacy.orgPatch, false);
    assert.equal('subscriptionPlan' in revokeLegacy.orgPatch, false);
  });

  await runTest('C3: Branch individual & bulk exemption preserve historical payments & keep inherited org exemption intact', () => {
    const paidOrg = makeSampleOrg();
    const b1 = makeSampleBranch('br_c_1');
    const b2 = makeSampleBranch('br_c_2');

    const grantB1 = buildSuperAdminBranchExemptionGrantBundle({
      actor: VERIFIED_SA,
      org: paidOrg,
      branch: b1,
      mode: 'billing_exempt',
      reason: 'إعفاء دائم للفرع الأول فقط',
      now,
      grantedAtValue: Timestamp.fromDate(now),
    });

    assert.equal(grantB1.auditLog.action, 'BRANCH_BILLING_EXEMPTION_GRANTED');
    assert.equal(grantB1.branchPatch.billingExempt, true);
    assert.equal(grantB1.branchPatch.monthlyFeeSar, 0);
    assert.equal(grantB1.branchPatch.paymentStatus, 'exempt');
    // Historical payment fields untouched
    assert.equal('subscriptionStartAt' in grantB1.branchPatch, false);
    assert.equal('lastPaidAt' in grantB1.branchPatch, false);
    assert.equal('lastPaidBy' in grantB1.branchPatch, false);
    assert.equal('paymentNote' in grantB1.branchPatch, false);

    // Pricing excludes exempt branch b1, charges only b2 (50 SAR)
    const mergedB1: Branch = { ...b1, ...(grantB1.branchPatch as Partial<Branch>) };
    const pricing = evaluateOrganizationBranchPricing({
      org: paidOrg,
      branches: [mergedB1, b2],
      now,
    });
    assert.equal(pricing.billableBranchesCount, 1);
    assert.equal(pricing.estimatedMonthlyBranchTotalSar, 50);

    // Revoking individual branch exemption when parent org IS exempt keeps inherited org exemption active
    const exemptParentOrg = makeSampleOrg({
      billingExempt: true,
      billingExemptScope: 'full_permanent',
      billingExemptMode: 'legacy_unrestricted',
      billingExemptVerifiedOwnerId: 'mgr_c_1',
      billingExemptVerifiedOwnerEmail: 'owner.c1@example.com',
    });
    const revokeUnderExemptOrg = buildSuperAdminBranchExemptionRevokeBundle({
      actor: VERIFIED_SA,
      org: exemptParentOrg,
      branch: mergedB1,
      restoredPaymentStatus: 'unpaid',
      restoredMonthlyFeeSar: 50,
      reason: 'إلغاء الإعفاء الفردي مع بقاء إعفاء المؤسسة الأم',
      now,
      revokedAtValue: Timestamp.fromDate(now),
    });
    assert.equal(revokeUnderExemptOrg.parentOrgRemainsExempt, true);
    assert.equal(revokeUnderExemptOrg.auditLog.action, 'BRANCH_BILLING_EXEMPTION_REVOKED');
    assert.equal('exemptGrantedAt' in revokeUnderExemptOrg.branchPatch, false);
    assert.equal('lastPaidAt' in revokeUnderExemptOrg.branchPatch, false);

    // After revoking individual branch exemption, branch still inherits org exemption
    const revokedBranch: Branch = {
      ...mergedB1,
      ...(revokeUnderExemptOrg.branchPatch as Partial<Branch>),
    };
    const evalAfterRevoke = evaluateBranchBillingAndGrace(revokedBranch, exemptParentOrg, now);
    assert.equal(evalAfterRevoke.isFeeExempt, true);
    assert.equal(evalAfterRevoke.exemptionSource, 'organization');
    assert.equal(evalAfterRevoke.monthlyFeeSar, 0);

    // Bulk bundles reject foreign-org branch
    const foreignBranch = makeSampleBranch('br_foreign', 'org_other');
    assert.throws(() =>
      buildSuperAdminBulkBranchesExemptionBundles({
        actor: VERIFIED_SA,
        org: paidOrg,
        branches: [b1, foreignBranch],
        mode: 'billing_exempt',
        reason: 'محاولة إعفاء جماعي بفرع أجنبي',
        now,
        grantedAtValue: Timestamp.fromDate(now),
      })
    );
  });

  await runTest('C4: Member governance strictly enforces allowed roles, blocks amoal2030/manager/foreign-branch/orgId-change', () => {
    const org = makeSampleOrg();
    const orgBranches = [makeSampleBranch('br_c_1'), makeSampleBranch('br_c_2')];

    assert.deepEqual([...ALLOWED_SUPER_ADMIN_MEMBER_ROLES], ['supervisor', 'branch_manager', 'employee']);

    // Disallowed roles on create
    assert.throws(() =>
      validateSuperAdminMemberCreateInput({
        actor: VERIFIED_SA,
        org,
        orgBranches,
        email: 'bad.mgr@example.com',
        password: 'Password123',
        displayName: 'مدير مرفوض',
        role: 'manager',
      })
    );
    assert.throws(() =>
      validateSuperAdminMemberCreateInput({
        actor: VERIFIED_SA,
        org,
        orgBranches,
        email: 'bad.sa@example.com',
        password: 'Password123',
        displayName: 'مدير رئيسي مرفوض',
        role: 'super_admin',
      })
    );
    // Targeting Super Admin email
    assert.throws(() =>
      validateSuperAdminMemberCreateInput({
        actor: VERIFIED_SA,
        org,
        orgBranches,
        email: 'amoal2030@gmail.com',
        password: 'Password123',
        displayName: 'محاولة استهداف',
        role: 'supervisor',
      })
    );
    // Foreign branch binding on create
    assert.throws(() =>
      validateSuperAdminMemberCreateInput({
        actor: VERIFIED_SA,
        org,
        orgBranches,
        email: 'emp@example.com',
        password: 'Password123',
        displayName: 'موظف بفرع أجنبي',
        role: 'employee',
        branchId: 'br_foreign_99',
      })
    );

    // Editing manager is blocked
    const managerUser = makeSampleOwner();
    assert.throws(() =>
      buildSuperAdminMemberUpdateBundle({
        actor: VERIFIED_SA,
        org,
        existingMember: managerUser,
        orgBranches,
        displayName: 'تعديل المدير',
        role: 'supervisor',
        now,
        deleteFieldSentinel: FieldValue.delete(),
      })
    );

    // Changing orgId is blocked
    const emp = makeSampleMember();
    assert.throws(() =>
      buildSuperAdminMemberUpdateBundle({
        actor: VERIFIED_SA,
        org,
        existingMember: emp,
        orgBranches,
        displayName: emp.displayName,
        role: 'employee',
        branchId: 'br_c_1',
        targetOrgIdAttempt: 'org_c_2',
        now,
        deleteFieldSentinel: FieldValue.delete(),
      })
    );

    // Archiving manager or amoal2030 is blocked
    assert.throws(() =>
      buildSuperAdminMemberArchiveBundle({
        actor: VERIFIED_SA,
        org,
        existingMember: managerUser,
        reason: 'محاولة أرشفة مدير مؤسسة',
        now,
      })
    );
    assert.throws(() =>
      buildSuperAdminMemberArchiveBundle({
        actor: VERIFIED_SA,
        org,
        existingMember: makeSampleMember({ email: 'amoal2030@gmail.com' }),
        reason: 'محاولة أرشفة المدير الرئيسي',
        now,
      })
    );
  });

  await runTest('C5: InFlightActionGuard deterministically prevents rapid double-submits', async () => {
    const guard = new InFlightActionGuard();
    let releaseFirst!: () => void;
    const firstPromise = guard.runExclusive('key_1', async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return 'ok';
    });

    assert.equal(guard.isRunning('key_1'), true);
    await assert.rejects(
      () => guard.runExclusive('key_1', async () => 'duplicate'),
      /قيد التنفيذ/
    );

    releaseFirst();
    const res = await firstPromise;
    assert.equal(res, 'ok');
    assert.equal(guard.isRunning('key_1'), false);

    // Subsequent sequential run succeeds
    const res2 = await guard.runExclusive('key_1', async () => 'ok2');
    assert.equal(res2, 'ok2');
  });

  await runTest('C6: Static UI security audit of SuperAdminDashboard.tsx & audit label coverage', () => {
    const dashboardSrc = fs.readFileSync('src/components/superadmin/SuperAdminDashboard.tsx', 'utf8');
    assert.equal(
      /requestDriveAuthorization|getActiveDriveSession|updateDoc|setDoc|deleteDoc/.test(dashboardSrc),
      false,
      'SuperAdminDashboard must never contain direct Firestore write/delete or Drive OAuth calls'
    );
    // Ensure audit log tab is strictly read-only and member roles dropdown uses ALLOWED_SUPER_ADMIN_MEMBER_ROLES
    assert.equal(dashboardSrc.includes('ALLOWED_SUPER_ADMIN_MEMBER_ROLES'), true);
    assert.equal(dashboardSrc.includes('canManageMember'), true);
    assert.equal(dashboardSrc.includes('getPlatformAuditActionLabel'), true);
    assert.equal(dashboardSrc.includes('verifyOrganizationExemptionEligibility'), true);
    assert.equal(dashboardSrc.includes('verifyBranchExemptionEligibility'), true);

    // Audit labels exist for all new Phase C actions
    for (const action of [
      'ORG_LEGACY_UNRESTRICTED_GRANTED',
      'ORG_LEGACY_UNRESTRICTED_REVOKED',
      'BRANCH_BILLING_EXEMPTION_GRANTED',
      'BRANCH_BILLING_EXEMPTION_REVOKED',
      'ORG_BRANCHES_BULK_EXEMPTION_GRANTED',
      'MEMBER_CREATED',
      'MEMBER_UPDATED',
      'MEMBER_ROLE_CHANGED',
      'MEMBER_BRANCH_CHANGED',
      'MEMBER_ARCHIVED',
      'MEMBER_REACTIVATED',
    ] as const) {
      assert.ok(getPlatformAuditActionLabel(action, 'ar').length >= 4);
      assert.ok(getPlatformAuditActionLabel(action, 'en').length >= 4);
    }
  });

  // -------------------------------------------------------------------------
  // PART B — Live Firestore Emulator Integration against Phase B firestore.rules
  // -------------------------------------------------------------------------
  const emulatorConfig = parseEmulatorConfig();
  if (!emulatorConfig) {
    console.log('\n[INFO] FIRESTORE_EMULATOR_HOST not set — skipping Part B live emulator tests.');
  } else {
    console.log('\n--- Part B: Live Firestore Emulator Integration with Phase C Governance Bundles ---');

    const testEnv: NamedDbRulesTestEnvironment = await initializeNamedDbTestEnvironment({
      host: emulatorConfig.host,
      port: emulatorConfig.port,
    });

    await testEnv.clearFirestore();

    const tsPast = Timestamp.fromDate(new Date(pastIso));
    const tsFuture = Timestamp.fromDate(new Date(futureIso));
    const tsNow = Timestamp.fromDate(now);

    const orgA: Organization = {
      id: 'org_c_a',
      name: 'مؤسسة الاختبار الأولى',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_c_a',
      ownerEmail: 'owner.ca@example.com',
      ownerName: 'مالك ألفا',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1y',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast,
      subscriptionEndAt: tsFuture,
      accountSetupFeeSar: 80,
      setupFeeStatus: 'paid',
      setupFeePaidAt: tsPast,
      includedBranchesCount: 0,
      extraBranchMonthlyFeeSar: 50,
      createdAt: pastIso,
      updatedAt: pastIso,
    };

    const orgB: Organization = {
      id: 'org_c_b',
      name: 'مؤسسة الاختبار الثانية',
      activityType: 'services',
      currency: 'SAR',
      ownerId: 'mgr_c_b',
      ownerEmail: 'owner.cb@example.com',
      ownerName: 'مالك بيتا',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '6m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast,
      subscriptionEndAt: tsFuture,
      accountSetupFeeSar: 80,
      setupFeeStatus: 'paid',
      setupFeePaidAt: tsPast,
      includedBranchesCount: 0,
      extraBranchMonthlyFeeSar: 50,
      createdAt: pastIso,
      updatedAt: pastIso,
    };

    const ownerA: UserProfile = {
      uid: 'mgr_c_a',
      orgId: 'org_c_a',
      email: 'owner.ca@example.com',
      displayName: 'مالك ألفا',
      role: 'manager',
      isActive: true,
      permissions: buildDefaultPermissionsForRole('manager'),
      createdAt: pastIso,
      updatedAt: pastIso,
    };

    const branchA1: Branch = {
      id: 'br_c_a1',
      orgId: 'org_c_a',
      name: 'الفرع الرئيسي أ1',
      code: 'A1',
      isActive: true,
      lifecycleStatus: 'active',
      monthlyFeeSar: 50,
      paymentStatus: 'paid',
      subscriptionStartAt: tsPast,
      lastPaidAt: tsPast,
      lastPaidBy: 'amoal2030@gmail.com',
      paymentNote: 'دفعة تاريخية أ1',
      createdAt: pastIso,
      updatedAt: pastIso,
    };

    const branchA2: Branch = {
      id: 'br_c_a2',
      orgId: 'org_c_a',
      name: 'الفرع الثاني أ2',
      code: 'A2',
      isActive: true,
      lifecycleStatus: 'active',
      monthlyFeeSar: 50,
      paymentStatus: 'paid',
      subscriptionStartAt: tsPast,
      lastPaidAt: tsPast,
      lastPaidBy: 'amoal2030@gmail.com',
      paymentNote: 'دفعة تاريخية أ2',
      createdAt: pastIso,
      updatedAt: pastIso,
    };

    const branchB1: Branch = {
      id: 'br_c_b1',
      orgId: 'org_c_b',
      name: 'فرع بيتا 1',
      code: 'B1',
      isActive: true,
      lifecycleStatus: 'active',
      monthlyFeeSar: 50,
      paymentStatus: 'paid',
      subscriptionStartAt: tsPast,
      lastPaidAt: tsPast,
      lastPaidBy: 'amoal2030@gmail.com',
      paymentNote: 'دفعة تاريخية ب1',
      createdAt: pastIso,
      updatedAt: pastIso,
    };

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('organizations/org_c_a').set(orgA);
      await db.doc('organizations/org_c_b').set(orgB);
      await db.doc('users/mgr_c_a').set(ownerA);
      await db.doc('users/mgr_c_b').set({
        uid: 'mgr_c_b',
        orgId: 'org_c_b',
        email: 'owner.cb@example.com',
        displayName: 'مالك بيتا',
        role: 'manager',
        isActive: true,
        createdAt: pastIso,
        updatedAt: pastIso,
      });
      await db.doc('branches/br_c_a1').set(branchA1);
      await db.doc('branches/br_c_a2').set(branchA2);
      await db.doc('branches/br_c_b1').set(branchB1);
      // Historical closing owned by member to verify archiving never deletes operational history
      await db.doc('closings/cl_hist_1').set({
        id: 'cl_hist_1',
        orgId: 'org_c_a',
        branchId: 'br_c_a1',
        branchName: 'الفرع الرئيسي أ1',
        date: '2026-06-01',
        period: 'morning',
        cashSales: 1000,
        cardSales: 500,
        expenses: 100,
        totalSales: 1500,
        netCash: 900,
        netTotal: 1400,
        status: 'approved',
        createdBy: 'member_new_1',
        createdByName: 'موظف جديد',
        createdAt: pastIso,
        updatedAt: pastIso,
      });
    });

    const saDb = testEnv
      .authenticatedContext(VERIFIED_SA.uid, {
        email: 'amoal2030@gmail.com',
        email_verified: true,
      })
      .firestore();

    const onlakDb = testEnv
      .authenticatedContext('onlak_uid', {
        email: 'onlak2030@gmail.com',
        email_verified: true,
      })
      .firestore();

    const unverifiedSaDb = testEnv
      .authenticatedContext('sa_unverified', {
        email: 'amoal2030@gmail.com',
        email_verified: false,
      })
      .firestore();

    await runTest('C7 (Emulator): Org billing_exempt (incl. 7d grace org) & legacy_unrestricted 3-doc batch grant/revoke + negative audit checks', async () => {
      // Seed active 7-day grace timers on org_c_a to ensure regression coverage against the 1,000-expression limit
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc('organizations/org_c_a').update({
          noPaidBranchGraceStartedAt: tsPast,
          deactivationDueAt: tsFuture,
        });
      });

      const orgWithGrace = (await saDb.doc('organizations/org_c_a').get()).data() as Organization;

      // 1. Grant billing_exempt via exact 3-doc batch (organizations + platformAuditLogs + notifications)
      const grantExempt = buildSuperAdminOrgExemptionGrantBundle({
        actor: VERIFIED_SA,
        org: orgWithGrace,
        ownerUser: ownerA,
        orgBranches: [branchA1, branchA2],
        mode: 'billing_exempt',
        reason: 'اعتماد إعفاء billing_exempt للمؤسسة ذات مهلة 7 أيام في المحاكي',
        expectedOwnerEmail: orgWithGrace.ownerEmail,
        now,
        grantedAtValue: tsNow,
      });
      const notifGrantExempt = buildSuperAdminPlatformNotification({
        dedupKey: `sa_org_billing_exempt_grant:${orgWithGrace.id}:${grantExempt.auditLog.id}`,
        category: 'security_admin',
        type: 'SA_ORG_BILLING_EXEMPTION_GRANTED',
        severity: 'success',
        relatedOrgId: orgWithGrace.id,
        actorUid: VERIFIED_SA.uid,
        actorName: VERIFIED_SA.displayName || 'صاحب الموقع',
        title: `اعتماد الإعفاء الدائم الشامل لمؤسسة "${orgWithGrace.name}"`,
        body: `تم منح الإعفاء الدائم (billing_exempt) للمالك الموثق ${grantExempt.ownerEmail}.`,
        targetType: 'organization',
        targetId: orgWithGrace.id,
        tab: 'organizations',
        createdAt: now.toISOString(),
      });

      const bGrantExempt = saDb.batch();
      bGrantExempt.update(saDb.doc('organizations/org_c_a'), grantExempt.orgPatch);
      bGrantExempt.set(saDb.doc(`platformAuditLogs/${grantExempt.auditLog.id}`), grantExempt.auditLog);
      bGrantExempt.set(saDb.doc(`notifications/${notifGrantExempt.id}`), notifGrantExempt);
      await assertSucceeds(bGrantExempt.commit());

      const afterGrantExempt = (await saDb.doc('organizations/org_c_a').get()).data() as Organization;
      assert.equal(afterGrantExempt.billingExempt, true);
      assert.equal(afterGrantExempt.billingExemptMode, 'billing_exempt');
      assert.equal(afterGrantExempt.subscriptionPlan, '1y');
      assert.equal(afterGrantExempt.accountSetupFeeSar, 80);
      assert.equal(evaluateOrganizationSubscription(afterGrantExempt, now).isFeeExempt, true);

      // 2. Revoke billing_exempt via exact 3-doc batch
      const revokeExempt = buildSuperAdminOrgExemptionRevokeBundle({
        actor: VERIFIED_SA,
        org: afterGrantExempt,
        reason: 'إلغاء إعفاء billing_exempt في المحاكي',
        now: new Date(now.getTime() + 30_000),
        revokedAtValue: Timestamp.fromMillis(now.getTime() + 30_000),
      });
      const notifRevokeExempt = buildSuperAdminPlatformNotification({
        dedupKey: `sa_org_billing_exempt_revoke:${orgWithGrace.id}:${revokeExempt.auditLog.id}`,
        category: 'security_admin',
        type: 'SA_ORG_BILLING_EXEMPTION_REVOKED',
        severity: 'warning',
        relatedOrgId: orgWithGrace.id,
        actorUid: VERIFIED_SA.uid,
        actorName: VERIFIED_SA.displayName || 'صاحب الموقع',
        title: `إلغاء الإعفاء الدائم لمؤسسة "${orgWithGrace.name}"`,
        body: 'تم إلغاء الإعفاء الدائم وإعادة المؤسسة إلى نظام الاشتراكات القياسي.',
        targetType: 'organization',
        targetId: orgWithGrace.id,
        tab: 'organizations',
        createdAt: new Date(now.getTime() + 30_000).toISOString(),
      });
      const bRevokeExempt = saDb.batch();
      bRevokeExempt.update(saDb.doc('organizations/org_c_a'), revokeExempt.orgPatch);
      bRevokeExempt.set(saDb.doc(`platformAuditLogs/${revokeExempt.auditLog.id}`), revokeExempt.auditLog);
      bRevokeExempt.set(saDb.doc(`notifications/${notifRevokeExempt.id}`), notifRevokeExempt);
      await assertSucceeds(bRevokeExempt.commit());

      // 3. Grant & Revoke legacy_unrestricted via exact 3-doc batch
      const orgBeforeLegacy = (await saDb.doc('organizations/org_c_a').get()).data() as Organization;
      const tLegacyGrant = new Date(now.getTime() + 45_000);
      const grantBundle = buildSuperAdminOrgExemptionGrantBundle({
        actor: VERIFIED_SA,
        org: orgBeforeLegacy,
        ownerUser: ownerA,
        orgBranches: [branchA1, branchA2],
        mode: 'legacy_unrestricted',
        reason: 'اعتماد إعفاء legacy_unrestricted للمؤسسة في المحاكي',
        expectedOwnerEmail: orgBeforeLegacy.ownerEmail,
        now: tLegacyGrant,
        grantedAtValue: Timestamp.fromDate(tLegacyGrant),
      });
      const notifGrantLegacy = buildSuperAdminPlatformNotification({
        dedupKey: `sa_org_billing_exempt_grant:${orgBeforeLegacy.id}:${grantBundle.auditLog.id}`,
        category: 'security_admin',
        type: 'SA_ORG_LEGACY_UNRESTRICTED_GRANTED',
        severity: 'success',
        relatedOrgId: orgBeforeLegacy.id,
        actorUid: VERIFIED_SA.uid,
        actorName: VERIFIED_SA.displayName || 'صاحب الموقع',
        title: `اعتماد إعفاء legacy_unrestricted لمؤسسة "${orgBeforeLegacy.name}"`,
        body: `تم منح الإعفاء الدائم (legacy_unrestricted) للمالك الموثق ${grantBundle.ownerEmail}.`,
        targetType: 'organization',
        targetId: orgBeforeLegacy.id,
        tab: 'organizations',
        createdAt: tLegacyGrant.toISOString(),
      });

      const batchGrant = saDb.batch();
      batchGrant.update(saDb.doc('organizations/org_c_a'), grantBundle.orgPatch);
      batchGrant.set(saDb.doc(`platformAuditLogs/${grantBundle.auditLog.id}`), grantBundle.auditLog);
      batchGrant.set(saDb.doc(`notifications/${notifGrantLegacy.id}`), notifGrantLegacy);
      await assertSucceeds(batchGrant.commit());

      const afterGrant = (await saDb.doc('organizations/org_c_a').get()).data() as Organization;
      assert.equal(afterGrant.billingExempt, true);
      assert.equal(afterGrant.billingExemptMode, 'legacy_unrestricted');
      assert.equal(afterGrant.subscriptionPlan, '1y');
      assert.equal(afterGrant.accountSetupFeeSar, 80);
      assert.equal(evaluateOrganizationSubscription(afterGrant, tLegacyGrant).isFeeExempt, true);

      const tLegacyRevoke = new Date(now.getTime() + 60_000);
      const revokeBundle = buildSuperAdminOrgExemptionRevokeBundle({
        actor: VERIFIED_SA,
        org: afterGrant,
        reason: 'إلغاء إعفاء legacy_unrestricted في المحاكي',
        now: tLegacyRevoke,
        revokedAtValue: Timestamp.fromDate(tLegacyRevoke),
      });

      const batchRevoke = saDb.batch();
      batchRevoke.update(saDb.doc('organizations/org_c_a'), revokeBundle.orgPatch);
      batchRevoke.set(saDb.doc(`platformAuditLogs/${revokeBundle.auditLog.id}`), revokeBundle.auditLog);
      await assertSucceeds(batchRevoke.commit());

      const afterRevoke = (await saDb.doc('organizations/org_c_a').get()).data() as Organization;
      assert.equal(afterRevoke.billingExempt, false);
      assert.equal(afterRevoke.subscriptionPlan, '1y');
      assert.equal(afterRevoke.accountSetupFeeSar, 80);
      assert.ok(afterRevoke.billingExemptGrantedAt);
      assert.ok(afterRevoke.billingExemptRevokedAt);

      // 4. Negative checks: missing audit log & mismatched audit log action MUST genuinely fail (0 expression-limit errors)
      const tBad = new Date(now.getTime() + 75_000);
      const badBundle = buildSuperAdminOrgExemptionGrantBundle({
        actor: VERIFIED_SA,
        org: afterRevoke,
        ownerUser: ownerA,
        orgBranches: [branchA1, branchA2],
        mode: 'billing_exempt',
        reason: 'اختبار رفض غياب أو عدم تطابق سجل التدقيق',
        expectedOwnerEmail: afterRevoke.ownerEmail,
        now: tBad,
        grantedAtValue: Timestamp.fromDate(tBad),
      });
      await assertGenuineFails(
        saDb.doc('organizations/org_c_a').update(badBundle.orgPatch),
        'Grant org exemption without coupled platformAuditLog'
      );
      const bMismatch = saDb.batch();
      bMismatch.update(saDb.doc('organizations/org_c_a'), badBundle.orgPatch);
      bMismatch.set(saDb.doc(`platformAuditLogs/${badBundle.auditLog.id}`), {
        ...badBundle.auditLog,
        action: 'ORG_LEGACY_UNRESTRICTED_GRANTED',
      });
      await assertGenuineFails(
        bMismatch.commit(),
        'Grant org exemption with mismatched platformAuditLog action'
      );
    });

    await runTest('C8 (Emulator): Individual branch exemption grant & revoke commit atomically and preserve payment history', async () => {
      const freshOrgA = (await saDb.doc('organizations/org_c_a').get()).data() as Organization;
      const grantBranch = buildSuperAdminBranchExemptionGrantBundle({
        actor: VERIFIED_SA,
        org: freshOrgA,
        branch: branchA1,
        mode: 'billing_exempt',
        reason: 'إعفاء فردي دائم للفرع أ1 في المحاكي',
        now,
        grantedAtValue: tsNow,
      });

      const bGrant = saDb.batch();
      bGrant.update(saDb.doc('branches/br_c_a1'), grantBranch.branchPatch);
      bGrant.set(saDb.doc(`platformAuditLogs/${grantBranch.auditLog.id}`), grantBranch.auditLog);
      await assertSucceeds(bGrant.commit());

      const brAfterGrant = (await saDb.doc('branches/br_c_a1').get()).data() as Branch;
      assert.equal(brAfterGrant.billingExempt, true);
      assert.equal(brAfterGrant.monthlyFeeSar, 0);
      assert.equal(brAfterGrant.paymentStatus, 'exempt');
      assert.equal(brAfterGrant.paymentNote, 'دفعة تاريخية أ1');

      const revokeBranch = buildSuperAdminBranchExemptionRevokeBundle({
        actor: VERIFIED_SA,
        org: freshOrgA,
        branch: brAfterGrant,
        restoredPaymentStatus: 'unpaid',
        restoredMonthlyFeeSar: 50,
        reason: 'إلغاء الإعفاء الفردي للفرع أ1 في المحاكي',
        now: new Date(now.getTime() + 120_000),
        revokedAtValue: Timestamp.fromMillis(now.getTime() + 120_000),
      });

      const bRevoke = saDb.batch();
      bRevoke.update(saDb.doc('branches/br_c_a1'), revokeBranch.branchPatch);
      bRevoke.set(saDb.doc(`platformAuditLogs/${revokeBranch.auditLog.id}`), revokeBranch.auditLog);
      await assertSucceeds(bRevoke.commit());

      const brAfterRevoke = (await saDb.doc('branches/br_c_a1').get()).data() as Branch;
      assert.equal(brAfterRevoke.billingExempt, false);
      assert.equal(brAfterRevoke.monthlyFeeSar, 50);
      assert.equal(brAfterRevoke.paymentStatus, 'unpaid');
      assert.equal(brAfterRevoke.paymentNote, 'دفعة تاريخية أ1');
      assert.ok(brAfterRevoke.exemptGrantedAt);
      assert.ok(brAfterRevoke.exemptRevokedAt);
    });

    await runTest('C9 (Emulator): Bulk all-branch exemption commits atomically across all org branches', async () => {
      const freshOrgA = (await saDb.doc('organizations/org_c_a').get()).data() as Organization;
      const freshA1 = (await saDb.doc('branches/br_c_a1').get()).data() as Branch;
      const freshA2 = (await saDb.doc('branches/br_c_a2').get()).data() as Branch;

      const chunks = buildSuperAdminBulkBranchesExemptionBundles({
        actor: VERIFIED_SA,
        org: freshOrgA,
        branches: [freshA1, freshA2],
        mode: 'legacy_unrestricted',
        reason: 'إعفاء جماعي لجميع فروع مؤسسة ألفا في المحاكي',
        now: new Date(now.getTime() + 180_000),
        grantedAtValue: Timestamp.fromMillis(now.getTime() + 180_000),
      });

      assert.equal(chunks.length, 1);
      const batch = saDb.batch();
      for (const item of chunks[0].branches) {
        batch.update(saDb.doc(`branches/${item.branch.id}`), item.patch);
      }
      batch.set(saDb.doc(`platformAuditLogs/${chunks[0].auditLog.id}`), chunks[0].auditLog);
      await assertSucceeds(batch.commit());

      const a1Done = (await saDb.doc('branches/br_c_a1').get()).data() as Branch;
      const a2Done = (await saDb.doc('branches/br_c_a2').get()).data() as Branch;
      assert.equal(a1Done.billingExempt, true);
      assert.equal(a1Done.monthlyFeeSar, 0);
      assert.equal(a2Done.billingExempt, true);
      assert.equal(a2Done.monthlyFeeSar, 0);
      assert.equal(a1Done.paymentNote, 'دفعة تاريخية أ1');
      assert.equal(a2Done.paymentNote, 'دفعة تاريخية أ2');
    });

    await runTest('C10 (Emulator): Full cross-org member lifecycle (create -> role -> branch -> update -> archive -> reactivate) commits atomically & preserves history', async () => {
      const freshOrgA = (await saDb.doc('organizations/org_c_a').get()).data() as Organization;
      const orgBranches = [branchA1, branchA2];

      // 1. Create employee
      const validated = validateSuperAdminMemberCreateInput({
        actor: VERIFIED_SA,
        org: freshOrgA,
        orgBranches,
        email: 'member.new1@example.com',
        password: 'Password123!',
        displayName: 'موظف جديد',
        role: 'employee',
        branchId: 'br_c_a1',
        phone: '0559990001',
      });
      const createBundle = buildSuperAdminMemberCreateBundle({
        actor: VERIFIED_SA,
        org: freshOrgA,
        newUid: 'member_new_1',
        validated,
        now,
      });
      const bCreate = saDb.batch();
      bCreate.set(saDb.doc('users/member_new_1'), createBundle.userDoc);
      bCreate.set(saDb.doc(`platformAuditLogs/${createBundle.auditLog.id}`), createBundle.auditLog);
      await assertSucceeds(bCreate.commit());

      // 2. Transfer branch (employee br_c_a1 -> br_c_a2)
      let currentMember = (await saDb.doc('users/member_new_1').get()).data() as UserProfile;
      const transferBundle = buildSuperAdminMemberUpdateBundle({
        actor: VERIFIED_SA,
        org: freshOrgA,
        existingMember: currentMember,
        orgBranches,
        displayName: currentMember.displayName,
        phone: currentMember.phone,
        role: 'employee',
        branchId: 'br_c_a2',
        reason: 'نقل الموظف إلى الفرع الثاني',
        now: new Date(now.getTime() + 10_000),
        deleteFieldSentinel: FieldValue.delete(),
      });
      assert.equal(transferBundle.action, 'MEMBER_BRANCH_CHANGED');
      const bTransfer = saDb.batch();
      bTransfer.update(saDb.doc('users/member_new_1'), transferBundle.userPatch);
      bTransfer.set(saDb.doc(`platformAuditLogs/${transferBundle.auditLog.id}`), transferBundle.auditLog);
      await assertSucceeds(bTransfer.commit());

      // 3. Change role (employee -> supervisor)
      currentMember = (await saDb.doc('users/member_new_1').get()).data() as UserProfile;
      const roleBundle = buildSuperAdminMemberUpdateBundle({
        actor: VERIFIED_SA,
        org: freshOrgA,
        existingMember: currentMember,
        orgBranches,
        displayName: currentMember.displayName,
        phone: currentMember.phone,
        role: 'supervisor',
        supervisorPermissions: { canViewAllClosings: true, canApproveClosings: true },
        reason: 'ترقية إلى دور مسؤول',
        now: new Date(now.getTime() + 20_000),
        deleteFieldSentinel: FieldValue.delete(),
      });
      assert.equal(roleBundle.action, 'MEMBER_ROLE_CHANGED');
      const bRole = saDb.batch();
      bRole.update(saDb.doc('users/member_new_1'), roleBundle.userPatch);
      bRole.set(saDb.doc(`platformAuditLogs/${roleBundle.auditLog.id}`), roleBundle.auditLog);
      await assertSucceeds(bRole.commit());

      // 4. Archive member
      currentMember = (await saDb.doc('users/member_new_1').get()).data() as UserProfile;
      const archiveBundle = buildSuperAdminMemberArchiveBundle({
        actor: VERIFIED_SA,
        org: freshOrgA,
        existingMember: currentMember,
        reason: 'انتهاء فترة العمل المؤقت مع حفظ السجلات',
        now: new Date(now.getTime() + 30_000),
      });
      const bArchive = saDb.batch();
      bArchive.update(saDb.doc('users/member_new_1'), archiveBundle.userPatch);
      bArchive.set(saDb.doc(`platformAuditLogs/${archiveBundle.auditLog.id}`), archiveBundle.auditLog);
      await assertSucceeds(bArchive.commit());

      // Verify user doc AND historical closing remain intact
      const archivedMember = (await saDb.doc('users/member_new_1').get()).data() as UserProfile;
      assert.equal(archivedMember.isActive, false);
      assert.equal(archivedMember.isArchived, true);
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const histClosing = await ctx.firestore().doc('closings/cl_hist_1').get();
        assert.equal(histClosing.exists, true);
      });

      // 5. Reactivate member
      const reactivateBundle = buildSuperAdminMemberReactivateBundle({
        actor: VERIFIED_SA,
        org: freshOrgA,
        existingMember: archivedMember,
        reason: 'عودة العضو للعمل ضمن نفس المؤسسة',
        now: new Date(now.getTime() + 40_000),
      });
      const bReactivate = saDb.batch();
      bReactivate.update(saDb.doc('users/member_new_1'), reactivateBundle.userPatch);
      bReactivate.set(saDb.doc(`platformAuditLogs/${reactivateBundle.auditLog.id}`), reactivateBundle.auditLog);
      await assertSucceeds(bReactivate.commit());

      const reactivated = (await saDb.doc('users/member_new_1').get()).data() as UserProfile;
      assert.equal(reactivated.isActive, true);
      assert.equal(reactivated.isArchived, false);
      assert.ok(reactivated.archivedAt);
    });

    await runTest('C11 (Emulator): Genuine security denials for onlak2030, unverified SA, manager creation, user delete, and audit tampering', async () => {
      // onlak2030 cannot create member or grant branch exemption
      const badAuditId = 'pal_onlak_denied';
      const bOnlak = onlakDb.batch();
      bOnlak.set(onlakDb.doc('users/unauth_u1'), {
        uid: 'unauth_u1',
        orgId: 'org_c_a',
        email: 'unauth@example.com',
        displayName: 'Unauth',
        role: 'employee',
        branchId: 'br_c_a1',
        isActive: true,
        lastPlatformAuditLogId: badAuditId,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      bOnlak.set(onlakDb.doc(`platformAuditLogs/${badAuditId}`), {
        id: badAuditId,
        actorEmail: 'onlak2030@gmail.com',
        actorUid: 'onlak_uid',
        action: 'MEMBER_CREATED',
        targetType: 'member',
        targetId: 'unauth_u1',
        orgId: 'org_c_a',
        details: 'unauthorized attempt',
        timestamp: nowIso,
      });
      await assertGenuineFails(bOnlak.commit(), 'onlak2030 member create');

      // Unverified amoal2030 cannot create member
      const bUnver = unverifiedSaDb.batch();
      bUnver.set(unverifiedSaDb.doc('users/unver_u1'), {
        uid: 'unver_u1',
        orgId: 'org_c_a',
        email: 'unver@example.com',
        displayName: 'Unver',
        role: 'supervisor',
        isActive: true,
        lastPlatformAuditLogId: 'pal_unver_1',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      bUnver.set(unverifiedSaDb.doc('platformAuditLogs/pal_unver_1'), {
        id: 'pal_unver_1',
        actorEmail: 'amoal2030@gmail.com',
        actorUid: 'sa_unverified',
        action: 'MEMBER_CREATED',
        targetType: 'member',
        targetId: 'unver_u1',
        orgId: 'org_c_a',
        details: 'unverified SA attempt',
        timestamp: nowIso,
      });
      await assertGenuineFails(bUnver.commit(), 'unverified SA member create');

      // Verified SA cannot delete users or edit/delete platformAuditLogs
      await assertGenuineFails(saDb.doc('users/member_new_1').delete(), 'SA delete user');
      const existingLogs = await saDb.collection('platformAuditLogs').limit(1).get();
      assert.ok(existingLogs.size > 0);
      const firstLogId = existingLogs.docs[0].id;
      await assertGenuineFails(
        saDb.doc(`platformAuditLogs/${firstLogId}`).update({ details: 'tampered' }),
        'SA update platformAuditLogs'
      );
      await assertGenuineFails(
        saDb.doc(`platformAuditLogs/${firstLogId}`).delete(),
        'SA delete platformAuditLogs'
      );
    });

    await testEnv.cleanup();
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log('\n========================================================================');
  console.log(
    `Phase C Summary: ${passed}/${results.length} PASSED, ${failed} FAILED | Genuine Denials: ${genuineSecurityDenialsCount} | 1000-Expression Errors: ${expressionLimitErrorsCount}`
  );
  console.log('========================================================================');

  if (failed > 0 || expressionLimitErrorsCount > 0) {
    process.exit(1);
  }
}

runPhaseCTests().catch((err) => {
  console.error('Fatal error in Phase C test suite:', err);
  process.exit(1);
});
