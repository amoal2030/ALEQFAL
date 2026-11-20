/**
 * Purchase Entry Service & Multi-Item Calculations Unit Tests — الإقفال | AL EQFAL
 * Covers:
 * - calculatePurchaseTotals with maxItems up to 100 items (integer Halala precision)
 * - preparePurchaseSubmission RBAC (manager, supervisor, branch_manager, employee)
 * - Branch scoping & pre-registered active supplier enforcement
 * - Multiple attachments validation (0, 1, 5, 20, >20, >50MB, forbidden MIME)
 * - Atomic payload structure matching firestore.rules
 */
import assert from 'node:assert/strict';
import {
  calculatePurchaseTotals,
  MAX_PURCHASE_ATTACHMENT_BYTES,
  MAX_PURCHASE_INVOICE_ATTACHMENTS,
  MAX_PURCHASE_INVOICE_ITEMS,
  MAX_PURCHASE_LINE_ITEMS,
} from '../utils/accounting';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import {
  formatPurchaseValidationError,
  isAllowedPurchaseAttachmentFile,
  preparePurchaseSubmission,
} from '../services/purchaseService';
import type { Branch, Supplier, UserProfile } from '../types';

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

const branchA1: Branch = {
  id: 'br_a1',
  orgId: 'org_a',
  name: 'الفرع الرئيسي',
  code: 'A-01',
  isActive: true,
  createdAt: '2026-11-01T08:00:00Z',
};

const branchA2: Branch = {
  id: 'br_a2',
  orgId: 'org_a',
  name: 'فرع الشمال',
  code: 'A-02',
  isActive: true,
  createdAt: '2026-11-01T08:00:00Z',
};

const branchInactive: Branch = {
  id: 'br_inactive',
  orgId: 'org_a',
  name: 'فرع موقوف',
  code: 'A-99',
  isActive: false,
  createdAt: '2026-11-01T08:00:00Z',
};

const supplierActive: Supplier = {
  id: 'sup_a1',
  orgId: 'org_a',
  name: 'شركة التوريد الغذائية',
  companyName: 'التوريد الحديثة المحدودة',
  taxNumber: '310123456700003',
  isActive: true,
  createdBy: 'uid_mgr',
  createdAt: '2026-11-01T08:00:00Z',
  updatedAt: '2026-11-01T08:00:00Z',
};

const supplierInactive: Supplier = {
  id: 'sup_a2',
  orgId: 'org_a',
  name: 'مورد موقوف',
  isActive: false,
  createdBy: 'uid_mgr',
  createdAt: '2026-11-01T08:00:00Z',
  updatedAt: '2026-11-01T08:00:00Z',
};

const supplierOtherOrg: Supplier = {
  id: 'sup_b1',
  orgId: 'org_b',
  name: 'مورد مؤسسة أخرى',
  isActive: true,
  createdBy: 'uid_mgr_b',
  createdAt: '2026-11-01T08:00:00Z',
  updatedAt: '2026-11-01T08:00:00Z',
};

const managerProfile: UserProfile = {
  uid: 'uid_mgr',
  orgId: 'org_a',
  email: 'mgr@example.com',
  displayName: 'مدير المؤسسة',
  role: 'manager',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('manager'),
  createdAt: '2026-11-01T08:00:00Z',
};

const supervisorAllowedProfile: UserProfile = {
  uid: 'uid_sup_ok',
  orgId: 'org_a',
  email: 'sup.ok@example.com',
  displayName: 'مشرف مشتريات',
  role: 'supervisor',
  isActive: true,
  permissions: {
    ...buildDefaultPermissionsForRole('supervisor'),
    canManagePurchases: true,
    canViewSuppliers: true,
  },
  createdAt: '2026-11-01T08:00:00Z',
};

