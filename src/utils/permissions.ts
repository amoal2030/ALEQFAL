import {
  SupportedLanguage,
  UserPermissions,
  UserProfile,
  UserRole,
} from '../types';

export const VALID_USER_ROLES: readonly UserRole[] = [
  'manager',
  'supervisor',
  'branch_manager',
  'employee',
] as const;

export const SUPERVISOR_OPTIONAL_PERMISSION_KEYS = [
  'canCreateClosing',
  'canViewAllClosings',
  'canApproveClosings',
  'canManagePurchases',
  'canManageSuppliers',
  'canViewSuppliers',
  'canViewFinancialReports',
  'canExportReports',
] as const;

export type SupervisorOptionalPermissionKey =
  (typeof SUPERVISOR_OPTIONAL_PERMISSION_KEYS)[number];

export interface EffectivePermissions extends Required<UserPermissions> {
  canAdminCorrectClosings: boolean;
  canManageOrgDrive: boolean;
  canManageUsersAndRoles: boolean;
  hasOrgWideBranchScope: boolean;
  hasSingleBranchRestriction: boolean;
}

const ROLE_LABELS: Record<UserRole, Record<SupportedLanguage, string>> = {
  manager: {
    ar: 'مدير المؤسسة',
    en: 'Organization Manager',
    ur: 'ادارے کا منیجر',
  },
  supervisor: {
    ar: 'مسؤول',
    en: 'Supervisor',
    ur: 'سپروائزر',
  },
  branch_manager: {
    ar: 'مسؤول فرع',
    en: 'Branch Manager',
    ur: 'برانچ منیجر',
  },
  employee: {
    ar: 'موظف',
    en: 'Employee',
    ur: 'ملازم',
  },
};

export function isValidUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (VALID_USER_ROLES as readonly string[]).includes(value);
}

export function getUserRoleLabel(
  role: UserRole | string | undefined | null,
  language: SupportedLanguage = 'ar'
): string {
  if (!role || !isValidUserRole(role)) {
    return ROLE_LABELS.employee[language] || ROLE_LABELS.employee.ar;
  }
  return ROLE_LABELS[role][language] || ROLE_LABELS[role].ar;
}

/**
 * Resolves assigned branch IDs for a user while maintaining full backwards-compatibility
 * with legacy accounts that store only scalar `branchId`.
 */
export function resolveUserAssignedBranchIds(
  profile: Pick<UserProfile, 'branchId' | 'branchIds'> | null | undefined
): string[] {
  if (!profile) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  if (typeof profile.branchId === 'string' && profile.branchId.trim().length > 0) {
    const clean = profile.branchId.trim();
    seen.add(clean);
    result.push(clean);
  }

  if (Array.isArray(profile.branchIds)) {
    for (const rawId of profile.branchIds) {
      if (typeof rawId === 'string') {
        const clean = rawId.trim();
        if (clean.length > 0 && !seen.has(clean)) {
          seen.add(clean);
          result.push(clean);
        }
      }
    }
  }

  return result;
}

export function resolvePrimaryAssignedBranchId(
  profile: Pick<UserProfile, 'branchId' | 'branchIds'> | null | undefined
): string | null {
  const list = resolveUserAssignedBranchIds(profile);
  return list.length > 0 ? list[0] : null;
}

export function canUserAccessBranch(
  profile: Pick<UserProfile, 'role' | 'isActive' | 'branchId' | 'branchIds'> | null | undefined,
  targetBranchId: string | null | undefined
): boolean {
  if (!profile || profile.isActive !== true) return false;
  if (!targetBranchId || !targetBranchId.trim()) return false;

  if (profile.role === 'manager' || profile.role === 'supervisor') {
    return true;
  }

  const assigned = resolveUserAssignedBranchIds(profile);
  if (profile.role === 'branch_manager') {
    return assigned.length === 1 && assigned[0] === targetBranchId.trim();
  }

  return assigned.includes(targetBranchId.trim());
}

