import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  X,
  Lock,
  Building2,
  Mail,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  ArrowRight
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
  const { t, direction } = useLanguage();
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

  // Localized error message mapper
  const getFirebaseErrorMessage = (err: any): string => {
    const code = err?.code || '';
    switch (code) {
      case 'auth/unauthorized-domain':
        return 'النطاق (amoal2030.github.io) غير مضاف إلى النطاقات المعتمدة (Authorized domains) في Firebase Authentication. يلزم إضافته من Firebase Console لتفعيل تسجيل الدخول على GitHub Pages.';
      case 'auth/popup-blocked':
        return 'قام المتصفح بحظر النافذة المنبثقة. يرجى السماح بالنوافذ المنبثقة في إعدادات متصفحك أو إعادة المحاولة.';
      case 'auth/operation-not-allowed':
        return 'طريقة تسجيل الدخول (Google أو البريد) غير مفعلة في Firebase Console. يرجى تفعيلها من Sign-in method.';
      case 'auth/too-many-requests':
        return 'تم حظر المحاولات مؤقتاً لكثرة الطلبات. يرجى الانتظار دقيقة واحدة ثم المحاولة.';
      case 'auth/user-disabled':
        return 'تم تعطيل هذا الحساب من قِبل إدارة المنظومة.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'بيانات الدخول غير صحيحة، يرجى التحقق من البريد الإلكتروني وكلمة المرور.';
      case 'auth/email-already-in-use':
        return 'البريد الإلكتروني مسجل مسبقاً في النظام.';
      case 'auth/invalid-email':
        return 'صيغة البريد الإلكتروني غير صالحة.';
      case 'auth/weak-password':
        return 'كلمة المرور ضعيفة جداً، يرجى استخدام 6 خانات على الأقل.';
      case 'auth/popup-closed-by-user':
        return 'تم إغلاق نافذة تسجيل الدخول قبل استكمال المصادقة. يرجى المحاولة مجدداً.';
      case 'auth/network-request-failed':
        return 'تعذر الاتصال بالخادم السحابي. يرجى التحقق من اتصالك بالإنترنت.';
      default:
        return err?.message || 'حدث خطأ غير متوقع أثناء تسجيل الدخول.';
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
      setErrorMsg('يرجى إدخال البريد الإلكتروني أولاً');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await resetPassword(email);
      setSuccessMsg('تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني بنجاح.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/65 backdrop-blur-xs transition-all">
      <div
        className="relative w-full max-w-lg max-h-[92vh] flex flex-col bg-white dark:bg-[#0C1829] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
        dir={direction}
      >
        {/* Modal Header (Dark Navy) */}
        <div className="shrink-0 px-5 py-4 bg-[#0B192C] text-white border-b border-[#1A3152] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/25 border border-blue-400/30 text-blue-200 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-extrabold text-white leading-tight">
                {t('authModalTitle')}
              </h3>
              <span className="text-[11px] sm:text-xs text-blue-200/80">
                {t('brandName')} | {t('brandSub')}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
            aria-label="إغلاق النافذة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        {!isForgotPassword && (
          <div className="shrink-0 grid grid-cols-2 p-1.5 bg-[#F4F7FB] dark:bg-[#091526] border-b border-slate-200 dark:border-slate-800 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setActiveTab('manager');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`py-2 rounded-xl transition-all min-h-[38px] ${
                activeTab === 'manager' || activeTab === 'register'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-[#0B192C] dark:hover:text-white'
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
              className={`py-2 rounded-xl transition-all min-h-[38px] ${
                activeTab === 'employee'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-[#0B192C] dark:hover:text-white'
              }`}
            >
              {t('authEmployeeTab')}
            </button>
          </div>
        )}

        {/* Scrollable Modal Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 sm:space-y-5">
          {/* Messages */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span>{errorMsg}</span>
                {errorMsg.includes('amoal2030.github.io') && (
                  <div className="pt-2 mt-2 border-t border-rose-500/20 text-[11px] font-mono-num text-rose-700 dark:text-rose-300">
                    النطاق المطلوب إضافته: <span className="font-bold underline select-all">amoal2030.github.io</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}
          {isForgotPassword ? (
            /* Forgot Password Form */
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="text-xs text-slate-600 dark:text-slate-300">
                أدخل بريدك الإلكتروني المسجل وسنرسل لك رابطاً لإعادة تعيين كلمة المرور فوراً عبر Firebase Auth.
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                  {t('authEmail')}
                </label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@store.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute end-3 top-3" />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 rounded-xl font-bold text-xs text-white bg-blue-600 hover:bg-blue-700 transition-all active:scale-99 disabled:opacity-50"
                >
                  {loading ? 'جاري الإرسال...' : 'إرسال رابط الاستعادة'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsForgotPassword(false)}
                  className="px-4 py-3 rounded-xl font-semibold text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  إلغاء
                </button>
              </div>
            </form>
          ) : (activeTab === 'manager' || activeTab === 'register') ? (
            /* Manager Google Login & Onboarding */
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/35 border border-blue-200/80 dark:border-blue-800/70 text-xs text-blue-950 dark:text-blue-200 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  {t('subAuthNoticeNewManager')}
                </p>
              </div>

              <button
                type="button"
                onClick={handleGoogleManagerSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#070E17] hover:bg-blue-50/60 dark:hover:bg-slate-800 text-[#0B192C] dark:text-white text-sm font-bold shadow-xs hover:border-blue-300 transition-all active:scale-99 disabled:opacity-50"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48">
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
                <span>{loading ? 'جاري الاتصال بـ Firebase...' : t('authGoogleSignIn')}</span>
              </button>

              <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                {t('authNoticeManager')}
              </div>
            </div>
          ) : (
            /* Employee Login */
            <form onSubmit={handleEmployeeLogin} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{t('authNoticeEmployee')}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                  {t('authEmail')}
                </label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="cashier@store.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute end-3 top-3" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300">
                    {t('authPassword')}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotPassword(true);
                      setErrorMsg(null);
                    }}
                    className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                  />
                  <KeyRound className="w-4 h-4 text-slate-400 absolute end-3 top-3" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 transition-all active:scale-99 shadow-xs disabled:opacity-50"
              >
                {loading ? 'جاري التحقق والدخول...' : t('authSubmitLogin')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
