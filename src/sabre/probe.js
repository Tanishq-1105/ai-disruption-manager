// Pure classification of a probe response. Kept free of network so the
// interesting logic — telling "this account can't reach that product" apart
// from "that product works, the query just matched nothing" — is unit tested.

export const VERDICT = {
  AVAILABLE: 'AVAILABLE',
  AVAILABLE_EMPTY: 'AVAILABLE_EMPTY',
  AVAILABLE_BAD_PARAMS: 'AVAILABLE_BAD_PARAMS',
  NOT_ENTITLED: 'NOT_ENTITLED',
  NOT_PROVISIONED: 'NOT_PROVISIONED',
  AUTH_FAILED: 'AUTH_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER_ERROR: 'SERVER_ERROR',
  WRONG_PRODUCT: 'WRONG_PRODUCT',
  UNKNOWN: 'UNKNOWN',
};

// Sabre overloads 404 three different ways and only the body tells them apart:
//   - empty body            -> the REST gateway has no route at all
//   - "No service exists"   -> the route exists but this account lacks the
//                              product (what POST /v2/shop/flights returns)
//   - "No results were found" -> the product works, the search matched nothing
// Treating all three as "missing" is what makes provisioning look worse than
// it is, so each gets its own verdict.
function classifyNotFound(body, rawBody) {
  if (!rawBody || !rawBody.trim()) {
    return { verdict: VERDICT.NOT_PROVISIONED, detail: 'gateway 404, empty body — no route on this account' };
  }
  const message = String(body?.message ?? body?.Message ?? '');
  if (/no service exists/i.test(message)) {
    return { verdict: VERDICT.NOT_PROVISIONED, detail: `route exists but product not on this account: ${message}` };
  }
  if (/no results were found/i.test(message)) {
    return { verdict: VERDICT.AVAILABLE_EMPTY, detail: 'product responded; query matched nothing' };
  }
  return { verdict: VERDICT.UNKNOWN, detail: `404 with unrecognised body: ${message || rawBody.slice(0, 120)}` };
}

// A 200 only proves *something* answered. Several Sabre fare products share
// the /shop/flights/fares family and return each other's shapes, so a probe
// also asserts the marker fields its product's docs promise — otherwise
// Lead Price Calendar happily masquerades as Fare Range.
export function matchesShape(rawBody, expect) {
  if (!expect?.length) return true;
  return expect.every((key) => new RegExp('"' + key + '"').test(rawBody ?? ''));
}

// Some Sabre products answer HTTP 200 while carrying a refusal in the body -
// Get Booking returns 200 with errors[].category === 'UNAUTHORIZED' when the
// account lacks PCC rights. Trusting the status code alone would record that
// as a working product.
function embeddedError(body) {
  const errs = body?.errors ?? body?.Errors;
  if (!Array.isArray(errs) || errs.length === 0) return null;
  const first = errs[0];
  return {
    tag: `${first.category ?? ''} ${first.type ?? ''}`.toUpperCase(),
    description: first.description ?? first.message ?? '',
  };
}

export function classifyProbe({ status, rawBody, expect }) {
  let body = null;
  if (rawBody && rawBody.trim()) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null; // non-JSON error pages are fine; status still carries the signal
    }
  }

  if (status >= 200 && status < 300) {
    const embedded = embeddedError(body);
    if (embedded) {
      const gated = /UNAUTHORIZED|AUTHORIZATION|NOT_AUTHORIZED/.test(embedded.tag);
      return {
        verdict: gated ? VERDICT.NOT_ENTITLED : VERDICT.AVAILABLE_BAD_PARAMS,
        detail: `HTTP ${status} carrying ${embedded.tag.trim()}: ${embedded.description}`,
        body,
      };
    }
    if (!matchesShape(rawBody, expect)) {
      return {
        verdict: VERDICT.WRONG_PRODUCT,
        detail: `HTTP ${status} but body lacks ${expect.join(', ')} - this path serves a different product`,
        body,
      };
    }
    return { verdict: VERDICT.AVAILABLE, detail: `HTTP ${status}`, body };
  }

  switch (status) {
    case 400:
      // The gateway only reaches parameter validation when the route exists,
      // so a 400 is good news about provisioning and bad news about my query.
      return { verdict: VERDICT.AVAILABLE_BAD_PARAMS, detail: describe(body, rawBody), body };
    case 401:
      return { verdict: VERDICT.AUTH_FAILED, detail: 'token rejected — check credentials', body };
    case 403:
      // What an unsigned Travel Insight Engine Amendment looks like from here.
      return { verdict: VERDICT.NOT_ENTITLED, detail: describe(body, rawBody), body };
    case 404:
      return { ...classifyNotFound(body, rawBody), body };
    case 405:
      return { verdict: VERDICT.AVAILABLE_BAD_PARAMS, detail: 'route exists, wrong HTTP method', body };
    case 429:
      return { verdict: VERDICT.RATE_LIMITED, detail: 'throttled — rerun slower', body };
    default:
      if (status >= 500) return { verdict: VERDICT.SERVER_ERROR, detail: `HTTP ${status}`, body };
      return { verdict: VERDICT.UNKNOWN, detail: `HTTP ${status} ${describe(body, rawBody)}`, body };
  }
}

function describe(body, rawBody) {
  return String(body?.message ?? body?.Message ?? body?.error_description ?? rawBody?.slice(0, 160) ?? '').trim();
}

// A product counts as reachable if any verdict proves the route answered us,
// even when that answer was "empty" or "bad params".
export const REACHABLE = new Set([
  VERDICT.AVAILABLE,
  VERDICT.AVAILABLE_EMPTY,
  VERDICT.AVAILABLE_BAD_PARAMS,
]);

export function isReachable(verdict) {
  return REACHABLE.has(verdict);
}

// Per API: the best verdict any of its path variants achieved.
export function summarise(results) {
  const rank = [
    VERDICT.AVAILABLE,
    VERDICT.AVAILABLE_EMPTY,
    VERDICT.AVAILABLE_BAD_PARAMS,
    VERDICT.NOT_ENTITLED,
    VERDICT.WRONG_PRODUCT,
    VERDICT.RATE_LIMITED,
    VERDICT.SERVER_ERROR,
    VERDICT.UNKNOWN,
    VERDICT.AUTH_FAILED,
    VERDICT.NOT_PROVISIONED,
  ];
  return [...results].sort((a, b) => rank.indexOf(a.verdict) - rank.indexOf(b.verdict))[0] ?? null;
}
