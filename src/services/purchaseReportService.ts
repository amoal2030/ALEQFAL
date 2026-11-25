/**
 * Purchase Reports Service — الإقفال | AL EQFAL
 * Organization Manager Purchase Analytics, Filtering, Integer-Halala Aggregation,
 * Multi-Sheet RTL Arabic Excel (.xlsx) Export, and Native-Shaped RTL Arabic PDF Export.
 *
 * - Strictly reads real Firestore `/purchases`, `/purchases/{id}/items`, and `/suppliers`
 * - Uses single-field `where('orgId', '==', orgId)` queries (no composite indexes required)
 * - Uses integer Halala arithmetic (`toHalalas` / `fromHalalas`) for 100% accounting accuracy
 * - Preserves full compatibility with both legacy inline `purchase.items` and Step 3 subcollection items
 */
import ExcelJS from 'exceljs';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, OperationType } from '../lib/firebase';
import type {
  AttachmentItem,
  Branch,
  Organization,
  Purchase,
  PurchaseLineItem,
  PurchasePaymentMethod,
  PurchaseSubLineItem,
  Supplier,
  UserProfile,
} from '../types';
import { fromHalalas, toHalalas } from '../utils/accounting';

export type PurchaseReportDatePreset = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';

export interface PurchaseReportFilters {
  datePreset: PurchaseReportDatePreset;
  fromDate: string;
  toDate: string;
  branchId: string; // 'all' or specific branchId
  supplierId: string; // 'all' or specific supplierId
  searchQuery: string;
}

export const DEFAULT_PURCHASE_REPORT_FILTERS: PurchaseReportFilters = {
  datePreset: 'all',
  fromDate: '',
  toDate: '',
  branchId: 'all',
  supplierId: 'all',
  searchQuery: '',
};

export const PAYMENT_METHOD_AR: Record<PurchasePaymentMethod, string> = {
  cash: 'نقدي',
  card: 'شبكة / بطاقة',
  transfer: 'تحويل بنكي',
  credit: 'آجل',
};

export interface EnrichedPurchaseInvoice {
  purchase: Purchase;
  id: string;
  date: string;
  invoiceNumber: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  supplierTaxNumber: string;
  paymentMethod: PurchasePaymentMethod;
  paymentMethodLabel: string;
  subtotalAmount: number;
  discountAmount: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  subtotalHalalas: number;
  discountHalalas: number;
  vatHalalas: number;
  totalHalalas: number;
  notes: string;
  createdByName: string;
  attachmentsCount: number;
  items: PurchaseLineItem[];
  hasLoadedItems: boolean;
}

export interface PurchaseGroupBreakdown {
  id: string;
  name: string;
  secondaryLabel?: string;
  invoiceCount: number;
  subtotalAmount: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  totalHalalas: number;
  sharePercent: number;
}

export interface PurchaseReportSummary {
  invoiceCount: number;
  subtotalAmount: number;
  totalDiscount: number;
  totalVat: number;
  totalAmount: number;
  averageInvoiceAmount: number;
  subtotalHalalas: number;
  discountHalalas: number;
  vatHalalas: number;
  totalHalalas: number;
}

export interface PurchaseReportFilterLabels {
  periodLabel: string;
  branchLabel: string;
  supplierLabel: string;
  searchLabel: string;
}

export interface ComputedPurchaseReport {
  invoices: EnrichedPurchaseInvoice[];
  summary: PurchaseReportSummary;
  byBranch: PurchaseGroupBreakdown[];
  bySupplier: PurchaseGroupBreakdown[];
  filterLabels: PurchaseReportFilterLabels;
}

