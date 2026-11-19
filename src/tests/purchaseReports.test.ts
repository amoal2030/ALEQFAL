/**
 * Purchase Reports Test Suite — AL EQFAL
 * Verifies:
 * 1. Role separation in Dashboard & defense-in-depth manager-only guards
 * 2. Integer-Halala totals, branch breakdown, and supplier breakdown accuracy
 * 3. Date presets, custom ranges, branch/supplier filters, and multi-field search
 * 4. Multi-sheet RTL Arabic Excel (.xlsx) export read-back parity via ExcelJS
 * 5. PDF model parity & spec-compliant PDF 1.4 binary encoder
 * 6. Zero regression in Supervisor / Branch Manager purchase entry & legacy invoices
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  buildPdfFromJpegPages,
  buildPurchaseReportPdfModel,
  computePurchaseReport,
  DEFAULT_PURCHASE_REPORT_FILTERS,
  fetchOrganizationPurchasesForReport,
  fetchOrganizationSuppliersForReport,
  generatePurchaseReportExcel,
  resolveDatePresetBounds,
} from '../services/purchaseReportService';
import { preparePurchaseSubmission } from '../services/purchaseService';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import type {
  Branch,
  Organization,
  Purchase,
  PurchaseLineItem,
  Supplier,
  UserProfile,
} from '../types';

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err instanceof Error ? err.message : err);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const orgA: Organization = {
  id: 'org_a',
  name: 'مؤسسة الإقفال التجارية',
  activityType: 'تجزئة ومقاهي',
  currency: 'SAR',
  ownerId: 'uid_mgr_a',
  ownerEmail: 'mgr@eqfal.sa',
  ownerName: 'مدير المؤسسة',
  driveConnected: false,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const brMain: Branch = {
  id: 'br_main',
  orgId: 'org_a',
  name: 'الفرع الرئيسي',
  code: 'HQ-01',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const brNorth: Branch = {
  id: 'br_north',
  orgId: 'org_a',
  name: 'فرع الشمال',
  code: 'N-02',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const supActive1: Supplier = {
  id: 'sup_1',
  orgId: 'org_a',
  name: 'شركة الرواد للأغذية',
  taxNumber: '310100200300003',
  phone: '0551112233',
  isActive: true,
  createdBy: 'uid_mgr_a',
  createdAt: '2026-01-05T08:00:00.000Z',
  updatedAt: '2026-01-05T08:00:00.000Z',
};

const supActive2: Supplier = {
  id: 'sup_2',
  orgId: 'org_a',
  name: 'مؤسسة النخبة للتغليف',
  taxNumber: '310999888700003',
  phone: '0504445566',
  isActive: true,
  createdBy: 'uid_mgr_a',
  createdAt: '2026-01-10T08:00:00.000Z',
  updatedAt: '2026-01-10T08:00:00.000Z',
};

const supInactiveLegacy: Supplier = {
  id: 'sup_old',
  orgId: 'org_a',
  name: 'مورد تاريخي موقوف',
  taxNumber: '300000111200003',
  phone: '0540000000',
  isActive: false,
  createdBy: 'uid_mgr_a',
  createdAt: '2025-06-01T08:00:00.000Z',
  updatedAt: '2026-02-01T08:00:00.000Z',
};

const managerOrgA: UserProfile = {
  uid: 'uid_mgr_a',
  orgId: 'org_a',
  email: 'mgr@eqfal.sa',
  displayName: 'مدير المؤسسة',
  role: 'manager',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('manager'),
  createdAt: '2026-01-01T00:00:00.000Z',
};

const supervisorOrgA: UserProfile = {
  uid: 'uid_sup_a',
  orgId: 'org_a',
  email: 'sup@eqfal.sa',
  displayName: 'مسؤول المشتريات',
  role: 'supervisor',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('supervisor', {
    canManagePurchases: true,
    canManageSuppliers: true,
  }),
  createdAt: '2026-01-02T00:00:00.000Z',
};

const branchManagerNorth: UserProfile = {
  uid: 'uid_bm_north',
  orgId: 'org_a',
  branchId: 'br_north',
  email: 'bm.north@eqfal.sa',
  displayName: 'مسؤول فرع الشمال',
  role: 'branch_manager',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('branch_manager', {
    canManagePurchases: true,
  }),
  createdAt: '2026-01-03T00:00:00.000Z',
};

const employeeMain: UserProfile = {
  uid: 'uid_emp_main',
  orgId: 'org_a',
  branchId: 'br_main',
  email: 'emp@eqfal.sa',
  displayName: 'موظف عادي',
  role: 'employee',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('employee'),
  createdAt: '2026-01-04T00:00:00.000Z',
};

// Reference date: 2026-11-18
const REF_DATE = new Date(2026, 10, 18, 12, 0, 0);

// 4 realistic purchases covering:
// - Step 3 subcollection invoice (today)
// - Legacy inline-items invoice (within 7 days, fractional Halalas)
// - Current-month invoice (0% VAT, deactivated historical supplier)
// - Earlier-year legacy non-itemized invoice (no items array, uses `amount`)
const purchasesFixture: Purchase[] = [
  {
    id: 'pur_001',
    orgId: 'org_a',
    branchId: 'br_main',
    branchName: 'الفرع الرئيسي',
    supplierId: 'sup_1',
    supplierName: 'شركة الرواد للأغذية',
    taxNumber: '310100200300003',
    invoiceNumber: 'INV-2026-101',
    date: '2026-11-18',
    paymentMethod: 'transfer',
    amount: 1000,
    subtotalAmount: 1000,
    discountAmount: 50,
    vatRate: 15,
    vatAmount: 142.5,
    totalAmount: 1092.5,
    items: [], // Stored in Step 3 subcollection
    attachmentIds: ['att_1', 'att_2'],
    notes: 'توريد أسبوعي طازج',
    createdBy: 'uid_sup_a',
    createdByRole: 'supervisor',
    createdByName: 'مسؤول المشتريات',
    createdAt: '2026-11-18T09:15:00.000Z',
    updatedAt: '2026-11-18T09:15:00.000Z',
  },
  {
    id: 'pur_002',
    orgId: 'org_a',
    branchId: 'br_north',
    branchName: 'فرع الشمال',
    supplierId: 'sup_2',
    supplierName: 'مؤسسة النخبة للتغليف',
    taxNumber: '310999888700003',
    invoiceNumber: 'INV-2026-098',
    date: '2026-11-14',
    paymentMethod: 'cash',
    amount: 210.5,
    subtotalAmount: 210.5,
    discountAmount: 10.5,
    vatRate: 15,
    vatAmount: 30,
    totalAmount: 230,
    items: [
      { id: 'ln_1', name: 'أكواب ورقية 12 أونصة', quantity: 10, unitPrice: 15.05, total: 150.5 },
      { id: 'ln_2', name: 'أكياس تغليف كرافت', quantity: 6, unitPrice: 10, total: 60 },
    ],
    attachmentIds: ['att_3'],
    notes: 'مستلزمات تغليف فرع الشمال',
    createdBy: 'uid_bm_north',
    createdByRole: 'branch_manager',
    createdByName: 'مسؤول فرع الشمال',
    createdAt: '2026-11-14T14:20:00.000Z',
    updatedAt: '2026-11-14T14:20:00.000Z',
  },
  {
    id: 'pur_003',
    orgId: 'org_a',
    branchId: 'br_main',
    branchName: 'الفرع الرئيسي',
    supplierId: 'sup_old',
    supplierName: 'مورد تاريخي موقوف',
    taxNumber: '300000111200003',
    invoiceNumber: 'INV-2026-075',
    date: '2026-11-03',
    paymentMethod: 'credit',
    amount: 450.75,
    subtotalAmount: 450.75,
    discountAmount: 0,
    vatRate: 0,
    vatAmount: 0,
    totalAmount: 450.75,
    items: [
      { id: 'ln_old_1', name: 'مستلزمات صيانة عامة', quantity: 3, unitPrice: 150.25, total: 450.75 },
    ],
    notes: 'فاتورة معفاة من الضريبة',
    createdBy: 'uid_sup_a',
    createdByRole: 'supervisor',
    createdByName: 'مسؤول المشتريات',
    createdAt: '2026-11-03T11:00:00.000Z',
    updatedAt: '2026-11-03T11:00:00.000Z',
  },
  {
    id: 'pur_004_legacy',
    orgId: 'org_a',
    branchId: 'br_north',
    supplierId: 'sup_1',
    supplierName: 'شركة الرواد للأغذية',
    invoiceNumber: 'LEG-2026-011',
    date: '2026-04-20',
    paymentMethod: 'card',
    amount: 300.25,
    // Legacy invoice without subtotalAmount / discountAmount / vatAmount / items
    createdBy: 'uid_sup_a',
    createdAt: '2026-04-20T10:00:00.000Z',
  } as unknown as Purchase,
];

const subcollectionItemsByPurchaseId: Record<string, PurchaseLineItem[]> = {
  pur_001: [
    { id: 'sub_1', name: 'بن عربي محمص فاخر', quantity: 20, unitPrice: 35, total: 700 },
    { id: 'sub_2', name: 'حليب طازج كامل الدسم', quantity: 30, unitPrice: 10, total: 300 },
  ],
};

// ---------------------------------------------------------------------------
// Execute Test Suite
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== Purchase Reports Suite (AL EQFAL) ===\n');

  // 1. Role Separation & Security Guards
  await runTest('1.1 Dashboard routes Manager to PurchaseReportsView (تقارير المشتريات) and NOT PurchaseEntryView', () => {
    const dashboardPath = path.resolve(process.cwd(), 'src/components/Dashboard.tsx');
    const src = fs.readFileSync(dashboardPath, 'utf8');

    // Manager tab state uses purchase_reports instead of purchases
    assert.ok(
      src.includes("'purchase_reports'"),
      'Dashboard must define purchase_reports tab for manager'
    );
    // Unified «تقارير المشتريات» label across Desktop tab, Mobile option, and Page heading
    assert.ok(
      src.includes('<option value="purchase_reports">🧾 تقارير المشتريات</option>'),
      'Mobile manager selector must display «🧾 تقارير المشتريات»'
    );
    assert.ok(
      src.includes('<span>تقارير المشتريات</span>'),
      'Desktop manager tab must display «تقارير المشتريات»'
    );
    assert.ok(
      src.includes("managerTab === 'purchase_reports'") &&
        src.includes('<PurchaseReportsView'),
      'Dashboard must render <PurchaseReportsView> on manager purchase_reports tab'
    );
    assert.ok(
      src.includes('resolveTenantNotificationRoute'),
      'Dashboard must resolve notification navigation via role/permission-based resolveTenantNotificationRoute'
    );
    // Manager must NOT render PurchaseEntryView
    assert.ok(
      !src.includes("managerTab === 'purchases'"),
      'Manager dashboard must NOT have managerTab === purchases'
    );

    // Staff roles (supervisor & branch_manager) MUST still keep PurchaseEntryView
    assert.ok(
      src.includes("staffTab === 'purchases' && canStaffManagePurchases") &&
        src.includes('<PurchaseEntryView'),
      'Supervisor & Branch Manager must still render <PurchaseEntryView>'
    );
    assert.ok(
      src.includes('إدخال المشتريات'),
      'Staff navigation must still include «إدخال المشتريات»'
    );

    // Manager retains SuppliersManager
    assert.ok(
      src.includes("managerTab === 'suppliers' && <SuppliersManager />"),
      'Manager must retain SuppliersManager'
    );

    // Verify page heading inside PurchaseReportsView matches exact «تقارير المشتريات»
    const viewPath = path.resolve(process.cwd(), 'src/components/manager/PurchaseReportsView.tsx');
    const viewSrc = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      /<h2>[\s\S]*?تقارير المشتريات[\s\S]*?<\/h2>|<h2[^>]*>\s*تقارير المشتريات\s*<\/h2>/.test(viewSrc),
      'PurchaseReportsView page heading must be exact «تقارير المشتريات»'
    );
  });

  await runTest('1.2 PurchaseReportsView & service enforce Manager-only & Org-scoped guards', async () => {
    const viewPath = path.resolve(process.cwd(), 'src/components/manager/PurchaseReportsView.tsx');
    const viewSrc = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      viewSrc.includes("userProfile?.role === 'manager' && userProfile?.isActive === true"),
      'PurchaseReportsView must enforce active manager-only defense-in-depth guard'
    );

    // Non-managers rejected BEFORE hitting Firestore
    await assert.rejects(
      () => fetchOrganizationPurchasesForReport(supervisorOrgA, 'org_a'),
      /مدير المؤسسة فقط/
    );
    await assert.rejects(
      () => fetchOrganizationPurchasesForReport(branchManagerNorth, 'org_a'),
      /مدير المؤسسة فقط/
    );
    await assert.rejects(
      () => fetchOrganizationPurchasesForReport(employeeMain, 'org_a'),
      /مدير المؤسسة فقط/
    );
    await assert.rejects(
      () => fetchOrganizationSuppliersForReport(supervisorOrgA, 'org_a'),
      /مدير المؤسسة فقط/
    );

    // Inactive manager rejected
    await assert.rejects(
      () => fetchOrganizationPurchasesForReport({ ...managerOrgA, isActive: false }, 'org_a'),
      /غير مفعل/
    );

    // Cross-org manager rejected
    await assert.rejects(
      () => fetchOrganizationPurchasesForReport(managerOrgA, 'org_other'),
      /للمؤسسة المطلوبة/
    );
  });

  // 2. Integer-Halala Totals & Branch/Supplier Breakdown Accuracy
  await runTest('2.1 Exact integer-Halala KPI totals across modern, inline, and legacy invoices', () => {
    const report = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: DEFAULT_PURCHASE_REPORT_FILTERS,
      itemsByPurchaseId: subcollectionItemsByPurchaseId,
      referenceDate: REF_DATE,
    });

    // Expected exact Halala totals:
    // Subtotal: 1000.00 + 210.50 + 450.75 + 300.25 = 1961.50
    // Discount:   50.00 +  10.50 +   0.00 +   0.00 =   60.50
    // VAT:       142.50 +  30.00 +   0.00 +   0.00 =  172.50
    // Total:    1092.50 + 230.00 + 450.75 + 300.25 = 2073.50
    assert.equal(report.summary.invoiceCount, 4);
    assert.equal(report.summary.subtotalAmount, 1961.5);
    assert.equal(report.summary.totalDiscount, 60.5);
    assert.equal(report.summary.totalVat, 172.5);
    assert.equal(report.summary.totalAmount, 2073.5);
    assert.equal(report.summary.totalHalalas, 207350);
    assert.equal(report.summary.averageInvoiceAmount, 518.38); // round(207350 / 4) = 51838 halalas

    // Sorted newest date first
    assert.deepEqual(
      report.invoices.map((i) => i.id),
      ['pur_001', 'pur_002', 'pur_003', 'pur_004_legacy']
    );

    // Step 3 subcollection items loaded for pur_001; inline for pur_002; empty for legacy pur_004_legacy
    assert.equal(report.invoices[0].items.length, 2);
    assert.equal(report.invoices[0].items[0].name, 'بن عربي محمص فاخر');
    assert.equal(report.invoices[0].attachmentsCount, 2);
    assert.equal(report.invoices[1].items.length, 2);
    assert.equal(report.invoices[3].items.length, 0);
  });

  await runTest('2.2 Branch and Supplier breakdowns reconcile 100% with overall KPI summary', () => {
    const report = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: DEFAULT_PURCHASE_REPORT_FILTERS,
      itemsByPurchaseId: subcollectionItemsByPurchaseId,
      referenceDate: REF_DATE,
    });

    // Branches:
    // br_main: pur_001 (1092.50) + pur_003 (450.75) = 1543.25 (2 invoices)
    // br_north: pur_002 (230.00) + pur_004_legacy (300.25) = 530.25 (2 invoices)
    assert.equal(report.byBranch.length, 2);
    assert.equal(report.byBranch[0].id, 'br_main');
    assert.equal(report.byBranch[0].invoiceCount, 2);
    assert.equal(report.byBranch[0].totalAmount, 1543.25);
    assert.equal(report.byBranch[0].vatAmount, 142.5);
    assert.equal(report.byBranch[0].discountAmount, 50);

    assert.equal(report.byBranch[1].id, 'br_north');
    assert.equal(report.byBranch[1].invoiceCount, 2);
    assert.equal(report.byBranch[1].totalAmount, 530.25);
    assert.equal(report.byBranch[1].vatAmount, 30);
    assert.equal(report.byBranch[1].discountAmount, 10.5);

    const branchHalalaSum = report.byBranch.reduce((acc, b) => acc + b.totalHalalas, 0);
    assert.equal(branchHalalaSum, report.summary.totalHalalas);

    // Suppliers:
    // sup_1: pur_001 (1092.50) + pur_004_legacy (300.25) = 1392.75
    // sup_old: pur_003 (450.75)
    // sup_2: pur_002 (230.00)
    assert.equal(report.bySupplier.length, 3);
    assert.equal(report.bySupplier[0].id, 'sup_1');
    assert.equal(report.bySupplier[0].totalAmount, 1392.75);
    assert.equal(report.bySupplier[1].id, 'sup_old');
    assert.equal(report.bySupplier[1].totalAmount, 450.75);
    assert.equal(report.bySupplier[2].id, 'sup_2');
    assert.equal(report.bySupplier[2].totalAmount, 230);

    const supHalalaSum = report.bySupplier.reduce((acc, s) => acc + s.totalHalalas, 0);
    assert.equal(supHalalaSum, report.summary.totalHalalas);

    // Share percentages sum close to 100.0% (within 0.2% rounding tolerance)
    const shareSum = report.bySupplier.reduce((acc, s) => acc + s.sharePercent, 0);
    assert.ok(Math.abs(shareSum - 100) <= 0.2, `Expected ~100%, got ${shareSum}`);
  });

  // 3. Date Presets, Custom Range, Branch/Supplier Filters & Multi-Field Search
  await runTest('3.1 Date presets (today, week, month, year, custom) filter accurately', () => {
    const todayRes = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: { ...DEFAULT_PURCHASE_REPORT_FILTERS, datePreset: 'today' },
      referenceDate: REF_DATE,
    });
    assert.deepEqual(todayRes.invoices.map((i) => i.id), ['pur_001']);

    const weekRes = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: { ...DEFAULT_PURCHASE_REPORT_FILTERS, datePreset: 'week' },
      referenceDate: REF_DATE,
    });
    // 2026-11-12 .. 2026-11-18 -> pur_001 (11-18) + pur_002 (11-14)
    assert.deepEqual(weekRes.invoices.map((i) => i.id), ['pur_001', 'pur_002']);

    const monthRes = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: { ...DEFAULT_PURCHASE_REPORT_FILTERS, datePreset: 'month' },
      referenceDate: REF_DATE,
    });
    // 2026-11-01 .. 2026-11-18 -> pur_001, pur_002, pur_003
    assert.deepEqual(monthRes.invoices.map((i) => i.id), ['pur_001', 'pur_002', 'pur_003']);

    const customRes = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: {
        ...DEFAULT_PURCHASE_REPORT_FILTERS,
        datePreset: 'custom',
        fromDate: '2026-04-01',
        toDate: '2026-11-05',
      },
      referenceDate: REF_DATE,
    });
    assert.deepEqual(customRes.invoices.map((i) => i.id), ['pur_003', 'pur_004_legacy']);

    const bounds = resolveDatePresetBounds('year', '', '', REF_DATE);
    assert.equal(bounds.from, '2026-01-01');
    assert.equal(bounds.to, '2026-11-18');
  });

  await runTest('3.2 Branch, Supplier (including deactivated historical supplier), and multi-field Search filters', () => {
    // Filter by branch
    const northOnly = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: { ...DEFAULT_PURCHASE_REPORT_FILTERS, branchId: 'br_north' },
      referenceDate: REF_DATE,
    });
    assert.equal(northOnly.summary.invoiceCount, 2);
    assert.equal(northOnly.summary.totalAmount, 530.25);
    assert.equal(northOnly.filterLabels.branchLabel, 'فرع الشمال');

    // Filter by historical deactivated supplier
    const oldSupOnly = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: { ...DEFAULT_PURCHASE_REPORT_FILTERS, supplierId: 'sup_old' },
      referenceDate: REF_DATE,
    });
    assert.equal(oldSupOnly.summary.invoiceCount, 1);
    assert.equal(oldSupOnly.invoices[0].id, 'pur_003');
    assert.equal(oldSupOnly.filterLabels.supplierLabel, 'مورد تاريخي موقوف');

    // Search by invoice number (case-insensitive)
    const byInvNum = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: { ...DEFAULT_PURCHASE_REPORT_FILTERS, searchQuery: 'inv-2026-098' },
      referenceDate: REF_DATE,
    });
    assert.deepEqual(byInvNum.invoices.map((i) => i.id), ['pur_002']);

    // Search by tax number
    const byTax = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: { ...DEFAULT_PURCHASE_REPORT_FILTERS, searchQuery: '310999888700003' },
      referenceDate: REF_DATE,
    });
    assert.deepEqual(byTax.invoices.map((i) => i.id), ['pur_002']);

    // Search by loaded subcollection item name
    const byItemName = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: { ...DEFAULT_PURCHASE_REPORT_FILTERS, searchQuery: 'بن عربي محمص' },
      itemsByPurchaseId: subcollectionItemsByPurchaseId,
      referenceDate: REF_DATE,
    });
    assert.deepEqual(byItemName.invoices.map((i) => i.id), ['pur_001']);

    // Combined filter: branch + supplier
    const combined = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: {
        ...DEFAULT_PURCHASE_REPORT_FILTERS,
        branchId: 'br_main',
        supplierId: 'sup_1',
      },
      itemsByPurchaseId: subcollectionItemsByPurchaseId,
      referenceDate: REF_DATE,
    });
    assert.equal(combined.summary.invoiceCount, 1);
    assert.equal(combined.summary.totalAmount, 1092.5);
  });

  // 4. Genuine Multi-Sheet RTL Arabic Excel (.xlsx) Export + ExcelJS Read-Back
  await runTest('4.1 Excel (.xlsx) export produces valid 3-sheet RTL workbook with exact data parity', async () => {
    const report = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: DEFAULT_PURCHASE_REPORT_FILTERS,
      itemsByPurchaseId: subcollectionItemsByPurchaseId,
      referenceDate: REF_DATE,
    });

    const { bytes, fileName } = await generatePurchaseReportExcel({
      report,
      org: orgA,
      generatedAt: REF_DATE,
    });

    assert.equal(fileName, 'AL_EQFAL_Purchases_Report_2026-11-18.xlsx');
    assert.ok(bytes.byteLength > 4000, 'Generated XLSX must be a valid non-empty zip archive');
    // ZIP magic bytes PK\x03\x04
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);

    // Read back with ExcelJS to verify real structure, RTL views, and exact values
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

    const sheetNames = wb.worksheets.map((ws) => ws.name);
    assert.deepEqual(sheetNames, ['ملخص المشتريات', 'تفاصيل الفواتير', 'أصناف الفواتير']);

    for (const ws of wb.worksheets) {
      assert.equal(
        ws.views?.[0]?.rightToLeft,
        true,
        `Worksheet "${ws.name}" must be rightToLeft`
      );
    }

    // Sheet 1: Summary checks
    const ws1 = wb.getWorksheet('ملخص المشتريات')!;
    assert.ok(String(ws1.getCell('A1').value).includes(orgA.name));
    // Row 9 is KPI values row (1:title, 2-5:meta, 6:blank, 7:kpiTitle, 8:kpiHead, 9:kpiVals)
    const kpiRow = ws1.getRow(9);
    assert.equal(kpiRow.getCell(1).value, report.summary.totalAmount);
    assert.equal(kpiRow.getCell(2).value, report.summary.invoiceCount);
    assert.equal(kpiRow.getCell(3).value, report.summary.subtotalAmount);
    assert.equal(kpiRow.getCell(4).value, report.summary.totalDiscount);
    assert.equal(kpiRow.getCell(5).value, report.summary.totalVat);

    // Sheet 2: Invoices checks (row 1: banner, row 2: headers, rows 3..6: 4 invoices, row 7: totals)
    const ws2 = wb.getWorksheet('تفاصيل الفواتير')!;
    assert.equal(ws2.rowCount, 7);
    assert.equal(ws2.getRow(3).getCell(2).value, 'INV-2026-101');
    assert.equal(ws2.getRow(3).getCell(12).value, 1092.5);
    assert.equal(ws2.getRow(7).getCell(8).value, report.summary.subtotalAmount);
    assert.equal(ws2.getRow(7).getCell(9).value, report.summary.totalDiscount);
    assert.equal(ws2.getRow(7).getCell(11).value, report.summary.totalVat);
    assert.equal(ws2.getRow(7).getCell(12).value, report.summary.totalAmount);

    // Sheet 3: Items checks (2 subcollection + 2 inline + 1 inline + 1 legacy fallback = 6 rows)
    // row 1: banner, row 2: headers, rows 3..8: 6 item rows, row 9: total row
    const ws3 = wb.getWorksheet('أصناف الفواتير')!;
    assert.equal(ws3.rowCount, 9);
    assert.equal(ws3.getRow(3).getCell(5).value, 'بن عربي محمص فاخر');
    assert.equal(ws3.getRow(8).getCell(5).value, 'فاتورة إجمالية بدون تفصيل أصناف');
    // Sum of all item rows + legacy subtotal equals exact report subtotalAmount (1961.50)
    assert.equal(ws3.getRow(9).getCell(8).value, report.summary.subtotalAmount);
  });

  // 5. PDF Document Model Parity & Spec-Compliant PDF 1.4 Binary Encoder
  await runTest('5.1 buildPurchaseReportPdfModel preserves exact parity with computed report', () => {
    const report = computePurchaseReport({
      purchases: purchasesFixture,
      branches: [brMain, brNorth],
      suppliers: [supActive1, supActive2, supInactiveLegacy],
      filters: { ...DEFAULT_PURCHASE_REPORT_FILTERS, branchId: 'br_main' },
      itemsByPurchaseId: subcollectionItemsByPurchaseId,
      referenceDate: REF_DATE,
    });

    const model = buildPurchaseReportPdfModel({
      report,
      org: orgA,
      generatedAt: REF_DATE,
    });

    assert.equal(model.organizationName, orgA.name);
    assert.equal(model.currency, 'SAR');
    assert.equal(model.generatedDate, '2026-11-18');
    assert.equal(model.filterLabels.branchLabel, 'الفرع الرئيسي');
    assert.equal(model.summary.invoiceCount, 2);
    assert.equal(model.summary.totalAmount, 1543.25);
    assert.equal(model.byBranch.length, 1);
    assert.equal(model.bySupplier.length, 2);
    // 2 items from pur_001 + 1 item from pur_003 = 3 line items
    assert.equal(model.allItemRows.length, 3);
    assert.equal(model.allItemRows[0].itemName, 'بن عربي محمص فاخر');
  });

  await runTest('5.2 buildPdfFromJpegPages produces spec-compliant multi-page PDF 1.4 binary', () => {
    // Reject empty pages
    assert.throws(() => buildPdfFromJpegPages([]), /لا توجد صفحات/);

    // Minimal valid-header JPEG payloads for 2 A4 pages
    const fakeJpeg1 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
    const fakeJpeg2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

    const pdfBytes = buildPdfFromJpegPages([
      { jpegBytes: fakeJpeg1, widthPx: 1240, heightPx: 1754 },
      { jpegBytes: fakeJpeg2, widthPx: 1240, heightPx: 1754 },
    ]);

    const pdfText = new TextDecoder('latin1').decode(pdfBytes);
    assert.ok(pdfText.startsWith('%PDF-1.4\n'), 'PDF must start with %PDF-1.4 header');
    assert.ok(pdfText.includes('/Type /Catalog /Pages 2 0 R'), 'Must include Catalog object');
    assert.ok(pdfText.includes('/Type /Pages /Kids [3 0 R 6 0 R] /Count 2'), 'Must reference both pages');
    assert.ok(pdfText.includes('/MediaBox [0 0 595.28 841.89]'), 'Must use A4 MediaBox dimensions');
    assert.ok(pdfText.includes('/Subtype /Image /Width 1240 /Height 1754'), 'Must embed image dimensions');
    assert.ok(pdfText.includes('/Filter /DCTDecode'), 'Must specify DCTDecode JPEG filter');
    assert.ok(pdfText.includes('xref\n0 9\n'), 'Must contain xref table with 9 entries (free + 8 objects)');
    assert.ok(pdfText.includes('trailer\n<< /Size 9 /Root 1 0 R >>'), 'Must include valid trailer');
    assert.ok(pdfText.trimEnd().endsWith('%%EOF'), 'Must terminate with %%EOF');

    // Verify startxref actually points to `xref` in the byte stream
    const match = pdfText.match(/startxref\n(\d+)\n%%EOF/);
    assert.ok(match, 'Must include numeric startxref offset');
    const xrefOffset = Number(match[1]);
    assert.equal(pdfText.slice(xrefOffset, xrefOffset + 4), 'xref');
  });

  // 6. Zero Regression in Purchase Entry Services (Supervisor / Branch Manager / Employee)
  await runTest('6.1 Supervisor & Branch Manager retain exact purchase entry permissions; Employee blocked', () => {
    // Supervisor can create for ANY org branch (br_main or br_north)
    const supPrep = preparePurchaseSubmission({
      userProfile: supervisorOrgA,
      orgId: 'org_a',
      currency: 'SAR',
      branch: brMain,
      supplier: supActive1,
      date: '2026-11-18',
      invoiceNumber: 'SUP-001',
      paymentMethod: 'transfer',
      vatRate: 15,
      discountAmount: 0,
      items: [{ id: 'i1', name: 'سكر أبيض', quantity: 2, unitPrice: 50 }],
    });
    assert.equal(supPrep.ok, true);
    if (supPrep.ok) {
      assert.equal(supPrep.data.purchase.branchId, 'br_main');
      assert.equal(supPrep.data.purchase.totalAmount, 115);
    }

    // Branch manager succeeds on OWN branch (br_north)
    const bmOwn = preparePurchaseSubmission({
      userProfile: branchManagerNorth,
      orgId: 'org_a',
      currency: 'SAR',
      branch: brNorth,
      supplier: supActive2,
      date: '2026-11-18',
      invoiceNumber: 'BM-001',
      paymentMethod: 'cash',
      vatRate: 15,
      discountAmount: 0,
      items: [{ id: 'i2', name: 'أكواب', quantity: 5, unitPrice: 20 }],
    });
    assert.equal(bmOwn.ok, true);
    if (bmOwn.ok) {
      assert.equal(bmOwn.data.purchase.branchId, 'br_north');
    }

    // Branch manager blocked on OTHER branch (br_main)
    const bmOther = preparePurchaseSubmission({
      userProfile: branchManagerNorth,
      orgId: 'org_a',
      currency: 'SAR',
      branch: brMain,
      supplier: supActive1,
      date: '2026-11-18',
      paymentMethod: 'cash',
      vatRate: 15,
      discountAmount: 0,
      items: [{ id: 'i3', name: 'صنف', quantity: 1, unitPrice: 10 }],
    });
    assert.equal(bmOther.ok, false);

    // Regular employee blocked from purchase entry
    const empAttempt = preparePurchaseSubmission({
      userProfile: employeeMain,
      orgId: 'org_a',
      currency: 'SAR',
      branch: brMain,
      supplier: supActive1,
      date: '2026-11-18',
      paymentMethod: 'cash',
      vatRate: 15,
      discountAmount: 0,
      items: [{ id: 'i4', name: 'صنف', quantity: 1, unitPrice: 10 }],
    });
    assert.equal(empAttempt.ok, false);
  });

  console.log(`\nPurchase Reports Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error in purchaseReports.test.ts:', err);
  process.exit(1);
});
