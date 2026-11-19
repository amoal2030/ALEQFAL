/**
 * Accounting calculation utility for الإقفال | AL EQFAL
 * High-precision financial arithmetic avoiding floating point rounding anomalies
 * using integer Halala arithmetic (100 Halalas = 1 Currency Unit).
 */
import type { PurchaseLineItem } from '../types';

export interface ShiftCalculations {
  cashSales: number;
  cardSales: number;
  expenses: number;
  totalSales: number;
  remainingInBox: number;
  netPeriod: number;
  // Raw halala values for zero-loss financial auditing
  cashHalalas: number;
  cardHalalas: number;
  expensesHalalas: number;
  totalSalesHalalas: number;
  remainingInBoxHalalas: number;
  netPeriodHalalas: number;
  isValid: boolean;
  errors: string[];
}

/**
 * Convert any currency float/string into integer Halalas (cents)
 * e.g., 1500.50 -> 150050
 */
export function toHalalas(amount: number | string): number {
  const num = typeof amount === 'string' ? parseFloat(amount) || 0 : amount || 0;
  if (isNaN(num) || !isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100);
}

/**
 * Convert integer Halalas back to standard decimal currency
 * e.g., 150050 -> 1500.50
 */
export function fromHalalas(halalas: number): number {
  return halalas / 100;
}

/**
 * Round to 2 decimal places with mathematical precision
 */
export function roundCurrency(val: number): number {
  if (isNaN(val) || !isFinite(val)) return 0;
  return fromHalalas(toHalalas(val));
}

/**
 * Core Accounting Equations executed with Integer Halala Precision:
 * 1. Total Sales = Cash + Card (POS)
 * 2. Remaining in Box (Cash Register) = Cash - Expenses
 * 3. Net Period = Total Sales - Expenses
 */
export function calculateShiftTotals(
  cashInput: number | string,
  cardInput: number | string,
  expensesInput: number | string
): ShiftCalculations {
  const cashNum = typeof cashInput === 'string' ? parseFloat(cashInput) || 0 : cashInput || 0;
  const cardNum = typeof cardInput === 'string' ? parseFloat(cardInput) || 0 : cardInput || 0;
  const expensesNum = typeof expensesInput === 'string' ? parseFloat(expensesInput) || 0 : expensesInput || 0;

  const errors: string[] = [];
  if (cashNum < 0) errors.push('cash_must_be_positive');
  if (cardNum < 0) errors.push('card_must_be_positive');
  if (expensesNum < 0) errors.push('expenses_must_be_positive');

  // Integer Halalas
  const cashHalalas = Math.max(0, toHalalas(cashNum));
  const cardHalalas = Math.max(0, toHalalas(cardNum));
  const expensesHalalas = Math.max(0, toHalalas(expensesNum));

  // Pure integer arithmetic
  const totalSalesHalalas = cashHalalas + cardHalalas;
  const remainingInBoxHalalas = cashHalalas - expensesHalalas;
  const netPeriodHalalas = totalSalesHalalas - expensesHalalas;

  return {
    cashSales: fromHalalas(cashHalalas),
    cardSales: fromHalalas(cardHalalas),
    expenses: fromHalalas(expensesHalalas),
    totalSales: fromHalalas(totalSalesHalalas),
    remainingInBox: fromHalalas(remainingInBoxHalalas),
    netPeriod: fromHalalas(netPeriodHalalas),
    cashHalalas,
    cardHalalas,
    expensesHalalas,
    totalSalesHalalas,
    remainingInBoxHalalas,
    netPeriodHalalas,
    isValid: errors.length === 0,
    errors,
  };
}

export interface PurchaseLineItemInput {
  id?: string;
  name: string;
  quantity: number | string;
  unitPrice: number | string;
}

export interface CalculatePurchaseTotalsInput {
  items?: PurchaseLineItemInput[];
  subtotalAmount?: number | string;
  discountAmount?: number | string;
  vatRate?: number | string;
  /**
   * Maximum allowed items for this calculation.
   * Defaults to MAX_PURCHASE_LINE_ITEMS (1) for inline `/purchases/{id}.items` compatibility;
   * pass MAX_PURCHASE_INVOICE_ITEMS (100) for subcollection `/purchases/{id}/items/{itemId}` invoices.
   */
  maxItems?: number;
}