/**
 * Builds canonical default permission map per role.
 * - manager: full org permissions
 * - supervisor: zero optional permissions enabled by default (strictly opt-in by manager)
 * - branch_manager: shift closing + purchase entry + reading pre-registered suppliers in their branch ONLY
 * - employee: standard shift closing creation in their assigned branch ONLY
 */
export function buildDefaultPermissionsForRole(
  role: UserRole,
  optionalOverrides?: Partial<Record<SupervisorOptionalPermissionKey, boolean>>
): Required<UserPermissions> {
  if (role === 'manager') {
    return {
      canCreateClosing: true,
      canViewAllClosings: true,
      canApproveClosings: true,
      canManageBranches: true,
      canManageEmployees: true,
      canExportReports: true,
      canManagePurchases: true,
      canManageSuppliers: true,
      canViewSuppliers: true,
      canViewFinancialReports: true,
    };
  }

  if (role === 'supervisor') {
    const canManageSuppliers = optionalOverrides?.canManageSuppliers === true;
    const canViewFinancialReports = optionalOverrides?.canViewFinancialReports === true;
    return {
      canCreateClosing: optionalOverrides?.canCreateClosing === true,
      canViewAllClosings: optionalOverrides?.canViewAllClosings === true,
      canApproveClosings: optionalOverrides?.canApproveClosings === true,
      canManageBranches: false,
      canManageEmployees: false,
      canExportReports: optionalOverrides?.canExportReports === true || canViewFinancialReports,
      canManagePurchases: optionalOverrides?.canManagePurchases === true,
      canManageSuppliers,
      canViewSuppliers: optionalOverrides?.canViewSuppliers === true || canManageSuppliers,
      canViewFinancialReports,
    };
  }

  if (role === 'branch_manager') {
    return {
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
    };
  }

  // 'employee' retains existing baseline permissions without expansion
  return {
    canCreateClosing: true,
    canViewAllClosings: false,
    canApproveClosings: false,
    canManageBranches: false,
    canManageEmployees: false,
    canExportReports: false,
    canManagePurchases: false,
    canManageSuppliers: false,
    canViewSuppliers: false,
    canViewFinancialReports: false,
  };
}

/**
 * Evaluates effective operational permissions for an authenticated active user profile.
 * Never grants unapproved optional privileges to supervisors, branch managers, or employees.
 */
