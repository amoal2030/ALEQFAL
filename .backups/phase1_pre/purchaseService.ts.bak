/**
 * Purchase Invoice Service — الإقفال | AL EQFAL
 * Handles supplier lookup, strict client+domain validation, and atomic multi-document
 * Firestore batch commits for Purchase Invoices (1..100 subcollection line items,
 * multiple linked attachments, audit log, and role-scoped notification).
 */
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, OperationType } from '../lib/firebase';
import type {
  AttachmentItem,
  AuditLog,
  AppNotification,
  Branch,
  Purchase,
  PurchasePaymentMethod,
  PurchaseSubLineItem,
  Supplier,
  UserProfile,
} from '../types';
import {
  calculatePurchaseTotals,
  MAX_PURCHASE_ATTACHMENT_BYTES,
  MAX_PURCHASE_INVOICE_ATTACHMENTS,
  MAX_PURCHASE_INVOICE_ITEMS,
  PurchaseCalculations,
  PurchaseLineItemInput,
} from '../utils/accounting';
import { buildPurchaseRecordedNotification } from '../utils/notifications';
import {
  canUserCreatePurchase,
  canUserSelectSupplierForPurchase,
  resolveEffectivePermissions,
  resolvePrimaryAssignedBranchId,
} from '../utils/permissions';

export const ALLOWED_PURCHASE_ATTACHMENT_MIME_PREFIXES = ['image/'] as const;
export const ALLOWED_PURCHASE_ATTACHMENT_EXACT_MIMES = [
  'application/pdf',
] as const;

export const VALID_PAYMENT_METHODS: readonly PurchasePaymentMethod[] = [
  'cash',
  'card',
  'transfer',
  'credit',
] as const;

export interface PurchaseAttachmentDescriptor {
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface PreparePurchaseSubmissionInput {
  userProfile: UserProfile | null | undefined;
  orgId: string;
  currency: string;
  branch: Branch | null | undefined;
  supplier: Supplier | null | undefined;
  date: string;
  invoiceNumber?: string;
  taxNumber?: string;
  paymentMethod: PurchasePaymentMethod;
  items: PurchaseLineItemInput[];
  discountAmount?: number | string;
  vatRate?: number | string;
  notes?: string;
  attachments?: PurchaseAttachmentDescriptor[];
  nowIso?: string;
  purchaseId?: string;
}

export interface PreparedPurchaseSubmission {
  purchase: Purchase;
  subItems: PurchaseSubLineItem[];
  attachments: AttachmentItem[];
  auditLog: AuditLog;
  notification: AppNotification;
  calculations: PurchaseCalculations;
}

export interface SavedPurchaseRecord {
  purchase: Purchase;
  itemsCount: number;
  attachmentsCount: number;
}

function generateSafeFirestoreId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function isValidCalendarDateString(dateStr: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isAllowedPurchaseAttachmentFile(file: {
  name?: string;
  fileName?: string;
  size?: number;
  fileSize?: number;
  type?: string;
  mimeType?: string;
}): { valid: true; normalizedMime: string; normalizedName: string; size: number } | { valid: false; error: string } {
  const rawName = (file.fileName ?? file.name ?? '').trim();
  if (!rawName) {
    return { valid: false, error: 'اسم الملف المرفق غير صالح.' };
  }
  if (rawName.length > 255) {
    return { valid: false, error: `اسم الملف "${rawName.slice(0, 30)}..." يتجاوز الحد المسموح (255 حرفاً).` };
  }

  const size = typeof file.fileSize === 'number' ? file.fileSize : typeof file.size === 'number' ? file.size : -1;
  if (!Number.isFinite(size) || size < 0) {
    return { valid: false, error: `حجم الملف "${rawName}" غير صالح.` };
  }
  if (size > MAX_PURCHASE_ATTACHMENT_BYTES) {
    return { valid: false, error: `حجم الملف "${rawName}" يتجاوز الحد الأقصى المسموح (50 ميجابايت).` };
  }

  const rawMime = (file.mimeType ?? file.type ?? '').trim().toLowerCase();
  const lowerName = rawName.toLowerCase();
  let effectiveMime = rawMime;

  if (!effectiveMime) {
    if (lowerName.endsWith('.pdf')) effectiveMime = 'application/pdf';
    else if (lowerName.endsWith('.png')) effectiveMime = 'image/png';
    else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) effectiveMime = 'image/jpeg';
    else if (lowerName.endsWith('.webp')) effectiveMime = 'image/webp';
    else if (lowerName.endsWith('.gif')) effectiveMime = 'image/gif';
    else if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) effectiveMime = 'image/heic';
  }

