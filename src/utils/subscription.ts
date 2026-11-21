import {
  DeactivationReason,
  EffectiveSubscriptionState,
  Organization,
  SubscriptionPlan,
  SubscriptionStatus,
  SubscriptionTimestampValue,
  SupportedLanguage,
} from '../types';

export const SUBSCRIPTION_WHATSAPP_LOCAL = '0541821068';
export const SUBSCRIPTION_WHATSAPP_INTL = '966541821068';
export const SUBSCRIPTION_WHATSAPP_BASE_URL = `https://wa.me/${SUBSCRIPTION_WHATSAPP_INTL}`;

export interface SubscriptionPlanDefinition {
  id: SubscriptionPlan;
  durationDays?: number;
  durationMonths?: number;
  isTrial: boolean;
  labels: Record<SupportedLanguage, string>;
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanDefinition[] = [
  {
    id: 'trial_7d',
    durationDays: 7,
    isTrial: true,
    labels: {
      ar: 'تجربة مجانية لمدة 7 أيام',
      en: '7-Day Free Trial',
      ur: '7 دن کا مفت ٹرائل',
    },
  },
  {
    id: '1m',
    durationMonths: 1,
    isTrial: false,
    labels: {
      ar: 'شهر واحد',
      en: '1 Month',
      ur: '1 مہینہ',
    },
  },
  {
    id: '3m',
    durationMonths: 3,
    isTrial: false,
    labels: {
      ar: '3 أشهر',
      en: '3 Months',
      ur: '3 ماہ',
    },
  },
  {
    id: '6m',
    durationMonths: 6,
    isTrial: false,
    labels: {
      ar: '6 أشهر',
      en: '6 Months',
      ur: '6 ماہ',
    },
  },
  {
    id: '1y',
    durationMonths: 12,
    isTrial: false,
    labels: {
      ar: 'سنة كاملة',
      en: '1 Year',
      ur: '1 سال',
    },
  },
] as const;

const SUBSCRIPTION_PLAN_MAP = new Map<SubscriptionPlan, SubscriptionPlanDefinition>(
  SUBSCRIPTION_PLANS.map((plan) => [plan.id, plan])
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === 'string' && SUBSCRIPTION_PLAN_MAP.has(value as SubscriptionPlan);
}

export function getSubscriptionPlanDefinition(plan: SubscriptionPlan): SubscriptionPlanDefinition {
  const def = SUBSCRIPTION_PLAN_MAP.get(plan);
  if (!def) {
    throw new Error(`خطة الاشتراك غير صالحة: ${String(plan)}`);
  }
  return def;
}

export function getSubscriptionPlanLabel(
  plan: SubscriptionPlan,
  language: SupportedLanguage = 'ar'
): string {
  const def = SUBSCRIPTION_PLAN_MAP.get(plan);
  if (!def) return String(plan);
  return def.labels[language] || def.labels.ar;
}

/**
 * Safely converts Date, ISO string, Firestore Timestamp (.toDate()),
 * or serialized timestamp object ({ seconds, nanoseconds } / { _seconds, _nanoseconds })
 * into a valid JS Date, or returns null if invalid.
 */
export function toValidDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    if (typeof obj.toDate === 'function') {
      try {
        const converted = (obj as { toDate: () => unknown }).toDate();
        if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
          return new Date(converted.getTime());
        }
      } catch {
        return null;
      }
    }

    const rawSeconds =
      typeof obj.seconds === 'number'
        ? obj.seconds
        : typeof obj._seconds === 'number'
        ? obj._seconds
        : null;

    if (rawSeconds !== null && Number.isFinite(rawSeconds)) {
      const rawNanos =
        typeof obj.nanoseconds === 'number'
          ? obj.nanoseconds
          : typeof obj._nanoseconds === 'number'
          ? obj._nanoseconds
          : 0;
      const safeNanos = Number.isFinite(rawNanos) ? rawNanos : 0;
      const ms = rawSeconds * 1000 + Math.floor(safeNanos / 1_000_000);
      const parsed = new Date(ms);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

/**
 * Adds exact calendar months in UTC, clamping days to the target month's last day
 * (e.g., Jan 31 + 1 month -> Feb 28/29 instead of overflowing to March).
 */
function addUtcMonthsClamped(baseDate: Date, months: number): Date {
  const startYear = baseDate.getUTCFullYear();
  const startMonth = baseDate.getUTCMonth();
  const startDay = baseDate.getUTCDate();

  const totalMonths = startYear * 12 + startMonth + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(startDay, daysInTargetMonth);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      clampedDay,
      baseDate.getUTCHours(),
      baseDate.getUTCMinutes(),
      baseDate.getUTCSeconds(),
      baseDate.getUTCMilliseconds()
    )
  );
}

