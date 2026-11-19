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
  const { language } = useLanguage();
  const currency = currentOrg?.currency || 'SAR';

  // Strict RBAC capabilities derived exclusively from canonical permissions.ts
  const canCreate = useMemo(() => canUserCreateSupplier(userProfile), [userProfile]);
  const canEdit = useMemo(() => canUserEditSupplier(userProfile), [userProfile]);
  const canToggle = useMemo(() => canUserToggleSupplierStatus(userProfile), [userProfile]);
  const canDelete = useMemo(() => canUserDeleteSupplier(userProfile), [userProfile]);

  const canAccessManagement = canCreate;

  // Data state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search & filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Banners
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add/Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM);
  const [showOptionalFields, setShowOptionalFields] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const submitLockRef = useRef<boolean>(false);

  // Delete Confirmation Modal state (Manager ONLY)
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
      setLoadError(err?.message || 'تعذر تحميل قائمة الموردين.');
    } finally {
      setLoading(false);
    }
  }, [userProfile, currentOrg?.id, canAccessManagement]);

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
      setModalError('تعديل بيانات الموردين متاح لمدير المؤسسة فقط.');
      return;
    }
    if (!isEditing && !canCreate) {
      setModalError('لا تملك صلاحية إضافة مورد جديد.');
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
        setSuccessMessage(`تم تحديث بيانات المورد "${updated.name}" بنجاح.`);
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
        setSuccessMessage(`تم تسجيل المورد "${created.name}" بنجاح وإتاحته في فواتير المشتريات.`);
      }
      setIsModalOpen(false);
      setEditingSupplier(null);
      setFormState(EMPTY_FORM);
    } catch (err: any) {
      setModalError(err?.message || 'تعذر حفظ بيانات المورد. يرجى المحاولة مرة أخرى.');
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
          ? `تم تفعيل المورد "${updated.name}" بنجاح.`
          : `تم إيقاف المورد "${updated.name}" بنجاح ولن يظهر في الفواتير الجديدة مع الحفاظ على الفواتير السابقة.`
      );
      if (deleteTarget?.id === updated.id) {
        setDeleteTarget(null);
        setDeleteBlockedInfo(null);
      }
    } catch (err: any) {
      setActionError(err?.message || 'تعذر تغيير حالة المورد.');
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
        setSuccessMessage(`تم حذف المورد "${deletedName}" نهائياً بنجاح.`);
      } else {
        setDeleteBlockedInfo({
          linkedPurchasesCount: res.linkedPurchasesCount,
          message: res.message,
        });
      }
    } catch (err: any) {
      setActionError(err?.message || 'تعذر حذف المورد.');
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Defense-in-depth Access Guard (Branch Manager & Employee are strictly denied)
  if (!canAccessManagement) {
    return (
      <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 sm:p-10 text-center max-w-2xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          غير مصرح بإدارة الموردين
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          إدارة الموردين مقتصرة على مدير المؤسسة، وللمسؤول المخول بصلاحية إضافة الموردين فقط. يمكن لمسؤول الفرع اختيار الموردين المسجلين مسبقاً من شاشة إدخال المشتريات.
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
            إدارة الموردين
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{currentOrg?.name || 'المؤسسة'}</span>
            <span aria-hidden="true">·</span>
            <span>{getUserRoleLabel(userProfile?.role, language)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              الإجمالي {counts.total} (نشط {counts.active} / موقوف {counts.inactive})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSuppliers()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 hover:border-amber-500/40 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          {canCreate && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مورد جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Supervisor Add-Only Scope Notice */}
      {!canEdit && canCreate && (
        <div className="p-3.5 rounded-xl bg-slate-100/80 dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2.5">
          <Truck className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            صلاحيتك الحالية تتيح لك استعراض الموردين وإضافة مورد جديد فقط. تعديل بيانات الموردين أو إيقافهم أو حذفهم مقتصر على مدير المؤسسة.
          </span>
        </div>
      )}

      {/* Feedback Banners */}
      {successMessage && (
        <div
          role="status"
          className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            aria-label="إغلاق الرسالة"
            className="p-1 text-emerald-700 dark:text-emerald-300 hover:opacity-75"
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
              aria-label="إغلاق التنبيه"
              className="p-1 text-rose-700 dark:text-rose-300 hover:opacity-75"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Search & Status Filter Toolbar */}
      <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم المورد، الرقم الضريبي، أو رقم الجوال..."
              aria-label="البحث عن مورد"
              className="w-full ps-10 pe-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
            />
          </div>

          <div
            role="tablist"
            aria-label="تصفية حالة الموردين"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 self-start sm:self-auto"
          >
            {(
              [
                { id: 'all', label: `الكل (${counts.total})` },
                { id: 'active', label: `نشط (${counts.active})` },
                { id: 'inactive', label: `موقوف (${counts.inactive})` },
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
                    ? 'bg-white dark:bg-[#0c1829] text-amber-600 dark:text-amber-400 shadow-sm border border-amber-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
                className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800/60 animate-pulse"
              />
            ))}
          </div>
        ) : filteredSuppliers.length === 0 ? (
          /* Empty State */
          <div className="p-8 sm:p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto">
              <Truck className="w-6 h-6" />
            </div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
              {suppliers.length === 0
                ? 'لا يوجد موردون مسجلون في المؤسسة بعد'
                : 'لا توجد نتائج مطابقة للبحث'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {suppliers.length === 0
                ? 'أضف الموردين المعتمدين لمؤسستك ليتمكن المدير والمسؤولون ومسؤولو الفروع من اختيارهم عند تسجيل فواتير المشتريات.'
                : 'جرّب تعديل كلمات البحث أو تغيير تصفية الحالة.'}
            </p>
            {suppliers.length === 0 && canCreate && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة أول مورد</span>
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
                  <tr className="bg-slate-50 dark:bg-[#070e17]/70 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400">
                    <th className="py-3 px-4 text-start">اسم المورد</th>
                    <th className="py-3 px-4 text-start">الرقم الضريبي</th>
                    <th className="py-3 px-4 text-start">رقم الجوال</th>
                    <th className="py-3 px-4 text-start">العنوان</th>
                    <th className="py-3 px-4 text-start">الملاحظات</th>
                    <th className="py-3 px-4 text-start">الحالة</th>
                    {(canEdit || canToggle || canDelete) && (
                      <th className="py-3 px-4 text-center w-40">إجراءات</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                  {filteredSuppliers.map((sup) => (
                    <tr
                      key={sup.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors ${
                        !sup.isActive ? 'opacity-70' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 align-top">
                        <p className="font-bold text-slate-900 dark:text-white">{sup.name}</p>
                        {(sup.companyName || sup.contactPerson || sup.openingBalance !== undefined) && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5 mt-0.5">
                            {sup.companyName && <span>{sup.companyName}</span>}
                            {sup.companyName && sup.contactPerson && <span aria-hidden="true">·</span>}
                            {sup.contactPerson && <span>المسؤول: {sup.contactPerson}</span>}
                            {sup.openingBalance !== undefined && sup.openingBalance > 0 && (
                              <>
                                {(sup.companyName || sup.contactPerson) && (
                                  <span aria-hidden="true">·</span>
                                )}
                                <span className="font-mono tabular-nums">
                                  رصيد افتتاحي: {formatCurrency(sup.openingBalance, currency, language)}
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
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }
                        >
                          {sup.isActive ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      {(canEdit || canToggle || canDelete) && (
                        <td className="py-3 px-4 align-top">
                          <div className="flex items-center justify-center gap-1.5">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditModal(sup)}
                                title="تعديل بيانات المورد"
                                aria-label={`تعديل المورد ${sup.name}`}
                                className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            )}
                            {canToggle && (
                              <button
                                type="button"
                                onClick={() => void handleToggleStatus(sup)}
                                disabled={togglingId === sup.id}
                                title={sup.isActive ? 'إيقاف المورد' : 'إعادة تفعيل المورد'}
                                aria-label={
                                  sup.isActive
                                    ? `إيقاف المورد ${sup.name}`
                                    : `تفعيل المورد ${sup.name}`
                                }
                                className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${
                                  sup.isActive
                                    ? 'text-slate-500 hover:text-amber-600 hover:bg-amber-500/10'
                                    : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
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
                                title="حذف المورد"
                                aria-label={`حذف المورد ${sup.name}`}
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
            <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
              {filteredSuppliers.map((sup) => (
                <div
                  key={sup.id}
                  className={`p-4 space-y-3 ${!sup.isActive ? 'opacity-75' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
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
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {sup.isActive ? 'نشط' : 'موقوف'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex items-center justify-between gap-2">
                      <span>الرقم الضريبي:</span>
                      <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200" dir="ltr">
                        {sup.taxNumber || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>الجوال:</span>
                      </span>
                      <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200" dir="ltr">
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
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                        {sup.notes}
                      </p>
                    )}
                  </div>

                  {(canEdit || canToggle || canDelete) && (
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => openEditModal(sup)}
                          className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-amber-500/15 hover:text-amber-600 transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>تعديل</span>
                        </button>
                      )}
                      {canToggle && (
                        <button
                          type="button"
                          onClick={() => void handleToggleStatus(sup)}
                          disabled={togglingId === sup.id}
                          className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 transition-colors disabled:opacity-50"
                        >
                          {sup.isActive ? (
                            <>
                              <PauseCircle className="w-3.5 h-3.5" />
                              <span>إيقاف</span>
                            </>
                          ) : (
                            <>
                              <PlayCircle className="w-3.5 h-3.5" />
                              <span>تفعيل</span>
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
                          aria-label={`حذف المورد ${sup.name}`}
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
        >
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3
                    id="supplier-modal-title"
                    className="text-base font-bold text-slate-900 dark:text-white"
                  >
                    {editingSupplier ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {editingSupplier
                      ? 'تحديث بيانات المورد المسجل في دليل المؤسسة'
                      : 'تسجيل مورد جديد في دليل المؤسسة لاستخدامه في فواتير المشتريات'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeFormModal}
                disabled={isSaving}
                aria-label="إغلاق النافذة"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
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

              {/* Primary Required/Requested Fields */}
              <div className="space-y-1.5">
                <label
                  htmlFor="supplier-name"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
                >
                  اسم المورد <span className="text-rose-500">*</span>
                </label>
                <input
                  id="supplier-name"
                  type="text"
                  required
                  maxLength={120}
                  value={formState.name}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={isSaving}
                  placeholder="مثال: شركة التوريد الغذائية الحديثة"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="supplier-tax"
                    className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
                  >
                    رقم التسجيل الضريبي
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
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="supplier-phone"
                    className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
                  >
                    رقم الجوال
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
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="supplier-address"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
                >
                  العنوان
                </label>
                <input
                  id="supplier-address"
                  type="text"
                  maxLength={255}
                  value={formState.address}
                  onChange={(e) => setFormState((prev) => ({ ...prev, address: e.target.value }))}
                  disabled={isSaving}
                  placeholder="المدينة، الحي، الشارع..."
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="supplier-notes"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
                >
                  الملاحظات
                </label>
                <textarea
                  id="supplier-notes"
                  rows={3}
                  maxLength={1000}
                  value={formState.notes}
                  onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
                  disabled={isSaving}
                  placeholder="مواعيد التوريد، شروط السداد، أو أي ملاحظات إضافية..."
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 resize-y"
                />
              </div>

              {/* Optional Extended Business Details Toggle */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowOptionalFields((prev) => !prev)}
                  className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                >
                  {showOptionalFields
                    ? 'إخفاء البيانات الإضافية'
                    : '+ بيانات إضافية اختيارية (الشركة، الشخص المسؤول، البريد، الرصيد الافتتاحي)'}
                </button>
              </div>

              {showOptionalFields && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="supplier-company"
                      className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
                    >
                      اسم الشركة / المؤسسة
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
                      className="w-full px-3.5 py-2 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="supplier-contact"
                      className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
                    >
                      الشخص المسؤول
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
                      className="w-full px-3.5 py-2 rounded-xl text-sm bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="supplier-email"
                      className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
                    >
                      البريد الإلكتروني
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
                      className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="supplier-opening-balance"
                      className="text-xs font-semibold text-slate-700 dark:text-slate-300 block"
                    >
                      الرصيد الافتتاحي ({currency})
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
                      className="w-full px-3.5 py-2 rounded-xl text-sm font-mono tabular-nums bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeFormModal}
                  disabled={isSaving}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors disabled:opacity-50"
                >
                  {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingSupplier ? 'حفظ التعديلات' : 'حفظ المورد'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Manager ONLY — with Purchase Referential Integrity Guard) */}
      {canDelete && deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-supplier-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3
                  id="delete-supplier-title"
                  className="text-base font-bold text-slate-900 dark:text-white"
                >
                  تأكيد حذف المورد
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  هل تريد حذف المورد <strong className="text-slate-900 dark:text-white">{deleteTarget.name}</strong>؟ سيتم التحقق أولاً من عدم ارتباطه بأي فواتير مشتريات مسجلة حفاظاً على سلامة السجلات المالية.
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors"
                  >
                    <PauseCircle className="w-3.5 h-3.5" />
                    <span>إيقاف المورد بدلاً من الحذف</span>
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  if (!isDeleting) {
                    setDeleteTarget(null);
                    setDeleteBlockedInfo(null);
                  }
                }}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800"
              >
                إلغاء
              </button>
              {!deleteBlockedInfo && (
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 transition-colors disabled:opacity-50"
                >
                  {isDeleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>تأكيد الحذف</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
