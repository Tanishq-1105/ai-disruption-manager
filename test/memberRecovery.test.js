import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as recoveryAttempts from '../src/store/recoveryAttempts.js';
import { closeMongo } from '../src/store/mongo.js';
import { getMemberRecoveryStatus, recoverMemberTrip } from '../src/bookings/memberRecovery.js';

beforeEach(() => recoveryAttempts._resetForTests());
after(() => closeMongo());

const passenger = {
  title: 'mr',
  gender: 'm',
  given_name: 'Test',
  family_name: 'Traveller',
  born_on: '1990-01-01',
  email: 'test@example.com',
  phone_number: '+442080160509',
};

const originalFlight = {
  id: 'off_original',
  offerId: 'off_original',
  airline: 'ZZ',
  flightNumber: 'ZZ123',
  origin: 'JFK',
  destination: 'LAX',
  departureTime: '2030-01-02T10:00:00',
  arrivalTime: '2030-01-02T13:00:00',
  cabin: 'ECONOMY',
  refundable: true,
  segments: [{
    airline: 'ZZ',
    flightNumber: 'ZZ123',
    origin: 'JFK',
    destination: 'LAX',
    departureTime: '2030-01-02T10:00:00',
    arrivalTime: '2030-01-02T13:00:00',
    departureOffsetHours: -5,
    arrivalOffsetHours: -8,
  }],
  price: { amount: 210, currency: 'EUR' },
};

function makeDependencies({ recoveryAttempts: attemptStore = recoveryAttempts, runRecovery }) {
  const memberTrip = {
    id: 'member-trip-1',
    userId: 'member-1',
    status: 'CONFIRMED',
    orderId: 'ord_original',
    bookingReference: 'ORIGINAL',
    updatedAt: '2030-01-01T00:00:00.000Z',
    quote: { offerId: 'off_original', flight: originalFlight, total: originalFlight.price },
    total: originalFlight.price,
    passenger,
  };
  const orderCalls = [];
  const lookups = [];
  const memberTrips = {
    async getById(userId, id) {
      return userId === memberTrip.userId && id === memberTrip.id
        ? structuredClone(memberTrip) : null;
    },
    async replaceConfirmedOrder(userId, id, expectedOrderId, expectedRevision, fields) {
      if (userId !== memberTrip.userId || id !== memberTrip.id
          || memberTrip.orderId !== expectedOrderId || memberTrip.updatedAt !== expectedRevision) return null;
      Object.assign(memberTrip, structuredClone(fields), { updatedAt: new Date().toISOString() });
      return structuredClone(memberTrip);
    },
  };
  const provider = {
    seedTrip: () => ({}),
    cancelNode: () => ({}),
    delayFlight: () => ({}),
    async bookFlight(args) {
      orderCalls.push(args);
      return {
        id: `ord_replacement_${orderCalls.length}`,
        status: 'CONFIRMED',
        sandbox: true,
        metadata: {
          tripshield_booking_id: memberTrip.id,
          tripshield_recovery_key: args.idempotencyKey,
        },
        option: args.option,
        total: args.option.price,
        bookingReference: 'REPLACEMENT',
      };
    },
    async findRecoveryBooking(args) {
      lookups.push(args);
      return {
        id: 'ord_replacement_1',
        status: 'CONFIRMED',
        sandbox: true,
        metadata: {
          tripshield_booking_id: memberTrip.id,
          tripshield_recovery_key: args.idempotencyKey,
        },
        option: args.option,
        total: args.option.price,
        bookingReference: 'REPLACEMENT',
      };
    },
  };
  const dependencies = {
    provider,
    memberTrips,
    recoveryAttempts: attemptStore,
    search: { async searchFlights() { assert.fail('resume must not search'); } },
    audit: {
      async recordEntries() {
        return { recoveryId: 'audit-1', persisted: true };
      },
    },
    config: { policy: { costCap: { amount: 300, currency: 'EUR' } } },
    runRecovery,
  };
  return { dependencies, memberTrip, orderCalls, lookups, provider };
}

