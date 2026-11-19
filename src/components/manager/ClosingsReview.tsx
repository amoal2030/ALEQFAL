import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { ShiftClosing, ClosingArchiveRecord } from '../../types';
import { formatCurrency, formatDate, calculateShiftTotals } from '../../utils/accounting';
import { resolveEffectivePermissions } from '../../utils/permissions';
import {
  FileSpreadsheet,
  CheckCircle2,
  RotateCcw,
  AlertCircle,
  Eye,
  Filter,
  Calendar,
  Lock,
  MessageSquare,
  X,
  Sparkles,
  DollarSign,
  Edit3,
  History,
  CloudUpload,
  ExternalLink,
  Download,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

export const ClosingsReview: React.FC = () => {
  const {
    currentUser,
    userProfile,
    closings,
    closingArchives,
    branches,
    currentOrg,
    reviewShiftClosing,
    adminCorrectClosing,
    archiveClosingToDrive,
    archivePendingClosingsToDrive,
    downloadArchivedExcelFromDrive,
  } = useAuth();
  const { language, tr } = useLanguage();
  const effectivePerms = resolveEffectivePermissions(userProfile);
  const isManager = userProfile?.role === 'manager';
  const canApproveClosings = isManager || effectivePerms.canApproveClosings;

  // Filters
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Selected closing for detail modal
  const [activeClosing, setActiveClosing] = useState<ShiftClosing | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Administrative correction states
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [corrCash, setCorrCash] = useState('');
  const [corrCard, setCorrCard] = useState('');
  const [corrExpenses, setCorrExpenses] = useState('');
  const [corrReason, setCorrReason] = useState('');

  // Drive Archival states
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const [batchArchiveLoading, setBatchArchiveLoading] = useState(false);
  const [archiveFeedback, setArchiveFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    setActiveClosing(null);
    setRejectionReason('');
    setIsRejecting(false);
    setIsCorrecting(false);
    setActionError(null);
    setArchiveFeedback(null);
  }, [currentOrg?.id]);

  const corrCalc = calculateShiftTotals(corrCash, corrCard, corrExpenses);

  const archiveMap = new Map<string, ClosingArchiveRecord>(
    closingArchives.map((a) => [a.closingId, a])
  );

  const pendingSyncClosings = closings.filter((c) => {
    if (c.status !== 'approved') return false;
    const arch = archiveMap.get(c.id);
    return !arch || arch.archiveStatus !== 'archived';
  });

  const getArchiveBadge = (closing: ShiftClosing) => {
    if (closing.status !== 'approved') {
      return {
        label: tr('غير مطلوب بعد', 'Not required yet', 'ابھی درکار نہیں'),
        class: 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20',
      };
    }
    const arch = archiveMap.get(closing.id);
    if (!arch || arch.archiveStatus === 'pending_drive_sync') {
      return {
        label: tr('بانتظار الأرشفة', 'Pending archival', 'آرکائیو زیر التواء'),
        class: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30',
      };
    }
    if (arch.archiveStatus === 'archived') {
      return {
        label: tr(`مؤرشف v${arch.driveRevision || 1}`, `Archived v${arch.driveRevision || 1}`, `آرکائیو شدہ v${arch.driveRevision || 1}`),
        class: 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] border-[#08C99B]/30 font-bold',
      };
    }
    if (arch.archiveStatus === 'stale') {
      return {
        label: tr('يحتاج إعادة أرشفة', 'Needs re-archival', 'دوبارہ آرکائیو درکار'),
        class: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35 font-bold',
      };
    }
    return {
      label: tr('فشل الأرشفة', 'Archival failed', 'آرکائیو ناکام'),
      class: 'bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/30 font-bold',
    };
  };

  const handleArchiveSingle = async (closingId: string) => {
    setArchiveBusyId(closingId);
    setActionError(null);
    setArchiveFeedback(null);
    try {
      const saved = await archiveClosingToDrive(closingId, { interactiveAuthIfNeeded: true });
      setArchiveFeedback({
        type: 'success',
        message: tr(
          `تم إنشاء ورفع والتحقق من ملف Excel (${saved.driveExcelFileName}) — الإصدار v${saved.driveRevision}.`,
          `Excel file (${saved.driveExcelFileName}) created, uploaded, and verified — revision v${saved.driveRevision}.`,
          `Excel فائل (${saved.driveExcelFileName}) تیار، اپ لوڈ اور تصدیق ہو گئی — ورژن v${saved.driveRevision}۔`
        ),
      });
    } catch (err: any) {
      const msg =
        err?.message ||
        tr(
          'فشل أرشفة ملف Excel في Google Drive.',
          'Failed to archive Excel file to Google Drive.',
          'Google Drive میں Excel فائل آرکائیو کرنے میں ناکامی۔'
        );
      setActionError(msg);
      setArchiveFeedback({ type: 'error', message: msg });
    } finally {
      setArchiveBusyId(null);
    }
  };

  const handleBatchArchive = async () => {
    if (pendingSyncClosings.length === 0) return;
    setBatchArchiveLoading(true);
    setArchiveFeedback(null);
    try {
      const result = await archivePendingClosingsToDrive(pendingSyncClosings.map((c) => c.id));
      if (result.failed.length === 0) {
        setArchiveFeedback({
          type: 'success',
          message: tr(
            `تمت أرشفة والتحقق من (${result.succeeded.length}) ملف Excel بنجاح في Google Drive.`,
            `Successfully archived and verified (${result.succeeded.length}) Excel file(s) in Google Drive.`,
            `Google Drive میں (${result.succeeded.length}) Excel فائلیں کامیابی سے آرکائیو اور تصدیق ہو گئیں۔`
          ),
        });
      } else {
        setArchiveFeedback({
          type: 'warning',
          message: tr(
            `تمت أرشفة (${result.succeeded.length}) ملفات، وفشل (${result.failed.length}): ${result.failed[0].error}`,
            `Archived (${result.succeeded.length}) file(s), failed (${result.failed.length}): ${result.failed[0].error}`,
            `(${result.succeeded.length}) فائلیں آرکائیو ہوئیں، (${result.failed.length}) ناکام: ${result.failed[0].error}`
          ),
        });
      }
    } catch (err: any) {
      setArchiveFeedback({
        type: 'error',
        message:
          err?.message ||
          tr(
            'تعذر تنفيذ المزامنة الجماعية مع Google Drive.',
            'Failed to run batch sync with Google Drive.',
            'Google Drive کے ساتھ اجتماعی ہم آہنگی ناکام ہو گئی۔'
          ),
      });
    } finally {
      setBatchArchiveLoading(false);
    }
  };

  const handleDownloadOriginalFromDrive = async (closingId: string) => {
    setDownloadBusyId(closingId);
    setActionError(null);
    setArchiveFeedback(null);
    try {
      const downloaded = await downloadArchivedExcelFromDrive(closingId);
      setArchiveFeedback({
        type: 'success',
        message: tr(
          `تم تنزيل والتحقق من ملف Excel الأصلي المخزن في Google Drive (${downloaded.fileName} — v${downloaded.revision}).`,
          `Downloaded and verified original Excel file from Google Drive (${downloaded.fileName} — v${downloaded.revision}).`,
          `Google Drive میں محفوظ اصل Excel فائل ڈاؤن لوڈ اور تصدیق ہو گئی (${downloaded.fileName} — v${downloaded.revision})۔`
        ),
      });
    } catch (err: any) {
      const msg =
        err?.message ||
        tr(
          'فشل تنزيل ملف Excel الأصلي من Google Drive.',
          'Failed to download original Excel file from Google Drive.',
          'Google Drive سے اصل Excel فائل ڈاؤن لوڈ کرنے میں ناکامی۔'
        );
      setActionError(msg);
      setArchiveFeedback({ type: 'error', message: msg });
    } finally {
      setDownloadBusyId(null);
    }
  };

  const filteredClosings = closings.filter((c) => {
    if (selectedBranchId !== 'all' && c.branchId !== selectedBranchId) return false;
    if (selectedStatus !== 'all' && c.status !== selectedStatus) return false;
    if (selectedPeriod !== 'all' && c.period !== selectedPeriod) return false;
    if (selectedDate && c.date !== selectedDate) return false;
    return true;
  });

  const handleApprove = async () => {
    if (!activeClosing) return;
    setReviewLoading(true);
    setActionError(null);
    setArchiveFeedback(null);
    const targetId = activeClosing.id;
    try {
      await reviewShiftClosing(targetId, 'approve');
      // Try automatic Drive archival silently if an active verified RAM Drive session exists
      try {
        const saved = await archiveClosingToDrive(targetId, { interactiveAuthIfNeeded: false });
        setArchiveFeedback({
          type: 'success',
          message: `تم اعتماد الإقفال وأرشفة ملف Excel (${saved.driveExcelFileName}) والتحقق منه في Google Drive.`,
        });
      } catch (archErr: any) {
        setArchiveFeedback({
          type: 'warning',
          message:
            archErr?.message ||
            'تم اعتماد الإقفال رسمياً. يرجى الضغط على «أرشفة في Google Drive» لرفع ملف Excel.',
        });
      }
      setActiveClosing(null);
    } catch (err: any) {
      setActionError(err?.message || 'فشل اعتماد الإقفال.');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleReject = async () => {
    if (!activeClosing) return;
    if (!rejectionReason.trim()) {
      setActionError('يجب كتابة سبب الإعادة للموظف لتوضيح التعديل المطلوب.');
      return;
    }
    setReviewLoading(true);
    setActionError(null);
    try {
      await reviewShiftClosing(activeClosing.id, 'reject', rejectionReason);
      setActiveClosing(null);
      setIsRejecting(false);
      setRejectionReason('');
    } catch (err: any) {
      setActionError(err?.message || 'فشل إرجاع الإقفال.');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleAdminCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClosing) return;
    if (!corrReason.trim()) {
      setActionError('يجب كتابة سبب ومبرر التصحيح الإداري لتعديل إقفال معتمد.');
      return;
    }

    setReviewLoading(true);
    setActionError(null);
    setArchiveFeedback(null);
    const targetId = activeClosing.id;
    try {
      await adminCorrectClosing({
        closingId: targetId,
        cashSales: corrCalc.cashSales,
        cardSales: corrCalc.cardSales,
        expenses: corrCalc.expenses,
        correctionReason: corrReason,
      });
      // Attempt immediate re-archival (v+1) if RAM Drive session is active
      try {
        const saved = await archiveClosingToDrive(targetId, { interactiveAuthIfNeeded: false });
        setArchiveFeedback({
          type: 'success',
          message: `تم توثيق التصحيح الإداري وإصدار ملف Excel الجديد v${saved.driveRevision} (${saved.driveExcelFileName}) في Google Drive.`,
        });
      } catch (archErr: any) {
        setArchiveFeedback({
          type: 'warning',
          message:
            archErr?.message ||
            'تم توثيق التصحيح الإداري وأصبح الإقفال بحاجة لإعادة الأرشفة في Google Drive.',
        });
      }
      setActiveClosing(null);
      setIsCorrecting(false);
    } catch (err: any) {
      setActionError(err?.message || 'فشل تنفيذ التصحيح الإداري.');
    } finally {
      setReviewLoading(false);
    }
  };

  const statusBadgesMap: Record<string, { label: string; class: string }> = {
    draft: {
      label: tr('مسودة', 'Draft', 'مسودہ'),
      class: 'bg-slate-500/12 text-slate-500 dark:text-slate-400 border-slate-500/25',
    },
    pending_review: {
      label: tr('مرسل للمراجعة', 'Pending review', 'جائزے کے لیے زیر التواء'),
      class: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35 font-bold',
    },
    approved: {
      label: tr('معتمد', 'Approved', 'منظور شدہ'),
      class: 'bg-[#08C99B]/12 text-[#048264] dark:text-[#08C99B] border-[#08C99B]/30 font-bold',
    },
    rejected: {
      label: tr('معاد للتعديل', 'Returned', 'ترمیم کے لیے واپس'),
      class: 'bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/30 font-bold',
    },
  };

  return (
    <div className="space-y-6">
      {/* Header and Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-[#0B1B32] dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[#1764FF] dark:text-[#6CA2FF]" />
            <span>
              {tr('مراجعة واعتماد إقفالات الورديات', 'Review & Approve Shift Closings', 'شفٹ کلوزنگ کا جائزہ اور منظوری')} ({filteredClosings.length})
            </span>
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {tr(
              'مراجعة أرقام النقد والشبكة والمشتريات واعتمادها رسمياً، أو إرجاعها للتعديل، أو إجراء تصحيح إداري موثق',
              'Review cash, POS card, and purchase totals to formally approve, return for edits, or log an administrative correction',
              'نقد، کارڈ اور خریداری کے اعداد و شمار کا جائزہ لیں، باضابطہ منظوری دیں، ترمیم کے لیے واپس کریں یا انتظامی تصحیح درج کریں'
            )}
          </span>
        </div>

        {(selectedBranchId !== 'all' || selectedStatus !== 'all' || selectedPeriod !== 'all' || selectedDate) && (
          <button
            onClick={() => {
              setSelectedBranchId('all');
              setSelectedStatus('all');
              setSelectedPeriod('all');
              setSelectedDate('');
            }}
            className="text-xs font-semibold text-[#1764FF] dark:text-[#6CA2FF] hover:underline"
          >
            {tr('إعادة تعيين الفلاتر', 'Reset Filters', 'فلٹرز ری سیٹ کریں')}
          </button>
        )}
      </div>

      {/* Pending Drive Archival Banner (Manager only) */}
      {isManager && pendingSyncClosings.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-amber-800 dark:text-amber-200">
            <CloudUpload className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <span className="font-bold block">
                {tr(
                  `يوجد (${pendingSyncClosings.length}) إقفال معتمد بانتظار الأرشفة أو التحديث في Google Drive`,
                  `(${pendingSyncClosings.length}) approved closing(s) pending archival or update in Google Drive`,
                  `Google Drive میں آرکائیو یا اپ ڈیٹ کے منتظر (${pendingSyncClosings.length}) منظور شدہ کلوزنگ موجود ہیں`
                )}
              </span>
              <span className="text-[11px] opacity-85">
                {tr(
                  'يتم توليد ملفات Excel (.xlsx) وتخزينها في مجلد الشهر والتحقق من قراءتها قبل اعتماد حالة الأرشفة.',
                  'Excel (.xlsx) workbooks are generated, uploaded to the monthly folder, and verified before marking archived.',
                  'Excel (.xlsx) فائلیں تیار کر کے ماہانہ فولڈر میں محفوظ کی جاتی ہیں اور آرکائیو کی تصدیق کی جاتی ہے۔'
                )}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleBatchArchive}
            disabled={batchArchiveLoading}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-[#1764FF] hover:bg-[#1052D8] text-white shadow-sm flex items-center gap-1.5 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${batchArchiveLoading ? 'animate-spin' : ''}`} />
            <span>
              {batchArchiveLoading
                ? tr('جاري رفع والتحقق من الملفات...', 'Uploading & verifying files...', 'فائلیں اپ لوڈ اور تصدیق ہو رہی ہیں...')
                : tr('أرشفة الكل في Google Drive', 'Archive All to Google Drive', 'سب کو Google Drive میں آرکائیو کریں')}
            </span>
          </button>
        </div>
      )}

      {/* Archival Operation Feedback */}
      {archiveFeedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            archiveFeedback.type === 'success'
              ? 'bg-[#08C99B]/10 border-[#08C99B]/30 text-[#048264] dark:text-[#08C99B]'
              : archiveFeedback.type === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
          }`}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>{archiveFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setArchiveFeedback(null)}
            className="opacity-70 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] shadow-sm">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            {tr('الفرع', 'Branch', 'برانچ')}
          </label>
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
          >
            <option value="all">{tr('جميع الفروع', 'All Branches', 'تمام برانچز')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            {tr('حالة الإقفال', 'Closing Status', 'کلوزنگ کی حیثیت')}
          </label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
          >
            <option value="all">{tr('جميع الحالات', 'All Statuses', 'تمام حیثیتیں')}</option>
            <option value="pending_review">{tr('مرسل للمراجعة (بانتظار الاعتماد)', 'Pending review (Awaiting approval)', 'جائزے کے لیے زیر التواء')}</option>
            <option value="approved">{tr('معتمد رسمي', 'Formally approved', 'باضابطہ منظور شدہ')}</option>
            <option value="rejected">{tr('معاد للتعديل', 'Returned for edits', 'ترمیم کے لیے واپس')}</option>
            <option value="draft">{tr('مسودة', 'Draft', 'مسودہ')}</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            {tr('فترة الوردية', 'Shift Period', 'شفٹ کا وقت')}
          </label>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
          >
            <option value="all">{tr('الصباحية والمسائية', 'Morning & Evening', 'صبح اور شام')}</option>
            <option value="morning">{tr('الفترة الصباحية', 'Morning Shift', 'صبح کی شفٹ')}</option>
            <option value="evening">{tr('الفترة المسائية', 'Evening Shift', 'شام کی شفٹ')}</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            {tr('التاريخ المحدد', 'Specific Date', 'مخصوص تاریخ')}
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white focus:border-[#1764FF] outline-none"
          />
        </div>
      </div>

      {/* Responsive View: Mobile Cards (Phones & Small Tablets < 768px) */}
      <div className="block md:hidden space-y-3">
        {filteredClosings.map((closing) => {
          const badge = statusBadgesMap[closing.status] || statusBadgesMap.draft;

          return (
            <div
              key={closing.id}
              className="p-4 rounded-2xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[#E6EEFC] dark:border-[#1F3B66] pb-2.5">
                <div>
                  <h4 className="text-sm font-bold text-[#0B1B32] dark:text-white">
                    {closing.branchName}
                  </h4>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                    <span>{closing.date}</span>
                    <span>•</span>
                    <span>
                      {closing.period === 'morning'
                        ? tr('وردية صباحية', 'Morning Shift', 'صبح کی شفٹ')
                        : tr('وردية مسائية', 'Evening Shift', 'شام کی شفٹ')}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badge.class}`}>
                    {badge.label}
                  </span>
                  {closing.status === 'approved' && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        getArchiveBadge(closing).class
                      }`}
                    >
                      {getArchiveBadge(closing).label}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">
                    {tr('إجمالي المبيعات', 'Total Sales', 'کل فروخت')}
                  </span>
                  <span className="text-[#0B1B32] dark:text-white font-bold font-mono text-sm">
                    {closing.totalSales.toFixed(2)}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">
                    {tr('صافي الفترة', 'Net Period', 'خالص مدت')}
                  </span>
                  <span className="text-[#048264] dark:text-[#08C99B] font-bold font-mono text-sm">
                    {closing.netPeriod.toFixed(2)}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-[#F5F8FF]/70 dark:bg-[#0E203A]/70 text-[11px] flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{tr('النقد:', 'Cash:', 'نقد:')}</span>
                  <span className="font-mono text-[#1764FF] dark:text-[#6CA2FF] font-bold">{closing.cashSales.toFixed(2)}</span>
                </div>
                <div className="p-2 rounded-lg bg-[#F5F8FF]/70 dark:bg-[#0E203A]/70 text-[11px] flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{tr('الشبكة:', 'Card:', 'کارڈ:')}</span>
                  <span className="font-mono text-sky-600 dark:text-sky-400 font-bold">{closing.cardSales.toFixed(2)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveClosing(closing);
                  setIsRejecting(false);
                  setIsCorrecting(false);
                  setRejectionReason('');
                  setActionError(null);
                  setCorrCash(String(closing.cashSales));
                  setCorrCard(String(closing.cardSales));
                  setCorrExpenses(String(closing.expenses));
                  setCorrReason('');
                }}
                className="w-full py-2.5 rounded-xl text-xs font-bold bg-[#1764FF] hover:bg-[#1052D8] text-white flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <Eye className="w-3.5 h-3.5 text-white" />
                <span>{tr('فحص ومراجعة الإقفال', 'Inspect & Review Closing', 'کلوزنگ کا معائنہ اور جائزہ')}</span>
              </button>
            </div>
          );
        })}

        {filteredClosings.length === 0 && (
          <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66]">
            {tr(
              'لا توجد إقفالات مطابقة للفلاتر المختارة حالياً.',
              'No shift closings match the selected filters.',
              'منتخب فلٹرز کے مطابق کوئی شفٹ کلوزنگ موجود نہیں ہے۔'
            )}
          </div>
        )}
      </div>

      {/* Desktop Closings Table (Screens >= 768px) */}
      <div className="hidden md:block bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6FA] dark:border-[#1F3B66] shadow-sm overflow-x-auto">
        <table className="w-full text-start text-xs sm:text-sm">
          <thead className="bg-[#F5F8FF] dark:bg-[#0E203A] text-slate-600 dark:text-slate-300 text-[11px] font-bold uppercase tracking-wider border-b border-[#DCE6FA] dark:border-[#1F3B66]">
            <tr>
              <th className="p-4 text-start">{tr('التاريخ', 'Date', 'تاریخ')}</th>
              <th className="p-4 text-start">{tr('الفرع', 'Branch', 'برانچ')}</th>
              <th className="p-4 text-start">{tr('الموظف', 'Employee', 'ملازم')}</th>
              <th className="p-4 text-start">{tr('الفترة', 'Period', 'شفٹ')}</th>
              <th className="p-4 text-start">{tr('النقد', 'Cash', 'نقد')}</th>
              <th className="p-4 text-start">{tr('الشبكة', 'Card', 'کارڈ')}</th>
              <th className="p-4 text-start">{tr('إجمالي المبيعات', 'Total Sales', 'کل فروخت')}</th>
              <th className="p-4 text-start">{tr('المشتريات', 'Purchases', 'خریداری')}</th>
              <th className="p-4 text-start">{tr('الباقي بالصندوق', 'Remaining Cash', 'باقی نقد')}</th>
              <th className="p-4 text-start">{tr('صافي الفترة', 'Net Period', 'خالص مدت')}</th>
              <th className="p-4 text-start">{tr('الحالة', 'Status', 'حیثیت')}</th>
              <th className="p-4 text-start">{tr('أرشفة Drive', 'Drive Archive', 'Drive آرکائیو')}</th>
              <th className="p-4 text-start">{tr('معاينة', 'Inspect', 'معائنہ')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1F3B66] font-mono">
            {filteredClosings.map((closing) => {
              const badge = statusBadgesMap[closing.status] || statusBadgesMap.draft;

              return (
                <tr
                  key={closing.id}
                  className="hover:bg-[#F5F8FF]/70 dark:hover:bg-[#173056]/40 transition-colors"
                >
                  <td className="p-4 font-bold text-[#0B1B32] dark:text-white">
                    {closing.date}
                  </td>
                  <td className="p-4 font-sans text-slate-700 dark:text-slate-200">
                    {closing.branchName}
                  </td>
                  <td className="p-4 font-sans text-slate-700 dark:text-slate-200">
                    {closing.employeeName}
                  </td>
                  <td className="p-4 font-sans">
                    <span className="px-2 py-0.5 rounded text-xs bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-700 dark:text-slate-300">
                      {closing.period === 'morning'
                        ? tr('صباحية', 'Morning', 'صبح')
                        : tr('مسائية', 'Evening', 'شام')}
                    </span>
                  </td>
                  <td className="p-4 text-[#1764FF] dark:text-[#6CA2FF] font-bold">
                    {closing.cashSales.toFixed(2)}
                  </td>
                  <td className="p-4 text-sky-600 dark:text-sky-400 font-bold">
                    {closing.cardSales.toFixed(2)}
                  </td>
                  <td className="p-4 font-black text-[#0B1B32] dark:text-white">
                    {closing.totalSales.toFixed(2)}
                  </td>
                  <td className="p-4 text-rose-500 dark:text-rose-400">
                    {closing.expenses.toFixed(2)}
                  </td>
                  <td className="p-4 text-sky-600 dark:text-sky-400 font-bold">
                    {closing.remainingInBox.toFixed(2)}
                  </td>
                  <td className="p-4 text-[#048264] dark:text-[#08C99B] font-bold">
                    {closing.netPeriod.toFixed(2)}
                  </td>
                  <td className="p-4 font-sans">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${badge.class}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="p-4 font-sans">
                    {(() => {
                      const archBadge = getArchiveBadge(closing);
                      const archRecord = archiveMap.get(closing.id);
                      const needsSync =
                        closing.status === 'approved' &&
                        (!archRecord || archRecord.archiveStatus !== 'archived');
                      return (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${archBadge.class}`}
                            title={archRecord?.archiveError || archRecord?.driveExcelFileName || ''}
                          >
                            {archBadge.label}
                          </span>
                          {needsSync && (
                            <button
                              type="button"
                              onClick={() => handleArchiveSingle(closing.id)}
                              disabled={archiveBusyId === closing.id}
                              title={tr('أرشفة ملف Excel في Google Drive', 'Archive Excel file to Google Drive', 'Google Drive میں Excel فائل آرکائیو کریں')}
                              className="p-1 rounded-lg bg-[#1764FF]/10 hover:bg-[#1764FF]/20 text-[#1764FF] dark:text-[#6CA2FF] border border-[#1764FF]/30 disabled:opacity-50"
                            >
                              <CloudUpload
                                className={`w-3.5 h-3.5 ${
                                  archiveBusyId === closing.id ? 'animate-pulse' : ''
                                }`}
                              />
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-4 font-sans">
                    <button
                      onClick={() => {
                        setActiveClosing(closing);
                        setIsRejecting(false);
                        setIsCorrecting(false);
                        setRejectionReason('');
                        setActionError(null);
                        setCorrCash(String(closing.cashSales));
                        setCorrCard(String(closing.cardSales));
                        setCorrExpenses(String(closing.expenses));
                        setCorrReason('');
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#F5F8FF] dark:bg-[#0E203A] hover:bg-[#1764FF]/10 border border-[#DCE6FA] dark:border-[#1F3B66] text-[#0B1B32] dark:text-white transition-colors flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                      <span>{tr('فحص', 'Inspect', 'معائنہ')}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredClosings.length === 0 && (
          <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
            {tr(
              'لا توجد إقفالات مطابقة للفلاتر المختارة حالياً.',
              'No shift closings match the selected filters.',
              'منتخب فلٹرز کے مطابق کوئی شفٹ کلوزنگ موجود نہیں ہے۔'
            )}
          </div>
        )}
      </div>

      {/* Detail & Review Modal */}
      {activeClosing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1B32]/75 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#122543] rounded-3xl border border-[#DCE6FA] dark:border-[#1F3B66] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="p-6 bg-[#0B1B32] text-white flex items-center justify-between border-b border-[#1F3B66] sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#1764FF]/20 text-[#6CA2FF] flex items-center justify-center font-bold">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold">
                    {tr('إقفال', 'Closing', 'کلوزنگ')} {activeClosing.branchName} •{' '}
                    {activeClosing.period === 'morning'
                      ? tr('الفترة الصباحية', 'Morning Shift', 'صبح کی شفٹ')
                      : tr('الفترة المسائية', 'Evening Shift', 'شام کی شفٹ')}
                  </h4>
                  <span className="text-xs text-slate-300 font-mono">
                    {tr('التاريخ:', 'Date:', 'تاریخ:')} {activeClosing.date} • {tr('الموظف:', 'Employee:', 'ملازم:')} {activeClosing.employeeName}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setActiveClosing(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {actionError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Status Notice */}
              {activeClosing.status === 'approved' && !isCorrecting && (
                <div className="p-3.5 rounded-xl bg-[#08C99B]/10 border border-[#08C99B]/30 text-xs text-[#048264] dark:text-[#08C99B] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 shrink-0" />
                    <span>
                      {tr(
                        'هذا الإقفال معتمد رسمياً ومقفل ضد التعديلات العادية.',
                        'This shift closing is formally approved and locked against standard edits.',
                        'یہ شفٹ کلوزنگ باضابطہ منظور شدہ اور عام تبدیلیوں سے مقفل ہے۔'
                      )}
                    </span>
                  </div>
                  {isManager && (
                    <button
                      onClick={() => setIsCorrecting(true)}
                      className="px-3 py-1.5 rounded-lg font-bold text-xs bg-[#1764FF] text-white hover:bg-[#1052D8] flex items-center gap-1.5 shrink-0 transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{tr('طلب تصحيح إداري مبرر', 'Admin Correction', 'انتظامی تصحیح')}</span>
                    </button>
                  )}
                </div>
              )}

              {/* Google Drive Excel Archival Details & Controls (Approved Closings Only, Manager Only) */}
              {isManager && activeClosing.status === 'approved' && (() => {
                const arch = archiveMap.get(activeClosing.id);
                const isArchived = arch?.archiveStatus === 'archived';
                const hasDriveFile = Boolean(arch?.driveExcelFileId);
                const isOrgOwner = Boolean(currentUser && currentOrg && currentUser.uid === currentOrg.ownerId);
                const archBadge = getArchiveBadge(activeClosing);
                const driveUrl = arch?.driveExcelWebViewLink
                  ? currentOrg?.driveAccountEmail
                    ? `${arch.driveExcelWebViewLink}${
                        arch.driveExcelWebViewLink.includes('?') ? '&' : '?'
                      }authuser=${encodeURIComponent(currentOrg.driveAccountEmail)}`
                    : arch.driveExcelWebViewLink
                  : null;

                return (
                  <div className="p-4 rounded-2xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold text-[#0B1B32] dark:text-white">
                        <CloudUpload className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF]" />
                        <span>{tr('أرشفة Excel في Google Drive', 'Excel Archival in Google Drive', 'Google Drive میں Excel آرکائیو')}</span>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] border ${archBadge.class}`}>
                        {archBadge.label}
                      </span>
                    </div>

                    {arch?.driveExcelFileName && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300 font-mono">
                        <div className="truncate" title={arch.driveExcelFileName}>
                          {tr('الملف:', 'File:', 'فائل:')} {arch.driveExcelFileName}
                        </div>
                        <div>
                          {tr('الإصدار:', 'Revision:', 'ورژن:')} v{arch.driveRevision || 1} • {tr('الشهر:', 'Month:', 'مہینہ:')} {arch.yearMonth}
                        </div>
                        {arch.drivePayloadHash && (
                          <div className="sm:col-span-2 truncate text-slate-500" title={arch.drivePayloadHash}>
                            SHA-256: {arch.drivePayloadHash}
                          </div>
                        )}
                      </div>
                    )}

                    {arch?.archiveStatus === 'failed' && arch.archiveError && (
                      <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[11px]">
                        {tr('سبب آخر فشل:', 'Last error:', 'آخری خرابی کی وجہ:')} {arch.archiveError}
                      </div>
                    )}

                    {!isOrgOwner && (
                      <div className="p-2.5 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300 text-[11px]">
                        {tr(
                          `عمليات الرفع والتنزيل المباشر من Google Drive مقتصرة على مالك المؤسسة المرتبط حسابه (${currentOrg?.ownerName}).`,
                          `Direct Google Drive uploads and downloads are restricted to the linked organization owner (${currentOrg?.ownerName}).`,
                          `Google Drive میں براہِ راست اپ لوڈ اور ڈاؤن لوڈ صرف منسلک ادارہ مالک (${currentOrg?.ownerName}) کے لیے محدود ہیں۔`
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {!isArchived && (
                        <button
                          type="button"
                          onClick={() => handleArchiveSingle(activeClosing.id)}
                          disabled={archiveBusyId === activeClosing.id || !isOrgOwner}
                          className="px-3.5 py-2 rounded-xl font-bold text-xs bg-[#1764FF] hover:bg-[#1052D8] text-white flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                        >
                          <CloudUpload className="w-3.5 h-3.5" />
                          <span>
                            {archiveBusyId === activeClosing.id
                              ? tr('جاري الإنشاء والرفع والتحقق...', 'Generating, uploading & verifying...', 'تیار، اپ لوڈ اور تصدیق ہو رہی ہے...')
                              : arch?.archiveStatus === 'stale'
                              ? tr('إصدار وأرشفة النسخة المحدثة في Drive', 'Archive Updated Revision to Drive', 'اپ ڈیٹ شدہ ورژن Drive میں آرکائیو کریں')
                              : arch?.archiveStatus === 'failed'
                              ? tr('إعادة المحاولة في Google Drive', 'Retry Google Drive Archival', 'Google Drive میں دوبارہ کوشش کریں')
                              : tr('أرشفة في Google Drive', 'Archive to Google Drive', 'Google Drive میں آرکائیو کریں')}
                          </span>
                        </button>
                      )}

                      {hasDriveFile && (
                        <button
                          type="button"
                          onClick={() => handleDownloadOriginalFromDrive(activeClosing.id)}
                          disabled={downloadBusyId === activeClosing.id || archiveBusyId === activeClosing.id || !isOrgOwner}
                          className="px-3.5 py-2 rounded-xl font-semibold text-xs bg-white dark:bg-[#122543] hover:bg-[#F5F8FF] dark:hover:bg-[#173056] text-[#0B1B32] dark:text-white border border-[#DCE6FA] dark:border-[#1F3B66] flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                          <span>
                            {downloadBusyId === activeClosing.id
                              ? tr('جاري التنزيل والتحقق من Drive...', 'Downloading & verifying from Drive...', 'Drive سے ڈاؤن لوڈ اور تصدیق ہو رہی ہے...')
                              : tr(
                                  `تنزيل الملف الأصلي من Google Drive (v${arch?.driveRevision || 1})`,
                                  `Download Original from Google Drive (v${arch?.driveRevision || 1})`,
                                  `Google Drive سے اصل فائل ڈاؤن لوڈ کریں (v${arch?.driveRevision || 1})`
                                )}
                          </span>
                        </button>
                      )}

                      {driveUrl && (
                        <a
                          href={driveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3.5 py-2 rounded-xl font-semibold text-xs bg-white dark:bg-[#122543] hover:bg-[#F5F8FF] dark:hover:bg-[#173056] text-[#0B1B32] dark:text-white border border-[#DCE6FA] dark:border-[#1F3B66] flex items-center gap-1.5 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-[#048264] dark:text-[#08C99B]" />
                          <span>{tr('فتح في Google Drive', 'Open in Google Drive', 'Google Drive میں کھولیں')}</span>
                        </a>
                      )}
                    </div>

                    {!hasDriveFile && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {tr(
                          'لا يوجد ملف Excel محفوظ في Google Drive لهذا الإقفال حتى الآن. اضغط «أرشفة في Google Drive» لحفظ النسخة الرسمية الأولى.',
                          'No Excel file is stored in Google Drive for this closing yet. Click "Archive to Google Drive" to save the initial official copy.',
                          'اس کلوزنگ کے لیے ابھی تک Google Drive میں کوئی Excel فائل محفوظ نہیں ہے۔ پہلی باضابطہ کاپی محفوظ کرنے کے لیے "Google Drive میں آرکائیو کریں" پر کلک کریں۔'
                        )}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Previous Correction History if exists */}
              {activeClosing.previousValues && (
                <div className="p-4 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs space-y-2">
                  <div className="font-bold flex items-center gap-1.5 text-[#1764FF] dark:text-[#6CA2FF]">
                    <History className="w-4 h-4" />
                    <span>
                      {tr(
                        'سجل التصحيح الإداري السابق (موثق في Audit Logs):',
                        'Previous Administrative Correction Log (Recorded in Audit Logs):',
                        'سابقہ انتظامی تصحیح کا ریکارڈ (آڈٹ لاگز میں محفوظ):'
                      )}
                    </span>
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">
                    <div>
                      {tr('سبب التصحيح:', 'Correction reason:', 'تصحیح کی وجہ:')} {activeClosing.correctionReason}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {tr(
                        `القيم السابقة: نقد ${activeClosing.previousValues.cashSales} | شبكة ${activeClosing.previousValues.cardSales} | مشتريات ${activeClosing.previousValues.expenses} | إجمالي ${activeClosing.previousValues.totalSales}`,
                        `Previous values: Cash ${activeClosing.previousValues.cashSales} | Card ${activeClosing.previousValues.cardSales} | Purchases ${activeClosing.previousValues.expenses} | Total ${activeClosing.previousValues.totalSales}`,
                        `سابقہ اقدار: نقد ${activeClosing.previousValues.cashSales} | کارڈ ${activeClosing.previousValues.cardSales} | خریداری ${activeClosing.previousValues.expenses} | کل ${activeClosing.previousValues.totalSales}`
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeClosing.status === 'rejected' && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">
                      {tr('سبب الإرجاع للتعديل:', 'Reason for return:', 'واپسی کی وجہ:')}
                    </span>
                    <span>{activeClosing.rejectionReason}</span>
                  </div>
                </div>
              )}

              {/* Administrative Correction Form (Manager only) */}
              {isManager && isCorrecting ? (
                <form onSubmit={handleAdminCorrection} className="p-5 rounded-2xl bg-[#1764FF]/5 dark:bg-[#1764FF]/10 border border-[#1764FF]/30 space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-[#1764FF]/20">
                    <span className="text-xs font-bold text-[#1764FF] dark:text-[#6CA2FF] flex items-center gap-1.5">
                      <Edit3 className="w-4 h-4" />
                      {tr(
                        'إجراء تصحيح إداري رسمي على إقفال معتمد',
                        'Record Official Administrative Correction on Approved Closing',
                        'منظور شدہ کلوزنگ پر باضابطہ انتظامی تصحیح درج کریں'
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCorrecting(false)}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-[#0B1B32] dark:hover:text-white"
                    >
                      {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {tr('النقد المصحح *', 'Corrected Cash *', 'درست نقد *')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={corrCash}
                        onChange={(e) => setCorrCash(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-mono font-bold text-[#0B1B32] dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {tr('الشبكة المصححة *', 'Corrected Card *', 'درست کارڈ *')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={corrCard}
                        onChange={(e) => setCorrCard(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-mono font-bold text-[#0B1B32] dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {tr('المشتريات المصححة *', 'Corrected Purchases *', 'درست خریداری *')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={corrExpenses}
                        onChange={(e) => setCorrExpenses(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-mono font-bold text-[#0B1B32] dark:text-white"
                      />
                    </div>
                  </div>

                  {/* New Totals Calculated */}
                  <div className="p-3 rounded-xl bg-white dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="font-sans text-slate-500 dark:text-slate-400">
                        {tr('إجمالي المبيعات الجديد:', 'New Total Sales:', 'نئی کل فروخت:')}
                      </span>
                      <span className="font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                        {formatCurrency(corrCalc.totalSales, currentOrg?.currency || 'SAR', language)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-sans text-slate-500 dark:text-slate-400">
                        {tr('باقي الصندوق الجديد:', 'New Remaining Cash:', 'نیا باقی نقد:')}
                      </span>
                      <span className="font-bold text-sky-600 dark:text-sky-400">
                        {formatCurrency(corrCalc.remainingInBox, currentOrg?.currency || 'SAR', language)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-sans text-slate-500 dark:text-slate-400">
                        {tr('صافي الفترة الجديد:', 'New Net Period:', 'نئی خالص مدت:')}
                      </span>
                      <span className="font-bold text-[#048264] dark:text-[#08C99B]">
                        {formatCurrency(corrCalc.netPeriod, currentOrg?.currency || 'SAR', language)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#1764FF] dark:text-[#6CA2FF] mb-1">
                      {tr('مبرر وسبب التصحيح الإداري (إلزامي للرقابة) *', 'Administrative Correction Reason (Required for Audit) *', 'انتظامی تصحیح کی وجہ (آڈٹ کے لیے لازمی) *')}
                    </label>
                    <textarea
                      rows={2}
                      required
                      value={corrReason}
                      onChange={(e) => setCorrReason(e.target.value)}
                      placeholder={tr(
                        'مثال: تصحيح فروقات شبكة جهاز مدى بعد مراجعة تقرير البنك اليومي...',
                        'Example: Adjusted POS card settlement variance after reviewing daily bank statement...',
                        'مثال: روزانہ بینک اسٹیٹمنٹ کے جائزے کے بعد کارڈ ٹرمینل کے فرق کی تصحیح...'
                      )}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={reviewLoading}
                      className="px-5 py-2.5 rounded-xl font-bold text-xs text-white bg-[#1764FF] hover:bg-[#1052D8] disabled:opacity-50 transition-colors"
                    >
                      {reviewLoading
                        ? tr('جاري توثيق التصحيح...', 'Recording correction...', 'تصحیح درج ہو رہی ہے...')
                        : tr('حفظ التصحيح الإداري وتوثيقه', 'Save & Audit Correction', 'انتظامی تصحیح محفوظ کریں')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCorrecting(false)}
                      className="px-4 py-2.5 rounded-xl font-medium text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#173056]"
                    >
                      {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                    </button>
                  </div>
                </form>
              ) : (
                /* Standard Math Figures Grid */
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-xs">
                  <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-[11px] font-sans text-slate-500 dark:text-slate-400 block">
                      {tr('مبيعات النقد (كاش)', 'Cash Sales', 'نقد فروخت')}
                    </span>
                    <span className="text-base font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                      {formatCurrency(activeClosing.cashSales, currentOrg?.currency || 'SAR', language)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-[11px] font-sans text-slate-500 dark:text-slate-400 block">
                      {tr('مبيعات الشبكة (مدى)', 'POS Card Sales', 'کارڈ فروخت')}
                    </span>
                    <span className="text-base font-bold text-sky-600 dark:text-sky-400">
                      {formatCurrency(activeClosing.cardSales, currentOrg?.currency || 'SAR', language)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
                    <span className="text-[11px] font-sans text-slate-500 dark:text-slate-400 block">
                      {tr('المشتريات والمصروفات', 'Purchases & Expenses', 'خریداری اور اخراجات')}
                    </span>
                    <span className="text-base font-bold text-rose-500 dark:text-rose-400">
                      {formatCurrency(activeClosing.expenses, currentOrg?.currency || 'SAR', language)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#1764FF]/8 border border-[#1764FF]/25">
                    <span className="text-[11px] font-sans text-[#1764FF] dark:text-[#6CA2FF] font-bold block">
                      {tr('إجمالي المبيعات (نقد + شبكة)', 'Total Sales (Cash + Card)', 'کل فروخت (نقد + کارڈ)')}
                    </span>
                    <span className="text-base font-extrabold text-[#0B1B32] dark:text-white">
                      {formatCurrency(activeClosing.totalSales, currentOrg?.currency || 'SAR', language)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/25">
                    <span className="text-[11px] font-sans text-sky-700 dark:text-sky-300 font-bold block">
                      {tr('الباقي بالصندوق (نقد - مشتريات)', 'Remaining Cash (Cash - Purchases)', 'باقی نقد (نقد - خریداری)')}
                    </span>
                    <span className="text-base font-extrabold text-[#0B1B32] dark:text-white">
                      {formatCurrency(activeClosing.remainingInBox, currentOrg?.currency || 'SAR', language)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#08C99B]/10 border border-[#08C99B]/30">
                    <span className="text-[11px] font-sans text-[#048264] dark:text-[#08C99B] font-bold block">
                      {tr('صافي الفترة (مبيعات - مشتريات)', 'Net Period (Sales - Purchases)', 'خالص مدت (فروخت - خریداری)')}
                    </span>
                    <span className="text-base font-extrabold text-[#0B1B32] dark:text-white">
                      {formatCurrency(activeClosing.netPeriod, currentOrg?.currency || 'SAR', language)}
                    </span>
                  </div>
                </div>
              )}

              {/* Cashier Notes */}
              {activeClosing.notes && (
                <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs">
                  <span className="text-slate-500 dark:text-slate-400 block mb-1 font-semibold">
                    {tr('ملاحظات مسجل الإقفال:', 'Submitter notes:', 'درج کنندہ کے نوٹس:')}
                  </span>
                  <p className="text-slate-700 dark:text-slate-200">{activeClosing.notes}</p>
                </div>
              )}

              {/* Rejection Input Section */}
              {isRejecting && (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-3">
                  <label className="block text-xs font-bold text-rose-600 dark:text-rose-400">
                    {tr('سبب إرجاع الإقفال للموظف (مطلوب) *', 'Reason for returning closing to employee (Required) *', 'ملازم کو کلوزنگ واپس کرنے کی وجہ (لازمی) *')}
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder={tr(
                      'مثال: يرجى مراجعة إيصال مصروفات البنزين، المبلغ غير متطابق...',
                      'Example: Please review the fuel expense receipt, amount does not match...',
                      'مثال: براہ کرم ایندھن کے اخراجات کی رسید چیک کریں، رقم مطابقت نہیں رکھتی...'
                    )}
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white focus:border-rose-500 outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleReject}
                      disabled={reviewLoading}
                      className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 transition-colors disabled:opacity-50"
                    >
                      {reviewLoading
                        ? tr('جاري الإرجاع...', 'Returning...', 'واپس کیا جا رہا ہے...')
                        : tr('تأكيد الإرجاع للموظف', 'Confirm Return to Employee', 'ملازم کو واپسی کی تصدیق کریں')}
                    </button>
                    <button
                      onClick={() => setIsRejecting(false)}
                      className="px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#173056]"
                    >
                      {tr('إلغاء', 'Cancel', 'منسوخ کریں')}
                    </button>
                  </div>
                </div>
              )}

              {/* Action Buttons ONLY for Pending Review Closings with Approval Permission */}
              {canApproveClosings && activeClosing.status === 'pending_review' && !isRejecting && !isCorrecting && (
                <div className="pt-3 border-t border-[#E6EEFC] dark:border-[#1F3B66] flex items-center justify-between gap-3">
                  <button
                    onClick={() => setIsRejecting(true)}
                    disabled={reviewLoading}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>{tr('إعادة للتعديل', 'Return for Edits', 'ترمیم کے لیے واپس کریں')}</span>
                  </button>

                  <button
                    onClick={handleApprove}
                    disabled={reviewLoading}
                    className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-[#1764FF] hover:bg-[#1052D8] shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>
                      {reviewLoading
                        ? tr('جاري الاعتماد...', 'Approving...', 'منظور کیا جا رہا ہے...')
                        : tr('اعتماد الإقفال رسمياً', 'Formally Approve Closing', 'کلوزنگ کی باضابطہ منظوری دیں')}
                    </span>
                  </button>
                </div>
              )}

              {(activeClosing.status === 'draft' || activeClosing.status === 'rejected') && (
                <div className="p-3.5 rounded-xl bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-[#1764FF] dark:text-[#6CA2FF] shrink-0" />
                  <span>
                    {activeClosing.status === 'draft'
                      ? tr(
                          'هذا الإقفال ما زال مسودة لدى الموظف ولم يُرفع للمراجعة بعد؛ لذلك لا يمكن اعتماده أو إرجاعه قبل إرساله للاعتماد.',
                          'This closing is still a draft with the employee and has not been submitted yet; it cannot be approved or returned until submitted.',
                          'یہ کلوزنگ ابھی ملازم کے پاس مسودہ ہے اور جائزے کے لیے جمع نہیں کرائی گئی؛ جمع کرانے سے پہلے اسے منظور یا واپس نہیں کیا جا سکتا۔'
                        )
                      : tr(
                          'هذا الإقفال مُعاد حالياً للموظف للتعديل؛ وبانتظار إعادة إرساله للمراجعة قبل التمكن من اعتماده.',
                          'This closing is currently returned to the employee for edits; awaiting resubmission before approval.',
                          'یہ کلوزنگ فی الحال ترمیم کے لیے ملازم کو واپس کی گئی ہے؛ منظوری سے پہلے دوبارہ جمع کرانے کا انتظار ہے۔'
                        )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