/**
 * Calculates the exact subscription end Date for any of the 5 supported plans.
 */
export function calculateSubscriptionEndDate(
  startAt: SubscriptionTimestampValue,
  plan: SubscriptionPlan
): Date {
  const startDate = toValidDate(startAt);
  if (!startDate) {
    throw new Error('تاريخ بداية الاشتراك غير صالح.');
  }

  const def = getSubscriptionPlanDefinition(plan);

  if (typeof def.durationDays === 'number' && def.durationDays > 0) {
    return new Date(startDate.getTime() + def.durationDays * MS_PER_DAY);
  }

  if (typeof def.durationMonths === 'number' && def.durationMonths > 0) {
    return addUtcMonthsClamped(startDate, def.durationMonths);
  }

  throw new Error(`تعذر حساب مدة الخطة: ${plan}`);
}

export interface SubscriptionDateValidationResult {
  isValid: boolean;
  startDate: Date | null;
  endDate: Date | null;
  errorCode?: 'INVALID_START' | 'INVALID_END' | 'END_NOT_AFTER_START';
  errorMessage?: string;
}

export function validateSubscriptionDates(
  startAt: unknown,
  endAt: unknown
): SubscriptionDateValidationResult {
  const startDate = toValidDate(startAt);
  if (!startDate) {
    return {
      isValid: false,
      startDate: null,
      endDate: toValidDate(endAt),
      errorCode: 'INVALID_START',
      errorMessage: 'تاريخ بداية الاشتراك غير صالح.',
    };
  }

  const endDate = toValidDate(endAt);
  if (!endDate) {
    return {
      isValid: false,
      startDate,
      endDate: null,
      errorCode: 'INVALID_END',
      errorMessage: 'تاريخ نهاية الاشتراك غير صالح.',
    };
  }

  if (endDate.getTime() <= startDate.getTime()) {
    return {
      isValid: false,
      startDate,
      endDate,
      errorCode: 'END_NOT_AFTER_START',
      errorMessage: 'يجب أن يكون تاريخ نهاية الاشتراك بعد تاريخ البداية.',
    };
  }

  return {
    isValid: true,
    startDate,
    endDate,
  };
}

export interface OrganizationSubscriptionEvaluation {
  state: EffectiveSubscriptionState;
  isAllowed: boolean;
  notStarted?: boolean;
  isLegacy: boolean;
  isBillingExempt: boolean;
  isFeeExempt: boolean;
  plan: SubscriptionPlan | null;
  rawStatus: SubscriptionStatus | null;
  startDate: Date | null;
  endDate: Date | null;
  remainingMs: number | null;
  remainingDays: number | null;
  deactivationReason?: DeactivationReason | null;
  noPaidBranchGraceStartedAt?: Date | null;
  deactivationDueAt?: Date | null;
}

export type OrganizationSubscriptionFields = Pick<
  Organization,
  | 'isActive'
  | 'subscriptionPlan'
  | 'subscriptionStatus'
  | 'subscriptionStartAt'
  | 'subscriptionEndAt'
  | 'deactivationReason'
  | 'noPaidBranchGraceStartedAt'
  | 'deactivationDueAt'
> &
  Partial<
    Pick<
      Organization,
      | 'ownerId'
      | 'ownerEmail'
      | 'billingExempt'
      | 'billingExemptScope'
      | 'billingExemptVerifiedOwnerId'
      | 'billingExemptVerifiedOwnerEmail'
    >
  >;

/**
 * Verifies official permanent billing exemption (exact mirror of firestore.rules `isOrgPermanentlyBillingExempt`).
 * Fails closed unless BOTH ownerId and normalized lowercase ownerEmail match the Super-Admin-verified binding.
 * Never grants exemption based on email alone.
 */
