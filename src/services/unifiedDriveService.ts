/**
 * Centralized Unified Google Drive Service — الإقفال | AL EQFAL
 * -------------------------------------------------------------------
 * Single source of truth for ALL Google Drive folder & file operations across the platform:
 *   - Shift Closings (Morning & Evening)
 *   - Purchase Invoices & Attachments
 *   - Worker Advances & Withdrawals
 *   - Payroll Payments & Proofs
 *   - Organization Important Documents
 *
 * Architectural & Security Guarantees:
 * 1. Uses ONLY the organization owner's existing GIS OAuth RAM session (`drive.file`).
 *    Never stores tokens in localStorage/sessionStorage/Firestore, never adds OAuth scopes,
 *    and never asks branch managers or employees to connect personal Google accounts.
 * 2. Platform Authorization Gate runs BEFORE every Drive API call:
 *    - Active user, exact `orgId` tenant isolation, record ownership verification,
 *      and strict owner-manager role check (branch_manager / supervisor / employee are blocked
 *      from direct Drive account access).
 *    - Having a `fileId` or Google Drive link is NEVER treated as sufficient authorization.
 * 3. Approved Unified Folder Hierarchy (idempotent discovery + reuse, zero duplicates):
 *      <Org Root> / الفروع / <Branch Name - Code> / <YYYY> / <MM> / <DD> / [All daily files directly here]
 *      <Org Root> / مستندات المؤسسة المهمة / [Org-level documents]
 * 4. Canonical `fileId` Model:
 *    - All view/download/update/rename/move/trash/restore operations resolve strictly by immutable `fileId`.
 *    - Legacy files, renamed files, and moved files remain 100% accessible without breaking record links.
 * 5. Safe Delete = Move to Google Drive Trash ONLY (`PATCH { trashed: true }`):
 *    - HTTP `DELETE` is strictly forbidden at the transport layer (`PERMANENT_DELETE_FORBIDDEN`).
 *    - Explicit confirmation (`confirmed: true`) is mandatory before trashing.
 *    - Underlying financial records (closing, purchase, advance, payroll payment) are NEVER deleted.
 *    - If Drive trash fails, an error is thrown and platform state is NEVER marked deleted.
 * 6. Retry Idempotency:
 *    - Deterministic `clientUploadKey` stored in `appProperties` + in-flight dedup prevents
 *      duplicate uploads and duplicate folders on retries or concurrent triggers.
 */

import type { Branch, Organization } from '../types';
import {
  UNIFIED_BRANCHES_FOLDER_NAME,
  UNIFIED_DRIVE_SCHEMA_VERSION,
  UNIFIED_ORG_IMPORTANT_DOCS_FOLDER_NAME,
  UnifiedDriveActorContext,
  UnifiedDriveAuditAction,
  UnifiedDriveAuditEvent,
  UnifiedDriveDailyPathResolution,
  UnifiedDriveDiagnosticEntry,
  UnifiedDriveDocumentType,
  UnifiedDriveError,
  UnifiedDriveFileRecord,
  UnifiedDriveFolderNode,
  UnifiedDriveFolderRole,
  UnifiedDriveImportantDocsResolution,
  UnifiedDriveRemoteFileMetadata,
  UnifiedDriveRestoreResult,
  UnifiedDriveTrashResult,
  UnifiedDriveUploadResult,
} from '../types/unifiedDrive';
import { clearDriveSession } from './driveService';

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_FILES_API_BASE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const STANDARD_FILE_FIELDS =
  'id,name,mimeType,size,parents,trashed,webViewLink,appProperties,createdTime,modifiedTime';

const MAX_DIAGNOSTIC_ENTRIES = 200;
const diagnosticLogBuffer: UnifiedDriveDiagnosticEntry[] = [];

// In-flight promise deduplication maps (RAM-only, prevents concurrent race duplicates)
const inFlightFolderOps = new Map<string, Promise<UnifiedDriveFolderNode>>();
const inFlightUploadOps = new Map<string, Promise<UnifiedDriveUploadResult>>();

// Short-lived RAM folder cache keyed by `${orgId}|${parentId}|${role}|${folderName}`
const sessionFolderCache = new Map<string, { node: UnifiedDriveFolderNode; cachedAt: number }>();
const FOLDER_CACHE_TTL_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeDriveQueryValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function recordDiagnostic(entry: Omit<UnifiedDriveDiagnosticEntry, 'timestamp'>): void {
  diagnosticLogBuffer.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  if (diagnosticLogBuffer.length > MAX_DIAGNOSTIC_ENTRIES) {
    diagnosticLogBuffer.splice(0, diagnosticLogBuffer.length - MAX_DIAGNOSTIC_ENTRIES);
  }
}

export function getUnifiedDriveDiagnostics(orgId?: string): UnifiedDriveDiagnosticEntry[] {
  if (!orgId) return [...diagnosticLogBuffer];
  return diagnosticLogBuffer.filter((e) => e.orgId === orgId);
}

export function clearUnifiedDriveDiagnostics(): void {
  diagnosticLogBuffer.length = 0;
}

export function clearUnifiedDriveFolderCache(orgId?: string): void {
  if (!orgId) {
    sessionFolderCache.clear();
    return;
  }
  for (const key of Array.from(sessionFolderCache.keys())) {
    if (key.startsWith(`${orgId}|`)) {
      sessionFolderCache.delete(key);
    }
  }
}

export function getUnifiedDriveFolderCacheSize(orgId?: string): number {
  if (!orgId) return sessionFolderCache.size;
  let count = 0;
  for (const key of sessionFolderCache.keys()) {
    if (key.startsWith(`${orgId}|`)) {
      count++;
    }
  }
  return count;
}

/**
 * Validates strict YYYY-MM-DD calendar date and returns year, month, day parts.
 */
