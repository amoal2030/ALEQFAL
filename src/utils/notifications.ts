import {
  AppNotification,
  Branch,
  BrowserNotificationCapability,
  NotificationAudienceScope,
  NotificationCategory,
  NotificationNavTarget,
  NotificationSeverity,
  NotificationTargetType,
  Organization,
  ShiftClosing,
  UserPermissions,
  UserProfile,
  UserRole,
} from '../types';
import { evaluateBranchBillingAndGrace, evaluateOrgNoPaidBranchGrace } from './branchPricing';
import {
  resolveEffectivePermissions,
  resolvePrimaryAssignedBranchId,
} from './permissions';
import { evaluateOrganizationSubscription, toValidDate } from './subscription';

export const NOTIFICATION_FEED_PAGE_SIZE = 25;

export const SUPERVISOR_NOTIFICATION_PERMISSIONS = [
  'canApproveClosings',
  'canViewAllClosings',
  'canManagePurchases',
  'canManageSuppliers',
  'canViewSuppliers',
  'canViewFinancialReports',
] as const;

export type NotificationSupervisorPermission =
  (typeof SUPERVISOR_NOTIFICATION_PERMISSIONS)[number];

const INVERTED_TIME_MAX_MS = 9_999_999_999_999;

function fnv1a32(input: string, seedOffset = 0): string {
  let hash = (0x811c9dc5 + seedOffset) >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function buildNotificationHash(dedupKey: string): string {
  return `${fnv1a32(dedupKey, 0)}${fnv1a32(dedupKey, 0x9e3779b9)}`;
}

/**
 * Produces a deterministic, Firestore-rule-safe ID that ALSO sorts newest-first
 * under ascending `orderBy(documentId(), 'asc')` without requiring any composite index.
 */
export function buildNotificationId(dedupKey: string, createdAtIso?: string): string {
  const parsedMs = createdAtIso ? Date.parse(createdAtIso) : Date.now();
  const safeMs =
    Number.isFinite(parsedMs) && parsedMs > 0 && parsedMs < INVERTED_TIME_MAX_MS
      ? parsedMs
      : Date.now();
  const invBase36 = Math.max(0, INVERTED_TIME_MAX_MS - Math.floor(safeMs))
    .toString(36)
    .padStart(9, '0');
  return `ntf_${invBase36}_${buildNotificationHash(dedupKey)}`;
}

export function truncateText(value: string | undefined | null, maxLen: number, fallback = ''): string {
  const cleaned = (value || '').trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

export function buildTenantFeedKeys(params: {
  audienceScope: Exclude<NotificationAudienceScope, 'super_admin'>;
  orgId: string;
  recipientUid?: string;
  branchId?: string;
  requiredPermission?: NotificationSupervisorPermission;
  secondaryPermission?: NotificationSupervisorPermission;
  includeOrgManager?: boolean;
  includeBranchManager?: boolean;
}): string[] {
  const keys = new Set<string>();
  const { audienceScope, orgId } = params;

  if (audienceScope === 'user') {
    if (params.recipientUid) {
      keys.add(`user:${orgId}:${params.recipientUid}`);
    }
    return Array.from(keys);
  }

  if (audienceScope === 'org_manager') {
    keys.add(`org_mgr:${orgId}`);
    return Array.from(keys);
  }

  if (audienceScope === 'branch_manager') {
    if (params.branchId) {
      keys.add(`branch_mgr:${orgId}:${params.branchId}`);
    }
    if (params.includeOrgManager) {
      keys.add(`org_mgr:${orgId}`);
    }
    return Array.from(keys).slice(0, 4);
  }

  // org_supervisor_permission
  if (params.requiredPermission) {
    keys.add(`org_perm:${orgId}:${params.requiredPermission}`);
  }
  if (params.secondaryPermission) {
    keys.add(`org_perm:${orgId}:${params.secondaryPermission}`);
  }
  if (params.includeOrgManager !== false) {
    keys.add(`org_mgr:${orgId}`);
  }
  if (params.includeBranchManager && params.branchId) {
    keys.add(`branch_mgr:${orgId}:${params.branchId}`);
  }
  return Array.from(keys).slice(0, 4);
}

export interface CreateNotificationPayloadParams {
  dedupKey: string;
  category: NotificationCategory;
  type: string;
  severity: NotificationSeverity;
  audienceScope: NotificationAudienceScope;
  orgId: string;
  relatedOrgId?: string;
  branchId?: string;
  branchName?: string;
  recipientUid?: string;
  requiredPermission?: NotificationSupervisorPermission;
  secondaryPermission?: NotificationSupervisorPermission;
  includeOrgManager?: boolean;
  includeBranchManager?: boolean;
  actorUid: string;
  actorName: string;
  actorRole: string;
  title: string;
  body: string;
  targetType?: NotificationTargetType;
  targetId?: string;
  navTarget?: NotificationNavTarget;
  createdAt?: string;
}

export function createNotificationPayload(params: CreateNotificationPayloadParams): AppNotification {
  const createdAt = params.createdAt || new Date().toISOString();
  const id = buildNotificationId(params.dedupKey, createdAt);
  const feedKeys =
    params.audienceScope === 'super_admin'
      ? ['super_admin']
      : buildTenantFeedKeys({
          audienceScope: params.audienceScope,
          orgId: params.orgId,
          recipientUid: params.recipientUid,
          branchId: params.branchId,
          requiredPermission: params.requiredPermission,
          secondaryPermission: params.secondaryPermission,
          includeOrgManager: params.includeOrgManager,
          includeBranchManager: params.includeBranchManager,
        });

  const cleanNavTarget: NotificationNavTarget | undefined = params.navTarget
    ? {
        surface: params.navTarget.surface,
        ...(params.navTarget.tab ? { tab: params.navTarget.tab } : {}),
        ...(params.navTarget.entityId ? { entityId: params.navTarget.entityId } : {}),
        ...(params.navTarget.branchId ? { branchId: params.navTarget.branchId } : {}),
      }
    : undefined;

  return {
    id,
    dedupKey: truncateText(params.dedupKey, 200, id),
    category: params.category,
    type: truncateText(params.type, 80, 'SYSTEM_EVENT'),
    severity: params.severity,
    audienceScope: params.audienceScope,
    orgId: params.audienceScope === 'super_admin' ? 'platform' : params.orgId,
    ...(params.relatedOrgId ? { relatedOrgId: params.relatedOrgId } : {}),
    ...(params.branchId ? { branchId: params.branchId } : {}),
    ...(params.branchName ? { branchName: truncateText(params.branchName, 120) } : {}),
    ...(params.recipientUid ? { recipientUid: params.recipientUid } : {}),
    ...(params.requiredPermission ? { requiredPermission: params.requiredPermission } : {}),
    ...(params.secondaryPermission ? { secondaryPermission: params.secondaryPermission } : {}),
    feedKeys,
    actorUid: params.actorUid,
    actorName: truncateText(params.actorName, 120, 'النظام'),
    actorRole: truncateText(params.actorRole, 40, 'system'),
    title: truncateText(params.title, 160, 'إشعار جديد'),
    body: truncateText(params.body, 1000, 'لديك تحديث جديد في النظام.'),
    ...(params.targetType ? { targetType: params.targetType } : {}),
    ...(params.targetId ? { targetId: params.targetId } : {}),
    ...(cleanNavTarget ? { navTarget: cleanNavTarget } : {}),
    readBy: {},
    ...(params.audienceScope === 'user' ? { isRead: false } : {}),
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Resolves the exact Firestore `array-contains` feedKeys a signed-in user is allowed to subscribe to.
 * Mirrors `firestore.rules` 1-to-1 so `allow list` never fails due to mismatched rule scopes.
 */
export function resolveFeedKeysForUser(params: {
  surface: 'tenant' | 'super_admin';
  isSuperAdmin: boolean;
  uid?: string | null;
  userProfile?: UserProfile | null;
  orgId?: string | null;
}): string[] {
  if (params.surface === 'super_admin') {
    return params.isSuperAdmin ? ['super_admin'] : [];
  }

  const { userProfile, uid, orgId } = params;
  if (!uid || !orgId || !userProfile || !userProfile.isActive || userProfile.orgId !== orgId) {
    return [];
  }

  const keys = new Set<string>([`user:${orgId}:${uid}`]);

  if (userProfile.role === 'manager') {
    keys.add(`org_mgr:${orgId}`);
    return Array.from(keys);
  }

  if (userProfile.role === 'branch_manager') {
    const branchId = resolvePrimaryAssignedBranchId(userProfile);
    if (branchId) {
      keys.add(`branch_mgr:${orgId}:${branchId}`);
    }
    return Array.from(keys);
  }

  if (userProfile.role === 'supervisor') {
    const perms = resolveEffectivePermissions(userProfile);
    for (const permKey of SUPERVISOR_NOTIFICATION_PERMISSIONS) {
      if (perms[permKey] === true) {
        keys.add(`org_perm:${orgId}:${permKey}`);
      }
    }
    return Array.from(keys);
  }

  // 'employee' receives strictly personal notifications only
  return Array.from(keys);
}

/**
 * Resolves the single authorized Firestore `feedKeys` partition that the current actor
 * can safely query via `allow list` to verify whether a deterministic notification ID
 * already exists without issuing a blind `getDoc` (which yields `permission-denied`
 * when `resource == null`) and without probing feeds outside the caller's scope.
 * Returns `null` when the actor is writing to another role's feed (e.g. employee -> org_manager).
 */
export function resolveAuthorizedNotificationCheckFeedKey(
  item: Pick<AppNotification, 'audienceScope' | 'orgId' | 'recipientUid' | 'feedKeys'>,
  context: {
    uid?: string | null;
    isSuperAdmin: boolean;
    userProfile?: Pick<UserProfile, 'role' | 'isActive' | 'orgId'> | null;
  }
): string | null {
  if (!item || !item.orgId) return null;

  if (item.audienceScope === 'super_admin') {
    if (
      context.isSuperAdmin === true &&
      item.orgId === 'platform' &&
      Array.isArray(item.feedKeys) &&
      item.feedKeys.includes('super_admin')
    ) {
      return 'super_admin';
    }
    return null;
  }

  const u = context.userProfile;
  if (!context.uid || !u || u.isActive !== true || u.orgId !== item.orgId) {
    return null;
  }

  if (item.audienceScope === 'org_manager' && u.role === 'manager') {
    const feedKey = `org_mgr:${item.orgId}`;
    return Array.isArray(item.feedKeys) && item.feedKeys.includes(feedKey) ? feedKey : null;
  }

  if (item.audienceScope === 'user' && item.recipientUid === context.uid) {
    const feedKey = `user:${item.orgId}:${context.uid}`;
    return Array.isArray(item.feedKeys) && item.feedKeys.includes(feedKey) ? feedKey : null;
  }

  return null;
}

/**
 * Strict client-side mirror of Firestore Security Rules role & tenant isolation.
 */
export function canUserReceiveNotification(
  notification: AppNotification,
  context: {
    surface: 'tenant' | 'super_admin';
    isSuperAdmin: boolean;
    uid?: string | null;
    userProfile?: UserProfile | null;
    orgId?: string | null;
  }
): boolean {
  if (context.surface === 'super_admin') {
    return (
      context.isSuperAdmin === true &&
      notification.audienceScope === 'super_admin' &&
      notification.feedKeys.includes('super_admin')
    );
  }

  const { uid, userProfile, orgId } = context;
  if (!uid || !orgId || !userProfile || userProfile.isActive !== true) {
    return false;
  }
  if (userProfile.orgId !== orgId || notification.orgId !== orgId) {
    return false;
  }

  if (notification.audienceScope === 'super_admin') {
    return false;
  }

  if (notification.audienceScope === 'user') {
    return notification.recipientUid === uid;
  }

  if (userProfile.role === 'manager') {
    return notification.feedKeys.includes(`org_mgr:${orgId}`);
  }

  if (userProfile.role === 'branch_manager') {
    const branchId = resolvePrimaryAssignedBranchId(userProfile);
    return Boolean(
      branchId &&
        notification.branchId === branchId &&
        notification.feedKeys.includes(`branch_mgr:${orgId}:${branchId}`)
    );
  }

  if (userProfile.role === 'supervisor') {
    const perms = resolveEffectivePermissions(userProfile);
    const reqPerm = notification.requiredPermission as keyof UserPermissions | undefined;
    const secPerm = notification.secondaryPermission as keyof UserPermissions | undefined;
    const hasReq = Boolean(
      reqPerm &&
        perms[reqPerm] === true &&
        notification.feedKeys.includes(`org_perm:${orgId}:${String(reqPerm)}`)
    );
    const hasSec = Boolean(
      secPerm &&
        perms[secPerm] === true &&
        notification.feedKeys.includes(`org_perm:${orgId}:${String(secPerm)}`)
    );
    return hasReq || hasSec;
  }

  return false;
}

export function isNotificationReadByUser(
  notification: Pick<AppNotification, 'readBy' | 'audienceScope' | 'recipientUid' | 'isRead'>,
  uid?: string | null
): boolean {
  if (!uid) return false;
  if (notification.readBy && typeof notification.readBy[uid] === 'string' && notification.readBy[uid].length > 0) {
    return true;
  }
  if (
    notification.audienceScope === 'user' &&
    notification.recipientUid === uid &&
    notification.isRead === true
  ) {
    return true;
  }
  return false;
}

export function mergeAndSortNotifications(
  items: AppNotification[],
  context: {
    surface: 'tenant' | 'super_admin';
    isSuperAdmin: boolean;
    uid?: string | null;
    userProfile?: UserProfile | null;
    orgId?: string | null;
  }
): AppNotification[] {
  const map = new Map<string, AppNotification>();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!canUserReceiveNotification(item, context)) continue;
    const existing = map.get(item.id);
    if (!existing || item.updatedAt >= existing.updatedAt) {
      map.set(item.id, item);
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const diff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (Number.isFinite(diff) && diff !== 0) {
      return diff;
    }
    return a.id.localeCompare(b.id);
  });
}

// =============================================================================
// Builders for All 6 Supported Notification Categories
// =============================================================================

export type EmployeeEventAction =
  | 'created'
  | 'disabled'
  | 'reactivated'
  | 'archived'
  | 'branch_changed'
  | 'role_permissions_updated';

export function buildEmployeeLifecycleNotifications(params: {
  action: EmployeeEventAction;
  orgId: string;
  actorUid: string;
  actorName: string;
  employeeUid: string;
  employeeName: string;
  employeeRole: UserRole;
  branchId?: string;
  branchName?: string;
  createdAt?: string;
}): AppNotification[] {
  const createdAt = params.createdAt || new Date().toISOString();
  const roleAr =
    params.employeeRole === 'supervisor'
      ? 'مسؤول'
      : params.employeeRole === 'branch_manager'
      ? 'مسؤول فرع'
      : 'موظف';

  const copyMap: Record<
    EmployeeEventAction,
    {
      type: string;
      severity: NotificationSeverity;
      mgrTitle: string;
      mgrBody: string;
      userTitle: string;
      userBody: string;
    }
  > = {
    created: {
      type: 'EMPLOYEE_CREATED',
      severity: 'info',
      mgrTitle: 'إضافة عضو جديد للفريق',
      mgrBody: `تم إنشاء حساب ${roleAr} للمستخدم ${params.employeeName}${
        params.branchName ? ` في فرع ${params.branchName}` : ' (نطاق المؤسسة)'
      }.`,
      userTitle: 'مرحباً بك في نظام الإقفال',
      userBody: `تم تفعيل حسابك بدور (${roleAr})${
        params.branchName ? ` على فرع ${params.branchName}` : ''
      }. يمكنك الآن تسجيل إقفالاتك ومتابعة التنبيهات.`,
    },
    disabled: {
      type: 'EMPLOYEE_DISABLED',
      severity: 'warning',
      mgrTitle: 'تعطيل حساب موظف',
      mgrBody: `تم تعطيل دخول ${params.employeeName} مؤقتاً مع حفظ جميع سجلاته المالية.`,
      userTitle: 'تم إيقاف حسابك مؤقتاً',
      userBody: 'تم تعطيل صلاحية الدخول لحسابك من قِبل مدير المؤسسة.',
    },
    reactivated: {
      type: 'EMPLOYEE_REACTIVATED',
      severity: 'success',
      mgrTitle: 'إعادة تنشيط حساب موظف',
      mgrBody: `تمت إعادة تنشيط حساب ${params.employeeName} بنجاح.`,
      userTitle: 'تمت إعادة تنشيط حسابك',
      userBody: 'أصبح حسابك نشطاً الآن ويمكنك استخدام النظام بشكل طبيعي.',
    },
    archived: {
      type: 'EMPLOYEE_ARCHIVED',
      severity: 'warning',
      mgrTitle: 'أرشفة حساب موظف',
      mgrBody: `تمت أرشفة حساب ${params.employeeName} وإيقافه مع الإبقاء على كامل تاريخه المالي.`,
      userTitle: 'تمت أرشفة حسابك',
      userBody: 'تم إنهاء صلاحية الدخول وأرشفة الحساب من قِبل إدارة المؤسسة.',
    },
    branch_changed: {
      type: 'EMPLOYEE_BRANCH_CHANGED',
      severity: 'info',
      mgrTitle: 'نقل موظف إلى فرع آخر',
      mgrBody: `تم نقل ${params.employeeName} إلى فرع ${params.branchName || 'جديد'}.`,
      userTitle: 'تحديث الفرع المخصص لك',
      userBody: `تم نقلك إلى فرع ${params.branchName || 'جديد'} بواسطة مدير المؤسسة.`,
    },
    role_permissions_updated: {
      type: 'EMPLOYEE_ROLE_PERMISSIONS_UPDATED',
      severity: 'warning',
      mgrTitle: 'تحديث دور وصلاحيات موظف',
      mgrBody: `تم تعديل دور/صلاحيات ${params.employeeName} إلى (${roleAr})${
        params.branchName ? ` — فرع ${params.branchName}` : ''
      }.`,
      userTitle: 'تم تحديث دورك وصلاحياتك',
      userBody: `تم تحديث صلاحيات حسابك إلى دور (${roleAr})${
        params.branchName ? ` لفرع ${params.branchName}` : ''
      }.`,
    },
  };

  const copy = copyMap[params.action];
  const notifications: AppNotification[] = [];

  notifications.push(
    createNotificationPayload({
      dedupKey: `emp_${params.action}_mgr:${params.orgId}:${params.employeeUid}:${createdAt}`,
      category: 'employees',
      type: copy.type,
      severity: copy.severity,
      audienceScope: 'org_manager',
      orgId: params.orgId,
      ...(params.branchId ? { branchId: params.branchId } : {}),
      ...(params.branchName ? { branchName: params.branchName } : {}),
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'manager',
      title: copy.mgrTitle,
      body: copy.mgrBody,
      targetType: 'employee',
      targetId: params.employeeUid,
      navTarget: { surface: 'tenant', tab: 'employees', entityId: params.employeeUid },
      createdAt,
    })
  );

  // Personal notification for the affected employee
  if (params.employeeUid !== params.actorUid) {
    notifications.push(
      createNotificationPayload({
        dedupKey: `emp_${params.action}_user:${params.orgId}:${params.employeeUid}:${createdAt}`,
        category:
          params.action === 'disabled' || params.action === 'archived' || params.action === 'role_permissions_updated'
            ? 'security_admin'
            : 'employees',
        type: copy.type,
        severity: copy.severity,
        audienceScope: 'user',
        orgId: params.orgId,
        recipientUid: params.employeeUid,
        ...(params.branchId ? { branchId: params.branchId } : {}),
        ...(params.branchName ? { branchName: params.branchName } : {}),
        actorUid: params.actorUid,
        actorName: params.actorName,
        actorRole: 'manager',
        title: copy.userTitle,
        body: copy.userBody,
        targetType: 'employee',
        targetId: params.employeeUid,
        navTarget: { surface: 'tenant', tab: 'workspace', entityId: params.employeeUid },
        createdAt,
      })
    );
  }

  return notifications;
}

export function buildClosingSubmittedNotifications(params: {
  closing: ShiftClosing;
  isResubmission?: boolean;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  createdAt?: string;
}): AppNotification[] {
  const createdAt = params.createdAt || params.closing.updatedAt || new Date().toISOString();
  const { closing } = params;
  const periodAr = closing.period === 'morning' ? 'الصباحية' : 'المسائية';
  const actionType = params.isResubmission ? 'CLOSING_RESUBMITTED' : 'CLOSING_SUBMITTED';

  // Single deduplicated document routed to org managers, permitted supervisors, AND branch manager of this branch
  return [
    createNotificationPayload({
      dedupKey: `closing_submit:${closing.id}:${createdAt}`,
      category: 'closings',
      type: actionType,
      severity: 'info',
      audienceScope: 'org_supervisor_permission',
      orgId: closing.orgId,
      branchId: closing.branchId,
      branchName: closing.branchName,
      requiredPermission: 'canApproveClosings',
      secondaryPermission: 'canViewAllClosings',
      includeOrgManager: true,
      includeBranchManager: true,
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      title: params.isResubmission
        ? 'إعادة إرسال إقفال وردية للمراجعة'
        : 'إقفال وردية جديد بانتظار المراجعة',
      body: `قام ${params.actorName} بإرسال إقفال الوردية ${periodAr} لفرع ${closing.branchName} بتاريخ ${closing.date} (إجمالي المبيعات: ${closing.totalSales}).`,
      targetType: 'closing',
      targetId: closing.id,
      navTarget: {
        surface: 'tenant',
        tab: 'closings',
        entityId: closing.id,
        branchId: closing.branchId,
      },
      createdAt,
    }),
  ];
}

export function buildClosingReviewedNotifications(params: {
  closing: ShiftClosing;
  action: 'approve' | 'reject';
  rejectionReason?: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  createdAt?: string;
}): AppNotification[] {
  const createdAt = params.createdAt || new Date().toISOString();
  const { closing } = params;
  const periodAr = closing.period === 'morning' ? 'الصباحية' : 'المسائية';
  const isApproved = params.action === 'approve';
  const result: AppNotification[] = [];

  // 1. Personal notification to the closing owner/employee
  result.push(
    createNotificationPayload({
      dedupKey: `closing_review_user:${closing.id}:${params.action}:${createdAt}`,
      category: 'closings',
      type: isApproved ? 'CLOSING_APPROVED' : 'CLOSING_REJECTED',
      severity: isApproved ? 'success' : 'warning',
      audienceScope: 'user',
      orgId: closing.orgId,
      branchId: closing.branchId,
      branchName: closing.branchName,
      recipientUid: closing.employeeId,
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      title: isApproved ? 'تم اعتماد إقفال الوردية' : 'تمت إعادة الإقفال للتعديل',
      body: isApproved
        ? `تم اعتماد إقفال الوردية ${periodAr} لفرع ${closing.branchName} بتاريخ ${closing.date} من قِبل ${params.actorName}.`
        : `أُعيد إقفال الوردية ${periodAr} لفرع ${closing.branchName} بتاريخ ${closing.date} للتعديل. السبب: ${
            params.rejectionReason || 'يرجى المراجعة'
          }`,
      targetType: 'closing',
      targetId: closing.id,
      navTarget: {
        surface: 'tenant',
        tab: 'workspace',
        entityId: closing.id,
        branchId: closing.branchId,
      },
      createdAt,
    })
  );

  // 2. Branch-scoped status notification for Branch Manager + Org Manager
  if (closing.branchId) {
    result.push(
      createNotificationPayload({
        dedupKey: `closing_review_branch:${closing.id}:${params.action}:${createdAt}`,
        category: 'closings',
        type: isApproved ? 'CLOSING_APPROVED' : 'CLOSING_REJECTED',
        severity: isApproved ? 'success' : 'warning',
        audienceScope: 'branch_manager',
        orgId: closing.orgId,
        branchId: closing.branchId,
        branchName: closing.branchName,
        includeOrgManager: false,
        actorUid: params.actorUid,
        actorName: params.actorName,
        actorRole: params.actorRole,
        title: isApproved
          ? `اعتماد إقفال فرع ${closing.branchName}`
          : `إرجاع إقفال فرع ${closing.branchName} للتعديل`,
        body: isApproved
          ? `تم اعتماد إقفال ${closing.employeeName} (${periodAr} — ${closing.date}).`
          : `تم إرجاع إقفال ${closing.employeeName} (${periodAr} — ${closing.date}) للتعديل.`,
        targetType: 'closing',
        targetId: closing.id,
        navTarget: {
          surface: 'tenant',
          tab: 'workspace',
          entityId: closing.id,
          branchId: closing.branchId,
        },
        createdAt,
      })
    );
  }

  return result;
}

export function buildClosingAdminCorrectedNotifications(params: {
  closing: ShiftClosing;
  correctionReason: string;
  actorUid: string;
  actorName: string;
  createdAt?: string;
}): AppNotification[] {
  const createdAt = params.createdAt || new Date().toISOString();
  const { closing } = params;
  const periodAr = closing.period === 'morning' ? 'الصباحية' : 'المسائية';
  const result: AppNotification[] = [];

  if (closing.employeeId && closing.employeeId !== params.actorUid) {
    result.push(
      createNotificationPayload({
        dedupKey: `closing_correct_user:${closing.id}:${createdAt}`,
        category: 'closings',
        type: 'CLOSING_ADMIN_CORRECTED',
        severity: 'warning',
        audienceScope: 'user',
        orgId: closing.orgId,
        branchId: closing.branchId,
        branchName: closing.branchName,
        recipientUid: closing.employeeId,
        actorUid: params.actorUid,
        actorName: params.actorName,
        actorRole: 'manager',
        title: 'تصحيح إداري على إقفال معتمد',
        body: `أجرى المدير ${params.actorName} تصحيحاً إدارياً على إقفال ${periodAr} (${closing.date}). السبب: ${params.correctionReason}`,
        targetType: 'closing',
        targetId: closing.id,
        navTarget: {
          surface: 'tenant',
          tab: 'workspace',
          entityId: closing.id,
          branchId: closing.branchId,
        },
        createdAt,
      })
    );
  }

  result.push(
    createNotificationPayload({
      dedupKey: `closing_correct_mgr:${closing.id}:${createdAt}`,
      category: 'security_admin',
      type: 'CLOSING_ADMIN_CORRECTED',
      severity: 'warning',
      audienceScope: 'org_manager',
      orgId: closing.orgId,
      branchId: closing.branchId,
      branchName: closing.branchName,
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'manager',
      title: 'تنفيذ تصحيح إداري على إقفال معتمد',
      body: `تم تسجيل تصحيح إداري على إقفال فرع ${closing.branchName} (${closing.date} — ${periodAr}). السبب: ${params.correctionReason}`,
      targetType: 'closing',
      targetId: closing.id,
      navTarget: {
        surface: 'tenant',
        tab: 'audit',
        entityId: closing.id,
        branchId: closing.branchId,
      },
      createdAt,
    })
  );

  return result;
}

// =============================================================================
// Category 3 Builders: Schedule / Attendance Requests (Ready Schema & Helpers)
// =============================================================================

export function buildDayOffRequestedNotification(params: {
  requestId: string;
  orgId: string;
  branchId: string;
  branchName: string;
  requesterUid: string;
  requesterName: string;
  requesterRole: UserRole;
  requestedDate: string;
  reason?: string;
  createdAt?: string;
}): AppNotification {
  return createNotificationPayload({
    dedupKey: `sched_dayoff:${params.requestId}`,
    category: 'schedule_requests',
    type: 'SCHEDULE_DAY_OFF_REQUESTED',
    severity: 'info',
    audienceScope: 'branch_manager',
    orgId: params.orgId,
    branchId: params.branchId,
    branchName: params.branchName,
    includeOrgManager: true,
    actorUid: params.requesterUid,
    actorName: params.requesterName,
    actorRole: params.requesterRole,
    title: 'طلب إجازة جديد',
    body: `تقدم ${params.requesterName} بطلب إجازة بتاريخ ${params.requestedDate} لفرع ${params.branchName}${
      params.reason ? ` — ${params.reason}` : ''
    }.`,
    targetType: 'schedule_request',
    targetId: params.requestId,
    navTarget: { surface: 'tenant', tab: 'overview', branchId: params.branchId },
    createdAt: params.createdAt,
  });
}

export function buildShiftSwapRequestedNotifications(params: {
  requestId: string;
  orgId: string;
  branchId: string;
  branchName: string;
  requesterUid: string;
  requesterName: string;
  requesterRole: UserRole;
  partnerUid: string;
  partnerName: string;
  shiftDate: string;
  createdAt?: string;
}): AppNotification[] {
  const createdAt = params.createdAt || new Date().toISOString();
  return [
    createNotificationPayload({
      dedupKey: `sched_swap_mgr:${params.requestId}`,
      category: 'schedule_requests',
      type: 'SCHEDULE_SWAP_REQUESTED',
      severity: 'info',
      audienceScope: 'branch_manager',
      orgId: params.orgId,
      branchId: params.branchId,
      branchName: params.branchName,
      includeOrgManager: true,
      actorUid: params.requesterUid,
      actorName: params.requesterName,
      actorRole: params.requesterRole,
      title: 'طلب تبديل وردية',
      body: `طلب ${params.requesterName} تبديل وردية بتاريخ ${params.shiftDate} مع ${params.partnerName} في فرع ${params.branchName}.`,
      targetType: 'schedule_request',
      targetId: params.requestId,
      navTarget: { surface: 'tenant', tab: 'overview', branchId: params.branchId },
      createdAt,
    }),
    createNotificationPayload({
      dedupKey: `sched_swap_partner:${params.requestId}:${params.partnerUid}`,
      category: 'schedule_requests',
      type: 'SCHEDULE_SWAP_PARTNER_INVITE',
      severity: 'info',
      audienceScope: 'user',
      orgId: params.orgId,
      branchId: params.branchId,
      branchName: params.branchName,
      recipientUid: params.partnerUid,
      actorUid: params.requesterUid,
      actorName: params.requesterName,
      actorRole: params.requesterRole,
      title: 'طلب تبديل وردية موجّه إليك',
      body: `دعاك ${params.requesterName} لتبديل الوردية بتاريخ ${params.shiftDate} في فرع ${params.branchName}.`,
      targetType: 'schedule_request',
      targetId: params.requestId,
      navTarget: { surface: 'tenant', tab: 'workspace', branchId: params.branchId },
      createdAt,
    }),
  ];
}

export function buildScheduleRequestDecisionNotifications(params: {
  requestId: string;
  orgId: string;
  branchId: string;
  branchName: string;
  requestKind: 'day_off' | 'shift_swap';
  decision: 'approved' | 'rejected';
  requesterUid: string;
  partnerUid?: string;
  actorUid: string;
  actorName: string;
  note?: string;
  createdAt?: string;
}): AppNotification[] {
  const createdAt = params.createdAt || new Date().toISOString();
  const isApproved = params.decision === 'approved';
  const kindLabel = params.requestKind === 'day_off' ? 'طلب الإجازة' : 'طلب تبديل الوردية';
  const res: AppNotification[] = [
    createNotificationPayload({
      dedupKey: `sched_dec_req:${params.requestId}:${params.decision}`,
      category: 'schedule_requests',
      type: isApproved ? 'SCHEDULE_REQUEST_APPROVED' : 'SCHEDULE_REQUEST_REJECTED',
      severity: isApproved ? 'success' : 'warning',
      audienceScope: 'user',
      orgId: params.orgId,
      branchId: params.branchId,
      branchName: params.branchName,
      recipientUid: params.requesterUid,
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'manager',
      title: isApproved ? `تمت الموافقة على ${kindLabel}` : `تم رفض ${kindLabel}`,
      body: `قرر ${params.actorName} ${isApproved ? 'الموافقة على' : 'رفض'} ${kindLabel}${
        params.note ? ` (${params.note})` : ''
      }.`,
      targetType: 'schedule_request',
      targetId: params.requestId,
      navTarget: { surface: 'tenant', tab: 'workspace', branchId: params.branchId },
      createdAt,
    }),
  ];

  if (params.partnerUid && params.partnerUid !== params.requesterUid) {
    res.push(
      createNotificationPayload({
        dedupKey: `sched_dec_partner:${params.requestId}:${params.decision}`,
        category: 'schedule_requests',
        type: isApproved ? 'SCHEDULE_SWAP_CONFIRMED' : 'SCHEDULE_SWAP_DECLINED',
        severity: isApproved ? 'success' : 'warning',
        audienceScope: 'user',
        orgId: params.orgId,
        branchId: params.branchId,
        branchName: params.branchName,
        recipientUid: params.partnerUid,
        actorUid: params.actorUid,
        actorName: params.actorName,
        actorRole: 'manager',
        title: isApproved ? 'تأكيد تبديل الوردية' : 'إلغاء/رفض تبديل الوردية',
        body: `تم ${isApproved ? 'اعتماد' : 'رفض'} طلب تبديل الوردية المرتبط بك من قِبل ${params.actorName}.`,
        targetType: 'schedule_request',
        targetId: params.requestId,
        navTarget: { surface: 'tenant', tab: 'workspace', branchId: params.branchId },
        createdAt,
      })
    );
  }

  return res;
}

// =============================================================================
// Category 4 Builders: Purchases & Suppliers (Ready Schema & Helpers)
// =============================================================================

export function buildPurchaseRecordedNotification(params: {
  purchaseId: string;
  orgId: string;
  branchId: string;
  branchName: string;
  supplierName: string;
  totalAmount: number;
  currency: string;
  needsReview?: boolean;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  createdAt?: string;
}): AppNotification {
  return createNotificationPayload({
    dedupKey: `purchase_rec:${params.purchaseId}`,
    category: 'purchases_suppliers',
    type: params.needsReview ? 'PURCHASE_REVIEW_NEEDED' : 'PURCHASE_INVOICE_RECORDED',
    severity: params.needsReview ? 'warning' : 'info',
    audienceScope: 'org_supervisor_permission',
    orgId: params.orgId,
    branchId: params.branchId,
    branchName: params.branchName,
    requiredPermission: 'canManagePurchases',
    secondaryPermission: 'canViewFinancialReports',
    includeOrgManager: true,
    includeBranchManager: true,
    actorUid: params.actorUid,
    actorName: params.actorName,
    actorRole: params.actorRole,
    title: params.needsReview ? 'فاتورة مشتريات تحتاج مراجعة' : 'تسجيل فاتورة مشتريات جديدة',
    body: `سجل ${params.actorName} فاتورة مشتريات من المورد (${params.supplierName}) بمبلغ ${params.totalAmount} ${params.currency} لفرع ${params.branchName}.`,
    targetType: 'purchase',
    targetId: params.purchaseId,
    navTarget: { surface: 'tenant', tab: 'purchases', entityId: params.purchaseId, branchId: params.branchId },
    createdAt: params.createdAt,
  });
}

export function buildSupplierAddedNotification(params: {
  supplierId: string;
  orgId: string;
  supplierName: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  createdAt?: string;
}): AppNotification {
  return createNotificationPayload({
    dedupKey: `supplier_add:${params.supplierId}`,
    category: 'purchases_suppliers',
    type: 'SUPPLIER_ADDED',
    severity: 'info',
    audienceScope: 'org_supervisor_permission',
    orgId: params.orgId,
    requiredPermission: 'canManageSuppliers',
    secondaryPermission: 'canViewSuppliers',
    includeOrgManager: true,
    actorUid: params.actorUid,
    actorName: params.actorName,
    actorRole: params.actorRole,
    title: 'إضافة مورد جديد',
    body: `تم تسجيل المورد "${params.supplierName}" في دليل موردي المؤسسة بواسطة ${params.actorName}.`,
    targetType: 'supplier',
    targetId: params.supplierId,
    navTarget: { surface: 'tenant', tab: 'suppliers', entityId: params.supplierId },
    createdAt: params.createdAt,
  });
}

// =============================================================================
// Category 5 & 6 Builders: Org/Branch Lifecycle, Super Admin, & Security/Admin
// =============================================================================

export function buildSuperAdminPlatformNotification(params: {
  dedupKey: string;
  category: NotificationCategory;
  type: string;
  severity: NotificationSeverity;
  relatedOrgId?: string;
  branchId?: string;
  branchName?: string;
  actorUid: string;
  actorName: string;
  title: string;
  body: string;
  targetType: NotificationTargetType;
  targetId: string;
  tab?: 'organizations' | 'branches' | 'invites' | 'auditLogs';
  createdAt?: string;
}): AppNotification {
  return createNotificationPayload({
    dedupKey: params.dedupKey,
    category: params.category,
    type: params.type,
    severity: params.severity,
    audienceScope: 'super_admin',
    orgId: 'platform',
    relatedOrgId: params.relatedOrgId,
    branchId: params.branchId,
    branchName: params.branchName,
    actorUid: params.actorUid,
    actorName: params.actorName,
    actorRole: 'super_admin',
    title: params.title,
    body: params.body,
    targetType: params.targetType,
    targetId: params.targetId,
    navTarget: {
      surface: 'super_admin',
      tab: params.tab || 'organizations',
      entityId: params.targetId,
      branchId: params.branchId,
    },
    createdAt: params.createdAt,
  });
}

/**
 * Evaluates deterministic daily threshold alerts for an organization manager
 * (subscription expiry within 7 days, no-paid-branch 7-day grace, suspended branch 30-day grace).
 */
export function buildOrgThresholdNotifications(params: {
  org: Organization;
  branches: Branch[];
  actorUid: string;
  actorName: string;
  now?: Date;
}): AppNotification[] {
  const now = params.now || new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const createdAt = `${dayKey}T00:00:00.000Z`;
  const results: AppNotification[] = [];

  const subEval = evaluateOrganizationSubscription(params.org, now);
  if (!subEval.isLegacy && subEval.isAllowed && subEval.endDate) {
    const msLeft = subEval.endDate.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    if (daysLeft >= 0 && daysLeft <= 7) {
      results.push(
        createNotificationPayload({
          dedupKey: `org_sub_expiring:${params.org.id}:${dayKey}`,
          category: 'org_branches',
          type: 'ORG_SUBSCRIPTION_EXPIRING',
          severity: daysLeft <= 2 ? 'critical' : 'warning',
          audienceScope: 'org_manager',
          orgId: params.org.id,
          actorUid: params.actorUid,
          actorName: params.actorName,
          actorRole: 'manager',
          title: 'تنبيه اقتراب انتهاء الاشتراك',
          body: `يتبقى ${daysLeft} ${daysLeft === 1 ? 'يوم' : 'أيام'} على انتهاء اشتراك مؤسسة "${params.org.name}" (${subEval.endDate
            .toISOString()
            .slice(0, 10)}). يرجى التجديد لتفادي توقف الدخول.`,
          targetType: 'organization',
          targetId: params.org.id,
          navTarget: { surface: 'tenant', tab: 'settings', entityId: params.org.id },
          createdAt,
        })
      );
    }
  }

  const graceEval = evaluateOrgNoPaidBranchGrace(params.org, params.branches, now);
  if (graceEval.inGrace && !graceEval.isLegacyExempt && graceEval.deactivationDueAt) {
    results.push(
      createNotificationPayload({
        dedupKey: `org_no_paid_branch:${params.org.id}:${dayKey}`,
        category: 'org_branches',
        type: 'ORG_NO_PAID_BRANCH_WARNING',
        severity: 'critical',
        audienceScope: 'org_manager',
        orgId: params.org.id,
        actorUid: params.actorUid,
        actorName: params.actorName,
        actorRole: 'manager',
        title: 'تحذير مهلة 7 أيام — لا توجد فروع مدفوعة',
        body: `لا يوجد أي فرع مدفوع نشط حالياً. سيتم إيقاف المؤسسة بتاريخ ${graceEval.deactivationDueAt
          .toISOString()
          .slice(0, 10)} ما لم يتم سداد فرع واحد على الأقل.`,
        targetType: 'organization',
        targetId: params.org.id,
        navTarget: { surface: 'tenant', tab: 'branches', entityId: params.org.id },
        createdAt,
      })
    );
  }

  for (const branch of params.branches) {
    if (branch.orgId !== params.org.id) continue;
    const branchEval = evaluateBranchBillingAndGrace(branch, params.org, now);
    if (branchEval.isSuspended && !branchEval.isPurgedFromDb && branchEval.gracePeriodEndsAt) {
      const graceEndStr = branchEval.gracePeriodEndsAt.toISOString().slice(0, 10);
      results.push(
        createNotificationPayload({
          dedupKey: `org_branch_suspended_grace:${branch.id}:${dayKey}`,
          category: 'org_branches',
          type: branchEval.isGraceExpired
            ? 'BRANCH_GRACE_EXPIRED_WARNING'
            : 'BRANCH_SUSPENDED_GRACE_WARNING',
          severity: branchEval.isGraceExpired || (branchEval.graceRemainingDays ?? 30) <= 5 ? 'critical' : 'warning',
          audienceScope: 'org_manager',
          orgId: params.org.id,
          branchId: branch.id,
          branchName: branch.name,
          actorUid: params.actorUid,
          actorName: params.actorName,
          actorRole: 'manager',
          title: branchEval.isGraceExpired
            ? `انتهت مهلة الفرع المعلق "${branch.name}"`
            : `الفرع "${branch.name}" معلق في مهلة الـ 30 يوماً`,
          body: branchEval.isGraceExpired
            ? `انقضت مهلة الـ 30 يوماً للفرع المعلق "${branch.name}" (${graceEndStr}). تأكد من اكتمال النسخ الاحتياطي في Google Drive.`
            : `تم تعليق الفرع "${branch.name}". يتبقى ${branchEval.graceRemainingDays ?? 0} يوماً قبل انتهاء المهلة بتاريخ ${graceEndStr}.`,
          targetType: 'branch',
          targetId: branch.id,
          navTarget: { surface: 'tenant', tab: 'branches', entityId: branch.id, branchId: branch.id },
          createdAt,
        })
      );
    }
  }

  return results;
}

/**
 * Evaluates deterministic daily threshold alerts for Super Admin platform monitoring.
 */
export function buildSuperAdminThresholdNotifications(params: {
  organizations: Organization[];
  branches: Branch[];
  actorUid: string;
  actorName: string;
  now?: Date;
}): AppNotification[] {
  const now = params.now || new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const createdAt = `${dayKey}T00:00:00.000Z`;
  const results: AppNotification[] = [];
  const branchesByOrg = new Map<string, Branch[]>();
  for (const b of params.branches) {
    const arr = branchesByOrg.get(b.orgId) || [];
    arr.push(b);
    branchesByOrg.set(b.orgId, arr);
  }
  const orgMap = new Map(params.organizations.map((o) => [o.id, o]));

  for (const org of params.organizations) {
    const orgBranches = branchesByOrg.get(org.id) || [];
    const subEval = evaluateOrganizationSubscription(org, now);

    if (!subEval.isLegacy && subEval.endDate) {
      const daysLeft = Math.ceil((subEval.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (daysLeft <= 7 && daysLeft >= -3) {
        results.push(
          buildSuperAdminPlatformNotification({
            dedupKey: `sa_org_sub_alert:${org.id}:${dayKey}`,
            category: 'org_branches',
            type: daysLeft < 0 ? 'SA_ORG_SUBSCRIPTION_EXPIRED' : 'SA_ORG_SUBSCRIPTION_EXPIRING',
            severity: daysLeft <= 1 ? 'critical' : 'warning',
            relatedOrgId: org.id,
            actorUid: params.actorUid,
            actorName: params.actorName,
            title:
              daysLeft < 0
                ? `انتهى اشتراك مؤسسة "${org.name}"`
                : `قرب انتهاء اشتراك مؤسسة "${org.name}"`,
            body:
              daysLeft < 0
                ? `انتهى اشتراك مؤسسة "${org.name}" بتاريخ ${subEval.endDate.toISOString().slice(0, 10)}.`
                : `يتبقى ${daysLeft} يوماً على انتهاء اشتراك "${org.name}" (${subEval.endDate
                    .toISOString()
                    .slice(0, 10)}).`,
            targetType: 'organization',
            targetId: org.id,
            tab: 'organizations',
            createdAt,
          })
        );
      }
    }

    const graceEval = evaluateOrgNoPaidBranchGrace(org, orgBranches, now);
    if (graceEval.inGrace && !graceEval.isLegacyExempt && graceEval.deactivationDueAt) {
      results.push(
        buildSuperAdminPlatformNotification({
          dedupKey: `sa_org_grace:${org.id}:${dayKey}`,
          category: 'org_branches',
          type: 'SA_ORG_NO_PAID_BRANCH_GRACE',
          severity: 'warning',
          relatedOrgId: org.id,
          actorUid: params.actorUid,
          actorName: params.actorName,
          title: `مهلة 7 أيام للمؤسسة "${org.name}"`,
          body: `المؤسسة في مهلة عدم وجود فروع مدفوعة حتى ${graceEval.deactivationDueAt
            .toISOString()
            .slice(0, 10)}.`,
          targetType: 'organization',
          targetId: org.id,
          tab: 'organizations',
          createdAt,
        })
      );
    }
  }

  for (const branch of params.branches) {
    const parentOrg = orgMap.get(branch.orgId);
    const branchEval = evaluateBranchBillingAndGrace(branch, parentOrg, now);
    if (
      branchEval.isSuspended &&
      !branchEval.isPurgedFromDb &&
      (branchEval.isGraceExpired || (branchEval.graceRemainingDays ?? 30) <= 5)
    ) {
      const endDate = toValidDate(branch.gracePeriodEndsAt)?.toISOString().slice(0, 10) || dayKey;
      results.push(
        buildSuperAdminPlatformNotification({
          dedupKey: `sa_branch_grace:${branch.id}:${dayKey}`,
          category: 'org_branches',
          type: branchEval.isGraceExpired ? 'SA_BRANCH_PURGE_ELIGIBLE' : 'SA_BRANCH_GRACE_ENDING',
          severity: branchEval.isGraceExpired ? 'critical' : 'warning',
          relatedOrgId: branch.orgId,
          branchId: branch.id,
          branchName: branch.name,
          actorUid: params.actorUid,
          actorName: params.actorName,
          title: branchEval.isGraceExpired
            ? `فرع "${branch.name}" أتم مهلة الـ 30 يوماً`
            : `قرب انتهاء مهلة تعليق فرع "${branch.name}"`,
          body: branchEval.isGraceExpired
            ? `انتهت مهلة الـ 30 يوماً للفرع المعلق "${branch.name}" التابع لمؤسسة "${
                parentOrg?.name || branch.orgId
              }" (${endDate}).`
            : `يتبقى ${branchEval.graceRemainingDays ?? 0} يوماً على انتهاء مهلة فرع "${branch.name}".`,
          targetType: 'branch',
          targetId: branch.id,
          tab: 'branches',
          createdAt,
        })
      );
    }
  }

  return results;
}

export function buildSecurityAdminNotification(params: {
  dedupKey: string;
  type:
    | 'SECURITY_DRIVE_HEALTH_FAILED'
    | 'SECURITY_DRIVE_DISCONNECTED'
    | 'SECURITY_PASSWORD_RESET_SENT'
    | 'SECURITY_ACCESS_DENIED_ALERT';
  severity: NotificationSeverity;
  orgId: string;
  audienceScope: 'org_manager' | 'user';
  recipientUid?: string;
  branchId?: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  title: string;
  body: string;
  targetType?: NotificationTargetType;
  targetId?: string;
  tab?: NotificationNavTarget['tab'];
  createdAt?: string;
}): AppNotification {
  return createNotificationPayload({
    dedupKey: params.dedupKey,
    category: 'security_admin',
    type: params.type,
    severity: params.severity,
    audienceScope: params.audienceScope,
    orgId: params.orgId,
    recipientUid: params.recipientUid,
    branchId: params.branchId,
    actorUid: params.actorUid,
    actorName: params.actorName,
    actorRole: params.actorRole,
    title: params.title,
    body: params.body,
    targetType: params.targetType || 'security',
    targetId: params.targetId || params.actorUid,
    navTarget: {
      surface: 'tenant',
      tab: params.tab || 'audit',
      entityId: params.targetId,
      branchId: params.branchId,
    },
    createdAt: params.createdAt,
  });
}

// =============================================================================
// Per-User Sound Preference, Web Audio Bell Synthesizer & Browser Notifications
// =============================================================================

export interface KeyValueStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getSafeStorage(storage?: KeyValueStorageLike | null): KeyValueStorageLike | null {
  if (storage) return storage;
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    return window.localStorage;
  }
  return null;
}

export function getNotificationSoundStorageKey(uid: string): string {
  return `aleqfal_notif_sound_${uid}`;
}

export function getNotificationSoundEnabled(
  uid?: string | null,
  storage?: KeyValueStorageLike | null
): boolean {
  if (!uid) return true;
  const store = getSafeStorage(storage);
  if (!store) return true;
  try {
    const raw = store.getItem(getNotificationSoundStorageKey(uid));
    if (raw === '0' || raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

export function setNotificationSoundEnabled(
  uid: string,
  enabled: boolean,
  storage?: KeyValueStorageLike | null
): void {
  if (!uid) return;
  const store = getSafeStorage(storage);
  if (!store) return;
  try {
    store.setItem(getNotificationSoundStorageKey(uid), enabled ? '1' : '0');
  } catch {
    // Ignore storage quota or private-browsing errors
  }
}

let sharedAudioContext: AudioContext | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtor =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    try {
      sharedAudioContext = new AudioCtor();
    } catch {
      return null;
    }
  }
  return sharedAudioContext;
}

export function unlockNotificationAudio(): void {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {
      // Autoplay restriction remains until next user gesture; fail silently
    });
  }
}

/**
 * Plays a subtle two-note metallic chime synthesized via Web Audio API.
 * Zero external audio files required; gracefully no-ops when blocked by autoplay policy.
 */
export function playNotificationChime(): boolean {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      if (ctx.state === 'suspended') {
        return false;
      }
    }

    const now = ctx.currentTime;
    const playTone = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.075, now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    // Gentle pleasant F5 -> A5 bell chime
    playTone(698.46, 0, 0.18);
    playTone(880.0, 0.11, 0.24);
    return true;
  } catch {
    return false;
  }
}