const supervisorNoPurchasesProfile: UserProfile = {
  uid: 'uid_sup_no_pur',
  orgId: 'org_a',
  email: 'sup.nopur@example.com',
  displayName: 'مشرف بلا مشتريات',
  role: 'supervisor',
  isActive: true,
  permissions: {
    ...buildDefaultPermissionsForRole('supervisor'),
    canManagePurchases: false,
    canViewSuppliers: true,
  },
  createdAt: '2026-11-01T08:00:00Z',
};

const supervisorNoSuppliersProfile: UserProfile = {
  uid: 'uid_sup_no_sup',
  orgId: 'org_a',
  email: 'sup.nosup@example.com',
  displayName: 'مشرف بلا موردين',
  role: 'supervisor',
  isActive: true,
  permissions: {
    ...buildDefaultPermissionsForRole('supervisor'),
    canManagePurchases: true,
    canViewSuppliers: false,
  },
  createdAt: '2026-11-01T08:00:00Z',
};

const branchManagerProfile: UserProfile = {
  uid: 'uid_bm',
  orgId: 'org_a',
  email: 'bm@example.com',
  displayName: 'مسؤول الفرع الأول',
  role: 'branch_manager',
  branchId: 'br_a1',
  branchIds: ['br_a1'],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('branch_manager'),
  createdAt: '2026-11-01T08:00:00Z',
};

const employeeProfile: UserProfile = {
  uid: 'uid_emp',
  orgId: 'org_a',
  email: 'emp@example.com',
  displayName: 'موظف كاشير',
  role: 'employee',
  branchId: 'br_a1',
  branchIds: ['br_a1'],
  isActive: true,
  // Even if someone tampers with raw permissions object, employee must remain blocked
  permissions: {
    ...buildDefaultPermissionsForRole('employee'),
    canManagePurchases: true,
    canViewSuppliers: true,
  },
  createdAt: '2026-11-01T08:00:00Z',
};

console.log('========================================================================');
console.log('   PURCHASE ENTRY SERVICE & 100-ITEM CALCULATIONS UNIT TEST SUITE       ');
console.log('========================================================================\n');

runTest('1. Default calculatePurchaseTotals preserves Step 1 inline limit (1 item)', () => {
  assert.equal(MAX_PURCHASE_LINE_ITEMS, 1);
  const res = calculatePurchaseTotals({
    items: [
      { name: 'صنف 1', quantity: 1, unitPrice: 10 },
      { name: 'صنف 2', quantity: 1, unitPrice: 20 },
    ],
  });
  assert.equal(res.isValid, false);
  assert.ok(res.errors.includes('items_exceed_max_limit'));
});

runTest('2. calculatePurchaseTotals accurately computes 100 items in integer Halalas (15% VAT & discount)', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({
    name: `صنف رقم ${i + 1}`,
    quantity: (i % 5) + 1,
    unitPrice: 12.35,
  }));
  // Sum of quantities: 20 * (1+2+3+4+5) = 300; 300 * 12.35 = 3705.00
  const res = calculatePurchaseTotals({
    items,
    discountAmount: 105,
    vatRate: 15,
    maxItems: MAX_PURCHASE_INVOICE_ITEMS,
  });

  assert.equal(res.isValid, true);
  assert.equal(res.items.length, 100);
  assert.equal(res.subtotalAmount, 3705);
  assert.equal(res.discountAmount, 105);
  assert.equal(res.taxableAmount, 3600);
  assert.equal(res.vatAmount, 540);
  assert.equal(res.totalAmount, 4140);
  assert.equal(res.items[0].id, 'item_0');
  assert.equal(res.items[99].id, 'item_99');
});

