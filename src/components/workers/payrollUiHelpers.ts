import type {
  PayrollAuditAction,
  PayrollDisbursementStatus,
  PayrollPaymentMethod,
  PayrollProofSyncStatus,
  WorkerAdditionCategory,
  WorkerAdditionStatus,
  WorkerStatus,
} from '../../types/workersPayroll';

export const ALLOWED_PAYROLL_PROOF_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const MAX_PAYROLL_PROOF_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

export function validatePayrollProofFile(
  file: File,
  isAr: boolean
): { valid: true } | { valid: false; message: string } {
  if (!ALLOWED_PAYROLL_PROOF_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      message: isAr
        ? 'نوع الملف غير مدعوم؛ الصيغ المسموحة هي PDF وJPG وPNG وWEBP فقط.'
        : 'Unsupported file type; allowed formats are PDF, JPG, PNG, and WEBP only.',
    };
  }
  if (file.size <= 0 || file.size > MAX_PAYROLL_PROOF_FILE_BYTES) {
    return {
      valid: false,
      message: isAr
        ? 'حجم الملف يجب أن يكون أكبر من صفر وألا يتجاوز 8 ميجابايت.'
        : 'File size must be greater than 0 and not exceed 8 MB.',
    };
  }
  return { valid: true };
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentYearMonth(): string {
  return getTodayIsoDate().slice(0, 7);
}

export function formatFileSizeShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function generateClientRequestKey(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export function getWorkerStatusLabel(status: WorkerStatus, isAr: boolean): string {
  if (status === 'active') return isAr ? 'نشط' : 'Active';
  if (status === 'suspended') return isAr ? 'موقوف مؤقتاً' : 'Suspended';
  return isAr ? 'منتهي الخدمة' : 'Terminated';
}

export function getPaymentMethodLabel(method: PayrollPaymentMethod, isAr: boolean): string {
  return method === 'cash'
    ? isAr
      ? 'نقدي'
      : 'Cash'
    : isAr
    ? 'تحويل بنكي'
    : 'Bank Transfer';
}

export function getAdditionCategoryLabel(category: WorkerAdditionCategory, isAr: boolean): string {
  const map: Record<WorkerAdditionCategory, { ar: string; en: string }> = {
    performance_bonus: { ar: 'مكافأة أداء', en: 'Performance Bonus' },
    exceptional_bonus: { ar: 'مكافأة استثنائية', en: 'Exceptional Bonus' },
    transport_allowance: { ar: 'بدل نقل', en: 'Transport Allowance' },
    housing_allowance: { ar: 'بدل سكن', en: 'Housing Allowance' },
    extra_allowance: { ar: 'العمل الإضافي / بدل إضافي', en: 'Overtime / Extra Allowance' },
    custom: { ar: 'إضافة مخصصة', en: 'Custom Addition' },
  };
  return isAr ? map[category].ar : map[category].en;
}

export function getAdditionStatusLabel(status: WorkerAdditionStatus, isAr: boolean): string {
  if (status === 'active') return isAr ? 'ساري' : 'Active';
  if (status === 'stopped') return isAr ? 'متوقف' : 'Stopped';
  return isAr ? 'ملغى' : 'Cancelled';
}

export function getDisbursementStatusLabel(
  status: PayrollDisbursementStatus,
  isAr: boolean
): string {
  if (status === 'paid') return isAr ? 'مدفوع بالكامل' : 'Paid in Full';
  if (status === 'partially_paid') return isAr ? 'مدفوع جزئياً' : 'Partially Paid';
  return isAr ? 'لم يُصرف' : 'Unpaid';
}

export function getProofSyncStatusLabel(status: PayrollProofSyncStatus, isAr: boolean): string {
  if (status === 'uploaded') return isAr ? 'محفوظ في Google Drive' : 'Synced to Google Drive';
  if (status === 'pending_drive_sync')
    return isAr ? 'بانتظار الرفع إلى Google Drive' : 'Pending Google Drive Upload';
  if (status === 'sync_failed')
    return isAr ? 'تعذر الرفع — قابل لإعادة المحاولة' : 'Upload Failed — Retry Ready';
  return isAr ? 'نُقل إلى سلة مهملات Drive' : 'Moved to Drive Trash';
}

export function getAuditActionLabel(action: PayrollAuditAction, isAr: boolean): string {
  const map: Record<PayrollAuditAction, { ar: string; en: string }> = {
    WORKER_CREATED: { ar: 'إضافة عامل', en: 'Worker Created' },
    WORKER_UPDATED: { ar: 'تحديث بيانات عامل', en: 'Worker Updated' },
    WORKER_BRANCH_TRANSFERRED: { ar: 'نقل عامل بين الفروع', en: 'Worker Transferred' },
    WORKER_STATUS_CHANGED: { ar: 'تغيير حالة عامل', en: 'Worker Status Changed' },
    WORKER_ADVANCE_RECORDED: { ar: 'تسجيل سحبية', en: 'Advance Recorded' },
    WORKER_ADVANCE_UPDATED: { ar: 'تعديل سحبية', en: 'Advance Updated' },
    WORKER_ADVANCE_CANCELLED: { ar: 'إلغاء سحبية', en: 'Advance Cancelled' },
    WORKER_ADVANCE_PROOF_SYNCED: { ar: 'رفع إثبات سحبية إلى Drive', en: 'Advance Proof Synced' },
    WORKER_ADVANCE_PROOF_TRASHED: { ar: 'نقل إثبات سحبية إلى السلة', en: 'Advance Proof Trashed' },
    WORKER_ADDITION_CREATED: { ar: 'إضافة مكافأة/بدل', en: 'Addition Created' },
    WORKER_ADDITION_UPDATED: { ar: 'تعديل مكافأة/بدل', en: 'Addition Updated' },
    WORKER_ADDITION_STOPPED: { ar: 'إيقاف إضافة متكررة', en: 'Addition Stopped' },
    WORKER_ADDITION_CANCELLED: { ar: 'إلغاء إضافة', en: 'Addition Cancelled' },
    PAYROLL_RUN_DRAFT_GENERATED: { ar: 'توليد مسودة تصفية شهرية', en: 'Payroll Draft Generated' },
    PAYROLL_RUN_APPROVED: { ar: 'اعتماد تصفية الرواتب', en: 'Payroll Run Approved' },
    PAYROLL_ITEM_ADMIN_CORRECTED: { ar: 'تصحيح إداري لكشف معتمد', en: 'Admin Payroll Correction' },
    PAYROLL_PAYMENT_RECORDED: { ar: 'تسجيل صرف راتب', en: 'Salary Payment Recorded' },
    PAYROLL_PAYMENT_REVERSED: { ar: 'عكس دفعة راتب', en: 'Salary Payment Reversed' },
    PAYROLL_PAYMENT_PROOF_SYNCED: { ar: 'رفع إثبات صرف إلى Drive', en: 'Payment Proof Synced' },
    PAYROLL_PAYMENT_PROOF_TRASHED: { ar: 'نقل إثبات صرف إلى السلة', en: 'Payment Proof Trashed' },
  };
  return isAr ? map[action].ar : map[action].en;
}

export function triggerBlobFileDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName || 'document';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