export function isOrgPermanentlyBillingExempt(
  org:
    | Partial<
        Pick<
          Organization,
          | 'ownerId'
          | 'ownerEmail'
          | 'billingExempt'
          | 'billingExemptScope'
          | 'billingExemptVerifiedOwnerId'
          | 'billingExemptVerifiedOwnerEmail'
        >
      >
    | null
    | undefined
): boolean {
  if (!org) return false;
  if (org.billingExempt !== true) return false;
  if (org.billingExemptScope !== 'full_permanent') return false;

  const ownerId = typeof org.ownerId === 'string' ? org.ownerId : '';
  const verifiedOwnerId =
    typeof org.billingExemptVerifiedOwnerId === 'string'
      ? org.billingExemptVerifiedOwnerId
      : '';
  if (ownerId.trim().length === 0 || verifiedOwnerId !== ownerId) {
    return false;
  }

  const rawEmail = typeof org.ownerEmail === 'string' ? org.ownerEmail.trim() : '';
  const verifiedOwnerEmail =
    typeof org.billingExemptVerifiedOwnerEmail === 'string'
      ? org.billingExemptVerifiedOwnerEmail
      : '';
  if (rawEmail.length < 3 || verifiedOwnerEmail !== rawEmail.toLowerCase()) {
    return false;
  }

  return true;
}

/**
 * Evaluates an organization's effective subscription state:
 * - 'suspended': org.isActive === false (manual suspension ALWAYS wins), subscriptionStatus === 'suspended', or 7-day no-paid-branch grace expired
 * - 'billing_exempt': Super-Admin-granted permanent exemption bound to verified ownerId + ownerEmail (preserves historical subscription fields)
 * - 'legacy_unrestricted': existing org with no subscription fields and isActive !== false
 * - 'expired': subscriptionStatus === 'expired', invalid/missing end date when configured, or now > endDate
 * - 'active': configured subscription within valid time range
 */
