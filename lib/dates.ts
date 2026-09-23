/** Returns the UTC calendar-day interval containing the supplied instant. */
export function getUtcCalendarDayRange(at: Date = new Date()) {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
