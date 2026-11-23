/**
 * Independent Branch Manager Supplier Creation Permission (`canCreateSuppliers`) — Unit & Contract Test Suite
 *
 * Covers all 9 mandatory verification scenarios:
 *  1. branch_manager WITH `canCreateSuppliers: true` CAN create a supplier (create-only).
 *  2. branch_manager WITHOUT `canCreateSuppliers` (`false` or omitted) CANNOT create a supplier.
 *  3. branch_manager CANNOT edit or toggle status of any supplier.
 *  4. branch_manager CANNOT delete any supplier.
 *  5. branch_manager CANNOT edit, toggle, or delete a supplier he created himself.
 *  6. branch_manager CAN select existing active suppliers AND his newly created supplier in purchase invoices.
 *  7. branch_manager CANNOT cross organization or branch boundaries.
 *  8. Organization manager and supervisor permissions remain completely unaffected.
 *  9. Legacy branch_manager profiles default strictly to `false`; switching role away from branch_manager clears `canCreateSuppliers` to `false`; UI/Auth wiring enforces exact defaults.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
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
import {
  buildSupplierCreatedAuditLogId,
  generateSortableSupplierId,
  prepareCreateSupplier,
  prepareDeleteSupplier,
  prepareToggleSupplierStatus,
  prepareUpdateSupplier,
} from '../services/supplierService';
import { preparePurchaseSubmission } from '../services/purchaseService';
import {
  buildReleasedMemberZeroPermissions,
  buildSuperAdminMemberUpdateBundle,
} from '../utils/superAdminGovernance';
import {
  buildNotificationId,
  buildSupplierAddedNotificationId,
  resolveTenantNotificationRoute,
} from '../utils/notifications';
import type { Branch, Organization, Supplier, UserProfile } from '../types';

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err?.message || err}`);
    failed++;
  }
}

const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';

const BRANCH_A1: Branch = {
  id: 'br_a1',
  orgId: ORG_A,
  name: 'فرع الرياض 1',
  code: 'RUH-01',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const BRANCH_A2: Branch = {
  id: 'br_a2',
  orgId: ORG_A,
  name: 'فرع جدة 2',
  code: 'JED-02',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const MANAGER_A: UserProfile = {
  uid: 'uid_mgr_a',
  orgId: ORG_A,
  email: 'mgr@alpha.test',
  displayName: 'مدير المؤسسة',
  role: 'manager',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('manager'),
  createdAt: '2026-01-01T00:00:00Z',
};

const SUPERVISOR_WITH_SUP: UserProfile = {
  uid: 'uid_sup_yes',
  orgId: ORG_A,
  email: 'sup.yes@alpha.test',
  displayName: 'مسؤول موردين',
  role: 'supervisor',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('supervisor', {
    canManageSuppliers: true,
    canManagePurchases: true,
  }),
  createdAt: '2026-01-01T00:00:00Z',
};

const SUPERVISOR_WITHOUT_SUP: UserProfile = {
  uid: 'uid_sup_no',
  orgId: ORG_A,
  email: 'sup.no@alpha.test',
  displayName: 'مسؤول بدون موردين',
  role: 'supervisor',
  isActive: true,
  permissions: buildDefaultPermissionsForRole('supervisor', {
    canViewSuppliers: true,
  }),
  createdAt: '2026-01-01T00:00:00Z',
};

const BM_ALLOWED: UserProfile = {
  uid: 'uid_bm_allowed',
  orgId: ORG_A,
  email: 'bm.yes@alpha.test',
  displayName: 'مسؤول فرع مخول بالموردين',
  role: 'branch_manager',
  branchId: BRANCH_A1.id,
  branchIds: [BRANCH_A1.id],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('branch_manager', undefined, {
    canCreateSuppliers: true,
  }),
  createdAt: '2026-01-01T00:00:00Z',
};

const BM_DENIED: UserProfile = {
  uid: 'uid_bm_denied',
  orgId: ORG_A,
  email: 'bm.no@alpha.test',
  displayName: 'مسؤول فرع افتراضي',
  role: 'branch_manager',
  branchId: BRANCH_A1.id,
  branchIds: [BRANCH_A1.id],
  isActive: true,
  permissions: buildDefaultPermissionsForRole('branch_manager'),
  createdAt: '2026-01-01T00:00:00Z',
};

const BM_LEGACY_NO_FIELD: UserProfile = {
  uid: 'uid_bm_legacy',
  orgId: ORG_A,
  email: 'bm.legacy@alpha.test',
  displayName: 'مسؤول فرع قديم',
  role: 'branch_manager',
  branchId: BRANCH_A1.id,
  isActive: true,
  permissions: {
    canCreateClosing: true,
    canViewAllClosings: false,
    canApproveClosings: false,
    canManageBranches: false,
    canManageEmployees: false,
    canExportReports: false,
    canManagePurchases: true,
    canManageSuppliers: false,
    canViewSuppliers: true,
    canViewFinancialReports: false,
    // Intentionally omits `canCreateSuppliers`
  },
  createdAt: '2025-05-01T00:00:00Z',
};

const EMPLOYEE_A: UserProfile = {
  uid: 'uid_emp_a',
  orgId: ORG_A,
  email: 'emp@alpha.test',
  displayName: 'موظف فرع',
  role: 'employee',
  branchId: BRANCH_A1.id,
  isActive: true,
  permissions: buildDefaultPermissionsForRole('employee'),
  createdAt: '2026-01-01T00:00:00Z',
};

const EXISTING_SUPPLIER_A: Supplier = {
  id: 'sup_existing_a',
  orgId: ORG_A,
  name: 'شركة الرواد للأغذية',
  taxNumber: '310111222300003',
  phone: '0551112233',
  isActive: true,
  createdBy: MANAGER_A.uid,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const EXISTING_SUPPLIER_B: Supplier = {
  id: 'sup_existing_b',
  orgId: ORG_B,
  name: 'شركة مؤسسة أخرى',
  isActive: true,
  createdBy: 'uid_mgr_b',
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

console.log('========================================================================');
console.log('   BRANCH MANAGER CAN_CREATE_SUPPLIERS — UNIT & CONTRACT TEST SUITE     ');
console.log('========================================================================\n');

// ---------------------------------------------------------------------------
// 1. branch_manager WITH canCreateSuppliers: true CAN add a supplier
// ---------------------------------------------------------------------------
let bmSelfCreatedSupplier: Supplier | null = null;

runTest('1. branch_manager WITH canCreateSuppliers: true can create supplier via prepareCreateSupplier while canManageSuppliers stays false', () => {
  assert.equal(BM_ALLOWED.permissions.canCreateSuppliers, true);
  assert.equal(BM_ALLOWED.permissions.canManageSuppliers, false);

  const eff = resolveEffectivePermissions(BM_ALLOWED);
  assert.equal(eff.canCreateSuppliers, true);
  assert.equal(eff.canManageSuppliers, false);
  assert.equal(eff.canEditSuppliers, false);
  assert.equal(eff.canToggleSuppliersStatus, false);
  assert.equal(eff.canDeleteSuppliers, false);
  assert.equal(canUserCreateSupplier(BM_ALLOWED), true);

  const res = prepareCreateSupplier({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    existingSuppliers: [EXISTING_SUPPLIER_A],
    input: {
      name: 'مورد فرع الرياض الجديد',
      companyName: 'مؤسسة التوريد السريع',
      taxNumber: '310999888700003',
      phone: '0559998877',
      address: 'الرياض - حي الملقا',
      notes: 'مضاف بواسطة مسؤول الفرع',
    },
    supplierId: 'sup_bm_created_1',
    nowIso: '2026-11-20T10:00:00Z',
  });

  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.supplier.id, 'sup_bm_created_1');
  assert.equal(res.data.supplier.orgId, ORG_A);
  assert.equal(res.data.supplier.isActive, true);
  assert.equal(res.data.supplier.createdBy, BM_ALLOWED.uid);
  assert.equal(res.data.auditLog.action, 'SUPPLIER_CREATED');
  assert.equal(res.data.auditLog.actorRole, 'branch_manager');
  assert.equal(res.data.notification.type, 'SUPPLIER_ADDED');
  assert.equal(res.data.notification.actorRole, 'branch_manager');
  assert.equal(res.data.notification.targetId, 'sup_bm_created_1');

  bmSelfCreatedSupplier = res.data.supplier;
});

// ---------------------------------------------------------------------------
// 2. branch_manager WITHOUT canCreateSuppliers CANNOT add a supplier
// ---------------------------------------------------------------------------
runTest('2. branch_manager WITHOUT canCreateSuppliers (default false) is strictly denied supplier creation', () => {
  assert.equal(BM_DENIED.permissions.canCreateSuppliers, false);
  assert.equal(BM_DENIED.permissions.canManageSuppliers, false);
  assert.equal(canUserCreateSupplier(BM_DENIED), false);

  const res = prepareCreateSupplier({
    userProfile: BM_DENIED,
    orgId: ORG_A,
    existingSuppliers: [EXISTING_SUPPLIER_A],
    input: { name: 'مورد غير مصرح' },
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'permission_denied');
  }
});

runTest('2b. Tampered branch_manager with canManageSuppliers: true but canCreateSuppliers: false is STILL denied', () => {
  const tamperedBm: UserProfile = {
    ...BM_DENIED,
    permissions: {
      ...BM_DENIED.permissions,
      canManageSuppliers: true,
      canCreateSuppliers: false,
    },
  };
  const eff = resolveEffectivePermissions(tamperedBm);
  assert.equal(eff.canManageSuppliers, false);
  assert.equal(eff.canCreateSuppliers, false);
  assert.equal(canUserCreateSupplier(tamperedBm), false);
});

// ---------------------------------------------------------------------------
// 3 & 4. branch_manager CANNOT edit, toggle status, or delete ANY supplier
// ---------------------------------------------------------------------------
runTest('3. branch_manager (even WITH canCreateSuppliers: true) CANNOT edit or toggle status of any supplier', () => {
  assert.equal(canUserEditSupplier(BM_ALLOWED), false);
  assert.equal(canUserToggleSupplierStatus(BM_ALLOWED), false);

  const editRes = prepareUpdateSupplier({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    targetSupplier: EXISTING_SUPPLIER_A,
    existingSuppliers: [EXISTING_SUPPLIER_A],
    input: { name: 'محاولة تعديل مورد' },
  });
  assert.equal(editRes.ok, false);
  if (!editRes.ok) assert.equal(editRes.code, 'permission_denied');

  const toggleRes = prepareToggleSupplierStatus({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    targetSupplier: EXISTING_SUPPLIER_A,
    nextIsActive: false,
  });
  assert.equal(toggleRes.ok, false);
  if (!toggleRes.ok) assert.equal(toggleRes.code, 'permission_denied');
});

runTest('4. branch_manager (even WITH canCreateSuppliers: true) CANNOT delete any supplier', () => {
  assert.equal(canUserDeleteSupplier(BM_ALLOWED), false);

  const delRes = prepareDeleteSupplier({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    targetSupplier: EXISTING_SUPPLIER_A,
    linkedPurchasesCount: 0,
  });
  assert.equal(delRes.ok, false);
  if (!delRes.ok) assert.equal(delRes.code, 'permission_denied');
});

// ---------------------------------------------------------------------------
// 5. branch_manager CANNOT edit, toggle, or delete a supplier he created himself
// ---------------------------------------------------------------------------
runTest('5. branch_manager CANNOT edit, toggle status, or delete a supplier he created himself (createdBy === bm.uid)', () => {
  assert.ok(bmSelfCreatedSupplier, 'Expected bmSelfCreatedSupplier from Test 1');
  assert.equal(bmSelfCreatedSupplier!.createdBy, BM_ALLOWED.uid);

  const editSelf = prepareUpdateSupplier({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    targetSupplier: bmSelfCreatedSupplier!,
    existingSuppliers: [EXISTING_SUPPLIER_A, bmSelfCreatedSupplier!],
    input: { name: 'تعديل موردي الشخصي' },
  });
  assert.equal(editSelf.ok, false);
  if (!editSelf.ok) assert.equal(editSelf.code, 'permission_denied');

  const toggleSelf = prepareToggleSupplierStatus({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    targetSupplier: bmSelfCreatedSupplier!,
    nextIsActive: false,
  });
  assert.equal(toggleSelf.ok, false);
  if (!toggleSelf.ok) assert.equal(toggleSelf.code, 'permission_denied');

  const delSelf = prepareDeleteSupplier({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    targetSupplier: bmSelfCreatedSupplier!,
    linkedPurchasesCount: 0,
  });
  assert.equal(delSelf.ok, false);
  if (!delSelf.ok) assert.equal(delSelf.code, 'permission_denied');
});

// ---------------------------------------------------------------------------
// 6. branch_manager CAN use existing active suppliers AND his newly created supplier in purchases
// ---------------------------------------------------------------------------
runTest('6. branch_manager CAN select existing active suppliers and his newly created supplier in purchase invoices', () => {
  assert.ok(bmSelfCreatedSupplier);
  assert.equal(canUserSelectSupplierForPurchase(BM_ALLOWED, EXISTING_SUPPLIER_A), true);
  assert.equal(canUserSelectSupplierForPurchase(BM_ALLOWED, bmSelfCreatedSupplier!), true);
  assert.equal(canUserSelectSupplierForPurchase(BM_DENIED, EXISTING_SUPPLIER_A), true);
  assert.equal(canUserSelectSupplierForPurchase(BM_DENIED, bmSelfCreatedSupplier!), true);

  const purchaseWithNewSup = preparePurchaseSubmission({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    branch: BRANCH_A1,
    supplier: bmSelfCreatedSupplier!,
    currency: 'SAR',
    date: '2026-11-20',
    invoiceNumber: 'INV-BM-100',
    paymentMethod: 'cash',
    vatRate: 15,
    items: [{ name: 'خضار طازجة', quantity: 2, unitPrice: 50 }],
    nowIso: '2026-11-20T11:00:00Z',
  });
  assert.equal(purchaseWithNewSup.ok, true);

  const purchaseWithExistingSup = preparePurchaseSubmission({
    userProfile: BM_DENIED,
    orgId: ORG_A,
    branch: BRANCH_A1,
    supplier: EXISTING_SUPPLIER_A,
    currency: 'SAR',
    date: '2026-11-20',
    invoiceNumber: 'INV-BM-101',
    paymentMethod: 'transfer',
    vatRate: 15,
    items: [{ name: 'مواد تموينية', quantity: 1, unitPrice: 200 }],
    nowIso: '2026-11-20T11:05:00Z',
  });
  assert.equal(purchaseWithExistingSup.ok, true);
});

// ---------------------------------------------------------------------------
// 7. Cross-org & cross-branch boundaries strictly enforced
// ---------------------------------------------------------------------------
runTest('7. branch_manager CANNOT cross organization or branch boundaries', () => {
  // Cross-org supplier create
  const crossOrgCreate = prepareCreateSupplier({
    userProfile: BM_ALLOWED,
    orgId: ORG_B,
    existingSuppliers: [],
    input: { name: 'مورد عبر مؤسسة أخرى' },
  });
  assert.equal(crossOrgCreate.ok, false);
  if (!crossOrgCreate.ok) assert.equal(crossOrgCreate.code, 'org_mismatch');

  // Cross-org supplier selection
  assert.equal(canUserSelectSupplierForPurchase(BM_ALLOWED, EXISTING_SUPPLIER_B), false);

  // Cross-branch purchase creation
  assert.equal(canUserCreatePurchase(BM_ALLOWED, BRANCH_A2.id), false);
  const crossBranchPurchase = preparePurchaseSubmission({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    branch: BRANCH_A2,
    supplier: EXISTING_SUPPLIER_A,
    currency: 'SAR',
    date: '2026-11-20',
    invoiceNumber: 'INV-CROSS-BR',
    paymentMethod: 'cash',
    vatRate: 15,
    items: [{ name: 'بند', quantity: 1, unitPrice: 50 }],
  });
  assert.equal(crossBranchPurchase.ok, false);

  // Multi-branch / unassigned branch_manager fails closed
  const unassignedBm: UserProfile = {
    ...BM_ALLOWED,
    branchId: undefined,
    branchIds: [],
  };
  assert.equal(canUserCreateSupplier(unassignedBm), false);

  const multiBranchBm: UserProfile = {
    ...BM_ALLOWED,
    branchId: BRANCH_A1.id,
    branchIds: [BRANCH_A1.id, BRANCH_A2.id],
  };
  assert.equal(canUserCreateSupplier(multiBranchBm), false);
});

// ---------------------------------------------------------------------------
// 8. Manager & Supervisor permissions completely unaffected
// ---------------------------------------------------------------------------
runTest('8. Manager and Supervisor (with/without canManageSuppliers) permissions are completely unaffected', () => {
  // Manager
  assert.equal(canUserCreateSupplier(MANAGER_A), true);
  assert.equal(canUserEditSupplier(MANAGER_A), true);
  assert.equal(canUserToggleSupplierStatus(MANAGER_A), true);
  assert.equal(canUserDeleteSupplier(MANAGER_A), true);

  // Supervisor WITH canManageSuppliers
  assert.equal(SUPERVISOR_WITH_SUP.permissions.canManageSuppliers, true);
  assert.equal(SUPERVISOR_WITH_SUP.permissions.canCreateSuppliers, false);
  assert.equal(canUserCreateSupplier(SUPERVISOR_WITH_SUP), true);
  assert.equal(canUserEditSupplier(SUPERVISOR_WITH_SUP), false);
  assert.equal(canUserToggleSupplierStatus(SUPERVISOR_WITH_SUP), false);
  assert.equal(canUserDeleteSupplier(SUPERVISOR_WITH_SUP), false);

  // Supervisor WITHOUT canManageSuppliers (even if tampered with canCreateSuppliers: true)
  assert.equal(canUserCreateSupplier(SUPERVISOR_WITHOUT_SUP), false);
  const tamperedSupervisor: UserProfile = {
    ...SUPERVISOR_WITHOUT_SUP,
    permissions: {
      ...SUPERVISOR_WITHOUT_SUP.permissions,
      canManageSuppliers: false,
      canCreateSuppliers: true,
    },
  };
  assert.equal(canUserCreateSupplier(tamperedSupervisor), false);

  // Employee (even if tampered with canCreateSuppliers: true)
  const tamperedEmployee: UserProfile = {
    ...EMPLOYEE_A,
    permissions: {
      ...EMPLOYEE_A.permissions,
      canCreateSuppliers: true,
    },
  };
  assert.equal(canUserCreateSupplier(tamperedEmployee), false);
});

// ---------------------------------------------------------------------------
// 9. Backward compatibility, role-switching cleanup, notification routing & UI/Auth contracts
// ---------------------------------------------------------------------------
runTest('9a. Legacy branch_manager without canCreateSuppliers field defaults strictly to false (not auto-granted)', () => {
  assert.equal(BM_LEGACY_NO_FIELD.permissions.canCreateSuppliers, undefined);
  assert.equal(canUserCreateSupplier(BM_LEGACY_NO_FIELD), false);
  assert.equal(canUserSelectSupplierForPurchase(BM_LEGACY_NO_FIELD, EXISTING_SUPPLIER_A), true);

  const res = prepareCreateSupplier({
    userProfile: BM_LEGACY_NO_FIELD,
    orgId: ORG_A,
    existingSuppliers: [EXISTING_SUPPLIER_A],
    input: { name: 'مورد غير مصرح لقدامى مسؤولي الفروع' },
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'permission_denied');
});

runTest('9b. Switching role away from branch_manager clears canCreateSuppliers to false; released zero-perms sets it false', () => {
  const switchedToEmployee = buildDefaultPermissionsForRole('employee', undefined, {
    canCreateSuppliers: true,
  });
  assert.equal(switchedToEmployee.canCreateSuppliers, false);

  const switchedToSupervisor = buildDefaultPermissionsForRole(
    'supervisor',
    { canManagePurchases: true },
    { canCreateSuppliers: true }
  );
  assert.equal(switchedToSupervisor.canCreateSuppliers, false);
  assert.equal(switchedToSupervisor.canManageSuppliers, false);

  const releasedZero = buildReleasedMemberZeroPermissions();
  assert.equal(releasedZero.canCreateSuppliers, false);
});

runTest('9c. Notification routing allows suppliers tab ONLY for authorized branch_manager and denies default branch_manager', () => {
  const allowedRoute = resolveTenantNotificationRoute({
    target: { surface: 'tenant', tab: 'suppliers', entityId: 'sup_bm_created_1' },
    userProfile: BM_ALLOWED,
  });
  assert.equal(allowedRoute.roleGroup, 'staff');
  assert.equal(allowedRoute.staffTab, 'suppliers');

  const deniedRoute = resolveTenantNotificationRoute({
    target: { surface: 'tenant', tab: 'suppliers', entityId: 'sup_bm_created_1' },
    userProfile: BM_DENIED,
  });
  assert.equal(deniedRoute.roleGroup, 'staff');
  assert.equal(deniedRoute.staffTab, 'workspace');
});

runTest('9d. EmployeesManager UI & AuthContext contracts enforce exact option wording, branch_manager-only visibility, and default=false', () => {
  const empMgrSource = fs.readFileSync('src/components/manager/EmployeesManager.tsx', 'utf8');
  assert.ok(empMgrSource.includes('السماح لمسؤول الفرع بإضافة موردين؟'));
  assert.ok(empMgrSource.includes('نعم، السماح بإضافة موردين'));
  assert.ok(empMgrSource.includes('لا، منع إضافة موردين'));
  assert.ok(empMgrSource.includes("createRole === 'branch_manager'"));
  assert.ok(empMgrSource.includes("editRole === 'branch_manager'"));
  assert.ok(empMgrSource.includes('useState<boolean>(false)'));
  assert.ok(empMgrSource.includes('setCreateBranchMgrCanCreateSuppliers(false)'));
  assert.ok(empMgrSource.includes('setEditBranchMgrCanCreateSuppliers(false)'));

  const authSource = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
  assert.ok(authSource.includes("targetRole === 'branch_manager' ? data.branchManagerPermissions : undefined"));
  assert.ok(authSource.includes("data.role === 'branch_manager' ? data.branchManagerPermissions : undefined"));
});

// ---------------------------------------------------------------------------
// 10. Super Admin member update preserves `canCreateSuppliers` cleanly
// ---------------------------------------------------------------------------
runTest('10. Super Admin administrative update preserves canCreateSuppliers: true for branch_manager, never auto-grants, and clears on role switch', () => {
  const superAdminActor = {
    uid: 'uid_super_admin',
    email: 'amoal2030@gmail.com',
    emailVerified: true,
    displayName: 'المدير الرئيسي',
  };
  const orgObj: Organization = {
    id: ORG_A,
    name: 'مؤسسة أ',
    ownerId: 'uid_mgr_a',
    ownerEmail: 'mgr@org-a.test',
    ownerName: 'مدير المؤسسة أ',
    activityType: 'retail',
    currency: 'SAR',
    driveConnected: false,
    isActive: true,
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
  };
  const deleteSentinel = { __sentinel: 'deleteField' };

  // 10a. Editing branch_manager name/phone/branch preserves canCreateSuppliers: true
  const preservedNamePhone = buildSuperAdminMemberUpdateBundle({
    actor: superAdminActor,
    org: orgObj,
    existingMember: BM_ALLOWED,
    orgBranches: [BRANCH_A1, BRANCH_A2],
    displayName: 'مسؤول فرع أ1 (محدّث)',
    phone: '0559990011',
    role: 'branch_manager',
    branchId: BRANCH_A2.id,
    deleteFieldSentinel: deleteSentinel,
  });
  assert.equal(preservedNamePhone.action, 'MEMBER_BRANCH_CHANGED');
  assert.equal((preservedNamePhone.userPatch.permissions as UserProfile['permissions']).canCreateSuppliers, true);

  // 10b. Editing branch_manager with canCreateSuppliers: false keeps it strictly false (no auto-grant)
  const keptFalse = buildSuperAdminMemberUpdateBundle({
    actor: superAdminActor,
    org: orgObj,
    existingMember: BM_DENIED,
    orgBranches: [BRANCH_A1, BRANCH_A2],
    displayName: 'مسؤول فرع غير مخول (محدّث)',
    phone: '0558880022',
    role: 'branch_manager',
    branchId: BRANCH_A1.id,
    deleteFieldSentinel: deleteSentinel,
  });
  assert.equal(keptFalse.action, 'MEMBER_UPDATED');
  assert.equal((keptFalse.userPatch.permissions as UserProfile['permissions']).canCreateSuppliers, false);

  // 10c. Editing legacy branch_manager (omitted canCreateSuppliers) keeps it strictly false
  const legacyBm: UserProfile = {
    ...BM_DENIED,
    uid: 'uid_bm_legacy_sa',
    permissions: {
      ...BM_DENIED.permissions,
    },
  };
  delete (legacyBm.permissions as unknown as Record<string, unknown>).canCreateSuppliers;
  const legacyKeptFalse = buildSuperAdminMemberUpdateBundle({
    actor: superAdminActor,
    org: orgObj,
    existingMember: legacyBm,
    orgBranches: [BRANCH_A1, BRANCH_A2],
    displayName: 'مسؤول فرع قديم (محدّث)',
    role: 'branch_manager',
    branchId: BRANCH_A1.id,
    deleteFieldSentinel: deleteSentinel,
  });
  assert.equal((legacyKeptFalse.userPatch.permissions as UserProfile['permissions']).canCreateSuppliers, false);

  // 10d. Promoting employee to branch_manager defaults canCreateSuppliers strictly to false (never auto-granted)
  const empProfile: UserProfile = {
    uid: 'uid_emp_promote',
    orgId: ORG_A,
    email: 'emp.promote@org-a.test',
    displayName: 'موظف للترقية',
    role: 'employee',
    branchId: BRANCH_A1.id,
    branchName: BRANCH_A1.name,
    isActive: true,
    permissions: buildDefaultPermissionsForRole('employee'),
    createdAt: '2026-11-01T08:00:00Z',
  };
  const promotedToBm = buildSuperAdminMemberUpdateBundle({
    actor: superAdminActor,
    org: orgObj,
    existingMember: empProfile,
    orgBranches: [BRANCH_A1, BRANCH_A2],
    displayName: 'موظف للترقية',
    role: 'branch_manager',
    branchId: BRANCH_A1.id,
    deleteFieldSentinel: deleteSentinel,
  });
  assert.equal(promotedToBm.action, 'MEMBER_ROLE_CHANGED');
  assert.equal((promotedToBm.userPatch.permissions as UserProfile['permissions']).canCreateSuppliers, false);

  // 10e. Switching branch_manager (with canCreateSuppliers: true) to employee or supervisor clears canCreateSuppliers to false
  const switchedToEmp = buildSuperAdminMemberUpdateBundle({
    actor: superAdminActor,
    org: orgObj,
    existingMember: BM_ALLOWED,
    orgBranches: [BRANCH_A1, BRANCH_A2],
    displayName: BM_ALLOWED.displayName,
    role: 'employee',
    branchId: BRANCH_A1.id,
    deleteFieldSentinel: deleteSentinel,
  });
  assert.equal((switchedToEmp.userPatch.permissions as UserProfile['permissions']).canCreateSuppliers, false);

  const switchedToSup = buildSuperAdminMemberUpdateBundle({
    actor: superAdminActor,
    org: orgObj,
    existingMember: BM_ALLOWED,
    orgBranches: [BRANCH_A1, BRANCH_A2],
    displayName: BM_ALLOWED.displayName,
    role: 'supervisor',
    supervisorPermissions: { canManagePurchases: true },
    deleteFieldSentinel: deleteSentinel,
  });
  assert.equal((switchedToSup.userPatch.permissions as UserProfile['permissions']).canCreateSuppliers, false);

  // 10f. Explicit override to revoke canCreateSuppliers on branch_manager is honored
  const explicitlyRevoked = buildSuperAdminMemberUpdateBundle({
    actor: superAdminActor,
    org: orgObj,
    existingMember: BM_ALLOWED,
    orgBranches: [BRANCH_A1, BRANCH_A2],
    displayName: BM_ALLOWED.displayName,
    role: 'branch_manager',
    branchId: BRANCH_A1.id,
    branchManagerPermissions: { canCreateSuppliers: false },
    deleteFieldSentinel: deleteSentinel,
  });
  assert.equal((explicitlyRevoked.userPatch.permissions as UserProfile['permissions']).canCreateSuppliers, false);
});

// ---------------------------------------------------------------------------
// 11. Deterministic 1-to-1 SUPPLIER_CREATED & SUPPLIER_ADDED IDs + Sort Order
// ---------------------------------------------------------------------------
runTest('11. Deterministic 1-to-1 IDs for SUPPLIER_CREATED & SUPPLIER_ADDED sort newest-first alongside standard notifications', () => {
  const tOlder = '2026-11-20T09:00:00.000Z';
  const tNewer = '2026-11-20T10:00:00.000Z';

  const supOlder = prepareCreateSupplier({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    existingSuppliers: [EXISTING_SUPPLIER_A],
    input: { name: 'مورد أقدم' },
    nowIso: tOlder,
  });
  const supNewer = prepareCreateSupplier({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    existingSuppliers: [EXISTING_SUPPLIER_A],
    input: { name: 'مورد أحدث' },
    nowIso: tNewer,
  });

  assert.equal(supOlder.ok, true);
  assert.equal(supNewer.ok, true);
  if (!supOlder.ok || !supNewer.ok) return;

  // Canonical 1-to-1 deterministic IDs bound to supplierId
  assert.equal(supOlder.data.auditLog.id, buildSupplierCreatedAuditLogId(supOlder.data.supplier.id));
  assert.equal(supOlder.data.notification.id, buildSupplierAddedNotificationId(supOlder.data.supplier.id));
  assert.equal(supNewer.data.auditLog.id, buildSupplierCreatedAuditLogId(supNewer.data.supplier.id));
  assert.equal(supNewer.data.notification.id, buildSupplierAddedNotificationId(supNewer.data.supplier.id));

  // Newest-first lexicographic order under ascending orderBy(documentId(), 'asc')
  assert.ok(supNewer.data.notification.id < supOlder.data.notification.id);
  const regularMidNotifId = buildNotificationId('purchase:pur_mid', '2026-11-20T09:30:00.000Z');
  assert.ok(supNewer.data.notification.id < regularMidNotifId);
  assert.ok(regularMidNotifId < supOlder.data.notification.id);

  // Generated sortable supplier IDs stay well under Firestore 128-char ID limit
  const generatedId = generateSortableSupplierId(tNewer);
  assert.ok(generatedId.startsWith('sup_'));
  assert.ok(buildSupplierCreatedAuditLogId(generatedId).length <= 128);
  assert.ok(buildSupplierAddedNotificationId(generatedId).length <= 128);

  // Oversized supplierId (>100 chars) rejected cleanly so derived IDs never exceed 128 chars
  const tooLongRes = prepareCreateSupplier({
    userProfile: BM_ALLOWED,
    orgId: ORG_A,
    existingSuppliers: [],
    input: { name: 'مورد بمعرف طويل جداً' },
    supplierId: `sup_${'a'.repeat(110)}`,
  });
  assert.equal(tooLongRes.ok, false);
  if (!tooLongRes.ok) {
    assert.equal(tooLongRes.code, 'invalid_supplier_id');
  }
});

console.log('\n========================================================================');
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
console.log('========================================================================');

if (failed > 0) {
  process.exit(1);
}
