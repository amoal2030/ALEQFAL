/**
 * Phase 4.6 Firestore Security Rules Emulator Test Suite — Notification System
 * Verifies strict role-scoped feed isolation, Super Admin exclusivity, cross-tenant denial,
 * permission-gated Supervisor access, single-branch Branch Manager isolation,
 * Employee personal-only restriction, zero tamper on mark-read, and strict zero-delete enforcement.
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
import {
  buildClosingReviewedNotifications,
  buildClosingSubmittedNotifications,
  buildEmployeeLifecycleNotifications,
  buildPurchaseRecordedNotification,
  buildSecurityAdminNotification,
  buildSuperAdminPlatformNotification,
  buildSupplierAddedNotification,
} from '../utils/notifications';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import { ShiftClosing } from '../types';

const Timestamp = firebase.firestore.Timestamp;

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

async function runPhase46EmulatorTests() {
  console.log('========================================================================');
  console.log('   PHASE 4.6: NOTIFICATION SYSTEM FIRESTORE RULES EMULATOR TESTS        ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-phase46-notif-tests',
    firestore: {
      rules: rulesContent,
      host,
      port,
    },
  });

  await testEnv.clearFirestore();

  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const tsPast10d = Timestamp.fromMillis(nowMs - 10 * oneDayMs);
  const tsPast2d = Timestamp.fromMillis(nowMs - 2 * oneDayMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.doc('organizations/org_a').set({
      id: 'org_a',
      name: 'مؤسسة أ',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_a',
      ownerEmail: 'mgr.a@example.com',
      ownerName: 'مدير أ',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast10d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });

    await db.doc('organizations/org_b').set({
      id: 'org_b',
      name: 'مؤسسة ب',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_b',
      ownerEmail: 'mgr.b@example.com',
      ownerName: 'مدير ب',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast10d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });

    await db.doc('organizations/org_exp').set({
      id: 'org_exp',
      name: 'مؤسسة منتهية',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_exp',
      ownerEmail: 'mgr.exp@example.com',
      ownerName: 'مدير منتهي',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast10d,
      subscriptionEndAt: tsPast2d,
      createdAt: '2026-10-01T08:00:00Z',
      updatedAt: '2026-10-01T08:00:00Z',
    });

    // Legacy org owned by onlak2030@gmail.com (strictly NOT super admin)
    await db.doc('organizations/org_legacy').set({
      id: 'org_legacy',
      name: 'مؤسسة قديمة',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'uid_onlak',
      ownerEmail: 'onlak2030@gmail.com',
      ownerName: 'مدير قديم',
      driveConnected: false,
      createdAt: '2026-01-01T08:00:00Z',
      updatedAt: '2026-01-01T08:00:00Z',
    });

    await db.doc('branches/br_a1').set({ id: 'br_a1', orgId: 'org_a', name: 'فرع أ1', code: 'A1', isActive: true, createdAt: '2026-11-01T08:00:00Z' });
    await db.doc('branches/br_a2').set({ id: 'br_a2', orgId: 'org_a', name: 'فرع أ2', code: 'A2', isActive: true, createdAt: '2026-11-01T08:00:00Z' });
    await db.doc('branches/br_b1').set({ id: 'br_b1', orgId: 'org_b', name: 'فرع ب1', code: 'B1', isActive: true, createdAt: '2026-11-01T08:00:00Z' });
    await db.doc('branches/br_legacy_1').set({ id: 'br_legacy_1', orgId: 'org_legacy', name: 'فرع قديم', code: 'L1', isActive: true, createdAt: '2026-01-01T08:00:00Z' });

    await db.doc('users/uid_mgr_a').set({
      uid: 'uid_mgr_a', orgId: 'org_a', email: 'mgr.a@example.com', displayName: 'مدير أ',
      role: 'manager', isActive: true, permissions: buildDefaultPermissionsForRole('manager'), createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_sup_app').set({
      uid: 'uid_sup_app', orgId: 'org_a', email: 'sup.app@example.com', displayName: 'مسؤول اعتماد',
      role: 'supervisor', isActive: true,
      permissions: buildDefaultPermissionsForRole('supervisor', { canApproveClosings: true, canViewAllClosings: true }),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_sup_pur').set({
      uid: 'uid_sup_pur', orgId: 'org_a', email: 'sup.pur@example.com', displayName: 'مسؤول مشتريات',
      role: 'supervisor', isActive: true,
      permissions: buildDefaultPermissionsForRole('supervisor', { canManagePurchases: true, canManageSuppliers: true }),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_sup_none').set({
      uid: 'uid_sup_none', orgId: 'org_a', email: 'sup.none@example.com', displayName: 'مسؤول مقيد',
      role: 'supervisor', isActive: true,
      permissions: buildDefaultPermissionsForRole('supervisor'),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_sup_creator').set({
      uid: 'uid_sup_creator', orgId: 'org_a', email: 'sup.creator@example.com', displayName: 'مسؤول إدخال إقفال',
      role: 'supervisor', isActive: true,
      permissions: buildDefaultPermissionsForRole('supervisor', { canCreateClosing: true }),
      createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_bm_1').set({
      uid: 'uid_bm_1', orgId: 'org_a', email: 'bm1@example.com', displayName: 'مسؤول فرع 1',
      role: 'branch_manager', branchId: 'br_a1', branchIds: ['br_a1'], isActive: true,
      permissions: buildDefaultPermissionsForRole('branch_manager'), createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_bm_2').set({
      uid: 'uid_bm_2', orgId: 'org_a', email: 'bm2@example.com', displayName: 'مسؤول فرع 2',
      role: 'branch_manager', branchId: 'br_a2', branchIds: ['br_a2'], isActive: true,
      permissions: buildDefaultPermissionsForRole('branch_manager'), createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_emp_1').set({
      uid: 'uid_emp_1', orgId: 'org_a', email: 'emp1@example.com', displayName: 'موظف 1',
      role: 'employee', branchId: 'br_a1', isActive: true,
      permissions: buildDefaultPermissionsForRole('employee'), createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_emp_2').set({
      uid: 'uid_emp_2', orgId: 'org_a', email: 'emp2@example.com', displayName: 'موظف 2',
      role: 'employee', branchId: 'br_a1', isActive: true,
      permissions: buildDefaultPermissionsForRole('employee'), createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_mgr_b').set({
      uid: 'uid_mgr_b', orgId: 'org_b', email: 'mgr.b@example.com', displayName: 'مدير ب',
      role: 'manager', isActive: true, permissions: buildDefaultPermissionsForRole('manager'), createdAt: '2026-11-01T08:00:00Z',
    });
    await db.doc('users/uid_mgr_exp').set({
      uid: 'uid_mgr_exp', orgId: 'org_exp', email: 'mgr.exp@example.com', displayName: 'مدير منتهي',
      role: 'manager', isActive: true, permissions: buildDefaultPermissionsForRole('manager'), createdAt: '2026-10-01T08:00:00Z',
    });
    await db.doc('users/uid_onlak').set({
      uid: 'uid_onlak', orgId: 'org_legacy', email: 'onlak2030@gmail.com', displayName: 'مدير قديم',
      role: 'manager', isActive: true, permissions: buildDefaultPermissionsForRole('manager'), createdAt: '2026-01-01T08:00:00Z',
    });
  });

  const saCtx = testEnv.authenticatedContext('uid_sa', { email: 'amoal2030@gmail.com', email_verified: true });
  const saUnverifiedCtx = testEnv.authenticatedContext('uid_sa_unv', { email: 'amoal2030@gmail.com', email_verified: false });
  const onlakCtx = testEnv.authenticatedContext('uid_onlak', { email: 'onlak2030@gmail.com', email_verified: true });
  const mgrACtx = testEnv.authenticatedContext('uid_mgr_a', { email: 'mgr.a@example.com', email_verified: true });
  const supAppCtx = testEnv.authenticatedContext('uid_sup_app', { email: 'sup.app@example.com', email_verified: true });
  const supPurCtx = testEnv.authenticatedContext('uid_sup_pur', { email: 'sup.pur@example.com', email_verified: true });
  const supNoneCtx = testEnv.authenticatedContext('uid_sup_none', { email: 'sup.none@example.com', email_verified: true });
  const supCreatorCtx = testEnv.authenticatedContext('uid_sup_creator', { email: 'sup.creator@example.com', email_verified: true });
  const bm1Ctx = testEnv.authenticatedContext('uid_bm_1', { email: 'bm1@example.com', email_verified: true });
  const bm2Ctx = testEnv.authenticatedContext('uid_bm_2', { email: 'bm2@example.com', email_verified: true });
  const emp1Ctx = testEnv.authenticatedContext('uid_emp_1', { email: 'emp1@example.com', email_verified: true });
  const emp2Ctx = testEnv.authenticatedContext('uid_emp_2', { email: 'emp2@example.com', email_verified: true });
  const mgrBCtx = testEnv.authenticatedContext('uid_mgr_b', { email: 'mgr.b@example.com', email_verified: true });
  const mgrExpCtx = testEnv.authenticatedContext('uid_mgr_exp', { email: 'mgr.exp@example.com', email_verified: true });

  let passed = 0;
  const runCase = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  };

  const sampleClosing: ShiftClosing = {
    id: 'closing_a1_2026-11-16_morning',
    orgId: 'org_a',
    branchId: 'br_a1',
    branchName: 'فرع أ1',
    employeeId: 'uid_emp_1',
    employeeName: 'موظف 1',
    date: '2026-11-16',
    period: 'morning',
    cashSales: 1500,
    cardSales: 2000,
    totalSales: 3500,
    expenses: 400,
    remainingInBox: 1100,
    netPeriod: 3100,
    status: 'pending_review',
    attachmentIds: [],
    createdAt: '2026-11-16T08:00:00.000Z',
    updatedAt: '2026-11-16T08:00:00.000Z',
  };

  // 1. Super Admin notifications isolation
  const saNotif = buildSuperAdminPlatformNotification({
    dedupKey: 'sa_org_a_created',
    category: 'org_branches',
    type: 'SA_ORG_CREATED',
    severity: 'success',
    relatedOrgId: 'org_a',
    actorUid: 'uid_sa',
    actorName: 'صاحب الموقع',
    title: 'تأسيس مؤسسة أ',
    body: 'تم تأسيس المؤسسة بنجاح',
    targetType: 'organization',
    targetId: 'org_a',
    createdAt: '2026-11-16T09:00:00.000Z',
  });

  await runCase('Verified amoal2030@gmail.com can create, list, and mark-read super_admin notifications', async () => {
    const saDb = saCtx.firestore();
    await assertSucceeds(saDb.doc(`notifications/${saNotif.id}`).set(saNotif));
    await assertSucceeds(
      saDb
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'super_admin')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
        .get()
    );
    await assertSucceeds(
      saDb.doc(`notifications/${saNotif.id}`).update({
        'readBy.uid_sa': '2026-11-16T09:05:00.000Z',
        updatedAt: '2026-11-16T09:05:00.000Z',
      })
    );
  });

  await runCase('onlak2030@gmail.com, unverified amoal2030, and tenant managers are DENIED super_admin notifications', async () => {
    await assertFails(
      onlakCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'super_admin').get()
    );
    await assertFails(
      saUnverifiedCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'super_admin').get()
    );
    await assertFails(
      mgrACtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'super_admin').get()
    );
    const spoofSaNotif = { ...saNotif, id: 'ntf_spoof_sa', actorUid: 'uid_onlak' };
    await assertFails(onlakCtx.firestore().doc(`notifications/${spoofSaNotif.id}`).set(spoofSaNotif));
  });

  // 2. Employee submitting closing triggers closing_submitted notification on br_a1 only
  const [closingSubNotif] = buildClosingSubmittedNotifications({
    closing: sampleClosing,
    actorUid: 'uid_emp_1',
    actorName: 'موظف 1',
    actorRole: 'employee',
    createdAt: '2026-11-16T10:00:00.000Z',
  });

  await runCase('Employee can atomically batch-submit closing + auditLog + closingArchive + CLOSING_SUBMITTED notification on br_a1', async () => {
    const empDb = emp1Ctx.firestore();
    const atomicClosing: ShiftClosing = {
      ...sampleClosing,
      id: 'closing_br_a1_2026-11-16_evening',
      period: 'evening',
      notes: 'إغلاق مسائي',
    };
    const [atomicNotif] = buildClosingSubmittedNotifications({
      closing: atomicClosing,
      actorUid: 'uid_emp_1',
      actorName: 'موظف 1',
      actorRole: 'employee',
      createdAt: '2026-11-16T09:58:00.000Z',
    });
    const batch = empDb.batch();
    batch.set(empDb.doc(`closings/${atomicClosing.id}`), atomicClosing);
    batch.set(empDb.doc('closingArchives/closing_br_a1_2026-11-16_evening'), {
      closingId: atomicClosing.id,
      orgId: 'org_a',
      branchId: 'br_a1',
      yearMonth: '2026-11',
      archiveStatus: 'pending_drive_sync',
      updatedAt: '2026-11-16T09:58:00.000Z',
    });
    batch.set(empDb.doc('auditLogs/log_atomic_notif_1'), {
      id: 'log_atomic_notif_1',
      orgId: 'org_a',
      actorId: 'uid_emp_1',
      actorName: 'موظف 1',
      actorRole: 'employee',
      action: 'CLOSING_SUBMITTED_FOR_REVIEW',
      targetType: 'closing',
      targetId: atomicClosing.id,
      details: 'إرسال إقفال مسائي مع إشعار فوري',
      timestamp: '2026-11-16T09:58:00.000Z',
    });
    batch.set(empDb.doc(`notifications/${atomicNotif.id}`), atomicNotif);
    await assertSucceeds(batch.commit());
  });

  await runCase('Employee can emit CLOSING_SUBMITTED atomically with closing on br_a1, but NOT without closing doc, on br_a2, or forged CLOSING_APPROVED', async () => {
    const empDb = emp1Ctx.firestore();
    // Legitimate atomic batch with real closing doc succeeds
    const batch = empDb.batch();
    batch.set(empDb.doc(`closings/${sampleClosing.id}`), sampleClosing);
    batch.set(empDb.doc(`notifications/${closingSubNotif.id}`), closingSubNotif);
    await assertSucceeds(batch.commit());

    // Standalone CLOSING_SUBMITTED WITHOUT an underlying closing doc MUST FAIL (anti-fake operational notification)
    const phantomClosingNotif = buildClosingSubmittedNotifications({
      closing: { ...sampleClosing, id: 'closing_phantom_does_not_exist' },
      actorUid: 'uid_emp_1',
      actorName: 'موظف 1',
      actorRole: 'employee',
      createdAt: '2026-11-16T10:00:30.000Z',
    })[0];
    await assertFails(empDb.doc(`notifications/${phantomClosingNotif.id}`).set(phantomClosingNotif));

    const wrongBranchNotif = buildClosingSubmittedNotifications({
      closing: { ...sampleClosing, id: 'closing_a2', branchId: 'br_a2', branchName: 'فرع أ2' },
      actorUid: 'uid_emp_1',
      actorName: 'موظف 1',
      actorRole: 'employee',
      createdAt: '2026-11-16T10:01:00.000Z',
    })[0];
    await assertFails(empDb.doc(`notifications/${wrongBranchNotif.id}`).set(wrongBranchNotif));

    const forgedApproval = buildClosingReviewedNotifications({
      closing: sampleClosing,
      action: 'approve',
      actorUid: 'uid_emp_1',
      actorName: 'موظف 1',
      actorRole: 'employee',
      createdAt: '2026-11-16T10:02:00.000Z',
    })[0];
    await assertFails(empDb.doc(`notifications/${forgedApproval.id}`).set(forgedApproval));
  });

  let supCreatorNotifId = '';
  let approvedUserNotifId = '';
  let approvedBmNotifId = '';

  await runCase('Tightened create security: enforces actorRole match, supervisor closing permission, existsAfter operational binding, and legitimate security alerts', async () => {
    // 1. Spoofed actorRole MUST FAIL
    const spoofedEmpRole = { ...closingSubNotif, id: 'ntf_spoof_actor_role_1', actorRole: 'manager' };
    await assertFails(emp1Ctx.firestore().doc(`notifications/${spoofedEmpRole.id}`).set(spoofedEmpRole));

    const spoofedSupRole = buildPurchaseRecordedNotification({
      purchaseId: 'pur_spoof_role',
      orgId: 'org_a',
      branchId: 'br_a1',
      branchName: 'فرع أ1',
      supplierName: 'مورد',
      totalAmount: 100,
      currency: 'SAR',
      actorUid: 'uid_sup_pur',
      actorName: 'مسؤول',
      actorRole: 'manager',
      createdAt: '2026-11-16T10:03:00.000Z',
    });
    await assertFails(supPurCtx.firestore().doc(`notifications/${spoofedSupRole.id}`).set(spoofedSupRole));

    // 2. Supervisor WITHOUT canCreateClosing (uid_sup_app & uid_sup_none) MUST BE DENIED CLOSING_SUBMITTED / RESUBMITTED
    const supClosingWithoutPerm: ShiftClosing = {
      ...sampleClosing,
      id: 'closing_br_a1_2026-11-15_morning',
      date: '2026-11-15',
      employeeId: 'uid_sup_app',
      employeeName: 'مسؤول اعتماد',
    };
    const [supNoCreateNotif] = buildClosingSubmittedNotifications({
      closing: supClosingWithoutPerm,
      actorUid: 'uid_sup_app',
      actorName: 'مسؤول اعتماد',
      actorRole: 'supervisor',
      createdAt: '2026-11-16T10:04:00.000Z',
    });
    await assertFails(supAppCtx.firestore().doc(`notifications/${supNoCreateNotif.id}`).set(supNoCreateNotif));

    const [supNoneClosingNotif] = buildClosingSubmittedNotifications({
      closing: { ...supClosingWithoutPerm, id: 'closing_br_a1_2026-11-14_morning', date: '2026-11-14', employeeId: 'uid_sup_none' },
      isResubmission: true,
      actorUid: 'uid_sup_none',
      actorName: 'مسؤول مقيد',
      actorRole: 'supervisor',
      createdAt: '2026-11-16T10:04:30.000Z',
    });
    await assertFails(supNoneCtx.firestore().doc(`notifications/${supNoneClosingNotif.id}`).set(supNoneClosingNotif));

    // 3. Supervisor WITH canCreateClosing (uid_sup_creator) SUCCEEDS atomically with closing doc
    const supCreatorClosing: ShiftClosing = {
      ...sampleClosing,
      id: 'closing_br_a1_2026-11-13_morning',
      date: '2026-11-13',
      employeeId: 'uid_sup_creator',
      employeeName: 'مسؤول إدخال إقفال',
    };
    const [supCreatorNotif] = buildClosingSubmittedNotifications({
      closing: supCreatorClosing,
      actorUid: 'uid_sup_creator',
      actorName: 'مسؤول إدخال إقفال',
      actorRole: 'supervisor',
      createdAt: '2026-11-16T10:05:00.000Z',
    });
    supCreatorNotifId = supCreatorNotif.id;
    const supCreatorBatch = supCreatorCtx.firestore().batch();
    supCreatorBatch.set(supCreatorCtx.firestore().doc(`closings/${supCreatorClosing.id}`), supCreatorClosing);
    supCreatorBatch.set(supCreatorCtx.firestore().doc(`notifications/${supCreatorNotif.id}`), supCreatorNotif);
    await assertSucceeds(supCreatorBatch.commit());

    // 4. Supervisor WITH canApproveClosings CANNOT forge CLOSING_APPROVED without updating closing in DB,
    //    but CAN emit CLOSING_APPROVED atomically with closing approval
    const forgedSupApproval = buildClosingReviewedNotifications({
      closing: { ...sampleClosing, id: 'closing_unapproved_fake' },
      action: 'approve',
      actorUid: 'uid_sup_app',
      actorName: 'مسؤول اعتماد',
      actorRole: 'supervisor',
      createdAt: '2026-11-16T10:06:00.000Z',
    });
    await assertFails(supAppCtx.firestore().doc(`notifications/${forgedSupApproval[0].id}`).set(forgedSupApproval[0]));

    const realReviewNotifs = buildClosingReviewedNotifications({
      closing: sampleClosing,
      action: 'approve',
      actorUid: 'uid_sup_app',
      actorName: 'مسؤول اعتماد',
      actorRole: 'supervisor',
      createdAt: '2026-11-16T10:07:00.000Z',
    });
    approvedUserNotifId = realReviewNotifs.find((n) => n.audienceScope === 'user')?.id || '';
    approvedBmNotifId = realReviewNotifs.find((n) => n.audienceScope === 'branch_manager')?.id || '';
    const approveBatch = supAppCtx.firestore().batch();
    approveBatch.update(supAppCtx.firestore().doc(`closings/${sampleClosing.id}`), {
      status: 'approved',
      reviewedBy: 'uid_sup_app',
      reviewedByName: 'مسؤول اعتماد',
      reviewedAt: '2026-11-16T10:07:00.000Z',
      updatedAt: '2026-11-16T10:07:00.000Z',
    });
    realReviewNotifs.forEach((n) => approveBatch.set(supAppCtx.firestore().doc(`notifications/${n.id}`), n));
    await assertSucceeds(approveBatch.commit());

    // 5. Legitimate SECURITY_ACCESS_DENIED_ALERT succeeds for own uid, but spoofing targetId for another uid fails
    const validSecAlert = buildSecurityAdminNotification({
      dedupKey: 'sec_denied_valid_emp1',
      type: 'SECURITY_ACCESS_DENIED_ALERT',
      severity: 'critical',
      orgId: 'org_a',
      audienceScope: 'org_manager',
      branchId: 'br_a1',
      actorUid: 'uid_emp_1',
      actorName: 'موظف 1',
      actorRole: 'employee',
      title: 'تنبيه أمني: محاولة وصول مرفوضة',
      body: 'رفض صلاحية متوقع',
      targetType: 'security',
      targetId: 'uid_emp_1',
      createdAt: '2026-11-16T10:08:00.000Z',
    });
    await assertSucceeds(emp1Ctx.firestore().doc(`notifications/${validSecAlert.id}`).set(validSecAlert));

    const spoofedTargetSecAlert = {
      ...validSecAlert,
      id: 'ntf_sec_spoof_target',
      dedupKey: 'sec_denied_spoof_target',
      targetId: 'uid_emp_2',
    };
    await assertFails(emp1Ctx.firestore().doc(`notifications/${spoofedTargetSecAlert.id}`).set(spoofedTargetSecAlert));
  });

  // 3. Supervisor permission gating vs Manager vs Branch Manager vs Employee vs Cross-Org
  const purchaseNotif = buildPurchaseRecordedNotification({
    purchaseId: 'pur_a1',
    orgId: 'org_a',
    branchId: 'br_a1',
    branchName: 'فرع أ1',
    supplierName: 'مورد السلام',
    totalAmount: 900,
    currency: 'SAR',
    needsReview: true,
    actorUid: 'uid_bm_1',
    actorName: 'مسؤول فرع 1',
    actorRole: 'branch_manager',
    createdAt: '2026-11-16T10:15:00.000Z',
  });
  const supplierNotif = buildSupplierAddedNotification({
    supplierId: 'sup_1',
    orgId: 'org_a',
    supplierName: 'مورد السلام',
    actorUid: 'uid_sup_pur',
    actorName: 'مسؤول مشتريات',
    actorRole: 'supervisor',
    createdAt: '2026-11-16T10:20:00.000Z',
  });
  const empLifecycleNotifs = buildEmployeeLifecycleNotifications({
    action: 'disabled',
    orgId: 'org_a',
    actorUid: 'uid_mgr_a',
    actorName: 'مدير أ',
    employeeUid: 'uid_emp_1',
    employeeName: 'موظف 1',
    employeeRole: 'employee',
    branchId: 'br_a1',
    branchName: 'فرع أ1',
    createdAt: '2026-11-16T10:25:00.000Z',
  });

  await runCase('Manager, Purchaser Supervisor, and BM1 create valid scoped notifications cleanly', async () => {
    await assertSucceeds(bm1Ctx.firestore().doc(`notifications/${purchaseNotif.id}`).set(purchaseNotif));
    await assertSucceeds(supPurCtx.firestore().doc(`notifications/${supplierNotif.id}`).set(supplierNotif));
    for (const n of empLifecycleNotifs) {
      await assertSucceeds(mgrACtx.firestore().doc(`notifications/${n.id}`).set(n));
    }
  });

  await runCase('Supervisors ONLY list feeds matching explicit true permissions; unauthorized feeds DENIED', async () => {
    // Approver Supervisor CAN read closings feed, DENIED purchases feed
    await assertSucceeds(
      supAppCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_perm:org_a:canApproveClosings').get()
    );
    await assertFails(
      supAppCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_perm:org_a:canManagePurchases').get()
    );
    await assertFails(
      supAppCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_mgr:org_a').get()
    );

    // Purchaser Supervisor CAN read purchases feed, DENIED closings feed
    await assertSucceeds(
      supPurCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_perm:org_a:canManagePurchases').get()
    );
    await assertFails(
      supPurCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_perm:org_a:canApproveClosings').get()
    );

    // Restricted Supervisor DENIED both
    await assertFails(
      supNoneCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_perm:org_a:canApproveClosings').get()
    );
    await assertFails(
      supNoneCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_perm:org_a:canManagePurchases').get()
    );
  });

  await runCase('Branch Manager reads ONLY own assigned branch feed and CANNOT read other branch or org_mgr-only feeds', async () => {
    const bm1Feed = await assertSucceeds(
      bm1Ctx
        .firestore()
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'branch_mgr:org_a:br_a1')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
        .get()
    );
    assert.ok(bm1Feed.size >= 4);
    // Verify newest-first order by inverted-timestamp ID (10:15 -> 10:07 -> 10:05 -> 10:00)
    assert.equal(bm1Feed.docs[0].id, purchaseNotif.id);
    assert.equal(bm1Feed.docs[1].id, approvedBmNotifId);
    assert.equal(bm1Feed.docs[2].id, supCreatorNotifId);
    assert.equal(bm1Feed.docs[3].id, closingSubNotif.id);

    // BM2 DENIED BM1's feed & doc
    await assertFails(
      bm2Ctx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'branch_mgr:org_a:br_a1').get()
    );
    await assertFails(bm2Ctx.firestore().doc(`notifications/${closingSubNotif.id}`).get());

    // BM1 DENIED org_mgr-only feed & doc
    await assertFails(
      bm1Ctx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_mgr:org_a').get()
    );
    await assertFails(bm1Ctx.firestore().doc(`notifications/${empLifecycleNotifs[0].id}`).get());
  });

  await runCase('Employees read ONLY personal user notifications and are DENIED org/branch/other-user feeds', async () => {
    const emp1Personal = await assertSucceeds(
      emp1Ctx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'user:org_a:uid_emp_1').orderBy(firebase.firestore.FieldPath.documentId(), 'asc').get()
    );
    assert.equal(emp1Personal.size, 2);
    assert.equal(emp1Personal.docs[0].id, empLifecycleNotifs[1].id);
    assert.equal(emp1Personal.docs[1].id, approvedUserNotifId);

    // emp2 DENIED emp1's personal feed & doc
    await assertFails(
      emp2Ctx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'user:org_a:uid_emp_1').get()
    );
    await assertFails(emp2Ctx.firestore().doc(`notifications/${empLifecycleNotifs[1].id}`).get());
    await assertFails(
      emp1Ctx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'branch_mgr:org_a:br_a1').get()
    );
  });

  await runCase('Strict cross-organization, expired-subscription, and Super Admin vs Tenant isolation', async () => {
    await assertFails(
      mgrBCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_mgr:org_a').get()
    );
    await assertFails(mgrBCtx.firestore().doc(`notifications/${closingSubNotif.id}`).get());
    await assertFails(
      mgrExpCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_mgr:org_exp').get()
    );

    // Legacy org owned by onlak2030@gmail.com works normally on its own org
    const legacyNotif = buildEmployeeLifecycleNotifications({
      action: 'created',
      orgId: 'org_legacy',
      actorUid: 'uid_onlak',
      actorName: 'مدير قديم',
      employeeUid: 'uid_onlak',
      employeeName: 'مدير قديم',
      employeeRole: 'manager',
      createdAt: '2026-11-16T10:30:00.000Z',
    })[0];
    await assertSucceeds(onlakCtx.firestore().doc(`notifications/${legacyNotif.id}`).set(legacyNotif));
    await assertSucceeds(
      onlakCtx.firestore().collection('notifications').where('feedKeys', 'array-contains', 'org_mgr:org_legacy').get()
    );
  });

  await runCase('Mark-as-read succeeds for authorized recipients ONLY; tampering and DELETE are strictly DENIED', async () => {
    const personalNotifId = empLifecycleNotifs[1].id;
    // Employee marks personal notification as read
    await assertSucceeds(
      emp1Ctx.firestore().doc(`notifications/${personalNotifId}`).update({
        'readBy.uid_emp_1': '2026-11-16T10:35:00.000Z',
        isRead: true,
        readAt: '2026-11-16T10:35:00.000Z',
        updatedAt: '2026-11-16T10:35:00.000Z',
      })
    );

    // Manager marks org_mgr closing notification as read
    await assertSucceeds(
      mgrACtx.firestore().doc(`notifications/${closingSubNotif.id}`).update({
        'readBy.uid_mgr_a': '2026-11-16T10:36:00.000Z',
        updatedAt: '2026-11-16T10:36:00.000Z',
      })
    );

    // Tamper attempts must FAIL: modifying title, modifying another user's readBy key
    await assertFails(
      mgrACtx.firestore().doc(`notifications/${closingSubNotif.id}`).update({
        title: 'عنوان مزور',
        updatedAt: '2026-11-16T10:37:00.000Z',
      })
    );
    await assertFails(
      mgrACtx.firestore().doc(`notifications/${closingSubNotif.id}`).update({
        'readBy.uid_bm_1': '2026-11-16T10:37:00.000Z',
        updatedAt: '2026-11-16T10:37:00.000Z',
      })
    );

    // Delete MUST FAIL for employee, manager, and even super admin!
    await assertFails(emp1Ctx.firestore().doc(`notifications/${personalNotifId}`).delete());
    await assertFails(mgrACtx.firestore().doc(`notifications/${closingSubNotif.id}`).delete());
    await assertFails(saCtx.firestore().doc(`notifications/${saNotif.id}`).delete());
  });

  await runCase('Scoped list existence check succeeds with zero permission-denied on missing or existing docs and rejects cross-org/non-SA probes', async () => {
    const missingId = '9999999999999_nonexistent_check';
    // Missing doc via scoped list -> succeeds cleanly (empty) for verified Super Admin & Org A Manager
    const saMissingSnap = await assertSucceeds(
      saCtx
        .firestore()
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'super_admin')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
        .startAt(missingId)
        .endAt(missingId)
        .limit(1)
        .get()
    );
    assert.equal(saMissingSnap.empty, true);

    const mgrMissingSnap = await assertSucceeds(
      mgrACtx
        .firestore()
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'org_mgr:org_a')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
        .startAt(missingId)
        .endAt(missingId)
        .limit(1)
        .get()
    );
    assert.equal(mgrMissingSnap.empty, true);

    // Existing doc via scoped list -> returns exact 1 document
    const saExistingSnap = await assertSucceeds(
      saCtx
        .firestore()
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'super_admin')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
        .startAt(saNotif.id)
        .endAt(saNotif.id)
        .limit(1)
        .get()
    );
    assert.equal(saExistingSnap.size, 1);
    assert.equal(saExistingSnap.docs[0].id, saNotif.id);

    const mgrExistingSnap = await assertSucceeds(
      mgrACtx
        .firestore()
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'org_mgr:org_a')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
        .startAt(closingSubNotif.id)
        .endAt(closingSubNotif.id)
        .limit(1)
        .get()
    );
    assert.equal(mgrExistingSnap.size, 1);
    assert.equal(mgrExistingSnap.docs[0].id, closingSubNotif.id);

    // Unauthorized callers remain strictly DENIED from probing other feeds
    await assertFails(
      onlakCtx
        .firestore()
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'super_admin')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
        .startAt(missingId)
        .endAt(missingId)
        .limit(1)
        .get()
    );
    await assertFails(
      mgrBCtx
        .firestore()
        .collection('notifications')
        .where('feedKeys', 'array-contains', 'org_mgr:org_a')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
        .startAt(missingId)
        .endAt(missingId)
        .limit(1)
        .get()
    );
  });

  await testEnv.cleanup();
  console.log(`\nALL ${passed} PHASE 4.6 NOTIFICATION EMULATOR TESTS PASSED`);
}

runPhase46EmulatorTests().catch((err) => {
  console.error('Phase 4.6 Notification Emulator test failed:', err);
  process.exit(1);
});
