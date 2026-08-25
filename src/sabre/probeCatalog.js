// Candidate endpoints for the Part 1 (search / offers) Sabre products.
//
// Paths marked "verified" were confirmed live against this account on
// 2026-08-24; the rest keep several plausible variants and the probe reports
// which one the REST gateway answers.
//
// `expect` lists marker fields the product's documentation promises. Several
// Sabre fare products live in the same /flights/fares family and will happily
// return a 200 carrying a *different* product's payload — the shape assertion
// is what caught /v1/shop/flights/fares being Lead Price Calendar rather than
// the Fare Range its path suggested.

function isoDate(daysFromNow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

export function buildCatalog({ origin = 'JFK', destination = 'LAX', daysAhead = 30, stayDays = 3 } = {}) {
  const departuredate = isoDate(daysAhead);
  const returndate = isoDate(daysAhead + stayDays);
  const earliestdeparturedate = isoDate(Math.max(1, daysAhead - 20));
  const latestdeparturedate = isoDate(daysAhead + 10);

  return [
    {
      part: 1,
      id: 'instaflights',
      name: 'InstaFlights Search',
      purpose: 'Core flight search (parts 1 and 4)',
      // Known-good control. If this fails, suspect credentials or network
      // rather than believing anything else in the run.
      control: true,
      expect: ['PricedItineraries'],
      variants: [
        { method: 'GET', path: '/v1/shop/flights', query: { origin, destination, departuredate, limit: 1 } },
      ],
    },
    {
      part: 1,
      id: 'lead-price-calendar',
      name: 'Lead Price Calendar (v2)',
      purpose: 'Lowest fare per day across 192 days - "cheapest date" offers',
      verified: true,
      expect: ['FareInfo', 'LowestFare'],
      variants: [
        { method: 'GET', path: '/v2/shop/flights/fares', query: { origin, destination, lengthofstay: stayDays, pointofsalecountry: 'US' } },
      ],
    },
    {
      part: 1,
      id: 'lead-price-calendar-v1',
      name: 'Lead Price Calendar (v1)',
      purpose: 'Older single-date variant of the same product',
      verified: true,
      expect: ['FareInfo', 'LowestFare'],
      variants: [
        { method: 'GET', path: '/v1/shop/flights/fares', query: { origin, destination, departuredate, returndate, lengthofstay: stayDays } },
      ],
    },
    {
      part: 1,
      id: 'fare-range',
      name: 'Fare Range (v1)',
      purpose: 'Median/max/min ticketed fare - "below average" offer badges',
      verified: true,
      // Not under /shop/ at all, which is why path-guessing missed it.
      // All five parameters are mandatory; Sabre reports them one at a time.
      expect: ['FareData', 'MedianFare'],
      variants: [
        { method: 'GET', path: '/v1/historical/flights/fares', query: { origin, destination, earliestdeparturedate, latestdeparturedate, lengthofstay: stayDays } },
      ],
    },
    {
      part: 1,
      id: 'low-fare-history',
      name: 'Low Fare History (v1)',
      purpose: 'Lowest fare per past shop date for a fixed itinerary',
      verified: true,
      // Reachable, but this CERT account returns "N/A" for every shop date
      // except today, so it carries almost no usable history.
      expect: ['FareInfo', 'ShopDateTime'],
      variants: [
        { method: 'GET', path: '/v1/historical/shop/flights/fares', query: { origin, destination, departuredate, returndate } },
      ],
    },
    {
      part: 1,
      id: 'low-fare-forecast',
      name: 'Low Fare Forecast (v1)',
      purpose: 'Buy-or-wait recommendation - discovered via Fare Range response links',
      verified: true,
      expect: ['Forecast', 'Recommendation'],
      variants: [
        { method: 'GET', path: '/v1/forecast/flights/fares', query: { origin, destination, departuredate, returndate } },
      ],
    },
    {
      part: 1,
      id: 'multi-airport-city',
      name: 'Multi-Airport City Lookup (v1)',
      purpose: 'MAC codes - needed to offer nearby-airport alternates',
      verified: true,
      expect: ['Cities'],
      variants: [
        { method: 'GET', path: '/v1/lists/supported/cities', query: { country: 'US' } },
      ],
    },
    {
      part: 1,
      id: 'airports-at-cities',
      name: 'Airports at Cities Lookup (v1)',
      purpose: 'MAC -> member airports (NYC -> JFK/LGA/EWR/SWF)',
      verified: true,
      expect: ['Airports'],
      variants: [
        { method: 'GET', path: '/v1/lists/supported/cities/NYC/airports', query: {} },
      ],
    },
    {
      part: 1,
      id: 'airline-lookup',
      name: 'Airline Lookup (v1)',
      purpose: 'Carrier code -> airline name for results UI',
      verified: true,
      expect: ['AirlineInfo'],
      variants: [
        { method: 'GET', path: '/v1/lists/utilities/airlines', query: { airlinecode: 'AA' } },
      ],
    },
    {
      part: 1,
      id: 'city-pairs',
      name: 'City Pairs Lookup (v1)',
      purpose: 'Which routes the fare products actually support',
      verified: true,
      expect: ['OriginDestinationLocations'],
      variants: [
        { method: 'GET', path: '/v1/lists/supported/shop/flights/origins-destinations', query: { origin } },
      ],
    },
    {
      part: 1,
      id: 'aircraft-equipment',
      name: 'Aircraft Equipment Lookup (v1)',
      purpose: 'Equipment code -> aircraft type; seeds a plausible seat matrix',
      verified: true,
      expect: ['AircraftInfo'],
      variants: [
        { method: 'GET', path: '/v1/lists/utilities/aircraft/equipment', query: { aircraftcode: '320' } },
      ],
    },
    // ---------------------------------------------------------------
    // Part 3 - monitoring. Four paths 404'd on the previous credentials;
    // re-probed here because provisioning follows the account, not the code.
    // ---------------------------------------------------------------
    {
      part: 3, id: 'flight-status', name: 'Flight Status / FLIFO',
      purpose: 'Live status for the Watcher poll loop',
      existenceOnly: true, expect: [],
      variants: [
        { method: 'GET', path: '/v1/flightstatus', query: { flightnumber: '742', carrier: 'DL', departuredate } },
        { method: 'GET', path: '/v2/flightstatus', query: { flightnumber: '742', carrier: 'DL', departuredate } },
        { method: 'GET', path: '/v1/lists/utilities/flights/status', query: { flightnumber: '742', carrier: 'DL' } },
        { method: 'GET', path: '/v1/flifo/status', query: { flightnumber: '742', carrier: 'DL' } },
        { method: 'GET', path: '/v1/shop/flights/status', query: { flightnumber: '742', carrier: 'DL' } },
      ],
    },
    {
      part: 3, id: 'flight-schedules', name: 'Flight Schedules',
      purpose: 'Scheduled times to compare against actuals',
      existenceOnly: true, expect: [],
      variants: [
        { method: 'GET', path: '/v1/lists/supported/shop/flights/schedules', query: { origin, destination } },
        { method: 'GET', path: '/v1/shop/flights/schedules', query: { origin, destination, departuredate } },
        { method: 'GET', path: '/v2/shop/flights/schedules', query: { origin, destination, departuredate } },
        { method: 'GET', path: '/v1/schedules/flights', query: { origin, destination, departuredate } },
      ],
    },
    // ---------------------------------------------------------------
    // Part 2 - booking. Probed with GET on purpose: a 405 proves the route
    // exists without creating anything. Never POST a create just to probe.
    // ---------------------------------------------------------------
    {
      part: 2, id: 'create-pnr', name: 'Create Passenger Name Record',
      purpose: 'Real booking (expected PCC-gated)',
      existenceOnly: true, expect: [],
      variants: [
        { method: 'GET', path: '/v2.4.0/passenger/records', query: {} },
        { method: 'GET', path: '/v2.5.0/passenger/records', query: {} },
        { method: 'GET', path: '/v1/passenger/records', query: {} },
      ],
    },
    {
      part: 2, id: 'get-booking', name: 'Get Booking',
      purpose: 'Read an existing PNR',
      // Reading a PNR is non-mutating, so a POST with a bogus id is safe and
      // reveals the real answer: HTTP 200 carrying UNAUTHORIZED_ACCESS.
      expect: ['confirmationId'],
      variants: [
        { method: 'POST', path: '/v1/trip/orders/getBooking', body: { confirmationId: 'ZZZZZZ' } },
      ],
    },
    {
      part: 2, id: 'seat-map', name: 'Enhanced Seat Map',
      purpose: 'The seat matrix for part 1 (expected PCC-gated)',
      existenceOnly: true, expect: [],
      variants: [
        { method: 'GET', path: '/v4.3.0/book/seatmaps', query: {} },
        { method: 'GET', path: '/v1/book/seatmaps', query: {} },
        { method: 'GET', path: '/v5/book/seatmaps', query: {} },
      ],
    },
    // ---------------------------------------------------------------
    // Part 4 - richer alternative search. BFM 404'd on the old credentials;
    // if it is live now it beats InstaFlights for rebooking candidates.
    // ---------------------------------------------------------------
    {
      // GET /v2/shop/flights is InstaFlights v2, NOT Bargain Finder Max - it
      // returns PricedItineraries. Probing BFM with GET produced a false
      // positive until the POST body below proved the real product is absent.
      part: 4, id: 'instaflights-v2', name: 'InstaFlights Search (v2)',
      purpose: 'Newer GET search returning the same PricedItineraries shape',
      verified: true,
      expect: ['PricedItineraries'],
      variants: [
        { method: 'GET', path: '/v2/shop/flights', query: { origin, destination, departuredate, limit: 2 } },
      ],
    },
    {
      part: 4, id: 'bargain-finder-max', name: 'Bargain Finder Max',
      purpose: 'Best-priced alternatives for rebooking',
      // Search is read-only, so POSTing a real OTA body is safe and is the
      // only way to tell BFM apart from the InstaFlights handler above.
      expect: ['PricedItineraries'],
      variants: [
        {
          method: 'POST', path: '/v2/shop/flights',
          body: {
            OTA_AirLowFareSearchRQ: {
              Version: '2',
              POS: { Source: [{ RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
              OriginDestinationInformation: [{
                RPH: '1', DepartureDateTime: `${departuredate}T11:00:00`,
                OriginLocation: { LocationCode: origin }, DestinationLocation: { LocationCode: destination },
              }],
              TravelPreferences: { TPA_Extensions: { NumTrips: { Number: 2 } } },
              TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
            },
          },
        },
        { method: 'POST', path: '/v4/shop/flights', body: {} },
      ],
    },
    {
      part: 4, id: 'alternate-date', name: 'Alternate Date Search',
      purpose: 'Nearby-date alternatives when same-day fails',
      existenceOnly: true, expect: [],
      variants: [
        { method: 'GET', path: '/v3/shop/altdates/flights', query: { origin, destination, departuredate, returndate } },
        { method: 'GET', path: '/v2/shop/altdates/flights', query: { origin, destination, departuredate, returndate } },
      ],
    },
    {
      part: 4, id: 'revalidate', name: 'Revalidate Itinerary',
      purpose: 'Confirm a candidate is still sellable before rebooking',
      existenceOnly: true, expect: [],
      variants: [
        { method: 'GET', path: '/v1/shop/flights/revalidate', query: {} },
        { method: 'GET', path: '/v3.0.0/shop/flights/revalidate', query: {} },
      ],
    },
  ].map((entry) => ({ ...entry, context: { origin, destination, departuredate, returndate } }));
}