export interface PurchaseReportPdfModel {
  title: string;
  organizationName: string;
  currency: string;
  generatedDate: string;
  generatedTime: string;
  filterLabels: PurchaseReportFilterLabels;
  summary: PurchaseReportSummary;
  byBranch: PurchaseGroupBreakdown[];
  bySupplier: PurchaseGroupBreakdown[];
  invoices: EnrichedPurchaseInvoice[];
  allItemRows: Array<{
    invoiceNumber: string;
    date: string;
    branchName: string;
    supplierName: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
}

function formatDateIsoLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function resolveDatePresetBounds(
  preset: PurchaseReportDatePreset,
  fromDate: string,
  toDate: string,
  referenceDate: Date = new Date()
): { from: string | null; to: string | null; label: string } {
  const today = formatDateIsoLocal(referenceDate);

  switch (preset) {
    case 'today':
      return { from: today, to: today, label: `اليوم (${today})` };
    case 'week': {
      const weekAgo = new Date(referenceDate.getTime() - 6 * 24 * 60 * 60 * 1000);
      const from = formatDateIsoLocal(weekAgo);
      return { from, to: today, label: `آخر 7 أيام (${from} إلى ${today})` };
    }
    case 'month': {
      const firstOfMonth = formatDateIsoLocal(
        new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
      );
      return { from: firstOfMonth, to: today, label: `الشهر الحالي (${firstOfMonth} إلى ${today})` };
    }
    case 'year': {
      const firstOfYear = formatDateIsoLocal(new Date(referenceDate.getFullYear(), 0, 1));
      return { from: firstOfYear, to: today, label: `السنة الحالية (${firstOfYear} إلى ${today})` };
    }
    case 'custom': {
      const cleanFrom = (fromDate || '').trim() || null;
      const cleanTo = (toDate || '').trim() || null;
      if (cleanFrom && cleanTo) {
        return { from: cleanFrom, to: cleanTo, label: `من ${cleanFrom} إلى ${cleanTo}` };
      }
      if (cleanFrom) {
        return { from: cleanFrom, to: null, label: `من تاريخ ${cleanFrom}` };
      }
      if (cleanTo) {
        return { from: null, to: cleanTo, label: `حتى تاريخ ${cleanTo}` };
      }
      return { from: null, to: null, label: 'فترة مخصصة (الكل)' };
    }
    case 'all':
    default:
      return { from: null, to: null, label: 'كافة الفترات' };
  }
}

function normalizePurchaseMoney(p: Purchase): {
  subtotalHalalas: number;
  discountHalalas: number;
  vatRate: number;
  vatHalalas: number;
  totalHalalas: number;
} {
  const rawSubtotal =
    typeof p.subtotalAmount === 'number' && Number.isFinite(p.subtotalAmount)
      ? p.subtotalAmount
      : typeof p.amount === 'number' && Number.isFinite(p.amount)
        ? p.amount
        : 0;
  const rawDiscount =
    typeof p.discountAmount === 'number' && Number.isFinite(p.discountAmount)
      ? p.discountAmount
      : 0;
  const rawVat =
    typeof p.vatAmount === 'number' && Number.isFinite(p.vatAmount) ? p.vatAmount : 0;
  const rawVatRate =
    typeof p.vatRate === 'number' && Number.isFinite(p.vatRate) ? p.vatRate : 0;

  const subtotalHalalas = Math.max(0, toHalalas(rawSubtotal));
  const discountHalalas = Math.max(0, toHalalas(rawDiscount));
  const vatHalalas = Math.max(0, toHalalas(rawVat));

  const computedTotalHalalas = Math.max(0, subtotalHalalas - discountHalalas + vatHalalas);
  const totalHalalas =
    typeof p.totalAmount === 'number' && Number.isFinite(p.totalAmount)
      ? Math.max(0, toHalalas(p.totalAmount))
      : computedTotalHalalas;

  return {
    subtotalHalalas,
    discountHalalas,
    vatRate: rawVatRate,
    vatHalalas,
    totalHalalas,
  };
}

/**
 * Pure, deterministic integer-Halala purchase reporting & aggregation engine.
 * Guarantees exact parity across UI cards, breakdown tables, invoices table, Excel, and PDF.
 */
export function computePurchaseReport(params: {
  purchases: readonly Purchase[];
  branches: readonly Branch[];
  suppliers: readonly Supplier[];
  filters: PurchaseReportFilters;
  itemsByPurchaseId?: Readonly<Record<string, readonly PurchaseLineItem[]>>;
  referenceDate?: Date;
}): ComputedPurchaseReport {
  const {
    purchases,
    branches,
    suppliers,
    filters,
    itemsByPurchaseId = {},
    referenceDate = new Date(),
  } = params;

  const branchMap = new Map<string, Branch>();
  for (const b of branches) branchMap.set(b.id, b);

  const supplierMap = new Map<string, Supplier>();
  for (const s of suppliers) supplierMap.set(s.id, s);

  const bounds = resolveDatePresetBounds(
    filters.datePreset,
    filters.fromDate,
    filters.toDate,
    referenceDate
  );

  const searchLower = (filters.searchQuery || '').trim().toLowerCase();

  const enriched: EnrichedPurchaseInvoice[] = [];

  for (const p of purchases) {
    // 1. Date range filter
    if (bounds.from && p.date < bounds.from) continue;
    if (bounds.to && p.date > bounds.to) continue;

    // 2. Branch filter
    if (filters.branchId && filters.branchId !== 'all' && p.branchId !== filters.branchId) {
      continue;
    }

    // 3. Supplier filter
    if (filters.supplierId && filters.supplierId !== 'all' && p.supplierId !== filters.supplierId) {
      continue;
    }

    const branchObj = branchMap.get(p.branchId);
    const supplierObj = supplierMap.get(p.supplierId);

    const branchName = (branchObj?.name || p.branchName || p.branchId || 'فرع غير محدد').trim();
    const supplierName = (supplierObj?.name || p.supplierName || p.supplierId || 'مورد غير محدد').trim();
    const supplierTaxNumber = (p.taxNumber || supplierObj?.taxNumber || '').trim();
    const invoiceNumber = (p.invoiceNumber || '').trim() || p.id.slice(0, 14);
    const paymentMethodLabel = PAYMENT_METHOD_AR[p.paymentMethod] || p.paymentMethod;
    const notes = (p.notes || '').trim();
    const createdByName = (p.createdByName || '').trim();

    const loadedSubItems = itemsByPurchaseId[p.id];
    const inlineItems = Array.isArray(p.items) ? p.items : [];
    const items: PurchaseLineItem[] =
      loadedSubItems !== undefined ? [...loadedSubItems] : [...inlineItems];
    const hasLoadedItems = loadedSubItems !== undefined || inlineItems.length > 0;

    // 4. Search filter (invoice #, id, supplier, tax #, branch, notes, payment method, loaded items)
    if (searchLower) {
      const haystacks = [
        invoiceNumber,
        p.id,
        supplierName,
        supplierTaxNumber,
        branchName,
        notes,
        paymentMethodLabel,
        createdByName,
        ...items.map((it) => it.name),
      ];
      const matched = haystacks.some((h) => h.toLowerCase().includes(searchLower));
      if (!matched) continue;
    }

    const money = normalizePurchaseMoney(p);

    enriched.push({
      purchase: p,
      id: p.id,
      date: p.date,
      invoiceNumber,
      branchId: p.branchId,
      branchName,
      supplierId: p.supplierId,
      supplierName,
      supplierTaxNumber,
      paymentMethod: p.paymentMethod,
      paymentMethodLabel,
      subtotalAmount: fromHalalas(money.subtotalHalalas),
      discountAmount: fromHalalas(money.discountHalalas),
      vatRate: money.vatRate,
      vatAmount: fromHalalas(money.vatHalalas),
      totalAmount: fromHalalas(money.totalHalalas),
      subtotalHalalas: money.subtotalHalalas,
      discountHalalas: money.discountHalalas,
      vatHalalas: money.vatHalalas,
      totalHalalas: money.totalHalalas,
      notes,
      createdByName,
      attachmentsCount: Array.isArray(p.attachmentIds) ? p.attachmentIds.length : 0,
      items,
      hasLoadedItems,
    });
  }

  // Sort newest date first, then createdAt descending
  enriched.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.purchase.createdAt || '').localeCompare(a.purchase.createdAt || '');
  });

  // Integer-Halala Totals & Group Aggregations
  let subtotalHalalas = 0;
  let discountHalalas = 0;
  let vatHalalas = 0;
  let totalHalalas = 0;

  const branchAcc = new Map<
    string,
    {
      id: string;
      name: string;
      secondaryLabel?: string;
      invoiceCount: number;
      subtotalHalalas: number;
      discountHalalas: number;
      vatHalalas: number;
      totalHalalas: number;
    }
  >();

  const supplierAcc = new Map<
    string,
    {
      id: string;
      name: string;
      secondaryLabel?: string;
      invoiceCount: number;
      subtotalHalalas: number;
      discountHalalas: number;
      vatHalalas: number;
      totalHalalas: number;
    }
  >();

  for (const inv of enriched) {
    subtotalHalalas += inv.subtotalHalalas;
    discountHalalas += inv.discountHalalas;
    vatHalalas += inv.vatHalalas;
    totalHalalas += inv.totalHalalas;

    // Group by branch
    const bEntry = branchAcc.get(inv.branchId) ?? {
      id: inv.branchId,
      name: inv.branchName,
      secondaryLabel: branchMap.get(inv.branchId)?.code,
      invoiceCount: 0,
      subtotalHalalas: 0,
      discountHalalas: 0,
      vatHalalas: 0,
      totalHalalas: 0,
    };
    bEntry.invoiceCount += 1;
    bEntry.subtotalHalalas += inv.subtotalHalalas;
    bEntry.discountHalalas += inv.discountHalalas;
    bEntry.vatHalalas += inv.vatHalalas;
    bEntry.totalHalalas += inv.totalHalalas;
    branchAcc.set(inv.branchId, bEntry);

    // Group by supplier
    const sEntry = supplierAcc.get(inv.supplierId) ?? {
      id: inv.supplierId,
      name: inv.supplierName,
      secondaryLabel: inv.supplierTaxNumber || undefined,
      invoiceCount: 0,
      subtotalHalalas: 0,
      discountHalalas: 0,
      vatHalalas: 0,
      totalHalalas: 0,
    };
    sEntry.invoiceCount += 1;
    sEntry.subtotalHalalas += inv.subtotalHalalas;
    sEntry.discountHalalas += inv.discountHalalas;
    sEntry.vatHalalas += inv.vatHalalas;
    sEntry.totalHalalas += inv.totalHalalas;
    supplierAcc.set(inv.supplierId, sEntry);
  }

  const mapBreakdown = (
    entries: Iterable<{
      id: string;
      name: string;
      secondaryLabel?: string;
      invoiceCount: number;
      subtotalHalalas: number;
      discountHalalas: number;
      vatHalalas: number;
      totalHalalas: number;
    }>
  ): PurchaseGroupBreakdown[] => {
    return Array.from(entries)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        secondaryLabel: entry.secondaryLabel,
        invoiceCount: entry.invoiceCount,
        subtotalAmount: fromHalalas(entry.subtotalHalalas),
        discountAmount: fromHalalas(entry.discountHalalas),
        vatAmount: fromHalalas(entry.vatHalalas),
        totalAmount: fromHalalas(entry.totalHalalas),
        totalHalalas: entry.totalHalalas,
        sharePercent:
          totalHalalas > 0 ? Math.round((entry.totalHalalas / totalHalalas) * 1000) / 10 : 0,
      }))
      .sort((a, b) => {
        if (b.totalHalalas !== a.totalHalalas) return b.totalHalalas - a.totalHalalas;
        return a.name.localeCompare(b.name, 'ar');
      });
  };

  const invoiceCount = enriched.length;
  const avgHalalas = invoiceCount > 0 ? Math.round(totalHalalas / invoiceCount) : 0;

  const selectedBranch =
    filters.branchId && filters.branchId !== 'all' ? branchMap.get(filters.branchId) : null;
  const selectedSupplier =
    filters.supplierId && filters.supplierId !== 'all'
      ? supplierMap.get(filters.supplierId)
      : null;

  return {
    invoices: enriched,
    summary: {
      invoiceCount,
      subtotalAmount: fromHalalas(subtotalHalalas),
      totalDiscount: fromHalalas(discountHalalas),
      totalVat: fromHalalas(vatHalalas),
      totalAmount: fromHalalas(totalHalalas),
      averageInvoiceAmount: fromHalalas(avgHalalas),
      subtotalHalalas,
      discountHalalas,
      vatHalalas,
      totalHalalas,
    },
    byBranch: mapBreakdown(branchAcc.values()),
    bySupplier: mapBreakdown(supplierAcc.values()),
    filterLabels: {
      periodLabel: bounds.label,
      branchLabel:
        filters.branchId === 'all'
          ? 'جميع الفروع'
          : selectedBranch?.name || filters.branchId,
      supplierLabel:
        filters.supplierId === 'all'
          ? 'جميع الموردين'
          : selectedSupplier?.name || filters.supplierId,
      searchLabel: searchLower ? filters.searchQuery.trim() : 'بدون بحث نصي',
    },
  };
}