export function parseUnifiedDocumentDate(dateStr: string): {
  date: string;
  year: string;
  month: string;
  day: string;
  yearMonth: string;
} {
  const clean = (dateStr || '').trim();
  const m = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(clean);
  if (!m) {
    throw new UnifiedDriveError(
      'INVALID_INPUT',
      `تاريخ المستند غير صالح (${dateStr || 'فارغ'}). يجب أن يكون بصيغة YYYY-MM-DD.`
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new UnifiedDriveError(
      'INVALID_INPUT',
      `تاريخ المستند (${clean}) غير موجود في التقويم الميلادي.`
    );
  }
  return {
    date: clean,
    year: m[1],
    month: m[2],
    day: m[3],
    yearMonth: `${m[1]}-${m[2]}`,
  };
}

/**
 * Deterministic canonical names for unified organization & branch folders.
 */
export function buildUnifiedOrgFolderName(org: Pick<Organization, 'id' | 'name'>): string {
  return `AL EQFAL - ${org.name.trim()} - ${org.id}`;
}

export function buildUnifiedBranchFolderName(branch: Pick<Branch, 'name' | 'code'>): string {
  const code = (branch.code || '').trim();
  const name = (branch.name || '').trim();
  return code ? `${name} - ${code}` : name;
}

/**
 * Deterministic upload idempotency key (safe for Google Drive `appProperties`, <= 100 ASCII chars).
 */
export function buildDeterministicClientUploadKey(params: {
  orgId: string;
  documentType: UnifiedDriveDocumentType;
  recordId: string;
  fileName: string;
  revision?: number;
}): string {
  const raw = [
    params.orgId.trim(),
    params.documentType,
    params.recordId.trim(),
    params.revision !== undefined ? `v${params.revision}` : 'v1',
    params.fileName.trim().toLowerCase(),
  ].join('|');

  // Lightweight deterministic FNV-1a 64-bit hex fingerprint (sync, works in Node & Browser)
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex = `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
  const safeType = params.documentType.slice(0, 12);
  const safeRec = params.recordId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return `uk_${safeType}_${safeRec}_${hex}`.slice(0, 96);
}

/**
 * Platform-level Authorization Gate executed BEFORE any Google Drive operation.
 *
 * Rules:
 * - Active signed-in actor required.
 * - Cross-org access is strictly denied (`actor.orgId === org.id`, `branch.orgId === org.id`, `recordOrgId === org.id`).
 * - Direct Drive operations are strictly restricted to the organization owner (`role === 'manager'` & `uid === org.ownerId`).
 * - `branch_manager` receives an explicit `BRANCH_MANAGER_DIRECT_DRIVE_FORBIDDEN` error (never given direct Drive access).
 * - Possessing a `fileId` or link is NEVER enough to bypass this check.
 */
export function assertUnifiedDriveAccess(params: {
  actor: UnifiedDriveActorContext | null | undefined;
  org: Organization | null | undefined;
  branch?: Branch | null;
  recordOrgId?: string;
  operation: string;
}): void {
  const { actor, org, branch, recordOrgId, operation } = params;

  if (!actor || !actor.uid || !org || !org.id) {
    recordDiagnostic({
      operation,
      status: 'error',
      orgId: org?.id,
      errorCode: 'UNAUTHORIZED_ROLE',
      message: 'مطلوب تسجيل دخول صالح ومؤسسة نشطة للوصول إلى Google Drive.',
    });
    throw new UnifiedDriveError(
      'UNAUTHORIZED_ROLE',
      'يجب تسجيل الدخول بحساب مالك المؤسسة لتنفيذ عمليات Google Drive.'
    );
  }

  if (actor.isActive !== true) {
    recordDiagnostic({
      operation,
      status: 'error',
      orgId: org.id,
      errorCode: 'UNAUTHORIZED_ROLE',
      message: `حساب معطل (${actor.uid}) حاول تنفيذ ${operation}.`,
    });
    throw new UnifiedDriveError(
      'UNAUTHORIZED_ROLE',
      'حسابك معطل ولا يملك صلاحية الوصول إلى ملفات Google Drive.'
    );
  }

  if (actor.orgId !== org.id) {
    recordDiagnostic({
      operation,
      status: 'error',
      orgId: org.id,
      errorCode: 'CROSS_ORG_FORBIDDEN',
      message: `محاولة عبور مؤسسات: المستخدم (${actor.orgId}) حاول الوصول لمؤسسة (${org.id}).`,
    });
    throw new UnifiedDriveError(
      'CROSS_ORG_FORBIDDEN',
      'رفض عزل المؤسسات: لا يُسمح بالوصول إلى ملفات Google Drive الخاصة بمؤسسة أخرى.'
    );
  }

  if (recordOrgId && recordOrgId !== org.id) {
    recordDiagnostic({
      operation,
      status: 'error',
      orgId: org.id,
      errorCode: 'CROSS_ORG_FORBIDDEN',
      message: `تعارض ملكية السجل: السجل يتبع (${recordOrgId}) والمؤسسة الحالية (${org.id}).`,
    });
    throw new UnifiedDriveError(
      'CROSS_ORG_FORBIDDEN',
      'رفض عزل المؤسسات: السجل المستهدف لا يتبع للمؤسسة الحالية.'
    );
  }

  if (branch && branch.orgId !== org.id) {
    recordDiagnostic({
      operation,
      status: 'error',
      orgId: org.id,
      errorCode: 'CROSS_ORG_FORBIDDEN',
      message: `تعارض ملكية الفرع: الفرع (${branch.id}) يتبع (${branch.orgId}) وليس (${org.id}).`,
    });
    throw new UnifiedDriveError(
      'CROSS_ORG_FORBIDDEN',
      'رفض عزل المؤسسات: الفرع المحدد لا يتبع للمؤسسة الحالية.'
    );
  }

  if (actor.role === 'branch_manager') {
    recordDiagnostic({
      operation,
      status: 'error',
      orgId: org.id,
      errorCode: 'BRANCH_MANAGER_DIRECT_DRIVE_FORBIDDEN',
      message: `منع مدير الفرع (${actor.uid}) من الوصول المباشر إلى Google Drive.`,
    });
    throw new UnifiedDriveError(
      'BRANCH_MANAGER_DIRECT_DRIVE_FORBIDDEN',
      'لا يُسمح لمدير الفرع بالوصول المباشر إلى حساب Google Drive أو ربط حساب شخصي؛ إدارة Drive محصورة بمالك المؤسسة.'
    );
  }

  if (actor.role !== 'manager' || actor.uid !== org.ownerId) {
    recordDiagnostic({
      operation,
      status: 'error',
      orgId: org.id,
      errorCode: 'UNAUTHORIZED_ROLE',
      message: `دور غير مصرح (${actor.role}/${actor.uid}) حاول تنفيذ ${operation}.`,
    });
    throw new UnifiedDriveError(
      'UNAUTHORIZED_ROLE',
      'صلاحية تنفيذ عمليات Google Drive محصورة بمالك المؤسسة المعتمد فقط.'
    );
  }
}

function assertValidAccessToken(token: string | null | undefined, orgId: string, operation: string): string {
  const clean = (token || '').trim();
  if (!clean) {
    recordDiagnostic({
      operation,
      status: 'error',
      orgId,
      errorCode: 'OAUTH_EXPIRED_OR_INVALID',
      message: 'رمز وصول Google Drive (Access Token) غير متوفر أو منتهي الصلاحية.',
    });
    throw new UnifiedDriveError(
      'OAUTH_EXPIRED_OR_INVALID',
      'انتهت صلاحية جلسة تفويض Google Drive أو لم يتم تفويضها بعد. يرجى إعادة التفويض بحساب مالك المؤسسة.',
      { httpStatus: 401 }
    );
  }
  return clean;
}

function normalizeHttpError(params: {
  status: number;
  apiMessage?: string;
  operation: string;
  orgId: string;
  fileId?: string;
  folderId?: string;
  targetLabel?: string;
}): UnifiedDriveError {
  const { status, apiMessage, operation, orgId, fileId, folderId, targetLabel } = params;
  const suffix = apiMessage ? ` (${apiMessage})` : '';
  const target = targetLabel ? ` "${targetLabel}"` : '';

  if (status === 401) {
    clearDriveSession(orgId);
    const err = new UnifiedDriveError(
      'OAUTH_EXPIRED_OR_INVALID',
      `[401] انتهت صلاحية تفويض Google Drive أو رُفض الرمز أثناء ${operation}${target}. يرجى إعادة التفويض.${suffix}`,
      { httpStatus: 401, details: { operation, fileId, folderId, apiMessage } }
    );
    recordDiagnostic({
      operation,
      status: 'error',
      orgId,
      fileId,
      folderId,
      httpStatus: 401,
      errorCode: err.code,
      message: err.message,
    });
    return err;
  }

  if (status === 403) {
    const err = new UnifiedDriveError(
      'OAUTH_SCOPE_OR_PERMISSION_DENIED',
      `[403] تم رفض صلاحية الوصول في Google Drive أثناء ${operation}${target}. تأكد من نطاق drive.file وحساب مالك المؤسسة.${suffix}`,
      { httpStatus: 403, details: { operation, fileId, folderId, apiMessage } }
    );
    recordDiagnostic({
      operation,
      status: 'error',
      orgId,
      fileId,
      folderId,
      httpStatus: 403,
      errorCode: err.code,
      message: err.message,
    });
    return err;
  }

  if (status === 404) {
    const err = new UnifiedDriveError(
      'NOT_FOUND',
      `[404] تعذر العثور على العنصر${target} في Google Drive أو لا تملك الجلسة الحالية صلاحية الوصول إليه.${suffix}`,
      { httpStatus: 404, details: { operation, fileId, folderId, apiMessage } }
    );
    recordDiagnostic({
      operation,
      status: 'error',
      orgId,
      fileId,
      folderId,
      httpStatus: 404,
      errorCode: err.code,
      message: err.message,
    });
    return err;
  }

  const err = new UnifiedDriveError(
    'DRIVE_API_ERROR',
    `[${status}] فشل تنفيذ عملية ${operation}${target} في Google Drive.${suffix}`,
    { httpStatus: status, details: { operation, fileId, folderId, apiMessage } }
  );
  recordDiagnostic({
    operation,
    status: 'error',
    orgId,
    fileId,
    folderId,
    httpStatus: status,
    errorCode: err.code,
    message: err.message,
  });
  return err;
}

/**
 * Centralized Google Drive HTTP transport.
 * HARD GUARD: HTTP `DELETE` is permanently forbidden here so no code path can ever
 * permanently delete a user/business file from Google Drive.
 */
async function executeDriveRequest(params: {
  url: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  token: string;
  orgId: string;
  operation: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  fileId?: string;
  folderId?: string;
  targetLabel?: string;
}): Promise<Response> {
  const method = (params.method || 'GET').toUpperCase();
  if (method === 'DELETE') {
    const forbiddenErr = new UnifiedDriveError(
      'PERMANENT_DELETE_FORBIDDEN',
      'الحذف النهائي (HTTP DELETE) ممنوع في نظام الإقفال الموحّد. يُسمح فقط بنقل الملف إلى سلة المهملات (trashed: true).'
    );
    recordDiagnostic({
      operation: params.operation,
      status: 'error',
      orgId: params.orgId,
      fileId: params.fileId,
      errorCode: forbiddenErr.code,
      message: forbiddenErr.message,
    });
    throw forbiddenErr;
  }

  const token = assertValidAccessToken(params.token, params.orgId, params.operation);

  let res: Response;
  try {
    res = await fetch(params.url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(params.headers || {}),
      },
      body: params.body,
    });
  } catch (networkErr: any) {
    const err = new UnifiedDriveError(
      'NETWORK_ERROR',
      `تعذر الاتصال بخدمة Google Drive أثناء ${params.operation}: ${networkErr?.message || 'خطأ في الشبكة'}`,
      { details: { operation: params.operation, fileId: params.fileId, folderId: params.folderId } }
    );
    recordDiagnostic({
      operation: params.operation,
      status: 'error',
      orgId: params.orgId,
      fileId: params.fileId,
      folderId: params.folderId,
      errorCode: err.code,
      message: err.message,
    });
    throw err;
  }

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw normalizeHttpError({
      status: res.status,
      apiMessage: errJson?.error?.message,
      operation: params.operation,
      orgId: params.orgId,
      fileId: params.fileId,
      folderId: params.folderId,
      targetLabel: params.targetLabel,
    });
  }

  return res;
}

function mapRawDriveFileToRemoteMeta(raw: any): UnifiedDriveRemoteFileMetadata {
  const fileId = String(raw?.id || '');
  const isFolder = raw?.mimeType === DRIVE_FOLDER_MIME;
  const fallbackLink = isFolder
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(fileId)}`
    : `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  return {
    fileId,
    fileName: String(raw?.name || ''),
    mimeType: String(raw?.mimeType || 'application/octet-stream'),
    fileSize: Number(raw?.size || 0),
    parents: Array.isArray(raw?.parents) ? raw.parents.map(String) : [],
    trashed: raw?.trashed === true,
    webViewLink:
      typeof raw?.webViewLink === 'string' && raw.webViewLink.startsWith('https://')
        ? raw.webViewLink
        : fallbackLink,
    appProperties:
      raw?.appProperties && typeof raw.appProperties === 'object' ? { ...raw.appProperties } : {},
    createdTime: typeof raw?.createdTime === 'string' ? raw.createdTime : undefined,
    modifiedTime: typeof raw?.modifiedTime === 'string' ? raw.modifiedTime : undefined,
  };
}

function makeAuditEvent(params: {
  action: UnifiedDriveAuditAction;
  actor: UnifiedDriveActorContext;
  orgId: string;
  branchId?: string;
  fileId: string;
  fileName: string;
  documentType?: UnifiedDriveDocumentType;
  recordId?: string;
  details: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}): UnifiedDriveAuditEvent {
  const ts = new Date().toISOString();
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `drv_aud_${suffix}`,
    action: params.action,
    orgId: params.orgId,
    ...(params.branchId ? { branchId: params.branchId } : {}),
    actorUid: params.actor.uid,
    actorName: (params.actor.displayName || params.actor.email || 'مالك المؤسسة').trim(),
    actorRole: params.actor.role,
    fileId: params.fileId,
    fileName: params.fileName,
    ...(params.documentType ? { documentType: params.documentType } : {}),
    ...(params.recordId ? { recordId: params.recordId } : {}),
    details: params.details,
    ...(params.previousValues ? { previousValues: params.previousValues } : {}),
    ...(params.newValues ? { newValues: params.newValues } : {}),
    timestamp: ts,
  };
}

function appPropsMatchAll(
  actual: Record<string, string> | undefined,
  expected: Record<string, string>
): boolean {
  if (!actual) return false;
  for (const [k, v] of Object.entries(expected)) {
    if (actual[k] !== v) return false;
  }
  return true;
}

/**
 * Lists non-trashed Drive folders matching query filters across all pages.
 */
async function listDriveFoldersByQuery(params: {
  token: string;
  orgId: string;
  parentId?: string;
  folderName?: string;
  appProperties?: Record<string, string>;
  operation: string;
}): Promise<UnifiedDriveRemoteFileMetadata[]> {
  const qParts: string[] = [
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    `trashed = false`,
  ];
  if (params.folderName) {
    qParts.push(`name = '${escapeDriveQueryValue(params.folderName)}'`);
  }
  if (params.parentId) {
    qParts.push(`'${escapeDriveQueryValue(params.parentId)}' in parents`);
  }
  if (params.appProperties) {
    for (const [k, v] of Object.entries(params.appProperties)) {
      qParts.push(
        `appProperties has { key='${escapeDriveQueryValue(k)}' and value='${escapeDriveQueryValue(v)}' }`
      );
    }
  }

  const results: UnifiedDriveRemoteFileMetadata[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(DRIVE_FILES_API_BASE);
    url.searchParams.set('q', qParts.join(' and '));
    url.searchParams.set('fields', `nextPageToken, files(${STANDARD_FILE_FIELDS})`);
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('includeItemsFromAllDrives', 'false');
    url.searchParams.set('supportsAllDrives', 'false');
    url.searchParams.set('pageSize', '50');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await executeDriveRequest({
      url: url.toString(),
      method: 'GET',
      token: params.token,
      orgId: params.orgId,
      operation: params.operation,
      folderId: params.parentId,
      targetLabel: params.folderName,
    });
    const data = await res.json();
    if (Array.isArray(data.files)) {
      for (const f of data.files) {
        const mapped = mapRawDriveFileToRemoteMeta(f);
        if (mapped.trashed || mapped.mimeType !== DRIVE_FOLDER_MIME) continue;
        if (params.parentId && !mapped.parents.includes(params.parentId)) continue;
        if (params.folderName && mapped.fileName !== params.folderName) continue;
        if (params.appProperties && !appPropsMatchAll(mapped.appProperties, params.appProperties)) {
          continue;
        }
        results.push(mapped);
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

/**
 * Idempotently locates, verifies, or creates a unified folder node in Google Drive.
 * Guarantees:
 * - In-flight deduplication prevents race-condition duplicates.
 * - Reuses existing verified folder by `existingFolderId`, then by `appProperties` inside `parentId`,
 *   then by exact `folderName` inside concrete `parentId` (reusing pre-existing folders safely).
 * - Creates via `POST /drive/v3/files` ONLY when zero matches exist, followed by `files.get` verification.
 */
async function ensureUnifiedFolder(params: {
  token: string;
  orgId: string;
  role: UnifiedDriveFolderRole;
  folderName: string;
  parentId?: string;
  existingFolderId?: string;
  appProperties: Record<string, string>;
  bypassCache?: boolean;
}): Promise<UnifiedDriveFolderNode> {
  const cacheKey = `${params.orgId}|${params.parentId || 'MY_DRIVE'}|${params.role}|${params.folderName}`;

  if (!params.bypassCache) {
    const cached = sessionFolderCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < FOLDER_CACHE_TTL_MS) {
      return { ...cached.node, reused: true };
    }
  }

  const pending = inFlightFolderOps.get(cacheKey);
  if (pending) {
    return pending;
  }

  const run = (async (): Promise<UnifiedDriveFolderNode> => {
    // 1. If a concrete existingFolderId is known, verify it via files.get
    if (params.existingFolderId) {
      try {
        const res = await executeDriveRequest({
          url: `${DRIVE_FILES_API_BASE}/${encodeURIComponent(
            params.existingFolderId
          )}?fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`,
          method: 'GET',
          token: params.token,
          orgId: params.orgId,
          operation: `verify_folder:${params.role}`,
          folderId: params.existingFolderId,
          targetLabel: params.folderName,
        });
        const meta = mapRawDriveFileToRemoteMeta(await res.json());
        const orgProp = meta.appProperties.orgId;
        const parentMatches = !params.parentId || meta.parents.includes(params.parentId);
        if (
          !meta.trashed &&
          meta.mimeType === DRIVE_FOLDER_MIME &&
          (!orgProp || orgProp === params.orgId) &&
          parentMatches
        ) {
          const node: UnifiedDriveFolderNode = {
            folderId: meta.fileId,
            folderName: meta.fileName,
            webViewLink: meta.webViewLink,
            parents: meta.parents,
            role: params.role,
            reused: true,
            verifiedViaGet: true,
          };
          sessionFolderCache.set(cacheKey, { node, cachedAt: Date.now() });
          return node;
        }
      } catch (err) {
        // If 401/403/network -> fail fast; only fall through to search if 404
        if (!(err instanceof UnifiedDriveError && err.code === 'NOT_FOUND')) {
          throw err;
        }
      }
    }

    // 2. Search by appProperties (plus parentId if concrete) — finds folder even if user renamed it
    const byProps = await listDriveFoldersByQuery({
      token: params.token,
      orgId: params.orgId,
      parentId: params.parentId,
      appProperties: params.appProperties,
      operation: `search_folder_by_props:${params.role}`,
    });

    if (byProps.length > 1) {
      throw new UnifiedDriveError(
        'DUPLICATE_CONFLICT',
        `تم العثور على (${byProps.length}) مجلدات متطابقة لـ "${params.folderName}" في Google Drive (${byProps
          .map((f) => f.fileId)
          .join(', ')}). تم إيقاف الإنشاء لمنع التكرار.`,
        { details: { duplicateFolderIds: byProps.map((f) => f.fileId) } }
      );
    }

    if (byProps.length === 1) {
      const found = byProps[0];
      const node: UnifiedDriveFolderNode = {
        folderId: found.fileId,
        folderName: found.fileName,
        webViewLink: found.webViewLink,
        parents: found.parents,
        role: params.role,
        reused: true,
        verifiedViaGet: true,
      };
      sessionFolderCache.set(cacheKey, { node, cachedAt: Date.now() });
      return node;
    }

    // 3. When inside a concrete parentId, also check exact folderName match so any pre-existing folder
    //    (e.g., created manually or by an earlier schema version) is reused cleanly without duplicating.
    if (params.parentId) {
      const byName = await listDriveFoldersByQuery({
        token: params.token,
        orgId: params.orgId,
        parentId: params.parentId,
        folderName: params.folderName,
        operation: `search_folder_by_name:${params.role}`,
      });

      if (byName.length > 1) {
        throw new UnifiedDriveError(
          'DUPLICATE_CONFLICT',
          `تم العثور على (${byName.length}) مجلدات تحمل الاسم "${params.folderName}" داخل نفس المجلد الأب. تم إيقاف الإنشاء لمنع التكرار.`,
          { details: { duplicateFolderIds: byName.map((f) => f.fileId) } }
        );
      }

      if (byName.length === 1) {
        const found = byName[0];
        // Verify it doesn't belong to a different org
        if (found.appProperties.orgId && found.appProperties.orgId !== params.orgId) {
          throw new UnifiedDriveError(
            'CROSS_ORG_FORBIDDEN',
            `المجلد "${params.folderName}" يحمل معرّف مؤسسة مختلف (${found.appProperties.orgId}).`
          );
        }
        const node: UnifiedDriveFolderNode = {
          folderId: found.fileId,
          folderName: found.fileName,
          webViewLink: found.webViewLink,
          parents: found.parents,
          role: params.role,
          reused: true,
          verifiedViaGet: true,
        };
        sessionFolderCache.set(cacheKey, { node, cachedAt: Date.now() });
        return node;
      }
    }

    // 4. Zero matches -> create folder via POST /drive/v3/files
    const createPayload: Record<string, unknown> = {
      name: params.folderName,
      mimeType: DRIVE_FOLDER_MIME,
      appProperties: {
        ...params.appProperties,
        schemaVersion: UNIFIED_DRIVE_SCHEMA_VERSION,
      },
    };
    if (params.parentId) {
      createPayload.parents = [params.parentId];
    }

    const createRes = await executeDriveRequest({
      url: `${DRIVE_FILES_API_BASE}?fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`,
      method: 'POST',
      token: params.token,
      orgId: params.orgId,
      operation: `create_folder:${params.role}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
      folderId: params.parentId,
      targetLabel: params.folderName,
    });
    const createdMeta = mapRawDriveFileToRemoteMeta(await createRes.json());
    if (!createdMeta.fileId) {
      throw new UnifiedDriveError(
        'DRIVE_API_ERROR',
        `فشل إنشاء المجلد "${params.folderName}": لم يُرجع Google Drive معرّفاً صالحاً.`
      );
    }

    // Post-create verification via files.get (bounded retry for transient indexing delay)
    const delays = [0, 300, 600];
    let verifiedMeta: UnifiedDriveRemoteFileMetadata | null = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await sleep(delays[i]);
      try {
        const getRes = await executeDriveRequest({
          url: `${DRIVE_FILES_API_BASE}/${encodeURIComponent(
            createdMeta.fileId
          )}?fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`,
          method: 'GET',
          token: params.token,
          orgId: params.orgId,
          operation: `post_create_verify_folder:${params.role}`,
          folderId: createdMeta.fileId,
          targetLabel: params.folderName,
        });
        verifiedMeta = mapRawDriveFileToRemoteMeta(await getRes.json());
        break;
      } catch (err) {
        if (err instanceof UnifiedDriveError && err.code === 'NOT_FOUND' && i < delays.length - 1) {
          continue;
        }
        throw err;
      }
    }

    const finalMeta = verifiedMeta || createdMeta;
    const node: UnifiedDriveFolderNode = {
      folderId: finalMeta.fileId,
      folderName: finalMeta.fileName,
      webViewLink: finalMeta.webViewLink,
      parents: finalMeta.parents,
      role: params.role,
      reused: false,
      verifiedViaGet: Boolean(verifiedMeta),
    };
    sessionFolderCache.set(cacheKey, { node, cachedAt: Date.now() });
    recordDiagnostic({
      operation: `create_folder:${params.role}`,
      status: 'ok',
      orgId: params.orgId,
      folderId: node.folderId,
      message: `تم إنشاء المجلد "${node.folderName}" بنجاح.`,
    });
    return node;
  })();

  inFlightFolderOps.set(cacheKey, run);
  try {
    return await run;
  } finally {
    inFlightFolderOps.delete(cacheKey);
  }
}

