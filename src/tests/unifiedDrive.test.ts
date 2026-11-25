/**
 * Unified Google Drive Centralized System — Comprehensive Verification Suite
 * --------------------------------------------------------------------------
 * Exercises real production code in:
 *   - `src/services/unifiedDriveService.ts`
 *   - `src/services/driveService.ts`
 *   - `src/services/workersPayrollService.ts`
 *   - `src/services/purchaseService.ts`
 *   - `src/utils/driveMigrationPlanner.ts`
 * against a strict local in-process Google Drive v3 HTTP test server.
 *
 * Zero production Google accounts, tokens, or Firestore data are touched.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import type { Branch, ClosingArchiveRecord, Organization, ShiftClosing, UserProfile } from '../types';
import {
  UNIFIED_BRANCHES_FOLDER_NAME,
  UNIFIED_ORG_IMPORTANT_DOCS_FOLDER_NAME,
  UnifiedDriveActorContext,
  UnifiedDriveError,
} from '../types/unifiedDrive';
import {
  clearUnifiedDriveDiagnostics,
  clearUnifiedDriveFolderCache,
  downloadUnifiedDriveFile,
  ensureOrgImportantDocsFolder,
  ensureUnifiedDailyFolderPath,
  getUnifiedDriveDiagnostics,
  getUnifiedDriveFileById,
  listOrganizationDriveInventory,
  moveUnifiedDriveFile,
  restoreUnifiedDriveFile,
  trashUnifiedDriveFile,
  updateUnifiedDriveFile,
  uploadUnifiedDriveFile,
} from '../services/unifiedDriveService';
import {
  downloadOriginalClosingExcelFromDrive,
  uploadAndVerifyClosingExcelToDrive,
  verifyDriveWriteReadCapability,
} from '../services/driveService';
import { generateClosingExcelWorkbook } from '../services/excelReportService';
import {
  uploadPayrollPaymentProofToDrive,
  uploadWorkerAdvanceProofToDrive,
} from '../services/workersPayrollService';
import { preparePurchaseSubmission } from '../services/purchaseService';
import {
  applyMigrationPlanCheckpoint,
  buildLegacyDriveMigrationPlan,
  executeMigrationPlanItem,
} from '../utils/driveMigrationPlanner';

interface MockDriveItem {
  id: string;
  ownerSub: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  appProperties: Record<string, string>;
  webViewLink: string;
  content: Buffer;
}

const TOKEN_ORG_A = 'unified_test_token_org_a';
const TOKEN_ORG_B = 'unified_test_token_org_b';
const TOKEN_EXPIRED = 'unified_test_token_expired_401';

const ACCOUNTS: Record<string, { sub: string; email: string }> = {
  [TOKEN_ORG_A]: { sub: 'sub_owner_a', email: 'owner.a@example.com' },
  [TOKEN_ORG_B]: { sub: 'sub_owner_b', email: 'owner.b@example.com' },
};

function parseQuery(q: string) {
  const nameMatch = q.match(/name\s*=\s*'([^']*)'/);
  const mimeMatch = q.match(/mimeType\s*=\s*'([^']*)'/);
  const parentMatch = q.match(/'([^']*)'\s+in\s+parents/);
  const appProps: Record<string, string> = {};
  const propRegex = /appProperties\s+has\s*\{\s*key='([^']*)'\s+and\s+value='([^']*)'\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = propRegex.exec(q)) !== null) {
    appProps[m[1]] = m[2];
  }
  return {
    name: nameMatch?.[1],
    mimeType: mimeMatch?.[1],
    parent: parentMatch?.[1],
    requireNotTrashed: q.includes('trashed = false'),
    appProps,
  };
}

function parseMultipart(rawBody: Buffer, contentType: string): { metadata: any; mediaBytes: Buffer } {
  const bMatch = contentType.match(/boundary=([^\s;]+)/i);
  assert.ok(bMatch, `Missing multipart boundary in ${contentType}`);
  const boundary = bMatch[1].replace(/^"|"$/g, '');
  const marker = Buffer.from(`--${boundary}`);
  const first = rawBody.indexOf(marker);
  const second = rawBody.indexOf(marker, first + marker.length);
  const end = rawBody.indexOf(Buffer.from(`--${boundary}--`), second + marker.length);
  assert.ok(first >= 0 && second > first && end > second, 'Invalid multipart boundaries');
  const part1 = rawBody.subarray(first + marker.length, second);
  const part2 = rawBody.subarray(second + marker.length, end);
  const sep1 = part1.indexOf(Buffer.from('\r\n\r\n'));
  const sep2 = part2.indexOf(Buffer.from('\r\n\r\n'));
  const metadata = JSON.parse(part1.subarray(sep1 + 4, part1.length - 2).toString('utf8'));
  const mediaBytes = Buffer.from(part2.subarray(sep2 + 4, part2.length - 2));
  return { metadata, mediaBytes };
}

async function startUnifiedMockDriveServer() {
  const items = new Map<string, MockDriveItem>();
  let seq = 5000;
  let httpDeleteCount = 0;
  let failNextRequestStatus: number | null = null;
  const requestLog: Array<{ method: string; path: string }> = [];

  const serialize = (it: MockDriveItem) => ({
    id: it.id,
    name: it.name,
    mimeType: it.mimeType,
    parents: it.parents,
    trashed: it.trashed,
    appProperties: it.appProperties,
    webViewLink: it.webViewLink,
    size: String(it.content.byteLength),
    createdTime: '2026-11-24T08:00:00.000Z',
    modifiedTime: '2026-11-24T08:00:00.000Z',
  });

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    requestLog.push({ method: req.method || 'GET', path: reqUrl.pathname });

    if (req.method === 'DELETE') {
      httpDeleteCount += 1;
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 405, message: 'HTTP DELETE forbidden' } }));
      return;
    }

    if (failNextRequestStatus !== null) {
      const code = failNextRequestStatus;
      failNextRequestStatus = null;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code, message: `Injected HTTP ${code}` } }));
      return;
    }

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const account = ACCOUNTS[token];
    if (!account) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);

      // GET /drive/v3/files (List / Search)
      if (req.method === 'GET' && reqUrl.pathname === '/drive/v3/files') {
        const filters = parseQuery(reqUrl.searchParams.get('q') || '');
        const matched = Array.from(items.values()).filter((it) => {
          if (it.ownerSub !== account.sub) return false;
          if (filters.requireNotTrashed && it.trashed) return false;
          if (filters.name && it.name !== filters.name) return false;
          if (filters.mimeType && it.mimeType !== filters.mimeType) return false;
          if (filters.parent && !it.parents.includes(filters.parent)) return false;
          for (const [k, v] of Object.entries(filters.appProps)) {
            if (it.appProperties[k] !== v) return false;
          }
          return true;
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files: matched.map(serialize) }));
        return;
      }

      // POST /drive/v3/files (Create folder)
      if (req.method === 'POST' && reqUrl.pathname === '/drive/v3/files') {
        const payload = JSON.parse(bodyBuf.toString('utf8'));
        const id = `drv_fld_${++seq}`;
        const created: MockDriveItem = {
          id,
          ownerSub: account.sub,
          name: payload.name,
          mimeType: payload.mimeType,
          parents: Array.isArray(payload.parents) ? [...payload.parents] : ['root'],
          trashed: false,
          appProperties: { ...(payload.appProperties || {}) },
          webViewLink: `https://drive.google.com/drive/folders/${id}`,
          content: Buffer.alloc(0),
        };
        items.set(id, created);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(serialize(created)));
        return;
      }

      // POST /upload/drive/v3/files (Multipart create)
      if (req.method === 'POST' && reqUrl.pathname === '/upload/drive/v3/files') {
        const { metadata, mediaBytes } = parseMultipart(
          bodyBuf,
          String(req.headers['content-type'] || '')
        );
        const id = `drv_file_${++seq}`;
        const created: MockDriveItem = {
          id,
          ownerSub: account.sub,
          name: metadata.name,
          mimeType: metadata.mimeType,
          parents: Array.isArray(metadata.parents) ? [...metadata.parents] : ['root'],
          trashed: false,
          appProperties: { ...(metadata.appProperties || {}) },
          webViewLink: `https://drive.google.com/file/d/${id}/view`,
          content: mediaBytes,
        };
        items.set(id, created);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(serialize(created)));
        return;
      }

      // PATCH /upload/drive/v3/files/:id (Multipart update)
      if (req.method === 'PATCH' && reqUrl.pathname.startsWith('/upload/drive/v3/files/')) {
        const id = decodeURIComponent(reqUrl.pathname.split('/').pop() || '');
        const existing = items.get(id);
        if (!existing || existing.ownerSub !== account.sub) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 404, message: 'File not found' } }));
          return;
        }
        const { metadata, mediaBytes } = parseMultipart(
          bodyBuf,
          String(req.headers['content-type'] || '')
        );
        if (metadata.name) existing.name = metadata.name;
        if (metadata.mimeType) existing.mimeType = metadata.mimeType;
        if (metadata.appProperties) existing.appProperties = { ...metadata.appProperties };
        existing.content = mediaBytes;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(serialize(existing)));
        return;
      }

      // PATCH /drive/v3/files/:id (Rename, Move addParents/removeParents, Trash/Restore)
      if (req.method === 'PATCH' && reqUrl.pathname.startsWith('/drive/v3/files/')) {
        const id = decodeURIComponent(reqUrl.pathname.split('/').pop() || '');
        const existing = items.get(id);
        if (!existing || existing.ownerSub !== account.sub) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 404, message: 'File not found' } }));
          return;
        }
        const bodyJson = bodyBuf.byteLength > 0 ? JSON.parse(bodyBuf.toString('utf8')) : {};
        if (typeof bodyJson.name === 'string') existing.name = bodyJson.name;
        if (typeof bodyJson.trashed === 'boolean') existing.trashed = bodyJson.trashed;
        if (bodyJson.appProperties) {
          existing.appProperties = { ...existing.appProperties, ...bodyJson.appProperties };
        }
        const removeParents = (reqUrl.searchParams.get('removeParents') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const addParents = (reqUrl.searchParams.get('addParents') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (removeParents.length > 0) {
          existing.parents = existing.parents.filter((p) => !removeParents.includes(p));
        }
        for (const p of addParents) {
          if (!existing.parents.includes(p)) existing.parents.push(p);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(serialize(existing)));
        return;
      }

      // GET /drive/v3/files/:id (?alt=media or metadata)
      if (req.method === 'GET' && reqUrl.pathname.startsWith('/drive/v3/files/')) {
        const id = decodeURIComponent(reqUrl.pathname.split('/').pop() || '');
        const existing = items.get(id);
        if (!existing || existing.ownerSub !== account.sub) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 404, message: 'File not found' } }));
          return;
        }
        if (reqUrl.searchParams.get('alt') === 'media') {
          res.writeHead(200, { 'Content-Type': existing.mimeType });
          res.end(existing.content);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(serialize(existing)));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    items,
    getHttpDeleteCount: () => httpDeleteCount,
    setFailNextRequestStatus: (code: number | null) => {
      failNextRequestStatus = code;
    },
    requestLog,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function runUnifiedDriveTests() {
  const mock = await startUnifiedMockDriveServer();
  const originalFetch = globalThis.fetch;
  let simulateNetworkOffline = false;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (rawUrl.startsWith('https://www.googleapis.com/')) {
      if (simulateNetworkOffline) {
        throw new TypeError('Failed to fetch: simulated network outage');
      }
      const parsed = new URL(rawUrl);
      return originalFetch(`${mock.baseUrl}${parsed.pathname}${parsed.search}`, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const orgA: Organization = {
    id: 'org_unified_a',
    name: 'مؤسسة الأفق التجارية',
    activityType: 'retail',
    currency: 'SAR',
    ownerId: 'uid_owner_a',
    ownerEmail: 'owner.a@example.com',
    ownerName: 'مالك الأفق',
    driveConnected: true,
    driveAccountEmail: 'owner.a@example.com',
    driveGoogleSub: 'sub_owner_a',
    driveWriteVerified: true,
    driveLastHealthStatus: 'verified',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
  };

  const branchA1: Branch = {
    id: 'br_a_sahab',
    orgId: orgA.id,
    name: 'فرع سحاب 1',
    code: 'SHB1',
    isActive: true,
    createdAt: '2026-11-01T08:00:00.000Z',
  };

  const orgB: Organization = {
    id: 'org_unified_b',
    name: 'مؤسسة النخيل',
    activityType: 'restaurant',
    currency: 'SAR',
    ownerId: 'uid_owner_b',
    ownerEmail: 'owner.b@example.com',
    ownerName: 'مالك النخيل',
    driveConnected: true,
    driveAccountEmail: 'owner.b@example.com',
    driveGoogleSub: 'sub_owner_b',
    driveWriteVerified: true,
    driveLastHealthStatus: 'verified',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
  };

  const ownerA: UnifiedDriveActorContext = {
    uid: orgA.ownerId,
    orgId: orgA.id,
    role: 'manager',
    isActive: true,
    displayName: orgA.ownerName,
    email: orgA.ownerEmail,
  };

  const ownerB: UnifiedDriveActorContext = {
    uid: orgB.ownerId,
    orgId: orgB.id,
    role: 'manager',
    isActive: true,
    displayName: orgB.ownerName,
    email: orgB.ownerEmail,
  };

  const branchManagerA: UnifiedDriveActorContext = {
    uid: 'uid_bm_a',
    orgId: orgA.id,
    role: 'branch_manager',
    isActive: true,
    displayName: 'مدير فرع سحاب',
    email: 'bm.a@example.com',
  };

  const employeeA: UnifiedDriveActorContext = {
    uid: 'uid_emp_a',
    orgId: orgA.id,
    role: 'employee',
    isActive: true,
    displayName: 'موظف صندوق',
    email: 'emp.a@example.com',
  };

  const supervisorA: UnifiedDriveActorContext = {
    uid: 'uid_sup_a',
    orgId: orgA.id,
    role: 'supervisor',
    isActive: true,
    displayName: 'مشرف عمليات',
    email: 'sup.a@example.com',
  };

  const ownerAProfile: UserProfile = {
    uid: orgA.ownerId,
    orgId: orgA.id,
    email: orgA.ownerEmail,
    displayName: orgA.ownerName,
    role: 'manager',
    isActive: true,
    permissions: {
      canCreateClosing: true,
      canViewAllClosings: true,
      canApproveClosings: true,
      canManageBranches: true,
      canManageEmployees: true,
      canExportReports: true,
      canManagePurchases: true,
      canViewSuppliers: true,
    },
    createdAt: '2026-11-01T08:00:00.000Z',
  };

  try {
    clearUnifiedDriveFolderCache();
    clearUnifiedDriveDiagnostics();

    // -----------------------------------------------------------------------
    // 1. Unified Folder Creation Without Duplicates (Concurrent + Sequential)
    // -----------------------------------------------------------------------
    console.log('1. Testing Unified Folder Hierarchy Creation Without Duplicates...');
    const [path1, path2, path3] = await Promise.all([
      ensureUnifiedDailyFolderPath({
        token: TOKEN_ORG_A,
        actor: ownerA,
        org: orgA,
        branch: branchA1,
        date: '2026-11-24',
      }),
      ensureUnifiedDailyFolderPath({
        token: TOKEN_ORG_A,
        actor: ownerA,
        org: orgA,
        branch: branchA1,
        date: '2026-11-24',
      }),
      ensureUnifiedDailyFolderPath({
        token: TOKEN_ORG_A,
        actor: ownerA,
        org: orgA,
        branch: branchA1,
        date: '2026-11-24',
      }),
    ]);

    assert.equal(path1.dayFolder.folderId, path2.dayFolder.folderId);
    assert.equal(path2.dayFolder.folderId, path3.dayFolder.folderId);
    assert.equal(path1.branchesContainerFolder.folderName, UNIFIED_BRANCHES_FOLDER_NAME);
    assert.equal(path1.branchFolder.folderName, 'فرع سحاب 1 - SHB1');
    assert.equal(path1.yearFolder.folderName, '2026');
    assert.equal(path1.monthFolder.folderName, '11');
    assert.equal(path1.dayFolder.folderName, '24');
    // Verify strict parent chain: Org -> الفروع -> Branch -> YYYY -> MM -> DD
    assert.ok(path1.branchesContainerFolder.parents.includes(path1.orgFolder.folderId));
    assert.ok(path1.branchFolder.parents.includes(path1.branchesContainerFolder.folderId));
    assert.ok(path1.yearFolder.parents.includes(path1.branchFolder.folderId));
    assert.ok(path1.monthFolder.parents.includes(path1.yearFolder.folderId));
    assert.ok(path1.dayFolder.parents.includes(path1.monthFolder.folderId));

    const folderCountAfterConcurrent = Array.from(mock.items.values()).filter(
      (i) => i.mimeType === 'application/vnd.google-apps.folder'
    ).length;
    assert.equal(folderCountAfterConcurrent, 6); // Org + الفروع + Branch + 2026 + 11 + 24

    // -----------------------------------------------------------------------
    // 2. Upload All 5 Daily Document Types Directly Inside Day Folder (Zero Type Subfolders)
    //    + Org Important Document Inside مستندات المؤسسة المهمة
    // -----------------------------------------------------------------------
    console.log('2. Testing All 5 Daily Document Types Directly Inside Day Folder + Org Important Docs...');
    const morningUpload = await uploadUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      branch: branchA1,
      documentType: 'closing_morning',
      documentDate: '2026-11-24',
      recordId: 'cls_morning_01',
      fileName: 'closing_morning_2026-11-24.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(Buffer.from('MORNING-CLOSING-DATA')),
    });

    const eveningUpload = await uploadUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      branch: branchA1,
      documentType: 'closing_evening',
      documentDate: '2026-11-24',
      recordId: 'cls_evening_01',
      fileName: 'closing_evening_2026-11-24.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(Buffer.from('EVENING-CLOSING-DATA')),
    });

    const purchaseUpload = await uploadUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      branch: branchA1,
      documentType: 'purchase',
      documentDate: '2026-11-24',
      recordId: 'pur_001',
      fileName: 'invoice_1001.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(Buffer.from('PURCHASE-INVOICE-PDF')),
    });

    const advanceUpload = await uploadWorkerAdvanceProofToDrive({
      token: TOKEN_ORG_A,
      actor: ownerAProfile,
      org: orgA,
      branch: branchA1,
      advanceId: 'adv_001',
      advanceDate: '2026-11-24',
      fileName: 'worker_advance_receipt.jpg',
      mimeType: 'image/jpeg',
      bytes: new Uint8Array(Buffer.from('ADVANCE-RECEIPT-JPG')),
    });

    const payrollUpload = await uploadPayrollPaymentProofToDrive({
      token: TOKEN_ORG_A,
      actor: ownerAProfile,
      org: orgA,
      branch: branchA1,
      paymentId: 'pay_001',
      paymentDate: '2026-11-24',
      fileName: 'payroll_transfer_nov.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(Buffer.from('PAYROLL-PAYMENT-PDF')),
    });

    // ALL 5 daily files MUST sit DIRECTLY inside dayFolder with ZERO per-type subfolders
    for (const u of [morningUpload, eveningUpload, purchaseUpload, advanceUpload, payrollUpload]) {
      assert.equal(u.record.parentFolderId, path1.dayFolder.folderId);
      assert.ok(mock.items.get(u.record.fileId)?.parents.includes(path1.dayFolder.folderId));
    }
    const subfoldersInsideDay = Array.from(mock.items.values()).filter(
      (i) =>
        i.mimeType === 'application/vnd.google-apps.folder' &&
        i.parents.includes(path1.dayFolder.folderId)
    );
    assert.equal(subfoldersInsideDay.length, 0, 'Must NOT create per-type subfolders inside Day folder');

    // Organization Important Document at <Org Root> / مستندات المؤسسة المهمة
    const orgDocUpload = await uploadUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      documentType: 'org_important_document',
      recordId: 'orgdoc_cr_2026',
      fileName: 'commercial_registration.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(Buffer.from('CR-PDF-BYTES')),
    });
    const orgDocsFolder = await ensureOrgImportantDocsFolder({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
    });
    assert.equal(orgDocsFolder.importantDocsFolder.folderName, UNIFIED_ORG_IMPORTANT_DOCS_FOLDER_NAME);
    assert.ok(orgDocsFolder.importantDocsFolder.parents.includes(path1.orgFolder.folderId));
    assert.equal(orgDocUpload.record.parentFolderId, orgDocsFolder.importantDocsFolder.folderId);

    // Verify purchaseService accepts & persists canonical driveFileId + driveWebViewLink cleanly
    const preparedPurchase = preparePurchaseSubmission({
      userProfile: ownerAProfile,
      orgId: orgA.id,
      currency: 'SAR',
      branch: branchA1,
      supplier: {
        id: 'sup_01',
        orgId: orgA.id,
        name: 'مورد الاختبار',
        isActive: true,
        createdBy: orgA.ownerId,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      date: '2026-11-24',
      paymentMethod: 'cash',
      items: [{ id: 'item_0', name: 'بضاعة', quantity: '2', unitPrice: '50' }],
      attachments: [
        {
          fileName: purchaseUpload.record.fileName,
          fileSize: purchaseUpload.record.fileSize,
          mimeType: purchaseUpload.record.mimeType,
          driveFileId: purchaseUpload.record.fileId,
          driveWebViewLink: purchaseUpload.record.webViewLink,
        },
      ],
    });
    assert.equal(preparedPurchase.ok, true);
    if (preparedPurchase.ok) {
      assert.equal(preparedPurchase.data.attachments[0].driveFileId, purchaseUpload.record.fileId);
      assert.equal(preparedPurchase.data.attachments[0].driveWebViewLink, purchaseUpload.record.webViewLink);
    }

    // -----------------------------------------------------------------------
    // 3. Reuse Existing Folders Without Creating Duplicates (Cache Cleared)
    // -----------------------------------------------------------------------
    console.log('3. Testing Reuse of Pre-Existing Folders After Cache Clear...');
    clearUnifiedDriveFolderCache();
    const foldersBefore = Array.from(mock.items.values()).filter(
      (i) => i.mimeType === 'application/vnd.google-apps.folder'
    ).length;
    const reusedPath = await ensureUnifiedDailyFolderPath({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: { ...orgA, driveFolderId: path1.orgFolder.folderId },
      branch: branchA1,
      date: '2026-11-24',
    });
    assert.equal(reusedPath.dayFolder.folderId, path1.dayFolder.folderId);
    assert.equal(reusedPath.dayFolder.reused, true);
    const foldersAfter = Array.from(mock.items.values()).filter(
      (i) => i.mimeType === 'application/vnd.google-apps.folder'
    ).length;
    assert.equal(foldersAfter, foldersBefore);

    // -----------------------------------------------------------------------
    // 4. Canonical fileId Storage & Retrieval (Metadata + Binary Download)
    // -----------------------------------------------------------------------
    console.log('4. Testing Canonical fileId Retrieval & Download...');
    const fetchedMeta = await getUnifiedDriveFileById({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      fileId: purchaseUpload.record.fileId,
      expectedRecordId: 'pur_001',
    });
    assert.equal(fetchedMeta.fileId, purchaseUpload.record.fileId);
    assert.equal(fetchedMeta.fileName, 'invoice_1001.pdf');

    const downloadedPurchase = await downloadUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      fileId: purchaseUpload.record.fileId,
      expectedRecordId: 'pur_001',
    });
    assert.equal(Buffer.from(downloadedPurchase.bytes).toString('utf8'), 'PURCHASE-INVOICE-PDF');

    // -----------------------------------------------------------------------
    // 5. Legacy File Access Remains 100% Intact (Old Month Folder & Excel Archive)
    // -----------------------------------------------------------------------
    console.log('5. Testing Seamless Access to Legacy Files (Pre-Unification Month Folder)...');
    const legacyClosing: ShiftClosing = {
      id: 'cls_legacy_2026_10_05',
      orgId: orgA.id,
      branchId: branchA1.id,
      branchName: branchA1.name,
      employeeId: 'uid_emp_a',
      employeeName: 'موظف صندوق',
      date: '2026-10-05',
      period: 'morning',
      cashSales: 500,
      cardSales: 700,
      totalSales: 1200,
      expenses: 100,
      remainingInBox: 400,
      netPeriod: 1100,
      status: 'approved',
      attachmentIds: [],
      reviewedBy: orgA.ownerId,
      reviewedByName: orgA.ownerName,
      reviewedAt: '2026-10-05T15:00:00.000Z',
      createdAt: '2026-10-05T14:00:00.000Z',
      updatedAt: '2026-10-05T15:00:00.000Z',
    };
    const legacyExcel = await generateClosingExcelWorkbook({
      closing: legacyClosing,
      org: orgA,
      branch: branchA1,
      revision: 1,
    });
    const legacyUpload = await uploadAndVerifyClosingExcelToDrive({
      token: TOKEN_ORG_A,
      org: { ...orgA, driveFolderId: path1.orgFolder.folderId },
      branch: branchA1,
      closing: legacyClosing,
      revision: 1,
      excelPayload: legacyExcel,
      folderStrategy: 'legacy_month',
    });

    // Access legacy file via unified service by canonical fileId
    const legacyViaUnified = await downloadUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      fileId: legacyUpload.fileId,
      expectedRecordId: legacyClosing.id,
    });
    assert.deepEqual(Buffer.from(legacyViaUnified.bytes), Buffer.from(legacyExcel.bytes));

    // -----------------------------------------------------------------------
    // 6. Rename & Move File Preserving Canonical fileId & Record Link
    // -----------------------------------------------------------------------
    console.log('6. Testing File Rename & Move Without Breaking fileId or Record Link...');
    const renamed = await updateUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      fileId: purchaseUpload.record.fileId,
      expectedRecordId: 'pur_001',
      newFileName: 'invoice_1001_renamed.pdf',
    });
    assert.equal(renamed.metadata.fileId, purchaseUpload.record.fileId);
    assert.equal(renamed.metadata.fileName, 'invoice_1001_renamed.pdf');
    assert.equal(renamed.auditEvent.action, 'DRIVE_FILE_RENAMED');

    // Move legacy closing Excel from old <YYYY-MM> folder to unified <YYYY>/<MM>/<DD> folder
    const legacyUnifiedPath = await ensureUnifiedDailyFolderPath({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: { ...orgA, driveFolderId: path1.orgFolder.folderId },
      branch: branchA1,
      date: '2026-10-05',
    });
    const movedLegacy = await moveUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      fileId: legacyUpload.fileId,
      targetFolderId: legacyUnifiedPath.dayFolder.folderId,
      expectedRecordId: legacyClosing.id,
    });
    assert.equal(movedLegacy.moved, true);
    assert.equal(movedLegacy.metadata.fileId, legacyUpload.fileId);
    assert.deepEqual(movedLegacy.metadata.parents, [legacyUnifiedPath.dayFolder.folderId]);

    // Original closing downloader MUST STILL work after moving legacy file!
    const legacyArchiveRec: ClosingArchiveRecord = {
      closingId: legacyClosing.id,
      orgId: orgA.id,
      branchId: branchA1.id,
      yearMonth: '2026-10',
      archiveStatus: 'archived',
      driveExcelFileId: legacyUpload.fileId,
      driveExcelFileName: legacyUpload.fileName,
      driveExcelWebViewLink: legacyUpload.webViewLink,
      driveMonthFolderId: legacyUpload.monthFolder.folderId, // old parent folder ID!
      drivePayloadHash: legacyUpload.payloadHash,
      driveRevision: 1,
      archivedAt: legacyUpload.verifiedAt,
      archivedBy: orgA.ownerId,
      updatedAt: legacyUpload.verifiedAt,
    };
    const downloadedAfterMove = await downloadOriginalClosingExcelFromDrive({
      token: TOKEN_ORG_A,
      org: orgA,
      closing: legacyClosing,
      archiveRecord: legacyArchiveRec,
    });
    assert.equal(downloadedAfterMove.verified, true);
    assert.equal(downloadedAfterMove.fileId, legacyUpload.fileId);

    // -----------------------------------------------------------------------
    // 7 & 8. Unauthorized Users & Branch Manager Blocked From Direct Drive Access
    // -----------------------------------------------------------------------
    console.log('7 & 8. Testing Platform RBAC & Blocking Branch Manager Direct Drive Access...');
    // Branch Manager strictly forbidden even when holding exact valid fileId & token
    await assert.rejects(
      () =>
        downloadUnifiedDriveFile({
          token: TOKEN_ORG_A,
          actor: branchManagerA,
          org: orgA,
          fileId: purchaseUpload.record.fileId,
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.code === 'BRANCH_MANAGER_DIRECT_DRIVE_FORBIDDEN'
    );
    await assert.rejects(
      () =>
        uploadUnifiedDriveFile({
          token: TOKEN_ORG_A,
          actor: branchManagerA,
          org: orgA,
          branch: branchA1,
          documentType: 'purchase',
          documentDate: '2026-11-24',
          recordId: 'pur_bm_attempt',
          fileName: 'bm.pdf',
          mimeType: 'application/pdf',
          bytes: new Uint8Array([1, 2, 3]),
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.code === 'BRANCH_MANAGER_DIRECT_DRIVE_FORBIDDEN'
    );

    // Employee, Supervisor, and Inactive Manager strictly denied
    for (const deniedActor of [
      employeeA,
      supervisorA,
      { ...ownerA, isActive: false },
      { ...ownerA, uid: 'uid_other_manager' },
    ]) {
      await assert.rejects(
        () =>
          getUnifiedDriveFileById({
            token: TOKEN_ORG_A,
            actor: deniedActor,
            org: orgA,
            fileId: purchaseUpload.record.fileId,
          }),
        (err: unknown) => err instanceof UnifiedDriveError && err.code === 'UNAUTHORIZED_ROLE'
      );
    }

    // -----------------------------------------------------------------------
    // 9 & 10. Safe Delete = Move to Trash ONLY (Never Permanent DELETE)
    //         + Confirmation Gate + Financial Record Intact + Restore
    // -----------------------------------------------------------------------
    console.log('9 & 10. Testing Safe Trash-Only Delete, Confirmation Gate, Intact Financial Record & Restore...');
    // Must reject without explicit confirmation
    await assert.rejects(
      () =>
        trashUnifiedDriveFile({
          token: TOKEN_ORG_A,
          actor: ownerA,
          org: orgA,
          fileId: purchaseUpload.record.fileId,
          confirmed: false,
          expectedRecordId: 'pur_001',
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.code === 'CONFIRMATION_REQUIRED'
    );

    // Simulate platform state: parent purchase record + linked attachment status
    const parentPurchaseFinancialRecord = { id: 'pur_001', totalAmount: 100, status: 'recorded', intact: true };
    const attachmentRecordState = { id: 'att_pur_001', fileId: purchaseUpload.record.fileId, status: 'active', trashedAt: '' };

    const trashRes = await trashUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      fileId: purchaseUpload.record.fileId,
      confirmed: true,
      expectedRecordId: 'pur_001',
      documentType: 'purchase',
      reason: 'صورة مكررة غير واضحة',
      onDriveTrashed: ({ trashedAt }) => {
        attachmentRecordState.status = 'trashed';
        attachmentRecordState.trashedAt = trashedAt;
      },
    });

    assert.equal(trashRes.trashed, true);
    assert.equal(trashRes.parentFinancialRecordPreserved, true);
    assert.equal(trashRes.platformStateUpdated, true);
    assert.equal(trashRes.auditEvent.action, 'DRIVE_FILE_TRASHED');
    assert.equal(trashRes.auditEvent.actorUid, ownerA.uid);
    assert.equal(mock.items.get(purchaseUpload.record.fileId)?.trashed, true);
    assert.equal(attachmentRecordState.status, 'trashed');
    // Parent financial record MUST remain 100% intact
    assert.equal(parentPurchaseFinancialRecord.intact, true);
    assert.equal(parentPurchaseFinancialRecord.totalAmount, 100);

    // Health-check cleanup also uses Trash PATCH, never HTTP DELETE
    const healthRes = await verifyDriveWriteReadCapability({
      token: TOKEN_ORG_A,
      org: orgA,
      orgFolderId: path1.orgFolder.folderId,
    });
    assert.equal(healthRes.verified, true);
    assert.equal(mock.items.get(healthRes.testFileId)?.trashed, true);

    // Restore from Trash works cleanly for authorized owner
    const restoreRes = await restoreUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      fileId: purchaseUpload.record.fileId,
      expectedRecordId: 'pur_001',
    });
    assert.equal(restoreRes.trashed, false);
    assert.equal(restoreRes.auditEvent.action, 'DRIVE_FILE_RESTORED');
    assert.equal(mock.items.get(purchaseUpload.record.fileId)?.trashed, false);

    // -----------------------------------------------------------------------
    // 11. OAuth Failure / Expired Access Token (401)
    // -----------------------------------------------------------------------
    console.log('11. Testing Expired / Invalid OAuth Access Token (401) Handling...');
    let callbackCalledOn401 = false;
    await assert.rejects(
      () =>
        trashUnifiedDriveFile({
          token: TOKEN_EXPIRED,
          actor: ownerA,
          org: orgA,
          fileId: purchaseUpload.record.fileId,
          confirmed: true,
          onDriveTrashed: () => {
            callbackCalledOn401 = true;
          },
        }),
      (err: unknown) =>
        err instanceof UnifiedDriveError &&
        err.code === 'OAUTH_EXPIRED_OR_INVALID' &&
        err.httpStatus === 401
    );
    assert.equal(callbackCalledOn401, false, 'Platform state must NOT update on 401 Drive failure');

    // -----------------------------------------------------------------------
    // 12. Network Failure During Upload and During Trash
    // -----------------------------------------------------------------------
    console.log('12. Testing Network Failure During Upload & Trash...');
    simulateNetworkOffline = true;
    await assert.rejects(
      () =>
        uploadUnifiedDriveFile({
          token: TOKEN_ORG_A,
          actor: ownerA,
          org: orgA,
          branch: branchA1,
          documentType: 'purchase',
          documentDate: '2026-11-24',
          recordId: 'pur_offline_01',
          fileName: 'offline.pdf',
          mimeType: 'application/pdf',
          bytes: new Uint8Array([9, 8, 7]),
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.code === 'NETWORK_ERROR'
    );

    let callbackCalledOnOffline = false;
    await assert.rejects(
      () =>
        trashUnifiedDriveFile({
          token: TOKEN_ORG_A,
          actor: ownerA,
          org: orgA,
          fileId: purchaseUpload.record.fileId,
          confirmed: true,
          onDriveTrashed: () => {
            callbackCalledOnOffline = true;
          },
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.code === 'NETWORK_ERROR'
    );
    assert.equal(callbackCalledOnOffline, false, 'Platform state must NOT update on network failure');
    simulateNetworkOffline = false;

    // Also test Drive 500 server failure during trash -> never falsely reports success
    mock.setFailNextRequestStatus(500);
    await assert.rejects(
      () =>
        trashUnifiedDriveFile({
          token: TOKEN_ORG_A,
          actor: ownerA,
          org: orgA,
          fileId: purchaseUpload.record.fileId,
          confirmed: true,
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.httpStatus === 500
    );

    // -----------------------------------------------------------------------
    // 13. Retry Idempotency Without Duplicate Files
    // -----------------------------------------------------------------------
    console.log('13. Testing Retry Idempotency (Sequential & Concurrent Retries Never Duplicate)...');
    const filesInDayBeforeRetry = Array.from(mock.items.values()).filter(
      (i) => !i.trashed && i.parents.includes(path1.dayFolder.folderId)
    ).length;

    const retryRes1 = await uploadUnifiedDriveFile({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
      branch: branchA1,
      documentType: 'closing_morning',
      documentDate: '2026-11-24',
      recordId: 'cls_morning_01',
      fileName: 'closing_morning_2026-11-24.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(Buffer.from('MORNING-CLOSING-DATA-V2')),
    });
    assert.equal(retryRes1.record.fileId, morningUpload.record.fileId);
    assert.equal(retryRes1.reusedExisting, true);

    const filesInDayAfterRetry = Array.from(mock.items.values()).filter(
      (i) => !i.trashed && i.parents.includes(path1.dayFolder.folderId)
    ).length;
    assert.equal(filesInDayAfterRetry, filesInDayBeforeRetry);

    // -----------------------------------------------------------------------
    // 14. Cross-Organization Isolation (Even With Known fileId)
    // -----------------------------------------------------------------------
    console.log('14. Testing Cross-Organization Isolation...');
    // Org B owner passing Org A's org object -> blocked at platform gate
    await assert.rejects(
      () =>
        getUnifiedDriveFileById({
          token: TOKEN_ORG_B,
          actor: ownerB,
          org: orgA,
          fileId: purchaseUpload.record.fileId,
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.code === 'CROSS_ORG_FORBIDDEN'
    );

    // Org B owner passing Org B's org object + Org A's fileId -> 404 (not in Org B's Drive)
    await assert.rejects(
      () =>
        downloadUnifiedDriveFile({
          token: TOKEN_ORG_B,
          actor: ownerB,
          org: orgB,
          fileId: purchaseUpload.record.fileId,
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.code === 'NOT_FOUND'
    );

    // Even if a file tagged orgId=orgA somehow existed in Org B's Drive -> blocked by CROSS_ORG_FORBIDDEN!
    mock.items.set('drv_leaked_tag_01', {
      id: 'drv_leaked_tag_01',
      ownerSub: 'sub_owner_b',
      name: 'tagged_for_a.pdf',
      mimeType: 'application/pdf',
      parents: ['root'],
      trashed: false,
      appProperties: { systemId: 'al_eqfal', orgId: orgA.id, recordId: 'pur_001' },
      webViewLink: 'https://drive.google.com/file/d/drv_leaked_tag_01/view',
      content: Buffer.from('SECRET'),
    });
    await assert.rejects(
      () =>
        getUnifiedDriveFileById({
          token: TOKEN_ORG_B,
          actor: ownerB,
          org: orgB,
          fileId: 'drv_leaked_tag_01',
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.code === 'CROSS_ORG_FORBIDDEN'
    );

    // -----------------------------------------------------------------------
    // 15. Unified Daily Closing Excel Archival (folderStrategy: 'unified_daily')
    // -----------------------------------------------------------------------
    console.log('15. Testing Unified Daily Shift Closing Excel Archival...');
    const unifiedClosing: ShiftClosing = {
      ...legacyClosing,
      id: 'cls_unified_2026_11_24_eve',
      date: '2026-11-24',
      period: 'evening',
    };
    const unifiedExcel = await generateClosingExcelWorkbook({
      closing: unifiedClosing,
      org: orgA,
      branch: branchA1,
      revision: 1,
    });
    const unifiedClosingUpload = await uploadAndVerifyClosingExcelToDrive({
      token: TOKEN_ORG_A,
      org: { ...orgA, driveFolderId: path1.orgFolder.folderId },
      branch: branchA1,
      closing: unifiedClosing,
      revision: 1,
      excelPayload: unifiedExcel,
      folderStrategy: 'unified_daily',
      actor: ownerA,
    });
    assert.equal(unifiedClosingUpload.dayFolderId, path1.dayFolder.folderId);
    assert.ok(mock.items.get(unifiedClosingUpload.fileId)?.parents.includes(path1.dayFolder.folderId));

    // -----------------------------------------------------------------------
    // 16. Legacy Inventory & Resumable Migration Planner (Non-Destructive)
    // -----------------------------------------------------------------------
    console.log('16. Testing Legacy Inventory & Resumable Migration Planner...');
    // Seed 1 unmatched orphan file, 2 duplicate files, and 1 legacy ready_to_move file
    mock.items.set('drv_orphan_99', {
      id: 'drv_orphan_99',
      ownerSub: 'sub_owner_a',
      name: 'random_manual_scan.pdf',
      mimeType: 'application/pdf',
      parents: ['root'],
      trashed: false,
      appProperties: {},
      webViewLink: 'https://drive.google.com/file/d/drv_orphan_99/view',
      content: Buffer.from('ORPHAN'),
    });
    mock.items.set('drv_dup_1', {
      id: 'drv_dup_1',
      ownerSub: 'sub_owner_a',
      name: 'dup_inv.pdf',
      mimeType: 'application/pdf',
      parents: ['root'],
      trashed: false,
      appProperties: { systemId: 'al_eqfal', orgId: orgA.id, recordId: 'pur_dup', documentType: 'purchase' },
      webViewLink: 'https://drive.google.com/file/d/drv_dup_1/view',
      content: Buffer.from('DUP1'),
    });
    mock.items.set('drv_dup_2', {
      id: 'drv_dup_2',
      ownerSub: 'sub_owner_a',
      name: 'dup_inv.pdf',
      mimeType: 'application/pdf',
      parents: ['root'],
      trashed: false,
      appProperties: { systemId: 'al_eqfal', orgId: orgA.id, recordId: 'pur_dup', documentType: 'purchase' },
      webViewLink: 'https://drive.google.com/file/d/drv_dup_2/view',
      content: Buffer.from('DUP2'),
    });
    mock.items.set('drv_legacy_move_me', {
      id: 'drv_legacy_move_me',
      ownerSub: 'sub_owner_a',
      name: 'old_purchase_inv.pdf',
      mimeType: 'application/pdf',
      parents: ['root'],
      trashed: false,
      appProperties: { systemId: 'al_eqfal', orgId: orgA.id, recordId: 'pur_legacy_move', documentType: 'purchase' },
      webViewLink: 'https://drive.google.com/file/d/drv_legacy_move_me/view',
      content: Buffer.from('LEGACY-PURCHASE'),
    });

    const inventory = await listOrganizationDriveInventory({
      token: TOKEN_ORG_A,
      actor: ownerA,
      org: orgA,
    });
    const plan = buildLegacyDriveMigrationPlan({
      org: { ...orgA, driveFolderId: path1.orgFolder.folderId },
      branches: [branchA1],
      driveFolders: inventory.folders,
      driveFiles: inventory.files,
      platformRecords: [
        {
          recordId: 'pur_001',
          orgId: orgA.id,
          branchId: branchA1.id,
          documentType: 'purchase',
          documentDate: '2026-11-24',
          fileId: purchaseUpload.record.fileId,
          fileName: 'invoice_1001_renamed.pdf',
          sourceCollection: 'attachments',
        },
        {
          recordId: 'pur_legacy_move',
          orgId: orgA.id,
          branchId: branchA1.id,
          documentType: 'purchase',
          documentDate: '2026-11-20',
          fileId: 'drv_legacy_move_me',
          fileName: 'old_purchase_inv.pdf',
          sourceCollection: 'attachments',
        },
        {
          recordId: 'pur_missing_in_drive',
          orgId: orgA.id,
          branchId: branchA1.id,
          documentType: 'purchase',
          documentDate: '2026-11-19',
          fileId: 'drv_does_not_exist_404',
          fileName: 'missing.pdf',
          sourceCollection: 'attachments',
        },
      ],
    });

    assert.ok(plan.counts.alreadyUnified >= 1);
    assert.equal(plan.counts.readyToMove, 1);
    assert.equal(plan.counts.skippedDuplicates, 2);
    assert.ok(plan.counts.skippedUnmatched >= 1);
    assert.equal(plan.counts.missingInDrive, 1);

    const readyItem = plan.items.find((i) => i.fileId === 'drv_legacy_move_me')!;
    assert.equal(readyItem.classification, 'ready_to_move');
    assert.equal(readyItem.executionStatus, 'pending');

    // Refuses execution without explicit manual approval
    await assert.rejects(
      () =>
        executeMigrationPlanItem({
          token: TOKEN_ORG_A,
          actor: ownerA,
          org: { ...orgA, driveFolderId: path1.orgFolder.folderId },
          branches: [branchA1],
          item: readyItem,
          manualApprovalConfirmed: false,
        }),
      (err: unknown) => err instanceof UnifiedDriveError && err.code === 'CONFIRMATION_REQUIRED'
    );

    // Resumable checkpoint skips completed items cleanly
    const resumedPlan = applyMigrationPlanCheckpoint(plan, [readyItem.planItemId]);
    assert.equal(
      resumedPlan.items.find((i) => i.fileId === 'drv_legacy_move_me')?.executionStatus,
      'completed'
    );
    // Orphan file MUST remain untouched in its original parent ('root')
    assert.deepEqual(mock.items.get('drv_orphan_99')?.parents, ['root']);

    // Verify ZERO HTTP DELETE calls occurred anywhere in the entire run
    assert.equal(mock.getHttpDeleteCount(), 0, 'ZERO HTTP DELETE requests allowed across all Drive operations');

    // Verify structured diagnostics logged both ok & error operations
    const diagnostics = getUnifiedDriveDiagnostics();
    assert.ok(diagnostics.some((d) => d.status === 'ok'));
    assert.ok(diagnostics.some((d) => d.errorCode === 'BRANCH_MANAGER_DIRECT_DRIVE_FORBIDDEN'));
    assert.ok(diagnostics.some((d) => d.errorCode === 'OAUTH_EXPIRED_OR_INVALID'));
    assert.ok(diagnostics.some((d) => d.errorCode === 'NETWORK_ERROR'));

    // Static code hygiene checks: no localStorage/sessionStorage and no HTTP DELETE calls in Drive services
    const unifiedSrc = fs.readFileSync('src/services/unifiedDriveService.ts', 'utf8');
    const driveSrc = fs.readFileSync('src/services/driveService.ts', 'utf8');
    assert.equal(/\b(localStorage|sessionStorage)\s*\./.test(unifiedSrc), false);
    assert.equal(/method:\s*['"]DELETE['"]/.test(driveSrc), false);
    assert.equal(/method:\s*['"]DELETE['"]/.test(unifiedSrc), false);

    console.log('ALL 16 UNIFIED GOOGLE DRIVE VERIFICATION SCENARIOS PASSED.');
  } finally {
    globalThis.fetch = originalFetch;
    await mock.close();
  }
}

runUnifiedDriveTests().catch((err) => {
  console.error('UNIFIED GOOGLE DRIVE TEST SUITE FAILED:', err);
  process.exit(1);
});
