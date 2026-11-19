/**
 * Supplier Management Service — الإقفال | AL EQFAL
 * Handles organization-isolated supplier listing, strict input & duplicate validation,
 * role-based CRUD (Manager: full CRUD + safe referential-integrity delete;
 * Authorized Supervisor: create-only; Branch Manager & Employee: zero supplier mutations),
 * and atomic Firestore batch writes with audit logs and notifications.
 */
import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, OperationType } from '../lib/firebase';
import type { AppNotification, AuditLog, Supplier, UserProfile } from '../types';
import { roundCurrency } from '../utils/accounting';
import { buildSupplierAddedNotification } from '../utils/notifications';
import {
  canUserCreateSupplier,
  canUserDeleteSupplier,
  canUserEditSupplier,
  canUserToggleSupplierStatus,
  resolveEffectivePermissions,
} from '../utils/permissions';

export interface SupplierFormInput {
  name: string;
  taxNumber?: string;
  phone?: string;
  address?: string;
  notes?: string;
  contactPerson?: string;
  companyName?: string;
  email?: string;
  openingBalance?: number | string;
}

export interface ValidatedSupplierFields {
  name: string;
  taxNumber?: string;
  phone?: string;
  address?: string;
  notes?: string;
  contactPerson?: string;
  companyName?: string;
  email?: string;
  openingBalance?: number;
}

export interface PreparedCreateSupplier {
  supplier: Supplier;
  auditLog: AuditLog;
  notification: AppNotification;
}

export interface PreparedUpdateSupplier {
  supplierId: string;
  updatedSupplier: Supplier;
  patch: Record<string, any>;
  clearedOptionalKeys: Array<
    'taxNumber' | 'phone' | 'address' | 'notes' | 'contactPerson' | 'companyName' | 'email' | 'openingBalance'
  >;
  auditLog: AuditLog;
}

export interface PreparedToggleSupplier {
  supplierId: string;
  nextIsActive: boolean;
  updatedAt: string;
  auditLog: AuditLog;
}

export interface PreparedDeleteSupplier {
  supplierId: string;
  auditLog: AuditLog;
}

const MAX_OPENING_BALANCE = 1_000_000_000_000;

function generateSafeFirestoreId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

/**
 * Normalizes Arabic/Latin supplier name for reliable duplicate detection within an organization.
 */
export function normalizeSupplierName(raw: string | undefined | null): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

/**
 * Normalizes tax registration number by stripping spaces and dashes for duplicate comparison.
 */
export function normalizeSupplierTaxNumber(raw: string | undefined | null): string {
  return (raw || '').trim().replace(/[\s-]+/g, '').toLowerCase();
}

export function findDuplicateSupplier(
  existingSuppliers: readonly Supplier[],
  candidate: { name: string; taxNumber?: string },
  excludeSupplierId?: string
): { field: 'name' | 'taxNumber'; existing: Supplier } | null {
  const normName = normalizeSupplierName(candidate.name);
  const normTax = normalizeSupplierTaxNumber(candidate.taxNumber);

  for (const sup of existingSuppliers) {
    if (excludeSupplierId && sup.id === excludeSupplierId) continue;

    if (normName && normalizeSupplierName(sup.name) === normName) {
      return { field: 'name', existing: sup };
    }
    if (normTax && normalizeSupplierTaxNumber(sup.taxNumber) === normTax) {
      return { field: 'taxNumber', existing: sup };
    }
  }
  return null;
}

