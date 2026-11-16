import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { UserProfile, UserRole } from '../../types';
import {
  buildDefaultPermissionsForRole,
  getUserRoleLabel,
  resolveEffectivePermissions,
  resolvePrimaryAssignedBranchId,
  SUPERVISOR_OPTIONAL_PERMISSION_KEYS,
  SupervisorOptionalPermissionKey,
} from '../../utils/permissions';
import { formatCurrency } from '../../utils/accounting';
import {
  Users,
  Plus,
  ShieldCheck,
  UserX,
  UserCheck,
  GitBranch,
  Mail,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  X,
  Search,
  Archive,
  Send,
  History,
  SlidersHorizontal,
  Edit3,
  AlertTriangle,
  Building2,
} from 'lucide-react';

type StaffAssignableRole = 'employee' | 'branch_manager' | 'supervisor';
type StatusFilterValue = 'all' | 'active' | 'disabled' | 'archived';

const SUPERVISOR_PERMISSION_META: Record<
  SupervisorOptionalPermissionKey,
  { labelAr: string; labelEn: string; descAr: string; descEn: string }
> = {
  canCreateClosing: {
    labelAr: 'إنشاء وإرسال إقفالات الورديات',
    labelEn: 'Create & submit shift closings',
    descAr: 'يسمح له بتسجيل إقفال وردية على أي فرع داخل المؤسسة.',
    descEn: 'Allows recording shift closings on any organization branch.',
  },
  canViewAllClosings: {
    labelAr: 'عرض إقفالات جميع الفروع',
    labelEn: 'View all branches closings',
    descAr: 'يتيح الاطلاع على سجلات الإقفالات عبر كافة فروع المؤسسة.',
    descEn: 'Allows viewing shift closing records across all branches.',
  },
  canApproveClosings: {
    labelAr: 'اعتماد وإرجاع الإقفالات',
    labelEn: 'Approve & return closings',
    descAr: 'يتيح اعتماد أو إعادة الإقفالات المرسلة للمراجعة (دون التصحيح الإداري للمعتمد).',
    descEn: 'Allows approving or returning pending closings (without admin corrections).',
  },
  canViewFinancialReports: {
    labelAr: 'الاطلاع على التقارير المالية',
    labelEn: 'View financial reports',
    descAr: 'يفتح تبويب التقارير المالية وإجماليات المبيعات والصناديق.',
    descEn: 'Grants access to financial reports and summaries.',
  },
  canExportReports: {
    labelAr: 'تصدير وطباعة التقارير (CSV / Excel)',
    labelEn: 'Export & print reports',
    descAr: 'يتيح تصدير التقارير المالية وطباعتها عند تفعيل التقارير.',
    descEn: 'Allows downloading CSV/Excel reports and printing.',
  },
  canManagePurchases: {
    labelAr: 'إدارة المشتريات عبر جميع الفروع',
    labelEn: 'Manage org-wide purchases',
    descAr: 'صلاحية تسجيل المشتريات على كافة فروع المؤسسة في قواعد الأمان.',
    descEn: 'Authorizes recording purchases across all organization branches.',
  },
  canViewSuppliers: {
    labelAr: 'عرض الموردين المسجلين',
    labelEn: 'View registered suppliers',
    descAr: 'الاطلاع على قائمة الموردين المعتمدة في المؤسسة.',
    descEn: 'View pre-registered organization suppliers.',
  },
  canManageSuppliers: {
    labelAr: 'إضافة مورد جديد فقط',
    labelEn: 'Add new suppliers only',
    descAr: 'يسمح بإضافة موردين جدد فقط (لا يسمح بتعديل أو حذف الموردين).',
    descEn: 'Permits adding new suppliers only (editing/deleting remains blocked).',
  },
};

function createEmptySupervisorPermissions(): Record<SupervisorOptionalPermissionKey, boolean> {
  return {
    canCreateClosing: false,
    canViewAllClosings: false,
    canApproveClosings: false,
    canManagePurchases: false,
    canManageSuppliers: false,
    canViewSuppliers: false,
    canViewFinancialReports: false,
    canExportReports: false,
  };
}

