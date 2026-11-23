import { SupportedLanguage, UserProfile } from '../types';
import { evaluateFirestoreErrorCategory } from './tenantAccess';

export const PASSWORD_RESET_COOLDOWN_MS = 45_000;

export type AuthErrorTranslationKey =
  | 'authErrUnauthorizedDomain'
  | 'authErrPopupBlocked'
  | 'authErrOperationNotAllowed'
  | 'authErrTooManyRequests'
  | 'authErrUserDisabled'
  | 'authErrInvalidCredentials'
  | 'authErrEmailInUse'
  | 'authErrInvalidEmail'
  | 'authErrWeakPassword'
  | 'authErrPopupClosed'
  | 'authErrNetwork'
  | 'authErrExpiredActionCode'
  | 'authErrInvalidActionCode'
  | 'authErrGeneric';

export interface AuthErrorClassification {
  translationKey: AuthErrorTranslationKey;
  showCredentialGuidance: boolean;
  isResetLinkExpiredOrUsed?: boolean;
  rawMessage?: string;
}

export interface AuthProfileEmailMismatchRecord {
  uid: string;
  authEmail: string;
  profileEmail: string;
  detectedAt: string;
}

export interface ProfileEmailDiagnosticIssue {
  uid: string;
  displayName: string;
  orgId: string;
  storedEmail: string;
  normalizedEmail: string;
  issueType: 'non_normalized_email' | 'duplicate_normalized_email';
}

export interface ProfileDocIdUidMismatchIssue {
  docId: string;
  storedUid: string;
  displayName: string;
  email: string;
  orgId: string;
}

export interface StrictAuthUidProfileBindingResult {
  valid: boolean;
  reason?: 'doc_id_mismatch' | 'stored_uid_mismatch';
}

export interface PasswordConfirmationResult {
  valid: boolean;
  reason?: 'too_short' | 'mismatch';
}

/**
 * Normalizes an email address for authentication and Firestore storage.
 * Trims surrounding whitespace and converts to lowercase.
 */
export function normalizeLoginEmail(email: string | null | undefined): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Prepares login credentials for Firebase Authentication.
 * - Normalizes email via trim() + toLowerCase().
 * - Preserves the password verbatim (never trims or alters characters).
 */
export function prepareLoginCredentials(
  email: string,
  password: string
): { email: string; password: string } {
  return {
    email: normalizeLoginEmail(email),
    password: typeof password === 'string' ? password : '',
  };
}

/**
 * Validates password length and confirmation match without modifying or trimming either value.
 */
export function validatePasswordConfirmation(
  password: string,
  confirmPassword: string,
  minLength = 6
): PasswordConfirmationResult {
  if (typeof password !== 'string' || password.length < minLength) {
    return { valid: false, reason: 'too_short' };
  }
  if (password !== confirmPassword) {
    return { valid: false, reason: 'mismatch' };
  }
  return { valid: true };
}

/**
 * Prevents updating an employee's Firestore `email` independently of Firebase Authentication.
 * Throws if an update attempt supplies a different email address than the existing profile email.
 */
export function assertProfileEmailImmutableOnEmployeeUpdate(
  existingEmail: string | null | undefined,
  attemptedEmail?: string | null
): void {
  if (attemptedEmail === undefined || attemptedEmail === null) {
    return;
  }
  const currentNorm = normalizeLoginEmail(existingEmail);
  const attemptedNorm = normalizeLoginEmail(attemptedEmail);
  if (attemptedNorm !== currentNorm) {
    throw new Error(
      'لا يمكن تعديل بريد تسجيل دخول الموظف في قاعدة البيانات بشكل منفصل عن Firebase Authentication؛ يتطلب تغيير البريد إجراءً مخصصاً يحدّث مصدر المصادقة وFirestore معاً.'
    );
  }
}

/**
 * Verifies strict binding between Firebase Auth UID and the fetched `users/{docId}` document.
 * Never links or authorizes a user profile by email alone.
 */