export function validateSupplierFormInput(
  input: SupplierFormInput
): { ok: true; data: ValidatedSupplierFields } | { ok: false; error: string; field: string } {
  const name = (input.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    return {
      ok: false,
      field: 'name',
      error: 'يرجى إدخال اسم المورد (حرفين على الأقل).',
    };
  }
  if (name.length > 120) {
    return {
      ok: false,
      field: 'name',
      error: 'اسم المورد لا يمكن أن يتجاوز 120 حرفاً.',
    };
  }

  const taxNumber = (input.taxNumber || '').trim();
  if (taxNumber.length > 40) {
    return {
      ok: false,
      field: 'taxNumber',
      error: 'رقم التسجيل الضريبي لا يمكن أن يتجاوز 40 حرفاً.',
    };
  }
  if (taxNumber && !/^[0-9A-Za-z\-\s]{5,40}$/.test(taxNumber)) {
    return {
      ok: false,
      field: 'taxNumber',
      error: 'صيغة رقم التسجيل الضريبي غير صالحة (يجب أن يتكون من 5 أحرف أو أرقام على الأقل).',
    };
  }

  const phone = (input.phone || '').trim();
  if (phone.length > 25) {
    return {
      ok: false,
      field: 'phone',
      error: 'رقم الجوال لا يمكن أن يتجاوز 25 خانة.',
    };
  }
  if (phone && !/^[0-9+\-\s()]{7,25}$/.test(phone)) {
    return {
      ok: false,
      field: 'phone',
      error: 'صيغة رقم الجوال غير صالحة. يرجى إدخال رقم صحيح.',
    };
  }

  const address = (input.address || '').trim();
  if (address.length > 255) {
    return {
      ok: false,
      field: 'address',
      error: 'العنوان لا يمكن أن يتجاوز 255 حرفاً.',
    };
  }

  const notes = (input.notes || '').trim();
  if (notes.length > 1000) {
    return {
      ok: false,
      field: 'notes',
      error: 'الملاحظات لا يمكن أن تتجاوز 1000 حرف.',
    };
  }

  const contactPerson = (input.contactPerson || '').trim();
  if (contactPerson.length > 120) {
    return {
      ok: false,
      field: 'contactPerson',
      error: 'اسم الشخص المسؤول لا يمكن أن يتجاوز 120 حرفاً.',
    };
  }

  const companyName = (input.companyName || '').trim();
  if (companyName.length > 150) {
    return {
      ok: false,
      field: 'companyName',
      error: 'اسم الشركة لا يمكن أن يتجاوز 150 حرفاً.',
    };
  }

  const email = (input.email || '').trim();
  if (email.length > 254) {
    return {
      ok: false,
      field: 'email',
      error: 'البريد الإلكتروني لا يمكن أن يتجاوز 254 حرفاً.',
    };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      field: 'email',
      error: 'صيغة البريد الإلكتروني غير صالحة.',
    };
  }

  let openingBalance: number | undefined;
  const rawBal = input.openingBalance;
  if (rawBal !== undefined && rawBal !== null && String(rawBal).trim() !== '') {
    const strBal = String(rawBal).trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(strBal)) {
      return {
        ok: false,
        field: 'openingBalance',
        error: 'الرصيد الافتتاحي يجب أن يكون رقماً صالحاً.',
      };
    }
    const numBal = Number(strBal);
    if (!Number.isFinite(numBal) || numBal < 0) {
      return {
        ok: false,
        field: 'openingBalance',
        error: 'الرصيد الافتتاحي يجب أن يكون رقماً غير سالب.',
      };
    }
    if (numBal > MAX_OPENING_BALANCE) {
      return {
        ok: false,
        field: 'openingBalance',
        error: 'الرصيد الافتتاحي يتجاوز الحد المسموح به.',
      };
    }
    if (Math.abs(numBal * 100 - Math.round(numBal * 100)) >= 0.001) {
      return {
        ok: false,
        field: 'openingBalance',
        error: 'الرصيد الافتتاحي يجب ألا يتجاوز خانتين عشريتين (دقة الهللات).',
      };
    }
    openingBalance = roundCurrency(numBal);
  }

  return {
    ok: true,
    data: {
      name,
      ...(taxNumber ? { taxNumber } : {}),
      ...(phone ? { phone } : {}),
      ...(address ? { address } : {}),
      ...(notes ? { notes } : {}),
      ...(contactPerson ? { contactPerson } : {}),
      ...(companyName ? { companyName } : {}),
      ...(email ? { email } : {}),
      ...(openingBalance !== undefined ? { openingBalance } : {}),
    },
  };
}

function resolveActorName(userProfile: UserProfile): string {
  const raw = (userProfile.displayName || userProfile.email || 'مستخدم النظام').trim();
  return raw.length >= 2 ? raw.slice(0, 100) : 'مستخدم النظام';
}

/**
 * Pure domain validator & payload builder for creating a new supplier.
 * Allowed ONLY for active Organization Manager OR Supervisor explicitly granted `canManageSuppliers`.
 */
