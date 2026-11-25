/**
 * Legacy Google Drive Inventory & Resumable Migration Planner — الإقفال | AL EQFAL
 * ---------------------------------------------------------------------------------
 * Safely inventories pre-existing Google Drive files and plans non-destructive migration
 * into the approved Unified Hierarchy without EVER performing automatic bulk moves,
 * renames, or deletions.
 *
 * Guarantees:
 * - Matches legacy Drive files strictly by canonical `fileId` against platform records.
 * - Detects already-unified files, ready-to-move files, duplicates, unmatched/ambiguous
 *   files, and missing Drive references.
 * - Leaves unmatched, duplicate, or ambiguous files untouched in place and reports them.
 * - Supports resumable checkpointing via `applyMigrationPlanCheckpoint`.
 * - Single-step execution (`executeMigrationPlanItem`) requires explicit manual approval
 *   (`manualApprovalConfirmed: true`) and uses `moveUnifiedDriveFile` (preserving `fileId`).
 */

import type { Branch, Organization } from '../types';
import {
  DriveMigrationPlan,
  DriveMigrationPlanItem,
  LegacyPlatformRecordRef,
  UNIFIED_BRANCHES_FOLDER_NAME,
  UNIFIED_ORG_IMPORTANT_DOCS_FOLDER_NAME,
  UnifiedDriveActorContext,
  UnifiedDriveError,
  UnifiedDriveRemoteFileMetadata,
} from '../types/unifiedDrive';
import {
  buildUnifiedBranchFolderName,
  buildUnifiedOrgFolderName,
  ensureOrgImportantDocsFolder,
  ensureUnifiedDailyFolderPath,
  moveUnifiedDriveFile,
  parseUnifiedDocumentDate,
} from '../services/unifiedDriveService';

function buildTargetPathPreview(params: {
  org: Organization;
  branch?: Branch;
  record: LegacyPlatformRecordRef;
}): string | null {
  const orgRootName = params.org.driveFolderName?.trim() || buildUnifiedOrgFolderName(params.org);

  if (params.record.documentType === 'org_important_document') {
    return `${orgRootName} / ${UNIFIED_ORG_IMPORTANT_DOCS_FOLDER_NAME}`;
  }

  if (!params.branch || !params.record.documentDate) {
    return null;
  }

  try {
    const parsed = parseUnifiedDocumentDate(params.record.documentDate);
    const branchFolderName = buildUnifiedBranchFolderName(params.branch);
    return `${orgRootName} / ${UNIFIED_BRANCHES_FOLDER_NAME} / ${branchFolderName} / ${parsed.year} / ${parsed.month} / ${parsed.day}`;
  } catch {
    return null;
  }
}

/**
 * Pure, deterministic, non-destructive migration planner.
 * Never mutates Google Drive or Firestore.
 */
