import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseImpact } from '../src/agent/impact.js';

function trip(nodes) {
  return { id: 'trip-1', nodes };
}

test('shifts a refundable hotel that depends on the disrupted node', () => {
  const t = trip([
    { id: 'f1', type: 'FLIGHT', dependsOn: [] },
    { id: 'hotel-1', type: 'HOTEL', refundable: true, dependsOn: ['f1'] },
  ]);

  const impacts = analyseImpact(t, { nodeId: 'f1' });

  assert.deepEqual(impacts, [{ nodeId: 'hotel-1', type: 'HOTEL', action: 'SHIFT_HOTEL' }]);
});

test('escalates a non-refundable hotel', () => {
  const t = trip([
    { id: 'f1', type: 'FLIGHT', dependsOn: [] },
    { id: 'hotel-1', type: 'HOTEL', refundable: false, dependsOn: ['f1'] },
  ]);

  const impacts = analyseImpact(t, { nodeId: 'f1' });

  assert.equal(impacts[0].action, 'ESCALATE');
  assert.equal(impacts[0].reason, 'non-refundable hotel change');
});

test('retimes ground transport', () => {
  const t = trip([
    { id: 'f1', type: 'FLIGHT', dependsOn: [] },
    { id: 'car-1', type: 'GROUND', dependsOn: ['f1'] },
  ]);

  const impacts = analyseImpact(t, { nodeId: 'f1' });

  assert.equal(impacts[0].action, 'RETIME_GROUND');
});

test('escalates a commitment at risk', () => {
  const t = trip([
    { id: 'f1', type: 'FLIGHT', dependsOn: [] },
    { id: 'meeting-1', type: 'COMMITMENT', dependsOn: ['f1'] },
  ]);

  const impacts = analyseImpact(t, { nodeId: 'f1' });

  assert.deepEqual(impacts[0], {
    nodeId: 'meeting-1',
    type: 'COMMITMENT',
    action: 'ESCALATE',
    reason: 'commitment at risk',
  });
});

test('walks multiple levels downstream', () => {
  const t = trip([
    { id: 'f1', type: 'FLIGHT', dependsOn: [] },
    { id: 'hotel-1', type: 'HOTEL', refundable: true, dependsOn: ['f1'] },
    { id: 'meeting-1', type: 'COMMITMENT', dependsOn: ['hotel-1'] },
  ]);

  const impacts = analyseImpact(t, { nodeId: 'f1' });

  assert.equal(impacts.length, 2);
  assert.deepEqual(impacts.map((i) => i.nodeId), ['hotel-1', 'meeting-1']);
});

test('returns nothing for a node with no dependents', () => {
  const t = trip([{ id: 'f1', type: 'FLIGHT', dependsOn: [] }]);

  assert.deepEqual(analyseImpact(t, { nodeId: 'f1' }), []);
});