export function evaluateOrganizationSubscription(
  org: OrganizationSubscriptionFields | null | undefined,
  nowInput: Date = new Date()
): OrganizationSubscriptionEvaluation {
  const now = toValidDate(nowInput) || new Date();

  if (!org) {
    return {
      state: 'suspended',
      isAllowed: false,
      isLegacy: false,
      isBillingExempt: false,
      isFeeExempt: false,
      plan: null,
      rawStatus: null,
      startDate: null,
      endDate: null,
      remainingMs: null,
      remainingDays: null,
      deactivationReason: 'manual_suspension',
    };
  }

  const plan = isSubscriptionPlan(org.subscriptionPlan) ? org.subscriptionPlan : null;
  const rawStatus = org.subscriptionStatus ?? null;
  const startDate = toValidDate(org.subscriptionStartAt);
  const parsedEndDate = toValidDate(org.subscriptionEndAt);
  const graceStartedAt = toValidDate(org.noPaidBranchGraceStartedAt);
  const deactivationDueAt = toValidDate(org.deactivationDueAt);
  const isBillingExempt = isOrgPermanentlyBillingExempt(org);
  const hasSubscriptionConfiguration =
    org.subscriptionEndAt !== undefined && org.subscriptionEndAt !== null
      ? true
      : org.subscriptionStatus !== undefined && org.subscriptionStatus !== null;

  // Manual suspension (isActive === false) ALWAYS blocks access even for permanently exempt orgs
  if (org.isActive === false) {
    const isLegacyWhenSuspended = !isBillingExempt && !hasSubscriptionConfiguration;
    return {
      state: 'suspended',
      isAllowed: false,
      isLegacy: isLegacyWhenSuspended,
      isBillingExempt,
      isFeeExempt: isLegacyWhenSuspended || isBillingExempt,
      plan,
      rawStatus,
      startDate,
      endDate: parsedEndDate,
      remainingMs: null,
      remainingDays: null,
      deactivationReason: org.deactivationReason || 'manual_suspension',
      noPaidBranchGraceStartedAt: graceStartedAt,
      deactivationDueAt,
    };
  }

  // Official permanent billing exemption: overrides expiry/grace while preserving historical subscription fields
  if (isBillingExempt) {
    return {
      state: 'billing_exempt',
      isAllowed: true,
      notStarted: false,
      isLegacy: false,
      isBillingExempt: true,
      isFeeExempt: true,
      plan,
      rawStatus,
      startDate,
      endDate: parsedEndDate,
      remainingMs: null,
      remainingDays: null,
      deactivationReason: null,
      noPaidBranchGraceStartedAt: null,
      deactivationDueAt: null,
    };
  }

  if (!hasSubscriptionConfiguration) {
    return {
      state: 'legacy_unrestricted',
      isAllowed: true,
      isLegacy: true,
      isBillingExempt: false,
      isFeeExempt: true,
      plan,
      rawStatus: null,
      startDate,
      endDate: null,
      remainingMs: null,
      remainingDays: null,
      deactivationReason: null,
      noPaidBranchGraceStartedAt: null,
      deactivationDueAt: null,
    };
  }

  if (
    deactivationDueAt &&
    now.getTime() >= deactivationDueAt.getTime()
  ) {
    return {
      state: 'suspended',
      isAllowed: false,
      isLegacy: false,
      isBillingExempt: false,
      isFeeExempt: false,
      plan,
      rawStatus,
      startDate,
      endDate: parsedEndDate,
      remainingMs: 0,
      remainingDays: 0,
      deactivationReason: org.deactivationReason || 'no_paid_branches',
      noPaidBranchGraceStartedAt: graceStartedAt,
      deactivationDueAt,
    };
  }

  if (org.subscriptionStatus === 'suspended') {
    return {
      state: 'suspended',
      isAllowed: false,
      isLegacy: false,
      isBillingExempt: false,
      isFeeExempt: false,
      plan,
      rawStatus,
      startDate,
      endDate: parsedEndDate,
      remainingMs: null,
      remainingDays: null,
    };
  }

  if (org.subscriptionStatus === 'expired') {
    return {
      state: 'expired',
      isAllowed: false,
      isLegacy: false,
      isBillingExempt: false,
      isFeeExempt: false,
      plan,
      rawStatus,
      startDate,
      endDate: parsedEndDate,
      remainingMs: 0,
      remainingDays: 0,
    };
  }

  if (!parsedEndDate) {
    return {
      state: 'expired',
      isAllowed: false,
      isLegacy: false,
      isBillingExempt: false,
      isFeeExempt: false,
      plan,
      rawStatus,
      startDate,
      endDate: null,
      remainingMs: 0,
      remainingDays: 0,
    };
  }

  if (startDate && parsedEndDate.getTime() <= startDate.getTime()) {
    return {
      state: 'expired',
      isAllowed: false,
      notStarted: false,
      isLegacy: false,
      isBillingExempt: false,
      isFeeExempt: false,
      plan,
      rawStatus,
      startDate,
      endDate: parsedEndDate,
      remainingMs: 0,
      remainingDays: 0,
    };
  }

  if (startDate && now.getTime() < startDate.getTime()) {
    return {
      state: 'expired',
      isAllowed: false,
      notStarted: true,
      isLegacy: false,
      isBillingExempt: false,
      isFeeExempt: false,
      plan,
      rawStatus,
      startDate,
      endDate: parsedEndDate,
      remainingMs: 0,
      remainingDays: 0,
    };
  }

  const remainingMs = parsedEndDate.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return {
      state: 'expired',
      isAllowed: false,
      notStarted: false,
      isLegacy: false,
      isBillingExempt: false,
      isFeeExempt: false,
      plan,
      rawStatus,
      startDate,
      endDate: parsedEndDate,
      remainingMs: 0,
      remainingDays: 0,
    };
  }

  return {
    state: 'active',
    isAllowed: true,
    notStarted: false,
    isLegacy: false,
    isBillingExempt: false,
    isFeeExempt: false,
    plan,
    rawStatus,
    startDate,
    endDate: parsedEndDate,
    remainingMs,
    remainingDays: Math.ceil(remainingMs / MS_PER_DAY),
    deactivationReason: null,
    noPaidBranchGraceStartedAt: graceStartedAt,
    deactivationDueAt,
  };
}

export interface PreparedWhatsAppLink {
  phoneLocal: string;
  phoneIntl: string;
  message: string;
  url: string;
}

export function buildSubscriptionWhatsAppUrl(message: string): string {
  return `${SUBSCRIPTION_WHATSAPP_BASE_URL}?text=${encodeURIComponent(message)}`;
}

function formatDateIsoDateOnly(value: SubscriptionTimestampValue | undefined): string {
  const parsed = toValidDate(value);
  if (!parsed) return '—';
  return parsed.toISOString().slice(0, 10);
}