  if (effectiveMime.length > 100) {
    return { valid: false, error: `نوع الملف "${rawName}" غير مدعوم.` };
  }

  const isAllowed =
    ALLOWED_PURCHASE_ATTACHMENT_EXACT_MIMES.includes(effectiveMime as 'application/pdf') ||
    ALLOWED_PURCHASE_ATTACHMENT_MIME_PREFIXES.some((prefix) => effectiveMime.startsWith(prefix));

  if (!isAllowed) {
    return {
      valid: false,
      error: `الملف "${rawName}" غير مدعوم. يُسمح فقط بالصور (JPG/PNG/WEBP) وملفات PDF.`,
    };
  }

  return {
    valid: true,
    normalizedMime: effectiveMime,
    normalizedName: rawName,
    size: Math.floor(size),
  };
}

export function formatPurchaseValidationError(code: string): string {
  if (code === 'items_exceed_max_limit') {
    return `الحد الأقصى المسموح للأصناف في الفاتورة الواحدة هو ${MAX_PURCHASE_INVOICE_ITEMS} صنف.`;
  }
  if (code === 'purchase_items_or_subtotal_required') {
    return 'يجب إضافة صنف واحد على الأقل في الفاتورة.';
  }
  if (code === 'discount_exceeds_subtotal') {
    return 'لا يمكن أن يتجاوز مبلغ الخصم المجموع الفرعي للأصناف.';
  }
  if (code === 'discount_must_be_non_negative' || code === 'invalid_discount') {
    return 'قيمة الخصم يجب أن تكون رقماً غير سالب.';
  }
  if (code === 'discount_precision_exceeded') {
    return 'قيمة الخصم يجب ألا تتجاوز خانتين عشريتين (دقة الهللات).';
  }
  if (code === 'vat_rate_must_be_non_negative' || code === 'invalid_vat_rate') {
    return 'نسبة الضريبة يجب أن تكون رقماً غير سالب.';
  }
  if (code === 'vat_rate_exceeds_100') {
    return 'نسبة الضريبة لا يمكن أن تتجاوز 100%.';
  }
  if (code === 'vat_rate_precision_exceeded') {
    return 'نسبة الضريبة يجب ألا تتجاوز خانتين عشريتين (مثال: 15 أو 5.50).';
  }
  if (code === 'subtotal_exceeds_max' || code === 'total_exceeds_max') {
    return 'إجمالي الفاتورة يتجاوز الحد المسموح به.';
  }

  const rowMatch = /^item_(\d+)_(.+)$/.exec(code);
  if (rowMatch) {
    const rowNum = Number(rowMatch[1]) + 1;
    const reason = rowMatch[2];
    switch (reason) {
      case 'name_required':
        return `السطر رقم ${rowNum}: يرجى إدخال اسم الصنف.`;
      case 'name_too_long':
        return `السطر رقم ${rowNum}: اسم الصنف يتجاوز 200 حرف.`;
      case 'quantity_must_be_positive':
      case 'invalid_quantity':
        return `السطر رقم ${rowNum}: الكمية يجب أن تكون أكبر من صفر.`;
      case 'quantity_exceeds_max':
        return `السطر رقم ${rowNum}: الكمية تتجاوز الحد المسموح.`;
      case 'unit_price_must_be_non_negative':
      case 'invalid_unit_price':
        return `السطر رقم ${rowNum}: سعر الوحدة يجب أن يكون رقماً غير سالب.`;
      case 'unit_price_precision_exceeded':
        return `السطر رقم ${rowNum}: سعر الوحدة يجب ألا يتجاوز خانتين عشريتين (دقة الهللات).`;
      case 'unit_price_exceeds_max':
      case 'total_exceeds_max':
        return `السطر رقم ${rowNum}: المبلغ يتجاوز الحد المسموح.`;
      default:
        return `السطر رقم ${rowNum}: يرجى التحقق من صحة بيانات الصنف.`;
    }
  }

  return 'يرجى التحقق من صحة بيانات الفاتورة قبل الحفظ.';
}

