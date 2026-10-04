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
  memberAirline: document.getElementById('member-airline'),
  memberFlight: document.getElementById('member-flight'),
  memberFind: document.getElementById('member-find'),
  memberBookings: document.getElementById('member-bookings'),
};

let currentTripId = null;
let pollTimer = null;
let memberQuery = null;
let memberTripIds = [];
let localApprovalEnabled = false;
let localTestDisruptionEnabled = false;

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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
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
      const booking = node.bookingReference || node.bookingId;
      return `Departs ${fmtTime(node.scheduledDeparture)} · Arrives ${arrival}`
        + (booking ? ` · Booking ${booking}` : '');
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

function renderMemberBookings(payload) {
  localApprovalEnabled = payload.localApprovalEnabled === true;
  localTestDisruptionEnabled = payload.localTestDisruptionEnabled === true;
  if (!payload.results.length) {
    els.memberBookings.innerHTML = '<p class="empty-state">No confirmed sandbox bookings found for this flight.</p>';
    return;
  }
  const actions = `<div class="member-actions">
    <button class="btn btn-small btn-warning" data-action="member-cancel">Simulate cancellation for all ${payload.count} passenger(s)</button>
    <button class="btn btn-small" data-action="member-delay">Simulate 90-minute delay for all</button>
    ${localTestDisruptionEnabled ? '<span class="muted">Per-trip test runs the automatic recovery path; it may create a Duffel sandbox order.</span>' : ''}
  </div>`;
  els.memberBookings.innerHTML = actions + payload.results.map((trip) =>
    renderMemberTripCard(trip, trip.recovery)).join('');
}

function renderLocalApproval(tripId, recovery) {
  const approval = recovery?.approval;
  if (!localApprovalEnabled || recovery?.state !== 'AWAITING_APPROVAL'
      || !approval?.binding?.fingerprint) return '';
  const option = approval.option;
  const summary = `${option.flightNumber} · ${option.origin} → ${option.destination}; `
    + `${approval.total.amount} ${approval.total.currency}; `
    + recovery.approval.violations.map(issue => issue.detail).join('; ');
  return `<div class="recovery-section">
    <h3>Member approval required (local test)</h3>
    <div class="node-meta">${escapeHtml(summary)}</div>
    <div class="node-meta">Quote expires ${escapeHtml(fmtTime(approval.expiresAt))}. This local test action approves this exact sandbox offer on the member's behalf.</div>
    <button class="btn btn-small btn-warning" data-action="member-approve"
      data-trip-id="${escapeHtml(tripId)}" data-fingerprint="${escapeHtml(approval.binding.fingerprint)}"
      data-summary="${escapeHtml(summary)}">Approve exact sandbox offer</button>
  </div>`;
}

function renderMemberTripCard(trip, recovery) {
  const tripId = trip.id ?? trip.memberTripId;
  return `<div class="node-card member-trip-card" data-member-trip-card="${escapeHtml(tripId)}">
    <div class="node-head"><span class="type-badge type-FLIGHT">PASSENGER</span>
      <span class="status-badge status-${escapeHtml(trip.status)}">${escapeHtml(trip.status)}</span></div>
    <div class="node-title">${escapeHtml(trip.passengerName || 'Passenger')} · ${escapeHtml(trip.flight?.flightNumber || '—')}</div>
    <div class="node-meta">${escapeHtml(trip.flight?.origin || '—')} → ${escapeHtml(trip.flight?.destination || '—')} · ${escapeHtml(fmtTime(trip.flight?.departureTime))} · ${escapeHtml(trip.bookingReference || trip.orderId || '—')}</div>
    ${localTestDisruptionEnabled && trip.status === 'CONFIRMED' ? `<div class="member-actions">
      <button class="btn btn-small btn-warning" data-action="member-test-disruption"
        data-trip-id="${escapeHtml(tripId)}">Test automatic recovery</button>
    </div>` : ''}
    ${recovery ? `<div class="node-meta">Recovery: ${escapeHtml(recovery.state)}</div>${renderLocalApproval(trip.id ?? trip.memberTripId, recovery)}` : ''}
  </div>`;
}

async function findMemberBookings() {
  const airline = els.memberAirline.value.trim().toUpperCase();
  const flightNumber = els.memberFlight.value.trim().toUpperCase();
  try {
    const payload = await api(`/simulator/member-bookings?airline=${encodeURIComponent(airline)}&flightNumber=${encodeURIComponent(flightNumber)}`);
    memberQuery = payload.query;
    memberTripIds = payload.results.map((trip) => trip.id);
    renderMemberBookings(payload);
    showToast(`Found ${payload.count} confirmed passenger(s).`);
  } catch (err) {
    setStatus('error', err.message);
  }
}

