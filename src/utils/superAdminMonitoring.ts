import {
  Branch,
  ManagerInvite,
  Organization,
  PlatformAuditLog,
  SuperAdminOverviewData,
  UserProfile,
} from '../types';
import { isVerifiedSuperAdmin, SUPER_ADMIN_EMAIL } from './superAdmin';

export const TARGET_FIRESTORE_DATABASE_ID = 'ai-studio-aleqfal-cf1d4528-a7af-44d6-b623-8a556a614788';

export const CORE_MONITORING_COLLECTIONS = ['organizations', 'branches', 'users'] as const;
export const SECONDARY_MONITORING_COLLECTIONS = ['managerInvites', 'platformAuditLogs'] as const;
export const ALL_MONITORING_COLLECTIONS = [
  ...CORE_MONITORING_COLLECTIONS,
  ...SECONDARY_MONITORING_COLLECTIONS,
] as const;

export type MonitoringCollectionName = (typeof ALL_MONITORING_COLLECTIONS)[number];

export interface SuperAdminTokenResultLike {
  token?: string;
  claims?: Record<string, unknown>;
}

export interface SuperAdminAuthUserLike {
  email?: string | null;
  emailVerified?: boolean | null;
  getIdTokenResult: (forceRefresh?: boolean) => Promise<SuperAdminTokenResultLike>;
}

export class SuperAdminMonitoringError extends Error {
  readonly code: string;
  readonly deniedCollections: MonitoringCollectionName[];
  readonly failedCollections: MonitoringCollectionName[];
  readonly databaseId: string;

  constructor(params: {
    message: string;
    code: string;
    deniedCollections: MonitoringCollectionName[];
    failedCollections: MonitoringCollectionName[];
    databaseId?: string;
  }) {
    super(params.message);
    this.name = 'SuperAdminMonitoringError';
    this.code = params.code;
    this.deniedCollections = params.deniedCollections;
    this.failedCollections = params.failedCollections;
    this.databaseId = params.databaseId || TARGET_FIRESTORE_DATABASE_ID;
  }
}

export function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const errObj = error as { code?: unknown; message?: unknown };
  const code = typeof errObj.code === 'string' ? errObj.code.toLowerCase() : '';
  const msg = typeof errObj.message === 'string' ? errObj.message.toLowerCase() : '';
  return (
    code === 'permission-denied' ||
    code.endsWith('/permission-denied') ||
    msg.includes('insufficient permissions') ||
    msg.includes('permission_denied') ||
    msg.includes('permission-denied')
  );
}

export function hasVerifiedSuperAdminClaims(claims: Record<string, unknown> | undefined | null): boolean {
  if (!claims || typeof claims !== 'object') return false;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const verified = claims.email_verified === true;
  return email === SUPER_ADMIN_EMAIL && verified;
}

/**
 * Ensures the active Firebase Auth ID token carries verified Super Admin claims
 * (`email == 'amoal2030@gmail.com' && email_verified == true`), performing a
 * forced token refresh if cached claims are stale or missing.
 */
export async function ensureVerifiedSuperAdminToken(
  user: SuperAdminAuthUserLike
): Promise<{ refreshed: boolean; claimsVerified: boolean }> {
  const userEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (userEmail !== SUPER_ADMIN_EMAIL || user.emailVerified !== true) {
    throw new SuperAdminMonitoringError({
      message: 'غير مصرح بالوصول: الحساب الحالي ليس المدير الرئيسي الموثق amoal2030@gmail.com.',
      code: 'unauthorized-super-admin',
      deniedCollections: [],
      failedCollections: [],
    });
  }

  let tokenRes = await user.getIdTokenResult(false);
  if (hasVerifiedSuperAdminClaims(tokenRes?.claims)) {
    return { refreshed: false, claimsVerified: true };
  }

  tokenRes = await user.getIdTokenResult(true);
  if (hasVerifiedSuperAdminClaims(tokenRes?.claims)) {
    return { refreshed: true, claimsVerified: true };
  }

  throw new SuperAdminMonitoringError({
    message:
      'رمز الجلسة (ID Token) لا يتضمن توثيق البريد أو هوية amoal2030@gmail.com بعد التحديث. يرجى إعادة تسجيل الدخول.',
    code: 'unverified-token-claims',
    deniedCollections: [],
    failedCollections: [],
  });
}