function extractSupervisorPermissions(
  profile: UserProfile | null | undefined
): Record<SupervisorOptionalPermissionKey, boolean> {
  const base = createEmptySupervisorPermissions();
  if (!profile) return base;
  const resolved = buildDefaultPermissionsForRole('supervisor', {
    canCreateClosing: profile.permissions?.canCreateClosing === true,
    canViewAllClosings: profile.permissions?.canViewAllClosings === true,
    canApproveClosings: profile.permissions?.canApproveClosings === true,
    canManagePurchases: profile.permissions?.canManagePurchases === true,
    canManageSuppliers: profile.permissions?.canManageSuppliers === true,
    canViewSuppliers: profile.permissions?.canViewSuppliers === true,
    canViewFinancialReports: profile.permissions?.canViewFinancialReports === true,
    canExportReports: profile.permissions?.canExportReports === true,
  });
  for (const key of SUPERVISOR_OPTIONAL_PERMISSION_KEYS) {
    base[key] = resolved[key] === true;
  }
  return base;
}

export const EmployeesManager: React.FC = () => {
  const {
    employees,
    branches,
    closings,
    auditLogs,
    currentOrg,
    userProfile,
    createEmployeeAccount,
    updateEmployeeAccount,
    archiveEmployeeAccount,
    sendEmployeePasswordReset,
    toggleEmployeeStatus,
    updateEmployeeBranch,
  } = useAuth();
  const { t, language } = useLanguage();

  const isEn = language === 'en';

  const activeBranches = useMemo(
    () => branches.filter((b) => b.lifecycleStatus !== 'purged_from_db'),
    [branches]
  );

  // Filters & search state
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');

  // Create Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createRole, setCreateRole] = useState<StaffAssignableRole>('employee');
  const [createBranchId, setCreateBranchId] = useState(activeBranches[0]?.id || '');
  const [createSupPerms, setCreateSupPerms] = useState<
    Record<SupervisorOptionalPermissionKey, boolean>
  >(createEmptySupervisorPermissions);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Details & Edit Drawer/Modal State
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<StaffAssignableRole>('employee');
  const [editBranchId, setEditBranchId] = useState('');
  const [editSupPerms, setEditSupPerms] = useState<
    Record<SupervisorOptionalPermissionKey, boolean>
  >(createEmptySupervisorPermissions);
  const [editSaving, setEditSaving] = useState(false);
  const [resetSending, setResetSending] = useState(false);

  // Confirmation modal for disable / archive
  const [confirmAction, setConfirmAction] = useState<{
    type: 'disable' | 'archive';
    employee: UserProfile;
    reason: string;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Inline page-level feedback
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!createBranchId && activeBranches.length > 0) {
      setCreateBranchId(activeBranches[0].id);
    }
  }, [activeBranches, createBranchId]);

  const staffList = useMemo(
    () =>
      employees
        .filter((e) => e.role !== 'manager')
        .sort((a, b) => {
          const aArch = a.isArchived ? 2 : a.isActive === false ? 1 : 0;
          const bArch = b.isArchived ? 2 : b.isActive === false ? 1 : 0;
          if (aArch !== bArch) return aArch - bArch;
          return (a.displayName || '').localeCompare(b.displayName || '', 'ar');
        }),
    [employees]
  );

  const selectedEmployee = useMemo(
    () => staffList.find((e) => e.uid === selectedUid) || null,
    [staffList, selectedUid]
  );

  useEffect(() => {
    if (!selectedEmployee) return;
    setEditName(selectedEmployee.displayName || '');
    setEditEmail(selectedEmployee.email || '');
    setEditPhone(selectedEmployee.phone || '');
    const normalizedRole: StaffAssignableRole =
      selectedEmployee.role === 'supervisor' || selectedEmployee.role === 'branch_manager'
        ? selectedEmployee.role
        : 'employee';
    setEditRole(normalizedRole);
    setEditBranchId(
      resolvePrimaryAssignedBranchId(selectedEmployee) || activeBranches[0]?.id || ''
    );
    setEditSupPerms(extractSupervisorPermissions(selectedEmployee));
  }, [selectedEmployee?.uid]);

  const stats = useMemo(() => {
    const activeCount = staffList.filter((e) => e.isActive !== false && !e.isArchived).length;
    const supervisorsCount = staffList.filter((e) => e.role === 'supervisor').length;
    const branchManagersCount = staffList.filter((e) => e.role === 'branch_manager').length;
    const inactiveOrArchivedCount = staffList.filter(
      (e) => e.isActive === false || e.isArchived === true
    ).length;
    return {
      totalStaff: staffList.length,
      activeCount,
      supervisorsCount,
      branchManagersCount,
      inactiveOrArchivedCount,
    };
  }, [staffList]);

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return staffList.filter((emp) => {
      if (q) {
        const matchName = (emp.displayName || '').toLowerCase().includes(q);
        const matchEmail = (emp.email || '').toLowerCase().includes(q);
        const matchPhone = (emp.phone || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchPhone) return false;
      }
      if (roleFilter !== 'all' && emp.role !== roleFilter) return false;
      if (branchFilter === '__org_wide__') {
        if (emp.role !== 'supervisor') return false;
      } else if (branchFilter !== 'all') {
        if (resolvePrimaryAssignedBranchId(emp) !== branchFilter) return false;
      }
      if (statusFilter === 'active' && (emp.isActive === false || emp.isArchived === true)) {
        return false;
      }
      if (statusFilter === 'disabled' && (emp.isActive !== false || emp.isArchived === true)) {
        return false;
      }
      if (statusFilter === 'archived' && emp.isArchived !== true) {
        return false;
      }
      return true;
    });
  }, [staffList, searchQuery, roleFilter, branchFilter, statusFilter]);

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    roleFilter !== 'all' ||
    branchFilter !== 'all' ||
    statusFilter !== 'all';

  const employeeActivity = useMemo(() => {
    if (!selectedEmployee) return { closings: [], logs: [] };
    const empClosings = closings
      .filter((c) => c.employeeId === selectedEmployee.uid || c.reviewedBy === selectedEmployee.uid)
      .slice(0, 8);
    const empLogs = auditLogs
      .filter((l) => l.targetId === selectedEmployee.uid || l.actorId === selectedEmployee.uid)
      .slice(0, 10);
    return { closings: empClosings, logs: empLogs };
  }, [selectedEmployee, closings, auditLogs]);

  const handleToggleSupPerm = (
    setter: React.Dispatch<React.SetStateAction<Record<SupervisorOptionalPermissionKey, boolean>>>,
    key: SupervisorOptionalPermissionKey
  ) => {
    setter((prev) => {
      const nextVal = !prev[key];
      const updated = { ...prev, [key]: nextVal };
      if (key === 'canViewFinancialReports' && nextVal && !prev.canExportReports) {
        updated.canExportReports = true;
      }
      if (key === 'canManageSuppliers' && nextVal && !prev.canViewSuppliers) {
        updated.canViewSuppliers = true;
      }
      return updated;
    });
  };

  const resetCreateForm = () => {
    setCreateName('');
    setCreateEmail('');
    setCreatePassword('');
    setCreatePhone('');
    setCreateRole('employee');
    setCreateBranchId(activeBranches[0]?.id || '');
    setCreateSupPerms(createEmptySupervisorPermissions());
    setCreateError(null);
    setCreateSuccess(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim() || !createEmail.trim() || !createPassword) return;

    setCreateLoading(true);
    setCreateError(null);
    setCreateSuccess(null);

    const targetBranch =
      createRole === 'supervisor'
        ? undefined
        : activeBranches.find((b) => b.id === createBranchId) || activeBranches[0];

    try {
      const created = await createEmployeeAccount({
        email: createEmail.trim(),
        password: createPassword,
        displayName: createName.trim(),
        role: createRole,
        branchId: targetBranch?.id,
        branchName: targetBranch?.name,
        phone: createPhone.trim(),
        supervisorPermissions: createRole === 'supervisor' ? createSupPerms : undefined,
      });

      setCreateSuccess(
        `تم إنشاء حساب ${getUserRoleLabel(created.role, language)} (${created.displayName}) بنجاح دون تسجيل خروجك.`
      );
      setActionFeedback({
        type: 'success',
        message: `تم إضافة ${created.displayName} بدور "${getUserRoleLabel(created.role, language)}" بنجاح.`,
      });
      setTimeout(() => {
        setCreateOpen(false);
        resetCreateForm();
      }, 1400);
    } catch (err: any) {
      setCreateError(err?.message || 'فشل إنشاء الحساب.');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    setEditSaving(true);
    setActionFeedback(null);
    try {
      await updateEmployeeAccount({
        employeeUid: selectedEmployee.uid,
        displayName: editName,
        email: editEmail,
        phone: editPhone,
        role: editRole,
        branchId: editRole === 'supervisor' ? undefined : editBranchId,
        supervisorPermissions: editRole === 'supervisor' ? editSupPerms : undefined,
      });
      setActionFeedback({
        type: 'success',
        message: `تم حفظ تحديثات "${editName}" وتوثيقها في سجل الرقابة.`,
      });
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'تعذر حفظ تعديلات الموظف.',
      });
    } finally {
      setEditSaving(false);
    }
  };

  const handleSendPasswordReset = async () => {
    if (!selectedEmployee || resetSending) return;
    setResetSending(true);
    setActionFeedback(null);
    try {
      const sentTo = await sendEmployeePasswordReset(selectedEmployee.uid);
      setActionFeedback({
        type: 'success',
        message: `تم إرسال رابط إعادة تعيين كلمة المرور عبر Firebase إلى البريد (${sentTo}) وتوثيق العملية في سجل الرقابة.`,
      });
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'تعذر إرسال رابط إعادة تعيين كلمة المرور.',
      });
    } finally {
      setResetSending(false);
    }
  };

  const handleConfirmLifecycleAction = async () => {
    if (!confirmAction || confirmBusy) return;
    setConfirmBusy(true);
    setActionFeedback(null);
    try {
      if (confirmAction.type === 'disable') {
        await toggleEmployeeStatus(confirmAction.employee.uid, false);
        setActionFeedback({
          type: 'success',
          message: `تم تعطيل حساب "${confirmAction.employee.displayName}" مؤقتاً مع الحفاظ الكامل على سجلاته السابقة.`,
        });
      } else {
        await archiveEmployeeAccount(confirmAction.employee.uid, confirmAction.reason);
        setActionFeedback({
          type: 'success',
          message: `تمت أرشفة حساب "${confirmAction.employee.displayName}" وإيقاف دخوله مع الإبقاء التام على جميع الإقفالات والسجلات التاريخية.`,
        });
      }
      setConfirmAction(null);
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'تعذر تنفيذ الإجراء.',
      });
    } finally {
      setConfirmBusy(false);
    }
  };

  const renderRoleBadge = (role: UserRole) => {
    if (role === 'manager') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          {getUserRoleLabel(role, language)}
        </span>
      );
    }
    if (role === 'supervisor') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30">
          {getUserRoleLabel(role, language)}
        </span>
      );
    }
    if (role === 'branch_manager') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
          {getUserRoleLabel(role, language)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/30">
        {getUserRoleLabel(role, language)}
      </span>
    );
  };

  const renderStatusBadge = (emp: UserProfile) => {
    if (emp.isArchived) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
          <Archive className="w-3 h-3" />
          <span>{t('empStatusArchived')}</span>
        </span>
      );
    }
    if (emp.isActive === false) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
          <UserX className="w-3 h-3" />
          <span>{t('empStatusDisabled')}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
        <UserCheck className="w-3 h-3" />
        <span>{t('empStatusActive')}</span>
      </span>
    );
  };

  const getBranchName = (emp: UserProfile): string => {
    if (emp.role === 'supervisor') return t('empOrgWideScope');
    const assignedId = resolvePrimaryAssignedBranchId(emp);
    if (!assignedId) return '—';
    const match = branches.find((b) => b.id === assignedId);
    return match?.name || emp.branchName || assignedId;
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-500" />
            <span>
              {t('empManageTitle')} ({staffList.length})
            </span>
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('empManageSubtitle')}
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            resetCreateForm();
            setCreateOpen(true);
          }}
          className="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-amber-400 hover:bg-amber-300 transition-all flex items-center gap-2 shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{t('empAddButton')}</span>
        </button>
      </div>

      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{actionFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className="opacity-70 hover:opacity-100 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-1">
            إجمالي أعضاء الطاقم
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {stats.totalStaff}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-1">
            الحسابات النشطة
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-500">
            {stats.activeCount}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-1">
            المسؤولون ومسؤولو الفروع
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-sky-500">
            {stats.supervisorsCount + stats.branchManagersCount}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-1">
            معطل / مؤرشف
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-rose-500">
            {stats.inactiveOrArchivedCount}
          </div>
        </div>
      </section>

      {/* Search & Filters */}
      <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('empSearchPlaceholder')}
              className="w-full ps-9 pe-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:border-amber-500"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
            className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
          >
            <option value="all">{t('empAllRoles')}</option>
            <option value="supervisor">{getUserRoleLabel('supervisor', language)}</option>
            <option value="branch_manager">{getUserRoleLabel('branch_manager', language)}</option>
            <option value="employee">{getUserRoleLabel('employee', language)}</option>
          </select>

          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
          >
            <option value="all">{t('empAllBranches')}</option>
            <option value="__org_wide__">{t('empOrgWideScope')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
              className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
            >
              <option value="all">{t('empAllStatuses')}</option>
              <option value="active">{t('empStatusActive')}</option>
              <option value="disabled">{t('empStatusDisabled')}</option>
              <option value="archived">{t('empStatusArchived')}</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setRoleFilter('all');
                  setBranchFilter('all');
                  setStatusFilter('all');
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 border border-amber-500/30 whitespace-nowrap shrink-0"
              >
                {t('empResetFilters')}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Mobile Cards View (< 768px) */}
      <div className="block md:hidden space-y-3">
        {/* Pinned Organization Manager Card */}
        <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/30 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold text-sm text-slate-900 dark:text-white">
              {userProfile?.displayName} (أنت)
            </div>
            {renderRoleBadge('manager')}
          </div>
          <div className="text-xs font-mono text-slate-500 dark:text-slate-400" dir="ltr">
            {userProfile?.email}
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between pt-1">
            <span>{t('empOrgWideScope')}</span>
            <span className="text-amber-500 font-semibold">{t('empStatusActive')}</span>
          </div>
        </div>

        {filteredStaff.map((emp) => (
          <div
            key={emp.uid}
            className="p-4 rounded-2xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 shadow-sm space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {emp.displayName}
                </div>
                <div
                  className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate"
                  dir="ltr"
                >
                  {emp.email}
                </div>
              </div>
              {renderStatusBadge(emp)}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              {renderRoleBadge(emp.role)}
              <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1">
                <GitBranch className="w-3.5 h-3.5 text-amber-500" />
                <span>{getBranchName(emp)}</span>
              </span>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedUid(emp.uid)}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white flex items-center justify-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5 text-amber-500" />
                <span>{t('empDetailsAction')}</span>
              </button>
              {emp.isActive ? (
                <button
                  type="button"
                  onClick={() =>
                    setConfirmAction({ type: 'disable', employee: emp, reason: '' })
                  }
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-500 border border-rose-500/30 hover:bg-rose-500/10"
                >
                  تعطيل
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleEmployeeStatus(emp.uid, true)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-amber-500 border border-amber-500/30 hover:bg-amber-500/10"
                >
                  تنشيط
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View (>= 768px) */}
      <div className="hidden md:block bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-x-auto">
        <table className="w-full text-start text-xs sm:text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="p-4 text-start">الاسم والهاتف</th>
              <th className="p-4 text-start">البريد الإلكتروني</th>
              <th className="p-4 text-start">الدور</th>
              <th className="p-4 text-start">الفرع / النطاق</th>
              <th className="p-4 text-start">الحالة</th>
              <th className="p-4 text-start">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {/* Pinned Organization Manager Row */}
            <tr className="bg-amber-500/5">
              <td className="p-4 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold text-xs shrink-0">
                  ★
                </div>
                <span>{userProfile?.displayName} (أنت)</span>
              </td>
              <td className="p-4 font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                {userProfile?.email}
              </td>
              <td className="p-4">{renderRoleBadge('manager')}</td>
              <td className="p-4 text-xs text-slate-700 dark:text-slate-300">
                {t('empOrgWideScope')}
              </td>
              <td className="p-4">
                <span className="text-xs font-semibold text-amber-500">نشط دائماً</span>
              </td>
              <td className="p-4 text-xs text-slate-400">مالك المؤسسة</td>
            </tr>

            {filteredStaff.map((emp) => {
              const assignedBranchId = resolvePrimaryAssignedBranchId(emp) || '';
              return (
                <tr
                  key={emp.uid}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="p-4">
                    <div className="font-bold text-slate-900 dark:text-white">
                      {emp.displayName}
                    </div>
                    {emp.phone && (
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5" dir="ltr">
                        {emp.phone}
                      </div>
                    )}
                  </td>
                  <td className="p-4 font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                    {emp.email}
                  </td>
                  <td className="p-4">{renderRoleBadge(emp.role)}</td>
                  <td className="p-4">
                    {emp.role === 'supervisor' ? (
                      <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                        {t('empOrgWideScope')}
                      </span>
                    ) : (
                      <select
                        value={assignedBranchId}
                        disabled={emp.isArchived === true}
                        onChange={(e) => {
                          const target = activeBranches.find((b) => b.id === e.target.value);
                          if (target) {
                            updateEmployeeBranch(emp.uid, target.id, target.name).catch(
                              (err: any) =>
                                setActionFeedback({
                                  type: 'error',
                                  message: err?.message || 'فشل تغيير الفرع.',
                                })
                            );
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-50"
                      >
                        {activeBranches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="p-4">{renderStatusBadge(emp)}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedUid(emp.uid)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-white transition-colors inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-amber-500" />
                        <span>{t('empDetailsAction')}</span>
                      </button>

                      {emp.isActive ? (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmAction({ type: 'disable', employee: emp, reason: '' })
                          }
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-500 hover:bg-rose-500/10 border border-rose-500/20 transition-colors"
                        >
                          تعطيل
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            toggleEmployeeStatus(emp.uid, true).catch((err: any) =>
                              setActionFeedback({
                                type: 'error',
                                message: err?.message || 'فشل التنشيط.',
                              })
                            )
                          }
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-amber-500 hover:bg-amber-500/10 border border-amber-500/20 transition-colors"
                        >
                          إعادة التنشيط
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredStaff.length === 0 && (
          <div className="py-10 text-center text-xs text-slate-400">
            {staffList.length === 0
              ? 'لم تقم بإضافة أي موظفين أو مسؤولي فروع أو مسؤولين بعد. اضغط على "إضافة موظف جديد" للبدء.'
              : 'لا توجد نتائج مطابقة للبحث أو الفلاتر الحالية.'}
          </div>
        )}
      </div>

      {/* Add Staff Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-500" />
                <span>إضافة عضو جديد للطاقم</span>
              </h4>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            {createSuccess && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{createSuccess}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    الاسم الكامل *
                  </label>
                  <input
                    type="text"
                    required
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="مثال: خالد المحاسب"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    رقم الهاتف (اختياري)
                  </label>
                  <input
                    type="text"
                    value={createPhone}
                    onChange={(e) => setCreatePhone(e.target.value)}
                    placeholder="05xxxxxxxx"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    البريد الإلكتروني لتسجيل الدخول *
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={createEmail}
                      onChange={(e) => setCreateEmail(e.target.value)}
                      placeholder="staff@company.com"
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:border-amber-500"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute end-3 top-3 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    كلمة المرور الأولية (6 خانات فأكثر) *
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:border-amber-500"
                    />
                    <KeyRound className="w-4 h-4 text-slate-400 absolute end-3 top-3 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Role Picker */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  الدور الوظيفي *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      {
                        role: 'employee',
                        title: getUserRoleLabel('employee', language),
                        hint: 'تسجيل الإقفالات في فرع واحد فقط',
                      },
                      {
                        role: 'branch_manager',
                        title: getUserRoleLabel('branch_manager', language),
                        hint: 'إقفالات + مشتريات فرع واحد وعرض الموردين',
                      },
                      {
                        role: 'supervisor',
                        title: getUserRoleLabel('supervisor', language),
                        hint: 'على مستوى المؤسسة بصلاحيات تفعّلها أنت',
                      },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.role}
                      type="button"
                      onClick={() => setCreateRole(item.role)}
                      className={`p-3 rounded-xl border text-start transition-all ${
                        createRole === item.role
                          ? 'bg-amber-500/15 border-amber-500 text-slate-900 dark:text-white'
                          : 'bg-slate-50 dark:bg-[#070e17] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                      }`}
                    >
                      <div className="text-xs font-bold">{item.title}</div>
                      <div className="text-[11px] opacity-80 mt-0.5 leading-snug">{item.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Single branch selector for employee / branch_manager */}
              {createRole !== 'supervisor' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    الفرع المخصص (فرع واحد فقط) *
                  </label>
                  <select
                    required
                    value={createBranchId}
                    onChange={(e) => setCreateBranchId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-white"
                  >
                    {activeBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Supervisor Optional Permissions (All OFF by default) */}
              {createRole === 'supervisor' && (
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
                      <span>صلاحيات المسؤول الاختيارية (معطلة افتراضياً)</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {SUPERVISOR_OPTIONAL_PERMISSION_KEYS.map((permKey) => {
                      const meta = SUPERVISOR_PERMISSION_META[permKey];
                      const checked = createSupPerms[permKey] === true;
                      return (
                        <label
                          key={permKey}
                          className={`p-2.5 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-colors ${
                            checked
                              ? 'bg-amber-500/10 border-amber-500/40 text-slate-900 dark:text-white'
                              : 'bg-white dark:bg-[#0c1829] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleSupPerm(setCreateSupPerms, permKey)}
                            className="mt-0.5 rounded border-slate-400 text-amber-500 focus:ring-amber-500"
                          />
                          <div>
                            <div className="font-bold">
                              {isEn ? meta.labelEn : meta.labelAr}
                            </div>
                            <div className="text-[11px] opacity-75 leading-snug">
                              {isEn ? meta.descEn : meta.descAr}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300">
                ملاحظة أمنية: يتم إنشاء الحساب عبر جلسة معزولة دون تسجيل خروجك، ولا تُحفظ كلمة المرور الأولية في قاعدة البيانات أو السجلات.
              </div>

              <button
                type="submit"
                disabled={createLoading}
                className="w-full py-3 rounded-xl font-bold text-xs text-slate-950 bg-amber-400 hover:bg-amber-300 transition-all disabled:opacity-50 shadow-sm"
              >
                {createLoading ? 'جاري إنشاء الحساب...' : 'تأكيد إنشاء الحساب'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Employee Details, Edit & Activity Drawer/Modal */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0c1829] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            {/* Drawer Header */}
            <div className="p-5 sm:p-6 bg-[#0b192c] text-white flex items-center justify-between gap-3 border-b border-amber-500/20 sticky top-0 z-10">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-base font-bold truncate">{selectedEmployee.displayName}</h4>
                  {renderRoleBadge(selectedEmployee.role)}
                  {renderStatusBadge(selectedEmployee)}
                </div>
                <div className="text-xs font-mono text-slate-300 mt-1" dir="ltr">
                  {selectedEmployee.email}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUid(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-6">
              {/* Edit Profile, Role & Permissions Form */}
              <form onSubmit={handleSaveDetails} className="space-y-4">
                <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4 text-amber-500" />
                  <span>تعديل البيانات الأساسية والدور والفرع</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      الاسم الكامل *
                    </label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      البريد الإلكتروني في ملف المؤسسة *
                    </label>
                    <input
                      type="email"
                      required
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      dir="ltr"
                      className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      رقم الهاتف
                    </label>
                    <input
                      type="text"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="05xxxxxxxx"
                      className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      الدور الوظيفي *
                    </label>
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as StaffAssignableRole)}
                      className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    >
                      <option value="employee">{getUserRoleLabel('employee', language)}</option>
                      <option value="branch_manager">
                        {getUserRoleLabel('branch_manager', language)}
                      </option>
                      <option value="supervisor">{getUserRoleLabel('supervisor', language)}</option>
                    </select>
                  </div>

                  {editRole !== 'supervisor' ? (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        الفرع المخصص (فرع واحد فقط) *
                      </label>
                      <select
                        required
                        value={editBranchId}
                        onChange={(e) => setEditBranchId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                      >
                        {activeBranches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-[11px] text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
                      <Building2 className="w-4 h-4 shrink-0" />
                      <span>يعمل المسؤول على مستوى جميع فروع المؤسسة وفق الصلاحيات أدناه.</span>
                    </div>
                  )}
                </div>

                {editRole === 'supervisor' && (
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
                      <span>صلاحيات المسؤول الاختيارية</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {SUPERVISOR_OPTIONAL_PERMISSION_KEYS.map((permKey) => {
                        const meta = SUPERVISOR_PERMISSION_META[permKey];
                        const checked = editSupPerms[permKey] === true;
                        return (
                          <label
                            key={permKey}
                            className={`p-2.5 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-colors ${
                              checked
                                ? 'bg-amber-500/10 border-amber-500/40 text-slate-900 dark:text-white'
                                : 'bg-white dark:bg-[#0c1829] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleSupPerm(setEditSupPerms, permKey)}
                              className="mt-0.5 rounded border-slate-400 text-amber-500 focus:ring-amber-500"
                            />
                            <div>
                              <div className="font-bold">
                                {isEn ? meta.labelEn : meta.labelAr}
                              </div>
                              <div className="text-[11px] opacity-75 leading-snug">
                                {isEn ? meta.descEn : meta.descAr}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {editRole === 'branch_manager' && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-700 dark:text-emerald-300">
                    صلاحيات مسؤول الفرع: تسجيل الإقفالات والمشتريات داخل الفرع المعين فقط، وعرض الموردين المسجلين (لا يمكنه إضافة أو تعديل أو حذف الموردين، ولا قراءة بيانات الفروع الأخرى).
                  </div>
                )}

                {editRole === 'employee' && (
                  <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-[11px] text-sky-700 dark:text-sky-300">
                    صلاحيات الموظف: تسجيل إقفالات الورديات في فرعه المعين فقط، مع الإبقاء على الصلاحيات الأساسية دون توسيع.
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-[11px] text-slate-400">
                    ملاحظة: رابط استعادة كلمة المرور يُرسل إلى البريد المعتمد لتسجيل الدخول في Firebase Auth.
                  </span>
                  <button
                    type="submit"
                    disabled={editSaving || selectedEmployee.isArchived === true}
                    className="px-5 py-2.5 rounded-xl font-bold text-xs text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors disabled:opacity-50"
                  >
                    {editSaving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                  </button>
                </div>
              </form>

              {/* Password Reset & Account Lifecycle Controls */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  <span>أمان الحساب وإدارة الإيقاف والأرشفة</span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleSendPasswordReset}
                    disabled={resetSending || selectedEmployee.isArchived === true}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-[#0c1829] border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-white inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5 text-amber-500" />
                    <span>
                      {resetSending ? 'جاري الإرسال...' : t('empSendPasswordReset')}
                    </span>
                  </button>

                  {selectedEmployee.isActive ? (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          type: 'disable',
                          employee: selectedEmployee,
                          reason: '',
                        })
                      }
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 inline-flex items-center gap-1.5"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>تعطيل الحساب مؤقتاً</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        toggleEmployeeStatus(selectedEmployee.uid, true).catch((err: any) =>
                          setActionFeedback({
                            type: 'error',
                            message: err?.message || 'فشل إعادة التنشيط.',
                          })
                        )
                      }
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 inline-flex items-center gap-1.5"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>إعادة تنشيط الحساب</span>
                    </button>
                  )}

                  {!selectedEmployee.isArchived && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          type: 'archive',
                          employee: selectedEmployee,
                          reason: '',
                        })
                      }
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 inline-flex items-center gap-1.5"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>{t('empArchiveEmployee')}</span>
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t('empPreserveFinancialNotice')}
                </p>
              </div>

              {/* Employee Activity History (Audit Logs + Closings) */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <History className="w-4 h-4 text-amber-500" />
                  <span>سجل نشاط الموظف وإقفالاته الأخيرة</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span>الورديات والإقفالات</span>
                      <span className="font-mono tabular-nums text-amber-500">
                        {employeeActivity.closings.length}
                      </span>
                    </div>
                    {employeeActivity.closings.length === 0 ? (
                      <div className="text-[11px] text-slate-400 py-3 text-center">
                        لا توجد ورديات مسجلة لهذا الحساب بعد.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-52 overflow-y-auto">
                        {employeeActivity.closings.map((c) => (
                          <div
                            key={c.id}
                            className="p-2.5 rounded-xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 text-[11px] flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 dark:text-white truncate">
                                {c.branchName} • {c.period === 'morning' ? 'صباحية' : 'مسائية'}
                              </div>
                              <div className="font-mono text-slate-400">{c.date}</div>
                            </div>
                            <div className="text-end shrink-0">
                              <div className="font-mono font-bold text-amber-500">
                                {formatCurrency(
                                  c.totalSales,
                                  currentOrg?.currency || 'SAR',
                                  language
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400">{c.status}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span>سجل الرقابة الإداري</span>
                      <span className="font-mono tabular-nums text-sky-400">
                        {employeeActivity.logs.length}
                      </span>
                    </div>
                    {employeeActivity.logs.length === 0 ? (
                      <div className="text-[11px] text-slate-400 py-3 text-center">
                        لا توجد حركات تدقيق مسجلة بعد.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-52 overflow-y-auto">
                        {employeeActivity.logs.map((l) => (
                          <div
                            key={l.id}
                            className="p-2.5 rounded-xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 text-[11px] space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-amber-500">{l.action}</span>
                              <span className="font-mono text-[10px] text-slate-400">
                                {new Date(l.timestamp).toLocaleDateString('ar-SA')}
                              </span>
                            </div>
                            <div className="text-slate-600 dark:text-slate-300 leading-snug">
                              {l.details}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal before Disable or Archive */}
      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h5 className="text-sm font-bold text-slate-900 dark:text-white">
                  {confirmAction.type === 'archive'
                    ? `تأكيد أرشفة وإيقاف حساب "${confirmAction.employee.displayName}"`
                    : `تأكيد تعطيل حساب "${confirmAction.employee.displayName}"`}
                </h5>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {confirmAction.type === 'archive'
                    ? 'سيتم إيقاف الحساب ومنع تسجيل الدخول نهائياً مع الاحتفاظ التام بجميع الإقفالات والسجلات المالية وسجل الرقابة التاريخي دون أي حذف فعلي.'
                    : 'لن يتمكن هذا المستخدم من تسجيل الدخول أو تنفيذ أي عملية حتى يعيد المدير تنشيط الحساب، وتبقى جميع سجلاته محفوظة.'}
                </p>
              </div>
            </div>

            {confirmAction.type === 'archive' && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  سبب الأرشفة (اختياري)
                </label>
                <input
                  type="text"
                  value={confirmAction.reason}
                  onChange={(e) =>
                    setConfirmAction((prev) =>
                      prev ? { ...prev, reason: e.target.value } : null
                    )
                  }
                  placeholder="مثال: انتهاء فترة العمل في المؤسسة"
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#070e17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={confirmBusy}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmLifecycleAction}
                disabled={confirmBusy}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
              >
                {confirmBusy
                  ? 'جاري التنفيذ...'
                  : confirmAction.type === 'archive'
                  ? 'تأكيد الأرشفة مع حفظ السجلات'
                  : 'تأكيد التعطيل'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