/**
 * Ensures the Organization Root Folder exists and is verified.
 * Reuses `org.driveFolderId` if already linked.
 */
export async function ensureUnifiedOrgRootFolder(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  bypassCache?: boolean;
}): Promise<UnifiedDriveFolderNode> {
  assertUnifiedDriveAccess({
    actor: params.actor,
    org: params.org,
    operation: 'ensure_org_root',
  });

  const orgFolderName = params.org.driveFolderName?.trim() || buildUnifiedOrgFolderName(params.org);

  return ensureUnifiedFolder({
    token: params.token,
    orgId: params.org.id,
    role: 'org_root',
    folderName: orgFolderName,
    existingFolderId: params.org.driveFolderId || undefined,
    appProperties: {
      systemId: 'al_eqfal',
      role: 'org_root',
      orgId: params.org.id,
    },
    bypassCache: params.bypassCache,
  });
}

/**
 * Ensures the approved Unified Daily Folder Path for any branch-level daily document:
 *   <Organization Root>
 *     └── الفروع
 *           └── <Branch Name - Code>
 *                 └── <YYYY>
 *                       └── <MM>
 *                             └── <DD>
 *
 * ALL daily documents (morning closing, evening closing, purchases, worker advances,
 * payroll payments) are saved DIRECTLY inside `<DD>` with NO per-type subfolders.
 */
