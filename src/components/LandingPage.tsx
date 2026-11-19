import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { CalculatorSimulator } from './CalculatorSimulator';
import {
  Lock,
  Building2,
  ShieldCheck,
  Clock,
  HardDrive,
  Users,
  FileSpreadsheet,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Sparkles,
  Layers,
  Send,
  HelpCircle,
  FileText,
  DollarSign,
  TrendingUp,
  Receipt
} from 'lucide-react';

interface LandingPageProps {
  onOpenAuth: (initialTab: 'manager' | 'employee' | 'register') => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onOpenAuth }) => {
  const { t, direction, language } = useLanguage();
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  // Contact Form state
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactOrg, setContactOrg] = useState('');
  const [contactMsg, setContactMsg] = useState('');
  const [contactSubmitted, setContactSubmitted] = useState(false);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName || !contactEmail) return;
    setContactSubmitted(true);
    setTimeout(() => {
      setContactName('');
      setContactEmail('');
      setContactOrg('');
      setContactMsg('');
    }, 3000);
  };

  const faqs = [
    { q: t('faqQ1'), a: t('faqA1') },
    { q: t('faqQ2'), a: t('faqA2') },
    { q: t('faqQ3'), a: t('faqA3') },
    { q: t('faqQ4'), a: t('faqA4') },
    { q: t('faqQ5'), a: t('faqA5') },
  ];

  const features = [
    {
      icon: ShieldCheck,
      title: t('featMultiTenantTitle'),
      desc: t('featMultiTenantDesc'),
      accent: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
    },
    {
      icon: Clock,
      title: t('featShiftControlTitle'),
      desc: t('featShiftControlDesc'),
      accent: 'bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/25',
    },
    {
      icon: TrendingUp,
      title: t('featAccurateMathTitle'),
      desc: t('featAccurateMathDesc'),
      accent: 'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/25',
    },
    {
      icon: HardDrive,
      title: t('featDriveIntegrationTitle'),
      desc: t('featDriveIntegrationDesc'),
      accent: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
    },
    {
      icon: Users,
      title: t('featRoleAccessTitle'),
      desc: t('featRoleAccessDesc'),
      accent: 'bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/25',
    },
    {
      icon: FileSpreadsheet,
      title: t('featAuditAndReportsTitle'),
      desc: t('featAuditAndReportsDesc'),
      accent: 'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/25',
    },
  ];

  const steps = [
    { num: '01', title: t('step1Title'), desc: t('step1Desc'), icon: Receipt },
    { num: '02', title: t('step2Title'), desc: t('step2Desc'), icon: TrendingUp },
    { num: '03', title: t('step3Title'), desc: t('step3Desc'), icon: FileText },
    { num: '04', title: t('step4Title'), desc: t('step4Desc'), icon: ShieldCheck },
    { num: '05', title: t('step5Title'), desc: t('step5Desc'), icon: HardDrive },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-[#F4F7FB] dark:bg-[#070E17]">
      {/* Hero Section */}
      <section id="hero" className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-28 bg-white dark:bg-[#091526] border-b border-slate-200/80 dark:border-slate-800">
        {/* Subtle Calm Blue Ambient Wash */}
        <div className="absolute top-0 inset-x-0 h-80 bg-gradient-to-b from-blue-50/70 to-transparent dark:from-blue-950/25 dark:to-transparent pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Content (7 Cols) */}
            <div className="lg:col-span-7 space-y-6 text-center lg:text-start">
              {/* Top SaaS Tag */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/15 border border-blue-200/80 dark:border-blue-500/30 text-xs font-bold text-blue-800 dark:text-blue-200">
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300" />
                <span>{t('badgeCloudSaaS')}</span>
              </div>

              {/* Title */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-[#0B192C] dark:text-white tracking-tight leading-[1.15]">
                <span>{t('brandName')}</span>{' '}
                <span className="text-blue-600 dark:text-blue-400">| {t('brandSub')}</span>
                <span className="block text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-600 dark:text-slate-300 mt-3">
                  {t('tagline')}
                </span>
              </h1>

              {/* Description */}
              <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed mx-auto lg:mx-0">
                {t('heroDescription')}
              </p>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 pt-2">
                <button
                  onClick={() => onOpenAuth('register')}
                  className="px-6 py-3.5 rounded-xl font-bold text-sm sm:text-base text-white bg-blue-600 hover:bg-blue-700 shadow-sm active:scale-95 transition-all flex items-center gap-2"
                >
                  <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                  <span>{t('ctaStartNow')}</span>
                  {direction === 'rtl' ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => onOpenAuth('manager')}
                  className="px-6 py-3.5 rounded-xl font-bold text-sm sm:text-base text-[#0B192C] dark:text-white bg-white dark:bg-[#0C1829] hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs transition-all flex items-center gap-2 active:scale-95"
                >
                  <Lock className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                  <span>{t('navLogin')}</span>
                </button>

                <button
                  onClick={() => {
                    const el = document.getElementById('simulator');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-5 py-3.5 rounded-xl font-semibold text-xs sm:text-sm text-blue-700 dark:text-blue-200 bg-blue-50/80 dark:bg-blue-950/40 hover:bg-blue-100/80 dark:hover:bg-blue-900/50 border border-blue-200/80 dark:border-blue-800/70 transition-all flex items-center gap-1.5"
                >
                  <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                  <span>{t('ctaExploreDemo')}</span>
                </button>
              </div>

              {/* Trust Indicators */}
              <div className="pt-6 grid grid-cols-3 gap-4 border-t border-slate-200 dark:border-slate-800 max-w-lg mx-auto lg:mx-0">
                <div className="text-center lg:text-start">
                  <div className="text-lg sm:text-xl font-extrabold text-[#0B192C] dark:text-white font-mono-num">
                    100%
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    عزل تام للبيانات
                  </div>
                </div>
                <div className="text-center lg:text-start">
                  <div className="text-lg sm:text-xl font-extrabold text-blue-600 dark:text-blue-400 font-mono-num">
                    0.00
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    فروقات أو كسور
                  </div>
                </div>
                <div className="text-center lg:text-start">
                  <div className="text-lg sm:text-xl font-extrabold text-[#0B192C] dark:text-white font-mono-num">
                    Google Drive
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    أرشفة سحابية
                  </div>
                </div>
              </div>
            </div>

            {/* Right Card: Unified Dark Navy Shift Closing Sheet Mockup (5 Cols) */}
            <div className="lg:col-span-5 relative">
              <div className="rounded-2xl bg-[#0B192C] p-6 text-white space-y-5 shadow-xl border border-[#1E375B]">
                {/* Card Header */}
                <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#1A3152]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-blue-200/80">سجل إقفال وردية</div>
                      <div className="text-sm font-bold text-white truncate">الفرع الرئيسي • الفترة المسائية</div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 shrink-0">
                    معتمد رسمياً
                  </span>
                </div>

                {/* Date & Staff */}
                <div className="grid grid-cols-2 gap-3 text-xs bg-[#112440] p-3 rounded-xl border border-[#1E375B]">
                  <div>
                    <span className="text-slate-300/75 block">التاريخ:</span>
                    <span className="font-mono-num font-semibold text-white">2026-11-09</span>
                  </div>
                  <div>
                    <span className="text-slate-300/75 block">الموظف المسؤول:</span>
                    <span className="font-semibold text-white">أحمد المحاسب</span>
                  </div>
                </div>

                {/* Benchmark Figures Breakdown */}
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between items-center py-1.5 border-b border-[#1A3152]">
                    <span className="text-slate-300">مبيعات النقد (كاش):</span>
                    <span className="font-bold text-blue-300 font-mono-num">1,500.00 ر.س</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-[#1A3152]">
                    <span className="text-slate-300">مبيعات الشبكة (مدى/بطاقات):</span>
                    <span className="font-bold text-sky-300 font-mono-num">2,000.00 ر.س</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-[#1A3152]">
                    <span className="text-slate-300">المشتريات والمصروفات:</span>
                    <span className="font-bold text-rose-300 font-mono-num">400.00 ر.س</span>
                  </div>
                  <div className="flex justify-between items-center py-2.5 bg-blue-600/20 px-3 rounded-xl border border-blue-400/30">
                    <span className="text-white font-bold">إجمالي المبيعات:</span>
                    <span className="font-extrabold text-white text-sm font-mono-num">3,500.00 ر.س</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 px-3">
                    <span className="text-slate-300">الباقي في الصندوق:</span>
                    <span className="font-bold text-slate-100 font-mono-num">1,100.00 ر.س</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 px-3">
                    <span className="text-slate-300">صافي الفترة:</span>
                    <span className="font-bold text-emerald-300 font-mono-num">3,100.00 ر.س</span>
                  </div>
                </div>

                {/* Drive Sync Confirmation */}
                <div className="p-3 rounded-xl bg-[#112440] border border-[#1E375B] flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2 text-slate-200">
                    <HardDrive className="w-3.5 h-3.5 text-blue-300" />
                    <span>مرفقات الفواتير محفوظة في Google Drive</span>
                  </div>
                  <span className="text-emerald-300 font-bold">مزامنة كاملة</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-[#F4F7FB] dark:bg-[#070E17] transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-500/15 border border-blue-200/80 dark:border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs font-bold mb-3">
              <Layers className="w-3.5 h-3.5" />
              <span>{t('navFeatures')}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0B192C] dark:text-white tracking-tight">
              {t('featuresTitle')}
            </h2>
            <p className="mt-3 text-base sm:text-lg text-slate-600 dark:text-slate-300">
              {t('featuresSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feat, idx) => {
              const Icon = feat.icon;
              return (
                <div
                  key={idx}
                  className="bg-white dark:bg-[#0C1829] rounded-2xl p-6 sm:p-7 border border-slate-200/90 dark:border-slate-800 shadow-xs hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-200 group flex flex-col justify-between"
                >
                  <div>
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-5 ${feat.accent}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-extrabold text-[#0B192C] dark:text-white mb-2">
                      {feat.title}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {feat.desc}
                    </p>
                  </div>
                  <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 text-xs font-bold text-blue-700 dark:text-blue-300">
                    <span>ميزة قياسية مدمجة</span>
                    {direction === 'rtl' ? <ArrowLeft className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section id="how-it-works" className="py-20 bg-white dark:bg-[#0B192C]/50 border-y border-slate-200 dark:border-slate-800 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-500/15 border border-blue-200/80 dark:border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs font-bold mb-3">
              <Clock className="w-3.5 h-3.5" />
              <span>{t('navHowItWorks')}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0B192C] dark:text-white tracking-tight">
              {t('workflowTitle')}
            </h2>
            <p className="mt-3 text-base sm:text-lg text-slate-600 dark:text-slate-300">
              {t('workflowSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-5">
            {steps.map((st, idx) => {
              const Icon = st.icon;
              return (
                <div
                  key={idx}
                  className="bg-[#F4F7FB] dark:bg-[#0C1829] rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black font-mono-num text-blue-600/35 dark:text-blue-400/30">
                      {st.num}
                    </span>
                    <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <h4 className="text-sm font-extrabold text-[#0B192C] dark:text-white">
                    {st.title}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {st.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Accounting Simulator Section */}
      <CalculatorSimulator />

      {/* Benefits for Owners vs Employees */}
      <section id="benefits" className="py-20 bg-white dark:bg-[#070E17] transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-500/15 border border-blue-200/80 dark:border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs font-bold mb-3">
              <Users className="w-3.5 h-3.5" />
              <span>{t('navBenefits')}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0B192C] dark:text-white tracking-tight">
              {t('benefitsTitle')}
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Owner Benefits */}
            <div className="bg-[#F4F7FB] dark:bg-[#0C1829] rounded-2xl p-7 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-200/80 dark:border-slate-800">
                <div className="w-10 h-10 rounded-xl bg-[#0B192C] text-white flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold text-[#0B192C] dark:text-white">
                    {t('ownerBenefitsTitle')}
                  </h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    تحكم، رقابة مالية، وأمان سحابي
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                {[t('ownerBen1'), t('ownerBen2'), t('ownerBen3'), t('ownerBen4')].map((b, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                      {b}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Employee Benefits */}
            <div className="bg-[#F4F7FB] dark:bg-[#0C1829] rounded-2xl p-7 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-200/80 dark:border-slate-800">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold text-[#0B192C] dark:text-white">
                    {t('employeeBenefitsTitle')}
                  </h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    سرعة، إخلاء مسؤولية، ودقة خالية من الأخطاء
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                {[t('employeeBen1'), t('employeeBen2'), t('employeeBen3'), t('employeeBen4')].map((b, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                    <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                      {b}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 bg-[#F4F7FB] dark:bg-[#0B192C]/50 border-t border-slate-200 dark:border-slate-800 transition-colors">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-500/15 border border-blue-200/80 dark:border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs font-bold mb-3">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{t('navFaq')}</span>
            </div>
            <h2 className="text-3xl font-extrabold text-[#0B192C] dark:text-white tracking-tight">
              {t('faqTitle')}
            </h2>
            <p className="mt-2 text-base text-slate-600 dark:text-slate-300">
              {t('faqSubtitle')}
            </p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div
                  key={idx}
                  className="bg-white dark:bg-[#0C1829] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs transition-colors"
                >
                  <button
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between p-4 sm:p-5 text-start font-bold text-sm sm:text-base text-[#0B192C] dark:text-white"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                        isOpen ? 'rotate-180 text-blue-600' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-5 sm:px-5 sm:pb-5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-800/60 pt-3">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Contact Us Section */}
      <section id="contact" className="py-20 bg-white dark:bg-[#070E17] border-t border-slate-200 dark:border-slate-800 transition-colors">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-extrabold text-[#0B192C] dark:text-white tracking-tight">
              {t('contactTitle')}
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-300">
              {t('contactSubtitle')}
            </p>
          </div>

          <div className="bg-[#F4F7FB] dark:bg-[#0C1829] rounded-2xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-xs">
            {contactSubmitted ? (
              <div className="text-center py-8 space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-extrabold text-[#0B192C] dark:text-white">
                  {t('contactSuccess')}
                </h3>
              </div>
            ) : (
              <form onSubmit={handleContactSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                      {t('contactName')} *
                    </label>
                    <input
                      type="text"
                      required
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                      {t('contactEmail')} *
                    </label>
                    <input
                      type="email"
                      required
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                    {t('contactOrg')}
                  </label>
                  <input
                    type="text"
                    value={contactOrg}
                    onChange={(e) => setContactOrg(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                    {t('contactMessage')} *
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={contactMsg}
                    onChange={(e) => setContactMsg(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#070E17] border border-slate-200 dark:border-slate-700 text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 active:scale-99 transition-all flex items-center justify-center gap-2 shadow-xs"
                >
                  <Send className="w-4 h-4" />
                  <span>{t('contactSend')}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
