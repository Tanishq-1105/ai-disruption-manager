// Maps Sabre's InstaFlights PricedItineraries into a flat shape the mobile
// app can filter/sort without knowing anything about Sabre's schema.

export function normalizeFlightSearchResults(sabreResponse) {
  const itineraries = sabreResponse?.PricedItineraries || [];
  return itineraries.map(normalizeItinerary);
}

// InstaFlights can list the same flight/departure more than once (different
// fare classes) — the index keeps ids unique even when everything else matches,
// which matters because the mobile results list keys off this id.
function normalizeItinerary(itinerary, index) {
  const option = itinerary.AirItinerary.OriginDestinationOptions.OriginDestinationOption[0];
  const segments = option.FlightSegment.map(normalizeSegment);
  const first = segments[0];
  const last = segments[segments.length - 1];
  const fare = extractFareBreakdown(itinerary)?.PassengerFare?.TotalFare;

  return {
    id: `${first.airline}${first.flightNumber}-${first.departureTime}-${index}`,
    airline: first.airline,
    flightNumber: `${first.airline}${first.flightNumber}`,
    origin: first.origin,
    destination: last.destination,
    departureTime: first.departureTime,
    arrivalTime: last.arrivalTime,
    durationMinutes: option.ElapsedTime,
    stops: segments.length - 1,
    segments,
    price: {
      amount: fare?.Amount ?? null,
      currency: fare?.CurrencyCode ?? null,
    },
    source: 'sabre',
  };
}

function normalizeSegment(segment) {
  return {
    airline: segment.MarketingAirline?.Code,
    flightNumber: String(segment.FlightNumber),
    origin: segment.DepartureAirport?.LocationCode,
    destination: segment.ArrivalAirport?.LocationCode,
    departureTime: segment.DepartureDateTime,
    arrivalTime: segment.ArrivalDateTime,
    durationMinutes: segment.ElapsedTime,
  };
}

// PTC_FareBreakdown is an object for a single passenger type, an array when
// itinerary pricing covers more than one (e.g. ADT + CNN) — take the first.
function extractFareBreakdown(itinerary) {
  const breakdown = itinerary.AirItineraryPricingInfo?.PTC_FareBreakdowns?.PTC_FareBreakdown;
  return Array.isArray(breakdown) ? breakdown[0] : breakdown;
}