export async function ensureUnifiedDailyFolderPath(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  branch: Branch;
  date: string; // YYYY-MM-DD
  bypassCache?: boolean;
}): Promise<UnifiedDriveDailyPathResolution> {
  assertUnifiedDriveAccess({
    actor: params.actor,
    org: params.org,
    branch: params.branch,
    operation: 'ensure_daily_folder_path',
  });

  const parsedDate = parseUnifiedDocumentDate(params.date);
  const orgFolder = await ensureUnifiedOrgRootFolder({
    token: params.token,
    actor: params.actor,
    org: params.org,
    bypassCache: params.bypassCache,
  });

  const branchesContainerFolder = await ensureUnifiedFolder({
    token: params.token,
    orgId: params.org.id,
    role: 'branches_container',
    folderName: UNIFIED_BRANCHES_FOLDER_NAME,
    parentId: orgFolder.folderId,
    appProperties: {
      systemId: 'al_eqfal',
      role: 'branches_container',
      orgId: params.org.id,
    },
    bypassCache: params.bypassCache,
  });

  const branchFolderName = buildUnifiedBranchFolderName(params.branch);
  const branchFolder = await ensureUnifiedFolder({
    token: params.token,
    orgId: params.org.id,
    role: 'unified_branch_folder',
    folderName: branchFolderName,
    parentId: branchesContainerFolder.folderId,
    appProperties: {
      systemId: 'al_eqfal',
      role: 'unified_branch_folder',
      orgId: params.org.id,
      branchId: params.branch.id,
    },
    bypassCache: params.bypassCache,
  });

  const yearFolder = await ensureUnifiedFolder({
    token: params.token,
    orgId: params.org.id,
    role: 'year_folder',
    folderName: parsedDate.year,
    parentId: branchFolder.folderId,
    appProperties: {
      systemId: 'al_eqfal',
      role: 'year_folder',
      orgId: params.org.id,
      branchId: params.branch.id,
      year: parsedDate.year,
    },
    bypassCache: params.bypassCache,
  });

  const monthFolder = await ensureUnifiedFolder({
    token: params.token,
    orgId: params.org.id,
    role: 'month_folder',
    folderName: parsedDate.month,
    parentId: yearFolder.folderId,
    appProperties: {
      systemId: 'al_eqfal',
      role: 'month_folder',
      orgId: params.org.id,
      branchId: params.branch.id,
      year: parsedDate.year,
      month: parsedDate.month,
      yearMonth: parsedDate.yearMonth,
    },
    bypassCache: params.bypassCache,
  });

  const dayFolder = await ensureUnifiedFolder({
    token: params.token,
    orgId: params.org.id,
    role: 'day_folder',
    folderName: parsedDate.day,
    parentId: monthFolder.folderId,
    appProperties: {
      systemId: 'al_eqfal',
      role: 'day_folder',
      orgId: params.org.id,
      branchId: params.branch.id,
      date: parsedDate.date,
    },
    bypassCache: params.bypassCache,
  });

  const displayPath = [
    orgFolder.folderName,
    branchesContainerFolder.folderName,
    branchFolder.folderName,
    yearFolder.folderName,
    monthFolder.folderName,
    dayFolder.folderName,
  ].join(' / ');

  return {
    orgId: params.org.id,
    branchId: params.branch.id,
    branchName: params.branch.name,
    date: parsedDate.date,
    year: parsedDate.year,
    month: parsedDate.month,
    day: parsedDate.day,
    yearMonth: parsedDate.yearMonth,
    orgFolder,
    branchesContainerFolder,
    branchFolder,
    yearFolder,
    monthFolder,
    dayFolder,
    displayPath,
  };
}

