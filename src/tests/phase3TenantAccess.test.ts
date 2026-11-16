/**
 * Phase 3 Unit Test Suite for Tenant Access Resolution, Invite Claiming,
 * Error Isolation, and Subscription Enforcement (src/utils/tenantAccess.ts)
 */
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import { ManagerInvite, Organization, UserProfile } from '../types';
import { buildNewSubscriptionWhatsApp, buildRenewalSubscriptionWhatsApp } from '../utils/subscription';
import {
  buildAtomicInviteClaimPayloads,
  canRenderTenantDashboard,
  deriveSafeManagerName,
  evaluateFirestoreErrorCategory,
  isGoogleProviderUser,
  isValidNormalizedEmailDocId,
  normalizeEmail,
  resolveProfiledUserAccess,
  resolveUnprofiledUserAccess,
} from '../utils/tenantAccess';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const PAST_2D = Timestamp.fromDate(new Date('2026-11-13T12:00:00.000Z'));
const FUTURE_30D = Timestamp.fromDate(new Date('2026-12-15T12:00:00.000Z'));
const PAST_1H = Timestamp.fromDate(new Date('2026-11-15T11:00:00.000Z'));
const FUTURE_1D = Timestamp.fromDate(new Date('2026-11-16T12:00:00.000Z'));

const activeOrg: Organization = {
  id: 'org_active_01',
  name: 'شركة النخبة التجارية',
  activityType: 'retail',
  currency: 'SAR',
  ownerId: '',
  ownerEmail: 'manager@example.com',
  ownerName: 'أحمد المدير',
  driveConnected: false,
  isActive: true,
  subscriptionPlan: '1m',
  subscriptionStatus: 'active',
  subscriptionStartAt: PAST_2D,
  subscriptionEndAt: FUTURE_30D,
  createdAt: '2026-11-13T12:00:00.000Z',
  updatedAt: '2026-11-13T12:00:00.000Z',
};

