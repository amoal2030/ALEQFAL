/**
 * Independent Branch Manager Supplier Creation Permission (`canCreateSuppliers`) — Live Firestore Emulator Suite
 *
 * Proves all 9 mandatory scenarios directly against live `firestore.rules`:
 *  1. branch_manager WITH `canCreateSuppliers: true` CAN commit atomic supplier + SUPPLIER_CREATED auditLog + SUPPLIER_ADDED notification.
 *  2. branch_manager WITHOUT `canCreateSuppliers` (`false` OR omitted legacy profile) is strictly DENIED creating supplier/auditLog/notification.
 *  3. branch_manager (even with `canCreateSuppliers: true`) is strictly DENIED editing or toggling status on existing suppliers.
 *  4. branch_manager (even with `canCreateSuppliers: true`) is strictly DENIED deleting existing suppliers.
 *  5. branch_manager (even with `canCreateSuppliers: true`) is strictly DENIED editing, toggling, OR deleting a supplier he created himself (`createdBy == uid`).
 *  6. branch_manager CAN select existing active suppliers AND his newly created supplier when creating purchase invoices in his assigned branch.
 *  7. Cross-org, cross-branch, deactivated-create, self-escalation, and role-cleanup rules strictly enforced:
 *     - Cannot create supplier in Org B.
 *     - Cannot create inactive supplier (`isActive: false`).
 *     - Cannot create purchase in another branch or with Org B supplier.
 *     - Cannot self-modify own `users/{uid}` permissions.
 *     - Tampered `canManageSuppliers: true` without `canCreateSuppliers: true` is denied.
 *     - Manager CAN toggle `canCreateSuppliers` on `branch_manager` and switch role away (rules reject lingering `canCreateSuppliers: true` on `employee`/`supervisor`!).
 *  8. Organization `manager` and `supervisor` (with `canManageSuppliers: true`) workflows remain 100% intact.
 *  9. Legacy `branch_manager` (without `canCreateSuppliers` field) is denied supplier creation while retaining active supplier reads & branch purchases.
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
import { prepareCreateSupplier } from '../services/supplierService';
import { preparePurchaseSubmission } from '../services/purchaseService';
import { buildSupplierAddedNotification } from '../utils/notifications';
import { buildSuperAdminMemberUpdateBundle } from '../utils/superAdminGovernance';
import type { Branch, Organization, Supplier, UserProfile } from '../types';

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

async function runBranchManagerCreateSuppliersEmulatorTests() {
  console.log('========================================================================');
  console.log('   BRANCH MANAGER CAN_CREATE_SUPPLIERS — FIRESTORE EMULATOR SUITE       ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-bm-create-suppliers-tests',
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

  const brA1: Branch = {
    id: 'br_a1',
    orgId: 'org_a',
    name: 'فرع أ الأول',
    code: 'A-01',
    isActive: true,
    createdAt: '2026-11-01T08:00:00Z',
  };

  const brA2: Branch = {
    id: 'br_a2',
    orgId: 'org_a',
    name: 'فرع أ الثاني',
    code: 'A-02',
    isActive: true,
    createdAt: '2026-11-01T08:00:00Z',
  };

  const brB1: Branch = {
    id: 'br_b1',
    orgId: 'org_b',
    name: 'فرع ب الأول',
    code: 'B-01',
    isActive: true,
    createdAt: '2026-11-01T08:00:00Z',
  };

  const brAInactive: Branch = {
    id: 'br_a_inactive',
    orgId: 'org_a',
    name: 'فرع أ موقوف isActive',
    code: 'A-INACT',
    isActive: false,
    createdAt: '2026-11-01T08:00:00Z',
  };

  const brASuspended: Branch = {
    id: 'br_a_suspended',
    orgId: 'org_a',
    name: 'فرع أ موقوف lifecycle',
    code: 'A-SUSP',
    isActive: true,
    lifecycleStatus: 'suspended',
    createdAt: '2026-11-01T08:00:00Z',
  };

  const brAPurged: Branch = {
    id: 'br_a_purged',
    orgId: 'org_a',
    name: 'فرع أ محذوف',
    code: 'A-PURG',
    isActive: false,
    lifecycleStatus: 'purged_from_db',
    createdAt: '2026-11-01T08:00:00Z',
  };

  const supExistingA: Supplier = {
    id: 'sup_existing_a',
    orgId: 'org_a',
    name: 'شركة التوريد الأساسية',
    taxNumber: '310111222300003',
    phone: '0551112233',
    isActive: true,
    createdBy: 'uid_mgr_a',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
  };

  const supExistingB: Supplier = {
    id: 'sup_existing_b',
    orgId: 'org_b',
    name: 'مورد مؤسسة ب',
    isActive: true,
    createdBy: 'uid_mgr_b',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
  };

  const mgrA: UserProfile = {
    uid: 'uid_mgr_a',
    orgId: 'org_a',
    email: 'mgr@org-a.test',
    displayName: 'مدير المؤسسة أ',
    role: 'manager',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('manager'),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const supYes: UserProfile = {
    uid: 'uid_sup_yes',
    orgId: 'org_a',
    email: 'sup.yes@org-a.test',
    displayName: 'مسؤول موردين',
    role: 'supervisor',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('supervisor', {
      canManageSuppliers: true,
      canManagePurchases: true,
    }),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const bmAllowed: UserProfile = {
    uid: 'uid_bm_allowed',
    orgId: 'org_a',
    email: 'bm.allowed@org-a.test',
    displayName: 'مسؤول فرع مخول',
    role: 'branch_manager',
    branchId: brA1.id,
    branchIds: [brA1.id],
    branchName: brA1.name,
    isActive: true,
    permissions: buildDefaultPermissionsForRole('branch_manager', undefined, {
      canCreateSuppliers: true,
    }),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const bmDenied: UserProfile = {
    uid: 'uid_bm_denied',
    orgId: 'org_a',
    email: 'bm.denied@org-a.test',
    displayName: 'مسؤول فرع غير مخول',
    role: 'branch_manager',
    branchId: brA1.id,
    branchIds: [brA1.id],
    branchName: brA1.name,
    isActive: true,
    permissions: buildDefaultPermissionsForRole('branch_manager'),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const bmLegacyNoField: UserProfile = {
    uid: 'uid_bm_legacy',
    orgId: 'org_a',
    email: 'bm.legacy@org-a.test',
    displayName: 'مسؤول فرع قديم بدون الحقل',
    role: 'branch_manager',
    branchId: brA1.id,
    branchName: brA1.name,
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
    createdAt: '2025-05-01T08:00:00Z',
  };

  const bmTamperedManageOnly: UserProfile = {
    uid: 'uid_bm_tampered',
    orgId: 'org_a',
    email: 'bm.tampered@org-a.test',
    displayName: 'مسؤول فرع بحقل canManageSuppliers',
    role: 'branch_manager',
    branchId: brA1.id,
    branchIds: [brA1.id],
    branchName: brA1.name,
    isActive: true,
    permissions: {
      ...buildDefaultPermissionsForRole('branch_manager'),
      canManageSuppliers: true,
      canCreateSuppliers: false,
    },
    createdAt: '2026-11-01T08:00:00Z',
  };

  const bmInactiveBranch: UserProfile = {
    uid: 'uid_bm_br_inactive',
    orgId: 'org_a',
    email: 'bm.inactive.br@org-a.test',
    displayName: 'مسؤول فرع غير نشط',
    role: 'branch_manager',
    branchId: brAInactive.id,
    branchIds: [brAInactive.id],
    branchName: brAInactive.name,
    isActive: true,
    permissions: buildDefaultPermissionsForRole('branch_manager', undefined, {
      canCreateSuppliers: true,
    }),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const bmSuspendedBranch: UserProfile = {
    uid: 'uid_bm_br_suspended',
    orgId: 'org_a',
    email: 'bm.suspended.br@org-a.test',
    displayName: 'مسؤول فرع موقوف',
    role: 'branch_manager',
    branchId: brASuspended.id,
    branchIds: [brASuspended.id],
    branchName: brASuspended.name,
    isActive: true,
    permissions: buildDefaultPermissionsForRole('branch_manager', undefined, {
      canCreateSuppliers: true,
    }),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const bmPurgedBranch: UserProfile = {
    uid: 'uid_bm_br_purged',
    orgId: 'org_a',
    email: 'bm.purged.br@org-a.test',
    displayName: 'مسؤول فرع محذوف',
    role: 'branch_manager',
    branchId: brAPurged.id,
    branchIds: [brAPurged.id],
    branchName: brAPurged.name,
    isActive: true,
    permissions: buildDefaultPermissionsForRole('branch_manager', undefined, {
      canCreateSuppliers: true,
    }),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const supNoSuppliers: UserProfile = {
    uid: 'uid_sup_no_sup',
    orgId: 'org_a',
    email: 'sup.nosup@org-a.test',
    displayName: 'مشرف بدون صلاحية موردين',
    role: 'supervisor',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('supervisor', {
      canApproveClosings: true,
      canViewAllClosings: true,
    }),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const empA1: UserProfile = {
    uid: 'uid_emp_a1',
    orgId: 'org_a',
    email: 'emp.a1@org-a.test',
    displayName: 'موظف فرع أ1',
    role: 'employee',
    branchId: brA1.id,
    branchName: brA1.name,
    isActive: true,
    permissions: buildDefaultPermissionsForRole('employee'),
    createdAt: '2026-11-01T08:00:00Z',
  };

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await adminDb.collection('organizations').doc('org_a').set({
      id: 'org_a',
      name: 'مؤسسة أ',
      ownerId: mgrA.uid,
      ownerEmail: mgrA.email,
      currency: 'SAR',
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast5d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
    });
    await adminDb.collection('organizations').doc('org_b').set({
      id: 'org_b',
      name: 'مؤسسة ب',
      ownerId: 'uid_mgr_b',
      ownerEmail: 'mgr@org-b.test',
      currency: 'SAR',
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast5d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
    });

    await adminDb.collection('branches').doc(brA1.id).set(brA1);
    await adminDb.collection('branches').doc(brA2.id).set(brA2);
    await adminDb.collection('branches').doc(brB1.id).set(brB1);
    await adminDb.collection('branches').doc(brAInactive.id).set(brAInactive);
    await adminDb.collection('branches').doc(brASuspended.id).set(brASuspended);
    await adminDb.collection('branches').doc(brAPurged.id).set(brAPurged);

    await adminDb.collection('suppliers').doc(supExistingA.id).set(supExistingA);
    await adminDb.collection('suppliers').doc(supExistingB.id).set(supExistingB);

    await adminDb.collection('users').doc(mgrA.uid).set(mgrA);
    await adminDb.collection('users').doc(supYes.uid).set(supYes);
    await adminDb.collection('users').doc(supNoSuppliers.uid).set(supNoSuppliers);
    await adminDb.collection('users').doc(empA1.uid).set(empA1);
    await adminDb.collection('users').doc(bmAllowed.uid).set(bmAllowed);
    await adminDb.collection('users').doc(bmDenied.uid).set(bmDenied);
    await adminDb.collection('users').doc(bmLegacyNoField.uid).set(bmLegacyNoField);
    await adminDb.collection('users').doc(bmTamperedManageOnly.uid).set(bmTamperedManageOnly);
    await adminDb.collection('users').doc(bmInactiveBranch.uid).set(bmInactiveBranch);
    await adminDb.collection('users').doc(bmSuspendedBranch.uid).set(bmSuspendedBranch);
    await adminDb.collection('users').doc(bmPurgedBranch.uid).set(bmPurgedBranch);
  });

  const saDb = testEnv.authenticatedContext('uid_super_admin', { email: 'amoal2030@gmail.com', email_verified: true }).firestore();
  const mgrDb = testEnv.authenticatedContext(mgrA.uid, { email: mgrA.email, email_verified: true }).firestore();
  const supYesDb = testEnv.authenticatedContext(supYes.uid, { email: supYes.email, email_verified: true }).firestore();
  const supNoSupDb = testEnv.authenticatedContext(supNoSuppliers.uid, { email: supNoSuppliers.email, email_verified: true }).firestore();
  const empA1Db = testEnv.authenticatedContext(empA1.uid, { email: empA1.email, email_verified: true }).firestore();
  const bmAllowedDb = testEnv.authenticatedContext(bmAllowed.uid, { email: bmAllowed.email, email_verified: true }).firestore();
  const bmDeniedDb = testEnv.authenticatedContext(bmDenied.uid, { email: bmDenied.email, email_verified: true }).firestore();
  const bmLegacyDb = testEnv.authenticatedContext(bmLegacyNoField.uid, { email: bmLegacyNoField.email, email_verified: true }).firestore();
  const bmTamperedDb = testEnv.authenticatedContext(bmTamperedManageOnly.uid, { email: bmTamperedManageOnly.email, email_verified: true }).firestore();
  const bmInactiveBrDb = testEnv.authenticatedContext(bmInactiveBranch.uid, { email: bmInactiveBranch.email, email_verified: true }).firestore();
  const bmSuspendedBrDb = testEnv.authenticatedContext(bmSuspendedBranch.uid, { email: bmSuspendedBranch.email, email_verified: true }).firestore();
  const bmPurgedBrDb = testEnv.authenticatedContext(bmPurgedBranch.uid, { email: bmPurgedBranch.email, email_verified: true }).firestore();

  const outcomes: TestOutcome[] = [];
  const runCase = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      outcomes.push({ name, passed: true });
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     ${err?.message || err}`);
      outcomes.push({ name, passed: false, error: err?.message || String(err) });
    }
  };

  let bmCreatedSupplier: Supplier | null = null;

  // Case 1: branch_manager WITH canCreateSuppliers: true CAN create supplier + auditLog + notification atomically
  await runCase('1. branch_manager WITH canCreateSuppliers: true creates supplier + SUPPLIER_CREATED auditLog + SUPPLIER_ADDED notification atomically', async () => {
    const prep = prepareCreateSupplier({
      userProfile: bmAllowed,
      orgId: 'org_a',
      existingSuppliers: [supExistingA],
      input: {
        name: 'مورد مسؤول الفرع المخول',
        companyName: 'شركة الإمداد الحديث',
        taxNumber: '310777888900003',
        phone: '0557778899',
        address: 'الرياض',
        notes: 'مضاف من شاشة الموردين لمسؤول الفرع',
      },
      supplierId: 'sup_bm_self_1',
      nowIso: '2026-11-20T09:00:00Z',
    });
    assert.equal(prep.ok, true);
    if (!prep.ok) return;

    const batch = bmAllowedDb.batch();
    batch.set(bmAllowedDb.collection('suppliers').doc(prep.data.supplier.id), prep.data.supplier);
    batch.set(bmAllowedDb.collection('auditLogs').doc(prep.data.auditLog.id), prep.data.auditLog);
    batch.set(bmAllowedDb.collection('notifications').doc(prep.data.notification.id), prep.data.notification);
    await assertSucceeds(batch.commit());

    bmCreatedSupplier = prep.data.supplier;
  });

  // Case 2: branch_manager WITHOUT canCreateSuppliers (false) AND tampered canManageSuppliers are DENIED
  await runCase('2. branch_manager WITHOUT canCreateSuppliers (false or tampered canManageSuppliers) is DENIED creating supplier', async () => {
    const rawSupplier = {
      id: 'sup_bm_denied_1',
      orgId: 'org_a',
      name: 'مورد غير مصرح',
      isActive: true,
      createdBy: bmDenied.uid,
      createdAt: '2026-11-20T09:05:00Z',
      updatedAt: '2026-11-20T09:05:00Z',
    };
    await assertFails(bmDeniedDb.collection('suppliers').doc(rawSupplier.id).set(rawSupplier));

    const tamperedSupplier = {
      ...rawSupplier,
      id: 'sup_bm_tampered_1',
      createdBy: bmTamperedManageOnly.uid,
    };
    await assertFails(bmTamperedDb.collection('suppliers').doc(tamperedSupplier.id).set(tamperedSupplier));
  });

  // Case 3: branch_manager CANNOT edit or toggle status on existing supplier
  await runCase('3. branch_manager WITH canCreateSuppliers: true is DENIED editing or toggling status on existing supplier', async () => {
    await assertFails(
      bmAllowedDb.collection('suppliers').doc(supExistingA.id).update({
        name: 'محاولة تعديل اسم المورد',
        updatedAt: '2026-11-20T09:10:00Z',
      })
    );
    await assertFails(
      bmAllowedDb.collection('suppliers').doc(supExistingA.id).update({
        isActive: false,
        updatedAt: '2026-11-20T09:11:00Z',
      })
    );
  });

  // Case 4: branch_manager CANNOT delete existing supplier
  await runCase('4. branch_manager WITH canCreateSuppliers: true is DENIED deleting existing supplier', async () => {
    await assertFails(bmAllowedDb.collection('suppliers').doc(supExistingA.id).delete());
  });

  // Case 5: branch_manager CANNOT edit, toggle, or delete a supplier he created himself
  await runCase('5. branch_manager WITH canCreateSuppliers: true is DENIED editing, toggling, or deleting his OWN created supplier', async () => {
    assert.ok(bmCreatedSupplier, 'Expected bmCreatedSupplier from Case 1');
    await assertFails(
      bmAllowedDb.collection('suppliers').doc(bmCreatedSupplier!.id).update({
        name: 'محاولة تعديل المورد الذي أضفته بنفسي',
        updatedAt: '2026-11-20T09:15:00Z',
      })
    );
    await assertFails(
      bmAllowedDb.collection('suppliers').doc(bmCreatedSupplier!.id).update({
        isActive: false,
        updatedAt: '2026-11-20T09:16:00Z',
      })
    );
    await assertFails(bmAllowedDb.collection('suppliers').doc(bmCreatedSupplier!.id).delete());
  });

  // Case 6: branch_manager CAN select existing active suppliers AND his newly created supplier in purchase invoices
  await runCase('6. branch_manager CAN read active suppliers and record purchases using both existing & newly created supplier in assigned branch', async () => {
    assert.ok(bmCreatedSupplier);
    await assertSucceeds(bmAllowedDb.collection('suppliers').doc(supExistingA.id).get());
    await assertSucceeds(bmAllowedDb.collection('suppliers').doc(bmCreatedSupplier!.id).get());

    const prepNewSupPurchase = preparePurchaseSubmission({
      userProfile: bmAllowed,
      orgId: 'org_a',
      branch: brA1,
      supplier: bmCreatedSupplier!,
      currency: 'SAR',
      date: '2026-11-20',
      invoiceNumber: 'INV-BM-NEW-1',
      paymentMethod: 'cash',
      vatRate: 15,
      items: [{ name: 'خضار', quantity: 2, unitPrice: 50 }],
      purchaseId: 'pur_bm_new_sup_1',
      nowIso: '2026-11-20T09:20:00Z',
    });
    assert.equal(prepNewSupPurchase.ok, true);
    if (!prepNewSupPurchase.ok) return;

    const batch1 = bmAllowedDb.batch();
    const pur1Ref = bmAllowedDb.collection('purchases').doc(prepNewSupPurchase.data.purchase.id);
    batch1.set(pur1Ref, prepNewSupPurchase.data.purchase);
    prepNewSupPurchase.data.subItems.forEach((item) => {
      batch1.set(pur1Ref.collection('items').doc(item.id), item);
    });
    batch1.set(bmAllowedDb.collection('auditLogs').doc(prepNewSupPurchase.data.auditLog.id), prepNewSupPurchase.data.auditLog);
    await assertSucceeds(batch1.commit());

    const prepExistingSupPurchase = preparePurchaseSubmission({
      userProfile: bmDenied,
      orgId: 'org_a',
      branch: brA1,
      supplier: supExistingA,
      currency: 'SAR',
      date: '2026-11-20',
      invoiceNumber: 'INV-BM-EX-1',
      paymentMethod: 'transfer',
      vatRate: 15,
      items: [{ name: 'مواد غذائية', quantity: 1, unitPrice: 200 }],
      purchaseId: 'pur_bm_existing_sup_1',
      nowIso: '2026-11-20T09:25:00Z',
    });
    assert.equal(prepExistingSupPurchase.ok, true);
    if (!prepExistingSupPurchase.ok) return;

    const batch2 = bmDeniedDb.batch();
    const pur2Ref = bmDeniedDb.collection('purchases').doc(prepExistingSupPurchase.data.purchase.id);
    batch2.set(pur2Ref, prepExistingSupPurchase.data.purchase);
    prepExistingSupPurchase.data.subItems.forEach((item) => {
      batch2.set(pur2Ref.collection('items').doc(item.id), item);
    });
    batch2.set(bmDeniedDb.collection('auditLogs').doc(prepExistingSupPurchase.data.auditLog.id), prepExistingSupPurchase.data.auditLog);
    await assertSucceeds(batch2.commit());
  });

  // Case 7: Cross-org, cross-branch, inactive create, self-escalation, and manager role-change enforcement
  await runCase('7. Cross-org, cross-branch, inactive-create, self-escalation, and role-switch cleanup rules strictly enforced', async () => {
    // 7a. Cannot create supplier in Org B
    await assertFails(
      bmAllowedDb.collection('suppliers').doc('sup_cross_org_b').set({
        id: 'sup_cross_org_b',
        orgId: 'org_b',
        name: 'مورد عبر المؤسسة',
        isActive: true,
        createdBy: bmAllowed.uid,
        createdAt: '2026-11-20T09:30:00Z',
        updatedAt: '2026-11-20T09:30:00Z',
      })
    );

    // 7b. Cannot create inactive supplier as branch_manager
    await assertFails(
      bmAllowedDb.collection('suppliers').doc('sup_bm_inactive').set({
        id: 'sup_bm_inactive',
        orgId: 'org_a',
        name: 'مورد موقوف من البداية',
        isActive: false,
        createdBy: bmAllowed.uid,
        createdAt: '2026-11-20T09:31:00Z',
        updatedAt: '2026-11-20T09:31:00Z',
      })
    );

    // 7c. Cannot record purchase in another branch (br_a2)
    await assertFails(
      bmAllowedDb.collection('purchases').doc('pur_bm_wrong_branch').set({
        id: 'pur_bm_wrong_branch',
        orgId: 'org_a',
        branchId: brA2.id,
        branchName: brA2.name,
        supplierId: supExistingA.id,
        supplierName: supExistingA.name,
        invoiceDate: '2026-11-20',
        invoiceNumber: 'INV-WRONG-BR',
        amount: 100,
        subtotalAmount: 100,
        vatAmount: 15,
        totalAmount: 115,
        paymentMethod: 'cash',
        items: [{ description: 'بند', quantity: 1, unitPrice: 100, total: 100 }],
        attachmentsCount: 0,
        createdBy: bmAllowed.uid,
        createdByName: bmAllowed.displayName,
        createdAt: '2026-11-20T09:32:00Z',
        updatedAt: '2026-11-20T09:32:00Z',
      })
    );

    // 7d. branch_manager CANNOT self-grant canCreateSuppliers on own user doc
    await assertFails(
      bmDeniedDb.collection('users').doc(bmDenied.uid).update({
        permissions: buildDefaultPermissionsForRole('branch_manager', undefined, {
          canCreateSuppliers: true,
        }),
        updatedAt: '2026-11-20T09:33:00Z',
      })
    );

    // 7e. Manager CANNOT leave canCreateSuppliers: true when switching role to employee or supervisor
    await assertFails(
      mgrDb.collection('users').doc(bmAllowed.uid).update({
        role: 'employee',
        branchId: brA1.id,
        branchIds: firebase.firestore.FieldValue.delete(),
        permissions: {
          ...buildDefaultPermissionsForRole('employee'),
          canCreateSuppliers: true,
        },
        updatedAt: '2026-11-20T09:34:00Z',
      })
    );

    await assertFails(
      mgrDb.collection('users').doc(bmAllowed.uid).update({
        role: 'supervisor',
        branchId: firebase.firestore.FieldValue.delete(),
        branchIds: firebase.firestore.FieldValue.delete(),
        permissions: {
          ...buildDefaultPermissionsForRole('supervisor', { canManagePurchases: true }),
          canCreateSuppliers: true,
        },
        updatedAt: '2026-11-20T09:35:00Z',
      })
    );

    // 7f. Manager CAN cleanly toggle canCreateSuppliers on branch_manager and switch role with cleared permissions
    await assertSucceeds(
      mgrDb.collection('users').doc(bmDenied.uid).update({
        permissions: buildDefaultPermissionsForRole('branch_manager', undefined, {
          canCreateSuppliers: true,
        }),
        updatedAt: '2026-11-20T09:36:00Z',
      })
    );
    await assertSucceeds(
      mgrDb.collection('users').doc(bmDenied.uid).update({
        permissions: buildDefaultPermissionsForRole('branch_manager', undefined, {
          canCreateSuppliers: false,
        }),
        updatedAt: '2026-11-20T09:37:00Z',
      })
    );
  });

  // Case 8: Manager & Supervisor permissions completely unaffected
  await runCase('8. Manager (full CRUD) and Supervisor with canManageSuppliers (create-only) remain completely unaffected', async () => {
    // Supervisor creates supplier atomically
    const supPrep = prepareCreateSupplier({
      userProfile: supYes,
      orgId: 'org_a',
      existingSuppliers: [supExistingA],
      input: { name: 'مورد أضافه المسؤول' },
      supplierId: 'sup_by_supervisor_1',
      nowIso: '2026-11-20T09:40:00Z',
    });
    assert.equal(supPrep.ok, true);
    if (!supPrep.ok) return;
    const supBatch = supYesDb.batch();
    supBatch.set(supYesDb.collection('suppliers').doc(supPrep.data.supplier.id), supPrep.data.supplier);
    supBatch.set(supYesDb.collection('auditLogs').doc(supPrep.data.auditLog.id), supPrep.data.auditLog);
    supBatch.set(supYesDb.collection('notifications').doc(supPrep.data.notification.id), supPrep.data.notification);
    await assertSucceeds(supBatch.commit());

    // Supervisor still cannot edit/delete
    await assertFails(
      supYesDb.collection('suppliers').doc(supPrep.data.supplier.id).update({
        name: 'محاولة تعديل من المسؤول',
        updatedAt: '2026-11-20T09:41:00Z',
      })
    );
    await assertFails(supYesDb.collection('suppliers').doc(supPrep.data.supplier.id).delete());

    // Manager can edit, toggle, and delete
    await assertSucceeds(
      mgrDb.collection('suppliers').doc(supPrep.data.supplier.id).update({
        name: 'اسم محدث من المدير',
        isActive: false,
        updatedAt: '2026-11-20T09:42:00Z',
      })
    );
    await assertSucceeds(mgrDb.collection('suppliers').doc(supPrep.data.supplier.id).delete());
  });

  // Case 9: Legacy branch_manager (omitted canCreateSuppliers field) strictly denied create, keeps read + purchase
  await runCase('9. Legacy branch_manager (without canCreateSuppliers field) is DENIED create while keeping active supplier reads', async () => {
    await assertFails(
      bmLegacyDb.collection('suppliers').doc('sup_bm_legacy_attempt').set({
        id: 'sup_bm_legacy_attempt',
        orgId: 'org_a',
        name: 'محاولة قديم',
        isActive: true,
        createdBy: bmLegacyNoField.uid,
        createdAt: '2026-11-20T09:45:00Z',
        updatedAt: '2026-11-20T09:45:00Z',
      })
    );

    await assertSucceeds(bmLegacyDb.collection('suppliers').doc(supExistingA.id).get());
  });

  // Case 10: Security Hardening — Reject standalone/replayed SUPPLIER_CREATED for existing suppliers & mismatched creator
  await runCase('10. Reject SUPPLIER_CREATED auditLog for existing suppliers (all 3 roles) and when createdBy != request.auth.uid', async () => {
    assert.ok(bmCreatedSupplier, 'bmCreatedSupplier must exist from Case 1');

    // 10a. branch_manager cannot create standalone SUPPLIER_CREATED pointing to an existing/old supplier (created by manager)
    await assertFails(
      bmAllowedDb.collection('auditLogs').doc('audit_forged_bm_old_1').set({
        id: 'audit_forged_bm_old_1',
        orgId: 'org_a',
        actorId: bmAllowed.uid,
        actorName: bmAllowed.displayName,
        actorRole: 'branch_manager',
        action: 'SUPPLIER_CREATED',
        targetType: 'supplier',
        targetId: supExistingA.id,
        details: 'محاولة تزوير سجل لمورد قديم',
        timestamp: '2026-11-20T09:50:00Z',
      })
    );

    // 10b. branch_manager cannot replay SUPPLIER_CREATED even for a supplier he himself created earlier
    await assertFails(
      bmAllowedDb.collection('auditLogs').doc('audit_replay_bm_self_1').set({
        id: 'audit_replay_bm_self_1',
        orgId: 'org_a',
        actorId: bmAllowed.uid,
        actorName: bmAllowed.displayName,
        actorRole: 'branch_manager',
        action: 'SUPPLIER_CREATED',
        targetType: 'supplier',
        targetId: bmCreatedSupplier.id,
        details: 'محاولة تكرار سجل لمورد أنشأه مسبقاً',
        timestamp: '2026-11-20T09:51:00Z',
      })
    );

    // 10c. supervisor and manager ALSO cannot emit standalone SUPPLIER_CREATED for an already-existing supplier
    await assertFails(
      supYesDb.collection('auditLogs').doc('audit_replay_sup_old_1').set({
        id: 'audit_replay_sup_old_1',
        orgId: 'org_a',
        actorId: supYes.uid,
        actorName: supYes.displayName,
        actorRole: 'supervisor',
        action: 'SUPPLIER_CREATED',
        targetType: 'supplier',
        targetId: supExistingA.id,
        details: 'محاولة سجل لمورد موجود من المسؤول',
        timestamp: '2026-11-20T09:52:00Z',
      })
    );
    await assertFails(
      mgrDb.collection('auditLogs').doc('audit_replay_mgr_old_1').set({
        id: 'audit_replay_mgr_old_1',
        orgId: 'org_a',
        actorId: mgrA.uid,
        actorName: mgrA.displayName,
        actorRole: 'manager',
        action: 'SUPPLIER_CREATED',
        targetType: 'supplier',
        targetId: supExistingA.id,
        details: 'محاولة سجل لمورد موجود من المدير',
        timestamp: '2026-11-20T09:53:00Z',
      })
    );

    // 10d. Reject SUPPLIER_CREATED when createdBy != request.auth.uid (mismatched creator on new supplier batch)
    const badCreatorBatch = bmAllowedDb.batch();
    badCreatorBatch.set(bmAllowedDb.collection('suppliers').doc('sup_bad_creator_1'), {
      id: 'sup_bad_creator_1',
      orgId: 'org_a',
      name: 'مورد بمنشئ مزيف',
      isActive: true,
      createdBy: mgrA.uid, // mismatched!
      createdAt: '2026-11-20T09:54:00Z',
      updatedAt: '2026-11-20T09:54:00Z',
    });
    badCreatorBatch.set(bmAllowedDb.collection('auditLogs').doc('audit_bad_creator_1'), {
      id: 'audit_bad_creator_1',
      orgId: 'org_a',
      actorId: bmAllowed.uid,
      actorName: bmAllowed.displayName,
      actorRole: 'branch_manager',
      action: 'SUPPLIER_CREATED',
      targetType: 'supplier',
      targetId: 'sup_bad_creator_1',
      details: 'محاولة منشئ غير مطابق',
      timestamp: '2026-11-20T09:54:00Z',
    });
    await assertFails(badCreatorBatch.commit());

    // 10e. Reject SUPPLIER_CREATED pointing to a non-existent supplier
    await assertFails(
      mgrDb.collection('auditLogs').doc('audit_ghost_sup_1').set({
        id: 'audit_ghost_sup_1',
        orgId: 'org_a',
        actorId: mgrA.uid,
        actorName: mgrA.displayName,
        actorRole: 'manager',
        action: 'SUPPLIER_CREATED',
        targetType: 'supplier',
        targetId: 'sup_does_not_exist_999',
        details: 'مورد وهمي غير موجود',
        timestamp: '2026-11-20T09:55:00Z',
      })
    );
  });

  // Case 11: Security Hardening — Reject standalone/replayed/forged SUPPLIER_ADDED notifications across all 3 roles
  await runCase('11. Reject standalone, replayed, and forged SUPPLIER_ADDED notifications for existing suppliers across all 3 roles', async () => {
    assert.ok(bmCreatedSupplier, 'bmCreatedSupplier must exist from Case 1');

    // 11a. Manager cannot create standalone SUPPLIER_ADDED for an existing/old supplier
    const forgedMgrOld = buildSupplierAddedNotification({
      orgId: 'org_a',
      supplierId: supExistingA.id,
      supplierName: supExistingA.name,
      actorUid: mgrA.uid,
      actorName: mgrA.displayName,
      actorRole: 'manager',
      createdAt: '2026-11-20T10:00:00Z',
    });
    await assertFails(mgrDb.collection('notifications').doc('notif_forged_mgr_old_1').set({
      ...forgedMgrOld,
      id: 'notif_forged_mgr_old_1',
    }));

    // 11b. Supervisor cannot create standalone SUPPLIER_ADDED for an existing/old supplier
    const forgedSupOld = buildSupplierAddedNotification({
      orgId: 'org_a',
      supplierId: supExistingA.id,
      supplierName: supExistingA.name,
      actorUid: supYes.uid,
      actorName: supYes.displayName,
      actorRole: 'supervisor',
      createdAt: '2026-11-20T10:01:00Z',
    });
    await assertFails(supYesDb.collection('notifications').doc('notif_forged_sup_old_1').set({
      ...forgedSupOld,
      id: 'notif_forged_sup_old_1',
    }));

    // 11c. branch_manager cannot create standalone or repeated SUPPLIER_ADDED for old OR own already-created supplier
    const forgedBmOld = buildSupplierAddedNotification({
      orgId: 'org_a',
      supplierId: supExistingA.id,
      supplierName: supExistingA.name,
      actorUid: bmAllowed.uid,
      actorName: bmAllowed.displayName,
      actorRole: 'branch_manager',
      createdAt: '2026-11-20T10:02:00Z',
    });
    await assertFails(bmAllowedDb.collection('notifications').doc('notif_forged_bm_old_1').set({
      ...forgedBmOld,
      id: 'notif_forged_bm_old_1',
    }));

    const replayBmSelf = buildSupplierAddedNotification({
      orgId: 'org_a',
      supplierId: bmCreatedSupplier.id,
      supplierName: bmCreatedSupplier.name,
      actorUid: bmAllowed.uid,
      actorName: bmAllowed.displayName,
      actorRole: 'branch_manager',
      createdAt: '2026-11-20T10:03:00Z',
    });
    await assertFails(bmAllowedDb.collection('notifications').doc('notif_replay_bm_self_spam_1').set({
      ...replayBmSelf,
      id: 'notif_replay_bm_self_spam_1',
    }));

    // 11d. Reject SUPPLIER_ADDED with mismatched dedupKey even in an atomic batch with a new supplier
    const badDedupBatch = bmAllowedDb.batch();
    const badDedupSupplierId = 'sup_bad_dedup_1';
    const badDedupNotif = buildSupplierAddedNotification({
      orgId: 'org_a',
      supplierId: badDedupSupplierId,
      supplierName: 'مورد مفتاح تكرار مزور',
      actorUid: bmAllowed.uid,
      actorName: bmAllowed.displayName,
      actorRole: 'branch_manager',
      createdAt: '2026-11-20T10:04:00Z',
    });
    badDedupBatch.set(bmAllowedDb.collection('suppliers').doc(badDedupSupplierId), {
      id: badDedupSupplierId,
      orgId: 'org_a',
      name: 'مورد مفتاح تكرار مزور',
      isActive: true,
      createdBy: bmAllowed.uid,
      createdAt: '2026-11-20T10:04:00Z',
      updatedAt: '2026-11-20T10:04:00Z',
    });
    badDedupBatch.set(bmAllowedDb.collection('notifications').doc('notif_forged_dedup_1'), {
      ...badDedupNotif,
      id: 'notif_forged_dedup_1',
      dedupKey: 'supplier_add:random_spam_key',
    });
    await assertFails(badDedupBatch.commit());

    // 11e. Reject SUPPLIER_ADDED misrouted to unrelated permission feed (e.g. canApproveClosings)
    const badFeedBatch = bmAllowedDb.batch();
    const badFeedSupplierId = 'sup_bad_feed_1';
    const badFeedNotif = buildSupplierAddedNotification({
      orgId: 'org_a',
      supplierId: badFeedSupplierId,
      supplierName: 'مورد توجيه إشعار خاطئ',
      actorUid: bmAllowed.uid,
      actorName: bmAllowed.displayName,
      actorRole: 'branch_manager',
      createdAt: '2026-11-20T10:05:00Z',
    });
    badFeedBatch.set(bmAllowedDb.collection('suppliers').doc(badFeedSupplierId), {
      id: badFeedSupplierId,
      orgId: 'org_a',
      name: 'مورد توجيه إشعار خاطئ',
      isActive: true,
      createdBy: bmAllowed.uid,
      createdAt: '2026-11-20T10:05:00Z',
      updatedAt: '2026-11-20T10:05:00Z',
    });
    badFeedBatch.set(bmAllowedDb.collection('notifications').doc(badFeedNotif.id), {
      ...badFeedNotif,
      requiredPermission: 'canApproveClosings',
      feedKeys: ['org_perm:org_a:canApproveClosings', 'org_mgr:org_a'],
    });
    await assertFails(badFeedBatch.commit());
  });

  // Case 12: Security Hardening — Legitimate atomic creation (supplier + SUPPLIER_CREATED + SUPPLIER_ADDED) succeeds for manager too
  await runCase('12. Legitimate atomic creation (supplier + SUPPLIER_CREATED + SUPPLIER_ADDED) succeeds for manager and rejects immediate replay', async () => {
    const mgrPrep = prepareCreateSupplier({
      userProfile: mgrA,
      orgId: 'org_a',
      existingSuppliers: [supExistingA],
      input: { name: 'مورد المدير الذري' },
      supplierId: 'sup_by_manager_atomic_1',
      nowIso: '2026-11-20T10:10:00Z',
    });
    assert.equal(mgrPrep.ok, true);
    if (!mgrPrep.ok) return;

    const mgrBatch = mgrDb.batch();
    mgrBatch.set(mgrDb.collection('suppliers').doc(mgrPrep.data.supplier.id), mgrPrep.data.supplier);
    mgrBatch.set(mgrDb.collection('auditLogs').doc(mgrPrep.data.auditLog.id), mgrPrep.data.auditLog);
    mgrBatch.set(mgrDb.collection('notifications').doc(mgrPrep.data.notification.id), mgrPrep.data.notification);
    await assertSucceeds(mgrBatch.commit());

    // Subsequent replay of SUPPLIER_ADDED or SUPPLIER_CREATED for the same supplier MUST fail!
    await assertFails(
      mgrDb.collection('notifications').doc('notif_mgr_replay_2').set({
        ...mgrPrep.data.notification,
        id: 'notif_mgr_replay_2',
      })
    );
    await assertFails(
      mgrDb.collection('auditLogs').doc('audit_mgr_replay_2').set({
        ...mgrPrep.data.auditLog,
        id: 'audit_mgr_replay_2',
      })
    );
  });

  // Case 13: Security Hardening — Reject branch_manager with canCreateSuppliers: true on inactive, suspended, or purged branch
  await runCase('13. Reject branch_manager with canCreateSuppliers: true when assigned branch is inactive, suspended, or purged_from_db', async () => {
    const cases: Array<{ label: string; profile: UserProfile; db: firebase.firestore.Firestore; supId: string }> = [
      { label: 'inactive (isActive: false)', profile: bmInactiveBranch, db: bmInactiveBrDb, supId: 'sup_bm_br_inactive_1' },
      { label: 'suspended (lifecycleStatus: suspended)', profile: bmSuspendedBranch, db: bmSuspendedBrDb, supId: 'sup_bm_br_suspended_1' },
      { label: 'purged (lifecycleStatus: purged_from_db)', profile: bmPurgedBranch, db: bmPurgedBrDb, supId: 'sup_bm_br_purged_1' },
    ];

    for (const c of cases) {
      const prep = prepareCreateSupplier({
        userProfile: c.profile,
        orgId: 'org_a',
        existingSuppliers: [supExistingA],
        input: { name: `مورد مرفوض ${c.label}` },
        supplierId: c.supId,
        nowIso: '2026-11-20T10:15:00Z',
      });
      assert.equal(prep.ok, true);
      if (!prep.ok) continue;

      // Full atomic batch MUST fail
      const fullBatch = c.db.batch();
      fullBatch.set(c.db.collection('suppliers').doc(prep.data.supplier.id), prep.data.supplier);
      fullBatch.set(c.db.collection('auditLogs').doc(prep.data.auditLog.id), prep.data.auditLog);
      fullBatch.set(c.db.collection('notifications').doc(prep.data.notification.id), prep.data.notification);
      await assertFails(fullBatch.commit());

      // Direct supplier create MUST fail
      await assertFails(c.db.collection('suppliers').doc(prep.data.supplier.id).set(prep.data.supplier));
    }
  });

  // Case 14: Super Admin administrative update preserves canCreateSuppliers: true in live Firestore Emulator
  await runCase('14. Super Admin update (buildSuperAdminMemberUpdateBundle) preserves canCreateSuppliers: true on live Firestore doc', async () => {
    const orgAObj: Organization = {
      id: 'org_a',
      name: 'مؤسسة أ',
      ownerId: mgrA.uid,
      ownerEmail: mgrA.email,
      ownerName: mgrA.displayName,
      activityType: 'retail',
      currency: 'SAR',
      driveConnected: false,
      isActive: true,
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    };
    const bundle = buildSuperAdminMemberUpdateBundle({
      actor: {
        uid: 'uid_super_admin',
        email: 'amoal2030@gmail.com',
        emailVerified: true,
        displayName: 'المدير الرئيسي',
      },
      org: orgAObj,
      existingMember: bmAllowed,
      orgBranches: [brA1, brA2],
      displayName: 'مسؤول فرع مخول (معدل إدارياً)',
      phone: '0551234567',
      role: 'branch_manager',
      branchId: brA2.id,
      deleteFieldSentinel: firebase.firestore.FieldValue.delete(),
    });

    const saBatch = saDb.batch();
    saBatch.update(saDb.collection('users').doc(bmAllowed.uid), bundle.userPatch);
    saBatch.set(saDb.collection('platformAuditLogs').doc(bundle.auditLog.id), bundle.auditLog);
    await assertSucceeds(saBatch.commit());

    const updatedSnap = await assertSucceeds(saDb.collection('users').doc(bmAllowed.uid).get());
    const updatedData = updatedSnap.data() as UserProfile;
    assert.equal(updatedData.displayName, 'مسؤول فرع مخول (معدل إدارياً)');
    assert.equal(updatedData.branchId, brA2.id);
    assert.equal(updatedData.permissions?.canCreateSuppliers, true);

    // After Super Admin branch update, bmAllowed can STILL create a supplier atomically
    const afterUpdatePrep = prepareCreateSupplier({
      userProfile: updatedData,
      orgId: 'org_a',
      existingSuppliers: [supExistingA],
      input: { name: 'مورد بعد تعديل المدير الرئيسي' },
      supplierId: 'sup_bm_after_sa_update_1',
      nowIso: '2026-11-20T10:25:00Z',
    });
    assert.equal(afterUpdatePrep.ok, true);
    if (!afterUpdatePrep.ok) return;
    const afterBatch = bmAllowedDb.batch();
    afterBatch.set(bmAllowedDb.collection('suppliers').doc(afterUpdatePrep.data.supplier.id), afterUpdatePrep.data.supplier);
    afterBatch.set(bmAllowedDb.collection('auditLogs').doc(afterUpdatePrep.data.auditLog.id), afterUpdatePrep.data.auditLog);
    afterBatch.set(bmAllowedDb.collection('notifications').doc(afterUpdatePrep.data.notification.id), afterUpdatePrep.data.notification);
    await assertSucceeds(afterBatch.commit());
  });

  // Case 15: Same-batch duplicate SUPPLIER_CREATED rejection across all 3 roles (deterministic 1-to-1 logId)
  await runCase('15. Reject duplicate or non-canonical SUPPLIER_CREATED auditLogs even inside the SAME initial atomic writeBatch (all 3 roles)', async () => {
    const actors: Array<{ label: string; profile: UserProfile; db: firebase.firestore.Firestore; supId: string }> = [
      { label: 'branch_manager', profile: bmAllowed, db: bmAllowedDb, supId: 'sup_same_batch_dup_log_bm' },
      { label: 'supervisor', profile: supYes, db: supYesDb, supId: 'sup_same_batch_dup_log_sup' },
      { label: 'manager', profile: mgrA, db: mgrDb, supId: 'sup_same_batch_dup_log_mgr' },
    ];

    for (const a of actors) {
      const prep = prepareCreateSupplier({
        userProfile: a.profile,
        orgId: 'org_a',
        existingSuppliers: [supExistingA],
        input: { name: `مورد تجربة تكرار سجل ${a.label}` },
        supplierId: a.supId,
        nowIso: '2026-11-20T10:30:00Z',
      });
      assert.equal(prep.ok, true);
      if (!prep.ok) continue;

      // 15a. Canonical auditLog + extra second auditLog in the SAME batch MUST fail atomically!
      const dupLogBatch = a.db.batch();
      dupLogBatch.set(a.db.collection('suppliers').doc(prep.data.supplier.id), prep.data.supplier);
      dupLogBatch.set(a.db.collection('auditLogs').doc(prep.data.auditLog.id), prep.data.auditLog);
      dupLogBatch.set(a.db.collection('auditLogs').doc(`${prep.data.auditLog.id}_dup2`), {
        ...prep.data.auditLog,
        id: `${prep.data.auditLog.id}_dup2`,
      });
      dupLogBatch.set(a.db.collection('notifications').doc(prep.data.notification.id), prep.data.notification);
      await assertFails(dupLogBatch.commit());

      // 15b. Single non-canonical random auditLog ID in the SAME batch MUST fail atomically!
      const randomLogBatch = a.db.batch();
      randomLogBatch.set(a.db.collection('suppliers').doc(prep.data.supplier.id), prep.data.supplier);
      randomLogBatch.set(a.db.collection('auditLogs').doc(`log_random_${a.supId}`), {
        ...prep.data.auditLog,
        id: `log_random_${a.supId}`,
      });
      randomLogBatch.set(a.db.collection('notifications').doc(prep.data.notification.id), prep.data.notification);
      await assertFails(randomLogBatch.commit());
    }
  });

  // Case 16: Same-batch duplicate SUPPLIER_ADDED rejection & unauthorized recipient routing denial (all 3 roles)
  await runCase('16. Reject duplicate/non-canonical SUPPLIER_ADDED notifications in SAME batch and block unauthorized recipients', async () => {
    const actors: Array<{ label: string; profile: UserProfile; db: firebase.firestore.Firestore; supId: string }> = [
      { label: 'branch_manager', profile: bmAllowed, db: bmAllowedDb, supId: 'sup_same_batch_dup_ntf_bm' },
      { label: 'supervisor', profile: supYes, db: supYesDb, supId: 'sup_same_batch_dup_ntf_sup' },
      { label: 'manager', profile: mgrA, db: mgrDb, supId: 'sup_same_batch_dup_ntf_mgr' },
    ];

    for (const a of actors) {
      const prep = prepareCreateSupplier({
        userProfile: a.profile,
        orgId: 'org_a',
        existingSuppliers: [supExistingA],
        input: { name: `مورد تجربة تكرار إشعار ${a.label}` },
        supplierId: a.supId,
        nowIso: '2026-11-20T10:35:00Z',
      });
      assert.equal(prep.ok, true);
      if (!prep.ok) continue;

      // 16a. Canonical notification + extra second notification in SAME batch MUST fail atomically!
      const dupNotifBatch = a.db.batch();
      dupNotifBatch.set(a.db.collection('suppliers').doc(prep.data.supplier.id), prep.data.supplier);
      dupNotifBatch.set(a.db.collection('auditLogs').doc(prep.data.auditLog.id), prep.data.auditLog);
      dupNotifBatch.set(a.db.collection('notifications').doc(prep.data.notification.id), prep.data.notification);
      dupNotifBatch.set(a.db.collection('notifications').doc(`${prep.data.notification.id}_spam2`), {
        ...prep.data.notification,
        id: `${prep.data.notification.id}_spam2`,
      });
      await assertFails(dupNotifBatch.commit());

      // 16b. Single arbitrary non-canonical notification ID in SAME batch MUST fail!
      const randomNotifBatch = a.db.batch();
      randomNotifBatch.set(a.db.collection('suppliers').doc(prep.data.supplier.id), prep.data.supplier);
      randomNotifBatch.set(a.db.collection('auditLogs').doc(prep.data.auditLog.id), prep.data.auditLog);
      randomNotifBatch.set(a.db.collection('notifications').doc(`ntf_002u6_forged_${a.label}`), {
        ...prep.data.notification,
        id: `ntf_002u6_forged_${a.label}`,
      });
      await assertFails(randomNotifBatch.commit());
    }

    // 16c. Unauthorized recipient targeting attempts inside atomic batch MUST ALL fail:
    //  - direct user scope targeting an employee
    //  - branch_mgr feed injection
    //  - foreign org feed injection
    const unauthTargets = [
      {
        supId: 'sup_unauth_user_scope',
        patch: {
          audienceScope: 'user',
          recipientUid: empA1.uid,
          feedKeys: [`user:org_a:${empA1.uid}`],
        },
      },
      {
        supId: 'sup_unauth_branch_feed',
        patch: {
          branchId: brA1.id,
          feedKeys: ['org_perm:org_a:canManageSuppliers', `branch_mgr:org_a:${brA1.id}`, 'org_mgr:org_a'],
        },
      },
      {
        supId: 'sup_unauth_foreign_org_feed',
        patch: {
          feedKeys: ['org_perm:org_a:canManageSuppliers', 'org_mgr:org_b'],
        },
      },
    ];

    for (const u of unauthTargets) {
      const prep = prepareCreateSupplier({
        userProfile: bmAllowed,
        orgId: 'org_a',
        existingSuppliers: [supExistingA],
        input: { name: `مورد مستلم غير مخول ${u.supId}` },
        supplierId: u.supId,
        nowIso: '2026-11-20T10:36:00Z',
      });
      assert.equal(prep.ok, true);
      if (!prep.ok) continue;

      const badBatch = bmAllowedDb.batch();
      badBatch.set(bmAllowedDb.collection('suppliers').doc(prep.data.supplier.id), prep.data.supplier);
      badBatch.set(bmAllowedDb.collection('auditLogs').doc(prep.data.auditLog.id), prep.data.auditLog);
      badBatch.set(bmAllowedDb.collection('notifications').doc(prep.data.notification.id), {
        ...prep.data.notification,
        ...u.patch,
      });
      await assertFails(badBatch.commit());
    }
  });

  // Case 17: Authorized recipient delivery + strict read isolation + continued edit/delete denial for branch_manager
  await runCase('17. Single SUPPLIER_ADDED reaches ONLY authorized recipients (manager & supplier supervisor), blocks unauthorized readers, and keeps edit/delete denied', async () => {
    const prep = prepareCreateSupplier({
      userProfile: bmAllowed,
      orgId: 'org_a',
      existingSuppliers: [supExistingA],
      input: { name: 'مورد التحقق النهائي للتسليم' },
      nowIso: '2026-11-20T10:40:00Z',
    });
    assert.equal(prep.ok, true);
    if (!prep.ok) return;

    // 17a. Legitimate atomic creation succeeds with generated sortable supplierId & canonical IDs
    const okBatch = bmAllowedDb.batch();
    okBatch.set(bmAllowedDb.collection('suppliers').doc(prep.data.supplier.id), prep.data.supplier);
    okBatch.set(bmAllowedDb.collection('auditLogs').doc(prep.data.auditLog.id), prep.data.auditLog);
    okBatch.set(bmAllowedDb.collection('notifications').doc(prep.data.notification.id), prep.data.notification);
    await assertSucceeds(okBatch.commit());

    // 17b. Authorized recipients CAN read the single notification; manager CAN read the single audit log
    await assertSucceeds(mgrDb.collection('notifications').doc(prep.data.notification.id).get());
    await assertSucceeds(supYesDb.collection('notifications').doc(prep.data.notification.id).get());
    await assertSucceeds(mgrDb.collection('auditLogs').doc(prep.data.auditLog.id).get());

    // 17c. Unauthorized recipients CANNOT read the SUPPLIER_ADDED notification
    await assertFails(supNoSupDb.collection('notifications').doc(prep.data.notification.id).get());
    await assertFails(empA1Db.collection('notifications').doc(prep.data.notification.id).get());
    await assertFails(bmDeniedDb.collection('notifications').doc(prep.data.notification.id).get());

    // 17d. branch_manager STILL cannot edit, toggle, or delete the newly created supplier
    await assertFails(
      bmAllowedDb.collection('suppliers').doc(prep.data.supplier.id).update({
        name: 'محاولة تعديل بعد الإنشاء',
        updatedAt: '2026-11-20T10:41:00Z',
      })
    );
    await assertFails(
      bmAllowedDb.collection('suppliers').doc(prep.data.supplier.id).update({
        isActive: false,
        updatedAt: '2026-11-20T10:41:00Z',
      })
    );
    await assertFails(bmAllowedDb.collection('suppliers').doc(prep.data.supplier.id).delete());
  });

  await testEnv.cleanup();

  const passCount = outcomes.filter((o) => o.passed).length;
  const failCount = outcomes.filter((o) => !o.passed).length;

  console.log('\n========================================================================');
  console.log(`EMULATOR SUMMARY: ${passCount} passed, ${failCount} failed`);
  console.log('========================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runBranchManagerCreateSuppliersEmulatorTests().catch((err) => {
  console.error('Unhandled error in emulator suite:', err);
  process.exit(1);
});