async function seedDisruption() {
  return recoveryAttempts.createSimulationAttempt({
    memberTripId: 'member-trip-1',
    userId: 'member-1',
    originalOrderId: 'ord_original',
    flight: originalFlight,
    disruption: { type: 'CANCELLED', minutes: null },
  });
}

function replacementOption() {
  return {
    ...structuredClone(originalFlight),
    id: 'off_replacement',
    offerId: 'off_replacement',
    flightNumber: 'ZZ456',
    departureTime: '2030-01-02T11:00:00',
    arrivalTime: '2030-01-02T14:00:00',
    segments: [{
      ...originalFlight.segments[0],
      flightNumber: 'ZZ456',
      departureTime: '2030-01-02T11:00:00',
      arrivalTime: '2030-01-02T14:00:00',
    }],
    price: { amount: 220, currency: 'EUR' },
  };
}

test('uncertain POST resumes by read-only lookup and updates the owned trip once', async () => {
  const attempt = await seedDisruption();
  const option = replacementOption();
  const prepared = {
    option,
    amount: '220.00',
    currency: 'EUR',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    version: 'quote-version-1',
  };
  const idempotencyKey = 'recovery-key-stable';
  let runCount = 0;
  const { dependencies, memberTrip, orderCalls, lookups } = makeDependencies({
    runRecovery: async args => {
      runCount++;
      if (!args.durableRecovery.resumeOnly) {
        await args.durableRecovery.checkpoint('AUTHORIZED', {
          authorizedOption: option,
          preparedQuote: prepared,
          idempotencyKey,
        }, { action: 'CANDIDATE_AUTHORIZED', optionId: option.id, idempotencyKey });
        await args.durableRecovery.checkpoint('BOOKING_REQUESTED', {}, {
          action: 'BOOKING_REQUESTED', optionId: option.id, idempotencyKey,
        });
        await args.provider.bookFlight({ option, prepared, idempotencyKey });
        throw new Error('simulated process loss after order POST');
      }

      assert.equal(args.durableRecovery.record.state, 'RECONCILING');
      assert.equal(args.durableRecovery.record.idempotencyKey, idempotencyKey);
      const order = await args.provider.findRecoveryBooking({ option, idempotencyKey });
      assert.ok(order);
      await args.durableRecovery.checkpoint('NEW_CONFIRMED', { newOrderId: order.id }, {
        action: 'NEW_CONFIRMED', bookingId: order.id,
      });
      await args.durableRecovery.checkpoint('OLD_RELEASE_PENDING', {}, {
        action: 'OLD_RELEASE_PENDING', bookingId: 'ord_original',
      });
      await args.durableRecovery.checkpoint('OLD_RELEASED', { oldReleaseOutcome: 'OLD_RELEASED' }, {
        action: 'RELEASE_OLD', bookingId: 'ord_original', outcome: 'OLD_RELEASED',
      });
      return {
        audit: [],
        recoveries: [{
          execution: {
            status: 'RECOVERED',
            bookingId: order.id,
            bookingReference: order.bookingReference,
            option,
            total: order.total,
          },
          message: { body: 'Replacement confirmed.' },
        }],
      };
    },
  });

  const first = await recoverMemberTrip({
    userId: 'member-1', memberTripId: memberTrip.id, dependencies,
  });
  assert.equal(first.status, 'REVIEW_REQUIRED');
  assert.equal(orderCalls.length, 1);
  assert.equal(orderCalls[0].idempotencyKey, idempotencyKey);
  assert.equal(memberTrip.orderId, 'ord_original');

  const resumed = await recoverMemberTrip({
    userId: 'member-1', memberTripId: memberTrip.id, dependencies,
  });
  assert.equal(resumed.status, 'RECOVERED');
  assert.equal(resumed.updatedBooking.orderId, 'ord_replacement_1');
  assert.equal(memberTrip.orderId, 'ord_replacement_1');
  assert.equal(orderCalls.length, 1, 'uncertain requests are never POSTed again');
  assert.equal(lookups.length, 1, 'reconciliation uses one read-only lookup');
  assert.equal(runCount, 2);

  const storedAttempt = await recoveryAttempts.getByKey(attempt.recoveryKey);
  assert.equal(storedAttempt.state, 'COMPLETED');
  assert.deepEqual(storedAttempt.events.map(event => event.sequence),
    storedAttempt.events.map((_, index) => index));
});

