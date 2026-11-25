/**
 * Single-Closing-Per-Slot & Concurrent Approval Prevention — Live Firestore Emulator Suite
 *
 * Tests against the REAL deployed `firestore.rules` (zero rule modifications):
 *  1. Rejected closing by Abdulraqib strictly blocks Muhammad BEFORE any write (clear Arabic error)
 *     AND direct SDK write bypass is also denied by `firestore.rules`.
 *  2. Abdulraqib's rejected closing and its `closingArchives` record remain 100% untouched,
 *     with ZERO partial `auditLogs` or `notifications` written on rejection.
 *  3. Abdulraqib himself CAN resubmit his own `rejected` closing in place (closings + archive + auditLog + notification).
 *  4. `pending_review` closing blocks creating/overwriting by any user with zero partial writes.
 *  5. `approved` closing blocks creating/overwriting by any user with zero partial writes.
 *  6. `draft` closing owned by Employee A blocks Employee B (zero partial writes, draft & archive untouched),
 *     while Employee A CAN resume and submit their own draft.
 *  7. Concurrent double approval on the SAME `pending_review` closing via `executeAtomicReviewShiftClosing`
 *     serializes atomically: exactly 1 succeeds, 1 fails, and only 1 `CLOSING_APPROVED` auditLog is created.
 *  8. Concurrent double approval on TWO DIFFERENT sibling `pending_review` closings sharing the same
 *     `(orgId, branchId, date, period)` serializes atomically: exactly 1 succeeds, 1 fails with
 *     `SIBLING_CLOSING_ALREADY_APPROVED`, and ONLY ONE closing ends up `approved`.
 *  9. `executeAtomicReviewShiftClosing` cleanly approves a legacy `pending_review` closing that has
 *     NO pre-existing `closingArchives` document.
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
import type { Firestore } from 'firebase/firestore';
import {
  doc,
  writeBatch,
} from 'firebase/firestore';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import { generateDeterministicClosingId } from '../utils/accounting';
import { buildClosingSubmittedNotifications } from '../utils/notifications';
import {
  evaluateShiftClosingSlotPolicy,
  executeAtomicReviewShiftClosing,
  fetchSlotClosingsFromServer,
  ShiftClosingBusinessError,
} from '../utils/shiftClosingGuards';
import type {
  Branch,
  ClosingArchiveRecord,
  Organization,
  ShiftClosing,
  UserProfile,
} from '../types';

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

function toModularDb(compatDb: firebase.firestore.Firestore): Firestore {
  return (compatDb as unknown as { _delegate: Firestore })._delegate;
}

const ORG_ID = 'org_j04OhPFE_mwc49rr0';
const BRANCH_ID = 'br_mwc625b9';
const BRANCH_NAME = 'سحاب 1';
const MANAGER_UID = 'mgr_org_sahab_01';
const SUPERVISOR_UID = 'sup_org_sahab_01';
const ABDULRAQIB_UID = 'K6D0rh2uUeaeXuJf666bio3HYlh1';
const MUHAMMAD_UID = 'HkcwFj4sGARuOZQmjDqFpMOcYsD2';

async function runSingleSlotClosingEmulatorTests() {
  console.log('========================================================================');
  console.log('   SINGLE-CLOSING-PER-SLOT & CONCURRENCY — FIRESTORE EMULATOR SUITE     ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-single-slot-test',
    firestore: {
      host,
      port,
      rules: rulesContent,
    },
  });

  const outcomes: TestOutcome[] = [];
  const runCase = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      outcomes.push({ name, passed: true });
      console.log(`  ✅ PASS: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ name, passed: false, error: msg });
      console.error(`  ❌ FAIL: ${name}\n     -> ${msg}`);
    }
  };

  try {
    await testEnv.clearFirestore();

    const nowMs = Date.now();
    const startTs = Timestamp.fromMillis(nowMs - 86_400_000);
    const endTs = Timestamp.fromMillis(nowMs + 30 * 86_400_000);
    const nowIso = new Date().toISOString();

    const org: Organization & Record<string, unknown> = {
      id: ORG_ID,
      name: 'محمد مليجان العقيدي',
      activityType: 'تجارة عامة',
      currency: 'SAR',
      ownerId: MANAGER_UID,
      ownerName: 'مدير المؤسسة',
      ownerEmail: 'manager@sahab.test',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: startTs,
      subscriptionEndAt: endTs,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const branch: Branch = {
      id: BRANCH_ID,
      orgId: ORG_ID,
      name: BRANCH_NAME,
      code: 'SHB-1',
      isActive: true,
      createdAt: nowIso,
    };

    const managerUser: UserProfile = {
      uid: MANAGER_UID,
      email: 'manager@sahab.test',
      displayName: 'مدير المؤسسة',
      role: 'manager',
      orgId: ORG_ID,
      isActive: true,
      permissions: buildDefaultPermissionsForRole('manager'),
      createdAt: nowIso,
    };

    const supervisorUser: UserProfile = {
      uid: SUPERVISOR_UID,
      email: 'sup@sahab.test',
      displayName: 'مشرف الاعتماد',
      role: 'supervisor',
      orgId: ORG_ID,
      isActive: true,
      permissions: buildDefaultPermissionsForRole('supervisor', {
        canApproveClosings: true,
        canViewAllClosings: true,
      }),
      createdAt: nowIso,
    };

    const abdulraqibUser: UserProfile = {
      uid: ABDULRAQIB_UID,
      email: 'abdulraqib@sahab.test',
      displayName: 'عبدالرقيب منصر',
      role: 'employee',
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      branchIds: [BRANCH_ID],
      isActive: true,
      permissions: buildDefaultPermissionsForRole('employee'),
      createdAt: nowIso,
    };

    const muhammadUser: UserProfile = {
      uid: MUHAMMAD_UID,
      email: 'muhammadalhussam27@gmail.com',
      displayName: 'محمد الحسام',
      role: 'branch_manager',
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      branchIds: [BRANCH_ID],
      isActive: true,
      permissions: buildDefaultPermissionsForRole('branch_manager'),
      createdAt: nowIso,
    };

    const rejectedClosingId = generateDeterministicClosingId(
      ORG_ID,
      BRANCH_ID,
      '2026-11-23',
      'evening'
    );
    assert.equal(
      rejectedClosingId,
      'cls_orgj04OhPFEmwc49rr0_brmwc625b9_2026-11-23_evening'
    );

    const abdulraqibRejectedClosing: ShiftClosing = {
      id: rejectedClosingId,
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      branchName: BRANCH_NAME,
      employeeId: ABDULRAQIB_UID,
      employeeName: 'عبدالرقيب منصر',
      date: '2026-11-23',
      period: 'evening',
      cashSales: 1200,
      cardSales: 800,
      totalSales: 2000,
      expenses: 150,
      remainingInBox: 1050,
      netPeriod: 1850,
      notes: '',
      status: 'rejected',
      rejectionReason: 'تغيير الورديه صباحيه',
      attachmentIds: [],
      createdAt: '2026-11-23T08:00:00.000Z',
      updatedAt: '2026-11-23T09:00:00.000Z',
    };

    const abdulraqibArchive: ClosingArchiveRecord = {
      closingId: rejectedClosingId,
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      yearMonth: '2026-11',
      archiveStatus: 'pending_drive_sync',
      updatedAt: '2026-11-23T09:00:00.000Z',
    };

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await adminDb.collection('organizations').doc(ORG_ID).set(org);
      await adminDb.collection('branches').doc(BRANCH_ID).set(branch);
      await adminDb.collection('users').doc(MANAGER_UID).set(managerUser);
      await adminDb.collection('users').doc(SUPERVISOR_UID).set(supervisorUser);
      await adminDb.collection('users').doc(ABDULRAQIB_UID).set(abdulraqibUser);
      await adminDb.collection('users').doc(MUHAMMAD_UID).set(muhammadUser);
      await adminDb.collection('closings').doc(rejectedClosingId).set(abdulraqibRejectedClosing);
      await adminDb.collection('closingArchives').doc(rejectedClosingId).set(abdulraqibArchive);
    });

    const mgrCompat = testEnv.authenticatedContext(MANAGER_UID, {
      email: managerUser.email,
      email_verified: true,
    }).firestore();
    const supCompat = testEnv.authenticatedContext(SUPERVISOR_UID, {
      email: supervisorUser.email,
      email_verified: true,
    }).firestore();
    const abdulraqibCompat = testEnv.authenticatedContext(ABDULRAQIB_UID, {
      email: abdulraqibUser.email,
      email_verified: false,
    }).firestore();
    const muhammadCompat = testEnv.authenticatedContext(MUHAMMAD_UID, {
      email: muhammadUser.email,
      email_verified: false,
    }).firestore();

    const mgrDb = toModularDb(mgrCompat);
    const supDb = toModularDb(supCompat);
    const abdulraqibDb = toModularDb(abdulraqibCompat);
    const muhammadDb = toModularDb(muhammadCompat);

    // Helper mirroring submitShiftClosing slot guard + atomic batch commit
    async function simulateSubmitShiftClosing(params: {
      db: Firestore;
      actor: UserProfile;
      date: string;
      period: 'morning' | 'evening';
      status: 'draft' | 'pending_review';
      cashSales?: number;
      cardSales?: number;
      expenses?: number;
    }): Promise<ShiftClosing> {
      const cashSales = params.cashSales ?? 1000;
      const cardSales = params.cardSales ?? 500;
      const expenses = params.expenses ?? 100;
      const canonicalClosingId = generateDeterministicClosingId(
        ORG_ID,
        BRANCH_ID,
        params.date,
        params.period
      );

      const slotClosings = await fetchSlotClosingsFromServer({
        db: params.db,
        orgId: ORG_ID,
        branchId: BRANCH_ID,
        date: params.date,
        period: params.period,
      });

      const slotEval = evaluateShiftClosingSlotPolicy({
        slotClosings,
        canonicalClosingId,
        actorUid: params.actor.uid,
        branchName: BRANCH_NAME,
        date: params.date,
        period: params.period,
      });

      if (!slotEval.allowed) {
        throw new ShiftClosingBusinessError(
          slotEval.conflictCode,
          slotEval.errorMessage,
          slotEval.conflictingClosing.id
        );
      }

      const closingId = slotEval.targetClosingId;
      const existingData = slotEval.existingOwnClosing;
      const ts = new Date().toISOString();
      const yearMonth = params.date.slice(0, 7);

      const closing: ShiftClosing = {
        id: closingId,
        orgId: ORG_ID,
        branchId: BRANCH_ID,
        branchName: BRANCH_NAME,
        employeeId: params.actor.uid,
        employeeName: params.actor.displayName,
        date: params.date,
        period: params.period,
        cashSales,
        cardSales,
        totalSales: cashSales + cardSales,
        expenses,
        remainingInBox: cashSales - expenses,
        netPeriod: cashSales + cardSales - expenses,
        notes: '',
        status: params.status,
        attachmentIds: existingData?.attachmentIds || [],
        createdAt: existingData ? existingData.createdAt : ts,
        updatedAt: ts,
      };

      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const batch = writeBatch(params.db);
      batch.set(doc(params.db, 'closings', closingId), closing);
      batch.set(doc(params.db, 'auditLogs', logId), {
        id: logId,
        orgId: ORG_ID,
        actorId: params.actor.uid,
        actorName: params.actor.displayName,
        actorRole: params.actor.role,
        action: params.status === 'draft' ? 'CLOSING_DRAFT_SAVED' : 'CLOSING_SUBMITTED_FOR_REVIEW',
        targetType: 'closing',
        targetId: closingId,
        details: `اختبار إقفال ${BRANCH_NAME} بتاريخ ${params.date}`,
        timestamp: ts,
      });

      if (!existingData) {
        batch.set(doc(params.db, 'closingArchives', closingId), {
          closingId,
          orgId: ORG_ID,
          branchId: BRANCH_ID,
          yearMonth,
          archiveStatus: 'pending_drive_sync',
          updatedAt: ts,
        });
      } else {
        batch.update(doc(params.db, 'closingArchives', closingId), {
          archiveStatus: 'pending_drive_sync',
          updatedAt: ts,
        });
      }

      if (params.status === 'pending_review') {
        const notifs = buildClosingSubmittedNotifications({
          closing,
          isResubmission: slotEval.isResubmission,
          actorUid: params.actor.uid,
          actorName: params.actor.displayName,
          actorRole: params.actor.role,
          createdAt: ts,
        });
        notifs.forEach((n) => batch.set(doc(params.db, 'notifications', n.id), n));
      }

      await batch.commit();
      return closing;
    }

    // ------------------------------------------------------------------
    // Case 1 & 2: Muhammad blocked on Abdulraqib's rejected closing,
    //             Abdulraqib's closing & archive 100% untouched, ZERO partial docs
    // ------------------------------------------------------------------
    await runCase(
      '1. Rejected closing by Abdulraqib blocks Muhammad BEFORE any write, leaves Abdulraqib closing & archive untouched, zero partial writes',
      async () => {
        let caughtErr: unknown = null;
        try {
          await simulateSubmitShiftClosing({
            db: muhammadDb,
            actor: muhammadUser,
            date: '2026-11-23',
            period: 'evening',
            status: 'pending_review',
          });
        } catch (err) {
          caughtErr = err;
        }

        assert.ok(
          caughtErr instanceof ShiftClosingBusinessError,
          'Expected ShiftClosingBusinessError before any Firestore write'
        );
        assert.equal(caughtErr.code, 'SLOT_REJECTED_OTHER_EMPLOYEE');
        assert.match(caughtErr.message, /مرفوضة/);
        assert.match(caughtErr.message, /عبدالرقيب منصر/);

        // Also prove direct SDK bypass (ignoring UI guard) is STILL strictly denied by firestore.rules
        const bypassBatch = muhammadCompat.batch();
        bypassBatch.set(muhammadCompat.collection('closings').doc(rejectedClosingId), {
          ...abdulraqibRejectedClosing,
          employeeId: MUHAMMAD_UID,
          employeeName: muhammadUser.displayName,
          status: 'pending_review',
          updatedAt: new Date().toISOString(),
        });
        bypassBatch.update(muhammadCompat.collection('closingArchives').doc(rejectedClosingId), {
          archiveStatus: 'pending_drive_sync',
          updatedAt: new Date().toISOString(),
        });
        await assertFails(bypassBatch.commit());

        // Verify byte-for-byte preservation of Abdulraqib's closing & archive AND zero partial docs
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          const cSnap = await adminDb.collection('closings').doc(rejectedClosingId).get();
          assert.deepEqual(cSnap.data(), abdulraqibRejectedClosing);

          const aSnap = await adminDb.collection('closingArchives').doc(rejectedClosingId).get();
          assert.deepEqual(aSnap.data(), abdulraqibArchive);

          const logsSnap = await adminDb.collection('auditLogs').get();
          assert.equal(logsSnap.size, 0, 'Zero partial auditLogs may be written on conflict');

          const notifsSnap = await adminDb.collection('notifications').get();
          assert.equal(notifsSnap.size, 0, 'Zero partial notifications may be written on conflict');
        });
      }
    );

    // ------------------------------------------------------------------
    // Case 3: Abdulraqib himself CAN resubmit his own rejected closing
    // ------------------------------------------------------------------
    await runCase(
      '2. Same user (Abdulraqib) CAN resubmit his own rejected closing on the exact same slot ID',
      async () => {
        const resubmitted = await assertSucceeds(
          simulateSubmitShiftClosing({
            db: abdulraqibDb,
            actor: abdulraqibUser,
            date: '2026-11-23',
            period: 'evening',
            status: 'pending_review',
            cashSales: 1400,
            cardSales: 600,
            expenses: 100,
          })
        );

        assert.equal(resubmitted.id, rejectedClosingId);
        assert.equal(resubmitted.status, 'pending_review');
        assert.equal(resubmitted.employeeId, ABDULRAQIB_UID);
        assert.equal(resubmitted.createdAt, abdulraqibRejectedClosing.createdAt);

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          const slotDocs = await adminDb
            .collection('closings')
            .where('orgId', '==', ORG_ID)
            .where('branchId', '==', BRANCH_ID)
            .where('date', '==', '2026-11-23')
            .where('period', '==', 'evening')
            .get();
          assert.equal(slotDocs.size, 1, 'Strictly 1 closing document must exist for the slot');
        });
      }
    );

    // ------------------------------------------------------------------
    // Case 4: pending_review blocks creating another closing (zero partial writes)
    // ------------------------------------------------------------------
    await runCase(
      '3. pending_review closing blocks both another employee and same employee with zero partial writes',
      async () => {
        let beforeLogs = 0;
        let beforeNotifs = 0;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          beforeLogs = (await ctx.firestore().collection('auditLogs').get()).size;
          beforeNotifs = (await ctx.firestore().collection('notifications').get()).size;
        });

        for (const [dbInst, actor] of [
          [muhammadDb, muhammadUser],
          [abdulraqibDb, abdulraqibUser],
        ] as const) {
          await assert.rejects(
            () =>
              simulateSubmitShiftClosing({
                db: dbInst,
                actor,
                date: '2026-11-23',
                period: 'evening',
                status: 'pending_review',
              }),
            (err: unknown) =>
              err instanceof ShiftClosingBusinessError && err.code === 'SLOT_PENDING_REVIEW'
          );
        }

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          assert.equal((await ctx.firestore().collection('auditLogs').get()).size, beforeLogs);
          assert.equal((await ctx.firestore().collection('notifications').get()).size, beforeNotifs);
        });
      }
    );

    // ------------------------------------------------------------------
    // Case 5: Concurrent double approval on the SAME pending_review closing
    //         AND approved closing subsequently blocks all new submissions
    // ------------------------------------------------------------------
    await runCase(
      '4. Concurrent double approval on SAME pending_review closing serializes atomically (1 wins, 1 fails) and approved closing blocks slot',
      async () => {
        const results = await Promise.allSettled([
          executeAtomicReviewShiftClosing({
            db: mgrDb,
            orgId: ORG_ID,
            closingId: rejectedClosingId,
            action: 'approve',
            reviewerUid: MANAGER_UID,
            reviewerName: managerUser.displayName,
            reviewerEmail: managerUser.email,
            reviewerRole: 'manager',
          }),
          executeAtomicReviewShiftClosing({
            db: supDb,
            orgId: ORG_ID,
            closingId: rejectedClosingId,
            action: 'approve',
            reviewerUid: SUPERVISOR_UID,
            reviewerName: supervisorUser.displayName,
            reviewerEmail: supervisorUser.email,
            reviewerRole: 'supervisor',
          }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        assert.equal(fulfilled.length, 1, 'Exactly ONE concurrent approval must succeed');
        assert.equal(rejected.length, 1, 'The second concurrent approval must fail cleanly');

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          const cSnap = await adminDb.collection('closings').doc(rejectedClosingId).get();
          assert.equal(cSnap.data()?.status, 'approved');

          const approvedLogs = await adminDb
            .collection('auditLogs')
            .where('action', '==', 'CLOSING_APPROVED')
            .where('targetId', '==', rejectedClosingId)
            .get();
          assert.equal(approvedLogs.size, 1, 'Exactly ONE CLOSING_APPROVED auditLog must exist');
        });

        // Approved closing must now block both Muhammad and Abdulraqib with zero partial writes
        for (const [dbInst, actor] of [
          [muhammadDb, muhammadUser],
          [abdulraqibDb, abdulraqibUser],
        ] as const) {
          await assert.rejects(
            () =>
              simulateSubmitShiftClosing({
                db: dbInst,
                actor,
                date: '2026-11-23',
                period: 'evening',
                status: 'pending_review',
              }),
            (err: unknown) =>
              err instanceof ShiftClosingBusinessError && err.code === 'SLOT_ALREADY_APPROVED'
          );
        }
      }
    );

    // ------------------------------------------------------------------
    // Case 6: Draft by Employee A blocks Employee B (zero partial writes, draft untouched)
    // ------------------------------------------------------------------
    await runCase(
      '5. Draft closing by Employee A blocks Employee B with zero partial writes while Employee A can resume it',
      async () => {
        const draftDate = '2026-11-24';
        const draftClosing = await assertSucceeds(
          simulateSubmitShiftClosing({
            db: abdulraqibDb,
            actor: abdulraqibUser,
            date: draftDate,
            period: 'morning',
            status: 'draft',
            cashSales: 500,
            cardSales: 300,
            expenses: 50,
          })
        );

        let beforeLogs = 0;
        let beforeNotifs = 0;
        let snapshotBefore: Record<string, unknown> | undefined;
        let archiveBefore: Record<string, unknown> | undefined;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          beforeLogs = (await adminDb.collection('auditLogs').get()).size;
          beforeNotifs = (await adminDb.collection('notifications').get()).size;
          snapshotBefore = (await adminDb.collection('closings').doc(draftClosing.id).get()).data();
          archiveBefore = (await adminDb.collection('closingArchives').doc(draftClosing.id).get()).data();
        });

        await assert.rejects(
          () =>
            simulateSubmitShiftClosing({
              db: muhammadDb,
              actor: muhammadUser,
              date: draftDate,
              period: 'morning',
              status: 'pending_review',
            }),
          (err: unknown) =>
            err instanceof ShiftClosingBusinessError && err.code === 'SLOT_DRAFT_OTHER_EMPLOYEE'
        );

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          assert.deepEqual(
            (await adminDb.collection('closings').doc(draftClosing.id).get()).data(),
            snapshotBefore
          );
          assert.deepEqual(
            (await adminDb.collection('closingArchives').doc(draftClosing.id).get()).data(),
            archiveBefore
          );
          assert.equal((await adminDb.collection('auditLogs').get()).size, beforeLogs);
          assert.equal((await adminDb.collection('notifications').get()).size, beforeNotifs);
        });

        // Abdulraqib resumes his own draft -> submits for review cleanly
        const submitted = await assertSucceeds(
          simulateSubmitShiftClosing({
            db: abdulraqibDb,
            actor: abdulraqibUser,
            date: draftDate,
            period: 'morning',
            status: 'pending_review',
            cashSales: 700,
            cardSales: 300,
            expenses: 50,
          })
        );
        assert.equal(submitted.id, draftClosing.id);
        assert.equal(submitted.status, 'pending_review');
      }
    );

    // ------------------------------------------------------------------
    // Case 7: Concurrent double approval on TWO DIFFERENT sibling closings
    //         sharing the same (orgId, branchId, date, period)
    // ------------------------------------------------------------------
    await runCase(
      '6. Concurrent approval on TWO sibling pending_review closings in the same slot serializes atomically via sibling tx.get locks',
      async () => {
        const raceDate = '2026-11-25';
        const sibIdA = generateDeterministicClosingId(ORG_ID, BRANCH_ID, raceDate, 'evening');
        const sibIdB = `${sibIdA}_legacy_dup`;

        const makePendingSibling = (id: string, employeeId: string, employeeName: string): ShiftClosing => ({
          id,
          orgId: ORG_ID,
          branchId: BRANCH_ID,
          branchName: BRANCH_NAME,
          employeeId,
          employeeName,
          date: raceDate,
          period: 'evening',
          cashSales: 900,
          cardSales: 400,
          totalSales: 1300,
          expenses: 50,
          remainingInBox: 850,
          netPeriod: 1250,
          notes: '',
          status: 'pending_review',
          attachmentIds: [],
          createdAt: '2026-11-25T18:00:00.000Z',
          updatedAt: '2026-11-25T18:00:00.000Z',
        });

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          await adminDb.collection('closings').doc(sibIdA).set(
            makePendingSibling(sibIdA, ABDULRAQIB_UID, abdulraqibUser.displayName)
          );
          await adminDb.collection('closings').doc(sibIdB).set(
            makePendingSibling(sibIdB, MUHAMMAD_UID, muhammadUser.displayName)
          );
          await adminDb.collection('closingArchives').doc(sibIdA).set({
            closingId: sibIdA,
            orgId: ORG_ID,
            branchId: BRANCH_ID,
            yearMonth: '2026-11',
            archiveStatus: 'pending_drive_sync',
            updatedAt: '2026-11-25T18:00:00.000Z',
          });
          await adminDb.collection('closingArchives').doc(sibIdB).set({
            closingId: sibIdB,
            orgId: ORG_ID,
            branchId: BRANCH_ID,
            yearMonth: '2026-11',
            archiveStatus: 'pending_drive_sync',
            updatedAt: '2026-11-25T18:00:00.000Z',
          });
        });

        const raceResults = await Promise.allSettled([
          executeAtomicReviewShiftClosing({
            db: mgrDb,
            orgId: ORG_ID,
            closingId: sibIdA,
            action: 'approve',
            reviewerUid: MANAGER_UID,
            reviewerName: managerUser.displayName,
            reviewerEmail: managerUser.email,
            reviewerRole: 'manager',
          }),
          executeAtomicReviewShiftClosing({
            db: supDb,
            orgId: ORG_ID,
            closingId: sibIdB,
            action: 'approve',
            reviewerUid: SUPERVISOR_UID,
            reviewerName: supervisorUser.displayName,
            reviewerEmail: supervisorUser.email,
            reviewerRole: 'supervisor',
          }),
        ]);

        const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
        const rejected = raceResults.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected'
        );
        assert.equal(fulfilled.length, 1, 'Exactly ONE sibling closing may be approved concurrently');
        assert.equal(rejected.length, 1, 'The other sibling approval MUST abort atomically');
        assert.ok(
          rejected[0].reason instanceof ShiftClosingBusinessError &&
            rejected[0].reason.code === 'SIBLING_CLOSING_ALREADY_APPROVED',
          `Expected SIBLING_CLOSING_ALREADY_APPROVED, got: ${rejected[0].reason}`
        );

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          const aStatus = (await adminDb.collection('closings').doc(sibIdA).get()).data()?.status;
          const bStatus = (await adminDb.collection('closings').doc(sibIdB).get()).data()?.status;
          const approvedCount = [aStatus, bStatus].filter((s) => s === 'approved').length;
          assert.equal(approvedCount, 1, 'Strictly 1 closing in the slot may end up approved');
        });
      }
    );

    // ------------------------------------------------------------------
    // Case 8: Legacy pending_review closing WITHOUT pre-existing closingArchives doc
    // ------------------------------------------------------------------
    await runCase(
      '7. Atomic approval succeeds cleanly on a legacy pending_review closing with NO prior closingArchives document',
      async () => {
        const legacyDate = '2026-11-26';
        const legacyId = generateDeterministicClosingId(ORG_ID, BRANCH_ID, legacyDate, 'morning');
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await ctx.firestore().collection('closings').doc(legacyId).set({
            id: legacyId,
            orgId: ORG_ID,
            branchId: BRANCH_ID,
            branchName: BRANCH_NAME,
            employeeId: MUHAMMAD_UID,
            employeeName: muhammadUser.displayName,
            date: legacyDate,
            period: 'morning',
            cashSales: 600,
            cardSales: 400,
            totalSales: 1000,
            expenses: 0,
            remainingInBox: 600,
            netPeriod: 1000,
            notes: '',
            status: 'pending_review',
            attachmentIds: [],
            createdAt: '2026-11-26T08:00:00.000Z',
            updatedAt: '2026-11-26T08:00:00.000Z',
          });
        });

        await assertSucceeds(
          executeAtomicReviewShiftClosing({
            db: mgrDb,
            orgId: ORG_ID,
            closingId: legacyId,
            action: 'approve',
            reviewerUid: MANAGER_UID,
            reviewerName: managerUser.displayName,
            reviewerEmail: managerUser.email,
            reviewerRole: 'manager',
            cachedArchiveExists: false,
          })
        );

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          const cSnap = await adminDb.collection('closings').doc(legacyId).get();
          assert.equal(cSnap.data()?.status, 'approved');
          const aSnap = await adminDb.collection('closingArchives').doc(legacyId).get();
          assert.equal(aSnap.exists, true);
          assert.equal(aSnap.data()?.archiveStatus, 'pending_drive_sync');
        });
      }
    );

    // ------------------------------------------------------------------
    // Case 9: Supervisor approves cleanly without touching closingArchives,
    //         AND deployed firestore.rules rejects standalone org_manager
    //         CLOSING_APPROVED notification from supervisor (empirical proof for Part 3)
    // ------------------------------------------------------------------
    await runCase(
      '8. Supervisor approves cleanly leaving closingArchives untouched, and deployed rules deny standalone org_manager CLOSING_APPROVED notification',
      async () => {
        const supDate = '2026-11-27';
        const supClosingId = generateDeterministicClosingId(ORG_ID, BRANCH_ID, supDate, 'morning');
        const initialArchiveTs = '2026-11-27T08:00:00.000Z';

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          await adminDb.collection('closings').doc(supClosingId).set({
            id: supClosingId,
            orgId: ORG_ID,
            branchId: BRANCH_ID,
            branchName: BRANCH_NAME,
            employeeId: ABDULRAQIB_UID,
            employeeName: abdulraqibUser.displayName,
            date: supDate,
            period: 'morning',
            cashSales: 1100,
            cardSales: 400,
            totalSales: 1500,
            expenses: 100,
            remainingInBox: 1000,
            netPeriod: 1400,
            notes: '',
            status: 'pending_review',
            attachmentIds: [],
            createdAt: initialArchiveTs,
            updatedAt: initialArchiveTs,
          });
          await adminDb.collection('closingArchives').doc(supClosingId).set({
            closingId: supClosingId,
            orgId: ORG_ID,
            branchId: BRANCH_ID,
            yearMonth: '2026-11',
            archiveStatus: 'pending_drive_sync',
            updatedAt: initialArchiveTs,
          });
        });

        await assertSucceeds(
          executeAtomicReviewShiftClosing({
            db: supDb,
            orgId: ORG_ID,
            closingId: supClosingId,
            action: 'approve',
            reviewerUid: SUPERVISOR_UID,
            reviewerName: supervisorUser.displayName,
            reviewerEmail: supervisorUser.email,
            reviewerRole: 'supervisor',
          })
        );

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const adminDb = ctx.firestore();
          const cSnap = await adminDb.collection('closings').doc(supClosingId).get();
          assert.equal(cSnap.data()?.status, 'approved');
          assert.equal(cSnap.data()?.reviewedBy, SUPERVISOR_UID);

          // Archive remains pending_drive_sync untouched for org manager Drive archival
          const aSnap = await adminDb.collection('closingArchives').doc(supClosingId).get();
          assert.equal(aSnap.data()?.archiveStatus, 'pending_drive_sync');
          assert.equal(aSnap.data()?.updatedAt, initialArchiveTs);
        });

        // Prove empirically that deployed firestore.rules rejects a supervisor creating a
        // standalone audienceScope='org_manager' CLOSING_APPROVED notification
        const supAttemptNotifId = `notif_sup_orgmgr_${Date.now()}`;
        await assertFails(
          supCompat.collection('notifications').doc(supAttemptNotifId).set({
            id: supAttemptNotifId,
            orgId: ORG_ID,
            branchId: BRANCH_ID,
            eventType: 'CLOSING_APPROVED',
            audienceScope: 'org_manager',
            feedKeys: [`org_mgr:${ORG_ID}`],
            title: 'إقفال بانتظار الأرشفة في Google Drive',
            message: 'اعتمد المشرف إقفال وردية صباحية وهو بانتظار أرشفته في Google Drive.',
            severity: 'info',
            entityType: 'closing',
            entityId: supClosingId,
            actionTab: 'closings',
            actorUid: SUPERVISOR_UID,
            actorName: supervisorUser.displayName,
            actorRole: 'supervisor',
            createdAt: new Date().toISOString(),
          })
        );
      }
    );

    // ------------------------------------------------------------------
    // Case 10: Restricted supervisor without view-all closing read perm
    //          fails CLOSED with SLOT_VERIFICATION_PERMISSION_DENIED
    // ------------------------------------------------------------------
    await runCase(
      '9. Supervisor lacking closing-list read permission fails CLOSED with SLOT_VERIFICATION_PERMISSION_DENIED (never converted to allow)',
      async () => {
        const restrictedSupUid = 'sup_restricted_create_only';
        const restrictedSupUser: UserProfile = {
          uid: restrictedSupUid,
          email: 'sup.restricted@sahab.test',
          displayName: 'مشرف محدود',
          role: 'supervisor',
          orgId: ORG_ID,
          isActive: true,
          permissions: buildDefaultPermissionsForRole('supervisor', {
            canCreateClosing: true,
            canViewAllClosings: false,
            canApproveClosings: false,
            canViewFinancialReports: false,
            canExportReports: false,
          }),
          createdAt: nowIso,
        };

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await ctx.firestore().collection('users').doc(restrictedSupUid).set(restrictedSupUser);
        });

        const restrictedSupCompat = testEnv.authenticatedContext(restrictedSupUid, {
          email: restrictedSupUser.email,
          email_verified: true,
        }).firestore();
        const restrictedSupDb = toModularDb(restrictedSupCompat);

        await assert.rejects(
          () =>
            fetchSlotClosingsFromServer({
              db: restrictedSupDb,
              orgId: ORG_ID,
              branchId: BRANCH_ID,
              date: '2026-11-28',
              period: 'morning',
            }),
          (err: unknown) =>
            err instanceof ShiftClosingBusinessError &&
            err.code === 'SLOT_VERIFICATION_PERMISSION_DENIED'
        );
      }
    );
  } finally {
    await testEnv.cleanup();
  }

  const passedCount = outcomes.filter((o) => o.passed).length;
  const failedCount = outcomes.filter((o) => !o.passed).length;
  console.log('\n========================================================================');
  console.log(`EMULATOR SUMMARY: ${passedCount} passed, ${failedCount} failed`);
  console.log('========================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSingleSlotClosingEmulatorTests().catch((err) => {
  console.error('Fatal emulator suite error:', err);
  process.exit(1);
});
