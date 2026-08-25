import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProbe, matchesShape, summarise, isReachable, VERDICT } from '../src/sabre/probe.js';
import { buildCatalog } from '../src/sabre/probeCatalog.js';

test('a 200 is available', () => {
  const { verdict } = classifyProbe({ status: 200, rawBody: '{"PricedItineraries":[]}' });
  assert.equal(verdict, VERDICT.AVAILABLE);
});

// The three faces of a Sabre 404 — the whole reason this classifier exists.
test('an empty-bodied 404 is an unprovisioned gateway route', () => {
  const { verdict } = classifyProbe({ status: 404, rawBody: '' });
  assert.equal(verdict, VERDICT.NOT_PROVISIONED);
});

test('a whitespace-only 404 body is still an unprovisioned route', () => {
  const { verdict } = classifyProbe({ status: 404, rawBody: '\n  ' });
  assert.equal(verdict, VERDICT.NOT_PROVISIONED);
});

test('"No service exists" is a product this account does not have', () => {
  const { verdict } = classifyProbe({
    status: 404,
    rawBody: '{"message":"No service exists for [POST /v2/shop/flights]"}',
  });
  assert.equal(verdict, VERDICT.NOT_PROVISIONED);
});

test('"No results were found" means the product works and matched nothing', () => {
  const { verdict } = classifyProbe({
    status: 404,
    rawBody: '{"status":"Complete","message":"No results were found"}',
  });
  assert.equal(verdict, VERDICT.AVAILABLE_EMPTY);
  assert.ok(isReachable(verdict));
});

test('an unrecognised 404 body is not silently called missing', () => {
  const { verdict } = classifyProbe({ status: 404, rawBody: '{"message":"Something new"}' });
  assert.equal(verdict, VERDICT.UNKNOWN);
});

test('a 400 proves the route exists even though the query was wrong', () => {
  const { verdict } = classifyProbe({ status: 400, rawBody: '{"message":"Invalid lengthofstay"}' });
  assert.equal(verdict, VERDICT.AVAILABLE_BAD_PARAMS);
  assert.ok(isReachable(verdict));
});

test('a 403 is an entitlement gap, not a missing route', () => {
  const { verdict, detail } = classifyProbe({ status: 403, rawBody: '{"message":"Not authorized"}' });
  assert.equal(verdict, VERDICT.NOT_ENTITLED);
  assert.match(detail, /Not authorized/);
  assert.equal(isReachable(verdict), false);
});

test('a 401 is flagged as credentials, never as provisioning', () => {
  const { verdict } = classifyProbe({ status: 401, rawBody: '{"error":"invalid_token"}' });
  assert.equal(verdict, VERDICT.AUTH_FAILED);
});

test('429 and 5xx are their own verdicts', () => {
  assert.equal(classifyProbe({ status: 429, rawBody: '' }).verdict, VERDICT.RATE_LIMITED);
  assert.equal(classifyProbe({ status: 503, rawBody: '' }).verdict, VERDICT.SERVER_ERROR);
});

test('a non-JSON body does not throw', () => {
  const { verdict } = classifyProbe({ status: 502, rawBody: '<html>Bad Gateway</html>' });
  assert.equal(verdict, VERDICT.SERVER_ERROR);
});

test('summarise picks the most favourable variant result', () => {
  const best = summarise([
    { verdict: VERDICT.NOT_PROVISIONED, path: '/a' },
    { verdict: VERDICT.AVAILABLE_EMPTY, path: '/b' },
    { verdict: VERDICT.NOT_ENTITLED, path: '/c' },
  ]);
  assert.equal(best.path, '/b');
});

test('summarise handles an empty attempt list', () => {
  assert.equal(summarise([]), null);
});

test('catalog builds future dates and marks the live-verified paths', () => {
  const catalog = buildCatalog({ origin: 'DEL', destination: 'BOM', daysAhead: 10 });
  const byId = Object.fromEntries(catalog.map((c) => [c.id, c]));

  assert.ok(new Date(catalog[0].context.departuredate) > new Date());
  assert.equal(catalog[0].context.origin, 'DEL');

  // Their docs warn these need a signed Travel Insight Engine Amendment, but
  // the 2026-08-24 live probe reached all of them on this CERT account, so the
  // catalog records the confirmed paths rather than the documented warning.
  assert.equal(byId['fare-range'].verified, true);
  assert.equal(byId['fare-range'].variants[0].path, '/v1/historical/flights/fares');
  assert.equal(byId['lead-price-calendar'].variants[0].path, '/v2/shop/flights/fares');
  assert.equal(byId['multi-airport-city'].verified, true);

  // InstaFlights is the control that tells a broken harness from a gated account.
  assert.equal(byId['instaflights'].control, true);
});