export interface SoundProcessResult {
  played: boolean;
  reason:
    | 'initial_hydration'
    | 'pagination_hydration'
    | 'muted'
    | 'no_new_unread'
    | 'played'
    | 'play_blocked';
  newUnreadIds: string[];
}

export class NotificationSoundController {
  private hydrated = false;
  private userScopeKey = '';
  private lastPageLimit = 0;
  private pendingPaginationExpansion = false;
  private seenIds = new Set<string>();
  private readonly playAudio: () => boolean;

  constructor(playAudio: () => boolean = playNotificationChime) {
    this.playAudio = playAudio;
  }

  public reset(scopeKey = ''): void {
    this.hydrated = false;
    this.userScopeKey = scopeKey;
    this.lastPageLimit = 0;
    this.pendingPaginationExpansion = false;
    this.seenIds.clear();
  }

  public markPaginationExpansion(): void {
    if (this.hydrated) {
      this.pendingPaginationExpansion = true;
    }
  }

  public getStateSnapshot(): { hydrated: boolean; scopeKey: string; lastPageLimit: number; seenCount: number } {
    return {
      hydrated: this.hydrated,
      scopeKey: this.userScopeKey,
      lastPageLimit: this.lastPageLimit,
      seenCount: this.seenIds.size,
    };
  }

