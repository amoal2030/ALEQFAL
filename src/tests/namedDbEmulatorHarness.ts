/**
 * Named-Database Firestore Emulator Test Harness — AL EQFAL
 * ---------------------------------------------------------
 * Why this harness exists (verified against installed SDKs):
 * - `@firebase/rules-unit-testing@6.0.0` hardcodes `(default)` in both:
 *     - `RulesTestEnvironmentImpl.clearFirestore()` -> `/databases/(default)/documents`
 *     - `RulesTestContextImpl.firestore()` -> `firebase.compat.app.firestore()` (no `databaseId` parameter)
 * - In contrast, the official Modular Firebase JS SDK (`firebase@13.2.0` -> `firebase/firestore`)
 *   natively supports named databases on the Firestore Emulator via:
 *     - `getFirestore(app, databaseId)`
 *     - `connectFirestoreEmulator(db, host, port, { mockUserToken })`
 *   paired with the Firestore Emulator v1.22.0 REST API endpoints:
 *     - `PUT /emulator/v1/projects/{projectId}/databases/{databaseId}:securityRules`
 *     - `DELETE /emulator/v1/projects/{projectId}/databases/{databaseId}/documents`
 *
 * Security & Isolation Guarantees:
 * - Strictly targets ONLY the canonical named database:
 *     Project ID:     scenic-proton-s3kqt
 *     Project Number: 969662272507
 *     Database ID:    ai-studio-aleqfal-cf1d4528-a7af-44d6-b623-8a556a614788
 *     Region:         europe-west2
 * - Explicitly forbids `(default)` and verifies at runtime that writes to the named database
 *   NEVER appear in `(default)` and that `firestore.rules` is enforced on the named database.
 * - Strictly enforces loopback emulator hosts (`127.0.0.1` / `localhost` / `::1`) so test suites
 *   can NEVER accidentally touch production Firebase.
 */
import * as fs from 'node:fs';
import { deleteApp, FirebaseApp, initializeApp } from 'firebase/app';
import {
  collection as modularCollection,
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
  doc as modularDoc,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  getDoc,
  getDocs,
  getFirestore,
  limit as modularLimit,
  orderBy as modularOrderBy,
  OrderByDirection,
  query as modularQuery,
  QueryConstraint,
  QuerySnapshot,
  serverTimestamp,
  setDoc,
  SetOptions,
  terminate,
  Timestamp,
  updateDoc,
  where as modularWhere,
  WhereFilterOp,
  writeBatch,
  WriteBatch,
} from 'firebase/firestore';
import { assertFails, assertSucceeds, TokenOptions } from '@firebase/rules-unit-testing';

export { assertFails, assertSucceeds, Timestamp };

export const FieldValue = {
  delete: deleteField,
  serverTimestamp,
};

export const NAMED_DB_TEST_CONFIG = {
  projectId: 'scenic-proton-s3kqt',
  projectNumber: '969662272507',
  databaseId: 'ai-studio-aleqfal-cf1d4528-a7af-44d6-b623-8a556a614788',
  region: 'europe-west2',
} as const;

export interface NamedDbDocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  readonly ref: NamedDbDocumentRef;
  data(): DocumentData | undefined;
}

export interface NamedDbQuerySnapshot {
  readonly docs: NamedDbDocumentSnapshot[];
  readonly size: number;
  readonly empty: boolean;
  forEach(callback: (doc: NamedDbDocumentSnapshot) => void): void;
}

export interface NamedDbDocumentRef {
  readonly id: string;
  readonly path: string;
  readonly _modularRef: DocumentReference<DocumentData>;
  get(): Promise<NamedDbDocumentSnapshot>;
  set(data: DocumentData, options?: SetOptions): Promise<void>;
  update(data: DocumentData): Promise<void>;
  delete(): Promise<void>;
}

export interface NamedDbQuery {
  where(fieldPath: string, opStr: WhereFilterOp, value: unknown): NamedDbQuery;
  orderBy(fieldPath: string, directionStr?: OrderByDirection): NamedDbQuery;
  limit(limitCount: number): NamedDbQuery;
  get(): Promise<NamedDbQuerySnapshot>;
}

