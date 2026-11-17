import assert from 'node:assert/strict';
import {
  buildClosingAdminCorrectedNotifications,
  buildClosingReviewedNotifications,
  buildClosingSubmittedNotifications,
  buildDayOffRequestedNotification,
  buildEmployeeLifecycleNotifications,
  buildNotificationId,
  buildOrgThresholdNotifications,
  buildPurchaseRecordedNotification,
  buildScheduleRequestDecisionNotifications,
  buildSecurityAdminNotification,
  buildShiftSwapRequestedNotifications,
  buildSuperAdminPlatformNotification,
  buildSuperAdminThresholdNotifications,
  buildSupplierAddedNotification,
  canUserReceiveNotification,
  getNotificationSoundEnabled,
  isNotificationReadByUser,
  KeyValueStorageLike,
  mergeAndSortNotifications,
  NOTIFICATION_FEED_PAGE_SIZE,
  NotificationPersistenceTracker,
  NotificationSoundController,
  resetNotificationRuntimeControllers,
  resolveAuthorizedNotificationCheckFeedKey,
  resolveFeedKeysForUser,
  setNotificationSoundEnabled,
} from '../utils/notifications';
import { verifySuperAdminForRealtimeListener } from '../utils/superAdminMonitoring';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import { Branch, Organization, ShiftClosing, UserProfile } from '../types';

let passed = 0;

function testSync(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function createMemoryStorage(): KeyValueStorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => {
      store.set(k, v);
    },
  };
}