/**
 * Verifies identity (`amoal2030@gmail.com` + `emailVerified === true`) and refreshes/validates
 * Firebase Auth JWT claims via `ensureVerifiedSuperAdminToken` before attaching any Super Admin
 * realtime listener (`onSnapshot`). Rejects `onlak2030@gmail.com`, unverified accounts, and
 * stale/unverified tokens cleanly without ever starting the listener.
 */
export async function verifySuperAdminForRealtimeListener(
  user: SuperAdminAuthUserLike | null | undefined
): Promise<{ refreshed: boolean; claimsVerified: boolean }> {
  if (!user || !isVerifiedSuperAdmin(user)) {
    throw new SuperAdminMonitoringError({
      message: 'غير مصرح بالوصول: الحساب الحالي ليس المدير الرئيسي الموثق amoal2030@gmail.com.',
      code: 'unauthorized-super-admin',
      deniedCollections: [],
      failedCollections: [],
    });
  }
  return ensureVerifiedSuperAdminToken(user);
}

function toSortableTime(value: unknown): number {
  if (typeof value === 'string' || typeof value === 'number') {
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? 0 : ts;
  }
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    const ts = (value as { toDate: () => Date }).toDate().getTime();
    return Number.isNaN(ts) ? 0 : ts;
  }
  if (
    value &&
    typeof value === 'object' &&
    'seconds' in value &&
    typeof (value as { seconds?: number }).seconds === 'number'
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function buildPermissionDeniedDiagnosticMessage(params: {
  deniedCollections: MonitoringCollectionName[];
  partialOnly?: boolean;
  databaseId?: string;
}): string {
  const dbId = params.databaseId || TARGET_FIRESTORE_DATABASE_ID;
  const listText = params.deniedCollections.join('، ');
  if (params.partialOnly) {
    return `تم رفض قراءة المجموعات الثانوية (${listText}) من قواعد Firestore (Permission Denied) على قاعدة البيانات (${dbId}). تأكد من تطابق قواعد Firestore المنشورة على هذه القاعدة مع ملف firestore.rules المحلي.`;
  }
  return `تم رفض قراءة بيانات المراقبة (${listText}) من قواعد Firestore (Permission Denied) على قاعدة البيانات (${dbId}). يرجى التحقق من توثيق رمز الجلسة ومن نشر قواعد firestore.rules المحدثة على القاعدة المسماة.`;
}

/**
 * Fault-isolated Super Admin overview loader:
 * 1. Verifies & refreshes Firebase Auth ID token claims if stale.
 * 2. Executes Promise.allSettled across all 5 platform collections.
 * 3. Retries once after forcing a fresh ID token if a core collection rejects with permission-denied.
 * 4. Surfaces exact collection-level diagnostics without hiding permission errors or fabricating fallback data.
 */
export async function fetchSuperAdminOverviewWithDiagnostics(params: {
  user: SuperAdminAuthUserLike;
  fetchCollection: <T>(collectionName: MonitoringCollectionName) => Promise<T[]>;
  databaseId?: string;
}): Promise<SuperAdminOverviewData> {
  const dbId = params.databaseId || TARGET_FIRESTORE_DATABASE_ID;
  const tokenCheck = await ensureVerifiedSuperAdminToken(params.user);
  let alreadyForcedRefresh = tokenCheck.refreshed;

  const runBatch = async () => {
    const settled = await Promise.allSettled([
      params.fetchCollection<Organization>('organizations'),
      params.fetchCollection<Branch>('branches'),
      params.fetchCollection<UserProfile>('users'),
      params.fetchCollection<ManagerInvite>('managerInvites'),
      params.fetchCollection<PlatformAuditLog>('platformAuditLogs'),
    ]);

    return {
      organizations: settled[0],
      branches: settled[1],
      users: settled[2],
      managerInvites: settled[3],
      platformAuditLogs: settled[4],
    };
  };

  let results = await runBatch();

  const hasCorePermissionDenied = CORE_MONITORING_COLLECTIONS.some((colName) => {
    const res = results[colName];
    return res.status === 'rejected' && isPermissionDeniedError(res.reason);
  });

  if (hasCorePermissionDenied && !alreadyForcedRefresh) {
    alreadyForcedRefresh = true;
    const retryToken = await params.user.getIdTokenResult(true);
    if (hasVerifiedSuperAdminClaims(retryToken?.claims)) {
      results = await runBatch();
    }
  }

  const deniedCollections: MonitoringCollectionName[] = [];
  const failedCollections: MonitoringCollectionName[] = [];
  const coreFailedCollections: MonitoringCollectionName[] = [];
  let firstNonPermissionError: unknown = null;

  for (const colName of ALL_MONITORING_COLLECTIONS) {
    const res = results[colName];
    if (res.status === 'rejected') {
      failedCollections.push(colName);
      if (isPermissionDeniedError(res.reason)) {
        deniedCollections.push(colName);
      } else if (!firstNonPermissionError) {
        firstNonPermissionError = res.reason;
      }

      if ((CORE_MONITORING_COLLECTIONS as readonly string[]).includes(colName)) {
        coreFailedCollections.push(colName);
      }
    }
  }

  if (coreFailedCollections.length > 0) {
    const hasCoreDenial = coreFailedCollections.some((c) => deniedCollections.includes(c));
    if (hasCoreDenial) {
      throw new SuperAdminMonitoringError({
        message: buildPermissionDeniedDiagnosticMessage({
          deniedCollections,
          partialOnly: false,
          databaseId: dbId,
        }),
        code: 'permission-denied',
        deniedCollections,
        failedCollections,
        databaseId: dbId,
      });
    }

    const rawMsg =
      firstNonPermissionError instanceof Error
        ? firstNonPermissionError.message
        : 'تعذر تحميل بيانات المراقبة من قاعدة البيانات.';
    throw new SuperAdminMonitoringError({
      message: `${rawMsg} (${coreFailedCollections.join('، ')})`,
      code: 'fetch-failed',
      deniedCollections,
      failedCollections,
      databaseId: dbId,
    });
  }

  const organizations =
    results.organizations.status === 'fulfilled' ? [...results.organizations.value] : [];
  const branches = results.branches.status === 'fulfilled' ? [...results.branches.value] : [];
  const users = results.users.status === 'fulfilled' ? [...results.users.value] : [];
  const managerInvites =
    results.managerInvites.status === 'fulfilled' ? [...results.managerInvites.value] : [];
  const platformAuditLogs =
    results.platformAuditLogs.status === 'fulfilled' ? [...results.platformAuditLogs.value] : [];

  organizations.sort((a, b) => toSortableTime(b.createdAt) - toSortableTime(a.createdAt));
  managerInvites.sort((a, b) => toSortableTime(b.updatedAt) - toSortableTime(a.updatedAt));
  platformAuditLogs.sort((a, b) => toSortableTime(b.timestamp) - toSortableTime(a.timestamp));

  const secondaryDenied = SECONDARY_MONITORING_COLLECTIONS.filter((c) =>
    deniedCollections.includes(c)
  );
  const secondaryNonPermissionFailed = SECONDARY_MONITORING_COLLECTIONS.filter(
    (c) => failedCollections.includes(c) && !deniedCollections.includes(c)
  );

  let diagnosticMessage: string | undefined;
  if (secondaryDenied.length > 0) {
    diagnosticMessage = buildPermissionDeniedDiagnosticMessage({
      deniedCollections: secondaryDenied,
      partialOnly: true,
      databaseId: dbId,
    });
  } else if (secondaryNonPermissionFailed.length > 0) {
    diagnosticMessage = `تعذر قراءة المجموعات الثانوية التالية مؤقتاً: ${secondaryNonPermissionFailed.join('، ')}.`;
  }

  return {
    organizations,
    branches,
    users,
    managerInvites,
    platformAuditLogs,
    fetchedAt: new Date().toISOString(),
    ...(secondaryDenied.length > 0 ? { partialDeniedCollections: secondaryDenied } : {}),
    ...(diagnosticMessage ? { diagnosticMessage } : {}),
  };
}