/**
 * Pure domain validator & Firestore payload builder.
 * Mirrors firestore.rules 1-to-1 so unauthorized or malformed writes fail before touching the network.
 */
export function preparePurchaseSubmission(
  input: PreparePurchaseSubmissionInput
): { ok: true; data: PreparedPurchaseSubmission } | { ok: false; error: string; errors: string[] } {
  const { userProfile, orgId, branch, supplier } = input;

  if (!userProfile || userProfile.isActive !== true) {
    return {
      ok: false,
      error: 'حسابك غير مفعل أو غير مصرح له بإجراء هذه العملية.',
      errors: ['inactive_or_missing_user'],
    };
  }

  if (!orgId || userProfile.orgId !== orgId) {
    return {
      ok: false,
      error: 'تعذر التحقق من انتماء المستخدم للمؤسسة.',
      errors: ['org_mismatch'],
    };
  }

  if (!canUserCreatePurchase(userProfile)) {
    return {
      ok: false,
      error: 'لا تملك صلاحية إدخال فواتير المشتريات.',
      errors: ['purchase_permission_denied'],
    };
  }

  if (!branch || !branch.id) {
    return {
      ok: false,
      error: 'يرجى اختيار الفرع المرتبط بفاتورة المشتريات.',
      errors: ['branch_required'],
    };
  }

  if (branch.orgId !== orgId || branch.isActive === false || branch.lifecycleStatus === 'purged_from_db') {
    return {
      ok: false,
      error: 'الفرع المختار غير نشط أو لا ينتمي لهذه المؤسسة.',
      errors: ['invalid_branch'],
    };
  }

  if (!canUserCreatePurchase(userProfile, branch.id)) {
    return {
      ok: false,
      error: 'غير مصرح لك بإدخال فواتير مشتريات لهذا الفرع. يمكنك الإدخال لفرعك المعيّن فقط.',
      errors: ['branch_scope_denied'],
    };
  }

  if (!supplier || !supplier.id) {
    return {
      ok: false,
      error: 'يرجى اختيار المورد من قائمة الموردين المسجلين.',
      errors: ['supplier_required'],
    };
  }

  if (!canUserSelectSupplierForPurchase(userProfile, supplier)) {
    return {
      ok: false,
      error:
        supplier.isActive !== true
          ? 'لا يمكن استخدام مورد موقوف. يرجى اختيار مورد نشط.'
          : 'غير مصرح لك باختيار هذا المورد أو لا تملك صلاحية عرض الموردين.',
      errors: ['supplier_selection_denied'],
    };
  }

  const cleanDate = (input.date || '').trim();
  if (!isValidCalendarDateString(cleanDate)) {
    return {
      ok: false,
      error: 'تاريخ الفاتورة غير صحيح. يرجى اختيار تاريخ صالح بصيغة YYYY-MM-DD.',
      errors: ['invalid_date'],
    };
  }

  if (!VALID_PAYMENT_METHODS.includes(input.paymentMethod)) {
    return {
      ok: false,
      error: 'طريقة الدفع المختارة غير صالحة.',
      errors: ['invalid_payment_method'],
    };
  }

  const cleanInvoiceNumber = (input.invoiceNumber || '').trim();
  if (cleanInvoiceNumber.length > 80) {
    return {
      ok: false,
      error: 'رقم الفاتورة لا يمكن أن يتجاوز 80 حرفاً.',
      errors: ['invoice_number_too_long'],
    };
  }

  const cleanTaxNumber = (input.taxNumber || '').trim();
  if (cleanTaxNumber.length > 40) {
    return {
      ok: false,
      error: 'الرقم الضريبي لا يمكن أن يتجاوز 40 حرفاً.',
      errors: ['tax_number_too_long'],
    };
  }

  const cleanNotes = (input.notes || '').trim();
  if (cleanNotes.length > 1000) {
    return {
      ok: false,
      error: 'الملاحظات لا يمكن أن تتجاوز 1000 حرف.',
      errors: ['notes_too_long'],
    };
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return {
      ok: false,
      error: 'يجب إضافة صنف واحد على الأقل في جدول الأصناف.',
      errors: ['items_required'],
    };
  }

  if (input.items.length > MAX_PURCHASE_INVOICE_ITEMS) {
    return {
      ok: false,
      error: `الحد الأقصى المسموح به هو ${MAX_PURCHASE_INVOICE_ITEMS} صنف في الفاتورة الواحدة.`,
      errors: ['items_exceed_max_limit'],
    };
  }

  const normalizedItemInputs: PurchaseLineItemInput[] = input.items.map((row, idx) => ({
    id: `item_${idx}`,
    name: row.name,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
  }));

  const calc = calculatePurchaseTotals({
    items: normalizedItemInputs,
    discountAmount: input.discountAmount,
    vatRate: input.vatRate,
    maxItems: MAX_PURCHASE_INVOICE_ITEMS,
  });

  if (!calc.isValid) {
    return {
      ok: false,
      error: formatPurchaseValidationError(calc.errors[0]),
      errors: calc.errors,
    };
  }

  const rawAttachments = input.attachments || [];
  if (rawAttachments.length > MAX_PURCHASE_INVOICE_ATTACHMENTS) {
    return {
      ok: false,
      error: `الحد الأقصى المسموح به للمرفقات في الفاتورة الواحدة هو ${MAX_PURCHASE_INVOICE_ATTACHMENTS} ملفاً.`,
      errors: ['attachments_exceed_max_limit'],
    };
  }

  const nowIso = input.nowIso || new Date().toISOString();
  const purchaseId = input.purchaseId || generateSafeFirestoreId('pur');
  const actorNameRaw = (userProfile.displayName || userProfile.email || 'مستخدم').trim();
  const actorName = actorNameRaw.length >= 2 ? actorNameRaw.slice(0, 100) : 'مستخدم النظام';
  const safeBranchName = branch.name.trim().slice(0, 120);
  const safeSupplierName = supplier.name.trim().slice(0, 120);

  const attachmentDocs: AttachmentItem[] = [];
  for (let i = 0; i < rawAttachments.length; i += 1) {
    const validated = isAllowedPurchaseAttachmentFile(rawAttachments[i]);
    if (!validated.valid) {
      return {
        ok: false,
        error: validated.error,
        errors: [`attachment_${i}_invalid`],
      };
    }
    const attId = generateSafeFirestoreId(`att_pur_${i}`);
    attachmentDocs.push({
      id: attId,
      orgId,
      branchId: branch.id,
      purchaseId,
      fileName: validated.normalizedName,
      fileSize: validated.size,
      mimeType: validated.normalizedMime,
      fileUrl: '',
      uploadedBy: userProfile.uid,
      uploadedByName: actorName.slice(0, 120),
      uploadedAt: nowIso,
    });
  }

  // Note:
  // - All line items (1..100) are persisted uniformly in `/purchases/{purchaseId}/items/item_0..item_{n-1}`.
  // - All attachments (0..20) are persisted in `/attachments/{attId}` linked via `purchaseId`.
  // - When attachments.length === 1, we also set `attachmentIds: [att0.id]` for single-attachment compatibility.
  const purchase: Purchase = {
    id: purchaseId,
    orgId,
    branchId: branch.id,
    branchName: safeBranchName,
    supplierId: supplier.id,
    supplierName: safeSupplierName,
    ...(cleanTaxNumber ? { taxNumber: cleanTaxNumber } : {}),
    ...(cleanInvoiceNumber ? { invoiceNumber: cleanInvoiceNumber } : {}),
    date: cleanDate,
    amount: calc.subtotalAmount,
    subtotalAmount: calc.subtotalAmount,
    discountAmount: calc.discountAmount,
    vatRate: calc.vatRate,
    vatAmount: calc.vatAmount,
    totalAmount: calc.totalAmount,
    paymentMethod: input.paymentMethod,
    ...(cleanNotes ? { notes: cleanNotes } : {}),
    ...(attachmentDocs.length === 1 ? { attachmentIds: [attachmentDocs[0].id] } : {}),
    createdBy: userProfile.uid,
    createdByName: actorName.slice(0, 120),
    createdByRole: userProfile.role,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const subItems: PurchaseSubLineItem[] = calc.items.map((item, idx) => ({
    id: `item_${idx}`,
    purchaseId,
    orgId,
    branchId: branch.id,
    lineIndex: idx,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: item.total,
    createdBy: userProfile.uid,
    createdAt: nowIso,
  }));

  const invoiceRefLabel = cleanInvoiceNumber ? `رقم ${cleanInvoiceNumber} ` : '';
  const auditDetails =
    `تسجيل فاتورة مشتريات ${invoiceRefLabel}من المورد "${safeSupplierName}" لفرع "${safeBranchName}" بعدد ${subItems.length} صنف ومرفقات ${attachmentDocs.length} بإجمالي ${calc.totalAmount.toFixed(2)} ${input.currency || 'SAR'}`.slice(
      0,
      1000
    );

  const auditLog: AuditLog = {
    id: generateSafeFirestoreId('log_pur'),
    orgId,
    actorId: userProfile.uid,
    actorName,
    actorRole: userProfile.role,
    action: 'PURCHASE_CREATED',
    targetType: 'purchase',
    targetId: purchaseId,
    details: auditDetails,
    timestamp: nowIso,
  };

  const notification = buildPurchaseRecordedNotification({
    purchaseId,
    orgId,
    branchId: branch.id,
    branchName: safeBranchName,
    supplierName: safeSupplierName,
    totalAmount: calc.totalAmount,
    currency: input.currency || 'SAR',
    actorUid: userProfile.uid,
    actorName,
    actorRole: userProfile.role,
    createdAt: nowIso,
  });

  return {
    ok: true,
    data: {
      purchase,
      subItems,
      attachments: attachmentDocs,
      auditLog,
      notification,
      calculations: calc,
    },
  };
}

function mapPurchaseFirestoreError(err: unknown, operation: OperationType, path: string): Error {
  const code = (err as any)?.code || '';
  const rawMessage = err instanceof Error ? err.message : String(err);

  console.error('Purchase Firestore Operation Error:', {
    operation,
    path,
    code,
    message: rawMessage,
  });

  if (code === 'permission-denied' || rawMessage.toLowerCase().includes('permission')) {
    return new Error(
      'تم رفض العملية بواسطة قواعد الأمان. يرجى التحقق من صلاحياتك أو حالة الاشتراك أو نشاط المورد والفرع.'
    );
  }
  if (code === 'unavailable' || rawMessage.toLowerCase().includes('network')) {
    return new Error('تعذر الاتصال بالخادم حالياً. يرجى التحقق من الاتصال بالإنترنت والمحاولة مرة أخرى.');
  }
  return new Error(rawMessage || 'حدث خطأ غير متوقع أثناء تنفيذ العملية.');
}

/**
 * Fetches active pre-registered suppliers for the organization according to caller permissions.
 */
export async function fetchSelectableSuppliers(
  userProfile: UserProfile | null | undefined,
  orgId: string
): Promise<Supplier[]> {
  if (!userProfile || !userProfile.isActive || !orgId || userProfile.orgId !== orgId) {
    throw new Error('حسابك غير مصرح له بعرض الموردين.');
  }

  const effective = resolveEffectivePermissions(userProfile);
  if (!effective.canViewSuppliers) {
    throw new Error(
      'لا تملك صلاحية عرض قائمة الموردين المسجلين. يرجى التواصل مع مدير المؤسسة لتفعيل صلاحية «عرض الموردين».'
    );
  }

  try {
    const q = query(collection(db, 'suppliers'), where('orgId', '==', orgId));
    const snap = await getDocs(q);
    const list: Supplier[] = snap.docs
      .map((d) => ({ ...(d.data() as Supplier), id: d.id }))
      .filter((s) => s.orgId === orgId && s.isActive === true)
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    return list;
  } catch (err) {
    throw mapPurchaseFirestoreError(err, OperationType.LIST, 'suppliers');
  }
}

/**
 * Fetches recent purchase invoices scoped strictly to the user's allowed org/branch scope.
 */
export async function fetchRecentPurchases(
  userProfile: UserProfile | null | undefined,
  orgId: string,
  maxItems = 8
): Promise<Purchase[]> {
  if (!userProfile || !userProfile.isActive || !orgId || userProfile.orgId !== orgId) {
    return [];
  }

  const effective = resolveEffectivePermissions(userProfile);
  if (!effective.canManagePurchases) {
    return [];
  }

  try {
    const constraints = [where('orgId', '==', orgId)];
    if (userProfile.role === 'branch_manager') {
      const assignedBranchId = resolvePrimaryAssignedBranchId(userProfile);
      if (!assignedBranchId) return [];
      constraints.push(where('branchId', '==', assignedBranchId));
    }

    const q = query(collection(db, 'purchases'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ ...(d.data() as Purchase), id: d.id }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, maxItems);
  } catch (err) {
    throw mapPurchaseFirestoreError(err, OperationType.LIST, 'purchases');
  }
}

/**
 * Atomically saves a complete Purchase Invoice:
 * - /purchases/{purchaseId}
 * - /purchases/{purchaseId}/items/item_0 .. item_{n-1} (1..100 items)
 * - /attachments/{attId} (0..20 linked attachments)
 * - /auditLogs/{logId} (PURCHASE_CREATED)
 * - /notifications/{notifId} (PURCHASE_INVOICE_RECORDED)
 * All in ONE Firestore writeBatch (<= 123 writes, well below the 500-op Firestore batch limit).
 */
export async function savePurchaseInvoice(
  input: PreparePurchaseSubmissionInput
): Promise<PreparedPurchaseSubmission> {
  const prepared = preparePurchaseSubmission(input);
  if (!prepared.ok) {
    throw new Error(prepared.error);
  }

  const { purchase, subItems, attachments, auditLog, notification } = prepared.data;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'purchases', purchase.id), purchase);

    for (const item of subItems) {
      batch.set(doc(db, 'purchases', purchase.id, 'items', item.id), item);
    }

    for (const att of attachments) {
      batch.set(doc(db, 'attachments', att.id), att);
    }

    batch.set(doc(db, 'auditLogs', auditLog.id), auditLog);
    batch.set(doc(db, 'notifications', notification.id), notification);

    await batch.commit();
    return prepared.data;
  } catch (err) {
    throw mapPurchaseFirestoreError(err, OperationType.CREATE, `purchases/${purchase.id}`);
  }
}
