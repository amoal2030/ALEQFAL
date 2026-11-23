import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { ManagerOverview } from './manager/ManagerOverview';
import { BranchesManager } from './manager/BranchesManager';
import { EmployeesManager } from './manager/EmployeesManager';
import { ClosingsReview } from './manager/ClosingsReview';
import { FinancialReports } from './manager/FinancialReports';
import { AuditLogsView } from './manager/AuditLogsView';
import { SettingsView } from './manager/SettingsView';
import { EmployeeDashboard } from './employee/EmployeeDashboard';
import { PurchaseEntryView } from './purchases/PurchaseEntryView';
import { PurchaseReportsView } from './manager/PurchaseReportsView';
import { SuppliersManager } from './suppliers/SuppliersManager';
import { useTheme } from '../context/ThemeContext';
import { AppNotification, NotificationNavTarget } from '../types';
import { getActiveDriveSession } from '../services/driveService';
import { AppPageRoute, buildLegalPath } from '../utils/legalRoutes';
import { getUserRoleLabel, resolveEffectivePermissions } from '../utils/permissions';
import {
  ManagerDashboardTab,
  resolveTenantNotificationRoute,
  StaffDashboardTab,
} from '../utils/notifications';
import { NotificationCenter } from './common/NotificationCenter';
import { BrandLogo } from './common/BrandLogo';
import {
  LogOut,
  GitBranch,
  Users,
  FileSpreadsheet,
  FileText,
  History,
  TrendingUp,
  ShieldCheck,
  Settings,
  Sun,
  Moon,
  Globe,
  ChevronDown,
  AlertTriangle,
  Clock,
  ShoppingBag,
  Truck,
  BarChart3,
} from 'lucide-react';

