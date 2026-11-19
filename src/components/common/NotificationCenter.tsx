import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Building2,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  ShieldAlert,
  ShoppingBag,
  Users,
  Volume2,
  VolumeX,
  BellRing,
  BellOff,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  AppNotification,
  BrowserNotificationCapability,
  NotificationCategory,
  NotificationNavTarget,
  NotificationSeverity,
} from '../../types';
import {
  getBrowserNotificationCapability,
  isNotificationReadByUser,
  requestBrowserNotificationPermission,
  unlockNotificationAudio,
} from '../../utils/notifications';

interface NotificationCenterProps {
  surface: 'tenant' | 'super_admin';
  onNavigate?: (target: NotificationNavTarget, notification?: AppNotification) => void;
}

const CATEGORY_FILTER_OPTIONS: Array<{
  id: 'all' | NotificationCategory;
  labelKey:
    | 'notifCatAll'
    | 'notifCatEmployees'
    | 'notifCatClosings'
    | 'notifCatSchedule'
    | 'notifCatPurchases'
    | 'notifCatOrgBranches'
    | 'notifCatSecurity';
}> = [
  { id: 'all', labelKey: 'notifCatAll' },
  { id: 'closings', labelKey: 'notifCatClosings' },
  { id: 'employees', labelKey: 'notifCatEmployees' },
  { id: 'org_branches', labelKey: 'notifCatOrgBranches' },
  { id: 'security_admin', labelKey: 'notifCatSecurity' },
  { id: 'purchases_suppliers', labelKey: 'notifCatPurchases' },
  { id: 'schedule_requests', labelKey: 'notifCatSchedule' },
];

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  surface,
  onNavigate,
}) => {
  const {
    currentUser,
    tenantNotifications,
    superAdminNotifications,
    notificationsLoading,
    tenantNotificationsHasMore,
    superAdminNotificationsHasMore,
    notificationSoundEnabled,
    toggleNotificationSound,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    loadMoreNotifications,
  } = useAuth();
  const { t, language, direction } = useLanguage();

  const [open, setOpen] = useState(false);
  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | NotificationCategory>('all');
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [browserCap, setBrowserCap] = useState<BrowserNotificationCapability>(() =>
    getBrowserNotificationCapability()
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const uid = currentUser?.uid || null;

  const notifications =
    surface === 'super_admin' ? superAdminNotifications : tenantNotifications;
  const hasMore =
    surface === 'super_admin'
      ? superAdminNotificationsHasMore
      : tenantNotificationsHasMore;

  const unreadCount = useMemo(
    () => notifications.filter((n) => !isNotificationReadByUser(n, uid)).length,
    [notifications, uid]
  );

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (readFilter === 'unread' && isNotificationReadByUser(n, uid)) {
        return false;
      }
      if (categoryFilter !== 'all' && n.category !== categoryFilter) {
        return false;
      }
      return true;
    });
  }, [notifications, readFilter, categoryFilter, uid]);

  useEffect(() => {
    if (!open) return;
    setBrowserCap(getBrowserNotificationCapability());

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleToggleOpen = () => {
    unlockNotificationAudio();
    setOpen((prev) => !prev);
  };

  const handleRequestBrowserPermission = async () => {
    unlockNotificationAudio();
    await requestBrowserNotificationPermission();
    setBrowserCap(getBrowserNotificationCapability());
  };

  const handleMarkOneRead = async (
    event: React.MouseEvent,
    notificationId: string
  ) => {
    event.stopPropagation();
    if (!notificationId || markingId === notificationId) return;
    setMarkingId(notificationId);
    try {
      await markNotificationAsRead(notificationId);
    } catch (err) {
      console.warn('Notice marking notification read:', err);
    } finally {
      setMarkingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsAsRead(surface);
    } catch (err) {
      console.warn('Notice marking all notifications read:', err);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleItemActivate = async (notification: AppNotification) => {
    if (!isNotificationReadByUser(notification, uid)) {
      try {
        await markNotificationAsRead(notification.id);
      } catch (err) {
        console.warn('Notice marking clicked notification read:', err);
      }
    }
    if (notification.navTarget && onNavigate) {
      onNavigate(notification.navTarget, notification);
      setOpen(false);
    }
  };

  const formatTimestamp = (iso: string): string => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    const locale = language === 'en' ? 'en-US' : language === 'ur' ? 'ur-PK' : 'ar-SA';
    return parsed.toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getCategoryMeta = (category: NotificationCategory) => {
    switch (category) {
      case 'employees':
        return {
          label: t('notifCatEmployees'),
          Icon: Users,
          tone: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/15 border-sky-200 dark:border-sky-500/25',
        };
      case 'closings':
        return {
          label: t('notifCatClosings'),
          Icon: FileSpreadsheet,
          tone: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 border-blue-200 dark:border-blue-500/25',
        };
      case 'schedule_requests':
        return {
          label: t('notifCatSchedule'),
          Icon: CalendarClock,
          tone: 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 border-indigo-200 dark:border-indigo-500/25',
        };
      case 'purchases_suppliers':
        return {
          label: t('notifCatPurchases'),
          Icon: ShoppingBag,
          tone: 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-500/15 border-teal-200 dark:border-teal-500/25',
        };
      case 'org_branches':
        return {
          label: t('notifCatOrgBranches'),
          Icon: Building2,
          tone: 'text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 border-blue-200 dark:border-blue-500/25',
        };
      case 'security_admin':
      default:
        return {
          label: t('notifCatSecurity'),
          Icon: ShieldAlert,
          tone: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/25',
        };
    }
  };

  const getSeverityPill = (severity: NotificationSeverity) => {
    if (severity === 'critical') {
      return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30';
    }
    if (severity === 'warning') {
      return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30';
    }
    if (severity === 'success') {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30';
    }
    return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  };

  const NavArrow = direction === 'rtl' ? ChevronLeft : ChevronRight;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-label={t('notifTitle')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`relative inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl border transition-colors ${
          open
            ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-500/15 dark:border-blue-500/50 dark:text-blue-300'
            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-slate-700 bg-slate-50 dark:bg-slate-800/80'
        }`}
        title={t('notifTitle')}
      >
        <Bell className="w-4 h-4 sm:w-[17px] sm:h-[17px]" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1.5 -end-1.5 min-w-[19px] h-[19px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold font-mono-num flex items-center justify-center shadow-xs border-2 border-white dark:border-[#0C1829]"
            aria-label={`${unreadCount} ${t('notifUnread')}`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('notifTitle')}
          className="fixed inset-x-3 top-[4.4rem] sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-2 sm:w-[440px] max-h-[82vh] flex flex-col rounded-2xl bg-white dark:bg-[#0C1829] border border-slate-200 dark:border-slate-800 shadow-2xl z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3.5 border-b border-[#1A3152] flex items-center justify-between gap-2 bg-[#0B192C] text-white">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-600/25 border border-blue-400/30 text-blue-200 flex items-center justify-center shrink-0">
                <Bell className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-extrabold text-white truncate">
                    {t('notifTitle')}
                  </h2>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 rounded-md bg-blue-500/25 border border-blue-400/30 text-blue-100 text-[10px] font-bold font-mono-num">
                      {unreadCount} {t('notifUnread')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={toggleNotificationSound}
                title={notificationSoundEnabled ? t('notifSoundOn') : t('notifSoundOff')}
                aria-label={notificationSoundEnabled ? t('notifSoundOn') : t('notifSoundOff')}
                className={`p-2 rounded-lg border text-xs transition-colors ${
                  notificationSoundEnabled
                    ? 'border-blue-400/40 bg-blue-600/25 text-blue-100'
                    : 'border-white/15 bg-white/5 text-slate-300 hover:text-white'
                }`}
              >
                {notificationSoundEnabled ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
              </button>

              {browserCap.supported && browserCap.isSecureContext && (
                <button
                  type="button"
                  onClick={handleRequestBrowserPermission}
                  disabled={browserCap.permission === 'granted' || browserCap.permission === 'denied'}
                  title={
                    browserCap.permission === 'granted'
                      ? `${t('notifBrowserAlertsOn')} — ${t('notifBrowserAlertsHint')}`
                      : browserCap.permission === 'denied'
                      ? `${t('notifBrowserAlertsBlocked')} — ${t('notifBrowserAlertsHint')}`
                      : `${t('notifBrowserAlertsEnable')} — ${t('notifBrowserAlertsHint')}`
                  }
                  aria-label={
                    browserCap.permission === 'granted'
                      ? t('notifBrowserAlertsOn')
                      : browserCap.permission === 'denied'
                      ? t('notifBrowserAlertsBlocked')
                      : t('notifBrowserAlertsEnable')
                  }
                  className={`p-2 rounded-lg border text-xs transition-colors ${
                    browserCap.permission === 'granted'
                      ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200 cursor-default'
                      : browserCap.permission === 'denied'
                      ? 'border-white/10 text-slate-400 opacity-60 cursor-not-allowed'
                      : 'border-white/15 bg-white/5 text-slate-200 hover:border-blue-400/40 hover:text-white'
                  }`}
                >
                  {browserCap.permission === 'denied' ? (
                    <BellOff className="w-4 h-4" />
                  ) : (
                    <BellRing className="w-4 h-4" />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filter & Actions Bar */}
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2 bg-white dark:bg-[#0C1829]">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center rounded-xl bg-[#F4F7FB] dark:bg-[#070E17] p-1 border border-slate-200/80 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setReadFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                    readFilter === 'all'
                      ? 'bg-white dark:bg-[#0C1829] text-[#0B192C] dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-[#0B192C] dark:hover:text-slate-200'
                  }`}
                >
                  {t('notifAll')} ({notifications.length})
                </button>
                <button
                  type="button"
                  onClick={() => setReadFilter('unread')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                    readFilter === 'unread'
                      ? 'bg-white dark:bg-[#0C1829] text-blue-700 dark:text-blue-300 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-[#0B192C] dark:hover:text-slate-200'
                  }`}
                >
                  {t('notifUnread')} ({unreadCount})
                </button>
              </div>

              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={unreadCount === 0 || markingAll}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>{t('notifMarkAllRead')}</span>
              </button>
            </div>

            {/* Category filter strip */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
              {CATEGORY_FILTER_OPTIONS.map((cat) => {
                const active = categoryFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryFilter(cat.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap border transition-colors ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-[#F4F7FB] dark:bg-[#070E17] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {t(cat.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notifications List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
            {notificationsLoading && notifications.length === 0 ? (
              <div className="py-12 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
                ...
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="py-12 px-6 text-center space-y-2">
                <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto">
                  <Bell className="w-5 h-5" />
                </div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t('notifEmpty')}
                </p>
              </div>
            ) : (
              filteredNotifications.map((notification) => {
                const isRead = isNotificationReadByUser(notification, uid);
                const meta = getCategoryMeta(notification.category);
                const CatIcon = meta.Icon;
                const canNavigate = Boolean(notification.navTarget && onNavigate);

                return (
                  <div
                    key={notification.id}
                    onClick={() => void handleItemActivate(notification)}
                    role={canNavigate ? 'button' : undefined}
                    tabIndex={canNavigate ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (canNavigate && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        void handleItemActivate(notification);
                      }
                    }}
                    className={`p-3.5 sm:p-4 transition-colors ${
                      canNavigate ? 'cursor-pointer' : ''
                    } ${
                      !isRead
                        ? 'bg-blue-50/75 dark:bg-blue-950/30 hover:bg-blue-50 dark:hover:bg-blue-950/45'
                        : 'bg-white dark:bg-[#0C1829] hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${meta.tone}`}
                      >
                        <CatIcon className="w-4 h-4" />
                      </div>

                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {!isRead && (
                              <span
                                className="w-2 h-2 rounded-full bg-blue-600 shrink-0"
                                aria-label={t('notifNewBadge')}
                              />
                            )}
                            <h3
                              className={`text-xs sm:text-[13px] leading-snug ${
                                !isRead
                                  ? 'font-bold text-[#0B192C] dark:text-white'
                                  : 'font-semibold text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {notification.title}
                            </h3>
                          </div>

                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${getSeverityPill(
                              notification.severity
                            )}`}
                          >
                            {meta.label}
                          </span>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed break-words">
                          {notification.body}
                        </p>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono-num" dir="ltr">
                              {formatTimestamp(notification.createdAt)}
                            </span>
                            {notification.branchName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate max-w-[130px] font-medium">
                                  {notification.branchName}
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {!isRead ? (
                              <button
                                type="button"
                                onClick={(e) => void handleMarkOneRead(e, notification.id)}
                                disabled={markingId === notification.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-500/20 dark:hover:bg-blue-500/30 dark:text-blue-200 transition-colors disabled:opacity-50"
                              >
                                <Check className="w-3 h-3" />
                                <span>{t('notifMarkRead')}</span>
                              </button>
                            ) : (
                              <span className="text-[10px] font-medium text-slate-400">
                                {t('notifReadBadge')}
                              </span>
                            )}

                            {canNavigate && (
                              <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-blue-700 dark:text-blue-300">
                                <span>{t('notifOpenTarget')}</span>
                                <NavArrow className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {hasMore && (
              <div className="p-3 text-center">
                <button
                  type="button"
                  onClick={() => loadMoreNotifications(surface)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 border border-blue-200 dark:border-blue-800 transition-colors"
                >
                  {t('notifLoadMore')}
                </button>
              </div>
            )}
          </div>

          {/* Footer: Foreground vs Push explanation + Audit Integrity Notice (Zero Delete) */}
          <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-[#F4F7FB] dark:bg-[#091526] space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
            <p className="leading-relaxed">{t('notifNoDeleteHint')}</p>
            {browserCap.supported && browserCap.permission !== 'granted' && (
              <p className="leading-relaxed text-slate-400">{t('notifBrowserAlertsHint')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