/**
 * Ensures the Organization Important Documents folder directly under `<Organization Root>`:
 *   <Organization Root> / مستندات المؤسسة المهمة
 */
export async function ensureOrgImportantDocsFolder(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  bypassCache?: boolean;
}): Promise<UnifiedDriveImportantDocsResolution> {
  assertUnifiedDriveAccess({
    actor: params.actor,
    org: params.org,
    operation: 'ensure_org_important_docs_folder',
  });

  const orgFolder = await ensureUnifiedOrgRootFolder({
    token: params.token,
    actor: params.actor,
    org: params.org,
    bypassCache: params.bypassCache,
  });

  const importantDocsFolder = await ensureUnifiedFolder({
    token: params.token,
    orgId: params.org.id,
    role: 'org_important_docs',
    folderName: UNIFIED_ORG_IMPORTANT_DOCS_FOLDER_NAME,
    parentId: orgFolder.folderId,
    appProperties: {
      systemId: 'al_eqfal',
      role: 'org_important_docs',
      orgId: params.org.id,
    },
    bypassCache: params.bypassCache,
  });

  return {
    orgId: params.org.id,
    orgFolder,
    importantDocsFolder,
    displayPath: `${orgFolder.folderName} / ${importantDocsFolder.folderName}`,
  };
}

/**
 * Searches non-trashed Drive files by `clientUploadKey` + `orgId` (and optional parent folder)
 * for idempotent retry handling (prevents duplicate uploads).
 */
async function findExistingFileByClientUploadKey(params: {
  token: string;
  orgId: string;
  clientUploadKey: string;
  parentFolderId?: string;
}): Promise<UnifiedDriveRemoteFileMetadata[]> {
  const qParts: string[] = [
    `trashed = false`,
    `appProperties has { key='systemId' and value='al_eqfal' }`,
    `appProperties has { key='orgId' and value='${escapeDriveQueryValue(params.orgId)}' }`,
    `appProperties has { key='clientUploadKey' and value='${escapeDriveQueryValue(params.clientUploadKey)}' }`,
  ];
  if (params.parentFolderId) {
    qParts.push(`'${escapeDriveQueryValue(params.parentFolderId)}' in parents`);
  }

  const url = new URL(DRIVE_FILES_API_BASE);
  url.searchParams.set('q', qParts.join(' and '));
  url.searchParams.set('fields', `files(${STANDARD_FILE_FIELDS})`);
  url.searchParams.set('spaces', 'drive');
  url.searchParams.set('includeItemsFromAllDrives', 'false');
  url.searchParams.set('supportsAllDrives', 'false');
  url.searchParams.set('pageSize', '20');

  const res = await executeDriveRequest({
    url: url.toString(),
    method: 'GET',
    token: params.token,
    orgId: params.orgId,
    operation: 'search_file_idempotency',
    folderId: params.parentFolderId,
  });
  const data = await res.json();
  if (!Array.isArray(data.files)) return [];
  return data.files
    .map(mapRawDriveFileToRemoteMeta)
    .filter(
      (f: UnifiedDriveRemoteFileMetadata) =>
        !f.trashed &&
        f.appProperties.orgId === params.orgId &&
        f.appProperties.clientUploadKey === params.clientUploadKey
    );
}

function buildMultipartRelatedBody(params: {
  metadata: Record<string, unknown>;
  contentBytes: Uint8Array;
  mimeType: string;
}): { boundary: string; body: Uint8Array } {
  const boundary = `al_eqfal_u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const encoder = new TextEncoder();
  const headerPart = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(params.metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${params.mimeType}\r\n\r\n`
  );
  const footerPart = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(
    headerPart.byteLength + params.contentBytes.byteLength + footerPart.byteLength
  );
  body.set(headerPart, 0);
  body.set(params.contentBytes, headerPart.byteLength);
  body.set(footerPart, headerPart.byteLength + params.contentBytes.byteLength);
  return { boundary, body };
}

/**
 * Centralized Unified Upload for ALL platform document types:
 *   - Daily documents (`closing_morning`, `closing_evening`, `purchase`, `worker_advance`, `payroll_payment`):
 *     stored directly inside `<Org Root> / الفروع / <Branch> / <YYYY> / <MM> / <DD>`
 *   - Organization Important Documents (`org_important_document`):
 *     stored directly inside `<Org Root> / مستندات المؤسسة المهمة`
 *
 * Guarantees retry idempotency via deterministic `clientUploadKey` + in-flight deduplication:
 * retrying after a transient failure or duplicate trigger NEVER creates duplicate files.
 */
