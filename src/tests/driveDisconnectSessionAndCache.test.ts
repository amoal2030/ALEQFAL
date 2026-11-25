/**
 * Google Drive Disconnect — Session, Unified Folder Cache, Branch Handling & Static Rules Guard Tests
 * ---------------------------------------------------------------------------------------------------
 * Runs purely in Node/TS (`npx tsx src/tests/driveDisconnectSessionAndCache.test.ts`) with ZERO
 * production Firebase or Google Drive calls.
 *
 * Covers:
 * - Case 8: Failed `batch.commit()` MUST preserve in-memory Drive OAuth session AND unified Drive folder cache.
 * - Case 9: Successful `batch.commit()` MUST clear Drive OAuth session AND unified Drive folder cache
 *           strictly AFTER commit resolves, while preserving other tenants' session/cache.
 * - Case 7 (client-side): Active vs suspended branch selection for disconnect vs connect/sync.
 * - Payload field parity: Exact 14-key org payload and 3-key branch payload matching `firestore.rules`.
 * - Static `firestore.rules` invariants:
 *   - `canSuperAdminUpdateOrg` has zero `drive*` fields.
 *   - `canSuperAdminUpdateBranch` has zero `driveFolderId/Name/Link` fields.
 *   - `canOrgOwnerUpdateDriveMetadata` & `canOrgOwnerSyncBranchDriveFolder` enforce strict ownerId + active manager.
 *   - All 7 Workers & Payroll collections remain completely untouched (default-deny).
 */
import * as fs from 'node:fs';
import assert from 'node:assert/strict';
import type { Branch, Organization } from '../types';
import {
  buildBranchDriveDisconnectPayload,
  buildOrgDriveDisconnectPayload,
  clearDriveSession,
  executeOrgDriveDisconnect,
  getActiveDriveSession,
  isBranchActiveForDriveLink,
  selectBranchesForDriveDisconnect,
} from '../services/driveService';
import {
  clearUnifiedDriveFolderCache,
  ensureUnifiedOrgRootFolder,
  getUnifiedDriveFolderCacheSize,
} from '../services/unifiedDriveService';

let passed = 0;
let failed = 0;

async function runCase(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} -> ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