runTest('3. calculatePurchaseTotals supports 0% VAT exemption and custom VAT rate (5.5%)', () => {
  const zeroVat = calculatePurchaseTotals({
    items: [
      { name: 'خضار طازجة', quantity: 10, unitPrice: 15.5 },
      { name: 'خبز', quantity: 4, unitPrice: 3.25 },
    ],
    discountAmount: 8,
    vatRate: 0,
    maxItems: MAX_PURCHASE_INVOICE_ITEMS,
  });
  assert.equal(zeroVat.isValid, true);
  assert.equal(zeroVat.subtotalAmount, 168);
  assert.equal(zeroVat.taxableAmount, 160);
  assert.equal(zeroVat.vatAmount, 0);
  assert.equal(zeroVat.totalAmount, 160);

  const customVat = calculatePurchaseTotals({
    items: [{ name: 'خدمة', quantity: 2, unitPrice: 50 }],
    discountAmount: 0,
    vatRate: 5.5,
    maxItems: MAX_PURCHASE_INVOICE_ITEMS,
  });
  assert.equal(customVat.isValid, true);
  assert.equal(customVat.vatRate, 5.5);
  assert.equal(customVat.vatAmount, 5.5);
  assert.equal(customVat.totalAmount, 105.5);
});

runTest('4. calculatePurchaseTotals rejects 101st item even if caller passes maxItems > 100', () => {
  const items = Array.from({ length: 101 }, (_, i) => ({
    name: `صنف ${i + 1}`,
    quantity: 1,
    unitPrice: 10,
  }));
  const res = calculatePurchaseTotals({
    items,
    maxItems: 250,
  });
  assert.equal(res.isValid, false);
  assert.ok(res.errors.includes('items_exceed_max_limit'));
});

runTest('5. Manager prepares valid 100-item invoice + 5 attachments on any active org branch', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({
    name: `مادة خام ${i + 1}`,
    quantity: 2,
    unitPrice: 5.5,
  }));
  const attachments = [
    { fileName: 'invoice_page1.jpg', fileSize: 250_000, mimeType: 'image/jpeg' },
    { fileName: 'invoice_page2.png', fileSize: 310_000, mimeType: 'image/png' },
    { fileName: 'receipt.webp', fileSize: 120_000, mimeType: 'image/webp' },
    { fileName: 'tax_doc.pdf', fileSize: 1_500_000, mimeType: 'application/pdf' },
    { fileName: 'delivery_note.pdf', fileSize: 800_000, mimeType: '' }, // inferred from .pdf
  ];

  const prepared = preparePurchaseSubmission({
    userProfile: managerProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA2,
    supplier: supplierActive,
    date: '2026-11-18',
    invoiceNumber: 'INV-2026-100',
    taxNumber: '310123456700003',
    paymentMethod: 'transfer',
    items,
    discountAmount: 100,
    vatRate: 15,
    notes: 'فاتورة توريد شهرية',
    attachments,
    nowIso: '2026-11-18T12:00:00.000Z',
    purchaseId: 'pur_test_100',
  });

  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;

  assert.equal(prepared.data.purchase.id, 'pur_test_100');
  assert.equal(prepared.data.purchase.branchId, 'br_a2');
  assert.equal(prepared.data.purchase.subtotalAmount, 1100);
  assert.equal(prepared.data.purchase.discountAmount, 100);
  assert.equal(prepared.data.purchase.vatAmount, 150);
  assert.equal(prepared.data.purchase.totalAmount, 1150);
  // Multiple attachments (>1): omit inline attachmentIds, link all 5 via /attachments/{id}.purchaseId
  assert.equal(prepared.data.purchase.attachmentIds, undefined);
  assert.equal(prepared.data.subItems.length, 100);
  assert.equal(prepared.data.subItems[0].id, 'item_0');
  assert.equal(prepared.data.subItems[0].lineIndex, 0);
  assert.equal(prepared.data.subItems[99].id, 'item_99');
  assert.equal(prepared.data.subItems[99].lineIndex, 99);
  assert.equal(prepared.data.attachments.length, 5);
  assert.equal(prepared.data.attachments[4].mimeType, 'application/pdf');
  for (const att of prepared.data.attachments) {
    assert.equal(att.purchaseId, 'pur_test_100');
    assert.equal(att.orgId, 'org_a');
    assert.equal(att.branchId, 'br_a2');
    assert.equal(att.fileUrl, '');
  }
  assert.equal(prepared.data.auditLog.action, 'PURCHASE_CREATED');
  assert.equal(prepared.data.auditLog.targetId, 'pur_test_100');
  assert.equal(prepared.data.notification.type, 'PURCHASE_INVOICE_RECORDED');
  assert.equal(prepared.data.notification.targetId, 'pur_test_100');
});

