import {
  AccessErrorReason,
  AuditLog,
  InviteBlockReason,
  ManagerInvite,
  MemberMembershipStatus,
  Organization,
  SubscriptionBlockReason,
  TenantAccessStatus,
  UserProfile,
} from '../types';
import {
  evaluateOrganizationSubscription,
  OrganizationSubscriptionEvaluation,
} from './subscription';

export function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

export function isValidNormalizedEmailDocId(emailLower: string): boolean {
  return (
    emailLower.length >= 3 &&
    emailLower.length <= 254 &&
    emailLower === emailLower.trim().toLowerCase() &&
    /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(emailLower)
  );
}

export function isGoogleProviderUser(
  fbUser: { providerData?: Array<{ providerId?: string | null } | null> } | null | undefined
): boolean {
  if (!fbUser || !Array.isArray(fbUser.providerData)) return false;
  return fbUser.providerData.some((provider) => provider?.providerId === 'google.com');
}

export function deriveSafeManagerName(params: {
  inviteManagerName?: string | null;
  orgOwnerName?: string | null;
  googleDisplayName?: string | null;
  emailLower?: string | null;
}): string {
  const emailLocal = params.emailLower?.includes('@')
    ? params.emailLower.split('@')[0]
    : '';
  const candidates = [
    params.inviteManagerName,
    params.orgOwnerName,
    params.googleDisplayName,
    emailLocal,
  ];

  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const cleaned = raw.trim().slice(0, 100).trim();
    if (cleaned.length >= 2) {
      return cleaned;
    }
  }
  return 'مدير المؤسسة';
}

export function evaluateFirestoreErrorCategory(
  error: any
): 'permission_denied' | 'network_error' {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (
    code === 'permission-denied' ||
    code.endsWith('/permission-denied') ||
    message.includes('insufficient permissions') ||
    message.includes('permission_denied') ||
    message.includes('permission-denied')
  ) {
    return 'permission_denied';
  }
  return 'network_error';
}

export function getSubscriptionBlockReason(
  evaluation: OrganizationSubscriptionEvaluation
): SubscriptionBlockReason {
  if (evaluation.state === 'suspended') {
    if (evaluation.deactivationReason === 'no_paid_branches') {
      return 'no_paid_branches';
    }
    return 'suspended';
  }
  if (evaluation.notStarted) {
    return 'not_started';
  }
  return 'expired';
}

/**
 * Resolves the effective membership status of a user profile with full backward
 * compatibility for legacy user documents that omit `membershipStatus`.
 */
export function resolveMemberMembershipStatus(
  profile: Pick<
    UserProfile,
    'membershipStatus' | 'isArchived' | 'isActive' | 'orgId' | 'releasedAt'
  > | null | undefined
): MemberMembershipStatus {
  if (!profile) return 'active';
  if (
    profile.membershipStatus === 'released' ||
    ((!profile.orgId || profile.orgId.trim() === '') &&
      profile.isActive === false &&
      Boolean(profile.releasedAt))
  ) {
    return 'released';
  }
  if (profile.membershipStatus === 'archived' || profile.isArchived === true) {
    return 'archived';
  }
  return 'active';
}

export type ProfiledUserAccessResolution =
  | {
      status: 'active_tenant';
      org: Organization;
      profile: UserProfile;
      subscriptionEvaluation: OrganizationSubscriptionEvaluation;
    }
  | {
      status: 'subscription_blocked';
      org: Organization;
      profile: UserProfile;
      subscriptionEvaluation: OrganizationSubscriptionEvaluation;
      blockReason: SubscriptionBlockReason;
    }
  | {
      status: 'access_error';
      errorReason: Extract<
        AccessErrorReason,
        'account_archived' | 'account_disabled' | 'membership_released' | 'permission_denied'
      >;
    };

