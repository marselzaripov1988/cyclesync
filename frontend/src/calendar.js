export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

export function buildMonthGrid(monthDate) {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const first = addDays(monthStart, -monthStart.getDay());
  const days = [];
  for (let i = 0; i < 42; i += 1) {
    days.push(addDays(first, i));
  }
  return days;
}