runTest('6. Single attachment populates purchase.attachmentIds with [att0.id] for compatibility', () => {
  const prepared = preparePurchaseSubmission({
    userProfile: managerProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA1,
    supplier: supplierActive,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'صنف واحد', quantity: 1, unitPrice: 100 }],
    vatRate: 15,
    attachments: [{ fileName: 'single.pdf', fileSize: 1024, mimeType: 'application/pdf' }],
    nowIso: '2026-11-18T12:00:00.000Z',
  });

  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.data.attachments.length, 1);
  assert.deepEqual(prepared.data.purchase.attachmentIds, [prepared.data.attachments[0].id]);
});

runTest('7. Supervisor with canManagePurchases + canViewSuppliers succeeds on any org branch; denied when missing either', () => {
  const okRes = preparePurchaseSubmission({
    userProfile: supervisorAllowedProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA2,
    supplier: supplierActive,
    date: '2026-11-18',
    paymentMethod: 'card',
    items: [{ name: 'قهوة مختصة', quantity: 5, unitPrice: 60 }],
    vatRate: 15,
  });
  assert.equal(okRes.ok, true);

  const noPurRes = preparePurchaseSubmission({
    userProfile: supervisorNoPurchasesProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA1,
    supplier: supplierActive,
    date: '2026-11-18',
    paymentMethod: 'card',
    items: [{ name: 'قهوة', quantity: 1, unitPrice: 60 }],
    vatRate: 15,
  });
  assert.equal(noPurRes.ok, false);
  if (!noPurRes.ok) assert.ok(noPurRes.errors.includes('purchase_permission_denied'));

  const noSupRes = preparePurchaseSubmission({
    userProfile: supervisorNoSuppliersProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA1,
    supplier: supplierActive,
    date: '2026-11-18',
    paymentMethod: 'card',
    items: [{ name: 'قهوة', quantity: 1, unitPrice: 60 }],
    vatRate: 15,
  });
  assert.equal(noSupRes.ok, false);
  if (!noSupRes.ok) assert.ok(noSupRes.errors.includes('supplier_selection_denied'));
});

runTest('8. Branch Manager succeeds ONLY on assigned branch and is blocked on other branches or inactive/foreign suppliers', () => {
  const okOwnBranch = preparePurchaseSubmission({
    userProfile: branchManagerProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA1,
    supplier: supplierActive,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [
      { name: 'حليب', quantity: 12, unitPrice: 6.5 },
      { name: 'سكر', quantity: 4, unitPrice: 12 },
    ],
    vatRate: 15,
  });
  assert.equal(okOwnBranch.ok, true);

  const otherBranch = preparePurchaseSubmission({
    userProfile: branchManagerProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA2,
    supplier: supplierActive,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'حليب', quantity: 1, unitPrice: 6.5 }],
    vatRate: 15,
  });
  assert.equal(otherBranch.ok, false);
  if (!otherBranch.ok) assert.ok(otherBranch.errors.includes('branch_scope_denied'));

  const inactiveSup = preparePurchaseSubmission({
    userProfile: branchManagerProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA1,
    supplier: supplierInactive,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'حليب', quantity: 1, unitPrice: 6.5 }],
    vatRate: 15,
  });
  assert.equal(inactiveSup.ok, false);
  if (!inactiveSup.ok) assert.ok(inactiveSup.errors.includes('supplier_selection_denied'));

  const foreignSup = preparePurchaseSubmission({
    userProfile: branchManagerProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA1,
    supplier: supplierOtherOrg,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'حليب', quantity: 1, unitPrice: 6.5 }],
    vatRate: 15,
  });
  assert.equal(foreignSup.ok, false);
  if (!foreignSup.ok) assert.ok(foreignSup.errors.includes('supplier_selection_denied'));
});

