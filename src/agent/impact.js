// Impact Analyser (Phase 3) — PURE. Walks `dependsOn` downstream of a
// disruption event and classifies each affected node. Hands the impact list
// off to the Option Engine / Policy Engine (Phase 4/5); does not act.

export function analyseImpact(trip, event) {
  const impacts = [];
  const visited = new Set();
  const queue = [event.nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const dependents = trip.nodes.filter((n) => (n.dependsOn || []).includes(currentId));

    for (const node of dependents) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      impacts.push(classify(node));
      queue.push(node.id);
    }
  }

  return impacts;
}

function classify(node) {
  switch (node.type) {
    case 'FLIGHT':
      return { nodeId: node.id, type: node.type, action: 'REBOOK_FLIGHT' };
    case 'HOTEL':
      return node.refundable
        ? { nodeId: node.id, type: node.type, action: 'SHIFT_HOTEL' }
        : { nodeId: node.id, type: node.type, action: 'ESCALATE', reason: 'non-refundable hotel change' };
    case 'GROUND':
      return { nodeId: node.id, type: node.type, action: 'RETIME_GROUND' };
    case 'COMMITMENT':
      return { nodeId: node.id, type: node.type, action: 'ESCALATE', reason: 'commitment at risk' };
    default:
      return { nodeId: node.id, type: node.type, action: 'REVIEW' };
  }
}
