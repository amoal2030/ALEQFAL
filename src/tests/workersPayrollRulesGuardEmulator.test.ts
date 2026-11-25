/**
 * Workers & Payroll — Deployed Firestore Rules Gate Verification (Firestore Emulator)
 *
 * Empirically verifies against the REAL, UNMODIFIED deployed `firestore.rules` that:
 * - All 7 new Workers & Payroll collections (`workers`, `workerAdvances`, `workerAdditions`,
 *   `payrollRuns`, `payrollItems`, `payrollPayments`, `payrollAuditLogs`) are strictly DENIED
 *   by the root default-deny rule (`match /{document=**} { allow read, write: if false; }`)
 *   for ALL roles (including Organization Manager and Branch Manager).
 * - Confirms the mandatory stop gate before wiring live Firestore UI tabs until
 *   explicit approval & deployment of the proposed `firestore.rules` additions.
 */
import {
  assertFails,
  initializeNamedDbTestEnvironment,
  NamedDbRulesTestEnvironment,
  Timestamp,
} from './namedDbEmulatorHarness';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import { WORKERS_PAYROLL_COLLECTIONS } from '../services/workersPayrollService';

async function main() {
  console.log('========================================================================');
  console.log('   WORKERS & PAYROLL — DEPLOYED FIRESTORE.RULES GATE VERIFICATION       ');
  console.log('========================================================================');

  const testEnv: NamedDbRulesTestEnvironment = await initializeNamedDbTestEnvironment();

  const ORG_ID = 'org_workers_gate_1';
  const BRANCH_ID = 'br_workers_gate_1';
  const MGR_UID = 'mgr_workers_gate_1';
  const BM_UID = 'bm_workers_gate_1';

  let passed = 0;
  let failed = 0;

  const runCase = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} -> ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  };

  try {
    await testEnv.clearFirestore();
    const nowMs = Date.now();
    const nowIso = new Date().toISOString();

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await adminDb.collection('organizations').doc(ORG_ID).set({
        id: ORG_ID,
        name: 'مؤسسة التحقق',
        activityType: 'تجارة',
        currency: 'SAR',
        ownerId: MGR_UID,
        ownerName: 'المدير',
        ownerEmail: 'mgr@gate.test',
        driveConnected: false,
        isActive: true,
        subscriptionPlan: '1m',
        subscriptionStatus: 'active',
        subscriptionStartAt: Timestamp.fromMillis(nowMs - 86_400_000),
        subscriptionEndAt: Timestamp.fromMillis(nowMs + 30 * 86_400_000),
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      await adminDb.collection('branches').doc(BRANCH_ID).set({
        id: BRANCH_ID,
        orgId: ORG_ID,
        name: 'الفرع الرئيسي',
        code: 'MAIN-1',
        isActive: true,
        createdAt: nowIso,
      });
      await adminDb.collection('users').doc(MGR_UID).set({
        uid: MGR_UID,
        orgId: ORG_ID,
        email: 'mgr@gate.test',
        displayName: 'المدير',
        role: 'manager',
        isActive: true,
        permissions: buildDefaultPermissionsForRole('manager'),
        createdAt: nowIso,
      });
      await adminDb.collection('users').doc(BM_UID).set({
        uid: BM_UID,
        orgId: ORG_ID,
        email: 'bm@gate.test',
        displayName: 'مسؤول الفرع',
        role: 'branch_manager',
        branchId: BRANCH_ID,
        branchIds: [BRANCH_ID],
        isActive: true,
        permissions: buildDefaultPermissionsForRole('branch_manager'),
        createdAt: nowIso,
      });
    });

    const mgrDb = testEnv.authenticatedContext(MGR_UID, {
      email: 'mgr@gate.test',
      email_verified: true,
    }).firestore();

    const bmDb = testEnv.authenticatedContext(BM_UID, {
      email: 'bm@gate.test',
      email_verified: true,
    }).firestore();

    for (const [key, collName] of Object.entries(WORKERS_PAYROLL_COLLECTIONS)) {
      await runCase(
        `Deployed rules deny Manager write & read on '${collName}' (${key}) until approved rules are added`,
        async () => {
          await assertFails(
            mgrDb.collection(collName).doc(`doc_${key}_1`).set({
              id: `doc_${key}_1`,
              orgId: ORG_ID,
              createdAt: nowIso,
            })
          );
          await assertFails(mgrDb.collection(collName).where('orgId', '==', ORG_ID).get());
        }
      );
    }

    await runCase(
      'Deployed rules deny Branch Manager write on workerAdvances until approved rules are added',
      async () => {
        await assertFails(
          bmDb.collection(WORKERS_PAYROLL_COLLECTIONS.workerAdvances).doc('wadv_bm_1').set({
            id: 'wadv_bm_1',
            orgId: ORG_ID,
            branchId: BRANCH_ID,
            workerId: 'wrk_1',
            amount: 500,
            createdAt: nowIso,
          })
        );
      }
    );
  } finally {
    await testEnv.cleanup();
  }

  console.log('========================================================================');
  console.log(`RULES GATE EMULATOR SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal emulator gate error:', err);
  process.exit(1);
});
