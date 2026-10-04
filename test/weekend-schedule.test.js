import test from "node:test";
import assert from "node:assert/strict";
import { generateWeekendSchedule, swapWeekendAssignments, weekendDates } from "../lib/weekend-schedule.js";

test("weekendrooster bevat alleen alle zaterdagen en zondagen", () => {
  const dates = weekendDates(2026);
  assert.equal(dates.length, 104);
  assert.ok(dates.every(value => [0, 6].includes(new Date(`${value}T00:00:00Z`).getUTCDay())));
});

test("deelnemende bestuurders worden gelijkmatig ingedeeld", () => {
  const members = [{ id:"a", weekendRoster:true, createdAt:"1" }, { id:"b", weekendRoster:true, createdAt:"2" }, { id:"c", weekendRoster:false, createdAt:"3" }];
  const schedule = generateWeekendSchedule(2026, members);
  assert.deepEqual(schedule.slice(0, 4).map(item => item.memberId), ["a", "b", "a", "b"]);
});

test("twee weekenddiensten kunnen van persoon wisselen", () => {
  const schedule = [{ date:"2026-01-03", memberId:"a" }, { date:"2026-01-04", memberId:"b" }];
  swapWeekendAssignments(schedule, "2026-01-03", "2026-01-04");
  assert.deepEqual(schedule.map(item => item.memberId), ["b", "a"]);
});
