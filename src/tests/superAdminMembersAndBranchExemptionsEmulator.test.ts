/**
 * Phase B Live Firestore Emulator Security Test Suite
 * Super Admin Organization/Branch Exemptions (`billing_exempt` & `legacy_unrestricted`)
 * & Cross-Organization Member Management + Bidirectional Atomic Audit Coupling
 *
 * Uses `assertGenuineFails` to guarantee that EVERY expected denial is a true security rejection
 * and NEVER a false-positive `maximum of 1000 expressions` evaluation crash.
 *
 * Run with:
 *   firebase emulators:exec --only firestore "npx tsx src/tests/superAdminMembersAndBranchExemptionsEmulator.test.ts"
 */
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

let genuineSecurityDenialsCount = 0;
let expressionLimitErrorsCount = 0;

/**
 * Guarantees a Firestore request fails due to a genuine security rule denial
 * and NEVER due to hitting the 1,000-expression evaluation limit.
 */
async function assertGenuineFails<T>(promise: Promise<T>, label?: string): Promise<void> {
  const err = await assertFails(promise);
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('maximum of 1000 expressions')) {
    expressionLimitErrorsCount += 1;
    throw new Error(
      `FALSE-POSITIVE REJECTION (hit 1,000-expression limit)${label ? ` [${label}]` : ''}: ${msg}`
    );
  }
  genuineSecurityDenialsCount += 1;
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

