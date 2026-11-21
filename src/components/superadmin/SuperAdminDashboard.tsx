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
import { BrandLogo } from '../common/BrandLogo';
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
type OrgFilter = 'all' | 'active' | 'exempt' | 'legacy' | 'grace_7d' | 'suspended' | 'attention';
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
    grantSuperAdminOrgBillingExemption,
    revokeSuperAdminOrgBillingExemption,
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

  // Permanent Billing Exemption Modal state (Super Admin only)
  const [exemptionModalOrg, setExemptionModalOrg] = useState<Organization | null>(null);
  const [exemptionReason, setExemptionReason] = useState('');

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
      exemptOrgsCount,
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

  const handleBillingExemptionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exemptionModalOrg) return;
    clearFeedback();
    setBusyAction(true);
    try {
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
          reason: exemptionReason,
        });
        setActionSuccess(
          `تم اعتماد الإعفاء الدائم الشامل للمؤسسة "${exemptionModalOrg.name}" للمالك الموثق ${res.ownerEmail} (${res.ownerId}) — سجل التدقيق: ${res.auditLogId}.`
        );
      }
      setExemptionModalOrg(null);
      setExemptionReason('');
    } catch (err: any) {
      setActionError(err?.message || 'تعذر تحديث حالة الإعفاء الدائم للمؤسسة.');
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
                                    {subEval.isAllowed
                                      ? tr('إعفاء دائم شامل (billing_exempt)', 'Permanent Full Exemption (billing_exempt)', 'مستقل مکمل استثنیٰ (billing_exempt)')
                                      : tr('إعفاء دائم (موقوفة إدارياً)', 'Permanent Exempt (Admin Suspended)', 'مستقل استثنیٰ (انتظامی معطل)')}
                                  </span>
                                  {(subEval.startDate || subEval.endDate) && (
                                    <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                      {tr('تاريخي:', 'History:', 'تاریخی:')} {formatShortDate(subEval.startDate)} → {formatShortDate(subEval.endDate)}
                                    </div>
                                  )}
                                </div>
                              ) : subEval.isLegacy ? (
                                <span className="inline-block px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-bold">
                                  {subEval.isAllowed
                                    ? tr('قديمة معفاة (legacy_unrestricted)', 'Legacy Exempt (legacy_unrestricted)', 'سابقہ مستثنیٰ (legacy_unrestricted)')
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
                                  onClick={() => {
                                    clearFeedback();
                                    setExemptionModalOrg(org);
                                    setExemptionReason(
                                      org.billingExempt === true
                                        ? ''
                                        : 'إعفاء دائم شامل معتمد من المدير الرئيسي للمؤسسة وفروعها الحالية والمستقبلية'
                                    );
                                  }}
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
                              <div className="text-[11px] mt-0.5">
                                {tr('الحالة:', 'Status:', 'حیثیت:')}{' '}
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
                              </div>
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

        {/* TAB 4: Platform Audit Logs */}
        {mainTab === 'auditLogs' && (
          <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden shadow-sm">
            {filteredAuditLogs.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  'لا توجد أحداث مسجلة في سجل عمليات صاحب الموقع حتى الآن.',
                  'No events recorded in the platform owner audit log yet.',
                  'پلیٹ فارم مالک کے آڈٹ لاگ میں ابھی تک کوئی سرگرمی درج نہیں ہے۔'
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start border-collapse">
                  <thead>
                    <tr className="border-b border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      <th className="py-3.5 px-4 text-start">{tr('الوقت', 'Timestamp', 'وقت')}</th>
                      <th className="py-3.5 px-4 text-start">{tr('العملية', 'Action', 'کارروائی')}</th>
                      <th className="py-3.5 px-4 text-start">{tr('الهدف', 'Target', 'ہدف')}</th>
                      <th className="py-3.5 px-4 text-start">{tr('التفاصيل', 'Details', 'تفصیلات')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66] text-xs">
                    {filteredAuditLogs.map((log: PlatformAuditLog) => (
                      <tr key={log.id} className="hover:bg-[#F5F8FF]/60 dark:hover:bg-[#173056]/30">
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap" dir="ltr">
                          {formatIsoDate(log.timestamp)}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] font-bold text-[#1764FF] dark:text-[#6CA2FF]">
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
                      <option value="exempt">{tr('معفى', 'Exempt', 'مستثنیٰ')}</option>
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
                    <option value="exempt">{tr('معفى', 'Exempt', 'مستثنیٰ')}</option>
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
                selectedOrgBranches.map((b) => {
                  const evalB = evaluateBranchBillingAndGrace(b, selectedOrg);
                  return (
                    <div key={b.id} className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold text-[#0B1B32] dark:text-white">{b.name} ({b.code})</div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {tr('الاستحقاق:', 'Due:', 'مقررہ تاریخ:')} {formatShortDate(evalB.feeDueAt)} · {evalB.monthlyFeeSar} {tr('ر.س/ش', 'SAR/mo', 'ریال/ماہ')} ({evalB.paymentStatus})
                        </div>
                      </div>
                      <span className="text-[11px] font-bold">
                        {evalB.isPurgedFromDb
                          ? tr('منظف', 'Purged', 'صاف شدہ')
                          : evalB.isSuspended
                          ? tr('معلق', 'Suspended', 'معطل')
                          : tr('نشط', 'Active', 'فعال')}
                      </span>
                    </div>
                  );
                })
              ) : (
                selectedOrgUsers.map((u) => (
                  <div key={u.uid} className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-[#0B1B32] dark:text-white">{u.displayName}</div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400" dir="ltr">{u.email}</div>
                    </div>
                    <div className="text-end">
                      <div className="font-bold">{getUserRoleLabel(u.role, language)}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {u.isActive ? tr('نشط', 'Active', 'فعال') : tr('معطل', 'Disabled', 'معطل')}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Official Permanent Billing Exemption (Super Admin Only — Owner-Verified & Atomically Audited) */}
      {exemptionModalOrg && (() => {
        const isCurrentlyExempt = exemptionModalOrg.billingExempt === true;
        const ownerEmailLower = (exemptionModalOrg.ownerEmail || '').trim().toLowerCase();
        const ownerIdClean = (exemptionModalOrg.ownerId || '').trim();
        const matchedOwnerUser = ownerIdClean
          ? allUsers.find((u) => u.uid === ownerIdClean)
          : undefined;
        const ownerDocVerified = Boolean(
          ownerIdClean &&
            ownerEmailLower.length >= 3 &&
            matchedOwnerUser &&
            matchedOwnerUser.orgId === exemptionModalOrg.id &&
            matchedOwnerUser.role === 'manager' &&
            (matchedOwnerUser.email || '').trim().toLowerCase() === ownerEmailLower
        );
        const canSubmit =
          !busyAction &&
          exemptionReason.trim().length >= 5 &&
          (isCurrentlyExempt || ownerDocVerified);

        return (
          <div className="fixed inset-0 z-50 bg-[#0B1B32]/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between">
                <h2 className="font-bold text-base flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    {isCurrentlyExempt
                      ? tr('إلغاء الإعفاء الدائم الشامل', 'Revoke Permanent Billing Exemption', 'مستقل فیس استثنیٰ منسوخ کریں')
                      : tr('منح الإعفاء الدائم الشامل', 'Grant Permanent Full Billing Exemption', 'مستقل مکمل فیس استثنیٰ دیں')}
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

              <form onSubmit={handleBillingExemptionSubmit} className="p-6 space-y-4 text-xs">
                <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('المؤسسة:', 'Organization:', 'ادارہ:')}</span>
                    <span className="font-bold text-[#0B1B32] dark:text-white">{exemptionModalOrg.name}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('معرّف المؤسسة (orgId):', 'Org ID:', 'ادارہ آئی ڈی:')}</span>
                    <span className="font-mono text-[#0B1B32] dark:text-slate-200" dir="ltr">{exemptionModalOrg.id}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('معرّف المالك (ownerId):', 'Owner UID:', 'مالک آئی ڈی:')}</span>
                    <span className="font-mono text-[#0B1B32] dark:text-slate-200" dir="ltr">
                      {ownerIdClean || tr('غير مربوط بعد', 'Not linked yet', 'ابھی منسلک نہیں')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('بريد المالك الموحّد:', 'Normalized Owner Email:', 'مالک کی ای میل:')}</span>
                    <span className="font-mono text-[#0B1B32] dark:text-slate-200" dir="ltr">{ownerEmailLower || '—'}</span>
                  </div>
                  <div className="pt-2 border-t border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between gap-2">
                    <span className="text-slate-500">{tr('التحقق من وثيقة المالك (users):', 'Owner Doc Verification:', 'مالک دستاویز کی تصدیق:')}</span>
                    {ownerDocVerified ? (
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{tr('مطابق وموثّق', 'Verified Match', 'تصدیق شدہ')}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{tr('غير مكتمل — لا يمكن المنح', 'Unverified — Blocked', 'غیر تصدیق شدہ — ممنوع')}</span>
                      </span>
                    )}
                  </div>
                </div>

                {!isCurrentlyExempt && !ownerDocVerified && (
                  <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 leading-relaxed">
                    {tr(
                      'لا يمكن منح الإعفاء الدائم اعتماداً على البريد الإلكتروني وحده. يجب أن يكون للمؤسسة ownerId مربوط بوثيقة users/{ownerId} مطابقة بدور manager ونفس البريد والمؤسسة.',
                      'Permanent exemption cannot be granted by email alone. The organization must have a bound ownerId matching a users/{ownerId} manager document with the same orgId and email.',
                      'صرف ای میل کی بنیاد پر مستقل استثنیٰ نہیں دیا جا سکتا۔ مالک کی ownerId اور users دستاویز کی تصدیق لازمی ہے۔'
                    )}
                  </div>
                )}

                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-slate-700 dark:text-slate-200 leading-relaxed">
                  {isCurrentlyExempt
                    ? tr(
                        'سيؤدي الإلغاء إلى إعادة المؤسسة لنظام الاشتراكات القياسي فوراً دون حذف أي سجلات تاريخية للاشتراكات أو الفواتير، مع تسجيل الإجراء ذرياً في platformAuditLogs.',
                        'Revoking restores standard subscription rules immediately without deleting any historical billing records, coupled atomically with a platformAuditLogs entry.',
                        'منسوخی کے بعد ادارہ بغیر کوئی تاریخی ریکارڈ حذف کیے معمول کے سبسکرپشن نظام پر واپس آ جائے گا۔'
                      )
                    : tr(
                        'يشمل الإعفاء الدائم الشامل: رسوم الاشتراك الحالية والمستقبلية، رسوم التأسيس، رسوم إعادة التنشيط، وجميع الفروع الحالية والمستقبلية (0 ر.س) مع الاحتفاظ بكامل السجلات التاريخية دون حذف، وربط ذرّي إلزامي بسجل platformAuditLogs.',
                        'Full permanent exemption covers all current & future subscription fees, setup/reactivation fees, and all current & future branches (0 SAR), preserving all historical records and creating a mandatory atomic platformAuditLogs entry.',
                        'یہ مستقل استثنیٰ موجودہ اور مستقبل کی تمام سبسکرپشن، سیٹ اپ اور برانچ فیس (0 ریال) کا احاطہ کرتا ہے اور تمام تاریخی ریکارڈز محفوظ رہتے ہیں۔'
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
                    placeholder={
                      isCurrentlyExempt
                        ? tr('اكتب سبب إلغاء الإعفاء للتوثيق في سجل المنصة...', 'Enter revocation reason for platform audit log...', 'منسوخی کی وجہ درج کریں...')
                        : tr('اكتب سبب اعتماد الإعفاء الدائم للتوثيق في سجل المنصة...', 'Enter exemption approval reason for platform audit log...', 'استثنیٰ کی وجہ درج کریں...')
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-[#F5F8FF] dark:bg-[#0E203A] outline-none focus:border-[#1764FF]"
                  />
                </div>

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
                      : tr('اعتماد الإعفاء الدائم الشامل', 'Confirm Grant Full Exemption', 'مستقل استثنیٰ منظور کریں')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
