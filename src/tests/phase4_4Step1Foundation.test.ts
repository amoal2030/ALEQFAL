/**
 * Phase 4.4 Step 1 Foundation Unit Tests
 * Validates:
 * 1. Supplier, PurchaseLineItem, and Purchase backwards-compatible types
 * 2. Integer-Halala calculatePurchaseTotals arithmetic & validation rules
 * 3. Phase 4.4 Role Matrix for Purchases & Suppliers in permissions.ts
 */
import assert from 'node:assert/strict';
import type { Purchase, PurchaseLineItem, Supplier, UserProfile } from '../types';
import {
  calculatePurchaseTotals,
  MAX_PURCHASE_ATTACHMENTS,
  MAX_PURCHASE_LINE_ITEMS,
} from '../utils/accounting';
import {
  buildDefaultPermissionsForRole,
  canUserCreatePurchase,
  canUserCreateSupplier,
  canUserDeleteSupplier,
  canUserEditSupplier,
  canUserSelectSupplierForPurchase,
  canUserToggleSupplierStatus,
  resolveEffectivePermissions,
} from '../utils/permissions';

let passed = 0;

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS [${passed}]: ${name}`);
}

const activeSupplierOrg1: Supplier = {
  id: 'sup_1',
  orgId: 'org_1',
  name: 'شركة التوريد الحديث',
  contactPerson: 'خالد العتيبي',
  companyName: 'مؤسسة التوريد الحديث التجارية',
  taxNumber: '310123456700003',
  phone: '0501234567',
  openingBalance: 1250.5,
  isActive: true,
  createdBy: 'uid_mgr_1',
  createdAt: '2026-11-16T08:00:00.000Z',
  updatedAt: '2026-11-16T08:00:00.000Z',
};

const inactiveSupplierOrg1: Supplier = {
  ...activeSupplierOrg1,
  id: 'sup_inactive',
  name: 'مورد موقوف',
  isActive: false,
};

const activeSupplierOtherOrg: Supplier = {
  ...activeSupplierOrg1,
  id: 'sup_other_org',
  orgId: 'org_2',
  name: 'مورد مؤسسة أخرى',
};

// 1. Backwards Compatibility of Types
runTest('1. Legacy Supplier and Purchase records remain type-compatible without new optional fields', () => {
  const legacySupplier: Supplier = {
    id: 'sup_legacy',
    orgId: 'org_1',
    name: 'مورد قديم',
    isActive: true,
    createdBy: 'uid_mgr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const legacyPurchase: Purchase = {
    id: 'pur_legacy',
    orgId: 'org_1',
    branchId: 'br_1',
    supplierId: legacySupplier.id,
    date: '2026-01-05',
    amount: 500,
    totalAmount: 500,
    paymentMethod: 'cash',
    createdBy: 'uid_mgr_1',
    createdByRole: 'manager',
    createdAt: '2026-01-05T10:00:00.000Z',
    updatedAt: '2026-01-05T10:00:00.000Z',
  };

  const lineItems: PurchaseLineItem[] = [
    { id: 'li_1', name: 'بن مختص 1 كجم', quantity: 2, unitPrice: 85.5, total: 171 },
  ];
  const expandedPurchase: Purchase = {
    ...legacyPurchase,
    id: 'pur_expanded',
    taxNumber: '310123456700003',
    items: lineItems,
    subtotalAmount: 171,
    discountAmount: 10,
    vatRate: 15,
    vatAmount: 24.15,
    totalAmount: 185.15,
    attachmentIds: ['att_pur_1'],
  };

  assert.equal(legacySupplier.openingBalance, undefined);
  assert.equal(legacyPurchase.items, undefined);
  assert.equal(expandedPurchase.items?.length, 1);
  assert.equal(expandedPurchase.attachmentIds?.[0], 'att_pur_1');
});

// 2. Integer Halala Purchase Calculation (15% VAT + Decimal Precision)
runTest('2. calculatePurchaseTotals computes exact integer-Halala totals for 15% VAT invoices', () => {
  const result = calculatePurchaseTotals({
    items: [
      { id: '1', name: 'منتج أ', quantity: 3, unitPrice: 20.09 }, // 60.27 -> 6027h
    ],
    discountAmount: 0.27, // 27h -> taxable 60.00 (6000h)
    vatRate: 15,
  });

  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.subtotalHalalas, 6027);
  assert.equal(result.subtotalAmount, 60.27);
  assert.equal(result.discountHalalas, 27);
  assert.equal(result.discountAmount, 0.27);
  assert.equal(result.taxableHalalas, 6000);
  assert.equal(result.vatHalalas, 900);
  assert.equal(result.vatAmount, 9);
  assert.equal(result.totalHalalas, 6900);
  assert.equal(result.totalAmount, 69);
  assert.equal(result.items[0].total, 60.27);
  assert.equal(result.totalHalalas, result.subtotalHalalas - result.discountHalalas + result.vatHalalas);
});

// 3. Tax-Exempt (0%) & Custom VAT Rate & Fractional Quantities
runTest('3. calculatePurchaseTotals supports 0% tax-exempt, custom VAT rate, and fractional quantities', () => {
  const exempt = calculatePurchaseTotals({
    items: [{ name: 'خضروات طازجة', quantity: 2.5, unitPrice: 10.4 }], // 26.00
    discountAmount: 6,
    vatRate: 0,
  });
  assert.equal(exempt.isValid, true);
  assert.equal(exempt.subtotalAmount, 26);
  assert.equal(exempt.discountAmount, 6);
  assert.equal(exempt.vatAmount, 0);
  assert.equal(exempt.totalAmount, 20);

  const customRate = calculatePurchaseTotals({
    subtotalAmount: 200,
    discountAmount: 50,
    vatRate: 5,
  });
  assert.equal(customRate.isValid, true);
  assert.equal(customRate.taxableAmount, 150);
  assert.equal(customRate.vatAmount, 7.5);
  assert.equal(customRate.totalAmount, 157.5);

  const fullDiscount = calculatePurchaseTotals({
    subtotalAmount: 100,
    discountAmount: 100,
    vatRate: 15,
  });
  assert.equal(fullDiscount.isValid, true);
  assert.equal(fullDiscount.vatAmount, 0);
  assert.equal(fullDiscount.totalAmount, 0);
});

// 4. Purchase Validation Rejections
runTest('4. calculatePurchaseTotals rejects negative values, discount > subtotal, NaN, and missing totals', () => {
  const discountTooHigh = calculatePurchaseTotals({
    items: [{ name: 'صنف', quantity: 1, unitPrice: 50 }],
    discountAmount: 50.01,
    vatRate: 15,
  });
  assert.equal(discountTooHigh.isValid, false);
  assert.ok(discountTooHigh.errors.includes('discount_exceeds_subtotal'));

  const negativeValues = calculatePurchaseTotals({
    items: [{ name: 'صنف', quantity: -2, unitPrice: -10 }],
    discountAmount: -5,
    vatRate: -15,
  });
  assert.equal(negativeValues.isValid, false);
  assert.ok(negativeValues.errors.includes('item_0_quantity_must_be_positive'));
  assert.ok(negativeValues.errors.includes('item_0_unit_price_must_be_non_negative'));
  assert.ok(negativeValues.errors.includes('discount_must_be_non_negative'));
  assert.ok(negativeValues.errors.includes('vat_rate_must_be_non_negative'));

  const nonFinite = calculatePurchaseTotals({
    items: [{ name: 'صنف', quantity: Number.NaN, unitPrice: Number.POSITIVE_INFINITY }],
    vatRate: 150,
  });
  assert.equal(nonFinite.isValid, false);
  assert.ok(nonFinite.errors.includes('item_0_invalid_quantity'));
  assert.ok(nonFinite.errors.includes('item_0_invalid_unit_price'));
  assert.ok(nonFinite.errors.includes('vat_rate_exceeds_100'));

  const emptyInput = calculatePurchaseTotals({ items: [] });
  assert.equal(emptyInput.isValid, false);
  assert.ok(emptyInput.errors.includes('purchase_items_or_subtotal_required'));
});

// 5. Organization Manager Permissions Matrix
runTest('5. Organization Manager has full supplier & purchase management (including safe supplier delete) within org', () => {
  const manager: UserProfile = {
    uid: 'uid_mgr',
    orgId: 'org_1',
    email: 'mgr@org1.com',
    displayName: 'مدير المؤسسة',
    role: 'manager',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('manager'),
    createdAt: '2026-11-16T00:00:00.000Z',
  };

  const eff = resolveEffectivePermissions(manager);
  assert.equal(eff.canManagePurchases, true);
  assert.equal(eff.canManageSuppliers, true);
  assert.equal(eff.canViewSuppliers, true);
  assert.equal(eff.canCreateSuppliers, true);
  assert.equal(eff.canEditSuppliers, true);
  assert.equal(eff.canToggleSuppliersStatus, true);
  assert.equal(eff.canDeleteSuppliers, true);

  assert.equal(canUserCreateSupplier(manager), true);
  assert.equal(canUserEditSupplier(manager), true);
  assert.equal(canUserToggleSupplierStatus(manager), true);
  assert.equal(canUserDeleteSupplier(manager), true);
  assert.equal(canUserCreatePurchase(manager, 'br_any'), true);
  assert.equal(canUserSelectSupplierForPurchase(manager, activeSupplierOrg1), true);
  assert.equal(canUserSelectSupplierForPurchase(manager, inactiveSupplierOrg1), false);
  assert.equal(canUserSelectSupplierForPurchase(manager, activeSupplierOtherOrg), false);
});

// 6. Supervisor Permissions Matrix (Create-Only Supplier when Opted-In; No Edit/Toggle/Delete)
runTest('6. Supervisor can only create suppliers when granted canManageSuppliers, never edit/toggle/delete', () => {
  const defaultSup: UserProfile = {
    uid: 'uid_sup_0',
    orgId: 'org_1',
    email: 'sup0@org1.com',
    displayName: 'مسؤول افتراضي',
    role: 'supervisor',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('supervisor'),
    createdAt: '2026-11-16T00:00:00.000Z',
  };

  assert.equal(canUserCreateSupplier(defaultSup), false);
  assert.equal(canUserEditSupplier(defaultSup), false);
  assert.equal(canUserToggleSupplierStatus(defaultSup), false);
  assert.equal(canUserDeleteSupplier(defaultSup), false);
  assert.equal(canUserCreatePurchase(defaultSup, 'br_1'), false);

  const optedInSup: UserProfile = {
    ...defaultSup,
    uid: 'uid_sup_1',
    permissions: buildDefaultPermissionsForRole('supervisor', {
      canManageSuppliers: true,
      canManagePurchases: true,
    }),
  };

  // Canonical stored UserPermissions key count remains strictly 10 (compatible with firestore.rules)
  assert.equal(Object.keys(optedInSup.permissions).length, 10);

  const effOptedIn = resolveEffectivePermissions(optedInSup);
  assert.equal(effOptedIn.canCreateSuppliers, true);
  assert.equal(effOptedIn.canEditSuppliers, false);
  assert.equal(effOptedIn.canToggleSuppliersStatus, false);
  assert.equal(effOptedIn.canDeleteSuppliers, false);
  assert.equal(canUserCreateSupplier(optedInSup), true);
  assert.equal(canUserEditSupplier(optedInSup), false);
  assert.equal(canUserToggleSupplierStatus(optedInSup), false);
  assert.equal(canUserDeleteSupplier(optedInSup), false);
  assert.equal(canUserCreatePurchase(optedInSup, 'br_2'), true);
  assert.equal(canUserSelectSupplierForPurchase(optedInSup, activeSupplierOrg1), true);
});

// 7. Branch Manager Permissions Matrix (Single Branch Purchases + Active Registered Suppliers Only)
runTest('7. Branch Manager creates purchases in assigned branch only and selects active suppliers only without supplier CRUD', () => {
  const bm: UserProfile = {
    uid: 'uid_bm_1',
    orgId: 'org_1',
    email: 'bm@org1.com',
    displayName: 'مسؤول فرع 1',
    role: 'branch_manager',
    branchId: 'br_1',
    branchIds: ['br_1'],
    isActive: true,
    permissions: {
      ...buildDefaultPermissionsForRole('branch_manager'),
      // Attempted tampering must still be stripped
      canManageSuppliers: true,
    },
    createdAt: '2026-11-16T00:00:00.000Z',
  };

  const eff = resolveEffectivePermissions(bm);
  assert.equal(eff.canManagePurchases, true);
  assert.equal(eff.canViewSuppliers, true);
  assert.equal(eff.canManageSuppliers, false);
  assert.equal(eff.canCreateSuppliers, false);
  assert.equal(eff.canEditSuppliers, false);
  assert.equal(eff.canToggleSuppliersStatus, false);
  assert.equal(eff.canDeleteSuppliers, false);
  assert.equal(eff.canSelectActiveSuppliersOnly, true);

  assert.equal(canUserCreateSupplier(bm), false);
  assert.equal(canUserEditSupplier(bm), false);
  assert.equal(canUserToggleSupplierStatus(bm), false);
  assert.equal(canUserDeleteSupplier(bm), false);

  // Branch scope enforcement
  assert.equal(canUserCreatePurchase(bm, 'br_1'), true);
  assert.equal(canUserCreatePurchase(bm, 'br_2'), false);

  // Registered active suppliers only
  assert.equal(canUserSelectSupplierForPurchase(bm, activeSupplierOrg1), true);
  assert.equal(canUserSelectSupplierForPurchase(bm, inactiveSupplierOrg1), false);
  assert.equal(canUserSelectSupplierForPurchase(bm, activeSupplierOtherOrg), false);
});

// 8. Employee & Deactivated Account Fail Closed
runTest('8. Employee never gains purchase/supplier powers and inactive accounts fail closed', () => {
  const tamperedEmployee: UserProfile = {
    uid: 'uid_emp_1',
    orgId: 'org_1',
    email: 'emp@org1.com',
    displayName: 'موظف',
    role: 'employee',
    branchId: 'br_1',
    isActive: true,
    permissions: {
      ...buildDefaultPermissionsForRole('employee'),
      canManagePurchases: true,
      canManageSuppliers: true,
      canViewSuppliers: true,
    },
    createdAt: '2026-11-16T00:00:00.000Z',
  };

  const effEmp = resolveEffectivePermissions(tamperedEmployee);
  assert.equal(effEmp.canManagePurchases, false);
  assert.equal(effEmp.canManageSuppliers, false);
  assert.equal(effEmp.canViewSuppliers, false);
  assert.equal(effEmp.canCreateSuppliers, false);
  assert.equal(canUserCreatePurchase(tamperedEmployee, 'br_1'), false);
  assert.equal(canUserSelectSupplierForPurchase(tamperedEmployee, activeSupplierOrg1), false);

  const inactiveManager: UserProfile = {
    uid: 'uid_mgr_inactive',
    orgId: 'org_1',
    email: 'inactive@org1.com',
    displayName: 'مدير موقوف',
    role: 'manager',
    isActive: false,
    permissions: buildDefaultPermissionsForRole('manager'),
    createdAt: '2026-11-16T00:00:00.000Z',
  };

  assert.equal(canUserCreateSupplier(inactiveManager), false);
  assert.equal(canUserCreatePurchase(inactiveManager, 'br_1'), false);
  assert.equal(canUserSelectSupplierForPurchase(inactiveManager, activeSupplierOrg1), false);
});

// 9. Audit Alignment: Pure Integer Halala VAT, VatRate Precision, Item Limits, Trimmed Names/IDs
runTest('9. Audit alignment: 10.50 * 15% = 1.58 exact, rejects >2-decimal vatRate, excess items, and blank item names/IDs', () => {
  assert.equal(MAX_PURCHASE_LINE_ITEMS, 1);
  assert.equal(MAX_PURCHASE_ATTACHMENTS, 1);

  const exactHalfUp = calculatePurchaseTotals({
    items: [{ id: 'it_1', name: 'صنف', quantity: 1, unitPrice: 10.5 }],
    discountAmount: 0,
    vatRate: 15,
  });
  assert.equal(exactHalfUp.isValid, true);
  assert.equal(exactHalfUp.vatAmount, 1.58);
  assert.equal(exactHalfUp.totalAmount, 12.08);

  const tooManyDecimalsVat = calculatePurchaseTotals({
    subtotalAmount: 100,
    vatRate: 15.125,
  });
  assert.equal(tooManyDecimalsVat.isValid, false);
  assert.ok(tooManyDecimalsVat.errors.includes('vat_rate_precision_exceeded'));

  const exceedsItemsLimit = calculatePurchaseTotals({
    items: [
      { id: 'it_1', name: 'صنف 1', quantity: 1, unitPrice: 10 },
      { id: 'it_2', name: 'صنف 2', quantity: 1, unitPrice: 20 },
    ],
    vatRate: 15,
  });
  assert.equal(exceedsItemsLimit.isValid, false);
  assert.ok(exceedsItemsLimit.errors.includes('items_exceed_max_limit'));

  const blankItemFields = calculatePurchaseTotals({
    items: [{ id: '   ', name: '   ', quantity: 1, unitPrice: 10 }],
    vatRate: 15,
  });
  assert.equal(blankItemFields.isValid, false);
  assert.ok(blankItemFields.errors.includes('item_0_id_required'));
  assert.ok(blankItemFields.errors.includes('item_0_name_required'));
});

// 10. Supervisor with canManagePurchases ONLY must NOT gain canViewSuppliers
runTest('10. Supervisor granted canManagePurchases alone does NOT gain canViewSuppliers', () => {
  const supPurchasesOnly: UserProfile = {
    uid: 'uid_sup_pur_only',
    orgId: 'org_1',
    email: 'sup.pur@org1.com',
    displayName: 'مسؤول مشتريات فقط',
    role: 'supervisor',
    isActive: true,
    permissions: buildDefaultPermissionsForRole('supervisor', {
      canManagePurchases: true,
    }),
    createdAt: '2026-11-16T00:00:00.000Z',
  };

  const eff = resolveEffectivePermissions(supPurchasesOnly);
  assert.equal(eff.canManagePurchases, true);
  assert.equal(eff.canViewSuppliers, false);
  assert.equal(eff.canManageSuppliers, false);
  assert.equal(eff.canCreateSuppliers, false);
  assert.equal(canUserCreatePurchase(supPurchasesOnly, 'br_1'), true);
});

console.log(`\nALL ${passed} PHASE 4.4 STEP 1 TESTS PASSED`);
