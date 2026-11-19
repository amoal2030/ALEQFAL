import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// Shared Button & Input Class Tokens — Official AL EQFAL Palette (#1764FF / #0B1B32 / #08C99B / #FFFFFF / #F5F8FF)
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1764FF] hover:bg-[#1052D8] active:bg-[#0D43B5] text-white text-xs sm:text-sm font-bold shadow-xs transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#D8E3F6] dark:border-[#23416E] bg-white dark:bg-[#162D50] hover:bg-[#F5F8FF] dark:hover:bg-[#1B365E] text-[#0B1B32] dark:text-white text-xs sm:text-sm font-bold transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const BTN_SUCCESS =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#08C99B] hover:bg-[#06B289] active:bg-[#059676] text-[#0B1B32] text-xs sm:text-sm font-bold shadow-xs transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const BTN_DANGER =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-xl border border-[#D8E3F6] dark:border-[#23416E] bg-white dark:bg-[#0E203A] text-sm text-[#0B1B32] dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400/80 focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20 transition-colors';

export const SELECT_CLASS =
  'w-full px-3.5 py-2.5 rounded-xl border border-[#D8E3F6] dark:border-[#23416E] bg-white dark:bg-[#0E203A] text-sm text-[#0B1B32] dark:text-white focus:outline-none focus:border-[#1764FF] focus:ring-2 focus:ring-[#1764FF]/20 transition-colors';

export const TABLE_WRAPPER =
  'bg-white dark:bg-[#122543] rounded-2xl border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs overflow-hidden';

export const TABLE_HEAD =
  'bg-[#F5F8FF] dark:bg-[#0F213C] border-b border-[#E2EAFA] dark:border-[#1F3B66] text-[11px] font-bold tracking-wide text-[#4A6082] dark:text-slate-300';

export const TABLE_ROW =
  'border-b border-[#EDF2FC] dark:border-[#1B3459] last:border-b-0 hover:bg-[#F5F8FF] dark:hover:bg-[#162D50]/70 transition-colors';

export type BadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  success:
    'bg-[#08C99B]/12 text-[#048264] border-[#08C99B]/35 dark:bg-[#08C99B]/18 dark:text-[#3CE0B9] dark:border-[#08C99B]/35',
  info:
    'bg-[#1764FF]/10 text-[#1252D6] border-[#1764FF]/25 dark:bg-[#1764FF]/20 dark:text-[#7EB0FF] dark:border-[#1764FF]/35',
  warning:
    'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  danger:
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  neutral:
    'bg-[#F5F8FF] text-[#354B6B] border-[#D8E3F6] dark:bg-[#162D50] dark:text-slate-200 dark:border-[#24426E]',
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
        <div className="w-10 h-10 rounded-xl bg-[#1764FF]/10 dark:bg-[#1764FF]/20 border border-[#1764FF]/20 dark:border-[#1764FF]/35 text-[#1764FF] dark:text-[#7EB0FF] flex items-center justify-center shrink-0">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <h2 className="text-lg sm:text-xl font-extrabold text-[#0B1B32] dark:text-white tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs sm:text-sm text-[#526785] dark:text-slate-300 mt-0.5 leading-relaxed">
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
    className={`bg-white dark:bg-[#122543] rounded-2xl border border-[#E2EAFA] dark:border-[#1F3B66] shadow-xs ${className}`}
  >
    {(title || headerAction) && (
      <div className="px-5 py-4 border-b border-[#EDF2FC] dark:border-[#1B3459] flex flex-wrap items-center justify-between gap-3">
        <div>
          {title && (
            <h3 className="text-sm sm:text-base font-extrabold text-[#0B1B32] dark:text-white">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-xs text-[#526785] dark:text-slate-300 mt-0.5">{subtitle}</p>
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
  blue: 'bg-[#1764FF]/10 text-[#1764FF] border-[#1764FF]/20 dark:bg-[#1764FF]/20 dark:text-[#7EB0FF] dark:border-[#1764FF]/35',
  navy: 'bg-[#0B1B32] text-white border-[#1F3B66] dark:bg-[#1764FF]/25 dark:text-white dark:border-[#1764FF]/40',
  sky: 'bg-[#1764FF]/8 text-[#1764FF] border-[#1764FF]/18 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-400/30',
  emerald: 'bg-[#08C99B]/12 text-[#048264] border-[#08C99B]/30 dark:bg-[#08C99B]/20 dark:text-[#3CE0B9] dark:border-[#08C99B]/35',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
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
    className={`bg-white dark:bg-[#122543] rounded-2xl border border-[#E2EAFA] dark:border-[#1F3B66] p-4 sm:p-5 shadow-xs transition-colors ${className}`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-bold text-[#526785] dark:text-slate-300 truncate">{label}</p>
        <div className="text-xl sm:text-2xl font-extrabold text-[#0B1B32] dark:text-white mt-1.5 tabular-nums tracking-tight">
          {value}
        </div>
        {sublabel && (
          <div className="text-[11px] font-medium text-[#647B9C] dark:text-slate-400 mt-1">
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
    info: 'bg-[#1764FF]/8 border-[#1764FF]/25 text-[#0B1B32] dark:bg-[#1764FF]/15 dark:border-[#1764FF]/35 dark:text-blue-100',
    warning:
      'bg-amber-50/90 border-amber-200 text-amber-950 dark:bg-amber-500/15 dark:border-amber-500/35 dark:text-amber-100',
    error:
      'bg-rose-50/90 border-rose-200 text-rose-950 dark:bg-rose-500/15 dark:border-rose-500/35 dark:text-rose-100',
    success:
      'bg-[#08C99B]/12 border-[#08C99B]/35 text-[#064E3B] dark:bg-[#08C99B]/18 dark:border-[#08C99B]/35 dark:text-[#B8F7E6]',
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
        className="fixed inset-0 bg-[#0B1B32]/70 backdrop-blur-xs"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 w-full ${maxWidthClass} max-h-[90vh] flex flex-col bg-white dark:bg-[#122543] rounded-2xl border border-[#DCE6F8] dark:border-[#1F3B66] shadow-2xl overflow-hidden`}
      >
        {/* Unified Deep Navy Modal Header */}
        <div className="bg-[#0B1B32] text-white px-5 py-4 flex items-center justify-between gap-3 border-b border-[#1E3A63]">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="w-9 h-9 rounded-xl bg-[#1764FF]/25 border border-[#1764FF]/40 text-[#9EC2FF] flex items-center justify-center shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-extrabold truncate">{title}</h3>
              {subtitle && (
                <p className="text-[11px] text-slate-300 truncate mt-0.5">{subtitle}</p>
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
          <div className="px-5 py-3.5 bg-[#F5F8FF] dark:bg-[#0E203A] border-t border-[#E2EAFA] dark:border-[#1F3B66] flex flex-wrap items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
