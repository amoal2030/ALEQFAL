import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { BrandLogo } from './common/BrandLogo';
import {
  Building2,
  ShieldCheck,
  AlertCircle,
  LogOut,
  MapPin,
  FileText,
} from 'lucide-react';

export const OrganizationOnboarding: React.FC = () => {
  const { completeOrganizationSetup, currentUser, logout } = useAuth();
  const { t, tr, direction } = useLanguage();

  const [orgName, setOrgName] = useState('');
  const [commercialRegistration, setCommercialRegistration] = useState('');
  const [activityType, setActivityType] = useState('restaurant');
  const [currency, setCurrency] = useState('SAR');
  const [firstBranchName, setFirstBranchName] = useState(
    tr('الفرع الرئيسي', 'Main Branch', 'مرکزی برانچ')
  );
  const [firstBranchAddress, setFirstBranchAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || !firstBranchName.trim()) {
      setErrorMsg(
        tr(
          'يرجى إدخال اسم المؤسسة واسم الفرع الرئيسي',
          'Please enter the organization name and main branch name',
          'براہ کرم ادارے اور مرکزی برانچ کا نام درج کریں'
        )
      );
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
      setErrorMsg(
        err.message ||
          tr(
            'حدث خطأ أثناء تأسيس المؤسسة. يرجى المحاولة ثانية.',
            'An error occurred while setting up the organization. Please try again.',
            'ادارہ قائم کرنے میں خرابی پیش آئی۔ براہ کرم دوبارہ کوشش کریں۔'
          )
      );
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full px-4 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-sm text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/15';

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 bg-[#F5F8FF] dark:bg-[#0B1B32]"
      dir={direction}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] shadow-xl overflow-hidden transition-all">
        {/* Header Banner */}
        <div className="bg-[#0B1B32] p-5 sm:p-8 text-white relative border-b border-[#1F3B66]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <BrandLogo size="sm" variant="dark" />
              <div>
                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#08C99B]">
                  {t('badgeCloudSaaS')}
                </span>
                <h2 className="text-base sm:text-2xl font-extrabold">
                  {tr(
                    'تأسيس المؤسسة التجارية الجديدة',
                    'Set Up Your New Organization',
                    'نیا تجارتی ادارہ قائم کریں'
                  )}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors text-xs flex items-center gap-1.5"
              title={t('navLogout')}
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">{t('navLogout')}</span>
            </button>
          </div>

          <p className="mt-3 text-xs sm:text-sm text-slate-300 leading-relaxed max-w-xl">
            {tr('مرحباً بك يا', 'Welcome,', 'خوش آمدید،')}{' '}
            <span className="font-bold text-[#6CA2FF]">
              {currentUser?.displayName || currentUser?.email}
            </span>
            .{' '}
            {tr(
              'خطوة واحدة أخيرة لتجهيز منظومتك المحاسبية وقاعدة بياناتك المنعزلة.',
              'One final step to initialize your accounting workspace and isolated tenant database.',
              'اپنا اکاؤنٹنگ نظام اور علیحدہ ڈیٹا بیس تیار کرنے کا بس ایک آخری مرحلہ باقی ہے۔'
            )}
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
            <h3 className="text-sm font-extrabold text-[#0B1B32] dark:text-white flex items-center gap-2 pb-2 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
              <FileText className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
              <span>
                {tr(
                  'البيانات الأساسية للمؤسسة',
                  'Organization Profile',
                  'ادارے کی بنیادی معلومات'
                )}
              </span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                  {tr(
                    'اسم المؤسسة / المتجر التجاري *',
                    'Organization / Business Name *',
                    'ادارے / کاروبار کا نام *'
                  )}
                </label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder={tr(
                    'مثال: مطاعم ومقاهي السعادة',
                    'e.g. Al-Saada Restaurants & Cafes',
                    'مثلاً: السعادہ ریسٹورنٹ اینڈ کیفے'
                  )}
                  className={`${inputClass} font-medium`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                  {tr(
                    'رقم السجل التجاري (اختياري)',
                    'Commercial Registration No. (Optional)',
                    'کمرشل رجسٹریشن نمبر (اختیاری)'
                  )}
                </label>
                <input
                  type="text"
                  value={commercialRegistration}
                  onChange={(e) => setCommercialRegistration(e.target.value)}
                  placeholder={tr('مثال: 1010000000', 'e.g. 1010000000', 'مثلاً: 1010000000')}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                  {tr('النشاط التجاري', 'Business Sector', 'تجارتی سرگرمی')}
                </label>
                <select
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                  className={inputClass}
                >
                  <option value="restaurant">
                    {tr('مطعم أو كافيه', 'Restaurant or Cafe', 'ریسٹورنٹ یا کیفے')}
                  </option>
                  <option value="retail">
                    {tr('تجارة تجزئة ومتاجر', 'Retail & Stores', 'ریٹیل اور اسٹورز')}
                  </option>
                  <option value="supermarket">
                    {tr('تموينات وسوبرماركت', 'Grocery & Supermarket', 'سپر مارکیٹ اور گروسری')}
                  </option>
                  <option value="services">
                    {tr('خدمات تجارية', 'Commercial Services', 'تجارتی خدمات')}
                  </option>
                  <option value="other">
                    {tr('نشاط تجاري آخر', 'Other Business Activity', 'دیگر تجارتی سرگرمی')}
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                  {tr(
                    'العملة المحاسبية الأساسية',
                    'Primary Accounting Currency',
                    'بنیادی اکاؤنٹنگ کرنسی'
                  )}
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={inputClass}
                >
                  <option value="SAR">{tr('SAR - ريال سعودي', 'SAR - Saudi Riyal', 'SAR - سعودی ریال')}</option>
                  <option value="AED">{tr('AED - درهم إماراتي', 'AED - UAE Dirham', 'AED - اماراتی درہم')}</option>
                  <option value="QAR">{tr('QAR - ريال قطري', 'QAR - Qatari Riyal', 'QAR - قطری ریال')}</option>
                  <option value="KWD">{tr('KWD - دينار كويتي', 'KWD - Kuwaiti Dinar', 'KWD - کویتی دینار')}</option>
                  <option value="USD">{tr('USD - دولار أمريكي', 'USD - US Dollar', 'USD - امریکی ڈالر')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: First Branch Setup */}
          <div className="space-y-4 pt-2">
            <h3 className="text-sm font-extrabold text-[#0B1B32] dark:text-white flex items-center gap-2 pb-2 border-b border-[#E6EEFC] dark:border-[#1F3B66]">
              <MapPin className="w-4 h-4 text-[#048264] dark:text-[#08C99B]" />
              <span>
                {tr(
                  'إعداد الفرع الأول التلقائي',
                  'Initial Main Branch Setup',
                  'پہلی برانچ کی خودکار ترتیب'
                )}
              </span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                  {tr('اسم الفرع الرئيسي *', 'Main Branch Name *', 'مرکزی برانچ کا نام *')}
                </label>
                <input
                  type="text"
                  required
                  value={firstBranchName}
                  onChange={(e) => setFirstBranchName(e.target.value)}
                  placeholder={tr(
                    'مثال: الفرع الرئيسي - العليا',
                    'e.g. Main Branch - Olaya',
                    'مثلاً: مرکزی برانچ - العلیہ'
                  )}
                  className={`${inputClass} font-medium`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                  {tr(
                    'عنوان الفرع أو المدينة (اختياري)',
                    'Branch Address or City (Optional)',
                    'برانچ کا پتہ یا شہر (اختیاری)'
                  )}
                </label>
                <input
                  type="text"
                  value={firstBranchAddress}
                  onChange={(e) => setFirstBranchAddress(e.target.value)}
                  placeholder={tr(
                    'مثال: الرياض - طريق الملك فهد',
                    'e.g. Riyadh - King Fahd Rd',
                    'مثلاً: ریاض - کنگ فہد روڈ'
                  )}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Privacy & Security Guarantee */}
          <div className="p-4 rounded-2xl bg-[#1764FF]/8 dark:bg-[#1764FF]/15 border border-[#1764FF]/25 text-xs text-[#0B1B32] dark:text-blue-100 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#048264] dark:text-[#08C99B] shrink-0 mt-0.5" />
            <div className="leading-relaxed space-y-1">
              <span className="font-bold block">
                {tr(
                  'ضمان العزل والخصوصية:',
                  'Tenant Isolation & Privacy Guarantee:',
                  'ڈیٹا علیحدگی اور رازداری کی ضمانت:'
                )}
              </span>
              <span>
                {tr(
                  'سيتم إنشاء معرف مشفر فريد لمؤسستك في Cloud Firestore، محمي بقواعد أمان تمنع أي وصول من مؤسسات أخرى، وتمنحك وحدك صلاحية إضافة الموظفين واعتماد الإقفالات.',
                  'A unique tenant workspace ID will be created for your organization in Cloud Firestore, protected by security rules that block cross-tenant access and grant only you control over staff and closing approvals.',
                  'آپ کے ادارے کے لیے Cloud Firestore میں ایک منفرد محفوظ شناخت بنائی جائے گی جو سخت سیکیورٹی قوانین کے تحت محفوظ ہوگی اور ملازمین و کلوزنگز کا اختیار صرف آپ کے پاس ہوگا۔'
                )}
              </span>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl font-bold text-sm sm:text-base text-white bg-[#1764FF] hover:bg-[#1052D8] active:scale-99 transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Building2 className="w-5 h-5" />
            <span>
              {loading
                ? tr(
                    'جاري تأسيس المؤسسة وحفظ البيانات...',
                    'Creating organization & saving data...',
                    'ادارہ قائم کیا جا رہا ہے اور ڈیٹا محفوظ ہو رہا ہے...'
                  )
                : tr(
                    'تأكيد التأسيس والدخول إلى لوحة التحكم',
                    'Confirm Setup & Enter Dashboard',
                    'تصدیق کریں اور ڈیش بورڈ میں داخل ہوں'
                  )}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};
