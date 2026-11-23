/**
 * Employee UID Binding, Profile Lookup, Error Separation & Password Reset Tests — AL EQFAL
 *
 * Local synthetic unit test suite (ZERO live Firebase writes, ZERO real passwords) covering all
 * 11 required employee login, UID binding, error separation, password reset, and tenant isolation scenarios:
 *  1. Active employee with matching Auth UID (synthetic fixture for mo100100050@gmail.com / سحاب 1 (3)).
 *  2. Employee document exists under UID_A while signed-in Auth account has UID_B -> missing_employee_profile
 *     (NEVER auto-links by email; NEVER exposes org data) + strict docId/uid mismatch rejection & read-only diagnostics.
 *  3. Uppercase / padded email normalization ("  MO100100050@GMAIL.COM  ") with verbatim password preservation.
 *  4. Active branch_manager strictly scoped to assigned org & branch (سحاب 1 (3)).
 *  5. Archived employee -> account_archived (blocked from org data).
 *  6. Released employee -> membership_released; re-assigned to Org B -> active_tenant in Org B only.
 *  7. Firestore permission-denied / unauthenticated read -> permission_denied (NEVER missing_employee_profile).
 *  8. Network / offline read -> network_error when cache misses (NEVER missing_employee_profile); cache hit only when doc exists.
 *  9. Password reset email normalization without altering passwords.
 * 10. Expired or already-used password reset link (auth/expired-action-code, auth/invalid-action-code) + trilingual AR/EN/UR guidance.
 * 11. Cross-tenant isolation (Org A employee cannot enter Org B).
 */

