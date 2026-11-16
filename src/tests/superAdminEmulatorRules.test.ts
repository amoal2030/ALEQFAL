/**
 * Phase 1 Security & Read-Only Monitoring Verification Suite
 * Tests Super Admin rules (amoal2030@gmail.com ONLY with email_verified=true)
 * against real firestore.rules in an isolated local Firestore Emulator.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { isVerifiedSuperAdmin } from '../utils/superAdmin';

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

async function runSuperAdminPhase1Tests() {
  console.log('========================================================================');
  console.log('   PHASE 1: SUPER ADMIN READ-ONLY SECURITY TESTS (FIRESTORE EMULATOR)   ');
  console.log('========================================================================\n');

  // 0. Pure unit checks on unified identity helper
  assert.equal(
    isVerifiedSuperAdmin({ email: 'amoal2030@gmail.com', emailVerified: true }),
    true
  );
  assert.equal(
    isVerifiedSuperAdmin({ email: '  AMOAL2030@GMAIL.COM ', emailVerified: true }),
    true
  );
  assert.equal(
    isVerifiedSuperAdmin({ email: 'amoal2030@gmail.com', emailVerified: false }),
    false
  );
  assert.equal(
    isVerifiedSuperAdmin({ email: 'onlak2030@gmail.com', emailVerified: true }),
    false
  );
  assert.equal(isVerifiedSuperAdmin(null), false);
  assert.equal(isVerifiedSuperAdmin({ email: '', emailVerified: true }), false);
  console.log('✔ Unit Check PASSED: isVerifiedSuperAdmin strictly matches verified amoal2030@gmail.com only.');

  // Verify SuperAdminDashboard and AuthContext Super Admin loader do not invoke Drive OAuth tokens
  const superAdminSource = fs.readFileSync('src/components/superadmin/SuperAdminDashboard.tsx', 'utf8');
  assert.equal(
    /requestDriveAuthorization|getActiveDriveSession|updateDoc|setDoc|deleteDoc/.test(superAdminSource),
    false,
    'SuperAdminDashboard must remain strictly read-only and never invoke Drive OAuth or Firestore writes'
  );
  console.log('✔ Isolation Check PASSED: SuperAdminDashboard has zero Drive OAuth or Firestore mutation calls.');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-superadmin-phase1-tests',
    firestore: {
      rules: rulesContent,
      host,
      port,
    },
  });

  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.doc('organizations/org_alpha').set({
      id: 'org_alpha',
      name: 'مؤسسة ألفا التجارية',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_alpha',
      ownerEmail: 'manager.alpha@example.com',
      ownerName: 'مدير ألفا',
      driveConnected: true,
      driveAccountEmail: 'drive.alpha@example.com',
      driveWriteVerified: true,
      driveLastHealthStatus: 'verified',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('organizations/org_beta').set({
      id: 'org_beta',
      name: 'مؤسسة بيتا للمطاعم',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'mgr_beta',
      ownerEmail: 'onlak2030@gmail.com',
      ownerName: 'مدير بيتا',
      driveConnected: false,
      driveWriteVerified: false,
      driveLastHealthStatus: 'untested',
      isActive: false,
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-11T08:00:00Z',
    });

    await db.doc('organizations/org_super_own').set({
      id: 'org_super_own',
      name: 'مؤسسة المدير الرئيسي الخاصة',
      activityType: 'services',
      currency: 'SAR',
      ownerId: 'uid_sa_with_org',
      ownerEmail: 'amoal2030@gmail.com',
      ownerName: 'المدير الرئيسي',
      driveConnected: true,
      driveAccountEmail: 'amoal2030@gmail.com',
      driveWriteVerified: true,
      driveLastHealthStatus: 'verified',
      isActive: true,
      createdAt: '2026-11-12T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    });

    await db.doc('branches/br_alpha_01').set({
      id: 'br_alpha_01',
      orgId: 'org_alpha',
      name: 'فرع ألفا الرئيسي',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('branches/br_beta_01').set({
      id: 'br_beta_01',
      orgId: 'org_beta',
      name: 'فرع بيتا الرئيسي',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-11-11T08:00:00Z',
    });

    await db.doc('branches/br_sa_01').set({
      id: 'br_sa_01',
      orgId: 'org_super_own',
      name: 'فرع خاص',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-11-12T08:00:00Z',
    });

    await db.doc('users/mgr_alpha').set({
      uid: 'mgr_alpha',
      orgId: 'org_alpha',
      email: 'manager.alpha@example.com',
      displayName: 'مدير ألفا',
      role: 'manager',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('users/emp_alpha').set({
      uid: 'emp_alpha',
      orgId: 'org_alpha',
      branchId: 'br_alpha_01',
      branchName: 'فرع ألفا الرئيسي',
      email: 'cashier.alpha@example.com',
      displayName: 'موظف ألفا',
      role: 'employee',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('users/mgr_beta').set({
      uid: 'mgr_beta',
      orgId: 'org_beta',
      email: 'onlak2030@gmail.com',
      displayName: 'مدير بيتا',
      role: 'manager',
      isActive: true,
      createdAt: '2026-11-11T08:00:00Z',
    });

    await db.doc('users/uid_sa_with_org').set({
      uid: 'uid_sa_with_org',
      orgId: 'org_super_own',
      email: 'amoal2030@gmail.com',
      displayName: 'المدير الرئيسي',
      role: 'manager',
      isActive: true,
      createdAt: '2026-11-12T08:00:00Z',
    });

    await db.doc('closings/cls_beta_01').set({
      id: 'cls_beta_01',
      orgId: 'org_beta',
      branchId: 'br_beta_01',
      branchName: 'فرع بيتا الرئيسي',
      employeeId: 'mgr_beta',
      employeeName: 'مدير بيتا',
      date: '2026-11-12',
      period: 'morning',
      cashSales: 500,
      cardSales: 500,
      totalSales: 1000,
      expenses: 0,
      remainingInBox: 500,
      netPeriod: 1000,
      status: 'pending_review',
      createdAt: '2026-11-12T09:00:00Z',
      updatedAt: '2026-11-12T09:00:00Z',
    });
  });

  try {
    // 1. Verified amoal2030@gmail.com reads ALL organizations, branches, and users (matching loadSuperAdminOverview server reads)
    const saNoDocDb = testEnv
      .authenticatedContext('uid_sa_no_doc', {
        email: 'amoal2030@gmail.com',
        email_verified: true,
      })
      .firestore();
    const orgsSnap = await assertSucceeds(saNoDocDb.collection('organizations').get({ source: 'server' }));
    assert.equal(orgsSnap.size, 3);
    const branchesSnap = await assertSucceeds(saNoDocDb.collection('branches').get({ source: 'server' }));
    assert.equal(branchesSnap.size, 3);
    const usersSnap = await assertSucceeds(saNoDocDb.collection('users').get({ source: 'server' }));
    assert.equal(usersSnap.size, 4);
    const alphaDoc = await assertSucceeds(saNoDocDb.doc('organizations/org_alpha').get({ source: 'server' }));
    assert.equal(alphaDoc.data()?.driveAccountEmail, 'drive.alpha@example.com');

    // Mixed-case token email with email_verified=true also succeeds
    const saUpperEmailDb = testEnv
      .authenticatedContext('uid_sa_upper', {
        email: 'AMOAL2030@GMAIL.COM',
        email_verified: true,
      })
      .firestore();
    assert.equal((await assertSucceeds(saUpperEmailDb.collection('organizations').get({ source: 'server' }))).size, 3);
    assert.equal((await assertSucceeds(saUpperEmailDb.collection('branches').get({ source: 'server' }))).size, 3);
    assert.equal((await assertSucceeds(saUpperEmailDb.collection('users').get({ source: 'server' }))).size, 4);

    const saWithOrgDb = testEnv
      .authenticatedContext('uid_sa_with_org', {
        email: 'amoal2030@gmail.com',
        email_verified: true,
      })
      .firestore();
    await assertSucceeds(saWithOrgDb.collection('organizations').get({ source: 'server' }));
    await assertSucceeds(saWithOrgDb.collection('branches').get({ source: 'server' }));
    await assertSucceeds(saWithOrgDb.collection('users').get({ source: 'server' }));
    console.log('✔ Test 1 PASSED: Verified amoal2030@gmail.com reads all organizations, branches, users, and Drive metadata (server-source).');

    // 2. onlak2030@gmail.com CANNOT read other organizations, branches, or users
    const onlakDb = testEnv
      .authenticatedContext('mgr_beta', {
        email: 'onlak2030@gmail.com',
        email_verified: true,
      })
      .firestore();
    await assertFails(onlakDb.doc('organizations/org_alpha').get());
    await assertFails(onlakDb.collection('organizations').get({ source: 'server' }));
    await assertFails(onlakDb.doc('branches/br_alpha_01').get());
    await assertFails(onlakDb.collection('branches').get({ source: 'server' }));
    await assertFails(onlakDb.doc('users/emp_alpha').get());
    await assertFails(onlakDb.collection('users').get({ source: 'server' }));
    console.log('✔ Test 2 PASSED: onlak2030@gmail.com is strictly blocked from accessing other organizations.');

    // 3. Spoofed amoal2030@gmail.com with email_verified=false AND tokens missing email claim CANNOT get Super Admin privileges
    const unverifiedSaDb = testEnv
      .authenticatedContext('uid_spoof_sa', {
        email: 'amoal2030@gmail.com',
        email_verified: false,
      })
      .firestore();
    await assertFails(unverifiedSaDb.doc('organizations/org_alpha').get());
    await assertFails(unverifiedSaDb.collection('organizations').get({ source: 'server' }));
    await assertFails(unverifiedSaDb.doc('branches/br_alpha_01').get());
    await assertFails(unverifiedSaDb.collection('branches').get({ source: 'server' }));
    await assertFails(unverifiedSaDb.doc('users/emp_alpha').get());
    await assertFails(unverifiedSaDb.collection('users').get({ source: 'server' }));

    const noEmailClaimDb = testEnv.authenticatedContext('uid_no_email_claim', {}).firestore();
    await assertFails(noEmailClaimDb.collection('organizations').get({ source: 'server' }));
    await assertFails(noEmailClaimDb.collection('branches').get({ source: 'server' }));
    await assertFails(noEmailClaimDb.collection('users').get({ source: 'server' }));
    console.log('✔ Test 3 PASSED: Unverified amoal2030@gmail.com and tokens missing email claims are denied Super Admin access.');

    // 4. Regular manager CANNOT view other organizations, branches, or users
    const mgrAlphaDb = testEnv
      .authenticatedContext('mgr_alpha', {
        email: 'manager.alpha@example.com',
        email_verified: true,
      })
      .firestore();
    await assertFails(mgrAlphaDb.doc('organizations/org_beta').get());
    await assertFails(mgrAlphaDb.collection('organizations').get());
    await assertFails(mgrAlphaDb.doc('branches/br_beta_01').get());
    await assertFails(mgrAlphaDb.collection('branches').get());
    await assertFails(mgrAlphaDb.doc('users/mgr_beta').get());
    await assertFails(mgrAlphaDb.collection('users').get());
    console.log('✔ Test 4 PASSED: Regular manager cannot browse other organizations.');

    // 5. Regular employee CANNOT view other organizations, branches, or users
    const empAlphaDb = testEnv
      .authenticatedContext('emp_alpha', {
        email: 'cashier.alpha@example.com',
        email_verified: true,
      })
      .firestore();
    await assertFails(empAlphaDb.doc('organizations/org_beta').get());
    await assertFails(empAlphaDb.collection('organizations').get());
    await assertFails(empAlphaDb.doc('branches/br_beta_01').get());
    await assertFails(empAlphaDb.collection('branches').get());
    await assertFails(empAlphaDb.doc('users/mgr_beta').get());
    await assertFails(empAlphaDb.collection('users').get());
    console.log('✔ Test 5 PASSED: Regular employee cannot browse other organizations.');

    // 6. Phase 4.2: Super Admin manages org & branch lifecycle (requiring valid 30d grace on suspend), while staying blocked from active org closings & org users
    await assertSucceeds(saWithOrgDb.doc('organizations/org_alpha').update({ isActive: false }));
    await assertSucceeds(saWithOrgDb.doc('organizations/org_alpha').update({ isActive: true }));
    await assertFails(saWithOrgDb.doc('organizations/org_alpha').delete());
    await assertFails(saWithOrgDb.doc('users/emp_alpha').update({ isActive: false }));
    await assertFails(saWithOrgDb.doc('users/emp_alpha').delete());
    // Bare branch deactivation without lifecycleStatus/suspendedAt/gracePeriodEndsAt (>= 30d) MUST fail
    await assertFails(saWithOrgDb.doc('branches/br_alpha_01').update({ isActive: false }));
    await assertFails(saWithOrgDb.doc('branches/br_alpha_01').delete());
    // Org manager & onlak2030 CANNOT suspend/delete branches either
    await assertFails(mgrAlphaDb.doc('branches/br_alpha_01').update({ isActive: false }));
    await assertFails(mgrAlphaDb.doc('branches/br_alpha_01').delete());
    await assertFails(onlakDb.doc('branches/br_alpha_01').update({ isActive: false }));
    await assertFails(saWithOrgDb.doc('closings/cls_beta_01').update({ status: 'approved' }));
    await assertFails(saWithOrgDb.doc('closings/cls_beta_01').delete());
    await assertFails(saNoDocDb.collection('closings').get());
    // Also verify no one can promote a user doc to role: 'super_admin'
    await assertFails(mgrAlphaDb.doc('users/emp_alpha').update({ role: 'super_admin' }));
    await assertFails(empAlphaDb.doc('users/emp_alpha').update({ role: 'super_admin' }));
    console.log('✔ Test 6 PASSED: Super Admin enforces valid 30d branch grace rules while remaining blocked from active org closings/users & role promotion.');

    // 7. Manager and Employee retain all existing permissions inside their own organization (plus Super Admin retains access to their own org)
    await assertSucceeds(mgrAlphaDb.doc('organizations/org_alpha').get());
    await assertSucceeds(mgrAlphaDb.collection('branches').where('orgId', '==', 'org_alpha').get());
    await assertSucceeds(mgrAlphaDb.collection('users').where('orgId', '==', 'org_alpha').get());
    await assertSucceeds(mgrAlphaDb.doc('users/emp_alpha').update({ isActive: false }));
    await assertSucceeds(mgrAlphaDb.doc('users/emp_alpha').update({ isActive: true }));
    await assertSucceeds(empAlphaDb.doc('organizations/org_alpha').get());
    await assertSucceeds(empAlphaDb.doc('branches/br_alpha_01').get());
    await assertSucceeds(empAlphaDb.doc('users/emp_alpha').get());
    await assertSucceeds(saWithOrgDb.doc('organizations/org_super_own').update({ name: 'مؤسسة محدثة' }));
    console.log('✔ Test 7 PASSED: Manager, employee, and Super Admin own-org permissions remain completely intact.');

    console.log('\n========================================================================');
    console.log('   ALL 7 SUPER ADMIN PHASE 1 SECURITY TESTS PASSED 100%                ');
    console.log('========================================================================');
  } finally {
    await testEnv.cleanup();
  }
}

runSuperAdminPhase1Tests().catch((err) => {
  console.error('SUPER ADMIN PHASE 1 TEST FAILED:', err);
  process.exit(1);
});
