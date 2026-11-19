import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { SupportedLanguage } from '../../types';
import {
  Settings,
  Building2,
  Globe,
  Sun,
  Moon,
  ShieldCheck,
  HardDrive,
  CheckCircle2,
  Info,
  ExternalLink,
  AlertCircle,
  Clock,
  FolderPlus,
  FolderCheck,
  RefreshCw,
  ShieldAlert,
  Link2,
  Unlink,
  FolderTree,
} from 'lucide-react';
import {
  requestDriveAuthorization,
  getActiveDriveSession,
  clearDriveSession,
  getDriveOAuthClientConfig,
  provisionOrganizationDriveHierarchy,
  verifyDriveWriteReadCapability,
  assertDriveSessionMatchesAccount,
  assertOrgDriveAuthorizationEligibility,
  isOAuthCancellationOrConfigError,
  buildGoogleDriveFolderUrl,
  DriveTokenSession,
  OrgDriveProvisionResult,
} from '../../services/driveService';

export const SettingsView: React.FC = () => {
  const {
    currentOrg,
    currentBranch,
    branches,
    userProfile,
    setCurrentBranch,
    currentUser,
    saveDriveConnection,
    recordDriveHealthFailure,
    disconnectDriveConnection,
    driveReadiness,
  } = useAuth();
  const { language, setLanguage, tr } = useLanguage();
  const { theme, setTheme } = useTheme();

  const [savedNotice, setSavedNotice] = useState(false);

  // Google Drive Phase 1 States (Access Token remains strictly in RAM, scoped to currentOrg.id)
  const [driveSession, setDriveSession] = useState<DriveTokenSession | null>(() =>
    getActiveDriveSession(currentOrg?.id)
  );
  const [driveLoading, setDriveLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [healthCheckLoading, setHealthCheckLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveSuccess, setDriveSuccess] = useState<string | null>(null);
  const [remainingMinutes, setRemainingMinutes] = useState<number>(0);

  const activeOrgIdRef = useRef<string | null>(currentOrg?.id ?? null);
  activeOrgIdRef.current = currentOrg?.id ?? null;

  const oauthConfig = getDriveOAuthClientConfig();
  const isOAuthConfigured = oauthConfig.source === 'vite_env' && Boolean(oauthConfig.clientId);

  // Strict organization owner verification (never rely on role === 'manager' alone)
  const isOrgOwner = Boolean(
    currentUser &&
      currentOrg &&
      userProfile?.role === 'manager' &&
      userProfile?.isActive &&
      currentUser.uid === currentOrg.ownerId
  );

  // Extract the Google provider specifically (never assume providerData[0])
  const googleProvider = currentUser?.providerData?.find((p) => p.providerId === 'google.com') || null;
  const isGoogleProviderPresent = Boolean(googleProvider?.uid);
  const currentYearMonth = new Date().toISOString().slice(0, 7);
  const linkedDriveEmail =
    currentOrg?.driveAccountEmail || googleProvider?.email || currentOrg?.ownerEmail || '';

  const assertCompleteProvisionResult = (
    result: OrgDriveProvisionResult,
    expectedBranchCount: number
  ) => {
    if (!result.orgFolder?.folderId || !result.orgFolder?.verifiedViaGet) {
      throw new Error('لم يكتمل التحقق الفعلي من مجلد المؤسسة في Google Drive عبر files.get.');
    }
    if (result.branchResults.length !== expectedBranchCount) {
      throw new Error(
        `لم تكتمل مزامنة جميع الفروع: تم التحقق من (${result.branchResults.length}) من أصل (${expectedBranchCount}) فرع.`
      );
    }
    for (const br of result.branchResults) {
      if (!br.branchFolder?.folderId || !br.branchFolder?.verifiedViaGet) {
        throw new Error(`تعذر التحقق الفعلي من مجلد الفرع "${br.branchName}" في Google Drive.`);
      }
      if (!br.monthFolder?.folderId) {
        throw new Error(
          `تعذر التحقق الفعلي من مجلد الشهر "${currentYearMonth}" للفرع "${br.branchName}" في Google Drive.`
        );
      }
    }
    const expectedTotal = 1 + expectedBranchCount * 2;
    if (result.verifiedCount !== expectedTotal) {
      throw new Error(
        `عدد المجلدات المتحقق منها (${result.verifiedCount}) لا يطابق العدد المطلوب (${expectedTotal}).`
      );
    }
  };

  // Reset transient UI state immediately when switching organizations so prior org messages never leak
  useEffect(() => {
    setDriveError(null);
    setDriveSuccess(null);
    setConfirmDisconnect(false);
    setDriveLoading(false);
    setSyncLoading(false);
    setHealthCheckLoading(false);
    setDisconnectLoading(false);
    const scopedSession = getActiveDriveSession(currentOrg?.id);
    setDriveSession(scopedSession);
    if (scopedSession) {
      const diffMs = scopedSession.expiresAt - Date.now();
      setRemainingMinutes(Math.max(0, Math.floor(diffMs / 60000)));
    } else {
      setRemainingMinutes(0);
    }
  }, [currentOrg?.id]);

  // Dynamic in-memory token lifetime countdown (strictly scoped to currentOrg?.id)
  useEffect(() => {
    const targetOrgId = currentOrg?.id;
    const updateRemaining = () => {
      const session = getActiveDriveSession(targetOrgId);
      setDriveSession(session);
      if (session) {
        const diffMs = session.expiresAt - Date.now();
        setRemainingMinutes(Math.max(0, Math.floor(diffMs / 60000)));
      } else {
        setRemainingMinutes(0);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 15000);
    return () => clearInterval(interval);
  }, [currentOrg?.id]);

  const handleConnectDrive = async () => {
    setDriveError(null);
    setDriveSuccess(null);
    setConfirmDisconnect(false);

    if (!currentOrg || !isOrgOwner) {
      setDriveError('عفواً، ربط Google Drive مقتصر حصراً على مالك المؤسسة المعتمد.');
      return;
    }

    if (!isGoogleProviderPresent || !googleProvider?.uid) {
      setDriveError(
        'لم يتم العثور على مزود Google مرتبط بحسابك في Firebase. يرجى تسجيل الدخول بحساب Google المعتمد للمالك.'
      );
      return;
    }

    if (!isOAuthConfigured) {
      setDriveError(
        'متغير البيئة VITE_GOOGLE_DRIVE_CLIENT_ID غير مضبوط في نسخة البناء الحالية. يرجى ضبطه قبل تفعيل الربط.'
      );
      return;
    }

    const targetOrg = currentOrg;
    const targetOrgId = currentOrg.id;
    const ownerEmail = googleProvider.email || currentUser?.email || targetOrg.ownerEmail || '';
    const orgBranches = branches.filter((b) => b.orgId === targetOrgId);

    let eligibility;
    try {
      eligibility = assertOrgDriveAuthorizationEligibility({
        currentUserUid: currentUser?.uid,
        userProfile,
        org: targetOrg,
        googleUid: googleProvider.uid,
        ownerEmail,
      });
    } catch (eligErr: any) {
      setDriveError(eligErr?.message || 'غير مصرح بربط Google Drive لهذه المؤسسة.');
      return;
    }

    setDriveLoading(true);
    try {
      const session = await requestDriveAuthorization({
        orgId: targetOrgId,
        googleUid: eligibility.googleUid,
        email: eligibility.ownerEmail,
        linkedAccount: eligibility.linkedAccount,
      });

      assertDriveSessionMatchesAccount(session, {
        orgId: targetOrgId,
        googleUid: eligibility.googleUid,
        email: eligibility.ownerEmail,
        linkedSub: eligibility.linkedAccount?.linkedSub,
        linkedEmail: eligibility.linkedAccount?.linkedEmail,
      });

      if (activeOrgIdRef.current !== targetOrgId) {
        return;
      }

      setDriveSession(session);
      setRemainingMinutes(Math.max(0, Math.floor((session.expiresAt - Date.now()) / 60000)));

      const provisionResult = await provisionOrganizationDriveHierarchy({
        token: session.accessToken,
        org: targetOrg,
        branches: orgBranches,
        yearMonth: currentYearMonth,
      });

      assertCompleteProvisionResult(provisionResult, orgBranches.length);

      // Mandatory actual write + read-back verification before marking Drive ready
      const writeReadResult = await verifyDriveWriteReadCapability({
        token: session.accessToken,
        org: targetOrg,
        orgFolderId: provisionResult.orgFolder.folderId,
      });

      if (activeOrgIdRef.current !== targetOrgId) {
        return;
      }

      await saveDriveConnection({
        driveAccountEmail: session.email,
        driveAccountName: session.name,
        driveGoogleSub: session.sub,
        orgFolderId: provisionResult.orgFolder.folderId,
        orgFolderName: provisionResult.orgFolder.folderName,
        orgFolderLink: provisionResult.orgFolder.webViewLink,
        driveWriteVerified: true,
        driveWriteVerifiedAt: writeReadResult.verifiedAt,
        branchFolders: provisionResult.branchResults.map((r) => ({
          branchId: r.branchId,
          folderId: r.branchFolder.folderId,
          folderName: r.branchFolder.folderName,
          webViewLink: r.branchFolder.webViewLink,
        })),
        monthFolderMap: provisionResult.monthFolderMap,
      });

      if (activeOrgIdRef.current === targetOrgId) {
        setDriveSuccess(
          `تم التحقق الفعلي من حساب (${session.email}) ومجلد المؤسسة "${provisionResult.orgFolder.folderName}" وتهيئة (${provisionResult.branchResults.length}) فرع لشهر ${currentYearMonth}، واجتياز اختبار الكتابة والقراءة بنجاح (${writeReadResult.cleanupMessage}).`
        );
      }
    } catch (err: any) {
      if (activeOrgIdRef.current !== targetOrgId) return;
      const errMsg = err?.message || 'تعذر إتمام ربط Google Drive أو فشل اختبار الكتابة والقراءة.';
      if (targetOrg.driveConnected && !isOAuthCancellationOrConfigError(err)) {
        await recordDriveHealthFailure(errMsg);
      }
      setDriveError(errMsg);
      setDriveSession(getActiveDriveSession(targetOrgId));
    } finally {
      if (activeOrgIdRef.current === targetOrgId) {
        setDriveLoading(false);
      }
    }
  };

  const handleSyncDriveFolders = async () => {
    setDriveError(null);
    setDriveSuccess(null);

    if (!currentOrg || !isOrgOwner) {
      setDriveError('مزامنة مجلدات Drive مقتصرة حصراً على مالك المؤسسة المعتمد.');
      return;
    }

    if (!isGoogleProviderPresent || !googleProvider?.uid) {
      setDriveError('يلزم تسجيل الدخول بحساب Google المعتمد للمالك لإعادة التفويض ومزامنة المجلدات.');
      return;
    }

    const targetOrg = currentOrg;
    const targetOrgId = currentOrg.id;
    const ownerEmail = googleProvider.email || currentUser?.email || targetOrg.ownerEmail || '';
    const orgBranches = branches.filter((b) => b.orgId === targetOrgId);

    let eligibility;
    try {
      eligibility = assertOrgDriveAuthorizationEligibility({
        currentUserUid: currentUser?.uid,
        userProfile,
        org: targetOrg,
        googleUid: googleProvider.uid,
        ownerEmail,
      });
    } catch (eligErr: any) {
      setDriveError(eligErr?.message || 'تعذر التحقق من صلاحية مزامنة Google Drive.');
      return;
    }

    setSyncLoading(true);
    try {
      let session = getActiveDriveSession(targetOrgId);
      if (session) {
        assertDriveSessionMatchesAccount(session, {
          orgId: targetOrgId,
          googleUid: eligibility.googleUid,
          email: eligibility.ownerEmail,
          linkedSub: eligibility.linkedAccount?.linkedSub,
          linkedEmail: eligibility.linkedAccount?.linkedEmail,
        });
      } else {
        if (!isOAuthConfigured) {
          throw new Error('متغير البيئة VITE_GOOGLE_DRIVE_CLIENT_ID غير مضبوط في نسخة البناء الحالية.');
        }
        session = await requestDriveAuthorization({
          orgId: targetOrgId,
          googleUid: eligibility.googleUid,
          email: eligibility.ownerEmail,
          linkedAccount: eligibility.linkedAccount,
        });
        assertDriveSessionMatchesAccount(session, {
          orgId: targetOrgId,
          googleUid: eligibility.googleUid,
          email: eligibility.ownerEmail,
          linkedSub: eligibility.linkedAccount?.linkedSub,
          linkedEmail: eligibility.linkedAccount?.linkedEmail,
        });
        if (activeOrgIdRef.current !== targetOrgId) return;
        setDriveSession(session);
        setRemainingMinutes(Math.max(0, Math.floor((session.expiresAt - Date.now()) / 60000)));
      }

      const provisionResult = await provisionOrganizationDriveHierarchy({
        token: session.accessToken,
        org: targetOrg,
        branches: orgBranches,
        yearMonth: currentYearMonth,
      });

      // Never treat Firestore write alone as proof; ensure every folder passed Drive verification first
      assertCompleteProvisionResult(provisionResult, orgBranches.length);

      // Re-verify actual write & read-back capability using drive.file
      const writeReadResult = await verifyDriveWriteReadCapability({
        token: session.accessToken,
        org: targetOrg,
        orgFolderId: provisionResult.orgFolder.folderId,
      });

      if (activeOrgIdRef.current !== targetOrgId) return;

      await saveDriveConnection({
        driveAccountEmail: session.email,
        driveAccountName: session.name,
        driveGoogleSub: session.sub,
        orgFolderId: provisionResult.orgFolder.folderId,
        orgFolderName: provisionResult.orgFolder.folderName,
        orgFolderLink: provisionResult.orgFolder.webViewLink,
        driveWriteVerified: true,
        driveWriteVerifiedAt: writeReadResult.verifiedAt,
        branchFolders: provisionResult.branchResults.map((r) => ({
          branchId: r.branchId,
          folderId: r.branchFolder.folderId,
          folderName: r.branchFolder.folderName,
          webViewLink: r.branchFolder.webViewLink,
        })),
        monthFolderMap: provisionResult.monthFolderMap,
      });

      if (activeOrgIdRef.current === targetOrgId) {
        setDriveSuccess(
          `تم التحقق الفعلي من مجلد المؤسسة وتحديث مجلدات (${provisionResult.branchResults.length}) فرع لشهر ${currentYearMonth}، واجتياز اختبار الكتابة والقراءة في حساب (${session.email}) بنجاح (${writeReadResult.cleanupMessage}).`
        );
      }
    } catch (err: any) {
      if (activeOrgIdRef.current !== targetOrgId) return;
      const errMsg = err?.message || 'حدث خطأ أثناء مزامنة مجلدات Google Drive أو فحص الكتابة والقراءة.';
      if (!isOAuthCancellationOrConfigError(err)) {
        await recordDriveHealthFailure(errMsg);
      }
      setDriveError(errMsg);
      setDriveSession(getActiveDriveSession(targetOrgId));
    } finally {
      if (activeOrgIdRef.current === targetOrgId) {
        setSyncLoading(false);
      }
    }
  };

  /**
   * Re-authorizes expired session if needed and executes full folder + write/read readiness verification.
   */
  const handleVerifyDriveHealth = async () => {
    setDriveError(null);
    setDriveSuccess(null);

    if (!currentOrg || !isOrgOwner) {
      setDriveError('فحص جاهزية Google Drive مقتصر حصراً على مالك المؤسسة المعتمد.');
      return;
    }

    if (!isGoogleProviderPresent || !googleProvider?.uid) {
      setDriveError('يلزم تسجيل الدخول بحساب Google المعتمد للمالك لإعادة التفويض وإجراء الفحص.');
      return;
    }

    const targetOrg = currentOrg;
    const targetOrgId = currentOrg.id;
    const ownerEmail = googleProvider.email || currentUser?.email || targetOrg.ownerEmail || '';
    const orgBranches = branches.filter((b) => b.orgId === targetOrgId);

    let eligibility;
    try {
      eligibility = assertOrgDriveAuthorizationEligibility({
        currentUserUid: currentUser?.uid,
        userProfile,
        org: targetOrg,
        googleUid: googleProvider.uid,
        ownerEmail,
      });
    } catch (eligErr: any) {
      setDriveError(eligErr?.message || 'تعذر التحقق من صلاحية فحص Google Drive.');
      return;
    }

    setHealthCheckLoading(true);
    try {
      let session = getActiveDriveSession(targetOrgId);
      if (session) {
        assertDriveSessionMatchesAccount(session, {
          orgId: targetOrgId,
          googleUid: eligibility.googleUid,
          email: eligibility.ownerEmail,
          linkedSub: eligibility.linkedAccount?.linkedSub,
          linkedEmail: eligibility.linkedAccount?.linkedEmail,
        });
      } else {
        if (!isOAuthConfigured) {
          throw new Error('متغير البيئة VITE_GOOGLE_DRIVE_CLIENT_ID غير مضبوط في نسخة البناء الحالية.');
        }
        session = await requestDriveAuthorization({
          orgId: targetOrgId,
          googleUid: eligibility.googleUid,
          email: eligibility.ownerEmail,
          linkedAccount: eligibility.linkedAccount,
        });
        assertDriveSessionMatchesAccount(session, {
          orgId: targetOrgId,
          googleUid: eligibility.googleUid,
          email: eligibility.ownerEmail,
          linkedSub: eligibility.linkedAccount?.linkedSub,
          linkedEmail: eligibility.linkedAccount?.linkedEmail,
        });
        if (activeOrgIdRef.current !== targetOrgId) return;
        setDriveSession(session);
        setRemainingMinutes(Math.max(0, Math.floor((session.expiresAt - Date.now()) / 60000)));
      }

      const provisionResult = await provisionOrganizationDriveHierarchy({
        token: session.accessToken,
        org: targetOrg,
        branches: orgBranches,
        yearMonth: currentYearMonth,
      });

      assertCompleteProvisionResult(provisionResult, orgBranches.length);

      const writeReadResult = await verifyDriveWriteReadCapability({
        token: session.accessToken,
        org: targetOrg,
        orgFolderId: provisionResult.orgFolder.folderId,
      });

      if (activeOrgIdRef.current !== targetOrgId) return;

      await saveDriveConnection({
        driveAccountEmail: session.email,
        driveAccountName: session.name,
        driveGoogleSub: session.sub,
        orgFolderId: provisionResult.orgFolder.folderId,
        orgFolderName: provisionResult.orgFolder.folderName,
        orgFolderLink: provisionResult.orgFolder.webViewLink,
        driveWriteVerified: true,
        driveWriteVerifiedAt: writeReadResult.verifiedAt,
        branchFolders: provisionResult.branchResults.map((r) => ({
          branchId: r.branchId,
          folderId: r.branchFolder.folderId,
          folderName: r.branchFolder.folderName,
          webViewLink: r.branchFolder.webViewLink,
        })),
        monthFolderMap: provisionResult.monthFolderMap,
      });

      if (activeOrgIdRef.current === targetOrgId) {
        setDriveSuccess(
          `نجح فحص جاهزية Google Drive (كتابة وقراءة فعلية ومطابقة المحتوى) لحساب (${session.email}). ${writeReadResult.cleanupMessage}`
        );
      }
    } catch (err: any) {
      if (activeOrgIdRef.current !== targetOrgId) return;
      const errMsg = err?.message || 'فشل فحص جاهزية الكتابة والقراءة في Google Drive.';
      if (!isOAuthCancellationOrConfigError(err)) {
        await recordDriveHealthFailure(errMsg);
      }
      setDriveError(errMsg);
      setDriveSession(getActiveDriveSession(targetOrgId));
    } finally {
      if (activeOrgIdRef.current === targetOrgId) {
        setHealthCheckLoading(false);
      }
    }
  };

  const handleConfirmDisconnect = async () => {
    setDriveError(null);
    setDriveSuccess(null);

    if (!currentOrg || !isOrgOwner) {
      setDriveError('فصل ربط Google Drive مقتصر حصراً على مالك المؤسسة المعتمد.');
      return;
    }

    const targetOrgId = currentOrg.id;
    setDisconnectLoading(true);
    try {
      await disconnectDriveConnection();
      clearDriveSession(targetOrgId);
      if (activeOrgIdRef.current === targetOrgId) {
        setDriveSession(null);
        setRemainingMinutes(0);
        setConfirmDisconnect(false);
        setDriveSuccess('تم فصل ربط Google Drive من إعدادات المؤسسة مع الإبقاء على جميع الملفات والسجلات دون حذف.');
      }
    } catch (err: any) {
      if (activeOrgIdRef.current === targetOrgId) {
        setDriveError(err?.message || 'تعذر فصل ربط Google Drive.');
      }
    } finally {
      if (activeOrgIdRef.current === targetOrgId) {
        setDisconnectLoading(false);
      }
    }
  };

  const handleLanguageChange = (lang: SupportedLanguage) => {
    setLanguage(lang);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleThemeChange = (mode: 'dark' | 'light') => {
    setTheme(mode);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleBranchSwitch = (branchId: string) => {
    const selected = branches.find((b) => b.id === branchId);
    if (selected) {
      setCurrentBranch(selected);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    }
  };

  const dateLocale = language === 'ar' ? 'ar-SA' : language === 'ur' ? 'ur-PK' : 'en-US';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#0B1B32] dark:text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#1764FF] dark:text-[#6CA2FF]" />
            <span>{tr('إعدادات المؤسسة والنظام', 'Organization & System Settings', 'ادارے اور سسٹم کی ترتیبات')}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {tr(
              'إدارة بيانات المنشأة، ربط Google Drive، وتفضيلات العرض واللغة',
              'Manage organization profile, Google Drive archiving, and appearance & language preferences',
              'ادارے کی معلومات، Google Drive آرکائیونگ، اور ڈسپلے و زبان کی ترجیحات کا انتظام'
            )}
          </p>
        </div>

        {savedNotice && (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#08C99B]/15 border border-[#08C99B]/35 text-[#048264] dark:text-[#08C99B] text-xs font-semibold animate-fade-in">
            <CheckCircle2 className="w-4 h-4" />
            <span>{tr('تم حفظ التفضيلات بنجاح', 'Preferences saved successfully', 'ترجیحات کامیابی سے محفوظ ہو گئیں')}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Core Settings */}
        <div className="lg:col-span-2 space-y-6">
          {/* Card 1: Organization Details */}
          <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-3 pb-4 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
              <div className="w-10 h-10 rounded-xl bg-[#1764FF]/10 border border-[#1764FF]/20 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#0B1B32] dark:text-white">
                  {tr('بيانات المؤسسة المعتمدة', 'Verified Organization Profile', 'تصدیق شدہ ادارے کی معلومات')}
                </h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'المعلومات الأساسية الموثقة في السجل السحابي',
                    'Core verified details stored in your cloud record',
                    'کلاؤڈ ریکارڈ میں محفوظ بنیادی تصدیق شدہ معلومات'
                  )}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block font-medium">
                  {tr('اسم المؤسسة', 'Organization Name', 'ادارے کا نام')}
                </span>
                <span className="text-[#0B1B32] dark:text-white font-bold text-sm">
                  {currentOrg?.name || tr('غير محدد', 'Not specified', 'غیر متعین')}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block font-medium">
                  {tr('معرف المنشأة (Org ID)', 'Organization ID', 'ادارہ آئی ڈی (Org ID)')}
                </span>
                <span className="text-[#0B1B32] dark:text-slate-200 font-mono font-medium truncate block" dir="ltr">
                  {currentOrg?.id || tr('غير محدد', 'Not specified', 'غیر متعین')}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block font-medium">
                  {tr('السجل التجاري', 'Commercial Registration', 'کمرشل رجسٹریشن')}
                </span>
                <span className="text-[#0B1B32] dark:text-white font-bold">
                  {currentOrg?.commercialRegistration ||
                    tr('لا يوجد رقم مسجل', 'Not registered', 'درج نہیں')}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block font-medium">
                  {tr('العملة الأساسية', 'Primary Currency', 'بنیادی کرنسی')}
                </span>
                <span className="text-[#1764FF] dark:text-[#6CA2FF] font-bold text-sm">
                  {currentOrg?.currency || 'SAR'} ({tr('ريال سعودي', 'Saudi Riyal', 'سعودی ریال')})
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block font-medium">
                  {tr('نوع النشاط التجاري', 'Business Sector', 'کاروباری شعبہ')}
                </span>
                <span className="text-[#0B1B32] dark:text-white font-medium">
                  {currentOrg?.activityType === 'restaurant'
                    ? tr('مطاعم وكافيهات', 'Restaurants & Cafés', 'ریستوران اور کیفے')
                    : currentOrg?.activityType === 'retail'
                    ? tr('تجارة تجزئة ومحلات', 'Retail & Shops', 'ریٹیل اور دکانیں')
                    : currentOrg?.activityType === 'supermarket'
                    ? tr('سوبرماركت وتموينات', 'Supermarkets & Grocery', 'سپر مارکیٹ اور گروسری')
                    : tr('نشاط تجاري عام', 'General Business', 'عمومی کاروبار')}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block font-medium">
                  {tr('الفرع النشط الحالي', 'Current Active Branch', 'موجودہ فعال برانچ')}
                </span>
                <select
                  value={currentBranch?.id || ''}
                  onChange={(e) => handleBranchSwitch(e.target.value)}
                  className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-[#1764FF]/30 focus:border-[#1764FF]"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Card 2: Google Drive Organization Link (Owner Only) */}
          <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#1764FF]/10 border border-[#1764FF]/20 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#0B1B32] dark:text-white flex items-center gap-2">
                    <span>{tr('ربط Google Drive', 'Google Drive Connection', 'Google Drive کنکشن')}</span>
                  </h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {tr(
                      'ربط حساب Drive الخاص بمالك المؤسسة للأرشفة اللامركزية • نطاق drive.file فقط',
                      'Connect the organization owner Drive account for decentralized archiving • drive.file scope only',
                      'غیر مرکزی آرکائیونگ کے لیے مالک کا Drive اکاؤنٹ منسلک کریں • صرف drive.file دائرہ کار'
                    )}
                  </span>
                </div>
              </div>

              {/* Connection & Readiness Status Badges */}
              <div className="flex flex-wrap items-center gap-2">
                {currentOrg?.driveConnected ? (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-[#1764FF]/12 border border-[#1764FF]/30 text-[#1764FF] dark:text-[#6CA2FF] text-xs font-bold">
                    <span className="w-2 h-2 rounded-full bg-[#1764FF]" />
                    <span>{tr('مرتبط بحساب المالك', 'Linked to Owner Account', 'مالک کے اکاؤنٹ سے منسلک')}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-500 dark:text-slate-400 text-xs font-medium">
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    <span>{tr('غير مرتبط', 'Disconnected', 'منسلک نہیں')}</span>
                  </div>
                )}

                {currentOrg?.driveConnected && (
                  driveReadiness.isReady ? (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#08C99B]/15 border border-[#08C99B]/30 text-[#048264] dark:text-[#08C99B] text-[11px] font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{tr('جاهز للكتابة والقراءة', 'Read/Write Ready', 'لکھنے اور پڑھنے کے لیے تیار')}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[11px] font-bold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>
                        {currentOrg.driveLastHealthStatus === 'failed'
                          ? tr('فشل فحص الكتابة والقراءة', 'Read/Write Check Failed', 'لکھنے/پڑھنے کا ٹیسٹ ناکام')
                          : tr('بانتظار فحص الجاهزية', 'Pending Readiness Check', 'تیاری کی جانچ زیر التواء')}
                      </span>
                    </div>
                  )
                )}

                {driveSession && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#1764FF]/30 text-[#1764FF] dark:text-[#6CA2FF] text-[11px] font-bold">
                    <Clock className="w-3 h-3" />
                    <span>
                      {tr('جلسة تفويض نشطة:', 'Active OAuth Session:', 'فعال سیشن:')}{' '}
                      {remainingMinutes > 0
                        ? `${remainingMinutes} ${tr('د', 'min', 'منٹ')}`
                        : `< 1 ${tr('د', 'min', 'منٹ')}`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Alerts */}
            {driveError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-xs space-y-1">
                <div className="flex items-center gap-2 font-bold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{tr('تنبيه أمان وتفويض:', 'Security & Authorization Notice:', 'سیکیورٹی اور اجازت کا انتباہ:')}</span>
                </div>
                <p className="ps-6 leading-relaxed text-slate-700 dark:text-slate-300">{driveError}</p>
              </div>
            )}

            {driveSuccess && (
              <div className="p-3.5 rounded-xl bg-[#08C99B]/10 border border-[#08C99B]/30 text-[#048264] dark:text-[#08C99B] text-xs space-y-1">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{tr('حالة ربط Google Drive:', 'Google Drive Status:', 'Google Drive کی حالت:')}</span>
                </div>
                <p className="ps-6 leading-relaxed text-slate-700 dark:text-slate-300">{driveSuccess}</p>
              </div>
            )}

            {/* Missing VITE_GOOGLE_DRIVE_CLIENT_ID Notice */}
            {isOrgOwner && !isOAuthConfigured && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
                  <Info className="w-4 h-4 shrink-0" />
                  <span>
                    {tr(
                      'إعداد متغير البيئة مطلوب قبل الربط الفعلي',
                      'Environment Variable Required Before Live Connection',
                      'لائیو کنکشن سے پہلے ماحول کا متغیر درکار ہے'
                    )}
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {tr(
                    'لم يُعثر على متغير البيئة',
                    'Missing environment variable',
                    'ماحول کا متغیر موجود نہیں'
                  )}{' '}
                  <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#0E203A] font-mono text-[#1764FF] dark:text-[#6CA2FF]">
                    VITE_GOOGLE_DRIVE_CLIENT_ID
                  </code>{' '}
                  {tr(
                    'في نسخة التشغيل الحالية. يجب تمرير معرّف OAuth 2.0 Web Client ID أثناء بناء التطبيق وتفعيل النطاق المنشور في Google Cloud Console.',
                    'in this build. Configure your OAuth 2.0 Web Client ID during build and enable the published origin in Google Cloud Console.',
                    'موجودہ بلڈ میں نہیں ملا۔ بلڈ کے دوران OAuth 2.0 Web Client ID سیٹ کریں اور Google Cloud Console میں ڈومین فعال کریں۔'
                  )}
                </p>
              </div>
            )}

            {/* Strict Owner Gate */}
            {!isOrgOwner ? (
              <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs space-y-2">
                <div className="flex items-center gap-2 text-[#0B1B32] dark:text-slate-200 font-bold">
                  <ShieldAlert className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>{tr('خاص بمالك المؤسسة المعتمد فقط:', 'Organization Owner Only:', 'صرف ادارے کے مالک کے لیے:')}</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                  {tr(
                    `لا يُسمح للموظفين أو مديري الفروع بربط أو تعديل إعدادات Google Drive. هذا الإجراء متاح حصرياً لحساب مالك المؤسسة (${currentOrg?.ownerEmail || 'المالك'}).`,
                    `Employees and branch managers cannot link or modify Google Drive settings. This action is exclusively available to the Organization Owner (${currentOrg?.ownerEmail || 'Owner'}).`,
                    `ملازمین یا برانچ مینیجرز Google Drive ترتیبات تبدیل نہیں کر سکتے۔ یہ اختیار صرف ادارے کے مالک (${currentOrg?.ownerEmail || 'مالک'}) کے پاس ہے۔`
                  )}
                </p>
              </div>
            ) : !isGoogleProviderPresent ? (
              <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs space-y-2">
                <div className="flex items-center gap-2 text-[#0B1B32] dark:text-slate-200 font-bold">
                  <AlertCircle className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span>
                    {tr(
                      'يلزم تسجيل الدخول بحساب Google المعتمد:',
                      'Google Sign-In Required:',
                      'تصدیق شدہ Google اکاؤنٹ سے لاگ ان درکار ہے:'
                    )}
                  </span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                  {tr(
                    'حسابك الحالي غير مرتبط بمزود Google في جلسة Firebase. لمطابقة هوية المالك بأمان قبل منح صلاحية Drive، يرجى تسجيل الدخول باستخدام زر Google.',
                    'Your current session is not linked to a Google provider in Firebase. Please sign in with Google to securely verify owner identity before authorizing Drive.',
                    'آپ کا موجودہ سیشن Google فراہم کنندہ سے منسلک نہیں ہے۔ Drive کی اجازت دینے سے پہلے براہِ کرم Google کے ذریعے لاگ ان کریں۔'
                  )}
                </p>
              </div>
            ) : currentOrg?.driveConnected ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                      {tr('حساب Google المرتبط', 'Linked Google Account', 'منسلک Google اکاؤنٹ')}
                    </span>
                    <span className="font-bold text-[#0B1B32] dark:text-white truncate block" dir="ltr">
                      {currentOrg.driveAccountEmail || currentOrg.ownerEmail}
                    </span>
                    <span className="text-[11px] text-[#1764FF] dark:text-[#6CA2FF] block truncate">
                      {currentOrg.driveAccountName || currentOrg.ownerName}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                      {tr('تاريخ الربط والتحقق', 'Linked & Verified At', 'کنکشن اور تصدیق کی تاریخ')}
                    </span>
                    <span className="font-bold text-[#0B1B32] dark:text-white block">
                      {currentOrg.driveLinkedAt
                        ? new Date(currentOrg.driveLinkedAt).toLocaleString(dateLocale)
                        : tr('مربوط', 'Linked', 'منسلک')}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 truncate block" dir="ltr">
                      Sub: {currentOrg.driveGoogleSub || tr('موثق', 'Verified', 'تصدیق شدہ')}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                      {tr('تفويض الجلسة المؤقت (RAM)', 'In-Memory OAuth Token (RAM)', 'عارضی سیشن ٹوکن (RAM)')}
                    </span>
                    <span className="font-bold text-[#0B1B32] dark:text-white block">
                      {driveSession
                        ? tr(
                            `نشط (${remainingMinutes > 0 ? `${remainingMinutes} دقيقة متبقية` : 'أقل من دقيقة'})`,
                            `Active (${remainingMinutes > 0 ? `${remainingMinutes} min remaining` : '< 1 min'})`,
                            `فعال (${remainingMinutes > 0 ? `${remainingMinutes} منٹ باقی` : '1 منٹ سے کم'})`
                          )
                        : tr(
                            'منتهٍ / يتطلب إعادة تفويض عند المزامنة والفحص',
                            'Expired / re-authorize to sync or test',
                            'ختم ہو گیا / ہم آہنگی کے لیے دوبارہ اجازت درکار'
                          )}
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      {tr(
                        'لا يُخزن أي Access Token في Firestore أو ذاكرة المتصفح الدائمة',
                        'No Access Token is persisted to Firestore or browser storage',
                        'کوئی Access Token مستقل اسٹوریج یا Firestore میں محفوظ نہیں کیا جاتا'
                      )}
                    </span>
                  </div>
                </div>

                {/* Readiness Health Card */}
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                    driveReadiness.isReady
                      ? 'bg-[#08C99B]/10 border-[#08C99B]/30 text-[#048264] dark:text-[#08C99B]'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                    <span className="flex items-center gap-1.5">
                      {driveReadiness.isReady ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>
                        {tr('حالة جاهزية الكتابة والقراءة:', 'Read/Write Readiness:', 'لکھنے اور پڑھنے کی تیاری:')}{' '}
                        {currentOrg.driveLastHealthStatus === 'verified' && currentOrg.driveWriteVerified
                          ? tr('مؤكدة ومختبرة فعلياً', 'Verified & Tested', 'تصدیق شدہ اور ٹیسٹ شدہ')
                          : currentOrg.driveLastHealthStatus === 'failed'
                          ? tr('فشل الفحص — الإدخال متوقف مؤقتاً', 'Check Failed — Entry Paused', 'جانچ ناکام — اندراج عارضی طور پر معطل')
                          : tr('غير مختبرة بعد — يرجى تنفيذ فحص الجاهزية', 'Not Tested Yet — Run Readiness Check', 'ابھی ٹیسٹ نہیں ہوا — تیاری کی جانچ چلائیں')}
                      </span>
                    </span>
                    {currentOrg.driveWriteVerifiedAt && (
                      <span className="text-[11px] font-mono opacity-80">
                        {tr('آخر تحقق:', 'Last Verified:', 'آخری تصدیق:')}{' '}
                        {new Date(currentOrg.driveWriteVerifiedAt).toLocaleString(dateLocale)}
                      </span>
                    )}
                  </div>
                  {!driveReadiness.isReady && (
                    <p className="text-[11px] leading-relaxed">
                      {driveReadiness.detail || driveReadiness.message}
                    </p>
                  )}
                  {!driveSession && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                      {tr(
                        'تنبيه الجلسة: انتهت صلاحية جلسة التفويض المؤقتة في هذا المتصفح. اضغط على «إعادة التفويض وفحص الجاهزية» لتجديد الجلسة.',
                        'Session Notice: The temporary OAuth session in this browser has expired. Click "Re-authorize & Test Readiness" to renew.',
                        'سیشن انتباہ: اس براؤزر میں عارضی اجازت ختم ہو گئی ہے۔ سیشن کی تجدید کے لیے "دوبارہ اجازت اور جانچ" پر کلک کریں۔'
                      )}
                    </p>
                  )}
                </div>

                {/* Organization Root Folder Card */}
                {currentOrg.driveFolderId && (
                  <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold text-[#0B1B32] dark:text-white">
                        <FolderCheck className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF] shrink-0" />
                        <span>{tr('مجلد المؤسسة في Drive:', 'Organization Drive Folder:', 'Drive میں ادارے کا فولڈر:')}</span>
                        <span className="text-[#1764FF] dark:text-[#6CA2FF] font-mono text-[11px] sm:text-xs">
                          {currentOrg.driveFolderName || `AL EQFAL - ${currentOrg.name} - ${currentOrg.id}`}
                        </span>
                      </div>

                      {(currentOrg.driveFolderLink || currentOrg.driveFolderId) && (
                        <a
                          href={buildGoogleDriveFolderUrl(
                            currentOrg.driveFolderLink,
                            currentOrg.driveFolderId,
                            linkedDriveEmail
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-[#1764FF]/10 hover:bg-[#1764FF]/20 text-[#1764FF] dark:text-[#6CA2FF] font-bold text-xs inline-flex items-center gap-1.5 transition-colors"
                        >
                          <span>{tr('فتح في Google Drive', 'Open in Google Drive', 'Google Drive میں کھولیں')}</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate select-all" dir="ltr">
                      Folder ID: {currentOrg.driveFolderId}
                    </div>

                    {branches.length > 0 && (
                      <div className="pt-2 border-t border-[#DCE6FA] dark:border-[#1F3B66] space-y-2">
                        <div className="flex items-center gap-1.5 font-bold text-[#0B1B32] dark:text-slate-200 text-[11px]">
                          <FolderTree className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                          <span>
                            {tr('مجلدات الفروع وشهر', 'Branch Folders & Month', 'برانچ فولڈرز اور مہینہ')}{' '}
                            {currentYearMonth}:
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {branches.map((branch) => {
                            const monthKey = `${branch.id}_${currentYearMonth}`;
                            const monthRef = currentOrg.driveMonthFolderIds?.[monthKey];
                            const targetFolderId = monthRef?.folderId || branch.driveFolderId;
                            const targetLink = monthRef?.webViewLink || branch.driveFolderLink;
                            return (
                              <div
                                key={branch.id}
                                className="p-2.5 rounded-lg bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="font-bold text-[#0B1B32] dark:text-slate-200 truncate">
                                    {branch.name} ({branch.code})
                                  </div>
                                  <div className="text-[10px] text-slate-400 truncate">
                                    {branch.driveFolderId
                                      ? monthRef?.folderId
                                        ? tr(
                                            `مجلد الفرع + ${currentYearMonth} جاهزان`,
                                            `Branch + ${currentYearMonth} ready`,
                                            `برانچ + ${currentYearMonth} تیار`
                                          )
                                        : tr('مجلد الفرع مربوط', 'Branch folder linked', 'برانچ فولڈر منسلک')
                                      : tr('بانتظار مزامنة مجلد الفرع', 'Pending folder sync', 'فولڈر ہم آہنگی زیر التواء')}
                                  </div>
                                </div>
                                {targetFolderId && (
                                  <a
                                    href={buildGoogleDriveFolderUrl(
                                      targetLink,
                                      targetFolderId,
                                      linkedDriveEmail
                                    )}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2 py-1 rounded bg-[#F5F8FF] dark:bg-[#0E203A] hover:text-[#1764FF] dark:hover:text-[#6CA2FF] text-slate-600 dark:text-slate-300 text-[10px] font-bold shrink-0 inline-flex items-center gap-1"
                                  >
                                    <span>{tr('فتح', 'Open', 'کھولیں')}</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleVerifyDriveHealth}
                    disabled={healthCheckLoading || syncLoading || driveLoading || disconnectLoading || !isOAuthConfigured}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-[#0B1B32] bg-[#08C99B] hover:bg-[#06B48A] disabled:opacity-50 shadow-sm flex items-center gap-2 transition-all active:scale-95"
                  >
                    <ShieldCheck className={`w-4 h-4 ${healthCheckLoading ? 'animate-pulse' : ''}`} />
                    <span>
                      {healthCheckLoading
                        ? tr('جاري اختبار الكتابة والقراءة...', 'Testing Read/Write...', 'لکھنے اور پڑھنے کا ٹیسٹ جاری ہے...')
                        : driveSession
                        ? tr('اختبار جاهزية الكتابة والقراءة', 'Test Read/Write Readiness', 'لکھنے اور پڑھنے کی جانچ')
                        : tr('إعادة التفويض وفحص الجاهزية', 'Re-authorize & Test Readiness', 'دوبارہ اجازت اور جانچ')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSyncDriveFolders}
                    disabled={syncLoading || healthCheckLoading || driveLoading || disconnectLoading || !isOAuthConfigured}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] disabled:opacity-50 shadow-sm flex items-center gap-2 transition-all active:scale-95"
                  >
                    {syncLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <FolderPlus className="w-4 h-4" />
                    )}
                    <span>
                      {syncLoading
                        ? tr('جاري مزامنة المجلدات والفحص...', 'Syncing Folders & Testing...', 'فولڈرز ہم آہنگ ہو رہے ہیں...')
                        : tr('مزامنة مجلدات الفروع والشهر الحالي', 'Sync Branch & Monthly Folders', 'برانچ اور ماہانہ فولڈرز ہم آہنگ کریں')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleConnectDrive}
                    disabled={driveLoading || syncLoading || healthCheckLoading || disconnectLoading || !isOAuthConfigured}
                    className="px-3.5 py-2.5 rounded-xl text-xs font-bold text-[#0B1B32] dark:text-slate-200 bg-[#F5F8FF] dark:bg-[#0E203A] hover:border-[#1764FF]/50 border border-[#DCE6FA] dark:border-[#1F3B66] disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${driveLoading ? 'animate-spin' : ''}`} />
                    <span>
                      {driveLoading
                        ? tr('جاري إعادة الربط...', 'Reconnecting...', 'دوبارہ منسلک ہو رہا ہے...')
                        : tr('إعادة ربط', 'Reconnect', 'دوبارہ منسلک کریں')}
                    </span>
                  </button>

                  {!confirmDisconnect ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(true)}
                      disabled={driveLoading || syncLoading || healthCheckLoading || disconnectLoading}
                      className="px-3.5 py-2.5 rounded-xl text-xs font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/25 disabled:opacity-50 flex items-center gap-2 transition-colors"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      <span>{tr('فصل الاتصال', 'Disconnect', 'منقطع کریں')}</span>
                    </button>
                  ) : (
                    <div className="w-full p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <span className="text-slate-700 dark:text-slate-200 font-medium">
                        {tr(
                          'هل تريد فصل ربط Google Drive؟ لن يتم حذف أي ملفات في Drive أو سجلات في النظام.',
                          'Disconnect Google Drive? No files in Drive or records in the system will be deleted.',
                          'کیا آپ Google Drive منقطع کرنا چاہتے ہیں؟ Drive یا سسٹم میں کوئی فائل یا ریکارڈ حذف نہیں ہوگا۔'
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleConfirmDisconnect}
                          disabled={disconnectLoading}
                          className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs disabled:opacity-50"
                        >
                          {disconnectLoading
                            ? tr('جاري الفصل...', 'Disconnecting...', 'منقطع ہو رہا ہے...')
                            : tr('تأكيد الفصل', 'Confirm Disconnect', 'منقطع کرنے کی تصدیق')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDisconnect(false)}
                          disabled={disconnectLoading}
                          className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300 font-bold text-xs"
                        >
                          {tr('إلغاء', 'Cancel', 'منسوخ')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Disconnected State */
              <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3.5 text-xs">
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {language === 'ar' ? (
                    <>
                      عند ربط حساب{' '}
                      <span className="font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                        {googleProvider?.email || currentOrg?.ownerEmail}
                      </span>
                      ، سيطلب النظام تفويض نطاق{' '}
                      <code className="px-1.5 py-0.5 rounded bg-white dark:bg-[#122543] font-mono text-[#1764FF] dark:text-[#6CA2FF]">
                        drive.file
                      </code>{' '}
                      فقط، ويتحقق من هوية المالك، ثم ينشئ مجلد المؤسسة{' '}
                      <code className="px-1.5 py-0.5 rounded bg-white dark:bg-[#122543] font-mono text-[#1764FF] dark:text-[#6CA2FF]">
                        AL EQFAL - {currentOrg?.name}
                      </code>{' '}
                      ومجلدات الفروع داخل Google Drive الخاص بالمالك.
                    </>
                  ) : language === 'en' ? (
                    <>
                      Connecting{' '}
                      <span className="font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                        {googleProvider?.email || currentOrg?.ownerEmail}
                      </span>{' '}
                      requests only the{' '}
                      <code className="px-1.5 py-0.5 rounded bg-white dark:bg-[#122543] font-mono text-[#1764FF] dark:text-[#6CA2FF]">
                        drive.file
                      </code>{' '}
                      scope, verifies owner identity, and creates{' '}
                      <code className="px-1.5 py-0.5 rounded bg-white dark:bg-[#122543] font-mono text-[#1764FF] dark:text-[#6CA2FF]">
                        AL EQFAL - {currentOrg?.name}
                      </code>{' '}
                      along with branch subfolders inside the owner&apos;s Google Drive.
                    </>
                  ) : (
                    <>
                      اکاؤنٹ{' '}
                      <span className="font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                        {googleProvider?.email || currentOrg?.ownerEmail}
                      </span>{' '}
                      منسلک کرنے پر سسٹم صرف{' '}
                      <code className="px-1.5 py-0.5 rounded bg-white dark:bg-[#122543] font-mono text-[#1764FF] dark:text-[#6CA2FF]">
                        drive.file
                      </code>{' '}
                      کی اجازت طلب کرے گا اور مالک کے Google Drive میں{' '}
                      <code className="px-1.5 py-0.5 rounded bg-white dark:bg-[#122543] font-mono text-[#1764FF] dark:text-[#6CA2FF]">
                        AL EQFAL - {currentOrg?.name}
                      </code>{' '}
                      اور برانچ فولڈرز بنائے گا۔
                    </>
                  )}
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleConnectDrive}
                    disabled={driveLoading || !isOAuthConfigured}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] disabled:opacity-50 shadow-sm flex items-center gap-2 transition-all active:scale-95"
                  >
                    {driveLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Link2 className="w-4 h-4" />
                    )}
                    <span>
                      {driveLoading
                        ? tr('جاري التفويض وتهيئة المجلدات...', 'Authorizing & Creating Folders...', 'اجازت اور فولڈرز تیار ہو رہے ہیں...')
                        : tr('ربط Google Drive', 'Connect Google Drive', 'Google Drive منسلک کریں')}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Card 3: Appearance & Language Preferences */}
          <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-3 pb-4 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
              <div className="w-10 h-10 rounded-xl bg-[#1764FF]/10 border border-[#1764FF]/20 text-[#1764FF] dark:text-[#6CA2FF] flex items-center justify-center">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#0B1B32] dark:text-white">
                  {tr('تفضيلات العرض واللغة', 'Appearance & Language Preferences', 'ڈسپلے اور زبان کی ترجیحات')}
                </h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'تخصيص الواجهة واللغة والاتجاه لكل جهاز',
                    'Customize interface theme, language, and text direction per device',
                    'ہر ڈیوائس کے لیے تھیم، زبان اور سمت کی تخصیص کریں'
                  )}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              {/* Language Selection */}
              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-2">
                  {tr('لغة النظام (System Language)', 'System Language', 'سسٹم کی زبان')}
                </label>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => handleLanguageChange('ar')}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      language === 'ar'
                        ? 'bg-[#1764FF]/12 border-[#1764FF]/50 text-[#1764FF] dark:text-[#6CA2FF] font-bold shadow-sm'
                        : 'bg-[#F5F8FF] dark:bg-[#0E203A] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-400 hover:border-[#1764FF]/35'
                    }`}
                  >
                    <span className="text-base block mb-0.5">🇸🇦</span>
                    <span className="text-xs font-bold block">العربية</span>
                    <span className="text-[10px] text-slate-400">RTL</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleLanguageChange('en')}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      language === 'en'
                        ? 'bg-[#1764FF]/12 border-[#1764FF]/50 text-[#1764FF] dark:text-[#6CA2FF] font-bold shadow-sm'
                        : 'bg-[#F5F8FF] dark:bg-[#0E203A] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-400 hover:border-[#1764FF]/35'
                    }`}
                  >
                    <span className="text-base block mb-0.5">🇬🇧</span>
                    <span className="text-xs font-bold block">English</span>
                    <span className="text-[10px] text-slate-400">LTR</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleLanguageChange('ur')}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      language === 'ur'
                        ? 'bg-[#1764FF]/12 border-[#1764FF]/50 text-[#1764FF] dark:text-[#6CA2FF] font-bold shadow-sm'
                        : 'bg-[#F5F8FF] dark:bg-[#0E203A] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-400 hover:border-[#1764FF]/35'
                    }`}
                  >
                    <span className="text-base block mb-0.5">🇵🇰</span>
                    <span className="text-xs font-bold block">اردو</span>
                    <span className="text-[10px] text-slate-400">RTL</span>
                  </button>
                </div>
              </div>

              {/* Theme Selection */}
              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-2">
                  {tr('سمة الألوان (Theme Mode)', 'Theme Mode', 'تھیم موڈ')}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleThemeChange('dark')}
                    className={`p-3 rounded-xl border flex items-center justify-center gap-2.5 transition-all ${
                      theme === 'dark'
                        ? 'bg-[#1764FF]/12 border-[#1764FF]/50 text-[#1764FF] dark:text-[#6CA2FF] font-bold shadow-sm'
                        : 'bg-[#F5F8FF] dark:bg-[#0E203A] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Moon className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                    <span className="text-xs">
                      {tr('الوضع الداكن', 'Dark Mode', 'ڈارک موڈ')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleThemeChange('light')}
                    className={`p-3 rounded-xl border flex items-center justify-center gap-2.5 transition-all ${
                      theme === 'light'
                        ? 'bg-[#1764FF]/12 border-[#1764FF]/50 text-[#1764FF] dark:text-[#6CA2FF] font-bold shadow-sm'
                        : 'bg-[#F5F8FF] dark:bg-[#0E203A] border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Sun className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                    <span className="text-xs">
                      {tr('الوضع الفاتح', 'Light Mode', 'لائٹ موڈ')}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column (1 Col): System Architecture & Readiness */}
        <div className="space-y-6">
          <section className="bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-[#1764FF] dark:text-[#6CA2FF] font-bold text-xs uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" />
              <span>{tr('جاهزية النظام والأمان', 'System Readiness & Security', 'سسٹم کی تیاری اور تحفظ')}</span>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <span className="text-slate-400 block text-[11px]">
                  {tr('البنية السحابية', 'Cloud Infrastructure', 'کلاؤڈ انفراسٹرکچر')}
                </span>
                <span className="font-bold text-[#0B1B32] dark:text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#08C99B]" />
                  {tr('معاملات ذرية محمية بقواعد Firestore', 'Atomic Firestore Transactions', 'محفوظ ایٹامک Firestore ٹرانزیکشنز')}
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {tr(
                    'تعتمد جميع الإقفالات وفواتير المشتريات على معاملات ذرية محمية بقواعد الأمان.',
                    'All shift closings and purchase invoices rely on atomic rule-protected transactions.',
                    'تمام شفٹ کلوزنگز اور خریداری انوائسز محفوظ ایٹامک ٹرانزیکشنز پر مبنی ہیں۔'
                  )}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-1">
                <span className="text-slate-400 block text-[11px]">
                  {tr('حماية عزل البيانات', 'Data Isolation Security', 'ڈیٹا علیحدگی کا تحفظ')}
                </span>
                <span className="font-bold text-[#0B1B32] dark:text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#048264] dark:text-[#08C99B]" />
                  Multi-Tenant Rules Enforced
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {tr(
                    'كل مؤسسة معزولة كلياً، وسجلات التدقيق غير قابلة للتعديل أو الحذف، والحسابات المالية محكمة بدقة الهللات.',
                    'Each organization is strictly isolated, audit trails are immutable, and accounting uses exact halala precision.',
                    'ہر ادارہ مکمل طور پر الگ تھلگ ہے، آڈٹ لاگز ناقابلِ تبدیلی ہیں، اور مالی حسابات درست ہلالہ پیمائش پر مبنی ہیں۔'
                  )}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-[#E6EEFC] dark:border-[#1F3B66] flex items-center justify-between text-[11px] text-slate-400">
              <span>AL EQFAL</span>
              <span className="font-mono text-[#048264] dark:text-[#08C99B]">Verified</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
