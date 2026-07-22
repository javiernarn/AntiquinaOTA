import React, { useMemo } from "react";
import { Sun, Sunset, Moon, Users, CheckCircle2, AlertTriangle } from "lucide-react";
import { formatHours, hoursBetween, formatTime12, formatDateReport } from "../../utils/time";
import { completionFor, COVERAGE_SHORT_LABEL } from "../../utils/dutyStatus";

const CATEGORY_META = {
  regular: { label: "Regular", swatch: "var(--brass)" },
  evening: { label: "Evening", swatch: "var(--evening)" },
  overtime: { label: "Overtime", swatch: "var(--rust)" },
};

export default function ReportsPanel({ entries, clients }) {
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "Unassigned";

  const byClient = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const key = e.client || "unassigned";
      if (!map.has(key)) map.set(key, { id: key, hours: 0, days: 0, last: null });
      const bucket = map.get(key);
      bucket.hours += e.hours;
      bucket.days += 1;
      if (!bucket.last || e.date > bucket.last) bucket.last = e.date;
    }
    return [...map.values()].sort((a, b) => b.hours - a.hours);
  }, [entries]);

  const byCategory = useMemo(() => {
    const totals = { regular: 0, evening: 0, overtime: 0 };
    for (const e of entries) totals[e.category] = (totals[e.category] || 0) + e.hours;
    return totals;
  }, [entries]);

  const grandTotal = entries.reduce((s, e) => s + e.hours, 0);
  const maxClientHours = Math.max(1, ...byClient.map((b) => b.hours));
  const maxCategoryHours = Math.max(1, ...Object.values(byCategory));

  const dayPart = useMemo(() => {
    let morning = 0;
    let afternoon = 0;
    let evening = 0;
    for (const e of entries) {
      if (e.amIn && e.amOut) morning += hoursBetween(e.amIn, e.amOut);
      if (e.pmIn && e.pmOut) afternoon += hoursBetween(e.pmIn, e.pmOut);
      if (e.evIn && e.evOut) evening += hoursBetween(e.evIn, e.evOut);
    }
    return { morning, afternoon, evening };
  }, [entries]);
  const maxDayPart = Math.max(1, dayPart.morning, dayPart.afternoon, dayPart.evening);

  // Chronological (newest-first) breakdown of every entry — exact date,
  // weekday, and the precise time range for whichever segment(s) (Morning /
  // Afternoon / Evening) that entry actually covers, based on its shift
  // coverage. This is the "detailed report" view: what, when, and how long.
  const detailedLog = useMemo(() => {
    return entries
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
        return { ...e, segments, completion: completionFor(e) };
      });
  }, [entries]);

  // Did each logged day actually meet the standard hours for the shift
  // coverage it was logged under (Whole day / Morning only / Afternoon →
  // Evening…), rather than against the overall OJT target? Grouped so the
  // person can see, at a glance, which coverage types tend to fall short.
  const completionSummary = useMemo(() => {
    const byCoverage = new Map();
    let metCount = 0;
    for (const e of entries) {
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
      total: entries.length,
      met: metCount,
      short: entries.length - metCount,
      byCoverage: [...byCoverage.values()].sort((a, b) => b.met + b.short - (a.met + a.short)),
    };
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="reports-empty">
        No entries yet. Clock in or add a day in the Logbook tab to see your reports.
      </div>
    );
  }

  return (
    <div className="reports-grid">
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
                  <span className={`completion-badge ${e.completion.met ? "is-met" : "is-short"}`}>
                    {e.completion.met ? "Complete" : `−${formatHours(Math.abs(e.completion.delta))}`}
                  </span>
                </span>
              </div>
              <div className="timeline-segs">
                {e.segments.map((s) => (
                  <span className="timeline-seg" key={s.key}>
                    <s.Icon size={12} /> {s.label}: {s.range} <em>({formatHours(s.hours)})</em>
                  </span>
                ))}
              </div>
              <div className="timeline-meta">
                <span className="timeline-client"><Users size={11} /> {clientName(e.client)}</span>
                <span className="timeline-total">Total for the day: {formatHours(e.hours)}</span>
              </div>
              {e.task && <div className="timeline-task">“{e.task}”</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
