/**
 * الإقفال | AL EQFAL
 * Main Application Component with Firebase Multi-Tenant Authentication & Architecture
 */

import React, { useState } from 'react';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { Footer } from './components/Footer';
import { AuthModal } from './components/AuthModal';
import { SubscriptionRequestView } from './components/SubscriptionRequestView';
import { SubscriptionBlockedView } from './components/SubscriptionBlockedView';
import { TenantAccessNoticeView } from './components/TenantAccessNoticeView';
import { Dashboard } from './components/Dashboard';
import { SuperAdminDashboard } from './components/superadmin/SuperAdminDashboard';
import { LegalPage } from './components/LegalPage';
import { canRenderTenantDashboard } from './utils/tenantAccess';
import {
  AppPageRoute,
  buildLegalPath,
  resolveAppPageFromLocation,
} from './utils/legalRoutes';
import { CheckCircle2, Lock } from 'lucide-react';

const DEFAULT_DOCUMENT_TITLE = 'الإقفال | AL EQFAL - نظام إدارة الورديات وإقفال الحسابات';

const AppContent: React.FC = () => {
  const { direction, language } = useLanguage();
  const {
    currentUser,
    userProfile,
    currentOrg,
    loading,
    tenantStatus,
    subscriptionEvaluation,
    authNotice,
    clearAuthNotice,
    isSuperAdmin,
  } = useAuth();

  const [currentPage, setCurrentPage] = useState<AppPageRoute>(() => resolveAppPageFromLocation());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState<'manager' | 'employee' | 'register'>('manager');
  const [showPhasesOverview, setShowPhasesOverview] = useState(false);
  const [superAdminPortalActive, setSuperAdminPortalActive] = useState(true);

  React.useEffect(() => {
    if (isSuperAdmin) {
      setSuperAdminPortalActive(true);
    } else {
      setSuperAdminPortalActive(false);
    }
  }, [isSuperAdmin, currentUser?.uid]);

  // Synchronize URL path/hash for legal pages and auth modal
  React.useEffect(() => {
    const syncFromLocation = () => {
      setCurrentPage(resolveAppPageFromLocation());

      const hash = window.location.hash;
      const search = new URLSearchParams(window.location.search);
      if (
        hash === '#login' ||
        hash === '#auth' ||
        hash === '#register' ||
        search.get('login') !== null ||
        search.get('auth') !== null
      ) {
        const tab =
          hash === '#register' || search.get('tab') === 'register'
            ? 'register'
            : search.get('role') === 'employee' || hash === '#employee'
            ? 'employee'
            : 'manager';
        setAuthInitialTab(tab);
        setAuthModalOpen(true);
      }
    };

    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('hashchange', syncFromLocation);
    };
  }, []);

  React.useEffect(() => {
    if (currentPage === 'privacy') {
      document.title =
        language === 'en'
          ? 'Privacy Policy | AL EQFAL'
          : 'سياسة الخصوصية | الإقفال AL EQFAL';
    } else if (currentPage === 'terms') {
      document.title =
        language === 'en'
          ? 'Terms of Service | AL EQFAL'
          : 'شروط الاستخدام | الإقفال AL EQFAL';
    } else {
      document.title = DEFAULT_DOCUMENT_TITLE;
    }
  }, [currentPage, language]);

  const navigateToPage = (page: AppPageRoute, sectionId?: string) => {
    const targetUrl =
      page === 'home' && sectionId ? `${buildLegalPath('home')}#${sectionId}` : buildLegalPath(page);
    try {
      window.history.pushState({ page }, '', targetUrl);
    } catch {
      if (page === 'privacy') window.location.hash = '#/privacy';
      else if (page === 'terms') window.location.hash = '#/terms';
    }
    setCurrentPage(page);

    if (page === 'home' && sectionId) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = document.getElementById(sectionId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth' });
          }
        }, 60);
      });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleOpenAuth = (tab: 'manager' | 'employee' | 'register') => {
    setAuthInitialTab(tab);
    setAuthModalOpen(true);
  };

  const handleCloseAuth = () => {
    setAuthModalOpen(false);
    if (window.location.hash === '#login' || window.location.hash === '#auth' || window.location.hash === '#register') {
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch {
        // Safe fallback
      }
    }
  };

  const hasDashboardAccess = canRenderTenantDashboard({
    tenantStatus,
    hasAuthUser: Boolean(currentUser),
    userProfile,
    currentOrg,
    subscriptionEvaluation,
  });

  // Public & Authenticated Legal Pages (/ALEQFAL/privacy and /ALEQFAL/terms)
  if (currentPage === 'privacy' || currentPage === 'terms') {
    return (
      <LegalPage
        page={currentPage}
        isAuthenticated={Boolean(currentUser && (hasDashboardAccess || isSuperAdmin))}
        onNavigatePage={navigateToPage}
      />
    );
  }

  // Global Loading State (also guards transient frame before tenantStatus settles for signed-in user)
  if (loading || (currentUser && tenantStatus === 'loading')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F7FB] dark:bg-[#070E17] text-[#0B192C] dark:text-white" dir={direction}>
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-[#0B192C] border border-blue-500/40 text-white mx-auto flex items-center justify-center shadow-xl relative">
            <Lock className="w-7 h-7 text-blue-300" />
            <div className="absolute inset-0 rounded-2xl border-2 border-blue-400/20 border-t-blue-500 animate-spin" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold">الإقفال | AL EQFAL</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">جاري الاتصال بقاعدة بيانات Cloud Firestore...</p>
          </div>
        </div>
      </div>
    );
  }

  // Safe In-App Notification Banner (iFrame & Sandbox compliant)
  const NoticeBanner = authNotice ? (
    <div className="fixed top-4 inset-x-4 max-w-md mx-auto z-50 p-4 rounded-2xl bg-[#0B192C] border border-blue-500/40 shadow-2xl text-white flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shrink-0" />
        <p className="text-xs text-slate-100 font-medium">{authNotice.message}</p>
      </div>
      <button
        onClick={clearAuthNotice}
        className="text-xs text-white hover:bg-blue-700 font-bold shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 transition-colors"
      >
        إغلاق
      </button>
    </div>
  ) : null;

  // Verified Super Admin Portal (amoal2030@gmail.com only)
  if (currentUser && isSuperAdmin && superAdminPortalActive) {
    return (
      <>
        {NoticeBanner}
        <SuperAdminDashboard
          onSwitchToTenantDashboard={hasDashboardAccess ? () => setSuperAdminPortalActive(false) : undefined}
          onNavigatePage={navigateToPage}
        />
      </>
    );
  }

  // Verified Google user with no user doc and no invite -> New Subscription Request
  if (currentUser && tenantStatus === 'subscription_request_required') {
    return (
      <>
        {NoticeBanner}
        <SubscriptionRequestView />
      </>
    );
  }

  // Expired / Suspended / Not-Started organization subscription gate
  if (currentUser && tenantStatus === 'subscription_blocked') {
    return (
      <>
        {NoticeBanner}
        <SubscriptionBlockedView />
      </>
    );
  }

  // Cancelled / Already-used invite or Verification / Permission / Network error
  if (currentUser && (tenantStatus === 'invite_blocked' || tenantStatus === 'access_error')) {
    return (
      <>
        {NoticeBanner}
        <TenantAccessNoticeView />
      </>
    );
  }

  // Authenticated & Active Organization Dashboard (Strict gate: active user + active/legacy org)
  if (hasDashboardAccess) {
    return (
      <>
        {NoticeBanner}
        <Dashboard
          onNavigatePage={navigateToPage}
          onOpenSuperAdmin={isSuperAdmin ? () => setSuperAdminPortalActive(true) : undefined}
        />
      </>
    );
  }

  // Public Landing Page (Visitors & Unauthenticated Users)
  return (
    <div className="min-h-screen flex flex-col bg-[#F4F7FB] dark:bg-[#070E17] text-[#0B192C] dark:text-slate-100 transition-colors" dir={direction}>
      {NoticeBanner}
      {/* Top Navigation */}
      <Navbar onOpenAuth={handleOpenAuth} />

      {/* Main Landing & Presentation */}
      <main className="flex-1">
        <LandingPage onOpenAuth={handleOpenAuth} />
      </main>

      {/* Footer */}
      <Footer onNavigatePage={navigateToPage} />

      {/* Auth & Registration Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialTab={authInitialTab}
        onClose={handleCloseAuth}
      />

      {/* Phase Operational Status Card */}
      <aside aria-label="حالة مراحل التأسيس" className="fixed bottom-4 start-4 z-40 hidden sm:block">
        <div className="bg-[#0B192C]/95 backdrop-blur-md text-white border border-[#1E3A63] rounded-2xl p-3.5 shadow-xl text-xs max-w-sm space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              <span className="font-bold text-blue-200">مراحل تأسيس مشروع الإقفال</span>
            </div>
            <button
              onClick={() => setShowPhasesOverview(!showPhasesOverview)}
              className="text-[11px] text-slate-300 hover:text-white underline"
            >
              {showPhasesOverview ? 'إخفاء' : 'عرض التفاصيل'}
            </button>
          </div>

          <div className="text-[11px] text-slate-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>المرحلة 3: بوابة الاشتراكات وقبول الدعوات المعتمدة (مفعّلة)</span>
          </div>

          {showPhasesOverview && (
            <div className="pt-2 border-t border-[#1A3152] space-y-1.5 text-[11px] text-slate-300">
              <div className="text-blue-300 font-bold">الميزات الفعالة حالياً:</div>
              <div>• مصادقة المدير عبر Google والموظف بالبريد مع فرض صلاحية الاشتراك.</div>
              <div>• تفعيل المؤسسات الجديدة عبر دعوات المديرين المعتمدة ذرياً.</div>
              <div>• طلب الاشتراك والتجديد عبر واتساب مع إغلاق فوري عند الانتهاء أو الإيقاف.</div>
              <div>• عزل Multi-Tenant كامل وقواعد أمان Firestore Security Rules صارمة.</div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
