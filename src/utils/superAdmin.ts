export const SUPER_ADMIN_EMAIL = 'amoal2030@gmail.com';

export interface SuperAdminAuthIdentity {
  email?: string | null;
  emailVerified?: boolean | null;
}

/**
 * Verifies whether the authenticated Firebase user matches the sole authorized
 * Super Admin (`amoal2030@gmail.com`) with a verified email claim.
 * Explicitly returns false for unverified emails and any other address (e.g. `onlak2030@gmail.com`).
 */
export function isVerifiedSuperAdmin(user: SuperAdminAuthIdentity | null | undefined): boolean {
  if (!user || user.emailVerified !== true || typeof user.email !== 'string') {
    return false;
  }
  return user.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}
