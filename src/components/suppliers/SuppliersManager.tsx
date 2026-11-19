import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import type { Supplier } from '../../types';
import { formatCurrency } from '../../utils/accounting';
import {
  canUserCreateSupplier,
  canUserDeleteSupplier,
  canUserEditSupplier,
  canUserToggleSupplierStatus,
  getUserRoleLabel,
} from '../../utils/permissions';
import {
  createSupplier,
  deleteSupplierSafely,
  fetchOrgSuppliersForManagement,
  SupplierFormInput,
  toggleSupplierStatus,
  updateSupplier,
  validateSupplierFormInput,
} from '../../services/supplierService';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Edit3,
  Lock,
  MapPin,
  PauseCircle,
  Phone,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  X,
} from 'lucide-react';

type StatusFilter = 'all' | 'active' | 'inactive';

interface FormState {
  name: string;
  taxNumber: string;
  phone: string;
  address: string;
  notes: string;
  companyName: string;
  contactPerson: string;
  email: string;
  openingBalance: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  taxNumber: '',
  phone: '',
  address: '',
  notes: '',
  companyName: '',
  contactPerson: '',
  email: '',
  openingBalance: '',
};

export const SuppliersManager: React.FC = () => {
  const { userProfile, currentOrg } = useAuth();
  const { language, tr } = useLanguage();
  const currency = currentOrg?.currency || 'SAR';

  const canCreate = useMemo(() => canUserCreateSupplier(userProfile), [userProfile]);
  const canEdit = useMemo(() => canUserEditSupplier(userProfile), [userProfile]);
  const canToggle = useMemo(() => canUserToggleSupplierStatus(userProfile), [userProfile]);
  const canDelete = useMemo(() => canUserDeleteSupplier(userProfile), [userProfile]);

  const canAccessManagement = canCreate;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM);
  const [showOptionalFields, setShowOptionalFields] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const submitLockRef = useRef<boolean>(false);

  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleteBlockedInfo, setDeleteBlockedInfo] = useState<{
    linkedPurchasesCount: number;
    message: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadSuppliers = useCallback(async () => {
    if (!userProfile || !currentOrg?.id || !canAccessManagement) return;
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchOrgSuppliersForManagement(userProfile, currentOrg.id);
      setSuppliers(list);
    } catch (err: any) {
      setLoadError(
        err?.message ||
          tr(
            'تعذر تحميل قائمة الموردين.',
            'Failed to load suppliers list.',
            'سپلائرز کی فہرست لوڈ نہیں ہو سکی۔'
          )
      );
    } finally {
      setLoading(false);
    }
  }, [userProfile, currentOrg?.id, canAccessManagement, tr]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const counts = useMemo(() => {
    const active = suppliers.filter((s) => s.isActive).length;
    return {
      total: suppliers.length,
      active,
      inactive: suppliers.length - active,
    };
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (statusFilter === 'active' && !s.isActive) return false;
      if (statusFilter === 'inactive' && s.isActive) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.taxNumber || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q) ||
        (s.companyName || '').toLowerCase().includes(q) ||
        (s.contactPerson || '').toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q)
      );
    });
  }, [suppliers, searchQuery, statusFilter]);

  const openCreateModal = () => {
    if (!canCreate) return;
    setEditingSupplier(null);
    setFormState(EMPTY_FORM);
    setShowOptionalFields(false);
    setModalError(null);
    setSuccessMessage(null);
    setActionError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    if (!canEdit) return;
    setEditingSupplier(supplier);
    const hasSecondary = Boolean(
      supplier.companyName ||
        supplier.contactPerson ||
        supplier.email ||
        supplier.openingBalance !== undefined
    );
    setFormState({
      name: supplier.name || '',
      taxNumber: supplier.taxNumber || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      notes: supplier.notes || '',
      companyName: supplier.companyName || '',
      contactPerson: supplier.contactPerson || '',
      email: supplier.email || '',
      openingBalance:
        supplier.openingBalance !== undefined ? String(supplier.openingBalance) : '',
    });
    setShowOptionalFields(hasSecondary);
    setModalError(null);
    setSuccessMessage(null);
    setActionError(null);
    setIsModalOpen(true);
  };

  const closeFormModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
    setEditingSupplier(null);
    setModalError(null);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSaving) return;
    if (!userProfile || !currentOrg?.id) return;

    const isEditing = Boolean(editingSupplier);
    if (isEditing && !canEdit) {
      setModalError(
        tr(
          'تعديل بيانات الموردين متاح لمدير المؤسسة فقط.',
          'Editing supplier records is restricted to the Organization Manager.',
          'سپلائرز کے ڈیٹا میں ترمیم صرف ادارے کے مینیجر تک محدود ہے۔'
        )
      );
      return;
    }
    if (!isEditing && !canCreate) {
      setModalError(
        tr(
          'لا تملك صلاحية إضافة مورد جديد.',
          'You do not have permission to add a new supplier.',
          'آپ کے پاس نیا سپلائر شامل کرنے کی اجازت نہیں ہے۔'
        )
      );
      return;
    }

    const input: SupplierFormInput = {
      name: formState.name,
      taxNumber: formState.taxNumber,
      phone: formState.phone,
      address: formState.address,
      notes: formState.notes,
      companyName: formState.companyName,
      contactPerson: formState.contactPerson,
      email: formState.email,
      openingBalance: formState.openingBalance,
    };

    const localCheck = validateSupplierFormInput(input);
    if (!localCheck.ok) {
      setModalError(localCheck.error);
      return;
    }

    submitLockRef.current = true;
    setIsSaving(true);
    setModalError(null);
    setActionError(null);

    try {
      if (editingSupplier) {
        const updated = await updateSupplier({
          userProfile,
          orgId: currentOrg.id,
          targetSupplier: editingSupplier,
          input,
          existingSuppliers: suppliers,
        });
        setSuppliers((prev) =>
          prev
            .map((s) => (s.id === updated.id ? updated : s))
            .sort((a, b) => {
              if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
              return a.name.localeCompare(b.name, 'ar');
            })
        );
        setSuccessMessage(
          tr(
            `تم تحديث بيانات المورد "${updated.name}" بنجاح.`,
            `Supplier "${updated.name}" updated successfully.`,
            `سپلائر "${updated.name}" کا ڈیٹا کامیابی سے اپ ڈیٹ ہو گیا۔`
          )
        );
      } else {
        const created = await createSupplier({
          userProfile,
          orgId: currentOrg.id,
          input,
          existingSuppliers: suppliers,
        });
        setSuppliers((prev) =>
          [created, ...prev].sort((a, b) => {
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            return a.name.localeCompare(b.name, 'ar');
          })
        );
        setSuccessMessage(
          tr(
            `تم تسجيل المورد "${created.name}" بنجاح وإتاحته في فواتير المشتريات.`,
            `Supplier "${created.name}" created and is now available for purchase invoices.`,
            `سپلائر "${created.name}" کامیابی سے درج ہو گیا اور اب خریداری انوائسز میں دستیاب ہے۔`
          )
        );
      }
      setIsModalOpen(false);
      setEditingSupplier(null);
      setFormState(EMPTY_FORM);
    } catch (err: any) {
      setModalError(
        err?.message ||
          tr(
            'تعذر حفظ بيانات المورد. يرجى المحاولة مرة أخرى.',
            'Failed to save supplier data. Please try again.',
            'سپلائر کا ڈیٹا محفوظ نہیں ہو سکا۔ براہِ کرم دوبارہ کوشش کریں۔'
          )
      );
    } finally {
      submitLockRef.current = false;
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (supplier: Supplier) => {
    if (!canToggle || !userProfile || !currentOrg?.id || togglingId) return;
    setTogglingId(supplier.id);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const updated = await toggleSupplierStatus({
        userProfile,
        orgId: currentOrg.id,
        targetSupplier: supplier,
        nextIsActive: !supplier.isActive,
      });
      setSuppliers((prev) =>
        prev
          .map((s) => (s.id === updated.id ? updated : s))
          .sort((a, b) => {
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            return a.name.localeCompare(b.name, 'ar');
          })
      );
      setSuccessMessage(
        updated.isActive
          ? tr(
              `تم تفعيل المورد "${updated.name}" بنجاح.`,
              `Supplier "${updated.name}" activated successfully.`,
              `سپلائر "${updated.name}" کامیابی سے فعال کر دیا گیا۔`
            )
          : tr(
              `تم إيقاف المورد "${updated.name}" بنجاح ولن يظهر في الفواتير الجديدة مع الحفاظ على الفواتير السابقة.`,
              `Supplier "${updated.name}" deactivated. It will not appear on new invoices while preserving historical records.`,
              `سپلائر "${updated.name}" غیر فعال کر دیا گیا۔ گزشتہ ریکارڈ محفوظ رہیں گے لیکن یہ نئی انوائسز میں ظاہر نہیں ہوگا۔`
            )
      );
      if (deleteTarget?.id === updated.id) {
        setDeleteTarget(null);
        setDeleteBlockedInfo(null);
      }
    } catch (err: any) {
      setActionError(
        err?.message ||
          tr(
            'تعذر تغيير حالة المورد.',
            'Failed to change supplier status.',
            'سپلائر کی حیثیت تبدیل نہیں ہو سکی۔'
          )
      );
    } finally {
      setTogglingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!canDelete || !deleteTarget || !userProfile || !currentOrg?.id || isDeleting) return;
    setIsDeleting(true);
    setActionError(null);
    setDeleteBlockedInfo(null);

    try {
      const res = await deleteSupplierSafely({
        userProfile,
        orgId: currentOrg.id,
        targetSupplier: deleteTarget,
      });

      if (res.deleted) {
        const deletedName = deleteTarget.name;
        setSuppliers((prev) => prev.filter((s) => s.id !== res.supplierId));
        setDeleteTarget(null);
        setDeleteBlockedInfo(null);
        setSuccessMessage(
          tr(
            `تم حذف المورد "${deletedName}" نهائياً بنجاح.`,
            `Supplier "${deletedName}" permanently deleted.`,
            `سپلائر "${deletedName}" مستقل طور پر حذف کر دیا گیا۔`
          )
        );
      } else {
        setDeleteBlockedInfo({
          linkedPurchasesCount: res.linkedPurchasesCount,
          message: res.message,
        });
      }
    } catch (err: any) {
      setActionError(
        err?.message ||
          tr('تعذر حذف المورد.', 'Failed to delete supplier.', 'سپلائر حذف نہیں ہو سکا۔')
      );
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!canAccessManagement) {
    return (
      <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-6 sm:p-10 text-center max-w-2xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#0B1B32] dark:text-white">
          {tr(
            'غير مصرح بإدارة الموردين',
            'Not Authorized to Manage Suppliers',
            'سپلائرز کے انتظام کی اجازت نہیں'
          )}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {tr(
            'إدارة الموردين مقتصرة على مدير المؤسسة، وللمسؤول المخول بصلاحية إضافة الموردين فقط. يمكن لمسؤول الفرع اختيار الموردين المسجلين مسبقاً من شاشة إدخال المشتريات.',
            'Supplier management is restricted to the Organization Manager and supervisors authorized to add suppliers. Branch Managers can select existing suppliers directly from the Purchase Entry screen.',
            'سپلائرز کا انتظام صرف ادارے کے مینیجر اور مجاز سپروائزرز تک محدود ہے۔ برانچ مینیجرز خریداری اندراج اسکرین سے پہلے سے درج سپلائرز منتخب کر سکتے ہیں۔'
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
            {tr('إدارة الموردين', 'Suppliers Management', 'سپلائرز کا انتظام')}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{currentOrg?.name || tr('المؤسسة', 'Organization', 'ادارہ')}</span>
            <span aria-hidden="true">·</span>
            <span>{getUserRoleLabel(userProfile?.role, language)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {tr('الإجمالي', 'Total', 'کل')} {counts.total} ({tr('نشط', 'Active', 'فعال')}{' '}
              {counts.active} / {tr('موقوف', 'Inactive', 'غیر فعال')} {counts.inactive})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSuppliers()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF]/50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{tr('تحديث', 'Refresh', 'تازہ کریں')}</span>
          </button>

          {canCreate && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] transition-colors whitespace-nowrap shrink-0 shadow-sm shadow-[#1764FF]/20"
            >
              <Plus className="w-4 h-4" />
              <span>{tr('إضافة مورد جديد', 'Add New Supplier', 'نیا سپلائر شامل کریں')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Supervisor Add-Only Scope Notice */}
      {!canEdit && canCreate && (
        <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2.5">
          <Truck className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF] shrink-0" />
          <span>
            {tr(
              'صلاحيتك الحالية تتيح لك استعراض الموردين وإضافة مورد جديد فقط. تعديل بيانات الموردين أو إيقافهم أو حذفهم مقتصر على مدير المؤسسة.',
              'Your current role allows viewing suppliers and adding new suppliers only. Editing, deactivating, or deleting suppliers is restricted to the Organization Manager.',
              'آپ کا موجودہ کردار صرف سپلائرز دیکھنے اور نیا سپلائر شامل کرنے کی اجازت دیتا ہے۔ ترمیم، معطلی یا حذف کرنا صرف ادارے کے مینیجر تک محدود ہے۔'
            )}
          </span>
        </div>
      )}

      {/* Feedback Banners */}
      {successMessage && (
        <div
          role="status"
          className="p-4 rounded-2xl bg-[#08C99B]/10 border border-[#08C99B]/30 text-[#048264] dark:text-[#08C99B] text-xs sm:text-sm flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            aria-label={tr('إغلاق الرسالة', 'Dismiss message', 'پیغام بند کریں')}
            className="p-1 hover:opacity-75"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {(actionError || loadError) && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs sm:text-sm flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <span>{actionError || loadError}</span>
          </div>
          {actionError && (
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label={tr('إغلاق التنبيه', 'Dismiss alert', 'انتباہ بند کریں')}
              className="p-1 text-rose-700 dark:text-rose-300 hover:opacity-75"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Search & Status Filter Toolbar */}
      <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#E6EEFC] dark:border-[#1F3B66] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr(
                'بحث باسم المورد، الرقم الضريبي، أو رقم الجوال...',
                'Search by supplier name, VAT ID, or phone...',
                'سپلائر نام، ٹیکس نمبر یا موبائل نمبر سے تلاش کریں...'
              )}
              aria-label={tr('البحث عن مورد', 'Search supplier', 'سپلائر تلاش کریں')}
              className="w-full ps-10 pe-3.5 py-2.5 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
            />
          </div>

          <div
            role="tablist"
            aria-label={tr('تصفية حالة الموردين', 'Filter supplier status', 'سپلائرز کی حالت فلٹر کریں')}
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] self-start sm:self-auto"
          >
            {(
              [
                { id: 'all', label: `${tr('الكل', 'All', 'سب')} (${counts.total})` },
                { id: 'active', label: `${tr('نشط', 'Active', 'فعال')} (${counts.active})` },
                { id: 'inactive', label: `${tr('موقوف', 'Inactive', 'غیر فعال')} (${counts.inactive})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-white dark:bg-[#122543] text-[#1764FF] dark:text-[#6CA2FF] shadow-sm border border-[#1764FF]/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#0B1B32] dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="p-6 space-y-3" aria-busy="true">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="h-12 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] animate-pulse"
              />
            ))}
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="p-8 sm:p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-400 flex items-center justify-center mx-auto">
              <Truck className="w-6 h-6" />
            </div>
            <h3 className="text-sm sm:text-base font-bold text-[#0B1B32] dark:text-white">
              {suppliers.length === 0
                ? tr(
                    'لا يوجد موردون مسجلون في المؤسسة بعد',
                    'No suppliers registered in this organization yet',
                    'اس ادارے میں ابھی کوئی سپلائر درج نہیں ہے'
                  )
                : tr('لا توجد نتائج مطابقة للبحث', 'No matching results found', 'تلاش کے مطابق کوئی نتیجہ نہیں ملا')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {suppliers.length === 0
                ? tr(
                    'أضف الموردين المعتمدين لمؤسستك ليتمكن المدير والمسؤولون ومسؤولو الفروع من اختيارهم عند تسجيل فواتير المشتريات.',
                    'Add approved suppliers for your organization so managers, supervisors, and branch managers can select them on purchase invoices.',
                    'اپنے ادارے کے منظور شدہ سپلائرز شامل کریں تاکہ مینیجرز، سپروائزرز اور برانچ مینیجرز خریداری انوائسز میں انہیں منتخب کر سکیں۔'
                  )
                : tr(
                    'جرّب تعديل كلمات البحث أو تغيير تصفية الحالة.',
                    'Try adjusting your search keywords or status filter.',
                    'اپنے تلاش کے الفاظ یا حالت کا فلٹر تبدیل کرنے کی کوشش کریں۔'
                  )}
            </p>
            {suppliers.length === 0 && canCreate && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>{tr('إضافة أول مورد', 'Add First Supplier', 'پہلا سپلائر شامل کریں')}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-start border-collapse">
                <thead>
                  <tr className="bg-[#F5F8FF] dark:bg-[#0E203A] border-b border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-bold text-slate-600 dark:text-slate-400">
                    <th className="py-3 px-4 text-start">{tr('اسم المورد', 'Supplier Name', 'سپلائر کا نام')}</th>
                    <th className="py-3 px-4 text-start">{tr('الرقم الضريبي', 'Tax / VAT ID', 'ٹیکس نمبر')}</th>
                    <th className="py-3 px-4 text-start">{tr('رقم الجوال', 'Phone', 'موبائل نمبر')}</th>
                    <th className="py-3 px-4 text-start">{tr('العنوان', 'Address', 'پتہ')}</th>
                    <th className="py-3 px-4 text-start">{tr('الملاحظات', 'Notes', 'نوٹس')}</th>
                    <th className="py-3 px-4 text-start">{tr('الحالة', 'Status', 'حالت')}</th>
                    {(canEdit || canToggle || canDelete) && (
                      <th className="py-3 px-4 text-center w-40">{tr('إجراءات', 'Actions', 'اقدامات')}</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66]/70 text-sm">
                  {filteredSuppliers.map((sup) => (
                    <tr
                      key={sup.id}
                      className={`hover:bg-[#F5F8FF]/70 dark:hover:bg-[#173056]/40 transition-colors ${
                        !sup.isActive ? 'opacity-70' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 align-top">
                        <p className="font-bold text-[#0B1B32] dark:text-white">{sup.name}</p>
                        {(sup.companyName || sup.contactPerson || sup.openingBalance !== undefined) && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5 mt-0.5">
                            {sup.companyName && <span>{sup.companyName}</span>}
                            {sup.companyName && sup.contactPerson && <span aria-hidden="true">·</span>}
                            {sup.contactPerson && (
                              <span>
                                {tr('المسؤول:', 'Contact:', 'رابطہ شخص:')} {sup.contactPerson}
                              </span>
                            )}
                            {sup.openingBalance !== undefined && sup.openingBalance > 0 && (
                              <>
                                {(sup.companyName || sup.contactPerson) && (
                                  <span aria-hidden="true">·</span>
                                )}
                                <span className="font-mono tabular-nums">
                                  {tr('رصيد افتتاحي:', 'Opening Bal:', 'ابتدائی بیلنس:')}{' '}
                                  {formatCurrency(sup.openingBalance, currency, language)}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 align-top font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap" dir="ltr">
                        {sup.taxNumber || '—'}
                      </td>
                      <td className="py-3.5 px-4 align-top font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap" dir="ltr">
                        {sup.phone || '—'}
                      </td>
                      <td className="py-3.5 px-4 align-top text-xs text-slate-600 dark:text-slate-400 max-w-[200px]">
                        <span className="line-clamp-2">{sup.address || '—'}</span>
                      </td>
                      <td className="py-3.5 px-4 align-top text-xs text-slate-600 dark:text-slate-400 max-w-[220px]">
                        <span className="line-clamp-2">{sup.notes || '—'}</span>
                      </td>
                      <td className="py-3.5 px-4 align-top text-xs font-bold whitespace-nowrap">
                        <span
                          className={
                            sup.isActive
                              ? 'text-[#048264] dark:text-[#08C99B]'
                              : 'text-slate-500 dark:text-slate-400'
                          }
                        >
                          {sup.isActive
                            ? tr('نشط', 'Active', 'فعال')
                            : tr('موقوف', 'Inactive', 'غیر فعال')}
                        </span>
                      </td>
                      {(canEdit || canToggle || canDelete) && (
                        <td className="py-3 px-4 align-top">
                          <div className="flex items-center justify-center gap-1.5">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditModal(sup)}
                                title={tr('تعديل بيانات المورد', 'Edit Supplier', 'سپلائر میں ترمیم کریں')}
                                aria-label={`${tr('تعديل المورد', 'Edit supplier', 'سپلائر ترمیم')} ${sup.name}`}
                                className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-[#1764FF] dark:hover:text-[#6CA2FF] hover:bg-[#1764FF]/10 transition-colors"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            )}
                            {canToggle && (
                              <button
                                type="button"
                                onClick={() => void handleToggleStatus(sup)}
                                disabled={togglingId === sup.id}
                                title={
                                  sup.isActive
                                    ? tr('إيقاف المورد', 'Deactivate Supplier', 'سپلائر غیر فعال کریں')
                                    : tr('إعادة تفعيل المورد', 'Reactivate Supplier', 'سپلائر دوبارہ فعال کریں')
                                }
                                aria-label={
                                  sup.isActive
                                    ? `${tr('إيقاف المورد', 'Deactivate supplier', 'سپلائر غیر فعال')} ${sup.name}`
                                    : `${tr('تفعيل المورد', 'Activate supplier', 'سپلائر فعال')} ${sup.name}`
                                }
                                className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${
                                  sup.isActive
                                    ? 'text-slate-500 hover:text-amber-600 hover:bg-amber-500/10'
                                    : 'text-[#048264] dark:text-[#08C99B] hover:bg-[#08C99B]/10'
                                }`}
                              >
                                {sup.isActive ? (
                                  <PauseCircle className="w-4 h-4" />
                                ) : (
                                  <PlayCircle className="w-4 h-4" />
                                )}
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteTarget(sup);
                                  setDeleteBlockedInfo(null);
                                  setActionError(null);
                                }}
                                title={tr('حذف المورد', 'Delete Supplier', 'سپلائر حذف کریں')}
                                aria-label={`${tr('حذف المورد', 'Delete supplier', 'سپلائر حذف')} ${sup.name}`}
                                className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards */}
            <div className="md:hidden divide-y divide-[#DCE6FA] dark:divide-[#1F3B66]">
              {filteredSuppliers.map((sup) => (
                <div
                  key={sup.id}
                  className={`p-4 space-y-3 ${!sup.isActive ? 'opacity-75' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-[#0B1B32] dark:text-white truncate">
                        {sup.name}
                      </h3>
                      {sup.companyName && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {sup.companyName}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-xs font-bold shrink-0 ${
                        sup.isActive
                          ? 'text-[#048264] dark:text-[#08C99B]'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {sup.isActive
                        ? tr('نشط', 'Active', 'فعال')
                        : tr('موقوف', 'Inactive', 'غیر فعال')}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex items-center justify-between gap-2">
                      <span>{tr('الرقم الضريبي:', 'Tax ID:', 'ٹیکس نمبر:')}</span>
                      <span className="font-mono tabular-nums text-[#0B1B32] dark:text-slate-200" dir="ltr">
                        {sup.taxNumber || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{tr('الجوال:', 'Phone:', 'موبائل:')}</span>
                      </span>
                      <span className="font-mono tabular-nums text-[#0B1B32] dark:text-slate-200" dir="ltr">
                        {sup.phone || '—'}
                      </span>
                    </div>
                    {sup.address && (
                      <div className="flex items-start gap-1.5 pt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span>{sup.address}</span>
                      </div>
                    )}
                    {sup.notes && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-[#E6EEFC] dark:border-[#1F3B66]/70">
                        {sup.notes}
                      </p>
                    )}
                  </div>

                  {(canEdit || canToggle || canDelete) && (
                    <div className="flex items-center gap-2 pt-2 border-t border-[#E6EEFC] dark:border-[#1F3B66]/70">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => openEditModal(sup)}
                          className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-[#0B1B32] dark:text-slate-200 bg-[#F5F8FF] dark:bg-[#0E203A] hover:bg-[#1764FF]/15 hover:text-[#1764FF] transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>{tr('تعديل', 'Edit', 'ترمیم')}</span>
                        </button>
                      )}
                      {canToggle && (
                        <button
                          type="button"
                          onClick={() => void handleToggleStatus(sup)}
                          disabled={togglingId === sup.id}
                          className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-[#0B1B32] dark:text-slate-200 bg-[#F5F8FF] dark:bg-[#0E203A] transition-colors disabled:opacity-50"
                        >
                          {sup.isActive ? (
                            <>
                              <PauseCircle className="w-3.5 h-3.5" />
                              <span>{tr('إيقاف', 'Deactivate', 'غیر فعال')}</span>
                            </>
                          ) : (
                            <>
                              <PlayCircle className="w-3.5 h-3.5" />
                              <span>{tr('تفعيل', 'Activate', 'فعال کریں')}</span>
                            </>
                          )}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteTarget(sup);
                            setDeleteBlockedInfo(null);
                            setActionError(null);
                          }}
                          className="min-w-[44px] min-h-[42px] inline-flex items-center justify-center p-2 rounded-xl text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition-colors"
                          aria-label={`${tr('حذف المورد', 'Delete supplier', 'سپلائر حذف')} ${sup.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Add / Edit Supplier Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1B32]/65 backdrop-blur-xs"
        >
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] shadow-2xl">
            <div className="p-5 border-b border-[#E6EEFC] dark:border-[#1F3B66] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#1764FF]/12 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3
                    id="supplier-modal-title"
                    className="text-base font-bold text-[#0B1B32] dark:text-white"
                  >
                    {editingSupplier
                      ? tr('تعديل بيانات المورد', 'Edit Supplier Details', 'سپلائر کی تفصیلات میں ترمیم')
                      : tr('إضافة مورد جديد', 'Add New Supplier', 'نیا سپلائر شامل کریں')}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {editingSupplier
                      ? tr(
                          'تحديث بيانات المورد المسجل في دليل المؤسسة',
                          'Update supplier information in your organization directory',
                          'اپنے ادارے کی ڈائریکٹری میں سپلائر کی معلومات اپ ڈیٹ کریں'
                        )
                      : tr(
                          'تسجيل مورد جديد في دليل المؤسسة لاستخدامه في فواتير المشتريات',
                          'Register a new supplier in your organization directory for purchase invoices',
                          'خریداری انوائسز میں استعمال کے لیے نیا سپلائر درج کریں'
                        )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeFormModal}
                disabled={isSaving}
                aria-label={tr('إغلاق النافذة', 'Close modal', 'ونڈو بند کریں')}
                className="p-2 rounded-lg text-slate-400 hover:text-[#0B1B32] dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSupplier} noValidate className="p-5 space-y-4">
              {modalError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="supplier-name"
                  className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
                >
                  {tr('اسم المورد', 'Supplier Name', 'سپلائر کا نام')}{' '}
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  id="supplier-name"
                  type="text"
                  required
                  maxLength={120}
                  value={formState.name}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={isSaving}
                  placeholder={tr(
                    'مثال: شركة التوريد الغذائية الحديثة',
                    'e.g. Modern Food Supply Co.',
                    'مثال: ماڈرن فوڈ سپلائی کمپنی'
                  )}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="supplier-tax"
                    className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
                  >
                    {tr('رقم التسجيل الضريبي', 'VAT / Tax Registration Number', 'ٹیکس رجسٹریشن نمبر')}
                  </label>
                  <input
                    id="supplier-tax"
                    type="text"
                    maxLength={40}
                    dir="ltr"
                    value={formState.taxNumber}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, taxNumber: e.target.value }))
                    }
                    disabled={isSaving}
                    placeholder="300000000000003"
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="supplier-phone"
                    className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
                  >
                    {tr('رقم الجوال', 'Phone Number', 'موبائل نمبر')}
                  </label>
                  <input
                    id="supplier-phone"
                    type="tel"
                    maxLength={25}
                    dir="ltr"
                    value={formState.phone}
                    onChange={(e) => setFormState((prev) => ({ ...prev, phone: e.target.value }))}
                    disabled={isSaving}
                    placeholder="05XXXXXXXX"
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="supplier-address"
                  className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
                >
                  {tr('العنوان', 'Address', 'پتہ')}
                </label>
                <input
                  id="supplier-address"
                  type="text"
                  maxLength={255}
                  value={formState.address}
                  onChange={(e) => setFormState((prev) => ({ ...prev, address: e.target.value }))}
                  disabled={isSaving}
                  placeholder={tr('المدينة، الحي، الشارع...', 'City, District, Street...', 'شہر، علاقہ، گلی...')}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="supplier-notes"
                  className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
                >
                  {tr('الملاحظات', 'Notes', 'نوٹس')}
                </label>
                <textarea
                  id="supplier-notes"
                  rows={3}
                  maxLength={1000}
                  value={formState.notes}
                  onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
                  disabled={isSaving}
                  placeholder={tr(
                    'مواعيد التوريد، شروط السداد، أو أي ملاحظات إضافية...',
                    'Delivery schedule, payment terms, or any additional notes...',
                    'ڈیلیوری شیڈول، ادائیگی کی شرائط، یا کوئی اضافی نوٹس...'
                  )}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF] resize-y"
                />
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowOptionalFields((prev) => !prev)}
                  className="text-xs font-semibold text-[#1764FF] dark:text-[#6CA2FF] hover:underline"
                >
                  {showOptionalFields
                    ? tr('إخفاء البيانات الإضافية', 'Hide Additional Fields', 'اضافی تفصیلات چھپائیں')
                    : tr(
                        '+ بيانات إضافية اختيارية (الشركة، الشخص المسؤول، البريد، الرصيد الافتتاحي)',
                        '+ Optional Details (Company, Contact Person, Email, Opening Balance)',
                        '+ اختیاری تفصیلات (کمپنی، رابطہ شخص، ای میل، ابتدائی بیلنس)'
                      )}
                </button>
              </div>

              {showOptionalFields && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#E6EEFC] dark:border-[#1F3B66]">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="supplier-company"
                      className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
                    >
                      {tr('اسم الشركة / المؤسسة', 'Company / Entity Name', 'کمپنی / ادارے کا نام')}
                    </label>
                    <input
                      id="supplier-company"
                      type="text"
                      maxLength={150}
                      value={formState.companyName}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, companyName: e.target.value }))
                      }
                      disabled={isSaving}
                      className="w-full px-3.5 py-2 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="supplier-contact"
                      className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
                    >
                      {tr('الشخص المسؤول', 'Contact Person', 'رابطہ شخص')}
                    </label>
                    <input
                      id="supplier-contact"
                      type="text"
                      maxLength={120}
                      value={formState.contactPerson}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, contactPerson: e.target.value }))
                      }
                      disabled={isSaving}
                      className="w-full px-3.5 py-2 rounded-xl text-sm bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="supplier-email"
                      className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
                    >
                      {tr('البريد الإلكتروني', 'Email Address', 'ای میل پتہ')}
                    </label>
                    <input
                      id="supplier-email"
                      type="email"
                      maxLength={254}
                      dir="ltr"
                      value={formState.email}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, email: e.target.value }))
                      }
                      disabled={isSaving}
                      className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="supplier-opening-balance"
                      className="text-xs font-semibold text-[#0B1B32] dark:text-slate-200 block"
                    >
                      {tr('الرصيد الافتتاحي', 'Opening Balance', 'ابتدائی بیلنس')} ({currency})
                    </label>
                    <input
                      id="supplier-opening-balance"
                      type="number"
                      step="0.01"
                      min="0"
                      dir="ltr"
                      value={formState.openingBalance}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, openingBalance: e.target.value }))
                      }
                      disabled={isSaving}
                      placeholder="0.00"
                      className="w-full px-3.5 py-2 rounded-xl text-sm font-mono tabular-nums bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
                    />
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-[#E6EEFC] dark:border-[#1F3B66] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeFormModal}
                  disabled={isSaving}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-[#F5F8FF] dark:bg-[#0E203A] hover:bg-[#E6EEFC] dark:hover:bg-[#173056] transition-colors"
                >
                  {tr('إلغاء', 'Cancel', 'منسوخ')}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] transition-colors disabled:opacity-50"
                >
                  {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {editingSupplier
                      ? tr('حفظ التعديلات', 'Save Changes', 'تبدیلیاں محفوظ کریں')
                      : tr('حفظ المورد', 'Save Supplier', 'سپلائر محفوظ کریں')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Manager ONLY) */}
      {canDelete && deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-supplier-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1B32]/65 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3
                  id="delete-supplier-title"
                  className="text-base font-bold text-[#0B1B32] dark:text-white"
                >
                  {tr('تأكيد حذف المورد', 'Confirm Supplier Deletion', 'سپلائر حذف کرنے کی تصدیق')}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {language === 'ar' ? (
                    <>
                      هل تريد حذف المورد <strong className="text-[#0B1B32] dark:text-white">{deleteTarget.name}</strong>؟ سيتم التحقق أولاً من عدم ارتباطه بأي فواتير مشتريات مسجلة حفاظاً على سلامة السجلات المالية.
                    </>
                  ) : language === 'en' ? (
                    <>
                      Delete supplier <strong className="text-[#0B1B32] dark:text-white">{deleteTarget.name}</strong>? The system will first verify that no purchase invoices are linked to preserve financial integrity.
                    </>
                  ) : (
                    <>
                      کیا آپ سپلائر <strong className="text-[#0B1B32] dark:text-white">{deleteTarget.name}</strong> کو حذف کرنا چاہتے ہیں؟ مالی ریکارڈ کے تحفظ کے لیے پہلے تصدیق کی جائے گی کہ کوئی خریداری انوائس اس سے منسلک نہیں ہے۔
                    </>
                  )}
                </p>
              </div>
            </div>

            {deleteBlockedInfo && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs space-y-2"
              >
                <p className="leading-relaxed">{deleteBlockedInfo.message}</p>
                {deleteTarget.isActive && canToggle && (
                  <button
                    type="button"
                    onClick={() => void handleToggleStatus(deleteTarget)}
                    disabled={togglingId === deleteTarget.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1764FF] text-white hover:bg-[#1052D8] transition-colors"
                  >
                    <PauseCircle className="w-3.5 h-3.5" />
                    <span>
                      {tr(
                        'إيقاف المورد بدلاً من الحذف',
                        'Deactivate Supplier Instead',
                        'حذف کرنے کے بجائے سپلائر غیر فعال کریں'
                      )}
                    </span>
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6EEFC] dark:border-[#1F3B66]">
              <button
                type="button"
                onClick={() => {
                  if (!isDeleting) {
                    setDeleteTarget(null);
                    setDeleteBlockedInfo(null);
                  }
                }}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-[#F5F8FF] dark:bg-[#0E203A]"
              >
                {tr('إلغاء', 'Cancel', 'منسوخ')}
              </button>
              {!deleteBlockedInfo && (
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 transition-colors disabled:opacity-50"
                >
                  {isDeleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{tr('تأكيد الحذف', 'Confirm Delete', 'حذف کی تصدیق')}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
