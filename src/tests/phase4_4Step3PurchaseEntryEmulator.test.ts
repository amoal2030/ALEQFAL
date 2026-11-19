/**
 * Phase 4.4 Step 3 (Purchase Invoice Entry) Firestore Security Rules Emulator Test Suite
 * Verifies real `firestore.rules` enforcement for:
 * - Atomic 100-item subcollection (`/purchases/{purchaseId}/items/item_0..item_99`) + multi-attachment commits
 * - Role & branch isolation (manager, supervisor, branch_manager, employee)
 * - Branch manager inability to create/update suppliers
 * - Subcollection hardening (item_100 cap, itemId == 'item_' + lineIndex, Halala total match,
 *   orphan item block, cross-org/cross-branch block, immutable update/delete)
 * - Legacy unrestricted account compatibility (`adartalmtm@gmail.com`)
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

async function runPhase44Step3EmulatorTests() {
  console.log('========================================================================');
  console.log('   PHASE 4.4 STEP 3: PURCHASE ENTRY (100 ITEMS & MULTI-ATTACH) SUITE    ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-phase44-step3-tests',
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
    id: 'br_legacy_1',
    orgId: 'org_legacy',
    name: 'فرع المؤسسة القديمة',
    code: 'L-01',
    isActive: true,
    createdAt: '2025-06-01T08:00:00Z',
  };

  const supA1: Supplier = {
    id: 'sup_a1',
    orgId: 'org_a',
    name: 'شركة النخبة للتوريد',
    taxNumber: '310111222300003',
    isActive: true,
    createdBy: 'uid_mgr_a',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
  };
  const supLegacy1: Supplier = {
    id: 'sup_legacy_1',
    orgId: 'org_legacy',
    name: 'مورد المؤسسة القديمة',
    taxNumber: '310999888700003',
    isActive: true,
    createdBy: 'uid_mgr_legacy',
    createdAt: '2025-06-01T08:00:00Z',
    updatedAt: '2025-06-01T08:00:00Z',
  };

  const mgrA: UserProfile = {
    uid: 'uid_mgr_a',
    orgId: 'org_a',
    email: 'mgr.a@example.com',
    displayName: 'مدير أ',
    role: 'manager',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('manager'),
    createdAt: '2026-11-01T08:00:00Z',
  };
  const supAllowedA: UserProfile = {
    uid: 'uid_sup_ok_a',
    orgId: 'org_a',
    email: 'sup.ok@example.com',
    displayName: 'مشرف مشتريات أ',
    role: 'supervisor',
    isActive: true,
    permissions: {
      ...buildDefaultPermissionsForRole('supervisor'),
      canManagePurchases: true,
      canViewSuppliers: true,
    },
    createdAt: '2026-11-01T08:00:00Z',
  };
  const supDeniedA: UserProfile = {
    uid: 'uid_sup_no_a',
    orgId: 'org_a',
    email: 'sup.no@example.com',
    displayName: 'مشرف بلا مشتريات أ',
    role: 'supervisor',
    isActive: true,
    permissions: {
      ...buildDefaultPermissionsForRole('supervisor'),
      canManagePurchases: false,
      canViewSuppliers: true,
    },
    createdAt: '2026-11-01T08:00:00Z',
  };
  const bmA1: UserProfile = {
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
  };
  const empA1: UserProfile = {
    uid: 'uid_emp_a1',
    orgId: 'org_a',
    email: 'emp.a1@example.com',
    displayName: 'موظف فرع أ1',
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
    displayName: 'مدير قديم معفى',
    role: 'manager',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('manager'),
    createdAt: '2025-06-01T08:00:00Z',
  };

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.doc('organizations/org_a').set({
      id: 'org_a',
      name: 'مؤسسة أ الحديثة',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: mgrA.uid,
      ownerEmail: mgrA.email,
      ownerName: mgrA.displayName,
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast5d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });

    await db.doc('organizations/org_legacy').set({
      id: 'org_legacy',
      name: 'مؤسسة قديمة معفاة',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: mgrLegacy.uid,
      ownerEmail: mgrLegacy.email,
      ownerName: mgrLegacy.displayName,
      driveConnected: false,
      createdAt: '2025-06-01T08:00:00Z',
      updatedAt: '2025-06-01T08:00:00Z',
    });

    await db.doc('branches/br_a1').set(brA1);
    await db.doc('branches/br_a2').set(brA2);
    await db.doc('branches/br_legacy_1').set(brLegacy1);

    await db.doc('suppliers/sup_a1').set(supA1);
    await db.doc('suppliers/sup_legacy_1').set(supLegacy1);

    await db.doc(`users/${mgrA.uid}`).set(mgrA);
    await db.doc(`users/${supAllowedA.uid}`).set(supAllowedA);
    await db.doc(`users/${supDeniedA.uid}`).set(supDeniedA);
    await db.doc(`users/${bmA1.uid}`).set(bmA1);
    await db.doc(`users/${empA1.uid}`).set(empA1);
    await db.doc(`users/${mgrLegacy.uid}`).set(mgrLegacy);
  });

  const outcomes: TestOutcome[] = [];
  async function runCase(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      outcomes.push({ name, passed: true });
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ name, passed: false, error: msg });
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${msg}`);
    }
  }

  function commitPreparedBatch(
    db: firebase.firestore.Firestore,
    prepared: ReturnType<typeof preparePurchaseSubmission>
  ) {
    if (!prepared.ok) {
      assert.fail(`Expected preparePurchaseSubmission to succeed: ${prepared.error}`);
    }
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
    return batch.commit();
  }

  const mgrADb = testEnv.authenticatedContext(mgrA.uid, { email: mgrA.email }).firestore();
  const supOkDb = testEnv.authenticatedContext(supAllowedA.uid, { email: supAllowedA.email }).firestore();
  const supNoDb = testEnv.authenticatedContext(supDeniedA.uid, { email: supDeniedA.email }).firestore();
  const bmA1Db = testEnv.authenticatedContext(bmA1.uid, { email: bmA1.email }).firestore();
  const empA1Db = testEnv.authenticatedContext(empA1.uid, { email: empA1.email }).firestore();
  const mgrLegacyDb = testEnv.authenticatedContext(mgrLegacy.uid, { email: mgrLegacy.email }).firestore();

  await runCase('1. Manager atomically saves 100-item invoice + 5 attachments + auditLog + notification and reads items back', async () => {
    const items100 = Array.from({ length: 100 }, (_, i) => ({
      name: `صنف اختبار ${i + 1}`,
      quantity: (i % 3) + 1,
      unitPrice: 10.25,
    }));
    const attachments5 = Array.from({ length: 5 }, (_, i) => ({
      fileName: i === 4 ? `tax_invoice_${i}.pdf` : `photo_${i}.jpg`,
      fileSize: 150_000 + i * 1000,
      mimeType: i === 4 ? 'application/pdf' : 'image/jpeg',
    }));

    const prepared = preparePurchaseSubmission({
      userProfile: mgrA,
      orgId: 'org_a',
      currency: 'SAR',
      branch: brA2,
      supplier: supA1,
      date: '2026-11-18',
      invoiceNumber: 'INV-100',
      taxNumber: supA1.taxNumber,
      paymentMethod: 'transfer',
      items: items100,
      discountAmount: 25,
      vatRate: 15,
      attachments: attachments5,
      purchaseId: 'pur_mgr_100',
    });

    await assertSucceeds(commitPreparedBatch(mgrADb, prepared));

    const itemsSnap = await assertSucceeds(
      mgrADb.collection('purchases/pur_mgr_100/items').get()
    );
    assert.equal(itemsSnap.size, 100);

    const singleItem = await assertSucceeds(
      mgrADb.doc('purchases/pur_mgr_100/items/item_99').get()
    );
    assert.equal(singleItem.exists, true);
    assert.equal(singleItem.data()?.lineIndex, 99);

    const linkedAttachmentsSnap = await assertSucceeds(
      mgrADb
        .collection('attachments')
        .where('orgId', '==', 'org_a')
        .where('purchaseId', '==', 'pur_mgr_100')
        .get()
    );
    assert.equal(linkedAttachmentsSnap.size, 5);
  });

  await runCase('2. Authorized Supervisor saves multi-item invoice on any org branch; unauthorized Supervisor is DENIED', async () => {
    const preparedOk = preparePurchaseSubmission({
      userProfile: supAllowedA,
      orgId: 'org_a',
      currency: 'SAR',
      branch: brA2,
      supplier: supA1,
      date: '2026-11-18',
      paymentMethod: 'card',
      items: [
        { name: 'صنف مشرف 1', quantity: 3, unitPrice: 40 },
        { name: 'صنف مشرف 2', quantity: 2, unitPrice: 15.5 },
      ],
      vatRate: 15,
      purchaseId: 'pur_sup_ok',
    });
    await assertSucceeds(commitPreparedBatch(supOkDb, preparedOk));

    // Attempt direct batch write by unauthorized supervisor (bypassing client validation)
    const nowIso = '2026-11-18T12:00:00.000Z';
    const badBatch = supNoDb.batch();
    badBatch.set(supNoDb.doc('purchases/pur_sup_denied'), {
      id: 'pur_sup_denied',
      orgId: 'org_a',
      branchId: 'br_a1',
      branchName: brA1.name,
      supplierId: supA1.id,
      supplierName: supA1.name,
      date: '2026-11-18',
      amount: 100,
      subtotalAmount: 100,
      discountAmount: 0,
      vatRate: 15,
      vatAmount: 15,
      totalAmount: 115,
      paymentMethod: 'cash',
      createdBy: supDeniedA.uid,
      createdByName: supDeniedA.displayName,
      createdByRole: 'supervisor',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    badBatch.set(supNoDb.doc('purchases/pur_sup_denied/items/item_0'), {
      id: 'item_0',
      purchaseId: 'pur_sup_denied',
      orgId: 'org_a',
      branchId: 'br_a1',
      lineIndex: 0,
      name: 'صنف غير مصرح',
      quantity: 1,
      unitPrice: 100,
      total: 100,
      createdBy: supDeniedA.uid,
      createdAt: nowIso,
    });
    await assertFails(badBatch.commit());
  });

  await runCase('3. Branch Manager saves multi-item + 3 attachments on assigned branch (br_a1), DENIED on br_a2, and DENIED creating/updating suppliers', async () => {
    const preparedOwn = preparePurchaseSubmission({
      userProfile: bmA1,
      orgId: 'org_a',
      currency: 'SAR',
      branch: brA1,
      supplier: supA1,
      date: '2026-11-18',
      paymentMethod: 'cash',
      items: [
        { name: 'صنف فرع 1', quantity: 4, unitPrice: 12.5 },
        { name: 'صنف فرع 2', quantity: 2, unitPrice: 25 },
        { name: 'صنف فرع 3', quantity: 1, unitPrice: 10 },
      ],
      attachments: [
        { fileName: 'b1.png', fileSize: 50_000, mimeType: 'image/png' },
        { fileName: 'b2.jpg', fileSize: 60_000, mimeType: 'image/jpeg' },
        { fileName: 'b3.pdf', fileSize: 90_000, mimeType: 'application/pdf' },
      ],
      vatRate: 15,
      purchaseId: 'pur_bm_a1_ok',
    });
    await assertSucceeds(commitPreparedBatch(bmA1Db, preparedOwn));

    // Branch manager reads & lists own branch items -> allowed
    await assertSucceeds(bmA1Db.doc('purchases/pur_bm_a1_ok/items/item_0').get());
    const ownItemsSnap = await assertSucceeds(
      bmA1Db.collection('purchases/pur_bm_a1_ok/items').get()
    );
    assert.equal(ownItemsSnap.size, 3);
    // Branch manager reads or lists another branch's purchase items -> denied
    await assertFails(bmA1Db.doc('purchases/pur_mgr_100/items/item_0').get());
    await assertFails(bmA1Db.collection('purchases/pur_mgr_100/items').get());

    // Branch manager tries to write purchase for br_a2 -> denied
    const nowIso = '2026-11-18T12:00:00.000Z';
    const crossBranchBatch = bmA1Db.batch();
    crossBranchBatch.set(bmA1Db.doc('purchases/pur_bm_wrong_branch'), {
      id: 'pur_bm_wrong_branch',
      orgId: 'org_a',
      branchId: 'br_a2',
      branchName: brA2.name,
      supplierId: supA1.id,
      supplierName: supA1.name,
      date: '2026-11-18',
      amount: 50,
      subtotalAmount: 50,
      discountAmount: 0,
      vatRate: 15,
      vatAmount: 7.5,
      totalAmount: 57.5,
      paymentMethod: 'cash',
      createdBy: bmA1.uid,
      createdByName: bmA1.displayName,
      createdByRole: 'branch_manager',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    crossBranchBatch.set(bmA1Db.doc('purchases/pur_bm_wrong_branch/items/item_0'), {
      id: 'item_0',
      purchaseId: 'pur_bm_wrong_branch',
      orgId: 'org_a',
      branchId: 'br_a2',
      lineIndex: 0,
      name: 'صنف متجاوز للفرع',
      quantity: 1,
      unitPrice: 50,
      total: 50,
      createdBy: bmA1.uid,
      createdAt: nowIso,
    });
    await assertFails(crossBranchBatch.commit());

    // Branch manager tries to create a new supplier -> denied
    await assertFails(
      bmA1Db.doc('suppliers/sup_bm_illegal').set({
        id: 'sup_bm_illegal',
        orgId: 'org_a',
        name: 'مورد غير مصرح',
        isActive: true,
        createdAt: nowIso,
      })
    );

    // Branch manager tries to update an existing supplier -> denied
    await assertFails(
      bmA1Db.doc('suppliers/sup_a1').update({ name: 'اسم معدل' })
    );

    // Branch manager tries to delete an existing supplier -> denied
    await assertFails(
      bmA1Db.doc('suppliers/sup_a1').delete()
    );
  });

  await runCase('4. Regular Employee is DENIED creating or reading purchases, subcollection items, and attachments', async () => {
    const nowIso = '2026-11-18T12:00:00.000Z';
    await assertFails(empA1Db.doc('purchases/pur_bm_a1_ok').get());
    await assertFails(empA1Db.doc('purchases/pur_bm_a1_ok/items/item_0').get());
    await assertFails(empA1Db.collection('purchases/pur_bm_a1_ok/items').get());

    const empBatch = empA1Db.batch();
    empBatch.set(empA1Db.doc('purchases/pur_emp_illegal'), {
      id: 'pur_emp_illegal',
      orgId: 'org_a',
      branchId: 'br_a1',
      branchName: brA1.name,
      supplierId: supA1.id,
      supplierName: supA1.name,
      date: '2026-11-18',
      amount: 10,
      subtotalAmount: 10,
      discountAmount: 0,
      vatRate: 0,
      vatAmount: 0,
      totalAmount: 10,
      paymentMethod: 'cash',
      createdBy: empA1.uid,
      createdByName: empA1.displayName,
      createdByRole: 'employee',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    empBatch.set(empA1Db.doc('purchases/pur_emp_illegal/items/item_0'), {
      id: 'item_0',
      purchaseId: 'pur_emp_illegal',
      orgId: 'org_a',
      branchId: 'br_a1',
      lineIndex: 0,
      name: 'صنف موظف',
      quantity: 1,
      unitPrice: 10,
      total: 10,
      createdBy: empA1.uid,
      createdAt: nowIso,
    });
    await assertFails(empBatch.commit());
  });

  await runCase('5. Subcollection security hardening rejects item_100, mismatched itemId, tampered total, orphan item, update, and delete', async () => {
    const nowIso = '2026-11-18T12:00:00.000Z';

    // 5a: item_100 (lineIndex 100 >= 100) rejected
    await assertFails(
      mgrADb.doc('purchases/pur_mgr_100/items/item_100').set({
        id: 'item_100',
        purchaseId: 'pur_mgr_100',
        orgId: 'org_a',
        branchId: 'br_a2',
        lineIndex: 100,
        name: 'صنف 101 ممنوع',
        quantity: 1,
        unitPrice: 10,
        total: 10,
        createdBy: mgrA.uid,
        createdAt: nowIso,
      })
    );

    // 5b: mismatched itemId vs lineIndex rejected
    await assertFails(
      mgrADb.doc('purchases/pur_sup_ok/items/item_5').set({
        id: 'item_5',
        purchaseId: 'pur_sup_ok',
        orgId: 'org_a',
        branchId: 'br_a2',
        lineIndex: 4,
        name: 'معرف غير متطابق',
        quantity: 1,
        unitPrice: 10,
        total: 10,
        createdBy: mgrA.uid,
        createdAt: nowIso,
      })
    );

    // 5c: tampered total (2 * 10 != 99) rejected
    await assertFails(
      mgrADb.doc('purchases/pur_sup_ok/items/item_10').set({
        id: 'item_10',
        purchaseId: 'pur_sup_ok',
        orgId: 'org_a',
        branchId: 'br_a2',
        lineIndex: 10,
        name: 'إجمالي متلاعب به',
        quantity: 2,
        unitPrice: 10,
        total: 99,
        createdBy: mgrA.uid,
        createdAt: nowIso,
      })
    );

    // 5d: orphan item without parent purchase rejected
    await assertFails(
      mgrADb.doc('purchases/pur_nonexistent/items/item_0').set({
        id: 'item_0',
        purchaseId: 'pur_nonexistent',
        orgId: 'org_a',
        branchId: 'br_a1',
        lineIndex: 0,
        name: 'صنف يتيم',
        quantity: 1,
        unitPrice: 10,
        total: 10,
        createdBy: mgrA.uid,
        createdAt: nowIso,
      })
    );

    // 5e: client update and delete on existing subcollection item rejected
    await assertFails(
      mgrADb.doc('purchases/pur_mgr_100/items/item_0').update({ name: 'تعديل ممنوع' })
    );
    await assertFails(
      mgrADb.doc('purchases/pur_mgr_100/items/item_0').delete()
    );
  });

  await runCase('6. Legacy unrestricted organization (adartalmtm@gmail.com) commits multi-item invoice + multiple attachments cleanly', async () => {
    const preparedLegacy = preparePurchaseSubmission({
      userProfile: mgrLegacy,
      orgId: 'org_legacy',
      currency: 'SAR',
      branch: brLegacy1,
      supplier: supLegacy1,
      date: '2026-11-18',
      invoiceNumber: 'LEG-001',
      paymentMethod: 'credit',
      items: [
        { name: 'صنف قديم 1', quantity: 5, unitPrice: 20 },
        { name: 'صنف قديم 2', quantity: 10, unitPrice: 7.5 },
      ],
      attachments: [
        { fileName: 'leg_1.jpg', fileSize: 40_000, mimeType: 'image/jpeg' },
        { fileName: 'leg_2.pdf', fileSize: 80_000, mimeType: 'application/pdf' },
      ],
      vatRate: 15,
      purchaseId: 'pur_legacy_multi',
    });

    await assertSucceeds(commitPreparedBatch(mgrLegacyDb, preparedLegacy));

    const snap = await assertSucceeds(
      mgrLegacyDb.collection('purchases/pur_legacy_multi/items').get()
    );
    assert.equal(snap.size, 2);
  });

  await testEnv.cleanup();

  const passedCount = outcomes.filter((o) => o.passed).length;
  const failedCount = outcomes.length - passedCount;
  console.log('\n========================================================================');
  console.log(`PHASE 4.4 STEP 3 EMULATOR SUMMARY: ${passedCount}/${outcomes.length} passed, ${failedCount} failed.`);
  console.log('========================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runPhase44Step3EmulatorTests().catch((err) => {
  console.error('Unhandled error in Phase 4.4 Step 3 emulator tests:', err);
  process.exit(1);
});
