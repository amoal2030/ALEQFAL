import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  Award,
  Ban,
  Calculator,
  CheckCircle2,
  CreditCard,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  Lock,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import type {
  PayrollAuditLog,
  PayrollDisbursementStatus,
  PayrollItem,
  PayrollPayment,
  PayrollPaymentMethod,
  PayrollRun,
  Worker,
  WorkerAddition,
  WorkerAdditionCategory,
  WorkerAdditionRecurrence,
  WorkerAdvance,
  WorkerStatus,
} from '../../types/workersPayroll';
import {
  assertUniqueEmployeeNumber,
  resolveWorkersPayrollAccess,
} from '../../utils/workersPayrollEngine';
import {
  adminCorrectApprovedPayrollItem,
  approveMonthlyPayrollRun,
  buildPendingProofAttachmentRef,
  cancelWorkerAdvance,
  changeWorkerAdditionStatus,
  createWorker,
  createWorkerAddition,
  downloadPayrollProofFromDrive,
  editWorkerAdvance,
  fetchOrgPayrollAuditLogs,
  fetchOrgPayrollItems,
  fetchOrgPayrollPayments,
  fetchOrgPayrollRuns,
  fetchOrgWorkerAdditions,
  fetchOrgWorkerAdvances,
  fetchOrgWorkers,
  FIRESTORE_RULES_PENDING_MESSAGE_AR,
  formatWorkersPayrollServiceError,
  generateDraftMonthlyPayrollRun,
  isFirestoreRulesPermissionDenied,
  recordPayrollPayment,
  recordWorkerAdvance,
  reversePayrollPayment,
  syncPayrollPaymentProofToDrive,
  syncWorkerAdvanceProofToDrive,
  transferWorkerBranch,
  trashPayrollPaymentProofSafely,
  trashWorkerAdvanceProofSafely,
  updateWorkerAddition,
  updateWorkerDetails,
  updateWorkerStatus,
} from '../../services/workersPayrollService';
import {
  buildMonthlyPayrollReportWorkbook,
  computeWorkersPayrollSummaryReport,
} from '../../services/workersPayrollReportService';
import { downloadXlsxBytes } from '../../services/excelReportService';
import { getActiveDriveSession } from '../../services/driveService';
import { formatCurrency } from '../../utils/accounting';
import { WorkerFinancialProfileModal } from './WorkerFinancialProfileModal';
import {
  formatFileSizeShort,
  generateClientRequestKey,
  getAdditionCategoryLabel,
  getAdditionStatusLabel,
  getCurrentYearMonth,
  getDisbursementStatusLabel,
  getPaymentMethodLabel,
  getProofSyncStatusLabel,
  getTodayIsoDate,
  getWorkerStatusLabel,
  triggerBlobFileDownload,
  validatePayrollProofFile,
} from './payrollUiHelpers';

type HubSubTab =
  | 'workers'
  | 'advances'
  | 'additions'
  | 'settlement'
  | 'disbursement'
  | 'reports';

const ADDITION_CATEGORIES: WorkerAdditionCategory[] = [
  'performance_bonus',
  'exceptional_bonus',
  'transport_allowance',
  'housing_allowance',
  'extra_allowance',
  'custom',
];

