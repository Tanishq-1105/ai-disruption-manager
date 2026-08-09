const POLL_MS = 2000;

const els = {
  seedDemo: document.getElementById('seed-demo'),
  failNext: document.getElementById('fail-next'),
  refreshNow: document.getElementById('refresh-now'),
  statusPill: document.getElementById('status-pill'),
  statusText: document.getElementById('status-text'),
  tripIdLabel: document.getElementById('trip-id-label'),
  tripNodes: document.getElementById('trip-nodes'),
  analysisEvents: document.getElementById('analysis-events'),
  rawState: document.getElementById('raw-state'),
  toast: document.getElementById('toast'),
};

let currentTripId = null;
let pollTimer = null;

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`${res.status} ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function setStatus(state, message) {
  els.statusPill.className = `status-pill status-${state}`;
  els.statusText.textContent = message || state;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  setTimeout(() => els.toast.classList.remove('visible'), 2200);
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function nodeTitle(node) {
  switch (node.type) {
    case 'FLIGHT':
      return `${node.origin} → ${node.destination}`;
    case 'HOTEL':
      return node.name;
    case 'GROUND':
      return node.provider;
    case 'COMMITMENT':
      return node.label;
    default:
      return node.id;
  }
}

function nodeMeta(node) {
  switch (node.type) {
    case 'FLIGHT': {
      const arrival = node.projectedArrival
        ? `${fmtTime(node.projectedArrival)} (was ${fmtTime(node.scheduledArrival)})`
        : fmtTime(node.scheduledArrival);
      return `Departs ${fmtTime(node.scheduledDeparture)} · Arrives ${arrival}`;
    }
    case 'HOTEL':
      return `${fmtTime(node.checkIn)} → ${fmtTime(node.checkOut)}`;
    case 'GROUND':
      return `Pickup ${fmtTime(node.pickupTime)}`;
    case 'COMMITMENT':
      return fmtTime(node.time);
    default:
      return '';
  }
}

function renderTrip(trip) {
  if (!trip) {
    els.tripNodes.innerHTML = '<p class="empty-state">No trip loaded yet.</p>';
    return;
  }

  const byId = new Map(trip.nodes.map((n) => [n.id, n]));

  els.tripNodes.innerHTML = trip.nodes
    .map((node) => {
      const dependsLabels = (node.dependsOn || [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(nodeTitle)
        .join(', ');

      const actions =
        node.type === 'FLIGHT' && node.status !== 'CANCELLED'
          ? `
            <button class="btn btn-small" data-action="cancel" data-id="${node.id}">Cancel</button>
            <button class="btn btn-small" data-action="delay" data-id="${node.id}" data-minutes="90">Delay 90m</button>
          `
          : '';

      return `
        <div class="node-card status-${node.status}">
          <div class="node-head">
            <span class="type-badge type-${node.type}">${node.type}</span>
            <span class="status-badge status-${node.status}">${node.status}</span>
          </div>
          <div class="node-title">${nodeTitle(node)}</div>
          <div class="node-meta">${nodeMeta(node)}</div>
          <div class="node-depends">depends on: ${dependsLabels || '—'}</div>
          <div class="node-actions">${actions}</div>
        </div>
      `;
    })
    .join('');
}

function renderAnalysis(analysis, trip) {
  if (!analysis || analysis.events.length === 0) {
    els.analysisEvents.innerHTML = '<p class="empty-state">No disruptions detected. Trip is healthy.</p>';
    return;
  }

  const byId = new Map((trip?.nodes || []).map((n) => [n.id, n]));

  els.analysisEvents.innerHTML = analysis.impacts
    .map(({ event, impact }) => {
      const nodeLabel = byId.get(event.nodeId) ? nodeTitle(byId.get(event.nodeId)) : event.nodeId;
      const extra =
        event.type === 'CONNECTION_AT_RISK'
          ? `<div class="event-node">only ${Math.round(event.minutesAvailable)} min to connect (upstream: ${event.upstreamNodeId})</div>`
          : '';

      const impactRows = impact.length
        ? impact
            .map((i) => {
              const label = byId.get(i.nodeId) ? nodeTitle(byId.get(i.nodeId)) : i.nodeId;
              return `
                <div class="impact-item">
                  <span class="action-badge action-${i.action}">${i.action}</span>
                  <span>${label}${i.reason ? ` — ${i.reason}` : ''}</span>
                </div>
              `;
            })
            .join('')
        : '<div class="impact-item">No downstream impact.</div>';

      return `
        <div class="event-card event-${event.type}">
          <div class="event-head">
            <span class="event-type">${event.type}</span>
            <span class="event-time">${new Date(event.detectedAt).toLocaleTimeString()}</span>
          </div>
          <div class="event-node">${nodeLabel}</div>
          ${extra}
          <div class="impact-list">${impactRows}</div>
        </div>
      `;
    })
    .join('');
}

async function refresh() {
  if (!currentTripId) return;
  try {
    const [state, analysis] = await Promise.all([
      api('/simulator/state'),
      api(`/simulator/trips/${currentTripId}/analyse`),
    ]);
    const trip = state.trips.find((t) => t.id === currentTripId);
    renderTrip(trip);
    renderAnalysis(analysis, trip);
    els.rawState.textContent = JSON.stringify(state, null, 2);
    setStatus('ok', 'live');
  } catch (err) {
    setStatus('error', err.message);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refresh, POLL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
}

async function seedDemo() {
  try {
    const trip = await api('/simulator/demo/seed', { method: 'POST' });
    currentTripId = trip.id;
    els.tripIdLabel.textContent = trip.id;
    await refresh();
    startPolling();
    showToast('Demo trip seeded.');
  } catch (err) {
    setStatus('error', err.message);
  }
}

async function forceFailNext() {
  try {
    await api('/simulator/bookings/fail-next', { method: 'POST' });
    showToast('Next booking attempt will be forced to fail.');
  } catch (err) {
    setStatus('error', err.message);
  }
}

async function cancelFlight(nodeId) {
  try {
    await api(`/simulator/trips/${currentTripId}/nodes/${nodeId}/cancel`, { method: 'POST' });
    await refresh();
    showToast(`Cancelled ${nodeId}.`);
  } catch (err) {
    setStatus('error', err.message);
  }
}

async function delayFlight(nodeId, minutes) {
  try {
    await api(`/simulator/trips/${currentTripId}/flights/${nodeId}/delay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes }),
    });
    await refresh();
    showToast(`Delayed ${nodeId} by ${minutes} minutes.`);
  } catch (err) {
    setStatus('error', err.message);
  }
}

els.seedDemo.addEventListener('click', seedDemo);
els.failNext.addEventListener('click', forceFailNext);
els.refreshNow.addEventListener('click', refresh);

els.tripNodes.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id, minutes } = btn.dataset;
  if (action === 'cancel') cancelFlight(id);
  if (action === 'delay') delayFlight(id, Number(minutes));
});