export function prepareCreateSupplier(params: {
  userProfile: UserProfile | null | undefined;
  orgId: string;
  input: SupplierFormInput;
  existingSuppliers?: readonly Supplier[];
  nowIso?: string;
  supplierId?: string;
}): { ok: true; data: PreparedCreateSupplier } | { ok: false; error: string; code: string } {
  const { userProfile, orgId, input, existingSuppliers = [] } = params;

  if (!userProfile || userProfile.isActive !== true) {
    return {
      ok: false,
      code: 'inactive_user',
      error: 'حسابك غير مفعل أو غير مصرح له بإجراء هذه العملية.',
    };
  }

  if (!orgId || userProfile.orgId !== orgId) {
    return {
      ok: false,
      code: 'org_mismatch',
      error: 'تعذر التحقق من انتماء المستخدم للمؤسسة.',
    };
  }

  if (!canUserCreateSupplier(userProfile)) {
    return {
      ok: false,
      code: 'permission_denied',
      error: 'لا تملك صلاحية إضافة مورد جديد. هذه الصلاحية متاحة لمدير المؤسسة أو المسؤول المخول فقط.',
    };
  }

  const validated = validateSupplierFormInput(input);
  if (!validated.ok) {
    return { ok: false, code: `invalid_${validated.field}`, error: validated.error };
  }

  const orgScopedExisting = existingSuppliers.filter((s) => s.orgId === orgId);
  const dup = findDuplicateSupplier(orgScopedExisting, validated.data);
  if (dup) {
    return {
      ok: false,
      code: dup.field === 'taxNumber' ? 'duplicate_tax_number' : 'duplicate_name',
      error:
        dup.field === 'taxNumber'
          ? `رقم التسجيل الضريبي مسجل مسبقاً للمورد "${dup.existing.name}".`
          : `يوجد مورد مسجل مسبقاً بنفس الاسم "${dup.existing.name}".`,
    };
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const supplierId = params.supplierId || generateSafeFirestoreId('sup');
  const actorName = resolveActorName(userProfile);

  const supplier: Supplier = {
    id: supplierId,
    orgId,
    name: validated.data.name,
    ...(validated.data.contactPerson ? { contactPerson: validated.data.contactPerson } : {}),
    ...(validated.data.companyName ? { companyName: validated.data.companyName } : {}),
    ...(validated.data.taxNumber ? { taxNumber: validated.data.taxNumber } : {}),
    ...(validated.data.phone ? { phone: validated.data.phone } : {}),
    ...(validated.data.email ? { email: validated.data.email } : {}),
    ...(validated.data.address ? { address: validated.data.address } : {}),
    ...(validated.data.notes ? { notes: validated.data.notes } : {}),
    ...(validated.data.openingBalance !== undefined
      ? { openingBalance: validated.data.openingBalance }
      : {}),
    isActive: true,
    createdBy: userProfile.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const auditLog: AuditLog = {
    id: generateSafeFirestoreId('log_sup_add'),
    orgId,
    actorId: userProfile.uid,
    actorName,
    actorRole: userProfile.role,
    action: 'SUPPLIER_CREATED',
    targetType: 'supplier',
    targetId: supplierId,
    details: `إضافة مورد جديد "${supplier.name}"${supplier.taxNumber ? ` (الرقم الضريبي: ${supplier.taxNumber})` : ''}`.slice(
      0,
      1000
    ),
    timestamp: nowIso,
  };

  const notification = buildSupplierAddedNotification({
    supplierId,
    orgId,
    supplierName: supplier.name,
    actorUid: userProfile.uid,
    actorName,
    actorRole: userProfile.role,
    createdAt: nowIso,
  });

  return {
    ok: true,
    data: { supplier, auditLog, notification },
  };
}

/**
 * Pure domain validator & payload builder for updating an existing supplier.
 * Allowed STRICTLY for Organization Manager only (Supervisor, Branch Manager, Employee DENIED).
 */
export function prepareUpdateSupplier(params: {
  userProfile: UserProfile | null | undefined;
  orgId: string;
  targetSupplier: Supplier | null | undefined;
  input: SupplierFormInput;
  existingSuppliers?: readonly Supplier[];
  nowIso?: string;
}): { ok: true; data: PreparedUpdateSupplier } | { ok: false; error: string; code: string } {
  const { userProfile, orgId, targetSupplier, input, existingSuppliers = [] } = params;

  if (!userProfile || userProfile.isActive !== true) {
    return {
      ok: false,
      code: 'inactive_user',
      error: 'حسابك غير مفعل أو غير مصرح له بإجراء هذه العملية.',
    };
  }

  if (!orgId || userProfile.orgId !== orgId) {
    return {
      ok: false,
      code: 'org_mismatch',
      error: 'تعذر التحقق من انتماء المستخدم للمؤسسة.',
    };
  }

  if (!canUserEditSupplier(userProfile)) {
    return {
      ok: false,
      code: 'permission_denied',
      error: 'تعديل بيانات الموردين متاح لمدير المؤسسة فقط.',
    };
  }

  if (!targetSupplier || !targetSupplier.id || targetSupplier.orgId !== orgId) {
    return {
      ok: false,
      code: 'supplier_not_in_org',
      error: 'المورد المطلوب غير موجود ضمن هذه المؤسسة.',
    };
  }

  const validated = validateSupplierFormInput(input);
  if (!validated.ok) {
    return { ok: false, code: `invalid_${validated.field}`, error: validated.error };
  }

  const orgScopedExisting = existingSuppliers.filter((s) => s.orgId === orgId);
  const dup = findDuplicateSupplier(orgScopedExisting, validated.data, targetSupplier.id);
  if (dup) {
    return {
      ok: false,
      code: dup.field === 'taxNumber' ? 'duplicate_tax_number' : 'duplicate_name',
      error:
        dup.field === 'taxNumber'
          ? `رقم التسجيل الضريبي مسجل مسبقاً للمورد "${dup.existing.name}".`
          : `يوجد مورد آخر مسجل بنفس الاسم "${dup.existing.name}".`,
    };
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = resolveActorName(userProfile);

  const optionalKeys = [
    'taxNumber',
    'phone',
    'address',
    'notes',
    'contactPerson',
    'companyName',
    'email',
    'openingBalance',
  ] as const;

  const patch: Record<string, any> = {
    name: validated.data.name,
    updatedAt: nowIso,
  };
  const clearedOptionalKeys: PreparedUpdateSupplier['clearedOptionalKeys'] = [];

  for (const key of optionalKeys) {
    const val = validated.data[key];
    if (val !== undefined) {
      patch[key] = val;
    } else if (targetSupplier[key] !== undefined) {
      clearedOptionalKeys.push(key);
    }
  }

  const updatedSupplier: Supplier = {
    id: targetSupplier.id,
    orgId: targetSupplier.orgId,
    name: validated.data.name,
    ...(validated.data.contactPerson ? { contactPerson: validated.data.contactPerson } : {}),
    ...(validated.data.companyName ? { companyName: validated.data.companyName } : {}),
    ...(validated.data.taxNumber ? { taxNumber: validated.data.taxNumber } : {}),
    ...(validated.data.phone ? { phone: validated.data.phone } : {}),
    ...(validated.data.email ? { email: validated.data.email } : {}),
    ...(validated.data.address ? { address: validated.data.address } : {}),
    ...(validated.data.notes ? { notes: validated.data.notes } : {}),
    ...(validated.data.openingBalance !== undefined
      ? { openingBalance: validated.data.openingBalance }
      : {}),
    isActive: targetSupplier.isActive,
    createdBy: targetSupplier.createdBy,
    createdAt: targetSupplier.createdAt,
    updatedAt: nowIso,
  };

  const auditLog: AuditLog = {
    id: generateSafeFirestoreId('log_sup_upd'),
    orgId,
    actorId: userProfile.uid,
    actorName,
    actorRole: userProfile.role,
    action: 'SUPPLIER_UPDATED',
    targetType: 'supplier',
    targetId: targetSupplier.id,
    details: `تعديل بيانات المورد "${targetSupplier.name}" إلى "${updatedSupplier.name}"`.slice(0, 1000),
    timestamp: nowIso,
  };

  return {
    ok: true,
    data: {
      supplierId: targetSupplier.id,
      updatedSupplier,
      patch,
      clearedOptionalKeys,
      auditLog,
    },
  };
}

/**
 * Pure domain validator & payload builder for toggling supplier active/inactive status.
 * Allowed STRICTLY for Organization Manager only.
 */
export function prepareToggleSupplierStatus(params: {
  userProfile: UserProfile | null | undefined;
  orgId: string;
  targetSupplier: Supplier | null | undefined;
  nextIsActive: boolean;
  nowIso?: string;
}): { ok: true; data: PreparedToggleSupplier } | { ok: false; error: string; code: string } {
  const { userProfile, orgId, targetSupplier, nextIsActive } = params;

  if (!userProfile || userProfile.isActive !== true) {
    return {
      ok: false,
      code: 'inactive_user',
      error: 'حسابك غير مفعل أو غير مصرح له بإجراء هذه العملية.',
    };
  }

  if (!orgId || userProfile.orgId !== orgId) {
    return {
      ok: false,
      code: 'org_mismatch',
      error: 'تعذر التحقق من انتماء المستخدم للمؤسسة.',
    };
  }

  if (!canUserToggleSupplierStatus(userProfile)) {
    return {
      ok: false,
      code: 'permission_denied',
      error: 'تغيير حالة المورد (تفعيل / إيقاف) متاح لمدير المؤسسة فقط.',
    };
  }

  if (!targetSupplier || !targetSupplier.id || targetSupplier.orgId !== orgId) {
    return {
      ok: false,
      code: 'supplier_not_in_org',
      error: 'المورد المطلوب غير موجود ضمن هذه المؤسسة.',
    };
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = resolveActorName(userProfile);

  const auditLog: AuditLog = {
    id: generateSafeFirestoreId('log_sup_tgl'),
    orgId,
    actorId: userProfile.uid,
    actorName,
    actorRole: userProfile.role,
    action: 'SUPPLIER_STATUS_TOGGLED',
    targetType: 'supplier',
    targetId: targetSupplier.id,
    details: `${nextIsActive ? 'إعادة تفعيل' : 'إيقاف'} المورد "${targetSupplier.name}"`.slice(0, 1000),
    timestamp: nowIso,
  };

  return {
    ok: true,
    data: {
      supplierId: targetSupplier.id,
      nextIsActive,
      updatedAt: nowIso,
      auditLog,
    },
  };
}

/**
 * Pure domain validator & payload builder for deleting a supplier with strict referential integrity.
 * - Allowed STRICTLY for Organization Manager only.
 * - Blocked if `linkedPurchasesCount > 0` to protect historical purchase invoices.
 */
export function prepareDeleteSupplier(params: {
  userProfile: UserProfile | null | undefined;
  orgId: string;
  targetSupplier: Supplier | null | undefined;
  linkedPurchasesCount: number;
  nowIso?: string;
}):
  | { ok: true; data: PreparedDeleteSupplier }
  | { ok: false; error: string; code: string; blockedByPurchases?: boolean; linkedPurchasesCount?: number } {
  const { userProfile, orgId, targetSupplier, linkedPurchasesCount } = params;

  if (!userProfile || userProfile.isActive !== true) {
    return {
      ok: false,
      code: 'inactive_user',
      error: 'حسابك غير مفعل أو غير مصرح له بإجراء هذه العملية.',
    };
  }

  if (!orgId || userProfile.orgId !== orgId) {
    return {
      ok: false,
      code: 'org_mismatch',
      error: 'تعذر التحقق من انتماء المستخدم للمؤسسة.',
    };
  }

  if (!canUserDeleteSupplier(userProfile)) {
    return {
      ok: false,
      code: 'permission_denied',
      error: 'حذف الموردين متاح لمدير المؤسسة فقط.',
    };
  }

  if (!targetSupplier || !targetSupplier.id || targetSupplier.orgId !== orgId) {
    return {
      ok: false,
      code: 'supplier_not_in_org',
      error: 'المورد المطلوب غير موجود ضمن هذه المؤسسة.',
    };
  }

  if (!Number.isFinite(linkedPurchasesCount) || linkedPurchasesCount < 0) {
    return {
      ok: false,
      code: 'integrity_check_failed',
      error: 'تعذر التحقق من فواتير المشتريات المرتبطة بهذا المورد. يرجى المحاولة مرة أخرى.',
    };
  }

  if (linkedPurchasesCount > 0) {
    return {
      ok: false,
      code: 'supplier_has_linked_purchases',
      blockedByPurchases: true,
      linkedPurchasesCount,
      error: `لا يمكن حذف المورد "${targetSupplier.name}" نهائياً لارتباطه بعدد (${linkedPurchasesCount}) فاتورة مشتريات مسجلة. حفاظاً على سلامة السجلات المحاسبية، يمكنك إيقاف المورد بدلاً من حذفه.`,
    };
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const actorName = resolveActorName(userProfile);

  const auditLog: AuditLog = {
    id: generateSafeFirestoreId('log_sup_del'),
    orgId,
    actorId: userProfile.uid,
    actorName,
    actorRole: userProfile.role,
    action: 'SUPPLIER_DELETED',
    targetType: 'supplier',
    targetId: targetSupplier.id,
    details: `حذف المورد "${targetSupplier.name}" نهائياً لعدم ارتباطه بأي فواتير مشتريات مسجلة`.slice(0, 1000),
    timestamp: nowIso,
  };

  return {
    ok: true,
    data: {
      supplierId: targetSupplier.id,
      auditLog,
    },
  };
}

function mapSupplierFirestoreError(err: unknown, operation: OperationType, path: string): Error {
  const code = (err as any)?.code || '';
  const rawMessage = err instanceof Error ? err.message : String(err);

  console.error('Supplier Firestore Operation Error:', {
    operation,
    path,
    code,
    message: rawMessage,
  });

  if (code === 'permission-denied' || rawMessage.toLowerCase().includes('permission')) {
    return new Error(
      'تم رفض العملية بواسطة قواعد الأمان. يرجى التحقق من صلاحياتك أو حالة اشتراك المؤسسة.'
    );
  }
  if (code === 'unavailable' || rawMessage.toLowerCase().includes('network')) {
    return new Error('تعذر الاتصال بالخادم حالياً. يرجى التحقق من الاتصال بالإنترنت والمحاولة مرة أخرى.');
  }
  return new Error(rawMessage || 'حدث خطأ غير متوقع أثناء تنفيذ العملية.');
}

/**
 * Fetches all organization suppliers for the Supplier Management directory.
 * Allowed ONLY for active Organization Manager OR Supervisor granted `canManageSuppliers`.
 * Branch Managers and Employees are strictly denied from supplier management views.
 */
export async function fetchOrgSuppliersForManagement(
  userProfile: UserProfile | null | undefined,
  orgId: string
): Promise<Supplier[]> {
  if (!userProfile || userProfile.isActive !== true || !orgId || userProfile.orgId !== orgId) {
    throw new Error('حسابك غير مصرح له بإدارة الموردين.');
  }

  const effective = resolveEffectivePermissions(userProfile);
  if (!effective.canCreateSuppliers) {
    throw new Error('إدارة الموردين متاحة لمدير المؤسسة أو المسؤول المخول بصلاحية الموردين فقط.');
  }

  try {
    const q = query(collection(db, 'suppliers'), where('orgId', '==', orgId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ ...(d.data() as Supplier), id: d.id }))
      .filter((s) => s.orgId === orgId)
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name, 'ar');
      });
  } catch (err) {
    throw mapSupplierFirestoreError(err, OperationType.LIST, 'suppliers');
  }
}

/**
 * Counts how many purchases in the organization reference a specific supplier.
 * Uses single-field orgId query to avoid requiring composite Firestore indexes.
 */
export async function countSupplierLinkedPurchases(
  userProfile: UserProfile | null | undefined,
  orgId: string,
  supplierId: string
): Promise<number> {
  if (!userProfile || userProfile.isActive !== true || !orgId || userProfile.orgId !== orgId) {
    throw new Error('حسابك غير مصرح له بالتحقق من فواتير المورد.');
  }
  if (!canUserDeleteSupplier(userProfile)) {
    throw new Error('التحقق من ارتباط المورد للحذف متاح لمدير المؤسسة فقط.');
  }

  try {
    const q = query(collection(db, 'purchases'), where('orgId', '==', orgId));
    const snap = await getDocs(q);
    let count = 0;
    for (const d of snap.docs) {
      const data = d.data() as { orgId?: string; supplierId?: string };
      if (data.orgId === orgId && data.supplierId === supplierId) {
        count += 1;
      }
    }
    return count;
  } catch (err) {
    throw mapSupplierFirestoreError(err, OperationType.LIST, 'purchases');
  }
}

export async function createSupplier(params: {
  userProfile: UserProfile | null | undefined;
  orgId: string;
  input: SupplierFormInput;
  existingSuppliers?: readonly Supplier[];
}): Promise<Supplier> {
  // Always cross-check against fresh org suppliers to prevent stale duplicate submissions
  const currentSuppliers =
    params.existingSuppliers ??
    (await fetchOrgSuppliersForManagement(params.userProfile, params.orgId));

  const prepared = prepareCreateSupplier({
    userProfile: params.userProfile,
    orgId: params.orgId,
    input: params.input,
    existingSuppliers: currentSuppliers,
  });

  if (!prepared.ok) {
    throw new Error(prepared.error);
  }

  const { supplier, auditLog, notification } = prepared.data;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'suppliers', supplier.id), supplier);
    batch.set(doc(db, 'auditLogs', auditLog.id), auditLog);
    batch.set(doc(db, 'notifications', notification.id), notification);
    await batch.commit();
    return supplier;
  } catch (err) {
    throw mapSupplierFirestoreError(err, OperationType.CREATE, `suppliers/${supplier.id}`);
  }
}