export async function uploadUnifiedDriveFile(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  branch?: Branch | null;
  documentType: UnifiedDriveDocumentType;
  documentDate?: string;
  recordId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  clientUploadKey?: string;
  revision?: number;
  extraAppProperties?: Record<string, string>;
  /** When true (default), an existing match for clientUploadKey updates via PATCH instead of duplicating */
  updateIfExists?: boolean;
}): Promise<UnifiedDriveUploadResult> {
  const cleanFileName = (params.fileName || '').trim();
  const cleanRecordId = (params.recordId || '').trim();
  const cleanMime = (params.mimeType || 'application/octet-stream').trim();

  if (!cleanFileName || cleanFileName.length > 255) {
    throw new UnifiedDriveError('INVALID_INPUT', 'اسم الملف غير صالح أو يتجاوز 255 حرفاً.');
  }
  if (!cleanRecordId) {
    throw new UnifiedDriveError('INVALID_INPUT', 'معرّف السجل المرتبط بالملف (recordId) مطلوب.');
  }
  if (!(params.bytes instanceof Uint8Array)) {
    throw new UnifiedDriveError('INVALID_INPUT', 'محتوى الملف الثنائي غير صالح.');
  }

  assertUnifiedDriveAccess({
    actor: params.actor,
    org: params.org,
    branch: params.branch,
    operation: `upload_file:${params.documentType}`,
  });

  let targetFolderId: string;
  let folderPath: string;
  let normalizedDate: string | undefined;
  let branchId: string | undefined;
  let branchName: string | undefined;

  if (params.documentType === 'org_important_document') {
    const resolved = await ensureOrgImportantDocsFolder({
      token: params.token,
      actor: params.actor,
      org: params.org,
    });
    targetFolderId = resolved.importantDocsFolder.folderId;
    folderPath = resolved.displayPath;
    if (params.documentDate) {
      normalizedDate = parseUnifiedDocumentDate(params.documentDate).date;
    }
  } else {
    if (!params.branch) {
      throw new UnifiedDriveError(
        'INVALID_INPUT',
        'الفرع مطلوب لرفع مستندات الفروع اليومية إلى المسار الموحّد.'
      );
    }
    if (!params.documentDate) {
      throw new UnifiedDriveError(
        'INVALID_INPUT',
        'تاريخ المستند (YYYY-MM-DD) مطلوب لرفع مستندات الفروع اليومية.'
      );
    }
    const resolved = await ensureUnifiedDailyFolderPath({
      token: params.token,
      actor: params.actor,
      org: params.org,
      branch: params.branch,
      date: params.documentDate,
    });
    targetFolderId = resolved.dayFolder.folderId;
    folderPath = resolved.displayPath;
    normalizedDate = resolved.date;
    branchId = params.branch.id;
    branchName = params.branch.name;
  }

  const clientUploadKey =
    (params.clientUploadKey || '').trim() ||
    buildDeterministicClientUploadKey({
      orgId: params.org.id,
      documentType: params.documentType,
      recordId: cleanRecordId,
      fileName: cleanFileName,
      revision: params.revision,
    });

  const inFlightKey = `${params.org.id}|${clientUploadKey}`;
  const existingFlight = inFlightUploadOps.get(inFlightKey);
  if (existingFlight) {
    return existingFlight;
  }

  const run = (async (): Promise<UnifiedDriveUploadResult> => {
    // 1. Check idempotency key to prevent duplicate uploads on retry
    const existingMatches = await findExistingFileByClientUploadKey({
      token: params.token,
      orgId: params.org.id,
      clientUploadKey,
      parentFolderId: targetFolderId,
    });

    if (existingMatches.length > 1) {
      throw new UnifiedDriveError(
        'DUPLICATE_CONFLICT',
        `تم العثور على (${existingMatches.length}) ملفات مكررة لنفس مفتاح الرفع (${clientUploadKey}). تم إيقاف الرفع لمنع التضارب.`
      );
    }

    const existingFile = existingMatches.length === 1 ? existingMatches[0] : null;
    const shouldPatchExisting = Boolean(existingFile && (params.updateIfExists ?? true));

    const appProperties: Record<string, string> = {
      ...(params.extraAppProperties || {}),
      systemId: 'al_eqfal',
      schemaVersion: UNIFIED_DRIVE_SCHEMA_VERSION,
      orgId: params.org.id,
      documentType: params.documentType,
      recordId: cleanRecordId,
      clientUploadKey,
      ...(branchId ? { branchId } : {}),
      ...(normalizedDate ? { documentDate: normalizedDate } : {}),
      ...(params.revision !== undefined ? { revision: String(params.revision) } : {}),
    };

    let finalMeta: UnifiedDriveRemoteFileMetadata;

    if (existingFile && !shouldPatchExisting) {
      finalMeta = existingFile;
    } else {
      const metadataPayload: Record<string, unknown> = {
        name: cleanFileName,
        mimeType: cleanMime,
        appProperties,
      };
      if (!existingFile) {
        metadataPayload.parents = [targetFolderId];
      }

      const { boundary, body } = buildMultipartRelatedBody({
        metadata: metadataPayload,
        contentBytes: params.bytes,
        mimeType: cleanMime,
      });

      const uploadUrl = existingFile
        ? `${DRIVE_UPLOAD_API_BASE}/${encodeURIComponent(
            existingFile.fileId
          )}?uploadType=multipart&fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`
        : `${DRIVE_UPLOAD_API_BASE}?uploadType=multipart&fields=${encodeURIComponent(
            STANDARD_FILE_FIELDS
          )}`;

      const uploadRes = await executeDriveRequest({
        url: uploadUrl,
        method: existingFile ? 'PATCH' : 'POST',
        token: params.token,
        orgId: params.org.id,
        operation: existingFile ? 'upload_file_idempotent_patch' : 'upload_file_create',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: body as BodyInit,
        fileId: existingFile?.fileId,
        folderId: targetFolderId,
        targetLabel: cleanFileName,
      });

      finalMeta = mapRawDriveFileToRemoteMeta(await uploadRes.json());
      if (!finalMeta.fileId) {
        throw new UnifiedDriveError(
          'DRIVE_API_ERROR',
          `فشل رفع الملف "${cleanFileName}": لم يُرجع Google Drive معرّف ملف صالحاً.`
        );
      }
    }

    const nowIso = new Date().toISOString();
    const actorName = (params.actor.displayName || params.actor.email || 'مالك المؤسسة').trim();

    const record: UnifiedDriveFileRecord = {
      fileId: finalMeta.fileId,
      fileName: finalMeta.fileName || cleanFileName,
      mimeType: finalMeta.mimeType || cleanMime,
      fileSize: finalMeta.fileSize > 0 ? finalMeta.fileSize : params.bytes.byteLength,
      orgId: params.org.id,
      ...(branchId ? { branchId } : {}),
      ...(branchName ? { branchName } : {}),
      documentType: params.documentType,
      ...(normalizedDate ? { documentDate: normalizedDate } : {}),
      recordId: cleanRecordId,
      status: 'active',
      parentFolderId: finalMeta.parents[0] || targetFolderId,
      webViewLink: finalMeta.webViewLink,
      clientUploadKey,
      uploadedAt: nowIso,
      uploadedBy: params.actor.uid,
      uploadedByName: actorName,
    };

    const auditEvent = makeAuditEvent({
      action: existingFile ? 'DRIVE_FILE_UPDATED' : 'DRIVE_FILE_UPLOADED',
      actor: params.actor,
      orgId: params.org.id,
      branchId,
      fileId: record.fileId,
      fileName: record.fileName,
      documentType: params.documentType,
      recordId: cleanRecordId,
      details: `${existingFile ? 'تحديث (إعادة محاولة آمنة)' : 'رفع'} ملف "${record.fileName}" (${params.documentType}) إلى المسار "${folderPath}"`,
      newValues: {
        fileId: record.fileId,
        parentFolderId: record.parentFolderId,
        documentType: params.documentType,
        recordId: cleanRecordId,
        reusedExisting: Boolean(existingFile),
      },
    });

    recordDiagnostic({
      operation: `upload_file:${params.documentType}`,
      status: 'ok',
      orgId: params.org.id,
      fileId: record.fileId,
      folderId: targetFolderId,
      message: `تم ${existingFile ? 'إعادة استخدام/تحديث' : 'رفع'} "${record.fileName}" بنجاح.`,
    });

    return {
      record,
      folderPath,
      reusedExisting: Boolean(existingFile),
      auditEvent,
    };
  })();

  inFlightUploadOps.set(inFlightKey, run);
  try {
    return await run;
  } finally {
    inFlightUploadOps.delete(inFlightKey);
  }
}

/**
 * Retrieves canonical file metadata strictly by immutable `fileId`.
 * Works seamlessly for legacy files, renamed files, and moved files,
 * while strictly enforcing platform authorization, tenant isolation, and record ownership.
 */
export async function getUnifiedDriveFileById(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  fileId: string;
  expectedRecordId?: string;
  allowTrashed?: boolean;
}): Promise<UnifiedDriveRemoteFileMetadata> {
  const cleanFileId = (params.fileId || '').trim();
  if (!cleanFileId) {
    throw new UnifiedDriveError('INVALID_INPUT', 'معرّف ملف Google Drive (fileId) مطلوب.');
  }

  assertUnifiedDriveAccess({
    actor: params.actor,
    org: params.org,
    operation: 'get_file_metadata',
  });

  const res = await executeDriveRequest({
    url: `${DRIVE_FILES_API_BASE}/${encodeURIComponent(
      cleanFileId
    )}?fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`,
    method: 'GET',
    token: params.token,
    orgId: params.org.id,
    operation: 'get_file_metadata',
    fileId: cleanFileId,
  });

  const meta = mapRawDriveFileToRemoteMeta(await res.json());
  if (!meta.fileId || meta.fileId !== cleanFileId) {
    throw new UnifiedDriveError('DRIVE_API_ERROR', 'تعارض في معرّف الملف المسترجع من Google Drive.');
  }

  // Strict Cross-Organization Isolation Check
  if (meta.appProperties.orgId && meta.appProperties.orgId !== params.org.id) {
    throw new UnifiedDriveError(
      'CROSS_ORG_FORBIDDEN',
      'رفض عزل المؤسسات: الملف المطلوب يتبع لمؤسسة أخرى ولا يمكن الوصول إليه حتى عند معرفة معرّفه.'
    );
  }

  // Optional Record Ownership Check (supports both unified `recordId` and legacy `closingId`)
  if (params.expectedRecordId) {
    const boundRecordId = meta.appProperties.recordId || meta.appProperties.closingId;
    if (boundRecordId && boundRecordId !== params.expectedRecordId) {
      throw new UnifiedDriveError(
        'RECORD_OWNERSHIP_MISMATCH',
        `الملف (${cleanFileId}) مرتبط بسجل آخر (${boundRecordId}) وليس بالسجل المطلوب (${params.expectedRecordId}).`
      );
    }
  }

  if (meta.trashed && !params.allowTrashed) {
    throw new UnifiedDriveError(
      'NOT_FOUND',
      `الملف "${meta.fileName || cleanFileId}" موجود حالياً في سلة مهملات Google Drive.`
    );
  }

  return meta;
}

/**
 * Downloads binary file bytes strictly by canonical `fileId` after enforcing
 * platform authorization, tenant isolation, and record ownership.
 */
export async function downloadUnifiedDriveFile(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  fileId: string;
  expectedRecordId?: string;
}): Promise<{
  bytes: Uint8Array;
  metadata: UnifiedDriveRemoteFileMetadata;
}> {
  const metadata = await getUnifiedDriveFileById({
    token: params.token,
    actor: params.actor,
    org: params.org,
    fileId: params.fileId,
    expectedRecordId: params.expectedRecordId,
    allowTrashed: false,
  });

  const mediaRes = await executeDriveRequest({
    url: `${DRIVE_FILES_API_BASE}/${encodeURIComponent(metadata.fileId)}?alt=media`,
    method: 'GET',
    token: params.token,
    orgId: params.org.id,
    operation: 'download_file',
    fileId: metadata.fileId,
    targetLabel: metadata.fileName,
  });

  const bytes = new Uint8Array(await mediaRes.arrayBuffer());
  recordDiagnostic({
    operation: 'download_file',
    status: 'ok',
    orgId: params.org.id,
    fileId: metadata.fileId,
    message: `تم تنزيل الملف "${metadata.fileName}" (${bytes.byteLength} بايت).`,
  });

  return { bytes, metadata };
}

/**
 * Updates a Drive file's name, metadata (`appProperties`), and/or binary content while
 * strictly preserving the immutable `fileId` and its linked platform record.
 */