export interface NamedDbCollectionRef extends NamedDbQuery {
  readonly path: string;
  doc(docId: string): NamedDbDocumentRef;
}

export interface NamedDbWriteBatch {
  set(ref: NamedDbDocumentRef, data: DocumentData, options?: SetOptions): NamedDbWriteBatch;
  update(ref: NamedDbDocumentRef, data: DocumentData): NamedDbWriteBatch;
  delete(ref: NamedDbDocumentRef): NamedDbWriteBatch;
  commit(): Promise<void>;
}

export interface NamedDbFirestoreClient {
  readonly databaseId: string;
  readonly projectId: string;
  readonly _modularDb: Firestore;
  doc(path: string): NamedDbDocumentRef;
  collection(path: string): NamedDbCollectionRef;
  batch(): NamedDbWriteBatch;
}

export interface NamedDbRulesTestContext {
  firestore(): NamedDbFirestoreClient;
  cleanup(): Promise<void>;
}

export interface NamedDbRulesTestEnvironment {
  readonly projectId: string;
  readonly projectNumber: string;
  readonly databaseId: string;
  readonly region: string;
  readonly host: string;
  readonly port: number;
  authenticatedContext(uid: string, tokenOptions?: TokenOptions): NamedDbRulesTestContext;
  unauthenticatedContext(): NamedDbRulesTestContext;
  withSecurityRulesDisabled(
    callback: (context: NamedDbRulesTestContext) => Promise<void>
  ): Promise<void>;
  clearFirestore(): Promise<void>;
  cleanup(): Promise<void>;
}

function assertLoopbackHost(host: string): void {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized !== '127.0.0.1' && normalized !== 'localhost' && normalized !== '::1') {
    throw new Error(
      `REFUSED NON-EMULATOR HOST (${host}): Firestore rules tests MUST run strictly against a local loopback emulator.`
    );
  }
}