runTest('9. Regular Employee is ALWAYS denied even with tampered raw permissions', () => {
  const empRes = preparePurchaseSubmission({
    userProfile: employeeProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA1,
    supplier: supplierActive,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'ماء', quantity: 1, unitPrice: 5 }],
    vatRate: 15,
  });
  assert.equal(empRes.ok, false);
  if (!empRes.ok) assert.ok(empRes.errors.includes('purchase_permission_denied'));
});

runTest('10. Rejects inactive branch, invalid calendar date, empty items, and >20 attachments', () => {
  const badBranch = preparePurchaseSubmission({
    userProfile: managerProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchInactive,
    supplier: supplierActive,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'صنف', quantity: 1, unitPrice: 10 }],
  });
  assert.equal(badBranch.ok, false);
  if (!badBranch.ok) assert.ok(badBranch.errors.includes('invalid_branch'));

  const badDate = preparePurchaseSubmission({
    userProfile: managerProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA1,
    supplier: supplierActive,
    date: '2026-02-30',
    paymentMethod: 'cash',
    items: [{ name: 'صنف', quantity: 1, unitPrice: 10 }],
  });
  assert.equal(badDate.ok, false);
  if (!badDate.ok) assert.ok(badDate.errors.includes('invalid_date'));

  const tooManyAttachments = Array.from({ length: MAX_PURCHASE_INVOICE_ATTACHMENTS + 1 }, (_, i) => ({
    fileName: `doc_${i}.pdf`,
    fileSize: 1000,
    mimeType: 'application/pdf',
  }));
  const attRes = preparePurchaseSubmission({
    userProfile: managerProfile,
    orgId: 'org_a',
    currency: 'SAR',
    branch: branchA1,
    supplier: supplierActive,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'صنف', quantity: 1, unitPrice: 10 }],
    attachments: tooManyAttachments,
  });
  assert.equal(attRes.ok, false);
  if (!attRes.ok) assert.ok(attRes.errors.includes('attachments_exceed_max_limit'));
});

runTest('11. Attachment file validator enforces images/PDF, 50MB limit, and readable Arabic error messages', () => {
  assert.equal(
    isAllowedPurchaseAttachmentFile({ fileName: 'photo.jpg', fileSize: 5000, mimeType: 'image/jpeg' }).valid,
    true
  );
  assert.equal(
    isAllowedPurchaseAttachmentFile({ fileName: 'invoice.pdf', fileSize: 5000, mimeType: 'application/pdf' }).valid,
    true
  );
  assert.equal(
    isAllowedPurchaseAttachmentFile({ fileName: 'malware.exe', fileSize: 5000, mimeType: 'application/x-msdownload' }).valid,
    false
  );
  assert.equal(
    isAllowedPurchaseAttachmentFile({
      fileName: 'huge.pdf',
      fileSize: MAX_PURCHASE_ATTACHMENT_BYTES + 1,
      mimeType: 'application/pdf',
    }).valid,
    false
  );
  assert.ok(formatPurchaseValidationError('item_4_quantity_must_be_positive').includes('السطر رقم 5'));
  assert.ok(formatPurchaseValidationError('discount_exceeds_subtotal').includes('الخصم'));
  assert.ok(formatPurchaseValidationError('discount_precision_exceeded').includes('خانتين عشريتين'));
});

runTest('12. Rejects discountAmount exceeding 2 decimal places (Halala precision matching firestore.rules)', () => {
  const res = calculatePurchaseTotals({
    items: [{ name: 'صنف', quantity: 2, unitPrice: 50 }],
    discountAmount: 10.125,
    vatRate: 15,
    maxItems: MAX_PURCHASE_INVOICE_ITEMS,
  });
  assert.equal(res.isValid, false);
  assert.ok(res.errors.includes('discount_precision_exceeded'));
});

console.log('\n========================================================================');
console.log(`UNIT TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log('========================================================================');
if (failed > 0) {
  process.exit(1);
}