export function validateStrictAuthUidProfileBinding(params: {
  authUid: string;
  docId: string;
  storedProfileUid?: string | null;
}): StrictAuthUidProfileBindingResult {
  const cleanAuthUid = (params.authUid || '').trim();
  const cleanDocId = (params.docId || '').trim();
  const cleanStoredUid =
    typeof params.storedProfileUid === 'string' ? params.storedProfileUid.trim() : '';

  if (!cleanAuthUid || cleanDocId !== cleanAuthUid) {
    return { valid: false, reason: 'doc_id_mismatch' };
  }
  if (cleanStoredUid && cleanStoredUid !== cleanAuthUid) {
    return { valid: false, reason: 'stored_uid_mismatch' };
  }
  return { valid: true };
}

/**
 * Determines whether a Firestore server read failure is a transient offline/unavailable network
 * error where reading a populated local cache snapshot may be attempted.
 *
 * Security rule: permission-denied and unauthenticated errors are NEVER eligible for fallback.
 */
export function isRetryableServerCacheFallbackError(error: any): boolean {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (
    code === 'permission-denied' ||
    code.endsWith('/permission-denied') ||
    code === 'unauthenticated' ||
    code.endsWith('/unauthenticated') ||
    message.includes('insufficient permissions') ||
    message.includes('permission_denied') ||
    message.includes('permission-denied')
  ) {
    return false;
  }

  return (
    code === 'unavailable' ||
    code.endsWith('/unavailable') ||
    code === 'deadline-exceeded' ||
    code.endsWith('/deadline-exceeded') ||
    message.includes('client is offline') ||
    message.includes('failed to get document because the client is offline') ||
    message.includes('network')
  );
}

/**
 * Fetches a Firestore document from the server first to avoid stale cache misses
 * (e.g., right after password reset or account switching).
 *
 * - On `permission-denied` / `unauthenticated`: immediately rethrows (never masks as missing doc).
 * - On offline/unavailable server error: checks local cache only if an existing snapshot is cached;
 *   if cache also misses, rethrows the original network error so the UI reports `network_error`
 *   instead of falsely reporting `missing_employee_profile`.
 */
export async function fetchFirestoreDocWithFreshServerCheck<
  TSnap extends { exists: () => boolean },
>(
  readFromServer: () => Promise<TSnap>,
  readFallback: () => Promise<TSnap>
): Promise<TSnap> {
  try {
    return await readFromServer();
  } catch (serverErr: any) {
    if (!isRetryableServerCacheFallbackError(serverErr)) {
      throw serverErr;
    }
    try {
      const cachedSnap = await readFallback();
      if (cachedSnap.exists()) {
        return cachedSnap;
      }
    } catch {
      // Fall through and surface the original network/unavailable error
    }
    throw serverErr;
  }
}

/**
 * Detects a mismatch between the signed-in Firebase Authentication email and the Firestore
 * `users/{uid}.email` profile field.
 *
 * Strictly read-only diagnostic: NEVER auto-syncs or mutates Firestore.
 */
export function detectAuthProfileEmailMismatch(params: {
  uid: string;
  authEmail?: string | null;
  profileEmail?: string | null;
  now?: Date;
}): AuthProfileEmailMismatchRecord | null {
  const authNorm = normalizeLoginEmail(params.authEmail);
  const profileNorm = normalizeLoginEmail(params.profileEmail);
  if (!authNorm || !profileNorm || authNorm === profileNorm) {
    return null;
  }
  return {
    uid: params.uid,
    authEmail: authNorm,
    profileEmail: profileNorm,
    detectedAt: (params.now || new Date()).toISOString(),
  };
}

/**
 * Read-only diagnostic scan over loaded user profiles for Super Admin review.
 * Detects non-normalized stored emails (spaces/uppercase) or duplicate normalized emails across UIDs
 * without ever auto-modifying Firestore records.
 */