// Added after a live run: /v1/shop/flights/fares answers 200 with a Lead Price
// Calendar payload even though its path reads like Fare Range. Status codes
// alone cannot tell those apart, so the probe asserts marker fields too.
test('matchesShape passes when every marker field is present', () => {
  assert.equal(matchesShape('{"FareData":[{"MedianFare":268.4}]}', ['FareData', 'MedianFare']), true);
});

test('matchesShape fails when a marker field is missing', () => {
  assert.equal(matchesShape('{"FareInfo":[{"LowestFare":336.8}]}', ['FareData', 'MedianFare']), false);
});

test('matchesShape with no expectation accepts anything', () => {
  assert.equal(matchesShape('{"anything":1}', undefined), true);
  assert.equal(matchesShape('{"anything":1}', []), true);
});

test('a 200 carrying another product is WRONG_PRODUCT, not AVAILABLE', () => {
  const { verdict, detail } = classifyProbe({
    status: 200,
    rawBody: '{"FareInfo":[{"LowestFare":336.8}]}',
    expect: ['FareData', 'MedianFare'],
  });
  assert.equal(verdict, VERDICT.WRONG_PRODUCT);
  assert.match(detail, /different product/);
  assert.equal(isReachable(verdict), false);
});

test('a 200 matching its expected shape stays AVAILABLE', () => {
  const { verdict } = classifyProbe({
    status: 200,
    rawBody: '{"FareData":[{"MedianFare":268.4,"Count":"Low"}]}',
    expect: ['FareData', 'MedianFare'],
  });
  assert.equal(verdict, VERDICT.AVAILABLE);
});

test('every catalog entry declares variants, and shape markers unless existence-only', () => {
  for (const entry of buildCatalog()) {
    assert.ok(entry.variants.length > 0, `${entry.id} has no variants`);
    // existence-only probes just ask "is there a route here at all", so they
    // have no payload to assert a shape against.
    if (!entry.existenceOnly) {
      assert.ok(entry.expect?.length > 0, `${entry.id} has no expect[]`);
    }
  }
});

// Added after the parts 2-4 run: Get Booking answers HTTP 200 while refusing
// the request in the body, so a 2xx is not on its own proof of a working product.
test('a 200 carrying UNAUTHORIZED errors is NOT_ENTITLED', () => {
  const { verdict, detail } = classifyProbe({
    status: 200,
    rawBody: JSON.stringify({
      request: { confirmationId: 'ZZZZZZ' },
      errors: [{ category: 'UNAUTHORIZED', type: 'UNAUTHORIZED_ACCESS', description: 'authorization issues' }],
    }),
    expect: ['confirmationId'],
  });
  assert.equal(verdict, VERDICT.NOT_ENTITLED);
  assert.match(detail, /UNAUTHORIZED_ACCESS/);
  assert.equal(isReachable(verdict), false);
});

test('a 200 carrying a non-auth error means the route works but the request was wrong', () => {
  const { verdict } = classifyProbe({
    status: 200,
    rawBody: JSON.stringify({ errors: [{ category: 'VALIDATION', type: 'BAD_FIELD', description: 'nope' }] }),
  });
  assert.equal(verdict, VERDICT.AVAILABLE_BAD_PARAMS);
});

test('an empty errors array is not treated as a failure', () => {
  const { verdict } = classifyProbe({ status: 200, rawBody: '{"errors":[],"PricedItineraries":[]}', expect: ['PricedItineraries'] });
  assert.equal(verdict, VERDICT.AVAILABLE);
});

test('catalog separates InstaFlights v2 from Bargain Finder Max', () => {
  const byId = Object.fromEntries(buildCatalog().map((c) => [c.id, c]));
  // Same path, different method - the GET is InstaFlights, only the POST is BFM.
  assert.equal(byId['instaflights-v2'].variants[0].method, 'GET');
  assert.equal(byId['instaflights-v2'].variants[0].path, '/v2/shop/flights');
  assert.equal(byId['bargain-finder-max'].variants[0].method, 'POST');
  assert.equal(byId['bargain-finder-max'].variants[0].path, '/v2/shop/flights');
  assert.ok(byId['bargain-finder-max'].variants[0].body.OTA_AirLowFareSearchRQ);
});

test('every catalog entry declares a workflow part', () => {
  for (const entry of buildCatalog()) {
    assert.ok([1, 2, 3, 4].includes(entry.part), `${entry.id} has no valid part`);
  }
});