export const WorkersPayrollHub: React.FC = () => {
  const { userProfile, currentOrg, branches } = useAuth();
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const currency = currentOrg?.currency || 'SAR';
  const fmt = (amount: number) => formatCurrency(amount, currency);

  const access = useMemo(() => resolveWorkersPayrollAccess(userProfile), [userProfile]);
  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);

  const [subTab, setSubTab] = useState<HubSubTab>('workers');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [rulesBlocked, setRulesBlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Domain datasets loaded from server-authoritative Firestore reads
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [advances, setAdvances] = useState<WorkerAdvance[]>([]);
  const [additions, setAdditions] = useState<WorkerAddition[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [payrollItems, setPayrollItems] = useState<PayrollItem[]>([]);
  const [payrollPayments, setPayrollPayments] = useState<PayrollPayment[]>([]);
  const [auditLogs, setAuditLogs] = useState<PayrollAuditLog[]>([]);

  // Filters
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerBranchFilter, setWorkerBranchFilter] = useState('all');
  const [workerStatusFilter, setWorkerStatusFilter] = useState<'all' | WorkerStatus>('all');
  const [advBranchFilter, setAdvBranchFilter] = useState('all');
  const [advWorkerFilter, setAdvWorkerFilter] = useState('all');
  const [advStatusFilter, setAdvStatusFilter] = useState<'all' | 'active' | 'cancelled'>('all');
  const [selectedYearMonth, setSelectedYearMonth] = useState(getCurrentYearMonth());
  const [disbursementBranchFilter, setDisbursementBranchFilter] = useState('all');
  const [disbursementStatusFilter, setDisbursementStatusFilter] = useState<
    'all' | PayrollDisbursementStatus
  >('all');
  const [reportBranchFilter, setReportBranchFilter] = useState('all');

  // Modals state
  const [profileWorker, setProfileWorker] = useState<Worker | null>(null);
  const [workerModalMode, setWorkerModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [wName, setWName] = useState('');
  const [wEmpNo, setWEmpNo] = useState('');
  const [wPhone, setWPhone] = useState('');
  const [wSalary, setWSalary] = useState('');
  const [wBranchId, setWBranchId] = useState('');
  const [wHireDate, setWHireDate] = useState(getTodayIsoDate());
  const [wNotes, setWNotes] = useState('');

  const [transferTargetWorker, setTransferTargetWorker] = useState<Worker | null>(null);
  const [transferBranchId, setTransferBranchId] = useState('');
  const [transferReason, setTransferReason] = useState('');

  const [statusTargetWorker, setStatusTargetWorker] = useState<Worker | null>(null);
  const [nextWorkerStatus, setNextWorkerStatus] = useState<WorkerStatus>('suspended');
  const [statusReason, setStatusReason] = useState('');
  const [terminationDate, setTerminationDate] = useState(getTodayIsoDate());

  // Advance modals
  const [showCreateAdvanceModal, setShowCreateAdvanceModal] = useState(false);
  const [advFormWorkerId, setAdvFormWorkerId] = useState('');
  const [advFormAmount, setAdvFormAmount] = useState('');
  const [advFormDate, setAdvFormDate] = useState(getTodayIsoDate());
  const [advFormMethod, setAdvFormMethod] = useState<PayrollPaymentMethod>('cash');
  const [advFormReason, setAdvFormReason] = useState('');
  const [advFormNotes, setAdvFormNotes] = useState('');
  const [advFormFile, setAdvFormFile] = useState<File | null>(null);

  const [editingAdvance, setEditingAdvance] = useState<WorkerAdvance | null>(null);
  const [editAdvAmount, setEditAdvAmount] = useState('');
  const [editAdvDate, setEditAdvDate] = useState('');
  const [editAdvMethod, setEditAdvMethod] = useState<PayrollPaymentMethod>('cash');
  const [editAdvReason, setEditAdvReason] = useState('');
  const [editAdvAuditReason, setEditAdvAuditReason] = useState('');

  const [cancellingAdvance, setCancellingAdvance] = useState<WorkerAdvance | null>(null);
  const [cancelAdvReason, setCancelAdvReason] = useState('');

  // Proof retry & safe trash modals
  const [retryProofTarget, setRetryProofTarget] = useState<
    | { kind: 'advance'; record: WorkerAdvance }
    | { kind: 'payment'; record: PayrollPayment }
    | null
  >(null);
  const [retryProofFile, setRetryProofFile] = useState<File | null>(null);
  const retryFileInputRef = useRef<HTMLInputElement | null>(null);

  const [trashProofTarget, setTrashProofTarget] = useState<
    | { kind: 'advance'; record: WorkerAdvance }
    | { kind: 'payment'; record: PayrollPayment }
    | null
  >(null);
  const [trashProofReason, setTrashProofReason] = useState('');

  // Addition modals
  const [additionModalMode, setAdditionModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingAddition, setEditingAddition] = useState<WorkerAddition | null>(null);
  const [addWorkerId, setAddWorkerId] = useState('');
  const [addCategory, setAddCategory] = useState<WorkerAdditionCategory>('performance_bonus');
  const [addCustomLabel, setAddCustomLabel] = useState('');
  const [addRecurrence, setAddRecurrence] = useState<WorkerAdditionRecurrence>('one_time');
  const [addAmount, setAddAmount] = useState('');
  const [addTargetMonth, setAddTargetMonth] = useState(getCurrentYearMonth());
  const [addStartMonth, setAddStartMonth] = useState(getCurrentYearMonth());
  const [addEndMonth, setAddEndMonth] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [addEditReason, setAddEditReason] = useState('');

  const [stopAdditionTarget, setStopAdditionTarget] = useState<WorkerAddition | null>(null);
  const [stopAdditionAction, setStopAdditionAction] = useState<'stopped' | 'cancelled'>('stopped');
  const [stopAdditionEndMonth, setStopAdditionEndMonth] = useState(getCurrentYearMonth());
  const [stopAdditionReason, setStopAdditionReason] = useState('');

  // Settlement approval & correction modals
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [correctingItem, setCorrectingItem] = useState<PayrollItem | null>(null);
  const [corrBase, setCorrBase] = useState('');
  const [corrAdditions, setCorrAdditions] = useState('');
  const [corrAdvances, setCorrAdvances] = useState('');
  const [corrCarryIn, setCorrCarryIn] = useState('');
  const [corrReason, setCorrReason] = useState('');

  // Disbursement payment & reversal modals
  const [payingItem, setPayingItem] = useState<PayrollItem | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(getTodayIsoDate());
  const [payMethod, setPayMethod] = useState<PayrollPaymentMethod>('bank_transfer');
  const [payNotes, setPayNotes] = useState('');
  const [payProofFile, setPayProofFile] = useState<File | null>(null);
  const [payRequestKey, setPayRequestKey] = useState('');

  const [reversingPayment, setReversingPayment] = useState<PayrollPayment | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const loadAllOrgData = useCallback(async () => {
    if (!userProfile || !currentOrg || !access.canManageWorkers) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [
        fetchedWorkers,
        fetchedAdvances,
        fetchedAdditions,
        fetchedRuns,
        fetchedItems,
        fetchedPayments,
        fetchedLogs,
      ] = await Promise.all([
        fetchOrgWorkers({ actor: userProfile, orgId: currentOrg.id }),
        fetchOrgWorkerAdvances({ actor: userProfile, orgId: currentOrg.id }),
        fetchOrgWorkerAdditions({ actor: userProfile, orgId: currentOrg.id }),
        fetchOrgPayrollRuns({ actor: userProfile, orgId: currentOrg.id }),
        fetchOrgPayrollItems({ actor: userProfile, orgId: currentOrg.id }),
        fetchOrgPayrollPayments({ actor: userProfile, orgId: currentOrg.id }),
        fetchOrgPayrollAuditLogs({ actor: userProfile, orgId: currentOrg.id }),
      ]);
      setWorkers(fetchedWorkers);
      setAdvances(fetchedAdvances);
      setAdditions(fetchedAdditions);
      setPayrollRuns(fetchedRuns);
      setPayrollItems(fetchedItems);
      setPayrollPayments(fetchedPayments);
      setAuditLogs(fetchedLogs);
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
  }, [userProfile, currentOrg, access.canManageWorkers]);

  useEffect(() => {
    void loadAllOrgData();
  }, [loadAllOrgData]);

  const handleServiceError = (err: unknown) => {
    if (isFirestoreRulesPermissionDenied(err)) {
      setRulesBlocked(true);
    }
    setErrorMsg(formatWorkersPayrollServiceError(err));
  };

  // Derived views
  const filteredWorkers = useMemo(() => {
    const q = workerSearch.trim().toLowerCase();
    return workers.filter((w) => {
      if (workerBranchFilter !== 'all' && w.currentBranchId !== workerBranchFilter) return false;
      if (workerStatusFilter !== 'all' && w.status !== workerStatusFilter) return false;
      if (
        q &&
        !w.fullName.toLowerCase().includes(q) &&
        !w.employeeNumber.toLowerCase().includes(q) &&
        !(w.phone || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [workers, workerSearch, workerBranchFilter, workerStatusFilter]);

  const filteredAdvances = useMemo(() => {
    return advances.filter((a) => {
      if (advBranchFilter !== 'all' && a.branchId !== advBranchFilter) return false;
      if (advWorkerFilter !== 'all' && a.workerId !== advWorkerFilter) return false;
      if (advStatusFilter !== 'all' && a.status !== advStatusFilter) return false;
      return true;
    });
  }, [advances, advBranchFilter, advWorkerFilter, advStatusFilter]);

  const currentRun = useMemo(
    () => payrollRuns.find((r) => r.yearMonth === selectedYearMonth) || null,
    [payrollRuns, selectedYearMonth]
  );

  const currentMonthItems = useMemo(
    () => payrollItems.filter((i) => i.yearMonth === selectedYearMonth),
    [payrollItems, selectedYearMonth]
  );

  const approvedMonthItems = useMemo(
    () =>
      currentMonthItems.filter((i) => {
        if (i.status !== 'approved') return false;
        if (disbursementBranchFilter !== 'all' && i.branchIdSnapshot !== disbursementBranchFilter) {
          return false;
        }
        if (
          disbursementStatusFilter !== 'all' &&
          i.disbursementStatus !== disbursementStatusFilter
        ) {
          return false;
        }
        return true;
      }),
    [currentMonthItems, disbursementBranchFilter, disbursementStatusFilter]
  );

  const currentMonthPayments = useMemo(
    () => payrollPayments.filter((p) => p.yearMonth === selectedYearMonth),
    [payrollPayments, selectedYearMonth]
  );

  const summaryReport = useMemo(() => {
    if (!currentOrg || !userProfile || !access.canViewPayrollReports) return null;
    const scopedBranches =
      reportBranchFilter === 'all'
        ? branches
        : branches.filter((b) => b.id === reportBranchFilter);
    const scopedWorkers =
      reportBranchFilter === 'all'
        ? workers
        : workers.filter((w) => w.currentBranchId === reportBranchFilter);
    const scopedAdvances =
      reportBranchFilter === 'all'
        ? advances
        : advances.filter((a) => a.branchId === reportBranchFilter);
    const scopedItems =
      reportBranchFilter === 'all'
        ? payrollItems
        : payrollItems.filter((i) => i.branchIdSnapshot === reportBranchFilter);
    return computeWorkersPayrollSummaryReport({
      actor: userProfile,
      orgId: currentOrg.id,
      yearMonth: selectedYearMonth,
      branches: scopedBranches,
      workers: scopedWorkers,
      advances: scopedAdvances,
      payrollItems: scopedItems,
    });
  }, [
    currentOrg,
    userProfile,
    access.canViewPayrollReports,
    selectedYearMonth,
    branches,
    workers,
    advances,
    payrollItems,
    reportBranchFilter,
  ]);

  // Helper to get active owner Drive token safely (never prompts branch manager or expands OAuth)
  const getOwnerDriveToken = (): string | null => {
    if (!currentOrg) return null;
    const session = getActiveDriveSession(currentOrg.id);
    return session?.accessToken || null;
  };

  // ===================== Worker CRUD Handlers =====================
  const openCreateWorkerModal = () => {
    setWorkerModalMode('create');
    setEditingWorker(null);
    setWName('');
    setWEmpNo('');
    setWPhone('');
    setWSalary('');
    setWBranchId(activeBranches[0]?.id || '');
    setWHireDate(getTodayIsoDate());
    setWNotes('');
    setErrorMsg(null);
  };

  const openEditWorkerModal = (worker: Worker) => {
    setWorkerModalMode('edit');
    setEditingWorker(worker);
    setWName(worker.fullName);
    setWEmpNo(worker.employeeNumber);
    setWPhone(worker.phone || '');
    setWSalary(String(worker.monthlySalary));
    setWBranchId(worker.currentBranchId);
    setWHireDate(worker.hireDate);
    setWNotes(worker.notes || '');
    setErrorMsg(null);
  };

  const handleSaveWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !currentOrg) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusyAction(true);
    try {
      // Immediate local uniqueness check before hitting network
      assertUniqueEmployeeNumber({
        employeeNumber: wEmpNo,
        orgId: currentOrg.id,
        existingWorkers: workers,
        excludeWorkerId: editingWorker?.id,
      });

      if (workerModalMode === 'create') {
        const branch = activeBranches.find((b) => b.id === wBranchId);
        if (!branch) {
          throw new Error(isAr ? 'يرجى اختيار فرع نشط للعامل.' : 'Please select an active branch.');
        }
        await createWorker({
          actor: userProfile,
          orgId: currentOrg.id,
          branch,
          input: {
            fullName: wName,
            employeeNumber: wEmpNo,
            phone: wPhone,
            branchId: branch.id,
            monthlySalary: wSalary,
            hireDate: wHireDate,
            notes: wNotes,
          },
        });
        setSuccessMsg(isAr ? `تمت إضافة العامل "${wName.trim()}" بنجاح.` : `Worker "${wName.trim()}" created.`);
      } else if (workerModalMode === 'edit' && editingWorker) {
        await updateWorkerDetails({
          actor: userProfile,
          workerId: editingWorker.id,
          updates: {
            fullName: wName,
            employeeNumber: wEmpNo,
            phone: wPhone,
            monthlySalary: wSalary,
            hireDate: wHireDate,
            notes: wNotes,
          },
        });
        setSuccessMsg(
          isAr
            ? `تم تحديث بيانات العامل "${wName.trim()}" بنجاح (دون تعديل كشوف الرواتب التاريخية المعتمدة).`
            : `Worker "${wName.trim()}" updated without altering historical approved payrolls.`
        );
      }
      setWorkerModalMode(null);
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleTransferWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !transferTargetWorker) return;
    const targetBranch = activeBranches.find((b) => b.id === transferBranchId);
    if (!targetBranch) {
      setErrorMsg(isAr ? 'يرجى اختيار الفرع الهدف.' : 'Please choose a destination branch.');
      return;
    }
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await transferWorkerBranch({
        actor: userProfile,
        workerId: transferTargetWorker.id,
        targetBranch,
        reason: transferReason,
      });
      setTransferTargetWorker(null);
      setSuccessMsg(
        isAr
          ? `تم نقل العامل "${transferTargetWorker.fullName}" إلى فرع "${targetBranch.name}" مع الاحتفاظ الكامل بسجلاته التاريخية.`
          : `Transferred "${transferTargetWorker.fullName}" to "${targetBranch.name}" with full history preserved.`
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleChangeWorkerStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !statusTargetWorker) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateWorkerStatus({
        actor: userProfile,
        workerId: statusTargetWorker.id,
        nextStatus: nextWorkerStatus,
        reason: statusReason,
        terminationDate: nextWorkerStatus === 'terminated' ? terminationDate : undefined,
      });
      setStatusTargetWorker(null);
      setSuccessMsg(
        isAr
          ? `تم تحديث حالة العامل "${statusTargetWorker.fullName}" إلى (${getWorkerStatusLabel(
              nextWorkerStatus,
              true
            )}) دون حذف أي سجل مالي.`
          : `Worker status updated to ${getWorkerStatusLabel(nextWorkerStatus, false)} without deleting records.`
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  // ===================== Advances Handlers =====================
  const handleCreateManagerAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !currentOrg) return;
    const worker = workers.find((w) => w.id === advFormWorkerId);
    if (!worker) {
      setErrorMsg(isAr ? 'يرجى اختيار العامل.' : 'Please select a worker.');
      return;
    }
    const branch = branches.find((b) => b.id === worker.currentBranchId);
    if (!branch) {
      setErrorMsg(isAr ? 'فرع العامل غير موجود.' : 'Worker branch not found.');
      return;
    }

    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const pendingProof = advFormFile
        ? buildPendingProofAttachmentRef({
            fileName: advFormFile.name,
            mimeType: advFormFile.type,
            fileSize: advFormFile.size,
            clientUploadKey: generateClientRequestKey('adv_proof'),
            syncStatus: 'pending_drive_sync',
          })
        : null;

      const created = await recordWorkerAdvance({
        actor: userProfile,
        workerId: worker.id,
        branch,
        input: {
          amount: advFormAmount,
          date: advFormDate,
          paymentMethod: advFormMethod,
          reason: advFormReason,
          notes: advFormNotes,
          proofAttachment: pendingProof,
        },
      });

      let driveNote = '';
      if (advFormFile) {
        const token = getOwnerDriveToken();
        if (token) {
          try {
            const bytes = new Uint8Array(await advFormFile.arrayBuffer());
            await syncWorkerAdvanceProofToDrive({
              token,
              actor: userProfile,
              org: currentOrg,
              branch,
              advance: created,
              fileName: advFormFile.name,
              mimeType: advFormFile.type,
              bytes,
            });
            driveNote = isAr
              ? ' وتم رفع الإثبات إلى Google Drive بنجاح.'
              : ' Proof uploaded to Google Drive.';
          } catch {
            driveNote = isAr
              ? ' تم حفظ السحبية بنجاح، ولكن تعذر رفع الإثبات إلى Google Drive ويمكنك إعادة المحاولة لاحقاً دون تكرار.'
              : ' Advance saved, but Drive upload failed — you can retry safely later without duplicates.';
          }
        } else {
          driveNote = isAr
            ? ' تم حفظ السحبية وبيانات الإثبات بحالة «بانتظار الرفع إلى Google Drive» لأن جلسة Google Drive غير نشطة حالياً.'
            : ' Advance saved with proof marked Pending Google Drive Upload because the Drive session is currently inactive.';
        }
      }

      setShowCreateAdvanceModal(false);
      setAdvFormFile(null);
      setSuccessMsg(
        (isAr
          ? `تم تسجيل سحبية بقيمة ${fmt(created.amount)} للعامل ${created.workerNameSnapshot}.`
          : `Advance of ${fmt(created.amount)} recorded for ${created.workerNameSnapshot}.`) +
          driveNote
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveAdvanceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !editingAdvance) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await editWorkerAdvance({
        actor: userProfile,
        advanceId: editingAdvance.id,
        updates: {
          amount: editAdvAmount,
          date: editAdvDate,
          paymentMethod: editAdvMethod,
          reason: editAdvReason,
        },
        auditReason: editAdvAuditReason,
      });
      setEditingAdvance(null);
      setSuccessMsg(isAr ? 'تم تعديل السحبية وتوثيق التغيير في سجل التدقيق.' : 'Advance edited and logged.');
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmCancelAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !cancellingAdvance) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await cancelWorkerAdvance({
        actor: userProfile,
        advanceId: cancellingAdvance.id,
        cancellationReason: cancelAdvReason,
      });
      setCancellingAdvance(null);
      setSuccessMsg(
        isAr
          ? 'تم إلغاء السحبية إدارياً (مع الاحتفاظ بالسجل المالي للتدقيق دون حذف).'
          : 'Advance soft-cancelled and retained for audit.'
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  // ===================== Proof Retry / Download / Safe Trash =====================
  const handleRetryProofUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !currentOrg || !retryProofTarget || !retryProofFile) return;
    const token = getOwnerDriveToken();
    if (!token) {
      setErrorMsg(
        isAr
          ? 'جلسة Google Drive لمالك المؤسسة غير نشطة حالياً؛ يرجى إعادة تفعيل الربط من تبويب الإعدادات ثم إعادة المحاولة.'
          : 'Owner Google Drive session is inactive; please reconnect in Settings and retry.'
      );
      return;
    }

    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const bytes = new Uint8Array(await retryProofFile.arrayBuffer());
      if (retryProofTarget.kind === 'advance') {
        const adv = retryProofTarget.record;
        const branch = branches.find((b) => b.id === adv.branchId);
        if (!branch) throw new Error(isAr ? 'الفرع المرتبط بالسحبية غير موجود.' : 'Branch not found.');
        const res = await syncWorkerAdvanceProofToDrive({
          token,
          actor: userProfile,
          org: currentOrg,
          branch,
          advance: adv,
          fileName: retryProofFile.name,
          mimeType: retryProofFile.type,
          bytes,
        });
        setSuccessMsg(
          res.uploadResult.reusedExisting
            ? isAr
              ? 'تم ربط الإثبات الموجود مسبقاً في Google Drive دون إنشاء نسخة مكررة.'
              : 'Reused existing proof in Google Drive with zero duplication.'
            : isAr
            ? 'تم رفع إثبات السحبية إلى Google Drive بنجاح.'
            : 'Advance proof uploaded to Google Drive.'
        );
      } else {
        const pay = retryProofTarget.record;
        const branch = branches.find((b) => b.id === pay.branchIdSnapshot);
        if (!branch) throw new Error(isAr ? 'الفرع المرتبط بالدفعة غير موجود.' : 'Branch not found.');
        const res = await syncPayrollPaymentProofToDrive({
          token,
          actor: userProfile,
          org: currentOrg,
          branch,
          payment: pay,
          fileName: retryProofFile.name,
          mimeType: retryProofFile.type,
          bytes,
        });
        setSuccessMsg(
          res.uploadResult.reusedExisting
            ? isAr
              ? 'تم ربط إثبات الصرف الموجود مسبقاً في Google Drive دون تكرار.'
              : 'Reused existing payment proof in Google Drive with zero duplication.'
            : isAr
            ? 'تم رفع إثبات صرف الراتب إلى Google Drive بنجاح.'
            : 'Payment proof uploaded to Google Drive.'
        );
      }
      setRetryProofTarget(null);
      setRetryProofFile(null);
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmTrashProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !currentOrg || !trashProofTarget) return;
    const token = getOwnerDriveToken();
    if (!token) {
      setErrorMsg(
        isAr
          ? 'جلسة Google Drive لمالك المؤسسة غير نشطة حالياً؛ يرجى تفعيلها من الإعدادات لنقل المرفق إلى سلة المهملات.'
          : 'Owner Google Drive session is inactive; reconnect in Settings to move file to Trash.'
      );
      return;
    }

    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      if (trashProofTarget.kind === 'advance') {
        await trashWorkerAdvanceProofSafely({
          token,
          actor: userProfile,
          org: currentOrg,
          advance: trashProofTarget.record,
          confirmed: true,
          reason: trashProofReason,
        });
      } else {
        await trashPayrollPaymentProofSafely({
          token,
          actor: userProfile,
          org: currentOrg,
          payment: trashProofTarget.record,
          confirmed: true,
          reason: trashProofReason,
        });
      }
      setTrashProofTarget(null);
      setTrashProofReason('');
      setSuccessMsg(
        isAr
          ? 'تم نقل الملف المرفق إلى سلة مهملات Google Drive بأمان مع بقاء السجل المالي سليماً بالكامل.'
          : 'Attachment moved to Google Drive Trash safely while keeping the financial record intact.'
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleDownloadDriveProof = async (
    fileId: string,
    expectedRecordId: string,
    fileName: string
  ) => {
    if (!userProfile || !currentOrg) return;
    const token = getOwnerDriveToken();
    if (!token) {
      setErrorMsg(
        isAr
          ? 'جلسة Google Drive لمالك المؤسسة غير نشطة؛ يرجى تفعيلها من الإعدادات لتنزيل الملف.'
          : 'Owner Google Drive session is inactive; reconnect in Settings to download.'
      );
      return;
    }
    setErrorMsg(null);
    try {
      const result = await downloadPayrollProofFromDrive({
        token,
        actor: userProfile,
        org: currentOrg,
        fileId,
        expectedRecordId,
      });
      const blob = new Blob([new Uint8Array(result.bytes)], {
        type: result.metadata.mimeType || 'application/octet-stream',
      });
      triggerBlobFileDownload(blob, result.metadata.fileName || fileName);
    } catch (err) {
      handleServiceError(err);
    }
  };

  // ===================== Additions Handlers =====================
  const openCreateAdditionModal = () => {
    setAdditionModalMode('create');
    setEditingAddition(null);
    setAddWorkerId(workers.find((w) => w.status === 'active')?.id || workers[0]?.id || '');
    setAddCategory('performance_bonus');
    setAddCustomLabel('');
    setAddRecurrence('one_time');
    setAddAmount('');
    setAddTargetMonth(selectedYearMonth);
    setAddStartMonth(selectedYearMonth);
    setAddEndMonth('');
    setAddNotes('');
    setAddEditReason('');
    setErrorMsg(null);
  };

  const openEditAdditionModal = (add: WorkerAddition) => {
    setAdditionModalMode('edit');
    setEditingAddition(add);
    setAddWorkerId(add.workerId);
    setAddCategory(add.category);
    setAddCustomLabel(add.label);
    setAddRecurrence(add.recurrence);
    setAddAmount(String(add.amount));
    setAddTargetMonth(add.targetYearMonth || selectedYearMonth);
    setAddStartMonth(add.startYearMonth || selectedYearMonth);
    setAddEndMonth(add.endYearMonth || '');
    setAddNotes(add.notes || '');
    setAddEditReason('');
    setErrorMsg(null);
  };

  const handleSaveAddition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      if (additionModalMode === 'create') {
        const worker = workers.find((w) => w.id === addWorkerId);
        if (!worker) throw new Error(isAr ? 'يرجى اختيار العامل.' : 'Please select a worker.');
        await createWorkerAddition({
          actor: userProfile,
          worker,
          input: {
            category: addCategory,
            customLabel: addCustomLabel,
            recurrence: addRecurrence,
            amount: addAmount,
            targetYearMonth: addRecurrence === 'one_time' ? addTargetMonth : undefined,
            startYearMonth: addRecurrence === 'monthly_recurring' ? addStartMonth : undefined,
            endYearMonth: addRecurrence === 'monthly_recurring' ? addEndMonth || undefined : undefined,
            notes: addNotes,
          },
        });
        setSuccessMsg(isAr ? 'تمت إضافة المكافأة/البدل بنجاح.' : 'Addition created successfully.');
      } else if (additionModalMode === 'edit' && editingAddition) {
        await updateWorkerAddition({
          actor: userProfile,
          additionId: editingAddition.id,
          updates: {
            category: addCategory,
            label: addCustomLabel,
            amount: addAmount,
            targetYearMonth:
              editingAddition.recurrence === 'one_time' ? addTargetMonth : undefined,
            startYearMonth:
              editingAddition.recurrence === 'monthly_recurring' ? addStartMonth : undefined,
            endYearMonth:
              editingAddition.recurrence === 'monthly_recurring' ? addEndMonth || null : undefined,
            notes: addNotes,
          },
          reason: addEditReason,
        });
        setSuccessMsg(
          isAr
            ? 'تم تعديل الإضافة المالية بنجاح دون المساس بكشوف الرواتب المعتمدة سابقاً.'
            : 'Addition updated without altering previously approved payroll statements.'
        );
      }
      setAdditionModalMode(null);
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmStopAddition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !stopAdditionTarget) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await changeWorkerAdditionStatus({
        actor: userProfile,
        additionId: stopAdditionTarget.id,
        nextStatus: stopAdditionAction,
        endYearMonth:
          stopAdditionTarget.recurrence === 'monthly_recurring' && stopAdditionAction === 'stopped'
            ? stopAdditionEndMonth
            : undefined,
        reason: stopAdditionReason,
      });
      setStopAdditionTarget(null);
      setSuccessMsg(
        isAr
          ? 'تم تحديث حالة الإضافة المالية مع بقاء الكشوف التاريخية المعتمدة سليمة دون تغيير.'
          : 'Addition status updated; historical approved payrolls remain untouched.'
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  // ===================== Monthly Settlement Handlers =====================
  const handleGenerateDraft = async () => {
    if (!userProfile || !currentOrg) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { run } = await generateDraftMonthlyPayrollRun({
        actor: userProfile,
        orgId: currentOrg.id,
        yearMonth: selectedYearMonth,
      });
      setSuccessMsg(
        isAr
          ? `تم توليد/تحديث مسودة تصفية رواتب شهر ${selectedYearMonth} لعدد ${run.workersCount} عامل.`
          : `Draft payroll for ${selectedYearMonth} generated (${run.workersCount} workers).`
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleApproveRun = async () => {
    if (!userProfile || !currentOrg) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const approved = await approveMonthlyPayrollRun({
        actor: userProfile,
        orgId: currentOrg.id,
        yearMonth: selectedYearMonth,
      });
      setShowApproveConfirm(false);
      setSuccessMsg(
        isAr
          ? `تم اعتماد تصفية رواتب شهر ${approved.yearMonth} رسمياً وتجميد اللقطات التاريخية؛ يمكنك الآن الانتقال إلى صرف الرواتب.`
          : `Payroll for ${approved.yearMonth} approved and frozen. You can now record disbursements.`
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const openCorrectionModal = (item: PayrollItem) => {
    setCorrectingItem(item);
    setCorrBase(String(item.baseSalary));
    setCorrAdditions(String(item.additionsTotal));
    setCorrAdvances(String(item.advancesTotal));
    setCorrCarryIn(String(item.carryOverIn));
    setCorrReason('');
    setErrorMsg(null);
  };

  const handleSaveAdminCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !correctingItem) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await adminCorrectApprovedPayrollItem({
        actor: userProfile,
        payrollItemId: correctingItem.id,
        baseSalary: corrBase,
        additionsTotal: corrAdditions,
        advancesTotal: corrAdvances,
        carryOverIn: corrCarryIn,
        correctionReason: corrReason,
      });
      setCorrectingItem(null);
      setSuccessMsg(
        isAr
          ? 'تم تنفيذ التصحيح الإداري الموثق وتحديث الكشف وسجل التدقيق بنجاح.'
          : 'Documented administrative correction saved and audited.'
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  // ===================== Disbursement Handlers =====================
  const openPaymentModal = (item: PayrollItem) => {
    setPayingItem(item);
    setPayAmount(String(item.remainingPayable));
    setPayDate(getTodayIsoDate());
    setPayMethod('bank_transfer');
    setPayNotes('');
    setPayProofFile(null);
    setPayRequestKey(generateClientRequestKey('pay_req'));
    setErrorMsg(null);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !currentOrg || !payingItem) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const pendingProof = payProofFile
        ? buildPendingProofAttachmentRef({
            fileName: payProofFile.name,
            mimeType: payProofFile.type,
            fileSize: payProofFile.size,
            clientUploadKey: generateClientRequestKey('pay_proof'),
            syncStatus: 'pending_drive_sync',
          })
        : null;

      const { payment } = await recordPayrollPayment({
        actor: userProfile,
        payrollItemId: payingItem.id,
        input: {
          amount: payAmount,
          paymentDate: payDate,
          paymentMethod: payMethod,
          notes: payNotes,
          proofAttachment: pendingProof,
          clientRequestKey: payRequestKey,
        },
      });

      let driveNote = '';
      if (payProofFile) {
        const token = getOwnerDriveToken();
        const branch = branches.find((b) => b.id === payingItem.branchIdSnapshot);
        if (token && branch) {
          try {
            const bytes = new Uint8Array(await payProofFile.arrayBuffer());
            await syncPayrollPaymentProofToDrive({
              token,
              actor: userProfile,
              org: currentOrg,
              branch,
              payment,
              fileName: payProofFile.name,
              mimeType: payProofFile.type,
              bytes,
            });
            driveNote = isAr
              ? ' وتم حفظ إثبات الصرف في Google Drive بنجاح.'
              : ' Payment proof archived in Google Drive.';
          } catch {
            driveNote = isAr
              ? ' تم حفظ دفعة الراتب بنجاح، ولكن تعذر رفع الإثبات إلى Drive ويمكن إعادة المحاولة لاحقاً دون تكرار.'
              : ' Payment recorded, but Drive upload failed — retry safely later without duplicates.';
          }
        } else {
          driveNote = isAr
            ? ' تم حفظ الدفعة ووسم الإثبات «بانتظار الرفع إلى Google Drive».'
            : ' Payment saved with proof marked Pending Google Drive Upload.';
        }
      }

      setPayingItem(null);
      setPayProofFile(null);
      setSuccessMsg(
        (isAr
          ? `تم تسجيل صرف دفعة بقيمة ${fmt(payment.amount)} للعامل ${payingItem.workerNameSnapshot}.`
          : `Recorded payment of ${fmt(payment.amount)} for ${payingItem.workerNameSnapshot}.`) +
          driveNote
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmReversePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !reversingPayment) return;
    setBusyAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await reversePayrollPayment({
        actor: userProfile,
        paymentId: reversingPayment.id,
        reversalReason: reverseReason,
      });
      setReversingPayment(null);
      setReverseReason('');
      setSuccessMsg(
        isAr
          ? 'تم عكس دفعة الراتب إدارياً واستعادة الرصيد المتبقي للعامل (مع حفظ الدفعة للتدقيق).'
          : 'Salary payment reversed and remaining balance restored.'
      );
      await loadAllOrgData();
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  // ===================== Excel Export =====================
  const handleExportExcel = async () => {
    if (!currentOrg || !summaryReport) return;
    setBusyAction(true);
    setErrorMsg(null);
    try {
      const filteredItems =
        reportBranchFilter === 'all'
          ? currentMonthItems
          : currentMonthItems.filter((i) => i.branchIdSnapshot === reportBranchFilter);
      const filteredAdv = advances.filter(
        (a) =>
          a.yearMonth === selectedYearMonth &&
          (reportBranchFilter === 'all' || a.branchId === reportBranchFilter)
      );
      const wb = await buildMonthlyPayrollReportWorkbook({
        org: currentOrg,
        report: summaryReport,
        payrollItems: filteredItems,
        advances: filteredAdv,
      });
      const rawBuf = await wb.xlsx.writeBuffer();
      const bytes = new Uint8Array(rawBuf as ArrayBuffer);
      const fileName = `Payroll_${selectedYearMonth}_${currentOrg.id}.xlsx`;
      downloadXlsxBytes(bytes, fileName);
      setSuccessMsg(
        isAr ? `تم تصدير تقرير الرواتب بصيغة Excel (${fileName}).` : `Exported Excel report (${fileName}).`
      );
    } catch (err) {
      handleServiceError(err);
    } finally {
      setBusyAction(false);
    }
  };

  if (!access.canManageWorkers || !currentOrg) {
    return (
      <div className="p-8 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-center space-y-2">
        <Lock className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="text-base font-bold text-[#0B1B32] dark:text-white">
          {isAr ? 'هذه الوحدة مخصصة لمدير المؤسسة فقط' : 'Organization Manager Access Only'}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isAr
            ? 'لا تتوفر صلاحية إدارة العمال وتصفية وصرف الرواتب لهذا الحساب.'
            : 'Workers & Payroll management is restricted to the Organization Manager.'}
        </p>
      </div>
    );
  }

  const subNavBtn = (id: HubSubTab) =>
    `px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
      subTab === id
        ? 'bg-[#1764FF] text-white'
        : 'text-slate-600 dark:text-slate-300 hover:bg-[#F5F8FF] dark:hover:bg-[#142B4F]'
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1B32] dark:text-white">
            {isAr ? 'إدارة العمال والرواتب' : 'Workers & Payroll Management'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isAr
              ? `${currentOrg.name} · إدارة ملفات العمال والسُلف والمكافآت وتصفية وصرف الرواتب الشهرية`
              : `${currentOrg.name} · Workers directory, advances, additions, monthly payroll settlement & disbursement`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAllOrgData()}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] bg-white dark:bg-[#0E203A] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-[#F5F8FF] dark:hover:bg-[#142B4F] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {isAr ? 'تحديث البيانات' : 'Refresh Data'}
        </button>
      </div>

      {/* Honest Firestore Rules Status Banner */}
      {rulesBlocked && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/35 flex items-start gap-3 text-xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-amber-900 dark:text-amber-200">
              {isAr
                ? 'تنبيه مهم: قواعد Firestore لم تُحدَّث بعد لمجموعات العمال والرواتب'
                : 'Notice: Firestore Security Rules Not Yet Activated for Workers & Payroll'}
            </p>
            <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
              {isAr
                ? FIRESTORE_RULES_PENDING_MESSAGE_AR
                : 'The deployed firestore.rules currently enforce default-deny on the 7 Workers & Payroll collections. Permanent cloud read/write persistence will activate immediately once the dedicated Firestore rules are reviewed and deployed.'}
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

      {/* Internal Section Sub-Navigation */}
      <div className="p-1.5 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex items-center gap-1 overflow-x-auto">
        <button type="button" onClick={() => setSubTab('workers')} className={subNavBtn('workers')}>
          <Users className="w-3.5 h-3.5" />
          <span>{isAr ? `إدارة العمال (${workers.length})` : `Workers (${workers.length})`}</span>
        </button>
        <button type="button" onClick={() => setSubTab('advances')} className={subNavBtn('advances')}>
          <Wallet className="w-3.5 h-3.5" />
          <span>{isAr ? `السُلف والسحبيات (${advances.length})` : `Advances (${advances.length})`}</span>
        </button>
        <button type="button" onClick={() => setSubTab('additions')} className={subNavBtn('additions')}>
          <Award className="w-3.5 h-3.5" />
          <span>{isAr ? `المكافآت والبدلات (${additions.length})` : `Additions (${additions.length})`}</span>
        </button>
        <button type="button" onClick={() => setSubTab('settlement')} className={subNavBtn('settlement')}>
          <Calculator className="w-3.5 h-3.5" />
          <span>{isAr ? 'تصفية رواتب الشهر' : 'Monthly Settlement'}</span>
        </button>
        <button type="button" onClick={() => setSubTab('disbursement')} className={subNavBtn('disbursement')}>
          <CreditCard className="w-3.5 h-3.5" />
          <span>{isAr ? 'صرف الرواتب' : 'Disbursement'}</span>
        </button>
        <button type="button" onClick={() => setSubTab('reports')} className={subNavBtn('reports')}>
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>{isAr ? 'التقارير وتصدير Excel' : 'Reports & Excel'}</span>
        </button>
      </div>

      {/* ================================================================= */}
      {/* TAB 1: WORKERS DIRECTORY                                          */}
      {/* ================================================================= */}
      {subTab === 'workers' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input
                  type="text"
                  value={workerSearch}
                  onChange={(e) => setWorkerSearch(e.target.value)}
                  placeholder={isAr ? 'بحث بالاسم أو الرقم الوظيفي...' : 'Search by name or employee #...'}
                  className="w-full ps-8 pe-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF]"
                />
              </div>
              <select
                value={workerBranchFilter}
                onChange={(e) => setWorkerBranchFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white"
              >
                <option value="all">{isAr ? 'جميع الفروع' : 'All Branches'}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select
                value={workerStatusFilter}
                onChange={(e) => setWorkerStatusFilter(e.target.value as 'all' | WorkerStatus)}
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white"
              >
                <option value="all">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
                <option value="active">{isAr ? 'نشط' : 'Active'}</option>
                <option value="suspended">{isAr ? 'موقوف مؤقتاً' : 'Suspended'}</option>
                <option value="terminated">{isAr ? 'منتهي الخدمة' : 'Terminated'}</option>
              </select>
            </div>
            <button
              type="button"
              onClick={openCreateWorkerModal}
              className="px-4 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              {isAr ? 'إضافة عامل جديد' : 'Add Worker'}
            </button>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
            {filteredWorkers.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {loading
                    ? isAr
                      ? 'جارٍ تحميل سجل العمال...'
                      : 'Loading workers...'
                    : isAr
                    ? 'لا يوجد عمال مطابقون للفلتر الحالي.'
                    : 'No workers match the current filter.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'العامل' : 'Worker'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الرقم الوظيفي' : 'Emp #'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الفرع الحالي' : 'Current Branch'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الراتب الأساسي' : 'Base Salary'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'تاريخ التعيين' : 'Hire Date'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الحالة' : 'Status'}</th>
                      <th className="py-3 px-4 text-end font-semibold">{isAr ? 'الإجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {filteredWorkers.map((w) => (
                      <tr key={w.id} className="hover:bg-[#F8FAFF] dark:hover:bg-[#122543]/60">
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#0B1B32] dark:text-white">{w.fullName}</div>
                          {w.phone && (
                            <div className="text-[11px] text-slate-500 tabular-nums" dir="ltr">
                              {w.phone}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 tabular-nums font-medium">{w.employeeNumber}</td>
                        <td className="py-3 px-4">{w.currentBranchName}</td>
                        <td className="py-3 px-4 font-bold tabular-nums">{fmt(w.monthlySalary)}</td>
                        <td className="py-3 px-4 tabular-nums whitespace-nowrap">{w.hireDate}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              w.status === 'active'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : w.status === 'suspended'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            {getWorkerStatusLabel(w.status, isAr)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setProfileWorker(w)}
                              className="px-2.5 py-1.5 rounded-lg bg-[#F5F8FF] dark:bg-[#122543] text-[#1764FF] dark:text-[#6CA2FF] hover:bg-[#E6EEFC] dark:hover:bg-[#1A3560] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {isAr ? 'الملف المالي' : 'Profile'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditWorkerModal(w)}
                              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#173056]"
                              title={isAr ? 'تعديل البيانات والراتب' : 'Edit worker'}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setTransferTargetWorker(w);
                                setTransferBranchId(
                                  activeBranches.find((b) => b.id !== w.currentBranchId)?.id || ''
                                );
                                setTransferReason('');
                              }}
                              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#173056]"
                              title={isAr ? 'نقل بين الفروع' : 'Transfer branch'}
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setStatusTargetWorker(w);
                                setNextWorkerStatus(w.status === 'active' ? 'suspended' : 'active');
                                setStatusReason('');
                                setTerminationDate(getTodayIsoDate());
                              }}
                              className="p-1.5 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/15"
                              title={isAr ? 'تغيير الحالة (إيقاف / إنهاء خدمة)' : 'Change status'}
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: ADVANCES & WITHDRAWALS (MANAGER VIEW)                      */}
      {/* ================================================================= */}
      {subTab === 'advances' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={advBranchFilter}
                onChange={(e) => setAdvBranchFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white"
              >
                <option value="all">{isAr ? 'كل الفروع' : 'All Branches'}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select
                value={advWorkerFilter}
                onChange={(e) => setAdvWorkerFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white"
              >
                <option value="all">{isAr ? 'كل العمال' : 'All Workers'}</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.fullName} ({w.employeeNumber})
                  </option>
                ))}
              </select>
              <select
                value={advStatusFilter}
                onChange={(e) =>
                  setAdvStatusFilter(e.target.value as 'all' | 'active' | 'cancelled')
                }
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white"
              >
                <option value="all">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
                <option value="active">{isAr ? 'نشطة' : 'Active'}</option>
                <option value="cancelled">{isAr ? 'ملغاة' : 'Cancelled'}</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                setAdvFormWorkerId(workers.find((w) => w.status === 'active')?.id || '');
                setAdvFormAmount('');
                setAdvFormDate(getTodayIsoDate());
                setAdvFormMethod('cash');
                setAdvFormReason('');
                setAdvFormNotes('');
                setAdvFormFile(null);
                setShowCreateAdvanceModal(true);
              }}
              className="px-4 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              {isAr ? 'تسجيل سحبية جديدة' : 'Record Advance'}
            </button>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
            {filteredAdvances.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                {isAr ? 'لا توجد سلف أو سحبيات مطابقة للفلتر.' : 'No matching advances found.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'التاريخ' : 'Date'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'العامل' : 'Worker'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الفرع' : 'Branch'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'المبلغ' : 'Amount'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'السبب والطريقة' : 'Reason & Method'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الحالة' : 'Status'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'مرفق Drive' : 'Drive Proof'}</th>
                      <th className="py-3 px-4 text-end font-semibold">{isAr ? 'إجراءات الإدارة' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {filteredAdvances.map((adv) => {
                      const isLocked = Boolean(adv.payrollSettledRunId) || adv.status === 'cancelled';
                      const proof = adv.proofAttachment;
                      return (
                        <tr key={adv.id} className={adv.status === 'cancelled' ? 'opacity-65' : ''}>
                          <td className="py-3 px-4 tabular-nums whitespace-nowrap">{adv.date}</td>
                          <td className="py-3 px-4 font-semibold text-[#0B1B32] dark:text-white">
                            {adv.workerNameSnapshot}
                            <span className="block text-[11px] font-normal text-slate-500">
                              {isAr ? `سجلها: ${adv.createdByName}` : `By: ${adv.createdByName}`}
                            </span>
                          </td>
                          <td className="py-3 px-4">{adv.branchNameSnapshot}</td>
                          <td className="py-3 px-4 font-bold tabular-nums">{fmt(adv.amount)}</td>
                          <td className="py-3 px-4 max-w-xs">
                            <div>{adv.reason}</div>
                            <div className="text-[11px] text-slate-500">
                              {getPaymentMethodLabel(adv.paymentMethod, isAr)}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {adv.status === 'cancelled' ? (
                              <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                {isAr ? 'ملغاة' : 'Cancelled'}
                              </span>
                            ) : adv.payrollSettledYearMonth ? (
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                                {isAr ? `مسوّاة (${adv.payrollSettledYearMonth})` : `Settled (${adv.payrollSettledYearMonth})`}
                              </span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400 font-semibold">
                                {isAr ? 'نشطة' : 'Active'}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {proof ? (
                              <div className="space-y-1">
                                <div className="text-[11px] text-slate-700 dark:text-slate-200 truncate max-w-[170px]">
                                  {proof.fileName}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                  {getProofSyncStatusLabel(proof.syncStatus, isAr)}
                                </div>
                                <div className="flex items-center gap-2">
                                  {proof.syncStatus === 'uploaded' && proof.driveFileId && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleDownloadDriveProof(
                                            proof.driveFileId!,
                                            adv.id,
                                            proof.fileName
                                          )
                                        }
                                        className="text-[11px] text-[#1764FF] hover:underline inline-flex items-center gap-0.5"
                                      >
                                        <Download className="w-3 h-3" />
                                        {isAr ? 'تنزيل' : 'Download'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setTrashProofTarget({ kind: 'advance', record: adv });
                                          setTrashProofReason('');
                                        }}
                                        className="text-[11px] text-rose-600 hover:underline inline-flex items-center gap-0.5"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        {isAr ? 'سلة Drive' : 'Trash'}
                                      </button>
                                    </>
                                  )}
                                  {(proof.syncStatus === 'pending_drive_sync' ||
                                    proof.syncStatus === 'sync_failed') && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRetryProofTarget({ kind: 'advance', record: adv });
                                        setRetryProofFile(null);
                                      }}
                                      className="text-[11px] text-[#1764FF] hover:underline inline-flex items-center gap-0.5 font-semibold"
                                    >
                                      <Upload className="w-3 h-3" />
                                      {isAr ? 'رفع / إعادة المحاولة' : 'Sync / Retry'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setRetryProofTarget({ kind: 'advance', record: adv });
                                  setRetryProofFile(null);
                                }}
                                className="text-[11px] text-slate-500 hover:text-[#1764FF] inline-flex items-center gap-1"
                              >
                                <Paperclip className="w-3 h-3" />
                                {isAr ? 'إرفاق إثبات' : 'Attach Proof'}
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-1.5">
                              {!isLocked ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingAdvance(adv);
                                      setEditAdvAmount(String(adv.amount));
                                      setEditAdvDate(adv.date);
                                      setEditAdvMethod(adv.paymentMethod);
                                      setEditAdvReason(adv.reason);
                                      setEditAdvAuditReason('');
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-[#F5F8FF] dark:bg-[#122543] text-slate-700 dark:text-slate-200 hover:bg-[#E6EEFC] text-[11px] font-semibold"
                                  >
                                    {isAr ? 'تعديل' : 'Edit'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCancellingAdvance(adv);
                                      setCancelAdvReason('');
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-100 text-[11px] font-semibold"
                                  >
                                    {isAr ? 'إلغاء' : 'Cancel'}
                                  </button>
                                </>
                              ) : (
                                <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                                  <Lock className="w-3 h-3" />
                                  {isAr ? 'مقفلة' : 'Locked'}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: BONUSES & ALLOWANCES (FINANCIAL ADDITIONS)                 */}
      {/* ================================================================= */}
      {subTab === 'additions' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {isAr
                ? 'إدارة المكافآت وبدلات النقل والسكن والعمل الإضافي (مرة واحدة أو متكررة شهرياً). أي تعديل أو إيقاف لا يغيّر كشوف الرواتب التاريخية المعتمدة.'
                : 'Manage one-time and monthly recurring bonuses & allowances. Edits or stops never mutate approved historical payrolls.'}
            </p>
            <button
              type="button"
              onClick={openCreateAdditionModal}
              className="px-4 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              {isAr ? 'إضافة مكافأة أو بدل' : 'Add Bonus / Allowance'}
            </button>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
            {additions.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                {isAr ? 'لا توجد مكافآت أو بدلات مسجلة بعد.' : 'No bonuses or allowances recorded yet.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'العامل' : 'Worker'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'المسمى والنوع' : 'Label & Category'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'التكرار والنطاق' : 'Schedule'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'المبلغ' : 'Amount'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الحالة' : 'Status'}</th>
                      <th className="py-3 px-4 text-end font-semibold">{isAr ? 'الإجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {additions.map((add) => (
                      <tr key={add.id} className={add.status !== 'active' ? 'opacity-65' : ''}>
                        <td className="py-3 px-4 font-semibold text-[#0B1B32] dark:text-white">
                          {add.workerNameSnapshot}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold">{add.label}</div>
                          <div className="text-[11px] text-slate-500">
                            {getAdditionCategoryLabel(add.category, isAr)}
                          </div>
                        </td>
                        <td className="py-3 px-4 tabular-nums">
                          {add.recurrence === 'one_time'
                            ? isAr
                              ? `مرة واحدة · ${add.targetYearMonth}`
                              : `One-time · ${add.targetYearMonth}`
                            : isAr
                            ? `متكررة شهرياً · من ${add.startYearMonth}${
                                add.endYearMonth ? ` إلى ${add.endYearMonth}` : ' (مستمرة)'
                              }`
                            : `Recurring · from ${add.startYearMonth}${
                                add.endYearMonth ? ` to ${add.endYearMonth}` : ' (ongoing)'
                              }`}
                        </td>
                        <td className="py-3 px-4 font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {fmt(add.amount)}
                        </td>
                        <td className="py-3 px-4 font-semibold">
                          {getAdditionStatusLabel(add.status, isAr)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditAdditionModal(add)}
                              className="px-2.5 py-1.5 rounded-lg bg-[#F5F8FF] dark:bg-[#122543] text-slate-700 dark:text-slate-200 hover:bg-[#E6EEFC] text-[11px] font-semibold"
                            >
                              {isAr ? 'تعديل' : 'Edit'}
                            </button>
                            {add.status === 'active' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setStopAdditionTarget(add);
                                  setStopAdditionAction(
                                    add.recurrence === 'monthly_recurring' ? 'stopped' : 'cancelled'
                                  );
                                  setStopAdditionEndMonth(selectedYearMonth);
                                  setStopAdditionReason('');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-100 text-[11px] font-semibold"
                              >
                                {add.recurrence === 'monthly_recurring'
                                  ? isAr
                                    ? 'إيقاف / إلغاء'
                                    : 'Stop / Cancel'
                                  : isAr
                                  ? 'إلغاء'
                                  : 'Cancel'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 4: MONTHLY PAYROLL SETTLEMENT                                 */}
      {/* ================================================================= */}
      {subTab === 'settlement' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {isAr ? 'شهر التصفية:' : 'Payroll Month:'}
              </label>
              <input
                type="month"
                value={selectedYearMonth}
                onChange={(e) => setSelectedYearMonth(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-bold tabular-nums text-[#0B1B32] dark:text-white"
              />
              {currentRun && (
                <span
                  className={`text-xs font-bold ${
                    currentRun.status === 'approved'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {currentRun.status === 'approved'
                    ? isAr
                      ? `معتمدة ومجمّدة (${currentRun.approvedAt?.slice(0, 10) || ''})`
                      : `Approved & Frozen (${currentRun.approvedAt?.slice(0, 10) || ''})`
                    : isAr
                    ? 'مسودة قيد المراجعة'
                    : 'Draft Under Review'}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(!currentRun || currentRun.status === 'draft') && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleGenerateDraft()}
                  className="px-4 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Calculator className="w-4 h-4" />
                  {currentRun
                    ? isAr
                      ? 'تحديث مسودة التصفية'
                      : 'Refresh Draft'
                    : isAr
                    ? 'توليد مسودة تصفية الشهر'
                    : 'Generate Monthly Draft'}
                </button>
              )}
              {currentRun?.status === 'draft' && currentMonthItems.length > 0 && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => setShowApproveConfirm(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isAr ? 'اعتماد التصفية رسمياً' : 'Approve Payroll Run'}
                </button>
              )}
            </div>
          </div>

          {currentRun && (
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <div>
                <p className="text-[11px] text-slate-500">{isAr ? 'عدد العمال' : 'Workers'}</p>
                <p className="text-base font-bold tabular-nums mt-0.5">{currentRun.workersCount}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">{isAr ? 'الرواتب الأساسية' : 'Base Salaries'}</p>
                <p className="text-base font-bold tabular-nums mt-0.5">{fmt(currentRun.totalBaseSalary)}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">{isAr ? 'الإضافات والبدلات' : 'Additions'}</p>
                <p className="text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                  {fmt(currentRun.totalAdditions)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">{isAr ? 'السحبيات + المرحّل السابق' : 'Advances + Carry In'}</p>
                <p className="text-base font-bold tabular-nums text-amber-700 dark:text-amber-400 mt-0.5">
                  {fmt(currentRun.totalAdvances + currentRun.totalCarryOverIn)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">{isAr ? 'صافي المستحق للصرف' : 'Net Payable'}</p>
                <p className="text-base font-bold tabular-nums text-[#1764FF] dark:text-[#6CA2FF] mt-0.5">
                  {fmt(currentRun.totalNetPayable)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">{isAr ? 'المرحل للشهر القادم' : 'Carry-Over Out'}</p>
                <p className="text-base font-bold tabular-nums text-rose-700 dark:text-rose-400 mt-0.5">
                  {fmt(currentRun.totalCarryOverOut)}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
            {currentMonthItems.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                {isAr
                  ? `لم تُولَّد مسودة تصفية لشهر ${selectedYearMonth} بعد. اضغط «توليد مسودة تصفية الشهر» لاحتساب الرواتب والسحبيات والبدلات والرصيد المرحّل تلقائياً.`
                  : `No draft payroll generated for ${selectedYearMonth} yet.`}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-3 px-3 text-start font-semibold">{isAr ? 'العامل والفرع' : 'Worker & Branch'}</th>
                      <th className="py-3 px-3 text-start font-semibold">{isAr ? 'الأساسي' : 'Base'}</th>
                      <th className="py-3 px-3 text-start font-semibold">{isAr ? 'الإضافات' : 'Additions'}</th>
                      <th className="py-3 px-3 text-start font-semibold">{isAr ? 'السحبيات' : 'Advances'}</th>
                      <th className="py-3 px-3 text-start font-semibold">{isAr ? 'مرحّل سابق' : 'Carry In'}</th>
                      <th className="py-3 px-3 text-start font-semibold">{isAr ? 'صافي المستحق' : 'Net Payable'}</th>
                      <th className="py-3 px-3 text-start font-semibold">{isAr ? 'مرحّل قادم' : 'Carry Out'}</th>
                      <th className="py-3 px-3 text-end font-semibold">{isAr ? 'الإجراء' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {currentMonthItems.map((item) => (
                      <tr key={item.id}>
                        <td className="py-3 px-3">
                          <div className="font-bold text-[#0B1B32] dark:text-white">
                            {item.workerNameSnapshot}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            #{item.employeeNumberSnapshot} · {item.branchNameSnapshot}
                            {item.isAdminCorrected && (
                              <span className="text-amber-700 dark:text-amber-400 font-semibold">
                                {' '}
                                · {isAr ? `مصحح (${item.correctionCount || 1})` : `Corrected`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 tabular-nums">{fmt(item.baseSalary)}</td>
                        <td className="py-3 px-3 tabular-nums text-emerald-700 dark:text-emerald-400">
                          {fmt(item.additionsTotal)}
                        </td>
                        <td className="py-3 px-3 tabular-nums text-amber-700 dark:text-amber-400">
                          {fmt(item.advancesTotal)}
                        </td>
                        <td className="py-3 px-3 tabular-nums">{fmt(item.carryOverIn)}</td>
                        <td className="py-3 px-3 tabular-nums font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                          {fmt(item.netPayable)}
                        </td>
                        <td className="py-3 px-3 tabular-nums text-rose-700 dark:text-rose-400">
                          {fmt(item.carryOverOut)}
                        </td>
                        <td className="py-3 px-3 text-end">
                          {item.status === 'approved' ? (
                            <button
                              type="button"
                              onClick={() => openCorrectionModal(item)}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 hover:bg-amber-100 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              {isAr ? 'تصحيح إداري موثق' : 'Admin Correction'}
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              {isAr ? 'مسودة' : 'Draft'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 5: SALARY DISBURSEMENT                                        */}
      {/* ================================================================= */}
      {subTab === 'disbursement' && (
        <div className="space-y-5">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="month"
                value={selectedYearMonth}
                onChange={(e) => setSelectedYearMonth(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-bold tabular-nums text-[#0B1B32] dark:text-white"
              />
              <select
                value={disbursementBranchFilter}
                onChange={(e) => setDisbursementBranchFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white"
              >
                <option value="all">{isAr ? 'كل الفروع' : 'All Branches'}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select
                value={disbursementStatusFilter}
                onChange={(e) =>
                  setDisbursementStatusFilter(
                    e.target.value as 'all' | PayrollDisbursementStatus
                  )
                }
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white"
              >
                <option value="all">{isAr ? 'كل حالات الصرف' : 'All Payment Statuses'}</option>
                <option value="unpaid">{isAr ? 'لم يُصرف' : 'Unpaid'}</option>
                <option value="partially_paid">{isAr ? 'مدفوع جزئياً' : 'Partially Paid'}</option>
                <option value="paid">{isAr ? 'مدفوع بالكامل' : 'Paid in Full'}</option>
              </select>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {isAr
                ? 'توثيق صرف الرواتب نقدياً أو بالتحويل البنكي (تسجيل فقط دون تنفيذ تحويل بنكي مباشر)'
                : 'Manual cash/bank transfer disbursement logging only (no live bank transfer execution)'}
            </span>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
            {approvedMonthItems.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                {isAr
                  ? `لا توجد كشوف رواتب معتمدة للصرف في شهر ${selectedYearMonth}. اعتمد التصفية أولاً من تبويب «تصفية رواتب الشهر».`
                  : `No approved payroll statements for ${selectedYearMonth}. Approve the monthly run first.`}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'العامل والفرع' : 'Worker'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'صافي المستحق' : 'Net Payable'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'المصروف حتى الآن' : 'Paid'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'المتبقي' : 'Remaining'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'حالة الصرف' : 'Status'}</th>
                      <th className="py-3 px-4 text-end font-semibold">{isAr ? 'تسجيل دفعة' : 'Disburse'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {approvedMonthItems.map((item) => (
                      <tr key={item.id}>
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#0B1B32] dark:text-white">
                            {item.workerNameSnapshot}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            #{item.employeeNumberSnapshot} · {item.branchNameSnapshot}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-bold tabular-nums">{fmt(item.netPayable)}</td>
                        <td className="py-3 px-4 tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                          {fmt(item.paidAmount)}
                        </td>
                        <td className="py-3 px-4 tabular-nums font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                          {fmt(item.remainingPayable)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              item.disbursementStatus === 'paid'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : item.disbursementStatus === 'partially_paid'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {getDisbursementStatusLabel(item.disbursementStatus, isAr)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-end">
                          {item.remainingPayableHalalas > 0 ? (
                            <button
                              type="button"
                              onClick={() => openPaymentModal(item)}
                              className="px-3 py-1.5 rounded-lg bg-[#1764FF] hover:bg-[#1052D8] text-white text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                              {isAr ? 'تسجيل صرف' : 'Record Payment'}
                            </button>
                          ) : (
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">
                              {isAr ? 'مكتمل' : 'Completed'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Independent Payments History for Selected Month */}
          <div className="rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E6EEFC] dark:border-[#1B345B]">
              <h3 className="text-sm font-bold text-[#0B1B32] dark:text-white">
                {isAr
                  ? `سجل دفعات الصرف المستقلة لشهر ${selectedYearMonth} (${currentMonthPayments.length})`
                  : `Independent Disbursement Records — ${selectedYearMonth} (${currentMonthPayments.length})`}
              </h3>
            </div>
            {currentMonthPayments.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                {isAr ? 'لا توجد دفعات مسجلة لهذا الشهر بعد.' : 'No payments recorded for this month yet.'}
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
                      <th className="py-2.5 px-4 text-start font-semibold">{isAr ? 'الحالة' : 'Status'}</th>
                      <th className="py-2.5 px-4 text-start font-semibold">{isAr ? 'إثبات الصرف (Drive)' : 'Proof (Drive)'}</th>
                      <th className="py-2.5 px-4 text-end font-semibold">{isAr ? 'إجراء' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {currentMonthPayments.map((pay) => {
                      const proof = pay.proofAttachment;
                      return (
                        <tr key={pay.id} className={pay.status === 'reversed' ? 'opacity-65' : ''}>
                          <td className="py-3 px-4 tabular-nums whitespace-nowrap">{pay.paymentDate}</td>
                          <td className="py-3 px-4 font-semibold">{pay.workerNameSnapshot}</td>
                          <td className="py-3 px-4 font-bold tabular-nums">{fmt(pay.amount)}</td>
                          <td className="py-3 px-4">{getPaymentMethodLabel(pay.paymentMethod, isAr)}</td>
                          <td className="py-3 px-4">
                            {pay.status === 'reversed' ? (
                              <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                {isAr ? 'معكوسة' : 'Reversed'}
                              </span>
                            ) : (
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                {isAr ? 'مصروفة' : 'Recorded'}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {proof ? (
                              <div className="space-y-0.5">
                                <div className="text-[11px] truncate max-w-[160px]">{proof.fileName}</div>
                                <div className="text-[10px] text-slate-500">
                                  {getProofSyncStatusLabel(proof.syncStatus, isAr)}
                                </div>
                                <div className="flex items-center gap-2">
                                  {proof.syncStatus === 'uploaded' && proof.driveFileId && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleDownloadDriveProof(
                                            proof.driveFileId!,
                                            pay.id,
                                            proof.fileName
                                          )
                                        }
                                        className="text-[11px] text-[#1764FF] hover:underline inline-flex items-center gap-0.5"
                                      >
                                        <Download className="w-3 h-3" />
                                        {isAr ? 'تنزيل' : 'Download'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setTrashProofTarget({ kind: 'payment', record: pay });
                                          setTrashProofReason('');
                                        }}
                                        className="text-[11px] text-rose-600 hover:underline inline-flex items-center gap-0.5"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        {isAr ? 'سلة Drive' : 'Trash'}
                                      </button>
                                    </>
                                  )}
                                  {(proof.syncStatus === 'pending_drive_sync' ||
                                    proof.syncStatus === 'sync_failed') && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRetryProofTarget({ kind: 'payment', record: pay });
                                        setRetryProofFile(null);
                                      }}
                                      className="text-[11px] text-[#1764FF] hover:underline inline-flex items-center gap-0.5 font-semibold"
                                    >
                                      <Upload className="w-3 h-3" />
                                      {isAr ? 'رفع / إعادة المحاولة' : 'Sync / Retry'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setRetryProofTarget({ kind: 'payment', record: pay });
                                  setRetryProofFile(null);
                                }}
                                className="text-[11px] text-slate-500 hover:text-[#1764FF] inline-flex items-center gap-1"
                              >
                                <Paperclip className="w-3 h-3" />
                                {isAr ? 'إرفاق إثبات' : 'Attach Proof'}
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-4 text-end">
                            {pay.status === 'recorded' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReversingPayment(pay);
                                  setReverseReason('');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-100 text-[11px] font-semibold inline-flex items-center gap-1"
                              >
                                <RotateCcw className="w-3 h-3" />
                                {isAr ? 'عكس الدفعة' : 'Reverse'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 6: REPORTS & RTL ARABIC EXCEL EXPORT                          */}
      {/* ================================================================= */}
      {subTab === 'reports' && summaryReport && (
        <div className="space-y-5">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="month"
                value={selectedYearMonth}
                onChange={(e) => setSelectedYearMonth(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs font-bold tabular-nums text-[#0B1B32] dark:text-white"
              />
              <select
                value={reportBranchFilter}
                onChange={(e) => setReportBranchFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] text-xs text-[#0B1B32] dark:text-white"
              >
                <option value="all">{isAr ? 'كل فروع المؤسسة' : 'All Organization Branches'}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              {isAr ? 'تصدير تقرير الرواتب (Excel .xlsx)' : 'Export Payroll Report (.xlsx)'}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
              <p className="text-xs text-slate-500">{isAr ? 'إجمالي العمال النشطين' : 'Active Workers'}</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-[#0B1B32] dark:text-white">
                {summaryReport.activeWorkersCount}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
              <p className="text-xs text-slate-500">{isAr ? 'إجمالي الرواتب الأساسية' : 'Total Base Salaries'}</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-[#0B1B32] dark:text-white">
                {fmt(summaryReport.totalBaseSalary)}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
              <p className="text-xs text-slate-500">{isAr ? 'إجمالي السحبيات' : 'Total Advances'}</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-amber-700 dark:text-amber-400">
                {fmt(summaryReport.totalAdvances)}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
              <p className="text-xs text-slate-500">{isAr ? 'إجمالي المكافآت والبدلات' : 'Total Additions'}</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
                {fmt(summaryReport.totalAdditions)}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
              <p className="text-xs text-slate-500">{isAr ? 'صافي المستحق للصرف' : 'Total Net Payable'}</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-[#1764FF] dark:text-[#6CA2FF]">
                {fmt(summaryReport.totalNetPayable)}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
              <p className="text-xs text-slate-500">{isAr ? 'إجمالي الرواتب المصروفة' : 'Total Paid'}</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
                {fmt(summaryReport.totalPaid)}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
              <p className="text-xs text-slate-500">{isAr ? 'المتبقي للصرف' : 'Total Remaining'}</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-amber-700 dark:text-amber-400">
                {fmt(summaryReport.totalRemaining)}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66]">
              <p className="text-xs text-slate-500">{isAr ? 'المرحل للشهر القادم' : 'Total Carry-Over Out'}</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-rose-700 dark:text-rose-400">
                {fmt(summaryReport.totalCarryOverOut)}
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E6EEFC] dark:border-[#1B345B]">
              <h3 className="text-sm font-bold text-[#0B1B32] dark:text-white">
                {isAr ? `تفصيل الفروع لشهر ${selectedYearMonth}` : `Branch Breakdown — ${selectedYearMonth}`}
              </h3>
            </div>
            {summaryReport.byBranch.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                {isAr ? 'لا توجد بيانات فروع لهذا الشهر بعد.' : 'No branch payroll data for this month yet.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F5F8FF] dark:bg-[#122543] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الفرع' : 'Branch'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'العمال النشطون' : 'Workers'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الأساسي' : 'Base'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'الإضافات' : 'Additions'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'السحبيات' : 'Advances'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'المستحق' : 'Net Payable'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'المصروف' : 'Paid'}</th>
                      <th className="py-3 px-4 text-start font-semibold">{isAr ? 'المتبقي' : 'Remaining'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EEFC] dark:divide-[#1B345B]">
                    {summaryReport.byBranch.map((br) => (
                      <tr key={br.branchId}>
                        <td className="py-3 px-4 font-bold">{br.branchName}</td>
                        <td className="py-3 px-4 tabular-nums">{br.activeWorkersCount}</td>
                        <td className="py-3 px-4 tabular-nums">{fmt(br.baseSalary)}</td>
                        <td className="py-3 px-4 tabular-nums text-emerald-700 dark:text-emerald-400">
                          {fmt(br.additions)}
                        </td>
                        <td className="py-3 px-4 tabular-nums text-amber-700 dark:text-amber-400">
                          {fmt(br.advances)}
                        </td>
                        <td className="py-3 px-4 tabular-nums font-bold">{fmt(br.netPayable)}</td>
                        <td className="py-3 px-4 tabular-nums text-emerald-700 dark:text-emerald-400">
                          {fmt(br.paidAmount)}
                        </td>
                        <td className="py-3 px-4 tabular-nums font-bold text-[#1764FF] dark:text-[#6CA2FF]">
                          {fmt(br.remainingPayable)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODALS                                                            */}
      {/* ================================================================= */}

      {/* Worker Financial Profile Modal */}
      {profileWorker && userProfile && (
        <WorkerFinancialProfileModal
          actor={userProfile}
          worker={profileWorker}
          advances={advances}
          additions={additions}
          payrollItems={payrollItems}
          payments={payrollPayments}
          auditLogs={auditLogs}
          currency={currency}
          isAr={isAr}
          onClose={() => setProfileWorker(null)}
          onDownloadDriveProof={(fileId, recId, fileName) =>
            void handleDownloadDriveProof(fileId, recId, fileName)
          }
        />
      )}

      {/* Add / Edit Worker Modal */}
      {workerModalMode && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleSaveWorker}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0B1B32] dark:text-white">
                {workerModalMode === 'create'
                  ? isAr
                    ? 'إضافة عامل جديد'
                    : 'Add New Worker'
                  : isAr
                  ? 'تعديل بيانات العامل والراتب'
                  : 'Edit Worker & Salary'}
              </h3>
              <button type="button" onClick={() => setWorkerModalMode(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold">{isAr ? 'الاسم الكامل *' : 'Full Name *'}</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={wName}
                  onChange={(e) => setWName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'الرقم الوظيفي (فريد) *' : 'Employee # (Unique) *'}</label>
                <input
                  type="text"
                  required
                  maxLength={40}
                  value={wEmpNo}
                  onChange={(e) => setWEmpNo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'رقم الجوال (اختياري)' : 'Phone (Optional)'}</label>
                <input
                  type="text"
                  maxLength={30}
                  value={wPhone}
                  onChange={(e) => setWPhone(e.target.value)}
                  dir="ltr"
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? `الراتب الشهري (${currency}) *` : `Monthly Salary (${currency}) *`}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={wSalary}
                  onChange={(e) => setWSalary(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] font-bold tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'تاريخ التعيين *' : 'Hire Date *'}</label>
                <input
                  type="date"
                  required
                  value={wHireDate}
                  onChange={(e) => setWHireDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              {workerModalMode === 'create' && (
                <div className="sm:col-span-2 space-y-1">
                  <label className="font-semibold">{isAr ? 'الفرع الحالي *' : 'Assigned Branch *'}</label>
                  <select
                    required
                    value={wBranchId}
                    onChange={(e) => setWBranchId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                  >
                    <option value="">{isAr ? '-- اختر الفرع --' : '-- Select Branch --'}</option>
                    {activeBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold">{isAr ? 'ملاحظات' : 'Notes'}</label>
                <input
                  type="text"
                  maxLength={500}
                  value={wNotes}
                  onChange={(e) => setWNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setWorkerModalMode(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] text-xs font-semibold"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] text-white text-xs font-bold"
              >
                {busyAction ? (isAr ? 'جارٍ الحفظ...' : 'Saving...') : isAr ? 'حفظ' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Transfer Worker Branch Modal */}
      {transferTargetWorker && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleTransferWorker}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                {isAr ? `نقل العامل: ${transferTargetWorker.fullName}` : `Transfer: ${transferTargetWorker.fullName}`}
              </h3>
              <button type="button" onClick={() => setTransferTargetWorker(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <p className="text-slate-500 dark:text-slate-400">
              {isAr
                ? `الفرع الحالي: ${transferTargetWorker.currentBranchName}. يبقى معرّف العامل ثابتاً ولا تتغير الفروع التاريخية لسحبياته السابقة.`
                : `Current branch: ${transferTargetWorker.currentBranchName}. Historical advances preserve their original branch.`}
            </p>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'الفرع الجديد *' : 'New Branch *'}</label>
              <select
                required
                value={transferBranchId}
                onChange={(e) => setTransferBranchId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              >
                <option value="">{isAr ? '-- اختر الفرع الهدف --' : '-- Select Target Branch --'}</option>
                {activeBranches
                  .filter((b) => b.id !== transferTargetWorker.currentBranchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'سبب النقل (اختياري)' : 'Transfer Reason'}</label>
              <input
                type="text"
                maxLength={300}
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTransferTargetWorker(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-[#1764FF] text-white font-bold"
              >
                {isAr ? 'تنفيذ النقل' : 'Confirm Transfer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Worker Status Change Modal */}
      {statusTargetWorker && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleChangeWorkerStatus}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                {isAr ? `تحديث حالة العامل: ${statusTargetWorker.fullName}` : `Update Status: ${statusTargetWorker.fullName}`}
              </h3>
              <button type="button" onClick={() => setStatusTargetWorker(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <p className="text-slate-500">
              {isAr
                ? 'لن يتم حذف سجل العامل أو تاريخه المالي عند الإيقاف أو إنهاء الخدمة.'
                : 'Worker record and financial history are permanently preserved.'}
            </p>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'الحالة الجديدة *' : 'New Status *'}</label>
              <select
                value={nextWorkerStatus}
                onChange={(e) => setNextWorkerStatus(e.target.value as WorkerStatus)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              >
                <option value="active">{isAr ? 'نشط' : 'Active'}</option>
                <option value="suspended">{isAr ? 'موقوف مؤقتاً' : 'Suspended'}</option>
                <option value="terminated">{isAr ? 'منتهي الخدمة' : 'Terminated'}</option>
              </select>
            </div>
            {nextWorkerStatus === 'terminated' && (
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'تاريخ إنهاء الخدمة' : 'Termination Date'}</label>
                <input
                  type="date"
                  value={terminationDate}
                  onChange={(e) => setTerminationDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'السبب' : 'Reason'}</label>
              <input
                type="text"
                maxLength={300}
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStatusTargetWorker(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-[#1764FF] text-white font-bold"
              >
                {isAr ? 'حفظ الحالة' : 'Save Status'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Create Advance Modal (Manager) */}
      {showCreateAdvanceModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleCreateManagerAdvance}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{isAr ? 'تسجيل سحبية جديدة' : 'Record New Advance'}</h3>
              <button type="button" onClick={() => setShowCreateAdvanceModal(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold">{isAr ? 'العامل النشط *' : 'Active Worker *'}</label>
                <select
                  required
                  value={advFormWorkerId}
                  onChange={(e) => setAdvFormWorkerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                >
                  <option value="">{isAr ? '-- اختر العامل --' : '-- Select Worker --'}</option>
                  {workers
                    .filter((w) => w.status === 'active')
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.fullName} ({w.employeeNumber}) — {w.currentBranchName}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? `المبلغ (${currency}) *` : `Amount (${currency}) *`}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={advFormAmount}
                  onChange={(e) => setAdvFormAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] font-bold tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'التاريخ *' : 'Date *'}</label>
                <input
                  type="date"
                  required
                  value={advFormDate}
                  onChange={(e) => setAdvFormDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'طريقة التسليم *' : 'Method *'}</label>
                <select
                  value={advFormMethod}
                  onChange={(e) => setAdvFormMethod(e.target.value as PayrollPaymentMethod)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                >
                  <option value="cash">{isAr ? 'نقدي' : 'Cash'}</option>
                  <option value="bank_transfer">{isAr ? 'تحويل بنكي' : 'Bank Transfer'}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'السبب *' : 'Reason *'}</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={300}
                  value={advFormReason}
                  onChange={(e) => setAdvFormReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold">{isAr ? 'ملاحظات' : 'Notes'}</label>
                <input
                  type="text"
                  maxLength={500}
                  value={advFormNotes}
                  onChange={(e) => setAdvFormNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold">
                  {isAr ? 'مرفق إيصال / إثبات (اختياري — يُرفع إلى Google Drive)' : 'Receipt Proof (Optional — Google Drive)'}
                </label>
                <input
                  type="file"
                  accept=".pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    if (!f) {
                      setAdvFormFile(null);
                      return;
                    }
                    const res = validatePayrollProofFile(f, isAr);
                    if (!res.valid) {
                      setErrorMsg(res.message);
                      return;
                    }
                    setAdvFormFile(f);
                  }}
                  className="w-full text-xs"
                />
                {advFormFile && (
                  <p className="text-[11px] text-slate-500 tabular-nums">
                    {advFormFile.name} ({formatFileSizeShort(advFormFile.size)})
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateAdvanceModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-[#1764FF] text-white font-bold"
              >
                {isAr ? 'تسجيل السحبية' : 'Record Advance'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Unsettled Advance Modal */}
      {editingAdvance && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleSaveAdvanceEdit}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md p-5 space-y-3 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{isAr ? 'تعديل سحبية غير مسوّاة' : 'Edit Unsettled Advance'}</h3>
              <button type="button" onClick={() => setEditingAdvance(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'المبلغ *' : 'Amount *'}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={editAdvAmount}
                  onChange={(e) => setEditAdvAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'التاريخ *' : 'Date *'}</label>
                <input
                  type="date"
                  required
                  value={editAdvDate}
                  onChange={(e) => setEditAdvDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'طريقة التسليم' : 'Method'}</label>
              <select
                value={editAdvMethod}
                onChange={(e) => setEditAdvMethod(e.target.value as PayrollPaymentMethod)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              >
                <option value="cash">{isAr ? 'نقدي' : 'Cash'}</option>
                <option value="bank_transfer">{isAr ? 'تحويل بنكي' : 'Bank Transfer'}</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'سبب السحبية *' : 'Advance Reason *'}</label>
              <input
                type="text"
                required
                value={editAdvReason}
                onChange={(e) => setEditAdvReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'سبب التعديل الإداري للتدقيق *' : 'Audit Reason *'}</label>
              <input
                type="text"
                required
                minLength={3}
                value={editAdvAuditReason}
                onChange={(e) => setEditAdvAuditReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingAdvance(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-[#1764FF] text-white font-bold"
              >
                {isAr ? 'حفظ التعديل' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Cancel Advance Modal */}
      {cancellingAdvance && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleConfirmCancelAdvance}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl text-xs"
          >
            <h3 className="text-base font-bold text-rose-700 dark:text-rose-400">
              {isAr ? 'تأكيد إلغاء السحبية إدارياً' : 'Confirm Advance Cancellation'}
            </h3>
            <p className="text-slate-600 dark:text-slate-300">
              {isAr
                ? `سيتم وسم سحبية العامل ${cancellingAdvance.workerNameSnapshot} (${fmt(
                    cancellingAdvance.amount
                  )}) كملغاة ولن تُخصم من الراتب، مع بقائها في السجل للتدقيق.`
                : `Advance for ${cancellingAdvance.workerNameSnapshot} (${fmt(
                    cancellingAdvance.amount
                  )}) will be marked cancelled and kept for audit.`}
            </p>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'سبب الإلغاء *' : 'Cancellation Reason *'}</label>
              <input
                type="text"
                required
                minLength={3}
                value={cancelAdvReason}
                onChange={(e) => setCancelAdvReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancellingAdvance(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'تراجع' : 'Back'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold"
              >
                {isAr ? 'تأكيد الإلغاء' : 'Confirm Cancel'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Retry / Upload Drive Proof Modal */}
      {retryProofTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleRetryProofUpload}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                {isAr ? 'رفع / إعادة مزامنة الإثبات إلى Google Drive' : 'Sync / Retry Proof to Google Drive'}
              </h3>
              <button type="button" onClick={() => setRetryProofTarget(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <p className="text-slate-500 dark:text-slate-400">
              {isAr
                ? 'تستخدم الخدمة المركزية مفتاح منع التكرار (clientUploadKey) لضمان عدم رفع نفس الإثبات مرتين حتى عند إعادة المحاولة.'
                : 'Uses deterministic clientUploadKey idempotency so retries never duplicate files in Google Drive.'}
            </p>
            <input
              ref={retryFileInputRef}
              type="file"
              required
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (!f) {
                  setRetryProofFile(null);
                  return;
                }
                const res = validatePayrollProofFile(f, isAr);
                if (!res.valid) {
                  setErrorMsg(res.message);
                  return;
                }
                setRetryProofFile(f);
              }}
              className="w-full"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRetryProofTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction || !retryProofFile}
                className="px-4 py-2 rounded-xl bg-[#1764FF] disabled:opacity-50 text-white font-bold"
              >
                {isAr ? 'رفع إلى Google Drive' : 'Upload to Google Drive'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Safe Trash Drive Proof Confirmation Modal */}
      {trashProofTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleConfirmTrashProof}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl text-xs"
          >
            <h3 className="text-base font-bold text-rose-700 dark:text-rose-400">
              {isAr ? 'نقل المرفق إلى سلة مهملات Google Drive' : 'Move Attachment to Google Drive Trash'}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              {isAr
                ? 'سيتم نقل الملف المرفق فقط إلى سلة مهملات Google Drive (حذف غير نهائي قابل للاسترجاع) مع بقاء السجل المالي سليماً بالكامل.'
                : 'Moves ONLY the attachment file to Google Drive Trash (reversible). The underlying financial record remains completely intact.'}
            </p>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'سبب نقل المرفق للسلة (اختياري)' : 'Reason (optional)'}</label>
              <input
                type="text"
                maxLength={300}
                value={trashProofReason}
                onChange={(e) => setTrashProofReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTrashProofTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'تراجع' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold"
              >
                {isAr ? 'تأكيد النقل إلى السلة' : 'Move to Trash'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Create / Edit Addition Modal */}
      {additionModalMode && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleSaveAddition}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                {additionModalMode === 'create'
                  ? isAr
                    ? 'إضافة مكافأة أو بدل'
                    : 'Add Bonus or Allowance'
                  : isAr
                  ? 'تعديل مكافأة أو بدل'
                  : 'Edit Bonus or Allowance'}
              </h3>
              <button type="button" onClick={() => setAdditionModalMode(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {additionModalMode === 'create' && (
                <div className="sm:col-span-2 space-y-1">
                  <label className="font-semibold">{isAr ? 'العامل *' : 'Worker *'}</label>
                  <select
                    required
                    value={addWorkerId}
                    onChange={(e) => setAddWorkerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                  >
                    <option value="">{isAr ? '-- اختر العامل --' : '-- Select Worker --'}</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.fullName} ({w.employeeNumber})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'التصنيف *' : 'Category *'}</label>
                <select
                  value={addCategory}
                  onChange={(e) => setAddCategory(e.target.value as WorkerAdditionCategory)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                >
                  {ADDITION_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {getAdditionCategoryLabel(cat, isAr)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? `المبلغ (${currency}) *` : `Amount (${currency}) *`}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] font-bold tabular-nums"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold">
                  {addCategory === 'custom'
                    ? isAr
                      ? 'المسمى المخصص *'
                      : 'Custom Label *'
                    : isAr
                    ? 'المسمى (اختياري)'
                    : 'Label (Optional)'}
                </label>
                <input
                  type="text"
                  required={addCategory === 'custom' || additionModalMode === 'edit'}
                  value={addCustomLabel}
                  onChange={(e) => setAddCustomLabel(e.target.value)}
                  placeholder={getAdditionCategoryLabel(addCategory, isAr)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                />
              </div>
              {additionModalMode === 'create' && (
                <div className="sm:col-span-2 space-y-1">
                  <label className="font-semibold">{isAr ? 'نوع التكرار *' : 'Recurrence *'}</label>
                  <select
                    value={addRecurrence}
                    onChange={(e) => setAddRecurrence(e.target.value as WorkerAdditionRecurrence)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                  >
                    <option value="one_time">{isAr ? 'مرة واحدة (لشهر محدد)' : 'One-Time (Specific Month)'}</option>
                    <option value="monthly_recurring">{isAr ? 'متكررة شهرياً' : 'Monthly Recurring'}</option>
                  </select>
                </div>
              )}
              {addRecurrence === 'one_time' ? (
                <div className="sm:col-span-2 space-y-1">
                  <label className="font-semibold">{isAr ? 'الشهر المستهدف *' : 'Target Month *'}</label>
                  <input
                    type="month"
                    required
                    value={addTargetMonth}
                    onChange={(e) => setAddTargetMonth(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="font-semibold">{isAr ? 'شهر البداية *' : 'Start Month *'}</label>
                    <input
                      type="month"
                      required
                      value={addStartMonth}
                      onChange={(e) => setAddStartMonth(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold">{isAr ? 'شهر النهاية (اختياري)' : 'End Month (Optional)'}</label>
                    <input
                      type="month"
                      value={addEndMonth}
                      onChange={(e) => setAddEndMonth(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                    />
                  </div>
                </>
              )}
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold">{isAr ? 'ملاحظات' : 'Notes'}</label>
                <input
                  type="text"
                  maxLength={400}
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                />
              </div>
              {additionModalMode === 'edit' && (
                <div className="sm:col-span-2 space-y-1">
                  <label className="font-semibold">{isAr ? 'سبب التعديل' : 'Edit Reason'}</label>
                  <input
                    type="text"
                    maxLength={300}
                    value={addEditReason}
                    onChange={(e) => setAddEditReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAdditionModalMode(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-[#1764FF] text-white font-bold"
              >
                {isAr ? 'حفظ' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Stop / Cancel Addition Modal */}
      {stopAdditionTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleConfirmStopAddition}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl text-xs"
          >
            <h3 className="text-base font-bold">
              {isAr ? `إيقاف / إلغاء الإضافة: ${stopAdditionTarget.label}` : `Stop / Cancel: ${stopAdditionTarget.label}`}
            </h3>
            <p className="text-slate-500">
              {isAr
                ? 'لن يتأثر أي كشف رواتب معتمد سابقاً؛ يطبق التغيير على الأشهر القادمة والمسودات فقط.'
                : 'Previously approved payroll statements remain immutable.'}
            </p>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'الإجراء' : 'Action'}</label>
              <select
                value={stopAdditionAction}
                onChange={(e) => setStopAdditionAction(e.target.value as 'stopped' | 'cancelled')}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              >
                {stopAdditionTarget.recurrence === 'monthly_recurring' && (
                  <option value="stopped">{isAr ? 'إيقاف الإضافة المتكررة' : 'Stop Recurring Addition'}</option>
                )}
                <option value="cancelled">{isAr ? 'إلغاء الإضافة' : 'Cancel Addition'}</option>
              </select>
            </div>
            {stopAdditionTarget.recurrence === 'monthly_recurring' && stopAdditionAction === 'stopped' && (
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'آخر شهر سريان' : 'Final Active Month'}</label>
                <input
                  type="month"
                  value={stopAdditionEndMonth}
                  onChange={(e) => setStopAdditionEndMonth(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'السبب' : 'Reason'}</label>
              <input
                type="text"
                maxLength={300}
                value={stopAdditionReason}
                onChange={(e) => setStopAdditionReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStopAdditionTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'تراجع' : 'Back'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-amber-600 text-white font-bold"
              >
                {isAr ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Approve Monthly Payroll Confirmation Modal */}
      {showApproveConfirm && currentRun && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl text-xs">
            <h3 className="text-base font-bold text-emerald-700 dark:text-emerald-400">
              {isAr ? `تأكيد اعتماد تصفية رواتب شهر ${selectedYearMonth}` : `Approve Payroll for ${selectedYearMonth}`}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              {isAr
                ? `بعد الاعتماد تُجمَّد لقطات جميع العمال (${currentRun.workersCount} عامل، صافي ${fmt(
                    currentRun.totalNetPayable
                  )}) وتُقفل السحبيات المشمولة لمنع الخصم المكرر، ولا يمكن التعديل لاحقاً إلا عبر إجراء التصحيح الإداري الموثق.`
                : `Approving freezes ${currentRun.workersCount} worker statements (Net ${fmt(
                    currentRun.totalNetPayable
                  )}) and locks settled advances against double deduction.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowApproveConfirm(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'تراجع' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleApproveRun()}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold"
              >
                {busyAction ? (isAr ? 'جارٍ الاعتماد...' : 'Approving...') : isAr ? 'اعتماد نهائي' : 'Approve Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documented Administrative Correction Modal */}
      {correctingItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleSaveAdminCorrection}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-amber-700 dark:text-amber-400">
                {isAr
                  ? `تصحيح إداري موثق — ${correctingItem.workerNameSnapshot} (${correctingItem.yearMonth})`
                  : `Admin Correction — ${correctingItem.workerNameSnapshot} (${correctingItem.yearMonth})`}
              </h3>
              <button type="button" onClick={() => setCorrectingItem(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'الراتب الأساسي' : 'Base Salary'}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={corrBase}
                  onChange={(e) => setCorrBase(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'إجمالي الإضافات' : 'Additions Total'}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={corrAdditions}
                  onChange={(e) => setCorrAdditions(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'إجمالي السحبيات' : 'Advances Total'}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={corrAdvances}
                  onChange={(e) => setCorrAdvances(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'الرصيد المرحّل السابق' : 'Carry-Over In'}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={corrCarryIn}
                  onChange={(e) => setCorrCarryIn(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="font-semibold">{isAr ? 'السبب الإداري الموثق (5 أحرف على الأقل) *' : 'Documented Reason (min 5 chars) *'}</label>
                <input
                  type="text"
                  required
                  minLength={5}
                  maxLength={500}
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCorrectingItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-amber-600 text-white font-bold"
              >
                {isAr ? 'حفظ التصحيح الموثق' : 'Save Correction'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Record Salary Payment Modal */}
      {payingItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleRecordPayment}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                {isAr ? `صرف راتب: ${payingItem.workerNameSnapshot}` : `Disburse Salary: ${payingItem.workerNameSnapshot}`}
              </h3>
              <button type="button" onClick={() => setPayingItem(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] flex items-center justify-between tabular-nums">
              <span>{isAr ? 'المتبقي المستحق للصرف:' : 'Remaining Payable:'}</span>
              <strong className="text-sm text-[#1764FF] dark:text-[#6CA2FF]">
                {fmt(payingItem.remainingPayable)}
              </strong>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? `مبلغ الدفعة (${currency}) *` : `Payment Amount (${currency}) *`}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={payingItem.remainingPayable}
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] font-bold tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'تاريخ الصرف *' : 'Payment Date *'}</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'طريقة الدفع *' : 'Payment Method *'}</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PayrollPaymentMethod)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                >
                  <option value="bank_transfer">{isAr ? 'تحويل بنكي (توثيق فقط)' : 'Bank Transfer (Record Only)'}</option>
                  <option value="cash">{isAr ? 'نقدي' : 'Cash'}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold">{isAr ? 'ملاحظات / رقم المرجع' : 'Notes / Reference'}</label>
                <input
                  type="text"
                  maxLength={500}
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold">
                  {isAr ? 'إثبات الصرف (إيصال / تحويل — اختياري، Google Drive)' : 'Payment Proof (Optional — Google Drive)'}
                </label>
                <input
                  type="file"
                  accept=".pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    if (!f) {
                      setPayProofFile(null);
                      return;
                    }
                    const res = validatePayrollProofFile(f, isAr);
                    if (!res.valid) {
                      setErrorMsg(res.message);
                      return;
                    }
                    setPayProofFile(f);
                  }}
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayingItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-[#1764FF] text-white font-bold"
              >
                {busyAction ? (isAr ? 'جارٍ التسجيل...' : 'Recording...') : isAr ? 'تسجيل الدفعة' : 'Record Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reverse Payment Modal */}
      {reversingPayment && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleConfirmReversePayment}
            className="bg-white dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl text-xs"
          >
            <h3 className="text-base font-bold text-rose-700 dark:text-rose-400">
              {isAr ? 'تأكيد عكس دفعة الراتب' : 'Confirm Payment Reversal'}
            </h3>
            <p className="text-slate-600 dark:text-slate-300">
              {isAr
                ? `سيتم عكس دفعة ${fmt(reversingPayment.amount)} للعامل ${reversingPayment.workerNameSnapshot} وإعادة إضافتها للرصيد المتبقي، دون حذف السجل من التدقيق.`
                : `Reverses ${fmt(reversingPayment.amount)} for ${reversingPayment.workerNameSnapshot} and restores remaining payable without deleting audit records.`}
            </p>
            <div className="space-y-1">
              <label className="font-semibold">{isAr ? 'سبب العكس *' : 'Reversal Reason *'}</label>
              <input
                type="text"
                required
                minLength={3}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F8FF] dark:bg-[#122543] border border-[#DCE6FA] dark:border-[#1F3B66]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReversingPayment(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#173056] font-semibold"
              >
                {isAr ? 'تراجع' : 'Back'}
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold"
              >
                {isAr ? 'تأكيد العكس' : 'Confirm Reversal'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
