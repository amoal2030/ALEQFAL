/**
 * Local Unit & Simulation Tests — Employee Auth UID Rebind Preparation (AL EQFAL)
 *
 * Strictly local synthetic fixtures ONLY (ZERO production writes, ZERO live Firebase calls):
 *  1. Code alignment audit: verifies `validateLoadedUserProfileBinding`, `detectProfileUidBindingDiagnostics`,
 *     `resolveUnprofiledUserAccess`, `resolveProfiledUserAccess`, and `AuthContext.tsx` (`performLoadUserData`
 *     + read-only `inspectEmployeeUidBindingDiagnostic`) have zero conflicts.
 *  2. Read-only Super Admin diagnostic report (`buildEmployeeUidDiagnosticReport`):
 *     - Exclusive to verified `amoal2030@gmail.com` (non-Super Admin & unverified Super Admin rejected).
 *     - Never leaks unrelated employees' records.
 *     - Accurately distinguishes Current Auth UID, Firestore Doc ID, and stored `uid` field.
 *     - Explicitly reports Firebase Console Auth verification requirement for legacy UID.
 *  3. Local Rebind Planner & Simulator (`buildEmployeeAuthUidRebindPlan` + `simulateEmployeeAuthUidRebind`):
 *     - Preserves Auth UID (`UnadIrNfoNeBdzTjfVMJJjTJIMR2`) without deleting/creating Auth accounts.
 *     - Preserves email (`mo100100050@gmail.com`), org, branch `سحاب 1 (3)`, role `branch_manager`, permissions.
 *     - Preserves & archives old doc (`users/7aXYPLvRaCeuML8kf7XKal8sVOp2`), NEVER deletes it.
 *     - Guarantees strictly 1 active profile for the person (no duplicate active employee docs).
 *     - Guarantees ZERO deletion or mutation of historical `closings`, `purchases`, `auditLogs`,
 *       `platformAuditLogs` (append-only +2 entries), `memberOrgHistory`, `notifications`.
 *     - Blocks non-Super Admin, unverified Super Admin, privilege escalation, cross-org movement,
 *       overwriting an existing target Auth UID doc, or active different-employee Auth conflict.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import {
  detectProfileDocIdUidMismatches,
  detectProfileUidBindingDiagnostics,
  validateLoadedUserProfileBinding,
} from '../utils/authCredentials';
import {
  resolveProfiledUserAccess,
  resolveUnprofiledUserAccess,
} from '../utils/tenantAccess';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import {
  buildEmployeeAuthUidRebindPlan,
  buildEmployeeUidDiagnosticReport,
  RebindSimulationState,
  simulateEmployeeAuthUidRebind,
} from '../utils/employeeUidRebind';
import { Branch, Organization, UserProfile } from '../types';

const CURRENT_AUTH_UID = 'UnadIrNfoNeBdzTjfVMJJjTJIMR2';
const LEGACY_DOC_UID = '7aXYPLvRaCeuML8kf7XKal8sVOp2';
const TARGET_EMAIL = 'mo100100050@gmail.com';
const SUPER_ADMIN_ACTOR = {
  uid: 'sa_root_uid',
  email: 'amoal2030@gmail.com',
  emailVerified: true,
  displayName: 'المدير الرئيسي',
};

const syntheticOrg: Organization = {
  id: 'org_sahab_sim',
  name: 'مؤسسة سحاب الاختبارية',
  activityType: 'retail',
  currency: 'SAR',
  ownerId: 'owner_sahab_uid',
  ownerEmail: 'owner@sahab.example.com',
  ownerName: 'مالك المؤسسة',
  driveConnected: true,
  isActive: true,
  subscriptionPlan: '1y',
  subscriptionStatus: 'active',
  subscriptionStartAt: '2026-01-01T00:00:00.000Z',
  subscriptionEndAt: '2027-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const syntheticSahabBranch: Branch = {
  id: 'branch_sahab_1_3',
  orgId: syntheticOrg.id,
  name: 'سحاب 1 (3)',
  code: 'SHB3',
  isActive: true,
  lifecycleStatus: 'active',
  paymentStatus: 'paid',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const syntheticOtherBranch: Branch = {
  id: 'branch_sahab_2',
  orgId: syntheticOrg.id,
  name: 'سحاب 2',
  code: 'SHB2',
  isActive: true,
  lifecycleStatus: 'active',
  paymentStatus: 'paid',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const syntheticForeignBranch: Branch = {
  id: 'branch_foreign_org_b',
  orgId: 'org_other_b',
  name: 'فرع مؤسسة أخرى',
  code: 'OTH1',
  isActive: true,
  lifecycleStatus: 'active',
  paymentStatus: 'paid',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const syntheticLegacyProfile: UserProfile = {
  uid: LEGACY_DOC_UID,
  firestoreDocId: LEGACY_DOC_UID,
  orgId: syntheticOrg.id,
  email: TARGET_EMAIL,
  displayName: 'محمد فيصل',
  role: 'branch_manager',
  branchId: syntheticSahabBranch.id,
  branchIds: [syntheticSahabBranch.id],
  branchName: syntheticSahabBranch.name,
  phone: '0500000001',
  isActive: true,
  isArchived: false,
  membershipStatus: 'active',
  permissions: buildDefaultPermissionsForRole('branch_manager'),
  createdAt: '2026-02-01T08:00:00.000Z',
  updatedAt: '2026-02-01T08:00:00.000Z',
};

const unrelatedEmployee: UserProfile = {
  uid: 'unrelated_emp_uid_999',
  firestoreDocId: 'unrelated_emp_uid_999',
  orgId: 'org_other_b',
  email: 'other.employee@example.com',
  displayName: 'موظف مؤسسة أخرى',
  role: 'employee',
  branchId: syntheticForeignBranch.id,
  branchName: syntheticForeignBranch.name,
  isActive: true,
  isArchived: false,
  membershipStatus: 'active',
  permissions: buildDefaultPermissionsForRole('employee'),
  createdAt: '2026-02-01T08:00:00.000Z',
};

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

console.log('\n🧪 Employee Auth UID Rebind Preparation & Simulation Suite (Local Only)\n');

// 1. Code Alignment & Zero-Conflict Audit
test('1. validateLoadedUserProfileBinding, resolveUnprofiledUserAccess & resolveProfiledUserAccess are 100% consistent', () => {
  // Missing profile for Current Auth UID (the exact pre-rebind failure state)
  const missingBinding = validateLoadedUserProfileBinding({
    authUid: CURRENT_AUTH_UID,
    docId: CURRENT_AUTH_UID,
    docExists: false,
    rawProfile: null,
  });
  assert.equal(missingBinding.status, 'missing_profile');
  assert.equal(missingBinding.reason, 'missing_employee_profile');

  const unprofiledResolution = resolveUnprofiledUserAccess({
    uid: CURRENT_AUTH_UID,
    isGoogleUser: false,
    isVerifiedEmail: false,
    emailLower: TARGET_EMAIL,
    invite: null,
    inviteOrg: null,
  });
  assert.equal(unprofiledResolution.status, 'access_error');
  if (unprofiledResolution.status === 'access_error') {
    assert.equal(unprofiledResolution.errorReason, 'missing_employee_profile');
  }

  // Corrupted doc under CURRENT_AUTH_UID whose stored uid field is LEGACY_DOC_UID
  const mismatchBinding = validateLoadedUserProfileBinding({
    authUid: CURRENT_AUTH_UID,
    docId: CURRENT_AUTH_UID,
    docExists: true,
    rawProfile: { ...syntheticLegacyProfile, uid: LEGACY_DOC_UID },
  });
  assert.equal(mismatchBinding.status, 'uid_mismatch');
  assert.equal(mismatchBinding.reason, 'profile_uid_mismatch');

  const profiledMismatch = resolveProfiledUserAccess({
    profile: { ...syntheticLegacyProfile, uid: LEGACY_DOC_UID, firestoreDocId: CURRENT_AUTH_UID },
    org: syntheticOrg,
    authUid: CURRENT_AUTH_UID,
  });
  assert.equal(profiledMismatch.status, 'access_error');
  if (profiledMismatch.status === 'access_error') {
    assert.equal(profiledMismatch.errorReason, 'profile_uid_mismatch');
  }

  // Unified diagnostics detect both doc_id_uid_mismatch and missing_uid_field identically
  const diagA = detectProfileUidBindingDiagnostics([
    { docId: CURRENT_AUTH_UID, uid: LEGACY_DOC_UID, displayName: 'محمد فيصل', email: TARGET_EMAIL, orgId: syntheticOrg.id },
    { docId: 'doc_no_uid', uid: '', displayName: 'No UID', email: 'nouid@example.com', orgId: syntheticOrg.id },
    { docId: LEGACY_DOC_UID, uid: LEGACY_DOC_UID, displayName: 'Clean', email: 'clean@example.com', orgId: syntheticOrg.id },
  ]);
  assert.equal(diagA.length, 2);
  assert.equal(diagA[0].issueType, 'doc_id_uid_mismatch');
  assert.equal(diagA[1].issueType, 'missing_uid_field');

  const diagB = detectProfileDocIdUidMismatches([
    { ...syntheticLegacyProfile, firestoreDocId: CURRENT_AUTH_UID, uid: LEGACY_DOC_UID },
    { ...syntheticLegacyProfile, firestoreDocId: 'doc_no_uid', uid: '' },
    syntheticLegacyProfile,
  ]);
  assert.equal(diagB.length, 2);
  assert.equal(diagB[0].docId, CURRENT_AUTH_UID);
  assert.equal(diagB[1].storedUid, '(missing)');
});

test('2. AuthContext.tsx static audit: performLoadUserData uses validateLoadedUserProfileBinding & inspectEmployeeUidBindingDiagnostic is strictly read-only', () => {
  const authCtxPath = path.resolve(process.cwd(), 'src/context/AuthContext.tsx');
  const src = fs.readFileSync(authCtxPath, 'utf8');

  // performLoadUserData uses validateLoadedUserProfileBinding and passes authUid to resolveProfiledUserAccess
  assert.ok(
    src.includes('const bindingResult = validateLoadedUserProfileBinding('),
    'performLoadUserData must use validateLoadedUserProfileBinding'
  );
  assert.ok(
    src.includes('authUid: fbUser.uid,'),
    'performLoadUserData must pass authUid to resolveProfiledUserAccess'
  );

  // Extract inspectEmployeeUidBindingDiagnostic body and verify ZERO writes
  const startIdx = src.indexOf('const inspectEmployeeUidBindingDiagnostic:');
  assert.ok(startIdx > 0, 'inspectEmployeeUidBindingDiagnostic must exist in AuthContext.tsx');
  const endIdx = src.indexOf('const logout = async', startIdx);
  assert.ok(endIdx > startIdx);
  const body = src.slice(startIdx, endIdx);

  assert.ok(
    body.includes('assertAuthorizedSuperAdmin()'),
    'inspectEmployeeUidBindingDiagnostic must enforce assertAuthorizedSuperAdmin()'
  );
  assert.ok(
    !/\b(setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|addDoc)\s*\(/.test(body),
    'inspectEmployeeUidBindingDiagnostic must NEVER execute any Firestore write operation'
  );
  assert.ok(
    !/\b(localStorage|sessionStorage)\s*\./.test(src),
    'AuthContext.tsx must never touch localStorage or sessionStorage'
  );
});

// 2. Read-Only Super Admin Diagnostic Report Tests
test('3. Read-only diagnostic report rejects non-Super Admin and unverified Super Admin', () => {
  assert.throws(() =>
    buildEmployeeUidDiagnosticReport({
      actor: { uid: 'mgr_1', email: 'manager@example.com', emailVerified: true },
      targetAuthUid: CURRENT_AUTH_UID,
      legacyDocId: LEGACY_DOC_UID,
      targetAuthUidDoc: null,
      legacyDoc: { docId: LEGACY_DOC_UID, data: syntheticLegacyProfile },
    })
  );

  assert.throws(() =>
    buildEmployeeUidDiagnosticReport({
      actor: { uid: 'sa_unverified', email: 'amoal2030@gmail.com', emailVerified: false },
      targetAuthUid: CURRENT_AUTH_UID,
      legacyDocId: LEGACY_DOC_UID,
      targetAuthUidDoc: null,
      legacyDoc: { docId: LEGACY_DOC_UID, data: syntheticLegacyProfile },
    })
  );
});

test('4. Read-only diagnostic report returns targeted fields only, filters unrelated employees, and flags Firebase Console Auth check', () => {
  const report = buildEmployeeUidDiagnosticReport({
    actor: SUPER_ADMIN_ACTOR,
    targetAuthUid: CURRENT_AUTH_UID,
    legacyDocId: LEGACY_DOC_UID,
    email: TARGET_EMAIL,
    targetAuthUidDoc: null,
    legacyDoc: { docId: LEGACY_DOC_UID, data: syntheticLegacyProfile },
    // Intentionally pass an unrelated employee to prove strict scoping filters it out
    emailMatchedDocs: [
      { docId: LEGACY_DOC_UID, data: syntheticLegacyProfile },
      { docId: unrelatedEmployee.uid, data: unrelatedEmployee },
    ],
    uidFieldMatchedDocs: [
      { docId: LEGACY_DOC_UID, data: syntheticLegacyProfile },
      { docId: unrelatedEmployee.uid, data: unrelatedEmployee },
    ],
    org: syntheticOrg,
    branches: [syntheticSahabBranch, syntheticOtherBranch],
  });

  assert.equal(report.readOnlyMode, true);
  assert.equal(report.requestedTargetAuthUid, CURRENT_AUTH_UID);
  assert.equal(report.targetAuthUidDocExists, false);
  assert.equal(report.legacyDocExists, true);
  assert.equal(report.legacyDoc?.docId, LEGACY_DOC_UID);
  assert.equal(report.legacyDoc?.storedUid, LEGACY_DOC_UID);
  assert.equal(report.legacyDoc?.docIdMatchesStoredUid, true);
  assert.equal(report.legacyDoc?.orgId, syntheticOrg.id);
  assert.equal(report.legacyDoc?.branchId, syntheticSahabBranch.id);
  assert.deepEqual(report.legacyDoc?.branchIds, [syntheticSahabBranch.id]);
  assert.equal(report.legacyDoc?.role, 'branch_manager');
  assert.equal(report.legacyDoc?.isActive, true);
  assert.equal(report.legacyDoc?.isArchived, false);
  assert.equal(report.legacyDoc?.membershipStatus, 'active');

  // Unrelated employee MUST NOT appear in report
  assert.equal(report.emailMatchedDocs.length, 1);
  assert.equal(report.emailMatchedDocs[0].docId, LEGACY_DOC_UID);
  assert.equal(report.uidFieldMatchedDocs.length, 1);
  assert.equal(report.uidFieldMatchedDocs[0].docId, LEGACY_DOC_UID);

  // Explicit Auth Console check boundary
  assert.equal(report.legacyUidAuthAccountCheck.status, 'requires_firebase_console_auth_check');
  assert.equal(report.legacyUidAuthAccountCheck.clientSdkCanInspectOtherAuthUsers, false);
  assert.equal(report.readinessAssessment.canProceedAfterConsoleAuthVerification, true);
});

// 3. Rebind Plan & Full Local In-Memory Simulation Tests
test('5. Full local rebind simulation preserves Auth UID, email, org, branch سحاب 1 (3), role, permissions, and 100% of historical records', () => {
  const plan = buildEmployeeAuthUidRebindPlan({
    actor: SUPER_ADMIN_ACTOR,
    targetAuthUid: CURRENT_AUTH_UID,
    targetAuthUidDocExists: false,
    legacyDocId: LEGACY_DOC_UID,
    legacyProfile: syntheticLegacyProfile,
    org: syntheticOrg,
    orgBranches: [syntheticSahabBranch, syntheticOtherBranch],
    legacyUidAuthVerification: 'confirmed_unused_or_same_person',
    reason: 'ربط Auth UID الحالي لمحمد فيصل بوثيقته الوظيفية دون فقدان أي سجل تاريخي',
    now: new Date('2026-05-01T10:00:00.000Z'),
    archiveAuditLogId: 'pal_rebind_archive_001',
    createAuditLogId: 'pal_rebind_create_002',
  });

  assert.equal(plan.dryRunOnly, true);
  assert.equal(plan.requiresConsoleAuthVerificationBeforeProduction, false);
  assert.equal(plan.mandatoryInvariants.deletesFirebaseAuthAccount, false);
  assert.equal(plan.mandatoryInvariants.createsFirebaseAuthAccount, false);
  assert.equal(plan.mandatoryInvariants.deletesLegacyEmployeeDoc, false);
  assert.equal(plan.mandatoryInvariants.mutatesOrDeletesHistoricalRecords, false);
  assert.equal(plan.mandatoryInvariants.changesEmail, false);
  assert.equal(plan.mandatoryInvariants.changesOrgOrBranchOrRoleOrPermissions, false);
  assert.equal(plan.mandatoryInvariants.bypassesOrgIsolation, false);

  const initialState: RebindSimulationState = {
    users: {
      [LEGACY_DOC_UID]: syntheticLegacyProfile,
      [unrelatedEmployee.uid]: unrelatedEmployee,
    },
    closings: {
      closing_hist_1: {
        id: 'closing_hist_1',
        orgId: syntheticOrg.id,
        branchId: syntheticSahabBranch.id,
        branchName: syntheticSahabBranch.name,
        employeeId: LEGACY_DOC_UID,
        employeeName: 'محمد فيصل',
        date: '2026-04-20',
        period: 'evening',
        cashSales: 1200,
        cardSales: 2500,
        totalSales: 3700,
        expenses: 150,
        remainingInBox: 1050,
        netPeriod: 3550,
        attachmentIds: [],
        status: 'approved',
        createdAt: '2026-04-20T22:00:00.000Z',
        updatedAt: '2026-04-20T22:15:00.000Z',
      },
    },
    purchases: {
      purchase_hist_1: {
        id: 'purchase_hist_1',
        orgId: syntheticOrg.id,
        branchId: syntheticSahabBranch.id,
        branchName: syntheticSahabBranch.name,
        supplierId: 'sup_1',
        supplierName: 'مورد سحاب',
        invoiceNumber: 'INV-1001',
        invoiceDate: '2026-04-19',
        subtotal: 500,
        vatAmount: 75,
        totalAmount: 575,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        createdBy: LEGACY_DOC_UID,
        createdByName: 'محمد فيصل',
        attachments: [
          {
            id: 'att_1',
            name: 'invoice.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 12345,
            url: 'https://example.com/att_1',
            uploadedAt: '2026-04-19T12:00:00.000Z',
            uploadedBy: LEGACY_DOC_UID,
          },
        ],
        createdAt: '2026-04-19T12:00:00.000Z',
        updatedAt: '2026-04-19T12:00:00.000Z',
      } as any,
    },
    auditLogs: {
      audit_hist_1: {
        id: 'audit_hist_1',
        orgId: syntheticOrg.id,
        actorId: LEGACY_DOC_UID,
        actorName: 'محمد فيصل',
        actorRole: 'branch_manager',
        action: 'CREATE_CLOSING',
        targetType: 'closing',
        targetId: 'closing_hist_1',
        details: 'إنشاء إقفال تاريخي',
        timestamp: '2026-04-20T22:00:00.000Z',
      },
    },
    platformAuditLogs: {
      pal_existing_0: {
        id: 'pal_existing_0',
        actorUid: SUPER_ADMIN_ACTOR.uid,
        actorEmail: SUPER_ADMIN_ACTOR.email,
        action: 'MEMBER_CREATED',
        targetType: 'member',
        targetId: LEGACY_DOC_UID,
        orgId: syntheticOrg.id,
        details: 'سجل إنشاء تاريخي قديم',
        timestamp: '2026-02-01T08:00:00.000Z',
      },
    },
    memberOrgHistory: {
      moh_hist_1: {
        id: 'moh_hist_1',
        eventType: 'assigned',
        uid: LEGACY_DOC_UID,
        email: TARGET_EMAIL,
        displayName: 'محمد فيصل',
        orgId: syntheticOrg.id,
        orgName: syntheticOrg.name,
        role: 'branch_manager',
        branchId: syntheticSahabBranch.id,
        branchName: syntheticSahabBranch.name,
        effectiveAt: '2026-02-01T08:00:00.000Z',
        actorUid: SUPER_ADMIN_ACTOR.uid,
        actorEmail: SUPER_ADMIN_ACTOR.email,
        reason: 'سجل تاريخي سابق',
        auditLogId: 'pal_existing_0',
        createdAt: '2026-02-01T08:00:00.000Z',
      },
    },
    notifications: {
      notif_hist_1: {
        id: 'notif_hist_1',
        recipientScope: 'org',
        orgId: syntheticOrg.id,
        feedKey: `org:${syntheticOrg.id}:branch:${syntheticSahabBranch.id}`,
        category: 'closing',
        type: 'CLOSING_SUBMITTED',
        severity: 'info',
        title: 'إشعار تاريخي',
        body: 'تم إرسال إقفال',
        actorUid: LEGACY_DOC_UID,
        actorName: 'محمد فيصل',
        createdAt: '2026-04-20T22:00:00.000Z',
        readBy: [],
      } as any,
    },
  };

  const sim = simulateEmployeeAuthUidRebind(initialState, plan);

  assert.equal(sim.verification.allMandatoryConditionsPassed, true);
  assert.equal(sim.verification.activeProfilesForPersonCount, 1);
  assert.equal(sim.verification.legacyDocStillExists, true);
  assert.equal(sim.verification.legacyDocArchivedAndInactive, true);
  assert.equal(sim.verification.newActiveDocExistsUnderTargetAuthUid, true);
  assert.equal(sim.verification.authUidPreserved, true);
  assert.equal(sim.verification.emailPreserved, true);
  assert.equal(sim.verification.orgPreserved, true);
  assert.equal(sim.verification.branchPreserved, true);
  assert.equal(sim.verification.rolePreserved, true);
  assert.equal(sim.verification.permissionsPreserved, true);
  assert.equal(sim.verification.historicalRecordsCompletelyUntouched, true);
  assert.equal(sim.verification.noPrivilegeEscalation, true);
  assert.equal(sim.verification.noCrossOrgMovement, true);

  // Confirm post-rebind login passes strict UID binding & profiled access resolution!
  const newProfile = sim.nextState.users[CURRENT_AUTH_UID];
  const postLoginBinding = validateLoadedUserProfileBinding({
    authUid: CURRENT_AUTH_UID,
    docId: CURRENT_AUTH_UID,
    docExists: true,
    rawProfile: newProfile,
  });
  assert.equal(postLoginBinding.status, 'valid');

  const postLoginAccess = resolveProfiledUserAccess({
    profile: newProfile,
    org: syntheticOrg,
    authUid: CURRENT_AUTH_UID,
  });
  assert.equal(postLoginAccess.status, 'active_tenant');
});

test('6. Rebind planner strictly rejects non-Super Admin, unverified Super Admin, and conflicting states', () => {
  // Non-Super Admin (org manager) rejected
  assert.throws(() =>
    buildEmployeeAuthUidRebindPlan({
      actor: { uid: 'owner_sahab_uid', email: 'owner@sahab.example.com', emailVerified: true },
      targetAuthUid: CURRENT_AUTH_UID,
      targetAuthUidDocExists: false,
      legacyDocId: LEGACY_DOC_UID,
      legacyProfile: syntheticLegacyProfile,
      org: syntheticOrg,
      orgBranches: [syntheticSahabBranch],
      legacyUidAuthVerification: 'confirmed_unused_or_same_person',
      reason: 'محاولة غير مصرح بها',
    })
  );

  // Unverified Super Admin rejected
  assert.throws(() =>
    buildEmployeeAuthUidRebindPlan({
      actor: { uid: 'sa_root_uid', email: 'amoal2030@gmail.com', emailVerified: false },
      targetAuthUid: CURRENT_AUTH_UID,
      targetAuthUidDocExists: false,
      legacyDocId: LEGACY_DOC_UID,
      legacyProfile: syntheticLegacyProfile,
      org: syntheticOrg,
      orgBranches: [syntheticSahabBranch],
      legacyUidAuthVerification: 'confirmed_unused_or_same_person',
      reason: 'محاولة بدون تحقق بريد',
    })
  );

  // Active different employee in Firebase Auth rejected
  assert.throws(() =>
    buildEmployeeAuthUidRebindPlan({
      actor: SUPER_ADMIN_ACTOR,
      targetAuthUid: CURRENT_AUTH_UID,
      targetAuthUidDocExists: false,
      legacyDocId: LEGACY_DOC_UID,
      legacyProfile: syntheticLegacyProfile,
      org: syntheticOrg,
      orgBranches: [syntheticSahabBranch],
      legacyUidAuthVerification: 'active_different_employee',
      reason: 'محاولة مع تعارض موظف آخر',
    })
  );

  // Existing document under target Auth UID rejected (never overwrite)
  assert.throws(() =>
    buildEmployeeAuthUidRebindPlan({
      actor: SUPER_ADMIN_ACTOR,
      targetAuthUid: CURRENT_AUTH_UID,
      targetAuthUidDocExists: true,
      legacyDocId: LEGACY_DOC_UID,
      legacyProfile: syntheticLegacyProfile,
      org: syntheticOrg,
      orgBranches: [syntheticSahabBranch],
      legacyUidAuthVerification: 'confirmed_unused_or_same_person',
      reason: 'محاولة الكتابة فوق وثيقة موجودة',
    })
  );

  // Manager / owner role rejected (no privilege escalation)
  assert.throws(() =>
    buildEmployeeAuthUidRebindPlan({
      actor: SUPER_ADMIN_ACTOR,
      targetAuthUid: CURRENT_AUTH_UID,
      targetAuthUidDocExists: false,
      legacyDocId: LEGACY_DOC_UID,
      legacyProfile: { ...syntheticLegacyProfile, role: 'manager' },
      org: syntheticOrg,
      orgBranches: [syntheticSahabBranch],
      legacyUidAuthVerification: 'confirmed_unused_or_same_person',
      reason: 'محاولة ربط مدير مؤسسة',
    })
  );

  // Cross-org branch mismatch rejected (zero cross-org leakage)
  assert.throws(() =>
    buildEmployeeAuthUidRebindPlan({
      actor: SUPER_ADMIN_ACTOR,
      targetAuthUid: CURRENT_AUTH_UID,
      targetAuthUidDocExists: false,
      legacyDocId: LEGACY_DOC_UID,
      legacyProfile: { ...syntheticLegacyProfile, branchId: syntheticForeignBranch.id },
      org: syntheticOrg,
      orgBranches: [syntheticSahabBranch, syntheticForeignBranch],
      legacyUidAuthVerification: 'confirmed_unused_or_same_person',
      reason: 'محاولة ربط فرع من مؤسسة أخرى',
    })
  );

  // Permission tampering / escalation on legacy profile rejected
  assert.throws(() =>
    buildEmployeeAuthUidRebindPlan({
      actor: SUPER_ADMIN_ACTOR,
      targetAuthUid: CURRENT_AUTH_UID,
      targetAuthUidDocExists: false,
      legacyDocId: LEGACY_DOC_UID,
      legacyProfile: {
        ...syntheticLegacyProfile,
        permissions: {
          ...buildDefaultPermissionsForRole('branch_manager'),
          canManageEmployees: true,
        },
      },
      org: syntheticOrg,
      orgBranches: [syntheticSahabBranch],
      legacyUidAuthVerification: 'confirmed_unused_or_same_person',
      reason: 'محاولة تصعيد صلاحيات غير مسموحة',
    })
  );
});

console.log(`\n📊 Simulation Suite Result: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
