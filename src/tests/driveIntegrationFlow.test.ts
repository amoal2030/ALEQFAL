/**
 * End-to-End Google Drive Integration & Security Guard Verification Suite
 * ----------------------------------------------------------------------
 * Executes real production code in `driveService.ts` and `excelReportService.ts`
 * against a local in-process Google Drive v3 + OAuth UserInfo HTTP test server
 * (no live/production Google accounts, tokens, or Firestore data used).
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Branch, ClosingArchiveRecord, Organization, ShiftClosing, UserProfile } from '../types';
import { calculateShiftTotals } from '../utils/accounting';
import {
  assertDriveSessionMatchesAccount,
  assertOrgDriveAuthorizationEligibility,
  clearDriveSession,
  downloadOriginalClosingExcelFromDrive,
  DriveTokenSession,
  ensureBranchMonthDriveFolder,
  evaluateOrgDriveReadiness,
  getActiveDriveSession,
  isOAuthCancellationOrConfigError,
  provisionOrganizationDriveHierarchy,
  requestDriveAuthorization,
  uploadAndVerifyClosingExcelToDrive,
} from '../services/driveService';
import { generateClosingExcelWorkbook } from '../services/excelReportService';

interface StoredDriveItem {
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

interface MockTokenUserInfo {
  sub: string;
  email: string;
  name: string;
  email_verified: boolean;
}

const VALID_TOKEN = 'ram_only_test_access_token_xyz';
const TOKEN_ORG_1 = 'ram_only_token_org_01_alpha';
const TOKEN_ORG_2 = 'ram_only_token_org_02_beta';
const TOKEN_UNVERIFIED = 'ram_only_token_unverified';
const TOKEN_INTRUDER = 'ram_only_token_intruder';

const MOCK_TOKEN_ACCOUNTS: Record<string, MockTokenUserInfo> = {
  [VALID_TOKEN]: {
    sub: 'google_uid_owner_01',
    email: 'owner.test@example.com',
    name: 'مالك التجربة',
    email_verified: true,
  },
  [TOKEN_ORG_1]: {
    sub: 'google_sub_org_01',
    email: 'owner.org1@example.com',
    name: 'مالك المؤسسة الأولى',
    email_verified: true,
  },
  [TOKEN_ORG_2]: {
    sub: 'google_sub_org_02',
    email: 'owner.org2@example.com',
    name: 'مالك المؤسسة الثانية',
    email_verified: true,
  },
  [TOKEN_UNVERIFIED]: {
    sub: 'google_sub_org_02',
    email: 'owner.org2@example.com',
    name: 'حساب غير موثق',
    email_verified: false,
  },
  [TOKEN_INTRUDER]: {
    sub: 'google_sub_intruder',
    email: 'intruder@example.com',
    name: 'حساب مختلف',
    email_verified: true,
  },
};

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
  const jsonBytes = part1.subarray(sep1 + 4, part1.length - 2);
  const metadata = JSON.parse(jsonBytes.toString('utf8'));

  const sep2 = part2.indexOf(Buffer.from('\r\n\r\n'));
  const mediaBytes = part2.subarray(sep2 + 4, part2.length - 2);

  return { metadata, mediaBytes: Buffer.from(mediaBytes) };
}

async function startMockDriveV3Server() {
  const items = new Map<string, StoredDriveItem>();
  let seq = 1000;
  let corruptNextAltMedia = false;

  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const account = MOCK_TOKEN_ACCOUNTS[bearer];

    if (!account) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }));
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');

    // GET /oauth2/v3/userinfo
    if (req.method === 'GET' && reqUrl.pathname === '/oauth2/v3/userinfo') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(account));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);

      // GET /drive/v3/files (Search scoped strictly to authenticated Google account's My Drive)
      if (req.method === 'GET' && reqUrl.pathname === '/drive/v3/files') {
        const q = reqUrl.searchParams.get('q') || '';
        const filters = parseQueryStringFilters(q);
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
          ownerSub: account.sub,
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
          ownerSub: account.sub,
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
        if (!existing || existing.ownerSub !== account.sub) {
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
        if (!item || item.ownerSub !== account.sub) {
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

function installMockGisBrowser(
  behaviorProvider: () => {
    mode: 'token' | 'callback_error' | 'error_callback';
    accessToken?: string;
    expiresIn?: number;
    error?: string;
    errorType?: string;
    capturedConfig?: any;
  }
) {
  (globalThis as any).window = {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: any) => ({
            requestAccessToken: (_opts: any) => {
              const plan = behaviorProvider();
              plan.capturedConfig = config;
              setTimeout(() => {
                if (plan.mode === 'token') {
                  config.callback({
                    access_token: plan.accessToken,
                    expires_in: plan.expiresIn ?? 3600,
                  });
                } else if (plan.mode === 'callback_error') {
                  config.callback({
                    error: plan.error || 'access_denied',
                    error_description: plan.error || 'access_denied',
                  });
                } else {
                  config.error_callback({
                    type: plan.errorType || 'popup_closed',
                  });
                }
              }, 0);
            },
          }),
        },
      },
    },
  };
}

async function runDriveIntegrationTests() {
  const mockDrive = await startMockDriveV3Server();
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;
  const prevClientId = process.env.VITE_GOOGLE_DRIVE_CLIENT_ID;

  // Intercept ONLY googleapis Drive & OAuth UserInfo calls toward our local HTTP test server
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
      orgId: 'org_drive_test',
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
      orgId: 'org_drive_test',
      googleUid: 'google_uid_owner_01',
      email: 'owner.test@example.com',
      linkedSub: 'google_uid_owner_01',
      linkedEmail: 'owner.test@example.com',
    });
    assert.equal(verifiedSession.accessToken, VALID_TOKEN);

    assert.throws(
      () =>
        assertDriveSessionMatchesAccount(ownerSession, {
          orgId: 'org_drive_test',
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
            orgId: 'org_drive_test',
            googleUid: 'google_uid_owner_01',
            email: 'owner.test@example.com',
          }
        ),
      /انتهت صلاحية/
    );
    clearDriveSession();
    assert.equal(getActiveDriveSession('org_drive_test'), null);
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

    const authCtxSource = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
    const settingsSource = fs.readFileSync('src/components/manager/SettingsView.tsx', 'utf8');
    const dashboardSource = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');
    const closingsReviewSource = fs.readFileSync('src/components/manager/ClosingsReview.tsx', 'utf8');
    const driveSvcSource = fs.readFileSync('src/services/driveService.ts', 'utf8');

    assert.match(authCtxSource, /currentUser\.uid !== currentOrg\.ownerId/);
    assert.match(authCtxSource, /userProfile\.role !== 'manager'/);
    assert.equal(/\b(localStorage|sessionStorage)\s*\./.test(driveSvcSource), false);
    assert.equal(/\b(localStorage|sessionStorage)\s*\./.test(authCtxSource), false);
    assert.equal(/\b(localStorage|sessionStorage)\s*\./.test(settingsSource), false);

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

    // =========================================================================
    // NEW MULTI-ORG & OAUTH LIFECYCLE TESTS (Tests 8 - 12)
    // =========================================================================
    console.log('8. Testing Two Independent Organizations Connecting Their Own Google Drives...');
    process.env.VITE_GOOGLE_DRIVE_CLIENT_ID = 'multi-org-test-client-id.apps.googleusercontent.com';
    let gisBehavior: {
      mode: 'token' | 'callback_error' | 'error_callback';
      accessToken?: string;
      expiresIn?: number;
      error?: string;
      errorType?: string;
      capturedConfig?: any;
    } = { mode: 'token', accessToken: TOKEN_ORG_1, expiresIn: 3600 };

    installMockGisBrowser(() => gisBehavior);

    const org1: Organization = {
      id: 'org_multi_01',
      name: 'مؤسسة الشمال التجارية',
      activityType: 'restaurant',
      currency: 'SAR',
      ownerId: 'uid_owner_org1',
      ownerEmail: 'owner.org1@example.com',
      ownerName: 'مالك المؤسسة الأولى',
      driveConnected: false,
      driveWriteVerified: false,
      driveLastHealthStatus: 'untested',
      createdAt: '2026-11-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    };
    const branchOrg1: Branch = {
      id: 'br_multi_01',
      orgId: org1.id,
      name: 'فرع الرياض',
      code: 'RYD1',
      isActive: true,
      createdAt: '2026-11-01T08:00:00.000Z',
    };
    const owner1Profile: UserProfile = {
      uid: org1.ownerId,
      orgId: org1.id,
      email: org1.ownerEmail,
      displayName: org1.ownerName,
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
      createdAt: '2026-11-01T08:00:00.000Z',
    };

    const org2: Organization = {
      id: 'org_multi_02',
      name: 'مؤسسة الجنوب للتموينات',
      activityType: 'supermarket',
      currency: 'SAR',
      ownerId: 'uid_owner_org2',
      ownerEmail: 'owner.org2@example.com',
      ownerName: 'مالك المؤسسة الثانية',
      driveConnected: false,
      driveWriteVerified: false,
      driveLastHealthStatus: 'untested',
      createdAt: '2026-11-02T08:00:00.000Z',
      updatedAt: '2026-11-02T08:00:00.000Z',
    };
    const branchOrg2: Branch = {
      id: 'br_multi_02',
      orgId: org2.id,
      name: 'فرع جدة',
      code: 'JED1',
      isActive: true,
      createdAt: '2026-11-02T08:00:00.000Z',
    };
    const owner2Profile: UserProfile = {
      uid: org2.ownerId,
      orgId: org2.id,
      email: org2.ownerEmail,
      displayName: org2.ownerName,
      role: 'manager',
      isActive: true,
      permissions: owner1Profile.permissions,
      createdAt: '2026-11-02T08:00:00.000Z',
    };

    // Org 1 OAuth & Folder Provisioning
    const elig1 = assertOrgDriveAuthorizationEligibility({
      currentUserUid: org1.ownerId,
      userProfile: owner1Profile,
      org: org1,
      googleUid: 'google_sub_org_01',
      ownerEmail: org1.ownerEmail,
    });
    gisBehavior = { mode: 'token', accessToken: TOKEN_ORG_1, expiresIn: 3600 };
    const sessionOrg1 = await requestDriveAuthorization({
      orgId: elig1.orgId,
      googleUid: elig1.googleUid,
      email: elig1.ownerEmail,
      linkedAccount: elig1.linkedAccount,
    });
    assert.equal(sessionOrg1.orgId, org1.id);
    assert.equal(sessionOrg1.email, org1.ownerEmail);
    assert.equal(getActiveDriveSession(org1.id)?.accessToken, TOKEN_ORG_1);
    assert.equal(getActiveDriveSession(org2.id), null);

    // Org 2 OAuth & Folder Provisioning (no single-org or static-account block!)
    const elig2 = assertOrgDriveAuthorizationEligibility({
      currentUserUid: org2.ownerId,
      userProfile: owner2Profile,
      org: org2,
      googleUid: 'google_sub_org_02',
      ownerEmail: org2.ownerEmail,
    });
    gisBehavior = { mode: 'token', accessToken: TOKEN_ORG_2, expiresIn: 3600 };
    const sessionOrg2 = await requestDriveAuthorization({
      orgId: elig2.orgId,
      googleUid: elig2.googleUid,
      email: elig2.ownerEmail,
      linkedAccount: elig2.linkedAccount,
    });
    assert.equal(sessionOrg2.orgId, org2.id);
    assert.equal(sessionOrg2.email, org2.ownerEmail);
    assert.equal(getActiveDriveSession(org1.id)?.accessToken, TOKEN_ORG_1);
    assert.equal(getActiveDriveSession(org2.id)?.accessToken, TOKEN_ORG_2);
    assert.equal(getActiveDriveSession(), null);

    const provOrg1 = await provisionOrganizationDriveHierarchy({
      token: sessionOrg1.accessToken,
      org: org1,
      branches: [branchOrg1],
      yearMonth: '2026-11',
    });
    const provOrg2 = await provisionOrganizationDriveHierarchy({
      token: sessionOrg2.accessToken,
      org: org2,
      branches: [branchOrg2],
      yearMonth: '2026-11',
    });
    assert.notEqual(provOrg1.orgFolder.folderId, provOrg2.orgFolder.folderId);
    assert.equal(mockDrive.items.get(provOrg1.orgFolder.folderId)?.ownerSub, 'google_sub_org_01');
    assert.equal(mockDrive.items.get(provOrg2.orgFolder.folderId)?.ownerSub, 'google_sub_org_02');

    const closingOrg2: ShiftClosing = {
      ...closingV1,
      id: 'cls_multi_org2_01',
      orgId: org2.id,
      branchId: branchOrg2.id,
      branchName: branchOrg2.name,
      reviewedBy: org2.ownerId,
      reviewedByName: org2.ownerName,
    };
    const payloadOrg2 = await generateClosingExcelWorkbook({
      closing: closingOrg2,
      org: org2,
      branch: branchOrg2,
      revision: 1,
    });
    const uploadOrg2 = await uploadAndVerifyClosingExcelToDrive({
      token: sessionOrg2.accessToken,
      org: org2,
      branch: branchOrg2,
      closing: closingOrg2,
      revision: 1,
      excelPayload: payloadOrg2,
    });
    assert.equal(mockDrive.items.get(uploadOrg2.fileId)?.ownerSub, 'google_sub_org_02');

    console.log('9. Testing Cross-Organization Isolation & Switching Without Session Leakage...');
    // Org 1 token/session MUST be rejected when asserted against Org 2
    assert.throws(
      () =>
        assertDriveSessionMatchesAccount(sessionOrg1, {
          orgId: org2.id,
          googleUid: 'google_sub_org_02',
          email: org2.ownerEmail,
        }),
      /مؤسسة أخرى/
    );
    // Note: failing assertDriveSessionMatchesAccount for org2 must clear org2 without breaking org1's session
    assert.equal(getActiveDriveSession(org1.id)?.accessToken, TOKEN_ORG_1);
    assert.equal(getActiveDriveSession(org2.id), null);

    // Org 1 CANNOT provision, upload, or download Org 2's branches/closings/archives
    await assert.rejects(
      () =>
        provisionOrganizationDriveHierarchy({
          token: sessionOrg1.accessToken,
          org: org1,
          branches: [branchOrg2],
          yearMonth: '2026-11',
        }),
      /رفض عزل المؤسسات/
    );
    await assert.rejects(
      () =>
        ensureBranchMonthDriveFolder({
          token: sessionOrg1.accessToken,
          org: org1,
          branch: branchOrg2,
          yearMonth: '2026-11',
        }),
      /رفض عزل المؤسسات/
    );
    await assert.rejects(
      () =>
        uploadAndVerifyClosingExcelToDrive({
          token: sessionOrg1.accessToken,
          org: org1,
          branch: branchOrg1,
          closing: closingOrg2,
          revision: 1,
          excelPayload: payloadOrg2,
        }),
      /رفض عزل المؤسسات/
    );
    await assert.rejects(
      () =>
        downloadOriginalClosingExcelFromDrive({
          token: sessionOrg1.accessToken,
          org: org1,
          closing: closingOrg2,
          archiveRecord: {
            closingId: closingOrg2.id,
            orgId: org2.id,
            branchId: branchOrg2.id,
            yearMonth: '2026-11',
            archiveStatus: 'archived',
            driveExcelFileId: uploadOrg2.fileId,
            driveExcelFileName: uploadOrg2.fileName,
            driveMonthFolderId: uploadOrg2.monthFolder.folderId,
            drivePayloadHash: uploadOrg2.payloadHash,
            driveRevision: 1,
            archivedAt: uploadOrg2.verifiedAt,
            archivedBy: org2.ownerId,
            updatedAt: uploadOrg2.verifiedAt,
          },
        }),
      /لا تطابق المؤسسة/
    );

    // Verify Org 1's Drive token receives 404 when attempting to read Org 2's Drive file ID directly
    await assert.rejects(
      () =>
        downloadOriginalClosingExcelFromDrive({
          token: sessionOrg1.accessToken,
          org: org2,
          closing: closingOrg2,
          archiveRecord: {
            closingId: closingOrg2.id,
            orgId: org2.id,
            branchId: branchOrg2.id,
            yearMonth: '2026-11',
            archiveStatus: 'archived',
            driveExcelFileId: uploadOrg2.fileId,
            driveExcelFileName: uploadOrg2.fileName,
            driveMonthFolderId: uploadOrg2.monthFolder.folderId,
            drivePayloadHash: uploadOrg2.payloadHash,
            driveRevision: 1,
            archivedAt: uploadOrg2.verifiedAt,
            archivedBy: org2.ownerId,
            updatedAt: uploadOrg2.verifiedAt,
          },
        }),
      /\[404\]/
    );

    // Switching organization clears previous org session cleanly
    clearDriveSession(org1.id);
    assert.equal(getActiveDriveSession(org1.id), null);

    // Verify UI & Context code enforce orgId-scoped Drive session reads & resets on org change
    assert.match(authCtxSource, /clearDriveSession\(prevOrgIdRef\.current\)/);
    assert.match(authCtxSource, /getActiveDriveSession\(targetOrgId\)/);
    assert.match(settingsSource, /getActiveDriveSession\(currentOrg\?\.id\)/);
    assert.match(dashboardSource, /getActiveDriveSession\(currentOrg\?\.id\)/);
    assert.match(closingsReviewSource, /useEffect\(\(\)\s*=>\s*\{[\s\S]*setActiveClosing\(null\)[\s\S]*\},\s*\[currentOrg\?\.id\]\)/);

    console.log('10. Testing Role Guards (Employees & Non-Owner Managers Blocked)...');
    const employeeProfile: UserProfile = {
      ...owner1Profile,
      uid: 'uid_emp_org1',
      email: 'cashier1@example.com',
      role: 'employee',
      branchId: branchOrg1.id,
    };
    assert.throws(
      () =>
        assertOrgDriveAuthorizationEligibility({
          currentUserUid: employeeProfile.uid,
          userProfile: employeeProfile,
          org: org1,
          googleUid: 'google_sub_emp',
          ownerEmail: employeeProfile.email,
        }),
      /لا يُسمح للموظفين/
    );
    assert.throws(
      () =>
        assertOrgDriveAuthorizationEligibility({
          currentUserUid: 'uid_co_manager',
          userProfile: { ...owner1Profile, uid: 'uid_co_manager' },
          org: org1,
          googleUid: 'google_sub_co',
          ownerEmail: 'co@example.com',
        }),
      /مالك المؤسسة المعتمد/
    );
    assert.throws(
      () =>
        assertOrgDriveAuthorizationEligibility({
          currentUserUid: org1.ownerId,
          userProfile: { ...owner1Profile, orgId: org2.id },
          org: org1,
          googleUid: 'google_sub_org_01',
          ownerEmail: org1.ownerEmail,
        }),
      /لمؤسسة أخرى/
    );

    console.log('11. Testing OAuth Rejection, Popup Errors, Account Mismatch & Non-Destructive Cancel...');
    gisBehavior = { mode: 'callback_error', error: 'access_denied' };
    await assert.rejects(
      () =>
        requestDriveAuthorization({
          orgId: org2.id,
          googleUid: 'google_sub_org_02',
          email: org2.ownerEmail,
        }),
      (err: Error) => {
        assert.match(err.message, /تم إلغاء التفويض/);
        assert.equal(isOAuthCancellationOrConfigError(err), true);
        return true;
      }
    );
    assert.equal(getActiveDriveSession(org2.id), null);

    gisBehavior = { mode: 'error_callback', errorType: 'popup_closed' };
    await assert.rejects(
      () =>
        requestDriveAuthorization({
          orgId: org2.id,
          googleUid: 'google_sub_org_02',
          email: org2.ownerEmail,
        }),
      (err: Error) => {
        assert.match(err.message, /تم إغلاق نافذة تفويض Google/);
        assert.equal(isOAuthCancellationOrConfigError(err), true);
        return true;
      }
    );

    gisBehavior = { mode: 'error_callback', errorType: 'popup_failed_to_open' };
    await assert.rejects(
      () =>
        requestDriveAuthorization({
          orgId: org2.id,
          googleUid: 'google_sub_org_02',
          email: org2.ownerEmail,
        }),
      (err: Error) => {
        assert.match(err.message, /حظر المتصفح/);
        assert.equal(isOAuthCancellationOrConfigError(err), true);
        return true;
      }
    );

    gisBehavior = { mode: 'token', accessToken: TOKEN_UNVERIFIED, expiresIn: 3600 };
    await assert.rejects(
      () =>
        requestDriveAuthorization({
          orgId: org2.id,
          googleUid: 'google_sub_org_02',
          email: org2.ownerEmail,
        }),
      /email_verified/
    );

    gisBehavior = { mode: 'token', accessToken: TOKEN_INTRUDER, expiresIn: 3600 };
    await assert.rejects(
      () =>
        requestDriveAuthorization({
          orgId: org2.id,
          googleUid: 'google_sub_org_02',
          email: org2.ownerEmail,
        }),
      (err: Error) => {
        assert.match(err.message, /الحساب المختار/);
        assert.equal(isOAuthCancellationOrConfigError(err), true);
        return true;
      }
    );

    assert.equal(isOAuthCancellationOrConfigError(new Error('[403] تم رفض الصلاحية')), false);
    assert.equal(isOAuthCancellationOrConfigError(new Error('[404] تعذر العثور على مجلد المؤسسة')), false);

    console.log('12. Testing Token Expiry, Shift Closing Approval Independence & Re-Authorization...');
    gisBehavior = { mode: 'token', accessToken: TOKEN_ORG_1, expiresIn: 3600 };
    const freshOrg1 = await requestDriveAuthorization({
      orgId: org1.id,
      googleUid: 'google_sub_org_01',
      email: org1.ownerEmail,
    });
    assert.ok(getActiveDriveSession(org1.id));

    // Simulate natural RAM token expiry
    freshOrg1.expiresAt = Date.now() - 5000;
    assert.equal(getActiveDriveSession(org1.id), null);

    // Verify closing approval flow (`reviewShiftClosing` + `ClosingsReview.handleApprove`)
    // commits approval independently without requiring a Drive OAuth token
    assert.match(
      closingsReviewSource,
      /await reviewShiftClosing\(targetId,\s*'approve'\);\s*[\s\S]*archiveClosingToDrive\(targetId,\s*\{\s*interactiveAuthIfNeeded:\s*false\s*\}\)/
    );
    const reviewFnStart = authCtxSource.indexOf('const reviewShiftClosing = async');
    const reviewFnEnd = authCtxSource.indexOf('const adminCorrectClosing = async');
    const reviewFnBody = authCtxSource.slice(reviewFnStart, reviewFnEnd);
    assert.equal(/getActiveDriveSession|requestDriveAuthorization/.test(reviewFnBody), false);

    // Owner seamlessly re-authorizes after expiry and recovers active RAM session
    const reauthorizedOrg1 = await requestDriveAuthorization({
      orgId: org1.id,
      googleUid: 'google_sub_org_01',
      email: org1.ownerEmail,
      linkedAccount: { linkedSub: 'google_sub_org_01', linkedEmail: org1.ownerEmail },
    });
    assert.equal(reauthorizedOrg1.orgId, org1.id);
    assert.equal(getActiveDriveSession(org1.id)?.accessToken, TOKEN_ORG_1);

    clearDriveSession();
    console.log('ALL 12 MULTI-ORG DRIVE E2E & OAUTH SECURITY TESTS PASSED.');
  } finally {
    if (prevClientId === undefined) {
      delete process.env.VITE_GOOGLE_DRIVE_CLIENT_ID;
    } else {
      process.env.VITE_GOOGLE_DRIVE_CLIENT_ID = prevClientId;
    }
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
    globalThis.fetch = originalFetch;
    await mockDrive.close();
  }
}

runDriveIntegrationTests().catch((err) => {
  console.error('DRIVE INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