  public processSnapshot(
    notifications: AppNotification[],
    params: {
      scopeKey: string;
      uid?: string | null;
      soundEnabled: boolean;
      pageLimit?: number;
      isPaginationExpansion?: boolean;
    }
  ): SoundProcessResult {
    if (this.userScopeKey !== params.scopeKey) {
      this.reset(params.scopeKey);
    }

    const incomingLimit =
      typeof params.pageLimit === 'number' && Number.isFinite(params.pageLimit)
        ? params.pageLimit
        : this.lastPageLimit;

    if (!this.hydrated) {
      for (const n of notifications) {
        if (n.id) this.seenIds.add(n.id);
      }
      this.hydrated = true;
      this.lastPageLimit = incomingLimit;
      this.pendingPaginationExpansion = false;
      return {
        played: false,
        reason: 'initial_hydration',
        newUnreadIds: [],
      };
    }

    const isExpandingPage =
      params.isPaginationExpansion === true ||
      this.pendingPaginationExpansion ||
      (typeof params.pageLimit === 'number' &&
        this.lastPageLimit > 0 &&
        params.pageLimit > this.lastPageLimit);

    if (isExpandingPage) {
      for (const n of notifications) {
        if (n.id) this.seenIds.add(n.id);
      }
      this.lastPageLimit = Math.max(this.lastPageLimit, incomingLimit);
      this.pendingPaginationExpansion = false;
      return {
        played: false,
        reason: 'pagination_hydration',
        newUnreadIds: [],
      };
    }

    if (incomingLimit > 0) {
      this.lastPageLimit = incomingLimit;
    }

    const newUnreadIds: string[] = [];
    for (const n of notifications) {
      if (!n.id) continue;
      const isNew = !this.seenIds.has(n.id);
      this.seenIds.add(n.id);
      if (!isNew) continue;
      if (isNotificationReadByUser(n, params.uid)) continue;
      // Avoid playing an incoming alert sound for an action just triggered by the same actor,
      // unless it's a threshold/org/platform alert.
      const isSelfTriggeredNonAlert =
        Boolean(params.uid) &&
        n.actorUid === params.uid &&
        !n.type.startsWith('ORG_') &&
        !n.type.startsWith('BRANCH_') &&
        !n.type.startsWith('SA_');
      if (!isSelfTriggeredNonAlert) {
        newUnreadIds.push(n.id);
      }
    }

    if (newUnreadIds.length === 0) {
      return {
        played: false,
        reason: 'no_new_unread',
        newUnreadIds: [],
      };
    }

    if (!params.soundEnabled) {
      return {
        played: false,
        reason: 'muted',
        newUnreadIds,
      };
    }

    const didPlay = this.playAudio();
    return {
      played: didPlay,
      reason: didPlay ? 'played' : 'play_blocked',
      newUnreadIds,
    };
  }
}

