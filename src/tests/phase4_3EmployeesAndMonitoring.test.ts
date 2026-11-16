import assert from 'node:assert/strict';
import {
  CORE_MONITORING_COLLECTIONS,
  fetchSuperAdminOverviewWithDiagnostics,
  isPermissionDeniedError,
  SuperAdminAuthUserLike,
  SuperAdminMonitoringError,
  TARGET_FIRESTORE_DATABASE_ID,
} from '../utils/superAdminMonitoring';
import {
  buildDefaultPermissionsForRole,
  resolveEffectivePermissions,
  validateRoleAssignmentInput,
} from '../utils/permissions';

let passed = 0;

function testSync(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

async function testAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

async function main() {
  console.log('========================================================================');
  console.log('   PHASE 4.3: SUPER ADMIN MONITORING & 4-ROLE EMPLOYEE UNIT TESTS       ');
  console.log('========================================================================\n');

  // 1. Verified amoal2030@gmail.com loads all 5 monitoring collections cleanly
  await testAsync('Verified Super Admin loads all 5 collections without diagnostic error', async () => {
    const user: SuperAdminAuthUserLike = {
      email: 'amoal2030@gmail.com',
      emailVerified: true,
      getIdTokenResult: async () => ({
        claims: { email: 'amoal2030@gmail.com', email_verified: true },
      }),
    };

    const overview = await fetchSuperAdminOverviewWithDiagnostics({
      user,
      fetchCollection: async (colName) => {
        if (colName === 'organizations') return [{ id: 'org_1', createdAt: '2026-11-10T00:00:00Z' } as any];
        if (colName === 'branches') return [{ id: 'br_1', orgId: 'org_1' } as any];
        if (colName === 'users') return [{ uid: 'u_1', orgId: 'org_1' } as any];
        if (colName === 'managerInvites') return [{ id: 'inv_1', updatedAt: '2026-11-11T00:00:00Z' } as any];
        return [{ id: 'pal_1', timestamp: '2026-11-12T00:00:00Z' } as any];
      },
    });

    assert.equal(overview.organizations.length, 1);
    assert.equal(overview.branches.length, 1);
    assert.equal(overview.users.length, 1);
    assert.equal(overview.managerInvites?.length, 1);
    assert.equal(overview.platformAuditLogs?.length, 1);
    assert.equal(overview.diagnosticMessage, undefined);
    assert.equal(overview.partialDeniedCollections, undefined);
  });

  // 2. Stale token claims trigger forced refresh (getIdTokenResult(true)) and recover cleanly
  await testAsync('Stale token claims trigger forced token refresh and succeed', async () => {
    let refreshCalls = 0;
    const user: SuperAdminAuthUserLike = {
      email: 'amoal2030@gmail.com',
      emailVerified: true,
      getIdTokenResult: async (forceRefresh = false) => {
        if (forceRefresh) {
          refreshCalls += 1;
          return { claims: { email: 'amoal2030@gmail.com', email_verified: true } };
        }
        return { claims: { email: 'amoal2030@gmail.com', email_verified: false } };
      },
    };

    const overview = await fetchSuperAdminOverviewWithDiagnostics({
      user,
      fetchCollection: async () => [],
    });

    assert.equal(refreshCalls, 1);
    assert.deepEqual(overview.organizations, []);
  });

  // 3. Initial permission-denied on core collection forces ID token refresh once and succeeds on retry
  await testAsync('Permission denied on core read triggers 1 forced token refresh retry', async () => {
    let orgAttempts = 0;
    let forcedRefreshCount = 0;
    const user: SuperAdminAuthUserLike = {
      email: 'amoal2030@gmail.com',
      emailVerified: true,
      getIdTokenResult: async (forceRefresh = false) => {
        if (forceRefresh) forcedRefreshCount += 1;
        return { claims: { email: 'amoal2030@gmail.com', email_verified: true } };
      },
    };

    const overview = await fetchSuperAdminOverviewWithDiagnostics({
      user,
      fetchCollection: async (colName) => {
        if (colName === 'organizations') {
          orgAttempts += 1;
          if (orgAttempts === 1) {
            const err: any = new Error('Missing or insufficient permissions.');
            err.code = 'permission-denied';
            throw err;
          }
          return [{ id: 'org_recovered', createdAt: '2026-11-12T00:00:00Z' } as any];
        }
        return [];
      },
    });

    assert.equal(forcedRefreshCount, 1);
    assert.equal(orgAttempts, 2);
    assert.equal(overview.organizations.length, 1);
    assert.equal(overview.organizations[0].id, 'org_recovered');
  });

  // 4. onlak2030@gmail.com & unverified amoal2030@gmail.com are strictly rejected before any query
  await testAsync('Blocks onlak2030@gmail.com and unverified amoal2030@gmail.com without querying Firestore', async () => {
    let queryCount = 0;
    const onlakUser: SuperAdminAuthUserLike = {
      email: 'onlak2030@gmail.com',
      emailVerified: true,
      getIdTokenResult: async () => ({
        claims: { email: 'onlak2030@gmail.com', email_verified: true },
      }),
    };
    const unverifiedSa: SuperAdminAuthUserLike = {
      email: 'amoal2030@gmail.com',
      emailVerified: false,
      getIdTokenResult: async () => ({
        claims: { email: 'amoal2030@gmail.com', email_verified: false },
      }),
    };

    await assert.rejects(
      () =>
        fetchSuperAdminOverviewWithDiagnostics({
          user: onlakUser,
          fetchCollection: async () => {
            queryCount += 1;
            return [];
          },
        }),
      (err: unknown) => err instanceof SuperAdminMonitoringError && err.code === 'unauthorized-super-admin'
    );

    await assert.rejects(
      () =>
        fetchSuperAdminOverviewWithDiagnostics({
          user: unverifiedSa,
          fetchCollection: async () => {
            queryCount += 1;
            return [];
          },
        }),
      (err: unknown) => err instanceof SuperAdminMonitoringError && err.code === 'unauthorized-super-admin'
    );

    assert.equal(queryCount, 0);
  });

  // 5. Partial permission denial on secondary collections surfaces explicit diagnostic without hiding or faking data
  await testAsync('Fault-isolated partial denial on managerInvites preserves real core data and reports exact denied collection', async () => {
    const user: SuperAdminAuthUserLike = {
      email: 'amoal2030@gmail.com',
      emailVerified: true,
      getIdTokenResult: async () => ({
        claims: { email: 'amoal2030@gmail.com', email_verified: true },
      }),
    };

    const overview = await fetchSuperAdminOverviewWithDiagnostics({
      user,
      fetchCollection: async (colName) => {
        if (colName === 'organizations') return [{ id: 'org_real', createdAt: '2026-11-10T00:00:00Z' } as any];
        if (colName === 'managerInvites') {
          const err: any = new Error('Missing or insufficient permissions.');
          err.code = 'permission-denied';
          throw err;
        }
        return [];
      },
    });

    assert.equal(overview.organizations.length, 1);
    assert.deepEqual(overview.partialDeniedCollections, ['managerInvites']);
    assert.ok(overview.diagnosticMessage?.includes('managerInvites'));
    assert.ok(overview.diagnosticMessage?.includes(TARGET_FIRESTORE_DATABASE_ID));
  });

  // 6. Core collection permission-denied throws explicit diagnostic error (never swallowed, no mock data)
  await testAsync('Persistent permission-denied on core collection throws SuperAdminMonitoringError with exact DB & collections', async () => {
    const user: SuperAdminAuthUserLike = {
      email: 'amoal2030@gmail.com',
      emailVerified: true,
      getIdTokenResult: async () => ({
        claims: { email: 'amoal2030@gmail.com', email_verified: true },
      }),
    };

    await assert.rejects(
      () =>
        fetchSuperAdminOverviewWithDiagnostics({
          user,
          fetchCollection: async (colName) => {
            if ((CORE_MONITORING_COLLECTIONS as readonly string[]).includes(colName)) {
              const err: any = new Error('Missing or insufficient permissions.');
              err.code = 'permission-denied';
              throw err;
            }
            return [];
          },
        }),
      (err: unknown) =>
        err instanceof SuperAdminMonitoringError &&
        err.code === 'permission-denied' &&
        err.deniedCollections.includes('organizations') &&
        err.message.includes(TARGET_FIRESTORE_DATABASE_ID)
    );
  });

  // 7. isPermissionDeniedError detects Firebase error codes and messages accurately
  testSync('isPermissionDeniedError recognizes permission-denied codes and insufficient permissions messages', () => {
    assert.equal(isPermissionDeniedError({ code: 'permission-denied' }), true);
    assert.equal(isPermissionDeniedError({ code: 'firestore/permission-denied' }), true);
    assert.equal(isPermissionDeniedError({ message: 'Missing or insufficient permissions' }), true);
    assert.equal(isPermissionDeniedError({ code: 'unavailable', message: 'offline' }), false);
  });

  // 8. 4-Role Permissions & Validation helpers
  testSync('4-role defaults, opt-in supervisor permissions, and branch assignment validation enforce boundaries', () => {
    const defaultSup = buildDefaultPermissionsForRole('supervisor');
    assert.equal(defaultSup.canCreateClosing, false);
    assert.equal(defaultSup.canApproveClosings, false);
    assert.equal(defaultSup.canManagePurchases, false);
    assert.equal(defaultSup.canManageSuppliers, false);
    assert.equal(defaultSup.canViewFinancialReports, false);
    assert.equal(defaultSup.canManageEmployees, false);
    assert.equal(defaultSup.canManageBranches, false);

    const optInSup = buildDefaultPermissionsForRole('supervisor', {
      canViewFinancialReports: true,
      canManageSuppliers: true,
    });
    assert.equal(optInSup.canViewFinancialReports, true);
    assert.equal(optInSup.canExportReports, true);
    assert.equal(optInSup.canManageSuppliers, true);
    assert.equal(optInSup.canViewSuppliers, true);
    assert.equal(optInSup.canManageEmployees, false);

    const effBm = resolveEffectivePermissions({
      role: 'branch_manager',
      isActive: true,
      branchId: 'br_1',
      branchIds: ['br_1'],
      permissions: buildDefaultPermissionsForRole('branch_manager'),
    });
    assert.equal(effBm.canCreateClosing, true);
    assert.equal(effBm.canManagePurchases, true);
    assert.equal(effBm.canViewSuppliers, true);
    assert.equal(effBm.canManageSuppliers, false);
    assert.equal(effBm.hasSingleBranchRestriction, true);

    assert.equal(
      validateRoleAssignmentInput({
        actorRole: 'manager',
        targetRole: 'branch_manager',
        branchId: 'br_1',
        branchIds: ['br_1', 'br_2'],
      }).valid,
      false
    );
    assert.equal(
      validateRoleAssignmentInput({
        actorRole: 'supervisor',
        targetRole: 'employee',
        branchId: 'br_1',
      }).valid,
      false
    );
    assert.equal(
      validateRoleAssignmentInput({
        actorRole: 'manager',
        targetRole: 'manager',
      }).valid,
      false
    );
  });

  console.log(`\nALL ${passed} UNIT TESTS PASSED`);
}

main().catch((err) => {
  console.error('Unit suite failed:', err);
  process.exit(1);
});
