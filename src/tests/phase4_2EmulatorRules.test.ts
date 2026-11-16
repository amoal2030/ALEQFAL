/**
 * Phase 4.2 Security, Pricing, Lifecycle, Deactivation & Verified DB Purge Emulator Suite
 * Tests real `firestore.rules` against an isolated local Firestore Emulator.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const Timestamp = firebase.firestore.Timestamp;

interface TestOutcome {
  name: string;
  passed: boolean;
  error?: string;
}

function parseEmulatorConfig(): { host: string; port: number } {
  const envHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (envHost) {
    const [rawHost, rawPort] = envHost.split(':');
    const parsedPort = Number(rawPort);
    if (rawHost && !Number.isNaN(parsedPort) && parsedPort > 0) {
      return { host: rawHost, port: parsedPort };
    }
  }
  return { host: '127.0.0.1', port: 8080 };
}

async function runPhase42EmulatorTests() {
  console.log('========================================================================');
  console.log('   PHASE 4.2: PRICING, GRACE, DEACTIVATION & PURGE RULES (EMULATOR)     ');
  console.log('========================================================================\n');

  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  const { host, port } = parseEmulatorConfig();

  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'aleqfal-phase42-tests',
    firestore: {
      rules: rulesContent,
      host,
      port,
    },
  });

  await testEnv.clearFirestore();

  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const tsPast35d = Timestamp.fromMillis(nowMs - 35 * oneDayMs);
  const tsPast5d = Timestamp.fromMillis(nowMs - 5 * oneDayMs);
  const tsPast2d = Timestamp.fromMillis(nowMs - 2 * oneDayMs);
  const tsFuture10d = Timestamp.fromMillis(nowMs + 10 * oneDayMs);
  const tsFuture25d = Timestamp.fromMillis(nowMs + 25 * oneDayMs);
  const tsFuture30d = Timestamp.fromMillis(nowMs + 30 * oneDayMs);
  const tsNow = Timestamp.fromMillis(nowMs);
  const validSha256 = 'a'.repeat(64);

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // 1. Active Managed Organization (with active branch + pre-existing suspended branches)
    await db.doc('organizations/org_main').set({
      id: 'org_main',
      name: 'شركة الإقفال الرئيسية',
      taxNumber: '310123456700003',
      commercialRegistration: '1010123456',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_main',
      ownerEmail: 'mgr.main@example.com',
      ownerName: 'مدير المؤسسة',
      driveConnected: true,
      isActive: true,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast35d,
      subscriptionEndAt: tsFuture30d,
      branchPricingModel: 'per_branch_50_sar',
      includedBranchesCount: 0,
      extraBranchMonthlyFeeSar: 50,
      accountSetupFeeSar: 80,
      setupFeeStatus: 'paid',
      reactivationFeeSar: 10,
      createdAt: '2026-10-01T08:00:00Z',
      updatedAt: '2026-10-01T08:00:00Z',
    });

    // 2. Organization deactivated due to 0 paid branches
    await db.doc('organizations/org_deactivated').set({
      id: 'org_deactivated',
      name: 'مؤسسة موقوفة لعدم السداد',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_mgr_deact',
      ownerEmail: 'mgr.deact@example.com',
      ownerName: 'مدير موقوف',
      driveConnected: false,
      isActive: false,
      deactivationReason: 'no_paid_branches',
      noPaidBranchGraceStartedAt: tsPast35d,
      deactivationDueAt: tsPast5d,
      deactivatedAt: tsPast5d,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast35d,
      subscriptionEndAt: tsFuture30d,
      branchPricingModel: 'per_branch_50_sar',
      includedBranchesCount: 0,
      extraBranchMonthlyFeeSar: 50,
      accountSetupFeeSar: 80,
      setupFeeStatus: 'paid',
      reactivationFeeSar: 10,
      reactivationFeeStatus: 'unpaid',
      createdAt: '2026-10-01T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    });

    // 3. Organization whose 7-day grace deadline expired in Firestore time (isActive still true until sync, MUST still fail rules)
    await db.doc('organizations/org_grace_expired').set({
      id: 'org_grace_expired',
      name: 'مؤسسة انتهت مهلة الـ7 أيام',
      activityType: 'services',
      currency: 'SAR',
      ownerId: 'uid_mgr_grace',
      ownerEmail: 'mgr.grace@example.com',
      ownerName: 'مدير انتهت مهلته',
      driveConnected: false,
      isActive: true,
      noPaidBranchGraceStartedAt: tsPast35d,
      deactivationDueAt: tsPast2d,
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: tsPast35d,
      subscriptionEndAt: tsFuture30d,
      branchPricingModel: 'per_branch_50_sar',
      includedBranchesCount: 0,
      extraBranchMonthlyFeeSar: 50,
      createdAt: '2026-10-01T08:00:00Z',
      updatedAt: '2026-10-01T08:00:00Z',
    });

    // 4. Legacy Unrestricted Organization (must remain completely untouched & exempt)
    await db.doc('organizations/org_legacy').set({
      id: 'org_legacy',
      name: 'مؤسسة قديمة معفاة',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'uid_mgr_legacy',
      ownerEmail: 'onlak2030@gmail.com',
      ownerName: 'صالح القديم',
      driveConnected: false,
      createdAt: '2026-01-01T08:00:00Z',
      updatedAt: '2026-01-01T08:00:00Z',
    });

    // Branches
    await db.doc('branches/br_active').set({
      id: 'br_active',
      orgId: 'org_main',
      name: 'الفرع النشط',
      code: 'B-01',
      isActive: true,
      lifecycleStatus: 'active',
      paymentStatus: 'paid',
      monthlyFeeSar: 50,
      feeDueAt: tsFuture30d,
      createdAt: '2026-10-01T08:00:00Z',
    });

    // Suspended inside 30-day grace window
    await db.doc('branches/br_grace_active').set({
      id: 'br_grace_active',
      orgId: 'org_main',
      name: 'فرع معلق داخل المهلة',
      code: 'B-02',
      isActive: false,
      lifecycleStatus: 'suspended',
      paymentStatus: 'overdue',
      monthlyFeeSar: 50,
      suspendedAt: tsPast5d,
      gracePeriodEndsAt: tsFuture25d,
      driveBackupVerified: false,
      createdAt: '2026-10-01T08:00:00Z',
    });

    // Suspended PAST 30-day grace window WITH archived closings (ready for inspection & verify -> DB purge)
    await db.doc('branches/br_purge_ready').set({
      id: 'br_purge_ready',
      orgId: 'org_main',
      name: 'فرع منتهي المهلة جاهز للحذف',
      code: 'B-03',
      isActive: false,
      lifecycleStatus: 'suspended',
      paymentStatus: 'overdue',
      monthlyFeeSar: 50,
      suspendedAt: tsPast35d,
      gracePeriodEndsAt: tsPast5d,
      driveBackupVerified: false,
      createdAt: '2026-09-01T08:00:00Z',
    });

    // Suspended PAST 30-day grace window WITH UNARCHIVED approved closing (must block closing delete)
    await db.doc('branches/br_purge_unarchived').set({
      id: 'br_purge_unarchived',
      orgId: 'org_main',
      name: 'فرع منتهي المهلة غير مؤرشف بالكامل',
      code: 'B-04',
      isActive: false,
      lifecycleStatus: 'suspended',
      paymentStatus: 'overdue',
      monthlyFeeSar: 50,
      suspendedAt: tsPast35d,
      gracePeriodEndsAt: tsPast5d,
      driveBackupVerified: true,
      driveBackupVerifiedAt: tsNow,
      createdAt: '2026-09-01T08:00:00Z',
    });

    await db.doc('branches/br_deact_1').set({
      id: 'br_deact_1',
      orgId: 'org_deactivated',
      name: 'فرع موقوف',
      code: 'D-01',
      isActive: true,
      lifecycleStatus: 'active',
      paymentStatus: 'unpaid',
      createdAt: '2026-10-01T08:00:00Z',
    });

    await db.doc('branches/br_grace_exp_1').set({
      id: 'br_grace_exp_1',
      orgId: 'org_grace_expired',
      name: 'فرع انتهت مهلة مؤسسته',
      code: 'G-01',
      isActive: true,
      lifecycleStatus: 'active',
      paymentStatus: 'unpaid',
      createdAt: '2026-10-01T08:00:00Z',
    });

    await db.doc('branches/br_legacy_1').set({
      id: 'br_legacy_1',
      orgId: 'org_legacy',
      name: 'فرع قديم',
      code: 'L-01',
      isActive: true,
      createdAt: '2026-01-01T08:00:00Z',
    });

    // Users
    await db.doc('users/uid_mgr_main').set({
      uid: 'uid_mgr_main',
      orgId: 'org_main',
      email: 'mgr.main@example.com',
      displayName: 'مدير المؤسسة',
      role: 'manager',
      isActive: true,
      createdAt: '2026-10-01T08:00:00Z',
    });
    await db.doc('users/uid_emp_main').set({
      uid: 'uid_emp_main',
      orgId: 'org_main',
      branchId: 'br_active',
      email: 'emp.main@example.com',
      displayName: 'موظف نشط',
      role: 'employee',
      isActive: true,
      createdAt: '2026-10-01T08:00:00Z',
    });
    await db.doc('users/uid_mgr_deact').set({
      uid: 'uid_mgr_deact',
      orgId: 'org_deactivated',
      email: 'mgr.deact@example.com',
      displayName: 'مدير موقوف',
      role: 'manager',
      isActive: true,
      createdAt: '2026-10-01T08:00:00Z',
    });
    await db.doc('users/uid_emp_deact').set({
      uid: 'uid_emp_deact',
      orgId: 'org_deactivated',
      branchId: 'br_deact_1',
      email: 'emp.deact@example.com',
      displayName: 'موظف موقوف',
      role: 'employee',
      isActive: true,
      createdAt: '2026-10-01T08:00:00Z',
    });
    await db.doc('users/uid_mgr_grace').set({
      uid: 'uid_mgr_grace',
      orgId: 'org_grace_expired',
      email: 'mgr.grace@example.com',
      displayName: 'مدير انتهت مهلته',
      role: 'manager',
      isActive: true,
      createdAt: '2026-10-01T08:00:00Z',
    });
    await db.doc('users/uid_mgr_legacy').set({
      uid: 'uid_mgr_legacy',
      orgId: 'org_legacy',
      email: 'onlak2030@gmail.com',
      displayName: 'صالح القديم',
      role: 'manager',
      isActive: true,
      createdAt: '2026-01-01T08:00:00Z',
    });

    // Suppliers, Closings, Archives, Purchases, Attachments, AuditLogs
    await db.doc('suppliers/sup_main').set({
      id: 'sup_main',
      orgId: 'org_main',
      name: 'مورد رئيسي',
      isActive: true,
      createdBy: 'uid_mgr_main',
      createdAt: '2026-10-01T08:00:00Z',
      updatedAt: '2026-10-01T08:00:00Z',
    });

    // Active branch closing (SA must be blocked)
    await db.doc('closings/cls_active').set({
      id: 'cls_active',
      orgId: 'org_main',
      branchId: 'br_active',
      employeeId: 'uid_emp_main',
      date: '2026-11-12',
      period: 'morning',
      cashSales: 100,
      cardSales: 100,
      totalSales: 200,
      expenses: 0,
      remainingInBox: 100,
      netPeriod: 200,
      status: 'approved',
      createdAt: '2026-11-12T10:00:00Z',
      updatedAt: '2026-11-12T10:00:00Z',
    });

    // Suspended inside-30d grace closing (SA must be blocked)
    await db.doc('closings/cls_grace_active').set({
      id: 'cls_grace_active',
      orgId: 'org_main',
      branchId: 'br_grace_active',
      employeeId: 'uid_emp_main',
      date: '2026-11-08',
      period: 'morning',
      cashSales: 300,
      cardSales: 200,
      totalSales: 500,
      expenses: 50,
      remainingInBox: 250,
      netPeriod: 450,
      status: 'approved',
      createdAt: '2026-11-08T10:00:00Z',
      updatedAt: '2026-11-08T10:00:00Z',
    });

    // Purge-ready branch records (approved+archived closing + rejected unarchived closing + purchase + attachment + auditLog)
    await db.doc('closings/cls_purge_approved').set({
      id: 'cls_purge_approved',
      orgId: 'org_main',
      branchId: 'br_purge_ready',
      employeeId: 'uid_emp_main',
      date: '2026-09-15',
      period: 'morning',
      cashSales: 1000,
      cardSales: 500,
      totalSales: 1500,
      expenses: 100,
      remainingInBox: 900,
      netPeriod: 1400,
      status: 'approved',
      createdAt: '2026-09-15T10:00:00Z',
      updatedAt: '2026-09-15T10:00:00Z',
    });
    await db.doc('closingArchives/cls_purge_approved').set({
      closingId: 'cls_purge_approved',
      orgId: 'org_main',
      branchId: 'br_purge_ready',
      yearMonth: '2026-09',
      archiveStatus: 'archived',
      driveExcelFileId: 'drive_file_001',
      driveExcelFileName: 'closing_001.xlsx',
      driveExcelWebViewLink: 'https://drive.google.com/file/d/drive_file_001/view',
      driveMonthFolderId: 'drive_folder_001',
      drivePayloadHash: validSha256,
      driveRevision: 1,
      archivedAt: '2026-09-15T12:00:00Z',
      archivedBy: 'uid_mgr_main',
      updatedAt: '2026-09-15T12:00:00Z',
    });
    await db.doc('closings/cls_purge_rejected').set({
      id: 'cls_purge_rejected',
      orgId: 'org_main',
      branchId: 'br_purge_ready',
      employeeId: 'uid_emp_main',
      date: '2026-09-16',
      period: 'evening',
      cashSales: 100,
      cardSales: 0,
      totalSales: 100,
      expenses: 0,
      remainingInBox: 100,
      netPeriod: 100,
      status: 'rejected',
      createdAt: '2026-09-16T10:00:00Z',
      updatedAt: '2026-09-16T10:00:00Z',
    });
    await db.doc('purchases/pur_purge_ready').set({
      id: 'pur_purge_ready',
      orgId: 'org_main',
      branchId: 'br_purge_ready',
      supplierId: 'sup_main',
      date: '2026-09-15',
      amount: 200,
      totalAmount: 200,
      paymentMethod: 'cash',
      createdBy: 'uid_mgr_main',
      createdByRole: 'manager',
      createdAt: '2026-09-15T11:00:00Z',
      updatedAt: '2026-09-15T11:00:00Z',
    });
    await db.doc('attachments/att_purge_ready').set({
      id: 'att_purge_ready',
      orgId: 'org_main',
      branchId: 'br_purge_ready',
      uploadedBy: 'uid_emp_main',
      closingId: 'cls_purge_approved',
      fileName: 'receipt.jpg',
      createdAt: '2026-09-15T10:00:00Z',
    });
    await db.doc('auditLogs/log_purge_immutable').set({
      id: 'log_purge_immutable',
      orgId: 'org_main',
      actorId: 'uid_mgr_main',
      actorName: 'مدير المؤسسة',
      actorRole: 'manager',
      action: 'CLOSING_APPROVED',
      targetType: 'closing',
      targetId: 'cls_purge_approved',
      details: 'سجل تدقيق يجب ألا يُحذف أبداً',
      timestamp: '2026-09-15T12:00:00Z',
    });

    // Approved closing on unarchived branch (archiveStatus is failed, NOT archived)
    await db.doc('closings/cls_unarchived_approved').set({
      id: 'cls_unarchived_approved',
      orgId: 'org_main',
      branchId: 'br_purge_unarchived',
      employeeId: 'uid_emp_main',
      date: '2026-09-18',
      period: 'morning',
      cashSales: 400,
      cardSales: 0,
      totalSales: 400,
      expenses: 0,
      remainingInBox: 400,
      netPeriod: 400,
      status: 'approved',
      createdAt: '2026-09-18T10:00:00Z',
      updatedAt: '2026-09-18T10:00:00Z',
    });
    await db.doc('closingArchives/cls_unarchived_approved').set({
      closingId: 'cls_unarchived_approved',
      orgId: 'org_main',
      branchId: 'br_purge_unarchived',
      yearMonth: '2026-09',
      archiveStatus: 'failed',
      archiveError: 'Drive quota exceeded',
      updatedAt: '2026-09-18T12:00:00Z',
    });

    // Legacy closing
    await db.doc('closings/cls_legacy_1').set({
      id: 'cls_legacy_1',
      orgId: 'org_legacy',
      branchId: 'br_legacy_1',
      employeeId: 'uid_mgr_legacy',
      date: '2026-11-15',
      period: 'morning',
      cashSales: 500,
      cardSales: 250,
      totalSales: 750,
      expenses: 50,
      remainingInBox: 450,
      netPeriod: 700,
      status: 'pending_review',
      createdAt: '2026-11-15T09:00:00Z',
      updatedAt: '2026-11-15T09:00:00Z',
    });
  });

  const saDb = testEnv
    .authenticatedContext('uid_sa', { email: 'amoal2030@gmail.com', email_verified: true })
    .firestore();
  const saUnverifiedDb = testEnv
    .authenticatedContext('uid_sa_unverified', { email: 'amoal2030@gmail.com', email_verified: false })
    .firestore();
  const onlakDb = testEnv
    .authenticatedContext('uid_mgr_legacy', { email: 'onlak2030@gmail.com', email_verified: true })
    .firestore();
  const mgrMainDb = testEnv
    .authenticatedContext('uid_mgr_main', { email: 'mgr.main@example.com', email_verified: true })
    .firestore();
  const empMainDb = testEnv
    .authenticatedContext('uid_emp_main', { email: 'emp.main@example.com', email_verified: true })
    .firestore();
  const mgrDeactDb = testEnv
    .authenticatedContext('uid_mgr_deact', { email: 'mgr.deact@example.com', email_verified: true })
    .firestore();
  const empDeactDb = testEnv
    .authenticatedContext('uid_emp_deact', { email: 'emp.deact@example.com', email_verified: true })
    .firestore();
  const mgrGraceDb = testEnv
    .authenticatedContext('uid_mgr_grace', { email: 'mgr.grace@example.com', email_verified: true })
    .firestore();

  const outcomes: TestOutcome[] = [];
  async function runCase(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      outcomes.push({ name, passed: true });
      console.log(`PASS: ${name}`);
    } catch (err: any) {
      outcomes.push({ name, passed: false, error: err?.message || String(err) });
      console.error(`FAIL: ${name} -> ${err?.message || err}`);
    }
  }

  try {
    await runCase('1. Exclusive SA creates Org (80 SAR setup + tax/CR) + first Branch (50 SAR) + Invite + PlatformAuditLog atomically', async () => {
      const batch = saDb.batch();
      batch.set(saDb.doc('organizations/org_new_42'), {
        id: 'org_new_42',
        name: 'مؤسسة البناء الجديد',
        taxNumber: '310999888700003',
        commercialRegistration: '1010998877',
        activityType: 'retail',
        currency: 'SAR',
        ownerId: '',
        ownerEmail: 'new.owner@example.com',
        ownerName: 'أحمد المالك',
        driveConnected: false,
        isActive: true,
        subscriptionPlan: '1m',
        subscriptionStatus: 'active',
        subscriptionStartAt: tsPast2d,
        subscriptionEndAt: tsFuture30d,
        branchPricingModel: 'per_branch_50_sar',
        includedBranchesCount: 0,
        extraBranchMonthlyFeeSar: 50,
        accountSetupFeeSar: 80,
        setupFeeStatus: 'paid',
        reactivationFeeSar: 10,
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      });
      batch.set(saDb.doc('branches/br_new_42'), {
        id: 'br_new_42',
        orgId: 'org_new_42',
        name: 'الفرع الرئيسي الجديد',
        code: 'N-01',
        isActive: true,
        lifecycleStatus: 'active',
        paymentStatus: 'paid',
        monthlyFeeSar: 50,
        feeDueAt: tsFuture30d,
        createdAt: '2026-11-15T10:00:00Z',
      });
      batch.set(saDb.doc('managerInvites/new.owner@example.com'), {
        id: 'new.owner@example.com',
        email: 'new.owner@example.com',
        emailNormalized: 'new.owner@example.com',
        orgId: 'org_new_42',
        orgName: 'مؤسسة البناء الجديد',
        managerName: 'أحمد المالك',
        role: 'manager',
        status: 'pending',
        createdAt: '2026-11-15T10:00:00Z',
        createdBy: 'amoal2030@gmail.com',
        updatedAt: '2026-11-15T10:00:00Z',
      });
      batch.set(saDb.doc('platformAuditLogs/pal_create_org_42'), {
        id: 'pal_create_org_42',
        actorEmail: 'amoal2030@gmail.com',
        actorUid: 'uid_sa',
        action: 'ORG_CREATED',
        targetType: 'organization',
        targetId: 'org_new_42',
        orgId: 'org_new_42',
        details: 'إنشاء مؤسسة جديدة مع أول فرع ودعوة المدير',
        timestamp: '2026-11-15T10:00:00Z',
      });
      await assertSucceeds(batch.commit());

      // Non-SA, unverified SA, and onlak2030 MUST fail org/invite/branch/platformAuditLog creation
      await assertFails(
        onlakDb.doc('organizations/org_forged').set({
          id: 'org_forged',
          name: 'مؤسسة مزورة',
          activityType: 'retail',
          currency: 'SAR',
          ownerEmail: 'x@example.com',
          ownerName: 'محتال',
          driveConnected: false,
          createdAt: '2026-11-15T10:00:00Z',
          updatedAt: '2026-11-15T10:00:00Z',
        })
      );
      await assertFails(
        saUnverifiedDb.doc('organizations/org_unverified').set({
          id: 'org_unverified',
          name: 'غير موثق',
          activityType: 'retail',
          currency: 'SAR',
          ownerEmail: 'x@example.com',
          ownerName: 'محتال',
          driveConnected: false,
          createdAt: '2026-11-15T10:00:00Z',
          updatedAt: '2026-11-15T10:00:00Z',
        })
      );
      await assertFails(mgrMainDb.doc('branches/br_mgr_spoof').set({
        id: 'br_mgr_spoof',
        orgId: 'org_main',
        name: 'فرع غير مصرح',
        isActive: true,
      }));
    });

    await runCase('2. SA updates org tax/CR/name/fees; org manager is strictly blocked from profile/fee mutations while keeping Drive sync', async () => {
      await assertSucceeds(
        saDb.doc('organizations/org_main').update({
          name: 'شركة الإقفال المعدلة',
          taxNumber: '310777666500003',
          commercialRegistration: '1010554433',
          accountSetupFeeSar: 80,
          setupFeeStatus: 'paid',
          updatedAt: '2026-11-15T11:00:00Z',
        })
      );

      // Manager cannot change fees, status, taxNumber, commercialRegistration, or name
      await assertFails(mgrMainDb.doc('organizations/org_main').update({ accountSetupFeeSar: 0 }));
      await assertFails(mgrMainDb.doc('organizations/org_main').update({ setupFeeStatus: 'waived' }));
      await assertFails(mgrMainDb.doc('organizations/org_main').update({ reactivationFeeStatus: 'waived' }));
      await assertFails(mgrMainDb.doc('organizations/org_main').update({ taxNumber: '399999999900003' }));
      await assertFails(mgrMainDb.doc('organizations/org_main').update({ commercialRegistration: '9999999999' }));
      await assertFails(mgrMainDb.doc('organizations/org_main').update({ name: 'اسم غير مصرح' }));

      // Manager retains Drive folder link sync on active org & active branch
      await assertSucceeds(
        mgrMainDb.doc('organizations/org_main').update({
          driveFolderId: 'fld_org_1',
          driveFolderName: 'AL_EQFAL',
          updatedAt: '2026-11-15T11:05:00Z',
        })
      );
      await assertSucceeds(
        mgrMainDb.doc('branches/br_active').update({
          driveFolderId: 'fld_br_1',
          driveFolderName: 'الفرع_النشط',
          driveFolderLink: 'https://drive.google.com/drive/folders/fld_br_1',
        })
      );
    });

    await runCase('3. Branch Lifecycle exclusive to SA: 30-day grace enforced on suspension, org manager blocked', async () => {
      // SA suspending with < 30 days grace MUST fail
      await assertFails(
        saDb.doc('branches/br_active').update({
          isActive: false,
          lifecycleStatus: 'suspended',
          suspendedAt: tsNow,
          gracePeriodEndsAt: tsFuture10d,
          driveBackupVerified: false,
        })
      );
      // SA cannot mark driveBackupVerified=true prematurely on an active/inside-grace branch
      await assertFails(
        saDb.doc('branches/br_grace_active').update({
          driveBackupVerified: true,
          driveBackupVerifiedAt: tsNow,
        })
      );
      // Org manager CANNOT suspend, rename, record payment, or update Drive on a suspended branch
      await assertFails(mgrMainDb.doc('branches/br_active').update({ name: 'تعديل مرفوض' }));
      await assertFails(mgrMainDb.doc('branches/br_active').update({ paymentStatus: 'exempt' }));
      await assertFails(
        mgrMainDb.doc('branches/br_grace_active').update({
          driveFolderId: 'fld_blocked',
        })
      );

      // SA can legitimately record 50 SAR payment on active branch
      await assertSucceeds(
        saDb.doc('branches/br_active').update({
          paymentStatus: 'paid',
          monthlyFeeSar: 50,
          feeDueAt: tsFuture30d,
          lastPaidAt: tsNow,
          lastPaidBy: 'amoal2030@gmail.com',
        })
      );
    });

    await runCase('4. Org deactivation & 7-day expiry block ALL org ops; 10 SAR reactivation fee enforced on SA reactivation', async () => {
      // Deactivated org blocks both manager & employee
      await assertFails(mgrDeactDb.collection('closings').where('orgId', '==', 'org_deactivated').get());
      await assertFails(empDeactDb.collection('branches').where('orgId', '==', 'org_deactivated').get());
      await assertFails(mgrDeactDb.collection('suppliers').where('orgId', '==', 'org_deactivated').get());

      // Expired 7-day grace deadline (`deactivationDueAt < request.time`) ALSO blocks operations even if isActive was still true
      await assertFails(mgrGraceDb.collection('closings').where('orgId', '==', 'org_grace_expired').get());
      await assertFails(mgrGraceDb.collection('branches').where('orgId', '==', 'org_grace_expired').get());

      // SA reactivating org_deactivated WITHOUT paying/waiving 10 SAR fee MUST fail
      await assertFails(
        saDb.doc('organizations/org_deactivated').update({
          isActive: true,
          reactivationFeeStatus: 'unpaid',
          deactivationReason: null,
          deactivationDueAt: null,
        })
      );
      // SA reactivating without clearing deactivationReason MUST fail
      await assertFails(
        saDb.doc('organizations/org_deactivated').update({
          isActive: true,
          reactivationFeeStatus: 'paid',
        })
      );

      // SA reactivating WITH 10 SAR fee paid + clearing deactivation fields SUCCEEDS and unlocks org!
      await assertSucceeds(
        saDb.doc('organizations/org_deactivated').update({
          isActive: true,
          reactivationFeeSar: 10,
          reactivationFeeStatus: 'paid',
          reactivationFeePaidAt: tsNow,
          reactivatedAt: tsNow,
          reactivatedBy: 'amoal2030@gmail.com',
          deactivationReason: null,
          deactivationDueAt: null,
          noPaidBranchGraceStartedAt: null,
          updatedAt: '2026-11-15T12:00:00Z',
        })
      );
      await assertSucceeds(mgrDeactDb.collection('branches').where('orgId', '==', 'org_deactivated').get());
    });

    await runCase('5. Two-stage Suspended Branch Purge: blocked on active/in-grace; Drive verification + archived proof required before DB delete; auditLogs immutable', async () => {
      // SA CANNOT inspect or delete closings on active branch OR inside-30d-grace branch
      await assertFails(saDb.collection('closings').where('branchId', '==', 'br_active').get());
      await assertFails(saDb.collection('closings').where('branchId', '==', 'br_grace_active').get());
      await assertFails(saDb.doc('closings/cls_grace_active').get());
      await assertFails(saDb.doc('branches/br_grace_active').delete());
      await assertFails(saDb.doc('closings/cls_grace_active').delete());

      // Stage A: Branch PAST 30-day grace -> SA CAN inspect closings, archives, purchases, attachments
      const inspectedClosings = await assertSucceeds(
        saDb.collection('closings').where('branchId', '==', 'br_purge_ready').get()
      );
      assert.equal(inspectedClosings.size, 2);
      const inspectedArchives = await assertSucceeds(
        saDb.collection('closingArchives').where('branchId', '==', 'br_purge_ready').get()
      );
      assert.equal(inspectedArchives.size, 1);
      await assertSucceeds(saDb.collection('purchases').where('branchId', '==', 'br_purge_ready').get());
      await assertSucceeds(saDb.collection('attachments').where('branchId', '==', 'br_purge_ready').get());

      // Before driveBackupVerified=true, SA STILL CANNOT delete branch or its data
      await assertFails(saDb.doc('branches/br_purge_ready').delete());
      await assertFails(saDb.doc('closings/cls_purge_approved').delete());
      await assertFails(saDb.doc('purchases/pur_purge_ready').delete());
      await assertFails(saDb.doc('attachments/att_purge_ready').delete());

      // Even when verified=true on br_purge_unarchived, approved closing WITHOUT archiveStatus=='archived' MUST block delete!
      await assertFails(saDb.doc('closings/cls_unarchived_approved').delete());
      await assertFails(saDb.doc('closingArchives/cls_unarchived_approved').delete());

      // Record Drive backup verification on expired suspended branch -> SUCCEEDS
      await assertSucceeds(
        saDb.doc('branches/br_purge_ready').update({
          driveBackupVerified: true,
          driveBackupVerifiedAt: tsNow,
          driveBackupVerifiedBy: 'amoal2030@gmail.com',
          driveBackupArchivedClosingsCount: 1,
        })
      );

      // Stage B: SA batch deletes closings, archives, purchases, attachments, and branch from website DB
      const purgeBatch = saDb.batch();
      purgeBatch.delete(saDb.doc('closings/cls_purge_approved'));
      purgeBatch.delete(saDb.doc('closings/cls_purge_rejected'));
      purgeBatch.delete(saDb.doc('closingArchives/cls_purge_approved'));
      purgeBatch.delete(saDb.doc('purchases/pur_purge_ready'));
      purgeBatch.delete(saDb.doc('attachments/att_purge_ready'));
      purgeBatch.delete(saDb.doc('branches/br_purge_ready'));
      await assertSucceeds(purgeBatch.commit());

      // auditLogs remains strictly immutable even for Super Admin
      await assertFails(saDb.doc('auditLogs/log_purge_immutable').delete());
    });

    await runCase('6. PlatformAuditLogs allow SA create/read only, block non-SA, and enforce strict immutability', async () => {
      await assertSucceeds(
        saDb.doc('platformAuditLogs/pal_verify_01').set({
          id: 'pal_verify_01',
          actorEmail: 'amoal2030@gmail.com',
          actorUid: 'uid_sa',
          action: 'BRANCH_BACKUP_VERIFIED',
          targetType: 'branch',
          targetId: 'br_purge_ready',
          orgId: 'org_main',
          details: 'تم التحقق من اكتمال النسخ الاحتياطي',
          timestamp: '2026-11-15T12:30:00Z',
        })
      );
      await assertSucceeds(saDb.collection('platformAuditLogs').get());

      // Everyone blocked from updating or deleting platformAuditLogs
      await assertFails(saDb.doc('platformAuditLogs/pal_verify_01').update({ details: 'تعديل مرفوض' }));
      await assertFails(saDb.doc('platformAuditLogs/pal_verify_01').delete());

      // Non-SA blocked from reading/creating platformAuditLogs
      await assertFails(mgrMainDb.collection('platformAuditLogs').get());
      await assertFails(onlakDb.collection('platformAuditLogs').get());
      await assertFails(saUnverifiedDb.collection('platformAuditLogs').get());
      await assertFails(
        mgrMainDb.doc('platformAuditLogs/pal_spoof').set({
          id: 'pal_spoof',
          actorEmail: 'mgr.main@example.com',
          actorUid: 'uid_mgr_main',
          action: 'ORG_CREATED',
          targetType: 'organization',
          targetId: 'org_main',
          details: 'تزوير سجل منصة',
          timestamp: '2026-11-15T12:31:00Z',
        })
      );
    });

    await runCase('7. Legacy unrestricted organization (onlak2030) retains normal operational access untouched', async () => {
      await assertSucceeds(onlakDb.collection('branches').where('orgId', '==', 'org_legacy').get());
      await assertSucceeds(onlakDb.collection('closings').where('orgId', '==', 'org_legacy').get());
      await assertSucceeds(
        onlakDb.doc('closings/cls_legacy_1').update({
          status: 'approved',
          reviewedBy: 'uid_mgr_legacy',
          reviewedByName: 'صالح القديم',
          reviewedAt: '2026-11-15T12:40:00Z',
          updatedAt: '2026-11-15T12:40:00Z',
        })
      );
    });

    const failed = outcomes.filter((o) => !o.passed);
    console.log(`\nSummary: ${outcomes.length - failed.length}/${outcomes.length} Phase 4.2 emulator tests passed.`);
    if (failed.length > 0) {
      process.exit(1);
    }
  } finally {
    await testEnv.cleanup();
  }
}

runPhase42EmulatorTests().catch((err) => {
  console.error('PHASE 4.2 EMULATOR TEST FATAL ERROR:', err);
  process.exit(1);
});
