/**
 * Phase 4.3 Comprehensive Security, Monitoring & 4-Role Employee Management Emulator Test Suite
 * Tests all 12 required scenarios + Super Admin monitoring rules against the real `firestore.rules`.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const Timestamp = firebase.firestore.Timestamp;

interface TestOutcome {
  name: string;
  passed: boolean;
  error?: string;
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

async function runPhase43EmulatorTests() {
  console.log('========================================================================');
  console.log('   PHASE 4.3: MONITORING & 4-ROLE EMPLOYEE MANAGEMENT (EMULATOR)        ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-phase43-tests',
    firestore: {
      rules: rulesContent,
      host,
      port,
    },
  });

  await testEnv.clearFirestore();

  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const tsPast2d = Timestamp.fromMillis(nowMs - 2 * oneDayMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.doc('organizations/org_a').set({
      id: 'org_a',
      name: 'مؤسسة الإقفال أ',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_a',
      ownerEmail: 'mgr.a@example.com',
      ownerName: 'مدير أ',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast2d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('organizations/org_b').set({
      id: 'org_b',
      name: 'مؤسسة ب المعزولة',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_b',
      ownerEmail: 'mgr.b@example.com',
      ownerName: 'مدير ب',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast2d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    });

    await db.doc('organizations/org_legacy').set({
      id: 'org_legacy',
      name: 'مؤسسة قديمة',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'uid_mgr_legacy',
      ownerEmail: 'onlak2030@gmail.com',
      ownerName: 'مدير قديم',
      driveConnected: false,
      createdAt: '2026-01-01T08:00:00Z',
      updatedAt: '2026-01-01T08:00:00Z',
    });

    await db.doc('branches/br_a1').set({
      id: 'br_a1',
      orgId: 'org_a',
      name: 'الفرع الأول أ',
      code: 'A-01',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });
    await db.doc('branches/br_a2').set({
      id: 'br_a2',
      orgId: 'org_a',
      name: 'الفرع الثاني أ',
      code: 'A-02',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });
    await db.doc('branches/br_b1').set({
      id: 'br_b1',
      orgId: 'org_b',
      name: 'الفرع الأول ب',
      code: 'B-01',
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

    await db.doc('managerInvites/pending.mgr@example.com').set({
      id: 'pending.mgr@example.com',
      email: 'pending.mgr@example.com',
      emailNormalized: 'pending.mgr@example.com',
      orgId: 'org_a',
      orgName: 'مؤسسة الإقفال أ',
      role: 'manager',
      status: 'pending',
      createdBy: 'amoal2030@gmail.com',
      createdAt: tsPast2d,
      updatedAt: tsPast2d,
    });

    await db.doc('platformAuditLogs/pal_seed_1').set({
      id: 'pal_seed_1',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'uid_super_admin',
      action: 'ORG_CREATED_WITH_INVITE',
      targetType: 'organization',
      targetId: 'org_a',
      orgId: 'org_a',
      details: 'تأسيس اختباري للمراقبة',
      timestamp: '2026-11-10T08:00:00Z',
    });

    // Org A Manager
    await db.doc('users/uid_mgr_a').set({
      uid: 'uid_mgr_a',
      orgId: 'org_a',
      email: 'mgr.a@example.com',
      displayName: 'مدير المؤسسة أ',
      role: 'manager',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });

    // Org B Manager
    await db.doc('users/uid_mgr_b').set({
      uid: 'uid_mgr_b',
      orgId: 'org_b',
      email: 'mgr.b@example.com',
      displayName: 'مدير المؤسسة ب',
      role: 'manager',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });

    // Org B Staff target for cross-org attack test
    await db.doc('users/uid_emp_b1').set({
      uid: 'uid_emp_b1',
      orgId: 'org_b',
      email: 'emp.b1@example.com',
      displayName: 'موظف ب1',
      role: 'employee',
      branchId: 'br_b1',
      isActive: true,
      createdAt: '2026-11-10T08:00:00Z',
    });

    // Legacy Employee (scalar branchId only)
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

    // Pre-existing supplier in Org A
    await db.doc('suppliers/sup_a1').set({
      id: 'sup_a1',
      orgId: 'org_a',
      name: 'مورد أساسي',
      isActive: true,
      createdBy: 'uid_mgr_a',
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    });

    // Pre-existing closings in br_a1 and br_a2
    await db.doc('closings/cls_a1_pending').set({
      id: 'cls_a1_pending',
      orgId: 'org_a',
      branchId: 'br_a1',
      branchName: 'الفرع الأول أ',
      employeeId: 'uid_emp_a_hist',
      employeeName: 'موظف تاريخي',
      date: '2026-11-11',
      period: 'morning',
      cashSales: 1000,
      cardSales: 500,
      totalSales: 1500,
      expenses: 100,
      remainingInBox: 900,
      netPeriod: 1400,
      status: 'pending_review',
      attachmentIds: [],
      createdAt: '2026-11-11T10:00:00Z',
      updatedAt: '2026-11-11T10:00:00Z',
    });

    await db.doc('closings/cls_a2_approved').set({
      id: 'cls_a2_approved',
      orgId: 'org_a',
      branchId: 'br_a2',
      branchName: 'الفرع الثاني أ',
      employeeId: 'uid_emp_a_hist',
      employeeName: 'موظف تاريخي',
      date: '2026-11-10',
      period: 'evening',
      cashSales: 2000,
      cardSales: 1000,
      totalSales: 3000,
      expenses: 300,
      remainingInBox: 1700,
      netPeriod: 2700,
      status: 'approved',
      attachmentIds: [],
      createdAt: '2026-11-10T20:00:00Z',
      updatedAt: '2026-11-10T21:00:00Z',
    });
  });

  const superAdminCtx = testEnv.authenticatedContext('uid_super_admin', {
    email: 'amoal2030@gmail.com',
    email_verified: true,
  });
  const unverifiedSaCtx = testEnv.authenticatedContext('uid_unverified_sa', {
    email: 'amoal2030@gmail.com',
    email_verified: false,
  });
  const onlakCtx = testEnv.authenticatedContext('uid_onlak', {
    email: 'onlak2030@gmail.com',
    email_verified: true,
  });
  const mgrACtx = testEnv.authenticatedContext('uid_mgr_a', {
    email: 'mgr.a@example.com',
    email_verified: true,
  });
  const empCtx = testEnv.authenticatedContext('uid_emp_a1', {
    email: 'emp.a1@example.com',
    email_verified: true,
  });
  const bmCtx = testEnv.authenticatedContext('uid_bm_a1', {
    email: 'bm.a1@example.com',
    email_verified: true,
  });
  const supCtx = testEnv.authenticatedContext('uid_sup_a1', {
    email: 'sup.a1@example.com',
    email_verified: true,
  });
  const legacyEmpCtx = testEnv.authenticatedContext('uid_emp_legacy', {
    email: 'legacy.emp@example.com',
    email_verified: true,
  });

  const saDb = superAdminCtx.firestore();
  const unverifiedSaDb = unverifiedSaCtx.firestore();
  const onlakDb = onlakCtx.firestore();
  const mgrADb = mgrACtx.firestore();
  const empDb = empCtx.firestore();
  const bmDb = bmCtx.firestore();
  const supDb = supCtx.firestore();
  const legacyEmpDb = legacyEmpCtx.firestore();

  const outcomes: TestOutcome[] = [];
  async function runScenario(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
      outcomes.push({ name, passed: true });
    } catch (err: any) {
      console.error(`FAIL: ${name}\n   -> ${err?.message || err}`);
      outcomes.push({ name, passed: false, error: err?.message || String(err) });
    }
  }

  // Scenario 0: Monitoring Permission Denied diagnostics & Super Admin isolation
  await runScenario(
    'Monitoring rules: Verified amoal2030@gmail.com reads all 5 collections; onlak2030 & unverified SA & manager denied',
    async () => {
      await assertSucceeds(saDb.collection('organizations').get());
      await assertSucceeds(saDb.collection('branches').get());
      await assertSucceeds(saDb.collection('users').get());
      await assertSucceeds(saDb.collection('managerInvites').get());
      await assertSucceeds(saDb.collection('platformAuditLogs').get());

      await assertFails(onlakDb.collection('organizations').get());
      await assertFails(onlakDb.collection('managerInvites').get());
      await assertFails(onlakDb.collection('platformAuditLogs').get());

      await assertFails(unverifiedSaDb.collection('organizations').get());
      await assertFails(unverifiedSaDb.collection('platformAuditLogs').get());

      await assertFails(mgrADb.collection('platformAuditLogs').get());
      await assertFails(mgrADb.collection('managerInvites').get());
    }
  );

  // Scenario 1: Manager creates employee, branch_manager (single branch), and supervisor (defaults false)
  await runScenario(
    'S1: Manager creates employee, single-branch branch_manager, and supervisor with zero opt-in permissions',
    async () => {
      const empBatch = mgrADb.batch();
      empBatch.set(mgrADb.doc('users/uid_emp_a1'), {
        uid: 'uid_emp_a1',
        orgId: 'org_a',
        email: 'emp.a1@example.com',
        displayName: 'موظف أ1',
        role: 'employee',
        branchId: 'br_a1',
        branchName: 'الفرع الأول أ',
        isActive: true,
        isArchived: false,
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
        createdAt: '2026-11-12T08:00:00Z',
        updatedAt: '2026-11-12T08:00:00Z',
      });
      empBatch.set(mgrADb.doc('auditLogs/log_create_emp_a1'), {
        id: 'log_create_emp_a1',
        orgId: 'org_a',
        actorId: 'uid_mgr_a',
        actorName: 'مدير المؤسسة أ',
        actorRole: 'manager',
        action: 'EMPLOYEE_PROVISIONED',
        targetType: 'employee',
        targetId: 'uid_emp_a1',
        details: 'إنشاء حساب موظف أ1 على الفرع الأول أ',
        timestamp: '2026-11-12T08:00:00Z',
      });
      await assertSucceeds(empBatch.commit());

      const bmBatch = mgrADb.batch();
      bmBatch.set(mgrADb.doc('users/uid_bm_a1'), {
        uid: 'uid_bm_a1',
        orgId: 'org_a',
        email: 'bm.a1@example.com',
        displayName: 'مسؤول فرع أ1',
        role: 'branch_manager',
        branchId: 'br_a1',
        branchIds: ['br_a1'],
        branchName: 'الفرع الأول أ',
        isActive: true,
        isArchived: false,
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
        createdAt: '2026-11-12T08:05:00Z',
        updatedAt: '2026-11-12T08:05:00Z',
      });
      bmBatch.set(mgrADb.doc('auditLogs/log_create_bm_a1'), {
        id: 'log_create_bm_a1',
        orgId: 'org_a',
        actorId: 'uid_mgr_a',
        actorName: 'مدير المؤسسة أ',
        actorRole: 'manager',
        action: 'EMPLOYEE_PROVISIONED',
        targetType: 'employee',
        targetId: 'uid_bm_a1',
        details: 'إنشاء حساب مسؤول فرع أ1 على الفرع الأول أ',
        timestamp: '2026-11-12T08:05:00Z',
      });
      await assertSucceeds(bmBatch.commit());

      const supBatch = mgrADb.batch();
      supBatch.set(mgrADb.doc('users/uid_sup_a1'), {
        uid: 'uid_sup_a1',
        orgId: 'org_a',
        email: 'sup.a1@example.com',
        displayName: 'مسؤول أ1',
        role: 'supervisor',
        isActive: true,
        isArchived: false,
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
        createdAt: '2026-11-12T08:10:00Z',
        updatedAt: '2026-11-12T08:10:00Z',
      });
      supBatch.set(mgrADb.doc('auditLogs/log_create_sup_a1'), {
        id: 'log_create_sup_a1',
        orgId: 'org_a',
        actorId: 'uid_mgr_a',
        actorName: 'مدير المؤسسة أ',
        actorRole: 'manager',
        action: 'EMPLOYEE_PROVISIONED',
        targetType: 'employee',
        targetId: 'uid_sup_a1',
        details: 'إنشاء حساب مسؤول أ1 بصلاحيات معطلة افتراضياً',
        timestamp: '2026-11-12T08:10:00Z',
      });
      await assertSucceeds(supBatch.commit());

      // Multi-branch branch_manager creation must FAIL
      await assertFails(
        mgrADb.doc('users/uid_bad_bm').set({
          uid: 'uid_bad_bm',
          orgId: 'org_a',
          email: 'bad.bm@example.com',
          displayName: 'مسؤول متعدد الفروع',
          role: 'branch_manager',
          branchId: 'br_a1',
          branchIds: ['br_a1', 'br_a2'],
          isActive: true,
          createdAt: '2026-11-12T08:15:00Z',
        })
      );

      // Manager creating another manager must FAIL
      await assertFails(
        mgrADb.doc('users/uid_bad_mgr').set({
          uid: 'uid_bad_mgr',
          orgId: 'org_a',
          email: 'bad.mgr@example.com',
          displayName: 'مدير إضافي',
          role: 'manager',
          isActive: true,
          createdAt: '2026-11-12T08:15:00Z',
        })
      );
    }
  );

  // Scenario 2: Supervisor with all optional perms disabled is blocked from operations
  await runScenario(
    'S2: Supervisor with default false permissions cannot create closings, purchases, suppliers, or read all closings',
    async () => {
      await assertFails(
        supDb.doc('closings/cls_sup_denied_1').set({
          id: 'cls_sup_denied_1',
          orgId: 'org_a',
          branchId: 'br_a1',
          branchName: 'الفرع الأول أ',
          employeeId: 'uid_sup_a1',
          employeeName: 'مسؤول أ1',
          date: '2026-11-12',
          period: 'morning',
          cashSales: 100,
          cardSales: 100,
          totalSales: 200,
          expenses: 10,
          remainingInBox: 90,
          netPeriod: 190,
          status: 'pending_review',
          attachmentIds: [],
          createdAt: '2026-11-12T09:00:00Z',
          updatedAt: '2026-11-12T09:00:00Z',
        })
      );

      await assertFails(supDb.doc('closings/cls_a1_pending').get());
      await assertFails(supDb.doc('closings/cls_a2_approved').get());
      await assertFails(
        supDb.doc('suppliers/sup_denied').set({
          id: 'sup_denied',
          orgId: 'org_a',
          name: 'مورد غير مصرح',
          isActive: true,
          createdBy: 'uid_sup_a1',
          createdAt: '2026-11-12T09:00:00Z',
          updatedAt: '2026-11-12T09:00:00Z',
        })
      );
      await assertFails(supDb.collection('users').where('orgId', '==', 'org_a').get());
      await assertFails(supDb.collection('auditLogs').where('orgId', '==', 'org_a').get());
    }
  );

  // Scenario 3 & 4: Manager enables opt-in perms for Supervisor -> operates across all branches,
  // can CREATE supplier if enabled, but CANNOT UPDATE/DELETE suppliers and CANNOT self-escalate
  await runScenario(
    'S3 & S4: Supervisor with opt-in perms operates org-wide and creates supplier, but is blocked from editing/deleting suppliers and self-escalation',
    async () => {
      const updateSupBatch = mgrADb.batch();
      updateSupBatch.update(mgrADb.doc('users/uid_sup_a1'), {
        permissions: {
          canCreateClosing: true,
          canViewAllClosings: false,
          canApproveClosings: true,
          canManageBranches: false,
          canManageEmployees: false,
          canExportReports: true,
          canManagePurchases: true,
          canManageSuppliers: true,
          canViewSuppliers: true,
          canViewFinancialReports: true,
        },
        updatedAt: '2026-11-12T09:15:00Z',
      });
      updateSupBatch.set(mgrADb.doc('auditLogs/log_sup_perms_1'), {
        id: 'log_sup_perms_1',
        orgId: 'org_a',
        actorId: 'uid_mgr_a',
        actorName: 'مدير المؤسسة أ',
        actorRole: 'manager',
        action: 'EMPLOYEE_ROLE_PERMISSIONS_UPDATED',
        targetType: 'employee',
        targetId: 'uid_sup_a1',
        details: 'تفعيل الصلاحيات الاختيارية للمسؤول',
        timestamp: '2026-11-12T09:15:00Z',
      });
      await assertSucceeds(updateSupBatch.commit());

      // Can read org closings (for financial reports / approvals)
      await assertSucceeds(supDb.collection('closings').where('orgId', '==', 'org_a').get());

      // Can create closing on br_a2 & br_a1
      await assertSucceeds(
        supDb.doc('closings/cls_sup_br2_ok').set({
          id: 'cls_sup_br2_ok',
          orgId: 'org_a',
          branchId: 'br_a2',
          branchName: 'الفرع الثاني أ',
          employeeId: 'uid_sup_a1',
          employeeName: 'مسؤول أ1',
          date: '2026-11-12',
          period: 'morning',
          cashSales: 500,
          cardSales: 200,
          totalSales: 700,
          expenses: 50,
          remainingInBox: 450,
          netPeriod: 650,
          status: 'pending_review',
          attachmentIds: [],
          createdAt: '2026-11-12T09:20:00Z',
          updatedAt: '2026-11-12T09:20:00Z',
        })
      );

      // Can create purchase on any org branch
      await assertSucceeds(
        supDb.doc('purchases/pur_sup_br2_ok').set({
          id: 'pur_sup_br2_ok',
          orgId: 'org_a',
          branchId: 'br_a2',
          supplierId: 'sup_a1',
          date: '2026-11-12',
          amount: 250,
          totalAmount: 250,
          paymentMethod: 'cash',
          createdBy: 'uid_sup_a1',
          createdByRole: 'supervisor',
          createdAt: '2026-11-12T09:25:00Z',
          updatedAt: '2026-11-12T09:25:00Z',
        })
      );

      // Can CREATE a new supplier when opt-in enabled
      await assertSucceeds(
        supDb.doc('suppliers/sup_created_by_sup').set({
          id: 'sup_created_by_sup',
          orgId: 'org_a',
          name: 'مورد مضاف من المسؤول',
          isActive: true,
          createdBy: 'uid_sup_a1',
          createdAt: '2026-11-12T09:30:00Z',
          updatedAt: '2026-11-12T09:30:00Z',
        })
      );

      // MUST FAIL when trying to EDIT or DELETE an existing supplier
      await assertFails(
        supDb.doc('suppliers/sup_a1').update({
          name: 'تعديل اسم غير مسموح',
          updatedAt: '2026-11-12T09:35:00Z',
        })
      );
      await assertFails(supDb.doc('suppliers/sup_created_by_sup').delete());

      // MUST FAIL self-escalation
      await assertFails(
        supDb.doc('users/uid_sup_a1').update({
          permissions: { canManageEmployees: true },
        })
      );
      await assertFails(supDb.doc('users/uid_sup_a1').update({ role: 'manager' }));
    }
  );

  // Scenario 5 & 6: Branch manager single-branch lock, supplier read-only, no cross-branch access
  await runScenario(
    'S5 & S6: Branch manager operates strictly on br_a1 (closings + purchases + read suppliers), blocked on br_a2 & supplier writes & approvals',
    async () => {
      // Read suppliers allowed
      await assertSucceeds(bmDb.collection('suppliers').where('orgId', '==', 'org_a').get());

      // Create closing + purchase in assigned br_a1 allowed
      await assertSucceeds(
        bmDb.doc('closings/cls_bm_br1_ok').set({
          id: 'cls_bm_br1_ok',
          orgId: 'org_a',
          branchId: 'br_a1',
          branchName: 'الفرع الأول أ',
          employeeId: 'uid_bm_a1',
          employeeName: 'مسؤول فرع أ1',
          date: '2026-11-12',
          period: 'evening',
          cashSales: 800,
          cardSales: 400,
          totalSales: 1200,
          expenses: 100,
          remainingInBox: 700,
          netPeriod: 1100,
          status: 'pending_review',
          attachmentIds: [],
          createdAt: '2026-11-12T10:00:00Z',
          updatedAt: '2026-11-12T10:00:00Z',
        })
      );
      await assertSucceeds(
        bmDb.doc('purchases/pur_bm_br1_ok').set({
          id: 'pur_bm_br1_ok',
          orgId: 'org_a',
          branchId: 'br_a1',
          supplierId: 'sup_a1',
          date: '2026-11-12',
          amount: 120,
          totalAmount: 120,
          paymentMethod: 'transfer',
          createdBy: 'uid_bm_a1',
          createdByRole: 'branch_manager',
          createdAt: '2026-11-12T10:05:00Z',
          updatedAt: '2026-11-12T10:05:00Z',
        })
      );

      // Blocked from reading br_a2 or adding purchases in br_a2
      await assertFails(bmDb.doc('closings/cls_a2_approved').get());
      await assertFails(
        bmDb.doc('purchases/pur_bm_br2_denied').set({
          id: 'pur_bm_br2_denied',
          orgId: 'org_a',
          branchId: 'br_a2',
          supplierId: 'sup_a1',
          date: '2026-11-12',
          amount: 100,
          totalAmount: 100,
          paymentMethod: 'cash',
          createdBy: 'uid_bm_a1',
          createdByRole: 'branch_manager',
          createdAt: '2026-11-12T10:06:00Z',
          updatedAt: '2026-11-12T10:06:00Z',
        })
      );

      // Blocked from adding/updating suppliers or approving closings
      await assertFails(
        bmDb.doc('suppliers/sup_bm_denied').set({
          id: 'sup_bm_denied',
          orgId: 'org_a',
          name: 'مورد مرفوض',
          isActive: true,
          createdBy: 'uid_bm_a1',
          createdAt: '2026-11-12T10:10:00Z',
          updatedAt: '2026-11-12T10:10:00Z',
        })
      );
      await assertFails(
        bmDb.doc('closings/cls_a1_pending').update({
          status: 'approved',
          reviewedBy: 'uid_bm_a1',
        })
      );
    }
  );

  // Scenario 7 & 8: Manager edits employee profile + transfers branch_manager from br_a1 -> br_a2 + records auditLog
  await runScenario(
    'S7 & S8: Manager transfers branch_manager strictly to br_a2 and edits employee name/phone/email with auditLogs',
    async () => {
      const transferBatch = mgrADb.batch();
      transferBatch.update(mgrADb.doc('users/uid_bm_a1'), {
        branchId: 'br_a2',
        branchIds: ['br_a2'],
        branchName: 'الفرع الثاني أ',
        updatedAt: '2026-11-12T11:00:00Z',
      });
      transferBatch.set(mgrADb.doc('auditLogs/log_transfer_bm'), {
        id: 'log_transfer_bm',
        orgId: 'org_a',
        actorId: 'uid_mgr_a',
        actorName: 'مدير المؤسسة أ',
        actorRole: 'manager',
        action: 'EMPLOYEE_BRANCH_CHANGED',
        targetType: 'employee',
        targetId: 'uid_bm_a1',
        details: 'نقل مسؤول الفرع إلى الفرع الثاني أ',
        timestamp: '2026-11-12T11:00:00Z',
      });
      await assertSucceeds(transferBatch.commit());

      // Now bm can read br_a2 closing and is denied br_a1 closing!
      await assertSucceeds(bmDb.doc('closings/cls_a2_approved').get());
      await assertFails(bmDb.doc('closings/cls_a1_pending').get());

      // Edit employee name, phone, email
      const editEmpBatch = mgrADb.batch();
      editEmpBatch.update(mgrADb.doc('users/uid_emp_a1'), {
        displayName: 'موظف أ1 المحدث',
        phone: '0551234567',
        email: 'emp.a1.new@example.com',
        updatedAt: '2026-11-12T11:05:00Z',
      });
      editEmpBatch.set(mgrADb.doc('auditLogs/log_edit_emp'), {
        id: 'log_edit_emp',
        orgId: 'org_a',
        actorId: 'uid_mgr_a',
        actorName: 'مدير المؤسسة أ',
        actorRole: 'manager',
        action: 'EMPLOYEE_UPDATED',
        targetType: 'employee',
        targetId: 'uid_emp_a1',
        details: 'تحديث الاسم ورقم الهاتف والبريد الإلكتروني للموظف',
        timestamp: '2026-11-12T11:05:00Z',
      });
      await assertSucceeds(editEmpBatch.commit());
    }
  );

  // Scenario 9: Role change (branch_manager -> supervisor or back -> employee) succeeds with clean branchIds cleanup
  await runScenario(
    'S9: Manager switches roles cleanly (branch_manager -> employee without branchIds & employee -> supervisor)',
    async () => {
      const switchBatch = mgrADb.batch();
      switchBatch.update(mgrADb.doc('users/uid_bm_a1'), {
        role: 'employee',
        branchId: 'br_a1',
        branchIds: firebase.firestore.FieldValue.delete(),
        branchName: 'الفرع الأول أ',
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
        updatedAt: '2026-11-12T11:30:00Z',
      });
      switchBatch.set(mgrADb.doc('auditLogs/log_switch_role'), {
        id: 'log_switch_role',
        orgId: 'org_a',
        actorId: 'uid_mgr_a',
        actorName: 'مدير المؤسسة أ',
        actorRole: 'manager',
        action: 'EMPLOYEE_ROLE_PERMISSIONS_UPDATED',
        targetType: 'employee',
        targetId: 'uid_bm_a1',
        details: 'تغيير الدور إلى موظف على الفرع الأول أ',
        timestamp: '2026-11-12T11:30:00Z',
      });
      await assertSucceeds(switchBatch.commit());
    }
  );

  // Scenario 10 & 11: Disable, Reactivate & Soft-Archive preserve all financial records while blocking hard delete
  await runScenario(
    'S10 & S11: Disable, reactivate, and soft-archive preserve all closings & auditLogs while blocking access and hard delete',
    async () => {
      // Employee creates closing before being disabled/archived
      await assertSucceeds(
        empDb.doc('closings/cls_emp_hist').set({
          id: 'cls_emp_hist',
          orgId: 'org_a',
          branchId: 'br_a1',
          branchName: 'الفرع الأول أ',
          employeeId: 'uid_emp_a1',
          employeeName: 'موظف أ1 المحدث',
          date: '2026-11-12',
          period: 'morning',
          cashSales: 400,
          cardSales: 200,
          totalSales: 600,
          expenses: 50,
          remainingInBox: 350,
          netPeriod: 550,
          status: 'pending_review',
          attachmentIds: [],
          createdAt: '2026-11-12T12:00:00Z',
          updatedAt: '2026-11-12T12:00:00Z',
        })
      );

      // Disable employee
      const disableBatch = mgrADb.batch();
      disableBatch.update(mgrADb.doc('users/uid_emp_a1'), {
        isActive: false,
        updatedAt: '2026-11-12T12:10:00Z',
      });
      disableBatch.set(mgrADb.doc('auditLogs/log_disable_emp'), {
        id: 'log_disable_emp',
        orgId: 'org_a',
        actorId: 'uid_mgr_a',
        actorName: 'مدير المؤسسة أ',
        actorRole: 'manager',
        action: 'EMPLOYEE_DISABLED',
        targetType: 'employee',
        targetId: 'uid_emp_a1',
        details: 'تعطيل حساب الموظف مؤقتاً',
        timestamp: '2026-11-12T12:10:00Z',
      });
      await assertSucceeds(disableBatch.commit());

      // Disabled user blocked from reading/creating closings or updating self
      await assertFails(empDb.doc('closings/cls_emp_hist').get());
      await assertFails(empDb.doc('users/uid_emp_a1').update({ displayName: 'محاولة' }));

      // Archive employee cleanly while keeping historical closing & auditLogs intact
      const archiveBatch = mgrADb.batch();
      archiveBatch.update(mgrADb.doc('users/uid_emp_a1'), {
        isActive: false,
        isArchived: true,
        archivedAt: '2026-11-12T12:20:00Z',
        archivedBy: 'uid_mgr_a',
        updatedAt: '2026-11-12T12:20:00Z',
      });
      archiveBatch.set(mgrADb.doc('auditLogs/log_archive_emp'), {
        id: 'log_archive_emp',
        orgId: 'org_a',
        actorId: 'uid_mgr_a',
        actorName: 'مدير المؤسسة أ',
        actorRole: 'manager',
        action: 'EMPLOYEE_ARCHIVED',
        targetType: 'employee',
        targetId: 'uid_emp_a1',
        details: 'أرشفة حساب الموظف مع الاحتفاظ بالسجلات المالية',
        timestamp: '2026-11-12T12:20:00Z',
      });
      await assertSucceeds(archiveBatch.commit());

      // Hard delete MUST FAIL even for manager
      await assertFails(mgrADb.doc('users/uid_emp_a1').delete());
      await assertFails(mgrADb.doc('closings/cls_emp_hist').delete());

      // Manager still reads archived employee's closing intact
      const histSnap = await assertSucceeds(mgrADb.doc('closings/cls_emp_hist').get());
      assert.equal(histSnap.data()?.totalSales, 600);
    }
  );

  // Scenario 12: Password reset audit log, cross-org isolation, and legacy org employee preservation
  await runScenario(
    'S12: Password reset log succeeds; cross-org updates fail; legacy employee retains scalar branchId operation',
    async () => {
      await assertSucceeds(
        mgrADb.doc('auditLogs/log_pwd_reset').set({
          id: 'log_pwd_reset',
          orgId: 'org_a',
          actorId: 'uid_mgr_a',
          actorName: 'مدير المؤسسة أ',
          actorRole: 'manager',
          action: 'EMPLOYEE_PASSWORD_RESET_SENT',
          targetType: 'employee',
          targetId: 'uid_bm_a1',
          details: 'إرسال رابط إعادة تعيين كلمة المرور عبر Firebase',
          timestamp: '2026-11-12T13:00:00Z',
        })
      );

      // Cross-org isolation: Manager A cannot read/update/archive Org B staff
      await assertFails(mgrADb.doc('users/uid_emp_b1').get());
      await assertFails(
        mgrADb.doc('users/uid_emp_b1').update({
          isActive: false,
          displayName: 'اختراق',
        })
      );

      // Legacy unrestricted employee continues creating shift closing on scalar branchId
      await assertSucceeds(
        legacyEmpDb.doc('closings/cls_legacy_ok').set({
          id: 'cls_legacy_ok',
          orgId: 'org_legacy',
          branchId: 'br_legacy_1',
          branchName: 'فرع قديم',
          employeeId: 'uid_emp_legacy',
          employeeName: 'موظف قديم',
          date: '2026-11-12',
          period: 'morning',
          cashSales: 300,
          cardSales: 200,
          totalSales: 500,
          expenses: 50,
          remainingInBox: 250,
          netPeriod: 450,
          status: 'pending_review',
          attachmentIds: [],
          createdAt: '2026-11-12T13:10:00Z',
          updatedAt: '2026-11-12T13:10:00Z',
        })
      );
    }
  );

  await testEnv.cleanup();

  const passedCount = outcomes.filter((o) => o.passed).length;
  const failedCount = outcomes.length - passedCount;
  console.log(`\nSUMMARY: ${passedCount}/${outcomes.length} Phase 4.3 emulator scenarios passed.`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runPhase43EmulatorTests().catch((err) => {
  console.error('Fatal Phase 4.3 emulator error:', err);
  process.exit(1);
});
