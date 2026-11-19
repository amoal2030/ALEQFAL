import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { ShiftClosing } from '../../types';
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

const STATUS_BADGE_MAP: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'مسودة', variant: 'neutral' },
  pending_review: { label: 'مرسل للمراجعة', variant: 'warning' },
  approved: { label: 'معتمد', variant: 'success' },
  rejected: { label: 'معاد للتعديل', variant: 'danger' },
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
  const { language } = useLanguage();
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

  const handleSubmit = async (targetStatus: 'draft' | 'pending_review') => {
    if (!effectivePerms.canCreateClosing) {
      setErrorMsg('صلاحية إنشاء إقفالات الورديات غير مفعلة لحسابك من قبل مدير المؤسسة.');
      return;
    }

    if (!driveReadiness.isReady) {
      setErrorMsg(driveReadiness.message);
      return;
    }

    if (!effectiveBranch) {
      setErrorMsg('لم يتم تعيين فرع لحسابك. يرجى التواصل مع المدير العام.');
      return;
    }

    if (!calc.isValid) {
      setErrorMsg('يرجى التأكد من إدخال مبالغ مالية صحيحة موجبة.');
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
          ? `تم إرسال إقفال الوردية ${
              period === 'morning' ? 'الصباحية' : 'المسائية'
            } بنجاح للمدير للمراجعة والاعتماد.`
          : 'تم حفظ مسودة الإقفال بنجاح. يمكنك استكمالها لاحقاً.'
      );

      setCashSales('');
      setCardSales('');
      setExpenses('');
      setNotes('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'فشل حفظ الإقفال.');
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
              لوحة موظف الصندوق والورديات
            </StatusBadge>
            <h2 className="text-lg sm:text-2xl font-extrabold text-[#0B192C] dark:text-white break-words">
              مرحباً، {userProfile?.displayName || currentUser?.email}
            </h2>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5 font-bold text-[#0B192C] dark:text-blue-300">
                <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                المؤسسة: {currentOrg?.name}
              </span>
              <span className="hidden sm:inline">•</span>
              {canSelectAnyBranch ? (
                <span className="flex items-center gap-1.5 font-bold text-blue-700 dark:text-blue-300">
                  الفرع: جميع فروع المؤسسة ({selectableBranches.length})
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-bold text-blue-700 dark:text-blue-300">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  الفرع: {effectiveBranch?.name || 'الفرع الرئيسي'}
                </span>
              )}
            </div>
          </div>

          {rejectedCount > 0 && (
            <AlertBanner
              variant="error"
              icon={<AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
              title="تنبيه من الإدارة"
              className="w-full sm:w-auto"
            >
              لديك {rejectedCount} إقفال معاد للتعديل بحاجة لمراجعتك.
            </AlertBanner>
          )}
        </div>
      </SurfaceCard>

      {/* Grid: Create Shift Closing Form (Left 7 Cols) + Quick Stats (Right 5 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7">
          <SurfaceCard
            title="تسجيل إقفال وردية جديدة"
            subtitle="الحساب الفوري التلقائي بدقة الهللات"
            headerAction={
              <button
                type="button"
                disabled={!driveReadiness.isReady}
                onClick={() => {
                  setCashSales('1500');
                  setCardSales('2000');
                  setExpenses('400');
                }}
                className="text-[11px] font-bold text-blue-700 dark:text-blue-300 hover:underline flex items-center gap-1 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>تحميل المثال القياسي</span>
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
                  لا يمكن إرسال ورديات أو عمليات جديدة قبل أن يقوم مدير المؤسسة بربط حساب Google Drive الخاص بالمؤسسة والتحقق من جاهزيته للكتابة والقراءة. الموظف لا يقوم بربط Drive بنفسه.
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
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                >
                  {successMsg}
                </AlertBanner>
              )}

              {!effectivePerms.canCreateClosing ? (
                <div className="p-5 rounded-2xl bg-[#F8FAFC] dark:bg-[#0F1E33] border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 space-y-2">
                  <div className="font-bold text-sm text-[#0B192C] dark:text-white flex items-center gap-2">
                    <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>صلاحية إنشاء إقفالات الورديات غير مفعلة لهذا الحساب</span>
                  </div>
                  <p className="leading-relaxed">
                    بصفتك مسؤولاً على مستوى المؤسسة، تبقى الصلاحيات الاختيارية معطلة افتراضياً حتى يقوم مدير المؤسسة بتفعيلها لك من شاشة إدارة الموظفين.
                  </p>
                </div>
              ) : (
                <fieldset disabled={!driveReadiness.isReady || loading} className="space-y-4 disabled:opacity-60">
                  {canSelectAnyBranch && (
                    <div>
                      <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                        الفرع المستهدف للإقفال *
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
                      <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                        تاريخ الوردية *
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
                      <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                        فترة الوردية *
                      </label>
                      <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value as any)}
                        className={SELECT_CLASS}
                      >
                        <option value="morning">الفترة الصباحية</option>
                        <option value="evening">الفترة المسائية</option>
                      </select>
                    </div>
                  </div>

                  {/* Money Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>النقد (كاش) *</span>
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
                      <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                        <span>الشبكة (مدى) *</span>
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
                      <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <ShoppingBag className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                        <span>المشتريات *</span>
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
                  <div className="p-4 rounded-2xl bg-[#F8FAFC] dark:bg-[#0F1E33] border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
                    <div className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                      <span className="font-semibold">إجمالي المبيعات = النقد + الشبكة:</span>
                      <span className="font-mono-num font-extrabold text-[#0B192C] dark:text-white text-sm">
                        {formatCurrency(calc.totalSales, currency, language)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                      <span className="font-semibold">الباقي في الصندوق = النقد - المشتريات:</span>
                      <span className="font-mono-num font-extrabold text-blue-700 dark:text-blue-300 text-sm">
                        {formatCurrency(calc.remainingInBox, currency, language)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-2.5 border-t border-slate-200 dark:border-slate-700">
                      <span className="font-extrabold text-[#0B192C] dark:text-white">
                        صافي الفترة = إجمالي المبيعات - المشتريات:
                      </span>
                      <span className="font-mono-num font-extrabold text-emerald-700 dark:text-emerald-300 text-base">
                        {formatCurrency(calc.netPeriod, currency, language)}
                      </span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-bold text-[#0B192C] dark:text-slate-300 mb-1.5">
                      ملاحظات الصندوق أو أسباب المصروفات (اختياري)
                    </label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="أدخل أي ملاحظات حول فواتير المشتريات أو عهدة الصندوق..."
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
                      {loading ? 'جاري الحفظ...' : 'إرسال الإقفال للمدير للمراجعة'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSubmit('draft')}
                      disabled={loading || !driveReadiness.isReady}
                      className={`${BTN_SECONDARY} py-3`}
                    >
                      حفظ كمسودة
                    </button>
                  </div>
                </fieldset>
              )}
            </div>
          </SurfaceCard>
        </div>

        {/* Employee Summary & Info: 5 Cols */}
        <div className="lg:col-span-5 space-y-5">
          <SurfaceCard title="إحصائيات إقفالاتي السابقة">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0F1E33] border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold block mb-1">
                  إجمالي إقفالاتي
                </span>
                <span className="text-xl font-extrabold font-mono-num text-[#0B192C] dark:text-white">
                  {myClosings.length}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25">
                <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-bold block mb-1">
                  المعتمدة رسمياً
                </span>
                <span className="text-xl font-extrabold font-mono-num text-emerald-700 dark:text-emerald-300">
                  {myClosings.filter((c) => c.status === 'approved').length}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/25">
                <span className="text-[11px] text-blue-700 dark:text-blue-300 font-bold block mb-1">
                  قيد المراجعة
                </span>
                <span className="text-xl font-extrabold font-mono-num text-blue-700 dark:text-blue-300">
                  {myClosings.filter((c) => c.status === 'pending_review').length}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25">
                <span className="text-[11px] text-rose-700 dark:text-rose-300 font-bold block mb-1">
                  معادة للتعديل
                </span>
                <span className="text-xl font-extrabold font-mono-num text-rose-600 dark:text-rose-400">
                  {rejectedCount}
                </span>
              </div>
            </div>
          </SurfaceCard>

          <AlertBanner
            variant="info"
            icon={<CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
            title="توجيهات إقفال الصندوق"
          >
            <ul className="space-y-1 list-disc list-inside leading-relaxed text-[11px] mt-1">
              <li>تأكد من عد النقد الفعلي الموجود بالصندوق قبل إدخال الأرقام.</li>
              <li>اطبع إجمالي تقرير الشبكة (مدى) من جهاز نقاط البيع.</li>
              <li>اجمع فواتير المصروفات المدفوعة نقداً خلال الوردية.</li>
              <li>بمجرد اعتماد المدير للإقفال يتم إخلاء مسؤوليتك وقفل السجل رسمياً.</li>
            </ul>
          </AlertBanner>
        </div>
      </div>

      {/* Employee's Own Shift History */}
      <SurfaceCard
        title={`سجل إقفالاتي السابقة (${myClosings.length})`}
        headerAction={<FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
      >
        {/* Mobile View */}
        <div className="block md:hidden space-y-3.5">
          {myClosings.map((c) => {
            const st = STATUS_BADGE_MAP[c.status] || STATUS_BADGE_MAP.draft;

            return (
              <div
                key={c.id}
                className="p-4 rounded-2xl bg-[#F8FAFC] dark:bg-[#0F1E33] border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[#0B192C] dark:text-white font-mono-num">
                      {c.date}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {c.period === 'morning' ? 'صباحية' : 'مسائية'}
                    </span>
                  </div>
                  <StatusBadge variant={st.variant}>{st.label}</StatusBadge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono-num">
                  <div className="p-2 rounded-lg bg-white dark:bg-[#0C1829] border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-sans text-slate-400 block">النقد (كاش)</span>
                    <span className="font-bold text-blue-700 dark:text-blue-300">
                      {formatCurrency(c.cashSales, currency, language)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#0C1829] border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-sans text-slate-400 block">الشبكة (مدى)</span>
                    <span className="font-bold text-sky-600 dark:text-sky-400">
                      {formatCurrency(c.cardSales, currency, language)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#0C1829] border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-sans text-slate-400 block">المشتريات</span>
                    <span className="font-bold text-rose-600 dark:text-rose-400">
                      {formatCurrency(c.expenses, currency, language)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#0C1829] border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-sans text-slate-400 block">الباقي بالصندوق</span>
                    <span className="font-bold text-blue-700 dark:text-blue-300">
                      {formatCurrency(c.remainingInBox, currency, language)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                  <div>
                    <span className="text-slate-500 text-[11px] me-1">صافي الفترة:</span>
                    <span className="font-extrabold text-emerald-700 dark:text-emerald-300 font-mono-num text-sm">
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
                      <span>عرض سبب الإرجاع</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      {c.status === 'approved' ? 'مقفل رسمياً' : 'بانتظار المدير'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {myClosings.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-400">
              لم تسجل أي إقفالات بعد. استخدم النموذج بالأعلى لتسجيل إقفال ورديتك الحالية.
            </div>
          )}
        </div>

        {/* Desktop View */}
        <div className={`hidden md:block ${TABLE_WRAPPER}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs sm:text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="p-3.5 text-start">التاريخ</th>
                  <th className="p-3.5 text-start">الفترة</th>
                  <th className="p-3.5 text-start">النقد</th>
                  <th className="p-3.5 text-start">الشبكة</th>
                  <th className="p-3.5 text-start">المبيعات</th>
                  <th className="p-3.5 text-start">المشتريات</th>
                  <th className="p-3.5 text-start">باقي الصندوق</th>
                  <th className="p-3.5 text-start">صافي الفترة</th>
                  <th className="p-3.5 text-start">الحالة</th>
                  <th className="p-3.5 text-start">تفاصيل / سبب الإرجاع</th>
                </tr>
              </thead>
              <tbody>
                {myClosings.map((c) => {
                  const st = STATUS_BADGE_MAP[c.status] || STATUS_BADGE_MAP.draft;

                  return (
                    <tr key={c.id} className={TABLE_ROW}>
                      <td className="p-3.5 font-mono-num font-bold text-[#0B192C] dark:text-white">
                        {c.date}
                      </td>
                      <td className="p-3.5">
                        {c.period === 'morning' ? 'صباحية' : 'مسائية'}
                      </td>
                      <td className="p-3.5 font-mono-num text-blue-700 dark:text-blue-300 font-bold">
                        {c.cashSales.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num text-sky-600 dark:text-sky-400 font-bold">
                        {c.cardSales.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num font-extrabold text-[#0B192C] dark:text-white">
                        {c.totalSales.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num text-rose-600 dark:text-rose-400">
                        {c.expenses.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num text-blue-700 dark:text-blue-300 font-bold">
                        {c.remainingInBox.toFixed(2)}
                      </td>
                      <td className="p-3.5 font-mono-num text-emerald-700 dark:text-emerald-300 font-bold">
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
                            <span>عرض سبب الإرجاع</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {c.status === 'approved' ? 'مقفل رسمياً' : 'بانتظار المدير'}
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
                لم تسجل أي إقفالات بعد. استخدم النموذج بالأعلى لتسجيل إقفال ورديتك الحالية.
              </div>
            )}
          </div>
        </div>
      </SurfaceCard>

      {/* Modal for viewing Rejection Reason */}
      <ModalShell
        open={Boolean(viewingClosing)}
        onClose={() => setViewingClosing(null)}
        title="ملاحظة المدير على الإقفال"
        icon={<AlertCircle className="w-4 h-4" />}
        maxWidthClass="max-w-md"
      >
        {viewingClosing && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-800 dark:text-rose-200 space-y-1.5 leading-relaxed">
              <span className="font-bold block">توجيه التعديل من المدير:</span>
              <p className="text-sm font-medium">{viewingClosing.rejectionReason}</p>
            </div>

            <div className="text-xs text-slate-500 space-y-1">
              <div>
                وردية: {viewingClosing.date} ({viewingClosing.period === 'morning' ? 'صباحية' : 'مسائية'})
              </div>
              <div className="font-mono-num">المبيعات: {viewingClosing.totalSales} ر.س</div>
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
              تحميل البيانات في النموذج لتصحيحها وإعادة الإرسال
            </button>
          </div>
        )}
      </ModalShell>
    </div>
  );
};