/**
 * Tracks idempotent threshold/security notification persistence while allowing
 * safe retries after transient write failures without creating duplicates.
 */
export class NotificationPersistenceTracker {
  private readonly persistedIds = new Set<string>();
  private readonly inFlightIds = new Set<string>();

  public reset(): void {
    this.persistedIds.clear();
    this.inFlightIds.clear();
  }

  public isPersisted(id: string): boolean {
    return this.persistedIds.has(id);
  }

  public shouldAttempt(id: string): boolean {
    return Boolean(id) && !this.persistedIds.has(id) && !this.inFlightIds.has(id);
  }

  public async runOnce(
    id: string,
    executor: () => Promise<'persisted' | 'already_exists' | 'failed'>
  ): Promise<'skipped' | 'persisted' | 'already_exists' | 'failed'> {
    if (!this.shouldAttempt(id)) {
      return 'skipped';
    }
    this.inFlightIds.add(id);
    try {
      const outcome = await executor();
      if (outcome === 'persisted' || outcome === 'already_exists') {
        this.persistedIds.add(id);
      }
      return outcome;
    } catch {
      return 'failed';
    } finally {
      this.inFlightIds.delete(id);
    }
  }
}

export interface NotificationRuntimeSessionState {
  tenantNotifLimit: number;
  saNotifLimit: number;
  tenantController: NotificationSoundController;
  saController: NotificationSoundController;
  persistenceTracker: NotificationPersistenceTracker;
}

