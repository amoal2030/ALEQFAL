import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { getUserRoleLabel } from '../../utils/permissions';
import { SupportedLanguage } from '../../types';
import {
  BadgeVariant,
  PageHeader,
  StatusBadge,
  SurfaceCard,
  TABLE_HEAD,
  TABLE_ROW,
  TABLE_WRAPPER,
} from '../common/UiPrimitives';
import { History, User } from 'lucide-react';

const ACTION_MAP: Record<
  string,
  { labels: Record<SupportedLanguage, string>; variant: BadgeVariant }
> = {
  CLOSING_APPROVED: {
    labels: { ar: 'اعتماد إقفال', en: 'Closing Approved', ur: 'کلوزنگ منظور' },
    variant: 'success',
  },
  CLOSING_REJECTED_FOR_REVISION: {
    labels: { ar: 'إرجاع للتعديل', en: 'Returned for Edit', ur: 'ترمیم کے لیے واپس' },
    variant: 'danger',
  },
  CLOSING_SUBMITTED_FOR_REVIEW: {
    labels: { ar: 'إرسال إقفال', en: 'Closing Submitted', ur: 'کلوزنگ جمع' },
    variant: 'info',
  },
  CLOSING_DRAFT_SAVED: {
    labels: { ar: 'حفظ مسودة', en: 'Draft Saved', ur: 'مسودہ محفوظ' },
    variant: 'neutral',
  },
  BRANCH_CREATED: {
    labels: { ar: 'إنشاء فرع', en: 'Branch Created', ur: 'برانچ بنائی گئی' },
    variant: 'info',
  },
  CLOSING_ADMIN_CORRECTED: {
    labels: { ar: 'تصحيح إداري', en: 'Admin Correction', ur: 'انتظامی تصحیح' },
    variant: 'warning',
  },
  EMPLOYEE_PROVISIONED: {
    labels: { ar: 'إنشاء موظف', en: 'Staff Created', ur: 'ملازم شامل کیا گیا' },
    variant: 'info',
  },
  EMPLOYEE_UPDATED: {
    labels: { ar: 'تحديث موظف', en: 'Staff Updated', ur: 'ملازم اپ ڈیٹ' },
    variant: 'info',
  },
  EMPLOYEE_BRANCH_CHANGED: {
    labels: { ar: 'نقل فرع موظف', en: 'Branch Transfer', ur: 'برانچ منتقلی' },
    variant: 'info',
  },
  EMPLOYEE_ROLE_PERMISSIONS_UPDATED: {
    labels: { ar: 'تعديل دور وصلاحيات', en: 'Role & Permissions Updated', ur: 'کردار اور اختیارات اپ ڈیٹ' },
    variant: 'warning',
  },
  EMPLOYEE_PASSWORD_RESET_SENT: {
    labels: { ar: 'إرسال استعادة كلمة مرور', en: 'Password Reset Sent', ur: 'پاس ورڈ ری سیٹ بھیجا گیا' },
    variant: 'info',
  },
  EMPLOYEE_ACTIVATED: {
    labels: { ar: 'تنشيط موظف', en: 'Staff Activated', ur: 'ملازم فعال' },
    variant: 'success',
  },
  EMPLOYEE_DISABLED: {
    labels: { ar: 'تعطيل موظف', en: 'Staff Disabled', ur: 'ملازم غیر فعال' },
    variant: 'danger',
  },
  EMPLOYEE_ARCHIVED: {
    labels: { ar: 'أرشفة موظف', en: 'Staff Archived', ur: 'ملازم آرکائیو' },
    variant: 'danger',
  },
  ORGANIZATION_ESTABLISHED: {
    labels: { ar: 'تأسيس مؤسسة', en: 'Organization Created', ur: 'ادارہ قائم کیا گیا' },
    variant: 'success',
  },
};