function makeUser(overrides: Partial<UserProfile>): UserProfile {
  return {
    uid: 'uid_user',
    orgId: 'org_1',
    email: 'user@example.com',
    displayName: 'User Test',
    role: 'employee',
    branchId: 'br_1',
    branchName: 'الفرع الأول',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('employee'),
    createdAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeClosing(overrides?: Partial<ShiftClosing>): ShiftClosing {
  return {
    id: 'closing_br1_2026-11-16_morning',
    orgId: 'org_1',
    branchId: 'br_1',
    branchName: 'الفرع الأول',
    employeeId: 'uid_emp_1',
    employeeName: 'سالم الصندوق',
    date: '2026-11-16',
    period: 'morning',
    cashSales: 1500,
    cardSales: 2000,
    totalSales: 3500,
    expenses: 400,
    remainingInBox: 1100,
    netPeriod: 3100,
    status: 'pending_review',
    attachmentIds: [],
    createdAt: '2026-11-16T08:00:00.000Z',
    updatedAt: '2026-11-16T08:00:00.000Z',
    ...overrides,
  };
}

async function main() {
  console.log('========================================================================');
  console.log('   PHASE 4.6: COMPREHENSIVE NOTIFICATION SYSTEM UNIT TESTS              ');
  console.log('========================================================================\n');

  // 1. Inverted timestamp deterministic IDs sort newest-first under lexicographical orderBy(documentId(), 'asc')
  testSync('Deterministic IDs preserve dedupKey stability and sort newest-first lexicographically', () => {
    const olderId = buildNotificationId('dedup_a', '2026-11-16T08:00:00.000Z');
    const newerId = buildNotificationId('dedup_b', '2026-11-16T09:00:00.000Z');
    const sameDedupId1 = buildNotificationId('org_sub_expiring:org_1:2026-11-16', '2026-11-16T00:00:00.000Z');
    const sameDedupId2 = buildNotificationId('org_sub_expiring:org_1:2026-11-16', '2026-11-16T00:00:00.000Z');

    assert.equal(sameDedupId1, sameDedupId2);
    assert.ok(newerId < olderId, `Expected newer ID ${newerId} to sort before older ID ${olderId}`);
    assert.match(olderId, /^[a-zA-Z0-9_-]+$/);
  });

  // 2. Role-scoped feed keys resolution across all 5 roles
  testSync('Feed keys resolve strictly according to role, single branch, and supervisor permissions', () => {
    const saKeys = resolveFeedKeysForUser({ surface: 'super_admin', isSuperAdmin: true, uid: 'uid_sa' });
    assert.deepEqual(saKeys, ['super_admin']);

    const nonSaKeys = resolveFeedKeysForUser({ surface: 'super_admin', isSuperAdmin: false, uid: 'uid_other' });
    assert.deepEqual(nonSaKeys, []);

    const mgr = makeUser({ uid: 'uid_mgr', role: 'manager', branchId: undefined, permissions: buildDefaultPermissionsForRole('manager') });
    assert.deepEqual(
      resolveFeedKeysForUser({ surface: 'tenant', isSuperAdmin: false, uid: 'uid_mgr', userProfile: mgr, orgId: 'org_1' }),
      ['user:org_1:uid_mgr', 'org_mgr:org_1']
    );

    const bm = makeUser({
      uid: 'uid_bm',
      role: 'branch_manager',
      branchId: 'br_1',
      branchIds: ['br_1'],
      permissions: buildDefaultPermissionsForRole('branch_manager'),
    });
    assert.deepEqual(
      resolveFeedKeysForUser({ surface: 'tenant', isSuperAdmin: false, uid: 'uid_bm', userProfile: bm, orgId: 'org_1' }),
      ['user:org_1:uid_bm', 'branch_mgr:org_1:br_1']
    );

    const supApprover = makeUser({
      uid: 'uid_sup',
      role: 'supervisor',
      branchId: undefined,
      permissions: buildDefaultPermissionsForRole('supervisor', {
        canApproveClosings: true,
        canViewAllClosings: false,
        canManagePurchases: false,
      }),
    });
    assert.deepEqual(
      resolveFeedKeysForUser({ surface: 'tenant', isSuperAdmin: false, uid: 'uid_sup', userProfile: supApprover, orgId: 'org_1' }),
      ['user:org_1:uid_sup', 'org_perm:org_1:canApproveClosings']
    );

    const emp = makeUser({ uid: 'uid_emp_1', role: 'employee', branchId: 'br_1' });
    assert.deepEqual(
      resolveFeedKeysForUser({ surface: 'tenant', isSuperAdmin: false, uid: 'uid_emp_1', userProfile: emp, orgId: 'org_1' }),
      ['user:org_1:uid_emp_1']
    );
  });

  // 3. Cross-role, cross-branch, and cross-organization isolation across Categories 1-6
  testSync('Role isolation blocks Employees, other Branch Managers, unpermitted Supervisors, and foreign orgs', () => {
    const closing = makeClosing();
    const [submitted] = buildClosingSubmittedNotifications({
      closing,
      actorUid: 'uid_emp_1',
      actorName: 'سالم الصندوق',
      actorRole: 'employee',
    });

    const mgrOrg1 = makeUser({ uid: 'uid_mgr_1', orgId: 'org_1', role: 'manager', permissions: buildDefaultPermissionsForRole('manager') });
    const mgrOrg2 = makeUser({ uid: 'uid_mgr_2', orgId: 'org_2', role: 'manager', permissions: buildDefaultPermissionsForRole('manager') });
    const supApprover = makeUser({
      uid: 'uid_sup_app',
      orgId: 'org_1',
      role: 'supervisor',
      permissions: buildDefaultPermissionsForRole('supervisor', { canApproveClosings: true }),
    });
    const supPurchaser = makeUser({
      uid: 'uid_sup_pur',
      orgId: 'org_1',
      role: 'supervisor',
      permissions: buildDefaultPermissionsForRole('supervisor', { canManagePurchases: true }),
    });
    const bmBr1 = makeUser({
      uid: 'uid_bm_1',
      orgId: 'org_1',
      role: 'branch_manager',
      branchId: 'br_1',
      branchIds: ['br_1'],
      permissions: buildDefaultPermissionsForRole('branch_manager'),
    });
    const bmBr2 = makeUser({
      uid: 'uid_bm_2',
      orgId: 'org_1',
      role: 'branch_manager',
      branchId: 'br_2',
      branchIds: ['br_2'],
      permissions: buildDefaultPermissionsForRole('branch_manager'),
    });
    const emp1 = makeUser({ uid: 'uid_emp_1', orgId: 'org_1', role: 'employee', branchId: 'br_1' });
    const emp2 = makeUser({ uid: 'uid_emp_2', orgId: 'org_1', role: 'employee', branchId: 'br_1' });

    // Closing submitted -> Manager, Approver Supervisor, Branch 1 Manager ONLY
    assert.equal(canUserReceiveNotification(submitted, { surface: 'tenant', isSuperAdmin: false, uid: mgrOrg1.uid, userProfile: mgrOrg1, orgId: 'org_1' }), true);
    assert.equal(canUserReceiveNotification(submitted, { surface: 'tenant', isSuperAdmin: false, uid: supApprover.uid, userProfile: supApprover, orgId: 'org_1' }), true);
    assert.equal(canUserReceiveNotification(submitted, { surface: 'tenant', isSuperAdmin: false, uid: bmBr1.uid, userProfile: bmBr1, orgId: 'org_1' }), true);
    assert.equal(canUserReceiveNotification(submitted, { surface: 'tenant', isSuperAdmin: false, uid: bmBr2.uid, userProfile: bmBr2, orgId: 'org_1' }), false);
    assert.equal(canUserReceiveNotification(submitted, { surface: 'tenant', isSuperAdmin: false, uid: supPurchaser.uid, userProfile: supPurchaser, orgId: 'org_1' }), false);
    assert.equal(canUserReceiveNotification(submitted, { surface: 'tenant', isSuperAdmin: false, uid: emp2.uid, userProfile: emp2, orgId: 'org_1' }), false);
    assert.equal(canUserReceiveNotification(submitted, { surface: 'tenant', isSuperAdmin: false, uid: mgrOrg2.uid, userProfile: mgrOrg2, orgId: 'org_2' }), false);

    // Reviewed closing -> Employee owner (user) + Branch 1 Manager (branch_manager); emp2 denied
    const reviewNotifs = buildClosingReviewedNotifications({
      closing,
      action: 'reject',
      rejectionReason: 'يرجى إرفاق إيصال الشبكة',
      actorUid: mgrOrg1.uid,
      actorName: 'المدير',
      actorRole: 'manager',
    });
    assert.equal(reviewNotifs.length, 2);
    assert.equal(canUserReceiveNotification(reviewNotifs[0], { surface: 'tenant', isSuperAdmin: false, uid: emp1.uid, userProfile: emp1, orgId: 'org_1' }), true);
    assert.equal(canUserReceiveNotification(reviewNotifs[0], { surface: 'tenant', isSuperAdmin: false, uid: emp2.uid, userProfile: emp2, orgId: 'org_1' }), false);
    assert.equal(canUserReceiveNotification(reviewNotifs[1], { surface: 'tenant', isSuperAdmin: false, uid: bmBr1.uid, userProfile: bmBr1, orgId: 'org_1' }), true);
    assert.equal(canUserReceiveNotification(reviewNotifs[1], { surface: 'tenant', isSuperAdmin: false, uid: bmBr2.uid, userProfile: bmBr2, orgId: 'org_1' }), false);

    // Purchase notification -> Purchaser Supervisor + Branch 1 Manager + Manager; Approver Supervisor denied
    const purchaseNotif = buildPurchaseRecordedNotification({
      purchaseId: 'pur_1',
      orgId: 'org_1',
      branchId: 'br_1',
      branchName: 'الفرع الأول',
      supplierName: 'مورد الجملة',
      totalAmount: 450,
      currency: 'SAR',
      needsReview: true,
      actorUid: bmBr1.uid,
      actorName: 'مسؤول الفرع',
      actorRole: 'branch_manager',
    });
    assert.equal(canUserReceiveNotification(purchaseNotif, { surface: 'tenant', isSuperAdmin: false, uid: supPurchaser.uid, userProfile: supPurchaser, orgId: 'org_1' }), true);
    assert.equal(canUserReceiveNotification(purchaseNotif, { surface: 'tenant', isSuperAdmin: false, uid: supApprover.uid, userProfile: supApprover, orgId: 'org_1' }), false);
    assert.equal(canUserReceiveNotification(purchaseNotif, { surface: 'tenant', isSuperAdmin: false, uid: emp1.uid, userProfile: emp1, orgId: 'org_1' }), false);

    // Supplier notification -> Manager + canViewSuppliers / canManageSuppliers Supervisor
    const supAdded = buildSupplierAddedNotification({
      supplierId: 'sup_1',
      orgId: 'org_1',
      supplierName: 'المورد السريع',
      actorUid: mgrOrg1.uid,
      actorName: 'المدير',
      actorRole: 'manager',
    });
    const supViewOnly = makeUser({
      uid: 'uid_sup_view',
      orgId: 'org_1',
      role: 'supervisor',
      permissions: buildDefaultPermissionsForRole('supervisor', { canViewSuppliers: true }),
    });
    assert.equal(canUserReceiveNotification(supAdded, { surface: 'tenant', isSuperAdmin: false, uid: supViewOnly.uid, userProfile: supViewOnly, orgId: 'org_1' }), true);
    assert.equal(canUserReceiveNotification(supAdded, { surface: 'tenant', isSuperAdmin: false, uid: supApprover.uid, userProfile: supApprover, orgId: 'org_1' }), false);

    // Schedule day-off & shift-swap -> Branch Manager + Manager + Partner user
    const dayOff = buildDayOffRequestedNotification({
      requestId: 'req_1',
      orgId: 'org_1',
      branchId: 'br_1',
      branchName: 'الفرع الأول',
      requesterUid: emp1.uid,
      requesterName: 'سالم',
      requesterRole: 'employee',
      requestedDate: '2026-11-20',
    });
    assert.equal(canUserReceiveNotification(dayOff, { surface: 'tenant', isSuperAdmin: false, uid: bmBr1.uid, userProfile: bmBr1, orgId: 'org_1' }), true);
    assert.equal(canUserReceiveNotification(dayOff, { surface: 'tenant', isSuperAdmin: false, uid: bmBr2.uid, userProfile: bmBr2, orgId: 'org_1' }), false);

    const swapNotifs = buildShiftSwapRequestedNotifications({
      requestId: 'req_2',
      orgId: 'org_1',
      branchId: 'br_1',
      branchName: 'الفرع الأول',
      requesterUid: emp1.uid,
      requesterName: 'سالم',
      requesterRole: 'employee',
      partnerUid: emp2.uid,
      partnerName: 'عمر',
      shiftDate: '2026-11-21',
    });
    assert.equal(canUserReceiveNotification(swapNotifs[1], { surface: 'tenant', isSuperAdmin: false, uid: emp2.uid, userProfile: emp2, orgId: 'org_1' }), true);
    assert.equal(canUserReceiveNotification(swapNotifs[1], { surface: 'tenant', isSuperAdmin: false, uid: emp1.uid, userProfile: emp1, orgId: 'org_1' }), false);

    const schedDecisions = buildScheduleRequestDecisionNotifications({
      requestId: 'req_2',
      orgId: 'org_1',
      branchId: 'br_1',
      branchName: 'الفرع الأول',
      requestKind: 'shift_swap',
      decision: 'approved',
      requesterUid: emp1.uid,
      partnerUid: emp2.uid,
      actorUid: mgrOrg1.uid,
      actorName: 'المدير',
    });
    assert.equal(schedDecisions.length, 2);

    // Super Admin notification strictly isolated to surface === 'super_admin' & isSuperAdmin === true
    const saNotif = buildSuperAdminPlatformNotification({
      dedupKey: 'sa_test_1',
      category: 'org_branches',
      type: 'SA_ORG_CREATED',
      severity: 'success',
      relatedOrgId: 'org_1',
      actorUid: 'uid_sa',
      actorName: 'صاحب الموقع',
      title: 'تأسيس مؤسسة',
      body: 'تفاصيل',
      targetType: 'organization',
      targetId: 'org_1',
    });
    assert.equal(canUserReceiveNotification(saNotif, { surface: 'super_admin', isSuperAdmin: true, uid: 'uid_sa' }), true);
    assert.equal(canUserReceiveNotification(saNotif, { surface: 'super_admin', isSuperAdmin: false, uid: mgrOrg1.uid }), false);
    assert.equal(canUserReceiveNotification(saNotif, { surface: 'tenant', isSuperAdmin: false, uid: mgrOrg1.uid, userProfile: mgrOrg1, orgId: 'org_1' }), false);
  });

  // 4. Deduplication, read/unread state, and newest-first sorting
  testSync('mergeAndSortNotifications deduplicates across feeds, sorts newest-first, and preserves read state', () => {
    const mgr = makeUser({ uid: 'uid_mgr', orgId: 'org_1', role: 'manager', permissions: buildDefaultPermissionsForRole('manager') });
    const empNotifs = buildEmployeeLifecycleNotifications({
      action: 'created',
      orgId: 'org_1',
      actorUid: 'uid_mgr',
      actorName: 'المدير',
      employeeUid: 'uid_emp_9',
      employeeName: 'خالد',
      employeeRole: 'employee',
      branchId: 'br_1',
      branchName: 'الفرع الأول',
      createdAt: '2026-11-16T08:00:00.000Z',
    });
    const secNotif = buildSecurityAdminNotification({
      dedupKey: 'sec_drive:org_1',
      type: 'SECURITY_DRIVE_HEALTH_FAILED',
      severity: 'critical',
      orgId: 'org_1',
      audienceScope: 'org_manager',
      actorUid: 'uid_mgr',
      actorName: 'المدير',
      actorRole: 'manager',
      title: 'تنبيه Drive',
      body: 'فشل الاتصال',
      createdAt: '2026-11-16T10:30:00.000Z',
    });

    const mgrItem = empNotifs[0];
    const readCopy = { ...secNotif, readBy: { uid_mgr: '2026-11-16T10:31:00.000Z' }, updatedAt: '2026-11-16T10:31:00.000Z' };
    const merged = mergeAndSortNotifications([mgrItem, secNotif, readCopy], {
      surface: 'tenant',
      isSuperAdmin: false,
      uid: 'uid_mgr',
      userProfile: mgr,
      orgId: 'org_1',
    });

    assert.equal(merged.length, 2);
    assert.equal(merged[0].id, secNotif.id); // newest first
    assert.equal(merged[1].id, mgrItem.id);
    assert.equal(isNotificationReadByUser(merged[0], 'uid_mgr'), true);
    assert.equal(isNotificationReadByUser(merged[1], 'uid_mgr'), false);
  });

  // 5. Sound controller lifecycle: silent on initial hydration, plays once on incoming batch, no replay, honors per-UID mute
  testSync('NotificationSoundController suppresses initial hydration, replays, self-actions, and honors mute toggle', () => {
    let playCount = 0;
    const ctrl = new NotificationSoundController(() => {
      playCount += 1;
      return true;
    });

    const storage = createMemoryStorage();
    assert.equal(getNotificationSoundEnabled('uid_1', storage), true);
    setNotificationSoundEnabled('uid_1', false, storage);
    assert.equal(getNotificationSoundEnabled('uid_1', storage), false);
    assert.equal(getNotificationSoundEnabled('uid_2', storage), true);

    const nInitial = buildSecurityAdminNotification({
      dedupKey: 'init_1',
      type: 'SECURITY_ACCESS_DENIED_ALERT',
      severity: 'warning',
      orgId: 'org_1',
      audienceScope: 'org_manager',
      actorUid: 'uid_other',
      actorName: 'موظف',
      actorRole: 'employee',
      title: 'تنبيه أولي',
      body: 'موجود مسبقاً قبل الدخول',
      createdAt: '2026-11-16T07:00:00.000Z',
    });

    // Initial hydration MUST NOT play chime even if unread
    const r1 = ctrl.processSnapshot([nInitial], {
      scopeKey: 'tenant:org_1:uid_mgr',
      uid: 'uid_mgr',
      soundEnabled: true,
    });
    assert.equal(r1.reason, 'initial_hydration');
    assert.equal(r1.played, false);
    assert.equal(playCount, 0);

    // Duplicate replay of same snapshot MUST NOT play
    const r2 = ctrl.processSnapshot([nInitial], {
      scopeKey: 'tenant:org_1:uid_mgr',
      uid: 'uid_mgr',
      soundEnabled: true,
    });
    assert.equal(r2.reason, 'no_new_unread');
    assert.equal(playCount, 0);

    // Incoming batch of 2 new unread items from another user -> plays ONCE total
    const nIncoming1 = buildClosingSubmittedNotifications({
      closing: makeClosing({ id: 'c_1', updatedAt: '2026-11-16T09:00:00.000Z' }),
      actorUid: 'uid_emp_1',
      actorName: 'سالم',
      actorRole: 'employee',
    })[0];
    const nIncoming2 = buildClosingSubmittedNotifications({
      closing: makeClosing({ id: 'c_2', updatedAt: '2026-11-16T09:01:00.000Z' }),
      actorUid: 'uid_emp_1',
      actorName: 'سالم',
      actorRole: 'employee',
    })[0];

    const r3 = ctrl.processSnapshot([nIncoming2, nIncoming1, nInitial], {
      scopeKey: 'tenant:org_1:uid_mgr',
      uid: 'uid_mgr',
      soundEnabled: true,
    });
    assert.equal(r3.reason, 'played');
    assert.equal(r3.played, true);
    assert.equal(r3.newUnreadIds.length, 2);
    assert.equal(playCount, 1);

    // Muted user receives incoming alert -> returns muted, does not play
    const nIncoming3 = buildClosingSubmittedNotifications({
      closing: makeClosing({ id: 'c_3', updatedAt: '2026-11-16T09:05:00.000Z' }),
      actorUid: 'uid_emp_1',
      actorName: 'سالم',
      actorRole: 'employee',
    })[0];
    const r4 = ctrl.processSnapshot([nIncoming3, nIncoming2, nIncoming1, nInitial], {
      scopeKey: 'tenant:org_1:uid_mgr',
      uid: 'uid_mgr',
      soundEnabled: false,
    });
    assert.equal(r4.reason, 'muted');
    assert.equal(r4.played, false);
    assert.equal(playCount, 1);

    // Admin correction audit notifications builder check
    const corr = buildClosingAdminCorrectedNotifications({
      closing: makeClosing(),
      correctionReason: 'تصحيح مبلغ الشبكة',
      actorUid: 'uid_mgr',
      actorName: 'المدير',
    });
    assert.equal(corr.length, 2);
  });

  // 6. Org & Super Admin threshold builders (7d sub expiry, 7d no-paid-branch grace, 30d suspended branch grace)
  testSync('Org and Super Admin threshold notification builders create deterministic daily dedupKeys', () => {
    const now = new Date('2026-11-16T10:00:00.000Z');
    const org: Organization = {
      id: 'org_sub',
      name: 'مؤسسة الاختبار',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr',
      ownerEmail: 'mgr@example.com',
      ownerName: 'المدير',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: '2026-10-20T00:00:00.000Z',
      subscriptionEndAt: '2026-11-20T00:00:00.000Z', // 4 days left
      deactivationDueAt: '2026-11-22T00:00:00.000Z',
      deactivationReason: 'no_paid_branches',
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
    };
    const branches: Branch[] = [
      {
        id: 'br_susp',
        orgId: 'org_sub',
        name: 'فرع المطار',
        code: 'BR-2',
        isActive: false,
        lifecycleStatus: 'suspended',
        paymentStatus: 'unpaid',
        suspendedAt: '2026-10-20T00:00:00.000Z',
        gracePeriodEndsAt: '2026-11-18T00:00:00.000Z', // 2 days left of 30d grace
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ];

    const mgrAlerts = buildOrgThresholdNotifications({
      org,
      branches,
      actorUid: 'uid_mgr',
      actorName: 'المدير',
      now,
    });
    assert.equal(mgrAlerts.length, 3);
    assert.ok(mgrAlerts.some((a) => a.type === 'ORG_SUBSCRIPTION_EXPIRING'));
    assert.ok(mgrAlerts.some((a) => a.type === 'ORG_NO_PAID_BRANCH_WARNING'));
    assert.ok(mgrAlerts.some((a) => a.type === 'BRANCH_SUSPENDED_GRACE_WARNING'));

    const saAlerts = buildSuperAdminThresholdNotifications({
      organizations: [org],
      branches,
      actorUid: 'uid_sa',
      actorName: 'صاحب الموقع',
      now,
    });
    assert.equal(saAlerts.length, 3);
    assert.ok(saAlerts.every((a) => a.audienceScope === 'super_admin' && a.orgId === 'platform'));
  });

  // 7. Pagination (loadMoreNotifications) MUST NOT play sound or trigger browser alerts for older unread items
  testSync('Pagination expansion (loadMoreNotifications) suppresses sound for older unread notifications while alerting on truly new ones', () => {
    let playCount = 0;
    const ctrl = new NotificationSoundController(() => {
      playCount += 1;
      return true;
    });

    const makeOlderItem = (idx: number, iso: string) =>
      buildClosingSubmittedNotifications({
        closing: makeClosing({ id: `c_page_${idx}`, updatedAt: iso }),
        actorUid: 'uid_emp_1',
        actorName: 'سالم',
        actorRole: 'employee',
        createdAt: iso,
      })[0];

    const page1 = Array.from({ length: NOTIFICATION_FEED_PAGE_SIZE }, (_, i) => {
      const minute = String(59 - i).padStart(2, '0');
      return makeOlderItem(i + 1, `2026-11-16T08:${minute}:00.000Z`);
    });

    // Initial hydration at pageLimit = 25
    const rInit = ctrl.processSnapshot(page1, {
      scopeKey: 'tenant:org_1:uid_mgr',
      uid: 'uid_mgr',
      soundEnabled: true,
      pageLimit: 25,
    });
    assert.equal(rInit.reason, 'initial_hydration');
    assert.equal(playCount, 0);

    // User clicks "Load More" (25 -> 50): 10 older unread notifications appear at bottom of list
    const olderUnreadPage2 = Array.from({ length: 10 }, (_, i) => {
      const minute = String(50 - i).padStart(2, '0');
      return makeOlderItem(30 + i, `2026-11-16T07:${minute}:00.000Z`);
    });
    ctrl.markPaginationExpansion();
    const rPage2 = ctrl.processSnapshot([...page1, ...olderUnreadPage2], {
      scopeKey: 'tenant:org_1:uid_mgr',
      uid: 'uid_mgr',
      soundEnabled: true,
      pageLimit: 50,
    });
    assert.equal(rPage2.reason, 'pagination_hydration');
    assert.equal(rPage2.played, false);
    assert.deepEqual(rPage2.newUnreadIds, []);
    assert.equal(playCount, 0);

    // Second "Load More" (50 -> 75) even solely via pageLimit increase -> still silent
    const olderUnreadPage3 = [makeOlderItem(99, '2026-11-16T06:00:00.000Z')];
    const rPage3 = ctrl.processSnapshot([...page1, ...olderUnreadPage2, ...olderUnreadPage3], {
      scopeKey: 'tenant:org_1:uid_mgr',
      uid: 'uid_mgr',
      soundEnabled: true,
      pageLimit: 75,
    });
    assert.equal(rPage3.reason, 'pagination_hydration');
    assert.equal(rPage3.played, false);
    assert.equal(playCount, 0);

    // Truly new notification arrives while at pageLimit = 75 -> plays ONCE
    const brandNew = makeOlderItem(999, '2026-11-16T10:00:00.000Z');
    const rLive = ctrl.processSnapshot([brandNew, ...page1, ...olderUnreadPage2, ...olderUnreadPage3], {
      scopeKey: 'tenant:org_1:uid_mgr',
      uid: 'uid_mgr',
      soundEnabled: true,
      pageLimit: 75,
    });
    assert.equal(rLive.reason, 'played');
    assert.equal(rLive.played, true);
    assert.deepEqual(rLive.newUnreadIds, [brandNew.id]);
    assert.equal(playCount, 1);
  });

  // 8. Repeated logout / login (including same UID: uid_A -> null -> uid_A -> null -> uid_B) resets all notification session state
  testSync('Repeated logout and re-login (same UID and cross-UID) cleanly resets limits, controllers, and threshold tracker', () => {
    let plays = 0;
    const tenantController = new NotificationSoundController(() => {
      plays += 1;
      return true;
    });
    const saController = new NotificationSoundController(() => {
      plays += 1;
      return true;
    });
    const persistenceTracker = new NotificationPersistenceTracker();
    let tenantLimit = 75;
    let saLimit = 100;

    const notifA = buildClosingSubmittedNotifications({
      closing: makeClosing({ id: 'c_relogin_1', updatedAt: '2026-11-16T09:00:00.000Z' }),
      actorUid: 'uid_emp_1',
      actorName: 'سالم',
      actorRole: 'employee',
    })[0];

    // Simulate active session for uid_A with expanded pageLimit and persisted threshold
    tenantController.processSnapshot([notifA], {
      scopeKey: 'tenant:org_1:uid_A',
      uid: 'uid_A',
      soundEnabled: true,
      pageLimit: tenantLimit,
    });
    saController.processSnapshot([], {
      scopeKey: 'super_admin:uid_sa',
      uid: 'uid_sa',
      soundEnabled: true,
      pageLimit: saLimit,
    });
    persistenceTracker.runOnce('thr_1', async () => 'persisted');

    // Transition 1: uid_A logs out -> null
    resetNotificationRuntimeControllers({
      tenantController,
      saController,
      persistenceTracker,
      setTenantLimit: (l) => { tenantLimit = l; },
      setSaLimit: (l) => { saLimit = l; },
    });
    assert.equal(tenantLimit, NOTIFICATION_FEED_PAGE_SIZE);
    assert.equal(saLimit, NOTIFICATION_FEED_PAGE_SIZE);
    assert.equal(tenantController.getStateSnapshot().hydrated, false);
    assert.equal(tenantController.getStateSnapshot().seenCount, 0);
    assert.equal(saController.getStateSnapshot().hydrated, false);
    assert.equal(persistenceTracker.isPersisted('thr_1'), false);

    // Transition 2: SAME user uid_A logs back in (null -> uid_A) -> initial hydration MUST NOT play sound or keep old seenIds/limit
    const reLoginInit = tenantController.processSnapshot([notifA], {
      scopeKey: 'tenant:org_1:uid_A',
      uid: 'uid_A',
      soundEnabled: true,
      pageLimit: tenantLimit,
    });
    assert.equal(reLoginInit.reason, 'initial_hydration');
    assert.equal(reLoginInit.played, false);
    assert.equal(plays, 0);

    // Transition 3: logout -> uid_B logs in -> clean isolation
    resetNotificationRuntimeControllers({
      tenantController,
      saController,
      persistenceTracker,
      setTenantLimit: (l) => { tenantLimit = l; },
      setSaLimit: (l) => { saLimit = l; },
    });
    const uidBInit = tenantController.processSnapshot([notifA], {
      scopeKey: 'tenant:org_1:uid_B',
      uid: 'uid_B',
      soundEnabled: true,
      pageLimit: tenantLimit,
    });
    assert.equal(uidBInit.reason, 'initial_hydration');
    assert.equal(plays, 0);
  });

  // 9. NotificationPersistenceTracker retries after transient failure without duplicating deterministic ID
  testSync('NotificationPersistenceTracker unlocks retry after transient setDoc failure and deduplicates once persisted', async () => {
    const tracker = new NotificationPersistenceTracker();
    const deterministicId = buildNotificationId('org_sub_expiring:org_1:2026-11-16', '2026-11-16T00:00:00.000Z');
    let attemptCount = 0;

    // First attempt fails transiently
    const first = await tracker.runOnce(deterministicId, async () => {
      attemptCount += 1;
      return 'failed';
    });
    assert.equal(first, 'failed');
    assert.equal(tracker.isPersisted(deterministicId), false);
    assert.equal(tracker.shouldAttempt(deterministicId), true);

    // Second attempt succeeds
    const second = await tracker.runOnce(deterministicId, async () => {
      attemptCount += 1;
      return 'persisted';
    });
    assert.equal(second, 'persisted');
    assert.equal(tracker.isPersisted(deterministicId), true);
    assert.equal(tracker.shouldAttempt(deterministicId), false);

    // Third attempt is skipped cleanly
    const third = await tracker.runOnce(deterministicId, async () => {
      attemptCount += 1;
      return 'persisted';
    });
    assert.equal(third, 'skipped');
    assert.equal(attemptCount, 2);
  });

  // 10. resolveAuthorizedNotificationCheckFeedKey restricts existence checks strictly to caller's authorized feed
  testSync('resolveAuthorizedNotificationCheckFeedKey never probes unauthorized or foreign-org feeds', () => {
    const orgMgrAlert = buildSecurityAdminNotification({
      dedupKey: 'sec_probe_1',
      type: 'SECURITY_DRIVE_HEALTH_FAILED',
      severity: 'critical',
      orgId: 'org_1',
      audienceScope: 'org_manager',
      actorUid: 'uid_mgr',
      actorName: 'المدير',
      actorRole: 'manager',
      title: 'تنبيه',
      body: 'تفاصيل',
    });
    const saAlert = buildSuperAdminPlatformNotification({
      dedupKey: 'sa_probe_1',
      category: 'org_branches',
      type: 'SA_ORG_SUBSCRIPTION_EXPIRING',
      severity: 'warning',
      relatedOrgId: 'org_1',
      actorUid: 'uid_sa',
      actorName: 'صاحب الموقع',
      title: 'تنبيه',
      body: 'تفاصيل',
      targetType: 'organization',
      targetId: 'org_1',
    });
    const empAlert = buildSecurityAdminNotification({
      dedupKey: 'sec_emp_denied',
      type: 'SECURITY_ACCESS_DENIED_ALERT',
      severity: 'critical',
      orgId: 'org_1',
      audienceScope: 'org_manager',
      actorUid: 'uid_emp_1',
      actorName: 'موظف',
      actorRole: 'employee',
      title: 'محاولة مرفوضة',
      body: 'تفاصيل',
    });

    const mgrOrg1 = makeUser({ uid: 'uid_mgr', orgId: 'org_1', role: 'manager' });
    const mgrOrg2 = makeUser({ uid: 'uid_mgr_2', orgId: 'org_2', role: 'manager' });
    const emp1 = makeUser({ uid: 'uid_emp_1', orgId: 'org_1', role: 'employee' });

    assert.equal(
      resolveAuthorizedNotificationCheckFeedKey(orgMgrAlert, { uid: 'uid_mgr', isSuperAdmin: false, userProfile: mgrOrg1 }),
      'org_mgr:org_1'
    );
    assert.equal(
      resolveAuthorizedNotificationCheckFeedKey(orgMgrAlert, { uid: 'uid_mgr_2', isSuperAdmin: false, userProfile: mgrOrg2 }),
      null
    );
    assert.equal(
      resolveAuthorizedNotificationCheckFeedKey(empAlert, { uid: 'uid_emp_1', isSuperAdmin: false, userProfile: emp1 }),
      null
    );
    assert.equal(
      resolveAuthorizedNotificationCheckFeedKey(saAlert, { uid: 'uid_sa', isSuperAdmin: true, userProfile: null }),
      'super_admin'
    );
    assert.equal(
      resolveAuthorizedNotificationCheckFeedKey(saAlert, { uid: 'uid_onlak', isSuperAdmin: false, userProfile: mgrOrg1 }),
      null
    );
  });

  // 11. Super Admin realtime listener verification enforces amoal2030@gmail.com + email_verified + fresh JWT claims
  await (async () => {
    let forcedRefreshCalls = 0;
    const validSaUser = {
      email: 'amoal2030@gmail.com',
      emailVerified: true,
      getIdTokenResult: async (forceRefresh?: boolean) => {
        if (forceRefresh) forcedRefreshCalls += 1;
        return { claims: { email: 'amoal2030@gmail.com', email_verified: true } };
      },
    };
    const res1 = await verifySuperAdminForRealtimeListener(validSaUser);
    assert.equal(res1.claimsVerified, true);
    assert.equal(res1.refreshed, false);
    assert.equal(forcedRefreshCalls, 0);

    // Stale initial claims trigger forced token refresh before listener attaches
    let refreshAttempt = 0;
    const staleThenFreshSaUser = {
      email: 'amoal2030@gmail.com',
      emailVerified: true,
      getIdTokenResult: async (forceRefresh?: boolean) => {
        refreshAttempt += 1;
        if (!forceRefresh) {
          return { claims: { email: 'amoal2030@gmail.com', email_verified: false } };
        }
        return { claims: { email: 'amoal2030@gmail.com', email_verified: true } };
      },
    };
    const res2 = await verifySuperAdminForRealtimeListener(staleThenFreshSaUser);
    assert.equal(res2.claimsVerified, true);
    assert.equal(res2.refreshed, true);
    assert.equal(refreshAttempt, 2);

    // onlak2030@gmail.com and unverified amoal2030@gmail.com and permanently unverified JWT claims MUST fail
    await assert.rejects(() =>
      verifySuperAdminForRealtimeListener({
        email: 'onlak2030@gmail.com',
        emailVerified: true,
        getIdTokenResult: async () => ({ claims: { email: 'onlak2030@gmail.com', email_verified: true } }),
      })
    );
    await assert.rejects(() =>
      verifySuperAdminForRealtimeListener({
        email: 'amoal2030@gmail.com',
        emailVerified: false,
        getIdTokenResult: async () => ({ claims: { email: 'amoal2030@gmail.com', email_verified: false } }),
      })
    );
    await assert.rejects(() =>
      verifySuperAdminForRealtimeListener({
        email: 'amoal2030@gmail.com',
        emailVerified: true,
        getIdTokenResult: async () => ({ claims: { email: 'amoal2030@gmail.com', email_verified: false } }),
      })
    );
    passed += 1;
    console.log('PASS: Super Admin realtime listener guard refreshes stale claims and rejects onlak2030/unverified tokens');
  })();

  console.log(`\nALL ${passed} UNIT TESTS PASSED`);
}

main().catch((err) => {
  console.error('Unit test suite failed:', err);
  process.exit(1);
});
