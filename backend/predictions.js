export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function parseISODate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function getPredictedEvents(profile, fromDate, toDate) {
  const events = [];
  const cycleLength = Number(profile.cycle_length);
  const periodLength = Number(profile.period_length);
  const anchor = parseISODate(profile.last_period_start);
  let cycleStart = new Date(anchor);

  while (cycleStart < addDays(fromDate, -cycleLength * 2)) {
    cycleStart = addDays(cycleStart, cycleLength);
  }

  while (cycleStart <= addDays(toDate, cycleLength * 2)) {
    for (let i = 0; i < periodLength; i += 1) {
      const d = addDays(cycleStart, i);
      events.push({ date: toISODate(d), type: "period", profileId: profile.id });
    }

    const ovulationDay = addDays(cycleStart, cycleLength - 14);
    events.push({ date: toISODate(ovulationDay), type: "ovulation", profileId: profile.id });

    for (let i = -4; i <= 1; i += 1) {
      const d = addDays(ovulationDay, i);
      events.push({ date: toISODate(d), type: "fertile", profileId: profile.id });
    }

    cycleStart = addDays(cycleStart, cycleLength);
  }

  return events.filter((evt) => {
    const d = new Date(evt.date);
    return d >= fromDate && d <= toDate;
  });
}

