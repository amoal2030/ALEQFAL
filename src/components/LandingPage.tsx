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
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Send,
  FileText,
  TrendingUp,
  Receipt,
  Calculator,
} from 'lucide-react';

interface LandingPageProps {
  onOpenAuth: (initialTab: 'manager' | 'employee' | 'register') => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onOpenAuth }) => {
  const { t, direction, tr } = useLanguage();
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

  const scrollToSimulator = () => {
    const el = document.getElementById('simulator');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
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
      accent:
        'bg-[#1764FF]/10 text-[#1764FF] border-[#1764FF]/20 dark:bg-[#1764FF]/20 dark:text-[#7EB0FF] dark:border-[#1764FF]/35',
    },
    {
      icon: Clock,
      title: t('featShiftControlTitle'),
      desc: t('featShiftControlDesc'),
      accent:
        'bg-[#08C99B]/12 text-[#048264] border-[#08C99B]/30 dark:bg-[#08C99B]/20 dark:text-[#3CE0B9] dark:border-[#08C99B]/35',
    },
    {
      icon: TrendingUp,
      title: t('featAccurateMathTitle'),
      desc: t('featAccurateMathDesc'),
      accent:
        'bg-[#0B1B32] text-white border-[#1F3B66] dark:bg-[#1764FF]/25 dark:text-white dark:border-[#1764FF]/40',
    },
    {
      icon: HardDrive,
      title: t('featDriveIntegrationTitle'),
      desc: t('featDriveIntegrationDesc'),
      accent:
        'bg-[#1764FF]/10 text-[#1764FF] border-[#1764FF]/20 dark:bg-[#1764FF]/20 dark:text-[#7EB0FF] dark:border-[#1764FF]/35',
    },
    {
      icon: Users,
      title: t('featRoleAccessTitle'),
      desc: t('featRoleAccessDesc'),
      accent:
        'bg-[#08C99B]/12 text-[#048264] border-[#08C99B]/30 dark:bg-[#08C99B]/20 dark:text-[#3CE0B9] dark:border-[#08C99B]/35',
    },
    {
      icon: FileSpreadsheet,
      title: t('featAuditAndReportsTitle'),
      desc: t('featAuditAndReportsDesc'),
      accent:
        'bg-[#0B1B32] text-white border-[#1F3B66] dark:bg-[#1764FF]/25 dark:text-white dark:border-[#1764FF]/40',
    },
  ];

  const steps = [
    { num: '01', title: t('step1Title'), desc: t('step1Desc'), icon: Receipt },
    { num: '02', title: t('step2Title'), desc: t('step2Desc'), icon: TrendingUp },
    { num: '03', title: t('step3Title'), desc: t('step3Desc'), icon: FileText },
    { num: '04', title: t('step4Title'), desc: t('step4Desc'), icon: ShieldCheck },
    { num: '05', title: t('step5Title'), desc: t('step5Desc'), icon: HardDrive },
  ];

  const DirArrow = direction === 'rtl' ? ArrowLeft : ArrowRight;

  return (
    <div className="flex flex-col min-h-screen bg-[#F5F8FF] dark:bg-[#0B1B32]">
      {/* Hero Section — Reference-Inspired Clean Atmospheric Canvas + Live Workspace Preview */}
      <section
        id="hero"
        className="relative overflow-hidden pt-10 pb-16 lg:pt-16 lg:pb-24 bg-gradient-to-b from-[#EAF1FF] via-[#F5F8FF] to-[#F5F8FF] dark:from-[#102544] dark:via-[#0D1E38] dark:to-[#0B1B32] border-b border-[#DDE6F7] dark:border-[#1E3A63]"
      >
        {/* Subtle Architectural Wave Backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,_rgba(23,100,255,0.12),_transparent_68%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(23,100,255,0.22),_transparent_68%)]"
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative space-y-10">
          {/* Executive Hero Header Banner (Reference-Inspired Layout) */}
          <div className="rounded-3xl bg-white/90 dark:bg-[#122543]/95 border border-[#DCE6F8] dark:border-[#1F3B66] shadow-sm overflow-hidden">
            <div className="p-6 sm:p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
              {/* Text & Primary Actions (7 Cols) */}
              <div className="lg:col-span-7 space-y-5 text-center lg:text-start">
                <p className="text-xs sm:text-sm font-bold text-[#1764FF] dark:text-[#6EA3FF] tracking-wide">
                  {t('heroMotto')} · {t('badgeCloudSaaS')}
                </p>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[#0B1B32] dark:text-white tracking-tight leading-[1.2] text-balance">
                  <span>{t('heroWelcomeTitle')}</span>
                  <span className="block text-xl sm:text-2xl lg:text-3xl font-bold text-[#4A6082] dark:text-slate-300 mt-3">
                    {t('tagline')}
                  </span>
                </h1>

                <p className="text-sm sm:text-base text-[#4A6082] dark:text-slate-300 max-w-2xl leading-relaxed mx-auto lg:mx-0">
                  {t('heroDescription')}
                </p>

                {/* Primary & Secondary Action Bar */}
                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenAuth('register')}
                    className="px-6 py-3.5 rounded-xl font-bold text-sm sm:text-base text-white bg-[#1764FF] hover:bg-[#1052D8] shadow-xs active:scale-98 transition-all flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-white shrink-0" />
                    <span>{t('ctaStartNow')}</span>
                    <DirArrow className="w-4 h-4 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenAuth('manager')}
                    className="px-5 py-3.5 rounded-xl font-bold text-sm sm:text-base text-[#0B1B32] dark:text-white bg-[#F5F8FF] dark:bg-[#0E203A] hover:bg-[#EAF1FF] dark:hover:bg-[#193259] border border-[#D8E3F6] dark:border-[#23416E] transition-all flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <Lock className="w-4 h-4 text-[#1764FF] dark:text-[#6EA3FF] shrink-0" />
                    <span>{t('navLogin')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={scrollToSimulator}
                    className="px-5 py-3.5 rounded-xl font-semibold text-xs sm:text-sm text-[#048264] dark:text-[#3CE0B9] bg-[#08C99B]/10 hover:bg-[#08C99B]/18 border border-[#08C99B]/30 transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Calculator className="w-4 h-4 shrink-0" />
                    <span>{t('ctaExploreDemo')}</span>
                  </button>
                </div>

                {/* Clean Unboxed Trust Metrics */}
                <div className="pt-5 grid grid-cols-3 gap-4 border-t border-[#E6EEFB] dark:border-[#1E3A63] max-w-xl mx-auto lg:mx-0">
                  <div className="text-center lg:text-start">
                    <div className="text-lg sm:text-xl font-extrabold text-[#0B1B32] dark:text-white font-mono-num">
                      100%
                    </div>
                    <div className="text-xs text-[#526785] dark:text-slate-400 font-medium">
                      {t('trustIsolation')}
                    </div>
                  </div>
                  <div className="text-center lg:text-start">
                    <div className="text-lg sm:text-xl font-extrabold text-[#1764FF] dark:text-[#6EA3FF] font-mono-num">
                      0.00
                    </div>
                    <div className="text-xs text-[#526785] dark:text-slate-400 font-medium">
                      {t('trustZeroDiff')}
                    </div>
                  </div>
                  <div className="text-center lg:text-start">
                    <div className="text-lg sm:text-xl font-extrabold text-[#048264] dark:text-[#3CE0B9] font-mono-num">
                      Drive
                    </div>
                    <div className="text-xs text-[#526785] dark:text-slate-400 font-medium">
                      {t('trustCloudArchive')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Official Shift Closing Verification Card (5 Cols) */}
              <div className="lg:col-span-5">
                <div className="rounded-2xl bg-[#0B1B32] dark:bg-[#091529] p-5 sm:p-6 text-white space-y-4 shadow-lg border border-[#1E3A63]">
                  <div className="flex items-center justify-between gap-3 pb-3.5 border-b border-[#1A3357]">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-[#1764FF] text-white flex items-center justify-center shrink-0">
                        <Receipt className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-[#8CB8FF]">
                          {t('previewSheetSubtitle')}
                        </div>
                        <div className="text-sm font-bold text-white truncate">
                          {t('previewSheetTitle')}
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#08C99B] shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t('previewApprovedBadge')}</span>
                    </span>
                  </div>

                  {/* Date & Staff */}
                  <div className="grid grid-cols-2 gap-3 text-xs bg-[#122543] p-3 rounded-xl border border-[#1F3B66]">
                    <div>
                      <span className="text-slate-300/80 block">{t('previewDateLabel')}</span>
                      <span className="font-mono-num font-semibold text-white">2026-11-19</span>
                    </div>
                    <div>
                      <span className="text-slate-300/80 block">{t('previewStaffLabel')}</span>
                      <span className="font-semibold text-white">{t('previewStaffSample')}</span>
                    </div>
                  </div>

                  {/* Benchmark Accounting Figures */}
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between items-center py-1.5 border-b border-[#1A3357]">
                      <span className="text-slate-300">{t('simCash')}</span>
                      <span className="font-bold text-[#7EB0FF] font-mono-num">
                        1,500.00 {tr('ر.س', 'SAR', 'ریال')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1.5 border-b border-[#1A3357]">
                      <span className="text-slate-300">{t('simCard')}</span>
                      <span className="font-bold text-sky-300 font-mono-num">
                        2,000.00 {tr('ر.س', 'SAR', 'ریال')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1.5 border-b border-[#1A3357]">
                      <span className="text-slate-300">{t('simExpenses')}</span>
                      <span className="font-bold text-rose-300 font-mono-num">
                        400.00 {tr('ر.س', 'SAR', 'ریال')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2.5 bg-[#1764FF]/20 px-3 rounded-xl border border-[#1764FF]/40">
                      <span className="text-white font-bold">{t('simTotalSales')}</span>
                      <span className="font-extrabold text-white text-sm font-mono-num">
                        3,500.00 {tr('ر.س', 'SAR', 'ریال')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 px-2">
                      <span className="text-slate-300">{t('simRemainingInBox')}</span>
                      <span className="font-bold text-white font-mono-num">
                        1,100.00 {tr('ر.س', 'SAR', 'ریال')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 px-2">
                      <span className="text-slate-300">{t('simNetPeriod')}</span>
                      <span className="font-bold text-[#08C99B] font-mono-num">
                        3,100.00 {tr('ر.س', 'SAR', 'ریال')}
                      </span>
                    </div>
                  </div>

                  {/* Drive Sync Footer */}
                  <div className="p-3 rounded-xl bg-[#122543] border border-[#1F3B66] flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-2 text-slate-200 min-w-0">
                      <HardDrive className="w-3.5 h-3.5 text-[#6EA3FF] shrink-0" />
                      <span className="truncate">{t('previewDriveSynced')}</span>
                    </div>
                    <span className="text-[#08C99B] font-bold shrink-0">
                      {t('previewDriveStatus')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-[#F5F8FF] dark:bg-[#0B1B32] transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14 space-y-2">
            <p className="text-xs font-bold text-[#1764FF] dark:text-[#7EB0FF] tracking-wide">
              {t('navFeatures')}
            </p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-[#0B1B32] dark:text-white tracking-tight text-balance">
              {t('featuresTitle')}
            </h2>
            <p className="text-sm sm:text-base text-[#526785] dark:text-slate-300">
              {t('featuresSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feat, idx) => {
              const Icon = feat.icon;
              return (
                <div
                  key={idx}
                  className="bg-white dark:bg-[#122543] rounded-2xl p-6 sm:p-7 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs hover:border-[#1764FF]/50 transition-all duration-200 flex flex-col justify-between"
                >
                  <div>
                    <div
                      className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-5 ${feat.accent}`}
                    >
                      <Icon className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-extrabold text-[#0B1B32] dark:text-white mb-2">
                      {feat.title}
                    </h3>
                    <p className="text-sm text-[#526785] dark:text-slate-300 leading-relaxed">
                      {feat.desc}
                    </p>
                  </div>
                  <div className="mt-6 pt-4 border-t border-[#EDF2FC] dark:border-[#1E3A63] flex items-center gap-1.5 text-xs font-bold text-[#1764FF] dark:text-[#7EB0FF]">
                    <span>{t('featureStandardLabel')}</span>
                    <DirArrow className="w-3.5 h-3.5" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section
        id="how-it-works"
        className="py-20 bg-white dark:bg-[#0E203A] border-y border-[#E2EAFA] dark:border-[#1E3A63] transition-colors"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14 space-y-2">
            <p className="text-xs font-bold text-[#1764FF] dark:text-[#7EB0FF] tracking-wide">
              {t('navHowItWorks')}
            </p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-[#0B1B32] dark:text-white tracking-tight text-balance">
              {t('workflowTitle')}
            </h2>
            <p className="text-sm sm:text-base text-[#526785] dark:text-slate-300">
              {t('workflowSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-5">
            {steps.map((st, idx) => {
              const Icon = st.icon;
              return (
                <div
                  key={idx}
                  className="bg-[#F5F8FF] dark:bg-[#122543] rounded-2xl p-5 border border-[#E2EAFA] dark:border-[#1F3B66] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black font-mono-num text-[#1764FF]/35 dark:text-[#7EB0FF]/35">
                      {st.num}
                    </span>
                    <div className="w-9 h-9 rounded-xl bg-[#1764FF] text-white flex items-center justify-center shadow-xs">
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <h3 className="text-sm font-extrabold text-[#0B1B32] dark:text-white">
                    {st.title}
                  </h3>
                  <p className="text-xs text-[#526785] dark:text-slate-300 leading-relaxed">
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
      <section id="benefits" className="py-20 bg-white dark:bg-[#0B1B32] transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14 space-y-2">
            <p className="text-xs font-bold text-[#1764FF] dark:text-[#7EB0FF] tracking-wide">
              {t('navBenefits')}
            </p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-[#0B1B32] dark:text-white tracking-tight text-balance">
              {t('benefitsTitle')}
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Owner Benefits */}
            <div className="bg-[#F5F8FF] dark:bg-[#122543] rounded-2xl p-7 sm:p-8 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b border-[#DCE6F8] dark:border-[#1E3A63]">
                <div className="w-11 h-11 rounded-xl bg-[#0B1B32] dark:bg-[#1764FF] text-white flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-extrabold text-[#0B1B32] dark:text-white">
                    {t('ownerBenefitsTitle')}
                  </h3>
                  <span className="text-xs text-[#526785] dark:text-slate-300">
                    {t('ownerBenefitsSub')}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                {[t('ownerBen1'), t('ownerBen2'), t('ownerBen3'), t('ownerBen4')].map((b, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-[#1764FF] dark:text-[#7EB0FF] shrink-0 mt-0.5" />
                    <span className="text-sm text-[#243958] dark:text-slate-200 leading-relaxed font-medium">
                      {b}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Employee Benefits */}
            <div className="bg-[#F5F8FF] dark:bg-[#122543] rounded-2xl p-7 sm:p-8 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b border-[#DCE6F8] dark:border-[#1E3A63]">
                <div className="w-11 h-11 rounded-xl bg-[#08C99B] text-[#0B1B32] flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-extrabold text-[#0B1B32] dark:text-white">
                    {t('employeeBenefitsTitle')}
                  </h3>
                  <span className="text-xs text-[#526785] dark:text-slate-300">
                    {t('employeeBenefitsSub')}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                {[t('employeeBen1'), t('employeeBen2'), t('employeeBen3'), t('employeeBen4')].map(
                  (b, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-[#08C99B] shrink-0 mt-0.5" />
                      <span className="text-sm text-[#243958] dark:text-slate-200 leading-relaxed font-medium">
                        {b}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section
        id="faq"
        className="py-20 bg-[#F5F8FF] dark:bg-[#0E203A] border-t border-[#E2EAFA] dark:border-[#1E3A63] transition-colors"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 space-y-2">
            <p className="text-xs font-bold text-[#1764FF] dark:text-[#7EB0FF] tracking-wide">
              {t('navFaq')}
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0B1B32] dark:text-white tracking-tight">
              {t('faqTitle')}
            </h2>
            <p className="text-sm sm:text-base text-[#526785] dark:text-slate-300">
              {t('faqSubtitle')}
            </p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div
                  key={idx}
                  className="bg-white dark:bg-[#122543] rounded-2xl border border-[#E2EAFA] dark:border-[#1F3B66] overflow-hidden shadow-xs transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 p-4 sm:p-5 text-start font-bold text-sm sm:text-base text-[#0B1B32] dark:text-white"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#647B9C] dark:text-slate-400 shrink-0 transition-transform ${
                        isOpen ? 'rotate-180 text-[#1764FF] dark:text-[#7EB0FF]' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-5 sm:px-5 sm:pb-5 text-xs sm:text-sm text-[#526785] dark:text-slate-300 leading-relaxed border-t border-[#EDF2FC] dark:border-[#1E3A63] pt-3">
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
      <section
        id="contact"
        className="py-20 bg-white dark:bg-[#0B1B32] border-t border-[#E2EAFA] dark:border-[#1E3A63] transition-colors"
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0B1B32] dark:text-white tracking-tight">
              {t('contactTitle')}
            </h2>
            <p className="text-sm sm:text-base text-[#526785] dark:text-slate-300">
              {t('contactSubtitle')}
            </p>
          </div>

          <div className="bg-[#F5F8FF] dark:bg-[#122543] rounded-2xl p-6 sm:p-8 border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs">
            {contactSubmitted ? (
              <div className="text-center py-8 space-y-3">
                <div className="w-12 h-12 rounded-full bg-[#08C99B]/15 text-[#048264] dark:text-[#3CE0B9] mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-extrabold text-[#0B1B32] dark:text-white">
                  {t('contactSuccess')}
                </h3>
              </div>
            ) : (
              <form onSubmit={handleContactSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                      {t('contactName')} *
                    </label>
                    <input
                      type="text"
                      required
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#0E203A] border border-[#D8E3F6] dark:border-[#23416E] text-sm text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                      {t('contactEmail')} *
                    </label>
                    <input
                      type="email"
                      required
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#0E203A] border border-[#D8E3F6] dark:border-[#23416E] text-sm text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                    {t('contactOrg')}
                  </label>
                  <input
                    type="text"
                    value={contactOrg}
                    onChange={(e) => setContactOrg(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#0E203A] border border-[#D8E3F6] dark:border-[#23416E] text-sm text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                    {t('contactMessage')} *
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={contactMsg}
                    onChange={(e) => setContactMsg(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#0E203A] border border-[#D8E3F6] dark:border-[#23416E] text-sm text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl font-bold text-sm text-white bg-[#1764FF] hover:bg-[#1052D8] active:scale-99 transition-all flex items-center justify-center gap-2 shadow-xs"
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