export async function updateSupplier(params: {
  userProfile: UserProfile | null | undefined;
  orgId: string;
  targetSupplier: Supplier;
  input: SupplierFormInput;
  existingSuppliers?: readonly Supplier[];
}): Promise<Supplier> {
  const prepared = prepareUpdateSupplier({
    userProfile: params.userProfile,
    orgId: params.orgId,
    targetSupplier: params.targetSupplier,
    input: params.input,
    existingSuppliers: params.existingSuppliers,
  });

  if (!prepared.ok) {
    throw new Error(prepared.error);
  }

  const { supplierId, updatedSupplier, patch, clearedOptionalKeys, auditLog } = prepared.data;
  const firestorePatch: Record<string, any> = { ...patch };
  for (const key of clearedOptionalKeys) {
    firestorePatch[key] = deleteField();
  }

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'suppliers', supplierId), firestorePatch);
    batch.set(doc(db, 'auditLogs', auditLog.id), auditLog);
    await batch.commit();
    return updatedSupplier;
  } catch (err) {
    throw mapSupplierFirestoreError(err, OperationType.UPDATE, `suppliers/${supplierId}`);
  }
}

export async function toggleSupplierStatus(params: {
  userProfile: UserProfile | null | undefined;
  orgId: string;
  targetSupplier: Supplier;
  nextIsActive: boolean;
}): Promise<Supplier> {
  const prepared = prepareToggleSupplierStatus(params);
  if (!prepared.ok) {
    throw new Error(prepared.error);
  }

  const { supplierId, nextIsActive, updatedAt, auditLog } = prepared.data;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'suppliers', supplierId), {
      isActive: nextIsActive,
      updatedAt,
    });
    batch.set(doc(db, 'auditLogs', auditLog.id), auditLog);
    await batch.commit();
    return {
      ...params.targetSupplier,
      isActive: nextIsActive,
      updatedAt,
    };
  } catch (err) {
    throw mapSupplierFirestoreError(err, OperationType.UPDATE, `suppliers/${supplierId}`);
  }
}

