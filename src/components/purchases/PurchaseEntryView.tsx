import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import type {
  Purchase,
  PurchaseAttachmentDraft,
  PurchasePaymentMethod,
  Supplier,
} from '../../types';
import {
  calculatePurchaseTotals,
  formatCurrency,
  fromHalalas,
  MAX_PURCHASE_INVOICE_ATTACHMENTS,
  MAX_PURCHASE_INVOICE_ITEMS,
  toHalalas,
} from '../../utils/accounting';
import {
  canUserCreatePurchase,
  canUserCreateSupplier,
  getUserRoleLabel,
  resolveEffectivePermissions,
  resolvePrimaryAssignedBranchId,
} from '../../utils/permissions';
import {
  fetchRecentPurchases,
  fetchSelectableSuppliers,
  formatPurchaseValidationError,
  isAllowedPurchaseAttachmentFile,
  savePurchaseInvoice,
} from '../../services/purchaseService';
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  FileText,
  Hash,
  Image as ImageIcon,
  Lock,
  Paperclip,
  Plus,
  Receipt,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';

interface DraftLineItem {
  rowKey: string;
  name: string;
  quantity: string;
  unitPrice: string;
}

type VatMode = '15' | '0' | 'custom';

interface SavedSessionBanner {
  purchaseId: string;
  invoiceNumber?: string;
  supplierName: string;
  branchName: string;
  itemsCount: number;
  attachmentsCount: number;
  totalAmount: number;
}

function createEmptyLineItem(): DraftLineItem {
  const key =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    rowKey: key,
    name: '',
    quantity: '1',
    unitPrice: '',
  };
}

function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const PAYMENT_METHOD_OPTIONS: Array<{ value: PurchasePaymentMethod; label: string }> = [
  { value: 'cash', label: 'نقداً' },
  { value: 'card', label: 'شبكة / بطاقة' },
  { value: 'transfer', label: 'تحويل بنكي' },
  { value: 'credit', label: 'آجل' },
];

export interface PurchaseEntryViewProps {
  onOpenSuppliers?: () => void;
  initialBranchId?: string;
}