export function buildLegacyDriveMigrationPlan(params: {
  org: Organization;
  branches: Branch[];
  driveFolders: UnifiedDriveRemoteFileMetadata[];
  driveFiles: UnifiedDriveRemoteFileMetadata[];
  platformRecords: LegacyPlatformRecordRef[];
  nowIso?: string;
}): DriveMigrationPlan {
  const { org, branches, driveFolders, driveFiles, platformRecords } = params;
  const nowIso = params.nowIso || new Date().toISOString();

  const branchById = new Map<string, Branch>();
  for (const b of branches) {
    if (b.orgId === org.id) {
      branchById.set(b.id, b);
    }
  }

  const folderById = new Map<string, UnifiedDriveRemoteFileMetadata>();
  for (const f of driveFolders) {
    folderById.set(f.fileId, f);
  }

  const driveFileById = new Map<string, UnifiedDriveRemoteFileMetadata>();
  for (const f of driveFiles) {
    driveFileById.set(f.fileId, f);
  }

  // Group org-scoped platform records by canonical fileId
  const orgRecords = platformRecords.filter((r) => r.orgId === org.id && Boolean(r.fileId?.trim()));
  const recordsByFileId = new Map<string, LegacyPlatformRecordRef[]>();
  for (const rec of orgRecords) {
    const fid = rec.fileId.trim();
    const list = recordsByFileId.get(fid) || [];
    list.push(rec);
    recordsByFileId.set(fid, list);
  }

  // Detect duplicate Drive files claiming the same logical record + docType + revision/fileName
  const filesByLogicalKey = new Map<string, string[]>();
  for (const f of driveFiles) {
    const recId = f.appProperties.recordId || f.appProperties.closingId;
    if (!recId) continue;
    const rev = f.appProperties.revision || '';
    const docType = f.appProperties.documentType || f.appProperties.role || '';
    const logicalKey = `${recId}|${docType}|${rev}|${f.fileName}`;
    const list = filesByLogicalKey.get(logicalKey) || [];
    list.push(f.fileId);
    filesByLogicalKey.set(logicalKey, list);
  }

  const duplicateFileIdMap = new Map<string, string[]>();
  for (const ids of filesByLogicalKey.values()) {
    if (ids.length > 1) {
      for (const id of ids) {
        duplicateFileIdMap.set(id, ids);
      }
    }
  }

  const items: DriveMigrationPlanItem[] = [];
  const seenFileIds = new Set<string>();

  for (const file of driveFiles) {
    seenFileIds.add(file.fileId);
    const matchedRecords = recordsByFileId.get(file.fileId) || [];

    // 1. Duplicate logical files -> DO NOT auto-delete or auto-move; skip & report
    const dupIds = duplicateFileIdMap.get(file.fileId);
    if (dupIds && dupIds.length > 1) {
      items.push({
        planItemId: `mig_${file.fileId}`,
        fileId: file.fileId,
        fileName: file.fileName,
        currentParentIds: [...file.parents],
        classification: 'skip_duplicate',
        executionStatus: 'skipped',
        matchedRecord: matchedRecords[0],
        duplicateFileIds: dupIds,
        reason: `تم رصد (${dupIds.length}) نسخ مكررة محتملة لنفس المستند في Drive؛ يُترك بدون تعديل للمراجعة اليدوية.`,
      });
      continue;
    }

    // 2. Unmatched or ambiguous platform mapping -> DO NOT guess; leave untouched & report
    if (matchedRecords.length === 0) {
      items.push({
        planItemId: `mig_${file.fileId}`,
        fileId: file.fileId,
        fileName: file.fileName,
        currentParentIds: [...file.parents],
        classification: 'skip_unmatched',
        executionStatus: 'skipped',
        reason:
          'ملف غير مطابق لأي سجل موثق بالمنصة عبر fileId؛ سيُترك في مكانه الحالي دون نقل أو حذف.',
      });
      continue;
    }

    if (matchedRecords.length > 1) {
      items.push({
        planItemId: `mig_${file.fileId}`,
        fileId: file.fileId,
        fileName: file.fileName,
        currentParentIds: [...file.parents],
        classification: 'skip_unmatched',
        executionStatus: 'skipped',
        reason: `ملف مرتبط بأكثر من سجل (${matchedRecords.length}) بشكل ملتبس؛ يُترك دون تعديل للمراجعة.`,
      });
      continue;
    }

    const rec = matchedRecords[0];
    const branch = rec.branchId ? branchById.get(rec.branchId) : undefined;
    const targetPreview = buildTargetPathPreview({ org, branch, record: rec });

    if (!targetPreview) {
      items.push({
        planItemId: `mig_${file.fileId}`,
        fileId: file.fileId,
        fileName: file.fileName,
        currentParentIds: [...file.parents],
        classification: 'skip_unmatched',
        executionStatus: 'skipped',
        matchedRecord: rec,
        reason:
          'تعذر تحديد المسار الموحّد لعدم توفر الفرع أو تاريخ صالح (YYYY-MM-DD)؛ يُترك في مكانه الحالي.',
      });
      continue;
    }

    // Check if already inside the exact unified destination folder
    const currentParentFolder = file.parents[0] ? folderById.get(file.parents[0]) : undefined;
    const isAlreadyInUnifiedFolder =
      Boolean(currentParentFolder) &&
      ((rec.documentType === 'org_important_document' &&
        currentParentFolder!.appProperties.role === 'org_important_docs' &&
        currentParentFolder!.appProperties.orgId === org.id) ||
        (rec.documentType !== 'org_important_document' &&
          currentParentFolder!.appProperties.role === 'day_folder' &&
          currentParentFolder!.appProperties.orgId === org.id &&
          currentParentFolder!.appProperties.branchId === rec.branchId &&
          currentParentFolder!.appProperties.date === rec.documentDate));

    if (isAlreadyInUnifiedFolder) {
      items.push({
        planItemId: `mig_${file.fileId}`,
        fileId: file.fileId,
        fileName: file.fileName,
        currentParentIds: [...file.parents],
        classification: 'already_unified',
        executionStatus: 'completed',
        matchedRecord: rec,
        targetPathPreview: targetPreview,
        reason: 'الملف موجود بالفعل داخل المجلد الموحّد الصحيح.',
      });
      continue;
    }

    items.push({
      planItemId: `mig_${file.fileId}`,
      fileId: file.fileId,
      fileName: file.fileName,
      currentParentIds: [...file.parents],
      classification: 'ready_to_move',
      executionStatus: 'pending',
      matchedRecord: rec,
      targetPathPreview: targetPreview,
      reason: 'مطابقة مؤكدة عبر fileId؛ جاهز للنقل الآمن (دون تغيير fileId أو حذف أي نسخة).',
    });
  }

  // 3. Platform records pointing to fileIds not seen in Drive inventory
  for (const rec of orgRecords) {
    if (!seenFileIds.has(rec.fileId)) {
      items.push({
        planItemId: `mig_missing_${rec.fileId}`,
        fileId: rec.fileId,
        fileName: rec.fileName || rec.fileId,
        currentParentIds: [],
        classification: 'missing_in_drive',
        executionStatus: 'skipped',
        matchedRecord: rec,
        reason:
          'المعرّف مسجل في المنصة لكنه غير ظاهر في جرد Google Drive الحالي (قد يكون محذوفاً أو خارج نطاق drive.file).',
      });
    }
  }

  return recalculatePlanCounts({
    planId: `drv_plan_${org.id}_${Date.now().toString(36)}`,
    orgId: org.id,
    orgName: org.name,
    generatedAt: nowIso,
    totalDriveFilesScanned: driveFiles.length,
    totalPlatformRecordsChecked: orgRecords.length,
    counts: {
      alreadyUnified: 0,
      readyToMove: 0,
      skippedDuplicates: 0,
      skippedUnmatched: 0,
      missingInDrive: 0,
      completed: 0,
      failed: 0,
    },
    items,
  });
}

