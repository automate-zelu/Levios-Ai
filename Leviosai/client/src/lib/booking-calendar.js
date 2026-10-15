/**
 * Helpers for Bookings day / week / month calendar views (P2.2).
 */

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  return addDays(x, -day);
}

export function startOfMonth(d) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function appointmentsOnDay(rows, day) {
  const start = startOfDay(day).getTime();
  const end = addDays(day, 1).getTime();
  return (rows || []).filter((r) => {
    const t = new Date(r.scheduledAt).getTime();
    return Number.isFinite(t) && t >= start && t < end;
  });
}

/** 7 days starting Sunday of the week containing `anchor`. */
export function weekDays(anchor) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Calendar month grid (leading/trailing days from adjacent months). */
export function monthGrid(anchor) {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function formatDayLabel(d) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function formatMonthLabel(d) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
