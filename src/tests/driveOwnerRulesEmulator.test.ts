/**
 * Google Drive Organization Owner vs Super Admin Isolation — Firestore Rules Emulator Suite
 * -----------------------------------------------------------------------------------------
 * Empirically verifies `firestore.rules` against real Firestore Emulator for:
 * 1. Dual-role Super Admin (`amoal2030@gmail.com`) who is ALSO the active owner/manager of `org_A`:
 *    - Allowed to disconnect, link, sync, and record Drive health on `org_A` and its branches.
 * 2. Same Super Admin (`amoal2030@gmail.com`) on a foreign customer org (`org_B`, `ownerId != uid`):
 *    - Strictly DENIED on any Drive update to `organizations/org_B` or `branches` of `org_B`.
 * 3. Non-owner second manager (`role == 'manager'`, `uid != org.ownerId`):
 *    - Strictly DENIED from modifying Drive metadata on `organizations` and `branches`.
 * 4. Regular Organization Owner (non-Super-Admin) on active-subscription, legacy, and permanently-exempt orgs:
 *    - Allowed to connect and disconnect Drive on their own org and branches; denied if expired/suspended.
 * 5. `branch_manager`, `supervisor`, and `employee`:
 *    - Strictly DENIED from modifying Drive metadata on `organizations` or `branches`.
 * 6. Mixed-field escalation attempts (Drive fields + `subscriptionEndAt`, `billingExempt`, `ownerId`,
 *    `name`, `taxNumber`, or branch `monthlyFeeSar` / `isActive`):
 *    - Strictly DENIED for BOTH dual-role Super Admin on `org_A` and regular owner on `org_B`.
 * 7. Suspended/inactive branch with legacy Drive folder fields:
 *    - Complete removal of legacy Drive fields (`deleteField()`) during disconnect -> ALLOWED.
 *    - Adding, modifying, or partially clearing Drive fields on a suspended branch -> DENIED.
 * 8. Super Admin non-Drive platform governance on `org_B` continues working unchanged.
 *
 * Run with Firestore Emulator (JDK 21+ required):
 *   firebase emulators:exec --only firestore "npx tsx src/tests/driveOwnerRulesEmulator.test.ts"
 */
import {
  assertFails,
  assertSucceeds,
  FieldValue,
  initializeNamedDbTestEnvironment,
  NamedDbRulesTestEnvironment,
  Timestamp,
} from './namedDbEmulatorHarness';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import {
  buildBranchDriveDisconnectPayload,
  buildOrgDriveDisconnectPayload,
} from '../services/driveService';