export function detectProfileEmailDiagnostics(
  users: Pick<UserProfile, 'uid' | 'displayName' | 'orgId' | 'email'>[]
): ProfileEmailDiagnosticIssue[] {
  const issues: ProfileEmailDiagnosticIssue[] = [];
  const byNormalized = new Map<string, Pick<UserProfile, 'uid' | 'displayName' | 'orgId' | 'email'>[]>();

  for (const user of users) {
    const raw = typeof user.email === 'string' ? user.email : '';
    const norm = normalizeLoginEmail(raw);
    if (!norm) continue;

    if (raw !== norm) {
      issues.push({
        uid: user.uid,
        displayName: user.displayName || user.uid,
        orgId: user.orgId || '',
        storedEmail: raw,
        normalizedEmail: norm,
        issueType: 'non_normalized_email',
      });
    }

    const list = byNormalized.get(norm) || [];
    list.push(user);
    byNormalized.set(norm, list);
  }

  for (const [norm, matchedUsers] of byNormalized.entries()) {
    if (matchedUsers.length > 1) {
      for (const user of matchedUsers) {
        issues.push({
          uid: user.uid,
          displayName: user.displayName || user.uid,
          orgId: user.orgId || '',
          storedEmail: user.email || '',
          normalizedEmail: norm,
          issueType: 'duplicate_normalized_email',
        });
      }
    }
  }

  return issues;
}

/**
 * Read-only diagnostic scan detecting Firestore `users/{docId}` documents whose document ID
 * does not match the stored `uid` field (which causes Auth UID lookups to miss the profile).
 * Never mutates Firestore or Firebase Authentication.
 */
export function detectProfileDocIdUidMismatches(
  users: Pick<UserProfile, 'uid' | 'firestoreDocId' | 'displayName' | 'orgId' | 'email'>[]
): ProfileDocIdUidMismatchIssue[] {
  const diagnostics = detectProfileUidBindingDiagnostics(
    users.map((user) => ({
      docId: typeof user.firestoreDocId === 'string' ? user.firestoreDocId : '',
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      orgId: user.orgId,
    }))
  );
  return diagnostics.map((item) => ({
    docId: item.docId,
    storedUid: item.storedUid || '(missing)',
    displayName: item.displayName,
    email: item.email,
    orgId: item.orgId,
  }));
}

export interface ProfileUidBindingDiagnosticIssue {
  docId: string;
  storedUid: string;
  displayName: string;
  email: string;
  orgId: string;
  issueType: 'doc_id_uid_mismatch' | 'missing_uid_field';
}

export type LoadedUserProfileBindingResult =
  | { status: 'valid'; profile: UserProfile }
  | { status: 'missing_profile'; reason: 'missing_employee_profile' }
  | { status: 'uid_mismatch'; reason: 'profile_uid_mismatch' }
  | { status: 'read_error'; reason: 'permission_denied' | 'network_error' };

/**
 * Synchronizes Firebase Auth's `languageCode` with the active UI language (`ar` | `en` | `ur`).
 */
export function syncAuthLanguageCode(
  authInstance: { languageCode?: string | null } | null | undefined,
  language: SupportedLanguage | string | null | undefined
): SupportedLanguage {
  const normalized: SupportedLanguage =
    language === 'en' || language === 'ur' || language === 'ar' ? language : 'ar';
  if (authInstance) {
    try {
      authInstance.languageCode = normalized;
    } catch {
      // Ignore read-only auth wrappers
    }
  }
  return normalized;
}

/**
 * Evaluates duplicate password-reset cooldown so users do not accidentally invalidate
 * just-sent reset links by clicking multiple times rapidly.
 */