export type DeleteSupplierResult =
  | { deleted: true; supplierId: string }
  | { deleted: false; blockedByPurchases: true; linkedPurchasesCount: number; message: string };

export async function deleteSupplierSafely(params: {
  userProfile: UserProfile | null | undefined;
  orgId: string;
  targetSupplier: Supplier;
}): Promise<DeleteSupplierResult> {
  if (!canUserDeleteSupplier(params.userProfile)) {
    throw new Error('حذف الموردين متاح لمدير المؤسسة فقط.');
  }

  const linkedPurchasesCount = await countSupplierLinkedPurchases(
    params.userProfile,
    params.orgId,
    params.targetSupplier.id
  );

  const prepared = prepareDeleteSupplier({
    userProfile: params.userProfile,
    orgId: params.orgId,
    targetSupplier: params.targetSupplier,
    linkedPurchasesCount,
  });

  if (!prepared.ok) {
    if (prepared.blockedByPurchases) {
      return {
        deleted: false,
        blockedByPurchases: true,
        linkedPurchasesCount: prepared.linkedPurchasesCount ?? linkedPurchasesCount,
        message: prepared.error,
      };
    }
    throw new Error(prepared.error);
  }

  const { supplierId, auditLog } = prepared.data;

  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'suppliers', supplierId));
    batch.set(doc(db, 'auditLogs', auditLog.id), auditLog);
    await batch.commit();
    return { deleted: true, supplierId };
  } catch (err) {
    throw mapSupplierFirestoreError(err, OperationType.DELETE, `suppliers/${supplierId}`);
  }
}
