import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import {
  Branch,
  BranchPaymentStatus,
  DriveHealthStatus,
  ExemptionClassification,
  FeePaymentStatus,
  ManagerInvite,
  Organization,
  PlatformAuditLog,
  SubscriptionPlan,
  SubscriptionStatus,
  UserProfile,
  NotificationNavTarget,
} from '../../types';
import { NotificationCenter } from '../common/NotificationCenter';
import { BrandLogo } from '../common/BrandLogo';
import { AppPageRoute, buildLegalPath } from '../../utils/legalRoutes';
import {
  getUserRoleLabel,
  SUPERVISOR_OPTIONAL_PERMISSION_KEYS,
  SupervisorOptionalPermissionKey,
} from '../../utils/permissions';
import {
  calculateSubscriptionEndDate,
  evaluateOrganizationSubscription,
  getSubscriptionPlanLabel,
  SUBSCRIPTION_PLANS,
  toValidDate,
} from '../../utils/subscription';
import {
  ACCOUNT_SETUP_FEE_SAR,
  BRANCH_MONTHLY_FEE_SAR,
  BranchDriveBackupVerificationResult,
  evaluateBranchBillingAndGrace,
  evaluateOrganizationBranchPricing,
  evaluateOrgNoPaidBranchGrace,
  ORG_REACTIVATION_FEE_SAR,
} from '../../utils/branchPricing';
import {
  verifyBranchExemptionEligibility,
  verifyOrganizationExemptionEligibility,
} from '../../utils/exemptionVerification';
import {
  ALLOWED_SUPER_ADMIN_MEMBER_ROLES,
  getPlatformAuditActionLabel,
  isAllowedSuperAdminMemberRole,
  isMemberEligibleForRelease,
  isMemberReleased,
  SuperAdminAssignableMemberRole,
} from '../../utils/superAdminGovernance';
import { resolveMemberMembershipStatus } from '../../utils/tenantAccess';
import {
  detectProfileEmailDiagnostics,
  normalizeLoginEmail,
  validatePasswordConfirmation,
} from '../../utils/authCredentials';
import { SUPER_ADMIN_EMAIL } from '../../utils/superAdmin';
import {
  Building2,
  GitBranch,
  Users,
  ShieldCheck,
  RefreshCw,
  Search,
  LogOut,
  Sun,
  Moon,
  Globe,
  ChevronDown,
  Eye,
  EyeOff,
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Plus,
  Edit3,
  Mail,
  Ban,
  Play,
  Trash2,
  FileText,
  CreditCard,
  ShieldAlert,
  Info,
  UserPlus,
  Archive,
  RotateCcw,
  Layers,
  Lock,
  Unlink,
  Link2,
  History,
  KeyRound,
} from 'lucide-react';

interface SuperAdminDashboardProps {
  onSwitchToTenantDashboard?: () => void;
  onSwitchToOnboarding?: () => void;
  onNavigatePage?: (page: AppPageRoute) => void;
}

type MainTab = 'organizations' | 'branches' | 'members' | 'invites' | 'auditLogs';
type OrgFilter = 'all' | 'active' | 'exempt' | 'legacy' | 'grace_7d' | 'suspended' | 'attention';
type BranchFilter = 'all' | 'active' | 'exempt' | 'unpaid_overdue' | 'suspended' | 'purge_ready' | 'purged';
type MemberRoleFilter = 'all' | 'manager' | 'supervisor' | 'branch_manager' | 'employee';
type MemberStatusFilter = 'all' | 'active' | 'archived' | 'released';
type AuditCategoryFilter = 'all' | 'exemptions' | 'members' | 'organizations' | 'branches' | 'invites';

const SUPERVISOR_PERM_LABELS: Record<
  SupervisorOptionalPermissionKey,
  { ar: string; en: string; ur: string }