export function resolveEffectivePermissions(
  profile: Pick<UserProfile, 'role' | 'isActive' | 'branchId' | 'branchIds' | 'permissions'> | null | undefined
): EffectivePermissions {
  const denied: EffectivePermissions = {
    canCreateClosing: false,
    canViewAllClosings: false,
    canApproveClosings: false,
    canManageBranches: false,
    canManageEmployees: false,
    canExportReports: false,
    canManagePurchases: false,
    canManageSuppliers: false,
    canViewSuppliers: false,
    canViewFinancialReports: false,
    canAdminCorrectClosings: false,
    canManageOrgDrive: false,
    canManageUsersAndRoles: false,
    hasOrgWideBranchScope: false,
    hasSingleBranchRestriction: true,
  };

  if (!profile || profile.isActive !== true) {
    return denied;
  }

  const rawPerms = (profile.permissions || {}) as Partial<UserPermissions>;

  if (profile.role === 'manager') {
    return {
      canCreateClosing: true,
      canViewAllClosings: true,
      canApproveClosings: true,
      canManageBranches: false, // Branch creation is restricted exclusively to Super Admin
      canManageEmployees: true,
      canExportReports: true,
      canManagePurchases: true,
      canManageSuppliers: true,
      canViewSuppliers: true,
      canViewFinancialReports: true,
      canAdminCorrectClosings: true,
      canManageOrgDrive: true,
      canManageUsersAndRoles: true,
      hasOrgWideBranchScope: true,
      hasSingleBranchRestriction: false,
    };
  }

  if (profile.role === 'supervisor') {
    const canManageSuppliers = rawPerms.canManageSuppliers === true;
    const canViewFinancialReports = rawPerms.canViewFinancialReports === true;
    return {
      canCreateClosing: rawPerms.canCreateClosing === true,
      canViewAllClosings: rawPerms.canViewAllClosings === true,
      canApproveClosings: rawPerms.canApproveClosings === true,
      canManageBranches: false,
      canManageEmployees: false,
      canExportReports: rawPerms.canExportReports === true || canViewFinancialReports,
      canManagePurchases: rawPerms.canManagePurchases === true,
      canManageSuppliers,
      canViewSuppliers: rawPerms.canViewSuppliers === true || canManageSuppliers,
      canViewFinancialReports,
      canAdminCorrectClosings: false,
      canManageOrgDrive: false,
      canManageUsersAndRoles: false,
      hasOrgWideBranchScope: true,
      hasSingleBranchRestriction: false,
    };
  }

  if (profile.role === 'branch_manager') {
    const assigned = resolveUserAssignedBranchIds(profile);
    if (assigned.length !== 1) {
      return denied;
    }
    return {
      canCreateClosing: rawPerms.canCreateClosing !== false,
      canViewAllClosings: false,
      canApproveClosings: false,
      canManageBranches: false,
      canManageEmployees: false,
      canExportReports: false,
      canManagePurchases: rawPerms.canManagePurchases !== false,
      canManageSuppliers: false,
      canViewSuppliers: rawPerms.canViewSuppliers !== false,
      canViewFinancialReports: false,
      canAdminCorrectClosings: false,
      canManageOrgDrive: false,
      canManageUsersAndRoles: false,
      hasOrgWideBranchScope: false,
      hasSingleBranchRestriction: true,
    };
  }

  // 'employee'
  return {
    canCreateClosing: rawPerms.canCreateClosing !== false,
    canViewAllClosings: false,
    canApproveClosings: false,
    canManageBranches: false,
    canManageEmployees: false,
    canExportReports: false,
    canManagePurchases: false,
    canManageSuppliers: false,
    canViewSuppliers: false,
    canViewFinancialReports: false,
    canAdminCorrectClosings: false,
    canManageOrgDrive: false,
    canManageUsersAndRoles: false,
    hasOrgWideBranchScope: false,
    hasSingleBranchRestriction: true,
  };
}

export function validateRoleAssignmentInput(params: {
  actorRole: UserRole;
  targetRole: UserRole;
  branchId?: string;
  branchIds?: string[];
}): { valid: true; assignedBranchId?: string } | { valid: false; error: string } {
  if (params.actorRole !== 'manager') {
    return {
      valid: false,
      error: 'إدارة أدوار المستخدمين وصلاحياتهم مقتصرة على مدير المؤسسة فقط.',
    };
  }

  if (params.targetRole === 'manager') {
    return {
      valid: false,
      error: 'لا يمكن ترقية أو تعيين دور مدير المؤسسة من هنا.',
    };
  }

  if (params.targetRole === 'employee' || params.targetRole === 'branch_manager') {
    const cleanBranchId = (params.branchId || '').trim();
    if (!cleanBranchId) {
      return {
        valid: false,
        error:
          params.targetRole === 'branch_manager'
            ? 'يجب ربط مسؤول الفرع بفرع واحد محدد.'
            : 'يجب ربط الموظف بفرع محدد.',
      };
    }

    if (params.targetRole === 'branch_manager' && Array.isArray(params.branchIds)) {
      const unique = Array.from(
        new Set(params.branchIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))
      );
      if (unique.length > 1 || (unique.length === 1 && unique[0] !== cleanBranchId)) {
        return {
          valid: false,
          error: 'يرتبط مسؤول الفرع بفرع واحد فقط ولا يمكن إسناد عدة فروع له.',
        };
      }
    }

    return { valid: true, assignedBranchId: cleanBranchId };
  }

  return { valid: true };
}
