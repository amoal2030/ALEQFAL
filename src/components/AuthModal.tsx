import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { BrandLogo } from './common/BrandLogo';
import {
  X,
  Mail,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  initialTab?: 'manager' | 'employee' | 'register';
  onClose: () => void;
  onSuccess?: (userType: 'manager' | 'employee', data?: any) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialTab = 'manager',
  onClose,
  onSuccess,
}) => {
  const { t, direction, tr } = useLanguage();
  const { loginWithGoogle, loginWithEmailPassword, resetPassword } = useAuth();

  const [activeTab, setActiveTab] = useState<'manager' | 'employee' | 'register'>(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isForgotPassword, setIsForgotPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setErrorMsg(null);
      setSuccessMsg(null);
      setIsForgotPassword(false);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const getFirebaseErrorMessage = (err: any): string => {
    const code = err?.code || '';
    switch (code) {
      case 'auth/unauthorized-domain':
        return t('authErrUnauthorizedDomain');
      case 'auth/popup-blocked':
        return t('authErrPopupBlocked');
      case 'auth/operation-not-allowed':
        return t('authErrOperationNotAllowed');
      case 'auth/too-many-requests':
        return t('authErrTooManyRequests');
      case 'auth/user-disabled':
        return t('authErrUserDisabled');
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return t('authErrInvalidCredentials');
      case 'auth/email-already-in-use':
        return t('authErrEmailInUse');
      case 'auth/invalid-email':
        return t('authErrInvalidEmail');
      case 'auth/weak-password':
        return t('authErrWeakPassword');
      case 'auth/popup-closed-by-user':
        return t('authErrPopupClosed');
      case 'auth/network-request-failed':
        return t('authErrNetwork');
      default:
        return err?.message || t('authErrGeneric');
    }
  };

  const handleGoogleManagerSignIn = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await loginWithGoogle();
      if (onSuccess) onSuccess('manager');
      onClose();
    } catch (err: any) {
      setErrorMsg(getFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleEmployeeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await loginWithEmailPassword(email, password);
      if (onSuccess) onSuccess('employee');
      onClose();
    } catch (err: any) {
      setErrorMsg(getFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setErrorMsg(t('authEnterEmailFirst'));
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await resetPassword(email);
      setSuccessMsg(t('authResetSent'));
      setTimeout(() => {
        setIsForgotPassword(false);
      }, 4000);
    } catch (err: any) {
      setErrorMsg(getFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#0B1B32]/70 backdrop-blur-xs transition-all">
      <div
        className="relative w-full max-w-lg max-h-[92vh] flex flex-col bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6F8] dark:border-[#1F3B66] shadow-2xl overflow-hidden"
        dir={direction}
      >
        {/* Modal Header (Theme-matched with Official Auto-Switching Logo) */}
        <div className="shrink-0 px-5 py-4 bg-[#F5F8FF] dark:bg-[#0B1B32] text-[#0B1B32] dark:text-white border-b border-[#E2EAFA] dark:border-[#1E3A63] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-extrabold text-[#0B1B32] dark:text-white leading-tight truncate">
                {t('authModalTitle')}
              </h3>
              <span className="text-[11px] sm:text-xs font-semibold text-[#1764FF] dark:text-[#7EB0FF]">
                {t('brandName')} | {t('brandSub')}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#526785] dark:text-slate-300 hover:text-[#0B1B32] dark:hover:text-white hover:bg-[#EAF1FF] dark:hover:bg-white/10 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0"
            aria-label={t('authClose')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        {!isForgotPassword && (
          <div className="shrink-0 grid grid-cols-2 p-1.5 bg-[#F5F8FF] dark:bg-[#0E203A] border-b border-[#E2EAFA] dark:border-[#1E3A63] text-xs font-bold gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveTab('manager');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`py-2.5 rounded-xl transition-all min-h-[38px] ${
                activeTab === 'manager' || activeTab === 'register'
                  ? 'bg-[#1764FF] text-white shadow-xs'
                  : 'text-[#526785] dark:text-slate-300 hover:text-[#0B1B32] dark:hover:text-white'
              }`}
            >
              {t('authManagerTab')}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('employee');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`py-2.5 rounded-xl transition-all min-h-[38px] ${
                activeTab === 'employee'
                  ? 'bg-[#1764FF] text-white shadow-xs'
                  : 'text-[#526785] dark:text-slate-300 hover:text-[#0B1B32] dark:hover:text-white'
              }`}
            >
              {t('authEmployeeTab')}
            </button>
          </div>
        )}

        {/* Scrollable Modal Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 sm:space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/35 text-rose-700 dark:text-rose-200 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span>{errorMsg}</span>
                {errorMsg.includes('amoal2030.github.io') && (
                  <div className="pt-2 mt-2 border-t border-rose-500/20 text-[11px] font-mono-num">
                    {tr('النطاق المطلوب إضافته:', 'Required domain:', 'مطلوبہ ڈومین:')}{' '}
                    <span className="font-bold underline select-all">amoal2030.github.io</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {successMsg && (
            <div className="p-3.5 rounded-xl bg-[#08C99B]/12 dark:bg-[#08C99B]/18 border border-[#08C99B]/35 text-[#048264] dark:text-[#3CE0B9] text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {isForgotPassword ? (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="text-xs text-[#526785] dark:text-slate-300 leading-relaxed">
                {t('authForgotDesc')}
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                  {t('authEmail')}
                </label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@store.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6F8] dark:border-[#23416E] text-sm text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20"
                  />
                  <Mail className="w-4 h-4 text-[#647B9C] dark:text-slate-400 absolute end-3 top-3" />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 rounded-xl font-bold text-xs text-white bg-[#1764FF] hover:bg-[#1052D8] transition-all active:scale-99 disabled:opacity-50"
                >
                  {loading ? t('authSending') : t('authSendResetLink')}
                </button>
                <button
                  type="button"
                  onClick={() => setIsForgotPassword(false)}
                  className="px-4 py-3 rounded-xl font-semibold text-xs text-[#0B1B32] dark:text-slate-200 bg-[#F5F8FF] dark:bg-[#162D50] border border-[#DCE6F8] dark:border-[#24426E] hover:bg-[#EAF1FF] dark:hover:bg-[#1D3963]"
                >
                  {t('authCancel')}
                </button>
              </div>
            </form>
          ) : activeTab === 'manager' || activeTab === 'register' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#1764FF]/8 dark:bg-[#1764FF]/15 border border-[#1764FF]/20 dark:border-[#1764FF]/35 text-xs text-[#0B1B32] dark:text-blue-100 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-[#1764FF] dark:text-[#7EB0FF] shrink-0 mt-0.5" />
                <p className="leading-relaxed">{t('subAuthNoticeNewManager')}</p>
              </div>

              <button
                type="button"
                onClick={handleGoogleManagerSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl border border-[#DCE6F8] dark:border-[#24426E] bg-white dark:bg-[#0E203A] hover:bg-[#F5F8FF] dark:hover:bg-[#162D50] text-[#0B1B32] dark:text-white text-sm font-bold shadow-xs hover:border-[#1764FF] transition-all active:scale-99 disabled:opacity-50"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>{loading ? t('authConnecting') : t('authGoogleSignIn')}</span>
              </button>

              <div className="text-center text-xs text-[#526785] dark:text-slate-300 leading-relaxed">
                {t('authNoticeManager')}
              </div>
            </div>
          ) : (
            <form onSubmit={handleEmployeeLogin} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6F8] dark:border-[#23416E] text-xs text-[#526785] dark:text-slate-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-[#1764FF] dark:text-[#7EB0FF] shrink-0 mt-0.5" />
                <p className="leading-relaxed">{t('authNoticeEmployee')}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                  {t('authEmail')}
                </label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="cashier@store.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6F8] dark:border-[#23416E] text-sm text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20"
                  />
                  <Mail className="w-4 h-4 text-[#647B9C] dark:text-slate-400 absolute end-3 top-3" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200">
                    {t('authPassword')}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotPassword(true);
                      setErrorMsg(null);
                    }}
                    className="text-[11px] font-bold text-[#1764FF] dark:text-[#7EB0FF] hover:underline"
                  >
                    {t('authForgotPassword')}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6F8] dark:border-[#23416E] text-sm text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20"
                  />
                  <KeyRound className="w-4 h-4 text-[#647B9C] dark:text-slate-400 absolute end-3 top-3" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl font-bold text-sm text-white bg-[#1764FF] hover:bg-[#1052D8] transition-all active:scale-99 shadow-xs disabled:opacity-50"
              >
                {loading ? t('authVerifying') : t('authSubmitLogin')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
