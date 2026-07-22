// Real-time progress engine.
//
// The rest of the app treats a logbook entry's `hours` field as already
// "banked" the instant it's saved — which is correct for entries produced
// by the live Clock in/out flow (saveSegment() only ever writes a segment
// once its scheduled end has actually been reached, or the trainee clocked
// out at that literal moment). It is NOT correct for entries added by hand
// through "Add day": someone can pick a shift coverage (Whole day / Morning
// only / Afternoon → Evening …) for TODAY and fill in times that haven't
// happened yet (e.g. it's 7:59 AM and they add an 8:00 AM–5:00 PM day) —
// the raw `hours` field would already say "8h", even though none of that
// has actually elapsed.
//
// This module re-derives, from the wall clock, how much of any entry's
// scheduled segments have *actually* elapsed right now — the same
// Philippine-time clock the rest of the app already uses (see utils/time.js)
// — so the hero progress ring, the ledger, the Reports tab, and the PDF
// export can all move in lockstep with real time instead of jumping ahead
// the moment a future/partial entry is saved.
import { toMinutes, nowClock, todayStr, hoursBetween } from "./time";

// One Morning/Afternoon/Evening segment's status against the clock:
//  - "upcoming"    → dated in the future, or dated today but its start
//                    time hasn't arrived yet. Contributes 0 live hours.
//  - "in-progress" → dated today, currently between its start and end
//                    time. Contributes only the hours elapsed so far.
//  - "complete"    → dated in the past, or dated today with its end time
//                    already reached. Contributes its full scheduled hours.
export function segmentLiveStatus(dateStr, startStr, endStr, now = new Date()) {
  const scheduled = hoursBetween(startStr, endStr);
  if (!dateStr || !startStr || !endStr) return { scheduled, live: 0, status: "upcoming" };

  const today = todayStr(now);
  if (dateStr < today) return { scheduled, live: scheduled, status: "complete" };
  if (dateStr > today) return { scheduled, live: 0, status: "upcoming" };

  const nowMin = toMinutes(nowClock(now));
  const startMin = toMinutes(startStr);
  const endMin = toMinutes(endStr);
  if (nowMin === null || startMin === null || endMin === null) {
    return { scheduled, live: 0, status: "upcoming" };
  }
  if (nowMin < startMin) return { scheduled, live: 0, status: "upcoming" };
  if (nowMin >= endMin) return { scheduled, live: scheduled, status: "complete" };

  const live = Math.max(0, Math.round(((nowMin - startMin) / 60) * 100) / 100);
  return { scheduled, live, status: "in-progress" };
}

// Aggregates every segment an entry actually fills in (per its shift
// coverage) into one real-time picture of that entry:
//  - scheduledHours: what the entry is worth once every segment finishes
//    (same number `segmentHours()`/`entry.hours` already produces)
//  - liveHours: what's actually elapsed against the clock right now
//  - status: "upcoming" (nothing has started yet) / "in-progress" (started,
//    not all segments finished) / "complete" (every segment's end time has
//    passed)
export function liveEntryProgress(entry, now = new Date()) {
  const segs = [];
  if (entry.amIn && entry.amOut) segs.push({ key: "am", label: "Morning", ...segmentLiveStatus(entry.date, entry.amIn, entry.amOut, now) });
  if (entry.pmIn && entry.pmOut) segs.push({ key: "pm", label: "Afternoon", ...segmentLiveStatus(entry.date, entry.pmIn, entry.pmOut, now) });
  if (entry.evIn && entry.evOut) segs.push({ key: "ev", label: "Evening", ...segmentLiveStatus(entry.date, entry.evIn, entry.evOut, now) });

  if (segs.length === 0) {
    const hrs = entry.hours || 0;
    return { scheduledHours: hrs, liveHours: hrs, status: "complete", segments: [] };
  }

  const scheduledHours = Math.round(segs.reduce((s, x) => s + x.scheduled, 0) * 100) / 100;
  const liveHours = Math.round(segs.reduce((s, x) => s + x.live, 0) * 100) / 100;
  const allComplete = segs.every((s) => s.status === "complete");
  const allUpcoming = segs.every((s) => s.status === "upcoming");
  const status = allComplete ? "complete" : allUpcoming ? "upcoming" : "in-progress";

  return { scheduledHours, liveHours, status, segments: segs };
}

// True the moment any entry has started but not yet finished — the signal
// used to gate the Reports tab and PDF export ("can't view/download a
// finished report while the logbook is still mid-shift").
export function hasInProgressEntries(entries, now = new Date()) {
  return entries.some((e) => liveEntryProgress(e, now).status === "in-progress");
}

// Sum of real-time (not-yet-elapsed-excluded) hours across a list of
// entries — what the hero progress ring and running totals should use
// instead of a flat `sum(e.hours)`.
export function liveTotalHours(entries, now = new Date()) {
  return Math.round(entries.reduce((sum, e) => sum + liveEntryProgress(e, now).liveHours, 0) * 100) / 100;
}
