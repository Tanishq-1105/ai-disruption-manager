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
  runRecovery: document.getElementById('run-recovery'),
  recoveryStatus: document.getElementById('recovery-status'),
  recoveryOutput: document.getElementById('recovery-output'),
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

function outcomeClass(outcome) {
  if (/BOOKED|RELEASED|APPLIED/.test(outcome)) return 'outcome-ok';
  if (/FAILED|NOT_AUTHORISED|NOT_CONFIRMED/.test(outcome)) return 'outcome-bad';
  return 'outcome-warn';
}

function renderRecovery(result) {
  if (!result.recoveries.length) {
    els.recoveryOutput.innerHTML = '<p class="empty-state">No disruption detected. Cancel a flight first.</p>';
    return;
  }

  els.recoveryOutput.innerHTML = result.recoveries
    .map((rec) => {
      if (rec.skipped) {
        return `<p class="empty-state">${rec.event.type}: ${rec.skipped}</p>`;
      }

      const exec = rec.execution;
      const chosenId = rec.ranked.find((o) => exec.summary.includes(o.flightNumber))?.optionId;

      // The ranked list is the agent showing its work: what it considered, the
      // score it gave, and every factor behind that score.
      const options = rec.ranked
        .map((o) => {
          const why = o.breakdown
            .filter((b) => b.points !== 0)
            .map((b) => `${b.points > 0 ? '+' : ''}${b.points} ${b.factor}`)
            .join(' · ') || 'identical to the original';
          return `<div class="option-row ${o.optionId === chosenId ? 'is-chosen' : ''}">
            <span class="option-score">${o.score}</span>
            <span>${o.flightNumber} &nbsp;<span class="muted">${o.departureTime.slice(11, 16)} &rarr; ${o.arrivalTime.slice(11, 16)} · ${o.stops} stop</span>
              <div class="option-why">${why}</div></span>
            <span>${o.price.amount} ${o.price.currency}</span>
          </div>`;
        })
        .join('');

      const attempts = exec.attempts
        .map((a) => `<div class="attempt-row">Attempt ${a.attempt}: <span class="${outcomeClass(a.outcome)}">${a.outcome}</span>${
          a.detail ? ` <span class="muted">${a.detail}</span>` : ''
        }</div>`)
        .join('');

      const escalations = rec.decision.escalations
        .map((e) => `<div class="attempt-row"><span class="outcome-warn">${e.rule}</span> <span class="muted">${e.reason}</span></div>`)
        .join('');

      // The single member-facing message — the product's actual promise, so it
      // leads the panel rather than being buried under the machinery.
      const msg = rec.message
        ? `<div class="member-message severity-${rec.message.severity}">
             <div class="message-label">Message to member</div>
             <div class="message-headline">${rec.message.headline}</div>
             <div class="message-body">${rec.message.body}</div>
           </div>`
        : '';

      return `
        ${msg}
        <div class="recovery-verdict">
          <span class="verdict-badge verdict-${rec.decision.decision}">${rec.decision.decision}</span>
          <span class="verdict-badge verdict-${exec.status}">${exec.status.replace(/_/g, ' ')}</span>
          <span class="muted">${exec.summary}</span>
        </div>

        <div class="recovery-section">
          <h3>Considered ${rec.candidateCount} real alternatives${rec.rejectedCount ? ` · dropped ${rec.rejectedCount} implausible` : ''}</h3>
          ${options}
        </div>

        <div class="recovery-section">
          <h3>Booking attempts</h3>
          ${attempts || '<div class="attempt-row muted">none</div>'}
        </div>

        ${escalations ? `<div class="recovery-section"><h3>Escalated to the member</h3>${escalations}</div>` : ''}
      `;
    })
    .join('');

  // The audit trail is the product's accountability claim, so it is shown, not
  // hidden behind the raw-state details element.
  const audit = result.audit
    .map((a) => `<div class="audit-row">
        <span class="audit-action">${a.action}</span>
        <span class="audit-outcome ${outcomeClass(a.outcome)}">${a.outcome}</span>
        <span class="muted">${a.authorisedBy || ''}${a.detail ? ` — ${a.detail}` : ''}${
          a.oldTicketRetained ? '<span class="retained-flag">old ticket retained</span>' : ''
        }</span>
      </div>`)
    .join('');

  els.recoveryOutput.innerHTML += `<div class="recovery-section"><h3>Audit trail</h3>${audit}</div>`;
}

async function runRecovery() {
  if (!currentTripId) {
    showToast('Seed a trip first.');
    return;
  }
  els.runRecovery.disabled = true;
  els.recoveryStatus.textContent = 'searching real alternatives…';
  try {
    const result = await api(`/simulator/trips/${currentTripId}/recover`, { method: 'POST' });
    renderRecovery(result);
    els.recoveryStatus.textContent = result.summary || 'done';
    await refresh();
  } catch (err) {
    els.recoveryStatus.textContent = err.message;
    setStatus('error', err.message);
  } finally {
    els.runRecovery.disabled = false;
  }
}

els.seedDemo.addEventListener('click', seedDemo);
els.runRecovery.addEventListener('click', runRecovery);
els.failNext.addEventListener('click', forceFailNext);
els.refreshNow.addEventListener('click', refresh);

els.tripNodes.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id, minutes } = btn.dataset;
  if (action === 'cancel') cancelFlight(id);
  if (action === 'delay') delayFlight(id, Number(minutes));
});