export function evaluatePasswordResetCooldown(
  lastSentAtMs: number | null | undefined,
  nowMs: number = Date.now()
): { canSend: boolean; remainingSeconds: number } {
  if (typeof lastSentAtMs !== 'number' || !Number.isFinite(lastSentAtMs)) {
    return { canSend: true, remainingSeconds: 0 };
  }
  const elapsed = nowMs - lastSentAtMs;
  if (elapsed >= PASSWORD_RESET_COOLDOWN_MS) {
    return { canSend: true, remainingSeconds: 0 };
  }
  const remainingMs = Math.max(0, PASSWORD_RESET_COOLDOWN_MS - elapsed);
  return {
    canSend: false,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}

/**
 * Strictly validates a loaded `users/{authUid}` lookup result.
 * Separates Firestore read errors (`permission_denied` / `network_error`) from genuinely missing
 * profiles (`missing_employee_profile`) and UID mismatches (`profile_uid_mismatch`).
 */
export function validateLoadedUserProfileBinding(params: {
  authUid: string;
  docId: string;
  docExists: boolean;
  rawProfile: UserProfile | null | undefined;
  readError?: unknown;
}): LoadedUserProfileBindingResult {
  if (params.readError) {
    return {
      status: 'read_error',
      reason: evaluateFirestoreErrorCategory(params.readError),
    };
  }
  if (!params.docExists || !params.rawProfile) {
    return {
      status: 'missing_profile',
      reason: 'missing_employee_profile',
    };
  }
  const check = validateStrictAuthUidProfileBinding({
    authUid: params.authUid,
    docId: params.docId,
    storedProfileUid: params.rawProfile.uid,
  });
  if (!check.valid) {
    return {
      status: 'uid_mismatch',
      reason: 'profile_uid_mismatch',
    };
  }
  return {
    status: 'valid',
    profile: {
      ...params.rawProfile,
      uid: params.authUid,
      firestoreDocId: params.docId,
    },
  };
}

/**
 * Read-only diagnostic scan over raw `users` documents detecting missing `uid` fields
 * or mismatches between Firestore `docId` and stored `uid`.
 */
export function detectProfileUidBindingDiagnostics(
  rawDocs: Array<{
    docId: string;
    uid?: string | null;
    displayName?: string | null;
    email?: string | null;
    orgId?: string | null;
  }>
): ProfileUidBindingDiagnosticIssue[] {
  const issues: ProfileUidBindingDiagnosticIssue[] = [];
  for (const item of rawDocs) {
    const docId = (item.docId || '').trim();
    const storedUid = typeof item.uid === 'string' ? item.uid.trim() : '';
    if (!docId) continue;
    if (!storedUid) {
      issues.push({
        docId,
        storedUid: '',
        displayName: item.displayName || docId,
        email: item.email || '',
        orgId: item.orgId || '',
        issueType: 'missing_uid_field',
      });
    } else if (storedUid !== docId) {
      issues.push({
        docId,
        storedUid,
        displayName: item.displayName || docId,
        email: item.email || '',
        orgId: item.orgId || '',
        issueType: 'doc_id_uid_mismatch',
      });
    }
  }
  return issues;
}

/**
 * Classifies Firebase Auth errors into safe, non-enumerating translation keys.
 * Never reveals whether an account exists and never assumes Gmail accounts use Google sign-in.
 */
export function classifyAuthSignInError(err: any): AuthErrorClassification {
  const code = typeof err?.code === 'string' ? err.code : '';
  switch (code) {
    case 'auth/unauthorized-domain':
      return { translationKey: 'authErrUnauthorizedDomain', showCredentialGuidance: false };
    case 'auth/popup-blocked':
      return { translationKey: 'authErrPopupBlocked', showCredentialGuidance: false };
    case 'auth/operation-not-allowed':
      return { translationKey: 'authErrOperationNotAllowed', showCredentialGuidance: false };
    case 'auth/too-many-requests':
      return { translationKey: 'authErrTooManyRequests', showCredentialGuidance: false };
    case 'auth/user-disabled':
      return { translationKey: 'authErrUserDisabled', showCredentialGuidance: false };
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return { translationKey: 'authErrInvalidCredentials', showCredentialGuidance: true };
    case 'auth/email-already-in-use':
      return { translationKey: 'authErrEmailInUse', showCredentialGuidance: false };
    case 'auth/invalid-email':
      return { translationKey: 'authErrInvalidEmail', showCredentialGuidance: false };
    case 'auth/weak-password':
      return { translationKey: 'authErrWeakPassword', showCredentialGuidance: false };
    case 'auth/popup-closed-by-user':
      return { translationKey: 'authErrPopupClosed', showCredentialGuidance: false };
    case 'auth/network-request-failed':
      return { translationKey: 'authErrNetwork', showCredentialGuidance: false };
    case 'auth/expired-action-code':
      return {
        translationKey: 'authErrExpiredActionCode',
        showCredentialGuidance: false,
        isResetLinkExpiredOrUsed: true,
      };
    case 'auth/invalid-action-code':
      return {
        translationKey: 'authErrInvalidActionCode',
        showCredentialGuidance: false,
        isResetLinkExpiredOrUsed: true,
      };
    default:
      return {
        translationKey: 'authErrGeneric',
        showCredentialGuidance: false,
        rawMessage: typeof err?.message === 'string' ? err.message : undefined,
      };
  }
}