async function disruptMemberBookings(type, minutes) {
  if (!memberQuery) return;
  try {
    const result = await api('/simulator/member-bookings/disrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...memberQuery, type, minutes }),
    });
    memberTripIds = result.affected.map((trip) => trip.memberTripId);
    showToast(`${result.affectedCount} passenger(s) affected.`);
    els.memberBookings.insertAdjacentHTML('afterbegin',
      '<div class="member-actions"><button class="btn btn-small btn-primary" data-action="member-recover">Recover all affected passengers</button></div>');
    if (result.affected[0]) {
      currentTripId = result.affected[0].simulatorTripId;
      els.tripIdLabel.textContent = currentTripId;
      await refresh();
      startPolling();
    }
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
        ${exec.bookingId ? `<div class="recovery-section">
          <h3>Confirmed sandbox replacement</h3>
          <div class="attempt-row">Duffel order: <code>${escapeHtml(exec.bookingId)}</code></div>
          <div class="attempt-row">Booking reference: <strong>${escapeHtml(exec.bookingReference || 'pending')}</strong></div>
          <div class="attempt-row">Fare: ${escapeHtml(exec.total?.amount ?? '—')} ${escapeHtml(exec.total?.currency || '')}</div>
        </div>` : ''}

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
els.memberFind.addEventListener('click', findMemberBookings);

els.tripNodes.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id, minutes } = btn.dataset;
  if (action === 'cancel') cancelFlight(id);
  if (action === 'delay') delayFlight(id, Number(minutes));
});
els.memberBookings.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'member-cancel') disruptMemberBookings('CANCELLED');
  if (button.dataset.action === 'member-delay') disruptMemberBookings('DELAYED', 90);
  if (button.dataset.action === 'member-recover') recoverMemberBookings();
  if (button.dataset.action === 'member-approve') approveMemberRecovery(button);
  if (button.dataset.action === 'member-test-disruption') testMemberDisruption(button);
});

async function testMemberDisruption(button) {
  const tripId = button.dataset.tripId;
  if (!tripId || !confirm(
    'Create a synthetic cancellation and run automatic recovery for this saved trip?\n\n'
    + 'If policy authorizes recovery, this may create a Duffel sandbox replacement order.',
  )) return;
  button.disabled = true;
  button.textContent = 'Running recovery…';
  try {
    const response = await api('/simulator/member-bookings/test-disruption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberTripId: tripId }),
    });
    const result = response.recovery;
    const recovery = result.recovery;
    const card = button.closest('[data-member-trip-card]');
    if (card) {
      const details = document.createElement('div');
      details.className = 'recovery-section';
      const status = document.createElement('h3');
      status.textContent = `Test recovery: ${result.state}`;
      details.append(status);
      const booking = recovery?.updatedBooking;
      if (booking?.orderId) {
        const order = document.createElement('div');
        order.className = 'node-meta';
        order.textContent = `New sandbox order: ${booking.orderId} · Reference: ${booking.bookingReference || 'pending'}`;
        details.append(order);
      }
      if (result.state === 'AWAITING_APPROVAL' && recovery?.approval) {
        details.insertAdjacentHTML('beforeend', renderLocalApproval(tripId, {
          state: result.state,
          approval: recovery.approval,
        }));
      }
      card.append(details);
      button.remove();
    }
    showToast(`Test recovery started: ${result.state}.`);
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Test automatic recovery';
    setStatus('error', err.message);
  }
}

async function approveMemberRecovery(button) {
  if (!memberQuery || !confirm(`Approve this exact Duffel sandbox offer on the member's behalf?\n\n${button.dataset.summary}\n\nThis creates a sandbox test order, not a live ticket.`)) return;
  try {
    const response = await api('/simulator/member-bookings/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...memberQuery,
        memberTripId: button.dataset.tripId,
        fingerprint: button.dataset.fingerprint,
      }),
    });
    const result = response.recovery;
    const card = button.closest('[data-member-trip-card]');
    if (card) {
      card.innerHTML = `<div class="node-head"><strong>${escapeHtml(result.status)}</strong></div>
        <div class="node-meta">${escapeHtml(result.detail || '')}</div>
        ${result.updatedBooking?.orderId ? `<div class="node-meta">
          New sandbox order: <code>${escapeHtml(result.updatedBooking.orderId)}</code> ·
          Reference: <strong>${escapeHtml(result.updatedBooking.bookingReference || 'pending')}</strong>
        </div>` : ''}`;
    }
    showToast(`Local test approval result: ${result.status}.`);
  } catch (err) {
    setStatus('error', err.message);
  }
}

async function recoverMemberBookings() {
  if (!memberQuery || memberTripIds.length === 0) return;
  try {
    const result = await api('/simulator/member-bookings/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...memberQuery, memberTripIds }),
    });
    const recovered = result.results.filter((entry) => entry.status.startsWith('RECOVERED')).length;
    showToast(`${recovered} passenger recovery run(s) completed.`);
    els.memberBookings.insertAdjacentHTML('afterbegin',
      `<div class="member-recovery-results"><h3>Batch recovery results</h3>${result.results.map((entry) =>
          `<div class="node-card member-trip-card" data-member-trip-card="${escapeHtml(entry.memberTripId)}">
            <div class="node-head"><strong>${escapeHtml(entry.passengerName || entry.memberTripId)}</strong>
              <span class="status-badge status-${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span></div>
            ${entry.detail ? `<div class="node-meta">${escapeHtml(entry.detail)}</div>` : ''}
            ${entry.updatedBooking?.orderId ? `<div class="node-meta">
              New sandbox order: <code>${escapeHtml(entry.updatedBooking.orderId)}</code> ·
              Reference: <strong>${escapeHtml(entry.updatedBooking.bookingReference || 'pending')}</strong><br>
              Flight: ${escapeHtml(entry.updatedBooking.flight?.flightNumber || '—')} ·
              ${escapeHtml(entry.updatedBooking.flight?.origin || '—')} → ${escapeHtml(entry.updatedBooking.flight?.destination || '—')} ·
              Fare: ${escapeHtml(entry.updatedBooking.total?.amount ?? '—')} ${escapeHtml(entry.updatedBooking.total?.currency || '')}
            </div>` : ''}
            ${renderLocalApproval(entry.memberTripId, entry.approval)}
          </div>`).join('')}</div>`);
    await refresh();
  } catch (err) {
    setStatus('error', err.message);
  }
}