export const AuditLogsView: React.FC = () => {
  const { auditLogs } = useAuth();
  const { language, tr } = useLanguage();
  const locale = language === 'en' ? 'en-US' : language === 'ur' ? 'ur-PK' : 'ar-SA';

  const resolveAction = (action: string) => {
    const found = ACTION_MAP[action];
    if (!found) {
      return { label: action, variant: 'neutral' as BadgeVariant };
    }
    return { label: found.labels[language] || found.labels.ar, variant: found.variant };
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr(
          `سجل العمليات والرقابة الإدارية (${auditLogs.length} عملية موثقة)`,
          `Audit & Governance Trail (${auditLogs.length} logged events)`,
          `آپریشنز اور انتظامی آڈٹ لاگ (${auditLogs.length} ریکارڈز)`
        )}
        subtitle={tr(
          'سجل غير قابل للتعديل يوثق جميع اعتمادات الإقفالات، وإرجاع الورديات، وتغييرات الفروع والموظفين',
          'Immutable ledger documenting all shift approvals, returns, branch changes, and team updates',
          'ناقابلِ تبدیلی ریکارڈ جو تمام کلوزنگ منظوریوں، واپسیوں اور برانچ و ملازمین کی تبدیلیوں کو محفوظ رکھتا ہے'
        )}
        icon={<History className="w-5 h-5" />}
      />

      {/* Logs View: Mobile Cards (< 768px) */}
      <div className="block md:hidden space-y-3">
        {auditLogs.map((log) => {
          const act = resolveAction(log.action);

          return (
            <SurfaceCard key={log.id}>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge variant={act.variant}>{act.label}</StatusBadge>
                  <span className="text-[11px] font-mono-num text-slate-400" dir="ltr">
                    {new Date(log.timestamp).toLocaleString(locale)}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <User className="w-3.5 h-3.5 text-[#1764FF] dark:text-[#6CA2FF]" />
                  <span className="font-bold text-[#0B1B32] dark:text-white">{log.actorName}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F8FF] dark:bg-[#0E203A] border border-[#DCE6FA] dark:border-[#1F3B66] text-slate-600 dark:text-slate-300">
                    {getUserRoleLabel(log.actorRole, language)}
                  </span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 bg-[#F5F8FF] dark:bg-[#0E203A] p-2.5 rounded-xl border border-[#DCE6FA] dark:border-[#1F3B66] leading-relaxed">
                  {log.details}
                </p>
              </div>
            </SurfaceCard>
          );
        })}

        {auditLogs.length === 0 && (
          <SurfaceCard>
            <div className="py-8 text-center text-xs text-slate-400">
              {tr(
                'لا توجد عمليات مسجلة في سجل الرقابة حتى الآن.',
                'No audit events have been recorded yet.',
                'آڈٹ لاگ میں ابھی تک کوئی سرگرمی درج نہیں ہوئی۔'
              )}
            </div>
          </SurfaceCard>
        )}
      </div>

      {/* Logs Table: Desktop (>= 768px) */}
      <div className={`hidden md:block ${TABLE_WRAPPER}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs sm:text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="p-4 text-start">{tr('الوقت والتاريخ', 'Date & Time', 'تاریخ اور وقت')}</th>
                <th className="p-4 text-start">{tr('المنفذ', 'Actor', 'عمل کرنے والا')}</th>
                <th className="p-4 text-start">{tr('نوع العملية', 'Action', 'عمل کی نوعیت')}</th>
                <th className="p-4 text-start">{tr('التفاصيل والتأثير', 'Details & Impact', 'تفصیلات اور اثر')}</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => {
                const act = resolveAction(log.action);

                return (
                  <tr key={log.id} className={TABLE_ROW}>
                    <td className="p-4 font-mono-num text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap" dir="ltr">
                      {new Date(log.timestamp).toLocaleString(locale)}
                    </td>
                    <td className="p-4 font-bold text-[#0B1B32] dark:text-white">
                      <div>{log.actorName}</div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        {getUserRoleLabel(log.actorRole, language)}
                      </div>
                    </td>
                    <td className="p-4">
                      <StatusBadge variant={act.variant}>{act.label}</StatusBadge>
                    </td>
                    <td className="p-4 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                      {log.details}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {auditLogs.length === 0 && (
            <div className="py-12 text-center text-xs text-slate-400">
              {tr(
                'لا توجد عمليات مسجلة في سجل الرقابة حتى الآن.',
                'No audit events have been recorded yet.',
                'آڈٹ لاگ میں ابھی تک کوئی سرگرمی درج نہیں ہوئی۔'
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