export interface PurchaseCalculations {
  items: PurchaseLineItem[];
  subtotalAmount: number;
  discountAmount: number;
  taxableAmount: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  // Raw integer halala values for zero-loss financial auditing
  subtotalHalalas: number;
  discountHalalas: number;
  taxableHalalas: number;
  vatHalalas: number;
  totalHalalas: number;
  isValid: boolean;
  errors: string[];
}

function parseStrictNumericInput(
  raw: number | string | undefined | null,
  options?: { allowUndefinedAsZero?: boolean }
): { ok: true; value: number } | { ok: false; reason: 'missing' | 'invalid' | 'negative' } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (options?.allowUndefinedAsZero) {
      return { ok: true, value: 0 };
    }
    return { ok: false, reason: 'missing' };
  }

  let num: number;
  if (typeof raw === 'number') {
    num = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) {
      return { ok: false, reason: 'invalid' };
    }
    num = Number(trimmed);
  } else {
    return { ok: false, reason: 'invalid' };
  }

  if (!Number.isFinite(num) || Number.isNaN(num)) {
    return { ok: false, reason: 'invalid' };
  }
  if (num < 0) {
    return { ok: false, reason: 'negative' };
  }
  return { ok: true, value: num };
}

/**
 * Maximum inline line items and attachment references enforceable atomically
 * per Firestore `/purchases/{purchaseId}` document write under Firestore's
 * hard 1,000 runtime expression evaluation ceiling (with full Halala/VAT,
 * optional metadata, cross-doc attachment `getAfter`, and role/subscription rules).
 * Multi-line invoices store items in subcollection `purchases/{purchaseId}/items/{itemId}`
 * (up to MAX_PURCHASE_INVOICE_ITEMS = 100) and multiple attachments in `/attachments/{attachmentId}`.
 */
export const MAX_PURCHASE_LINE_ITEMS = 1;
export const MAX_PURCHASE_ATTACHMENTS = 1;
export const MAX_PURCHASE_INVOICE_ITEMS = 100;
export const MAX_PURCHASE_INVOICE_ATTACHMENTS = 20;
export const MAX_PURCHASE_ATTACHMENT_BYTES = 52_428_800; // 50 MB (matches firestore.rules)
const MAX_PURCHASE_ITEM_QTY_OR_PRICE = 1_000_000_000;
const MAX_PURCHASE_TOTAL_AMOUNT = 1_000_000_000_000;

/**
 * Purchase Accounting Equations executed with Integer Halala Precision:
 * 1. Line Item Total = roundHalalas(quantity * unitPrice)
 * 2. Subtotal = sum(Line Item Totals) (or direct subtotalAmount if no line items)
 *    NOTE: `Purchase.amount` MUST equal `subtotalAmount` (pre-discount base amount).
 * 3. Taxable Amount = Subtotal - Discount
 * 4. VAT = integer Halala half-up rounding: floor((taxableHalalas * round(vatRate * 100) + 5000) / 10000)
 * 5. Total Amount = Subtotal - Discount + VAT
 */
