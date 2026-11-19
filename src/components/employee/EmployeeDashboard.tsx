import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { ShiftClosing, SupportedLanguage } from '../../types';
import { resolveEffectivePermissions } from '../../utils/permissions';
import {
  calculateShiftTotals,
  formatCurrency,
} from '../../utils/accounting';
import {
  AlertBanner,
  BadgeVariant,
  BTN_PRIMARY,
  BTN_SECONDARY,
  INPUT_CLASS,
  ModalShell,
  SELECT_CLASS,
  StatusBadge,
  SurfaceCard,
  TABLE_HEAD,
  TABLE_ROW,
  TABLE_WRAPPER,
} from '../common/UiPrimitives';
import {
  Coins,
  CreditCard,
  ShoppingBag,
  Building2,
  Lock,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sparkles,
} from 'lucide-react';

const STATUS_BADGE_MAP: Record<
  string,
  { labels: Record<SupportedLanguage, string>; variant: BadgeVariant }
> = {
  draft: {
    labels: { ar: 'مسودة', en: 'Draft', ur: 'مسودہ' },
    variant: 'neutral',
  },
  pending_review: {
    labels: { ar: 'مرسل للمراجعة', en: 'Pending Review', ur: 'جائزے کے لیے' },
    variant: 'warning',
  },
  approved: {
    labels: { ar: 'معتمد', en: 'Approved', ur: 'منظور شدہ' },
    variant: 'success',
  },
  rejected: {
    labels: { ar: 'معاد للتعديل', en: 'Returned', ur: 'ترمیم کے لیے واپس' },
    variant: 'danger',
  },
};