export function resolveProfiledUserAccess(params: {
  profile: UserProfile;
  org: Organization | null;
  now?: Date;
}): ProfiledUserAccessResolution {
  const { profile, org, now = new Date() } = params;
  const membershipStatus = resolveMemberMembershipStatus(profile);

  // Permanently released members have no active organization binding and see a dedicated notice
  if (membershipStatus === 'released') {
    return {
      status: 'access_error',
      errorReason: 'membership_released',
    };
  }

  // Temporarily archived members stay blocked from organization data with a dedicated archived notice
  if (membershipStatus === 'archived') {
    return {
      status: 'access_error',
      errorReason: 'account_archived',
    };
  }

  // Disabled users (both manager and employee) are strictly blocked
  if (profile.isActive === false) {
    return {
      status: 'access_error',
      errorReason: 'account_disabled',
    };
  }

  if (!profile.orgId || !org || org.id !== profile.orgId) {
    return {
      status: 'access_error',
      errorReason: 'permission_denied',
    };
  }

  const subEval = evaluateOrganizationSubscription(org, now);
  if (!subEval.isAllowed) {
    return {
      status: 'subscription_blocked',
      org,
      profile,
      subscriptionEvaluation: subEval,
      blockReason: getSubscriptionBlockReason(subEval),
    };
  }

  return {
    status: 'active_tenant',
    org,
    profile,
    subscriptionEvaluation: subEval,
  };
}

export type UnprofiledUserAccessResolution =
  | {
      status: 'subscription_request_required';
    }
  | {
      status: 'invite_blocked';
      inviteBlockReason: InviteBlockReason;
      invite: ManagerInvite;
    }
  | {
      status: 'subscription_blocked';
      org: Organization;
      invite: ManagerInvite;
      subscriptionEvaluation: OrganizationSubscriptionEvaluation;
      blockReason: SubscriptionBlockReason;
    }
  | {
      status: 'ready_to_claim_invite';
      org: Organization;
      invite: ManagerInvite;
      subscriptionEvaluation: OrganizationSubscriptionEvaluation;
    }
  | {
      status: 'access_error';
      errorReason: Extract<AccessErrorReason, 'email_not_verified' | 'missing_employee_profile'>;
    };

export function resolveUnprofiledUserAccess(params: {
  uid: string;
  isGoogleUser: boolean;
  isVerifiedEmail: boolean;
  emailLower: string;
  invite: ManagerInvite | null;
  inviteOrg: Organization | null;
  now?: Date;
}): UnprofiledUserAccessResolution {
  const {
    uid,
    isGoogleUser,
    isVerifiedEmail,
    emailLower,
    invite,
    inviteOrg,
    now = new Date(),
  } = params;

  if (!isGoogleUser) {
    return {
      status: 'access_error',
      errorReason: 'missing_employee_profile',
    };
  }

  if (!isVerifiedEmail || !isValidNormalizedEmailDocId(emailLower)) {
    return {
      status: 'access_error',
      errorReason: 'email_not_verified',
    };
  }

  if (!invite) {
    return {
      status: 'subscription_request_required',
    };
  }

  if (invite.status === 'cancelled') {
    return {
      status: 'invite_blocked',
      inviteBlockReason: 'cancelled',
      invite,
    };
  }

  if (invite.status === 'accepted') {
    return {
      status: 'invite_blocked',
      inviteBlockReason: 'accepted',
      invite,
    };
  }

  if (
    invite.status !== 'pending' ||
    invite.role !== 'manager' ||
    normalizeEmail(invite.emailNormalized) !== emailLower
  ) {
    return {
      status: 'invite_blocked',
      inviteBlockReason: 'owner_mismatch',
      invite,
    };
  }

  if (!inviteOrg || inviteOrg.id !== invite.orgId) {
    return {
      status: 'invite_blocked',
      inviteBlockReason: 'org_not_found',
      invite,
    };
  }

  const orgOwnerEmail = normalizeEmail(inviteOrg.ownerEmail);
  if (
    orgOwnerEmail !== emailLower ||
    (inviteOrg.ownerId && inviteOrg.ownerId !== '' && inviteOrg.ownerId !== uid)
  ) {
    return {
      status: 'invite_blocked',
      inviteBlockReason: 'owner_mismatch',
      invite,
    };
  }

  const subEval = evaluateOrganizationSubscription(inviteOrg, now);
  if (!subEval.isAllowed) {
    return {
      status: 'subscription_blocked',
      org: inviteOrg,
      invite,
      subscriptionEvaluation: subEval,
      blockReason: getSubscriptionBlockReason(subEval),
    };
  }

  return {
    status: 'ready_to_claim_invite',
    org: inviteOrg,
    invite,
    subscriptionEvaluation: subEval,
  };
}

