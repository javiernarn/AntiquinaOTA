export function toMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function hoursBetween(timeIn, timeOut) {
  const a = toMinutes(timeIn);
  const b = toMinutes(timeOut);
  if (a === null || b === null) return 0;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}

export function formatHours(h) {
  const sign = h < 0 ? "-" : "";
  const abs = Math.abs(h || 0);
  const whole = Math.floor(abs);
  const mins = Math.round((abs - whole) * 60);
  return `${sign}${whole}h ${mins.toString().padStart(2, "0")}m`;
}

// Returns today's date as YYYY-MM-DD using LOCAL time, not UTC.
// (toISOString() converts to UTC first, which rolls the date back a day
// for any timezone ahead of UTC — e.g. Philippines, UTC+8 — during the
// early hours of the day. That was the "date shows 21 instead of 22" bug.)
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nowClock(d = new Date()) {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

// Human-friendly local date, e.g. "Wed, Jul 22, 2026" — used on the PDF report.
export function formatDateLong(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Determines which part of the day a time (HH:MM) falls into, for the
// morning / lunch / afternoon breakdown used in reports and the PDF export.
export function partOfDay(time) {
  const mins = toMinutes(time);
  if (mins === null) return "—";
  if (mins < 12 * 60) return "Morning";
  if (mins < 13 * 60) return "Lunch";
  return "Afternoon";
}

// Displays a 24-hour "HH:MM" value the way it's normally written and read
// in the Philippines — 12-hour clock with AM/PM — instead of military time.
// Internally times are still stored/compared as 24-hour "HH:MM" so the math
// in hoursBetween() stays simple; this is purely for what's shown on screen.
export function formatTime12(t) {
  if (!t) return "";
  const mins = toMinutes(t);
  if (mins === null) return "";
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${period}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Milliseconds elapsed since an ISO timestamp, kept live by re-invoking on a tick.
export function elapsedMsSince(isoStart) {
  if (!isoStart) return 0;
  return Math.max(0, Date.now() - new Date(isoStart).getTime());
}

// HH:MM:SS readout for a running session — the ticking digits on the duty clock.
export function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

export function msToHours(ms) {
  return Math.round((ms / 3600000) * 100) / 100;
}