async function runPhaseBEmulatorTests() {
  console.log('========================================================================');
  console.log('   PHASE B — BRANCH EXEMPTIONS & SUPER ADMIN MEMBERS EMULATOR SUITE     ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-phaseb-members-exemptions',
    firestore: {
      rules: rulesContent,
      host,
      port,
    },
  });

  await testEnv.clearFirestore();

  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const tsPast30d = Timestamp.fromMillis(nowMs - 30 * oneDayMs);
  const tsPast2d = Timestamp.fromMillis(nowMs - 2 * oneDayMs);
  const tsNow = Timestamp.fromMillis(nowMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);
  const nowIso = new Date(nowMs).toISOString();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Org A: Active paid org with 3 branches (for branch exemptions, bulk exemptions & member management)
    await db.doc('organizations/org_a').set({
      id: 'org_a',
      name: 'مؤسسة ألفا التجارية',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_a',
      ownerEmail: 'owner.a@example.com',
      ownerName: 'مدير ألفا',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsFuture30d,
      accountSetupFeeSar: 80,
      setupFeeStatus: 'paid',
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // Org B: Separate paid org (for cross-org isolation tests)
    await db.doc('organizations/org_b').set({
      id: 'org_b',
      name: 'مؤسسة بيتا للخدمات',
      activityType: 'services',
      currency: 'SAR',
      ownerId: 'mgr_b',
      ownerEmail: 'owner.b@example.com',
      ownerName: 'مدير بيتا',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1y',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // Org C: Manually suspended org (granting exemption MUST fail!)
    await db.doc('organizations/org_c_susp').set({
      id: 'org_c_susp',
      name: 'مؤسسة موقوفة يدوياً',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_c',
      ownerEmail: 'owner.c@example.com',
      ownerName: 'مدير جيم',
      driveConnected: false,
      isActive: false,
      deactivationReason: 'manual_suspension',
      subscriptionPlan: '1m',
      subscriptionStatus: 'expired',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsPast2d,
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // Org D: Expired org for explicit legacy_unrestricted grant & revoke test
    await db.doc('organizations/org_d_leg').set({
      id: 'org_d_leg',
      name: 'مؤسسة دلتا التاريخية',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'mgr_d',
      ownerEmail: 'owner.d@example.com',
      ownerName: 'مدير دلتا',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '6m',
      subscriptionStatus: 'expired',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsPast2d,
      accountSetupFeeSar: 80,
      setupFeeStatus: 'paid',
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // Branches for Org A
    await db.doc('branches/br_a1').set({
      id: 'br_a1',
      orgId: 'org_a',
      name: 'فرع ألفا 1',
      code: 'A01',
      isActive: true,
      lifecycleStatus: 'active',
      subscriptionStartAt: tsPast30d,
      monthlyFeeSar: 50,
      paymentStatus: 'paid',
      feeDueAt: tsFuture30d,
      lastPaidAt: tsPast30d,
      lastPaidBy: 'amoal2030@gmail.com',
      paymentNote: 'دفعة شهرية سابقة',
      createdAt: '2026-01-01T08:00:00.000Z',
    });
    await db.doc('branches/br_a2').set({
      id: 'br_a2',
      orgId: 'org_a',
      name: 'فرع ألفا 2',
      code: 'A02',
      isActive: true,
      lifecycleStatus: 'active',
      monthlyFeeSar: 50,
      paymentStatus: 'unpaid',
      createdAt: '2026-01-01T08:00:00.000Z',
    });
    await db.doc('branches/br_a3').set({
      id: 'br_a3',
      orgId: 'org_a',
      name: 'فرع ألفا 3',
      code: 'A03',
      isActive: true,
      lifecycleStatus: 'active',
      monthlyFeeSar: 50,
      paymentStatus: 'overdue',
      feeDueAt: tsPast2d,
      createdAt: '2026-01-01T08:00:00.000Z',
    });

    // Branch for Org B
    await db.doc('branches/br_b1').set({
      id: 'br_b1',
      orgId: 'org_b',
      name: 'فرع بيتا 1',
      code: 'B01',
      isActive: true,
      lifecycleStatus: 'active',
      monthlyFeeSar: 50,
      paymentStatus: 'paid',
      feeDueAt: tsFuture30d,
      createdAt: '2026-01-01T08:00:00.000Z',
    });

    // Branch for Org D
    await db.doc('branches/br_d1').set({
      id: 'br_d1',
      orgId: 'org_d_leg',
      name: 'فرع دلتا 1',
      code: 'D01',
      isActive: true,
      lifecycleStatus: 'active',
      monthlyFeeSar: 50,
      paymentStatus: 'unpaid',
      createdAt: '2026-01-01T08:00:00.000Z',
    });

    // Seed Users
    await db.doc('users/mgr_a').set({
      uid: 'mgr_a',
      orgId: 'org_a',
      email: 'owner.a@example.com',
      displayName: 'مدير ألفا',
      role: 'manager',
      isActive: true,
      createdAt: '2026-01-01T08:00:00.000Z',
    });
    await db.doc('users/bm_a1').set({
      uid: 'bm_a1',
      orgId: 'org_a',
      branchId: 'br_a1',
      branchIds: ['br_a1'],
      branchName: 'فرع ألفا 1',
      email: 'bm.a1@example.com',
      displayName: 'مسؤول فرع ألفا 1',
      role: 'branch_manager',
      isActive: true,
      createdAt: '2026-01-01T08:00:00.000Z',
    });
    await db.doc('users/emp_a1').set({
      uid: 'emp_a1',
      orgId: 'org_a',
      branchId: 'br_a1',
      branchIds: ['br_a1'],
      branchName: 'فرع ألفا 1',
      email: 'emp.a1@example.com',
      displayName: 'موظف ألفا 1',
      role: 'employee',
      isActive: true,
      createdAt: '2026-01-01T08:00:00.000Z',
    });
    await db.doc('users/mgr_b').set({
      uid: 'mgr_b',
      orgId: 'org_b',
      email: 'owner.b@example.com',
      displayName: 'مدير بيتا',
      role: 'manager',
      isActive: true,
      createdAt: '2026-01-01T08:00:00.000Z',
    });
    await db.doc('users/mgr_c').set({
      uid: 'mgr_c',
      orgId: 'org_c_susp',
      email: 'owner.c@example.com',
      displayName: 'مدير جيم',
      role: 'manager',
      isActive: true,
      createdAt: '2026-01-01T08:00:00.000Z',
    });
    await db.doc('users/mgr_d').set({
      uid: 'mgr_d',
      orgId: 'org_d_leg',
      email: 'owner.d@example.com',
      displayName: 'مدير دلتا',
      role: 'manager',
      isActive: true,
      createdAt: '2026-01-01T08:00:00.000Z',
    });

    // Pre-existing audit log for replay/reuse test
    await db.doc('platformAuditLogs/plog_already_exists').set({
      id: 'plog_already_exists',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'uid_sa',
      action: 'ORG_PROFILE_UPDATED',
      targetType: 'organization',
      targetId: 'org_a',
      orgId: 'org_a',
      details: 'سجل سابق لاختبار منع إعادة الاستخدام',
      timestamp: '2026-11-01T08:00:00.000Z',
    });
  });

  // Auth contexts
  const saDb = testEnv.authenticatedContext('uid_sa', { email: 'amoal2030@gmail.com', email_verified: true }).firestore();
  const saUnverifiedDb = testEnv.authenticatedContext('uid_sa_unv', { email: 'amoal2030@gmail.com', email_verified: false }).firestore();
  const onlakDb = testEnv.authenticatedContext('uid_onlak', { email: 'onlak2030@gmail.com', email_verified: true }).firestore();
  const otherDb = testEnv.authenticatedContext('uid_other', { email: 'random.admin@gmail.com', email_verified: true }).firestore();
  const mgrADb = testEnv.authenticatedContext('mgr_a', { email: 'owner.a@example.com', email_verified: true }).firestore();
  const bmA1Db = testEnv.authenticatedContext('bm_a1', { email: 'bm.a1@example.com', email_verified: true }).firestore();
  const empA1Db = testEnv.authenticatedContext('emp_a1', { email: 'emp.a1@example.com', email_verified: true }).firestore();
  const mgrBDb = testEnv.authenticatedContext('mgr_b', { email: 'owner.b@example.com', email_verified: true }).firestore();
  const mgrDDb = testEnv.authenticatedContext('mgr_d', { email: 'owner.d@example.com', email_verified: true }).firestore();

  const buildBranchGrantPayload = (
    logId: string,
    mode: 'billing_exempt' | 'legacy_unrestricted' = 'billing_exempt'
  ) => ({
    paymentStatus: 'exempt',
    monthlyFeeSar: 0,
    billingExempt: true,
    billingExemptMode: mode,
    billingExemptScope: 'branch_permanent',
    exemptReason: 'إعفاء مستقل معتمد للفرع من المدير الرئيسي',
    exemptGrantedAt: tsNow,
    exemptGrantedBy: 'amoal2030@gmail.com',
    exemptRevokedAt: null,
    exemptRevokedBy: null,
    exemptRevokeReason: null,
    exemptLastAuditLogId: logId,
    updatedAt: nowIso,
  });

  const buildBranchRevokePayload = (logId: string) => ({
    paymentStatus: 'unpaid',
    monthlyFeeSar: 50,
    billingExempt: false,
    exemptRevokedAt: tsNow,
    exemptRevokedBy: 'amoal2030@gmail.com',
    exemptRevokeReason: 'إلغاء الإعفاء المستقل للفرع وإعادته للتسعير العادي',
    exemptLastAuditLogId: logId,
    updatedAt: nowIso,
  });

  const buildAudit = (params: {
    id: string;
    action: string;
    targetType: 'organization' | 'branch' | 'invite' | 'billing' | 'member';
    targetId: string;
    orgId: string;
    actorUid?: string;
    actorEmail?: string;
    metadata?: Record<string, unknown>;
  }) => ({
    id: params.id,
    actorEmail: params.actorEmail || 'amoal2030@gmail.com',
    actorUid: params.actorUid || 'uid_sa',
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    orgId: params.orgId,
    details: `توثيق ذري للعملية ${params.action}`,
    ...(params.metadata ? { metadata: params.metadata } : {}),
    timestamp: nowIso,
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

  try {
    // =========================================================================
    // SECTION 1: BRANCH EXEMPTIONS & EXPLICIT ORG LEGACY_UNRESTRICTED
    // =========================================================================

    await runCase('1. Super Admin grants independent branch exemption (legacy_unrestricted & billing_exempt) with atomic audit log', async () => {
      const logId = 'plog_br_a1_grant_01';
      const batch = saDb.batch();
      batch.update(saDb.doc('branches/br_a1'), buildBranchGrantPayload(logId, 'legacy_unrestricted'));
      batch.set(
        saDb.doc(`platformAuditLogs/${logId}`),
        buildAudit({
          id: logId,
          action: 'BRANCH_BILLING_EXEMPTION_GRANTED',
          targetType: 'branch',
          targetId: 'br_a1',
          orgId: 'org_a',
        })
      );
      await assertSucceeds(batch.commit());
    });

    await runCase('2. Super Admin revokes independent branch exemption with atomic audit log (while preserving payment & grant history)', async () => {
      // Attempt to tamper with historical paymentNote during revoke MUST genuinely FAIL
      const badHistoryBatch = saDb.batch();
      badHistoryBatch.update(saDb.doc('branches/br_a1'), {
        ...buildBranchRevokePayload('plog_br_a1_bad_hist'),
        paymentNote: 'حذف الملاحظة التاريخية',
      });
      badHistoryBatch.set(
        saDb.doc('platformAuditLogs/plog_br_a1_bad_hist'),
        buildAudit({
          id: 'plog_br_a1_bad_hist',
          action: 'BRANCH_BILLING_EXEMPTION_REVOKED',
          targetType: 'branch',
          targetId: 'br_a1',
          orgId: 'org_a',
        })
      );
      await assertGenuineFails(badHistoryBatch.commit(), 'branch revoke mutating paymentNote');

      // Proper non-destructive revoke SUCCEEDS
      const logId = 'plog_br_a1_revoke_01';
      const batch = saDb.batch();
      batch.update(saDb.doc('branches/br_a1'), buildBranchRevokePayload(logId));
      batch.set(
        saDb.doc(`platformAuditLogs/${logId}`),
        buildAudit({
          id: logId,
          action: 'BRANCH_BILLING_EXEMPTION_REVOKED',
          targetType: 'branch',
          targetId: 'br_a1',
          orgId: 'org_a',
        })
      );
      await assertSucceeds(batch.commit());
    });

    await runCase('3. Super Admin bulk-exempts all branches of org_a atomically; cross-org branch in same bulk batch is genuinely rejected', async () => {
      // Cross-org piggyback attack: try to exempt br_b1 (org_b) using org_a's bulk audit log -> MUST genuinely FAIL
      const crossOrgBulk = saDb.batch();
      crossOrgBulk.update(saDb.doc('branches/br_a2'), buildBranchGrantPayload('plog_bulk_cross_bad', 'billing_exempt'));
      crossOrgBulk.update(saDb.doc('branches/br_b1'), buildBranchGrantPayload('plog_bulk_cross_bad', 'billing_exempt'));
      crossOrgBulk.set(
        saDb.doc('platformAuditLogs/plog_bulk_cross_bad'),
        buildAudit({
          id: 'plog_bulk_cross_bad',
          action: 'ORG_BRANCHES_BULK_EXEMPTION_GRANTED',
          targetType: 'organization',
          targetId: 'org_a',
          orgId: 'org_a',
          metadata: { primaryBranchId: 'br_a2', count: 2 },
        })
      );
      await assertGenuineFails(crossOrgBulk.commit(), 'bulk exemption piggybacking foreign branch');

      // Legitimate bulk exemption for all branches of org_a SUCCEEDS
      const bulkLogId = 'plog_org_a_bulk_01';
      const bulkBatch = saDb.batch();
      bulkBatch.update(saDb.doc('branches/br_a1'), buildBranchGrantPayload(bulkLogId, 'billing_exempt'));
      bulkBatch.update(saDb.doc('branches/br_a2'), buildBranchGrantPayload(bulkLogId, 'billing_exempt'));
      bulkBatch.update(saDb.doc('branches/br_a3'), buildBranchGrantPayload(bulkLogId, 'billing_exempt'));
      bulkBatch.set(
        saDb.doc(`platformAuditLogs/${bulkLogId}`),
        buildAudit({
          id: bulkLogId,
          action: 'ORG_BRANCHES_BULK_EXEMPTION_GRANTED',
          targetType: 'organization',
          targetId: 'org_a',
          orgId: 'org_a',
          metadata: { primaryBranchId: 'br_a1', count: 3 },
        })
      );
      await assertSucceeds(bulkBatch.commit());
    });

    await runCase('4. Org manager, branch manager, employee, onlak2030, random user, and unverified SA cannot grant branch exemptions', async () => {
      const payload = buildBranchGrantPayload('plog_unauth_br_1');
      await assertGenuineFails(mgrADb.doc('branches/br_a1').update(payload), 'mgr_a grant branch exempt');
      await assertGenuineFails(bmA1Db.doc('branches/br_a1').update(payload), 'bm_a1 grant branch exempt');
      await assertGenuineFails(empA1Db.doc('branches/br_a1').update(payload), 'emp_a1 grant branch exempt');
      await assertGenuineFails(onlakDb.doc('branches/br_b1').update(payload), 'onlak2030 grant branch exempt');
      await assertGenuineFails(otherDb.doc('branches/br_b1').update(payload), 'other user grant branch exempt');

      const unvBatch = saUnverifiedDb.batch();
      unvBatch.update(saUnverifiedDb.doc('branches/br_b1'), buildBranchGrantPayload('plog_unv_br_1'));
      unvBatch.set(
        saUnverifiedDb.doc('platformAuditLogs/plog_unv_br_1'),
        buildAudit({
          id: 'plog_unv_br_1',
          action: 'BRANCH_BILLING_EXEMPTION_GRANTED',
          targetType: 'branch',
          targetId: 'br_b1',
          orgId: 'org_b',
          actorUid: 'uid_sa_unv',
        })
      );
      await assertGenuineFails(unvBatch.commit(), 'unverified SA grant branch exempt');
    });

    await runCase('5. Branch exemption rejects cross-org audit mismatch, orgId mutation, and missing/reused/mismatched atomic audit logs', async () => {
      // Solo branch exemption update without audit log
      await assertGenuineFails(
        saDb.doc('branches/br_b1').update(buildBranchGrantPayload('plog_br_solo_no_log')),
        'solo branch exempt update without audit'
      );

      // Sneaky paymentStatus='exempt' without audit log
      await assertGenuineFails(
        saDb.doc('branches/br_b1').update({ paymentStatus: 'exempt', monthlyFeeSar: 0, updatedAt: nowIso }),
        'sneaky paymentStatus=exempt without audit'
      );

      // Foreign orgId in audit log (br_b1 belongs to org_b, audit says org_a)
      const foreignOrgAudit = saDb.batch();
      foreignOrgAudit.update(saDb.doc('branches/br_b1'), buildBranchGrantPayload('plog_br_foreign_org'));
      foreignOrgAudit.set(
        saDb.doc('platformAuditLogs/plog_br_foreign_org'),
        buildAudit({
          id: 'plog_br_foreign_org',
          action: 'BRANCH_BILLING_EXEMPTION_GRANTED',
          targetType: 'branch',
          targetId: 'br_b1',
          orgId: 'org_a',
        })
      );
      await assertGenuineFails(foreignOrgAudit.commit(), 'branch grant with wrong orgId in audit');

      // Mismatched logId
      const mismatchLogId = saDb.batch();
      mismatchLogId.update(saDb.doc('branches/br_b1'), buildBranchGrantPayload('plog_br_id_1'));
      mismatchLogId.set(
        saDb.doc('platformAuditLogs/plog_br_id_2'),
        buildAudit({
          id: 'plog_br_id_2',
          action: 'BRANCH_BILLING_EXEMPTION_GRANTED',
          targetType: 'branch',
          targetId: 'br_b1',
          orgId: 'org_b',
        })
      );
      await assertGenuineFails(mismatchLogId.commit(), 'branch grant mismatched logId');

      // Wrong action (REVOKED during grant)
      const wrongAction = saDb.batch();
      wrongAction.update(saDb.doc('branches/br_b1'), buildBranchGrantPayload('plog_br_wrong_act'));
      wrongAction.set(
        saDb.doc('platformAuditLogs/plog_br_wrong_act'),
        buildAudit({
          id: 'plog_br_wrong_act',
          action: 'BRANCH_BILLING_EXEMPTION_REVOKED',
          targetType: 'branch',
          targetId: 'br_b1',
          orgId: 'org_b',
        })
      );
      await assertGenuineFails(wrongAction.commit(), 'branch grant wrong action');

      // Reused existing logId
      const reuseLog = saDb.batch();
      reuseLog.update(saDb.doc('branches/br_b1'), buildBranchGrantPayload('plog_already_exists'));
      reuseLog.set(
        saDb.doc('platformAuditLogs/plog_already_exists'),
        buildAudit({
          id: 'plog_already_exists',
          action: 'BRANCH_BILLING_EXEMPTION_GRANTED',
          targetType: 'branch',
          targetId: 'br_b1',
          orgId: 'org_b',
        })
      );
      await assertGenuineFails(reuseLog.commit(), 'branch grant reused logId');

      // Solo branch exemption audit log without updating branch
      await assertGenuineFails(
        saDb.doc('platformAuditLogs/plog_solo_br_log').set(
          buildAudit({
            id: 'plog_solo_br_log',
            action: 'BRANCH_BILLING_EXEMPTION_GRANTED',
            targetType: 'branch',
            targetId: 'br_b1',
            orgId: 'org_b',
          })
        ),
        'solo branch grant audit log'
      );

      // Attempting to change branch orgId
      await assertGenuineFails(
        saDb.doc('branches/br_b1').update({ orgId: 'org_a', updatedAt: nowIso }),
        'branch orgId mutation'
      );
    });

    await runCase('6. Org explicit legacy_unrestricted grant/revoke succeeds without losing history; granting to manually suspended org is rejected', async () => {
      // Granting exemption to manually suspended org_c_susp (isActive: false) -> genuinely REJECTED
      const suspGrant = saDb.batch();
      suspGrant.update(saDb.doc('organizations/org_c_susp'), {
        billingExempt: true,
        billingExemptScope: 'full_permanent',
        billingExemptMode: 'legacy_unrestricted',
        billingExemptReason: 'محاولة إعفاء مؤسسة موقوفة يدوياً',
        billingExemptGrantedAt: tsNow,
        billingExemptGrantedBy: 'amoal2030@gmail.com',
        billingExemptVerifiedOwnerId: 'mgr_c',
        billingExemptVerifiedOwnerEmail: 'owner.c@example.com',
        billingExemptLastAuditLogId: 'plog_susp_org_c',
        updatedAt: nowIso,
      });
      suspGrant.set(
        saDb.doc('platformAuditLogs/plog_susp_org_c'),
        buildAudit({
          id: 'plog_susp_org_c',
          action: 'ORG_LEGACY_UNRESTRICTED_GRANTED',
          targetType: 'organization',
          targetId: 'org_c_susp',
          orgId: 'org_c_susp',
        })
      );
      await assertGenuineFails(suspGrant.commit(), 'grant exemption to manually suspended org');

      // Trying to alter/zero historical subscriptionPlan during exemption grant -> genuinely REJECTED
      const mutateHistBatch = saDb.batch();
      mutateHistBatch.update(saDb.doc('organizations/org_d_leg'), {
        subscriptionPlan: '1m',
        billingExempt: true,
        billingExemptScope: 'full_permanent',
        billingExemptMode: 'legacy_unrestricted',
        billingExemptReason: 'محاولة تعديل تاريخ الاشتراك مع الإعفاء',
        billingExemptGrantedAt: tsNow,
        billingExemptGrantedBy: 'amoal2030@gmail.com',
        billingExemptVerifiedOwnerId: 'mgr_d',
        billingExemptVerifiedOwnerEmail: 'owner.d@example.com',
        billingExemptLastAuditLogId: 'plog_d_hist_bad',
        updatedAt: nowIso,
      });
      mutateHistBatch.set(
        saDb.doc('platformAuditLogs/plog_d_hist_bad'),
        buildAudit({
          id: 'plog_d_hist_bad',
          action: 'ORG_LEGACY_UNRESTRICTED_GRANTED',
          targetType: 'organization',
          targetId: 'org_d_leg',
          orgId: 'org_d_leg',
        })
      );
      await assertGenuineFails(mutateHistBatch.commit(), 'org grant mutating historical subscriptionPlan');

      // Org D is expired before grant
      await assertGenuineFails(mgrDDb.collection('branches').where('orgId', '==', 'org_d_leg').get(), 'org_d expired before legacy grant');

      // Grant explicit legacy_unrestricted on org_d_leg -> SUCCEEDS & unlocks operational access + future exempt branch
      const grantLegId = 'plog_org_d_leg_grant';
      const grantLegBatch = saDb.batch();
      grantLegBatch.update(saDb.doc('organizations/org_d_leg'), {
        billingExempt: true,
        billingExemptScope: 'full_permanent',
        billingExemptMode: 'legacy_unrestricted',
        billingExemptReason: 'اعتماد المؤسسة ضمن legacy_unrestricted مع حفظ السجل التاريخي',
        billingExemptGrantedAt: tsNow,
        billingExemptGrantedBy: 'amoal2030@gmail.com',
        billingExemptVerifiedOwnerId: 'mgr_d',
        billingExemptVerifiedOwnerEmail: 'owner.d@example.com',
        billingExemptLastAuditLogId: grantLegId,
        updatedAt: nowIso,
      });
      grantLegBatch.set(
        saDb.doc(`platformAuditLogs/${grantLegId}`),
        buildAudit({
          id: grantLegId,
          action: 'ORG_LEGACY_UNRESTRICTED_GRANTED',
          targetType: 'organization',
          targetId: 'org_d_leg',
          orgId: 'org_d_leg',
        })
      );
      await assertSucceeds(grantLegBatch.commit());
      await assertSucceeds(mgrDDb.collection('branches').where('orgId', '==', 'org_d_leg').get());

      // Future branch on legacy_unrestricted org_d_leg created with paymentStatus='exempt' & 0 SAR SUCCEEDS
      await assertSucceeds(
        saDb.doc('branches/br_d2_future').set({
          id: 'br_d2_future',
          orgId: 'org_d_leg',
          name: 'فرع دلتا المستقبلي',
          code: 'D02',
          isActive: true,
          lifecycleStatus: 'active',
          monthlyFeeSar: 0,
          paymentStatus: 'exempt',
          feeDueAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
      );

      // Revoke explicit legacy_unrestricted on org_d_leg -> SUCCEEDS & restores expired block
      const revokeLegId = 'plog_org_d_leg_revoke';
      const revokeLegBatch = saDb.batch();
      revokeLegBatch.update(saDb.doc('organizations/org_d_leg'), {
        billingExempt: false,
        billingExemptRevokedAt: tsNow,
        billingExemptRevokedBy: 'amoal2030@gmail.com',
        billingExemptRevokeReason: 'إلغاء حالة legacy_unrestricted للعودة للحالة التاريخية',
        billingExemptLastAuditLogId: revokeLegId,
        updatedAt: nowIso,
      });
      revokeLegBatch.set(
        saDb.doc(`platformAuditLogs/${revokeLegId}`),
        buildAudit({
          id: revokeLegId,
          action: 'ORG_LEGACY_UNRESTRICTED_REVOKED',
          targetType: 'organization',
          targetId: 'org_d_leg',
          orgId: 'org_d_leg',
        })
      );
      await assertSucceeds(revokeLegBatch.commit());
      await assertGenuineFails(mgrDDb.collection('branches').where('orgId', '==', 'org_d_leg').get(), 'org_d blocked after legacy revoke');
    });

    // =========================================================================
    // SECTION 2: SUPER ADMIN CROSS-ORGANIZATION MEMBER MANAGEMENT
    // =========================================================================

    await runCase('7. Super Admin creates employee, supervisor, and branch_manager across orgs with atomic MEMBER_CREATED audit logs', async () => {
      // 7a. Create employee in org_a bound to br_a1
      const empLog = 'plog_mem_create_emp1';
      const bEmp = saDb.batch();
      bEmp.set(saDb.doc('users/sa_emp_01'), {
        uid: 'sa_emp_01',
        orgId: 'org_a',
        email: 'sa.emp01@example.com',
        displayName: 'موظف مضاف من المدير الرئيسي',
        role: 'employee',
        branchId: 'br_a1',
        branchIds: ['br_a1'],
        branchName: 'فرع ألفا 1',
        isActive: true,
        isArchived: false,
        permissions: {
          canCreateClosing: true,
          canViewAllClosings: false,
          canApproveClosings: false,
          canManageBranches: false,
          canManageEmployees: false,
          canExportReports: false,
        },
        lastPlatformAuditLogId: empLog,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      bEmp.set(
        saDb.doc(`platformAuditLogs/${empLog}`),
        buildAudit({
          id: empLog,
          action: 'MEMBER_CREATED',
          targetType: 'member',
          targetId: 'sa_emp_01',
          orgId: 'org_a',
        })
      );
      await assertSucceeds(bEmp.commit());

      // 7b. Create supervisor in org_a (org-wide, no forced single branch)
      const supLog = 'plog_mem_create_sup1';
      const bSup = saDb.batch();
      bSup.set(saDb.doc('users/sa_sup_01'), {
        uid: 'sa_sup_01',
        orgId: 'org_a',
        email: 'sa.sup01@example.com',
        displayName: 'مشرف مضاف من المدير الرئيسي',
        role: 'supervisor',
        isActive: true,
        isArchived: false,
        permissions: {
          canCreateClosing: false,
          canViewAllClosings: true,
          canApproveClosings: true,
          canManageBranches: false,
          canManageEmployees: false,
          canExportReports: true,
        },
        lastPlatformAuditLogId: supLog,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      bSup.set(
        saDb.doc(`platformAuditLogs/${supLog}`),
        buildAudit({
          id: supLog,
          action: 'MEMBER_CREATED',
          targetType: 'member',
          targetId: 'sa_sup_01',
          orgId: 'org_a',
        })
      );
      await assertSucceeds(bSup.commit());

      // 7c. Create branch_manager in org_b bound to br_b1
      const bmLog = 'plog_mem_create_bm1';
      const bBm = saDb.batch();
      bBm.set(saDb.doc('users/sa_bm_01'), {
        uid: 'sa_bm_01',
        orgId: 'org_b',
        email: 'sa.bm01@example.com',
        displayName: 'مسؤول فرع بيتا',
        role: 'branch_manager',
        branchId: 'br_b1',
        branchIds: ['br_b1'],
        branchName: 'فرع بيتا 1',
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
          canViewSuppliers: true,
        },
        lastPlatformAuditLogId: bmLog,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      bBm.set(
        saDb.doc(`platformAuditLogs/${bmLog}`),
        buildAudit({
          id: bmLog,
          action: 'MEMBER_CREATED',
          targetType: 'member',
          targetId: 'sa_bm_01',
          orgId: 'org_b',
        })
      );
      await assertSucceeds(bBm.commit());
    });

    await runCase('8. Super Admin changes member role, transfers member between branches in same org, and updates profile atomically', async () => {
      // 8a. Change role: employee -> branch_manager on br_a1
      const roleLog = 'plog_mem_role_01';
      const bRole = saDb.batch();
      bRole.update(saDb.doc('users/sa_emp_01'), {
        role: 'branch_manager',
        permissions: {
          canCreateClosing: true,
          canViewAllClosings: false,
          canApproveClosings: false,
          canManageBranches: false,
          canManageEmployees: false,
          canExportReports: false,
          canManagePurchases: true,
          canViewSuppliers: true,
        },
        lastPlatformAuditLogId: roleLog,
        updatedAt: nowIso,
      });
      bRole.set(
        saDb.doc(`platformAuditLogs/${roleLog}`),
        buildAudit({
          id: roleLog,
          action: 'MEMBER_ROLE_CHANGED',
          targetType: 'member',
          targetId: 'sa_emp_01',
          orgId: 'org_a',
        })
      );
      await assertSucceeds(bRole.commit());

      // 8b. Transfer branch within same org: br_a1 -> br_a2
      const brLog = 'plog_mem_branch_01';
      const bBr = saDb.batch();
      bBr.update(saDb.doc('users/sa_emp_01'), {
        branchId: 'br_a2',
        branchIds: ['br_a2'],
        branchName: 'فرع ألفا 2',
        lastPlatformAuditLogId: brLog,
        updatedAt: nowIso,
      });
      bBr.set(
        saDb.doc(`platformAuditLogs/${brLog}`),
        buildAudit({
          id: brLog,
          action: 'MEMBER_BRANCH_CHANGED',
          targetType: 'member',
          targetId: 'sa_emp_01',
          orgId: 'org_a',
        })
      );
      await assertSucceeds(bBr.commit());

      // 8c. Profile update (displayName & phone)
      const updLog = 'plog_mem_upd_01';
      const bUpd = saDb.batch();
      bUpd.update(saDb.doc('users/sa_emp_01'), {
        displayName: 'مسؤول فرع ألفا 2 المحدّث',
        phone: '0551234567',
        lastPlatformAuditLogId: updLog,
        updatedAt: nowIso,
      });
      bUpd.set(
        saDb.doc(`platformAuditLogs/${updLog}`),
        buildAudit({
          id: updLog,
          action: 'MEMBER_UPDATED',
          targetType: 'member',
          targetId: 'sa_emp_01',
          orgId: 'org_a',
        })
      );
      await assertSucceeds(bUpd.commit());
    });

    await runCase('9. Super Admin archives and reactivates a member atomically (archived member loses access immediately; reactivated regains access)', async () => {
      const saEmp01Db = testEnv.authenticatedContext('sa_emp_01', { email: 'sa.emp01@example.com', email_verified: true }).firestore();

      // Active member can read own branch br_a2
      await assertSucceeds(saEmp01Db.doc('branches/br_a2').get());

      // Archive member
      const archLog = 'plog_mem_arch_01';
      const bArch = saDb.batch();
      bArch.update(saDb.doc('users/sa_emp_01'), {
        isActive: false,
        isArchived: true,
        archivedAt: nowIso,
        archivedBy: 'uid_sa',
        lastPlatformAuditLogId: archLog,
        updatedAt: nowIso,
      });
      bArch.set(
        saDb.doc(`platformAuditLogs/${archLog}`),
        buildAudit({
          id: archLog,
          action: 'MEMBER_ARCHIVED',
          targetType: 'member',
          targetId: 'sa_emp_01',
          orgId: 'org_a',
        })
      );
      await assertSucceeds(bArch.commit());

      // Archived member is immediately blocked from reading org branches
      await assertGenuineFails(saEmp01Db.doc('branches/br_a2').get(), 'archived member blocked from branch read');

      // Reactivate member
      const reactLog = 'plog_mem_react_01';
      const bReact = saDb.batch();
      bReact.update(saDb.doc('users/sa_emp_01'), {
        isActive: true,
        isArchived: false,
        lastPlatformAuditLogId: reactLog,
        updatedAt: nowIso,
      });
      bReact.set(
        saDb.doc(`platformAuditLogs/${reactLog}`),
        buildAudit({
          id: reactLog,
          action: 'MEMBER_REACTIVATED',
          targetType: 'member',
          targetId: 'sa_emp_01',
          orgId: 'org_a',
        })
      );
      await assertSucceeds(bReact.commit());

      // Reactivated member regains access cleanly
      await assertSucceeds(saEmp01Db.doc('branches/br_a2').get());
    });

    await runCase('10. Rejects creating/promoting manager or super_admin, editing existing manager, targeting amoal2030, changing uid, or forced orgId transfer', async () => {
      // 10a. Create with role 'manager' -> REJECTED
      const createMgr = saDb.batch();
      createMgr.set(saDb.doc('users/bad_mgr_01'), {
        uid: 'bad_mgr_01',
        orgId: 'org_a',
        email: 'bad.mgr@example.com',
        displayName: 'مدير غير مسموح',
        role: 'manager',
        isActive: true,
        lastPlatformAuditLogId: 'plog_bad_mgr',
        createdAt: nowIso,
      });
      createMgr.set(
        saDb.doc('platformAuditLogs/plog_bad_mgr'),
        buildAudit({ id: 'plog_bad_mgr', action: 'MEMBER_CREATED', targetType: 'member', targetId: 'bad_mgr_01', orgId: 'org_a' })
      );
      await assertGenuineFails(createMgr.commit(), 'create role manager');

      // 10b. Create with role 'super_admin' -> REJECTED
      const createSa = saDb.batch();
      createSa.set(saDb.doc('users/bad_sa_01'), {
        uid: 'bad_sa_01',
        orgId: 'org_a',
        email: 'bad.sa@example.com',
        displayName: 'مدير رئيسي مزيف',
        role: 'super_admin',
        isActive: true,
        lastPlatformAuditLogId: 'plog_bad_sa',
        createdAt: nowIso,
      });
      createSa.set(
        saDb.doc('platformAuditLogs/plog_bad_sa'),
        buildAudit({ id: 'plog_bad_sa', action: 'MEMBER_CREATED', targetType: 'member', targetId: 'bad_sa_01', orgId: 'org_a' })
      );
      await assertGenuineFails(createSa.commit(), 'create role super_admin');

      // 10c. Promote existing employee to 'manager' -> REJECTED
      const promoteMgr = saDb.batch();
      promoteMgr.update(saDb.doc('users/sa_emp_01'), {
        role: 'manager',
        lastPlatformAuditLogId: 'plog_promote_mgr',
        updatedAt: nowIso,
      });
      promoteMgr.set(
        saDb.doc('platformAuditLogs/plog_promote_mgr'),
        buildAudit({ id: 'plog_promote_mgr', action: 'MEMBER_ROLE_CHANGED', targetType: 'member', targetId: 'sa_emp_01', orgId: 'org_a' })
      );
      await assertGenuineFails(promoteMgr.commit(), 'promote employee to manager');

      // 10d. Modify/archive existing org manager (`mgr_a`) -> REJECTED
      const archiveMgr = saDb.batch();
      archiveMgr.update(saDb.doc('users/mgr_a'), {
        isActive: false,
        isArchived: true,
        archivedAt: nowIso,
        archivedBy: 'uid_sa',
        lastPlatformAuditLogId: 'plog_arch_mgr_a',
        updatedAt: nowIso,
      });
      archiveMgr.set(
        saDb.doc('platformAuditLogs/plog_arch_mgr_a'),
        buildAudit({ id: 'plog_arch_mgr_a', action: 'MEMBER_ARCHIVED', targetType: 'member', targetId: 'mgr_a', orgId: 'org_a' })
      );
      await assertGenuineFails(archiveMgr.commit(), 'archive existing manager');

      // 10e. Create member using Super Admin email amoal2030@gmail.com -> REJECTED
      const touchSaEmail = saDb.batch();
      touchSaEmail.set(saDb.doc('users/spoof_sa_email'), {
        uid: 'spoof_sa_email',
        orgId: 'org_a',
        email: 'AMOAL2030@gmail.com',
        displayName: 'محاولة استخدام بريد المدير الرئيسي',
        role: 'employee',
        branchId: 'br_a1',
        branchIds: ['br_a1'],
        isActive: true,
        lastPlatformAuditLogId: 'plog_spoof_sa',
        createdAt: nowIso,
      });
      touchSaEmail.set(
        saDb.doc('platformAuditLogs/plog_spoof_sa'),
        buildAudit({ id: 'plog_spoof_sa', action: 'MEMBER_CREATED', targetType: 'member', targetId: 'spoof_sa_email', orgId: 'org_a' })
      );
      await assertGenuineFails(touchSaEmail.commit(), 'create member with amoal2030 email');

      // 10f. Mutate uid or transfer member to another org (org_a -> org_b) -> REJECTED
      const moveOrg = saDb.batch();
      moveOrg.update(saDb.doc('users/sa_emp_01'), {
        orgId: 'org_b',
        branchId: 'br_b1',
        branchIds: ['br_b1'],
        lastPlatformAuditLogId: 'plog_move_org',
        updatedAt: nowIso,
      });
      moveOrg.set(
        saDb.doc('platformAuditLogs/plog_move_org'),
        buildAudit({ id: 'plog_move_org', action: 'MEMBER_BRANCH_CHANGED', targetType: 'member', targetId: 'sa_emp_01', orgId: 'org_b' })
      );
      await assertGenuineFails(moveOrg.commit(), 'force transfer member to another org');

      const mutateUid = saDb.batch();
      mutateUid.update(saDb.doc('users/sa_emp_01'), {
        uid: 'different_uid',
        lastPlatformAuditLogId: 'plog_mut_uid',
        updatedAt: nowIso,
      });
      mutateUid.set(
        saDb.doc('platformAuditLogs/plog_mut_uid'),
        buildAudit({ id: 'plog_mut_uid', action: 'MEMBER_UPDATED', targetType: 'member', targetId: 'sa_emp_01', orgId: 'org_a' })
      );
      await assertGenuineFails(mutateUid.commit(), 'mutate member uid');
    });

    await runCase('11. Rejects assigning a branch belonging to a different organization (on create and on transfer)', async () => {
      // Create employee in org_a with br_b1 (belongs to org_b) -> REJECTED
      const createForeignBr = saDb.batch();
      createForeignBr.set(saDb.doc('users/sa_emp_foreign_br'), {
        uid: 'sa_emp_foreign_br',
        orgId: 'org_a',
        email: 'foreign.br@example.com',
        displayName: 'موظف بفرع أجنبي',
        role: 'employee',
        branchId: 'br_b1',
        branchIds: ['br_b1'],
        isActive: true,
        lastPlatformAuditLogId: 'plog_foreign_br_create',
        createdAt: nowIso,
      });
      createForeignBr.set(
        saDb.doc('platformAuditLogs/plog_foreign_br_create'),
        buildAudit({ id: 'plog_foreign_br_create', action: 'MEMBER_CREATED', targetType: 'member', targetId: 'sa_emp_foreign_br', orgId: 'org_a' })
      );
      await assertGenuineFails(createForeignBr.commit(), 'create member with foreign-org branch');

      // Transfer sa_emp_01 (org_a) to br_b1 (org_b) -> REJECTED
      const transferForeignBr = saDb.batch();
      transferForeignBr.update(saDb.doc('users/sa_emp_01'), {
        branchId: 'br_b1',
        branchIds: ['br_b1'],
        lastPlatformAuditLogId: 'plog_foreign_br_transfer',
        updatedAt: nowIso,
      });
      transferForeignBr.set(
        saDb.doc('platformAuditLogs/plog_foreign_br_transfer'),
        buildAudit({ id: 'plog_foreign_br_transfer', action: 'MEMBER_BRANCH_CHANGED', targetType: 'member', targetId: 'sa_emp_01', orgId: 'org_a' })
      );
      await assertGenuineFails(transferForeignBr.commit(), 'transfer member to foreign-org branch');

      // Create employee in non-existent org -> REJECTED
      const missingOrg = saDb.batch();
      missingOrg.set(saDb.doc('users/sa_emp_no_org'), {
        uid: 'sa_emp_no_org',
        orgId: 'org_nonexistent',
        email: 'noorg@example.com',
        displayName: 'مؤسسة غير موجودة',
        role: 'supervisor',
        isActive: true,
        lastPlatformAuditLogId: 'plog_no_org',
        createdAt: nowIso,
      });
      missingOrg.set(
        saDb.doc('platformAuditLogs/plog_no_org'),
        buildAudit({ id: 'plog_no_org', action: 'MEMBER_CREATED', targetType: 'member', targetId: 'sa_emp_no_org', orgId: 'org_nonexistent' })
      );
      await assertGenuineFails(missingOrg.commit(), 'create member in nonexistent org');
    });

    await runCase('12. Strictly rejects deleting users or platformAuditLogs and editing platformAuditLogs (even by Super Admin)', async () => {
      await assertGenuineFails(saDb.doc('users/sa_emp_01').delete(), 'SA delete users doc');
      await assertGenuineFails(mgrADb.doc('users/sa_emp_01').delete(), 'manager delete users doc');
      await assertGenuineFails(saDb.doc('platformAuditLogs/plog_mem_create_emp1').delete(), 'SA delete platformAuditLog');
      await assertGenuineFails(
        saDb.doc('platformAuditLogs/plog_mem_create_emp1').update({ details: 'تعديل سجل غير مسموح' }),
        'SA update platformAuditLog'
      );
    });

    await runCase('13. Unauthorized accounts (foreign manager, branch manager, employee, onlak2030, unverified SA) cannot execute cross-org member operations', async () => {
      const sampleUser = {
        uid: 'unauth_mem_01',
        orgId: 'org_a',
        email: 'unauth.mem@example.com',
        displayName: 'عضو غير مصرح',
        role: 'employee',
        branchId: 'br_a1',
        branchIds: ['br_a1'],
        isActive: true,
        lastPlatformAuditLogId: 'plog_unauth_mem',
        createdAt: nowIso,
      };
      await assertGenuineFails(mgrBDb.doc('users/unauth_mem_01').set(sampleUser), 'foreign manager create in org_a');
      await assertGenuineFails(bmA1Db.doc('users/unauth_mem_01').set(sampleUser), 'branch_manager create member');
      await assertGenuineFails(empA1Db.doc('users/unauth_mem_01').set(sampleUser), 'employee create member');
      await assertGenuineFails(onlakDb.doc('users/unauth_mem_01').set(sampleUser), 'onlak2030 create member');
      await assertGenuineFails(otherDb.doc('users/unauth_mem_01').set(sampleUser), 'random user create member');
      await assertGenuineFails(mgrBDb.doc('users/sa_emp_01').update({ displayName: 'اختراق' }), 'foreign manager update org_a member');

      const unvCreate = saUnverifiedDb.batch();
      unvCreate.set(saUnverifiedDb.doc('users/unauth_mem_unv'), { ...sampleUser, uid: 'unauth_mem_unv', lastPlatformAuditLogId: 'plog_unv_mem' });
      unvCreate.set(
        saUnverifiedDb.doc('platformAuditLogs/plog_unv_mem'),
        buildAudit({ id: 'plog_unv_mem', action: 'MEMBER_CREATED', targetType: 'member', targetId: 'unauth_mem_unv', orgId: 'org_a', actorUid: 'uid_sa_unv' })
      );
      await assertGenuineFails(unvCreate.commit(), 'unverified SA create member');
    });

    // =========================================================================
    // SECTION 3: ATOMIC AUDIT COUPLING NEGATIVE & POSITIVE VERIFICATION FOR MEMBERS
    // =========================================================================

    await runCase('14. Member operations strictly reject missing audit log, solo audit log, mismatched orgId/action/logId, and reused logId', async () => {
      // 14a. Update member WITHOUT audit log -> REJECTED
      await assertGenuineFails(
        saDb.doc('users/sa_emp_01').update({
          displayName: 'تحديث بدون سجل تدقيق',
          lastPlatformAuditLogId: 'plog_missing_mem_log',
          updatedAt: nowIso,
        }),
        'member update without audit log'
      );

      // 14b. Solo member audit log WITHOUT user write -> REJECTED
      await assertGenuineFails(
        saDb.doc('platformAuditLogs/plog_solo_mem_log').set(
          buildAudit({ id: 'plog_solo_mem_log', action: 'MEMBER_UPDATED', targetType: 'member', targetId: 'sa_emp_01', orgId: 'org_a' })
        ),
        'solo member audit log'
      );

      // 14c. Mismatched orgId in member audit log -> REJECTED
      const mismatchOrg = saDb.batch();
      mismatchOrg.update(saDb.doc('users/sa_emp_01'), {
        displayName: 'تعارض المؤسسة في السجل',
        lastPlatformAuditLogId: 'plog_mem_bad_org',
        updatedAt: nowIso,
      });
      mismatchOrg.set(
        saDb.doc('platformAuditLogs/plog_mem_bad_org'),
        buildAudit({ id: 'plog_mem_bad_org', action: 'MEMBER_UPDATED', targetType: 'member', targetId: 'sa_emp_01', orgId: 'org_b' })
      );
      await assertGenuineFails(mismatchOrg.commit(), 'member update mismatched orgId in audit');

      // 14d. Mismatched action (says MEMBER_ARCHIVED during displayName update) -> REJECTED
      const wrongAction = saDb.batch();
      wrongAction.update(saDb.doc('users/sa_emp_01'), {
        displayName: 'تعارض نوع الإجراء',
        lastPlatformAuditLogId: 'plog_mem_wrong_act',
        updatedAt: nowIso,
      });
      wrongAction.set(
        saDb.doc('platformAuditLogs/plog_mem_wrong_act'),
        buildAudit({ id: 'plog_mem_wrong_act', action: 'MEMBER_ARCHIVED', targetType: 'member', targetId: 'sa_emp_01', orgId: 'org_a' })
      );
      await assertGenuineFails(wrongAction.commit(), 'member update wrong audit action');

      // 14e. Mismatched logId -> REJECTED
      const mismatchLogId = saDb.batch();
      mismatchLogId.update(saDb.doc('users/sa_emp_01'), {
        displayName: 'تعارض معرف السجل',
        lastPlatformAuditLogId: 'plog_mem_id_a',
        updatedAt: nowIso,
      });
      mismatchLogId.set(
        saDb.doc('platformAuditLogs/plog_mem_id_b'),
        buildAudit({ id: 'plog_mem_id_b', action: 'MEMBER_UPDATED', targetType: 'member', targetId: 'sa_emp_01', orgId: 'org_a' })
      );
      await assertGenuineFails(mismatchLogId.commit(), 'member update mismatched logId');

      // 14f. Reused existing logId -> REJECTED
      const reusedLog = saDb.batch();
      reusedLog.update(saDb.doc('users/sa_emp_01'), {
        displayName: 'إعادة استخدام معرف سجل قديم',
        lastPlatformAuditLogId: 'plog_already_exists',
        updatedAt: nowIso,
      });
      reusedLog.set(
        saDb.doc('platformAuditLogs/plog_already_exists'),
        buildAudit({ id: 'plog_already_exists', action: 'MEMBER_UPDATED', targetType: 'member', targetId: 'sa_emp_01', orgId: 'org_a' })
      );
      await assertGenuineFails(reusedLog.commit(), 'member update reused logId');
    });
  } finally {
    await testEnv.cleanup();
  }

  const passedCount = outcomes.filter((o) => o.passed).length;
  const failedCount = outcomes.length - passedCount;

  console.log('\n========================================================================');
  console.log(`   PHASE B EMULATOR SUITE SUMMARY: ${passedCount}/${outcomes.length} PASSED, ${failedCount} FAILED`);
  console.log(`   GENUINE SECURITY DENIALS VERIFIED: ${genuineSecurityDenialsCount}`);
  console.log(`   1000-EXPRESSION LIMIT ERRORS: ${expressionLimitErrorsCount}`);
  console.log('========================================================================');

  if (failedCount > 0 || expressionLimitErrorsCount > 0) {
    process.exit(1);
  }
}

runPhaseBEmulatorTests().catch((err) => {
  console.error('PHASE B EMULATOR RUNNER FAILURE:', err);
  process.exit(1);
});
