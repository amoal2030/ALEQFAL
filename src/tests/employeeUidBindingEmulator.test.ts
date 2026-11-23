/**
 * Employee UID Binding, Mismatch Rejection & Tenant Isolation — Firestore Emulator Security Test Suite
 *
 * Tests live `firestore.rules` locally in the Firestore Emulator (ZERO production writes, ZERO real passwords):
 *  1. Active employee (`mo100100050@gmail.com` synthetic fixture, `UID_A`, `branch_manager` on `سحاب 1 (3)`)
 *     can read own `users/UID_A`, own `organizations/org_a`, and own `branches/branch_sahab_1_3`.
 *  2. Mismatched Firebase Auth UID (`UID_B` with the SAME email `mo100100050@gmail.com`):
 *     - Reading `users/UID_B` succeeds cleanly with `exists === false` (confirming genuine missing profile, NOT permission-denied).
 *     - Reading `users/UID_A` is strictly DENIED (`permission-denied`).
 *     - Reading `organizations/org_a` or `branches/branch_sahab_1_3` is strictly DENIED (ZERO email-based leakage).
 *  3. Archived employee (`isArchived: true`, `isActive: false`) can read own `users/{uid}` to display
 *     `account_archived` notice, while being strictly DENIED from reading org branches/closings.
 *  4. Released employee (`membershipStatus: 'released'`, `orgId: ''`) can read own `users/{uid}` to display
 *     `membership_released` notice, while being strictly DENIED from Org A data.
 *  5. Cross-tenant isolation: Org A employee (`UID_A`) is strictly DENIED from reading Org B org, branches, users, and closings.
 *
 * Run with:
 *   firebase emulators:exec --only firestore "npx tsx src/tests/employeeUidBindingEmulator.test.ts"
 */

import * as fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

let testEnv: RulesTestEnvironment;
let passed = 0;
let failed = 0;

