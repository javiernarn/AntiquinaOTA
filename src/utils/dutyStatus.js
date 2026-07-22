// Expected duration of each standard segment, based on the default shift
// times used across the app (8:00–12:00 morning, 13:00–17:00 afternoon,
// 17:00–20:00 evening). These are what "a full Morning" / "a full
// Afternoon" / "a full Evening" is measured against, regardless of which
// exact clock times a particular entry used.
export const STANDARD_SEGMENT_HOURS = { am: 4, pm: 4, ev: 3 };

// Sum of the standard hours for whichever segments this entry actually
// covers (per its shift coverage) — i.e. what "fully meeting" this entry's
// shift coverage would look like.
export function expectedHoursFor(entry) {
  let expected = 0;
  if (entry.amIn && entry.amOut) expected += STANDARD_SEGMENT_HOURS.am;
  if (entry.pmIn && entry.pmOut) expected += STANDARD_SEGMENT_HOURS.pm;
  if (entry.evIn && entry.evOut) expected += STANDARD_SEGMENT_HOURS.ev;
  return expected;
}

// A short machine-readable coverage code — matches the "shift coverage"
// options in the manual-entry form (full / am / pm / ev / pmev) — derived
// straight from which segments an entry/draft has filled in.
export function coverageCodeFor(entry) {
  const hasAM = !!(entry.amIn && entry.amOut);
  const hasPM = !!(entry.pmIn && entry.pmOut);
  const hasEV = !!(entry.evIn && entry.evOut);
  if (hasAM && hasPM && !hasEV) return "full";
  if (hasAM && !hasPM && !hasEV) return "am";
  if (!hasAM && hasPM && !hasEV) return "pm";
  if (!hasAM && !hasPM && hasEV) return "ev";
  if (!hasAM && hasPM && hasEV) return "pmev";
  return "custom";
}

export const COVERAGE_SHORT_LABEL = {
  full: "Whole day",
  am: "Morning only",
  pm: "Afternoon only",
  ev: "Evening only",
  pmev: "Afternoon → Evening",
  custom: "Custom",
};

// Compares an entry's actual logged hours against the expected hours for
// its own shift coverage, so a report can say "met the hours" for whatever
// segment(s) that day was supposed to cover, not against the full-day
// target. A tiny tolerance absorbs rounding from minute-level time inputs.
export function completionFor(entry) {
  const expected = expectedHoursFor(entry);
  const actual = entry.hours ?? 0;
  const delta = Math.round((actual - expected) * 100) / 100;
  const met = expected === 0 ? true : delta >= -0.01;
  return {
    coverage: coverageCodeFor(entry),
    expected,
    actual,
    delta, // negative = short of the expected hours; positive/zero = met or exceeded
    met,
  };
}
