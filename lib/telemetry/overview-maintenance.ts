/** Johannesburg has no daylight-saving change; maintenance follows its local day. */
export function maintenanceDayRange(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const from = new Date(`${day}T00:00:00+02:00`);
  return { from: from.toISOString(), until: new Date(from.getTime() + 86_400_000).toISOString() };
}