// ---------------------------------------------------------------------------
// Firestore Real Data Fetchers (Organization Manager Scoped)
// ---------------------------------------------------------------------------

function mapReportFirestoreError(err: unknown, operation: OperationType, path: string): Error {
  const code = (err as any)?.code || '';
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Purchase Report Firestore Error:', { operation, path, code, message: msg });
  if (code === 'permission-denied' || msg.toLowerCase().includes('permission')) {
    return new Error('تم رفض قراءة بيانات المشتريات بواسطة قواعد الأمان. يرجى التحقق من صلاحيات حسابك.');
  }
  if (code === 'unavailable' || msg.toLowerCase().includes('network')) {
    return new Error('تعذر الاتصال بقاعدة البيانات حالياً. يرجى التحقق من الاتصال بالإنترنت.');
  }
  return new Error(msg || 'حدث خطأ غير متوقع أثناء تحميل تقارير المشتريات.');
}

function assertManagerOrgScope(
  userProfile: UserProfile | null | undefined,
  orgId: string
): void {
  if (!userProfile || userProfile.isActive !== true) {
    throw new Error('حسابك غير مفعل أو غير مصرح له بعرض تقارير المشتريات.');
  }
  if (userProfile.role !== 'manager') {
    throw new Error('تقارير المشتريات المستقلة مخصصة لحساب مدير المؤسسة فقط.');
  }
  if (!orgId || userProfile.orgId !== orgId) {
    throw new Error('تعذر التحقق من انتماء الحساب للمؤسسة المطلوبة.');
  }
}

export async function fetchOrganizationPurchasesForReport(
  userProfile: UserProfile | null | undefined,
  orgId: string
): Promise<Purchase[]> {
  assertManagerOrgScope(userProfile, orgId);
  try {
    const q = query(collection(db, 'purchases'), where('orgId', '==', orgId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ ...(d.data() as Purchase), id: d.id }))
      .filter((p) => p.orgId === orgId)
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
  } catch (err) {
    throw mapReportFirestoreError(err, OperationType.LIST, 'purchases');
  }
}

export async function fetchOrganizationSuppliersForReport(
  userProfile: UserProfile | null | undefined,
  orgId: string
): Promise<Supplier[]> {
  assertManagerOrgScope(userProfile, orgId);
  try {
    const q = query(collection(db, 'suppliers'), where('orgId', '==', orgId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ ...(d.data() as Supplier), id: d.id }))
      .filter((s) => s.orgId === orgId)
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  } catch (err) {
    throw mapReportFirestoreError(err, OperationType.LIST, 'suppliers');
  }
}

/**
 * Fetches line items for a specific purchase invoice:
 * - Reads `/purchases/{purchaseId}/items` subcollection (sorted by `lineIndex`)
 * - Falls back seamlessly to legacy inline `purchase.items` when subcollection is empty
 */
export async function fetchPurchaseItemsForInvoice(
  purchase: Purchase
): Promise<PurchaseLineItem[]> {
  try {
    const snap = await getDocs(collection(db, 'purchases', purchase.id, 'items'));
    if (!snap.empty) {
      const subItems = snap.docs
        .map((d) => ({ ...(d.data() as PurchaseSubLineItem), id: d.id }))
        .sort((a, b) => (a.lineIndex ?? 0) - (b.lineIndex ?? 0));
      return subItems.map((it) => ({
        id: it.id,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total,
      }));
    }
  } catch (err) {
    console.warn(`Unable to load subcollection items for purchase ${purchase.id}:`, err);
  }

  return Array.isArray(purchase.items) ? [...purchase.items] : [];
}

/**
 * Fetches `/attachments` records linked to a specific purchase invoice (scoped to `orgId`).
 */
export async function fetchPurchaseAttachmentsForInvoice(
  purchase: Purchase
): Promise<AttachmentItem[]> {
  try {
    const q = query(
      collection(db, 'attachments'),
      where('orgId', '==', purchase.orgId),
      where('purchaseId', '==', purchase.id)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ ...(d.data() as AttachmentItem), id: d.id }))
      .filter((att) => att.orgId === purchase.orgId && att.purchaseId === purchase.id)
      .sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')));
  } catch (err) {
    console.warn(`Unable to load attachments for purchase ${purchase.id}:`, err);
    return [];
  }
}

/**
 * Loads subcollection line items for all invoices in a report that aren't cached yet.
 * Used before exporting Excel / PDF so exported files include 100% of invoice line items.
 */
export async function loadAllInvoiceItemsForExport(
  invoices: readonly EnrichedPurchaseInvoice[],
  existingCache: Readonly<Record<string, PurchaseLineItem[]>>
): Promise<Record<string, PurchaseLineItem[]>> {
  const nextCache: Record<string, PurchaseLineItem[]> = { ...existingCache };
  const toFetch = invoices.filter((inv) => nextCache[inv.id] === undefined);

  const CONCURRENCY = 8;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const slice = toFetch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (inv) => {
        const items = await fetchPurchaseItemsForInvoice(inv.purchase);
        return { id: inv.id, items };
      })
    );
    for (const r of results) {
      nextCache[r.id] = r.items;
    }
  }

  return nextCache;
}