interface DashboardProps {
  onNavigatePage?: (page: AppPageRoute) => void;
  onOpenSuperAdmin?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigatePage, onOpenSuperAdmin }) => {
  const {
    currentUser,
    userProfile,
    currentOrg,
    branches,
    currentBranch,
    closings,
    driveReadiness,
    logout,
    isSuperAdmin,
  } = useAuth();
  const { t, tr, language, setLanguage, direction } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const isManager = userProfile?.role === 'manager';
  const effectivePerms = resolveEffectivePermissions(userProfile);
  const canSupervisorReviewClosings =
    !isManager &&
    userProfile?.role === 'supervisor' &&
    (effectivePerms.canApproveClosings || effectivePerms.canViewAllClosings);
  const canSupervisorViewReports =
    !isManager &&
    userProfile?.role === 'supervisor' &&
    effectivePerms.canViewFinancialReports;
  const canStaffManagePurchases =
    !isManager &&
    (userProfile?.role === 'supervisor' || userProfile?.role === 'branch_manager') &&
    effectivePerms.canManagePurchases;
  const canStaffCreateSuppliers =
    !isManager &&
    (userProfile?.role === 'supervisor' || userProfile?.role === 'branch_manager') &&
    effectivePerms.canCreateSuppliers;
  const hasStaffExtraTabs =
    canStaffManagePurchases ||
    canStaffCreateSuppliers ||
    canSupervisorReviewClosings ||
    canSupervisorViewReports;

  // Manager navigation tab state (Purchase Reports replaces Purchase Entry for Manager)
  const [managerTab, setManagerTab] = useState<ManagerDashboardTab>('overview');
  const [staffTab, setStaffTab] = useState<StaffDashboardTab>('workspace');
  const [purchaseNavFocus, setPurchaseNavFocus] = useState<{
    purchaseId?: string;
    branchId?: string;
    nonce: number;
  } | null>(null);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [hasActiveDriveSession, setHasActiveDriveSession] = useState<boolean>(() =>
    Boolean(getActiveDriveSession(currentOrg?.id))
  );

  useEffect(() => {
    if (staffTab === 'purchases' && !canStaffManagePurchases) {
      setStaffTab('workspace');
    } else if (staffTab === 'suppliers' && !canStaffCreateSuppliers) {
      setStaffTab('workspace');
    } else if (staffTab === 'closings' && !canSupervisorReviewClosings) {
      setStaffTab('workspace');
    } else if (staffTab === 'reports' && !canSupervisorViewReports) {
      setStaffTab('workspace');
    }
  }, [
    staffTab,
    canStaffManagePurchases,
    canStaffCreateSuppliers,
    canSupervisorReviewClosings,
    canSupervisorViewReports,
  ]);

  useEffect(() => {
    const syncSessionFlag = () => setHasActiveDriveSession(Boolean(getActiveDriveSession(currentOrg?.id)));
    syncSessionFlag();
    const interval = setInterval(syncSessionFlag, 15000);
    return () => clearInterval(interval);
  }, [managerTab, currentOrg?.id, currentOrg?.driveConnected, currentOrg?.driveWriteVerifiedAt]);

  // Count pending reviews for manager badge
  const pendingCount = closings.filter((c) => c.status === 'pending_review').length;

  const handleNotificationNavigate = (
    target: NotificationNavTarget,
    notification?: AppNotification
  ) => {
    const route = resolveTenantNotificationRoute({
      userProfile,
      target,
      notification,
    });

    if (route.isPurchaseTarget && (route.entityId || route.branchId)) {
      setPurchaseNavFocus({
        ...(route.entityId ? { purchaseId: route.entityId } : {}),
        ...(route.branchId ? { branchId: route.branchId } : {}),
        nonce: Date.now(),
      });
    }

    if (route.roleGroup === 'manager' && route.managerTab) {
      setManagerTab(route.managerTab);
      return;
    }

    if (route.staffTab) {
      setStaffTab(route.staffTab);
    }
  };

  const tabClass = (active: boolean) =>
    `px-3.5 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5 ${
      active
        ? 'bg-[#1764FF] text-white shadow-sm shadow-[#1764FF]/20 font-bold'
        : 'text-slate-600 dark:text-slate-300 hover:text-[#0B1B32] dark:hover:text-white hover:bg-[#F5F8FF] dark:hover:bg-[#173056]'
    }`;

  return (
    <div
      className="min-h-screen flex flex-col bg-[#F5F8FF] dark:bg-[#0B1B32] text-[#0B1B32] dark:text-white transition-colors"
      dir={direction}
    >
      {/* Top Organization Header */}
      <header className="bg-white dark:bg-[#0B1B32] border-b border-[#DCE6FA] dark:border-[#1F3B66] shadow-xs sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20 gap-2">
            {/* Official Brand Logo + Org Info */}
            <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
              <BrandLogo size="sm" />
              <div className="h-7 w-px bg-[#DCE6FA] dark:bg-[#1F3B66] hidden sm:block shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <h1 className="text-sm sm:text-base font-extrabold text-[#0B1B32] dark:text-white truncate max-w-[130px] xs:max-w-[180px] sm:max-w-none">
                    {currentOrg?.name || t('dashMyOrgDefault')}
                  </h1>
                  <span
                    className={`text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${
                      isManager
                        ? 'bg-[#1764FF]/10 text-[#1764FF] dark:text-[#6CA2FF] border-[#1764FF]/25'
                        : 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] border-[#08C99B]/30'
                    }`}
                  >
                    {getUserRoleLabel(userProfile?.role, language)}
                  </span>
                </div>
                <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
                  <span className="truncate">
                    {userProfile?.role === 'manager' || userProfile?.role === 'supervisor'
                      ? t('dashAllOrgBranches')
                      : currentBranch?.name || t('dashMainBranch')}
                  </span>
                  <span>•</span>
                  <span className="font-mono font-semibold">{currentOrg?.currency || 'SAR'}</span>
                </div>
              </div>
            </div>

            {/* Header Controls: Notifications, Theme, Language, Profile & Logout */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <NotificationCenter
                surface="tenant"
                onNavigate={handleNotificationNavigate}
              />

              {/* Theme Toggle Button */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
                className="p-2 sm:p-2.5 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300 hover:text-[#1764FF] dark:hover:text-[#6CA2FF] hover:border-[#1764FF]/40 bg-[#F5F8FF] dark:bg-[#122543] transition-colors"
                title={theme === 'dark' ? t('lightMode') : t('darkMode')}
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 text-[#08C99B]" />
                ) : (
                  <Moon className="w-4 h-4 text-[#0B1B32]" />
                )}
              </button>

              {/* Language Switcher Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLangMenuOpen(!langMenuOpen)}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-bold text-[#0B1B32] dark:text-slate-200 bg-[#F5F8FF] dark:bg-[#122543] hover:border-[#1764FF]/50 transition-colors"
                >
                  <Globe className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span className="uppercase">{language}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {langMenuOpen && (
                  <div className="absolute end-0 mt-1.5 w-36 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] shadow-xl py-1 z-50 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => {
                        setLanguage('ar');
                        setLangMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-start flex items-center justify-between ${
                        language === 'ar'
                          ? 'text-[#1764FF] dark:text-[#6CA2FF] font-bold bg-[#1764FF]/10'
                          : 'text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#173056]'
                      }`}
                    >
                      <span>العربية</span>
                      <span className="text-[10px] font-mono opacity-70">AR</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLanguage('en');
                        setLangMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-start flex items-center justify-between ${
                        language === 'en'
                          ? 'text-[#1764FF] dark:text-[#6CA2FF] font-bold bg-[#1764FF]/10'
                          : 'text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#173056]'
                      }`}
                    >
                      <span>English</span>
                      <span className="text-[10px] font-mono opacity-70">EN</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLanguage('ur');
                        setLangMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-start flex items-center justify-between ${
                        language === 'ur'
                          ? 'text-[#1764FF] dark:text-[#6CA2FF] font-bold bg-[#1764FF]/10'
                          : 'text-[#0B1B32] dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#173056]'
                      }`}
                    >
                      <span>اردو</span>
                      <span className="text-[10px] font-mono opacity-70">UR</span>
                    </button>
                  </div>
                )}
              </div>

              {/* User Identity Info */}
              <div className="hidden lg:flex flex-col text-end ps-2.5 border-s border-[#DCE6FA] dark:border-[#1F3B66]">
                <span className="text-xs font-bold text-[#0B1B32] dark:text-white truncate max-w-[150px]">
                  {userProfile?.displayName || currentUser?.displayName || currentUser?.email}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[150px]">
                  {currentUser?.email}
                </span>
              </div>

              {isSuperAdmin && onOpenSuperAdmin && (
                <button
                  type="button"
                  onClick={onOpenSuperAdmin}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-[#1764FF] dark:text-[#6CA2FF] bg-[#1764FF]/10 hover:bg-[#1764FF]/15 border border-[#1764FF]/25 transition-colors whitespace-nowrap shrink-0"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('dashSuperAdminPortal')}</span>
                </button>
              )}

              {/* Logout Button */}
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 transition-colors"
                title={t('navLogout')}
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">{t('navLogout')}</span>
              </button>
            </div>
          </div>

          {/* Manager Sub-Navigation (Adaptive: Selector on mobile, Tabs on desktop) */}
          {isManager && (
            <div className="py-2.5 border-t border-[#E6EEFC] dark:border-[#1B345B] no-print">
              {/* Mobile Tab Selector (Visible on small screens < 768px) */}
              <div className="block md:hidden">
                <label htmlFor="mobile-manager-nav" className="sr-only">
                  {t('dashChooseScreen')}
                </label>
                <div className="relative">
                  <select
                    id="mobile-manager-nav"
                    value={managerTab}
                    onChange={(e) => setManagerTab(e.target.value as ManagerDashboardTab)}
                    className="w-full px-3 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
                  >
                    <option value="overview">📊 {t('tabOverview')}</option>
                    <option value="closings">
                      📑 {t('tabClosings')}{' '}
                      {pendingCount > 0 ? `(${pendingCount} ${t('pendingLabel')})` : ''}
                    </option>
                    {language === 'ar' ? (
                      <option value="purchase_reports">🧾 تقارير المشتريات</option>
                    ) : (
                      <option value="purchase_reports">🧾 {t('tabPurchaseReports')}</option>
                    )}
                    <option value="suppliers">🚚 {t('tabSuppliers')}</option>
                    <option value="reports">📈 {t('tabReports')}</option>
                    <option value="branches">
                      🏢 {t('tabBranches')} ({branches.length})
                    </option>
                    <option value="employees">👥 {t('tabEmployeesFull')}</option>
                    <option value="audit">🛡️ {t('tabAuditFull')}</option>
                    <option value="settings">⚙️ {t('tabSettingsFull')}</option>
                  </select>
                </div>
              </div>

              {/* Desktop Sub-Navigation Bar (Visible on screens >= 768px) */}
              <div className="hidden md:flex items-center gap-1.5 overflow-x-auto text-xs font-semibold scrollbar-none">
                <button
                  type="button"
                  onClick={() => setManagerTab('overview')}
                  className={tabClass(managerTab === 'overview')}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>{t('tabOverview')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setManagerTab('closings')}
                  className={tabClass(managerTab === 'closings')}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>{t('tabClosings')}</span>
                  {pendingCount > 0 && (
                    <span
                      className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] flex items-center justify-center font-bold tabular-nums ${
                        managerTab === 'closings'
                          ? 'bg-white text-[#1764FF]'
                          : 'bg-[#1764FF] text-white'
                      }`}
                    >
                      {pendingCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setManagerTab('purchase_reports')}
                  className={tabClass(managerTab === 'purchase_reports')}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  {language === 'ar' ? (
                    <span>تقارير المشتريات</span>
                  ) : (
                    <span>{t('tabPurchaseReports')}</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setManagerTab('suppliers')}
                  className={tabClass(managerTab === 'suppliers')}
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>{t('tabSuppliers')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setManagerTab('reports')}
                  className={tabClass(managerTab === 'reports')}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{t('tabReports')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setManagerTab('branches')}
                  className={tabClass(managerTab === 'branches')}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>
                    {t('tabBranches')} ({branches.length})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setManagerTab('employees')}
                  className={tabClass(managerTab === 'employees')}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>{t('tabEmployees')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setManagerTab('audit')}
                  className={tabClass(managerTab === 'audit')}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>{t('tabAudit')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setManagerTab('settings')}
                  className={tabClass(managerTab === 'settings')}
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>{t('tabSettings')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Staff Sub-Navigation (Shown ONLY for Branch Manager with purchases OR Supervisor with enabled tabs; NEVER for Employee) */}
          {!isManager && hasStaffExtraTabs && (
            <div className="py-2.5 border-t border-[#E6EEFC] dark:border-[#1B345B] no-print flex items-center gap-1.5 overflow-x-auto text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStaffTab('workspace')}
                className={tabClass(staffTab === 'workspace')}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>{t('tabShiftsEntry')}</span>
              </button>

              {canStaffManagePurchases && (
                <button
                  type="button"
                  onClick={() => setStaffTab('purchases')}
                  className={tabClass(staffTab === 'purchases')}
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>{language === 'ar' ? 'إدخال المشتريات' : t('tabPurchasesEntry')}</span>
                </button>
              )}

              {canStaffCreateSuppliers && (
                <button
                  type="button"
                  onClick={() => setStaffTab('suppliers')}
                  className={tabClass(staffTab === 'suppliers')}
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>{t('tabSuppliersShort')}</span>
                </button>
              )}

              {canSupervisorReviewClosings && (
                <button
                  type="button"
                  onClick={() => setStaffTab('closings')}
                  className={tabClass(staffTab === 'closings')}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>{t('tabClosings')}</span>
                  {pendingCount > 0 && (
                    <span
                      className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] flex items-center justify-center font-bold tabular-nums ${
                        staffTab === 'closings'
                          ? 'bg-white text-[#1764FF]'
                          : 'bg-[#1764FF] text-white'
                      }`}
                    >
                      {pendingCount}
                    </span>
                  )}
                </button>
              )}

              {canSupervisorViewReports && (
                <button
                  type="button"
                  onClick={() => setStaffTab('reports')}
                  className={tabClass(staffTab === 'reports')}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{t('tabReportsShort')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1 w-full space-y-6">
        {isManager && !driveReadiness.isReady && managerTab !== 'settings' && (
          <div className="p-4 sm:p-5 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/35 flex flex-wrap items-center justify-between gap-4 no-print">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1 text-xs">
                <p className="font-bold text-rose-700 dark:text-rose-300 text-sm">
                  {driveReadiness.message}
                </p>
                {driveReadiness.detail && (
                  <p className="text-slate-600 dark:text-slate-300">{driveReadiness.detail}</p>
                )}
                <p className="text-slate-500 dark:text-slate-400">{t('driveBlockedHint')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setManagerTab('settings')}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 shadow-xs shrink-0 transition-colors"
            >
              {t('driveConnectVerifyBtn')}
            </button>
          </div>
        )}

        {isManager && driveReadiness.isReady && !hasActiveDriveSession && managerTab !== 'settings' && (
          <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>{t('driveSessionExpiredHint')}</span>
            </div>
            <button
              type="button"
              onClick={() => setManagerTab('settings')}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] shrink-0 transition-colors"
            >
              {t('driveReauthBtn')}
            </button>
          </div>
        )}

        {isManager ? (
          /* Manager View Router */
          <>
            {managerTab === 'overview' && (
              <ManagerOverview
                onNavigateTab={(tab) => setManagerTab(tab)}
                onNavigateNotification={handleNotificationNavigate}
              />
            )}
            {managerTab === 'closings' && <ClosingsReview />}
            {managerTab === 'purchase_reports' && (
              <PurchaseReportsView navigationFocus={purchaseNavFocus} />
            )}
            {managerTab === 'suppliers' && <SuppliersManager />}
            {managerTab === 'reports' && <FinancialReports />}
            {managerTab === 'branches' && <BranchesManager />}
            {managerTab === 'employees' && <EmployeesManager />}
            {managerTab === 'audit' && <AuditLogsView />}
            {managerTab === 'settings' && <SettingsView />}
          </>
        ) : (
          /* Staff / Supervisor / Branch Manager View Router */
          <>
            {staffTab === 'purchases' && canStaffManagePurchases ? (
              <PurchaseEntryView
                initialBranchId={purchaseNavFocus?.branchId}
                onOpenSuppliers={
                  canStaffCreateSuppliers ? () => setStaffTab('suppliers') : undefined
                }
              />
            ) : staffTab === 'suppliers' && canStaffCreateSuppliers ? (
              <SuppliersManager />
            ) : staffTab === 'closings' && canSupervisorReviewClosings ? (
              <ClosingsReview />
            ) : staffTab === 'reports' && canSupervisorViewReports ? (
              <FinancialReports />
            ) : (
              <EmployeeDashboard />
            )}
          </>
        )}
      </main>

      {/* Dashboard Bottom Attribution */}
      <footer className="mt-auto border-t border-[#DCE6FA] dark:border-[#1F3B66] py-4 text-xs text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-[#0E203A]/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-start">
          <p>
            © {new Date().getFullYear()} {currentOrg?.name || `${t('brandName')} | ${t('brandSub')}`}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href={buildLegalPath('privacy')}
              onClick={(e) => {
                if (onNavigatePage && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
                  e.preventDefault();
                  onNavigatePage('privacy');
                }
              }}
              className="hover:text-[#1764FF] dark:hover:text-[#6CA2FF] transition-colors font-medium"
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
              className="hover:text-[#1764FF] dark:hover:text-[#6CA2FF] transition-colors font-medium"
            >
              {t('termsOfService')}
            </a>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span>{tr('صمم من موقع خدماتي البرمجية', 'Designed by Khadamati Software', 'خدماتِ سافٹ ویئر کی جانب سے ڈیزائن کردہ')}</span>
            <a
              href="https://amoal2030.github.io/a1/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1764FF] dark:text-[#6CA2FF] hover:underline font-medium transition-colors"
              dir="ltr"
            >
              https://amoal2030.github.io/a1/
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
