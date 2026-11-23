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
  Eye,
  EyeOff,
  Lock,
  Truck,
} from 'lucide-react';
import {
  normalizeLoginEmail,
  validatePasswordConfirmation,
} from '../../utils/authCredentials';

type StaffAssignableRole = 'employee' | 'branch_manager' | 'supervisor';
type StatusFilterValue = 'all' | 'active' | 'disabled' | 'archived';

const SUPERVISOR_PERMISSION_META: Record<
  SupervisorOptionalPermissionKey,
  { labelAr: string; labelEn: string; labelUr: string; descAr: string; descEn: string; descUr: string }
> = {
  canCreateClosing: {
    labelAr: 'إنشاء وإرسال إقفالات الورديات',
    labelEn: 'Create & submit shift closings',
    labelUr: 'شفٹ کلوزنگ بنانا اور جمع کرانا',
    descAr: 'يسمح له بتسجيل إقفال وردية على أي فرع داخل المؤسسة.',
    descEn: 'Allows recording shift closings on any organization branch.',
    descUr: 'ادارے کی کسی بھی برانچ پر شفٹ کلوزنگ درج کرنے کی اجازت دیتا ہے۔',
  },
  canViewAllClosings: {
    labelAr: 'عرض إقفالات جميع الفروع',
    labelEn: 'View all branches closings',
    labelUr: 'تمام برانچز کی کلوزنگ دیکھنا',
    descAr: 'يتيح الاطلاع على سجلات الإقفالات عبر كافة فروع المؤسسة.',
    descEn: 'Allows viewing shift closing records across all branches.',
    descUr: 'ادارے کی تمام برانچز کے کلوزنگ ریکارڈز دیکھنے کی اجازت دیتا ہے۔',
  },
  canApproveClosings: {
    labelAr: 'اعتماد وإرجاع الإقفالات',
    labelEn: 'Approve & return closings',
    labelUr: 'کلوزنگ منظور اور واپس کرنا',
    descAr: 'يتيح اعتماد أو إعادة الإقفالات المرسلة للمراجعة (دون التصحيح الإداري للمعتمد).',
    descEn: 'Allows approving or returning pending closings (without admin corrections).',
    descUr: 'زیر التواء کلوزنگ منظور یا واپس کرنے کی اجازت (منظور شدہ پر انتظامی تصحیح کے بغیر)۔',
  },
  canViewFinancialReports: {
    labelAr: 'الاطلاع على التقارير المالية',
    labelEn: 'View financial reports',
    labelUr: 'مالی رپورٹس دیکھنا',
    descAr: 'يفتح تبويب التقارير المالية وإجماليات المبيعات والصناديق.',
    descEn: 'Grants access to financial reports and summaries.',
    descUr: 'مالی رپورٹس، کل فروخت اور کیش بکس کے خلاصے تک رسائی دیتا ہے۔',
  },
  canExportReports: {
    labelAr: 'تصدير وطباعة التقارير (CSV / Excel)',
    labelEn: 'Export & print reports',
    labelUr: 'رپورٹس ایکسپورٹ اور پرنٹ کرنا (CSV / Excel)',
    descAr: 'يتيح تصدير التقارير المالية وطباعتها عند تفعيل التقارير.',
    descEn: 'Allows downloading CSV/Excel reports and printing.',
    descUr: 'رپورٹس فعال ہونے پر CSV/Excel ڈاؤن لوڈ اور پرنٹ کرنے کی اجازت دیتا ہے۔',
  },
  canManagePurchases: {
    labelAr: 'إدارة المشتريات عبر جميع الفروع',
    labelEn: 'Manage org-wide purchases',
    labelUr: 'تمام برانچز کی خریداری کا انتظام',
    descAr: 'صلاحية تسجيل المشتريات على كافة فروع المؤسسة في قواعد الأمان.',
    descEn: 'Authorizes recording purchases across all organization branches.',
    descUr: 'ادارے کی تمام برانچز پر خریداری درج کرنے کا اختیار دیتا ہے۔',
  },
  canViewSuppliers: {
    labelAr: 'عرض الموردين المسجلين',
    labelEn: 'View registered suppliers',
    labelUr: 'رجسٹرڈ سپلائرز دیکھنا',
    descAr: 'الاطلاع على قائمة الموردين المعتمدة في المؤسسة.',
    descEn: 'View pre-registered organization suppliers.',
    descUr: 'ادارے کے منظور شدہ سپلائرز کی فہرست دیکھنا۔',
  },
  canManageSuppliers: {
    labelAr: 'إضافة مورد جديد فقط',
    labelEn: 'Add new suppliers only',
    labelUr: 'صرف نیا سپلائر شامل کرنا',
    descAr: 'يسمح بإضافة موردين جدد فقط (لا يسمح بتعديل أو حذف الموردين).',
    descEn: 'Permits adding new suppliers only (editing/deleting remains blocked).',
    descUr: 'صرف نئے سپلائرز شامل کرنے کی اجازت (ترمیم یا حذف ممنوع ہے)۔',
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
  const { t, tr, language } = useLanguage();
  const dateLocale = language === 'ar' ? 'ar-SA' : language === 'ur' ? 'ur-PK' : 'en-US';

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
  const [createConfirmPassword, setCreateConfirmPassword] = useState('');
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showCreateConfirmPassword, setShowCreateConfirmPassword] = useState(false);
  const [createPhone, setCreatePhone] = useState('');
  const [createRole, setCreateRole] = useState<StaffAssignableRole>('employee');
  const [createBranchId, setCreateBranchId] = useState(activeBranches[0]?.id || '');
  const [createSupPerms, setCreateSupPerms] = useState<
    Record<SupervisorOptionalPermissionKey, boolean>
  >(createEmptySupervisorPermissions);
  const [createBranchMgrCanCreateSuppliers, setCreateBranchMgrCanCreateSuppliers] =
    useState<boolean>(false);
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
  const [editBranchMgrCanCreateSuppliers, setEditBranchMgrCanCreateSuppliers] =
    useState<boolean>(false);
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
    setEditBranchMgrCanCreateSuppliers(
      normalizedRole === 'branch_manager' && selectedEmployee.permissions?.canCreateSuppliers === true
    );
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
    setCreateConfirmPassword('');
    setShowCreatePassword(false);
    setShowCreateConfirmPassword(false);
    setCreatePhone('');
    setCreateRole('employee');
    setCreateBranchId(activeBranches[0]?.id || '');
    setCreateSupPerms(createEmptySupervisorPermissions());
    setCreateBranchMgrCanCreateSuppliers(false);
    setCreateError(null);
    setCreateSuccess(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = normalizeLoginEmail(createEmail);
    if (!createName.trim() || !normalizedEmail || !createPassword) return;

    const passCheck = validatePasswordConfirmation(createPassword, createConfirmPassword, 6);
    if (!passCheck.valid) {
      setCreateError(
        passCheck.reason === 'mismatch'
          ? tr(
              'كلمتا المرور غير متطابقتين. يرجى التأكد من تطابق كلمة المرور وتأكيدها.',
              'Passwords do not match. Please verify both password fields.',
              'پاس ورڈ اور تصدیقی پاس ورڈ آپس میں مطابقت نہیں رکھتے۔'
            )
          : tr(
              'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.',
              'Password must be at least 6 characters long.',
              'پاس ورڈ کم از کم 6 حروف پر مشتمل ہونا چاہیے۔'
            )
      );
      return;
    }

    setCreateLoading(true);
    setCreateError(null);
    setCreateSuccess(null);

    const targetBranch =
      createRole === 'supervisor'
        ? undefined
        : activeBranches.find((b) => b.id === createBranchId) || activeBranches[0];

    try {
      const created = await createEmployeeAccount({
        email: normalizedEmail,
        password: createPassword,
        displayName: createName.trim(),
        role: createRole,
        branchId: targetBranch?.id,
        branchName: targetBranch?.name,
        phone: createPhone.trim(),
        supervisorPermissions: createRole === 'supervisor' ? createSupPerms : undefined,
        branchManagerPermissions:
          createRole === 'branch_manager'
            ? { canCreateSuppliers: createBranchMgrCanCreateSuppliers }
            : undefined,
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
        phone: editPhone,
        role: editRole,
        branchId: editRole === 'supervisor' ? undefined : editBranchId,
        supervisorPermissions: editRole === 'supervisor' ? editSupPerms : undefined,
        branchManagerPermissions:
          editRole === 'branch_manager'
            ? { canCreateSuppliers: editBranchMgrCanCreateSuppliers }
            : undefined,
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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-[#1764FF]/12 text-[#1764FF] dark:text-[#6CA2FF] border border-[#1764FF]/30">
          {getUserRoleLabel(role, language)}
        </span>
      );
    }
    if (role === 'supervisor') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-500/12 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30">
          {getUserRoleLabel(role, language)}
        </span>
      );
    }
    if (role === 'branch_manager') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] border border-[#08C99B]/30">
          {getUserRoleLabel(role, language)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-500/12 text-sky-600 dark:text-sky-300 border border-sky-500/30">
        {getUserRoleLabel(role, language)}
      </span>
    );
  };

  const renderStatusBadge = (emp: UserProfile) => {
    if (emp.isArchived) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-200 dark:bg-[#0E203A] text-slate-600 dark:text-slate-300 border border-[#DCE6FA] dark:border-[#1F3B66]">
          <Archive className="w-3 h-3" />
          <span>{t('empStatusArchived')}</span>
        </span>
      );
    }
    if (emp.isActive === false) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/12 text-rose-600 dark:text-rose-400 border border-rose-500/30">
          <UserX className="w-3 h-3" />
          <span>{t('empStatusDisabled')}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] border border-[#08C99B]/30">
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
          <h3 className="text-lg font-bold text-[#0B1B32] dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-[#1764FF] dark:text-[#6CA2FF]" />
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
          className="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-white bg-[#1764FF] hover:bg-[#1052D8] transition-all flex items-center gap-2 shadow-sm shrink-0"
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
              ? 'bg-[#08C99B]/10 border-[#08C99B]/30 text-[#048264] dark:text-[#08C99B]'
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
        <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-4 shadow-sm">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-1">
            {tr('إجمالي أعضاء الطاقم', 'Total Staff Members', 'کل عملے کے ارکان')}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#0B1B32] dark:text-white">
            {stats.totalStaff}
          </div>
        </div>
        <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-4 shadow-sm">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-1">
            {tr('الحسابات النشطة', 'Active Accounts', 'فعال اکاؤنٹس')}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#048264] dark:text-[#08C99B]">
            {stats.activeCount}
          </div>
        </div>
        <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-4 shadow-sm">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-1">
            {tr('المسؤولون ومسؤولو الفروع', 'Supervisors & Branch Managers', 'سپروائزرز اور برانچ مینیجرز')}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#1764FF] dark:text-[#6CA2FF]">
            {stats.supervisorsCount + stats.branchManagersCount}
          </div>
        </div>
        <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-4 shadow-sm">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-1">
            {tr('معطل / مؤرشف', 'Disabled / Archived', 'معطل / آرکائیو شدہ')}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-rose-500">
            {stats.inactiveOrArchivedCount}
          </div>
        </div>
      </section>

      {/* Search & Filters */}
      <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-4 space-y-3 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('empSearchPlaceholder')}
              className="w-full ps-9 pe-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
            className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
          >
            <option value="all">{t('empAllRoles')}</option>
            <option value="supervisor">{getUserRoleLabel('supervisor', language)}</option>
            <option value="branch_manager">{getUserRoleLabel('branch_manager', language)}</option>
            <option value="employee">{getUserRoleLabel('employee', language)}</option>
          </select>

          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
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
              className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
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
                className="px-3 py-2 rounded-xl text-xs font-semibold text-[#1764FF] dark:text-[#6CA2FF] hover:bg-[#1764FF]/10 border border-[#1764FF]/30 whitespace-nowrap shrink-0"
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
        <div className="p-4 rounded-2xl bg-[#1764FF]/8 border border-[#1764FF]/30 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold text-sm text-[#0B1B32] dark:text-white">
              {userProfile?.displayName} ({tr('أنت', 'You', 'آپ')})
            </div>
            {renderRoleBadge('manager')}
          </div>
          <div className="text-xs font-mono text-slate-500 dark:text-slate-400" dir="ltr">
            {userProfile?.email}
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between pt-1">
            <span>{t('empOrgWideScope')}</span>
            <span className="text-[#048264] dark:text-[#08C99B] font-semibold">{t('empStatusActive')}</span>
          </div>
        </div>

        {filteredStaff.map((emp) => (
          <div
            key={emp.uid}
            className="p-4 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] shadow-sm space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-sm text-[#0B1B32] dark:text-white truncate">
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
                <GitBranch className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                <span>{getBranchName(emp)}</span>
              </span>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-[#E6EEFC] dark:border-[#1F3B66]">
              <button
                type="button"
                onClick={() => setSelectedUid(emp.uid)}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-[#F5F8FF] dark:bg-[#0E203A] hover:bg-[#1764FF]/10 border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white flex items-center justify-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                <span>{t('empDetailsAction')}</span>
              </button>
              {emp.isActive ? (
                <button
                  type="button"
                  onClick={() =>
                    setConfirmAction({ type: 'disable', employee: emp, reason: '' })
                  }
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/10"
                >
                  {tr('تعطيل', 'Disable', 'معطل کریں')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleEmployeeStatus(emp.uid, true)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-[#048264] dark:text-[#08C99B] border border-[#08C99B]/35 hover:bg-[#08C99B]/10"
                >
                  {tr('تنشيط', 'Activate', 'فعال کریں')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View (>= 768px) */}
      <div className="hidden md:block bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] shadow-sm overflow-x-auto">
        <table className="w-full text-start text-xs sm:text-sm">
          <thead className="bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-600 dark:text-slate-300 text-[11px] font-bold uppercase tracking-wider border-b border-[#DCE6FA] dark:border-[#1F3B66]">
            <tr>
              <th className="p-4 text-start">{tr('الاسم والهاتف', 'Name & Phone', 'نام اور فون')}</th>
              <th className="p-4 text-start">{tr('البريد الإلكتروني', 'Email', 'ای میل')}</th>
              <th className="p-4 text-start">{tr('الدور', 'Role', 'کردار')}</th>
              <th className="p-4 text-start">{tr('الفرع / النطاق', 'Branch / Scope', 'برانچ / دائرہ')}</th>
              <th className="p-4 text-start">{tr('الحالة', 'Status', 'حیثیت')}</th>
              <th className="p-4 text-start">{tr('الإجراءات', 'Actions', 'اقدامات')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66]">
            {/* Pinned Organization Manager Row */}
            <tr className="bg-[#1764FF]/5 dark:bg-[#1764FF]/10">
              <td className="p-4 font-bold text-[#0B1B32] dark:text-white flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#1764FF]/15 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center font-bold text-xs shrink-0">
                  ★
                </div>
                <span>
                  {userProfile?.displayName} ({tr('أنت', 'You', 'آپ')})
                </span>
              </td>
              <td className="p-4 font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                {userProfile?.email}
              </td>
              <td className="p-4">{renderRoleBadge('manager')}</td>
              <td className="p-4 text-xs text-slate-700 dark:text-slate-300">
                {t('empOrgWideScope')}
              </td>
              <td className="p-4">
                <span className="text-xs font-semibold text-[#048264] dark:text-[#08C99B]">
                  {tr('نشط دائماً', 'Always Active', 'ہمیشہ فعال')}
                </span>
              </td>
              <td className="p-4 text-xs text-slate-500 dark:text-slate-400">
                {tr('مالك المؤسسة', 'Organization Owner', 'ادارے کا مالک')}
              </td>
            </tr>

            {filteredStaff.map((emp) => {
              const assignedBranchId = resolvePrimaryAssignedBranchId(emp) || '';
              return (
                <tr
                  key={emp.uid}
                  className="hover:bg-[#F5F8FF]/70 dark:hover:bg-[#173056]/40 transition-colors"
                >
                  <td className="p-4">
                    <div className="font-bold text-[#0B1B32] dark:text-white">
                      {emp.displayName}
                    </div>
                    {emp.phone && (
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5" dir="ltr">
                        {emp.phone}
                      </div>
                    )}
                  </td>
                  <td className="p-4 font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                    {emp.email}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col items-start gap-1">
                      {renderRoleBadge(emp.role)}
                      {emp.role === 'branch_manager' && emp.permissions?.canCreateSuppliers === true && (
                        <span className="text-[10px] font-semibold text-[#1764FF] dark:text-[#6CA2FF] flex items-center gap-1">
                          <Truck className="w-3 h-3" />
                          <span>
                            {tr('إضافة موردين', 'Can add suppliers', 'سپلائر شامل کرنے کی اجازت')}
                          </span>
                        </span>
                      )}
                    </div>
                  </td>
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
                                  message:
                                    err?.message ||
                                    tr('فشل تغيير الفرع.', 'Failed to change branch.', 'برانچ تبدیل کرنے میں ناکامی۔'),
                                })
                            );
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-700 dark:text-slate-200 disabled:opacity-50"
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
                        className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#F5F8FF] dark:bg-[#0E203A] hover:bg-[#1764FF]/10 border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white transition-colors inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                        <span>{t('empDetailsAction')}</span>
                      </button>

                      {emp.isActive ? (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmAction({ type: 'disable', employee: emp, reason: '' })
                          }
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-500/25 transition-colors"
                        >
                          {tr('تعطيل', 'Disable', 'معطل کریں')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            toggleEmployeeStatus(emp.uid, true).catch((err: any) =>
                              setActionFeedback({
                                type: 'error',
                                message:
                                  err?.message ||
                                  tr('فشل التنشيط.', 'Failed to activate account.', 'اکاؤنٹ فعال کرنے میں ناکامی۔'),
                              })
                            )
                          }
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#048264] dark:text-[#08C99B] hover:bg-[#08C99B]/10 border border-[#08C99B]/30 transition-colors"
                        >
                          {tr('إعادة التنشيط', 'Reactivate', 'دوبارہ فعال کریں')}
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
          <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            {staffList.length === 0
              ? tr(
                  'لم تقم بإضافة أي موظفين أو مسؤولي فروع أو مسؤولين بعد. اضغط على "إضافة موظف جديد" للبدء.',
                  'You have not added any employees, branch managers, or supervisors yet. Click "Add Staff Member" to get started.',
                  'آپ نے ابھی تک کوئی ملازم، برانچ مینیجر یا سپروائزر شامل نہیں کیا۔ شروع کرنے کے لیے "نیا عملہ شامل کریں" پر کلک کریں۔'
                )
              : tr(
                  'لا توجد نتائج مطابقة للبحث أو الفلاتر الحالية.',
                  'No staff members match the current search or filters.',
                  'موجودہ تلاش یا فلٹرز کے مطابق کوئی رکن نہیں ملا۔'
                )}
          </div>
        )}
      </div>

      {/* Add Staff Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1B32]/75 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
              <h4 className="text-base font-bold text-[#0B1B32] dark:text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                <span>{tr('إضافة عضو جديد للطاقم', 'Add New Staff Member', 'عملے کا نیا رکن شامل کریں')}</span>
              </h4>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-slate-400 hover:text-[#0B1B32] dark:hover:text-white"
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
              <div className="p-3 rounded-xl bg-[#08C99B]/10 border border-[#08C99B]/30 text-[#048264] dark:text-[#08C99B] text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{createSuccess}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {tr('الاسم الكامل *', 'Full Name *', 'پورا نام *')}
                  </label>
                  <input
                    type="text"
                    required
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder={tr('مثال: خالد المحاسب', 'e.g., Khalid Al-Harbi', 'مثال: خالد اکاؤنٹنٹ')}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-sm text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {tr('رقم الهاتف (اختياري)', 'Phone Number (Optional)', 'فون نمبر (اختیاری)')}
                  </label>
                  <input
                    type="text"
                    value={createPhone}
                    onChange={(e) => setCreatePhone(e.target.value)}
                    placeholder="05xxxxxxxx"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-sm text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
                  />
                </div>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {tr('البريد الإلكتروني لتسجيل الدخول *', 'Sign-In Email *', 'لاگ ان ای میل *')}
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      dir="ltr"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="email"
                      value={createEmail}
                      onChange={(e) => setCreateEmail(e.target.value)}
                      placeholder="staff@company.com"
                      className="w-full ps-3.5 pe-10 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-sm text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute end-3 top-3 pointer-events-none" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr('كلمة المرور الأولية (6 خانات فأكثر) *', 'Initial Password (6+ chars) *', 'ابتدائی پاس ورڈ (کم از کم 6 حروف) *')}
                    </label>
                    <div className="relative">
                      <input
                        type={showCreatePassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        dir="ltr"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        autoComplete="new-password"
                        value={createPassword}
                        onChange={(e) => setCreatePassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full ps-3.5 pe-10 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-sm text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCreatePassword((prev) => !prev)}
                        aria-label={showCreatePassword ? t('authHidePassword') : t('authShowPassword')}
                        className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-[#0B1B32] dark:hover:text-white"
                      >
                        {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr('تأكيد كلمة المرور *', 'Confirm Password *', 'پاس ورڈ کی تصدیق *')}
                    </label>
                    <div className="relative">
                      <input
                        type={showCreateConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        dir="ltr"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        autoComplete="new-password"
                        value={createConfirmPassword}
                        onChange={(e) => setCreateConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full ps-3.5 pe-10 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-sm text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCreateConfirmPassword((prev) => !prev)}
                        aria-label={showCreateConfirmPassword ? t('authHidePassword') : t('authShowPassword')}
                        className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-[#0B1B32] dark:hover:text-white"
                      >
                        {showCreateConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Role Picker */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {tr('الدور الوظيفي *', 'Assigned Role *', 'کردار منتخب کریں *')}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      {
                        role: 'employee',
                        title: getUserRoleLabel('employee', language),
                        hint: tr(
                          'تسجيل الإقفالات في فرع واحد فقط',
                          'Record shift closings for one branch only',
                          'صرف ایک برانچ میں شفٹ کلوزنگ درج کرنا'
                        ),
                      },
                      {
                        role: 'branch_manager',
                        title: getUserRoleLabel('branch_manager', language),
                        hint: tr(
                          'إقفالات + مشتريات فرع واحد وعرض الموردين',
                          'Closings + purchases for one branch & view suppliers',
                          'ایک برانچ کی کلوزنگ + خریداری اور سپلائرز دیکھنا'
                        ),
                      },
                      {
                        role: 'supervisor',
                        title: getUserRoleLabel('supervisor', language),
                        hint: tr(
                          'على مستوى المؤسسة بصلاحيات تفعّلها أنت',
                          'Org-wide scope with custom permissions you enable',
                          'ادارہ جاتی سطح پر آپ کی فعال کردہ اجازتوں کے ساتھ'
                        ),
                      },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.role}
                      type="button"
                      onClick={() => {
                        setCreateRole(item.role);
                        if (item.role !== 'branch_manager') {
                          setCreateBranchMgrCanCreateSuppliers(false);
                        }
                      }}
                      className={`p-3 rounded-xl border text-start transition-all ${
                        createRole === item.role
                          ? 'bg-[#1764FF]/10 border-[#1764FF] text-[#0B1B32] dark:text-white'
                          : 'bg-[#F5F8FF] dark:bg-[#0E203A] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300 hover:border-[#1764FF]/50'
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
                    {tr('الفرع المخصص (فرع واحد فقط) *', 'Assigned Branch (Single Branch Only) *', 'مختص برانچ (صرف ایک برانچ) *')}
                  </label>
                  <select
                    required
                    value={createBranchId}
                    onChange={(e) => setCreateBranchId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-sm text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
                  >
                    {activeBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Independent Opt-In Supplier Creation Permission (ONLY for branch_manager; default: NO) */}
              {createRole === 'branch_manager' && (
                <div
                  data-testid="create-branch-manager-suppliers-permission"
                  className="p-4 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3"
                >
                  <div className="text-xs font-bold text-[#0B1B32] dark:text-white flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                    <span>
                      {tr(
                        'السماح لمسؤول الفرع بإضافة موردين؟',
                        'Allow this Branch Manager to add suppliers?',
                        'کیا اس برانچ مینیجر کو سپلائرز شامل کرنے کی اجازت دی جائے؟'
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label
                      className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-colors ${
                        createBranchMgrCanCreateSuppliers === true
                          ? 'bg-[#1764FF]/10 border-[#1764FF] text-[#0B1B32] dark:text-white'
                          : 'bg-white dark:bg-[#122543] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="createBranchMgrCanCreateSuppliers"
                        checked={createBranchMgrCanCreateSuppliers === true}
                        onChange={() => setCreateBranchMgrCanCreateSuppliers(true)}
                        className="mt-0.5 text-[#1764FF] focus:ring-[#1764FF]"
                      />
                      <div>
                        <div className="font-bold">
                          {tr(
                            'نعم، السماح بإضافة موردين',
                            'Yes, allow adding suppliers',
                            'ہاں، سپلائرز شامل کرنے کی اجازت دیں'
                          )}
                        </div>
                        <div className="text-[11px] opacity-75 leading-snug mt-0.5">
                          {tr(
                            'إضافة مورد جديد واستخدامه في المشتريات فقط (دون صلاحية التعديل أو الإيقاف أو الحذف).',
                            'Create new suppliers for purchase invoices only (cannot edit, deactivate, or delete).',
                            'صرف نیا سپلائر شامل کرنے اور خریداری میں استعمال کرنے کے لیے (ترمیم یا حذف کی اجازت نہیں)۔'
                          )}
                        </div>
                      </div>
                    </label>

                    <label
                      className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-colors ${
                        createBranchMgrCanCreateSuppliers === false
                          ? 'bg-[#1764FF]/10 border-[#1764FF] text-[#0B1B32] dark:text-white'
                          : 'bg-white dark:bg-[#122543] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="createBranchMgrCanCreateSuppliers"
                        checked={createBranchMgrCanCreateSuppliers === false}
                        onChange={() => setCreateBranchMgrCanCreateSuppliers(false)}
                        className="mt-0.5 text-[#1764FF] focus:ring-[#1764FF]"
                      />
                      <div>
                        <div className="font-bold">
                          {tr(
                            'لا، منع إضافة موردين',
                            'No, disallow adding suppliers',
                            'نہیں، سپلائرز شامل کرنے سے روکیں'
                          )}
                        </div>
                        <div className="text-[11px] opacity-75 leading-snug mt-0.5">
                          {tr(
                            'الاختيار الافتراضي: يختار فقط من الموردين النشطين المسجلين مسبقاً.',
                            'Default: can only select from pre-registered active suppliers.',
                            'بائی ڈیفالٹ: صرف پہلے سے درج فعال سپلائرز کا انتخاب کر سکتا ہے۔'
                          )}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Supervisor Optional Permissions (All OFF by default) */}
              {createRole === 'supervisor' && (
                <div className="p-4 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#0B1B32] dark:text-white flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                      <span>
                        {tr(
                          'صلاحيات المسؤول الاختيارية (معطلة افتراضياً)',
                          'Optional Supervisor Permissions (OFF by default)',
                          'سپروائزر کے اختیاری اختیارات (بائی ڈیفالٹ بند)'
                        )}
                      </span>
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
                              ? 'bg-[#1764FF]/10 border-[#1764FF]/40 text-[#0B1B32] dark:text-white'
                              : 'bg-white dark:bg-[#122543] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleSupPerm(setCreateSupPerms, permKey)}
                            className="mt-0.5 rounded border-slate-400 text-[#1764FF] focus:ring-[#1764FF]"
                          />
                          <div>
                            <div className="font-bold">
                              {tr(meta.labelAr, meta.labelEn, meta.labelUr)}
                            </div>
                            <div className="text-[11px] opacity-75 leading-snug">
                              {tr(meta.descAr, meta.descEn, meta.descUr)}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="p-3 rounded-xl bg-[#1764FF]/8 border border-[#1764FF]/20 text-[11px] text-[#0B1B32] dark:text-slate-200 space-y-1.5 leading-relaxed">
                <p>
                  {tr(
                    'ملاحظة أمنية: يتم إنشاء الحساب عبر جلسة معزولة دون تسجيل خروجك، ولا تُحفظ كلمة المرور الأولية في قاعدة البيانات أو السجلات.',
                    'Security note: Accounts are provisioned in an isolated auth session without signing you out, and initial passwords are never stored in Firestore or logs.',
                    'سکیورٹی نوٹ: اکاؤنٹ آپ کو لاگ آؤٹ کیے بغیر ایک الگ سیشن میں بنایا جاتا ہے، اور ابتدائی پاس ورڈ کبھی ڈیٹابیس یا لاگز میں محفوظ نہیں ہوتا۔'
                  )}
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  {tr(
                    'تنبيه مهم حول طريقة الدخول: نوع مزوّد الدخول الفعلي للحساب (البريد وكلمة المرور هنا) هو الذي يحدد طريقة تسجيل دخول الموظف، وليس مجرد كون البريد من Gmail أو غيره. يسجّل الموظف دخوله من تبويب «تسجيل دخول» باستخدام البريد وكلمة المرور هذه.',
                    'Sign-in method note: The actual authentication provider configured for the account (Email/Password here) determines how the employee signs in—not merely whether the email is a Gmail address. The employee signs in via the Sign In (Email/Password) tab.',
                    'لاگ ان طریقہ نوٹ: اکاؤنٹ کا اصل تصدیقی فراہم کنندہ (یہاں ای میل اور پاس ورڈ) طے کرتا ہے کہ ملازم کیسے لاگ ان ہوگا، نہ کہ صرف یہ کہ ای میل Gmail ہے۔ ملازم ای میل اور پاس ورڈ ٹیب سے لاگ ان کرے گا۔'
                  )}
                </p>
              </div>

              <button
                type="submit"
                disabled={createLoading}
                className="w-full py-3 rounded-xl font-bold text-xs text-white bg-[#1764FF] hover:bg-[#1052D8] transition-all disabled:opacity-50 shadow-sm"
              >
                {createLoading
                  ? tr('جاري إنشاء الحساب...', 'Creating account...', 'اکاؤنٹ بنایا جا رہا ہے...')
                  : tr('تأكيد إنشاء الحساب', 'Confirm Create Account', 'اکاؤنٹ بنانے کی تصدیق کریں')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Employee Details, Edit & Activity Drawer/Modal */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1B32]/75 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#122543] rounded-3xl border border-[#DCE6FA] dark:border-[#1F3B66] shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            {/* Drawer Header */}
            <div className="p-5 sm:p-6 bg-[#0B1B32] text-white flex items-center justify-between gap-3 border-b border-[#1F3B66] sticky top-0 z-10">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-base font-bold truncate">{selectedEmployee.displayName}</h4>
                  {renderRoleBadge(selectedEmployee.role)}
                  {renderStatusBadge(selectedEmployee)}
                </div>
                <div className="text-xs font-mono text-slate-300 mt-1" dir="ltr">
                  {selectedEmployee.email}
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-0.5 select-all" dir="ltr">
                  UID: {selectedEmployee.uid}
                  {selectedEmployee.firestoreDocId &&
                    selectedEmployee.firestoreDocId !== selectedEmployee.uid && (
                      <span className="ms-2 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
                        docId ≠ uid ({selectedEmployee.firestoreDocId})
                      </span>
                    )}
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
                <div className="text-xs font-bold text-[#0B1B32] dark:text-white flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>
                    {tr(
                      'تعديل البيانات الأساسية والدور والفرع',
                      'Edit Basic Profile, Role & Branch',
                      'بنیادی معلومات، کردار اور برانچ میں ترمیم'
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {tr('الاسم الكامل *', 'Full Name *', 'پورا نام *')}
                    </label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-1">
                      <Lock className="w-3 h-3 text-slate-400" />
                      <span>
                        {tr('بريد تسجيل الدخول (للقراءة فقط)', 'Sign-In Email (Read-Only)', 'لاگ ان ای میل (صرف پڑھنے کے لیے)')}
                      </span>
                    </label>
                    <input
                      type="email"
                      readOnly
                      disabled
                      value={editEmail}
                      dir="ltr"
                      className="w-full px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-[#0A182D] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-500 dark:text-slate-400 font-mono cursor-not-allowed"
                    />
                    <p className="mt-1 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                      {tr(
                        'لا يمكن تعديل البريد من هنا؛ يتطلب تغييره إجراءً مخصصاً يحدّث Firebase Authentication وFirestore معاً.',
                        'Cannot be edited here; changing the login email requires a dedicated procedure that updates Firebase Authentication and Firestore together.',
                        'ای میل یہاں سے تبدیل نہیں کیا جا سکتا؛ تبدیلی کے لیے مخصوص کارروائی درکار ہے جو Firebase Authentication اور Firestore دونوں کو ایک ساتھ اپ ڈیٹ کرے۔'
                      )}
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {tr('رقم الهاتف', 'Phone Number', 'فون نمبر')}
                    </label>
                    <input
                      type="text"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="05xxxxxxxx"
                      className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {tr('الدور الوظيفي *', 'Assigned Role *', 'کردار *')}
                    </label>
                    <select
                      value={editRole}
                      onChange={(e) => {
                        const nextRole = e.target.value as StaffAssignableRole;
                        setEditRole(nextRole);
                        if (nextRole !== 'branch_manager') {
                          setEditBranchMgrCanCreateSuppliers(false);
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
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
                        {tr('الفرع المخصص (فرع واحد فقط) *', 'Assigned Branch (Single Branch Only) *', 'مختص برانچ (صرف ایک برانچ) *')}
                      </label>
                      <select
                        required
                        value={editBranchId}
                        onChange={(e) => setEditBranchId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
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
                      <span>
                        {tr(
                          'يعمل المسؤول على مستوى جميع فروع المؤسسة وفق الصلاحيات أدناه.',
                          'Supervisors operate across all organization branches according to the permissions below.',
                          'سپروائزر نیچے دیے گئے اختیارات کے مطابق ادارے کی تمام برانچز پر کام کرتا ہے۔'
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {editRole === 'supervisor' && (
                  <div className="p-4 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3">
                    <div className="text-xs font-bold text-[#0B1B32] dark:text-white flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                      <span>
                        {tr('صلاحيات المسؤول الاختيارية', 'Optional Supervisor Permissions', 'سپروائزر کے اختیاری اختیارات')}
                      </span>
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
                                ? 'bg-[#1764FF]/10 border-[#1764FF]/40 text-[#0B1B32] dark:text-white'
                                : 'bg-white dark:bg-[#122543] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleSupPerm(setEditSupPerms, permKey)}
                              className="mt-0.5 rounded border-slate-400 text-[#1764FF] focus:ring-[#1764FF]"
                            />
                            <div>
                              <div className="font-bold">
                                {tr(meta.labelAr, meta.labelEn, meta.labelUr)}
                              </div>
                              <div className="text-[11px] opacity-75 leading-snug">
                                {tr(meta.descAr, meta.descEn, meta.descUr)}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {editRole === 'branch_manager' && (
                  <div className="space-y-3">
                    <div
                      data-testid="edit-branch-manager-suppliers-permission"
                      className="p-4 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3"
                    >
                      <div className="text-xs font-bold text-[#0B1B32] dark:text-white flex items-center gap-1.5">
                        <Truck className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                        <span>
                          {tr(
                            'السماح لمسؤول الفرع بإضافة موردين؟',
                            'Allow this Branch Manager to add suppliers?',
                            'کیا اس برانچ مینیجر کو سپلائرز شامل کرنے کی اجازت دی جائے؟'
                          )}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <label
                          className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-colors ${
                            editBranchMgrCanCreateSuppliers === true
                              ? 'bg-[#1764FF]/10 border-[#1764FF] text-[#0B1B32] dark:text-white'
                              : 'bg-white dark:bg-[#122543] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="editBranchMgrCanCreateSuppliers"
                            checked={editBranchMgrCanCreateSuppliers === true}
                            onChange={() => setEditBranchMgrCanCreateSuppliers(true)}
                            className="mt-0.5 text-[#1764FF] focus:ring-[#1764FF]"
                          />
                          <div>
                            <div className="font-bold">
                              {tr(
                                'نعم، السماح بإضافة موردين',
                                'Yes, allow adding suppliers',
                                'ہاں، سپلائرز شامل کرنے کی اجازت دیں'
                              )}
                            </div>
                            <div className="text-[11px] opacity-75 leading-snug mt-0.5">
                              {tr(
                                'إضافة مورد جديد واستخدامه في المشتريات فقط (لا يمكنه تعديل أو إيقاف أو حذف أي مورد، حتى المورد الذي أضافه بنفسه).',
                                'Create new suppliers for purchases only (cannot edit, deactivate, or delete any supplier, including ones they created).',
                                'صرف نیا سپلائر شامل کرنے کے لیے (کسی بھی سپلائر میں ترمیم یا حذف کی اجازت نہیں، خواہ خود ہی کیوں نہ بنایا ہو)۔'
                              )}
                            </div>
                          </div>
                        </label>

                        <label
                          className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-colors ${
                            editBranchMgrCanCreateSuppliers === false
                              ? 'bg-[#1764FF]/10 border-[#1764FF] text-[#0B1B32] dark:text-white'
                              : 'bg-white dark:bg-[#122543] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="editBranchMgrCanCreateSuppliers"
                            checked={editBranchMgrCanCreateSuppliers === false}
                            onChange={() => setEditBranchMgrCanCreateSuppliers(false)}
                            className="mt-0.5 text-[#1764FF] focus:ring-[#1764FF]"
                          />
                          <div>
                            <div className="font-bold">
                              {tr(
                                'لا، منع إضافة موردين',
                                'No, disallow adding suppliers',
                                'نہیں، سپلائرز شامل کرنے سے روکیں'
                              )}
                            </div>
                            <div className="text-[11px] opacity-75 leading-snug mt-0.5">
                              {tr(
                                'الاختيار الافتراضي: يختار فقط من الموردين النشطين المسجلين مسبقاً.',
                                'Default: can only select from pre-registered active suppliers.',
                                'بائی ڈیفالٹ: صرف پہلے سے درج فعال سپلائرز کا انتخاب کر سکتا ہے۔'
                              )}
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#08C99B]/10 border border-[#08C99B]/25 text-[11px] text-[#048264] dark:text-[#08C99B]">
                      {editBranchMgrCanCreateSuppliers
                        ? tr(
                            'صلاحيات مسؤول الفرع: تسجيل الإقفالات والمشتريات داخل الفرع المعين فقط، واختيار الموردين النشطين أو إضافة مورد جديد (دون تعديل أو إيقاف أو حذف أي مورد، ودون قراءة بيانات الفروع الأخرى).',
                            'Branch Manager permissions: record closings and purchases for the assigned branch only, select active suppliers, and add new suppliers (no edit, deactivate, or delete; no access to other branches).',
                            'برانچ مینیجر کے اختیارات: صرف مختص برانچ میں کلوزنگ اور خریداری درج کرنا، فعال سپلائرز منتخب کرنا اور نیا سپلائر شامل کرنا (ترمیم یا حذف کی اجازت نہیں)۔'
                          )
                        : tr(
                            'صلاحيات مسؤول الفرع: تسجيل الإقفالات والمشتريات داخل الفرع المعين فقط، وعرض الموردين المسجلين (لا يمكنه إضافة أو تعديل أو حذف الموردين، ولا قراءة بيانات الفروع الأخرى).',
                            'Branch Manager permissions: record closings and purchases for the assigned branch only, and view registered suppliers (cannot add/edit/delete suppliers or read other branches).',
                            'برانچ مینیجر کے اختیارات: صرف مختص برانچ میں کلوزنگ اور خریداری درج کرنا، اور رجسٹرڈ سپلائرز دیکھنا (سپلائرز شامل/ترمیم/حذف نہیں کر سکتا)۔'
                          )}
                    </div>
                  </div>
                )}

                {editRole === 'employee' && (
                  <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-[11px] text-sky-700 dark:text-sky-300">
                    {tr(
                      'صلاحيات الموظف: تسجيل إقفالات الورديات في فرعه المعين فقط، مع الإبقاء على الصلاحيات الأساسية دون توسيع.',
                      'Employee permissions: record shift closings for the assigned branch only, preserving minimal base access.',
                      'ملازم کے اختیارات: صرف اپنی مختص برانچ میں شفٹ کلوزنگ درج کرنا۔'
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr(
                      'ملاحظة: رابط استعادة كلمة المرور يُرسل إلى البريد المعتمد لتسجيل الدخول في Firebase Auth.',
                      'Note: Password reset links are sent to the verified sign-in email in Firebase Auth.',
                      'نوٹ: پاس ورڈ ری سیٹ لنک Firebase Auth میں تصدیق شدہ لاگ ان ای میل پر بھیجا جاتا ہے۔'
                    )}
                  </span>
                  <button
                    type="submit"
                    disabled={editSaving || selectedEmployee.isArchived === true}
                    className="px-5 py-2.5 rounded-xl font-bold text-xs text-white bg-[#1764FF] hover:bg-[#1052D8] transition-colors disabled:opacity-50"
                  >
                    {editSaving
                      ? tr('جاري الحفظ...', 'Saving...', 'محفوظ ہو رہا ہے...')
                      : tr('حفظ التعديلات', 'Save Changes', 'تبدیلیاں محفوظ کریں')}
                  </button>
                </div>
              </form>

              {/* Password Reset & Account Lifecycle Controls */}
              <div className="p-4 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3">
                <div className="text-xs font-bold text-[#0B1B32] dark:text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>
                    {tr(
                      'أمان الحساب وإدارة الإيقاف والأرشفة',
                      'Account Security, Suspension & Archival',
                      'اکاؤنٹ سکیورٹی، معطلی اور آرکائیو'
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleSendPasswordReset}
                    disabled={resetSending || selectedEmployee.isArchived === true}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF] text-[#0B1B32] dark:text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                    <span>
                      {resetSending
                        ? tr('جاري الإرسال...', 'Sending...', 'بھیجا جا رہا ہے...')
                        : t('empSendPasswordReset')}
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
                      <span>{tr('تعطيل الحساب مؤقتاً', 'Temporarily Disable', 'عارضی طور پر معطل کریں')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        toggleEmployeeStatus(selectedEmployee.uid, true).catch((err: any) =>
                          setActionFeedback({
                            type: 'error',
                            message:
                              err?.message ||
                              tr('فشل إعادة التنشيط.', 'Failed to reactivate account.', 'دوبارہ فعال کرنے میں ناکامی۔'),
                          })
                        )
                      }
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#048264] dark:text-[#08C99B] border border-[#08C99B]/35 hover:bg-[#08C99B]/10 inline-flex items-center gap-1.5"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{tr('إعادة تنشيط الحساب', 'Reactivate Account', 'اکاؤنٹ دوبارہ فعال کریں')}</span>
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
                <div className="text-xs font-bold text-[#0B1B32] dark:text-white flex items-center gap-1.5">
                  <History className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>
                    {tr(
                      'سجل نشاط الموظف وإقفالاته الأخيرة',
                      'Employee Activity & Recent Closings',
                      'ملازم کی سرگرمی اور حالیہ کلوزنگ'
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-2.5">
                    <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span>{tr('الورديات والإقفالات', 'Shifts & Closings', 'شفٹس اور کلوزنگ')}</span>
                      <span className="font-mono tabular-nums text-[#1764FF] dark:text-[#6CA2FF]">
                        {employeeActivity.closings.length}
                      </span>
                    </div>
                    {employeeActivity.closings.length === 0 ? (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 py-3 text-center">
                        {tr(
                          'لا توجد ورديات مسجلة لهذا الحساب بعد.',
                          'No shift closings recorded for this account yet.',
                          'اس اکاؤنٹ کے لیے ابھی کوئی شفٹ کلوزنگ درج نہیں ہے۔'
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-52 overflow-y-auto">
                        {employeeActivity.closings.map((c) => (
                          <div
                            key={c.id}
                            className="p-2.5 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-[11px] flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-[#0B1B32] dark:text-white truncate">
                                {c.branchName} •{' '}
                                {c.period === 'morning'
                                  ? tr('صباحية', 'Morning', 'صبح')
                                  : tr('مسائية', 'Evening', 'شام')}
                              </div>
                              <div className="font-mono text-slate-500 dark:text-slate-400">{c.date}</div>
                            </div>
                            <div className="text-end shrink-0">
                              <div className="font-mono font-bold text-[#048264] dark:text-[#08C99B]">
                                {formatCurrency(
                                  c.totalSales,
                                  currentOrg?.currency || 'SAR',
                                  language
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">{c.status}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-2.5">
                    <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span>{tr('سجل الرقابة الإداري', 'Administrative Audit Log', 'انتظامی آڈٹ لاگ')}</span>
                      <span className="font-mono tabular-nums text-sky-600 dark:text-sky-400">
                        {employeeActivity.logs.length}
                      </span>
                    </div>
                    {employeeActivity.logs.length === 0 ? (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 py-3 text-center">
                        {tr(
                          'لا توجد حركات تدقيق مسجلة بعد.',
                          'No audit log entries recorded yet.',
                          'ابھی کوئی آڈٹ سرگرمی درج نہیں ہے۔'
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-52 overflow-y-auto">
                        {employeeActivity.logs.map((l) => (
                          <div
                            key={l.id}
                            className="p-2.5 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-[11px] space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-[#1764FF] dark:text-[#6CA2FF]">{l.action}</span>
                              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                {new Date(l.timestamp).toLocaleDateString(dateLocale)}
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#0B1B32]/80 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h5 className="text-sm font-bold text-[#0B1B32] dark:text-white">
                  {confirmAction.type === 'archive'
                    ? tr(
                        `تأكيد أرشفة وإيقاف حساب "${confirmAction.employee.displayName}"`,
                        `Confirm Archive & Revoke "${confirmAction.employee.displayName}"`,
                        `"${confirmAction.employee.displayName}" کا اکاؤنٹ آرکائیو اور بند کرنے کی تصدیق`
                      )
                    : tr(
                        `تأكيد تعطيل حساب "${confirmAction.employee.displayName}"`,
                        `Confirm Disable "${confirmAction.employee.displayName}"`,
                        `"${confirmAction.employee.displayName}" کا اکاؤنٹ معطل کرنے کی تصدیق`
                      )}
                </h5>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {confirmAction.type === 'archive'
                    ? tr(
                        'سيتم إيقاف الحساب ومنع تسجيل الدخول نهائياً مع الاحتفاظ التام بجميع الإقفالات والسجلات المالية وسجل الرقابة التاريخي دون أي حذف فعلي.',
                        'This permanently revokes sign-in access while preserving all shift closings, financial records, and audit history untouched.',
                        'اس سے لاگ ان رسائی مستقل طور پر بند ہو جائے گی جبکہ تمام کلوزنگ، مالی ریکارڈز اور آڈٹ تاریخ مکمل طور پر محفوظ رہے گی۔'
                      )
                    : tr(
                        'لن يتمكن هذا المستخدم من تسجيل الدخول أو تنفيذ أي عملية حتى يعيد المدير تنشيط الحساب، وتبقى جميع سجلاته محفوظة.',
                        'This user will be unable to sign in or perform actions until reactivated by a manager. All records remain preserved.',
                        'یہ صارف مینیجر کی جانب سے دوبارہ فعال کیے جانے تک لاگ ان یا کوئی کارروائی نہیں کر سکے گا۔ تمام ریکارڈز محفوظ رہیں گے۔'
                      )}
                </p>
              </div>
            </div>

            {confirmAction.type === 'archive' && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {tr('سبب الأرشفة (اختياري)', 'Archival Reason (Optional)', 'آرکائیو کی وجہ (اختیاری)')}
                </label>
                <input
                  type="text"
                  value={confirmAction.reason}
                  onChange={(e) =>
                    setConfirmAction((prev) =>
                      prev ? { ...prev, reason: e.target.value } : null
                    )
                  }
                  placeholder={tr(
                    'مثال: انتهاء فترة العمل في المؤسسة',
                    'e.g., End of employment',
                    'مثال: ملازمت کی مدت مکمل ہونا'
                  )}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={confirmBusy}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-[#F5F8FF] dark:hover:bg-[#173056]"
              >
                {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
              </button>
              <button
                type="button"
                onClick={handleConfirmLifecycleAction}
                disabled={confirmBusy}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
              >
                {confirmBusy
                  ? tr('جاري التنفيذ...', 'Processing...', 'کارروائی جاری ہے...')
                  : confirmAction.type === 'archive'
                  ? tr('تأكيد الأرشفة مع حفظ السجلات', 'Confirm Archive & Keep Records', 'ریکارڈز محفوظ رکھ کر آرکائیو کریں')
                  : tr('تأكيد التعطيل', 'Confirm Disable', 'معطلی کی تصدیق کریں')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