test('audit-write failure after release resumes the saved order without another POST', async () => {
  await seedDisruption();
  const option = replacementOption();
  const idempotencyKey = 'audit-retry-key';
  const { dependencies, memberTrip, orderCalls, lookups } = makeDependencies({
    runRecovery: async args => {
      let order;
      if (args.durableRecovery.resumeOnly) {
        order = await args.provider.findRecoveryBooking({ option, idempotencyKey });
      } else {
        const prepared = {
          option,
          amount: '220.00',
          currency: 'EUR',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
        await args.durableRecovery.checkpoint('AUTHORIZED', {
          authorizedOption: option,
          preparedQuote: prepared,
          idempotencyKey,
        }, { action: 'CANDIDATE_AUTHORIZED', optionId: option.id });
        await args.durableRecovery.checkpoint('BOOKING_REQUESTED', {}, {
          action: 'BOOKING_REQUESTED', optionId: option.id,
        });
        order = await args.provider.bookFlight({ option, prepared, idempotencyKey });
        await args.durableRecovery.checkpoint('ORDER_CREATED', { newOrderId: order.id }, {
          action: 'ORDER_CREATED', bookingId: order.id,
        });
      }
      await args.durableRecovery.checkpoint('NEW_CONFIRMED', { newOrderId: order.id }, {
        action: 'NEW_CONFIRMED', bookingId: order.id,
      });
      await args.durableRecovery.checkpoint('OLD_RELEASE_PENDING', {}, {
        action: 'OLD_RELEASE_PENDING', bookingId: 'ord_original',
      });
      await args.durableRecovery.checkpoint('OLD_RELEASED', { oldReleaseOutcome: 'OLD_RELEASED' }, {
        action: 'RELEASE_OLD', bookingId: 'ord_original', outcome: 'OLD_RELEASED',
      });
      return {
        audit: [],
        recoveries: [{
          execution: {
            status: 'RECOVERED',
            bookingId: order.id,
            bookingReference: order.bookingReference,
            option,
            total: order.total,
          },
          message: { body: 'Replacement confirmed.' },
        }],
      };
    },
  });

  let auditWrites = 0;
  dependencies.audit.recordEntries = async () => {
    auditWrites++;
    if (auditWrites === 1) throw new Error('simulated audit database outage');
    return { recoveryId: 'audit-retried', persisted: true };
  };
  const first = await recoverMemberTrip({
    userId: 'member-1', memberTripId: memberTrip.id, dependencies,
  });
  assert.equal(first.status, 'REVIEW_REQUIRED');
  assert.equal(memberTrip.orderId, 'ord_original');
  assert.equal(orderCalls.length, 1);

  const resumed = await recoverMemberTrip({
    userId: 'member-1', memberTripId: memberTrip.id, dependencies,
  });
  assert.equal(resumed.status, 'RECOVERED');
  assert.equal(memberTrip.orderId, 'ord_replacement_1');
  assert.equal(orderCalls.length, 1);
  assert.equal(lookups.length, 1);
  assert.equal(auditWrites, 2);
});

test('member-trip compare-and-set conflict never overwrites a newer saved booking', async () => {
  await seedDisruption();
  const option = replacementOption();
  let memberTrip;
  let runnerCalls = 0;
  const context = makeDependencies({
    runRecovery: async args => {
      runnerCalls++;
      const prepared = {
        option,
        amount: '220.00',
        currency: 'EUR',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      const idempotencyKey = 'cas-conflict-key';
      await args.durableRecovery.checkpoint('AUTHORIZED', {
        authorizedOption: option,
        preparedQuote: prepared,
        idempotencyKey,
      }, { action: 'CANDIDATE_AUTHORIZED', optionId: option.id });
      await args.durableRecovery.checkpoint('BOOKING_REQUESTED', {}, {
        action: 'BOOKING_REQUESTED', optionId: option.id,
      });
      const order = await args.provider.bookFlight({ option, prepared, idempotencyKey });
      await args.durableRecovery.checkpoint('ORDER_CREATED', { newOrderId: order.id }, {
        action: 'ORDER_CREATED', bookingId: order.id,
      });
      await args.durableRecovery.checkpoint('NEW_CONFIRMED', {}, {
        action: 'NEW_CONFIRMED', bookingId: order.id,
      });
      await args.durableRecovery.checkpoint('OLD_RELEASE_PENDING', {}, {
        action: 'OLD_RELEASE_PENDING', bookingId: 'ord_original',
      });
      await args.durableRecovery.checkpoint('OLD_RELEASED', { oldReleaseOutcome: 'OLD_RELEASED' }, {
        action: 'RELEASE_OLD', bookingId: 'ord_original', outcome: 'OLD_RELEASED',
      });
      memberTrip.orderId = 'ord_concurrent_update';
      memberTrip.bookingReference = 'NEWER_BOOKING';
      return {
        audit: [],
        recoveries: [{
          execution: {
            status: 'RECOVERED',
            bookingId: order.id,
            bookingReference: order.bookingReference,
            option,
            total: order.total,
          },
        }],
      };
    },
  });
  memberTrip = context.memberTrip;

  const first = await recoverMemberTrip({
    userId: 'member-1', memberTripId: memberTrip.id, dependencies: context.dependencies,
  });
  assert.equal(first.status, 'MEMBER_TRIP_CONFLICT');
  assert.equal(memberTrip.orderId, 'ord_concurrent_update');
  assert.equal(memberTrip.bookingReference, 'NEWER_BOOKING');
  assert.equal(context.orderCalls.length, 1);

  const second = await recoverMemberTrip({
    userId: 'member-1', memberTripId: memberTrip.id, dependencies: context.dependencies,
  });
  assert.equal(second.status, 'MEMBER_TRIP_CONFLICT');
  assert.equal(memberTrip.orderId, 'ord_concurrent_update');
  assert.equal(context.orderCalls.length, 1);
  assert.equal(runnerCalls, 1, 'conflicted recovery is terminal and never searches or orders again');

  const savedAttempt = await recoveryAttempts.getByKey((await recoveryAttempts.getLatestForMemberTrip({
    memberTripId: memberTrip.id,
    userId: 'member-1',
  })).recoveryKey);
  assert.equal(savedAttempt.state, 'MEMBER_TRIP_CONFLICT');
});

test('member recovery status publishes a redacted durable event timeline', async () => {
  const attempt = await seedDisruption();
  await recoveryAttempts.claim(attempt.recoveryKey, 'worker');
  await recoveryAttempts.checkpoint(attempt.recoveryKey, 'worker', 'BOOKING_REQUESTED', {}, {
    action: 'BOOKING_REQUESTED',
    detail: 'request started',
    idempotencyKey: 'must-not-leak',
    passenger: passenger.email,
  });
  await recoveryAttempts.releaseClaim(attempt.recoveryKey, 'worker');

  const status = await getMemberRecoveryStatus({
    userId: 'member-1',
    memberTripId: 'member-trip-1',
  });
  assert.equal(status.events.length, 2);
  assert.equal(status.events[1].action, 'BOOKING_REQUESTED');
  assert.equal(status.events[1].detail, 'request started');
  assert.equal('idempotencyKey' in status.events[1], false);
  assert.equal('passenger' in status.events[1], false);
  assert.equal(await getMemberRecoveryStatus({
    userId: 'another-member',
    memberTripId: 'member-trip-1',
  }), null);
});
