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
import { getActiveDriveSession } from '../../services/driveService';
import { uploadUnifiedDriveFile } from '../../services/unifiedDriveService';
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

const PAYMENT_METHOD_OPTIONS: Array<{
  value: PurchasePaymentMethod;
  ar: string;
  en: string;
  ur: string;
}> = [
  { value: 'cash', ar: 'نقداً', en: 'Cash', ur: 'نقد' },
  { value: 'card', ar: 'شبكة / بطاقة', en: 'Card / POS', ur: 'کارڈ / پی او ایس' },
  { value: 'transfer', ar: 'تحويل بنكي', en: 'Bank Transfer', ur: 'بینک ٹرانسفر' },
  { value: 'credit', ar: 'آجل', en: 'Credit', ur: 'ادھار' },
];

export interface PurchaseEntryViewProps {
  onOpenSuppliers?: () => void;
  initialBranchId?: string;
}

export const PurchaseEntryView: React.FC<PurchaseEntryViewProps> = ({
  onOpenSuppliers,
  initialBranchId,
}) => {
  const { currentUser, userProfile, currentOrg, branches, currentBranch } = useAuth();
  const { language, tr } = useLanguage();

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

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState<boolean>(false);
  const [suppliersError, setSuppliersError] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState<string>('');

  const [recentPurchases, setRecentPurchases] = useState<Purchase[]>([]);
  const [recentLoading, setRecentLoading] = useState<boolean>(false);

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [date, setDate] = useState<string>(() => getTodayIsoDate());
  const [taxNumber, setTaxNumber] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('cash');
  const [notes, setNotes] = useState<string>('');

  const [lineItems, setLineItems] = useState<DraftLineItem[]>(() => [createEmptyLineItem()]);

  const [discountAmount, setDiscountAmount] = useState<string>('');
  const [vatMode, setVatMode] = useState<VatMode>('15');
  const [customVatRate, setCustomVatRate] = useState<string>('15');

  const [attachments, setAttachments] = useState<PurchaseAttachmentDraft[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showValidationErrors, setShowValidationErrors] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const submittingLockRef = useRef<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<SavedSessionBanner | null>(null);

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
          tr(
            'حسابك يملك صلاحية إدخال المشتريات، لكنه يحتاج إلى صلاحية «عرض الموردين المسجلين» من مدير المؤسسة لاختيار المورد.',
            'Your account has purchase entry permission, but requires "View Registered Suppliers" permission from the Organization Manager to select a supplier.',
            'آپ کے اکاؤنٹ کو خریداری اندراج کی اجازت ہے، لیکن سپلائر منتخب کرنے کے لیے ادارے کے مینیجر سے "درج سپلائرز دیکھنے" کی اجازت درکار ہے۔'
          )
        );
      }
    } catch (err: any) {
      setSuppliers([]);
      setSuppliersError(
        err?.message ||
          tr(
            'تعذر تحميل قائمة الموردين.',
            'Failed to load suppliers list.',
            'سپلائرز کی فہرست لوڈ نہیں ہو سکی۔'
          )
      );
    } finally {
      setSuppliersLoading(false);
    }

    setRecentLoading(true);
    try {
      const recent = await fetchRecentPurchases(userProfile, currentOrg.id, 6);
      setRecentPurchases(recent);
    } catch {
      // Auxiliary confirmation list
    } finally {
      setRecentLoading(false);
    }
  }, [userProfile, currentOrg?.id, canEnterPurchases, effectivePerms.canViewSuppliers, tr]);

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

  const effectiveVatRateInput =
    vatMode === '15' ? '15' : vatMode === '0' ? '0' : customVatRate;

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

  const addIncomingFiles = (fileList: FileList | File[]) => {
    setAttachmentNotice(null);
    setFormError(null);
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const remainingSlots = MAX_PURCHASE_INVOICE_ATTACHMENTS - attachments.length;
    if (remainingSlots <= 0) {
      setAttachmentNotice(
        tr(
          `تم الوصول إلى الحد الأقصى للمرفقات (${MAX_PURCHASE_INVOICE_ATTACHMENTS} ملفاً لكل فاتورة).`,
          `Maximum attachments limit reached (${MAX_PURCHASE_INVOICE_ATTACHMENTS} files per invoice).`,
          `منسلک فائلوں کی زیادہ سے زیادہ حد پوری ہو گئی (${MAX_PURCHASE_INVOICE_ATTACHMENTS} فائلیں فی انوائس)۔`
        )
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
        rejectedMessages.push(
          tr(
            `الملف "${check.normalizedName}" مرفق بالفعل.`,
            `File "${check.normalizedName}" is already attached.`,
            `فائل "${check.normalizedName}" پہلے ہی منسلک ہے۔`
          )
        );
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
        tr(
          `تم إرفاق ${accepted.length} ملف فقط لعدم تجاوز الحد الأقصى (${MAX_PURCHASE_INVOICE_ATTACHMENTS} ملفاً).`,
          `Only ${accepted.length} file(s) attached to stay within the ${MAX_PURCHASE_INVOICE_ATTACHMENTS}-file limit.`,
          `زیادہ سے زیادہ حد (${MAX_PURCHASE_INVOICE_ATTACHMENTS} فائلیں) کے اندر رہنے کے لیے صرف ${accepted.length} فائل منسلک کی گئی۔`
        )
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

    if (submittingLockRef.current || isSubmitting) {
      return;
    }

    setShowValidationErrors(true);
    setFormError(null);
    setSavedBanner(null);

    if (!userProfile || !currentOrg?.id || !canEnterPurchases) {
      setFormError(
        tr(
          'غير مصرح لك بإدخال فواتير المشتريات.',
          'You are not authorized to enter purchase invoices.',
          'آپ کو خریداری انوائسز درج کرنے کی اجازت نہیں ہے۔'
        )
      );
      return;
    }

    if (!effectiveBranch) {
      setFormError(
        tr(
          'يرجى التأكد من اختيار فرع نشط مرتبط بالفاتورة.',
          'Please select an active branch for this invoice.',
          'براہِ کرم اس انوائس کے لیے ایک فعال برانچ منتخب کریں۔'
        )
      );
      return;
    }

    if (!canUserCreatePurchase(userProfile, effectiveBranch.id)) {
      setFormError(
        tr(
          'غير مصرح لك بإدخال فواتير مشتريات لهذا الفرع.',
          'You are not authorized to enter purchase invoices for this branch.',
          'آپ کو اس برانچ کے لیے خریداری انوائس درج کرنے کی اجازت نہیں ہے۔'
        )
      );
      return;
    }

    if (!selectedSupplier) {
      setFormError(
        tr(
          'يرجى اختيار المورد من قائمة الموردين المسجلين مسبقاً.',
          'Please select a supplier from the registered suppliers list.',
          'براہِ کرم درج سپلائرز کی فہرست میں سے سپلائر منتخب کریں۔'
        )
      );
      return;
    }

    if (!calc.isValid) {
      setFormError(formatPurchaseValidationError(calc.errors[0]));
      return;
    }

    submittingLockRef.current = true;
    setIsSubmitting(true);

    try {
      const preparedPurchaseId = `pur_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;

      // Organization Owner ONLY: when an active RAM Drive session exists, upload invoice
      // attachment files directly to the unified daily folder (<Org>/الفروع/<Branch>/<YYYY>/<MM>/<DD>).
      // Branch Managers & Supervisors NEVER link personal Google accounts or access Drive directly.
      const isOrgOwnerWithDrive = Boolean(
        userProfile.role === 'manager' &&
          currentUser?.uid === currentOrg.ownerId &&
          currentOrg.driveConnected
      );
      const activeDriveSession = isOrgOwnerWithDrive
        ? getActiveDriveSession(currentOrg.id)
        : null;

      const resolvedAttachments = [];
      for (const att of attachments) {
        if (activeDriveSession && att.file) {
          const bytes = new Uint8Array(await att.file.arrayBuffer());
          const uploaded = await uploadUnifiedDriveFile({
            token: activeDriveSession.accessToken,
            actor: {
              uid: userProfile.uid,
              orgId: currentOrg.id,
              role: userProfile.role,
              isActive: userProfile.isActive,
              displayName: userProfile.displayName,
              email: userProfile.email,
            },
            org: currentOrg,
            branch: effectiveBranch,
            documentType: 'purchase',
            documentDate: date,
            recordId: preparedPurchaseId,
            fileName: att.fileName,
            mimeType: att.mimeType,
            bytes,
          });
          resolvedAttachments.push({
            fileName: att.fileName,
            fileSize: att.fileSize,
            mimeType: att.mimeType,
            driveFileId: uploaded.record.fileId,
            driveWebViewLink: uploaded.record.webViewLink,
          });
        } else {
          resolvedAttachments.push({
            fileName: att.fileName,
            fileSize: att.fileSize,
            mimeType: att.mimeType,
          });
        }
      }

      const result = await savePurchaseInvoice({
        purchaseId: preparedPurchaseId,
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
        attachments: resolvedAttachments,
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
      setFormError(
        err?.message ||
          tr(
            'تعذر حفظ فاتورة المشتريات. يرجى المحاولة مرة أخرى.',
            'Failed to save purchase invoice. Please try again.',
            'خریداری انوائس محفوظ نہیں ہو سکی۔ براہِ کرم دوبارہ کوشش کریں۔'
          )
      );
    } finally {
      submittingLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (!canEnterPurchases) {
    return (
      <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-6 sm:p-10 text-center max-w-2xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#0B1B32] dark:text-white">
          {tr(
            'غير مصرح بإدخال فواتير المشتريات',
            'Not Authorized to Enter Purchase Invoices',
            'خریداری انوائسز درج کرنے کی اجازت نہیں'
          )}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {tr(
            'إدخال فواتير المشتريات متاح فقط لمدير المؤسسة، وللمسؤول الممنوح صلاحية المشتريات، ولمسؤول الفرع ضمن فرعه المعيّن.',
            'Purchase invoice entry is restricted to authorized supervisors and branch managers within their assigned branch.',
            'خریداری انوائس کا اندراج صرف مجاز سپروائزرز اور برانچ مینیجرز کے لیے ان کی مقرر کردہ برانچ تک محدود ہے۔'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white">
            {tr('إدخال فاتورة مشتريات', 'Enter Purchase Invoice', 'خریداری انوائس درج کریں')}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{currentOrg?.name || tr('المؤسسة', 'Organization', 'ادارہ')}</span>
            <span aria-hidden="true">·</span>
            <span>{getUserRoleLabel(userProfile?.role, language)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {canSelectAnyBranch
                ? `${tr('جميع فروع المؤسسة', 'All Organization Branches', 'ادارے کی تمام برانچز')} (${selectableBranches.length})`
                : `${tr('فرع محدد:', 'Assigned Branch:', 'مقرر کردہ برانچ:')} ${effectiveBranch?.name || tr('غير معيّن', 'Unassigned', 'غیر مقرر')}`}
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF]/50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${suppliersLoading ? 'animate-spin' : ''}`} />
            <span>{tr('تحديث الموردين', 'Refresh Suppliers', 'سپلائرز تازہ کریں')}</span>
          </button>

          <button
            type="button"
            onClick={() => resetForm(false)}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{tr('مسح النموذج', 'Reset Form', 'فارم صاف کریں')}</span>
          </button>
        </div>
      </div>

      {/* Feedback Banners */}
      {savedBanner && (
        <div
          role="status"
          className="p-4 rounded-2xl bg-[#08C99B]/10 border border-[#08C99B]/30 text-[#048264] dark:text-[#08C99B] text-xs sm:text-sm flex items-start gap-3"
        >
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-1 flex-1 min-w-0">
            <p className="font-bold">
              {tr(
                'تم حفظ فاتورة المشتريات بنجاح',
                'Purchase invoice saved successfully',
                'خریداری انوائس کامیابی سے محفوظ ہو گئی'
              )}
            </p>
            <p className="text-xs opacity-90">
              {tr('المورد:', 'Supplier:', 'سپلائر:')} {savedBanner.supplierName}
              {' · '}
              {tr('الفرع:', 'Branch:', 'برانچ:')} {savedBanner.branchName}
              {savedBanner.invoiceNumber
                ? ` · ${tr('رقم الفاتورة:', 'Invoice #:', 'انوائس نمبر:')} ${savedBanner.invoiceNumber}`
                : ''}
              {' · '}
              {tr('الأصناف:', 'Items:', 'اشیاء:')}{' '}
              <span className="font-mono tabular-nums">{savedBanner.itemsCount}</span>
              {' · '}
              {tr('المرفقات:', 'Attachments:', 'منسلکات:')}{' '}
              <span className="font-mono tabular-nums">{savedBanner.attachmentsCount}</span>
              {' · '}
              {tr('الإجمالي:', 'Total:', 'کل:')}{' '}
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
        <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#1764FF]/12 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center shrink-0">
                <Receipt className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-[#0B1B32] dark:text-white">
                  {tr('بيانات الفاتورة الأساسية', 'Primary Invoice Details', 'انوائس کی بنیادی تفصیلات')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'اختر المورد المسجل مسبقاً وتاريخ الفاتورة والفرع المستهدف',
                    'Select a registered supplier, invoice date, and target branch',
                    'درج شدہ سپلائر، انوائس کی تاریخ اور مطلوبہ برانچ منتخب کریں'
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Supplier */}
            <div className="md:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="purchase-supplier"
                  className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200"
                >
                  {tr('المورد', 'Supplier', 'سپلائر')} <span className="text-rose-500">*</span>
                </label>
                {suppliers.length > 6 && (
                  <div className="relative w-44">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={supplierSearch}
                      onChange={(e) => setSupplierSearch(e.target.value)}
                      placeholder={tr('تصفية الموردين...', 'Filter suppliers...', 'سپلائرز فلٹر کریں...')}
                      aria-label={tr('تصفية قائمة الموردين', 'Filter suppliers list', 'سپلائرز فہرست فلٹر')}
                      className="w-full ps-8 pe-2.5 py-1 rounded-lg text-[11px] bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF]"
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
                className={`w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF] disabled:opacity-60 ${
                  showValidationErrors && !selectedSupplierId
                    ? 'border-rose-500'
                    : 'border-[#DCE6FA] dark:border-[#1F3B66]'
                }`}
              >
                <option value="">
                  {suppliersLoading
                    ? tr('جاري تحميل الموردين...', 'Loading suppliers...', 'سپلائرز لوڈ ہو رہے ہیں...')
                    : suppliers.length === 0
                      ? tr('لا يوجد موردون نشطون مسجلون حالياً', 'No active suppliers available', 'فی الحال کوئی فعال سپلائر موجود نہیں')
                      : tr('اختر المورد من القائمة...', 'Select a supplier...', 'فہرست سے سپلائر منتخب کریں...')}
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
                    {userProfile?.role === 'branch_manager' && !canCreateSuppliers
                      ? tr(
                          'لا يوجد موردون نشطون مسجلون. يرجى طلب تسجيل الموردين من مدير المؤسسة أو المسؤول المخول.',
                          'No active suppliers found. Please ask the Organization Manager or an authorized supervisor to register suppliers.',
                          'کوئی فعال سپلائر موجود نہیں۔ براہِ کرم ادارے کے مینیجر یا مجاز سپروائزر سے سپلائرز درج کرنے کی درخواست کریں۔'
                        )
                      : tr(
                          'لا يوجد موردون نشطون مسجلون في المؤسسة بعد. يجب تسجيل مورد نشط قبل حفظ فواتير المشتريات.',
                          'No active suppliers registered yet. At least one active supplier is required before saving purchase invoices.',
                          'ابھی کوئی فعال سپلائر درج نہیں ہے۔ انوائس محفوظ کرنے سے پہلے کم از کم ایک فعال سپلائر ضروری ہے۔'
                        )}
                  </p>
                  {canCreateSuppliers && onOpenSuppliers && (
                    <button
                      type="button"
                      onClick={onOpenSuppliers}
                      className="text-[11px] font-bold text-[#1764FF] dark:text-[#6CA2FF] hover:underline whitespace-nowrap shrink-0"
                    >
                      {tr('+ إضافة مورد جديد', '+ Add New Supplier', '+ نیا سپلائر شامل کریں')}
                    </button>
                  )}
                </div>
              )}
              {suppliers.length > 0 && (userProfile?.role === 'branch_manager' || (canCreateSuppliers && onOpenSuppliers)) && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  {userProfile?.role === 'branch_manager' && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {canCreateSuppliers
                        ? tr(
                            'يمكنك اختيار مورد نشط مسجل مسبقاً أو إضافة مورد جديد لاستخدامه في فواتير المشتريات (دون صلاحية التعديل أو الحذف).',
                            'You can select an active registered supplier or add a new supplier for purchase invoices (create-only; no edit or delete).',
                            'آپ پہلے سے درج فعال سپلائر منتخب کر سکتے ہیں یا خریداری انوائس کے لیے نیا سپلائر شامل کر سکتے ہیں (ترمیم یا حذف کی اجازت نہیں)۔'
                          )
                        : tr(
                            'يقتصر الاختيار على الموردين النشطين المسجلين مسبقاً في المؤسسة.',
                            'Selection is restricted to active pre-registered suppliers in your organization.',
                            'انتخاب صرف ادارے میں پہلے سے درج فعال سپلائرز تک محدود ہے۔'
                          )}
                    </p>
                  )}
                  {canCreateSuppliers && onOpenSuppliers && (
                    <button
                      type="button"
                      onClick={onOpenSuppliers}
                      className="text-[11px] font-bold text-[#1764FF] dark:text-[#6CA2FF] hover:underline whitespace-nowrap shrink-0"
                    >
                      {tr('+ إضافة مورد جديد', '+ Add New Supplier', '+ نیا سپلائر شامل کریں')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 2. Invoice Date */}
            <div className="space-y-1.5">
              <label
                htmlFor="purchase-date"
                className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 flex items-center gap-1.5"
              >
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  {tr('تاريخ الفاتورة', 'Invoice Date', 'انوائس کی تاریخ')}{' '}
                  <span className="text-rose-500">*</span>
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
                className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF] ${
                  showValidationErrors && !date
                    ? 'border-rose-500'
                    : 'border-[#DCE6FA] dark:border-[#1F3B66]'
                }`}
              />
            </div>

            {/* 3. Tax Number */}
            <div className="space-y-1.5">
              <label
                htmlFor="purchase-tax-number"
                className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200"
              >
                {tr('الرقم الضريبي للمورد', 'Supplier VAT Number', 'سپلائر کا ٹیکس نمبر')}
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
                className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
              />
            </div>

            {/* 4. Invoice Number */}
            <div className="space-y-1.5">
              <label
                htmlFor="purchase-invoice-number"
                className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 flex items-center gap-1.5"
              >
                <Hash className="w-3.5 h-3.5 text-slate-400" />
                <span>{tr('رقم الفاتورة', 'Invoice Number', 'انوائس نمبر')}</span>
              </label>
              <input
                id="purchase-invoice-number"
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                disabled={isSubmitting}
                maxLength={80}
                placeholder={tr('مثال: INV-2026-0045', 'e.g. INV-2026-0045', 'مثال: INV-2026-0045')}
                dir="ltr"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
              />
            </div>

            {/* 5. Branch */}
            <div className="space-y-1.5">
              <label
                htmlFor="purchase-branch"
                className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 flex items-center gap-1.5"
              >
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  {tr('الفرع', 'Branch', 'برانچ')} <span className="text-rose-500">*</span>
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
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
                >
                  {selectableBranches.length === 0 ? (
                    <option value="">{tr('لا توجد فروع نشطة', 'No active branches', 'کوئی فعال برانچ نہیں')}</option>
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
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-slate-200 flex items-center justify-between gap-2"
                >
                  <span className="truncate font-semibold">
                    {effectiveBranch
                      ? `${effectiveBranch.name} (${effectiveBranch.code})`
                      : tr('فرع غير معيّن', 'Unassigned Branch', 'غیر مقرر برانچ')}
                  </span>
                  <Lock
                    className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF] shrink-0"
                    aria-label={tr('فرع مقيد', 'Locked branch', 'محدود برانچ')}
                  />
                </div>
              )}
            </div>

            {/* 6. Payment Method */}
            <div className="md:col-span-2 space-y-1.5">
              <span className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block">
                {tr('طريقة الدفع', 'Payment Method', 'ادائیگی کا طریقہ')}{' '}
                <span className="text-rose-500">*</span>
              </span>
              <div
                role="radiogroup"
                aria-label={tr('طريقة الدفع', 'Payment Method', 'ادائیگی کا طریقہ')}
                className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]"
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
                          ? 'bg-white dark:bg-[#122543] text-[#1764FF] dark:text-[#6CA2FF] shadow-sm border border-[#1764FF]/30'
                          : 'text-slate-600 dark:text-slate-400 hover:text-[#0B1B32] dark:hover:text-white'
                      }`}
                    >
                      {tr(opt.ar, opt.en, opt.ur)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Invoice Line Items Table */}
        <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
          <div className="p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2.5">
                <h3 className="text-sm sm:text-base font-bold text-[#0B1B32] dark:text-white">
                  {tr('أصناف الفاتورة', 'Invoice Line Items', 'انوائس کی اشیاء')}
                </h3>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {lineItems.length} / {MAX_PURCHASE_INVOICE_ITEMS} {tr('صنف', 'item(s)', 'اشیاء')}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  'أدخل كل صنف في سطر مستقل مع الكمية وسعر الوحدة ليتم حساب الإجمالي تلقائياً بدقة الهللات',
                  'Enter each item on a separate row with quantity and unit price for exact halala-precision totals',
                  'ہر شے کو مقدار اور یونٹ قیمت کے ساتھ علیحدہ سطر میں درج کریں تاکہ کل رقم خودکار درستگی سے شمار ہو'
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={handleAddLineItem}
              disabled={isSubmitting || lineItems.length >= MAX_PURCHASE_INVOICE_ITEMS}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span>{tr('إضافة صنف', 'Add Item', 'شے شامل کریں')}</span>
            </button>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start border-collapse">
              <thead>
                <tr className="bg-[#F5F8FF] dark:bg-[#0E203A] border-b border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-bold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4 text-center w-12">#</th>
                  <th className="py-3 px-4 text-start min-w-[240px]">{tr('اسم الصنف *', 'Item Name *', 'شے کا نام *')}</th>
                  <th className="py-3 px-4 text-start w-32">{tr('الكمية *', 'Quantity *', 'مقدار *')}</th>
                  <th className="py-3 px-4 text-start w-40">
                    {tr('سعر الوحدة', 'Unit Price', 'یونٹ قیمت')} ({currency}) *
                  </th>
                  <th className="py-3 px-4 text-end w-40">{tr('إجمالي الصنف', 'Line Total', 'شے کا کل')}</th>
                  <th className="py-3 px-4 text-center w-16">{tr('حذف', 'Remove', 'حذف')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66]/70">
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
                      <tr className="hover:bg-[#F5F8FF]/70 dark:hover:bg-[#173056]/40 transition-colors">
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
                            placeholder={tr(`اسم الصنف رقم ${idx + 1}`, `Item #${idx + 1} name`, `شے #${idx + 1} کا نام`)}
                            aria-label={tr(`اسم الصنف رقم ${idx + 1}`, `Item #${idx + 1} name`, `شے #${idx + 1} کا نام`)}
                            className={`w-full px-3 py-2 rounded-lg text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF] ${
                              showValidationErrors && row.name.trim() === ''
                                ? 'border-rose-500'
                                : 'border-[#DCE6FA] dark:border-[#1F3B66]'
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
                            aria-label={tr(`الكمية للصنف رقم ${idx + 1}`, `Quantity for item #${idx + 1}`, `شے #${idx + 1} کی مقدار`)}
                            className={`w-full px-3 py-2 rounded-lg text-sm font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF] ${
                              showValidationErrors &&
                              calc.errors.some((err) => err.startsWith(`item_${idx}_`) && err.includes('quantity'))
                                ? 'border-rose-500'
                                : 'border-[#DCE6FA] dark:border-[#1F3B66]'
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
                            aria-label={tr(`سعر الوحدة للصنف رقم ${idx + 1}`, `Unit price for item #${idx + 1}`, `شے #${idx + 1} کی یونٹ قیمت`)}
                            className={`w-full px-3 py-2 rounded-lg text-sm font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF] ${
                              showValidationErrors &&
                              calc.errors.some((err) => err.startsWith(`item_${idx}_`) && err.includes('unit_price'))
                                ? 'border-rose-500'
                                : 'border-[#DCE6FA] dark:border-[#1F3B66]'
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-4 text-end text-sm font-bold font-mono tabular-nums text-[#0B1B32] dark:text-white whitespace-nowrap">
                          {formatCurrency(lineTotal, currency, language)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLineItem(row.rowKey)}
                            disabled={isSubmitting}
                            title={
                              lineItems.length > 1
                                ? tr('حذف الصنف', 'Remove item', 'شے حذف کریں')
                                : tr('تفريغ السطر', 'Clear row', 'سطر صاف کریں')
                            }
                            aria-label={
                              lineItems.length > 1
                                ? tr(`حذف الصنف رقم ${idx + 1}`, `Remove item #${idx + 1}`, `شے #${idx + 1} حذف کریں`)
                                : tr('تفريغ السطر', 'Clear row', 'سطر صاف کریں')
                            }
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
          <div className="md:hidden divide-y divide-[#DCE6FA] dark:divide-[#1F3B66]">
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
                      {tr('صنف', 'Item', 'شے')} #{idx + 1}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold font-mono tabular-nums text-[#1764FF] dark:text-[#6CA2FF]">
                        {formatCurrency(lineTotal, currency, language)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveLineItem(row.rowKey)}
                        disabled={isSubmitting}
                        aria-label={tr(`حذف الصنف رقم ${idx + 1}`, `Remove item #${idx + 1}`, `شے #${idx + 1} حذف کریں`)}
                        className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-rose-500 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {tr('اسم الصنف *', 'Item Name *', 'شے کا نام *')}
                    </label>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => handleUpdateLineItem(row.rowKey, 'name', e.target.value)}
                      disabled={isSubmitting}
                      maxLength={200}
                      placeholder={tr(`أدخل اسم الصنف رقم ${idx + 1}`, `Enter item #${idx + 1} name`, `شے #${idx + 1} کا نام درج کریں`)}
                      className={`w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border text-[#0B1B32] dark:text-white ${
                        showValidationErrors && row.name.trim() === ''
                          ? 'border-rose-500'
                          : 'border-[#DCE6FA] dark:border-[#1F3B66]'
                      }`}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        {tr('الكمية *', 'Quantity *', 'مقدار *')}
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
                        className={`w-full px-3 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border text-[#0B1B32] dark:text-white ${
                          showValidationErrors &&
                          calc.errors.some((err) => err.startsWith(`item_${idx}_`) && err.includes('quantity'))
                            ? 'border-rose-500'
                            : 'border-[#DCE6FA] dark:border-[#1F3B66]'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        {tr('سعر الوحدة', 'Unit Price', 'یونٹ قیمت')} ({currency}) *
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
                        className={`w-full px-3 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border text-[#0B1B32] dark:text-white ${
                          showValidationErrors &&
                          calc.errors.some((err) => err.startsWith(`item_${idx}_`) && err.includes('unit_price'))
                            ? 'border-rose-500'
                            : 'border-[#DCE6FA] dark:border-[#1F3B66]'
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
          <div className="p-4 bg-[#F5F8FF]/70 dark:bg-[#0E203A]/70 border-t border-[#E6EEFC] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleAddLineItem}
              disabled={isSubmitting || lineItems.length >= MAX_PURCHASE_INVOICE_ITEMS}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-[#1764FF] dark:text-[#6CA2FF] bg-[#1764FF]/10 hover:bg-[#1764FF]/20 border border-[#1764FF]/30 transition-colors whitespace-nowrap disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              <span>{tr('إضافة صنف جديد', 'Add New Item', 'نئی شے شامل کریں')}</span>
            </button>

            <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
              <span>
                {tr('مجموع الأصناف', 'Items Subtotal', 'اشیاء کا مجموعہ')} ({lineItems.length}):
              </span>
              <span className="font-mono tabular-nums font-bold text-sm text-[#0B1B32] dark:text-white">
                {formatCurrency(calc.subtotalAmount, currency, language)}
              </span>
            </div>
          </div>
        </section>

        {/* Section 3: Attachments & Notes + Accounting Summary & Save */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Attachments & Notes */}
          <section className="lg:col-span-7 bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 space-y-5">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm sm:text-base font-bold text-[#0B1B32] dark:text-white flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>
                    {tr('مرفقات الفاتورة (صور وملفات PDF)', 'Invoice Attachments (Images & PDFs)', 'انوائس منسلکات (تصاویر اور PDF)')}
                  </span>
                </h3>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {attachments.length} / {MAX_PURCHASE_INVOICE_ATTACHMENTS}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  'يمكنك إرفاق عدة صور أو ملفات PDF لنفس الفاتورة (حتى 50 ميجابايت للملف) وحذف أي ملف قبل الحفظ.',
                  'Attach multiple images or PDF files to the invoice (up to 50 MB per file) and remove any file before saving.',
                  'آپ ایک ہی انوائس کے ساتھ متعدد تصاویر یا PDF فائلیں (فی فائل 50 MB تک) منسلک کر سکتے ہیں اور محفوظ کرنے سے پہلے ہٹا سکتے ہیں۔'
                )}
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
                  ? 'border-[#1764FF] bg-[#1764FF]/10'
                  : 'border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF]/70 dark:bg-[#0E203A]/60'
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
                aria-label={tr('اختيار مرفقات الفاتورة', 'Select invoice attachments', 'انوائس منسلکات منتخب کریں')}
              />
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-[#1764FF]/12 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center mx-auto">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {tr(
                    'اسحب الصور أو ملفات PDF وأفلتها هنا، أو اخترها من جهازك',
                    'Drag & drop images or PDF files here, or browse from your device',
                    'تصاویر یا PDF فائلیں یہاں گھسیٹ کر چھوڑیں، یا اپنے ڈیوائس سے منتخب کریں'
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    isSubmitting || attachments.length >= MAX_PURCHASE_INVOICE_ATTACHMENTS
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-[#0B1B32] dark:text-white bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF] transition-colors disabled:opacity-50"
                >
                  <Paperclip className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>{tr('اختيار صور أو ملفات PDF', 'Choose Images or PDFs', 'تصاویر یا PDF منتخب کریں')}</span>
                </button>
              </div>
            </div>

            {attachmentNotice && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{attachmentNotice}</span>
              </div>
            )}

            {attachments.length > 0 && (
              <ul className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-xl overflow-hidden">
                {attachments.map((att) => (
                  <li
                    key={att.localId}
                    className="p-3 flex items-center justify-between gap-3 bg-[#F5F8FF]/60 dark:bg-[#0E203A]/60"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {att.previewUrl ? (
                        <img
                          src={att.previewUrl}
                          alt={att.fileName}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-lg object-cover border border-[#DCE6FA] dark:border-[#1F3B66] shrink-0"
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
                        <p className="text-xs font-semibold text-[#0B1B32] dark:text-white truncate">
                          {att.fileName}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {formatFileSize(att.fileSize)} ·{' '}
                          {att.mimeType === 'application/pdf'
                            ? 'PDF'
                            : tr('صورة', 'Image', 'تصویر')}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att.localId)}
                      disabled={isSubmitting}
                      aria-label={`${tr('حذف المرفق', 'Remove attachment', 'منسلک فائل ہٹائیں')} ${att.fileName}`}
                      className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {tr(
                'ملاحظة: يتم تسجيل جميع بيانات المرفقات وربطها مباشرة برقم الفاتورة في قاعدة البيانات بشكل متزامن؛ وسيتم ربط رفع الملفات الثنائية السحابي عند تفعيل خدمة التخزين في الخطوة اللاحقة.',
                'Note: Attachment metadata is atomically linked to the invoice record in the database.',
                'نوٹ: منسلک فائلوں کا ڈیٹا براہِ راست انوائس نمبر کے ساتھ ڈیٹا بیس میں محفوظ کیا جاتا ہے۔'
              )}
            </p>

            {/* Optional Notes */}
            <div className="space-y-1.5 pt-2 border-t border-[#E6EEFC] dark:border-[#1F3B66]">
              <label
                htmlFor="purchase-notes"
                className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
              >
                {tr('ملاحظات الفاتورة (اختياري)', 'Invoice Notes (Optional)', 'انوائس نوٹس (اختیاری)')}
              </label>
              <textarea
                id="purchase-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isSubmitting}
                maxLength={1000}
                placeholder={tr(
                  'أي ملاحظات محاسبية أو تفاصيل تسليم أو رقم أمر شراء...',
                  'Any accounting notes, delivery details, or PO reference...',
                  'کوئی اکاؤنٹنگ نوٹس، ڈیلیوری تفصیلات یا خریداری آرڈر نمبر...'
                )}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF] resize-y"
              />
            </div>
          </section>

          {/* Accounting Totals & Submit */}
          <section className="lg:col-span-5 bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 space-y-5">
            <h3 className="text-sm sm:text-base font-bold text-[#0B1B32] dark:text-white pb-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
              {tr('ملخص الحسابات والإجمالي النهائي', 'Accounting Summary & Final Total', 'اکاؤنٹنگ خلاصہ اور حتمی کل')}
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">
                  {tr('المجموع الفرعي (قبل الخصم)', 'Subtotal (Before Discount)', 'ذیلی کل (رعایت سے پہلے)')}
                </span>
                <span className="font-mono tabular-nums font-bold text-[#0B1B32] dark:text-white">
                  {formatCurrency(calc.subtotalAmount, currency, language)}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="purchase-discount"
                    className="text-sm text-slate-600 dark:text-slate-400"
                  >
                    {tr('الخصم', 'Discount', 'رعایت')} ({currency})
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
                    className={`w-36 px-3 py-2 rounded-xl text-sm font-mono tabular-nums text-end bg-[#F5F8FF] dark:bg-[#0E203A] border text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF] ${
                      calc.errors.includes('discount_exceeds_subtotal') ||
                      calc.errors.includes('discount_must_be_non_negative') ||
                      calc.errors.includes('discount_precision_exceeded')
                        ? 'border-rose-500'
                        : 'border-[#DCE6FA] dark:border-[#1F3B66]'
                    }`}
                  />
                </div>
                {calc.errors.includes('discount_exceeds_subtotal') && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">
                    {tr(
                      'لا يمكن أن يتجاوز الخصم المجموع الفرعي.',
                      'Discount cannot exceed the subtotal.',
                      'رعایت ذیلی کل سے زیادہ نہیں ہو سکتی۔'
                    )}
                  </p>
                )}
                {calc.errors.includes('discount_precision_exceeded') && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">
                    {tr(
                      'قيمة الخصم يجب ألا تتجاوز خانتين عشريتين (دقة الهللات).',
                      'Discount value must not exceed 2 decimal places.',
                      'رعایت کی رقم زیادہ سے زیادہ 2 اعشاریہ تک ہونی چاہیے۔'
                    )}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-[#E6EEFC] dark:border-[#1F3B66]">
                <span>{tr('الصافي الخاضع للضريبة', 'Taxable Net Amount', 'ٹیکس کے قابل خالص رقم')}</span>
                <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                  {formatCurrency(calc.taxableAmount, currency, language)}
                </span>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    {tr('ضريبة القيمة المضافة', 'Value Added Tax (VAT)', 'ویلیو ایڈڈ ٹیکس (VAT)')}
                  </span>
                  <span className="font-mono tabular-nums text-sm font-semibold text-[#0B1B32] dark:text-white">
                    {formatCurrency(calc.vatAmount, currency, language)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                  {(
                    [
                      { id: '15', label: tr('15% قياسي', '15% Standard', '15% معیاری') },
                      { id: '0', label: tr('0% معفى', '0% Exempt', '0% مستثنیٰ') },
                      { id: 'custom', label: tr('نسبة مخصصة', 'Custom Rate', 'مخصوص شرح') },
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
                          ? 'bg-white dark:bg-[#122543] text-[#1764FF] dark:text-[#6CA2FF] shadow-sm border border-[#1764FF]/30'
                          : 'text-slate-600 dark:text-slate-400 hover:text-[#0B1B32] dark:hover:text-white'
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
                      {tr('نسبة الضريبة المخصصة (%)', 'Custom VAT Rate (%)', 'مخصوص ٹیکس شرح (%)')}
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
                      className="w-28 px-3 py-2 rounded-xl text-sm font-mono tabular-nums text-end bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
                    />
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-bold text-[#0B1B32] dark:text-white block">
                    {tr('الإجمالي النهائي للفاتورة', 'Final Invoice Total', 'انوائس کا حتمی کل')}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr('محسوب بدقة الهللات الصحيحة', 'Computed with integer halala precision', 'درست ہلالہ حساب سے شمار شدہ')}
                  </span>
                </div>
                <span className="text-xl sm:text-2xl font-black font-mono tabular-nums text-[#1764FF] dark:text-[#6CA2FF]">
                  {formatCurrency(calc.totalAmount, currency, language)}
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || suppliers.length === 0 || !effectiveBranch}
              className="w-full py-3.5 px-5 rounded-xl text-sm font-extrabold text-white bg-[#1764FF] hover:bg-[#1052D8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1764FF] transition-colors flex items-center justify-center gap-2 shadow-sm shadow-[#1764FF]/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{tr('جاري حفظ فاتورة المشتريات...', 'Saving purchase invoice...', 'خریداری انوائس محفوظ ہو رہی ہے...')}</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{tr('حفظ فاتورة المشتريات', 'Save Purchase Invoice', 'خریداری انوائس محفوظ کریں')}</span>
                </>
              )}
            </button>
          </section>
        </div>
      </form>

      {/* Compact Recent Saved Invoices Confirmation Strip */}
      <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E6EEFC] dark:border-[#1F3B66] flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[#0B1B32] dark:text-white">
              {tr('آخر فواتير المشتريات المسجلة', 'Recently Recorded Purchase Invoices', 'حالیہ درج خریداری انوائسز')}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {tr(
                'عرض تأكيدي لآخر العمليات المسجلة ضمن نطاق صلاحياتك',
                'Confirmation view of recent entries within your permission scope',
                'آپ کے دائرہ اختیار میں حالیہ اندراجات کا تصدیقی منظر'
              )}
            </p>
          </div>
          {recentLoading && <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />}
        </div>

        {recentPurchases.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            {tr(
              'لا توجد فواتير مشتريات مسجلة بعد ضمن نطاقك الحالي.',
              'No purchase invoices recorded yet within your current scope.',
              'آپ کے موجودہ دائرہ کار میں ابھی کوئی خریداری انوائس درج نہیں ہے۔'
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="bg-[#F5F8FF] dark:bg-[#0E203A] border-b border-[#DCE6FA] dark:border-[#1F3B66] text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 text-start font-semibold">{tr('التاريخ', 'Date', 'تاریخ')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{tr('المورد', 'Supplier', 'سپلائر')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{tr('رقم الفاتورة', 'Invoice #', 'انوائس نمبر')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{tr('الفرع', 'Branch', 'برانچ')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{tr('الإجمالي النهائي', 'Final Total', 'حتمی کل')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66]/70">
                {recentPurchases.map((pur) => (
                  <tr
                    key={pur.id}
                    className="hover:bg-[#F5F8FF]/70 dark:hover:bg-[#173056]/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {pur.date}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-[#0B1B32] dark:text-white">
                      {pur.supplierName || pur.supplierId}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {pur.invoiceNumber || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {pur.branchName || pur.branchId}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono tabular-nums font-bold text-[#0B1B32] dark:text-white whitespace-nowrap">
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
