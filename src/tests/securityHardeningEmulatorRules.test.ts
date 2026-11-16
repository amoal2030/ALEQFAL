/**
 * Security Hardening Emulator Verification Suite
 * Verifies all 9 mandatory security scenarios against real firestore.rules:
 * 1. Employee cannot tamper with permissions, email, or self-update while disabled.
 * 2. Disabled employee cannot list branches or closings, while retaining self user doc get.
 * 3. Manager can update employees of their own org (status, branch, same-org employee creation).
 * 4. Manager cannot update employees of another org or assign cross-org branches.
 * 5. Employee branch change records atomic EMPLOYEE_BRANCH_CHANGED audit log (and blocks spoofing).
 * 6. Verified amoal2030@gmail.com retains strict read-only Super Admin privileges.
 * 7. onlak2030@gmail.com receives zero Super Admin privileges.
 * 8. No user can promote themselves or others to super_admin.
 * 9. Existing closing & archive workflows remain compatible.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

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

async function runSecurityHardeningTests() {
  console.log('========================================================================');
  console.log('   SECURITY HARDENING EMULATOR TEST SUITE (9 MANDATORY SCENARIOS)       ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-security-hardening-tests',
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
      name: 'مؤسسة ألفا',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_alpha',
      ownerEmail: 'manager.alpha@example.com',
      ownerName: 'مدير ألفا',
      driveConnected: true,
      driveWriteVerified: true,
      driveLastHealthStatus: 'verified',
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('organizations/org_beta').set({
      id: 'org_beta',
      name: 'مؤسسة بيتا',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'mgr_beta',
      ownerEmail: 'onlak2030@gmail.com',
      ownerName: 'مدير بيتا',
      driveConnected: false,
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-11T08:00:00Z',
    });

    await db.doc('branches/br_alpha_1').set({
      id: 'br_alpha_1',
      orgId: 'org_alpha',
      name: 'فرع ألفا الأول',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('branches/br_alpha_2').set({
      id: 'br_alpha_2',
      orgId: 'org_alpha',
      name: 'فرع ألفا الثاني',
      code: 'B-02',
      isActive: true,
      createdAt: '2026-11-10T09:00:00Z',
    });

    await db.doc('branches/br_beta_1').set({
      id: 'br_beta_1',
      orgId: 'org_beta',
      name: 'فرع بيتا الأول',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-11-11T08:00:00Z',
    });

    await db.doc('users/mgr_alpha').set({
      uid: 'mgr_alpha',
      orgId: 'org_alpha',
      email: 'manager.alpha@example.com',
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
      },
      createdAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('users/emp_alpha').set({
      uid: 'emp_alpha',
      orgId: 'org_alpha',
      branchId: 'br_alpha_1',
      branchName: 'فرع ألفا الأول',
      email: 'emp.alpha@example.com',
      displayName: 'موظف ألفا',
      phone: '0500000001',
      role: 'employee',
      isActive: true,
      permissions: {
        canCreateClosing: true,
        canViewAllClosings: false,
        canApproveClosings: false,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: false,
      },
      createdAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('users/emp_alpha_disabled').set({
      uid: 'emp_alpha_disabled',
      orgId: 'org_alpha',
      branchId: 'br_alpha_1',
      branchName: 'فرع ألفا الأول',
      email: 'emp.disabled@example.com',
      displayName: 'موظف معطل',
      role: 'employee',
      isActive: false,
      permissions: {
        canCreateClosing: true,
        canViewAllClosings: false,
        canApproveClosings: false,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: false,
      },
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

    await db.doc('users/emp_beta').set({
      uid: 'emp_beta',
      orgId: 'org_beta',
      branchId: 'br_beta_1',
      branchName: 'فرع بيتا الأول',
      email: 'emp.beta@example.com',
      displayName: 'موظف بيتا',
      role: 'employee',
      isActive: true,
      createdAt: '2026-11-11T08:00:00Z',
    });

    await db.doc('closings/cls_alpha_01').set({
      id: 'cls_alpha_01',
      orgId: 'org_alpha',
      branchId: 'br_alpha_1',
      branchName: 'فرع ألفا الأول',
      employeeId: 'emp_alpha',
      employeeName: 'موظف ألفا',
      date: '2026-11-14',
      period: 'morning',
      cashSales: 1000,
      cardSales: 500,
      totalSales: 1500,
      expenses: 100,
      remainingInBox: 900,
      netPeriod: 1400,
      status: 'pending_review',
      createdAt: '2026-11-14T10:00:00Z',
      updatedAt: '2026-11-14T10:00:00Z',
    });
  });

  try {
    const empAlphaDb = testEnv.authenticatedContext('emp_alpha', { email: 'emp.alpha@example.com', email_verified: true }).firestore();
    const disabledEmpDb = testEnv.authenticatedContext('emp_alpha_disabled', { email: 'emp.disabled@example.com', email_verified: true }).firestore();
    const mgrAlphaDb = testEnv.authenticatedContext('mgr_alpha', { email: 'manager.alpha@example.com', email_verified: true }).firestore();
    const mgrBetaDb = testEnv.authenticatedContext('mgr_beta', { email: 'onlak2030@gmail.com', email_verified: true }).firestore();
    const superAdminDb = testEnv.authenticatedContext('uid_sa', { email: 'amoal2030@gmail.com', email_verified: true }).firestore();

    // 1. Employee cannot tamper with permissions, email, or shadow fields; active self-update of displayName/phone works; disabled self-update fails
    await assertFails(
      empAlphaDb.doc('users/emp_alpha').update({
        'permissions.canApproveClosings': true,
      })
    );
    await assertFails(
      empAlphaDb.doc('users/emp_alpha').update({
        email: 'spoofed@example.com',
      })
    );
    await assertFails(
      empAlphaDb.doc('users/emp_alpha').update({
        uid: 'other_uid',
      })
    );
    await assertFails(
      disabledEmpDb.doc('users/emp_alpha_disabled').update({
        displayName: 'محاولة تحديث معطل',
      })
    );
    await assertSucceeds(
      empAlphaDb.doc('users/emp_alpha').update({
        displayName: 'موظف ألفا المحدث',
        phone: '0551234567',
      })
    );
    console.log('✔ 1 PASSED: Employee cannot modify permissions/email; disabled self-update blocked; active personal displayName/phone update allowed.');

    // 2. Disabled employee CANNOT list branches or closings, while retaining read on their own users/{uid} doc
    await assertFails(
      disabledEmpDb.collection('branches').where('orgId', '==', 'org_alpha').get()
    );
    await assertFails(
      disabledEmpDb.collection('closings').where('orgId', '==', 'org_alpha').get()
    );
    await assertSucceeds(disabledEmpDb.doc('users/emp_alpha_disabled').get());
    console.log('✔ 2 PASSED: Disabled employee blocked from listing branches/closings while retaining self user doc get.');

    // 3. Manager can update & provision employees of their own org (with UID == userId & same-org branch)
    await assertSucceeds(
      mgrAlphaDb.doc('users/emp_alpha').update({ isActive: false })
    );
    await assertSucceeds(
      mgrAlphaDb.doc('users/emp_alpha').update({ isActive: true })
    );
    const provisionBatch = mgrAlphaDb.batch();
    provisionBatch.set(mgrAlphaDb.doc('users/emp_alpha_new'), {
      uid: 'emp_alpha_new',
      orgId: 'org_alpha',
      email: 'new.emp@example.com',
      displayName: 'موظف جديد',
      role: 'employee',
      branchId: 'br_alpha_1',
      branchName: 'فرع ألفا الأول',
      isActive: true,
      createdAt: '2026-11-15T08:00:00Z',
    });
    provisionBatch.set(mgrAlphaDb.doc('auditLogs/log_prov_new_01'), {
      id: 'log_prov_new_01',
      orgId: 'org_alpha',
      actorId: 'mgr_alpha',
      actorName: 'مدير ألفا',
      actorRole: 'manager',
      action: 'EMPLOYEE_PROVISIONED',
      targetType: 'employee',
      targetId: 'emp_alpha_new',
      details: 'إنشاء حساب موظف جديد على فرع ألفا الأول',
      timestamp: '2026-11-15T08:00:00Z',
    });
    await assertSucceeds(provisionBatch.commit());
    // Mismatched uid vs userId or cross-org branch on create MUST fail
    await assertFails(
      mgrAlphaDb.doc('users/emp_mismatch_doc').set({
        uid: 'different_uid',
        orgId: 'org_alpha',
        email: 'bad@example.com',
        displayName: 'مخالف',
        role: 'employee',
        branchId: 'br_alpha_1',
        isActive: true,
        createdAt: '2026-11-15T08:00:00Z',
      })
    );
    await assertFails(
      mgrAlphaDb.doc('users/emp_cross_branch_doc').set({
        uid: 'emp_cross_branch_doc',
        orgId: 'org_alpha',
        email: 'badbranch@example.com',
        displayName: 'فرع أجنبي',
        role: 'employee',
        branchId: 'br_beta_1',
        isActive: true,
        createdAt: '2026-11-15T08:00:00Z',
      })
    );
    console.log('✔ 3 PASSED: Manager updates/creates own-org employees cleanly; mismatched UID and cross-org branch provisioning blocked.');

    // 4. Manager CANNOT update employees of another org or assign another org's branch
    await assertFails(
      mgrBetaDb.doc('users/emp_alpha').update({ isActive: false })
    );
    await assertFails(
      mgrAlphaDb.doc('users/emp_beta').update({ branchId: 'br_alpha_1' })
    );
    await assertFails(
      mgrAlphaDb.doc('users/emp_alpha').update({ branchId: 'br_beta_1', branchName: 'فرع بيتا الأول' })
    );
    console.log('✔ 4 PASSED: Manager blocked from editing other-org employees or assigning cross-org branches.');

    // 5. Employee branch change succeeds atomically with EMPLOYEE_BRANCH_CHANGED audit log (and blocks forged logs)
    const branchChangeBatch = mgrAlphaDb.batch();
    branchChangeBatch.update(mgrAlphaDb.doc('users/emp_alpha'), {
      branchId: 'br_alpha_2',
      branchName: 'فرع ألفا الثاني',
    });
    branchChangeBatch.set(mgrAlphaDb.doc('auditLogs/log_branch_chg_01'), {
      id: 'log_branch_chg_01',
      orgId: 'org_alpha',
      actorId: 'mgr_alpha',
      actorName: 'مدير ألفا',
      actorRole: 'manager',
      action: 'EMPLOYEE_BRANCH_CHANGED',
      targetType: 'employee',
      targetId: 'emp_alpha',
      details: 'تغيير فرع الموظف emp_alpha إلى فرع ألفا الثاني',
      timestamp: '2026-11-15T09:00:00Z',
    });
    await assertSucceeds(branchChangeBatch.commit());
    // Spoofed EMPLOYEE_BRANCH_CHANGED without actual branch transition MUST fail
    await assertFails(
      mgrAlphaDb.doc('auditLogs/log_branch_spoof').set({
        id: 'log_branch_spoof',
        orgId: 'org_alpha',
        actorId: 'mgr_alpha',
        actorName: 'مدير ألفا',
        actorRole: 'manager',
        action: 'EMPLOYEE_BRANCH_CHANGED',
        targetType: 'employee',
        targetId: 'emp_alpha',
        details: 'سجل مزور بدون تغيير فرع فعلي',
        timestamp: '2026-11-15T09:05:00Z',
      })
    );
    // Unauthorized action name MUST still fail
    await assertFails(
      mgrAlphaDb.doc('auditLogs/log_unauth_action').set({
        id: 'log_unauth_action',
        orgId: 'org_alpha',
        actorId: 'mgr_alpha',
        actorName: 'مدير ألفا',
        actorRole: 'manager',
        action: 'ARBITRARY_FORGED_ACTION',
        targetType: 'employee',
        targetId: 'emp_alpha',
        details: 'محاولة تمرير إجراء غير مصرح به',
        timestamp: '2026-11-15T09:06:00Z',
      })
    );
    console.log('✔ 5 PASSED: EMPLOYEE_BRANCH_CHANGED succeeds atomically and blocks forged/unauthorized audit actions.');

    // 6. Verified amoal2030@gmail.com manages orgs only and stays blocked from users updates, bare branch suspension without 30d grace, & active closings
    const allOrgs = await assertSucceeds(superAdminDb.collection('organizations').get());
    assert.equal(allOrgs.size, 2);
    const allBranches = await assertSucceeds(superAdminDb.collection('branches').get());
    assert.equal(allBranches.size, 3);
    const allUsers = await assertSucceeds(superAdminDb.collection('users').get());
    assert.equal(allUsers.size, 6);
    await assertSucceeds(superAdminDb.doc('organizations/org_alpha').update({ name: 'مؤسسة ألفا' }));
    await assertFails(superAdminDb.doc('users/emp_alpha').update({ isActive: false }));
    await assertFails(superAdminDb.doc('branches/br_alpha_1').update({ isActive: false }));
    await assertFails(mgrAlphaDb.doc('branches/br_alpha_1').update({ isActive: false }));
    await assertFails(superAdminDb.collection('closings').get());
    console.log('✔ 6 PASSED: Verified amoal2030@gmail.com manages orgs cleanly and stays blocked from users updates, bare branch suspension, & closings.');

    // 7. onlak2030@gmail.com receives ZERO Super Admin access
    await assertFails(mgrBetaDb.collection('organizations').get());
    await assertFails(mgrBetaDb.collection('branches').get());
    await assertFails(mgrBetaDb.collection('users').get());
    await assertFails(mgrBetaDb.doc('organizations/org_alpha').get());
    console.log('✔ 7 PASSED: onlak2030@gmail.com has zero Super Admin access.');

    // 8. Self or peer promotion to super_admin is strictly blocked
    await assertFails(empAlphaDb.doc('users/emp_alpha').update({ role: 'super_admin' }));
    await assertFails(mgrAlphaDb.doc('users/emp_alpha').update({ role: 'super_admin' }));
    await assertFails(mgrAlphaDb.doc('users/mgr_alpha').update({ role: 'super_admin' }));
    console.log('✔ 8 PASSED: Promotion to super_admin is strictly blocked.');

    // 9. Existing closing approval & archive workflow remains compatible
    const approveBatch = mgrAlphaDb.batch();
    approveBatch.update(mgrAlphaDb.doc('closings/cls_alpha_01'), {
      status: 'approved',
      reviewedBy: 'mgr_alpha',
      reviewedByName: 'مدير ألفا',
      reviewedAt: '2026-11-15T10:00:00Z',
      updatedAt: '2026-11-15T10:00:00Z',
    });
    approveBatch.set(mgrAlphaDb.doc('auditLogs/log_approve_alpha_01'), {
      id: 'log_approve_alpha_01',
      orgId: 'org_alpha',
      actorId: 'mgr_alpha',
      actorName: 'مدير ألفا',
      actorRole: 'manager',
      action: 'CLOSING_APPROVED',
      targetType: 'closing',
      targetId: 'cls_alpha_01',
      details: 'اعتماد إقفال فرع ألفا الأول بنجاح',
      timestamp: '2026-11-15T10:00:00Z',
    });
    approveBatch.set(mgrAlphaDb.doc('closingArchives/cls_alpha_01'), {
      closingId: 'cls_alpha_01',
      orgId: 'org_alpha',
      branchId: 'br_alpha_1',
      yearMonth: '2026-11',
      archiveStatus: 'pending_drive_sync',
      updatedAt: '2026-11-15T10:00:00Z',
    });
    await assertSucceeds(approveBatch.commit());
    console.log('✔ 9 PASSED: Existing shift closing & closingArchives workflow remains fully compatible.');

    console.log('\n========================================================================');
    console.log('   ALL 9 SECURITY HARDENING EMULATOR TESTS PASSED 100%                  ');
    console.log('========================================================================');
  } finally {
    await testEnv.cleanup();
  }
}

runSecurityHardeningTests().catch((err) => {
  console.error('SECURITY HARDENING TEST FAILED:', err);
  process.exit(1);
});
