function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** Formats a Date for an HTML date input without converting it to UTC. */
export function formatLocalDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addLocalDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function localDateAfterDays(days: number, date = new Date()) {
  return formatLocalDate(addLocalDays(date, days));
}