export interface AtomicInviteClaimPayloads<TServerTimestamp = unknown> {
  inviteDocId: string;
  inviteUpdate: {
    status: 'accepted';
    acceptedByUid: string;
    acceptedAt: TServerTimestamp;
    updatedAt: TServerTimestamp;
  };
  orgId: string;
  orgUpdate: {
    ownerId: string;
    ownerName: string;
    updatedAt: string;
  };
  userDocId: string;
  userDoc: UserProfile;
  auditLogId: string;
  auditLog: AuditLog;
}

export function buildAtomicInviteClaimPayloads<TServerTimestamp>(params: {
  uid: string;
  email: string;
  googleDisplayName?: string | null;
  org: Organization;
  invite: ManagerInvite;
  serverTimestampValue: TServerTimestamp;
  now?: Date;
}): AtomicInviteClaimPayloads<TServerTimestamp> {
  const {
    uid,
    email,
    googleDisplayName,
    org,
    invite,
    serverTimestampValue,
    now = new Date(),
  } = params;

  const emailLower = normalizeEmail(email);
  const safeName = deriveSafeManagerName({
    inviteManagerName: invite.managerName,
    orgOwnerName: org.ownerName,
    googleDisplayName,
    emailLower,
  });
  const nowIso = now.toISOString();
  const cleanOrgName = (org.name || invite.orgName || 'AL EQFAL').trim().slice(0, 120);
  const auditLogId = `log_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const userDoc: UserProfile = {
    uid,
    orgId: invite.orgId,
    email: email.trim(),
    displayName: safeName,
    role: 'manager',
    isActive: true,
    permissions: {
      canCreateClosing: true,
      canViewAllClosings: true,
      canApproveClosings: true,
      canManageBranches: true,
      canManageEmployees: true,
      canExportReports: true,
    },
    createdAt: nowIso,
  };

  const auditLog: AuditLog = {
    id: auditLogId,
    orgId: invite.orgId,
    actorId: uid,
    actorName: safeName,
    actorRole: 'manager',
    action: 'ORGANIZATION_ESTABLISHED',
    targetType: 'organization',
    targetId: invite.orgId,
    details: `تم قبول دعوة المدير وتفعيل حساب المؤسسة: ${cleanOrgName}`.slice(0, 1000),
    timestamp: nowIso,
  };

  return {
    inviteDocId: emailLower,
    inviteUpdate: {
      status: 'accepted',
      acceptedByUid: uid,
      acceptedAt: serverTimestampValue,
      updatedAt: serverTimestampValue,
    },
    orgId: invite.orgId,
    orgUpdate: {
      ownerId: uid,
      ownerName: safeName,
      updatedAt: nowIso,
    },
    userDocId: uid,
    userDoc,
    auditLogId,
    auditLog,
  };
}

export function canRenderTenantDashboard(params: {
  tenantStatus: TenantAccessStatus;
  hasAuthUser: boolean;
  userProfile: UserProfile | null;
  currentOrg: Organization | null;
  subscriptionEvaluation: OrganizationSubscriptionEvaluation | null;
}): boolean {
  const {
    tenantStatus,
    hasAuthUser,
    userProfile,
    currentOrg,
    subscriptionEvaluation,
  } = params;

  return Boolean(
    tenantStatus === 'active_tenant' &&
      hasAuthUser &&
      userProfile &&
      userProfile.isActive === true &&
      resolveMemberMembershipStatus(userProfile) === 'active' &&
      currentOrg &&
      userProfile.orgId === currentOrg.id &&
      subscriptionEvaluation?.isAllowed === true
  );
}
