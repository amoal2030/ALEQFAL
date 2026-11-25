/**
 * Single-Closing-Per-Slot Policy & Concurrent Review Approval Guard — Unit Test Suite
 *
 * Verifies the binding business rule:
 * Strictly ONE shift closing is allowed per (orgId, branchId, date, period),
 * even when the existing closing is in `rejected` status.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { generateDeterministicClosingId } from '../utils/accounting';
import {
  evaluateReviewClosingApprovalPolicy,
  evaluateShiftClosingSlotPolicy,
  buildSafeReviewActorName,
  fetchSlotClosingsFromServer,
  runPostApprovalArchiveWorkflow,
  ShiftClosingBusinessError,
  SUPERVISOR_APPROVAL_SUCCESS_AR,
  SLOT_SERVER_UNAVAILABLE_AR,
  SLOT_VERIFICATION_PERMISSION_DENIED_AR,
} from '../utils/shiftClosingGuards';
import type { ShiftClosing } from '../types';

const ORG_ID = 'org_j04OhPFE_mwc49rr0';
const BRANCH_ID = 'br_mwc625b9';
const BRANCH_NAME = 'سحاب 1';
const DATE = '2026-11-23';
const PERIOD: 'evening' = 'evening';
const ABDULRAQIB_UID = 'K6D0rh2uUeaeXuJf666bio3HYlh1';
const MUHAMMAD_UID = 'HkcwFj4sGARuOZQmjDqFpMOcYsD2';

const CANONICAL_ID = generateDeterministicClosingId(ORG_ID, BRANCH_ID, DATE, PERIOD);

function makeClosing(overrides: Partial<ShiftClosing> = {}): ShiftClosing {
  return {
    id: CANONICAL_ID,
    orgId: ORG_ID,
    branchId: BRANCH_ID,
    branchName: BRANCH_NAME,
    employeeId: ABDULRAQIB_UID,
    employeeName: 'عبدالرقيب منصر',
    date: DATE,
    period: PERIOD,
    cashSales: 1000,
    cardSales: 500,
    totalSales: 1500,
    expenses: 100,
    remainingInBox: 900,
    netPeriod: 1400,
    notes: '',
    status: 'rejected',
    rejectionReason: 'تغيير الورديه صباحيه',
    attachmentIds: [],
    createdAt: '2026-11-23T10:00:00.000Z',
    updatedAt: '2026-11-23T10:30:00.000Z',
    ...overrides,
  };
}

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error('        ', err instanceof Error ? err.message : err);
    failed++;
  }
}

async function main() {
  console.log('========================================================================');
  console.log('   SINGLE-CLOSING-PER-SLOT & APPROVAL GUARDS — UNIT TEST SUITE          ');
  console.log('========================================================================');

  await runTest('1. Deterministic closing ID format remains unchanged (no UID suffix)', () => {
    assert.equal(
      CANONICAL_ID,
      'cls_orgj04OhPFEmwc49rr0_brmwc625b9_2026-11-23_evening'
    );
  });

  await runTest('2. Rejected closing by Abdulraqib strictly BLOCKS Muhammad with clear Arabic message', () => {
    const res = evaluateShiftClosingSlotPolicy({
      slotClosings: [makeClosing({ status: 'rejected', employeeId: ABDULRAQIB_UID })],
      canonicalClosingId: CANONICAL_ID,
      actorUid: MUHAMMAD_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });

    assert.equal(res.allowed, false);
    if (res.allowed) return;
    assert.equal(res.conflictCode, 'SLOT_REJECTED_OTHER_EMPLOYEE');
    assert.equal(res.conflictingClosing.id, CANONICAL_ID);
    assert.match(res.errorMessage, /مرفوضة/);
    assert.match(res.errorMessage, /عبدالرقيب منصر/);
    assert.match(res.errorMessage, /سحاب 1/);
    assert.doesNotMatch(res.errorMessage, /Missing or insufficient permissions/i);
  });

  await runTest('3. Rejected closing by the SAME user (Abdulraqib) ALLOWS in-place resubmission on same ID', () => {
    const res = evaluateShiftClosingSlotPolicy({
      slotClosings: [makeClosing({ status: 'rejected', employeeId: ABDULRAQIB_UID })],
      canonicalClosingId: CANONICAL_ID,
      actorUid: ABDULRAQIB_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });

    assert.equal(res.allowed, true);
    if (!res.allowed) return;
    assert.equal(res.mode, 'update_own');
    assert.equal(res.targetClosingId, CANONICAL_ID);
    assert.equal(res.isResubmission, true);
    assert.equal(res.existingOwnClosing?.employeeId, ABDULRAQIB_UID);
  });

  await runTest('4. Pending review closing BLOCKS both other employee and same employee', () => {
    const pending = makeClosing({ status: 'pending_review', employeeId: ABDULRAQIB_UID });

    const otherRes = evaluateShiftClosingSlotPolicy({
      slotClosings: [pending],
      canonicalClosingId: CANONICAL_ID,
      actorUid: MUHAMMAD_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });
    assert.equal(otherRes.allowed, false);
    if (!otherRes.allowed) {
      assert.equal(otherRes.conflictCode, 'SLOT_PENDING_REVIEW');
      assert.match(otherRes.errorMessage, /قيد المراجعة/);
    }

    const sameRes = evaluateShiftClosingSlotPolicy({
      slotClosings: [pending],
      canonicalClosingId: CANONICAL_ID,
      actorUid: ABDULRAQIB_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });
    assert.equal(sameRes.allowed, false);
    if (!sameRes.allowed) {
      assert.equal(sameRes.conflictCode, 'SLOT_PENDING_REVIEW');
    }
  });

  await runTest('5. Approved closing BLOCKS everyone from creating/modifying the slot', () => {
    const approved = makeClosing({ status: 'approved', employeeId: ABDULRAQIB_UID });

    for (const actorUid of [MUHAMMAD_UID, ABDULRAQIB_UID]) {
      const res = evaluateShiftClosingSlotPolicy({
        slotClosings: [approved],
        canonicalClosingId: CANONICAL_ID,
        actorUid,
        branchName: BRANCH_NAME,
        date: DATE,
        period: PERIOD,
      });
      assert.equal(res.allowed, false);
      if (!res.allowed) {
        assert.equal(res.conflictCode, 'SLOT_ALREADY_APPROVED');
        assert.match(res.errorMessage, /معتمد مسبقاً/);
      }
    }
  });

  await runTest('6. Draft closing by Employee A BLOCKS Employee B, while allowing Employee A to resume', () => {
    const draft = makeClosing({ status: 'draft', employeeId: ABDULRAQIB_UID });

    const otherRes = evaluateShiftClosingSlotPolicy({
      slotClosings: [draft],
      canonicalClosingId: CANONICAL_ID,
      actorUid: MUHAMMAD_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });
    assert.equal(otherRes.allowed, false);
    if (!otherRes.allowed) {
      assert.equal(otherRes.conflictCode, 'SLOT_DRAFT_OTHER_EMPLOYEE');
      assert.match(otherRes.errorMessage, /مسودة/);
    }

    const ownRes = evaluateShiftClosingSlotPolicy({
      slotClosings: [draft],
      canonicalClosingId: CANONICAL_ID,
      actorUid: ABDULRAQIB_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });
    assert.equal(ownRes.allowed, true);
    if (ownRes.allowed) {
      assert.equal(ownRes.mode, 'update_own');
      assert.equal(ownRes.isResubmission, false);
      assert.equal(ownRes.targetClosingId, CANONICAL_ID);
    }
  });

  await runTest('7. Multi-document slot inspection checks ALL docs (not just first doc)', () => {
    const ownDraft = makeClosing({ id: 'legacy_own_draft', status: 'draft', employeeId: MUHAMMAD_UID });
    const otherApproved = makeClosing({ id: CANONICAL_ID, status: 'approved', employeeId: ABDULRAQIB_UID });

    const res = evaluateShiftClosingSlotPolicy({
      slotClosings: [ownDraft, otherApproved],
      canonicalClosingId: CANONICAL_ID,
      actorUid: MUHAMMAD_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });

    assert.equal(res.allowed, false);
    if (!res.allowed) {
      assert.equal(res.conflictCode, 'SLOT_ALREADY_APPROVED');
      assert.equal(res.conflictingClosing.id, CANONICAL_ID);
    }
  });

  await runTest('8. Empty slot allows creating a brand-new closing with canonical deterministic ID', () => {
    const res = evaluateShiftClosingSlotPolicy({
      slotClosings: [],
      canonicalClosingId: CANONICAL_ID,
      actorUid: MUHAMMAD_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });

    assert.equal(res.allowed, true);
    if (!res.allowed) return;
    assert.equal(res.mode, 'create_new');
    assert.equal(res.targetClosingId, CANONICAL_ID);
    assert.equal(res.existingOwnClosing, null);
    assert.equal(res.isResubmission, false);
  });

  await runTest('9. Review policy blocks approving a closing if another sibling closing in same slot is already approved', () => {
    const target = makeClosing({ id: 'cls_sibling_pending', status: 'pending_review' });
    const approvedSibling = makeClosing({ id: CANONICAL_ID, status: 'approved' });

    const approveRes = evaluateReviewClosingApprovalPolicy({
      targetClosing: target,
      siblingClosings: [approvedSibling],
      action: 'approve',
      expectedOrgId: ORG_ID,
    });
    assert.equal(approveRes.allowed, false);
    if (!approveRes.allowed) {
      assert.equal(approveRes.conflictCode, 'SIBLING_CLOSING_ALREADY_APPROVED');
      assert.equal(approveRes.conflictingClosingId, CANONICAL_ID);
    }

    const rejectRes = evaluateReviewClosingApprovalPolicy({
      targetClosing: target,
      siblingClosings: [approvedSibling],
      action: 'reject',
      expectedOrgId: ORG_ID,
    });
    assert.equal(rejectRes.allowed, true);
  });

  await runTest('10. Review policy blocks re-approving an approved closing or reviewing non-pending closing', () => {
    const alreadyApproved = makeClosing({ status: 'approved' });
    const resApproved = evaluateReviewClosingApprovalPolicy({
      targetClosing: alreadyApproved,
      siblingClosings: [],
      action: 'approve',
      expectedOrgId: ORG_ID,
    });
    assert.equal(resApproved.allowed, false);
    if (!resApproved.allowed) {
      assert.equal(resApproved.conflictCode, 'CLOSING_ALREADY_APPROVED');
    }

    const rejectedClosing = makeClosing({ status: 'rejected' });
    const resRejected = evaluateReviewClosingApprovalPolicy({
      targetClosing: rejectedClosing,
      siblingClosings: [],
      action: 'approve',
      expectedOrgId: ORG_ID,
    });
    assert.equal(resRejected.allowed, false);
    if (!resRejected.allowed) {
      assert.equal(resRejected.conflictCode, 'CLOSING_NOT_PENDING_REVIEW');
    }

    assert.equal(buildSafeReviewActorName('م', 'a@b.com'), 'الإدارة');
    assert.equal(buildSafeReviewActorName('أحمد المدير', null), 'أحمد المدير');
  });

  await runTest('11. Supervisor approval NEVER calls Google Drive archival and shows clean Arabic success message without warning', async () => {
    let driveCalls = 0;
    const feedback = await runPostApprovalArchiveWorkflow({
      isManager: false,
      archiveClosing: async () => {
        driveCalls++;
        return { driveExcelFileName: 'should_not_run.xlsx' };
      },
    });

    assert.equal(driveCalls, 0, 'Supervisor approval must NEVER invoke archiveClosingToDrive');
    assert.equal(feedback.type, 'success');
    assert.equal(feedback.message, SUPERVISOR_APPROVAL_SUCCESS_AR);
    assert.equal(
      feedback.message,
      'تم اعتماد الإقفال بنجاح. تنتظر أرشفته في Google Drive إجراء مالك المؤسسة.'
    );
  });

  await runTest('12. Manager approval retains Drive archival behavior (success + warning fallback on Drive error)', async () => {
    let driveCalls = 0;
    const okFeedback = await runPostApprovalArchiveWorkflow({
      isManager: true,
      archiveClosing: async () => {
        driveCalls++;
        return { driveExcelFileName: 'closing_2026-11-23.xlsx' };
      },
    });
    assert.equal(driveCalls, 1);
    assert.equal(okFeedback.type, 'success');
    assert.match(okFeedback.message, /closing_2026-11-23\.xlsx/);

    const warnFeedback = await runPostApprovalArchiveWorkflow({
      isManager: true,
      archiveClosing: async () => {
        driveCalls++;
        throw new Error('انتهت جلسة Google Drive');
      },
    });
    assert.equal(driveCalls, 2);
    assert.equal(warnFeedback.type, 'warning');
    assert.equal(warnFeedback.message, 'انتهت جلسة Google Drive');
  });

  await runTest('13. Server read failure (offline / unavailable) fails CLOSED with clear Arabic retry message (never falls back to cache)', async () => {
    await assert.rejects(
      () =>
        fetchSlotClosingsFromServer({
          orgId: ORG_ID,
          branchId: BRANCH_ID,
          date: DATE,
          period: PERIOD,
          serverReader: async () => {
            const err = new Error('Failed to get documents from server because the client is offline.');
            (err as unknown as { code: string }).code = 'unavailable';
            throw err;
          },
        }),
      (err: unknown) =>
        err instanceof ShiftClosingBusinessError &&
        err.code === 'SLOT_SERVER_UNAVAILABLE' &&
        err.message === SLOT_SERVER_UNAVAILABLE_AR
    );
  });

  await runTest('14. Server read permission-denied fails CLOSED and is NEVER converted into permission to write', async () => {
    await assert.rejects(
      () =>
        fetchSlotClosingsFromServer({
          orgId: ORG_ID,
          branchId: BRANCH_ID,
          date: DATE,
          period: PERIOD,
          serverReader: async () => {
            const err = new Error('Missing or insufficient permissions.');
            (err as unknown as { code: string }).code = 'permission-denied';
            throw err;
          },
        }),
      (err: unknown) =>
        err instanceof ShiftClosingBusinessError &&
        err.code === 'SLOT_VERIFICATION_PERMISSION_DENIED' &&
        err.message === SLOT_VERIFICATION_PERMISSION_DENIED_AR
    );
  });

  await runTest('15. Successful server read enforces Single-Closing-Per-Slot rule end-to-end', async () => {
    const serverDocs = await fetchSlotClosingsFromServer({
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      date: DATE,
      period: PERIOD,
      serverReader: async () => [makeClosing({ status: 'rejected', employeeId: ABDULRAQIB_UID })],
    });

    const evalOther = evaluateShiftClosingSlotPolicy({
      slotClosings: serverDocs,
      canonicalClosingId: CANONICAL_ID,
      actorUid: MUHAMMAD_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });
    assert.equal(evalOther.allowed, false);
    if (!evalOther.allowed) {
      assert.equal(evalOther.conflictCode, 'SLOT_REJECTED_OTHER_EMPLOYEE');
    }

    const evalOwner = evaluateShiftClosingSlotPolicy({
      slotClosings: serverDocs,
      canonicalClosingId: CANONICAL_ID,
      actorUid: ABDULRAQIB_UID,
      branchName: BRANCH_NAME,
      date: DATE,
      period: PERIOD,
    });
    assert.equal(evalOwner.allowed, true);
    if (evalOwner.allowed) {
      assert.equal(evalOwner.mode, 'update_own');
      assert.equal(evalOwner.targetClosingId, CANONICAL_ID);
    }
  });

  await runTest('16. Source contract: ClosingsReview guards Drive with isManager & AuthContext/guards use getDocsFromServer/getDocFromServer', () => {
    const reviewSrc = fs.readFileSync('src/components/manager/ClosingsReview.tsx', 'utf8');
    assert.match(reviewSrc, /runPostApprovalArchiveWorkflow\(\{\s*isManager,/);
    assert.match(
      reviewSrc,
      /تم اعتماد الإقفال بنجاح\. تنتظر أرشفته في Google Drive إجراء مالك المؤسسة\./
    );

    const guardsSrc = fs.readFileSync('src/utils/shiftClosingGuards.ts', 'utf8');
    assert.match(guardsSrc, /getDocsFromServer/);
    assert.match(guardsSrc, /getDocFromServer/);
    assert.doesNotMatch(guardsSrc, /\bgetDocs\(/);
    assert.doesNotMatch(guardsSrc, /\bgetDoc\(/);

    const authSrc = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
    assert.match(authSrc, /fetchSlotClosingsFromServer\(/);
  });

  console.log('========================================================================');
  console.log(`UNIT TEST SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal unit test error:', err);
  process.exit(1);
});

