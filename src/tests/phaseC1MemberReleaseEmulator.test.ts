/**
 * Phase C.1 — Member Permanent Release & Cross-Organization Re-Assignment
 * Combined Unit Governance + Live Firestore Emulator Security Test Suite
 *
 * Verifies:
 *  - Unit checks for `superAdminGovernance.ts`, `tenantAccess.ts`, `InFlightActionGuard`, and legacy backward compatibility
 *  - Full 12-step end-to-end member lifecycle (Org A -> Archive -> Permanent Release -> Org B Re-assignment)
 *  - Atomic 3-document coupling (`users/{uid}` + `memberOrgHistory/{historyId}` + `platformAuditLogs/{auditLogId}`)
 *  - Strict historical record retention in Org A & complete cross-org data isolation
 *  - All mandatory negative security scenarios via `assertGenuineFails` (guaranteeing 0 CEL 1000-expression errors)
 *
 * Run with:
 *   firebase emulators:exec --only firestore "npx tsx src/tests/phaseC1MemberReleaseEmulator.test.ts"
 */
import * as fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

import {
  buildSuperAdminMemberReleaseBundle,
  buildSuperAdminAssignReleasedMemberBundle,
  buildSuperAdminMemberArchiveBundle,
  buildSuperAdminMemberReactivateBundle,
  buildSuperAdminMemberUpdateBundle,
  buildSuperAdminMemberCreateBundle,
  buildReleasedMemberZeroPermissions,
  isMemberEligibleForRelease,
  isMemberReleased,
  InFlightActionGuard,
  validateSuperAdminMemberCreateInput,
} from '../utils/superAdminGovernance';
import {
  resolveMemberMembershipStatus,
  resolveProfiledUserAccess,
  canRenderTenantDashboard,
} from '../utils/tenantAccess';
import { buildSuperAdminPlatformNotification } from '../utils/notifications';
import type { Branch, Organization, UserProfile } from '../types';

const Timestamp = firebase.firestore.Timestamp;
const FieldValue = firebase.firestore.FieldValue;

interface TestOutcome {
  name: string;
  passed: boolean;
  error?: string;
}

let genuineSecurityDenialsCount = 0;
let expressionLimitErrorsCount = 0;

/**
 * Guarantees a Firestore request fails due to a genuine security rule denial
 * and NEVER due to hitting the 1,000-expression CEL evaluation limit.
 */
async function assertGenuineFails<T>(promise: Promise<T>, label?: string): Promise<void> {
  const err = await assertFails(promise);
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('maximum of 1000 expressions')) {
    expressionLimitErrorsCount += 1;
    throw new Error(
      `FALSE-POSITIVE REJECTION (hit 1,000-expression limit)${label ? ` [${label}]` : ''}: ${msg}`
    );
  }
  genuineSecurityDenialsCount += 1;
}

function assertCondition(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrowsSync(fn: () => void, expectedSubstring: string, label: string): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    if (expectedSubstring && !msg.includes(expectedSubstring)) {
      throw new Error(
        `[${label}] Expected error containing "${expectedSubstring}", got: "${msg}"`
      );
    }
  }
  if (!threw) {
    throw new Error(`[${label}] Expected synchronous throw, but function succeeded.`);
  }
}

function parseEmulatorConfig(): { host: string; port: number } {
  const envHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (envHost) {
    const [rawHost, rawPort] = envHost.split(':');
    const parsedPort = Number(rawPort);
    if (rawHost && !Number.isNaN(parsedPort) && parsedPort > 0) {
      return { host: rawHost, port: parsedPort };
    }
  }
  return { host: '127.0.0.1', port: 8080 };
}