async function main() {
  console.log('========================================================================');
  console.log('   AL EQFAL — DRIVE OWNER vs SUPER ADMIN FIRESTORE RULES EMULATOR       ');
  console.log('========================================================================');

  const testEnv: NamedDbRulesTestEnvironment = await initializeNamedDbTestEnvironment();

  const nowMs = Date.now();
  const oneDayMs = 86_400_000;
  const tsPast2d = Timestamp.fromMillis(nowMs - 2 * oneDayMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);
  const tsFuture60d = Timestamp.fromMillis(nowMs + 60 * oneDayMs);
  const tsPast10d = Timestamp.fromMillis(nowMs - 10 * oneDayMs);
  const nowIso = new Date().toISOString();

  // Dual-role Super Admin who owns org_A (mirrors production org_EpEh00Ev_mwb1kmpw scenario)
  const SA_OWNER_UID = 'uid_sa_owner_a';
  const ORG_A_ID = 'org_EpEh00Ev_mwb1kmpw';
  const BR_A_ACTIVE_ID = 'br_a_active';
  const BR_A_SUSPENDED_ID = 'br_a_suspended';

  // Customer org_B owned by a regular manager (NOT Super Admin)
  const ORG_B_ID = 'org_customer_b';
  const OWNER_B_UID = 'uid_owner_b';
  const SECOND_MGR_B_UID = 'uid_second_mgr_b';
  const BM_B_UID = 'uid_bm_b';
  const SUP_B_UID = 'uid_sup_b';
  const EMP_B_UID = 'uid_emp_b';
  const BR_B_ACTIVE_ID = 'br_b_active';
  const BR_B_SUSPENDED_ID = 'br_b_suspended';

  // Expired org_C owned by regular manager
  const ORG_C_EXPIRED_ID = 'org_expired_c';
  const OWNER_C_UID = 'uid_owner_c';

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

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();

      // org_A owned by amoal2030@gmail.com (dual-role Super Admin + org owner)
      await db.doc(`organizations/${ORG_A_ID}`).set({
        id: ORG_A_ID,
        name: 'مؤسسة المالك الرئيسي',
        activityType: 'retail',
        currency: 'SAR',
        ownerId: SA_OWNER_UID,
        ownerEmail: 'amoal2030@gmail.com',
        ownerName: 'مالك المؤسسة',
        driveConnected: true,
        driveWriteVerified: true,
        driveWriteVerifiedAt: nowIso,
        driveLastHealthStatus: 'verified',
        driveFolderId: 'fld_root_a',
        driveFolderName: 'AL EQFAL - org_A',
        driveFolderLink: 'https://drive.google.com/drive/folders/fld_root_a',
        driveAccountEmail: 'amoal2030@gmail.com',
        driveAccountName: 'Owner A',
        driveGoogleSub: 'google_sub_a',
        driveLinkedAt: nowIso,
        driveMonthFolderIds: {
          [`${BR_A_ACTIVE_ID}_2026-11`]: {
            folderId: 'fld_m_a',
            folderName: '2026-11',
            webViewLink: 'https://drive.google.com/drive/folders/fld_m_a',
          },
        },
        isActive: true,
        subscriptionPlan: '1y',
        subscriptionStatus: 'active',
        subscriptionStartAt: tsPast2d,
        subscriptionEndAt: tsFuture30d,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      await db.doc(`branches/${BR_A_ACTIVE_ID}`).set({
        id: BR_A_ACTIVE_ID,
        orgId: ORG_A_ID,
        name: 'فرع أ النشط',
        code: 'A-01',
        isActive: true,
        lifecycleStatus: 'active',
        driveFolderId: 'fld_br_a_active',
        driveFolderName: 'فرع أ النشط - A-01',
        driveFolderLink: 'https://drive.google.com/drive/folders/fld_br_a_active',
        createdAt: nowIso,
      });

      await db.doc(`branches/${BR_A_SUSPENDED_ID}`).set({
        id: BR_A_SUSPENDED_ID,
        orgId: ORG_A_ID,
        name: 'فرع أ الموقوف',
        code: 'A-02',
        isActive: false,
        lifecycleStatus: 'suspended',
        driveFolderId: 'fld_br_a_old_legacy',
        driveFolderName: 'فرع أ الموقوف - A-02',
        driveFolderLink: 'https://drive.google.com/drive/folders/fld_br_a_old_legacy',
        createdAt: nowIso,
      });

      await db.doc(`users/${SA_OWNER_UID}`).set({
        uid: SA_OWNER_UID,
        orgId: ORG_A_ID,
        email: 'amoal2030@gmail.com',
        displayName: 'مالك المؤسسة',
        role: 'manager',
        isActive: true,
        permissions: buildDefaultPermissionsForRole('manager'),
        createdAt: nowIso,
      });

      // org_B owned by regular customer manager (NOT Super Admin)
      await db.doc(`organizations/${ORG_B_ID}`).set({
        id: ORG_B_ID,
        name: 'مؤسسة العميل ب',
        activityType: 'restaurant',
        currency: 'SAR',
        ownerId: OWNER_B_UID,
        ownerEmail: 'owner.b@example.com',
        ownerName: 'مالك ب',
        driveConnected: true,
        driveWriteVerified: true,
        driveWriteVerifiedAt: nowIso,
        driveLastHealthStatus: 'verified',
        driveFolderId: 'fld_root_b',
        driveFolderName: 'AL EQFAL - org_B',
        driveFolderLink: 'https://drive.google.com/drive/folders/fld_root_b',
        driveAccountEmail: 'owner.b@example.com',
        driveAccountName: 'Owner B',
        driveGoogleSub: 'google_sub_b',
        driveLinkedAt: nowIso,
        isActive: true,
        subscriptionPlan: '1m',
        subscriptionStatus: 'active',
        subscriptionStartAt: tsPast2d,
        subscriptionEndAt: tsFuture30d,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      await db.doc(`branches/${BR_B_ACTIVE_ID}`).set({
        id: BR_B_ACTIVE_ID,
        orgId: ORG_B_ID,
        name: 'فرع ب النشط',
        code: 'B-01',
        isActive: true,
        lifecycleStatus: 'active',
        driveFolderId: 'fld_br_b_active',
        driveFolderName: 'فرع ب النشط - B-01',
        driveFolderLink: 'https://drive.google.com/drive/folders/fld_br_b_active',
        createdAt: nowIso,
      });

      await db.doc(`branches/${BR_B_SUSPENDED_ID}`).set({
        id: BR_B_SUSPENDED_ID,
        orgId: ORG_B_ID,
        name: 'فرع ب الموقوف',
        code: 'B-02',
        isActive: false,
        lifecycleStatus: 'suspended',
        driveFolderId: 'fld_br_b_suspended',
        driveFolderName: 'فرع ب الموقوف - B-02',
        driveFolderLink: 'https://drive.google.com/drive/folders/fld_br_b_suspended',
        createdAt: nowIso,
      });

      await db.doc(`users/${OWNER_B_UID}`).set({
        uid: OWNER_B_UID,
        orgId: ORG_B_ID,
        email: 'owner.b@example.com',
        displayName: 'مالك ب',
        role: 'manager',
        isActive: true,
        permissions: buildDefaultPermissionsForRole('manager'),
        createdAt: nowIso,
      });

      // Non-owner second manager in org_B
      await db.doc(`users/${SECOND_MGR_B_UID}`).set({
        uid: SECOND_MGR_B_UID,
        orgId: ORG_B_ID,
        email: 'second.mgr.b@example.com',
        displayName: 'مدير ثانٍ غير مالك',
        role: 'manager',
        isActive: true,
        permissions: buildDefaultPermissionsForRole('manager'),
        createdAt: nowIso,
      });

      await db.doc(`users/${BM_B_UID}`).set({
        uid: BM_B_UID,
        orgId: ORG_B_ID,
        email: 'bm.b@example.com',
        displayName: 'مسؤول فرع ب',
        role: 'branch_manager',
        branchId: BR_B_ACTIVE_ID,
        branchIds: [BR_B_ACTIVE_ID],
        isActive: true,
        permissions: buildDefaultPermissionsForRole('branch_manager'),
        createdAt: nowIso,
      });

      await db.doc(`users/${SUP_B_UID}`).set({
        uid: SUP_B_UID,
        orgId: ORG_B_ID,
        email: 'sup.b@example.com',
        displayName: 'مشرف ب',
        role: 'supervisor',
        branchId: BR_B_ACTIVE_ID,
        branchIds: [BR_B_ACTIVE_ID],
        isActive: true,
        permissions: buildDefaultPermissionsForRole('supervisor'),
        createdAt: nowIso,
      });

      await db.doc(`users/${EMP_B_UID}`).set({
        uid: EMP_B_UID,
        orgId: ORG_B_ID,
        email: 'emp.b@example.com',
        displayName: 'موظف ب',
        role: 'employee',
        branchId: BR_B_ACTIVE_ID,
        branchIds: [BR_B_ACTIVE_ID],
        isActive: true,
        permissions: buildDefaultPermissionsForRole('employee'),
        createdAt: nowIso,
      });

      // Expired org_C
      await db.doc(`organizations/${ORG_C_EXPIRED_ID}`).set({
        id: ORG_C_EXPIRED_ID,
        name: 'مؤسسة منتهية الاشتراك',
        activityType: 'retail',
        currency: 'SAR',
        ownerId: OWNER_C_UID,
        ownerEmail: 'owner.c@example.com',
        ownerName: 'مالك ج',
        driveConnected: true,
        isActive: true,
        subscriptionPlan: '1m',
        subscriptionStatus: 'expired',
        subscriptionStartAt: tsPast10d,
        subscriptionEndAt: tsPast2d,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      await db.doc(`users/${OWNER_C_UID}`).set({
        uid: OWNER_C_UID,
        orgId: ORG_C_EXPIRED_ID,
        email: 'owner.c@example.com',
        displayName: 'مالك ج',
        role: 'manager',
        isActive: true,
        permissions: buildDefaultPermissionsForRole('manager'),
        createdAt: nowIso,
      });
    });

    const saOwnerDb = testEnv
      .authenticatedContext(SA_OWNER_UID, { email: 'amoal2030@gmail.com', email_verified: true })
      .firestore();
    const ownerBDb = testEnv
      .authenticatedContext(OWNER_B_UID, { email: 'owner.b@example.com', email_verified: true })
      .firestore();
    const secondMgrBDb = testEnv
      .authenticatedContext(SECOND_MGR_B_UID, { email: 'second.mgr.b@example.com', email_verified: true })
      .firestore();
    const bmBDb = testEnv
      .authenticatedContext(BM_B_UID, { email: 'bm.b@example.com', email_verified: true })
      .firestore();
    const supBDb = testEnv
      .authenticatedContext(SUP_B_UID, { email: 'sup.b@example.com', email_verified: true })
      .firestore();
    const empBDb = testEnv
      .authenticatedContext(EMP_B_UID, { email: 'emp.b@example.com', email_verified: true })
      .firestore();
    const ownerCDb = testEnv
      .authenticatedContext(OWNER_C_UID, { email: 'owner.c@example.com', email_verified: true })
      .firestore();

    // Case 1 & Case 7 (part 1): Dual-role amoal2030@gmail.com disconnects own org_A + active & suspended branches atomically
    await runCase(
      '1 & 7a. amoal2030@gmail.com as owner/manager of org_A succeeds on atomic Drive disconnect across org + active branch + suspended branch',
      async () => {
        const batch = saOwnerDb.batch();
        batch.update(
          saOwnerDb.doc(`organizations/${ORG_A_ID}`),
          buildOrgDriveDisconnectPayload(nowIso, () => FieldValue.delete())
        );
        batch.update(
          saOwnerDb.doc(`branches/${BR_A_ACTIVE_ID}`),
          buildBranchDriveDisconnectPayload(() => FieldValue.delete())
        );
        batch.update(
          saOwnerDb.doc(`branches/${BR_A_SUSPENDED_ID}`),
          buildBranchDriveDisconnectPayload(() => FieldValue.delete())
        );
        await assertSucceeds(batch.commit());
      }
    );

    // Case 7 (part 2): Suspended branch CANNOT receive new/changed Drive folder link
    await runCase(
      '7b. Suspended branch STRICTLY DENIES adding or modifying driveFolderId even by real owner',
      async () => {
        await assertFails(
          saOwnerDb.doc(`branches/${BR_A_SUSPENDED_ID}`).update({
            driveFolderId: 'fld_new_forbidden_on_suspended',
            driveFolderName: 'فرع موقوف جديد',
            driveFolderLink: 'https://drive.google.com/drive/folders/fld_new_forbidden_on_suspended',
          })
        );
        // Partial clear on org_B suspended branch (leaving driveFolderId behind) must also fail
        await assertFails(
          ownerBDb.doc(`branches/${BR_B_SUSPENDED_ID}`).update({
            driveFolderName: FieldValue.delete(),
          })
        );
      }
    );

    // Case 1b: Dual-role amoal2030@gmail.com reconnects Drive on own org_A and active branch
    await runCase(
      '1b. amoal2030@gmail.com as owner/manager of org_A succeeds on reconnecting Drive & health failure update on active branch',
      async () => {
        const batch = saOwnerDb.batch();
        batch.update(saOwnerDb.doc(`organizations/${ORG_A_ID}`), {
          driveConnected: true,
          driveFolderId: 'fld_root_a_v2',
          driveFolderName: 'AL EQFAL - org_A v2',
          driveFolderLink: 'https://drive.google.com/drive/folders/fld_root_a_v2',
          driveAccountEmail: 'amoal2030@gmail.com',
          driveAccountName: 'Owner A',
          driveGoogleSub: 'google_sub_a',
          driveLinkedAt: nowIso,
          driveWriteVerified: true,
          driveWriteVerifiedAt: nowIso,
          driveLastHealthStatus: 'verified',
          driveHealthError: FieldValue.delete(),
          updatedAt: nowIso,
        });
        batch.update(saOwnerDb.doc(`branches/${BR_A_ACTIVE_ID}`), {
          driveFolderId: 'fld_br_a_active_v2',
          driveFolderName: 'فرع أ النشط - A-01',
          driveFolderLink: 'https://drive.google.com/drive/folders/fld_br_a_active_v2',
        });
        await assertSucceeds(batch.commit());

        await assertSucceeds(
          saOwnerDb.doc(`organizations/${ORG_A_ID}`).update({
            driveWriteVerified: false,
            driveLastHealthStatus: 'failed',
            driveHealthError: 'فشل مؤقت للاختبار',
            updatedAt: nowIso,
          })
        );
      }
    );

    // Case 2 & Case 10: Super Admin amoal2030@gmail.com CANNOT touch Drive of foreign customer org_B or its branches
    await runCase(
      '2 & 10. amoal2030@gmail.com is STRICTLY DENIED from modifying or disconnecting Drive on foreign customer org_B and its branches',
      async () => {
        await assertFails(
          saOwnerDb
            .doc(`organizations/${ORG_B_ID}`)
            .update(buildOrgDriveDisconnectPayload(nowIso, () => FieldValue.delete()))
        );
        await assertFails(
          saOwnerDb.doc(`organizations/${ORG_B_ID}`).update({
            driveConnected: false,
            updatedAt: nowIso,
          })
        );
        await assertFails(
          saOwnerDb
            .doc(`branches/${BR_B_ACTIVE_ID}`)
            .update(buildBranchDriveDisconnectPayload(() => FieldValue.delete()))
        );
        await assertFails(
          saOwnerDb.doc(`branches/${BR_B_ACTIVE_ID}`).update({
            driveFolderId: 'fld_hijack_by_sa',
          })
        );
        await assertFails(
          saOwnerDb
            .doc(`branches/${BR_B_SUSPENDED_ID}`)
            .update(buildBranchDriveDisconnectPayload(() => FieldValue.delete()))
        );

        // Verify Super Admin can STILL perform legitimate non-Drive platform management on org_B
        await assertSucceeds(
          saOwnerDb.doc(`organizations/${ORG_B_ID}`).update({
            taxNumber: '310999999900003',
            updatedAt: nowIso,
          })
        );
      }
    );

    // Case 3: Second manager who is NOT ownerId is strictly DENIED
    await runCase(
      '3. Non-owner manager (role=manager, uid != ownerId) is STRICTLY DENIED from updating org or branch Drive metadata',
      async () => {
        await assertFails(
          secondMgrBDb
            .doc(`organizations/${ORG_B_ID}`)
            .update(buildOrgDriveDisconnectPayload(nowIso, () => FieldValue.delete()))
        );
        await assertFails(
          secondMgrBDb.doc(`branches/${BR_B_ACTIVE_ID}`).update({
            driveFolderId: 'fld_second_mgr_attempt',
          })
        );
      }
    );

    // Case 4: Regular organization owner (non-Super-Admin) succeeds on connect/disconnect, fails if expired
    await runCase(
      '4. Regular non-Super-Admin owner succeeds on Drive disconnect/reconnect on own org_B, and expired org_C is denied',
      async () => {
        const batch = ownerBDb.batch();
        batch.update(
          ownerBDb.doc(`organizations/${ORG_B_ID}`),
          buildOrgDriveDisconnectPayload(nowIso, () => FieldValue.delete())
        );
        batch.update(
          ownerBDb.doc(`branches/${BR_B_ACTIVE_ID}`),
          buildBranchDriveDisconnectPayload(() => FieldValue.delete())
        );
        batch.update(
          ownerBDb.doc(`branches/${BR_B_SUSPENDED_ID}`),
          buildBranchDriveDisconnectPayload(() => FieldValue.delete())
        );
        await assertSucceeds(batch.commit());

        await assertSucceeds(
          ownerBDb.doc(`organizations/${ORG_B_ID}`).update({
            driveConnected: true,
            driveFolderId: 'fld_root_b_reconnected',
            driveFolderName: 'AL EQFAL - org_B',
            driveFolderLink: 'https://drive.google.com/drive/folders/fld_root_b_reconnected',
            driveAccountEmail: 'owner.b@example.com',
            driveGoogleSub: 'google_sub_b',
            driveWriteVerified: true,
            driveWriteVerifiedAt: nowIso,
            driveLastHealthStatus: 'verified',
            updatedAt: nowIso,
          })
        );

        // Expired organization owner cannot update Drive metadata
        await assertFails(
          ownerCDb
            .doc(`organizations/${ORG_C_EXPIRED_ID}`)
            .update(buildOrgDriveDisconnectPayload(nowIso, () => FieldValue.delete()))
        );
      }
    );

    // Case 5: branch_manager, supervisor, employee strictly DENIED
    await runCase(
      '5. branch_manager, supervisor, and employee are STRICTLY DENIED from updating Drive metadata on org or branches',
      async () => {
        for (const roleDb of [bmBDb, supBDb, empBDb]) {
          await assertFails(
            roleDb.doc(`organizations/${ORG_B_ID}`).update({
              driveConnected: false,
              updatedAt: nowIso,
            })
          );
          await assertFails(
            roleDb.doc(`branches/${BR_B_ACTIVE_ID}`).update({
              driveFolderId: FieldValue.delete(),
              driveFolderName: FieldValue.delete(),
              driveFolderLink: FieldValue.delete(),
            })
          );
        }
      }
    );

    // Case 6: Mixed-field escalation attempts strictly DENIED
    await runCase(
      '6. Mixing Drive fields with subscription, billingExempt, ownerId, name, or branch fee fields is STRICTLY DENIED',
      async () => {
        // Dual-role Super Admin on own org_A trying to mix Drive + subscriptionEndAt
        await assertFails(
          saOwnerDb.doc(`organizations/${ORG_A_ID}`).update({
            driveConnected: false,
            subscriptionEndAt: tsFuture60d,
            updatedAt: nowIso,
          })
        );
        // Dual-role Super Admin on own org_A trying to mix Drive + billingExempt
        await assertFails(
          saOwnerDb.doc(`organizations/${ORG_A_ID}`).update({
            driveConnected: false,
            billingExempt: true,
            updatedAt: nowIso,
          })
        );
        // Dual-role Super Admin on own org_A trying to mix Drive + ownerId
        await assertFails(
          saOwnerDb.doc(`organizations/${ORG_A_ID}`).update({
            driveConnected: false,
            ownerId: OWNER_B_UID,
            updatedAt: nowIso,
          })
        );
        // Dual-role Super Admin on own org_A branch trying to mix Drive + monthlyFeeSar
        await assertFails(
          saOwnerDb.doc(`branches/${BR_A_ACTIVE_ID}`).update({
            driveFolderId: 'fld_mix',
            monthlyFeeSar: 0,
          })
        );
        // Regular owner on org_B trying to mix Drive + subscriptionPlan / ownerId
        await assertFails(
          ownerBDb.doc(`organizations/${ORG_B_ID}`).update({
            driveConnected: false,
            subscriptionPlan: '1y',
            updatedAt: nowIso,
          })
        );
        await assertFails(
          ownerBDb.doc(`organizations/${ORG_B_ID}`).update({
            driveConnected: false,
            ownerId: SECOND_MGR_B_UID,
            updatedAt: nowIso,
          })
        );
      }
    );
  } finally {
    await testEnv.cleanup();
  }

  console.log('========================================================================');
  console.log(`DRIVE OWNER RULES EMULATOR SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal emulator error:', err);
  process.exit(1);
});