const legacyOrg: Organization = {
  id: 'org_legacy_01',
  name: 'مؤسسة قائمة قديمة',
  activityType: 'restaurant',
  currency: 'SAR',
  ownerId: 'uid_legacy_mgr',
  ownerEmail: 'legacy@example.com',
  ownerName: 'خالد القديم',
  driveConnected: false,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

const basePendingInvite: ManagerInvite = {
  id: 'manager@example.com',
  email: 'Manager@Example.com',
  emailNormalized: 'manager@example.com',
  orgId: 'org_active_01',
  orgName: 'شركة النخبة التجارية',
  managerName: 'أحمد المدير',
  role: 'manager',
  status: 'pending',
  createdAt: '2026-11-13T12:00:00.000Z',
  createdBy: 'amoal2030@gmail.com',
  updatedAt: '2026-11-13T12:00:00.000Z',
};

const baseManagerProfile: UserProfile = {
  uid: 'uid_mgr_01',
  orgId: 'org_active_01',
  email: 'manager@example.com',
  displayName: 'أحمد المدير',
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
  createdAt: '2026-11-13T12:00:00.000Z',
};

const baseEmployeeProfile: UserProfile = {
  uid: 'uid_emp_01',
  orgId: 'org_active_01',
  email: 'emp@example.com',
  displayName: 'موظف الصندوق',
  role: 'employee',
  branchId: 'br_01',
  branchName: 'الفرع الرئيسي',
  isActive: true,
  permissions: {
    canCreateClosing: true,
    canViewAllClosings: false,
    canApproveClosings: false,
    canManageBranches: false,
    canManageEmployees: false,
    canExportReports: false,
  },
  createdAt: '2026-11-13T12:00:00.000Z',
};

function runTests() {
  let passed = 0;
  const test = (name: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`✔ ${name}`);
  };

  // Scenario 1: Google login with no user doc and no invite -> subscription_request_required
  test('Scenario 1: Verified Google user without profile or invite routes to subscription_request_required', () => {
    const res = resolveUnprofiledUserAccess({
      uid: 'uid_new_google',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: normalizeEmail('NewOwner@Gmail.com '),
      invite: null,
      inviteOrg: null,
      now: NOW,
    });
    assert.equal(res.status, 'subscription_request_required');
  });

  // Scenario 2: SubscriptionRequestView WhatsApp link preparation
  test('Scenario 2: New subscription WhatsApp preparation encodes plan, owner, email, orgName', () => {
    const link = buildNewSubscriptionWhatsApp({
      ownerName: 'سعد القحطاني',
      googleEmail: 'saad@gmail.com',
      orgName: 'أسواق الريادة',
      plan: '3m',
      language: 'ar',
    });
    assert.ok(link.url.startsWith('https://wa.me/966541821068?text='));
    assert.ok(link.message.includes('سعد القحطاني'));
    assert.ok(link.message.includes('saad@gmail.com'));
    assert.ok(link.message.includes('أسواق الريادة'));
    assert.ok(link.message.includes('3 أشهر'));
  });

  // Scenario 3: Valid pending invite + active org -> ready_to_claim_invite + compliant 4-write batch payloads
  test('Scenario 3: Pending invite with active org resolves ready_to_claim_invite and builds exact 4-doc atomic batch', () => {
    const res = resolveUnprofiledUserAccess({
      uid: 'uid_mgr_01',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: 'manager@example.com',
      invite: basePendingInvite,
      inviteOrg: activeOrg,
      now: NOW,
    });
    assert.equal(res.status, 'ready_to_claim_invite');

    const sentinel = { _methodName: 'serverTimestamp' };
    const payloads = buildAtomicInviteClaimPayloads({
      uid: 'uid_mgr_01',
      email: 'Manager@Example.com',
      googleDisplayName: 'A', // short 1-char name shouldn't break actorName >= 2 rule
      org: activeOrg,
      invite: basePendingInvite,
      serverTimestampValue: sentinel,
      now: NOW,
    });

    assert.equal(payloads.inviteDocId, 'manager@example.com');
    assert.deepEqual(Object.keys(payloads.inviteUpdate).sort(), [
      'acceptedAt',
      'acceptedByUid',
      'status',
      'updatedAt',
    ]);
    assert.equal(payloads.inviteUpdate.status, 'accepted');
    assert.equal(payloads.inviteUpdate.acceptedByUid, 'uid_mgr_01');
    assert.equal(payloads.inviteUpdate.acceptedAt, sentinel);
    assert.equal(payloads.inviteUpdate.updatedAt, sentinel);

    assert.deepEqual(Object.keys(payloads.orgUpdate).sort(), [
      'ownerId',
      'ownerName',
      'updatedAt',
    ]);
    assert.equal(payloads.orgUpdate.ownerId, 'uid_mgr_01');
    assert.ok(payloads.orgUpdate.ownerName.length >= 2 && payloads.orgUpdate.ownerName.length <= 100);

    assert.deepEqual(Object.keys(payloads.userDoc).sort(), [
      'createdAt',
      'displayName',
      'email',
      'isActive',
      'orgId',
      'permissions',
      'role',
      'uid',
    ]);
    assert.equal(payloads.userDoc.role, 'manager');
    assert.equal(payloads.userDoc.isActive, true);
    assert.equal(payloads.userDoc.orgId, 'org_active_01');

    assert.equal(payloads.auditLog.action, 'ORGANIZATION_ESTABLISHED');
    assert.equal(payloads.auditLog.targetType, 'organization');
    assert.equal(payloads.auditLog.targetId, 'org_active_01');
    assert.ok(payloads.auditLog.actorName.length >= 2);
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(payloads.auditLogId));
  });

  // Scenario 4: Repeated login after claim enters Dashboard directly via users/{uid}
  test('Scenario 4: Returning Manager with existing profile & claimed org enters active_tenant directly', () => {
    const claimedOrg: Organization = { ...activeOrg, ownerId: 'uid_mgr_01' };
    const res = resolveProfiledUserAccess({
      profile: baseManagerProfile,
      org: claimedOrg,
      now: NOW,
    });
    assert.equal(res.status, 'active_tenant');
    if (res.status === 'active_tenant') {
      assert.equal(
        canRenderTenantDashboard({
          tenantStatus: 'active_tenant',
          hasAuthUser: true,
          userProfile: res.profile,
          currentOrg: res.org,
          subscriptionEvaluation: res.subscriptionEvaluation,
        }),
        true
      );
    }
  });

  // Scenario 5: Cancelled invite -> invite_blocked ('cancelled')
  test('Scenario 5: Cancelled invite blocks onboarding and routes to invite_blocked', () => {
    const cancelledInvite: ManagerInvite = { ...basePendingInvite, status: 'cancelled' };
    const res = resolveUnprofiledUserAccess({
      uid: 'uid_mgr_01',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: 'manager@example.com',
      invite: cancelledInvite,
      inviteOrg: activeOrg,
      now: NOW,
    });
    assert.equal(res.status, 'invite_blocked');
    if (res.status === 'invite_blocked') {
      assert.equal(res.inviteBlockReason, 'cancelled');
    }
  });

  // Scenario 6: Already accepted invite (no user doc for caller UID) -> invite_blocked ('accepted')
  test('Scenario 6: Accepted invite blocks second UID and routes to invite_blocked', () => {
    const acceptedInvite: ManagerInvite = {
      ...basePendingInvite,
      status: 'accepted',
      acceptedByUid: 'uid_other',
    };
    const res = resolveUnprofiledUserAccess({
      uid: 'uid_second_user',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: 'manager@example.com',
      invite: acceptedInvite,
      inviteOrg: activeOrg,
      now: NOW,
    });
    assert.equal(res.status, 'invite_blocked');
    if (res.status === 'invite_blocked') {
      assert.equal(res.inviteBlockReason, 'accepted');
    }
  });

  // Scenario 7: Pending invite for expired / suspended / not-started org -> subscription_blocked (no claim)
  test('Scenario 7: Pending invite with expired, suspended, or not-started org transitions to subscription_blocked without claiming', () => {
    const expiredOrg: Organization = { ...activeOrg, subscriptionEndAt: PAST_1H };
    const resExp = resolveUnprofiledUserAccess({
      uid: 'uid_mgr_01',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: 'manager@example.com',
      invite: basePendingInvite,
      inviteOrg: expiredOrg,
      now: NOW,
    });
    assert.equal(resExp.status, 'subscription_blocked');
    if (resExp.status === 'subscription_blocked') {
      assert.equal(resExp.blockReason, 'expired');
    }

    const suspendedOrg: Organization = { ...activeOrg, subscriptionStatus: 'suspended' };
    const resSusp = resolveUnprofiledUserAccess({
      uid: 'uid_mgr_01',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: 'manager@example.com',
      invite: basePendingInvite,
      inviteOrg: suspendedOrg,
      now: NOW,
    });
    assert.equal(resSusp.status, 'subscription_blocked');
    if (resSusp.status === 'subscription_blocked') {
      assert.equal(resSusp.blockReason, 'suspended');
    }

    const futureStartOrg: Organization = { ...activeOrg, subscriptionStartAt: FUTURE_1D };
    const resFuture = resolveUnprofiledUserAccess({
      uid: 'uid_mgr_01',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: 'manager@example.com',
      invite: basePendingInvite,
      inviteOrg: futureStartOrg,
      now: NOW,
    });
    assert.equal(resFuture.status, 'subscription_blocked');
    if (resFuture.status === 'subscription_blocked') {
      assert.equal(resFuture.blockReason, 'not_started');
    }
  });

  // Scenario 8 & 9: Expired org Manager vs Employee resolution + renewal WhatsApp
  test('Scenario 8 & 9: Expired org blocks Manager and Employee from Dashboard cleanly & prepares renewal WhatsApp for Manager', () => {
    const expiredOrg: Organization = {
      ...activeOrg,
      ownerId: 'uid_mgr_01',
      subscriptionEndAt: PAST_1H,
    };
    const mgrRes = resolveProfiledUserAccess({ profile: baseManagerProfile, org: expiredOrg, now: NOW });
    assert.equal(mgrRes.status, 'subscription_blocked');
    if (mgrRes.status === 'subscription_blocked') {
      assert.equal(mgrRes.blockReason, 'expired');
      assert.equal(
        canRenderTenantDashboard({
          tenantStatus: 'subscription_blocked',
          hasAuthUser: true,
          userProfile: mgrRes.profile,
          currentOrg: mgrRes.org,
          subscriptionEvaluation: mgrRes.subscriptionEvaluation,
        }),
        false
      );
    }

    const empRes = resolveProfiledUserAccess({ profile: baseEmployeeProfile, org: expiredOrg, now: NOW });
    assert.equal(empRes.status, 'subscription_blocked');

    const renewal = buildRenewalSubscriptionWhatsApp({
      orgName: expiredOrg.name,
      orgId: expiredOrg.id,
      managerName: baseManagerProfile.displayName,
      managerEmail: baseManagerProfile.email,
      plan: '6m',
      currentEndAt: expiredOrg.subscriptionEndAt,
      language: 'ar',
    });
    assert.ok(renewal.url.startsWith('https://wa.me/966541821068?text='));
    assert.ok(renewal.message.includes('6 أشهر'));
    assert.ok(renewal.message.includes(expiredOrg.id));
  });

  // Scenario 10: Suspended org preserves note & blocks access
  test('Scenario 10: Suspended org resolves to subscription_blocked with suspended reason', () => {
    const suspendedOrg: Organization = {
      ...activeOrg,
      ownerId: 'uid_mgr_01',
      subscriptionStatus: 'suspended',
      subscriptionNote: 'مراجعة إدارية للفوترة',
    };
    const res = resolveProfiledUserAccess({ profile: baseManagerProfile, org: suspendedOrg, now: NOW });
    assert.equal(res.status, 'subscription_blocked');
    if (res.status === 'subscription_blocked') {
      assert.equal(res.blockReason, 'suspended');
      assert.equal(res.org.subscriptionNote, 'مراجعة إدارية للفوترة');
    }
  });

  // Scenario 11: Renewal restores active_tenant & Dashboard access
  test('Scenario 11: Updating suspended/expired org back to active future endAt unlocks active_tenant', () => {
    const renewedOrg: Organization = {
      ...activeOrg,
      ownerId: 'uid_mgr_01',
      subscriptionStatus: 'active',
      subscriptionStartAt: PAST_2D,
      subscriptionEndAt: FUTURE_30D,
      isActive: true,
    };
    const res = resolveProfiledUserAccess({ profile: baseManagerProfile, org: renewedOrg, now: NOW });
    assert.equal(res.status, 'active_tenant');
    if (res.status === 'active_tenant') {
      assert.equal(res.subscriptionEvaluation.isAllowed, true);
      assert.equal(
        canRenderTenantDashboard({
          tenantStatus: 'active_tenant',
          hasAuthUser: true,
          userProfile: res.profile,
          currentOrg: res.org,
          subscriptionEvaluation: res.subscriptionEvaluation,
        }),
        true
      );
    }
  });

  // Scenario 12: Legacy organization manager & employee unaffected
  test('Scenario 12: Legacy organization without subscription fields resolves active_tenant (legacy_unrestricted)', () => {
    const legacyMgr: UserProfile = { ...baseManagerProfile, uid: 'uid_legacy_mgr', orgId: legacyOrg.id };
    const legacyEmp: UserProfile = { ...baseEmployeeProfile, uid: 'uid_legacy_emp', orgId: legacyOrg.id };

    const resMgr = resolveProfiledUserAccess({ profile: legacyMgr, org: legacyOrg, now: NOW });
    const resEmp = resolveProfiledUserAccess({ profile: legacyEmp, org: legacyOrg, now: NOW });

    assert.equal(resMgr.status, 'active_tenant');
    assert.equal(resEmp.status, 'active_tenant');
    if (resMgr.status === 'active_tenant') {
      assert.equal(resMgr.subscriptionEvaluation.state, 'legacy_unrestricted');
      assert.equal(resMgr.subscriptionEvaluation.isLegacy, true);
    }
  });

  // Scenario 13: Email/password Employee in active org enters normally; missing employee profile NEVER routes to SubscriptionRequestView
  test('Scenario 13: Active employee resolves active_tenant, while unprofiled password user is blocked as missing_employee_profile', () => {
    const empRes = resolveProfiledUserAccess({
      profile: baseEmployeeProfile,
      org: { ...activeOrg, ownerId: 'uid_mgr_01' },
      now: NOW,
    });
    assert.equal(empRes.status, 'active_tenant');

    const unprofiledEmp = resolveUnprofiledUserAccess({
      uid: 'uid_unknown_emp',
      isGoogleUser: false,
      isVerifiedEmail: false,
      emailLower: 'cashier@example.com',
      invite: basePendingInvite, // even if an invite existed, password login cannot claim it
      inviteOrg: activeOrg,
      now: NOW,
    });
    assert.equal(unprofiledEmp.status, 'access_error');
    if (unprofiledEmp.status === 'access_error') {
      assert.equal(unprofiledEmp.errorReason, 'missing_employee_profile');
    }
  });

  // Scenario 14: Disabled Employee OR Disabled Manager -> account_disabled
  test('Scenario 14: Disabled Manager and Disabled Employee are both blocked with account_disabled', () => {
    const disabledEmp: UserProfile = { ...baseEmployeeProfile, isActive: false };
    const disabledMgr: UserProfile = { ...baseManagerProfile, isActive: false };

    const resEmp = resolveProfiledUserAccess({ profile: disabledEmp, org: activeOrg, now: NOW });
    const resMgr = resolveProfiledUserAccess({ profile: disabledMgr, org: activeOrg, now: NOW });

    assert.equal(resEmp.status, 'access_error');
    assert.equal(resMgr.status, 'access_error');
    if (resEmp.status === 'access_error' && resMgr.status === 'access_error') {
      assert.equal(resEmp.errorReason, 'account_disabled');
      assert.equal(resMgr.errorReason, 'account_disabled');
    }
  });

  // Scenario 15: Permission denied, network error, unverified Google email, and helper edge cases
  test('Scenario 15: Unverified email, permission-denied, and network errors never fall back to SubscriptionRequestView', () => {
    const unverifiedGoogle = resolveUnprofiledUserAccess({
      uid: 'uid_unverified',
      isGoogleUser: true,
      isVerifiedEmail: false,
      emailLower: 'unverified@gmail.com',
      invite: null,
      inviteOrg: null,
      now: NOW,
    });
    assert.equal(unverifiedGoogle.status, 'access_error');
    if (unverifiedGoogle.status === 'access_error') {
      assert.equal(unverifiedGoogle.errorReason, 'email_not_verified');
    }

    assert.equal(evaluateFirestoreErrorCategory({ code: 'permission-denied' }), 'permission_denied');
    assert.equal(
      evaluateFirestoreErrorCategory({ message: 'Missing or insufficient permissions.' }),
      'permission_denied'
    );
    assert.equal(evaluateFirestoreErrorCategory({ code: 'unavailable' }), 'network_error');

    assert.equal(isValidNormalizedEmailDocId('user@gmail.com'), true);
    assert.equal(isValidNormalizedEmailDocId('invalid-email'), false);
    assert.equal(
      isGoogleProviderUser({ providerData: [{ providerId: 'google.com' }] }),
      true
    );
    assert.equal(
      isGoogleProviderUser({ providerData: [{ providerId: 'password' }] }),
      false
    );

    const safeShort = deriveSafeManagerName({
      inviteManagerName: '',
      orgOwnerName: ' ',
      googleDisplayName: 'X',
      emailLower: 'a@b.com',
    });
    assert.ok(safeShort.length >= 2 && safeShort.length <= 100);
  });

  console.log(`\nALL ${passed} PHASE 3 TENANT ACCESS UNIT TESTS PASSED.`);
}

runTests();