/**
 * Prepares a WhatsApp message and click-to-chat URL (966541821068)
 * for a new organization subscription request. Does NOT open or send automatically.
 */
export function buildNewSubscriptionWhatsApp(params: {
  ownerName: string;
  googleEmail: string;
  orgName: string;
  plan: SubscriptionPlan;
  language?: SupportedLanguage;
}): PreparedWhatsAppLink {
  const language = params.language || 'ar';
  const planLabel = getSubscriptionPlanLabel(params.plan, language);
  const cleanOwnerName = params.ownerName.trim();
  const cleanEmail = params.googleEmail.trim();
  const cleanOrgName = params.orgName.trim();

  const message =
    language === 'en'
      ? [
          'Hello AL EQFAL Management,',
          'I would like to request a new organization subscription:',
          `- Owner Name: ${cleanOwnerName}`,
          `- Google Email: ${cleanEmail}`,
          `- Organization Name: ${cleanOrgName}`,
          `- Subscription Plan: ${planLabel}`,
        ].join('\n')
      : language === 'ur'
      ? [
          'السلام علیکم الاقفال انتظامیہ،',
          'میں نئے ادارے کی سبسکرپشن کی درخواست کرنا چاہتا ہوں:',
          `- مالک کا نام: ${cleanOwnerName}`,
          `- گوگل ای میل: ${cleanEmail}`,
          `- ادارے کا نام: ${cleanOrgName}`,
          `- سبسکرپشن کی مدت: ${planLabel}`,
        ].join('\n')
      : [
          'السلام عليكم إدارة نظام الإقفال AL EQFAL،',
          'أرغب في طلب اشتراك مؤسسة جديدة:',
          `- اسم صاحب المؤسسة: ${cleanOwnerName}`,
          `- بريد Google: ${cleanEmail}`,
          `- اسم المؤسسة: ${cleanOrgName}`,
          `- مدة الاشتراك المطلوبة: ${planLabel}`,
        ].join('\n');

  return {
    phoneLocal: SUBSCRIPTION_WHATSAPP_LOCAL,
    phoneIntl: SUBSCRIPTION_WHATSAPP_INTL,
    message,
    url: buildSubscriptionWhatsAppUrl(message),
  };
}

/**
 * Prepares a WhatsApp message and click-to-chat URL (966541821068)
 * for an existing organization renewal request. Does NOT open or send automatically.
 */
export function buildRenewalSubscriptionWhatsApp(params: {
  orgName: string;
  orgId?: string;
  managerName: string;
  managerEmail: string;
  plan: SubscriptionPlan;
  currentEndAt?: SubscriptionTimestampValue;
  language?: SupportedLanguage;
}): PreparedWhatsAppLink {
  const language = params.language || 'ar';
  const planLabel = getSubscriptionPlanLabel(params.plan, language);
  const cleanOrgName = params.orgName.trim();
  const cleanOrgId = params.orgId?.trim();
  const cleanManagerName = params.managerName.trim();
  const cleanManagerEmail = params.managerEmail.trim();
  const endDateStr = params.currentEndAt ? formatDateIsoDateOnly(params.currentEndAt) : null;

  const message =
    language === 'en'
      ? [
          'Hello AL EQFAL Management,',
          'I would like to renew the organization subscription:',
          `- Organization Name: ${cleanOrgName}`,
          ...(cleanOrgId ? [`- Organization ID: ${cleanOrgId}`] : []),
          `- Manager Name: ${cleanManagerName}`,
          `- Manager Google Email: ${cleanManagerEmail}`,
          ...(endDateStr && endDateStr !== '—' ? [`- Current Expiry Date: ${endDateStr}`] : []),
          `- Requested Renewal Duration: ${planLabel}`,
        ].join('\n')
      : language === 'ur'
      ? [
          'السلام علیکم الاقفال انتظامیہ،',
          'میں اپنے ادارے کی سبسکرپشن کی تجدید کی درخواست کرنا چاہتا ہوں:',
          `- ادارے کا نام: ${cleanOrgName}`,
          ...(cleanOrgId ? [`- ادارہ آئی ڈی: ${cleanOrgId}`] : []),
          `- منیجر کا نام: ${cleanManagerName}`,
          `- منیجر گوگل ای میل: ${cleanManagerEmail}`,
          ...(endDateStr && endDateStr !== '—' ? [`- موجودہ اختتامی تاریخ: ${endDateStr}`] : []),
          `- مطلوبہ تجدید کی مدت: ${planLabel}`,
        ].join('\n')
      : [
          'السلام عليكم إدارة نظام الإقفال AL EQFAL،',
          'أرغب في تجديد اشتراك المؤسسة:',
          `- اسم المؤسسة: ${cleanOrgName}`,
          ...(cleanOrgId ? [`- معرّف المؤسسة: ${cleanOrgId}`] : []),
          `- اسم المدير: ${cleanManagerName}`,
          `- بريد المدير: ${cleanManagerEmail}`,
          ...(endDateStr && endDateStr !== '—' ? [`- تاريخ الانتهاء الحالي: ${endDateStr}`] : []),
          `- مدة التجديد المطلوبة: ${planLabel}`,
        ].join('\n');

  return {
    phoneLocal: SUBSCRIPTION_WHATSAPP_LOCAL,
    phoneIntl: SUBSCRIPTION_WHATSAPP_INTL,
    message,
    url: buildSubscriptionWhatsAppUrl(message),
  };
}

