#!/usr/bin/env node
// Feasibility probe for the non-Sabre providers, using the same
// body-over-status-code classification as probe-sabre.js.
//
//   npm run probe:providers
//
// A provider with no credentials is SKIPPED, never failed — the app is meant to
// run without them. Run this before writing or trusting any adapter: the Sabre
// work proved that a 200 can carry the wrong product, or an outright refusal.

import { config } from '../src/config.js';
import { classifyProbe, isReachable, VERDICT } from '../src/sabre/probe.js';

const GAP_MS = 350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isoDaysAhead(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Each check names the marker fields its docs promise, so a 200 carrying
// something else is reported as WRONG_PRODUCT rather than success.
function buildChecks() {
  const checks = [];

  // --- OpenSky: no credentials required ---------------------------------
  checks.push({
    provider: 'OpenSky',
    name: 'Live aircraft states',
    purpose: 'Free position feed — proves a flight is airborne, not its status',
    url: 'https://opensky-network.org/api/states/all?lamin=40.0&lomin=-75.0&lamax=41.5&lomax=-73.0',
    expect: ['states', 'time'],
    headers: config.openSky.username
      ? { Authorization: `Basic ${Buffer.from(`${config.openSky.username}:${config.openSky.password}`).toString('base64')}` }
      : {},
    credentialled: true, // anonymous access is legitimate here
  });

  // --- Duffel ------------------------------------------------------------
  const duffelReady = Boolean(config.duffel.accessToken);
  const duffelHeaders = {
    Authorization: `Bearer ${config.duffel.accessToken}`,
    'Duffel-Version': 'v2',
    Accept: 'application/json',
  };
  checks.push({
    provider: 'Duffel',
    name: 'List airlines (auth check)',
    purpose: 'Cheapest call that proves the token works',
    url: `${config.duffel.baseUrl}/air/airlines?limit=1`,
    expect: ['data'],
    headers: duffelHeaders,
    credentialled: duffelReady,
    missing: 'DUFFEL_ACCESS_TOKEN',
  });
  checks.push({
    provider: 'Duffel',
    name: 'List orders',
    purpose: 'Confirms the booking surface is reachable in test mode',
    url: `${config.duffel.baseUrl}/air/orders?limit=1`,
    expect: ['data'],
    headers: duffelHeaders,
    credentialled: duffelReady,
    missing: 'DUFFEL_ACCESS_TOKEN',
  });

  // --- AeroDataBox via RapidAPI -----------------------------------------
  const adbReady = Boolean(config.aeroDataBox.rapidApiKey);
  const adbHeaders = {
    'X-RapidAPI-Key': config.aeroDataBox.rapidApiKey,
    'X-RapidAPI-Host': config.aeroDataBox.host,
  };
  checks.push({
    provider: 'AeroDataBox',
    name: 'Flight status by number',
    purpose: 'The Phase 2 Watcher feed',
    url: `https://${config.aeroDataBox.host}/flights/number/DL742/${isoDaysAhead(-1)}`,
    expect: ['departure', 'arrival'],
    headers: adbHeaders,
    credentialled: adbReady,
    missing: 'RAPIDAPI_KEY',
  });
  checks.push({
    provider: 'AeroDataBox',
    name: 'Airport departures board',
    purpose: 'One call covers every flight at an airport — makes polling affordable',
    url: `https://${config.aeroDataBox.host}/flights/airports/iata/JFK/`
      + `${isoDaysAhead(-1)}T08:00/${isoDaysAhead(-1)}T10:00`,
    expect: ['departures'],
    headers: adbHeaders,
    credentialled: adbReady,
    missing: 'RAPIDAPI_KEY',
  });

  return checks;
}

const ICON = {
  [VERDICT.AVAILABLE]: 'OK   ',
  [VERDICT.AVAILABLE_EMPTY]: 'OK   ',
  [VERDICT.AVAILABLE_BAD_PARAMS]: 'OK*  ',
  [VERDICT.WRONG_PRODUCT]: 'MISID',
  [VERDICT.NOT_ENTITLED]: 'GATED',
  [VERDICT.NOT_PROVISIONED]: 'NO   ',
  [VERDICT.AUTH_FAILED]: 'AUTH ',
  [VERDICT.RATE_LIMITED]: 'THROT',
  [VERDICT.SERVER_ERROR]: 'ERR  ',
  [VERDICT.UNKNOWN]: '?    ',
};

const checks = buildChecks();
const skipped = [];
let reachable = 0;
let attempted = 0;

for (const check of checks) {
  if (!check.credentialled) {
    skipped.push(check);
    console.log(`SKIP  ${check.provider.padEnd(12)} ${check.name.padEnd(30)} set ${check.missing} to enable`);
    continue;
  }

  attempted += 1;
  let verdict;
  let detail;
  let status = null;
  try {
    const res = await fetch(check.url, { headers: check.headers });
    status = res.status;
    const rawBody = await res.text();
    ({ verdict, detail } = classifyProbe({ status, rawBody, expect: check.expect }));
  } catch (err) {
    verdict = VERDICT.UNKNOWN;
    detail = `request failed: ${err.message}`;
  }

  if (isReachable(verdict)) reachable += 1;
  console.log(`${ICON[verdict] ?? '?    '} ${check.provider.padEnd(12)} ${check.name.padEnd(30)} ${String(status ?? '-').padEnd(4)} ${verdict}`);
  if (detail) console.log(`      ${String(detail).slice(0, 130)}`);
  await sleep(GAP_MS);
}

console.log('\n---');
console.log(`Reachable: ${reachable}/${attempted} probed, ${skipped.length} skipped for missing credentials`);
if (skipped.length > 0) {
  const needed = [...new Set(skipped.map((s) => s.missing))];
  console.log(`Add to .env to enable: ${needed.join(', ')}`);
}