async function runPhaseC1Tests() {
  console.log('========================================================================');
  console.log('   PHASE C.1 — MEMBER PERMANENT RELEASE & RE-ASSIGNMENT TEST SUITE      ');
  console.log('========================================================================\n');

  const results: TestOutcome[] = [];

  async function runTest(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✅ PASS: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name, passed: false, error: msg });
      console.error(`❌ FAIL: ${name}\n   -> ${msg}`);
    }
  }

  // ========================================================================
  // PART 1: PURE UNIT TESTS (GOVERNANCE, TENANT ACCESS, CONCURRENCY, LEGACY)
  // ========================================================================
  console.log('--- PART 1: Governance, Tenant Access & Concurrency Unit Tests ---');

  const unitActor = {
    uid: 'sa_uid_1',
    email: 'amoal2030@gmail.com',
    emailVerified: true,
    displayName: 'صاحب المنصة',
  };

  const unitOrgA: Organization = {
    id: 'org_a',
    name: 'مؤسسة ألفا التجارية',
    activityType: 'retail',
    currency: 'SAR',
    ownerId: 'mgr_a',
    ownerEmail: 'owner.a@example.com',
    ownerName: 'مدير ألفا',
    driveConnected: false,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
  };

  const unitOrgB: Organization = {
    id: 'org_b',
    name: 'مؤسسة بيتا للخدمات',
    activityType: 'services',
    currency: 'SAR',
    ownerId: 'mgr_b',
    ownerEmail: 'owner.b@example.com',
    ownerName: 'مدير بيتا',
    driveConnected: false,
    isActive: true,
    createdAt: '2026-01-05T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
  };

  const unitOrgSuspended: Organization = {
    ...unitOrgB,
    id: 'org_suspended',
    name: 'مؤسسة موقوفة',
    isActive: false,
  };

  const unitOrgBBranches: Branch[] = [
    {
      id: 'br_b1',
      orgId: 'org_b',
      name: 'فرع بيتا الرئيسي',
      code: 'B1',
      isActive: true,
      lifecycleStatus: 'active',
      createdAt: '2026-01-05T08:00:00.000Z',
    },
    {
      id: 'br_b_purged',
      orgId: 'org_b',
      name: 'فرع بيتا محذوف',
      code: 'B2',
      isActive: false,
      lifecycleStatus: 'purged_from_db',
      createdAt: '2026-01-05T08:00:00.000Z',
    },
  ];

  const unitStaffA: UserProfile = {
    uid: 'emp_unit_1',
    orgId: 'org_a',
    email: 'staff.unit@example.com',
    displayName: 'موظف تجريبي',
    role: 'employee',
    branchId: 'br_a1',
    branchName: 'فرع ألفا 1',
    isActive: true,
    isArchived: false,
    permissions: {
      canCreateClosing: true,
      canViewAllClosings: false,
      canApproveClosings: false,
      canManageBranches: false,
      canManageEmployees: false,
      canExportReports: false,
    },
    createdAt: '2026-02-01T09:00:00.000Z',
  };

  await runTest('U1. Backward compatibility: legacy profiles without membershipStatus resolve accurately', () => {
    const legacyActive: UserProfile = { ...unitStaffA };
    delete legacyActive.membershipStatus;
    assertCondition(resolveMemberMembershipStatus(legacyActive) === 'active', 'Legacy active should resolve to active');

    const legacyArchived: UserProfile = { ...unitStaffA, isActive: false, isArchived: true };
    delete legacyArchived.membershipStatus;
    assertCondition(resolveMemberMembershipStatus(legacyArchived) === 'archived', 'Legacy archived should resolve to archived');

    const legacyReleasedWithTimestamp: UserProfile = {
      ...unitStaffA,
      orgId: '',
      isActive: false,
      isArchived: false,
      releasedAt: '2026-11-20T10:00:00.000Z',
    };
    delete legacyReleasedWithTimestamp.membershipStatus;
    assertCondition(
      resolveMemberMembershipStatus(legacyReleasedWithTimestamp) === 'released',
      'Empty orgId + inactive + releasedAt should resolve to released'
    );

    const explicitReleased: UserProfile = {
      ...unitStaffA,
      orgId: '',
      isActive: false,
      isArchived: false,
      membershipStatus: 'released',
    };
    assertCondition(isMemberReleased(explicitReleased) === true, 'Explicit released should be detected');
  });

  await runTest('U2. Tenant access routing: released member gets dedicated membership_released reason & blocked dashboard', () => {
    const releasedProfile: UserProfile = {
      ...unitStaffA,
      orgId: '',
      isActive: false,
      isArchived: false,
      membershipStatus: 'released',
      releasedFromOrgId: 'org_a',
      releasedFromOrgName: unitOrgA.name,
    };

    const resReleased = resolveProfiledUserAccess({ profile: releasedProfile, org: null });
    assertCondition(
      resReleased.status === 'access_error' && resReleased.errorReason === 'membership_released',
      `Expected access_error/membership_released, got ${JSON.stringify(resReleased)}`
    );
    assertCondition(
      canRenderTenantDashboard({
        tenantStatus: 'access_error',
        hasAuthUser: true,
        userProfile: releasedProfile,
        currentOrg: null,
        subscriptionEvaluation: null,
      }) === false,
      'Released user must never render tenant dashboard'
    );

    const archivedProfile: UserProfile = {
      ...unitStaffA,
      isActive: false,
      isArchived: true,
      membershipStatus: 'archived',
    };
    const resArchived = resolveProfiledUserAccess({ profile: archivedProfile, org: unitOrgA });
    assertCondition(
      resArchived.status === 'access_error' && resArchived.errorReason === 'account_archived',
      `Archived member should get account_archived, got ${resArchived.status === 'access_error' ? resArchived.errorReason : resArchived.status}`
    );

    const disabledProfile: UserProfile = {
      ...unitStaffA,
      isActive: false,
      isArchived: false,
      membershipStatus: 'active',
    };
    const resDisabled = resolveProfiledUserAccess({ profile: disabledProfile, org: unitOrgA });
    assertCondition(
      resDisabled.status === 'access_error' && resDisabled.errorReason === 'account_disabled',
      `Disabled non-archived member should get account_disabled, got ${resDisabled.status === 'access_error' ? resDisabled.errorReason : resDisabled.status}`
    );

    const resActive = resolveProfiledUserAccess({ profile: unitStaffA, org: unitOrgA });
    assertCondition(resActive.status === 'active_tenant', 'Active member should get active_tenant');
  });

  await runTest('U3. Release eligibility & governance builders enforce strict owner/manager/SA/status guards', () => {
    assertCondition(isMemberEligibleForRelease(unitStaffA, unitOrgA) === true, 'Regular staff should be eligible');

    const managerProfile: UserProfile = { ...unitStaffA, uid: 'mgr_a', role: 'manager', email: 'owner.a@example.com' };
    assertCondition(isMemberEligibleForRelease(managerProfile, unitOrgA) === false, 'Manager must not be eligible');

    const ownerEmailStaff: UserProfile = { ...unitStaffA, uid: 'other_uid', role: 'supervisor', email: 'OWNER.A@example.com' };
    assertCondition(isMemberEligibleForRelease(ownerEmailStaff, unitOrgA) === false, 'Org ownerEmail must not be eligible');

    const saProfile: UserProfile = { ...unitStaffA, email: 'amoal2030@gmail.com' };
    assertCondition(isMemberEligibleForRelease(saProfile, unitOrgA) === false, 'Super Admin must not be eligible');

    // Release bundle verification
    const relBundle = buildSuperAdminMemberReleaseBundle({
      actor: unitActor,
      org: unitOrgA,
      existingMember: unitStaffA,
      reason: 'انتهاء خدمة الموظف وانتقاله لمؤسسة أخرى',
      deleteFieldSentinel: '__DELETE__',
    });
    assertCondition(relBundle.userPatch.orgId === '', 'Release must set orgId to empty string');
    assertCondition(relBundle.userPatch.membershipStatus === 'released', 'Release must set membershipStatus to released');
    assertCondition(relBundle.userPatch.isActive === false && relBundle.userPatch.isArchived === false, 'Release must set isActive=false, isArchived=false');
    assertCondition(relBundle.userPatch.branchId === '__DELETE__' && relBundle.userPatch.branchIds === '__DELETE__', 'Release must remove branch bindings');
    assertCondition(relBundle.userPatch.archivedAt === '__DELETE__' && relBundle.userPatch.archivedBy === '__DELETE__', 'Release must remove archivedAt & archivedBy');
    assertCondition(relBundle.historyRecord.joinedAt === unitStaffA.createdAt, 'Initial release joinedAt must fall back to createdAt');
    assertCondition(
      JSON.stringify(relBundle.userPatch.permissions) === JSON.stringify(buildReleasedMemberZeroPermissions()),
      'Release must zero all operational permissions'
    );
    assertCondition(relBundle.historyRecord.eventType === 'released', 'History event must be released');
    assertCondition(relBundle.auditLog.action === 'MEMBER_ORG_MEMBERSHIP_RELEASED', 'Audit action must be MEMBER_ORG_MEMBERSHIP_RELEASED');
    assertCondition(
      relBundle.historyRecord.auditLogId === relBundle.auditLog.id &&
        relBundle.userPatch.lastMemberOrgHistoryId === relBundle.historyRecord.id &&
        relBundle.userPatch.lastPlatformAuditLogId === relBundle.auditLog.id,
      '3-way atomic IDs must match'
    );

    const releasedMember: UserProfile = {
      ...unitStaffA,
      orgId: '',
      membershipStatus: 'released',
      isActive: false,
      isArchived: false,
      branchId: undefined,
      branchIds: undefined,
      branchName: undefined,
      permissions: buildReleasedMemberZeroPermissions(),
      releasedFromOrgId: 'org_a',
      releasedFromOrgName: unitOrgA.name,
      releasedAt: relBundle.historyRecord.effectiveAt,
      releasedBy: 'amoal2030@gmail.com',
      releaseReason: relBundle.historyRecord.reason,
    };

    // Reactivate / Update / Archive must all reject released members
    assertThrowsSync(
      () =>
        buildSuperAdminMemberReactivateBundle({
          actor: unitActor,
          org: unitOrgA,
          existingMember: releasedMember,
        }),
      'فصل عضويته نهائياً',
      'Reject reactivating released member'
    );
    assertThrowsSync(
      () =>
        buildSuperAdminMemberArchiveBundle({
          actor: unitActor,
          org: unitOrgA,
          existingMember: releasedMember,
          reason: 'محاولة أرشفة عضو محرر',
        }),
      'محرر نهائياً',
      'Reject archiving released member'
    );
    assertThrowsSync(
      () =>
        buildSuperAdminMemberUpdateBundle({
          actor: unitActor,
          org: unitOrgA,
          existingMember: releasedMember,
          orgBranches: [],
          displayName: 'تعديل مرفوض',
          role: 'employee',
          deleteFieldSentinel: '__DELETE__',
        }),
      'محرر نهائياً',
      'Reject updating released member'
    );

    // Assign rejects non-released, suspended org, foreign branch, purged branch, manager role
    assertThrowsSync(
      () =>
        buildSuperAdminAssignReleasedMemberBundle({
          actor: unitActor,
          existingMember: { ...unitStaffA, isActive: false, isArchived: true, membershipStatus: 'archived' },
          targetOrg: unitOrgB,
          targetOrgBranches: unitOrgBBranches,
          role: 'employee',
          branchId: 'br_b1',
          deleteFieldSentinel: '__DELETE__',
        }),
      'قبل فصل عضويته نهائياً',
      'Reject assigning archived member before release'
    );
    assertThrowsSync(
      () =>
        buildSuperAdminAssignReleasedMemberBundle({
          actor: unitActor,
          existingMember: releasedMember,
          targetOrg: unitOrgSuspended,
          targetOrgBranches: unitOrgBBranches,
          role: 'employee',
          branchId: 'br_b1',
          deleteFieldSentinel: '__DELETE__',
        }),
      'موقوفة أو غير نشطة',
      'Reject assigning to suspended org'
    );
    assertThrowsSync(
      () =>
        buildSuperAdminAssignReleasedMemberBundle({
          actor: unitActor,
          existingMember: releasedMember,
          targetOrg: unitOrgB,
          targetOrgBranches: unitOrgBBranches,
          role: 'employee',
          branchId: 'br_a1',
          deleteFieldSentinel: '__DELETE__',
        }),
      'لا يتبع للمؤسسة الجديدة',
      'Reject foreign branch assignment'
    );
    assertThrowsSync(
      () =>
        buildSuperAdminAssignReleasedMemberBundle({
          actor: unitActor,
          existingMember: releasedMember,
          targetOrg: unitOrgB,
          targetOrgBranches: unitOrgBBranches,
          role: 'employee',
          branchId: 'br_b_purged',
          deleteFieldSentinel: '__DELETE__',
        }),
      'فرع محذوف',
      'Reject purged branch assignment'
    );
    assertThrowsSync(
      () =>
        buildSuperAdminAssignReleasedMemberBundle({
          actor: unitActor,
          existingMember: releasedMember,
          targetOrg: unitOrgB,
          targetOrgBranches: unitOrgBBranches,
          role: 'manager',
          deleteFieldSentinel: '__DELETE__',
        }),
      'الأدوار المسموحة',
      'Reject manager role on re-assignment'
    );

    // Valid assign bundle starts with fresh permissions and purges previous-org release & archive metadata from users/{uid}
    const asgBundle = buildSuperAdminAssignReleasedMemberBundle({
      actor: unitActor,
      existingMember: releasedMember,
      targetOrg: unitOrgB,
      targetOrgBranches: unitOrgBBranches,
      role: 'supervisor',
      supervisorPermissions: { canViewFinancialReports: true, canApproveClosings: false },
      reason: 'انضمام الموظف رسمياً لمؤسسة بيتا بصفة مشرف تقارير',
      deleteFieldSentinel: '__DELETE__',
    });
    assertCondition(asgBundle.userPatch.orgId === 'org_b', 'Target orgId must be org_b');
    assertCondition(asgBundle.userPatch.membershipStatus === 'active', 'Re-assigned status must be active');
    assertCondition(asgBundle.userPatch.isActive === true && asgBundle.userPatch.isArchived === false, 'Re-assigned flags must be active');
    assertCondition(
      asgBundle.userPatch.archivedAt === '__DELETE__' &&
        asgBundle.userPatch.archivedBy === '__DELETE__' &&
        asgBundle.userPatch.releasedFromOrgId === '__DELETE__' &&
        asgBundle.userPatch.releasedFromOrgName === '__DELETE__' &&
        asgBundle.userPatch.releasedAt === '__DELETE__' &&
        asgBundle.userPatch.releasedBy === '__DELETE__' &&
        asgBundle.userPatch.releaseReason === '__DELETE__',
      'Assign must purge archivedAt/archivedBy and all previous-org release fields from users/{uid}'
    );
    assertCondition(
      (asgBundle.userPatch.permissions as Record<string, boolean>).canCreateClosing === false &&
        (asgBundle.userPatch.permissions as Record<string, boolean>).canViewFinancialReports === true,
      'Fresh supervisor permissions must NOT carry over old employee canCreateClosing=true'
    );
    assertCondition(asgBundle.historyRecord.eventType === 'assigned', 'History event must be assigned');
    assertCondition(asgBundle.historyRecord.previousOrgId === 'org_a', 'History should record previousOrgId=org_a');
    assertCondition(asgBundle.auditLog.action === 'MEMBER_ORG_MEMBERSHIP_ASSIGNED', 'Audit action must be MEMBER_ORG_MEMBERSHIP_ASSIGNED');

    // Second release (from Org B) must use reassignedAt for joinedAt, NOT original createdAt
    const reassignedInB: UserProfile = {
      ...unitStaffA,
      orgId: 'org_b',
      role: 'supervisor',
      isActive: true,
      isArchived: false,
      membershipStatus: 'active',
      reassignedAt: '2026-06-15T12:00:00.000Z',
      reassignedBy: 'amoal2030@gmail.com',
    };
    const secondRelBundle = buildSuperAdminMemberReleaseBundle({
      actor: unitActor,
      org: unitOrgB,
      existingMember: reassignedInB,
      reason: 'فصل ثانٍ من مؤسسة بيتا للانتقال إلى مؤسسة ثالثة',
      deleteFieldSentinel: '__DELETE__',
    });
    assertCondition(
      secondRelBundle.historyRecord.joinedAt === '2026-06-15T12:00:00.000Z',
      `Expected second release joinedAt to equal reassignedAt, got ${secondRelBundle.historyRecord.joinedAt}`
    );
    assertCondition(
      secondRelBundle.historyRecord.joinedAt !== reassignedInB.createdAt,
      'Second release joinedAt must NOT reuse Org A createdAt when reassignedAt exists'
    );
  });

  await runTest('U4. InFlightActionGuard blocks duplicate concurrent release/assign actions', async () => {
    const guard = new InFlightActionGuard();
    let releaseFirst!: () => void;
    const firstPromise = guard.runExclusive('sa_member_release:emp_1', async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return 'done';
    });

    let duplicateRejected = false;
    try {
      await guard.runExclusive('sa_member_release:emp_1', async () => 'duplicate');
    } catch (err) {
      duplicateRejected = true;
      const msg = err instanceof Error ? err.message : String(err);
      assertCondition(msg.includes('قيد التنفيذ'), `Unexpected duplicate error: ${msg}`);
    }
    assertCondition(duplicateRejected, 'Duplicate concurrent release must be rejected');
    releaseFirst();
    const res = await firstPromise;
    assertCondition(res === 'done', 'First exclusive call must finish cleanly');
    assertCondition(!guard.isRunning('sa_member_release:emp_1'), 'Guard must unlock after completion');
  });

  // ========================================================================
  // PART 2: LIVE FIRESTORE EMULATOR TESTS (12-STEP LIFECYCLE + SECURITY)
  // ========================================================================
  console.log('\n--- PART 2: Live Firestore Emulator Security & Lifecycle Tests ---');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-phasec1-member-release',
    firestore: {
      rules: rulesContent,
      host,
      port,
    },
  });

  await testEnv.clearFirestore();

  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const tsPast30d = Timestamp.fromMillis(nowMs - 30 * oneDayMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);
  const todayDate = new Date(nowMs).toISOString().slice(0, 10);
  const todayYM = todayDate.slice(0, 7);
  const baseIso = new Date(nowMs - 60_000).toISOString();

  // Seed organizations, branches, managers, legacy user, and negative-test users
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await db.doc('organizations/org_a').set({
      id: 'org_a',
      name: 'مؤسسة ألفا التجارية',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_a',
      ownerEmail: 'owner.a@example.com',
      ownerName: 'مدير ألفا',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: baseIso,
    });

    await db.doc('organizations/org_b').set({
      id: 'org_b',
      name: 'مؤسسة بيتا للخدمات',
      activityType: 'services',
      currency: 'SAR',
      ownerId: 'mgr_b',
      ownerEmail: 'owner.b@example.com',
      ownerName: 'مدير بيتا',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-01-05T08:00:00.000Z',
      updatedAt: baseIso,
    });

    await db.doc('organizations/org_suspended').set({
      id: 'org_suspended',
      name: 'مؤسسة غاما الموقوفة',
      activityType: 'other',
      currency: 'SAR',
      ownerId: 'mgr_s',
      ownerEmail: 'owner.s@example.com',
      ownerName: 'مدير غاما',
      driveConnected: false,
      isActive: false,
      subscriptionPlan: '1m',
      subscriptionStatus: 'suspended',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: baseIso,
    });

    await db.doc('branches/br_a1').set({
      id: 'br_a1',
      orgId: 'org_a',
      name: 'فرع ألفا الأول',
      code: 'A1',
      isActive: true,
      lifecycleStatus: 'active',
      paymentStatus: 'paid',
      createdAt: '2026-01-01T08:00:00.000Z',
    });

    await db.doc('branches/br_b1').set({
      id: 'br_b1',
      orgId: 'org_b',
      name: 'فرع بيتا الرئيسي',
      code: 'B1',
      isActive: true,
      lifecycleStatus: 'active',
      paymentStatus: 'paid',
      createdAt: '2026-01-05T08:00:00.000Z',
    });

    await db.doc('branches/br_s1').set({
      id: 'br_s1',
      orgId: 'org_suspended',
      name: 'فرع غاما',
      code: 'S1',
      isActive: true,
      lifecycleStatus: 'active',
      paymentStatus: 'paid',
      createdAt: '2026-01-10T08:00:00.000Z',
    });

    // Org A & Org B managers
    await db.doc('users/mgr_a').set({
      uid: 'mgr_a',
      orgId: 'org_a',
      email: 'owner.a@example.com',
      displayName: 'مدير ألفا',
      role: 'manager',
      isActive: true,
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
      createdAt: '2026-01-01T08:00:00.000Z',
    });

    await db.doc('users/mgr_b').set({
      uid: 'mgr_b',
      orgId: 'org_b',
      email: 'owner.b@example.com',
      displayName: 'مدير بيتا',
      role: 'manager',
      isActive: true,
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
      createdAt: '2026-01-05T08:00:00.000Z',
    });

    // Active supervisor in Org A (for non-SA negative tests)
    await db.doc('users/sup_a').set({
      uid: 'sup_a',
      orgId: 'org_a',
      email: 'sup.a@example.com',
      displayName: 'مشرف ألفا',
      role: 'supervisor',
      isActive: true,
      isArchived: false,
      membershipStatus: 'active',
      permissions: {
        canCreateClosing: true,
        canViewAllClosings: true,
        canApproveClosings: true,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: true,
      },
      createdAt: '2026-01-02T08:00:00.000Z',
    });

    // Edge-case staff whose email matches org_a.ownerEmail (must be blocked from release by rules)
    await db.doc('users/owner_email_staff').set({
      uid: 'owner_email_staff',
      orgId: 'org_a',
      email: 'owner.a@example.com',
      displayName: 'حساب ببريد المالك',
      role: 'supervisor',
      isActive: true,
      isArchived: false,
      membershipStatus: 'active',
      permissions: { canViewAllClosings: true },
      createdAt: '2026-01-03T08:00:00.000Z',
    });

    // Edge-case user doc with Super Admin email (must be blocked from release by rules)
    await db.doc('users/sa_shadow_doc').set({
      uid: 'sa_shadow_doc',
      orgId: 'org_a',
      email: 'amoal2030@gmail.com',
      displayName: 'مدير المنصة',
      role: 'supervisor',
      isActive: true,
      isArchived: false,
      createdAt: '2026-01-03T08:00:00.000Z',
    });

    // Legacy employee doc WITHOUT membershipStatus field (backward compatibility test)
    await db.doc('users/emp_legacy_a').set({
      uid: 'emp_legacy_a',
      orgId: 'org_a',
      email: 'legacy.emp@example.com',
      displayName: 'موظف قديم بدون حقل حالة',
      role: 'employee',
      branchId: 'br_a1',
      branchName: 'فرع ألفا الأول',
      isActive: true,
      isArchived: false,
      permissions: {
        canCreateClosing: true,
        canViewAllClosings: false,
        canApproveClosings: false,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: false,
      },
      createdAt: '2026-01-04T08:00:00.000Z',
    });

    // Pre-released employee specifically for negative assign tests (without interfering with main 12-step user)
    await db.doc('users/emp_released_neg').set({
      uid: 'emp_released_neg',
      orgId: '',
      email: 'released.neg@example.com',
      displayName: 'موظف محرر لاختبارات المنع',
      role: 'employee',
      isActive: false,
      isArchived: false,
      membershipStatus: 'released',
      permissions: buildReleasedMemberZeroPermissions(),
      releasedFromOrgId: 'org_a',
      releasedFromOrgName: 'مؤسسة ألفا التجارية',
      releasedAt: baseIso,
      releasedBy: 'amoal2030@gmail.com',
      releaseReason: 'فصل مسبق لاختبارات الأمان السلبية',
      lastMemberOrgHistoryId: 'moh_seed_neg',
      lastPlatformAuditLogId: 'pal_seed_neg',
      createdAt: '2026-01-04T08:00:00.000Z',
      updatedAt: baseIso,
    });
  });

  const superAdminCtx = testEnv.authenticatedContext('sa_uid_1', {
    email: 'amoal2030@gmail.com',
    email_verified: true,
  });
  const unverifiedSuperAdminCtx = testEnv.authenticatedContext('sa_unverified', {
    email: 'amoal2030@gmail.com',
    email_verified: false,
  });
  const mgrACtx = testEnv.authenticatedContext('mgr_a', {
    email: 'owner.a@example.com',
    email_verified: true,
  });
  const mgrBCtx = testEnv.authenticatedContext('mgr_b', {
    email: 'owner.b@example.com',
    email_verified: true,
  });
  const supACtx = testEnv.authenticatedContext('sup_a', {
    email: 'sup.a@example.com',
    email_verified: true,
  });
  const empTransferCtx = testEnv.authenticatedContext('emp_transfer_1', {
    email: 'transfer.emp@example.com',
    email_verified: true,
  });
  const empLegacyCtx = testEnv.authenticatedContext('emp_legacy_a', {
    email: 'legacy.emp@example.com',
    email_verified: true,
  });
  const empReleasedNegCtx = testEnv.authenticatedContext('emp_released_neg', {
    email: 'released.neg@example.com',
    email_verified: true,
  });

  const saDb = superAdminCtx.firestore();
  const unverifiedSaDb = unverifiedSuperAdminCtx.firestore();
  const mgrADb = mgrACtx.firestore();
  const mgrBDb = mgrBCtx.firestore();
  const supADb = supACtx.firestore();
  const empTransferDb = empTransferCtx.firestore();
  const empLegacyDb = empLegacyCtx.firestore();
  const empReleasedNegDb = empReleasedNegCtx.firestore();

  const orgABranches: Branch[] = [
    {
      id: 'br_a1',
      orgId: 'org_a',
      name: 'فرع ألفا الأول',
      code: 'A1',
      isActive: true,
      lifecycleStatus: 'active',
      createdAt: '2026-01-01T08:00:00.000Z',
    },
  ];
  const orgBBranches: Branch[] = [
    {
      id: 'br_b1',
      orgId: 'org_b',
      name: 'فرع بيتا الرئيسي',
      code: 'B1',
      isActive: true,
      lifecycleStatus: 'active',
      createdAt: '2026-01-05T08:00:00.000Z',
    },
  ];

  let currentEmpDoc: UserProfile | null = null;
  let releaseHistoryId = '';
  let releaseAuditLogId = '';
  let assignHistoryId = '';
  let assignAuditLogId = '';

  // Step 1: Add employee to Org A
  await runTest('Step 1. Super Admin adds emp_transfer_1 to Org A with active membershipStatus & atomic MEMBER_CREATED', async () => {
    const validated = validateSuperAdminMemberCreateInput({
      actor: unitActor,
      org: unitOrgA,
      orgBranches: orgABranches,
      displayName: 'خالد المنتقل',
      email: 'transfer.emp@example.com',
      password: 'TempPassword123!',
      phone: '0551234567',
      role: 'employee',
      branchId: 'br_a1',
    });
    const { userDoc, auditLog } = buildSuperAdminMemberCreateBundle({
      actor: unitActor,
      org: unitOrgA,
      newUid: 'emp_transfer_1',
      validated,
      auditLogId: 'pal_c1_create_1',
    });

    const batch = saDb.batch();
    batch.set(saDb.doc('users/emp_transfer_1'), userDoc);
    batch.set(saDb.doc(`platformAuditLogs/${auditLog.id}`), auditLog);
    await assertSucceeds(batch.commit());

    const snap = await assertSucceeds(saDb.doc('users/emp_transfer_1').get());
    currentEmpDoc = snap.data() as UserProfile;
    assertCondition(currentEmpDoc.orgId === 'org_a', 'orgId should be org_a');
    assertCondition(currentEmpDoc.membershipStatus === 'active', 'membershipStatus should be active');
    assertCondition(currentEmpDoc.isActive === true, 'isActive should be true');
  });

  // Step 2: Create historical operational & financial records for emp_transfer_1 in Org A
  await runTest('Step 2. Seed & verify operational historical records for emp_transfer_1 inside Org A', async () => {
    // Employee creates their own real shift closing + auditLog + closingArchive in Org A via rules
    const closingIso = new Date().toISOString();
    const empBatch = empTransferDb.batch();
    empBatch.set(empTransferDb.doc('closings/cls_org_a_1'), {
      id: 'cls_org_a_1',
      orgId: 'org_a',
      branchId: 'br_a1',
      branchName: 'فرع ألفا الأول',
      employeeId: 'emp_transfer_1',
      employeeName: 'خالد المنتقل',
      date: todayDate,
      period: 'morning',
      cashSales: 1000,
      cardSales: 500,
      expenses: 100,
      totalSales: 1500,
      remainingInBox: 900,
      netPeriod: 1400,
      status: 'pending_review',
      createdAt: closingIso,
      updatedAt: closingIso,
    });
    empBatch.set(empTransferDb.doc('auditLogs/alog_org_a_1'), {
      id: 'alog_org_a_1',
      orgId: 'org_a',
      actorId: 'emp_transfer_1',
      actorName: 'خالد المنتقل',
      actorRole: 'employee',
      action: 'CLOSING_SUBMITTED_FOR_REVIEW',
      targetType: 'closing',
      targetId: 'cls_org_a_1',
      details: 'تقديم إقفال صباحي للمراجعة في فرع ألفا الأول',
      timestamp: closingIso,
    });
    empBatch.set(empTransferDb.doc('closingArchives/cls_org_a_1'), {
      closingId: 'cls_org_a_1',
      orgId: 'org_a',
      branchId: 'br_a1',
      yearMonth: todayYM,
      archiveStatus: 'pending_drive_sync',
      updatedAt: closingIso,
    });
    await assertSucceeds(empBatch.commit());

    // Seed remaining historical Org A collections (purchases, attachments, notifications) referencing emp_transfer_1
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('purchases/pur_org_a_1').set({
        id: 'pur_org_a_1',
        orgId: 'org_a',
        branchId: 'br_a1',
        branchName: 'فرع ألفا الأول',
        supplierId: 'sup_vendor_a',
        supplierName: 'مورد ألفا',
        invoiceNumber: 'INV-A-1001',
        invoiceDate: todayDate,
        totalAmount: 350,
        paymentMethod: 'cash',
        createdBy: 'emp_transfer_1',
        createdByName: 'خالد المنتقل',
        createdByRole: 'employee',
        createdAt: closingIso,
        updatedAt: closingIso,
      });
      await db.doc('attachments/att_org_a_1').set({
        id: 'att_org_a_1',
        orgId: 'org_a',
        closingId: 'cls_org_a_1',
        branchId: 'br_a1',
        uploadedBy: 'emp_transfer_1',
        fileName: 'receipt_a1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12000,
        driveFileId: 'drive_file_a1',
        createdAt: closingIso,
      });
      await db.doc('notifications/notif_org_a_1').set({
        id: 'notif_org_a_1',
        dedupKey: 'hist_org_a_emp_1',
        category: 'closings',
        type: 'CLOSING_APPROVED',
        severity: 'success',
        audienceScope: 'user',
        orgId: 'org_a',
        branchId: 'br_a1',
        recipientUid: 'emp_transfer_1',
        feedKeys: ['user:org_a:emp_transfer_1'],
        actorUid: 'mgr_a',
        actorName: 'مدير ألفا',
        actorRole: 'manager',
        title: 'تم اعتماد إقفالك',
        body: 'تم اعتماد الإقفال الصباحي في مؤسسة ألفا',
        targetType: 'closing',
        targetId: 'cls_org_a_1',
        readBy: {},
        isRead: false,
        createdAt: closingIso,
        updatedAt: closingIso,
      });
    });

    await assertSucceeds(empTransferDb.doc('closings/cls_org_a_1').get());
  });

  // Step 3: Archive employee in Org A (confirm archive != release)
  await runTest('Step 3. Super Admin archives emp_transfer_1 in Org A (membershipStatus=archived, orgId stays org_a)', async () => {
    assertCondition(currentEmpDoc !== null, 'currentEmpDoc missing');
    const { userPatch, auditLog } = buildSuperAdminMemberArchiveBundle({
      actor: unitActor,
      org: unitOrgA,
      existingMember: currentEmpDoc!,
      reason: 'أرشفة مؤقتة بعد انتهاء العقد قبل قرار الفصل النهائي',
      auditLogId: 'pal_c1_archive_1',
    });

    const batch = saDb.batch();
    batch.update(saDb.doc('users/emp_transfer_1'), userPatch);
    batch.set(saDb.doc(`platformAuditLogs/${auditLog.id}`), auditLog);
    await assertSucceeds(batch.commit());

    const snap = await assertSucceeds(saDb.doc('users/emp_transfer_1').get());
    currentEmpDoc = snap.data() as UserProfile;
    assertCondition(currentEmpDoc.orgId === 'org_a', 'Archived member must retain orgId=org_a');
    assertCondition(currentEmpDoc.membershipStatus === 'archived', 'Archived member must have membershipStatus=archived');
    assertCondition(currentEmpDoc.isArchived === true && currentEmpDoc.isActive === false, 'Archived flags mismatch');
  });

  // Step 4: Attempt to add/assign archived member to Org B before permanent release -> DENIED
  await runTest('Step 4. Attempt to assign archived emp_transfer_1 to Org B BEFORE permanent release is genuinely denied', async () => {
    const nowIso = new Date().toISOString();
    const batch = saDb.batch();
    batch.update(saDb.doc('users/emp_transfer_1'), {
      orgId: 'org_b',
      role: 'employee',
      branchId: 'br_b1',
      branchName: 'فرع بيتا الرئيسي',
      membershipStatus: 'active',
      isActive: true,
      isArchived: false,
      reassignedAt: nowIso,
      reassignedBy: 'amoal2030@gmail.com',
      lastMemberOrgHistoryId: 'moh_premature_1',
      lastPlatformAuditLogId: 'pal_premature_1',
      updatedAt: nowIso,
    });
    batch.set(saDb.doc('memberOrgHistory/moh_premature_1'), {
      id: 'moh_premature_1',
      eventType: 'assigned',
      uid: 'emp_transfer_1',
      email: 'transfer.emp@example.com',
      displayName: 'خالد المنتقل',
      orgId: 'org_b',
      orgName: unitOrgB.name,
      role: 'employee',
      branchId: 'br_b1',
      branchName: 'فرع بيتا الرئيسي',
      effectiveAt: nowIso,
      actorUid: 'sa_uid_1',
      actorEmail: 'amoal2030@gmail.com',
      reason: 'محاولة ربط مبكرة قبل الفصل النهائي',
      auditLogId: 'pal_premature_1',
      createdAt: nowIso,
    });
    batch.set(saDb.doc('platformAuditLogs/pal_premature_1'), {
      id: 'pal_premature_1',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'sa_uid_1',
      action: 'MEMBER_ORG_MEMBERSHIP_ASSIGNED',
      targetType: 'member',
      targetId: 'emp_transfer_1',
      orgId: 'org_b',
      details: 'محاولة ربط مبكرة لعضو مؤرشف لم يُفصل نهائياً',
      metadata: { historyId: 'moh_premature_1' },
      timestamp: nowIso,
    });

    await assertGenuineFails(batch.commit(), 'Assign archived member before release');
  });

  // Step 5: Permanently release emp_transfer_1 from Org A (atomic 3-doc + SA notification)
  await runTest('Step 5. Super Admin permanently releases emp_transfer_1 from Org A atomically', async () => {
    assertCondition(currentEmpDoc !== null, 'currentEmpDoc missing');
    const now = new Date();
    const { userPatch, historyRecord, auditLog } = buildSuperAdminMemberReleaseBundle({
      actor: unitActor,
      org: unitOrgA,
      existingMember: currentEmpDoc!,
      reason: 'فصل نهائي بناءً على انتهاء عمل الموظف في مؤسسة ألفا وانتقاله',
      now,
      historyId: 'moh_rel_c1_1',
      auditLogId: 'pal_rel_c1_1',
      deleteFieldSentinel: FieldValue.delete(),
    });
    releaseHistoryId = historyRecord.id;
    releaseAuditLogId = auditLog.id;

    const saNotif = buildSuperAdminPlatformNotification({
      dedupKey: `sa_member_released:emp_transfer_1:${auditLog.id}`,
      category: 'security_admin',
      type: 'SA_MEMBER_RELEASED',
      severity: 'warning',
      relatedOrgId: 'org_a',
      actorUid: 'sa_uid_1',
      actorName: 'صاحب المنصة',
      title: 'فصل عضوية خالد المنتقل نهائياً',
      body: 'تم فصل العضو نهائياً عن مؤسسة ألفا مع حفظ السجلات التاريخية.',
      targetType: 'organization',
      targetId: 'org_a',
      tab: 'members',
      createdAt: now.toISOString(),
    });

    const batch = saDb.batch();
    batch.update(saDb.doc('users/emp_transfer_1'), userPatch);
    batch.set(saDb.doc(`memberOrgHistory/${historyRecord.id}`), historyRecord);
    batch.set(saDb.doc(`platformAuditLogs/${auditLog.id}`), auditLog);
    batch.set(saDb.doc(`notifications/${saNotif.id}`), saNotif);
    await assertSucceeds(batch.commit());
  });

  // Step 6: Verify released profile preserves identity, zeroes permissions, detaches org & branch, and routes to membership_released
  await runTest('Step 6. Released emp_transfer_1 preserves UID/email/createdAt, detaches org/branch, zeroes perms & gets membership_released', async () => {
    const snap = await assertSucceeds(saDb.doc('users/emp_transfer_1').get());
    currentEmpDoc = snap.data() as UserProfile;

    assertCondition(currentEmpDoc.uid === 'emp_transfer_1', 'UID must be preserved');
    assertCondition(currentEmpDoc.email === 'transfer.emp@example.com', 'Email must be preserved');
    assertCondition(currentEmpDoc.displayName === 'خالد المنتقل', 'DisplayName must be preserved');
    assertCondition(Boolean(currentEmpDoc.createdAt), 'createdAt must be preserved');
    assertCondition(currentEmpDoc.orgId === '', 'orgId must be empty string');
    assertCondition(currentEmpDoc.membershipStatus === 'released', 'membershipStatus must be released');
    assertCondition(currentEmpDoc.isActive === false && currentEmpDoc.isArchived === false, 'isActive & isArchived must both be false');
    assertCondition(!('branchId' in currentEmpDoc) && !('branchIds' in currentEmpDoc) && !('branchName' in currentEmpDoc), 'Branch fields must be removed');
    assertCondition(currentEmpDoc.releasedFromOrgId === 'org_a', 'releasedFromOrgId must be org_a');
    assertCondition(currentEmpDoc.releasedBy === 'amoal2030@gmail.com', 'releasedBy must be Super Admin');
    assertCondition(currentEmpDoc.lastMemberOrgHistoryId === releaseHistoryId, 'lastMemberOrgHistoryId mismatch');
    assertCondition(currentEmpDoc.lastPlatformAuditLogId === releaseAuditLogId, 'lastPlatformAuditLogId mismatch');
    const perms = currentEmpDoc.permissions as unknown as Record<string, boolean>;
    assertCondition(Object.values(perms).every((v) => v === false), 'All operational permissions must be false');

    const accessDecision = resolveProfiledUserAccess({ profile: currentEmpDoc, org: null });
    assertCondition(
      accessDecision.status === 'access_error' && accessDecision.errorReason === 'membership_released',
      `Expected membership_released access state, got ${JSON.stringify(accessDecision)}`
    );
  });

  // Step 7: Released member reads own users/{uid} ONLY; denied ALL Org A operational collections; Org A manager still reads history
  await runTest('Step 7. Released emp_transfer_1 can read own profile only, is denied all Org A data, while Org A manager retains full read access', async () => {
    // Can read own profile so UI renders dedicated membership_released screen
    await assertSucceeds(empTransferDb.doc('users/emp_transfer_1').get());

    // Denied ALL Org A data
    await assertGenuineFails(empTransferDb.doc('organizations/org_a').get(), 'Released member read org_a');
    await assertGenuineFails(empTransferDb.doc('branches/br_a1').get(), 'Released member read br_a1');
    await assertGenuineFails(empTransferDb.doc('closings/cls_org_a_1').get(), 'Released member read Org A closing');
    await assertGenuineFails(empTransferDb.doc('purchases/pur_org_a_1').get(), 'Released member read Org A purchase');
    await assertGenuineFails(empTransferDb.doc('attachments/att_org_a_1').get(), 'Released member read Org A attachment');
    await assertGenuineFails(empTransferDb.doc('auditLogs/alog_org_a_1').get(), 'Released member read Org A auditLog');
    await assertGenuineFails(empTransferDb.doc('closingArchives/cls_org_a_1').get(), 'Released member read Org A archive');
    await assertGenuineFails(empTransferDb.doc('notifications/notif_org_a_1').get(), 'Released member read Org A notification');
    await assertGenuineFails(
      empTransferDb.doc('users/emp_transfer_1').update({ displayName: 'تعديل مرفوض' }),
      'Released member self-update displayName'
    );

    // Org A manager still reads all historical records untouched
    await assertSucceeds(mgrADb.doc('closings/cls_org_a_1').get());
    await assertSucceeds(mgrADb.doc('purchases/pur_org_a_1').get());
    await assertSucceeds(mgrADb.doc('attachments/att_org_a_1').get());
    await assertSucceeds(mgrADb.doc('auditLogs/alog_org_a_1').get());
    await assertSucceeds(mgrADb.doc('closingArchives/cls_org_a_1').get());
  });

  // Step 8: Attempt to reactivate released member in Org A (by Org A manager AND by Super Admin via MEMBER_REACTIVATED) -> DENIED
  await runTest('Step 8. Reactivating released emp_transfer_1 in Org A is genuinely denied for BOTH Org A manager and Super Admin', async () => {
    // Org A manager attempt
    await assertGenuineFails(
      mgrADb.doc('users/emp_transfer_1').update({
        orgId: 'org_a',
        isActive: true,
        isArchived: false,
        membershipStatus: 'active',
        updatedAt: new Date().toISOString(),
      }),
      'Org A manager reactivate released member'
    );

    // Super Admin attempt via standard MEMBER_REACTIVATED instead of explicit assign
    const nowIso = new Date().toISOString();
    const badBatch = saDb.batch();
    badBatch.update(saDb.doc('users/emp_transfer_1'), {
      isActive: true,
      isArchived: false,
      membershipStatus: 'active',
      lastPlatformAuditLogId: 'pal_bad_reactivate_1',
      updatedAt: nowIso,
    });
    badBatch.set(saDb.doc('platformAuditLogs/pal_bad_reactivate_1'), {
      id: 'pal_bad_reactivate_1',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'sa_uid_1',
      action: 'MEMBER_REACTIVATED',
      targetType: 'member',
      targetId: 'emp_transfer_1',
      orgId: 'org_a',
      details: 'محاولة إعادة تفعيل عضو محرر نهائياً',
      timestamp: nowIso,
    });
    await assertGenuineFails(badBatch.commit(), 'Super Admin reactivate released member via MEMBER_REACTIVATED');
  });

  // Step 9: Assign SAME uid (emp_transfer_1) to Org B atomically
  await runTest('Step 9. Super Admin assigns SAME UID (emp_transfer_1) to Org B with fresh role/branch/permissions atomically', async () => {
    assertCondition(currentEmpDoc !== null, 'currentEmpDoc missing');
    const now = new Date();
    const { userPatch, historyRecord, auditLog } = buildSuperAdminAssignReleasedMemberBundle({
      actor: unitActor,
      existingMember: currentEmpDoc!,
      targetOrg: unitOrgB,
      targetOrgBranches: orgBBranches,
      role: 'branch_manager',
      branchId: 'br_b1',
      reason: 'إعادة ربط الموظف المحرر بمؤسسة بيتا بصفة مسؤول فرع',
      now,
      historyId: 'moh_asg_c1_1',
      auditLogId: 'pal_asg_c1_1',
      deleteFieldSentinel: FieldValue.delete(),
    });
    assignHistoryId = historyRecord.id;
    assignAuditLogId = auditLog.id;

    const saNotif = buildSuperAdminPlatformNotification({
      dedupKey: `sa_member_assigned:emp_transfer_1:${auditLog.id}`,
      category: 'security_admin',
      type: 'SA_MEMBER_ASSIGNED',
      severity: 'success',
      relatedOrgId: 'org_b',
      branchId: 'br_b1',
      branchName: 'فرع بيتا الرئيسي',
      actorUid: 'sa_uid_1',
      actorName: 'صاحب المنصة',
      title: 'إعادة ربط خالد المنتقل بمؤسسة بيتا',
      body: 'تم ربط العضو المحرر بنفس حسابه السابق بصفة مسؤول فرع في مؤسسة بيتا.',
      targetType: 'organization',
      targetId: 'org_b',
      tab: 'members',
      createdAt: now.toISOString(),
    });

    const batch = saDb.batch();
    batch.update(saDb.doc('users/emp_transfer_1'), userPatch);
    batch.set(saDb.doc(`memberOrgHistory/${historyRecord.id}`), historyRecord);
    batch.set(saDb.doc(`platformAuditLogs/${auditLog.id}`), auditLog);
    batch.set(saDb.doc(`notifications/${saNotif.id}`), saNotif);
    await assertSucceeds(batch.commit());

    const snap = await assertSucceeds(saDb.doc('users/emp_transfer_1').get());
    currentEmpDoc = snap.data() as UserProfile;
    assertCondition(currentEmpDoc.uid === 'emp_transfer_1', 'Same UID must be reused');
    assertCondition(currentEmpDoc.orgId === 'org_b', 'orgId must now be org_b');
    assertCondition(currentEmpDoc.role === 'branch_manager', 'Role must be branch_manager');
    assertCondition(currentEmpDoc.branchId === 'br_b1', 'branchId must be br_b1');
    assertCondition(currentEmpDoc.membershipStatus === 'active' && currentEmpDoc.isActive === true, 'Must be active');
    assertCondition(Boolean(currentEmpDoc.reassignedAt) && currentEmpDoc.reassignedBy === 'amoal2030@gmail.com', 'Reassignment metadata missing');

    // Verify ZERO previous-org release or archive metadata remains on users/{uid} (and Org B manager cannot see Org A)
    const mgrBReadDoc = (await assertSucceeds(mgrBDb.doc('users/emp_transfer_1').get())).data() as Record<string, unknown>;
    for (const forbiddenKey of [
      'archivedAt',
      'archivedBy',
      'releasedFromOrgId',
      'releasedFromOrgName',
      'releasedAt',
      'releasedBy',
      'releaseReason',
    ]) {
      assertCondition(
        !(forbiddenKey in mgrBReadDoc),
        `Leaked previous-org field "${forbiddenKey}" visible to Org B manager on users/{uid}`
      );
    }
  });

  // Step 10: Re-assigned emp_transfer_1 works normally inside Org B
  await runTest('Step 10. Transferred emp_transfer_1 accesses Org B and creates a valid Org B shift closing', async () => {
    assertCondition(currentEmpDoc !== null, 'currentEmpDoc missing');
    const decision = resolveProfiledUserAccess({ profile: currentEmpDoc!, org: unitOrgB });
    assertCondition(decision.status === 'active_tenant', `Expected active_tenant in Org B, got ${decision.status}`);

    await assertSucceeds(empTransferDb.doc('organizations/org_b').get());
    await assertSucceeds(empTransferDb.doc('branches/br_b1').get());

    const bIso = new Date().toISOString();
    const bBatch = empTransferDb.batch();
    bBatch.set(empTransferDb.doc('closings/cls_org_b_1'), {
      id: 'cls_org_b_1',
      orgId: 'org_b',
      branchId: 'br_b1',
      branchName: 'فرع بيتا الرئيسي',
      employeeId: 'emp_transfer_1',
      employeeName: 'خالد المنتقل',
      date: todayDate,
      period: 'evening',
      cashSales: 2000,
      cardSales: 800,
      expenses: 200,
      totalSales: 2800,
      remainingInBox: 1800,
      netPeriod: 2600,
      status: 'pending_review',
      createdAt: bIso,
      updatedAt: bIso,
    });
    bBatch.set(empTransferDb.doc('auditLogs/alog_org_b_1'), {
      id: 'alog_org_b_1',
      orgId: 'org_b',
      actorId: 'emp_transfer_1',
      actorName: 'خالد المنتقل',
      actorRole: 'branch_manager',
      action: 'CLOSING_SUBMITTED_FOR_REVIEW',
      targetType: 'closing',
      targetId: 'cls_org_b_1',
      details: 'تقديم إقفال مسائي في فرع بيتا الرئيسي',
      timestamp: bIso,
    });
    bBatch.set(empTransferDb.doc('closingArchives/cls_org_b_1'), {
      closingId: 'cls_org_b_1',
      orgId: 'org_b',
      branchId: 'br_b1',
      yearMonth: todayYM,
      archiveStatus: 'pending_drive_sync',
      updatedAt: bIso,
    });
    await assertSucceeds(bBatch.commit());
  });

  // Step 11: Strict Cross-Org Data Isolation (transferred member & Org B manager cannot read/write ANY Org A data)
  await runTest('Step 11. Cross-org isolation: transferred emp_transfer_1 AND Org B manager are genuinely denied ALL Org A data', async () => {
    // Transferred member (even though employeeId/createdBy == emp_transfer_1 in Org A docs!)
    await assertGenuineFails(empTransferDb.doc('organizations/org_a').get(), 'Transferred member read org_a');
    await assertGenuineFails(empTransferDb.doc('branches/br_a1').get(), 'Transferred member read br_a1');
    await assertGenuineFails(empTransferDb.doc('closings/cls_org_a_1').get(), 'Transferred member read own historical Org A closing');
    await assertGenuineFails(
      empTransferDb.doc('closings/cls_org_a_1').update({ expenses: 50, remainingInBox: 950, netPeriod: 1450 }),
      'Transferred member update Org A closing'
    );
    await assertGenuineFails(empTransferDb.doc('purchases/pur_org_a_1').get(), 'Transferred member read Org A purchase');
    await assertGenuineFails(empTransferDb.doc('attachments/att_org_a_1').get(), 'Transferred member read Org A attachment');
    await assertGenuineFails(empTransferDb.doc('auditLogs/alog_org_a_1').get(), 'Transferred member read Org A auditLog');
    await assertGenuineFails(empTransferDb.doc('closingArchives/cls_org_a_1').get(), 'Transferred member read Org A closingArchive');
    await assertGenuineFails(empTransferDb.doc('notifications/notif_org_a_1').get(), 'Transferred member read old Org A notification');

    // Org B manager cannot read Org A records either
    await assertGenuineFails(mgrBDb.doc('closings/cls_org_a_1').get(), 'Org B manager read Org A closing');
    await assertGenuineFails(mgrBDb.doc('purchases/pur_org_a_1').get(), 'Org B manager read Org A purchase');
    await assertGenuineFails(mgrBDb.doc('attachments/att_org_a_1').get(), 'Org B manager read Org A attachment');
    await assertGenuineFails(mgrBDb.doc('auditLogs/alog_org_a_1').get(), 'Org B manager read Org A auditLog');
    await assertGenuineFails(mgrBDb.doc('closingArchives/cls_org_a_1').get(), 'Org B manager read Org A archive');

    // Org A manager cannot read Org B's new closing either
    await assertGenuineFails(mgrADb.doc('closings/cls_org_b_1').get(), 'Org A manager read Org B closing');
  });

  // Step 12: Verify Org A historical records untouched + memberOrgHistory & platformAuditLogs + strict immutability
  await runTest('Step 12. Org A historical records intact, memberOrgHistory & platformAuditLogs complete & strictly immutable', async () => {
    const clsA = (await assertSucceeds(mgrADb.doc('closings/cls_org_a_1').get())).data();
    assertCondition(clsA?.orgId === 'org_a' && clsA?.employeeId === 'emp_transfer_1', 'Org A closing altered');

    const purA = (await assertSucceeds(mgrADb.doc('purchases/pur_org_a_1').get())).data();
    assertCondition(purA?.orgId === 'org_a' && purA?.createdBy === 'emp_transfer_1', 'Org A purchase altered');

    const attA = (await assertSucceeds(mgrADb.doc('attachments/att_org_a_1').get())).data();
    assertCondition(attA?.orgId === 'org_a' && attA?.uploadedBy === 'emp_transfer_1', 'Org A attachment altered');

    const alogA = (await assertSucceeds(mgrADb.doc('auditLogs/alog_org_a_1').get())).data();
    assertCondition(alogA?.orgId === 'org_a' && alogA?.actorId === 'emp_transfer_1', 'Org A auditLog altered');

    // Verify both immutable memberOrgHistory docs exist
    const hRel = (await assertSucceeds(saDb.doc(`memberOrgHistory/${releaseHistoryId}`).get())).data();
    const hAsg = (await assertSucceeds(saDb.doc(`memberOrgHistory/${assignHistoryId}`).get())).data();
    assertCondition(hRel?.eventType === 'released' && hRel?.orgId === 'org_a', 'Release history mismatch');
    assertCondition(hAsg?.eventType === 'assigned' && hAsg?.orgId === 'org_b' && hAsg?.previousOrgId === 'org_a', 'Assign history mismatch');

    // Verify both platformAuditLogs exist
    const lRel = (await assertSucceeds(saDb.doc(`platformAuditLogs/${releaseAuditLogId}`).get())).data();
    const lAsg = (await assertSucceeds(saDb.doc(`platformAuditLogs/${assignAuditLogId}`).get())).data();
    assertCondition(lRel?.action === 'MEMBER_ORG_MEMBERSHIP_RELEASED', 'Release audit log missing');
    assertCondition(lAsg?.action === 'MEMBER_ORG_MEMBERSHIP_ASSIGNED', 'Assign audit log missing');

    // Strict immutability of memberOrgHistory — even Super Admin CANNOT update or delete
    await assertGenuineFails(
      saDb.doc(`memberOrgHistory/${releaseHistoryId}`).update({ reason: 'تعديل غير مسموح' }),
      'Super Admin update memberOrgHistory'
    );
    await assertGenuineFails(
      saDb.doc(`memberOrgHistory/${releaseHistoryId}`).delete(),
      'Super Admin delete memberOrgHistory'
    );
  });

  // ========================================================================
  // MANDATORY NEGATIVE & SECURITY HARDENING SCENARIOS
  // ========================================================================
  console.log('\n--- PART 3: Mandatory Negative Security & Backward Compatibility Tests ---');

  await runTest('N1. Deny releasing Org manager (ownerId), staff matching ownerEmail, or Super Admin', async () => {
    const nowIso = new Date().toISOString();

    const tryRelease = (targetUid: string, email: string, role: string, suffix: string) => {
      const hId = `moh_neg_rel_${suffix}`;
      const lId = `pal_neg_rel_${suffix}`;
      const batch = saDb.batch();
      batch.update(saDb.doc(`users/${targetUid}`), {
        orgId: '',
        membershipStatus: 'released',
        isActive: false,
        isArchived: false,
        permissions: buildReleasedMemberZeroPermissions(),
        releasedFromOrgId: 'org_a',
        releasedFromOrgName: unitOrgA.name,
        releasedAt: nowIso,
        releasedBy: 'amoal2030@gmail.com',
        releaseReason: 'محاولة فصل مرفوضة أمنياً',
        lastMemberOrgHistoryId: hId,
        lastPlatformAuditLogId: lId,
        updatedAt: nowIso,
      });
      batch.set(saDb.doc(`memberOrgHistory/${hId}`), {
        id: hId,
        eventType: 'released',
        uid: targetUid,
        email,
        displayName: 'هدف محمي',
        orgId: 'org_a',
        orgName: unitOrgA.name,
        role: role === 'manager' ? 'supervisor' : role,
        effectiveAt: nowIso,
        actorUid: 'sa_uid_1',
        actorEmail: 'amoal2030@gmail.com',
        reason: 'محاولة فصل مرفوضة أمنياً',
        auditLogId: lId,
        createdAt: nowIso,
      });
      batch.set(saDb.doc(`platformAuditLogs/${lId}`), {
        id: lId,
        actorEmail: 'amoal2030@gmail.com',
        actorUid: 'sa_uid_1',
        action: 'MEMBER_ORG_MEMBERSHIP_RELEASED',
        targetType: 'member',
        targetId: targetUid,
        orgId: 'org_a',
        details: 'محاولة فصل مرفوضة أمنياً',
        metadata: { historyId: hId },
        timestamp: nowIso,
      });
      return batch.commit();
    };

    await assertGenuineFails(tryRelease('mgr_a', 'owner.a@example.com', 'manager', 'mgr'), 'Release org manager');
    await assertGenuineFails(tryRelease('owner_email_staff', 'owner.a@example.com', 'supervisor', 'ownmail'), 'Release ownerEmail staff');
    await assertGenuineFails(tryRelease('sa_shadow_doc', 'amoal2030@gmail.com', 'supervisor', 'sa'), 'Release Super Admin');
  });

  await runTest('N2. Deny release, assign, and memberOrgHistory access to Org manager, supervisor, employee & unverified SA', async () => {
    // Non-SA cannot read memberOrgHistory
    await assertGenuineFails(mgrADb.doc(`memberOrgHistory/${releaseHistoryId}`).get(), 'Org manager read memberOrgHistory');
    await assertGenuineFails(supADb.doc(`memberOrgHistory/${releaseHistoryId}`).get(), 'Supervisor read memberOrgHistory');
    await assertGenuineFails(empTransferDb.doc(`memberOrgHistory/${releaseHistoryId}`).get(), 'Employee read memberOrgHistory');
    await assertGenuineFails(unverifiedSaDb.doc(`memberOrgHistory/${releaseHistoryId}`).get(), 'Unverified SA read memberOrgHistory');

    // Org manager cannot release an employee
    await assertGenuineFails(
      mgrADb.doc('users/sup_a').update({
        orgId: '',
        membershipStatus: 'released',
        isActive: false,
        isArchived: false,
        updatedAt: new Date().toISOString(),
      }),
      'Org manager attempt release'
    );

    // Unverified Super Admin (email_verified: false) cannot release or assign
    const nowIso = new Date().toISOString();
    const unverifiedBatch = unverifiedSaDb.batch();
    unverifiedBatch.update(unverifiedSaDb.doc('users/emp_released_neg'), {
      orgId: 'org_b',
      role: 'employee',
      branchId: 'br_b1',
      branchName: 'فرع بيتا الرئيسي',
      permissions: {
        canCreateClosing: true,
        canViewAllClosings: false,
        canApproveClosings: false,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: false,
        canManagePurchases: false,
        canManageSuppliers: false,
        canViewSuppliers: false,
        canViewFinancialReports: false,
      },
      membershipStatus: 'active',
      isActive: true,
      isArchived: false,
      reassignedAt: nowIso,
      reassignedBy: 'amoal2030@gmail.com',
      lastMemberOrgHistoryId: 'moh_unver_1',
      lastPlatformAuditLogId: 'pal_unver_1',
      updatedAt: nowIso,
    });
    unverifiedBatch.set(unverifiedSaDb.doc('memberOrgHistory/moh_unver_1'), {
      id: 'moh_unver_1',
      eventType: 'assigned',
      uid: 'emp_released_neg',
      email: 'released.neg@example.com',
      displayName: 'موظف محرر لاختبارات المنع',
      orgId: 'org_b',
      orgName: unitOrgB.name,
      role: 'employee',
      branchId: 'br_b1',
      branchName: 'فرع بيتا الرئيسي',
      effectiveAt: nowIso,
      actorUid: 'sa_unverified',
      actorEmail: 'amoal2030@gmail.com',
      reason: 'محاولة من حساب مدير رئيسي غير موثق البريد',
      auditLogId: 'pal_unver_1',
      createdAt: nowIso,
    });
    unverifiedBatch.set(unverifiedSaDb.doc('platformAuditLogs/pal_unver_1'), {
      id: 'pal_unver_1',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'sa_unverified',
      action: 'MEMBER_ORG_MEMBERSHIP_ASSIGNED',
      targetType: 'member',
      targetId: 'emp_released_neg',
      orgId: 'org_b',
      details: 'محاولة من حساب غير موثق البريد',
      metadata: { historyId: 'moh_unver_1' },
      timestamp: nowIso,
    });
    await assertGenuineFails(unverifiedBatch.commit(), 'Unverified Super Admin assign released member');
  });

  await runTest('N3. Deny assigning active member, suspended org, foreign branch, or manager/super_admin role', async () => {
    const nowIso = new Date().toISOString();
    const validEmpPerms = {
      canCreateClosing: true,
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

    const makeAssignBatch = (opts: {
      uid: string;
      email: string;
      targetOrgId: string;
      targetOrgName: string;
      role: string;
      branchId?: string;
      suffix: string;
    }) => {
      const hId = `moh_neg_asg_${opts.suffix}`;
      const lId = `pal_neg_asg_${opts.suffix}`;
      const batch = saDb.batch();
      batch.update(saDb.doc(`users/${opts.uid}`), {
        orgId: opts.targetOrgId,
        role: opts.role,
        ...(opts.branchId ? { branchId: opts.branchId, branchName: 'فرع' } : {}),
        permissions: validEmpPerms,
        membershipStatus: 'active',
        isActive: true,
        isArchived: false,
        reassignedAt: nowIso,
        reassignedBy: 'amoal2030@gmail.com',
        lastMemberOrgHistoryId: hId,
        lastPlatformAuditLogId: lId,
        updatedAt: nowIso,
      });
      batch.set(saDb.doc(`memberOrgHistory/${hId}`), {
        id: hId,
        eventType: 'assigned',
        uid: opts.uid,
        email: opts.email,
        displayName: 'اختبار سلبي',
        orgId: opts.targetOrgId,
        orgName: opts.targetOrgName,
        role: opts.role === 'manager' || opts.role === 'super_admin' ? 'employee' : opts.role,
        ...(opts.branchId ? { branchId: opts.branchId, branchName: 'فرع' } : {}),
        effectiveAt: nowIso,
        actorUid: 'sa_uid_1',
        actorEmail: 'amoal2030@gmail.com',
        reason: 'اختبار أمان سلبي لإعادة الربط',
        auditLogId: lId,
        createdAt: nowIso,
      });
      batch.set(saDb.doc(`platformAuditLogs/${lId}`), {
        id: lId,
        actorEmail: 'amoal2030@gmail.com',
        actorUid: 'sa_uid_1',
        action: 'MEMBER_ORG_MEMBERSHIP_ASSIGNED',
        targetType: 'member',
        targetId: opts.uid,
        orgId: opts.targetOrgId,
        details: 'اختبار أمان سلبي لإعادة الربط',
        metadata: { historyId: hId },
        timestamp: nowIso,
      });
      return batch.commit();
    };

    // Active member (not released)
    await assertGenuineFails(
      makeAssignBatch({
        uid: 'sup_a',
        email: 'sup.a@example.com',
        targetOrgId: 'org_b',
        targetOrgName: unitOrgB.name,
        role: 'employee',
        branchId: 'br_b1',
        suffix: 'active',
      }),
      'Assign active non-released member'
    );

    // Suspended org
    await assertGenuineFails(
      makeAssignBatch({
        uid: 'emp_released_neg',
        email: 'released.neg@example.com',
        targetOrgId: 'org_suspended',
        targetOrgName: 'مؤسسة غاما الموقوفة',
        role: 'employee',
        branchId: 'br_s1',
        suffix: 'susp_org',
      }),
      'Assign to suspended org'
    );

    // Foreign branch (br_a1 does not belong to org_b)
    await assertGenuineFails(
      makeAssignBatch({
        uid: 'emp_released_neg',
        email: 'released.neg@example.com',
        targetOrgId: 'org_b',
        targetOrgName: unitOrgB.name,
        role: 'employee',
        branchId: 'br_a1',
        suffix: 'foreign_br',
      }),
      'Assign foreign branch'
    );

    // Forbidden manager role
    await assertGenuineFails(
      makeAssignBatch({
        uid: 'emp_released_neg',
        email: 'released.neg@example.com',
        targetOrgId: 'org_b',
        targetOrgName: unitOrgB.name,
        role: 'manager',
        suffix: 'mgr_role',
      }),
      'Assign manager role'
    );

    // Forbidden super_admin role
    await assertGenuineFails(
      makeAssignBatch({
        uid: 'emp_released_neg',
        email: 'released.neg@example.com',
        targetOrgId: 'org_b',
        targetOrgName: unitOrgB.name,
        role: 'super_admin',
        suffix: 'sa_role',
      }),
      'Assign super_admin role'
    );
  });

  await runTest('N4. Deny incomplete/uncoupled batches (missing memberOrgHistory, missing auditLog, or non-zero perms on release)', async () => {
    const nowIso = new Date().toISOString();

    // Release WITHOUT memberOrgHistory
    const noHistBatch = saDb.batch();
    noHistBatch.update(saDb.doc('users/sup_a'), {
      orgId: '',
      membershipStatus: 'released',
      isActive: false,
      isArchived: false,
      permissions: buildReleasedMemberZeroPermissions(),
      releasedFromOrgId: 'org_a',
      releasedFromOrgName: unitOrgA.name,
      releasedAt: nowIso,
      releasedBy: 'amoal2030@gmail.com',
      releaseReason: 'محاولة فصل بدون سجل memberOrgHistory',
      lastMemberOrgHistoryId: 'moh_missing_1',
      lastPlatformAuditLogId: 'pal_no_hist_1',
      updatedAt: nowIso,
    });
    noHistBatch.set(saDb.doc('platformAuditLogs/pal_no_hist_1'), {
      id: 'pal_no_hist_1',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'sa_uid_1',
      action: 'MEMBER_ORG_MEMBERSHIP_RELEASED',
      targetType: 'member',
      targetId: 'sup_a',
      orgId: 'org_a',
      details: 'محاولة فصل بدون سجل تاريخي',
      metadata: { historyId: 'moh_missing_1' },
      timestamp: nowIso,
    });
    await assertGenuineFails(noHistBatch.commit(), 'Release missing memberOrgHistory');

    // Release WITHOUT platformAuditLogs
    const noAuditBatch = saDb.batch();
    noAuditBatch.update(saDb.doc('users/sup_a'), {
      orgId: '',
      membershipStatus: 'released',
      isActive: false,
      isArchived: false,
      permissions: buildReleasedMemberZeroPermissions(),
      releasedFromOrgId: 'org_a',
      releasedFromOrgName: unitOrgA.name,
      releasedAt: nowIso,
      releasedBy: 'amoal2030@gmail.com',
      releaseReason: 'محاولة فصل بدون سجل تدقيق منصة',
      lastMemberOrgHistoryId: 'moh_no_audit_1',
      lastPlatformAuditLogId: 'pal_missing_1',
      updatedAt: nowIso,
    });
    noAuditBatch.set(saDb.doc('memberOrgHistory/moh_no_audit_1'), {
      id: 'moh_no_audit_1',
      eventType: 'released',
      uid: 'sup_a',
      email: 'sup.a@example.com',
      displayName: 'مشرف ألفا',
      orgId: 'org_a',
      orgName: unitOrgA.name,
      role: 'supervisor',
      effectiveAt: nowIso,
      actorUid: 'sa_uid_1',
      actorEmail: 'amoal2030@gmail.com',
      reason: 'محاولة فصل بدون سجل تدقيق منصة',
      auditLogId: 'pal_missing_1',
      createdAt: nowIso,
    });
    await assertGenuineFails(noAuditBatch.commit(), 'Release missing platformAuditLogs');

    // Release with non-zeroed permission (canCreateClosing: true)
    const nonZeroBatch = saDb.batch();
    nonZeroBatch.update(saDb.doc('users/sup_a'), {
      orgId: '',
      membershipStatus: 'released',
      isActive: false,
      isArchived: false,
      permissions: { ...buildReleasedMemberZeroPermissions(), canCreateClosing: true },
      releasedFromOrgId: 'org_a',
      releasedFromOrgName: unitOrgA.name,
      releasedAt: nowIso,
      releasedBy: 'amoal2030@gmail.com',
      releaseReason: 'محاولة فصل مع إبقاء صلاحية مفعلة',
      lastMemberOrgHistoryId: 'moh_nonzero_1',
      lastPlatformAuditLogId: 'pal_nonzero_1',
      updatedAt: nowIso,
    });
    nonZeroBatch.set(saDb.doc('memberOrgHistory/moh_nonzero_1'), {
      id: 'moh_nonzero_1',
      eventType: 'released',
      uid: 'sup_a',
      email: 'sup.a@example.com',
      displayName: 'مشرف ألفا',
      orgId: 'org_a',
      orgName: unitOrgA.name,
      role: 'supervisor',
      effectiveAt: nowIso,
      actorUid: 'sa_uid_1',
      actorEmail: 'amoal2030@gmail.com',
      reason: 'محاولة فصل مع إبقاء صلاحية مفعلة',
      auditLogId: 'pal_nonzero_1',
      createdAt: nowIso,
    });
    nonZeroBatch.set(saDb.doc('platformAuditLogs/pal_nonzero_1'), {
      id: 'pal_nonzero_1',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'sa_uid_1',
      action: 'MEMBER_ORG_MEMBERSHIP_RELEASED',
      targetType: 'member',
      targetId: 'sup_a',
      orgId: 'org_a',
      details: 'محاولة فصل مع إبقاء صلاحية مفعلة',
      metadata: { historyId: 'moh_nonzero_1' },
      timestamp: nowIso,
    });
    await assertGenuineFails(nonZeroBatch.commit(), 'Release with non-zeroed permission');

    // Forged standalone memberOrgHistory without atomic users/{uid} transition
    await assertGenuineFails(
      saDb.doc('memberOrgHistory/moh_forged_1').set({
        id: 'moh_forged_1',
        eventType: 'released',
        uid: 'sup_a',
        email: 'sup.a@example.com',
        displayName: 'مشرف ألفا',
        orgId: 'org_a',
        orgName: unitOrgA.name,
        role: 'supervisor',
        effectiveAt: nowIso,
        actorUid: 'sa_uid_1',
        actorEmail: 'amoal2030@gmail.com',
        reason: 'محاولة كتابة سجل تاريخي منفرد دون تحديث المستخدم',
        auditLogId: 'pal_forged_1',
        createdAt: nowIso,
      }),
      'Standalone forged memberOrgHistory create'
    );

    // Regular user self-tampering with membershipStatus / orgId
    await assertGenuineFails(
      supADb.doc('users/sup_a').update({ membershipStatus: 'released', orgId: '' }),
      'User self-tamper membershipStatus'
    );
    await assertGenuineFails(
      empReleasedNegDb.doc('users/emp_released_neg').update({ orgId: 'org_b', isActive: true, membershipStatus: 'active' }),
      'Released user self-reattach to org_b'
    );
  });

  await runTest('N5. Legacy backward compatibility in Firestore Rules: user without membershipStatus works seamlessly', async () => {
    // Legacy user reads own org & self-updates displayName
    await assertSucceeds(empLegacyDb.doc('organizations/org_a').get());
    await assertSucceeds(empLegacyDb.doc('users/emp_legacy_a').update({ displayName: 'موظف قديم محدّث' }));

    // Org A manager archives legacy user cleanly (with membershipStatus='archived'), then reactivates (with membershipStatus='active')
    const archIso = new Date().toISOString();
    await assertSucceeds(
      mgrADb.doc('users/emp_legacy_a').update({
        isActive: false,
        isArchived: true,
        membershipStatus: 'archived',
        archivedAt: archIso,
        archivedBy: 'mgr_a',
        updatedAt: archIso,
      })
    );
    await assertSucceeds(
      mgrADb.doc('users/emp_legacy_a').update({
        isActive: true,
        isArchived: false,
        membershipStatus: 'active',
        updatedAt: new Date().toISOString(),
      })
    );
  });

  await runTest('N6. Fixes #2/#3/#4: Org-A-archived member -> Release -> Org B -> Release -> Org C (multi-hop, zero leakage, accurate joinedAt)', async () => {
    // Seed Org C + branch + manager + an Org A employee archived by mgr_a (with archivedAt + archivedBy: 'mgr_a')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('organizations/org_c').set({
        id: 'org_c',
        name: 'مؤسسة جاما الحديثة',
        activityType: 'retail',
        currency: 'SAR',
        ownerId: 'mgr_c',
        ownerEmail: 'owner.c@example.com',
        ownerName: 'مدير جاما',
        driveConnected: false,
        isActive: true,
        subscriptionPlan: '1m',
        subscriptionStatus: 'active',
        subscriptionStartAt: tsPast30d,
        subscriptionEndAt: tsFuture30d,
        createdAt: '2026-01-12T08:00:00.000Z',
        updatedAt: baseIso,
      });
      await db.doc('branches/br_c1').set({
        id: 'br_c1',
        orgId: 'org_c',
        name: 'فرع جاما الرئيسي',
        code: 'C1',
        isActive: true,
        lifecycleStatus: 'active',
        paymentStatus: 'paid',
        createdAt: '2026-01-12T08:00:00.000Z',
      });
      await db.doc('users/mgr_c').set({
        uid: 'mgr_c',
        orgId: 'org_c',
        email: 'owner.c@example.com',
        displayName: 'مدير جاما',
        role: 'manager',
        isActive: true,
        isArchived: false,
        membershipStatus: 'active',
        createdAt: '2026-01-12T08:00:00.000Z',
        updatedAt: baseIso,
      });
      await db.doc('users/emp_multihop').set({
        uid: 'emp_multihop',
        orgId: 'org_a',
        email: 'multihop@example.com',
        displayName: 'موظف التنقل المتعدد',
        role: 'branch_manager',
        branchId: 'br_a1',
        branchIds: ['br_a1'],
        branchName: 'فرع ألفا الأول',
        isActive: false,
        isArchived: true,
        membershipStatus: 'archived',
        archivedAt: '2026-02-01T10:00:00.000Z',
        archivedBy: 'mgr_a',
        permissions: {
          canCreateClosing: true,
          canViewAllClosings: false,
          canApproveClosings: false,
          canManageBranches: false,
          canManageEmployees: false,
          canExportReports: false,
          canManagePurchases: true,
          canManageSuppliers: false,
          canViewSuppliers: true,
          canViewFinancialReports: false,
        },
        createdAt: '2026-01-02T09:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
      });
      await db.doc('closings/cls_mh_a').set({
        id: 'cls_mh_a',
        orgId: 'org_a',
        branchId: 'br_a1',
        branchName: 'فرع ألفا الأول',
        employeeId: 'emp_multihop',
        employeeName: 'موظف التنقل المتعدد',
        date: todayDate,
        period: 'morning',
        cashSales: 400,
        cardSales: 200,
        expenses: 50,
        totalSales: 600,
        remainingInBox: 350,
        netPeriod: 550,
        status: 'approved',
        createdAt: baseIso,
        updatedAt: baseIso,
      });
    });

    const mgrCDb = testEnv.authenticatedContext('mgr_c', { email: 'owner.c@example.com', email_verified: true }).firestore();
    const empMhDb = testEnv.authenticatedContext('emp_multihop', { email: 'multihop@example.com', email_verified: true }).firestore();

    const unitOrgC: Organization = {
      id: 'org_c',
      name: 'مؤسسة جاما الحديثة',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_c',
      ownerEmail: 'owner.c@example.com',
      ownerName: 'مدير جاما',
      driveConnected: false,
      isActive: true,
      createdAt: '2026-01-12T08:00:00.000Z',
      updatedAt: '2026-01-12T08:00:00.000Z',
    };
    const orgCBranches: Branch[] = [
      {
        id: 'br_c1',
        orgId: 'org_c',
        name: 'فرع جاما الرئيسي',
        code: 'C1',
        isActive: true,
        lifecycleStatus: 'active',
        createdAt: '2026-01-12T08:00:00.000Z',
      },
    ];

    // Negative check: Releasing WITHOUT removing archivedAt / archivedBy must be DENIED by Firestore Rules
    const badRelIso = new Date().toISOString();
    const badRelBatch = saDb.batch();
    badRelBatch.update(saDb.doc('users/emp_multihop'), {
      orgId: '',
      membershipStatus: 'released',
      isActive: false,
      isArchived: false,
      branchId: FieldValue.delete(),
      branchIds: FieldValue.delete(),
      branchName: FieldValue.delete(),
      permissions: buildReleasedMemberZeroPermissions(),
      releasedFromOrgId: 'org_a',
      releasedFromOrgName: unitOrgA.name,
      releasedAt: badRelIso,
      releasedBy: 'amoal2030@gmail.com',
      releaseReason: 'محاولة فصل دون حذف archivedBy القديم',
      lastMemberOrgHistoryId: 'moh_bad_keep_arch',
      lastPlatformAuditLogId: 'pal_bad_keep_arch',
      updatedAt: badRelIso,
    });
    badRelBatch.set(saDb.doc('memberOrgHistory/moh_bad_keep_arch'), {
      id: 'moh_bad_keep_arch',
      eventType: 'released',
      uid: 'emp_multihop',
      email: 'multihop@example.com',
      displayName: 'موظف التنقل المتعدد',
      orgId: 'org_a',
      orgName: unitOrgA.name,
      role: 'branch_manager',
      effectiveAt: badRelIso,
      actorUid: 'sa_uid_1',
      actorEmail: 'amoal2030@gmail.com',
      reason: 'محاولة فصل دون حذف archivedBy القديم',
      auditLogId: 'pal_bad_keep_arch',
      createdAt: badRelIso,
    });
    badRelBatch.set(saDb.doc('platformAuditLogs/pal_bad_keep_arch'), {
      id: 'pal_bad_keep_arch',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'sa_uid_1',
      action: 'MEMBER_ORG_MEMBERSHIP_RELEASED',
      targetType: 'member',
      targetId: 'emp_multihop',
      orgId: 'org_a',
      details: 'محاولة فصل دون حذف archivedBy القديم',
      metadata: { historyId: 'moh_bad_keep_arch' },
      timestamp: badRelIso,
    });
    await assertGenuineFails(badRelBatch.commit(), 'Release leaving archivedAt/archivedBy behind');

    // Hop 1: Release from Org A (removes archivedAt & archivedBy!)
    let mhSnap = (await assertSucceeds(saDb.doc('users/emp_multihop').get())).data() as UserProfile;
    const relA = buildSuperAdminMemberReleaseBundle({
      actor: unitActor,
      org: unitOrgA,
      existingMember: mhSnap,
      reason: 'فصل نهائي للموظف المؤرشف من مؤسسة ألفا',
      now: new Date('2026-03-01T10:00:00.000Z'),
      historyId: 'moh_mh_rel_a',
      auditLogId: 'pal_mh_rel_a',
      deleteFieldSentinel: FieldValue.delete(),
    });
    const b1 = saDb.batch();
    b1.update(saDb.doc('users/emp_multihop'), relA.userPatch);
    b1.set(saDb.doc(`memberOrgHistory/${relA.historyRecord.id}`), relA.historyRecord);
    b1.set(saDb.doc(`platformAuditLogs/${relA.auditLog.id}`), relA.auditLog);
    await assertSucceeds(b1.commit());

    mhSnap = (await assertSucceeds(saDb.doc('users/emp_multihop').get())).data() as UserProfile;
    assertCondition(!('archivedAt' in mhSnap) && !('archivedBy' in mhSnap), 'archivedAt/archivedBy must be deleted on release');
    assertCondition(relA.historyRecord.joinedAt === '2026-01-02T09:00:00.000Z', 'First release joinedAt must equal original createdAt');

    // Negative check: Assigning WITHOUT deleting releasedFromOrgId/releaseReason must be DENIED by Firestore Rules
    const badAsgIso = new Date().toISOString();
    const badAsgBatch = saDb.batch();
    badAsgBatch.update(saDb.doc('users/emp_multihop'), {
      orgId: 'org_b',
      role: 'supervisor',
      permissions: {
        canCreateClosing: false,
        canViewAllClosings: true,
        canApproveClosings: false,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: false,
        canManagePurchases: false,
        canManageSuppliers: false,
        canViewSuppliers: false,
        canViewFinancialReports: false,
      },
      membershipStatus: 'active',
      isActive: true,
      isArchived: false,
      reassignedAt: badAsgIso,
      reassignedBy: 'amoal2030@gmail.com',
      lastMemberOrgHistoryId: 'moh_bad_keep_rel',
      lastPlatformAuditLogId: 'pal_bad_keep_rel',
      updatedAt: badAsgIso,
    });
    badAsgBatch.set(saDb.doc('memberOrgHistory/moh_bad_keep_rel'), {
      id: 'moh_bad_keep_rel',
      eventType: 'assigned',
      uid: 'emp_multihop',
      email: 'multihop@example.com',
      displayName: 'موظف التنقل المتعدد',
      orgId: 'org_b',
      orgName: unitOrgB.name,
      role: 'supervisor',
      effectiveAt: badAsgIso,
      actorUid: 'sa_uid_1',
      actorEmail: 'amoal2030@gmail.com',
      reason: 'محاولة إعادة ربط دون حذف حقول الفصل السابقة',
      auditLogId: 'pal_bad_keep_rel',
      createdAt: badAsgIso,
    });
    badAsgBatch.set(saDb.doc('platformAuditLogs/pal_bad_keep_rel'), {
      id: 'pal_bad_keep_rel',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'sa_uid_1',
      action: 'MEMBER_ORG_MEMBERSHIP_ASSIGNED',
      targetType: 'member',
      targetId: 'emp_multihop',
      orgId: 'org_b',
      details: 'محاولة إعادة ربط دون حذف حقول الفصل السابقة',
      metadata: { historyId: 'moh_bad_keep_rel' },
      timestamp: badAsgIso,
    });
    await assertGenuineFails(badAsgBatch.commit(), 'Assign leaving releasedFromOrgId/releaseReason on users/{uid}');

    // Hop 2: Assign to Org B (purges ALL previous-org release & archive metadata from users/{uid})
    const joinBDate = new Date('2026-04-10T11:30:00.000Z');
    const asgB = buildSuperAdminAssignReleasedMemberBundle({
      actor: unitActor,
      existingMember: mhSnap,
      targetOrg: unitOrgB,
      targetOrgBranches: orgBBranches,
      role: 'supervisor',
      supervisorPermissions: { canViewAllClosings: true },
      reason: 'تعيين الموظف المحرر في مؤسسة بيتا بصفة مشرف',
      now: joinBDate,
      historyId: 'moh_mh_asg_b',
      auditLogId: 'pal_mh_asg_b',
      deleteFieldSentinel: FieldValue.delete(),
    });
    const b2 = saDb.batch();
    b2.update(saDb.doc('users/emp_multihop'), asgB.userPatch);
    b2.set(saDb.doc(`memberOrgHistory/${asgB.historyRecord.id}`), asgB.historyRecord);
    b2.set(saDb.doc(`platformAuditLogs/${asgB.auditLog.id}`), asgB.auditLog);
    await assertSucceeds(b2.commit());

    // Org B manager reads users/emp_multihop -> ZERO Org A ID, name, manager UID, or releaseReason!
    const mgrBView = (await assertSucceeds(mgrBDb.doc('users/emp_multihop').get())).data() as Record<string, unknown>;
    assertCondition(mgrBView.orgId === 'org_b', 'Expected org_b');
    assertCondition(mgrBView.createdAt === '2026-01-02T09:00:00.000Z', 'Original createdAt must stay untouched');
    for (const k of ['archivedAt', 'archivedBy', 'releasedFromOrgId', 'releasedFromOrgName', 'releasedAt', 'releasedBy', 'releaseReason']) {
      assertCondition(!(k in mgrBView), `Org B manager must NOT see ${k}`);
    }
    await assertGenuineFails(mgrBDb.doc('memberOrgHistory/moh_mh_rel_a').get(), 'Org B manager denied memberOrgHistory');

    // Seed an Org B closing for emp_multihop
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('closings/cls_mh_b').set({
        id: 'cls_mh_b',
        orgId: 'org_b',
        branchId: 'br_b1',
        branchName: 'فرع بيتا الرئيسي',
        employeeId: 'emp_multihop',
        employeeName: 'موظف التنقل المتعدد',
        date: todayDate,
        period: 'evening',
        cashSales: 500,
        cardSales: 300,
        expenses: 40,
        totalSales: 800,
        remainingInBox: 460,
        netPeriod: 760,
        status: 'approved',
        createdAt: baseIso,
        updatedAt: baseIso,
      });
    });

    // Hop 3: Release from Org B -> joinedAt MUST equal joinBDate (reassignedAt), NOT createdAt!
    mhSnap = (await assertSucceeds(saDb.doc('users/emp_multihop').get())).data() as UserProfile;
    const relB = buildSuperAdminMemberReleaseBundle({
      actor: unitActor,
      org: unitOrgB,
      existingMember: mhSnap,
      reason: 'فصل نهائي من مؤسسة بيتا تمهيداً للانتقال إلى مؤسسة جاما',
      now: new Date('2026-05-20T14:00:00.000Z'),
      historyId: 'moh_mh_rel_b',
      auditLogId: 'pal_mh_rel_b',
      deleteFieldSentinel: FieldValue.delete(),
    });
    assertCondition(
      relB.historyRecord.joinedAt === joinBDate.toISOString(),
      `Release from Org B joinedAt must equal reassignedAt (${joinBDate.toISOString()}), got ${relB.historyRecord.joinedAt}`
    );
    const b3 = saDb.batch();
    b3.update(saDb.doc('users/emp_multihop'), relB.userPatch);
    b3.set(saDb.doc(`memberOrgHistory/${relB.historyRecord.id}`), relB.historyRecord);
    b3.set(saDb.doc(`platformAuditLogs/${relB.auditLog.id}`), relB.auditLog);
    await assertSucceeds(b3.commit());

    // Hop 4: Assign SAME UID to Org C
    mhSnap = (await assertSucceeds(saDb.doc('users/emp_multihop').get())).data() as UserProfile;
    const asgC = buildSuperAdminAssignReleasedMemberBundle({
      actor: unitActor,
      existingMember: mhSnap,
      targetOrg: unitOrgC,
      targetOrgBranches: orgCBranches,
      role: 'employee',
      branchId: 'br_c1',
      reason: 'انضمام الموظف إلى مؤسسة جاما بنفس حساب المصادقة',
      now: new Date('2026-06-01T09:00:00.000Z'),
      historyId: 'moh_mh_asg_c',
      auditLogId: 'pal_mh_asg_c',
      deleteFieldSentinel: FieldValue.delete(),
    });
    const b4 = saDb.batch();
    b4.update(saDb.doc('users/emp_multihop'), asgC.userPatch);
    b4.set(saDb.doc(`memberOrgHistory/${asgC.historyRecord.id}`), asgC.historyRecord);
    b4.set(saDb.doc(`platformAuditLogs/${asgC.auditLog.id}`), asgC.auditLog);
    await assertSucceeds(b4.commit());

    // Verify all 4 immutable memberOrgHistory docs exist for Super Admin
    const mhHistSnap = await assertSucceeds(
      saDb.collection('memberOrgHistory').where('uid', '==', 'emp_multihop').get()
    );
    assertCondition(mhHistSnap.size === 4, `Expected 4 multi-hop history records, got ${mhHistSnap.size}`);
    const relBDoc = (await assertSucceeds(saDb.doc('memberOrgHistory/moh_mh_rel_b').get())).data();
    assertCondition(relBDoc?.joinedAt === joinBDate.toISOString(), 'Persisted Org B release joinedAt mismatch');
    await assertGenuineFails(saDb.doc('memberOrgHistory/moh_mh_rel_b').update({ reason: 'تعديل' }), 'SA update multi-hop history');
    await assertGenuineFails(saDb.doc('memberOrgHistory/moh_mh_rel_b').delete(), 'SA delete multi-hop history');

    // Verify Org C manager sees clean user doc & ZERO Org A / Org B data
    const mgrCView = (await assertSucceeds(mgrCDb.doc('users/emp_multihop').get())).data() as Record<string, unknown>;
    assertCondition(mgrCView.orgId === 'org_c' && mgrCView.createdAt === '2026-01-02T09:00:00.000Z', 'Org C user state invalid');
    for (const k of ['archivedAt', 'archivedBy', 'releasedFromOrgId', 'releasedFromOrgName', 'releasedAt', 'releasedBy', 'releaseReason']) {
      assertCondition(!(k in mgrCView), `Org C manager must NOT see ${k}`);
    }
    await assertGenuineFails(empMhDb.doc('closings/cls_mh_a').get(), 'Org C employee denied Org A closing');
    await assertGenuineFails(empMhDb.doc('closings/cls_mh_b').get(), 'Org C employee denied Org B closing');
    await assertGenuineFails(mgrCDb.doc('closings/cls_mh_a').get(), 'Org C manager denied Org A closing');
    await assertGenuineFails(mgrCDb.doc('closings/cls_mh_b').get(), 'Org C manager denied Org B closing');
    await assertGenuineFails(mgrCDb.doc('memberOrgHistory/moh_mh_rel_b').get(), 'Org C manager denied memberOrgHistory');
    await assertSucceeds(mgrADb.doc('closings/cls_mh_a').get());
    await assertSucceeds(mgrBDb.doc('closings/cls_mh_b').get());
  });

  await testEnv.cleanup();

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log('\n========================================================================');
  console.log(`SUMMARY: ${passedCount}/${results.length} PASSED | ${failedCount} FAILED`);
  console.log(`GENUINE SECURITY DENIALS VERIFIED: ${genuineSecurityDenialsCount}`);
  console.log(`CEL 1000-EXPRESSION LIMIT ERRORS:  ${expressionLimitErrorsCount}`);
  console.log('========================================================================');

  if (failedCount > 0 || expressionLimitErrorsCount > 0) {
    process.exit(1);
  }
}

runPhaseC1Tests().catch((err) => {
  console.error('Unhandled error in Phase C.1 test suite:', err);
  process.exit(1);
});