export function parseEmulatorHostAndPort(defaultPort = 8088): { host: string; port: number } {
  const envHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (envHost && envHost.trim()) {
    const parsed = new URL(`http://${envHost.trim()}`);
    const host = parsed.hostname;
    const port = Number(parsed.port || defaultPort);
    if (!host || !Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid FIRESTORE_EMULATOR_HOST value: ${envHost}`);
    }
    assertLoopbackHost(host);
    return { host, port };
  }
  return { host: '127.0.0.1', port: defaultPort };
}

function assertCanonicalNamedDatabaseConfig(): void {
  const projectId: string = NAMED_DB_TEST_CONFIG.projectId;
  const databaseId: string = NAMED_DB_TEST_CONFIG.databaseId;
  if (!databaseId || databaseId === '(default)') {
    throw new Error('Test harness refuses to target (default) database.');
  }

  if (fs.existsSync('firebase-applet-config.json')) {
    const cfg = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
    if (cfg.projectId !== projectId) {
      throw new Error(
        `Project ID mismatch: expected ${projectId}, got ${cfg.projectId} in firebase-applet-config.json.`
      );
    }
    if (cfg.firestoreDatabaseId !== databaseId) {
      throw new Error(
        `Named Database ID mismatch: expected ${databaseId}, got ${cfg.firestoreDatabaseId} in firebase-applet-config.json.`
      );
    }
  }

  if (fs.existsSync('firebase.json')) {
    const fbJson = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
    const fbDb = fbJson?.firestore?.database;
    if (fbDb && fbDb !== databaseId) {
      throw new Error(
        `Named Database ID mismatch: expected ${databaseId}, got ${fbDb} in firebase.json.`
      );
    }
  }
}

function wrapDocRef(modularRef: DocumentReference<DocumentData>): NamedDbDocumentRef {
  const wrapped: NamedDbDocumentRef = {
    id: modularRef.id,
    path: modularRef.path,
    _modularRef: modularRef,
    async get(): Promise<NamedDbDocumentSnapshot> {
      const snap = await getDoc(modularRef);
      return wrapDocSnapshot(snap);
    },
    async set(data: DocumentData, options?: SetOptions): Promise<void> {
      if (options) {
        await setDoc(modularRef, data, options);
      } else {
        await setDoc(modularRef, data);
      }
    },
    async update(data: DocumentData): Promise<void> {
      await updateDoc(modularRef, data);
    },
    async delete(): Promise<void> {
      await deleteDoc(modularRef);
    },
  };
  return wrapped;
}

function wrapDocSnapshot(snap: DocumentSnapshot<DocumentData>): NamedDbDocumentSnapshot {
  const ref = wrapDocRef(snap.ref);
  return {
    id: snap.id,
    exists: snap.exists(),
    ref,
    data: () => snap.data(),
  };
}

function wrapQuerySnapshot(snap: QuerySnapshot<DocumentData>): NamedDbQuerySnapshot {
  const docs = snap.docs.map((d) => wrapDocSnapshot(d));
  return {
    docs,
    size: snap.size,
    empty: snap.empty,
    forEach(cb: (doc: NamedDbDocumentSnapshot) => void) {
      docs.forEach(cb);
    },
  };
}

function createQueryWrapper(
  db: Firestore,
  collectionPath: string,
  constraints: QueryConstraint[]
): NamedDbQuery {
  return {
    where(fieldPath: string, opStr: WhereFilterOp, value: unknown): NamedDbQuery {
      return createQueryWrapper(db, collectionPath, [
        ...constraints,
        modularWhere(fieldPath, opStr, value),
      ]);
    },
    orderBy(fieldPath: string, directionStr?: OrderByDirection): NamedDbQuery {
      return createQueryWrapper(db, collectionPath, [
        ...constraints,
        modularOrderBy(fieldPath, directionStr),
      ]);
    },
    limit(limitCount: number): NamedDbQuery {
      return createQueryWrapper(db, collectionPath, [...constraints, modularLimit(limitCount)]);
    },
    async get(): Promise<NamedDbQuerySnapshot> {
      const colRef = modularCollection(db, collectionPath);
      const q = constraints.length > 0 ? modularQuery(colRef, ...constraints) : colRef;
      const snap = await getDocs(q);
      return wrapQuerySnapshot(snap);
    },
  };
}

function wrapFirestore(
  modularDb: Firestore,
  projectId: string,
  databaseId: string
): NamedDbFirestoreClient {
  return {
    projectId,
    databaseId,
    _modularDb: modularDb,
    doc(path: string): NamedDbDocumentRef {
      return wrapDocRef(modularDoc(modularDb, path));
    },
    collection(path: string): NamedDbCollectionRef {
      const baseQuery = createQueryWrapper(modularDb, path, []);
      return {
        path,
        ...baseQuery,
        doc(docId: string): NamedDbDocumentRef {
          return wrapDocRef(modularDoc(modularDb, `${path}/${docId}`));
        },
      };
    },
    batch(): NamedDbWriteBatch {
      const b: WriteBatch = writeBatch(modularDb);
      const wrapper: NamedDbWriteBatch = {
        set(ref: NamedDbDocumentRef, data: DocumentData, options?: SetOptions) {
          if (options) {
            b.set(ref._modularRef, data, options);
          } else {
            b.set(ref._modularRef, data);
          }
          return wrapper;
        },
        update(ref: NamedDbDocumentRef, data: DocumentData) {
          b.update(ref._modularRef, data);
          return wrapper;
        },
        delete(ref: NamedDbDocumentRef) {
          b.delete(ref._modularRef);
          return wrapper;
        },
        commit: () => b.commit(),
      };
      return wrapper;
    },
  };
}

let appCounter = 0;

class NamedDbContextImpl implements NamedDbRulesTestContext {
  private app?: FirebaseApp;
  private modularDb?: Firestore;
  private client?: NamedDbFirestoreClient;
  private destroyed = false;

  constructor(
    private readonly projectId: string,
    private readonly databaseId: string,
    private readonly host: string,
    private readonly port: number,
    private readonly mockUserToken?: Record<string, unknown> | string
  ) {}

  firestore(): NamedDbFirestoreClient {
    if (this.destroyed) {
      throw new Error('NamedDbRulesTestContext has already been cleaned up.');
    }
    if (!this.client) {
      appCounter += 1;
      this.app = initializeApp(
        { projectId: this.projectId },
        `aleqfal_named_db_${Date.now()}_${appCounter}_${Math.random().toString(36).slice(2, 8)}`
      );
      // Explicitly bind Modular Firestore SDK to the canonical NAMED database ID (never `(default)`)
      this.modularDb = getFirestore(this.app, this.databaseId);
      connectFirestoreEmulator(
        this.modularDb,
        this.host,
        this.port,
        this.mockUserToken !== undefined ? { mockUserToken: this.mockUserToken as any } : undefined
      );
      this.client = wrapFirestore(this.modularDb, this.projectId, this.databaseId);
    }
    return this.client;
  }

  async cleanup(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    const db = this.modularDb;
    const app = this.app;
    this.client = undefined;
    this.modularDb = undefined;
    this.app = undefined;
    if (db) {
      await terminate(db).catch(() => undefined);
    }
    if (app) {
      await deleteApp(app).catch(() => undefined);
    }
  }
}

async function loadRulesForNamedDatabase(params: {
  host: string;
  port: number;
  projectId: string;
  databaseId: string;
  rules: string;
}): Promise<void> {
  const url = `http://${params.host}:${params.port}/emulator/v1/projects/${params.projectId}/databases/${params.databaseId}:securityRules`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rules: {
        files: [{ name: 'firestore.rules', content: params.rules }],
      },
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `Failed to load firestore.rules onto named database '${params.databaseId}' (HTTP ${resp.status}): ${text}`
    );
  }
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text);
      const errors = (parsed.issues || []).filter((i: any) => i.severity === 'ERROR');
      if (errors.length > 0) {
        throw new Error(
          `firestore.rules compilation errors on named database '${params.databaseId}': ${JSON.stringify(errors)}`
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('compilation errors')) {
        throw err;
      }
    }
  }
}

