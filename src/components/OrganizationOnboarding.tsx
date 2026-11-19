import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  Building2,
  Lock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  LogOut,
  Sparkles,
  MapPin,
  FileText,
  DollarSign
} from 'lucide-react';

export const OrganizationOnboarding: React.FC = () => {
  const { completeOrganizationSetup, currentUser, logout } = useAuth();
  const { t, direction } = useLanguage();

  const [orgName, setOrgName] = useState('');
  const [commercialRegistration, setCommercialRegistration] = useState('');
  const [activityType, setActivityType] = useState('restaurant');
  const [currency, setCurrency] = useState('SAR');
  const [firstBranchName, setFirstBranchName] = useState('الفرع الرئيسي');
  const [firstBranchAddress, setFirstBranchAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || !firstBranchName.trim()) {
      setErrorMsg('يرجى إدخال اسم المؤسسة واسم الفرع الرئيسي');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      await completeOrganizationSetup({
        orgName,
        commercialRegistration,
        activityType,
        currency,
        firstBranchName,
        firstBranchAddress,
      });
    } catch (err: any) {
      console.error('Error completing organization setup:', err);
      setErrorMsg(err.message || 'حدث خطأ أثناء تأسيس المؤسسة. يرجى المحاولة ثانية.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F4F7FB] dark:bg-[#070E17]" dir={direction}>
      <div className="w-full max-w-2xl bg-white dark:bg-[#0C1829] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden transition-all">
        {/* Header Banner */}
        <div className="bg-[#0B192C] p-5 sm:p-8 text-white relative border-b border-[#1A3152]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-blue-600/25 border border-blue-400/30 text-blue-200 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-blue-300">
                  {t('badgeCloudSaaS')}
                </span>
                <h2 className="text-base sm:text-2xl font-extrabold">
                  تأسيس المؤسسة التجارية الجديدة
                </h2>
              </div>
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors text-xs flex items-center gap-1.5"
              title={t('navLogout')}
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">{t('navLogout')}</span>
            </button>
          </div>

          <p className="mt-3 text-xs sm:text-sm text-slate-300 leading-relaxed max-w-xl">
            مرحباً بك يا <span className="font-bold text-blue-300">{currentUser?.displayName || currentUser?.email}</span>. خطوة واحدة أخيرة لتجهيز منظومتك المحاسبية وقاعدة بياناتك المنعزلة.
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-8 space-y-5 sm:space-y-6">
          {errorMsg && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs sm:text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Org Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-extrabold text-[#0B192C] dark:text-white flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>البيانات الأساسية للمؤسسة</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                  اسم المؤسسة / المتجر التجاري *
                </label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="مثال: مطاعم ومقاهي السعادة"
                  className="w-full px-4 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                  رقم السجل التجاري (اختياري)
                </label>
                <input
                  type="text"
                  value={commercialRegistration}
                  onChange={(e) => setCommercialRegistration(e.target.value)}
                  placeholder="مثال: 1010000000"
                  className="w-full px-4 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                  النشاط التجاري
                </label>
                <select
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600"
                >
                  <option value="restaurant">مطعم أو كافيه</option>
                  <option value="retail">تجارة تجزئة ومتاجر</option>
                  <option value="supermarket">تموينات وسوبرماركت</option>
                  <option value="services">خدمات تجارية</option>
                  <option value="other">نشاط تجاري آخر</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                  العملة المحاسبية الأساسية
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600"
                >
                  <option value="SAR">SAR - ريال سعودي</option>
                  <option value="AED">AED - درهم إماراتي</option>
                  <option value="QAR">QAR - ريال قطري</option>
                  <option value="KWD">KWD - دينار كويتي</option>
                  <option value="USD">USD - دولار أمريكي</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: First Branch Setup */}
          <div className="space-y-4 pt-2">
            <h3 className="text-sm font-extrabold text-[#0B192C] dark:text-white flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <MapPin className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <span>إعداد الفرع الأول التلقائي</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                  اسم الفرع الرئيسي *
                </label>
                <input
                  type="text"
                  required
                  value={firstBranchName}
                  onChange={(e) => setFirstBranchName(e.target.value)}
                  placeholder="مثال: الفرع الرئيسي - العليا"
                  className="w-full px-4 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                  عنوان الفرع أو المدينة (اختياري)
                </label>
                <input
                  type="text"
                  value={firstBranchAddress}
                  onChange={(e) => setFirstBranchAddress(e.target.value)}
                  placeholder="مثال: الرياض - طريق الملك فهد"
                  className="w-full px-4 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                />
              </div>
            </div>
          </div>

          {/* Privacy & Security Guarantee */}
          <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/35 border border-blue-200/80 dark:border-blue-800/70 text-xs text-blue-950 dark:text-blue-200 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed space-y-1">
              <span className="font-bold block">ضمان العزل والخصوصية:</span>
              <span>
                سيتم إنشاء معرف مشفر فريد لمؤسستك في Cloud Firestore، محمي بقواعد أمان تمنع أي وصول من مؤسسات أخرى، وتمنحك وحدك صلاحية إضافة الموظفين واعتماد الإقفالات.
              </span>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl font-bold text-sm sm:text-base text-white bg-blue-600 hover:bg-blue-700 active:scale-99 transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Building2 className="w-5 h-5" />
            <span>{loading ? 'جاري تأسيس المؤسسة وحفظ البيانات...' : 'تأكيد التأسيس والدخول إلى لوحة التحكم'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
