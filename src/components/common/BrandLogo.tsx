import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import logoDark from '../../assets/brand/logo-dark.png';
import logoLight from '../../assets/brand/logo-light.png';

export type BrandLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface BrandLogoProps {
  /** Visual height preset; width scales strictly by original aspect ratio */
  size?: BrandLogoSize;
  /** Optional explicit override only when placed on a fixed-tone surface; defaults to active theme */
  variant?: 'auto' | 'light' | 'dark';
  className?: string;
}

const SIZE_CLASSES: Record<BrandLogoSize, string> = {
  xs: 'h-8',
  sm: 'h-9 sm:h-10',
  md: 'h-10 sm:h-11',
  lg: 'h-12 sm:h-14',
  xl: 'h-16 sm:h-20',
};

/**
 * Official AL EQFAL Brand Logo
 * Uses the exact untouched light/dark brand assets and preserves original aspect ratio
 * without cropping, stretching, backgrounds, or frames.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  variant = 'auto',
  className = '',
}) => {
  const { theme } = useTheme();
  const { t } = useLanguage();

  const resolvedMode = variant === 'auto' ? theme : variant;
  const src = resolvedMode === 'dark' ? logoDark : logoLight;
  const altText = `${t('brandName')} | ${t('brandSub')}`;

  return (
    <img
      src={src}
      alt={altText}
      decoding="async"
      className={`${SIZE_CLASSES[size]} w-auto max-w-none object-contain shrink-0 select-none ${className}`}
    />
  );
};