/**
 * Prepares a WhatsApp message and click-to-chat URL (966541821068)
 * requesting organization reactivation (10 SAR reactivation fee + 50 SAR/month branch fee)
 * after deactivation due to zero paid branches.
 */
export function buildReactivationSubscriptionWhatsApp(params: {
  orgName: string;
  orgId?: string;
  managerName: string;
  managerEmail: string;
  reactivationFeeSar?: number;
  branchMonthlyFeeSar?: number;
  language?: SupportedLanguage;
}): PreparedWhatsAppLink {
  const language = params.language || 'ar';
  const cleanOrgName = params.orgName.trim();
  const cleanOrgId = params.orgId?.trim();
  const cleanManagerName = params.managerName.trim();
  const cleanManagerEmail = params.managerEmail.trim();
  const reactivationFee = params.reactivationFeeSar ?? 10;
  const branchFee = params.branchMonthlyFeeSar ?? 50;

  const message =
    language === 'en'
      ? [
          'Hello AL EQFAL Management,',
          'Our organization was deactivated due to having zero paid branches. I would like to request reactivation:',
          `- Organization Name: ${cleanOrgName}`,
          ...(cleanOrgId ? [`- Organization ID: ${cleanOrgId}`] : []),
          `- Manager Name: ${cleanManagerName}`,
          `- Manager Google Email: ${cleanManagerEmail}`,
          `- Reactivation Fee: ${reactivationFee} SAR (plus ${branchFee} SAR/month per active branch)`,
        ].join('\n')
      : language === 'ur'
      ? [
          'السلام علیکم الاقفال انتظامیہ،',
          'کوئی ادا شدہ برانچ نہ ہونے کی وجہ سے ہمارا ادارہ غیر فعال ہو گیا ہے۔ میں دوبارہ فعال کرنے کی درخواست کرنا چاہتا ہوں:',
          `- ادارے کا نام: ${cleanOrgName}`,
          ...(cleanOrgId ? [`- ادارہ آئی ڈی: ${cleanOrgId}`] : []),
          `- منیجر کا نام: ${cleanManagerName}`,
          `- منیجر گوگل ای میل: ${cleanManagerEmail}`,
          `- بحالی فیس: ${reactivationFee} ریال (اور ${branchFee} ریال ماہانہ فی فعال برانچ)`,
        ].join('\n')
      : [
          'السلام عليكم إدارة نظام الإقفال AL EQFAL،',
          'تم إيقاف حساب المؤسسة بسبب عدم وجود فروع مدفوعة، وأرغب في طلب إعادة التنشيط:',
          `- اسم المؤسسة: ${cleanOrgName}`,
          ...(cleanOrgId ? [`- معرّف المؤسسة: ${cleanOrgId}`] : []),
          `- اسم المدير: ${cleanManagerName}`,
          `- بريد المدير: ${cleanManagerEmail}`,
          `- رسوم إعادة التنشيط: ${reactivationFee} ريال سعودي (مع ${branchFee} ريال/شهرياً لكل فرع فعال)`,
        ].join('\n');

  return {
    phoneLocal: SUBSCRIPTION_WHATSAPP_LOCAL,
    phoneIntl: SUBSCRIPTION_WHATSAPP_INTL,
    message,
    url: buildSubscriptionWhatsAppUrl(message),
  };
}