async function clearNamedDatabaseDocuments(params: {
  host: string;
  port: number;
  projectId: string;
  databaseId: string;
}): Promise<void> {
  const url = `http://${params.host}:${params.port}/emulator/v1/projects/${params.projectId}/databases/${params.databaseId}/documents`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Failed to clear named database '${params.databaseId}' (HTTP ${resp.status}): ${text}`
    );
  }
}

/**
 * Empirically verifies on the running Firestore Emulator that:
 * 1. Writes to `ai-studio-aleqfal-cf1d4528-a7af-44d6-b623-8a556a614788` are strictly isolated
 *    from `(default)` (the probe doc exists in the named DB and does NOT exist in `(default)`).
 * 2. `firestore.rules` is actively evaluated on `ai-studio-aleqfal-cf1d4528-a7af-44d6-b623-8a556a614788`
 *    (unauthenticated read is strictly rejected with `permission-denied`).
 * Cleans up the probe document before returning.
 */
async function verifyNamedDatabaseIsolation(params: {
  host: string;
  port: number;
  projectId: string;
  databaseId: string;
}): Promise<void> {
  const probeId = `_named_db_isolation_probe_${Date.now()}`;
  const namedAdmin = new NamedDbContextImpl(
    params.projectId,
    params.databaseId,
    params.host,
    params.port,
    'owner'
  );
  const namedUnauth = new NamedDbContextImpl(
    params.projectId,
    params.databaseId,
    params.host,
    params.port,
    undefined
  );

  // Separate temporary probe against `(default)` ONLY to assert the probe doc is NOT in `(default)`
  appCounter += 1;
  const defaultProbeApp = initializeApp(
    { projectId: params.projectId },
    `aleqfal_default_isolation_check_${Date.now()}_${appCounter}`
  );
  const defaultProbeDb = getFirestore(defaultProbeApp);
  connectFirestoreEmulator(defaultProbeDb, params.host, params.port, { mockUserToken: 'owner' });

  try {
    await namedAdmin.firestore().doc(`organizations/${probeId}`).set({
      id: probeId,
      name: 'Isolation Probe',
    });

    const namedSnap = await namedAdmin.firestore().doc(`organizations/${probeId}`).get();
    if (!namedSnap.exists) {
      throw new Error(`Probe document was not found in named database '${params.databaseId}'.`);
    }

    const defaultSnap = await getDoc(modularDoc(defaultProbeDb, `organizations/${probeId}`));
    if (defaultSnap.exists()) {
      throw new Error(
        `CRITICAL ISOLATION FAILURE: Probe written to '${params.databaseId}' leaked into '(default)' database!`
      );
    }

    await assertFails(namedUnauth.firestore().doc(`organizations/${probeId}`).get());
  } finally {
    await namedAdmin.cleanup();
    await namedUnauth.cleanup();
    await terminate(defaultProbeDb).catch(() => undefined);
    await deleteApp(defaultProbeApp).catch(() => undefined);
    await clearNamedDatabaseDocuments(params);
  }
}

export async function initializeNamedDbTestEnvironment(options?: {
  rulesPath?: string;
  rulesContent?: string;
  host?: string;
  port?: number;
}): Promise<NamedDbRulesTestEnvironment> {
  assertCanonicalNamedDatabaseConfig();

  const resolvedHostPort =
    options?.host && options?.port
      ? { host: options.host, port: options.port }
      : parseEmulatorHostAndPort();

  assertLoopbackHost(resolvedHostPort.host);

  const rules =
    options?.rulesContent ?? fs.readFileSync(options?.rulesPath ?? 'firestore.rules', 'utf8');

  const { projectId, projectNumber, databaseId, region } = NAMED_DB_TEST_CONFIG;

  await loadRulesForNamedDatabase({
    host: resolvedHostPort.host,
    port: resolvedHostPort.port,
    projectId,
    databaseId,
    rules,
  });

  await clearNamedDatabaseDocuments({
    host: resolvedHostPort.host,
    port: resolvedHostPort.port,
    projectId,
    databaseId,
  });

  await verifyNamedDatabaseIsolation({
    host: resolvedHostPort.host,
    port: resolvedHostPort.port,
    projectId,
    databaseId,
  });

  const contexts = new Set<NamedDbContextImpl>();
  let destroyed = false;

  const ensureAlive = () => {
    if (destroyed) {
      throw new Error('NamedDbRulesTestEnvironment has already been cleaned up.');
    }
  };

  console.log(
    `[NamedDB Harness] Connected to local emulator ${resolvedHostPort.host}:${resolvedHostPort.port} | project=${projectId} (${projectNumber}) | region=${region} | database=${databaseId} (isolated from default)`
  );

  return {
    projectId,
    projectNumber,
    databaseId,
    region,
    host: resolvedHostPort.host,
    port: resolvedHostPort.port,

    authenticatedContext(uid: string, tokenOptions?: TokenOptions): NamedDbRulesTestContext {
      ensureAlive();
      const ctx = new NamedDbContextImpl(
        projectId,
        databaseId,
        resolvedHostPort.host,
        resolvedHostPort.port,
        {
          ...(tokenOptions || {}),
          sub: uid,
          user_id: uid,
        }
      );
      contexts.add(ctx);
      return ctx;
    },

    unauthenticatedContext(): NamedDbRulesTestContext {
      ensureAlive();
      const ctx = new NamedDbContextImpl(
        projectId,
        databaseId,
        resolvedHostPort.host,
        resolvedHostPort.port,
        undefined
      );
      contexts.add(ctx);
      return ctx;
    },

    async withSecurityRulesDisabled(
      callback: (context: NamedDbRulesTestContext) => Promise<void>
    ): Promise<void> {
      ensureAlive();
      const ctx = new NamedDbContextImpl(
        projectId,
        databaseId,
        resolvedHostPort.host,
        resolvedHostPort.port,
        'owner'
      );
      try {
        await callback(ctx);
      } finally {
        await ctx.cleanup();
      }
    },

    async clearFirestore(): Promise<void> {
      ensureAlive();
      await clearNamedDatabaseDocuments({
        host: resolvedHostPort.host,
        port: resolvedHostPort.port,
        projectId,
        databaseId,
      });
    },

    async cleanup(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      const list = Array.from(contexts);
      contexts.clear();
      await Promise.all(list.map((c) => c.cleanup()));
    },
  };
}
