import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type {
  AuditLog,
  ClosingArchiveRecord,
  ShiftClosing,
  UserRole,
} from '../types';
import { assertValidIsoCalendarDate } from '../services/excelReportService';
import { buildClosingReviewedNotifications } from './notifications';

export type ShiftClosingConflictCode =
  | 'SLOT_ALREADY_APPROVED'
  | 'SLOT_PENDING_REVIEW'
  | 'SLOT_REJECTED_OTHER_EMPLOYEE'
  | 'SLOT_DRAFT_OTHER_EMPLOYEE'
  | 'SLOT_SERVER_UNAVAILABLE'
  | 'SLOT_VERIFICATION_PERMISSION_DENIED'
  | 'CLOSING_NOT_FOUND'
  | 'CLOSING_CROSS_ORG'
  | 'CLOSING_ALREADY_APPROVED'
  | 'CLOSING_NOT_PENDING_REVIEW'
  | 'SIBLING_CLOSING_ALREADY_APPROVED';

export const SUPERVISOR_APPROVAL_SUCCESS_AR =
  'تم اعتماد الإقفال بنجاح. تنتظر أرشفته في Google Drive إجراء مالك المؤسسة.';

export const SLOT_SERVER_UNAVAILABLE_AR =
  'تعذر التحقق من الإقفالات السابقة من الخادم بسبب انقطاع الاتصال. تم إيقاف العملية مؤقتاً، يرجى إعادة المحاولة عند عودة الاتصال.';

export const SLOT_VERIFICATION_PERMISSION_DENIED_AR =
  'تعذر التحقق من الإقفالات السابقة لهذه الوردية لعدم توفر صلاحية القراءة اللازمة في النظام. يرجى التواصل مع مدير المؤسسة.';

export interface PostApprovalFeedback {
  type: 'success' | 'warning';
  message: string;
}

export function isClosingPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: unknown }).code || '').toLowerCase();
  const msg = String((err as { message?: unknown }).message || '').toLowerCase();
  return (
    code === 'permission-denied' ||
    code === 'firestore/permission-denied' ||
    msg.includes('permission_denied') ||
    msg.includes('missing or insufficient permissions')
  );
}

export class ShiftClosingBusinessError extends Error {
  readonly code: ShiftClosingConflictCode;
  readonly conflictingClosingId?: string;

  constructor(
    code: ShiftClosingConflictCode,
    message: string,
    conflictingClosingId?: string
  ) {
    super(message);
    this.name = 'ShiftClosingBusinessError';
    this.code = code;
    this.conflictingClosingId = conflictingClosingId;
  }
}

export type ShiftClosingSlotEvaluation =
  | {
      allowed: true;
      mode: 'create_new';
      targetClosingId: string;
      existingOwnClosing: null;
      isResubmission: false;
    }
  | {
      allowed: true;
      mode: 'update_own';
      targetClosingId: string;
      existingOwnClosing: ShiftClosing;
      isResubmission: boolean;
    }
  | {
      allowed: false;
      conflictCode:
        | 'SLOT_ALREADY_APPROVED'
        | 'SLOT_PENDING_REVIEW'
        | 'SLOT_REJECTED_OTHER_EMPLOYEE'
        | 'SLOT_DRAFT_OTHER_EMPLOYEE';
      conflictingClosing: ShiftClosing;
      errorMessage: string;
    };

function formatPeriodArabic(period: 'morning' | 'evening'): string {
  return period === 'morning' ? 'صباحية' : 'مسائية';
}

function formatPeriodDefiniteArabic(period: 'morning' | 'evening'): string {
  return period === 'morning' ? 'الصباحية' : 'المسائية';
}

function formatOwnerSuffix(closing: ShiftClosing): string {
  const name = closing.employeeName?.trim();
  return name ? ` (باسم ${name})` : '';
}

/**
 * Deduplicates closings by document id while preserving insertion order.
 */
