/**
 * Permanent Full Billing Exemption (`billing_exempt`) Firestore Rules Emulator Test Suite
 *
 * Tests real `firestore.rules` against an isolated local Firestore Emulator via `@firebase/rules-unit-testing`.
 * Uses `assertGenuineFails` to guarantee that EVERY expected denial is a true security rejection
 * and NEVER a false-positive `maximum of 1000 expressions` evaluation crash.
 *
 * Run with:
 *   firebase emulators:exec --only firestore "npx tsx src/tests/billingExemptionEmulatorRules.test.ts"
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

/**
 * Guarantees a Firestore request fails due to a genuine security rule denial
 * and NEVER due to hitting the 1,000-expression evaluation limit.
 */
async function assertGenuineFails<T>(promise: Promise<T>, label?: string): Promise<void> {
  const err = await assertFails(promise);
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('maximum of 1000 expressions')) {
    throw new Error(
      `FALSE-POSITIVE REJECTION (hit 1,000-expression limit)${label ? ` [${label}]` : ''}: ${msg}`
    );
  }
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

async function runBillingExemptionEmulatorTests() {
  console.log('========================================================================');
  console.log('   PERMANENT BILLING EXEMPTION — FIRESTORE EMULATOR SECURITY TESTS      ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-billing-exemption-tests',
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

    // 1. Target Org A (Expired historical subscription — candidate for permanent exemption)
    await db.doc('organizations/org_exp_a').set({
      id: 'org_exp_a',
      name: 'مؤسسة الاختبار المنتهية أ',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_exp_a',
      ownerEmail: 'adartalmtm@gmail.com',
      ownerName: 'مدير أ',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'expired',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsPast2d,
      accountSetupFeeSar: 80,
      setupFeeStatus: 'unpaid',
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // 2. Target Org B (Active historical subscription — to verify revocation returns to active)
    await db.doc('organizations/org_act_b').set({
      id: 'org_act_b',
      name: 'مؤسسة الاختبار النشطة ب',
      activityType: 'services',
      currency: 'SAR',
      ownerId: 'mgr_act_b',
      ownerEmail: 'foadalkamel05@gmail.com',
      ownerName: 'مدير ب',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1y',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // 3. Target Org C (Missing ownerId — grant MUST fail)
    await db.doc('organizations/org_no_owner').set({
      id: 'org_no_owner',
      name: 'مؤسسة بلا مالك مرتبط',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: '',
      ownerEmail: 'unclaimed@example.com',
      ownerName: 'غير مرتبط',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'expired',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsPast2d,
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // 4a. Target Org D1 (Already exempt in DB, with ownerEmail MISMATCH ONLY — ownerId matches)
    await db.doc('organizations/org_mismatch_email').set({
      id: 'org_mismatch_email',
      name: 'مؤسسة تعارض بريد المالك فقط',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_mismatch_email',
      ownerEmail: 'new.owner@example.com',
      ownerName: 'مالك متغير البريد',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'expired',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsPast2d,
      billingExempt: true,
      billingExemptScope: 'full_permanent',
      billingExemptReason: 'إعفاء سابق قبل تغير البريد',
      billingExemptGrantedAt: tsPast30d,
      billingExemptGrantedBy: 'amoal2030@gmail.com',
      billingExemptVerifiedOwnerId: 'mgr_mismatch_email',
      billingExemptVerifiedOwnerEmail: 'old.owner@example.com',
      billingExemptLastAuditLogId: 'plog_old_mismatch_em',
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // 4b. Target Org D2 (Already exempt in DB, with ownerId MISMATCH ONLY — ownerEmail matches)
    await db.doc('organizations/org_mismatch_uid').set({
      id: 'org_mismatch_uid',
      name: 'مؤسسة تعارض معرف المالك فقط',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_mismatch_uid',
      ownerEmail: 'same.owner@example.com',
      ownerName: 'مالك متغير المعرف',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'expired',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsPast2d,
      billingExempt: true,
      billingExemptScope: 'full_permanent',
      billingExemptReason: 'إعفاء سابق قبل تغير المعرف',
      billingExemptGrantedAt: tsPast30d,
      billingExemptGrantedBy: 'amoal2030@gmail.com',
      billingExemptVerifiedOwnerId: 'mgr_old_uid_different',
      billingExemptVerifiedOwnerEmail: 'same.owner@example.com',
      billingExemptLastAuditLogId: 'plog_old_mismatch_uid',
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // 5. Target Org E (Exempt + Manually suspended `isActive: false` — MUST stay blocked)
    await db.doc('organizations/org_exempt_susp').set({
      id: 'org_exempt_susp',
      name: 'مؤسسة معفاة وموقوفة يدوياً',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_exempt_susp',
      ownerEmail: 'exempt.susp@example.com',
      ownerName: 'مدير موقوف',
      driveConnected: false,
      isActive: false,
      deactivationReason: 'manual_suspension',
      subscriptionPlan: '1m',
      subscriptionStatus: 'expired',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsPast2d,
      billingExempt: true,
      billingExemptScope: 'full_permanent',
      billingExemptReason: 'إعفاء دائم شامل للمؤسسة الموقوفة',
      billingExemptGrantedAt: tsPast30d,
      billingExemptGrantedBy: 'amoal2030@gmail.com',
      billingExemptVerifiedOwnerId: 'mgr_exempt_susp',
      billingExemptVerifiedOwnerEmail: 'exempt.susp@example.com',
      billingExemptLastAuditLogId: 'plog_old_susp',
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // 6. Legacy Org F (No subscription fields — grant then revoke must restore legacy_unrestricted)
    await db.doc('organizations/org_legacy_f').set({
      id: 'org_legacy_f',
      name: 'مؤسسة قديمة بدون حقول اشتراك',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_legacy_f',
      ownerEmail: 'legacy.f@example.com',
      ownerName: 'مدير قديم',
      driveConnected: false,
      createdAt: '2025-12-01T08:00:00.000Z',
      updatedAt: '2025-12-01T08:00:00.000Z',
    });

    // 7. Exempt Org G (Dedicated org to test atomic ownerEmail change + auto-revoke)
    await db.doc('organizations/org_owner_change_g').set({
      id: 'org_owner_change_g',
      name: 'مؤسسة اختبار تغيير هوية المالك',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'mgr_owner_g',
      ownerEmail: 'owner.g@example.com',
      ownerName: 'مالك ج',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'expired',
      subscriptionStartAt: tsPast30d,
      subscriptionEndAt: tsPast2d,
      billingExempt: true,
      billingExemptScope: 'full_permanent',
      billingExemptReason: 'إعفاء دائم قبل تغيير البريد',
      billingExemptGrantedAt: tsPast30d,
      billingExemptGrantedBy: 'amoal2030@gmail.com',
      billingExemptVerifiedOwnerId: 'mgr_owner_g',
      billingExemptVerifiedOwnerEmail: 'owner.g@example.com',
      billingExemptLastAuditLogId: 'plog_seed_owner_g',
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    // Pre-existing audit log (to test replay/reuse rejection)
    await db.doc('platformAuditLogs/plog_existing_reused').set({
      id: 'plog_existing_reused',
      actorEmail: 'amoal2030@gmail.com',
      actorUid: 'uid_sa',
      action: 'ORG_PROFILE_UPDATED',
      targetType: 'organization',
      targetId: 'org_exp_a',
      orgId: 'org_exp_a',
      details: 'سجل قديم لاختبار منع إعادة الاستخدام',
      timestamp: '2026-11-01T08:00:00.000Z',
    });

    // Seed users, branches, suppliers for seeded orgs
    const orgs = [
      { id: 'org_exp_a', uid: 'mgr_exp_a', email: 'adartalmtm@gmail.com', br: 'br_exp_a', emp: 'emp_exp_a' },
      { id: 'org_act_b', uid: 'mgr_act_b', email: 'foadalkamel05@gmail.com', br: 'br_act_b', emp: 'emp_act_b' },
      { id: 'org_mismatch_email', uid: 'mgr_mismatch_email', email: 'new.owner@example.com', br: 'br_mismatch_em', emp: 'emp_mismatch_em' },
      { id: 'org_mismatch_uid', uid: 'mgr_mismatch_uid', email: 'same.owner@example.com', br: 'br_mismatch_uid', emp: 'emp_mismatch_uid' },
      { id: 'org_exempt_susp', uid: 'mgr_exempt_susp', email: 'exempt.susp@example.com', br: 'br_exempt_susp', emp: 'emp_exempt_susp' },
      { id: 'org_legacy_f', uid: 'mgr_legacy_f', email: 'legacy.f@example.com', br: 'br_legacy_f', emp: 'emp_legacy_f' },
      { id: 'org_owner_change_g', uid: 'mgr_owner_g', email: 'owner.g@example.com', br: 'br_owner_g', emp: 'emp_owner_g' },
    ];

    for (const o of orgs) {
      await db.doc(`branches/${o.br}`).set({
        id: o.br,
        orgId: o.id,
        name: `فرع ${o.id}`,
        code: 'B01',
        isActive: true,
        paymentStatus: 'unpaid',
        monthlyFeeSar: 50,
        createdAt: '2026-01-01T08:00:00.000Z',
      });
      await db.doc(`users/${o.uid}`).set({
        uid: o.uid,
        orgId: o.id,
        email: o.email,
        displayName: `مدير ${o.id}`,
        role: 'manager',
        isActive: true,
        createdAt: '2026-01-01T08:00:00.000Z',
      });
      await db.doc(`users/${o.emp}`).set({
        uid: o.emp,
        orgId: o.id,
        branchId: o.br,
        branchName: `فرع ${o.id}`,
        email: `${o.emp}@example.com`,
        displayName: `موظف ${o.id}`,
        role: 'employee',
        isActive: true,
        createdAt: '2026-01-01T08:00:00.000Z',
      });
      await db.doc(`suppliers/sup_${o.id}`).set({
        id: `sup_${o.id}`,
        orgId: o.id,
        name: 'مورد معتمد',
        isActive: true,
        createdBy: o.uid,
        createdAt: '2026-01-01T08:00:00.000Z',
        updatedAt: '2026-01-01T08:00:00.000Z',
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
  const otherEmailDb = testEnv.authenticatedContext('uid_other', { email: 'other.admin@gmail.com', email_verified: true }).firestore();
  const mgrExpADb = testEnv.authenticatedContext('mgr_exp_a', { email: 'adartalmtm@gmail.com', email_verified: true }).firestore();
  const empExpADb = testEnv.authenticatedContext('emp_exp_a', { email: 'emp_exp_a@example.com', email_verified: true }).firestore();
  const mgrMismatchEmailDb = testEnv.authenticatedContext('mgr_mismatch_email', { email: 'new.owner@example.com', email_verified: true }).firestore();
  const mgrMismatchUidDb = testEnv.authenticatedContext('mgr_mismatch_uid', { email: 'same.owner@example.com', email_verified: true }).firestore();
  const mgrExemptSuspDb = testEnv.authenticatedContext('mgr_exempt_susp', { email: 'exempt.susp@example.com', email_verified: true }).firestore();
  const mgrActBDb = testEnv.authenticatedContext('mgr_act_b', { email: 'foadalkamel05@gmail.com', email_verified: true }).firestore();
  const mgrLegacyFDb = testEnv.authenticatedContext('mgr_legacy_f', { email: 'legacy.f@example.com', email_verified: true }).firestore();
  const mgrOwnerGDb = testEnv.authenticatedContext('mgr_owner_g', { email: 'owner.g@example.com', email_verified: true }).firestore();

  const buildGrantFields = (ownerId: string, ownerEmailLower: string, logId: string) => ({
    billingExempt: true,
    billingExemptScope: 'full_permanent',
    billingExemptReason: 'إعفاء دائم شامل معتمد للمؤسسة التأسيسية',
    billingExemptGrantedAt: tsNow,
    billingExemptGrantedBy: 'amoal2030@gmail.com',
    billingExemptVerifiedOwnerId: ownerId,
    billingExemptVerifiedOwnerEmail: ownerEmailLower,
    billingExemptLastAuditLogId: logId,
    updatedAt: nowIso,
  });

  const buildAuditDoc = (
    logId: string,
    orgId: string,
    action: 'ORG_BILLING_EXEMPTION_GRANTED' | 'ORG_BILLING_EXEMPTION_REVOKED'
  ) => ({
    id: logId,
    actorEmail: 'amoal2030@gmail.com',
    actorUid: 'uid_sa',
    action,
    targetType: 'organization',
    targetId: orgId,
    orgId,
    details: 'توثيق ذري لعملية الإعفاء الدائم الشامل',
    timestamp: nowIso,
  });

  try {
    // 1. Expired org is blocked BEFORE exemption
    await runCase('1. Expired org_exp_a is blocked operationally before permanent exemption is granted', async () => {
      await assertGenuineFails(mgrExpADb.collection('branches').where('orgId', '==', 'org_exp_a').get(), 'mgr expired branches');
      await assertGenuineFails(empExpADb.doc('branches/br_exp_a').get(), 'emp expired branch');
    });

    // 2. Non-SuperAdmin & unverified Super Admin CANNOT grant exemption (even with full batch)
    await runCase('2. Manager, employee, other email, and unverified Super Admin are rejected when attempting to grant exemption', async () => {
      const payload = buildGrantFields('mgr_exp_a', 'adartalmtm@gmail.com', 'plog_unauth_1');
      await assertGenuineFails(mgrExpADb.doc('organizations/org_exp_a').update(payload), 'mgr grant');
      await assertGenuineFails(empExpADb.doc('organizations/org_exp_a').update(payload), 'emp grant');
      await assertGenuineFails(otherEmailDb.doc('organizations/org_exp_a').update(payload), 'other email grant');

      const unvBatch = saUnverifiedDb.batch();
      unvBatch.update(saUnverifiedDb.doc('organizations/org_exp_a'), buildGrantFields('mgr_exp_a', 'adartalmtm@gmail.com', 'plog_unauth_unv'));
      unvBatch.set(saUnverifiedDb.doc('platformAuditLogs/plog_unauth_unv'), {
        ...buildAuditDoc('plog_unauth_unv', 'org_exp_a', 'ORG_BILLING_EXEMPTION_GRANTED'),
        actorUid: 'uid_sa_unv',
      });
      await assertGenuineFails(unvBatch.commit(), 'unverified SA grant');
    });

    // 3. Bidirectional Atomic Audit Coupling — ALL 6 tampering / non-atomic attempts MUST genuinely FAIL (no 1000-expr errors)
    await runCase('3. Bidirectional atomic audit coupling genuinely rejects solo org update, solo audit log (grant/revoke), mismatched logId/orgId/action, and reused logId', async () => {
      // 3a. Org update WITHOUT audit log -> REJECTED
      await assertGenuineFails(
        saDb.doc('organizations/org_exp_a').update(buildGrantFields('mgr_exp_a', 'adartalmtm@gmail.com', 'plog_solo_org')),
        '3a solo org update'
      );

      // 3b. Solo audit log GRANTED & REVOKED WITHOUT org update -> REJECTED
      await assertGenuineFails(
        saDb.doc('platformAuditLogs/plog_solo_audit_g').set(buildAuditDoc('plog_solo_audit_g', 'org_exp_a', 'ORG_BILLING_EXEMPTION_GRANTED')),
        '3b solo grant audit'
      );
      await assertGenuineFails(
        saDb.doc('platformAuditLogs/plog_solo_audit_r').set(buildAuditDoc('plog_solo_audit_r', 'org_owner_change_g', 'ORG_BILLING_EXEMPTION_REVOKED')),
        '3b solo revoke audit'
      );

      // 3c. Batch with mismatched logId between org and audit log -> REJECTED
      const mismatchIdBatch = saDb.batch();
      mismatchIdBatch.update(saDb.doc('organizations/org_exp_a'), buildGrantFields('mgr_exp_a', 'adartalmtm@gmail.com', 'plog_mismatch_a'));
      mismatchIdBatch.set(saDb.doc('platformAuditLogs/plog_mismatch_b'), buildAuditDoc('plog_mismatch_b', 'org_exp_a', 'ORG_BILLING_EXEMPTION_GRANTED'));
      await assertGenuineFails(mismatchIdBatch.commit(), '3c mismatched logId');

      // 3d. Batch with mismatched orgId in audit log (audit references org_act_b while updating org_exp_a) -> REJECTED
      const mismatchOrgBatch = saDb.batch();
      mismatchOrgBatch.update(saDb.doc('organizations/org_exp_a'), buildGrantFields('mgr_exp_a', 'adartalmtm@gmail.com', 'plog_mismatch_org'));
      mismatchOrgBatch.set(saDb.doc('platformAuditLogs/plog_mismatch_org'), buildAuditDoc('plog_mismatch_org', 'org_act_b', 'ORG_BILLING_EXEMPTION_GRANTED'));
      await assertGenuineFails(mismatchOrgBatch.commit(), '3d mismatched orgId');

      // 3e. Batch with wrong action (REVOKED during grant) -> REJECTED
      const wrongActionBatch = saDb.batch();
      wrongActionBatch.update(saDb.doc('organizations/org_exp_a'), buildGrantFields('mgr_exp_a', 'adartalmtm@gmail.com', 'plog_wrong_act'));
      wrongActionBatch.set(saDb.doc('platformAuditLogs/plog_wrong_act'), buildAuditDoc('plog_wrong_act', 'org_exp_a', 'ORG_BILLING_EXEMPTION_REVOKED'));
      await assertGenuineFails(wrongActionBatch.commit(), '3e wrong action');

      // 3f. Batch attempting to reuse an already-existing audit log ID -> REJECTED
      const reuseBatch = saDb.batch();
      reuseBatch.update(saDb.doc('organizations/org_exp_a'), buildGrantFields('mgr_exp_a', 'adartalmtm@gmail.com', 'plog_existing_reused'));
      reuseBatch.set(saDb.doc('platformAuditLogs/plog_existing_reused'), buildAuditDoc('plog_existing_reused', 'org_exp_a', 'ORG_BILLING_EXEMPTION_GRANTED'));
      await assertGenuineFails(reuseBatch.commit(), '3f reused logId');
    });

    // 4. Grant fails genuinely when org has missing ownerId or unverified owner doc
    await runCase('4. Grant is genuinely rejected when organization lacks valid verified ownerId / users/{ownerId} manager doc', async () => {
      const noOwnerBatch = saDb.batch();
      noOwnerBatch.update(saDb.doc('organizations/org_no_owner'), buildGrantFields('', 'unclaimed@example.com', 'plog_no_owner'));
      noOwnerBatch.set(saDb.doc('platformAuditLogs/plog_no_owner'), buildAuditDoc('plog_no_owner', 'org_no_owner', 'ORG_BILLING_EXEMPTION_GRANTED'));
      await assertGenuineFails(noOwnerBatch.commit(), 'missing ownerId');
    });

    // 5. Super Admin atomic grant + audit log SUCCEEDS and unlocks branches, closings, and purchases (production schema `date` + `vatRate: 15`)
    await runCase('5. Super Admin atomic grant + audit log succeeds and immediately unlocks branches, closings, and purchases', async () => {
      const grantLogId = 'plog_grant_exp_a_01';
      const grantBatch = saDb.batch();
      grantBatch.update(saDb.doc('organizations/org_exp_a'), buildGrantFields('mgr_exp_a', 'adartalmtm@gmail.com', grantLogId));
      grantBatch.set(saDb.doc(`platformAuditLogs/${grantLogId}`), buildAuditDoc(grantLogId, 'org_exp_a', 'ORG_BILLING_EXEMPTION_GRANTED'));
      await assertSucceeds(grantBatch.commit());

      // Now org_exp_a manager & employee can read branches, create closing, and create purchase despite expired historical subscription
      await assertSucceeds(mgrExpADb.collection('branches').where('orgId', '==', 'org_exp_a').get());
      await assertSucceeds(
        empExpADb.doc('closings/cls_exempt_01').set({
          id: 'cls_exempt_01',
          orgId: 'org_exp_a',
          branchId: 'br_exp_a',
          branchName: 'فرع org_exp_a',
          employeeId: 'emp_exp_a',
          employeeName: 'موظف org_exp_a',
          date: '2026-11-20',
          period: 'morning',
          cashSales: 300,
          cardSales: 200,
          totalSales: 500,
          expenses: 50,
          remainingInBox: 250,
          netPeriod: 450,
          status: 'pending_review',
          createdAt: nowIso,
          updatedAt: nowIso,
        })
      );
      await assertSucceeds(
        mgrExpADb.doc('purchases/pur_exempt_01').set({
          id: 'pur_exempt_01',
          orgId: 'org_exp_a',
          branchId: 'br_exp_a',
          branchName: 'فرع org_exp_a',
          supplierId: 'sup_org_exp_a',
          supplierName: 'مورد معتمد',
          invoiceNumber: 'INV-EX-001',
          date: '2026-11-20',
          amount: 100,
          subtotalAmount: 100,
          vatRate: 15,
          vatAmount: 15,
          totalAmount: 115,
          paymentMethod: 'cash',
          items: [
            { id: 'item_0', name: 'مواد تموينية', quantity: 2, unitPrice: 50, total: 100 },
          ],
          createdBy: 'mgr_exp_a',
          createdByName: 'مدير org_exp_a',
          createdByRole: 'manager',
          createdAt: nowIso,
          updatedAt: nowIso,
        })
      );
    });

    // 6. Changing billingExemptLastAuditLogId or reason without a real transition (true -> true) is genuinely REJECTED
    await runCase('6. Re-granting or changing billingExemptLastAuditLogId without a real state transition is genuinely rejected', async () => {
      const noopBatch = saDb.batch();
      noopBatch.update(saDb.doc('organizations/org_exp_a'), {
        billingExemptReason: 'تعديل نص السبب دون انتقال حقيقي',
        billingExemptLastAuditLogId: 'plog_noop_01',
        updatedAt: nowIso,
      });
      noopBatch.set(saDb.doc('platformAuditLogs/plog_noop_01'), buildAuditDoc('plog_noop_01', 'org_exp_a', 'ORG_BILLING_EXEMPTION_GRANTED'));
      await assertGenuineFails(noopBatch.commit(), 'no-op transition');
    });

    // 7. Separate silent ownerId change AND separate silent ownerEmail change on an exempt org are BOTH genuinely REJECTED; atomic ownerEmail change WITH revocation SUCCEEDS
    await runCase('7. Silent ownerId change and silent ownerEmail change on an exempt org are independently rejected; atomic ownerEmail change with revocation succeeds and disables exemption', async () => {
      // 7a. Silent ownerId change alone -> genuinely REJECTED
      await assertGenuineFails(
        saDb.doc('organizations/org_exp_a').update({
          ownerId: 'uid_different_owner',
          updatedAt: nowIso,
        }),
        '7a silent ownerId change'
      );

      // 7b. Silent ownerEmail change alone -> genuinely REJECTED
      await assertGenuineFails(
        saDb.doc('organizations/org_exp_a').update({
          ownerEmail: 'changed.silently@gmail.com',
          updatedAt: nowIso,
        }),
        '7b silent ownerEmail change'
      );

      // 7c. Non-owner profile update (e.g., org name) on exempt org STILL SUCCEEDS
      await assertSucceeds(
        saDb.doc('organizations/org_exp_a').update({
          name: 'مؤسسة الاختبار المنتهية أ (محدّثة)',
          updatedAt: nowIso,
        })
      );

      // 7d. Atomic ownerEmail change WITH coupled ORG_BILLING_EXEMPTION_REVOKED audit log on org_owner_change_g SUCCEEDS and blocks subsequent operational reads
      await assertSucceeds(mgrOwnerGDb.collection('branches').where('orgId', '==', 'org_owner_change_g').get());
      const autoRevokeLogId = 'plog_auto_revoke_g';
      const autoRevokeBatch = saDb.batch();
      autoRevokeBatch.update(saDb.doc('organizations/org_owner_change_g'), {
        ownerEmail: 'new.owner.g@example.com',
        billingExempt: false,
        billingExemptRevokedAt: tsNow,
        billingExemptRevokedBy: 'amoal2030@gmail.com',
        billingExemptRevokeReason: 'إلغاء تلقائي للإعفاء الدائم بسبب تغيير بريد المالك',
        billingExemptLastAuditLogId: autoRevokeLogId,
        updatedAt: nowIso,
      });
      autoRevokeBatch.set(
        saDb.doc(`platformAuditLogs/${autoRevokeLogId}`),
        buildAuditDoc(autoRevokeLogId, 'org_owner_change_g', 'ORG_BILLING_EXEMPTION_REVOKED')
      );
      await assertSucceeds(autoRevokeBatch.commit());
      await assertGenuineFails(
        mgrOwnerGDb.collection('branches').where('orgId', '==', 'org_owner_change_g').get(),
        '7d post-auto-revoke read blocked'
      );
    });

    // 8. Owner mismatch in DB (ownerId-only AND ownerEmail-only separately) & manual suspension (`isActive: false`) STILL fail closed operationally
    await runCase('8. Separate ownerId-only mismatch, ownerEmail-only mismatch, and manually suspended exempt org all stay blocked operationally', async () => {
      await assertGenuineFails(mgrMismatchEmailDb.collection('branches').where('orgId', '==', 'org_mismatch_email').get(), 'ownerEmail-only mismatch');
      await assertGenuineFails(mgrMismatchUidDb.collection('branches').where('orgId', '==', 'org_mismatch_uid').get(), 'ownerId-only mismatch');
      await assertGenuineFails(mgrExemptSuspDb.collection('branches').where('orgId', '==', 'org_exempt_susp').get(), 'manually suspended exempt');
    });

    // 9. Super Admin creates future branch under exempt org with paymentStatus='exempt' & 0 SAR; Manager cannot
    await runCase('9. Super Admin can create future exempt branch (0 SAR), while org manager cannot create or alter branch billing', async () => {
      await assertSucceeds(
        saDb.doc('branches/br_exp_a_future').set({
          id: 'br_exp_a_future',
          orgId: 'org_exp_a',
          name: 'فرع مستقبلي معفى',
          code: 'BR02',
          isActive: true,
          lifecycleStatus: 'active',
          monthlyFeeSar: 0,
          paymentStatus: 'exempt',
          feeDueAt: null,
          paymentNote: 'معفى تلقائياً ضمن الإعفاء الدائم الشامل',
          createdAt: nowIso,
          updatedAt: nowIso,
        })
      );
      await assertGenuineFails(
        mgrExpADb.doc('branches/br_mgr_forged').set({
          id: 'br_mgr_forged',
          orgId: 'org_exp_a',
          name: 'فرع غير مصرح',
          isActive: true,
          monthlyFeeSar: 0,
          paymentStatus: 'exempt',
        }),
        'mgr create branch'
      );
      await assertGenuineFails(
        mgrExpADb.doc('branches/br_exp_a').update({
          paymentStatus: 'exempt',
          monthlyFeeSar: 0,
        }),
        'mgr update branch billing'
      );
    });

    // 10. Revocation of org_exp_a (expired historical sub) atomically restores expired block
    await runCase('10. Atomic revocation of org_exp_a restores expired-subscription enforcement immediately', async () => {
      const revokeLogId = 'plog_revoke_exp_a_01';
      const revokeBatch = saDb.batch();
      revokeBatch.update(saDb.doc('organizations/org_exp_a'), {
        billingExempt: false,
        billingExemptRevokedAt: tsNow,
        billingExemptRevokedBy: 'amoal2030@gmail.com',
        billingExemptRevokeReason: 'إلغاء الإعفاء للتحقق من العودة للوضع المنتهي',
        billingExemptLastAuditLogId: revokeLogId,
        updatedAt: nowIso,
      });
      revokeBatch.set(saDb.doc(`platformAuditLogs/${revokeLogId}`), buildAuditDoc(revokeLogId, 'org_exp_a', 'ORG_BILLING_EXEMPTION_REVOKED'));
      await assertSucceeds(revokeBatch.commit());

      // Now org_exp_a is blocked again because its historical subscription was expired
      await assertGenuineFails(mgrExpADb.collection('branches').where('orgId', '==', 'org_exp_a').get(), 'revoked expired blocked');
    });

    // 11. Grant then revoke on active-sub org_act_b AND legacy org_legacy_f restores natural allowed access
    await runCase('11. Grant then atomic revoke on active-sub org and legacy-no-sub org restores natural operational access', async () => {
      // Active-sub org B
      const gB = saDb.batch();
      gB.update(saDb.doc('organizations/org_act_b'), buildGrantFields('mgr_act_b', 'foadalkamel05@gmail.com', 'plog_grant_b'));
      gB.set(saDb.doc('platformAuditLogs/plog_grant_b'), buildAuditDoc('plog_grant_b', 'org_act_b', 'ORG_BILLING_EXEMPTION_GRANTED'));
      await assertSucceeds(gB.commit());

      const rB = saDb.batch();
      rB.update(saDb.doc('organizations/org_act_b'), {
        billingExempt: false,
        billingExemptRevokedAt: tsNow,
        billingExemptRevokedBy: 'amoal2030@gmail.com',
        billingExemptRevokeReason: 'إلغاء الإعفاء للتحقق من عودة الاشتراك الساري',
        billingExemptLastAuditLogId: 'plog_revoke_b',
        updatedAt: nowIso,
      });
      rB.set(saDb.doc('platformAuditLogs/plog_revoke_b'), buildAuditDoc('plog_revoke_b', 'org_act_b', 'ORG_BILLING_EXEMPTION_REVOKED'));
      await assertSucceeds(rB.commit());
      await assertSucceeds(mgrActBDb.collection('branches').where('orgId', '==', 'org_act_b').get());

      // Legacy-no-sub org F
      const gF = saDb.batch();
      gF.update(saDb.doc('organizations/org_legacy_f'), buildGrantFields('mgr_legacy_f', 'legacy.f@example.com', 'plog_grant_f'));
      gF.set(saDb.doc('platformAuditLogs/plog_grant_f'), buildAuditDoc('plog_grant_f', 'org_legacy_f', 'ORG_BILLING_EXEMPTION_GRANTED'));
      await assertSucceeds(gF.commit());

      const rF = saDb.batch();
      rF.update(saDb.doc('organizations/org_legacy_f'), {
        billingExempt: false,
        billingExemptRevokedAt: tsNow,
        billingExemptRevokedBy: 'amoal2030@gmail.com',
        billingExemptRevokeReason: 'إلغاء الإعفاء للتحقق من عودة المؤسسة القديمة لوضعها',
        billingExemptLastAuditLogId: 'plog_revoke_f',
        updatedAt: nowIso,
      });
      rF.set(saDb.doc('platformAuditLogs/plog_revoke_f'), buildAuditDoc('plog_revoke_f', 'org_legacy_f', 'ORG_BILLING_EXEMPTION_REVOKED'));
      await assertSucceeds(rF.commit());
      await assertSucceeds(mgrLegacyFDb.collection('branches').where('orgId', '==', 'org_legacy_f').get());
    });
  } finally {
    await testEnv.cleanup();
  }

  const passedCount = outcomes.filter((o) => o.passed).length;
  const failedCount = outcomes.length - passedCount;

  console.log('\n========================================================================');
  console.log(`   BILLING EXEMPTION EMULATOR RULES SUMMARY: ${passedCount}/${outcomes.length} PASSED, ${failedCount} FAILED`);
  console.log('========================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runBillingExemptionEmulatorTests().catch((err) => {
  console.error('BILLING EXEMPTION EMULATOR RULES RUNNER FAILURE:', err);
  process.exit(1);
});
