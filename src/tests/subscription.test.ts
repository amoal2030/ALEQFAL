/**
 * Phase 1 Unit Test Suite for Subscription Domain Logic (src/utils/subscription.ts)
 * Runs cleanly via Node / tsx without requiring Firestore Emulator or DOM.
 */
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import { Organization } from '../types';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_WHATSAPP_INTL,
  SUBSCRIPTION_WHATSAPP_LOCAL,
  buildNewSubscriptionWhatsApp,
  buildRenewalSubscriptionWhatsApp,
  calculateSubscriptionEndDate,
  evaluateOrganizationSubscription,
  toValidDate,
  validateSubscriptionDates,
} from '../utils/subscription';

const baseLegacyOrg: Organization = {
  id: 'org_legacy_001',
  name: 'مؤسسة قائمة قديمة',
  activityType: 'retail',
  currency: 'SAR',
  ownerId: 'uid_mgr_legacy',
  ownerEmail: 'legacy@example.com',
  ownerName: 'خالد التاجر',
  driveConnected: false,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

function runTests() {
  let passed = 0;
  const test = (name: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`✔ ${name}`);
  };

  // 1. Five plans exist with expected IDs
  test('Test 1: All 5 subscription plans are registered', () => {
    assert.deepEqual(
      SUBSCRIPTION_PLANS.map((p) => p.id),
      ['trial_7d', '1m', '3m', '6m', '1y']
    );
  });

  // 2. Accurate end-date calculation for all 5 plans
  test('Test 2: Accurate end-date calculation for 7d, 1m, 3m, 6m, and 1y plans', () => {
    const start = new Date('2026-11-15T10:30:00.000Z');

    assert.equal(
      calculateSubscriptionEndDate(start, 'trial_7d').toISOString(),
      '2026-11-22T10:30:00.000Z'
    );
    assert.equal(
      calculateSubscriptionEndDate(start, '1m').toISOString(),
      '2026-12-15T10:30:00.000Z'
    );
    assert.equal(
      calculateSubscriptionEndDate(start, '3m').toISOString(),
      '2027-02-15T10:30:00.000Z'
    );
    assert.equal(
      calculateSubscriptionEndDate(start, '6m').toISOString(),
      '2027-05-15T10:30:00.000Z'
    );
    assert.equal(
      calculateSubscriptionEndDate(start, '1y').toISOString(),
      '2027-11-15T10:30:00.000Z'
    );
  });

  // 3. End-of-month clamping and leap year handling
  test('Test 3: Month-end clamping and leap year handling work accurately', () => {
    const jan31 = new Date('2026-01-31T09:00:00.000Z');
    assert.equal(
      calculateSubscriptionEndDate(jan31, '1m').toISOString(),
      '2026-02-28T09:00:00.000Z'
    );

    const leapFeb29 = new Date('2024-02-29T12:00:00.000Z');
    assert.equal(
      calculateSubscriptionEndDate(leapFeb29, '1y').toISOString(),
      '2025-02-28T12:00:00.000Z'
    );

    const tsStart = Timestamp.fromDate(new Date('2026-05-31T00:00:00.000Z'));
    assert.equal(
      calculateSubscriptionEndDate(tsStart, '1m').toISOString(),
      '2026-06-30T00:00:00.000Z'
    );
  });

  // 4. Date & Firestore Timestamp conversion safety
  test('Test 4: Safe parsing of Date, Firestore Timestamp, serialized timestamp, and invalid inputs', () => {
    const d = new Date('2026-07-01T00:00:00.000Z');
    const fsTs = Timestamp.fromDate(d);
    const plainTs = { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
    const adminTs = { _seconds: Math.floor(d.getTime() / 1000), _nanoseconds: 0 };

    assert.equal(toValidDate(d)?.toISOString(), d.toISOString());
    assert.equal(toValidDate(fsTs)?.toISOString(), d.toISOString());
    assert.equal(toValidDate(plainTs)?.toISOString(), d.toISOString());
    assert.equal(toValidDate(adminTs)?.toISOString(), d.toISOString());
    assert.equal(toValidDate('2026-07-01T00:00:00.000Z')?.toISOString(), d.toISOString());

    assert.equal(toValidDate(null), null);
    assert.equal(toValidDate(undefined), null);
    assert.equal(toValidDate('not-a-date'), null);
    assert.equal(toValidDate(new Date('invalid')), null);
  });

  // 5. Validation of start and end dates
  test('Test 5: Subscription start and end date validation rejects inverted or invalid dates', () => {
    const start = Timestamp.fromDate(new Date('2026-11-01T00:00:00.000Z'));
    const endValid = Timestamp.fromDate(new Date('2026-12-01T00:00:00.000Z'));
    const endBefore = Timestamp.fromDate(new Date('2026-10-15T00:00:00.000Z'));

    const ok = validateSubscriptionDates(start, endValid);
    assert.equal(ok.isValid, true);
    assert.ok(ok.startDate);
    assert.ok(ok.endDate);

    const same = validateSubscriptionDates(start, start);
    assert.equal(same.isValid, false);
    assert.equal(same.errorCode, 'END_NOT_AFTER_START');

    const inverted = validateSubscriptionDates(start, endBefore);
    assert.equal(inverted.isValid, false);
    assert.equal(inverted.errorCode, 'END_NOT_AFTER_START');

    const badStart = validateSubscriptionDates('invalid-date', endValid);
    assert.equal(badStart.isValid, false);
    assert.equal(badStart.errorCode, 'INVALID_START');

    const badEnd = validateSubscriptionDates(start, null);
    assert.equal(badEnd.isValid, false);
    assert.equal(badEnd.errorCode, 'INVALID_END');
  });

  // 6. Legacy organization without subscription fields remains legacy_unrestricted
  test('Test 6: Legacy organization without subscription fields stays legacy_unrestricted', () => {
    const evalLegacy = evaluateOrganizationSubscription(baseLegacyOrg, new Date('2026-11-15T00:00:00.000Z'));
    assert.equal(evalLegacy.state, 'legacy_unrestricted');
    assert.equal(evalLegacy.isAllowed, true);
    assert.equal(evalLegacy.isLegacy, true);
    assert.equal(evalLegacy.endDate, null);

    // If explicitly deactivated by isActive: false, legacy org is suspended
    const disabledLegacy: Organization = { ...baseLegacyOrg, isActive: false };
    const evalDisabled = evaluateOrganizationSubscription(disabledLegacy);
    assert.equal(evalDisabled.state, 'suspended');
    assert.equal(evalDisabled.isAllowed, false);
  });

  // 7. Active, expired, and suspended subscription evaluation
  test('Test 7: Distinguishes active, expired, and suspended subscriptions accurately', () => {
    const start = Timestamp.fromDate(new Date('2026-11-01T00:00:00.000Z'));
    const end = Timestamp.fromDate(new Date('2026-12-01T00:00:00.000Z'));

    const activeOrg: Organization = {
      ...baseLegacyOrg,
      id: 'org_sub_001',
      subscriptionPlan: '1m',
      subscriptionStatus: 'active',
      subscriptionStartAt: start,
      subscriptionEndAt: end,
    };

    const duringEval = evaluateOrganizationSubscription(
      activeOrg,
      new Date('2026-11-15T00:00:00.000Z')
    );
    assert.equal(duringEval.state, 'active');
    assert.equal(duringEval.isAllowed, true);
    assert.equal(duringEval.isLegacy, false);
    assert.equal(duringEval.remainingDays, 16);

    // Past end date -> expired
    const pastEval = evaluateOrganizationSubscription(
      activeOrg,
      new Date('2026-12-01T00:00:01.000Z')
    );
    assert.equal(pastEval.state, 'expired');
    assert.equal(pastEval.isAllowed, false);
    assert.equal(pastEval.notStarted, false);
    assert.equal(pastEval.remainingDays, 0);

    // Exact end date (now === subscriptionEndAt) -> expired (matches request.time < subscriptionEndAt)
    const exactEndEval = evaluateOrganizationSubscription(
      activeOrg,
      new Date('2026-12-01T00:00:00.000Z')
    );
    assert.equal(exactEndEval.state, 'expired');
    assert.equal(exactEndEval.isAllowed, false);
    assert.equal(exactEndEval.notStarted, false);
    assert.equal(exactEndEval.remainingDays, 0);

    // Future start date (now < subscriptionStartAt) -> blocked (notStarted: true)
    const beforeStartEval = evaluateOrganizationSubscription(
      activeOrg,
      new Date('2026-10-31T23:59:59.000Z')
    );
    assert.equal(beforeStartEval.state, 'expired');
    assert.equal(beforeStartEval.isAllowed, false);
    assert.equal(beforeStartEval.notStarted, true);
    assert.equal(beforeStartEval.remainingDays, 0);

    // Explicit status suspended -> suspended even if date is in future
    const suspendedOrg: Organization = {
      ...activeOrg,
      subscriptionStatus: 'suspended',
    };
    const suspEval = evaluateOrganizationSubscription(
      suspendedOrg,
      new Date('2026-11-15T00:00:00.000Z')
    );
    assert.equal(suspEval.state, 'suspended');
    assert.equal(suspEval.isAllowed, false);

    // Explicit status expired -> expired even if date is in future
    const explicitlyExpiredOrg: Organization = {
      ...activeOrg,
      subscriptionStatus: 'expired',
    };
    const expEval = evaluateOrganizationSubscription(
      explicitlyExpiredOrg,
      new Date('2026-11-15T00:00:00.000Z')
    );
    assert.equal(expEval.state, 'expired');
    assert.equal(expEval.isAllowed, false);

    // Active status without end date fails closed as expired
    const malformedOrg: Organization = {
      ...baseLegacyOrg,
      subscriptionStatus: 'active',
    };
    const malformedEval = evaluateOrganizationSubscription(malformedOrg);
    assert.equal(malformedEval.state, 'expired');
    assert.equal(malformedEval.isAllowed, false);
  });

  // 8. WhatsApp URL and message preparation for new subscription & renewal
  test('Test 8: Builds valid WhatsApp links (966541821068) with full request and renewal details', () => {
    const newReq = buildNewSubscriptionWhatsApp({
      ownerName: 'أحمد العتيبي',
      googleEmail: 'ahmed@gmail.com',
      orgName: 'مقاهي النخبة',
      plan: 'trial_7d',
      language: 'ar',
    });

    assert.equal(newReq.phoneLocal, SUBSCRIPTION_WHATSAPP_LOCAL);
    assert.equal(newReq.phoneIntl, SUBSCRIPTION_WHATSAPP_INTL);
    assert.ok(newReq.url.startsWith('https://wa.me/966541821068?text='));

    const decodedNew = decodeURIComponent(newReq.url.split('?text=')[1]);
    assert.equal(decodedNew, newReq.message);
    assert.ok(decodedNew.includes('أحمد العتيبي'));
    assert.ok(decodedNew.includes('ahmed@gmail.com'));
    assert.ok(decodedNew.includes('مقاهي النخبة'));
    assert.ok(decodedNew.includes('تجربة مجانية لمدة 7 أيام'));

    const renewalReq = buildRenewalSubscriptionWhatsApp({
      orgName: 'مقاهي النخبة',
      orgId: 'org_elite_01',
      managerName: 'أحمد العتيبي',
      managerEmail: 'ahmed@gmail.com',
      plan: '1y',
      currentEndAt: Timestamp.fromDate(new Date('2026-11-10T00:00:00.000Z')),
      language: 'ar',
    });

    assert.ok(renewalReq.url.startsWith('https://wa.me/966541821068?text='));
    const decodedRenewal = decodeURIComponent(renewalReq.url.split('?text=')[1]);
    assert.equal(decodedRenewal, renewalReq.message);
    assert.ok(decodedRenewal.includes('مقاهي النخبة'));
    assert.ok(decodedRenewal.includes('org_elite_01'));
    assert.ok(decodedRenewal.includes('أحمد العتيبي'));
    assert.ok(decodedRenewal.includes('ahmed@gmail.com'));
    assert.ok(decodedRenewal.includes('2026-11-10'));
    assert.ok(decodedRenewal.includes('سنة كاملة'));
  });

  console.log(`\nALL ${passed} PHASE 1 SUBSCRIPTION UNIT TESTS PASSED.`);
}

runTests();
