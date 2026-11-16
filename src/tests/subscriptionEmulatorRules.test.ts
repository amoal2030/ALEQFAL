/**
 * Phase 2 Subscription & Manager Invite Security Emulator Test Suite
 * Tests real `firestore.rules` against an isolated local Firestore Emulator.
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
const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;

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

async function runSubscriptionRulesTests() {
  console.log('========================================================================');
  console.log('   PHASE 2: SUBSCRIPTION & INVITES SECURITY TESTS (FIRESTORE EMULATOR)  ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-subscription-phase2-tests',
    firestore: {
      rules: rulesContent,
      host,
      port,
    },
  });

  await testEnv.clearFirestore();

  const nowMs = Date.now();
  const oneHourMs = 60 * 60 * 1000;
  const oneDayMs = 24 * oneHourMs;

  const tsPast2d = Timestamp.fromMillis(nowMs - 2 * oneDayMs);
  const tsPast1h = Timestamp.fromMillis(nowMs - oneHourMs);
  const tsFuture1d = Timestamp.fromMillis(nowMs + oneDayMs);
  const tsFuture7d = Timestamp.fromMillis(nowMs + 7 * oneDayMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);

  // Seed organizations in every lifecycle state
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // 1. Legacy organization (no subscription fields)
    await db.doc('organizations/org_legacy').set({
      id: 'org_legacy',
      name: 'مؤسسة قديمة بدون اشتراك',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_legacy',
      ownerEmail: 'mgr.legacy@example.com',
      ownerName: 'مدير قديم',
      driveConnected: false,
      createdAt: '2026-10-01T08:00:00Z',
      updatedAt: '2026-10-01T08:00:00Z',
    });

    // 2. Active subscription organization (start <= now < end)
    await db.doc('organizations/org_active').set({
      id: 'org_active',
      name: 'مؤسسة اشتراك ساري',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'mgr_active',
      ownerEmail: 'mgr.active@example.com',
      ownerName: 'مدير نشط',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast2d,
      subscriptionEndAt: tsFuture30d,
      subscriptionUpdatedAt: tsPast2d,
      subscriptionUpdatedBy: 'amoal2030@gmail.com',
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });

    // 3. Future subscription organization (now < start)
    await db.doc('organizations/org_future').set({
      id: 'org_future',
      name: 'مؤسسة اشتراك مستقبلي',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_future',
      ownerEmail: 'mgr.future@example.com',
      ownerName: 'مدير مستقبلي',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsFuture1d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-15T08:00:00Z',
      updatedAt: '2026-11-15T08:00:00Z',
    });

    // 4. Expired subscription organization (end < now)
    await db.doc('organizations/org_expired').set({
      id: 'org_expired',
      name: 'مؤسسة اشتراك منتهي',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_expired',
      ownerEmail: 'mgr.expired@example.com',
      ownerName: 'مدير منتهي',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: 'trial_7d',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast2d,
      subscriptionEndAt: tsPast1h,
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });

    // 5. Suspended subscription organization (subscriptionStatus: 'suspended' + isActive: false)
    await db.doc('organizations/org_suspended').set({
      id: 'org_suspended',
      name: 'مؤسسة موقوفة',
      activityType: 'services',
      currency: 'SAR',
      ownerId: 'mgr_suspended',
      ownerEmail: 'onlak2030@gmail.com',
      ownerName: 'مدير موقوف',
      driveConnected: false,
      isActive: false,
      subscriptionPlan: '3m',
      subscriptionStatus: 'suspended',
      subscriptionStartAt: tsPast2d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });

    // 6. Malformed/Incomplete subscription org (missing endAt) -> fail closed!
    await db.doc('organizations/org_malformed').set({
      id: 'org_malformed',
      name: 'مؤسسة بيانات اشتراك ناقصة',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_malformed',
      ownerEmail: 'mgr.malformed@example.com',
      ownerName: 'مدير ناقص',
      driveConnected: false,
      isActive: true,
      subscriptionStatus: 'active',
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    });

    // Branches & Users & Closings & Attachments for each org
    const orgSeeds = [
      { key: 'legacy', orgId: 'org_legacy', email: 'mgr.legacy@example.com' },
      { key: 'active', orgId: 'org_active', email: 'mgr.active@example.com' },
      { key: 'future', orgId: 'org_future', email: 'mgr.future@example.com' },
      { key: 'expired', orgId: 'org_expired', email: 'mgr.expired@example.com' },
      { key: 'suspended', orgId: 'org_suspended', email: 'onlak2030@gmail.com' },
      { key: 'malformed', orgId: 'org_malformed', email: 'mgr.malformed@example.com' },
    ];

    for (const s of orgSeeds) {
      await db.doc(`branches/br_${s.key}`).set({
        id: `br_${s.key}`,
        orgId: s.orgId,
        name: `فرع ${s.key}`,
        code: 'B-01',
        isActive: true,
        createdAt: '2026-11-01T08:00:00Z',
      });

      await db.doc(`users/mgr_${s.key}`).set({
        uid: `mgr_${s.key}`,
        orgId: s.orgId,
        email: s.email,
        displayName: `مدير ${s.key}`,
        role: 'manager',
        isActive: true,
        createdAt: '2026-11-01T08:00:00Z',
      });

      await db.doc(`users/emp_${s.key}`).set({
        uid: `emp_${s.key}`,
        orgId: s.orgId,
        branchId: `br_${s.key}`,
        branchName: `فرع ${s.key}`,
        email: `emp.${s.key}@example.com`,
        displayName: `موظف ${s.key}`,
        role: 'employee',
        isActive: true,
        createdAt: '2026-11-01T08:00:00Z',
      });

      await db.doc(`closings/cls_${s.key}`).set({
        id: `cls_${s.key}`,
        orgId: s.orgId,
        branchId: `br_${s.key}`,
        branchName: `فرع ${s.key}`,
        employeeId: `emp_${s.key}`,
        employeeName: `موظف ${s.key}`,
        date: '2026-11-15',
        period: 'morning',
        cashSales: 1000,
        cardSales: 500,
        totalSales: 1500,
        expenses: 100,
        remainingInBox: 900,
        netPeriod: 1400,
        status: 'pending_review',
        createdAt: '2026-11-15T08:00:00Z',
        updatedAt: '2026-11-15T08:00:00Z',
      });

      await db.doc(`attachments/att_${s.key}`).set({
        id: `att_${s.key}`,
        orgId: s.orgId,
        branchId: `br_${s.key}`,
        closingId: `cls_${s.key}`,
        fileName: 'receipt.jpg',
        uploadedBy: `emp_${s.key}`,
        uploadedAt: '2026-11-15T08:00:00Z',
      });

      await db.doc(`auditLogs/log_${s.key}`).set({
        id: `log_${s.key}`,
        orgId: s.orgId,
        actorId: `mgr_${s.key}`,
        actorName: `مدير ${s.key}`,
        actorRole: 'manager',
        action: 'ORGANIZATION_ESTABLISHED',
        targetType: 'organization',
        targetId: s.orgId,
        details: 'تأسيس أولي للسجل',
        timestamp: '2026-11-01T08:00:00Z',
      });

      await db.doc(`closingArchives/cls_${s.key}`).set({
        closingId: `cls_${s.key}`,
        orgId: s.orgId,
        branchId: `br_${s.key}`,
        yearMonth: '2026-11',
        archiveStatus: 'pending_drive_sync',
        updatedAt: '2026-11-15T08:00:00Z',
      });
    }
  });

  const outcomes: TestOutcome[] = [];
  async function runCase(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      outcomes.push({ name, passed: true });
      console.log(`✔ PASS: ${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ name, passed: false, error: msg });
      console.error(`✖ FAIL: ${name}\n   ↳ ${msg}`);
    }
  }

  const saDb = testEnv.authenticatedContext('uid_sa', { email: 'amoal2030@gmail.com', email_verified: true }).firestore();
  const saUnverifiedDb = testEnv.authenticatedContext('uid_sa_unv', { email: 'amoal2030@gmail.com', email_verified: false }).firestore();
  const onlakDb = testEnv.authenticatedContext('mgr_suspended', { email: 'onlak2030@gmail.com', email_verified: true }).firestore();

  const mgrLegacyDb = testEnv.authenticatedContext('mgr_legacy', { email: 'mgr.legacy@example.com', email_verified: true }).firestore();
  const empLegacyDb = testEnv.authenticatedContext('emp_legacy', { email: 'emp.legacy@example.com', email_verified: true }).firestore();

  const mgrActiveDb = testEnv.authenticatedContext('mgr_active', { email: 'mgr.active@example.com', email_verified: true }).firestore();
  const empActiveDb = testEnv.authenticatedContext('emp_active', { email: 'emp.active@example.com', email_verified: true }).firestore();

  const mgrFutureDb = testEnv.authenticatedContext('mgr_future', { email: 'mgr.future@example.com', email_verified: true }).firestore();
  const empFutureDb = testEnv.authenticatedContext('emp_future', { email: 'emp.future@example.com', email_verified: true }).firestore();

  const mgrExpiredDb = testEnv.authenticatedContext('mgr_expired', { email: 'mgr.expired@example.com', email_verified: true }).firestore();
  const empExpiredDb = testEnv.authenticatedContext('emp_expired', { email: 'emp.expired@example.com', email_verified: true }).firestore();

  const empSuspendedDb = testEnv.authenticatedContext('emp_suspended', { email: 'emp.suspended@example.com', email_verified: true }).firestore();

  const mgrMalformedDb = testEnv.authenticatedContext('mgr_malformed', { email: 'mgr.malformed@example.com', email_verified: true }).firestore();
  const empMalformedDb = testEnv.authenticatedContext('emp_malformed', { email: 'emp.malformed@example.com', email_verified: true }).firestore();

  const randomUserDb = testEnv.authenticatedContext('uid_random', { email: 'random.user@gmail.com', email_verified: true }).firestore();

  try {
    // 1. Verified Super Admin can create organization + branch + invite atomically, and stays blocked from org accounting
    await runCase('1. Verified Super Admin creates organization with subscription + main branch + invite, while accounting access stays denied', async () => {
      const batch = saDb.batch();
      const orgId = 'org_sa_created_01';
      const branchId = 'br_sa_created_01';
      const inviteEmail = 'invited.owner@gmail.com';

      batch.set(saDb.doc(`organizations/${orgId}`), {
        id: orgId,
        name: 'مؤسسة الفجر الجديدة',
        activityType: 'retail',
        currency: 'SAR',
        ownerId: '',
        ownerEmail: 'Invited.Owner@Gmail.com',
        ownerName: 'صاحب الفجر',
        driveConnected: false,
        isActive: true,
        subscriptionPlan: 'trial_7d',
        subscriptionStatus: 'active',
        subscriptionStartAt: tsPast1h,
        subscriptionEndAt: tsFuture7d,
        subscriptionUpdatedAt: serverTimestamp(),
        subscriptionUpdatedBy: 'amoal2030@gmail.com',
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      });
      batch.set(saDb.doc(`branches/${branchId}`), {
        id: branchId,
        orgId,
        name: 'الفرع الرئيسي',
        code: 'B-01',
        isActive: true,
        createdAt: '2026-11-15T10:00:00Z',
      });
      batch.set(saDb.doc(`managerInvites/${inviteEmail}`), {
        id: inviteEmail,
        email: 'Invited.Owner@Gmail.com',
        emailNormalized: inviteEmail,
        orgId,
        orgName: 'مؤسسة الفجر الجديدة',
        managerName: 'صاحب الفجر',
        role: 'manager',
        status: 'pending',
        createdAt: serverTimestamp(),
        createdBy: 'amoal2030@gmail.com',
        updatedAt: serverTimestamp(),
      });
      await assertSucceeds(batch.commit());

      // Super Admin MUST NOT read or mutate other orgs' accounting closings/attachments/auditLogs/archives
      await assertFails(saDb.doc('closings/cls_active').get());
      await assertFails(saDb.collection('closings').get());
      await assertFails(saDb.doc('attachments/att_active').get());
      await assertFails(saDb.doc('auditLogs/log_active').get());
      await assertFails(saDb.doc('closingArchives/cls_active').get());
    });

    // 2. Non-Super-Admin (random user, manager, onlak2030@gmail.com, unverified amoal2030@gmail.com) CANNOT create organizations
    await runCase('2. Any user other than verified amoal2030@gmail.com cannot create organizations', async () => {
      const payload = (id: string, ownerId: string, email: string) => ({
        id,
        name: 'مؤسسة غير مصرح بها',
        activityType: 'retail',
        currency: 'SAR',
        ownerId,
        ownerEmail: email,
        ownerName: 'مستخدم',
        driveConnected: false,
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      });
      await assertFails(randomUserDb.doc('organizations/org_unauth_1').set(payload('org_unauth_1', 'uid_random', 'random.user@gmail.com')));
      await assertFails(mgrActiveDb.doc('organizations/org_unauth_2').set(payload('org_unauth_2', 'mgr_active', 'mgr.active@example.com')));
      await assertFails(onlakDb.doc('organizations/org_unauth_3').set(payload('org_unauth_3', 'mgr_suspended', 'onlak2030@gmail.com')));
      await assertFails(saUnverifiedDb.doc('organizations/org_unauth_4').set(payload('org_unauth_4', 'uid_sa_unv', 'amoal2030@gmail.com')));
    });

    // 3. Manager cannot modify subscription dates, plan, status, or isActive
    await runCase('3. Manager cannot modify subscription dates, plan, status, or org isActive', async () => {
      const tsFuture60d = Timestamp.fromMillis(nowMs + 60 * oneDayMs);
      await assertFails(mgrActiveDb.doc('organizations/org_active').update({ subscriptionEndAt: tsFuture60d }));
      await assertFails(mgrActiveDb.doc('organizations/org_active').update({ subscriptionPlan: '1y' }));
      await assertFails(mgrActiveDb.doc('organizations/org_active').update({ subscriptionStatus: 'suspended' }));
      await assertFails(mgrActiveDb.doc('organizations/org_active').update({ isActive: false }));
      await assertFails(mgrExpiredDb.doc('organizations/org_expired').update({ subscriptionEndAt: tsFuture30d }));
      await assertFails(mgrLegacyDb.doc('organizations/org_legacy').update({ subscriptionStatus: 'active', subscriptionEndAt: tsFuture30d }));
      // Legitimate Drive metadata update by active manager still succeeds
      await assertSucceeds(mgrActiveDb.doc('organizations/org_active').update({ driveConnected: false, updatedAt: '2026-11-15T10:15:00Z' }));
    });

    // 4. Employee cannot modify subscription or organization fields
    await runCase('4. Employee cannot modify subscription fields or organization doc', async () => {
      await assertFails(empActiveDb.doc('organizations/org_active').update({ subscriptionEndAt: tsFuture30d }));
      await assertFails(empActiveDb.doc('organizations/org_active').update({ subscriptionStatus: 'active' }));
      await assertFails(empActiveDb.doc('organizations/org_active').update({ name: 'تعديل من موظف' }));
      await assertFails(empExpiredDb.doc('organizations/org_expired').update({ subscriptionEndAt: tsFuture30d }));
    });

    // 5. Legacy organization without subscription fields continues to operate normally
    await runCase('5. Legacy organization without subscription fields continues all normal operations', async () => {
      await assertSucceeds(mgrLegacyDb.collection('branches').where('orgId', '==', 'org_legacy').get());
      await assertSucceeds(mgrLegacyDb.collection('closings').where('orgId', '==', 'org_legacy').get());
      await assertSucceeds(mgrLegacyDb.collection('users').where('orgId', '==', 'org_legacy').get());
      await assertSucceeds(empLegacyDb.doc('closings/cls_legacy').get());
      await assertSucceeds(empLegacyDb.doc('attachments/att_legacy').get());
      await assertSucceeds(
        empLegacyDb.doc('closings/cls_legacy_new').set({
          id: 'cls_legacy_new',
          orgId: 'org_legacy',
          branchId: 'br_legacy',
          branchName: 'فرع legacy',
          employeeId: 'emp_legacy',
          employeeName: 'موظف legacy',
          date: '2026-11-15',
          period: 'evening',
          cashSales: 200,
          cardSales: 300,
          totalSales: 500,
          expenses: 50,
          remainingInBox: 150,
          netPeriod: 450,
          status: 'draft',
          createdAt: '2026-11-15T10:00:00Z',
          updatedAt: '2026-11-15T10:00:00Z',
        })
      );
    });

    // 6. Active subscription organization permits all authorized operational workflows
    await runCase('6. Active subscription organization allows all authorized manager & employee operations', async () => {
      await assertSucceeds(mgrActiveDb.collection('branches').where('orgId', '==', 'org_active').get());
      await assertSucceeds(mgrActiveDb.collection('users').where('orgId', '==', 'org_active').get());
      await assertSucceeds(mgrActiveDb.collection('auditLogs').where('orgId', '==', 'org_active').get());
      await assertSucceeds(mgrActiveDb.collection('closingArchives').where('orgId', '==', 'org_active').get());
      await assertSucceeds(empActiveDb.doc('attachments/att_active').get());
      await assertSucceeds(
        empActiveDb.doc('closings/cls_active_new').set({
          id: 'cls_active_new',
          orgId: 'org_active',
          branchId: 'br_active',
          branchName: 'فرع active',
          employeeId: 'emp_active',
          employeeName: 'موظف active',
          date: '2026-11-15',
          period: 'evening',
          cashSales: 500,
          cardSales: 500,
          totalSales: 1000,
          expenses: 100,
          remainingInBox: 400,
          netPeriod: 900,
          status: 'pending_review',
          createdAt: '2026-11-15T10:00:00Z',
          updatedAt: '2026-11-15T10:00:00Z',
        })
      );
    });

    // 7. Organization BEFORE subscriptionStartAt is operationally blocked (while identity/org status get remains readable)
    await runCase('7. Organization before subscriptionStartAt is operationally blocked for manager & employee', async () => {
      // Self identity & own org status doc remain readable
      await assertSucceeds(mgrFutureDb.doc('users/mgr_future').get());
      await assertSucceeds(mgrFutureDb.doc('organizations/org_future').get());
      await assertSucceeds(empFutureDb.doc('users/emp_future').get());
      await assertSucceeds(empFutureDb.doc('organizations/org_future').get());

      // Operational collections blocked
      await assertFails(mgrFutureDb.collection('branches').where('orgId', '==', 'org_future').get());
      await assertFails(mgrFutureDb.collection('closings').where('orgId', '==', 'org_future').get());
      await assertFails(mgrFutureDb.collection('users').where('orgId', '==', 'org_future').get());
      await assertFails(mgrFutureDb.doc('users/emp_future').get());
      await assertFails(empFutureDb.doc('closings/cls_future').get());
      await assertFails(
        empFutureDb.doc('closings/cls_future_new').set({
          id: 'cls_future_new',
          orgId: 'org_future',
          branchId: 'br_future',
          employeeId: 'emp_future',
          period: 'evening',
          cashSales: 100,
          cardSales: 0,
          expenses: 0,
          status: 'draft',
        })
      );
    });

    // 8. Organization AFTER subscriptionEndAt is operationally blocked (even if subscriptionStatus string is stale 'active')
    await runCase('8. Organization after subscriptionEndAt is operationally blocked via request.time', async () => {
      // Identity self-doc & own org get allowed; sibling user read MUST fail
      await assertSucceeds(mgrExpiredDb.doc('users/mgr_expired').get());
      await assertSucceeds(mgrExpiredDb.doc('organizations/org_expired').get());
      await assertSucceeds(empExpiredDb.doc('users/emp_expired').get());
      await assertSucceeds(empExpiredDb.doc('organizations/org_expired').get());
      await assertFails(mgrExpiredDb.doc('users/emp_expired').get());
      await assertFails(empExpiredDb.doc('users/mgr_expired').get());

      // All operational collections blocked for both manager & employee
      await assertFails(mgrExpiredDb.collection('branches').where('orgId', '==', 'org_expired').get());
      await assertFails(empExpiredDb.collection('branches').where('orgId', '==', 'org_expired').get());
      await assertFails(mgrExpiredDb.collection('closings').where('orgId', '==', 'org_expired').get());
      await assertFails(empExpiredDb.doc('closings/cls_expired').get());
      await assertFails(mgrExpiredDb.doc('attachments/att_expired').get());
      await assertFails(empExpiredDb.doc('attachments/att_expired').get());
      await assertFails(mgrExpiredDb.collection('auditLogs').where('orgId', '==', 'org_expired').get());
      await assertFails(mgrExpiredDb.collection('closingArchives').where('orgId', '==', 'org_expired').get());
      await assertFails(empExpiredDb.doc('closingArchives/cls_expired').get());
      await assertFails(mgrExpiredDb.doc('users/emp_expired').update({ isActive: false }));
      await assertFails(empExpiredDb.doc('users/emp_expired').update({ displayName: 'تعديل منتهي' }));
    });

    // 9. Suspended & malformed organizations fail closed operationally
    await runCase('9. Suspended and malformed-subscription organizations block all operational reads/writes', async () => {
      // Suspended (onlak2030@gmail.com manager + employee)
      await assertSucceeds(onlakDb.doc('users/mgr_suspended').get());
      await assertSucceeds(onlakDb.doc('organizations/org_suspended').get());
      await assertFails(onlakDb.collection('branches').where('orgId', '==', 'org_suspended').get());
      await assertFails(onlakDb.collection('closings').where('orgId', '==', 'org_suspended').get());
      await assertFails(onlakDb.doc('users/emp_suspended').get());
      await assertFails(empSuspendedDb.doc('closings/cls_suspended').get());
      await assertFails(empSuspendedDb.doc('attachments/att_suspended').get());

      // Malformed/incomplete subscription fields (missing endAt/startAt/plan)
      await assertFails(mgrMalformedDb.collection('branches').where('orgId', '==', 'org_malformed').get());
      await assertFails(mgrMalformedDb.collection('closings').where('orgId', '==', 'org_malformed').get());
      await assertFails(empMalformedDb.doc('closings/cls_malformed').get());
      await assertFails(empMalformedDb.doc('closingArchives/cls_malformed').get());
    });

    // 10. Cross-tenant isolation: member of org_active cannot access org_legacy or any other org
    await runCase('10. Organization employee & manager cannot access any other organization data', async () => {
      await assertFails(empActiveDb.doc('organizations/org_legacy').get());
      await assertFails(empActiveDb.doc('branches/br_legacy').get());
      await assertFails(empActiveDb.doc('closings/cls_legacy').get());
      await assertFails(empActiveDb.doc('attachments/att_legacy').get());
      await assertFails(empActiveDb.doc('closingArchives/cls_legacy').get());
      await assertFails(empActiveDb.doc('users/emp_legacy').get());
      await assertFails(mgrActiveDb.doc('closings/cls_legacy').get());
      await assertFails(mgrActiveDb.doc('users/emp_legacy').get());
    });

    // 11. Manager invite spoofing, mismatched email, unverified email, or non-atomic claim MUST fail; valid claim succeeds
    await runCase('11. Manager invite cannot be spoofed or claimed with mismatched/unverified email; atomic verified claim succeeds & blocks replay', async () => {
      const targetOrgId = 'org_sa_created_01';
      const inviteDocPath = 'managerInvites/invited.owner@gmail.com';

      // Wrong email tries to read or claim invite
      await assertFails(randomUserDb.doc(inviteDocPath).get());
      await assertFails(
        randomUserDb.doc(inviteDocPath).update({
          status: 'accepted',
          acceptedByUid: 'uid_random',
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // Matching email WITHOUT email_verified=true MUST fail
      const unverifiedInvitedDb = testEnv.authenticatedContext('uid_unverified_inv', {
        email: 'invited.owner@gmail.com',
        email_verified: false,
      }).firestore();
      await assertFails(unverifiedInvitedDb.doc(inviteDocPath).get());

      // Matching verified email trying non-atomic invite accept (without creating users/{uid} & binding ownerId) MUST fail
      const invitedDb = testEnv.authenticatedContext('uid_invited_mgr', {
        email: 'Invited.Owner@Gmail.com',
        email_verified: true,
      }).firestore();
      await assertSucceeds(invitedDb.doc(inviteDocPath).get());
      await assertFails(
        invitedDb.doc(inviteDocPath).update({
          status: 'accepted',
          acceptedByUid: 'uid_invited_mgr',
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // Matching verified email trying to create users/{uid} without updating invite MUST fail
      await assertFails(
        invitedDb.doc('users/uid_invited_mgr').set({
          uid: 'uid_invited_mgr',
          orgId: targetOrgId,
          email: 'Invited.Owner@Gmail.com',
          displayName: 'صاحب الفجر',
          role: 'manager',
          isActive: true,
          createdAt: '2026-11-15T10:20:00Z',
        })
      );

      // Full atomic claim batch (invite + org ownerId + user doc + audit log) SUCCEEDS
      const claimBatch = invitedDb.batch();
      claimBatch.update(invitedDb.doc(inviteDocPath), {
        status: 'accepted',
        acceptedByUid: 'uid_invited_mgr',
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      claimBatch.update(invitedDb.doc(`organizations/${targetOrgId}`), {
        ownerId: 'uid_invited_mgr',
        ownerName: 'صاحب الفجر',
        updatedAt: '2026-11-15T10:25:00Z',
      });
      claimBatch.set(invitedDb.doc('users/uid_invited_mgr'), {
        uid: 'uid_invited_mgr',
        orgId: targetOrgId,
        email: 'invited.owner@gmail.com',
        displayName: 'صاحب الفجر',
        role: 'manager',
        isActive: true,
        createdAt: '2026-11-15T10:25:00Z',
      });
      claimBatch.set(invitedDb.doc('auditLogs/log_claim_sa_01'), {
        id: 'log_claim_sa_01',
        orgId: targetOrgId,
        actorId: 'uid_invited_mgr',
        actorName: 'صاحب الفجر',
        actorRole: 'manager',
        action: 'ORGANIZATION_ESTABLISHED',
        targetType: 'organization',
        targetId: targetOrgId,
        details: 'تفعيل حساب المدير عبر الدعوة المعتمدة',
        timestamp: '2026-11-15T10:25:00Z',
      });
      await assertSucceeds(claimBatch.commit());

      // Replay attempt after acceptance MUST fail
      await assertFails(
        invitedDb.doc(inviteDocPath).update({
          status: 'accepted',
          acceptedByUid: 'uid_invited_mgr',
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    });

    // 12. Only Super Admin can create, modify, or cancel managerInvites (cancelled invite cannot be claimed)
    await runCase('12. Non-Super-Admin cannot create/modify/cancel managerInvites; Super Admin cancellation blocks claim', async () => {
      const targetEmail = 'another.manager@gmail.com';
      const selfInvitePayload = {
        id: targetEmail,
        email: targetEmail,
        emailNormalized: targetEmail,
        orgId: 'org_active',
        role: 'manager',
        status: 'pending',
        createdAt: serverTimestamp(),
        createdBy: 'uid_random',
        updatedAt: serverTimestamp(),
      };

      await assertFails(randomUserDb.doc('managerInvites/random.user@gmail.com').set({
        ...selfInvitePayload,
        id: 'random.user@gmail.com',
        email: 'random.user@gmail.com',
        emailNormalized: 'random.user@gmail.com',
      }));
      await assertFails(mgrActiveDb.doc(`managerInvites/${targetEmail}`).set(selfInvitePayload));
      await assertFails(onlakDb.doc(`managerInvites/${targetEmail}`).set(selfInvitePayload));
      await assertFails(saUnverifiedDb.doc(`managerInvites/${targetEmail}`).set(selfInvitePayload));

      // Super Admin creates and cancels an invite cleanly
      await assertSucceeds(
        saDb.doc(`managerInvites/${targetEmail}`).set({
          id: targetEmail,
          email: targetEmail,
          emailNormalized: targetEmail,
          orgId: 'org_active',
          role: 'manager',
          status: 'pending',
          createdAt: serverTimestamp(),
          createdBy: 'amoal2030@gmail.com',
          updatedAt: serverTimestamp(),
        })
      );
      await assertSucceeds(
        saDb.doc(`managerInvites/${targetEmail}`).update({
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // Cancelled invite CANNOT be claimed
      const cancelledInviteeDb = testEnv.authenticatedContext('uid_cancelled_inv', {
        email: targetEmail,
        email_verified: true,
      }).firestore();
      const badBatch = cancelledInviteeDb.batch();
      badBatch.update(cancelledInviteeDb.doc(`managerInvites/${targetEmail}`), {
        status: 'accepted',
        acceptedByUid: 'uid_cancelled_inv',
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      badBatch.set(cancelledInviteeDb.doc('users/uid_cancelled_inv'), {
        uid: 'uid_cancelled_inv',
        orgId: 'org_active',
        email: targetEmail,
        displayName: 'ملغى',
        role: 'manager',
        isActive: true,
        createdAt: '2026-11-15T10:30:00Z',
      });
      await assertFails(badBatch.commit());
    });

    // 13. Invited manager users/{uid} creation enforces strict field allowlist & permissions validation
    await runCase('13. Invited manager users/{uid} creation rejects extra/forged fields, bad permissions, or missing required fields, and accepts valid full profile', async () => {
      const orgId = 'org_invite_schema_01';
      const branchId = 'br_invite_schema_01';
      const inviteEmail = 'schema.manager@gmail.com';
      const inviteUid = 'uid_schema_mgr';

      const setupBatch = saDb.batch();
      setupBatch.set(saDb.doc(`organizations/${orgId}`), {
        id: orgId,
        name: 'مؤسسة اختبار الحقول',
        activityType: 'retail',
        currency: 'SAR',
        ownerId: '',
        ownerEmail: inviteEmail,
        ownerName: 'مدير الاختبار',
        driveConnected: false,
        isActive: true,
        subscriptionPlan: '1m',
        subscriptionStatus: 'active',
        subscriptionStartAt: tsPast1h,
        subscriptionEndAt: tsFuture30d,
        subscriptionUpdatedAt: serverTimestamp(),
        subscriptionUpdatedBy: 'amoal2030@gmail.com',
        createdAt: '2026-11-15T11:00:00Z',
        updatedAt: '2026-11-15T11:00:00Z',
      });
      setupBatch.set(saDb.doc(`branches/${branchId}`), {
        id: branchId,
        orgId,
        name: 'الفرع الرئيسي',
        code: 'B-01',
        isActive: true,
        createdAt: '2026-11-15T11:00:00Z',
      });
      setupBatch.set(saDb.doc(`managerInvites/${inviteEmail}`), {
        id: inviteEmail,
        email: inviteEmail,
        emailNormalized: inviteEmail,
        orgId,
        orgName: 'مؤسسة اختبار الحقول',
        managerName: 'مدير الاختبار',
        role: 'manager',
        status: 'pending',
        createdAt: serverTimestamp(),
        createdBy: 'amoal2030@gmail.com',
        updatedAt: serverTimestamp(),
      });
      await assertSucceeds(setupBatch.commit());

      const invDb = testEnv.authenticatedContext(inviteUid, {
        email: inviteEmail,
        email_verified: true,
      }).firestore();

      const buildClaimBatch = (userDocPayload: Record<string, unknown>, logId: string) => {
        const b = invDb.batch();
        b.update(invDb.doc(`managerInvites/${inviteEmail}`), {
          status: 'accepted',
          acceptedByUid: inviteUid,
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        b.update(invDb.doc(`organizations/${orgId}`), {
          ownerId: inviteUid,
          ownerName: 'مدير الاختبار',
          updatedAt: '2026-11-15T11:05:00Z',
        });
        b.set(invDb.doc(`users/${inviteUid}`), userDocPayload);
        b.set(invDb.doc(`auditLogs/${logId}`), {
          id: logId,
          orgId,
          actorId: inviteUid,
          actorName: 'مدير الاختبار',
          actorRole: 'manager',
          action: 'ORGANIZATION_ESTABLISHED',
          targetType: 'organization',
          targetId: orgId,
          details: 'تفعيل حساب المدير والتحقق من الحقول',
          timestamp: '2026-11-15T11:05:00Z',
        });
        return b;
      };

      const baseValidProfile = {
        uid: inviteUid,
        orgId,
        email: inviteEmail,
        displayName: 'مدير الاختبار',
        role: 'manager',
        isActive: true,
        createdAt: '2026-11-15T11:05:00Z',
      };

      // Reject extra untrusted shadow fields (e.g., isSuperAdmin / branchId / arbitrary metadata)
      await assertFails(
        buildClaimBatch({ ...baseValidProfile, isSuperAdmin: true }, 'log_schema_fail_1').commit()
      );
      await assertFails(
        buildClaimBatch({ ...baseValidProfile, branchId }, 'log_schema_fail_2').commit()
      );
      await assertFails(
        buildClaimBatch({ ...baseValidProfile, extraField: 'forged' }, 'log_schema_fail_3').commit()
      );

      // Reject forged permissions keys or invalid values
      await assertFails(
        buildClaimBatch(
          {
            ...baseValidProfile,
            permissions: {
              canCreateClosing: true,
              canViewAllClosings: true,
              canApproveClosings: true,
              canManageBranches: true,
              canManageEmployees: true,
              canExportReports: true,
              canBypassSubscription: true,
            },
          },
          'log_schema_fail_4'
        ).commit()
      );
      await assertFails(
        buildClaimBatch(
          {
            ...baseValidProfile,
            permissions: {
              canCreateClosing: true,
              canViewAllClosings: true,
              canApproveClosings: false,
              canManageBranches: true,
              canManageEmployees: true,
              canExportReports: true,
            },
          },
          'log_schema_fail_5'
        ).commit()
      );

      // Reject missing required field (displayName) or empty displayName
      const { displayName: _omit, ...withoutDisplayName } = baseValidProfile;
      await assertFails(buildClaimBatch(withoutDisplayName, 'log_schema_fail_6').commit());
      await assertFails(
        buildClaimBatch({ ...baseValidProfile, displayName: '   ' }, 'log_schema_fail_7').commit()
      );

      // Succeed with full valid UserProfile including permissions + phone
      await assertSucceeds(
        buildClaimBatch(
          {
            ...baseValidProfile,
            phone: '0551234567',
            permissions: {
              canCreateClosing: true,
              canViewAllClosings: true,
              canApproveClosings: true,
              canManageBranches: true,
              canManageEmployees: true,
              canExportReports: true,
            },
          },
          'log_schema_ok_1'
        ).commit()
      );
    });
  } finally {
    await testEnv.cleanup();
  }

  const passedCount = outcomes.filter((o) => o.passed).length;
  const failedCount = outcomes.length - passedCount;

  console.log('\n========================================================================');
  console.log(`   SUBSCRIPTION RULES SUMMARY: ${passedCount}/${outcomes.length} PASSED, ${failedCount} FAILED`);
  console.log('========================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSubscriptionRulesTests().catch((err) => {
  console.error('SUBSCRIPTION RULES TEST RUNNER FAILURE:', err);
  process.exit(1);
});
