/**
 * End-to-End Google Drive Integration & Security Guard Verification Suite
 * ----------------------------------------------------------------------
 * Executes real production code in `driveService.ts` and `excelReportService.ts`
 * against a local in-process Google Drive v3 HTTP test server (no live/production
 * Google accounts, tokens, or Firestore data used).
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Branch, ClosingArchiveRecord, Organization, ShiftClosing } from '../types';
import { calculateShiftTotals } from '../utils/accounting';
import {
  assertDriveSessionMatchesAccount,
  clearDriveSession,
  downloadOriginalClosingExcelFromDrive,
  DriveTokenSession,
  evaluateOrgDriveReadiness,
  getActiveDriveSession,
  uploadAndVerifyClosingExcelToDrive,
} from '../services/driveService';
import { generateClosingExcelWorkbook } from '../services/excelReportService';

interface StoredDriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  appProperties: Record<string, string>;
  webViewLink: string;
  content: Buffer;
}

const VALID_TOKEN = 'ram_only_test_access_token_xyz';

function parseQueryStringFilters(q: string) {
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

function parseMultipartRelated(
  rawBody: Buffer,
  contentTypeHeader: string
): { metadata: Record<string, any>; mediaBytes: Buffer } {
  const bMatch = contentTypeHeader.match(/boundary=([^\s;]+)/i);
  assert.ok(bMatch, `Missing multipart boundary in ${contentTypeHeader}`);
  const boundary = bMatch[1].replace(/^"|"$/g, '');
  const marker = Buffer.from(`--${boundary}`);
  const firstIdx = rawBody.indexOf(marker);
  const secondIdx = rawBody.indexOf(marker, firstIdx + marker.length);
  const endIdx = rawBody.indexOf(Buffer.from(`--${boundary}--`), secondIdx + marker.length);
  assert.ok(firstIdx >= 0 && secondIdx > firstIdx && endIdx > secondIdx, 'Invalid multipart boundaries');

  const part1 = rawBody.subarray(firstIdx + marker.length, secondIdx);
  const part2 = rawBody.subarray(secondIdx + marker.length, endIdx);

  const sep1 = part1.indexOf(Buffer.from('\r\n\r\n'));
  const jsonBytes = part1.subarray(sep1 + 4, part1.length - 2); // strip trailing \r\n
  const metadata = JSON.parse(jsonBytes.toString('utf8'));

  const sep2 = part2.indexOf(Buffer.from('\r\n\r\n'));
  const mediaBytes = part2.subarray(sep2 + 4, part2.length - 2); // strip trailing \r\n

  return { metadata, mediaBytes: Buffer.from(mediaBytes) };
}

async function startMockDriveV3Server() {
  const items = new Map<string, StoredDriveItem>();
  let seq = 1000;
  let corruptNextAltMedia = false;

  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${VALID_TOKEN}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }));
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);

      // GET /drive/v3/files (Search)
      if (req.method === 'GET' && reqUrl.pathname === '/drive/v3/files') {
        const q = reqUrl.searchParams.get('q') || '';
        const filters = parseQueryStringFilters(q);
        const matched = Array.from(items.values()).filter((it) => {
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
        res.end(
          JSON.stringify({
            files: matched.map((it) => ({
              id: it.id,
              name: it.name,
              mimeType: it.mimeType,
              parents: it.parents,
              trashed: it.trashed,
              appProperties: it.appProperties,
              webViewLink: it.webViewLink,
              size: String(it.content.byteLength),
            })),
          })
        );
        return;
      }

      // POST /drive/v3/files (Create folder)
      if (req.method === 'POST' && reqUrl.pathname === '/drive/v3/files') {
        const payload = JSON.parse(bodyBuf.toString('utf8'));
        const id = `drive_item_${++seq}`;
        const created: StoredDriveItem = {
          id,
          name: payload.name,
          mimeType: payload.mimeType,
          parents: Array.isArray(payload.parents) ? payload.parents : ['root'],
          trashed: false,
          appProperties: payload.appProperties || {},
          webViewLink:
            payload.mimeType === 'application/vnd.google-apps.folder'
              ? `https://drive.google.com/drive/folders/${id}`
              : `https://drive.google.com/file/d/${id}/view`,
          content: Buffer.alloc(0),
        };
        items.set(id, created);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: created.id,
            name: created.name,
            mimeType: created.mimeType,
            parents: created.parents,
            trashed: created.trashed,
            appProperties: created.appProperties,
            webViewLink: created.webViewLink,
          })
        );
        return;
      }

      // POST /upload/drive/v3/files (Multipart create)
      if (req.method === 'POST' && reqUrl.pathname === '/upload/drive/v3/files') {
        const { metadata, mediaBytes } = parseMultipartRelated(
          bodyBuf,
          String(req.headers['content-type'] || '')
        );
        const id = `drive_xlsx_${++seq}`;
        const created: StoredDriveItem = {
          id,
          name: metadata.name,
          mimeType: metadata.mimeType,
          parents: Array.isArray(metadata.parents) ? metadata.parents : ['root'],
          trashed: false,
          appProperties: metadata.appProperties || {},
          webViewLink: `https://drive.google.com/file/d/${id}/view`,
          content: mediaBytes,
        };
        items.set(id, created);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: created.id,
            name: created.name,
            mimeType: created.mimeType,
            parents: created.parents,
            trashed: created.trashed,
            appProperties: created.appProperties,
            webViewLink: created.webViewLink,
            size: String(created.content.byteLength),
          })
        );
        return;
      }

      // PATCH /upload/drive/v3/files/:id (Multipart overwrite on retry)
      if (req.method === 'PATCH' && reqUrl.pathname.startsWith('/upload/drive/v3/files/')) {
        const id = decodeURIComponent(reqUrl.pathname.split('/').pop() || '');
        const existing = items.get(id);
        if (!existing) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 404, message: 'File not found' } }));
          return;
        }
        const { metadata, mediaBytes } = parseMultipartRelated(
          bodyBuf,
          String(req.headers['content-type'] || '')
        );
        existing.name = metadata.name || existing.name;
        existing.mimeType = metadata.mimeType || existing.mimeType;
        existing.appProperties = metadata.appProperties || existing.appProperties;
        existing.content = mediaBytes;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: existing.id,
            name: existing.name,
            mimeType: existing.mimeType,
            parents: existing.parents,
            trashed: existing.trashed,
            appProperties: existing.appProperties,
            webViewLink: existing.webViewLink,
            size: String(existing.content.byteLength),
          })
        );
        return;
      }

      // GET /drive/v3/files/:id (?alt=media or metadata)
      if (req.method === 'GET' && reqUrl.pathname.startsWith('/drive/v3/files/')) {
        const id = decodeURIComponent(reqUrl.pathname.split('/').pop() || '');
        const item = items.get(id);
        if (!item) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 404, message: 'File not found' } }));
          return;
        }
        if (reqUrl.searchParams.get('alt') === 'media') {
          const out = Buffer.from(item.content);
          if (corruptNextAltMedia && out.byteLength > 20) {
            out[out.byteLength - 15] ^= 0xff;
            corruptNextAltMedia = false;
          }
          res.writeHead(200, { 'Content-Type': item.mimeType });
          res.end(out);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: item.id,
            name: item.name,
            mimeType: item.mimeType,
            parents: item.parents,
            trashed: item.trashed,
            appProperties: item.appProperties,
            webViewLink: item.webViewLink,
            size: String(item.content.byteLength),
          })
        );
        return;
      }

      res.writeHead(404);
      res.end('Not implemented');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    items,
    setCorruptNextAltMedia: (val: boolean) => {
      corruptNextAltMedia = val;
    },
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function runDriveIntegrationTests() {
  const mockDrive = await startMockDriveV3Server();
  const originalFetch = globalThis.fetch;

  // Intercept ONLY googleapis Drive calls toward our local in-process Drive v3 HTTP server
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (rawUrl.startsWith('https://www.googleapis.com/')) {
      const parsed = new URL(rawUrl);
      const localUrl = `${mockDrive.baseUrl}${parsed.pathname}${parsed.search}`;
      return originalFetch(localUrl, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    console.log('1. Testing Owner OAuth Identity, Session Expiry & Non-Owner/Storage Isolation...');
    const ownerSession: DriveTokenSession = {
      accessToken: VALID_TOKEN,
      expiresIn: 3600,
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 3000 * 1000,
      email: 'owner.test@example.com',
      name: 'مالك التجربة',
      sub: 'google_uid_owner_01',
      verified: true,
    };

    const verifiedSession = assertDriveSessionMatchesAccount(ownerSession, {
      googleUid: 'google_uid_owner_01',
      email: 'owner.test@example.com',
      linkedSub: 'google_uid_owner_01',
      linkedEmail: 'owner.test@example.com',
    });
    assert.equal(verifiedSession.accessToken, VALID_TOKEN);

    assert.throws(
      () =>
        assertDriveSessionMatchesAccount(ownerSession, {
          googleUid: 'google_uid_other_account',
          email: 'other@example.com',
          linkedSub: 'google_uid_owner_01',
          linkedEmail: 'owner.test@example.com',
        }),
      /لا يطابق/
    );
    assert.throws(
      () =>
        assertDriveSessionMatchesAccount(
          { ...ownerSession, expiresAt: Date.now() - 1000 },
          {
            googleUid: 'google_uid_owner_01',
            email: 'owner.test@example.com',
          }
        ),
      /انتهت صلاحية/
    );
    clearDriveSession();
    assert.equal(getActiveDriveSession(), null);

    console.log('2. Testing Drive Readiness & Employee / Unlinked Org Guards...');
    const testOrg: Organization = {
      id: 'org_drive_test',
      name: 'مؤسسة الاختبار التجريبية',
      activityType: 'retail',
      currency: 'SAR',
      ownerId: 'uid_owner_01',
      ownerEmail: 'owner.test@example.com',
      ownerName: 'مالك التجربة',
      driveConnected: true,
      driveAccountEmail: 'owner.test@example.com',
      driveGoogleSub: 'google_uid_owner_01',
      driveWriteVerified: true,
      driveLastHealthStatus: 'verified',
      createdAt: '2026-11-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    };
    const testBranch: Branch = {
      id: 'br_test_01',
      orgId: testOrg.id,
      name: 'فرع الاختبار الشمالي',
      code: 'TST01',
      isActive: true,
      createdAt: '2026-11-01T08:00:00.000Z',
    };

    const readyOrg: Organization = {
      ...testOrg,
      driveFolderId: 'drive_org_folder_ready',
      driveFolderName: `AL EQFAL - ${testOrg.name} - ${testOrg.id}`,
    };
    const readyBranch: Branch = {
      ...testBranch,
      driveFolderId: 'drive_br_folder_ready',
      driveFolderName: `${testBranch.name} - ${testBranch.code}`,
    };

    assert.equal(evaluateOrgDriveReadiness(readyOrg, readyBranch).isReady, true);
    assert.equal(evaluateOrgDriveReadiness(testOrg, testBranch).reasonCode, 'missing_org_folder');
    assert.equal(evaluateOrgDriveReadiness(readyOrg, testBranch).reasonCode, 'missing_branch_folder');
    assert.equal(evaluateOrgDriveReadiness({ ...readyOrg, driveConnected: false }, readyBranch).isReady, false);
    assert.equal(
      evaluateOrgDriveReadiness({ ...readyOrg, driveLastHealthStatus: 'failed' }, readyBranch).isReady,
      false
    );

    // Verify source files enforce owner/manager separation and zero browser storage persistence
    const authCtxSource = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
    assert.match(authCtxSource, /currentUser\.uid !== currentOrg\.ownerId/);
    assert.match(authCtxSource, /userProfile\.role !== 'manager'/);
    const driveSvcSource = fs.readFileSync('src/services/driveService.ts', 'utf8');
    assert.equal(/\b(localStorage|sessionStorage)\s*\./.test(driveSvcSource), false);
    assert.equal(/\b(localStorage|sessionStorage)\s*\./.test(authCtxSource), false);

    console.log('3. Generating Approved Closing Excel v1 & Uploading to Verified Drive Hierarchy...');
    const closingV1: ShiftClosing = {
      id: 'cls_drive_e2e_01',
      orgId: testOrg.id,
      branchId: testBranch.id,
      branchName: testBranch.name,
      employeeId: 'uid_emp_01',
      employeeName: 'موظف تجريبي',
      date: '2026-11-14',
      period: 'morning',
      cashSales: 1000,
      cardSales: 2000,
      totalSales: 3000,
      expenses: 250,
      remainingInBox: 750,
      netPeriod: 2750,
      notes: 'إقفال تجريبي لاختبار الرفع والتنزيل من Drive',
      status: 'approved',
      attachmentIds: [],
      reviewedBy: testOrg.ownerId,
      reviewedByName: testOrg.ownerName,
      reviewedAt: '2026-11-14T15:00:00.000Z',
      createdAt: '2026-11-14T14:00:00.000Z',
      updatedAt: '2026-11-14T15:00:00.000Z',
    };

    const payloadV1 = await generateClosingExcelWorkbook({
      closing: closingV1,
      org: testOrg,
      branch: testBranch,
      revision: 1,
    });

    const uploadV1 = await uploadAndVerifyClosingExcelToDrive({
      token: VALID_TOKEN,
      org: testOrg,
      branch: testBranch,
      closing: closingV1,
      revision: 1,
      excelPayload: payloadV1,
    });

    assert.equal(uploadV1.revision, 1);
    assert.equal(uploadV1.updatedExisting, false);
    assert.equal(uploadV1.orgFolder.folderName, `AL EQFAL - ${testOrg.name} - ${testOrg.id}`);
    assert.equal(uploadV1.branchFolder.folderName, `${testBranch.name} - ${testBranch.code}`);
    assert.equal(uploadV1.monthFolder.yearMonth, '2026-11');
    assert.equal(uploadV1.monthFolder.branchId, testBranch.id);
    assert.ok(
      mockDrive.items.get(uploadV1.monthFolder.folderId)?.parents.includes(uploadV1.branchFolder.folderId)
    );

    console.log('4. Verifying Retry Idempotency (No Duplicate Drive Files Created)...');
    const retryV1 = await uploadAndVerifyClosingExcelToDrive({
      token: VALID_TOKEN,
      org: testOrg,
      branch: testBranch,
      closing: closingV1,
      revision: 1,
      excelPayload: payloadV1,
    });
    assert.equal(retryV1.fileId, uploadV1.fileId);
    assert.equal(retryV1.updatedExisting, true);

    const filesInMonthFolder = Array.from(mockDrive.items.values()).filter((it) =>
      it.parents.includes(uploadV1.monthFolder.folderId)
    );
    assert.equal(filesInMonthFolder.length, 1);

    console.log('5. Verifying Mandatory Failure Gate: Corrupted Read-Back Blocks archived State...');
    mockDrive.setCorruptNextAltMedia(true);
    await assert.rejects(
      () =>
        uploadAndVerifyClosingExcelToDrive({
          token: VALID_TOKEN,
          org: testOrg,
          branch: testBranch,
          closing: closingV1,
          revision: 1,
          excelPayload: payloadV1,
        }),
      /SHA-256/
    );

    // Re-run clean upload so stored v1 bytes on mock server are healthy again
    await uploadAndVerifyClosingExcelToDrive({
      token: VALID_TOKEN,
      org: testOrg,
      branch: testBranch,
      closing: closingV1,
      revision: 1,
      excelPayload: payloadV1,
    });

    console.log('6. Simulating Admin Correction (0.1 + 0.2 = 0.30) & Downloading Original v1 via alt=media...');
    const halala = calculateShiftTotals(0.1, 0.2, 0.05);
    const closingV2: ShiftClosing = {
      ...closingV1,
      cashSales: halala.cashSales,
      cardSales: halala.cardSales,
      expenses: halala.expenses,
      totalSales: halala.totalSales,
      remainingInBox: halala.remainingInBox,
      netPeriod: halala.netPeriod,
      correctedBy: testOrg.ownerId,
      correctedByName: testOrg.ownerName,
      correctedAt: '2026-11-14T16:30:00.000Z',
      updatedAt: '2026-11-14T16:30:00.000Z',
    };

    const staleArchiveV1: ClosingArchiveRecord = {
      closingId: closingV1.id,
      orgId: testOrg.id,
      branchId: testBranch.id,
      yearMonth: '2026-11',
      archiveStatus: 'stale',
      driveExcelFileId: uploadV1.fileId,
      driveExcelFileName: uploadV1.fileName,
      driveExcelWebViewLink: uploadV1.webViewLink,
      driveMonthFolderId: uploadV1.monthFolder.folderId,
      drivePayloadHash: uploadV1.payloadHash,
      driveRevision: 1,
      sourceCorrectionAt: closingV2.correctedAt,
      archivedAt: uploadV1.verifiedAt,
      archivedBy: testOrg.ownerId,
      updatedAt: closingV2.correctedAt!,
    };

    const downloadedOriginalV1 = await downloadOriginalClosingExcelFromDrive({
      token: VALID_TOKEN,
      org: testOrg,
      closing: closingV2,
      archiveRecord: staleArchiveV1,
    });
    assert.equal(downloadedOriginalV1.verified, true);
    assert.equal(downloadedOriginalV1.fileId, uploadV1.fileId);
    assert.equal(downloadedOriginalV1.revision, 1);
    assert.deepEqual(Buffer.from(downloadedOriginalV1.bytes), Buffer.from(payloadV1.bytes));

    console.log('7. Uploading & Verifying Re-Archived v2 Workbook as Independent File...');
    const payloadV2 = await generateClosingExcelWorkbook({
      closing: closingV2,
      org: testOrg,
      branch: testBranch,
      revision: 2,
    });
    const uploadV2 = await uploadAndVerifyClosingExcelToDrive({
      token: VALID_TOKEN,
      org: testOrg,
      branch: testBranch,
      closing: closingV2,
      revision: 2,
      excelPayload: payloadV2,
      forbiddenPreviousFileId: uploadV1.fileId,
    });
    assert.notEqual(uploadV2.fileId, uploadV1.fileId);
    assert.equal(uploadV2.revision, 2);

    const finalFilesInMonth = Array.from(mockDrive.items.values()).filter((it) =>
      it.parents.includes(uploadV1.monthFolder.folderId)
    );
    assert.equal(finalFilesInMonth.length, 2);

    console.log('ALL 7 DRIVE E2E INTEGRATION & SECURITY GUARD TESTS PASSED.');
  } finally {
    globalThis.fetch = originalFetch;
    await mockDrive.close();
  }
}

runDriveIntegrationTests().catch((err) => {
  console.error('DRIVE INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
