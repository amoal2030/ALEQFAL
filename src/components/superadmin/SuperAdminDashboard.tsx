import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { Branch, DriveHealthStatus, Organization, UserProfile } from '../../types';
import { AppPageRoute, buildLegalPath } from '../../utils/legalRoutes';
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
} from 'lucide-react';

interface SuperAdminDashboardProps {
  onSwitchToTenantDashboard?: () => void;
  onSwitchToOnboarding?: () => void;
  onNavigatePage?: (page: AppPageRoute) => void;
}

type OrgDriveFilter = 'all' | 'verified' | 'attention' | 'active' | 'suspended';

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
    logout,
  } = useAuth();
  const { language, setLanguage, direction, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<OrgDriveFilter>('all');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'branches' | 'users'>('branches');
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  // Defense-in-depth: never render or fetch if identity is not verified Super Admin
  useEffect(() => {
    if (isSuperAdmin) {
      loadSuperAdminOverview().catch(() => {
        // Error state is handled cleanly inside AuthContext
      });
    }
  }, [isSuperAdmin, currentUser?.uid]);

  const organizations = superAdminOverview?.organizations ?? [];
  const allBranches = superAdminOverview?.branches ?? [];
  const allUsers = superAdminOverview?.users ?? [];

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

  const stats = useMemo(() => {
    const managersCount = allUsers.filter((u) => u.role === 'manager').length;
    const employeesCount = allUsers.filter((u) => u.role === 'employee').length;

    const orgsWithIsActive = organizations.filter((o) => typeof o.isActive === 'boolean');
    const hasIsActiveField = orgsWithIsActive.length > 0;
    const activeOrgsCount = organizations.filter((o) => o.isActive === true).length;
    const suspendedOrgsCount = organizations.filter((o) => o.isActive === false).length;

    const driveConnectedCount = organizations.filter((o) => o.driveConnected).length;
    const driveVerifiedCount = organizations.filter(
      (o) => o.driveConnected && o.driveWriteVerified === true && o.driveLastHealthStatus !== 'failed'
    ).length;
    const driveFailedCount = organizations.filter(
      (o) => o.driveLastHealthStatus === 'failed'
    ).length;
    const driveUnlinkedCount = organizations.filter((o) => !o.driveConnected).length;

    return {
      totalOrgs: organizations.length,
      totalBranches: allBranches.length,
      totalUsers: allUsers.length,
      managersCount,
      employeesCount,
      hasIsActiveField,
      orgsWithIsActiveCount: orgsWithIsActive.length,
      activeOrgsCount,
      suspendedOrgsCount,
      driveConnectedCount,
      driveVerifiedCount,
      driveFailedCount,
      driveUnlinkedCount,
    };
  }, [organizations, allBranches, allUsers]);

  const filteredOrganizations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return organizations.filter((org) => {
      if (activeFilter === 'verified') {
        if (!(org.driveConnected && org.driveWriteVerified && org.driveLastHealthStatus !== 'failed')) {
          return false;
        }
      } else if (activeFilter === 'attention') {
        if (org.driveConnected && org.driveWriteVerified && org.driveLastHealthStatus !== 'failed') {
          return false;
        }
      } else if (activeFilter === 'active') {
        if (org.isActive !== true) return false;
      } else if (activeFilter === 'suspended') {
        if (org.isActive !== false) return false;
      }

      if (!term) return true;
      return (
        org.name?.toLowerCase().includes(term) ||
        org.id?.toLowerCase().includes(term) ||
        org.ownerName?.toLowerCase().includes(term) ||
        org.ownerEmail?.toLowerCase().includes(term) ||
        (org.driveAccountEmail || '').toLowerCase().includes(term)
      );
    });
  }, [organizations, searchTerm, activeFilter]);

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

  const renderHealthLabel = (status?: DriveHealthStatus) => {
    switch (status) {
      case 'verified':
        return {
          text: 'سليم ومتحقق',
          className: 'text-emerald-600 dark:text-emerald-400',
          icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
        };
      case 'failed':
        return {
          text: 'فشل التحقق',
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
          text: 'غير مختبر',
          className: 'text-amber-600 dark:text-amber-400',
          icon: <Clock className="w-3.5 h-3.5 shrink-0" />,
        };
    }
  };

  const formatIsoDate = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(language === 'en' ? 'en-US' : 'ar-SA');
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
            {/* Zone 1: Brand & Portal Context */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#0b192c] border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                  لوحة مراقبة المدير الرئيسي
                </h1>
                <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
                  <span>الإقفال | AL EQFAL</span>
                  <span aria-hidden="true">·</span>
                  <span>مراقبة المنصة (قراءة فقط)</span>
                </div>
              </div>
            </div>

            {/* Zone 2 & 3: Controls */}
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
                  <span className="hidden md:inline">تأسيس مؤسسة</span>
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
                    <button
                      type="button"
                      onClick={() => {
                        setLanguage('ar');
                        setLangMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      العربية
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLanguage('en');
                        setLangMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      English
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLanguage('ur');
                        setLangMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      اردو
                    </button>
                  </div>
                )}
              </div>

              <div className="hidden lg:flex flex-col text-end ps-2 border-s border-slate-200 dark:border-slate-800">
                <span className="text-xs font-bold text-slate-900 dark:text-white">المدير الرئيسي</span>
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
        {/* Read-Only Governance Notice */}
        <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-bold text-slate-900 dark:text-white text-sm">
                وضع المراقبة الشاملة للقراءة فقط (المرحلة الأولى)
              </p>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                تعرض هذه الشاشة إحصائيات المنصة وحالة ربط Google Drive من البيانات الوصفية المخزنة في Cloud Firestore فقط دون أي صلاحيات تعديل أو اتصال بحسابات Drive الخارجية للمؤسسات.
              </p>
            </div>
          </div>
          {superAdminOverview?.fetchedAt && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              آخر تحديث: {formatIsoDate(superAdminOverview.fetchedAt)}
            </div>
          )}
        </div>

        {superAdminError && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{superAdminError}</span>
            </div>
            <button
              type="button"
              onClick={() => loadSuperAdminOverview()}
              className="px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 font-semibold whitespace-nowrap shrink-0"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* 6 Platform KPI Cards */}
        <section aria-label="إحصائيات المنصة العامة" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="bg-white dark:bg-[#0c1829] rounded-2xl p-5 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              إجمالي المؤسسات
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
              {superAdminLoading && !superAdminOverview ? '—' : stats.totalOrgs}
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              جميع الكيانات المسجلة
            </span>
          </div>

          <div className="bg-white dark:bg-[#0c1829] rounded-2xl p-5 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              إجمالي الفروع
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
              {superAdminLoading && !superAdminOverview ? '—' : stats.totalBranches}
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              عبر كافة المؤسسات
            </span>
          </div>

          <div className="bg-white dark:bg-[#0c1829] rounded-2xl p-5 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              إجمالي المستخدمين
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
              {superAdminLoading && !superAdminOverview ? '—' : stats.totalUsers}
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              حسابات النظام المسجلة
            </span>
          </div>

          <div className="bg-white dark:bg-[#0c1829] rounded-2xl p-5 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              المديرون والموظفون
            </span>
            <div className="text-lg font-black text-slate-900 dark:text-white font-mono tabular-nums flex items-baseline gap-2">
              <span className="text-amber-500">{superAdminLoading && !superAdminOverview ? '—' : stats.managersCount}</span>
              <span className="text-xs font-sans font-normal text-slate-400">/</span>
              <span className="text-sky-500">{superAdminLoading && !superAdminOverview ? '—' : stats.employeesCount}</span>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              مديرون · موظفو صندوق
            </span>
          </div>

          <div className="bg-white dark:bg-[#0c1829] rounded-2xl p-5 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              المؤسسات النشطة والموقوفة
            </span>
            {stats.hasIsActiveField ? (
              <>
                <div className="text-lg font-black font-mono tabular-nums flex items-baseline gap-2">
                  <span className="text-emerald-600 dark:text-emerald-400">{stats.activeOrgsCount}</span>
                  <span className="text-xs font-sans font-normal text-slate-400">/</span>
                  <span className="text-rose-600 dark:text-rose-400">{stats.suspendedOrgsCount}</span>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  نشطة · موقوفة (حقل isActive)
                </span>
              </>
            ) : (
              <>
                <div className="text-sm font-bold text-slate-700 dark:text-slate-300 pt-1">
                  غير مفعّل بعد
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  لا يوجد حقل isActive في المستندات الحالية
                </span>
              </>
            )}
          </div>

          <div className="bg-white dark:bg-[#0c1829] rounded-2xl p-5 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              ربط Google Drive
            </span>
            <div className="text-lg font-black font-mono tabular-nums flex items-baseline gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">{stats.driveVerifiedCount}</span>
              <span className="text-xs font-sans font-normal text-slate-400">/</span>
              <span className="text-slate-700 dark:text-slate-300">{stats.driveConnectedCount}</span>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              موثق الكتابة · متصل ({stats.driveFailedCount} خطأ · {stats.driveUnlinkedCount} غير مربوط)
            </span>
          </div>
        </section>

        {/* Search & Segmented Filters */}
        <div className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث باسم المؤسسة، المعرف، المالك، أو بريد Drive..."
              className="w-full ps-10 pe-4 py-2.5 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-[#070e17] rounded-xl border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                activeFilter === 'all'
                  ? 'bg-white dark:bg-[#0c1829] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              الكل ({organizations.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('verified')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                activeFilter === 'verified'
                  ? 'bg-white dark:bg-[#0c1829] text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Drive موثق ({stats.driveVerifiedCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('attention')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                activeFilter === 'attention'
                  ? 'bg-white dark:bg-[#0c1829] text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              يحتاج ربط/فحص ({organizations.length - stats.driveVerifiedCount})
            </button>
            {stats.hasIsActiveField && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveFilter('active')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    activeFilter === 'active'
                      ? 'bg-white dark:bg-[#0c1829] text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  نشطة ({stats.activeOrgsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('suspended')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    activeFilter === 'suspended'
                      ? 'bg-white dark:bg-[#0c1829] text-rose-600 dark:text-rose-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  موقوفة ({stats.suspendedOrgsCount})
                </button>
              </>
            )}
          </div>
        </div>

        {/* Organizations Table (Desktop) & Cards (Mobile) */}
        <section className="bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-500" />
              <span>سجل المؤسسات وحالة Google Drive ({filteredOrganizations.length})</span>
            </h2>
          </div>

          {superAdminLoading && !superAdminOverview ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              جاري قراءة بيانات المؤسسات والفروع والمستخدمين من Cloud Firestore...
            </div>
          ) : filteredOrganizations.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <p className="font-semibold text-slate-700 dark:text-slate-300">
                لا توجد مؤسسات مطابقة للبحث أو التصفية الحالية.
              </p>
              {(searchTerm || activeFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setActiveFilter('all');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold"
                >
                  إعادة ضبط البحث
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop Data Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-start text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold">
                    <tr>
                      <th className="p-3.5 text-start">المؤسسة</th>
                      <th className="p-3.5 text-start">المعرف</th>
                      <th className="p-3.5 text-start">المالك</th>
                      <th className="p-3.5 text-start">العملة</th>
                      <th className="p-3.5 text-start">الفروع / المستخدمون</th>
                      <th className="p-3.5 text-start">حالة المؤسسة</th>
                      <th className="p-3.5 text-start">اتصال Drive</th>
                      <th className="p-3.5 text-start">بريد Drive</th>
                      <th className="p-3.5 text-start">التحقق من الكتابة</th>
                      <th className="p-3.5 text-start">آخر حالة صحية</th>
                      <th className="p-3.5 text-start">التفاصيل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredOrganizations.map((org) => {
                      const orgBranchCount = (branchesByOrg.get(org.id) || []).length;
                      const orgUserCount = (usersByOrg.get(org.id) || []).length;
                      const health = renderHealthLabel(org.driveLastHealthStatus);
                      const orgStatusText =
                        org.isActive === true
                          ? 'نشطة'
                          : org.isActive === false
                          ? 'موقوفة'
                          : 'غير محدد';

                      return (
                        <tr
                          key={org.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="p-3.5 font-bold text-slate-900 dark:text-white">
                            <div className="max-w-[180px] truncate" title={org.name}>
                              {org.name}
                            </div>
                          </td>
                          <td className="p-3.5 font-mono text-[11px] text-slate-500 dark:text-slate-400" dir="ltr">
                            <span className="max-w-[140px] inline-block truncate" title={org.id}>
                              {org.id}
                            </span>
                          </td>
                          <td className="p-3.5">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              {org.ownerName || '—'}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                              {org.ownerEmail || '—'}
                            </div>
                          </td>
                          <td className="p-3.5 font-mono font-bold text-slate-700 dark:text-slate-300">
                            {org.currency || '—'}
                          </td>
                          <td className="p-3.5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            <span>{orgBranchCount} فرع</span>
                            <span className="mx-1.5 text-slate-400">·</span>
                            <span>{orgUserCount} مستخدم</span>
                          </td>
                          <td className="p-3.5 font-semibold">
                            <span
                              className={
                                org.isActive === true
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : org.isActive === false
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }
                            >
                              {orgStatusText}
                            </span>
                          </td>
                          <td className="p-3.5 font-semibold">
                            <span
                              className={
                                org.driveConnected
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }
                            >
                              {org.driveConnected ? 'متصل' : 'غير متصل'}
                            </span>
                          </td>
                          <td className="p-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-300" dir="ltr">
                            {org.driveAccountEmail || '—'}
                          </td>
                          <td className="p-3.5">
                            <span
                              className={`font-semibold ${
                                org.driveWriteVerified
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {org.driveWriteVerified ? 'تم التحقق' : 'غير متحقق'}
                            </span>
                            {org.driveWriteVerifiedAt && (
                              <div className="text-[10px] font-mono text-slate-400 mt-0.5 tabular-nums">
                                {formatIsoDate(org.driveWriteVerifiedAt)}
                              </div>
                            )}
                          </td>
                          <td className="p-3.5">
                            <div className={`inline-flex items-center gap-1.5 font-semibold ${health.className}`}>
                              {health.icon}
                              <span>{health.text}</span>
                            </div>
                            {org.driveHealthError && (
                              <div
                                className="text-[10px] text-rose-500 max-w-[180px] truncate mt-0.5"
                                title={org.driveHealthError}
                              >
                                {org.driveHealthError}
                              </div>
                            )}
                          </td>
                          <td className="p-3.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedOrgId(org.id);
                                setDetailTab('branches');
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-amber-500/15 hover:text-amber-600 dark:hover:text-amber-400 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>استعراض</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile / Tablet Cards */}
              <div className="lg:hidden divide-y divide-slate-200 dark:divide-slate-800">
                {filteredOrganizations.map((org) => {
                  const orgBranchCount = (branchesByOrg.get(org.id) || []).length;
                  const orgUserCount = (usersByOrg.get(org.id) || []).length;
                  const health = renderHealthLabel(org.driveLastHealthStatus);

                  return (
                    <div key={org.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {org.name}
                          </h3>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate" dir="ltr">
                            {org.id}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOrgId(org.id);
                            setDetailTab('branches');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>التفاصيل</span>
                        </button>
                      </div>

                      <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                        <div>
                          المالك: <span className="font-semibold">{org.ownerName}</span>
                          <span className="mx-1.5 text-slate-400">·</span>
                          <span className="font-mono text-[11px]" dir="ltr">{org.ownerEmail}</span>
                        </div>
                        <div className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                          العملة: {org.currency} · {orgBranchCount} فرع · {orgUserCount} مستخدم
                          {typeof org.isActive === 'boolean' && (
                            <> · {org.isActive ? 'نشطة' : 'موقوفة'}</>
                          )}
                        </div>
                        <div className="text-[11px] flex flex-wrap items-center gap-2 pt-1">
                          <span className={org.driveConnected ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-500'}>
                            Drive: {org.driveConnected ? 'متصل' : 'غير متصل'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono" dir="ltr">{org.driveAccountEmail || '—'}</span>
                          <span aria-hidden="true">·</span>
                          <span className={`inline-flex items-center gap-1 font-semibold ${health.className}`}>
                            {health.icon}
                            <span>{health.text}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </main>

      {/* Read-Only Organization Details Modal */}
      {selectedOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-sm">
          <div
            className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-white dark:bg-[#0c1829] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
            dir={direction}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                  {selectedOrg.name}
                </h3>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate" dir="ltr">
                  {selectedOrg.id} · {selectedOrg.currency} · {selectedOrg.activityType}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrgId(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="إغلاق التفاصيل"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Organization & Drive Metadata Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 space-y-2">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-amber-500" />
                    <span>بيانات المؤسسة والمالك</span>
                  </h4>
                  <div className="space-y-1 text-slate-600 dark:text-slate-300">
                    <div>المالك: <span className="font-semibold">{selectedOrg.ownerName || '—'}</span></div>
                    <div>البريد: <span className="font-mono" dir="ltr">{selectedOrg.ownerEmail || '—'}</span></div>
                    <div>السجل التجاري: <span className="font-mono">{selectedOrg.commercialRegistration || '—'}</span></div>
                    <div>
                      حالة المؤسسة:{' '}
                      <span className="font-semibold">
                        {selectedOrg.isActive === true
                          ? 'نشطة'
                          : selectedOrg.isActive === false
                          ? 'موقوفة'
                          : 'غير محدد'}
                      </span>
                    </div>
                    <div>تاريخ التأسيس: <span className="font-mono tabular-nums">{formatIsoDate(selectedOrg.createdAt)}</span></div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#070e17] border border-slate-200 dark:border-slate-800 space-y-2">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-amber-500" />
                    <span>البيانات الوصفية لـ Google Drive (قراءة فقط)</span>
                  </h4>
                  <div className="space-y-1 text-slate-600 dark:text-slate-300">
                    <div>حالة الاتصال: <span className="font-semibold">{selectedOrg.driveConnected ? 'متصل' : 'غير متصل'}</span></div>
                    <div>بريد Google المرتبط: <span className="font-mono" dir="ltr">{selectedOrg.driveAccountEmail || '—'}</span></div>
                    <div>التحقق من الكتابة: <span className="font-semibold">{selectedOrg.driveWriteVerified ? 'تم التحقق' : 'غير متحقق'}</span></div>
                    <div>آخر تحقق كتابة: <span className="font-mono tabular-nums">{formatIsoDate(selectedOrg.driveWriteVerifiedAt)}</span></div>
                    <div>اسم مجلد المؤسسة: <span>{selectedOrg.driveFolderName || '—'}</span></div>
                    <div>الحالة الصحية: <span className="font-semibold">{renderHealthLabel(selectedOrg.driveLastHealthStatus).text}</span></div>
                    {selectedOrg.driveHealthError && (
                      <div className="text-rose-600 dark:text-rose-400 pt-1">
                        تفاصيل الخطأ: {selectedOrg.driveHealthError}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sub-Tabs: Branches & Users */}
              <div>
                <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                  <button
                    type="button"
                    onClick={() => setDetailTab('branches')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
                      detailTab === 'branches'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>فروع المؤسسة ({selectedOrgBranches.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('users')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
                      detailTab === 'users'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>مستخدمو المؤسسة ({selectedOrgUsers.length})</span>
                  </button>
                </div>

                {detailTab === 'branches' ? (
                  selectedOrgBranches.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                      لا توجد فروع مسجلة لهذه المؤسسة.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                      <table className="w-full text-start text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="p-3 text-start">الفرع</th>
                            <th className="p-3 text-start">الرمز</th>
                            <th className="p-3 text-start">العنوان</th>
                            <th className="p-3 text-start">الهاتف</th>
                            <th className="p-3 text-start">الحالة</th>
                            <th className="p-3 text-start">مجلد Drive</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {selectedOrgBranches.map((br) => (
                            <tr key={br.id}>
                              <td className="p-3 font-bold text-slate-900 dark:text-white">{br.name}</td>
                              <td className="p-3 font-mono text-slate-600 dark:text-slate-300">{br.code}</td>
                              <td className="p-3 text-slate-600 dark:text-slate-300">{br.address || '—'}</td>
                              <td className="p-3 font-mono text-slate-600 dark:text-slate-300" dir="ltr">{br.phone || '—'}</td>
                              <td className="p-3 font-semibold">
                                <span className={br.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                  {br.isActive ? 'نشط' : 'معطل'}
                                </span>
                              </td>
                              <td className="p-3 text-slate-600 dark:text-slate-300">{br.driveFolderName || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : selectedOrgUsers.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    لا يوجد مستخدمون مسجلون لهذه المؤسسة.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-start text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="p-3 text-start">الاسم</th>
                          <th className="p-3 text-start">البريد الإلكتروني</th>
                          <th className="p-3 text-start">الدور</th>
                          <th className="p-3 text-start">الفرع</th>
                          <th className="p-3 text-start">الهاتف</th>
                          <th className="p-3 text-start">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedOrgUsers.map((usr) => (
                          <tr key={usr.uid}>
                            <td className="p-3 font-bold text-slate-900 dark:text-white">{usr.displayName}</td>
                            <td className="p-3 font-mono text-slate-600 dark:text-slate-300" dir="ltr">{usr.email}</td>
                            <td className="p-3 font-semibold">
                              <span className={usr.role === 'manager' ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400'}>
                                {usr.role === 'manager' ? 'مدير' : 'موظف'}
                              </span>
                            </td>
                            <td className="p-3 text-slate-600 dark:text-slate-300">{usr.branchName || (usr.role === 'manager' ? 'جميع الفروع' : '—')}</td>
                            <td className="p-3 font-mono text-slate-600 dark:text-slate-300" dir="ltr">{usr.phone || '—'}</td>
                            <td className="p-3 font-semibold">
                              <span className={usr.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                {usr.isActive ? 'نشط' : 'معطل'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 dark:border-slate-800/80 py-4 text-xs text-slate-500 dark:text-slate-400 bg-white/40 dark:bg-[#0c1829]/40">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>© {new Date().getFullYear()} الإقفال | AL EQFAL</p>
          <div className="flex items-center gap-3">
            <a
              href={buildLegalPath('privacy')}
              onClick={(e) => {
                if (onNavigatePage && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
                  e.preventDefault();
                  onNavigatePage('privacy');
                }
              }}
              className="hover:text-amber-500 transition-colors font-medium"
            >
              {t('privacyPolicy')}
            </a>
            <span aria-hidden="true">·</span>
            <a
              href={buildLegalPath('terms')}
              onClick={(e) => {
                if (onNavigatePage && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
                  e.preventDefault();
                  onNavigatePage('terms');
                }
              }}
              className="hover:text-amber-500 transition-colors font-medium"
            >
              {t('termsOfService')}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
