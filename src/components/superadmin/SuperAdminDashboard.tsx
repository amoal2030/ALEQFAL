import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import {
  Branch,
  BranchPaymentStatus,
  DriveHealthStatus,
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
import { AppPageRoute, buildLegalPath } from '../../utils/legalRoutes';
import { getUserRoleLabel } from '../../utils/permissions';
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
  Building2,
  GitBranch,
  Users,
  ShieldCheck,
  HardDrive,
  RefreshCw,
  Search,
  LogOut,
  Sun,
  Moon,
  Globe,
  ChevronDown,
  Eye,
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
} from 'lucide-react';

interface SuperAdminDashboardProps {
  onSwitchToTenantDashboard?: () => void;
  onSwitchToOnboarding?: () => void;
  onNavigatePage?: (page: AppPageRoute) => void;
}

type MainTab = 'organizations' | 'branches' | 'invites' | 'auditLogs';
type OrgFilter = 'all' | 'active' | 'legacy' | 'grace_7d' | 'suspended' | 'attention';
type BranchFilter = 'all' | 'active' | 'unpaid_overdue' | 'suspended' | 'purge_ready' | 'purged';

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({
  onSwitchToTenantDashboard,
  onSwitchToOnboarding,
  onNavigatePage,
}) => {
  const {
    currentUser,
    isSuperAdmin,
    superAdminOverview,
    superAdminLoading,
    superAdminError,
    loadSuperAdminOverview,
    createSuperAdminOrganizationWithInvite,
    updateSuperAdminOrganizationProfileAndBilling,
    updateSuperAdminOrgStatus,
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
  const { language, setLanguage, direction, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [mainTab, setMainTab] = useState<MainTab>('organizations');
  const [searchTerm, setSearchTerm] = useState('');
  const [orgFilter, setOrgFilter] = useState<OrgFilter>('all');
  const [branchFilter, setBranchFilter] = useState<BranchFilter>('all');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'branches' | 'users'>('branches');
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const [busyAction, setBusyAction] = useState(false);
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

      if (subEval.isLegacy) legacyOrgsCount += 1;
      if (!subEval.isAllowed) {
        suspendedOrgsCount += 1;
      } else {
        activeOrgsCount += 1;
      }
      if (graceEval.inGrace && !graceEval.isLegacyExempt) {
        grace7dOrgsCount += 1;
      }
      expectedMonthlyBranchesSar += pricingEval.estimatedMonthlyBranchTotalSar;
    }

    let activeBranchesCount = 0;
    let suspendedBranchesCount = 0;
    let purgeReadyBranchesCount = 0;
    let purgedBranchesCount = 0;

    for (const b of allBranches) {
      const evalB = evaluateBranchBillingAndGrace(b, orgMap.get(b.orgId), now);
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

    return {
      totalOrgs: organizations.length,
      activeOrgsCount,
      legacyOrgsCount,
      suspendedOrgsCount,
      grace7dOrgsCount,
      expectedMonthlyBranchesSar,
      totalBranches: allBranches.length,
      activeBranchesCount,
      suspendedBranchesCount,
      purgeReadyBranchesCount,
      purgedBranchesCount,
      driveVerifiedCount,
      totalUsers: allUsers.length,
      pendingInvitesCount: allInvites.filter((i) => i.status === 'pending').length,
    };
  }, [organizations, allBranches, allUsers, allInvites, branchesByOrg, orgMap]);

  const filteredOrganizations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const now = new Date();
    return organizations.filter((org) => {
      const orgBranches = branchesByOrg.get(org.id) || [];
      const subEval = evaluateOrganizationSubscription(org, now);
      const graceEval = evaluateOrgNoPaidBranchGrace(org, orgBranches, now);

      if (orgFilter === 'active' && !subEval.isAllowed) return false;
      if (orgFilter === 'legacy' && !subEval.isLegacy) return false;
      if (orgFilter === 'grace_7d' && (!graceEval.inGrace || graceEval.isLegacyExempt)) return false;
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
    if (!term) return platformAuditLogs;
    return platformAuditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(term) ||
        l.details.toLowerCase().includes(term) ||
        l.targetId.toLowerCase().includes(term) ||
        l.actorEmail.toLowerCase().includes(term)
    );
  }, [platformAuditLogs, searchTerm]);

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
    return d.toLocaleString(language === 'en' ? 'en-US' : 'ar-SA');
  };

  const renderHealthLabel = (status?: DriveHealthStatus) => {
    switch (status) {
      case 'verified':
        return {
          text: 'متحقق',
          className: 'text-emerald-600 dark:text-emerald-400',
          icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
        };
      case 'failed':
        return {
          text: 'فشل',
          className: 'text-rose-600 dark:text-rose-400',
          icon: <XCircle className="w-3.5 h-3.5 shrink-0" />,
        };
      case 'disconnected':
        return {
          text: 'مفصول',
          className: 'text-slate-500 dark:text-slate-400',
          icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
        };
      default:
        return {
          text: 'غير مرتبط',
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
      className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#070e17] text-slate-900 dark:text-slate-100"
      dir={direction}
    >
      {/* Top Bar */}
      <header className="bg-white dark:bg-[#0c1829] border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 h-16 sm:h-20">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#0b192c] border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                  لوحة إدارة صاحب الموقع — الإقفال | AL EQFAL
                </h1>
                <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
                  <span>الاشتراكات والفوترة اليدوية</span>
                  <span aria-hidden="true">·</span>
                  <span>إدارة الفروع والدعوات والاعتمادات</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {onSwitchToTenantDashboard && (
                <button
                  type="button"
                  onClick={onSwitchToTenantDashboard}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors whitespace-nowrap shrink-0"
                >
                  <Building2 className="w-4 h-4" />
                  <span className="hidden md:inline">لوحة مؤسستي</span>
                </button>
              )}

              {!onSwitchToTenantDashboard && onSwitchToOnboarding && (
                <button
                  type="button"
                  onClick={onSwitchToOnboarding}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap shrink-0"
                >
                  <Building2 className="w-4 h-4" />
                  <span className="hidden md:inline">لوحة مؤسستي</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => loadSuperAdminOverview()}
                disabled={superAdminLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] text-slate-700 dark:text-slate-200 hover:border-amber-500/40 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-amber-500 ${superAdminLoading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">تحديث</span>
              </button>

              <NotificationCenter
                surface="super_admin"
                onNavigate={(target: NotificationNavTarget) => {
                  if (
                    target.tab === 'organizations' ||
                    target.tab === 'branches' ||
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
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-amber-500 bg-slate-50 dark:bg-[#070e17] transition-colors shrink-0"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
              </button>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setLangMenuOpen(!langMenuOpen)}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-[#070e17] hover:border-amber-500/40 transition-colors whitespace-nowrap shrink-0"
                >
                  <Globe className="w-3.5 h-3.5 text-amber-500" />
                  <span className="uppercase">{language}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>
                {langMenuOpen && (
                  <div className="absolute end-0 mt-1 w-32 rounded-xl bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 shadow-xl py-1 z-50 text-xs font-semibold">
                    {(['ar', 'en', 'ur'] as const).map((langCode) => (
                      <button
                        key={langCode}
                        type="button"
                        onClick={() => {
                          setLanguage(langCode);
                          setLangMenuOpen(false);
                        }}
                        className="w-full px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        {langCode === 'ar' ? 'العربية' : langCode === 'en' ? 'English' : 'اردو'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="hidden lg:flex flex-col text-end ps-2 border-s border-slate-200 dark:border-slate-800">
                <span className="text-xs font-bold text-slate-900 dark:text-white">صاحب الموقع</span>
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
              <span>{superAdminLoading ? 'جاري التحميل...' : 'إعادة المحاولة'}</span>
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
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-3">
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
          <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>المؤسسات المسجلة</span>
              <Building2 className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {stats.totalOrgs}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              نشطة: <span className="font-mono tabular-nums text-emerald-500 font-semibold">{stats.activeOrgsCount}</span> ·
              قديمة معفاة: <span className="font-mono tabular-nums text-amber-500 font-semibold">{stats.legacyOrgsCount}</span> ·
              موقوفة: <span className="font-mono tabular-nums text-rose-500 font-semibold">{stats.suspendedOrgsCount}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>إدارة الفروع ({BRANCH_MONTHLY_FEE_SAR} ر.س/ش)</span>
              <GitBranch className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {stats.totalBranches}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              فعالة: <span className="font-mono tabular-nums text-emerald-500 font-semibold">{stats.activeBranchesCount}</span> ·
              معلقة: <span className="font-mono tabular-nums text-rose-500 font-semibold">{stats.suspendedBranchesCount}</span> ·
              منظفة: <span className="font-mono tabular-nums">{stats.purgedBranchesCount}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>التسعير اليدوي المعتمد</span>
              <CreditCard className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {stats.expectedMonthlyBranchesSar.toLocaleString('en-US')} SAR
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              تأسيس: <span className="font-mono tabular-nums">{ACCOUNT_SETUP_FEE_SAR}</span> ر.س ·
              فرع: <span className="font-mono tabular-nums">{BRANCH_MONTHLY_FEE_SAR}</span> ر.س ·
              إعادة تنشيط: <span className="font-mono tabular-nums">{ORG_REACTIVATION_FEE_SAR}</span> ر.س
            </div>
          </div>

          <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>المهل والدعوات المعلقة</span>
              <ShieldAlert className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {stats.grace7dOrgsCount + stats.purgeReadyBranchesCount}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              مهلة 7 أيام: <span className="font-mono tabular-nums text-amber-500 font-semibold">{stats.grace7dOrgsCount}</span> ·
              جاهز للتنظيف (+30ي): <span className="font-mono tabular-nums text-rose-500 font-semibold">{stats.purgeReadyBranchesCount}</span> ·
              دعوات: <span className="font-mono tabular-nums">{stats.pendingInvitesCount}</span>
            </div>
          </div>
        </section>

        {/* Primary Tabs & Action Bar */}
        <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'organizations', label: `المؤسسات والاشتراكات (${organizations.length})`, icon: Building2 },
                { id: 'branches', label: `الفروع والفوترة (${allBranches.length})`, icon: GitBranch },
                { id: 'invites', label: `دعوات المدراء (${allInvites.length})`, icon: Mail },
                { id: 'auditLogs', label: `سجل المنصة (${platformAuditLogs.length})`, icon: FileText },
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
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
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
                placeholder="بحث بالاسم، المعرف، البريد، الرقم الضريبي..."
                className="w-full ps-9 pe-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] text-xs outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                clearFeedback();
                setShowCreateOrgModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>إنشاء مؤسسة ودعوة مدير</span>
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
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>إضافة فرع</span>
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
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>إصدار دعوة</span>
            </button>
          </div>
        </section>

        {/* TAB 1: Organizations & Subscriptions */}
        {mainTab === 'organizations' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'all', label: `الكل (${organizations.length})` },
                  { id: 'active', label: `نشطة (${stats.activeOrgsCount})` },
                  { id: 'legacy', label: `قديمة معفاة (${stats.legacyOrgsCount})` },
                  { id: 'grace_7d', label: `مهلة 7 أيام (${stats.grace7dOrgsCount})` },
                  { id: 'suspended', label: `موقوفة/منتهية (${stats.suspendedOrgsCount})` },
                  { id: 'attention', label: 'Drive يحتاج انتباه' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setOrgFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    orgFilter === f.id
                      ? 'bg-slate-900 dark:bg-amber-400 text-white dark:text-slate-950 border-transparent'
                      : 'bg-white dark:bg-[#0c1829] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {filteredOrganizations.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500">
                  لا توجد مؤسسات مطابقة للبحث أو التصفية.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        <th className="py-3.5 px-4 text-start">المؤسسة والملف الضريبي</th>
                        <th className="py-3.5 px-4 text-start">المدير وبريد Google</th>
                        <th className="py-3.5 px-4 text-start">الاشتراك والحالة</th>
                        <th className="py-3.5 px-4 text-start">الرسوم والتسعير اليدوي</th>
                        <th className="py-3.5 px-4 text-start">الفروع / Drive</th>
                        <th className="py-3.5 px-4 text-end">إجراءات الإدارة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
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
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                          >
                            <td className="py-3.5 px-4 align-top">
                              <div className="font-bold text-slate-900 dark:text-white">{org.name}</div>
                              <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                                {org.id}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                الضريبي: <span className="font-mono tabular-nums">{org.taxNumber || '—'}</span> · السجل:{' '}
                                <span className="font-mono tabular-nums">{org.commercialRegistration || '—'}</span>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <div className="font-semibold text-slate-800 dark:text-slate-200">{org.ownerName}</div>
                              <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                                {org.ownerEmail}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {org.ownerId ? 'حساب مربوط' : 'بانتظار قبول الدعوة'} · مستخدمون:{' '}
                                <span className="font-mono tabular-nums">{orgUsers.length}</span>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              {subEval.isLegacy ? (
                                <span className="inline-block px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-bold">
                                  {subEval.isAllowed ? 'قديمة معفاة (legacy_unrestricted)' : 'قديمة (موقوفة)'}
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                                      subEval.isAllowed
                                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                        : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                    }`}
                                  >
                                    {subEval.isAllowed
                                      ? `نشط (${getSubscriptionPlanLabel(org.subscriptionPlan || '1m', 'ar')})`
                                      : org.deactivationReason === 'no_paid_branches'
                                      ? 'متوقفة — بلا فروع مدفوعة'
                                      : subEval.state === 'expired'
                                      ? 'منتهي'
                                      : 'موقوف'}
                                  </span>
                                  <div className="text-[11px] font-mono tabular-nums text-slate-500">
                                    {formatShortDate(subEval.startDate)} → {formatShortDate(subEval.endDate)}
                                  </div>
                                </div>
                              )}
                              {graceEval.inGrace && !graceEval.isLegacyExempt && (
                                <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
                                  مهلة 7 أيام: متبقي {graceEval.remainingGraceDays ?? 7} يوم
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              {pricing.isLegacyExempt ? (
                                <span className="text-[11px] text-slate-500">0 ر.س (إعفاء قديم)</span>
                              ) : (
                                <div className="space-y-0.5 text-[11px]">
                                  <div>
                                    تأسيس {pricing.setupFeeSar} ر.س:{' '}
                                    <span
                                      className={`font-bold ${
                                        pricing.setupFeeStatus === 'paid'
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : pricing.setupFeeStatus === 'waived'
                                          ? 'text-slate-500'
                                          : 'text-rose-600 dark:text-rose-400'
                                      }`}
                                    >
                                      {pricing.setupFeeStatus === 'paid'
                                        ? 'مدفوعة'
                                        : pricing.setupFeeStatus === 'waived'
                                        ? 'معفاة'
                                        : 'غير مدفوعة'}
                                    </span>
                                  </div>
                                  <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                    الفروع: {pricing.activeBranchesCount} × {BRANCH_MONTHLY_FEE_SAR} ={' '}
                                    {pricing.estimatedMonthlyBranchTotalSar} ر.س/ش
                                  </div>
                                  {org.deactivationReason === 'no_paid_branches' && (
                                    <div className="text-rose-500 font-semibold">
                                      إعادة تنشيط مطلوبة: {ORG_REACTIVATION_FEE_SAR} ر.س
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <div className="text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                مدفوعة: {pricing.paidBranchesCount}/{orgBranches.length}
                              </div>
                              <div className={`inline-flex items-center gap-1 text-[11px] mt-1 ${health.className}`}>
                                {health.icon}
                                <span>Drive: {org.driveConnected ? health.text : 'غير مربوط'}</span>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top text-end">
                              <div className="inline-flex flex-wrap justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditOrgModal(org)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-amber-500/15 hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>تعديل/فوترة</span>
                                </button>

                                {subEval.isAllowed ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      clearFeedback();
                                      setStatusModalOrg(org);
                                      setStatusActionMode(
                                        graceEval.inGrace && !graceEval.isLegacyExempt
                                          ? 'deactivate_no_paid_branches'
                                          : 'suspend'
                                      );
                                      setStatusNote('');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                    <span>إيقاف</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      clearFeedback();
                                      setStatusModalOrg(org);
                                      setStatusActionMode('reactivate');
                                      setReactivationFeeStatus('paid');
                                      setReactivationFeeDateIso(todayIso);
                                      setStatusNote('');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                                  >
                                    <Play className="w-3.5 h-3.5" />
                                    <span>إعادة تنشيط</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedOrgId(org.id);
                                    setDetailTab('branches');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-200 dark:border-slate-700 hover:border-amber-500/40"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>التفاصيل</span>
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
                  { id: 'all', label: `الكل (${allBranches.length})` },
                  { id: 'active', label: `فعالة (${stats.activeBranchesCount})` },
                  { id: 'unpaid_overdue', label: 'غير مدفوعة / متأخرة' },
                  { id: 'suspended', label: `معلقة (${stats.suspendedBranchesCount})` },
                  { id: 'purge_ready', label: `متجاوزة 30 يوماً (${stats.purgeReadyBranchesCount})` },
                  { id: 'purged', label: `منظفة من القاعدة (${stats.purgedBranchesCount})` },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setBranchFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    branchFilter === f.id
                      ? 'bg-slate-900 dark:bg-amber-400 text-white dark:text-slate-950 border-transparent'
                      : 'bg-white dark:bg-[#0c1829] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {filteredBranches.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500">
                  لا توجد فروع مطابقة للتصفية الحالية.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        <th className="py-3.5 px-4 text-start">الفرع والرمز</th>
                        <th className="py-3.5 px-4 text-start">المؤسسة الأم</th>
                        <th className="py-3.5 px-4 text-start">الحالة ودورة الحياة</th>
                        <th className="py-3.5 px-4 text-start">الدفع والرسوم (50 ر.س)</th>
                        <th className="py-3.5 px-4 text-start">مهلة 30 يوماً / توثيق Drive</th>
                        <th className="py-3.5 px-4 text-end">تحكم صاحب الموقع</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                      {filteredBranches.map((branch) => {
                        const parentOrg = orgMap.get(branch.orgId);
                        const evalB = evaluateBranchBillingAndGrace(branch, parentOrg);
                        return (
                          <tr key={branch.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                            <td className="py-3.5 px-4 align-top">
                              <div className="font-bold text-slate-900 dark:text-white">{branch.name}</div>
                              <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                                {branch.code} · {branch.id}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <div className="font-semibold text-slate-800 dark:text-slate-200">
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
                                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                    : evalB.isSuspended
                                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                }`}
                              >
                                {evalB.isPurgedFromDb
                                  ? 'تم حذف سجلات DB فقط'
                                  : evalB.isSuspended
                                  ? 'معلق'
                                  : 'نشط'}
                              </span>
                              <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                                البداية: {formatShortDate(branch.subscriptionStartAt || branch.createdAt)}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <div className="font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
                                {evalB.monthlyFeeSar} ر.س/شهر
                              </div>
                              <div className="text-[11px] mt-0.5">
                                الحالة:{' '}
                                <span
                                  className={`font-bold ${
                                    evalB.paymentStatus === 'paid' || evalB.paymentStatus === 'exempt'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {evalB.paymentStatus === 'paid'
                                    ? 'مدفوع'
                                    : evalB.paymentStatus === 'exempt'
                                    ? 'معفى'
                                    : evalB.paymentStatus === 'overdue'
                                    ? 'متأخر'
                                    : 'غير مدفوع'}
                                </span>
                              </div>
                              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                                الاستحقاق: {formatShortDate(evalB.feeDueAt)} · آخر دفع:{' '}
                                {formatShortDate(evalB.lastPaidAt)}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top text-[11px]">
                              {evalB.isSuspended ? (
                                <div className="space-y-0.5">
                                  <div className="font-mono tabular-nums text-rose-600 dark:text-rose-400">
                                    تعليق: {formatShortDate(evalB.suspendedAt)}
                                  </div>
                                  <div className="font-mono tabular-nums text-slate-500">
                                    انتهاء الـ30 يوماً: {formatShortDate(evalB.gracePeriodEndsAt)}
                                  </div>
                                  <div
                                    className={`font-semibold ${
                                      evalB.driveBackupVerified
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : evalB.isGraceExpired
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {evalB.isPurgedFromDb
                                      ? 'تم التنظيف من DB (Drive محفوظ)'
                                      : evalB.driveBackupVerified
                                      ? 'نسخة Google Drive موثقة بالكامل'
                                      : evalB.isGraceExpired
                                      ? 'انتهت الـ30 يوماً — بانتظار فحص Drive'
                                      : `متبقي ${evalB.graceRemainingDays ?? 30} يوم`}
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
                                    onClick={() => {
                                      clearFeedback();
                                      setPaymentModalBranch(branch);
                                      setBranchPaymentForm({
                                        paymentStatus: branch.paymentStatus || 'paid',
                                        paidDateIso: todayIso,
                                        feeDueDateIso:
                                          evalB.feeDueAt?.toISOString().slice(0, 10) || nextMonthIso,
                                        monthlyFeeSar: evalB.monthlyFeeSar || BRANCH_MONTHLY_FEE_SAR,
                                        paymentNote: branch.paymentNote || '',
                                      });
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-amber-500/15"
                                  >
                                    <CreditCard className="w-3.5 h-3.5" />
                                    <span>سداد 50 ر.س</span>
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
                                    <span>تعليق (30 يوم)</span>
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
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                    >
                                      <Play className="w-3.5 h-3.5" />
                                      <span>إعادة تنشيط</span>
                                    </button>

                                    <button
                                      type="button"
                                      disabled={!evalB.isGraceExpired}
                                      onClick={() => handleInspectBranchBackup(branch)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title={
                                        evalB.isGraceExpired
                                          ? 'فحص أرشفة Drive وتنفيذ حذف سجلات DB فقط'
                                          : 'يُفتح بعد انقضاء 30 يوماً كاملة على التعليق'
                                      }
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>فحص Drive وحذف DB</span>
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

        {/* TAB 3: Manager Invites */}
        {mainTab === 'invites' && (
          <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {filteredInvites.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">لا توجد دعوات مدراء مسجلة.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      <th className="py-3.5 px-4 text-start">البريد الموحد (Google)</th>
                      <th className="py-3.5 px-4 text-start">المؤسسة والمدير</th>
                      <th className="py-3.5 px-4 text-start">الحالة</th>
                      <th className="py-3.5 px-4 text-start">تفاصيل القبول / التحديث</th>
                      <th className="py-3.5 px-4 text-end">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {filteredInvites.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="py-3.5 px-4 font-mono" dir="ltr">
                          {inv.emailNormalized}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 dark:text-white">
                            {inv.orgName || orgMap.get(inv.orgId)?.name || inv.orgId}
                          </div>
                          <div className="text-[11px] text-slate-500">{inv.managerName || '—'}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                              inv.status === 'accepted'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : inv.status === 'cancelled'
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {inv.status === 'accepted'
                              ? 'مقبولة'
                              : inv.status === 'cancelled'
                              ? 'ملغاة'
                              : 'معلقة (جاهزة)'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-[11px] text-slate-500 font-mono">
                          {inv.status === 'accepted'
                            ? `UID: ${inv.acceptedByUid || '—'} (${formatShortDate(inv.acceptedAt)})`
                            : `آخر تحديث: ${formatShortDate(inv.updatedAt)}`}
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
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-amber-500/15"
                              >
                                تعديل / إعادة تفعيل
                              </button>
                              {inv.status === 'pending' && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelInvite(inv.emailNormalized)}
                                  disabled={busyAction}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
                                >
                                  إلغاء
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

        {/* TAB 4: Platform Audit Logs */}
        {mainTab === 'auditLogs' && (
          <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {filteredAuditLogs.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                لا توجد أحداث مسجلة في سجل عمليات صاحب الموقع حتى الآن.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      <th className="py-3.5 px-4 text-start">الوقت</th>
                      <th className="py-3.5 px-4 text-start">العملية</th>
                      <th className="py-3.5 px-4 text-start">الهدف</th>
                      <th className="py-3.5 px-4 text-start">التفاصيل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {filteredAuditLogs.map((log: PlatformAuditLog) => (
                      <tr key={log.id}>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap" dir="ltr">
                          {formatIsoDate(log.timestamp)}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          {log.action}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {log.targetType}: {log.targetId}
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-200">{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Transparent Firebase Spark + GitHub Pages Architecture Note */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] p-4 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-3">
          <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed">
            <p className="font-bold text-slate-900 dark:text-white">
              نطاق التنفيذ على باقة Firebase Spark + الاستضافة الثابتة (GitHub Pages)
            </p>
            <p>
              يتم التحقق الصارم من مهل الإيقاف والتنظيف على مستوى خادم قواعد Firestore (
              <span className="font-mono" dir="ltr">request.time &gt;= deactivationDueAt</span> و{' '}
              <span className="font-mono" dir="ltr">request.time &gt;= gracePeriodEndsAt</span>) دون الاعتماد على ساعة جهاز المستخدم.
              ولعدم وجود مهام مجدولة تلقائية (Cron) في باقة Spark، يتم تنفيذ التنظيف الفعلي لسجلات الفرع بعد الـ 30 يوماً وتأكيد حالات السداد يدوياً من هذه اللوحة بعد التحقق من اكتمال أرشيف Google Drive.
            </p>
          </div>
        </section>

        {/* Footer Legal Links */}
        {onNavigatePage && (
          <footer className="pt-2 pb-6 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-500">
            <a
              href={buildLegalPath('privacy')}
              onClick={(e) => {
                e.preventDefault();
                onNavigatePage('privacy');
              }}
              className="hover:text-amber-500"
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
              className="hover:text-amber-500"
            >
              {t('termsOfService')}
            </a>
          </footer>
        )}
      </main>

      {/* MODAL 1: Create Organization + First Branch + Manager Invite */}
      {showCreateOrgModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-base text-slate-900 dark:text-white">
                إنشاء مؤسسة جديدة + أول فرع + دعوة مدير
              </h2>
              <button type="button" onClick={() => setShowCreateOrgModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateOrgSubmit} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">اسم المؤسسة *</label>
                  <input
                    required
                    value={createOrgForm.name}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">النشاط التجاري</label>
                  <select
                    value={createOrgForm.activityType}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, activityType: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  >
                    <option value="retail">تجارة تجزئة</option>
                    <option value="restaurant">مطعم / كافيه</option>
                    <option value="supermarket">سوبرماركت</option>
                    <option value="services">خدمات</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">الرقم الضريبي</label>
                  <input
                    value={createOrgForm.taxNumber}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, taxNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">السجل التجاري</label>
                  <input
                    value={createOrgForm.commercialRegistration}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, commercialRegistration: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">اسم المدير *</label>
                  <input
                    required
                    value={createOrgForm.ownerName}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, ownerName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">بريد Google للمدير *</label>
                  <input
                    type="email"
                    required
                    value={createOrgForm.ownerEmail}
                    onChange={(e) => setCreateOrgForm({ ...createOrgForm, ownerEmail: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="font-bold text-slate-900 dark:text-white">
                  رسوم تأسيس الحساب ({ACCOUNT_SETUP_FEE_SAR} ر.س) والاشتراك
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">حالة رسوم التأسيس</label>
                    <select
                      value={createOrgForm.setupFeeStatus}
                      onChange={(e) =>
                        setCreateOrgForm({ ...createOrgForm, setupFeeStatus: e.target.value as FeePaymentStatus })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]"
                    >
                      <option value="paid">مدفوعة (80 ر.س)</option>
                      <option value="unpaid">غير مدفوعة</option>
                      <option value="waived">معفاة</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">تاريخ دفع التأسيس</label>
                    <input
                      type="date"
                      value={createOrgForm.setupFeePaidDateIso}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, setupFeePaidDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">الخطة</label>
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
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]"
                    >
                      {SUBSCRIPTION_PLANS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.labels.ar}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">تاريخ بداية الاشتراك</label>
                    <input
                      type="date"
                      value={createOrgForm.startDateIso}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, startDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">تاريخ انتهاء الاشتراك (اختياري)</label>
                    <input
                      type="date"
                      value={createOrgForm.endDateIso}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, endDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">ملاحظة الاشتراك</label>
                    <input
                      value={createOrgForm.subscriptionNote}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, subscriptionNote: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="font-bold text-slate-900 dark:text-white">
                  الفرع الأول ({BRANCH_MONTHLY_FEE_SAR} ر.س/شهرياً من أول فرع)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">اسم الفرع *</label>
                    <input
                      required
                      value={createOrgForm.firstBranchName}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, firstBranchName: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">رمز الفرع</label>
                    <input
                      value={createOrgForm.firstBranchCode}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, firstBranchCode: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">حالة دفع الفرع</label>
                    <select
                      value={createOrgForm.firstBranchPaymentStatus}
                      onChange={(e) =>
                        setCreateOrgForm({
                          ...createOrgForm,
                          firstBranchPaymentStatus: e.target.value as BranchPaymentStatus,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]"
                    >
                      <option value="paid">مدفوع (50 ر.س)</option>
                      <option value="unpaid">غير مدفوع</option>
                      <option value="exempt">معفى</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">استحقاق الفرع</label>
                    <input
                      type="date"
                      value={createOrgForm.firstBranchDueDateIso}
                      onChange={(e) => setCreateOrgForm({ ...createOrgForm, firstBranchDueDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateOrgModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold disabled:opacity-50"
                >
                  {busyAction ? 'جاري التنفيذ...' : 'إنشاء المؤسسة وإصدار الدعوة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Edit Org Profile, Setup Fee, Subscription & Legacy Conversion */}
      {editingOrg && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-base">تعديل بيانات وفوترة المؤسسة: {editingOrg.name}</h2>
              <button type="button" onClick={() => setEditingOrg(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleEditOrgSubmit} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">اسم المؤسسة</label>
                  <input
                    required
                    value={editOrgForm.name}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">الرقم الضريبي</label>
                  <input
                    value={editOrgForm.taxNumber}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, taxNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">السجل التجاري</label>
                  <input
                    value={editOrgForm.commercialRegistration}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, commercialRegistration: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">اسم المدير</label>
                  <input
                    required
                    value={editOrgForm.ownerName}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, ownerName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">بريد المدير</label>
                  <input
                    type="email"
                    required
                    value={editOrgForm.ownerEmail}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, ownerEmail: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">العملة</label>
                  <select
                    value={editOrgForm.currency}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, currency: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  >
                    {['SAR', 'AED', 'QAR', 'KWD', 'USD'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {evaluateOrganizationSubscription(editingOrg).isLegacy && (
                <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editOrgForm.convertLegacyToPaid}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, convertLegacyToPaid: e.target.checked })}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-bold text-amber-700 dark:text-amber-300">
                      مؤسسة قديمة معفاة (legacy_unrestricted) — تفعيل الاشتراك المدفوع من الآن
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">
                      تبقى المؤسسة معفاة ما لم تحدد هذا الخيار؛ لا تُفرض أي رسوم بأثر رجعي.
                    </div>
                  </div>
                </label>
              )}

              {(!evaluateOrganizationSubscription(editingOrg).isLegacy || editOrgForm.convertLegacyToPaid) && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">رسوم التأسيس (80 ر.س)</label>
                    <select
                      value={editOrgForm.setupFeeStatus}
                      onChange={(e) =>
                        setEditOrgForm({ ...editOrgForm, setupFeeStatus: e.target.value as FeePaymentStatus })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]"
                    >
                      <option value="paid">مدفوعة</option>
                      <option value="unpaid">غير مدفوعة</option>
                      <option value="waived">معفاة</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">تاريخ دفع التأسيس</label>
                    <input
                      type="date"
                      value={editOrgForm.setupFeePaidDateIso}
                      onChange={(e) => setEditOrgForm({ ...editOrgForm, setupFeePaidDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">حالة الاشتراك</label>
                    <select
                      value={editOrgForm.subscriptionStatus}
                      onChange={(e) =>
                        setEditOrgForm({ ...editOrgForm, subscriptionStatus: e.target.value as SubscriptionStatus })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]"
                    >
                      <option value="active">نشط</option>
                      <option value="expired">منتهي</option>
                      <option value="suspended">موقوف</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">الخطة</label>
                    <select
                      value={editOrgForm.subscriptionPlan}
                      onChange={(e) =>
                        setEditOrgForm({ ...editOrgForm, subscriptionPlan: e.target.value as SubscriptionPlan })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]"
                    >
                      {SUBSCRIPTION_PLANS.map((p) => (
                        <option key={p.id} value={p.id}>{p.labels.ar}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">بداية الاشتراك</label>
                    <input
                      type="date"
                      value={editOrgForm.startDateIso}
                      onChange={(e) => setEditOrgForm({ ...editOrgForm, startDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">نهاية الاشتراك</label>
                    <input
                      type="date"
                      value={editOrgForm.endDateIso}
                      onChange={(e) => setEditOrgForm({ ...editOrgForm, endDateIso: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingOrg(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold disabled:opacity-50"
                >
                  {busyAction ? 'جاري الحفظ...' : 'حفظ التغييرات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Org Suspend / 7-Day Grace / Reactivate (10 SAR) */}
      {statusModalOrg && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-base">إدارة حالة المؤسسة: {statusModalOrg.name}</h2>
              <button type="button" onClick={() => setStatusModalOrg(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleOrgStatusSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">الإجراء</label>
                <select
                  value={statusActionMode}
                  onChange={(e) => setStatusActionMode(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                >
                  <option value="reactivate">إعادة تنشيط المؤسسة (رسوم 10 ر.س)</option>
                  <option value="start_no_paid_branch_grace">بدء مهلة 7 أيام (لا يوجد فرع مدفوع)</option>
                  <option value="deactivate_no_paid_branches">إيقاف فوري لعدم وجود فروع مدفوعة</option>
                  <option value="suspend">تعليق إداري للمؤسسة</option>
                </select>
              </div>

              {statusActionMode === 'reactivate' && (
                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800">
                  <div>
                    <label className="block font-semibold mb-1">حالة رسوم إعادة التنشيط (10 ر.س)</label>
                    <select
                      value={reactivationFeeStatus}
                      onChange={(e) => setReactivationFeeStatus(e.target.value as FeePaymentStatus)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829]"
                    >
                      <option value="paid">مدفوعة (10 ر.س)</option>
                      <option value="waived">معفاة</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">تاريخ الدفع</label>
                    <input
                      type="date"
                      value={reactivationFeeDateIso}
                      onChange={(e) => setReactivationFeeDateIso(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1829] font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold mb-1">ملاحظة إدارية (اختياري)</label>
                <input
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setStatusModalOrg(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold">
                  إلغاء
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold">
                  {busyAction ? 'جاري التنفيذ...' : 'تنفيذ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Upsert Manager Invite */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-base">إصدار / تعديل دعوة مدير</h2>
              <button type="button" onClick={() => setShowInviteModal(false)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleInviteSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">المؤسسة المستهدفة *</label>
                <select
                  required
                  value={inviteForm.orgId}
                  onChange={(e) => setInviteForm({ ...inviteForm, orgId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                >
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>{o.name} ({o.id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">بريد Google للمدير *</label>
                <input
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">اسم المدير</label>
                <input
                  value={inviteForm.managerName}
                  onChange={(e) => setInviteForm({ ...inviteForm, managerName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowInviteModal(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold">
                  إلغاء
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold">
                  حفظ الدعوة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Create Branch (Exclusive Super Admin) */}
      {showCreateBranchModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-base">إضافة فرع جديد ({BRANCH_MONTHLY_FEE_SAR} ر.س/شهرياً)</h2>
              <button type="button" onClick={() => setShowCreateBranchModal(false)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateBranchSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">المؤسسة *</label>
                <select
                  required
                  value={createBranchForm.orgId}
                  onChange={(e) => setCreateBranchForm({ ...createBranchForm, orgId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                >
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">اسم الفرع *</label>
                  <input
                    required
                    value={createBranchForm.name}
                    onChange={(e) => setCreateBranchForm({ ...createBranchForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">رمز الفرع</label>
                  <input
                    value={createBranchForm.code}
                    onChange={(e) => setCreateBranchForm({ ...createBranchForm, code: e.target.value })}
                    placeholder="BR02"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">حالة السداد الأولي</label>
                  <select
                    value={createBranchForm.paymentStatus}
                    onChange={(e) =>
                      setCreateBranchForm({ ...createBranchForm, paymentStatus: e.target.value as BranchPaymentStatus })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  >
                    <option value="paid">مدفوع (50 ر.س)</option>
                    <option value="unpaid">غير مدفوع</option>
                    <option value="exempt">معفى</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ الاستحقاق القادم</label>
                  <input
                    type="date"
                    value={createBranchForm.feeDueDateIso}
                    onChange={(e) => setCreateBranchForm({ ...createBranchForm, feeDueDateIso: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateBranchModal(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold">
                  إلغاء
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold">
                  إضافة الفرع
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: Record Branch Payment (50 SAR) */}
      {paymentModalBranch && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-base">تسجيل دفع الفرع: {paymentModalBranch.name}</h2>
              <button type="button" onClick={() => setPaymentModalBranch(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRecordBranchPaymentSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">حالة الدفع</label>
                  <select
                    value={branchPaymentForm.paymentStatus}
                    onChange={(e) =>
                      setBranchPaymentForm({ ...branchPaymentForm, paymentStatus: e.target.value as BranchPaymentStatus })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  >
                    <option value="paid">مدفوع</option>
                    <option value="unpaid">غير مدفوع</option>
                    <option value="overdue">متأخر</option>
                    <option value="exempt">معفى</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">القيمة الشهرية (ر.س)</label>
                  <input
                    type="number"
                    min={0}
                    value={branchPaymentForm.monthlyFeeSar}
                    onChange={(e) =>
                      setBranchPaymentForm({ ...branchPaymentForm, monthlyFeeSar: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ السداد</label>
                  <input
                    type="date"
                    value={branchPaymentForm.paidDateIso}
                    onChange={(e) => setBranchPaymentForm({ ...branchPaymentForm, paidDateIso: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">الاستحقاق القادم</label>
                  <input
                    type="date"
                    value={branchPaymentForm.feeDueDateIso}
                    onChange={(e) => setBranchPaymentForm({ ...branchPaymentForm, feeDueDateIso: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">ملاحظة</label>
                <input
                  value={branchPaymentForm.paymentNote}
                  onChange={(e) => setBranchPaymentForm({ ...branchPaymentForm, paymentNote: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setPaymentModalBranch(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold">
                  إلغاء
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold">
                  حفظ السداد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: Suspend Branch (Starts 30-Day Grace) */}
      {suspendBranchTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-base text-rose-600 dark:text-rose-400">
                تعليق الفرع: {suspendBranchTarget.name}
              </h2>
              <button type="button" onClick={() => setSuspendBranchTarget(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSuspendBranchSubmit} className="p-6 space-y-4 text-xs">
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                عند تعليق الفرع، لا يُحتسب ضمن الفروع المدفوعة وتبدأ مهلة <strong>30 يوماً</strong> لا يُسمح خلالها بحذف أي سجل. وإذا لم يتبق للمؤسسة أي فرع مدفوع، تبدأ مهلة 7 أيام لإيقاف المؤسسة.
              </p>
              <div>
                <label className="block font-semibold mb-1">سبب التعليق</label>
                <input
                  value={suspendBranchReason}
                  onChange={(e) => setSuspendBranchReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setSuspendBranchTarget(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold">
                  إلغاء
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold">
                  تأكيد التعليق (مهلة 30 يوماً)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 8: Reactivate Branch */}
      {reactivateBranchTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-base">إعادة تنشيط فرع: {reactivateBranchTarget.name}</h2>
              <button type="button" onClick={() => setReactivateBranchTarget(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleReactivateBranchSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">حالة السداد</label>
                  <select
                    value={reactivateBranchForm.paymentStatus}
                    onChange={(e) =>
                      setReactivateBranchForm({ ...reactivateBranchForm, paymentStatus: e.target.value as BranchPaymentStatus })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17]"
                  >
                    <option value="paid">مدفوع (50 ر.س)</option>
                    <option value="exempt">معفى</option>
                    <option value="unpaid">غير مدفوع</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">الاستحقاق القادم</label>
                  <input
                    type="date"
                    value={reactivateBranchForm.feeDueDateIso}
                    onChange={(e) => setReactivateBranchForm({ ...reactivateBranchForm, feeDueDateIso: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReactivateBranchTarget(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold">
                  إلغاء
                </button>
                <button type="submit" disabled={busyAction} className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold">
                  إعادة تنشيط الفرع
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 9: Drive Backup Verification & Strict Website-Only DB Purge */}
      {purgeModalBranch && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-base text-rose-600 dark:text-rose-400">
                فحص أرشفة Drive وحذف سجلات DB للفرع: {purgeModalBranch.name}
              </h2>
              <button type="button" onClick={() => setPurgeModalBranch(null)} className="p-1.5 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 leading-relaxed">
                يُحذف هذا الفرع <strong>من قاعدة بيانات الموقع (Firestore) فقط</strong> (الإقفالات، المشتريات، المرفقات، وسجل الأرشفة).{' '}
                <strong>ملفات Google Drive وسجلات التدقيق (auditLogs) لا تُحذف أبداً.</strong>
              </div>

              {!purgeInspection ? (
                <div className="py-6 text-center text-slate-500">جاري فحص اكتمال النسخ الاحتياطي على Google Drive...</div>
              ) : (
                <div className="space-y-3">
                  <div
                    className={`p-3.5 rounded-xl border ${
                      purgeInspection.verified
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    <div className="font-bold mb-1">
                      {purgeInspection.verified ? 'تم التحقق بنجاح — جاهز للتنظيف' : 'تم منع الحذف (فشل التحقق)'}
                    </div>
                    <p>{purgeInspection.reason}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 font-mono tabular-nums">
                    <div>الإقفالات الكلية: {purgeInspection.totalClosingsCount}</div>
                    <div>الإقفالات المعتمدة: {purgeInspection.approvedClosingsCount}</div>
                    <div>مؤرشفة بالكامل: {purgeInspection.verifiedArchivedCount}</div>
                    <div>قيد المراجعة: {purgeInspection.unapprovedPendingCount}</div>
                    <div>المشتريات: {purgeInspection.purchasesCount}</div>
                    <div>المرفقات: {purgeInspection.attachmentsCount}</div>
                  </div>

                  {purgeInspection.verified && (
                    <div>
                      <label className="block font-semibold mb-1">
                        اكتب <span className="font-mono font-bold text-rose-500">DELETE_DB_ONLY</span> لتأكيد التنظيف النهائي:
                      </label>
                      <input
                        value={purgeConfirmText}
                        onChange={(e) => setPurgeConfirmText(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070e17] font-mono"
                        dir="ltr"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setPurgeModalBranch(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold">
                  إغلاق
                </button>
                {purgeInspection?.verified && (
                  <button
                    type="button"
                    disabled={busyAction || purgeConfirmText.trim() !== 'DELETE_DB_ONLY'}
                    onClick={handleExecuteBranchDbPurge}
                    className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold disabled:opacity-40"
                  >
                    حذف سجلات الفرع من DB فقط
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 10: Organization Details Drawer */}
      {selectedOrg && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c1829] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">{selectedOrg.name}</h2>
                <p className="text-xs font-mono text-slate-500" dir="ltr">
                  {selectedOrg.id} · {selectedOrg.ownerEmail}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrgId(null)}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 pt-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDetailTab('branches')}
                className={`px-3 py-2 text-xs font-bold border-b-2 ${
                  detailTab === 'branches' ? 'border-amber-500 text-amber-500' : 'border-transparent text-slate-500'
                }`}
              >
                الفروع ({selectedOrgBranches.length})
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('users')}
                className={`px-3 py-2 text-xs font-bold border-b-2 ${
                  detailTab === 'users' ? 'border-amber-500 text-amber-500' : 'border-transparent text-slate-500'
                }`}
              >
                المستخدمون ({selectedOrgUsers.length})
              </button>
              {inviteByOrgId.get(selectedOrg.id) && (
                <span className="ms-auto text-[11px] text-slate-500 font-mono">
                  Invite: {inviteByOrgId.get(selectedOrg.id)?.status}
                </span>
              )}
            </div>

            <div className="p-6 overflow-y-auto space-y-3 text-xs">
              {detailTab === 'branches' ? (
                selectedOrgBranches.map((b) => {
                  const evalB = evaluateBranchBillingAndGrace(b, selectedOrg);
                  return (
                    <div key={b.id} className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white">{b.name} ({b.code})</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          الاستحقاق: {formatShortDate(evalB.feeDueAt)} · {evalB.monthlyFeeSar} ر.س/ش ({evalB.paymentStatus})
                        </div>
                      </div>
                      <span className="text-[11px] font-bold">
                        {evalB.isPurgedFromDb ? 'منظف' : evalB.isSuspended ? 'معلق' : 'نشط'}
                      </span>
                    </div>
                  );
                })
              ) : (
                selectedOrgUsers.map((u) => (
                  <div key={u.uid} className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{u.displayName}</div>
                      <div className="text-[11px] font-mono text-slate-500" dir="ltr">{u.email}</div>
                    </div>
                    <div className="text-end">
                      <div className="font-bold">{getUserRoleLabel(u.role, 'ar')}</div>
                      <div className="text-[11px] text-slate-500">{u.isActive ? 'نشط' : 'معطل'}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