const ORG_A: Organization = {
  id: 'org_EpEh00Ev_mwb1kmpw',
  name: 'مؤسسة الاختبار أ',
  activityType: 'retail',
  currency: 'SAR',
  ownerId: 'uid_owner_a',
  ownerEmail: 'amoal2030@gmail.com',
  ownerName: 'مالك أ',
  driveConnected: true,
  driveFolderId: 'fld_root_a',
  driveFolderName: 'AL EQFAL - مؤسسة الاختبار أ - org_EpEh00Ev_mwb1kmpw',
  driveFolderLink: 'https://drive.google.com/drive/folders/fld_root_a',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ORG_B: Organization = {
  id: 'org_customer_b',
  name: 'مؤسسة العميل ب',
  activityType: 'restaurant',
  currency: 'SAR',
  ownerId: 'uid_owner_b',
  ownerEmail: 'owner.b@example.com',
  ownerName: 'مالك ب',
  driveConnected: true,
  driveFolderId: 'fld_root_b',
  driveFolderName: 'AL EQFAL - مؤسسة العميل ب - org_customer_b',
  driveFolderLink: 'https://drive.google.com/drive/folders/fld_root_b',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createMockFetchForRootFolder(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/fld_root_a')) {
      return new Response(
        JSON.stringify({
          id: 'fld_root_a',
          name: ORG_A.driveFolderName,
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
          webViewLink: ORG_A.driveFolderLink,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/fld_root_b')) {
      return new Response(
        JSON.stringify({
          id: 'fld_root_b',
          name: ORG_B.driveFolderName,
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
          webViewLink: ORG_B.driveFolderLink,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
  }) as typeof fetch;
}

async function seedUnifiedFolderCacheForOrgs(): Promise<void> {
  clearUnifiedDriveFolderCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetchForRootFolder();
  try {
    await ensureUnifiedOrgRootFolder({
      token: 'mock_token_a',
      org: ORG_A,
      actor: {
        uid: ORG_A.ownerId,
        orgId: ORG_A.id,
        role: 'manager',
        isActive: true,
        email: ORG_A.ownerEmail,
      },
    });
    await ensureUnifiedOrgRootFolder({
      token: 'mock_token_b',
      org: ORG_B,
      actor: {
        uid: ORG_B.ownerId,
        orgId: ORG_B.id,
        role: 'manager',
        isActive: true,
        email: ORG_B.ownerEmail,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  console.log('========================================================================');
  console.log('   AL EQFAL — DRIVE DISCONNECT SESSION, CACHE & RULES INVARIANT TESTS   ');
  console.log('========================================================================');

  await runCase(
    'Case 8: Failed batch.commit() MUST NOT clear Drive OAuth session or unified folder cache',
    async () => {
      await seedUnifiedFolderCacheForOrgs();
      assert.ok(getUnifiedDriveFolderCacheSize(ORG_A.id) > 0, 'Expected seeded cache for org_A');
      assert.ok(getUnifiedDriveFolderCacheSize(ORG_B.id) > 0, 'Expected seeded cache for org_B');

      const clearedSessions: string[] = [];
      let threw = false;

      try {
        await executeOrgDriveDisconnect({
          orgId: ORG_A.id,
          commitDisconnectBatch: async () => {
            throw new Error('Missing or insufficient permissions');
          },
          clearSession: (orgId) => {
            clearedSessions.push(orgId);
            clearDriveSession(orgId);
          },
          clearFolderCache: clearUnifiedDriveFolderCache,
        });
      } catch (err) {
        threw = true;
        assert.match((err as Error).message, /Missing or insufficient permissions/);
      }

      assert.equal(threw, true, 'executeOrgDriveDisconnect must rethrow commit failure');
      assert.equal(clearedSessions.length, 0, 'Session must NOT be cleared when commit fails');
      assert.ok(
        getUnifiedDriveFolderCacheSize(ORG_A.id) > 0,
        'Unified folder cache for org_A must remain intact when commit fails'
      );
      assert.ok(
        getUnifiedDriveFolderCacheSize(ORG_B.id) > 0,
        'Unified folder cache for org_B must remain intact'
      );
    }
  );

  await runCase(
    'Case 9: Successful batch.commit() clears Drive OAuth session & unified folder cache STRICTLY AFTER commit (tenant-isolated)',
    async () => {
      await seedUnifiedFolderCacheForOrgs();
      const timeline: string[] = [];

      await executeOrgDriveDisconnect({
        orgId: ORG_A.id,
        commitDisconnectBatch: async () => {
          timeline.push('commit_start');
          assert.ok(
            getUnifiedDriveFolderCacheSize(ORG_A.id) > 0,
            'Folder cache must still exist while commit is in flight'
          );
          await new Promise((r) => setTimeout(r, 5));
          timeline.push('commit_resolved');
        },
        clearSession: (orgId) => {
          timeline.push(`clear_session:${orgId}`);
          clearDriveSession(orgId);
        },
        clearFolderCache: (orgId) => {
          timeline.push(`clear_cache:${orgId}`);
          clearUnifiedDriveFolderCache(orgId);
        },
      });

      assert.deepEqual(timeline, [
        'commit_start',
        'commit_resolved',
        `clear_session:${ORG_A.id}`,
        `clear_cache:${ORG_A.id}`,
      ]);
      assert.equal(getActiveDriveSession(ORG_A.id), null, 'org_A session must be null after disconnect');
      assert.equal(
        getUnifiedDriveFolderCacheSize(ORG_A.id),
        0,
        'org_A unified folder cache must be empty after disconnect'
      );
      assert.ok(
        getUnifiedDriveFolderCacheSize(ORG_B.id) > 0,
        'org_B unified folder cache must remain untouched (tenant isolation)'
      );
    }
  );

  await runCase(
    'Case 7 (client): Disconnect selects both active & suspended branches with legacy Drive metadata; connect/sync excludes suspended branches',
    () => {
      const branches: Branch[] = [
        {
          id: 'br_a_active',
          orgId: ORG_A.id,
          name: 'نشط',
          code: 'A-01',
          isActive: true,
          lifecycleStatus: 'active',
          driveFolderId: 'fld_1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'br_a_suspended_legacy',
          orgId: ORG_A.id,
          name: 'موقوف',
          code: 'A-02',
          isActive: false,
          lifecycleStatus: 'suspended',
          driveFolderId: 'fld_old_suspended',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'br_a_active_no_drive',
          orgId: ORG_A.id,
          name: 'نشط بدون مجلد',
          code: 'A-03',
          isActive: true,
          lifecycleStatus: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'br_a_purged',
          orgId: ORG_A.id,
          name: 'مصفّى',
          code: 'A-04',
          isActive: false,
          lifecycleStatus: 'purged_from_db',
          driveFolderLink: 'https://drive.google.com/drive/folders/legacy',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'br_b_foreign',
          orgId: ORG_B.id,
          name: 'فرع مؤسسة أخرى',
          code: 'B-01',
          isActive: true,
          lifecycleStatus: 'active',
          driveFolderId: 'fld_b',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ];

      const toDisconnect = selectBranchesForDriveDisconnect(branches, ORG_A.id);
      assert.deepEqual(
        toDisconnect.map((b) => b.id),
        ['br_a_active', 'br_a_suspended_legacy', 'br_a_purged'],
        'Disconnect must clear active & inactive branches with legacy Drive fields in target org only'
      );

      const eligibleForLink = branches.filter(
        (b) => b.orgId === ORG_A.id && isBranchActiveForDriveLink(b)
      );
      assert.deepEqual(
        eligibleForLink.map((b) => b.id),
        ['br_a_active', 'br_a_active_no_drive'],
        'Link/sync must include active branches ONLY and strictly exclude suspended/purged branches'
      );
    }
  );

  await runCase(
    'Payload contract parity: Disconnect org (14 keys) and branch (3 keys) match firestore.rules allowlists exactly',
    () => {
      const sentinel = Symbol('deleteField');
      const orgPayload = buildOrgDriveDisconnectPayload('2026-11-24T10:00:00.000Z', () => sentinel);
      const expectedOrgKeys = [
        'driveConnected',
        'driveWriteVerified',
        'driveLastHealthStatus',
        'driveWriteVerifiedAt',
        'driveHealthError',
        'driveFolderId',
        'driveFolderName',
        'driveFolderLink',
        'driveAccountEmail',
        'driveAccountName',
        'driveGoogleSub',
        'driveLinkedAt',
        'driveMonthFolderIds',
        'updatedAt',
      ].sort();
      assert.deepEqual(Object.keys(orgPayload).sort(), expectedOrgKeys);
      assert.equal(orgPayload.driveConnected, false);
      assert.equal(orgPayload.driveWriteVerified, false);
      assert.equal(orgPayload.driveLastHealthStatus, 'disconnected');

      const branchPayload = buildBranchDriveDisconnectPayload(() => sentinel);
      assert.deepEqual(Object.keys(branchPayload).sort(), [
        'driveFolderId',
        'driveFolderLink',
        'driveFolderName',
      ]);
    }
  );

  await runCase(
    'Static firestore.rules invariants: Super Admin allowlists remain Drive-free, Owner path requires ownerId, Workers & Payroll 7 collections remain absent',
    () => {
      const rules = fs.readFileSync('firestore.rules', 'utf8');

      // 1. Extract canSuperAdminUpdateOrg body and verify zero drive* fields
      const saOrgMatch = rules.match(
        /function canSuperAdminUpdateOrg\([\s\S]*?\n    \}/
      );
      assert.ok(saOrgMatch, 'canSuperAdminUpdateOrg must exist in firestore.rules');
      assert.equal(
        /'drive[A-Za-z]+'/.test(saOrgMatch[0]),
        false,
        'canSuperAdminUpdateOrg MUST NOT include any drive* fields'
      );

      // 2. Extract canSuperAdminUpdateBranch body and verify zero driveFolderId/Name/Link
      const saBranchMatch = rules.match(
        /function canSuperAdminUpdateBranch\([\s\S]*?\n    \}/
      );
      assert.ok(saBranchMatch, 'canSuperAdminUpdateBranch must exist in firestore.rules');
      for (const forbidden of ['driveFolderId', 'driveFolderName', 'driveFolderLink']) {
        assert.equal(
          saBranchMatch[0].includes(`'${forbidden}'`),
          false,
          `canSuperAdminUpdateBranch MUST NOT include ${forbidden}`
        );
      }

      // 3. Verify independent owner helpers enforce ownerId == request.auth.uid & isOrgManager
      const ownerOrgMatch = rules.match(
        /function canOrgOwnerUpdateDriveMetadata\([\s\S]*?\n    \}/
      );
      assert.ok(ownerOrgMatch, 'canOrgOwnerUpdateDriveMetadata must exist');
      assert.ok(ownerOrgMatch[0].includes('prev.ownerId == request.auth.uid'));
      assert.ok(ownerOrgMatch[0].includes('isOrgManager(orgId)'));
      assert.ok(ownerOrgMatch[0].includes('isOrgSubscriptionAllowed(prev)'));

      const ownerBranchMatch = rules.match(
        /function canOrgOwnerSyncBranchDriveFolder\([\s\S]*?\n    \}/
      );
      assert.ok(ownerBranchMatch, 'canOrgOwnerSyncBranchDriveFolder must exist');
      assert.ok(ownerBranchMatch[0].includes('isParentOrgDriveOwnerActive(prev.orgId)'));
      assert.ok(ownerBranchMatch[0].includes('isOrgManager(prev.orgId)'));
      assert.ok(ownerBranchMatch[0].includes('isClearingAllDriveFields'));

      // 4. Verify all 7 Workers & Payroll collections remain completely unreferenced (default-deny)
      for (const coll of [
        'workers',
        'workerAdvances',
        'workerAdditions',
        'payrollRuns',
        'payrollItems',
        'payrollPayments',
        'payrollAuditLogs',
      ]) {
        assert.equal(
          new RegExp(`match\\s+/${coll}/`).test(rules),
          false,
          `Workers & Payroll collection '${coll}' must remain absent (default-deny) in firestore.rules`
        );
      }
    }
  );

  clearUnifiedDriveFolderCache();
  clearDriveSession();

  console.log('========================================================================');
  console.log(`DRIVE DISCONNECT & RULES INVARIANT SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