async function runCase(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}\n     ${err?.message || err}`);
    failed++;
  }
}

async function assertPermissionDenied(promise: Promise<unknown>) {
  const err: any = await assertFails(promise);
  const msg = String(err?.message || '').toLowerCase();
  assert.ok(
    !msg.includes('maximum number of expressions') && !msg.includes('1000'),
    `Unexpected CEL expression limit error: ${err?.message}`
  );
}

async function seedFixtures() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const nowIso = new Date().toISOString();
    const subStart = firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 86_400_000));
    const subEnd = firebase.firestore.Timestamp.fromDate(
      new Date(Date.now() + 365 * 86_400_000)
    );

    await db.collection('organizations').doc('org_a').set({
      id: 'org_a',
      name: 'مؤسسة سحاب الاختبارية',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_a_uid',
      ownerEmail: 'owner.a@example.com',
      ownerName: 'مدير مؤسسة أ',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1y',
      subscriptionStatus: 'active',
      subscriptionStartAt: subStart,
      subscriptionEndAt: subEnd,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await db.collection('organizations').doc('org_b').set({
      id: 'org_b',
      name: 'مؤسسة ب المستقلة',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'mgr_b_uid',
      ownerEmail: 'owner.b@example.com',
      ownerName: 'مدير مؤسسة ب',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1y',
      subscriptionStatus: 'active',
      subscriptionStartAt: subStart,
      subscriptionEndAt: subEnd,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await db.collection('branches').doc('branch_sahab_1_3').set({
      id: 'branch_sahab_1_3',
      orgId: 'org_a',
      name: 'سحاب 1 (3)',
      code: 'SHB-03',
      isActive: true,
      paymentStatus: 'paid',
      lifecycleStatus: 'active',
      createdAt: nowIso,
    });

    await db.collection('branches').doc('branch_b_main').set({
      id: 'branch_b_main',
      orgId: 'org_b',
      name: 'الفرع الرئيسي - ب',
      code: 'ORB-01',
      isActive: true,
      paymentStatus: 'paid',
      lifecycleStatus: 'active',
      createdAt: nowIso,
    });

    // Active branch_manager synthetic fixture for mo100100050@gmail.com under uid_emp_a
    await db.collection('users').doc('uid_emp_a').set({
      uid: 'uid_emp_a',
      orgId: 'org_a',
      email: 'mo100100050@gmail.com',
      displayName: 'محمد فيصل',
      role: 'branch_manager',
      branchId: 'branch_sahab_1_3',
      branchIds: ['branch_sahab_1_3'],
      branchName: 'سحاب 1 (3)',
      isActive: true,
      isArchived: false,
      membershipStatus: 'active',
      permissions: {
        canCreateClosing: true,
        canViewAllClosings: false,
        canApproveClosings: false,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: true,
        canViewBranchClosings: true,
        canApproveBranchClosings: true,
      },
      createdAt: nowIso,
    });

    // Archived employee in Org A
    await db.collection('users').doc('uid_emp_archived').set({
      uid: 'uid_emp_archived',
      orgId: 'org_a',
      email: 'archived.staff@example.com',
      displayName: 'موظف مؤرشف',
      role: 'employee',
      branchId: 'branch_sahab_1_3',
      isActive: false,
      isArchived: true,
      membershipStatus: 'archived',
      permissions: {
        canCreateClosing: false,
        canViewAllClosings: false,
        canApproveClosings: false,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: false,
      },
      createdAt: nowIso,
    });

    // Released member (detached from Org A)
    await db.collection('users').doc('uid_emp_released').set({
      uid: 'uid_emp_released',
      orgId: '',
      email: 'released.staff@example.com',
      displayName: 'موظف محرر',
      role: 'employee',
      isActive: false,
      isArchived: false,
      membershipStatus: 'released',
      releasedFromOrgId: 'org_a',
      releasedAt: nowIso,
      permissions: {
        canCreateClosing: false,
        canViewAllClosings: false,
        canApproveClosings: false,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: false,
      },
      createdAt: nowIso,
    });

    // Org B employee & closing
    await db.collection('users').doc('uid_emp_b').set({
      uid: 'uid_emp_b',
      orgId: 'org_b',
      email: 'staff.b@example.com',
      displayName: 'موظف مؤسسة ب',
      role: 'employee',
      branchId: 'branch_b_main',
      isActive: true,
      membershipStatus: 'active',
      permissions: {
        canCreateClosing: true,
        canViewAllClosings: false,
        canApproveClosings: false,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: false,
      },
      createdAt: nowIso,
    });

    await db.collection('closings').doc('closing_b_1').set({
      id: 'closing_b_1',
      orgId: 'org_b',
      branchId: 'branch_b_main',
      branchName: 'الفرع الرئيسي - ب',
      employeeId: 'uid_emp_b',
      employeeName: 'موظف مؤسسة ب',
      date: '2026-06-20',
      shift: 'morning',
      status: 'pending',
      createdAt: nowIso,
    });
  });
}

async function main() {
  console.log('\n🔥 Running AL EQFAL Employee UID Binding Emulator Rules Tests...\n');

  testEnv = await initializeTestEnvironment({
    projectId: 'scenic-proton-s3kqt',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
    },
  });

  await seedFixtures();

  await runCase('1. Active employee (uid_emp_a) reads own users/uid_emp_a, organizations/org_a, and branches/branch_sahab_1_3', async () => {
    const empADb = testEnv
      .authenticatedContext('uid_emp_a', { email: 'mo100100050@gmail.com', email_verified: false })
      .firestore();

    const userSnap = await assertSucceeds(empADb.collection('users').doc('uid_emp_a').get());
    assert.equal(userSnap.exists, true);
    assert.equal(userSnap.data()?.role, 'branch_manager');
    assert.equal(userSnap.data()?.branchId, 'branch_sahab_1_3');

    const orgSnap = await assertSucceeds(empADb.collection('organizations').doc('org_a').get());
    assert.equal(orgSnap.exists, true);

    const branchSnap = await assertSucceeds(
      empADb.collection('branches').doc('branch_sahab_1_3').get()
    );
    assert.equal(branchSnap.exists, true);
  });

  await runCase('2. Mismatched Auth UID (uid_emp_b_mismatched) with SAME email mo100100050@gmail.com gets exists=false on own UID and CANNOT read uid_emp_a or org_a', async () => {
    const mismatchedDb = testEnv
      .authenticatedContext('uid_emp_b_mismatched', {
        email: 'mo100100050@gmail.com',
        email_verified: false,
      })
      .firestore();

    // Reading own path succeeds with exists === false (never throws permission-denied)
    const ownSnap = await assertSucceeds(
      mismatchedDb.collection('users').doc('uid_emp_b_mismatched').get()
    );
    assert.equal(ownSnap.exists, false);

    // Strictly blocked from reading the real employee's profile or Org A data by email
    await assertPermissionDenied(mismatchedDb.collection('users').doc('uid_emp_a').get());
    await assertPermissionDenied(mismatchedDb.collection('organizations').doc('org_a').get());
    await assertPermissionDenied(
      mismatchedDb.collection('branches').doc('branch_sahab_1_3').get()
    );
  });

  await runCase('3. Archived employee can read own profile (to render account_archived) and is strictly blocked from org branches', async () => {
    const archivedDb = testEnv
      .authenticatedContext('uid_emp_archived', {
        email: 'archived.staff@example.com',
        email_verified: false,
      })
      .firestore();

    const ownSnap = await assertSucceeds(
      archivedDb.collection('users').doc('uid_emp_archived').get()
    );
    assert.equal(ownSnap.exists, true);
    assert.equal(ownSnap.data()?.isArchived, true);

    await assertPermissionDenied(
      archivedDb.collection('branches').doc('branch_sahab_1_3').get()
    );
  });

  await runCase('4. Released employee can read own profile (to render membership_released) and is strictly blocked from Org A', async () => {
    const releasedDb = testEnv
      .authenticatedContext('uid_emp_released', {
        email: 'released.staff@example.com',
        email_verified: false,
      })
      .firestore();

    const ownSnap = await assertSucceeds(
      releasedDb.collection('users').doc('uid_emp_released').get()
    );
    assert.equal(ownSnap.exists, true);
    assert.equal(ownSnap.data()?.membershipStatus, 'released');

    await assertPermissionDenied(releasedDb.collection('organizations').doc('org_a').get());
    await assertPermissionDenied(
      releasedDb.collection('branches').doc('branch_sahab_1_3').get()
    );
  });

  await runCase('5. Cross-tenant isolation: Org A employee (uid_emp_a) is strictly blocked from Org B org, branch, user, and closing', async () => {
    const empADb = testEnv
      .authenticatedContext('uid_emp_a', { email: 'mo100100050@gmail.com', email_verified: false })
      .firestore();

    await assertPermissionDenied(empADb.collection('organizations').doc('org_b').get());
    await assertPermissionDenied(empADb.collection('branches').doc('branch_b_main').get());
    await assertPermissionDenied(empADb.collection('users').doc('uid_emp_b').get());
    await assertPermissionDenied(empADb.collection('closings').doc('closing_b_1').get());
  });

  await testEnv.cleanup();
  console.log(`\n📊 Emulator Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Fatal emulator test error:', err);
  if (testEnv) {
    await testEnv.cleanup().catch(() => {});
  }
  process.exit(1);
});