function recalculatePlanCounts(plan: DriveMigrationPlan): DriveMigrationPlan {
  const counts = {
    alreadyUnified: 0,
    readyToMove: 0,
    skippedDuplicates: 0,
    skippedUnmatched: 0,
    missingInDrive: 0,
    completed: 0,
    failed: 0,
  };
  for (const item of plan.items) {
    if (item.classification === 'already_unified') counts.alreadyUnified += 1;
    else if (item.classification === 'ready_to_move') counts.readyToMove += 1;
    else if (item.classification === 'skip_duplicate') counts.skippedDuplicates += 1;
    else if (item.classification === 'skip_unmatched') counts.skippedUnmatched += 1;
    else if (item.classification === 'missing_in_drive') counts.missingInDrive += 1;

    if (item.executionStatus === 'completed') counts.completed += 1;
    else if (item.executionStatus === 'failed') counts.failed += 1;
  }
  return { ...plan, counts };
}

/**
 * Resumes an interrupted migration plan by marking previously completed `planItemIds`
 * so they are skipped idempotently on continuation.
 */
export function applyMigrationPlanCheckpoint(
  plan: DriveMigrationPlan,
  completedItemIds: ReadonlySet<string> | readonly string[]
): DriveMigrationPlan {
  const doneSet =
    completedItemIds instanceof Set ? completedItemIds : new Set<string>(completedItemIds);
  const updatedItems: DriveMigrationPlanItem[] = plan.items.map((item) => {
    if (doneSet.has(item.planItemId) && item.classification === 'ready_to_move') {
      return {
        ...item,
        executionStatus: 'completed',
        completedAt: item.completedAt || new Date().toISOString(),
      };
    }
    return item;
  });
  return recalculatePlanCounts({ ...plan, items: updatedItems });
}

/**
 * Explicitly opt-in single-item migration executor.
 * NEVER auto-invoked; requires `manualApprovalConfirmed: true`.
 * Moves a verified `ready_to_move` file into its unified folder via `addParents`/`removeParents`,
 * preserving immutable `fileId` and leaving skipped/unmatched/duplicate files completely untouched.
 */
export async function executeMigrationPlanItem(params: {
  token: string;
  actor: UnifiedDriveActorContext;
  org: Organization;
  branches: Branch[];
  item: DriveMigrationPlanItem;
  manualApprovalConfirmed: boolean;
}): Promise<DriveMigrationPlanItem> {
  if (params.manualApprovalConfirmed !== true) {
    throw new UnifiedDriveError(
      'CONFIRMATION_REQUIRED',
      'لا يُسمح بتنفيذ أي خطوة ترحيل دون موافقة يدوية صريحة (manualApprovalConfirmed: true).'
    );
  }

  const { item } = params;
  if (item.classification !== 'ready_to_move' || item.executionStatus === 'completed') {
    return item;
  }

  const rec = item.matchedRecord;
  if (!rec) {
    return {
      ...item,
      executionStatus: 'skipped',
      reason: 'لا يوجد سجل مطابق لتنفيذ النقل.',
    };
  }

  try {
    let targetFolderId: string;
    if (rec.documentType === 'org_important_document') {
      const resolved = await ensureOrgImportantDocsFolder({
        token: params.token,
        actor: params.actor,
        org: params.org,
      });
      targetFolderId = resolved.importantDocsFolder.folderId;
    } else {
      const branch = params.branches.find((b) => b.id === rec.branchId && b.orgId === params.org.id);
      if (!branch || !rec.documentDate) {
        return {
          ...item,
          executionStatus: 'skipped',
          reason: 'الفرع أو التاريخ مفقود؛ تم التخطي بأمان.',
        };
      }
      const resolved = await ensureUnifiedDailyFolderPath({
        token: params.token,
        actor: params.actor,
        org: params.org,
        branch,
        date: rec.documentDate,
      });
      targetFolderId = resolved.dayFolder.folderId;
    }

    await moveUnifiedDriveFile({
      token: params.token,
      actor: params.actor,
      org: params.org,
      fileId: item.fileId,
      targetFolderId,
      expectedRecordId: rec.recordId,
    });

    return {
      ...item,
      executionStatus: 'completed',
      completedAt: new Date().toISOString(),
      errorMessage: undefined,
    };
  } catch (err: any) {
    return {
      ...item,
      executionStatus: 'failed',
      errorMessage: err?.message || 'فشل نقل الملف أثناء خطوة الترحيل.',
    };
  }
}
