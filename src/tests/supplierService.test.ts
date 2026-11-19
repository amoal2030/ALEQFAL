/**
 * Supplier Management Service & Purchases Integration Unit Test Suite — AL EQFAL
 * Covers role-based supplier CRUD, safe purchase-referential-integrity delete guard,
 * duplicate detection (Arabic normalization + tax number), field validation,
 * cross-org isolation, and integration with purchase invoice entry permissions.
 */
import assert from 'node:assert/strict';
import {
  findDuplicateSupplier,
  normalizeSupplierName,
  normalizeSupplierTaxNumber,
  prepareCreateSupplier,
  prepareDeleteSupplier,
  prepareToggleSupplierStatus,
  prepareUpdateSupplier,
  validateSupplierFormInput,
} from '../services/supplierService';
import { preparePurchaseSubmission } from '../services/purchaseService';
import { buildDefaultPermissionsForRole } from '../utils/permissions';
import type { Branch, Supplier, UserProfile } from '../types';

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err instanceof Error ? err.message : err);
    failed++;
  }
}

const brA1: Branch = {
  id: 'br_a1',
  orgId: 'org_a',
  name: 'الفرع الرئيسي',
  code: 'A-01',
  isActive: true,
  createdAt: '2026-11-01T08:00:00.000Z',
};

const brA2: Branch = {
  id: 'br_a2',
  orgId: 'org_a',
  name: 'فرع الشمال',
  code: 'A-02',
  isActive: true,
  createdAt: '2026-11-01T08:00:00.000Z',
};

const existingSupOrgA: Supplier = {
  id: 'sup_a1',
  orgId: 'org_a',
  name: 'شركة النخبة للتوريد',
  taxNumber: '310111222300003',
  phone: '0551112233',
  address: 'الرياض - طريق الملك فهد',
  notes: 'توريد أسبوعي',
  contactPerson: 'فهد العتيبي',
  companyName: 'شركة النخبة المحدودة',
  email: 'sales@nokhba.sa',
  openingBalance: 1200.5,
  isActive: true,
  createdBy: 'uid_mgr_a',
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
};

const inactiveSupOrgA: Supplier = {
  ...existingSupOrgA,
  id: 'sup_a_inactive',
  name: 'مؤسسة التوريد الموقوفة',
  taxNumber: '310222333400003',
  isActive: false,
};

const supOrgB: Supplier = {
  id: 'sup_b1',
  orgId: 'org_b',
  name: 'شركة النخبة للتوريد',
  taxNumber: '310111222300003',
  phone: '0509998877',
  isActive: true,
  createdBy: 'uid_mgr_b',
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
};

const managerOrgA: UserProfile = {
  uid: 'uid_mgr_a',
  orgId: 'org_a',
  email: 'mgr.a@example.com',
  displayName: 'مدير المؤسسة أ',
  role: 'manager',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('manager'),
  createdAt: '2026-11-01T08:00:00.000Z',
};

const supervisorWithSuppliersAndPurchases: UserProfile = {
  uid: 'uid_sup_yes',
  orgId: 'org_a',
  email: 'sup.yes@example.com',
  displayName: 'مسؤول المشتريات والموردين',
  role: 'supervisor',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('supervisor', {
    canManageSuppliers: true,
    canManagePurchases: true,
    canViewSuppliers: true,
  }),
  createdAt: '2026-11-01T08:00:00.000Z',
};

const supervisorWithoutSuppliers: UserProfile = {
  uid: 'uid_sup_no',
  orgId: 'org_a',
  email: 'sup.no@example.com',
  displayName: 'مسؤول بدون صلاحية موردين',
  role: 'supervisor',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('supervisor', {
    canManageSuppliers: false,
    canManagePurchases: true,
    canViewSuppliers: true,
  }),
  createdAt: '2026-11-01T08:00:00.000Z',
};

