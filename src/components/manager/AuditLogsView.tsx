import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { getUserRoleLabel } from '../../utils/permissions';
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

const ACTION_MAP: Record<string, { label: string; variant: BadgeVariant }> = {
  CLOSING_APPROVED: { label: 'اعتماد إقفال', variant: 'success' },
  CLOSING_REJECTED_FOR_REVISION: { label: 'إرجاع للتعديل', variant: 'danger' },
  CLOSING_SUBMITTED_FOR_REVIEW: { label: 'إرسال إقفال', variant: 'info' },
  CLOSING_DRAFT_SAVED: { label: 'حفظ مسودة', variant: 'neutral' },
  BRANCH_CREATED: { label: 'إنشاء فرع', variant: 'info' },
  CLOSING_ADMIN_CORRECTED: { label: 'تصحيح إداري', variant: 'warning' },
  EMPLOYEE_PROVISIONED: { label: 'إنشاء موظف', variant: 'info' },
  EMPLOYEE_UPDATED: { label: 'تحديث موظف', variant: 'info' },
  EMPLOYEE_BRANCH_CHANGED: { label: 'نقل فرع موظف', variant: 'info' },
  EMPLOYEE_ROLE_PERMISSIONS_UPDATED: { label: 'تعديل دور وصلاحيات', variant: 'warning' },
  EMPLOYEE_PASSWORD_RESET_SENT: { label: 'إرسال استعادة كلمة مرور', variant: 'info' },
  EMPLOYEE_ACTIVATED: { label: 'تنشيط موظف', variant: 'success' },
  EMPLOYEE_DISABLED: { label: 'تعطيل موظف', variant: 'danger' },
  EMPLOYEE_ARCHIVED: { label: 'أرشفة موظف', variant: 'danger' },
  ORGANIZATION_ESTABLISHED: { label: 'تأسيس مؤسسة', variant: 'success' },
};

export const AuditLogsView: React.FC = () => {
  const { auditLogs } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`سجل العمليات والرقابة الإدارية (${auditLogs.length} عملية موثقة)`}
        subtitle="سجل غير قابل للتعديل يوثق جميع اعتمادات الإقفالات، وإرجاع الورديات، وتغييرات الفروع والموظفين"
        icon={<History className="w-5 h-5" />}
      />

      {/* Logs View: Mobile Cards (< 768px) */}
      <div className="block md:hidden space-y-3">
        {auditLogs.map((log) => {
          const act = ACTION_MAP[log.action] || {
            label: log.action,
            variant: 'neutral' as BadgeVariant,
          };

          return (
            <SurfaceCard key={log.id}>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge variant={act.variant}>{act.label}</StatusBadge>
                  <span className="text-[11px] font-mono-num text-slate-400">
                    {new Date(log.timestamp).toLocaleString('ar-SA')}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-bold text-[#0B192C] dark:text-white">{log.actorName}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {getUserRoleLabel(log.actorRole)}
                  </span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 bg-[#F8FAFC] dark:bg-[#0F1E33] p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800/60 leading-relaxed">
                  {log.details}
                </p>
              </div>
            </SurfaceCard>
          );
        })}

        {auditLogs.length === 0 && (
          <SurfaceCard>
            <div className="py-8 text-center text-xs text-slate-400">
              لا توجد عمليات مسجلة في سجل الرقابة حتى الآن.
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
                <th className="p-4 text-start">الوقت والتاريخ</th>
                <th className="p-4 text-start">المنفذ</th>
                <th className="p-4 text-start">نوع العملية</th>
                <th className="p-4 text-start">التفاصيل والتأثير</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => {
                const act = ACTION_MAP[log.action] || {
                  label: log.action,
                  variant: 'neutral' as BadgeVariant,
                };

                return (
                  <tr key={log.id} className={TABLE_ROW}>
                    <td className="p-4 font-mono-num text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('ar-SA')}
                    </td>
                    <td className="p-4 font-bold text-[#0B192C] dark:text-white">
                      <div>{log.actorName}</div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        {getUserRoleLabel(log.actorRole)}
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
              لا توجد عمليات مسجلة في سجل الرقابة حتى الآن.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