export function resetNotificationRuntimeControllers(params: {
  tenantController: NotificationSoundController;
  saController: NotificationSoundController;
  persistenceTracker: NotificationPersistenceTracker;
  setTenantLimit?: (limit: number) => void;
  setSaLimit?: (limit: number) => void;
}): void {
  params.tenantController.reset('');
  params.saController.reset('');
  params.persistenceTracker.reset();
  params.setTenantLimit?.(NOTIFICATION_FEED_PAGE_SIZE);
  params.setSaLimit?.(NOTIFICATION_FEED_PAGE_SIZE);
}

export function getBrowserNotificationCapability(): BrowserNotificationCapability {
  const hasWindow = typeof window !== 'undefined';
  const supported = hasWindow && 'Notification' in window;
  const isSecureContext = hasWindow && window.isSecureContext === true;
  const permission: BrowserNotificationCapability['permission'] = supported
    ? Notification.permission
    : 'unsupported';

  return {
    supported,
    isSecureContext,
    permission,
    foregroundReady: supported && isSecureContext && permission === 'granted',
    backgroundPushAvailable: false,
    backgroundPushReason:
      'إشعارات الدفع في الخلفية (Web Push / FCM) عند إغلاق الموقع تتطلب مفاتيح VAPID وService Worker خاصاً بـ FCM وخادماً لإرسالها (Cloud Functions)؛ غير مفعلة في الوضع المحلي الحالي.',
  };
}

