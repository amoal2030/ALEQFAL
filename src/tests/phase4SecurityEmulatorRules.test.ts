/**
 * Phase 4.1 Security & RBAC Firestore Emulator Test Suite
 * Tests all 9 mandatory Phase 4.1 scenarios + privilege escalation + suppliers/purchases isolation
 * against the real `firestore.rules`.
 */
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeNamedDbTestEnvironment,
  NamedDbRulesTestEnvironment,
  Timestamp,
} from './namedDbEmulatorHarness';

interface TestOutcome {
  name: string;
  passed: boolean;
  error?: string;
}

async function runPhase4SecurityTests() {
  console.log('========================================================================');
  console.log('   PHASE 4.1: RBAC, BRANCH ISOLATION & PRICING RULES (EMULATOR)         ');
  console.log('========================================================================\n');

  const testEnv: NamedDbRulesTestEnvironment = await initializeNamedDbTestEnvironment();

  await testEnv.clearFirestore();

  const nowMs = Date.now();
  const oneHourMs = 60 * 60 * 1000;
  const oneDayMs = 24 * oneHourMs;
  const tsPast2d = Timestamp.fromMillis(nowMs - 2 * oneDayMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // Managed Organization (active subscription + taxNumber + 50 SAR branch pricing fields)
    await db.doc('organizations/org_main').set({
      id: 'org_main',
      name: 'مؤسسة الإقفال الحديثة',
      taxNumber: '310123456700003',
      commercialRegistration: '1010123456',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_main',
      ownerEmail: 'mgr.main@example.com',
      ownerName: 'المدير العام',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast2d,
      subscriptionEndAt: tsFuture30d,
      branchPricingModel: 'per_extra_branch_50_sar',
      includedBranchesCount: 1,
      extraBranchMonthlyFeeSar: 50,
      extraBranchesCount: 1,
      extraBranchesMonthlyTotalSar: 50,
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    });

    // Legacy Organization (unrestricted legacy model without subscription/pricing fields)
    await db.doc('organizations/org_legacy').set({
      id: 'org_legacy',
      name: 'مؤسسة قائمة قديمة',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'uid_mgr_legacy',
      ownerEmail: 'legacy.mgr@example.com',
      ownerName: 'مدير قديم',
      driveConnected: false,
      createdAt: '2026-01-01T08:00:00Z',
      updatedAt: '2026-01-01T08:00:00Z',
    });

    // Second Org for cross-org isolation tests
    await db.doc('organizations/org_other').set({
      id: 'org_other',
      name: 'مؤسسة خارجية',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_other',
      ownerEmail: 'other.mgr@example.com',
      ownerName: 'مدير آخر',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast2d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    });

    // Branches
    await db.doc('branches/br_1').set({
      id: 'br_1',
      orgId: 'org_main',
      name: 'الفرع الأول',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });
    await db.doc('branches/br_2').set({
      id: 'br_2',
      orgId: 'org_main',
      name: 'الفرع الثاني',
      code: 'B-02',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });
    await db.doc('branches/br_legacy_1').set({
      id: 'br_legacy_1',
      orgId: 'org_legacy',
      name: 'فرع قديم',
      code: 'L-01',
      isActive: true,
      createdAt: '2026-01-01T08:00:00Z',
    });

    // Users in org_main
    await db.doc('users/uid_mgr_main').set({
      uid: 'uid_mgr_main',
      orgId: 'org_main',
      email: 'mgr.main@example.com',
      displayName: 'المدير العام',
      role: 'manager',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });

    // Supervisor WITHOUT optional permissions (default opt-in = all false)
    await db.doc('users/uid_sup_none').set({
      uid: 'uid_sup_none',
      orgId: 'org_main',
      email: 'sup.none@example.com',
      displayName: 'مسؤول بلا صلاحيات',
      role: 'supervisor',
      isActive: true,
      permissions: {
        canCreateClosing: false,
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
      createdAt: '2026-11-10T08:00:00Z',
    });

    // Supervisor WITH explicit manager-granted permissions
    await db.doc('users/uid_sup_full').set({
      uid: 'uid_sup_full',
      orgId: 'org_main',
      email: 'sup.full@example.com',
      displayName: 'مسؤول بصلاحيات معتمدة',
      role: 'supervisor',
      isActive: true,
      permissions: {
        canCreateClosing: true,
        canViewAllClosings: true,
        canApproveClosings: true,
        canManageBranches: false,
        canManageEmployees: false,
        canExportReports: true,
        canManagePurchases: true,
        canManageSuppliers: true,
        canViewSuppliers: true,
        canViewFinancialReports: true,
      },
      createdAt: '2026-11-10T08:00:00Z',
    });

    // Branch Manager strictly assigned to br_1
    await db.doc('users/uid_bm_br1').set({
      uid: 'uid_bm_br1',
      orgId: 'org_main',
      email: 'bm.br1@example.com',
      displayName: 'مسؤول الفرع الأول',
      role: 'branch_manager',
      branchId: 'br_1',
      branchIds: ['br_1'],
      isActive: true,
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
      createdAt: '2026-11-10T08:00:00Z',
    });

    // Employee assigned to br_1 (scalar branchId)
    await db.doc('users/uid_emp_br1').set({
      uid: 'uid_emp_br1',
      orgId: 'org_main',
      email: 'emp.br1@example.com',
      displayName: 'موظف الفرع الأول',
      role: 'employee',
      branchId: 'br_1',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });

    // Legacy user in legacy org with scalar branchId only
    await db.doc('users/uid_mgr_legacy').set({
      uid: 'uid_mgr_legacy',
      orgId: 'org_legacy',
      email: 'legacy.mgr@example.com',
      displayName: 'مدير قديم',
      role: 'manager',
      isActive: true,
      createdAt: '2026-01-01T08:00:00Z',
    });
    await db.doc('users/uid_emp_legacy').set({
      uid: 'uid_emp_legacy',
      orgId: 'org_legacy',
      email: 'legacy.emp@example.com',
      displayName: 'موظف قديم',
      role: 'employee',
      branchId: 'br_legacy_1',
      isActive: true,
      createdAt: '2026-01-01T08:00:00Z',
    });

    // Seed closings for br_1 and br_2
    await db.doc('closings/cls_br1_pending').set({
      id: 'cls_br1_pending',
      orgId: 'org_main',
      branchId: 'br_1',
      branchName: 'الفرع الأول',
      employeeId: 'uid_emp_br1',
      employeeName: 'موظف الفرع الأول',
      date: '2026-11-14',
      period: 'morning',
      cashSales: 1000,
      cardSales: 500,
      expenses: 100,
      totalSales: 1500,
      remainingInBox: 900,
      netPeriod: 1400,
      status: 'pending_review',
      createdAt: '2026-11-14T10:00:00Z',
      updatedAt: '2026-11-14T10:00:00Z',
    });

    await db.doc('closings/cls_br2_approved').set({
      id: 'cls_br2_approved',
      orgId: 'org_main',
      branchId: 'br_2',
      branchName: 'الفرع الثاني',
      employeeId: 'uid_mgr_main',
      employeeName: 'المدير العام',
      date: '2026-11-14',
      period: 'evening',
      cashSales: 2000,
      cardSales: 1000,
      expenses: 200,
      totalSales: 3000,
      remainingInBox: 1800,
      netPeriod: 2800,
      status: 'approved',
      createdAt: '2026-11-14T22:00:00Z',
      updatedAt: '2026-11-14T22:00:00Z',
    });

    // Seed supplier & purchase
    await db.doc('suppliers/sup_main_01').set({
      id: 'sup_main_01',
      orgId: 'org_main',
      name: 'مورد القهوة المعتمد',
      isActive: true,
      createdBy: 'uid_mgr_main',
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('purchases/pur_br1_01').set({
      id: 'pur_br1_01',
      orgId: 'org_main',
      branchId: 'br_1',
      supplierId: 'sup_main_01',
      supplierName: 'مورد القهوة المعتمد',
      date: '2026-11-14',
      amount: 200,
      vatAmount: 30,
      totalAmount: 230,
      paymentMethod: 'cash',
      createdBy: 'uid_bm_br1',
      createdByRole: 'branch_manager',
      createdAt: '2026-11-14T12:00:00Z',
      updatedAt: '2026-11-14T12:00:00Z',
    });

    await db.doc('purchases/pur_br2_01').set({
      id: 'pur_br2_01',
      orgId: 'org_main',
      branchId: 'br_2',
      supplierId: 'sup_main_01',
      supplierName: 'مورد القهوة المعتمد',
      date: '2026-11-14',
      amount: 300,
      vatAmount: 45,
      totalAmount: 345,
      paymentMethod: 'transfer',
      createdBy: 'uid_mgr_main',
      createdByRole: 'manager',
      createdAt: '2026-11-14T13:00:00Z',
      updatedAt: '2026-11-14T13:00:00Z',
    });
  });

  // Auth Contexts
  const superAdminDb = testEnv
    .authenticatedContext('uid_sa', { email: 'amoal2030@gmail.com', email_verified: true })
    .firestore();
  const unverifiedSaDb = testEnv
    .authenticatedContext('uid_sa_unv', { email: 'amoal2030@gmail.com', email_verified: false })
    .firestore();
  const onlakDb = testEnv
    .authenticatedContext('uid_onlak', { email: 'onlak2030@gmail.com', email_verified: true })
    .firestore();
  const mgrMainDb = testEnv
    .authenticatedContext('uid_mgr_main', { email: 'mgr.main@example.com', email_verified: true })
    .firestore();
  const supNoneDb = testEnv
    .authenticatedContext('uid_sup_none', { email: 'sup.none@example.com', email_verified: true })
    .firestore();
  const supFullDb = testEnv
    .authenticatedContext('uid_sup_full', { email: 'sup.full@example.com', email_verified: true })
    .firestore();
  const bmBr1Db = testEnv
    .authenticatedContext('uid_bm_br1', { email: 'bm.br1@example.com', email_verified: true })
    .firestore();
  const empBr1Db = testEnv
    .authenticatedContext('uid_emp_br1', { email: 'emp.br1@example.com', email_verified: true })
    .firestore();
  const legacyMgrDb = testEnv
    .authenticatedContext('uid_mgr_legacy', { email: 'legacy.mgr@example.com', email_verified: true })
    .firestore();
  const legacyEmpDb = testEnv
    .authenticatedContext('uid_emp_legacy', { email: 'legacy.emp@example.com', email_verified: true })
    .firestore();

  const outcomes: TestOutcome[] = [];
  async function runCase(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      outcomes.push({ name, passed: true });
      console.log(`PASS: ${name}`);
    } catch (err: any) {
      outcomes.push({ name, passed: false, error: err?.message || String(err) });
      console.error(`FAIL: ${name} -> ${err?.message || err}`);
    }
  }

  // Scenario 1: Super Admin exclusive branch creation (+ taxNumber & pricing updates)
  await runCase('1. Verified amoal2030@gmail.com can create branches and update org taxNumber/pricing', async () => {
    await assertSucceeds(
      superAdminDb.doc('branches/br_3').set({
        id: 'br_3',
        orgId: 'org_main',
        name: 'الفرع الثالث',
        code: 'B-03',
        isActive: true,
        createdAt: '2026-11-15T10:00:00Z',
      })
    );
    await assertSucceeds(
      superAdminDb.doc('organizations/org_main').update({
        taxNumber: '310999888700003',
        extraBranchesCount: 2,
        extraBranchesMonthlyTotalSar: 100,
        updatedAt: '2026-11-15T10:05:00Z',
      })
    );
  });

  // Scenario 2 & 9: Org manager, unverified Super Admin, and onlak2030@gmail.com cannot create branches or gain SA access
  await runCase('2 & 9. Org manager, unverified SA, and onlak2030@gmail.com CANNOT create branches or act as SA', async () => {
    await assertFails(
      mgrMainDb.doc('branches/br_mgr_attempt').set({
        id: 'br_mgr_attempt',
        orgId: 'org_main',
        name: 'فرع غير مصرح',
        code: 'B-99',
        isActive: true,
        createdAt: '2026-11-15T10:00:00Z',
      })
    );
    await assertFails(
      unverifiedSaDb.doc('branches/br_unverified_sa').set({
        id: 'br_unverified_sa',
        orgId: 'org_main',
        name: 'فرع غير موثق',
        code: 'B-98',
        isActive: true,
        createdAt: '2026-11-15T10:00:00Z',
      })
    );
    await assertFails(
      onlakDb.doc('branches/br_onlak').set({
        id: 'br_onlak',
        orgId: 'org_main',
        name: 'فرع مرفوض',
        code: 'B-97',
        isActive: true,
        createdAt: '2026-11-15T10:00:00Z',
      })
    );
    await assertFails(onlakDb.collection('organizations').get());
    await assertFails(onlakDb.collection('branches').get());
    await assertFails(onlakDb.collection('users').get());
  });

  // Scenario 3: Employee strict single-branch isolation on closings
  await runCase('3. Employee CANNOT get or list closings of other branches; CAN get/list own branch', async () => {
    await assertFails(empBr1Db.doc('closings/cls_br2_approved').get());
    await assertFails(
      empBr1Db.collection('closings').where('orgId', '==', 'org_main').get()
    );
    await assertFails(
      empBr1Db
        .collection('closings')
        .where('orgId', '==', 'org_main')
        .where('branchId', '==', 'br_2')
        .get()
    );
    await assertSucceeds(empBr1Db.doc('closings/cls_br1_pending').get());
    await assertSucceeds(
      empBr1Db
        .collection('closings')
        .where('orgId', '==', 'org_main')
        .where('branchId', '==', 'br_1')
        .get()
    );
    // Cannot create closing for br_2
    await assertFails(
      empBr1Db.doc('closings/cls_emp_br2_spoof').set({
        id: 'cls_emp_br2_spoof',
        orgId: 'org_main',
        branchId: 'br_2',
        employeeId: 'uid_emp_br1',
        date: '2026-11-15',
        period: 'morning',
        cashSales: 100,
        cardSales: 0,
        expenses: 0,
        totalSales: 100,
        remainingInBox: 100,
        netPeriod: 100,
        status: 'draft',
        createdAt: '2026-11-15T08:00:00Z',
        updatedAt: '2026-11-15T08:00:00Z',
      })
    );
  });

  // Scenario 4: Branch Manager single-branch restriction on closings, purchases, suppliers & multi-branch binding
  await runCase('4. Branch Manager restricted strictly to 1 branch for closings/purchases & cannot create suppliers', async () => {
    await assertFails(bmBr1Db.doc('closings/cls_br2_approved').get());
    await assertFails(bmBr1Db.doc('purchases/pur_br2_01').get());
    await assertFails(
      bmBr1Db.collection('purchases').where('orgId', '==', 'org_main').get()
    );
    await assertSucceeds(bmBr1Db.doc('purchases/pur_br1_01').get());
    await assertSucceeds(
      bmBr1Db
        .collection('purchases')
        .where('orgId', '==', 'org_main')
        .where('branchId', '==', 'br_1')
        .get()
    );

    // Can read org suppliers but CANNOT create supplier
    await assertSucceeds(bmBr1Db.collection('suppliers').where('orgId', '==', 'org_main').get());
    await assertFails(
      bmBr1Db.doc('suppliers/sup_bm_attempt').set({
        id: 'sup_bm_attempt',
        orgId: 'org_main',
        name: 'مورد غير مصرح',
        isActive: true,
        createdBy: 'uid_bm_br1',
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      })
    );

    // Can create purchase in assigned branch br_1 with valid org supplier
    await assertSucceeds(
      bmBr1Db.doc('purchases/pur_br1_new').set({
        id: 'pur_br1_new',
        orgId: 'org_main',
        branchId: 'br_1',
        supplierId: 'sup_main_01',
        supplierName: 'مورد القهوة المعتمد',
        date: '2026-11-15',
        amount: 100,
        vatAmount: 15,
        totalAmount: 115,
        paymentMethod: 'cash',
        createdBy: 'uid_bm_br1',
        createdByRole: 'branch_manager',
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      })
    );

    // Cannot create purchase in unassigned branch br_2
    await assertFails(
      bmBr1Db.doc('purchases/pur_br2_spoof').set({
        id: 'pur_br2_spoof',
        orgId: 'org_main',
        branchId: 'br_2',
        supplierId: 'sup_main_01',
        date: '2026-11-15',
        amount: 100,
        totalAmount: 100,
        paymentMethod: 'cash',
        createdBy: 'uid_bm_br1',
        createdByRole: 'branch_manager',
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      })
    );

    // Even org manager cannot assign multiple branches to branch_manager
    await assertFails(
      mgrMainDb.doc('users/uid_bm_br1').update({
        branchIds: ['br_1', 'br_2'],
      })
    );
  });

  // Scenario 5: Supervisor opt-in enforcement + no self-elevation + no adminCorrectClosing
  await runCase('5. Supervisor strict opt-in permissions & zero self-escalation', async () => {
    // Unpermitted supervisor CANNOT list all closings, suppliers, purchases, or approve/create closings
    await assertFails(supNoneDb.collection('closings').where('orgId', '==', 'org_main').get());
    await assertFails(supNoneDb.collection('suppliers').where('orgId', '==', 'org_main').get());
    await assertFails(supNoneDb.collection('purchases').where('orgId', '==', 'org_main').get());
    await assertFails(supNoneDb.doc('closings/cls_br1_pending').update({ status: 'approved', reviewedBy: 'uid_sup_none' }));
    await assertFails(
      supNoneDb.doc('suppliers/sup_blocked').set({
        id: 'sup_blocked',
        orgId: 'org_main',
        name: 'مورد مرفوض',
        isActive: true,
        createdBy: 'uid_sup_none',
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      })
    );

    // Unpermitted supervisor CANNOT tamper with own permissions or role
    await assertFails(
      supNoneDb.doc('users/uid_sup_none').update({
        permissions: { canApproveClosings: true, canViewAllClosings: true },
      })
    );
    await assertFails(supNoneDb.doc('users/uid_sup_none').update({ role: 'manager' }));

    // Permitted supervisor CAN list closings/purchases/suppliers & create supplier org-wide
    await assertSucceeds(supFullDb.collection('closings').where('orgId', '==', 'org_main').get());
    await assertSucceeds(supFullDb.collection('purchases').where('orgId', '==', 'org_main').get());
    await assertSucceeds(
      supFullDb.doc('suppliers/sup_by_sup').set({
        id: 'sup_by_sup',
        orgId: 'org_main',
        name: 'مورد من المسؤول',
        isActive: true,
        createdBy: 'uid_sup_full',
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      })
    );

    // Permitted supervisor STILL CANNOT run adminCorrectClosing (approved -> approved) or manage users/branches
    await assertFails(
      supFullDb.doc('closings/cls_br2_approved').update({
        cashSales: 100,
        cardSales: 100,
        expenses: 0,
        totalSales: 200,
        remainingInBox: 100,
        netPeriod: 200,
        status: 'approved',
        correctedBy: 'uid_sup_full',
        correctionReason: 'محاولة تصحيح إداري من غير المدير',
        previousValues: {
          cashSales: 2000,
          cardSales: 1000,
          expenses: 200,
          totalSales: 3000,
        },
      })
    );
    await assertFails(supFullDb.doc('users/uid_emp_br1').update({ isActive: false }));

    // Manager also cannot promote supervisor to manager via update
    await assertFails(mgrMainDb.doc('users/uid_sup_full').update({ role: 'manager' }));
  });

  // Scenario 6: Org manager cannot edit name, taxNumber, commercialRegistration, subscription, or branch fees
  await runCase('6. Org manager CANNOT modify name, taxNumber, commercialRegistration, subscription, or 50 SAR branch fees', async () => {
    const tsFuture60d = Timestamp.fromMillis(nowMs + 60 * oneDayMs);
    await assertFails(mgrMainDb.doc('organizations/org_main').update({ taxNumber: '399999999900003' }));
    await assertFails(mgrMainDb.doc('organizations/org_main').update({ name: 'اسم مغير من المدير' }));
    await assertFails(mgrMainDb.doc('organizations/org_main').update({ commercialRegistration: '9999999999' }));
    await assertFails(mgrMainDb.doc('organizations/org_main').update({ extraBranchMonthlyFeeSar: 0 }));
    await assertFails(mgrMainDb.doc('organizations/org_main').update({ subscriptionEndAt: tsFuture60d }));
    await assertFails(mgrMainDb.doc('organizations/org_main').update({ subscriptionPlan: '1y' }));

    // Legitimate Drive metadata update by org manager succeeds
    await assertSucceeds(
      mgrMainDb.doc('organizations/org_main').update({
        driveConnected: true,
        driveFolderId: 'folder_main_123',
        driveFolderName: 'AL_EQFAL_Main',
        updatedAt: '2026-11-15T11:00:00Z',
      })
    );
  });

  // Scenario 7 & 8: Legacy unrestricted organizations and legacy users (scalar branchId) keep working cleanly
  await runCase('7 & 8. Legacy unrestricted organization and legacy scalar-branchId employee continue working cleanly', async () => {
    await assertSucceeds(
      legacyEmpDb
        .collection('closings')
        .where('orgId', '==', 'org_legacy')
        .where('branchId', '==', 'br_legacy_1')
        .get()
    );
    await assertSucceeds(
      legacyMgrDb.collection('closings').where('orgId', '==', 'org_legacy').get()
    );
    await assertSucceeds(
      legacyEmpDb.doc('closings/cls_legacy_new').set({
        id: 'cls_legacy_new',
        orgId: 'org_legacy',
        branchId: 'br_legacy_1',
        employeeId: 'uid_emp_legacy',
        date: '2026-11-15',
        period: 'morning',
        cashSales: 500,
        cardSales: 250,
        expenses: 50,
        totalSales: 750,
        remainingInBox: 450,
        netPeriod: 700,
        status: 'pending_review',
        createdAt: '2026-11-15T12:00:00Z',
        updatedAt: '2026-11-15T12:00:00Z',
      })
    );
  });

  await testEnv.cleanup();

  const failed = outcomes.filter((o) => !o.passed);
  console.log(`\nSummary: ${outcomes.length - failed.length}/${outcomes.length} Phase 4.1 security tests passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

runPhase4SecurityTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
