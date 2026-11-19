import React, { useEffect, useId, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { BrandLogo } from './BrandLogo';

interface Particle {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  baseAlpha: number;
  phase: number;
  twinkleSpeed: number;
  isTeal: boolean;
}

/**
 * Unified Official Main Loading Screen for الإقفال | AL EQFAL
 * - Automatically adapts between Dark Mode and Light Mode via ThemeContext
 * - Uses the official BrandLogo component (logo-dark.png / logo-light.png) untouched
 * - Features lightweight Canvas light particles, dual ambient halos, dashed orbit ring,
 *   gradient loading arc with mathematically synchronized comet head, frosted glass core,
 *   breathing floating logo animation, and animated "جاري التحميل..." dots.
 * - Respects prefers-reduced-motion and pauses canvas work when the tab is hidden.
 */
export const AppLoadingScreen: React.FC = () => {
  const { theme } = useTheme();
  const { direction, language } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uid = useId().replace(/:/g, '');
  const isDark = theme === 'dark';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motionQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let reducedMotion = motionQuery ? motionQuery.matches : false;
    let rafId: number | null = null;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];

    const createParticles = (w: number, h: number): Particle[] => {
      const count = w < 640 ? 20 : 34;
      const list: Particle[] = [];
      for (let i = 0; i < count; i += 1) {
        list.push({
          x: Math.random() * w,
          y: Math.random() * h,
          radius: (w < 640 ? 1.1 : 1.3) + Math.random() * 2.1,
          vx: (Math.random() - 0.5) * 0.24,
          vy: -(0.12 + Math.random() * 0.26),
          baseAlpha: isDark ? 0.22 + Math.random() * 0.45 : 0.16 + Math.random() * 0.3,
          phase: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.008 + Math.random() * 0.015,
          isTeal: i % 3 === 0,
        });
      }
      return list;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = createParticles(width, height);
    };

    const drawFrame = (animate: boolean) => {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (animate) {
          p.x += p.vx;
          p.y += p.vy;
          p.phase += p.twinkleSpeed;

          if (p.y < -12) {
            p.y = height + 12;
            p.x = Math.random() * width;
          }
          if (p.x < -12) p.x = width + 12;
          if (p.x > width + 12) p.x = -12;
        }

        const twinkle = animate ? 0.55 + 0.45 * Math.sin(p.phase) : 0.85;
        const alpha = p.baseAlpha * twinkle;
        const rgb = p.isTeal
          ? '8, 201, 155'
          : isDark
          ? '92, 156, 255'
          : '23, 100, 255';

        // Soft outer glow
        const glowRadius = p.radius * (isDark ? 3.2 : 2.8);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRadius);
        grad.addColorStop(0, `rgba(${rgb}, ${alpha.toFixed(3)})`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);

        ctx.beginPath();
        ctx.fillStyle = grad;
        ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // Crisp inner core
        ctx.beginPath();
        ctx.fillStyle = isDark
          ? `rgba(255, 255, 255, ${(alpha * 0.72).toFixed(3)})`
          : `rgba(${rgb}, ${(alpha * 0.85).toFixed(3)})`;
        ctx.arc(p.x, p.y, p.radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const tick = () => {
      if (document.hidden || reducedMotion) {
        stopLoop();
        return;
      }
      drawFrame(true);
      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      stopLoop();
      if (reducedMotion) {
        drawFrame(false);
        return;
      }
      if (!document.hidden) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopLoop();
      } else {
        start();
      }
    };

    const handleMotionChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
      start();
    };

    resize();
    start();

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', handleVisibility);
    if (motionQuery && typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', handleMotionChange);
    }

    return () => {
      stopLoop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (motionQuery && typeof motionQuery.removeEventListener === 'function') {
        motionQuery.removeEventListener('change', handleMotionChange);
      }
    };
  }, [isDark]);

  const loadingLabel =
    language === 'en'
      ? 'Loading'
      : language === 'ur'
      ? 'لوڈ ہو رہا ہے'
      : 'جاري التحميل';

  const arcGradId = `al-arc-grad-${uid}`;
  const arcGlowGradId = `al-arc-glow-${uid}`;
  const cometBloomId = `al-comet-bloom-${uid}`;
  const cometFilterId = `al-comet-blur-${uid}`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      dir={direction}
      data-testid="app-loading-screen"
      data-theme-mode={theme}
      className={`fixed inset-0 z-50 h-[100dvh] w-full overflow-hidden flex items-center justify-center select-none transition-colors duration-300 ${
        isDark
          ? 'bg-[radial-gradient(ellipse_at_50%_40%,#102546_0%,#0B1B32_55%,#061121_100%)] text-white'
          : 'bg-[radial-gradient(ellipse_at_50%_38%,#FFFFFF_0%,#F5F8FF_58%,#EAF1FF_100%)] text-[#0B1B32]'
      }`}
    >
      {/* Background Light Particles Canvas */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {/* Ambient Blue & Emerald Floating Light Halos */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-20 -start-16 h-[290px] w-[290px] sm:h-[430px] sm:w-[430px] rounded-full blur-3xl al-loader-halo-a ${
          isDark
            ? 'bg-[radial-gradient(circle,rgba(23,100,255,0.34)_0%,rgba(23,100,255,0)_70%)]'
            : 'bg-[radial-gradient(circle,rgba(23,100,255,0.16)_0%,rgba(23,100,255,0)_70%)]'
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -bottom-24 -end-16 h-[290px] w-[290px] sm:h-[440px] sm:w-[440px] rounded-full blur-3xl al-loader-halo-b ${
          isDark
            ? 'bg-[radial-gradient(circle,rgba(8,201,155,0.28)_0%,rgba(8,201,155,0)_70%)]'
            : 'bg-[radial-gradient(circle,rgba(8,201,155,0.16)_0%,rgba(8,201,155,0)_70%)]'
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute h-[240px] w-[240px] sm:h-[320px] sm:w-[320px] rounded-full blur-3xl ${
          isDark
            ? 'bg-[radial-gradient(circle,rgba(23,100,255,0.18)_0%,rgba(8,201,155,0.08)_48%,transparent_72%)]'
            : 'bg-[radial-gradient(circle,rgba(23,100,255,0.09)_0%,rgba(8,201,155,0.07)_52%,transparent_74%)]'
        }`}
      />

      {/* Centered Orbital Loader Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center px-6 max-w-full">
        <div className="relative flex items-center justify-center w-[212px] h-[212px] sm:w-[258px] sm:h-[258px]">
          {/* Concentric SVG Orbit, Gradient Arc & Synchronized Comet Head */}
          <svg
            viewBox="0 0 260 260"
            aria-hidden="true"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            <defs>
              {/* Main gradient loading arc from transparent Royal Blue to vivid Emerald Teal */}
              <linearGradient
                id={arcGradId}
                x1="195.56"
                y1="208.14"
                x2="130"
                y2="28"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#1764FF" stopOpacity="0" />
                <stop offset="28%" stopColor="#1764FF" stopOpacity={isDark ? '0.45' : '0.35'} />
                <stop offset="68%" stopColor="#1764FF" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#08C99B" stopOpacity="1" />
              </linearGradient>

              {/* Soft outer bloom stroke for the arc */}
              <linearGradient
                id={arcGlowGradId}
                x1="195.56"
                y1="208.14"
                x2="130"
                y2="28"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#1764FF" stopOpacity="0" />
                <stop offset="55%" stopColor="#1764FF" stopOpacity={isDark ? '0.38' : '0.22'} />
                <stop offset="100%" stopColor="#08C99B" stopOpacity={isDark ? '0.68' : '0.45'} />
              </linearGradient>

              {/* Radial bloom for the leading comet head */}
              <radialGradient id={cometBloomId} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
                <stop offset="32%" stopColor="#08C99B" stopOpacity={isDark ? '0.92' : '0.85'} />
                <stop offset="68%" stopColor="#1764FF" stopOpacity={isDark ? '0.42' : '0.28'} />
                <stop offset="100%" stopColor="#1764FF" stopOpacity="0" />
              </radialGradient>

              <filter id={cometFilterId} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>

            {/* Outer Dashed Orbit Ring */}
            <g className="al-loader-dashed-orbit">
              <circle
                cx="130"
                cy="130"
                r="120"
                fill="none"
                stroke={isDark ? 'rgba(108, 162, 255, 0.28)' : 'rgba(23, 100, 255, 0.22)'}
                strokeWidth="1.25"
                strokeDasharray="4 9"
                strokeLinecap="round"
              />
              {/* Two subtle orbital ticks on the dashed ring */}
              <circle
                cx="130"
                cy="10"
                r="2.2"
                fill={isDark ? '#08C99B' : '#1764FF'}
                fillOpacity={isDark ? '0.75' : '0.55'}
              />
              <circle
                cx="130"
                cy="250"
                r="2"
                fill={isDark ? '#1764FF' : '#08C99B'}
                fillOpacity={isDark ? '0.75' : '0.55'}
              />
            </g>

            {/* Subtle Base Track Ring */}
            <circle
              cx="130"
              cy="130"
              r="102"
              fill="none"
              stroke={isDark ? 'rgba(108, 162, 255, 0.14)' : 'rgba(23, 100, 255, 0.11)'}
              strokeWidth="2.5"
            />

            {/* Delicate Inner Accent Orbit */}
            <g className="al-loader-inner-orbit">
              <circle
                cx="130"
                cy="130"
                r="86"
                fill="none"
                stroke={isDark ? 'rgba(8, 201, 155, 0.16)' : 'rgba(8, 201, 155, 0.2)'}
                strokeWidth="1"
                strokeDasharray="2 12"
              />
            </g>

            {/* Synchronized Rotating Gradient Arc + Glowing Comet Head */}
            <g className="al-loader-comet-group">
              {/* Soft glow halo along the loading arc */}
              <path
                d="M 195.56 208.14 A 102 102 0 1 1 130 28"
                fill="none"
                stroke={`url(#${arcGlowGradId})`}
                strokeWidth="8"
                strokeLinecap="round"
                filter={`url(#${cometFilterId})`}
              />

              {/* Crisp primary gradient loading arc */}
              <path
                d="M 195.56 208.14 A 102 102 0 1 1 130 28"
                fill="none"
                stroke={`url(#${arcGradId})`}
                strokeWidth="3.5"
                strokeLinecap="round"
              />

              {/* Synchronized Comet Head locked to exact arc tip (130, 28) */}
              <circle cx="130" cy="28" r="14" fill={`url(#${cometBloomId})`} />
              <circle
                cx="130"
                cy="28"
                r="4.6"
                fill="#08C99B"
                fillOpacity={isDark ? '0.95' : '0.88'}
              />
              <circle cx="130" cy="28" r="2.3" fill="#FFFFFF" />
            </g>
          </svg>

          {/* Inner Frosted Glass Halo */}
          <div
            aria-hidden="true"
            className={`absolute w-[124px] h-[124px] sm:w-[152px] sm:h-[152px] rounded-full backdrop-blur-md al-loader-glass-pulse transition-colors duration-300 ${
              isDark
                ? 'bg-[radial-gradient(circle_at_35%_30%,rgba(28,58,104,0.68)_0%,rgba(14,32,58,0.56)_65%,rgba(11,27,50,0.72)_100%)] border border-[#6CA2FF]/25 shadow-[0_0_40px_rgba(23,100,255,0.22),inset_0_1px_1px_rgba(255,255,255,0.14)]'
                : 'bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.92)_0%,rgba(245,248,255,0.76)_70%,rgba(232,240,255,0.68)_100%)] border border-[#1764FF]/15 shadow-[0_14px_40px_rgba(11,27,50,0.08),0_0_28px_rgba(23,100,255,0.10),inset_0_1px_2px_rgba(255,255,255,0.95)]'
            }`}
          />

          {/* Official Brand Logo with Breathing & Floating Motion (Untouched, No Extra Frame) */}
          <div className="relative z-10 flex items-center justify-center al-loader-logo-float">
            <BrandLogo size="xl" />
          </div>
        </div>

        {/* Loading Caption with Animated Dots */}
        <div className="mt-7 sm:mt-8 flex flex-col items-center gap-2 text-center">
          <div
            className={`inline-flex items-baseline gap-0.5 text-base sm:text-lg font-bold tracking-tight ${
              isDark ? 'text-white' : 'text-[#0B1B32]'
            }`}
          >
            <span>{loadingLabel}</span>
            <span
              aria-hidden="true"
              className={`inline-flex items-baseline font-extrabold ${
                isDark ? 'text-[#08C99B]' : 'text-[#1764FF]'
              }`}
            >
              <span className="al-loader-dot">.</span>
              <span className="al-loader-dot">.</span>
              <span className="al-loader-dot">.</span>
            </span>
          </div>

          <div
            aria-hidden="true"
            className={`h-0.5 w-14 rounded-full bg-gradient-to-r from-transparent via-[#1764FF] to-transparent ${
              isDark ? 'opacity-75' : 'opacity-55'
            }`}
          />
        </div>
      </div>
    </div>
  );
};
