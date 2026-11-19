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
import { BrandLogo } from './components/common/BrandLogo';
import { canRenderTenantDashboard } from './utils/tenantAccess';
import {
  AppPageRoute,
  buildLegalPath,
  resolveAppPageFromLocation,
} from './utils/legalRoutes';

const AppContent: React.FC = () => {
  const { direction, language, t } = useLanguage();
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
      document.title = `${t('privacyPolicy')} | ${t('brandName')} ${t('brandSub')}`;
    } else if (currentPage === 'terms') {
      document.title = `${t('termsOfService')} | ${t('brandName')} ${t('brandSub')}`;
    } else {
      document.title = `${t('brandName')} | ${t('brandSub')} - ${t('tagline')}`;
    }
  }, [currentPage, language, t]);

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

  // Global Loading State with Official Auto-Switching Logo
  if (loading || (currentUser && tenantStatus === 'loading')) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-[#F5F8FF] dark:bg-[#0B1B32] text-[#0B1B32] dark:text-white transition-colors"
        dir={direction}
      >
        <div className="text-center space-y-5 px-4">
          <div className="flex justify-center">
            <BrandLogo size="xl" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full border-2 border-[#1764FF]/25 border-t-[#1764FF] animate-spin" />
            <h2 className="text-lg font-extrabold text-[#0B1B32] dark:text-white">
              {t('brandName')} | {t('brandSub')}
            </h2>
            <p className="text-xs text-[#526785] dark:text-slate-300">
              {t('dashConnectingCloud')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Safe In-App Notification Banner
  const NoticeBanner = authNotice ? (
    <div className="fixed top-4 inset-x-4 max-w-md mx-auto z-50 p-4 rounded-2xl bg-[#0B1B32] border border-[#1764FF]/45 shadow-2xl text-white flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-2.5 h-2.5 rounded-full bg-[#08C99B] shrink-0" />
        <p className="text-xs text-slate-100 font-medium leading-relaxed">{authNotice.message}</p>
      </div>
      <button
        type="button"
        onClick={clearAuthNotice}
        className="text-xs text-white hover:bg-[#1052D8] font-bold shrink-0 px-3 py-1.5 rounded-lg bg-[#1764FF] transition-colors"
      >
        {t('authClose')}
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

  // Authenticated & Active Organization Dashboard
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
    <div
      className="min-h-screen flex flex-col bg-[#F5F8FF] dark:bg-[#0B1B32] text-[#0B1B32] dark:text-white transition-colors"
      dir={direction}
    >
      {NoticeBanner}
      <Navbar onOpenAuth={handleOpenAuth} />
      <main className="flex-1">
        <LandingPage onOpenAuth={handleOpenAuth} />
      </main>
      <Footer onNavigatePage={navigateToPage} />
      <AuthModal
        isOpen={authModalOpen}
        initialTab={authInitialTab}
        onClose={handleCloseAuth}
      />
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