const branchManagerA1: UserProfile = {
  uid: 'uid_bm_a1',
  orgId: 'org_a',
  email: 'bm.a1@example.com',
  displayName: 'مسؤول الفرع الأول',
  role: 'branch_manager',
  branchId: 'br_a1',
  branchIds: ['br_a1'],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('branch_manager'),
  createdAt: '2026-11-01T08:00:00.000Z',
};

const regularEmployee: UserProfile = {
  uid: 'uid_emp_a',
  orgId: 'org_a',
  email: 'emp.a@example.com',
  displayName: 'موظف عادي',
  role: 'employee',
  branchId: 'br_a1',
  branchIds: ['br_a1'],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('employee'),
  createdAt: '2026-11-01T08:00:00.000Z',
};

console.log('========================================================================');
console.log('   SUPPLIER MANAGEMENT & PURCHASES PERMISSIONS UNIT TEST SUITE          ');
console.log('========================================================================\n');

runTest('1. Manager can create, edit, toggle status, and delete an unlinked supplier (with audit logs & suppliers tab notification)', () => {
  const created = prepareCreateSupplier({
    userProfile: managerOrgA,
    orgId: 'org_a',
    input: {
      name: '  مؤسسة الأفق  للمنتجات  ',
      taxNumber: '310555666700003',
      phone: '+966 55 123 4567',
      address: 'جدة - حي الروضة',
      notes: 'توريد يومي',
      openingBalance: '500.25',
    },
    existingSuppliers: [existingSupOrgA],
    nowIso: '2026-11-18T10:00:00.000Z',
    supplierId: 'sup_new_mgr',
  });

  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.data.supplier.id, 'sup_new_mgr');
  assert.equal(created.data.supplier.name, 'مؤسسة الأفق للمنتجات');
  assert.equal(created.data.supplier.openingBalance, 500.25);
  assert.equal(created.data.supplier.isActive, true);
  assert.equal(created.data.auditLog.action, 'SUPPLIER_CREATED');
  assert.equal(created.data.auditLog.targetId, 'sup_new_mgr');
  assert.equal(created.data.notification.type, 'SUPPLIER_ADDED');
  assert.equal(created.data.notification.navTarget?.tab, 'suppliers');

  const updated = prepareUpdateSupplier({
    userProfile: managerOrgA,
    orgId: 'org_a',
    targetSupplier: created.data.supplier,
    input: {
      name: 'مؤسسة الأفق المحدثة',
      taxNumber: '310555666700003', // keeping own taxNumber is allowed
      phone: '', // clearing optional field
      address: 'الدمام',
      openingBalance: 0,
    },
    existingSuppliers: [existingSupOrgA, created.data.supplier],
    nowIso: '2026-11-18T11:00:00.000Z',
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.data.updatedSupplier.name, 'مؤسسة الأفق المحدثة');
  assert.ok(updated.data.clearedOptionalKeys.includes('phone'));
  assert.ok(updated.data.clearedOptionalKeys.includes('notes'));
  assert.equal(updated.data.auditLog.action, 'SUPPLIER_UPDATED');

  const toggled = prepareToggleSupplierStatus({
    userProfile: managerOrgA,
    orgId: 'org_a',
    targetSupplier: updated.data.updatedSupplier,
    nextIsActive: false,
    nowIso: '2026-11-18T12:00:00.000Z',
  });
  assert.equal(toggled.ok, true);
  if (!toggled.ok) return;
  assert.equal(toggled.data.nextIsActive, false);
  assert.equal(toggled.data.auditLog.action, 'SUPPLIER_STATUS_TOGGLED');

  const deleted = prepareDeleteSupplier({
    userProfile: managerOrgA,
    orgId: 'org_a',
    targetSupplier: updated.data.updatedSupplier,
    linkedPurchasesCount: 0,
    nowIso: '2026-11-18T13:00:00.000Z',
  });
  assert.equal(deleted.ok, true);
  if (!deleted.ok) return;
  assert.equal(deleted.data.supplierId, 'sup_new_mgr');
  assert.equal(deleted.data.auditLog.action, 'SUPPLIER_DELETED');
});

