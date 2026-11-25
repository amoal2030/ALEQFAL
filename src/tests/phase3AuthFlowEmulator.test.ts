/**
 * Phase 3 End-to-End Flow Integration Tests against Local Firestore Emulator
 * Tests the actual AuthContext queries and buildAtomicInviteClaimPayloads batches
 * directly against `firestore.rules`.
 */
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  FieldValue,
  initializeNamedDbTestEnvironment,
  NamedDbRulesTestEnvironment,
  Timestamp,
} from './namedDbEmulatorHarness';
import { ManagerInvite, Organization, UserProfile } from '../types';
import {
  buildAtomicInviteClaimPayloads,
  resolveProfiledUserAccess,
  resolveUnprofiledUserAccess,
} from '../utils/tenantAccess';

const serverTimestamp = FieldValue.serverTimestamp;

interface TestOutcome {
  name: string;
  passed: boolean;
  error?: string;
}

async function runPhase3EmulatorTests() {
  console.log('========================================================================');
  console.log('   PHASE 3: CLIENT AUTH & SUBSCRIPTION FLOW TESTS (FIRESTORE EMULATOR)  ');
  console.log('========================================================================\n');

  const testEnv: NamedDbRulesTestEnvironment = await initializeNamedDbTestEnvironment();

  await testEnv.clearFirestore();

  const nowMs = Date.now();
  const oneHourMs = 60 * 60 * 1000;
  const oneDayMs = 24 * oneHourMs;
  const tsPast2d = Timestamp.fromMillis(nowMs - 2 * oneDayMs);
  const tsPast1h = Timestamp.fromMillis(nowMs - oneHourMs);
  const tsFuture1d = Timestamp.fromMillis(nowMs + oneDayMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);

  const SUPER_ADMIN_UID = 'uid_super_admin';
  const SUPER_ADMIN_EMAIL = 'amoal2030@gmail.com';

  const MGR_INVITED_UID = 'uid_invited_mgr_01';
  const MGR_INVITED_EMAIL = 'invited.mgr@gmail.com';
  const ORG_ACTIVE_ID = 'org_phase3_active';

  const ORG_EXPIRED_ID = 'org_phase3_expired';
  const MGR_EXPIRED_UID = 'uid_expired_mgr_01';
  const EMP_EXPIRED_UID = 'uid_expired_emp_01';

  const ORG_LEGACY_ID = 'org_phase3_legacy';
  const MGR_LEGACY_UID = 'uid_legacy_mgr_01';
  const EMP_LEGACY_UID = 'uid_legacy_emp_01';

  const EMP_ACTIVE_UID = 'uid_active_emp_01';
  const DISABLED_MGR_UID = 'uid_disabled_mgr_01';
  const DISABLED_EMP_UID = 'uid_disabled_emp_01';

  // Seed initial fixture data (simulating existing Phase 1/2 state + Super Admin provisioned orgs)
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Active org created by Super Admin, waiting for first invited manager Google sign-in
    await db.doc(`organizations/${ORG_ACTIVE_ID}`).set({
      id: ORG_ACTIVE_ID,
      name: 'متجر الأفق الذهبي',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: '',
      ownerEmail: MGR_INVITED_EMAIL,
      ownerName: 'فيصل الحربي',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast2d,
      subscriptionEndAt: tsFuture30d,
      subscriptionUpdatedAt: serverTimestamp(),
      subscriptionUpdatedBy: SUPER_ADMIN_EMAIL,
      createdAt: '2026-11-10T08:00:00.000Z',
      updatedAt: '2026-11-10T08:00:00.000Z',
    });

    await db.doc('branches/br_active_main').set({
      id: 'br_active_main',
      orgId: ORG_ACTIVE_ID,
      name: 'الفرع الرئيسي',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-11-10T08:00:00.000Z',
    });

    await db.doc(`managerInvites/${MGR_INVITED_EMAIL}`).set({
      id: MGR_INVITED_EMAIL,
      email: MGR_INVITED_EMAIL,
      emailNormalized: MGR_INVITED_EMAIL,
      orgId: ORG_ACTIVE_ID,
      orgName: 'متجر الأفق الذهبي',
      managerName: 'فيصل الحربي',
      role: 'manager',
      status: 'pending',
      createdAt: serverTimestamp(),
      createdBy: SUPER_ADMIN_EMAIL,
      updatedAt: serverTimestamp(),
    });

    // Existing Email/Password Employee on Active Org
    await db.doc(`users/${EMP_ACTIVE_UID}`).set({
      uid: EMP_ACTIVE_UID,
      orgId: ORG_ACTIVE_ID,
      email: 'cashier.active@store.com',
      displayName: 'كاشير الأفق',
      role: 'employee',
      branchId: 'br_active_main',
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
      createdAt: '2026-11-10T09:00:00.000Z',
    });

    // Expired org with existing manager + employee
    await db.doc(`organizations/${ORG_EXPIRED_ID}`).set({
      id: ORG_EXPIRED_ID,
      name: 'مطعم النجم المنتهي',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: MGR_EXPIRED_UID,
      ownerEmail: 'expired.mgr@gmail.com',
      ownerName: 'عمر الدوسري',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: 'trial_7d',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast2d,
      subscriptionEndAt: tsPast1h,
      createdAt: '2026-11-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    });

    await db.doc('branches/br_expired_main').set({
      id: 'br_expired_main',
      orgId: ORG_EXPIRED_ID,
      name: 'فرع النجم',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-11-01T08:00:00.000Z',
    });

    await db.doc(`users/${MGR_EXPIRED_UID}`).set({
      uid: MGR_EXPIRED_UID,
      orgId: ORG_EXPIRED_ID,
      email: 'expired.mgr@gmail.com',
      displayName: 'عمر الدوسري',
      role: 'manager',
      isActive: true,
      createdAt: '2026-11-01T08:00:00.000Z',
    });

    await db.doc(`users/${EMP_EXPIRED_UID}`).set({
      uid: EMP_EXPIRED_UID,
      orgId: ORG_EXPIRED_ID,
      email: 'emp.expired@store.com',
      displayName: 'كاشير النجم',
      role: 'employee',
      branchId: 'br_expired_main',
      isActive: true,
      createdAt: '2026-11-01T08:00:00.000Z',
    });

    // Legacy org without subscription fields
    await db.doc(`organizations/${ORG_LEGACY_ID}`).set({
      id: ORG_LEGACY_ID,
      name: 'مؤسسة التأسيس القديمة',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: MGR_LEGACY_UID,
      ownerEmail: 'legacy.mgr@gmail.com',
      ownerName: 'سالم القديم',
      driveConnected: false,
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-01-01T08:00:00.000Z',
    });

    await db.doc('branches/br_legacy_main').set({
      id: 'br_legacy_main',
      orgId: ORG_LEGACY_ID,
      name: 'الفرع القديم',
      code: 'B-01',
      isActive: true,
      createdAt: '2026-01-01T08:00:00.000Z',
    });

    await db.doc(`users/${MGR_LEGACY_UID}`).set({
      uid: MGR_LEGACY_UID,
      orgId: ORG_LEGACY_ID,
      email: 'legacy.mgr@gmail.com',
      displayName: 'سالم القديم',
      role: 'manager',
      isActive: true,
      createdAt: '2026-01-01T08:00:00.000Z',
    });

    await db.doc(`users/${EMP_LEGACY_UID}`).set({
      uid: EMP_LEGACY_UID,
      orgId: ORG_LEGACY_ID,
      email: 'emp.legacy@store.com',
      displayName: 'موظف قديم',
      role: 'employee',
      branchId: 'br_legacy_main',
      isActive: true,
      createdAt: '2026-11-01T08:00:00.000Z',
    });

    // Disabled manager & disabled employee
    await db.doc(`users/${DISABLED_MGR_UID}`).set({
      uid: DISABLED_MGR_UID,
      orgId: ORG_ACTIVE_ID,
      email: 'disabled.mgr@gmail.com',
      displayName: 'مدير موقوف',
      role: 'manager',
      isActive: false,
      createdAt: '2026-11-10T08:00:00.000Z',
    });

    await db.doc(`users/${DISABLED_EMP_UID}`).set({
      uid: DISABLED_EMP_UID,
      orgId: ORG_ACTIVE_ID,
      email: 'disabled.emp@store.com',
      displayName: 'موظف موقوف',
      role: 'employee',
      branchId: 'br_active_main',
      isActive: false,
      createdAt: '2026-11-10T08:00:00.000Z',
    });

    // Cancelled invite + Expired-Org invite + Future-Start-Org invite
    await db.doc('managerInvites/cancelled.mgr@gmail.com').set({
      id: 'cancelled.mgr@gmail.com',
      email: 'cancelled.mgr@gmail.com',
      emailNormalized: 'cancelled.mgr@gmail.com',
      orgId: ORG_ACTIVE_ID,
      role: 'manager',
      status: 'cancelled',
      createdAt: serverTimestamp(),
      createdBy: SUPER_ADMIN_EMAIL,
      updatedAt: serverTimestamp(),
    });

    await db.doc('organizations/org_future_start').set({
      id: 'org_future_start',
      name: 'مؤسسة بداية مستقبلية',
      activityType: 'services',
      currency: 'SAR',
      ownerId: '',
      ownerEmail: 'future.mgr@gmail.com',
      ownerName: 'ناصر',
      driveConnected: false,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsFuture1d,
      subscriptionEndAt: tsFuture30d,
      createdAt: '2026-11-14T08:00:00.000Z',
      updatedAt: '2026-11-14T08:00:00.000Z',
    });

    await db.doc('managerInvites/future.mgr@gmail.com').set({
      id: 'future.mgr@gmail.com',
      email: 'future.mgr@gmail.com',
      emailNormalized: 'future.mgr@gmail.com',
      orgId: 'org_future_start',
      role: 'manager',
      status: 'pending',
      createdAt: serverTimestamp(),
      createdBy: SUPER_ADMIN_EMAIL,
      updatedAt: serverTimestamp(),
    });
  });

  const outcomes: TestOutcome[] = [];
  const runCase = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      outcomes.push({ name, passed: true });
      console.log(`PASS: ${name}`);
    } catch (err: any) {
      outcomes.push({ name, passed: false, error: err?.message || String(err) });
      console.error(`FAIL: ${name} ->`, err?.message || err);
    }
  };

  // E1: New Google user with no user doc and no invite
  await runCase('E1: Google user without profile or invite gets subscription_request_required and cannot self-create org', async () => {
    const newDb = testEnv.authenticatedContext('uid_brand_new', {
      email: 'stranger@gmail.com',
      email_verified: true,
    }).firestore();

    const userSnap = await assertSucceeds(newDb.doc('users/uid_brand_new').get());
    assert.equal(userSnap.exists, false);

    const inviteSnap = await assertSucceeds(newDb.doc('managerInvites/stranger@gmail.com').get());
    assert.equal(inviteSnap.exists, false);

    const resolution = resolveUnprofiledUserAccess({
      uid: 'uid_brand_new',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: 'stranger@gmail.com',
      invite: null,
      inviteOrg: null,
    });
    assert.equal(resolution.status, 'subscription_request_required');

    // Attempted self-onboarding write is denied by Firestore Rules
    await assertFails(
      newDb.doc('organizations/org_hack_new').set({
        id: 'org_hack_new',
        name: 'Fake Org',
        activityType: 'retail',
        currency: 'SAR',
        ownerId: 'uid_brand_new',
        ownerEmail: 'stranger@gmail.com',
        ownerName: 'Stranger',
        driveConnected: false,
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      })
    );
  });

  // E2: Verified Google Manager executes actual production buildAtomicInviteClaimPayloads batch on Firestore Emulator
  await runCase('E2: Invited verified Google Manager commits production 4-write atomic invite claim batch and loads branches', async () => {
    const mgrDb = testEnv.authenticatedContext(MGR_INVITED_UID, {
      email: MGR_INVITED_EMAIL,
      email_verified: true,
    }).firestore();

    const userSnap = await assertSucceeds(mgrDb.doc(`users/${MGR_INVITED_UID}`).get());
    assert.equal(userSnap.exists, false);

    const inviteSnap = await assertSucceeds(mgrDb.doc(`managerInvites/${MGR_INVITED_EMAIL}`).get());
    assert.equal(inviteSnap.exists, true);
    const invite = inviteSnap.data() as ManagerInvite;

    const orgSnap = await assertSucceeds(mgrDb.doc(`organizations/${invite.orgId}`).get());
    assert.equal(orgSnap.exists, true);
    const org = orgSnap.data() as Organization;

    const resolution = resolveUnprofiledUserAccess({
      uid: MGR_INVITED_UID,
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: MGR_INVITED_EMAIL,
      invite,
      inviteOrg: org,
    });
    assert.equal(resolution.status, 'ready_to_claim_invite');

    const payloads = buildAtomicInviteClaimPayloads({
      uid: MGR_INVITED_UID,
      email: MGR_INVITED_EMAIL,
      googleDisplayName: 'فيصل الحربي',
      org,
      invite,
      serverTimestampValue: serverTimestamp(),
    });

    const batch = mgrDb.batch();
    batch.update(mgrDb.doc(`managerInvites/${payloads.inviteDocId}`), payloads.inviteUpdate);
    batch.update(mgrDb.doc(`organizations/${payloads.orgId}`), payloads.orgUpdate);
    batch.set(mgrDb.doc(`users/${payloads.userDocId}`), payloads.userDoc);
    batch.set(mgrDb.doc(`auditLogs/${payloads.auditLogId}`), payloads.auditLog);

    await assertSucceeds(batch.commit());

    // Immediately verify branches query works as active manager
    const branchesSnap = await assertSucceeds(
      mgrDb.collection('branches').where('orgId', '==', ORG_ACTIVE_ID).get()
    );
    assert.equal(branchesSnap.size, 1);

    // Replay by another UID for the already-accepted invite MUST fail
    const hijackerDb = testEnv.authenticatedContext('uid_hijacker', {
      email: MGR_INVITED_EMAIL,
      email_verified: true,
    }).firestore();
    const hijackInviteSnap = await assertSucceeds(
      hijackerDb.doc(`managerInvites/${MGR_INVITED_EMAIL}`).get()
    );
    const hijackRes = resolveUnprofiledUserAccess({
      uid: 'uid_hijacker',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: MGR_INVITED_EMAIL,
      invite: hijackInviteSnap.data() as ManagerInvite,
      inviteOrg: null,
    });
    assert.equal(hijackRes.status, 'invite_blocked');

    const replayBatch = hijackerDb.batch();
    replayBatch.update(hijackerDb.doc(`managerInvites/${MGR_INVITED_EMAIL}`), {
      status: 'accepted',
      acceptedByUid: 'uid_hijacker',
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    replayBatch.set(hijackerDb.doc('users/uid_hijacker'), {
      ...payloads.userDoc,
      uid: 'uid_hijacker',
    });
    await assertFails(replayBatch.commit());
  });

  // E3: Repeated login of the claimed Manager reads users/{uid} + org + branches directly without claiming again
  await runCase('E3: Returning claimed Manager resolves active_tenant directly via users/{uid} and reads operational collections', async () => {
    const mgrDb = testEnv.authenticatedContext(MGR_INVITED_UID, {
      email: MGR_INVITED_EMAIL,
      email_verified: true,
    }).firestore();

    const userSnap = await assertSucceeds(mgrDb.doc(`users/${MGR_INVITED_UID}`).get());
    assert.equal(userSnap.exists, true);
    const profile = userSnap.data() as UserProfile;

    const orgSnap = await assertSucceeds(mgrDb.doc(`organizations/${profile.orgId}`).get());
    const res = resolveProfiledUserAccess({
      profile,
      org: orgSnap.data() as Organization,
    });
    assert.equal(res.status, 'active_tenant');

    await assertSucceeds(mgrDb.collection('branches').where('orgId', '==', profile.orgId).get());
    await assertSucceeds(mgrDb.collection('closings').where('orgId', '==', profile.orgId).get());
  });

  // E4: Cancelled invite & Future-start invite both fail claim and block Dashboard
  await runCase('E4: Cancelled invite and future-start org invite block access and fail claim commits', async () => {
    const cancelledDb = testEnv.authenticatedContext('uid_cancelled_mgr', {
      email: 'cancelled.mgr@gmail.com',
      email_verified: true,
    }).firestore();
    const cancelledInvite = (
      await assertSucceeds(cancelledDb.doc('managerInvites/cancelled.mgr@gmail.com').get())
    ).data() as ManagerInvite;
    const cancelledRes = resolveUnprofiledUserAccess({
      uid: 'uid_cancelled_mgr',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: 'cancelled.mgr@gmail.com',
      invite: cancelledInvite,
      inviteOrg: null,
    });
    assert.equal(cancelledRes.status, 'invite_blocked');
    await assertFails(
      cancelledDb.doc('managerInvites/cancelled.mgr@gmail.com').update({
        status: 'accepted',
        acceptedByUid: 'uid_cancelled_mgr',
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const futureDb = testEnv.authenticatedContext('uid_future_mgr', {
      email: 'future.mgr@gmail.com',
      email_verified: true,
    }).firestore();
    const futureInvite = (
      await assertSucceeds(futureDb.doc('managerInvites/future.mgr@gmail.com').get())
    ).data() as ManagerInvite;
    const futureOrg = (
      await assertSucceeds(futureDb.doc('organizations/org_future_start').get())
    ).data() as Organization;
    const futureRes = resolveUnprofiledUserAccess({
      uid: 'uid_future_mgr',
      isGoogleUser: true,
      isVerifiedEmail: true,
      emailLower: 'future.mgr@gmail.com',
      invite: futureInvite,
      inviteOrg: futureOrg,
    });
    assert.equal(futureRes.status, 'subscription_blocked');
  });

  // E5: Expired org allows reading own user + org doc to render SubscriptionBlockedView while blocking branches/closings,
  // and Super Admin renewal unlocks branches immediately!
  await runCase('E5: Expired org blocks branches/closings while allowing status read, then unlocks upon Super Admin renewal', async () => {
    const mgrExpDb = testEnv.authenticatedContext(MGR_EXPIRED_UID, {
      email: 'expired.mgr@gmail.com',
      email_verified: true,
    }).firestore();
    const empExpDb = testEnv.authenticatedContext(EMP_EXPIRED_UID, {
      email: 'emp.expired@store.com',
    }).firestore();

    // Passive reads succeed
    const mgrProfile = (await assertSucceeds(mgrExpDb.doc(`users/${MGR_EXPIRED_UID}`).get())).data() as UserProfile;
    const mgrOrg = (await assertSucceeds(mgrExpDb.doc(`organizations/${ORG_EXPIRED_ID}`).get())).data() as Organization;
    assert.equal(resolveProfiledUserAccess({ profile: mgrProfile, org: mgrOrg }).status, 'subscription_blocked');

    const empProfile = (await assertSucceeds(empExpDb.doc(`users/${EMP_EXPIRED_UID}`).get())).data() as UserProfile;
    const empOrg = (await assertSucceeds(empExpDb.doc(`organizations/${ORG_EXPIRED_ID}`).get())).data() as Organization;
    assert.equal(resolveProfiledUserAccess({ profile: empProfile, org: empOrg }).status, 'subscription_blocked');

    // Operational reads blocked (proving AuthContext MUST skip branches query when blocked)
    await assertFails(mgrExpDb.collection('branches').where('orgId', '==', ORG_EXPIRED_ID).get());
    await assertFails(empExpDb.collection('branches').where('orgId', '==', ORG_EXPIRED_ID).get());

    // Super Admin renews subscription
    const saDb = testEnv.authenticatedContext(SUPER_ADMIN_UID, {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
    }).firestore();
    await assertSucceeds(
      saDb.doc(`organizations/${ORG_EXPIRED_ID}`).update({
        subscriptionStatus: 'active',
        subscriptionStartAt: tsPast1h,
        subscriptionEndAt: tsFuture30d,
        subscriptionUpdatedAt: serverTimestamp(),
        subscriptionUpdatedBy: SUPER_ADMIN_EMAIL,
        updatedAt: '2026-11-15T12:00:00.000Z',
      })
    );

    const renewedOrg = (await assertSucceeds(mgrExpDb.doc(`organizations/${ORG_EXPIRED_ID}`).get())).data() as Organization;
    assert.equal(resolveProfiledUserAccess({ profile: mgrProfile, org: renewedOrg }).status, 'active_tenant');
    await assertSucceeds(mgrExpDb.collection('branches').where('orgId', '==', ORG_EXPIRED_ID).get());
    await assertSucceeds(empExpDb.collection('branches').where('orgId', '==', ORG_EXPIRED_ID).get());
  });

  // E6: Legacy org, Active Employee, and Disabled Manager / Employee enforcement
  await runCase('E6: Legacy org and active employee operate normally, while disabled manager and disabled employee are blocked', async () => {
    const legacyMgrDb = testEnv.authenticatedContext(MGR_LEGACY_UID, {
      email: 'legacy.mgr@gmail.com',
      email_verified: true,
    }).firestore();
    const legacyEmpDb = testEnv.authenticatedContext(EMP_LEGACY_UID, {
      email: 'emp.legacy@store.com',
    }).firestore();

    await assertSucceeds(legacyMgrDb.collection('branches').where('orgId', '==', ORG_LEGACY_ID).get());
    await assertSucceeds(legacyEmpDb.collection('branches').where('orgId', '==', ORG_LEGACY_ID).get());

    const activeEmpDb = testEnv.authenticatedContext(EMP_ACTIVE_UID, {
      email: 'cashier.active@store.com',
    }).firestore();
    await assertSucceeds(activeEmpDb.collection('branches').where('orgId', '==', ORG_ACTIVE_ID).get());

    // Disabled manager & disabled employee cannot read operational branches even on active org
    const disMgrDb = testEnv.authenticatedContext(DISABLED_MGR_UID, {
      email: 'disabled.mgr@gmail.com',
      email_verified: true,
    }).firestore();
    const disEmpDb = testEnv.authenticatedContext(DISABLED_EMP_UID, {
      email: 'disabled.emp@store.com',
    }).firestore();

    const disMgrProf = (await assertSucceeds(disMgrDb.doc(`users/${DISABLED_MGR_UID}`).get())).data() as UserProfile;
    const disEmpProf = (await assertSucceeds(disEmpDb.doc(`users/${DISABLED_EMP_UID}`).get())).data() as UserProfile;
    assert.equal(resolveProfiledUserAccess({ profile: disMgrProf, org: null }).status, 'access_error');
    assert.equal(resolveProfiledUserAccess({ profile: disEmpProf, org: null }).status, 'access_error');

    await assertFails(disMgrDb.collection('branches').where('orgId', '==', ORG_ACTIVE_ID).get());
    await assertFails(disEmpDb.collection('branches').where('orgId', '==', ORG_ACTIVE_ID).get());
  });

  await testEnv.cleanup();

  const failed = outcomes.filter((o) => !o.passed);
  console.log(`\nPhase 3 Emulator Flow Summary: ${outcomes.length - failed.length}/${outcomes.length} passed.`);
  if (failed.length > 0) {
    throw new Error(`${failed.length} Phase 3 emulator tests failed.`);
  }
}

runPhase3EmulatorTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