export function deduplicateSlotClosings(closings: ShiftClosing[]): ShiftClosing[] {
  const byId = new Map<string, ShiftClosing>();
  for (const item of closings) {
    if (!item || !item.id) continue;
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

/**
 * Enforces the binding Single-Closing-Per-Slot rule:
 * Strictly ONE closing is allowed per (orgId, branchId, date, period), regardless of status or employee.
 *
 * - approved: blocks everyone.
 * - pending_review: blocks everyone.
 * - rejected owned by another employee: blocks current user with a clear Arabic message (no alternate ID, no overwrite).
 * - draft owned by another employee: blocks current user with a clear Arabic message.
 * - draft or rejected owned by the current user: allows resuming/resubmitting that exact document in place.
 */
export function evaluateShiftClosingSlotPolicy(params: {
  slotClosings: ShiftClosing[];
  canonicalClosingId: string;
  actorUid: string;
  branchName: string;
  date: string;
  period: 'morning' | 'evening';
}): ShiftClosingSlotEvaluation {
  const uniqueClosings = deduplicateSlotClosings(params.slotClosings);
  const periodIndef = formatPeriodArabic(params.period);
  const periodDef = formatPeriodDefiniteArabic(params.period);

  // Priority 1: Any approved closing in this slot blocks all new/updated submissions
  const approvedClosing = uniqueClosings.find((c) => c.status === 'approved');
  if (approvedClosing) {
    return {
      allowed: false,
      conflictCode: 'SLOT_ALREADY_APPROVED',
      conflictingClosing: approvedClosing,
      errorMessage: `يوجد إقفال معتمد مسبقاً لهذا الفرع (${params.branchName}) للفترة ${periodDef} بتاريخ ${params.date}. لا يُسمح بتسجيل إقفال آخر أو تعديل الإقفال بعد اعتماده.`,
    };
  }

  // Priority 2: Any pending_review closing in this slot blocks all new/updated submissions
  const pendingClosing = uniqueClosings.find((c) => c.status === 'pending_review');
  if (pendingClosing) {
    const isOwn = pendingClosing.employeeId === params.actorUid;
    return {
      allowed: false,
      conflictCode: 'SLOT_PENDING_REVIEW',
      conflictingClosing: pendingClosing,
      errorMessage: isOwn
        ? `تم إرسال إقفال للوردية ${periodDef} بتاريخ ${params.date} وهو قيد مراجعة الإدارة حالياً.`
        : `يوجد إقفال قيد المراجعة بالفعل لفرع ${params.branchName} للفترة ${periodDef} بتاريخ ${params.date} بواسطة موظف آخر${formatOwnerSuffix(pendingClosing)}.`,
    };
  }

  // Priority 3: Any rejected closing belonging to another user blocks creating/overwriting this slot
  const rejectedOtherClosing = uniqueClosings.find(
    (c) => c.status === 'rejected' && c.employeeId !== params.actorUid
  );
  if (rejectedOtherClosing) {
    return {
      allowed: false,
      conflictCode: 'SLOT_REJECTED_OTHER_EMPLOYEE',
      conflictingClosing: rejectedOtherClosing,
      errorMessage: `لا يمكن تسجيل هذا الإقفال؛ توجد وردية ${periodIndef} مسجلة مسبقاً لفرع ${params.branchName} بتاريخ ${params.date}، وحالتها مرفوضة${formatOwnerSuffix(rejectedOtherClosing)}. يرجى مراجعة الإقفال السابق مع المدير أو المسؤول المختص.`,
    };
  }

  // Priority 4: Any draft closing belonging to another user blocks creating/overwriting this slot
  const draftOtherClosing = uniqueClosings.find(
    (c) => c.status === 'draft' && c.employeeId !== params.actorUid
  );
  if (draftOtherClosing) {
    return {
      allowed: false,
      conflictCode: 'SLOT_DRAFT_OTHER_EMPLOYEE',
      conflictingClosing: draftOtherClosing,
      errorMessage: `لا يمكن تسجيل هذا الإقفال؛ توجد مسودة لوردية ${periodIndef} مسجلة مسبقاً لفرع ${params.branchName} بتاريخ ${params.date}${formatOwnerSuffix(draftOtherClosing)}. يرجى مراجعة الإقفال السابق مع المدير أو المسؤول المختص.`,
    };
  }

  // Priority 5: Current user's own draft or rejected closing can be resumed/resubmitted in place
  const ownClosings = uniqueClosings.filter(
    (c) =>
      c.employeeId === params.actorUid &&
      (c.status === 'draft' || c.status === 'rejected')
  );
  if (ownClosings.length > 0) {
    const chosen =
      ownClosings.find((c) => c.id === params.canonicalClosingId) || ownClosings[0];
    return {
      allowed: true,
      mode: 'update_own',
      targetClosingId: chosen.id,
      existingOwnClosing: chosen,
      isResubmission: chosen.status === 'rejected',
    };
  }

  // Priority 6: Empty slot — create single canonical closing document
  return {
    allowed: true,
    mode: 'create_new',
    targetClosingId: params.canonicalClosingId,
    existingOwnClosing: null,
    isResubmission: false,
  };
}

export type ReviewClosingApprovalEvaluation =
  | { allowed: true }
  | {
      allowed: false;
      conflictCode:
        | 'CLOSING_CROSS_ORG'
        | 'CLOSING_ALREADY_APPROVED'
        | 'CLOSING_NOT_PENDING_REVIEW'
        | 'SIBLING_CLOSING_ALREADY_APPROVED';
      errorMessage: string;
      conflictingClosingId?: string;
    };

/**
 * Validates whether a shift closing may be approved or rejected, ensuring:
 * 1. Belongs to the reviewer's organization.
 * 2. Is currently in `pending_review` (cannot re-approve an already approved closing).
 * 3. On `approve`, NO other closing for the same (orgId, branchId, date, period) is already `approved`.
 */
export function evaluateReviewClosingApprovalPolicy(params: {
  targetClosing: ShiftClosing;
  siblingClosings: ShiftClosing[];
  action: 'approve' | 'reject';
  expectedOrgId: string;
}): ReviewClosingApprovalEvaluation {
  const { targetClosing, siblingClosings, action, expectedOrgId } = params;

  if (targetClosing.orgId !== expectedOrgId) {
    return {
      allowed: false,
      conflictCode: 'CLOSING_CROSS_ORG',
      errorMessage: 'لا يمكن مراجعة إقفال تابع لمؤسسة أخرى.',
      conflictingClosingId: targetClosing.id,
    };
  }

  if (targetClosing.status === 'approved') {
    return {
      allowed: false,
      conflictCode: 'CLOSING_ALREADY_APPROVED',
      errorMessage: 'الإقفال معتمد بالفعل ومقفل ضد التعديلات المباشرة.',
      conflictingClosingId: targetClosing.id,
    };
  }

  if (targetClosing.status !== 'pending_review') {
    return {
      allowed: false,
      conflictCode: 'CLOSING_NOT_PENDING_REVIEW',
      errorMessage:
        'لا يمكن مراجعة هذا الإقفال في حالته الحالية؛ يجب أن يكون بانتظار المراجعة.',
      conflictingClosingId: targetClosing.id,
    };
  }

  if (action === 'approve') {
    const approvedSibling = siblingClosings.find(
      (c) =>
        c.id !== targetClosing.id &&
        c.orgId === targetClosing.orgId &&
        c.branchId === targetClosing.branchId &&
        c.date === targetClosing.date &&
        c.period === targetClosing.period &&
        c.status === 'approved'
    );
    if (approvedSibling) {
      const periodDef = formatPeriodDefiniteArabic(targetClosing.period);
      return {
        allowed: false,
        conflictCode: 'SIBLING_CLOSING_ALREADY_APPROVED',
        errorMessage: `لا يمكن اعتماد هذا الإقفال؛ يوجد إقفال آخر معتمد مسبقاً لنفس الفرع (${targetClosing.branchName}) للفترة ${periodDef} بتاريخ ${targetClosing.date}.`,
        conflictingClosingId: approvedSibling.id,
      };
    }
  }

  return { allowed: true };
}

export function buildSafeReviewActorName(
  displayName?: string | null,
  email?: string | null
): string {
  let name = (displayName?.trim() || email?.trim() || 'الإدارة').slice(0, 100).trim();
  if (name.length < 2) {
    name = 'الإدارة';
  }
  return name;
}

/**
 * Executes the post-approval Google Drive archival flow strictly for organization managers.
 * Supervisors with `canApproveClosings` never invoke Google Drive archival and receive
 * a clear success confirmation stating that Drive archival awaits the organization owner.
 */
export async function runPostApprovalArchiveWorkflow(params: {
  isManager: boolean;
  archiveClosing: () => Promise<Pick<ClosingArchiveRecord, 'driveExcelFileName'>>;
  supervisorSuccessMessage?: string;
}): Promise<PostApprovalFeedback> {
  if (!params.isManager) {
    return {
      type: 'success',
      message: params.supervisorSuccessMessage || SUPERVISOR_APPROVAL_SUCCESS_AR,
    };
  }

  try {
    const saved = await params.archiveClosing();
    return {
      type: 'success',
      message: `تم اعتماد الإقفال وأرشفة ملف Excel (${saved.driveExcelFileName}) والتحقق منه في Google Drive.`,
    };
  } catch (archErr: any) {
    return {
      type: 'warning',
      message:
        archErr?.message ||
        'تم اعتماد الإقفال رسمياً. يرجى الضغط على «أرشفة في Google Drive» لرفع ملف Excel.',
    };
  }
}

/**
 * Queries Firestore server directly (`getDocsFromServer`) for all shift closings matching
 * the exact slot `(orgId, branchId, date, period)`.
 *
 * Fail-closed guarantees:
 * - Never falls back to local cache to allow creating/approving a closing.
 * - Offline / network failures throw `SLOT_SERVER_UNAVAILABLE` with a clear Arabic retry message.
 * - `permission-denied` failures throw `SLOT_VERIFICATION_PERMISSION_DENIED` and are never
 *   swallowed or converted into permission to write.
 */
export async function fetchSlotClosingsFromServer(params: {
  db?: Firestore;
  orgId: string;
  branchId: string;
  date: string;
  period: 'morning' | 'evening';
  /** Optional override for deterministic unit tests */
  serverReader?: () => Promise<ShiftClosing[]>;
}): Promise<ShiftClosing[]> {
  try {
    if (params.serverReader) {
      return deduplicateSlotClosings(await params.serverReader());
    }
    if (!params.db) {
      throw new Error('Firestore instance is required for server slot verification.');
    }
    const slotQuery = query(
      collection(params.db, 'closings'),
      where('orgId', '==', params.orgId),
      where('branchId', '==', params.branchId),
      where('date', '==', params.date),
      where('period', '==', params.period)
    );
    const snap = await getDocsFromServer(slotQuery);
    const found: ShiftClosing[] = [];
    snap.forEach((docSnap) => {
      found.push(docSnap.data() as ShiftClosing);
    });
    return deduplicateSlotClosings(found);
  } catch (err) {
    if (err instanceof ShiftClosingBusinessError) {
      throw err;
    }
    if (isClosingPermissionDeniedError(err)) {
      throw new ShiftClosingBusinessError(
        'SLOT_VERIFICATION_PERMISSION_DENIED',
        SLOT_VERIFICATION_PERMISSION_DENIED_AR
      );
    }
    throw new ShiftClosingBusinessError(
      'SLOT_SERVER_UNAVAILABLE',
      SLOT_SERVER_UNAVAILABLE_AR
    );
  }
}

/**
 * Executes closing approval or rejection atomically inside a Firestore `runTransaction`:
 * - Reads target closing and slot siblings authoritatively from Firestore server (`getDocFromServer` / `getDocsFromServer`).
 * - Locks BOTH the target closing AND every existing sibling closing via `tx.get(...)` in sorted order
 *   so concurrent approval attempts on the same closing OR on two existing sibling closings
 *   are serialized by Firestore's server-side OCC transaction engine without AB-BA deadlocks.
 * - Atomically writes `closings`, `auditLogs`, `closingArchives` (manager on approve only), and `notifications`.
 * - 100% compatible with existing deployed `firestore.rules` (zero rule or schema changes required).
 */
export async function executeAtomicReviewShiftClosing(params: {
  db: Firestore;
  orgId: string;
  closingId: string;
  action: 'approve' | 'reject';
  rejectionReason?: string;
  reviewerUid: string;
  reviewerName?: string | null;
  reviewerEmail?: string | null;
  reviewerRole: UserRole;
  cachedArchiveExists?: boolean;
}): Promise<void> {
  const {
    db,
    orgId,
    closingId,
    action,
    reviewerUid,
    reviewerName,
    reviewerEmail,
    reviewerRole,
  } = params;
  const cleanRejectionReason = params.rejectionReason?.trim() || '';

  const closingDocRef = doc(db, 'closings', closingId);
  let initialClosingSnap: Awaited<ReturnType<typeof getDocFromServer>>;
  try {
    initialClosingSnap = await getDocFromServer(closingDocRef);
  } catch (readErr) {
    if (isClosingPermissionDeniedError(readErr)) {
      throw new ShiftClosingBusinessError(
        'SLOT_VERIFICATION_PERMISSION_DENIED',
        SLOT_VERIFICATION_PERMISSION_DENIED_AR,
        closingId
      );
    }
    throw new ShiftClosingBusinessError(
      'SLOT_SERVER_UNAVAILABLE',
      SLOT_SERVER_UNAVAILABLE_AR,
      closingId
    );
  }

  if (!initialClosingSnap.exists()) {
    throw new ShiftClosingBusinessError(
      'CLOSING_NOT_FOUND',
      'سجل الإقفال غير موجود.',
      closingId
    );
  }
  const initialClosing = initialClosingSnap.data() as ShiftClosing;

  // Discover all existing closings sharing the same (orgId, branchId, date, period) slot
  // directly from Firestore server so every sibling can be locked via tx.get() inside the transaction.
  const serverSlotClosings = await fetchSlotClosingsFromServer({
    db,
    orgId: initialClosing.orgId,
    branchId: initialClosing.branchId,
    date: initialClosing.date,
    period: initialClosing.period,
  });
  const siblingIds: string[] = serverSlotClosings
    .filter((c) => c.id !== closingId)
    .map((c) => c.id);

  // Only `manager` is permitted by firestore.rules to create/update `closingArchives`
  // when transitioning a closing to `approved` (`canCreateClosingArchive` / `canUpdateClosingArchive`).
  // Supervisors with `canApproveClosings` approve the closing + auditLog + notifications while
  // leaving the existing `pending_drive_sync` archive index intact for the manager's Drive sync.
  const shouldSyncArchiveOnApprove = action === 'approve' && reviewerRole === 'manager';

  // Safely detect archive existence directly from server via list query (avoids null-resource.data
  // `get` rule error when a legacy closing has no closingArchives doc yet).
  let archiveExistsBeforeTx = Boolean(params.cachedArchiveExists);
  if (shouldSyncArchiveOnApprove && !archiveExistsBeforeTx) {
    try {
      const archiveQuery = query(
        collection(db, 'closingArchives'),
        where('orgId', '==', orgId),
        where('closingId', '==', closingId)
      );
      const archiveQuerySnap = await getDocsFromServer(archiveQuery);
      archiveExistsBeforeTx = !archiveQuerySnap.empty;
    } catch (archCheckErr) {
      if (isClosingPermissionDeniedError(archCheckErr)) {
        throw new ShiftClosingBusinessError(
          'SLOT_VERIFICATION_PERMISSION_DENIED',
          SLOT_VERIFICATION_PERMISSION_DENIED_AR,
          closingId
        );
      }
      throw new ShiftClosingBusinessError(
        'SLOT_SERVER_UNAVAILABLE',
        SLOT_SERVER_UNAVAILABLE_AR,
        closingId
      );
    }
  }

  // Acquire transaction locks in strict canonical lexicographic order across all slot closings
  // to eliminate AB-BA lock-ordering deadlocks under concurrent sibling approvals.
  const sortedSlotDocIds = Array.from(new Set([closingId, ...siblingIds])).sort();
  const archiveDocRef = doc(db, 'closingArchives', closingId);
  const safeActorName = buildSafeReviewActorName(reviewerName, reviewerEmail);

  await runTransaction(db, async (tx) => {
    // 1. Read & lock all closings in this slot in deterministic sorted order
    let freshTarget: ShiftClosing | null = null;
    const freshSiblings: ShiftClosing[] = [];
    for (const slotDocId of sortedSlotDocIds) {
      const snap = await tx.get(doc(db, 'closings', slotDocId));
      if (!snap.exists()) continue;
      const docData = snap.data() as ShiftClosing;
      if (slotDocId === closingId) {
        freshTarget = docData;
      } else {
        freshSiblings.push(docData);
      }
    }

    if (!freshTarget) {
      throw new ShiftClosingBusinessError(
        'CLOSING_NOT_FOUND',
        'سجل الإقفال غير موجود.',
        closingId
      );
    }

    let freshArchiveSnap: Awaited<ReturnType<typeof tx.get>> | null = null;
    if (shouldSyncArchiveOnApprove && archiveExistsBeforeTx) {
      freshArchiveSnap = await tx.get(archiveDocRef);
    }

    // 2. Re-validate status & single-approved-closing-per-slot invariant inside transaction
    const reviewCheck = evaluateReviewClosingApprovalPolicy({
      targetClosing: freshTarget,
      siblingClosings: freshSiblings,
      action,
      expectedOrgId: orgId,
    });
    if (!reviewCheck.allowed) {
      throw new ShiftClosingBusinessError(
        reviewCheck.conflictCode,
        reviewCheck.errorMessage,
        reviewCheck.conflictingClosingId
      );
    }

    const { yearMonth } = assertValidIsoCalendarDate(freshTarget.date);
    const nowIso = new Date().toISOString();

    // 3. Atomic writes: closing status update, immutable audit log, archive index (manager), notifications
    const updateData: Partial<ShiftClosing> = {
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedBy: reviewerUid,
      reviewedByName: safeActorName,
      reviewedAt: nowIso,
      updatedAt: nowIso,
      rejectionReason: action === 'reject' ? cleanRejectionReason : '',
    };
    tx.update(closingDocRef, updateData);

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const logRef = doc(db, 'auditLogs', logId);
    const auditEntry: AuditLog = {
      id: logId,
      orgId,
      actorId: reviewerUid,
      actorName: safeActorName,
      actorRole: reviewerRole,
      action: action === 'approve' ? 'CLOSING_APPROVED' : 'CLOSING_REJECTED_FOR_REVISION',
      targetType: 'closing',
      targetId: closingId,
      details: (
        action === 'approve'
          ? `اعتماد إقفال ${freshTarget.branchName} (${freshTarget.period}) بتاريخ ${freshTarget.date} - إجمالي ${freshTarget.totalSales}`
          : `إعادة إقفال ${freshTarget.branchName} (${freshTarget.period}) للتعديل. السبب: ${cleanRejectionReason}`
      ).slice(0, 1000),
      timestamp: nowIso,
    };
    tx.set(logRef, auditEntry);

    if (shouldSyncArchiveOnApprove) {
      if (!freshArchiveSnap || !freshArchiveSnap.exists()) {
        tx.set(archiveDocRef, {
          closingId,
          orgId,
          branchId: freshTarget.branchId,
          yearMonth,
          archiveStatus: 'pending_drive_sync',
          updatedAt: nowIso,
        });
      } else {
        const prevArchive = freshArchiveSnap.data() as ClosingArchiveRecord;
        if (prevArchive.archiveStatus === 'pending_drive_sync') {
          tx.update(archiveDocRef, {
            archiveStatus: 'pending_drive_sync',
            updatedAt: nowIso,
          });
        }
      }
    }

    const reviewNotifs = buildClosingReviewedNotifications({
      closing: freshTarget,
      action,
      rejectionReason: cleanRejectionReason,
      actorUid: reviewerUid,
      actorName: safeActorName,
      actorRole: reviewerRole,
      createdAt: nowIso,
    });
    reviewNotifs.forEach((n) => {
      tx.set(doc(db, 'notifications', n.id), n);
    });
  });
}