> = {
  canCreateClosing: { ar: 'إنشاء إقفالات وردية', en: 'Create Shift Closings', ur: 'شفٹ کلوزنگ بنانا' },
  canViewAllClosings: { ar: 'عرض جميع إقفالات الفروع', en: 'View All Branch Closings', ur: 'تمام برانچ کلوزنگ دیکھنا' },
  canApproveClosings: { ar: 'اعتماد ورفض الإقفالات', en: 'Approve / Reject Closings', ur: 'کلوزنگ منظور/مسترد کرنا' },
  canManagePurchases: { ar: 'إدارة المشتريات والمصروفات', en: 'Manage Purchases', ur: 'خریداری کا انتظام' },
  canManageSuppliers: { ar: 'إدارة الموردين', en: 'Manage Suppliers', ur: 'سپلائرز کا انتظام' },
  canViewSuppliers: { ar: 'عرض الموردين', en: 'View Suppliers', ur: 'سپلائرز دیکھنا' },
  canViewFinancialReports: { ar: 'عرض التقارير المالية', en: 'View Financial Reports', ur: 'مالی رپورٹس دیکھنا' },
  canExportReports: { ar: 'تصدير التقارير', en: 'Export Reports', ur: 'رپورٹس ایکسپورٹ کرنا' },
};

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({
  onSwitchToTenantDashboard,
  onSwitchToOnboarding,
  onNavigatePage,
}) => {
  const {
    currentUser,
    isSuperAdmin,
    authEmailMismatch,
    superAdminOverview,
    superAdminLoading,
    superAdminError,
    loadSuperAdminOverview,
    createSuperAdminOrganizationWithInvite,
    updateSuperAdminOrganizationProfileAndBilling,
    updateSuperAdminOrgStatus,
    grantSuperAdminOrgBillingExemption,
    revokeSuperAdminOrgBillingExemption,
    grantSuperAdminBranchExemption,
    revokeSuperAdminBranchExemption,
    grantSuperAdminBulkOrgBranchesExemption,
    createSuperAdminOrgMember,
    updateSuperAdminOrgMember,
    archiveSuperAdminOrgMember,
    reactivateSuperAdminOrgMember,
    releaseSuperAdminOrgMember,
    assignReleasedMemberToOrganization,
    sendSuperAdminMemberPasswordReset,
    upsertSuperAdminManagerInvite,
    cancelSuperAdminManagerInvite,
    createSuperAdminBranch,
    recordSuperAdminBranchPayment,
    suspendSuperAdminBranch,
    reactivateSuperAdminBranch,
    inspectBranchDriveBackupForPurge,
    purgeSuspendedBranchFromDb,
    logout,
  } = useAuth();
  const { language, setLanguage, direction, t, tr } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [mainTab, setMainTab] = useState<MainTab>('organizations');
  const [searchTerm, setSearchTerm] = useState('');
  const [orgFilter, setOrgFilter] = useState<OrgFilter>('all');
  const [branchFilter, setBranchFilter] = useState<BranchFilter>('all');
  const [memberOrgFilter, setMemberOrgFilter] = useState<string>('all');
  const [memberRoleFilter, setMemberRoleFilter] = useState<MemberRoleFilter>('all');
  const [memberStatusFilter, setMemberStatusFilter] = useState<MemberStatusFilter>('all');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<AuditCategoryFilter>('all');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'branches' | 'users'>('branches');
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const [busyAction, setBusyAction] = useState(false);
  const inFlightUiRef = useRef<boolean>(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Create Org + Invite Modal state
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextMonthIso = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const [createOrgForm, setCreateOrgForm] = useState({
    name: '',
    taxNumber: '',
    commercialRegistration: '',
    activityType: 'retail',
    currency: 'SAR',
    ownerName: '',
    ownerEmail: '',
    subscriptionPlan: '1m' as SubscriptionPlan,
    startDateIso: todayIso,
    endDateIso: '',
    subscriptionNote: '',
    setupFeeStatus: 'paid' as FeePaymentStatus,
    setupFeePaidDateIso: todayIso,
    firstBranchName: 'الفرع الرئيسي',
    firstBranchCode: 'MAIN',
    firstBranchPaymentStatus: 'paid' as BranchPaymentStatus,
    firstBranchDueDateIso: nextMonthIso,
  });

  // Edit Org Profile & Billing Modal state
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [editOrgForm, setEditOrgForm] = useState({
    name: '',
    taxNumber: '',
    commercialRegistration: '',
    activityType: 'retail',
    currency: 'SAR',
    ownerName: '',
    ownerEmail: '',
    setupFeeStatus: 'paid' as FeePaymentStatus,
    setupFeePaidDateIso: todayIso,
    subscriptionPlan: '1m' as SubscriptionPlan,
    subscriptionStatus: 'active' as SubscriptionStatus,
    startDateIso: todayIso,
    endDateIso: nextMonthIso,
    subscriptionNote: '',
    convertLegacyToPaid: false,
  });

  // Org Status / Reactivation Modal state
  const [statusModalOrg, setStatusModalOrg] = useState<Organization | null>(null);
  const [statusActionMode, setStatusActionMode] = useState<
    'suspend' | 'start_no_paid_branch_grace' | 'deactivate_no_paid_branches' | 'reactivate'
  >('reactivate');
  const [reactivationFeeStatus, setReactivationFeeStatus] = useState<FeePaymentStatus>('paid');
  const [reactivationFeeDateIso, setReactivationFeeDateIso] = useState(todayIso);
  const [statusNote, setStatusNote] = useState('');

  // Invite Modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    orgId: '',
    managerName: '',
  });

  // Create Branch Modal state
  const [showCreateBranchModal, setShowCreateBranchModal] = useState(false);
  const [createBranchForm, setCreateBranchForm] = useState({
    orgId: '',
    name: '',
    code: '',
    address: '',
    phone: '',
    paymentStatus: 'paid' as BranchPaymentStatus,
    subscriptionStartIso: todayIso,
    feeDueDateIso: nextMonthIso,
    paymentNote: '',
  });

  // Branch Payment Modal state
  const [paymentModalBranch, setPaymentModalBranch] = useState<Branch | null>(null);
  const [branchPaymentForm, setBranchPaymentForm] = useState({
    paymentStatus: 'paid' as BranchPaymentStatus,
    paidDateIso: todayIso,
    feeDueDateIso: nextMonthIso,
    monthlyFeeSar: BRANCH_MONTHLY_FEE_SAR,
    paymentNote: '',
  });

  // Reactivate Branch Modal state
  const [reactivateBranchTarget, setReactivateBranchTarget] = useState<Branch | null>(null);
  const [reactivateBranchForm, setReactivateBranchForm] = useState({
    paymentStatus: 'paid' as BranchPaymentStatus,
    feeDueDateIso: nextMonthIso,
    paymentNote: '',
  });

  // Suspend Branch Modal state
  const [suspendBranchTarget, setSuspendBranchTarget] = useState<Branch | null>(null);
  const [suspendBranchReason, setSuspendBranchReason] = useState('إيقاف مؤقت بطلب إداري أو عدم السداد');

  // Inspect & Purge Branch Modal state
  const [purgeModalBranch, setPurgeModalBranch] = useState<Branch | null>(null);
  const [purgeInspection, setPurgeInspection] = useState<
    (BranchDriveBackupVerificationResult & {
      purchasesCount: number;
      attachmentsCount: number;
    }) | null
  >(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');

  // Permanent Organization Exemption Modal state (Super Admin only)
  const [exemptionModalOrg, setExemptionModalOrg] = useState<Organization | null>(null);
  const [orgExemptionMode, setOrgExemptionMode] = useState<ExemptionClassification>('legacy_unrestricted');
  const [exemptionReason, setExemptionReason] = useState('');
  const [exemptionConfirmed, setExemptionConfirmed] = useState(false);

  // Individual Branch Exemption Modal state (Super Admin only)
  const [branchExemptionModalTarget, setBranchExemptionModalTarget] = useState<Branch | null>(null);
  const [branchExemptionMode, setBranchExemptionMode] = useState<ExemptionClassification>('billing_exempt');
  const [branchExemptionReason, setBranchExemptionReason] = useState('');
  const [branchExemptionRestoredStatus, setBranchExemptionRestoredStatus] =
    useState<Exclude<BranchPaymentStatus, 'exempt'>>('unpaid');
  const [branchExemptionRestoredFeeSar, setBranchExemptionRestoredFeeSar] =
    useState<number>(BRANCH_MONTHLY_FEE_SAR);
  const [branchExemptionConfirmed, setBranchExemptionConfirmed] = useState(false);

  // Bulk All-Branches Exemption Modal state (Super Admin only)
  const [bulkBranchExemptionOrg, setBulkBranchExemptionOrg] = useState<Organization | null>(null);
  const [bulkBranchExemptionMode, setBulkBranchExemptionMode] =
    useState<ExemptionClassification>('billing_exempt');
  const [bulkBranchExemptionReason, setBulkBranchExemptionReason] = useState('');
  const [bulkBranchExemptionConfirmed, setBulkBranchExemptionConfirmed] = useState(false);

  // Cross-Org Member Management Modals state (Super Admin only)
  const [showCreateMemberModal, setShowCreateMemberModal] = useState(false);
  const [showCreateMemberPassword, setShowCreateMemberPassword] = useState(false);
  const [showCreateMemberConfirmPassword, setShowCreateMemberConfirmPassword] = useState(false);
  const [createMemberForm, setCreateMemberForm] = useState<{
    orgId: string;
    displayName: string;
    email: string;
    password: string;
    confirmPassword: string;
    phone: string;
    role: SuperAdminAssignableMemberRole;
    branchId: string;
    supervisorPermissions: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
  }>({
    orgId: '',
    displayName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    role: 'employee',
    branchId: '',
    supervisorPermissions: {},
  });

  const [editingMember, setEditingMember] = useState<UserProfile | null>(null);
  const [editMemberForm, setEditMemberForm] = useState<{
    displayName: string;
    phone: string;
    role: SuperAdminAssignableMemberRole;
    branchId: string;
    supervisorPermissions: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
    reason: string;
  }>({
    displayName: '',
    phone: '',
    role: 'employee',
    branchId: '',
    supervisorPermissions: {},
    reason: '',
  });

  const [memberLifecycleModal, setMemberLifecycleModal] = useState<{
    member: UserProfile;
    mode: 'archive' | 'reactivate';
  } | null>(null);
  const [memberLifecycleReason, setMemberLifecycleReason] = useState('');
  const [memberLifecycleConfirmed, setMemberLifecycleConfirmed] = useState(false);

  // Phase C.1 — Permanent Member Release, Released-Member Re-Assignment & Member History Modals
  const [releaseMemberTarget, setReleaseMemberTarget] = useState<UserProfile | null>(null);
  const [releaseMemberReason, setReleaseMemberReason] = useState('');
  const [releaseMemberConfirmed, setReleaseMemberConfirmed] = useState(false);

  const [assignMemberTarget, setAssignMemberTarget] = useState<UserProfile | null>(null);
  const [assignMemberForm, setAssignMemberForm] = useState<{
    targetOrgId: string;
    role: SuperAdminAssignableMemberRole;
    branchId: string;
    supervisorPermissions: Partial<Record<SupervisorOptionalPermissionKey, boolean>>;
    reason: string;
    sendOptionalPasswordReset: boolean;
  }>({
    targetOrgId: '',
    role: 'employee',
    branchId: '',
    supervisorPermissions: {},
    reason: '',
    sendOptionalPasswordReset: false,
  });
  const [assignMemberConfirmed, setAssignMemberConfirmed] = useState(false);

  const [memberDetailUid, setMemberDetailUid] = useState<string | null>(null);

  useEffect(() => {
    if (isSuperAdmin) {
      loadSuperAdminOverview().catch(() => {
        // Error handled inside AuthContext
      });
    }
  }, [isSuperAdmin, currentUser?.uid]);

  const organizations = superAdminOverview?.organizations ?? [];
  const allBranches = superAdminOverview?.branches ?? [];
  const allUsers = superAdminOverview?.users ?? [];
  const allInvites = superAdminOverview?.managerInvites ?? [];
  const platformAuditLogs = superAdminOverview?.platformAuditLogs ?? [];
  const allMemberOrgHistory = superAdminOverview?.memberOrgHistory ?? [];

  const orgMap = useMemo(() => {
    const m = new Map<string, Organization>();
    organizations.forEach((o) => m.set(o.id, o));
    return m;
  }, [organizations]);

  const branchesByOrg = useMemo(() => {
    const map = new Map<string, Branch[]>();
    for (const branch of allBranches) {
      const list = map.get(branch.orgId) || [];
      list.push(branch);
      map.set(branch.orgId, list);
    }
    return map;
  }, [allBranches]);

  const usersByOrg = useMemo(() => {
    const map = new Map<string, UserProfile[]>();
    for (const user of allUsers) {
      const list = map.get(user.orgId) || [];
      list.push(user);
      map.set(user.orgId, list);
    }
    return map;
  }, [allUsers]);

  const inviteByOrgId = useMemo(() => {
    const map = new Map<string, ManagerInvite>();
    for (const inv of allInvites) {
      if (!map.has(inv.orgId)) {
        map.set(inv.orgId, inv);
      }
    }
    return map;
  }, [allInvites]);

  const stats = useMemo(() => {
    const now = new Date();
    let activeOrgsCount = 0;
    let exemptOrgsCount = 0;
    let legacyOrgsCount = 0;
    let suspendedOrgsCount = 0;
    let grace7dOrgsCount = 0;
    let expectedMonthlyBranchesSar = 0;

    for (const org of organizations) {
      const orgBranches = branchesByOrg.get(org.id) || [];
      const subEval = evaluateOrganizationSubscription(org, now);
      const graceEval = evaluateOrgNoPaidBranchGrace(org, orgBranches, now);
      const pricingEval = evaluateOrganizationBranchPricing({
        org,
        branches: orgBranches,
        now,
      });

      if (subEval.isBillingExempt) exemptOrgsCount += 1;
      if (subEval.isLegacy) legacyOrgsCount += 1;
      if (!subEval.isAllowed) {
        suspendedOrgsCount += 1;
      } else {
        activeOrgsCount += 1;
      }
      if (graceEval.inGrace && !graceEval.isFeeExempt) {
        grace7dOrgsCount += 1;
      }
      expectedMonthlyBranchesSar += pricingEval.estimatedMonthlyBranchTotalSar;
    }

    let activeBranchesCount = 0;
    let exemptBranchesCount = 0;
    let suspendedBranchesCount = 0;
    let purgeReadyBranchesCount = 0;
    let purgedBranchesCount = 0;

    for (const b of allBranches) {
      const evalB = evaluateBranchBillingAndGrace(b, orgMap.get(b.orgId), now);
      if (evalB.isFeeExempt && !evalB.isPurgedFromDb) {
        exemptBranchesCount += 1;
      }
      if (evalB.isPurgedFromDb) {
        purgedBranchesCount += 1;
      } else if (evalB.isSuspended) {
        suspendedBranchesCount += 1;
        if (evalB.isGraceExpired) {
          purgeReadyBranchesCount += 1;
        }
      } else {
        activeBranchesCount += 1;
      }
    }

    const driveVerifiedCount = organizations.filter(
      (o) => o.driveConnected && o.driveWriteVerified === true && o.driveLastHealthStatus !== 'failed'
    ).length;

    const releasedMembersCount = allUsers.filter(
      (u) => resolveMemberMembershipStatus(u) === 'released'
    ).length;
    const archivedMembersCount = allUsers.filter((u) => {
      const st = resolveMemberMembershipStatus(u);
      return st === 'archived' || (st !== 'released' && u.isActive === false);
    }).length;
    const activeMembersCount = allUsers.length - archivedMembersCount - releasedMembersCount;

    return {
      totalOrgs: organizations.length,
      activeOrgsCount,
      exemptOrgsCount,
      legacyOrgsCount,
      suspendedOrgsCount,
      grace7dOrgsCount,
      expectedMonthlyBranchesSar,
      totalBranches: allBranches.length,
      activeBranchesCount,
      exemptBranchesCount,
      suspendedBranchesCount,
      purgeReadyBranchesCount,
      purgedBranchesCount,
      driveVerifiedCount,
      totalUsers: allUsers.length,
      activeMembersCount,
      archivedMembersCount,
      releasedMembersCount,
      pendingInvitesCount: allInvites.filter((i) => i.status === 'pending').length,
    };
  }, [organizations, allBranches, allUsers, allInvites, branchesByOrg, orgMap]);

  const branchMap = useMemo(() => {
    const m = new Map<string, Branch>();
    allBranches.forEach((b) => m.set(b.id, b));
    return m;
  }, [allBranches]);

  const userMap = useMemo(() => {
    const m = new Map<string, UserProfile>();
    allUsers.forEach((u) => m.set(u.uid, u));
    return m;
  }, [allUsers]);

  const memberHistoryByUid = useMemo(() => {
    const m = new Map<string, typeof allMemberOrgHistory>();
    for (const rec of allMemberOrgHistory) {
      const existing = m.get(rec.uid);
      if (existing) {
        existing.push(rec);
      } else {
        m.set(rec.uid, [rec]);
      }
    }
    return m;
  }, [allMemberOrgHistory]);

  const latestReleaseHistoryByUid = useMemo(() => {
    const m = new Map<string, (typeof allMemberOrgHistory)[number]>();
    for (const rec of allMemberOrgHistory) {
      if (rec.eventType === 'released' && !m.has(rec.uid)) {
        m.set(rec.uid, rec);
      }
    }
    return m;
  }, [allMemberOrgHistory]);

  const filteredOrganizations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const now = new Date();
    return organizations.filter((org) => {
      const orgBranches = branchesByOrg.get(org.id) || [];
      const subEval = evaluateOrganizationSubscription(org, now);
      const graceEval = evaluateOrgNoPaidBranchGrace(org, orgBranches, now);

      if (orgFilter === 'active' && !subEval.isAllowed) return false;
      if (orgFilter === 'exempt' && !subEval.isBillingExempt) return false;
      if (orgFilter === 'legacy' && !subEval.isLegacy) return false;
      if (orgFilter === 'grace_7d' && (!graceEval.inGrace || graceEval.isFeeExempt)) return false;
      if (orgFilter === 'suspended' && subEval.isAllowed) return false;
      if (
        orgFilter === 'attention' &&
        org.driveConnected &&
        org.driveWriteVerified &&
        org.driveLastHealthStatus !== 'failed'
      ) {
        return false;
      }

      if (!term) return true;
      return (
        org.name?.toLowerCase().includes(term) ||
        org.id?.toLowerCase().includes(term) ||
        (org.taxNumber || '').toLowerCase().includes(term) ||
        (org.commercialRegistration || '').toLowerCase().includes(term) ||
        org.ownerName?.toLowerCase().includes(term) ||
        org.ownerEmail?.toLowerCase().includes(term)
      );
    });
  }, [organizations, searchTerm, orgFilter, branchesByOrg]);

  const filteredBranches = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const now = new Date();
    return allBranches.filter((b) => {
      const parentOrg = orgMap.get(b.orgId);
      const evalB = evaluateBranchBillingAndGrace(b, parentOrg, now);

      if (branchFilter === 'active' && (evalB.isSuspended || evalB.isPurgedFromDb)) return false;
      if (branchFilter === 'exempt' && (!evalB.isFeeExempt || evalB.isPurgedFromDb)) return false;
      if (
        branchFilter === 'unpaid_overdue' &&
        (evalB.paymentStatus !== 'unpaid' && evalB.paymentStatus !== 'overdue')
      ) {
        return false;
      }
      if (branchFilter === 'suspended' && (!evalB.isSuspended || evalB.isPurgedFromDb)) return false;
      if (branchFilter === 'purge_ready' && (!evalB.isGraceExpired || evalB.isPurgedFromDb)) return false;
      if (branchFilter === 'purged' && !evalB.isPurgedFromDb) return false;

      if (!term) return true;
      return (
        b.name.toLowerCase().includes(term) ||
        b.code.toLowerCase().includes(term) ||
        b.id.toLowerCase().includes(term) ||
        (parentOrg?.name || '').toLowerCase().includes(term) ||
        (parentOrg?.ownerEmail || '').toLowerCase().includes(term)
      );
    });
  }, [allBranches, searchTerm, branchFilter, orgMap]);

  const filteredMembers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return allUsers.filter((u) => {
      const historyRecords = memberHistoryByUid.get(u.uid) || [];
      if (memberOrgFilter !== 'all') {
        const matchesCurrent = u.orgId === memberOrgFilter;
        const matchesHistory = historyRecords.some(
          (h) => h.orgId === memberOrgFilter || h.previousOrgId === memberOrgFilter
        );
        if (!matchesCurrent && !matchesHistory) {
          return false;
        }
      }
      if (memberRoleFilter !== 'all' && u.role !== memberRoleFilter) return false;
      const effectiveStatus = resolveMemberMembershipStatus(u);
      const isReleased = effectiveStatus === 'released';
      const isArchivedOrDisabled = !isReleased && (effectiveStatus === 'archived' || u.isActive === false);
      if (memberStatusFilter === 'active' && (isReleased || isArchivedOrDisabled)) return false;
      if (memberStatusFilter === 'archived' && !isArchivedOrDisabled) return false;
      if (memberStatusFilter === 'released' && !isReleased) return false;

      if (!term) return true;
      const orgName = (orgMap.get(u.orgId)?.name || '').toLowerCase();
      const historyOrgSearchHit = historyRecords.some((h) => {
        const histOrgName = (h.orgName || orgMap.get(h.orgId)?.name || '').toLowerCase();
        const histPrevOrgName = (
          h.previousOrgName ||
          (h.previousOrgId ? orgMap.get(h.previousOrgId)?.name || '' : '')
        ).toLowerCase();
        return (
          h.orgId.toLowerCase().includes(term) ||
          histOrgName.includes(term) ||
          (h.previousOrgId || '').toLowerCase().includes(term) ||
          histPrevOrgName.includes(term)
        );
      });
      const branchLabel = (
        u.branchName ||
        (u.branchId ? branchMap.get(u.branchId)?.name || '' : '')
      ).toLowerCase();
      return (
        (u.displayName || '').toLowerCase().includes(term) ||
        (u.email || '').toLowerCase().includes(term) ||
        u.uid.toLowerCase().includes(term) ||
        (u.orgId || '').toLowerCase().includes(term) ||
        orgName.includes(term) ||
        historyOrgSearchHit ||
        branchLabel.includes(term)
      );
    });
  }, [allUsers, memberHistoryByUid, memberOrgFilter, memberRoleFilter, memberStatusFilter, searchTerm, orgMap, branchMap]);

  const filteredInvites = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return allInvites;
    return allInvites.filter(
      (i) =>
        i.emailNormalized.includes(term) ||
        (i.orgName || '').toLowerCase().includes(term) ||
        (i.managerName || '').toLowerCase().includes(term) ||
        i.orgId.toLowerCase().includes(term)
    );
  }, [allInvites, searchTerm]);

  const filteredAuditLogs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return platformAuditLogs.filter((l) => {
      if (auditCategoryFilter !== 'all') {
        const isExemption =
          l.action.includes('EXEMPTION') || l.action.includes('LEGACY_UNRESTRICTED');
        const isMember = l.action.startsWith('MEMBER_') || l.targetType === 'member';
        const isInvite = l.action.startsWith('INVITE_') || l.targetType === 'invite';
        const isBranch = l.action.startsWith('BRANCH_') && !isExemption;
        const isOrg = !isExemption && !isMember && !isInvite && !isBranch;
        if (auditCategoryFilter === 'exemptions' && !isExemption) return false;
        if (auditCategoryFilter === 'members' && !isMember) return false;
        if (auditCategoryFilter === 'invites' && !isInvite) return false;
        if (auditCategoryFilter === 'branches' && !isBranch) return false;
        if (auditCategoryFilter === 'organizations' && !isOrg) return false;
      }
      if (!term) return true;
      const reasonStr =
        l.metadata && typeof l.metadata.reason === 'string' ? l.metadata.reason.toLowerCase() : '';
      const orgName = l.orgId ? (orgMap.get(l.orgId)?.name || '').toLowerCase() : '';
      return (
        l.action.toLowerCase().includes(term) ||
        getPlatformAuditActionLabel(l.action, language).toLowerCase().includes(term) ||
        l.details.toLowerCase().includes(term) ||
        l.targetId.toLowerCase().includes(term) ||
        l.actorEmail.toLowerCase().includes(term) ||
        reasonStr.includes(term) ||
        orgName.includes(term)
      );
    });
  }, [platformAuditLogs, searchTerm, auditCategoryFilter, orgMap, language]);

  const selectedOrg: Organization | null = useMemo(
    () => organizations.find((o) => o.id === selectedOrgId) || null,
    [organizations, selectedOrgId]
  );

  const selectedOrgBranches = useMemo(
    () => (selectedOrg ? branchesByOrg.get(selectedOrg.id) || [] : []),
    [selectedOrg, branchesByOrg]
  );

  const selectedOrgUsers = useMemo(
    () => (selectedOrg ? usersByOrg.get(selectedOrg.id) || [] : []),
    [selectedOrg, usersByOrg]
  );

  if (!isSuperAdmin) {
    return null;
  }

  const clearFeedback = () => {
    setActionSuccess(null);
    setActionError(null);
  };

  const formatShortDate = (value: unknown): string => {
    const d = toValidDate(value);
    if (!d) return '—';
    return d.toISOString().slice(0, 10);
  };

  const formatIsoDate = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(language === 'en' ? 'en-US' : language === 'ur' ? 'ur-PK' : 'ar-SA');
  };

  const renderHealthLabel = (status?: DriveHealthStatus) => {
    switch (status) {
      case 'verified':
        return {
          text: tr('متحقق', 'Verified', 'تصدیق شدہ'),
          className: 'text-[#048264] dark:text-[#08C99B]',
          icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
        };
      case 'failed':
        return {
          text: tr('فشل', 'Failed', 'ناکام'),
          className: 'text-rose-600 dark:text-rose-400',
          icon: <XCircle className="w-3.5 h-3.5 shrink-0" />,
        };
      case 'disconnected':
        return {
          text: tr('مفصول', 'Disconnected', 'منقطع'),
          className: 'text-slate-500 dark:text-slate-400',
          icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
        };
      default:
        return {
          text: tr('غير مرتبط', 'Not linked', 'منسلک نہیں'),
          className: 'text-amber-600 dark:text-amber-400',
          icon: <Clock className="w-3.5 h-3.5 shrink-0" />,
        };
    }
  };

  const openEditOrgModal = (org: Organization) => {
    clearFeedback();
    const subEval = evaluateOrganizationSubscription(org);
    const startStr = subEval.startDate ? subEval.startDate.toISOString().slice(0, 10) : todayIso;
    const endStr = subEval.endDate ? subEval.endDate.toISOString().slice(0, 10) : nextMonthIso;
    const paidDate = toValidDate(org.setupFeePaidAt);
    setEditingOrg(org);
    setEditOrgForm({
      name: org.name || '',
      taxNumber: org.taxNumber || '',
      commercialRegistration: org.commercialRegistration || '',
      activityType: org.activityType || 'retail',
      currency: org.currency || 'SAR',
      ownerName: org.ownerName || '',
      ownerEmail: org.ownerEmail || '',
      setupFeeStatus: org.setupFeeStatus || (subEval.isLegacy ? 'waived' : 'unpaid'),
      setupFeePaidDateIso: paidDate ? paidDate.toISOString().slice(0, 10) : todayIso,
      subscriptionPlan: org.subscriptionPlan || '1m',
      subscriptionStatus: org.subscriptionStatus || 'active',
      startDateIso: startStr,
      endDateIso: endStr,
      subscriptionNote: org.subscriptionNote || '',
      convertLegacyToPaid: false,
    });
  };

  const handleCreateOrgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setBusyAction(true);
    try {
      const res = await createSuperAdminOrganizationWithInvite(createOrgForm);
      setActionSuccess(
        `تم إنشاء المؤسسة (${res.orgId}) والفرع الأول (${res.branchId}) وإصدار دعوة المدير ${res.inviteEmail} بنجاح.`
      );
      setShowCreateOrgModal(false);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر إنشاء المؤسسة والدعوة.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleEditOrgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrg) return;
    clearFeedback();
    setBusyAction(true);
    try {
      await updateSuperAdminOrganizationProfileAndBilling({
        orgId: editingOrg.id,
        ...editOrgForm,
      });
      setActionSuccess(`تم تحديث بيانات وفوترة المؤسسة "${editOrgForm.name}" بنجاح.`);
      setEditingOrg(null);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر حفظ تحديثات المؤسسة.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleOrgStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalOrg) return;
    clearFeedback();
    setBusyAction(true);
    try {
      await updateSuperAdminOrgStatus({
        orgId: statusModalOrg.id,
        action: statusActionMode,
        reactivationFeeStatus,
        reactivationFeePaidDateIso: reactivationFeeDateIso,
        note: statusNote,
      });
      setActionSuccess(`تم تنفيذ الإجراء الإداري على المؤسسة "${statusModalOrg.name}" بنجاح.`);
      setStatusModalOrg(null);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر تحديث حالة المؤسسة.');
    } finally {
      setBusyAction(false);
    }
  };

  const runGuardedAction = async (task: () => Promise<void>, fallbackErr: string) => {
    if (inFlightUiRef.current) return;
    inFlightUiRef.current = true;
    clearFeedback();
    setBusyAction(true);
    try {
      await task();
    } catch (err: any) {
      setActionError(err?.message || fallbackErr);
    } finally {
      inFlightUiRef.current = false;
      setBusyAction(false);
    }
  };

  const canManageMember = (member: UserProfile): boolean => {
    if (!isAllowedSuperAdminMemberRole(member.role)) return false;
    if ((member.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL) return false;
    return true;
  };

  const openOrgExemptionModal = (org: Organization) => {
    clearFeedback();
    setExemptionModalOrg(org);
    setOrgExemptionMode(
      org.billingExemptMode === 'billing_exempt' ? 'billing_exempt' : 'legacy_unrestricted'
    );
    setExemptionConfirmed(false);
    setExemptionReason(
      org.billingExempt === true
        ? ''
        : 'إعفاء دائم شامل معتمد من المدير الرئيسي للمؤسسة وفروعها الحالية والمستقبلية'
    );
  };

  const openBranchExemptionModal = (branch: Branch) => {
    clearFeedback();
    setBranchExemptionModalTarget(branch);
    setBranchExemptionMode(
      branch.billingExemptMode === 'legacy_unrestricted' ? 'legacy_unrestricted' : 'billing_exempt'
    );
    setBranchExemptionRestoredStatus('unpaid');
    setBranchExemptionRestoredFeeSar(
      orgMap.get(branch.orgId)?.extraBranchMonthlyFeeSar ?? BRANCH_MONTHLY_FEE_SAR
    );
    setBranchExemptionConfirmed(false);
    setBranchExemptionReason(
      branch.billingExempt === true
        ? ''
        : 'إعفاء دائم للفرع معتمد من المدير الرئيسي مع حفظ سجلات الدفع التاريخية'
    );
  };

  const openBulkBranchesExemptionModal = (org: Organization) => {
    clearFeedback();
    setBulkBranchExemptionOrg(org);
    setBulkBranchExemptionMode(
      org.billingExemptMode === 'legacy_unrestricted' ? 'legacy_unrestricted' : 'billing_exempt'
    );
    setBulkBranchExemptionReason('إعفاء جماعي دائم لجميع فروع المؤسسة معتمد من المدير الرئيسي');
    setBulkBranchExemptionConfirmed(false);
  };

  const openCreateMemberModal = (defaultOrgId?: string) => {
    clearFeedback();
    const resolvedOrgId = defaultOrgId || organizations[0]?.id || '';
    const firstOrgBranch = (branchesByOrg.get(resolvedOrgId) || []).find(
      (b) => b.lifecycleStatus !== 'purged_from_db'
    );
    setCreateMemberForm({
      orgId: resolvedOrgId,
      displayName: '',
      email: '',
      password: '',
      confirmPassword: '',
      phone: '',
      role: 'employee',
      branchId: firstOrgBranch?.id || '',
      supervisorPermissions: {},
    });
    setShowCreateMemberPassword(false);
    setShowCreateMemberConfirmPassword(false);
    setShowCreateMemberModal(true);
  };

  const openEditMemberModal = (member: UserProfile) => {
    if (!canManageMember(member)) return;
    clearFeedback();
    const orgActiveBranches = (branchesByOrg.get(member.orgId) || []).filter(
      (b) => b.lifecycleStatus !== 'purged_from_db'
    );
    const currentRole = member.role as SuperAdminAssignableMemberRole;
    const supervisorPerms: Partial<Record<SupervisorOptionalPermissionKey, boolean>> = {};
    for (const key of SUPERVISOR_OPTIONAL_PERMISSION_KEYS) {
      supervisorPerms[key] = Boolean(member.permissions?.[key]);
    }
    setEditingMember(member);
    setEditMemberForm({
      displayName: member.displayName || '',
      phone: member.phone || '',
      role: currentRole,
      branchId: member.branchId || orgActiveBranches[0]?.id || '',
      supervisorPermissions: supervisorPerms,
      reason: '',
    });
  };

  const openMemberLifecycleModal = (member: UserProfile, mode: 'archive' | 'reactivate') => {
    if (!canManageMember(member)) return;
    clearFeedback();
    setMemberLifecycleModal({ member, mode });
    setMemberLifecycleReason(
      mode === 'reactivate' ? 'إعادة تفعيل العضوية من لوحة المدير الرئيسي' : ''
    );
    setMemberLifecycleConfirmed(false);
  };

  const handleBillingExemptionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exemptionModalOrg || !exemptionConfirmed) return;
    await runGuardedAction(async () => {
      const currentlyExempt = exemptionModalOrg.billingExempt === true;
      if (currentlyExempt) {
        const res = await revokeSuperAdminOrgBillingExemption({
          orgId: exemptionModalOrg.id,
          reason: exemptionReason,
        });
        setActionSuccess(
          `تم إلغاء الإعفاء الدائم للمؤسسة "${exemptionModalOrg.name}" وإعادتها لنظام الاشتراكات القياسي دون حذف أي بيانات تاريخية (سجل التدقيق: ${res.auditLogId}).`
        );
      } else {
        const res = await grantSuperAdminOrgBillingExemption({
          orgId: exemptionModalOrg.id,
          expectedOwnerEmail: exemptionModalOrg.ownerEmail,
          mode: orgExemptionMode,
          reason: exemptionReason,
        });
        setActionSuccess(
          `تم اعتماد الإعفاء الدائم (${orgExemptionMode}) للمؤسسة "${exemptionModalOrg.name}" للمالك الموثق ${res.ownerEmail} (${res.ownerId}) — سجل التدقيق: ${res.auditLogId}.`
        );
      }
      setExemptionModalOrg(null);
      setExemptionReason('');
      setExemptionConfirmed(false);
    }, 'تعذر تحديث حالة الإعفاء الدائم للمؤسسة.');
  };

  const handleBranchExemptionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchExemptionModalTarget || !branchExemptionConfirmed) return;
    await runGuardedAction(async () => {
      const isIndividuallyExempt =
        branchExemptionModalTarget.billingExempt === true ||
        branchExemptionModalTarget.paymentStatus === 'exempt';
      if (isIndividuallyExempt) {
        const res = await revokeSuperAdminBranchExemption({
          branchId: branchExemptionModalTarget.id,
          restoredPaymentStatus: branchExemptionRestoredStatus,
          restoredMonthlyFeeSar: branchExemptionRestoredFeeSar,
          reason: branchExemptionReason,
        });
        setActionSuccess(
          res.parentOrgRemainsExempt
            ? `تم إلغاء الإعفاء الفردي للفرع "${branchExemptionModalTarget.name}" (مع بقاء إعفاء المؤسسة الأم الموروث سارياً) — سجل التدقيق: ${res.auditLogId}.`
            : `تم إلغاء الإعفاء الفردي للفرع "${branchExemptionModalTarget.name}" وإعادته لنظام الرسوم القياسي مع حفظ كامل سجلات الدفع التاريخية — سجل التدقيق: ${res.auditLogId}.`
        );
      } else {
        const res = await grantSuperAdminBranchExemption({
          branchId: branchExemptionModalTarget.id,
          mode: branchExemptionMode,
          reason: branchExemptionReason,
        });
        setActionSuccess(
          `تم منح الإعفاء الدائم (${branchExemptionMode}) للفرع "${branchExemptionModalTarget.name}" (0 ر.س مع حفظ سجلات الدفع التاريخية) — سجل التدقيق: ${res.auditLogId}.`
        );
      }
      setBranchExemptionModalTarget(null);
      setBranchExemptionReason('');
      setBranchExemptionConfirmed(false);
    }, 'تعذر تحديث حالة إعفاء الفرع.');
  };

  const handleBulkBranchesExemptionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkBranchExemptionOrg || !bulkBranchExemptionConfirmed) return;
    await runGuardedAction(async () => {
      const res = await grantSuperAdminBulkOrgBranchesExemption({
        orgId: bulkBranchExemptionOrg.id,
        mode: bulkBranchExemptionMode,
        reason: bulkBranchExemptionReason,
      });
      setActionSuccess(
        `تم إعفاء ${res.exemptedCount} فرعاً في مؤسسة "${bulkBranchExemptionOrg.name}" بشكل دائم (${bulkBranchExemptionMode}) — سجلات التدقيق: ${res.auditLogIds.join(', ')}.`
      );
      setBulkBranchExemptionOrg(null);
      setBulkBranchExemptionReason('');
      setBulkBranchExemptionConfirmed(false);
    }, 'تعذر تنفيذ الإعفاء الجماعي لفروع المؤسسة.');
  };

  const handleCreateMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const passCheck = validatePasswordConfirmation(
      createMemberForm.password,
      createMemberForm.confirmPassword,
      6
    );
    if (!passCheck.valid) {
      setActionError(
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
    await runGuardedAction(async () => {
      const res = await createSuperAdminOrgMember({
        orgId: createMemberForm.orgId,
        email: normalizeLoginEmail(createMemberForm.email),
        password: createMemberForm.password,
        displayName: createMemberForm.displayName,
        role: createMemberForm.role,
        branchId:
          createMemberForm.role === 'supervisor' ? undefined : createMemberForm.branchId || undefined,
        phone: createMemberForm.phone,
        supervisorPermissions:
          createMemberForm.role === 'supervisor' ? createMemberForm.supervisorPermissions : undefined,
      });
      setActionSuccess(
        `تم إنشاء العضو "${res.member.displayName}" (${getUserRoleLabel(res.member.role, language)}) بنجاح — سجل التدقيق: ${res.auditLogId}.`
      );
      setShowCreateMemberModal(false);
    }, 'تعذر إنشاء العضو الجديد.');
  };

  const handleEditMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    await runGuardedAction(async () => {
      const res = await updateSuperAdminOrgMember({
        memberUid: editingMember.uid,
        displayName: editMemberForm.displayName,
        phone: editMemberForm.phone,
        role: editMemberForm.role,
        branchId:
          editMemberForm.role === 'supervisor' ? undefined : editMemberForm.branchId || undefined,
        supervisorPermissions:
          editMemberForm.role === 'supervisor' ? editMemberForm.supervisorPermissions : undefined,
        reason: editMemberForm.reason,
      });
      setActionSuccess(
        `تم تحديث بيانات العضو "${editMemberForm.displayName}" (${res.action}) — سجل التدقيق: ${res.auditLogId}.`
      );
      setEditingMember(null);
    }, 'تعذر تحديث بيانات العضو.');
  };

  const handleMemberLifecycleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberLifecycleModal || !memberLifecycleConfirmed) return;
    await runGuardedAction(async () => {
      const { member, mode } = memberLifecycleModal;
      if (mode === 'archive') {
        const res = await archiveSuperAdminOrgMember({
          memberUid: member.uid,
          reason: memberLifecycleReason,
        });
        setActionSuccess(
          `تم تعطيل وأرشفة العضو "${member.displayName}" دون حذف أي سجلات تاريخية — سجل التدقيق: ${res.auditLogId}.`
        );
      } else {
        const res = await reactivateSuperAdminOrgMember({
          memberUid: member.uid,
          reason: memberLifecycleReason,
        });
        setActionSuccess(
          `تمت إعادة تفعيل العضو "${member.displayName}" بنجاح — سجل التدقيق: ${res.auditLogId}.`
        );
      }
      setMemberLifecycleModal(null);
      setMemberLifecycleReason('');
      setMemberLifecycleConfirmed(false);
    }, 'تعذر تحديث حالة العضو.');
  };

  const openReleaseMemberModal = (member: UserProfile) => {
    const parentOrg = member.orgId ? orgMap.get(member.orgId) : undefined;
    if (!isMemberEligibleForRelease(member, parentOrg)) return;
    clearFeedback();
    setReleaseMemberTarget(member);
    setReleaseMemberReason('');
    setReleaseMemberConfirmed(false);
  };

  const handleReleaseMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!releaseMemberTarget || !releaseMemberConfirmed) return;
    await runGuardedAction(async () => {
      const res = await releaseSuperAdminOrgMember({
        memberUid: releaseMemberTarget.uid,
        reason: releaseMemberReason,
      });
      setActionSuccess(
        `تم فصل عضوية "${releaseMemberTarget.displayName}" نهائياً عن مؤسسته السابقة مع الاحتفاظ بحساب المصادقة وكافة السجلات التاريخية — سجل العضوية: ${res.historyId} · سجل التدقيق: ${res.auditLogId}.`
      );
      setReleaseMemberTarget(null);
      setReleaseMemberReason('');
      setReleaseMemberConfirmed(false);
    }, 'تعذر فصل عضوية الموظف نهائياً.');
  };

  const openAssignMemberModal = (member: UserProfile) => {
    if (!isMemberReleased(member)) return;
    clearFeedback();
    const activeOrgs = organizations.filter((o) => o.isActive !== false);
    const lastReleaseOrgId = latestReleaseHistoryByUid.get(member.uid)?.orgId;
    const defaultOrg =
      activeOrgs.find((o) => o.id !== lastReleaseOrgId) || activeOrgs[0];
    const defaultOrgId = defaultOrg?.id || '';
    const firstBranch = (branchesByOrg.get(defaultOrgId) || []).find(
      (b) => b.lifecycleStatus !== 'purged_from_db'
    );
    setAssignMemberTarget(member);
    setAssignMemberForm({
      targetOrgId: defaultOrgId,
      role: 'employee',
      branchId: firstBranch?.id || '',
      supervisorPermissions: {},
      reason: '',
      sendOptionalPasswordReset: false,
    });
    setAssignMemberConfirmed(false);
  };

  const handleAssignMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignMemberTarget || !assignMemberConfirmed) return;
    await runGuardedAction(async () => {
      const targetOrgName =
        orgMap.get(assignMemberForm.targetOrgId)?.name || assignMemberForm.targetOrgId;
      const res = await assignReleasedMemberToOrganization({
        memberUid: assignMemberTarget.uid,
        targetOrgId: assignMemberForm.targetOrgId,
        role: assignMemberForm.role,
        branchId:
          assignMemberForm.role === 'supervisor'
            ? undefined
            : assignMemberForm.branchId || undefined,
        supervisorPermissions:
          assignMemberForm.role === 'supervisor'
            ? assignMemberForm.supervisorPermissions
            : undefined,
        reason: assignMemberForm.reason || undefined,
        sendOptionalPasswordReset: assignMemberForm.sendOptionalPasswordReset,
      });
      setActionSuccess(
        `تمت إعادة ربط العضو "${assignMemberTarget.displayName}" بمؤسسة "${targetOrgName}" بنفس حسابه السابق وصلاحيات جديدة مستقلة${
          res.passwordResetSent ? ' (تم إرسال رابط إعادة تعيين كلمة المرور اختيارياً)' : ''
        } — سجل العضوية: ${res.historyId} · سجل التدقيق: ${res.auditLogId}.`
      );
      setAssignMemberTarget(null);
      setAssignMemberConfirmed(false);
    }, 'تعذر إعادة ربط العضو بالمؤسسة المختارة.');
  };

  const handleSendSuperAdminPasswordReset = async (member: UserProfile) => {
    await runGuardedAction(async () => {
      const res = await sendSuperAdminMemberPasswordReset(member.uid);
      setActionSuccess(`تم إرسال رابط إعادة تعيين كلمة المرور بنجاح إلى البريد ${res.email}.`);
    }, 'تعذر إرسال رابط إعادة تعيين كلمة المرور.');
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setBusyAction(true);
    try {
      await upsertSuperAdminManagerInvite(inviteForm);
      setActionSuccess(`تم إصدار / تحديث دعوة المدير ${inviteForm.email} بنجاح.`);
      setShowInviteModal(false);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر حفظ دعوة المدير.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCancelInvite = async (email: string) => {
    clearFeedback();
    setBusyAction(true);
    try {
      await cancelSuperAdminManagerInvite(email);
      setActionSuccess(`تم إلغاء الدعوة ${email}.`);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر إلغاء الدعوة.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setBusyAction(true);
    try {
      const created = await createSuperAdminBranch(createBranchForm);
      setActionSuccess(`تم إضافة الفرع "${created.name}" (${created.code}) بنجاح.`);
      setShowCreateBranchModal(false);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر إضافة الفرع.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleRecordBranchPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalBranch) return;
    clearFeedback();
    setBusyAction(true);
    try {
      await recordSuperAdminBranchPayment({
        branchId: paymentModalBranch.id,
        ...branchPaymentForm,
      });
      setActionSuccess(`تم تسجيل حالة دفع الفرع "${paymentModalBranch.name}" بنجاح.`);
      setPaymentModalBranch(null);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر تحديث سداد الفرع.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSuspendBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendBranchTarget) return;
    clearFeedback();
    setBusyAction(true);
    try {
      await suspendSuperAdminBranch({
        branchId: suspendBranchTarget.id,
        reason: suspendBranchReason,
      });
      setActionSuccess(
        `تم تعليق فرع "${suspendBranchTarget.name}" وبدء مهلة 30 يوماً قبل إتاحة حذف سجلاته من قاعدة البيانات.`
      );
      setSuspendBranchTarget(null);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر تعليق الفرع.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleReactivateBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reactivateBranchTarget) return;
    clearFeedback();
    setBusyAction(true);
    try {
      await reactivateSuperAdminBranch({
        branchId: reactivateBranchTarget.id,
        ...reactivateBranchForm,
      });
      setActionSuccess(`تمت إعادة تنشيط الفرع "${reactivateBranchTarget.name}" بنجاح.`);
      setReactivateBranchTarget(null);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر إعادة تنشيط الفرع.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleInspectBranchBackup = async (branch: Branch) => {
    clearFeedback();
    setPurgeModalBranch(branch);
    setPurgeInspection(null);
    setPurgeConfirmText('');
    setBusyAction(true);
    try {
      const inspection = await inspectBranchDriveBackupForPurge(branch.id);
      setPurgeInspection(inspection);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر فحص أرشفة Google Drive للفرع.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleExecuteBranchDbPurge = async () => {
    if (!purgeModalBranch || !purgeInspection?.verified) return;
    clearFeedback();
    setBusyAction(true);
    try {
      const result = await purgeSuspendedBranchFromDb(purgeModalBranch.id);
      setActionSuccess(
        `تم حذف سجلات فرع "${purgeModalBranch.name}" من قاعدة بيانات الموقع فقط (إقفالات: ${result.deletedClosings}، مشتريات: ${result.deletedPurchases}، مرفقات: ${result.deletedAttachments}، أرشيف: ${result.deletedClosingArchives}) مع بقاء ملفات Google Drive وسجلات التدقيق كاملة.`
      );
      setPurgeModalBranch(null);
      setPurgeInspection(null);
    } catch (err: any) {
      setActionError(err?.message || 'تعذر تنفيذ حذف سجلات الفرع من قاعدة البيانات.');
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col bg-[#F5F8FF] dark:bg-[#0B1B32] text-[#0B1B32] dark:text-slate-100"
      dir={direction}
    >
      {/* Top Bar */}
      <header className="bg-white/95 dark:bg-[#0B1B32]/95 backdrop-blur-md border-b border-[#DCE6FA] dark:border-[#1F3B66] sticky top-0 z-40">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 h-16 sm:h-20">
            <div className="flex items-center gap-3 min-w-0">
              <BrandLogo size="sm" className="shrink-0" />
              <div className="h-7 w-px bg-[#DCE6FA] dark:bg-[#1F3B66] hidden sm:block shrink-0" />
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-bold text-[#0B1B32] dark:text-white truncate flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF] shrink-0 hidden sm:inline" />
                  <span className="truncate">
                    {tr(
                      'لوحة إدارة صاحب الموقع — الإقفال | AL EQFAL',
                      'Platform Owner Console — AL EQFAL',
                      'پلیٹ فارم مالک کنسول — الإقفال | AL EQFAL'
                    )}
                  </span>
                </h1>
                <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
                  <span>{tr('الاشتراكات والفوترة اليدوية', 'Subscriptions & Manual Billing', 'سبسکرپشنز اور دستی بلنگ')}</span>
                  <span aria-hidden="true">·</span>
                  <span>{tr('إدارة الفروع والدعوات والاعتمادات', 'Branches, Invites & Governance', 'برانچز، دعوت نامے اور نظم و نسق')}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {onSwitchToTenantDashboard && (
                <button
                  type="button"
                  onClick={onSwitchToTenantDashboard}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-[#1764FF] dark:text-[#6CA2FF] bg-[#1764FF]/10 hover:bg-[#1764FF]/15 border border-[#1764FF]/30 transition-colors whitespace-nowrap shrink-0"
                >
                  <Building2 className="w-4 h-4" />
                  <span className="hidden md:inline">{tr('لوحة مؤسستي', 'My Organization', 'میرا ادارہ')}</span>
                </button>
              )}

              {!onSwitchToTenantDashboard && onSwitchToOnboarding && (
                <button
                  type="button"
                  onClick={onSwitchToOnboarding}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#0B1B32] dark:text-slate-200 bg-[#F5F8FF] dark:bg-[#122543] hover:bg-[#E6EEFC] dark:hover:bg-[#173056] border border-[#DCE6FA] dark:border-[#1F3B66] transition-colors whitespace-nowrap shrink-0"
                >
                  <Building2 className="w-4 h-4" />
                  <span className="hidden md:inline">{tr('لوحة مؤسستي', 'My Organization', 'میرا ادارہ')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => loadSuperAdminOverview()}
                disabled={superAdminLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#122543] text-[#0B1B32] dark:text-slate-200 hover:border-[#1764FF] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF] ${superAdminLoading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{tr('تحديث', 'Refresh', 'تازہ کریں')}</span>
              </button>

              <NotificationCenter
                surface="super_admin"
                onNavigate={(target: NotificationNavTarget) => {
                  if (
                    target.tab === 'organizations' ||
                    target.tab === 'branches' ||
                    target.tab === 'members' ||
                    target.tab === 'invites' ||
                    target.tab === 'auditLogs'
                  ) {
                    setMainTab(target.tab);
                  }
                  if (
                    target.tab === 'organizations' &&
                    target.entityId &&
                    organizations.some((o) => o.id === target.entityId)
                  ) {
                    setMainTab('organizations');
                    setSelectedOrgId(target.entityId);
                  }
                }}
              />

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
                className="p-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300 hover:text-[#1764FF] dark:hover:text-[#6CA2FF] bg-[#F5F8FF] dark:bg-[#122543] transition-colors shrink-0"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 text-[#6CA2FF]" /> : <Moon className="w-4 h-4" />}
              </button>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setLangMenuOpen(!langMenuOpen)}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-bold text-[#0B1B32] dark:text-slate-200 bg-[#F5F8FF] dark:bg-[#122543] hover:border-[#1764FF] transition-colors whitespace-nowrap shrink-0"
                >
                  <Globe className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span className="uppercase">{language}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>
                {langMenuOpen && (
                  <div className="absolute end-0 mt-1 w-32 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] shadow-xl py-1 z-50 text-xs font-semibold">
                    {(['ar', 'en', 'ur'] as const).map((langCode) => (
                      <button
                        key={langCode}
                        type="button"
                        onClick={() => {
                          setLanguage(langCode);
                          setLangMenuOpen(false);
                        }}
                        className="w-full px-3 py-2 text-start hover:bg-[#F5F8FF] dark:hover:bg-[#173056]"
                      >
                        {langCode === 'ar' ? 'العربية' : langCode === 'en' ? 'English' : 'اردو'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="hidden lg:flex flex-col text-end ps-2 border-s border-[#DCE6FA] dark:border-[#1F3B66]">
                <span className="text-xs font-bold text-[#0B1B32] dark:text-white">
                  {tr('صاحب الموقع', 'Platform Owner', 'پلیٹ فارم مالک')}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono" dir="ltr">
                  {currentUser?.email}
                </span>
              </div>

              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">{t('navLogout')}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1 w-full space-y-6">
        {/* Feedback Banners */}
        {superAdminError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{superAdminError}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                loadSuperAdminOverview().catch(() => {
                  // Error handled in AuthContext
                });
              }}
              disabled={superAdminLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold bg-rose-600 hover:bg-rose-500 text-white transition-colors shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${superAdminLoading ? 'animate-spin' : ''}`} />
              <span>
                {superAdminLoading
                  ? tr('جاري التحميل...', 'Loading...', 'لوڈ ہو رہا ہے...')
                  : tr('إعادة المحاولة', 'Retry', 'دوبارہ کوشش کریں')}
              </span>
            </button>
          </div>
        )}
        {actionError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button type="button" onClick={() => setActionError(null)} className="p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {actionSuccess && (
          <div className="rounded-xl border border-[#08C99B]/30 bg-[#08C99B]/10 p-4 text-xs text-[#048264] dark:text-[#08C99B] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
            <button type="button" onClick={() => setActionSuccess(null)} className="p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* KPI Cards Strip */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>{tr('المؤسسات المسجلة', 'Registered Organizations', 'رجسٹرڈ ادارے')}</span>
              <Building2 className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#0B1B32] dark:text-white">
              {stats.totalOrgs}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {tr('نشطة:', 'Active:', 'فعال:')}{' '}
              <span className="font-mono tabular-nums text-[#048264] dark:text-[#08C99B] font-semibold">{stats.activeOrgsCount}</span> ·{' '}
              {tr('قديمة معفاة:', 'Legacy exempt:', 'سابقہ مستثنیٰ:')}{' '}
              <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 font-semibold">{stats.legacyOrgsCount}</span> ·{' '}
              {tr('موقوفة:', 'Suspended:', 'معطل:')}{' '}
              <span className="font-mono tabular-nums text-rose-500 font-semibold">{stats.suspendedOrgsCount}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>
                {tr(
                  `إدارة الفروع (${BRANCH_MONTHLY_FEE_SAR} ر.س/ش)`,
                  `Branches (${BRANCH_MONTHLY_FEE_SAR} SAR/mo)`,
                  `برانچز (${BRANCH_MONTHLY_FEE_SAR} ریال/ماہ)`
                )}
              </span>
              <GitBranch className="w-4 h-4 text-[#048264] dark:text-[#08C99B]" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#0B1B32] dark:text-white">
              {stats.totalBranches}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {tr('فعالة:', 'Active:', 'فعال:')}{' '}
              <span className="font-mono tabular-nums text-[#048264] dark:text-[#08C99B] font-semibold">{stats.activeBranchesCount}</span> ·{' '}
              {tr('معلقة:', 'Suspended:', 'معطل:')}{' '}
              <span className="font-mono tabular-nums text-rose-500 font-semibold">{stats.suspendedBranchesCount}</span> ·{' '}
              {tr('منظفة:', 'Purged:', 'صاف شدہ:')}{' '}
              <span className="font-mono tabular-nums">{stats.purgedBranchesCount}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>{tr('التسعير اليدوي المعتمد', 'Estimated Monthly Billing', 'متوقع ماہانہ بلنگ')}</span>
              <CreditCard className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#0B1B32] dark:text-white">
              {stats.expectedMonthlyBranchesSar.toLocaleString('en-US')} SAR
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {tr('تأسيس:', 'Setup:', 'سیٹ اپ:')}{' '}
              <span className="font-mono tabular-nums">{ACCOUNT_SETUP_FEE_SAR}</span> {tr('ر.س', 'SAR', 'ریال')} ·{' '}
              {tr('فرع:', 'Branch:', 'برانچ:')}{' '}
              <span className="font-mono tabular-nums">{BRANCH_MONTHLY_FEE_SAR}</span> {tr('ر.س', 'SAR', 'ریال')} ·{' '}
              {tr('إعادة تنشيط:', 'Reactivate:', 'بحالی:')}{' '}
              <span className="font-mono tabular-nums">{ORG_REACTIVATION_FEE_SAR}</span> {tr('ر.س', 'SAR', 'ریال')}
            </div>
          </div>

          <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>{tr('المهل والدعوات المعلقة', 'Grace Periods & Pending Invites', 'مہلت اور زیر التواء دعوتیں')}</span>
              <ShieldAlert className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#0B1B32] dark:text-white">
              {stats.grace7dOrgsCount + stats.purgeReadyBranchesCount}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {tr('مهلة 7 أيام:', '7d Grace:', '7 دن مہلت:')}{' '}
              <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 font-semibold">{stats.grace7dOrgsCount}</span> ·{' '}
              {tr('جاهز للتنظيف (+30ي):', 'Purge Ready (+30d):', 'صفائی کے لیے تیار (+30د):')}{' '}
              <span className="font-mono tabular-nums text-rose-500 font-semibold">{stats.purgeReadyBranchesCount}</span> ·{' '}
              {tr('دعوات:', 'Invites:', 'دعوتیں:')}{' '}
              <span className="font-mono tabular-nums">{stats.pendingInvitesCount}</span>
            </div>
          </div>
        </section>

        {/* Primary Tabs & Action Bar */}
        <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                {
                  id: 'organizations',
                  label: `${tr('المؤسسات والاشتراكات', 'Organizations & Plans', 'ادارے اور سبسکرپشنز')} (${organizations.length})`,
                  icon: Building2,
                },
                {
                  id: 'branches',
                  label: `${tr('الفروع والفوترة', 'Branches & Billing', 'برانچز اور بلنگ')} (${allBranches.length})`,
                  icon: GitBranch,
                },
                {
                  id: 'members',
                  label: `${tr('إدارة عضويات الموظفين', 'Member Governance', 'اراکین کی رکنیت')} (${allUsers.length})`,
                  icon: Users,
                },
                {
                  id: 'invites',
                  label: `${tr('دعوات المدراء', 'Manager Invites', 'مینیجر دعوت نامے')} (${allInvites.length})`,
                  icon: Mail,
                },
                {
                  id: 'auditLogs',
                  label: `${tr('سجل المنصة', 'Platform Audit Log', 'پلیٹ فارم آڈٹ لاگ')} (${platformAuditLogs.length})`,
                  icon: FileText,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = mainTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMainTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                    active
                      ? 'bg-[#1764FF] text-white shadow-sm'
                      : 'bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-700 dark:text-slate-200 hover:bg-[#E6EEFC] dark:hover:bg-[#173056] border border-[#DCE6FA] dark:border-[#1F3B66]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={tr(
                  'بحث بالاسم، المعرف، البريد، الرقم الضريبي...',
                  'Search by name, ID, email, VAT...',
                  'نام، آئی ڈی، ای میل یا ٹیکس نمبر سے تلاش کریں...'
                )}
                className="w-full ps-9 pe-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] text-xs outline-none focus:border-[#1764FF]"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                clearFeedback();
                setShowCreateOrgModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#1764FF] hover:bg-[#1052D8] text-white transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>{tr('إنشاء مؤسسة ودعوة مدير', 'New Org & Manager Invite', 'نیا ادارہ اور مینیجر دعوت')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                clearFeedback();
                setCreateBranchForm((prev) => ({
                  ...prev,
                  orgId: prev.orgId || organizations[0]?.id || '',
                }));
                setShowCreateBranchModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-[#08C99B]/40 bg-[#08C99B]/10 text-[#048264] dark:text-[#08C99B] hover:bg-[#08C99B]/20 transition-colors"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>{tr('إضافة فرع', 'Add Branch', 'برانچ شامل کریں')}</span>
            </button>

            <button
              type="button"
              onClick={() => openCreateMemberModal()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-[#1764FF]/35 bg-[#1764FF]/10 text-[#1764FF] dark:text-[#6CA2FF] hover:bg-[#1764FF]/20 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{tr('إضافة عضو', 'Add Member', 'رکن شامل کریں')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                clearFeedback();
                setInviteForm({
                  email: '',
                  orgId: organizations[0]?.id || '',
                  managerName: '',
                });
                setShowInviteModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#173056] transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{tr('إصدار دعوة', 'Issue Invite', 'دعوت نامہ جاری کریں')}</span>
            </button>
          </div>
        </section>

        {/* TAB 1: Organizations & Subscriptions */}
        {mainTab === 'organizations' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'all', label: `${tr('الكل', 'All', 'سب')} (${organizations.length})` },
                  { id: 'active', label: `${tr('نشطة', 'Active', 'فعال')} (${stats.activeOrgsCount})` },
                  { id: 'exempt', label: `${tr('إعفاء دائم شامل', 'Permanent Exempt', 'مستقل استثنیٰ')} (${stats.exemptOrgsCount})` },
                  { id: 'legacy', label: `${tr('قديمة معفاة', 'Legacy Exempt', 'سابقہ مستثنیٰ')} (${stats.legacyOrgsCount})` },
                  { id: 'grace_7d', label: `${tr('مهلة 7 أيام', '7d Grace', '7 دن مہلت')} (${stats.grace7dOrgsCount})` },
                  { id: 'suspended', label: `${tr('موقوفة/منتهية', 'Suspended/Expired', 'معطل/ختم شدہ')} (${stats.suspendedOrgsCount})` },
                  { id: 'attention', label: tr('Drive يحتاج انتباه', 'Drive Attention', 'Drive توجہ درکار') },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setOrgFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    orgFilter === f.id
                      ? 'bg-[#1764FF] text-white border-transparent'
                      : 'bg-white dark:bg-[#122543] text-slate-600 dark:text-slate-300 border-[#DCE6FA] dark:border-[#1F3B66]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden shadow-sm">
              {filteredOrganizations.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'لا توجد مؤسسات مطابقة للبحث أو التصفية.',
                    'No organizations match the current search or filter.',
                    'موجودہ تلاش یا فلٹر کے مطابق کوئی ادارہ نہیں ملا۔'
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start border-collapse">
                    <thead>
                      <tr className="border-b border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        <th className="py-3.5 px-4 text-start">{tr('المؤسسة والملف الضريبي', 'Organization & Tax Profile', 'ادارہ اور ٹیکس پروفائل')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('المدير وبريد Google', 'Manager & Google Email', 'مینیجر اور Google ای میل')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('الاشتراك والحالة', 'Subscription & Status', 'سبسکرپشن اور حیثیت')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('الرسوم والتسعير اليدوي', 'Fees & Manual Pricing', 'فیس اور دستی قیمتیں')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('الفروع / Drive', 'Branches / Drive', 'برانچز / Drive')}</th>
                        <th className="py-3.5 px-4 text-end">{tr('إجراءات الإدارة', 'Admin Actions', 'انتظامی اقدامات')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66] text-xs">
                      {filteredOrganizations.map((org) => {
                        const orgBranches = branchesByOrg.get(org.id) || [];
                        const orgUsers = usersByOrg.get(org.id) || [];
                        const subEval = evaluateOrganizationSubscription(org);
                        const pricing = evaluateOrganizationBranchPricing({ org, branches: orgBranches });
                        const graceEval = evaluateOrgNoPaidBranchGrace(org, orgBranches);
                        const health = renderHealthLabel(org.driveLastHealthStatus);

                        return (
                          <tr
                            key={org.id}
                            className="hover:bg-[#F5F8FF]/70 dark:hover:bg-[#173056]/40 transition-colors"
                          >
                            <td className="py-3.5 px-4 align-top">
                              <div className="font-bold text-[#0B1B32] dark:text-white">{org.name}</div>
                              <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                                {org.id}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {tr('الضريبي:', 'VAT:', 'ٹیکس:')} <span className="font-mono tabular-nums">{org.taxNumber || '—'}</span> ·{' '}
                                {tr('السجل:', 'CR:', 'سی آر:')} <span className="font-mono tabular-nums">{org.commercialRegistration || '—'}</span>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <div className="font-semibold text-[#0B1B32] dark:text-slate-200">{org.ownerName}</div>
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                                {org.ownerEmail}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {org.ownerId
                                  ? tr('حساب مربوط', 'Linked account', 'منسلک اکاؤنٹ')
                                  : tr('بانتظار قبول الدعوة', 'Awaiting invite acceptance', 'دعوت قبول ہونے کا انتظار')}{' '}
                                · {tr('مستخدمون:', 'Users:', 'صارفین:')}{' '}
                                <span className="font-mono tabular-nums">{orgUsers.length}</span>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              {subEval.isBillingExempt ? (
                                <div className="space-y-1">
                                  <span className="inline-block px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">
                                    {org.billingExemptMode === 'legacy_unrestricted'
                                      ? subEval.isAllowed
                                        ? tr('إعفاء دائم (legacy_unrestricted)', 'Permanent Exempt (legacy_unrestricted)', 'مستقل استثنیٰ (legacy_unrestricted)')
                                        : tr('إعفاء legacy (موقوفة إدارياً)', 'Legacy Exempt (Admin Suspended)', 'مستقل استثنیٰ (انتظامی معطل)')
                                      : subEval.isAllowed
                                      ? tr('إعفاء دائم شامل (billing_exempt)', 'Permanent Full Exemption (billing_exempt)', 'مستقل مکمل استثنیٰ (billing_exempt)')
                                      : tr('إعفاء دائم (موقوفة إدارياً)', 'Permanent Exempt (Admin Suspended)', 'مستقل استثنیٰ (انتظامی معطل)')}
                                  </span>
                                  {org.billingExemptGrantedAt && (
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                      {formatShortDate(org.billingExemptGrantedAt)} · {org.billingExemptGrantedBy || SUPER_ADMIN_EMAIL}
                                    </div>
                                  )}
                                  {(subEval.startDate || subEval.endDate) && (
                                    <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                      {tr('تاريخي:', 'History:', 'تاریخی:')} {formatShortDate(subEval.startDate)} → {formatShortDate(subEval.endDate)}
                                    </div>
                                  )}
                                </div>
                              ) : subEval.isLegacy ? (
                                <span className="inline-block px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-bold">
                                  {subEval.isAllowed
                                    ? tr('قديمة معفاة تلقائياً (legacy_unrestricted)', 'Implicit Legacy Exempt (legacy_unrestricted)', 'سابقہ مستثنیٰ (legacy_unrestricted)')
                                    : tr('قديمة (موقوفة)', 'Legacy (Suspended)', 'سابقہ (معطل)')}
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                                      subEval.isAllowed
                                        ? 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B]'
                                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                    }`}
                                  >
                                    {subEval.isAllowed
                                      ? `${tr('نشط', 'Active', 'فعال')} (${getSubscriptionPlanLabel(org.subscriptionPlan || '1m', language)})`
                                      : org.deactivationReason === 'no_paid_branches'
                                      ? tr('متوقفة — بلا فروع مدفوعة', 'Deactivated — No Paid Branches', 'غیر فعال — کوئی ادا شدہ برانچ نہیں')
                                      : subEval.state === 'expired'
                                      ? tr('منتهي', 'Expired', 'ختم شدہ')
                                      : tr('موقوف', 'Suspended', 'معطل')}
                                  </span>
                                  <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                    {formatShortDate(subEval.startDate)} → {formatShortDate(subEval.endDate)}
                                  </div>
                                </div>
                              )}
                              {graceEval.inGrace && !graceEval.isFeeExempt && (
                                <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
                                  {tr(
                                    `مهلة 7 أيام: متبقي ${graceEval.remainingGraceDays ?? 7} يوم`,
                                    `7-day grace: ${graceEval.remainingGraceDays ?? 7}d remaining`,
                                    `7 دن کی مہلت: ${graceEval.remainingGraceDays ?? 7} دن باقی`
                                  )}
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              {pricing.isBillingExempt ? (
                                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                                  {tr('0 ر.س (إعفاء دائم شامل)', '0 SAR (Permanent full exemption)', '0 ریال (مستقل مکمل استثنیٰ)')}
                                </span>
                              ) : pricing.isLegacyExempt ? (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {tr('0 ر.س (إعفاء قديم)', '0 SAR (Legacy exempt)', '0 ریال (سابقہ استثنیٰ)')}
                                </span>
                              ) : (
                                <div className="space-y-0.5 text-[11px]">
                                  <div>
                                    {tr(`تأسيس ${pricing.setupFeeSar} ر.س:`, `Setup ${pricing.setupFeeSar} SAR:`, `سیٹ اپ ${pricing.setupFeeSar} ریال:`)}{' '}
                                    <span
                                      className={`font-bold ${
                                        pricing.setupFeeStatus === 'paid'
                                          ? 'text-[#048264] dark:text-[#08C99B]'
                                          : pricing.setupFeeStatus === 'waived'
                                          ? 'text-slate-500'
                                          : 'text-rose-600 dark:text-rose-400'
                                      }`}
                                    >
                                      {pricing.setupFeeStatus === 'paid'
                                        ? tr('مدفوعة', 'Paid', 'ادا شدہ')
                                        : pricing.setupFeeStatus === 'waived'
                                        ? tr('معفاة', 'Waived', 'معاف')
                                        : tr('غير مدفوعة', 'Unpaid', 'غیر ادا شدہ')}
                                    </span>
                                  </div>
                                  <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                    {tr('الفروع:', 'Branches:', 'برانچز:')} {pricing.activeBranchesCount} × {BRANCH_MONTHLY_FEE_SAR} ={' '}
                                    {pricing.estimatedMonthlyBranchTotalSar} {tr('ر.س/ش', 'SAR/mo', 'ریال/ماہ')}
                                  </div>
                                  {org.deactivationReason === 'no_paid_branches' && (
                                    <div className="text-rose-500 font-semibold">
                                      {tr(
                                        `إعادة تنشيط مطلوبة: ${ORG_REACTIVATION_FEE_SAR} ر.س`,
                                        `Reactivation fee required: ${ORG_REACTIVATION_FEE_SAR} SAR`,
                                        `بحالی فیس درکار: ${ORG_REACTIVATION_FEE_SAR} ریال`
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <div className="text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                {tr('مدفوعة:', 'Paid:', 'ادا شدہ:')} {pricing.paidBranchesCount}/{orgBranches.length}
                              </div>
                              <div className={`inline-flex items-center gap-1 text-[11px] mt-1 ${health.className}`}>
                                {health.icon}
                                <span>
                                  Drive: {org.driveConnected ? health.text : tr('غير مربوط', 'Not linked', 'منسلک نہیں')}
                                </span>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top text-end">
                              <div className="inline-flex flex-wrap justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditOrgModal(org)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] hover:bg-[#1764FF]/10 hover:text-[#1764FF] dark:hover:text-[#6CA2FF] transition-colors"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>{tr('تعديل/فوترة', 'Edit / Billing', 'ترمیم / بلنگ')}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openOrgExemptionModal(org)}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                                    subEval.isBillingExempt
                                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
                                      : 'bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-700 dark:text-slate-200 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300'
                                  }`}
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>
                                    {org.billingExempt === true
                                      ? tr('إدارة الإعفاء', 'Manage Exemption', 'استثنیٰ کا انتظام')
                                      : tr('إعفاء دائم', 'Permanent Exempt', 'مستقل استثنیٰ')}
                                  </span>
                                </button>

                                {orgBranches.some((b) => b.lifecycleStatus !== 'purged_from_db' && b.billingExempt !== true) && (
                                  <button
                                    type="button"
                                    onClick={() => openBulkBranchesExemptionModal(org)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-700 dark:text-slate-200 hover:bg-[#08C99B]/15 hover:text-[#048264] dark:hover:text-[#08C99B] transition-colors"
                                  >
                                    <Layers className="w-3.5 h-3.5" />
                                    <span>{tr('إعفاء جميع الفروع', 'Exempt All Branches', 'تمام برانچز مستثنیٰ')}</span>
                                  </button>
                                )}

                                {subEval.isAllowed ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      clearFeedback();
                                      setStatusModalOrg(org);
                                      setStatusActionMode(
                                        graceEval.inGrace && !graceEval.isFeeExempt
                                          ? 'deactivate_no_paid_branches'
                                          : 'suspend'
                                      );
                                      setStatusNote('');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                    <span>{tr('إيقاف', 'Suspend', 'معطل کریں')}</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      clearFeedback();
                                      setStatusModalOrg(org);
                                      setStatusActionMode('reactivate');
                                      setReactivationFeeStatus(subEval.isFeeExempt ? 'waived' : 'paid');
                                      setReactivationFeeDateIso(todayIso);
                                      setStatusNote('');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] hover:bg-[#08C99B]/20 transition-colors"
                                  >
                                    <Play className="w-3.5 h-3.5" />
                                    <span>{tr('إعادة تنشيط', 'Reactivate', 'دوبارہ فعال کریں')}</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedOrgId(org.id);
                                    setDetailTab('branches');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF]"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>{tr('التفاصيل', 'Details', 'تفصیلات')}</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 2: Branches Lifecycle & Billing */}
        {mainTab === 'branches' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'all', label: `${tr('الكل', 'All', 'سب')} (${allBranches.length})` },
                  { id: 'active', label: `${tr('فعالة', 'Active', 'فعال')} (${stats.activeBranchesCount})` },
                  { id: 'exempt', label: `${tr('معفاة', 'Exempt', 'مستثنیٰ')} (${stats.exemptBranchesCount})` },
                  { id: 'unpaid_overdue', label: tr('غير مدفوعة / متأخرة', 'Unpaid / Overdue', 'غیر ادا شدہ / واجب الادا') },
                  { id: 'suspended', label: `${tr('معلقة', 'Suspended', 'معطل')} (${stats.suspendedBranchesCount})` },
                  { id: 'purge_ready', label: `${tr('متجاوزة 30 يوماً', 'Past 30d Grace', '30 دن سے زائد')} (${stats.purgeReadyBranchesCount})` },
                  { id: 'purged', label: `${tr('منظفة من القاعدة', 'Purged from DB', 'DB سے صاف شدہ')} (${stats.purgedBranchesCount})` },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setBranchFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    branchFilter === f.id
                      ? 'bg-[#1764FF] text-white border-transparent'
                      : 'bg-white dark:bg-[#122543] text-slate-600 dark:text-slate-300 border-[#DCE6FA] dark:border-[#1F3B66]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden shadow-sm">
              {filteredBranches.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'لا توجد فروع مطابقة للتصفية الحالية.',
                    'No branches match the current filter.',
                    'موجودہ فلٹر کے مطابق کوئی برانچ نہیں ملی۔'
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start border-collapse">
                    <thead>
                      <tr className="border-b border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        <th className="py-3.5 px-4 text-start">{tr('الفرع والرمز', 'Branch & Code', 'برانچ اور کوڈ')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('المؤسسة الأم', 'Organization', 'ادارہ')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('الحالة ودورة الحياة', 'Lifecycle Status', 'حیثیت')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('الدفع والرسوم (50 ر.س)', 'Billing (50 SAR)', 'فیس اور ادائیگی (50 ریال)')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('مهلة 30 يوماً / توثيق Drive', '30d Grace / Drive Backup', '30 دن مہلت / Drive بیک اپ')}</th>
                        <th className="py-3.5 px-4 text-end">{tr('تحكم صاحب الموقع', 'Owner Controls', 'مالک کنٹرولز')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66] text-xs">
                      {filteredBranches.map((branch) => {
                        const parentOrg = orgMap.get(branch.orgId);
                        const evalB = evaluateBranchBillingAndGrace(branch, parentOrg);
                        return (
                          <tr key={branch.id} className="hover:bg-[#F5F8FF]/70 dark:hover:bg-[#173056]/40">
                            <td className="py-3.5 px-4 align-top">
                              <div className="font-bold text-[#0B1B32] dark:text-white">{branch.name}</div>
                              <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                                {branch.code} · {branch.id}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <div className="font-semibold text-[#0B1B32] dark:text-slate-200">
                                {parentOrg?.name || branch.orgId}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                                {parentOrg?.ownerEmail || '—'}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                                  evalB.isPurgedFromDb
                                    ? 'bg-slate-200 dark:bg-[#0E203A] text-slate-500'
                                    : evalB.isSuspended
                                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                    : 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B]'
                                }`}
                              >
                                {evalB.isPurgedFromDb
                                  ? tr('تم حذف سجلات DB فقط', 'DB Records Purged Only', 'صرف DB ریکارڈز حذف')
                                  : evalB.isSuspended
                                  ? tr('معلق', 'Suspended', 'معطل')
                                  : tr('نشط', 'Active', 'فعال')}
                              </span>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                                {tr('البداية:', 'Start:', 'شروع:')} {formatShortDate(branch.subscriptionStartAt || branch.createdAt)}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <div className="font-mono font-bold tabular-nums text-[#1764FF] dark:text-[#6CA2FF]">
                                {evalB.monthlyFeeSar} {tr('ر.س/شهر', 'SAR/mo', 'ریال/ماہ')}
                              </div>
                              <div className="text-[11px] mt-0.5 flex flex-wrap items-center gap-1.5">
                                <span>{tr('الحالة:', 'Status:', 'حیثیت:')}</span>
                                <span
                                  className={`font-bold ${
                                    evalB.paymentStatus === 'paid' || evalB.paymentStatus === 'exempt'
                                      ? 'text-[#048264] dark:text-[#08C99B]'
                                      : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {evalB.paymentStatus === 'paid'
                                    ? tr('مدفوع', 'Paid', 'ادا شدہ')
                                    : evalB.paymentStatus === 'exempt'
                                    ? tr('معفى', 'Exempt', 'مستثنیٰ')
                                    : evalB.paymentStatus === 'overdue'
                                    ? tr('متأخر', 'Overdue', 'واجب الادا')
                                    : tr('غير مدفوع', 'Unpaid', 'غیر ادا شدہ')}
                                </span>
                                {evalB.exemptionSource !== 'none' && (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                                    {evalB.exemptionSource === 'both'
                                      ? tr('المؤسسة + الفرع', 'Org + Branch', 'ادارہ + برانچ')
                                      : evalB.exemptionSource === 'organization'
                                      ? tr('إعفاء المؤسسة', 'Org Exemption', 'ادارہ استثنیٰ')
                                      : tr('إعفاء الفرع', 'Branch Exemption', 'برانچ استثنیٰ')}
                                  </span>
                                )}
                              </div>
                              {branch.billingExempt === true && (
                                <div className="text-[10px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                                  {branch.billingExemptMode || 'billing_exempt'} · {formatShortDate(branch.exemptGrantedAt)} · {branch.exemptGrantedBy || SUPER_ADMIN_EMAIL}
                                </div>
                              )}
                              {branch.exemptReason && (
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[230px]" title={branch.exemptReason}>
                                  {tr('السبب:', 'Reason:', 'وجہ:')} {branch.exemptReason}
                                </div>
                              )}
                              <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                {tr('الاستحقاق:', 'Due:', 'مقررہ تاریخ:')} {formatShortDate(evalB.feeDueAt)} ·{' '}
                                {tr('آخر دفع:', 'Last paid:', 'آخری ادائیگی:')} {formatShortDate(evalB.lastPaidAt)}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top text-[11px]">
                              {evalB.isSuspended ? (
                                <div className="space-y-0.5">
                                  <div className="font-mono tabular-nums text-rose-600 dark:text-rose-400">
                                    {tr('تعليق:', 'Suspended:', 'معطلی:')} {formatShortDate(evalB.suspendedAt)}
                                  </div>
                                  <div className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                    {tr('انتهاء الـ30 يوماً:', '30d Grace Ends:', '30 دن مہلت اختتام:')} {formatShortDate(evalB.gracePeriodEndsAt)}
                                  </div>
                                  <div
                                    className={`font-semibold ${
                                      evalB.driveBackupVerified
                                        ? 'text-[#048264] dark:text-[#08C99B]'
                                        : evalB.isGraceExpired
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {evalB.isPurgedFromDb
                                      ? tr('تم التنظيف من DB (Drive محفوظ)', 'Purged from DB (Drive intact)', 'DB سے صاف شدہ (Drive محفوظ)')
                                      : evalB.driveBackupVerified
                                      ? tr('نسخة Google Drive موثقة بالكامل', 'Google Drive backup verified', 'Google Drive بیک اپ تصدیق شدہ')
                                      : evalB.isGraceExpired
                                      ? tr('انتهت الـ30 يوماً — بانتظار فحص Drive', '30d expired — awaiting Drive check', '30 دن مکمل — Drive جانچ کا انتظار')
                                      : tr(
                                          `متبقي ${evalB.graceRemainingDays ?? 30} يوم`,
                                          `${evalB.graceRemainingDays ?? 30}d remaining`,
                                          `${evalB.graceRemainingDays ?? 30} دن باقی`
                                        )}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top text-end">
                              <div className="inline-flex flex-wrap justify-end gap-1.5">
                                {!evalB.isPurgedFromDb && (
                                  <button
                                    type="button"
                                    onClick={() => openBranchExemptionModal(branch)}
                                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                                      branch.billingExempt === true
                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
                                        : 'bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300'
                                    }`}
                                  >
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    <span>
                                      {branch.billingExempt === true
                                        ? tr('إدارة الإعفاء', 'Manage Exemption', 'استثنیٰ انتظام')
                                        : tr('إعفاء الفرع', 'Exempt Branch', 'برانچ مستثنیٰ')}
                                    </span>
                                  </button>
                                )}

                                {!evalB.isPurgedFromDb && branch.billingExempt !== true && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      clearFeedback();
                                      setPaymentModalBranch(branch);
                                      setBranchPaymentForm({
                                        paymentStatus:
                                          branch.paymentStatus === 'exempt'
                                            ? 'paid'
                                            : branch.paymentStatus || 'paid',
                                        paidDateIso: todayIso,
                                        feeDueDateIso:
                                          evalB.feeDueAt?.toISOString().slice(0, 10) || nextMonthIso,
                                        monthlyFeeSar: evalB.monthlyFeeSar || BRANCH_MONTHLY_FEE_SAR,
                                        paymentNote: branch.paymentNote || '',
                                      });
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] hover:bg-[#1764FF]/10 hover:text-[#1764FF] dark:hover:text-[#6CA2FF]"
                                  >
                                    <CreditCard className="w-3.5 h-3.5" />
                                    <span>{tr('سداد 50 ر.س', 'Record 50 SAR', '50 ریال ادائیگی')}</span>
                                  </button>
                                )}

                                {!evalB.isSuspended && !evalB.isPurgedFromDb && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      clearFeedback();
                                      setSuspendBranchTarget(branch);
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                    <span>{tr('تعليق (30 يوم)', 'Suspend (30d)', 'معطل کریں (30د)')}</span>
                                  </button>
                                )}

                                {evalB.isSuspended && !evalB.isPurgedFromDb && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        clearFeedback();
                                        setReactivateBranchTarget(branch);
                                        setReactivateBranchForm({
                                          paymentStatus: 'paid',
                                          feeDueDateIso: nextMonthIso,
                                          paymentNote: '',
                                        });
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B]"
                                    >
                                      <Play className="w-3.5 h-3.5" />
                                      <span>{tr('إعادة تنشيط', 'Reactivate', 'دوبارہ فعال کریں')}</span>
                                    </button>

                                    <button
                                      type="button"
                                      disabled={!evalB.isGraceExpired}
                                      onClick={() => handleInspectBranchBackup(branch)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title={
                                        evalB.isGraceExpired
                                          ? tr('فحص أرشفة Drive وتنفيذ حذف سجلات DB فقط', 'Inspect Drive archival and purge DB records only', 'Drive آرکائیو جانچیں اور صرف DB ریکارڈز حذف کریں')
                                          : tr('يُفتح بعد انقضاء 30 يوماً كاملة على التعليق', 'Unlocks after a full 30-day suspension grace period', 'معطلی کے مکمل 30 دن بعد کھلے گا')
                                      }
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>{tr('فحص Drive وحذف DB', 'Check Drive & Purge DB', 'Drive جانچیں اور DB حذف')}</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 2.5: Cross-Organization Members Management */}
        {mainTab === 'members' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={memberOrgFilter}
                  onChange={(e) => setMemberOrgFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-semibold"
                >
                  <option value="all">{tr('جميع المؤسسات', 'All Organizations', 'تمام ادارے')}</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>

                {(
                  [
                    { id: 'all', label: tr('كل الأدوار', 'All Roles', 'تمام کردار') },
                    { id: 'manager', label: getUserRoleLabel('manager', language) },
                    { id: 'supervisor', label: getUserRoleLabel('supervisor', language) },
                    { id: 'branch_manager', label: getUserRoleLabel('branch_manager', language) },
                    { id: 'employee', label: getUserRoleLabel('employee', language) },
                  ] as const
                ).map((rf) => (
                  <button
                    key={rf.id}
                    type="button"
                    onClick={() => setMemberRoleFilter(rf.id)}
                    className={`px-3 py-1.5 rounded-lg font-semibold border transition-colors ${
                      memberRoleFilter === rf.id
                        ? 'bg-[#1764FF] text-white border-transparent'
                        : 'bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-600 dark:text-slate-300 border-[#DCE6FA] dark:border-[#1F3B66]'
                    }`}
                  >
                    {rf.label}
                  </button>
                ))}

                {(
                  [
                    { id: 'all', label: `${tr('الكل', 'All', 'سب')} (${allUsers.length})` },
                    { id: 'active', label: `${tr('النشطون', 'Active', 'فعال')} (${stats.activeMembersCount})` },
                    { id: 'archived', label: `${tr('المؤرشفون', 'Archived', 'آرکائیو')} (${stats.archivedMembersCount})` },
                    { id: 'released', label: `${tr('المحررون (بدون مؤسسة)', 'Released', 'آزاد شدہ')} (${stats.releasedMembersCount})` },
                  ] as const
                ).map((sf) => (
                  <button
                    key={sf.id}
                    type="button"
                    onClick={() => setMemberStatusFilter(sf.id)}
                    className={`px-3 py-1.5 rounded-lg font-semibold border transition-colors ${
                      memberStatusFilter === sf.id
                        ? sf.id === 'released'
                          ? 'bg-rose-600 text-white border-transparent'
                          : 'bg-[#048264] text-white border-transparent'
                        : 'bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-600 dark:text-slate-300 border-[#DCE6FA] dark:border-[#1F3B66]'
                    }`}
                  >
                    {sf.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  openCreateMemberModal(memberOrgFilter !== 'all' ? memberOrgFilter : undefined)
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#1764FF] hover:bg-[#1052D8] text-white transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>{tr('إضافة عضو جديد', 'Add New Member', 'نیا رکن شامل کریں')}</span>
              </button>
            </div>

            <div className="rounded-xl border border-[#1764FF]/25 bg-[#1764FF]/5 p-3 text-[11px] text-slate-700 dark:text-slate-300 flex items-start gap-2">
              <Info className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF] shrink-0 mt-0.5" />
              <span>
                {tr(
                  'حوكمة عضويات الموظفين: الأرشفة تعطيل مؤقت داخل نفس المؤسسة، بينما «فصل العضوية نهائياً» يحرر الموظف من مؤسسته مع حفظ حساب المصادقة وكافة السجلات التاريخية ثم يتيح إعادة ربطه بمؤسسة نشطة أخرى بصلاحيات جديدة مستقلة. يُمنع فصل مدير المؤسسة (manager) أو المالك أو المدير الرئيسي.',
                  'Membership Governance: Archiving temporarily disables access inside the same org, whereas Permanent Release detaches org/branch/permissions while preserving the auth account and all historical records so the same UID can be re-assigned to another active organization with fresh permissions.',
                  'رکنیت گورننس: آرکائیو اسی ادارے میں عارضی معطلی ہے، جبکہ مستقل علیحدگی اکاؤنٹ اور تاریخی ریکارڈ محفوظ رکھتے ہوئے نئے ادارے سے منسلک کرنے کی سہولت دیتی ہے۔'
                )}
              </span>
            </div>

            {(() => {
              const emailDiagnostics = detectProfileEmailDiagnostics(allUsers);
              if (!authEmailMismatch && emailDiagnostics.length === 0) return null;
              return (
                <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                  <div className="font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      {tr(
                        'تنبيه تشخيصي لعدم تطابق أو تنسيق البريد الإلكتروني (لم تُجرَ أي مزامنة تلقائية)',
                        'Email Mismatch / Normalization Diagnostic Alert (No Auto-Sync Performed)',
                        'ای میل عدم مطابقت / فارمیٹنگ تشخیصی تنبیہ (کوئی خودکار ہم آہنگی نہیں کی گئی)'
                      )}
                    </span>
                  </div>
                  {authEmailMismatch && (
                    <div className="text-[11px] font-mono bg-white/70 dark:bg-[#0E203A] rounded-lg p-2 border border-amber-500/20" dir="ltr">
                      UID: {authEmailMismatch.uid} | Auth: {authEmailMismatch.authEmail} | Firestore:{' '}
                      {authEmailMismatch.profileEmail}
                    </div>
                  )}
                  {emailDiagnostics.length > 0 && (
                    <div className="text-[11px] space-y-1">
                      <p>
                        {tr(
                          `تم رصد ${emailDiagnostics.length} حالة تحتاج مراجعة منسّقة بين Firebase Authentication وFirestore قبل أي تعديل:`,
                          `Detected ${emailDiagnostics.length} profile email diagnostic item(s) requiring coordinated review between Firebase Authentication and Firestore:`,
                          `${emailDiagnostics.length} پروفائل ای میل کیسز کی نشاندہی ہوئی ہے جن کے لیے Firebase Authentication اور Firestore کے درمیان مشترکہ جائزہ درکار ہے:`
                        )}
                      </p>
                      <ul className="space-y-1 max-h-28 overflow-y-auto">
                        {emailDiagnostics.slice(0, 8).map((item, idx) => (
                          <li key={`${item.uid}_${item.issueType}_${idx}`} className="font-mono text-[10px]" dir="ltr">
                            [{item.issueType}] {item.displayName} ({item.uid}): "{item.storedEmail}"
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden shadow-sm">
              {filteredMembers.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'لا يوجد أعضاء مطابقون لخيارات البحث أو التصفية.',
                    'No members match the current search or filter.',
                    'موجودہ تلاش یا فلٹر کے مطابق کوئی رکن نہیں ملا۔'
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start border-collapse">
                    <thead>
                      <tr className="border-b border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        <th className="py-3.5 px-4 text-start">{tr('العضو والبريد', 'Member & Email', 'رکن اور ای میل')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('المؤسسة الحالية / السابقة', 'Current / Previous Org', 'موجودہ / سابقہ ادارہ')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('الدور والفرع', 'Role & Branch', 'کردار اور برانچ')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('حالة العضوية والتواريخ', 'Membership & Dates', 'حیثیت اور تاریخیں')}</th>
                        <th className="py-3.5 px-4 text-end">{tr('إجراءات الحوكمة', 'Governance Actions', 'انتظامی کارروائیاں')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66] text-xs">
                      {filteredMembers.map((member) => {
                        const parentOrg = member.orgId ? orgMap.get(member.orgId) : undefined;
                        const memberHistoryRecords = memberHistoryByUid.get(member.uid) || [];
                        const latestReleaseRecord = latestReleaseHistoryByUid.get(member.uid);
                        const prevOrgIdFromHistory = latestReleaseRecord?.orgId;
                        const prevOrg = prevOrgIdFromHistory
                          ? orgMap.get(prevOrgIdFromHistory)
                          : undefined;
                        const prevOrgLabel =
                          latestReleaseRecord?.orgName || prevOrg?.name || prevOrgIdFromHistory;
                        const branchObj = member.branchId ? branchMap.get(member.branchId) : undefined;
                        const membershipStatus = resolveMemberMembershipStatus(member);
                        const isReleased = membershipStatus === 'released';
                        const isArchived =
                          !isReleased && (membershipStatus === 'archived' || member.isActive === false);
                        const editable = canManageMember(member);
                        const releaseEligible = isMemberEligibleForRelease(member, parentOrg);
                        const isSuperAdminEmail =
                          (member.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
                        const isOrgOwner =
                          Boolean(parentOrg) &&
                          (parentOrg?.ownerId === member.uid ||
                            (parentOrg?.ownerEmail || '').trim().toLowerCase() ===
                              (member.email || '').trim().toLowerCase());
                        const historyCount = memberHistoryRecords.length;

                        return (
                          <tr
                            key={member.uid}
                            className="hover:bg-[#F5F8FF]/70 dark:hover:bg-[#173056]/40 transition-colors"
                          >
                            <td className="py-3.5 px-4 align-top">
                              <div className="font-bold text-[#0B1B32] dark:text-white">
                                {member.displayName}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                                {member.email}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                                UID: {member.uid}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              {isReleased ? (
                                <div className="space-y-1">
                                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300">
                                    {tr('بدون مؤسسة حالياً', 'Unassigned (Released)', 'فی الحال بغیر ادارہ')}
                                  </span>
                                  {prevOrgLabel && (
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                      {tr('سابقاً:', 'Previously:', 'سابقہ:')}{' '}
                                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                                        {prevOrgLabel}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <div className="font-semibold text-[#0B1B32] dark:text-slate-200">
                                    {parentOrg?.name || member.orgId}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-500" dir="ltr">
                                    {member.orgId}
                                  </div>
                                  {prevOrgLabel && (
                                    <div className="text-[10px] text-indigo-600 dark:text-indigo-300 mt-0.5">
                                      {tr('منقول سابقاً من:', 'Previously released from:', 'سابقہ ادارہ:')}{' '}
                                      {prevOrgLabel}
                                    </div>
                                  )}
                                </>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                                  member.role === 'manager'
                                    ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                                    : member.role === 'supervisor'
                                    ? 'bg-[#1764FF]/15 text-[#1764FF] dark:text-[#6CA2FF]'
                                    : member.role === 'branch_manager'
                                    ? 'bg-[#08C99B]/15 text-[#048264] dark:text-[#08C99B]'
                                    : 'bg-slate-200 dark:bg-[#0E203A] text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {getUserRoleLabel(member.role, language)}
                              </span>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                {isReleased
                                  ? tr('لا يوجد فرع مرتبط (صلاحيات مُصفَّرة)', 'No branch bound (zero permissions)', 'کوئی برانچ منسلک نہیں')
                                  : member.role === 'manager' || member.role === 'supervisor'
                                  ? tr('نطاق المؤسسة بالكامل', 'Organization-wide scope', 'مکمل ادارہ دائرہ')
                                  : branchObj?.name || member.branchName || member.branchId || '—'}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                                  isReleased
                                    ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                    : isArchived
                                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                    : 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B]'
                                }`}
                              >
                                {isReleased
                                  ? tr('محرر نهائياً (released)', 'Permanently Released', 'مستقل طور پر آزاد')
                                  : member.isArchived === true
                                  ? tr('مؤرشف', 'Archived', 'آرکائیو شدہ')
                                  : member.isActive === false
                                  ? tr('معطل', 'Disabled', 'معطل')
                                  : tr('نشط', 'Active', 'فعال')}
                              </span>
                              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                                {tr('أنشئ:', 'Created:', 'تخلیق:')} {formatShortDate(member.createdAt)}
                                {isReleased && latestReleaseRecord?.effectiveAt
                                  ? ` · ${tr('فُصل:', 'Released:', 'الگ:')} ${formatShortDate(latestReleaseRecord.effectiveAt)}`
                                  : ` · ${tr('حدّث:', 'Updated:', 'اپ ڈیٹ:')} ${formatShortDate(member.updatedAt)}`}
                              </div>
                              {historyCount > 0 && (
                                <div className="text-[10px] text-indigo-600 dark:text-indigo-300 mt-0.5 font-semibold">
                                  {tr(`سجلات العضوية: ${historyCount}`, `Membership History: ${historyCount}`, `رکنیت ریکارڈز: ${historyCount}`)}
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top text-end">
                              <div className="inline-flex flex-wrap justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setMemberDetailUid(member.uid)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF] text-slate-700 dark:text-slate-200"
                                >
                                  <History className="w-3.5 h-3.5" />
                                  <span>{tr('التفاصيل والسجل', 'Details & History', 'تفصیلات')}</span>
                                </button>

                                {isReleased && editable ? (
                                  <button
                                    type="button"
                                    onClick={() => openAssignMemberModal(member)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#1764FF] hover:bg-[#1052D8] text-white"
                                  >
                                    <Link2 className="w-3.5 h-3.5" />
                                    <span>{tr('إعادة ربط بمؤسسة', 'Assign to Org', 'ادارے سے منسلک کریں')}</span>
                                  </button>
                                ) : editable && !isOrgOwner ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openEditMemberModal(member)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] hover:bg-[#1764FF]/10 hover:text-[#1764FF] dark:hover:text-[#6CA2FF]"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                      <span>{tr('تعديل / نقل فرع', 'Edit / Transfer', 'ترمیم / منتقلی')}</span>
                                    </button>
                                    {isArchived ? (
                                      <button
                                        type="button"
                                        onClick={() => openMemberLifecycleModal(member, 'reactivate')}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] hover:bg-[#08C99B]/20"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        <span>{tr('إعادة تفعيل', 'Reactivate', 'دوبارہ فعال')}</span>
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => openMemberLifecycleModal(member, 'archive')}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25"
                                      >
                                        <Archive className="w-3.5 h-3.5" />
                                        <span>{tr('أرشفة', 'Archive', 'آرکائیو')}</span>
                                      </button>
                                    )}
                                    {releaseEligible && (
                                      <button
                                        type="button"
                                        onClick={() => openReleaseMemberModal(member)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 hover:bg-rose-500/25 border border-rose-500/30"
                                      >
                                        <Unlink className="w-3.5 h-3.5" />
                                        <span>{tr('فصل العضوية نهائياً', 'Release Permanently', 'مستقل علیحدگی')}</span>
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#0E203A] text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
                                    <Lock className="w-3 h-3" />
                                    <span>
                                      {isSuperAdminEmail
                                        ? tr('محمي — المدير الرئيسي', 'Protected — Super Admin', 'محفوظ — سپر ایڈمن')
                                        : isOrgOwner
                                        ? tr('محمي — مالك المؤسسة', 'Protected — Org Owner', 'محفوظ — ادارہ مالک')
                                        : tr('محمي — مدير المؤسسة', 'Protected — Org Manager', 'محفوظ — ادارہ مینیجر')}
                                    </span>
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 3: Manager Invites */}
        {mainTab === 'invites' && (
          <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden shadow-sm">
            {filteredInvites.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                {tr('لا توجد دعوات مدراء مسجلة.', 'No manager invitations recorded.', 'کوئی مینیجر دعوت نامہ درج نہیں ہے۔')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start border-collapse">
                  <thead>
                    <tr className="border-b border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      <th className="py-3.5 px-4 text-start">{tr('البريد الموحد (Google)', 'Google Email', 'Google ای میل')}</th>
                      <th className="py-3.5 px-4 text-start">{tr('المؤسسة والمدير', 'Organization & Manager', 'ادارہ اور مینیجر')}</th>
                      <th className="py-3.5 px-4 text-start">{tr('الحالة', 'Status', 'حیثیت')}</th>
                      <th className="py-3.5 px-4 text-start">{tr('تفاصيل القبول / التحديث', 'Acceptance / Update', 'قبولیت / اپ ڈیٹ کی تفصیل')}</th>
                      <th className="py-3.5 px-4 text-end">{tr('إجراء', 'Action', 'کارروائی')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66] text-xs">
                    {filteredInvites.map((inv) => (
                      <tr key={inv.id} className="hover:bg-[#F5F8FF]/70 dark:hover:bg-[#173056]/40">
                        <td className="py-3.5 px-4 font-mono" dir="ltr">
                          {inv.emailNormalized}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-[#0B1B32] dark:text-white">
                            {inv.orgName || orgMap.get(inv.orgId)?.name || inv.orgId}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{inv.managerName || '—'}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                              inv.status === 'accepted'
                                ? 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B]'
                                : inv.status === 'cancelled'
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {inv.status === 'accepted'
                              ? tr('مقبولة', 'Accepted', 'قبول شدہ')
                              : inv.status === 'cancelled'
                              ? tr('ملغاة', 'Cancelled', 'منسوخ')
                              : tr('معلقة (جاهزة)', 'Pending (Ready)', 'زیر التواء (تیار)')}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          {inv.status === 'accepted'
                            ? `UID: ${inv.acceptedByUid || '—'} (${formatShortDate(inv.acceptedAt)})`
                            : `${tr('آخر تحديث:', 'Updated:', 'آخری اپ ڈیٹ:')} ${formatShortDate(inv.updatedAt)}`}
                        </td>
                        <td className="py-3.5 px-4 text-end">
                          {inv.status !== 'accepted' && (
                            <div className="inline-flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  clearFeedback();
                                  setInviteForm({
                                    email: inv.emailNormalized,
                                    orgId: inv.orgId,
                                    managerName: inv.managerName || '',
                                  });
                                  setShowInviteModal(true);
                                }}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] hover:bg-[#1764FF]/10 hover:text-[#1764FF] dark:hover:text-[#6CA2FF]"
                              >
                                {tr('تعديل / إعادة تفعيل', 'Edit / Re-enable', 'ترمیم / دوبارہ فعال')}
                              </button>
                              {inv.status === 'pending' && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelInvite(inv.emailNormalized)}
                                  disabled={busyAction}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
                                >
                                  {tr('إلغاء', 'Cancel', 'منسوخ')}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 4: Platform Audit Logs (Strictly Read-Only & Append-Only) */}
        {mainTab === 'auditLogs' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { id: 'all', label: `${tr('الكل', 'All', 'سب')} (${platformAuditLogs.length})` },
                    { id: 'exemptions', label: tr('الإعفاءات', 'Exemptions', 'استثنیٰ') },
                    { id: 'members', label: tr('الأعضاء', 'Members', 'اراکین') },
                    { id: 'organizations', label: tr('المؤسسات', 'Organizations', 'ادارے') },
                    { id: 'branches', label: tr('الفروع', 'Branches', 'برانچز') },
                    { id: 'invites', label: tr('الدعوات', 'Invites', 'دعوتیں') },
                  ] as const
                ).map((cf) => (
                  <button
                    key={cf.id}
                    type="button"
                    onClick={() => setAuditCategoryFilter(cf.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      auditCategoryFilter === cf.id
                        ? 'bg-[#1764FF] text-white border-transparent'
                        : 'bg-white dark:bg-[#122543] text-slate-600 dark:text-slate-300 border-[#DCE6FA] dark:border-[#1F3B66]'
                    }`}
                  >
                    {cf.label}
                  </button>
                ))}
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#0E203A] text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <Lock className="w-3.5 h-3.5 text-[#1764FF]" />
                <span>{tr('سجل للقراءة فقط — غير قابل للتعديل أو الحذف', 'Read-only immutable audit log', 'صرف مطالعہ کے لیے مستقل آڈٹ لاگ')}</span>
              </span>
            </div>

            <div className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden shadow-sm">
              {filteredAuditLogs.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'لا توجد أحداث مطابقة في سجل عمليات صاحب الموقع.',
                    'No matching events in the platform owner audit log.',
                    'پلیٹ فارم مالک کے آڈٹ لاگ میں کوئی مماثل سرگرمی نہیں ملی۔'
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start border-collapse">
                    <thead>
                      <tr className="border-b border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        <th className="py-3.5 px-4 text-start">{tr('الوقت', 'Timestamp', 'وقت')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('نوع العملية', 'Action Type', 'کارروائی کی قسم')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('المؤسسة / الهدف', 'Organization & Target', 'ادارہ / ہدف')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('المنفّذ والنتيجة', 'Actor & Result', 'کارکن اور نتیجہ')}</th>
                        <th className="py-3.5 px-4 text-start">{tr('السبب والتفاصيل', 'Reason & Details', 'وجہ اور تفصیلات')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66] text-xs">
                      {filteredAuditLogs.map((log: PlatformAuditLog) => {
                        const targetOrg = log.orgId ? orgMap.get(log.orgId) : undefined;
                        const targetBranch =
                          log.targetType === 'branch' ? branchMap.get(log.targetId) : undefined;
                        const targetMember =
                          log.targetType === 'member' ? userMap.get(log.targetId) : undefined;
                        const reasonText =
                          log.metadata && typeof log.metadata.reason === 'string'
                            ? log.metadata.reason
                            : null;

                        return (
                          <tr key={log.id} className="hover:bg-[#F5F8FF]/60 dark:hover:bg-[#173056]/30">
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap align-top" dir="ltr">
                              {formatIsoDate(log.timestamp)}
                            </td>
                            <td className="py-3 px-4 align-top">
                              <div className="font-bold text-[#0B1B32] dark:text-white">
                                {getPlatformAuditActionLabel(log.action, language)}
                              </div>
                              <div className="font-mono text-[10px] text-[#1764FF] dark:text-[#6CA2FF]" dir="ltr">
                                {log.action}
                              </div>
                            </td>
                            <td className="py-3 px-4 align-top text-[11px]">
                              {targetOrg && (
                                <div className="font-semibold text-[#0B1B32] dark:text-slate-200">
                                  {targetOrg.name}
                                </div>
                              )}
                              {targetBranch && (
                                <div className="text-slate-600 dark:text-slate-300">
                                  {tr('الفرع:', 'Branch:', 'برانچ:')} {targetBranch.name} ({targetBranch.code})
                                </div>
                              )}
                              {targetMember && (
                                <div className="text-slate-600 dark:text-slate-300">
                                  {tr('العضو:', 'Member:', 'رکن:')} {targetMember.displayName}
                                </div>
                              )}
                              <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400" dir="ltr">
                                {log.targetType}: {log.targetId}
                              </div>
                            </td>
                            <td className="py-3 px-4 align-top text-[11px]">
                              <div className="font-mono text-slate-700 dark:text-slate-300" dir="ltr">
                                {log.actorEmail}
                              </div>
                              <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] text-[10px] font-bold">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>{tr('مكتمل ذرياً', 'Atomic Success', 'کامیاب')}</span>
                              </span>
                            </td>
                            <td className="py-3 px-4 align-top text-slate-700 dark:text-slate-200 max-w-md">
                              {reasonText && (
                                <div className="text-[11px] font-semibold text-[#0B1B32] dark:text-white mb-0.5">
                                  {tr('السبب:', 'Reason:', 'وجہ:')} {reasonText}
                                </div>
                              )}
                              <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                                {log.details}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Transparent Firebase Spark + GitHub Pages Architecture Note */}
        <section className="rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] p-4 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-3">
          <Info className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF] shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed">
            <p className="font-bold text-[#0B1B32] dark:text-white">
              {tr(
                'نطاق التنفيذ على باقة Firebase Spark + الاستضافة الثابتة (GitHub Pages)',
                'Execution Scope on Firebase Spark + Static Hosting (GitHub Pages)',
                'Firebase Spark اور سٹیٹک ہوسٹنگ (GitHub Pages) پر نفاذ کا دائرہ'
              )}
            </p>
            <p>
              {tr(
                'يتم التحقق الصارم من مهل الإيقاف والتنظيف على مستوى خادم قواعد Firestore (request.time >= deactivationDueAt و request.time >= gracePeriodEndsAt) دون الاعتماد على ساعة جهاز المستخدم. ولعدم وجود مهام مجدولة تلقائية (Cron) في باقة Spark، يتم تنفيذ التنظيف الفعلي لسجلات الفرع بعد الـ 30 يوماً وتأكيد حالات السداد يدوياً من هذه اللوحة بعد التحقق من اكتمال أرشيف Google Drive.',
                'Deactivation and purge grace periods are strictly enforced server-side via Firestore Security Rules (request.time >= deactivationDueAt and request.time >= gracePeriodEndsAt) without trusting client clocks. Because Firebase Spark does not run scheduled cron jobs, branch DB purges after 30 days and manual payment confirmations are triggered directly from this console after verifying Google Drive archival completeness.',
                'معطلی اور صفائی کی مہلت کی تصدیق سرور کی سطح پر Firestore سکیورٹی رولز (request.time >= deactivationDueAt اور request.time >= gracePeriodEndsAt) کے ذریعے سختی سے کی جاتی ہے۔ Spark پلان میں خودکار کرون جابز نہ ہونے کی وجہ سے 30 دن بعد برانچ DB کی صفائی اور ادائیگی کی تصدیق Google Drive آرکائیو کی تصدیق کے بعد اس کنسول سے دستی طور پر کی جاتی ہے۔'
              )}
            </p>
          </div>
        </section>

        {/* Footer Legal Links */}
        {onNavigatePage && (
          <footer className="pt-2 pb-6 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <a
              href={buildLegalPath('privacy')}
              onClick={(e) => {
                e.preventDefault();
                onNavigatePage('privacy');
              }}
              className="hover:text-[#1764FF] dark:hover:text-[#6CA2FF]"
            >
              {t('privacyPolicy')}
            </a>
            <span aria-hidden="true">·</span>
            <a
              href={buildLegalPath('terms')}
              onClick={(e) => {
                e.preventDefault();
                onNavigatePage('terms');
              }}
              className="hover:text-[#1764FF] dark:hover:text-[#6CA2FF]"
            >
              {t('termsOfService')}
            </a>
          </footer>
        )}
      </main>

      {/* MODAL 1: Create Organization + First Branch + Manager Invite */}
      {showCreateOrgModal && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base text-[#0B1B32] dark:text-white">
                {tr(
                  'إنشاء مؤسسة جديدة + أول فرع + دعوة مدير',
                  'Create Organization + First Branch + Manager Invite',
                  'نیا ادارہ + پہلی برانچ + مینیجر دعوت نامہ بنائیں'
                )}
              </h2>
              <button type="button" onClick={() => setShowCreateOrgModal(false)} className="p-1.5 rounded-lg hover:bg-[#F5F8FF] dark:hover:bg-[#173056]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateOrgSubmit} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">{tr('اسم المؤسسة *', 'Organization Name *', 'ادارے کا نام *')}</label>
                  <input
                    required
                    value={createOrgForm.name}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('النشاط التجاري', 'Business Activity', 'کاروباری نوعیت')}</label>
                  <select
                    value={createOrgForm.activityType}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, activityType: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  >
                    <option value="retail">{tr('تجارة تجزئة', 'Retail', 'ریٹیل')}</option>
                    <option value="restaurant">{tr('مطعم / كافيه', 'Restaurant / Cafe', 'ریسٹورنٹ / کیفے')}</option>
                    <option value="supermarket">{tr('سوبرماركت', 'Supermarket', 'سپر مارکیٹ')}</option>
                    <option value="services">{tr('خدمات', 'Services', 'خدمات')}</option>
                    <option value="other">{tr('أخرى', 'Other', 'دیگر')}</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('الرقم الضريبي', 'VAT / Tax Number', 'ٹیکس نمبر')}</label>
                  <input
                    value={createOrgForm.taxNumber}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, taxNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('السجل التجاري', 'Commercial Registration', 'تجارتی رجسٹریشن')}</label>
                  <input
                    value={createOrgForm.commercialRegistration}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, commercialRegistration: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('اسم المدير *', 'Manager Name *', 'مینیجر کا نام *')}</label>
                  <input
                    required
                    value={createOrgForm.ownerName}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, ownerName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('بريد Google للمدير *', 'Manager Google Email *', 'مینیجر کا Google ای میل *')}</label>
                  <input
                    type="email"
                    required
                    value={createOrgForm.ownerEmail}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, ownerEmail: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3">
                <div className="font-bold text-[#0B1B32] dark:text-white">
                  {tr(
                    `رسوم تأسيس الحساب (${ACCOUNT_SETUP_FEE_SAR} ر.س) والاشتراك`,
                    `Account Setup Fee (${ACCOUNT_SETUP_FEE_SAR} SAR) & Subscription`,
                    `اکاؤنٹ سیٹ اپ فیس (${ACCOUNT_SETUP_FEE_SAR} ریال) اور سبسکرپشن`
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">{tr('حالة رسوم التأسيس', 'Setup Fee Status', 'سیٹ اپ فیس کی حیثیت')}</label>
                    <select
                      value={createOrgForm.setupFeeStatus}
                      onChange={(e) =>
                        setCreateOrgForm({ ...createOrgForm, setupFeeStatus: e.target.value as FeePaymentStatus })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                    >
                      <option value="paid">{tr('مدفوعة (80 ر.س)', 'Paid (80 SAR)', 'ادا شدہ (80 ریال)')}</option>
                      <option value="unpaid">{tr('غير مدفوعة', 'Unpaid', 'غیر ادا شدہ')}</option>
                      <option value="waived">{tr('معفاة', 'Waived', 'معاف')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('تاريخ دفع التأسيس', 'Setup Fee Paid Date', 'سیٹ اپ فیس کی ادائیگی کی تاریخ')}</label>
                    <input
                      type="date"
                      value={createOrgForm.setupFeePaidDateIso}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, setupFeePaidDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('الخطة', 'Plan', 'پلان')}</label>
                    <select
                      value={createOrgForm.subscriptionPlan}
                      onChange={(e) => {
                        const plan = e.target.value as SubscriptionPlan;
                        const computedEnd = calculateSubscriptionEndDate(
                          new Date(`${createOrgForm.startDateIso}T12:00:00.000Z`),
                          plan
                        )
                          .toISOString()
                          .slice(0, 10);
                        setCreateOrgForm({
                          ...createOrgForm,
                          subscriptionPlan: plan,
                          endDateIso: computedEnd,
                        });
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                    >
                      {SUBSCRIPTION_PLANS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.labels[language] || p.labels.ar}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('تاريخ بداية الاشتراك', 'Subscription Start', 'سبسکرپشن شروع')}</label>
                    <input
                      type="date"
                      value={createOrgForm.startDateIso}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, startDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('تاريخ انتهاء الاشتراك (اختياري)', 'Subscription End (Optional)', 'سبسکرپشن اختتام (اختیاری)')}</label>
                    <input
                      type="date"
                      value={createOrgForm.endDateIso}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, endDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('ملاحظة الاشتراك', 'Subscription Note', 'سبسکرپشن نوٹ')}</label>
                    <input
                      value={createOrgForm.subscriptionNote}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, subscriptionNote: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3">
                <div className="font-bold text-[#0B1B32] dark:text-white">
                  {tr(
                    `الفرع الأول (${BRANCH_MONTHLY_FEE_SAR} ر.س/شهرياً من أول فرع)`,
                    `First Branch (${BRANCH_MONTHLY_FEE_SAR} SAR/mo from the first branch)`,
                    `پہلی برانچ (پہلی برانچ سے ${BRANCH_MONTHLY_FEE_SAR} ریال ماہانہ)`
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">{tr('اسم الفرع *', 'Branch Name *', 'برانچ کا نام *')}</label>
                    <input
                      required
                      value={createOrgForm.firstBranchName}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, firstBranchName: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('رمز الفرع', 'Branch Code', 'برانچ کوڈ')}</label>
                    <input
                      value={createOrgForm.firstBranchCode}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, firstBranchCode: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('حالة دفع الفرع', 'Branch Payment Status', 'برانچ ادائیگی کی حیثیت')}</label>
                    <select
                      value={createOrgForm.firstBranchPaymentStatus}
                      onChange={(e) =>
                        setCreateOrgForm({
                          ...createOrgForm,
                          firstBranchPaymentStatus: e.target.value as BranchPaymentStatus,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                    >
                      <option value="paid">{tr('مدفوع (50 ر.س)', 'Paid (50 SAR)', 'ادا شدہ (50 ریال)')}</option>
                      <option value="unpaid">{tr('غير مدفوع', 'Unpaid', 'غیر ادا شدہ')}</option>
                      <option value="exempt">{tr('معفى', 'Exempt', 'مستثنیٰ')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('استحقاق الفرع', 'Branch Due Date', 'برانچ کی مقررہ تاریخ')}</label>
                    <input
                      type="date"
                      value={createOrgForm.firstBranchDueDateIso}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, firstBranchDueDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateOrgModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold"
                >
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="px-5 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white font-bold disabled:opacity-50 transition-colors"
                >
                  {busyAction
                    ? tr('جاري التنفيذ...', 'Processing...', 'کارروائی جاری ہے...')
                    : tr('إنشاء المؤسسة وإصدار الدعوة', 'Create Org & Issue Invite', 'ادارہ بنائیں اور دعوت جاری کریں')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Edit Org Profile, Setup Fee, Subscription & Legacy Conversion */}
      {editingOrg && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base">
                {tr('تعديل بيانات وفوترة المؤسسة:', 'Edit Organization & Billing:', 'ادارے اور بلنگ میں ترمیم:')} {editingOrg.name}
              </h2>
              <button type="button" onClick={() => setEditingOrg(null)} className="p-1.5 rounded-lg hover:bg-[#F5F8FF] dark:hover:bg-[#173056]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleEditOrgSubmit} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">{tr('اسم المؤسسة', 'Organization Name', 'ادارے کا نام')}</label>
                  <input
                    required
                    value={editOrgForm.name}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('الرقم الضريبي', 'VAT / Tax Number', 'ٹیکس نمبر')}</label>
                  <input
                    value={editOrgForm.taxNumber}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, taxNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('السجل التجاري', 'Commercial Registration', 'تجارتی رجسٹریشن')}</label>
                  <input
                    value={editOrgForm.commercialRegistration}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, commercialRegistration: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('اسم المدير', 'Manager Name', 'مینیجر کا نام')}</label>
                  <input
                    required
                    value={editOrgForm.ownerName}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, ownerName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('بريد المدير', 'Manager Email', 'مینیجر ای میل')}</label>
                  <input
                    type="email"
                    required
                    value={editOrgForm.ownerEmail}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, ownerEmail: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('العملة', 'Currency', 'کرنسی')}</label>
                  <select
                    value={editOrgForm.currency}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, currency: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  >
                    {['SAR', 'AED', 'QAR', 'KWD', 'USD'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {evaluateOrganizationSubscription(editingOrg).isBillingExempt && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
                  <div className="font-bold">
                    {tr(
                      'هذه المؤسسة مشمولة بالإعفاء الدائم الشامل (billing_exempt) — 0 ر.س',
                      'This organization has an active Permanent Full Billing Exemption (0 SAR)',
                      'یہ ادارہ مستقل مکمل فیس استثنیٰ (0 ریال) میں شامل ہے'
                    )}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                    {tr(
                      'تُحفظ السجلات التاريخية للاشتراكات والفواتير كما هي دون تعديل. ملاحظة: تغيير بريد المالك هنا يؤدي تلقائياً لإلغاء الإعفاء الدائم وتسجيله في سجل التدقيق.',
                      'Historical subscription and billing records remain preserved untouched. Note: changing owner email automatically revokes the permanent exemption with an audit entry.',
                      'تاریخی ریکارڈز محفوظ رہتے ہیں۔ نوٹ: مالک کی ای میل تبدیل کرنے پر مستقل استثنیٰ خودکار طور پر منسوخ ہو جائے گا۔'
                    )}
                  </div>
                </div>
              )}

              {evaluateOrganizationSubscription(editingOrg).isLegacy && (
                <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editOrgForm.convertLegacyToPaid}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, convertLegacyToPaid: e.target.checked })}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-bold text-amber-800 dark:text-amber-300">
                      {tr(
                        'مؤسسة قديمة معفاة (legacy_unrestricted) — تفعيل الاشتراك المدفوع من الآن',
                        'Legacy Exempt Org (legacy_unrestricted) — Switch to Paid Subscription Now',
                        'سابقہ مستثنیٰ ادارہ (legacy_unrestricted) — ابھی سے ادا شدہ سبسکرپشن فعال کریں'
                      )}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">
                      {tr(
                        'تبقى المؤسسة معفاة ما لم تحدد هذا الخيار؛ لا تُفرض أي رسوم بأثر رجعي.',
                        'The organization stays exempt unless checked; no retroactive fees are charged.',
                        'جب تک یہ اختیار منتخب نہ کیا جائے ادارہ مستثنیٰ رہے گا؛ کوئی پچھلی فیس لاگو نہیں ہوتی۔'
                      )}
                    </div>
                  </div>
                </label>
              )}

              {!evaluateOrganizationSubscription(editingOrg).isBillingExempt &&
                (!evaluateOrganizationSubscription(editingOrg).isLegacy || editOrgForm.convertLegacyToPaid) && (
                <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">{tr('رسوم التأسيس (80 ر.س)', 'Setup Fee (80 SAR)', 'سیٹ اپ فیس (80 ریال)')}</label>
                    <select
                      value={editOrgForm.setupFeeStatus}
                      onChange={(e) =>
                        setEditOrgForm({ ...editOrgForm, setupFeeStatus: e.target.value as FeePaymentStatus })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                    >
                      <option value="paid">{tr('مدفوعة', 'Paid', 'ادا شدہ')}</option>
                      <option value="unpaid">{tr('غير مدفوعة', 'Unpaid', 'غیر ادا شدہ')}</option>
                      <option value="waived">{tr('معفاة', 'Waived', 'معاف')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('تاريخ دفع التأسيس', 'Setup Fee Paid Date', 'سیٹ اپ ادائیگی کی تاریخ')}</label>
                    <input
                      type="date"
                      value={editOrgForm.setupFeePaidDateIso}
                      onChange={(e) => setEditOrgForm({ ...editOrgForm, setupFeePaidDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('حالة الاشتراك', 'Subscription Status', 'سبسکرپشن کی حیثیت')}</label>
                    <select
                      value={editOrgForm.subscriptionStatus}
                      onChange={(e) =>
                        setEditOrgForm({ ...editOrgForm, subscriptionStatus: e.target.value as SubscriptionStatus })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                    >
                      <option value="active">{tr('نشط', 'Active', 'فعال')}</option>
                      <option value="expired">{tr('منتهي', 'Expired', 'ختم شدہ')}</option>
                      <option value="suspended">{tr('موقوف', 'Suspended', 'معطل')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('الخطة', 'Plan', 'پلان')}</label>
                    <select
                      value={editOrgForm.subscriptionPlan}
                      onChange={(e) =>
                        setEditOrgForm({ ...editOrgForm, subscriptionPlan: e.target.value as SubscriptionPlan })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                    >
                      {SUBSCRIPTION_PLANS.map((p) => (
                        <option key={p.id} value={p.id}>{p.labels[language] || p.labels.ar}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('بداية الاشتراك', 'Start Date', 'شروع کی تاریخ')}</label>
                    <input
                      type="date"
                      value={editOrgForm.startDateIso}
                      onChange={(e) => setEditOrgForm({ ...editOrgForm, startDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('نهاية الاشتراك', 'End Date', 'اختتام کی تاریخ')}</label>
                    <input
                      type="date"
                      value={editOrgForm.endDateIso}
                      onChange={(e) => setEditOrgForm({ ...editOrgForm, endDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingOrg(null)}
                  className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold"
                >
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="px-5 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white font-bold disabled:opacity-50 transition-colors"
                >
                  {busyAction
                    ? tr('جاري الحفظ...', 'Saving...', 'محفوظ ہو رہا ہے...')
                    : tr('حفظ التغييرات', 'Save Changes', 'تبدیلیاں محفوظ کریں')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Org Suspend / 7-Day Grace / Reactivate (10 SAR) */}
      {statusModalOrg && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base">
                {tr('إدارة حالة المؤسسة:', 'Manage Org Status:', 'ادارے کی حیثیت کا انتظام:')} {statusModalOrg.name}
              </h2>
              <button type="button" onClick={() => setStatusModalOrg(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleOrgStatusSubmit} className="p-6 space-y-4 text-xs">
              {(() => {
                const statusSubEval = evaluateOrganizationSubscription(statusModalOrg);
                return (
                  <>
                    <div>
                      <label className="block font-semibold mb-1">{tr('الإجراء', 'Action', 'کارروائی')}</label>
                      <select
                        value={statusActionMode}
                        onChange={(e) => setStatusActionMode(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                      >
                        <option value="reactivate">
                          {statusSubEval.isFeeExempt
                            ? tr('إعادة تنشيط المؤسسة (0 ر.س — معفاة)', 'Reactivate Organization (0 SAR — Exempt)', 'ادارہ دوبارہ فعال کریں (0 ریال — مستثنیٰ)')
                            : tr('إعادة تنشيط المؤسسة (رسوم 10 ر.س)', 'Reactivate Organization (10 SAR fee)', 'ادارہ دوبارہ فعال کریں (10 ریال فیس)')}
                        </option>
                        {!statusSubEval.isFeeExempt && (
                          <option value="start_no_paid_branch_grace">
                            {tr('بدء مهلة 7 أيام (لا يوجد فرع مدفوع)', 'Start 7-Day Grace (No Paid Branch)', '7 دن کی مہلت شروع کریں (کوئی ادا شدہ برانچ نہیں)')}
                          </option>
                        )}
                        {!statusSubEval.isFeeExempt && (
                          <option value="deactivate_no_paid_branches">
                            {tr('إيقاف فوري لعدم وجود فروع مدفوعة', 'Deactivate Immediately (No Paid Branches)', 'فوری غیر فعال کریں (کوئی ادا شدہ برانچ نہیں)')}
                          </option>
                        )}
                        <option value="suspend">{tr('تعليق إداري للمؤسسة', 'Administrative Suspension', 'انتظامی معطلی')}</option>
                      </select>
                    </div>

                    {statusActionMode === 'reactivate' && !statusSubEval.isFeeExempt && (
                      <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                        <div>
                          <label className="block font-semibold mb-1">{tr('حالة رسوم إعادة التنشيط (10 ر.س)', 'Reactivation Fee (10 SAR)', 'بحالی فیس (10 ریال)')}</label>
                          <select
                            value={reactivationFeeStatus}
                            onChange={(e) => setReactivationFeeStatus(e.target.value as FeePaymentStatus)}
                            className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543]"
                          >
                            <option value="paid">{tr('مدفوعة (10 ر.س)', 'Paid (10 SAR)', 'ادا شدہ (10 ریال)')}</option>
                            <option value="waived">{tr('معفاة', 'Waived', 'معاف')}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block font-semibold mb-1">{tr('تاريخ الدفع', 'Payment Date', 'ادائیگی کی تاریخ')}</label>
                          <input
                            type="date"
                            value={reactivationFeeDateIso}
                            onChange={(e) => setReactivationFeeDateIso(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#122543] font-mono"
                            dir="ltr"
                          />
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              <div>
                <label className="block font-semibold mb-1">{tr('ملاحظة إدارية (اختياري)', 'Admin Note (Optional)', 'انتظامی نوٹ (اختیاری)')}</label>
                <input
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setStatusModalOrg(null)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white font-bold transition-colors">
                  {busyAction
                    ? tr('جاري التنفيذ...', 'Processing...', 'کارروائی جاری ہے...')
                    : tr('تنفيذ', 'Execute', 'نافذ کریں')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Upsert Manager Invite */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base">
                {tr('إصدار / تعديل دعوة مدير', 'Issue / Update Manager Invite', 'مینیجر دعوت نامہ جاری / اپ ڈیٹ کریں')}
              </h2>
              <button type="button" onClick={() => setShowInviteModal(false)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleInviteSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">{tr('المؤسسة المستهدفة *', 'Target Organization *', 'مطلوبہ ادارہ *')}</label>
                <select
                  required
                  value={inviteForm.orgId}
                  onChange={(e) => setInviteForm({ ...inviteForm, orgId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                >
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>{o.name} ({o.id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">{tr('بريد Google للمدير *', 'Manager Google Email *', 'مینیجر کا Google ای میل *')}</label>
                <input
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">{tr('اسم المدير', 'Manager Name', 'مینیجر کا نام')}</label>
                <input
                  value={inviteForm.managerName}
                  onChange={(e) => setInviteForm({ ...inviteForm, managerName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowInviteModal(false)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white font-bold transition-colors">
                  {tr('حفظ الدعوة', 'Save Invite', 'دعوت محفوظ کریں')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Create Branch (Exclusive Super Admin) */}
      {showCreateBranchModal && (() => {
        const selectedBranchOrg = organizations.find((o) => o.id === createBranchForm.orgId);
        const selectedOrgEval = selectedBranchOrg ? evaluateOrganizationSubscription(selectedBranchOrg) : null;
        const selectedOrgFeeExempt = selectedOrgEval?.isFeeExempt === true;
        return (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base">
                {selectedOrgFeeExempt
                  ? tr(
                      'إضافة فرع جديد (معفى — 0 ر.س)',
                      'Add New Branch (Exempt — 0 SAR)',
                      'نئی برانچ شامل کریں (معاف — 0 ریال)'
                    )
                  : tr(
                      `إضافة فرع جديد (${BRANCH_MONTHLY_FEE_SAR} ر.س/شهرياً)`,
                      `Add New Branch (${BRANCH_MONTHLY_FEE_SAR} SAR/mo)`,
                      `نئی برانچ شامل کریں (${BRANCH_MONTHLY_FEE_SAR} ریال/ماہ)`
                    )}
              </h2>
              <button type="button" onClick={() => setShowCreateBranchModal(false)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateBranchSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">{tr('المؤسسة *', 'Organization *', 'ادارہ *')}</label>
                <select
                  required
                  value={createBranchForm.orgId}
                  onChange={(e) => setCreateBranchForm({ ...createBranchForm, orgId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                >
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">{tr('اسم الفرع *', 'Branch Name *', 'برانچ کا نام *')}</label>
                  <input
                    required
                    value={createBranchForm.name}
                    onChange={(e) => setCreateBranchForm({ ...createBranchForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('رمز الفرع', 'Branch Code', 'برانچ کوڈ')}</label>
                  <input
                    value={createBranchForm.code}
                    onChange={(e) => setCreateBranchForm({ ...createBranchForm, code: e.target.value })}
                    placeholder="BR02"
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                    dir="ltr"
                  />
                </div>
                {selectedOrgFeeExempt ? (
                  <div className="col-span-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold">
                    {selectedOrgEval?.isBillingExempt
                      ? tr(
                          'هذه المؤسسة ضمن الإعفاء الدائم الشامل: سيُنشأ الفرع تلقائياً بحالة سداد «معفى» وبرسوم شهرية 0 ر.س دون تاريخ استحقاق.',
                          'This organization has permanent full billing exemption: the branch will be created automatically as Exempt (0 SAR/mo) with no due date.',
                          'اس ادارے کو مستقل مکمل مالی استثنیٰ حاصل ہے: برانچ خودکار طور پر معاف (0 ریال/ماہ) کے طور پر بنائی جائے گی۔'
                        )
                      : tr(
                          'هذه المؤسسة قديمة معفاة: سيُنشأ الفرع تلقائياً بحالة سداد «معفى» وبرسوم شهرية 0 ر.س.',
                          'This is a legacy exempt organization: the branch will be created automatically as Exempt (0 SAR/mo).',
                          'یہ ایک پرانا مستثنیٰ ادارہ ہے: برانچ خودکار طور پر معاف (0 ریال/ماہ) کے طور پر بنائی جائے گی۔'
                        )}
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block font-semibold mb-1">{tr('حالة السداد الأولي', 'Initial Payment Status', 'ابتدائی ادائیگی کی حیثیت')}</label>
                      <select
                        value={createBranchForm.paymentStatus}
                        onChange={(e) =>
                          setCreateBranchForm({ ...createBranchForm, paymentStatus: e.target.value as BranchPaymentStatus })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                      >
                        <option value="paid">{tr('مدفوع (50 ر.س)', 'Paid (50 SAR)', 'ادا شدہ (50 ریال)')}</option>
                        <option value="unpaid">{tr('غير مدفوع', 'Unpaid', 'غیر ادا شدہ')}</option>
                        <option value="exempt">{tr('معفى', 'Exempt', 'مستثنیٰ')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">{tr('تاريخ الاستحقاق القادم', 'Next Due Date', 'اگلی مقررہ تاریخ')}</label>
                      <input
                        type="date"
                        value={createBranchForm.feeDueDateIso}
                        onChange={(e) => setCreateBranchForm({ ...createBranchForm, feeDueDateIso: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                        dir="ltr"
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateBranchModal(false)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white font-bold transition-colors">
                  {tr('إضافة الفرع', 'Add Branch', 'برانچ شامل کریں')}
                </button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}

      {/* MODAL 6: Record Branch Payment (50 SAR) */}
      {paymentModalBranch && (() => {
        const paymentBranchOrg = organizations.find((o) => o.id === paymentModalBranch.orgId);
        const paymentOrgIsBillingExempt = paymentBranchOrg
          ? evaluateOrganizationSubscription(paymentBranchOrg).isBillingExempt
          : false;
        return (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base">
                {tr('تسجيل دفع الفرع:', 'Record Branch Payment:', 'برانچ کی ادائیگی درج کریں:')} {paymentModalBranch.name}
              </h2>
              <button type="button" onClick={() => setPaymentModalBranch(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRecordBranchPaymentSubmit} className="p-6 space-y-4 text-xs">
              {paymentOrgIsBillingExempt ? (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold leading-relaxed">
                  {tr(
                    'المؤسسة المالكة لهذا الفرع معفاة من جميع الرسوم بشكل دائم وشامل: سيتم تثبيت حالة الفرع تلقائياً كـ «معفى» بقيمة 0 ر.س دون فرض أي رسوم.',
                    'This branch belongs to a permanently billing-exempt organization: saving will enforce Exempt status at 0 SAR with no due date.',
                    'یہ برانچ مستقل طور پر معاف ادارے کی ہے: محفوظ کرنے پر حالت خودکار طور پر معاف (0 ریال) رہے گی۔'
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">{tr('حالة الدفع', 'Payment Status', 'ادائیگی کی حیثیت')}</label>
                    <select
                      value={branchPaymentForm.paymentStatus}
                      onChange={(e) =>
                        setBranchPaymentForm({ ...branchPaymentForm, paymentStatus: e.target.value as BranchPaymentStatus })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                    >
                      <option value="paid">{tr('مدفوع', 'Paid', 'ادا شدہ')}</option>
                      <option value="unpaid">{tr('غير مدفوع', 'Unpaid', 'غیر ادا شدہ')}</option>
                      <option value="overdue">{tr('متأخر', 'Overdue', 'واجب الادا')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('القيمة الشهرية (ر.س)', 'Monthly Fee (SAR)', 'ماہانہ فیس (ریال)')}</label>
                    <input
                      type="number"
                      min={0}
                      value={branchPaymentForm.monthlyFeeSar}
                      onChange={(e) =>
                        setBranchPaymentForm({ ...branchPaymentForm, monthlyFeeSar: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('تاريخ السداد', 'Payment Date', 'ادائیگی کی تاریخ')}</label>
                    <input
                      type="date"
                      value={branchPaymentForm.paidDateIso}
                      onChange={(e) => setBranchPaymentForm({ ...branchPaymentForm, paidDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('الاستحقاق القادم', 'Next Due Date', 'اگلی مقررہ تاریخ')}</label>
                    <input
                      type="date"
                      value={branchPaymentForm.feeDueDateIso}
                      onChange={(e) => setBranchPaymentForm({ ...branchPaymentForm, feeDueDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="block font-semibold mb-1">{tr('ملاحظة', 'Note', 'نوٹ')}</label>
                <input
                  value={branchPaymentForm.paymentNote}
                  onChange={(e) => setBranchPaymentForm({ ...branchPaymentForm, paymentNote: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setPaymentModalBranch(null)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white font-bold transition-colors">
                  {tr('حفظ السداد', 'Save Payment', 'ادائیگی محفوظ کریں')}
                </button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}

      {/* MODAL 7: Suspend Branch (Starts 30-Day Grace) */}
      {suspendBranchTarget && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base text-rose-600 dark:text-rose-400">
                {tr('تعليق الفرع:', 'Suspend Branch:', 'برانچ معطل کریں:')} {suspendBranchTarget.name}
              </h2>
              <button type="button" onClick={() => setSuspendBranchTarget(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSuspendBranchSubmit} className="p-6 space-y-4 text-xs">
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                {tr(
                  'عند تعليق الفرع، لا يُحتسب ضمن الفروع المدفوعة وتبدأ مهلة 30 يوماً لا يُسمح خلالها بحذف أي سجل. وإذا لم يتبق للمؤسسة أي فرع مدفوع، تبدأ مهلة 7 أيام لإيقاف المؤسسة.',
                  'Suspending this branch excludes it from paid branches and begins a mandatory 30-day grace period during which no records may be deleted. If no paid branches remain, a 7-day org deactivation grace period starts.',
                  'برانچ معطل ہونے پر اسے ادا شدہ برانچز میں شمار نہیں کیا جائے گا اور 30 دن کی لازمی مہلت شروع ہو گی جس کے دوران کوئی ریکارڈ حذف نہیں ہو سکتا۔ اگر کوئی ادا شدہ برانچ باقی نہ رہے تو ادارے کے لیے 7 دن کی مہلت شروع ہو گی۔'
                )}
              </p>
              <div>
                <label className="block font-semibold mb-1">{tr('سبب التعليق', 'Suspension Reason', 'معطلی کی وجہ')}</label>
                <input
                  value={suspendBranchReason}
                  onChange={(e) => setSuspendBranchReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setSuspendBranchTarget(null)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold">
                  {tr('تأكيد التعليق (مهلة 30 يوماً)', 'Confirm Suspend (30d Grace)', 'معطلی کی تصدیق (30 دن مہلت)')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 8: Reactivate Branch */}
      {reactivateBranchTarget && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base">
                {tr('إعادة تنشيط فرع:', 'Reactivate Branch:', 'برانچ دوبارہ فعال کریں:')} {reactivateBranchTarget.name}
              </h2>
              <button type="button" onClick={() => setReactivateBranchTarget(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleReactivateBranchSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">{tr('حالة السداد', 'Payment Status', 'ادائیگی کی حیثیت')}</label>
                  <select
                    value={reactivateBranchForm.paymentStatus}
                    onChange={(e) =>
                      setReactivateBranchForm({ ...reactivateBranchForm, paymentStatus: e.target.value as BranchPaymentStatus })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  >
                    <option value="paid">{tr('مدفوع (50 ر.س)', 'Paid (50 SAR)', 'ادا شدہ (50 ریال)')}</option>
                    <option value="unpaid">{tr('غير مدفوع', 'Unpaid', 'غیر ادا شدہ')}</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">{tr('الاستحقاق القادم', 'Next Due Date', 'اگلی مقررہ تاریخ')}</label>
                  <input
                    type="date"
                    value={reactivateBranchForm.feeDueDateIso}
                    onChange={(e) => setReactivateBranchForm({ ...reactivateBranchForm, feeDueDateIso: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReactivateBranchTarget(null)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-[#048264] hover:bg-[#036B52] text-white font-bold transition-colors">
                  {tr('إعادة تنشيط الفرع', 'Reactivate Branch', 'برانچ دوبارہ فعال کریں')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 9: Drive Backup Verification & Strict Website-Only DB Purge */}
      {purgeModalBranch && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base text-rose-600 dark:text-rose-400">
                {tr('فحص أرشفة Drive وحذف سجلات DB للفرع:', 'Verify Drive Archive & Purge DB for Branch:', 'Drive آرکائیو جانچ اور DB صفائی برائے برانچ:')} {purgeModalBranch.name}
              </h2>
              <button type="button" onClick={() => setPurgeModalBranch(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 leading-relaxed">
                {tr(
                  'يُحذف هذا الفرع من قاعدة بيانات الموقع (Firestore) فقط (الإقفالات، المشتريات، المرفقات، وسجل الأرشفة). ملفات Google Drive وسجلات التدقيق (auditLogs) لا تُحذف أبداً.',
                  'This purges the branch from the website database (Firestore) only (closings, purchases, attachments, and archive index). Google Drive files and auditLogs are never deleted.',
                  'یہ برانچ صرف ویب سائٹ ڈیٹابیس (Firestore) سے حذف کی جاتی ہے (کلوزنگ، خریداری، منسلکات اور آرکائیو انڈیکس)۔ Google Drive فائلیں اور آڈٹ لاگز کبھی حذف نہیں ہوتے۔'
                )}
              </div>

              {!purgeInspection ? (
                <div className="py-6 text-center text-slate-500 dark:text-slate-400">
                  {tr(
                    'جاري فحص اكتمال النسخ الاحتياطي على Google Drive...',
                    'Inspecting Google Drive backup completeness...',
                    'Google Drive بیک اپ کی تکمیل کی جانچ ہو رہی ہے...'
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div
                    className={`p-3.5 rounded-xl border ${
                      purgeInspection.verified
                        ? 'bg-[#08C99B]/10 border-[#08C99B]/30 text-[#048264] dark:text-[#08C99B]'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    <div className="font-bold mb-1">
                      {purgeInspection.verified
                        ? tr('تم التحقق بنجاح — جاهز للتنظيف', 'Verification Passed — Ready to Purge', 'تصدیق کامیاب — صفائی کے لیے تیار')
                        : tr('تم منع الحذف (فشل التحقق)', 'Purge Blocked (Verification Failed)', 'حذف روک دیا گیا (تصدیق ناکام)')}
                    </div>
                    <p>{purgeInspection.reason}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] font-mono tabular-nums">
                    <div>{tr('الإقفالات الكلية:', 'Total Closings:', 'کل کلوزنگ:')} {purgeInspection.totalClosingsCount}</div>
                    <div>{tr('الإقفالات المعتمدة:', 'Approved Closings:', 'منظور شدہ کلوزنگ:')} {purgeInspection.approvedClosingsCount}</div>
                    <div>{tr('مؤرشفة بالكامل:', 'Verified Archived:', 'تصدیق شدہ آرکائیو:')} {purgeInspection.verifiedArchivedCount}</div>
                    <div>{tr('قيد المراجعة:', 'Pending Review:', 'جائزے کے تحت:')} {purgeInspection.unapprovedPendingCount}</div>
                    <div>{tr('المشتريات:', 'Purchases:', 'خریداری:')} {purgeInspection.purchasesCount}</div>
                    <div>{tr('المرفقات:', 'Attachments:', 'منسلکات:')} {purgeInspection.attachmentsCount}</div>
                  </div>

                  {purgeInspection.verified && (
                    <div>
                      <label className="block font-semibold mb-1">
                        {tr('اكتب', 'Type', 'لکھیں')}{' '}
                        <span className="font-mono font-bold text-rose-500">DELETE_DB_ONLY</span>{' '}
                        {tr('لتأكيد التنظيف النهائي:', 'to confirm final DB purge:', 'حتمی DB صفائی کی تصدیق کے لیے:')}
                      </label>
                      <input
                        value={purgeConfirmText}
                        onChange={(e) => setPurgeConfirmText(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                        dir="ltr"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setPurgeModalBranch(null)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                  {tr('إغلاق', 'Close', 'بند کریں')}
                </button>
                {purgeInspection?.verified && (
                  <button
                    type="button"
                    disabled={busyAction || purgeConfirmText.trim() !== 'DELETE_DB_ONLY'}
                    onClick={handleExecuteBranchDbPurge}
                    className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold disabled:opacity-40"
                  >
                    {tr('حذف سجلات الفرع من DB فقط', 'Purge Branch Records from DB Only', 'برانچ ریکارڈز صرف DB سے حذف کریں')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 10: Organization Details Drawer */}
      {selectedOrg && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-[#0B1B32] dark:text-white truncate">{selectedOrg.name}</h2>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                  {selectedOrg.id} · {selectedOrg.ownerEmail}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrgId(null)}
                className="p-2 rounded-xl text-slate-500 hover:bg-[#F5F8FF] dark:hover:bg-[#173056]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 pt-3 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDetailTab('branches')}
                className={`px-3 py-2 text-xs font-bold border-b-2 ${
                  detailTab === 'branches' ? 'border-[#1764FF] text-[#1764FF] dark:text-[#6CA2FF]' : 'border-transparent text-slate-500'
                }`}
              >
                {tr('الفروع', 'Branches', 'برانچز')} ({selectedOrgBranches.length})
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('users')}
                className={`px-3 py-2 text-xs font-bold border-b-2 ${
                  detailTab === 'users' ? 'border-[#1764FF] text-[#1764FF] dark:text-[#6CA2FF]' : 'border-transparent text-slate-500'
                }`}
              >
                {tr('المستخدمون', 'Users', 'صارفین')} ({selectedOrgUsers.length})
              </button>
              {inviteByOrgId.get(selectedOrg.id) && (
                <span className="ms-auto text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                  Invite: {inviteByOrgId.get(selectedOrg.id)?.status}
                </span>
              )}
            </div>

            <div className="p-6 overflow-y-auto space-y-3 text-xs">
              {detailTab === 'branches' ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-slate-500 dark:text-slate-400">
                      {tr(
                        'إدارة الإعفاء الفردي أو الجماعي لفروع المؤسسة مع الحفاظ على سجل المدفوعات التاريخي.',
                        'Manage individual or bulk branch exemptions while preserving historical payments.',
                        'تاریخی ادائیگیوں کو محفوظ رکھتے ہوئے انفرادی یا اجتماعی برانچ استثنیٰ کا انتظام کریں۔'
                      )}
                    </span>
                    {selectedOrgBranches.some((b) => b.lifecycleStatus !== 'purged_from_db' && b.billingExempt !== true) && (
                      <button
                        type="button"
                        onClick={() => openBulkBranchesExemptionModal(selectedOrg)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>{tr('إعفاء جميع فروع المؤسسة', 'Exempt All Org Branches', 'تمام برانچز مستثنیٰ کریں')}</span>
                      </button>
                    )}
                  </div>
                  {selectedOrgBranches.map((b) => {
                    const evalB = evaluateBranchBillingAndGrace(b, selectedOrg);
                    return (
                      <div key={b.id} className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-[#0B1B32] dark:text-white flex items-center gap-2">
                            <span>{b.name} ({b.code})</span>
                            {evalB.exemptionSource !== 'none' && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px]">
                                {evalB.exemptionSource === 'both'
                                  ? tr('المؤسسة + الفرع', 'Org + Branch', 'ادارہ + برانچ')
                                  : evalB.exemptionSource === 'organization'
                                  ? tr('إعفاء المؤسسة', 'Org Exemption', 'ادارہ استثنیٰ')
                                  : tr('إعفاء الفرع', 'Branch Exemption', 'برانچ استثنیٰ')}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {tr('الاستحقاق:', 'Due:', 'مقررہ تاریخ:')} {formatShortDate(evalB.feeDueAt)} · {evalB.monthlyFeeSar} {tr('ر.س/ش', 'SAR/mo', 'ریال/ماہ')} ({evalB.paymentStatus})
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!evalB.isPurgedFromDb && (
                            <button
                              type="button"
                              onClick={() => openBranchExemptionModal(b)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-emerald-500 text-emerald-700 dark:text-emerald-300"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>
                                {b.billingExempt === true
                                  ? tr('إدارة الإعفاء', 'Manage Exemption', 'استثنیٰ انتظام')
                                  : tr('إعفاء الفرع', 'Exempt Branch', 'برانچ مستثنیٰ')}
                              </span>
                            </button>
                          )}
                          <span className="text-[11px] font-bold">
                            {evalB.isPurgedFromDb
                              ? tr('منظف', 'Purged', 'صاف شدہ')
                              : evalB.isSuspended
                              ? tr('معلق', 'Suspended', 'معطل')
                              : tr('نشط', 'Active', 'فعال')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-slate-500 dark:text-slate-400">
                      {tr(
                        'إدارة أعضاء المؤسسة (مسؤول، مسؤول فرع، موظف) دون حذف أي حساب أو تعديل مدير المؤسسة.',
                        'Manage organization operational members without deleting accounts or altering the manager.',
                        'مینیجر یا صارف حذف کیے بغیر ادارے کے اراکین کا انتظام کریں۔'
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => openCreateMemberModal(selectedOrg.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#1764FF] text-white hover:bg-[#1052D8]"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{tr('إضافة عضو للمؤسسة', 'Add Org Member', 'رکن شامل کریں')}</span>
                    </button>
                  </div>
                  {selectedOrgUsers.map((u) => {
                    const editable = canManageMember(u);
                    const isArchived = u.isArchived === true || u.isActive === false;
                    return (
                      <div key={u.uid} className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-[#0B1B32] dark:text-white">{u.displayName}</div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400" dir="ltr">{u.email}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {getUserRoleLabel(u.role, language)} ·{' '}
                            {u.branchName || (u.branchId ? branchMap.get(u.branchId)?.name : '') || tr('نطاق المؤسسة', 'Org-wide', 'مکمل ادارہ')} ·{' '}
                            {isArchived ? tr('مؤرشف/معطل', 'Archived/Disabled', 'آرکائیو/معطل') : tr('نشط', 'Active', 'فعال')}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {editable ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditMemberModal(u)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] hover:text-[#1764FF]"
                              >
                                {tr('تعديل', 'Edit', 'ترمیم')}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openMemberLifecycleModal(u, isArchived ? 'reactivate' : 'archive')
                                }
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                                  isArchived
                                    ? 'bg-[#08C99B]/15 text-[#048264] dark:text-[#08C99B]'
                                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {isArchived
                                  ? tr('إعادة تفعيل', 'Reactivate', 'دوبارہ فعال')
                                  : tr('أرشفة', 'Archive', 'آرکائیو')}
                              </button>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-200/70 dark:bg-[#122543] text-[10px] text-slate-500">
                              <Lock className="w-3 h-3" />
                              <span>{tr('محمي', 'Protected', 'محفوظ')}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 11: Official Permanent Organization Exemption (legacy_unrestricted & billing_exempt) */}
      {exemptionModalOrg && (() => {
        const isCurrentlyExempt = exemptionModalOrg.billingExempt === true;
        const orgBranches = branchesByOrg.get(exemptionModalOrg.id) || [];
        const precheck = verifyOrganizationExemptionEligibility({
          org: exemptionModalOrg,
          users: allUsers,
          branches: orgBranches,
          expectedOwnerEmail: exemptionModalOrg.ownerEmail,
          targetMode: orgExemptionMode,
        });
        const canSubmit =
          !busyAction &&
          exemptionConfirmed &&
          exemptionReason.trim().length >= 5 &&
          (isCurrentlyExempt || precheck.eligible);

        return (
          <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden my-8">
              <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
                <h2 className="font-bold text-base flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    {isCurrentlyExempt
                      ? tr('إدارة / إلغاء الإعفاء الدائم للمؤسسة', 'Manage / Revoke Org Exemption', 'ادارے کا مستقل استثنیٰ انتظام/منسوخ')
                      : tr('منح إعفاء دائم شامل للمؤسسة', 'Grant Permanent Org Exemption', 'ادارے کو مستقل مکمل استثنیٰ دیں')}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={() => setExemptionModalOrg(null)}
                  className="p-1.5 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleBillingExemptionSubmit} className="p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
                <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('المؤسسة:', 'Organization:', 'ادارہ:')}</span>
                    <span className="font-bold text-[#0B1B32] dark:text-white">{exemptionModalOrg.name}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('معرّف المؤسسة / المالك:', 'Org ID / Owner UID:', 'ادارہ / مالک آئی ڈی:')}</span>
                    <span className="font-mono text-[11px]" dir="ltr">
                      {exemptionModalOrg.id} · {exemptionModalOrg.ownerId || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('بريد المالك:', 'Owner Email:', 'مالک ای میل:')}</span>
                    <span className="font-mono text-[11px]" dir="ltr">{exemptionModalOrg.ownerEmail || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('الفروع المشمولة حالياً:', 'Covered Branches:', 'شامل برانچز:')}</span>
                    <span className="font-mono font-bold">
                      {precheck.branchesInventory.totalBranchesCount} ({tr('نشطة:', 'active:', 'فعال:')} {precheck.branchesInventory.activeBranchesCount})
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('الحالة الحالية:', 'Current Mode:', 'موجودہ حالت:')}</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">
                      {isCurrentlyExempt
                        ? exemptionModalOrg.billingExemptMode || 'billing_exempt'
                        : precheck.currentSubscriptionState || 'standard'}
                    </span>
                  </div>
                  {exemptionModalOrg.billingExemptGrantedAt && (
                    <div className="pt-1.5 border-t border-[#DCE6FA] dark:border-[#1F3B66] text-[11px] text-slate-600 dark:text-slate-300">
                      {tr('تاريخ آخر منح:', 'Last Granted:', 'آخری منظوری:')} {formatShortDate(exemptionModalOrg.billingExemptGrantedAt)} · {exemptionModalOrg.billingExemptGrantedBy || SUPER_ADMIN_EMAIL}
                      {exemptionModalOrg.billingExemptReason && (
                        <div className="text-slate-500 mt-0.5">{tr('السبب السابق:', 'Grant Reason:', 'وجہ:')} {exemptionModalOrg.billingExemptReason}</div>
                      )}
                    </div>
                  )}
                  {exemptionModalOrg.billingExemptRevokedAt && (
                    <div className="pt-1.5 border-t border-[#DCE6FA] dark:border-[#1F3B66] text-[11px] text-amber-700 dark:text-amber-300">
                      {tr('سجل إلغاء سابق:', 'Previous Revocation:', 'سابقہ منسوخی:')} {formatShortDate(exemptionModalOrg.billingExemptRevokedAt)} · {exemptionModalOrg.billingExemptRevokedBy || '—'}
                      {exemptionModalOrg.billingExemptRevokeReason && (
                        <div className="mt-0.5">{exemptionModalOrg.billingExemptRevokeReason}</div>
                      )}
                    </div>
                  )}
                </div>

                {!isCurrentlyExempt && (
                  <>
                    <div className="space-y-1.5">
                      <div className="font-bold text-[#0B1B32] dark:text-white">
                        {tr('نتيجة الفحص الأمني قبل المنح (7 نقاط تحقق):', 'Pre-Grant Security Verification (7 Checks):', 'منظوری سے قبل سکیورٹی جانچ:')}
                      </div>
                      <div className="space-y-1 max-h-44 overflow-y-auto p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                        {precheck.checks.map((chk) => (
                          <div key={chk.key} className="flex items-start gap-2 text-[11px]">
                            {chk.passed ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <span className="font-bold">{chk.labelAr}:</span>{' '}
                              <span className={chk.passed ? 'text-slate-600 dark:text-slate-300' : 'text-rose-600 dark:text-rose-400 font-semibold'}>
                                {chk.detailAr}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold mb-1">
                        {tr('تصنيف الإعفاء الدائم للمؤسسة *', 'Permanent Exemption Classification *', 'مستقل استثنیٰ کی درجہ بندی *')}
                      </label>
                      <select
                        value={orgExemptionMode}
                        onChange={(e) => setOrgExemptionMode(e.target.value as ExemptionClassification)}
                        className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-semibold"
                      >
                        <option value="legacy_unrestricted">
                          {tr(
                            'legacy_unrestricted — إعفاء قديم/غير مقيد دائم (قابل للإلغاء لاحقاً)',
                            'legacy_unrestricted — Permanent Unrestricted Exemption (Revocable)',
                            'legacy_unrestricted — مستقل غیر محدود استثنیٰ'
                          )}
                        </option>
                        <option value="billing_exempt">
                          {tr(
                            'billing_exempt — إعفاء مالي دائم شامل (0 ر.س لجميع الرسوم والفروع)',
                            'billing_exempt — Permanent Full Billing Exemption (0 SAR all fees & branches)',
                            'billing_exempt — مستقل مکمل مالی استثنیٰ'
                          )}
                        </option>
                      </select>
                    </div>
                  </>
                )}

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-slate-700 dark:text-slate-200 leading-relaxed">
                  {isCurrentlyExempt
                    ? tr(
                        'يُلغي هذا الإجراء الإعفاء الصريح ويعيد المؤسسة لنظام الرسوم القياسي دون حذف أي بيانات اشتراكات أو فواتير تاريخية، مع تسجيل ذري في platformAuditLogs.',
                        'Revoking restores standard billing immediately without deleting historical subscription or invoice data, atomically logged in platformAuditLogs.',
                        'منسوخی سے ادارہ تاریخی ڈیٹا حذف کیے بغیر معمول کے بلنگ نظام پر واپس آ جاتا ہے۔'
                      )
                    : tr(
                        'يشمل الإعفاء رسوم الاشتراك والتأسيس وإعادة التنشيط وجميع الفروع الحالية والمستقبلية (0 ر.س) مع الاحتفاظ الكامل بكافة السجلات التاريخية دون حذف أو تصفير.',
                        'Covers current & future subscription, setup, reactivation, and branch fees (0 SAR) while preserving 100% of historical records untouched.',
                        'یہ استثنیٰ تمام موجودہ اور مستقبل کی فیسوں (0 ریال) کا احاطہ کرتا ہے اور تاریخی ریکارڈز محفوظ رہتے ہیں۔'
                      )}
                </div>

                <div>
                  <label className="block font-semibold mb-1">
                    {isCurrentlyExempt
                      ? tr('سبب إلغاء الإعفاء الدائم * (5 أحرف على الأقل)', 'Revocation Reason * (min 5 chars)', 'منسوخی کی وجہ *')
                      : tr('سبب منح الإعفاء الدائم * (5 أحرف على الأقل)', 'Exemption Reason * (min 5 chars)', 'استثنیٰ کی وجہ *')}
                  </label>
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    rows={3}
                    value={exemptionReason}
                    onChange={(e) => setExemptionReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] outline-none focus:border-[#1764FF]"
                  />
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exemptionConfirmed}
                    onChange={(e) => setExemptionConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    {isCurrentlyExempt
                      ? tr(
                          'أؤكد مراجعة تفاصيل المؤسسة والموافقة على إلغاء الإعفاء الدائم وتوثيقه في سجل المنصة.',
                          'I confirm revoking this permanent exemption and recording an immutable audit entry.',
                          'میں اس مستقل استثنیٰ کی منسوخی اور آڈٹ لاگ اندراج کی تصدیق کرتا ہوں۔'
                        )
                      : tr(
                          `أؤكد التحقق من هوية المؤسسة والمالك والموافقة على اعتماد الإعفاء (${orgExemptionMode}) وتوثيقه ذرياً.`,
                          `I confirm verifying the organization & owner and granting (${orgExemptionMode}) with an atomic audit entry.`,
                          `میں ادارے اور مالک کی تصدیق کے بعد استثنیٰ (${orgExemptionMode}) کی منظوری کی تصدیق کرتا ہوں۔`
                        )}
                  </span>
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setExemptionModalOrg(null)}
                    className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold"
                  >
                    {tr('إغلاق', 'Close', 'بند کریں')}
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className={`px-5 py-2 rounded-xl text-white font-bold disabled:opacity-50 transition-colors ${
                      isCurrentlyExempt
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {busyAction
                      ? tr('جاري التنفيذ...', 'Processing...', 'جاری ہے...')
                      : isCurrentlyExempt
                      ? tr('تأكيد إلغاء الإعفاء الدائم', 'Confirm Revoke Exemption', 'استثنیٰ منسوخ کریں')
                      : tr('اعتماد الإعفاء الدائم', 'Confirm Grant Exemption', 'مستقل استثنیٰ منظور کریں')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL 12: Individual Branch Exemption (Grant / Revoke) */}
      {branchExemptionModalTarget && (() => {
        const parentOrg = orgMap.get(branchExemptionModalTarget.orgId);
        const evalB = evaluateBranchBillingAndGrace(branchExemptionModalTarget, parentOrg);
        const precheck = parentOrg
          ? verifyBranchExemptionEligibility({ branch: branchExemptionModalTarget, org: parentOrg })
          : null;
        const isIndividuallyExempt =
          branchExemptionModalTarget.billingExempt === true ||
          branchExemptionModalTarget.paymentStatus === 'exempt';
        const canSubmit =
          !busyAction &&
          branchExemptionConfirmed &&
          branchExemptionReason.trim().length >= 5 &&
          (isIndividuallyExempt || Boolean(precheck?.eligible));

        return (
          <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-8">
              <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
                <h2 className="font-bold text-base flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    {isIndividuallyExempt
                      ? tr('إدارة / إلغاء الإعفاء الفردي للفرع', 'Manage / Revoke Branch Exemption', 'برانچ استثنیٰ انتظام/منسوخ')
                      : tr('منح إعفاء دائم للفرع', 'Grant Permanent Branch Exemption', 'برانچ کو مستقل استثنیٰ دیں')}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={() => setBranchExemptionModalTarget(null)}
                  className="p-1.5 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleBranchExemptionSubmit} className="p-6 space-y-4 text-xs">
                <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('الفرع:', 'Branch:', 'برانچ:')}</span>
                    <span className="font-bold">{branchExemptionModalTarget.name} ({branchExemptionModalTarget.code})</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('المؤسسة الأم:', 'Parent Organization:', 'ادارہ:')}</span>
                    <span className="font-semibold">{parentOrg?.name || branchExemptionModalTarget.orgId}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('مصدر الإعفاء الحالي:', 'Current Exemption Source:', 'استثنیٰ کا ذریعہ:')}</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">
                      {evalB.exemptionSource === 'both'
                        ? tr('المؤسسة + الفرع معاً', 'Both Org & Branch', 'ادارہ + برانچ')
                        : evalB.exemptionSource === 'organization'
                        ? tr('موروث من المؤسسة الأم', 'Inherited from Organization', 'ادارے سے وراثتی')
                        : evalB.exemptionSource === 'branch'
                        ? tr('إعفاء فردي للفرع', 'Individual Branch Exemption', 'انفرادی برانچ استثنیٰ')
                        : tr('غير معفى', 'Not Exempt', 'مستثنیٰ نہیں')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('سجل الدفع التاريخي (محفوظ):', 'Historical Payment (Preserved):', 'تاریخی ادائیگی (محفوظ):')}</span>
                    <span className="font-mono">
                      {tr('آخر دفع:', 'Last paid:', 'آخری ادائیگی:')} {formatShortDate(branchExemptionModalTarget.lastPaidAt)}
                    </span>
                  </div>
                  {branchExemptionModalTarget.exemptGrantedAt && (
                    <div className="pt-1 border-t border-[#DCE6FA] dark:border-[#1F3B66] text-[11px] text-slate-600 dark:text-slate-300">
                      {tr('تاريخ منح الإعفاء:', 'Granted At:', 'منظوری کی تاریخ:')} {formatShortDate(branchExemptionModalTarget.exemptGrantedAt)} · {branchExemptionModalTarget.exemptGrantedBy || SUPER_ADMIN_EMAIL}
                    </div>
                  )}
                </div>

                {isIndividuallyExempt && precheck?.parentOrgIsFeeExempt && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 leading-relaxed font-semibold">
                    {tr(
                      'تنبيه مهم: المؤسسة الأم نفسها معفاة من الرسوم؛ إلغاء الإعفاء الفردي لهذا الفرع لن يلغي إعفاء المؤسسة الأم الموروث وسيبقى الفرع معفى طالما المؤسسة معفاة.',
                      'Important: The parent organization is also fee-exempt. Revoking this branch individual exemption will NOT cancel the inherited organization exemption.',
                      'اہم نوٹ: ادارہ بذات خود مستثنیٰ ہے۔ اس برانچ کا انفرادی استثنیٰ منسوخ کرنے سے ادارے کا استثنیٰ منسوخ نہیں ہوگا۔'
                    )}
                  </div>
                )}

                {!isIndividuallyExempt ? (
                  <div>
                    <label className="block font-semibold mb-1">{tr('تصنيف إعفاء الفرع *', 'Branch Exemption Mode *', 'برانچ استثنیٰ کی قسم *')}</label>
                    <select
                      value={branchExemptionMode}
                      onChange={(e) => setBranchExemptionMode(e.target.value as ExemptionClassification)}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-semibold"
                    >
                      <option value="billing_exempt">{tr('billing_exempt — إعفاء مالي دائم (0 ر.س)', 'billing_exempt — Permanent Billing Exempt (0 SAR)', 'billing_exempt — مستقل مالی استثنیٰ')}</option>
                      <option value="legacy_unrestricted">{tr('legacy_unrestricted — إعفاء غير مقيد دائم', 'legacy_unrestricted — Permanent Unrestricted Exempt', 'legacy_unrestricted — غیر محدود استثنیٰ')}</option>
                    </select>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">{tr('حالة السداد بعد الإلغاء', 'Status After Revoke', 'منسوخی کے بعد حیثیت')}</label>
                      <select
                        value={branchExemptionRestoredStatus}
                        onChange={(e) =>
                          setBranchExemptionRestoredStatus(
                            e.target.value as Exclude<BranchPaymentStatus, 'exempt'>
                          )
                        }
                        className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                      >
                        <option value="unpaid">{tr('غير مدفوع', 'Unpaid', 'غیر ادا شدہ')}</option>
                        <option value="paid">{tr('مدفوع', 'Paid', 'ادا شدہ')}</option>
                        <option value="overdue">{tr('متأخر', 'Overdue', 'واجب الادا')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">{tr('الرسوم الشهرية المستعادة (ر.س)', 'Restored Monthly Fee (SAR)', 'بحال شدہ ماہانہ فیس')}</label>
                      <input
                        type="number"
                        min={0}
                        value={branchExemptionRestoredFeeSar}
                        onChange={(e) => setBranchExemptionRestoredFeeSar(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                        dir="ltr"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block font-semibold mb-1">
                    {isIndividuallyExempt
                      ? tr('سبب إلغاء إعفاء الفرع * (5 أحرف على الأقل)', 'Revocation Reason * (min 5 chars)', 'منسوخی کی وجہ *')
                      : tr('سبب منح إعفاء الفرع * (5 أحرف على الأقل)', 'Exemption Reason * (min 5 chars)', 'استثنیٰ کی وجہ *')}
                  </label>
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    rows={3}
                    value={branchExemptionReason}
                    onChange={(e) => setBranchExemptionReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  />
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={branchExemptionConfirmed}
                    onChange={(e) => setBranchExemptionConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    {isIndividuallyExempt
                      ? tr('أؤكد إلغاء الإعفاء الفردي للفرع مع الاحتفاظ بكامل سجل المنح والمدفوعات التاريخي.', 'I confirm revoking this branch exemption while preserving full payment & grant history.', 'میں تاریخی ریکارڈ محفوظ رکھتے ہوئے برانچ استثنیٰ منسوخ کرنے کی تصدیق کرتا ہوں۔')
                      : tr('أؤكد منح إعفاء دائم لهذا الفرع (0 ر.س) وتوثيقه ذرياً في سجل المنصة.', 'I confirm granting permanent exemption (0 SAR) to this branch with an atomic audit log.', 'میں اس برانچ کو مستقل استثنیٰ (0 ریال) دینے کی تصدیق کرتا ہوں۔')}
                  </span>
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setBranchExemptionModalTarget(null)}
                    className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold"
                  >
                    {tr('إغلاق', 'Close', 'بند کریں')}
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className={`px-5 py-2 rounded-xl text-white font-bold disabled:opacity-50 ${
                      isIndividuallyExempt
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {busyAction
                      ? tr('جاري التنفيذ...', 'Processing...', 'جاری ہے...')
                      : isIndividuallyExempt
                      ? tr('تأكيد إلغاء إعفاء الفرع', 'Confirm Revoke Branch Exemption', 'برانچ استثنیٰ منسوخ کریں')
                      : tr('اعتماد إعفاء الفرع الدائم', 'Confirm Grant Branch Exemption', 'برانچ استثنیٰ منظور کریں')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL 13: Bulk All-Branches Exemption for an Organization */}
      {bulkBranchExemptionOrg && (() => {
        const orgBranches = branchesByOrg.get(bulkBranchExemptionOrg.id) || [];
        const eligibleBranches = orgBranches.filter(
          (b) =>
            b.lifecycleStatus !== 'purged_from_db' &&
            !(b.billingExempt === true && (b.billingExemptMode || 'billing_exempt') === bulkBranchExemptionMode)
        );
        const canSubmit =
          !busyAction &&
          bulkBranchExemptionConfirmed &&
          bulkBranchExemptionReason.trim().length >= 5 &&
          eligibleBranches.length > 0;

        return (
          <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-8">
              <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
                <h2 className="font-bold text-base flex items-center gap-2">
                  <Layers className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span>{tr('إعفاء جماعي لجميع فروع المؤسسة', 'Bulk Exempt All Organization Branches', 'ادارے کی تمام برانچز کا اجتماعی استثنیٰ')}</span>
                </h2>
                <button type="button" onClick={() => setBulkBranchExemptionOrg(null)} className="p-1.5 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleBulkBranchesExemptionSubmit} className="p-6 space-y-4 text-xs">
                <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1.5">
                  <div className="font-bold text-[#0B1B32] dark:text-white">{bulkBranchExemptionOrg.name}</div>
                  <div className="text-slate-600 dark:text-slate-300">
                    {tr('الفروع المؤهلة للإعفاء الآن:', 'Eligible branches to exempt now:', 'مستثنیٰ کے اہل برانچز:')}{' '}
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">{eligibleBranches.length}</span>
                  </div>
                  {eligibleBranches.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {eligibleBranches.map((b) => (
                        <span
                          key={b.id}
                          className="px-2 py-0.5 rounded bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-[11px]"
                        >
                          {b.name} ({b.code})
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-semibold mb-1">{tr('تصنيف الإعفاء الجماعي *', 'Bulk Exemption Mode *', 'اجتماعی استثنیٰ کی قسم *')}</label>
                  <select
                    value={bulkBranchExemptionMode}
                    onChange={(e) => setBulkBranchExemptionMode(e.target.value as ExemptionClassification)}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-semibold"
                  >
                    <option value="billing_exempt">{tr('billing_exempt — إعفاء مالي دائم (0 ر.س)', 'billing_exempt — Permanent Billing Exempt (0 SAR)', 'billing_exempt — مستقل مالی استثنیٰ')}</option>
                    <option value="legacy_unrestricted">{tr('legacy_unrestricted — إعفاء غير مقيد دائم', 'legacy_unrestricted — Permanent Unrestricted Exempt', 'legacy_unrestricted — غیر محدود استثنیٰ')}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1">{tr('سبب الإعفاء الجماعي * (5 أحرف على الأقل)', 'Bulk Exemption Reason * (min 5 chars)', 'اجتماعی استثنیٰ کی وجہ *')}</label>
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    rows={3}
                    value={bulkBranchExemptionReason}
                    onChange={(e) => setBulkBranchExemptionReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  />
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bulkBranchExemptionConfirmed}
                    onChange={(e) => setBulkBranchExemptionConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    {tr(
                      `أؤكد إعفاء عدد (${eligibleBranches.length}) فرعاً بشكل دائم مع حفظ سجلات الدفع التاريخية وتوثيق العملية ذرياً في platformAuditLogs.`,
                      `I confirm exempting (${eligibleBranches.length}) branches permanently while preserving historical payment data with atomic audit logging.`,
                      `میں (${eligibleBranches.length}) برانچز کو مستقل استثنیٰ دینے کی تصدیق کرتا ہوں۔`
                    )}
                  </span>
                </label>

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setBulkBranchExemptionOrg(null)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                    {tr('إغلاق', 'Close', 'بند کریں')}
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50"
                  >
                    {busyAction
                      ? tr('جاري التنفيذ...', 'Processing...', 'جاری ہے...')
                      : tr('تنفيذ الإعفاء الجماعي', 'Confirm Bulk Exemption', 'اجتماعی استثنیٰ نافذ کریں')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL 14: Add Organization Member (Operational Roles Only via getSecondaryAuth) */}
      {showCreateMemberModal && (() => {
        const selectedOrgBranchesForCreate = (branchesByOrg.get(createMemberForm.orgId) || []).filter(
          (b) => b.lifecycleStatus !== 'purged_from_db'
        );
        const needsBranch =
          createMemberForm.role === 'branch_manager' || createMemberForm.role === 'employee';
        return (
          <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden my-8">
              <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
                <h2 className="font-bold text-base flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>{tr('إضافة عضو جديد لمؤسسة', 'Add New Organization Member', 'ادارے میں نیا رکن شامل کریں')}</span>
                </h2>
                <button type="button" onClick={() => setShowCreateMemberModal(false)} className="p-1.5 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleCreateMemberSubmit} className="p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
                <div className="p-3 rounded-xl bg-[#1764FF]/8 border border-[#1764FF]/25 text-slate-700 dark:text-slate-200 leading-relaxed space-y-1.5">
                  <p>
                    {tr(
                      'ملاحظة تقنية وأمنية: يُنشأ حساب العضو عبر البريد وكلمة المرور دون إنهاء جلستك الحالية، وللأدوار التشغيلية فقط (مسؤول، مسؤول فرع، موظف). أما حسابات Google القائمة مسبقاً فلا يمكن إنشاء حساب Google لها أو تخمين معرّفها (UID) وتُربط عبر آلية الدعوات الآمنة فقط.',
                      'Security Note: Member accounts are created via email/password without interrupting your Super Admin session, strictly for operational roles (supervisor, branch_manager, employee). Existing Google accounts cannot be created or have UIDs guessed and must be linked via secure invitations.',
                      'سکیورٹی نوٹ: یہاں صرف ای میل/پاس ورڈ کے ذریعے آپریشنل اراکین بنائے جاتے ہیں۔ موجودہ Google اکاؤنٹس کو محفوظ دعوت کے ذریعے منسلک کیا جاتا ہے۔'
                    )}
                  </p>
                  <p className="text-[11px] opacity-90">
                    {tr(
                      'تنبيه مهم: نوع مزوّد الدخول الفعلي للحساب (البريد وكلمة المرور هنا) هو الذي يحدد طريقة تسجيل دخول العضو، وليس مجرد كون البريد من Gmail أو غيره.',
                      'Sign-in note: The actual sign-in provider configured for the account (Email/Password here) determines how the member signs in—not merely whether the email is a Gmail address.',
                      'لاگ ان نوٹ: اکاؤنٹ کا اصل تصدیقی فراہم کنندہ (یہاں ای میل اور پاس ورڈ) طے کرتا ہے کہ رکن کیسے لاگ ان ہوگا، نہ کہ صرف یہ کہ ای میل Gmail ہے۔'
                    )}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">{tr('المؤسسة *', 'Organization *', 'ادارہ *')}</label>
                    <select
                      required
                      value={createMemberForm.orgId}
                      onChange={(e) => {
                        const nextOrgId = e.target.value;
                        const firstB = (branchesByOrg.get(nextOrgId) || []).find(
                          (b) => b.lifecycleStatus !== 'purged_from_db'
                        );
                        setCreateMemberForm({
                          ...createMemberForm,
                          orgId: nextOrgId,
                          branchId: firstB?.id || '',
                        });
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                    >
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">{tr('الدور التشغيلي *', 'Operational Role *', 'آپریشنل کردار *')}</label>
                    <select
                      value={createMemberForm.role}
                      onChange={(e) =>
                        setCreateMemberForm({
                          ...createMemberForm,
                          role: e.target.value as SuperAdminAssignableMemberRole,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                    >
                      {ALLOWED_SUPER_ADMIN_MEMBER_ROLES.map((roleOpt) => (
                        <option key={roleOpt} value={roleOpt}>
                          {getUserRoleLabel(roleOpt, language)} ({roleOpt})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">{tr('اسم العضو *', 'Member Name *', 'رکن کا نام *')}</label>
                    <input
                      required
                      value={createMemberForm.displayName}
                      onChange={(e) => setCreateMemberForm({ ...createMemberForm, displayName: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">{tr('البريد الإلكتروني *', 'Email *', 'ای میل *')}</label>
                    <input
                      type="email"
                      required
                      dir="ltr"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="email"
                      value={createMemberForm.email}
                      onChange={(e) => setCreateMemberForm({ ...createMemberForm, email: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">{tr('كلمة المرور * (6 أحرف+)', 'Password * (6+ chars)', 'پاس ورڈ *')}</label>
                    <div className="relative">
                      <input
                        type={showCreateMemberPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        dir="ltr"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        autoComplete="new-password"
                        value={createMemberForm.password}
                        onChange={(e) => setCreateMemberForm({ ...createMemberForm, password: e.target.value })}
                        className="w-full ps-3 pe-9 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCreateMemberPassword((prev) => !prev)}
                        aria-label={showCreateMemberPassword ? t('authHidePassword') : t('authShowPassword')}
                        className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-[#0B1B32] dark:hover:text-white"
                      >
                        {showCreateMemberPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">{tr('تأكيد كلمة المرور *', 'Confirm Password *', 'پاس ورڈ کی تصدیق *')}</label>
                    <div className="relative">
                      <input
                        type={showCreateMemberConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        dir="ltr"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        autoComplete="new-password"
                        value={createMemberForm.confirmPassword}
                        onChange={(e) =>
                          setCreateMemberForm({ ...createMemberForm, confirmPassword: e.target.value })
                        }
                        className="w-full ps-3 pe-9 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCreateMemberConfirmPassword((prev) => !prev)}
                        aria-label={showCreateMemberConfirmPassword ? t('authHidePassword') : t('authShowPassword')}
                        className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-[#0B1B32] dark:hover:text-white"
                      >
                        {showCreateMemberConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-semibold mb-1">{tr('رقم الجوال (اختياري)', 'Phone (Optional)', 'فون نمبر (اختیاری)')}</label>
                    <input
                      value={createMemberForm.phone}
                      onChange={(e) => setCreateMemberForm({ ...createMemberForm, phone: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>

                {needsBranch && (
                  <div>
                    <label className="block font-semibold mb-1">
                      {tr('الفرع المعيّن (من نفس المؤسسة فقط) *', 'Assigned Branch (Same Org Only) *', 'متعین برانچ (صرف اسی ادارے سے) *')}
                    </label>
                    <select
                      required
                      value={createMemberForm.branchId}
                      onChange={(e) => setCreateMemberForm({ ...createMemberForm, branchId: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                    >
                      <option value="">{tr('اختر الفرع...', 'Select branch...', 'برانچ منتخب کریں...')}</option>
                      {selectedOrgBranchesForCreate.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {createMemberForm.role === 'supervisor' && (
                  <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-2">
                    <div className="font-bold">{tr('صلاحيات المسؤول الاختيارية (مطفأة افتراضياً)', 'Supervisor Optional Permissions (Opt-in)', 'سپروائزر کے اختیاری اختیارات')}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {SUPERVISOR_OPTIONAL_PERMISSION_KEYS.map((permKey) => (
                        <label key={permKey} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(createMemberForm.supervisorPermissions[permKey])}
                            onChange={(e) =>
                              setCreateMemberForm({
                                ...createMemberForm,
                                supervisorPermissions: {
                                  ...createMemberForm.supervisorPermissions,
                                  [permKey]: e.target.checked,
                                },
                              })
                            }
                          />
                          <span>{SUPERVISOR_PERM_LABELS[permKey][language] || SUPERVISOR_PERM_LABELS[permKey].ar}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShowCreateMemberModal(false)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                    {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                  </button>
                  <button
                    type="submit"
                    disabled={busyAction || (needsBranch && !createMemberForm.branchId)}
                    className="px-5 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white font-bold disabled:opacity-50"
                  >
                    {busyAction
                      ? tr('جاري الإنشاء...', 'Creating...', 'تخلیق جاری ہے...')
                      : tr('إنشاء العضو وتوثيقه', 'Create Member', 'رکن بنائیں')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL 15: Edit Member (Role, Same-Org Branch Transfer, Profile & Supervisor Permissions) */}
      {editingMember && (() => {
        const sameOrgBranches = (branchesByOrg.get(editingMember.orgId) || []).filter(
          (b) => b.lifecycleStatus !== 'purged_from_db'
        );
        const needsBranch =
          editMemberForm.role === 'branch_manager' || editMemberForm.role === 'employee';
        return (
          <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden my-8">
              <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
                <h2 className="font-bold text-base">
                  {tr('تعديل العضو / نقل الفرع:', 'Edit Member / Transfer Branch:', 'رکن میں ترمیم / منتقلی:')} {editingMember.displayName}
                </h2>
                <button type="button" onClick={() => setEditingMember(null)} className="p-1.5 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleEditMemberSubmit} className="p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
                <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500">{tr('المؤسسة (ثابتة):', 'Organization (Immutable):', 'ادارہ (ثابت):')}</span>{' '}
                    <span className="font-bold">{orgMap.get(editingMember.orgId)?.name || editingMember.orgId}</span>
                  </div>
                  <div className="font-mono" dir="ltr">
                    UID: {editingMember.uid}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">{tr('الاسم *', 'Display Name *', 'نام *')}</label>
                    <input
                      required
                      value={editMemberForm.displayName}
                      onChange={(e) => setEditMemberForm({ ...editMemberForm, displayName: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('رقم الجوال', 'Phone', 'فون')}</label>
                    <input
                      value={editMemberForm.phone}
                      onChange={(e) => setEditMemberForm({ ...editMemberForm, phone: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{tr('الدور التشغيلي *', 'Operational Role *', 'کردار *')}</label>
                    <select
                      value={editMemberForm.role}
                      onChange={(e) =>
                        setEditMemberForm({
                          ...editMemberForm,
                          role: e.target.value as SuperAdminAssignableMemberRole,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                    >
                      {ALLOWED_SUPER_ADMIN_MEMBER_ROLES.map((roleOpt) => (
                        <option key={roleOpt} value={roleOpt}>
                          {getUserRoleLabel(roleOpt, language)} ({roleOpt})
                        </option>
                      ))}
                    </select>
                  </div>
                  {needsBranch && (
                    <div>
                      <label className="block font-semibold mb-1">{tr('الفرع (نفس المؤسسة فقط) *', 'Branch (Same Org Only) *', 'برانچ *')}</label>
                      <select
                        required
                        value={editMemberForm.branchId}
                        onChange={(e) => setEditMemberForm({ ...editMemberForm, branchId: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                      >
                        <option value="">{tr('اختر الفرع...', 'Select branch...', 'برانچ منتخب کریں...')}</option>
                        {sameOrgBranches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {editMemberForm.role === 'supervisor' && (
                  <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-2">
                    <div className="font-bold">{tr('صلاحيات المسؤول الاختيارية', 'Supervisor Optional Permissions', 'سپروائزر اختیارات')}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {SUPERVISOR_OPTIONAL_PERMISSION_KEYS.map((permKey) => (
                        <label key={permKey} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(editMemberForm.supervisorPermissions[permKey])}
                            onChange={(e) =>
                              setEditMemberForm({
                                ...editMemberForm,
                                supervisorPermissions: {
                                  ...editMemberForm.supervisorPermissions,
                                  [permKey]: e.target.checked,
                                },
                              })
                            }
                          />
                          <span>{SUPERVISOR_PERM_LABELS[permKey][language] || SUPERVISOR_PERM_LABELS[permKey].ar}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block font-semibold mb-1">{tr('سبب التعديل (اختياري للتوثيق)', 'Reason (Optional for Audit Log)', 'ترمیم کی وجہ (اختیاری)')}</label>
                  <input
                    value={editMemberForm.reason}
                    onChange={(e) => setEditMemberForm({ ...editMemberForm, reason: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setEditingMember(null)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                    {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                  </button>
                  <button
                    type="submit"
                    disabled={busyAction || (needsBranch && !editMemberForm.branchId)}
                    className="px-5 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white font-bold disabled:opacity-50"
                  >
                    {busyAction
                      ? tr('جاري الحفظ...', 'Saving...', 'محفوظ ہو رہا ہے...')
                      : tr('حفظ التعديلات', 'Save Changes', 'تبدیلیاں محفوظ کریں')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL 16: Archive / Reactivate Member Confirmation (Strictly Non-Destructive) */}
      {memberLifecycleModal && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base">
                {memberLifecycleModal.mode === 'archive'
                  ? tr('أرشفة وتعطيل العضو', 'Archive & Disable Member', 'رکن کو آرکائیو اور معطل کریں')
                  : tr('إعادة تفعيل العضو', 'Reactivate Member', 'رکن کو دوبارہ فعال کریں')}
              </h2>
              <button type="button" onClick={() => setMemberLifecycleModal(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleMemberLifecycleSubmit} className="p-6 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <div className="font-bold">{memberLifecycleModal.member.displayName}</div>
                <div className="font-mono text-[11px] text-slate-500" dir="ltr">{memberLifecycleModal.member.email}</div>
                <div className="text-[11px] text-slate-500">
                  {orgMap.get(memberLifecycleModal.member.orgId)?.name || memberLifecycleModal.member.orgId} ·{' '}
                  {getUserRoleLabel(memberLifecycleModal.member.role, language)}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-slate-700 dark:text-slate-200 leading-relaxed">
                {memberLifecycleModal.mode === 'archive'
                  ? tr(
                      'إجراء غير هدّام: سيتم تعطيل الدخول وأرشفة العضوية فقط، دون حذف وثيقة المستخدم أو حساب Google أو الإقفالات أو المشتريات التاريخية، مع تسجيل ذري في platformAuditLogs.',
                      'Non-destructive action: Disables login and archives membership only. User documents, Google accounts, closings, and purchases are NEVER deleted.',
                      'غیر تباہ کن کارروائی: صرف لاگ ان معطل اور رکنیت آرکائیو ہوگی، کوئی تاریخی ریکارڈ حذف نہیں ہوگا۔'
                    )
                  : tr(
                      'ستتم إعادة تفعيل دخول العضو ضمن نفس المؤسسة مع الاحتفاظ بسجل الأرشفة السابق وتوثيق العملية ذرياً.',
                      'Restores member access within the same organization while preserving prior archive history.',
                      'اسی ادارے میں رکن کی رسائی بحال کی جائے گی۔'
                    )}
              </div>

              <div>
                <label className="block font-semibold mb-1">
                  {memberLifecycleModal.mode === 'archive'
                    ? tr('سبب الأرشفة * (5 أحرف على الأقل)', 'Archive Reason * (min 5 chars)', 'آرکائیو کی وجہ *')
                    : tr('ملاحظة إعادة التفعيل (اختياري)', 'Reactivation Note (Optional)', 'بحالی نوٹ (اختیاری)')}
                </label>
                <textarea
                  required={memberLifecycleModal.mode === 'archive'}
                  minLength={memberLifecycleModal.mode === 'archive' ? 5 : 0}
                  maxLength={500}
                  rows={2}
                  value={memberLifecycleReason}
                  onChange={(e) => setMemberLifecycleReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                />
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={memberLifecycleConfirmed}
                  onChange={(e) => setMemberLifecycleConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="font-semibold text-amber-900 dark:text-amber-200">
                  {memberLifecycleModal.mode === 'archive'
                    ? tr('أؤكد أرشفة وتعطيل هذا العضو وتوثيق الإجراء في سجل المنصة.', 'I confirm archiving and disabling this member with an audit entry.', 'میں اس رکن کو آرکائیو کرنے کی تصدیق کرتا ہوں۔')
                    : tr('أؤكد إعادة تفعيل هذا العضو وتوثيق الإجراء في سجل المنصة.', 'I confirm reactivating this member with an audit entry.', 'میں اس رکن کو دوبارہ فعال کرنے کی تصدیق کرتا ہوں۔')}
                </span>
              </label>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMemberLifecycleModal(null)} className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold">
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button
                  type="submit"
                  disabled={
                    busyAction ||
                    !memberLifecycleConfirmed ||
                    (memberLifecycleModal.mode === 'archive' && memberLifecycleReason.trim().length < 5)
                  }
                  className={`px-5 py-2 rounded-xl text-white font-bold disabled:opacity-50 ${
                    memberLifecycleModal.mode === 'archive'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-[#048264] hover:bg-[#036B52]'
                  }`}
                >
                  {busyAction
                    ? tr('جاري التنفيذ...', 'Processing...', 'جاری ہے...')
                    : memberLifecycleModal.mode === 'archive'
                    ? tr('تأكيد الأرشفة', 'Confirm Archive', 'آرکائیو کی تصدیق')
                    : tr('تأكيد إعادة التفعيل', 'Confirm Reactivate', 'بحالی کی تصدیق')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* MODAL 17: Permanent Membership Release (Phase C.1 — Non-Destructive, 3-Doc Atomic) */}
      {releaseMemberTarget && (
        <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
              <h2 className="font-bold text-base flex items-center gap-2 text-rose-700 dark:text-rose-300">
                <Unlink className="w-4 h-4" />
                <span>
                  {tr(
                    'فصل العضوية نهائياً عن المؤسسة',
                    'Permanently Release Membership from Organization',
                    'ادارے سے رکنیت مستقل طور پر ختم کریں'
                  )}
                </span>
              </h2>
              <button
                type="button"
                onClick={() => setReleaseMemberTarget(null)}
                className="p-1.5 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleReleaseMemberSubmit} className="p-6 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <div className="font-bold text-sm">{releaseMemberTarget.displayName}</div>
                <div className="font-mono text-[11px] text-slate-500" dir="ltr">
                  {releaseMemberTarget.email}
                </div>
                <div className="text-[11px] text-slate-500">
                  {tr('المؤسسة الحالية:', 'Current Organization:', 'موجودہ ادارہ:')}{' '}
                  <span className="font-bold text-[#0B1B32] dark:text-white">
                    {orgMap.get(releaseMemberTarget.orgId)?.name || releaseMemberTarget.orgId}
                  </span>{' '}
                  · {getUserRoleLabel(releaseMemberTarget.role, language)}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-slate-700 dark:text-slate-200 space-y-1.5 leading-relaxed">
                <div className="font-bold text-rose-700 dark:text-rose-300">
                  {tr(
                    'تنبيه حوكمة — إجراء مختلف عن الأرشفة:',
                    'Governance Notice — Distinct from Archiving:',
                    'گورننس نوٹ — آرکائیو سے مختلف کارروائی:'
                  )}
                </div>
                <ul className="list-disc ps-5 space-y-1">
                  <li>
                    {tr(
                      'سيتم فك ارتباط العضو نهائياً عن مؤسسته الحالية وإزالة الفروع وتصفير جميع الصلاحيات التشغيلية ومنع إعادة تفعيله تلقائياً داخل المؤسسة السابقة.',
                      'Detaches the member permanently from their current organization, clears branch bindings and permissions, and blocks automatic reactivation in the previous organization.',
                      'رکن کو موجودہ ادارے اور برانچ سے مستقل الگ کر کے تمام اختیارات صفر کر دیے جائیں گے۔'
                    )}
                  </li>
                  <li>
                    {tr(
                      'يُحفظ حساب المصادقة (Firebase Auth) ووثيقة المستخدم وكافة الإقفالات والمشتريات والمرفقات وسجلات التدقيق التاريخية لدى المؤسسة السابقة دون أي حذف.',
                      'Firebase Auth account, user document, and all historical closings, purchases, attachments, and audit logs remain 100% preserved inside the previous organization.',
                      'تصدیقی اکاؤنٹ اور تمام سابقہ مالی و آپریشنل ریکارڈز مکمل طور پر محفوظ رہیں گے۔'
                    )}
                  </li>
                  <li>
                    {tr(
                      'بعد الفصل، سيصبح العضو في قائمة «المحررون» ويمكن إعادة ربطه بنفس حسابه بمؤسسة نشطة أخرى لاحقاً، مع توثيق ذري في memberOrgHistory و platformAuditLogs.',
                      'After release, the member appears in the Released list and can later be assigned with the same UID to another active organization, atomically recorded in memberOrgHistory and platformAuditLogs.',
                      'علیحدگی کے بعد رکن آزاد فہرست میں نظر آئے گا اور بعد میں نئے ادارے سے منسلک کیا جا سکے گا۔'
                    )}
                  </li>
                </ul>
              </div>

              <div>
                <label className="block font-semibold mb-1">
                  {tr(
                    'سبب فصل العضوية نهائياً * (5 أحرف على الأقل)',
                    'Mandatory Permanent Release Reason * (min 5 chars)',
                    'مستقل علیحدگی کی وجہ * (کم از کم 5 حروف)'
                  )}
                </label>
                <textarea
                  required
                  minLength={5}
                  maxLength={500}
                  rows={3}
                  value={releaseMemberReason}
                  onChange={(e) => setReleaseMemberReason(e.target.value)}
                  placeholder={tr(
                    'مثال: انتهاء العلاقة التعاقدية مع المؤسسة السابقة وطلب تحرير الحساب للانضمام لمؤسسة جديدة',
                    'Example: Employment ended with previous org; releasing account for re-assignment',
                    'مثال: سابقہ ادارے سے ملازمت ختم ہو گئی...'
                  )}
                  className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                />
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={releaseMemberConfirmed}
                  onChange={(e) => setReleaseMemberConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="font-semibold text-amber-900 dark:text-amber-200">
                  {tr(
                    'أؤكد فصل عضوية هذا الموظف نهائياً عن مؤسسته الحالية وتوثيق العملية ذرياً في memberOrgHistory و platformAuditLogs.',
                    'I confirm permanently releasing this member from their current organization with atomic history and audit logging.',
                    'میں اس رکن کی مستقل علیحدگی کی تصدیق کرتا ہوں۔'
                  )}
                </span>
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReleaseMemberTarget(null)}
                  className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold"
                >
                  {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                </button>
                <button
                  type="submit"
                  disabled={
                    busyAction ||
                    !releaseMemberConfirmed ||
                    releaseMemberReason.trim().length < 5
                  }
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold disabled:opacity-50"
                >
                  {busyAction
                    ? tr('جاري الفصل...', 'Releasing...', 'کارروائی جاری ہے...')
                    : tr('تأكيد فصل العضوية نهائياً', 'Confirm Permanent Release', 'مستقل علیحدگی کی تصدیق')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 18: Assign Released Member to Active Organization (Phase C.1 — Reuses Same UID) */}
      {assignMemberTarget && (() => {
        const activeOrgs = organizations.filter((o) => o.isActive !== false);
        const targetOrgBranches = (branchesByOrg.get(assignMemberForm.targetOrgId) || []).filter(
          (b) => b.lifecycleStatus !== 'purged_from_db'
        );
        const needsBranch =
          assignMemberForm.role === 'branch_manager' || assignMemberForm.role === 'employee';
        return (
          <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
                <h2 className="font-bold text-base flex items-center gap-2 text-[#1764FF] dark:text-[#6CA2FF]">
                  <Link2 className="w-4 h-4" />
                  <span>
                    {tr(
                      'إعادة ربط العضو المحرر بمؤسسة',
                      'Assign Released Member to Organization',
                      'آزاد رکن کو ادارے سے منسلک کریں'
                    )}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={() => setAssignMemberTarget(null)}
                  className="p-1.5 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form
                onSubmit={handleAssignMemberSubmit}
                className="p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto"
              >
                {(() => {
                  const assignLastRelease = latestReleaseHistoryByUid.get(assignMemberTarget.uid);
                  const assignPrevOrgLabel =
                    assignLastRelease?.orgName ||
                    (assignLastRelease?.orgId ? orgMap.get(assignLastRelease.orgId)?.name || assignLastRelease.orgId : '');
                  return (
                    <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                      <div className="font-bold text-sm">{assignMemberTarget.displayName}</div>
                      <div className="font-mono text-[11px] text-slate-500" dir="ltr">
                        {assignMemberTarget.email} · UID: {assignMemberTarget.uid}
                      </div>
                      {assignPrevOrgLabel && (
                        <div className="text-[11px] text-slate-500">
                          {tr('المؤسسة السابقة المفصول منها:', 'Released from:', 'سابقہ ادارہ:')}{' '}
                          <span className="font-semibold">{assignPrevOrgLabel}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-slate-700 dark:text-slate-200 leading-relaxed">
                  {tr(
                    'سيتم استخدام حساب المصادقة الحالي (نفس UID) دون إنشاء حساب جديد. تُبنى الصلاحيات من الصفر حسب الدور المختار، ولا يتم نقل أي صلاحيات أو بيانات أو سجلات تشغيلية من المؤسسة السابقة إطلاقاً.',
                    'Reuses the existing Firebase Auth UID without creating a new account. Permissions are generated fresh for the chosen role; ZERO legacy permissions or records from the previous organization are copied.',
                    'موجودہ اکاؤنٹ (UID) ہی استعمال ہوگا؛ سابقہ ادارے کے کوئی اختیارات یا ریکارڈ منتقل نہیں ہوں گے۔'
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">
                      {tr('المؤسسة الجديدة (النشطة فقط) *', 'Target Active Organization *', 'نیا فعال ادارہ *')}
                    </label>
                    <select
                      required
                      value={assignMemberForm.targetOrgId}
                      onChange={(e) => {
                        const nextOrgId = e.target.value;
                        const firstB = (branchesByOrg.get(nextOrgId) || []).find(
                          (b) => b.lifecycleStatus !== 'purged_from_db'
                        );
                        setAssignMemberForm({
                          ...assignMemberForm,
                          targetOrgId: nextOrgId,
                          branchId: firstB?.id || '',
                        });
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                    >
                      <option value="">
                        {tr('اختر المؤسسة...', 'Select organization...', 'ادارہ منتخب کریں...')}
                      </option>
                      {activeOrgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">
                      {tr('الدور التشغيلي الجديد *', 'New Operational Role *', 'نیا کردار *')}
                    </label>
                    <select
                      value={assignMemberForm.role}
                      onChange={(e) =>
                        setAssignMemberForm({
                          ...assignMemberForm,
                          role: e.target.value as SuperAdminAssignableMemberRole,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                    >
                      {ALLOWED_SUPER_ADMIN_MEMBER_ROLES.map((roleOpt) => (
                        <option key={roleOpt} value={roleOpt}>
                          {getUserRoleLabel(roleOpt, language)} ({roleOpt})
                        </option>
                      ))}
                    </select>
                  </div>

                  {needsBranch && (
                    <div className="sm:col-span-2">
                      <label className="block font-semibold mb-1">
                        {tr(
                          'الفرع (فروع المؤسسة الجديدة فقط) *',
                          'Branch (Target Organization Only) *',
                          'برانچ (نئے ادارے کی) *'
                        )}
                      </label>
                      <select
                        required
                        value={assignMemberForm.branchId}
                        onChange={(e) =>
                          setAssignMemberForm({ ...assignMemberForm, branchId: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                      >
                        <option value="">
                          {tr('اختر الفرع...', 'Select branch...', 'برانچ منتخب کریں...')}
                        </option>
                        {targetOrgBranches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {assignMemberForm.role === 'supervisor' && (
                  <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-2">
                    <div className="font-bold">
                      {tr(
                        'صلاحيات المسؤول الاختيارية (تُبنى من الصفر)',
                        'Supervisor Optional Permissions (Freshly Built)',
                        'سپروائزر اختیارات'
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {SUPERVISOR_OPTIONAL_PERMISSION_KEYS.map((permKey) => (
                        <label key={permKey} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(assignMemberForm.supervisorPermissions[permKey])}
                            onChange={(e) =>
                              setAssignMemberForm({
                                ...assignMemberForm,
                                supervisorPermissions: {
                                  ...assignMemberForm.supervisorPermissions,
                                  [permKey]: e.target.checked,
                                },
                              })
                            }
                          />
                          <span>
                            {SUPERVISOR_PERM_LABELS[permKey][language] ||
                              SUPERVISOR_PERM_LABELS[permKey].ar}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block font-semibold mb-1">
                    {tr('ملاحظة / سبب إعادة الربط (اختياري)', 'Re-assignment Note (Optional)', 'نوٹ (اختیاری)')}
                  </label>
                  <input
                    maxLength={500}
                    value={assignMemberForm.reason}
                    onChange={(e) =>
                      setAssignMemberForm({ ...assignMemberForm, reason: e.target.value })
                    }
                    placeholder={tr(
                      'مثال: انضمام الموظف إلى المؤسسة الجديدة بنفس حسابه المعتمد',
                      'Example: Member onboarding into target organization with existing account',
                      'مثال: نئے ادارے میں شمولیت'
                    )}
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A]"
                  />
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignMemberForm.sendOptionalPasswordReset}
                    onChange={(e) =>
                      setAssignMemberForm({
                        ...assignMemberForm,
                        sendOptionalPasswordReset: e.target.checked,
                      })
                    }
                    className="mt-0.5"
                  />
                  <span className="text-slate-600 dark:text-slate-300">
                    {tr(
                      'إرسال رابط إعادة تعيين كلمة المرور عبر البريد الإلكتروني بعد الربط (اختياري — لا يتم تعديل كلمة المرور مباشرة)',
                      'Send optional password reset email after assignment (password is never modified directly)',
                      'منسلک کرنے کے بعد پاس ورڈ ری سیٹ لنک ای میل کریں (اختیاری)'
                    )}
                  </span>
                </label>

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignMemberConfirmed}
                    onChange={(e) => setAssignMemberConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    {tr(
                      'أؤكد إعادة ربط هذا العضو المحرر بالمؤسسة المختارة بصلاحيات جديدة وتوثيق العملية ذرياً في memberOrgHistory و platformAuditLogs.',
                      'I confirm assigning this released member to the selected organization with fresh permissions and atomic history/audit logging.',
                      'میں نئے ادارے سے اس رکن کو منسلک کرنے کی تصدیق کرتا ہوں۔'
                    )}
                  </span>
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAssignMemberTarget(null)}
                    className="px-4 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] font-semibold"
                  >
                    {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                  </button>
                  <button
                    type="submit"
                    disabled={
                      busyAction ||
                      !assignMemberConfirmed ||
                      !assignMemberForm.targetOrgId ||
                      (needsBranch && !assignMemberForm.branchId)
                    }
                    className="px-5 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white font-bold disabled:opacity-50"
                  >
                    {busyAction
                      ? tr('جاري الربط...', 'Assigning...', 'کارروائی جاری ہے...')
                      : tr('تأكيد إعادة الربط', 'Confirm Assignment', 'منسلک کرنے کی تصدیق')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL 19: Member Details, Immutable Membership History & Audit Trail */}
      {memberDetailUid && (() => {
        const detailMember = userMap.get(memberDetailUid);
        if (!detailMember) return null;
        const parentOrg = detailMember.orgId ? orgMap.get(detailMember.orgId) : undefined;
        const status = resolveMemberMembershipStatus(detailMember);
        const isReleased = status === 'released';
        const isArchived = !isReleased && (status === 'archived' || detailMember.isActive === false);
        const editable = canManageMember(detailMember);
        const releaseEligible = isMemberEligibleForRelease(detailMember, parentOrg);
        const memberHistory = memberHistoryByUid.get(detailMember.uid) || [];
        const latestDetailRelease = latestReleaseHistoryByUid.get(detailMember.uid);
        const memberAudits = platformAuditLogs.filter(
          (l) => l.targetId === detailMember.uid && l.targetType === 'member'
        );

        return (
          <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
                <h2 className="font-bold text-base flex items-center gap-2">
                  <History className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>
                    {tr('تفاصيل وسجل عضويات الموظف', 'Member Details & Organization History', 'رکن کی تفصیلات اور تاریخ')}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={() => setMemberDetailUid(null)}
                  className="p-1.5 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-5 text-xs max-h-[82vh] overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                  <div>
                    <div className="text-[11px] text-slate-500">{tr('الاسم', 'Name', 'نام')}</div>
                    <div className="font-bold text-sm">{detailMember.displayName}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">{tr('البريد الإلكتروني', 'Email', 'ای میل')}</div>
                    <div className="font-mono" dir="ltr">{detailMember.email}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">UID</div>
                    <div className="font-mono text-[11px]" dir="ltr">{detailMember.uid}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">{tr('حالة العضوية', 'Membership Status', 'حیثیت')}</div>
                    <div className="font-bold">
                      {isReleased
                        ? tr('محرر نهائياً (released)', 'Permanently Released', 'مستقل آزاد')
                        : isArchived
                        ? tr('مؤرشف / معطل', 'Archived / Disabled', 'آرکائیو')
                        : tr('نشط', 'Active', 'فعال')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">{tr('المؤسسة الحالية', 'Current Org', 'موجودہ ادارہ')}</div>
                    <div className="font-semibold">
                      {isReleased
                        ? tr('لا توجد مؤسسة مرتبطة حالياً', 'None (Released)', 'کوئی نہیں')
                        : parentOrg?.name || detailMember.orgId}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">{tr('الدور والفرع', 'Role & Branch', 'کردار اور برانچ')}</div>
                    <div className="font-semibold">
                      {getUserRoleLabel(detailMember.role, language)}
                      {detailMember.branchName ? ` — ${detailMember.branchName}` : ''}
                    </div>
                  </div>
                  {latestDetailRelease && (
                    <div className="sm:col-span-2 pt-2 border-t border-[#DCE6FA] dark:border-[#1F3B66]">
                      <div className="text-[11px] text-slate-500">
                        {tr('بيانات آخر فصل عضوية نهائي (من سجل memberOrgHistory):', 'Last Permanent Release (from memberOrgHistory):', 'آخری مستقل علیحدگی:')}
                      </div>
                      <div className="text-[11px] mt-0.5">
                        {tr('من مؤسسة:', 'From:', 'ادارے سے:')}{' '}
                        <span className="font-bold">
                          {latestDetailRelease.orgName ||
                            orgMap.get(latestDetailRelease.orgId)?.name ||
                            latestDetailRelease.orgId}
                        </span>{' '}
                        · {formatIsoDate(latestDetailRelease.effectiveAt)} · {latestDetailRelease.actorEmail || '—'}
                      </div>
                      {latestDetailRelease.reason && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {tr('السبب:', 'Reason:', 'وجہ:')} {latestDetailRelease.reason}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Quick Governance Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {isReleased && editable && (
                    <button
                      type="button"
                      onClick={() => {
                        setMemberDetailUid(null);
                        openAssignMemberModal(detailMember);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1764FF] hover:bg-[#1052D8] text-white"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span>{tr('إعادة ربط بمؤسسة', 'Assign to Organization', 'ادارے سے منسلک کریں')}</span>
                    </button>
                  )}
                  {releaseEligible && (
                    <button
                      type="button"
                      onClick={() => {
                        setMemberDetailUid(null);
                        openReleaseMemberModal(detailMember);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 hover:bg-rose-500/25"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      <span>{tr('فصل العضوية نهائياً', 'Release Permanently', 'مستقل علیحدگی')}</span>
                    </button>
                  )}
                  {!isReleased && editable && !isArchived && (
                    <button
                      type="button"
                      onClick={() => {
                        setMemberDetailUid(null);
                        openMemberLifecycleModal(detailMember, 'archive');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>{tr('أرشفة العضو', 'Archive Member', 'آرکائیو')}</span>
                    </button>
                  )}
                  {!isReleased && editable && isArchived && (
                    <button
                      type="button"
                      onClick={() => {
                        setMemberDetailUid(null);
                        openMemberLifecycleModal(detailMember, 'reactivate');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#08C99B]/15 text-[#048264] dark:text-[#08C99B]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{tr('إعادة تفعيل', 'Reactivate', 'دوبارہ فعال')}</span>
                    </button>
                  )}
                  {editable && (
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => handleSendSuperAdminPasswordReset(detailMember)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] hover:border-[#1764FF]"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>
                        {tr(
                          'إرسال رابط إعادة تعيين كلمة المرور (اختياري)',
                          'Send Password Reset Link (Optional)',
                          'پاس ورڈ ری سیٹ لنک بھیجیں'
                        )}
                      </span>
                    </button>
                  )}
                </div>

                {/* Immutable memberOrgHistory Section */}
                <div className="space-y-2">
                  <h3 className="font-bold text-xs text-[#0B1B32] dark:text-white">
                    {tr(
                      `سجل عضويات المؤسسات التاريخي غير القابل للتعديل (memberOrgHistory: ${memberHistory.length})`,
                      `Immutable Membership History (memberOrgHistory: ${memberHistory.length})`,
                      `اداروں کی رکنیت کی تاریخ (${memberHistory.length})`
                    )}
                  </h3>
                  {memberHistory.length === 0 ? (
                    <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-500 text-[11px]">
                      {tr(
                        'لا توجد أحداث فصل أو إعادة ربط مسجلة لهذا العضو حتى الآن.',
                        'No permanent release or re-assignment events recorded for this member yet.',
                        'اس رکن کے لیے کوئی علیحدگی یا منتقلی ریکارڈ نہیں۔'
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {memberHistory.map((h) => (
                        <div
                          key={h.id}
                          className="p-3 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF]/70 dark:bg-[#0E203A]/70 space-y-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                h.eventType === 'released'
                                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                  : 'bg-[#08C99B]/15 text-[#048264] dark:text-[#08C99B]'
                              }`}
                            >
                              {h.eventType === 'released'
                                ? tr('فصل عضوية نهائي (released)', 'Permanently Released', 'مستقل علیحدگی')
                                : tr('إعادة ربط بمؤسسة (assigned)', 'Assigned to Org', 'ادارے سے منسلک')}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">
                              {formatIsoDate(h.effectiveAt)}
                            </span>
                          </div>
                          <div className="font-semibold text-[#0B1B32] dark:text-white">
                            {h.orgName} ({h.orgId}) · {getUserRoleLabel(h.role, language)}
                            {h.branchName ? ` — ${h.branchName}` : ''}
                          </div>
                          {h.previousOrgId && (
                            <div className="text-[11px] text-slate-500">
                              {tr('المؤسسة السابقة:', 'Previous Org:', 'سابقہ ادارہ:')}{' '}
                              {h.previousOrgName || h.previousOrgId}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-600 dark:text-slate-300">
                            {tr('السبب:', 'Reason:', 'وجہ:')} {h.reason}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                            Actor: {h.actorEmail} · Audit: {h.auditLogId}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Member Platform Audit Logs */}
                <div className="space-y-2">
                  <h3 className="font-bold text-xs text-[#0B1B32] dark:text-white">
                    {tr(
                      `سجل تدقيق المنصة للعضو (platformAuditLogs: ${memberAudits.length})`,
                      `Member Platform Audit Trail (${memberAudits.length})`,
                      `پلیٹ فارم آڈٹ لاگ (${memberAudits.length})`
                    )}
                  </h3>
                  {memberAudits.length === 0 ? (
                    <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-500 text-[11px]">
                      {tr('لا توجد سجلات تدقيق خاصة بهذا العضو.', 'No audit logs for this member.', 'کوئی آڈٹ ریکارڈ نہیں۔')}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {memberAudits.slice(0, 10).map((log) => (
                        <div
                          key={log.id}
                          className="p-2.5 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#0E203A] space-y-0.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[11px] text-[#1764FF] dark:text-[#6CA2FF]">
                              {getPlatformAuditActionLabel(log.action, language)}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">
                              {formatIsoDate(log.timestamp)}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-300">{log.details}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