runTest('2. Manager delete is BLOCKED when supplier is linked to existing purchase invoices (referential integrity)', () => {
  const blocked = prepareDeleteSupplier({
    userProfile: managerOrgA,
    orgId: 'org_a',
    targetSupplier: existingSupOrgA,
    linkedPurchasesCount: 3,
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, 'supplier_has_linked_purchases');
  assert.equal(blocked.blockedByPurchases, true);
  assert.equal(blocked.linkedPurchasesCount, 3);

  const invalidCount = prepareDeleteSupplier({
    userProfile: managerOrgA,
    orgId: 'org_a',
    targetSupplier: existingSupOrgA,
    linkedPurchasesCount: -1,
  });
  assert.equal(invalidCount.ok, false);
  if (invalidCount.ok) return;
  assert.equal(invalidCount.code, 'integrity_check_failed');
});

runTest('3. Supervisor WITH canManageSuppliers can add supplier ONLY, strictly denied edit/toggle/delete; Supervisor WITHOUT permission denied add', () => {
  const created = prepareCreateSupplier({
    userProfile: supervisorWithSuppliersAndPurchases,
    orgId: 'org_a',
    input: { name: 'مورد مضاف بواسطة المسؤول', phone: '0544445555' },
    existingSuppliers: [existingSupOrgA],
    supplierId: 'sup_by_sup',
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.data.supplier.createdBy, 'uid_sup_yes');
  assert.equal(created.data.auditLog.actorRole, 'supervisor');

  // Denied edit
  const editRes = prepareUpdateSupplier({
    userProfile: supervisorWithSuppliersAndPurchases,
    orgId: 'org_a',
    targetSupplier: created.data.supplier,
    input: { name: 'محاولة تعديل' },
  });
  assert.equal(editRes.ok, false);
  if (!editRes.ok) assert.equal(editRes.code, 'permission_denied');

  // Denied toggle
  const toggleRes = prepareToggleSupplierStatus({
    userProfile: supervisorWithSuppliersAndPurchases,
    orgId: 'org_a',
    targetSupplier: created.data.supplier,
    nextIsActive: false,
  });
  assert.equal(toggleRes.ok, false);
  if (!toggleRes.ok) assert.equal(toggleRes.code, 'permission_denied');

  // Denied delete
  const delRes = prepareDeleteSupplier({
    userProfile: supervisorWithSuppliersAndPurchases,
    orgId: 'org_a',
    targetSupplier: created.data.supplier,
    linkedPurchasesCount: 0,
  });
  assert.equal(delRes.ok, false);
  if (!delRes.ok) assert.equal(delRes.code, 'permission_denied');

  // Supervisor WITHOUT canManageSuppliers denied create
  const deniedCreate = prepareCreateSupplier({
    userProfile: supervisorWithoutSuppliers,
    orgId: 'org_a',
    input: { name: 'مورد غير مصرح' },
  });
  assert.equal(deniedCreate.ok, false);
  if (!deniedCreate.ok) assert.equal(deniedCreate.code, 'permission_denied');
});

runTest('4. Supervisor with canManagePurchases can record purchases across ALL organization branches', () => {
  for (const branch of [brA1, brA2]) {
    const res = preparePurchaseSubmission({
      userProfile: supervisorWithSuppliersAndPurchases,
      orgId: 'org_a',
      currency: 'SAR',
      branch,
      supplier: existingSupOrgA,
      date: '2026-11-18',
      paymentMethod: 'transfer',
      items: [{ name: 'بن مختص', quantity: 2, unitPrice: 150 }],
      vatRate: 15,
    });
    assert.equal(res.ok, true);
  }
});

runTest('5. Branch Manager is DENIED creating/editing/toggling/deleting suppliers, CAN enter purchase for own branch ONLY using active supplier', () => {
  const c = prepareCreateSupplier({
    userProfile: branchManagerA1,
    orgId: 'org_a',
    input: { name: 'مورد من مسؤول فرع' },
  });
  assert.equal(c.ok, false);
  if (!c.ok) assert.equal(c.code, 'permission_denied');

  const u = prepareUpdateSupplier({
    userProfile: branchManagerA1,
    orgId: 'org_a',
    targetSupplier: existingSupOrgA,
    input: { name: 'تعديل من مسؤول فرع' },
  });
  assert.equal(u.ok, false);
  if (!u.ok) assert.equal(u.code, 'permission_denied');

  const t = prepareToggleSupplierStatus({
    userProfile: branchManagerA1,
    orgId: 'org_a',
    targetSupplier: existingSupOrgA,
    nextIsActive: false,
  });
  assert.equal(t.ok, false);
  if (!t.ok) assert.equal(t.code, 'permission_denied');

  const d = prepareDeleteSupplier({
    userProfile: branchManagerA1,
    orgId: 'org_a',
    targetSupplier: existingSupOrgA,
    linkedPurchasesCount: 0,
  });
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, 'permission_denied');

  // Own branch purchase with active supplier -> ALLOWED
  const okOwn = preparePurchaseSubmission({
    userProfile: branchManagerA1,
    orgId: 'org_a',
    currency: 'SAR',
    branch: brA1,
    supplier: existingSupOrgA,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'حليب طازج', quantity: 10, unitPrice: 12 }],
    vatRate: 15,
  });
  assert.equal(okOwn.ok, true);

  // Other branch purchase -> DENIED
  const denyOther = preparePurchaseSubmission({
    userProfile: branchManagerA1,
    orgId: 'org_a',
    currency: 'SAR',
    branch: brA2,
    supplier: existingSupOrgA,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'حليب طازج', quantity: 10, unitPrice: 12 }],
    vatRate: 15,
  });
  assert.equal(denyOther.ok, false);

  // Inactive supplier purchase -> DENIED
  const denyInactiveSup = preparePurchaseSubmission({
    userProfile: branchManagerA1,
    orgId: 'org_a',
    currency: 'SAR',
    branch: brA1,
    supplier: inactiveSupOrgA,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'حليب طازج', quantity: 10, unitPrice: 12 }],
    vatRate: 15,
  });
  assert.equal(denyInactiveSup.ok, false);
});