// ---------------------------------------------------------------------------
// Excel (.xlsx) Export — True RTL Arabic Multi-Sheet Workbook
// ---------------------------------------------------------------------------

const CELL_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const NAVY_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0B192C' },
};

const SUBHEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0F2038' },
};

const TOTAL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFEF3C7' },
};

const ZEBRA_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF8FAFC' },
};

function styleTableHeaderRow(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.fill = SUBHEADER_FILL;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFF59E0B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = CELL_BORDER;
  });
}

function styleTotalRow(row: ExcelJS.Row, numericCols: number[]) {
  row.height = 24;
  row.eachCell((cell, colNumber) => {
    cell.fill = TOTAL_FILL;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0B192C' } };
    cell.border = CELL_BORDER;
    if (numericCols.includes(colNumber)) {
      cell.numFmt = '#,##0.00';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    } else {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  });
}

export async function generatePurchaseReportExcel(params: {
  report: ComputedPurchaseReport;
  org?: Organization | null;
  generatedAt?: Date;
}): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { report, org, generatedAt = new Date() } = params;
  const currency = org?.currency || 'SAR';
  const orgName = org?.name || 'الإقفال | AL EQFAL';
  const dateTag = formatDateIsoLocal(generatedAt);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AL EQFAL';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  // =========================================================================
  // SHEET 1: ملخص المشتريات (Summary, Filters, By Branch, By Supplier)
  // =========================================================================
  const wsSummary = workbook.addWorksheet('ملخص المشتريات', {
    views: [{ rightToLeft: true }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  wsSummary.columns = [
    { width: 28 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 14 },
  ];

  // Title Banner
  wsSummary.mergeCells('A1:G1');
  const titleCell = wsSummary.getCell('A1');
  titleCell.value = `تقرير المشتريات التفصيلي — ${orgName}`;
  titleCell.fill = NAVY_FILL;
  titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  wsSummary.getRow(1).height = 32;

  // Metadata & Filters rows
  const metaRows: Array<[string, string, string, string]> = [
    ['اسم المؤسسة', orgName, 'العملة', currency],
    ['الفترة الزمنية', report.filterLabels.periodLabel, 'تاريخ التصدير', dateTag],
    ['الفرع المحدد', report.filterLabels.branchLabel, 'المورد المحدد', report.filterLabels.supplierLabel],
    ['نطاق البحث', report.filterLabels.searchLabel, 'عدد الفواتير', String(report.summary.invoiceCount)],
  ];

  for (const [k1, v1, k2, v2] of metaRows) {
    const r = wsSummary.addRow([k1, v1, '', '', k2, v2, '']);
    wsSummary.mergeCells(`B${r.number}:D${r.number}`);
    wsSummary.mergeCells(`F${r.number}:G${r.number}`);
    r.height = 20;
    r.eachCell((cell, col) => {
      cell.border = CELL_BORDER;
      if (col === 1 || col === 5) {
        cell.fill = ZEBRA_FILL;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0B192C' } };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  }

  wsSummary.addRow([]);

  // KPI Section
  const kpiTitleRow = wsSummary.addRow(['المؤشرات المالية الإجمالية للمشتريات']);
  wsSummary.mergeCells(`A${kpiTitleRow.number}:G${kpiTitleRow.number}`);
  kpiTitleRow.height = 24;
  kpiTitleRow.getCell(1).fill = NAVY_FILL;
  kpiTitleRow.getCell(1).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFF59E0B' } };
  kpiTitleRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };

  const kpiHead = wsSummary.addRow([
    'إجمالي قيمة المشتريات',
    'عدد الفواتير',
    'المجموع قبل الضريبة',
    'إجمالي الخصومات',
    'إجمالي الضرائب',
    'متوسط قيمة الفاتورة',
    'العملة',
  ]);
  styleTableHeaderRow(kpiHead);

  const kpiVals = wsSummary.addRow([
    report.summary.totalAmount,
    report.summary.invoiceCount,
    report.summary.subtotalAmount,
    report.summary.totalDiscount,
    report.summary.totalVat,
    report.summary.averageInvoiceAmount,
    currency,
  ]);
  kpiVals.height = 24;
  kpiVals.eachCell((cell, col) => {
    cell.border = CELL_BORDER;
    cell.fill = TOTAL_FILL;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0B192C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (col === 1 || col === 3 || col === 4 || col === 5 || col === 6) {
      cell.numFmt = '#,##0.00';
    } else if (col === 2) {
      cell.numFmt = '#,##0';
    }
  });

  wsSummary.addRow([]);

  // Branch Breakdown Section
  const brSectionRow = wsSummary.addRow(['إجمالي المشتريات حسب الفرع']);
  wsSummary.mergeCells(`A${brSectionRow.number}:G${brSectionRow.number}`);
  brSectionRow.height = 24;
  brSectionRow.getCell(1).fill = NAVY_FILL;
  brSectionRow.getCell(1).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  brSectionRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };

  styleTableHeaderRow(
    wsSummary.addRow([
      'الفرع',
      'عدد الفواتير',
      `قبل الضريبة (${currency})`,
      `الخصومات (${currency})`,
      `الضرائب (${currency})`,
      `الإجمالي (${currency})`,
      'النسبة %',
    ])
  );

  for (const b of report.byBranch) {
    const r = wsSummary.addRow([
      b.name,
      b.invoiceCount,
      b.subtotalAmount,
      b.discountAmount,
      b.vatAmount,
      b.totalAmount,
      `${b.sharePercent.toFixed(1)}%`,
    ]);
    r.height = 20;
    r.eachCell((cell, col) => {
      cell.border = CELL_BORDER;
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
      if (col >= 3 && col <= 6) {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (col === 2 || col === 7) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  }

  const brTotalRow = wsSummary.addRow([
    `إجمالي الفروع (${report.byBranch.length})`,
    report.summary.invoiceCount,
    report.summary.subtotalAmount,
    report.summary.totalDiscount,
    report.summary.totalVat,
    report.summary.totalAmount,
    report.summary.totalAmount > 0 ? '100.0%' : '0.0%',
  ]);
  styleTotalRow(brTotalRow, [3, 4, 5, 6]);

  wsSummary.addRow([]);

  // Supplier Breakdown Section
  const supSectionRow = wsSummary.addRow(['إجمالي المشتريات حسب المورد']);
  wsSummary.mergeCells(`A${supSectionRow.number}:G${supSectionRow.number}`);
  supSectionRow.height = 24;
  supSectionRow.getCell(1).fill = NAVY_FILL;
  supSectionRow.getCell(1).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  supSectionRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };

  styleTableHeaderRow(
    wsSummary.addRow([
      'المورد',
      'عدد الفواتير',
      `قبل الضريبة (${currency})`,
      `الخصومات (${currency})`,
      `الضرائب (${currency})`,
      `الإجمالي (${currency})`,
      'النسبة %',
    ])
  );

  for (const s of report.bySupplier) {
    const r = wsSummary.addRow([
      s.secondaryLabel ? `${s.name} (${s.secondaryLabel})` : s.name,
      s.invoiceCount,
      s.subtotalAmount,
      s.discountAmount,
      s.vatAmount,
      s.totalAmount,
      `${s.sharePercent.toFixed(1)}%`,
    ]);
    r.height = 20;
    r.eachCell((cell, col) => {
      cell.border = CELL_BORDER;
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
      if (col >= 3 && col <= 6) {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (col === 2 || col === 7) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  }

  const supTotalRow = wsSummary.addRow([
    `إجمالي الموردين (${report.bySupplier.length})`,
    report.summary.invoiceCount,
    report.summary.subtotalAmount,
    report.summary.totalDiscount,
    report.summary.totalVat,
    report.summary.totalAmount,
    report.summary.totalAmount > 0 ? '100.0%' : '0.0%',
  ]);
  styleTotalRow(supTotalRow, [3, 4, 5, 6]);

  // =========================================================================
  // SHEET 2: تفاصيل الفواتير
  // =========================================================================
  const wsInvoices = workbook.addWorksheet('تفاصيل الفواتير', {
    views: [{ rightToLeft: true }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  wsInvoices.columns = [
    { width: 13 }, // date
    { width: 18 }, // invoice #
    { width: 20 }, // branch
    { width: 24 }, // supplier
    { width: 18 }, // tax #
    { width: 14 }, // payment method
    { width: 10 }, // items count
    { width: 16 }, // subtotal
    { width: 14 }, // discount
    { width: 11 }, // vatRate
    { width: 15 }, // vatAmount
    { width: 17 }, // totalAmount
    { width: 26 }, // notes
  ];

  wsInvoices.mergeCells('A1:M1');
  const invBanner = wsInvoices.getCell('A1');
  invBanner.value = `تفاصيل فواتير المشتريات — ${orgName} (${report.filterLabels.periodLabel})`;
  invBanner.fill = NAVY_FILL;
  invBanner.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  invBanner.alignment = { horizontal: 'center', vertical: 'middle' };
  wsInvoices.getRow(1).height = 28;

  styleTableHeaderRow(
    wsInvoices.addRow([
      'التاريخ',
      'رقم الفاتورة',
      'الفرع',
      'المورد',
      'الرقم الضريبي',
      'طريقة الدفع',
      'الأصناف',
      `قبل الضريبة (${currency})`,
      `الخصم (${currency})`,
      'الضريبة %',
      `قيمة الضريبة (${currency})`,
      `الإجمالي (${currency})`,
      'الملاحظات',
    ])
  );

  report.invoices.forEach((inv, idx) => {
    const r = wsInvoices.addRow([
      inv.date,
      inv.invoiceNumber,
      inv.branchName,
      inv.supplierName,
      inv.supplierTaxNumber || '—',
      inv.paymentMethodLabel,
      inv.items.length,
      inv.subtotalAmount,
      inv.discountAmount,
      `${inv.vatRate}%`,
      inv.vatAmount,
      inv.totalAmount,
      inv.notes || '',
    ]);
    r.height = 20;
    r.eachCell((cell, col) => {
      cell.border = CELL_BORDER;
      if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
      if (col === 8 || col === 9 || col === 11 || col === 12) {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (col === 1 || col === 2 || col === 5 || col === 6 || col === 7 || col === 10) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  });

  const invTotalRow = wsInvoices.addRow([
    `المجموع الكلي (${report.summary.invoiceCount} فاتورة)`,
    '',
    '',
    '',
    '',
    '',
    '',
    report.summary.subtotalAmount,
    report.summary.totalDiscount,
    '',
    report.summary.totalVat,
    report.summary.totalAmount,
    currency,
  ]);
  wsInvoices.mergeCells(`A${invTotalRow.number}:G${invTotalRow.number}`);
  styleTotalRow(invTotalRow, [8, 9, 11, 12]);

  // =========================================================================
  // SHEET 3: أصناف الفواتير
  // =========================================================================
  const wsItems = workbook.addWorksheet('أصناف الفواتير', {
    views: [{ rightToLeft: true }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  wsItems.columns = [
    { width: 13 }, // date
    { width: 18 }, // invoice #
    { width: 20 }, // branch
    { width: 22 }, // supplier
    { width: 30 }, // item name
    { width: 12 }, // qty
    { width: 15 }, // unit price
    { width: 17 }, // total
  ];

  wsItems.mergeCells('A1:H1');
  const itemsBanner = wsItems.getCell('A1');
  itemsBanner.value = `تفاصيل أصناف فواتير المشتريات — ${orgName} (${report.filterLabels.periodLabel})`;
  itemsBanner.fill = NAVY_FILL;
  itemsBanner.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  itemsBanner.alignment = { horizontal: 'center', vertical: 'middle' };
  wsItems.getRow(1).height = 28;

  styleTableHeaderRow(
    wsItems.addRow([
      'التاريخ',
      'رقم الفاتورة',
      'الفرع',
      'المورد',
      'اسم الصنف',
      'الكمية',
      `سعر الوحدة (${currency})`,
      `إجمالي الصنف (${currency})`,
    ])
  );

  let itemsTotalHalalas = 0;
  let itemRowCount = 0;

  for (const inv of report.invoices) {
    if (inv.items.length > 0) {
      for (const item of inv.items) {
        const lineHalalas = toHalalas(item.total);
        itemsTotalHalalas += lineHalalas;
        itemRowCount += 1;

        const r = wsItems.addRow([
          inv.date,
          inv.invoiceNumber,
          inv.branchName,
          inv.supplierName,
          item.name,
          item.quantity,
          item.unitPrice,
          item.total,
        ]);
        r.height = 20;
        r.eachCell((cell, col) => {
          cell.border = CELL_BORDER;
          if (itemRowCount % 2 === 0) cell.fill = ZEBRA_FILL;
          cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
          if (col === 7 || col === 8) {
            cell.numFmt = '#,##0.00';
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (col === 1 || col === 2 || col === 6) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          }
        });
      }
    } else {
      // Legacy non-itemized invoice fallback row so totals remain fully auditable
      itemsTotalHalalas += inv.subtotalHalalas;
      itemRowCount += 1;
      const r = wsItems.addRow([
        inv.date,
        inv.invoiceNumber,
        inv.branchName,
        inv.supplierName,
        'فاتورة إجمالية بدون تفصيل أصناف',
        1,
        inv.subtotalAmount,
        inv.subtotalAmount,
      ]);
      r.height = 20;
      r.eachCell((cell, col) => {
        cell.border = CELL_BORDER;
        cell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF64748B' } };
        if (col === 7 || col === 8) {
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (col === 1 || col === 2 || col === 6) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        }
      });
    }
  }

  const itemsTotalRow = wsItems.addRow([
    `إجمالي الأصناف (${itemRowCount} سطر)`,
    '',
    '',
    '',
    '',
    '',
    '',
    fromHalalas(itemsTotalHalalas),
  ]);
  wsItems.mergeCells(`A${itemsTotalRow.number}:G${itemsTotalRow.number}`);
  styleTotalRow(itemsTotalRow, [8]);

  const rawBuffer = await workbook.xlsx.writeBuffer();
  const bytes = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);

  return {
    bytes,
    fileName: `AL_EQFAL_Purchases_Report_${dateTag}.xlsx`,
  };
}

// ---------------------------------------------------------------------------
// PDF Export — Pure Model + Spec-Compliant PDF 1.4 Encoder + Native RTL Canvas
// ---------------------------------------------------------------------------

export function buildPurchaseReportPdfModel(params: {
  report: ComputedPurchaseReport;
  org?: Organization | null;
  generatedAt?: Date;
}): PurchaseReportPdfModel {
  const { report, org, generatedAt = new Date() } = params;
  const currency = org?.currency || 'SAR';
  const organizationName = org?.name || 'الإقفال | AL EQFAL';
  const generatedDate = formatDateIsoLocal(generatedAt);
  const generatedTime = `${String(generatedAt.getHours()).padStart(2, '0')}:${String(
    generatedAt.getMinutes()
  ).padStart(2, '0')}`;

  const allItemRows: PurchaseReportPdfModel['allItemRows'] = [];
  for (const inv of report.invoices) {
    if (inv.items.length > 0) {
      for (const item of inv.items) {
        allItemRows.push({
          invoiceNumber: inv.invoiceNumber,
          date: inv.date,
          branchName: inv.branchName,
          supplierName: inv.supplierName,
          itemName: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        });
      }
    }
  }

  return {
    title: 'تقرير المشتريات التفصيلي',
    organizationName,
    currency,
    generatedDate,
    generatedTime,
    filterLabels: report.filterLabels,
    summary: report.summary,
    byBranch: report.byBranch,
    bySupplier: report.bySupplier,
    invoices: report.invoices,
    allItemRows,
  };
}

export interface PdfJpegPageInput {
  jpegBytes: Uint8Array;
  widthPx: number;
  heightPx: number;
}

/**
 * Encodes one or more JPEG-rendered A4 pages into a 100% spec-compliant PDF 1.4 binary.
 * Zero external dependencies, works in all modern browsers and Node tests, never uses window.open.
 */
export function buildPdfFromJpegPages(pages: readonly PdfJpegPageInput[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error('لا توجد صفحات لتوليد ملف PDF.');
  }

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // object 0 is always free
  let byteOffset = 0;

  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    byteOffset += b.byteLength;
  };
  const pushStr = (s: string) => pushBytes(enc.encode(s));

  // PDF 1.4 Header with binary marker
  pushStr('%PDF-1.4\n');
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Object allocation:
  // 1: Catalog
  // 2: Pages
  // For each page i (0..N-1):
  //   pageObjId    = 3 + i * 3
  //   contentObjId = 4 + i * 3
  //   imageObjId   = 5 + i * 3
  const pageObjIds = pages.map((_, i) => 3 + i * 3);

  // Obj 1: Catalog
  offsets.push(byteOffset);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets.push(byteOffset);
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`
  );

  // A4 dimensions in PDF points (72 pt/in): 595.28 x 841.89
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const imageObjId = 5 + i * 3;

    // Page object
    offsets.push(byteOffset);
    pushStr(
      `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /XObject << /Im0 ${imageObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\n` +
        `endobj\n`
    );

    // Content stream drawing the full A4 image
    const contentStr = `q\n${PAGE_W} 0 0 ${PAGE_H} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = enc.encode(contentStr);
    offsets.push(byteOffset);
    pushStr(
      `${contentObjId} 0 obj\n<< /Length ${contentBytes.byteLength} >>\nstream\n`
    );
    pushBytes(contentBytes);
    pushStr('endstream\nendobj\n');

    // Image XObject (DCTDecode JPEG)
    offsets.push(byteOffset);
    pushStr(
      `${imageObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.byteLength} >>\n` +
        `stream\n`
    );
    pushBytes(page.jpegBytes);
    pushStr('\nendstream\nendobj\n');
  }

  // XRef table
  const xrefStart = byteOffset;
  const totalObjects = offsets.length;
  pushStr(`xref\n0 ${totalObjects}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id < totalObjects; id++) {
    pushStr(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  const output = new Uint8Array(byteOffset);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return output;
}

function formatNumPdf(val: number): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function truncateTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (!text) return '—';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

/**
 * Renders the Arabic RTL Purchase Report directly onto high-DPI A4 Canvases
 * (leveraging native browser HarfBuzz/CoreText Arabic shaping & RTL layout)
 * and encodes all pages into a downloadable `.pdf` file.
 */
export async function generatePurchaseReportPdf(params: {
  report: ComputedPurchaseReport;
  org?: Organization | null;
  generatedAt?: Date;
}): Promise<{ bytes: Uint8Array; fileName: string; pageCount: number }> {
  if (typeof document === 'undefined') {
    throw new Error('توليد صفحات PDF الرسومية يتطلب بيئة المتصفح.');
  }

  // Ensure loaded web fonts (IBM Plex Sans Arabic / Cairo) are ready before drawing
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed with fallback system Arabic font
    }
  }

  const model = buildPurchaseReportPdfModel(params);
  const FONT_AR = "'IBM Plex Sans Arabic', 'Cairo', Arial, sans-serif";
  const FONT_MONO = "'IBM Plex Mono', monospace";

  // High-DPI A4 Canvas dimensions (150 DPI equivalent -> sharp crisp print & lightweight file)
  const W = 1240;
  const H = 1754;
  const PAD = 56;
  const INNER_W = W - PAD * 2;
  const FOOTER_H = 68;
  const MAX_Y = H - FOOTER_H;

  const canvases: HTMLCanvasElement[] = [];
  let canvas!: HTMLCanvasElement;
  let ctx!: CanvasRenderingContext2D;
  let y = 0;

  const drawPageHeader = (isFirstPage: boolean) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // Top Navy Header Bar
    const headerH = isFirstPage ? 128 : 74;
    ctx.fillStyle = '#0B192C';
    ctx.fillRect(0, 0, W, headerH);

    // Gold Accent Line
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(0, headerH, W, 5);

    ctx.direction = 'rtl';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = isFirstPage ? `700 30px ${FONT_AR}` : `700 21px ${FONT_AR}`;
    ctx.fillText(model.title, W - PAD, isFirstPage ? 48 : 38);

    ctx.fillStyle = '#FCD34D';
    ctx.font = isFirstPage ? `600 18px ${FONT_AR}` : `600 15px ${FONT_AR}`;
    if (isFirstPage) {
      ctx.fillText(model.organizationName, W - PAD, 92);
    }

    // Left-aligned date & currency stamp
    ctx.textAlign = 'left';
    ctx.fillStyle = '#CBD5E1';
    ctx.font = `500 15px ${FONT_AR}`;
    ctx.fillText(`تاريخ التقرير: ${model.generatedDate}  ${model.generatedTime}`, PAD, isFirstPage ? 48 : 38);
    if (isFirstPage) {
      ctx.fillStyle = '#F59E0B';
      ctx.font = `700 15px ${FONT_MONO}`;
      ctx.fillText(`AL EQFAL · ${model.currency}`, PAD, 92);
    }

    y = headerH + 34;
  };

  const newPage = (isFirstPage: boolean) => {
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('تعذر تهيئة سياق الرسم لتوليد ملف PDF.');
    }
    ctx = context;
    canvases.push(canvas);
    drawPageHeader(isFirstPage);
  };

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > MAX_Y) {
      newPage(false);
    }
  };

  const drawSectionTitle = (title: string) => {
    ensureSpace(56);
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(PAD, y, INNER_W, 38);
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD, y, INNER_W, 38);

    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0B192C';
    ctx.font = `700 17px ${FONT_AR}`;
    ctx.fillText(title, W - PAD - 16, y + 19);
    y += 46;
  };

  interface TableCol {
    header: string;
    width: number;
    align?: 'right' | 'center' | 'left';
    mono?: boolean;
  }

  const drawTable = (
    cols: TableCol[],
    rows: string[][],
    totalRow?: string[]
  ) => {
    const HEAD_H = 36;
    const ROW_H = 32;

    const drawHeader = () => {
      ctx.fillStyle = '#0F2038';
      ctx.fillRect(PAD, y, INNER_W, HEAD_H);
      let rx = W - PAD; // start from right for RTL column progression
      ctx.direction = 'rtl';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#F59E0B';
      ctx.font = `700 13px ${FONT_AR}`;

      for (const col of cols) {
        const xLeft = rx - col.width;
        ctx.strokeStyle = '#1E3A5F';
        ctx.lineWidth = 1;
        ctx.strokeRect(xLeft, y, col.width, HEAD_H);
        ctx.textAlign = 'center';
        ctx.fillText(truncateTextToWidth(ctx, col.header, col.width - 12), xLeft + col.width / 2, y + HEAD_H / 2);
        rx = xLeft;
      }
      y += HEAD_H;
    };

    ensureSpace(HEAD_H + ROW_H);
    drawHeader();

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      if (y + ROW_H > MAX_Y) {
        newPage(false);
        drawHeader();
      }

      const rowVals = rows[rIdx];
      ctx.fillStyle = rIdx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
      ctx.fillRect(PAD, y, INNER_W, ROW_H);

      let rx = W - PAD;
      for (let cIdx = 0; cIdx < cols.length; cIdx++) {
        const col = cols[cIdx];
        const xLeft = rx - col.width;
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1;
        ctx.strokeRect(xLeft, y, col.width, ROW_H);

        const raw = rowVals[cIdx] ?? '—';
        ctx.fillStyle = '#0F172A';
        ctx.font = col.mono ? `500 13px ${FONT_MONO}` : `500 13px ${FONT_AR}`;
        ctx.direction = col.mono ? 'ltr' : 'rtl';
        ctx.textBaseline = 'middle';

        const align = col.align || (col.mono ? 'center' : 'right');
        const text = truncateTextToWidth(ctx, raw, col.width - 14);
        if (align === 'center') {
          ctx.textAlign = 'center';
          ctx.fillText(text, xLeft + col.width / 2, y + ROW_H / 2);
        } else if (align === 'left') {
          ctx.textAlign = 'left';
          ctx.fillText(text, xLeft + 8, y + ROW_H / 2);
        } else {
          ctx.textAlign = 'right';
          ctx.fillText(text, rx - 8, y + ROW_H / 2);
        }
        rx = xLeft;
      }
      y += ROW_H;
    }

    if (totalRow) {
      if (y + ROW_H + 4 > MAX_Y) {
        newPage(false);
        drawHeader();
      }
      ctx.fillStyle = '#FEF3C7';
      ctx.fillRect(PAD, y, INNER_W, ROW_H + 4);
      let rx = W - PAD;
      for (let cIdx = 0; cIdx < cols.length; cIdx++) {
        const col = cols[cIdx];
        const xLeft = rx - col.width;
        ctx.strokeStyle = '#D97706';
        ctx.lineWidth = 1;
        ctx.strokeRect(xLeft, y, col.width, ROW_H + 4);

        const raw = totalRow[cIdx] ?? '';
        ctx.fillStyle = '#0B192C';
        ctx.font = col.mono ? `700 13px ${FONT_MONO}` : `700 13px ${FONT_AR}`;
        ctx.direction = col.mono ? 'ltr' : 'rtl';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(
          truncateTextToWidth(ctx, raw, col.width - 12),
          xLeft + col.width / 2,
          y + (ROW_H + 4) / 2
        );
        rx = xLeft;
      }
      y += ROW_H + 4;
    }

    y += 22;
  };

  // --- Start Page 1 ---
  newPage(true);

  // Filters Metadata Box
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(PAD, y, INNER_W, 82);
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD, y, INNER_W, 82);

  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#334155';
  ctx.font = `600 14px ${FONT_AR}`;
  ctx.fillText(`الفترة الزمنية: ${model.filterLabels.periodLabel}`, W - PAD - 16, y + 26);
  ctx.fillText(`المورد: ${model.filterLabels.supplierLabel}`, W - PAD - 16, y + 56);

  ctx.fillText(`الفرع: ${model.filterLabels.branchLabel}`, W / 2 - 20, y + 26);
  ctx.fillText(`البحث: ${model.filterLabels.searchLabel}`, W / 2 - 20, y + 56);
  y += 102;

  // 4 KPI Cards Row
  const kpiGap = 16;
  const kpiW = (INNER_W - kpiGap * 3) / 4;
  const kpiH = 92;
  const kpis = [
    {
      label: 'إجمالي قيمة المشتريات',
      value: `${formatNumPdf(model.summary.totalAmount)} ${model.currency}`,
      sub: `قبل الضريبة: ${formatNumPdf(model.summary.subtotalAmount)}`,
      accent: '#0B192C',
    },
    {
      label: 'عدد فواتير المشتريات',
      value: `${model.summary.invoiceCount} فاتورة`,
      sub: `المتوسط: ${formatNumPdf(model.summary.averageInvoiceAmount)} ${model.currency}`,
      accent: '#1D4ED8',
    },
    {
      label: 'إجمالي الضرائب',
      value: `${formatNumPdf(model.summary.totalVat)} ${model.currency}`,
      sub: 'ضريبة القيمة المضافة',
      accent: '#D97706',
    },
    {
      label: 'إجمالي الخصومات',
      value: `${formatNumPdf(model.summary.totalDiscount)} ${model.currency}`,
      sub: 'إجمالي خصومات الفواتير',
      accent: '#059669',
    },
  ];

  for (let i = 0; i < kpis.length; i++) {
    const kpi = kpis[i];
    // Right-to-left card ordering
    const x = W - PAD - (i + 1) * kpiW - i * kpiGap;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, kpiW, kpiH);
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, kpiW, kpiH);

    // Top thin color strip
    ctx.fillStyle = kpi.accent;
    ctx.fillRect(x, y, kpiW, 4);

    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#64748B';
    ctx.font = `600 13px ${FONT_AR}`;
    ctx.fillText(kpi.label, x + kpiW - 14, y + 26);

    ctx.fillStyle = '#0B192C';
    ctx.font = `700 18px ${FONT_AR}`;
    ctx.fillText(truncateTextToWidth(ctx, kpi.value, kpiW - 24), x + kpiW - 14, y + 54);

    ctx.fillStyle = '#64748B';
    ctx.font = `500 11px ${FONT_AR}`;
    ctx.fillText(truncateTextToWidth(ctx, kpi.sub, kpiW - 24), x + kpiW - 14, y + 77);
  }
  y += kpiH + 28;

  // Section 1: By Branch
  drawSectionTitle(`إجمالي المشتريات حسب الفرع (${model.byBranch.length})`);
  drawTable(
    [
      { header: 'الفرع', width: 298, align: 'right' },
      { header: 'الفواتير', width: 110, align: 'center', mono: true },
      { header: `قبل الضريبة`, width: 190, align: 'center', mono: true },
      { header: 'الخصم', width: 150, align: 'center', mono: true },
      { header: 'الضريبة', width: 150, align: 'center', mono: true },
      { header: `الإجمالي (${model.currency})`, width: 140, align: 'center', mono: true },
      { header: 'النسبة', width: 90, align: 'center', mono: true },
    ],
    model.byBranch.map((b) => [
      b.name,
      String(b.invoiceCount),
      formatNumPdf(b.subtotalAmount),
      formatNumPdf(b.discountAmount),
      formatNumPdf(b.vatAmount),
      formatNumPdf(b.totalAmount),
      `${b.sharePercent.toFixed(1)}%`,
    ]),
    [
      'الإجمالي',
      String(model.summary.invoiceCount),
      formatNumPdf(model.summary.subtotalAmount),
      formatNumPdf(model.summary.totalDiscount),
      formatNumPdf(model.summary.totalVat),
      formatNumPdf(model.summary.totalAmount),
      model.summary.totalAmount > 0 ? '100.0%' : '0.0%',
    ]
  );

  // Section 2: By Supplier
  drawSectionTitle(`إجمالي المشتريات حسب المورد (${model.bySupplier.length})`);
  drawTable(
    [
      { header: 'المورد', width: 298, align: 'right' },
      { header: 'الفواتير', width: 110, align: 'center', mono: true },
      { header: 'قبل الضريبة', width: 190, align: 'center', mono: true },
      { header: 'الخصم', width: 150, align: 'center', mono: true },
      { header: 'الضريبة', width: 150, align: 'center', mono: true },
      { header: `الإجمالي (${model.currency})`, width: 140, align: 'center', mono: true },
      { header: 'النسبة', width: 90, align: 'center', mono: true },
    ],
    model.bySupplier.map((s) => [
      s.name,
      String(s.invoiceCount),
      formatNumPdf(s.subtotalAmount),
      formatNumPdf(s.discountAmount),
      formatNumPdf(s.vatAmount),
      formatNumPdf(s.totalAmount),
      `${s.sharePercent.toFixed(1)}%`,
    ]),
    [
      'الإجمالي',
      String(model.summary.invoiceCount),
      formatNumPdf(model.summary.subtotalAmount),
      formatNumPdf(model.summary.totalDiscount),
      formatNumPdf(model.summary.totalVat),
      formatNumPdf(model.summary.totalAmount),
      model.summary.totalAmount > 0 ? '100.0%' : '0.0%',
    ]
  );

  // Section 3: Invoices Details
  drawSectionTitle(`تفاصيل فواتير المشتريات (${model.invoices.length} فاتورة)`);
  drawTable(
    [
      { header: 'التاريخ', width: 112, align: 'center', mono: true },
      { header: 'رقم الفاتورة', width: 132, align: 'center', mono: true },
      { header: 'الفرع', width: 162, align: 'right' },
      { header: 'المورد', width: 184, align: 'right' },
      { header: 'الدفع', width: 96, align: 'center' },
      { header: 'قبل الضريبة', width: 118, align: 'center', mono: true },
      { header: 'الخصم', width: 96, align: 'center', mono: true },
      { header: 'الضريبة', width: 102, align: 'center', mono: true },
      { header: 'الإجمالي', width: 126, align: 'center', mono: true },
    ],
    model.invoices.map((inv) => [
      inv.date,
      inv.invoiceNumber,
      inv.branchName,
      inv.supplierName,
      inv.paymentMethodLabel,
      formatNumPdf(inv.subtotalAmount),
      formatNumPdf(inv.discountAmount),
      formatNumPdf(inv.vatAmount),
      formatNumPdf(inv.totalAmount),
    ]),
    [
      'المجموع الكلي',
      `${model.summary.invoiceCount}`,
      '—',
      '—',
      model.currency,
      formatNumPdf(model.summary.subtotalAmount),
      formatNumPdf(model.summary.totalDiscount),
      formatNumPdf(model.summary.totalVat),
      formatNumPdf(model.summary.totalAmount),
    ]
  );

  // Section 4: Line Items Details (when itemized lines exist)
  if (model.allItemRows.length > 0) {
    drawSectionTitle(`تفاصيل الأصناف المسجلة في الفواتير (${model.allItemRows.length} صنف)`);
    let sumItemHalalas = 0;
    const itemTableRows = model.allItemRows.map((row) => {
      sumItemHalalas += toHalalas(row.total);
      return [
        row.date,
        row.invoiceNumber,
        row.branchName,
        row.supplierName,
        row.itemName,
        String(row.quantity),
        formatNumPdf(row.unitPrice),
        formatNumPdf(row.total),
      ];
    });
    drawTable(
      [
        { header: 'التاريخ', width: 108, align: 'center', mono: true },
        { header: 'الفاتورة', width: 122, align: 'center', mono: true },
        { header: 'الفرع', width: 150, align: 'right' },
        { header: 'المورد', width: 165, align: 'right' },
        { header: 'الصنف', width: 253, align: 'right' },
        { header: 'الكمية', width: 84, align: 'center', mono: true },
        { header: 'سعر الوحدة', width: 116, align: 'center', mono: true },
        { header: 'الإجمالي', width: 130, align: 'center', mono: true },
      ],
      itemTableRows,
      [
        'إجمالي الأصناف',
        `${model.allItemRows.length}`,
        '—',
        '—',
        '—',
        '—',
        model.currency,
        formatNumPdf(fromHalalas(sumItemHalalas)),
      ]
    );
  }

  // Stamp page numbers & clean footer on every rendered page
  const totalPages = canvases.length;
  const jpegPages: PdfJpegPageInput[] = canvases.map((c, idx) => {
    const pCtx = c.getContext('2d')!;
    pCtx.strokeStyle = '#E2E8F0';
    pCtx.lineWidth = 1;
    pCtx.beginPath();
    pCtx.moveTo(PAD, H - FOOTER_H + 14);
    pCtx.lineTo(W - PAD, H - FOOTER_H + 14);
    pCtx.stroke();

    pCtx.direction = 'rtl';
    pCtx.textBaseline = 'middle';
    pCtx.fillStyle = '#64748B';
    pCtx.font = `500 13px ${FONT_AR}`;
    pCtx.textAlign = 'right';
    pCtx.fillText(`${model.organizationName} — نظام الإقفال | AL EQFAL`, W - PAD, H - 28);

    pCtx.textAlign = 'left';
    pCtx.fillText(`صفحة ${idx + 1} من ${totalPages}`, PAD, H - 28);

    const dataUrl = c.toDataURL('image/jpeg', 0.92);
    return {
      jpegBytes: dataUrlToUint8Array(dataUrl),
      widthPx: W,
      heightPx: H,
    };
  });

  const pdfBytes = buildPdfFromJpegPages(jpegPages);
  return {
    bytes: pdfBytes,
    fileName: `AL_EQFAL_Purchases_Report_${model.generatedDate}.pdf`,
    pageCount: totalPages,
  };
}

/**
 * Triggers a clean browser download for generated .pdf bytes without popups.
 */
export function downloadPdfBytes(bytes: Uint8Array, fileName: string): void {
  const safeCopy = new Uint8Array(bytes.byteLength);
  safeCopy.set(bytes);
  const blob = new Blob([safeCopy.buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
