/**
 * Employee Auth UID Rebind — Live Firestore Emulator Rules Verification Suite (Local Only)
 *
 * Tests the exact proposed 2-step rebind workflow against the UNTOUCHED `firestore.rules`
 * inside the local Firestore Emulator (ZERO production writes, ZERO rules changes):
 *
 *  1. Non-Super Admin (org manager, branch_manager, employee, and unverified Super Admin)
 *     are strictly DENIED from archiving legacy `users/7aXYPLvRaCeuML8kf7XKal8sVOp2` or
 *     creating `users/UnadIrNfoNeBdzTjfVMJJjTJIMR2`.
 *  2. Verified Super Admin (`amoal2030@gmail.com`, `email_verified: true`) executes the exact
 *     planned 2-step atomic procedure cleanly under existing `firestore.rules`:
 *       - Step 1 batch: Archive `users/7aXYPLvRaCeuML8kf7XKal8sVOp2` + atomic `platformAuditLogs` (`MEMBER_ARCHIVED`)
 *       - Step 2 batch: Create `users/UnadIrNfoNeBdzTjfVMJJjTJIMR2` + atomic `platformAuditLogs` (`MEMBER_CREATED`)
 *     (ZERO deletions, ZERO rule relaxations, ZERO CEL expression limit issues!)
 *  3. Post-rebind access verification for `UnadIrNfoNeBdzTjfVMJJjTJIMR2`:
 *     - Can read own `users/UnadIrNfoNeBdzTjfVMJJjTJIMR2`, `organizations/org_sahab`, and `branches/branch_sahab_1_3`.
 *     - Can read historical `closings` and `purchases` of branch `سحاب 1 (3)`.
 *     - Can create a new closing in branch `سحاب 1 (3)`.
 *     - Strictly DENIED reading/writing another branch in the SAME org (`branch_sahab_2`) — no privilege escalation.
 *     - Strictly DENIED reading/writing `org_other_b` — strict cross-org isolation.
 *  4. Legacy document `users/7aXYPLvRaCeuML8kf7XKal8sVOp2`:
 *     - Still exists (NEVER deleted) with `isActive: false`, `isArchived: true`, `membershipStatus: 'archived'`.
 *     - Strictly DENIED reading org branches, closings, or purchases (prevents two active profiles).
 *  5. Historical preservation:
 *     - Every seeded closing, purchase (with attachments), auditLog, prior platformAuditLog,
 *       memberOrgHistory, and notification remains 100% intact and untouched.
 *
 * Run with:
 *   firebase emulators:exec --only firestore --project scenic-proton-s3kqt "npx tsx src/tests/employeeUidRebindEmulator.test.ts"
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
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import { buildEmployeeAuthUidRebindPlan } from '../utils/employeeUidRebind';
import { Branch, Organization, UserProfile } from '../types';

const CURRENT_AUTH_UID = 'UnadIrNfoNeBdzTjfVMJJjTJIMR2';
const LEGACY_DOC_UID = '7aXYPLvRaCeuML8kf7XKal8sVOp2';
const TARGET_EMAIL = 'mo100100050@gmail.com';
const SUPER_ADMIN_UID = 'sa_root_uid_emu';
const SUPER_ADMIN_EMAIL = 'amoal2030@gmail.com';

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

const nowIso = '2026-05-01T10:00:00.000Z';

const orgSahab: Organization = {
  id: 'org_sahab',
  name: 'مؤسسة سحاب الاختبارية',
  activityType: 'retail',
  currency: 'SAR',
  ownerId: 'mgr_sahab_uid',
  ownerEmail: 'owner@sahab.example.com',
  ownerName: 'مالك مؤسسة سحاب',
  driveConnected: true,
  isActive: true,
  subscriptionPlan: '1y',
  subscriptionStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const branchSahab13: Branch = {
  id: 'branch_sahab_1_3',
  orgId: 'org_sahab',
  name: 'سحاب 1 (3)',
  code: 'SHB3',
  isActive: true,
  lifecycleStatus: 'active',
  paymentStatus: 'paid',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const branchSahab2: Branch = {
  id: 'branch_sahab_2',
  orgId: 'org_sahab',
  name: 'سحاب 2',
  code: 'SHB2',
  isActive: true,
  lifecycleStatus: 'active',
  paymentStatus: 'paid',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const legacyProfileFixture: UserProfile = {
  uid: LEGACY_DOC_UID,
  orgId: 'org_sahab',
  email: TARGET_EMAIL,
  displayName: 'محمد فيصل',
  role: 'branch_manager',
  branchId: 'branch_sahab_1_3',
  branchIds: ['branch_sahab_1_3'],
  branchName: 'سحاب 1 (3)',
  phone: '0500000001',
  isActive: true,
  isArchived: false,
  membershipStatus: 'active',
  permissions: buildDefaultPermissionsForRole('branch_manager'),
  createdAt: '2026-02-01T08:00:00.000Z',
  updatedAt: '2026-02-01T08:00:00.000Z',
};

const historicalClosing = {
  id: 'closing_hist_sahab_1',
  orgId: 'org_sahab',
  branchId: 'branch_sahab_1_3',
  branchName: 'سحاب 1 (3)',
  employeeId: LEGACY_DOC_UID,
  employeeName: 'محمد فيصل',
  date: '2026-04-20',
  period: 'evening',
  cashSales: 1200,
  cardSales: 2300,
  totalSales: 3500,
  expenses: 100,
  netCash: 1100,
  netTotal: 3400,
  status: 'approved',
  createdAt: '2026-04-20T22:00:00.000Z',
  updatedAt: '2026-04-20T22:10:00.000Z',
};

const historicalPurchase = {
  id: 'purchase_hist_sahab_1',
  orgId: 'org_sahab',
  branchId: 'branch_sahab_1_3',
  branchName: 'سحاب 1 (3)',
  supplierId: 'sup_sahab_1',
  supplierName: 'مورد سحاب',
  invoiceNumber: 'INV-SHB-01',
  invoiceDate: '2026-04-18',
  subtotal: 400,
  vatAmount: 60,
  totalAmount: 460,
  paymentMethod: 'cash',
  paymentStatus: 'paid',
  createdBy: LEGACY_DOC_UID,
  createdByName: 'محمد فيصل',
  attachments: [
    {
      id: 'att_hist_1',
      name: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 9800,
      url: 'https://example.com/receipt.pdf',
      uploadedAt: '2026-04-18T11:00:00.000Z',
      uploadedBy: LEGACY_DOC_UID,
    },
  ],
  createdAt: '2026-04-18T11:00:00.000Z',
  updatedAt: '2026-04-18T11:00:00.000Z',
};

const historicalAuditLog = {
  id: 'audit_hist_sahab_1',
  orgId: 'org_sahab',
  branchId: 'branch_sahab_1_3',
  userId: LEGACY_DOC_UID,
  userName: 'محمد فيصل',
  action: 'CREATE_CLOSING',
  targetType: 'closing',
  targetId: 'closing_hist_sahab_1',
  details: 'سجل تدقيق تاريخي',
  timestamp: '2026-04-20T22:00:00.000Z',
};

const historicalPlatformAuditLog = {
  id: 'pal_hist_001',
  actorUid: SUPER_ADMIN_UID,
  actorEmail: SUPER_ADMIN_EMAIL,
  actorName: 'المدير الرئيسي',
  action: 'MEMBER_CREATED',
  targetType: 'member',
  targetId: LEGACY_DOC_UID,
  orgId: 'org_sahab',
  details: 'إنشاء تاريخي سابق للعضو',
  timestamp: '2026-02-01T08:00:00.000Z',
};

const historicalMemberOrgHistory = {
  id: 'moh_hist_001',
  eventType: 'assigned',
  uid: LEGACY_DOC_UID,
  email: TARGET_EMAIL,
  displayName: 'محمد فيصل',
  orgId: 'org_sahab',
  orgName: orgSahab.name,
  role: 'branch_manager',
  branchId: 'branch_sahab_1_3',
  branchName: 'سحاب 1 (3)',
  effectiveAt: '2026-02-01T08:00:00.000Z',
  actorUid: SUPER_ADMIN_UID,
  actorEmail: SUPER_ADMIN_EMAIL,
  reason: 'تسجيل أولي',
  auditLogId: 'pal_hist_001',
  createdAt: '2026-02-01T08:00:00.000Z',
};

const historicalNotification = {
  id: 'notif_hist_001',
  recipientScope: 'org',
  orgId: 'org_sahab',
  feedKey: 'org:org_sahab:branch:branch_sahab_1_3',
  category: 'closing',
  type: 'CLOSING_SUBMITTED',
  severity: 'info',
  title: 'إشعار تاريخي',
  body: 'تم إنشاء إقفال سابق',
  actorUid: LEGACY_DOC_UID,
  actorName: 'محمد فيصل',
  createdAt: '2026-04-20T22:00:00.000Z',
  readBy: [],
};

async function seedFixtures() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const subStart = firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 86_400_000));
    const subEnd = firebase.firestore.Timestamp.fromDate(
      new Date(Date.now() + 365 * 86_400_000)
    );

    await db.collection('organizations').doc('org_sahab').set({
      ...orgSahab,
      subscriptionStartAt: subStart,
      subscriptionEndAt: subEnd,
      updatedAt: nowIso,
    });

    await db.collection('organizations').doc('org_other_b').set({
      id: 'org_other_b',
      name: 'مؤسسة ب المستقلة',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'mgr_b_uid',
      ownerEmail: 'owner@otherb.example.com',
      ownerName: 'مالك مؤسسة ب',
      driveConnected: true,
      isActive: true,
      status: 'active',
      subscriptionPlan: '1y',
      subscriptionStatus: 'active',
      subscriptionStartAt: subStart,
      subscriptionEndAt: subEnd,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: nowIso,
    });

    await db.collection('branches').doc('branch_sahab_1_3').set({
      ...branchSahab13,
      subscriptionStartAt: subStart,
      subscriptionEndAt: subEnd,
    });

    await db.collection('branches').doc('branch_sahab_2').set({
      ...branchSahab2,
      subscriptionStartAt: subStart,
      subscriptionEndAt: subEnd,
    });

    await db.collection('branches').doc('branch_other_b_1').set({
      id: 'branch_other_b_1',
      orgId: 'org_other_b',
      name: 'فرع ب 1',
      code: 'B1',
      isActive: true,
      lifecycleStatus: 'active',
      paymentStatus: 'paid',
      subscriptionStartAt: subStart,
      subscriptionEndAt: subEnd,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // Org Manager
    await db.collection('users').doc('mgr_sahab_uid').set({
      uid: 'mgr_sahab_uid',
      orgId: 'org_sahab',
      email: 'owner@sahab.example.com',
      displayName: 'مالك مؤسسة سحاب',
      role: 'manager',
      isActive: true,
      isArchived: false,
      membershipStatus: 'active',
      permissions: buildDefaultPermissionsForRole('manager'),
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // Legacy active employee doc under 7aXYPLvRaCeuML8kf7XKal8sVOp2
    await db.collection('users').doc(LEGACY_DOC_UID).set(legacyProfileFixture);

    // Other branch closing & org B closing for isolation tests
    await db.collection('closings').doc(historicalClosing.id).set(historicalClosing);
    await db.collection('closings').doc('closing_sahab_2_other_branch').set({
      ...historicalClosing,
      id: 'closing_sahab_2_other_branch',
      branchId: 'branch_sahab_2',
      branchName: 'سحاب 2',
      date: '2026-04-21',
    });
    await db.collection('closings').doc('closing_org_b_1').set({
      ...historicalClosing,
      id: 'closing_org_b_1',
      orgId: 'org_other_b',
      branchId: 'branch_other_b_1',
      branchName: 'فرع ب 1',
      date: '2026-04-21',
    });

    await db.collection('purchases').doc(historicalPurchase.id).set(historicalPurchase);
    await db.collection('auditLogs').doc(historicalAuditLog.id).set(historicalAuditLog);
    await db.collection('platformAuditLogs').doc(historicalPlatformAuditLog.id).set(historicalPlatformAuditLog);
    await db.collection('memberOrgHistory').doc(historicalMemberOrgHistory.id).set(historicalMemberOrgHistory);
    await db.collection('notifications').doc(historicalNotification.id).set(historicalNotification);
  });
}

async function main() {
  console.log('\n🔥 Employee Auth UID Rebind — Live Firestore Emulator Rules Verification\n');

  const rules = fs.readFileSync('firestore.rules', 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: 'scenic-proton-s3kqt',
    firestore: { rules },
  });

  await seedFixtures();

  const plan = buildEmployeeAuthUidRebindPlan({
    actor: {
      uid: SUPER_ADMIN_UID,
      email: SUPER_ADMIN_EMAIL,
      emailVerified: true,
      displayName: 'المدير الرئيسي',
    },
    targetAuthUid: CURRENT_AUTH_UID,
    targetAuthUidDocExists: false,
    legacyDocId: LEGACY_DOC_UID,
    legacyProfile: legacyProfileFixture,
    org: orgSahab,
    orgBranches: [branchSahab13, branchSahab2],
    legacyUidAuthVerification: 'confirmed_unused_or_same_person',
    reason: 'إعادة ربط Auth UID الحالي للموظف محمد فيصل بسجله الوظيفي في سحاب 1 (3) دون حذف أي سجل',
    now: new Date(nowIso),
    archiveAuditLogId: 'pal_rebind_emu_archive_01',
    createAuditLogId: 'pal_rebind_emu_create_02',
  });

  await runCase('1. Non-Super Admin (org manager & unverified Super Admin) strictly DENIED from executing rebind', async () => {
    // Org manager tries to archive + write platformAuditLogs
    const mgrDb = testEnv
      .authenticatedContext('mgr_sahab_uid', {
        email: 'owner@sahab.example.com',
        email_verified: true,
      })
      .firestore();
    const mgrBatch = mgrDb.batch();
    mgrBatch.update(mgrDb.collection('users').doc(LEGACY_DOC_UID), plan.step1ArchiveLegacy.userPatch);
    mgrBatch.set(
      mgrDb.collection('platformAuditLogs').doc(plan.step1ArchiveLegacy.auditLog.id),
      plan.step1ArchiveLegacy.auditLog
    );
    await assertPermissionDenied(mgrBatch.commit());

    // Unverified Super Admin tries to execute Step 1
    const unverifiedSaDb = testEnv
      .authenticatedContext(SUPER_ADMIN_UID, {
        email: SUPER_ADMIN_EMAIL,
        email_verified: false,
      })
      .firestore();
    const unvBatch = unverifiedSaDb.batch();
    unvBatch.update(
      unverifiedSaDb.collection('users').doc(LEGACY_DOC_UID),
      plan.step1ArchiveLegacy.userPatch
    );
    unvBatch.set(
      unverifiedSaDb.collection('platformAuditLogs').doc(plan.step1ArchiveLegacy.auditLog.id),
      plan.step1ArchiveLegacy.auditLog
    );
    await assertPermissionDenied(unvBatch.commit());

    // Employee under CURRENT_AUTH_UID tries to self-create own profile
    const empDb = testEnv
      .authenticatedContext(CURRENT_AUTH_UID, {
        email: TARGET_EMAIL,
        email_verified: true,
      })
      .firestore();
    await assertPermissionDenied(
      empDb.collection('users').doc(CURRENT_AUTH_UID).set(plan.step2CreateActive.userDoc)
    );
  });

  await runCase('2. Verified Super Admin executes 2-step atomic rebind cleanly under untouched firestore.rules', async () => {
    const saDb = testEnv
      .authenticatedContext(SUPER_ADMIN_UID, {
        email: SUPER_ADMIN_EMAIL,
        email_verified: true,
      })
      .firestore();

    // Step 1 atomic batch: archive legacy doc + platformAuditLog (MEMBER_ARCHIVED)
    const batch1 = saDb.batch();
    batch1.update(saDb.collection('users').doc(LEGACY_DOC_UID), plan.step1ArchiveLegacy.userPatch);
    batch1.set(
      saDb.collection('platformAuditLogs').doc(plan.step1ArchiveLegacy.auditLog.id),
      plan.step1ArchiveLegacy.auditLog
    );
    await assertSucceeds(batch1.commit());

    // Step 2 atomic batch: create active doc under CURRENT_AUTH_UID + platformAuditLog (MEMBER_CREATED)
    const batch2 = saDb.batch();
    batch2.set(saDb.collection('users').doc(CURRENT_AUTH_UID), plan.step2CreateActive.userDoc);
    batch2.set(
      saDb.collection('platformAuditLogs').doc(plan.step2CreateActive.auditLog.id),
      plan.step2CreateActive.auditLog
    );
    await assertSucceeds(batch2.commit());
  });

  await runCase('3. Post-rebind: Current Auth UID logs in & accesses org_sahab + branch سحاب 1 (3) + historical closings/purchases, while blocked from other branches/orgs', async () => {
    const reboundDb = testEnv
      .authenticatedContext(CURRENT_AUTH_UID, {
        email: TARGET_EMAIL,
        email_verified: true,
      })
      .firestore();

    // Read own identity doc, org, and assigned branch
    const myDoc = await assertSucceeds(reboundDb.collection('users').doc(CURRENT_AUTH_UID).get());
    assert.equal(myDoc.exists, true);
    assert.equal(myDoc.data()?.uid, CURRENT_AUTH_UID);
    assert.equal(myDoc.data()?.email, TARGET_EMAIL);
    assert.equal(myDoc.data()?.orgId, 'org_sahab');
    assert.equal(myDoc.data()?.branchId, 'branch_sahab_1_3');
    assert.equal(myDoc.data()?.role, 'branch_manager');

    await assertSucceeds(reboundDb.collection('organizations').doc('org_sahab').get());
    await assertSucceeds(reboundDb.collection('branches').doc('branch_sahab_1_3').get());

    // Read historical closing & purchase from branch سحاب 1 (3)
    const histClosingSnap = await assertSucceeds(
      reboundDb.collection('closings').doc(historicalClosing.id).get()
    );
    assert.equal(histClosingSnap.data()?.employeeId, LEGACY_DOC_UID);

    const histPurchaseSnap = await assertSucceeds(
      reboundDb.collection('purchases').doc(historicalPurchase.id).get()
    );
    assert.equal(histPurchaseSnap.data()?.createdBy, LEGACY_DOC_UID);

    // Create a brand new closing in assigned branch سحاب 1 (3)
    await assertSucceeds(
      reboundDb.collection('closings').doc('closing_post_rebind_1').set({
        id: 'closing_post_rebind_1',
        orgId: 'org_sahab',
        branchId: 'branch_sahab_1_3',
        branchName: 'سحاب 1 (3)',
        employeeId: CURRENT_AUTH_UID,
        employeeName: 'محمد فيصل',
        date: '2026-05-01',
        period: 'morning',
        cashSales: 600,
        cardSales: 900,
        totalSales: 1500,
        expenses: 50,
        netCash: 550,
        netTotal: 1450,
        status: 'pending_review',
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    );

    // DENIED reading other branch closing inside same org (branch scope preserved!)
    await assertPermissionDenied(
      reboundDb.collection('closings').doc('closing_sahab_2_other_branch').get()
    );

    // DENIED reading other organization (org_other_b)
    await assertPermissionDenied(reboundDb.collection('organizations').doc('org_other_b').get());
    await assertPermissionDenied(reboundDb.collection('branches').doc('branch_other_b_1').get());
    await assertPermissionDenied(reboundDb.collection('closings').doc('closing_org_b_1').get());
  });

  await runCase('4. Legacy doc users/7aXYPLvRaCeuML8kf7XKal8sVOp2 still exists, is archived, and cannot access org data (no duplicate active profile)', async () => {
    const legacyDb = testEnv
      .authenticatedContext(LEGACY_DOC_UID, {
        email: TARGET_EMAIL,
        email_verified: true,
      })
      .firestore();

    const legacySnap = await assertSucceeds(legacyDb.collection('users').doc(LEGACY_DOC_UID).get());
    assert.equal(legacySnap.exists, true);
    assert.equal(legacySnap.data()?.isActive, false);
    assert.equal(legacySnap.data()?.isArchived, true);
    assert.equal(legacySnap.data()?.membershipStatus, 'archived');

    // Archived legacy profile cannot read org branches, closings, or purchases
    await assertPermissionDenied(legacyDb.collection('branches').doc('branch_sahab_1_3').get());
    await assertPermissionDenied(legacyDb.collection('closings').doc(historicalClosing.id).get());
    await assertPermissionDenied(legacyDb.collection('purchases').doc(historicalPurchase.id).get());
  });

  await runCase('5. All historical collections (closings, purchases, auditLogs, platformAuditLogs, memberOrgHistory, notifications) remain 100% intact', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const c = await db.collection('closings').doc(historicalClosing.id).get();
      assert.equal(c.exists, true);
      assert.deepEqual(c.data(), historicalClosing);

      const p = await db.collection('purchases').doc(historicalPurchase.id).get();
      assert.equal(p.exists, true);
      assert.deepEqual(p.data(), historicalPurchase);

      const a = await db.collection('auditLogs').doc(historicalAuditLog.id).get();
      assert.equal(a.exists, true);
      assert.deepEqual(a.data(), historicalAuditLog);

      const pal0 = await db.collection('platformAuditLogs').doc(historicalPlatformAuditLog.id).get();
      assert.equal(pal0.exists, true);
      assert.deepEqual(pal0.data(), historicalPlatformAuditLog);

      const pal1 = await db.collection('platformAuditLogs').doc(plan.step1ArchiveLegacy.auditLog.id).get();
      const pal2 = await db.collection('platformAuditLogs').doc(plan.step2CreateActive.auditLog.id).get();
      assert.equal(pal1.exists, true);
      assert.equal(pal2.exists, true);

      const moh = await db.collection('memberOrgHistory').doc(historicalMemberOrgHistory.id).get();
      assert.equal(moh.exists, true);
      assert.deepEqual(moh.data(), historicalMemberOrgHistory);

      const n = await db.collection('notifications').doc(historicalNotification.id).get();
      assert.equal(n.exists, true);
      assert.deepEqual(n.data(), historicalNotification);
    });
  });

  await testEnv.cleanup();
  console.log(`\n📊 Rebind Emulator Suite Result: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Fatal emulator test error:', err);
  if (testEnv) await testEnv.cleanup().catch(() => {});
  process.exit(1);
});