export async function updateUnifiedDriveFile(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  fileId: string;
  expectedRecordId?: string;
  newFileName?: string;
  newBytes?: Uint8Array;
  newMimeType?: string;
  mergeAppProperties?: Record<string, string>;
}): Promise<{
  metadata: UnifiedDriveRemoteFileMetadata;
  auditEvent: UnifiedDriveAuditEvent;
}> {
  const current = await getUnifiedDriveFileById({
    token: params.token,
    actor: params.actor,
    org: params.org,
    fileId: params.fileId,
    expectedRecordId: params.expectedRecordId,
    allowTrashed: false,
  });

  const cleanNewName = params.newFileName?.trim();
  if (params.newFileName !== undefined && (!cleanNewName || cleanNewName.length > 255)) {
    throw new UnifiedDriveError('INVALID_INPUT', 'الاسم الجديد للملف غير صالح أو يتجاوز 255 حرفاً.');
  }

  const mergedProps: Record<string, string> = {
    ...current.appProperties,
    ...(params.mergeAppProperties || {}),
    // Never allow orgId tampering on update
    orgId: params.org.id,
  };

  const metadataPatch: Record<string, unknown> = {
    ...(cleanNewName ? { name: cleanNewName } : {}),
    ...(params.newMimeType ? { mimeType: params.newMimeType } : {}),
    appProperties: mergedProps,
  };

  let res: Response;
  if (params.newBytes) {
    const mime = params.newMimeType || current.mimeType || 'application/octet-stream';
    const { boundary, body } = buildMultipartRelatedBody({
      metadata: metadataPatch,
      contentBytes: params.newBytes,
      mimeType: mime,
    });
    res = await executeDriveRequest({
      url: `${DRIVE_UPLOAD_API_BASE}/${encodeURIComponent(
        current.fileId
      )}?uploadType=multipart&fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`,
      method: 'PATCH',
      token: params.token,
      orgId: params.org.id,
      operation: 'update_file_content',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: body as BodyInit,
      fileId: current.fileId,
      targetLabel: cleanNewName || current.fileName,
    });
  } else {
    res = await executeDriveRequest({
      url: `${DRIVE_FILES_API_BASE}/${encodeURIComponent(
        current.fileId
      )}?fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`,
      method: 'PATCH',
      token: params.token,
      orgId: params.org.id,
      operation: cleanNewName ? 'rename_file' : 'update_file_metadata',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadataPatch),
      fileId: current.fileId,
      targetLabel: cleanNewName || current.fileName,
    });
  }

  const updated = mapRawDriveFileToRemoteMeta(await res.json());
  const isPureRename = Boolean(cleanNewName && !params.newBytes && cleanNewName !== current.fileName);

  const auditEvent = makeAuditEvent({
    action: isPureRename ? 'DRIVE_FILE_RENAMED' : 'DRIVE_FILE_UPDATED',
    actor: params.actor,
    orgId: params.org.id,
    branchId: updated.appProperties.branchId,
    fileId: updated.fileId,
    fileName: updated.fileName,
    documentType: updated.appProperties.documentType as UnifiedDriveDocumentType | undefined,
    recordId: updated.appProperties.recordId || updated.appProperties.closingId,
    details: isPureRename
      ? `إعادة تسمية الملف من "${current.fileName}" إلى "${updated.fileName}" مع الحفاظ على المعرّف ${updated.fileId}`
      : `تحديث بيانات/محتوى الملف "${updated.fileName}" (${updated.fileId})`,
    previousValues: { fileName: current.fileName, fileSize: current.fileSize },
    newValues: { fileName: updated.fileName, fileSize: updated.fileSize },
  });

  return { metadata: updated, auditEvent };
}

/**
 * Moves a Drive file to another verified folder via `addParents` / `removeParents`.
 * Strictly preserves immutable `fileId` and all platform record links.
 */
export async function moveUnifiedDriveFile(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  fileId: string;
  targetFolderId: string;
  expectedRecordId?: string;
}): Promise<{
  metadata: UnifiedDriveRemoteFileMetadata;
  previousParents: string[];
  moved: boolean;
  auditEvent: UnifiedDriveAuditEvent;
}> {
  const targetFolderId = (params.targetFolderId || '').trim();
  if (!targetFolderId) {
    throw new UnifiedDriveError('INVALID_INPUT', 'معرّف المجلد الهدف (targetFolderId) مطلوب للنقل.');
  }

  const current = await getUnifiedDriveFileById({
    token: params.token,
    actor: params.actor,
    org: params.org,
    fileId: params.fileId,
    expectedRecordId: params.expectedRecordId,
    allowTrashed: false,
  });

  // Verify target folder belongs to same org and is a non-trashed folder
  const targetFolderRes = await executeDriveRequest({
    url: `${DRIVE_FILES_API_BASE}/${encodeURIComponent(
      targetFolderId
    )}?fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`,
    method: 'GET',
    token: params.token,
    orgId: params.org.id,
    operation: 'verify_move_target_folder',
    folderId: targetFolderId,
  });
  const targetFolderMeta = mapRawDriveFileToRemoteMeta(await targetFolderRes.json());
  if (targetFolderMeta.trashed || targetFolderMeta.mimeType !== DRIVE_FOLDER_MIME) {
    throw new UnifiedDriveError(
      'INVALID_INPUT',
      `المجلد الهدف (${targetFolderId}) غير صالح أو موجود في سلة المهملات.`
    );
  }
  if (targetFolderMeta.appProperties.orgId && targetFolderMeta.appProperties.orgId !== params.org.id) {
    throw new UnifiedDriveError(
      'CROSS_ORG_FORBIDDEN',
      'رفض عزل المؤسسات: لا يمكن نقل ملف إلى مجلد تابع لمؤسسة أخرى.'
    );
  }

  const previousParents = [...current.parents];
  if (previousParents.length === 1 && previousParents[0] === targetFolderId) {
    const noOpAudit = makeAuditEvent({
      action: 'DRIVE_FILE_MOVED',
      actor: params.actor,
      orgId: params.org.id,
      branchId: current.appProperties.branchId,
      fileId: current.fileId,
      fileName: current.fileName,
      documentType: current.appProperties.documentType as UnifiedDriveDocumentType | undefined,
      recordId: current.appProperties.recordId || current.appProperties.closingId,
      details: `الملف "${current.fileName}" موجود مسبقاً داخل المجلد الهدف (${targetFolderId}).`,
      previousValues: { parents: previousParents },
      newValues: { parents: current.parents },
    });
    return { metadata: current, previousParents, moved: false, auditEvent: noOpAudit };
  }

  const parentsToRemove = previousParents.filter((p) => p !== targetFolderId);
  const url = new URL(`${DRIVE_FILES_API_BASE}/${encodeURIComponent(current.fileId)}`);
  url.searchParams.set('addParents', targetFolderId);
  if (parentsToRemove.length > 0) {
    url.searchParams.set('removeParents', parentsToRemove.join(','));
  }
  url.searchParams.set('fields', STANDARD_FILE_FIELDS);

  const patchRes = await executeDriveRequest({
    url: url.toString(),
    method: 'PATCH',
    token: params.token,
    orgId: params.org.id,
    operation: 'move_file',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    fileId: current.fileId,
    folderId: targetFolderId,
    targetLabel: current.fileName,
  });

  const movedMeta = mapRawDriveFileToRemoteMeta(await patchRes.json());
  const auditEvent = makeAuditEvent({
    action: 'DRIVE_FILE_MOVED',
    actor: params.actor,
    orgId: params.org.id,
    branchId: movedMeta.appProperties.branchId,
    fileId: movedMeta.fileId,
    fileName: movedMeta.fileName,
    documentType: movedMeta.appProperties.documentType as UnifiedDriveDocumentType | undefined,
    recordId: movedMeta.appProperties.recordId || movedMeta.appProperties.closingId,
    details: `نقل الملف "${movedMeta.fileName}" (${movedMeta.fileId}) إلى المجلد "${targetFolderMeta.fileName}" (${targetFolderId}) دون تغيير المعرّف.`,
    previousValues: { parents: previousParents },
    newValues: { parents: movedMeta.parents },
  });

  return { metadata: movedMeta, previousParents, moved: true, auditEvent };
}

/**
 * Safe Delete — Moves a file to Google Drive Trash ONLY (`PATCH { trashed: true }`).
 *
 * Security & Integrity Rules:
 * 1. NEVER calls HTTP `DELETE` (permanent deletion is forbidden).
 * 2. Requires explicit confirmation (`confirmed: true`).
 * 3. Enforces full platform authorization + tenant isolation + record ownership BEFORE calling Drive.
 * 4. If Drive API fails, throws `UnifiedDriveError` and NEVER calls `onDriveTrashed` or reports success.
 * 5. NEVER deletes the parent financial record (closing, purchase, advance, payroll payment).
 * 6. Records who trashed what and when in `auditEvent`.
 */
