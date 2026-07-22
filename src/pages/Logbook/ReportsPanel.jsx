import React, { useMemo } from "react";
import { Sun, Sunset, Moon, Users, CheckCircle2, AlertTriangle, Clock3, CalendarClock } from "lucide-react";
import { formatHours, hoursBetween, formatTime12, formatDateReport } from "../../utils/time";
import { completionFor, COVERAGE_SHORT_LABEL } from "../../utils/dutyStatus";
import { liveEntryProgress } from "../../utils/liveProgress";

const CATEGORY_META = {
  regular: { label: "Regular", swatch: "var(--brass)" },
  evening: { label: "Evening", swatch: "var(--evening)" },
  overtime: { label: "Overtime", swatch: "var(--rust)" },
};

// Reports are a record of what's actually happened, not what's been typed
// in — so every figure on this tab is driven off each entry's real-time
// progress (see utils/liveProgress.js) rather than its raw stored `hours`.
// An entry scheduled for later today (or a future date) contributes
// nothing yet; an entry mid-shift right now contributes only what's
// elapsed so far and ticks upward live; only a finished entry counts its
// full hours.
export default function ReportsPanel({ entries, clients, now = new Date(), blockingExport = false }) {
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "Unassigned";

  // Real-time status for every entry, recomputed each time `now` ticks.
  const progressById = useMemo(() => {
    const map = new Map();
    for (const e of entries) map.set(e.id, liveEntryProgress(e, now));
    return map;
  }, [entries, now]);

  // Entries that have actually started — anything still purely "upcoming"
  // (a future date, or dated today but its start time hasn't arrived) isn't
  // real data yet, so it's excluded from every figure below rather than
  // being counted as if it already happened.
  const activeEntries = useMemo(
    () => entries.filter((e) => progressById.get(e.id)?.status !== "upcoming"),
    [entries, progressById]
  );
  const upcomingCount = entries.length - activeEntries.length;

  // Live hours to actually credit an entry with right now: full stored
  // hours once it's complete, only the elapsed portion while in progress.
  const liveHoursOf = (e) => progressById.get(e.id)?.liveHours ?? e.hours;

  const byClient = useMemo(() => {
    const map = new Map();
    for (const e of activeEntries) {
      const key = e.client || "unassigned";
      if (!map.has(key)) map.set(key, { id: key, hours: 0, days: 0, last: null });
      const bucket = map.get(key);
      bucket.hours += liveHoursOf(e);
      bucket.days += 1;
      if (!bucket.last || e.date > bucket.last) bucket.last = e.date;
    }
    return [...map.values()].sort((a, b) => b.hours - a.hours);
  }, [activeEntries, progressById]);

  const byCategory = useMemo(() => {
    const totals = { regular: 0, evening: 0, overtime: 0 };
    for (const e of activeEntries) totals[e.category] = (totals[e.category] || 0) + liveHoursOf(e);
    return totals;
  }, [activeEntries, progressById]);

  const grandTotal = activeEntries.reduce((s, e) => s + liveHoursOf(e), 0);
  const maxClientHours = Math.max(1, ...byClient.map((b) => b.hours));
  const maxCategoryHours = Math.max(1, ...Object.values(byCategory));

  const dayPart = useMemo(() => {
    let morning = 0;
    let afternoon = 0;
    let evening = 0;
    for (const e of activeEntries) {
      const p = progressById.get(e.id);
      for (const seg of p?.segments || []) {
        if (seg.key === "am") morning += seg.live;
        if (seg.key === "pm") afternoon += seg.live;
        if (seg.key === "ev") evening += seg.live;
      }
    }
    return { morning, afternoon, evening };
  }, [activeEntries, progressById]);
  const maxDayPart = Math.max(1, dayPart.morning, dayPart.afternoon, dayPart.evening);

  // Chronological (newest-first) breakdown of every entry that's actually
  // started — exact date, weekday, and the precise time range for
  // whichever segment(s) (Morning / Afternoon / Evening) that entry
  // covers, plus its real-time status. This is the "detailed report" view:
  // what, when, how long, and whether it's still running right now.
  const detailedLog = useMemo(() => {
    return activeEntries
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => {
        const segments = [];
        if (e.amIn && e.amOut)
          segments.push({ key: "am", label: "Morning", Icon: Sun, range: `${formatTime12(e.amIn)} – ${formatTime12(e.amOut)}`, hours: hoursBetween(e.amIn, e.amOut) });
        if (e.pmIn && e.pmOut)
          segments.push({ key: "pm", label: "Afternoon", Icon: Sunset, range: `${formatTime12(e.pmIn)} – ${formatTime12(e.pmOut)}`, hours: hoursBetween(e.pmIn, e.pmOut) });
        if (e.evIn && e.evOut)
          segments.push({ key: "ev", label: "Evening", Icon: Moon, range: `${formatTime12(e.evIn)} – ${formatTime12(e.evOut)}`, hours: hoursBetween(e.evIn, e.evOut) });
        const progress = progressById.get(e.id);
        return {
          ...e,
          segments,
          progress,
          liveHours: progress?.liveHours ?? e.hours,
          completion: progress?.status === "complete" ? completionFor(e) : null,
        };
      });
  }, [activeEntries, progressById]);

  // Did each *finished* day actually meet the standard hours for the shift
  // coverage it was logged under (Whole day / Morning only / Afternoon →
  // Evening…)? Still-running entries aren't judged met/short yet — there's
  // no verdict to give until the clock says the shift is actually over.
  const completionSummary = useMemo(() => {
    const finished = activeEntries.filter((e) => progressById.get(e.id)?.status === "complete");
    const byCoverage = new Map();
    let metCount = 0;
    for (const e of finished) {
      const c = completionFor(e);
      if (c.met) metCount += 1;
      if (!byCoverage.has(c.coverage)) byCoverage.set(c.coverage, { coverage: c.coverage, met: 0, short: 0, shortfallHours: 0 });
      const bucket = byCoverage.get(c.coverage);
      if (c.met) bucket.met += 1;
      else {
        bucket.short += 1;
        bucket.shortfallHours += Math.abs(c.delta);
      }
    }
    return {
      total: finished.length,
      met: metCount,
      short: finished.length - metCount,
      byCoverage: [...byCoverage.values()].sort((a, b) => b.met + b.short - (a.met + a.short)),
    };
  }, [activeEntries, progressById]);

  // No report to show at all until at least one entry has actually
  // started against the clock — a bunch of scheduled-but-not-yet-due
  // entries isn't reportable data yet.
  if (activeEntries.length === 0) {
    return (
      <div className="reports-empty">
        {entries.length === 0
          ? "No entries yet. Clock in or add a day in the Logbook tab to see your reports."
          : "Your logged shift hasn't started yet against the clock — this report will populate in real time once it does."}
      </div>
    );
  }

  return (
    <div className="reports-grid">
      {(blockingExport || upcomingCount > 0) && (
        <div className="report-card report-card--wide reports-live-banner">
          {blockingExport && (
            <div className="live-banner-row is-progress">
              <Clock3 size={15} />
              <span>
                Today's shift is still running against the clock — the numbers below are updating in real time, and
                PDF export is locked until it finishes.
              </span>
            </div>
          )}
          {upcomingCount > 0 && (
            <div className="live-banner-row is-upcoming">
              <CalendarClock size={15} />
              <span>
                {upcomingCount} scheduled {upcomingCount === 1 ? "entry hasn't" : "entries haven't"} started yet and{" "}
                {upcomingCount === 1 ? "isn't" : "aren't"} included below yet.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="report-card">
        <h3>Morning vs. afternoon vs. evening hours</h3>
        <div className="bar-list">
          <div className="bar-row">
            <div className="bar-row-head">
              <span className="bar-name"><Sun size={13} /> Morning (time in – lunch)</span>
              <span className="bar-value">{formatHours(dayPart.morning)}</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(dayPart.morning / maxDayPart) * 100}%`, background: "var(--brass)" }} />
            </div>
          </div>
          <div className="bar-row">
            <div className="bar-row-head">
              <span className="bar-name"><Sunset size={13} /> Afternoon (lunch – time out)</span>
              <span className="bar-value">{formatHours(dayPart.afternoon)}</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(dayPart.afternoon / maxDayPart) * 100}%`, background: "var(--evening)" }} />
            </div>
          </div>
          <div className="bar-row">
            <div className="bar-row-head">
              <span className="bar-name"><Moon size={13} /> Evening (overtime / late coverage)</span>
              <span className="bar-value">{formatHours(dayPart.evening)}</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(dayPart.evening / maxDayPart) * 100}%`, background: "var(--rust)" }} />
            </div>
          </div>
        </div>
      </div>

      <div className="report-card">
        <h3>Hours by host client</h3>
        <div className="bar-list">
          {byClient.map((b) => (
            <div className="bar-row" key={b.id}>
              <div className="bar-row-head">
                <span className="bar-name">{b.id === "unassigned" ? "Unassigned" : clientName(b.id)}</span>
                <span className="bar-value">{formatHours(b.hours)}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill client" style={{ width: `${(b.hours / maxClientHours) * 100}%` }} />
              </div>
              <div className="bar-meta">
                {b.days} {b.days === 1 ? "entry" : "entries"} &middot; last logged {b.last}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="report-card">
        <h3>Hours by shift type</h3>
        <div className="bar-list">
          {Object.entries(byCategory).map(([key, hours]) => (
            <div className="bar-row" key={key}>
              <div className="bar-row-head">
                <span className="bar-name">
                  <i className="dot" style={{ background: CATEGORY_META[key].swatch }} />
                  {CATEGORY_META[key].label}
                </span>
                <span className="bar-value">{formatHours(hours)}</span>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{
                    width: `${(hours / maxCategoryHours) * 100}%`,
                    background: CATEGORY_META[key].swatch,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="report-total">
          <span>Total logged</span>
          <strong>{formatHours(grandTotal)}</strong>
        </div>
      </div>

      <div className="report-card">
        <h3>Shift coverage completion</h3>
        <div className="completion-summary">
          <div className="completion-stat completion-stat--met">
            <CheckCircle2 size={16} />
            <div>
              <strong>{completionSummary.met}</strong>
              <span>day{completionSummary.met === 1 ? "" : "s"} met the hours for their shift coverage</span>
            </div>
          </div>
          <div className="completion-stat completion-stat--short">
            <AlertTriangle size={16} />
            <div>
              <strong>{completionSummary.short}</strong>
              <span>day{completionSummary.short === 1 ? "" : "s"} came in short</span>
            </div>
          </div>
        </div>
        <div className="bar-list completion-breakdown">
          {completionSummary.byCoverage.map((b) => {
            const total = b.met + b.short;
            return (
              <div className="bar-row" key={b.coverage}>
                <div className="bar-row-head">
                  <span className="bar-name">{COVERAGE_SHORT_LABEL[b.coverage] || b.coverage}</span>
                  <span className="bar-value">
                    {b.met}/{total} complete
                  </span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(b.met / total) * 100}%`,
                      background: b.met === total ? "var(--teal)" : "var(--brass)",
                    }}
                  />
                </div>
                {b.short > 0 && (
                  <div className="bar-meta">
                    Short a combined {formatHours(b.shortfallHours)} across {b.short} {b.short === 1 ? "day" : "days"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="report-card report-card--wide">
        <h3>Detailed duty log</h3>
        <p className="report-card-sub">
          Every entry, most recent first — exact date, weekday, and the precise time range for each shift-coverage segment logged.
        </p>
        <div className="timeline-list">
          {detailedLog.map((e) => (
            <div className="timeline-item" key={e.id}>
              <div className="timeline-head">
                <span className="timeline-date">{formatDateReport(e.date)}</span>
                <span className="timeline-head-tags">
                  <span className={`tag tag-${e.category}`}>{CATEGORY_META[e.category].label}</span>
                  {e.progress?.status === "in-progress" ? (
                    <span className="completion-badge is-progress" title={`${formatHours(e.liveHours)} elapsed of ${formatHours(e.progress.scheduledHours)} scheduled — still running`}>
                      <span className="live-dot" /> In progress
                    </span>
                  ) : e.completion ? (
                    <span className={`completion-badge ${e.completion.met ? "is-met" : "is-short"}`}>
                      {e.completion.met ? "Complete" : `−${formatHours(Math.abs(e.completion.delta))}`}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="timeline-segs">
                {e.segments.map((s) => {
                  const segProgress = e.progress?.segments?.find((x) => x.key === s.key);
                  const segLive = segProgress?.status === "in-progress";
                  return (
                    <span className={`timeline-seg${segLive ? " is-live" : ""}`} key={s.key}>
                      <s.Icon size={12} /> {s.label}: {s.range}{" "}
                      <em>({segLive ? `${formatHours(segProgress.live)} so far` : formatHours(s.hours)})</em>
                    </span>
                  );
                })}
              </div>
              <div className="timeline-meta">
                <span className="timeline-client"><Users size={11} /> {clientName(e.client)}</span>
                <span className="timeline-total">
                  {e.progress?.status === "in-progress" ? "Elapsed so far" : "Total for the day"}: {formatHours(e.liveHours)}
                </span>
              </div>
              {e.task && <div className="timeline-task">“{e.task}”</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
