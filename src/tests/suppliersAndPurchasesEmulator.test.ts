/**
 * Supplier Management & Purchases Permissions — Real Firestore Emulator Rules Suite
 * Verifies all 11 required end-to-end scenarios directly against `firestore.rules`:
 *  1. Organization Manager: add, edit, toggle status, and delete unlinked supplier (+ auditLogs & notification)
 *  2. Supervisor WITH `canManageSuppliers`: add supplier (+ auditLog & notification)
 *  3. Supervisor: strictly DENIED editing, toggling, or deleting suppliers (and denied create without permission)
 *  4. Supervisor WITH `canManagePurchases`: enter purchases across ALL org branches using registered supplier
 *  5. Branch Manager: DENIED adding supplier
 *  6. Branch Manager: DENIED editing/toggling/deleting supplier
 *  7. Branch Manager: ALLOWED to view/select registered suppliers and enter purchase for assigned branch ONLY
 *  8. Branch Manager: DENIED entering purchase for another branch
 *  9. Regular Employee: DENIED all supplier management & all purchase entry
 * 10. Cross-org protection: Org A users cannot read/edit/delete Org B suppliers or reference Org B supplier in purchases
 * 11. Historical purchases & `legacy_unrestricted` account compatibility preserved intact
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
import {
  prepareCreateSupplier,
  prepareDeleteSupplier,
  prepareToggleSupplierStatus,
  prepareUpdateSupplier,
} from '../services/supplierService';
import { preparePurchaseSubmission } from '../services/purchaseService';
import type { Branch, Supplier, UserProfile } from '../types';

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

async function runSuppliersAndPurchasesEmulatorTests() {
  console.log('========================================================================');
  console.log('   SUPPLIERS MANAGEMENT & PURCHASES PERMISSIONS EMULATOR RULES SUITE    ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-suppliers-mgmt-tests',
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
  const brLegacy1: Branch = {
    id: 'br_leg1',
    orgId: 'org_legacy',
    name: 'فرع الحساب القديم',
    code: 'L-01',
    isActive: true,
    createdAt: '2025-05-01T08:00:00Z',
  };

  const supA1: Supplier = {
    id: 'sup_a1',
    orgId: 'org_a',
    name: 'شركة الرواد للتوريد',
    taxNumber: '310101010100003',
    phone: '0551112233',
    isActive: true,
    createdBy: 'uid_mgr_a',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
  };

  const supB1: Supplier = {
    id: 'sup_b1',
    orgId: 'org_b',
    name: 'شركة التوريد الأخرى',
    taxNumber: '310202020200003',
    phone: '0502223344',
    isActive: true,
    createdBy: 'uid_mgr_b',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
  };

  const mgrA: UserProfile = {
    uid: 'uid_mgr_a',
    orgId: 'org_a',
    email: 'mgr.a@example.com',
    displayName: 'مدير المؤسسة أ',
    role: 'manager',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('manager'),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const mgrB: UserProfile = {
    uid: 'uid_mgr_b',
    orgId: 'org_b',
    email: 'mgr.b@example.com',
    displayName: 'مدير المؤسسة ب',
    role: 'manager',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('manager'),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const supYes: UserProfile = {
    uid: 'uid_sup_yes',
    orgId: 'org_a',
    email: 'sup.yes@example.com',
    displayName: 'مسؤول الموردين والمشتريات',
    role: 'supervisor',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('supervisor', {
      canManageSuppliers: true,
      canManagePurchases: true,
      canViewSuppliers: true,
    }),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const supNo: UserProfile = {
    uid: 'uid_sup_no',
    orgId: 'org_a',
    email: 'sup.no@example.com',
    displayName: 'مسؤول بدون موردين',
    role: 'supervisor',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('supervisor', {
      canManageSuppliers: false,
      canManagePurchases: false,
      canViewSuppliers: true,
    }),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const bmA1: UserProfile = {
    uid: 'uid_bm_a1',
    orgId: 'org_a',
    email: 'bm.a1@example.com',
    displayName: 'مسؤول فرع أ الأول',
    role: 'branch_manager',
    branchId: 'br_a1',
    branchIds: ['br_a1'],
    isActive: true,
    permissions: buildDefaultPermissionsForRole('branch_manager'),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const empA1: UserProfile = {
    uid: 'uid_emp_a1',
    orgId: 'org_a',
    email: 'emp.a1@example.com',
    displayName: 'موظف عادي',
    role: 'employee',
    branchId: 'br_a1',
    branchIds: ['br_a1'],
    isActive: true,
    permissions: buildDefaultPermissionsForRole('employee'),
    createdAt: '2026-11-01T08:00:00Z',
  };

  const mgrLegacy: UserProfile = {
    uid: 'uid_mgr_legacy',
    orgId: 'org_legacy',
    email: 'adartalmtm@gmail.com',
    displayName: 'مدير الحساب القديم',
    role: 'manager',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('manager'),
    createdAt: '2025-05-01T08:00:00Z',
  };

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await db.doc('organizations/org_a').set({
      id: 'org_a',
      name: 'مؤسسة الإقفال أ',
      currency: 'SAR',
      ownerId: 'uid_mgr_a',
      isActive: true,
      subscriptionStatus: 'active',
      subscriptionPlan: '1y',
      subscriptionStartAt: tsPast5d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
    });

    await db.doc('organizations/org_b').set({
      id: 'org_b',
      name: 'مؤسسة ب',
      currency: 'SAR',
      ownerId: 'uid_mgr_b',
      isActive: true,
      subscriptionStatus: 'active',
      subscriptionPlan: '1y',
      subscriptionStartAt: tsPast5d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
    });

    // Legacy unrestricted org without subscription fields
    await db.doc('organizations/org_legacy').set({
      id: 'org_legacy',
      name: 'مؤسسة الحساب القديم',
      currency: 'SAR',
      ownerId: 'uid_mgr_legacy',
      isActive: true,
      createdAt: '2025-05-01T08:00:00Z',
    });

    for (const u of [mgrA, mgrB, supYes, supNo, bmA1, empA1, mgrLegacy]) {
      await db.doc(`users/${u.uid}`).set(u);
    }

    for (const b of [brA1, brA2, brLegacy1]) {
      await db.doc(`branches/${b.id}`).set(b);
    }

    await db.doc('suppliers/sup_a1').set(supA1);
    await db.doc('suppliers/sup_b1').set(supB1);

    // Seed a historical purchase linked to sup_a1 to verify historical invoice integrity
    await db.doc('purchases/pur_hist_a1').set({
      id: 'pur_hist_a1',
      orgId: 'org_a',
      branchId: 'br_a1',
      supplierId: 'sup_a1',
      date: '2026-11-10',
      invoiceNumber: 'HIST-001',
      amount: 100,
      subtotalAmount: 100,
      discountAmount: 0,
      vatRate: 15,
      vatAmount: 15,
      totalAmount: 115,
      paymentMethod: 'cash',
      items: [
        { id: 'item_0', name: 'بند تاريخي', quantity: 2, unitPrice: 50, total: 100 },
      ],
      attachmentIds: [],
      createdBy: 'uid_mgr_a',
      createdByRole: 'manager',
      createdAt: '2026-11-10T10:00:00Z',
      updatedAt: '2026-11-10T10:00:00Z',
    });
  });

  const mgrADb = testEnv.authenticatedContext(mgrA.uid, { email: mgrA.email }).firestore();
  const supYesDb = testEnv.authenticatedContext(supYes.uid, { email: supYes.email }).firestore();
  const supNoDb = testEnv.authenticatedContext(supNo.uid, { email: supNo.email }).firestore();
  const bmA1Db = testEnv.authenticatedContext(bmA1.uid, { email: bmA1.email }).firestore();
  const empA1Db = testEnv.authenticatedContext(empA1.uid, { email: empA1.email }).firestore();
  const mgrLegacyDb = testEnv.authenticatedContext(mgrLegacy.uid, { email: mgrLegacy.email }).firestore();

  const outcomes: TestOutcome[] = [];
  async function runCase(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      outcomes.push({ name, passed: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [FAIL] ${name}:\n         ${msg}`);
      outcomes.push({ name, passed: false, error: msg });
    }
  }

  async function commitPreparedPurchase(
    db: firebase.firestore.Firestore,
    prepared: ReturnType<typeof preparePurchaseSubmission>
  ) {
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const { purchase, subItems, attachments, auditLog, notification } = prepared.data;
    const batch = db.batch();
    batch.set(db.doc(`purchases/${purchase.id}`), purchase);
    for (const item of subItems) {
      batch.set(db.doc(`purchases/${purchase.id}/items/${item.id}`), item);
    }
    for (const att of attachments) {
      batch.set(db.doc(`attachments/${att.id}`), att);
    }
    batch.set(db.doc(`auditLogs/${auditLog.id}`), auditLog);
    batch.set(db.doc(`notifications/${notification.id}`), notification);
    await batch.commit();
  }

  // Scenario 1: Manager adds, edits, toggles, and deletes unlinked supplier with atomic audit logs
  await runCase('1. Manager adds, edits, toggles status, and deletes unlinked supplier atomically with audit logs & notification', async () => {
    const created = prepareCreateSupplier({
      userProfile: mgrA,
      orgId: 'org_a',
      input: {
        name: 'شركة التوريد الماسية',
        taxNumber: '310777888900003',
        phone: '0557778899',
        address: 'الرياض - العليا',
        notes: 'توريد أسبوعي',
        openingBalance: 1000,
      },
      existingSuppliers: [supA1],
      supplierId: 'sup_mgr_lifecycle',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const createBatch = mgrADb.batch();
    createBatch.set(mgrADb.doc(`suppliers/${created.data.supplier.id}`), created.data.supplier);
    createBatch.set(mgrADb.doc(`auditLogs/${created.data.auditLog.id}`), created.data.auditLog);
    createBatch.set(mgrADb.doc(`notifications/${created.data.notification.id}`), created.data.notification);
    await assertSucceeds(createBatch.commit());

    // Edit supplier + SUPPLIER_UPDATED audit log
    const updated = prepareUpdateSupplier({
      userProfile: mgrA,
      orgId: 'org_a',
      targetSupplier: created.data.supplier,
      input: {
        name: 'شركة التوريد الماسية المحدودة',
        taxNumber: '310777888900003',
        phone: '0550001122',
        address: 'جدة',
      },
      existingSuppliers: [supA1, created.data.supplier],
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;

    const patch: Record<string, any> = { ...updated.data.patch };
    for (const k of updated.data.clearedOptionalKeys) {
      patch[k] = firebase.firestore.FieldValue.delete();
    }
    const updBatch = mgrADb.batch();
    updBatch.update(mgrADb.doc(`suppliers/${updated.data.supplierId}`), patch);
    updBatch.set(mgrADb.doc(`auditLogs/${updated.data.auditLog.id}`), updated.data.auditLog);
    await assertSucceeds(updBatch.commit());

    // Toggle status + SUPPLIER_STATUS_TOGGLED audit log
    const toggled = prepareToggleSupplierStatus({
      userProfile: mgrA,
      orgId: 'org_a',
      targetSupplier: updated.data.updatedSupplier,
      nextIsActive: false,
    });
    assert.equal(toggled.ok, true);
    if (!toggled.ok) return;

    const tglBatch = mgrADb.batch();
    tglBatch.update(mgrADb.doc(`suppliers/${toggled.data.supplierId}`), {
      isActive: false,
      updatedAt: toggled.data.updatedAt,
    });
    tglBatch.set(mgrADb.doc(`auditLogs/${toggled.data.auditLog.id}`), toggled.data.auditLog);
    await assertSucceeds(tglBatch.commit());

    // Delete unlinked supplier + atomic SUPPLIER_DELETED audit log
    const deleted = prepareDeleteSupplier({
      userProfile: mgrA,
      orgId: 'org_a',
      targetSupplier: { ...updated.data.updatedSupplier, isActive: false },
      linkedPurchasesCount: 0,
    });
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;

    const delBatch = mgrADb.batch();
    delBatch.delete(mgrADb.doc(`suppliers/${deleted.data.supplierId}`));
    delBatch.set(mgrADb.doc(`auditLogs/${deleted.data.auditLog.id}`), deleted.data.auditLog);
    await assertSucceeds(delBatch.commit());

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const verifySnap = await ctx.firestore().doc(`suppliers/${deleted.data.supplierId}`).get();
      assert.equal(verifySnap.exists, false);
    });
  });

  // Scenarios 2 & 3: Supervisor with canManageSuppliers adds supplier ONLY, strictly denied edit/toggle/delete
  let supCreatedSupplier: Supplier | null = null;
  await runCase('2 & 3. Supervisor WITH canManageSuppliers adds supplier, strictly DENIED edit/toggle/delete; Supervisor WITHOUT permission denied add', async () => {
    const created = prepareCreateSupplier({
      userProfile: supYes,
      orgId: 'org_a',
      input: {
        name: 'مورد المسؤول المعتمد',
        taxNumber: '310333444500003',
        phone: '0541231234',
      },
      existingSuppliers: [supA1],
      supplierId: 'sup_created_by_sup',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    supCreatedSupplier = created.data.supplier;

    const batch = supYesDb.batch();
    batch.set(supYesDb.doc(`suppliers/${created.data.supplier.id}`), created.data.supplier);
    batch.set(supYesDb.doc(`auditLogs/${created.data.auditLog.id}`), created.data.auditLog);
    batch.set(supYesDb.doc(`notifications/${created.data.notification.id}`), created.data.notification);
    await assertSucceeds(batch.commit());

    // Supervisor CANNOT edit name/fields of even their own newly created supplier
    await assertFails(
      supYesDb.doc('suppliers/sup_created_by_sup').update({
        name: 'تعديل مرفوض من المسؤول',
        updatedAt: '2026-11-18T12:00:00Z',
      })
    );

    // Supervisor CANNOT toggle isActive
    await assertFails(
      supYesDb.doc('suppliers/sup_created_by_sup').update({
        isActive: false,
        updatedAt: '2026-11-18T12:01:00Z',
      })
    );

    // Supervisor CANNOT delete supplier
    await assertFails(supYesDb.doc('suppliers/sup_created_by_sup').delete());

    // Supervisor WITHOUT canManageSuppliers CANNOT create supplier
    await assertFails(
      supNoDb.doc('suppliers/sup_unauthorized').set({
        id: 'sup_unauthorized',
        orgId: 'org_a',
        name: 'مورد مرفوض بدون صلاحية',
        isActive: true,
        createdBy: supNo.uid,
        createdAt: '2026-11-18T12:05:00Z',
        updatedAt: '2026-11-18T12:05:00Z',
      })
    );
  });

  // Scenario 4: Supervisor with canManagePurchases enters purchases across ALL branches using newly added supplier
  await runCase('4. Supervisor WITH canManagePurchases enters purchases across ALL org branches selecting registered supplier', async () => {
    assert.ok(supCreatedSupplier, 'Expected supervisor-created supplier to exist');
    for (const [idx, branch] of [brA1, brA2].entries()) {
      const prep = preparePurchaseSubmission({
        userProfile: supYes,
        orgId: 'org_a',
        currency: 'SAR',
        branch,
        supplier: supCreatedSupplier!,
        date: '2026-11-18',
        invoiceNumber: `SUP-BR-${idx + 1}`,
        paymentMethod: 'transfer',
        items: [
          { name: 'مواد تعبئة', quantity: 5, unitPrice: 40 },
          { name: 'أكواب ورقية', quantity: 10, unitPrice: 12.5 },
        ],
        vatRate: 15,
        purchaseId: `pur_sup_br_${idx + 1}`,
      });
      await assertSucceeds(commitPreparedPurchase(supYesDb, prep));
    }
  });

  // Scenarios 5 & 6: Branch Manager denied creating, editing, toggling, or deleting suppliers
  await runCase('5 & 6. Branch Manager is DENIED creating, editing, toggling, or deleting suppliers', async () => {
    await assertFails(
      bmA1Db.doc('suppliers/sup_by_bm').set({
        id: 'sup_by_bm',
        orgId: 'org_a',
        name: 'مورد من مسؤول فرع',
        isActive: true,
        createdBy: bmA1.uid,
        createdAt: '2026-11-18T13:00:00Z',
        updatedAt: '2026-11-18T13:00:00Z',
      })
    );

    await assertFails(
      bmA1Db.doc('suppliers/sup_a1').update({
        name: 'تعديل مرفوض من مسؤول فرع',
        updatedAt: '2026-11-18T13:01:00Z',
      })
    );

    await assertFails(
      bmA1Db.doc('suppliers/sup_a1').update({
        isActive: false,
        updatedAt: '2026-11-18T13:02:00Z',
      })
    );

    await assertFails(bmA1Db.doc('suppliers/sup_a1').delete());
  });

  // Scenarios 7 & 8: Branch Manager selects registered supplier for own branch ONLY, denied on other branch
  await runCase('7 & 8. Branch Manager reads registered org suppliers, enters purchase in assigned branch ONLY, DENIED in other branch', async () => {
    const supSnap = await assertSucceeds(
      bmA1Db.collection('suppliers').where('orgId', '==', 'org_a').get()
    );
    assert.ok(supSnap.size >= 2);

    // Assigned branch br_a1 -> ALLOWED
    const okOwn = preparePurchaseSubmission({
      userProfile: bmA1,
      orgId: 'org_a',
      currency: 'SAR',
      branch: brA1,
      supplier: supA1,
      date: '2026-11-18',
      invoiceNumber: 'BM-A1-001',
      paymentMethod: 'cash',
      items: [{ name: 'حليب طازج', quantity: 8, unitPrice: 15 }],
      vatRate: 15,
      purchaseId: 'pur_bm_a1_ok',
    });
    await assertSucceeds(commitPreparedPurchase(bmA1Db, okOwn));

    // Unassigned branch br_a2 -> DENIED directly at Firestore rules layer
    await assertFails(
      bmA1Db.doc('purchases/pur_bm_a2_denied').set({
        id: 'pur_bm_a2_denied',
        orgId: 'org_a',
        branchId: 'br_a2',
        supplierId: 'sup_a1',
        date: '2026-11-18',
        amount: 100,
        subtotalAmount: 100,
        discountAmount: 0,
        vatRate: 15,
        vatAmount: 15,
        totalAmount: 115,
        paymentMethod: 'cash',
        items: [],
        attachmentIds: [],
        createdBy: bmA1.uid,
        createdByRole: 'branch_manager',
        createdAt: '2026-11-18T13:15:00Z',
        updatedAt: '2026-11-18T13:15:00Z',
      })
    );
  });

  // Scenario 9: Regular Employee denied all supplier management & purchase entry
  await runCase('9. Regular Employee is DENIED reading/creating/updating/deleting suppliers AND entering/reading purchases', async () => {
    await assertFails(empA1Db.doc('suppliers/sup_a1').get());
    await assertFails(empA1Db.collection('suppliers').where('orgId', '==', 'org_a').get());
    await assertFails(
      empA1Db.doc('suppliers/sup_by_emp').set({
        id: 'sup_by_emp',
        orgId: 'org_a',
        name: 'مورد موظف',
        isActive: true,
        createdBy: empA1.uid,
        createdAt: '2026-11-18T13:20:00Z',
        updatedAt: '2026-11-18T13:20:00Z',
      })
    );
    await assertFails(empA1Db.doc('suppliers/sup_a1').update({ name: 'تعديل موظف', updatedAt: '2026-11-18T13:21:00Z' }));
    await assertFails(empA1Db.doc('suppliers/sup_a1').delete());

    await assertFails(empA1Db.doc('purchases/pur_hist_a1').get());
    await assertFails(
      empA1Db.doc('purchases/pur_by_emp').set({
        id: 'pur_by_emp',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a1',
        date: '2026-11-18',
        amount: 50,
        subtotalAmount: 50,
        discountAmount: 0,
        vatRate: 0,
        vatAmount: 0,
        totalAmount: 50,
        paymentMethod: 'cash',
        items: [],
        attachmentIds: [],
        createdBy: empA1.uid,
        createdByRole: 'employee',
        createdAt: '2026-11-18T13:22:00Z',
        updatedAt: '2026-11-18T13:22:00Z',
      })
    );
  });

  // Scenario 10: Cross-org isolation for suppliers & purchases
  await runCase('10. Cross-org isolation: Org A cannot read/edit/delete Org B suppliers or link Org B supplier in Org A purchase', async () => {
    await assertFails(mgrADb.doc('suppliers/sup_b1').get());
    await assertFails(mgrADb.collection('suppliers').where('orgId', '==', 'org_b').get());
    await assertFails(
      mgrADb.doc('suppliers/sup_b1').update({ name: 'اختراق مؤسسة أخرى', updatedAt: '2026-11-18T13:30:00Z' })
    );
    await assertFails(mgrADb.doc('suppliers/sup_b1').delete());
    await assertFails(bmA1Db.doc('suppliers/sup_b1').get());
    await assertFails(supYesDb.doc('suppliers/sup_b1').get());

    // Org A manager cannot create a purchase referencing Org B's supplierId
    await assertFails(
      mgrADb.doc('purchases/pur_cross_org_sup').set({
        id: 'pur_cross_org_sup',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_b1',
        date: '2026-11-18',
        amount: 100,
        subtotalAmount: 100,
        discountAmount: 0,
        vatRate: 15,
        vatAmount: 15,
        totalAmount: 115,
        paymentMethod: 'cash',
        items: [],
        attachmentIds: [],
        createdBy: mgrA.uid,
        createdByRole: 'manager',
        createdAt: '2026-11-18T13:35:00Z',
        updatedAt: '2026-11-18T13:35:00Z',
      })
    );
  });

  // Scenario 11: Historical purchases stay intact on supplier deactivation + legacy_unrestricted org remains fully operational
  await runCase('11. Deactivating supplier preserves historical purchases & blocks new ones; legacy_unrestricted account works seamlessly', async () => {
    // Deactivate sup_a1 (which has historical purchase pur_hist_a1)
    await assertSucceeds(
      mgrADb.doc('suppliers/sup_a1').update({
        isActive: false,
        updatedAt: '2026-11-18T14:00:00Z',
      })
    );

    // Historical purchase linked to deactivated supplier remains readable & editable (notes)
    const histSnap = await assertSucceeds(mgrADb.doc('purchases/pur_hist_a1').get());
    assert.equal(histSnap.data()?.supplierId, 'sup_a1');
    await assertSucceeds(
      mgrADb.doc('purchases/pur_hist_a1').update({
        notes: 'الفاتورة التاريخية محفوظة بعد إيقاف المورد',
        updatedAt: '2026-11-18T14:01:00Z',
      })
    );

    // Creating a NEW purchase with deactivated sup_a1 is blocked by firestore.rules
    await assertFails(
      mgrADb.doc('purchases/pur_with_deactivated_sup').set({
        id: 'pur_with_deactivated_sup',
        orgId: 'org_a',
        branchId: 'br_a1',
        supplierId: 'sup_a1',
        date: '2026-11-18',
        amount: 100,
        subtotalAmount: 100,
        discountAmount: 0,
        vatRate: 15,
        vatAmount: 15,
        totalAmount: 115,
        paymentMethod: 'cash',
        items: [],
        attachmentIds: [],
        createdBy: mgrA.uid,
        createdByRole: 'manager',
        createdAt: '2026-11-18T14:02:00Z',
        updatedAt: '2026-11-18T14:02:00Z',
      })
    );

    // Legacy unrestricted org (adartalmtm@gmail.com) can create, edit, delete unlinked supplier, and record purchase
    const legSup = prepareCreateSupplier({
      userProfile: mgrLegacy,
      orgId: 'org_legacy',
      input: { name: 'مورد الحساب القديم', phone: '0500001111' },
      supplierId: 'sup_legacy_active',
    });
    assert.equal(legSup.ok, true);
    if (!legSup.ok) return;

    const legCreate = mgrLegacyDb.batch();
    legCreate.set(mgrLegacyDb.doc(`suppliers/${legSup.data.supplier.id}`), legSup.data.supplier);
    legCreate.set(mgrLegacyDb.doc(`auditLogs/${legSup.data.auditLog.id}`), legSup.data.auditLog);
    legCreate.set(mgrLegacyDb.doc(`notifications/${legSup.data.notification.id}`), legSup.data.notification);
    await assertSucceeds(legCreate.commit());

    const legPurchase = preparePurchaseSubmission({
      userProfile: mgrLegacy,
      orgId: 'org_legacy',
      currency: 'SAR',
      branch: brLegacy1,
      supplier: legSup.data.supplier,
      date: '2026-11-18',
      paymentMethod: 'cash',
      items: [{ name: 'بند الحساب القديم', quantity: 1, unitPrice: 250 }],
      vatRate: 15,
      purchaseId: 'pur_legacy_ok',
    });
    await assertSucceeds(commitPreparedPurchase(mgrLegacyDb, legPurchase));

    // Legacy manager deletes a disposable unlinked supplier atomically
    const legTemp = prepareCreateSupplier({
      userProfile: mgrLegacy,
      orgId: 'org_legacy',
      input: { name: 'مورد قديم مؤقت' },
      supplierId: 'sup_legacy_temp',
    });
    assert.equal(legTemp.ok, true);
    if (!legTemp.ok) return;

    await assertSucceeds(mgrLegacyDb.doc('suppliers/sup_legacy_temp').set(legTemp.data.supplier));
    const legDel = prepareDeleteSupplier({
      userProfile: mgrLegacy,
      orgId: 'org_legacy',
      targetSupplier: legTemp.data.supplier,
      linkedPurchasesCount: 0,
    });
    assert.equal(legDel.ok, true);
    if (!legDel.ok) return;

    const legDelBatch = mgrLegacyDb.batch();
    legDelBatch.delete(mgrLegacyDb.doc('suppliers/sup_legacy_temp'));
    legDelBatch.set(mgrLegacyDb.doc(`auditLogs/${legDel.data.auditLog.id}`), legDel.data.auditLog);
    await assertSucceeds(legDelBatch.commit());
  });

  await testEnv.cleanup();

  const passedCount = outcomes.filter((o) => o.passed).length;
  const failedCount = outcomes.length - passedCount;
  console.log('\n========================================================================');
  console.log(`   EMULATOR SUMMARY: ${passedCount}/${outcomes.length} passed, ${failedCount} failed`);
  console.log('========================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSuppliersAndPurchasesEmulatorTests().catch((err) => {
  console.error('Fatal emulator test error:', err);
  process.exit(1);
});
