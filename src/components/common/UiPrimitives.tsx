import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// Shared Button & Input Class Tokens — Navy / White / Blue Standard
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-[#0B192C] dark:text-slate-100 text-xs sm:text-sm font-bold transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const BTN_SUCCESS =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const BTN_DANGER =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F1E33] text-sm text-[#0B192C] dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 transition-colors';

export const SELECT_CLASS =
  'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F1E33] text-sm text-[#0B192C] dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 transition-colors';

export const TABLE_WRAPPER =
  'bg-white dark:bg-[#0C1829] rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs overflow-hidden';

export const TABLE_HEAD =
  'bg-[#F8FAFC] dark:bg-[#102036] border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400';

export const TABLE_ROW =
  'border-b border-slate-100 dark:border-slate-800/80 last:border-b-0 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors';

export type BadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  success:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  info:
    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  warning:
    'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  danger:
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  neutral:
    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

export const StatusBadge: React.FC<{
  variant?: BadgeVariant;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ variant = 'neutral', icon, children, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold leading-none ${BADGE_CLASSES[variant]} ${className}`}
  >
    {icon}
    <span>{children}</span>
  </span>
);

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, subtitle, icon, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
    <div className="flex items-start gap-3 min-w-0">
      {icon && (
        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/15 border border-blue-100 dark:border-blue-500/25 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <h2 className="text-lg sm:text-xl font-extrabold text-[#0B192C] dark:text-white tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export const SurfaceCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  noPadding?: boolean;
}> = ({ children, className = '', title, subtitle, headerAction, noPadding = false }) => (
  <div
    className={`bg-white dark:bg-[#0C1829] rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs ${className}`}
  >
    {(title || headerAction) && (
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          {title && (
            <h3 className="text-sm sm:text-base font-extrabold text-[#0B192C] dark:text-white">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        {headerAction && <div className="flex items-center gap-2">{headerAction}</div>}
      </div>
    )}
    <div className={noPadding ? '' : 'p-5'}>{children}</div>
  </div>
);

export type KpiTone = 'blue' | 'navy' | 'emerald' | 'amber' | 'rose' | 'sky';

const KPI_ICON_TONES: Record<KpiTone, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
  navy: 'bg-[#0B192C] text-white border-[#1B3355] dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800',
  sky: 'bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/25',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25',
  amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25',
  rose: 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25',
};

export const KpiStatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: KpiTone;
  className?: string;
}> = ({ label, value, sublabel, icon, tone = 'blue', className = '' }) => (
  <div
    className={`bg-white dark:bg-[#0C1829] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 shadow-xs transition-colors ${className}`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 truncate">{label}</p>
        <div className="text-xl sm:text-2xl font-extrabold text-[#0B192C] dark:text-white mt-1.5 tabular-nums tracking-tight">
          {value}
        </div>
        {sublabel && (
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-1">
            {sublabel}
          </div>
        )}
      </div>
      {icon && (
        <div
          className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${KPI_ICON_TONES[tone]}`}
        >
          {icon}
        </div>
      )}
    </div>
  </div>
);

export const AlertBanner: React.FC<{
  variant?: 'info' | 'warning' | 'error' | 'success';
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}> = ({ variant = 'info', icon, title, children, action, onDismiss, className = '' }) => {
  const styles = {
    info: 'bg-blue-50/90 border-blue-200 text-blue-950 dark:bg-blue-950/40 dark:border-blue-800/70 dark:text-blue-100',
    warning:
      'bg-amber-50/90 border-amber-200 text-amber-950 dark:bg-amber-950/35 dark:border-amber-800/70 dark:text-amber-100',
    error:
      'bg-rose-50/90 border-rose-200 text-rose-950 dark:bg-rose-950/35 dark:border-rose-800/70 dark:text-rose-100',
    success:
      'bg-emerald-50/90 border-emerald-200 text-emerald-950 dark:bg-emerald-950/35 dark:border-emerald-800/70 dark:text-emerald-100',
  }[variant];

  return (
    <div
      className={`rounded-2xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${styles} ${className}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
        <div className="min-w-0 text-xs sm:text-sm leading-relaxed">
          {title && <p className="font-extrabold mb-0.5">{title}</p>}
          <div>{children}</div>
        </div>
      </div>
      {(action || onDismiss) && (
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {action}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const ModalShell: React.FC<{
  open?: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  maxWidthClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({
  open = true,
  onClose,
  title,
  subtitle,
  icon,
  maxWidthClass = 'max-w-lg',
  children,
  footer,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 w-full ${maxWidthClass} max-h-[90vh] flex flex-col bg-white dark:bg-[#0C1829] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden`}
      >
        {/* Unified Dark Navy Modal Header */}
        <div className="bg-[#0B192C] text-white px-5 py-4 flex items-center justify-between gap-3 border-b border-[#1A3152]">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="w-9 h-9 rounded-xl bg-blue-600/25 border border-blue-400/30 text-blue-200 flex items-center justify-center shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-extrabold truncate">{title}</h3>
              {subtitle && (
                <p className="text-[11px] text-blue-200/80 truncate mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 bg-slate-50 dark:bg-[#091526] border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