export const PurchaseEntryView: React.FC<PurchaseEntryViewProps> = ({
  onOpenSuppliers,
  initialBranchId,
}) => {
  const { userProfile, currentOrg, branches, currentBranch } = useAuth();
  const { language } = useLanguage();

  const currency = currentOrg?.currency || 'SAR';
  const effectivePerms = useMemo(
    () => resolveEffectivePermissions(userProfile),
    [userProfile]
  );
  const canCreateSuppliers = useMemo(
    () => canUserCreateSupplier(userProfile),
    [userProfile]
  );

  const canEnterPurchases = useMemo(
    () => canUserCreatePurchase(userProfile),
    [userProfile]
  );

  const canSelectAnyBranch = effectivePerms.hasOrgWideBranchScope;
  const assignedBranchId = useMemo(
    () => resolvePrimaryAssignedBranchId(userProfile),
    [userProfile]
  );

  const selectableBranches = useMemo(
    () =>
      branches.filter(
        (b) => b.isActive !== false && b.lifecycleStatus !== 'purged_from_db'
      ),
    [branches]
  );

  // Branch selection state
  const [selectedBranchId, setSelectedBranchId] = useState<string>(() => {
    if (!canSelectAnyBranch) {
      return assignedBranchId || '';
    }
    return currentBranch?.id || selectableBranches[0]?.id || '';
  });

  useEffect(() => {
    if (!canSelectAnyBranch) {
      const lockedId = assignedBranchId || '';
      if (selectedBranchId !== lockedId) {
        setSelectedBranchId(lockedId);
      }
      return;
    }
    if (
      selectableBranches.length > 0 &&
      !selectableBranches.some((b) => b.id === selectedBranchId)
    ) {
      setSelectedBranchId(currentBranch?.id || selectableBranches[0].id);
    }
  }, [canSelectAnyBranch, assignedBranchId, currentBranch?.id, selectableBranches, selectedBranchId]);

  // Preserve real branchId passed from notification for org-wide Supervisor ONLY
  // (Branch Manager remains strictly locked to assignedBranchId above).
  useEffect(() => {
    if (!canSelectAnyBranch || !initialBranchId) return;
    if (selectableBranches.some((b) => b.id === initialBranchId)) {
      setSelectedBranchId(initialBranchId);
    }
  }, [canSelectAnyBranch, initialBranchId, selectableBranches]);

  const effectiveBranch = useMemo(() => {
    if (!canSelectAnyBranch) {
      if (!assignedBranchId) return null;
      return (
        selectableBranches.find((b) => b.id === assignedBranchId) ||
        (currentBranch &&
        currentBranch.id === assignedBranchId &&
        currentBranch.isActive !== false &&
        currentBranch.lifecycleStatus !== 'purged_from_db'
          ? currentBranch
          : null)
      );
    }
    return (
      selectableBranches.find((b) => b.id === selectedBranchId) ||
      selectableBranches[0] ||
      null
    );
  }, [canSelectAnyBranch, assignedBranchId, currentBranch, selectableBranches, selectedBranchId]);

  // Suppliers state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState<boolean>(false);
  const [suppliersError, setSuppliersError] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState<string>('');

  // Recent purchases confirmation list
  const [recentPurchases, setRecentPurchases] = useState<Purchase[]>([]);
  const [recentLoading, setRecentLoading] = useState<boolean>(false);

  // Invoice header form fields
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [date, setDate] = useState<string>(() => getTodayIsoDate());
  const [taxNumber, setTaxNumber] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('cash');
  const [notes, setNotes] = useState<string>('');

  // Line items (1..100)
  const [lineItems, setLineItems] = useState<DraftLineItem[]>(() => [createEmptyLineItem()]);

  // Discount & VAT
  const [discountAmount, setDiscountAmount] = useState<string>('');
  const [vatMode, setVatMode] = useState<VatMode>('15');
  const [customVatRate, setCustomVatRate] = useState<string>('15');

  // Multiple Attachments
  const [attachments, setAttachments] = useState<PurchaseAttachmentDraft[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Submission & validation state
  const [showValidationErrors, setShowValidationErrors] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const submittingLockRef = useRef<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<SavedSessionBanner | null>(null);

  // Cleanup object URLs on unmount
  const attachmentsRef = useRef<PurchaseAttachmentDraft[]>([]);
  attachmentsRef.current = attachments;
  useEffect(() => {
    return () => {
      for (const att of attachmentsRef.current) {
        if (att.previewUrl) {
          URL.revokeObjectURL(att.previewUrl);
        }
      }
    };
  }, []);

  const loadSuppliersAndRecent = useCallback(async () => {
    if (!userProfile || !currentOrg?.id || !canEnterPurchases) return;

    setSuppliersLoading(true);
    setSuppliersError(null);
    try {
      if (effectivePerms.canViewSuppliers) {
        const list = await fetchSelectableSuppliers(userProfile, currentOrg.id);
        setSuppliers(list);
      } else {
        setSuppliers([]);
        setSuppliersError(
          'حسابك يملك صلاحية إدخال المشتريات، لكنه يحتاج إلى صلاحية «عرض الموردين المسجلين» من مدير المؤسسة لاختيار المورد.'
        );
      }
    } catch (err: any) {
      setSuppliers([]);
      setSuppliersError(err?.message || 'تعذر تحميل قائمة الموردين.');
    } finally {
      setSuppliersLoading(false);
    }

    setRecentLoading(true);
    try {
      const recent = await fetchRecentPurchases(userProfile, currentOrg.id, 6);
      setRecentPurchases(recent);
    } catch {
      // Recent list is auxiliary confirmation; do not block invoice entry
    } finally {
      setRecentLoading(false);
    }
  }, [userProfile, currentOrg?.id, canEnterPurchases, effectivePerms.canViewSuppliers]);

  useEffect(() => {
    void loadSuppliersAndRecent();
  }, [loadSuppliersAndRecent]);

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return suppliers;
    const matches = suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.companyName || '').toLowerCase().includes(q) ||
        (s.taxNumber || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q)
    );
    if (selectedSupplierId && !matches.some((s) => s.id === selectedSupplierId)) {
      const chosen = suppliers.find((s) => s.id === selectedSupplierId);
      if (chosen) return [chosen, ...matches];
    }
    return matches;
  }, [suppliers, supplierSearch, selectedSupplierId]);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) || null,
    [suppliers, selectedSupplierId]
  );

  const handleSelectSupplier = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    const sup = suppliers.find((s) => s.id === supplierId);
    setTaxNumber(sup?.taxNumber?.trim() || '');
    setFormError(null);
  };

  // Effective VAT rate input
  const effectiveVatRateInput =
    vatMode === '15' ? '15' : vatMode === '0' ? '0' : customVatRate;

  // Live Halala-exact calculation
  const calc = useMemo(
    () =>
      calculatePurchaseTotals({
        items: lineItems.map((row, idx) => ({
          id: `item_${idx}`,
          name: row.name,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
        })),
        discountAmount: discountAmount.trim() === '' ? '0' : discountAmount,
        vatRate: effectiveVatRateInput.trim() === '' ? '0' : effectiveVatRateInput,
        maxItems: MAX_PURCHASE_INVOICE_ITEMS,
      }),
    [lineItems, discountAmount, effectiveVatRateInput]
  );

  // Per-row error map for inline feedback
  const rowErrorsMap = useMemo(() => {
    const map: Record<number, string> = {};
    if (!showValidationErrors) return map;
    for (const errCode of calc.errors) {
      const m = /^item_(\d+)_/.exec(errCode);
      if (m) {
        const idx = Number(m[1]);
        if (!map[idx]) {
          map[idx] = formatPurchaseValidationError(errCode);
        }
      }
    }
    return map;
  }, [calc.errors, showValidationErrors]);

  // Line Item Handlers
  const handleAddLineItem = () => {
    if (lineItems.length >= MAX_PURCHASE_INVOICE_ITEMS) return;
    setLineItems((prev) => [...prev, createEmptyLineItem()]);
    setFormError(null);
  };

  const handleUpdateLineItem = (
    rowKey: string,
    field: 'name' | 'quantity' | 'unitPrice',
    value: string
  ) => {
    setLineItems((prev) =>
      prev.map((row) => (row.rowKey === rowKey ? { ...row, [field]: value } : row))
    );
    setFormError(null);
  };

  const handleRemoveLineItem = (rowKey: string) => {
    setLineItems((prev) => {
      if (prev.length <= 1) {
        return [createEmptyLineItem()];
      }
      return prev.filter((row) => row.rowKey !== rowKey);
    });
    setFormError(null);
  };

  // Attachment Handlers
  const addIncomingFiles = (fileList: FileList | File[]) => {
    setAttachmentNotice(null);
    setFormError(null);
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const remainingSlots = MAX_PURCHASE_INVOICE_ATTACHMENTS - attachments.length;
    if (remainingSlots <= 0) {
      setAttachmentNotice(
        `تم الوصول إلى الحد الأقصى للمرفقات (${MAX_PURCHASE_INVOICE_ATTACHMENTS} ملفاً لكل فاتورة).`
      );
      return;
    }

    const accepted: PurchaseAttachmentDraft[] = [];
    const rejectedMessages: string[] = [];

    for (const file of incoming.slice(0, remainingSlots)) {
      const check = isAllowedPurchaseAttachmentFile(file);
      if (!check.valid) {
        rejectedMessages.push(check.error);
        continue;
      }

      const isDuplicate =
        attachments.some((a) => a.fileName === check.normalizedName && a.fileSize === check.size) ||
        accepted.some((a) => a.fileName === check.normalizedName && a.fileSize === check.size);
      if (isDuplicate) {
        rejectedMessages.push(`الملف "${check.normalizedName}" مرفق بالفعل.`);
        continue;
      }

      const localId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const previewUrl = check.normalizedMime.startsWith('image/')
        ? URL.createObjectURL(file)
        : undefined;

      accepted.push({
        localId,
        file,
        fileName: check.normalizedName,
        fileSize: check.size,
        mimeType: check.normalizedMime,
        previewUrl,
      });
    }

    if (incoming.length > remainingSlots) {
      rejectedMessages.push(
        `تم إرفاق ${accepted.length} ملف فقط لعدم تجاوز الحد الأقصى (${MAX_PURCHASE_INVOICE_ATTACHMENTS} ملفاً).`
      );
    }

    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
    if (rejectedMessages.length > 0) {
      setAttachmentNotice(rejectedMessages[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addIncomingFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleRemoveAttachment = (localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.localId !== localId);
    });
    setAttachmentNotice(null);
  };

  const resetForm = (keepBanner = false) => {
    setSelectedSupplierId('');
    setSupplierSearch('');
    setDate(getTodayIsoDate());
    setTaxNumber('');
    setInvoiceNumber('');
    setPaymentMethod('cash');
    setNotes('');
    setLineItems([createEmptyLineItem()]);
    setDiscountAmount('');
    setVatMode('15');
    setCustomVatRate('15');
    setAttachments((prev) => {
      for (const att of prev) {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      }
      return [];
    });
    setAttachmentNotice(null);
    setShowValidationErrors(false);
    setFormError(null);
    if (!keepBanner) {
      setSavedBanner(null);
    }
  };

  const handleSubmitInvoice = async (e: React.FormEvent) => {
    e.preventDefault();

    // Strict synchronous lock to prevent duplicate saves on double click / Enter spam
    if (submittingLockRef.current || isSubmitting) {
      return;
    }

    setShowValidationErrors(true);
    setFormError(null);
    setSavedBanner(null);

    if (!userProfile || !currentOrg?.id || !canEnterPurchases) {
      setFormError('غير مصرح لك بإدخال فواتير المشتريات.');
      return;
    }

    if (!effectiveBranch) {
      setFormError('يرجى التأكد من اختيار فرع نشط مرتبط بالفاتورة.');
      return;
    }

    if (!canUserCreatePurchase(userProfile, effectiveBranch.id)) {
      setFormError('غير مصرح لك بإدخال فواتير مشتريات لهذا الفرع.');
      return;
    }

    if (!selectedSupplier) {
      setFormError('يرجى اختيار المورد من قائمة الموردين المسجلين مسبقاً.');
      return;
    }

    if (!calc.isValid) {
      setFormError(formatPurchaseValidationError(calc.errors[0]));
      return;
    }

    submittingLockRef.current = true;
    setIsSubmitting(true);

    try {
      const result = await savePurchaseInvoice({
        userProfile,
        orgId: currentOrg.id,
        currency,
        branch: effectiveBranch,
        supplier: selectedSupplier,
        date,
        invoiceNumber,
        taxNumber,
        paymentMethod,
        items: lineItems.map((row) => ({
          name: row.name,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
        })),
        discountAmount: discountAmount.trim() === '' ? '0' : discountAmount,
        vatRate: effectiveVatRateInput.trim() === '' ? '0' : effectiveVatRateInput,
        notes,
        attachments: attachments.map((a) => ({
          fileName: a.fileName,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
        })),
      });

      setSavedBanner({
        purchaseId: result.purchase.id,
        invoiceNumber: result.purchase.invoiceNumber,
        supplierName: selectedSupplier.name,
        branchName: effectiveBranch.name,
        itemsCount: result.subItems.length,
        attachmentsCount: result.attachments.length,
        totalAmount: result.purchase.totalAmount,
      });

      setRecentPurchases((prev) => [result.purchase, ...prev].slice(0, 6));
      resetForm(true);
    } catch (err: any) {
      setFormError(err?.message || 'تعذر حفظ فاتورة المشتريات. يرجى المحاولة مرة أخرى.');
    } finally {
      submittingLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Access-Denied Guard (defense-in-depth for employees or revoked accounts)
  if (!canEnterPurchases) {
    return (
      <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 sm:p-10 text-center max-w-2xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          غير مصرح بإدخال فواتير المشتريات
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          إدخال فواتير المشتريات متاح فقط لمدير المؤسسة، وللمسؤول الممنوح صلاحية المشتريات، ولمسؤول الفرع ضمن فرعه المعيّن.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
            إدخال فاتورة مشتريات
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{currentOrg?.name || 'المؤسسة'}</span>
            <span aria-hidden="true">·</span>
            <span>{getUserRoleLabel(userProfile?.role, language)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {canSelectAnyBranch
                ? `جميع فروع المؤسسة (${selectableBranches.length})`
                : `فرع محدد: ${effectiveBranch?.name || 'غير معيّن'}`}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{currency}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSuppliersAndRecent()}
            disabled={suppliersLoading || isSubmitting}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 hover:border-amber-500/40 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${suppliersLoading ? 'animate-spin' : ''}`} />
            <span>تحديث الموردين</span>
          </button>

          <button
            type="button"
            onClick={() => resetForm(false)}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>مسح النموذج</span>
          </button>
        </div>
      </div>

      {/* Feedback Banners */}
      {savedBanner && (
        <div
          role="status"
          className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm flex items-start gap-3"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1 flex-1 min-w-0">
            <p className="font-bold">تم حفظ فاتورة المشتريات بنجاح</p>
            <p className="text-xs text-emerald-700/90 dark:text-emerald-300/90">
              المورد: {savedBanner.supplierName}
              {' · '}
              الفرع: {savedBanner.branchName}
              {savedBanner.invoiceNumber ? ` · رقم الفاتورة: ${savedBanner.invoiceNumber}` : ''}
              {' · '}
              الأصناف: <span className="font-mono tabular-nums">{savedBanner.itemsCount}</span>
              {' · '}
              المرفقات: <span className="font-mono tabular-nums">{savedBanner.attachmentsCount}</span>
              {' · '}
              الإجمالي:{' '}
              <span className="font-mono tabular-nums font-bold">
                {formatCurrency(savedBanner.totalAmount, currency, language)}
              </span>
            </p>
          </div>
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs sm:text-sm flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <span>{formError}</span>
        </div>
      )}

      {suppliersError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs sm:text-sm flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span>{suppliersError}</span>
        </div>
      )}

      <form onSubmit={handleSubmitInvoice} noValidate className="space-y-6">
        {/* Section 1: Invoice Header Metadata */}
        <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Receipt className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  بيانات الفاتورة الأساسية
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  اختر المورد المسجل مسبقاً وتاريخ الفاتورة والفرع المستهدف
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Supplier (First per Phase 4.4 order) */}
            <div className="md:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="purchase-supplier"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  المورد <span className="text-rose-500">*</span>
                </label>
                {suppliers.length > 6 && (
                  <div className="relative w-44">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={supplierSearch}
                      onChange={(e) => setSupplierSearch(e.target.value)}
                      placeholder="تصفية الموردين..."
                      aria-label="تصفية قائمة الموردين"
                      className="w-full ps-8 pe-2.5 py-1 rounded-lg text-[11px] bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}
              </div>

              <select
                id="purchase-supplier"
                value={selectedSupplierId}
                onChange={(e) => handleSelectSupplier(e.target.value)}
                disabled={suppliersLoading || isSubmitting || suppliers.length === 0}
                required
                className={`w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 disabled:opacity-60 ${
                  showValidationErrors && !selectedSupplierId
                    ? 'border-rose-500'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                <option value="">
                  {suppliersLoading
                    ? 'جاري تحميل الموردين...'
                    : suppliers.length === 0
                      ? 'لا يوجد موردون نشطون مسجلون حالياً'
                      : 'اختر المورد من القائمة...'}
                </option>
                {filteredSuppliers.map((sup) => (
                  <option key={sup.id} value={sup.id}>
                    {sup.name}
                    {sup.companyName ? ` — ${sup.companyName}` : ''}
                    {sup.taxNumber ? ` (${sup.taxNumber})` : ''}
                  </option>
                ))}
              </select>

              {!suppliersLoading && suppliers.length === 0 && !suppliersError && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    {userProfile?.role === 'branch_manager'
                      ? 'لا يوجد موردون نشطون مسجلون. يرجى طلب تسجيل الموردين من مدير المؤسسة أو المسؤول المخول.'
                      : 'لا يوجد موردون نشطون مسجلون في المؤسسة بعد. يجب تسجيل مورد نشط قبل حفظ فواتير المشتريات.'}
                  </p>
                  {canCreateSuppliers && onOpenSuppliers && (
                    <button
                      type="button"
                      onClick={onOpenSuppliers}
                      className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap shrink-0"
                    >
                      + إضافة مورد جديد
                    </button>
                  )}
                </div>
              )}
              {userProfile?.role === 'branch_manager' && suppliers.length > 0 && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  يقتصر الاختيار على الموردين النشطين المسجلين مسبقاً في المؤسسة.
                </p>
              )}
            </div>

            {/* 2. Invoice Date */}
            <div className="space-y-1.5">
              <label
                htmlFor="purchase-date"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
              >
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  تاريخ الفاتورة <span className="text-rose-500">*</span>
                </span>
              </label>
              <input
                id="purchase-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setFormError(null);
                }}
                disabled={isSubmitting}
                required
                dir="ltr"
                className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 ${
                  showValidationErrors && !date
                    ? 'border-rose-500'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
              />
            </div>

            {/* 3. Tax Number (auto-filled from supplier, editable) */}
            <div className="space-y-1.5">
              <label
                htmlFor="purchase-tax-number"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                الرقم الضريبي للمورد
              </label>
              <input
                id="purchase-tax-number"
                type="text"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                disabled={isSubmitting}
                maxLength={40}
                placeholder="300000000000003"
                dir="ltr"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
              />
            </div>

            {/* 4. Invoice Number */}
            <div className="space-y-1.5">
              <label
                htmlFor="purchase-invoice-number"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
              >
                <Hash className="w-3.5 h-3.5 text-slate-400" />
                <span>رقم الفاتورة</span>
              </label>
              <input
                id="purchase-invoice-number"
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                disabled={isSubmitting}
                maxLength={80}
                placeholder="مثال: INV-2026-0045"
                dir="ltr"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
              />
            </div>

            {/* 5. Branch (Selectable for Manager/Supervisor, Strictly Locked for Branch Manager) */}
            <div className="space-y-1.5">
              <label
                htmlFor="purchase-branch"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
              >
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  الفرع <span className="text-rose-500">*</span>
                </span>
              </label>

              {canSelectAnyBranch ? (
                <select
                  id="purchase-branch"
                  value={effectiveBranch?.id || ''}
                  onChange={(e) => {
                    setSelectedBranchId(e.target.value);
                    setFormError(null);
                  }}
                  disabled={isSubmitting || selectableBranches.length === 0}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                >
                  {selectableBranches.length === 0 ? (
                    <option value="">لا توجد فروع نشطة</option>
                  ) : (
                    selectableBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))
                  )}
                </select>
              ) : (
                <div
                  id="purchase-branch"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-100 dark:bg-[#070e17]/80 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 flex items-center justify-between gap-2"
                >
                  <span className="truncate font-semibold">
                    {effectiveBranch
                      ? `${effectiveBranch.name} (${effectiveBranch.code})`
                      : 'فرع غير معيّن'}
                  </span>
                  <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-label="فرع مقيد" />
                </div>
              )}
            </div>

            {/* 6. Payment Method */}
            <div className="md:col-span-2 space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                طريقة الدفع <span className="text-rose-500">*</span>
              </span>
              <div
                role="radiogroup"
                aria-label="طريقة الدفع"
                className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800"
              >
                {PAYMENT_METHOD_OPTIONS.map((opt) => {
                  const active = paymentMethod === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={isSubmitting}
                      onClick={() => setPaymentMethod(opt.value)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-white dark:bg-[#0c1829] text-amber-600 dark:text-amber-400 shadow-sm border border-amber-500/30'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Invoice Line Items Table (1..100 items) */}
        <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2.5">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  أصناف الفاتورة
                </h3>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {lineItems.length} / {MAX_PURCHASE_INVOICE_ITEMS} صنف
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                أدخل كل صنف في سطر مستقل مع الكمية وسعر الوحدة ليتم حساب الإجمالي تلقائياً بدقة الهللات
              </p>
            </div>

            <button
              type="button"
              onClick={handleAddLineItem}
              disabled={isSubmitting || lineItems.length >= MAX_PURCHASE_INVOICE_ITEMS}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة صنف</span>
            </button>
          </div>

          {/* Desktop & Tablet Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#070e17]/70 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4 text-center w-12">#</th>
                  <th className="py-3 px-4 text-start min-w-[240px]">اسم الصنف *</th>
                  <th className="py-3 px-4 text-start w-32">الكمية *</th>
                  <th className="py-3 px-4 text-start w-40">سعر الوحدة ({currency}) *</th>
                  <th className="py-3 px-4 text-end w-40">إجمالي الصنف</th>
                  <th className="py-3 px-4 text-center w-16">حذف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {lineItems.map((row, idx) => {
                  const qtyNum = Number(row.quantity);
                  const priceNum = Number(row.unitPrice);
                  const lineTotal =
                    Number.isFinite(qtyNum) &&
                    qtyNum > 0 &&
                    Number.isFinite(priceNum) &&
                    priceNum >= 0 &&
                    row.unitPrice.trim() !== ''
                      ? fromHalalas(toHalalas(qtyNum * priceNum))
                      : 0;
                  const rowError = rowErrorsMap[idx];

                  return (
                    <React.Fragment key={row.rowKey}>
                      <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 px-4 text-center text-xs font-mono tabular-nums text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) =>
                              handleUpdateLineItem(row.rowKey, 'name', e.target.value)
                            }
                            disabled={isSubmitting}
                            maxLength={200}
                            placeholder={`اسم الصنف رقم ${idx + 1}`}
                            aria-label={`اسم الصنف رقم ${idx + 1}`}
                            className={`w-full px-3 py-2 rounded-lg text-sm bg-slate-50 dark:bg-[#070e17] border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 ${
                              showValidationErrors && row.name.trim() === ''
                                ? 'border-rose-500'
                                : 'border-slate-200 dark:border-slate-700'
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min="0.001"
                            value={row.quantity}
                            onChange={(e) =>
                              handleUpdateLineItem(row.rowKey, 'quantity', e.target.value)
                            }
                            disabled={isSubmitting}
                            placeholder="1"
                            dir="ltr"
                            aria-label={`الكمية للصنف رقم ${idx + 1}`}
                            className={`w-full px-3 py-2 rounded-lg text-sm font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 ${
                              showValidationErrors &&
                              calc.errors.some((err) => err.startsWith(`item_${idx}_`) && err.includes('quantity'))
                                ? 'border-rose-500'
                                : 'border-slate-200 dark:border-slate-700'
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            value={row.unitPrice}
                            onChange={(e) =>
                              handleUpdateLineItem(row.rowKey, 'unitPrice', e.target.value)
                            }
                            disabled={isSubmitting}
                            placeholder="0.00"
                            dir="ltr"
                            aria-label={`سعر الوحدة للصنف رقم ${idx + 1}`}
                            className={`w-full px-3 py-2 rounded-lg text-sm font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 ${
                              showValidationErrors &&
                              calc.errors.some((err) => err.startsWith(`item_${idx}_`) && err.includes('unit_price'))
                                ? 'border-rose-500'
                                : 'border-slate-200 dark:border-slate-700'
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-4 text-end text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(lineTotal, currency, language)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLineItem(row.rowKey)}
                            disabled={isSubmitting}
                            title={lineItems.length > 1 ? 'حذف الصنف' : 'تفريغ السطر'}
                            aria-label={lineItems.length > 1 ? `حذف الصنف رقم ${idx + 1}` : 'تفريغ السطر'}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                      {rowError && (
                        <tr className="bg-rose-500/5">
                          <td colSpan={6} className="px-4 py-1.5 text-xs text-rose-600 dark:text-rose-400">
                            {rowError}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Rows View */}
          <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
            {lineItems.map((row, idx) => {
              const qtyNum = Number(row.quantity);
              const priceNum = Number(row.unitPrice);
              const lineTotal =
                Number.isFinite(qtyNum) &&
                qtyNum > 0 &&
                Number.isFinite(priceNum) &&
                priceNum >= 0 &&
                row.unitPrice.trim() !== ''
                  ? fromHalalas(toHalalas(qtyNum * priceNum))
                  : 0;
              const rowError = rowErrorsMap[idx];

              return (
                <div key={row.rowKey} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      صنف #{idx + 1}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                        {formatCurrency(lineTotal, currency, language)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveLineItem(row.rowKey)}
                        disabled={isSubmitting}
                        aria-label={`حذف الصنف رقم ${idx + 1}`}
                        className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-rose-500 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      اسم الصنف *
                    </label>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => handleUpdateLineItem(row.rowKey, 'name', e.target.value)}
                      disabled={isSubmitting}
                      maxLength={200}
                      placeholder={`أدخل اسم الصنف رقم ${idx + 1}`}
                      className={`w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border text-slate-900 dark:text-white ${
                        showValidationErrors && row.name.trim() === ''
                          ? 'border-rose-500'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        الكمية *
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0.001"
                        value={row.quantity}
                        onChange={(e) =>
                          handleUpdateLineItem(row.rowKey, 'quantity', e.target.value)
                        }
                        disabled={isSubmitting}
                        dir="ltr"
                        className={`w-full px-3 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border text-slate-900 dark:text-white ${
                          showValidationErrors &&
                          calc.errors.some((err) => err.startsWith(`item_${idx}_`) && err.includes('quantity'))
                            ? 'border-rose-500'
                            : 'border-slate-300 dark:border-slate-700'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        سعر الوحدة ({currency}) *
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={row.unitPrice}
                        onChange={(e) =>
                          handleUpdateLineItem(row.rowKey, 'unitPrice', e.target.value)
                        }
                        disabled={isSubmitting}
                        placeholder="0.00"
                        dir="ltr"
                        className={`w-full px-3 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border text-slate-900 dark:text-white ${
                          showValidationErrors &&
                          calc.errors.some((err) => err.startsWith(`item_${idx}_`) && err.includes('unit_price'))
                            ? 'border-rose-500'
                            : 'border-slate-300 dark:border-slate-700'
                        }`}
                      />
                    </div>
                  </div>

                  {rowError && (
                    <p className="text-xs text-rose-600 dark:text-rose-400">{rowError}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Table Footer Add Action */}
          <div className="p-4 bg-slate-50/70 dark:bg-[#070e17]/50 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleAddLineItem}
              disabled={isSubmitting || lineItems.length >= MAX_PURCHASE_INVOICE_ITEMS}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors whitespace-nowrap disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة صنف جديد</span>
            </button>

            <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
              <span>مجموع الأصناف ({lineItems.length}):</span>
              <span className="font-mono tabular-nums font-bold text-sm text-slate-900 dark:text-white">
                {formatCurrency(calc.subtotalAmount, currency, language)}
              </span>
            </div>
          </div>
        </section>

        {/* Section 3: Attachments & Notes (7 cols) + Accounting Summary & Save (5 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Attachments & Notes */}
          <section className="lg:col-span-7 bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-amber-500" />
                  <span>مرفقات الفاتورة (صور وملفات PDF)</span>
                </h3>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {attachments.length} / {MAX_PURCHASE_INVOICE_ATTACHMENTS}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                يمكنك إرفاق عدة صور أو ملفات PDF لنفس الفاتورة (حتى 50 ميجابايت للملف) وحذف أي ملف قبل الحفظ.
              </p>
            </div>

            {/* File Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFiles(true);
              }}
              onDragLeave={() => setIsDraggingFiles(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingFiles(false);
                if (!isSubmitting && e.dataTransfer.files) {
                  addIncomingFiles(e.dataTransfer.files);
                }
              }}
              className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
                isDraggingFiles
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-[#070e17]/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,.pdf"
                multiple
                onChange={handleFileInputChange}
                disabled={isSubmitting || attachments.length >= MAX_PURCHASE_INVOICE_ATTACHMENTS}
                className="hidden"
                aria-label="اختيار مرفقات الفاتورة"
              />
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  اسحب الصور أو ملفات PDF وأفلتها هنا، أو اخترها من جهازك
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    isSubmitting || attachments.length >= MAX_PURCHASE_INVOICE_ATTACHMENTS
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-800 dark:text-white bg-white dark:bg-[#0c1829] border border-slate-300 dark:border-slate-700 hover:border-amber-500 transition-colors disabled:opacity-50"
                >
                  <Paperclip className="w-3.5 h-3.5 text-amber-500" />
                  <span>اختيار صور أو ملفات PDF</span>
                </button>
              </div>
            </div>

            {attachmentNotice && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{attachmentNotice}</span>
              </div>
            )}

            {/* Attached Files List */}
            {attachments.length > 0 && (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {attachments.map((att) => (
                  <li
                    key={att.localId}
                    className="p-3 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-[#070e17]/40"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {att.previewUrl ? (
                        <img
                          src={att.previewUrl}
                          alt={att.fileName}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                          {att.mimeType === 'application/pdf' ? (
                            <FileText className="w-5 h-5" />
                          ) : (
                            <ImageIcon className="w-5 h-5" />
                          )}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {att.fileName}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {formatFileSize(att.fileSize)} · {att.mimeType === 'application/pdf' ? 'PDF' : 'صورة'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att.localId)}
                      disabled={isSubmitting}
                      aria-label={`حذف المرفق ${att.fileName}`}
                      className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              ملاحظة: يتم تسجيل جميع بيانات المرفقات وربطها مباشرة برقم الفاتورة في قاعدة البيانات بشكل متزامن؛ وسيتم ربط رفع الملفات الثنائية السحابي عند تفعيل خدمة التخزين في الخطوة اللاحقة.
            </p>

            {/* Optional Notes */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label
                htmlFor="purchase-notes"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
              >
                ملاحظات الفاتورة (اختياري)
              </label>
              <textarea
                id="purchase-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isSubmitting}
                maxLength={1000}
                placeholder="أي ملاحظات محاسبية أو تفاصيل تسليم أو رقم أمر شراء..."
                className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 resize-y"
              />
            </div>
          </section>

          {/* Accounting Totals & Submit */}
          <section className="lg:col-span-5 bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-slate-800">
              ملخص الحسابات والإجمالي النهائي
            </h3>

            <div className="space-y-4">
              {/* Subtotal */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">
                  المجموع الفرعي (قبل الخصم)
                </span>
                <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                  {formatCurrency(calc.subtotalAmount, currency, language)}
                </span>
              </div>

              {/* Discount Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="purchase-discount"
                    className="text-sm text-slate-600 dark:text-slate-400"
                  >
                    الخصم ({currency})
                  </label>
                  <input
                    id="purchase-discount"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={discountAmount}
                    onChange={(e) => {
                      setDiscountAmount(e.target.value);
                      setFormError(null);
                    }}
                    disabled={isSubmitting}
                    placeholder="0.00"
                    dir="ltr"
                    className={`w-36 px-3 py-2 rounded-xl text-sm font-mono tabular-nums text-end bg-slate-50 dark:bg-[#070e17] border text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 ${
                      calc.errors.includes('discount_exceeds_subtotal') ||
                      calc.errors.includes('discount_must_be_non_negative') ||
                      calc.errors.includes('discount_precision_exceeded')
                        ? 'border-rose-500'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  />
                </div>
                {calc.errors.includes('discount_exceeds_subtotal') && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">
                    لا يمكن أن يتجاوز الخصم المجموع الفرعي.
                  </p>
                )}
                {calc.errors.includes('discount_precision_exceeded') && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">
                    قيمة الخصم يجب ألا تتجاوز خانتين عشريتين (دقة الهللات).
                  </p>
                )}
              </div>

              {/* Taxable Amount */}
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <span>الصافي الخاضع للضريبة</span>
                <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                  {formatCurrency(calc.taxableAmount, currency, language)}
                </span>
              </div>

              {/* VAT Mode & Rate */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    ضريبة القيمة المضافة
                  </span>
                  <span className="font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-white">
                    {formatCurrency(calc.vatAmount, currency, language)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800">
                  {(
                    [
                      { id: '15', label: '15% قياسي' },
                      { id: '0', label: '0% معفى' },
                      { id: 'custom', label: 'نسبة مخصصة' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setVatMode(opt.id);
                        setFormError(null);
                      }}
                      className={`px-2 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                        vatMode === opt.id
                          ? 'bg-white dark:bg-[#0c1829] text-amber-600 dark:text-amber-400 shadow-sm border border-amber-500/30'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {vatMode === 'custom' && (
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor="purchase-custom-vat"
                      className="text-xs text-slate-600 dark:text-slate-400"
                    >
                      نسبة الضريبة المخصصة (%)
                    </label>
                    <input
                      id="purchase-custom-vat"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max="100"
                      value={customVatRate}
                      onChange={(e) => {
                        setCustomVatRate(e.target.value);
                        setFormError(null);
                      }}
                      disabled={isSubmitting}
                      dir="ltr"
                      className="w-28 px-3 py-2 rounded-xl text-sm font-mono tabular-nums text-end bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                )}
              </div>

              {/* Final Invoice Total */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-bold text-slate-900 dark:text-white block">
                    الإجمالي النهائي للفاتورة
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    محسوب بدقة الهللات الصحيحة
                  </span>
                </div>
                <span className="text-xl sm:text-2xl font-black font-mono tabular-nums text-amber-600 dark:text-amber-400">
                  {formatCurrency(calc.totalAmount, currency, language)}
                </span>
              </div>
            </div>

            {/* Primary Save Button */}
            <button
              type="submit"
              disabled={isSubmitting || suppliers.length === 0 || !effectiveBranch}
              className="w-full py-3.5 px-5 rounded-xl text-sm font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>جاري حفظ فاتورة المشتريات...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>حفظ فاتورة المشتريات</span>
                </>
              )}
            </button>
          </section>
        </div>
      </form>

      {/* Compact Recent Saved Invoices Confirmation Strip */}
      <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              آخر فواتير المشتريات المسجلة
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              عرض تأكيدي لآخر العمليات المسجلة ضمن نطاق صلاحياتك
            </p>
          </div>
          {recentLoading && (
            <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />
          )}
        </div>

        {recentPurchases.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            لا توجد فواتير مشتريات مسجلة بعد ضمن نطاقك الحالي.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#070e17]/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 text-start font-semibold">التاريخ</th>
                  <th className="py-2.5 px-4 text-start font-semibold">المورد</th>
                  <th className="py-2.5 px-4 text-start font-semibold">رقم الفاتورة</th>
                  <th className="py-2.5 px-4 text-start font-semibold">الفرع</th>
                  <th className="py-2.5 px-4 text-end font-semibold">الإجمالي النهائي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {recentPurchases.map((pur) => (
                  <tr
                    key={pur.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {pur.date}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                      {pur.supplierName || pur.supplierId}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {pur.invoiceNumber || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {pur.branchName || pur.branchId}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      {formatCurrency(pur.totalAmount, currency, language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