export const EmployeeDashboard: React.FC = () => {
  const {
    currentUser,
    userProfile,
    currentOrg,
    branches,
    currentBranch,
    closings,
    driveReadiness,
    submitShiftClosing,
  } = useAuth();
  const { language, tr } = useLanguage();
  const effectivePerms = resolveEffectivePermissions(userProfile);
  const canSelectAnyBranch = effectivePerms.hasOrgWideBranchScope;
  const selectableBranches = branches.filter(
    (b) => b.isActive !== false && b.lifecycleStatus !== 'purged_from_db'
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    () => currentBranch?.id || selectableBranches[0]?.id || ''
  );

  useEffect(() => {
    if (!canSelectAnyBranch) {
      if (currentBranch?.id) setSelectedBranchId(currentBranch.id);
      return;
    }
    if (
      selectableBranches.length > 0 &&
      !selectableBranches.some((b) => b.id === selectedBranchId)
    ) {
      setSelectedBranchId(currentBranch?.id || selectableBranches[0].id);
    }
  }, [canSelectAnyBranch, currentBranch?.id, selectableBranches, selectedBranchId]);

  const effectiveBranch = canSelectAnyBranch
    ? selectableBranches.find((b) => b.id === selectedBranchId) || currentBranch || selectableBranches[0] || null
    : currentBranch;

  const myClosings = closings.filter((c) => c.employeeId === currentUser?.uid);

  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [period, setPeriod] = useState<'morning' | 'evening'>('morning');
  const [cashSales, setCashSales] = useState('');
  const [cardSales, setCardSales] = useState('');
  const [expenses, setExpenses] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [viewingClosing, setViewingClosing] = useState<ShiftClosing | null>(null);

  const calc = calculateShiftTotals(cashSales, cardSales, expenses);
  const currency = currentOrg?.currency || 'SAR';

  const getStatus = (status: string) => {
    const entry = STATUS_BADGE_MAP[status] || STATUS_BADGE_MAP.draft;
    return { label: entry.labels[language] || entry.labels.ar, variant: entry.variant };
  };

  const periodLabel = (p: string) =>
    p === 'morning' ? tr('صباحية', 'Morning', 'صبح') : tr('مسائية', 'Evening', 'شام');

  const handleSubmit = async (targetStatus: 'draft' | 'pending_review') => {
    if (!effectivePerms.canCreateClosing) {
      setErrorMsg(
        tr(
          'صلاحية إنشاء إقفالات الورديات غير مفعلة لحسابك من قبل مدير المؤسسة.',
          'Shift closing creation is not enabled for your account by the organization manager.',
          'آپ کے اکاؤنٹ کے لیے شفٹ کلوزنگ بنانے کا اختیار منیجر کی جانب سے فعال نہیں ہے۔'
        )
      );
      return;
    }

    if (!driveReadiness.isReady) {
      setErrorMsg(driveReadiness.message);
      return;
    }

    if (!effectiveBranch) {
      setErrorMsg(
        tr(
          'لم يتم تعيين فرع لحسابك. يرجى التواصل مع المدير العام.',
          'No branch is assigned to your account. Please contact your manager.',
          'آپ کے اکاؤنٹ سے کوئی برانچ منسلک نہیں ہے۔ براہ کرم منیجر سے رابطہ کریں۔'
        )
      );
      return;
    }

    if (!calc.isValid) {
      setErrorMsg(
        tr(
          'يرجى التأكد من إدخال مبالغ مالية صحيحة موجبة.',
          'Please enter valid non-negative financial amounts.',
          'براہ کرم درست مثبت مالی رقوم درج کریں۔'
        )
      );
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await submitShiftClosing({
        branchId: effectiveBranch.id,
        branchName: effectiveBranch.name,
        date,
        period,
        cashSales: calc.cashSales,
        cardSales: calc.cardSales,
        expenses: calc.expenses,
        notes,
        status: targetStatus,
      });

      setSuccessMsg(
        targetStatus === 'pending_review'
          ? tr(
              `تم إرسال إقفال الوردية ${
                period === 'morning' ? 'الصباحية' : 'المسائية'
              } بنجاح للمدير للمراجعة والاعتماد.`,
              `${period === 'morning' ? 'Morning' : 'Evening'} shift closing submitted to the manager for review.`,
              `${period === 'morning' ? 'صبح' : 'شام'} کی شفٹ کلوزنگ منظوری کے لیے منیجر کو کامیابی سے بھیج دی گئی ہے۔`
            )
          : tr(
              'تم حفظ مسودة الإقفال بنجاح. يمكنك استكمالها لاحقاً.',
              'Closing draft saved successfully. You can finish it later.',
              'کلوزنگ کا مسودہ کامیابی سے محفوظ ہو گیا۔ آپ اسے بعد میں مکمل کر سکتے ہیں۔'
            )
      );

      setCashSales('');
      setCardSales('');
      setExpenses('');
      setNotes('');
    } catch (err: any) {
      setErrorMsg(err?.message || tr('فشل حفظ الإقفال.', 'Failed to save shift closing.', 'کلوزنگ محفوظ کرنے میں ناکامی۔'));
    } finally {
      setLoading(false);
    }
  };

  const rejectedCount = myClosings.filter((c) => c.status === 'rejected').length;

  return (
    <div className="space-y-6">
      {/* Employee Top Welcome & Branch Card */}
      <SurfaceCard>
        <div className="flex flex-wrap items-center justify-between gap-4 sm:gap-6">
          <div className="space-y-2">
            <StatusBadge variant="info" icon={<Clock className="w-3.5 h-3.5" />}>
              {tr('لوحة موظف الصندوق والورديات', 'Cashier & Shift Workspace', 'کیشیئر اور شفٹ ورک اسپیس')}
            </StatusBadge>
            <h2 className="text-lg sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white break-words">
              {tr('مرحباً،', 'Welcome,', 'خوش آمدید،')} {userProfile?.displayName || currentUser?.email}
            </h2>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5 font-bold text-[#0B1B32] dark:text-[#6CA2FF]">
                <Building2 className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF] shrink-0" />
                {tr('المؤسسة:', 'Organization:', 'ادارہ:')} {currentOrg?.name}
              </span>
              <span className="hidden sm:inline">•</span>
              {canSelectAnyBranch ? (
                <span className="flex items-center gap-1.5 font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                  {tr(
                    `الفرع: جميع فروع المؤسسة (${selectableBranches.length})`,
                    `Branch: All Organization Branches (${selectableBranches.length})`,
                    `برانچ: ادارے کی تمام برانچز (${selectableBranches.length})`
                  )}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  {tr('الفرع:', 'Branch:', 'برانچ:')}{' '}
                  {effectiveBranch?.name || tr('الفرع الرئيسي', 'Main Branch', 'مرکزی برانچ')}
                </span>
              )}
            </div>
          </div>

          {rejectedCount > 0 && (
            <AlertBanner
              variant="error"
              icon={<AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
              title={tr('تنبيه من الإدارة', 'Management Notice', 'انتظامیہ کی اطلاع')}
              className="w-full sm:w-auto"
            >
              {tr(
                `لديك ${rejectedCount} إقفال معاد للتعديل بحاجة لمراجعتك.`,
                `You have ${rejectedCount} returned shift closing(s) awaiting correction.`,
                `آپ کی ${rejectedCount} کلوزنگز ترمیم کے لیے واپس کی گئی ہیں۔`
              )}
            </AlertBanner>
          )}
        </div>
      </SurfaceCard>

      {/* Grid: Create Shift Closing Form (Left 7 Cols) + Quick Stats (Right 5 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7">
          <SurfaceCard
            title={tr('تسجيل إقفال وردية جديدة', 'Record New Shift Closing', 'نئی شفٹ کلوزنگ درج کریں')}
            subtitle={tr(
              'الحساب الفوري التلقائي بدقة الهللات',
              'Instant automatic calculation with exact sub-unit accuracy',
              'اعشاریہ درستگی کے ساتھ فوری خودکار حساب'
            )}
            headerAction={
              <button
                type="button"
                disabled={!driveReadiness.isReady}
                onClick={() => {
                  setCashSales('1500');
                  setCardSales('2000');
                  setExpenses('400');
                }}
                className="text-[11px] font-bold text-[#1764FF] dark:text-[#6CA2FF] hover:underline flex items-center gap-1 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{tr('تحميل المثال القياسي', 'Load Sample', 'مثال لوڈ کریں')}</span>
              </button>
            }
          >
            <div className="space-y-5">
              {!driveReadiness.isReady && (
                <AlertBanner
                  variant="error"
                  icon={<Lock className="w-4 h-4 text-rose-600 dark:text-rose-400" />}
                  title={driveReadiness.message}
                >
                  {tr(
                    'لا يمكن إرسال ورديات أو عمليات جديدة قبل أن يقوم مدير المؤسسة بربط حساب Google Drive الخاص بالمؤسسة والتحقق من جاهزيته للكتابة والقراءة. الموظف لا يقوم بربط Drive بنفسه.',
                    'New shift closings cannot be submitted until the Organization Manager links and verifies Google Drive. Staff members do not connect Drive themselves.',
                    'ادارے کے منیجر کی جانب سے Google Drive منسلک اور تصدیق ہونے سے پہلے نئی کلوزنگز جمع نہیں کی جا سکتیں۔'
                  )}
                </AlertBanner>
              )}

              {errorMsg && (
                <AlertBanner
                  variant="error"
                  icon={<AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />}
                >
                  {errorMsg}
                </AlertBanner>
              )}

              {successMsg && (
                <AlertBanner
                  variant="success"
                  icon={<CheckCircle2 className="w-4 h-4 text-[#048264] dark:text-[#08C99B]" />}
                >
                  {successMsg}
                </AlertBanner>
              )}

              {!effectivePerms.canCreateClosing ? (
                <div className="p-5 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-slate-600 dark:text-slate-300 space-y-2">
                  <div className="font-bold text-sm text-[#0B1B32] dark:text-white flex items-center gap-2">
                    <Lock className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                    <span>
                      {tr(
                        'صلاحية إنشاء إقفالات الورديات غير مفعلة لهذا الحساب',
                        'Shift Closing Creation Is Disabled for This Account',
                        'اس اکاؤنٹ کے لیے شفٹ کلوزنگ بنانے کا اختیار غیر فعال ہے'
                      )}
                    </span>
                  </div>
                  <p className="leading-relaxed">
                    {tr(
                      'بصفتك مسؤولاً على مستوى المؤسسة، تبقى الصلاحيات الاختيارية معطلة افتراضياً حتى يقوم مدير المؤسسة بتفعيلها لك من شاشة إدارة الموظفين.',
                      'As an organization-wide supervisor, optional permissions remain disabled by default until enabled by the manager in Team Management.',
                      'بطور سپروائزر اختیاری سہولیات اس وقت تک بند رہتی ہیں جب تک منیجر انہیں فعال نہ کرے۔'
                    )}
                  </p>
                </div>
              ) : (
                <fieldset disabled={!driveReadiness.isReady || loading} className="space-y-4 disabled:opacity-60">
                  {canSelectAnyBranch && (
                    <div>
                      <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                        {tr('الفرع المستهدف للإقفال *', 'Target Branch *', 'مطلوبہ برانچ *')}
                      </label>
                      <select
                        value={effectiveBranch?.id || ''}
                        onChange={(e) => setSelectedBranchId(e.target.value)}
                        className={SELECT_CLASS}
                      >
                        {selectableBranches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Date & Period */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                        {tr('تاريخ الوردية *', 'Shift Date *', 'شفٹ کی تاریخ *')}
                      </label>
                      <input
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className={`${INPUT_CLASS} font-mono-num`}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                        {tr('فترة الوردية *', 'Shift Period *', 'شفٹ کا وقت *')}
                      </label>
                      <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value as any)}
                        className={SELECT_CLASS}
                      >
                        <option value="morning">{tr('الفترة الصباحية', 'Morning Shift', 'صبح کی شفٹ')}</option>
                        <option value="evening">{tr('الفترة المسائية', 'Evening Shift', 'شام کی شفٹ')}</option>
                      </select>
                    </div>
                  </div>

                  {/* Money Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5 flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                        <span>{tr('النقد (كاش) *', 'Cash Sales *', 'نقد فروخت *')}</span>
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={cashSales}
                          onChange={(e) => setCashSales(e.target.value)}
                          placeholder="0.00"
                          className={`${INPUT_CLASS} font-mono-num font-bold pe-12`}
                        />
                        <span className="absolute end-3 top-3 text-[11px] font-bold text-slate-400">
                          {currency}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5 flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-[#048264] dark:text-[#08C99B]" />
                        <span>{tr('الشبكة (مدى) *', 'Card / POS *', 'کارڈ فروخت *')}</span>
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={cardSales}
                          onChange={(e) => setCardSales(e.target.value)}
                          placeholder="0.00"
                          className={`${INPUT_CLASS} font-mono-num font-bold pe-12`}
                        />
                        <span className="absolute end-3 top-3 text-[11px] font-bold text-slate-400">
                          {currency}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5 flex items-center gap-1.5">
                        <ShoppingBag className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                        <span>{tr('المشتريات *', 'Expenses *', 'اخراجات *')}</span>
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={expenses}
                          onChange={(e) => setExpenses(e.target.value)}
                          placeholder="0.00"
                          className={`${INPUT_CLASS} font-mono-num font-bold pe-12`}
                        />
                        <span className="absolute end-3 top-3 text-[11px] font-bold text-slate-400">
                          {currency}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Instant Financial Equations Display Card */}
                  <div className="p-4 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-2.5 text-xs">
                    <div className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                      <span className="font-semibold">
                        {tr('إجمالي المبيعات = النقد + الشبكة:', 'Total Sales = Cash + Card:', 'کل فروخت = نقد + کارڈ:')}
                      </span>
                      <span className="font-mono-num font-extrabold text-[#0B1B32] dark:text-white text-sm">
                        {formatCurrency(calc.totalSales, currency, language)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                      <span className="font-semibold">
                        {tr('الباقي في الصندوق = النقد - المشتريات:', 'Cash in Drawer = Cash - Expenses:', 'باکس میں باقی نقد = نقد - اخراجات:')}
                      </span>
                      <span className="font-mono-num font-extrabold text-[#1764FF] dark:text-[#6CA2FF] text-sm">
                        {formatCurrency(calc.remainingInBox, currency, language)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-2.5 border-t border-[#DCE6FA] dark:border-[#1F3B66]">
                      <span className="font-extrabold text-[#0B1B32] dark:text-white">
                        {tr('صافي الفترة = إجمالي المبيعات - المشتريات:', 'Net Period = Total Sales - Expenses:', 'خالص مدت = کل فروخت - اخراجات:')}
                      </span>
                      <span className="font-mono-num font-extrabold text-[#048264] dark:text-[#08C99B] text-base">
                        {formatCurrency(calc.netPeriod, currency, language)}
                      </span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-bold text-[#0B1B32] dark:text-slate-200 mb-1.5">
                      {tr(
                        'ملاحظات الصندوق أو أسباب المصروفات (اختياري)',
                        'Cash Drawer Notes or Expense Details (Optional)',
                        'کیش باکس نوٹس یا اخراجات کی تفصیل (اختیاری)'
                      )}
                    </label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={tr(
                        'أدخل أي ملاحظات حول فواتير المشتريات أو عهدة الصندوق...',
                        'Add notes regarding expense receipts or cash drawer custody...',
                        'اخراجات کی رسیدوں یا کیش باکس سے متعلق کوئی نوٹ درج کریں...'
                      )}
                      className={`${INPUT_CLASS} text-xs`}
                    />
                  </div>

                  {/* Submit & Save Draft Buttons */}
                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleSubmit('pending_review')}
                      disabled={loading || !driveReadiness.isReady}
                      className={`${BTN_PRIMARY} flex-1 py-3`}
                    >
                      {loading
                        ? tr('جاري الحفظ...', 'Saving...', 'محفوظ ہو رہا ہے...')
                        : tr('إرسال الإقفال للمدير للمراجعة', 'Submit Closing for Manager Review', 'منظوری کے لیے منیجر کو بھیجیں')}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSubmit('draft')}
                      disabled={loading || !driveReadiness.isReady}
                      className={`${BTN_SECONDARY} py-3`}
                    >
                      {tr('حفظ كمسودة', 'Save as Draft', 'مسودہ محفوظ کریں')}
                    </button>
                  </div>
                </fieldset>
              )}
            </div>
          </SurfaceCard>
        </div>

        {/* Employee Summary & Info: 5 Cols */}
        <div className="lg:col-span-5 space-y-5">
          <SurfaceCard title={tr('إحصائيات إقفالاتي السابقة', 'My Closings Summary', 'میری کلوزنگز کا خلاصہ')}>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold block mb-1">
                  {tr('إجمالي إقفالاتي', 'Total Closings', 'میری کل کلوزنگز')}
                </span>
                <span className="text-xl font-extrabold font-mono-num text-[#0B1B32] dark:text-white">
                  {myClosings.length}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#08C99B]/10 dark:bg-[#08C99B]/15 border border-[#08C99B]/30">
                <span className="text-[11px] text-[#048264] dark:text-[#08C99B] font-bold block mb-1">
                  {tr('المعتمدة رسمياً', 'Approved', 'منظور شدہ')}
                </span>
                <span className="text-xl font-extrabold font-mono-num text-[#048264] dark:text-[#08C99B]">
                  {myClosings.filter((c) => c.status === 'approved').length}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#1764FF]/8 dark:bg-[#1764FF]/15 border border-[#1764FF]/25">
                <span className="text-[11px] text-[#1764FF] dark:text-[#6CA2FF] font-bold block mb-1">
                  {tr('قيد المراجعة', 'Pending Review', 'زیر جائزہ')}
                </span>
                <span className="text-xl font-extrabold font-mono-num text-[#1764FF] dark:text-[#6CA2FF]">
                  {myClosings.filter((c) => c.status === 'pending_review').length}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25">
                <span className="text-[11px] text-rose-700 dark:text-rose-300 font-bold block mb-1">
                  {tr('معادة للتعديل', 'Returned', 'ترمیم کے لیے واپس')}
                </span>
                <span className="text-xl font-extrabold font-mono-num text-rose-600 dark:text-rose-400">
                  {rejectedCount}
                </span>
              </div>
            </div>
          </SurfaceCard>

          <AlertBanner
            variant="info"
            icon={<CheckCircle2 className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />}
            title={tr('توجيهات إقفال الصندوق', 'Shift Closing Checklist', 'کیش باکس کلوزنگ ہدایات')}
          >
            <ul className="space-y-1 list-disc list-inside leading-relaxed text-[11px] mt-1">
              <li>
                {tr(
                  'تأكد من عد النقد الفعلي الموجود بالصندوق قبل إدخال الأرقام.',
                  'Count physical cash in the drawer before entering figures.',
                  'اعداد درج کرنے سے پہلے باکس میں موجود اصل نقدی گن لیں۔'
                )}
              </li>
              <li>
                {tr(
                  'اطبع إجمالي تقرير الشبكة (مدى) من جهاز نقاط البيع.',
                  'Print the POS/card settlement summary from your terminal.',
                  'POS مشین سے کارڈ سیٹلمنٹ کا کل خلاصہ پرنٹ کریں۔'
                )}
              </li>
              <li>
                {tr(
                  'اجمع فواتير المصروفات المدفوعة نقداً خلال الوردية.',
                  'Collect all cash expense receipts paid during the shift.',
                  'شفٹ کے دوران نقد ادا کردہ اخراجات کی تمام رسیدیں جمع کریں۔'
                )}
              </li>
              <li>
                {tr(
                  'بمجرد اعتماد المدير للإقفال يتم إخلاء مسؤوليتك وقفل السجل رسمياً.',
                  'Once approved by the manager, the shift record is officially locked.',
                  'منیجر کی منظوری کے بعد آپ کی ذمہ داری مکمل اور ریکارڈ سرکاری طور پر لاک ہو جاتا ہے۔'
                )}
              </li>
            </ul>
          </AlertBanner>
        </div>
      </div>

      {/* Employee's Own Shift History */}
      <SurfaceCard
        title={tr(
          `سجل إقفالاتي السابقة (${myClosings.length})`,
          `My Shift Closing History (${myClosings.length})`,
          `میری پچھلی کلوزنگز کا ریکارڈ (${myClosings.length})`
        )}
        headerAction={<FileText className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />}
      >
        {/* Mobile View */}
        <div className="block md:hidden space-y-3.5">
          {myClosings.map((c) => {
            const st = getStatus(c.status);

            return (
              <div
                key={c.id}
                className="p-4 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[#0B1B32] dark:text-white font-mono-num">
                      {c.date}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-700 dark:text-slate-300">
                      {periodLabel(c.period)}
                    </span>
                  </div>
                  <StatusBadge variant={st.variant}>{st.label}</StatusBadge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono-num">
                  <div className="p-2 rounded-lg bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-[10px] font-sans text-slate-400 block">
                      {tr('النقد (كاش)', 'Cash', 'نقد')}
                    </span>
                    <span className="font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                      {formatCurrency(c.cashSales, currency, language)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-[10px] font-sans text-slate-400 block">
                      {tr('الشبكة (مدى)', 'Card', 'کارڈ')}
                    </span>
                    <span className="font-bold text-[#048264] dark:text-[#08C99B]">
                      {formatCurrency(c.cardSales, currency, language)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-[10px] font-sans text-slate-400 block">
                      {tr('المشتريات', 'Expenses', 'اخراجات')}
                    </span>
                    <span className="font-bold text-rose-600 dark:text-rose-400">
                      {formatCurrency(c.expenses, currency, language)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-[10px] font-sans text-slate-400 block">
                      {tr('الباقي بالصندوق', 'Drawer Cash', 'باقی نقد')}
                    </span>
                    <span className="font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                      {formatCurrency(c.remainingInBox, currency, language)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#DCE6FA] dark:border-[#1F3B66] text-xs">
                  <div>
                    <span className="text-slate-500 text-[11px] me-1">
                      {tr('صافي الفترة:', 'Net:', 'خالص:')}
                    </span>
                    <span className="font-extrabold text-[#048264] dark:text-[#08C99B] font-mono-num text-sm">
                      {formatCurrency(c.netPeriod, currency, language)}
                    </span>
                  </div>

                  {c.status === 'rejected' ? (
                    <button
                      type="button"
                      onClick={() => setViewingClosing(c)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 flex items-center gap-1 min-h-[36px]"
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{tr('عرض سبب الإرجاع', 'View Reason', 'وجہ دیکھیں')}</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      {c.status === 'approved'
                        ? tr('مقفل رسمياً', 'Officially Locked', 'سرکاری مقفل')
                        : tr('بانتظار المدير', 'Awaiting Manager', 'منیجر کا منتظر')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {myClosings.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-400">
              {tr(
                'لم تسجل أي إقفالات بعد. استخدم النموذج بالأعلى لتسجيل إقفال ورديتك الحالية.',
                'No shift closings recorded yet. Use the form above to submit your current shift.',
                'ابھی تک کوئی کلوزنگ درج نہیں کی گئی۔ اپنی موجودہ شفٹ کے لیے اوپر والا فارم استعمال کریں۔'
              )}
            </div>
          )}
        </div>

        {/* Desktop View */}
        <div className={`hidden md:block ${TABLE_WRAPPER}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs sm:text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="p-3.5 text-start">{tr('التاريخ', 'Date', 'تاریخ')}</th>
                  <th className="p-3.5 text-start">{tr('الفترة', 'Period', 'وقت')}</th>
                  <th className="p-3.5 text-start">{tr('النقد', 'Cash', 'نقد')}</th>
                  <th className="p-3.5 text-start">{tr('الشبكة', 'Card', 'کارڈ')}</th>
                  <th className="p-3.5 text-start">{tr('المبيعات', 'Sales', 'فروخت')}</th>
                  <th className="p-3.5 text-start">{tr('المشتريات', 'Expenses', 'اخراجات')}</th>
                  <th className="p-3.5 text-start">{tr('باقي الصندوق', 'Drawer Cash', 'باقی نقد')}</th>
                  <th className="p-3.5 text-start">{tr('صافي الفترة', 'Net', 'خالص')}</th>
                  <th className="p-3.5 text-start">{tr('الحالة', 'Status', 'حیثیت')}</th>
                  <th className="p-3.5 text-start">{tr('تفاصيل / سبب الإرجاع', 'Details / Reason', 'تفصیلات / وجہ')}</th>
                </tr>
              </thead>
              <tbody>
                {myClosings.map((c) => {
                  const st = getStatus(c.status);

                  return (
                    <tr key={c.id} className={TABLE_ROW}>
                      <td className="p-3.5 font-mono-num font-bold text-[#0B1B32] dark:text-white">
                        {c.date}
                      </td>
                      <td className="p-3.5">{periodLabel(c.period)}</td>
                      <td className="p-3.5 font-mono-num text-[#1764FF] dark:text-[#6CA2FF] font-bold">
                        {c.cashSales.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num text-[#048264] dark:text-[#08C99B] font-bold">
                        {c.cardSales.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num font-extrabold text-[#0B1B32] dark:text-white">
                        {c.totalSales.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num text-rose-600 dark:text-rose-400">
                        {c.expenses.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num text-[#1764FF] dark:text-[#6CA2FF] font-bold">
                        {c.remainingInBox.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num text-[#048264] dark:text-[#08C99B] font-bold">
                        {c.netPeriod.toFixed(2)}
                      </td>
                      <td className="p-3.5">
                        <StatusBadge variant={st.variant}>{st.label}</StatusBadge>
                      </td>
                      <td className="p-3.5">
                        {c.status === 'rejected' ? (
                          <button
                            type="button"
                            onClick={() => setViewingClosing(c)}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 flex items-center gap-1"
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>{tr('عرض سبب الإرجاع', 'View Reason', 'وجہ دیکھیں')}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {c.status === 'approved'
                              ? tr('مقفل رسمياً', 'Officially Locked', 'سرکاری مقفل')
                              : tr('بانتظار المدير', 'Awaiting Manager', 'منیجر کا منتظر')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {myClosings.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400">
                {tr(
                  'لم تسجل أي إقفالات بعد. استخدم النموذج بالأعلى لتسجيل إقفال ورديتك الحالية.',
                  'No shift closings recorded yet. Use the form above to submit your current shift.',
                  'ابھی تک کوئی کلوزنگ درج نہیں کی گئی۔ اپنی موجودہ شفٹ کے لیے اوپر والا فارم استعمال کریں۔'
                )}
              </div>
            )}
          </div>
        </div>
      </SurfaceCard>

      {/* Modal for viewing Rejection Reason */}
      <ModalShell
        open={Boolean(viewingClosing)}
        onClose={() => setViewingClosing(null)}
        title={tr('ملاحظة المدير على الإقفال', 'Manager Note on Shift Closing', 'کلوزنگ پر منیجر کا نوٹ')}
        icon={<AlertCircle className="w-4 h-4" />}
        maxWidthClass="max-w-md"
      >
        {viewingClosing && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-800 dark:text-rose-200 space-y-1.5 leading-relaxed">
              <span className="font-bold block">
                {tr('توجيه التعديل من المدير:', 'Revision guidance from manager:', 'منیجر کی ترمیمی ہدایت:')}
              </span>
              <p className="text-sm font-medium">{viewingClosing.rejectionReason}</p>
            </div>

            <div className="text-xs text-slate-500 space-y-1">
              <div>
                {tr('وردية:', 'Shift:', 'شفٹ:')} {viewingClosing.date} ({periodLabel(viewingClosing.period)})
              </div>
              <div className="font-mono-num">
                {tr('المبيعات:', 'Sales:', 'فروخت:')}{' '}
                {formatCurrency(viewingClosing.totalSales, currency, language)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setDate(viewingClosing.date);
                setPeriod(viewingClosing.period);
                setCashSales(String(viewingClosing.cashSales));
                setCardSales(String(viewingClosing.cardSales));
                setExpenses(String(viewingClosing.expenses));
                setNotes(viewingClosing.notes || '');
                setViewingClosing(null);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`${BTN_PRIMARY} w-full`}
            >
              {tr(
                'تحميل البيانات في النموذج لتصحيحها وإعادة الإرسال',
                'Load Data into Form to Correct & Resubmit',
                'تصحیح اور دوبارہ جمع کرانے کے لیے فارم میں ڈیٹا لوڈ کریں'
              )}
            </button>
          </div>
        )}
      </ModalShell>
    </div>
  );
};
