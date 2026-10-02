export function withDefaultFlightDate(params = {}, now = new Date()) {
  if (params.departuredate) return params;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return { ...params, departuredate: `${tomorrow.getFullYear()}-${month}-${day}` };
}

export function flightSearchError(params = {}) {
  if (!/^[A-Z]{3}$/.test(params.origin ?? '')) return 'Choose a From airport from the suggestions.';
  if (!/^[A-Z]{3}$/.test(params.destination ?? '')) return 'Choose a To airport from the suggestions.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.departuredate ?? '')) return 'Choose a departure date.';
  const date = new Date(`${params.departuredate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== params.departuredate) {
    return 'Choose a valid departure date.';
  }
  return null;
}