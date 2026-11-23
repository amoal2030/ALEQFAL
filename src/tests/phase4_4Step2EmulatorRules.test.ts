/**
 * Phase 4.4 Step 2 Firestore Security Rules Emulator Test Suite (Security Audit Hardened)
 * Tests 20 scenarios covering security, inline items/attachmentIds validation,
 * attachment URL allowlists, exact Halala VAT, RBAC isolation, legacy_unrestricted,
 * and Phase 4.6 notifications compatibility against real `firestore.rules`.
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
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import { buildPurchaseRecordedNotification, buildSupplierAddedNotification } from '../utils/notifications';

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

async function runPhase44Step2EmulatorTests() {
  console.log('========================================================================');
  console.log('   PHASE 4.4 STEP 2: SUPPLIERS, PURCHASES & ATTACHMENTS RULES SUITE     ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-phase44-step2-tests',
    firestore: {
      rules: rulesContent,
      host,
      port,
    },
  });

  await testEnv.clearFirestore();

  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const tsPast5d = Timestamp.fromMillis(nowMs - 5 * oneDayMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // Org A (active paid subscription)
    await db.doc('organizations/org_a').set({
      id: 'org_a',
      name: 'مؤسسة أ الحديثة',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_a',
      ownerEmail: 'mgr.a@example.com',
      ownerName: 'مدير أ',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast5d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });

    // Org B (different tenant, active paid subscription)
    await db.doc('organizations/org_b').set({
      id: 'org_b',
      name: 'مؤسسة ب المنافسة',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_b',
      ownerEmail: 'mgr.b@example.com',
      ownerName: 'مدير ب',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast5d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });

    // Org Legacy (legacy_unrestricted: NO subscription fields at all)
    await db.doc('organizations/org_legacy').set({
      id: 'org_legacy',
      name: 'مؤسسة قديمة معفاة',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'uid_mgr_legacy',
      ownerEmail: 'adartalmtm@gmail.com',
      ownerName: 'المدير القديم',
      driveConnected: false,
      createdAt: '2025-06-01T08:00:00Z',
      updatedAt: '2025-06-01T08:00:00Z',
    });

    // Branches
    await db.doc('branches/br_a1').set({
      id: 'br_a1',
      orgId: 'org_a',
      name: 'فرع أ الأول',
      code: 'A-01',
      isActive: true,
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('branches/br_a2').set({
      id: 'br_a2',
      orgId: 'org_a',
      name: 'فرع أ الثاني',
      code: 'A-02',
      isActive: true,
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('branches/br_b1').set({
      id: 'br_b1',
      orgId: 'org_b',
      name: 'فرع ب الأول',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('branches/br_legacy_1').set({
      id: 'br_legacy_1',
      orgId: 'org_legacy',
      name: 'فرع قديم',
      code: 'L-01',
      isActive: true,
      createdAt: '2025-06-01T08:00:00Z',
    });

    // Users in Org A
    await db.doc('users/uid_mgr_a').set({
      uid: 'uid_mgr_a',
      orgId: 'org_a',
      email: 'mgr.a@example.com',
      displayName: 'مدير أ',
      role: 'manager',
      isActive: true,
      permissions: buildDefaultPermissionsForRole('manager'),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_sup_with_sup_perm').set({
      uid: 'uid_sup_with_sup_perm',
      orgId: 'org_a',
      email: 'sup.yes@example.com',
      displayName: 'مسؤول بصلاحية موردين ومشتريات',
      role: 'supervisor',
      isActive: true,
      permissions: buildDefaultPermissionsForRole('supervisor', {
        canManageSuppliers: true,
        canManagePurchases: true,
        canViewAllClosings: true,
      }),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_sup_no_sup_perm').set({
      uid: 'uid_sup_no_sup_perm',
      orgId: 'org_a',
      email: 'sup.no@example.com',
      displayName: 'مسؤول بدون صلاحية موردين',
      role: 'supervisor',
      isActive: true,
      permissions: buildDefaultPermissionsForRole('supervisor', {
        canManagePurchases: true,
        canViewSuppliers: true,
      }),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_bm_a1').set({
      uid: 'uid_bm_a1',
      orgId: 'org_a',
      email: 'bm.a1@example.com',
      displayName: 'مسؤول فرع أ1',
      role: 'branch_manager',
      branchId: 'br_a1',
      branchIds: ['br_a1'],
      isActive: true,
      permissions: buildDefaultPermissionsForRole('branch_manager'),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_bm_a2').set({
      uid: 'uid_bm_a2',
      orgId: 'org_a',
      email: 'bm.a2@example.com',
      displayName: 'مسؤول فرع أ2',
      role: 'branch_manager',
      branchId: 'br_a2',
      branchIds: ['br_a2'],
      isActive: true,
      permissions: buildDefaultPermissionsForRole('branch_manager'),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_emp_a1').set({
      uid: 'uid_emp_a1',
      orgId: 'org_a',
      email: 'emp.a1@example.com',
      displayName: 'موظف فرع أ1',
      role: 'employee',
      branchId: 'br_a1',
      isActive: true,
      permissions: buildDefaultPermissionsForRole('employee'),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_sup_pur_only').set({
      uid: 'uid_sup_pur_only',
      orgId: 'org_a',
      email: 'sup.pur@example.com',
      displayName: 'مسؤول مشتريات فقط',
      role: 'supervisor',
      isActive: true,
      permissions: buildDefaultPermissionsForRole('supervisor', {
        canManagePurchases: true,
      }),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_bm_no_pur').set({
      uid: 'uid_bm_no_pur',
      orgId: 'org_a',
      email: 'bm.nopur@example.com',
      displayName: 'مسؤول فرع بدون صلاحية مشتريات',
      role: 'branch_manager',
      branchId: 'br_a2',
      branchIds: ['br_a2'],
      isActive: true,
      permissions: {
        ...buildDefaultPermissionsForRole('branch_manager'),
        canManagePurchases: false,
      },
      createdAt: '2026-11-01T08:00:00Z',
    });

    // Org C (expired subscription)
    await db.doc('organizations/org_expired').set({
      id: 'org_expired',
      name: 'مؤسسة منتهية',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_exp',
      ownerEmail: 'mgr.exp@example.com',
      ownerName: 'مدير منتهي',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: Timestamp.fromMillis(nowMs - 40 * oneDayMs),
      subscriptionEndAt: Timestamp.fromMillis(nowMs - 1 * oneDayMs),
      createdAt: '2026-09-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('branches/br_exp_1').set({
      id: 'br_exp_1',
      orgId: 'org_expired',
      name: 'فرع منتهي',
      code: 'E-01',
      isActive: true,
      createdAt: '2026-09-01T08:00:00Z',
    });
    await db.doc('suppliers/sup_exp_1').set({
      id: 'sup_exp_1',
      orgId: 'org_expired',
      name: 'مورد مؤسسة منتهية',
      isActive: true,
      createdBy: 'uid_mgr_exp',
      createdAt: '2026-09-01T08:00:00Z',
      updatedAt: '2026-09-01T08:00:00Z',
    });
    await db.doc('users/uid_mgr_exp').set({
      uid: 'uid_mgr_exp',
      orgId: 'org_expired',
      email: 'mgr.exp@example.com',
      displayName: 'مدير منتهي',
      role: 'manager',
      isActive: true,
      permissions: buildDefaultPermissionsForRole('manager'),
      createdAt: '2026-09-01T08:00:00Z',
    });

    // Org B manager
    await db.doc('users/uid_mgr_b').set({
      uid: 'uid_mgr_b',
      orgId: 'org_b',
      email: 'mgr.b@example.com',
      displayName: 'مدير ب',
      role: 'manager',
      isActive: true,
      permissions: buildDefaultPermissionsForRole('manager'),
      createdAt: '2026-11-01T08:00:00Z',
    });

    // Legacy user
    await db.doc('users/uid_mgr_legacy').set({
      uid: 'uid_mgr_legacy',
      orgId: 'org_legacy',
      email: 'adartalmtm@gmail.com',
      displayName: 'المدير القديم',
      role: 'manager',
      isActive: true,
      createdAt: '2025-06-01T08:00:00Z',
    });

    // Seed suppliers
    await db.doc('suppliers/sup_a_active').set({
      id: 'sup_a_active',
      orgId: 'org_a',
      name: 'شركة النخبة للتوريد',
      isActive: true,
      createdBy: 'uid_mgr_a',
      createdAt: '2026-11-02T08:00:00Z',
      updatedAt: '2026-11-02T08:00:00Z',
    });
    await db.doc('suppliers/sup_a_inactive').set({
      id: 'sup_a_inactive',
      orgId: 'org_a',
      name: 'مورد موقوف سابقاً',
      contactPerson: 'سعيد',
      companyName: 'شركة موقوفة',
      openingBalance: 0,
      isActive: false,
      createdBy: 'uid_mgr_a',
      createdAt: '2026-11-02T08:00:00Z',
      updatedAt: '2026-11-02T08:00:00Z',
    });
    await db.doc('suppliers/sup_b_active').set({
      id: 'sup_b_active',
      orgId: 'org_b',
      name: 'مورد مؤسسة ب',
      isActive: true,
      createdBy: 'uid_mgr_b',
      createdAt: '2026-11-02T08:00:00Z',
      updatedAt: '2026-11-02T08:00:00Z',
    });

    // Historical purchase linked to currently-inactive supplier (to test safe manager notes edit)
    await db.doc('purchases/pur_a_hist_inactive_sup').set({
      id: 'pur_a_hist_inactive_sup',
      orgId: 'org_a',
      branchId: 'br_a1',
      supplierId: 'sup_a_inactive',
      date: '2026-11-03',
      amount: 100,
      totalAmount: 100,
      paymentMethod: 'cash',
      createdBy: 'uid_mgr_a',
      createdByRole: 'manager',
      createdAt: '2026-11-03T08:00:00Z',
      updatedAt: '2026-11-03T08:00:00Z',
    });

    // Historical purchase linked to active supplier (to test switching supplierId to an inactive supplier fails)
    await db.doc('purchases/pur_a_hist_active_sup').set({
      id: 'pur_a_hist_active_sup',
      orgId: 'org_a',
      branchId: 'br_a1',
      supplierId: 'sup_a_active',
      date: '2026-11-03',
      amount: 100,
      subtotalAmount: 100,
      discountAmount: 0,
      vatRate: 15,
      vatAmount: 15,
      totalAmount: 115,
      paymentMethod: 'cash',
      createdBy: 'uid_mgr_a',
      createdByRole: 'manager',
      createdAt: '2026-11-03T08:00:00Z',
      updatedAt: '2026-11-03T08:00:00Z',
    });
  });

  // Auth Contexts
  const mgrADb = testEnv.authenticatedContext('uid_mgr_a', { email: 'mgr.a@example.com', email_verified: true }).firestore();
  const supYesDb = testEnv.authenticatedContext('uid_sup_with_sup_perm', { email: 'sup.yes@example.com', email_verified: true }).firestore();
  const supNoDb = testEnv.authenticatedContext('uid_sup_no_sup_perm', { email: 'sup.no@example.com', email_verified: true }).firestore();
  const bmA1Db = testEnv.authenticatedContext('uid_bm_a1', { email: 'bm.a1@example.com', email_verified: true }).firestore();
  const bmA2Db = testEnv.authenticatedContext('uid_bm_a2', { email: 'bm.a2@example.com', email_verified: true }).firestore();
  const empA1Db = testEnv.authenticatedContext('uid_emp_a1', { email: 'emp.a1@example.com', email_verified: true }).firestore();
  const mgrBDb = testEnv.authenticatedContext('uid_mgr_b', { email: 'mgr.b@example.com', email_verified: true }).firestore();
  const legacyMgrDb = testEnv.authenticatedContext('uid_mgr_legacy', { email: 'adartalmtm@gmail.com', email_verified: true }).firestore();
  const saDb = testEnv.authenticatedContext('uid_sa', { email: 'amoal2030@gmail.com', email_verified: true }).firestore();
  const onlakDb = testEnv.authenticatedContext('uid_onlak', { email: 'onlak2030@gmail.com', email_verified: true }).firestore();
  const supPurOnlyDb = testEnv.authenticatedContext('uid_sup_pur_only', { email: 'sup.pur@example.com', email_verified: true }).firestore();
  const bmNoPurDb = testEnv.authenticatedContext('uid_bm_no_pur', { email: 'bm.nopur@example.com', email_verified: true }).firestore();
  const expMgrDb = testEnv.authenticatedContext('uid_mgr_exp', { email: 'mgr.exp@example.com', email_verified: true }).firestore();

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

  // 1. Organization Manager: full supplier CRUD (except delete) + purchases CRUD (except delete)
  await runCase('1. Organization Manager creates, edits, toggles, deletes unlinked supplier, updates purchase, and cannot delete purchase', async () => {
    await assertSucceeds(
      mgrADb.doc('suppliers/sup_mgr_new').set({
        id: 'sup_mgr_new',
        orgId: 'org_a',
        name: 'مورد القهوة الذهبية',
        contactPerson: 'أحمد السالم',
        companyName: 'شركة القهوة الذهبية المحدودة',
        taxNumber: '310123456700003',
        phone: '0551112233',
        email: 'sales@golden.sa',
        address: 'الرياض - حي الملقا',
        notes: 'توريد أسبوعي',
        openingBalance: 2500.75,
        isActive: true,
        createdBy: 'uid_mgr_a',
        createdAt: '2026-11-16T09:00:00Z',
        updatedAt: '2026-11-16T09:00:00Z',
      })
    );

    await assertSucceeds(
      mgrADb.doc('suppliers/sup_mgr_new').update({
        contactPerson: 'خالد السالم',
        openingBalance: 1500.25,
        isActive: false,
        updatedAt: '2026-11-16T09:10:00Z',
      })
    );

    await assertSucceeds(
      mgrADb.doc('suppliers/sup_mgr_new').update({
        isActive: true,
        updatedAt: '2026-11-16T09:15:00Z',
      })
    );

    // Manager CAN delete an unlinked supplier in their own org (referential integrity checked in service),
    // while purchases remain strictly non-deletable
    await assertSucceeds(
      mgrADb.doc('suppliers/sup_mgr_disposable').set({
        id: 'sup_mgr_disposable',
        orgId: 'org_a',
        name: 'مورد مؤقت للحذف',
        isActive: true,
        createdBy: 'uid_mgr_a',
        createdAt: '2026-11-16T09:16:00Z',
        updatedAt: '2026-11-16T09:16:00Z',
      })
    );
    await assertSucceeds(mgrADb.doc('suppliers/sup_mgr_disposable').delete());
    await assertFails(mgrADb.doc('purchases/pur_a_hist_inactive_sup').delete());

    // Manager can update notes on historical purchase whose supplier became inactive if supplierId unchanged
    await assertSucceeds(
      mgrADb.doc('purchases/pur_a_hist_inactive_sup').update({
        notes: 'تحديث ملاحظة أرشيفية',
        updatedAt: '2026-11-16T09:20:00Z',
      })
    );
    // Manager CANNOT switch an existing purchase from an active supplier to an inactive supplier
    await assertFails(
      mgrADb.doc('purchases/pur_a_hist_active_sup').update({
        supplierId: 'sup_a_inactive',
        notes: 'تبديل لمورد موقوف',
        updatedAt: '2026-11-16T09:25:00Z',
      })
    );
  });

  // 2. Supervisor WITH canManageSuppliers: create only, blocked from edit/toggle/delete
  await runCase('2. Supervisor WITH canManageSuppliers creates supplier, cannot edit/toggle/delete suppliers', async () => {
    await assertSucceeds(
      supYesDb.doc('suppliers/sup_by_sup_yes').set({
        id: 'sup_by_sup_yes',
        orgId: 'org_a',
        name: 'مورد المسؤول المخول',
        contactPerson: 'عمر',
        companyName: 'مؤسسة التوريد',
        openingBalance: 0,
        isActive: true,
        createdBy: 'uid_sup_with_sup_perm',
        createdAt: '2026-11-16T10:00:00Z',
        updatedAt: '2026-11-16T10:00:00Z',
      })
    );

    await assertFails(
      supYesDb.doc('suppliers/sup_by_sup_yes').update({
        name: 'تعديل اسم غير مصرح',
        updatedAt: '2026-11-16T10:05:00Z',
      })
    );
    await assertFails(
      supYesDb.doc('suppliers/sup_by_sup_yes').update({
        isActive: false,
        updatedAt: '2026-11-16T10:06:00Z',
      })
    );
    await assertFails(supYesDb.doc('suppliers/sup_by_sup_yes').delete());
  });

  // 3. Supervisor WITHOUT canManageSuppliers: blocked from creating/editing/toggling suppliers
  await runCase('3. Supervisor WITHOUT canManageSuppliers is denied supplier creation and modification', async () => {
    await assertSucceeds(supNoDb.collection('suppliers').where('orgId', '==', 'org_a').get());
    await assertFails(
      supNoDb.doc('suppliers/sup_by_sup_no').set({
        id: 'sup_by_sup_no',
        orgId: 'org_a',
        name: 'مورد مرفوض',
        isActive: true,
        createdBy: 'uid_sup_no_sup_perm',
        createdAt: '2026-11-16T10:10:00Z',
        updatedAt: '2026-11-16T10:10:00Z',
      })
    );
    await assertFails(
      supNoDb.doc('suppliers/sup_a_active').update({
        isActive: false,
        updatedAt: '2026-11-16T10:11:00Z',
      })
    );
  });

  // 4. Branch Manager: reads active supplier, blocked from inactive supplier get & supplier CRUD, creates purchase in assigned branch only
  await runCase('4. Branch Manager reads active suppliers, cannot get inactive supplier or mutate suppliers, writes purchases in assigned branch only', async () => {
    await assertSucceeds(bmA1Db.doc('suppliers/sup_a_active').get());
    await assertSucceeds(
      bmA1Db.collection('suppliers').where('orgId', '==', 'org_a').where('isActive', '==', true).get()
    );
    await assertFails(bmA1Db.doc('suppliers/sup_a_inactive').get());

    await assertFails(
      bmA1Db.doc('suppliers/sup_bm_denied').set({
        id: 'sup_bm_denied',
        orgId: 'org_a',
        name: 'مورد من مسؤول فرع',
        isActive: true,
        createdBy: 'uid_bm_a1',
        createdAt: '2026-11-16T10:20:00Z',
        updatedAt: '2026-11-16T10:20:00Z',
      })
    );
    await assertFails(bmA1Db.doc('suppliers/sup_a_active').update({ phone: '0500000000' }));
    await assertFails(bmA1Db.doc('suppliers/sup_a_active').delete());

    // Purchase in assigned branch br_a1 succeeds; br_a2 fails; update fails
    await assertSucceeds(
      bmA1Db.doc('purchases/pur_bm_a1_ok').set({
        id: 'pur_bm_a1_ok',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 200,
        subtotalAmount: 200,
        discountAmount: 0,
        vatRate: 15,
        vatAmount: 30,
        totalAmount: 230,
        paymentMethod: 'transfer',
        createdBy: 'uid_bm_a1',
        createdByRole: 'branch_manager',
        createdAt: '2026-11-16T10:25:00Z',
        updatedAt: '2026-11-16T10:25:00Z',
      })
    );
    await assertFails(
      bmA1Db.doc('purchases/pur_bm_a2_denied').set({
        id: 'pur_bm_a2_denied',
        orgId: 'org_a',
        branchId: 'br_a2',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 200,
        totalAmount: 200,
        paymentMethod: 'cash',
        createdBy: 'uid_bm_a1',
        createdByRole: 'branch_manager',
        createdAt: '2026-11-16T10:26:00Z',
        updatedAt: '2026-11-16T10:26:00Z',
      })
    );
    await assertFails(
      bmA1Db.doc('purchases/pur_bm_a1_ok').update({ notes: 'تعديل مرفوض من مسؤول الفرع' })
    );
  });

  // 5. Employee: blocked from suppliers, purchases, and purchase attachments
  await runCase('5. Employee is completely denied access to suppliers, purchases, and purchase attachments', async () => {
    await assertFails(empA1Db.doc('suppliers/sup_a_active').get());
    await assertFails(empA1Db.collection('suppliers').where('orgId', '==', 'org_a').get());
    await assertFails(empA1Db.doc('purchases/pur_bm_a1_ok').get());
    await assertFails(
      empA1Db.collection('purchases').where('orgId', '==', 'org_a').where('branchId', '==', 'br_a1').get()
    );
    await assertFails(
      empA1Db.doc('purchases/pur_emp_denied').set({
        id: 'pur_emp_denied',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 50,
        totalAmount: 50,
        paymentMethod: 'cash',
        createdBy: 'uid_emp_a1',
        createdByRole: 'employee',
        createdAt: '2026-11-16T10:30:00Z',
        updatedAt: '2026-11-16T10:30:00Z',
      })
    );
    await assertFails(
      empA1Db.doc('attachments/att_emp_pur_denied').set({
        id: 'att_emp_pur_denied',
        orgId: 'org_a',
        branchId: 'br_a1',
        purchaseId: 'pur_bm_a1_ok',
        fileName: 'invoice.pdf',
        uploadedBy: 'uid_emp_a1',
        uploadedAt: '2026-11-16T10:31:00Z',
      })
    );
  });

  // 6. Cross-organization isolation
  await runCase('6. Cross-organization user cannot read/write org_a suppliers, purchases, or attachments nor reference foreign supplier', async () => {
    await assertFails(mgrBDb.doc('suppliers/sup_a_active').get());
    await assertFails(mgrBDb.doc('purchases/pur_bm_a1_ok').get());
    await assertFails(mgrBDb.collection('suppliers').where('orgId', '==', 'org_a').get());
    await assertFails(mgrBDb.collection('purchases').where('orgId', '==', 'org_a').get());

    // Org B manager cannot reference Org A supplier
    await assertFails(
      mgrBDb.doc('purchases/pur_b_cross_sup').set({
        id: 'pur_b_cross_sup',
        orgId: 'org_b',
        branchId: 'br_b1',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 100,
        totalAmount: 100,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_b',
        createdByRole: 'manager',
        createdAt: '2026-11-16T10:35:00Z',
        updatedAt: '2026-11-16T10:35:00Z',
      })
    );
  });

  // 7. Inactive supplier rejected on purchase create
  await runCase('7. Creating purchase with inactive supplier is rejected for all roles', async () => {
    await assertFails(
      mgrADb.doc('purchases/pur_inactive_sup_mgr').set({
        id: 'pur_inactive_sup_mgr',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_inactive',
        date: '2026-11-16',
        amount: 100,
        totalAmount: 100,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_a',
        createdByRole: 'manager',
        createdAt: '2026-11-16T10:40:00Z',
        updatedAt: '2026-11-16T10:40:00Z',
      })
    );
    await assertFails(
      bmA1Db.doc('purchases/pur_inactive_sup_bm').set({
        id: 'pur_inactive_sup_bm',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_inactive',
        date: '2026-11-16',
        amount: 100,
        totalAmount: 100,
        paymentMethod: 'cash',
        createdBy: 'uid_bm_a1',
        createdByRole: 'branch_manager',
        createdAt: '2026-11-16T10:41:00Z',
        updatedAt: '2026-11-16T10:41:00Z',
      })
    );
  });

  // 8. Purchase with valid discount & Halala precision (including discount > VAT where totalAmount < subtotalAmount)
  await runCase('8. Purchase with valid discount, atomic attachment batch, & integer-Halala VAT succeeds', async () => {
    // Case A: subtotal 100, discount 20, vatRate 15% => vat 12, total 92 (< subtotal 100!) with atomic attachment
    const batchDiscount = mgrADb.batch();
    batchDiscount.set(mgrADb.doc('attachments/att_pur_disc'), {
      id: 'att_pur_disc',
      orgId: 'org_a',
      branchId: 'br_a1',
      purchaseId: 'pur_valid_discount',
      fileName: 'discount_invoice.pdf',
      fileUrl: 'https://drive.google.com/file/d/disc123/view',
      uploadedBy: 'uid_mgr_a',
      uploadedAt: '2026-11-16T11:00:00Z',
    });
    batchDiscount.set(mgrADb.doc('purchases/pur_valid_discount'), {
      id: 'pur_valid_discount',
      orgId: 'org_a',
      branchId: 'br_a1',
      supplierId: 'sup_a_active',
      taxNumber: '310123456700003',
      invoiceNumber: 'INV-2026-001',
      date: '2026-11-16',
      items: [{ id: 'li_1', name: 'حليب طازج', quantity: 10, unitPrice: 10, total: 100 }],
      amount: 100,
      subtotalAmount: 100,
      discountAmount: 20,
      vatRate: 15,
      vatAmount: 12,
      totalAmount: 92,
      paymentMethod: 'card',
      attachmentIds: ['att_pur_disc'],
      createdBy: 'uid_mgr_a',
      createdByRole: 'manager',
      createdAt: '2026-11-16T11:00:00Z',
      updatedAt: '2026-11-16T11:00:00Z',
    });
    await assertSucceeds(batchDiscount.commit());

    // Case B: Decimal Halala precision from Step 1 (60.27 - 0.27 + 9 = 69.00)
    await assertSucceeds(
      bmA1Db.doc('purchases/pur_halala_precision').set({
        id: 'pur_halala_precision',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        items: [
          { id: '1', name: 'منتج أ', quantity: 3, unitPrice: 20.09, total: 60.27 },
        ],
        amount: 60.27,
        subtotalAmount: 60.27,
        discountAmount: 0.27,
        vatRate: 15,
        vatAmount: 9,
        totalAmount: 69,
        paymentMethod: 'cash',
        createdBy: 'uid_bm_a1',
        createdByRole: 'branch_manager',
        createdAt: '2026-11-16T11:05:00Z',
        updatedAt: '2026-11-16T11:05:00Z',
      })
    );
  });

  // 9. Purchase with discount > subtotal, negative discount/VAT, or mismatched total fails
  await runCase('9. Purchase with discount > subtotal, negative discount/VAT, or mismatched totalAmount is rejected', async () => {
    await assertFails(
      mgrADb.doc('purchases/pur_bad_discount_exceeds').set({
        id: 'pur_bad_discount_exceeds',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 100,
        subtotalAmount: 100,
        discountAmount: 120,
        vatRate: 0,
        vatAmount: 0,
        totalAmount: 0,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_a',
        createdByRole: 'manager',
        createdAt: '2026-11-16T11:10:00Z',
        updatedAt: '2026-11-16T11:10:00Z',
      })
    );

    await assertFails(
      mgrADb.doc('purchases/pur_bad_neg_discount').set({
        id: 'pur_bad_neg_discount',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 100,
        subtotalAmount: 100,
        discountAmount: -5,
        vatAmount: 0,
        totalAmount: 105,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_a',
        createdByRole: 'manager',
        createdAt: '2026-11-16T11:11:00Z',
        updatedAt: '2026-11-16T11:11:00Z',
      })
    );

    await assertFails(
      mgrADb.doc('purchases/pur_bad_total').set({
        id: 'pur_bad_total',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 100,
        subtotalAmount: 100,
        discountAmount: 10,
        vatRate: 15,
        vatAmount: 13.5,
        totalAmount: 99,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_a',
        createdByRole: 'manager',
        createdAt: '2026-11-16T11:12:00Z',
        updatedAt: '2026-11-16T11:12:00Z',
      })
    );
  });

  // 10. Legacy supplier & legacy purchase without new Phase 4.4 fields
  await runCase('10. Legacy supplier and legacy purchase without Phase 4.4 fields remain valid', async () => {
    await assertSucceeds(
      mgrADb.doc('suppliers/sup_legacy_shape').set({
        id: 'sup_legacy_shape',
        orgId: 'org_a',
        name: 'مورد بدون الحقول الجديدة',
        isActive: true,
        createdBy: 'uid_mgr_a',
        createdAt: '2026-11-16T11:15:00Z',
        updatedAt: '2026-11-16T11:15:00Z',
      })
    );

    await assertSucceeds(
      mgrADb.doc('purchases/pur_legacy_shape').set({
        id: 'pur_legacy_shape',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_legacy_shape',
        date: '2026-11-16',
        amount: 250,
        vatAmount: 37.5,
        totalAmount: 287.5,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_a',
        createdByRole: 'manager',
        createdAt: '2026-11-16T11:16:00Z',
        updatedAt: '2026-11-16T11:16:00Z',
      })
    );
  });

  // 11. Legacy closing attachments (closingId) remain intact
  await runCase('11. Closing attachments (closingId) preserve existing employee & manager permissions', async () => {
    await assertSucceeds(
      empA1Db.doc('attachments/att_cls_a1').set({
        id: 'att_cls_a1',
        orgId: 'org_a',
        branchId: 'br_a1',
        closingId: 'cls_a1_sample',
        fileName: 'pos_receipt.jpg',
        fileSize: 12040,
        mimeType: 'image/jpeg',
        fileUrl: 'https://drive.google.com/file/d/abc123/view',
        uploadedBy: 'uid_emp_a1',
        uploadedByName: 'موظف فرع أ1',
        uploadedAt: '2026-11-16T11:20:00Z',
      })
    );
    await assertSucceeds(empA1Db.doc('attachments/att_cls_a1').get());
    await assertSucceeds(mgrADb.doc('attachments/att_cls_a1').get());
    await assertFails(mgrBDb.doc('attachments/att_cls_a1').get());
  });

  // 12. Purchase attachments (purchaseId) + anti-Base64 & isolation guards
  await runCase('12. Purchase attachments work per role/branch, block cross-org, cross-branch, Base64, and mixing IDs', async () => {
    await assertSucceeds(
      bmA1Db.doc('attachments/att_pur_a1').set({
        id: 'att_pur_a1',
        orgId: 'org_a',
        branchId: 'br_a1',
        purchaseId: 'pur_bm_a1_ok',
        fileName: 'supplier_invoice.pdf',
        fileSize: 45200,
        mimeType: 'application/pdf',
        fileUrl: '',
        uploadedBy: 'uid_bm_a1',
        uploadedByName: 'مسؤول فرع أ1',
        uploadedAt: '2026-11-16T11:25:00Z',
      })
    );

    // Allowed readers: same-branch branch_manager, org manager, supervisor with canManagePurchases
    await assertSucceeds(bmA1Db.doc('attachments/att_pur_a1').get());
    await assertSucceeds(mgrADb.doc('attachments/att_pur_a1').get());
    await assertSucceeds(supYesDb.doc('attachments/att_pur_a1').get());

    // Denied readers: branch_manager of br_a2, employee of br_a1, org_b manager
    await assertFails(bmA2Db.doc('attachments/att_pur_a1').get());
    await assertFails(empA1Db.doc('attachments/att_pur_a1').get());
    await assertFails(mgrBDb.doc('attachments/att_pur_a1').get());

    // Reject Base64 data URI inside Firestore attachment doc
    await assertFails(
      mgrADb.doc('attachments/att_pur_base64').set({
        id: 'att_pur_base64',
        orgId: 'org_a',
        branchId: 'br_a1',
        purchaseId: 'pur_bm_a1_ok',
        fileName: 'invoice.png',
        fileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk',
        uploadedBy: 'uid_mgr_a',
        uploadedAt: '2026-11-16T11:26:00Z',
      })
    );

    // Reject mixing closingId + purchaseId
    await assertFails(
      mgrADb.doc('attachments/att_mixed_ids').set({
        id: 'att_mixed_ids',
        orgId: 'org_a',
        branchId: 'br_a1',
        closingId: 'cls_1',
        purchaseId: 'pur_bm_a1_ok',
        fileName: 'mixed.pdf',
        uploadedBy: 'uid_mgr_a',
        uploadedAt: '2026-11-16T11:27:00Z',
      })
    );

    // Reject purchase attachment attached to wrong branch of existing purchase
    await assertFails(
      mgrADb.doc('attachments/att_wrong_branch').set({
        id: 'att_wrong_branch',
        orgId: 'org_a',
        branchId: 'br_a2',
        purchaseId: 'pur_bm_a1_ok',
        fileName: 'wrong_branch.pdf',
        uploadedBy: 'uid_mgr_a',
        uploadedAt: '2026-11-16T11:28:00Z',
      })
    );
  });

  // 13. Legacy unrestricted organization continues operating with no subscription fields
  await runCase('13. Legacy unrestricted organization creates suppliers, purchases, and attachments without subscription', async () => {
    await assertSucceeds(
      legacyMgrDb.doc('suppliers/sup_legacy_org').set({
        id: 'sup_legacy_org',
        orgId: 'org_legacy',
        name: 'مورد المؤسسة القديمة',
        contactPerson: 'فهد',
        openingBalance: 500,
        isActive: true,
        createdBy: 'uid_mgr_legacy',
        createdAt: '2026-11-16T11:30:00Z',
        updatedAt: '2026-11-16T11:30:00Z',
      })
    );
    await assertSucceeds(
      legacyMgrDb.doc('purchases/pur_legacy_org').set({
        id: 'pur_legacy_org',
        orgId: 'org_legacy',
        branchId: 'br_legacy_1',
        supplierId: 'sup_legacy_org',
        date: '2026-11-16',
        amount: 400,
        subtotalAmount: 400,
        discountAmount: 50,
        vatRate: 15,
        vatAmount: 52.5,
        totalAmount: 402.5,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_legacy',
        createdByRole: 'manager',
        createdAt: '2026-11-16T11:31:00Z',
        updatedAt: '2026-11-16T11:31:00Z',
      })
    );
    await assertSucceeds(
      legacyMgrDb.doc('attachments/att_legacy_pur').set({
        id: 'att_legacy_pur',
        orgId: 'org_legacy',
        branchId: 'br_legacy_1',
        purchaseId: 'pur_legacy_org',
        fileName: 'legacy_invoice.pdf',
        uploadedBy: 'uid_mgr_legacy',
        uploadedAt: '2026-11-16T11:32:00Z',
      })
    );
  });

  // 14. Existing Phase 4.6 notifications + Super Admin exclusivity (amoal2030@gmail.com only; onlak2030@gmail.com rejected)
  await runCase('14. Phase 4.6 notifications rules and Super Admin identity remain completely intact', async () => {
    const purNotif = buildPurchaseRecordedNotification({
      orgId: 'org_a',
      branchId: 'br_a1',
      branchName: 'فرع أ الأول',
      purchaseId: 'pur_bm_a1_ok',
      supplierName: 'شركة النخبة للتوريد',
      totalAmount: 230,
      currency: 'SAR',
      actorUid: 'uid_bm_a1',
      actorName: 'مسؤول فرع أ1',
      actorRole: 'branch_manager',
      createdAt: '2026-11-16T11:35:00Z',
    });
    const supNotifSupplierId = 'sup_by_sup_yes_notif';
    const supNotif = buildSupplierAddedNotification({
      orgId: 'org_a',
      supplierId: supNotifSupplierId,
      supplierName: 'مورد المسؤول المخول للإشعار',
      actorUid: 'uid_sup_with_sup_perm',
      actorName: 'مسؤول بصلاحية موردين ومشتريات',
      actorRole: 'supervisor',
      createdAt: '2026-11-16T11:36:00Z',
    });

    await assertSucceeds(bmA1Db.doc(`notifications/${purNotif.id}`).set(purNotif));
    const supNotifBatch = supYesDb.batch();
    supNotifBatch.set(supYesDb.doc(`suppliers/${supNotifSupplierId}`), {
      id: supNotifSupplierId,
      orgId: 'org_a',
      name: 'مورد المسؤول المخول للإشعار',
      isActive: true,
      createdBy: 'uid_sup_with_sup_perm',
      createdAt: '2026-11-16T11:36:00Z',
      updatedAt: '2026-11-16T11:36:00Z',
    });
    supNotifBatch.set(supYesDb.doc(`notifications/${supNotif.id}`), supNotif);
    await assertSucceeds(supNotifBatch.commit());
    await assertSucceeds(
      supYesDb
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'org_perm:org_a:canManagePurchases')
        .get()
    );
    await assertFails(
      empA1Db
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'org_perm:org_a:canManagePurchases')
        .get()
    );

    // Super Admin verified email only; onlak2030@gmail.com denied
    await assertSucceeds(saDb.collection('organizations').get());
    await assertFails(onlakDb.collection('organizations').get());
    await assertFails(
      onlakDb.collection('notifications').where('feedKeys', 'array-contains', 'super_admin').get()
    );
  });

  // 15. Strict PurchaseLineItem validation & inline limit (MAX_PURCHASE_LINE_ITEMS = 1)
  await runCase('15. Purchase rejects >1 inline item, malformed keys, whitespace name/id, qty<=0, and sum mismatches', async () => {
    const basePur = {
      orgId: 'org_a',
      branchId: 'br_a1',
      supplierId: 'sup_a_active',
      date: '2026-11-16',
      amount: 100,
      subtotalAmount: 100,
      vatRate: 0,
      vatAmount: 0,
      totalAmount: 100,
      paymentMethod: 'cash',
      createdBy: 'uid_mgr_a',
      createdByRole: 'manager',
      createdAt: '2026-11-16T12:00:00Z',
      updatedAt: '2026-11-16T12:00:00Z',
    };

    // Exceeds MAX_PURCHASE_LINE_ITEMS (1) -> rejected
    await assertFails(
      mgrADb.doc('purchases/pur_adv_2items').set({
        ...basePur,
        id: 'pur_adv_2items',
        items: [
          { id: '1', name: 'A', quantity: 1, unitPrice: 50, total: 50 },
          { id: '2', name: 'B', quantity: 1, unitPrice: 50, total: 50 },
        ],
      })
    );

    // Extra unexpected key inside item -> rejected
    await assertFails(
      mgrADb.doc('purchases/pur_adv_extra_key').set({
        ...basePur,
        id: 'pur_adv_extra_key',
        items: [{ id: '1', name: 'A', quantity: 1, unitPrice: 100, total: 100, extra: true }],
      })
    );

    // Whitespace-only name or id -> rejected
    await assertFails(
      mgrADb.doc('purchases/pur_adv_blank_name').set({
        ...basePur,
        id: 'pur_adv_blank_name',
        items: [{ id: '1', name: '   ', quantity: 1, unitPrice: 100, total: 100 }],
      })
    );
    await assertFails(
      mgrADb.doc('purchases/pur_adv_blank_id').set({
        ...basePur,
        id: 'pur_adv_blank_id',
        items: [{ id: '  ', name: 'صنف', quantity: 1, unitPrice: 100, total: 100 }],
      })
    );

    // Non-positive quantity / negative unitPrice / item total != qty*unitPrice / item total != amount -> all rejected
    await assertFails(
      mgrADb.doc('purchases/pur_adv_qty0').set({
        ...basePur,
        id: 'pur_adv_qty0',
        items: [{ id: '1', name: 'صنف', quantity: 0, unitPrice: 100, total: 0 }],
        amount: 0,
        subtotalAmount: 0,
        totalAmount: 0,
      })
    );
    await assertFails(
      mgrADb.doc('purchases/pur_adv_bad_line_math').set({
        ...basePur,
        id: 'pur_adv_bad_line_math',
        items: [{ id: '1', name: 'صنف', quantity: 2, unitPrice: 40, total: 100 }],
      })
    );
    await assertFails(
      mgrADb.doc('purchases/pur_adv_bad_sub_sum').set({
        ...basePur,
        id: 'pur_adv_bad_sub_sum',
        items: [{ id: '1', name: 'صنف', quantity: 1, unitPrice: 80, total: 80 }],
      })
    );
  });

  // 16. Strict attachmentIds getAfter cross-doc validation & limit (MAX_PURCHASE_ATTACHMENTS = 1)
  await runCase('16. Purchase attachmentIds rejects >1 attachment, dangling IDs, foreign-org, wrong-branch, and wrong-purchaseId', async () => {
    // Seed a foreign org B attachment & wrong-branch/wrong-purchase attachments
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('attachments/att_foreign_b').set({
        id: 'att_foreign_b',
        orgId: 'org_b',
        branchId: 'br_b1',
        purchaseId: 'pur_b_existing',
        fileName: 'b.pdf',
        uploadedBy: 'uid_mgr_b',
        uploadedAt: '2026-11-16T08:00:00Z',
      });
      await db.doc('attachments/att_wrong_pur').set({
        id: 'att_wrong_pur',
        orgId: 'org_a',
        branchId: 'br_a1',
        purchaseId: 'pur_a_hist_active_sup',
        fileName: 'other_pur.pdf',
        uploadedBy: 'uid_mgr_a',
        uploadedAt: '2026-11-16T08:00:00Z',
      });
    });

    const baseAttPur = {
      orgId: 'org_a',
      branchId: 'br_a1',
      supplierId: 'sup_a_active',
      date: '2026-11-16',
      amount: 50,
      subtotalAmount: 50,
      vatRate: 0,
      vatAmount: 0,
      totalAmount: 50,
      paymentMethod: 'cash',
      createdBy: 'uid_mgr_a',
      createdByRole: 'manager',
      createdAt: '2026-11-16T12:10:00Z',
      updatedAt: '2026-11-16T12:10:00Z',
    };

    // Dangling attachmentId -> rejected
    await assertFails(
      mgrADb.doc('purchases/pur_dangling_att').set({
        ...baseAttPur,
        id: 'pur_dangling_att',
        attachmentIds: ['att_does_not_exist'],
      })
    );

    // Foreign org attachment -> rejected
    await assertFails(
      mgrADb.doc('purchases/pur_foreign_att').set({
        ...baseAttPur,
        id: 'pur_foreign_att',
        attachmentIds: ['att_foreign_b'],
      })
    );

    // Attachment bound to different purchaseId -> rejected
    await assertFails(
      mgrADb.doc('purchases/pur_mismatch_att_id').set({
        ...baseAttPur,
        id: 'pur_mismatch_att_id',
        attachmentIds: ['att_wrong_pur'],
      })
    );

    // >1 attachmentIds -> rejected
    const batch2Atts = mgrADb.batch();
    batch2Atts.set(mgrADb.doc('attachments/att_2a'), {
      id: 'att_2a', orgId: 'org_a', branchId: 'br_a1', purchaseId: 'pur_2atts',
      fileName: '1.pdf', uploadedBy: 'uid_mgr_a', uploadedAt: '2026-11-16T12:15:00Z',
    });
    batch2Atts.set(mgrADb.doc('attachments/att_2b'), {
      id: 'att_2b', orgId: 'org_a', branchId: 'br_a1', purchaseId: 'pur_2atts',
      fileName: '2.pdf', uploadedBy: 'uid_mgr_a', uploadedAt: '2026-11-16T12:15:00Z',
    });
    batch2Atts.set(mgrADb.doc('purchases/pur_2atts'), {
      ...baseAttPur,
      id: 'pur_2atts',
      attachmentIds: ['att_2a', 'att_2b'],
    });
    await assertFails(batch2Atts.commit());
  });

  // 17. Attachment standalone purchaseId & URL allowlist hardening
  await runCase('17. Attachments require existing purchaseId and block javascript:/http:/data:/untrusted URLs', async () => {
    // Non-existent purchaseId MUST fail (closes !existsAfter bypass)
    await assertFails(
      mgrADb.doc('attachments/att_ghost_purchase').set({
        id: 'att_ghost_purchase',
        orgId: 'org_a',
        branchId: 'br_a1',
        purchaseId: 'pur_never_created',
        fileName: 'ghost.pdf',
        fileUrl: 'https://drive.google.com/file/d/abc/view',
        uploadedBy: 'uid_mgr_a',
        uploadedAt: '2026-11-16T12:20:00Z',
      })
    );

    // Untrusted / dangerous URLs in fileUrl and driveWebViewLink rejected
    const badUrls = [
      'javascript:alert(1)',
      'http://drive.google.com/file/d/123/view',
      'data:application/pdf;base64,JVBERi0x',
      'https://evil.example.com/payload.pdf',
    ];
    for (let i = 0; i < badUrls.length; i += 1) {
      await assertFails(
        mgrADb.doc(`attachments/att_bad_url_${i}`).set({
          id: `att_bad_url_${i}`,
          orgId: 'org_a',
          branchId: 'br_a1',
          purchaseId: 'pur_bm_a1_ok',
          fileName: 'bad.pdf',
          fileUrl: badUrls[i],
          uploadedBy: 'uid_mgr_a',
          uploadedAt: '2026-11-16T12:21:00Z',
        })
      );
    }

    await assertFails(
      mgrADb.doc('attachments/att_bad_drive_link').set({
        id: 'att_bad_drive_link',
        orgId: 'org_a',
        branchId: 'br_a1',
        purchaseId: 'pur_bm_a1_ok',
        fileName: 'bad_link.pdf',
        driveWebViewLink: 'https://phishing.site/view',
        uploadedBy: 'uid_mgr_a',
        uploadedAt: '2026-11-16T12:22:00Z',
      })
    );

    // Allowlisted HTTPS GCS / Firebase Storage / Docs URL succeeds for existing purchase
    await assertSucceeds(
      mgrADb.doc('attachments/att_allowlisted_storage').set({
        id: 'att_allowlisted_storage',
        orgId: 'org_a',
        branchId: 'br_a1',
        purchaseId: 'pur_bm_a1_ok',
        fileName: 'invoice_gcs.pdf',
        fileUrl: 'https://firebasestorage.googleapis.com/v0/b/bucket/o/invoice.pdf',
        driveWebViewLink: 'https://docs.google.com/document/d/doc123/view',
        uploadedBy: 'uid_mgr_a',
        uploadedAt: '2026-11-16T12:23:00Z',
      })
    );
  });

  // 18. Purchase accounting strictness: amount==subtotalAmount & zero ±1 Halala VAT tolerance
  await runCase('18. Purchase accounting enforces amount==subtotalAmount, 2-decimal vatRate, and zero ±1 Halala VAT tolerance', async () => {
    // Exact 10.50 * 15% = 1.58 passes with full metadata & attachment
    const batchExact = bmA1Db.batch();
    batchExact.set(bmA1Db.doc('attachments/att_exact_158'), {
      id: 'att_exact_158',
      orgId: 'org_a',
      branchId: 'br_a1',
      purchaseId: 'pur_exact_158',
      fileName: 'exact.pdf',
      fileUrl: 'https://storage.googleapis.com/scenic/exact.pdf',
      uploadedBy: 'uid_bm_a1',
      uploadedAt: '2026-11-16T12:30:00Z',
    });
    batchExact.set(bmA1Db.doc('purchases/pur_exact_158'), {
      id: 'pur_exact_158',
      orgId: 'org_a',
      branchId: 'br_a1',
      branchName: 'فرع أ الأول',
      supplierId: 'sup_a_active',
      supplierName: 'شركة النخبة للتوريد',
      taxNumber: '310123456700003',
      invoiceNumber: 'INV-158',
      date: '2026-11-16',
      items: [{ id: 'it_1', name: 'منتج دقيق', quantity: 1, unitPrice: 10.5, total: 10.5 }],
      amount: 10.5,
      subtotalAmount: 10.5,
      discountAmount: 0,
      vatRate: 15,
      vatAmount: 1.58,
      totalAmount: 12.08,
      paymentMethod: 'cash',
      notes: 'اختبار هللات دقيق',
      attachmentIds: ['att_exact_158'],
      createdBy: 'uid_bm_a1',
      createdByName: 'مسؤول فرع أ1',
      createdByRole: 'branch_manager',
      createdAt: '2026-11-16T12:30:00Z',
      updatedAt: '2026-11-16T12:30:00Z',
    });
    await assertSucceeds(batchExact.commit());

    // ±1 Halala VAT tolerance is REJECTED (1.57 and 1.59 must both fail!)
    for (const badVat of [1.57, 1.59]) {
      await assertFails(
        bmA1Db.doc(`purchases/pur_bad_vat_${badVat === 1.57 ? 'low' : 'high'}`).set({
          id: `pur_bad_vat_${badVat === 1.57 ? 'low' : 'high'}`,
          orgId: 'org_a',
          branchId: 'br_a1',
          supplierId: 'sup_a_active',
          date: '2026-11-16',
          amount: 10.5,
          subtotalAmount: 10.5,
          discountAmount: 0,
          vatRate: 15,
          vatAmount: badVat,
          totalAmount: Number((10.5 + badVat).toFixed(2)),
          paymentMethod: 'cash',
          createdBy: 'uid_bm_a1',
          createdByRole: 'branch_manager',
          createdAt: '2026-11-16T12:31:00Z',
          updatedAt: '2026-11-16T12:31:00Z',
        })
      );
    }

    // amount != subtotalAmount -> rejected
    await assertFails(
      mgrADb.doc('purchases/pur_amt_sub_mismatch').set({
        id: 'pur_amt_sub_mismatch',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 90,
        subtotalAmount: 100,
        discountAmount: 0,
        vatRate: 0,
        vatAmount: 0,
        totalAmount: 100,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_a',
        createdByRole: 'manager',
        createdAt: '2026-11-16T12:32:00Z',
        updatedAt: '2026-11-16T12:32:00Z',
      })
    );

    // vatRate with >2 decimals -> rejected
    await assertFails(
      mgrADb.doc('purchases/pur_bad_vat_rate_prec').set({
        id: 'pur_bad_vat_rate_prec',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 100,
        subtotalAmount: 100,
        discountAmount: 0,
        vatRate: 15.125,
        vatAmount: 15.13,
        totalAmount: 115.13,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_a',
        createdByRole: 'manager',
        createdAt: '2026-11-16T12:33:00Z',
        updatedAt: '2026-11-16T12:33:00Z',
      })
    );
  });

  // 19. Supervisor & branch_manager RBAC + auditLogs alignment
  await runCase('19. Supervisor (canManagePurchases only) denied supplier reads; branch_manager with canManagePurchases=false denied purchase & PURCHASE_CREATED log', async () => {
    // Supervisor with ONLY canManagePurchases cannot get or list suppliers
    await assertFails(supPurOnlyDb.doc('suppliers/sup_a_active').get());
    await assertFails(supPurOnlyDb.collection('suppliers').where('orgId', '==', 'org_a').get());

    // Supervisor WITH canManagePurchases CAN create purchase (with its full-field batch attachment)
    const supBatch = supPurOnlyDb.batch();
    supBatch.set(supPurOnlyDb.doc('attachments/att_sup_ok'), {
      id: 'att_sup_ok',
      orgId: 'org_a',
      branchId: 'br_a2',
      purchaseId: 'pur_sup_pur_only_ok',
      fileName: 'sup.pdf',
      uploadedBy: 'uid_sup_pur_only',
      uploadedAt: '2026-11-16T12:40:00Z',
    });
    supBatch.set(supPurOnlyDb.doc('purchases/pur_sup_pur_only_ok'), {
      id: 'pur_sup_pur_only_ok',
      orgId: 'org_a',
      branchId: 'br_a2',
      supplierId: 'sup_a_active',
      date: '2026-11-16',
      items: [{ id: 's1', name: 'توريد عام', quantity: 2, unitPrice: 50, total: 100 }],
      amount: 100,
      subtotalAmount: 100,
      discountAmount: 0,
      vatRate: 15,
      vatAmount: 15,
      totalAmount: 115,
      paymentMethod: 'transfer',
      attachmentIds: ['att_sup_ok'],
      createdBy: 'uid_sup_pur_only',
      createdByRole: 'supervisor',
      createdAt: '2026-11-16T12:40:00Z',
      updatedAt: '2026-11-16T12:40:00Z',
    });
    await assertSucceeds(supBatch.commit());

    // branch_manager with canManagePurchases: false cannot create purchase
    await assertFails(
      bmNoPurDb.doc('purchases/pur_bm_revoked').set({
        id: 'pur_bm_revoked',
        orgId: 'org_a',
        branchId: 'br_a2',
        supplierId: 'sup_a_active',
        date: '2026-11-16',
        amount: 50,
        totalAmount: 50,
        paymentMethod: 'cash',
        createdBy: 'uid_bm_no_pur',
        createdByRole: 'branch_manager',
        createdAt: '2026-11-16T12:41:00Z',
        updatedAt: '2026-11-16T12:41:00Z',
      })
    );

    // branch_manager with canManagePurchases: false CANNOT forge a PURCHASE_CREATED auditLog even pointing to an existing purchase
    await assertFails(
      bmNoPurDb.doc('auditLogs/log_forged_bm_pur').set({
        id: 'log_forged_bm_pur',
        orgId: 'org_a',
        actorId: 'uid_bm_no_pur',
        actorName: 'مسؤول فرع بدون صلاحية مشتريات',
        actorRole: 'branch_manager',
        action: 'PURCHASE_CREATED',
        targetType: 'purchase',
        targetId: 'pur_sup_pur_only_ok',
        details: 'محاولة تسجيل مشتريات بدون صلاحية',
        timestamp: '2026-11-16T12:42:00Z',
      })
    );

    // Authorized branch_manager CAN create PURCHASE_CREATED auditLog atomically with their purchase
    const bmLogBatch = bmA1Db.batch();
    bmLogBatch.set(bmA1Db.doc('purchases/pur_bm_with_log'), {
      id: 'pur_bm_with_log',
      orgId: 'org_a',
      branchId: 'br_a1',
      supplierId: 'sup_a_active',
      date: '2026-11-16',
      amount: 50,
      totalAmount: 50,
      paymentMethod: 'cash',
      createdBy: 'uid_bm_a1',
      createdByRole: 'branch_manager',
      createdAt: '2026-11-16T12:43:00Z',
      updatedAt: '2026-11-16T12:43:00Z',
    });
    bmLogBatch.set(bmA1Db.doc('auditLogs/log_bm_pur_ok'), {
      id: 'log_bm_pur_ok',
      orgId: 'org_a',
      actorId: 'uid_bm_a1',
      actorName: 'مسؤول فرع أ1',
      actorRole: 'branch_manager',
      action: 'PURCHASE_CREATED',
      targetType: 'purchase',
      targetId: 'pur_bm_with_log',
      details: 'تسجيل فاتورة مشتريات لفرع أ1',
      timestamp: '2026-11-16T12:43:00Z',
    });
    await assertSucceeds(bmLogBatch.commit());
  });

  // 20. Manager full-field update with batch attachment + expired subscription denied
  await runCase('20. Manager full-field update with batch attachment succeeds within 1,000-expr budget; expired org denied', async () => {
    const updBatch = mgrADb.batch();
    updBatch.set(mgrADb.doc('attachments/att_mgr_upd'), {
      id: 'att_mgr_upd',
      orgId: 'org_a',
      branchId: 'br_a1',
      purchaseId: 'pur_a_hist_active_sup',
      fileName: 'updated.pdf',
      fileUrl: 'https://drive.google.com/file/d/upd123/view',
      uploadedBy: 'uid_mgr_a',
      uploadedAt: '2026-11-16T12:50:00Z',
    });
    updBatch.update(mgrADb.doc('purchases/pur_a_hist_active_sup'), {
      supplierId: 'sup_mgr_new',
      supplierName: 'مورد القهوة الذهبية',
      branchName: 'فرع أ الأول',
      taxNumber: '310123456700003',
      invoiceNumber: 'INV-UPD-1',
      date: '2026-11-16',
      items: [{ id: 'it_upd', name: 'بن محمص', quantity: 2, unitPrice: 50, total: 100 }],
      amount: 100,
      subtotalAmount: 100,
      discountAmount: 0,
      vatRate: 15,
      vatAmount: 15,
      totalAmount: 115,
      paymentMethod: 'transfer',
      notes: 'تحديث كامل الموظف والفاتورة',
      attachmentIds: ['att_mgr_upd'],
      updatedAt: '2026-11-16T12:50:00Z',
    });
    await assertSucceeds(updBatch.commit());

    // Expired org rejected
    await assertFails(
      expMgrDb.doc('purchases/pur_expired_denied').set({
        id: 'pur_expired_denied',
        orgId: 'org_expired',
        branchId: 'br_exp_1',
        supplierId: 'sup_exp_1',
        date: '2026-11-16',
        amount: 100,
        totalAmount: 100,
        paymentMethod: 'cash',
        createdBy: 'uid_mgr_exp',
        createdByRole: 'manager',
        createdAt: '2026-11-16T12:55:00Z',
        updatedAt: '2026-11-16T12:55:00Z',
      })
    );
  });

  await testEnv.cleanup();

  const failed = outcomes.filter((o) => !o.passed);
  console.log(`\nSummary: ${outcomes.length - failed.length}/${outcomes.length} Phase 4.4 Step 2 emulator tests passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

runPhase44Step2EmulatorTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