export async function requestBrowserNotificationPermission(): Promise<
  BrowserNotificationCapability['permission']
> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission || 'denied';
  }
}

export function showForegroundBrowserNotification(notification: AppNotification): boolean {
  const cap = getBrowserNotificationCapability();
  if (!cap.foregroundReady) return false;
  try {
    const instance = new Notification(notification.title, {
      body: notification.body,
      tag: notification.dedupKey || notification.id,
    });
    setTimeout(() => {
      try {
        instance.close();
      } catch {
        // ignore
      }
    }, 6000);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Role- & Permission-Aware Tenant Notification Navigation Resolver
// =============================================================================

export type ManagerDashboardTab =
  | 'overview'
  | 'closings'
  | 'purchase_reports'
  | 'suppliers'
  | 'reports'
  | 'branches'
  | 'employees'
  | 'audit'
  | 'settings';

export type StaffDashboardTab =
  | 'workspace'
  | 'purchases'
  | 'suppliers'
  | 'closings'
  | 'reports';

export interface ResolvedTenantNotificationRoute {
  roleGroup: 'manager' | 'staff';
  managerTab?: ManagerDashboardTab;
  staffTab?: StaffDashboardTab;
  entityId?: string;
  branchId?: string;
  isPurchaseTarget: boolean;
}

const NON_PURCHASE_MANAGER_TABS: readonly ManagerDashboardTab[] = [
  'overview',
  'closings',
  'suppliers',
  'reports',
  'branches',
  'employees',
  'audit',
  'settings',
];

/**
 * Identifies purchase-invoice notifications by metadata (`targetType`, `type`) OR tab,
 * ensuring both new notifications (`tab: 'purchases'`) and legacy stored purchase
 * notifications (which previously wrote `tab: 'reports'`) route accurately.
 */
export function isPurchaseNotification(
  target: NotificationNavTarget,
  notification?: Pick<
    AppNotification,
    'category' | 'type' | 'targetType' | 'targetId' | 'branchId' | 'navTarget'
  > | null
): boolean {
  if (
    notification?.targetType === 'purchase' ||
    notification?.type === 'PURCHASE_INVOICE_RECORDED' ||
    notification?.type === 'PURCHASE_REVIEW_NEEDED'
  ) {
    return true;
  }
  return target.tab === 'purchases' || target.tab === 'purchase_reports';
}

/**
 * Resolves the destination tenant dashboard tab strictly from the recipient's
 * role, effective permissions, branch scope, and notification metadata — never
 * from `target.tab` alone.
 *
 * - Organization Manager + purchase notification -> 'purchase_reports' (NEVER general 'reports')
 * - Supervisor (with canManagePurchases) + purchase notification -> 'purchases' (preserving real branchId)
 * - Branch Manager (with canManagePurchases) + purchase notification -> 'purchases' locked to assigned branch ONLY
 * - Employee / unpermitted / inactive -> 'workspace' (never purchases or reports)
 * - Non-purchase notifications -> existing routes preserved identically
 */
export function resolveTenantNotificationRoute(params: {
  userProfile: UserProfile | null | undefined;
  target: NotificationNavTarget;
  notification?: Pick<
    AppNotification,
    'category' | 'type' | 'targetType' | 'targetId' | 'branchId' | 'navTarget'
  > | null;
}): ResolvedTenantNotificationRoute {
  const { userProfile, target, notification } = params;
  const purchaseTarget = isPurchaseNotification(target, notification);

  const rawEntityId = (target.entityId || notification?.targetId || '').trim() || undefined;
  const rawBranchId = (target.branchId || notification?.branchId || '').trim() || undefined;

  // 1. Active Organization Manager
  if (userProfile?.role === 'manager' && userProfile.isActive === true) {
    if (purchaseTarget) {
      return {
        roleGroup: 'manager',
        managerTab: 'purchase_reports',
        ...(rawEntityId ? { entityId: rawEntityId } : {}),
        ...(rawBranchId ? { branchId: rawBranchId } : {}),
        isPurchaseTarget: true,
      };
    }

    const matchedManagerTab =
      target.tab && (NON_PURCHASE_MANAGER_TABS as readonly string[]).includes(target.tab)
        ? (target.tab as ManagerDashboardTab)
        : 'overview';

    return {
      roleGroup: 'manager',
      managerTab: matchedManagerTab,
      ...(rawEntityId ? { entityId: rawEntityId } : {}),
      ...(rawBranchId ? { branchId: rawBranchId } : {}),
      isPurchaseTarget: false,
    };
  }

  // 2. Staff roles (Supervisor, Branch Manager, Employee, or inactive/unknown)
  if (!userProfile || userProfile.isActive !== true) {
    return {
      roleGroup: 'staff',
      staffTab: 'workspace',
      isPurchaseTarget: purchaseTarget,
    };
  }

  const effectivePerms = resolveEffectivePermissions(userProfile);
  const canStaffManagePurchases =
    (userProfile.role === 'supervisor' || userProfile.role === 'branch_manager') &&
    effectivePerms.canManagePurchases;
  const canSupervisorManageSuppliers =
    userProfile.role === 'supervisor' && effectivePerms.canCreateSuppliers;
  const canSupervisorReviewClosings =
    userProfile.role === 'supervisor' &&
    (effectivePerms.canApproveClosings || effectivePerms.canViewAllClosings);
  const canSupervisorViewReports =
    userProfile.role === 'supervisor' && effectivePerms.canViewFinancialReports;

  if (purchaseTarget) {
    if (userProfile.role === 'supervisor' && canStaffManagePurchases) {
      return {
        roleGroup: 'staff',
        staffTab: 'purchases',
        ...(rawEntityId ? { entityId: rawEntityId } : {}),
        ...(rawBranchId ? { branchId: rawBranchId } : {}),
        isPurchaseTarget: true,
      };
    }

    if (userProfile.role === 'branch_manager' && canStaffManagePurchases) {
      const assignedBranchId = resolvePrimaryAssignedBranchId(userProfile);
      if (assignedBranchId && (!rawBranchId || rawBranchId === assignedBranchId)) {
        return {
          roleGroup: 'staff',
          staffTab: 'purchases',
          ...(rawEntityId ? { entityId: rawEntityId } : {}),
          branchId: assignedBranchId,
          isPurchaseTarget: true,
        };
      }
      return {
        roleGroup: 'staff',
        staffTab: 'workspace',
        isPurchaseTarget: true,
      };
    }

    // Regular employee or supervisor without purchase permission: NEVER open reports or purchases
    return {
      roleGroup: 'staff',
      staffTab: 'workspace',
      isPurchaseTarget: true,
    };
  }

  // Non-purchase notifications for staff: preserve existing behavior strictly
  if (target.tab === 'suppliers' && canSupervisorManageSuppliers) {
    return {
      roleGroup: 'staff',
      staffTab: 'suppliers',
      ...(rawEntityId ? { entityId: rawEntityId } : {}),
      ...(rawBranchId ? { branchId: rawBranchId } : {}),
      isPurchaseTarget: false,
    };
  }

  if (target.tab === 'closings' && canSupervisorReviewClosings) {
    return {
      roleGroup: 'staff',
      staffTab: 'closings',
      ...(rawEntityId ? { entityId: rawEntityId } : {}),
      ...(rawBranchId ? { branchId: rawBranchId } : {}),
      isPurchaseTarget: false,
    };
  }

  if (target.tab === 'reports' && canSupervisorViewReports) {
    return {
      roleGroup: 'staff',
      staffTab: 'reports',
      ...(rawEntityId ? { entityId: rawEntityId } : {}),
      ...(rawBranchId ? { branchId: rawBranchId } : {}),
      isPurchaseTarget: false,
    };
  }

  return {
    roleGroup: 'staff',
    staffTab: 'workspace',
    ...(rawEntityId ? { entityId: rawEntityId } : {}),
    ...(rawBranchId ? { branchId: rawBranchId } : {}),
    isPurchaseTarget: false,
  };
}