runTest('6. Regular Employee is DENIED all supplier operations and all purchase entry', () => {
  assert.equal(
    prepareCreateSupplier({
      userProfile: regularEmployee,
      orgId: 'org_a',
      input: { name: 'مورد موظف' },
    }).ok,
    false
  );
  assert.equal(
    prepareUpdateSupplier({
      userProfile: regularEmployee,
      orgId: 'org_a',
      targetSupplier: existingSupOrgA,
      input: { name: 'تعديل موظف' },
    }).ok,
    false
  );
  assert.equal(
    prepareDeleteSupplier({
      userProfile: regularEmployee,
      orgId: 'org_a',
      targetSupplier: existingSupOrgA,
      linkedPurchasesCount: 0,
    }).ok,
    false
  );
  assert.equal(
    preparePurchaseSubmission({
      userProfile: regularEmployee,
      orgId: 'org_a',
      currency: 'SAR',
      branch: brA1,
      supplier: existingSupOrgA,
      date: '2026-11-18',
      paymentMethod: 'cash',
      items: [{ name: 'صنف', quantity: 1, unitPrice: 10 }],
    }).ok,
    false
  );
});

runTest('7. Cross-organization isolation: Org A manager cannot edit/toggle/delete Org B supplier or use Org B supplier in purchases', () => {
  const crossEdit = prepareUpdateSupplier({
    userProfile: managerOrgA,
    orgId: 'org_a',
    targetSupplier: supOrgB,
    input: { name: 'تعديل عبر مؤسسة' },
  });
  assert.equal(crossEdit.ok, false);
  if (!crossEdit.ok) assert.equal(crossEdit.code, 'supplier_not_in_org');

  const crossToggle = prepareToggleSupplierStatus({
    userProfile: managerOrgA,
    orgId: 'org_a',
    targetSupplier: supOrgB,
    nextIsActive: false,
  });
  assert.equal(crossToggle.ok, false);
  if (!crossToggle.ok) assert.equal(crossToggle.code, 'supplier_not_in_org');

  const crossDel = prepareDeleteSupplier({
    userProfile: managerOrgA,
    orgId: 'org_a',
    targetSupplier: supOrgB,
    linkedPurchasesCount: 0,
  });
  assert.equal(crossDel.ok, false);
  if (!crossDel.ok) assert.equal(crossDel.code, 'supplier_not_in_org');

  const crossPurchase = preparePurchaseSubmission({
    userProfile: managerOrgA,
    orgId: 'org_a',
    currency: 'SAR',
    branch: brA1,
    supplier: supOrgB,
    date: '2026-11-18',
    paymentMethod: 'cash',
    items: [{ name: 'صنف', quantity: 1, unitPrice: 100 }],
  });
  assert.equal(crossPurchase.ok, false);

  // Org A creating a supplier with the same name as Org B's supplier is NOT a duplicate if Org A doesn't have it
  const sameNameDifferentOrg = prepareCreateSupplier({
    userProfile: managerOrgA,
    orgId: 'org_a',
    input: { name: 'شركة النخبة للتوريد', taxNumber: '310111222300003' },
    existingSuppliers: [supOrgB], // only org_b supplier present
  });
  assert.equal(sameNameDifferentOrg.ok, true);
});