export function calculatePurchaseTotals(
  input: CalculatePurchaseTotalsInput
): PurchaseCalculations {
  const errors: string[] = [];
  const normalizedItems: PurchaseLineItem[] = [];
  let subtotalHalalas = 0;

  const hasItemsArray = Array.isArray(input.items) && input.items.length > 0;
  const effectiveMaxItems =
    input.maxItems !== undefined && Number.isFinite(input.maxItems)
      ? Math.min(Math.max(1, Math.floor(input.maxItems)), MAX_PURCHASE_INVOICE_ITEMS)
      : MAX_PURCHASE_LINE_ITEMS;

  if (hasItemsArray) {
    if (input.items!.length > effectiveMaxItems) {
      errors.push('items_exceed_max_limit');
    }

    input.items!.forEach((rawItem, idx) => {
      const trimmedId = rawItem.id === undefined ? `item_${idx}` : String(rawItem.id).trim();
      if (trimmedId.length === 0) {
        errors.push(`item_${idx}_id_required`);
      } else if (trimmedId.length > 128) {
        errors.push(`item_${idx}_id_too_long`);
      }

      const trimmedName = (rawItem.name ?? '').trim();
      if (trimmedName.length === 0) {
        errors.push(`item_${idx}_name_required`);
      } else if (trimmedName.length > 200) {
        errors.push(`item_${idx}_name_too_long`);
      }

      const qtyParsed = parseStrictNumericInput(rawItem.quantity);
      const priceParsed = parseStrictNumericInput(rawItem.unitPrice);

      let validQty = 0;
      if (!qtyParsed.ok) {
        errors.push(
          qtyParsed.reason === 'negative'
            ? `item_${idx}_quantity_must_be_positive`
            : `item_${idx}_invalid_quantity`
        );
      } else if (qtyParsed.value <= 0) {
        errors.push(`item_${idx}_quantity_must_be_positive`);
      } else if (qtyParsed.value > MAX_PURCHASE_ITEM_QTY_OR_PRICE) {
        errors.push(`item_${idx}_quantity_exceeds_max`);
      } else {
        validQty = qtyParsed.value;
      }

      let validUnitPrice = 0;
      if (!priceParsed.ok) {
        errors.push(
          priceParsed.reason === 'negative'
            ? `item_${idx}_unit_price_must_be_non_negative`
            : `item_${idx}_invalid_unit_price`
        );
      } else if (priceParsed.value > MAX_PURCHASE_ITEM_QTY_OR_PRICE) {
        errors.push(`item_${idx}_unit_price_exceeds_max`);
      } else {
        validUnitPrice = priceParsed.value;
        if (Math.abs(validUnitPrice * 100 - Math.round(validUnitPrice * 100)) >= 0.001) {
          errors.push(`item_${idx}_unit_price_precision_exceeded`);
        }
      }

      const lineTotalHalalas =
        validQty > 0 && validUnitPrice >= 0 ? toHalalas(validQty * validUnitPrice) : 0;

      if (fromHalalas(lineTotalHalalas) > MAX_PURCHASE_TOTAL_AMOUNT) {
        errors.push(`item_${idx}_total_exceeds_max`);
      }

      subtotalHalalas += lineTotalHalalas;

      normalizedItems.push({
        id: trimmedId || `item_${idx}`,
        name: trimmedName,
        quantity: validQty,
        unitPrice: roundCurrency(validUnitPrice),
        total: fromHalalas(lineTotalHalalas),
      });
    });
  } else if (input.subtotalAmount !== undefined) {
    const subParsed = parseStrictNumericInput(input.subtotalAmount);
    if (!subParsed.ok) {
      errors.push(
        subParsed.reason === 'negative'
          ? 'subtotal_must_be_non_negative'
          : 'invalid_subtotal'
      );
    } else {
      subtotalHalalas = toHalalas(subParsed.value);
    }
  } else {
    errors.push('purchase_items_or_subtotal_required');
  }

  const discountParsed = parseStrictNumericInput(input.discountAmount, {
    allowUndefinedAsZero: true,
  });
  let discountHalalas = 0;
  if (!discountParsed.ok) {
    errors.push(
      discountParsed.reason === 'negative'
        ? 'discount_must_be_non_negative'
        : 'invalid_discount'
    );
  } else {
    if (Math.abs(discountParsed.value * 100 - Math.round(discountParsed.value * 100)) >= 0.001) {
      errors.push('discount_precision_exceeded');
    }
    discountHalalas = toHalalas(discountParsed.value);
  }

  if (discountHalalas > subtotalHalalas) {
    errors.push('discount_exceeds_subtotal');
  }

  const vatRateParsed = parseStrictNumericInput(input.vatRate, {
    allowUndefinedAsZero: true,
  });
  let vatRate = 0;
  let vatRateBasisPoints = 0;
  if (!vatRateParsed.ok) {
    errors.push(
      vatRateParsed.reason === 'negative'
        ? 'vat_rate_must_be_non_negative'
        : 'invalid_vat_rate'
    );
  } else if (vatRateParsed.value > 100) {
    errors.push('vat_rate_exceeds_100');
  } else {
    vatRate = vatRateParsed.value;
    vatRateBasisPoints = Math.round((vatRate + Number.EPSILON) * 100);
    if (Math.abs(vatRate * 100 - vatRateBasisPoints) >= 0.001) {
      errors.push('vat_rate_precision_exceeded');
    }
  }

  const effectiveDiscountHalalas = Math.min(discountHalalas, subtotalHalalas);
  const taxableHalalas = Math.max(0, subtotalHalalas - effectiveDiscountHalalas);
  const vatHalalas = Math.floor((taxableHalalas * vatRateBasisPoints + 5000) / 10000);
  const totalHalalas = subtotalHalalas - effectiveDiscountHalalas + vatHalalas;

  if (fromHalalas(subtotalHalalas) > MAX_PURCHASE_TOTAL_AMOUNT) {
    errors.push('subtotal_exceeds_max');
  }
  if (fromHalalas(totalHalalas) > MAX_PURCHASE_TOTAL_AMOUNT) {
    errors.push('total_exceeds_max');
  }

  return {
    items: normalizedItems,
    subtotalAmount: fromHalalas(subtotalHalalas),
    discountAmount: fromHalalas(discountHalalas),
    taxableAmount: fromHalalas(taxableHalalas),
    vatRate,
    vatAmount: fromHalalas(vatHalalas),
    totalAmount: fromHalalas(totalHalalas),
    subtotalHalalas,
    discountHalalas,
    taxableHalalas,
    vatHalalas,
    totalHalalas,
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Deterministic Closing Document ID Generator
 * Prevents duplicate closings for the same branch, date, and period at the database layer.
 * Format: org_[orgId]_br_[branchId]_[YYYY-MM-DD]_[morning|evening]
 */
export function generateDeterministicClosingId(
  orgId: string,
  branchId: string,
  date: string,
  period: 'morning' | 'evening'
): string {
  const cleanOrg = orgId.replace(/[^a-zA-Z0-9]/g, '');
  const cleanBranch = branchId.replace(/[^a-zA-Z0-9]/g, '');
  const cleanDate = date.replace(/[^a-zA-Z0-9]/g, '-');
  return `cls_${cleanOrg}_${cleanBranch}_${cleanDate}_${period}`;
}

/**
 * Format currency with locale and symbol
 */
export function formatCurrency(
  amount: number,
  currency: string = 'SAR',
  language: 'ar' | 'en' | 'ur' = 'ar'
): string {
  const rounded = roundCurrency(amount);
  const formattedNumber = new Intl.NumberFormat(
    language === 'en' ? 'en-US' : language === 'ur' ? 'ur-PK' : 'ar-SA',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(rounded);

  const currencyLabels: Record<string, Record<'ar' | 'en' | 'ur', string>> = {
    SAR: { ar: 'ر.س', en: 'SAR', ur: 'سعودی ریال' },
    AED: { ar: 'د.إ', en: 'AED', ur: 'درہم' },
    QAR: { ar: 'ر.ق', en: 'QAR', ur: 'قطری ریال' },
    KWD: { ar: 'د.ك', en: 'KWD', ur: 'کویتی دینار' },
    USD: { ar: '$', en: '$', ur: '$' },
  };

  const label = currencyLabels[currency]?.[language] || currency;

  if (language === 'en') {
    return `${label} ${formattedNumber}`;
  }
  return `${formattedNumber} ${label}`;
}

/**
 * Format date for display
 */
export function formatDate(dateString: string, language: 'ar' | 'en' | 'ur' = 'ar'): string {
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return new Intl.DateTimeFormat(
      language === 'en' ? 'en-US' : language === 'ur' ? 'ur-PK' : 'ar-SA',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }
    ).format(d);
  } catch {
    return dateString;
  }
}

/**
 * Export closings array to CSV (compatible with Microsoft Excel)
 */
export function exportClosingsToCSV(
  closings: Array<{
    date: string;
    branchName: string;
    employeeName: string;
    period: string;
    cashSales: number;
    cardSales: number;
    totalSales: number;
    expenses: number;
    remainingInBox: number;
    netPeriod: number;
    status: string;
  }>,
  currency: string = 'SAR'
): void {
  const headers = [
    'التاريخ',
    'الفرع',
    'الموظف',
    'الفترة',
    `النقد (${currency})`,
    `الشبكة (${currency})`,
    `إجمالي المبيعات (${currency})`,
    `المشتريات (${currency})`,
    `الباقي في الصندوق (${currency})`,
    `صافي الفترة (${currency})`,
    'الحالة',
  ];

  const statusMap: Record<string, string> = {
    draft: 'مسودة',
    pending_review: 'مرسل للمراجعة',
    approved: 'معتمد',
    rejected: 'معاد للتعديل',
  };

  const periodMap: Record<string, string> = {
    morning: 'صباحية',
    evening: 'مسائية',
  };

  const rows = closings.map((c) => [
    c.date,
    c.branchName,
    c.employeeName,
    periodMap[c.period] || c.period,
    c.cashSales.toFixed(2),
    c.cardSales.toFixed(2),
    c.totalSales.toFixed(2),
    c.expenses.toFixed(2),
    c.remainingInBox.toFixed(2),
    c.netPeriod.toFixed(2),
    statusMap[c.status] || c.status,
  ]);

  // UTF-8 BOM for Arabic character preservation in Excel
  const BOM = '\uFEFF';
  const csvContent =
    BOM +
    [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join(
      '\r\n'
    );

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `AL_EQFAL_Report_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