import assert from 'node:assert/strict';
import {
  classifyAuthSignInError,
  detectProfileDocIdUidMismatches,
  fetchFirestoreDocWithFreshServerCheck,
  isRetryableServerCacheFallbackError,
  normalizeLoginEmail,
  prepareLoginCredentials,
  validateStrictAuthUidProfileBinding,
} from '../utils/authCredentials';
import {
  canRenderTenantDashboard,
  evaluateFirestoreErrorCategory,
  resolveProfiledUserAccess,
  resolveUnprofiledUserAccess,
} from '../utils/tenantAccess';
import { canUserAccessBranch, resolvePrimaryAssignedBranchId } from '../utils/permissions';
import { translations } from '../i18n/translations';
import { Branch, Organization, UserProfile } from '../types';

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}\n     ${err?.message || err}`);
    failed++;
  }
}

const NOW = new Date('2026-06-20T10:00:00.000Z');

const orgA: Organization = {
  id: 'org_sahab_a',
  name: 'مؤسسة سحاب الاختبارية',
  activityType: 'retail',
  currency: 'SAR',
  ownerId: 'mgr_org_a_uid',
  ownerEmail: 'owner.a@example.com',
  ownerName: 'مدير مؤسسة أ',
  driveConnected: true,
  isActive: true,
  subscriptionPlan: '1y',
  subscriptionStatus: 'active',
  subscriptionStartAt: '2026-01-01T00:00:00.000Z',
  subscriptionEndAt: '2027-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const orgB: Organization = {
  id: 'org_other_b',
  name: 'مؤسسة أخرى مستقلة',
  activityType: 'restaurant',
  currency: 'SAR',
  ownerId: 'mgr_org_b_uid',
  ownerEmail: 'owner.b@example.com',
  ownerName: 'مدير مؤسسة ب',
  driveConnected: true,
  isActive: true,
  subscriptionPlan: '1y',
  subscriptionStatus: 'active',
  subscriptionStartAt: '2026-01-01T00:00:00.000Z',
  subscriptionEndAt: '2027-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const branchSahab1: Branch = {
  id: 'branch_sahab_1_3',
  orgId: orgA.id,
  name: 'سحاب 1 (3)',
  code: 'SHB-03',
  isActive: true,
  paymentStatus: 'paid',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const branchSahab2: Branch = {
  id: 'branch_sahab_2',
  orgId: orgA.id,
  name: 'سحاب 2',
  code: 'SHB-02',
  isActive: true,
  paymentStatus: 'paid',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const branchOrgB: Branch = {
  id: 'branch_b_main',
  orgId: orgB.id,
  name: 'الفرع الرئيسي - ب',
  code: 'ORB-01',
  isActive: true,
  paymentStatus: 'paid',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// Local synthetic fixture mirroring the reported active branch_manager structure (NO real password)
const syntheticMohdFaisalProfile: UserProfile = {
  uid: 'uid_mohd_faisal_a',
  firestoreDocId: 'uid_mohd_faisal_a',
  orgId: orgA.id,
  email: 'mo100100050@gmail.com',
  displayName: 'محمد فيصل',
  role: 'branch_manager',
  branchId: branchSahab1.id,
  branchIds: [branchSahab1.id],
  branchName: branchSahab1.name,
  isActive: true,
  isArchived: false,
  membershipStatus: 'active',
  permissions: {
    canCreateClosing: true,
    canViewAllClosings: false,
    canApproveClosings: true,
    canManageBranches: false,
    canManageEmployees: false,
    canExportReports: true,
  },
  createdAt: '2026-02-01T00:00:00.000Z',
};

async function main() {
  console.log('\n🧪 Running AL EQFAL Employee UID Binding & Password Reset Tests...\n');

  // 1. Active employee with matching Firebase Auth UID
  await runTest('1. Active employee with matching Auth UID (mo100100050@gmail.com synthetic fixture) gains active_tenant access', () => {
    const binding = validateStrictAuthUidProfileBinding({
      authUid: 'uid_mohd_faisal_a',
      docId: 'uid_mohd_faisal_a',
      storedProfileUid: syntheticMohdFaisalProfile.uid,
    });
    assert.deepEqual(binding, { valid: true });

    const resolution = resolveProfiledUserAccess({
      profile: syntheticMohdFaisalProfile,
      org: orgA,
      now: NOW,
    });
    assert.equal(resolution.status, 'active_tenant');
    if (resolution.status === 'active_tenant') {
      assert.equal(resolution.profile.role, 'branch_manager');
      assert.equal(resolution.profile.branchId, branchSahab1.id);
      assert.equal(resolution.profile.branchName, 'سحاب 1 (3)');
      assert.equal(
        canRenderTenantDashboard({
          tenantStatus: 'active_tenant',
          hasAuthUser: true,
          userProfile: resolution.profile,
          currentOrg: resolution.org,
          subscriptionEvaluation: resolution.subscriptionEvaluation,
        }),
        true
      );
    }
  });

  // 2. Employee exists under UID_A while Auth signs in with UID_B -> NEVER auto-links by email
  await runTest('2. Auth UID_B with same email mo100100050@gmail.com (doc only at users/UID_A) strictly returns missing_employee_profile without auto-linking', () => {
    // Firestore getDoc(doc(db, 'users', 'uid_other_b')) returns exists() === false
    const unprofiled = resolveUnprofiledUserAccess({
      uid: 'uid_other_b',
      isGoogleUser: false,
      isVerifiedEmail: false,
      emailLower: 'mo100100050@gmail.com',
      invite: null,
      inviteOrg: null,
      now: NOW,
    });
    assert.deepEqual(unprofiled, {
      status: 'access_error',
      errorReason: 'missing_employee_profile',
    });

    // Strict UID binding check rejects docId !== authUid and storedUid !== authUid
    assert.deepEqual(
      validateStrictAuthUidProfileBinding({
        authUid: 'uid_other_b',
        docId: 'uid_mohd_faisal_a',
        storedProfileUid: 'uid_mohd_faisal_a',
      }),
      { valid: false, reason: 'doc_id_mismatch' }
    );
    assert.deepEqual(
      validateStrictAuthUidProfileBinding({
        authUid: 'uid_other_b',
        docId: 'uid_other_b',
        storedProfileUid: 'uid_mohd_faisal_a',
      }),
      { valid: false, reason: 'stored_uid_mismatch' }
    );

    // Read-only diagnostic detects docId !== uid without mutating input
    const malformedDoc: UserProfile = {
      ...syntheticMohdFaisalProfile,
      firestoreDocId: 'legacy_doc_id_123',
    };
    const issues = detectProfileDocIdUidMismatches([syntheticMohdFaisalProfile, malformedDoc]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].docId, 'legacy_doc_id_123');
    assert.equal(issues[0].storedUid, 'uid_mohd_faisal_a');
    assert.equal(malformedDoc.uid, 'uid_mohd_faisal_a');
  });

  // 3. Uppercase / whitespace email normalization without touching password
  await runTest('3. Uppercase/padded email "  MO100100050@GMAIL.COM  " normalizes cleanly while preserving password verbatim', () => {
    const syntheticPwd = '  Synthetic#TestPwd2026  ';
    const creds = prepareLoginCredentials('  MO100100050@GMAIL.COM \t', syntheticPwd);
    assert.equal(creds.email, 'mo100100050@gmail.com');
    assert.equal(creds.password, syntheticPwd);
  });

  // 4. Active branch_manager strictly scoped to assigned org & branch
  await runTest('4. Active branch_manager is strictly scoped to branch سحاب 1 (3) and blocked from other branches', () => {
    assert.equal(resolvePrimaryAssignedBranchId(syntheticMohdFaisalProfile), branchSahab1.id);
    assert.equal(canUserAccessBranch(syntheticMohdFaisalProfile, branchSahab1.id), true);
    assert.equal(canUserAccessBranch(syntheticMohdFaisalProfile, branchSahab2.id), false);
    assert.equal(canUserAccessBranch(syntheticMohdFaisalProfile, branchOrgB.id), false);
  });

  // 5. Archived employee -> account_archived
  await runTest('5. Archived employee receives account_archived and zero dashboard access', () => {
    const archivedEmp: UserProfile = {
      ...syntheticMohdFaisalProfile,
      isActive: false,
      isArchived: true,
      membershipStatus: 'archived',
    };
    const res = resolveProfiledUserAccess({ profile: archivedEmp, org: orgA, now: NOW });
    assert.deepEqual(res, { status: 'access_error', errorReason: 'account_archived' });
    assert.equal(
      canRenderTenantDashboard({
        tenantStatus: 'access_error',
        hasAuthUser: true,
        userProfile: archivedEmp,
        currentOrg: orgA,
        subscriptionEvaluation: null,
      }),
      false
    );
  });

  // 6. Released & re-assigned employee -> membership_released then Org B active_tenant only
  await runTest('6. Released employee sees membership_released, and after re-assignment accesses Org B only', () => {
    const releasedEmp: UserProfile = {
      ...syntheticMohdFaisalProfile,
      orgId: '',
      branchId: undefined,
      branchIds: undefined,
      branchName: undefined,
      isActive: false,
      isArchived: false,
      membershipStatus: 'released',
      releasedFromOrgId: orgA.id,
      releasedAt: NOW.toISOString(),
    };
    const releasedRes = resolveProfiledUserAccess({ profile: releasedEmp, org: null, now: NOW });
    assert.deepEqual(releasedRes, { status: 'access_error', errorReason: 'membership_released' });

    const reassignedToOrgB: UserProfile = {
      ...syntheticMohdFaisalProfile,
      orgId: orgB.id,
      branchId: branchOrgB.id,
      branchIds: [branchOrgB.id],
      branchName: branchOrgB.name,
      isActive: true,
      isArchived: false,
      membershipStatus: 'active',
    };
    const orgBRes = resolveProfiledUserAccess({ profile: reassignedToOrgB, org: orgB, now: NOW });
    assert.equal(orgBRes.status, 'active_tenant');
    // Cannot enter Org A even if Org A doc were mistakenly passed
    const orgACrossRes = resolveProfiledUserAccess({ profile: reassignedToOrgB, org: orgA, now: NOW });
    assert.deepEqual(orgACrossRes, { status: 'access_error', errorReason: 'permission_denied' });
  });

  // 7. Firestore permission-denied / unauthenticated NEVER turns into missing_employee_profile
  await runTest('7. Firestore permission-denied and unauthenticated rethrow immediately without cache fallback and map to permission_denied', async () => {
    let fallbackCalled = false;
    const permErr = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    assert.equal(isRetryableServerCacheFallbackError(permErr), false);
    assert.equal(evaluateFirestoreErrorCategory(permErr), 'permission_denied');

    await assert.rejects(
      () =>
        fetchFirestoreDocWithFreshServerCheck(
          async () => {
            throw permErr;
          },
          async () => {
            fallbackCalled = true;
            return { exists: () => false };
          }
        ),
      (err: any) => evaluateFirestoreErrorCategory(err) === 'permission_denied'
    );
    assert.equal(fallbackCalled, false);

    const unauthErr = { code: 'unauthenticated', message: 'Request had invalid authentication credentials.' };
    assert.equal(isRetryableServerCacheFallbackError(unauthErr), false);
    assert.equal(evaluateFirestoreErrorCategory(unauthErr), 'permission_denied');
  });

  // 8. Network / offline error NEVER falsely reports missing_employee_profile
  await runTest('8. Offline/unavailable server read falls back ONLY on populated cache hit and otherwise throws network_error (never missing_employee_profile)', async () => {
    const offlineErr = {
      code: 'unavailable',
      message: 'Failed to get document because the client is offline.',
    };
    assert.equal(isRetryableServerCacheFallbackError(offlineErr), true);
    assert.equal(evaluateFirestoreErrorCategory(offlineErr), 'network_error');

    // Cache MISS while offline MUST throw network_error (NEVER return exists()===false -> missing_employee_profile!)
    await assert.rejects(
      () =>
        fetchFirestoreDocWithFreshServerCheck(
          async () => {
            throw offlineErr;
          },
          async () => ({ exists: () => false })
        ),
      (err: any) => evaluateFirestoreErrorCategory(err) === 'network_error'
    );

    // Cache HIT while offline returns the cached existing profile safely
    const cachedHit = await fetchFirestoreDocWithFreshServerCheck(
      async () => {
        throw offlineErr;
      },
      async () => ({ exists: () => true, id: 'uid_mohd_faisal_a' })
    );
    assert.equal(cachedHit.exists(), true);
    assert.equal((cachedHit as any).id, 'uid_mohd_faisal_a');
  });

  // 9. Password reset email normalization
  await runTest('9. Password reset email normalization trims & lowercases consistently for all reset paths', () => {
    assert.equal(normalizeLoginEmail('  Mo100100050@Gmail.COM  '), 'mo100100050@gmail.com');
    assert.equal(normalizeLoginEmail('\n  USER@DOMAIN.SA \t'), 'user@domain.sa');
  });

  // 10. Expired or already-used password reset link classification & AR/EN/UR messages
  await runTest('10. Expired/used password reset link codes classify accurately and all AR/EN/UR guidance keys exist', () => {
    assert.deepEqual(classifyAuthSignInError({ code: 'auth/expired-action-code' }), {
      translationKey: 'authErrExpiredActionCode',
      showCredentialGuidance: false,
      isResetLinkExpiredOrUsed: true,
    });
    assert.deepEqual(classifyAuthSignInError({ code: 'auth/invalid-action-code' }), {
      translationKey: 'authErrInvalidActionCode',
      showCredentialGuidance: false,
      isResetLinkExpiredOrUsed: true,
    });

    const requiredKeys = [
      'authErrExpiredActionCode',
      'authErrInvalidActionCode',
      'authResetSingleUseNote',
      'subAccessMissingEmployeeTitle',
      'subAccessMissingEmployee',
      'subAccessMissingEmployeeUidHint',
    ] as const;

    for (const lang of ['ar', 'en', 'ur'] as const) {
      for (const key of requiredKeys) {
        const val = (translations[lang] as Record<string, unknown>)[key];
        assert.equal(typeof val, 'string', `Missing ${lang}.${key}`);
        assert.ok((val as string).trim().length > 10, `Too short ${lang}.${key}`);
      }
    }
  });

  // 11. Cross-tenant isolation check
  await runTest('11. Cross-tenant isolation prevents Org A employee from loading Org B workspace', () => {
    const crossRes = resolveProfiledUserAccess({
      profile: syntheticMohdFaisalProfile,
      org: orgB,
      now: NOW,
    });
    assert.deepEqual(crossRes, { status: 'access_error', errorReason: 'permission_denied' });
    assert.equal(
      canRenderTenantDashboard({
        tenantStatus: 'active_tenant',
        hasAuthUser: true,
        userProfile: syntheticMohdFaisalProfile,
        currentOrg: orgB,
        subscriptionEvaluation: null,
      }),
      false
    );
  });

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