runTest('8. Validation & Arabic/Tax duplicate detection reject invalid/duplicate inputs cleanly', () => {
  assert.equal(normalizeSupplierName('شركة   النُّخْبَة'), 'شركه النُّخْبَه');
  assert.equal(normalizeSupplierName('شركة النخبة'), normalizeSupplierName('شركه النخبه'));
  assert.equal(normalizeSupplierName('أحمد إسلام آفاق'), normalizeSupplierName('احمد اسلام افاق'));
  assert.equal(normalizeSupplierTaxNumber('310-111 2223-00003'), '310111222300003');

  // Duplicate normalized Arabic name
  const dupName = findDuplicateSupplier([existingSupOrgA], { name: 'شركه النخبه للتوريد' });
  assert.ok(dupName && dupName.field === 'name');

  // Duplicate tax number with dashes/spaces
  const dupTax = findDuplicateSupplier([existingSupOrgA], {
    name: 'اسم مختلف تماماً',
    taxNumber: '310-111-2223-00003',
  });
  assert.ok(dupTax && dupTax.field === 'taxNumber');

  // Same supplier excluded when editing self
  const notDupSelf = findDuplicateSupplier(
    [existingSupOrgA],
    { name: 'شركه النخبه للتوريد', taxNumber: '310-111-2223-00003' },
    existingSupOrgA.id
  );
  assert.equal(notDupSelf, null);

  // Invalid fields
  assert.equal(validateSupplierFormInput({ name: 'أ' }).ok, false);
  assert.equal(validateSupplierFormInput({ name: 'مورد صالح', taxNumber: '12' }).ok, false);
  assert.equal(validateSupplierFormInput({ name: 'مورد صالح', phone: '123' }).ok, false);
  assert.equal(validateSupplierFormInput({ name: 'مورد صالح', email: 'bad-email' }).ok, false);
  assert.equal(validateSupplierFormInput({ name: 'مورد صالح', openingBalance: -5 }).ok, false);
  assert.equal(validateSupplierFormInput({ name: 'مورد صالح', openingBalance: 10.123 }).ok, false);
  assert.equal(validateSupplierFormInput({ name: 'مورد صالح', openingBalance: '10.25' }).ok, true);
});

console.log('\n========================================================================');
console.log(`   SUMMARY: ${passed} passed, ${failed} failed`);
console.log('========================================================================');

if (failed > 0) {
  process.exit(1);
}
