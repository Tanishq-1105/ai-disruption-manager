#!/usr/bin/env node
// Live provisioning probe: walks every candidate Sabre endpoint with the real
// credentials in .env and reports which products this account can actually
// reach. Deliberately NOT in test/ — it needs network and credentials, and
// `npm test` must keep running offline.
//
//   npm run probe:sabre
//   npm run probe:sabre -- --origin=DEL --destination=BOM --days=45
//
// Prints status and verdict only. Never prints the token or the credentials.

import { config } from '../src/config.js';
import { getAccessToken } from '../src/sabre/auth.js';
import { buildCatalog } from '../src/sabre/probeCatalog.js';
import { classifyProbe, summarise, isReachable, VERDICT } from '../src/sabre/probe.js';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const REQUEST_GAP_MS = 400; // a trial account throttles easily; stay polite

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function probeVariant(token, variant, expect) {
  const url = new URL(`${config.sabre.baseUrl}${variant.path}`);
  for (const [key, value] of Object.entries(variant.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: variant.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: variant.body ? JSON.stringify(variant.body) : undefined,
    });
    const rawBody = await res.text();
    const { verdict, detail } = classifyProbe({ status: res.status, rawBody, expect });
    return {
      method: variant.method,
      path: variant.path,
      query: variant.query ?? {},
      status: res.status,
      ms: Date.now() - started,
      verdict,
      detail,
      bodySample: rawBody.slice(0, 400),
    };
  } catch (err) {
    // Network/DNS/TLS failure says nothing about provisioning, so it gets its
    // own verdict rather than being mistaken for a missing product.
    return {
      method: variant.method,
      path: variant.path,
      query: variant.query ?? {},
      status: null,
      ms: Date.now() - started,
      verdict: VERDICT.UNKNOWN,
      detail: `request failed: ${err.message}`,
      bodySample: '',
    };
  }
}

const ICON = {
  [VERDICT.AVAILABLE]: 'OK   ',
  [VERDICT.AVAILABLE_EMPTY]: 'OK   ',
  [VERDICT.AVAILABLE_BAD_PARAMS]: 'OK*  ',
  [VERDICT.NOT_ENTITLED]: 'GATED',
  [VERDICT.WRONG_PRODUCT]: 'MISID',
  [VERDICT.NOT_PROVISIONED]: 'NO   ',
  [VERDICT.AUTH_FAILED]: 'AUTH ',
  [VERDICT.RATE_LIMITED]: 'THROT',
  [VERDICT.SERVER_ERROR]: 'ERR  ',
  [VERDICT.UNKNOWN]: '?    ',
};

async function main() {
  const args = parseArgs(process.argv);

  if (!config.sabre.clientId || !config.sabre.clientSecret) {
    console.error('SABRE_CLIENT_ID / SABRE_CLIENT_SECRET missing. Fill .env before probing.');
    process.exit(1);
  }

  let catalog = buildCatalog({
    origin: args.origin ?? 'JFK',
    destination: args.destination ?? 'LAX',
    daysAhead: args.days ? Number(args.days) : 30,
  });
  if (args.part) {
    const wanted = args.part.split(',').map(Number);
    catalog = catalog.filter((entry) => wanted.includes(entry.part));
  }

  console.log(`Sabre base URL : ${config.sabre.baseUrl}`);
  console.log(`Probe route    : ${catalog[0].context.origin} -> ${catalog[0].context.destination} on ${catalog[0].context.departuredate}`);
  console.log('Authenticating...');

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error(`\nAuth failed, nothing else can be probed: ${err.message}`);
    process.exit(1);
  }
  console.log('Token acquired.\n');

  const report = [];
  for (const api of catalog) {
    const attempts = [];
    for (const variant of api.variants) {
      const result = await probeVariant(token, variant, api.expect);
      attempts.push(result);
      await sleep(REQUEST_GAP_MS);
      // Stop early once a variant proves the product answers — the remaining
      // variants were only guesses at the same product's path.
      if (isReachable(result.verdict)) break;
      // For existence-only probes an entitlement refusal is still proof the
      // route is there, so stop rather than trying more path guesses.
      if (api.existenceOnly && result.verdict === VERDICT.NOT_ENTITLED) break;
    }
    const best = summarise(attempts);
    report.push({ ...api, best, attempts });

    console.log(`${ICON[best.verdict] ?? '?    '} P${api.part} ${api.name.padEnd(32)} ${String(best.status ?? '-').padEnd(4)} ${best.verdict}`);
    console.log(`      ${best.method} ${best.path}`);
    if (best.detail) console.log(`      ${best.detail.slice(0, 150)}`);
    console.log();
  }

  const usable = report.filter((r) => isReachable(r.best.verdict));
  const control = report.find((r) => r.control);

  console.log('---');
  if (control && !isReachable(control.best.verdict)) {
    console.log('WARNING: the InstaFlights control failed. Suspect credentials or network,');
    console.log('not provisioning — every other verdict in this run is unreliable.');
  }
  console.log(`Reachable on this account: ${usable.length}/${report.length}`);
  for (const r of usable) console.log(`  - ${r.name}  (${r.best.method} ${r.best.path})`);

  const outPath = new URL('../sabre-probe-report.json', import.meta.url);
  await writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: config.sabre.baseUrl, report }, null, 2));
  console.log(`\nFull report written to sabre-probe-report.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
