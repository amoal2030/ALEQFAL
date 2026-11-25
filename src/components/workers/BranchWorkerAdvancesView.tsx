import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Lock,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import type { PayrollPaymentMethod, Worker, WorkerAdvance } from '../../types/workersPayroll';
import { resolveWorkersPayrollAccess } from '../../utils/workersPayrollEngine';
import {
  buildPendingProofAttachmentRef,
  fetchBranchActiveWorkers,
  fetchBranchWorkerAdvances,
  FIRESTORE_RULES_PENDING_MESSAGE_AR,
  formatWorkersPayrollServiceError,
  isFirestoreRulesPermissionDenied,
  recordWorkerAdvance,
} from '../../services/workersPayrollService';
import { formatCurrency } from '../../utils/accounting';
import {
  formatFileSizeShort,
  generateClientRequestKey,
  getPaymentMethodLabel,
  getProofSyncStatusLabel,
  getTodayIsoDate,
  validatePayrollProofFile,
} from './payrollUiHelpers';

export const BranchWorkerAdvancesView: React.FC = () => {
  const { userProfile, currentOrg, branches, currentBranch } = useAuth();
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const currency = currentOrg?.currency || 'SAR';
  const fmt = (amount: number) => formatCurrency(amount, currency);

  const access = useMemo(() => resolveWorkersPayrollAccess(userProfile), [userProfile]);
  const assignedBranch = useMemo(() => {
    if (access.restrictedBranchId) {
      return branches.find((b) => b.id === access.restrictedBranchId) || currentBranch || null;
    }
    return currentBranch || branches[0] || null;
  }, [access.restrictedBranchId, branches, currentBranch]);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [advances, setAdvances] = useState<WorkerAdvance[]>([]);
  const [loading, setLoading] = useState(false);
  const [rulesBlocked, setRulesBlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state
  const [workerSearch, setWorkerSearch] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayIsoDate());
  const [paymentMethod, setPaymentMethod] = useState<PayrollPaymentMethod>('cash');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadBranchData = useCallback(async () => {
    if (!userProfile || !currentOrg || !assignedBranch || !access.canRecordBranchAdvance) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [branchWorkers, branchAdvances] = await Promise.all([
        fetchBranchActiveWorkers({
          actor: userProfile,
          orgId: currentOrg.id,
          branchId: assignedBranch.id,
        }),
        fetchBranchWorkerAdvances({
          actor: userProfile,
          orgId: currentOrg.id,
          branchId: assignedBranch.id,
        }),
      ]);
      setWorkers(branchWorkers);
      setAdvances(branchAdvances);
      setRulesBlocked(false);
    } catch (err) {
      if (isFirestoreRulesPermissionDenied(err)) {
        setRulesBlocked(true);
      } else {
        setErrorMsg(formatWorkersPayrollServiceError(err));
      }
    } finally {
      setLoading(false);
    }
  }, [userProfile, currentOrg, assignedBranch, access.canRecordBranchAdvance]);

  useEffect(() => {
    void loadBranchData();
  }, [loadBranchData]);

  const filteredWorkers = useMemo(() => {
    const q = workerSearch.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter(
      (w) =>
        w.fullName.toLowerCase().includes(q) ||
        w.employeeNumber.toLowerCase().includes(q)
    );
  }, [workers, workerSearch]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] || null;
    if (!picked) {
      setProofFile(null);
      return;
    }
    const validation = validatePayrollProofFile(picked, isAr);
    if (!validation.valid) {
      setErrorMsg(validation.message);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setErrorMsg(null);
    setProofFile(picked);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !currentOrg || !assignedBranch) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedWorkerId) {
      setErrorMsg(isAr ? 'يرجى اختيار العامل أولاً.' : 'Please select an active worker first.');
      return;
    }

    setSubmitting(true);
    try {
      const proofAttachment = proofFile
        ? buildPendingProofAttachmentRef({
            fileName: proofFile.name,
            mimeType: proofFile.type,
            fileSize: proofFile.size,
            clientUploadKey: generateClientRequestKey('adv_proof'),
            syncStatus: 'pending_drive_sync',
          })
        : null;

      const created = await recordWorkerAdvance({
        actor: userProfile,
        workerId: selectedWorkerId,
        branch: assignedBranch,
        input: {
          amount,
          date,
          paymentMethod,
          reason,
          notes,
          proofAttachment,
        },
      });

      setAdvances((prev) => [created, ...prev]);
      setAmount('');
      setReason('');
      setNotes('');
      setProofFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSuccessMsg(
        proofAttachment
          ? isAr
            ? `تم تسجيل السحبية للعامل ${created.workerNameSnapshot} بنجاح، وتم حفظ بيانات الإثبات بانتظار المزامنة من حساب Google Drive الخاص بمالك المؤسسة.`
            : `Advance recorded for ${created.workerNameSnapshot}. Proof metadata is queued for centralized Google Drive sync by the organization owner.`
          : isAr
          ? `تم تسجيل السحبية بقيمة ${fmt(created.amount)} للعامل ${created.workerNameSnapshot} بنجاح.`
          : `Advance of ${fmt(created.amount)} recorded for ${created.workerNameSnapshot}.`
      );
    } catch (err) {
      if (isFirestoreRulesPermissionDenied(err)) {
        setRulesBlocked(true);
      }
      setErrorMsg(formatWorkersPayrollServiceError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!access.canRecordBranchAdvance || !assignedBranch) {
    return (
      <div className="p-6 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-center space-y-2">
        <Lock className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="text-base font-bold text-[#0B1B32] dark:text-white">
          {isAr ? 'الوصول غير متاح لهذا الحساب' : 'Access Restricted'}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          {isAr
            ? 'تسجيل سُلف وسحبيات العمال متاح فقط لمسؤول الفرع المعين على فرع واحد نشط أو لمدير المؤسسة.'
            : 'Recording worker advances is restricted to an active single-branch manager or the organization manager.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1B32] dark:text-white">
            {isAr ? 'سُلف وسحبيات العمال' : 'Worker Advances & Withdrawals'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200">
              <Building2 className="w-3.5 h-3.5 text-[#1764FF]" />
              {assignedBranch.name}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {isAr
                ? 'يعرض العمال النشطين في هذا الفرع فقط — التعديل أو الإلغاء بعد التسجيل محصور بمدير المؤسسة'
                : 'Active workers in your assigned branch only — editing or cancelling after recording is restricted to the Organization Manager'}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadBranchData()}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#0E203A] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#142B4F] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {isAr ? 'تحديث القائمة' : 'Refresh'}
        </button>
      </div>

      {/* Honest Firestore Rules Notice */}
      {rulesBlocked && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/35 flex items-start gap-3 text-xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-amber-900 dark:text-amber-200">
              {isAr ? 'بانتظار تفعيل قواعد Firestore الخاصة بوحدة العمال والرواتب' : 'Pending Firestore Security Rules Activation'}
            </p>
            <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
              {isAr
                ? FIRESTORE_RULES_PENDING_MESSAGE_AR
                : 'Current deployed Firestore rules do not yet authorize reads/writes to Workers & Payroll collections. Cloud persistence will become active once the dedicated rules are approved and deployed.'}
            </p>
          </div>
        </div>
      )}

      {errorMsg && !rulesBlocked && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/35 flex items-start justify-between gap-3 text-xs text-rose-800 dark:text-rose-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/35 flex items-start justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-200">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Record New Advance Form */}
      <form
        onSubmit={handleSubmit}
        className="p-5 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] space-y-4"
      >
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E6EEFC] dark:border-[#1B345B]">
          <h2 className="text-sm font-bold text-[#0B1B32] dark:text-white inline-flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[#1764FF]" />
            {isAr ? 'تسجيل سحبية أو سُلفة جديدة' : 'Record New Worker Advance'}
          </h2>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {isAr ? 'يُتحقق تلقائياً من تبعية العامل للفرع وحالته النشطة' : 'Server-verified active branch membership'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Worker Picker */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
              {isAr ? 'العامل النشط في الفرع *' : 'Active Branch Worker *'}
            </label>
            <div className="relative mb-1.5">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                placeholder={isAr ? 'بحث بالاسم أو الرقم الوظيفي...' : 'Search by name or employee #...'}
                className="w-full ps-8 pe-3 py-1.5 rounded-lg bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF]"
              />
            </div>
            <select
              required
              value={selectedWorkerId}
              onChange={(e) => setSelectedWorkerId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-medium text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF]"
            >
              <option value="">
                {filteredWorkers.length === 0
                  ? isAr
                    ? 'لا يوجد عمال نشطون مطابقون في هذا الفرع'
                    : 'No matching active workers in this branch'
                  : isAr
                  ? '-- اختر العامل --'
                  : '-- Select Worker --'}
              </option>
              {filteredWorkers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.fullName} ({w.employeeNumber})
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
              {isAr ? `المبلغ (${currency}) *` : `Amount (${currency}) *`}
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-bold tabular-nums text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF]"
            />
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
              {isAr ? 'التاريخ *' : 'Date *'}
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs tabular-nums text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF]"
            />
          </div>

          {/* Payment Method */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
              {isAr ? 'طريقة التسليم *' : 'Payment Method *'}
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PayrollPaymentMethod)}
              className="w-full px-3 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF]"
            >
              <option value="cash">{isAr ? 'نقدي' : 'Cash'}</option>
              <option value="bank_transfer">{isAr ? 'تحويل بنكي' : 'Bank Transfer'}</option>
            </select>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
              {isAr ? 'سبب السحبية *' : 'Reason *'}
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isAr ? 'مثال: سلفة طارئة، مصروف شخصي...' : 'e.g., Emergency advance...'}
              className="w-full px-3 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF]"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
              {isAr ? 'ملاحظات (اختياري)' : 'Notes (optional)'}
            </label>
            <input
              type="text"
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isAr ? 'أي تفاصيل إضافية...' : 'Any additional details...'}
              className="w-full px-3 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF]"
            />
          </div>
        </div>

        {/* Optional Receipt Proof (Metadata queued — NEVER prompts Branch Manager for personal Drive OAuth) */}
        <div className="p-3.5 rounded-xl bg-[#F8FAFF] dark:bg-[#0B192E] border border-[#E6EEFC] dark:border-[#1B345B] flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 text-xs">
            <p className="font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-[#1764FF]" />
              {isAr ? 'إرفاق إيصال أو إثبات تسليم (اختياري)' : 'Attach Receipt Proof (optional)'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isAr
                ? 'لا يُطلب من مسؤول الفرع ربط Google Drive شخصي؛ تُحفظ بيانات الإثبات بحالة «بانتظار الرفع» ليقوم مالك المؤسسة بأرشفتها مركزياً في Google Drive المؤسسة.'
                : 'Branch Managers are never asked to connect personal Google Drive; proof metadata is saved as Pending Sync for centralized archiving by the organization owner.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="text-xs text-slate-600 dark:text-slate-300 max-w-[220px]"
            />
            {proofFile && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {formatFileSizeShort(proofFile.size)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end pt-1">
          <button
            type="submit"
            disabled={submitting || !selectedWorkerId}
            className="px-5 py-2.5 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            {submitting
              ? isAr
                ? 'جارٍ التسجيل...'
                : 'Recording...'
              : isAr
              ? 'تسجيل السحبية'
              : 'Record Advance'}
          </button>
        </div>
      </form>

      {/* Recorded Branch Advances Table (Strictly Read-Only — NO Edit/Delete/Cancel for Branch Manager) */}
      <div className="rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E6EEFC] dark:border-[#1B345B] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[#0B1B32] dark:text-white">
            {isAr ? `السحبيات المسجلة في فرع ${assignedBranch.name}` : `Recorded Advances — ${assignedBranch.name}`}
          </h2>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
            <Lock className="w-3 h-3" />
            {isAr ? 'سجل محمي للقراءة فقط بعد التسجيل' : 'Read-only log after submission'}
          </span>
        </div>

        {advances.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            {loading
              ? isAr
                ? 'جارٍ تحميل السحبيات...'
                : 'Loading advances...'
              : isAr
              ? 'لا توجد سحبيات مسجلة في هذا الفرع حتى الآن.'
              : 'No advances recorded in this branch yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="py-2.5 px-4 text-start font-semibold">{isAr ? 'التاريخ' : 'Date'}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{isAr ? 'العامل' : 'Worker'}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{isAr ? 'المبلغ' : 'Amount'}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{isAr ? 'الطريقة' : 'Method'}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{isAr ? 'السبب' : 'Reason'}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{isAr ? 'الإثبات' : 'Proof'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                {advances.map((adv) => (
                  <tr key={adv.id} className={adv.status === 'cancelled' ? 'opacity-60' : ''}>
                    <td className="py-3 px-4 tabular-nums whitespace-nowrap">{adv.date}</td>
                    <td className="py-3 px-4 font-semibold text-[#0B1B32] dark:text-white">
                      {adv.workerNameSnapshot}
                      {adv.workerEmployeeNumberSnapshot && (
                        <span className="block text-[11px] font-normal text-slate-500 tabular-nums">
                          #{adv.workerEmployeeNumberSnapshot}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-bold tabular-nums">{fmt(adv.amount)}</td>
                    <td className="py-3 px-4">{getPaymentMethodLabel(adv.paymentMethod, isAr)}</td>
                    <td className="py-3 px-4 max-w-xs">{adv.reason}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {adv.status === 'cancelled' ? (
                        <span className="text-rose-600 dark:text-rose-400 font-semibold">
                          {isAr ? 'ملغاة من الإدارة' : 'Cancelled by Admin'}
                        </span>
                      ) : adv.payrollSettledYearMonth ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                          {isAr ? `مسوّاة (${adv.payrollSettledYearMonth})` : `Settled (${adv.payrollSettledYearMonth})`}
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400 font-semibold">
                          {isAr ? 'مسجلة' : 'Recorded'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[11px] text-slate-500 dark:text-slate-400">
                      {adv.proofAttachment
                        ? `${adv.proofAttachment.fileName} · ${getProofSyncStatusLabel(
                            adv.proofAttachment.syncStatus,
                            isAr
                          )}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
