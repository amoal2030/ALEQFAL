/**
 * Routing helpers for Legal Pages (Privacy Policy & Terms of Service)
 * Compatible with Vite dev ('/') and GitHub Pages production base ('/ALEQFAL/')
 * as well as SPA 404.html fallback and hash fallback.
 */

export type AppPageRoute = 'home' | 'privacy' | 'terms';

export function getNormalizedBasePath(): string {
  const rawBase =
    typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL
      ? String((import.meta as any).env.BASE_URL)
      : '/';
  const withLeading = rawBase.startsWith('/') ? rawBase : `/${rawBase}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export function buildLegalPath(page: AppPageRoute): string {
  const base = getNormalizedBasePath();
  if (page === 'privacy') return `${base}privacy`;
  if (page === 'terms') return `${base}terms`;
  return base;
}

export function resolveAppPageFromLocation(
  loc: { pathname: string; hash: string; search: string } = window.location
): AppPageRoute {
  const normalizedHash = (loc.hash || '').trim().toLowerCase();
  if (
    normalizedHash === '#privacy' ||
    normalizedHash === '#/privacy' ||
    normalizedHash === '#privacy-policy' ||
    normalizedHash === '#/privacy-policy'
  ) {
    return 'privacy';
  }
  if (
    normalizedHash === '#terms' ||
    normalizedHash === '#/terms' ||
    normalizedHash === '#terms-of-service' ||
    normalizedHash === '#/terms-of-service'
  ) {
    return 'terms';
  }

  const params = new URLSearchParams(loc.search || '');
  const queryPage = (params.get('page') || '').trim().toLowerCase();
  if (queryPage === 'privacy' || queryPage === 'privacy-policy') return 'privacy';
  if (queryPage === 'terms' || queryPage === 'terms-of-service') return 'terms';

  const base = getNormalizedBasePath();
  let path = loc.pathname || '/';
  if (base !== '/' && path.toLowerCase().startsWith(base.toLowerCase())) {
    path = path.slice(base.length);
  } else {
    // Also handle /ALEQFAL without trailing slash or direct path matching
    path = path.replace(/^\/ALEQFAL(?=\/|$)/i, '');
  }

  const cleanedSegment = path.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (cleanedSegment === 'privacy' || cleanedSegment === 'privacy-policy') {
    return 'privacy';
  }
  if (cleanedSegment === 'terms' || cleanedSegment === 'terms-of-service') {
    return 'terms';
  }

  return 'home';
}