export async function trashUnifiedDriveFile(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  fileId: string;
  confirmed: boolean;
  expectedRecordId?: string;
  documentType?: UnifiedDriveDocumentType;
  reason?: string;
  /**
   * Optional callback executed ONLY AFTER Google Drive confirms `trashed === true`,
   * to update platform attachment status (never deletes the parent financial record).
   */
  onDriveTrashed?: (result: {
    fileId: string;
    trashedAt: string;
    trashedBy: string;
    trashedByName: string;
  }) => Promise<void> | void;
}): Promise<UnifiedDriveTrashResult> {
  if (params.confirmed !== true) {
    throw new UnifiedDriveError(
      'CONFIRMATION_REQUIRED',
      'يجب تأكيد عملية النقل إلى سلة المهملات بشكل صريح قبل التنفيذ.'
    );
  }

  // Enforce RBAC + org isolation + record ownership BEFORE touching Drive
  const current = await getUnifiedDriveFileById({
    token: params.token,
    actor: params.actor,
    org: params.org,
    fileId: params.fileId,
    expectedRecordId: params.expectedRecordId,
    allowTrashed: true,
  });

  const patchRes = await executeDriveRequest({
    url: `${DRIVE_FILES_API_BASE}/${encodeURIComponent(
      current.fileId
    )}?fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`,
    method: 'PATCH',
    token: params.token,
    orgId: params.org.id,
    operation: 'trash_file',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
    fileId: current.fileId,
    targetLabel: current.fileName,
  });

  const trashedMeta = mapRawDriveFileToRemoteMeta(await patchRes.json());
  if (trashedMeta.trashed !== true) {
    throw new UnifiedDriveError(
      'DRIVE_API_ERROR',
      `لم يؤكد Google Drive نقل الملف "${current.fileName}" إلى سلة المهملات (trashed !== true).`
    );
  }

  const trashedAt = new Date().toISOString();
  const trashedByName = (params.actor.displayName || params.actor.email || 'مالك المؤسسة').trim();
  const cleanReason = params.reason?.trim();

  // Only AFTER Google Drive confirms trash do we update platform attachment state
  let platformStateUpdated = false;
  let platformStateError: string | undefined;

  if (params.onDriveTrashed) {
    try {
      await params.onDriveTrashed({
        fileId: trashedMeta.fileId,
        trashedAt,
        trashedBy: params.actor.uid,
        trashedByName,
      });
      platformStateUpdated = true;
    } catch (cbErr: any) {
      platformStateUpdated = false;
      const errMsg =
        typeof cbErr?.message === 'string' && cbErr.message.trim()
          ? cbErr.message
          : 'تم نقل الملف إلى سلة مهملات Google Drive ولكن تعذر تحديث حالة المرفق في قاعدة البيانات.';
      platformStateError = errMsg;
      recordDiagnostic({
        operation: 'trash_file_platform_sync',
        status: 'error',
        orgId: params.org.id,
        fileId: trashedMeta.fileId,
        message: errMsg,
      });
    }
  }

  const auditEvent = makeAuditEvent({
    action: 'DRIVE_FILE_TRASHED',
    actor: params.actor,
    orgId: params.org.id,
    branchId: trashedMeta.appProperties.branchId,
    fileId: trashedMeta.fileId,
    fileName: trashedMeta.fileName || current.fileName,
    documentType:
      params.documentType ||
      (trashedMeta.appProperties.documentType as UnifiedDriveDocumentType | undefined),
    recordId:
      params.expectedRecordId ||
      trashedMeta.appProperties.recordId ||
      trashedMeta.appProperties.closingId,
    details: `نقل الملف "${trashedMeta.fileName || current.fileName}" (${trashedMeta.fileId}) إلى سلة مهملات Google Drive (حذف آمن غير نهائي، مع بقاء السجل المالي سليماً)${
      cleanReason ? ` — السبب: ${cleanReason}` : ''
    }`,
    previousValues: { trashed: current.trashed, status: current.trashed ? 'trashed' : 'active' },
    newValues: {
      trashed: true,
      status: 'trashed',
      trashedAt,
      trashedBy: params.actor.uid,
      ...(cleanReason ? { trashReason: cleanReason } : {}),
    },
  });

  recordDiagnostic({
    operation: 'trash_file',
    status: 'ok',
    orgId: params.org.id,
    fileId: trashedMeta.fileId,
    message: `تم نقل الملف "${trashedMeta.fileName}" إلى سلة المهملات بنجاح.`,
  });

  return {
    fileId: trashedMeta.fileId,
    fileName: trashedMeta.fileName || current.fileName,
    trashed: true,
    trashedAt,
    trashedBy: params.actor.uid,
    trashedByName,
    ...(cleanReason ? { trashReason: cleanReason } : {}),
    parentFinancialRecordPreserved: true,
    platformStateUpdated,
    ...(platformStateError ? { platformStateError } : {}),
    auditEvent,
  };
}

/**
 * Restores a previously trashed file from Google Drive Trash (`PATCH { trashed: false }`)
 * strictly for authorized organization owners.
 */
export async function restoreUnifiedDriveFile(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  fileId: string;
  expectedRecordId?: string;
}): Promise<UnifiedDriveRestoreResult> {
  const current = await getUnifiedDriveFileById({
    token: params.token,
    actor: params.actor,
    org: params.org,
    fileId: params.fileId,
    expectedRecordId: params.expectedRecordId,
    allowTrashed: true,
  });

  const patchRes = await executeDriveRequest({
    url: `${DRIVE_FILES_API_BASE}/${encodeURIComponent(
      current.fileId
    )}?fields=${encodeURIComponent(STANDARD_FILE_FIELDS)}`,
    method: 'PATCH',
    token: params.token,
    orgId: params.org.id,
    operation: 'restore_file',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: false }),
    fileId: current.fileId,
    targetLabel: current.fileName,
  });

  const restoredMeta = mapRawDriveFileToRemoteMeta(await patchRes.json());
  if (restoredMeta.trashed !== false) {
    throw new UnifiedDriveError(
      'DRIVE_API_ERROR',
      `تعذر تأكيد استعادة الملف "${current.fileName}" من سلة المهملات.`
    );
  }

  const restoredAt = new Date().toISOString();
  const auditEvent = makeAuditEvent({
    action: 'DRIVE_FILE_RESTORED',
    actor: params.actor,
    orgId: params.org.id,
    branchId: restoredMeta.appProperties.branchId,
    fileId: restoredMeta.fileId,
    fileName: restoredMeta.fileName || current.fileName,
    documentType: restoredMeta.appProperties.documentType as UnifiedDriveDocumentType | undefined,
    recordId:
      params.expectedRecordId ||
      restoredMeta.appProperties.recordId ||
      restoredMeta.appProperties.closingId,
    details: `استعادة الملف "${restoredMeta.fileName || current.fileName}" (${restoredMeta.fileId}) من سلة مهملات Google Drive.`,
    previousValues: { trashed: true },
    newValues: { trashed: false, restoredAt },
  });

  return {
    fileId: restoredMeta.fileId,
    fileName: restoredMeta.fileName || current.fileName,
    trashed: false,
    restoredAt,
    restoredBy: params.actor.uid,
    auditEvent,
  };
}

/**
 * Lists all app-accessible non-trashed files & folders belonging to the organization
 * (or under its Drive root) for read-only legacy inventory & migration planning.
 */
export async function listOrganizationDriveInventory(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
}): Promise<{
  folders: UnifiedDriveRemoteFileMetadata[];
  files: UnifiedDriveRemoteFileMetadata[];
}> {
  assertUnifiedDriveAccess({
    actor: params.actor,
    org: params.org,
    operation: 'list_org_inventory',
  });

  const allItems: UnifiedDriveRemoteFileMetadata[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(DRIVE_FILES_API_BASE);
    url.searchParams.set('q', 'trashed = false');
    url.searchParams.set('fields', `nextPageToken, files(${STANDARD_FILE_FIELDS})`);
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('includeItemsFromAllDrives', 'false');
    url.searchParams.set('supportsAllDrives', 'false');
    url.searchParams.set('pageSize', '100');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await executeDriveRequest({
      url: url.toString(),
      method: 'GET',
      token: params.token,
      orgId: params.org.id,
      operation: 'list_org_inventory',
    });
    const data = await res.json();
    if (Array.isArray(data.files)) {
      for (const raw of data.files) {
        const mapped = mapRawDriveFileToRemoteMeta(raw);
        if (mapped.trashed) continue;
        // Strict tenant filtering: exclude items explicitly tagged with a different orgId
        if (mapped.appProperties.orgId && mapped.appProperties.orgId !== params.org.id) {
          continue;
        }
        allItems.push(mapped);
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  const folders = allItems.filter((i) => i.mimeType === DRIVE_FOLDER_MIME);
  const files = allItems.filter((i) => i.mimeType !== DRIVE_FOLDER_MIME);
  return { folders, files };
}
