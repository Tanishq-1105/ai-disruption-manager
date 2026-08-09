import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDisruptions } from '../src/agent/detection.js';

function trip(nodes) {
  return { id: 'trip-1', nodes };
}

test('flags an explicitly cancelled flight', () => {
  const t = trip([{ id: 'f1', type: 'FLIGHT', status: 'CANCELLED', dependsOn: [] }]);

  const events = detectDisruptions(t);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'CANCELLATION');
  assert.equal(events[0].nodeId, 'f1');
});

test('flags a connection that has become impossible', () => {
  const t = trip([
    {
      id: 'f1',
      type: 'FLIGHT',
      status: 'CONFIRMED',
      scheduledArrival: '2026-08-09T16:00:00Z',
      projectedArrival: '2026-08-09T17:00:00Z',
      dependsOn: [],
    },
    {
      id: 'f2',
      type: 'FLIGHT',
      status: 'CONFIRMED',
      scheduledDeparture: '2026-08-09T17:20:00Z',
      dependsOn: ['f1'],
    },
  ]);

  const events = detectDisruptions(t);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'CONNECTION_AT_RISK');
  assert.equal(events[0].nodeId, 'f2');
  assert.equal(events[0].upstreamNodeId, 'f1');
});

test('does not flag a connection with enough buffer', () => {
  const t = trip([
    { id: 'f1', type: 'FLIGHT', status: 'CONFIRMED', scheduledArrival: '2026-08-09T16:00:00Z', dependsOn: [] },
    { id: 'f2', type: 'FLIGHT', status: 'CONFIRMED', scheduledDeparture: '2026-08-09T17:30:00Z', dependsOn: ['f1'] },
  ]);

  assert.deepEqual(detectDisruptions(t), []);
});

test('skips the connection check once the upstream leg already has its own cancellation event', () => {
  const t = trip([
    { id: 'f1', type: 'FLIGHT', status: 'CANCELLED', dependsOn: [] },
    { id: 'f2', type: 'FLIGHT', status: 'CONFIRMED', scheduledDeparture: '2026-08-09T17:00:00Z', dependsOn: ['f1'] },
  ]);

  const events = detectDisruptions(t);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'CANCELLATION');
});

test('ignores non-flight nodes entirely', () => {
  const t = trip([{ id: 'hotel-1', type: 'HOTEL', status: 'CONFIRMED', dependsOn: [] }]);

  assert.deepEqual(detectDisruptions(t), []);
});
