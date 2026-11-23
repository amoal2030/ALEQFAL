/**
 * Login, Credentials Hygiene, Email Immutability & Archived/Disabled Access Tests — AL EQFAL
 *
 * Local deterministic unit test suite verifying:
 * 1. Email normalization (trim + toLowerCase) and strict verbatim password preservation.
 * 2. Password confirmation validation without modifying/trimming passwords.
 * 3. Prevention of independent Firestore email mutation in employee updates + read-only mismatch detection.
 * 4. Non-enumerating auth error classification & trilingual (ar/en/ur) translations.
 * 5. New employee provisioning -> immediate active_tenant login readiness.
 * 6. Distinct access denial for archived vs disabled vs permanently released members (zero org data leak).
 * 7. Zero impact on Super Admin (amoal2030@gmail.com) and existing active managers.
 */

import assert from 'node:assert/strict';
import {
  assertProfileEmailImmutableOnEmployeeUpdate,
  classifyAuthSignInError,
  detectAuthProfileEmailMismatch,
  detectProfileEmailDiagnostics,
  detectProfileUidBindingDiagnostics,
  evaluatePasswordResetCooldown,
  normalizeLoginEmail,
  PASSWORD_RESET_COOLDOWN_MS,
  prepareLoginCredentials,
  syncAuthLanguageCode,
  validateLoadedUserProfileBinding,
  validatePasswordConfirmation,
} from '../utils/authCredentials';
import {
  canRenderTenantDashboard,
  evaluateFirestoreErrorCategory,
  resolveProfiledUserAccess,
  resolveUnprofiledUserAccess,
} from '../utils/tenantAccess';
import {
  buildSuperAdminAssignReleasedMemberBundle,
  buildSuperAdminMemberCreateBundle,
  validateSuperAdminMemberCreateInput,
} from '../utils/superAdminGovernance';
import {
  canUserAccessBranch,
  resolvePrimaryAssignedBranchId,
} from '../utils/permissions';
import { isVerifiedSuperAdmin, SUPER_ADMIN_EMAIL } from '../utils/superAdmin';
import { translations } from '../i18n/translations';
import { Branch, Organization, UserProfile } from '../types';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}\n     ${err?.message || err}`);
    failed++;
  }
}

const NOW = new Date('2026-06-15T12:00:00.000Z');

const activeOrg: Organization = {
  id: 'org_login_test',
  name: 'مؤسسة الاختبار للتجارة',
  activityType: 'retail',
  currency: 'SAR',
  ownerId: 'mgr_uid_1',
  ownerEmail: 'manager.owner@example.com',
  ownerName: 'مدير المؤسسة',
  driveConnected: true,
  isActive: true,
  subscriptionPlan: '1y',
  subscriptionStatus: 'active',
  subscriptionStartAt: '2026-01-01T00:00:00.000Z',
  subscriptionEndAt: '2027-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const activeBranch: Branch = {
  id: 'br_login_1',
  orgId: activeOrg.id,
  name: 'الفرع الرئيسي',
  code: 'BR-01',
  isActive: true,
  paymentStatus: 'paid',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const activeManagerProfile: UserProfile = {
  uid: 'mgr_uid_1',
  orgId: activeOrg.id,
  email: 'manager.owner@example.com',
  displayName: 'مدير المؤسسة',
  role: 'manager',
  isActive: true,
  permissions: {
    canCreateClosing: true,
    canViewAllClosings: true,
    canApproveClosings: true,
    canManageBranches: true,
    canManageEmployees: true,
    canExportReports: true,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const baseEmployeeProfile: UserProfile = {
  uid: 'emp_uid_1',
  orgId: activeOrg.id,
  email: 'cashier.one@example.com',
  displayName: 'موظف الصندوق',
  role: 'employee',
  branchId: activeBranch.id,
  branchName: activeBranch.name,
  isActive: true,
  isArchived: false,
  membershipStatus: 'active',
  permissions: {
    canCreateClosing: true,
    canViewAllClosings: false,
    canApproveClosings: false,
    canManageBranches: false,
    canManageEmployees: false,
    canExportReports: false,
  },
  createdAt: '2026-02-01T00:00:00.000Z',
};

console.log('\n🧪 Running AL EQFAL Login & Employee Account Safeguards Tests...\n');

// 1. Email normalization & verbatim password preservation
test('1. normalizeLoginEmail trims and lowercases emails safely', () => {
  assert.equal(normalizeLoginEmail('  User.Name@Gmail.COM  '), 'user.name@gmail.com');
  assert.equal(normalizeLoginEmail('\tSTAFF@Company.SA\n'), 'staff@company.sa');
  assert.equal(normalizeLoginEmail(null), '');
  assert.equal(normalizeLoginEmail(undefined), '');
});

test('2. prepareLoginCredentials normalizes email and NEVER trims or mutates password', () => {
  const rawPasswordWithSpaces = '  MyP@ss Word 123!  ';
  const creds = prepareLoginCredentials('  Cashier.One@Example.COM ', rawPasswordWithSpaces);
  assert.equal(creds.email, 'cashier.one@example.com');
  assert.equal(creds.password, rawPasswordWithSpaces);
  assert.equal(creds.password.length, rawPasswordWithSpaces.length);
});

test('3. validatePasswordConfirmation checks exact equality without trimming passwords', () => {
  assert.deepEqual(validatePasswordConfirmation('12345', '12345'), {
    valid: false,
    reason: 'too_short',
  });
  assert.deepEqual(validatePasswordConfirmation('Secret123', 'Secret123 '), {
    valid: false,
    reason: 'mismatch',
  });
  assert.deepEqual(validatePasswordConfirmation(' Pass123 ', ' Pass123 '), {
    valid: true,
  });
});

// 2. Email immutability & read-only mismatch detection
test('4. assertProfileEmailImmutableOnEmployeeUpdate blocks independent Firestore email edits', () => {
  // Omitting email or keeping same normalized email is allowed
  assert.doesNotThrow(() =>
    assertProfileEmailImmutableOnEmployeeUpdate('staff@example.com', undefined)
  );
  assert.doesNotThrow(() =>
    assertProfileEmailImmutableOnEmployeeUpdate('staff@example.com', '  STAFF@Example.COM ')
  );

  // Changing email to a different address MUST throw
  assert.throws(
    () => assertProfileEmailImmutableOnEmployeeUpdate('old@example.com', 'new@example.com'),
    /Firebase Authentication/
  );
});

test('5. detectAuthProfileEmailMismatch reports divergence without auto-mutating inputs', () => {
  const same = detectAuthProfileEmailMismatch({
    uid: 'u1',
    authEmail: 'User@Example.com',
    profileEmail: '  user@example.com ',
    now: NOW,
  });
  assert.equal(same, null);

  const profileObj = { uid: 'u2', email: 'edited.in.firestore@example.com' };
  const mismatch = detectAuthProfileEmailMismatch({
    uid: profileObj.uid,
    authEmail: 'real.auth@example.com',
    profileEmail: profileObj.email,
    now: NOW,
  });
  assert.ok(mismatch !== null);
  assert.equal(mismatch.uid, 'u2');
  assert.equal(mismatch.authEmail, 'real.auth@example.com');
  assert.equal(mismatch.profileEmail, 'edited.in.firestore@example.com');
  assert.equal(mismatch.detectedAt, NOW.toISOString());
  // Confirm zero auto-sync mutation on input
  assert.equal(profileObj.email, 'edited.in.firestore@example.com');
});

test('6. detectProfileEmailDiagnostics flags non-normalized & duplicate emails read-only', () => {
  const issues = detectProfileEmailDiagnostics([
    { uid: 'u1', displayName: 'A', orgId: 'o1', email: 'Clean@Example.com ' },
    { uid: 'u2', displayName: 'B', orgId: 'o1', email: 'clean@example.com' },
    { uid: 'u3', displayName: 'C', orgId: 'o1', email: 'ok@example.com' },
  ]);
  assert.equal(issues.filter((i) => i.issueType === 'non_normalized_email').length, 1);
  assert.equal(issues.filter((i) => i.issueType === 'duplicate_normalized_email').length, 2);
});

// 3. Non-enumerating auth error messages & trilingual completeness
test('7. classifyAuthSignInError maps invalid-credential/wrong-password/user-not-found identically without user enumeration', () => {
  const c1 = classifyAuthSignInError({ code: 'auth/invalid-credential' });
  const c2 = classifyAuthSignInError({ code: 'auth/wrong-password' });
  const c3 = classifyAuthSignInError({ code: 'auth/user-not-found' });
  assert.deepEqual(c1, {
    translationKey: 'authErrInvalidCredentials',
    showCredentialGuidance: true,
  });
  assert.deepEqual(c2, c1);
  assert.deepEqual(c3, c1);

  assert.deepEqual(classifyAuthSignInError({ code: 'auth/user-disabled' }), {
    translationKey: 'authErrUserDisabled',
    showCredentialGuidance: false,
  });
  assert.deepEqual(classifyAuthSignInError({ code: 'auth/too-many-requests' }), {
    translationKey: 'authErrTooManyRequests',
    showCredentialGuidance: false,
  });
  assert.deepEqual(classifyAuthSignInError({ code: 'auth/network-request-failed' }), {
    translationKey: 'authErrNetwork',
    showCredentialGuidance: false,
  });
});

test('8. Trilingual translations (ar/en/ur) exist for auth guidance and distinct archived/disabled notices', () => {
  const requiredKeys = [
    'authShowPassword',
    'authHidePassword',
    'authInvalidCredsGuidance',
    'authTryGoogleSignIn',
    'authTryPasswordReset',
    'subAccessAuthVerifiedNotice',
    'subAccessArchivedAccountTitle',
    'subAccessArchivedAccountDesc',
    'subAccessDisabledAccountTitle',
    'subAccessDisabledAccount',
    'subAccessMembershipReleasedTitle',
    'subAccessMembershipReleasedDesc',
  ] as const;

  for (const lang of ['ar', 'en', 'ur'] as const) {
    for (const key of requiredKeys) {
      const val = (translations[lang] as Record<string, unknown>)[key];
      assert.equal(typeof val, 'string', `Missing ${lang}.${key}`);
      assert.ok((val as string).trim().length > 5, `Empty ${lang}.${key}`);
    }
    // Archived & disabled titles must be distinct in every language
    assert.notEqual(
      translations[lang].subAccessArchivedAccountTitle,
      translations[lang].subAccessDisabledAccountTitle
    );
  }
});

// 4. New employee provisioning -> immediate active login readiness
test('9. New employee created with mixed-case/padded email gets normalized email and immediate active_tenant access', () => {
  const validated = validateSuperAdminMemberCreateInput({
    actor: { email: SUPER_ADMIN_EMAIL, emailVerified: true },
    org: activeOrg,
    orgBranches: [activeBranch],
    email: '  New.Cashier@Gmail.COM ',
    password: '  Pass#2026  ',
    displayName: 'كاشير جديد',
    role: 'employee',
    branchId: activeBranch.id,
  });
  assert.equal(validated.email, 'new.cashier@gmail.com');

  const { userDoc } = buildSuperAdminMemberCreateBundle({
    actor: {
      uid: 'sa_uid',
      email: SUPER_ADMIN_EMAIL,
      emailVerified: true,
      displayName: 'Super Admin',
    },
    org: activeOrg,
    newUid: 'emp_new_uid_1',
    validated,
    now: NOW,
  });

  // Simulate employee immediately signing in with normalized credentials
  const loginCreds = prepareLoginCredentials('  NEW.CASHIER@GMAIL.COM ', '  Pass#2026  ');
  assert.equal(loginCreds.email, userDoc.email);
  assert.equal(loginCreds.password, '  Pass#2026  ');

  const access = resolveProfiledUserAccess({ profile: userDoc, org: activeOrg, now: NOW });
  assert.equal(access.status, 'active_tenant');
  if (access.status === 'active_tenant') {
    assert.equal(
      canRenderTenantDashboard({
        tenantStatus: 'active_tenant',
        hasAuthUser: true,
        userProfile: access.profile,
        currentOrg: access.org,
        subscriptionEvaluation: access.subscriptionEvaluation,
      }),
      true
    );
  }
});

// 5. Archived vs Disabled vs Released access separation & org data protection
test('10. Archived employee receives account_archived and is strictly blocked from org dashboard even if auth succeeds', () => {
  const archivedProfile: UserProfile = {
    ...baseEmployeeProfile,
    isActive: false,
    isArchived: true,
    membershipStatus: 'archived',
  };
  const res = resolveProfiledUserAccess({ profile: archivedProfile, org: activeOrg, now: NOW });
  assert.equal(res.status, 'access_error');
  if (res.status === 'access_error') {
    assert.equal(res.errorReason, 'account_archived');
  }

  // Defense-in-depth: even if a legacy archived doc still had isActive: true, it MUST still be blocked
  const legacyArchivedFlagOnly: UserProfile = {
    ...baseEmployeeProfile,
    isActive: true,
    isArchived: true,
    membershipStatus: undefined,
  };
  const resLegacy = resolveProfiledUserAccess({
    profile: legacyArchivedFlagOnly,
    org: activeOrg,
    now: NOW,
  });
  assert.equal(resLegacy.status, 'access_error');
  if (resLegacy.status === 'access_error') {
    assert.equal(resLegacy.errorReason, 'account_archived');
  }

  assert.equal(
    canRenderTenantDashboard({
      tenantStatus: 'access_error',
      hasAuthUser: true,
      userProfile: archivedProfile,
      currentOrg: activeOrg,
      subscriptionEvaluation: null,
    }),
    false
  );
});

test('11. Disabled non-archived employee receives distinct account_disabled reason', () => {
  const disabledProfile: UserProfile = {
    ...baseEmployeeProfile,
    isActive: false,
    isArchived: false,
    membershipStatus: 'active',
  };
  const res = resolveProfiledUserAccess({ profile: disabledProfile, org: activeOrg, now: NOW });
  assert.equal(res.status, 'access_error');
  if (res.status === 'access_error') {
    assert.equal(res.errorReason, 'account_disabled');
  }
  assert.equal(
    canRenderTenantDashboard({
      tenantStatus: 'access_error',
      hasAuthUser: true,
      userProfile: disabledProfile,
      currentOrg: activeOrg,
      subscriptionEvaluation: null,
    }),
    false
  );
});

test('12. Released employee keeps membership_released path untouched', () => {
  const releasedProfile: UserProfile = {
    ...baseEmployeeProfile,
    orgId: '',
    isActive: false,
    isArchived: false,
    membershipStatus: 'released',
    releasedAt: NOW.toISOString(),
  };
  const res = resolveProfiledUserAccess({ profile: releasedProfile, org: null, now: NOW });
  assert.equal(res.status, 'access_error');
  if (res.status === 'access_error') {
    assert.equal(res.errorReason, 'membership_released');
  }
});

// 6. Super Admin & existing managers completely unaffected
test('13. Super Admin (amoal2030@gmail.com) and existing active manager access remain completely unaffected', () => {
  assert.equal(SUPER_ADMIN_EMAIL, 'amoal2030@gmail.com');
  assert.equal(
    isVerifiedSuperAdmin({ email: 'AMOAL2030@gmail.com', emailVerified: true }),
    true
  );
  assert.equal(
    isVerifiedSuperAdmin({ email: 'amoal2030@gmail.com', emailVerified: false }),
    false
  );
  assert.equal(
    isVerifiedSuperAdmin({ email: 'other@gmail.com', emailVerified: true }),
    false
  );

  const mgrRes = resolveProfiledUserAccess({
    profile: activeManagerProfile,
    org: activeOrg,
    authUid: activeManagerProfile.uid,
    now: NOW,
  });
  assert.equal(mgrRes.status, 'active_tenant');
  if (mgrRes.status === 'active_tenant') {
    assert.equal(
      canRenderTenantDashboard({
        tenantStatus: 'active_tenant',
        hasAuthUser: true,
        userProfile: mgrRes.profile,
        currentOrg: mgrRes.org,
        subscriptionEvaluation: mgrRes.subscriptionEvaluation,
      }),
      true
    );
  }
});

// ============================================================================
// Phase 3 Mandatory Scenarios (Employee UID Binding, Error Separation, Reset UX)
// ============================================================================

const orgB: Organization = {
  ...activeOrg,
  id: 'org_other_tenant_b',
  name: 'مؤسسة أخرى مستقلة',
  ownerId: 'mgr_uid_b',
  ownerEmail: 'owner.b@example.com',
};

const sahabBranch: Branch = {
  id: 'br_sahab_1_3',
  orgId: activeOrg.id,
  name: 'سحاب 1 (3)',
  code: 'SHB-1',
  isActive: true,
  paymentStatus: 'paid',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const otherBranchSameOrg: Branch = {
  id: 'br_other_2',
  orgId: activeOrg.id,
  name: 'فرع الشمال',
  code: 'NRT-2',
  isActive: true,
  paymentStatus: 'paid',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const orgBBranch: Branch = {
  id: 'br_org_b_1',
  orgId: orgB.id,
  name: 'فرع المؤسسة ب',
  code: 'OB-1',
  isActive: true,
  paymentStatus: 'paid',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// Local safe mock fixture replicating the structure of mo100100050@gmail.com (NO real password)
const localMoBranchManagerFixture: UserProfile = {
  uid: 'mock_uid_mo100100050',
  orgId: activeOrg.id,
  email: 'mo100100050@gmail.com',
  displayName: 'محمد فيصل',
  role: 'branch_manager',
  branchId: sahabBranch.id,
  branchIds: [sahabBranch.id],
  branchName: sahabBranch.name,
  isActive: true,
  isArchived: false,
  membershipStatus: 'active',
  permissions: {
    canCreateClosing: true,
    canViewAllClosings: false,
    canApproveClosings: false,
    canManageBranches: false,
    canManageEmployees: false,
    canExportReports: false,
  },
  createdAt: '2026-02-01T00:00:00.000Z',
};

test('14. Safe local fixture (mo100100050@gmail.com): matching Auth UID & users/{uid} doc resolves active_tenant with exact role & branch', () => {
  const binding = validateLoadedUserProfileBinding({
    authUid: localMoBranchManagerFixture.uid,
    docId: localMoBranchManagerFixture.uid,
    docExists: true,
    rawProfile: localMoBranchManagerFixture,
  });
  assert.equal(binding.status, 'valid');
  if (binding.status !== 'valid') return;

  const access = resolveProfiledUserAccess({
    profile: binding.profile,
    org: activeOrg,
    authUid: localMoBranchManagerFixture.uid,
    now: NOW,
  });
  assert.equal(access.status, 'active_tenant');
  if (access.status === 'active_tenant') {
    assert.equal(access.profile.role, 'branch_manager');
    assert.equal(access.profile.isActive, true);
    assert.equal(resolvePrimaryAssignedBranchId(access.profile), sahabBranch.id);
    assert.equal(canUserAccessBranch(access.profile, sahabBranch.id), true);
    assert.equal(canUserAccessBranch(access.profile, otherBranchSameOrg.id), false);
    assert.equal(
      canRenderTenantDashboard({
        tenantStatus: 'active_tenant',
        hasAuthUser: true,
        userProfile: access.profile,
        currentOrg: access.org,
        subscriptionEvaluation: access.subscriptionEvaluation,
      }),
      true
    );
  }
});

test('15. Existing employee record with mismatched Auth UID / docId is strictly blocked and NEVER auto-linked by email', () => {
  // Case A: Auth signed in as a different UID whose users/{authUid} doc does not exist (even though an active doc exists under another UID for the same email)
  const missingForNewUid = validateLoadedUserProfileBinding({
    authUid: 'mock_uid_recreated_auth',
    docId: 'mock_uid_recreated_auth',
    docExists: false,
    rawProfile: null,
  });
  assert.deepEqual(missingForNewUid, {
    status: 'missing_profile',
    reason: 'missing_employee_profile',
  });

  const unprofiled = resolveUnprofiledUserAccess({
    uid: 'mock_uid_recreated_auth',
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

  // Case B: Document under users/{authUid} contains a different stored uid field
  const corruptedPayload = validateLoadedUserProfileBinding({
    authUid: 'mock_uid_recreated_auth',
    docId: 'mock_uid_recreated_auth',
    docExists: true,
    rawProfile: {
      ...localMoBranchManagerFixture,
      uid: 'mock_uid_mo100100050',
    },
  });
  assert.equal(corruptedPayload.status, 'uid_mismatch');
  if (corruptedPayload.status === 'uid_mismatch') {
    assert.equal(corruptedPayload.reason, 'profile_uid_mismatch');
  }

  // Case C: resolveProfiledUserAccess also independently rejects authUid !== profile.uid
  const directAccess = resolveProfiledUserAccess({
    profile: localMoBranchManagerFixture,
    org: activeOrg,
    authUid: 'mock_uid_recreated_auth',
    now: NOW,
  });
  assert.deepEqual(directAccess, {
    status: 'access_error',
    errorReason: 'profile_uid_mismatch',
  });

  // Case D: Read-only diagnostic detects docId !== stored uid without mutating records
  const rawDocs = [
    {
      docId: 'legacy_doc_id_xyz',
      uid: 'mock_uid_mo100100050',
      displayName: 'محمد فيصل',
      email: 'mo100100050@gmail.com',
      orgId: activeOrg.id,
    },
    {
      docId: 'missing_uid_doc',
      uid: '',
      displayName: 'موظف قديم',
      email: 'old@example.com',
      orgId: activeOrg.id,
    },
    {
      docId: localMoBranchManagerFixture.uid,
      uid: localMoBranchManagerFixture.uid,
      displayName: localMoBranchManagerFixture.displayName,
      email: localMoBranchManagerFixture.email,
      orgId: activeOrg.id,
    },
  ];
  const diag = detectProfileUidBindingDiagnostics(rawDocs);
  assert.equal(diag.length, 2);
  assert.equal(diag[0].issueType, 'doc_id_uid_mismatch');
  assert.equal(diag[0].docId, 'legacy_doc_id_xyz');
  assert.equal(diag[0].storedUid, 'mock_uid_mo100100050');
  assert.equal(diag[1].issueType, 'missing_uid_field');
  // Confirm zero mutation
  assert.equal(rawDocs[0].docId, 'legacy_doc_id_xyz');
  assert.equal(rawDocs[0].uid, 'mock_uid_mo100100050');
});

test('16. Sign-in and password reset normalize uppercase & whitespace-padded email while preserving password verbatim', () => {
  const creds = prepareLoginCredentials('  MO100100050@GMAIL.COM  ', '  Test#Pass 99  ');
  assert.equal(creds.email, 'mo100100050@gmail.com');
  assert.equal(creds.password, '  Test#Pass 99  ');
  assert.equal(normalizeLoginEmail('\tMO100100050@Gmail.Com \n'), 'mo100100050@gmail.com');
});

test('17. Firestore permission-denied NEVER masquerades as missing_employee_profile', () => {
  const permErr = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
  assert.equal(evaluateFirestoreErrorCategory(permErr), 'permission_denied');

  const bindingRes = validateLoadedUserProfileBinding({
    authUid: localMoBranchManagerFixture.uid,
    docId: localMoBranchManagerFixture.uid,
    docExists: false,
    rawProfile: null,
    readError: permErr,
  });
  assert.deepEqual(bindingRes, {
    status: 'read_error',
    reason: 'permission_denied',
  });
  assert.notEqual(bindingRes.reason, 'missing_employee_profile');
});

test('18. Network / offline Firestore failure NEVER masquerades as missing_employee_profile', () => {
  const offlineErrors = [
    { code: 'unavailable', message: 'Failed to get document because the client is offline.' },
    { code: 'deadline-exceeded', message: 'Could not reach Cloud Firestore backend.' },
    new Error('Network request failed'),
  ];
  for (const err of offlineErrors) {
    assert.equal(evaluateFirestoreErrorCategory(err), 'network_error');
    const bindingRes = validateLoadedUserProfileBinding({
      authUid: localMoBranchManagerFixture.uid,
      docId: localMoBranchManagerFixture.uid,
      docExists: false,
      rawProfile: null,
      readError: err,
    });
    assert.deepEqual(bindingRes, {
      status: 'read_error',
      reason: 'network_error',
    });
    assert.notEqual(bindingRes.reason, 'missing_employee_profile');
  }
});

test('19. Released employee re-assigned to Org B keeps same Auth UID and has zero access to Org A', () => {
  const releasedMember: UserProfile = {
    ...localMoBranchManagerFixture,
    orgId: '',
    branchId: undefined,
    branchIds: undefined,
    branchName: undefined,
    isActive: false,
    isArchived: false,
    membershipStatus: 'released',
    releasedAt: NOW.toISOString(),
    releasedFromOrgId: activeOrg.id,
    releasedFromOrgName: activeOrg.name,
  };

  // While released -> blocked with membership_released
  const whileReleased = resolveProfiledUserAccess({
    profile: releasedMember,
    org: activeOrg,
    authUid: releasedMember.uid,
    now: NOW,
  });
  assert.deepEqual(whileReleased, {
    status: 'access_error',
    errorReason: 'membership_released',
  });

  // After Super Admin re-assigns same UID to Org B
  const { userPatch } = buildSuperAdminAssignReleasedMemberBundle({
    actor: {
      uid: 'sa_uid',
      email: SUPER_ADMIN_EMAIL,
      emailVerified: true,
      displayName: 'Super Admin',
    },
    existingMember: releasedMember,
    targetOrg: orgB,
    targetOrgBranches: [orgBBranch],
    role: 'branch_manager',
    branchId: orgBBranch.id,
    reason: 'إعادة ربط الموظف بمؤسسة جديدة بعد التحرير النهائي',
    now: NOW,
    deleteFieldSentinel: '__DELETE__',
  });

  const reassignedProfile: UserProfile = {
    ...releasedMember,
    orgId: userPatch.orgId as string,
    role: userPatch.role as UserProfile['role'],
    branchId: userPatch.branchId as string | undefined,
    branchIds: userPatch.branchIds as string[] | undefined,
    branchName: userPatch.branchName as string | undefined,
    isActive: userPatch.isActive as boolean,
    isArchived: userPatch.isArchived as boolean | undefined,
    membershipStatus: userPatch.membershipStatus as UserProfile['membershipStatus'],
    permissions: userPatch.permissions as UserProfile['permissions'],
  };

  // Same UID must NOT access previous Org A
  const attemptOrgA = resolveProfiledUserAccess({
    profile: reassignedProfile,
    org: activeOrg,
    authUid: releasedMember.uid,
    now: NOW,
  });
  assert.deepEqual(attemptOrgA, {
    status: 'access_error',
    errorReason: 'permission_denied',
  });

  // Same UID succeeds on new Org B with assigned Org B branch only
  const attemptOrgB = resolveProfiledUserAccess({
    profile: reassignedProfile,
    org: orgB,
    authUid: releasedMember.uid,
    now: NOW,
  });
  assert.equal(attemptOrgB.status, 'active_tenant');
  if (attemptOrgB.status === 'active_tenant') {
    assert.equal(attemptOrgB.org.id, orgB.id);
    assert.equal(resolvePrimaryAssignedBranchId(attemptOrgB.profile), orgBBranch.id);
    assert.equal(canUserAccessBranch(attemptOrgB.profile, orgBBranch.id), true);
    assert.equal(canUserAccessBranch(attemptOrgB.profile, sahabBranch.id), false);
  }
});

test('20. Password reset syncs Firebase Auth languageCode (ar/en/ur) and enforces duplicate-request cooldown', () => {
  const mockAuth: { languageCode?: string | null } = { languageCode: null };
  assert.equal(syncAuthLanguageCode(mockAuth, 'ar'), 'ar');
  assert.equal(mockAuth.languageCode, 'ar');
  assert.equal(syncAuthLanguageCode(mockAuth, 'en'), 'en');
  assert.equal(mockAuth.languageCode, 'en');
  assert.equal(syncAuthLanguageCode(mockAuth, 'ur'), 'ur');
  assert.equal(mockAuth.languageCode, 'ur');

  const t0 = 1_700_000_000_000;
  assert.deepEqual(evaluatePasswordResetCooldown(null, t0), { canSend: true, remainingSeconds: 0 });
  const blocked = evaluatePasswordResetCooldown(t0, t0 + 10_000);
  assert.equal(blocked.canSend, false);
  assert.equal(blocked.remainingSeconds, 35);
  const allowedAgain = evaluatePasswordResetCooldown(t0, t0 + PASSWORD_RESET_COOLDOWN_MS);
  assert.deepEqual(allowedAgain, { canSend: true, remainingSeconds: 0 });
});

test('21. Expired and already-used password reset action codes map to clear trilingual messages', () => {
  const expired = classifyAuthSignInError({ code: 'auth/expired-action-code' });
  const invalid = classifyAuthSignInError({ code: 'auth/invalid-action-code' });
  assert.equal(expired.translationKey, 'authErrExpiredActionCode');
  assert.equal(expired.isResetLinkExpiredOrUsed, true);
  assert.equal(invalid.translationKey, 'authErrInvalidActionCode');
  assert.equal(invalid.isResetLinkExpiredOrUsed, true);

  const resetKeys = [
    'authErrExpiredActionCode',
    'authErrInvalidActionCode',
    'authForgotLinkGuidance',
    'authResetCooldownHint',
    'authResetBackToLogin',
    'subAccessProfileUidMismatchTitle',
    'subAccessProfileUidMismatchDesc',
  ] as const;

  for (const lang of ['ar', 'en', 'ur'] as const) {
    for (const key of resetKeys) {
      const val = (translations[lang] as Record<string, unknown>)[key];
      assert.equal(typeof val, 'string', `Missing ${lang}.${key}`);
      assert.ok((val as string).trim().length > 5, `Empty ${lang}.${key}`);
    }
  }
});

test('22. Cross-organization isolation: active employee of Org A is strictly denied access to Org B', () => {
  const crossOrgAttempt = resolveProfiledUserAccess({
    profile: localMoBranchManagerFixture,
    org: orgB,
    authUid: localMoBranchManagerFixture.uid,
    now: NOW,
  });
  assert.deepEqual(crossOrgAttempt, {
    status: 'access_error',
    errorReason: 'permission_denied',
  });
  assert.equal(
    canRenderTenantDashboard({
      tenantStatus: 'active_tenant',
      hasAuthUser: true,
      userProfile: localMoBranchManagerFixture,
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
