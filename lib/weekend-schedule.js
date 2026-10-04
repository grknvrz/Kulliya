export function weekendDates(year) {
  const numeric = Number(year);
  if (!Number.isInteger(numeric) || numeric < 2020 || numeric > 2100) throw new Error("Ongeldig roosterjaar.");
  const dates = [];
  for (let date = new Date(Date.UTC(numeric, 0, 1)); date.getUTCFullYear() === numeric; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

export function generateWeekendSchedule(year, boardMembers) {
  const eligible = (boardMembers || []).filter(member => member.weekendRoster === true && member.active !== false)
    .sort((a, b) => String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)));
  return weekendDates(year).map((date, index) => ({ date, memberId: eligible.length ? eligible[index % eligible.length].id : null }));
}

export function swapWeekendAssignments(assignments, firstDate, secondDate) {
  const first = assignments.find(item => item.date === firstDate), second = assignments.find(item => item.date === secondDate);
  if (!first || !second || first.date === second.date) throw new Error("Selecteer twee verschillende weekenddiensten.");
  [first.memberId, second.memberId] = [second.memberId, first.memberId];
  return assignments;
}
