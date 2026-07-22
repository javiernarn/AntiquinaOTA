// Host-client work schedules. A trainee's actual clock-in/out boundaries
// depend on which agency they're assigned to — a public office typically
// runs Monday–Thursday, 8:00 AM–5:00 PM (8 hours/day); a private company
// more often runs Monday–Friday, 7:00 AM–6:00 PM (10 hours/day). Both
// presets assume the same fixed 12:00–1:00 PM lunch break the rest of the
// app already uses. "Custom" leaves every field for the trainee to set by
// hand, for a host that doesn't match either pattern.
import { toMinutes, weekdayOf, todayStr } from "./time";

export const COMPANY_TYPES = {
  public: { label: "Public", days: [1, 2, 3, 4], timeIn: "08:00", timeOut: "17:00" },
  private: { label: "Private", days: [1, 2, 3, 4, 5], timeIn: "07:00", timeOut: "18:00" },
  custom: { label: "Custom", days: [1, 2, 3, 4, 5], timeIn: "08:00", timeOut: "17:00" },
};

// 1=Mon … 7=Sun, matching weekdayOf().
export const WEEKDAYS = [
  { id: 1, short: "Mon" },
  { id: 2, short: "Tue" },
  { id: 3, short: "Wed" },
  { id: 4, short: "Thu" },
  { id: 5, short: "Fri" },
  { id: 6, short: "Sat" },
  { id: 7, short: "Sun" },
];

export function defaultsForType(type) {
  const preset = COMPANY_TYPES[type] || COMPANY_TYPES.custom;
  return { days: [...preset.days], timeIn: preset.timeIn, timeOut: preset.timeOut };
}

// Backfills schedule fields on clients saved before this feature existed,
// so older host-client entries don't crash the scheduling logic below —
// they just fall back to the same Mon–Fri, 8–5 assumption the app always
// used.
export function normalizeClient(client) {
  if (!client) return client;
  if (client.days && client.timeIn && client.timeOut) return client;
  const d = defaultsForType(client.type || "custom");
  return {
    ...client,
    type: client.type || "custom",
    days: client.days && client.days.length ? client.days : d.days,
    timeIn: client.timeIn || d.timeIn,
    timeOut: client.timeOut || d.timeOut,
  };
}

// Which of the Morning (before 12:00 PM) / Afternoon (1:00–5:00 PM) /
// Evening (after 5:00 PM) segments a host client's own timeIn–timeOut
// window actually overlaps. Drives which shift-coverage options make sense
// for that client — e.g. a client whose hours are 1:00 PM–8:00 PM has no
// Morning segment at all, so "Morning only" / "Whole day" shouldn't be
// offered when that client is selected, and the Afternoon-in / Evening
// fields should default to that client's own hours rather than the usual
// 1:00 PM lunch-resume / 5:00 PM–8:00 PM assumption.
export function clientCoverage(client) {
  const c = normalizeClient(client);
  const inMin = toMinutes(c.timeIn);
  const outMin = toMinutes(c.timeOut);
  if (inMin === null || outMin === null || outMin <= inMin) {
    return { am: true, pm: true, ev: false };
  }
  return {
    am: inMin < 12 * 60,
    pm: inMin < 17 * 60 && outMin > 12 * 60,
    ev: outMin > 17 * 60,
  };
}

// Scheduled hours for one full day at this client, accounting for the fixed
// 12:00–1:00 PM lunch break when the shift spans across it.
export function dailyHoursFor(client) {
  const c = normalizeClient(client);
  const inMin = toMinutes(c.timeIn);
  const outMin = toMinutes(c.timeOut);
  if (inMin === null || outMin === null || outMin <= inMin) return 0;
  const spansLunch = inMin < 12 * 60 && outMin > 13 * 60;
  const lunchMinutes = spansLunch ? 60 : 0;
  return Math.round(((outMin - inMin - lunchMinutes) / 60) * 100) / 100;
}

export function isWorkDay(client, dateStr = todayStr()) {
  const c = normalizeClient(client);
  const wd = weekdayOf(dateStr);
  return Array.isArray(c.days) && c.days.includes(wd);
}

// "Mon–Thu · 8:00 AM–5:00 PM" style label. formatTime12 is passed in rather
// than imported here to avoid a circular import (time.js doesn't depend on
// this file, but keeping the formatting call at the call site is simpler).
export function scheduleDaysLabel(client) {
  const c = normalizeClient(client);
  const days = [...c.days].sort((a, b) => a - b);
  if (!days.length) return "No days set";
  // Collapse a contiguous run (e.g. [1,2,3,4] -> "Mon–Thu"); otherwise list
  // short labels individually.
  const isContiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const shortOf = (id) => WEEKDAYS.find((w) => w.id === id)?.short || "";
  if (isContiguous && days.length > 1) {
    return `${shortOf(days[0])}–${shortOf(days[days.length - 1])}`;
  }
  return days.map(shortOf).join(", ");
}
